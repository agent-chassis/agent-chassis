

import {
  addDiagnostic,
  isObject,
  isString,
  hasOwn,
  validateStringField,
  validateNullableStringField,
  validateControlledStringField,
  validateFacetProvenance,
  validateAcceptanceCriterionEntry
} from "./work-record-schema-validators.mjs";
import {
  WORK_UNIT_FEATURE_VECTOR_SCHEMA_VERSION,
  WORK_UNIT_ONTOLOGY_SCHEMA_VERSION,
  WORK_UNIT_FEATURE_VECTOR_ACTIVITY_KIND_VALUES,
  WORK_UNIT_FEATURE_VECTOR_ARTIFACT_KIND_VALUES,
  WORK_UNIT_FEATURE_VECTOR_OPERATION_VALUES,
  WORK_UNIT_FEATURE_VECTOR_GRANULARITY_VALUES,
  WORK_UNIT_FEATURE_VECTOR_SCENARIO_KIND_VALUES,
  WORK_UNIT_FEATURE_VECTOR_RUNTIME_MODE_VALUES
} from "./work-record-schema-constants.mjs";

function validateScenarioEntry(diagnostics, entry, path) {
  if (!isObject(entry)) {
    addDiagnostic(diagnostics, "invalid_record", `${path} must be an object`, { path });
    return null;
  }

  validateStringField(diagnostics, entry, "id", { path: `${path}.id`, allowEmpty: false });
  const scenarioKindField = hasOwn(entry, "scenario_kind") ? "scenario_kind" : hasOwn(entry, "kind") ? "kind" : null;
  if (!scenarioKindField) {
    addDiagnostic(diagnostics, "invalid_record", `${path}.scenario_kind is required`, {
      path: `${path}.scenario_kind`
    });
  } else {
    validateStringField(diagnostics, entry, scenarioKindField, {
      path: `${path}.${scenarioKindField}`,
      allowEmpty: false
    });
    validateControlledStringField(
      diagnostics,
      entry,
      scenarioKindField,
      WORK_UNIT_FEATURE_VECTOR_SCENARIO_KIND_VALUES,
      { path: `${path}.${scenarioKindField}` }
    );
  }
  if (hasOwn(entry, "scenario_kind") && hasOwn(entry, "kind") && entry.scenario_kind !== entry.kind) {
    addDiagnostic(
      diagnostics,
      "invalid_record",
      `${path}.kind must match scenario_kind when both are present`,
      { path: `${path}.kind` }
    );
  }

  if (hasOwn(entry, "process_boundary") && typeof entry.process_boundary !== "boolean") {
    addDiagnostic(diagnostics, "invalid_record", `${path}.process_boundary must be a boolean`, {
      path: `${path}.process_boundary`
    });
  }
  validateNullableStringField(diagnostics, entry, "asserts_contract", {
    path: `${path}.asserts_contract`
  });
  validateNullableStringField(diagnostics, entry, "asserts_provenance_field", {
    path: `${path}.asserts_provenance_field`
  });
  validateNullableStringField(diagnostics, entry, "uses_stub", { path: `${path}.uses_stub` });
  validateControlledStringField(
    diagnostics,
    entry,
    "runtime_mode",
    WORK_UNIT_FEATURE_VECTOR_RUNTIME_MODE_VALUES,
    { path: `${path}.runtime_mode`, allowNull: true }
  );
  validateControlledStringField(
    diagnostics,
    entry,
    "artifact_kind",
    WORK_UNIT_FEATURE_VECTOR_ARTIFACT_KIND_VALUES,
    { path: `${path}.artifact_kind`, allowNull: true }
  );
  if (hasOwn(entry, "facet_provenance")) {
    validateFacetProvenance(diagnostics, entry.facet_provenance, `${path}.facet_provenance`);
  }

  return isString(entry.id) ? entry.id : null;
}

