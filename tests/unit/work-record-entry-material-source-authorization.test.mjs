

import test from "node:test";
import assert from "node:assert/strict";

import {
  WORK_RECORD_MATERIAL_REFERENCE_LIMIT,
  WORK_RECORD_MATERIAL_UTF8_BYTE_LIMIT,
  resolveWorkRecordEntryMaterial
} from "../../packages/wiki-core/src/lib/work-record-entry-material.mjs";
import {
  encodeWorkRecordEntryReference
} from "../../packages/wiki-core/src/lib/work-record-entry-content.mjs";

const REPOSITORY = "example/material-authorization";
const OWN_ID = "WK-0001";
const SOURCE_ID = "WK-0002";
const SOURCE_PATH = `wiki/work-records/${SOURCE_ID}.json`;

function version(id, text) {
  return {
    id,
    title: `version ${id}`,
    kind: "design",
    content: { text },
    scalar_length: [...text].length,
    utf8_bytes: Buffer.byteLength(text, "utf8"),
    provenance: { sources: [{ kind: "supplied_text" }] }
  };
}

function recordWith(id, entries) {
  return {
    id,
    sections: {
      entries: entries.map(([entryId, text]) => ({ id: entryId, versions: [version(1, text)] }))
    }
  };
}

function ref(recordId, entryId, text, { repository = REPOSITORY, versionId = 1 } = {}) {
  const total = [...text].length;
  return encodeWorkRecordEntryReference({ repository, recordId, sliceId: null,
    entryId, versionId, offset: 0, length: total, total });
}

function fixture({ own = recordWith(OWN_ID, [[1, "OWN-MATERIAL"]]),
  source = recordWith(SOURCE_ID, [[1, "SOURCE-PARENT"], [2, "SOURCE-SELECTED"]]) } = {}) {
  const loads = [];
  const records = new Map([[OWN_ID, own], [SOURCE_ID, source]]);
  const loadWorkRecordById = async ({ id }) => {
    loads.push(id);
    const record = records.get(id);
    return record ? { valid: true, record, diagnostics: [] }
      : { valid: false, record: null, diagnostics: [] };
  };
  return { own, loads, loadWorkRecordById };
}

function assignment(own, { rootRefs = [], selectedRefs = [], selectedScope = {} } = {}) {
  const selected = { id: "SLICE-001", read_scope: [], repo_paths: [], write_scope: [],
    ...selectedScope, sections: { material_refs: selectedRefs.map((value) => ({ ref: value })) } };
  const record = { ...own, sections: { ...own.sections,
    material_refs: rootRefs.map((value) => ({ ref: value })) }, slices: [selected] };
  return { record, selected };
}

test("a supplied predicate returning false denies even an exactly declared source", async () => {
  const { own, loads, loadWorkRecordById } = fixture();
  const { record, selected } = assignment(own, {
    selectedRefs: [ref(SOURCE_ID, 1, "SOURCE-PARENT")],
    selectedScope: { read_scope: [SOURCE_PATH] }
  });
  const asked = [];
  const result = await resolveWorkRecordEntryMaterial({ record, selected, repository: REPOSITORY,
    loadWorkRecordById, authorizeSource: (candidate) => { asked.push(candidate); return false; } });
  assert.equal(result.ok, false);
  assert.deepEqual(result.diagnostic, {
    code: "work_record_material_source_denied",
    severity: "error",
    authority_limb: "mechanical",
    message: `assignment scope does not declare ${SOURCE_PATH}`,
    path: "sections.material_refs"
  });
  assert.deepEqual(asked, [SOURCE_PATH]);
  assert.deepEqual(loads, [], "a denied source is never loaded");
});

test("a supplied predicate returning true admits a source the declared arrays do not match", async () => {
  const { own, loadWorkRecordById } = fixture();
  const { record, selected } = assignment(own, {
    selectedRefs: [ref(SOURCE_ID, 2, "SOURCE-SELECTED")],
    selectedScope: { read_scope: ["wiki/work-records/WK-*.json"] }
  });
  const withoutPredicate = await resolveWorkRecordEntryMaterial({ record, selected,
    repository: REPOSITORY, loadWorkRecordById });
  assert.equal(withoutPredicate.ok, false, "the declared-array check alone denies a glob spelling");
  assert.equal(withoutPredicate.diagnostic.code, "work_record_material_source_denied");

  const result = await resolveWorkRecordEntryMaterial({ record, selected, repository: REPOSITORY,
    loadWorkRecordById, authorizeSource: (candidate) => candidate === SOURCE_PATH });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostic ?? null));
  assert.deepEqual(result.entries.map((entry) => entry.text), ["SOURCE-SELECTED"]);
  assert.deepEqual(result.source_record_ids, [SOURCE_ID]);
});

