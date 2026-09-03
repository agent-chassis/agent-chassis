import {
  ExactBindingError,
  canonicalDigest,
  compareCodeUnits,
  deepFreeze,
  sortedUnique
} from "./deterministic-projection-primitives.mjs";
import {
  GRAPH_SELECTION_TRACE_VERSION,
  projectedGraphContractDiagnostics,
  projectedGraphEqualityDiagnostics,
  projectedGraphNodeIds
} from "./projected-contract-graph.mjs";
import {
  buildEqualityNormalization
} from "./equality-normalization.mjs";

const BINDING_VERSION = "controlled-contract-projected-evaluation-binding.v1";
const TRACE_VERSION = GRAPH_SELECTION_TRACE_VERSION;
const CONTEXT_FIELDS = Object.freeze([
  "admission_digest",
  "contract_digest",
  "evaluation_input_digest",
  "exact_binding_certification_digest",
  "exact_binding_declaration_digest",
  "profile_digest",
  "vocabulary_complete_digest",
  "vocabulary_version"
]);
const NODE_KIND_BY_PATTERN_KIND = Object.freeze({
  claim: "claims",
  collection: "collections",
  relation: "relations"
});
const IGNORED_PATTERN_KINDS = Object.freeze([
  "binding_constraint", "evidence", "resolver_fact"
]);

const SUPPORTED_TRACE_SHAPES = Object.freeze({
  reference_binding_comparisons: Object.freeze([
    "complete_population", "distinct_references"
  ]),
  iterated_claim_association_bindings: true,
  iterated_claim_association_cardinalities: Object.freeze([
    "exactly_one", "one_or_more"
  ])
});
const ITERATION_TRACE_POINT = "for_each_association_iteration";
const ASSOCIATION_TRACE_POINT = "for_each_association_binding";

const TRACE_RECONCILIATION_REASONS = Object.freeze({
  incomplete: Object.freeze([
    "association_record_missing",
    "association_record_unsatisfied",
    "association_selection_cardinality_mismatch",
    "iteration_population_empty",
    "iteration_record_missing"
  ]),
  unexpected: Object.freeze([
    "association_record_declaration_mismatch",
    "association_record_duplicate",
    "association_record_unlicensed",
    "iteration_association_count_mismatch",
    "iteration_population_noncanonical",
    "iteration_record_duplicate",
    "vacuous_iteration_selected_nodes"
  ])
});
const TRUSTED_ENVELOPES = new WeakSet();
const TRUSTED_PROJECTED_SELECTIONS = new WeakSet();
const INTERNAL_ENVELOPE_AUTHORITY = Symbol(
  "controlled-contract-projected-evaluation-envelope-authority"
);

function createGraphSelectionTrace() {
  const records = [];
  let began = false;
  const sink = (record) => {
    if (record?.trace_version !== TRACE_VERSION) return;
    if (record.trace_point === "evaluation_begin") {
      began = true;
      return;
    }
    records.push(structuredClone({
      trace_point: record.trace_point,
      pattern_id: record.pattern_id,
      pattern_kind: record.pattern_kind ?? null,
      iteration_position: record.iteration_position ?? null,
      branch_paths: record.branch_paths ?? null,
      population_role: record.population_role ?? null,
      population_reference_id: record.population_reference_id ?? null,
      complete_population_status: record.complete_population_status ?? null,
      complete_population_pattern_id:
        record.complete_population_pattern_id ?? null,
      complete_population_result: record.complete_population_result ?? null,
      member_role: record.member_role ?? null,
      member_positions: record.member_positions ?? null,
      iteration_quantifier: record.iteration_quantifier ?? null,
      empty_behavior: record.empty_behavior ?? null,
      node_kind: record.node_kind ?? null,
      node_ids: [...(record.node_ids ?? [])],
      member_reference_id: record.member_reference_id ?? null,
      member_reference_ids: Array.isArray(record.member_reference_ids)
        ? [...record.member_reference_ids] : null,
      member_occurrence_position: record.member_occurrence_position ?? null,
      selection_status: record.selection_status ?? null,
      association_index: record.association_index ?? null,
      member_position: record.member_position ?? null,
      associated_role: record.associated_role ?? null,
      associated_position: record.associated_position ?? null,
      associated_cardinality: record.associated_cardinality ?? null,
      association_status: record.association_status ?? null,
      association_count: record.association_count ?? null,
      member_count: record.member_count ?? null,
      occurrence_count: record.occurrence_count ?? null,
      iteration_vacuous: record.iteration_vacuous ?? null,
      completion_status: record.completion_status ?? null
    }));
  };
  return {
    sink,
    snapshot: () => deepFreeze({
      trace_version: TRACE_VERSION,
      began,
      records: structuredClone(records)
    })
  };
}

