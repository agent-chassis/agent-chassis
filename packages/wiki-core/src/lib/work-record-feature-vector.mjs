

import { isObject, normalizeString } from "./work-record-feature-vector-normalize.mjs";
import {
  WORK_UNIT_FEATURE_VECTOR_SCHEMA_VERSION,
  WORK_UNIT_FEATURE_VECTOR_VOCABULARY_VERSION
} from "./work-record-feature-vector-vocabulary.mjs";
import {
  normalizeRepoAddress,
  parseWorkUnitAddressString,
  resolveSelectedSlice
} from "./work-record-feature-vector-address.mjs";
import {
  createDegradation,
  normalizeWorkUnitDegradations,
  appendUniqueDegradation,
  collectActivityArtifactTargetDegradations,
  collectScenarioDegradations,
  collectAcceptanceMethodDegradations
} from "./work-record-feature-vector-degradations.mjs";
import {
  normalizeActivityArtifactTargetsFromSources,
  normalizeScenariosFromSources,
  normalizeAcceptanceMethodsFromSources,
  normalizeEscalations
} from "./work-record-feature-vector-facets.mjs";
import {
  normalizeGraphImpactSummary,
  normalizeGraphImpactSummaryRef,
  normalizeGraphOrDiffEvidence
} from "./work-record-feature-vector-graph-impact.mjs";
import { computeWorkUnitFeatureVectorMetrics } from "./work-record-feature-vector-metrics.mjs";

const CANONICAL_WORK_RECORD_SCHEMA_VERSION = "work-record.v1";
const FEATURE_VECTOR_INPUT_KIND = "feature_vector";
const CANONICAL_WORK_RECORD_INPUT_KIND = "canonical_work_record";
const MAX_SOURCE_DIAGNOSTICS = 8;
const CANONICAL_SHADOW_FIELD_NAMES = Object.freeze([
  "activity_artifact_targets",
  "activityArtifactTargets",
  "acceptance_methods",
  "acceptanceMethods",
  "feature_vector",
  "featureVector"
]);

export const WORK_UNIT_FEATURE_VECTOR_SOURCE_ERROR_CODES = Object.freeze({
  INVALID_CANONICAL_RECORD: "work_unit_feature_vector.canonical_record.invalid_input.v1",
  CANONICAL_SHADOW_FIELDS: "work_unit_feature_vector.canonical_record.shadow_fields.v1",
  INVALID_EXPLICIT_VECTOR: "work_unit_feature_vector.explicit_vector.invalid_input.v1"
});

export class WorkRecordFeatureVectorSourceError extends Error {
  constructor(code, message, diagnostics = []) {
    super(message);
    this.name = "WorkRecordFeatureVectorSourceError";
    this.code = code;
    this.diagnostics = Object.freeze(
      (Array.isArray(diagnostics) ? diagnostics : [])
        .slice(0, MAX_SOURCE_DIAGNOSTICS)
        .map((diagnostic) => Object.freeze({ ...diagnostic }))
    );
  }
}

function assertExplicitFeatureVector(source) {
  if (
    !isObject(source) ||
    normalizeString(source.schema_version) !== WORK_UNIT_FEATURE_VECTOR_SCHEMA_VERSION
  ) {
    throw new WorkRecordFeatureVectorSourceError(
      WORK_UNIT_FEATURE_VECTOR_SOURCE_ERROR_CODES.INVALID_EXPLICIT_VECTOR,
      "explicit feature-vector normalization requires work-unit-feature-vector.v1",
      [
        {
          code: WORK_UNIT_FEATURE_VECTOR_SOURCE_ERROR_CODES.INVALID_EXPLICIT_VECTOR,
          message: "schema_version must be work-unit-feature-vector.v1",
          path: "feature_vector.schema_version"
        }
      ]
    );
  }
}

function collectCanonicalShadowFieldDiagnostics(record) {
  const diagnostics = [];
  const appendSourceDiagnostics = (source, pathPrefix) => {
    if (!isObject(source) || diagnostics.length >= MAX_SOURCE_DIAGNOSTICS) {
      return;
    }
    for (const fieldName of CANONICAL_SHADOW_FIELD_NAMES) {
      if (!Object.hasOwn(source, fieldName)) {
        continue;
      }
      diagnostics.push({
        code: WORK_UNIT_FEATURE_VECTOR_SOURCE_ERROR_CODES.CANONICAL_SHADOW_FIELDS,
        message: `${fieldName} is a generated feature-vector field and is not a canonical work-record input`,
        path: `${pathPrefix}.${fieldName}`
      });
      if (diagnostics.length >= MAX_SOURCE_DIAGNOSTICS) {
        return;
      }
    }
  };

  appendSourceDiagnostics(record, "record");
  for (const [index, slice] of (Array.isArray(record.slices) ? record.slices : []).entries()) {
    appendSourceDiagnostics(slice, `record.slices[${index}]`);
    if (diagnostics.length >= MAX_SOURCE_DIAGNOSTICS) {
      break;
    }
  }
  return diagnostics;
}

