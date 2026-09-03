import {
  POPULATION_IDS
} from "../../lib/sound-negative-observation-projection.mjs";
import {
  profileDigest
} from "../support/stable-v1-proof-pack-runtime.mjs";
import {
  VOCABULARY_DIGESTS
} from "../../vocabulary/controlled-contract-vocabulary.v1.mjs";

const PROFILE_ID = "proof.observation.sound-negative";
const PROFILE_VERSION = "2.0.0";
const TRANSFORMER_ID = "sound-negative-observation-capture.v1";
const GRAPH_PROJECTION_ID = "observation-contract";
const RESULT_REQUIREMENT_ID = "observation-projection";
const STAGE = "post_delivery";
const ATTEMPT_SCOPE = Object.freeze({
  mode: "during", operand_roles: ["observation_attempt"]
});
const UNCONDITIONAL = Object.freeze({ mode: "unconditional", operand_roles: [] });
const SOURCE_TYPES = Object.freeze([
  "cc:actor", "cc:entity", "cc:process", "cc:resource", "cc:runtime_component"
]);
const TARGET_TYPES = Object.freeze([
  "cc:artifact", "cc:configuration", "cc:entity", "cc:event", "cc:resource", "cc:state"
]);

function referenceRole(role, allowedTypeTerms, cardinality) {
  return { role, allowed_type_terms: allowedTypeTerms, cardinality };
}

function completePopulation(patternId, populationRole, memberRole) {
  return {
    pattern_id: patternId,
    required_by_stage: STAGE,
    comparison: "complete_population",
    roles: [populationRole, memberRole],
    applicability_context: ATTEMPT_SCOPE
  };
}

function requiredBinding(role, maximum = null) {
  return {
    pattern_id: `${role.replaceAll("_", "-")}-binding-required`,
    required_by_stage: STAGE,
    role_kind: "reference",
    role,
    minimum: 0,
    ...(maximum === null ? {} : { maximum }),
    binding_presence: "required"
  };
}

function universal(populationRole, memberRole, completePatternId, associations = []) {
  return {
    population_role: populationRole,
    member_role: memberRole,
    complete_population_pattern_id: completePatternId,
    quantifier: "universal",
    empty_behavior: "vacuously_satisfied",
    ...(associations.length === 0 ? {} : { association_bindings: associations })
  };
}

function association({
  role, operator, completePatternId, scope = ATTEMPT_SCOPE,
  memberPosition = "subject", associatedPosition = "reference_operand"
}) {
  return {
    associated_role: role,
    operator,
    member_position: memberPosition,
    associated_position: associatedPosition,
    applicability_context: scope,
    complete_population_pattern_id: completePatternId
  };
}

function claim(patternId, kind, propositionTemplate, forEach = null) {
  return {
    pattern_id: patternId,
    required_by_stage: STAGE,
    claim_kind: kind,
    allowed_modalities: ["MUST"],
    ...(forEach === null ? {} : { for_each: forEach }),
    proposition_template: propositionTemplate
  };
}

function proposition(subjectRole, operator, applicabilityContext, operands) {
  return {
    subject_role: subjectRole,
    operator,
    applicability_context: applicabilityContext,
    operands
  };
}

const refOperand = (role) => ({ kind: "reference", role });

function verifiedObligation({
  id, forEach, subjectRole, operator, scope, operands, reads, complement, joins,
  applicabilityJoin = "exact_scope"
}) {
  const verificationId = `verify-${id}`;
  const relationId = `verification-targets-${id}`;
  const targetTemplate = proposition(subjectRole, operator, scope, operands);
  const falsifierTemplate = proposition(subjectRole, complement, scope, operands);
  return {
    claims: [
      claim(id, "behavior", targetTemplate, forEach),
      {
        ...claim(verificationId, "verification", proposition(
          "verification", "reference:reads", scope, reads.map(refOperand)
        ), forEach),
        verification_methods: ["test_execution"],
        falsifying_proposition_template: falsifierTemplate
      }
    ],
    relation: {
      pattern_id: relationId,
      required_by_stage: STAGE,
      role: "verifies",
      source_claim_pattern_id: verificationId,
      target_claim_pattern_id: id
    },
    condition: { relation_pattern_id: relationId, applicability_context: scope },
    occurrence: {
      relation_pattern_id: relationId,
      reference_role_joins: joins,
      number_role_joins: [],
      applicability_join: applicabilityJoin
    }
  };
}

