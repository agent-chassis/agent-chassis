

import {
  isObject,
  isNonEmptyString,
  normalizeString,
  createMetricEntry,
  countBy,
  countByPair,
  uniqueCount
} from "./work-record-feature-vector-normalize.mjs";

function computeWorkUnitFeatureVectorMetrics({
  activity_artifact_targets: activityArtifactTargets,
  scenarios,
  acceptance_methods: acceptanceMethods,
  degradations
}) {
  const targetList = Array.isArray(activityArtifactTargets) ? activityArtifactTargets : [];
  const scenarioList = Array.isArray(scenarios) ? scenarios : [];
  const acceptanceList = Array.isArray(acceptanceMethods) ? acceptanceMethods : [];
  const degradationList = Array.isArray(degradations) ? degradations : [];

  const resolvedAcceptanceMethods = acceptanceList.filter((entry) => isObject(entry));
  const targetPairs = targetList.filter((entry) => isObject(entry));
  const scenarioPairs = scenarioList.filter((entry) => isObject(entry));

  const activityKinds = countBy(targetPairs, (entry) => entry.activity_kind);
  const artifactKinds = countBy(targetPairs, (entry) => entry.artifact_kind);
  const operations = countBy(targetPairs, (entry) => entry.operation);
  const granularities = countBy(targetPairs, (entry) => entry.granularity ?? entry.kind);
  const activityArtifactPairs = countByPair(targetPairs, (entry) => entry.activity_kind, (entry) => entry.artifact_kind);
  const activityOperationPairs = countByPair(targetPairs, (entry) => entry.activity_kind, (entry) => entry.operation);
  const artifactOperationPairs = countByPair(targetPairs, (entry) => entry.artifact_kind, (entry) => entry.operation);
  const activityGranularityPairs = countByPair(targetPairs, (entry) => entry.activity_kind, (entry) => entry.granularity ?? entry.kind);

  const scenarioKinds = countBy(scenarioPairs, (entry) => entry.scenario_kind ?? entry.kind);
  const scenarioArtifacts = countBy(scenarioPairs, (entry) => entry.artifact_kind);
  const scenarioPairsByKindAndArtifact = countByPair(
    scenarioPairs,
    (entry) => entry.scenario_kind ?? entry.kind,
    (entry) => entry.artifact_kind
  );
  const acceptanceVerificationMethods = countBy(resolvedAcceptanceMethods, (entry) => entry.verification_method);
  const acceptanceResolutionStatus = countBy(
    resolvedAcceptanceMethods,
    (entry) => entry.evidence_target_resolution_status
  );
  const verificationResolutionPairs = countByPair(
    resolvedAcceptanceMethods,
    (entry) => entry.verification_method,
    (entry) => entry.evidence_target_resolution_status
  );
  const degradationEffects = countBy(degradationList, (entry) => entry.effect);
  const degradationFacets = countBy(degradationList, (entry) => entry.facet);

  const scenarioIdCounts = new Map();
  for (const scenario of scenarioPairs) {
    const id = normalizeString(scenario.id);
    if (!id) {
      continue;
    }
    scenarioIdCounts.set(id, (scenarioIdCounts.get(id) ?? 0) + 1);
  }

  const scenarioIdCollisionCount = [...scenarioIdCounts.values()].reduce(
    (sum, count) => sum + Math.max(0, count - 1),
    0
  );
  const operationalTestTargetCount = targetPairs.filter(
    (entry) => entry.artifact_kind === "operational_test"
  ).length;
  const operationalTestScenarioDensity =
    operationalTestTargetCount > 0 ? scenarioPairs.length / operationalTestTargetCount : null;
  const anchoredAcceptanceCriterionCount = resolvedAcceptanceMethods.filter(
    (entry) => entry.evidence_target_resolution_status === "resolved"
  ).length;
  const unanchoredAcceptanceCriterionCount = resolvedAcceptanceMethods.filter(
    (entry) => entry.evidence_target_resolution_status !== "resolved"
  ).length;

  return {
    activity_artifact_target_count: createMetricEntry(
      targetPairs.length,
      "derived_normalizer",
      "activity_artifact_targets[]"
    ),
    expected_edit_target_count: createMetricEntry(
      targetPairs.length,
      "derived_normalizer",
      "expected_edit_targets[]"
    ),
    activity_kind_distribution: createMetricEntry(activityKinds, "derived_normalizer", "activity_artifact_targets[].activity_kind"),
    activity_kind_diversity: createMetricEntry(uniqueCount(targetPairs, (entry) => entry.activity_kind), "derived_normalizer", "activity_artifact_targets[].activity_kind"),
    artifact_kind_distribution: createMetricEntry(artifactKinds, "derived_normalizer", "activity_artifact_targets[].artifact_kind"),
    artifact_kind_diversity: createMetricEntry(uniqueCount(targetPairs, (entry) => entry.artifact_kind), "derived_normalizer", "activity_artifact_targets[].artifact_kind"),
    operation_distribution: createMetricEntry(operations, "derived_normalizer", "activity_artifact_targets[].operation"),
    granularity_distribution: createMetricEntry(granularities, "derived_normalizer", "activity_artifact_targets[].granularity"),
    activity_artifact_cross_product_distribution: createMetricEntry(
      activityArtifactPairs,
      "derived_normalizer",
      "activity_artifact_targets[].activity_kind x activity_artifact_targets[].artifact_kind"
    ),
    activity_operation_cross_product_distribution: createMetricEntry(
      activityOperationPairs,
      "derived_normalizer",
      "activity_artifact_targets[].activity_kind x activity_artifact_targets[].operation"
    ),
    artifact_operation_cross_product_distribution: createMetricEntry(
      artifactOperationPairs,
      "derived_normalizer",
      "activity_artifact_targets[].artifact_kind x activity_artifact_targets[].operation"
    ),
    activity_granularity_cross_product_distribution: createMetricEntry(
      activityGranularityPairs,
      "derived_normalizer",
      "activity_artifact_targets[].activity_kind x activity_artifact_targets[].granularity"
    ),
    scenario_count: createMetricEntry(scenarioPairs.length, "derived_normalizer", "scenarios[]"),
    scenario_kind_distribution: createMetricEntry(scenarioKinds, "derived_normalizer", "scenarios[].scenario_kind"),
    scenario_kind_diversity: createMetricEntry(uniqueCount(scenarioPairs, (entry) => entry.scenario_kind ?? entry.kind), "derived_normalizer", "scenarios[].scenario_kind"),
    scenario_artifact_kind_distribution: createMetricEntry(scenarioArtifacts, "derived_normalizer", "scenarios[].artifact_kind"),
    scenario_artifact_kind_cross_product_distribution: createMetricEntry(
      scenarioPairsByKindAndArtifact,
      "derived_normalizer",
      "scenarios[].scenario_kind x scenarios[].artifact_kind"
    ),
    process_boundary_scenario_count: createMetricEntry(
      scenarioPairs.filter((entry) => entry.process_boundary === true || entry.scenario_kind === "process_boundary_crossing").length,
      "derived_normalizer",
      "scenarios[].process_boundary"
    ),
    refusal_scenario_count: createMetricEntry(
      scenarioPairs.filter((entry) => (entry.scenario_kind ?? entry.kind) === "refusal_case").length,
      "derived_normalizer",
      "scenarios[].scenario_kind"
    ),
    external_stub_scenario_count: createMetricEntry(
      scenarioPairs.filter(
        (entry) => (entry.scenario_kind ?? entry.kind) === "external_tool_stub" || isNonEmptyString(entry.uses_stub)
      ).length,
      "derived_normalizer",
      "scenarios[].scenario_kind"
    ),
    stateful_runtime_scenario_count: createMetricEntry(
      scenarioPairs.filter((entry) => (entry.scenario_kind ?? entry.kind) === "stateful_runtime_object").length,
      "derived_normalizer",
      "scenarios[].scenario_kind"
    ),
    scenario_id_collision_count: createMetricEntry(scenarioIdCollisionCount, "derived_normalizer", "scenarios[].id"),
    operational_test_scenario_density: createMetricEntry(
      operationalTestScenarioDensity,
      "derived_normalizer",
      "scenarios[] / activity_artifact_targets[].artifact_kind == operational_test"
    ),
    acceptance_criteria_count: createMetricEntry(acceptanceList.length, "derived_normalizer", "acceptance_methods[]"),
    acceptance_method_count: createMetricEntry(acceptanceList.length, "derived_normalizer", "acceptance_methods[]"),
    acceptance_verification_method_distribution: createMetricEntry(
      acceptanceVerificationMethods,
      "derived_normalizer",
      "acceptance_methods[].verification_method"
    ),
    acceptance_verification_method_diversity: createMetricEntry(
      uniqueCount(resolvedAcceptanceMethods, (entry) => entry.verification_method),
      "derived_normalizer",
      "acceptance_methods[].verification_method"
    ),
    acceptance_evidence_target_resolution_distribution: createMetricEntry(
      acceptanceResolutionStatus,
      "derived_normalizer",
      "acceptance_methods[].evidence_target_resolution_status"
    ),
    acceptance_verification_resolution_cross_product_distribution: createMetricEntry(
      verificationResolutionPairs,
      "derived_normalizer",
      "acceptance_methods[].verification_method x acceptance_methods[].evidence_target_resolution_status"
    ),
    anchored_acceptance_criterion_count: createMetricEntry(
      anchoredAcceptanceCriterionCount,
      "derived_normalizer",
      "acceptance_methods[].evidence_target_resolution_status"
    ),
    unanchored_acceptance_criterion_count: createMetricEntry(
      unanchoredAcceptanceCriterionCount,
      "derived_normalizer",
      "acceptance_methods[].evidence_target_resolution_status"
    ),
    degradation_count: createMetricEntry(degradationList.length, "derived_normalizer", "degradations[]"),
    degradation_effect_distribution: createMetricEntry(
      degradationEffects,
      "derived_normalizer",
      "degradations[].effect"
    ),
    degradation_facet_distribution: createMetricEntry(
      degradationFacets,
      "derived_normalizer",
      "degradations[].facet"
    )
  };
}

export { computeWorkUnitFeatureVectorMetrics };
