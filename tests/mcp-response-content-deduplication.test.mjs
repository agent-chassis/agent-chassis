import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  errorContent,
  jsonContent,
  readSpilledMcpContentReference
} from "../packages/wiki-mcp/src/lib/mcp-response.mjs";

const DESCRIPTOR_BYTE_LIMIT = 512;
const RESPONSE_OVERHEAD_BYTE_LIMIT = 1024;

function utf8Bytes(value) {
  return Buffer.byteLength(value, "utf8");
}

function serializedBytes(value) {
  return utf8Bytes(JSON.stringify(value));
}

function assertBoundedDescriptor(result) {
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].type, "text");
  assert.ok(
    utf8Bytes(result.content[0].text) <= DESCRIPTOR_BYTE_LIMIT,
    `descriptor exceeded ${DESCRIPTOR_BYTE_LIMIT} UTF-8 bytes`
  );
}

function assertSingleCopyBudget(result, payload) {
  const payloadBytes = serializedBytes(payload);
  const responseBytes = serializedBytes(result);
  assert.ok(
    responseBytes <= payloadBytes + RESPONSE_OVERHEAD_BYTE_LIMIT,
    `response used ${responseBytes} bytes for a ${payloadBytes}-byte payload`
  );
}

async function withSpillDirectory(callback) {
  const stateDir = await mkdtemp(path.join(tmpdir(), "wiki-mcp-response-dedup-"));
  try {
    return await callback(stateDir);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
}

test("small success keeps the payload only in structuredContent", () => {
  const payload = {
    schema_version: "example-success.v1",
    ok: true,
    marker: "success-payload-marker"
  };

  const result = jsonContent(payload);

  assert.deepEqual(result.structuredContent, payload);
  assertBoundedDescriptor(result);
  assert.match(result.content[0].text, /available in structuredContent/u);
  assert.doesNotMatch(result.content[0].text, /success-payload-marker/u);
  assert.equal(JSON.stringify(result).split("success-payload-marker").length - 1, 1);
  assertSingleCopyBudget(result, payload);
});

test("small structured error keeps the complete envelope only in structuredContent", () => {
  const envelope = {
    schema_version: "example-error.v1",
    code: "example_refusal",
    message: "error-payload-marker",
    details: { retryable: false }
  };

  const result = errorContent({ envelope });

  assert.equal(result.isError, true);
  assert.deepEqual(result.structuredContent, envelope);
  assertBoundedDescriptor(result);
  assert.match(result.content[0].text, /error envelope is available in structuredContent/u);
  assert.doesNotMatch(result.content[0].text, /error-payload-marker|example_refusal/u);
  assert.equal(JSON.stringify(result).split("error-payload-marker").length - 1, 1);
  assertSingleCopyBudget(result, envelope);

  const longUnstructured = errorContent(new Error(`failure ${"🔥".repeat(400)}`));
  assert.equal(longUnstructured.structuredContent, undefined);
  assertBoundedDescriptor(longUnstructured);
  assert.match(longUnstructured.content[0].text, /…$/u);
});

test("single-copy boundary response stays inline with a bounded descriptor", async () => {
  await withSpillDirectory(async (stateDir) => {
    const payload = {
      schema_version: "boundary-response.v1",
      value: `boundary-payload-marker-${"x".repeat(7_500)}`
    };
    const env = {
      WIKI_MCP_RESPONSE_INLINE_BYTE_LIMIT: "8192",
      WIKI_MCP_RESPONSE_STATE_DIR: stateDir
    };

    const result = jsonContent(payload, { env });

    assert.deepEqual(result.structuredContent, payload);
    assert.notEqual(result.structuredContent.schema_version, "wiki-mcp-spilled-response.v1");
    assertBoundedDescriptor(result);
    assert.doesNotMatch(result.content[0].text, /boundary-payload-marker/u);
    assertSingleCopyBudget(result, payload);
  });
});

test("spilled response preserves its content reference and ranged continuation", async () => {
  await withSpillDirectory(async (stateDir) => {
    const payload = {
      schema_version: "spilled-response-source.v1",
      value: `spilled-payload-marker-${"x".repeat(9_000)}`
    };
    const env = {
      WIKI_MCP_RESPONSE_INLINE_BYTE_LIMIT: "8192",
      WIKI_MCP_RESPONSE_PREVIEW_BYTE_LIMIT: "512",
      WIKI_MCP_RESPONSE_REFERENCE_READ_BYTE_LIMIT: "1024",
      WIKI_MCP_RESPONSE_STATE_DIR: stateDir
    };

    const result = jsonContent(payload, { env });
    const spilled = result.structuredContent;

    assert.equal(spilled.schema_version, "wiki-mcp-spilled-response.v1");
    assert.equal(spilled.response_spilled, true);
    assert.equal(spilled.content_reference.kind, "wiki_mcp_response_content_reference");
    assert.deepEqual(JSON.parse(result.content[0].text), spilled);

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
