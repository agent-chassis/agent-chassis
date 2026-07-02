

import {
  assertSupportedDerivedEvidenceSchemaVersion,
  createWorkUnitAtomicityDecisionFromStoredDerivedEvidence,
  evaluateWorkRecordAdmissionDerivedEvidence as evaluateWorkRecordAdmissionDerivedEvidenceFromStoredReplay,
  normalizeStoredWorkRecordAdmissionDerivedEvidenceInput
} from "./work-record-admission-stored-replay.mjs";

const STORED_REPLAY_HELPER_AVAILABLE =
  typeof evaluateWorkRecordAdmissionDerivedEvidenceFromStoredReplay === "function";

export {
  computeNormalizedRequestOutputHash,
  NORMALIZED_REQUEST_OUTPUT_HASH_PLACEHOLDER,
  systemUtcClock
} from "./work-record-admission-derived-evidence-time.mjs";

export { createWorkRecordAdmissionDerivedEvidence } from "./work-record-admission-derived-evidence-builder.mjs";

export {
  WORKER_ADMISSION_DOMAIN_PACK_INPUT_SCHEMA_VERSION,
  WORKER_ADMISSION_DOMAIN_PACK_BOUND_IDENTIFIERS,
  NODE_ENGINE_UNRATIFIED_PLACEHOLDER,
  createWorkerAdmissionDomainPackInput,
  createSelectedUnitWorkerAdmissionDomainPackInput
} from "./work-record-admission-domain-pack-input.mjs";

export {
  createCompactWorkRecordAdmissionDerivedEvidence,
  isCompactWorkerAdmissionDerivedEvidence
} from "./work-record-admission-derived-evidence-compact.mjs";

export function evaluateWorkRecordAdmissionDerivedEvidence(value, options = {}) {
  if (!STORED_REPLAY_HELPER_AVAILABLE) {
    throw new Error("stored replay helper module is unavailable");
  }
  assertSupportedDerivedEvidenceSchemaVersion(options);
  const normalized = normalizeStoredWorkRecordAdmissionDerivedEvidenceInput(value);
  return createWorkUnitAtomicityDecisionFromStoredDerivedEvidence({
    normalizedRequest: normalized.normalized_request,
    metricSummary: normalized.metric_summary,
    provenance: normalized.provenance,
    policyProfile: options.policy_profile ?? options.policyProfile ?? normalized.normalized_request.policy_profile,
    mode: options.mode ?? options.request_mode ?? normalized.normalized_request.context?.mode
  });
}
