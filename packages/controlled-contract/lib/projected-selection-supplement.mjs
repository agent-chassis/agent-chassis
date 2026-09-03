import { readFile } from "node:fs/promises";

import { compiledValidators } from "./compiled-validator-cache.mjs";

import {
  assertTrustedProjectedSelection
} from "./projected-evaluation-binding.mjs";
import {
  GRAPH_VERSION,
  normalizeGraphNode
} from "./projected-contract-graph.mjs";
import {
  canonicalJsonBytes,
  canonicalValue,
  commitment,
  compareCodeUnits,
  domainSeparatedDigest
} from "./proof-aware-digest.mjs";
import { DOMAINS } from "./projected-selection-constants.mjs";
import {
  buildPlanningPackCycle,
  buildProofAwareInputCycle,
  buildSupplementCensus,
  createAssessmentPackCycle,
  validateAssessmentPackCycle
} from "./projected-selection-cycle.mjs";
import {
  hasTrustedAssessmentPackCycle,
  hasTrustedProjectedSelectionSupplement,
  registerProjectedSelectionSupplement
} from "./projected-selection-trust.mjs";

const SUPPLEMENT_VERSION =
  "controlled-contract-projected-selection-supplement.experimental.v1";
const SUPPLEMENT_REVISION = "unit1-lossless-correction.design-freeze.v3";
const DIGEST_ALGORITHM = "sha256-domain-separated-canonical-json-v1";
const CANONICAL_ORDER = "utf16-code-unit-by-declared-composite-key-v1";
const LIMITS = Object.freeze({
  canonical_input_bytes: Object.freeze({ limit: 64 * 1024 * 1024,
    count_point: "verified_canonical_supplement_inputs_before_normalization",
    blocked_stage: "input_validation" }),
  canonical_output_bytes: Object.freeze({ limit: 64 * 1024 * 1024,
    count_point: "complete_canonical_success_before_release",
    blocked_stage: "serialization" }),
  projected_nodes: Object.freeze({ limit: 200000,
    count_point: "normalized_first_class_projected_node_population",
    blocked_stage: "projection" }),
  projected_incidences: Object.freeze({ limit: 1000000,
    count_point: "normalized_typed_projected_incidence_population",
    blocked_stage: "projection" }),
  projected_incidence_participants: Object.freeze({ limit: 1000000,
    count_point: "normalized_participant_occurrences_across_projected_incidences",
    blocked_stage: "projection" }),
  pattern_selections: Object.freeze({ limit: 200000,
    count_point: "normalized_evaluator_pattern_instance_population",
    blocked_stage: "selection" }),
  selected_nodes: Object.freeze({ limit: 1000000,
    count_point: "selected_node_occurrences_across_patterns_and_universal_occurrences",
    blocked_stage: "selection" }),
  universal_iterations: Object.freeze({ limit: 200000,
    count_point: "reconciled_for_each_begin_end_pairs",
    blocked_stage: "universal_expansion" }),
  universal_member_occurrences: Object.freeze({ limit: 1000000,
    count_point: "reconciled_standalone_member_occurrence_population",
    blocked_stage: "universal_expansion" }),
  association_selections: Object.freeze({ limit: 1000000,
    count_point: "reconciled_association_declaration_member_selections",
    blocked_stage: "association_expansion" }),
  association_members: Object.freeze({ limit: 1000000,
    count_point: "associated_node_occurrences_across_association_selections",
    blocked_stage: "association_expansion" })
});
const AUTHORITY = Object.freeze({
  kind: "lossless_assessment_supplement_not_runtime_evidence",
  authoritative: false,
  mandatory_exclusions: Object.freeze({
    proof_applicability: false,
    optimality: false,
    correct_ownership: false,
    runtime_truth: false,
    evidence_authority: false,
    cce_consequences: false,
    readiness: false,
    status_transition_authority: false,
    dispatch_authority: false,
    mutation_or_publication_permission: false
  })
});
const supplementSchema = JSON.parse(await readFile(new URL(
  "./projected-selection-supplement.experimental.v1.schema.json", import.meta.url
), "utf8"));
const { validateSupplementSchema } = await compiledValidators(
  "controlled-contract.projected-selection-supplement.v1",
  { validators: { validateSupplementSchema: supplementSchema } }
);

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function frozenClone(value) {
  return deepFreeze(structuredClone(value));
}

function base(status) {
  return {
    supplement_version: SUPPLEMENT_VERSION,
    supplement_schema_revision: SUPPLEMENT_REVISION,
    status,
    digest_algorithm: DIGEST_ALGORITHM,
    canonical_order: CANONICAL_ORDER,
    authority: structuredClone(AUTHORITY)
  };
}

function diagnostic(code, classification, subjectDigests = []) {
  return {
    code,
    classification,
    subject_digests: [...new Set(subjectDigests)].sort(compareCodeUnits)
  };
}

function availableCommitments(cycle) {
  const mapping = [
    ["contract", "contract"], ["compiled_proof_plan", "compiled_proof_plan"],
    ["assessment_manifest", "assessment_manifest"],
    ["per_pack_assessment", "per_pack_assessment"], ["pack", "pack_identity"],
    ["profile", "profile_identity"], ["guarantee", "guarantee_identity"],
    ["admission", "admission_identity"], ["evaluation_input", "evaluation_input"],
    ["exact_binding_declaration", "exact_binding_declaration"],
    ["exact_binding_result", "exact_binding_result"],
    ["exact_capture_source_set", "exact_capture_source_set"],
    ["projected_graph", "projected_graph"]
  ];
  const entries = mapping.flatMap(([artifactKind, field]) => {
    const value = cycle?.cycle_binding?.[field];
    return value?.digest ? [{ artifact_kind: artifactKind, digest: value.digest }] : [];
  });
  if (cycle?.cycle_binding?.binding_set_digest) entries.push({
    artifact_kind: "binding_set",
    digest: cycle.cycle_binding.binding_set_digest
  });
  return entries.sort((left, right) => compareCodeUnits(
    left.artifact_kind, right.artifact_kind
  ));
}

