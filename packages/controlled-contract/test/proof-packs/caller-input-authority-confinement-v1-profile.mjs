import {
  POPULATION_IDS,
  PROHIBITED_FAMILIES,
  SINGLETON_IDS,
  TRANSFORMER_ID
} from "../../lib/caller-input-authority-confinement-projection.mjs";
import { profileDigest } from "../support/stable-v1-proof-pack-runtime.mjs";
import { sha256 } from "../../lib/exact-binding-common.mjs";
import { VOCABULARY_DIGESTS } from "../../vocabulary/controlled-contract-vocabulary.v1.mjs";

const PROFILE_ID = "proof.input.caller-authority-confinement";
const PROFILE_VERSION = "2.0.0";
const GRAPH_PROJECTION_ID = "caller-input-authority-contract";
const RESULT_REQUIREMENT_ID = "caller-input-projection";
const STAGE = "post_delivery";
const UNCONDITIONAL = Object.freeze({ mode: "unconditional", operand_roles: [] });
const MEMBER_TYPES = Object.freeze(["cc:configuration"]);
const COORDINATE_TYPES = Object.freeze([
  "cc:configuration", "cc:entity", "cc:resource", "cc:state"
]);
const OPERATION_TYPES = Object.freeze(["cc:operation", "cc:process", "cc:runtime_component"]);
const EFFECT_TYPES = Object.freeze([
  "cc:artifact", "cc:configuration", "cc:entity", "cc:event", "cc:resource", "cc:state"
]);
const SOURCE_TYPES = Object.freeze([
  "cc:actor", "cc:entity", "cc:process", "cc:resource", "cc:runtime_component"
]);

const populationDefinitions = Object.freeze([
  ["accepted_supply_pop", "accepted_members", "accepted-supplied-members",
    MEMBER_TYPES, 1],
  ["allowed_members_pop", "allowed_members", "allowed-members", MEMBER_TYPES, 1],
  ["authority_classes_pop", "authority_classes",
    "authority-classifications", ["cc:criterion"], 1],
  ["coordinate_classes_pop", "coordinate_classes",
    "coordinate-classifications", ["cc:criterion"], 1],
  ["declared_members_pop", "declared_members", "declared-members", MEMBER_TYPES, 1],
  ["forbidden_supply_pop", "forbidden_supply",
    "forbidden-supplied-members", MEMBER_TYPES, 1],
  ["forbidden_members_pop", "forbidden_members", "forbidden-members", MEMBER_TYPES, 1],
  ["family_classes_pop", "family_classes",
    "family-classifications", ["cc:criterion"], 1],
  ["mandatory_sources_pop", "mandatory_sources", "mandatory-sources", SOURCE_TYPES, 1],
  ["observed_sources_pop", "observed_sources", "observed-sources", SOURCE_TYPES, 1],
  ["pre_refusal_pop", "pre_cut_occurrences",
    "pre-refusal-occurrences", ["cc:evidence_occurrence"], 0],
  ["prohibited_families_pop", "prohibited_families", "prohibited-families",
    ["cc:criterion"], PROHIBITED_FAMILIES.length],
  ["protected_effects_pop", "protected_effects", "protected-effects", EFFECT_TYPES, 1],
  ["resolution_coordinates_pop", "resolution_coordinates", "resolution-coordinates",
    COORDINATE_TYPES, 1],
  ["resolver_operations_pop", "resolver_operations", "resolver-operations",
    OPERATION_TYPES, 1],
  ["selected_forbidden_pop", "selected_forbidden",
    "selected-forbidden-members", MEMBER_TYPES, 1],
  ["server_coordinates_pop", "server_coordinates",
    "server-selected-coordinates", COORDINATE_TYPES, 1]
]);

function shortPatternId(label) {
  return `p-${sha256(Buffer.from(label, "utf8")).slice(0, 8)}`;
}

function referenceRole(role, allowedTypeTerms, cardinality) {
  return { role, allowed_type_terms: allowedTypeTerms, cardinality };
}

function completePopulation(patternId, populationRole, memberRole, scope) {
  return {
    pattern_id: shortPatternId(patternId),
    required_by_stage: STAGE,
    comparison: "complete_population",
    roles: [populationRole, memberRole],
    applicability_context: scope
  };
}

