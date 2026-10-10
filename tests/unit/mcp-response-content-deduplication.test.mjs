

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
  isLosslessMcpSpillDelivery,
  jsonContent,
  measureMcpInlineResultBytes,
  measureMcpSerializedResultBytes,
  normalizeMcpToolResult,
  readSpilledMcpContentReference,
  structuredToolResult
} from "../../packages/wiki-mcp/src/lib/mcp-response.mjs";

import {
  CARRIER_FINDING_KINDS,
  assertStructuredCarrier,
  deliveredAdmissionBytes,
  structuredCarrierFindings
} from "../helpers/mcp-journey-accounting.mjs";

const INLINE_BYTE_LIMIT = 8192;

function utf8Bytes(value) {
  return Buffer.byteLength(value, "utf8");
}

function readCarrier(result, options = {}) {
  const value = assertStructuredCarrier(result, options);
  const parsed = CallToolResultSchema.safeParse(result);
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
  assert.deepEqual(parsed.data.structuredContent, result.structuredContent);
  assert.deepEqual(parsed.data.content, result.content);
  return value;
}

function textAlone(result) {
  const texts = result.content.filter((block) => block.type === "text");
  assert.equal(texts.length, 1);
  return JSON.parse(texts[0].text);
}

function physicalBytes(result) {
  return utf8Bytes(JSON.stringify(result));
}

function assertAdmittedWithinLimit(result, limit = INLINE_BYTE_LIMIT) {
  const bytes = deliveredAdmissionBytes(result);
  assert.ok(bytes <= limit, `result admitted ${bytes} bytes against a ${limit}-byte limit`);
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

function payloadWithAdmissionBytes(targetBytes) {
  const prefix = "quote \" backslash \\ newline \n tab \t é 🔥 ";
  const at = (padding) => ({
    schema_version: "boundary-response.v1",
    value: `${prefix}${"x".repeat(padding)}`
  });
  const payload = at(targetBytes - utf8Bytes(JSON.stringify(at(0))));
  assert.equal(utf8Bytes(JSON.stringify(payload)), targetBytes);
  return payload;
}

function handFrame(value, { isError = false } = {}) {
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value,
    ...(isError ? { isError: true } : {}) };
}

test("a success publishes its value in structuredContent and its compact serialization in one text block", () => {
  const payload = {
    schema_version: "example-success.v1",
    ok: true,
    marker: "success-payload-marker",
    nested: { items: [1, 2, 3], note: "quotes \" and \\ backslashes survive escaping" }
  };

  const result = jsonContent(payload);

  assert.deepEqual(readCarrier(result), payload);
  assert.equal(result.isError, undefined);
  assert.deepEqual(result, structuredToolResult(payload));

  assert.deepEqual(result.content, [{ type: "text", text: JSON.stringify(payload) }]);
  assert.deepEqual(textAlone(result), result.structuredContent);
  assertAdmittedWithinLimit(result, getResponseSpillConfig().inlineByteLimit);
});

test("a structured error publishes its envelope in both representations and keeps isError", () => {
  const envelope = {
    schema_version: "example-error.v1",
    code: "example_refusal",
    message: "error-payload-marker",
    details: { retryable: false }
  };

  const result = errorContent({ envelope });

  assert.equal(result.isError, true);
  assert.deepEqual(readCarrier(result), envelope);
  assert.deepEqual(textAlone(result), envelope);
  assertAdmittedWithinLimit(result, getResponseSpillConfig().inlineByteLimit);
});

test("an unstructured throw is translated once into the structured refusal carrier", () => {
  const message = `failure ${"🔥".repeat(400)}`;
  const result = errorContent(new Error(message));

  assert.equal(result.isError, true);
  const envelope = readCarrier(result);
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

  const fromText = textAlone(result);
  assert.deepEqual(fromText, envelope);
  assert.equal(fromText.diagnostic, message);
  assert.equal(fromText.refusal.code, "mcp_response.handler_exception.v1");
});

