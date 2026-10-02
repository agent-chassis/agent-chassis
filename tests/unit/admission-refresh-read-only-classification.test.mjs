

import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyReadOnlyAdmissionRefreshResult
} from "../../packages/wiki-mcp/src/lib/work-record-write-route-helpers.mjs";

const TOOL = "workspace_work_record_refresh_admission_metrics";
const SELECTED = { kind: "work_item", address: "WK-0001", record_id: "WK-0001", slice_id: null };

function persistenceFailure(causeCode) {
  return {
    valid: true,
    written: false,
    publication_state: "not_published",
    source_digest: `sha256:${"a".repeat(64)}`,
    diagnostics: [{
      code: "work_record_write_failed",
      severity: "error",
      message: "canonical work-record persistence failed during staging",
      phase: "staging",
      cause_code: causeCode,
      cause: {
        name: "Error",
        code: causeCode,
        message: `${causeCode}: mkdtemp '/repo/wiki/work-records/.record-tmp-x'`,
        path: "/repo/wiki/work-records/.record-tmp-x"
      }
    }]
  };
}

test("a returned read-only staging failure becomes the read_only_mount refusal", () => {
  for (const causeCode of ["EACCES", "EROFS", "EPERM"]) {
    const classified = classifyReadOnlyAdmissionRefreshResult({
      toolName: TOOL, selectedUnit: SELECTED, result: persistenceFailure(causeCode)
    });
    assert.equal(classified.valid, false, causeCode);
    assert.equal(classified.written, false, causeCode);
    assert.equal(classified.diagnostics.length, 1, causeCode);
    const [refusal] = classified.diagnostics;
    assert.equal(refusal.code, "read_only_mount", causeCode);
    assert.equal(refusal.category, "filesystem", causeCode);
    assert.equal(refusal.blocking, true, causeCode);
    assert.equal(refusal.responsible_actor, "operator", causeCode);
    assert.match(refusal.violated_contract, /writable workspace repository/u, causeCode);
    assert.equal(typeof refusal.next_action, "string", causeCode);
    assert.equal(refusal.detail.operation, TOOL, causeCode);
    assert.deepEqual(refusal.detail.selected_unit, SELECTED, causeCode);
    assert.equal(refusal.detail.cause_code, causeCode, causeCode);
    assert.match(refusal.detail.cause_message, new RegExp(causeCode, "u"), causeCode);
  }
});

test("other persistence failures and written results are returned unchanged", () => {
  const otherCause = persistenceFailure("ENOSPC");
  assert.equal(classifyReadOnlyAdmissionRefreshResult({
    toolName: TOOL, selectedUnit: SELECTED, result: otherCause
  }), otherCause);

  const written = { ...persistenceFailure("EACCES"), written: true };
  assert.equal(classifyReadOnlyAdmissionRefreshResult({
    toolName: TOOL, selectedUnit: SELECTED, result: written
  }), written);

  const otherPrimary = persistenceFailure("EACCES");
  otherPrimary.diagnostics.unshift({ code: "invalid_record", severity: "error", message: "invalid" });
  assert.equal(classifyReadOnlyAdmissionRefreshResult({
    toolName: TOOL, selectedUnit: SELECTED, result: otherPrimary
  }), otherPrimary);
});
