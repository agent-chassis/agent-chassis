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
  operation: ["cc:operation", "cc:process", "cc:command"],
  operation_attempt: ["cc:event"],
  failure_injection: ["cc:event"],
  injected_failure: ["cc:event", "cc:artifact"],
  failure_cause: ["cc:artifact", "cc:configuration", "cc:entity", "cc:state"],
  original_cause_state: ["cc:state"],
  settled_cause_state: ["cc:state"],
  cause_observation_at_failure: ["cc:artifact", "cc:evidence"],
  cause_observation_at_settlement: ["cc:artifact", "cc:evidence"],
  cleanup_event: ["cc:event", "cc:process"],
  settlement_event: ["cc:event"],
  residue_population: ["cc:population", "cc:resource", "cc:scope"],
  residue_observation: ["cc:artifact", "cc:evidence"],
  settled_failure_record: ["cc:artifact", "cc:evidence"],
  cleanup_verification: ["cc:process", "cc:test"],
  cause_verification: ["cc:process", "cc:test"],
  cleanup_failure_condition: ["cc:configuration", "cc:criterion", "cc:state"],
  cause_loss_condition: ["cc:configuration", "cc:criterion", "cc:state"]
});
const roleType = Object.fromEntries(Object.entries(roleTypes).map(([key, terms]) => [key, terms[0]]));
const abstractRoles = new Set(["cleanup_failure_condition", "cause_loss_condition"]);
const groundedIdentityKinds = [
  "repository_path", "code_symbol", "durable_id", "runtime_parameter"
];
const r = (role) => ({ kind: "reference", role });
const n = (role) => ({ kind: "number", value_role: role });
const u = () => ({ mode: "unconditional", operand_roles: [] });
const at = (mode, ...roles) => ({ mode, operand_roles: roles });

function pattern(id, kind, modality, subject, operator, context, operands, falsifier) {
  const value = {
    pattern_id: id,
    required_by_stage: "pre_dispatch",
    claim_kind: kind,
    allowed_modalities: [modality],
    proposition_template: {
      subject_role: subject,
      operator,
      applicability_context: context,
      operands
    }
  };
  if (falsifier) value.falsifying_proposition_template = falsifier;
  if (kind === "verification") value.verification_methods = [
    "analysis", "audit", "demonstration", "proof", "test_execution"
  ];
  return value;
}

