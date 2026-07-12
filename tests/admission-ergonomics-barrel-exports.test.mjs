import test from "node:test";
import assert from "node:assert/strict";

import * as recovery from "../packages/agent-launch-cli/src/lib/workspace-agent-worker-admission-recovery.mjs";
import * as admission from "../packages/agent-launch-cli/src/lib/workspace-agent-worker-admission.mjs";
import * as reviewAttestation from "../packages/wiki-mcp/src/lib/review-attestation-tools.mjs";
import * as dispatch from "../packages/wiki-mcp/src/lib/dispatch-tools.mjs";
import {
  WK1089_JUSTIFIED_EXCLUSIONS
} from "./workspace-agent-family-adapter-boundary.helpers.mjs";

const ORIGINAL_EXPORTS = Object.freeze({
  recovery: Object.freeze([
    "REMOTE_GATE_REFUSAL_RECOVERY_CODES",
    "WORKER_ADMISSION_REJECT_THRESHOLD_TAXONOMY_CODE",
    "WORKER_ADMISSION_REVIEW_THRESHOLD_TAXONOMY_CODE",
    "WORK_RECORD_STATUS_TO_PRECONDITION_LIFECYCLE_STATE",
    "buildNeedsReviewRecoveryDetail",
    "buildPreconditionRecoveryDetail",
    "buildRejectRecoveryDetail",
    "buildRemoteGateRefusalRecoveryDetail",
    "buildRouteProblemRecoveryDetail",
    "default",
    "projectPackResultReasonFacts",
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
  reviewAttestation: Object.freeze(["registerReviewAttestationTools"]),
  dispatch: Object.freeze(["registerDispatchTools"])
});

for (const [name, moduleNamespace] of Object.entries({
  recovery,
  admission,
  reviewAttestation,
  dispatch
})) {
  test(`${name} barrel preserves its exact original public export surface`, () => {
    assert.deepEqual(Object.keys(moduleNamespace).sort(), [...ORIGINAL_EXPORTS[name]].sort());
  });
}

test("DEC-0049 family-neutral registry covers every extracted workspace-agent sibling", () => {
  const registered = new Set(WK1089_JUSTIFIED_EXCLUSIONS.map(({ rel }) => rel));
  assert.deepEqual(
    [
      "lib/workspace-agent-worker-admission/runtime.mjs",
      "lib/workspace-agent-worker-admission-recovery/kernel.mjs",
      "lib/workspace-agent-worker-admission-recovery/cce-recovery-v1.mjs",
      "lib/workspace-agent-worker-admission-recovery/detail-builders.mjs"
    ].filter((rel) => !registered.has(rel)),
    []
  );
});
