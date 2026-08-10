import {
  PROFILE_ID_V034,
  SCHEMA_VERSION_V034,
  VOCABULARY_VERSION_V034
} from "../../lib/native-contract-carrier-v034.mjs";
import { EVALUATION_INPUT_VERSION_V034 } from "../../lib/verification-profile-v034.mjs";

const V = Object.freeze({
  signature: "5c5e34017a7e0defc5222b9e3fc7fcaec8ca12d70541e609ca29e49c279c5a7d",
  algebra: "1f5b1b04df5ae806c68592e352cb2285cdaf10a7d7bb898818a2805d290a9b4f",
  definitions: "203e07960ad043b5dc932b65adeb5378eadd9dd91babca03120f1b6fc0d96033",
  complete: "65195755c4124bfc55fe88ba0e817478f0036cc10bff15a9a64884cfd1241341"
});
const roleTypes = Object.freeze({
  operation: ["cc:operation", "cc:capability", "cc:command"],
  owned_resource: ["cc:resource", "cc:artifact", "cc:configuration", "cc:entity"],
  legitimate_owner: ["cc:actor", "cc:entity"],
  foreign_subject: ["cc:actor", "cc:entity"],
  legitimate_authority: ["cc:authority", "cc:capability", "cc:configuration"],
  foreign_attempt: ["cc:event"],
  protected_interval: ["cc:event"],
  refusal: ["cc:event", "cc:artifact"],
  authority_state_before: ["cc:state"],
  authority_state_after_refusal: ["cc:state"],
  authority_observation_before: ["cc:artifact", "cc:evidence"],
  authority_observation_after: ["cc:artifact", "cc:evidence"],
  later_valid_attempt: ["cc:event"],
  later_valid_result: ["cc:event", "cc:artifact"],
  later_result_state: ["cc:state"],
  expected_success_state: ["cc:state"],
  result_observation: ["cc:artifact", "cc:evidence"],
  success_criterion: ["cc:criterion", "cc:invariant"],
  write_verification: ["cc:process", "cc:test"],
  mutation_verification: ["cc:process", "cc:test"],
  nonconsumption_verification: ["cc:process", "cc:test"],
  later_success_verification: ["cc:process", "cc:test"],
  foreign_write_condition: ["cc:configuration", "cc:criterion", "cc:state"],
  foreign_mutation_condition: ["cc:configuration", "cc:criterion", "cc:state"],
  authority_consumption_condition: ["cc:configuration", "cc:criterion", "cc:state"],
  later_failure_condition: ["cc:configuration", "cc:criterion", "cc:state"]
});
const roleType = Object.fromEntries(Object.entries(roleTypes).map(([key, values]) => [key, values[0]]));
const abstractRoles = new Set(["success_criterion", "foreign_write_condition",
  "foreign_mutation_condition", "authority_consumption_condition", "later_failure_condition"]);
const identityKinds = ["repository_path", "code_symbol", "durable_id", "runtime_parameter"];
const r = (role) => ({ kind: "reference", role });
const u = () => ({ mode: "unconditional", operand_roles: [] });
const at = (mode, ...roles) => ({ mode, operand_roles: roles });

