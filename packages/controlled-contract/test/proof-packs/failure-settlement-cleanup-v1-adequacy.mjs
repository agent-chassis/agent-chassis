import {
  PROOF_PACK_ADEQUACY_RUN_VERSION
} from "../support/proof-pack-adequacy-constants.mjs";
import { evaluateVerificationProfileV034 } from "../../lib/verification-profile-v034.mjs";
import {
  buildFailureSettlementCleanupFixture,
  collapseFailureSettlementRole,
  findFailureSettlementClaim,
  findFailureSettlementProposition,
  removeFailureSettlementClaim,
  failureSettlementRoleReferenceId
} from "./failure-settlement-cleanup-v1-fixture.mjs";
import {
  executeFailureSettlementScenario,
  failureSettlementImplementationPassed
} from "./failure-settlement-cleanup-v1-harness.mjs";

const PROFILE_DIGEST =
  "1af959a8f2761f1be941d5482e09849354e9f8de50f6dae73b312ab0e69d48ca";
const GUARANTEE_DIGEST =
  "a29c4f79b079c6dbf4b8b35bc31e426c08a56a114376f79565566124499eccbc";

function evaluateFixture(profile, fixture) {
  return evaluateVerificationProfileV034({
    contract: fixture.contract, profile, evaluation_input: fixture.input
  }).satisfaction;
}

function fixtureForExecution(profile, execution, options = {}) {
  const fixture = buildFailureSettlementCleanupFixture({
    domain: execution.domain,
    residue_count: execution.residue_count_after_settlement,
    ...options
  });
  if (!execution.failure_injected) {
    removeFailureSettlementClaim(fixture, "failure-injection-precedes-failure");
    removeFailureSettlementClaim(fixture, "injected-failure-targets-operation");
  }
  if (!execution.cleanup_observed) {
    removeFailureSettlementClaim(fixture, "cleanup-follows-injected-failure");
    removeFailureSettlementClaim(fixture, "cleanup-targets-residue-population");
  }
  if (!execution.settlement_follows_cleanup) {
    findFailureSettlementProposition(
      fixture, "settlement-follows-cleanup"
    ).operator = "reference:precedes";
  }
  if (execution.residue_count_after_settlement !== 0) {
    findFailureSettlementProposition(
      fixture, "residue-population-empty-after-settlement"
    ).operator = "number:not_equals";
    findFailureSettlementProposition(
      fixture, "cleanup-verification", true
    ).operator = "number:equals";
  }
  if (!execution.failure_record_preserved || execution.settled_cause === null) {
    removeFailureSettlementClaim(fixture, "settled-failure-record-preserves-cause");
    removeFailureSettlementClaim(fixture, "settled-failure-cause-state");
    removeFailureSettlementClaim(fixture, "settled-cause-observation-records-state");
    removeFailureSettlementClaim(fixture, "original-failure-cause-preserved");
    removeFailureSettlementClaim(fixture, "cause-preservation-verification");
  } else if (JSON.stringify(execution.original_cause) !==
      JSON.stringify(execution.settled_cause)) {
    findFailureSettlementProposition(
      fixture, "original-failure-cause-preserved"
    ).operator = "reference:not_equals";
    findFailureSettlementProposition(
      fixture, "cause-preservation-verification", true
    ).operator = "reference:equals";
  }
  return fixture;
}

function observedControl(profile, {
  controlId, category, domain = "file_upload",
  strategy = "cleanup_and_preserve_cause", options = {}
}) {
  const execution = executeFailureSettlementScenario({ domain, strategy });
  return {
    control_id: controlId,
    category,
    implementation_outcome: failureSettlementImplementationPassed(execution)
      ? "passed"
      : "killed",
    profile_satisfaction: evaluateFixture(
      profile, fixtureForExecution(profile, execution, options)
    )
  };
}

function positiveControls(profile) {
  const controls = [
    ["file-upload-clean-settlement", "file_upload", {}],
    ["job-dispatch-clean-settlement", "job_dispatch", { method: "analysis" }],
    ["schema-migration-clean-settlement", "schema_migration", { method: "proof" }],
    ["verification-method-audit", "file_upload", { method: "audit" }],
    ["verification-method-demonstration", "job_dispatch", { method: "demonstration" }],
    ["operation-code-symbol-grounding", "file_upload", {
      identity_kind_overrides: { operation: "code_symbol" }
    }],
    ["cause-repository-path-grounding", "job_dispatch", {
      identity_kind_overrides: { failure_cause: "repository_path" }
    }],
    ["settlement-runtime-parameter-grounding", "schema_migration", {
      identity_kind_overrides: { settlement_event: "runtime_parameter" }
    }],
    ["cleanup-process-type", "file_upload", {
      role_type_overrides: { cleanup_event: "cc:process" }
    }],
    ["verification-process-type", "job_dispatch", {
      role_type_overrides: { cause_verification: "cc:process" }
    }]
  ];
  return controls.map(([controlId, domain, options]) => observedControl(profile, {
    controlId, category: "positive", domain, options
  }));
}

