import {
  PROFILE_ID_V1,
  SCHEMA_VERSION_V1,
  VOCABULARY_VERSION_V1
} from "../../lib/native-contract-carrier-v1.mjs";
import { EVALUATION_INPUT_VERSION_V1 } from "../support/stable-v1-proof-pack-runtime.mjs";

const V = Object.freeze({
  signature: "5c5e34017a7e0defc5222b9e3fc7fcaec8ca12d70541e609ca29e49c279c5a7d",
  algebra: "1f5b1b04df5ae806c68592e352cb2285cdaf10a7d7bb898818a2805d290a9b4f",
  definitions: "203e07960ad043b5dc932b65adeb5378eadd9dd91babca03120f1b6fc0d96033",
  complete: "65195755c4124bfc55fe88ba0e817478f0036cc10bff15a9a64884cfd1241341"
});

const roleTypes = Object.freeze({
  operation: ["cc:operation", "cc:capability", "cc:command"],
  single_use_authority: ["cc:authority", "cc:capability", "cc:configuration"],
  input: ["cc:actor", "cc:artifact", "cc:configuration", "cc:entity"],
  first_attempt: ["cc:event"],
  first_result: ["cc:event", "cc:artifact"],
  replay_attempt: ["cc:event"],
  replay_refusal: ["cc:event", "cc:artifact"],
  effect_subject: ["cc:resource"],
  effect_occurrence_population: ["cc:population"],
  effect_occurrence: ["cc:event", "cc:artifact", "cc:entity"],
  effect_state_before: ["cc:state"],
  effect_state_after_first: ["cc:state"],
  effect_state_after_replay: ["cc:state"],
  observation_before: ["cc:artifact", "cc:evidence"],
  observation_after_first: ["cc:artifact", "cc:evidence"],
  observation_after_replay: ["cc:artifact", "cc:evidence"],
  expected_success_state: ["cc:state"],
  first_result_state: ["cc:state"],
  success_criterion: ["cc:criterion", "cc:invariant"],
  success_verification: ["cc:process", "cc:test"],
  first_effect_verification: ["cc:process", "cc:test"],
  consumption_verification: ["cc:process", "cc:test"],
  replay_refusal_verification: ["cc:process", "cc:test"],
  replay_occurrence_verification: ["cc:process", "cc:test"],
  replay_effect_verification: ["cc:process", "cc:test"],
  first_use_failure_condition: ["cc:configuration", "cc:criterion", "cc:invariant", "cc:state"],
  no_first_effect_condition: ["cc:configuration", "cc:criterion", "cc:invariant", "cc:state"],
  authority_still_live_condition: ["cc:configuration", "cc:criterion", "cc:invariant", "cc:state"],
  replay_accepted_condition: ["cc:configuration", "cc:criterion", "cc:invariant", "cc:state"],
  duplicate_effect_condition: ["cc:configuration", "cc:criterion", "cc:invariant", "cc:state"]
});

const roleType = Object.fromEntries(Object.entries(roleTypes).map(([k, v]) => [k, v[0]]));
const abstractProfileTermRoles = new Set([
  "success_criterion", "first_use_failure_condition", "no_first_effect_condition",
  "authority_still_live_condition", "replay_accepted_condition",
  "duplicate_effect_condition"
]);
const groundedIdentityKinds = [
  "repository_path", "code_symbol", "durable_id", "runtime_parameter"
];
const r = (role) => ({ kind: "reference", role });
const n = (role) => ({ kind: "number", value_role: role });
const u = () => ({ mode: "unconditional", operand_roles: [] });
const at = (mode, ...roles) => ({ mode, operand_roles: roles });

function pattern(id, kind, modality, subject, operator, applicability, operands, falsifier) {
  const result = {
    pattern_id: id,
    required_by_stage: "pre_dispatch",
    claim_kind: kind,
    allowed_modalities: [modality],
    proposition_template: {
      subject_role: subject,
      operator,
      applicability_context: applicability,
      operands
    }
  };
  if (falsifier) result.falsifying_proposition_template = falsifier;
  if (kind === "verification") result.verification_methods = [
    "analysis", "audit", "demonstration", "proof", "test_execution"
  ];
  return result;
}