test("the assignment's own record needs no predicate approval", async () => {
  const { own, loadWorkRecordById } = fixture();
  const { record, selected } = assignment(own, { selectedRefs: [ref(OWN_ID, 1, "OWN-MATERIAL")] });
  const asked = [];
  const result = await resolveWorkRecordEntryMaterial({ record, selected, repository: REPOSITORY,
    loadWorkRecordById, authorizeSource: (candidate) => { asked.push(candidate); return false; } });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostic ?? null));
  assert.deepEqual(result.entries.map((entry) => entry.text), ["OWN-MATERIAL"]);
  assert.deepEqual(asked, []);
});

test("root-then-selected order and first-occurrence deduplication hold under a predicate", async () => {
  const { own, loadWorkRecordById } = fixture();
  const parent = ref(SOURCE_ID, 1, "SOURCE-PARENT");
  const selectedRef = ref(SOURCE_ID, 2, "SOURCE-SELECTED");
  const { record, selected } = assignment(own, {
    rootRefs: [parent], selectedRefs: [selectedRef, parent]
  });
  const result = await resolveWorkRecordEntryMaterial({ record, selected, repository: REPOSITORY,
    loadWorkRecordById, authorizeSource: () => true });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostic ?? null));
  assert.deepEqual(result.entries.map((entry) => entry.ref), [parent, selectedRef]);
});

test("foreign repository and missing version keep their diagnostics under a permissive predicate", async () => {
  const { own, loadWorkRecordById } = fixture();
  const foreign = assignment(own, {
    selectedRefs: [ref(SOURCE_ID, 1, "SOURCE-PARENT", { repository: "example/foreign" })]
  });
  const foreignResult = await resolveWorkRecordEntryMaterial({ ...foreign, repository: REPOSITORY,
    loadWorkRecordById, authorizeSource: () => true });
  assert.equal(foreignResult.ok, false);
  assert.equal(foreignResult.diagnostic.code, "work_record_material_source_denied");
  assert.equal(foreignResult.diagnostic.message, "material reference belongs to another repository");
  assert.equal(foreignResult.diagnostic.path, "sections.material_refs[0].ref");

  const missing = assignment(own, {
    selectedRefs: [ref(SOURCE_ID, 1, "SOURCE-PARENT", { versionId: 9 })]
  });
  const missingResult = await resolveWorkRecordEntryMaterial({ ...missing, repository: REPOSITORY,
    loadWorkRecordById, authorizeSource: () => true });
  assert.equal(missingResult.ok, false);
  assert.equal(missingResult.diagnostic.code, "work_record_material_source_unavailable");
  assert.equal(missingResult.diagnostic.message, "referenced immutable entry version is unavailable");
  assert.equal(missingResult.diagnostic.path, "sections.material_refs[0].ref");
});

test("reference and rendered-byte limits are unchanged under a permissive predicate", async () => {
  const many = Array.from({ length: WORK_RECORD_MATERIAL_REFERENCE_LIMIT + 1 },
    (_, index) => [index + 1, `SOURCE-${index}`]);
  const { own, loadWorkRecordById } = fixture({ source: recordWith(SOURCE_ID, many) });
  const tooMany = assignment(own, {
    selectedRefs: many.map(([entryId, text]) => ref(SOURCE_ID, entryId, text))
  });
  const countResult = await resolveWorkRecordEntryMaterial({ ...tooMany, repository: REPOSITORY,
    loadWorkRecordById, authorizeSource: () => true });
  assert.equal(countResult.ok, false);
  assert.equal(countResult.diagnostic.code, "work_record_material_ref_limit_exceeded");

  const large = "x".repeat(WORK_RECORD_MATERIAL_UTF8_BYTE_LIMIT / 2 + 1);
  const big = fixture({ source: recordWith(SOURCE_ID, [[1, large], [2, `${large}y`]]) });
  const tooLarge = assignment(big.own, {
    selectedRefs: [ref(SOURCE_ID, 1, large), ref(SOURCE_ID, 2, `${large}y`)]
  });
  const byteResult = await resolveWorkRecordEntryMaterial({ ...tooLarge, repository: REPOSITORY,
    loadWorkRecordById: big.loadWorkRecordById, authorizeSource: () => true });
  assert.equal(byteResult.ok, false);
  assert.equal(byteResult.diagnostic.code, "work_record_material_bytes_limit_exceeded");
});

test("a non-function authorizeSource is refused rather than ignored", async () => {
  const { own, loadWorkRecordById } = fixture();
  const { record, selected } = assignment(own, { selectedRefs: [ref(SOURCE_ID, 1, "SOURCE-PARENT")] });
  await assert.rejects(resolveWorkRecordEntryMaterial({ record, selected, repository: REPOSITORY,
    loadWorkRecordById, authorizeSource: true }), /authorizeSource must be a function/u);
});
