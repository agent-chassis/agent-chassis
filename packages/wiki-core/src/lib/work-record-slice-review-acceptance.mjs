

import {
  cloneJson,
  computeNormalizedInputDigest,
  isNonEmptyString,
  isObject,
  normalizeStringEntry
} from "./work-record-admission-shared.mjs";
import { SHA256_PATTERN } from "./work-record-schema-constants.mjs";

export const SLICE_REVIEW_ACCEPTANCE_SCHEMA_VERSION = "workspace-agent-slice-review-acceptance.v1";
export const SLICE_REVIEW_ACCEPTANCE_SCHEMA_VERSION_V2 = "workspace-agent-slice-review-acceptance.v2";

export const SLICE_REVIEW_ACCEPTANCE_EVIDENCE_KEY = "slice_review_acceptance";

export const SLICE_REVIEW_ACCEPTANCE_OUTCOME_VALUES = Object.freeze([
  "no_findings",
  "passed_no_blocking_or_medium_findings"
]);

export const SLICE_REVIEW_ACCEPTANCE_REVIEWER_ROLE_VALUES = Object.freeze(["reviewer"]);

export const SLICE_REVIEW_ACCEPTANCE_PROOF_INPUT_FIELDS = Object.freeze([
  "canonical_review_unit_digest",
  "diff_base_sha",
  "initiative",
  "review_monitor_handle",
  "review_outcome",
  "review_run_id",
  "reviewed_at",
  "reviewed_sha",
  "reviewer_role",
  "slice_ref",
  "source_worker_run_id",
  "structured_result_digest",
  "unit_address"
]);
export const SLICE_REVIEW_ACCEPTANCE_PROOF_INPUT_FIELDS_V2 = Object.freeze([
  "canonical_review_unit_digest",
  "committed_target_digest",
  "diff_base_sha",
  "initiative",
  "review_admission_kind",
  "review_monitor_handle",
  "review_outcome",
  "review_run_id",
  "reviewed_at",
  "reviewed_sha",
  "reviewer_role",
  "slice_ref",
  "structured_result_digest",
  "unit_address"
]);

export const SLICE_REVIEW_ACCEPTANCE_PROOF_FIELDS = Object.freeze(
  [...SLICE_REVIEW_ACCEPTANCE_PROOF_INPUT_FIELDS, "evidence_digest", "schema_version"].sort()
);
export const SLICE_REVIEW_ACCEPTANCE_PROOF_FIELDS_V2 = Object.freeze(
  [...SLICE_REVIEW_ACCEPTANCE_PROOF_INPUT_FIELDS_V2, "evidence_digest", "schema_version"].sort()
);

export const SLICE_REVIEW_ACCEPTANCE_DECISION_CODES = Object.freeze({
  valid: "agent_launch.slice_integration.review_acceptance_proof_valid.v1",
  missing: "agent_launch.slice_integration.review_acceptance_proof_missing.v1",
  malformed: "agent_launch.slice_integration.review_acceptance_proof_malformed.v1",
  untrustedProvenance:
    "agent_launch.slice_integration.review_acceptance_proof_untrusted_provenance.v1",
  bindingMismatch:
    "agent_launch.slice_integration.review_acceptance_proof_binding_mismatch.v1",
  targetStale: "agent_launch.slice_integration.review_acceptance_proof_target_stale.v1",
  reviewNotAccepted:
    "agent_launch.slice_integration.review_acceptance_proof_review_not_accepted.v1"
});
const CODES = SLICE_REVIEW_ACCEPTANCE_DECISION_CODES;

const UNIT_ADDRESS_PATTERN = /^WK-\d{4}#SLICE-\d{3}$/u;
const INITIATIVE_PATTERN = /^IN-\d{4}$/u;
const SLICE_REF_PATTERN = /^refs\/heads\/slice\/(IN-\d{4})\/(WK-\d{4})\/(SLICE-\d{3})$/u;
const OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,191}$/u;