const patterns = [
  pattern("authority-authorizes-first-use", "evidence", "MUST", "single_use_authority", "reference:authorizes", at("where", "operation"), [r("input")]),
  pattern("effect-population-membership", "evidence", "MUST", "effect_occurrence_population", "reference:contains", u(), [r("effect_occurrence")]),
  pattern("effect-population-cardinality", "evidence", "MUST", "effect_occurrence_population", "number:has_cardinality", u(), [n("effect_occurrence_count")]),
  pattern("operation-writes-effect-subject", "evidence", "MUST", "operation", "reference:writes", u(), [r("effect_subject")]),
  pattern("effect-state-before-first-use", "evidence", "MUST", "effect_subject", "reference:has_state", at("before", "first_attempt"), [r("effect_state_before")]),
  pattern("observation-before-records-state", "evidence", "MUST", "observation_before", "reference:records", at("before", "first_attempt"), [r("effect_state_before")]),
  pattern("first-attempt-performs-operation", "evidence", "MUST", "first_attempt", "reference:performs", u(), [r("operation")]),
  pattern("first-attempt-uses-authority", "evidence", "MUST", "first_attempt", "reference:uses", u(), [r("single_use_authority")]),
  pattern("first-attempt-uses-input", "evidence", "MUST", "first_attempt", "reference:uses", u(), [r("input")]),
  pattern("first-attempt-creates-effect", "evidence", "MUST", "first_attempt", "reference:creates", u(), [r("effect_occurrence")]),
  pattern("first-attempt-precedes-result", "evidence", "MUST", "first_attempt", "reference:precedes", u(), [r("first_result")]),
  pattern("first-result-accepts-attempt", "evidence", "MUST", "first_result", "reference:accepts", at("after", "first_attempt"), [r("first_attempt")]),
  pattern("expected-success-state-conforms", "evidence", "MUST", "expected_success_state", "reference:conforms_to", u(), [r("success_criterion")]),
  pattern("first-result-has-state", "evidence", "MUST", "first_result", "reference:has_state", at("after", "first_attempt"), [r("first_result_state")]),
  pattern("first-result-observation-records-state", "evidence", "MUST", "observation_after_first", "reference:records", at("after", "first_result"), [r("first_result_state"), r("effect_state_after_first")]),
  pattern("first-result-matches-expected-success", "behavior", "MUST", "first_result_state", "reference:equals", at("after", "first_result"), [r("expected_success_state")]),
  pattern("success-verification-reads-result", "evidence", "MUST", "success_verification", "reference:reads", at("after", "first_result"), [r("observation_after_first")]),
  pattern("success-verification", "verification", "MUST", "success_verification", "reference:covers", u(), [r("first_result")], {
    subject_role: "first_result_state", operator: "reference:not_equals",
    applicability_context: at("when", "first_use_failure_condition"), operands: [r("expected_success_state")]
  }),
  pattern("effect-state-after-first-use", "evidence", "MUST", "effect_subject", "reference:has_state", at("after", "first_result"), [r("effect_state_after_first")]),
  pattern("first-use-changes-effect-state", "behavior", "MUST", "effect_state_after_first", "reference:not_equals", at("after", "first_result"), [r("effect_state_before")]),
  pattern("first-effect-verification-reads-states", "evidence", "MUST", "first_effect_verification", "reference:reads", at("after", "first_result"), [r("observation_before"), r("observation_after_first")]),
  pattern("first-effect-verification", "verification", "MUST", "first_effect_verification", "reference:covers", u(), [r("effect_subject")], {
    subject_role: "effect_state_after_first", operator: "reference:equals",
    applicability_context: at("when", "no_first_effect_condition"), operands: [r("effect_state_before")]
  }),
  pattern("first-result-precedes-replay", "evidence", "MUST", "first_result", "reference:precedes", u(), [r("replay_attempt")]),
  pattern("replay-performs-same-operation", "evidence", "MUST", "replay_attempt", "reference:performs", at("after", "first_result"), [r("operation")]),
  pattern("replay-uses-same-authority", "evidence", "MUST", "replay_attempt", "reference:uses", at("after", "first_result"), [r("single_use_authority")]),
  pattern("replay-uses-same-input", "evidence", "MUST", "replay_attempt", "reference:uses", at("after", "first_result"), [r("input")]),
  pattern("authority-consumed-after-first-use", "behavior", "MUST_NOT", "single_use_authority", "reference:authorizes", at("after", "first_result"), [r("input")]),
  pattern("consumption-verification-reads-replay", "evidence", "MUST", "consumption_verification", "reference:reads", at("after", "replay_attempt"), [r("first_result"), r("replay_attempt")]),
  pattern("consumption-verification", "verification", "MUST", "consumption_verification", "reference:covers", u(), [r("single_use_authority")], {
    subject_role: "single_use_authority", operator: "reference:authorizes",
    applicability_context: at("when", "authority_still_live_condition"), operands: [r("input")]
  }),
  pattern("replay-attempt-precedes-refusal", "evidence", "MUST", "replay_attempt", "reference:precedes", u(), [r("replay_refusal")]),
  pattern("replay-refusal-rejects-replay", "evidence", "MUST", "replay_refusal", "reference:rejects", at("after", "replay_attempt"), [r("replay_attempt")]),
  pattern("replay-is-not-accepted", "behavior", "MUST_NOT", "replay_refusal", "reference:accepts", at("after", "replay_attempt"), [r("replay_attempt")]),
  pattern("replay-refusal-verification-reads-events", "evidence", "MUST", "replay_refusal_verification", "reference:reads", at("after", "replay_refusal"), [r("replay_attempt"), r("replay_refusal")]),
  pattern("replay-refusal-verification", "verification", "MUST", "replay_refusal_verification", "reference:covers", u(), [r("replay_refusal")], {
    subject_role: "replay_refusal", operator: "reference:accepts",
    applicability_context: at("when", "replay_accepted_condition"), operands: [r("replay_attempt")]
  }),
  pattern("replay-does-not-create-effect", "behavior", "MUST_NOT", "replay_attempt", "reference:creates", at("after", "first_result"), [r("effect_occurrence")]),
  pattern("replay-occurrence-verification-reads-events", "evidence", "MUST", "replay_occurrence_verification", "reference:reads", at("after", "replay_refusal"), [r("replay_attempt"), r("replay_refusal")]),
  pattern("replay-occurrence-verification", "verification", "MUST", "replay_occurrence_verification", "reference:covers", u(), [r("effect_occurrence")], {
    subject_role: "replay_attempt", operator: "reference:creates",
    applicability_context: at("when", "duplicate_effect_condition"), operands: [r("effect_occurrence")]
  }),
  pattern("effect-state-after-replay", "evidence", "MUST", "effect_subject", "reference:has_state", at("after", "replay_refusal"), [r("effect_state_after_replay")]),
  pattern("observation-after-replay-records-state", "evidence", "MUST", "observation_after_replay", "reference:records", at("after", "replay_refusal"), [r("effect_state_after_replay")]),
  pattern("effect-state-stable-after-replay", "behavior", "MUST", "effect_state_after_replay", "reference:equals", at("after", "replay_refusal"), [r("effect_state_after_first")]),
  pattern("replay-effect-verification-reads-states", "evidence", "MUST", "replay_effect_verification", "reference:reads", at("after", "replay_refusal"), [r("observation_after_first"), r("observation_after_replay")]),
  pattern("replay-effect-verification", "verification", "MUST", "replay_effect_verification", "reference:covers", u(), [r("effect_subject"), r("effect_occurrence")], {
    subject_role: "effect_state_after_replay", operator: "reference:not_equals",
    applicability_context: at("when", "duplicate_effect_condition"), operands: [r("effect_state_after_first")]
  })
];

