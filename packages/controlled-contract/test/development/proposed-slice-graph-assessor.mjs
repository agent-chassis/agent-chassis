import Ajv2020 from "ajv/dist/2020.js";

import {
  ANONYMOUS_PLANNING_INPUT_SCHEMA,
  POLICY_VERSION as COARSENING_POLICY_VERSION,
  planAnonymousStructuralCoarsening,
  validateAnonymousPlanningInputReferences
} from "../../lib/anonymous-structural-partitioner.mjs";

const ASSESSOR_VERSION = "controlled-contract-proposed-slice-assessor.experimental.v0.1";
const PROPOSAL_VERSION = "controlled-contract-proposed-slice-graph.experimental.v0.1";
const ASSESSMENT_POLICY_VERSION =
  "controlled-contract-proposed-slice-assessment-policy.experimental.v0.1";
const RESOURCE_SIGNALS = new Set([
  "write_write_overlap",
  "dependency_aligned_write_read"
]);

const opaqueId = { type: "string", minLength: 1 };

const PROPOSED_SLICE_GRAPH_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  required: ["plan_version", "units", "dependencies"],
  additionalProperties: false,
  properties: {
    plan_version: { type: "string", enum: [PROPOSAL_VERSION] },
    units: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["unit_id", "member_component_ids"],
        additionalProperties: false,
        properties: {
          unit_id: opaqueId,
          member_component_ids: {
            type: "array",
            minItems: 1,
            uniqueItems: true,
            items: opaqueId
          }
        }
      }
    },
    dependencies: {
      type: "array",
      items: {
        type: "object",
        required: ["prerequisite_unit_id", "dependent_unit_id"],
        additionalProperties: false,
        properties: {
          prerequisite_unit_id: opaqueId,
          dependent_unit_id: opaqueId
        }
      }
    }
  }
};

const PROPOSED_SLICE_ASSESSMENT_POLICY_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  required: [
    "policy_version",
    "target_unit_weight",
    "max_unit_weight",
    "resource_incidence_status",
    "anonymous_comparison"
  ],
  additionalProperties: false,
  properties: {
    policy_version: { type: "string", enum: [ASSESSMENT_POLICY_VERSION] },
    target_unit_weight: { type: "integer", minimum: 1 },
    max_unit_weight: { type: "integer", minimum: 1 },
    resource_incidence_status: {
      type: "string",
      enum: ["complete", "partial", "unavailable"]
    },
    anonymous_comparison: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          required: ["merge_signal_priority"],
          additionalProperties: false,
          properties: {
            merge_signal_priority: {
              type: "array",
              minItems: 1,
              uniqueItems: true,
              items: {
                type: "string",
                enum: [
                  "write_write_overlap",
                  "dependency_aligned_write_read",
                  "dependency_adjacency"
                ]
              }
            }
          }
        }
      ]
    }
  }
};

const ajv = new Ajv2020({ strict: true, allErrors: true });
const validateInput = ajv.compile(ANONYMOUS_PLANNING_INPUT_SCHEMA);
const validateProposal = ajv.compile(PROPOSED_SLICE_GRAPH_SCHEMA);
const validatePolicy = ajv.compile(PROPOSED_SLICE_ASSESSMENT_POLICY_SCHEMA);

function compareIds(left, right) {
  const leftString = String(left);
  const rightString = String(right);
  if (leftString < rightString) return -1;
  if (leftString > rightString) return 1;
  return 0;
}

function pairKey(left, right) {
  return [left, right].sort(compareIds).join("\u0000");
}

function directedKey(source, target) {
  return `${source}\u0000${target}`;
}

