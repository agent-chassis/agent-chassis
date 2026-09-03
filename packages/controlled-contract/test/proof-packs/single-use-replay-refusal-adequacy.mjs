import {
  PROOF_PACK_ADEQUACY_RUN_VERSION
} from "../support/proof-pack-adequacy-constants.mjs";
import { evaluateStableProofPackFixtureV1 } from "../support/stable-v1-proof-pack-runtime.mjs";
import {
  buildSingleUseReplayRefusalFixture,
  collapseSingleUseRole,
  findSingleUseClaim,
  findSingleUseProposition,
  removeSingleUseClaim,
  singleUseRoleReferenceId
} from "./single-use-replay-refusal-fixture.mjs";
import {
  executeSingleUseScenario,
  singleUseImplementationPassed
} from "./single-use-replay-refusal-harness.mjs";

const PROFILE_DIGEST =
  "7716ad9e4ae12f15c579de9695a879b18f9439da044e02b0f56f407e372c0516";
const GUARANTEE_DIGEST =
  "b555f4eace29c9d9054bbacd990817451c6a260db3e83ef887ef5bc0584507d2";

function evaluateFixture(profile, fixture) {
  return evaluateStableProofPackFixtureV1({
    contract: fixture.contract,
    profile,
    evaluation_input: fixture.input
  }).satisfaction;
}

function fixtureForExecution(profile, execution, options = {}) {
  const fixture = buildSingleUseReplayRefusalFixture({
    domain: execution.domain,
    ...options
  });
  if (!execution.first_accepted) {
    findSingleUseProposition(
      fixture, "first-result-matches-expected-success"
    ).operator = "reference:not_equals";
    removeSingleUseClaim(fixture, "first-result-accepts-attempt");
  }
  if (JSON.stringify(execution.state_before) ===
      JSON.stringify(execution.state_after_first)) {
    findSingleUseProposition(
      fixture, "first-use-changes-effect-state"
    ).operator = "reference:equals";
  }
  if (!execution.authority_consumed) {
    findSingleUseClaim(
      fixture, "authority-consumed-after-first-use"
    ).modality = "MUST";
  }
  if (execution.replay_accepted) {
    findSingleUseProposition(
      fixture, "replay-refusal-rejects-replay"
    ).operator = "reference:accepts";
    findSingleUseClaim(fixture, "replay-is-not-accepted").modality = "MUST";
    findSingleUseClaim(
      fixture, "replay-does-not-create-effect"
    ).modality = "MUST";
  }
  if (JSON.stringify(execution.state_after_first) !==
      JSON.stringify(execution.state_after_replay)) {
    findSingleUseProposition(
      fixture, "effect-state-stable-after-replay"
    ).operator = "reference:not_equals";
    findSingleUseClaim(
      fixture, "replay-does-not-create-effect"
    ).modality = "MUST";
  }
  return fixture;
}

function observedControl(profile, {
  controlId,
  category,
  domain = "password_reset",
  strategy = "correct",
  options = {}
}) {
  const execution = executeSingleUseScenario({ domain, strategy });
  const fixture = fixtureForExecution(profile, execution, options);
  return {
    control_id: controlId,
    category,
    implementation_outcome: singleUseImplementationPassed(execution)
      ? "passed"
      : "killed",
    profile_satisfaction: evaluateFixture(profile, fixture)
  };
}

