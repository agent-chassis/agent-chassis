

import { randomBytes } from "node:crypto";
import path from "node:path";
import {
  computeWorkRecordSourceDigest,
  projectSliceReviewReceiptContracts,
  setWorkRecordStatusByUnit
} from "../../../wiki-core/src/index.mjs";
import {
  evaluateWorkRecordParentLifecycleContract
} from "../../../wiki-core/src/lib/work-record-parent-lifecycle-contract.mjs";
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
  materializeTerminalCandidateCheckout,
  materializeTerminalReviewWorktree
} from "@agent-chassis/agent-launch-cli/src/lib/terminal-review-materialization.mjs";
import {
  constructTerminalWkCandidate,
  deriveTerminalCandidateCurrentRef,
  deriveRecoveredTerminalWkCandidateIdentity,
  defaultTerminalCandidateRunGit,
  freezeRecoveredTerminalWkCandidateInputs,
  freezeTerminalWkCandidateInputs,
  projectTerminalWkCandidateFailure,
  readTerminalCandidateCurrentRef,
  verifyTerminalWkCandidateObjectBinding
} from "@agent-chassis/agent-launch-cli/src/lib/terminal-wk-candidate.mjs";
import {
  runAllTerminalCandidateValidations,
  runTerminalCandidateValidation,
  verifyTerminalCandidateDependencies
} from "@agent-chassis/agent-launch-cli/src/lib/terminal-wk-candidate-validation.mjs";
import {
  runPostWorkerSliceLifecycle,
  TERMINAL_REVIEW_EVIDENCE_MODES
} from "./dispatch-run-monitor-routes.mjs";
import { WORKSPACE_CLOSED_INPUT_COMMIT_COMPOSITION } from "./workspace-commit-tool.mjs";
import { createStdioMcpConduit } from "@agent-chassis/agent-launch-cli/src/lib/stdio-mcp-conduit.mjs";

import {
  buildAcceptSucceedCodexExecutorTestSeams,
  consumeDispatchCodexTestSeamEvidence,
  createAcceptStayRunningTestExecutor,
  createAcceptThenSucceedTestExecutor,
  createRefusingTestExecutor,
  createThrowingTestExecutor
} from "./dispatch-launch-test-seam-executors.mjs";

export { consumeDispatchCodexTestSeamEvidence };

const SESSION_IDENTITY_SCHEMA_VERSION = "workspace-agent-dispatch-session-identity.v1";
const DISPATCH_CODEX_AUTHENTICATED_SMOKE_TIMEOUT_ENV_VAR =
  "WIKI_MCP_DISPATCH_CODEX_AUTHENTICATED_SMOKE_TIMEOUT_MS";

function selectDispatchLaunchExecutor(env = process.env) {
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
        buildAcceptSucceedCodexExecutorTestSeams()
      );
    }
    throw new Error(
      `Unsupported WIKI_MCP_DISPATCH_CODEX_EXECUTOR_SEAMS: ${seams}. Expected accept_succeed_test_seams.`
    );
  }

  const killTimeoutMs = resolveAuthenticatedSmokeKillTimeoutMs(env);
  return createProductionCodexDispatchExecutor(env, { killTimeoutMs });
}

function createProductionCodexDispatchExecutor(env, options = {}) {
  return createCodexWorkspaceAgentLaunchExecutor({
    ...options,
    env,
    buildPlan: buildManagedWorkerGitlessCodexRolePlan,
    createMcpConduit: createStdioMcpConduit
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
      boundaryAuthorization
    });
  };
}

export function buildDispatchLaunchExecutors(env = process.env) {
  const codexExecutor = selectDispatchLaunchExecutor(env);

  return {
    codex: buildFamilyExecutorRegistryEntry({
      executor: codexExecutor,
      sourceReadMode: CODEX_FAMILY_SOURCE_READ_MODE,
      nativeReadCapability: CODEX_FAMILY_NATIVE_READ_CAPABILITY
    }),

    claude: buildFamilyExecutorRegistryEntry({
      executor: createClaudeWorkspaceAgentLaunchExecutor({ env }),
      sourceReadMode: CLAUDE_FAMILY_SOURCE_READ_MODE,
      nativeReadCapability: CLAUDE_FAMILY_NATIVE_READ_CAPABILITY
    })
  };
}

function mintDispatchSessionIdentity() {

  return `${SESSION_IDENTITY_SCHEMA_VERSION}.${randomBytes(12).toString("hex")}`;
}

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

  const canonicalMainRepo = path.resolve(mainRepo);
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