function pattern(id, kind, modality, subject, operator, context, operands, falsifier) {
  const value = { pattern_id: id, required_by_stage: "pre_dispatch", claim_kind: kind,
    allowed_modalities: [modality], proposition_template: {
      subject_role: subject, operator, applicability_context: context, operands
    } };
  if (falsifier) value.falsifying_proposition_template = falsifier;
  if (kind === "verification") value.verification_methods = [
    "analysis", "audit", "demonstration", "proof", "test_execution"
  ];
  return value;
}
const patterns = [
  pattern("resource-owned-by-legitimate-owner", "evidence", "MUST", "owned_resource",
    "reference:has_property", u(), [r("legitimate_owner")]),
  pattern("authority-authorizes-legitimate-owner", "evidence", "MUST",
    "legitimate_authority", "reference:authorizes", at("where", "operation"),
    [r("legitimate_owner")]),
  pattern("authority-does-not-authorize-foreign-subject", "evidence", "MUST_NOT",
    "legitimate_authority", "reference:authorizes", at("where", "operation"),
    [r("foreign_subject")]),
  pattern("foreign-attempt-performs-operation", "evidence", "MUST", "foreign_attempt",
    "reference:performs", u(), [r("operation")]),
  pattern("foreign-attempt-targets-owned-resource", "evidence", "MUST", "foreign_attempt",
    "reference:targets", u(), [r("owned_resource")]),
  pattern("foreign-attempt-uses-foreign-subject", "evidence", "MUST", "foreign_attempt",
    "reference:uses", u(), [r("foreign_subject")]),
  pattern("foreign-attempt-precedes-protected-interval", "evidence", "MUST",
    "foreign_attempt", "reference:precedes", u(), [r("protected_interval")]),
  pattern("protected-interval-precedes-refusal", "evidence", "MUST", "protected_interval",
    "reference:precedes", u(), [r("refusal")]),
  pattern("refusal-rejects-foreign-attempt", "evidence", "MUST", "refusal",
    "reference:rejects", at("after", "protected_interval"), [r("foreign_attempt")]),
  pattern("authority-state-before-foreign-attempt", "evidence", "MUST",
    "legitimate_authority", "reference:has_state", at("before", "foreign_attempt"),
    [r("authority_state_before")]),
  pattern("authority-observation-before-records-state", "evidence", "MUST",
    "authority_observation_before", "reference:records", at("before", "foreign_attempt"),
    [r("authority_state_before")]),
  pattern("no-foreign-write-before-refusal", "behavior", "MUST_NOT", "foreign_attempt",
    "reference:writes", at("before", "refusal"), [r("owned_resource")]),
  pattern("write-verification-reads-boundary", "evidence", "MUST", "write_verification",
    "reference:reads", at("after", "refusal"), [r("foreign_attempt"), r("refusal")]),
  pattern("write-isolation-verification", "verification", "MUST", "write_verification",
    "reference:covers", u(), [r("owned_resource")], {
      subject_role: "foreign_attempt", operator: "reference:writes",
      applicability_context: at("when", "foreign_write_condition"),
      operands: [r("owned_resource")]
    }),
  pattern("no-foreign-mutation-before-refusal", "behavior", "MUST_NOT", "foreign_attempt",
    "reference:mutates", at("before", "refusal"), [r("owned_resource")]),
  pattern("mutation-verification-reads-boundary", "evidence", "MUST",
    "mutation_verification", "reference:reads", at("after", "refusal"),
    [r("foreign_attempt"), r("refusal")]),
  pattern("mutation-isolation-verification", "verification", "MUST",
    "mutation_verification", "reference:covers", u(), [r("owned_resource")], {
      subject_role: "foreign_attempt", operator: "reference:mutates",
      applicability_context: at("when", "foreign_mutation_condition"),
      operands: [r("owned_resource")]
    }),
  pattern("authority-state-after-refusal", "evidence", "MUST", "legitimate_authority",
    "reference:has_state", at("after", "refusal"), [r("authority_state_after_refusal")]),
  pattern("authority-observation-after-records-state", "evidence", "MUST",
    "authority_observation_after", "reference:records", at("after", "refusal"),
    [r("authority_state_after_refusal")]),
  pattern("legitimate-authority-unconsumed", "behavior", "MUST",
    "authority_state_after_refusal", "reference:equals", at("after", "refusal"),
    [r("authority_state_before")]),
  pattern("nonconsumption-verification-reads-states", "evidence", "MUST",
    "nonconsumption_verification", "reference:reads", at("after", "refusal"),
    [r("authority_observation_before"), r("authority_observation_after")]),
  pattern("nonconsumption-verification", "verification", "MUST",
    "nonconsumption_verification", "reference:covers", u(), [r("legitimate_authority")], {
      subject_role: "authority_state_after_refusal", operator: "reference:not_equals",
      applicability_context: at("when", "authority_consumption_condition"),
      operands: [r("authority_state_before")]
    }),
  pattern("refusal-precedes-later-valid-attempt", "evidence", "MUST", "refusal",
    "reference:precedes", u(), [r("later_valid_attempt")]),
  pattern("later-attempt-performs-operation", "evidence", "MUST", "later_valid_attempt",
    "reference:performs", at("after", "refusal"), [r("operation")]),
  pattern("later-attempt-uses-authority", "evidence", "MUST", "later_valid_attempt",
    "reference:uses", at("after", "refusal"), [r("legitimate_authority")]),
  pattern("later-attempt-uses-legitimate-owner", "evidence", "MUST", "later_valid_attempt",
    "reference:uses", at("after", "refusal"), [r("legitimate_owner")]),
  pattern("later-attempt-targets-same-resource", "evidence", "MUST", "later_valid_attempt",
    "reference:targets", at("after", "refusal"), [r("owned_resource")]),
  pattern("later-attempt-precedes-result", "evidence", "MUST", "later_valid_attempt",
    "reference:precedes", u(), [r("later_valid_result")]),
  pattern("later-result-accepts-attempt", "evidence", "MUST", "later_valid_result",
    "reference:accepts", at("after", "later_valid_attempt"), [r("later_valid_attempt")]),
  pattern("later-result-has-state", "evidence", "MUST", "later_valid_result",
    "reference:has_state", at("after", "later_valid_attempt"), [r("later_result_state")]),
  pattern("expected-state-conforms-to-success", "evidence", "MUST",
    "expected_success_state", "reference:conforms_to", u(), [r("success_criterion")]),
  pattern("result-observation-records-state", "evidence", "MUST", "result_observation",
    "reference:records", at("after", "later_valid_result"), [r("later_result_state")]),
  pattern("later-valid-attempt-succeeds", "behavior", "MUST", "later_result_state",
    "reference:equals", at("after", "later_valid_result"), [r("expected_success_state")]),
  pattern("later-success-verification-reads-result", "evidence", "MUST",
    "later_success_verification", "reference:reads", at("after", "later_valid_result"),
    [r("result_observation")]),
  pattern("later-success-verification", "verification", "MUST",
    "later_success_verification", "reference:covers", u(), [r("later_valid_result")], {
      subject_role: "later_result_state", operator: "reference:not_equals",
      applicability_context: at("when", "later_failure_condition"),
      operands: [r("expected_success_state")]
    })
];
const relations = [
  ["write-verifies-isolation", "write-isolation-verification",
    "no-foreign-write-before-refusal"],
  ["mutation-verifies-isolation", "mutation-isolation-verification",
    "no-foreign-mutation-before-refusal"],
  ["nonconsumption-verifies-authority", "nonconsumption-verification",
    "legitimate-authority-unconsumed"],
  ["later-success-verifies-result", "later-success-verification",
    "later-valid-attempt-succeeds"]
].map(([pattern_id, source_claim_pattern_id, target_claim_pattern_id]) => ({
  pattern_id, required_by_stage: "pre_dispatch", role: "verifies",
  source_claim_pattern_id, target_claim_pattern_id
}));
const sequenceMembers = ["authority-state-before-foreign-attempt",
  "foreign-attempt-performs-operation", "foreign-attempt-precedes-protected-interval",
  "no-foreign-write-before-refusal", "no-foreign-mutation-before-refusal",
  "protected-interval-precedes-refusal", "refusal-rejects-foreign-attempt",
  "authority-state-after-refusal", "legitimate-authority-unconsumed",
  "refusal-precedes-later-valid-attempt", "later-attempt-performs-operation",
  "later-attempt-precedes-result", "later-result-accepts-attempt",
  "later-valid-attempt-succeeds"];
