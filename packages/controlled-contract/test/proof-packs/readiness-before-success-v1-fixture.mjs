import { readFile } from "node:fs/promises";

import {
  PROFILE_ID_V034,
  SCHEMA_VERSION_V034,
  VOCABULARY_VERSION_V034
} from "../../lib/native-contract-carrier-v034.mjs";
import { EVALUATION_INPUT_VERSION_V034 } from "../../lib/verification-profile-v034.mjs";

const READINESS_BEFORE_SUCCESS_PROFILE = JSON.parse(await readFile(new URL(
  "../certification/profiles/proof.readiness.before-success/1.0.0/profile.json",
  import.meta.url
), "utf8"));

const roleReferenceIds = Object.freeze({
  initialization_operation: "ref-initialization-operation",
  readiness_operation: "ref-readiness-operation",
  capability: "ref-capability",
  initialization_attempt: "ref-initialization-attempt",
  readiness_probe: "ref-readiness-probe",
  readiness_result: "ref-readiness-result",
  completion_report: "ref-completion-report",
  expected_ready_state: "ref-expected-ready-state",
  observed_ready_state: "ref-observed-ready-state",
  readiness_observation: "ref-readiness-observation",
  readiness_state_verification: "ref-readiness-state-verification",
  readiness_order_verification: "ref-readiness-order-verification",
  success_criterion: "ref-success-criterion",
  not_ready_condition: "ref-not-ready-condition",
  premature_completion_condition: "ref-premature-completion-condition"
});

const referenceTypes = Object.freeze({
  initialization_operation: "cc:operation",
  readiness_operation: "cc:operation",
  capability: "cc:capability",
  initialization_attempt: "cc:event",
  readiness_probe: "cc:event",
  readiness_result: "cc:artifact",
  completion_report: "cc:artifact",
  expected_ready_state: "cc:state",
  observed_ready_state: "cc:state",
  readiness_observation: "cc:evidence",
  readiness_state_verification: "cc:test",
  readiness_order_verification: "cc:test",
  success_criterion: "cc:criterion",
  not_ready_condition: "cc:invariant",
  premature_completion_condition: "cc:invariant"
});

const groundedRoles = new Set([
  "initialization_operation", "readiness_operation", "capability"
]);
const PROOF_PATTERN_IDS = Object.freeze(
  READINESS_BEFORE_SUCCESS_PROFILE.claim_patterns.map(
    ({ pattern_id: patternId }) => patternId
  )
);
const PROOF_POPULATION_PURPOSE = "proof_readiness_before_success_population";

const ref = (referenceId) => ({ kind: "reference", reference_id: referenceId });

function roleReferenceId(role, timing = "before") {
  void timing;
  return roleReferenceIds[role];
}

function identityFor(role, domain, identityPrefix) {
  if (groundedRoles.has(role)) return {
    kind: "durable_id",
    domain: `readiness-${domain}`,
    value: `${identityPrefix}:${role}`
  };
  return { kind: "profile_term", term: `${identityPrefix}:${role}` };
}

function instantiateTemplate(template, patternId, timing, { falsifier = false } = {}) {
  return {
    proposition_id: `prop-${falsifier ? "falsifier-" : ""}${patternId}`,
    subject_reference_id: roleReferenceId(template.subject_role, timing),
    operator: template.operator,
    applicability_context: {
      mode: template.applicability_context.mode,
      operand_reference_ids: template.applicability_context.operand_roles.map(
        (role) => roleReferenceId(role, timing)
      )
    },
    operands: template.operands.map((operand) => operand.kind === "reference"
      ? ref(roleReferenceId(operand.role, timing))
      : structuredClone(operand))
  };
}

