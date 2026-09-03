import { readFile } from "node:fs/promises";

import {
  PROFILE_ID_V1,
  SCHEMA_VERSION_V1,
  VOCABULARY_VERSION_V1
} from "../../lib/native-contract-carrier-v1.mjs";
import { EVALUATION_INPUT_VERSION_V1 } from "../support/stable-v1-proof-pack-runtime.mjs";

const CANCELLATION_ISOLATION_PROFILE = JSON.parse(await readFile(new URL(
  "../certification/profiles/proof.cancellation.isolation/2.0.0/profile.json",
  import.meta.url
), "utf8"));

const roleReferenceIds = Object.freeze(Object.fromEntries(
  CANCELLATION_ISOLATION_PROFILE.reference_roles.map(({ role }) => [
    role, `ref-${role.replaceAll("_", "-")}`
  ])
));

const referenceTypes = Object.freeze({
  operation: "cc:operation",
  cancellation_operation: "cc:operation",
  cancelled_generation: "cc:lifecycle_entity",
  surviving_generation: "cc:lifecycle_entity",
  cancelled_attempt: "cc:event",
  surviving_attempt: "cc:event",
  cancellation_request: "cc:event",
  cancellation_result: "cc:artifact",
  surviving_result: "cc:artifact",
  protected_resource: "cc:resource",
  surviving_authority: "cc:authority",
  cancelled_expected_state: "cc:state",
  cancelled_observed_state: "cc:state",
  survivor_state_before: "cc:state",
  survivor_state_after: "cc:state",
  expected_success_state: "cc:state",
  observed_success_state: "cc:state",
  cancellation_observation: "cc:evidence",
  state_before_observation: "cc:evidence",
  state_after_observation: "cc:evidence",
  success_observation: "cc:evidence",
  cancellation_verification: "cc:test",
  state_isolation_verification: "cc:test",
  authority_isolation_verification: "cc:test",
  success_verification: "cc:test",
  cancellation_criterion: "cc:criterion",
  success_criterion: "cc:criterion",
  cancellation_failed_condition: "cc:invariant",
  state_interference_condition: "cc:invariant",
  authority_interference_condition: "cc:invariant",
  survivor_failure_condition: "cc:invariant"
});

const groundedRoles = new Set([
  "operation", "cancellation_operation", "cancelled_generation",
  "surviving_generation", "cancelled_attempt", "surviving_attempt",
  "protected_resource", "surviving_authority"
]);
const PROOF_PATTERN_IDS = Object.freeze(
  CANCELLATION_ISOLATION_PROFILE.claim_patterns.map(({ pattern_id }) => pattern_id)
);
const PROOF_POPULATION_PURPOSE = "proof_cancellation_isolation_population";
const ref = (referenceId) => ({ kind: "reference", reference_id: referenceId });

function roleReferenceId(role) {
  return roleReferenceIds[role];
}

function identityFor(role, domain, identityPrefix) {
  if (groundedRoles.has(role)) return {
    kind: "durable_id",
    domain: `cancellation-${domain}`,
    value: `${identityPrefix}:${role}`
  };
  return { kind: "profile_term", term: `${identityPrefix}:${role}` };
}

function instantiateTemplate(template, patternId, { falsifier = false } = {}) {
  return {
    proposition_id: `prop-${falsifier ? "falsifier-" : ""}${patternId}`,
    subject_reference_id: roleReferenceId(template.subject_role),
    operator: template.operator,
    applicability_context: {
      mode: template.applicability_context.mode,
      operand_reference_ids: template.applicability_context.operand_roles.map(
        (role) => roleReferenceId(role)
      )
    },
    operands: template.operands.map((operand) => operand.kind === "reference"
      ? ref(roleReferenceId(operand.role))
      : structuredClone(operand))
  };
}