const relations = [
  ["success-verifies-first-result", "success-verification", "first-result-matches-expected-success"],
  ["first-effect-verifies-transition", "first-effect-verification", "first-use-changes-effect-state"],
  ["consumption-verifies-authority", "consumption-verification", "authority-consumed-after-first-use"],
  ["refusal-verifies-replay", "replay-refusal-verification", "replay-is-not-accepted"],
  ["replay-occurrence-verifies-no-create", "replay-occurrence-verification", "replay-does-not-create-effect"],
  ["replay-effect-verifies-stability", "replay-effect-verification", "effect-state-stable-after-replay"]
].map(([pattern_id, source_claim_pattern_id, target_claim_pattern_id]) => ({
  pattern_id, required_by_stage: "pre_dispatch", role: "verifies",
  source_claim_pattern_id, target_claim_pattern_id
}));

const conditionByRelation = Object.freeze({
  "success-verifies-first-result": "first_use_failure_condition",
  "first-effect-verifies-transition": "no_first_effect_condition",
  "consumption-verifies-authority": "authority_still_live_condition",
  "refusal-verifies-replay": "replay_accepted_condition",
  "replay-occurrence-verifies-no-create": "duplicate_effect_condition",
  "replay-effect-verifies-stability": "duplicate_effect_condition"
});

