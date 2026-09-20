import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import {
  WORK_RECORD_CONTENT_MAX_PARTS,
  WORK_RECORD_ENTRY_METADATA_PAGE_MAX,
  WORK_RECORD_SELECTION_MAX_UTF8_BYTES,
  WORK_RECORD_TEXT_PAGE_MAX_SCALARS,
} from "../../packages/wiki-core/src/lib/work-record-entry-schema.mjs";
import {
  WORKSPACE_WORK_RECORD_ENTRY_READ_TOOL_NAME,
  WORKSPACE_WORK_RECORD_ENTRY_UPSERT_TOOL_NAME,
  entryReadResultUsesCompactGuard,
  registerWorkRecordEntryTools
} from "../../packages/wiki-mcp/src/lib/work-record-entry-tools.mjs";
import { WORK_RECORD_COMPACT_RESULT_MAX_UTF8_BYTES } from
  "../../packages/wiki-core/src/lib/work-record-entry-schema.mjs";

test("the compact guard follows the returned result kind, not the request", () => {
  const oversized = "x".repeat(WORK_RECORD_COMPACT_RESULT_MAX_UTF8_BYTES * 2);
  const body = (value) => ({ ok: true, entry_id: 1, version_id: 1, source_digest: `sha256:${"a".repeat(64)}`,
    body: { value, offset: 0, length: value.length, total: value.length }, next_calls: [] });
  for (const exempt of [body(oversized), body("")]) {
    assert.equal(entryReadResultUsesCompactGuard(exempt), false, "a returned body is never compact-guarded");
  }
  const guarded = [

    { ok: false, valid: false, written: false, diagnostics: [{ code: "stale_source_digest", message: oversized }] },
    { ok: false, valid: false, written: false, diagnostics: [{ code: "work_record_entry_range_invalid" }] },
    { ok: false, valid: false, written: false, diagnostics: [{ code: "work_record_reference_source_denied" }] },

    { ok: true, entry_id: 1, version_id: 1, scalar_length: 3, utf8_bytes: 3, next_calls: [] },
    { ok: true, entries: [], offset: 0, total_count: 0, next_calls: [] },
    { ok: true, entry_id: 1, versions: [], offset: 0, total_count: 0, next_calls: [] },
    { ok: true, entry_id: 1, version_id: 1, reference: "wkentry.v1.opaque" },
    { ok: true, entry_id: 1, version_id: 1, selection: { state: "unique" }, next_calls: [] }
  ];
  for (const result of guarded) {
    assert.equal(entryReadResultUsesCompactGuard(result), true, JSON.stringify(result).slice(0, 80));
  }
});

function registeredInputSchemas() {
  const captured = new Map();
  registerWorkRecordEntryTools({
    registerTool: (name, config) => { captured.set(name, config.inputSchema); },
    workspaceRepos: {},
    z,
    jsonContent: (value) => value,
    errorContent: (error) => error,
    resolveWorkspaceRepo: () => ({ dir: "/nonexistent", repo: "test/repo" })
  });
  return captured;
}

const SCHEMAS = registeredInputSchemas();
const DIGEST = `sha256:${"a".repeat(64)}`;
const BASE = { unit: "WK-0001" };

function accepts(schema, value) {
  return schema.safeParse(value).success;
}

test("the upsert input schema accepts current content alternatives and create/version forms", () => {
  const schema = SCHEMAS.get(WORKSPACE_WORK_RECORD_ENTRY_UPSERT_TOOL_NAME);
  assert.ok(schema, "the upsert route must register an input schema");
  const accepted = [
    { ...BASE, title: "Design", content: { text: "body" }, expected_source_digest: DIGEST },
    { ...BASE, title: "Design", content: { ref: "wkentry.v1.opaque" }, expected_source_digest: DIGEST },
    { ...BASE, title: "Design", content: { parts: [{ text: "one" }, { ref: "opaque" }] }, expected_source_digest: DIGEST },
    { ...BASE, entry_id: 1, expected_source_digest: DIGEST },
    { ...BASE, entry_id: 1, content: { text: "body" }, expected_source_digest: DIGEST }
  ];
  const refused = [
    { ...BASE, expected_source_digest: DIGEST },
    { ...BASE, title: "Design", expected_source_digest: DIGEST },
    { ...BASE, content: { text: "body" }, expected_source_digest: DIGEST },
    { ...BASE, title: "Design", content: "body", expected_source_digest: DIGEST },
    { ...BASE, title: "Design", content: { text: "body", ref: "opaque" }, expected_source_digest: DIGEST },
    { ...BASE, title: "Design", content: { unknown: "body" }, expected_source_digest: DIGEST },
    { ...BASE, title: "Design", content: { parts: [] }, expected_source_digest: DIGEST },
    { ...BASE, title: "Design", content: { parts: [{ text: "body", nested: { text: "bad" } }] }, expected_source_digest: DIGEST },
    { ...BASE, title: "Design", content: { parts: [{ parts: [{ text: "nested" }] }] }, expected_source_digest: DIGEST }
  ];
  for (const candidate of accepted) assert.equal(accepts(schema, candidate), true, JSON.stringify(candidate));
  for (const candidate of refused) assert.equal(accepts(schema, candidate), false, JSON.stringify(candidate));
});

