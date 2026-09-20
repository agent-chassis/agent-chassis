const DIGEST = (character) => `sha256:${character.repeat(64)}`;
const SELECTED_TEST_ID = "test-component";
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
    falsifiers: {
      expected_ids: ["falsifier-component"],
      observations: [{
        falsifier_id: "falsifier-component",
        status: "detected",
        detected: true
      }],
      complete: true,
      all_detected: true
    },
    traversal: {
      observations: [{
        boundary_id: "sut-boundary-component",
        observable_id: "observable-component",
        provider_support: "supported",
        status: "proven",
        proven: true
      }],
      complete: true,
      all_proven: true
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

const mutate = {
    "failed-candidate": (value) => {
      value.candidate = { status: "failed", passed: false };
    },
    "selected-test-not-discovered": (value) => { value.inventory.discovered_test_ids = []; },
    "selected-test-not-executed": (value) => { value.inventory.executed_test_ids = []; },
    "selected-test-skipped": (value) => {
      value.inventory.skipped_test_ids = [SELECTED_TEST_ID];
    },
    "incomplete-falsifier-population": (value) => { value.falsifiers.complete = false; },
    "inert-falsifier": (value) => { value.falsifiers.all_detected = false; },
    "incomplete-traversal-population": (value) => { value.traversal.complete = false; },
    "unproven-traversal": (value) => { value.traversal.all_proven = false; },
    "prohibited-shortcut": (value) => {
      value.prohibited_shortcuts = {
        observed: ["source_text_inspection"], violated: ["source_text_inspection"]
      };
    }
  };

export { facts, mutate };
