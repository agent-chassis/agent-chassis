

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

export function normalizeWorkUnitAddress(value = {}, options = {}) {
  return normalizeRepoAddress(value, options);
}

export function normalizeActivityArtifactTargets(value = {}, options = {}) {
  const source = isObject(value) ? value : {};
  const selectedSlice = resolveSelectedSlice(source, options);
  return normalizeActivityArtifactTargetsFromSources(source, selectedSlice);
}

export function normalizeScenarios(value = {}, options = {}) {
  const source = isObject(value) ? value : {};
  const selectedSlice = resolveSelectedSlice(source, options);
  return normalizeScenariosFromSources(source, selectedSlice);
}

export function normalizeAcceptanceMethods(value = {}, options = {}) {
  const source = isObject(value) ? value : {};
  const selectedSlice = resolveSelectedSlice(source, options);
  const activityArtifactTargets = normalizeActivityArtifactTargetsFromSources(source, selectedSlice);
  const scenarios = normalizeScenariosFromSources(source, selectedSlice);
  return normalizeAcceptanceMethodsFromSources(source, selectedSlice, activityArtifactTargets, scenarios);
}

export function normalizeFeatureVectorDegradations(value = {}) {
  const source = isObject(value) ? value : {};
  return normalizeWorkUnitDegradations(source.degradations ?? source.feature_vector?.degradations ?? []);
}

export function deriveWorkUnitFeatureVectorMetrics(value = {}, options = {}) {
  const source = isObject(value) ? value : {};
  const selectedSlice = resolveSelectedSlice(source, options);
  const activityArtifactTargets = normalizeActivityArtifactTargetsFromSources(source, selectedSlice);
  const scenarios = normalizeScenariosFromSources(source, selectedSlice);
  const acceptanceMethods = normalizeAcceptanceMethodsFromSources(
    source,
    selectedSlice,
    activityArtifactTargets,
    scenarios
  );
  const degradations = normalizeWorkUnitDegradations(
    source.degradations ?? source.feature_vector?.degradations ?? []
  );

  return computeWorkUnitFeatureVectorMetrics({
    activity_artifact_targets: activityArtifactTargets,
    scenarios,
    acceptance_methods: acceptanceMethods,
    degradations
  });
}

export function normalizeWorkUnitFeatureVector(value = {}, options = {}) {
  const source = isObject(value) ? value : {};
  const sourceFeatureVector = isObject(source.feature_vector) ? source.feature_vector : {};
  const selectedSlice = resolveSelectedSlice(source, options);
  const activityArtifactTargets = normalizeActivityArtifactTargetsFromSources(source, selectedSlice);
  const scenarios = normalizeScenariosFromSources(source, selectedSlice);
  const acceptanceMethods = normalizeAcceptanceMethodsFromSources(
    source,
    selectedSlice,
    activityArtifactTargets,
    scenarios
  );
  let degradations = [
    ...normalizeWorkUnitDegradations(source.degradations ?? source.feature_vector?.degradations ?? []),
    ...activityArtifactTargets.flatMap((entry, index) => collectActivityArtifactTargetDegradations(entry, index)),
    ...scenarios.flatMap((entry, index) => collectScenarioDegradations(entry, index)),
    ...acceptanceMethods.flatMap((entry, index) => collectAcceptanceMethodDegradations(entry, index))
  ];
  const graphImpactSummary =
    normalizeGraphImpactSummary({
      graph_impact_summary:
        source.graph_impact_summary ??
        sourceFeatureVector.graph_impact_summary ??
        source.graphImpactSummary ??
        sourceFeatureVector.graphImpactSummary ??
        null,
      graph_impact:
        source.graph_impact ??
        sourceFeatureVector.graph_impact ??
        source.graphImpact ??
        sourceFeatureVector.graphImpact ??
        null,
      graph_evidence: source.graph_evidence ?? sourceFeatureVector.graph_evidence ?? null,
      summary: source.summary ?? sourceFeatureVector.summary ?? null,
      graphImpactSummaryRef:
        source.graphImpactSummaryRef ??
        sourceFeatureVector.graphImpactSummaryRef ??
        source.graph_impact_summary_ref ??
        sourceFeatureVector.graph_impact_summary_ref ??
        null
    }) ?? null;
  const graphImpactSummaryRefSource =
    source.graph_impact_summary_ref ??
    sourceFeatureVector.graph_impact_summary_ref ??
    source.graphImpactSummaryRef ??
    sourceFeatureVector.graphImpactSummaryRef ??
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
    schema_version: normalizeString(source.schema_version) ?? WORK_UNIT_FEATURE_VECTOR_SCHEMA_VERSION,
    vocabulary_version:
      normalizeString(source.vocabulary_version) ?? WORK_UNIT_FEATURE_VECTOR_VOCABULARY_VERSION,
    work_unit_address: normalizeRepoAddress(source.work_unit_address ?? source, {
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
    }),
    activity_artifact_targets: activityArtifactTargets,
    scenarios,
    acceptance_methods: acceptanceMethods,
    graph_evidence: normalizeGraphOrDiffEvidence(source.graph_evidence ?? sourceFeatureVector.graph_evidence),
    diff_evidence: normalizeGraphOrDiffEvidence(source.diff_evidence ?? sourceFeatureVector.diff_evidence),
    ...(graphImpactSummary ? { graph_impact_summary: graphImpactSummary } : {}),
    ...(graphImpactSummaryRef ? { graph_impact_summary_ref: graphImpactSummaryRef } : {}),
    derived_metrics: computeWorkUnitFeatureVectorMetrics({
      activity_artifact_targets: activityArtifactTargets,
      scenarios,
      acceptance_methods: acceptanceMethods,
      degradations
    }),
    escalations: normalizeEscalations(source.escalations ?? sourceFeatureVector.escalations ?? []),
    degradations
  };
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
