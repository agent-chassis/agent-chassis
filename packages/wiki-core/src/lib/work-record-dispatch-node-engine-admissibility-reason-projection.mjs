

import { isNonEmptyString, isObject } from "./work-record-dispatch-shared.mjs";

export const REVIEW_THRESHOLD_REASON_CODES = new Set([
  "review_threshold_exceeded",
  "worker_admission.work_unit_atomicity.review_threshold_exceeded.v1"
]);

const ALLOWED_NEEDS_REVIEW_REASON_CODES = new Set([
  ...REVIEW_THRESHOLD_REASON_CODES,
  "request_schema_unrecognized"
]);

const ALLOWED_PUBLIC_REASON_CODES = new Set([
  ...ALLOWED_NEEDS_REVIEW_REASON_CODES,
  "worker_admission.work_unit_atomicity.write_scope_count_denied.v1"
]);

const ALLOWED_NEEDS_REVIEW_CONTROL_IDS = new Set([
  "write_scope_total_loc",
  "max_write_file_loc",
  "write_scope_count",

  "write_scope_test_count",
  "acceptance_criteria_count",
  "validation_command_count",
  "expected_changed_line_budget",
  "expected_edit_targets",
  "declared_runtime_mode_count",
  "artifact_kind_count"
]);

const ALLOWED_NEEDS_REVIEW_REASON_FIELDS = new Set([
  ...ALLOWED_NEEDS_REVIEW_CONTROL_IDS,
  "accepted_authority",
  "accepted_authorities",
  "review_attestation",
  "review_attestations",
  "request_schema",
  "request_contract_digest"
]);

const NEEDS_REVIEW_REASON_FAMILIES = Object.freeze([
  ["accepted_authority_", "accepted_authority_failure"],
  ["review_attestation_", "review_attestation_failure"]
]);

const SAFE_REASON_TOKEN_PATTERN = /^[a-z][a-z0-9_]{0,119}$/u;
const SAFE_EVIDENCE_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,119}$/u;
const BOUNDED_REASON_OBSERVED_STRING_MAX = 256;

function allowlistNeedsReviewReasonCode(value) {
  if (!isNonEmptyString(value)) {
    return null;
  }
  const trimmed = value.trim();
  if (ALLOWED_NEEDS_REVIEW_REASON_CODES.has(trimmed)) {
    return trimmed;
  }
  if (
    SAFE_REASON_TOKEN_PATTERN.test(trimmed) &&
    NEEDS_REVIEW_REASON_FAMILIES.some(([prefix]) => trimmed.startsWith(prefix))
  ) {
    return trimmed;
  }
  return null;
}

function allowlistPublicReasonCode(value) {
  if (!isNonEmptyString(value)) {
    return null;
  }
  const trimmed = value.trim();
  return ALLOWED_PUBLIC_REASON_CODES.has(trimmed) || allowlistNeedsReviewReasonCode(trimmed)
    ? trimmed
    : null;
}

function allowlistNeedsReviewControlId(value) {
  if (!isNonEmptyString(value)) {
    return null;
  }
  const trimmed = value.trim();
  return ALLOWED_NEEDS_REVIEW_CONTROL_IDS.has(trimmed) ? trimmed : null;
}

function allowlistNeedsReviewReasonField(value) {
  if (!isNonEmptyString(value)) {
    return null;
  }
  const trimmed = value.trim();
  return ALLOWED_NEEDS_REVIEW_REASON_FIELDS.has(trimmed) ? trimmed : null;
}

function classifyNeedsReviewReasonFamily(reasonCode) {
  if (reasonCode === "request_schema_unrecognized") {
    return "request_schema_unrecognized";
  }
  for (const [prefix, family] of NEEDS_REVIEW_REASON_FAMILIES) {
    if (reasonCode.startsWith(prefix)) {
      return family;
    }
  }
  return null;
}

function projectBoundedEvidenceKeys(reason) {
  if (!Array.isArray(reason?.evidence_keys)) {
    return [];
  }
  return [
    ...new Set(
      reason.evidence_keys
        .filter((key) => isNonEmptyString(key))
        .map((key) => key.trim())
        .filter((key) => SAFE_EVIDENCE_KEY_PATTERN.test(key))
    )
  ].slice(0, 24);
}

function projectLegacyPublicEvidenceKeys(reason) {
  if (!Array.isArray(reason?.evidence_keys)) {
    return [];
  }
  return [
    ...new Set(
      reason.evidence_keys
        .filter((key) => isNonEmptyString(key))
        .map((key) => key.trim())
        .filter((key) => key === "evidence_field_name")
    )
  ];
}

