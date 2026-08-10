import {
  PROOF_PACK_ADEQUACY_RUN_VERSION
} from "../support/proof-pack-adequacy-constants.mjs";
import { evaluateVerificationProfileV034 } from "../../lib/verification-profile-v034.mjs";
import {
  buildCancellationIsolationFixture,
  collapseReference,
  findClaim,
  findProposition,
  ref,
  removePattern,
  roleReferenceId
} from "./cancellation-isolation-v1-fixture.mjs";
import {
  executeScenario,
  implementationPassed
} from "./cancellation-isolation-v1-harness.mjs";

const PROFILE_DIGEST =
  "2e5869f940bccdf63572b277ecc40541b7b3073292d70f0733fe1c07bd264e28";
const GUARANTEE_DIGEST =
  "20b89764350b8a5bd1a4c04f0ef63b2a648b72619515aa4fb174ce6d7e03b109";

function evaluateFixture(fixture) {
  return evaluateVerificationProfileV034({
    contract: fixture.contract,
    profile: fixture.profile,
    evaluation_input: fixture.input
  }).satisfaction;
}

function makeStatusOnlyFixture(profile, domain) {
  const fixture = buildCancellationIsolationFixture({ profile, domain });
  fixture.contract.propositions = [{
    proposition_id: "prop-status-only-success",
    subject_reference_id: roleReferenceId("surviving_result"),
    operator: "reference:has_status",
    applicability_context: { mode: "unconditional", operand_reference_ids: [] },
    operands: [ref(roleReferenceId("expected_success_state"))]
  }, {
    proposition_id: "prop-status-only-verification",
    subject_reference_id: roleReferenceId("success_verification"),
    operator: "reference:covers",
    applicability_context: { mode: "unconditional", operand_reference_ids: [] },
    operands: [ref(roleReferenceId("surviving_result"))]
  }, {
    proposition_id: "prop-falsifier-status-only-success",
    subject_reference_id: roleReferenceId("surviving_result"),
    operator: "reference:not_equals",
    applicability_context: {
      mode: "when",
      operand_reference_ids: [roleReferenceId("survivor_failure_condition")]
    },
    operands: [ref(roleReferenceId("expected_success_state"))]
  }];
  fixture.contract.claims = [{
    claim_id: "claim-status-only-success",
    kind: "behavior",
    modality: "MUST",
    proposition_id: "prop-status-only-success"
  }, {
    claim_id: "claim-status-only-verification",
    kind: "verification",
    modality: "MUST",
    verification_method: "test_execution",
    proposition_id: "prop-status-only-verification",
    falsifying_proposition_id: "prop-falsifier-status-only-success"
  }];
  fixture.contract.relations = [{
    relation_id: "rel-status-only-verification",
    role: "verifies",
    source_claim_id: "claim-status-only-verification",
    target_claim_id: "claim-status-only-success"
  }];
  fixture.contract.collections = [{
    collection_id: "set-status-only-smoke",
    collection_kind: "closed_set",
    purpose: "status_only_smoke_population",
    member_claim_ids: [
      "claim-status-only-success", "claim-status-only-verification"
    ]
  }];
  return fixture;
}

function fixtureForExecution(profile, execution, options = {}) {
  if (execution.strategy === "status_only") {
    return makeStatusOnlyFixture(profile, execution.domain);
  }
  const fixture = buildCancellationIsolationFixture({
    domain: execution.domain,
    profile,
    ...options
  });
  const { contract } = fixture;
  if (execution.cancellation_target !== "cancelled") {
    findProposition(
      contract, "cancellation-request-targets-cancelled-generation"
    ).operands = [ref(roleReferenceId("surviving_generation"))];
  }
  if (!execution.cancellation_accepted) {
    removePattern(contract, "cancellation-result-accepts-request");
  }
  if (execution.cancelled_observed_state !== execution.expected_cancelled_state) {
    findProposition(
      contract, "cancelled-generation-reaches-cancelled-state"
    ).operator = "reference:not_equals";
  }
  if (execution.protected_state_after !== execution.protected_state_before) {
    findProposition(contract, "surviving-state-preserved").operator =
      "reference:not_equals";
  }
  if (execution.authority_valid_after !== true) {
    findClaim(contract, "surviving-authority-not-invalidated").modality = "MUST";
  }
  if (!execution.surviving_result_observed) {
    for (const patternId of [
      "cancellation-result-precedes-surviving-result",
      "surviving-result-accepts-attempt",
      "surviving-result-state",
      "success-observation-records-state",
      "surviving-result-matches-success-state",
      "success-verification-reads-subjects",
      "success-verification"
    ]) removePattern(contract, patternId);
  } else if (!execution.surviving_result_accepted ||
      execution.observed_success_state !== execution.expected_success_state) {
    removePattern(contract, "surviving-result-accepts-attempt");
    findProposition(contract, "surviving-result-matches-success-state").operator =
      "reference:not_equals";
  }
  return fixture;
}