const sequenceMembers = [
  "effect-state-before-first-use", "observation-before-records-state",
  "first-attempt-performs-operation", "first-attempt-precedes-result",
  "first-result-accepts-attempt", "effect-state-after-first-use",
  "first-use-changes-effect-state", "first-result-precedes-replay",
  "replay-performs-same-operation", "authority-consumed-after-first-use",
  "replay-attempt-precedes-refusal", "replay-refusal-rejects-replay",
  "replay-is-not-accepted",
  "effect-state-after-replay", "effect-state-stable-after-replay"
];

const collections = [
  {
    pattern_id: "proof-sequence", required_by_stage: "pre_dispatch",
    collection_kind: "ordered_sequence", match_mode: "subsequence",
    candidate_quantifier: "all_covering",
    collection_purpose: "proof_single_use_replay_refusal_sequence",
    member_claim_pattern_ids: sequenceMembers
  },
  {
    pattern_id: "proof-population", required_by_stage: "pre_dispatch",
    collection_kind: "closed_set", match_mode: "exact",
    candidate_quantifier: "all_covering",
    collection_purpose: "proof_single_use_replay_refusal_population",
    member_claim_pattern_ids: patterns.map(({ pattern_id }) => pattern_id)
  }
];

const profile = {
  schema_version: "controlled-contract-verification-profile.v1",
  contract_schema_version: "controlled-acceptance-contract.v1",
  vocabulary_version: VOCABULARY_VERSION_V1,
  vocabulary_signature_digest: V.signature,
  vocabulary_algebra_digest: V.algebra,
  vocabulary_definitions_digest: V.definitions,
  vocabulary_complete_digest: V.complete,
  profile_id: "proof.single-use.replay-refusal",
  profile_version: "2.0.0",
  evaluation_stages: ["pre_dispatch"],
  verification_falsifier_policy: "controlled_complement_per_target",
  reference_roles: Object.entries(roleTypes).map(([role, allowed_type_terms]) => ({
    role, allowed_type_terms,
    ...(abstractProfileTermRoles.has(role) ? {} : {
      allowed_identity_kinds: groundedIdentityKinds
    }),
    cardinality: "exactly_one"
  })),
  number_roles: [{ role: "effect_occurrence_count", cardinality: "exactly_one", number_type: "integer", minimum: 1, maximum: 1 }],
  distinct_reference_role_sets: [
    { roles: ["first_attempt", "first_result", "replay_attempt", "replay_refusal"] },
    { roles: ["effect_state_before", "effect_state_after_first", "effect_state_after_replay", "expected_success_state", "first_result_state"] },
    { roles: ["observation_before", "observation_after_first", "observation_after_replay"] },
    { roles: ["success_verification", "first_effect_verification", "consumption_verification", "replay_refusal_verification", "replay_occurrence_verification", "replay_effect_verification"] },
    { roles: ["first_use_failure_condition", "no_first_effect_condition", "authority_still_live_condition", "replay_accepted_condition", "duplicate_effect_condition"] }
  ],
  reference_binding_patterns: [],
  reference_role_count_bindings: [],
  claim_patterns: patterns,
  falsifier_condition_bindings: relations.map(({ pattern_id }) => ({
    relation_pattern_id: pattern_id,
    applicability_context: at("when", conditionByRelation[pattern_id])
  })),
  relation_patterns: relations,
  collection_patterns: collections,
  resolver_fact_patterns: [],
  evidence_patterns: [],
  satisfaction_expression: {
    all_of: [
      ...patterns.map(({ pattern_id }) => ({ pattern: pattern_id })),
      ...relations.map(({ pattern_id }) => ({ pattern: pattern_id })),
      ...collections.map(({ pattern_id }) => ({ pattern: pattern_id }))
    ]
  }
};

