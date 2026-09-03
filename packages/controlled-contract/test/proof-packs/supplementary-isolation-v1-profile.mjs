import {
  POPULATION_IDS,
  populationMembers
} from "../../lib/supplementary-isolation-attempt-projection.mjs";
import { profileDigest } from "../support/stable-v1-proof-pack-runtime.mjs";
import { VOCABULARY_DIGESTS } from "../../vocabulary/controlled-contract-vocabulary.v1.mjs";

const PROFILE_ID = "proof.failure.supplementary-isolation";
const PROFILE_VERSION = "2.0.0";
const TRANSFORMER_ID = "supplementary-isolation-attempt-record.v1";
const GRAPH_PROJECTION_ID = "supplementary-isolation-contract";
const RESULT_REQUIREMENT_ID = "supplementary-isolation-projection";
const STAGE = "pre_dispatch";
const ATTEMPT_SCOPE = Object.freeze({ mode: "during", operand_roles: ["attempt"] });
const UNCONDITIONAL = Object.freeze({ mode: "unconditional", operand_roles: [] });
const MEMBER_TYPES = Object.freeze(["cc:artifact", "cc:entity", "cc:resource", "cc:state"]);
const COMPONENT_TYPES = Object.freeze(["cc:artifact", "cc:entity", "cc:resource"]);

function referenceRole(role, allowedTypeTerms, cardinality) {
  return { role, allowed_type_terms: allowedTypeTerms, cardinality };
}

function completePopulation(patternId, populationRole, memberRole, scope = ATTEMPT_SCOPE) {
  return { pattern_id: patternId, required_by_stage: STAGE, comparison: "complete_population",
    roles: [populationRole, memberRole], applicability_context: scope };
}

function proposition(subjectRole, operator, applicabilityContext, operands) {
  return { subject_role: subjectRole, operator, applicability_context: applicabilityContext, operands };
}

const refOperand = (role) => ({ kind: "reference", role });

function claim(patternId, subjectRole, operator, operands, {
  scope = ATTEMPT_SCOPE, forEach = null, kind = "evidence"
} = {}) {
  return {
    pattern_id: patternId,
    required_by_stage: STAGE,
    claim_kind: kind,
    allowed_modalities: ["MUST"],
    ...(forEach ? { for_each: forEach } : {}),
    proposition_template: proposition(subjectRole, operator, scope, operands)
  };
}

function universal(populationRole, memberRole, completePopulationPatternId) {
  return {
    population_role: populationRole,
    member_role: memberRole,
    complete_population_pattern_id: completePopulationPatternId,
    quantifier: "universal",
    empty_behavior: "vacuously_satisfied"
  };
}

const populationDefinitions = Object.freeze([
  ["attempt_occurrence_population", "attempt_occurrences", "attempt-occurrences", ATTEMPT_SCOPE],
  ["core_member_population", "core_members", "core-members", ATTEMPT_SCOPE],
  ["attempt_core_settlement_population", "attempt_core_settlements", "core-settlements", ATTEMPT_SCOPE],
  ["core_valid_state_population", "core_valid_states", "core-valid-states", UNCONDITIONAL],
  ["declared_supplementary_component_population", "declared_supplementary_components",
    "declared-supplementary-components", UNCONDITIONAL],
  ["disclosed_omission_population", "disclosed_omissions", "disclosed-omissions", ATTEMPT_SCOPE],
  ["disclosed_reason_population", "disclosed_reasons", "disclosed-reasons", ATTEMPT_SCOPE],
  ["failure_reason_population", "failure_reasons", "failure-reasons", ATTEMPT_SCOPE],
  ["final_core_member_population", "final_core_members", "final-core-members", ATTEMPT_SCOPE],
  ["attempt_final_result_population", "attempt_final_results", "final-result-events", ATTEMPT_SCOPE],
  ["final_result_member_population", "final_result_members", "final-result-members", ATTEMPT_SCOPE],
  ["attempt_supplementary_failure_population", "attempt_supplementary_failures",
    "supplementary-failures", ATTEMPT_SCOPE],
  ["supplementary_result_population", "supplementary_results", "supplementary-results", ATTEMPT_SCOPE],
  ["unavailable_state_population", "unavailable_states", "unavailable-states", UNCONDITIONAL]
]);