function positionJoin(role, targetPositions, verificationPositions, falsifierPositions) {
  return {
    role,
    target_positions: targetPositions,
    verification_positions: verificationPositions,
    falsifier_positions: falsifierPositions
  };
}

const populationDefinitions = Object.freeze([
  ["declared_source_population", "declared_sources", "declared-sources"],
  ["observed_source_population", "observed_sources", "observed-sources"],
  ["source_outcome_population", "source_outcomes", "source-outcomes"],
  ["endpoint_population", "endpoint_pairs", "endpoint-pairs"],
  ["raw_observation_population", "raw_observations", "raw-observations"],
  ["valid_observation_population", "valid_observations", "valid-observations"],
  ["observation_position_population", "observation_positions", "observation-positions"],
  ["resolved_target_population", "resolved_targets", "resolved-targets"],
  ["assigned_source_population", "assigned_sources", "assigned-sources"],
  ["invalidating_condition_population", "invalidating_conditions", "invalidating-conditions"],
  ["absent_conclusion_population", "absent_conclusion", "absent-conclusion"]
]);

function buildSoundNegativeObservationProfile() {
  const referenceRoles = [
    referenceRole("target", TARGET_TYPES, "exactly_one"),
    referenceRole("observation_attempt", ["cc:event", "cc:process"], "exactly_one"),
    referenceRole("interval_start", ["cc:event", "cc:state"], "exactly_one"),
    referenceRole("interval_end", ["cc:event", "cc:state"], "exactly_one"),
    referenceRole("verification", ["cc:test", "cc:process"], "exactly_one"),
    referenceRole("observation_evidence_capture", ["cc:artifact"], "exactly_one"),
    referenceRole("observation_capture_proof", ["cc:artifact"], "exactly_one"),
    referenceRole("projection_result", ["cc:artifact"], "exactly_one"),
    referenceRole("declared_source_population", ["cc:population"], "exactly_one"),
    referenceRole("declared_sources", SOURCE_TYPES, "zero_or_more"),
    referenceRole("observed_source_population", ["cc:population"], "exactly_one"),
    referenceRole("observed_sources", SOURCE_TYPES, "zero_or_more"),
    referenceRole("source_outcome_population", ["cc:population"], "exactly_one"),
    referenceRole("source_outcomes", ["cc:evidence_occurrence"], "zero_or_more"),
    referenceRole("endpoint_population", ["cc:population"], "exactly_one"),
    referenceRole("endpoint_pairs", ["cc:state"], "zero_or_more"),
    referenceRole("stable_endpoint_state", ["cc:state"], "exactly_one"),
    referenceRole("raw_observation_population", ["cc:population"], "exactly_one"),
    referenceRole("raw_observations", ["cc:evidence_occurrence"], "zero_or_more"),
    referenceRole("valid_observation_population", ["cc:population"], "exactly_one"),
    referenceRole("valid_observations", ["cc:evidence_occurrence"], "zero_or_more"),
    referenceRole("observation_position_population", ["cc:population"], "exactly_one"),
    referenceRole("observation_positions", ["cc:event"], "zero_or_more"),
    referenceRole("resolved_target_population", ["cc:population"], "exactly_one"),
    referenceRole("resolved_targets", TARGET_TYPES, "zero_or_more"),
    referenceRole("assigned_source_population", ["cc:population"], "exactly_one"),
    referenceRole("assigned_sources", SOURCE_TYPES, "zero_or_more"),
    referenceRole("invalidating_condition_population", ["cc:population"], "exactly_one"),
    referenceRole("invalidating_conditions", ["cc:state"], "zero_or_more"),
    referenceRole("absent_conclusion_population", ["cc:population"], "exactly_one"),
    referenceRole("absent_conclusion", ["cc:state"], "exactly_one"),
    referenceRole("source_count_signal", ["cc:evidence"], "exactly_one"),
    referenceRole("observation_count_signal", ["cc:evidence"], "exactly_one")
  ];
  const referenceBindingPatterns = populationDefinitions.map(
    ([populationRole, memberRole]) => completePopulation(
      `complete-${memberRole.replaceAll("_", "-")}`, populationRole, memberRole
    )
  );
  const bindingConstraintPatterns = [
    ...populationDefinitions.filter(([, memberRole]) =>
      memberRole !== "absent_conclusion").map(([, memberRole]) => requiredBinding(
      memberRole, memberRole === "invalidating_conditions" ? 0 : null
    ))
  ];
  const assocTarget = association({
    role: "resolved_targets", operator: "reference:authenticates",
    completePatternId: "complete-resolved-targets"
  });
  const assocSource = association({
    role: "assigned_sources", operator: "reference:originates_from",
    completePatternId: "complete-assigned-sources"
  });
  const assocPosition = association({
    role: "observation_positions", operator: "reference:depends_on",
    completePatternId: "complete-observation-positions"
  });
  const validIteration = (associations = []) => universal(
    "valid_observations", "observation", "complete-valid-observations", associations
  );
  const verified = [
    verifiedObligation({
      id: "each-valid-observation-authenticates-its-resolved-target",
      forEach: validIteration([assocTarget]),
      subjectRole: "observation", operator: "reference:authenticates",
      scope: ATTEMPT_SCOPE, operands: [refOperand("resolved_targets")],
      reads: ["projection_result", "observation", "resolved_targets"],
      complement: "reference:does_not_authenticate",
      joins: [
        positionJoin("observation", ["subject"], ["reference_operand"], ["subject"]),
        positionJoin("resolved_targets", ["reference_operand"], ["reference_operand"],
          ["reference_operand"])
      ]
    }),
    verifiedObligation({
      id: "each-valid-observation-originates-from-its-assigned-source",
      forEach: validIteration([assocSource]),
      subjectRole: "observation", operator: "reference:originates_from",
      scope: ATTEMPT_SCOPE, operands: [refOperand("assigned_sources")],
      reads: ["projection_result", "observation", "assigned_sources"],
      complement: "reference:does_not_originate_from",
      joins: [
        positionJoin("observation", ["subject"], ["reference_operand"], ["subject"]),
        positionJoin("assigned_sources", ["reference_operand"], ["reference_operand"],
          ["reference_operand"])
      ]
    }),
    verifiedObligation({
      id: "each-valid-observation-target-has-assigned-source-of-record",
      forEach: validIteration([assocTarget, assocSource]),
      subjectRole: "resolved_targets", operator: "reference:has_source_of_record",
      scope: ATTEMPT_SCOPE, operands: [refOperand("assigned_sources")],
      reads: ["projection_result", "resolved_targets", "assigned_sources"],
      complement: "reference:does_not_have_source_of_record",
      joins: [
        positionJoin("resolved_targets", ["subject"], ["reference_operand"], ["subject"]),
        positionJoin("assigned_sources", ["reference_operand"], ["reference_operand"],
          ["reference_operand"])
      ]
    }),
    verifiedObligation({
      id: "each-valid-observation-is-from-the-captured-attempt",
      forEach: validIteration(),
      subjectRole: "observation", operator: "reference:observed_in",
      scope: UNCONDITIONAL, operands: [refOperand("observation_attempt")],
      reads: ["projection_result", "observation", "observation_attempt"],
      complement: "reference:not_observed_in",
      joins: [
        positionJoin("observation", ["subject"], ["reference_operand"], ["subject"]),
        positionJoin("observation_attempt", ["reference_operand"], ["reference_operand"],
          ["reference_operand"])
      ]
    }),
    verifiedObligation({
      id: "each-valid-observation-is-at-its-position-in-the-captured-interval",
      forEach: validIteration([assocPosition]),
      subjectRole: "observation", operator: "reference:member_of",
      scope: {
        mode: "during",
        operand_roles: [
          "observation_attempt", "interval_start", "interval_end", "observation_positions"
        ]
      },
      operands: [refOperand("valid_observation_population")],
      reads: ["projection_result", "observation", "valid_observation_population"],
      complement: "reference:not_member_of",
      joins: [
        positionJoin("observation", ["subject"], ["reference_operand"], ["subject"]),
        positionJoin("valid_observation_population", ["reference_operand"],
          ["reference_operand"], ["reference_operand"]),
        positionJoin("observation_attempt", ["applicability_operand"],
          ["applicability_operand"], ["applicability_operand"]),
        positionJoin("interval_start", ["applicability_operand"],
          ["applicability_operand"], ["applicability_operand"]),
        positionJoin("interval_end", ["applicability_operand"],
          ["applicability_operand"], ["applicability_operand"]),
        positionJoin("observation_positions", ["applicability_operand"],
          ["applicability_operand"], ["applicability_operand"])
      ],
      applicabilityJoin: "shared_operands"
    }),
    verifiedObligation({
      id: "each-valid-observation-does-not-match-the-selected-target",
      forEach: validIteration([assocTarget]),
      subjectRole: "resolved_targets", operator: "reference:not_equals",
      scope: ATTEMPT_SCOPE, operands: [refOperand("target")],
      reads: ["projection_result", "resolved_targets", "target"],
      complement: "reference:equals",
      joins: [
        positionJoin("resolved_targets", ["subject"], ["reference_operand"], ["subject"]),
        positionJoin("target", ["reference_operand"], ["reference_operand"],
          ["reference_operand"]),
        positionJoin("observation_attempt", ["applicability_operand"],
          ["applicability_operand"], ["applicability_operand"])
      ],
      applicabilityJoin: "shared_operands"
    })
  ];
  const claimPatterns = [
    claim("observation-evidence-capture-exists", "evidence", proposition(
      "observation_evidence_capture", "boolean:exists", ATTEMPT_SCOPE,
      [{ kind: "boolean", value: true }]
    )),
    claim("observation-capture-proof-exists", "evidence", proposition(
      "observation_capture_proof", "boolean:exists", ATTEMPT_SCOPE,
      [{ kind: "boolean", value: true }]
    )),
    ...verified.flatMap(({ claims }) => claims),
    claim("each-valid-observation-is-grounded-to-its-position",
      "evidence", proposition(
        "observation", "reference:depends_on", ATTEMPT_SCOPE,
        [refOperand("observation_positions")]
      ), validIteration([assocPosition])),
    claim("each-raw-observation-resolves-to-one-valid-observation", "evidence", proposition(
      "raw_observation", "reference:resolves_to", ATTEMPT_SCOPE,
      [refOperand("valid_observations")]
    ), universal("raw_observations", "raw_observation", "complete-raw-observations", [
      association({
        role: "valid_observations", operator: "reference:resolves_to",
        completePatternId: "complete-valid-observations"
      })
    ])),
    claim("each-declared-source-is-observed", "evidence", proposition(
      "declared_source", "reference:member_of", ATTEMPT_SCOPE,
      [refOperand("observed_source_population")]
    ), universal("declared_sources", "declared_source", "complete-declared-sources")),
    claim("each-observed-source-is-declared", "evidence", proposition(
      "observed_source", "reference:member_of", ATTEMPT_SCOPE,
      [refOperand("declared_source_population")]
    ), universal("observed_sources", "observed_source", "complete-observed-sources")),
    claim("each-source-outcome-is-for-its-declared-source", "evidence", proposition(
      "source_outcome", "reference:depends_on", ATTEMPT_SCOPE,
      [refOperand("declared_sources")]
    ), universal("source_outcomes", "source_outcome", "complete-source-outcomes", [
      association({
        role: "declared_sources", operator: "reference:depends_on",
        completePatternId: "complete-declared-sources"
      })
    ])),
    claim("each-source-outcome-has-its-exact-endpoint-pair", "evidence", proposition(
      "source_outcome", "reference:has_state", ATTEMPT_SCOPE, [refOperand("endpoint_pairs")]
    ), universal("source_outcomes", "source_outcome", "complete-source-outcomes", [
      association({
        role: "endpoint_pairs", operator: "reference:has_state",
        completePatternId: "complete-endpoint-pairs"
      })
    ])),
    claim("each-endpoint-pair-is-stable", "evidence", proposition(
      "endpoint_pair", "reference:has_status", ATTEMPT_SCOPE,
      [refOperand("stable_endpoint_state")]
    ), universal("endpoint_pairs", "endpoint_pair", "complete-endpoint-pairs")),
    claim("declared-source-count-is-captured", "evidence", proposition(
      "source_count_signal", "number:equals", ATTEMPT_SCOPE,
      [{ kind: "number", value_role: "declared_source_count" }]
    )),
    claim("declared-observation-count-is-captured", "evidence", proposition(
      "observation_count_signal", "number:equals", ATTEMPT_SCOPE,
      [{ kind: "number", value_role: "declared_observation_count" }]
    )),
    claim("absent-conclusion-is-exact-projected", "evidence", proposition(
      "absent_conclusion", "reference:member_of", ATTEMPT_SCOPE,
      [refOperand("absent_conclusion_population")]
    ))
  ];
  const relationPatterns = verified.map(({ relation }) => relation);
  const satisfactionPatterns = [
    ...referenceBindingPatterns,
    ...bindingConstraintPatterns,
    ...claimPatterns,
    ...relationPatterns
  ].map(({ pattern_id: pattern }) => ({ pattern }));
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
      {
        role: "declared_source_count", cardinality: "exactly_one",
        number_type: "integer", minimum: 0
      },
      {
        role: "declared_observation_count", cardinality: "exactly_one",
        number_type: "integer", minimum: 0
      }
    ],
    distinct_reference_role_sets: [],
    reference_binding_patterns: referenceBindingPatterns,
    reference_role_count_bindings: [
      { reference_role: "declared_sources", number_role: "declared_source_count" },
      { reference_role: "observed_sources", number_role: "declared_source_count" },
      { reference_role: "source_outcomes", number_role: "declared_source_count" },
      { reference_role: "endpoint_pairs", number_role: "declared_source_count" },
      { reference_role: "raw_observations", number_role: "declared_observation_count" },
      { reference_role: "valid_observations", number_role: "declared_observation_count" },
      { reference_role: "observation_positions", number_role: "declared_observation_count" }
    ],
    binding_constraint_patterns: bindingConstraintPatterns,
    claim_patterns: claimPatterns,
    relation_patterns: relationPatterns,
    collection_patterns: [],
    resolver_fact_patterns: [],
    evidence_patterns: [],
    falsifier_condition_bindings: verified.map(({ condition }) => condition),
    falsifier_occurrence_bindings: verified.map(({ occurrence }) => occurrence),
    satisfaction_expression: { all_of: satisfactionPatterns }
  };
}

