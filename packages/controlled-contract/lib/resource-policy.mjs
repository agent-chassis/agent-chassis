const resourceLimit = (limit, unit, countPoint, diagnosticCode, blockedStage = null) =>
  Object.freeze({
    limit,
    unit,
    count_point: countPoint,
    diagnostic_code: diagnosticCode,
    ...(blockedStage === null ? {} : { blocked_stage: blockedStage })
  });

const policyLimit = (limit, unit, countPoint, diagnosticCode) => Object.freeze({
  limit,
  unit,
  count_point: countPoint,
  diagnostic_code: diagnosticCode,
  authority: "digest_bound_package_policy",
  failure_mode: "fail_closed_without_sampling_or_partial_success"
});

const RESOURCE_LIMITS = Object.freeze({
  verified_input_bytes: resourceLimit(67108864, "canonical_bytes",
    "after_complete_input_census_before_parse", "PA_INPUT_BYTES_LIMIT", "input_census"),
  successful_output_bytes: resourceLimit(67108864, "canonical_bytes",
    "complete_unit2_success_before_release", "PA_OUTPUT_BYTES_LIMIT", "serialization"),
  resolved_nodes: resourceLimit(200000, "resolved_nodes",
    "after_typed_extraction_before_anonymization", "PA_NODE_LIMIT", "graph_construction"),
  binary_edges: resourceLimit(1000000, "binary_edges",
    "after_typed_extraction_before_anonymization", "PA_EDGE_LIMIT", "graph_construction"),
  incidence_participants: resourceLimit(2000000, "typed_incidence_participants",
    "after_nary_expansion_before_unit3_normalization", "PA_INCIDENCE_LIMIT",
    "graph_construction"),
  universal_occurrences: resourceLimit(1000000, "universal_occurrences",
    "after_lossless_population_expansion", "PA_UNIVERSAL_OCCURRENCE_LIMIT",
    "graph_construction"),
  selected_packs: resourceLimit(1024, "selected_pack_instances",
    "after_exact_pack_census_before_pack_loading", "PA_PACK_LIMIT", "input_census")
});

const POLICY_RESOURCE_LIMITS = Object.freeze({
  verified_input_bytes: policyLimit(67108864, "canonical_bytes",
    "after_complete_input_census_before_parse", "PA_INPUT_BYTES_LIMIT"),
  successful_output_bytes: policyLimit(67108864, "canonical_bytes",
    "complete_success_result_before_release", "PA_OUTPUT_BYTES_LIMIT"),
  resolved_nodes: policyLimit(200000, "resolved_nodes",
    "after_typed_extraction_before_anonymization", "PA_NODE_LIMIT"),
  binary_edges: policyLimit(1000000, "binary_edges",
    "after_typed_extraction_before_anonymization", "PA_EDGE_LIMIT"),
  nary_incidences: policyLimit(2000000, "typed_incidence_participants",
    "after_nary_expansion_before_normalization", "PA_INCIDENCE_LIMIT"),
  candidate_pairs: policyLimit(2000000, "merge_candidate_pairs",
    "after_sparse_candidate_generation_before_ranking", "PA_CANDIDATE_PAIR_LIMIT"),
  universal_occurrences: policyLimit(1000000, "universal_occurrences",
    "after_lossless_population_expansion", "PA_UNIVERSAL_OCCURRENCE_LIMIT"),
  canonicalization_states: policyLimit(1000000, "canonicalization_search_states",
    "before_each_individualization_state_expansion", "PA_CANONICALIZATION_STATE_LIMIT"),
  selected_packs: policyLimit(1024, "selected_pack_instances",
    "after_exact_pack_census_before_pack_loading", "PA_PACK_LIMIT"),
  tied_candidates: policyLimit(65536, "tied_topology_candidates",
    "before_adding_each_complete_equal_cost_candidate", "PA_TIED_CANDIDATE_LIMIT")
});

export { POLICY_RESOURCE_LIMITS, RESOURCE_LIMITS };