function failure(cycle, status, code, blockedStage, classification, detail = {}) {
  const value = {
    ...base(status),
    observed_binding: {
      validation_stage: blockedStage,
      expected_assessment_pack_cycle_digest: cycle?.digest ?? null,
      available_commitments: availableCommitments(cycle)
    },
    refusal: { code, blocked_stage: blockedStage, ...detail },
    diagnostics: [diagnostic(code, classification,
      availableCommitments(cycle).map(({ digest }) => digest))]
  };
  return frozenClone(value);
}

function resourceFailure(cycle, unit, measured) {
  const policy = LIMITS[unit];
  return failure(cycle, "resource_limit", "PS_RESOURCE_LIMIT",
    policy.blocked_stage, "resource_limit", {
      unit,
      measured,
      limit: policy.limit,
      count_point: policy.count_point,
      partial_result_released: false
    });
}

function unsupportedFailure(cycle, blockedStage = "input_validation") {
  return failure(cycle, "unsupported_input", "PS_UNSUPPORTED_INPUT",
    blockedStage, "unsupported_input");
}

function firstResourceBreach(metrics) {
  for (const unit of Object.keys(LIMITS)) {
    if (metrics[unit] > LIMITS[unit].limit) return { unit, measured: metrics[unit] };
  }
  return null;
}

function sameCanonical(left, right) {
  return JSON.stringify(canonicalValue(left)) === JSON.stringify(canonicalValue(right));
}

function rawNodeIdentity(population, node) {
  const fields = {
    claims: "claim_id", collections: "collection_id", propositions: "proposition_id",
    references: "reference_id", relations: "relation_id"
  };
  return node[fields[population]];
}

function singular(population) {
  return population.slice(0, -1);
}

function semanticPayload(population, node) {
  if (population === "references") return {
    payload_kind: "reference",
    type_term: node.type_term,
    identity: structuredClone(node.identity)
  };
  if (population === "propositions") return {
    payload_kind: "proposition", operator: node.operator
  };
  if (population === "claims") return {
    payload_kind: "claim",
    modality: node.modality,
    verification_method: node.kind === "verification" ? node.verification_method : null
  };
  if (population === "relations") return {
    payload_kind: "relation", relation_role: node.role
  };
  return {
    payload_kind: "collection",
    collection_kind: node.collection_kind,
    purpose: node.purpose ?? null
  };
}

function normalizedProjectedGraph(graph) {
  return canonicalValue({
    schema_version: GRAPH_VERSION,
    ...Object.fromEntries([
      "claims", "collections", "propositions", "references", "relations"
    ].map((population) => [population, graph[population].map((node) =>
      normalizeGraphNode(population, node)
    ).sort((left, right) => compareCodeUnits(
      rawNodeIdentity(population, left), rawNodeIdentity(population, right)
    ))]))
  });
}

function projectedNodes(graph) {
  return ["claims", "collections", "propositions", "references", "relations"]
    .flatMap((population) => graph[population].map((node) => {
      const nodeKind = singular(population);
      const normalized = normalizeGraphNode(population, node);
      return {
        projected_node_id: rawNodeIdentity(population, node),
        node_kind: nodeKind,
        claim_kind: population === "claims" ? node.kind : null,
        source_contract_node_digest: domainSeparatedDigest(DOMAINS.sourceNode, {
          node_kind: nodeKind,
          source_node: normalized
        }),
        semantic_payload: semanticPayload(population, normalized)
      };
    }))
    .sort((left, right) => compareCodeUnits(
      left.projected_node_id, right.projected_node_id
    ));
}

function operandValue(operand) {
  if (operand.kind === "reference") return {
    reference_projected_node_id: operand.reference_id,
    literal_value: null
  };
  if (operand.kind === "range") return {
    reference_projected_node_id: null,
    literal_value: {
      minimum: operand.minimum ?? null,
      maximum: operand.maximum ?? null
    }
  };
  return { reference_projected_node_id: null, literal_value: operand.value };
}

function projectedIncidences(graph) {
  const incidences = [];
  for (const proposition of graph.propositions) {
    incidences.push({
      incidence_kind: "proposition_structure",
      proposition_projected_node_id: proposition.proposition_id,
      subject: {
        subject_position: 0,
        subject_role: "subject",
        reference_projected_node_id: proposition.subject_reference_id
      },
      operands: proposition.operands.map((operand, operandPosition) => ({
        operand_position: operandPosition,
        operand_role: "operand",
        operand_kind: operand.kind,
        ...operandValue(operand)
      }))
    });
    incidences.push({
      incidence_kind: "applicability_structure",
      proposition_projected_node_id: proposition.proposition_id,
      applicability_mode: proposition.applicability_context.mode,
      operands: proposition.applicability_context.operand_reference_ids.map(
        (referenceId, applicabilityPosition) => ({
          applicability_position: applicabilityPosition,
          applicability_role: "applicability_operand",
          reference_projected_node_id: referenceId
        })
      )
    });
  }
  for (const claim of graph.claims) incidences.push({
    incidence_kind: "claim_proposition_ownership",
    claim_projected_node_id: claim.claim_id,
    claim_kind: claim.kind,
    proposition_projected_node_id: claim.proposition_id,
    falsifying_proposition_projected_node_id:
      claim.kind === "verification" ? claim.falsifying_proposition_id : null
  });
  for (const relation of graph.relations) incidences.push({
    incidence_kind: "relation_endpoints",
    relation_projected_node_id: relation.relation_id,
    endpoints: [
      { endpoint_position: 0, endpoint_role: "source",
        claim_projected_node_id: relation.source_claim_id },
      { endpoint_position: 1, endpoint_role: "target",
        claim_projected_node_id: relation.target_claim_id }
    ]
  });
  for (const collection of graph.collections) incidences.push({
    incidence_kind: "collection_membership",
    collection_projected_node_id: collection.collection_id,
    ordered: collection.collection_kind === "ordered_sequence",
    members: collection.member_claim_ids.map((claimId, memberPosition) => ({
      member_position: memberPosition,
      member_role: "member",
      claim_projected_node_id: claimId
    }))
  });
  return incidences.sort((left, right) => compareCodeUnits(
    JSON.stringify(canonicalValue(left)), JSON.stringify(canonicalValue(right))
  ));
}

