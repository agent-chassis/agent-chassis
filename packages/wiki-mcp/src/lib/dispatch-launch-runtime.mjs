

import { randomBytes } from "node:crypto";
import {
  BACKEND_REFUSAL_CODES,
  createWorkspaceAgentDispatchBackend
} from "@agent-chassis/agent-launch-cli/src/lib/workspace-agent-dispatch-backend.mjs";
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
  createHostWriteAuthoritySubstrateAdapterIfBrokerReachable,
  resolveHostWriteAuthoritySidecarEndpoint
} from "@agent-chassis/agent-launch-cli/src/lib/host-write-authority-substrate.mjs";

import {
  evaluateWorkerAdmissionForBackend
} from "@agent-chassis/agent-launch-cli/src/lib/codex-worker-plan.mjs";
import {
  createLauncherOwnedSourceToolSurfacePreparer
} from "@agent-chassis/agent-launch-cli/src/lib/agent-backend.mjs";

const SESSION_IDENTITY_SCHEMA_VERSION = "workspace-agent-dispatch-session-identity.v1";

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
      return createCodexWorkspaceAgentLaunchExecutor(
        buildAcceptSucceedCodexExecutorTestSeams()
      );
    }
    throw new Error(
      `Unsupported WIKI_MCP_DISPATCH_CODEX_EXECUTOR_SEAMS: ${seams}. Expected accept_succeed_test_seams.`
    );
  }

  const hostWriteAuthority = resolveHostWriteAuthoritySubstrateAdapter(env);
  return createCodexWorkspaceAgentLaunchExecutor({ hostWriteAuthority });
}

function resolveHostWriteAuthoritySubstrateAdapter(env = process.env) {

  const endpoint = resolveHostWriteAuthoritySidecarEndpoint(env);
  if (endpoint === null) {
    return null;
  }
  return createHostWriteAuthoritySubstrateAdapterIfBrokerReachable({ endpoint });
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
    buildPlan: async (input) => ({
      mode: "executable",
      role: input?.role ?? "worker",
      subject: input?.subject ?? null,
      repo: input?.cwd ?? null,
      command: "codex",
      args: [],
      env: input?.env ?? {},
      preparedNewWriteRoots: []
    }),
    buildBwrapPlan: () => ({
      bwrapPath: "/test-seams/bwrap-not-invoked",
      argv: [],
      env: {}
    }),
    assertBwrap: () => {},
    ensureWriteRoots: async () => {},
    spawn: () => createCodexExecutorTestSeamChild()
  };
}

function createCodexExecutorTestSeamChild() {

  const listeners = { exit: [], error: [] };
  setImmediate(() => {
    for (const cb of listeners.exit) {
      try {
        cb(0, null);
      } catch {

      }
    }
  });
  return {
    pid: 0,
    on(event, cb) {
      if (event in listeners && typeof cb === "function") {
        listeners[event].push(cb);
      }
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

export function buildDispatchRuntime(env = process.env) {
  const dispatchSessionIdentity = mintDispatchSessionIdentity();
  const launchExecutors = buildDispatchLaunchExecutors(env);
  const dispatchBackend =
    launchExecutors && launchExecutors.codex
      ? createWorkspaceAgentDispatchBackend({
          launchExecutors,
          evaluateWorkerAdmission: evaluateWorkerAdmissionForBackend,
          prepareSourceToolSurface: createLauncherOwnedSourceToolSurfacePreparer({ env })
        })
      : null;
  return { dispatchBackend, dispatchSessionIdentity };
}
