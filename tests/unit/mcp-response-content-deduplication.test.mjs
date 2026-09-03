

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  errorContent,
  getResponseSpillConfig,
  guardToolHandler,
  jsonContent,
  readSpilledMcpContentReference
} from "../../packages/wiki-mcp/src/lib/mcp-response.mjs";

const INLINE_BYTE_LIMIT = 8192;

function utf8Bytes(value) {
  return Buffer.byteLength(value, "utf8");
}

function readAsContentOnlyConsumer(result) {
  assert.ok(Array.isArray(result.content) && result.content.length === 1);
  assert.equal(result.content[0].type, "text");
  return JSON.parse(result.content[0].text);
}

function readAsStructuredConsumer(result) {
  assert.notEqual(result.structuredContent, undefined);
  return result.structuredContent;
}

function assertBothConsumersAgree(result) {
  const contentOnly = readAsContentOnlyConsumer(result);
  const structured = readAsStructuredConsumer(result);
  assert.deepEqual(contentOnly, structured);
  return structured;
}

function assertCompleteResultWithinLimit(result, limit = INLINE_BYTE_LIMIT) {
  const bytes = utf8Bytes(JSON.stringify(result));
  assert.ok(bytes <= limit, `complete result used ${bytes} bytes against a ${limit}-byte limit`);
}

async function withSpillDirectory(callback) {
  const stateDir = await mkdtemp(path.join(tmpdir(), "wiki-mcp-response-compat-"));
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

test("both consumer shapes recover the same stable success fields", () => {
  const payload = {
    schema_version: "example-success.v1",
    ok: true,
    marker: "success-payload-marker",
    nested: { items: [1, 2, 3], note: "quotes \" and \\ backslashes survive escaping" }
  };

  const result = jsonContent(payload);

  const recovered = assertBothConsumersAgree(result);
  assert.deepEqual(recovered, payload);
  assert.equal(recovered.schema_version, "example-success.v1");
  assert.equal(recovered.marker, "success-payload-marker");
  assert.equal(recovered.nested.note, payload.nested.note);
  assert.equal(result.isError, undefined);
  assertCompleteResultWithinLimit(result, getResponseSpillConfig().inlineByteLimit);
});

test("both consumer shapes recover the same stable error fields and isError", () => {
  const envelope = {
    schema_version: "example-error.v1",
    code: "example_refusal",
    message: "error-payload-marker",
    details: { retryable: false }
  };

  const result = errorContent({ envelope });

  assert.equal(result.isError, true);
  const recovered = assertBothConsumersAgree(result);
  assert.deepEqual(recovered, envelope);
  assert.equal(recovered.code, "example_refusal");
  assert.equal(recovered.message, "error-payload-marker");
  assertCompleteResultWithinLimit(result, getResponseSpillConfig().inlineByteLimit);
});

test("an unstructured error stays lossless and readable through both channels", () => {
  const message = `failure ${"🔥".repeat(400)}`;
  const result = errorContent(new Error(message));

  assert.equal(result.isError, true);
  assert.equal(result.content[0].type, "text");
  const envelope = result.structuredContent;
  const refusal = envelope.refusal;
  assert.equal(envelope.code, "mcp_response.handler_exception.v1");
  assert.equal(refusal.schema_version, "public-mechanical-refusal.v1");
  assert.equal(refusal.code, envelope.code);
  assert.equal(envelope.diagnostic, message);
  assert.deepEqual(envelope.diagnostic_redactions, []);
  assert.deepEqual(JSON.parse(result.content[0].text), envelope);
  const facts = Object.fromEntries(refusal.deciding_facts.map((fact) => [fact.field, fact]));
  assert.equal(facts["mcp_response.handler_completed"].value, false);
  assert.equal(Object.hasOwn(facts, "mcp_response.thrown_diagnostic"), false);
  assert.equal(refusal.no_supported_route, true);
  assert.equal(refusal.recovery.state, "no_supported_route");
  assert.equal(Object.hasOwn(refusal, "next_calls"), false);
  assert.equal(Buffer.from(envelope.diagnostic, "utf8").equals(Buffer.from(message, "utf8")), true);
});

test("a near-limit result spills because the complete two-channel result exceeds the limit", async () => {
  await withSpillDirectory(async (stateDir) => {
    const payload = {
      schema_version: "boundary-response.v1",
      value: `boundary-payload-marker-${"x".repeat(5_000)}`
    };
    const env = spillEnv(stateDir);

    assert.ok(utf8Bytes(JSON.stringify(payload)) < INLINE_BYTE_LIMIT);

    const result = jsonContent(payload, { env });

    const spilled = assertBothConsumersAgree(result);
    assert.equal(spilled.schema_version, "wiki-mcp-spilled-response.v1");
    assert.equal(spilled.response_spilled, true);
    assertCompleteResultWithinLimit(result);
  });
});

test("a spilled response gives both consumers the same reference and ranged continuation", async () => {
  await withSpillDirectory(async (stateDir) => {
    const payload = {
      schema_version: "spilled-response-source.v1",
      value: `spilled-payload-marker-${"x".repeat(9_000)}`
    };
    const env = spillEnv(stateDir, {
      WIKI_MCP_RESPONSE_PREVIEW_BYTE_LIMIT: "512",
      WIKI_MCP_RESPONSE_REFERENCE_READ_BYTE_LIMIT: "1024"
    });

    const result = jsonContent(payload, { env });
    const spilled = assertBothConsumersAgree(result);

    assert.equal(spilled.schema_version, "wiki-mcp-spilled-response.v1");
    assert.equal(spilled.response_spilled, true);
    assert.equal(spilled.content_reference.kind, "wiki_mcp_response_content_reference");
    assertCompleteResultWithinLimit(result);

    const firstRange = readSpilledMcpContentReference(
      { ref_id: spilled.content_reference.ref_id, offset: 0, length: 512 },
      { env }
    );
    const sourceText = JSON.stringify(payload, null, 2);
    assert.equal(firstRange.schema_version, "wiki-mcp-content-reference-read.v1");
    assert.equal(firstRange.offset, 0);
    assert.equal(firstRange.length, 512);
    assert.equal(firstRange.eof, false);
    assert.equal(firstRange.next_offset, 512);
    assert.equal(Buffer.from(firstRange.data_base64, "base64").toString("utf8"), sourceText.slice(0, 512));

    const secondRange = readSpilledMcpContentReference(
      { ref_id: spilled.content_reference.ref_id, offset: firstRange.next_offset, length: 512 },
      { env }
    );
    assert.equal(secondRange.offset, 512);
    assert.equal(secondRange.next_offset, 1024);
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
    const spilled = assertBothConsumersAgree(result);
    assert.equal(spilled.response_spilled, true);
    assertCompleteResultWithinLimit(result);

    const chunks = [];
    let offset = 0;
    for (;;) {
      const chunk = readSpilledMcpContentReference(
        {
          ref_id: spilled.content_reference.ref_id,
          offset,
          length: spilled.content_reference.range.max_length
        },
        { env }
      );
      chunks.push(Buffer.from(chunk.data_base64, "base64"));
      if (chunk.eof) break;
      offset = chunk.next_offset;
    }
    assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString("utf8")), envelope);
  });
});