function participantCount(incidences) {
  return incidences.reduce((count, incidence) => {
    if (incidence.incidence_kind === "proposition_structure") {
      return count + 1 + incidence.operands.length;
    }
    if (incidence.incidence_kind === "applicability_structure") {
      return count + incidence.operands.length;
    }
    if (incidence.incidence_kind === "claim_proposition_ownership") {
      return count + (incidence.falsifying_proposition_projected_node_id === null ? 1 : 2);
    }
    if (incidence.incidence_kind === "relation_endpoints") return count + 2;
    return count + incidence.members.length;
  }, 0);
}

function nodeIndex(nodes) {
  return new Map(nodes.map((node) => [node.projected_node_id, node]));
}

function selectedNode(identifier, position, nodes) {
  const node = nodes.get(identifier);
  if (!node) throw new Error(`selected node ${identifier} is absent from projected graph`);
  return {
    selection_position: position,
    projected_node_id: identifier,
    node_kind: node.node_kind,
    claim_kind: node.claim_kind,
    selection_role: selectionRoleFor(node)
  };
}

function selectionRoleFor(node) {
  return node.node_kind === "claim"
    ? (node.claim_kind === "verification" ? "verification"
      : node.claim_kind === "evidence" ? "evidence" : "claim")
    : node.node_kind;
}

function normalizeSelections(selection, nodes, profileDigest) {
  const patterns = selection.pattern_selections.map((pattern) => ({
    pattern_instance_id: pattern.pattern_instance_id,
    pattern_kind: pattern.pattern_kind,
    evaluation_status: pattern.evaluation_status,
    selection_status: pattern.selection_status,
    branch_paths: structuredClone(pattern.branch_paths),
    selected_nodes: pattern.selected_node_ids.map((id, position) =>
      selectedNode(id, position, nodes))
  })).sort((left, right) => compareCodeUnits(
    left.pattern_instance_id, right.pattern_instance_id
  ));
  const iterations = selection.universal_iterations.map((iteration) => {
    const memberIds = iteration.member_projected_node_ids;
    const bindingDigest = domainSeparatedDigest(DOMAINS.populationBinding, {
      pattern_instance_id: iteration.pattern_instance_id,
      population_role: iteration.population_role,
      population_reference_projected_node_id:
        iteration.population_reference_projected_node_id,
      member_projected_node_ids: memberIds
    });
    const completeIdentity = domainSeparatedDigest(DOMAINS.completePopulationBinding, {
      profile_identity_digest: profileDigest,
      resolution_status: iteration.complete_population_status,
      pattern_instance_id: iteration.complete_population_pattern_instance_id,
      population_role: iteration.population_role
    });
    const completeResult = domainSeparatedDigest(DOMAINS.completePopulationResult,
      iteration.complete_population_result);
    return {
      iteration_position: iteration.iteration_position,
      pattern_instance_id: iteration.pattern_instance_id,
      pattern_kind: "claim",
      population_binding: {
        population_role: iteration.population_role,
        population_reference_projected_node_id:
          iteration.population_reference_projected_node_id,
        binding_digest: bindingDigest,
        reference_count: memberIds.length
      },
      complete_population_binding: {
        status: iteration.complete_population_status,
        binding_identity_digest: completeIdentity,
        pattern_instance_id: iteration.complete_population_pattern_instance_id,
        result_status: iteration.complete_population_result.status,
        result_digest: completeResult
      },
      member_role: iteration.member_role,
      member_positions: structuredClone(iteration.member_positions),
      branch_paths: structuredClone(iteration.branch_paths),
      iteration_quantifier: iteration.iteration_quantifier,
      empty_behavior: iteration.empty_behavior,
      vacuous: iteration.vacuous,
      member_count: iteration.occurrences.length,
      occurrences: iteration.occurrences.map((occurrence) => {
        const member = nodes.get(occurrence.member_projected_node_id);
        if (member?.node_kind !== "reference") throw new Error(
          "universal occurrence member is not a projected reference"
        );
        return {
          member_occurrence_position: occurrence.member_occurrence_position,
          member_projected_node_id: occurrence.member_projected_node_id,
          member_node_kind: "reference",
          member_role: occurrence.member_role,
          member_positions: structuredClone(occurrence.member_positions),
          selection_status: occurrence.selection_status,
          selected_nodes: occurrence.selected_node_ids.map((id, position) =>
            selectedNode(id, position, nodes))
        };
      })
    };
  });
  const associations = selection.association_selections.map((association) => ({
    pattern_instance_id: association.pattern_instance_id,
    universal_iteration_position: association.universal_iteration_position,
    member_occurrence_position: association.member_occurrence_position,
    association_position: association.association_position,
    member_role: association.member_role,
    member_position: association.member_position,
    associated_role: association.associated_role,
    associated_position: association.associated_position,
    association_status: association.association_status,
    associated_nodes: association.associated_node_ids.map((id, position) => {
      const selected = selectedNode(id, position, nodes);
      return {
        associated_node_position: position,
        projected_node_id: selected.projected_node_id,
        node_kind: selected.node_kind,
        claim_kind: selected.claim_kind
      };
    }),
    cardinality: association.cardinality
  }));
  return { patterns, iterations, associations };
}