const patterns = [
  pattern("attempt-performs-operation", "evidence", "MUST", "operation_attempt",
    "reference:performs", u(), [r("operation")]),
  pattern("failure-injection-precedes-failure", "evidence", "MUST", "failure_injection",
    "reference:precedes", at("during", "operation_attempt"), [r("injected_failure")]),
  pattern("injected-failure-targets-operation", "evidence", "MUST", "injected_failure",
    "reference:targets", at("during", "operation_attempt"), [r("operation")]),
  pattern("injected-failure-carries-cause", "evidence", "MUST", "injected_failure",
    "reference:has_property", u(), [r("failure_cause")]),
  pattern("original-failure-cause-state", "evidence", "MUST", "failure_cause",
    "reference:has_state", at("when", "injected_failure"), [r("original_cause_state")]),
  pattern("failure-cause-observation-records-original", "evidence", "MUST",
    "cause_observation_at_failure", "reference:records", at("when", "injected_failure"),
    [r("original_cause_state")]),
  pattern("cleanup-follows-injected-failure", "evidence", "MUST", "cleanup_event",
    "reference:follows", at("during", "operation_attempt"), [r("injected_failure")]),
  pattern("cleanup-targets-residue-population", "evidence", "MUST", "cleanup_event",
    "reference:targets", at("after", "injected_failure"), [r("residue_population")]),
  pattern("settlement-follows-cleanup", "evidence", "MUST", "settlement_event",
    "reference:follows", at("during", "operation_attempt"), [r("cleanup_event")]),
  pattern("settlement-follows-injected-failure", "evidence", "MUST", "settlement_event",
    "reference:follows", at("during", "operation_attempt"), [r("injected_failure")]),
  pattern("settled-residue-population-cardinality", "evidence", "MUST",
    "residue_population", "number:has_cardinality", at("after", "settlement_event"),
    [n("residue_count")]),
  pattern("residue-observation-records-population", "evidence", "MUST",
    "residue_observation", "reference:records", at("after", "settlement_event"),
    [r("residue_population")]),
  pattern("settled-failure-record-preserves-cause", "evidence", "MUST",
    "settled_failure_record", "reference:records", at("after", "settlement_event"),
    [r("failure_cause")]),
  pattern("settled-failure-cause-state", "evidence", "MUST", "failure_cause",
    "reference:has_state", at("after", "settlement_event"), [r("settled_cause_state")]),
  pattern("settled-cause-observation-records-state", "evidence", "MUST",
    "cause_observation_at_settlement", "reference:records", at("after", "settlement_event"),
    [r("settled_cause_state")]),
  pattern("cleanup-verification-reads-settlement", "evidence", "MUST",
    "cleanup_verification", "reference:reads", at("after", "settlement_event"),
    [r("residue_observation"), r("settlement_event")]),
  pattern("residue-population-empty-after-settlement", "behavior", "MUST",
    "residue_population", "number:equals", at("after", "settlement_event"),
    [{ kind: "number", value: 0 }]),
  pattern("cleanup-verification", "verification", "MUST", "cleanup_verification",
    "reference:covers", u(), [r("residue_population")], {
      subject_role: "residue_population",
      operator: "number:not_equals",
      applicability_context: at("when", "cleanup_failure_condition"),
      operands: [{ kind: "number", value: 0 }]
    }),
  pattern("cause-verification-reads-observations", "evidence", "MUST",
    "cause_verification", "reference:reads", at("after", "settlement_event"),
    [r("cause_observation_at_failure"), r("cause_observation_at_settlement"),
      r("settled_failure_record")]),
  pattern("original-failure-cause-preserved", "behavior", "MUST",
    "settled_cause_state", "reference:equals", at("after", "settlement_event"),
    [r("original_cause_state")]),
  pattern("cause-preservation-verification", "verification", "MUST", "cause_verification",
    "reference:covers", u(), [r("failure_cause")], {
      subject_role: "settled_cause_state",
      operator: "reference:not_equals",
      applicability_context: at("when", "cause_loss_condition"),
      operands: [r("original_cause_state")]
    })
];

const relations = [
  ["cleanup-verifies-empty-residue", "cleanup-verification",
    "residue-population-empty-after-settlement"],
  ["cause-verifies-preservation", "cause-preservation-verification",
    "original-failure-cause-preserved"]
].map(([pattern_id, source_claim_pattern_id, target_claim_pattern_id]) => ({
  pattern_id, required_by_stage: "pre_dispatch", role: "verifies",
  source_claim_pattern_id, target_claim_pattern_id
}));
const sequenceMembers = [
  "attempt-performs-operation", "failure-injection-precedes-failure",
  "injected-failure-carries-cause", "original-failure-cause-state",
  "cleanup-follows-injected-failure", "cleanup-targets-residue-population",
  "settlement-follows-cleanup", "settled-residue-population-cardinality",
  "residue-population-empty-after-settlement", "settled-failure-record-preserves-cause",
  "settled-failure-cause-state", "original-failure-cause-preserved"
];
const collections = [
  {
    pattern_id: "proof-sequence", required_by_stage: "pre_dispatch",
    collection_kind: "ordered_sequence", match_mode: "subsequence",
    candidate_quantifier: "all_covering",
    collection_purpose: "proof_failure_settlement_cleanup_sequence",
    member_claim_pattern_ids: sequenceMembers
  },
  {
    pattern_id: "proof-population", required_by_stage: "pre_dispatch",
    collection_kind: "closed_set", match_mode: "exact",
    candidate_quantifier: "all_covering",
    collection_purpose: "proof_failure_settlement_cleanup_population",
    member_claim_pattern_ids: patterns.map(({ pattern_id }) => pattern_id)
  }
];

