import {
  PROOF_PACK_ADEQUACY_RUN_VERSION
} from "../support/proof-pack-adequacy-constants.mjs";
import { evaluateVerificationProfileV034 } from "../../lib/verification-profile-v034.mjs";
import {
  buildReadinessBeforeSuccessFixture,
  collapseReference,
  findClaim,
  findProposition,
  ref,
  removePattern,
  roleReferenceId
} from "./readiness-before-success-v1-fixture.mjs";
import {
  executeScenario,
  implementationPassed
} from "./readiness-before-success-v1-harness.mjs";

const PROFILE_DIGEST =
  "1598781df2c2c86074b27af3cfa5eb6a3bfafda0147c289aa251c8ff254eb5c8";
const GUARANTEE_DIGEST =
  "c9482f026f92212d71a5c1674efd1de475659c8957bfc71db33bc1217ac08d58";

function evaluateFixture(fixture) {
  return evaluateVerificationProfileV034({
    contract: fixture.contract,
    profile: fixture.profile,
    evaluation_input: fixture.input
  }).satisfaction;
}

function addAlternateCapability(contract, domain) {
  contract.references.push({
    reference_id: "ref-alternate-capability",
    type_term: "cc:capability",
    identity: {
      kind: "durable_id",
      domain: `readiness-${domain}`,
      value: "alternate-capability"
    }
  });
}

function fixtureForExecution(profile, execution, options = {}) {
  const fixture = buildReadinessBeforeSuccessFixture({
    domain: execution.domain,
    timing: execution.strategy === "ready_at_report" ? "at" : "before",
    profile,
    ...options
  });
  const { contract } = fixture;
  if (execution.strategy === "success_status_only") {
    for (const patternId of [
      "initialization-precedes-readiness-probe",
      "readiness-probe-performs-operation",
      "readiness-probe-targets-capability",
      "readiness-result-accepts-probe",
      "readiness-probe-precedes-result",
      "readiness-result-state",
      "readiness-observation-records-state",
      "state-verification-reads-proof-subjects",
      "readiness-result-matches-expected-state",
      "readiness-state-verification",
      "completion-does-not-precede-readiness-result",
      "order-verification-reads-proof-subjects",
      "readiness-order-verification"
    ]) removePattern(contract, patternId);
    contract.propositions.push({
      proposition_id: "prop-status-only-success",
      subject_reference_id: roleReferenceId("completion_report"),
      operator: "reference:has_status",
      applicability_context: { mode: "unconditional", operand_reference_ids: [] },
      operands: [ref(roleReferenceId("expected_ready_state"))]
    });
    contract.claims.push({
      claim_id: "claim-status-only-success",
      kind: "behavior",
      modality: "MUST",
      proposition_id: "prop-status-only-success"
    });
    contract.propositions.push({
      proposition_id: "prop-status-only-verification",
      subject_reference_id: roleReferenceId("readiness_state_verification"),
      operator: "reference:covers",
      applicability_context: { mode: "unconditional", operand_reference_ids: [] },
      operands: [ref(roleReferenceId("completion_report"))]
    });
    contract.propositions.push({
      proposition_id: "prop-falsifier-status-only-success",
      subject_reference_id: roleReferenceId("completion_report"),
      operator: "reference:not_equals",
      applicability_context: {
        mode: "when",
        operand_reference_ids: [roleReferenceId("not_ready_condition")]
      },
      operands: [ref(roleReferenceId("expected_ready_state"))]
    });
    contract.claims.push({
      claim_id: "claim-status-only-verification",
      kind: "verification",
      modality: "MUST",
      verification_method: "test_execution",
      proposition_id: "prop-status-only-verification",
      falsifying_proposition_id: "prop-falsifier-status-only-success"
    });
    contract.relations.push({
      relation_id: "rel-status-only-verification",
      role: "verifies",
      source_claim_id: "claim-status-only-verification",
      target_claim_id: "claim-status-only-success"
    });
    return fixture;
  }
  if (!execution.probe_accepted ||
      execution.observed_ready_state !== execution.expected_ready_state) {
    removePattern(contract, "readiness-result-accepts-probe");
    findProposition(contract, "readiness-result-matches-expected-state").operator =
      "reference:not_equals";
  }
  if (execution.probe_target !== "capability") {
    addAlternateCapability(contract, execution.domain);
    findProposition(contract, "readiness-probe-targets-capability").operands = [
      ref("ref-alternate-capability")
    ];
  }
  if (execution.completion_observed &&
      execution.readiness_result_time > execution.completion_time) {
    findClaim(contract, "completion-does-not-precede-readiness-result").modality = "MUST";
  }
  if (!execution.completion_observed) {
    for (const patternId of [
      "completion-report-completes-initialization",
      "initialization-precedes-completion-report",
      "completion-does-not-precede-readiness-result",
      "order-verification-reads-proof-subjects",
      "readiness-order-verification"
    ]) removePattern(contract, patternId);
  }
  return fixture;
}