function diagnostic(code, fields = {}) {
  return { code, ...fields };
}

function buildProjectedEvaluationEnvelope({
  optIn,
  transformerId,
  graph,
  projectionResultSha256,
  context
}, authority) {
  if (authority !== INTERNAL_ENVELOPE_AUTHORITY) throw new ExactBindingError(
    "projected_evaluation_envelope_authority_missing",
    "only the internal deterministic capture runner can mint a projected-graph envelope"
  );
  const envelope = deepFreeze({
    binding_version: BINDING_VERSION,
    transformer_id: transformerId,
    graph_projection_id: optIn.graph_projection_id,
    result_requirement_id: optIn.result_requirement_id,
    projection_result_sha256: projectionResultSha256,
    declaration_opt_in_digest: canonicalDigest(optIn),
    context: Object.fromEntries(CONTEXT_FIELDS.map((field) => [field, context[field]])),
    graph
  });
  TRUSTED_ENVELOPES.add(envelope);
  return envelope;
}

function profileTraceCapabilityDiagnostics(profile) {
  const diagnostics = [];
  for (const pattern of profile?.reference_binding_patterns ?? []) {
    if (SUPPORTED_TRACE_SHAPES.reference_binding_comparisons.includes(
      pattern?.comparison
    )) continue;
    diagnostics.push(diagnostic("projected_evaluation_unsupported_profile_construct", {
      pattern_id: pattern?.pattern_id ?? null,
      construct: `reference_binding.${pattern?.comparison ?? "unknown"}`
    }));
  }
  for (const pattern of profile?.claim_patterns ?? []) {
    const associations = pattern?.for_each?.association_bindings ?? [];
    if (associations.length === 0) continue;
    if (!SUPPORTED_TRACE_SHAPES.iterated_claim_association_bindings) {
      diagnostics.push(diagnostic("projected_evaluation_unsupported_profile_construct", {
        pattern_id: pattern.pattern_id,
        construct: "claim.for_each.association_bindings"
      }));
      continue;
    }
    for (const association of associations) {
      const cardinality = association?.associated_cardinality ?? "exactly_one";
      if (SUPPORTED_TRACE_SHAPES.iterated_claim_association_cardinalities.includes(
        cardinality
      )) continue;
      diagnostics.push(diagnostic("projected_evaluation_unsupported_profile_construct", {
        pattern_id: pattern.pattern_id,
        construct: `claim.for_each.association_bindings.${cardinality}`
      }));
    }
  }
  return diagnostics;
}

function traceIncomplete(patternId, tracePoint, reason, fields = {}) {
  return diagnostic("projected_evaluation_trace_incomplete", {
    pattern_id: patternId, trace_point: tracePoint, reason, ...fields
  });
}

function traceUnexpected(patternId, tracePoint, reason, fields = {}) {
  return diagnostic("projected_evaluation_trace_unexpected_record", {
    pattern_id: patternId, trace_point: tracePoint, reason, ...fields
  });
}

