import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createMcpSession as createBoundedMcpSession } from "./fixtures/mcp-stdio-session.mjs";
import { createChildFrameReader } from "./fixtures/mcp-stdio-frame-reader.mjs";

import { bootstrapRepo } from "../packages/wiki-core/src/index.mjs";

const REPO_ROOT = process.cwd();

const SERVER_TOOL_PROFILE = "operator";

function spawnServer() {
  return spawn(process.execPath, ["packages/wiki-mcp/src/server.mjs"], {
    cwd: REPO_ROOT,
    env: { ...process.env, WIKI_MCP_TOOL_PROFILE: SERVER_TOOL_PROFILE },
    stdio: ["pipe", "pipe", "pipe"]
  });
}

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
  return createBoundedMcpSession({
    env: { WIKI_MCP_TOOL_PROFILE: SERVER_TOOL_PROFILE, ...env },
    prelude,
    repoRoot: REPO_ROOT
  });
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

  const child = spawnServer();
  const reader = createChildFrameReader(child, { label: "framing-server" });

  try {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: INITIALIZE_PARAMS })}\n`);
    const { message: initialized, raw: initializedRaw } = await reader.waitForResponse(1);
    assert.equal(initialized.result.serverInfo.name, "@agent-chassis/wiki-mcp");

    assert.ok(!initializedRaw.includes("\n"));
    assert.deepEqual(JSON.parse(initializedRaw), initialized);

    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "resources/list", params: {} })}\n`);
    const { message: resources } = await reader.waitForResponse(2);
    assert.ok(resources.result.resources.some((resource) => resource.uri === "contract://schema"));

    assert.deepEqual(reader.frames.filter((frame) => "id" in frame.message).map((frame) => frame.message.id), [1, 2]);
  } finally {
    child.stdin.end();
    if (!reader.exitInfo) child.kill("SIGKILL");
    await reader.waitForExit();
    reader.dispose();
  }
});

test("MCP server stays alive while idle before the first request", async () => {
  const child = spawnServer();
  const reader = createChildFrameReader(child, { label: "idle-server" });

  try {

    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: INITIALIZE_PARAMS })}\n`);
    await reader.waitForResponse(1);

    assert.equal(reader.exitInfo, null, `server exited while idle; stderr=${reader.stderr}`);
  } finally {
    child.stdin.end();
    const exit = await reader.waitForExit();
    reader.dispose();

    assert.deepEqual(exit, { code: 0, signal: null });
  }
});

test("MCP server handles fast initialization frame sent immediately upon startup without dropping it (IN-0017)", async () => {
  const child = spawnServer();

  const reader = createChildFrameReader(child, { label: "fast-init-server" });

  const payload = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: INITIALIZE_PARAMS
  });

  child.stdin.write(`${payload}\n`);

  try {

    const { message } = await reader.waitForResponse(1);
    assert.ok(message.result, `expected an initialize result, got ${JSON.stringify(message)}`);
    assert.equal(message.result.serverInfo.name, "@agent-chassis/wiki-mcp");
  } finally {
    child.stdin.end();

    if (!reader.exitInfo) child.kill("SIGKILL");
    await reader.waitForExit();
    reader.dispose();
  }
});
