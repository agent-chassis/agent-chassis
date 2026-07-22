

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
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
  CODEX_FAMILY_SOURCE_READ_MODE
} from "@agent-chassis/agent-launch-cli/src/lib/workspace-agent-dispatch-codex-executor.mjs";
import {
  createAgyWorkspaceAgentLaunchExecutor,
  AGY_FAMILY_SOURCE_READ_MODE,
  AGY_FAMILY_NATIVE_READ_CAPABILITY
} from "@agent-chassis/agent-launch-cli/src/lib/workspace-agent-dispatch-agy-executor.mjs";
import {
  createClaudeWorkspaceAgentLaunchExecutor,
  CLAUDE_FAMILY_SOURCE_READ_MODE,
  CLAUDE_FAMILY_NATIVE_READ_CAPABILITY
} from "@agent-chassis/agent-launch-cli/src/lib/workspace-agent-dispatch-claude-executor.mjs";

import {
  buildFamilyExecutorRegistryEntry
} from "@agent-chassis/agent-launch-cli/src/lib/workspace-agent-launch-adapter-contract.mjs";
import {
  createHostWriteAuthorityBrokerChannel,
  buildHostWriteAuthorityPrepareSliceReviewSurfaceRequest,
  createHostWriteAuthorityProvisioningAdapter,
  createHostWriteAuthoritySliceReviewPreparationAdapter,
  createHostWriteAuthorityIntegrationAdapter,
  createHostWriteAuthorityWkForgeHandoffAdapter,
  createHostWriteAuthoritySubstrateAdapterIfBrokerReachable,
  resolveHostWriteAuthoritySidecarEndpoint,
  isCompletePrepareSliceReviewSurfaceRequestIdentity,
  validateSliceReviewSurfacePreparationResult,
  isCompleteIntegrateSliceRequestIdentity,
  buildHostWriteAuthorityIntegrateSliceRequest,
  defaultIntegrateManagedWorkerSlice,
  TERMINAL_REVIEW_EVIDENCE_COMPOSITIONS
} from "@agent-chassis/agent-launch-cli/src/lib/host-write-authority-substrate.mjs";
import {
  prepareSliceReviewSurface
} from "@agent-chassis/agent-launch-cli/src/lib/host-write-authority-substrate/slice-review-materialization.mjs";

import {
  evaluateWorkerAdmissionForBackend
} from "@agent-chassis/agent-launch-cli/src/lib/codex-worker-plan.mjs";
import {
  createLauncherOwnedSourceToolSurfacePreparer
} from "@agent-chassis/agent-launch-cli/src/lib/agent-backend.mjs";

import {
  materializeTerminalReviewWorktree
} from "@agent-chassis/agent-launch-cli/src/lib/host-write-authority-substrate/terminal-review-materialization.mjs";
import {
  runPostWorkerSliceLifecycle,
  TERMINAL_REVIEW_EVIDENCE_MODES
} from "./dispatch-run-monitor-routes.mjs";
import { WORKSPACE_CLOSED_INPUT_COMMIT_COMPOSITION } from "./workspace-commit-tool.mjs";

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

  const hostWriteAuthority = resolveHostWriteAuthoritySubstrateAdapter(env);
  const killTimeoutMs = resolveAuthenticatedSmokeKillTimeoutMs(env);
  return createProductionCodexDispatchExecutor(env, { hostWriteAuthority, killTimeoutMs });
}

