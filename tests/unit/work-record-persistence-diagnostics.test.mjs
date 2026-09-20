import assert from "node:assert/strict";
import test from "node:test";

import { captureStructuredDiagnostic } from
  "../../packages/wiki-core/src/lib/diagnostic-projection.mjs";
import {
  composeWorkRecordPersistenceDiagnostic,
  publicationStateFromCrashDurableResult
} from "../../packages/wiki-core/src/operations/work-record-persistence-diagnostics.mjs";
import { settleWorkRecordPersistenceWithOptionalLock } from
  "../../packages/wiki-core/src/operations/work-record-persistence-transaction.mjs";

test("optional-lock settlement preserves held and acquired lock outcomes", async () => {
  const faultInjector = { after_acquire: new Error("unused") };
  let acquisitions = 0;
  const withLock = async (targetDir, callback, options) => {
    acquisitions += 1;
    assert.equal(targetDir, "/fixture");
    assert.deepEqual(options, { settle: true, faultInjector });
    return { value: await callback(), callback_error: null, release_error: null };
  };
  const acquired = await settleWorkRecordPersistenceWithOptionalLock({
    targetDir: "/fixture", settleUnderLock: async () => "acquired",
    lockAlreadyHeld: false, lockFaultInjector: faultInjector,
    withWorkRecordWriteLock: withLock
  });
  assert.deepEqual(acquired, {
    value: "acquired", callback_error: null, release_error: null
  });
  assert.equal(acquisitions, 1);

  const held = await settleWorkRecordPersistenceWithOptionalLock({
    targetDir: "/fixture", settleUnderLock: async () => "held",
    lockAlreadyHeld: true, lockFaultInjector: faultInjector,
    withWorkRecordWriteLock: withLock
  });
  assert.deepEqual(held, { value: "held", callback_error: null, release_error: null });
  assert.equal(acquisitions, 1, "an already-held lock is never acquired or fault-injected again");

  const callbackError = new Error("callback failed");
  const failed = await settleWorkRecordPersistenceWithOptionalLock({
    targetDir: "/fixture", settleUnderLock: async () => { throw callbackError; },
    lockAlreadyHeld: true, lockFaultInjector: faultInjector,
    withWorkRecordWriteLock: withLock
  });
  assert.deepEqual(failed, {
    value: undefined, callback_error: callbackError, release_error: null
  });
});

test("persistence diagnostic composition preserves producer ownership", () => {
  const longCode = `producer_${"x".repeat(700)}`;
  const lockError = new Error(`lock detail 🙂 ${"λ".repeat(700)}`);
  lockError.code = longCode;
  lockError.lock_path = "/repo/wiki/.work-record-write.lock";
  lockError.lock_state = "token_owned";
  lockError.liveness_reason = "holder identity remains live";
  lockError.details = { nested: { unicode: "東京🙂", list: [1, 2, 3] } };
  lockError.stack = "Error: exact stack\n    at persistence-owner:1:1";
  lockError.record = { id: "WK-2538", title: "attached record" };
  lockError.record_payload = { nested: { payload: "exact payload 🙂" } };
  lockError.canonical_record_payload = { read_scope: ["AGENTS.md"] };

  const primary = composeWorkRecordPersistenceDiagnostic({
    phase: "lock_acquisition",
    cause: lockError,
    publicationState: "not_published",
    recordId: "WK-2538",
    canonicalRecordPath: "/repo/wiki/work-records/WK-2538.json",
    diagnosticIndex: 0
  });
  assert.equal(primary.diagnostic.code, "work_record_write_failed");
  assert.equal(primary.diagnostic.category, "work_record_write_failed");
  assert.equal(primary.diagnostic.operation, "work_record_write_failed");
  assert.equal(primary.diagnostic.cause_code, longCode);
  assert.equal(primary.diagnostic.authority_limb, "mechanical");
  assert.equal(primary.diagnostic.cause.lock_state, "token_owned");
  assert.equal(primary.diagnostic.cause.message, lockError.message);
  assert.deepEqual(primary.diagnostic.cause.details, lockError.details);
  assert.equal(primary.diagnostic.cause.stack, lockError.stack);
  assert.deepEqual(primary.diagnostic.cause.record, lockError.record);
  assert.deepEqual(primary.diagnostic.cause.record_payload, lockError.record_payload);
  assert.deepEqual(
    primary.diagnostic.cause.canonical_record_payload,
    lockError.canonical_record_payload
  );

  const sidecar = {
    code: "sidecar_publication_failed",
    severity: "error",
    message: "immutable admission sidecar publication failed",
    operation: "destination_read",
    cause_code: "EACCES",
    sidecar_path: "wiki/work-records/evidence/WK-2538.sha256-a.admission.json"
  };
  const secondary = composeWorkRecordPersistenceDiagnostic({
    phase: "sidecar_publication",
    cause: sidecar,
    producerDiagnostic: sidecar,
    publicationState: "not_published",
    failureRole: "secondary",
    diagnosticIndex: 1
  });
  assert.equal(secondary.diagnostic.cause_code, "EACCES");
  assert.equal(secondary.diagnostic.failure_role, "secondary");
  assert.deepEqual(secondary.diagnostic.producer_diagnostic, sidecar);

  const primitive = composeWorkRecordPersistenceDiagnostic({
    phase: "transaction_preparation",
    cause: `primitive-${"🙂".repeat(400)}`,
    publicationState: "not_published",
    diagnosticIndex: 2
  });
  assert.equal(primitive.diagnostic.cause_code, "unknown_internal_cause");
  assert.equal(primitive.diagnostic.cause, `primitive-${"🙂".repeat(400)}`);

  const declaredValue = "lock-token-is-diagnostic-data";
  const declared = composeWorkRecordPersistenceDiagnostic({
    phase: "cleanup",
    cause: captureStructuredDiagnostic(
      {
        code: "cleanup_failed",
        message: `complete value ${declaredValue}`,
        nested: { declared_value: declaredValue }
      },
      {
        sensitiveValues: [{
          field: "nested.declared_value",
          value: declaredValue,
          reason: "secret_material"
        }]
      }
    ),
    publicationState: "published",
    diagnosticIndex: 3
  });
  assert.equal(declared.diagnostic.cause.message, `complete value ${declaredValue}`);
  assert.equal(declared.diagnostic.cause.nested.declared_value, declaredValue);
  assert.equal(Object.hasOwn(declared, "redactions"), false);

  let getterCalls = 0;
  const accessorError = new Error("accessor must not run");
  Object.defineProperty(accessorError, "payload", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return { concealed: true };
    }
  });
  assert.throws(
    () => composeWorkRecordPersistenceDiagnostic({
      phase: "cleanup",
      cause: accessorError,
      publicationState: "published",
      diagnosticIndex: 4
    }),
    /diagnostics\.4\.cause\.payload must be a data property/u
  );
  assert.equal(getterCalls, 0);

  assert.equal(publicationStateFromCrashDurableResult({
    trace: [{ effect: "publish_rename", outcome: "ok" }]
  }), "published");
  assert.equal(publicationStateFromCrashDurableResult({
    trace: [{ effect: "publish_rename", outcome: "failed" }]
  }), "unknown");
  assert.equal(publicationStateFromCrashDurableResult({ trace: [] }), "not_published");
});