function observedControl(profile, {
  controlId,
  category,
  domain = "search_session",
  strategy = "isolated_cancellation",
  options = {}
}) {
  const execution = executeScenario({ domain, strategy });
  return {
    control_id: controlId,
    category,
    implementation_outcome: implementationPassed(execution) ? "passed" : "killed",
    profile_satisfaction: evaluateFixture(
      fixtureForExecution(profile, execution, options)
    )
  };
}

const groundedRoleNames = Object.freeze([
  "operation", "cancellation_operation", "cancelled_generation",
  "surviving_generation", "cancelled_attempt", "surviving_attempt",
  "protected_resource", "surviving_authority"
]);

function identities(kind, domain) {
  return Object.fromEntries(groundedRoleNames.map((role) => {
    if (kind === "repository_path") return [role, {
      kind, repository: `example/${domain}`, path: `proof/${role}`
    }];
    if (kind === "code_symbol") return [role, {
      kind, repository: `example/${domain}`, path: "proof.mjs",
      symbol: role.replaceAll("_", "")
    }];
    if (kind === "runtime_parameter") return [role, {
      kind, name: `${domain}_${role}`
    }];
    throw new Error(`unknown identity kind ${kind}`);
  }));
}

function positiveControls(profile) {
  const controls = [
    ["search-session-isolation", "search_session", {}],
    ["media-transcode-isolation", "media_transcode", {}],
    ["deployment-rollout-isolation", "deployment_rollout", {}],
    ["verification-method-analysis", "search_session", {
      verification_methods: Object.fromEntries([
        "cancellation-verification", "state-isolation-verification",
        "authority-isolation-verification", "success-verification"
      ].map((id) => [id, "analysis"]))
    }],
    ["verification-method-audit", "media_transcode", {
      verification_methods: Object.fromEntries([
        "cancellation-verification", "state-isolation-verification",
        "authority-isolation-verification", "success-verification"
      ].map((id) => [id, "audit"]))
    }],
    ["verification-method-demonstration", "deployment_rollout", {
      verification_methods: Object.fromEntries([
        "cancellation-verification", "state-isolation-verification",
        "authority-isolation-verification", "success-verification"
      ].map((id) => [id, "demonstration"]))
    }],
    ["verification-method-proof", "search_session", {
      verification_methods: Object.fromEntries([
        "cancellation-verification", "state-isolation-verification",
        "authority-isolation-verification", "success-verification"
      ].map((id) => [id, "proof"]))
    }],
    ["command-operations", "media_transcode", {
      role_type_overrides: {
        operation: "cc:command", cancellation_operation: "cc:command"
      }
    }],
    ["runtime-component-generations", "deployment_rollout", {
      role_type_overrides: {
        cancelled_generation: "cc:runtime_component",
        surviving_generation: "cc:runtime_component"
      }
    }],
    ["configuration-authority", "search_session", {
      role_type_overrides: { surviving_authority: "cc:configuration" }
    }],
    ["capability-authority", "media_transcode", {
      role_type_overrides: { surviving_authority: "cc:capability" }
    }],
    ["repository-path-grounding", "deployment_rollout", {
      role_identity_overrides: identities("repository_path", "deployment")
    }],
    ["code-symbol-grounding", "search_session", {
      role_identity_overrides: identities("code_symbol", "search")
    }],
    ["runtime-parameter-grounding", "media_transcode", {
      role_identity_overrides: identities("runtime_parameter", "media")
    }],
    ["artifact-observations", "deployment_rollout", {
      role_type_overrides: {
        cancellation_observation: "cc:artifact",
        state_before_observation: "cc:artifact",
        state_after_observation: "cc:artifact",
        success_observation: "cc:artifact"
      }
    }]
  ];
  return controls.map(([controlId, domain, options]) => observedControl(profile, {
    controlId, category: "positive", domain, options
  }));
}

function mutantControls(profile) {
  return [
    ["success-status-only-plan", "status_only", "search_session"],
    ["cancellation-targets-surviving-generation", "wrong_generation_target", "search_session"],
    ["cancelled-generation-continues", "cancelled_attempt_continues", "media_transcode"],
    ["cancellation-corrupts-surviving-state", "shared_state_corruption", "deployment_rollout"],
    ["cancellation-revokes-surviving-authority", "shared_authority_revocation", "search_session"],
    ["surviving-generation-later-fails", "survivor_fails", "media_transcode"],
    ["surviving-result-missing", "survivor_result_missing", "deployment_rollout"]
  ].map(([controlId, strategy, domain]) => observedControl(profile, {
    controlId, category: "mutant", domain, strategy
  }));
}

