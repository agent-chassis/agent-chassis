import { normalizeFalsifierFacts } from "../../lib/test-proof-evidence-semantic-kernel.mjs";

const DIGEST = (character) => `sha256:${character.repeat(64)}`;
const SELECTED_TEST_ID = "test-component";
const PRIMARY = "falsifier-component";
const SECONDARY = "falsifier-component-secondary";
const REGISTRY_UNSUPPORTED = "test_proof_registry_falsification_unsupported";
const INSTRUMENTATION_UNSUPPORTED = "test_proof_native_instrumentation_unsupported";

const member = {
  detected: (id, candidate = "passed") => ({ falsifier_id: id, status: "detected",
    provider_support: "supported", isolated: true, candidate_status: candidate,
    falsified_status: "failed", failure_reason_code: "assertion_failed",
    mutation: { observed: true } }),
  survived: (id, candidate = "passed") => ({ falsifier_id: id, status: "not_detected",
    provider_support: "supported", isolated: true, candidate_status: candidate,
    falsified_status: "passed", failure_reason_code: null, mutation: { observed: true } }),
  unreached: (id, candidate = "passed") => ({ falsifier_id: id, status: "not_detected",
    provider_support: "supported", isolated: true, candidate_status: candidate,
    falsified_status: "passed", failure_reason_code: null, mutation: { observed: false } }),
  unavailable: (id, candidate = "passed") => ({ falsifier_id: id, status: "review_only",
    provider_support: "unsupported", isolated: false, candidate_status: candidate,
    falsified_status: "not_run", failure_reason_code: null, mutation: { observed: false } })
};

function falsification({ declared = [PRIMARY], executions = [member.detected(PRIMARY)],
  declaredUnsupported = false } = {}) {
  const limitations = [
    ...(declaredUnsupported ? [{ check_kind: "falsifier", check_id: null,
      reason_code: REGISTRY_UNSUPPORTED }] : []),
    ...executions.filter(({ provider_support: support }) => support === "unsupported")
      .map(({ falsifier_id: id }) => ({ check_kind: "falsifier", check_id: id,
        reason_code: INSTRUMENTATION_UNSUPPORTED }))
  ];
  return {
    falsifiers: normalizeFalsifierFacts({ declaredFalsifierIds: declared, executions,
      declaredUnsupported }),
    limitations: { observations: limitations, count: limitations.length }
  };
}

function facts(overrides = {}) {
  const value = {
    candidate: { status: "passed", passed: true },
    inventory: {
      declared_test_ids: [SELECTED_TEST_ID],
      discovered_test_ids: [SELECTED_TEST_ID],
      executed_test_ids: [SELECTED_TEST_ID],
      skipped_test_ids: [],
      observed_test_count: 1
    },
    ...falsification(),
    traversal: {
      observations: [{
        boundary_id: "sut-boundary-component",
        observable_id: "observable-component",
        provider_support: "supported",
        status: "proven",
        proven: true,
        capability_available: true
      }],
      complete: true,
      all_proven: true,
      capability_available: true
    },
    prohibited_shortcuts: { observed: [], violated: [] },
    ...overrides
  };
  return {
    schema_version: "controlled-contract-test-proof-semantic-facts.v1",
    status: "facts",
    authority: "non_authoritative",
    obligation_id: "AC-001",
    execution_identity: {
      run_id: "run-reviewer-independent",
      attempt: 1,
      candidate: {
        kind: "reviewer_frozen_candidate",
        commit: "d".repeat(40),
        source_snapshot_digest: DIGEST("6")
      },
      source_snapshot_digest: DIGEST("6")
    },
    receipt_population: {
      count: 1,
      receipt_digests: [DIGEST("7")],
      digest: DIGEST("8")
    },
    facts: value,
    facts_digest: DIGEST("9")
  };
}

const positive = {
  "complete-authenticated-positive-facts": () => facts(),
  "unavailable-mutation-positive-facts": () => facts(falsification({
    declared: [], executions: [], declaredUnsupported: true })),
  "detected-beside-unavailable-positive-facts": () => facts(falsification({
    declared: [PRIMARY, SECONDARY],
    executions: [member.detected(PRIMARY), member.unavailable(SECONDARY)] }))
};

const mutate = {
  "failed-candidate": (value) => {
    value.candidate = { status: "failed", passed: false };

    Object.assign(value, falsification({ declared: [PRIMARY, SECONDARY],
      executions: [member.survived(PRIMARY, "failed"), member.unavailable(SECONDARY, "failed")] }));
  },
  "selected-test-not-discovered": (value) => { value.inventory.discovered_test_ids = []; },
  "selected-test-not-executed": (value) => { value.inventory.executed_test_ids = []; },
  "selected-test-skipped": (value) => {
    value.inventory.skipped_test_ids = [SELECTED_TEST_ID];
  },
  "surviving-falsifier": (value) => {
    Object.assign(value, falsification({ executions: [member.survived(PRIMARY)] }));
  },
  "survivor-beside-unavailable": (value) => {
    Object.assign(value, falsification({ declared: [PRIMARY, SECONDARY],
      executions: [member.survived(PRIMARY), member.unavailable(SECONDARY)] }));
  },
  "incomplete-traversal-population": (value) => { value.traversal.complete = false; },
  "unproven-traversal": (value) => { value.traversal.all_proven = false; },
  "prohibited-shortcut": (value) => {
    value.prohibited_shortcuts = {
      observed: ["source_text_inspection"], violated: ["source_text_inspection"]
    };
  }
};

const notEvaluable = {
  "incomplete-falsifier-population": (value) => {
    Object.assign(value, falsification({ declared: [PRIMARY, SECONDARY],
      executions: [member.detected(PRIMARY)] }));
  },
  "unevaluable-supported-falsifier": (value) => {
    Object.assign(value, falsification({ executions: [member.unreached(PRIMARY)] }));
  }
};

export { facts, falsification, member, mutate, notEvaluable, positive };
