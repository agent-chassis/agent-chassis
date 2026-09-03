import {
  POPULATION_REFERENCES as BOUNDARY_POPULATIONS
} from "../../lib/declared-boundary-record-consistency.mjs";
import {
  POPULATION_REFERENCES as GUIDANCE_POPULATIONS
} from "../../lib/declared-limit-guidance-propagation.mjs";
import { profileDigest } from "../support/stable-v1-proof-pack-runtime.mjs";
import { VOCABULARY_DIGESTS } from "../../vocabulary/controlled-contract-vocabulary.v1.mjs";

const BOUNDARY_PROFILE_ID = "proof.policy.declared-boundary-record-consistency";
const GUIDANCE_PROFILE_ID = "proof.policy.declared-limit-propagation";
const PROFILE_VERSION = "2.0.0";
const STAGE = "post_delivery";
const UNCONDITIONAL = Object.freeze({ mode: "unconditional", operand_roles: [] });

const CONFIGS = Object.freeze({
  boundary: Object.freeze({
    profileId: BOUNDARY_PROFILE_ID,
    transformerId: "declared-boundary-record-consistency.v1",
    graphProjectionId: "boundary-consistency-contract",
    resultRequirementId: "boundary-report",
    reportRole: "conformance_report",
    subjectRole: "bounded_subject",
    verificationMethod: "test_execution",
    sources: Object.freeze([
      ["boundary-observations", "observation_artifact", "cc:evidence"],
      ["declared-policy", "policy_artifact", "cc:artifact"],
      ["measured-subjects", "subjects_artifact", "cc:artifact"]
    ]),
    populations: Object.freeze([
      ["limit_population", "declared_limits", "declared-limits", "cc:criterion"],
      ["unit_population", "measurement_units", "measurement-units", "cc:configuration"],
      ["case_population", "boundary_cases", "boundary-cases", "cc:test"],
      ["subject_population", "measured_subjects", "measured-subjects", "cc:artifact"]
    ]),
    associations: Object.freeze([
      ["each-boundary-case-targets-one-limit", "case_population", "boundary_cases", "case",
        "declared_limits", "reference:targets"],
      ["each-limit-resolves-to-one-unit", "limit_population", "declared_limits", "limit",
        "measurement_units", "reference:resolves_to"]
    ])
  }),
  guidance: Object.freeze({
    profileId: GUIDANCE_PROFILE_ID,
    transformerId: "declared-limit-guidance-propagation.v1",
    graphProjectionId: "guidance-propagation-contract",
    resultRequirementId: "propagation-report",
    reportRole: "propagation_report",
    subjectRole: "guidance_subject",
    verificationMethod: "audit",
    sources: Object.freeze([
      ["declared-policy", "policy_artifact", "cc:artifact"],
      ["guidance-artifact", "guidance_artifact", "cc:artifact"]
    ]),
    populations: Object.freeze([
      ["limit_population", "declared_limits", "declared-limits", "cc:criterion"],
      ["unit_population", "measurement_units", "measurement-units", "cc:configuration"],
      ["association_population", "guidance_associations", "guidance-associations",
        "cc:evidence_occurrence"],
      ["surface_population", "guidance_surfaces", "guidance-surfaces", "cc:artifact"],
      ["key_population", "policy_keys", "policy-keys", "cc:configuration"]
    ]),
    associations: Object.freeze([
      ["each-guidance-association-targets-one-limit", "association_population",
        "guidance_associations", "guidance_association", "declared_limits", "reference:targets"],
      ["each-policy-key-resolves-to-one-limit", "key_population", "policy_keys", "policy_key",
        "declared_limits", "reference:resolves_to"],
      ["each-limit-resolves-to-one-unit", "limit_population", "declared_limits", "limit",
        "measurement_units", "reference:resolves_to"]
    ])
  })
});

function config(kind) {
  const value = CONFIGS[kind];
  if (!value) throw new Error(`unknown bounded-policy profile kind: ${kind}`);
  return value;
}
function role(name, terms, cardinality) {
  return { role: name, allowed_type_terms: terms, cardinality };
}
function completePattern(populationRole, memberRole) {
  return {
    pattern_id: `complete-${memberRole.replaceAll("_", "-")}`,
    required_by_stage: STAGE,
    comparison: "complete_population",
    roles: [populationRole, memberRole],
    applicability_context: UNCONDITIONAL
  };
}
function proposition(subject_role, operator, operands) {
  return { subject_role, operator, applicability_context: UNCONDITIONAL, operands };
}
const ref = (roleName) => ({ kind: "reference", role: roleName });
function claim(pattern_id, claim_kind, proposition_template, for_each = null, extra = {}) {
  return {
    pattern_id, required_by_stage: STAGE, claim_kind, allowed_modalities: ["MUST"],
    ...(for_each ? { for_each } : {}), proposition_template, ...extra
  };
}
function iteration(populationRole, memberRole, associatedRole, operator) {
  return {
    population_role: populationRole,
    member_role: memberRole,
    complete_population_pattern_id: `complete-${populationRole.replaceAll("_", "-")}`,
    quantifier: "universal",
    empty_behavior: "vacuously_satisfied",
    association_bindings: [{
      associated_role: associatedRole,
      operator,
      member_position: "subject",
      associated_position: "reference_operand",
      applicability_context: UNCONDITIONAL,
      complete_population_pattern_id: `complete-${associatedRole.replaceAll("_", "-")}`
    }]
  };
}

