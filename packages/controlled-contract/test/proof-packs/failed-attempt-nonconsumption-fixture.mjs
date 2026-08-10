import { readFile } from "node:fs/promises";

import {
  PROFILE_ID_V034,
  SCHEMA_VERSION_V034,
  VOCABULARY_VERSION_V034
} from "../../lib/native-contract-carrier-v034.mjs";
import { EVALUATION_INPUT_VERSION_V034 } from "../../lib/verification-profile-v034.mjs";

const FAILED_ATTEMPT_NONCONSUMPTION_PROFILE = JSON.parse(await readFile(new URL(
  "../certification/profiles/proof.authorization.failed-attempt-nonconsumption/1.0.0/profile.json",
  import.meta.url
), "utf8"));

const roleReferenceIds = Object.freeze({
  operation: "ref-operation",
  legitimate_authority: "ref-legitimate-authority",
  failed_attempt: "ref-failed-attempt",
  valid_attempt: "ref-valid-attempt",
  failed_input: "ref-failed-input",
  valid_input: "ref-valid-input",
  refusal: "ref-refusal",
  valid_result: "ref-valid-result",
  authority_state_before: "ref-authority-state-before",
  authority_state_after_refusal: "ref-authority-state-after-refusal",
  expected_success_state: "ref-expected-success-state",
  valid_result_state: "ref-valid-result-state",
  observation_before_failed_attempt: "ref-observation-before-failed-attempt",
  observation_after_refusal: "ref-observation-after-refusal",
  valid_result_observation: "ref-valid-result-observation",
  nonconsumption_verification: "ref-nonconsumption-verification",
  later_use_verification: "ref-later-use-verification",
  success_criterion: "ref-success-criterion",
  failed_attempt_consumption_condition: "ref-failed-attempt-consumption-condition",
  valid_use_failure_condition: "ref-valid-use-failure-condition"
});

const referenceTypes = Object.freeze({
  operation: "cc:operation",
  legitimate_authority: "cc:authority",
  failed_attempt: "cc:event",
  valid_attempt: "cc:event",
  failed_input: "cc:actor",
  valid_input: "cc:actor",
  refusal: "cc:event",
  valid_result: "cc:artifact",
  authority_state_before: "cc:state",
  authority_state_after_refusal: "cc:state",
  expected_success_state: "cc:state",
  valid_result_state: "cc:state",
  observation_before_failed_attempt: "cc:evidence",
  observation_after_refusal: "cc:evidence",
  valid_result_observation: "cc:evidence",
  nonconsumption_verification: "cc:test",
  later_use_verification: "cc:test",
  success_criterion: "cc:criterion",
  failed_attempt_consumption_condition: "cc:invariant",
  valid_use_failure_condition: "cc:invariant"
});

const PROOF_PATTERN_IDS = Object.freeze(
  FAILED_ATTEMPT_NONCONSUMPTION_PROFILE.claim_patterns.map(
    ({ pattern_id: patternId }) => patternId
  )
);
const PROOF_POPULATION_PURPOSE =
  "proof_authorization_failed_attempt_nonconsumption_population";

const ref = (referenceId) => ({ kind: "reference", reference_id: referenceId });
const unconditional = () => ({ mode: "unconditional", operand_reference_ids: [] });
const scoped = (mode, ...referenceIds) => ({
  mode,
  operand_reference_ids: referenceIds
});

function roleReferenceId(role) {
  return roleReferenceIds[role];
}

function proposition(patternId, subjectRole, operator, applicability, operandRoles, {
  falsifier = false
} = {}) {
  return {
    proposition_id: `prop-${falsifier ? "falsifier-" : ""}${patternId}`,
    subject_reference_id: roleReferenceId(subjectRole),
    operator,
    applicability_context: applicability,
    operands: operandRoles.map((role) => ref(roleReferenceId(role)))
  };
}

function claim(patternId, kind, modality, extras = {}) {
  return {
    claim_id: `claim-${patternId}`,
    kind,
    modality,
    proposition_id: `prop-${patternId}`,
    ...extras
  };
}