test("inline admission is exact at the larger-representation boundary with escaped and Unicode payloads", async () => {
  await withSpillDirectory(async (stateDir) => {
    const env = spillEnv(stateDir);
    for (const isError of [false, true]) {
      const atLimit = payloadWithAdmissionBytes(INLINE_BYTE_LIMIT);
      assert.equal(measureMcpInlineResultBytes(atLimit, { isError }), INLINE_BYTE_LIMIT);
      const inline = isError
        ? errorContent({ envelope: atLimit }, { env })
        : jsonContent(atLimit, { env });
      assert.deepEqual(readCarrier(inline), atLimit);
      assert.deepEqual(textAlone(inline), atLimit);
      assert.deepEqual(inline, handFrame(atLimit, { isError }));
      assert.equal(utf8Bytes(JSON.stringify(inline.structuredContent)), INLINE_BYTE_LIMIT);
      assert.equal(utf8Bytes(inline.content[0].text), INLINE_BYTE_LIMIT);

      assert.ok(physicalBytes(inline) > 2 * INLINE_BYTE_LIMIT, `${physicalBytes(inline)}`);
      assert.equal(inline.isError, isError ? true : undefined);

      const overLimit = payloadWithAdmissionBytes(INLINE_BYTE_LIMIT + 1);
      assert.equal(measureMcpInlineResultBytes(overLimit, { isError }), INLINE_BYTE_LIMIT + 1);
      const spilled = isError
        ? errorContent({ envelope: overLimit }, { env })
        : jsonContent(overLimit, { env });
      const envelope = readCarrier(spilled);
      assert.equal(envelope.response_spilled, true);
      assert.equal(spilled.isError, isError ? true : undefined);
      assert.deepEqual(envelope.measurement, {
        schema_version: "mcp-response-spill-measurement.v2",
        compared: "admission_bytes_exceeded_inline_byte_limit",
        admission_bytes: INLINE_BYTE_LIMIT + 1,
        serialized_result_bytes: physicalBytes(handFrame(overLimit, { isError })),
        inline_byte_limit: INLINE_BYTE_LIMIT,
        retained_payload_bytes: utf8Bytes(JSON.stringify(overLimit, null, 2)),
        retained_payload_encoding: "application/json; charset=utf-8; indent=2",
        meaning: envelope.measurement.meaning
      });
      assert.match(envelope.measurement.meaning, /serialized_result_bytes .* was not compared/u);
      assertAdmittedWithinLimit(spilled);
      assert.deepEqual(
        JSON.parse(readReferenceToEnd(envelope.content_reference, env).toString("utf8")),
        overLimit
      );
    }
  });
});

test("a result whose larger representation fits stays inline although its combined frame exceeds the limit", async () => {
  await withSpillDirectory(async (stateDir) => {
    const env = spillEnv(stateDir);

    const payload = payloadWithAdmissionBytes(6_000);
    const direct = jsonContent(payload, { env });
    const guarded = await guardToolHandler(async () => ({ structuredContent: payload }), { name: "max", env })({});
    for (const result of [direct, guarded]) {
      assert.equal(result.structuredContent.response_spilled, undefined);
      assert.deepEqual(result, handFrame(payload));
      assert.deepEqual(readCarrier(result), payload);
      assert.deepEqual(textAlone(result), result.structuredContent);
      assert.ok(physicalBytes(result) > INLINE_BYTE_LIMIT, `${physicalBytes(result)}`);
      assert.equal(deliveredAdmissionBytes(result), 6_000);
    }

    assert.equal(measureMcpInlineResultBytes(payload), deliveredAdmissionBytes(guarded));

    for (const isError of [false, true]) {
      assert.equal(measureMcpSerializedResultBytes(payload, { isError }), physicalBytes(handFrame(payload, { isError })));
    }
    assert.equal(measureMcpSerializedResultBytes(payload), physicalBytes(guarded));
    assert.ok(measureMcpSerializedResultBytes(payload) > INLINE_BYTE_LIMIT);
    assert.equal(measureMcpSerializedResultBytes({ value: 1n }), Number.POSITIVE_INFINITY, "no JSON form");
    assert.strictEqual(normalizeMcpToolResult(guarded, { env }), guarded);
  });
});