test("the upsert content schema bounds parts and requires scalar text and nonempty refs", () => {
  const schema = SCHEMAS.get(WORKSPACE_WORK_RECORD_ENTRY_UPSERT_TOOL_NAME);
  const create = (content) => ({ ...BASE, title: "Design", content, expected_source_digest: DIGEST });
  const parts = (count) => ({ parts: Array.from({ length: count }, (_, index) => ({ text: `part ${index}` })) });
  const loneSurrogate = "bad\uD800";

  assert.equal(accepts(schema, create(parts(WORK_RECORD_CONTENT_MAX_PARTS))), true,
    `${WORK_RECORD_CONTENT_MAX_PARTS} parts must parse`);
  const refused = [
    create(parts(WORK_RECORD_CONTENT_MAX_PARTS + 1)),
    create({ ref: "" }),
    create({ parts: [{ ref: "" }] }),
    create({ text: loneSurrogate }),
    create({ ref: loneSurrogate }),
    create({ parts: [{ text: loneSurrogate }] }),
    create({ parts: [{ ref: loneSurrogate }] })
  ];
  for (const candidate of refused) {
    assert.equal(accepts(schema, candidate), false, `upsert schema accepted ${JSON.stringify(candidate.content).slice(0, 80)}`);
  }
});

test("the upsert input schema enforces its per-field constraints", () => {
  const upsert = SCHEMAS.get(WORKSPACE_WORK_RECORD_ENTRY_UPSERT_TOOL_NAME);

  const cases = [
    { ...BASE, title: "T", content: { text: "body" }, expected_source_digest: "not-a-digest" },
    { ...BASE, title: 7, content: { text: "body" }, expected_source_digest: DIGEST },
    { ...BASE, title: "T", content: { text: "body" }, expected_source_digest: DIGEST, surprise: 1 },
    { ...BASE, entry_id: 0, expected_source_digest: DIGEST },
    { ...BASE, entry_id: 1.5, expected_source_digest: DIGEST },
    { title: "T", content: { text: "body" }, expected_source_digest: DIGEST }
  ];
  for (const candidate of cases) assert.equal(accepts(upsert, candidate), false, JSON.stringify(candidate));
});

test("both routes register a refined object rather than a union", () => {
  for (const name of [
    WORKSPACE_WORK_RECORD_ENTRY_UPSERT_TOOL_NAME,
    WORKSPACE_WORK_RECORD_ENTRY_READ_TOOL_NAME
  ]) {
    const schema = SCHEMAS.get(name);
    assert.equal(schema._def.typeName, "ZodEffects", `${name} must register a refined schema`);
    let inner = schema;
    while (inner._def.typeName === "ZodEffects") inner = inner._def.schema;
    assert.equal(inner._def.typeName, "ZodObject", `${name} refinements must wrap a ZodObject`);
    assert.equal(inner._def.unknownKeys, "strict", `${name} must reject unknown keys`);
    assert.ok(Object.keys(inner.shape).length > 0, `${name} must publish its fields`);
  }
});

import { WORK_RECORD_ENTRY_BODY_PAGE_MAX_SCALARS } from
  "../../packages/wiki-core/src/lib/work-record-entry-schema.mjs";

const READ_FIELDS = ["repo", "unit", "entry_id", "version", "view", "include_body", "reference_only", "offset",
  "length", "limit", "expected_source_digest", "selection", "continuation"];

test("the lean read schema publishes every closed branch field on one strict object", () => {
  let inner = SCHEMAS.get(WORKSPACE_WORK_RECORD_ENTRY_READ_TOOL_NAME);
  assert.equal(inner._def.typeName, "ZodEffects", "the read route must register a refined schema");
  while (inner._def.typeName === "ZodEffects") inner = inner._def.schema;
  assert.equal(inner._def.unknownKeys, "strict");
  assert.deepEqual(Object.keys(inner.shape).sort(), [...READ_FIELDS].sort());
});

