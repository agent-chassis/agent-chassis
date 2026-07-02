

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