function mutantControls(profile) {
  return [
    ["failure-not-injected", "no_failure"],
    ["cleanup-not-run", "missing_cleanup"],
    ["partial-residue-remains", "partial_cleanup"],
    ["settlement-precedes-cleanup", "settlement_before_cleanup"],
    ["failure-cause-replaced", "cause_replaced"],
    ["failure-cause-dropped", "cause_dropped"],
    ["residue-reappears-after-cleanup", "cleanup_then_residue_reappears"]
  ].map(([controlId, strategy], index) => observedControl(profile, {
    controlId, category: "mutant",
    domain: ["file_upload", "job_dispatch", "schema_migration"][index % 3],
    strategy
  }));
}

const rejectionMutations = Object.freeze([
  ["status-only-plan", (fixture) => {
    const keep = new Set(["settlement-follows-injected-failure"]);
    for (const claim of [...fixture.contract.claims]) {
      const id = claim.claim_id.slice("claim-".length);
      if (!keep.has(id)) removeFailureSettlementClaim(fixture, id);
    }
  }],
  ["missing-injected-failure", (fixture) =>
    removeFailureSettlementClaim(fixture, "injected-failure-targets-operation")],
  ["missing-cleanup", (fixture) =>
    removeFailureSettlementClaim(fixture, "cleanup-targets-residue-population")],
  ["missing-settlement-order", (fixture) =>
    removeFailureSettlementClaim(fixture, "settlement-follows-cleanup")],
  ["missing-residue-observation", (fixture) =>
    removeFailureSettlementClaim(fixture, "residue-observation-records-population")],
  ["missing-empty-residue-proof", (fixture) => {
    removeFailureSettlementClaim(fixture, "residue-population-empty-after-settlement");
    removeFailureSettlementClaim(fixture, "cleanup-verification");
  }],
  ["missing-cause-record", (fixture) =>
    removeFailureSettlementClaim(fixture, "settled-failure-record-preserves-cause")],
  ["missing-cause-comparison", (fixture) => {
    removeFailureSettlementClaim(fixture, "original-failure-cause-preserved");
    removeFailureSettlementClaim(fixture, "cause-preservation-verification");
  }],
  ["wrong-cause-observable", (fixture) => {
    findFailureSettlementProposition(
      fixture, "settled-failure-record-preserves-cause"
    ).operands = [{
      kind: "reference", reference_id: failureSettlementRoleReferenceId("operation")
    }];
  }],
  ["residue-count-one", (fixture) => {
    fixture.input.number_bindings[0].value = 1;
    findFailureSettlementProposition(
      fixture, "settled-residue-population-cardinality"
    ).operands = [{ kind: "number", value: 1 }];
    findFailureSettlementProposition(
      fixture, "residue-population-empty-after-settlement"
    ).operator = "number:not_equals";
    findFailureSettlementProposition(
      fixture, "cleanup-verification", true
    ).operator = "number:equals";
  }],
  ["shared-verification-reference", (fixture) => collapseFailureSettlementRole(
    fixture, "cause_verification", "cleanup_verification"
  )],
  ["wrong-cleanup-falsifier-condition", (fixture) => {
    findFailureSettlementProposition(
      fixture, "cleanup-verification", true
    ).applicability_context = {
      mode: "when",
      operand_reference_ids: [failureSettlementRoleReferenceId("cause_loss_condition")]
    };
  }],
  ["competing-proof-sequence", (fixture) => {
    const sequence = structuredClone(fixture.contract.collections.find(
      ({ collection_id: id }) => id === "set-proof-sequence"
    ));
    sequence.collection_id = "set-competing-proof-sequence";
    sequence.member_claim_ids.reverse();
    fixture.contract.collections.push(sequence);
  }],
  ["profile-term-operation-grounding", (fixture) => {
    fixture.contract.references.find(({ reference_id: id }) =>
      id === failureSettlementRoleReferenceId("operation")
    ).identity = { kind: "profile_term", term: "ungrounded:operation" };
  }]
]);

function profileRejectionControls(profile) {
  return rejectionMutations.map(([controlId, mutate]) => {
    const fixture = buildFailureSettlementCleanupFixture();
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
  const baseline = evaluateFixture(profile, buildFailureSettlementCleanupFixture());
  const controls = [
    "transient-residue-before-settlement",
    "residue-reappearance-after-observation",
    "resources-outside-declared-population",
    "concurrent-or-distributed-settlement",
    "cause-truthfulness-beyond-declared-observations",
    "cleanup-side-effects-outside-population",
    "failure-prevention-or-retry-semantics",
    "delivered-evidence-authenticity",
    "pack-applicability"
  ];
  return controls.map((controlId) => ({
    control_id: controlId,
    category: "exclusion",
    implementation_outcome: "boundary_demonstrated",
    profile_satisfaction: baseline
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