const collections = [
  { pattern_id: "proof-sequence", required_by_stage: "pre_dispatch",
    collection_kind: "ordered_sequence", match_mode: "subsequence",
    candidate_quantifier: "all_covering",
    collection_purpose: "proof_exact_ownership_isolation_sequence",
    member_claim_pattern_ids: sequenceMembers },
  { pattern_id: "proof-population", required_by_stage: "pre_dispatch",
    collection_kind: "closed_set", match_mode: "exact", candidate_quantifier: "all_covering",
    collection_purpose: "proof_exact_ownership_isolation_population",
    member_claim_pattern_ids: patterns.map(({ pattern_id }) => pattern_id) }
];
const profile = {
  schema_version: "controlled-contract-verification-profile.experimental.v0.2",
  profile_id: "proof.ownership.exact-isolation", profile_version: "1.0.0",
  contract_schema_version: SCHEMA_VERSION_V034, vocabulary_version: VOCABULARY_VERSION_V034,
  vocabulary_signature_digest: V.signature, vocabulary_algebra_digest: V.algebra,
  vocabulary_definitions_digest: V.definitions, vocabulary_complete_digest: V.complete,
  evaluation_stages: ["pre_dispatch"],
  reference_roles: Object.entries(roleTypes).map(([role, allowed_type_terms]) => ({
    role, allowed_type_terms,
    ...(!abstractRoles.has(role) ? { allowed_identity_kinds: identityKinds } : {}),
    cardinality: "exactly_one"
  })),
  number_roles: [],
  distinct_reference_role_sets: [
    { roles: ["legitimate_owner", "foreign_subject"] },
    { roles: ["foreign_attempt", "protected_interval", "refusal", "later_valid_attempt",
      "later_valid_result"] },
    { roles: ["authority_state_before", "authority_state_after_refusal",
      "later_result_state", "expected_success_state"] },
    { roles: ["authority_observation_before", "authority_observation_after",
      "result_observation"] },
    { roles: ["write_verification", "mutation_verification",
      "nonconsumption_verification", "later_success_verification"] },
    { roles: ["foreign_write_condition", "foreign_mutation_condition",
      "authority_consumption_condition", "later_failure_condition"] },
    { roles: ["operation", "owned_resource", "legitimate_authority"] }
  ],
  reference_binding_patterns: [], reference_role_count_bindings: [],
  claim_patterns: patterns, relation_patterns: relations,
  falsifier_condition_bindings: [
    ["write-verifies-isolation", "foreign_write_condition"],
    ["mutation-verifies-isolation", "foreign_mutation_condition"],
    ["nonconsumption-verifies-authority", "authority_consumption_condition"],
    ["later-success-verifies-result", "later_failure_condition"]
  ].map(([relation_pattern_id, role]) => ({ relation_pattern_id,
    applicability_context: at("when", role) })),
  collection_patterns: collections, resolver_fact_patterns: [], evidence_patterns: [],
  verification_falsifier_policy: "controlled_complement_per_target",
  satisfaction_expression: { all_of: [
    ...patterns.map(({ pattern_id: id }) => ({ pattern: id })),
    ...relations.map(({ pattern_id: id }) => ({ pattern: id })),
    ...collections.map(({ pattern_id: id }) => ({ pattern: id }))
  ] }
};

