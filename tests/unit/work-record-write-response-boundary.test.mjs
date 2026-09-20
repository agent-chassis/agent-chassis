import assert from "node:assert/strict";
import test from "node:test";

import {
  WORK_RECORD_PERSISTENCE_PHASES,
  composeWorkRecordPersistenceDiagnostic
} from "../../packages/wiki-core/src/operations/work-record-persistence-diagnostics.mjs";
import { shapeWriteResponse } from
  "../../packages/wiki-mcp/src/lib/write-response-boundary.mjs";

test("ordinary persistence write response preserves complete diagnostics", () => {
  const phases = Object.values(WORK_RECORD_PERSISTENCE_PHASES);
  const diagnostics = Array.from({ length: 23 }, (_, index) => {
    const cause = new Error(`ordinary-${index}-🙂-${"λ".repeat(600)}`);
    cause.code = `opaque_${index}_${"c".repeat(600)}`;
    cause.path = `/ordinary/${index}/${"路".repeat(300)}`;
    cause.details = { nested: { index, unicode: "東京🙂", values: [1, true, null] } };
    cause.stack = `Error: ordinary-${index}\n    at response-boundary:${index + 1}:1`;
    cause.record = { id: "WK-2538", diagnostic_index: index };
    cause.payload = { nested: { index, value: `payload-${index}-🙂` } };
    return composeWorkRecordPersistenceDiagnostic({
      phase: phases[index % phases.length],
      cause,
      publicationState: index === 0 ? "unknown" : "not_published",
      failureRole: index === 0 ? "primary" : "secondary",
      recordId: "WK-2538",
      canonicalRecordPath: "/repo/wiki/work-records/WK-2538.json",
      producerDiagnostic: index === 0 ? {
        code: "sidecar_publication_failed",
        operation: "destination_read",
        cause_code: "EACCES",
        message: "publisher-owned"
      } : null,
      diagnosticIndex: index
    }).diagnostic;
  });
  const response = {
    ok: false,
    valid: true,
    written: null,
    no_op: false,
    publication_state: "unknown",
    diagnostic_count: diagnostics.length,
    diagnostics,
    failed_fault: "target_published",
    effect_trace: [{ effect: "publish_rename", fault: "target_published", outcome: "failed" }],
    next_action: "Inspect with workspace_read_page; do not repeat the write."
  };

  const shaped = shapeWriteResponse(response);

  assert.equal(shaped.ok, false);
  assert.equal(shaped.written, null);
  assert.equal(shaped.no_op, false);
  assert.equal(shaped.publication_state, "unknown");
  assert.equal(shaped.diagnostic_count, 23);
  assert.deepEqual(shaped.diagnostics, diagnostics);
  assert.deepEqual(shaped.effect_trace, response.effect_trace);
  assert.equal(shaped.failed_fault, "target_published");
  assert.equal(shaped.diagnostics[0].cause.code, `opaque_0_${"c".repeat(600)}`);
  assert.equal(shaped.diagnostics[0].cause.message, `ordinary-0-🙂-${"λ".repeat(600)}`);
  assert.equal(shaped.diagnostics[0].cause.path, `/ordinary/0/${"路".repeat(300)}`);
  assert.deepEqual(shaped.diagnostics[0].cause.details, {
    nested: { index: 0, unicode: "東京🙂", values: [1, true, null] }
  });
  assert.equal(
    shaped.diagnostics[0].cause.stack,
    "Error: ordinary-0\n    at response-boundary:1:1"
  );
  assert.deepEqual(shaped.diagnostics[0].cause.record, {
    id: "WK-2538",
    diagnostic_index: 0
  });
  assert.deepEqual(shaped.diagnostics[0].cause.payload, {
    nested: { index: 0, value: "payload-0-🙂" }
  });
  assert.deepEqual(shaped.diagnostics[0].producer_diagnostic, {
    code: "sidecar_publication_failed",
    operation: "destination_read",
    cause_code: "EACCES",
    message: "publisher-owned"
  });
  assert.equal(Object.hasOwn(shaped, "diagnostics_truncation"), false);
  assert.equal(Object.hasOwn(shaped, "diagnostic_redactions"), false);
});

test("ordinary write response refuses accessor diagnostics without invoking getters", () => {
  let getterCalls = 0;
  const diagnostic = { code: "accessor_diagnostic", message: "must fail loudly" };
  Object.defineProperty(diagnostic, "payload", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "not available without invocation";
    }
  });

  assert.throws(
    () => shapeWriteResponse({ valid: false, written: false, diagnostics: [diagnostic] }),
    /diagnostics\[0\]\.payload must be a data property/u
  );
  assert.equal(getterCalls, 0);
});
