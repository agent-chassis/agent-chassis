

import { randomBytes } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import path from "node:path";
import {
  setWorkRecordStatusByUnit,
  writeValidatedWorkRecord
} from "../../../wiki-core/src/index.mjs";
import {
  createManagedWorkerConfinementActivationBinding,
  createWorkspaceAgentDispatchBackend
} from "@agent-chassis/agent-launch-cli/src/lib/workspace-agent-dispatch-backend.mjs";
import {
  WIKI_MCP_DISPATCH_WORKTREE_ROOT_ENV_VAR,
  WIKI_MCP_WORKSPACE_DIR_ENV_VAR
} from "@agent-chassis/agent-launch-cli/src/lib/codex-role-mcp-env.mjs";
import {
  createCodexWorkspaceAgentLaunchExecutor,
  CODEX_FAMILY_NATIVE_READ_CAPABILITY,
  CODEX_FAMILY_SOURCE_READ_MODE
} from "@agent-chassis/agent-launch-cli/src/lib/workspace-agent-dispatch-codex-executor.mjs";
import {
  createClaudeWorkspaceAgentLaunchExecutor,
  CLAUDE_FAMILY_SOURCE_READ_MODE,
  CLAUDE_FAMILY_NATIVE_READ_CAPABILITY
} from "@agent-chassis/agent-launch-cli/src/lib/workspace-agent-dispatch-claude-executor.mjs";

import {
  buildFamilyExecutorRegistryEntry
} from "@agent-chassis/agent-launch-cli/src/lib/workspace-agent-launch-adapter-contract.mjs";
import {
  prepareSliceReviewSurface
} from "@agent-chassis/agent-launch-cli/src/lib/slice-review-materialization.mjs";
import {
  isPlainObject,
  SLICE_REVIEW_SURFACE_PREPARATION_SCHEMA_VERSION,
  WK_FORGE_HANDOFF_FAILURE_CATEGORIES
} from "@agent-chassis/agent-launch-cli/src/lib/trusted-operation-contracts.mjs";
import {
  defaultIntegrateManagedWorkerSlice,
  TERMINAL_REVIEW_EVIDENCE_COMPOSITIONS
} from "@agent-chassis/agent-launch-cli/src/lib/trusted-slice-integration.mjs";
import {
  integrateCommittedSlice
} from "@agent-chassis/agent-launch-cli/src/lib/slice-integration.mjs";
import {
  defaultWkForgeHandoff
} from "@agent-chassis/agent-launch-cli/src/lib/wk-forge-handoff.mjs";

import {
  evaluateWorkerAdmissionForBackend
} from "@agent-chassis/agent-launch-cli/src/lib/codex-worker-plan.mjs";

import {
  materializeTerminalReviewWorktree
} from "@agent-chassis/agent-launch-cli/src/lib/terminal-review-materialization.mjs";
import {
  runPostWorkerSliceLifecycle,
  TERMINAL_REVIEW_EVIDENCE_MODES
} from "./dispatch-run-monitor-routes.mjs";
import { WORKSPACE_CLOSED_INPUT_COMMIT_COMPOSITION } from "./workspace-commit-tool.mjs";
import {
  assertManagedStdioMcpCompositionAuthority,
  createManagedStdioMcpCompositionAuthority
} from "@agent-chassis/agent-launch-cli/src/lib/stdio-mcp-conduit-composition-compatibility.mjs";

import {
  buildAcceptSucceedCodexExecutorTestSeams,
  consumeDispatchCodexTestSeamEvidence,
  createAcceptStayRunningTestExecutor,
  createAcceptThenSucceedTestExecutor,
  createRefusingTestExecutor,
  createThrowingTestExecutor
} from "./dispatch-launch-test-seam-executors.mjs";

import {
  createTerminalCandidateCoordinator,
  projectAuthenticatedTerminalCandidateFailure,
  projectTerminalCandidateRecoveryReason
} from "./dispatch-terminal-candidate-runtime.mjs";

export { consumeDispatchCodexTestSeamEvidence };
export {
  createTerminalCandidateCoordinator,
  projectAuthenticatedTerminalCandidateFailure,
  projectTerminalCandidateRecoveryReason,
  projectTerminalWkCandidateFailure,
  TERMINAL_CANDIDATE_FAILURE_PROJECTION_SCHEMA_VERSION,
  TERMINAL_CANDIDATE_TYPED_FAILURE_MESSAGE,
  TERMINAL_CANDIDATE_UNKNOWN_FAILURE_MESSAGE
} from "./dispatch-terminal-candidate-runtime.mjs";