const refId = (role) => `ref-${role.replaceAll("_", "-")}`;
const refOperand = (role) => ({ kind: "reference", reference_id: refId(role) });
function identityFor(role, domain, kind) {
  if (kind === "repository_path") return { kind, repository: domain,
    path: `fixtures/${role}.json` };
  if (kind === "code_symbol") return { kind, repository: domain,
    path: `src/${role}.mjs`, symbol: role };
  if (kind === "runtime_parameter") return { kind, name: `${domain}_${role}` };
  if (kind === "profile_term") return { kind, term: `${domain}:${role}` };
  return { kind: "durable_id", domain, value: role };
}
function instantiate(template, id) {
  return { proposition_id: id, subject_reference_id: refId(template.subject_role),
    operator: template.operator, applicability_context: {
      mode: template.applicability_context.mode,
      operand_reference_ids: template.applicability_context.operand_roles.map(refId)
    }, operands: template.operands.map(({ role }) => refOperand(role)) };
}
function buildExactOwnershipIsolationFixture({
  domain = "tenant_document", method = "test_execution",
  role_type_overrides: roleTypeOverrides = {},
  identity_kind_overrides: identityKindOverrides = {},
  mutate_contract: mutateContract, mutate_input: mutateInput
} = {}) {
  const references = Object.keys(roleTypes).map((role) => ({
    reference_id: refId(role), type_term: roleTypeOverrides[role] ?? roleType[role],
    identity: identityFor(role, domain, identityKindOverrides[role] ??
      (abstractRoles.has(role) ? "profile_term" : "durable_id"))
  }));
  const propositions = [], claims = [];
  for (const p of patterns) {
    propositions.push(instantiate(p.proposition_template, `prop-${p.pattern_id}`));
    const claim = { claim_id: `claim-${p.pattern_id}`, kind: p.claim_kind,
      modality: p.allowed_modalities[0], proposition_id: `prop-${p.pattern_id}` };
    if (p.claim_kind === "verification") {
      propositions.push(instantiate(p.falsifying_proposition_template,
        `prop-falsifier-${p.pattern_id}`));
      claim.verification_method = method;
      claim.falsifying_proposition_id = `prop-falsifier-${p.pattern_id}`;
    }
    claims.push(claim);
  }
  const contract = { schema_version: SCHEMA_VERSION_V034,
    vocabulary_version: VOCABULARY_VERSION_V034, profile_id: PROFILE_ID_V034,
    references, propositions, claims,
    relations: relations.map(({ pattern_id, source_claim_pattern_id,
      target_claim_pattern_id }) => ({ relation_id: `rel-${pattern_id}`, role: "verifies",
      source_claim_id: `claim-${source_claim_pattern_id}`,
      target_claim_id: `claim-${target_claim_pattern_id}` })),
    collections: [
      { collection_id: "set-proof-sequence", collection_kind: "ordered_sequence",
        purpose: "proof_exact_ownership_isolation_sequence",
        member_claim_ids: sequenceMembers.map((id) => `claim-${id}`) },
      { collection_id: "set-proof-population", collection_kind: "closed_set",
        purpose: "proof_exact_ownership_isolation_population",
        member_claim_ids: patterns.map(({ pattern_id }) => `claim-${pattern_id}`) }
    ], residue: [], annotations: [] };
  const input = { input_version: EVALUATION_INPUT_VERSION_V034,
    evaluation_stage: "pre_dispatch",
    reference_bindings: Object.keys(roleTypes).map((role) => ({
      role, reference_ids: [refId(role)] })), number_bindings: [],
    claim_pattern_bindings: [], resolver_facts: [], delivered_evidence: [] };
  if (mutateContract) mutateContract(contract);
  if (mutateInput) mutateInput(input);
  return { contract, input };
}
function findClaim(fixture, id) {
  return fixture.contract.claims.find(({ claim_id }) => claim_id === `claim-${id}`);
}
function findProposition(fixture, id, falsifier = false) {
  return fixture.contract.propositions.find(({ proposition_id }) =>
    proposition_id === `prop-${falsifier ? "falsifier-" : ""}${id}`);
}
function removeClaim(fixture, id) {
  const claimId = `claim-${id}`, claim = findClaim(fixture, id);
  const propositionIds = new Set([claim?.proposition_id, claim?.falsifying_proposition_id]
    .filter(Boolean));
  fixture.contract.claims = fixture.contract.claims.filter(({ claim_id }) => claim_id !== claimId);
  fixture.contract.propositions = fixture.contract.propositions.filter(
    ({ proposition_id }) => !propositionIds.has(proposition_id));
  fixture.contract.relations = fixture.contract.relations.filter(
    ({ source_claim_id, target_claim_id }) =>
      source_claim_id !== claimId && target_claim_id !== claimId);
  for (const collection of fixture.contract.collections) collection.member_claim_ids =
    collection.member_claim_ids.filter((claimIdValue) => claimIdValue !== claimId);
}
function collapseRole(fixture, fromRole, toRole) {
  const from = refId(fromRole), to = refId(toRole);
  fixture.contract.references = fixture.contract.references.filter(
    ({ reference_id }) => reference_id !== from);
  for (const proposition of fixture.contract.propositions) {
    if (proposition.subject_reference_id === from) proposition.subject_reference_id = to;
    proposition.applicability_context.operand_reference_ids =
      proposition.applicability_context.operand_reference_ids.map((id) => id === from ? to : id);
    for (const operand of proposition.operands) if (
      operand.kind === "reference" && operand.reference_id === from
    ) operand.reference_id = to;
  }
  fixture.input.reference_bindings.find(({ role }) => role === fromRole).reference_ids = [to];
}
export {
  buildExactOwnershipIsolationFixture,
  collapseRole as collapseExactOwnershipRole,
  findClaim as findExactOwnershipClaim,
  findProposition as findExactOwnershipProposition,
  patterns as EXACT_OWNERSHIP_ISOLATION_PATTERNS,
  profile as EXACT_OWNERSHIP_ISOLATION_PROFILE,
  refId as exactOwnershipRoleReferenceId,
  removeClaim as removeExactOwnershipClaim,
  roleTypes as EXACT_OWNERSHIP_ISOLATION_ROLE_TYPES,
  sequenceMembers as EXACT_OWNERSHIP_ISOLATION_SEQUENCE_MEMBERS
};