export const EXACT_SLICE_IMPLEMENTATION_REVIEW_TRANSITION_CODES = Object.freeze({
  valid: "work_record.exact_slice_implementation_review_transition_valid.v1",
  invalid: "work_record.exact_slice_implementation_review_transition_invalid.v1",
  bindingMismatch: "work_record.exact_slice_implementation_review_transition_binding_mismatch.v1",
  reviewUnconfirmed: "work_record.exact_slice_implementation_review_transition_unconfirmed.v1"
});

const OUTCOME_SET = new Set(SLICE_REVIEW_ACCEPTANCE_OUTCOME_VALUES);
const REVIEWER_ROLE_SET = new Set(SLICE_REVIEW_ACCEPTANCE_REVIEWER_ROLE_VALUES);
const INPUT_FIELD_SET = new Set(SLICE_REVIEW_ACCEPTANCE_PROOF_INPUT_FIELDS);
const INPUT_FIELD_SET_V2 = new Set(SLICE_REVIEW_ACCEPTANCE_PROOF_INPUT_FIELDS_V2);

function isSha256(value) {
  return isNonEmptyString(value) && SHA256_PATTERN.test(value.trim());
}

function isOid(value) {
  return typeof value === "string" && OID_PATTERN.test(value);
}

function isRunToken(value) {
  return typeof value === "string" && RUN_ID_PATTERN.test(value);
}

function refuse(decisionCode, reason) {
  return { ok: false, decision_code: decisionCode, reasons: [reason], proof: null };
}

function deny(decisionCode, reason) {
  return { valid: false, decision_code: decisionCode, reasons: [reason] };
}

function sliceReviewAcceptanceBoundedFacts(proof) {
  const facts = { schema_version: proof.schema_version };
  const fields = proof.schema_version === SLICE_REVIEW_ACCEPTANCE_SCHEMA_VERSION_V2
    ? SLICE_REVIEW_ACCEPTANCE_PROOF_INPUT_FIELDS_V2
    : SLICE_REVIEW_ACCEPTANCE_PROOF_INPUT_FIELDS;
  for (const field of fields) {
    facts[field] = normalizeStringEntry(proof[field]) ?? proof[field] ?? null;
  }
  return facts;
}

export function computeSliceReviewAcceptanceProofDigest(proof) {
  return computeNormalizedInputDigest(sliceReviewAcceptanceBoundedFacts(proof));
}

export function computeSliceReviewStructuredResultDigest(reviewResult) {
  if (!isObject(reviewResult)) return null;
  if (reviewResult.clean_review !== true) return null;
  if (!OUTCOME_SET.has(reviewResult.review_outcome)) return null;
  if (!Number.isInteger(reviewResult.blocking_finding_count) ||
      !Number.isInteger(reviewResult.medium_finding_count) ||
      reviewResult.blocking_finding_count !== 0 ||
      reviewResult.medium_finding_count !== 0) {
    return null;
  }
  const reviewedControls = Array.isArray(reviewResult.reviewed_controls)
    ? [...reviewResult.reviewed_controls]
    : null;
  if (reviewedControls === null || reviewedControls.some((entry) => !isNonEmptyString(entry))) {
    return null;
  }
  return computeNormalizedInputDigest({
    review_outcome: reviewResult.review_outcome,
    clean_review: true,
    no_findings: reviewResult.no_findings === true,
    blocking_finding_count: reviewResult.blocking_finding_count,
    medium_finding_count: reviewResult.medium_finding_count,
    reviewed_controls: reviewedControls.sort((left, right) => left.localeCompare(right))
  });
}

function sliceRefAgreesWithUnit(sliceRef, unitAddress, initiative) {
  const match = SLICE_REF_PATTERN.exec(sliceRef ?? "");
  if (!match) return false;
  const [, refInitiative, recordId, sliceId] = match;
  return refInitiative === initiative && `${recordId}#${sliceId}` === unitAddress;
}

