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

function freeLocalServerEnv(profile) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("NODE_TEST")) {
      delete env[key];
    }
  }
  for (const key of [
    "NODE_ENGINE_API_KEY",
    "NODE_ENGINE_LICENSE_KEY",
    "WIKI_MCP_WORKSPACE_ALIAS",
    "WIKI_MCP_WORKSPACE_DIR",
    "WIKI_MCP_REPOS",
    "WIKI_MCP_DEFAULT_REPO"
  ]) {
    delete env[key];
  }
  env.WIKI_MCP_TOOL_PROFILE = profile;
  return env;
}

async function listFreeLocalServerToolNames(profile) {
  const child = spawn(process.execPath, ["packages/wiki-mcp/src/server.mjs"], {
    cwd: REPO_ROOT,
    env: freeLocalServerEnv(profile),
    stdio: ["pipe", "pipe", "pipe"]
  });
  const exitPromise = once(child, "exit");
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  let buffer = "";

  try {
    const toolNames = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`production stdio tools/list timed out for ${profile}; stderr=${stderr || "none"}`));
      }, 6000);
      child.stdout.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        while (buffer.includes("\n")) {
          const newline = buffer.indexOf("\n");
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (!line.trim()) continue;
          const message = JSON.parse(line);
          if (message.id === 1 && message.result) {
            child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
            child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);
          } else if (message.id === 2) {
            clearTimeout(timeout);
            if (message.error) {
              reject(new Error(`production tools/list refused: ${JSON.stringify(message.error)}`));
            } else {
              resolve(message.result.tools.map((tool) => tool.name).sort());
            }
          }
        }
      });
      child.on("exit", (code) => {
        clearTimeout(timeout);
        reject(new Error(`production stdio exited with ${code} for ${profile}; stderr=${stderr || "none"}`));
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: INITIALIZE_PARAMS })}\n`);
    });
    return toolNames;
  } finally {
    child.stdin.end();
    child.kill("SIGKILL");
    await exitPromise;
  }
}

test("production stdio tools/list applies role and descriptor-backed free/local gates to initiative assignment", async () => {
  const readySliceToolName = "workspace_work_record_ready_slice";
  const orchestratorToolNames = await listFreeLocalServerToolNames("orchestrator");
  assert.ok(
    orchestratorToolNames.includes("assign_work_record_to_initiative"),
    "free/local orchestrator must list assign_work_record_to_initiative"
  );
  assert.ok(
    orchestratorToolNames.includes(readySliceToolName),
    `free/local orchestrator must list ${readySliceToolName}`
  );

  const agentSafeToolNames = await listFreeLocalServerToolNames("agent-safe");
  assert.deepEqual(agentSafeToolNames, orchestratorToolNames);

  const reviewerToolNames = await listFreeLocalServerToolNames("reviewer");
  assert.equal(
    reviewerToolNames.includes("assign_work_record_to_initiative"),
    false,
    "reviewer must not list orchestrator-only assignment authority"
  );
  assert.equal(reviewerToolNames.includes(readySliceToolName), false);

  const operatorToolNames = await listFreeLocalServerToolNames("operator");
  assert.ok(
    operatorToolNames.includes(readySliceToolName),
    `operator must list ${readySliceToolName}`
  );
  for (const role of ["redteam", "worker"]) {
    const toolNames = await listFreeLocalServerToolNames(role);
    assert.equal(
      toolNames.includes(readySliceToolName),
      false,
      `${role} must not list write-capable ${readySliceToolName}`
    );
  }
  await assertFastInitializationFrame();
});

async function assertFastInitializationFrame() {
  const child = spawn("node", ["packages/wiki-mcp/src/server.mjs"], {
    cwd: REPO_ROOT,
    stdio: ["pipe", "pipe", "pipe"],
    env: freeLocalServerEnv("orchestrator")
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
      reject(new Error(`Server exited unexpectedly with code ${code}; stderr=${stderr || "none"}`));
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
}
