

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import {
  errorContent,
  getResponseSpillConfig,
  guardToolHandler,
  jsonContent,
  measureMcpInlineResultBytes,
  normalizeMcpToolResult,
  readSpilledMcpContentReference,
  structuredToolResult
} from "../../packages/wiki-mcp/src/lib/mcp-response.mjs";

const INLINE_BYTE_LIMIT = 8192;

function utf8Bytes(value) {
  return Buffer.byteLength(value, "utf8");
}

function readStructuredOnly(result) {
  assert.ok(result.structuredContent !== null && typeof result.structuredContent === "object",
    "structured result must carry structuredContent");
  assert.deepEqual(result.content, []);
  assert.equal(JSON.stringify(result).includes('"type":"text"'), false);
  const parsed = CallToolResultSchema.safeParse(result);
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
  assert.deepEqual(parsed.data.structuredContent, result.structuredContent);
  assert.deepEqual(parsed.data.content, []);
  return result.structuredContent;
}

function assertCompleteResultWithinLimit(result, limit = INLINE_BYTE_LIMIT) {
  const bytes = utf8Bytes(JSON.stringify(result));
  assert.ok(bytes <= limit, `complete result used ${bytes} bytes against a ${limit}-byte limit`);
}

async function withSpillDirectory(callback) {
  const stateDir = await mkdtemp(path.join(tmpdir(), "wiki-mcp-response-carrier-"));
  try {
    return await callback(stateDir);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
}

function spillEnv(stateDir, overrides = {}) {
  return {
    WIKI_MCP_RESPONSE_INLINE_BYTE_LIMIT: String(INLINE_BYTE_LIMIT),
    WIKI_MCP_RESPONSE_STATE_DIR: stateDir,
    ...overrides
  };
}

function readReferenceToEnd(reference, env) {
  const chunks = [];
  let offset = 0;
  for (;;) {
    const chunk = readSpilledMcpContentReference(
      { ref_id: reference.ref_id, offset, length: reference.range.max_length },
      { env }
    );
    chunks.push(Buffer.from(chunk.data_base64, "base64"));
    if (chunk.eof) return Buffer.concat(chunks);
    offset = chunk.next_offset;
  }
}

function payloadWithFrameBytes(targetBytes, { isError = false } = {}) {
  const prefix = "quote \" backslash \\ newline \n tab \t é 🔥 ";
  const at = (padding) => ({
    schema_version: "boundary-response.v1",
    value: `${prefix}${"x".repeat(padding)}`
  });
  const base = measureMcpInlineResultBytes(at(0), { isError });
  const payload = at(targetBytes - base);
  assert.equal(measureMcpInlineResultBytes(payload, { isError }), targetBytes);
  return payload;
}

test("a success publishes its complete value once, in structuredContent", () => {
  const payload = {
    schema_version: "example-success.v1",
    ok: true,
    marker: "success-payload-marker",
    nested: { items: [1, 2, 3], note: "quotes \" and \\ backslashes survive escaping" }
  };

  const result = jsonContent(payload);

  assert.deepEqual(readStructuredOnly(result), payload);
  assert.equal(result.isError, undefined);
  assert.deepEqual(result, structuredToolResult(payload));
  assertCompleteResultWithinLimit(result, getResponseSpillConfig().inlineByteLimit);
});

test("a structured error publishes its envelope once and keeps isError", () => {
  const envelope = {
    schema_version: "example-error.v1",
    code: "example_refusal",
    message: "error-payload-marker",
    details: { retryable: false }
  };

  const result = errorContent({ envelope });

  assert.equal(result.isError, true);
  assert.deepEqual(readStructuredOnly(result), envelope);
  assertCompleteResultWithinLimit(result, getResponseSpillConfig().inlineByteLimit);
});

test("an unstructured throw is translated once into the structured refusal carrier", () => {
  const message = `failure ${"🔥".repeat(400)}`;
  const result = errorContent(new Error(message));

  assert.equal(result.isError, true);
  const envelope = readStructuredOnly(result);
  const refusal = envelope.refusal;
  assert.equal(envelope.code, "mcp_response.handler_exception.v1");
  assert.equal(refusal.schema_version, "public-mechanical-refusal.v1");
  assert.equal(refusal.code, envelope.code);

  assert.equal(envelope.diagnostic, message);
  assert.deepEqual(envelope.diagnostic_redactions, []);
  const facts = Object.fromEntries(refusal.deciding_facts.map((fact) => [fact.field, fact]));
  assert.equal(facts["mcp_response.handler_completed"].value, false);
  assert.equal(refusal.no_supported_route, true);
  assert.equal(Buffer.from(envelope.diagnostic, "utf8").equals(Buffer.from(message, "utf8")), true);
});

test("inline admission is exact at the final-frame boundary with escaped and Unicode payloads", async () => {
  await withSpillDirectory(async (stateDir) => {
    const env = spillEnv(stateDir);
    for (const isError of [false, true]) {
      const atLimit = payloadWithFrameBytes(INLINE_BYTE_LIMIT, { isError });
      const inline = isError
        ? errorContent({ envelope: atLimit }, { env })
        : jsonContent(atLimit, { env });
      assert.deepEqual(readStructuredOnly(inline), atLimit);
      assert.equal(utf8Bytes(JSON.stringify(inline)), INLINE_BYTE_LIMIT);
      assert.equal(inline.isError, isError ? true : undefined);

      const overLimit = payloadWithFrameBytes(INLINE_BYTE_LIMIT + 1, { isError });
      const spilled = isError
        ? errorContent({ envelope: overLimit }, { env })
        : jsonContent(overLimit, { env });
      const envelope = readStructuredOnly(spilled);
      assert.equal(envelope.response_spilled, true);
      assert.equal(spilled.isError, isError ? true : undefined);
      assert.equal(envelope.measurement.complete_frame_bytes, INLINE_BYTE_LIMIT + 1);
      assertCompleteResultWithinLimit(spilled);
      assert.deepEqual(
        JSON.parse(readReferenceToEnd(envelope.content_reference, env).toString("utf8")),
        overLimit
      );
    }
  });
});

test("preserved protocol metadata is part of the measured frame and is kept", async () => {
  await withSpillDirectory(async (stateDir) => {
    const env = spillEnv(stateDir);
    const payload = { schema_version: "meta-bearing.v1", ok: true };
    const _meta = { "example.org/trace": "t".repeat(128) };

    const small = normalizeMcpToolResult({ ...jsonContent(payload, { env }), _meta }, { env });
    assert.deepEqual(readStructuredOnly(small), payload);
    assert.deepEqual(small._meta, _meta);

    const fitting = payloadWithFrameBytes(INLINE_BYTE_LIMIT - 64);
    const bigMeta = { "example.org/trace": "m".repeat(256) };
    const spilled = normalizeMcpToolResult({ ...jsonContent(fitting, { env }), _meta: bigMeta }, { env });
    const envelope = readStructuredOnly(spilled);
    assert.equal(envelope.response_spilled, true);
    assert.deepEqual(spilled._meta, bigMeta);
    assert.ok(envelope.measurement.complete_frame_bytes > INLINE_BYTE_LIMIT);
    assertCompleteResultWithinLimit(spilled);
    assert.deepEqual(
      JSON.parse(readReferenceToEnd(envelope.content_reference, env).toString("utf8")),
      fitting
    );
  });
});

test("a spilled response carries the reference once and reconstructs the original value", async () => {
  await withSpillDirectory(async (stateDir) => {
    const payload = {
      schema_version: "spilled-response-source.v1",
      value: `spilled-payload-marker-${"x".repeat(9_000)} é 🔥 "quoted"`
    };
    const env = spillEnv(stateDir, {
      WIKI_MCP_RESPONSE_PREVIEW_BYTE_LIMIT: "512",
      WIKI_MCP_RESPONSE_REFERENCE_READ_BYTE_LIMIT: "1024"
    });

    const result = jsonContent(payload, { env });
    const spilled = readStructuredOnly(result);

    assert.equal(spilled.schema_version, "wiki-mcp-spilled-response.v1");
    assert.equal(spilled.response_spilled, true);
    assert.equal(spilled.content_reference.kind, "wiki_mcp_response_content_reference");
    assertCompleteResultWithinLimit(result);

    const firstRange = readSpilledMcpContentReference(
      { ref_id: spilled.content_reference.ref_id, offset: 0, length: 512 },
      { env }
    );
    const sourceText = JSON.stringify(payload, null, 2);
    assert.equal(firstRange.next_offset, 512);
    assert.equal(Buffer.from(firstRange.data_base64, "base64").toString("utf8"), sourceText.slice(0, 512));
    const whole = readReferenceToEnd(spilled.content_reference, env);
    assert.equal(whole.toString("utf8"), sourceText);
    assert.deepEqual(JSON.parse(whole.toString("utf8")), payload);
  });
});

test("an oversized structured error keeps isError and continues to the original envelope", async () => {
  await withSpillDirectory(async (stateDir) => {
    const envelope = {
      schema_version: "oversized-error.v1",
      code: "example_oversized_refusal",
      message: `oversized-error-marker-${"e".repeat(9_000)}`
    };
    const env = spillEnv(stateDir);

    const result = errorContent({ envelope }, { env });

    assert.equal(result.isError, true);
    const spilled = readStructuredOnly(result);
    assert.equal(spilled.response_spilled, true);
    assertCompleteResultWithinLimit(result);
    assert.deepEqual(
      JSON.parse(readReferenceToEnd(spilled.content_reference, env).toString("utf8")),
      envelope
    );
  });
});

test("a spill-persistence failure is one bounded structured refusal with no partial payload", async () => {
  await withSpillDirectory(async (root) => {
    const blocker = path.join(root, "blocker");
    await writeFile(blocker, "not a directory\n");
    const env = spillEnv(path.join(blocker, "response-spill"));
    const payload = {
      schema_version: "refusal-source.v1",
      value: `refusal-payload-marker-${"r".repeat(9_000)}`
    };

    const result = jsonContent(payload, { env });

    assert.equal(result.isError, true);
    const refusal = readStructuredOnly(result);
    assert.equal(refusal.schema_version, "mcp-response-refusal.v1");
    assert.equal(refusal.code, "mcp_response.spill_persistence_failed.v1");
    assert.equal(refusal.content_reference, undefined);
    assert.equal(refusal.cause_diagnostic.code, "ENOTDIR");
    assert.equal(refusal.cause_diagnostic.path, path.join(blocker, "response-spill"));
    assert.deepEqual(refusal.cause_diagnostic_redactions, []);
    assert.ok(!JSON.stringify(result).includes("refusal-payload-marker"));
    assertCompleteResultWithinLimit(result);
  });
});

test("the public guard removes a text carrier a handler built or appended, below the byte limit", async () => {
  await withSpillDirectory(async (stateDir) => {
    const env = spillEnv(stateDir);
    const payload = { schema_version: "already-formed.v1", ok: true, items: ["a", "b"] };
    const image = { type: "image", data: "aGVsbG8=", mimeType: "image/png" };
    const shapes = {
      duplicate_json_text: async () => ({
        content: [{ type: "text", text: JSON.stringify(payload) }],
        structuredContent: payload
      }),
      summary_text: async () => ({
        content: [{ type: "text", text: "handler-authored summary line" }],
        structuredContent: payload
      }),
      appended_after_helper: async () => {
        const shaped = jsonContent(payload, { env });
        shaped.content.push({ type: "text", text: JSON.stringify(shaped.structuredContent) });
        return shaped;
      },
      mutated_after_helper: async () => {
        const shaped = jsonContent({ schema_version: "already-formed.v1" }, { env });
        shaped.structuredContent = payload;
        shaped.content = [{ type: "text", text: "stale pointer" }];
        return shaped;
      },
      structured_only_without_content: async () => ({ structuredContent: payload })
    };
    for (const [shape, handler] of Object.entries(shapes)) {
      const result = await guardToolHandler(handler, { name: shape, env })({});
      assert.ok(utf8Bytes(JSON.stringify(result)) < INLINE_BYTE_LIMIT, shape);
      assert.deepEqual(readStructuredOnly(result), payload, shape);
      assert.ok(!JSON.stringify(result).includes("handler-authored summary line"), shape);
      assert.ok(!JSON.stringify(result).includes("stale pointer"), shape);
    }

    const mixed = await guardToolHandler(async () => ({
      content: [{ type: "text", text: JSON.stringify(payload) }, image],
      structuredContent: payload
    }), { name: "mixed", env })({});
    assert.deepEqual(mixed.content, [image]);
    assert.deepEqual(mixed.structuredContent, payload);
    assert.equal(CallToolResultSchema.safeParse(mixed).success, true);
  });
});

test("a result already on the contract passes the guard unchanged", async () => {
  const shaped = jsonContent({ ok: true });
  assert.equal(normalizeMcpToolResult(shaped), shaped);
});

test("legitimate unstructured text results are left intact", async () => {
  const plain = { content: [{ type: "text", text: "plain text result" }] };
  assert.equal(normalizeMcpToolResult(plain), plain);
  const guarded = await guardToolHandler(async () => plain, { name: "plain" })({});
  assert.deepEqual(guarded, { content: [{ type: "text", text: "plain text result" }] });
});

test("the installed SDK client receives every structured shape without a text carrier", async () => {
  await withSpillDirectory(async (stateDir) => {
    const env = spillEnv(stateDir);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = new McpServer({ name: "wiki-mcp-carrier-contract-test", version: "1.0.0" });
    const client = new Client({ name: "wiki-mcp-carrier-contract-client", version: "1.0.0" }, {
      capabilities: {}
    });
    const outputSchema = { ok: z.boolean(), marker: z.string() };
    const register = (name, config, handler) =>
      server.registerTool(name, config, guardToolHandler(handler, {
        name, env, outputSchema: config.outputSchema ?? null
      }));
    register("success", { description: "success", outputSchema },
      async () => jsonContent({ ok: true, marker: "é 🔥 \"q\"" }, { env }));
    register("structured_error", { description: "error" },
      async () => errorContent({ envelope: { code: "example_refusal", ok: false } }, { env }));
    register("thrown", { description: "thrown" }, async () => {
      throw new Error("thrown-marker");
    });
    register("spilled", { description: "spill" },
      async () => jsonContent({ value: "s".repeat(INLINE_BYTE_LIMIT * 2) }, { env }));
    register("handler_text", { description: "handler text", outputSchema },
      async () => ({
        content: [{ type: "text", text: "{\"ok\":true,\"marker\":\"m\"}" }],
        structuredContent: { ok: true, marker: "m" }
      }));
    register("plain_text", { description: "plain" },
      async () => ({ content: [{ type: "text", text: "plain text result" }] }));

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const call = (name) => client.callTool({ name, arguments: {} });

      assert.deepEqual(readStructuredOnly(await call("success")), { ok: true, marker: "é 🔥 \"q\"" });
      const error = await call("structured_error");
      assert.equal(error.isError, true);
      assert.deepEqual(readStructuredOnly(error), { code: "example_refusal", ok: false });
      const thrown = await call("thrown");
      assert.equal(thrown.isError, true);
      assert.equal(readStructuredOnly(thrown).diagnostic, "thrown-marker");
      const spilled = readStructuredOnly(await call("spilled"));
      assert.equal(spilled.response_spilled, true);
      assert.deepEqual(
        JSON.parse(readReferenceToEnd(spilled.content_reference, env).toString("utf8")),
        { value: "s".repeat(INLINE_BYTE_LIMIT * 2) }
      );
      assert.deepEqual(readStructuredOnly(await call("handler_text")), { ok: true, marker: "m" });
      assert.deepEqual((await call("plain_text")).content,
        [{ type: "text", text: "plain text result" }]);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