function validateActivityArtifactTargetEntry(diagnostics, entry, path) {
  if (!isObject(entry)) {
    addDiagnostic(diagnostics, "invalid_record", `${path} must be an object`, { path });
    return;
  }

  validateStringField(diagnostics, entry, "id", { path: `${path}.id`, allowEmpty: false });
  validateStringField(diagnostics, entry, "path", { path: `${path}.path`, allowEmpty: false });
  validateStringField(diagnostics, entry, "name", { path: `${path}.name`, allowEmpty: false });
  validateStringField(diagnostics, entry, "activity_kind", {
    path: `${path}.activity_kind`,
    allowEmpty: false
  });
  validateControlledStringField(
    diagnostics,
    entry,
    "activity_kind",
    WORK_UNIT_FEATURE_VECTOR_ACTIVITY_KIND_VALUES,
    { path: `${path}.activity_kind` }
  );
  validateStringField(diagnostics, entry, "artifact_kind", {
    path: `${path}.artifact_kind`,
    allowEmpty: false
  });
  validateControlledStringField(
    diagnostics,
    entry,
    "artifact_kind",
    WORK_UNIT_FEATURE_VECTOR_ARTIFACT_KIND_VALUES,
    { path: `${path}.artifact_kind` }
  );
  validateStringField(diagnostics, entry, "operation", { path: `${path}.operation`, allowEmpty: false });
  validateControlledStringField(
    diagnostics,
    entry,
    "operation",
    WORK_UNIT_FEATURE_VECTOR_OPERATION_VALUES,
    { path: `${path}.operation` }
  );
  validateStringField(diagnostics, entry, "granularity", {
    path: `${path}.granularity`,
    allowEmpty: false
  });
  validateControlledStringField(
    diagnostics,
    entry,
    "granularity",
    WORK_UNIT_FEATURE_VECTOR_GRANULARITY_VALUES,
    { path: `${path}.granularity` }
  );
  if (hasOwn(entry, "optional") && typeof entry.optional !== "boolean") {
    addDiagnostic(diagnostics, "invalid_record", `${path}.optional must be a boolean`, {
      path: `${path}.optional`
    });
  }
  if (hasOwn(entry, "facet_provenance")) {
    validateFacetProvenance(diagnostics, entry.facet_provenance, `${path}.facet_provenance`);
  }
}