test("a spill-persistence failure reaches both consumers as the same bounded refusal", async () => {
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
    const refusal = assertBothConsumersAgree(result);
    assert.equal(refusal.schema_version, "mcp-response-refusal.v1");
    assert.equal(refusal.code, "mcp_response.spill_persistence_failed.v1");
    assert.equal(refusal.content_reference, undefined);
    assert.equal(typeof refusal.cause_diagnostic, "string");
    assert.ok(refusal.cause_diagnostic.length > 0);
    assert.ok(!JSON.stringify(result).includes("refusal-payload-marker"));
    assertCompleteResultWithinLimit(result);
  });
});

test("a registered handler's already-formed result reaches both consumers equivalently", async () => {
  await withSpillDirectory(async (stateDir) => {
    const env = spillEnv(stateDir);
    const payload = { schema_version: "already-formed.v1", ok: true, items: ["a", "b"] };

    const guarded = guardToolHandler(
      async () => ({
        content: [{ type: "text", text: "handler-authored summary line" }],
        structuredContent: payload
      }),
      { name: "already-formed-tool", env }
    );

    const result = await guarded({});

    const recovered = assertBothConsumersAgree(result);
    assert.deepEqual(recovered, payload);
    assert.ok(!JSON.stringify(result).includes("handler-authored summary line"));
    assertCompleteResultWithinLimit(result);
  });
});
