import assert from "node:assert/strict";
import test from "node:test";
import { projectOrdinaryFieldRead, ordinaryFieldSelectionIssues } from
  "../../packages/wiki-core/src/lib/work-record-ordinary-field-read.mjs";
import { decodeWorkRecordTextReference } from
  "../../packages/wiki-core/src/lib/work-record-entry-content.mjs";
import { runWorkRecordSummaryWithCompactGate } from
  "../../packages/wiki-mcp/src/lib/work-record-compact-read-gate.mjs";
import { z } from "zod";
import { ordinaryFieldReadAdvertisedSchema, ordinaryFieldReadSchema } from
  "../../packages/wiki-mcp/src/lib/work-record-ordinary-field-read.mjs";
import { projectZodRequestContract } from
  "../../packages/wiki-mcp/src/lib/zod-request-contract-projection.mjs";
import { createRegisteredToolRequestContractStore } from
  "../../packages/wiki-mcp/src/lib/registered-tool-request-contracts.mjs";
import { WORK_RECORD_COMPACT_RESULT_MAX_UTF8_BYTES, WORK_RECORD_SELECTION_MAX_UTF8_BYTES } from
  "../../packages/wiki-core/src/lib/work-record-entry-schema.mjs";

const NUL = String.fromCharCode(0);
const ROCKET = String.fromCodePoint(0x1f680);

function expanded(projection, node = projection.contract) {
  if (Array.isArray(node)) return node.map((entry) => expanded(projection, entry));
  if (node === null || typeof node !== "object") return node;
  if (typeof node.$ref === "string") return expanded(projection, projection.$defs[node.$ref.split("/").at(-1)]);
  return Object.fromEntries(Object.entries(node).map(([key, entry]) => [key, expanded(projection, entry)]));
}

test("the enforced and advertised ordinary-field selectors state the same field bounds", () => {
  const full = ordinaryFieldReadSchema(z);
  const advertised = ordinaryFieldReadAdvertisedSchema(z);
  const enforcedVariants = expanded(projectZodRequestContract(full)).anyOf;
  const declared = expanded(projectZodRequestContract(advertised)).properties;
  for (const key of ["offset", "length", "limit", "index", "text", "reference_only", "selection"]) {
    const enforced = enforcedVariants.map(({ properties }) => properties[key]).filter(Boolean);
    assert.ok(enforced.length > 0, `${key} is an enforced field`);
    for (const node of enforced) assert.deepEqual(declared[key], node, `${key} is declared as enforced`);
  }
  const members = new Set(enforcedVariants.flatMap(({ properties }) =>
    properties.member === undefined ? [] : properties.member.enum ?? [properties.member.const]));
  assert.deepEqual([...members].sort(), [...declared.member.enum].sort(), "every enforced member is advertised");

  const store = createRegisteredToolRequestContractStore();
  store.retain("ordinary_field_fixture", { inputSchema: full, publishedInputSchema: advertised });
  const published = store.lookup.contractFor("ordinary_field_fixture").publishedRequestSchema();
  assert.equal(published.properties.length.maximum, undefined,
    "selected text has no reader page cap for tools/list to advertise");
  for (const [length, accepted] of [[0, false], [1.5, false], [1, true], [1_000_000, true]]) {
    for (const [label, schema] of [["enforced", full], ["advertised", advertised]]) {
      assert.equal(schema.safeParse({ field: "sections.summary", length }).success, accepted,
        `${label} length ${length}`);
    }
  }
  assert.equal(full.safeParse({ field: "sections.tasks", all: true, limit: 1 }).success, false,
    "the enforced union keeps its alternative forms");
  assert.equal(full.safeParse({ field: "sections.tasks", index: 0, member: "status", length: 1 }).success, false);
  assert.equal(full.safeParse({ field: "sections.tasks", text: "A", member: "text", length: 1 }).success, true);
});