const referenceRoles = Object.entries(roleTypes).map(([role, allowed_type_terms]) => ({
  role, allowed_type_terms,
  ...(!abstractRoles.has(role) ? { allowed_identity_kinds: groundedIdentityKinds } : {}),
  cardinality: "exactly_one"
}));
const profile = {
  schema_version: "controlled-contract-verification-profile.v1",
  profile_id: "proof.failure.settlement-and-cleanup",
  profile_version: "2.0.0",
  contract_schema_version: SCHEMA_VERSION_V1,
  vocabulary_version: VOCABULARY_VERSION_V1,
  vocabulary_signature_digest: V.signature,
  vocabulary_algebra_digest: V.algebra,
  vocabulary_definitions_digest: V.definitions,
  vocabulary_complete_digest: V.complete,
  evaluation_stages: ["pre_dispatch"],
  reference_roles: referenceRoles,
  number_roles: [{
    role: "residue_count", cardinality: "exactly_one", number_type: "integer", minimum: 0
  }],
  distinct_reference_role_sets: [
    { roles: ["operation_attempt", "failure_injection", "injected_failure", "cleanup_event",
      "settlement_event"] },
    { roles: ["original_cause_state", "settled_cause_state", "cleanup_failure_condition",
      "cause_loss_condition"] },
    { roles: ["cause_observation_at_failure", "cause_observation_at_settlement",
      "settled_failure_record"] },
    { roles: ["cleanup_verification", "cause_verification"] },
    { roles: ["operation", "residue_population", "failure_cause"] }
  ],
  reference_binding_patterns: [],
  reference_role_count_bindings: [],
  claim_patterns: patterns,
  relation_patterns: relations,
  falsifier_condition_bindings: [
    { relation_pattern_id: "cleanup-verifies-empty-residue",
      applicability_context: at("when", "cleanup_failure_condition") },
    { relation_pattern_id: "cause-verifies-preservation",
      applicability_context: at("when", "cause_loss_condition") }
  ],
  collection_patterns: collections,
  resolver_fact_patterns: [],
  evidence_patterns: [],
  verification_falsifier_policy: "controlled_complement_per_target",
  satisfaction_expression: {
    all_of: [
      ...patterns.map(({ pattern_id: patternName }) => ({ pattern: patternName })),
      ...relations.map(({ pattern_id: patternName }) => ({ pattern: patternName })),
      ...collections.map(({ pattern_id: patternName }) => ({ pattern: patternName }))
    ]
  }
};

const refId = (role) => `ref-${role.replaceAll("_", "-")}`;
const refOperand = (role) => ({ kind: "reference", reference_id: refId(role) });
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
function instantiateTemplate(template, propositionId, numberValues) {
  return {
    proposition_id: propositionId,
    subject_reference_id: refId(template.subject_role),
    operator: template.operator,
    applicability_context: {
      mode: template.applicability_context.mode,
      operand_reference_ids: template.applicability_context.operand_roles.map(refId)
    },
    operands: template.operands.map((operand) => operand.kind === "reference"
      ? refOperand(operand.role)
      : { kind: "number", value: operand.value ?? numberValues[operand.value_role] })
  };
}