function normalizeBoundedReasonScalar(value) {
  if (value === null || typeof value === "boolean") {
    return { present: true, value };
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? { present: true, value } : { present: false };
  }
  if (typeof value === "string") {
    return value.length <= BOUNDED_REASON_OBSERVED_STRING_MAX
      ? { present: true, value }
      : { present: true, value: `${value.slice(0, BOUNDED_REASON_OBSERVED_STRING_MAX)}…` };
  }
  return { present: false };
}

export function projectBoundedNeedsReviewReasonFacts(reasons) {
  if (!Array.isArray(reasons)) {
    return [];
  }
  const facts = [];
  for (const reason of reasons) {
    if (!isObject(reason)) {
      continue;
    }
    const reasonCode = allowlistNeedsReviewReasonCode(reason.code);
    if (!reasonCode) {
      continue;
    }
    const fact = { reason_code: reasonCode };
    const family = classifyNeedsReviewReasonFamily(reasonCode);
    if (family) {
      fact.reason_family = family;
    }
    const control = allowlistNeedsReviewControlId(reason.field);
    if (control) {
      fact.control = control;
    }
    const field = control ? null : allowlistNeedsReviewReasonField(reason.field);
    if (field) {
      fact.field = field;
    }
    const observed = normalizeBoundedReasonScalar(reason.observed);
    if (observed.present) {
      fact.observed = observed.value;
    }
    if (typeof reason.threshold === "number" && Number.isFinite(reason.threshold)) {
      fact.threshold = reason.threshold;
    }
    const evidenceKeys = family ? projectBoundedEvidenceKeys(reason) : [];
    if (evidenceKeys.length > 0) {
      fact.evidence_keys = evidenceKeys;
    }
    facts.push(fact);
  }
  return facts;
}

export function projectBoundedPublicReasons(reasons) {
  if (!Array.isArray(reasons)) {
    return [];
  }
  const projected = [];
  for (const reason of reasons) {
    if (!isObject(reason) || !isNonEmptyString(reason.code)) {
      continue;
    }
    const code = allowlistPublicReasonCode(reason.code);
    if (!code) {
      continue;
    }
    const entry = { code };
    const field = allowlistNeedsReviewControlId(reason.field);
    if (field) {
      entry.field = field;
    } else {
      const reasonField = allowlistNeedsReviewReasonField(reason.field);
      if (reasonField) {
        entry.field = reasonField;
      }
    }
    const observed = normalizeBoundedReasonScalar(reason.observed);
    if (observed.present) {
      entry.observed = observed.value;
    }
    if (typeof reason.threshold === "number" && Number.isFinite(reason.threshold)) {
      entry.threshold = reason.threshold;
    }
    const reasonFamily = classifyNeedsReviewReasonFamily(code);
    const evidenceKeys = reasonFamily
      ? projectBoundedEvidenceKeys(reason)
      : projectLegacyPublicEvidenceKeys(reason);
    if (evidenceKeys.length > 0) {
      entry.evidence_keys = evidenceKeys;
    }
    projected.push(entry);
  }
  return projected;
}

export function classifyNeedsReviewReasonShape({
  packReasonCount,
  recognizedReasonCount,
  reviewThresholdControls,
  reasonFamilies
}) {
  if (packReasonCount === 0) {
    return "needs_review_no_pack_reasons";
  }
  if (recognizedReasonCount === 0) {
    return "needs_review_unrecognized_reasons";
  }
  if (reasonFamilies.includes("review_attestation_failure")) {
    return "review_attestation_failure";
  }
  if (reasonFamilies.includes("accepted_authority_failure")) {
    return "accepted_authority_failure";
  }
  if (reasonFamilies.includes("request_schema_unrecognized")) {
    return "request_schema_unrecognized";
  }
  if (reviewThresholdControls.length > 0) {
    return "review_threshold_exceeded";
  }
  return "needs_review_unprojectable_control";
}

export function selectedUnitFactsFromReadiness(readiness) {
  const unit = isObject(readiness?.unit) ? readiness.unit : null;
  const selectedUnitAddress = isNonEmptyString(unit?.address)
    ? unit.address.trim()
    : isNonEmptyString(readiness?.unit)
      ? readiness.unit.trim()
      : null;
  const selectedRecordId = isNonEmptyString(unit?.record_id)
    ? unit.record_id.trim()
    : isNonEmptyString(readiness?.record_id)
      ? readiness.record_id.trim()
      : null;
  const selectedSliceId = isNonEmptyString(unit?.slice_id) ? unit.slice_id.trim() : null;
  return {
    selected_unit_address: selectedUnitAddress,
    selected_record_id: selectedRecordId,
    selected_slice_id: selectedSliceId
  };
}