function bindIteratedAssociations(pattern, result, recordsAt, selected) {
  const patternId = pattern.pattern_id;
  const associations = pattern.for_each?.association_bindings ?? [];
  const iterations = recordsAt(patternId, ITERATION_TRACE_POINT);
  const records = recordsAt(patternId, ASSOCIATION_TRACE_POINT);
  if (iterations.length === 0) return [traceIncomplete(
    patternId, ITERATION_TRACE_POINT, "iteration_record_missing"
  )];
  if (iterations.length > 1) return [traceUnexpected(
    patternId, ITERATION_TRACE_POINT, "iteration_record_duplicate"
  )];
  const [iteration] = iterations;
  if (iteration.association_count !== associations.length) return [traceUnexpected(
    patternId, ITERATION_TRACE_POINT, "iteration_association_count_mismatch"
  )];
  const members = iteration.member_reference_ids;
  if (!Array.isArray(members) || !sortedUnique(members)) return [traceUnexpected(
    patternId, ITERATION_TRACE_POINT, "iteration_population_noncanonical"
  )];
  if (iteration.iteration_vacuous === true) {
    if (members.length === 0 && records.length === 0 &&
        (result.matched_ids ?? []).length === 0) return [];
    return [traceUnexpected(
      patternId, ITERATION_TRACE_POINT, "vacuous_iteration_selected_nodes"
    )];
  }
  if (members.length === 0) return [traceIncomplete(
    patternId, ITERATION_TRACE_POINT, "iteration_population_empty"
  )];
  const diagnostics = [];
  const licensed = new Set(members.flatMap((member) =>
    associations.map((association, index) => `${member}\u0000${index}`)
  ));
  const recordByKey = new Map();
  for (const record of records) {
    const key = `${record.member_reference_id}\u0000${record.association_index}`;
    if (!licensed.has(key)) {
      diagnostics.push(traceUnexpected(
        patternId, ASSOCIATION_TRACE_POINT, "association_record_unlicensed", {
          member_reference_id: record.member_reference_id,
          association_index: record.association_index
        }
      ));
      continue;
    }
    if (recordByKey.has(key)) {
      diagnostics.push(traceUnexpected(
        patternId, ASSOCIATION_TRACE_POINT, "association_record_duplicate", {
          member_reference_id: record.member_reference_id,
          association_index: record.association_index
        }
      ));
      continue;
    }
    recordByKey.set(key, record);
  }
  const memberByClaim = new Map();
  for (const member of members) {
    for (const [index, association] of associations.entries()) {
      const fields = { member_reference_id: member, association_index: index };
      const record = recordByKey.get(`${member}\u0000${index}`);
      if (record === undefined) {
        diagnostics.push(traceIncomplete(
          patternId, ASSOCIATION_TRACE_POINT, "association_record_missing", fields
        ));
        continue;
      }
      const cardinality = association.associated_cardinality ?? "exactly_one";
      if (record.node_kind !== "claim" ||
          record.associated_role !== association.associated_role ||
          record.associated_cardinality !== cardinality) {
        diagnostics.push(traceUnexpected(
          patternId, ASSOCIATION_TRACE_POINT,
          "association_record_declaration_mismatch", fields
        ));
        continue;
      }
      if (record.association_status !== "satisfied") {
        diagnostics.push(traceIncomplete(
          patternId, ASSOCIATION_TRACE_POINT, "association_record_unsatisfied", fields
        ));
        continue;
      }
      if (cardinality === "exactly_one"
        ? record.node_ids.length !== 1
        : record.node_ids.length === 0) {
        diagnostics.push(traceIncomplete(
          patternId, ASSOCIATION_TRACE_POINT,
          "association_selection_cardinality_mismatch", fields
        ));
        continue;
      }
      const memberPosition = association.member_position ?? "subject";
      for (const identifier of record.node_ids) {
        const key = `${memberPosition}\u0000${identifier}`;
        const owner = memberByClaim.get(key);
        if (owner !== undefined && owner !== member) {
          diagnostics.push(diagnostic("projected_evaluation_trace_member_conflict", {
            pattern_id: patternId,
            member_position: memberPosition,
            node_id: identifier,
            member_reference_ids: [owner, member].sort(compareCodeUnits)
          }));
          continue;
        }
        memberByClaim.set(key, member);
        selected.claims.add(identifier);
      }
    }
  }
  return diagnostics;
}