const countDefinitions = Object.freeze([
  ["attempt_core_settlement_count", "attempt_core_settlements", 1, 1, null],
  ["attempt_supplementary_failure_count", "attempt_supplementary_failures", 1, 1, null],
  ["attempt_final_result_count", "attempt_final_results", 1, 1, null],
  ["core_member_count", "core_members", 1, null, "core_member_count_signal"],
  ["final_core_member_count", "final_core_members", 1, null, "final_core_member_count_signal"],
  ["final_result_member_count", "final_result_members", 1, null, "final_result_member_count_signal"],
  ["failure_reason_count", "failure_reasons", 1, null, "failure_reason_count_signal"],
  ["disclosed_reason_count", "disclosed_reasons", 1, 1, "disclosed_reason_count_signal"],
  ["supplementary_result_count", "supplementary_results", 0, 0, "supplementary_result_count_signal"]
]);

function buildSupplementaryIsolationProfile() {
  const referenceRoles = [
    referenceRole("operation", ["cc:operation"], "exactly_one"),
    referenceRole("attempt", ["cc:process"], "exactly_one"),
    referenceRole("attempt_start_event", ["cc:event"], "exactly_one"),
    referenceRole("core_computation", ["cc:process"], "exactly_one"),
    referenceRole("supplementary_computation", ["cc:process"], "exactly_one"),
    referenceRole("core_result", ["cc:artifact"], "exactly_one"),
    referenceRole("core_settlement_event", ["cc:event"], "exactly_one"),
    referenceRole("core_settled_state", ["cc:state"], "exactly_one"),
    referenceRole("core_settled_value", ["cc:state"], "exactly_one"),
    referenceRole("settlement_observation", ["cc:evidence"], "exactly_one"),
    referenceRole("supplementary_component", COMPONENT_TYPES, "exactly_one"),
    referenceRole("supplementary_failure_event", ["cc:event"], "exactly_one"),
    referenceRole("supplementary_failure_reason", ["cc:state"], "exactly_one"),
    referenceRole("supplementary_unavailable_state", ["cc:state"], "exactly_one"),
    referenceRole("final_result", ["cc:artifact"], "exactly_one"),
    referenceRole("final_result_event", ["cc:event"], "exactly_one"),
    referenceRole("final_core_portion", ["cc:artifact"], "exactly_one"),
    referenceRole("final_core_state", ["cc:state"], "exactly_one"),
    referenceRole("final_core_value", ["cc:state"], "exactly_one"),
    referenceRole("final_observation", ["cc:evidence"], "exactly_one"),
    referenceRole("verification", ["cc:test"], "exactly_one"),
    referenceRole("projection_result", ["cc:artifact"], "exactly_one"),
    referenceRole("attempt_record_capture", ["cc:artifact"], "exactly_one"),
    referenceRole("core_settlement_record_capture", ["cc:artifact"], "exactly_one"),
    referenceRole("final_result_record_capture", ["cc:artifact"], "exactly_one"),
    referenceRole("supplementary_failure_record_capture", ["cc:artifact"], "exactly_one"),
    ...populationDefinitions.flatMap(([populationRole, memberRole]) => [
      referenceRole(populationRole, ["cc:population"],
        populationRole === "disclosed_omission_population" ? "zero_or_more" : "exactly_one"),
      referenceRole(memberRole,
        memberRole.includes("settlements") || memberRole.includes("failures") ||
          memberRole.includes("final_results") ? ["cc:event"] :
          memberRole.includes("reasons") || memberRole.includes("states") ? ["cc:state"] :
          memberRole.includes("components") || memberRole.includes("omissions") ? COMPONENT_TYPES :
          memberRole === "supplementary_results" ? ["cc:artifact"] :
          memberRole === "attempt_occurrences" ? [...MEMBER_TYPES, "cc:event", "cc:evidence"] : MEMBER_TYPES,
        ["core_members", "final_core_members", "final_result_members", "failure_reasons",
          "core_valid_states", "declared_supplementary_components", "unavailable_states",
          ].includes(memberRole) ? "one_or_more" : "zero_or_more")
    ]),
    ...countDefinitions.filter(([, , , , signalRole]) => signalRole).map(([, , , , signalRole]) =>
      referenceRole(signalRole, ["cc:evidence"], "exactly_one"))
  ];
  const referenceBindingPatterns = populationDefinitions.map(
    ([populationRole, memberRole, populationName, applicability]) => completePopulation(
      `complete-${populationName}`, populationRole, memberRole, applicability
    )
  );
  const countClaims = countDefinitions.filter(([, , , , signalRole]) => signalRole).map(
    ([numberRole, , , , signalRole]) => claim(
      `${numberRole.replaceAll("_", "-")}-is-captured`, signalRole, "number:equals",
      [{ kind: "number", value_role: numberRole }]
    )
  );
  const claimPatterns = [
    claim("attempt-performs-operation", "attempt", "reference:performs", [refOperand("operation")]),
    claim("attempt-record-capture-exists", "attempt_record_capture", "boolean:exists",
      [{ kind: "boolean", value: true }]),
    claim("core-settlement-record-capture-exists", "core_settlement_record_capture", "boolean:exists",
      [{ kind: "boolean", value: true }]),
    claim("final-result-record-capture-exists", "final_result_record_capture", "boolean:exists",
      [{ kind: "boolean", value: true }]),
    claim("supplementary-failure-record-capture-exists", "supplementary_failure_record_capture",
      "boolean:exists", [{ kind: "boolean", value: true }]),
    claim("attempt-starts", "attempt_start_event", "reference:starts", [refOperand("attempt")]),
    claim("attempt-performs-computations", "attempt", "reference:performs", [
      refOperand("core_computation"), refOperand("supplementary_computation")
    ]),
    claim("attempt-start-precedes-settlement", "attempt_start_event", "reference:precedes",
      [refOperand("core_settlement_event")]),
    claim("settlement-precedes-failure", "core_settlement_event", "reference:precedes",
      [refOperand("supplementary_failure_event")]),
    claim("failure-precedes-final", "supplementary_failure_event", "reference:precedes",
      [refOperand("final_result_event")]),
    claim("core-computation-returns-result", "core_computation", "reference:returns",
      [refOperand("core_result")]),
    claim("core-computation-emits-settlement", "core_computation", "reference:emits",
      [refOperand("core_settlement_event")]),
    claim("core-result-has-state", "core_result", "reference:has_state",
      [refOperand("core_settled_state")]),
    claim("core-state-resolves-to-value", "core_settled_state", "reference:resolves_to",
      [refOperand("core_settled_value")]),
    claim("settlement-observation-records", "settlement_observation", "reference:records", [
      refOperand("core_result"), refOperand("core_settled_state"), refOperand("core_member_population")
    ]),
    claim("core-value-is-valid", "core_settled_value", "reference:member_of",
      [refOperand("core_valid_state_population")]),
    claim("supplementary-targets-component", "supplementary_computation", "reference:targets",
      [refOperand("supplementary_component")]),
    claim("supplementary-emits-failure", "supplementary_computation", "reference:emits",
      [refOperand("supplementary_failure_event")]),
    claim("failure-has-reason", "supplementary_failure_event", "reference:has_status",
      [refOperand("supplementary_failure_reason")]),
    claim("component-is-declared", "supplementary_component", "reference:member_of",
      [refOperand("declared_supplementary_component_population")]),
    claim("failure-reason-is-closed", "supplementary_failure_reason", "reference:member_of",
      [refOperand("failure_reason_population")]),
    claim("attempt-returns-final", "attempt", "reference:returns", [refOperand("final_result")]),
    claim("final-event-emits-result", "final_result_event", "reference:emits",
      [refOperand("final_result")]),
    claim("final-contains-core", "final_result", "reference:contains",
      [refOperand("final_core_portion")]),
    claim("final-core-portion-has-state", "final_core_portion", "reference:has_state",
      [refOperand("final_core_state")]),
    claim("final-core-state-resolves-to-value", "final_core_state", "reference:resolves_to",
      [refOperand("final_core_value")]),
    claim("final-observation-records", "final_observation", "reference:records", [
      refOperand("final_core_portion"), refOperand("final_core_state"),
      refOperand("final_core_member_population")
    ]),
    claim("final-discloses-exact-failure-reason", "final_result", "reference:has_status",
      [refOperand("supplementary_failure_reason")]),
    claim("failure-reason-is-disclosed", "supplementary_failure_reason", "reference:member_of",
      [refOperand("disclosed_reason_population")]),
    claim("core-members-forward", "core_member_population", "reference:subset_of",
      [refOperand("final_core_member_population")], { kind: "behavior" }),
    {
      ...claim("core-members-forward-verification", "verification", "reference:covers",
        [refOperand("core_member_population"), refOperand("final_core_member_population")],
        { kind: "verification" }),
      verification_methods: ["test_execution"],
      falsifying_proposition_template: proposition(
        "core_member_population", "reference:not_subset_of", ATTEMPT_SCOPE,
        [refOperand("final_core_member_population")]
      )
    },
    claim("core-members-reverse", "final_core_member_population", "reference:subset_of",
      [refOperand("core_member_population")]),
    claim("core-members-in-final", "core_member_population", "reference:subset_of",
      [refOperand("final_result_member_population")]),
    claim("each-attempt-occurrence-contained", "attempt_occurrence", "reference:contained_in",
      [refOperand("attempt")], { forEach: universal(
        "attempt_occurrences", "attempt_occurrence", "complete-attempt-occurrences"
      ) }),
    ...countClaims,
    claim("component-present", "supplementary_component", "reference:member_of",
      [refOperand("final_result_member_population")]),
    claim("component-unavailable", "supplementary_component", "reference:has_state",
      [refOperand("supplementary_unavailable_state")]),
    claim("component-omitted", "supplementary_component", "reference:not_member_of",
      [refOperand("final_result_member_population")]),
    claim("component-omission-disclosed", "supplementary_component", "reference:member_of",
      [refOperand("disclosed_omission_population")])
  ];
  const commonPatterns = [
    ...referenceBindingPatterns.filter(({ pattern_id: id }) => id !== "complete-disclosed-omissions")
      .map(({ pattern_id: pattern }) => ({ pattern })),
    ...claimPatterns.filter(({ pattern_id: id }) => ![
      "component-present", "component-unavailable", "component-omitted",
      "component-omission-disclosed"
    ].includes(id)).map(({ pattern_id: pattern }) => ({ pattern }))
  ];
  commonPatterns.push({ pattern: "core-members-forward-verifies" });
  commonPatterns.push({
    any_of: [
      { all_of: [{ pattern: "component-present" }, { pattern: "component-unavailable" },
        { pattern: "present-disclosed-omission-population-forbidden" },
        { pattern: "present-disclosed-omissions-forbidden" }] },
      { all_of: [{ pattern: "component-omitted" }, { pattern: "component-omission-disclosed" },
        { pattern: "omitted-disclosed-omission-population-required" },
        { pattern: "omitted-disclosed-omissions-required" },
        { pattern: "complete-disclosed-omissions" }] }
    ],
    branch_cardinality: "exactly_one"
  });
  return {
    schema_version: "controlled-contract-verification-profile.v1",
    profile_id: PROFILE_ID,
    profile_version: PROFILE_VERSION,
    contract_schema_version: "controlled-acceptance-contract.v1",
    vocabulary_version: "controlled-contract-vocabulary.v1",
    vocabulary_signature_digest: VOCABULARY_DIGESTS.signature,
    vocabulary_algebra_digest: VOCABULARY_DIGESTS.algebra,
    vocabulary_definitions_digest: VOCABULARY_DIGESTS.definitions,
    vocabulary_complete_digest: VOCABULARY_DIGESTS.complete,
    verification_falsifier_policy: "controlled_complement_per_target",
    evaluation_stages: [STAGE],
    reference_roles: referenceRoles,
    number_roles: [
      ...countDefinitions.map(([role, , minimum, maximum]) => ({
        role, cardinality: "exactly_one", number_type: "integer", minimum,
        ...(maximum === null ? {} : { maximum })
      })),
    ],
    distinct_reference_role_sets: [
      { roles: ["attempt", "core_computation", "supplementary_computation"] },
      { roles: ["attempt_start_event", "core_settlement_event", "supplementary_failure_event",
        "final_result_event"] },
      { roles: ["core_settled_state", "final_core_state"] },
      { roles: ["core_result", "final_result", "supplementary_component"] }
    ],
    reference_binding_patterns: referenceBindingPatterns,
    reference_role_count_bindings: [
      ...countDefinitions.map(([referenceRole, memberRole]) => ({
        reference_role: memberRole, number_role: referenceRole
      }))
    ],
    binding_constraint_patterns: [
      { pattern_id: "present-disclosed-omission-population-forbidden", required_by_stage: STAGE,
        role_kind: "reference", role: "disclosed_omission_population", minimum: 0, maximum: 0 },
      { pattern_id: "present-disclosed-omissions-forbidden", required_by_stage: STAGE,
        role_kind: "reference", role: "disclosed_omissions", minimum: 0, maximum: 0 },
      { pattern_id: "omitted-disclosed-omission-population-required", required_by_stage: STAGE,
        role_kind: "reference", role: "disclosed_omission_population", minimum: 1, maximum: 1 },
      { pattern_id: "omitted-disclosed-omissions-required", required_by_stage: STAGE,
        role_kind: "reference", role: "disclosed_omissions", minimum: 1, maximum: 1 }
    ],
    claim_patterns: claimPatterns,
    relation_patterns: [{
      pattern_id: "core-members-forward-verifies", required_by_stage: STAGE, role: "verifies",
      source_claim_pattern_id: "core-members-forward-verification",
      target_claim_pattern_id: "core-members-forward"
    }],
    collection_patterns: [], resolver_fact_patterns: [], evidence_patterns: [],
    falsifier_condition_bindings: [{
      relation_pattern_id: "core-members-forward-verifies", applicability_context: ATTEMPT_SCOPE
    }],
    satisfaction_expression: { all_of: commonPatterns }
  };
}