function buildProjectedSelectionSupplement({ cycle, projectedEvaluation,
  verifiedInputBytes }) {
  if (!hasTrustedAssessmentPackCycle(cycle)) return failure(
    cycle, "refused", "PS_SAME_CYCLE_MISMATCH", "input_validation",
    "hard_invalidity"
  );
  const requiredCommitments = [
    "contract", "compiled_proof_plan", "assessment_manifest",
    "per_pack_assessment", "pack_identity", "profile_identity",
    "guarantee_identity", "admission_identity", "evaluation_input",
    "exact_binding_declaration", "exact_binding_result",
    "exact_capture_source_set", "projected_graph"
  ];
  if (typeof cycle.cycle_binding.assessment_identity !== "string" ||
      !/^[a-f0-9]{64}$/u.test(cycle.cycle_binding.binding_set_digest ?? "") ||
      requiredCommitments.some((field) =>
        cycle.cycle_binding[field] === null ||
        !/^[a-f0-9]{64}$/u.test(cycle.cycle_binding[field]?.digest ?? "")
      )) return failure(cycle, "missing_lossless_fact",
    cycle.cycle_binding.projected_graph === null
      ? "PS_MISSING_PROJECTED_GRAPH" : "PS_MISSING_SELECTED_NODE_TRACE",
    cycle.cycle_binding.projected_graph === null ? "projection" : "selection",
    "missing_lossless_fact");
  let selection;
  try {
    selection = assertTrustedProjectedSelection(projectedEvaluation);
  } catch {
    return failure(cycle, "missing_lossless_fact",
      "PS_MISSING_SELECTED_NODE_TRACE", "selection", "missing_lossless_fact");
  }
  const inputBytes = verifiedInputBytes === undefined ? canonicalJsonBytes({
    cycle_binding: cycle.cycle_binding,
    projected_graph_digest: cycle.cycle_binding.projected_graph.digest,
    selection
  }).byteLength : verifiedInputBytes;
  if (!Number.isSafeInteger(inputBytes) || inputBytes < 0) {
    return unsupportedFailure(cycle);
  }
  if (inputBytes > LIMITS.canonical_input_bytes.limit) {
    return resourceFailure(cycle, "canonical_input_bytes", inputBytes);
  }
  try {
    const normalizedGraph = normalizedProjectedGraph(selection.graph);
    const nodes = projectedNodes(normalizedGraph);
    const incidences = projectedIncidences(normalizedGraph);
    const indexedNodes = nodeIndex(nodes);
    const normalized = normalizeSelections(
      selection, indexedNodes, cycle.cycle_binding.profile_identity.digest
    );
    const counts = {
      verified_input_bytes: inputBytes,
      successful_output_bytes: 0,
      projected_nodes: nodes.length,
      projected_incidences: incidences.length,
      projected_incidence_participants: participantCount(incidences),
      pattern_selections: normalized.patterns.length,
      selected_nodes: normalized.patterns.reduce((sum, entry) =>
        sum + entry.selected_nodes.length, 0) +
        normalized.iterations.reduce((sum, iteration) => sum +
          iteration.occurrences.reduce((inner, occurrence) =>
            inner + occurrence.selected_nodes.length, 0), 0),
      universal_iterations: normalized.iterations.length,
      universal_member_occurrences: normalized.iterations.reduce((sum, entry) =>
        sum + entry.occurrences.length, 0),
      association_selections: normalized.associations.length,
      association_members: normalized.associations.reduce((sum, entry) =>
        sum + entry.associated_nodes.length, 0)
    };
    const breach = firstResourceBreach({
      canonical_input_bytes: inputBytes,
      canonical_output_bytes: 0,
      ...counts
    });
    if (breach) return resourceFailure(cycle, breach.unit, breach.measured);
    const graphDigest = domainSeparatedDigest(DOMAINS.graph, normalizedGraph);
    if (cycle.cycle_binding.projected_graph.digest !== graphDigest) return failure(
      cycle, "refused", "PS_DIGEST_MISMATCH", "projection", "hard_invalidity"
    );
    const value = {
      ...base("success"),
      cycle_binding: structuredClone(cycle.cycle_binding),
      supplement_identity: {
        domain: DOMAINS.supplement,
        digest: "0".repeat(64),
        payload_rule:
          "digest_complete_success_value_with_supplement_identity.digest_omitted"
      },
      trace_authority: {
        source: "evaluator_owned_in_memory_trace",
        caller_supplied_trace_authoritative: false,
        bounded_assessment_reconstruction_used: false,
        complete_evaluator_trace_reconciled: true
      },
      validation_status: "validated_complete",
      counts,
      projected_graph: {
        graph_digest: graphDigest,
        node_count: nodes.length,
        incidence_count: incidences.length,
        incidence_participant_count: counts.projected_incidence_participants,
        nodes,
        incidences
      },
      pattern_selections: normalized.patterns,
      universal_iterations: normalized.iterations,
      association_selections: normalized.associations,
      diagnostics: []
    };
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const identityPayload = structuredClone(value);
      delete identityPayload.supplement_identity.digest;
      value.supplement_identity.digest = domainSeparatedDigest(
        DOMAINS.supplement, identityPayload
      );
      const bytes = canonicalJsonBytes(value).byteLength;
      if (bytes > LIMITS.canonical_output_bytes.limit) {
        return resourceFailure(cycle, "canonical_output_bytes", bytes);
      }
      if (counts.successful_output_bytes === bytes) break;
      counts.successful_output_bytes = bytes;
    }
    if (canonicalJsonBytes(value).byteLength !== counts.successful_output_bytes) {
      return failure(cycle, "refused", "PS_VALIDATION_FAILED", "serialization",
        "hard_invalidity");
    }
    const semantic = supplementSemanticDiagnostics(value);
    if (!validateSupplementSchema(value) || semantic.length > 0) return failure(
      cycle, "refused", "PS_VALIDATION_FAILED", "serialization", "hard_invalidity"
    );
    const result = frozenClone(value);
    registerProjectedSelectionSupplement(result);
    return result;
  } catch {
    return failure(cycle, "refused", "PS_INCIDENCE_LOSSLESSNESS_FAILED",
      "projection", "hard_invalidity");
  }
}

