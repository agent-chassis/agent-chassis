import assert from "node:assert/strict";
import test from "node:test";

import { WORK_RECORD_EDIT_FIELD_REGISTRY } from
  "../../packages/wiki-core/src/lib/work-record-contract-edit.mjs";
import { editWorkRecordByUnit } from
  "../../packages/wiki-core/src/operations/work-record-contract-edit.mjs";
import {
  WORK_RECORD_CONTENT_MAX_PARTS,
  validateWorkRecordEntryContent,
  workRecordEditUsesEntryContent
} from "../../packages/wiki-core/src/lib/work-record-entry-schema.mjs";

test("general work-record editor exports one registry-backed core facade", () => {
  assert.equal(typeof editWorkRecordByUnit, "function");
  assert.equal(WORK_RECORD_EDIT_FIELD_REGISTRY.some(
    ({ field, kind, facade }) => facade && field === "sections.tasks" && kind === "task"
  ), true);
  assert.equal(WORK_RECORD_EDIT_FIELD_REGISTRY.some(
    ({ field, kind, applicability, facade }) => facade && field === "base_branch" &&
      kind === "scalar" && applicability.length === 1 && applicability[0] === "record"
  ), true);
});

test("Stage A enrolled registry values share one closed exact-content contract", () => {
  const enrolled = WORK_RECORD_EDIT_FIELD_REGISTRY.filter(entry =>
    entry.facade && entry.actions.some(action => workRecordEditUsesEntryContent(entry, action)));
  assert.deepEqual([...new Set(enrolled.map(entry => entry.field))].sort(),
    ["sections.agent_notes", "sections.summary", "sections.tasks", "sections.user_requirements",
      "sections.why_it_matters"]);
  for (const accepted of [
    { text: "" },
    { ref: "opaque" },
    { parts: [{ text: "a" }, { ref: "opaque" }] }
  ]) assert.equal(validateWorkRecordEntryContent(accepted).ok, true);
  for (const refused of [
    "bare",
    null,
    {},
    { text: "x", ref: "y" },
    { parts: [] },
    { parts: [{ parts: [{ text: "nested" }] }] },
    { text: "\ud800" },
    { parts: Array.from({ length: WORK_RECORD_CONTENT_MAX_PARTS + 1 }, () => ({ text: "x" })) }
  ]) assert.equal(validateWorkRecordEntryContent(refused).ok, false);
});