function buildFailedAttemptNonconsumptionFixture({
  domain = "capability",
  profile: suppliedProfile = FAILED_ATTEMPT_NONCONSUMPTION_PROFILE,
  role_type_overrides: roleTypeOverrides = {},
  nonconsumption_verification_method: nonconsumptionMethod = "test_execution",
  later_use_verification_method: laterUseMethod = "test_execution",
  identity_prefix: identityPrefix = domain,
  mutate_contract: mutateContract,
  mutate_input: mutateInput
} = {}) {
  const profile = structuredClone(suppliedProfile);
  const id = roleReferenceId;
  const references = Object.keys(roleReferenceIds).map((role) => ({
    reference_id: id(role),
    type_term: roleTypeOverrides[role] ?? referenceTypes[role],
    identity: { kind: "profile_term", term: `${identityPrefix}:${role}` }
  }));

  const propositions = [
    proposition("authority-state-before-failed-attempt", "legitimate_authority",
      "reference:has_state", scoped("before", id("failed_attempt")),
      ["authority_state_before"]),
    proposition("authority-state-before-observation-record",
      "observation_before_failed_attempt", "reference:records",
      scoped("before", id("failed_attempt")), ["authority_state_before"]),
    proposition("failed-attempt-performs-operation", "failed_attempt",
      "reference:performs", unconditional(), ["operation"]),
    proposition("failed-attempt-uses-authority", "failed_attempt",
      "reference:uses", unconditional(), ["legitimate_authority"]),
    proposition("failed-attempt-uses-input", "failed_attempt",
      "reference:uses", unconditional(), ["failed_input"]),
    proposition("failed-input-unauthorized", "legitimate_authority",
      "reference:authorizes", scoped("where", id("operation")), ["failed_input"]),
    proposition("refusal-rejects-failed-attempt", "refusal", "reference:rejects",
      scoped("after", id("failed_attempt")), ["failed_attempt"]),
    proposition("failed-attempt-precedes-refusal", "failed_attempt",
      "reference:precedes", unconditional(), ["refusal"]),
    proposition("authority-state-after-refusal", "legitimate_authority",
      "reference:has_state", scoped("after", id("refusal")),
      ["authority_state_after_refusal"]),
    proposition("authority-state-after-refusal-observation-record",
      "observation_after_refusal", "reference:records",
      scoped("after", id("refusal")), ["authority_state_after_refusal"]),
    proposition("nonconsumption-verification-reads-before",
      "nonconsumption_verification", "reference:reads",
      scoped("after", id("refusal")), ["observation_before_failed_attempt"]),
    proposition("nonconsumption-verification-reads-after",
      "nonconsumption_verification", "reference:reads",
      scoped("after", id("refusal")), ["observation_after_refusal"]),
    proposition("authority-state-preserved", "authority_state_after_refusal",
      "reference:equals", scoped("after", id("refusal")),
      ["authority_state_before"]),
    proposition("nonconsumption-verification", "nonconsumption_verification",
      "reference:covers", unconditional(), ["legitimate_authority"]),
    proposition("nonconsumption-verification", "authority_state_after_refusal",
      "reference:not_equals",
      scoped("when", id("failed_attempt_consumption_condition")),
      ["authority_state_before"], { falsifier: true }),
    proposition("refusal-precedes-valid-attempt", "refusal", "reference:precedes",
      unconditional(), ["valid_attempt"]),
    proposition("valid-attempt-performs-operation", "valid_attempt",
      "reference:performs", scoped("after", id("refusal")), ["operation"]),
    proposition("valid-attempt-uses-authority", "valid_attempt", "reference:uses",
      scoped("after", id("refusal")), ["legitimate_authority"]),
    proposition("valid-attempt-uses-input", "valid_attempt", "reference:uses",
      scoped("after", id("refusal")), ["valid_input"]),
    proposition("valid-input-authorized", "legitimate_authority",
      "reference:authorizes", scoped("where", id("operation")), ["valid_input"]),
    proposition("valid-result-accepts-attempt", "valid_result", "reference:accepts",
      scoped("after", id("valid_attempt")), ["valid_attempt"]),
    proposition("expected-success-state-classification", "expected_success_state",
      "reference:conforms_to", unconditional(), ["success_criterion"]),
    proposition("valid-result-state", "valid_result", "reference:has_state",
      scoped("after", id("valid_attempt")), ["valid_result_state"]),
    proposition("valid-result-observation-record", "valid_result_observation",
      "reference:records", scoped("after", id("valid_attempt")),
      ["valid_result_state"]),
    proposition("later-use-verification-reads-result", "later_use_verification",
      "reference:reads", scoped("after", id("valid_attempt")),
      ["valid_result_observation"]),
    proposition("valid-result-matches-expected-success", "valid_result_state",
      "reference:equals", scoped("after", id("valid_attempt")),
      ["expected_success_state"]),
    proposition("later-use-verification", "later_use_verification",
      "reference:covers", unconditional(), ["valid_result"]),
    proposition("later-use-verification", "valid_result_state",
      "reference:not_equals", scoped("when", id("valid_use_failure_condition")),
      ["expected_success_state"], { falsifier: true })
  ];

  const claims = [
    claim("authority-state-before-failed-attempt", "evidence", "MUST"),
    claim("authority-state-before-observation-record", "evidence", "MUST"),
    claim("failed-attempt-performs-operation", "evidence", "MUST"),
    claim("failed-attempt-uses-authority", "evidence", "MUST"),
    claim("failed-attempt-uses-input", "evidence", "MUST"),
    claim("failed-input-unauthorized", "evidence", "MUST_NOT"),
    claim("refusal-rejects-failed-attempt", "evidence", "MUST"),
    claim("failed-attempt-precedes-refusal", "evidence", "MUST"),
    claim("authority-state-after-refusal", "evidence", "MUST"),
    claim("authority-state-after-refusal-observation-record", "evidence", "MUST"),
    claim("nonconsumption-verification-reads-before", "evidence", "MUST"),
    claim("nonconsumption-verification-reads-after", "evidence", "MUST"),
    claim("authority-state-preserved", "behavior", "MUST"),
    claim("nonconsumption-verification", "verification", "MUST", {
      verification_method: nonconsumptionMethod,
      falsifying_proposition_id: "prop-falsifier-nonconsumption-verification"
    }),
    claim("refusal-precedes-valid-attempt", "evidence", "MUST"),
    claim("valid-attempt-performs-operation", "evidence", "MUST"),
    claim("valid-attempt-uses-authority", "evidence", "MUST"),
    claim("valid-attempt-uses-input", "evidence", "MUST"),
    claim("valid-input-authorized", "evidence", "MUST"),
    claim("valid-result-accepts-attempt", "evidence", "MUST"),
    claim("expected-success-state-classification", "evidence", "MUST"),
    claim("valid-result-state", "evidence", "MUST"),
    claim("valid-result-observation-record", "evidence", "MUST"),
    claim("later-use-verification-reads-result", "evidence", "MUST"),
    claim("valid-result-matches-expected-success", "behavior", "MUST"),
    claim("later-use-verification", "verification", "MUST", {
      verification_method: laterUseMethod,
      falsifying_proposition_id: "prop-falsifier-later-use-verification"
    })
  ];

  const contract = {
    schema_version: SCHEMA_VERSION_V034,
    vocabulary_version: VOCABULARY_VERSION_V034,
    profile_id: PROFILE_ID_V034,
    references,
    propositions,
    claims,
    relations: [
      {
        relation_id: "rel-verification-target-nonconsumption",
        role: "verifies",
        source_claim_id: "claim-nonconsumption-verification",
        target_claim_id: "claim-authority-state-preserved"
      },
      {
        relation_id: "rel-verification-target-later-use",
        role: "verifies",
        source_claim_id: "claim-later-use-verification",
        target_claim_id: "claim-valid-result-matches-expected-success"
      }
    ],
    collections: [
      {
        collection_id: "set-proof-population",
        collection_kind: "closed_set",
        purpose: PROOF_POPULATION_PURPOSE,
        member_claim_ids: PROOF_PATTERN_IDS.map((patternId) =>
          `claim-${patternId}`
        )
      }
    ],
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

  if (mutateContract) mutateContract(contract);
  if (mutateInput) mutateInput(input);
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

export {
  FAILED_ATTEMPT_NONCONSUMPTION_PROFILE,
  PROOF_PATTERN_IDS,
  PROOF_POPULATION_PURPOSE,
  buildFailedAttemptNonconsumptionFixture,
  findClaim,
  findProposition,
  ref,
  roleReferenceId
};