export function validateExactSliceImplementationReviewTransition(result, unitAddress) {
  const codes = EXACT_SLICE_IMPLEMENTATION_REVIEW_TRANSITION_CODES;
  if (!isObject(result)) {
    return { ok: false, decision_code: codes.invalid, reason: "transition_result_not_object" };
  }
  if (typeof unitAddress !== "string" || !UNIT_ADDRESS_PATTERN.test(unitAddress)) {
    return { ok: false, decision_code: codes.bindingMismatch, reason: "unit_address_invalid" };
  }
  const [recordId, sliceId] = unitAddress.split("#");
  const selected = result.selected_unit;
  if (!isObject(selected) || selected.kind !== "slice" || selected.address !== unitAddress ||
      selected.record_id !== recordId || selected.slice_id !== sliceId) {
    return { ok: false, decision_code: codes.bindingMismatch, reason: "selected_unit_mismatch" };
  }
  if (result.valid !== true || (result.written !== true && result.no_op !== true)) {
    return { ok: false, decision_code: codes.invalid, reason: "write_not_confirmed" };
  }
  if (result.status !== "review") {
    return { ok: false, decision_code: codes.reviewUnconfirmed, reason: "review_state_not_confirmed" };
  }
  return {
    ok: true,
    decision_code: codes.valid,
    reason: null,
    status: "review",
    written: result.written === true,
    no_op: result.no_op === true
  };
}

export function buildSliceReviewAcceptanceProof(input) {
  if (!isObject(input)) return refuse(CODES.malformed, "input is not an object");

  const committedTargetAdmission = input.review_admission_kind === "canonical_committed_slice" ||
    Object.prototype.hasOwnProperty.call(input, "committed_target_digest");
  const inputFieldSet = committedTargetAdmission ? INPUT_FIELD_SET_V2 : INPUT_FIELD_SET;
  const unknownKeys = Object.keys(input)
    .filter((key) => !inputFieldSet.has(key))
    .sort((left, right) => left.localeCompare(right));
  if (unknownKeys.length > 0) {
    return refuse(
      CODES.malformed,
      `slice-review acceptance proof input accepts a closed field set; unexpected: ${unknownKeys.join(", ")}`
    );
  }

  const unitAddress = normalizeStringEntry(input.unit_address);
  const initiative = normalizeStringEntry(input.initiative);
  const sliceRef = normalizeStringEntry(input.slice_ref);
  const reviewedSha = normalizeStringEntry(input.reviewed_sha);
  const diffBaseSha = normalizeStringEntry(input.diff_base_sha);
  const sourceWorkerRunId = normalizeStringEntry(input.source_worker_run_id);
  const reviewAdmissionKind = normalizeStringEntry(input.review_admission_kind);
  const committedTargetDigest = normalizeStringEntry(input.committed_target_digest);
  const reviewRunId = normalizeStringEntry(input.review_run_id);
  const reviewMonitorHandle = normalizeStringEntry(input.review_monitor_handle);
  const reviewerRole = normalizeStringEntry(input.reviewer_role);
  const reviewOutcome = normalizeStringEntry(input.review_outcome);
  const reviewedAt = normalizeStringEntry(input.reviewed_at);
  const canonicalReviewUnitDigest = normalizeStringEntry(input.canonical_review_unit_digest);
  const structuredResultDigest = normalizeStringEntry(input.structured_result_digest);

  if (!unitAddress || !UNIT_ADDRESS_PATTERN.test(unitAddress)) {
    return refuse(CODES.malformed, "unit_address must be an exact implementation-slice address");
  }
  if (!initiative || !INITIATIVE_PATTERN.test(initiative)) {
    return refuse(CODES.malformed, "initiative must be an IN-NNNN identifier");
  }
  if (!sliceRefAgreesWithUnit(sliceRef, unitAddress, initiative)) {
    return refuse(CODES.malformed, "slice_ref must be the canonical slice branch ref for this unit and initiative");
  }
  if (!isOid(reviewedSha)) return refuse(CODES.malformed, "reviewed_sha must be a Git object id");
  if (!isOid(diffBaseSha)) return refuse(CODES.malformed, "diff_base_sha must be a Git object id");
  if (reviewedSha === diffBaseSha) {
    return refuse(CODES.malformed, "reviewed_sha and diff_base_sha must differ");
  }
  if (committedTargetAdmission) {
    if (reviewAdmissionKind !== "canonical_committed_slice") {
      return refuse(CODES.malformed, "review_admission_kind must identify canonical committed-slice admission");
    }
    if (!isSha256(committedTargetDigest)) {
      return refuse(CODES.malformed, "committed_target_digest must be a sha256 digest");
    }
  } else if (!isRunToken(sourceWorkerRunId)) {
    return refuse(CODES.malformed, "source_worker_run_id must be a bounded run identifier");
  }
  if (!isRunToken(reviewRunId)) {
    return refuse(CODES.malformed, "review_run_id must be a bounded run identifier");
  }
  if (!isRunToken(reviewMonitorHandle)) {
    return refuse(CODES.malformed, "review_monitor_handle must be a bounded monitor handle");
  }
  if (!reviewerRole || !REVIEWER_ROLE_SET.has(reviewerRole)) {
    return refuse(CODES.untrustedProvenance, "reviewer_role must be a findings-only reviewer or redteam role");
  }

  if (!reviewOutcome || !OUTCOME_SET.has(reviewOutcome)) {
    return refuse(
      CODES.reviewNotAccepted,
      "review_outcome must be no_findings or passed_no_blocking_or_medium_findings"
    );
  }
  if (!reviewedAt || !ISO_TIMESTAMP_PATTERN.test(reviewedAt) || !Number.isFinite(Date.parse(reviewedAt))) {
    return refuse(CODES.malformed, "reviewed_at must be an ISO-8601 UTC timestamp");
  }
  if (!isSha256(canonicalReviewUnitDigest)) {
    return refuse(CODES.malformed, "canonical_review_unit_digest must be a sha256 digest");
  }
  if (!isSha256(structuredResultDigest)) {
    return refuse(CODES.malformed, "structured_result_digest must be a sha256 digest");
  }

  const proof = {
    schema_version: committedTargetAdmission
      ? SLICE_REVIEW_ACCEPTANCE_SCHEMA_VERSION_V2
      : SLICE_REVIEW_ACCEPTANCE_SCHEMA_VERSION,
    unit_address: unitAddress,
    initiative,
    slice_ref: sliceRef,
    reviewed_sha: reviewedSha,
    diff_base_sha: diffBaseSha,
    ...(committedTargetAdmission
      ? { review_admission_kind: reviewAdmissionKind, committed_target_digest: committedTargetDigest }
      : { source_worker_run_id: sourceWorkerRunId }),
    review_run_id: reviewRunId,
    review_monitor_handle: reviewMonitorHandle,
    reviewer_role: reviewerRole,
    review_outcome: reviewOutcome,
    reviewed_at: reviewedAt,
    canonical_review_unit_digest: canonicalReviewUnitDigest,
    structured_result_digest: structuredResultDigest,
    evidence_digest: null
  };
  proof.evidence_digest = computeSliceReviewAcceptanceProofDigest(proof);
  return { ok: true, decision_code: CODES.valid, reasons: [], proof: cloneJson(proof) };
}

