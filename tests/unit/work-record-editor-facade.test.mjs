import assert from "node:assert/strict";
import test from "node:test";

import { WORK_RECORD_EDIT_FIELD_REGISTRY } from
  "../../packages/wiki-core/src/lib/work-record-contract-edit.mjs";
import { editWorkRecordByUnit } from
  "../../packages/wiki-core/src/operations/work-record-contract-edit.mjs";

test("general work-record editor exports one registry-backed core facade", () => {
  assert.equal(typeof editWorkRecordByUnit, "function");
  assert.equal(WORK_RECORD_EDIT_FIELD_REGISTRY.some(
    ({ field, kind, facade }) => facade && field === "sections.tasks" && kind === "task"
  ), true);
});
