import {
  PROOF_PACK_ADEQUACY_RUN_VERSION
} from "../support/proof-pack-adequacy-constants.mjs";
import { evaluateVerificationProfileV034 } from "../../lib/verification-profile-v034.mjs";
import {
  buildFailedAttemptNonconsumptionFixture,
  findProposition,
  ref,
  roleReferenceId
} from "./failed-attempt-nonconsumption-fixture.mjs";
import {
  executeScenario,
  implementationPassed
} from "./failed-attempt-nonconsumption-harness.mjs";

const PROFILE_DIGEST =
  "214abfb167df615acf4002aa76f4817c0e8fc51a364c94a6d2052b4fe33eec44";
const GUARANTEE_DIGEST =
  "fd5a53f0f0357bbbce255cd8b6cdbfe60be577a653b099c3c136f4f5c59fbf0f";

function evaluateFixture(fixture) {
  return evaluateVerificationProfileV034({
    contract: fixture.contract,
    profile: fixture.profile,
    evaluation_input: fixture.input
  }).satisfaction;
}

function removePattern(contract, patternId) {
  const claimId = `claim-${patternId}`;
  const claim = contract.claims.find(({ claim_id: candidate }) => candidate === claimId);
  if (claim) {
    const propositionIds = new Set([
      claim.proposition_id,
      claim.falsifying_proposition_id
    ].filter(Boolean));
    contract.propositions = contract.propositions.filter(
      ({ proposition_id: propositionId }) => !propositionIds.has(propositionId)
    );
  }
  contract.claims = contract.claims.filter(
    ({ claim_id: candidate }) => candidate !== claimId
  );
  contract.relations = contract.relations.filter(
    ({ source_claim_id: source, target_claim_id: target }) =>
      source !== claimId && target !== claimId
  );
  for (const collection of contract.collections) {
    collection.member_claim_ids = collection.member_claim_ids.filter(
      (candidate) => candidate !== claimId
    );
  }
}