const SESSION_IDENTITY_SCHEMA_VERSION = "workspace-agent-dispatch-session-identity.v1";
const DISPATCH_CODEX_AUTHENTICATED_SMOKE_TIMEOUT_ENV_VAR =
  "WIKI_MCP_DISPATCH_CODEX_AUTHENTICATED_SMOKE_TIMEOUT_MS";

function selectDispatchLaunchExecutor(env = process.env, { createMcpConduit } = {}) {
  const fixture = String(env.WIKI_MCP_DISPATCH_BACKEND_TEST_FIXTURE ?? "").trim();
  if (fixture) {
    if (fixture === "accept_succeed") {
      return createAcceptThenSucceedTestExecutor();
    }
    if (fixture === "accept_running") {
      return createAcceptStayRunningTestExecutor();
    }
    if (fixture === "executor_refuses") {
      return createRefusingTestExecutor();
    }
    if (fixture === "executor_throws") {
      return createThrowingTestExecutor();
    }
    throw new Error(
      `Unsupported WIKI_MCP_DISPATCH_BACKEND_TEST_FIXTURE: ${fixture}. Expected accept_succeed, accept_running, executor_refuses, or executor_throws.`
    );
  }
  const seams = String(env.WIKI_MCP_DISPATCH_CODEX_EXECUTOR_SEAMS ?? "").trim();
  if (seams) {
    if (seams === "accept_succeed_test_seams") {
      return createProductionCodexDispatchExecutor(
        env,
        {
          ...buildAcceptSucceedCodexExecutorTestSeams(),
          createMcpConduit
        }
      );
    }
    throw new Error(
      `Unsupported WIKI_MCP_DISPATCH_CODEX_EXECUTOR_SEAMS: ${seams}. Expected accept_succeed_test_seams.`
    );
  }

  const killTimeoutMs = resolveAuthenticatedSmokeKillTimeoutMs(env);
  return createProductionCodexDispatchExecutor(env, {
    killTimeoutMs,
    createMcpConduit
  });
}

function createProductionCodexDispatchExecutor(env, options = {}) {
  return createCodexWorkspaceAgentLaunchExecutor({
    ...options,
    env,
    buildPlan: buildManagedWorkerGitlessCodexRolePlan,
    createMcpConduit: options.createMcpConduit
  });
}

async function buildManagedWorkerGitlessCodexRolePlan(input) {

  const { buildCodexRolePlan } = await import(
    "@agent-chassis/agent-launch-cli/src/commands/codex-role.mjs"
  );
  const plan = await buildCodexRolePlan(input);
  if (input?.role !== "worker" || input?.worker_scope_authority == null || plan?.mode === "refusal") {
    return plan;
  }
  const args = Array.isArray(plan?.args) ? [...plan.args] : null;
  if (args === null) {
    throw new Error("managed Codex worker plan must carry argv");
  }
  if (!args.includes("--skip-git-repo-check")) {
    const execIndex = args.indexOf("exec");
    if (execIndex < 0) {
      throw new Error("managed Codex worker plan must carry the exec subcommand");
    }

    args.splice(execIndex + 1, 0, "--skip-git-repo-check");
  }
  return { ...plan, args };
}

function resolveAuthenticatedSmokeKillTimeoutMs(env) {
  const raw = String(env[DISPATCH_CODEX_AUTHENTICATED_SMOKE_TIMEOUT_ENV_VAR] ?? "").trim();
  if (!raw) return null;
  const timeout = Number(raw);
  if (!Number.isInteger(timeout) || timeout < 1_000 || timeout > 300_000) {
    throw new Error(
      `${DISPATCH_CODEX_AUTHENTICATED_SMOKE_TIMEOUT_ENV_VAR} must be an integer in [1000, 300000]`
    );
  }

  return timeout;
}

