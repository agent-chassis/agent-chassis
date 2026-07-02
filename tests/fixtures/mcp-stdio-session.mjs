import { spawn } from "node:child_process";

export const DEFAULT_MCP_REQUEST_TIMEOUT_MS = 5000;
export const DEFAULT_MCP_CLOSE_TIMEOUT_MS = 1000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stderrTail(stderr) {
  const text = String(stderr || "");
  return text.length > 2000 ? text.slice(-2000) : text;
}

function formatExit(exitInfo) {
  if (!exitInfo) return "still running";
  const code = exitInfo.code === null ? "null" : String(exitInfo.code);
  const signal = exitInfo.signal === null ? "null" : String(exitInfo.signal);
  return `code=${code} signal=${signal}`;
}

export function createMcpSession({
  env = {},
  prelude = "",
  repoRoot = process.cwd(),
  command = process.execPath,
  args = ["packages/wiki-mcp/src/server.mjs"],
  baseEnv = process.env,
  requestTimeoutMs = DEFAULT_MCP_REQUEST_TIMEOUT_MS,
  closeTimeoutMs = DEFAULT_MCP_CLOSE_TIMEOUT_MS
} = {}) {
  const sessionEnv = { ...baseEnv, ...env };
  if (
    typeof sessionEnv.WIKI_MCP_DEFAULT_REPO === "string" &&
    sessionEnv.WIKI_MCP_DEFAULT_REPO.length > 0 &&
    !Object.prototype.hasOwnProperty.call(sessionEnv, "WIKI_MCP_WORKSPACE_ALIAS")
  ) {
    sessionEnv.WIKI_MCP_WORKSPACE_ALIAS = sessionEnv.WIKI_MCP_DEFAULT_REPO;
  }

  const child = spawn(command, args, {
    cwd: repoRoot,
    env: sessionEnv,
    stdio: ["pipe", "pipe", "pipe"]
  });

  let buffer = "";
  let errorBuffer = "";
  let exitInfo = null;
  const pending = new Map();

  const exitPromise = new Promise((resolve) => {
    child.once("exit", (code, signal) => {
      exitInfo = { code, signal };
      for (const [id, pendingRequest] of pending.entries()) {
        pending.delete(id);
        pendingRequest.reject(
          new Error(
            `MCP server exited before response for id=${id}: ${formatExit(exitInfo)}; stderr=${stderrTail(errorBuffer) || "none"}`
          )
        );
      }
      resolve(exitInfo);
    });
  });

  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    drainBuffer();
  });

  child.stderr.on("data", (chunk) => {
    errorBuffer += chunk.toString("utf8");
  });

  child.on("error", (error) => {
    for (const [id, pendingRequest] of pending.entries()) {
      pending.delete(id);
      pendingRequest.reject(
        new Error(`MCP server process error before response for id=${id}: ${error.message}`)
      );
    }
  });

  function settle(id, kind, value) {
    const pendingRequest = pending.get(id);
    if (!pendingRequest) return;
    pending.delete(id);
    clearTimeout(pendingRequest.timer);
    pendingRequest[kind](value);
  }

  function drainBuffer() {
    while (true) {
      const lineEnd = buffer.indexOf("\n");
      if (lineEnd === -1) return;

      const body = buffer.slice(0, lineEnd).replace(/\r$/, "");
      buffer = buffer.slice(lineEnd + 1);
      if (!body) continue;

      let message;
      try {
        message = JSON.parse(body);
      } catch (error) {
        for (const [id, pendingRequest] of pending.entries()) {
          pending.delete(id);
          clearTimeout(pendingRequest.timer);
          pendingRequest.reject(
            new Error(`MCP server emitted invalid JSON before response for id=${id}: ${error.message}`)
          );
        }
        continue;
      }

      if (!("id" in message)) continue;
      if (message.error) {
        settle(message.id, "reject", new Error(message.error.message || "MCP request failed"));
        continue;
      }
      settle(message.id, "resolve", message.result);
    }
  }

  function request(id, method, params = {}) {
    if (exitInfo) {
      return Promise.reject(
        new Error(`MCP request id=${id} method=${method} cannot be sent; server already exited: ${formatExit(exitInfo)}`)
      );
    }

    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params
    });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(
          new Error(
            `MCP request id=${id} method=${method} timed out after ${requestTimeoutMs}ms; ` +
              `server=${formatExit(exitInfo)}; stderr=${stderrTail(errorBuffer) || "none"}`
          )
        );
      }, requestTimeoutMs);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${payload}\n`, (error) => {
        if (error) {
          settle(id, "reject", new Error(`MCP request id=${id} write failed: ${error.message}`));
        }
      });
    });
  }

  if (prelude) {
    child.stdin.write(prelude);
  }

  async function close() {
    if (exitInfo) return exitInfo;

    child.stdin.end();
    const closed = await Promise.race([
      exitPromise.then(() => true),
      delay(closeTimeoutMs).then(() => false)
    ]);
    if (closed) return exitInfo;

    child.kill("SIGTERM");
    const terminated = await Promise.race([
      exitPromise.then(() => true),
      delay(closeTimeoutMs).then(() => false)
    ]);
    if (terminated) return exitInfo;

    child.kill("SIGKILL");
    return await exitPromise;
  }

  function kill(signal = "SIGKILL") {
    if (!exitInfo) child.kill(signal);
  }

  return {
    child,
    request,
    close,
    kill,
    get stderr() {
      return errorBuffer;
    },
    get exitInfo() {
      return exitInfo;
    }
  };
}