function isWellFormedSliceReviewAcceptanceProof(proof) {
  if (!isObject(proof)) return false;
  if (![SLICE_REVIEW_ACCEPTANCE_SCHEMA_VERSION,
    SLICE_REVIEW_ACCEPTANCE_SCHEMA_VERSION_V2].includes(proof.schema_version)) return false;
  const inputFields = proof.schema_version === SLICE_REVIEW_ACCEPTANCE_SCHEMA_VERSION_V2
    ? SLICE_REVIEW_ACCEPTANCE_PROOF_INPUT_FIELDS_V2
    : SLICE_REVIEW_ACCEPTANCE_PROOF_INPUT_FIELDS;
  const proofFields = proof.schema_version === SLICE_REVIEW_ACCEPTANCE_SCHEMA_VERSION_V2
    ? SLICE_REVIEW_ACCEPTANCE_PROOF_FIELDS_V2
    : SLICE_REVIEW_ACCEPTANCE_PROOF_FIELDS;
  const keys = Object.keys(proof).sort((left, right) => left.localeCompare(right));
  if (keys.length !== proofFields.length) return false;
  if (keys.some((key, index) => key !== proofFields[index])) return false;
  if (!isSha256(proof.evidence_digest)) return false;
  const rebuilt = buildSliceReviewAcceptanceProof(
    Object.fromEntries(
      inputFields.map((field) => [field, proof[field]])
    )
  );
  return rebuilt.ok === true && rebuilt.proof.evidence_digest === proof.evidence_digest;
}