function exactLifecycleTuple(request) {
  if (!request || typeof request !== "object" || Array.isArray(request) ||
      Object.keys(request).sort().join("\0") !==
        ["assigned_unit", "launch_ref", "retry_id", "run_id"].sort().join("\0") ||
      !/^WK-\d{4}#SLICE-\d{3}$/u.test(request.assigned_unit) ||
      typeof request.launch_ref !== "string" || request.launch_ref.length === 0 ||
      typeof request.run_id !== "string" || request.run_id.length === 0 ||
      !Number.isInteger(request.retry_id) || request.retry_id < 0) {
    throw new Error("trusted lifecycle operation requires the exact launcher tuple");
  }
  return Object.freeze({
    assigned_unit: request.assigned_unit,
    launch_ref: request.launch_ref,
    run_id: request.run_id,
    retry_id: request.retry_id
  });
}

export function validateSliceReviewPreparationResult(preparation, boundRequest) {
  return isPlainObject(preparation) &&
    preparation.schema_version === SLICE_REVIEW_SURFACE_PREPARATION_SCHEMA_VERSION &&
    preparation.assigned_unit === boundRequest.assigned_unit &&
    preparation.launch_ref === boundRequest.launch_ref &&
    preparation.run_id === boundRequest.run_id &&
    preparation.retry_id === boundRequest.retry_id;
}

export function createDirectSliceReviewPreparationAdapter(
  mainRepo,

  { prepareSurface = (args) => prepareSliceReviewSurface(args) } = {}
) {
  return async (request) => {
    const boundRequest = exactLifecycleTuple(request);
    const preparation = await prepareSurface({
      mainRepo,
      assignedUnit: boundRequest.assigned_unit,
      launchRef: boundRequest.launch_ref,
      runId: boundRequest.run_id,
      retryId: boundRequest.retry_id
    });
    if (!validateSliceReviewPreparationResult(preparation, boundRequest)) {
      throw new Error("direct slice-review preparation returned an invalid trusted result");
    }
    return { accepted: true, preparation };
  };
}

function createDirectSliceIntegrationAdapter({ mainRepo }) {
  return async (request) => {
    const boundRequest = exactLifecycleTuple(request);

    const integration = await defaultIntegrateManagedWorkerSlice({
      mainRepo,
      assignedUnit: boundRequest.assigned_unit,
      launchRef: boundRequest.launch_ref,
      runId: boundRequest.run_id,
      retryId: boundRequest.retry_id,
      terminalReviewEvidenceComposition:
        TERMINAL_REVIEW_EVIDENCE_COMPOSITIONS.LIVE_MATERIALIZER
    });
    if (!integration || integration.integrated !== true) {
      throw new Error("direct slice integration returned no successful trusted result");
    }

    return {
      accepted: true,
      integration: Object.freeze({
        ...integration,
        tuple: Object.freeze({ ...boundRequest })
      })
    };
  };
}

export function createCanonicalCommittedSliceIntegrationAdapter(mainRepo) {
  return async ({ context, boundaryAuthorization } = {}) => {
    const target = boundaryAuthorization?.target;
    if (context?.review_admission_kind !== "canonical_committed_slice" ||
        context.review_subject !== target?.subject ||
        context.committed_target_digest !== target?.committed_target_digest ||
        context.reviewed_sha !== target?.reviewed_sha ||
        context.diff_base_sha !== target?.diff_base_sha ||
        context.slice_ref !== target?.slice_ref) {
      throw new Error("canonical committed-slice integration binding is unavailable or mismatched");
    }
    const writeStatus = ({ unitAddress, status, expectedSourceDigest }) =>
      setWorkRecordStatusByUnit({
        dir: mainRepo,
        unitAddress,
        status,
        expectedSourceDigest
      });
    const writeRecordCas = ({ record, expectedSourceDigest }) =>
      writeValidatedWorkRecord({
        dir: mainRepo,
        record,
        expectedSourceDigest
      });
    return integrateCommittedSlice({
      mainRepo,
      worktreePath: context.worktree_path,
      unitAddress: `${context.initiative}/${context.record_id}/${context.review_slice_id}`,
      sliceRef: context.slice_ref,
      wkRef: `refs/heads/wk/${context.initiative}/${context.record_id}`,
      baseSha: context.diff_base_sha,
      commit: context.reviewed_sha,
      workerTerminated: false,
      transitionToReview: writeStatus,
      markSliceComplete: writeStatus,
      writeRecordCas,
      boundaryAuthorization
    });
  };
}