test("the guard measures the regenerated mirror, not stale or additional handler text", async () => {
  await withSpillDirectory(async (stateDir) => {
    const env = spillEnv(stateDir);
    const payload = payloadWithAdmissionBytes(INLINE_BYTE_LIMIT);

    const result = await guardToolHandler(async () => ({
      content: [{ type: "text", text: "stale ".repeat(4_000) }, { type: "text", text: "extra" }],
      structuredContent: payload
    }), { name: "stale", env })({});
    assert.deepEqual(result, handFrame(payload));
  });
});

test("handler-added fields after the helper are admitted exactly at the boundary and spill one byte over", async () => {
  await withSpillDirectory(async (stateDir) => {
    const env = spillEnv(stateDir);
    for (const isError of [false, true]) {
      const base = { schema_version: "handler-mutated.v1", selected_unit: "WK-1#SLICE-1" };

      const padding = INLINE_BYTE_LIMIT - utf8Bytes(JSON.stringify(base)) - utf8Bytes(',"added":""');
      const mutate = (extra) => async () => {
        const shaped = isError ? errorContent({ envelope: base }, { env }) : jsonContent(base, { env });
        shaped.structuredContent = { ...shaped.structuredContent, added: `é${"y".repeat(padding - 2 + extra)}` };
        return shaped;
      };
      const fits = await guardToolHandler(mutate(0), { name: "mutated", env })({});
      assert.equal(utf8Bytes(JSON.stringify(fits.structuredContent)), INLINE_BYTE_LIMIT);
      assert.deepEqual(fits, handFrame(fits.structuredContent, { isError }));
      assert.equal(fits.structuredContent.added.length, padding - 1);

      const over = await guardToolHandler(mutate(1), { name: "mutated", env })({});
      const envelope = readCarrier(over);
      assert.equal(envelope.response_spilled, true);
      assert.equal(over.isError, isError ? true : undefined);
      assert.equal(envelope.measurement.admission_bytes, INLINE_BYTE_LIMIT + 1);
      const original = JSON.parse(readReferenceToEnd(envelope.content_reference, env).toString("utf8"));
      assert.equal(original.added, `é${"y".repeat(padding - 1)}`);
    }
  });
});

test("preserved protocol metadata and nonmirrored content are bounded in addition to the larger representation", async () => {
  await withSpillDirectory(async (stateDir) => {
    const env = spillEnv(stateDir);
    const payload = { schema_version: "meta-bearing.v1", ok: true };
    const _meta = { "example.org/trace": "t".repeat(128) };

    const small = normalizeMcpToolResult({ ...jsonContent(payload, { env }), _meta }, { env });
    assert.deepEqual(readCarrier(small), payload);
    assert.deepEqual(small._meta, _meta);

    const bigMeta = { "example.org/trace": "m\"é".repeat(80) };
    const metaBytes = utf8Bytes(JSON.stringify({ _meta: bigMeta }));
    const image = { type: "image", data: "aGVsbG8=".repeat(20), mimeType: "image/png" };
    const imageBytes = utf8Bytes(JSON.stringify({ content: [image] }));
    const extras = {
      _meta: [metaBytes, (result) => ({ ...result, _meta: bigMeta }), (result) => result._meta, bigMeta],
      nonmirrored_block: [imageBytes, (result) => ({ ...result, content: [...result.content, image] }),
        (result) => result.content.slice(1), [image]]
    };
    for (const [label, [extraBytes, attach, extract, expected]] of Object.entries(extras)) {
      const fitting = payloadWithAdmissionBytes(INLINE_BYTE_LIMIT - extraBytes);
      const inline = normalizeMcpToolResult(attach(jsonContent(fitting, { env })), { env });
      assert.equal(inline.structuredContent.response_spilled, undefined, label);
      assert.deepEqual(inline.structuredContent, fitting, label);
      assert.deepEqual(extract(inline), expected, label);
      assert.equal(deliveredAdmissionBytes(inline), INLINE_BYTE_LIMIT, label);

      const overflowing = payloadWithAdmissionBytes(INLINE_BYTE_LIMIT - extraBytes + 1);
      const spilled = normalizeMcpToolResult(attach(jsonContent(overflowing, { env })), { env });
      const envelope = spilled.structuredContent;
      assert.equal(envelope.response_spilled, true, label);
      assert.deepEqual(extract(spilled), expected, label);
      assert.equal(envelope.measurement.admission_bytes, INLINE_BYTE_LIMIT + 1, label);
      assert.equal(envelope.measurement.serialized_result_bytes,
        physicalBytes(attach(handFrame(overflowing))), label);
      assertAdmittedWithinLimit(spilled);
      assert.deepEqual(
        JSON.parse(readReferenceToEnd(envelope.content_reference, env).toString("utf8")),
        overflowing, label
      );
    }
  });
});

