import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  guardToolHandler,
  installProcessErrorGuards,
  jsonContent,
  errorContent,
  readSpilledMcpContentReference
} from "../packages/wiki-mcp/src/lib/mcp-response.mjs";

async function withSpillEnv(fn) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wiki-mcp-response-spill-"));
  const previous = {
    WIKI_MCP_RESPONSE_STATE_DIR: process.env.WIKI_MCP_RESPONSE_STATE_DIR,
    WIKI_MCP_RESPONSE_INLINE_BYTE_LIMIT: process.env.WIKI_MCP_RESPONSE_INLINE_BYTE_LIMIT,
    WIKI_MCP_RESPONSE_PREVIEW_BYTE_LIMIT: process.env.WIKI_MCP_RESPONSE_PREVIEW_BYTE_LIMIT,
    WIKI_MCP_RESPONSE_REFERENCE_READ_BYTE_LIMIT: process.env.WIKI_MCP_RESPONSE_REFERENCE_READ_BYTE_LIMIT
  };
  process.env.WIKI_MCP_RESPONSE_STATE_DIR = tempDir;
  process.env.WIKI_MCP_RESPONSE_INLINE_BYTE_LIMIT = "8192";
  process.env.WIKI_MCP_RESPONSE_PREVIEW_BYTE_LIMIT = "64";
  process.env.WIKI_MCP_RESPONSE_REFERENCE_READ_BYTE_LIMIT = "512";
  try {
    await fn(tempDir);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function readReferenceToEnd(refId, chunkLength) {
  let offset = 0;
  const chunks = [];
  while (true) {
    const chunk = readSpilledMcpContentReference({
      ref_id: refId,
      offset,
      length: chunkLength
    });
    assert.equal(chunk.encoding, "base64");
    chunks.push(Buffer.from(chunk.data_base64, "base64"));
    if (chunk.eof) {
      assert.equal(chunk.next_offset, null);
      return { bytes: Buffer.concat(chunks), totalBytes: chunk.total_bytes, sha256: chunk.sha256 };
    }
    offset = chunk.next_offset;
  }
}

test("guardToolHandler converts a synchronous throw into an MCP error result and never throws", async () => {
  const wrapped = guardToolHandler(() => {
    throw new Error("boom from handler");
  });

  let result;
  await assert.doesNotReject(async () => {
    result = await wrapped({ some: "args" });
  });
  assert.equal(result.isError, true);
  assert.equal(result.content[0].type, "text");
  assert.match(result.content[0].text, /boom from handler/);
});

test("guardToolHandler converts a rejected async handler into an MCP error result", async () => {
  const wrapped = guardToolHandler(async () => {
    throw new Error("async boom");
  });

  const result = await wrapped({});
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /async boom/);
});

test("guardToolHandler keeps an MCP connection usable after an async rejection", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = new McpServer({ name: "wiki-mcp-error-boundary-test", version: "1.0.0" });
  const client = new Client({ name: "wiki-mcp-error-boundary-client", version: "1.0.0" }, {
    capabilities: {}
  });

  server.registerTool(
    "rejecting_tool",
    { description: "Rejects asynchronously" },
    guardToolHandler(async () => {
      throw new Error("async transport-boundary boom");
    })
  );
  server.registerTool(
    "follow_up_tool",
    { description: "Succeeds after a rejected tool call" },
    guardToolHandler(async () => jsonContent({ ok: true }))
  );

  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const rejected = await client.callTool({
      name: "rejecting_tool",
      arguments: {}
    });
    assert.equal(rejected.isError, true);
    assert.match(rejected.content[0].text, /async transport-boundary boom/);
    assert.equal(server.isConnected(), true, "server must remain connected after rejected handler");

    const followUp = await client.callTool({
      name: "follow_up_tool",
      arguments: {}
    });
    assert.notEqual(followUp.isError, true);
    assert.deepEqual(followUp.structuredContent, { ok: true });
  } finally {
    await client.close();
    await server.close();
  }
});

test("jsonContent spills oversized success payloads to a lossless ranged reference", async () => {
  await withSpillEnv(async () => {
    const data = {
      schema_version: "oversized-response-test.v1",
      payload: "abcdefghijklmnopqrstuvwxyz".repeat(1000),
      non_ascii: "Split-safe UTF-8: café — résumé — 😀".repeat(200)
    };
    const expectedText = JSON.stringify(data, null, 2);
    const result = jsonContent(data);

    assert.equal(result.structuredContent.schema_version, "wiki-mcp-spilled-response.v1");
    assert.equal(result.structuredContent.response_spilled, true);
    assert.equal(result.structuredContent.total_bytes, Buffer.byteLength(expectedText, "utf8"));
    assert.equal(result.structuredContent.preview.bytes, 64);
    assert.equal(result.structuredContent.content_reference.read_tool, "workspace_read_mcp_content_reference");
    assert.equal(result.structuredContent.content_reference.byte_count, result.structuredContent.total_bytes);

    const { bytes, totalBytes, sha256 } = await readReferenceToEnd(
      result.structuredContent.content_reference.ref_id,
      17
    );
    assert.equal(totalBytes, result.structuredContent.total_bytes);
    assert.equal(sha256, result.structuredContent.content_reference.sha256);
    const text = bytes.toString("utf8");
    assert.equal(text, expectedText, "ranged reads must reassemble the exact spilled JSON bytes");
    assert.deepEqual(JSON.parse(text), data);
  });
});