function observedControl(profile, {
  controlId,
  category,
  domain = "message_broker",
  strategy = "ready_before_report",
  options = {}
}) {
  const execution = executeScenario({ domain, strategy });
  const satisfaction = evaluateFixture(fixtureForExecution(profile, execution, options));
  return {
    control_id: controlId,
    category,
    implementation_outcome: implementationPassed(execution) ? "passed" : "killed",
    profile_satisfaction: satisfaction
  };
}

function positiveControls(profile) {
  const controls = [
    ["message-broker-ready-before-report", "message_broker", "ready_before_report", {}],
    ["database-pool-ready-before-report", "database_pool", "ready_before_report", {}],
    ["inference-worker-ready-before-report", "inference_worker", "ready_before_report", {}],
    ["readiness-at-report", "message_broker", "ready_at_report", {}],
    ["verification-method-analysis", "database_pool", "ready_before_report", {
      readiness_state_verification_method: "analysis",
      readiness_order_verification_method: "analysis"
    }],
    ["verification-method-audit", "inference_worker", "ready_before_report", {
      readiness_state_verification_method: "audit",
      readiness_order_verification_method: "audit"
    }],
    ["verification-method-demonstration", "message_broker", "ready_before_report", {
      readiness_state_verification_method: "demonstration",
      readiness_order_verification_method: "demonstration"
    }],
    ["verification-method-proof", "database_pool", "ready_before_report", {
      readiness_state_verification_method: "proof",
      readiness_order_verification_method: "proof"
    }],
    ["command-operations", "message_broker", "ready_before_report", {
      role_type_overrides: {
        initialization_operation: "cc:command",
        readiness_operation: "cc:command"
      }
    }],
    ["resource-capability", "database_pool", "ready_before_report", {
      role_type_overrides: { capability: "cc:resource" }
    }],
    ["runtime-component-capability", "inference_worker", "ready_before_report", {
      role_type_overrides: { capability: "cc:runtime_component" }
    }],
    ["repository-path-grounding", "message_broker", "ready_before_report", {
      role_identity_overrides: {
        initialization_operation: {
          kind: "repository_path", repository: "example/broker", path: "startup"
        },
        readiness_operation: {
          kind: "repository_path", repository: "example/broker", path: "publish"
        },
        capability: {
          kind: "repository_path", repository: "example/broker", path: "service"
        }
      }
    }],
    ["code-symbol-grounding", "database_pool", "ready_before_report", {
      role_identity_overrides: {
        initialization_operation: {
          kind: "code_symbol", repository: "example/database", path: "pool.mjs",
          symbol: "initializePool"
        },
        readiness_operation: {
          kind: "code_symbol", repository: "example/database", path: "pool.mjs",
          symbol: "query"
        },
        capability: {
          kind: "code_symbol", repository: "example/database", path: "pool.mjs",
          symbol: "pool"
        }
      }
    }],
    ["runtime-parameter-capability", "inference_worker", "ready_before_report", {
      role_identity_overrides: {
        capability: { kind: "runtime_parameter", name: "worker_endpoint" }
      }
    }]
  ];
  return controls.map(([controlId, domain, strategy, options]) => observedControl(profile, {
    controlId, category: "positive", domain, strategy, options
  }));
}

function mutantControls(profile) {
  return [
    ["success-status-only-plan", "success_status_only"],
    ["completion-reported-before-ready", "premature_completion"],
    ["readiness-probe-fails", "probe_fails"],
    ["readiness-probe-targets-other-capability", "wrong_capability"],
    ["completion-report-missing", "missing_completion"]
  ].map(([controlId, strategy]) => observedControl(profile, {
    controlId, category: "mutant", strategy
  }));
}