const refId = (role) => `ref-${role.replaceAll("_", "-")}`;
const refOperand = (role) => ({ kind: "reference", reference_id: refId(role) });
function instantiateTemplate(template, proposition_id) {
  return {
    proposition_id,
    subject_reference_id: refId(template.subject_role),
    operator: template.operator,
    applicability_context: {
      mode: template.applicability_context.mode,
      operand_reference_ids: template.applicability_context.operand_roles.map(refId)
    },
    operands: template.operands.map((operand) => operand.kind === "reference"
      ? refOperand(operand.role)
      : { kind: "number", value: 1 })
  };
}

function identityFor(role, domain, kind) {
  if (kind === "repository_path") return {
    kind, repository: domain, path: `fixtures/${role}.json`
  };
  if (kind === "code_symbol") return {
    kind, repository: domain, path: `src/${role}.mjs`, symbol: role
  };
  if (kind === "runtime_parameter") return { kind, name: `${domain}_${role}` };
  if (kind === "profile_term") return { kind, term: `${domain}:${role}` };
  return { kind: "durable_id", domain, value: role };
}

function buildFixture({
  domain = "password_reset",
  method = "test_execution",
  role_type_overrides: roleTypeOverrides = {},
  identity_kind_overrides: identityKindOverrides = {},
  mutate_contract: mutateContract,
  mutate_input: mutateInput
} = {}) {
  const references = Object.keys(roleTypes).map((role) => ({
    reference_id: refId(role),
    type_term: roleTypeOverrides[role] ?? roleType[role],
    identity: identityFor(
      role,
      domain,
      identityKindOverrides[role] ??
        (abstractProfileTermRoles.has(role) ? "profile_term" : "durable_id")
    )
  }));
  const propositions = [];
  const claims = [];
  for (const p of patterns) {
    propositions.push(instantiateTemplate(p.proposition_template, `prop-${p.pattern_id}`));
    const claim = {
      claim_id: `claim-${p.pattern_id}`, kind: p.claim_kind,
      modality: p.allowed_modalities[0], proposition_id: `prop-${p.pattern_id}`
    };
    if (p.claim_kind === "verification") {
      claim.verification_method = method;
      claim.falsifying_proposition_id = `prop-falsifier-${p.pattern_id}`;
      propositions.push(instantiateTemplate(p.falsifying_proposition_template, claim.falsifying_proposition_id));
    }
    claims.push(claim);
  }
  const contract = {
    schema_version: SCHEMA_VERSION_V1,
    vocabulary_version: VOCABULARY_VERSION_V1,
    profile_id: PROFILE_ID_V1,
    references, propositions, claims,
    relations: relations.map(({ pattern_id, source_claim_pattern_id, target_claim_pattern_id }) => ({
      relation_id: `rel-${pattern_id}`, role: "verifies",
      source_claim_id: `claim-${source_claim_pattern_id}`,
      target_claim_id: `claim-${target_claim_pattern_id}`
    })),
    collections: [
      {
        collection_id: "set-sequence-proof", collection_kind: "ordered_sequence",
        purpose: "proof_single_use_replay_refusal_sequence",
        member_claim_ids: sequenceMembers.map((id) => `claim-${id}`)
      },
      {
        collection_id: "set-population-proof", collection_kind: "closed_set",
        purpose: "proof_single_use_replay_refusal_population",
        member_claim_ids: patterns.map(({ pattern_id }) => `claim-${pattern_id}`)
      }
    ],
    residue: [], annotations: [], test_proof_version: "controlled-contract-test-proof.v1", test_proofs: []
  };
  const input = {
    input_version: EVALUATION_INPUT_VERSION_V1,
    evaluation_stage: "pre_dispatch",
    reference_bindings: Object.keys(roleTypes).map((role) => ({ role, reference_ids: [refId(role)] })),
    number_bindings: [{ role: "effect_occurrence_count", value: 1 }],
    claim_pattern_bindings: [], resolver_facts: [], delivered_evidence: [], stable_evaluation: {}
  };
  if (mutateContract) mutateContract(contract);
  if (mutateInput) mutateInput(input);
  return { contract, input };
}