function duplicateValues(entries, key) {
  const seen = new Set();
  const duplicates = new Set();
  for (const entry of entries) {
    const value = entry[key];
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort(compareIds);
}

function duplicateDependencies(dependencies, sourceKey, targetKey) {
  const seen = new Set();
  const duplicates = new Set();
  for (const dependency of dependencies) {
    const key = directedKey(dependency[sourceKey], dependency[targetKey]);
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  return [...duplicates].sort(compareIds).map((key) => {
    const [source, target] = key.split("\u0000");
    return { source, target };
  });
}

function topology(ids, dependencies, sourceKey, targetKey) {
  const outgoing = new Map(ids.map((id) => [id, new Set()]));
  const incoming = new Map(ids.map((id) => [id, new Set()]));
  for (const dependency of dependencies) {
    const source = dependency[sourceKey];
    const target = dependency[targetKey];
    if (!outgoing.has(source) || !outgoing.has(target)) continue;
    outgoing.get(source).add(target);
    incoming.get(target).add(source);
  }
  const ready = ids.filter((id) => incoming.get(id).size === 0).sort(compareIds);
  const remainingIncoming = new Map(
    ids.map((id) => [id, new Set(incoming.get(id))])
  );
  const ordered = [];
  const layers = [];
  let frontier = ready;
  while (frontier.length > 0) {
    layers.push(frontier);
    const next = new Set();
    for (const id of frontier) {
      ordered.push(id);
      for (const target of outgoing.get(id)) {
        remainingIncoming.get(target).delete(id);
        if (remainingIncoming.get(target).size === 0) next.add(target);
      }
    }
    frontier = [...next].sort(compareIds);
  }
  const orderedSet = new Set(ordered);
  return {
    outgoing,
    incoming,
    ordered,
    layers: ordered.length === ids.length ? layers : null,
    cyclic_ids: ids.filter((id) => !orderedSet.has(id)).sort(compareIds)
  };
}

function reachability(ids, outgoing) {
  const result = new Map();
  for (const start of ids) {
    const reached = new Set();
    const pending = [...outgoing.get(start)];
    while (pending.length > 0) {
      const current = pending.pop();
      if (reached.has(current)) continue;
      reached.add(current);
      pending.push(...outgoing.get(current));
    }
    result.set(start, reached);
  }
  return result;
}

function criticalPathWeight(ids, graph, weightById) {
  if (graph.cyclic_ids.length > 0) return null;
  const ranks = new Map(ids.map((id) => [id, weightById.get(id)]));
  for (const id of [...graph.ordered].reverse()) {
    ranks.set(
      id,
      weightById.get(id) + Math.max(
        0,
        ...[...graph.outgoing.get(id)].map((target) => ranks.get(target))
      )
    );
  }
  return Math.max(0, ...ranks.values());
}

function inducedCriticalPathWeight(memberIds, inputTopology, weightByComponent) {
  const members = new Set(memberIds);
  const ranks = new Map();
  for (const componentId of [...inputTopology.ordered].reverse()) {
    if (!members.has(componentId)) continue;
    const successors = [...inputTopology.outgoing.get(componentId)]
      .filter((target) => members.has(target))
      .map((target) => ranks.get(target));
    ranks.set(
      componentId,
      weightByComponent.get(componentId) + Math.max(0, ...successors)
    );
  }
  return Math.max(0, ...ranks.values());
}

function accessMaps(input) {
  const reads = new Map(input.components.map(({ component_id }) => [component_id, new Set()]));
  const writes = new Map(input.components.map(({ component_id }) => [component_id, new Set()]));
  for (const access of input.accesses) {
    (access.mode === "read" ? reads : writes)
      .get(access.component_id)
      .add(access.resource_id);
  }
  return { reads, writes };
}

function intersects(left, right) {
  for (const value of left) if (right.has(value)) return true;
  return false;
}

function supportGroups(memberIds, inputTopology, inputReachability, accesses) {
  const adjacent = new Map(memberIds.map((id) => [id, new Set()]));
  for (let leftIndex = 0; leftIndex < memberIds.length; leftIndex += 1) {
    const left = memberIds[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < memberIds.length; rightIndex += 1) {
      const right = memberIds[rightIndex];
      const direct = inputTopology.outgoing.get(left).has(right) ||
        inputTopology.outgoing.get(right).has(left);
      const writeWrite = intersects(accesses.writes.get(left), accesses.writes.get(right));
      const alignedWriteRead =
        (inputReachability.get(left).has(right) &&
          intersects(accesses.writes.get(left), accesses.reads.get(right))) ||
        (inputReachability.get(right).has(left) &&
          intersects(accesses.writes.get(right), accesses.reads.get(left)));
      if (!direct && !writeWrite && !alignedWriteRead) continue;
      adjacent.get(left).add(right);
      adjacent.get(right).add(left);
    }
  }
  const groups = [];
  const seen = new Set();
  for (const start of memberIds) {
    if (seen.has(start)) continue;
    const group = [];
    const pending = [start];
    while (pending.length > 0) {
      const current = pending.pop();
      if (seen.has(current)) continue;
      seen.add(current);
      group.push(current);
      pending.push(...adjacent.get(current));
    }
    groups.push(group.sort(compareIds));
  }
  return groups.sort((left, right) => compareIds(left.join("\u0000"), right.join("\u0000")));
}

function alternatePathExists(source, target, graph, omittedKey) {
  const seen = new Set();
  const pending = [source];
  while (pending.length > 0) {
    const current = pending.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    for (const next of graph.outgoing.get(current)) {
      if (directedKey(current, next) === omittedKey) continue;
      if (next === target) return true;
      pending.push(next);
    }
  }
  return false;
}

function orderedSequenceViolations(input, unitByComponent) {
  return input.collections
    .filter(({ collection_kind }) => collection_kind === "ordered_sequence")
    .flatMap((sequence) => {
      const indexesByUnit = new Map();
      sequence.member_component_ids.forEach((componentId, index) => {
        const unitId = unitByComponent.get(componentId);
        if (!unitId) return;
        const indexes = indexesByUnit.get(unitId) ?? [];
        indexes.push(index);
        indexesByUnit.set(unitId, indexes);
      });
      return [...indexesByUnit].flatMap(([unitId, indexes]) => {
        if (indexes.length < 2) return [];
        const first = Math.min(...indexes);
        const last = Math.max(...indexes);
        if (last - first + 1 === indexes.length) return [];
        return [{
          collection_id: sequence.collection_id,
          unit_id: unitId,
          included_member_indexes: indexes
        }];
      });
    });
}

function togetherPairs(units) {
  const pairs = new Set();
  for (const unit of units) {
    for (let left = 0; left < unit.member_component_ids.length; left += 1) {
      for (let right = left + 1; right < unit.member_component_ids.length; right += 1) {
        pairs.add(pairKey(
          unit.member_component_ids[left],
          unit.member_component_ids[right]
        ));
      }
    }
  }
  return pairs;
}

function sortedPairObjects(keys) {
  return [...keys].sort(compareIds).map((key) => {
    const [left_component_id, right_component_id] = key.split("\u0000");
    return { left_component_id, right_component_id };
  });
}

function baseResult(overrides) {
  return {
    assessor_version: ASSESSOR_VERSION,
    authority: { kind: "advisory_local", authoritative: false },
    input_valid: null,
    proposal_valid: null,
    policy_valid: null,
    contract_consistency: "invalid",
    execution_profile_fit: "not_evaluated",
    assessment_completeness: "partial",
    anonymous_comparison: "not_run",
    schema_errors: [],
    facts: null,
    diagnostics: [],
    ...overrides
  };
}

function assessProposedSliceGraph(input, proposal, policy) {
  if (!validateInput(input)) return baseResult({
    input_valid: false,
    schema_errors: structuredClone(validateInput.errors),
    diagnostics: [{ code: "anonymous_planning_input_schema_invalid" }]
  });
  if (!validateProposal(proposal)) return baseResult({
    input_valid: true,
    proposal_valid: false,
    schema_errors: structuredClone(validateProposal.errors),
    diagnostics: [{ code: "proposed_slice_graph_schema_invalid" }]
  });
  if (!validatePolicy(policy)) return baseResult({
    input_valid: true,
    proposal_valid: true,
    policy_valid: false,
    schema_errors: structuredClone(validatePolicy.errors),
    diagnostics: [{ code: "proposed_slice_assessment_policy_schema_invalid" }]
  });
  if (policy.target_unit_weight > policy.max_unit_weight) return baseResult({
    input_valid: true,
    proposal_valid: true,
    policy_valid: false,
    diagnostics: [{ code: "target_unit_weight_exceeds_max_unit_weight" }]
  });

  const diagnostics = [];
  const componentIds = input.components.map(({ component_id }) => component_id).sort(compareIds);
  const componentIdSet = new Set(componentIds);
  const unitIds = proposal.units.map(({ unit_id }) => unit_id).sort(compareIds);
  const unitIdSet = new Set(unitIds);
  for (const unitId of duplicateValues(proposal.units, "unit_id")) {
    diagnostics.push({ code: "duplicate_proposed_unit_id", unit_id: unitId });
  }
  for (const duplicate of duplicateDependencies(
    proposal.dependencies,
    "prerequisite_unit_id",
    "dependent_unit_id"
  )) diagnostics.push({ code: "duplicate_proposed_dependency", ...duplicate });

  const assignmentCounts = new Map(componentIds.map((id) => [id, 0]));
  for (const unit of proposal.units) {
    for (const componentId of unit.member_component_ids) {
      if (!componentIdSet.has(componentId)) {
        diagnostics.push({
          code: "unknown_proposed_component",
          unit_id: unit.unit_id,
          component_id: componentId
        });
        continue;
      }
      assignmentCounts.set(componentId, assignmentCounts.get(componentId) + 1);
    }
  }
  for (const [componentId, count] of assignmentCounts) {
    if (count === 0) diagnostics.push({
      code: "component_unassigned",
      component_id: componentId
    });
    if (count > 1) diagnostics.push({
      code: "component_assigned_multiple_times",
      component_id: componentId,
      assignment_count: count
    });
  }
  for (const dependency of proposal.dependencies) {
    const source = dependency.prerequisite_unit_id;
    const target = dependency.dependent_unit_id;
    if (!unitIdSet.has(source) || !unitIdSet.has(target)) diagnostics.push({
      code: "proposed_dependency_unit_unknown",
      prerequisite_unit_id: source,
      dependent_unit_id: target
    });
    if (source === target) diagnostics.push({
      code: "proposed_dependency_self_edge",
      unit_id: source
    });
  }
  const inputReferenceDiagnostics = validateAnonymousPlanningInputReferences(input);
  if (inputReferenceDiagnostics.length > 0) return baseResult({
    input_valid: false,
    proposal_valid: true,
    policy_valid: true,
    diagnostics: inputReferenceDiagnostics
  });

  const fatalCodes = new Set([
    "duplicate_proposed_unit_id",
    "duplicate_proposed_dependency",
    "unknown_proposed_component",
    "component_unassigned",
    "component_assigned_multiple_times",
    "proposed_dependency_unit_unknown",
    "proposed_dependency_self_edge"
  ]);
  if (diagnostics.some(({ code }) => fatalCodes.has(code))) return baseResult({
    input_valid: true,
    proposal_valid: false,
    policy_valid: true,
    diagnostics
  });

  const inputTopology = topology(
    componentIds,
    input.dependencies,
    "prerequisite_component_id",
    "dependent_component_id"
  );
  if (inputTopology.cyclic_ids.length > 0) return baseResult({
    input_valid: false,
    proposal_valid: true,
    policy_valid: true,
    diagnostics: [{
      code: "anonymous_dependency_cycle",
      component_ids: inputTopology.cyclic_ids
    }]
  });

  const proposedTopology = topology(
    unitIds,
    proposal.dependencies,
    "prerequisite_unit_id",
    "dependent_unit_id"
  );
  if (proposedTopology.cyclic_ids.length > 0) diagnostics.push({
    code: "proposed_dependency_cycle",
    unit_ids: proposedTopology.cyclic_ids
  });

  const unitByComponent = new Map();
  for (const unit of proposal.units) {
    for (const componentId of unit.member_component_ids) {
      unitByComponent.set(componentId, unit.unit_id);
    }
  }
  const requiredArcsByKey = new Map();
  let internalizedDependencyCount = 0;
  for (const dependency of input.dependencies) {
    const sourceUnit = unitByComponent.get(dependency.prerequisite_component_id);
    const targetUnit = unitByComponent.get(dependency.dependent_component_id);
    if (sourceUnit === targetUnit) {
      internalizedDependencyCount += 1;
      continue;
    }
    const key = directedKey(sourceUnit, targetUnit);
    const entry = requiredArcsByKey.get(key) ?? {
      prerequisite_unit_id: sourceUnit,
      dependent_unit_id: targetUnit,
      source_dependency_count: 0
    };
    entry.source_dependency_count += 1;
    requiredArcsByKey.set(key, entry);
  }
  const requiredArcs = [...requiredArcsByKey.values()].sort((left, right) =>
    compareIds(
      directedKey(left.prerequisite_unit_id, left.dependent_unit_id),
      directedKey(right.prerequisite_unit_id, right.dependent_unit_id)
    )
  );
  const requiredTopology = topology(
    unitIds,
    requiredArcs,
    "prerequisite_unit_id",
    "dependent_unit_id"
  );
  if (requiredTopology.cyclic_ids.length > 0) diagnostics.push({
    code: "proposed_partition_induces_dependency_cycle",
    unit_ids: requiredTopology.cyclic_ids
  });
  const requiredReachability = reachability(unitIds, requiredTopology.outgoing);
  const proposedReachability = proposedTopology.cyclic_ids.length === 0
    ? reachability(unitIds, proposedTopology.outgoing)
    : new Map(unitIds.map((id) => [id, new Set()]));

  const missingRequiredArcs = [];
  const reversedRequiredArcs = [];
  for (const arc of requiredArcs) {
    const source = arc.prerequisite_unit_id;
    const target = arc.dependent_unit_id;
    if (proposedReachability.get(source).has(target)) continue;
    if (proposedReachability.get(target).has(source)) {
      reversedRequiredArcs.push(arc);
      diagnostics.push({ code: "required_dependency_order_reversed", ...arc });
    } else {
      missingRequiredArcs.push(arc);
      diagnostics.push({ code: "required_dependency_order_missing", ...arc });
    }
  }

  const unexplainedSerializationPairs = [];
  if (proposedTopology.cyclic_ids.length === 0) {
    for (const source of unitIds) {
      for (const target of proposedReachability.get(source)) {
        if (requiredReachability.get(source).has(target)) continue;
        const pair = {
          prerequisite_unit_id: source,
          dependent_unit_id: target
        };
        unexplainedSerializationPairs.push(pair);
        diagnostics.push({ code: "unexplained_serialization", ...pair });
      }
    }
  }
  unexplainedSerializationPairs.sort((left, right) => compareIds(
    directedKey(left.prerequisite_unit_id, left.dependent_unit_id),
    directedKey(right.prerequisite_unit_id, right.dependent_unit_id)
  ));

  const redundantDependencies = proposal.dependencies.filter((dependency) =>
    alternatePathExists(
      dependency.prerequisite_unit_id,
      dependency.dependent_unit_id,
      proposedTopology,
      directedKey(dependency.prerequisite_unit_id, dependency.dependent_unit_id)
    )
  );
  diagnostics.push(...redundantDependencies.map((dependency) => ({
    code: "redundant_proposed_dependency",
    ...dependency
  })));

  const sequenceViolations = orderedSequenceViolations(input, unitByComponent);
  diagnostics.push(...sequenceViolations.map((violation) => ({
    code: "ordered_sequence_violated",
    ...violation
  })));

  const weightByComponent = new Map(
    input.components.map(({ component_id, weight }) => [component_id, weight])
  );
  const inputReachability = reachability(componentIds, inputTopology.outgoing);
  const accesses = accessMaps(input);
  const unitFacts = proposal.units.map((unit) => {
    const memberIds = [...unit.member_component_ids].sort(compareIds);
    const weight = memberIds.reduce(
      (sum, componentId) => sum + weightByComponent.get(componentId),
      0
    );
    const internalDependencies = input.dependencies.filter((dependency) =>
      unitByComponent.get(dependency.prerequisite_component_id) === unit.unit_id &&
      unitByComponent.get(dependency.dependent_component_id) === unit.unit_id
    );
    const inducedCriticalPath = inducedCriticalPathWeight(
      memberIds,
      inputTopology,
      weightByComponent
    );
    const groups = supportGroups(memberIds, inputTopology, inputReachability, accesses);
    return {
      unit_id: unit.unit_id,
      member_component_ids: memberIds,
      component_count: memberIds.length,
      weight,
      above_target_weight: weight > policy.target_unit_weight,
      exceeds_max_weight: weight > policy.max_unit_weight,
      internalized_dependency_count: internalDependencies.length,
      induced_component_critical_path_weight: inducedCriticalPath,
      internal_serialization_loss: weight - inducedCriticalPath,
      structural_support_group_count: groups.length,
      structural_support_groups: groups
    };
  }).sort((left, right) => compareIds(left.unit_id, right.unit_id));

  for (const unit of unitFacts) {
    if (unit.exceeds_max_weight) diagnostics.push({
      code: "unit_exceeds_maximum_weight",
      unit_id: unit.unit_id,
      weight: unit.weight,
      max_unit_weight: policy.max_unit_weight
    });
    if (unit.structural_support_group_count > 1) diagnostics.push({
      code: "unit_members_structurally_disconnected",
      unit_id: unit.unit_id,
      structural_support_groups: unit.structural_support_groups,
      resource_incidence_status: policy.resource_incidence_status
    });
  }

  const usesResourceComparison = policy.anonymous_comparison?.merge_signal_priority
    .some((signal) => RESOURCE_SIGNALS.has(signal)) ?? false;
  if (policy.resource_incidence_status !== "complete") diagnostics.push({
    code: "resource_incidence_incomplete",
    status: policy.resource_incidence_status,
    affects_anonymous_comparison: usesResourceComparison
  });

  const unitWeights = new Map(unitFacts.map(({ unit_id, weight }) => [unit_id, weight]));
  const inputCriticalPath = criticalPathWeight(componentIds, inputTopology, weightByComponent);
  const requiredCriticalPath = criticalPathWeight(unitIds, requiredTopology, unitWeights);
  const proposedCriticalPath = criticalPathWeight(unitIds, proposedTopology, unitWeights);

  let comparisonStatus = "not_run";
  let comparisonFacts = null;
  if (policy.anonymous_comparison) {
    const coarsening = planAnonymousStructuralCoarsening(input, {
      policy_version: COARSENING_POLICY_VERSION,
      target_unit_weight: policy.target_unit_weight,
      max_unit_weight: policy.max_unit_weight,
      merge_signal_priority: policy.anonymous_comparison.merge_signal_priority
    });
    if (coarsening.input_valid && coarsening.policy_valid) {
      const proposedPairs = togetherPairs(proposal.units);
      const comparisonPairs = togetherPairs(coarsening.facts.final_units);
      const shared = new Set([...proposedPairs].filter((pair) => comparisonPairs.has(pair)));
      const proposalOnly = new Set(
        [...proposedPairs].filter((pair) => !comparisonPairs.has(pair))
      );
      const comparisonOnly = new Set(
        [...comparisonPairs].filter((pair) => !proposedPairs.has(pair))
      );
      comparisonStatus = proposalOnly.size === 0 && comparisonOnly.size === 0
        ? "identical"
        : "different";
      comparisonFacts = {
        status: comparisonStatus,
        proposed_same_unit_pair_count: proposedPairs.size,
        comparison_same_unit_pair_count: comparisonPairs.size,
        shared_same_unit_pair_count: shared.size,
        proposal_only_same_unit_pairs: sortedPairObjects(proposalOnly),
        comparison_only_same_unit_pairs: sortedPairObjects(comparisonOnly),
        comparison_units: coarsening.facts.final_units,
        comparison_quotient_dependency_arcs: coarsening.facts.quotient_dependency_arcs,
        comparison_critical_path_serialization_cost:
          coarsening.facts.critical_path_serialization_cost
      };
      if (comparisonStatus === "different") diagnostics.push({
        code: "anonymous_partition_differs",
        proposal_only_same_unit_pair_count: proposalOnly.size,
        comparison_only_same_unit_pair_count: comparisonOnly.size
      });
    } else {
      comparisonStatus = "unavailable";
      diagnostics.push({
        code: "anonymous_comparison_unavailable",
        comparison_diagnostics: coarsening.diagnostics
      });
    }
  }

  const inconsistencyCodes = new Set([
    "proposed_dependency_cycle",
    "proposed_partition_induces_dependency_cycle",
    "required_dependency_order_missing",
    "required_dependency_order_reversed",
    "ordered_sequence_violated"
  ]);
  const inconsistent = diagnostics.some(({ code }) => inconsistencyCodes.has(code));
  const profileExceeds = unitFacts.some(({ exceeds_max_weight }) => exceeds_max_weight);
  const totalWeight = unitFacts.reduce((sum, unit) => sum + unit.weight, 0);
  const meanWeight = totalWeight / unitFacts.length;

  return {
    assessor_version: ASSESSOR_VERSION,
    authority: { kind: "advisory_local", authoritative: false },
    input_valid: true,
    proposal_valid: true,
    policy_valid: true,
    contract_consistency: inconsistent ? "inconsistent" : "consistent",
    execution_profile_fit: profileExceeds ? "exceeds" : "fits",
    assessment_completeness:
      policy.resource_incidence_status === "complete" ? "complete" : "partial",
    anonymous_comparison: comparisonStatus,
    schema_errors: [],
    facts: {
      input_component_count: componentIds.length,
      proposed_unit_count: proposal.units.length,
      proposed_dependency_count: proposal.dependencies.length,
      total_component_weight: totalWeight,
      target_unit_weight: policy.target_unit_weight,
      max_unit_weight: policy.max_unit_weight,
      resource_incidence_status: policy.resource_incidence_status,
      unit_weight_balance: {
        minimum: Math.min(...unitFacts.map(({ weight }) => weight)),
        maximum: Math.max(...unitFacts.map(({ weight }) => weight)),
        mean: meanWeight,
        maximum_absolute_deviation: Math.max(
          ...unitFacts.map(({ weight }) => Math.abs(weight - meanWeight))
        )
      },
      units: unitFacts,
      internalized_dependency_count: internalizedDependencyCount,
      required_unit_dependency_arcs: requiredArcs,
      missing_required_dependency_arcs: missingRequiredArcs,
      reversed_required_dependency_arcs: reversedRequiredArcs,
      unexplained_serialization_pairs: unexplainedSerializationPairs,
      redundant_proposed_dependencies: redundantDependencies,
      ordered_sequence_violations: sequenceViolations,
      input_critical_path_weight: inputCriticalPath,
      required_quotient_critical_path_weight: requiredCriticalPath,
      proposed_critical_path_weight: proposedCriticalPath,
      proposed_critical_path_serialization_cost:
        proposedCriticalPath === null ? null : proposedCriticalPath - inputCriticalPath,
      internal_serialization_loss_sum: unitFacts.reduce(
        (sum, unit) => sum + unit.internal_serialization_loss,
        0
      ),
      proposed_topological_layers: proposedTopology.layers,
      proposed_maximum_parallel_frontier: proposedTopology.layers === null
        ? null
        : Math.max(0, ...proposedTopology.layers.map((layer) => layer.length)),
      anonymous_comparison: comparisonFacts
    },
    diagnostics
  };
}

export {
  ASSESSMENT_POLICY_VERSION,
  ASSESSOR_VERSION,
  PROPOSAL_VERSION,
  PROPOSED_SLICE_ASSESSMENT_POLICY_SCHEMA,
  PROPOSED_SLICE_GRAPH_SCHEMA,
  assessProposedSliceGraph
};