const rejectionMutations = Object.freeze([
  ...[
    "initialization-attempt-performs-operation",
    "initialization-attempt-targets-capability",
    "initialization-precedes-readiness-probe",
    "readiness-probe-performs-operation",
    "readiness-probe-targets-capability",
    "readiness-result-accepts-probe",
    "readiness-probe-precedes-result",
    "completion-report-completes-initialization",
    "initialization-precedes-completion-report",
    "expected-ready-state-conforms-to-criterion",
    "readiness-result-state",
    "readiness-observation-records-state",
    "state-verification-reads-proof-subjects",
    "readiness-result-matches-expected-state",
    "readiness-state-verification",
    "completion-does-not-precede-readiness-result",
    "order-verification-reads-proof-subjects",
    "readiness-order-verification"
  ].map((patternId) => [
    `missing-${patternId}`,
    (contract) => removePattern(contract, patternId)
  ]),
  ["state-verification-omits-capability", (contract) => {
    findProposition(contract, "state-verification-reads-proof-subjects").operands =
      findProposition(contract, "state-verification-reads-proof-subjects").operands.filter(
        ({ reference_id: referenceId }) => referenceId !== roleReferenceId("capability")
      );
  }],
  ["order-verification-omits-completion", (contract) => {
    findProposition(contract, "order-verification-reads-proof-subjects").operands =
      findProposition(contract, "order-verification-reads-proof-subjects").operands.filter(
        ({ reference_id: referenceId }) => referenceId !== roleReferenceId("completion_report")
      );
  }],
  ["state-falsifier-wrong-condition", (contract) => {
    findProposition(contract, "readiness-state-verification", {
      falsifier: true
    }).applicability_context.operand_reference_ids = [
      roleReferenceId("premature_completion_condition")
    ];
  }],
  ["order-falsifier-wrong-condition", (contract) => {
    findProposition(contract, "readiness-order-verification", {
      falsifier: true
    }).applicability_context.operand_reference_ids = [
      roleReferenceId("not_ready_condition")
    ];
  }],
  ["missing-verification-relation", (contract) => {
    contract.relations = contract.relations.slice(0, 1);
  }],
  ["shared-verification-reference", (contract, input) => collapseReference(
    contract, input, "readiness_order_verification", "readiness_state_verification"
  )],
  ["collapsed-falsifier-conditions", (contract, input) => collapseReference(
    contract, input, "premature_completion_condition", "not_ready_condition"
  )],
  ["collapsed-operation-roles", (contract, input) => collapseReference(
    contract, input, "readiness_operation", "initialization_operation"
  )],
  ["collapsed-ready-state-comparison", (contract, input) => collapseReference(
    contract, input, "observed_ready_state", "expected_ready_state"
  )],
  ["collapsed-readiness-occurrences", (contract, input) => collapseReference(
    contract, input, "readiness_result", "readiness_probe"
  )],
  ["profile-term-initialization-operation", (contract) => {
    contract.references.find(({ reference_id: id }) =>
      id === roleReferenceId("initialization_operation")
    ).identity = { kind: "profile_term", term: "ungrounded:init" };
  }],
  ["profile-term-readiness-operation", (contract) => {
    contract.references.find(({ reference_id: id }) =>
      id === roleReferenceId("readiness_operation")
    ).identity = { kind: "profile_term", term: "ungrounded:probe" };
  }],
  ["profile-term-capability", (contract) => {
    contract.references.find(({ reference_id: id }) =>
      id === roleReferenceId("capability")
    ).identity = { kind: "profile_term", term: "ungrounded:capability" };
  }],
  ["competing-proof-population", (contract) => {
    contract.collections.push({
      collection_id: "set-competing-readiness-proof-population",
      collection_kind: "closed_set",
      purpose: contract.collections[0].purpose,
      member_claim_ids: contract.collections[0].member_claim_ids.slice(0, -1)
    });
  }]
]);

function profileRejectionControls(profile) {
  return rejectionMutations.map(([controlId, mutate]) => {
    const fixture = buildReadinessBeforeSuccessFixture({ profile });
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
  const baseline = buildReadinessBeforeSuccessFixture({ profile });
  const baselineSatisfaction = evaluateFixture(baseline);
  const regressed = executeScenario({ strategy: "regress_before_completion" });
  const regressedSatisfaction = evaluateFixture(fixtureForExecution(profile, regressed));
  return [
    ["regression-after-successful-probe", regressedSatisfaction,
      regressed.events.some(({ ready }) => ready === false)],
    ["concurrent-readiness-transitions", baselineSatisfaction, true],
    ["identity-existence-beyond-kind", baselineSatisfaction, true],
    ["continued-usability-after-completion", baselineSatisfaction, true],
    ["initialization-failure-cleanup", baselineSatisfaction, true],
    ["readiness-operation-completeness", baselineSatisfaction, true],
    ["pack-applicability", baselineSatisfaction, true]
  ].map(([controlId, satisfaction, demonstrated]) => ({
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