function buildReadinessBeforeSuccessFixture({
  domain = "message_broker",
  timing = "before",
  profile: suppliedProfile = READINESS_BEFORE_SUCCESS_PROFILE,
  role_type_overrides: roleTypeOverrides = {},
  role_identity_overrides: roleIdentityOverrides = {},
  readiness_state_verification_method: stateMethod = "test_execution",
  readiness_order_verification_method: orderMethod = "test_execution",
  identity_prefix: identityPrefix = domain,
  mutate_contract: mutateContract,
  mutate_input: mutateInput
} = {}) {
  if (!["before", "at"].includes(timing)) {
    throw new Error(`unknown readiness timing ${timing}`);
  }
  const profile = structuredClone(suppliedProfile);
  const canonicalPatterns = READINESS_BEFORE_SUCCESS_PROFILE.claim_patterns;
  const id = (role) => roleReferenceId(role, timing);
  const references = Object.keys(roleReferenceIds).map((role) => ({
    reference_id: id(role),
    type_term: roleTypeOverrides[role] ?? referenceTypes[role],
    identity: structuredClone(
      roleIdentityOverrides[role] ?? identityFor(role, domain, identityPrefix)
    )
  }));

  const propositions = [];
  const claims = canonicalPatterns.map((pattern) => {
    propositions.push(instantiateTemplate(
      pattern.proposition_template, pattern.pattern_id, timing
    ));
    const claim = {
      claim_id: `claim-${pattern.pattern_id}`,
      kind: pattern.claim_kind,
      modality: pattern.allowed_modalities[0],
      proposition_id: `prop-${pattern.pattern_id}`
    };
    if (pattern.claim_kind === "verification") {
      const method = pattern.pattern_id === "readiness-state-verification"
        ? stateMethod : orderMethod;
      claim.verification_method = method;
      claim.falsifying_proposition_id = `prop-falsifier-${pattern.pattern_id}`;
      propositions.push(instantiateTemplate(
        pattern.falsifying_proposition_template, pattern.pattern_id, timing,
        { falsifier: true }
      ));
    }
    return claim;
  });

  const contract = {
    schema_version: SCHEMA_VERSION_V034,
    vocabulary_version: VOCABULARY_VERSION_V034,
    profile_id: PROFILE_ID_V034,
    references,
    propositions,
    claims,
    relations: READINESS_BEFORE_SUCCESS_PROFILE.relation_patterns.map((relation) => ({
      relation_id: `rel-${relation.pattern_id}`,
      role: relation.role,
      source_claim_id: `claim-${relation.source_claim_pattern_id}`,
      target_claim_id: `claim-${relation.target_claim_pattern_id}`
    })),
    collections: [{
      collection_id: "set-readiness-proof-population",
      collection_kind: "closed_set",
      purpose: PROOF_POPULATION_PURPOSE,
      member_claim_ids: PROOF_PATTERN_IDS.map((patternId) => `claim-${patternId}`)
    }],
    residue: [],
    annotations: []
  };

  const input = {
    input_version: EVALUATION_INPUT_VERSION_V034,
    evaluation_stage: "pre_dispatch",
    reference_bindings: Object.keys(roleReferenceIds).map((role) => ({
      role,
      reference_ids: [id(role)]
    })),
    number_bindings: [],
    claim_pattern_bindings: [],
    resolver_facts: [],
    delivered_evidence: []
  };

  if (mutateContract) mutateContract(contract, input);
  if (mutateInput) mutateInput(input, contract);
  return { contract, input, profile };
}

function findClaim(contract, patternId) {
  return contract.claims.find(({ claim_id: claimId }) =>
    claimId === `claim-${patternId}`
  );
}

function findProposition(contract, patternId, { falsifier = false } = {}) {
  const propositionId = `prop-${falsifier ? "falsifier-" : ""}${patternId}`;
  return contract.propositions.find(({ proposition_id: candidateId }) =>
    candidateId === propositionId
  );
}

function removePattern(contract, patternId) {
  const claimId = `claim-${patternId}`;
  const claim = findClaim(contract, patternId);
  if (claim) {
    const propositionIds = new Set([
      claim.proposition_id, claim.falsifying_proposition_id
    ].filter(Boolean));
    contract.propositions = contract.propositions.filter(
      ({ proposition_id: propositionId }) => !propositionIds.has(propositionId)
    );
  }
  contract.claims = contract.claims.filter(
    ({ claim_id: candidateId }) => candidateId !== claimId
  );
  contract.relations = contract.relations.filter(
    ({ source_claim_id: source, target_claim_id: target }) =>
      source !== claimId && target !== claimId
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
    ({ reference_id: referenceId }) => referenceId !== fromId
  );
  for (const proposition of contract.propositions) {
    if (proposition.subject_reference_id === fromId) proposition.subject_reference_id = toId;
    proposition.applicability_context.operand_reference_ids =
      proposition.applicability_context.operand_reference_ids.map(
        (referenceId) => referenceId === fromId ? toId : referenceId
      );
    for (const operand of proposition.operands) if (
      operand.kind === "reference" && operand.reference_id === fromId
    ) operand.reference_id = toId;
  }
  input.reference_bindings.find(({ role }) => role === fromRole).reference_ids = [toId];
}

export {
  PROOF_PATTERN_IDS,
  PROOF_POPULATION_PURPOSE,
  READINESS_BEFORE_SUCCESS_PROFILE,
  buildReadinessBeforeSuccessFixture,
  collapseReference,
  findClaim,
  findProposition,
  ref,
  removePattern,
  roleReferenceId
};