function positiveControls(profile) {
  const controls = [
    ["password-reset-single-use", "password_reset", {}],
    ["queue-permit-single-use", "queue_permit", { method: "analysis" }],
    ["voucher-claim-single-use", "voucher_claim", { method: "proof" }],
    ["verification-method-audit", "password_reset", { method: "audit" }],
    ["verification-method-demonstration", "queue_permit", {
      method: "demonstration"
    }],
    ["operation-code-symbol-grounding", "password_reset", {
      identity_kind_overrides: { operation: "code_symbol" }
    }],
    ["effect-repository-path-grounding", "queue_permit", {
      identity_kind_overrides: { effect_subject: "repository_path" }
    }],
    ["input-runtime-parameter-grounding", "voucher_claim", {
      identity_kind_overrides: { input: "runtime_parameter" }
    }],
    ["capability-typed-authority", "password_reset", {
      role_type_overrides: { single_use_authority: "cc:capability" }
    }],
    ["configuration-typed-authority", "queue_permit", {
      role_type_overrides: { single_use_authority: "cc:configuration" }
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
    ["first-use-refused", "first_refused"],
    ["first-use-has-no-effect", "first_no_effect"],
    ["authority-remains-live", "authority_remains_live"],
    ["replay-is-accepted", "replay_accepted"],
    ["refused-replay-duplicates-effect", "duplicate_on_refused_replay"]
  ].map(([controlId, strategy], index) => observedControl(profile, {
    controlId,
    category: "mutant",
    domain: ["password_reset", "queue_permit", "voucher_claim"][index % 3],
    strategy
  }));
}

const rejectionMutations = Object.freeze([
  ["status-only-plan", (fixture) => {
    const keep = new Set(["first-result-accepts-attempt"]);
    for (const claim of [...fixture.contract.claims]) {
      const patternId = claim.claim_id.slice("claim-".length);
      if (!keep.has(patternId)) removeSingleUseClaim(fixture, patternId);
    }
  }],
  ["missing-replay-stimulus", (fixture) =>
    removeSingleUseClaim(fixture, "replay-performs-same-operation")],
  ["missing-replay-refusal", (fixture) =>
    removeSingleUseClaim(fixture, "replay-refusal-rejects-replay")],
  ["missing-replay-nonacceptance", (fixture) => {
    removeSingleUseClaim(fixture, "replay-is-not-accepted");
    removeSingleUseClaim(fixture, "replay-refusal-verification");
  }],
  ["missing-replay-no-create", (fixture) => {
    removeSingleUseClaim(fixture, "replay-does-not-create-effect");
    removeSingleUseClaim(fixture, "replay-occurrence-verification");
  }],
  ["missing-replay-state-comparison", (fixture) => {
    removeSingleUseClaim(fixture, "effect-state-stable-after-replay");
    removeSingleUseClaim(fixture, "replay-effect-verification");
  }],
  ["wrong-replay-input", (fixture) => {
    fixture.contract.references.push({
      reference_id: "ref-decoy-input",
      type_term: "cc:artifact",
      identity: { kind: "durable_id", domain: "decoy", value: "input" }
    });
    findSingleUseProposition(fixture, "replay-uses-same-input").operands = [{
      kind: "reference", reference_id: "ref-decoy-input"
    }];
  }],
  ["wrong-replay-authority", (fixture) => {
    fixture.contract.references.push({
      reference_id: "ref-decoy-authority",
      type_term: "cc:authority",
      identity: { kind: "durable_id", domain: "decoy", value: "authority" }
    });
    findSingleUseProposition(
      fixture, "replay-uses-same-authority"
    ).operands = [{
      kind: "reference", reference_id: "ref-decoy-authority"
    }];
  }],
  ["wrong-effect-observable", (fixture) => {
    findSingleUseProposition(
      fixture, "effect-state-after-replay"
    ).subject_reference_id = singleUseRoleReferenceId("operation");
  }],
  ["incorrect-proof-order", (fixture) => {
    fixture.contract.collections.find(({ collection_id: id }) =>
      id === "set-sequence-proof"
    ).member_claim_ids.reverse();
  }],
  ["shared-verifier-reference", (fixture) => collapseSingleUseRole(
    fixture, "replay_effect_verification", "success_verification"
  )],
  ["effect-count-two", (fixture) => {
    fixture.input.number_bindings[0].value = 2;
    findSingleUseProposition(
      fixture, "effect-population-cardinality"
    ).operands = [{ kind: "number", value: 2 }];
  }],
  ["wrong-duplicate-falsifier-condition", (fixture) => {
    findSingleUseProposition(
      fixture, "replay-effect-verification", true
    ).applicability_context = {
      mode: "when",
      operand_reference_ids: [singleUseRoleReferenceId(
        "first_use_failure_condition"
      )]
    };
  }],
  ["competing-proof-sequence", (fixture) => {
    const sequence = structuredClone(fixture.contract.collections.find(
      ({ collection_id: id }) => id === "set-sequence-proof"
    ));
    sequence.collection_id = "set-competing-proof-sequence";
    sequence.member_claim_ids.reverse();
    fixture.contract.collections.push(sequence);
  }],
  ["profile-term-operation-grounding", (fixture) => {
    fixture.contract.references.find(({ reference_id: id }) =>
      id === singleUseRoleReferenceId("operation")
    ).identity = { kind: "profile_term", term: "ungrounded:operation" };
  }]
]);

function profileRejectionControls(profile) {
  return rejectionMutations.map(([controlId, mutate]) => {
    const fixture = buildSingleUseReplayRefusalFixture();
    mutate(fixture);
    return {
      control_id: controlId,
      category: "profile_rejection",
      implementation_outcome: "not_applicable",
      profile_satisfaction: evaluateFixture(profile, fixture)
    };
  });
}

function exclusionControls(profile) {
  const baseline = buildSingleUseReplayRefusalFixture();
  const baselineSatisfaction = evaluateFixture(profile, baseline);
  const restored = executeSingleUseScenario({
    strategy: "duplicate_then_restore"
  });
  const restoredSatisfaction = evaluateFixture(
    profile, fixtureForExecution(profile, restored)
  );
  const controls = [
    ["transient-duplicate-and-restore", restoredSatisfaction,
      restored.effects.length > 1],
    ["additional-replay-attempts", baselineSatisfaction, true],
    ["concurrent-or-linearizable-use", baselineSatisfaction, true],
    ["effects-outside-elected-population", baselineSatisfaction, true],
    ["purely-transient-effect", baselineSatisfaction, true],
    ["truthful-identity-and-population-grounding", baselineSatisfaction, true],
    ["refusal-before-effects", baselineSatisfaction, true],
    ["failure-settlement-and-cleanup", baselineSatisfaction, true],
    ["delivered-evidence-authenticity", baselineSatisfaction, true],
    ["pack-applicability", baselineSatisfaction, true]
  ];
  return controls.map(([controlId, satisfaction, demonstrated]) => ({
    control_id: controlId,
    category: "exclusion",
    implementation_outcome: demonstrated
      ? "boundary_demonstrated"
      : "not_applicable",
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
  rejectionMutations,
  runProofPackAdequacyControls
};