function populationMembers(contract, populationName) {
  const populationId = POPULATION_IDS[populationName];
  return contract.propositions.find(({ subject_reference_id: subject, operator }) =>
    subject === populationId && operator === "reference:contains"
  )?.operands.map(({ reference_id: referenceId }) => referenceId) ?? [];
}

function buildSoundNegativeObservationEvaluationInput(contract) {
  const roles = {
    target: populationMembers(contract, "selected-target"),
    observation_attempt: populationMembers(contract, "selected-attempt"),
    interval_start: populationMembers(contract, "selected-interval-start"),
    interval_end: populationMembers(contract, "selected-interval-end"),
    verification: ["ref-sno-verification"],
    observation_evidence_capture: ["ref-sno-observation-evidence-capture"],
    observation_capture_proof: ["ref-sno-observation-capture-proof"],
    projection_result: ["ref-sno-projection-result"],
    stable_endpoint_state: ["ref-sno-stable-endpoint-state"],
    source_count_signal: populationMembers(contract, "source-count-signal"),
    observation_count_signal: populationMembers(contract, "observation-count-signal")
  };
  for (const [populationRole, memberRole, populationName] of populationDefinitions) {
    roles[populationRole] = [POPULATION_IDS[populationName]];
    roles[memberRole] = populationMembers(contract, populationName);
  }
  return {
    input_version: "controlled-contract-verification-profile-input.v1",
    evaluation_stage: STAGE,
    reference_bindings: Object.entries(roles).map(([role, reference_ids]) => ({
      role, reference_ids
    })),
    number_bindings: [
      { role: "declared_source_count", value: roles.declared_sources.length },
      { role: "declared_observation_count", value: roles.raw_observations.length }
    ],
    claim_pattern_bindings: [],
    resolver_facts: [],
    delivered_evidence: [], stable_evaluation: {}
  };
}