function projectedSelectionCommitments(projectedEvaluation) {
  const selection = assertTrustedProjectedSelection(projectedEvaluation);
  const graph = normalizedProjectedGraph(selection.graph);
  return frozenClone({
    projected_graph: commitment(DOMAINS.graph, graph),
    selected_node_result: commitment(
      "controlled-contract:selected-node-result:v1", {
        pattern_selections: selection.pattern_selections,
        universal_iterations: selection.universal_iterations,
        association_selections: selection.association_selections
      }
    )
  });
}

function contiguous(values) {
  return values.every((value, index) => value === index);
}

function canonicallySorted(values, key = (value) => JSON.stringify(canonicalValue(value))) {
  return values.every((value, index) => index === 0 ||
    compareCodeUnits(key(values[index - 1]), key(value)) < 0);
}

function incidenceOwner(incidences, kind, ownerField, ownerId) {
  return incidences.find((incidence) => incidence.incidence_kind === kind &&
    incidence[ownerField] === ownerId);
}

function reconstructedOperand(operand) {
  if (operand.operand_kind === "reference") return {
    kind: "reference", reference_id: operand.reference_projected_node_id
  };
  if (operand.operand_kind === "range") {
    const value = { kind: "range" };
    if (operand.literal_value.minimum !== null) {
      value.minimum = operand.literal_value.minimum;
    }
    if (operand.literal_value.maximum !== null) {
      value.maximum = operand.literal_value.maximum;
    }
    return value;
  }
  return { kind: operand.operand_kind, value: operand.literal_value };
}

function reconstructNode(node, incidences) {
  const id = node.projected_node_id;
  const payload = node.semantic_payload;
  if (node.node_kind === "reference") return {
    reference_id: id,
    type_term: payload.type_term,
    identity: structuredClone(payload.identity)
  };
  if (node.node_kind === "proposition") {
    const structure = incidenceOwner(
      incidences, "proposition_structure", "proposition_projected_node_id", id
    );
    const applicability = incidenceOwner(
      incidences, "applicability_structure", "proposition_projected_node_id", id
    );
    if (!structure || !applicability) return null;
    return {
      proposition_id: id,
      subject_reference_id: structure.subject.reference_projected_node_id,
      operator: payload.operator,
      applicability_context: {
        mode: applicability.applicability_mode,
        operand_reference_ids: applicability.operands.map(
          ({ reference_projected_node_id: referenceId }) => referenceId
        )
      },
      operands: structure.operands.map(reconstructedOperand)
    };
  }
  if (node.node_kind === "claim") {
    const ownership = incidenceOwner(
      incidences, "claim_proposition_ownership", "claim_projected_node_id", id
    );
    if (!ownership) return null;
    const result = {
      claim_id: id,
      kind: node.claim_kind,
      modality: payload.modality,
      proposition_id: ownership.proposition_projected_node_id
    };
    if (node.claim_kind === "verification") {
      result.verification_method = payload.verification_method;
      result.falsifying_proposition_id =
        ownership.falsifying_proposition_projected_node_id;
    }
    return result;
  }
  if (node.node_kind === "relation") {
    const endpoints = incidenceOwner(
      incidences, "relation_endpoints", "relation_projected_node_id", id
    );
    if (!endpoints) return null;
    return {
      relation_id: id,
      role: payload.relation_role,
      source_claim_id: endpoints.endpoints[0].claim_projected_node_id,
      target_claim_id: endpoints.endpoints[1].claim_projected_node_id
    };
  }
  const membership = incidenceOwner(
    incidences, "collection_membership", "collection_projected_node_id", id
  );
  if (!membership) return null;
  const result = {
    collection_id: id,
    collection_kind: payload.collection_kind,
    member_claim_ids: membership.members.map(
      ({ claim_projected_node_id: claimId }) => claimId
    )
  };
  if (payload.purpose !== null) result.purpose = payload.purpose;
  return result;
}

function reconstructedGraph(nodes, incidences) {
  const graph = {
    schema_version: GRAPH_VERSION,
    claims: [], collections: [], propositions: [], references: [], relations: []
  };
  for (const node of nodes) {
    const reconstructed = reconstructNode(node, incidences);
    if (reconstructed === null) return null;
    graph[`${node.node_kind}s`].push(reconstructed);
  }
  for (const population of [
    "claims", "collections", "propositions", "references", "relations"
  ]) graph[population].sort((left, right) => compareCodeUnits(
    rawNodeIdentity(population, left), rawNodeIdentity(population, right)
  ));
  return graph;
}

