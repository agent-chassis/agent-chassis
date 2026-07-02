import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createMcpSession as createBoundedMcpSession } from "./fixtures/mcp-stdio-session.mjs";

import { bootstrapRepo } from "../packages/wiki-core/src/index.mjs";

const REPO_ROOT = process.cwd();
const INITIALIZE_PARAMS = {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: {
    name: "agent-chassis-test",
    version: "1.0.0"
  }
};

async function withTempDir(fn) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-chassis-interface-"));
  try {
    await fn(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function createMcpSession({ env = {}, prelude = "" } = {}) {
  return createBoundedMcpSession({ env, prelude, repoRoot: REPO_ROOT });
}

test("MCP allocate_id reservations are consumed by create_record", { skip: "WK-1377 pending CCE/no-CCE test-structure refactor" }, async () => {
  const session = createMcpSession();
  try {
    await session.request(1, "initialize", INITIALIZE_PARAMS);

    await withTempDir(async (tempDir) => {
      await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/app-demo" });

      const allocated = await session.request(2, "tools/call", {
        name: "allocate_id",
        arguments: { dir: tempDir, type: "issue", repo: "agent-chassis/app-demo" }
      });
      const created = await session.request(3, "tools/call", {
        name: "create_record",
        arguments: {
          dir: tempDir,
          type: "issue",
          title: "Consume the reserved issue identifier"
        }
      });

      assert.equal(allocated.structuredContent.id, "WK-0002");
      assert.equal(created.structuredContent.id, "WK-0002");
    });
  } finally {
    await session.close();
  }
});

test("MCP server uses newline-delimited stdio messages", async () => {
  const session = createMcpSession();
  try {
    const initialized = await session.request(1, "initialize", INITIALIZE_PARAMS);

    assert.equal(initialized.serverInfo.name, "@agent-chassis/wiki-mcp");

    const resources = await session.request(2, "resources/list");

    assert.ok(resources.resources.some((resource) => resource.uri === "contract://schema"));
  } finally {
    await session.close();
  }
});

test("MCP server stays alive while idle before the first request", async () => {
  const child = spawn("node", ["packages/wiki-mcp/src/server.mjs"], {
    cwd: REPO_ROOT,
    stdio: ["pipe", "pipe", "pipe"]
  });

  let exited = false;
  child.on("exit", () => {
    exited = true;
  });

  try {
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(exited, false);
  } finally {
    child.stdin.end();
    await once(child, "exit");
  }
});

test("MCP server handles fast initialization frame sent immediately upon startup without dropping it (IN-0017)", async () => {
  const child = spawn("node", ["packages/wiki-mcp/src/server.mjs"], {
    cwd: REPO_ROOT,
    stdio: ["pipe", "pipe", "pipe"]
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
      reject(new Error("Timeout waiting for initialize response - early frame was likely dropped due to premature stdin.resume()"));
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

    child.stderr.on("data", (chunk) => {

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
    await once(child, "exit");
  }
});