function validateWorkUnitFeatureVectorInto(diagnostics, vector, path = "work_unit_feature_vector") {
  if (!isObject(vector)) {
    addDiagnostic(diagnostics, "invalid_record", `${path} must be an object`, { path });
    return;
  }

  validateStringField(diagnostics, vector, "schema_version", {
    path: `${path}.schema_version`,
    allowEmpty: false
  });
  if (isString(vector.schema_version) && vector.schema_version !== WORK_UNIT_FEATURE_VECTOR_SCHEMA_VERSION) {
    addDiagnostic(
      diagnostics,
      "invalid_record",
      `${path}.schema_version must be ${WORK_UNIT_FEATURE_VECTOR_SCHEMA_VERSION}`,
      { path: `${path}.schema_version` }
    );
  }
  validateStringField(diagnostics, vector, "vocabulary_version", {
    path: `${path}.vocabulary_version`,
    allowEmpty: false
  });
  if (isString(vector.vocabulary_version) && vector.vocabulary_version !== WORK_UNIT_ONTOLOGY_SCHEMA_VERSION) {
    addDiagnostic(
      diagnostics,
      "invalid_record",
      `${path}.vocabulary_version must be ${WORK_UNIT_ONTOLOGY_SCHEMA_VERSION}`,
      { path: `${path}.vocabulary_version` }
    );
  }

  if (!hasOwn(vector, "work_unit_address") || !isObject(vector.work_unit_address)) {
    addDiagnostic(diagnostics, "invalid_record", `${path}.work_unit_address must be an object`, {
      path: `${path}.work_unit_address`
    });
  } else {
    validateStringField(diagnostics, vector.work_unit_address, "repo", {
      path: `${path}.work_unit_address.repo`,
      allowEmpty: false
    });
    validateStringField(diagnostics, vector.work_unit_address, "record_id", {
      path: `${path}.work_unit_address.record_id`,
      allowEmpty: false
    });
    validateNullableStringField(diagnostics, vector.work_unit_address, "slice_id", {
      path: `${path}.work_unit_address.slice_id`
    });
    validateStringField(diagnostics, vector.work_unit_address, "address", {
      path: `${path}.work_unit_address.address`,
      allowEmpty: false
    });
  }

  if (!Array.isArray(vector.activity_artifact_targets)) {
    addDiagnostic(diagnostics, "invalid_record", `${path}.activity_artifact_targets must be an array`, {
      path: `${path}.activity_artifact_targets`
    });
  } else {
    vector.activity_artifact_targets.forEach((entry, index) =>
      validateActivityArtifactTargetEntry(diagnostics, entry, `${path}.activity_artifact_targets[${index}]`)
    );
  }

  if (!Array.isArray(vector.scenarios)) {
    addDiagnostic(diagnostics, "invalid_record", `${path}.scenarios must be an array`, {
      path: `${path}.scenarios`
    });
  } else {
    const seenScenarioIds = new Set();
    vector.scenarios.forEach((entry, index) => {
      const entryPath = `${path}.scenarios[${index}]`;
      const scenarioId = validateScenarioEntry(diagnostics, entry, entryPath);
      if (scenarioId) {
        if (seenScenarioIds.has(scenarioId)) {
          addDiagnostic(diagnostics, "invalid_record", `${entryPath}.id must be unique within scenarios`, {
            path: `${entryPath}.id`
          });
        }
        seenScenarioIds.add(scenarioId);
      }
    });
  }

  if (!Array.isArray(vector.acceptance_methods)) {
    addDiagnostic(diagnostics, "invalid_record", `${path}.acceptance_methods must be an array`, {
      path: `${path}.acceptance_methods`
    });
  } else {
    vector.acceptance_methods.forEach((entry, index) =>
      validateAcceptanceCriterionEntry(diagnostics, entry, `${path}.acceptance_methods[${index}]`)
    );
  }

  if (hasOwn(vector, "graph_evidence") && vector.graph_evidence !== null && !isObject(vector.graph_evidence)) {
    addDiagnostic(diagnostics, "invalid_record", `${path}.graph_evidence must be null or an object`, {
      path: `${path}.graph_evidence`
    });
  }
  if (hasOwn(vector, "diff_evidence") && vector.diff_evidence !== null && !isObject(vector.diff_evidence)) {
    addDiagnostic(diagnostics, "invalid_record", `${path}.diff_evidence must be null or an object`, {
      path: `${path}.diff_evidence`
    });
  }
  if (hasOwn(vector, "derived_metrics") && !isObject(vector.derived_metrics)) {
    addDiagnostic(diagnostics, "invalid_record", `${path}.derived_metrics must be an object`, {
      path: `${path}.derived_metrics`
    });
  }
  if (hasOwn(vector, "escalations") && !Array.isArray(vector.escalations)) {
    addDiagnostic(diagnostics, "invalid_record", `${path}.escalations must be an array`, {
      path: `${path}.escalations`
    });
  }
  if (hasOwn(vector, "degradations") && !Array.isArray(vector.degradations)) {
    addDiagnostic(diagnostics, "invalid_record", `${path}.degradations must be an array`, {
      path: `${path}.degradations`
    });
  }
}

export function validateWorkUnitFeatureVector(vector, { path = "work_unit_feature_vector" } = {}) {
  const diagnostics = [];
  validateWorkUnitFeatureVectorInto(diagnostics, vector, path);
  return diagnostics;
}

export { validateWorkUnitFeatureVectorInto };