function participantKindDiagnostics(incidence, nodeById) {
  const diagnostics = [];
  const requireKind = (id, kind) => {
    if (nodeById.get(id)?.node_kind !== kind) diagnostics.push({
      code: "incidence_participant_kind_invalid"
    });
  };
  if (incidence.incidence_kind === "proposition_structure") {
    requireKind(incidence.subject.reference_projected_node_id, "reference");
    for (const operand of incidence.operands) if (
      operand.reference_projected_node_id !== null
    ) requireKind(operand.reference_projected_node_id, "reference");
  } else if (incidence.incidence_kind === "applicability_structure") {
    for (const operand of incidence.operands) {
      requireKind(operand.reference_projected_node_id, "reference");
    }
  } else if (incidence.incidence_kind === "claim_proposition_ownership") {
    requireKind(incidence.proposition_projected_node_id, "proposition");
    if (incidence.falsifying_proposition_projected_node_id !== null) {
      requireKind(incidence.falsifying_proposition_projected_node_id, "proposition");
    }
  } else if (incidence.incidence_kind === "relation_endpoints") {
    for (const endpoint of incidence.endpoints) {
      requireKind(endpoint.claim_projected_node_id, "claim");
    }
  } else {
    for (const member of incidence.members) {
      requireKind(member.claim_projected_node_id, "claim");
    }
  }
  return diagnostics;
}