function assertCanonicalWorkRecord(record) {
  if (
    !isObject(record) ||
    normalizeString(record.schema_version) !== CANONICAL_WORK_RECORD_SCHEMA_VERSION
  ) {
    throw new WorkRecordFeatureVectorSourceError(
      WORK_UNIT_FEATURE_VECTOR_SOURCE_ERROR_CODES.INVALID_CANONICAL_RECORD,
      "canonical feature-vector construction requires work-record.v1",
      [
        {
          code: WORK_UNIT_FEATURE_VECTOR_SOURCE_ERROR_CODES.INVALID_CANONICAL_RECORD,
          message: "schema_version must be work-record.v1",
          path: "record.schema_version"
        }
      ]
    );
  }

  const shadowFieldDiagnostics = collectCanonicalShadowFieldDiagnostics(record);
  if (shadowFieldDiagnostics.length > 0) {
    throw new WorkRecordFeatureVectorSourceError(
      WORK_UNIT_FEATURE_VECTOR_SOURCE_ERROR_CODES.CANONICAL_SHADOW_FIELDS,
      "canonical work record contains generated feature-vector shadow fields",
      shadowFieldDiagnostics
    );
  }
}

export function normalizeWorkUnitAddress(value = {}, options = {}) {
  return normalizeRepoAddress(value, options);
}

export function normalizeActivityArtifactTargets(value = {}, options = {}) {
  const source = isObject(value) ? value : {};
  assertExplicitFeatureVector(source);
  return normalizeActivityArtifactTargetsFromSources(source, null, FEATURE_VECTOR_INPUT_KIND);
}

export function normalizeScenarios(value = {}, options = {}) {
  const source = isObject(value) ? value : {};

  const inputKind = normalizeString(source.schema_version) === WORK_UNIT_FEATURE_VECTOR_SCHEMA_VERSION
    ? FEATURE_VECTOR_INPUT_KIND
    : CANONICAL_WORK_RECORD_INPUT_KIND;
  const selectedSlice = inputKind === CANONICAL_WORK_RECORD_INPUT_KIND
    ? resolveSelectedSlice(source, options)
    : null;
  return normalizeScenariosFromSources(source, selectedSlice, inputKind);
}

export function normalizeAcceptanceMethods(value = {}, options = {}) {
  const source = isObject(value) ? value : {};
  assertExplicitFeatureVector(source);
  const activityArtifactTargets = normalizeActivityArtifactTargetsFromSources(source, null, FEATURE_VECTOR_INPUT_KIND);
  const scenarios = normalizeScenariosFromSources(source, null, FEATURE_VECTOR_INPUT_KIND);
  return normalizeAcceptanceMethodsFromSources(
    source,
    null,
    activityArtifactTargets,
    scenarios,
    FEATURE_VECTOR_INPUT_KIND
  );
}

export function normalizeFeatureVectorDegradations(value = {}) {
  const source = isObject(value) ? value : {};
  assertExplicitFeatureVector(source);
  return normalizeWorkUnitDegradations(source.degradations ?? []);
}

export function deriveWorkUnitFeatureVectorMetrics(value = {}, options = {}) {
  const source = isObject(value) ? value : {};
  assertExplicitFeatureVector(source);
  const activityArtifactTargets = normalizeActivityArtifactTargetsFromSources(source, null, FEATURE_VECTOR_INPUT_KIND);
  const scenarios = normalizeScenariosFromSources(source, null, FEATURE_VECTOR_INPUT_KIND);
  const acceptanceMethods = normalizeAcceptanceMethodsFromSources(
    source,
    null,
    activityArtifactTargets,
    scenarios,
    FEATURE_VECTOR_INPUT_KIND
  );
  const degradations = normalizeWorkUnitDegradations(
    source.degradations ?? []
  );

  return computeWorkUnitFeatureVectorMetrics({
    activity_artifact_targets: activityArtifactTargets,
    scenarios,
    acceptance_methods: acceptanceMethods,
    degradations
  });
}