function selectedContractNodes(evaluation, profile, trace) {
  const diagnostics = [];
  const selected = { claims: new Set(), collections: new Set(), relations: new Set() };
  const referenceBindingById = new Map(
    (profile?.reference_binding_patterns ?? []).map((pattern) => [
      pattern.pattern_id, pattern
    ])
  );
  const claimPatternById = new Map(
    (profile?.claim_patterns ?? []).map((pattern) => [pattern.pattern_id, pattern])
  );

  const recordsByPoint = new Map();
  for (const record of trace.records) {
    const key = `${record.trace_point}\u0000${record.pattern_id}`;
    const entries = recordsByPoint.get(key);
    if (entries === undefined) recordsByPoint.set(key, [record]);
    else entries.push(record);
  }
  const recordsAt = (patternId, tracePoint) =>
    recordsByPoint.get(`${tracePoint}\u0000${patternId}`) ?? [];
  const claimRecordsAt = (patternId, tracePoint) => recordsAt(patternId, tracePoint)
    .filter((record) => record.node_kind === "claim");
  for (const result of evaluation?.pattern_results ?? []) {
    if (result.status !== "satisfied") continue;
    const nodeKind = NODE_KIND_BY_PATTERN_KIND[result.pattern_kind];
    if (nodeKind) {
      for (const identifier of result.matched_ids ?? []) selected[nodeKind].add(identifier);
      if (result.pattern_kind === "claim") {
        const pattern = claimPatternById.get(result.pattern_id);
        if (!pattern) {
          diagnostics.push(diagnostic("projected_evaluation_pattern_unresolved", {
            pattern_id: result.pattern_id, pattern_kind: result.pattern_kind
          }));
          continue;
        }
        if ((pattern.for_each?.association_bindings ?? []).length > 0) {
          diagnostics.push(
            ...bindIteratedAssociations(pattern, result, recordsAt, selected)
          );
        }
      }
      continue;
    }
    if (result.pattern_kind === "reference_binding") {
      const pattern = referenceBindingById.get(result.pattern_id);
      if (!pattern) {
        diagnostics.push(diagnostic("projected_evaluation_pattern_unresolved", {
          pattern_id: result.pattern_id, pattern_kind: result.pattern_kind
        }));
        continue;
      }
      if (pattern.comparison === "same_reference") {

        if ((result.matched_ids ?? []).length > 1) diagnostics.push(diagnostic(
          "projected_evaluation_reference_comparison_unbound", {
            pattern_id: result.pattern_id,
            comparison: "same_reference"
          }
        ));
        continue;
      }

      if (pattern.comparison === "distinct_references") continue;
      if (pattern.comparison !== "complete_population") {
        diagnostics.push(diagnostic("projected_evaluation_reference_comparison_unbindable", {
          pattern_id: result.pattern_id, comparison: pattern.comparison ?? null
        }));
        continue;
      }
      const records = claimRecordsAt(
        result.pattern_id, "complete_population_binding"
      );
      if (records.length === 0) {
        diagnostics.push(diagnostic("projected_evaluation_trace_incomplete", {
          pattern_id: result.pattern_id, trace_point: "complete_population_binding"
        }));
        continue;
      }
      for (const record of records) for (const identifier of record.node_ids) {
        selected.claims.add(identifier);
      }
      continue;
    }
    if (IGNORED_PATTERN_KINDS.includes(result.pattern_kind)) continue;
    diagnostics.push(diagnostic("projected_evaluation_pattern_kind_unbindable", {
      pattern_id: result.pattern_id, pattern_kind: result.pattern_kind
    }));
  }
  return { selected, diagnostics };
}

function expressionSortKey(expression) {
  if (expression.pattern) return `pattern:${expression.pattern}`;
  const kind = expression.all_of ? "all_of" : "any_of";
  return JSON.stringify({
    kind,
    children: expression[kind].map(expressionSortKey).sort(compareCodeUnits),
    branch_cardinality: expression.branch_cardinality ?? null
  });
}

function branchPathsByPattern(expression) {
  const result = new Map();
  const visit = (node, path, depth) => {
    if (node.pattern) {
      const values = result.get(node.pattern) ?? [];
      values.push(path);
      result.set(node.pattern, values);
      return;
    }
    const kind = node.all_of ? "all_of" : "any_of";
    const operator = kind === "any_of" && node.branch_cardinality === "exactly_one"
      ? "exactly_one" : kind;
    const children = operator === "exactly_one"
      ? [...node[kind]].sort((left, right) => compareCodeUnits(
          expressionSortKey(left), expressionSortKey(right)
        ))
      : node[kind];
    children.forEach((child, branchPosition) => visit(child, [...path, {
      gate_depth: depth,
      gate_operator: operator,
      branch_position: branchPosition
    }], depth + 1));
  };
  visit(expression, [], 0);
  for (const [patternId, paths] of result) result.set(patternId, paths.sort(
    (left, right) => compareCodeUnits(JSON.stringify(left), JSON.stringify(right))
  ));
  return result;
}

function graphNodeIndex(graph) {
  const result = new Map();
  for (const [population, field] of [
    ["claims", "claim_id"], ["collections", "collection_id"],
    ["propositions", "proposition_id"], ["references", "reference_id"],
    ["relations", "relation_id"]
  ]) for (const node of graph[population]) result.set(node[field], {
    population,
    node
  });
  return result;
}

function selectionStatus(status) {
  return status === "satisfied" ? "selected"
    : status === "unsatisfied" ? "not_satisfied"
      : status === "inactive" ? "inactive_branch" : "ambiguous";
}

function sameCanonical(left, right) {
  return canonicalDigest(left) === canonicalDigest(right);
}