function buildFailureSettlementCleanupFixture({
  domain = "file_upload", residue_count: residueCount = 0,
  method = "test_execution", role_type_overrides: roleTypeOverrides = {},
  identity_kind_overrides: identityKindOverrides = {},
  mutate_contract: mutateContract, mutate_input: mutateInput
} = {}) {
  const references = Object.keys(roleTypes).map((role) => ({
    reference_id: refId(role),
    type_term: roleTypeOverrides[role] ?? roleType[role],
    identity: identityFor(role, domain, identityKindOverrides[role] ??
      (abstractRoles.has(role) ? "profile_term" : "durable_id"))
  }));
  const numberValues = { residue_count: residueCount };
  const propositions = [];
  const claims = [];
  for (const p of patterns) {
    propositions.push(instantiateTemplate(p.proposition_template, `prop-${p.pattern_id}`, numberValues));
    const claim = {
      claim_id: `claim-${p.pattern_id}`, kind: p.claim_kind,
      modality: p.allowed_modalities[0], proposition_id: `prop-${p.pattern_id}`
    };
    if (p.claim_kind === "verification") {
      propositions.push(instantiateTemplate(
        p.falsifying_proposition_template, `prop-falsifier-${p.pattern_id}`, numberValues
      ));
      claim.verification_method = method;
      claim.falsifying_proposition_id = `prop-falsifier-${p.pattern_id}`;
    }
    claims.push(claim);
  }
  const contract = {
    schema_version: SCHEMA_VERSION_V1, vocabulary_version: VOCABULARY_VERSION_V1,
    profile_id: PROFILE_ID_V1, references, propositions, claims,
    relations: relations.map(({ pattern_id, source_claim_pattern_id, target_claim_pattern_id }) => ({
      relation_id: `rel-${pattern_id}`, role: "verifies",
      source_claim_id: `claim-${source_claim_pattern_id}`,
      target_claim_id: `claim-${target_claim_pattern_id}`
    })),
    collections: [
      { collection_id: "set-proof-sequence", collection_kind: "ordered_sequence",
        purpose: "proof_failure_settlement_cleanup_sequence",
        member_claim_ids: sequenceMembers.map((id) => `claim-${id}`) },
      { collection_id: "set-proof-population", collection_kind: "closed_set",
        purpose: "proof_failure_settlement_cleanup_population",
        member_claim_ids: patterns.map(({ pattern_id }) => `claim-${pattern_id}`) }
    ],
    residue: [], annotations: [], test_proof_version: "controlled-contract-test-proof.v1", test_proofs: []
  };
  const input = {
    input_version: EVALUATION_INPUT_VERSION_V1, evaluation_stage: "pre_dispatch",
    reference_bindings: Object.keys(roleTypes).map((role) => ({
      role, reference_ids: [refId(role)]
    })),
    number_bindings: [{ role: "residue_count", value: residueCount }],
    claim_pattern_bindings: [], resolver_facts: [], delivered_evidence: [], stable_evaluation: {}
  };
  if (mutateContract) mutateContract(contract);
  if (mutateInput) mutateInput(input);
  return { contract, input };
}

function findProposition(fixture, patternId, falsifier = false) {
  return fixture.contract.propositions.find(({ proposition_id: id }) =>
    id === `prop-${falsifier ? "falsifier-" : ""}${patternId}`
  );
}
function findClaim(fixture, patternId) {
  return fixture.contract.claims.find(({ claim_id: id }) => id === `claim-${patternId}`);
}
function removeClaim(fixture, patternId) {
  const claimId = `claim-${patternId}`;
  const claim = findClaim(fixture, patternId);
  const propositionIds = new Set([claim?.proposition_id, claim?.falsifying_proposition_id].filter(Boolean));
  fixture.contract.claims = fixture.contract.claims.filter(({ claim_id: id }) => id !== claimId);
  fixture.contract.propositions = fixture.contract.propositions.filter(
    ({ proposition_id: id }) => !propositionIds.has(id)
  );
  fixture.contract.relations = fixture.contract.relations.filter(
    ({ source_claim_id: source, target_claim_id: target }) =>
      source !== claimId && target !== claimId
  );
  for (const collection of fixture.contract.collections) {
    collection.member_claim_ids = collection.member_claim_ids.filter((id) => id !== claimId);
  }
}
function collapseRole(fixture, fromRole, toRole) {
  const fromId = refId(fromRole);
  const toId = refId(toRole);
  fixture.contract.references = fixture.contract.references.filter(
    ({ reference_id: id }) => id !== fromId
  );
  for (const proposition of fixture.contract.propositions) {
    if (proposition.subject_reference_id === fromId) proposition.subject_reference_id = toId;
    proposition.applicability_context.operand_reference_ids =
      proposition.applicability_context.operand_reference_ids.map(
        (id) => id === fromId ? toId : id
      );
    for (const operand of proposition.operands) if (
      operand.kind === "reference" && operand.reference_id === fromId
    ) operand.reference_id = toId;
  }
  fixture.input.reference_bindings.find(({ role }) => role === fromRole).reference_ids = [toId];
}

export {
  buildFailureSettlementCleanupFixture,
  collapseRole as collapseFailureSettlementRole,
  findClaim as findFailureSettlementClaim,
  findProposition as findFailureSettlementProposition,
  patterns as FAILURE_SETTLEMENT_CLEANUP_PATTERNS,
  profile as FAILURE_SETTLEMENT_CLEANUP_PROFILE,
  refId as failureSettlementRoleReferenceId,
  removeClaim as removeFailureSettlementClaim,
  roleTypes as FAILURE_SETTLEMENT_CLEANUP_ROLE_TYPES,
  sequenceMembers as FAILURE_SETTLEMENT_CLEANUP_SEQUENCE_MEMBERS
};