test("forced retention states that no admission comparison occurred", async () => {
  await withSpillDirectory(async (stateDir) => {
    const env = spillEnv(stateDir);
    const payload = { schema_version: "forced.v1", ok: true };
    const result = jsonContent(payload, { env, forceSpill: true });
    const { measurement } = readCarrier(result);
    assert.equal(measurement.compared, "not_compared_retention_forced");
    assert.equal(measurement.admission_bytes, null);
    assert.equal(measurement.serialized_result_bytes, null);
    assert.match(measurement.meaning, /no inline admission comparison occurred/u);
    assert.equal(isLosslessMcpSpillDelivery(result), true);
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
    const spilled = readCarrier(result);

    assert.equal(spilled.schema_version, "wiki-mcp-spilled-response.v1");
    assert.equal(spilled.response_spilled, true);
    assert.equal(spilled.content_reference.kind, "wiki_mcp_response_content_reference");
    assertAdmittedWithinLimit(result);

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
    const spilled = readCarrier(result);
    assert.equal(spilled.response_spilled, true);
    assertAdmittedWithinLimit(result);
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
    const refusal = readCarrier(result);
    assert.equal(refusal.schema_version, "mcp-response-refusal.v1");
    assert.equal(refusal.code, "mcp_response.spill_persistence_failed.v1");
    assert.equal(refusal.content_reference, undefined);
    assert.equal(refusal.cause_diagnostic.code, "ENOTDIR");
    assert.equal(refusal.cause_diagnostic.path, path.join(blocker, "response-spill"));
    assert.deepEqual(refusal.cause_diagnostic_redactions, []);
    assert.ok(!JSON.stringify(result).includes("refusal-payload-marker"));
    assertAdmittedWithinLimit(result);
  });
});

test("the public guard regenerates the one text representation over stale, conflicting or additional handler text", async () => {
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
    shapes.empty_content = async () => ({ content: [], structuredContent: payload });
    shapes.empty_text = async () => ({ content: [{ type: "text", text: "" }], structuredContent: payload });
    shapes.reordered_json_text = async () => ({
      content: [{ type: "text", text: JSON.stringify({ items: ["a", "b"], ok: true,
        schema_version: "already-formed.v1" }, null, 2) }],
      structuredContent: payload
    });
    for (const [shape, handler] of Object.entries(shapes)) {
      const result = await guardToolHandler(handler, { name: shape, env })({});
      assert.ok(utf8Bytes(JSON.stringify(result)) < INLINE_BYTE_LIMIT, shape);
      assert.deepEqual(readCarrier(result), payload, shape);
      assert.deepEqual(result.content, [{ type: "text", text: JSON.stringify(payload) }], shape);
      assert.ok(!JSON.stringify(result).includes("handler-authored summary line"), shape);
      assert.ok(!JSON.stringify(result).includes("stale pointer"), shape);

      assert.strictEqual(normalizeMcpToolResult(result, { env }), result, shape);
    }

    const mixed = await guardToolHandler(async () => ({
      content: [{ type: "text", text: "handler-authored summary line" }, image],
      structuredContent: payload
    }), { name: "mixed", env })({});
    assert.deepEqual(mixed.content, [{ type: "text", text: JSON.stringify(payload) }, image]);
    assert.deepEqual(mixed.structuredContent, payload);
    assert.deepEqual(readCarrier(mixed, { permitNonTextBlocks: true }), payload);
    assert.deepEqual(structuredCarrierFindings(mixed).findings,
      [{ kind: CARRIER_FINDING_KINDS.CONTENT_BESIDE_STRUCTURED, block_type: "image" }]);
    assert.strictEqual(normalizeMcpToolResult(mixed, { env }), mixed);
  });
});