function expectedIterationMemberPositions(pattern) {
  const positions = [];
  const memberRole = pattern.for_each.member_role;
  const collect = (template) => {
    if (!template) return;
    if (template.subject_role === memberRole) positions.push({
      position_kind: "subject", position: 0
    });
    (template.operands ?? []).forEach((operand, position) => {
      if (operand.kind === "reference" && operand.role === memberRole) positions.push({
        position_kind: "operand", position
      });
    });
    (template.applicability_context?.operand_roles ?? []).forEach(
      (role, position) => {
        if (role === memberRole) positions.push({
          position_kind: "applicability_operand", position
        });
      }
    );
  };
  collect(pattern.proposition_template);
  collect(pattern.falsifying_proposition_template);
  return [...new Map(positions.map((entry) => [JSON.stringify(entry), entry])).values()]
    .sort((left, right) => {
      const rank = { subject: 0, operand: 1, applicability_operand: 2 };
      return rank[left.position_kind] - rank[right.position_kind] ||
        left.position - right.position;
    });
}

function buildLosslessSelection(evaluation, profile, trace, graph) {
  const diagnostics = [];
  const nodes = graphNodeIndex(graph);
  const branchPaths = branchPathsByPattern(profile.satisfaction_expression);
  const patternSelections = (evaluation?.pattern_results ?? []).map((result) => ({
    pattern_instance_id: result.pattern_id,
    pattern_kind: result.pattern_kind,
    evaluation_status: result.status,
    selection_status: selectionStatus(result.status),
    branch_paths: structuredClone(branchPaths.get(result.pattern_id) ?? []),
    selected_node_ids: (result.matched_ids ?? []).filter((id) => nodes.has(id))
  }));
  for (const selection of patternSelections) if (selection.branch_paths.length === 0) {
    diagnostics.push(diagnostic("projected_evaluation_universal_trace_mismatch", {
      pattern_id: selection.pattern_instance_id,
      reason: "pattern_branch_path_missing"
    }));
  }

  const recordsAt = (point, patternId) => trace.records.filter((record) =>
    record.trace_point === point && record.pattern_id === patternId
  );
  const claimPatterns = new Map((profile.claim_patterns ?? []).map(
    (pattern) => [pattern.pattern_id, pattern]
  ));
  const resultByPattern = new Map((evaluation?.pattern_results ?? []).map(
    (result) => [result.pattern_id, result]
  ));
  const activeIterations = [...claimPatterns.values()].filter((candidate) =>
    candidate.for_each &&
      resultByPattern.get(candidate.pattern_id)?.status !== "inactive"
  ).sort((left, right) => compareCodeUnits(left.pattern_id, right.pattern_id) ||
    compareCodeUnits(
      JSON.stringify(branchPaths.get(left.pattern_id) ?? []),
      JSON.stringify(branchPaths.get(right.pattern_id) ?? [])
    ));
  const activePatternIds = new Set(activeIterations.map(({ pattern_id: id }) => id));
  const universalTracePoints = new Set([
    "for_each_iteration_begin", "for_each_member_occurrence",
    "for_each_association_binding", "for_each_iteration_end"
  ]);
  for (const record of trace.records) if (
    universalTracePoints.has(record.trace_point) &&
    !activePatternIds.has(record.pattern_id)
  ) diagnostics.push(diagnostic("projected_evaluation_universal_trace_mismatch", {
    pattern_id: record.pattern_id,
    reason: "surplus_iteration_record"
  }));
  const universalIterations = [];
  const associationSelections = [];
  for (const [expectedIterationPosition, pattern] of activeIterations.entries()) {
    const begins = recordsAt("for_each_iteration_begin", pattern.pattern_id);
    const ends = recordsAt("for_each_iteration_end", pattern.pattern_id);
    if (begins.length !== 1 || ends.length !== 1) {
      diagnostics.push(diagnostic("projected_evaluation_universal_trace_mismatch", {
        pattern_id: pattern.pattern_id,
        reason: begins.length === 0 || ends.length === 0
          ? "iteration_announcement_missing" : "iteration_announcement_duplicate"
      }));
      continue;
    }
    const [begin] = begins;
    const [end] = ends;
    const members = begin.member_reference_ids;
    const occurrences = recordsAt("for_each_member_occurrence", pattern.pattern_id);
    const associations = recordsAt("for_each_association_binding", pattern.pattern_id);
    const completeCandidates = (profile.reference_binding_patterns ?? []).filter(
      (candidate) => candidate.comparison === "complete_population" &&
        candidate.roles?.[1] === pattern.for_each.population_role &&
        (pattern.for_each.complete_population_pattern_id === undefined ||
          candidate.pattern_id === pattern.for_each.complete_population_pattern_id)
    );
    const expectedCompletePattern = completeCandidates.length === 1
      ? completeCandidates[0] : null;
    const expectedComplete = expectedCompletePattern === null ? undefined
      : resultByPattern.get(expectedCompletePattern.pattern_id);
    const expectedMembers = Array.isArray(members) ? members : [];
    const expectedMatched = [begin.population_reference_id, ...expectedMembers]
      .sort(compareCodeUnits);
    const mismatch = !Array.isArray(members) || !sortedUnique(members) ||
      begin.pattern_kind !== "claim" ||
      begin.iteration_position !== expectedIterationPosition ||
      begin.iteration_position !== end.iteration_position ||
      begin.completion_status !== null || end.completion_status !== "complete" ||
      !sameCanonical(begin.branch_paths, branchPaths.get(pattern.pattern_id) ?? []) ||
      begin.population_role !== pattern.for_each.population_role ||
      begin.member_role !== pattern.for_each.member_role ||
      !sameCanonical(begin.member_positions,
        expectedIterationMemberPositions(pattern)) ||
      begin.iteration_quantifier !==
        (pattern.for_each.quantifier ?? "bound_population") ||
      begin.empty_behavior !==
        (pattern.for_each.empty_behavior ?? "not_vacuous") ||
      begin.complete_population_pattern_id !== expectedCompletePattern?.pattern_id ||
      begin.complete_population_status !==
        (pattern.for_each.complete_population_pattern_id === undefined
          ? "resolved_unique_by_population_role" : "declared") ||
      expectedComplete === undefined ||
      JSON.stringify(begin.complete_population_result) !== JSON.stringify(expectedComplete) ||
      JSON.stringify(expectedComplete.matched_ids ?? []) !== JSON.stringify(expectedMatched) ||
      end.member_count !== members?.length || end.occurrence_count !== occurrences.length ||
      occurrences.length !== members?.length ||
      end.iteration_vacuous !== (members?.length === 0 &&
        begin.iteration_quantifier === "universal" &&
        begin.empty_behavior === "vacuously_satisfied");
    if (mismatch) diagnostics.push(diagnostic(
      "projected_evaluation_universal_trace_mismatch", {
        pattern_id: pattern.pattern_id,
        reason: "iteration_population_or_completion_mismatch"
      }
    ));
    const occurrenceByPosition = new Map();
    for (const occurrence of occurrences) {
      if (!Number.isSafeInteger(occurrence.member_occurrence_position) ||
          occurrence.member_occurrence_position < 0 ||
          occurrence.member_occurrence_position >= expectedMembers.length ||
          occurrenceByPosition.has(occurrence.member_occurrence_position) ||
          expectedMembers[occurrence.member_occurrence_position] !==
            occurrence.member_reference_id || occurrence.iteration_position !==
            begin.iteration_position || occurrence.member_role !== begin.member_role ||
          !sameCanonical(occurrence.member_positions, begin.member_positions) ||
          nodes.get(occurrence.member_reference_id)?.population !== "references") {
        diagnostics.push(diagnostic("projected_evaluation_universal_trace_mismatch", {
          pattern_id: pattern.pattern_id,
          reason: "member_occurrence_mismatch"
        }));
        continue;
      }
      occurrenceByPosition.set(occurrence.member_occurrence_position, occurrence);
    }
    const occurrenceValues = [...occurrenceByPosition.entries()]
      .sort(([left], [right]) => left - right)
      .map(([position, occurrence]) => ({
        member_occurrence_position: position,
        member_projected_node_id: occurrence.member_reference_id,
        member_role: occurrence.member_role,
        member_positions: structuredClone(occurrence.member_positions),
        selection_status: occurrence.selection_status,
        selected_node_ids: [...occurrence.node_ids]
      }));
    const declaredAssociations = pattern.for_each.association_bindings ?? [];
    const associationKeys = new Set();
    for (const record of associations) {
      const key = `${record.member_occurrence_position}\0${record.association_index}`;
      const declaration = declaredAssociations[record.association_index];
      const occurrence = occurrenceByPosition.get(record.member_occurrence_position);
      if (associationKeys.has(key) || declaration === undefined || occurrence === undefined ||
          record.iteration_position !== begin.iteration_position ||
          record.member_reference_id !== occurrence.member_reference_id ||
          record.member_role !== begin.member_role ||
          record.member_position !== declaration.member_position ||
          record.associated_role !== declaration.associated_role ||
          record.associated_position !== declaration.associated_position ||
          record.associated_cardinality !==
            (declaration.associated_cardinality ?? "exactly_one")) {
        diagnostics.push(diagnostic("projected_evaluation_universal_trace_mismatch", {
          pattern_id: pattern.pattern_id,
          reason: "association_occurrence_mismatch"
        }));
        continue;
      }
      associationKeys.add(key);
      associationSelections.push({
        pattern_instance_id: pattern.pattern_id,
        universal_iteration_position: begin.iteration_position,
        member_occurrence_position: record.member_occurrence_position,
        association_position: record.association_index,
        member_role: record.member_role,
        member_position: record.member_position,
        associated_role: record.associated_role,
        associated_position: record.associated_position,
        association_status: record.association_status,
        associated_node_ids: [...record.node_ids],
        cardinality: record.associated_cardinality
      });
    }
    if (associationKeys.size !== expectedMembers.length * declaredAssociations.length ||
        end.association_count !== associationKeys.size) diagnostics.push(diagnostic(
      "projected_evaluation_universal_trace_mismatch", {
        pattern_id: pattern.pattern_id,
        reason: "association_population_mismatch"
      }
    ));
    universalIterations.push({
      iteration_position: begin.iteration_position,
      pattern_instance_id: pattern.pattern_id,
      pattern_kind: "claim",
      branch_paths: structuredClone(begin.branch_paths),
      population_role: begin.population_role,
      population_reference_projected_node_id: begin.population_reference_id,
      member_projected_node_ids: [...expectedMembers],
      complete_population_status: begin.complete_population_status,
      complete_population_pattern_instance_id:
        begin.complete_population_pattern_id,
      complete_population_result: structuredClone(begin.complete_population_result),
      member_role: begin.member_role,
      member_positions: structuredClone(begin.member_positions),
      iteration_quantifier: begin.iteration_quantifier,
      empty_behavior: begin.empty_behavior,
      vacuous: end.iteration_vacuous,
      occurrences: occurrenceValues
    });
  }
  universalIterations.sort((left, right) => left.iteration_position - right.iteration_position);
  associationSelections.sort((left, right) =>
    left.universal_iteration_position - right.universal_iteration_position ||
    left.member_occurrence_position - right.member_occurrence_position ||
    left.association_position - right.association_position
  );
  return {
    diagnostics,
    value: deepFreeze({
      graph: structuredClone(graph),
      pattern_selections: patternSelections,
      universal_iterations: universalIterations,
      association_selections: associationSelections
    })
  };
}