function removeClaim(fixture, id) {
  const claimId = `claim-${id}`;
  const claim = fixture.contract.claims.find((x) => x.claim_id === claimId);
  const propositionIds = new Set([claim?.proposition_id, claim?.falsifying_proposition_id].filter(Boolean));
  fixture.contract.claims = fixture.contract.claims.filter((x) => x.claim_id !== claimId);
  fixture.contract.propositions = fixture.contract.propositions.filter((x) => !propositionIds.has(x.proposition_id));
  fixture.contract.relations = fixture.contract.relations.filter((x) => x.source_claim_id !== claimId && x.target_claim_id !== claimId);
  for (const c of fixture.contract.collections) c.member_claim_ids = c.member_claim_ids.filter((x) => x !== claimId);
}

function proposition(fixture, id, falsifier = false) {
  return fixture.contract.propositions.find((x) => x.proposition_id === `prop-${falsifier ? "falsifier-" : ""}${id}`);
}

function claim(fixture, id) {
  return fixture.contract.claims.find((x) => x.claim_id === `claim-${id}`);
}

function collapseRole(fixture, from, to) {
  const fromId = refId(from), toId = refId(to);
  fixture.contract.references = fixture.contract.references.filter((x) => x.reference_id !== fromId);
  for (const p of fixture.contract.propositions) {
    if (p.subject_reference_id === fromId) p.subject_reference_id = toId;
    p.applicability_context.operand_reference_ids = p.applicability_context.operand_reference_ids.map((x) => x === fromId ? toId : x);
    for (const operand of p.operands) if (operand.kind === "reference" && operand.reference_id === fromId) operand.reference_id = toId;
  }
  fixture.input.reference_bindings.find((x) => x.role === from).reference_ids = [toId];
}

export {
  buildFixture as buildSingleUseReplayRefusalFixture,
  claim as findSingleUseClaim,
  collapseRole as collapseSingleUseRole,
  patterns as SINGLE_USE_REPLAY_REFUSAL_PATTERNS,
  profile as SINGLE_USE_REPLAY_REFUSAL_PROFILE,
  proposition as findSingleUseProposition,
  refId as singleUseRoleReferenceId,
  removeClaim as removeSingleUseClaim,
  roleTypes as SINGLE_USE_REPLAY_REFUSAL_ROLE_TYPES,
  sequenceMembers as SINGLE_USE_REPLAY_REFUSAL_SEQUENCE_MEMBERS
};