export function validateSliceReviewAcceptanceProof(proof, expectation = {}) {
  if (proof === null || proof === undefined) {
    return deny(CODES.missing, "no slice-review acceptance proof is persisted for this unit");
  }
  if (!isWellFormedSliceReviewAcceptanceProof(proof)) {
    return deny(CODES.malformed, "slice-review acceptance proof is malformed");
  }
  if (!OUTCOME_SET.has(proof.review_outcome)) {
    return deny(CODES.reviewNotAccepted, "slice-review acceptance proof does not carry a clean review outcome");
  }
  if (!isObject(expectation)) {
    return deny(CODES.bindingMismatch, "expectation binding context is required");
  }

  const bound = [
    ["unit_address", expectation.unit_address],
    ["initiative", expectation.initiative],
    ["slice_ref", expectation.slice_ref],
    ["reviewed_sha", expectation.reviewed_sha],
    ["diff_base_sha", expectation.diff_base_sha],
    ...(proof.schema_version === SLICE_REVIEW_ACCEPTANCE_SCHEMA_VERSION_V2
      ? [
          ["review_admission_kind", expectation.review_admission_kind],
          ["committed_target_digest", expectation.committed_target_digest]
        ]
      : [["source_worker_run_id", expectation.source_worker_run_id]]),
    ["review_run_id", expectation.review_run_id]
  ];
  for (const [field, expected] of bound) {
    const normalized = normalizeStringEntry(expected);
    if (!normalized) {
      return deny(CODES.bindingMismatch, `expectation.${field} is required`);
    }
    if (normalized !== proof[field]) {
      return deny(CODES.bindingMismatch, `${field} does not match the expected slice-review binding`);
    }
  }

  const expectedReviewerRole = normalizeStringEntry(expectation.reviewer_role);
  if (expectedReviewerRole && expectedReviewerRole !== proof.reviewer_role) {
    return deny(CODES.untrustedProvenance, "reviewer_role does not match the expected review run role");
  }
  const expectedReviewMonitorHandle = normalizeStringEntry(expectation.review_monitor_handle);
  if (expectedReviewMonitorHandle && expectedReviewMonitorHandle !== proof.review_monitor_handle) {
    return deny(CODES.bindingMismatch, "review_monitor_handle does not match the expected review run");
  }
  const expectedReviewOutcome = normalizeStringEntry(expectation.review_outcome);
  if (expectedReviewOutcome && expectedReviewOutcome !== proof.review_outcome) {
    return deny(CODES.reviewNotAccepted, "review_outcome does not match the trusted structured result");
  }
  const expectedStructuredResultDigest = normalizeStringEntry(expectation.structured_result_digest);
  if (expectedStructuredResultDigest && expectedStructuredResultDigest !== proof.structured_result_digest) {
    return deny(CODES.bindingMismatch, "structured_result_digest does not match the trusted structured result");
  }
  const expectedUnitDigest = normalizeStringEntry(expectation.canonical_review_unit_digest);
  if (expectedUnitDigest && expectedUnitDigest !== proof.canonical_review_unit_digest) {
    return deny(CODES.targetStale, "the canonical review unit changed after the proof was minted");
  }

  const currentSliceSha = normalizeStringEntry(expectation.current_slice_sha);
  if (currentSliceSha && currentSliceSha !== proof.reviewed_sha) {
    return deny(CODES.targetStale, "the current slice tip is not the reviewed SHA");
  }

  return { valid: true, decision_code: CODES.valid, reasons: [] };
}

export function sliceReviewAcceptanceAuthorityEffects() {
  return Object.freeze({
    authorizes_slice_integration: true,
    satisfies_mandatory_review: false,
    grants_dispatch_authority: false,
    writes_accepted_authorities: false,
    creates_review_attestation: false,
    changes_status: false
  });
}
