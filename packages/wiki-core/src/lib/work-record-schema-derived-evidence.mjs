

import {
  isObject,
  isString,
  isNullableString,
  hasOwn,
  addDiagnostic,
  validateStringField,
  validateNullableNonNegativeIntegerField
} from "./work-record-schema-validators.mjs";
import {
  WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_REQUIRED_METRIC_FIELD_SPECS,
  WORK_RECORD_DERIVED_EVIDENCE_DECISION_KIND_VALUES
} from "./work-record-schema-constants.mjs";

export const WORK_RECORD_REVIEW_PROVENANCE_FIELD = "review_provenance";
export const WORK_RECORD_REVIEW_PROVENANCE_SCHEMA_VERSION = "review-provenance.v1";
export const WORK_RECORD_REVIEW_PROVENANCE_TARGET_KINDS = Object.freeze([
  "git_commit_range",
  "canonical_contract"
]);

const REVIEW_PROVENANCE_ENTRY_FIELDS = new Set([
  "schema_version", "repository", "review_unit", "reviewed_unit", "purpose", "role",
  "run_id", "target_kind", "reviewed_sha", "diff_base_sha", "source_digest",
  "result_digest", "receipt_digest", "terminal_disposition", "challenged_review"
]);
const CHALLENGED_REVIEW_FIELDS = new Set([
  "review_unit", "run_id", "target_kind", "reviewed_sha", "diff_base_sha", "source_digest"
]);
const UNIT_RE = /^WK-\d{4}(?:#SLICE-\d{3})?$/u;
const SHA_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;

function validateReviewTarget(diagnostics, value, path, allowedFields) {
  const targetKind = value?.target_kind;
  if (!WORK_RECORD_REVIEW_PROVENANCE_TARGET_KINDS.includes(targetKind)) {
    addDiagnostic(diagnostics, "invalid_record", `${path}.target_kind must be one of: ${WORK_RECORD_REVIEW_PROVENANCE_TARGET_KINDS.join(", ")}`, { path: `${path}.target_kind` });
    return;
  }
  const targetFields = ["reviewed_sha", "diff_base_sha", "source_digest"];
  if (targetKind === "git_commit_range") {
    for (const field of ["reviewed_sha", "diff_base_sha"]) {
      if (!isString(value[field]) || !SHA_RE.test(value[field])) {
        addDiagnostic(diagnostics, "invalid_record", `${path}.${field} is required and must be a lowercase git object id`, { path: `${path}.${field}` });
      }
    }
    if (hasOwn(value, "source_digest")) {
      addDiagnostic(diagnostics, "invalid_record", `${path}.source_digest is forbidden for git_commit_range`, { path: `${path}.source_digest` });
    }
  } else {
    if (!isString(value.source_digest) || !DIGEST_RE.test(value.source_digest)) {
      addDiagnostic(diagnostics, "invalid_record", `${path}.source_digest is required and must be sha256:<64 lowercase hex>`, { path: `${path}.source_digest` });
    }
    for (const field of ["reviewed_sha", "diff_base_sha"]) {
      if (hasOwn(value, field)) {
        addDiagnostic(diagnostics, "invalid_record", `${path}.${field} is forbidden for canonical_contract`, { path: `${path}.${field}` });
      }
    }
  }
  for (const field of targetFields) {
    if (hasOwn(value, field) && !allowedFields.has(field)) {
      addDiagnostic(diagnostics, "invalid_record", `${path}.${field} is not supported`, { path: `${path}.${field}` });
    }
  }
}

export function validateWorkRecordReviewProvenanceEntry(entry, { path = "review_provenance[0]", repository = null } = {}) {
  const diagnostics = [];
  if (!isObject(entry)) {
    addDiagnostic(diagnostics, "invalid_record", `${path} must be an object`, { path });
    return diagnostics;
  }
  for (const field of Object.keys(entry)) {
    if (!REVIEW_PROVENANCE_ENTRY_FIELDS.has(field)) {
      addDiagnostic(diagnostics, "invalid_record", `${path}.${field} is not supported`, { path: `${path}.${field}` });
    }
  }
  for (const field of ["schema_version", "repository", "review_unit", "reviewed_unit", "purpose", "role", "run_id", "target_kind", "terminal_disposition"]) {
    validateStringField(diagnostics, entry, field, { path: `${path}.${field}`, allowEmpty: false });
  }
  if (entry.schema_version !== WORK_RECORD_REVIEW_PROVENANCE_SCHEMA_VERSION) {
    addDiagnostic(diagnostics, "invalid_record", `${path}.schema_version must be ${WORK_RECORD_REVIEW_PROVENANCE_SCHEMA_VERSION}`, { path: `${path}.schema_version` });
  }
  if (repository && entry.repository !== repository) {
    addDiagnostic(diagnostics, "invalid_record", `${path}.repository must be ${repository}`, { path: `${path}.repository` });
  }
  for (const field of ["review_unit", "reviewed_unit"]) {
    if (isString(entry[field]) && !UNIT_RE.test(entry[field])) {
      addDiagnostic(diagnostics, "invalid_record", `${path}.${field} must be a canonical WK unit address`, { path: `${path}.${field}` });
    }
  }
  if (!new Set(["standalone", "terminal_whole_wk"]).has(entry.purpose)) {
    addDiagnostic(diagnostics, "invalid_record", `${path}.purpose must be standalone or terminal_whole_wk`, { path: `${path}.purpose` });
  }
  if (!new Set(["reviewer", "redteam"]).has(entry.role)) {
    addDiagnostic(diagnostics, "invalid_record", `${path}.role must be reviewer or redteam`, { path: `${path}.role` });
  }
  if (!new Set(["succeeded", "failed", "cancelled"]).has(entry.terminal_disposition)) {
    addDiagnostic(diagnostics, "invalid_record", `${path}.terminal_disposition must be succeeded, failed, or cancelled`, { path: `${path}.terminal_disposition` });
  }
  for (const field of ["result_digest", "receipt_digest"]) {
    if (hasOwn(entry, field) && (!isString(entry[field]) || !DIGEST_RE.test(entry[field]))) {
      addDiagnostic(diagnostics, "invalid_record", `${path}.${field} must be sha256:<64 lowercase hex>`, { path: `${path}.${field}` });
    }
  }
  validateReviewTarget(diagnostics, entry, path, REVIEW_PROVENANCE_ENTRY_FIELDS);
  if (hasOwn(entry, "challenged_review")) {
    const challenged = entry.challenged_review;
    if (!isObject(challenged)) {
      addDiagnostic(diagnostics, "invalid_record", `${path}.challenged_review must be an object`, { path: `${path}.challenged_review` });
    } else {
      for (const field of Object.keys(challenged)) {
        if (!CHALLENGED_REVIEW_FIELDS.has(field)) {
          addDiagnostic(diagnostics, "invalid_record", `${path}.challenged_review.${field} is not supported`, { path: `${path}.challenged_review.${field}` });
        }
      }
      for (const field of ["review_unit", "run_id", "target_kind"]) {
        validateStringField(diagnostics, challenged, field, { path: `${path}.challenged_review.${field}`, allowEmpty: false });
      }
      if (isString(challenged.review_unit) && !UNIT_RE.test(challenged.review_unit)) {
        addDiagnostic(diagnostics, "invalid_record", `${path}.challenged_review.review_unit must be a canonical WK unit address`, { path: `${path}.challenged_review.review_unit` });
      }
      validateReviewTarget(diagnostics, challenged, `${path}.challenged_review`, CHALLENGED_REVIEW_FIELDS);
    }
  }
  return diagnostics;
}

export function validateWorkRecordReviewProvenanceLedger(value, { path = WORK_RECORD_REVIEW_PROVENANCE_FIELD, repository = null } = {}) {
  const diagnostics = [];
  if (!Array.isArray(value)) {
    addDiagnostic(diagnostics, "invalid_record", `${path} must be an array`, { path });
    return diagnostics;
  }
  value.forEach((entry, index) => diagnostics.push(...validateWorkRecordReviewProvenanceEntry(entry, {
    path: `${path}[${index}]`, repository
  })));
  return diagnostics;
}

function validateWorkerAdmissionDerivedEvidenceFields(
  diagnostics,
  object,
  path,
  requiredFields
) {
  if (!isObject(object)) {
    addDiagnostic(diagnostics, "invalid_record", `${path} must be an object`, { path });
    return;
  }

  for (const spec of requiredFields) {
    const fieldPath = `${path}.${spec.field}`;
    if (!hasOwn(object, spec.field)) {
      addDiagnostic(diagnostics, "invalid_record", `${fieldPath} is required`, { path: fieldPath });
      continue;
    }
    const value = object[spec.field];
    if (spec.kind === "object") {
      if (!isObject(value)) {
        addDiagnostic(diagnostics, "invalid_record", `${fieldPath} must be an object`, {
          path: fieldPath
        });
      }
      continue;
    }
    validateNullableNonNegativeIntegerField(diagnostics, object, spec.field, {
      path: fieldPath
    });
  }
}

function validateWorkerAdmissionDerivedEvidenceRequestSubject(
  diagnostics,
  subject,
  path,
  { recordId = null, recordRepo = null, expectedUnit = null } = {}
) {
  if (!isObject(subject)) {
    addDiagnostic(diagnostics, "invalid_record", `${path} must be an object`, { path });
    return;
  }

  validateStringField(diagnostics, subject, "kind", { path: `${path}.kind`, allowEmpty: false });
  if (isString(subject.kind) && subject.kind !== "work_unit") {
    addDiagnostic(diagnostics, "invalid_record", `${path}.kind must be work_unit`, {
      path: `${path}.kind`
    });
  }

  validateStringField(diagnostics, subject, "repo", { path: `${path}.repo`, allowEmpty: false });
  if (isString(subject.repo) && isString(recordRepo) && subject.repo !== recordRepo) {
    addDiagnostic(
      diagnostics,
      "invalid_record",
      `${path}.repo must be ${recordRepo}`,
      { path: `${path}.repo` }
    );
  }

  if (!hasOwn(subject, "unit") || !isObject(subject.unit)) {
    addDiagnostic(diagnostics, "invalid_record", `${path}.unit must be an object`, {
      path: `${path}.unit`
    });
    return;
  }

  validateStringField(diagnostics, subject.unit, "record_id", {
    path: `${path}.unit.record_id`,
    allowEmpty: false
  });
  if (isString(subject.unit.record_id) && recordId && subject.unit.record_id !== recordId) {
    addDiagnostic(
      diagnostics,
      "invalid_record",
      `${path}.unit.record_id must be ${recordId}`,
      { path: `${path}.unit.record_id` }
    );
  }

  validateStringField(diagnostics, subject.unit, "address", {
    path: `${path}.unit.address`,
    allowEmpty: false
  });
  if (
    isObject(expectedUnit) &&
    isString(subject.unit.address) &&
    isString(expectedUnit.address) &&
    subject.unit.address !== expectedUnit.address
  ) {
    addDiagnostic(
      diagnostics,
      "invalid_record",
      `${path}.unit.address must be ${expectedUnit.address}`,
      { path: `${path}.unit.address` }
    );
  }

  if (hasOwn(subject.unit, "slice_id") && !isNullableString(subject.unit.slice_id)) {
    addDiagnostic(
      diagnostics,
      "invalid_record",
      `${path}.unit.slice_id must be a string or null`,
      { path: `${path}.unit.slice_id` }
    );
  }
  if (
    isObject(expectedUnit) &&
    hasOwn(expectedUnit, "slice_id") &&
    subject.unit.slice_id !== expectedUnit.slice_id
  ) {
    addDiagnostic(
      diagnostics,
      "invalid_record",
      `${path}.unit.slice_id must be ${expectedUnit.slice_id === null ? "null" : expectedUnit.slice_id}`,
      { path: `${path}.unit.slice_id` }
    );
  }
}

function validateWorkerAdmissionDerivedEvidenceStructure(
  diagnostics,
  evidence,
  path,
  { recordId = null, recordRepo = null, expectedUnit = null } = {}
) {
  if (!isObject(evidence)) {
    addDiagnostic(diagnostics, "invalid_record", `${path} must be an object`, { path });
    return;
  }

  if (hasOwn(evidence, "normalized_request")) {
    if (!isObject(evidence.normalized_request)) {
      addDiagnostic(diagnostics, "invalid_record", `${path}.normalized_request must be an object`, {
        path: `${path}.normalized_request`
      });
    } else {
      validateStringField(diagnostics, evidence.normalized_request, "schema_version", {
        path: `${path}.normalized_request.schema_version`,
        allowEmpty: false
      });
      if (
        isString(evidence.normalized_request.schema_version) &&
        evidence.normalized_request.schema_version !== "worker-admission-request.v1"
      ) {
        addDiagnostic(
          diagnostics,
          "invalid_record",
          `${path}.normalized_request.schema_version must be worker-admission-request.v1`,
          { path: `${path}.normalized_request.schema_version` }
        );
      }
      validateStringField(diagnostics, evidence.normalized_request, "decision_kind", {
        path: `${path}.normalized_request.decision_kind`,
        allowEmpty: false
      });
      if (
        isString(evidence.normalized_request.decision_kind) &&
        evidence.normalized_request.decision_kind !== WORK_RECORD_DERIVED_EVIDENCE_DECISION_KIND_VALUES[0]
      ) {
        addDiagnostic(
          diagnostics,
          "invalid_record",
          `${path}.normalized_request.decision_kind must be work_unit_atomicity`,
          { path: `${path}.normalized_request.decision_kind` }
        );
      }
      validateWorkerAdmissionDerivedEvidenceRequestSubject(
        diagnostics,
        evidence.normalized_request.subject,
        `${path}.normalized_request.subject`,
        {
          recordId,
          recordRepo,
          expectedUnit
        }
      );
      validateWorkerAdmissionDerivedEvidenceFields(
        diagnostics,
        evidence.normalized_request.work_unit_metrics,
        `${path}.normalized_request.work_unit_metrics`,
        WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_REQUIRED_METRIC_FIELD_SPECS
      );
    }
  } else {

    if (hasOwn(evidence, "admission_summary")) {
      if (!isObject(evidence.admission_summary)) {
        addDiagnostic(diagnostics, "invalid_record", `${path}.admission_summary must be an object`, {
          path: `${path}.admission_summary`
        });
      } else {
        validateStringField(diagnostics, evidence.admission_summary, "result", {
          path: `${path}.admission_summary.result`,
          allowEmpty: false
        });
      }
    }
    if (hasOwn(evidence, "sidecar_path") && !isNullableString(evidence.sidecar_path)) {
      addDiagnostic(diagnostics, "invalid_record", `${path}.sidecar_path must be a string or null`, {
        path: `${path}.sidecar_path`
      });
    }
    if (hasOwn(evidence, "sidecar_digest") && !isNullableString(evidence.sidecar_digest)) {
      addDiagnostic(diagnostics, "invalid_record", `${path}.sidecar_digest must be a string or null`, {
        path: `${path}.sidecar_digest`
      });
    }
  }

  validateWorkerAdmissionDerivedEvidenceFields(
    diagnostics,
    evidence.metric_summary,
    `${path}.metric_summary`,
    WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_REQUIRED_METRIC_FIELD_SPECS
  );

  if (!hasOwn(evidence, "provenance") || !isObject(evidence.provenance)) {
    addDiagnostic(diagnostics, "invalid_record", `${path}.provenance must be an object`, {
      path: `${path}.provenance`
    });
  } else {
    validateStringField(diagnostics, evidence.provenance, "source_kind", {
      path: `${path}.provenance.source_kind`,
      allowEmpty: false
    });
    validateStringField(diagnostics, evidence.provenance, "canonicality", {
      path: `${path}.provenance.canonicality`,
      allowEmpty: false
    });
    validateStringField(diagnostics, evidence.provenance, "evidence_basis", {
      path: `${path}.provenance.evidence_basis`,
      allowEmpty: false
    });
    validateStringField(diagnostics, evidence.provenance, "policy_backend", {
      path: `${path}.provenance.policy_backend`,
      allowEmpty: false
    });
    validateStringField(diagnostics, evidence.provenance, "policy_version", {
      path: `${path}.provenance.policy_version`,
      allowEmpty: false
    });
  }
}

export function validateWorkerAdmissionDerivedEvidence(
  evidence,
  { path = "derived_evidence[0]", recordId = null, recordRepo = null, expectedUnit = null } = {}
) {
  const diagnostics = [];
  validateWorkerAdmissionDerivedEvidenceStructure(diagnostics, evidence, path, {
    recordId,
    recordRepo,
    expectedUnit
  });
  return diagnostics;
}

export { validateWorkerAdmissionDerivedEvidenceStructure };