test("selection text discloses its Unicode scalar and UTF-8 byte rules separately", () => {
  const advertised = ordinaryFieldReadAdvertisedSchema(z);
  const text = projectZodRequestContract(advertised).contract.properties.selection.properties.text;
  assert.equal(text.unprojected, undefined, "both selection refinements are declared, not omitted");
  assert.deepEqual(text.constraints.map(({ constraint }) => constraint).sort(),
    ["max_bytes", "unicode_scalar_string"]);
  assert.deepEqual(text.constraints.find(({ constraint }) => constraint === "max_bytes"), {
    constraint: "max_bytes", maximum_bytes: WORK_RECORD_SELECTION_MAX_UTF8_BYTES, measurement: "utf8_bytes",
    statement: `Selection must be at most ${WORK_RECORD_SELECTION_MAX_UTF8_BYTES} UTF-8 bytes`
  });

  const node = advertised.shape.selection.unwrap().shape.text;
  const messages = (value) => {
    const parsed = node.safeParse(value);
    return parsed.success ? [] : parsed.error.issues.map(({ message }) => message);
  };
  const statement = (name) => text.constraints.find(({ constraint }) => constraint === name).statement;
  const atLimit = "é".repeat(WORK_RECORD_SELECTION_MAX_UTF8_BYTES / 2);
  assert.deepEqual(messages(atLimit), []);
  assert.deepEqual(messages(`${atLimit}a`), [statement("max_bytes")]);
  assert.deepEqual(messages("prefix \ud800 suffix"), [statement("unicode_scalar_string")]);
  const full = ordinaryFieldReadSchema(z);
  for (const [value, accepted] of [[atLimit, true], [`${atLimit}a`, false], ["\ud800", false]]) {
    assert.equal(full.safeParse({ field: "sections.summary", selection: { text: value } }).success, accepted);
  }
});

const digest = `sha256:${"a".repeat(64)}`;

const freshness = "a".repeat(16);
const record = { id: "WK-0001", repo: "test", sections: { summary: "prefix aa suffix", agent_notes: "a🙂e\u0301z", tasks: [
  { text: " A ", status: "todo" }, { text: "B", status: "done" }] }, slices: [] };
const loaded = { valid: true, source_digest: digest, record, diagnostics: [] };
const project = (selection, expectedSourceDigest = null) => projectOrdinaryFieldRead({
  loaded, selection, expectedSourceDigest, repository: "test"
});
test("ordinary projection preserves Unicode coordinates and task occurrence selection", () => {
  assert.equal(project({ field: "sections.agent_notes", length: 2 }).ordinary_field.value, "a🙂");
  assert.equal(project({ field: "sections.agent_notes", offset: 2 }, freshness).ordinary_field.value, "e\u0301z");
  assert.equal(project({ field: "sections.agent_notes", offset: 99 }, freshness).ordinary_field.length, 0);
  assert.equal(project({ field: "sections.tasks", text: "A" }).ordinary_field.task.index, 0);
  assert.equal(project({ field: "sections.tasks", index: 1 }, freshness).ordinary_field.task.status, "done");
  assert.equal(project({ field: "sections.tasks", index: 1 }).valid, false);
  assert.equal(project({ field: "sections.tasks", index: 1 }, "b".repeat(16)).ordinary_field, null);
  for (const selection of [ { field: "sections.tasks", all: true, limit: 1 },
    { field: "sections.tasks", index: 0, text: "A" },
    { field: "sections.tasks", index: 0, member: "status", length: 1 },
    { field: "sections.agent_notes", length: 0 } ]) {
    assert.ok(ordinaryFieldSelectionIssues(selection, freshness).length);
  }
});
test("Stage A ordinary projection returns generation-bound whole, range, and exact-selection refs", () => {
  const whole = project({ field: "sections.summary", reference_only: true });
  assert.equal(whole.valid, true);
  assert.equal(Object.hasOwn(whole.ordinary_field, "value"), false);
  assert.equal(whole.ordinary_field.length, Array.from(record.sections.summary).length);
  assert.equal(decodeWorkRecordTextReference(whole.ordinary_field.reference).reference.g, digest);

  const range = project({ field: "sections.agent_notes", offset: 1, length: 2 }, freshness);
  assert.equal(range.ordinary_field.value, "🙂e");
  const decodedRange = decodeWorkRecordTextReference(range.ordinary_field.reference).reference;
  assert.deepEqual([decodedRange.o, decodedRange.l], [1, 2]);

  const unique = project({ field: "sections.summary", selection: { text: "aa" } });
  assert.equal(unique.valid, true);
  assert.equal(unique.ordinary_field.selection.state, "unique");
  for (const key of ["before_ref", "match_ref", "after_ref"]) {
    assert.equal(decodeWorkRecordTextReference(unique.ordinary_field.selection[key]).ok, true);
  }
});