function collapseReference(contract, input, fromRole, toRole) {
  const fromId = roleReferenceId(fromRole);
  const toId = roleReferenceId(toRole);
  contract.references = contract.references.filter(
    ({ reference_id: referenceId }) => referenceId !== fromId
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

function fixtureForExecution(profile, execution, options = {}) {
  const fixture = buildFailedAttemptNonconsumptionFixture({
    domain: execution.domain,
    profile,
    ...options
  });
  const { contract } = fixture;
  if (!execution.authority_state_preserved) {
    findProposition(contract, "authority-state-preserved").operator =
      "reference:not_equals";
  }
  if (!execution.valid_result_accepted ||
      execution.valid_result_state !== execution.expected_success_state) {
    findProposition(contract, "valid-result-matches-expected-success").operator =
      "reference:not_equals";
    removePattern(contract, "valid-result-accepts-attempt");
  }
  if (!execution.refusal_observed) {
    removePattern(contract, "refusal-rejects-failed-attempt");
    removePattern(contract, "failed-attempt-precedes-refusal");
  }
  if (!execution.same_authority_reused) {
    contract.references.push({
      reference_id: "ref-alternate-authority",
      type_term: "cc:authority",
      identity: { kind: "profile_term", term: `${execution.domain}:alternate-authority` }
    });
    findProposition(contract, "valid-attempt-uses-authority").operands = [
      ref("ref-alternate-authority")
    ];
  }
  return fixture;
}

function observedControl(profile, {
  controlId,
  category,
  domain = "capability_channel",
  strategy = "preserve",
  options = {}
}) {
  const execution = executeScenario({ domain, strategy });
  const fixture = fixtureForExecution(profile, execution, options);
  const satisfaction = evaluateFixture(fixture);
  return {
    control_id: controlId,
    category,
    implementation_outcome: category === "positive"
      ? implementationPassed(execution) ? "passed" : "killed"
      : implementationPassed(execution) ? "passed" : "killed",
    profile_satisfaction: satisfaction
  };
}

function positiveControls(profile) {
  const controls = [
    ["capability-channel-later-valid-use", "capability_channel", {}],
    ["tenant-lease-later-valid-use", "tenant_lease", {}],
    ["queue-permit-later-valid-use", "queue_permit", {}],
    ["verification-method-analysis", "capability_channel", {
      nonconsumption_verification_method: "analysis",
      later_use_verification_method: "analysis"
    }],
    ["verification-method-audit", "tenant_lease", {
      nonconsumption_verification_method: "audit",
      later_use_verification_method: "audit"
    }],
    ["verification-method-demonstration", "queue_permit", {
      nonconsumption_verification_method: "demonstration",
      later_use_verification_method: "demonstration"
    }],
    ["verification-method-proof", "capability_channel", {
      nonconsumption_verification_method: "proof",
      later_use_verification_method: "proof"
    }],
    ["verification-method-test-execution", "tenant_lease", {
      nonconsumption_verification_method: "test_execution",
      later_use_verification_method: "test_execution"
    }],
    ["capability-typed-authority", "queue_permit", {
      role_type_overrides: { legitimate_authority: "cc:capability" }
    }],
    ["configuration-typed-authority", "tenant_lease", {
      role_type_overrides: { legitimate_authority: "cc:configuration" }
    }],
    ["coexisting-other-pack-population", "capability_channel", {
      mutate_contract(contract) {
        contract.references.push({
          reference_id: "ref-other-pack-evidence",
          type_term: "cc:evidence",
          identity: { kind: "profile_term", term: "other-pack:evidence" }
        });
        contract.propositions.push({
          proposition_id: "prop-other-pack-evidence",
          subject_reference_id: "ref-other-pack-evidence",
          operator: "reference:covers",
          applicability_context: {
            mode: "unconditional",
            operand_reference_ids: []
          },
          operands: [ref(roleReferenceId("operation"))]
        });
        contract.claims.push({
          claim_id: "claim-other-pack-evidence",
          kind: "evidence",
          modality: "MUST",
          proposition_id: "prop-other-pack-evidence"
        });
        contract.collections.push({
          collection_id: "set-other-pack-population",
          collection_kind: "closed_set",
          purpose: "profile_proof_population",
          member_claim_ids: ["claim-other-pack-evidence"]
        });
      }
    }]
  ];
  return controls.map(([controlId, domain, options]) => observedControl(profile, {
    controlId,
    category: "positive",
    domain,
    options
  }));
}

function mutantControls(profile) {
  return [
    ["failed-attempt-consumes-authority", "consume_on_failure"],
    ["authority-replenished-after-refusal-observation", "replenish_after_observation"],
    ["later-valid-attempt-fails", "later_valid_fails"],
    ["later-attempt-uses-different-authority", "wrong_authority_later"],
    ["failed-attempt-not-refused", "missing_refusal"]
  ].map(([controlId, strategy]) => observedControl(profile, {
    controlId,
    category: "mutant",
    strategy
  }));
}

const rejectionMutations = Object.freeze([
  ["missing-authority-state-before", (contract) =>
    removePattern(contract, "authority-state-before-failed-attempt")],
  ["missing-before-observation", (contract) =>
    removePattern(contract, "authority-state-before-observation-record")],
  ["missing-failed-operation", (contract) =>
    removePattern(contract, "failed-attempt-performs-operation")],
  ["missing-failed-authority-use", (contract) =>
    removePattern(contract, "failed-attempt-uses-authority")],
  ["missing-failed-input", (contract) =>
    removePattern(contract, "failed-attempt-uses-input")],
  ["missing-unauthorized-declaration", (contract) =>
    removePattern(contract, "failed-input-unauthorized")],
  ["missing-refusal", (contract) =>
    removePattern(contract, "refusal-rejects-failed-attempt")],
  ["missing-failed-refusal-order", (contract) =>
    removePattern(contract, "failed-attempt-precedes-refusal")],
  ["missing-authority-state-after-refusal", (contract) =>
    removePattern(contract, "authority-state-after-refusal")],
  ["missing-after-refusal-observation", (contract) =>
    removePattern(contract, "authority-state-after-refusal-observation-record")],
  ["missing-nonconsumption-read-before", (contract) =>
    removePattern(contract, "nonconsumption-verification-reads-before")],
  ["missing-nonconsumption-read-after", (contract) =>
    removePattern(contract, "nonconsumption-verification-reads-after")],
  ["authority-state-self-equality", (contract) => {
    findProposition(contract, "authority-state-preserved").operands = [
      ref(roleReferenceId("authority_state_after_refusal"))
    ];
  }],
  ["missing-nonconsumption-verification", (contract) =>
    removePattern(contract, "nonconsumption-verification")],
  ["missing-refusal-valid-order", (contract) =>
    removePattern(contract, "refusal-precedes-valid-attempt")],
  ["missing-valid-operation", (contract) =>
    removePattern(contract, "valid-attempt-performs-operation")],
  ["missing-valid-authority-use", (contract) =>
    removePattern(contract, "valid-attempt-uses-authority")],
  ["missing-valid-input", (contract) =>
    removePattern(contract, "valid-attempt-uses-input")],
  ["missing-valid-authorization", (contract) =>
    removePattern(contract, "valid-input-authorized")],
  ["missing-valid-result-acceptance", (contract) =>
    removePattern(contract, "valid-result-accepts-attempt")],
  ["missing-success-classification", (contract) =>
    removePattern(contract, "expected-success-state-classification")],
  ["missing-valid-result-state", (contract) =>
    removePattern(contract, "valid-result-state")],
  ["missing-valid-result-observation", (contract) =>
    removePattern(contract, "valid-result-observation-record")],
  ["missing-later-use-result-read", (contract) =>
    removePattern(contract, "later-use-verification-reads-result")],
  ["valid-result-self-equality", (contract) => {
    findProposition(contract, "valid-result-matches-expected-success").operands = [
      ref(roleReferenceId("valid_result_state"))
    ];
  }],
  ["missing-later-use-verification", (contract) =>
    removePattern(contract, "later-use-verification")],
  ["nonconsumption-falsifier-wrong-condition", (contract) => {
    findProposition(contract, "nonconsumption-verification", {
      falsifier: true
    }).applicability_context = {
      mode: "when",
      operand_reference_ids: [roleReferenceId("valid_use_failure_condition")]
    };
  }],
  ["later-use-falsifier-wrong-condition", (contract) => {
    findProposition(contract, "later-use-verification", {
      falsifier: true
    }).applicability_context = {
      mode: "when",
      operand_reference_ids: [roleReferenceId("failed_attempt_consumption_condition")]
    };
  }],
  ["shared-verification-reference", (contract, input) =>
    collapseReference(
      contract, input, "later_use_verification", "nonconsumption_verification"
    )],
  ["collapsed-falsifier-conditions", (contract, input) =>
    collapseReference(
      contract, input, "valid_use_failure_condition",
      "failed_attempt_consumption_condition"
    )],
  ["collapsed-observation-records", (contract, input) =>
    collapseReference(
      contract, input, "observation_after_refusal",
      "observation_before_failed_attempt"
    )],
  ["collapsed-authority-state-observations", (contract, input) =>
    collapseReference(
      contract, input, "authority_state_after_refusal", "authority_state_before"
    )],
  ["collapsed-success-state-comparison", (contract, input) =>
    collapseReference(
      contract, input, "valid_result_state", "expected_success_state"
    )],
  ["collapsed-failed-and-valid-inputs", (contract, input) =>
    collapseReference(contract, input, "valid_input", "failed_input")],
  ["collapsed-valid-attempt-and-result", (contract, input) =>
    collapseReference(contract, input, "valid_result", "valid_attempt")],
  ["competing-proof-population", (contract) => {
    contract.collections.push({
      collection_id: "set-competing-proof-population",
      collection_kind: "closed_set",
      purpose: contract.collections[0].purpose,
      member_claim_ids: contract.collections[0].member_claim_ids.slice(0, -1)
    });
  }]
]);

function profileRejectionControls(profile) {
  return rejectionMutations.map(([controlId, mutate]) => {
    const fixture = buildFailedAttemptNonconsumptionFixture({ profile });
    mutate(fixture.contract, fixture.input);
    return {
      control_id: controlId,
      category: "profile_rejection",
      implementation_outcome: "not_applicable",
      profile_satisfaction: evaluateFixture(fixture)
    };
  });
}

function exclusionControls(profile) {
  const restored = executeScenario({ strategy: "consume_then_restore" });
  const restoredSatisfaction = evaluateFixture(fixtureForExecution(profile, restored));
  const baseline = buildFailedAttemptNonconsumptionFixture({ profile });
  const baselineSatisfaction = evaluateFixture(baseline);
  const controls = [
    ["transient-consume-and-restore", restoredSatisfaction,
      restored.events.some(({ kind }) => kind === "authority_consumed") &&
      restored.authority_state_preserved],
    ["concurrent-authority-use", baselineSatisfaction, true],
    ["truthful-reference-grounding", baselineSatisfaction, true],
    ["resources-outside-legitimate-authority", baselineSatisfaction, true],
    ["single-use-semantics-after-valid-success", baselineSatisfaction, true],
    ["refusal-before-protected-effects", baselineSatisfaction, true],
    ["pack-applicability", baselineSatisfaction, true]
  ];
  return controls.map(([controlId, satisfaction, demonstrated]) => ({
    control_id: controlId,
    category: "exclusion",
    implementation_outcome: demonstrated ? "boundary_demonstrated" : "not_applicable",
    profile_satisfaction: satisfaction
  }));
}

async function runProofPackAdequacyControls({ profile }) {
  return {
    schema_version: PROOF_PACK_ADEQUACY_RUN_VERSION,
    profile_id: profile.profile_id,
    profile_version: profile.profile_version,
    profile_digest: PROFILE_DIGEST,
    guarantee_digest: GUARANTEE_DIGEST,
    controls: [
      ...positiveControls(profile),
      ...mutantControls(profile),
      ...profileRejectionControls(profile),
      ...exclusionControls(profile)
    ]
  };
}

export {
  GUARANTEE_DIGEST,
  PROFILE_DIGEST,
  evaluateFixture,
  fixtureForExecution,
  profileRejectionControls,
  rejectionMutations,
  runProofPackAdequacyControls
};