test("oversized MCP tool response spills and the connection remains usable for a follow-up call", async () => {
  await withSpillEnv(async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = new McpServer({ name: "wiki-mcp-spill-boundary-test", version: "1.0.0" });
    const client = new Client({ name: "wiki-mcp-spill-boundary-client", version: "1.0.0" }, {
      capabilities: {}
    });
    const hugePayload = {
      schema_version: "giant-tool-result.v1",
      body: "0123456789abcdef".repeat(2000)
    };

    server.registerTool(
      "giant_tool",
      { description: "Returns an oversized success payload" },
      guardToolHandler(async () => jsonContent(hugePayload))
    );
    server.registerTool(
      "workspace_read_mcp_content_reference",
      {
        description: "Reads spilled response content references",
        inputSchema: {
          ref_id: z.string(),
          offset: z.number().optional(),
          length: z.number().optional()
        }
      },
      guardToolHandler(async (args) => jsonContent(readSpilledMcpContentReference(args)))
    );
    server.registerTool(
      "follow_up_tool",
      { description: "Succeeds after an oversized tool call" },
      guardToolHandler(async () => jsonContent({ ok: true }))
    );

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const giant = await client.callTool({
        name: "giant_tool",
        arguments: {}
      });
      assert.equal(giant.structuredContent.response_spilled, true);
      assert.equal(giant.structuredContent.content_reference.read_tool, "workspace_read_mcp_content_reference");
      assert.equal(server.isConnected(), true, "server must remain connected after giant response spill");

      const refId = giant.structuredContent.content_reference.ref_id;
      let offset = 0;
      const chunks = [];
      while (true) {
        const chunk = await client.callTool({
          name: "workspace_read_mcp_content_reference",
          arguments: { ref_id: refId, offset, length: 512 }
        });
        assert.equal(chunk.structuredContent.encoding, "base64");
        chunks.push(Buffer.from(chunk.structuredContent.data_base64, "base64"));
        if (chunk.structuredContent.eof) break;
        offset = chunk.structuredContent.next_offset;
      }
      const reassembled = Buffer.concat(chunks).toString("utf8");
      assert.equal(reassembled, JSON.stringify(hugePayload, null, 2));

      const followUp = await client.callTool({
        name: "follow_up_tool",
        arguments: {}
      });
      assert.notEqual(followUp.isError, true);
      assert.deepEqual(followUp.structuredContent, { ok: true });
    } finally {
      await client.close();
      await server.close();
    }
  });
});

test("guardToolHandler passes a successful result through unchanged", async () => {
  const payload = { ok: true, value: 42 };
  const wrapped = guardToolHandler(async () => jsonContent(payload));

  const result = await wrapped({});
  assert.equal(result.isError, undefined);
  assert.deepEqual(result.structuredContent, payload);
});

test("guardToolHandler preserves a structured error envelope thrown by a handler", async () => {
  const envelope = { code: "structured_refusal", reason: "not allowed" };
  const wrapped = guardToolHandler(() => {
    const error = new Error("refused");
    error.envelope = envelope;
    throw error;
  });

  const result = await wrapped({});
  assert.equal(result.isError, true);
  assert.deepEqual(result.structuredContent, envelope);
});

test("guardToolHandler invokes the optional structured logger on a throw", async () => {
  const logged = [];
  const wrapped = guardToolHandler(
    () => {
      throw new Error("logged failure");
    },
    { name: "workspace_demo_tool", log: (entry) => logged.push(entry) }
  );

  const result = await wrapped({});
  assert.equal(result.isError, true);
  assert.equal(logged.length, 1);
  assert.equal(logged[0].level, "error");
  assert.equal(logged[0].tool, "workspace_demo_tool");
  assert.match(logged[0].error, /logged failure/);
});

test("installProcessErrorGuards logs process-level errors without throwing", () => {
  const processLike = new EventEmitter();
  const logged = [];

  const first = installProcessErrorGuards({
    processLike,
    log: (entry) => logged.push(entry)
  });
  const second = installProcessErrorGuards({
    processLike,
    log: (entry) => logged.push(entry)
  });

  assert.deepEqual(first, { installed: true });
  assert.deepEqual(second, { installed: false });
  assert.doesNotThrow(() => {
    processLike.emit("unhandledRejection", new Error("lost promise"));
    processLike.emit("uncaughtException", new Error("top-level boom"), "uncaughtException");
  });

  assert.equal(logged.length, 2);
  assert.deepEqual(
    logged.map((entry) => entry.event),
    ["unhandledRejection", "uncaughtException"]
  );
  assert.ok(logged.every((entry) => entry.message.includes("keeping server process alive")));
});

test("guardToolHandler is a thin wrapper: errorContent shape matches a direct call", async () => {

  const error = new Error("identical");
  const direct = errorContent(error);
  const wrapped = await guardToolHandler(() => {
    throw error;
  })({});
  assert.deepEqual(wrapped, direct);
});