test("Stage A exact selection distinguishes no match and overlapping ambiguity", () => {
  const repeated = structuredClone(record);
  repeated.sections.summary = "aaaa";
  const repeatedLoaded = { ...loaded, record: repeated };
  const select = selection => projectOrdinaryFieldRead({
    loaded: repeatedLoaded, selection, repository: "test"
  });
  const ambiguous = select({ field: "sections.summary", selection: { text: "aa" } });
  assert.equal(ambiguous.valid, false);
  assert.equal(ambiguous.diagnostics.at(-1).code, "ordinary_field_selection_ambiguous");
  assert.equal(ambiguous.ordinary_field.selection.occurrence_count, 3);
  assert.deepEqual(ambiguous.ordinary_field.selection.choices.map(choice => choice.offset), [0, 1, 2]);
  const missing = select({ field: "sections.summary", selection: { text: "zz" } });
  assert.equal(missing.diagnostics.at(-1).code, "ordinary_field_selection_no_match");
});
test("ordinary compound projection loads once and never traverses dependencies", async () => {
  let loads = 0;
  const readWorkRecordById = async () => { loads++; return loaded; };
  const forbidden = () => { throw new Error("broad dependency traversal"); };
  for (const extra of [{}, { selected_record: true }, { slice_offset: 0 }]) {
    loads = 0;
    const result = await runWorkRecordSummaryWithCompactGate({ workspaceDir: ".", workspaceRepo: "test",
      args: { repo: "test", id: record.id, ordinary_field: { field: "sections.agent_notes" }, expected_source_digest: freshness, ...extra },
      getWorkRecordSummary: forbidden, readWorkRecordById });
    assert.equal(loads, 1);
    assert.equal(result.ordinary_field.value, record.sections.agent_notes);
    assert.equal(Object.hasOwn(result, "summary"), extra.selected_record === true);
    assert.equal(Object.hasOwn(result, "slice_page"), extra.slice_offset === 0);
  }
});
test("Stage A compact gate forwards only its trusted repository identity", async () => {
  const readWorkRecordById = async () => loaded;
  const args = { id: record.id, ordinary_field: {
    field: "sections.summary", reference_only: true
  } };
  const selector = { selected: record.id, selected_record: false, slice_page: null };
  const resolved = await runWorkRecordSummaryWithCompactGate({
    workspaceDir: ".",
    workspaceRepo: "configured-alias",
    args,
    selector,
    getWorkRecordSummary: () => { throw new Error("broad dependency traversal"); },
    readWorkRecordById
  });
  assert.equal(decodeWorkRecordTextReference(resolved.ordinary_field.reference).reference.r,
    "configured-alias");

  const missing = await runWorkRecordSummaryWithCompactGate({
    workspaceDir: ".",
    workspaceRepo: undefined,
    args: { ...args, repo: "caller-guess" },
    selector,
    getWorkRecordSummary: () => { throw new Error("broad dependency traversal"); },
    readWorkRecordById
  });
  assert.equal(missing.valid, false);
  assert.equal(missing.diagnostics.at(-1).code, "ordinary_field_repository_identity_missing");
});
test("ordinary text bodies return the complete selected remainder without a reader byte cap", async () => {
  const note = `Note "quoted" λ${ROCKET} tab\t\n`.repeat(150);
  const summary = `λ"${ROCKET} ${NUL}`.repeat(4000);
  const total = Array.from(summary).length;
  const sized = structuredClone(record);
  Object.assign(sized.sections, { agent_notes: note, summary });
  const sizedLoaded = { ...loaded, record: sized };
  const read = ordinary_field => runWorkRecordSummaryWithCompactGate({ workspaceDir: ".", workspaceRepo: "test",
    args: { repo: "test", id: sized.id, ordinary_field, expected_source_digest: freshness },
    getWorkRecordSummary: () => { throw new Error("broad dependency traversal"); },
    readWorkRecordById: async () => sizedLoaded });
  const bytes = value => Buffer.byteLength(JSON.stringify(value), "utf8");

  const notes = await read({ field: "sections.agent_notes" });
  assert.deepEqual([notes.ordinary_field.value, notes.ordinary_field.length, notes.next_calls],
    [note, Array.from(note).length, []]);

  const complete = await read({ field: "sections.summary" });
  assert.ok(bytes(complete) > 4 * WORK_RECORD_COMPACT_RESULT_MAX_UTF8_BYTES, `complete result ${bytes(complete)}`);
  assert.deepEqual([complete.ordinary_field.value, complete.ordinary_field.offset, complete.ordinary_field.length,
    complete.ordinary_field.total, complete.next_calls], [summary, 0, total, total, []]);

  const tail = await read({ field: "sections.summary", offset: total - 3 });
  assert.deepEqual([tail.ordinary_field.value, tail.next_calls], [Array.from(summary).slice(total - 3).join(""), []]);

  const range = await read({ field: "sections.summary", offset: 2, length: 3 });
  assert.equal(range.ordinary_field.value, Array.from(summary).slice(2, 5).join(""));
  assert.deepEqual(range.next_calls[0].arguments.ordinary_field, { field: "sections.summary", offset: 5, length: 3 });
  assert.equal(range.next_calls[0].arguments.expected_source_digest, freshness);

  const beyond = await read({ field: "sections.summary", offset: total - 2, length: 1_000_000 });
  assert.deepEqual([beyond.ordinary_field.length, beyond.next_calls], [2, []]);

  const reference = await read({ field: "sections.summary", reference_only: true });
  assert.equal(Object.hasOwn(reference.ordinary_field, "value"), false);
  assert.equal(reference.ordinary_field.length, total);
  assert.ok(bytes(reference) <= WORK_RECORD_COMPACT_RESULT_MAX_UTF8_BYTES);

  const referenceTail = await read({ field: "sections.summary", reference_only: true, offset: 4 });
  assert.equal(Object.hasOwn(referenceTail.ordinary_field, "value"), false);
  assert.deepEqual([referenceTail.ordinary_field.offset, referenceTail.ordinary_field.length,
    referenceTail.ordinary_field.total, referenceTail.next_calls], [4, total - 4, total, []]);
  const decodedTail = decodeWorkRecordTextReference(referenceTail.ordinary_field.reference).reference;
  assert.deepEqual([decodedTail.o, decodedTail.l, decodedTail.g], [4, total - 4, digest]);

  const projected = projectOrdinaryFieldRead({ loaded: sizedLoaded, selection: { field: "sections.summary" },
    repository: "test" });
  assert.equal(projected.ordinary_field.length, total, "the core projection selects the complete value");
});

test("ordinary missing-slice projection has no root summary", () => {
  const result = projectOrdinaryFieldRead({ loaded, unit: "WK-0001#SLICE-999", selection: { field: "sections.tasks" } });
  assert.equal(result.valid, false);
  assert.equal(result.ordinary_field, null);
  assert.equal(result.summary, null);
  assert.equal(result.diagnostics[0].code, "missing_slice");
});
