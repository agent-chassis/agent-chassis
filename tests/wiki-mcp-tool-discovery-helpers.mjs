import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const WORKSPACE_REPO_ENV_KEYS = [
  "WIKI_MCP_WORKSPACE_ALIAS",
  "WIKI_MCP_WORKSPACE_DIR",
  "WIKI_MCP_REPOS",
  "WIKI_MCP_DEFAULT_REPO"
];

function scrubNodeTestEnv(env) {
  for (const key of Object.keys(env)) {
    if (key.startsWith("NODE_TEST")) {
      delete env[key];
    }
  }
}

function scrubAmbientWorkspaceRepoEnv(env) {
  for (const key of WORKSPACE_REPO_ENV_KEYS) {
    delete env[key];
  }
}

export const INITIALIZE_PARAMS = {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: {
    name: "agent-chassis-test",
    version: "1.0.0"
  }
};

export function createMcpSession({
  env = {},
  prelude = "",
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  serverArgs = ["packages/wiki-mcp/src/server.mjs"]
} = {}) {
  const sessionEnv = { ...process.env };
  scrubNodeTestEnv(sessionEnv);
  scrubAmbientWorkspaceRepoEnv(sessionEnv);

  if (!("NODE_ENGINE_API_KEY" in env)) {
    sessionEnv.NODE_ENGINE_API_KEY = "wiki-mcp-test-paid-key";
  }
  Object.assign(sessionEnv, env);

  const child = spawn("node", serverArgs, {
    cwd: repoRoot,
    env: sessionEnv,
    stdio: ["pipe", "pipe", "pipe"]
  });
  let buffer = "";
  let errorBuffer = "";
  let exitFailure = null;
  let closePromise = null;
  const pending = new Map();

  const exitPromise = new Promise((resolve) => {
    child.once("error", (error) => {
      exitFailure = error;
      rejectPending(exitFailure);
      resolve({ code: child.exitCode, signal: child.signalCode, error });
    });

    child.once("exit", (code, signal) => {
      exitFailure = new Error(
        `MCP server exited unexpectedly (code ${code ?? "null"}, signal ${signal ?? "null"}): ${
          errorBuffer || "no stderr"
        }`
      );
      rejectPending(exitFailure);
      resolve({ code, signal, error: null });
    });
  });

  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    drainBuffer();
  });

  child.stderr.on("data", (chunk) => {
    errorBuffer += chunk.toString("utf8");
  });

  function rejectPending(error) {
    for (const { reject } of pending.values()) {
      reject(error);
    }
    pending.clear();
  }

  function drainBuffer() {
    while (true) {
      const lineEnd = buffer.indexOf("\n");
      if (lineEnd === -1) {
        return;
      }

      const body = buffer.slice(0, lineEnd).replace(/\r$/, "");
      buffer = buffer.slice(lineEnd + 1);
      if (!body) {
        continue;
      }

      let message;
      try {
        message = JSON.parse(body);
      } catch (error) {
        rejectPending(error);
        continue;
      }
      if (!("id" in message)) {
        continue;
      }

      const pendingRequest = pending.get(message.id);
      if (!pendingRequest) {
        continue;
      }
      pending.delete(message.id);

      if (message.error) {
        pendingRequest.reject(new Error(message.error.message));
        continue;
      }

      pendingRequest.resolve(message.result);
    }
  }

  function request(id, method, params = {}) {
    if (exitFailure) {
      return Promise.reject(exitFailure);
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      return Promise.reject(
        new Error(
          `MCP server exited unexpectedly (code ${child.exitCode ?? "null"}, signal ${
            child.signalCode ?? "null"
          }): ${errorBuffer || "no stderr"}`
        )
      );
    }

    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params
    });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`MCP request ${method} timed out after ${requestTimeoutMs}ms`));
      }, requestTimeoutMs);
      const settle = (fn, value) => {
        clearTimeout(timeout);
        fn(value);
      };
      pending.set(id, {
        resolve: (value) => settle(resolve, value),
        reject: (error) => settle(reject, error)
      });
      child.stdin.write(`${payload}\n`, (error) => {
        if (!error) {
          return;
        }
        pending.delete(id);
        settle(reject, error);
      });
    });
  }

  if (prelude) {
    child.stdin.write(prelude);
  }

  async function close() {
    if (closePromise) {
      return closePromise;
    }
    closePromise = (async () => {
      if (child.exitCode !== null || child.signalCode !== null || exitFailure) {
        await exitPromise;
        return;
      }
      if (!child.stdin.destroyed && !child.stdin.writableEnded) {
        child.stdin.end();
      }
      await exitPromise;
    })();
    return closePromise;
  }

  function kill(signal = "SIGKILL") {
    child.kill(signal);
  }

  return { request, close, kill };
}
