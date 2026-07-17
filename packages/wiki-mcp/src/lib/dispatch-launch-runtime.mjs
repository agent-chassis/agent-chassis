

import { randomBytes } from "node:crypto";
import path from "node:path";
import {
  BACKEND_REFUSAL_CODES,
  createManagedWorkerConfinementActivationBinding,
  createWorkspaceAgentDispatchBackend
} from "@agent-chassis/agent-launch-cli/src/lib/workspace-agent-dispatch-backend.mjs";
import {
  WIKI_MCP_ASSIGNED_UNIT_ENV_VAR,
  WIKI_MCP_COMMIT_LAUNCH_REF_ENV_VAR,
  WIKI_MCP_COMMIT_RETRY_ID_ENV_VAR,
  WIKI_MCP_COMMIT_RUN_ID_ENV_VAR,
  WIKI_MCP_DISPATCH_WORKTREE_ROOT_ENV_VAR,
  WIKI_MCP_RESPONSE_STATE_DIR_ENV_VAR,
  WIKI_MCP_TOOL_PROFILE_ENV_VAR,
  WIKI_MCP_WORKSPACE_ALIAS_ENV_VAR,
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
  createHostWriteAuthorityProvisioningAdapter,
  createHostWriteAuthorityIntegrationAdapter,
  createHostWriteAuthoritySubstrateAdapterIfBrokerReachable,
  resolveHostWriteAuthoritySidecarEndpoint
} from "@agent-chassis/agent-launch-cli/src/lib/host-write-authority-substrate.mjs";

import {
  evaluateWorkerAdmissionForBackend
} from "@agent-chassis/agent-launch-cli/src/lib/codex-worker-plan.mjs";
import {
  createLauncherOwnedSourceToolSurfacePreparer
} from "@agent-chassis/agent-launch-cli/src/lib/agent-backend.mjs";
import { runPostWorkerSliceLifecycle } from "./dispatch-run-monitor-routes.mjs";
import { WORKSPACE_CLOSED_INPUT_COMMIT_COMPOSITION } from "./workspace-commit-tool.mjs";

const SESSION_IDENTITY_SCHEMA_VERSION = "workspace-agent-dispatch-session-identity.v1";
const DISPATCH_CODEX_AUTHENTICATED_SMOKE_TIMEOUT_ENV_VAR =
  "WIKI_MCP_DISPATCH_CODEX_AUTHENTICATED_SMOKE_TIMEOUT_MS";
const dispatchCodexTestSeamEvidence = [];
const DISPATCH_CODEX_TEST_WIKI_CHILD_ENV_PREFIX = "mcp_servers.wiki.env.";
const DISPATCH_CODEX_TEST_WIKI_CHILD_ENV_ALLOWLIST = new Set([
  WIKI_MCP_WORKSPACE_ALIAS_ENV_VAR,
  WIKI_MCP_WORKSPACE_DIR_ENV_VAR,
  WIKI_MCP_DISPATCH_WORKTREE_ROOT_ENV_VAR,
  WIKI_MCP_RESPONSE_STATE_DIR_ENV_VAR,
  WIKI_MCP_TOOL_PROFILE_ENV_VAR,
  WIKI_MCP_ASSIGNED_UNIT_ENV_VAR,
  WIKI_MCP_COMMIT_LAUNCH_REF_ENV_VAR,
  WIKI_MCP_COMMIT_RUN_ID_ENV_VAR,
  WIKI_MCP_COMMIT_RETRY_ID_ENV_VAR
]);

export function consumeDispatchCodexTestSeamEvidence() {
  return dispatchCodexTestSeamEvidence.splice(0, dispatchCodexTestSeamEvidence.length);
}

function captureDispatchCodexTestWikiChildEnv(childArgs) {
  const wikiChildEnv = {};
  for (let index = 0; index < childArgs.length - 1; index += 1) {
    if (childArgs[index] !== "-c") continue;
    const override = childArgs[index + 1];
    index += 1;
    if (typeof override !== "string" ||
        !override.startsWith(DISPATCH_CODEX_TEST_WIKI_CHILD_ENV_PREFIX)) {
      continue;
    }
    const separator = override.indexOf("=", DISPATCH_CODEX_TEST_WIKI_CHILD_ENV_PREFIX.length);
    if (separator < 0) continue;
    const key = override.slice(DISPATCH_CODEX_TEST_WIKI_CHILD_ENV_PREFIX.length, separator);
    if (!DISPATCH_CODEX_TEST_WIKI_CHILD_ENV_ALLOWLIST.has(key)) continue;
    const value = JSON.parse(override.slice(separator + 1));
    if (typeof value !== "string") {
      throw new Error(`test seam wiki child environment ${key} must be a string`);
    }

    wikiChildEnv[key] = value;
  }
  return Object.freeze(wikiChildEnv);
}

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

function buildAcceptSucceedCodexExecutorTestSeams() {

  return {

    spawn: (plan) => {
      const childArgs = Array.isArray(plan?.childArgs) ? plan.childArgs : [];
      dispatchCodexTestSeamEvidence.push(Object.freeze({
        repo: typeof plan?.repo === "string" ? plan.repo : null,
        cwd: typeof plan?.cwd === "string" ? plan.cwd : null,
        wiki_mcp_child_env: captureDispatchCodexTestWikiChildEnv(childArgs)
      }));
      return createCodexExecutorTestSeamChild();
    }
  };
}

function createCodexExecutorTestSeamChild() {
  const listeners = { exit: [], error: [] };
  setImmediate(() => {
    for (const listener of listeners.exit) listener(0, null);
  });
  return {
    pid: 0,
    on(event, listener) {
      if (event in listeners && typeof listener === "function") listeners[event].push(listener);
    }
  };
}

function createAcceptThenSucceedTestExecutor() {

  return (input) => {
    let probeCallCount = 0;
    return {
      accepted: true,
      status: "launching",
      probe() {
        probeCallCount += 1;
        if (probeCallCount === 1) {
          return { status: "running" };
        }
        return {
          status: "succeeded",
          exit: { code: 0, signal: null, error: null }
        };
      },

      __test_observed: {
        caller_session_id: input?.caller_session_id ?? null,
        role: input?.role ?? null,
        subject: input?.subject ?? null
      }
    };
  };
}

function createAcceptStayRunningTestExecutor() {
  return () => ({
    accepted: true,
    status: "launching",
    probe() {
      return { status: "running" };
    }
  });
}

function createRefusingTestExecutor() {
  return () => ({
    accepted: false,
    refusal: {
      code: BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
      reason: "test_fixture_executor_refused",
      detail: { fixture: "executor_refuses" }
    }
  });
}

function createThrowingTestExecutor() {
  return () => {
    throw new Error("test fixture executor threw");
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

export function buildDispatchRuntime(env = process.env) {
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
  const composedPostWorkerSliceLifecycle = hostSliceIntegrationAdapter === null
    ? runPostWorkerSliceLifecycle
    : ({ workspace, status, deps = {} }) => runPostWorkerSliceLifecycle({
        workspace,
        status,
        deps: { ...deps, hostSliceIntegrationAdapter }
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
  return { dispatchBackend, dispatchSessionIdentity };
}