test("a result already on the contract passes the guard unchanged", async () => {
  const shaped = jsonContent({ ok: true });
  assert.equal(normalizeMcpToolResult(shaped), shaped);
  assert.equal(normalizeMcpToolResult(normalizeMcpToolResult(shaped)), shaped);
});

test("the shared carrier predicate names each broken representation below the byte limit", () => {
  const value = { schema_version: "control.v1", code: "example_refusal", subject: "OBL-1" };
  const text = JSON.stringify(value);
  const kinds = (result) => structuredCarrierFindings(result).findings.map(({ kind, reason }) =>
    reason === undefined ? kind : `${kind}:${reason}`);
  assert.deepEqual(kinds({ content: [{ type: "text", text }], structuredContent: value, isError: true }), []);
  const controls = {
    missing: [{ content: [], structuredContent: value, isError: true },
      [CARRIER_FINDING_KINDS.TEXT_MISSING]],
    empty: [{ content: [{ type: "text", text: "" }], structuredContent: value },
      [CARRIER_FINDING_KINDS.TEXT_EMPTY]],
    mismatched: [{ content: [{ type: "text", text: JSON.stringify({ ...value, subject: "OBL-2" }) }],
      structuredContent: value }, [`${CARRIER_FINDING_KINDS.TEXT_DISAGREES}:meaning`]],
    generic_error_text: [{ content: [{ type: "text", text: "Unknown error" }], structuredContent: value,
      isError: true }, [`${CARRIER_FINDING_KINDS.TEXT_DISAGREES}:meaning`]],
    not_compact: [{ content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
      structuredContent: value }, [`${CARRIER_FINDING_KINDS.TEXT_DISAGREES}:serialization`]],
    additional: [{ content: [{ type: "text", text }, { type: "text", text }], structuredContent: value },
      [CARRIER_FINDING_KINDS.TEXT_ADDITIONAL]],
    missing_structured: [{ content: [{ type: "text", text }] },
      [CARRIER_FINDING_KINDS.STRUCTURED_MEANING_MISSING]]
  };
  for (const [label, [result, expected]] of Object.entries(controls)) {
    assert.ok(utf8Bytes(JSON.stringify(result)) < INLINE_BYTE_LIMIT, label);
    assert.deepEqual(kinds(result), expected, label);
    assert.throws(() => assertStructuredCarrier(result), assert.AssertionError, label);
  }

  assert.deepEqual(structuredCarrierFindings({ content: [{ type: "text", text: "plain" }], isError: true }),
    { structured: false, unstructured_error: true, text_bytes: 0, findings: [] });
});