function reconcileProjectedSelectionTrace({ evaluation, profile, trace, graph }) {
  const result = buildLosslessSelection(evaluation, profile, trace, graph);
  return deepFreeze(structuredClone(result));
}

function selectionOutcomeDiagnostic(value) {
  return value.code === "projected_evaluation_trace_incomplete" &&
    value.reason === "association_record_unsatisfied";
}

function contextDiagnostics(envelope, expectedContext, resultContext) {
  const diagnostics = [];
  for (const field of CONTEXT_FIELDS) {
    if (envelope.context[field] !== expectedContext?.[field] ||
        envelope.context[field] !== resultContext?.[field]) diagnostics.push(diagnostic(
      "projected_evaluation_context_stale_or_spliced", { context_field: field }
    ));
  }
  return diagnostics;
}

function projectionResultDiagnostics(envelope, exactBindingResult) {
  const binding = (exactBindingResult?.bindings ?? []).find(
    ({ requirement_id: id }) => id === envelope.result_requirement_id
  );
  if (!binding) return [diagnostic("projected_evaluation_result_binding_missing", {
    requirement_id: envelope.result_requirement_id
  })];
  if (binding.content_sha256 !== envelope.projection_result_sha256) {
    return [diagnostic("projected_evaluation_result_bytes_spliced", {
      requirement_id: envelope.result_requirement_id
    })];
  }
  const relation = (exactBindingResult?.relation_results ?? []).find(
    ({ operator, result_requirement_id: id }) =>
      operator === "deterministic_projection" && id === envelope.result_requirement_id
  );
  if (!relation || relation.status !== "satisfied" ||
      relation.transformer_id !== envelope.transformer_id ||
      relation.observed_result_content_sha256 !== envelope.projection_result_sha256) {
    return [diagnostic("projected_evaluation_projection_relation_unproven", {
      requirement_id: envelope.result_requirement_id
    })];
  }
  return [];
}