function createProductionCodexDispatchExecutor(env, options = {}) {
  return createCodexWorkspaceAgentLaunchExecutor({
    ...options,
    env,
    buildPlan: buildManagedWorkerGitlessCodexRolePlan
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

function resolveHostWriteAuthoritySubstrateAdapter(env = process.env) {

  const endpoint = resolveHostWriteAuthoritySidecarEndpoint(env);
  if (endpoint === null) {
    return null;
  }
  return createHostWriteAuthoritySubstrateAdapterIfBrokerReachable({ endpoint });
}

export function resolveHostWriteAuthorityProvisioningAdapter(env = process.env) {
  const endpoint = resolveHostWriteAuthoritySidecarEndpoint(env);
  if (endpoint === null) {
    return null;
  }
  const channel = createHostWriteAuthorityBrokerChannel({ endpoint });
  return createHostWriteAuthorityProvisioningAdapter({ channel });
}

export function resolveHostWriteAuthorityIntegrationAdapter(env = process.env) {
  const endpoint = resolveHostWriteAuthoritySidecarEndpoint(env);
  if (endpoint === null) {
    return null;
  }
  const channel = createHostWriteAuthorityBrokerChannel({ endpoint });
  return createHostWriteAuthorityIntegrationAdapter({ channel });
}

export function resolveHostWriteAuthoritySliceReviewPreparationAdapter(env = process.env) {
  const endpoint = resolveHostWriteAuthoritySidecarEndpoint(env);
  if (endpoint === null) return null;
  const channel = createHostWriteAuthorityBrokerChannel({ endpoint });
  return createHostWriteAuthoritySliceReviewPreparationAdapter({ channel });
}

export function resolveHostWriteAuthorityWkForgeHandoffAdapter(env = process.env) {
  const endpoint = resolveHostWriteAuthoritySidecarEndpoint(env);
  if (endpoint === null) return null;
  const channel = createHostWriteAuthorityBrokerChannel({ endpoint });
  return createHostWriteAuthorityWkForgeHandoffAdapter({ channel });
}

function createDirectSliceReviewPreparationAdapter(mainRepo) {
  return async (request) => {
    if (!isCompletePrepareSliceReviewSurfaceRequestIdentity(request)) {
      throw new Error("direct slice-review preparation requires the exact launcher tuple");
    }
    const boundRequest = buildHostWriteAuthorityPrepareSliceReviewSurfaceRequest(request);
    const preparation = await prepareSliceReviewSurface({
      mainRepo,
      assignedUnit: boundRequest.assigned_unit,
      launchRef: boundRequest.launch_ref,
      runId: boundRequest.run_id,
      retryId: boundRequest.retry_id
    });
    const result = validateSliceReviewSurfacePreparationResult(preparation, boundRequest);
    if (!result.ok) {
      throw new Error("direct slice-review preparation returned an invalid trusted result");
    }
    return { accepted: true, preparation };
  };
}

function createDirectSliceIntegrationAdapter({ mainRepo, reviewEnforcementMode }) {
  return async (request) => {
    if (!isCompleteIntegrateSliceRequestIdentity(request)) {
      throw new Error("direct slice integration requires the exact launcher tuple");
    }
    const boundRequest = buildHostWriteAuthorityIntegrateSliceRequest(request);

    const integration = await defaultIntegrateManagedWorkerSlice({
      mainRepo,
      assignedUnit: boundRequest.assigned_unit,
      launchRef: boundRequest.launch_ref,
      runId: boundRequest.run_id,
      retryId: boundRequest.retry_id,
      reviewEnforcementMode,
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

export function buildDispatchLaunchExecutors(env = process.env) {
  const codexExecutor = selectDispatchLaunchExecutor(env);

  const hostWriteAuthority = resolveHostWriteAuthoritySubstrateAdapter(env);

  return {
    codex: buildFamilyExecutorRegistryEntry({
      executor: codexExecutor,
      sourceReadMode: CODEX_FAMILY_SOURCE_READ_MODE
    }),

    claude: buildFamilyExecutorRegistryEntry({
      executor: createClaudeWorkspaceAgentLaunchExecutor({ hostWriteAuthority }),
      sourceReadMode: CLAUDE_FAMILY_SOURCE_READ_MODE,
      nativeReadCapability: CLAUDE_FAMILY_NATIVE_READ_CAPABILITY
    }),
    agy: buildFamilyExecutorRegistryEntry({
      executor: createAgyWorkspaceAgentLaunchExecutor({ hostWriteAuthority }),
      sourceReadMode: AGY_FAMILY_SOURCE_READ_MODE,
      nativeReadCapability: AGY_FAMILY_NATIVE_READ_CAPABILITY
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

export function resolveLauncherOwnedLifecycleDeps({
  worktreeProvisioning,

  hostSliceIntegrationAdapter,

  directSliceIntegrationAdapter = null,
  hostSliceReviewPreparationAdapter
} = {}) {

  if (worktreeProvisioning == null) {
    return hostSliceIntegrationAdapter == null && hostSliceReviewPreparationAdapter == null
      ? {}
      : { hostSliceIntegrationAdapter, hostSliceReviewPreparationAdapter };
  }

  if (hostSliceIntegrationAdapter != null) {
    return {
      hostSliceIntegrationAdapter,
      hostSliceReviewPreparationAdapter,
      terminalReviewEvidenceMode: TERMINAL_REVIEW_EVIDENCE_MODES.TRANSPORTED_ATTESTATION
    };
  }

  return {
    ...(directSliceIntegrationAdapter != null
      ? { hostSliceIntegrationAdapter: directSliceIntegrationAdapter }
      : {}),
    hostSliceReviewPreparationAdapter,
    terminalReviewEvidenceMode: TERMINAL_REVIEW_EVIDENCE_MODES.LIVE_MATERIALIZER,
    materializeTerminalReviewWorktree
  };
}

export function composePostWorkerSliceLifecycle({
  worktreeProvisioning,
  hostSliceIntegrationAdapter,
  directSliceIntegrationAdapter = null,
  hostSliceReviewPreparationAdapter,
  reviewEnforcementMode = "enforced_cce",
  lifecycle = runPostWorkerSliceLifecycle
} = {}) {
  const launcherOwned = resolveLauncherOwnedLifecycleDeps({
    worktreeProvisioning,
    hostSliceIntegrationAdapter,
    directSliceIntegrationAdapter,
    hostSliceReviewPreparationAdapter
  });
  const tierOwned = Object.freeze({ reviewEnforcementMode });

  return ({ workspace, status, deps = {} }) =>
    lifecycle({ workspace, status, deps: { ...deps, ...launcherOwned, ...tierOwned } });
}

export function reviewEnforcementModeForRegisteredTier(registeredTier) {
  return registeredTier === "paid_cce" ? "enforced_cce" : "policy_only";
}

export function buildDispatchRuntime(env = process.env, { registeredTier = "free_local" } = {}) {
  const dispatchSessionIdentity = mintDispatchSessionIdentity();
  const launchExecutors = buildDispatchLaunchExecutors(env);

  const worktreeProvisioning = resolveDispatchWorktreeProvisioningConfig(env);

  const hostProvisioningAdapter =
    worktreeProvisioning === null ? null : resolveHostWriteAuthorityProvisioningAdapter(env);
  const worktreeProvisioningConfig =
    worktreeProvisioning !== null && hostProvisioningAdapter !== null
      ? Object.freeze({ ...worktreeProvisioning, hostProvisioningAdapter })
      : worktreeProvisioning;

  const hostSliceIntegrationAdapter =
    worktreeProvisioning === null ? null : resolveHostWriteAuthorityIntegrationAdapter(env);
  const brokerSliceReviewPreparationAdapter = worktreeProvisioning === null
    ? null
    : resolveHostWriteAuthoritySliceReviewPreparationAdapter(env);
  const hostSliceReviewPreparationAdapter = worktreeProvisioning === null
    ? null
    : brokerSliceReviewPreparationAdapter ??
      createDirectSliceReviewPreparationAdapter(worktreeProvisioning.mainRepo);

  const composedReviewEnforcementMode = reviewEnforcementModeForRegisteredTier(registeredTier);
  const directSliceIntegrationAdapter =
    worktreeProvisioning !== null && hostSliceIntegrationAdapter === null
      ? createDirectSliceIntegrationAdapter({
          mainRepo: worktreeProvisioning.mainRepo,
          reviewEnforcementMode: composedReviewEnforcementMode
        })
      : null;
  const composedPostWorkerSliceLifecycle = composePostWorkerSliceLifecycle({
    worktreeProvisioning,
    hostSliceIntegrationAdapter,
    directSliceIntegrationAdapter,
    hostSliceReviewPreparationAdapter,
    reviewEnforcementMode: composedReviewEnforcementMode,

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
          evaluateWorkerAdmission: evaluateWorkerAdmissionForBackend,
          prepareSourceToolSurface: createLauncherOwnedSourceToolSurfacePreparer({
            env,
            launcherAuthorityWorkspaceDir: worktreeProvisioning?.mainRepo ?? null
          })
        })
      : null;

  const wkForgeHandoffAdapter = resolveHostWriteAuthorityWkForgeHandoffAdapter(env);
  return { dispatchBackend, dispatchSessionIdentity, wkForgeHandoffAdapter };
}