function exactWkBoundContract({ recordId, initiative = null, mainRepo, wkSha }) {
  let record;
  try {
    const result = defaultTerminalCandidateRunGit({
      repo: mainRepo,
      args: ["show", `${wkSha}:wiki/work-records/${recordId}.json`],
      env: null
    });
    if (!result || result.ok !== true) {
      throw new Error("exact WK record blob is unavailable");
    }
    record = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`terminal candidate exact WK-bound contract is not parseable: ${error?.message ?? String(error)}`);
  }
  if (record?.id !== recordId || !/^IN-\d{4}$/u.test(record?.initiative ?? "") ||
      (initiative !== null && record.initiative !== initiative)) {
    throw new Error("terminal candidate exact WK-bound contract identity disagrees");
  }
  const allowed = Array.isArray(record?.sections?.structured_validation?.allowed)
    ? record.sections.structured_validation.allowed
    : [];
  const targets = allowed
    .filter((entry) => entry?.command === "node_test" && typeof entry.target === "string")
    .map((entry) => entry.target);
  const parentLifecycle = evaluateWorkRecordParentLifecycleContract(record);
  let reviewUnit = null;
  if (parentLifecycle.complete === true) {
    const slice = parentLifecycle.terminal_review_contract_unit;
    const contracts = projectSliceReviewReceiptContracts(record, slice.id);
    if (contracts.slice_review_contract !== null) {
      reviewUnit = Object.freeze({
        record_id: recordId,
        slice_id: slice.id,
        subject: `${recordId}#${slice.id}`,
        initiative: record.initiative,
        parent_status: record.status ?? null,
        canonical_parent_wk_contract: contracts.canonical_parent_wk_contract,
        review_unit_contract: contracts.slice_review_contract
      });
    }
  }
  return Object.freeze({
    initiative: record.initiative,
    digest: computeWorkRecordSourceDigest(record),
    targets: Object.freeze([...new Set(targets)].sort()),
    review_unit: reviewUnit
  });
}

function failTerminalCandidateRecovery(reason, cause = null) {
  const error = new Error(reason);
  error.code = reason;
  if (cause !== null) error.cause = cause;
  throw error;
}

function failTerminalCandidateConstruction(failure) {
  const error = new Error(failure.message || "terminal_candidate_recovery_construction_failed");
  error.code = "terminal_candidate_recovery_construction_failed";
  error.terminal_candidate_failure = failure;
  throw error;
}

