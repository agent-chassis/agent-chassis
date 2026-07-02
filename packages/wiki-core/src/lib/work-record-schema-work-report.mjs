

import {
  isObject,
  isString,
  isNullableString,
  hasOwn,
  addDiagnostic,
  validateStringField,
  validateEnumField,
  validateStringArrayField,
  validateNullableStringField
} from "./work-record-schema-validators.mjs";
import {
  WORK_REPORT_SCHEMA_VERSION,
  WORK_REPORT_STATUS_VALUES,
  WORK_REPORT_VALIDATION_STATUS_VALUES
} from "./work-record-schema-constants.mjs";

function validateWorkReportValidationEntry(diagnostics, entry, path) {
  if (!isObject(entry)) {
    addDiagnostic(diagnostics, "invalid_record", `${path} must be an object`, { path });
    return;
  }

  validateStringField(diagnostics, entry, "command", { path: `${path}.command` });
  validateEnumField(diagnostics, entry, "status", WORK_REPORT_VALIDATION_STATUS_VALUES, {
    path: `${path}.status`
  });
  validateNullableStringField(diagnostics, entry, "reason", { path: `${path}.reason` });
}

function validateWorkReportGraphImpactReference(diagnostics, entry, path) {
  if (entry === null) {
    return;
  }
  if (!isObject(entry)) {
    addDiagnostic(diagnostics, "invalid_record", `${path} must be an object or null`, { path });
    return;
  }

  validateStringField(diagnostics, entry, "kind", { path: `${path}.kind` });
  if (isString(entry.kind) && entry.kind !== "graph_impact_reference") {
    addDiagnostic(
      diagnostics,
      "invalid_record",
      `${path}.kind must be graph_impact_reference`,
      { path: `${path}.kind` }
    );
  }
  validateNullableStringField(diagnostics, entry, "tool", { path: `${path}.tool` });
  validateNullableStringField(diagnostics, entry, "artifact_ref", {
    path: `${path}.artifact_ref`
  });
  validateNullableStringField(diagnostics, entry, "summary", { path: `${path}.summary` });
}

function validateWorkReportBlockerEntry(diagnostics, entry, path) {
  if (!isObject(entry)) {
    addDiagnostic(diagnostics, "invalid_record", `${path} must be an object`, { path });
    return;
  }

  validateStringField(diagnostics, entry, "kind", { path: `${path}.kind` });
  validateStringField(diagnostics, entry, "message", { path: `${path}.message` });
  validateNullableStringField(diagnostics, entry, "path", { path: `${path}.path` });
}

function validateWorkReportFollowUpEntry(diagnostics, entry, path) {
  if (!isObject(entry)) {
    addDiagnostic(diagnostics, "invalid_record", `${path} must be an object`, { path });
    return;
  }

  validateStringField(diagnostics, entry, "kind", { path: `${path}.kind` });
  validateStringField(diagnostics, entry, "title", { path: `${path}.title` });
  validateNullableStringField(diagnostics, entry, "repo_ref", { path: `${path}.repo_ref` });
}

function validateWorkReportInto(diagnostics, report) {
  if (!isObject(report)) {
    addDiagnostic(diagnostics, "invalid_record", "work report must be an object", {
      path: "schema_version"
    });
    return;
  }

  if (!hasOwn(report, "schema_version")) {
    addDiagnostic(diagnostics, "invalid_record", "schema_version is required", {
      path: "schema_version"
    });
    return;
  }
  if (!isString(report.schema_version)) {
    addDiagnostic(diagnostics, "invalid_record", "schema_version must be a string", {
      path: "schema_version"
    });
    return;
  }
  if (report.schema_version !== WORK_REPORT_SCHEMA_VERSION) {
    addDiagnostic(
      diagnostics,
      "invalid_record",
      `Unsupported work report schema version: ${report.schema_version}`,
      { path: "schema_version" }
    );
    return;
  }

  validateStringField(diagnostics, report, "record_id", { path: "record_id", allowEmpty: false });
  if (hasOwn(report, "slice_id") && !isNullableString(report.slice_id)) {
    addDiagnostic(diagnostics, "invalid_record", "slice_id must be a string or null", {
      path: "slice_id"
    });
  }
  validateEnumField(diagnostics, report, "agent_role", ["worker"], { path: "agent_role" });
  validateEnumField(diagnostics, report, "status", WORK_REPORT_STATUS_VALUES, { path: "status" });
  validateStringArrayField(diagnostics, report, "changed_paths", { path: "changed_paths" });

  if (!hasOwn(report, "validation") || !Array.isArray(report.validation)) {
    addDiagnostic(diagnostics, "invalid_record", "validation must be an array", {
      path: "validation"
    });
  } else {
    report.validation.forEach((entry, index) =>
      validateWorkReportValidationEntry(diagnostics, entry, `validation[${index}]`)
    );
  }

  if (!hasOwn(report, "graph_impact") || !isObject(report.graph_impact)) {
    addDiagnostic(diagnostics, "invalid_record", "graph_impact must be an object", {
      path: "graph_impact"
    });
  } else {
    validateWorkReportGraphImpactReference(diagnostics, report.graph_impact.pre_edit, "graph_impact.pre_edit");
    validateWorkReportGraphImpactReference(diagnostics, report.graph_impact.post_diff, "graph_impact.post_diff");
    validateNullableStringField(diagnostics, report.graph_impact, "not_applicable_reason", {
      path: "graph_impact.not_applicable_reason"
    });
  }

  if (!hasOwn(report, "blockers") || !Array.isArray(report.blockers)) {
    addDiagnostic(diagnostics, "invalid_record", "blockers must be an array", {
      path: "blockers"
    });
  } else {
    report.blockers.forEach((entry, index) =>
      validateWorkReportBlockerEntry(diagnostics, entry, `blockers[${index}]`)
    );
  }

  if (!hasOwn(report, "follow_ups") || !Array.isArray(report.follow_ups)) {
    addDiagnostic(diagnostics, "invalid_record", "follow_ups must be an array", {
      path: "follow_ups"
    });
  } else {
    report.follow_ups.forEach((entry, index) =>
      validateWorkReportFollowUpEntry(diagnostics, entry, `follow_ups[${index}]`)
    );
  }
}

export function validateWorkReport(report) {
  const diagnostics = [];
  validateWorkReportInto(diagnostics, report);
  return diagnostics;
}