function buildProfile(kind) {
  const c = config(kind);
  const referenceBindingPatterns = c.populations.map(([populationRole, memberRole]) =>
    completePattern(populationRole, memberRole));
  const referenceRoles = [
    role(c.subjectRole, ["cc:process", "cc:runtime_component"], "exactly_one"),
    ...c.sources.map(([, sourceRole, type]) => role(sourceRole, [type], "exactly_one")),
    role(c.reportRole, ["cc:evidence"], "exactly_one"),
    role("verification", ["cc:test", "cc:process"], "exactly_one"),
    role("mismatch_condition", ["cc:state", "cc:configuration"], "exactly_one"),
    ...c.populations.flatMap(([populationRole, memberRole, , memberType]) => [
      role(populationRole, ["cc:population"], "exactly_one"),
      role(memberRole, [memberType], "zero_or_more")
    ])
  ];
  const associationClaims = c.associations.map(([
    id, , collectionRole, memberRole, associatedRole, operator
  ]) => claim(id, "evidence", proposition(memberRole, operator, [ref(associatedRole)]),
  iteration(collectionRole, memberRole, associatedRole, operator)));
  const policyClaims = [
    claim("policy-contains-limit-population", "evidence",
      proposition("policy_artifact", "reference:contains", [ref("limit_population")])),
    claim("policy-contains-unit-population", "evidence",
      proposition("policy_artifact", "reference:contains", [ref("unit_population")]))
  ];
  const domainClaims = kind === "boundary" ? [
    claim("observation-contains-case-population", "evidence",
      proposition("observation_artifact", "reference:contains", [ref("case_population")])),
    claim("subjects-contains-subject-population", "evidence",
      proposition("subjects_artifact", "reference:contains", [ref("subject_population")])),
    claim("subject-uses-policy", "evidence",
      proposition(c.subjectRole, "reference:uses", [ref("policy_artifact")])),
    claim("subject-is-deterministic", "evidence",
      proposition(c.subjectRole, "boolean:deterministic", [{ kind: "boolean", value: true }]))
  ] : [
    claim("guidance-contains-association-population", "evidence",
      proposition("guidance_artifact", "reference:contains", [ref("association_population")])),
    claim("guidance-contains-key-population", "evidence",
      proposition("guidance_artifact", "reference:contains", [ref("key_population")]))
  ];
  const targetId = kind === "boundary" ? "report-is-conformant" : "report-is-propagated";
  const verificationId = `verify-${targetId}`;
  const relationId = `verification-targets-${targetId}`;
  const reportClaim = claim(targetId, "behavior",
    proposition(c.reportRole, "boolean:exists", [{ kind: "boolean", value: true }]));
  const verificationClaim = claim(verificationId, "verification",
    proposition("verification", "reference:reads", [
      ...c.sources.map(([, sourceRole]) => ref(sourceRole)), ref(c.reportRole)
    ]), null, {
      verification_methods: kind === "guidance"
        ? ["analysis", "audit", "demonstration", "proof", "test_execution"]
        : ["analysis", "demonstration", "proof", "test_execution"],
      falsifying_proposition_template: proposition(
        c.reportRole, "boolean:exists", [{ kind: "boolean", value: false }]
      )
    });
  const relationPatterns = [{
    pattern_id: relationId, required_by_stage: STAGE, role: "verifies",
    source_claim_pattern_id: verificationId, target_claim_pattern_id: targetId
  }];
  const claimPatterns = [
    ...associationClaims, ...policyClaims, ...domainClaims, reportClaim, verificationClaim
  ];
  const patterns = [...referenceBindingPatterns, ...claimPatterns, ...relationPatterns]
    .map(({ pattern_id: pattern }) => ({ pattern }));
  return {
    schema_version: "controlled-contract-verification-profile.v1",
    profile_id: c.profileId,
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
    number_roles: c.populations.map(([, memberRole]) => ({
      role: `${memberRole}_count`, cardinality: "exactly_one", number_type: "integer", minimum: 1
    })),
    distinct_reference_role_sets: [
      { roles: [...c.sources.map(([, sourceRole]) => sourceRole), c.reportRole] },
      { roles: c.populations.map(([populationRole]) => populationRole) }
    ],
    reference_binding_patterns: referenceBindingPatterns,
    reference_role_count_bindings: c.populations.map(([, memberRole]) => ({
      reference_role: memberRole, number_role: `${memberRole}_count`
    })),
    binding_constraint_patterns: [],
    claim_patterns: claimPatterns,
    relation_patterns: relationPatterns,
    collection_patterns: [],
    resolver_fact_patterns: [],
    evidence_patterns: [],
    falsifier_condition_bindings: [{
      relation_pattern_id: relationId, applicability_context: UNCONDITIONAL
    }],
    falsifier_occurrence_bindings: [{
      relation_pattern_id: relationId,
      reference_role_joins: [
        {
          role: c.reportRole,
          target_positions: ["subject"],
          verification_positions: ["reference_operand"],
          falsifier_positions: ["subject"]
        }
      ],
      number_role_joins: [],
      applicability_join: "exact_scope"
    }],
    satisfaction_expression: { all_of: patterns }
  };
}