export function buildDispatchLaunchExecutors(env = process.env, {
  managedStdioMcpCompositionAuthority = createManagedStdioMcpCompositionAuthority()
} = {}) {
  const compositionAuthority = assertManagedStdioMcpCompositionAuthority(
    managedStdioMcpCompositionAuthority
  );

  const managedCreateMcpConduit = compositionAuthority.createConduit;
  const codexExecutor = selectDispatchLaunchExecutor(env, {
    createMcpConduit: managedCreateMcpConduit
  });

  return {
    codex: buildFamilyExecutorRegistryEntry({
      executor: codexExecutor,
      sourceReadMode: CODEX_FAMILY_SOURCE_READ_MODE,
      nativeReadCapability: CODEX_FAMILY_NATIVE_READ_CAPABILITY
    }),

    claude: buildFamilyExecutorRegistryEntry({
      executor: createClaudeWorkspaceAgentLaunchExecutor({
        env,
        createMcpConduit: managedCreateMcpConduit
      }),
      sourceReadMode: CLAUDE_FAMILY_SOURCE_READ_MODE,
      nativeReadCapability: CLAUDE_FAMILY_NATIVE_READ_CAPABILITY
    })
  };
}

function mintDispatchSessionIdentity() {

  return `${SESSION_IDENTITY_SCHEMA_VERSION}.${randomBytes(12).toString("hex")}`;
}

export const DISPATCH_WORKSPACE_IDENTITY_UNCANONICALIZABLE_CODE =
  "dispatch_workspace_identity_uncanonicalizable";

export function resolveDispatchWorktreeProvisioningConfig(env = process.env) {

  const mainRepo = String(env[WIKI_MCP_WORKSPACE_DIR_ENV_VAR] ?? "").trim();
  if (!mainRepo) {
    return null;
  }
  if (!path.isAbsolute(mainRepo)) {
    throw new Error(
      `${WIKI_MCP_WORKSPACE_DIR_ENV_VAR} must be absolute when ${WIKI_MCP_DISPATCH_WORKTREE_ROOT_ENV_VAR} is configured`
    );
  }

  let canonicalMainRepo;
  try {
    canonicalMainRepo = realpathSync(path.resolve(mainRepo));
    if (!statSync(canonicalMainRepo).isDirectory()) {
      throw Object.assign(new Error("not a directory"), { code: "ENOTDIR" });
    }
  } catch (error) {
    const failure = new Error(
      `${WIKI_MCP_WORKSPACE_DIR_ENV_VAR} must name an existing directory that canonicalizes to a real workspace root (${error?.code ?? error?.message ?? error})`
    );
    failure.code = DISPATCH_WORKSPACE_IDENTITY_UNCANONICALIZABLE_CODE;
    throw failure;
  }
  const launcherBase = path.dirname(canonicalMainRepo);
  const repoName = path.basename(canonicalMainRepo);
  const canonicalWorktreeRoot = path.join(launcherBase, ".agent-worktrees", repoName);
  const propagatedRoot = String(env[WIKI_MCP_DISPATCH_WORKTREE_ROOT_ENV_VAR] ?? "").trim();
  if (propagatedRoot && path.resolve(propagatedRoot) !== canonicalWorktreeRoot) {
    throw new Error(
      `${WIKI_MCP_DISPATCH_WORKTREE_ROOT_ENV_VAR} does not match the launcher-derived canonical root`
    );
  }

  return Object.freeze({
    mainRepo: canonicalMainRepo,
    worktreeRoot: canonicalWorktreeRoot,

    managedConfinementActivation: createManagedWorkerConfinementActivationBinding()
  });
}

export function resolveLauncherOwnedLifecycleDeps({
  worktreeProvisioning,
  directSliceIntegrationAdapter = null,
  hostSliceReviewPreparationAdapter,
  terminalCandidateCoordinator = null
} = {}) {

  if (worktreeProvisioning == null) {
    return {};
  }

  return {
    ...(directSliceIntegrationAdapter != null
      ? { hostSliceIntegrationAdapter: directSliceIntegrationAdapter }
      : {}),
    hostSliceReviewPreparationAdapter,
    terminalReviewEvidenceMode: TERMINAL_REVIEW_EVIDENCE_MODES.LIVE_MATERIALIZER,
    materializeTerminalReviewWorktree,
    ...(terminalCandidateCoordinator === null ? {} : {
      prepareTerminalCandidate: terminalCandidateCoordinator.prepareTerminalCandidate,
      validateTerminalCandidate: terminalCandidateCoordinator.validateTerminalCandidate
    })
  };
}