function buildCancellationIsolationFixture({
  domain = "search_session",
  profile: suppliedProfile = CANCELLATION_ISOLATION_PROFILE,
  role_type_overrides: roleTypeOverrides = {},
  role_identity_overrides: roleIdentityOverrides = {},
  verification_methods: verificationMethods = {},
  identity_prefix: identityPrefix = domain,
  mutate_contract: mutateContract,
  mutate_input: mutateInput
} = {}) {
  const profile = structuredClone(suppliedProfile);
  const references = Object.keys(roleReferenceIds).map((role) => ({
    reference_id: roleReferenceId(role),
    type_term: roleTypeOverrides[role] ?? referenceTypes[role],
    identity: structuredClone(
      roleIdentityOverrides[role] ?? identityFor(role, domain, identityPrefix)
    )
  }));
  const propositions = [];
  const claims = CANCELLATION_ISOLATION_PROFILE.claim_patterns.map((pattern) => {
    propositions.push(instantiateTemplate(
      pattern.proposition_template, pattern.pattern_id
    ));
    const claim = {
      claim_id: `claim-${pattern.pattern_id}`,
      kind: pattern.claim_kind,
      modality: pattern.allowed_modalities[0],
      proposition_id: `prop-${pattern.pattern_id}`
    };
    if (pattern.claim_kind === "verification") {
      claim.verification_method = verificationMethods[pattern.pattern_id] ??
        "test_execution";
      claim.falsifying_proposition_id = `prop-falsifier-${pattern.pattern_id}`;
      propositions.push(instantiateTemplate(
        pattern.falsifying_proposition_template, pattern.pattern_id,
        { falsifier: true }
      ));
    }
    return claim;
  });

  const contract = {
    schema_version: SCHEMA_VERSION_V1,
    vocabulary_version: VOCABULARY_VERSION_V1,
    profile_id: PROFILE_ID_V1,
    references,
    propositions,
    claims,
    relations: CANCELLATION_ISOLATION_PROFILE.relation_patterns.map((relation) => ({
      relation_id: `rel-${relation.pattern_id}`,
      role: relation.role,
      source_claim_id: `claim-${relation.source_claim_pattern_id}`,
      target_claim_id: `claim-${relation.target_claim_pattern_id}`
    })),
    collections: [{
      collection_id: "set-cancellation-isolation-proof-population",
      collection_kind: "closed_set",
      purpose: PROOF_POPULATION_PURPOSE,
      member_claim_ids: PROOF_PATTERN_IDS.map((patternId) => `claim-${patternId}`)
    }],
    residue: [],
    annotations: [], test_proof_version: "controlled-contract-test-proof.v1", test_proofs: []
  };

  const input = {
    input_version: EVALUATION_INPUT_VERSION_V1,
    evaluation_stage: "pre_dispatch",
    reference_bindings: Object.keys(roleReferenceIds).map((role) => ({
      role,
      reference_ids: [roleReferenceId(role)]
    })),
    number_bindings: [],
    claim_pattern_bindings: [],
    resolver_facts: [],
    delivered_evidence: [], stable_evaluation: {}
  };
  if (mutateContract) mutateContract(contract, input);
  if (mutateInput) mutateInput(input, contract);
  return { contract, input, profile };
}

function findClaim(contract, patternId) {
  return contract.claims.find(({ claim_id }) => claim_id === `claim-${patternId}`);
}

function findProposition(contract, patternId, { falsifier = false } = {}) {
  const id = `prop-${falsifier ? "falsifier-" : ""}${patternId}`;
  return contract.propositions.find(({ proposition_id }) => proposition_id === id);
}

function removePattern(contract, patternId) {
  const claimId = `claim-${patternId}`;
  const claim = findClaim(contract, patternId);
  if (claim) {
    const propositionIds = new Set([
      claim.proposition_id, claim.falsifying_proposition_id
    ].filter(Boolean));
    contract.propositions = contract.propositions.filter(
      ({ proposition_id }) => !propositionIds.has(proposition_id)
    );
  }
  contract.claims = contract.claims.filter(({ claim_id }) => claim_id !== claimId);
  contract.relations = contract.relations.filter(
    ({ source_claim_id, target_claim_id }) =>
      source_claim_id !== claimId && target_claim_id !== claimId
  );
  for (const collection of contract.collections) {
    collection.member_claim_ids = collection.member_claim_ids.filter(
      (candidateId) => candidateId !== claimId
    );
  }
}

function collapseReference(contract, input, fromRole, toRole) {
  const fromId = input.reference_bindings.find(
    ({ role }) => role === fromRole
  ).reference_ids[0];
  const toId = input.reference_bindings.find(
    ({ role }) => role === toRole
  ).reference_ids[0];
  if (fromId === toId) return;
  contract.references = contract.references.filter(
    ({ reference_id }) => reference_id !== fromId
  );
  for (const proposition of contract.propositions) {
    if (proposition.subject_reference_id === fromId) {
      proposition.subject_reference_id = toId;
    }
    proposition.applicability_context.operand_reference_ids =
      proposition.applicability_context.operand_reference_ids.map(
        (referenceId) => referenceId === fromId ? toId : referenceId
      );
    for (const operand of proposition.operands) {
      if (operand.kind === "reference" && operand.reference_id === fromId) {
        operand.reference_id = toId;
      }
    }
  }
  input.reference_bindings.find(({ role }) => role === fromRole).reference_ids = [toId];
}

export {
  CANCELLATION_ISOLATION_PROFILE,
  PROOF_PATTERN_IDS,
  PROOF_POPULATION_PURPOSE,
  buildCancellationIsolationFixture,
  collapseReference,
  findClaim,
  findProposition,
  ref,
  removePattern,
  roleReferenceId
};