function evaluateProjectedEvaluationBinding({
  declaredOptIn = null,
  envelope = null,
  exactBindingResult,
  expectedContext,
  contract,
  profile,
  evaluation,
  trace
}) {
  if (declaredOptIn === null && envelope === null) {
    return deepFreeze({ applicable: false, diagnostics: [] });
  }
  const diagnostics = [];
  if (envelope === null) diagnostics.push(diagnostic(
    "projected_evaluation_binding_envelope_missing"
  ));
  else if (!TRUSTED_ENVELOPES.has(envelope) || !Object.isFrozen(envelope)) {
    diagnostics.push(diagnostic("projected_evaluation_envelope_unrecognized"));
  }
  if (declaredOptIn === null) diagnostics.push(diagnostic(
    "projected_evaluation_binding_undeclared"
  ));
  if (diagnostics.length > 0) return deepFreeze({ applicable: true, diagnostics });
  if (declaredOptIn.binding_version !== BINDING_VERSION ||
      canonicalDigest(declaredOptIn) !== envelope.declaration_opt_in_digest) {
    diagnostics.push(diagnostic("projected_evaluation_declaration_mismatch"));
  }
  diagnostics.push(...profileTraceCapabilityDiagnostics(profile));
  diagnostics.push(...contextDiagnostics(
    envelope, expectedContext, exactBindingResult?.context
  ));
  if (exactBindingResult?.provenance?.capture_verified !== true ||
      exactBindingResult?.satisfaction !== "satisfied") diagnostics.push(diagnostic(
    "projected_evaluation_capture_unproven"
  ));
  diagnostics.push(...projectionResultDiagnostics(envelope, exactBindingResult));
  diagnostics.push(...projectedGraphContractDiagnostics(envelope.graph, contract));
  diagnostics.push(...projectedGraphEqualityDiagnostics(
    envelope.graph, contract, buildEqualityNormalization
  ));
  if (trace?.trace_version !== TRACE_VERSION || trace?.began !== true) {
    diagnostics.push(diagnostic("projected_evaluation_trace_unavailable"));
    return deepFreeze({ applicable: true, diagnostics: sortDiagnostics(diagnostics) });
  }
  const { selected, diagnostics: traceDiagnostics } = selectedContractNodes(
    evaluation, profile, trace
  );
  diagnostics.push(...traceDiagnostics);
  for (const [nodeKind, identifiers] of Object.entries(selected)) {
    const projected = projectedGraphNodeIds(envelope.graph, nodeKind);
    for (const identifier of [...identifiers].sort(compareCodeUnits)) {
      if (projected.has(identifier)) continue;
      diagnostics.push(diagnostic("projected_evaluation_selected_node_unprojected", {
        node_kind: nodeKind, node_id: identifier
      }));
    }
  }
  const lossless = buildLosslessSelection(
    evaluation, profile, trace, envelope.graph
  );
  diagnostics.push(...lossless.diagnostics);
  if (diagnostics.some((entry) => !selectionOutcomeDiagnostic(entry))) {
    return deepFreeze({
    applicable: true, diagnostics: sortDiagnostics(diagnostics)
    });
  }
  const success = deepFreeze({
    applicable: true,
    diagnostics: sortDiagnostics(diagnostics),
    selection: lossless.value
  });
  TRUSTED_PROJECTED_SELECTIONS.add(success);
  return success;
}