export function composePostWorkerSliceLifecycle({
  worktreeProvisioning,
  directSliceIntegrationAdapter = null,
  hostSliceReviewPreparationAdapter,
  terminalCandidateCoordinator = null,
  reviewEnforcementMode = "policy_only",
  lifecycle = runPostWorkerSliceLifecycle
} = {}) {
  const launcherOwned = resolveLauncherOwnedLifecycleDeps({
    worktreeProvisioning,
    directSliceIntegrationAdapter,
    hostSliceReviewPreparationAdapter,
    terminalCandidateCoordinator
  });
  const tierOwned = Object.freeze({ reviewEnforcementMode });

  return ({ workspace, status, deps = {} }) =>
    lifecycle({ workspace, status, deps: { ...deps, ...launcherOwned, ...tierOwned } });
}

const WK_FORGE_HANDOFF_REFUSAL_DETAIL_MAX_DEPTH = 3;
const WK_FORGE_HANDOFF_REFUSAL_DETAIL_MAX_KEYS = 24;
const WK_FORGE_HANDOFF_REFUSAL_DETAIL_MAX_ARRAY = 12;
const WK_FORGE_HANDOFF_REFUSAL_DETAIL_MAX_STRING = 512;
const WK_FORGE_HANDOFF_REFUSAL_SECRET_KEY =
  /(?:token|credential|password|secret|authorization|cookie|stderr|stdout|stack|message)/iu;

function boundedForgeRefusalValue(value, depth = 0) {
  if (depth > WK_FORGE_HANDOFF_REFUSAL_DETAIL_MAX_DEPTH) return null;
  if (typeof value === "string") return value.slice(0, WK_FORGE_HANDOFF_REFUSAL_DETAIL_MAX_STRING);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) {
    return value.slice(0, WK_FORGE_HANDOFF_REFUSAL_DETAIL_MAX_ARRAY)
      .map((entry) => boundedForgeRefusalValue(entry, depth + 1));
  }
  if (!isPlainObject(value)) return null;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !WK_FORGE_HANDOFF_REFUSAL_SECRET_KEY.test(key))
      .slice(0, WK_FORGE_HANDOFF_REFUSAL_DETAIL_MAX_KEYS)
      .map(([key, entry]) => [key, boundedForgeRefusalValue(entry, depth + 1)])
  );
}

export function projectWkForgeHandoffRefusal(outcome) {
  const categories = new Set(Object.values(WK_FORGE_HANDOFF_FAILURE_CATEGORIES));
  const category = categories.has(outcome?.category)
    ? outcome.category
    : WK_FORGE_HANDOFF_FAILURE_CATEGORIES.INDETERMINATE;
  const projected = boundedForgeRefusalValue(isPlainObject(outcome?.detail) ? outcome.detail : {});
  const reason = typeof projected?.reason === "string" && projected.reason.length > 0
    ? projected.reason
    : `wk_forge_handoff_${category}`;
  return Object.freeze({
    schema_version: "wk-forge-handoff-refusal.v1",
    code: category,
    category,
    reason,
    detail: Object.freeze({ category, ...projected })
  });
}

function projectAuthenticatedWkForgeRecoveryRefusal(outcome, error) {
  const refusal = projectWkForgeHandoffRefusal(outcome);
  return Object.freeze({
    ...refusal,
    detail: Object.freeze({
      ...refusal.detail,
      recovery_detail: projectAuthenticatedTerminalCandidateFailure(error)
    })
  });
}