function claimNumber(contract, propositionId) {
  const proposition = contract.propositions.find(({ proposition_id: id }) => id === propositionId);
  if (proposition?.operands?.[0]?.kind !== "number") throw new Error(
    `missing projected count ${propositionId}`
  );
  return proposition.operands[0].value;
}

function buildSupplementaryIsolationEvaluationInput(contract) {
  const roles = {
    operation: ["ref-operation"], attempt: ["ref-attempt"],
    attempt_start_event: ["ref-attempt-start"], core_computation: ["ref-core-computation"],
    supplementary_computation: ["ref-supplementary-computation"],
    core_result: ["ref-core-result"], core_settlement_event: populationMembers(contract, "core-settlements"),
    core_settled_state: ["ref-core-settled-state"], core_settled_value: ["ref-core-value"],
    settlement_observation: ["ref-settlement-observation"],
    supplementary_component: ["ref-supplementary-component"],
    supplementary_failure_event: populationMembers(contract, "supplementary-failures"),
    supplementary_failure_reason: ["ref-failure-reason-selected"],
    supplementary_unavailable_state: ["ref-unavailable"], final_result: ["ref-final-result"],
    final_result_event: populationMembers(contract, "final-result-events"),
    final_core_portion: ["ref-final-core-portion"], final_core_state: ["ref-final-core-state"],
    final_core_value: ["ref-core-value"], final_observation: ["ref-final-observation"],
    verification: ["ref-sfi-verification"], projection_result: ["ref-sfi-projection-result"],
    attempt_record_capture: ["ref-sfi-attempt-record-capture"],
    core_settlement_record_capture: ["ref-sfi-core-settlement-record-capture"],
    final_result_record_capture: ["ref-sfi-final-result-record-capture"],
    supplementary_failure_record_capture: ["ref-sfi-supplementary-failure-record-capture"],
    core_member_count_signal: ["ref-sfi-core-member-count-signal"],
    disclosed_reason_count_signal: ["ref-sfi-disclosed-reason-count-signal"],
    failure_reason_count_signal: ["ref-sfi-failure-reason-count-signal"],
    final_core_member_count_signal: ["ref-sfi-final-core-member-count-signal"],
    final_result_member_count_signal: ["ref-sfi-final-result-member-count-signal"],
    supplementary_result_count_signal: ["ref-sfi-supplementary-result-count-signal"]
  };
  for (const [populationRole, memberRole, populationName] of populationDefinitions) {
    const members = populationMembers(contract, populationName);
    if (populationRole !== "disclosed_omission_population" || members.length > 0) {
      roles[populationRole] = [POPULATION_IDS[populationName]];
      roles[memberRole] = members;
    }
  }
  const countValues = Object.fromEntries(countDefinitions.map(([numberRole, memberRole, , , signalRole]) => [
    numberRole,
    signalRole ? claimNumber(contract,
      `prop-sfi-${numberRole.replaceAll("_", "-")}-captured`) : roles[memberRole].length
  ]));
  return {
    input_version: "controlled-contract-verification-profile-input.v1",
    evaluation_stage: STAGE,
    reference_bindings: Object.entries(roles).map(([role, reference_ids]) => ({ role, reference_ids })),
    number_bindings: Object.entries(countValues).map(([role, value]) => ({ role, value })),
    claim_pattern_bindings: [], resolver_facts: [], delivered_evidence: [], stable_evaluation: {}
  };
}