function members(report, populationName) {
  return [...report.populations[populationName]];
}
function fixedBindings(kind) {
  return kind === "boundary" ? {
    bounded_subject: ["ref-bpr-bounded-subject"],
    policy_artifact: ["ref-bpr-policy-artifact"],
    observation_artifact: ["ref-bpr-observation-artifact"],
    subjects_artifact: ["ref-bpr-subjects-artifact"],
    conformance_report: ["ref-bpr-conformance-report"],
    verification: ["ref-bpr-verification"],
    mismatch_condition: ["ref-bpr-mismatch-condition"]
  } : {
    guidance_subject: ["ref-lgp-guidance-subject"],
    policy_artifact: ["ref-lgp-policy-artifact"],
    guidance_artifact: ["ref-lgp-guidance-artifact"],
    propagation_report: ["ref-lgp-propagation-report"],
    verification: ["ref-lgp-verification"],
    mismatch_condition: ["ref-lgp-mismatch-condition"]
  };
}
function buildEvaluationInput(kind, report) {
  const c = config(kind);
  const populations = kind === "boundary" ? BOUNDARY_POPULATIONS : GUIDANCE_POPULATIONS;
  const bindings = fixedBindings(kind);
  for (const [populationRole, memberRole, populationName] of c.populations) {
    bindings[populationRole] = [populations[populationName]];
    bindings[memberRole] = members(report, populationName);
  }
  return {
    input_version: "controlled-contract-verification-profile-input.v1",
    evaluation_stage: STAGE,
    reference_bindings: Object.entries(bindings).map(([roleName, reference_ids]) => ({
      role: roleName, reference_ids
    })),
    number_bindings: c.populations.map(([, memberRole, populationName]) => ({
      role: `${memberRole}_count`, value: report.counts[populationName]
    })),
    claim_pattern_bindings: [],
    resolver_facts: [],
    delivered_evidence: [], stable_evaluation: {}
  };
}

function buildDeclaration(kind, profile = buildProfile(kind)) {
  const c = config(kind);
  const resultCoverage = [{
    role: c.reportRole, coverage: "exact", projection: "projection_result_reference",
    projection_id: "report-reference"
  }];
  for (const [, memberRole, populationName] of c.populations) resultCoverage.push({
    role: memberRole, coverage: "exact", projection: "projection_result_population",
    population_id: populationName
  });
  const requirements = [
    ...c.sources.map(([requirement_id, sourceRole]) => ({
      requirement_id,
      binding_kind: "artifact_bytes",
      role_coverage: [{ role: sourceRole, coverage: "exact", projection: "artifact_subject" }]
    })),
    {
      requirement_id: c.resultRequirementId,
      binding_kind: "artifact_bytes",
      role_coverage: resultCoverage.sort((a, b) => a.role < b.role ? -1 : a.role > b.role ? 1 : 0)
    }
  ].sort((a, b) => a.requirement_id < b.requirement_id ? -1 : 1);
  const sourceRequirementIds = c.sources.map(([id]) => id).sort();
  return {
    schema_version: "controlled-contract-exact-binding-declaration.v1",
    profile_id: c.profileId,
    profile_version: PROFILE_VERSION,
    profile_digest: profileDigest(profile),
    projected_evaluation_binding: {
      binding_version: "controlled-contract-projected-evaluation-binding.v1",
      result_requirement_id: c.resultRequirementId,
      graph_projection_id: c.graphProjectionId
    },
    requirements,
    relations: [
      {
        relation_id: `derive-${kind}-policy-proof`,
        operator: "deterministic_projection",
        transformer_id: c.transformerId,
        source_requirement_ids: sourceRequirementIds,
        result_requirement_id: c.resultRequirementId
      },
      {
        relation_id: "independent-exact-sources",
        operator: "distinct_source_descriptor",
        requirement_ids: requirements.map(({ requirement_id: id }) => id).sort()
      }
    ].sort((a, b) => a.relation_id < b.relation_id ? -1 : 1)
  };
}

export {
  BOUNDARY_PROFILE_ID,
  CONFIGS,
  GUIDANCE_PROFILE_ID,
  PROFILE_VERSION,
  buildDeclaration,
  buildEvaluationInput,
  buildProfile
};
