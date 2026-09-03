import test from "node:test";
import assert from "node:assert/strict";

import * as recovery from "../../packages/agent-launch-cli/src/lib/workspace-agent-worker-admission-recovery.mjs";
import * as admission from "../../packages/agent-launch-cli/src/lib/workspace-agent-worker-admission.mjs";
import * as dispatch from "../../packages/wiki-mcp/src/lib/dispatch-tools.mjs";

const SUPPORTED_EXPORTS = Object.freeze({
  recovery: Object.freeze([
    "REMOTE_GATE_REFUSAL_RECOVERY_CODES",
    "WORK_RECORD_STATUS_TO_PRECONDITION_LIFECYCLE_STATE",
    "buildNeedsReviewRecoveryDetail",
    "buildPreconditionRecoveryDetail",
    "buildRejectRecoveryDetail",
    "buildRemoteGateRefusalRecoveryDetail",
    "buildRouteProblemRecoveryDetail",
    "default",
    "projectWorkerAdmissionRecovery"
  ]),
  admission: Object.freeze([
    "NODE_ENGINE_ADMISSION_RUNTIME_DIAGNOSTIC_SCHEMA_VERSION",
    "buildCanonicalSummary",
    "buildNodeEngineAdmissionRuntimeDiagnostic",
    "buildRedactedRemoteAdmissionDiagnostic",
    "ensureNewWorkerWriteRoots",
    "evaluateWorkerAdmissionDecision",
    "evaluateWorkerAdmissionForBackend",
    "normalizeRemoteWorkerAdmissionPackResultForDecision",
    "refuseCallerSuppliedWorkerIdentity",
    "resolveRemoteWorkerAdmissionPackResultForUnit"
  ]),
  dispatch: Object.freeze(["registerDispatchTools"])
});

for (const [name, moduleNamespace] of Object.entries({
  recovery,
  admission,
  dispatch
})) {
  test(`${name} barrel preserves its exact supported public export surface`, () => {
    assert.deepEqual(Object.keys(moduleNamespace).sort(), [...SUPPORTED_EXPORTS[name]].sort());
  });
}

test("the recovery barrel exports no local CCE taxonomy or reason projector", () => {
  for (const retiredExport of [
    "WORKER_ADMISSION_REVIEW_THRESHOLD_TAXONOMY_CODE",
    "WORKER_ADMISSION_REJECT_THRESHOLD_TAXONOMY_CODE",
    "projectPackResultReasonFacts"
  ]) {
    assert.equal(Object.hasOwn(recovery, retiredExport), false, retiredExport);
  }
  assert.equal(Object.values(recovery).includes("worker_admission_review_threshold_exceeded"), false);
});