function supplementSemanticDiagnostics(value) {
  if (!validateSupplementSchema(value)) return [{ code: "schema_invalid" }];
  if (value.status !== "success") return [];
  const diagnostics = [];
  const identityPayload = structuredClone(value);
  const observedIdentity = identityPayload.supplement_identity.digest;
  delete identityPayload.supplement_identity.digest;
  if (domainSeparatedDigest(DOMAINS.supplement, identityPayload) !== observedIdentity) {
    diagnostics.push({ code: "supplement_identity_mismatch" });
  }
  if (canonicalJsonBytes(value).byteLength !== value.counts.successful_output_bytes) {
    diagnostics.push({ code: "successful_output_bytes_mismatch" });
  }
  const graph = value.projected_graph;
  const ids = graph.nodes.map(({ projected_node_id: id }) => id);
  const nodeById = new Map(graph.nodes.map((node) => [node.projected_node_id, node]));
  if (new Set(ids).size !== ids.length || !ids.every(
    (id, index) => index === 0 || compareCodeUnits(ids[index - 1], id) < 0
  )) diagnostics.push({ code: "node_identity_or_order_invalid" });
  if (!canonicallySorted(graph.incidences)) diagnostics.push({
    code: "incidence_order_invalid"
  });
  const count = (field, actual) => {
    if (value.counts[field] !== actual) diagnostics.push({ code: `${field}_count_mismatch` });
  };
  count("projected_nodes", graph.nodes.length);
  count("projected_incidences", graph.incidences.length);
  count("projected_incidence_participants", participantCount(graph.incidences));
  count("pattern_selections", value.pattern_selections.length);
  count("selected_nodes", value.pattern_selections.reduce((sum, entry) =>
    sum + entry.selected_nodes.length, 0) + value.universal_iterations.reduce(
      (sum, iteration) => sum + iteration.occurrences.reduce(
        (inner, occurrence) => inner + occurrence.selected_nodes.length, 0
      ), 0));
  count("universal_iterations", value.universal_iterations.length);
  count("universal_member_occurrences", value.universal_iterations.reduce(
    (sum, entry) => sum + entry.occurrences.length, 0));
  count("association_selections", value.association_selections.length);
  count("association_members", value.association_selections.reduce(
    (sum, entry) => sum + entry.associated_nodes.length, 0));
  if (graph.node_count !== graph.nodes.length ||
      graph.incidence_count !== graph.incidences.length ||
      graph.incidence_participant_count !== participantCount(graph.incidences)) {
    diagnostics.push({ code: "projected_graph_count_mismatch" });
  }
  const owners = {
    proposition_structure: new Set(), applicability_structure: new Set(),
    claim_proposition_ownership: new Set(), relation_endpoints: new Set(),
    collection_membership: new Set()
  };
  for (const incidence of graph.incidences) {
    const ownerField = incidence.incidence_kind === "claim_proposition_ownership"
      ? "claim_projected_node_id"
      : incidence.incidence_kind === "relation_endpoints"
        ? "relation_projected_node_id"
        : incidence.incidence_kind === "collection_membership"
          ? "collection_projected_node_id" : "proposition_projected_node_id";
    const owner = incidence[ownerField];
    if (owners[incidence.incidence_kind].has(owner)) diagnostics.push({
      code: "incidence_owner_duplicate"
    });
    owners[incidence.incidence_kind].add(owner);
    if (!nodeById.has(owner)) diagnostics.push({ code: "incidence_owner_missing" });
    diagnostics.push(...participantKindDiagnostics(incidence, nodeById));
    if (incidence.incidence_kind === "proposition_structure" &&
        !contiguous(incidence.operands.map(({ operand_position: position }) => position))) {
      diagnostics.push({ code: "operand_position_invalid" });
    }
    if (incidence.incidence_kind === "applicability_structure" &&
        !contiguous(incidence.operands.map(
          ({ applicability_position: position }) => position
        ))) diagnostics.push({ code: "applicability_position_invalid" });
    if (incidence.incidence_kind === "relation_endpoints" &&
        (JSON.stringify(incidence.endpoints.map(
          ({ endpoint_position: position }) => position
        )) !== "[0,1]" ||
        JSON.stringify(incidence.endpoints.map(
          ({ endpoint_role: role }) => role
        )) !== '["source","target"]')) diagnostics.push({
      code: "endpoint_position_or_role_invalid"
    });
    if (incidence.incidence_kind === "collection_membership" &&
        !contiguous(incidence.members.map(({ member_position: position }) => position))) {
      diagnostics.push({ code: "collection_member_position_invalid" });
    }
    if (incidence.incidence_kind === "claim_proposition_ownership" &&
        nodeById.get(owner)?.claim_kind !== incidence.claim_kind) diagnostics.push({
      code: "claim_ownership_kind_mismatch"
    });
    if (incidence.incidence_kind === "collection_membership" &&
        incidence.ordered !==
          (nodeById.get(owner)?.semantic_payload.collection_kind ===
            "ordered_sequence")) diagnostics.push({
      code: "collection_orderedness_mismatch"
    });
  }
  for (const node of graph.nodes) {
    const required = node.node_kind === "proposition"
      ? ["proposition_structure", "applicability_structure"]
      : node.node_kind === "claim" ? ["claim_proposition_ownership"]
        : node.node_kind === "relation" ? ["relation_endpoints"]
          : node.node_kind === "collection" ? ["collection_membership"] : [];
    if (required.some((kind) => !owners[kind].has(node.projected_node_id))) {
      diagnostics.push({ code: "required_incidence_missing" });
    }
  }
  const reconstructed = reconstructedGraph(graph.nodes, graph.incidences);
  if (reconstructed === null || domainSeparatedDigest(
    DOMAINS.graph, canonicalValue(reconstructed)
  ) !== graph.graph_digest) diagnostics.push({ code: "projected_graph_digest_mismatch" });
  for (const node of graph.nodes) {
    const sourceNode = reconstructNode(node, graph.incidences);
    if (sourceNode === null || domainSeparatedDigest(DOMAINS.sourceNode, {
      node_kind: node.node_kind,
      source_node: normalizeGraphNode(`${node.node_kind}s`, sourceNode)
    }) !== node.source_contract_node_digest) diagnostics.push({
      code: "source_contract_node_digest_mismatch"
    });
  }
  for (const selection of value.pattern_selections) {
    if (!contiguous(
      selection.selected_nodes.map(({ selection_position: position }) => position)
    )) diagnostics.push({ code: "selection_position_invalid" });
    const validSelectionStatus = selection.evaluation_status === "satisfied"
      ? selection.selection_status === "selected"
      : selection.evaluation_status === "unsatisfied"
        ? selection.selection_status === "not_satisfied"
        : selection.evaluation_status === "inactive"
          ? selection.selection_status === "inactive_branch"
          : ["ambiguous", "not_applicable"].includes(selection.selection_status);
    if (!validSelectionStatus) diagnostics.push({
      code: "pattern_selection_status_mismatch"
    });
    if (!canonicallySorted(selection.branch_paths) ||
        selection.branch_paths.some((path) => path.some((position, depth) =>
          position.gate_depth !== depth))) diagnostics.push({
      code: "branch_path_invalid"
    });
  }
  if (!canonicallySorted(value.pattern_selections,
    ({ pattern_instance_id: patternId }) => patternId) ||
      new Set(value.pattern_selections.map(
        ({ pattern_instance_id: patternId }) => patternId
      )).size !== value.pattern_selections.length) diagnostics.push({
    code: "pattern_selection_order_or_identity_invalid"
  });
  for (const selection of value.pattern_selections) {
    for (const selected of selection.selected_nodes) if (
      nodeById.get(selected.projected_node_id)?.node_kind !== selected.node_kind ||
      nodeById.get(selected.projected_node_id)?.claim_kind !== selected.claim_kind ||
      selectionRoleFor(nodeById.get(selected.projected_node_id)) !==
        selected.selection_role
    ) diagnostics.push({ code: "selected_node_identity_mismatch" });
  }
  if (!contiguous(value.universal_iterations.map(
    ({ iteration_position: position }) => position
  ))) diagnostics.push({ code: "iteration_position_invalid" });
  for (const iteration of value.universal_iterations) {
    if (iteration.member_count !== iteration.occurrences.length || !contiguous(
      iteration.occurrences.map(({ member_occurrence_position: position }) => position)
    )) diagnostics.push({ code: "occurrence_position_invalid" });
    const validVacuity = iteration.vacuous
      ? iteration.member_count === 0 && iteration.iteration_quantifier === "universal" &&
        iteration.empty_behavior === "vacuously_satisfied"
      : !(iteration.member_count === 0 && iteration.iteration_quantifier === "universal" &&
        iteration.empty_behavior === "vacuously_satisfied");
    if (!validVacuity) diagnostics.push({ code: "vacuity_invalid" });
    const memberIds = iteration.occurrences.map(
      ({ member_projected_node_id: memberId }) => memberId
    );
    if (iteration.population_binding.reference_count !== memberIds.length ||
        domainSeparatedDigest(DOMAINS.populationBinding, {
          pattern_instance_id: iteration.pattern_instance_id,
          population_role: iteration.population_binding.population_role,
          population_reference_projected_node_id:
            iteration.population_binding.population_reference_projected_node_id,
          member_projected_node_ids: memberIds
        }) !== iteration.population_binding.binding_digest) diagnostics.push({
      code: "population_binding_mismatch"
    });
    if (domainSeparatedDigest(DOMAINS.completePopulationBinding, {
      profile_identity_digest: value.cycle_binding.profile_identity.digest,
      resolution_status: iteration.complete_population_binding.status,
      pattern_instance_id:
        iteration.complete_population_binding.pattern_instance_id,
      population_role: iteration.population_binding.population_role
    }) !== iteration.complete_population_binding.binding_identity_digest) {
      diagnostics.push({ code: "complete_population_binding_mismatch" });
    }
    const populationNode = nodeById.get(
      iteration.population_binding.population_reference_projected_node_id
    );
    if (populationNode?.node_kind !== "reference" ||
        !["cc:population", "cc:scope"].includes(
          populationNode.semantic_payload.type_term
        )) diagnostics.push({ code: "population_reference_kind_mismatch" });
    const patternSelection = value.pattern_selections.find(
      ({ pattern_instance_id: patternId }) =>
        patternId === iteration.pattern_instance_id
    );
    const completeSelection = value.pattern_selections.find(
      ({ pattern_instance_id: patternId }) =>
        patternId === iteration.complete_population_binding.pattern_instance_id
    );
    if (patternSelection?.pattern_kind !== iteration.pattern_kind ||
        !sameCanonical(patternSelection?.branch_paths, iteration.branch_paths) ||
        completeSelection?.pattern_kind !== "reference_binding" ||
        completeSelection?.evaluation_status !==
          iteration.complete_population_binding.result_status) diagnostics.push({
      code: "iteration_pattern_binding_mismatch"
    });
    for (const occurrence of iteration.occurrences) {
      if (nodeById.get(occurrence.member_projected_node_id)?.node_kind !== "reference" ||
          occurrence.member_role !== iteration.member_role ||
          !sameCanonical(occurrence.member_positions, iteration.member_positions) ||
          !contiguous(occurrence.selected_nodes.map(
            ({ selection_position: position }) => position
          ))) diagnostics.push({ code: "universal_occurrence_mismatch" });
      for (const selected of occurrence.selected_nodes) if (
        nodeById.get(selected.projected_node_id)?.node_kind !== selected.node_kind ||
        nodeById.get(selected.projected_node_id)?.claim_kind !== selected.claim_kind
      ) diagnostics.push({ code: "selected_node_identity_mismatch" });
    }
  }
  const occurrenceKeys = new Set(value.universal_iterations.flatMap((iteration) =>
    iteration.occurrences.map((occurrence) =>
      `${iteration.iteration_position}\0${occurrence.member_occurrence_position}`
    )));
  const associationKeys = new Set();
  for (const association of value.association_selections) {
    const occurrenceKey = `${association.universal_iteration_position}\0` +
      association.member_occurrence_position;
    const key = `${occurrenceKey}\0${association.association_position}`;
    const iteration = value.universal_iterations[
      association.universal_iteration_position
    ];
    if (!occurrenceKeys.has(occurrenceKey) || associationKeys.has(key) ||
        iteration?.pattern_instance_id !== association.pattern_instance_id ||
        iteration?.member_role !== association.member_role ||
        !contiguous(association.associated_nodes.map(
          ({ associated_node_position: position }) => position
        ))) diagnostics.push({ code: "association_occurrence_mismatch" });
    const associatedMemberCount = association.associated_nodes.length;
    const statusCardinalityCountValid = association.association_status === "satisfied"
      ? (association.cardinality === "exactly_one"
          ? associatedMemberCount === 1
          : association.cardinality === "one_or_more" && associatedMemberCount >= 1)
      : ["unsatisfied", "indeterminate"].includes(association.association_status) &&
        associatedMemberCount === 0;
    if (!statusCardinalityCountValid) diagnostics.push({
      code: "association_status_cardinality_member_count_mismatch"
    });
    associationKeys.add(key);
    for (const associated of association.associated_nodes) if (
      nodeById.get(associated.projected_node_id)?.node_kind !== associated.node_kind ||
      nodeById.get(associated.projected_node_id)?.claim_kind !== associated.claim_kind
    ) diagnostics.push({ code: "association_node_identity_mismatch" });
  }
  if (!canonicallySorted(value.association_selections, (association) => [
    association.universal_iteration_position,
    association.member_occurrence_position,
    association.association_position
  ].map((position) => String(position).padStart(12, "0")).join("\0"))) {
    diagnostics.push({ code: "association_order_invalid" });
  }
  return diagnostics;
}