function coverage(role, id, population = false) {
  return { role, coverage: "exact", projection: population
    ? "projection_result_population" : "projection_result_reference",
  ...(population ? { population_id: id } : { projection_id: id }) };
}

function buildSupplementaryIsolationDeclaration(profile = buildSupplementaryIsolationProfile()) {
  const roleCoverages = [
    coverage("operation", "operation"), coverage("attempt", "attempt"),
    coverage("attempt_start_event", "attempt-start-event"),
    coverage("core_computation", "core-computation"),
    coverage("supplementary_computation", "supplementary-computation"),
    coverage("core_result", "core-result"), coverage("core_settlement_event", "core-settlement-event"),
    coverage("core_settled_state", "core-settled-state"),
    coverage("core_settled_value", "core-settled-value"),
    coverage("settlement_observation", "settlement-observation"),
    coverage("supplementary_component", "supplementary-component"),
    coverage("supplementary_failure_event", "supplementary-failure-event"),
    coverage("supplementary_failure_reason", "supplementary-failure-reason"),
    coverage("supplementary_unavailable_state", "unavailable-state"),
    coverage("final_result", "final-result"), coverage("final_result_event", "final-result-event"),
    coverage("final_core_portion", "final-core-portion"),
    coverage("final_core_state", "final-core-state"), coverage("final_core_value", "final-core-value"),
    coverage("final_observation", "final-observation"), coverage("verification", "verification"),
    coverage("attempt_record_capture", "attempt-record-capture"),
    coverage("core_settlement_record_capture", "core-settlement-record-capture"),
    coverage("final_result_record_capture", "final-result-record-capture"),
    coverage("supplementary_failure_record_capture", "supplementary-failure-record-capture"),
    ...countDefinitions.filter(([, , , , signalRole]) => signalRole).map(([, , , , signalRole]) =>
      coverage(signalRole, signalRole.replaceAll("_", "-"))),
    ...populationDefinitions.filter(([populationRole]) =>
      populationRole !== "disclosed_omission_population").flatMap(
      ([populationRole, memberRole, populationName]) => [
      coverage(populationRole, `${populationName}-population`),
      coverage(memberRole, populationName, true)
    ])
  ].sort((left, right) => left.role < right.role ? -1 : left.role > right.role ? 1 : 0);
  return {
    schema_version: "controlled-contract-exact-binding-declaration.v1",
    profile_id: PROFILE_ID, profile_version: PROFILE_VERSION,
    profile_digest: profileDigest(profile),
    projected_evaluation_binding: {
      binding_version: "controlled-contract-projected-evaluation-binding.v1",
      result_requirement_id: RESULT_REQUIREMENT_ID,
      graph_projection_id: GRAPH_PROJECTION_ID
    },
    requirements: [
      { requirement_id: "attempt-record", binding_kind: "artifact_bytes",
        role_coverage: [{ role: "attempt_record_capture", coverage: "exact", projection: "artifact_subject" }] },
      { requirement_id: "core-settlement-record", binding_kind: "artifact_bytes",
        role_coverage: [{ role: "core_settlement_record_capture", coverage: "exact",
          projection: "artifact_subject" }] },
      { requirement_id: "final-result-record", binding_kind: "artifact_bytes",
        role_coverage: [{ role: "final_result_record_capture", coverage: "exact",
          projection: "artifact_subject" }] },
      { requirement_id: "supplementary-failure-record", binding_kind: "artifact_bytes",
        role_coverage: [{ role: "supplementary_failure_record_capture", coverage: "exact",
          projection: "artifact_subject" }] },
      { requirement_id: RESULT_REQUIREMENT_ID, binding_kind: "artifact_bytes",
        role_coverage: [{ role: "projection_result", coverage: "exact", projection: "artifact_subject" },
          ...roleCoverages].sort((left, right) => left.role < right.role ? -1 : 1) }
    ].sort((left, right) => left.requirement_id < right.requirement_id ? -1 : 1),
    relations: [{
      relation_id: "derive-supplementary-isolation-attempt",
      operator: "deterministic_projection", transformer_id: TRANSFORMER_ID,
      source_requirement_ids: [
        "attempt-record", "core-settlement-record", "final-result-record",
        "supplementary-failure-record"
      ],
      result_requirement_id: RESULT_REQUIREMENT_ID
    }]
  };
}

export {
  GRAPH_PROJECTION_ID, PROFILE_ID, PROFILE_VERSION, RESULT_REQUIREMENT_ID, TRANSFORMER_ID,
  buildSupplementaryIsolationDeclaration, buildSupplementaryIsolationEvaluationInput,
  buildSupplementaryIsolationProfile
};
