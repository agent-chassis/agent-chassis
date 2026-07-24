import test from "node:test";
import assert from "node:assert/strict";

import { createMcpSession } from "./mcp-stdio-session.mjs";

test("MCP stdio session close observes a child that exits before close is called", async () => {
  const script = [
    "process.stdin.once('data', (chunk) => {",
    "  const request = JSON.parse(String(chunk).trim());",
    "  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { ok: true } }) + '\\n');",
    "  process.exit(0);",
    "});"
  ].join("\n");
  const session = createMcpSession({
    command: process.execPath,
    args: ["-e", script],
    requestTimeoutMs: 500,
    closeTimeoutMs: 50
  });

  const result = await session.request(1, "initialize", {});
  assert.deepEqual(result, { ok: true });

  const exitInfo = await session.close();
  assert.equal(exitInfo.code, 0);
  assert.equal(exitInfo.signal, null);
});

test("MCP stdio session request timeout includes method, id, and stderr context", async () => {
  const script = [
    "process.stderr.write('fixture server accepted stdin but will not answer\\n');",
    "setTimeout(() => {}, 2000);"
  ].join("\n");
  const session = createMcpSession({
    command: process.execPath,
    args: ["-e", script],
    requestTimeoutMs: 50,
    closeTimeoutMs: 50
  });

  try {
    await assert.rejects(
      session.request(7, "tools/call", { name: "never_answers" }),
      /MCP request id=7 method=tools\/call timed out after 50ms.*fixture server accepted stdin/
    );
  } finally {
    session.kill();
    await session.close();
  }
});
