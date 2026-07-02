

import {
  isObject,
  normalizeString,
  normalizeProvenance,
  normalizeControlledValue
} from "./work-record-feature-vector-normalize.mjs";
import { WORK_UNIT_DEGRADATION_EFFECT_VALUES } from "./work-record-feature-vector-vocabulary.mjs";

function createDegradation({
  id,
  field_path,
  reason_code,
  reason,
  facet,
  provenance = "unavailable",
  effect = "requires_review"
}) {
  return {
    id,
    field_path,
    reason_code,
    reason,
    facet,
    provenance: normalizeProvenance(provenance),
    effect: normalizeControlledValue(effect, WORK_UNIT_DEGRADATION_EFFECT_VALUES) ?? "requires_review"
  };
}

function normalizeDegradationEntry(entry, index) {
  if (!isObject(entry)) {
    return createDegradation({
      id: `degradation-${index + 1}`,
      field_path: null,
      reason_code: "work_unit_feature_vector.degradation.invalid_entry.v1",
      reason: "degradation entries must be objects",
      facet: null,
      provenance: "unavailable",
      effect: "blocks_vector_construction"
    });
  }

  const fieldPath = normalizeString(entry.field_path ?? entry.fieldPath);
  const reasonCode = normalizeString(entry.reason_code ?? entry.reasonCode);
  const reason = normalizeString(entry.reason);
  const facet = normalizeString(entry.facet);
  const id = normalizeString(entry.id) ?? `degradation-${index + 1}`;

  return createDegradation({
    id,
    field_path: fieldPath,
    reason_code: reasonCode ?? "work_unit_feature_vector.degradation.unspecified.v1",
    reason: reason ?? "normalized degradation evidence",
    facet,
    provenance: entry.provenance,
    effect: entry.effect
  });
}

function normalizeWorkUnitDegradations(value = []) {
  return (Array.isArray(value) ? value : []).map((entry, index) => normalizeDegradationEntry(entry, index));
}

function appendUniqueDegradation(entries, degradation) {
  if (!degradation) {
    return entries;
  }

  const duplicate = entries.some(
    (entry) =>
      normalizeString(entry?.field_path) === normalizeString(degradation.field_path) &&
      normalizeString(entry?.reason_code) === normalizeString(degradation.reason_code)
  );
  if (duplicate) {
    return entries;
  }

  return [...entries, degradation];
}

const ACTIVITY_ARTIFACT_TARGET_REQUIRED_FACETS = Object.freeze([
  { field: "path", reason: "activity_artifact_targets entry is missing a path" },
  { field: "name", reason: "activity_artifact_targets entry is missing a name" },
  { field: "activity_kind", reason: "activity_artifact_targets entry is missing activity_kind" },
  { field: "artifact_kind", reason: "activity_artifact_targets entry is missing artifact_kind" },
  { field: "operation", reason: "activity_artifact_targets entry is missing operation" },
  { field: "granularity", reason: "activity_artifact_targets entry is missing granularity" }
]);

function collectActivityArtifactTargetDegradations(entry, index) {
  const entryPath = `activity_artifact_targets[${index}]`;
  return ACTIVITY_ARTIFACT_TARGET_REQUIRED_FACETS.filter(({ field }) => !entry[field]).map(({ field, reason }) =>
    createDegradation({
      id: `target-${index + 1}-missing-${field.replaceAll("_", "-")}`,
      field_path: `${entryPath}.${field}`,
      reason_code: `work_unit_feature_vector.activity_artifact_target_missing_${field}.v1`,
      reason,
      facet: "activity_artifact_targets",
      provenance: "unavailable",
      effect: "requires_review"
    })
  );
}

const SCENARIO_REQUIRED_FACETS = Object.freeze([
  {
    field: "id",
    field_path: "id",
    id_suffix: "missing-id",
    reason_code: "work_unit_feature_vector.scenario_missing_id.v1",
    reason: "scenario entry is missing id",
    effect: "blocks_vector_construction"
  },
  {
    field: "scenario_kind",
    field_path: "scenario_kind",
    id_suffix: "missing-kind",
    reason_code: "work_unit_feature_vector.scenario_missing_kind.v1",
    reason: "scenario entry is missing scenario_kind",
    effect: "requires_review"
  }
]);

function collectScenarioDegradations(entry, index) {
  const entryPath = `scenarios[${index}]`;
  return SCENARIO_REQUIRED_FACETS.filter(({ field }) => !entry[field]).map(
    ({ field_path, id_suffix, reason_code, reason, effect }) =>
      createDegradation({
        id: `scenario-${index + 1}-${id_suffix}`,
        field_path: `${entryPath}.${field_path}`,
        reason_code,
        reason,
        facet: "scenarios",
        provenance: "unavailable",
        effect
      })
  );
}

function collectAcceptanceMethodDegradations(entry, index) {
  const entryPath = `acceptance_methods[${index}]`;
  const issues = [];
  if (entry.verification_method === null) {
    issues.push(
      createDegradation({
        id: `acceptance-${index + 1}-missing-verification-method`,
        field_path: `${entryPath}.verification_method`,
        reason_code: "work_unit_feature_vector.acceptance_missing_verification_method.v1",
        reason: "acceptance criterion is missing verification_method",
        facet: "acceptance_methods",
        provenance: "unavailable",
        effect: "requires_review"
      })
    );
  }
  if (entry.evidence_target_resolution_status !== "resolved") {
    issues.push(
      createDegradation({
        id: `acceptance-${index + 1}-unanchored-evidence-target`,
        field_path: `${entryPath}.evidence_target`,
        reason_code: "work_unit_feature_vector.acceptance_unanchored_evidence_target.v1",
        reason:
          entry.evidence_target_resolution_status === "not_applicable"
            ? "acceptance criterion has no evidence target"
            : "acceptance criterion evidence target did not resolve",
        facet: "acceptance_methods",
        provenance: "derived_normalizer",
        effect: "requires_review"
      })
    );
  }
  return issues;
}

export {
  createDegradation,
  normalizeDegradationEntry,
  normalizeWorkUnitDegradations,
  appendUniqueDegradation,
  collectActivityArtifactTargetDegradations,
  collectScenarioDegradations,
  collectAcceptanceMethodDegradations
};