function assertProjectedSelectionSupplement(value) {
  if (!hasTrustedProjectedSelectionSupplement(value) || value.status !== "success" ||
      value.validation_status !== "validated_complete") throw new TypeError(
    "projected-selection supplement is not a validated package-owned success"
  );
  const payload = structuredClone(value);
  const digest = payload.supplement_identity.digest;
  delete payload.supplement_identity.digest;
  if (domainSeparatedDigest(DOMAINS.supplement, payload) !== digest ||
      canonicalJsonBytes(value).byteLength !== value.counts.successful_output_bytes) {
    throw new TypeError("projected-selection supplement identity is stale");
  }
  return value;
}

function validateProjectedSelectionSupplement(value, { assessmentPackCycle = null } = {}) {
  const cycleValid = assessmentPackCycle === null ||
    (validateAssessmentPackCycle(assessmentPackCycle) &&
      (value?.status === "success"
        ? sameCanonical(value?.cycle_binding, assessmentPackCycle.cycle_binding)
        : value?.observed_binding?.expected_assessment_pack_cycle_digest ===
          assessmentPackCycle.digest));
  return frozenClone({
    valid: validateSupplementSchema(value) &&
      supplementSemanticDiagnostics(value).length === 0 && cycleValid,
    schema_errors: validateSupplementSchema(value)
      ? [] : structuredClone(validateSupplementSchema.errors ?? []),
    semantic_diagnostics: [
      ...supplementSemanticDiagnostics(value),
      ...(cycleValid ? [] : [{ code: "assessment_pack_cycle_mismatch" }])
    ]
  });
}

export {
  AUTHORITY,
  DOMAINS,
  LIMITS,
  SUPPLEMENT_REVISION,
  SUPPLEMENT_VERSION,
  assertProjectedSelectionSupplement,
  buildPlanningPackCycle,
  buildProjectedSelectionSupplement,
  buildProofAwareInputCycle,
  buildSupplementCensus,
  commitment,
  createAssessmentPackCycle,
  firstResourceBreach,
  projectedSelectionCommitments,
  resourceFailure as projectedSelectionResourceFailure,
  unsupportedFailure as projectedSelectionUnsupportedFailure,
  validateProjectedSelectionSupplement
};