function buildWorkUnitFeatureVector(source, options, inputKind) {
  const selectedSlice = inputKind === CANONICAL_WORK_RECORD_INPUT_KIND
    ? resolveSelectedSlice(source, options)
    : null;
  const activityArtifactTargets = normalizeActivityArtifactTargetsFromSources(
    source,
    selectedSlice,
    inputKind
  );
  const scenarios = normalizeScenariosFromSources(source, selectedSlice, inputKind);
  const acceptanceMethods = normalizeAcceptanceMethodsFromSources(
    source,
    selectedSlice,
    activityArtifactTargets,
    scenarios,
    inputKind
  );
  let degradations = [
    ...normalizeWorkUnitDegradations(source.degradations ?? []),
    ...activityArtifactTargets.flatMap((entry, index) => collectActivityArtifactTargetDegradations(entry, index)),
    ...scenarios.flatMap((entry, index) => collectScenarioDegradations(entry, index)),
    ...acceptanceMethods.flatMap((entry, index) => collectAcceptanceMethodDegradations(entry, index))
  ];
  const graphImpactSummary =
    normalizeGraphImpactSummary({
      graph_impact_summary:
        source.graph_impact_summary ??
        source.graphImpactSummary ??
        null,
      graph_impact:
        source.graph_impact ??
        source.graphImpact ??
        null,
      graph_evidence: source.graph_evidence ?? null,
      summary: source.summary ?? null,
      graphImpactSummaryRef:
        source.graphImpactSummaryRef ??
        source.graph_impact_summary_ref ??
        null
    }) ?? null;
  const graphImpactSummaryRefSource =
    source.graph_impact_summary_ref ??
    source.graphImpactSummaryRef ??
    null;
  const graphImpactSummaryRef =
    normalizeGraphImpactSummaryRef(
      isObject(graphImpactSummaryRefSource)
        ? {
            ...graphImpactSummaryRefSource,
            summary: graphImpactSummaryRefSource.summary ?? graphImpactSummary ?? null
          }
        : null
    ) ?? null;

  const graphImpactDegradedStateKind = normalizeString(
    graphImpactSummary?.graph_quality?.degraded_state?.kind
  );
  if (graphImpactDegradedStateKind && graphImpactDegradedStateKind !== "healthy") {
    degradations = appendUniqueDegradation(
      degradations,
      createDegradation({
        id: `graph-impact-summary-${graphImpactDegradedStateKind}`,
        field_path: "graph_impact_summary.graph_quality.degraded_state",
        reason_code: "work_unit_feature_vector.graph_impact_summary.degraded_state.v1",
        reason:
          normalizeString(graphImpactSummary.graph_quality.degraded_state.message) ??
          "graph-impact summary reports degraded quality",
        facet: "graph_impact_summary",
        provenance: "derived_code_graph",
        effect: "requires_review"
      })
    );
  }

  return {
    schema_version: WORK_UNIT_FEATURE_VECTOR_SCHEMA_VERSION,
    vocabulary_version: inputKind === CANONICAL_WORK_RECORD_INPUT_KIND
      ? WORK_UNIT_FEATURE_VECTOR_VOCABULARY_VERSION
      : normalizeString(source.vocabulary_version) ?? WORK_UNIT_FEATURE_VECTOR_VOCABULARY_VERSION,
    work_unit_address: normalizeRepoAddress(
      inputKind === CANONICAL_WORK_RECORD_INPUT_KIND ? source : source.work_unit_address ?? source,
      {
        ...options,
        repo: options.repo ?? source.repo ?? source.repository,
        recordId:
          options.recordId ??
          source.record_id ??
          source.recordId ??
          parseWorkUnitAddressString(source.id)?.record_id ??
          source.id,
        sliceId:
          options.sliceId ??
          options.selectedSliceId ??
          source.slice_id ??
          source.sliceId ??
          normalizeString(selectedSlice?.id) ??
          parseWorkUnitAddressString(source.id)?.slice_id
      }
    ),
    activity_artifact_targets: activityArtifactTargets,
    scenarios,
    acceptance_methods: acceptanceMethods,
    graph_evidence: normalizeGraphOrDiffEvidence(source.graph_evidence),
    diff_evidence: normalizeGraphOrDiffEvidence(source.diff_evidence),
    ...(graphImpactSummary ? { graph_impact_summary: graphImpactSummary } : {}),
    ...(graphImpactSummaryRef ? { graph_impact_summary_ref: graphImpactSummaryRef } : {}),
    derived_metrics: computeWorkUnitFeatureVectorMetrics({
      activity_artifact_targets: activityArtifactTargets,
      scenarios,
      acceptance_methods: acceptanceMethods,
      degradations
    }),
    escalations: normalizeEscalations(source.escalations ?? []),
    degradations
  };
}

export function normalizeWorkUnitFeatureVector(value = {}, options = {}) {
  const source = isObject(value) ? value : {};
  assertExplicitFeatureVector(source);
  return buildWorkUnitFeatureVector(source, options, FEATURE_VECTOR_INPUT_KIND);
}

export function createWorkUnitFeatureVectorFromCanonicalRecord(record = {}, options = {}) {
  const source = isObject(record) ? record : {};
  assertCanonicalWorkRecord(source);
  return buildWorkUnitFeatureVector(source, options, CANONICAL_WORK_RECORD_INPUT_KIND);
}

export {
  WORK_UNIT_FEATURE_VECTOR_SCHEMA_VERSION,
  WORK_UNIT_FEATURE_VECTOR_VOCABULARY_VERSION,
  WORK_UNIT_ACTIVITY_KIND_VALUES,
  WORK_UNIT_ARTIFACT_KIND_VALUES,
  WORK_UNIT_OPERATION_VALUES,
  WORK_UNIT_GRANULARITY_VALUES,
  WORK_UNIT_SCENARIO_KIND_VALUES,
  WORK_UNIT_VERIFICATION_METHOD_VALUES,
  WORK_UNIT_DEGRADATION_EFFECT_VALUES,
  WORK_UNIT_PROVENANCE_VALUES
} from "./work-record-feature-vector-vocabulary.mjs";