export function createTerminalCandidateCoordinator({
  mainRepo,
  worktreeRoot,

  runGit = defaultTerminalCandidateRunGit
} = {}) {
  if (typeof mainRepo !== "string" || !path.isAbsolute(mainRepo) ||
      typeof worktreeRoot !== "string" || !path.isAbsolute(worktreeRoot) ||
      typeof runGit !== "function") {
    throw new Error("terminal candidate coordinator requires launcher-owned repository and worktree roots");
  }
  const cycles = new Map();

  const prepareTerminalCandidate = async ({ integration, reviewUnit, wkId, wkRef, baseSha, baseRef = "main" }) => {
    if (integration?.wk_ref !== wkRef || integration?.wk_sha == null || reviewUnit?.record_id !== wkId) {
      throw new Error("terminal candidate preparation does not match the exact integrated WK identity");
    }

    if (typeof baseSha !== "string" || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(baseSha)) {
      throw new Error("terminal candidate preparation requires the launcher-bound WK lifecycle base");
    }
    const canonical = exactWkBoundContract({
      recordId: reviewUnit.record_id,
      initiative: reviewUnit.initiative,
      mainRepo,
      wkSha: integration.wk_sha
    });
    const frozen = freezeTerminalWkCandidateInputs({
      mainRepo,
      baseSha,
      baseRef,
      wkRef,
      canonicalWkId: wkId,
      canonicalWkDigest: canonical.digest,
      runGit
    });
    if (frozen.wk_tip !== integration.wk_sha) {
      throw new Error("terminal candidate frozen WK tip disagrees with final integration");
    }
    const binding = constructTerminalWkCandidate({ frozen, runGit });
    const candidateRoot = path.join(worktreeRoot, ".terminal-candidates", wkId, binding.candidate);
    const materialization = materializeTerminalCandidateCheckout({
      binding,
      candidateRoot,
      runGit
    });
    const dependencyProof = verifyTerminalCandidateDependencies({ binding, materialization });
    const state = Object.freeze({
      binding,
      materialization,
      dependency_proof: dependencyProof,
      review_unit: canonical.review_unit,
      canonical_targets: canonical.targets,
      validation_runtime_root: path.join(worktreeRoot, ".terminal-validation", wkId, binding.candidate)
    });
    cycles.set(wkId, state);
    return state;
  };

  const recoverTerminalCandidate = async (wkId) => {
    if (typeof wkId !== "string" || !/^WK-\d{4}$/u.test(wkId)) return null;
    const currentRef = deriveTerminalCandidateCurrentRef({ canonicalWkId: wkId });
    let candidate;
    try {
      candidate = readTerminalCandidateCurrentRef({
        mainRepo,
        canonicalWkId: wkId,
        runGit
      });
    } catch (error) {
      failTerminalCandidateRecovery("terminal_candidate_recovery_current_ref_unreadable", error);
    }
    let recoveredCanonical;
    let derived;
    try {
      if (candidate === null) {

        failTerminalCandidateRecovery("terminal_candidate_recovery_current_ref_absent");
      } else {
        recoveredCanonical = exactWkBoundContract({
          recordId: wkId,
          mainRepo,
          wkSha: candidate
        });
        if (recoveredCanonical.review_unit === null) {
          failTerminalCandidateRecovery("terminal_candidate_recovery_canonical_wk_binding_disagrees");
        }
        const wkRef = `refs/heads/wk/${recoveredCanonical.initiative}/${wkId}`;
        const frozen = freezeRecoveredTerminalWkCandidateInputs({
          mainRepo,
          wkRef,
          canonicalWkId: wkId,
          candidate,
          runGit
        });
        derived = deriveRecoveredTerminalWkCandidateIdentity({
          frozen,
          runGit
        });
      }
    } catch (error) {
      if (typeof error?.code === "string" &&
          (error.code.startsWith("terminal_candidate_recovery_") ||
            error.code.startsWith("terminal_candidate_construction_"))) {
        throw error;
      }

      failTerminalCandidateConstruction(projectTerminalWkCandidateFailure(error));
    }
    if (derived.candidate !== candidate || derived.candidate_ref !== currentRef) {
      failTerminalCandidateRecovery("terminal_candidate_recovery_no_deterministic_match");
    }
    const binding = Object.freeze({
      ...derived,
      candidate_ref_state: derived.candidate_ref_state === "derived"
        ? "recovered"
        : derived.candidate_ref_state
    });
    verifyTerminalWkCandidateObjectBinding({
      binding,
      runGit
    });
    const candidateRoot = path.join(worktreeRoot, ".terminal-candidates", wkId, binding.candidate);
    const materialization = materializeTerminalCandidateCheckout({
      binding,
      candidateRoot,
      runGit
    });
    const dependencyProof = verifyTerminalCandidateDependencies({ binding, materialization });
    const recoveredState = {
      binding,
      materialization,
      dependency_proof: dependencyProof,
      review_unit: recoveredCanonical.review_unit,
      canonical_targets: recoveredCanonical.targets,
      validation_runtime_root: path.join(worktreeRoot, ".terminal-validation", wkId, binding.candidate)
    };
    const validations = await runAllTerminalCandidateValidations({
      binding,
      materialization,
      targets: recoveredState.canonical_targets,
      runtimeRoot: recoveredState.validation_runtime_root,
      runGit
    });
    if (!Array.isArray(validations)) {
      failTerminalCandidateRecovery("terminal_candidate_recovery_validation_evidence_unavailable");
    }
    verifyTerminalWkCandidateObjectBinding({
      binding,
      runGit
    });
    const state = Object.freeze({
      ...recoveredState,
      validation_evidence: Object.freeze([...validations])
    });
    cycles.set(wkId, state);
    return state;
  };

  const validateTerminalCandidate = async ({ terminalCandidate }) => runAllTerminalCandidateValidations({
    binding: terminalCandidate.binding,
    materialization: terminalCandidate.materialization,
    targets: terminalCandidate.canonical_targets,
    runtimeRoot: terminalCandidate.validation_runtime_root,
    runGit
  });

  const runTerminalCandidateValidationForUnit = async ({ unit, target }) => {
    const state = cycles.get(unit) ?? null;
    if (state === null) return null;
    if (!state.canonical_targets.includes(target)) {
      throw new Error("terminal candidate target is not present in the frozen canonical whole-WK contract");
    }
    return runTerminalCandidateValidation({
      binding: state.binding,
      materialization: state.materialization,
      target,
      runtimeRoot: state.validation_runtime_root,
      runGit
    });
  };

  return Object.freeze({
    prepareTerminalCandidate,
    validateTerminalCandidate,
    recoverTerminalCandidate,
    runTerminalCandidateValidationForUnit,
    resolve: (wkId) => cycles.get(wkId) ?? null
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

export function buildDispatchRuntime(env = process.env, {
  registeredTier = "free_local",
  sliceIntegrationCcePolicy = null,
  wkForgeHandoffCcePolicy = null
} = {}) {

  void registeredTier;
  const dispatchSessionIdentity = mintDispatchSessionIdentity();
  const launchExecutors = buildDispatchLaunchExecutors(env);

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
              reason: typeof error?.code === "string" &&
                  error.code.startsWith("terminal_candidate_recovery_")
                ? error.code
                : "terminal_candidate_recovery_failed"
            }
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
