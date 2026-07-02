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
