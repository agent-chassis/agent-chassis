

import {
  BACKEND_REFUSAL_CODES
} from "@agent-chassis/agent-launch-cli/src/lib/workspace-agent-dispatch-backend.mjs";
import { spawn } from "node:child_process";
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

export function buildAcceptSucceedCodexExecutorTestSeams() {

  return {

    spawn: (plan) => {
      const childArgs = Array.isArray(plan?.childArgs) ? plan.childArgs : [];
      const child = createCodexExecutorTestSeamChild();
      let stdinClosed = false;
      dispatchCodexTestSeamEvidence.push(Object.freeze({
        repo: typeof plan?.repo === "string" ? plan.repo : null,
        cwd: typeof plan?.cwd === "string" ? plan.cwd : null,
        sparse_worker_namespace: plan?.sparseWorkerNamespace === null || plan?.sparseWorkerNamespace === undefined
          ? null
          : Object.freeze({
              authority: Object.freeze({
                read_scope: Object.freeze([...plan.sparseWorkerNamespace.authority.read_scope]),
                repo_paths: Object.freeze([...plan.sparseWorkerNamespace.authority.repo_paths]),
                write_scope: Object.freeze([...plan.sparseWorkerNamespace.authority.write_scope])
              }),
              readable: Object.freeze(plan.sparseWorkerNamespace.readable.map((entry) => entry.absolute)),
              writable: Object.freeze(plan.sparseWorkerNamespace.writable.map((entry) => entry.absolute))
            }),
        bwrap_args: Object.freeze(Array.isArray(plan?.bwrapArgs) ? [...plan.bwrapArgs] : []),
        writable_roots: Object.freeze(Array.isArray(plan?.writableRoots) ? [...plan.writableRoots] : []),
        writable_files: Object.freeze(Array.isArray(plan?.writableFiles)
          ? plan.writableFiles.map((entry) => Object.freeze({
              real: entry.real,
              precreated: entry.precreated
            }))
          : []),
        wiki_mcp_child_env: captureDispatchCodexTestWikiChildEnv(childArgs),
        close_stdin: () => {
          if (stdinClosed) return;
          stdinClosed = true;
          child.process.stdin.end();
        },
        terminal: child.terminal
      }));
      return child.process;
    }
  };
}

function createCodexExecutorTestSeamChild() {

  const child = spawn(process.execPath, ["-e", "process.stdin.resume();"], {
    stdio: ["pipe", "ignore", "ignore"]
  });
  const terminal = new Promise((resolve, reject) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
    child.once("error", reject);
  });
  return { process: child, terminal };
}

export function createAcceptThenSucceedTestExecutor() {

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

export function createAcceptStayRunningTestExecutor() {
  return () => ({
    accepted: true,
    status: "launching",
    probe() {
      return { status: "running" };
    }
  });
}

export function createRefusingTestExecutor() {
  return () => ({
    accepted: false,
    refusal: {
      code: BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
      reason: "test_fixture_executor_refused",
      detail: { fixture: "executor_refuses" }
    }
  });
}

export function createThrowingTestExecutor() {
  return () => {
    throw new Error("test fixture executor threw");
  };
}