const rejectionMutations = Object.freeze([
  ...[
    "cancelled-attempt-performs-operation",
    "cancelled-attempt-targets-generation",
    "surviving-attempt-performs-operation",
    "surviving-attempt-targets-generation",
    "surviving-attempt-uses-authority",
    "cancelled-attempt-precedes-cancellation",
    "surviving-attempt-precedes-cancellation",
    "cancellation-request-performs-operation",
    "cancellation-request-targets-cancelled-generation",
    "cancellation-request-precedes-result",
    "cancellation-result-accepts-request",
    "cancelled-state-conforms-to-criterion",
    "cancelled-generation-state-after-cancellation",
    "cancellation-observation-records-state",
    "cancelled-generation-reaches-cancelled-state",
    "cancellation-verification-reads-subjects",
    "cancellation-verification",
    "protected-resource-state-before-cancellation",
    "surviving-generation-uses-protected-resource-before-cancellation",
    "state-before-observation-records-state",
    "protected-resource-state-after-cancellation",
    "surviving-generation-uses-protected-resource-after-cancellation",
    "state-after-observation-records-state",
    "surviving-state-preserved",
    "state-isolation-verification-reads-subjects",
    "state-isolation-verification",
    "authority-authorizes-surviving-generation",
    "surviving-authority-not-invalidated",
    "authority-authorizes-surviving-generation-after-cancellation",
    "authority-isolation-verification-reads-subjects",
    "authority-isolation-verification",
    "cancellation-result-precedes-surviving-result",
    "surviving-result-accepts-attempt",
    "expected-success-state-conforms-to-criterion",
    "surviving-result-state",
    "success-observation-records-state",
    "surviving-result-matches-success-state",
    "success-verification-reads-subjects",
    "success-verification"
  ].map((patternId) => [
    `missing-${patternId}`,
    (contract) => removePattern(contract, patternId)
  ]),
  ["cancelled-generation-still-running-after-result", (contract) => {
    contract.references.push({
      reference_id: "ref-counterexample-still-running",
      type_term: "cc:state",
      identity: { kind: "profile_term", term: "counterexample:still-running" }
    });
    contract.propositions.push({
      proposition_id: "prop-counterexample-cancelled-generation-still-running",
      subject_reference_id: roleReferenceId("cancelled_generation"),
      operator: "reference:has_state",
      applicability_context: {
        mode: "after",
        operand_reference_ids: [roleReferenceId("cancellation_result")]
      },
      operands: [ref("ref-counterexample-still-running")]
    });
    contract.claims.push({
      claim_id: "claim-counterexample-cancelled-generation-still-running",
      kind: "evidence",
      modality: "MUST",
      proposition_id: "prop-counterexample-cancelled-generation-still-running"
    });
  }],
  ["surviving-generation-bound-to-other-resource", (contract) => {
    contract.references.push({
      reference_id: "ref-counterexample-actual-survivor-resource",
      type_term: "cc:resource",
      identity: {
        kind: "durable_id", domain: "counterexample", value: "actual-resource"
      }
    });
    for (const patternId of [
      "surviving-generation-uses-protected-resource-before-cancellation",
      "surviving-generation-uses-protected-resource-after-cancellation"
    ]) findProposition(contract, patternId).operands = [
      ref("ref-counterexample-actual-survivor-resource")
    ];
  }],
  ["authority-no-longer-authorizes-after-cancellation", (contract) => {
    contract.references.push({
      reference_id: "ref-counterexample-authority-verification",
      type_term: "cc:test",
      identity: {
        kind: "profile_term", term: "counterexample:authority-verification"
      }
    }, {
      reference_id: "ref-counterexample-authority-expired",
      type_term: "cc:invariant",
      identity: { kind: "profile_term", term: "counterexample:authority-expired" }
    });
    const target = {
      proposition_id: "prop-counterexample-authority-no-longer-authorizes",
      subject_reference_id: roleReferenceId("surviving_authority"),
      operator: "reference:authorizes",
      applicability_context: {
        mode: "after",
        operand_reference_ids: [roleReferenceId("cancellation_result")]
      },
      operands: [ref(roleReferenceId("surviving_generation"))]
    };
    contract.propositions.push(target, {
      proposition_id: "prop-counterexample-authority-verification",
      subject_reference_id: "ref-counterexample-authority-verification",
      operator: "reference:covers",
      applicability_context: { mode: "unconditional", operand_reference_ids: [] },
      operands: [ref(roleReferenceId("surviving_authority"))]
    }, {
      ...structuredClone(target),
      proposition_id: "prop-falsifier-counterexample-authority-no-longer-authorizes",
      applicability_context: {
        mode: "when",
        operand_reference_ids: ["ref-counterexample-authority-expired"]
      }
    });
    contract.claims.push({
      claim_id: "claim-counterexample-authority-no-longer-authorizes",
      kind: "behavior",
      modality: "MUST_NOT",
      proposition_id: "prop-counterexample-authority-no-longer-authorizes"
    }, {
      claim_id: "claim-counterexample-authority-verification",
      kind: "verification",
      modality: "MUST",
      verification_method: "test_execution",
      proposition_id: "prop-counterexample-authority-verification",
      falsifying_proposition_id:
        "prop-falsifier-counterexample-authority-no-longer-authorizes"
    });
    contract.relations.push({
      relation_id: "rel-counterexample-authority-verification",
      role: "verifies",
      source_claim_id: "claim-counterexample-authority-verification",
      target_claim_id: "claim-counterexample-authority-no-longer-authorizes"
    });
  }],
  ["state-verification-omits-protected-resource", (contract) => {
    const proposition = findProposition(
      contract, "state-isolation-verification-reads-subjects"
    );
    proposition.operands = proposition.operands.filter(
      ({ reference_id }) => reference_id !== roleReferenceId("protected_resource")
    );
  }],
  ["success-verification-omits-surviving-generation", (contract) => {
    const proposition = findProposition(contract, "success-verification-reads-subjects");
    proposition.operands = proposition.operands.filter(
      ({ reference_id }) => reference_id !== roleReferenceId("surviving_generation")
    );
  }],
  ...[
    ["cancellation-verification", "state_interference_condition"],
    ["state-isolation-verification", "authority_interference_condition"],
    ["authority-isolation-verification", "survivor_failure_condition"],
    ["success-verification", "cancellation_failed_condition"]
  ].map(([patternId, wrongCondition]) => [
    `wrong-condition-${patternId}`,
    (contract) => {
      findProposition(contract, patternId, {
        falsifier: true
      }).applicability_context.operand_reference_ids = [
        roleReferenceId(wrongCondition)
      ];
    }
  ]),
  ["swapped-verification-targets", (contract) => {
    [contract.relations[0].target_claim_id, contract.relations[1].target_claim_id] =
      [contract.relations[1].target_claim_id, contract.relations[0].target_claim_id];
  }],
  ["shared-verification-reference", (contract, input) => collapseReference(
    contract, input, "success_verification", "cancellation_verification"
  )],
  ["collapsed-generations", (contract, input) => collapseReference(
    contract, input, "surviving_generation", "cancelled_generation"
  )],
  ["collapsed-attempts", (contract, input) => collapseReference(
    contract, input, "surviving_attempt", "cancelled_attempt"
  )],
  ["collapsed-cancellation-states", (contract, input) => collapseReference(
    contract, input, "cancelled_observed_state", "cancelled_expected_state"
  )],
  ["collapsed-surviving-states", (contract, input) => collapseReference(
    contract, input, "survivor_state_after", "survivor_state_before"
  )],
  ["collapsed-success-states", (contract, input) => collapseReference(
    contract, input, "observed_success_state", "expected_success_state"
  )],
  ...groundedRoleNames.map((role) => [
    `profile-term-${role.replaceAll("_", "-")}`,
    (contract) => {
      contract.references.find(({ reference_id }) =>
        reference_id === roleReferenceId(role)
      ).identity = { kind: "profile_term", term: `ungrounded:${role}` };
    }
  ]),
  ["competing-proof-population", (contract) => {
    contract.collections.push({
      collection_id: "set-competing-cancellation-isolation-population",
      collection_kind: "closed_set",
      purpose: contract.collections[0].purpose,
      member_claim_ids: contract.collections[0].member_claim_ids.slice(0, -1)
    });
  }]
]);

function profileRejectionControls(profile) {
  return rejectionMutations.map(([controlId, mutate]) => {
    const fixture = buildCancellationIsolationFixture({ profile });
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
  const baseline = buildCancellationIsolationFixture({ profile });
  const satisfaction = evaluateFixture(baseline);
  return [
    "concurrent-interleavings-and-linearizability",
    "transient-interference-between-observations",
    "cancellation-propagation-outside-elected-generations",
    "resources-outside-selected-protected-resource",
    "authority-beyond-selected-surviving-authority",
    "subsequent-results-after-elected-success",
    "identity-existence-beyond-grounding-kind",
    "delivered-evidence-authenticity",
    "pack-applicability"
  ].map((controlId) => ({
    control_id: controlId,
    category: "exclusion",
    implementation_outcome: "boundary_demonstrated",
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