function requiredBinding(role, minimum, maximum = null) {
  return {
    pattern_id: shortPatternId(`${role.replaceAll("_", "-")}-binding-required`),
    required_by_stage: STAGE,
    role_kind: "reference",
    role,
    minimum,
    ...(maximum === null ? {} : { maximum })
  };
}

function universal(populationRole, memberRole, completePatternId, associations = []) {
  return {
    population_role: populationRole,
    member_role: memberRole,
    complete_population_pattern_id: shortPatternId(completePatternId),
    quantifier: "universal",
    empty_behavior: "vacuously_satisfied",
    ...(associations.length === 0 ? {} : { association_bindings: associations })
  };
}

function association({
  role, operator, completePatternId, scope = UNCONDITIONAL,
  memberPosition = "subject", associatedPosition = "reference_operand", oneOrMore = false
}) {
  return {
    associated_role: role,
    operator,
    member_position: memberPosition,
    associated_position: associatedPosition,
    applicability_context: scope,
    complete_population_pattern_id: shortPatternId(completePatternId),
    ...(oneOrMore ? { associated_cardinality: "one_or_more" } : {})
  };
}

function claim(patternId, kind, propositionTemplate, forEach = null, modalities = ["MUST"]) {
  return {
    pattern_id: shortPatternId(patternId),
    required_by_stage: STAGE,
    claim_kind: kind,
    allowed_modalities: modalities,
    ...(forEach === null ? {} : { for_each: structuredClone(forEach) }),
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

function positionJoin(role, targetPositions, verificationPositions, falsifierPositions) {
  return {
    role,
    target_positions: targetPositions,
    verification_positions: verificationPositions,
    falsifier_positions: falsifierPositions
  };
}

function verifiedObligation({
  id, forEach = null, subjectRole, operator, complement, scope, operands,
  modality = "MUST", joins
}) {
  const verificationId = `verify-${id}`;
  const relationId = shortPatternId(`verification-targets-${id}`);
  const target = claim(
    id, "behavior", proposition(subjectRole, operator, scope, operands), forEach, [modality]
  );
  const verificationOperands = [
    refOperand("projection_result"), refOperand(subjectRole),
    ...operands.filter(({ kind }) => kind === "reference")
  ];
  const verification = {
    ...claim(verificationId, "verification", proposition(
      "verification", "reference:reads", scope, verificationOperands
    ), forEach),
    verification_methods: ["test_execution"],
    falsifying_proposition_template: proposition(subjectRole, complement, scope, operands)
  };
  return {
    claims: [target, verification],
    relation: {
      pattern_id: relationId,
      required_by_stage: STAGE,
      role: "verifies",
      source_claim_pattern_id: verification.pattern_id,
      target_claim_pattern_id: target.pattern_id
    },
    condition: { relation_pattern_id: relationId, applicability_context: scope },
    occurrence: {
      relation_pattern_id: relationId,
      reference_role_joins: joins,
      number_role_joins: [],
      applicability_join: "exact_scope"
    }
  };
}

function buildCallerInputAuthorityConfinementProfile() {
  const acceptedRequestScope = {
    mode: "during", operand_roles: ["accepted_request"]
  };
  const acceptedAttemptScope = {
    mode: "during", operand_roles: ["accepted_attempt"]
  };
  const forbiddenAttemptScope = {
    mode: "during", operand_roles: ["forbidden_attempt"]
  };
  const forbiddenAbsenceScope = {
    mode: "during", operand_roles: ["accepted_request", "authority_classes"]
  };
  const coordinateAbsenceScope = {
    mode: "during", operand_roles: ["accepted_request", "coordinate_classes"]
  };
  const familyAbsenceScope = {
    mode: "before", operand_roles: ["refusal", "family_classes"]
  };
  const referenceRoles = [
    referenceRole("acceptance", ["cc:event", "cc:state"], "exactly_one"),
    referenceRole("accepted_attempt", ["cc:event", "cc:process"], "exactly_one"),
    referenceRole("accepted_request", ["cc:artifact", "cc:event", "cc:resource"],
      "exactly_one"),
    referenceRole("accepted_request_capture", ["cc:artifact"], "exactly_one"),
    referenceRole("capture_proof", ["cc:artifact"], "exactly_one"),
    referenceRole("forbidden_attempt", ["cc:event", "cc:process"], "exactly_one"),
    referenceRole("forbidden_request", ["cc:artifact", "cc:event", "cc:resource"],
      "exactly_one"),
    referenceRole("forbidden_request_capture", ["cc:artifact"], "exactly_one"),
    referenceRole("interface", ["cc:entity"], "exactly_one"),
    referenceRole("observation_cut", ["cc:event", "cc:state"], "exactly_one"),
    referenceRole("observation_evidence_capture", ["cc:artifact"], "exactly_one"),
    referenceRole("parser", ["cc:process", "cc:runtime_component"], "exactly_one"),
    referenceRole("path_like_control", ["cc:evidence"], "exactly_one"),
    referenceRole("policy_capture", ["cc:artifact"], "exactly_one"),
    referenceRole("projection_result", ["cc:artifact"], "exactly_one"),
    referenceRole("refusal", ["cc:event", "cc:state"], "exactly_one"),
    referenceRole("verification", ["cc:test"], "exactly_one"),
    ...populationDefinitions.flatMap(([populationRole, memberRole, , types]) => [
      referenceRole(populationRole, ["cc:population"], "exactly_one"),
      referenceRole(memberRole, types, "zero_or_more")
    ])
  ];
  const populationScope = forbiddenAttemptScope;
  const referenceBindingPatterns = populationDefinitions.map(
    ([populationRole, memberRole]) => completePopulation(
      `complete-${memberRole.replaceAll("_", "-")}`,
      populationRole, memberRole, populationScope
    )
  );
  const bindingConstraintPatterns = populationDefinitions.map(([, memberRole, , , minimum]) =>
    requiredBinding(memberRole, minimum, memberRole === "pre_cut_occurrences" ? 0 : null));
  const forbiddenCoordinates = association({
    role: "resolution_coordinates",
    operator: "reference:targets",
    completePatternId: "complete-resolution-coordinates",
    oneOrMore: true
  });
  const coordinateOperations = association({
    role: "resolver_operations",
    operator: "reference:uses",
    completePatternId: "complete-resolver-operations",
    oneOrMore: true
  });
  const operationEffects = association({
    role: "protected_effects",
    operator: "reference:targets",
    completePatternId: "complete-protected-effects",
    oneOrMore: true
  });
  const familySources = association({
    role: "mandatory_sources",
    operator: "reference:covers",
    completePatternId: "complete-mandatory-sources",
    scope: forbiddenAttemptScope,
    memberPosition: "reference_operand",
    associatedPosition: "subject",
    oneOrMore: true
  });
  const authorityClassification = association({
    role: "authority_classes",
    operator: "reference:classifies_as",
    completePatternId: "complete-authority-classes"
  });
  const coordinateClassification = association({
    role: "coordinate_classes",
    operator: "reference:classifies_as",
    completePatternId: "complete-coordinate-classes"
  });
  const familyClassification = association({
    role: "family_classes",
    operator: "reference:classifies_as",
    completePatternId: "complete-family-classes"
  });
  const forbiddenIteration = universal(
    "forbidden_members", "forbidden_member", "complete-forbidden-members",
    [authorityClassification]
  );
  const coordinateIteration = universal(
    "resolution_coordinates", "resolution_coordinate", "complete-resolution-coordinates",
    [coordinateClassification]
  );
  const familyIteration = universal(
    "prohibited_families", "prohibited_family", "complete-prohibited-families",
    [familySources]
  );
  const familyVerifiedIteration = universal(
    "prohibited_families", "prohibited_family", "complete-prohibited-families",
    [familyClassification]
  );
  const verified = [
    verifiedObligation({
      id: "each-forbidden-member-is-absent-from-accepted-request",
      forEach: forbiddenIteration,
      subjectRole: "forbidden_member",
      operator: "reference:not_member_of",
      complement: "reference:member_of",
      scope: forbiddenAbsenceScope,
      operands: [refOperand("accepted_supply_pop")],
      joins: [
        positionJoin("forbidden_member", ["subject"], ["reference_operand"], ["subject"]),
        positionJoin("accepted_supply_pop", ["reference_operand"],
          ["reference_operand"], ["reference_operand"]),
        positionJoin("accepted_request", ["applicability_operand"],
          ["applicability_operand"], ["applicability_operand"]),
        positionJoin("authority_classes", ["applicability_operand"],
          ["applicability_operand"], ["applicability_operand"])
      ]
    }),
    verifiedObligation({
      id: "each-resolution-coordinate-is-absent-from-accepted-request",
      forEach: coordinateIteration,
      subjectRole: "resolution_coordinate",
      operator: "reference:not_member_of",
      complement: "reference:member_of",
      scope: coordinateAbsenceScope,
      operands: [refOperand("accepted_supply_pop")],
      joins: [
        positionJoin("resolution_coordinate", ["subject"], ["reference_operand"], ["subject"]),
        positionJoin("accepted_supply_pop", ["reference_operand"],
          ["reference_operand"], ["reference_operand"]),
        positionJoin("accepted_request", ["applicability_operand"],
          ["applicability_operand"], ["applicability_operand"]),
        positionJoin("coordinate_classes", ["applicability_operand"],
          ["applicability_operand"], ["applicability_operand"])
      ]
    }),
    verifiedObligation({
      id: "each-prohibited-family-is-absent-before-refusal",
      forEach: familyVerifiedIteration,
      subjectRole: "forbidden_attempt",
      operator: "reference:performs",
      complement: "reference:performs",
      modality: "MUST_NOT",
      scope: familyAbsenceScope,
      operands: [refOperand("prohibited_family")],
      joins: [
        positionJoin("forbidden_attempt", ["subject"], ["reference_operand"], ["subject"]),
        positionJoin("prohibited_family", ["reference_operand"],
          ["reference_operand"], ["reference_operand"]),
        positionJoin("refusal", ["applicability_operand"],
          ["applicability_operand"], ["applicability_operand"]),
        positionJoin("family_classes", ["applicability_operand"],
          ["applicability_operand"], ["applicability_operand"])
      ]
    })
  ];
  const claimPatterns = [
    claim("policy-authoritative-for-declared-members", "evidence", proposition(
      "policy_capture", "reference:authoritative_for", UNCONDITIONAL,
      [refOperand("declared_members_pop")]
    )),
    claim("policy-authoritative-for-allowed-members", "evidence", proposition(
      "policy_capture", "reference:authoritative_for", UNCONDITIONAL,
      [refOperand("allowed_members_pop")]
    )),
    claim("policy-authoritative-for-forbidden-members", "evidence", proposition(
      "policy_capture", "reference:authoritative_for", UNCONDITIONAL,
      [refOperand("forbidden_members_pop")]
    )),
    claim("accepted-request-capture-resolves-to-request", "evidence", proposition(
      "accepted_request_capture", "reference:resolves_to", UNCONDITIONAL,
      [refOperand("accepted_request")]
    )),
    claim("forbidden-request-capture-resolves-to-request", "evidence", proposition(
      "forbidden_request_capture", "reference:resolves_to", UNCONDITIONAL,
      [refOperand("forbidden_request")]
    )),
    claim("accepted-request-targets-interface", "evidence", proposition(
      "accepted_request", "reference:targets", UNCONDITIONAL, [refOperand("interface")]
    )),
    claim("forbidden-request-targets-interface", "evidence", proposition(
      "forbidden_request", "reference:targets", UNCONDITIONAL, [refOperand("interface")]
    )),
    claim("accepted-request-binds-attempt", "evidence", proposition(
      "accepted_request", "reference:depends_on", UNCONDITIONAL,
      [refOperand("accepted_attempt")]
    )),
    claim("forbidden-request-binds-attempt", "evidence", proposition(
      "forbidden_request", "reference:depends_on", UNCONDITIONAL,
      [refOperand("forbidden_attempt")]
    )),
    claim("accepted-parser-disposition-is-accepted", "evidence", proposition(
      "parser", "reference:accepts", acceptedAttemptScope, [refOperand("accepted_request")]
    )),
    claim("forbidden-parser-disposition-is-refused", "evidence", proposition(
      "refusal", "reference:rejects", forbiddenAttemptScope, [refOperand("forbidden_request")]
    )),
    claim("observation-cut-follows-refusal", "evidence", proposition(
      "observation_cut", "reference:follows", forbiddenAttemptScope, [refOperand("refusal")]
    )),
    claim("path-like-opaque-control-is-captured", "evidence", proposition(
      "path_like_control", "boolean:exists", acceptedRequestScope,
      [{ kind: "boolean", value: true }]
    )),
    claim("each-accepted-supplied-member-is-allowed", "evidence", proposition(
      "accepted_supplied_member", "reference:member_of", acceptedRequestScope,
      [refOperand("allowed_members_pop")]
    ), universal("accepted_members", "accepted_supplied_member",
      "complete-accepted-members")),
    claim("each-allowed-member-is-declared", "evidence", proposition(
      "allowed_member", "reference:member_of", UNCONDITIONAL,
      [refOperand("declared_members_pop")]
    ), universal("allowed_members", "allowed_member", "complete-allowed-members")),
    claim("each-forbidden-member-is-declared", "evidence", proposition(
      "forbidden_member", "reference:member_of", UNCONDITIONAL,
      [refOperand("declared_members_pop")]
    ), universal("forbidden_members", "forbidden_member", "complete-forbidden-members")),
    claim("each-selected-forbidden-member-is-forbidden", "evidence", proposition(
      "selected_forbidden_member", "reference:member_of", forbiddenAttemptScope,
      [refOperand("forbidden_members_pop")]
    ), universal("selected_forbidden", "selected_forbidden_member",
      "complete-selected-forbidden")),
    claim("each-selected-forbidden-member-is-supplied", "evidence", proposition(
      "selected_forbidden_member", "reference:member_of", forbiddenAttemptScope,
      [refOperand("forbidden_supply_pop")]
    ), universal("selected_forbidden", "selected_forbidden_member",
      "complete-selected-forbidden")),
    claim("each-forbidden-member-selects-its-exact-coordinates", "evidence", proposition(
      "forbidden_member", "reference:targets", UNCONDITIONAL,
      [refOperand("resolution_coordinates")]
    ), universal("forbidden_members", "forbidden_member", "complete-forbidden-members",
      [forbiddenCoordinates])),
    claim("each-coordinate-selects-its-exact-operations", "evidence", proposition(
      "resolution_coordinate", "reference:uses", UNCONDITIONAL,
      [refOperand("resolver_operations")]
    ), universal("resolution_coordinates", "resolution_coordinate",
      "complete-resolution-coordinates", [coordinateOperations])),
    claim("each-operation-targets-its-exact-effects", "evidence", proposition(
      "resolver_operation", "reference:targets", UNCONDITIONAL,
      [refOperand("protected_effects")]
    ), universal("resolver_operations", "resolver_operation",
      "complete-resolver-operations", [operationEffects])),
    claim("each-mandatory-source-is-observed", "evidence", proposition(
      "mandatory_source", "reference:member_of", forbiddenAttemptScope,
      [refOperand("observed_sources_pop")]
    ), universal("mandatory_sources", "mandatory_source", "complete-mandatory-sources")),
    claim("each-observed-source-is-mandatory", "evidence", proposition(
      "observed_source", "reference:member_of", forbiddenAttemptScope,
      [refOperand("mandatory_sources_pop")]
    ), universal("observed_sources", "observed_source", "complete-observed-sources")),
    claim("each-family-has-its-policy-source", "evidence", proposition(
      "mandatory_sources", "reference:covers", forbiddenAttemptScope,
      [refOperand("prohibited_family")]
    ), familyIteration),
    ...verified.flatMap(({ claims }) => claims)
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
    number_roles: populationDefinitions.map(([, memberRole]) => ({
      role: `${memberRole}_count`, cardinality: "exactly_one", number_type: "integer", minimum: 0
    })),
    distinct_reference_role_sets: [{ roles: [
      "accepted_request", "forbidden_request", "accepted_attempt", "forbidden_attempt",
      "acceptance", "refusal", "observation_cut"
    ] }],
    reference_binding_patterns: referenceBindingPatterns,
    reference_role_count_bindings: populationDefinitions.map(([, memberRole]) => ({
      reference_role: memberRole, number_role: `${memberRole}_count`
    })),
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

function buildCallerInputAuthorityConfinementEvaluationInput(result) {
  const roles = {
    acceptance: [result.singletons.acceptance],
    accepted_attempt: [result.singletons["accepted-attempt"]],
    accepted_request: [result.singletons["accepted-request"]],
    accepted_request_capture: [result.singletons["accepted-request-source"]],
    capture_proof: [result.singletons["capture-proof"]],
    forbidden_attempt: [result.singletons["forbidden-attempt"]],
    forbidden_request: [result.singletons["forbidden-request"]],
    forbidden_request_capture: [result.singletons["forbidden-request-source"]],
    interface: [result.singletons.interface],
    observation_cut: [result.singletons["observation-cut"]],
    observation_evidence_capture: [result.singletons["observation-evidence"]],
    parser: [result.singletons.parser],
    path_like_control: [result.singletons["path-like-control"]],
    policy_capture: [result.singletons["policy-source"]],
    projection_result: [result.singletons["projection-result"]],
    refusal: [result.singletons.refusal],
    verification: [result.singletons.verification]
  };
  for (const [populationRole, memberRole, populationName] of populationDefinitions) {
    roles[populationRole] = [POPULATION_IDS[populationName]];
    roles[memberRole] = [...result.populations[populationName]];
  }
  return {
    input_version: "controlled-contract-verification-profile-input.v1",
    evaluation_stage: STAGE,
    reference_bindings: Object.entries(roles).map(([roleName, referenceIds]) => ({
      role: roleName, reference_ids: referenceIds
    })),
    number_bindings: populationDefinitions.map(([, memberRole]) => ({
      role: `${memberRole}_count`, value: roles[memberRole].length
    })),
    claim_pattern_bindings: [],
    resolver_facts: [],
    delivered_evidence: [], stable_evaluation: {}
  };
}

function projectionCoverage(roleName, projectionId, population = false) {
  return {
    role: roleName,
    coverage: "exact",
    projection: population ? "projection_result_population" : "projection_result_reference",
    ...(population ? { population_id: projectionId } : { projection_id: projectionId })
  };
}

function buildCallerInputAuthorityConfinementDeclaration(
  profile = buildCallerInputAuthorityConfinementProfile()
) {
  const sourceRequirements = [
    ["accepted-input-policy", "policy_capture"],
    ["accepted-request", "accepted_request_capture"],
    ["forbidden-request", "forbidden_request_capture"],
    ["observation-evidence", "observation_evidence_capture"],
    ["observation-capture-proof", "capture_proof"]
  ].map(([requirementId, roleName]) => ({
    requirement_id: requirementId,
    binding_kind: "artifact_bytes",
    role_coverage: [{ role: roleName, coverage: "exact", projection: "artifact_subject" }]
  }));
  const singletonProjectionNames = {
    acceptance: "acceptance",
    accepted_attempt: "accepted-attempt",
    accepted_request: "accepted-request",
    forbidden_attempt: "forbidden-attempt",
    forbidden_request: "forbidden-request",
    interface: "interface",
    observation_cut: "observation-cut",
    parser: "parser",
    path_like_control: "path-like-control",
    refusal: "refusal",
    verification: "verification"
  };
  const resultCoverage = [
    { role: "projection_result", coverage: "exact", projection: "artifact_subject" },
    ...Object.entries(singletonProjectionNames).map(([roleName, projectionId]) =>
      projectionCoverage(roleName, projectionId))
  ];
  for (const [populationRole, memberRole, populationName] of populationDefinitions) {
    resultCoverage.push(
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
      ...sourceRequirements,
      {
        requirement_id: RESULT_REQUIREMENT_ID,
        binding_kind: "artifact_bytes",
        role_coverage: resultCoverage.sort((left, right) =>
          left.role < right.role ? -1 : left.role > right.role ? 1 : 0)
      }
    ].sort((left, right) => left.requirement_id < right.requirement_id ? -1 : 1),
    relations: [{
      relation_id: "derive-caller-input-authority-confinement",
      operator: "deterministic_projection",
      transformer_id: TRANSFORMER_ID,
      source_requirement_ids: [
        "accepted-input-policy", "accepted-request", "forbidden-request",
        "observation-evidence", "observation-capture-proof"
      ],
      result_requirement_id: RESULT_REQUIREMENT_ID
    }]
  };
}

export {
  GRAPH_PROJECTION_ID,
  PROFILE_ID,
  PROFILE_VERSION,
  RESULT_REQUIREMENT_ID,
  buildCallerInputAuthorityConfinementDeclaration,
  buildCallerInputAuthorityConfinementEvaluationInput,
  buildCallerInputAuthorityConfinementProfile,
  populationDefinitions
};