function assertTrustedProjectedSelection(value) {
  if (!TRUSTED_PROJECTED_SELECTIONS.has(value) || !Object.isFrozen(value) ||
      value?.applicable !== true ||
      value?.selection === undefined) throw new ExactBindingError(
    "projected_evaluation_selection_unrecognized",
    "lossless supplement construction requires evaluator-owned projected selection"
  );
  return value.selection;
}

function hasTrustedProjectedSelection(value) {
  return TRUSTED_PROJECTED_SELECTIONS.has(value);
}

function sortDiagnostics(diagnostics) {
  return [...diagnostics].sort((left, right) =>
    compareCodeUnits(JSON.stringify(left), JSON.stringify(right))
  );
}

export {
  ASSOCIATION_TRACE_POINT,
  BINDING_VERSION,
  INTERNAL_ENVELOPE_AUTHORITY,
  ITERATION_TRACE_POINT,
  SUPPORTED_TRACE_SHAPES,
  TRACE_RECONCILIATION_REASONS,
  TRACE_VERSION,
  profileTraceCapabilityDiagnostics,
  buildProjectedEvaluationEnvelope,
  createGraphSelectionTrace,
  assertTrustedProjectedSelection,
  evaluateProjectedEvaluationBinding,
  hasTrustedProjectedSelection,
  reconcileProjectedSelectionTrace,
  selectedContractNodes
};
