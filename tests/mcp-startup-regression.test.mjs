import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";

const REPO_ROOT = process.cwd();
const INITIALIZE_PARAMS = {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: {
    name: "agent-chassis-test",
    version: "1.0.0"
  }
};

async function listAgentSafeServerToolNames() {
  const child = spawn("node", ["packages/wiki-mcp/src/server.mjs"], {
    cwd: REPO_ROOT,
    stdio: ["pipe", "pipe", "pipe"],

    env: { ...process.env, WIKI_MCP_TOOL_PROFILE: "agent-safe" }
  });
  const exitPromise = once(child, "exit");
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  const responses = new Map();
  const waiters = new Map();
  function deliver(id, message) {
    responses.set(id, message);
    const waiter = waiters.get(id);
    if (waiter) {
      waiters.delete(id);
      waiter(message);
    }
  }
  function waitForId(id) {
    if (responses.has(id)) {
      return Promise.resolve(responses.get(id));
    }
    return new Promise((resolve) => waiters.set(id, resolve));
  }

  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) {
        continue;
      }
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message && message.id !== undefined && message.id !== null) {
        deliver(message.id, message);
      }
    }
  });

  let settled = false;
  child.on("exit", (code) => {
    if (settled) {
      return;
    }
    for (const waiter of waiters.values()) {
      waiter({
        error: {
          message: `Server exited before response (code ${code}); stderr=${stderr || "none"}`
        }
      });
    }
    waiters.clear();
  });

  const send = (obj) => child.stdin.write(`${JSON.stringify(obj)}\n`);
  const timeoutError = () =>
    new Error(`Timeout waiting for agent-safe server tools/list; stderr=${stderr || "none"}`);
  const withDeadline = (promise, ms) => {
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => reject(timeoutError()), ms);
    });
    return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
  };

  try {
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: INITIALIZE_PARAMS });
    const initResponse = await withDeadline(waitForId(1), 6000);
    assert.ok(initResponse.result, `initialize failed: ${JSON.stringify(initResponse.error ?? initResponse)}`);

    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const listResponse = await withDeadline(waitForId(2), 6000);

    assert.ok(listResponse.result, "tools/list must return a result");
    const tools = Array.isArray(listResponse.result.tools) ? listResponse.result.tools : [];
    return tools.map((tool) => tool.name);
  } finally {
    settled = true;
    child.stdin.end();
    child.kill("SIGKILL");
    await exitPromise;
  }
}

test("agent-safe server startup derives free/local exposure from descriptor audience (WK-1446)", async () => {
  const toolNames = await listAgentSafeServerToolNames();
  const exposed = new Set(toolNames);

  assert.ok(
    exposed.has("workspace_integration_status"),
    `expected agent-safe startup to expose workspace_integration_status; exposed=${[...exposed]
      .sort()
      .join(", ")}`
  );

  assert.ok(
    !exposed.has("workspace_integration_promote_check"),
    "operator-only workspace_integration_promote_check must not be exposed under agent-safe"
  );
});

test("MCP server handles fast initialization frame sent immediately upon startup without dropping it (IN-0017)", async () => {
  const child = spawn("node", ["packages/wiki-mcp/src/server.mjs"], {
    cwd: REPO_ROOT,
    stdio: ["pipe", "pipe", "pipe"]
  });
  const exitPromise = once(child, "exit");
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  const payload = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: INITIALIZE_PARAMS
  });

  child.stdin.write(`${payload}\n`);

  let responseData = "";
  const responsePromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(
        new Error(
          "Timeout waiting for initialize response - early frame was likely dropped due to premature stdin.resume(); " +
            `stderr=${stderr || "none"}`
        )
      );
    }, 4000);

    child.stdout.on("data", (chunk) => {
      responseData += chunk.toString("utf8");
      if (responseData.includes('"id":1') && responseData.includes("\n")) {
        clearTimeout(timeout);
        try {
          resolve(JSON.parse(responseData.trim()));
        } catch (e) {
          reject(e);
        }
      }
    });

    child.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited unexpectedly with code ${code}`));
    });
  });

  try {
    const response = await responsePromise;
    assert.ok(response.result);
    assert.equal(response.result.serverInfo.name, "@agent-chassis/wiki-mcp");
  } finally {
    child.stdin.end();
    child.kill("SIGKILL");
    await exitPromise;
  }
});