function projectionCoverage(role, populationId, population = false) {
  return {
    role,
    coverage: "exact",
    projection: population ? "projection_result_population" : "projection_result_reference",
    ...(population ? { population_id: populationId } : { projection_id: populationId })
  };
}

function buildSoundNegativeObservationDeclaration(profile = buildSoundNegativeObservationProfile()) {
  const projectionCoverages = [
    projectionCoverage("target", "target"),
    projectionCoverage("observation_attempt", "observation-attempt"),
    projectionCoverage("interval_start", "interval-start"),
    projectionCoverage("interval_end", "interval-end"),
    projectionCoverage("verification", "verification"),
    projectionCoverage("stable_endpoint_state", "stable-endpoint-state"),
    projectionCoverage("source_count_signal", "source-count-signal", true),
    projectionCoverage("observation_count_signal", "observation-count-signal", true)
  ];
  for (const [populationRole, memberRole, populationName] of populationDefinitions) {
    projectionCoverages.push(
      projectionCoverage(populationRole, `${populationName}-population`),
      projectionCoverage(memberRole, populationName, true)
    );
  }
  return {
    schema_version: "controlled-contract-exact-binding-declaration.v1",
    profile_id: PROFILE_ID,
    profile_version: PROFILE_VERSION,
    profile_digest: profileDigest(profile),
    projected_evaluation_binding: {
      binding_version: "controlled-contract-projected-evaluation-binding.v1",
      result_requirement_id: RESULT_REQUIREMENT_ID,
      graph_projection_id: GRAPH_PROJECTION_ID
    },
    requirements: [
      {
        requirement_id: "observation-evidence",
        binding_kind: "artifact_bytes",
        role_coverage: [{
          role: "observation_evidence_capture", coverage: "exact",
          projection: "artifact_subject"
        }]
      },
      {
        requirement_id: "observation-capture-proof",
        binding_kind: "artifact_bytes",
        role_coverage: [{
          role: "observation_capture_proof", coverage: "exact",
          projection: "artifact_subject"
        }]
      },
      {
        requirement_id: RESULT_REQUIREMENT_ID,
        binding_kind: "artifact_bytes",
        role_coverage: [
          {
            role: "projection_result", coverage: "exact", projection: "artifact_subject"
          },
          ...projectionCoverages
        ].sort((left, right) => left.role < right.role ? -1 : left.role > right.role ? 1 : 0)
      }
    ].sort((left, right) => left.requirement_id < right.requirement_id ? -1 : 1),
    relations: [{
      relation_id: "derive-sound-negative-observation",
      operator: "deterministic_projection",
      transformer_id: TRANSFORMER_ID,
      source_requirement_ids: ["observation-capture-proof", "observation-evidence"],
      result_requirement_id: RESULT_REQUIREMENT_ID
    }]
  };
}

export {
  GRAPH_PROJECTION_ID,
  PROFILE_ID,
  PROFILE_VERSION,
  RESULT_REQUIREMENT_ID,
  TRANSFORMER_ID,
  buildSoundNegativeObservationDeclaration,
  buildSoundNegativeObservationEvaluationInput,
  buildSoundNegativeObservationProfile,
  populationMembers
};