test("the lean read schema admits exactly one closed branch per request", () => {
  const read = SCHEMAS.get(WORKSPACE_WORK_RECORD_ENTRY_READ_TOOL_NAME);
  const entry = { ...BASE, entry_id: 1 };
  const accepted = [
    { ...BASE },
    { ...BASE, repo: "demo", limit: WORK_RECORD_ENTRY_METADATA_PAGE_MAX },
    { ...BASE, limit: 2, offset: 4, expected_source_digest: DIGEST },
    { ...BASE, offset: 0 },
    { ...entry, view: "history" },
    { ...entry, view: "history", limit: 1, offset: 1, expected_source_digest: DIGEST },
    { ...entry },
    { ...entry, version: 2 },
    { ...entry, include_body: true },
    { ...entry, include_body: true, version: 2, offset: 512, length: WORK_RECORD_TEXT_PAGE_MAX_SCALARS },
    { ...entry, include_body: true, offset: 0, length: 1 },
    { ...entry, include_body: true, length: WORK_RECORD_ENTRY_BODY_PAGE_MAX_SCALARS },

    { ...entry, include_body: true, version: 1, length: WORK_RECORD_ENTRY_BODY_PAGE_MAX_SCALARS + 1 },
    { ...entry, include_body: true, version: 1, offset: 3, length: Number.MAX_SAFE_INTEGER },

    { ...entry, include_body: true, expected_source_digest: DIGEST },
    { ...entry, include_body: true, version: 2, offset: 8192, length: WORK_RECORD_ENTRY_BODY_PAGE_MAX_SCALARS,
      expected_source_digest: DIGEST },
    { ...entry, reference_only: true },
    { ...entry, reference_only: true, offset: 3 },
    { ...entry, reference_only: true, version: 1, offset: 0, length: WORK_RECORD_TEXT_PAGE_MAX_SCALARS },
    { ...entry, reference_only: true, version: 1, offset: 0, length: WORK_RECORD_TEXT_PAGE_MAX_SCALARS + 1 },
    { ...entry, selection: { text: "ab" } },
    { ...entry, selection: { text: "ab" }, version: 1 },
    { ...BASE, continuation: "wkchoice.v2.1.1.0.2.0.-.checksum" }
  ];
  const refused = [
    { ...BASE, offset: 1 },
    { ...BASE, version: 1 },
    { ...BASE, include_body: true },
    { ...entry, view: "history", offset: 1 },
    { ...entry, view: "history", version: 1 },
    { ...entry, view: "current" },
    { ...entry, offset: 0 },
    { ...entry, limit: 1 },
    { ...entry, expected_source_digest: DIGEST },
    { ...entry, include_body: false },
    { ...entry, include_body: true, offset: 1 },
    { ...entry, include_body: true, reference_only: true },
    { ...entry, include_body: true, length: 0 },
    { ...entry, include_body: true, length: 1.5 },
    { ...entry, include_body: true, length: Number.MAX_SAFE_INTEGER + 1 },
    { ...entry, include_body: true, expected_source_digest: "not-a-digest" },
    { ...entry, reference_only: true, length: 0 },
    { ...entry, include_body: true, version: 1, offset: -1 },
    { ...entry, include_body: true, version: 1, offset: 1.5 },
    { ...entry, include_body: true, version: 1, offset: Number.MAX_SAFE_INTEGER + 1 },
    { ...entry, reference_only: false },
    { ...entry, reference_only: true, limit: 1 },
    { ...entry, reference_only: true, selection: { text: "ab" } },
    { ...entry, selection: { text: "ab" }, length: 1 },
    { ...entry, selection: { text: "" } },
    { ...entry, selection: { text: "ab", extra: 1 } },
    { ...entry, selection: { text: "x".repeat(WORK_RECORD_SELECTION_MAX_UTF8_BYTES + 1) } },
    { ...BASE, continuation: "" },
    { ...BASE, continuation: "wkchoice.v2.1.1.0.2.0.-.checksum", entry_id: 1 },
    { ...BASE, limit: WORK_RECORD_ENTRY_METADATA_PAGE_MAX + 1 },
    { ...BASE, expected_source_digest: "not-a-digest" },
    { ...BASE, surprise: 1 },
    { entry_id: 1 }
  ];
  for (const candidate of accepted) {
    assert.equal(accepts(read, candidate), true, `read schema refused ${JSON.stringify(candidate)}`);
  }
  for (const candidate of refused) {
    assert.equal(accepts(read, candidate), false, `read schema accepted ${JSON.stringify(candidate)}`);
  }
});