export function buildDispatchRuntime(env = process.env, {
  registeredTier = "free_local",
  sliceIntegrationCcePolicy = null,
  wkForgeHandoffCcePolicy = null
} = {}) {

  void registeredTier;
  const dispatchSessionIdentity = mintDispatchSessionIdentity();
  const managedStdioMcpCompositionAuthority =
    createManagedStdioMcpCompositionAuthority();
  const launchExecutors = buildDispatchLaunchExecutors(env, {
    managedStdioMcpCompositionAuthority
  });

  const worktreeProvisioning = resolveDispatchWorktreeProvisioningConfig(env);

  const worktreeProvisioningConfig = worktreeProvisioning;
  const hostSliceReviewPreparationAdapter = worktreeProvisioning === null
    ? null
    : createDirectSliceReviewPreparationAdapter(worktreeProvisioning.mainRepo);
  const directSliceIntegrationAdapter =
    worktreeProvisioning !== null
      ? createDirectSliceIntegrationAdapter({
          mainRepo: worktreeProvisioning.mainRepo
        })
      : null;
  const canonicalCommittedSliceIntegration = worktreeProvisioning === null
    ? null
    : createCanonicalCommittedSliceIntegrationAdapter(worktreeProvisioning.mainRepo);
  const terminalCandidateCoordinator = worktreeProvisioning === null
    ? null
    : createTerminalCandidateCoordinator({
        mainRepo: worktreeProvisioning.mainRepo,
        worktreeRoot: worktreeProvisioning.worktreeRoot
      });
  const composedPostWorkerSliceLifecycle = composePostWorkerSliceLifecycle({
    worktreeProvisioning,
    directSliceIntegrationAdapter,
    hostSliceReviewPreparationAdapter,
    terminalCandidateCoordinator,

    reviewEnforcementMode: "policy_only",

    lifecycle: runPostWorkerSliceLifecycle
  });
  const dispatchBackend =
    launchExecutors && launchExecutors.codex
      ? createWorkspaceAgentDispatchBackend({
          launchExecutors,
          managedStdioMcpCompositionAuthority,
          requireManagedProvisioning: true,
          worktreeProvisioning: worktreeProvisioningConfig,
          closedInputCommitComposition: WORKSPACE_CLOSED_INPUT_COMMIT_COMPOSITION,
          postWorkerSliceLifecycle: composedPostWorkerSliceLifecycle,
          canonicalCommittedSliceIntegration,
          ...(terminalCandidateCoordinator === null
            ? {}
            : { recoverTerminalCandidate: terminalCandidateCoordinator.recoverTerminalCandidate }),

          sliceIntegrationCcePolicy,
          evaluateWorkerAdmission: evaluateWorkerAdmissionForBackend
        })
      : null;
  const wkForgeHandoffAdapter = worktreeProvisioning === null || dispatchBackend === null
    ? null
    : async ({ assigned_unit: assignedUnit }) => {
        let outcome;
        try {
          outcome = await defaultWkForgeHandoff({
            mainRepo: worktreeProvisioning.mainRepo,
            assignedUnit,
            deps: {
              resolveTerminalCandidatePublicationState: async (wkId) => {
                const retained = dispatchBackend.resolveTerminalCandidatePublicationState(wkId);
                if (retained !== null) return retained;
                const recovered = await terminalCandidateCoordinator.recoverTerminalCandidate(wkId);
                if (recovered === null) return null;
                return Object.freeze({
                  binding: recovered.binding,
                  materialization: recovered.materialization,
                  advisory_review_evidence: Object.freeze({
                    schema_version: "workspace-agent-terminal-review-advisory-evidence.v1",
                    authority: "advisory_only",
                    candidate_sha: recovered.binding.candidate,
                    base_sha: recovered.binding.base,
                    wk_sha: recovered.binding.wk_tip,
                    reviews: Object.freeze([]),
                    observation: "review_history_not_required_for_restart_recovery"
                  })
                });
              },

              forgeHandoffCcePolicy: wkForgeHandoffCcePolicy
            }
          });
        } catch (error) {
          outcome = {
            ok: false,
            category: WK_FORGE_HANDOFF_FAILURE_CATEGORIES.ELIGIBILITY,
            detail: {
              reason: projectTerminalCandidateRecoveryReason(error)
            }
          };
          return {
            accepted: false,
            refusal: projectAuthenticatedWkForgeRecoveryRefusal(outcome, error)
          };
        }
        return outcome?.ok === true
          ? { accepted: true, forge_handoff: outcome.result }
          : { accepted: false, refusal: projectWkForgeHandoffRefusal(outcome) };
      };
  return {
    dispatchBackend,
    dispatchSessionIdentity,
    wkForgeHandoffAdapter,
    runTerminalCandidateValidationForUnit:
      terminalCandidateCoordinator?.runTerminalCandidateValidationForUnit ?? null
  };
}