test("inline admission is exact at both the production default and the supported minimum limit", async () => {
  await withSpillDirectory(async (stateDir) => {
    const productionDefault = getResponseSpillConfig({ WIKI_MCP_RESPONSE_STATE_DIR: stateDir });

    const minimum = getResponseSpillConfig({ WIKI_MCP_RESPONSE_STATE_DIR: stateDir,
      WIKI_MCP_RESPONSE_INLINE_BYTE_LIMIT: "1024" });
    assert.equal(productionDefault.inlineByteLimit, 128 * 1024);
    assert.equal(minimum.inlineByteLimit, INLINE_BYTE_LIMIT);
    for (const [label, env] of [
      ["production_default", { WIKI_MCP_RESPONSE_STATE_DIR: stateDir }],
      ["supported_minimum", { WIKI_MCP_RESPONSE_STATE_DIR: stateDir, WIKI_MCP_RESPONSE_INLINE_BYTE_LIMIT: "1024" }]
    ]) {
      const limit = getResponseSpillConfig(env).inlineByteLimit;
      for (const isError of [false, true]) {
        const atLimit = payloadWithAdmissionBytes(limit);
        const inline = isError ? errorContent({ envelope: atLimit }, { env }) : jsonContent(atLimit, { env });
        assert.deepEqual(readCarrier(inline), atLimit, label);
        assert.deepEqual(textAlone(inline), atLimit, label);
        assert.deepEqual(inline, handFrame(atLimit, { isError }), label);
        assert.ok(physicalBytes(inline) > 2 * limit, label);

        const overLimit = payloadWithAdmissionBytes(limit + 1);
        const spilled = isError ? errorContent({ envelope: overLimit }, { env }) : jsonContent(overLimit, { env });
        const envelope = readCarrier(spilled);
        assert.equal(envelope.response_spilled, true, label);
        assert.equal(envelope.measurement.admission_bytes, limit + 1, label);
        assert.equal(envelope.measurement.serialized_result_bytes,
          physicalBytes(handFrame(overLimit, { isError })), label);
        assert.equal(spilled.isError, isError ? true : undefined, label);
        assertAdmittedWithinLimit(spilled, limit);
        assert.deepEqual(textAlone(spilled), envelope, label);
      }
    }
  });
});

test("the lossless spill recognizer admits exactly one generated text agreeing with the minted envelope", async () => {
  await withSpillDirectory(async (stateDir) => {
    const env = spillEnv(stateDir);
    const spilled = jsonContent({ value: "s".repeat(INLINE_BYTE_LIMIT * 2) }, { env });
    assert.equal(isLosslessMcpSpillDelivery(spilled), true);
    const envelope = spilled.structuredContent;
    const variants = {
      no_text: { content: [], structuredContent: envelope },
      stale_text: { content: [{ type: "text", text: JSON.stringify({ ...envelope, total_bytes: 1 }) }],
        structuredContent: envelope },
      indented_text: { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }],
        structuredContent: envelope },
      additional_text: { content: [...spilled.content, ...spilled.content], structuredContent: envelope },
      extra_block_field: { content: [{ ...spilled.content[0], annotations: {} }], structuredContent: envelope },
      caller_field: { ...structuredToolResult({ ...envelope, extra: true }) }
    };
    for (const [label, variant] of Object.entries(variants)) {
      assert.equal(isLosslessMcpSpillDelivery(variant), false, label);
    }
  });
});

test("legitimate unstructured text results are left intact", async () => {
  const plain = { content: [{ type: "text", text: "plain text result" }] };
  assert.equal(normalizeMcpToolResult(plain), plain);
  const guarded = await guardToolHandler(async () => plain, { name: "plain" })({});
  assert.deepEqual(guarded, { content: [{ type: "text", text: "plain text result" }] });
});

test("the installed SDK client receives every structured shape with its one generated text representation", async () => {
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

      const success = await call("success");
      assert.deepEqual(readCarrier(success), { ok: true, marker: "é 🔥 \"q\"" });
      assert.equal(success.content[0].text, '{"ok":true,"marker":"é 🔥 \\"q\\""}');
      const error = await call("structured_error");
      assert.equal(error.isError, true);
      assert.deepEqual(readCarrier(error), { code: "example_refusal", ok: false });
      assert.deepEqual(textAlone(error), { code: "example_refusal", ok: false });
      const thrown = await call("thrown");
      assert.equal(thrown.isError, true);
      assert.equal(readCarrier(thrown).diagnostic, "thrown-marker");
      assert.equal(textAlone(thrown).diagnostic, "thrown-marker");
      const spilled = readCarrier(await call("spilled"));
      assert.equal(spilled.response_spilled, true);
      assert.deepEqual(
        JSON.parse(readReferenceToEnd(spilled.content_reference, env).toString("utf8")),
        { value: "s".repeat(INLINE_BYTE_LIMIT * 2) }
      );
      assert.deepEqual(readCarrier(await call("handler_text")), { ok: true, marker: "m" });
      assert.deepEqual((await call("plain_text")).content,
        [{ type: "text", text: "plain text result" }]);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
