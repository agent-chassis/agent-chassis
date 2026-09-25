import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST, TEST_PROOF_PROVIDER_CATALOG } from
  "../lib/test-proof-provider-registry.mjs";
import {
  TestProofEvidenceSemanticKernelError,
  evaluateTestProofEvidenceSemantics
} from "../lib/test-proof-evidence-semantic-kernel.mjs";
import { evaluateExecutionTestValidity as evaluateCurrent } from
  "../profiles/proof.verification.test-validity/11.0.0/evaluator.mjs";

const digest = (character) => `sha256:${character.repeat(64)}`;
const selectedTestId = `test-${"1".repeat(64)}`;

const canonicalValue = (value) => Array.isArray(value) ? value.map(canonicalValue)
  : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort()
    .map((key) => [key, canonicalValue(value[key])])) : value;

function artifact(kind, value) {
  const payload = canonicalValue(value);
  const content = `sha256:${createHash("sha256").update(
    `${JSON.stringify(payload)}\n`, "utf8"
  ).digest("hex")}`;
  return {
    artifact_id: `artifact-${content.slice(7)}`,
    kind,
    digest: content,
    owner: "launcher",
    payload
  };
}

function provider(providerId, capability, mechanism, artifactTypes) {
  return {
    provider_id: providerId,
    provider_version: TEST_PROOF_PROVIDER_CATALOG.providers.find(
      ({ provider_id: id }) => id === providerId).provider_version,
    capability,
    capability_snapshot_digest: TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
    observation_mechanism: mechanism,
    evidence_artifact_types: artifactTypes
  };
}

function receipt() {

  const structuredResult = {
    mechanism: "node_test_structured_events",
    exit_code: 0,
    summary: {
      passed: 1,
      failed: 0,
      skipped: 0,
      cancelled: 0,
      todo: 0,
      tests: 1
    },
    pass_events: [{
      type: "test:pass",
      test_id: selectedTestId,
      name: "example",
      file: "test/example.test.mjs",
      nesting: 0,
      status: "passed"
    }],
    fail_events: []
  };
  const candidate = artifact("structured_test_result", structuredResult);

  const boundary = artifact("boundary_trace", { mechanism: "node_test_v8_coverage",
    boundary_kind: "module", module_path: "packages/example.mjs",
    observable_seam: "node_test_structured_assertion", target_test_id: selectedTestId,
    target_pass_observed: true, observed: true, covered_module_paths: ["packages/example.mjs"],
    structured_event_digest: candidate.digest });
  const falsifier = artifact("falsifier_result", { mechanism: "module_substitution",
    strategy: "dependency_failure", mutation_id: "mutation-component",
    target_module_path: "packages/example.mjs", target_test_id: selectedTestId,
    witness_identity: "f".repeat(64), structured_event_digest: candidate.digest,
    observation: { dependency_invocation_count: 1, reached_assertion: true,
      selected_test_only: true, observed: true } });
  return {
    schema_version: "controlled-contract-test-proof-runtime-evidence.v2",
    test_proof_version: "controlled-contract-test-proof.v1",
    authority: "advisory_execution_facts",
    evidence_identity: {
      evidence_id: "test-proof-evidence-post-delivery",
      run_id: "run-post-delivery",
      wk_id: "WK-2458",
      selected_unit: "WK-2458#SLICE-008",
      controlled_contract_generation: digest("a"),
      verification_id: "claim-suite-covers-component",
      source_snapshot_digest: digest("b"),
      command_id: "command-node-test",
      command_target: "test/example.test.mjs",
      test_id: selectedTestId,
      attempt: 1
    },
    contract_binding: {
      contract_digest: digest("c"),
      contract_schema_version: "controlled-acceptance-contract.v1",
      verification_claim_id: "claim-suite-covers-component",
      test_proof_id: "test-proof-component"
    },
    execution_result: {
      status: "passed",
      exit_code: 0,
      attempt_id: `attempt-${"a".repeat(64)}`,
      structured_result: structuredClone(structuredResult),
      evidence_artifact_ids: [candidate.artifact_id],
      provider: provider("launcher.node-test", "candidate_execution",
        "node_test_structured_events", ["structured_test_result"])
    },
    test_inventory: {
      selected_test_id: selectedTestId,
      declared_test_ids: [selectedTestId],
      discovered_test_ids: [selectedTestId],
      executed_test_ids: [selectedTestId],
      skipped_test_ids: []
    },
    boundary_traversals: [{
      boundary_id: "sut-boundary-component",
      observable_id: "observable-component",
      provider_support: "supported",
      provider: provider("launcher.node-test-v8-coverage", "boundary_traversal",
        "node_test_v8_coverage", ["boundary_trace", "structured_test_result"]),
      authenticated: true,
      boundary_kind: "module",
      observation_mechanism: "node_test_v8_coverage",
      observation_seam: "node_test_structured_assertion",
      status: "proven",
      limitation: null,
      evidence_artifact_ids: [boundary.artifact_id]
    }],
    falsifier_executions: [{
      falsifier_id: "falsifier-component",
      attempt_id: `attempt-${"f".repeat(64)}`,
      target_verification_id: "claim-suite-covers-component",
      provider: provider("launcher.node-test-module-fault", "falsifier_execution",
        "node_test_structured_events", ["falsifier_result", "structured_test_result"]),
      provider_support: "supported",
      isolated: true,
      candidate_status: "passed",
      falsified_status: "failed",
      failure_reason_code: "test_proof_fault.dependency_failure.v1",
      mutation: {
        mutation_id: "mutation-component",
        strategy: "dependency_failure",
        mechanism: "module_substitution",
        target_kind: "module",
        module_path: "packages/example.mjs",
        observed: true
      },
      status: "detected",
      limitation: null,
      evidence_artifact_ids: [falsifier.artifact_id]
    }],
    capability_limitations: [],
    observed_shortcuts: [],
    artifacts: [candidate, boundary, falsifier].sort((left, right) =>
      left.artifact_id.localeCompare(right.artifact_id))
  };
}

function resolution() {
  return {
    status: "executable",
    obligation_id: "AC-001",
    contract_generation: digest("a"),
    contract_digest: digest("c"),
    verification_id: "claim-suite-covers-component",
    declared_target: { target: "test/example.test.mjs" },
    test_proof: {
      test_proof_id: "test-proof-component",
      falsifiers: [{ falsifier_id: "falsifier-component" }],
      prohibited_shortcuts: ["source_text_inspection"]
    }
  };
}

function evaluate(receipts, bound = resolution()) {
  return evaluateTestProofEvidenceSemantics({
    resolution: bound,
    receipts,
    expected: {
      wk_id: "WK-2458",
      selected_unit: "WK-2458#SLICE-008",
      source_snapshot_digest: digest("b"),
      test_id: selectedTestId,
      candidate: {
        kind: "reviewer_frozen_candidate",
        commit: "d".repeat(40),
        source_snapshot_digest: digest("b")
      }
    }
  });
}

test("normalizes complete authenticated positive facts without deciding satisfaction", () => {
  const result = evaluate([receipt()]);
  assert.equal(result.status, "facts");
  assert.equal(result.facts.candidate.passed, true);
  assert.deepEqual(result.facts.inventory, {
    declared_test_ids: [selectedTestId],
    discovered_test_ids: [selectedTestId],
    executed_test_ids: [selectedTestId],
    skipped_test_ids: [],
    observed_test_count: 1
  });
  assert.equal(result.facts.falsifiers.all_detected, true);
  assert.equal(result.facts.traversal.all_proven, true);
  assert.equal(result.receipt_population.count, 1);
  assert.equal(Object.hasOwn(result, "satisfaction"), false);
});

test("sibling tests in the same run neither substitute for nor count against the selection", () => {
  const withSiblings = receipt();
  withSiblings.test_inventory.discovered_test_ids =
    [selectedTestId, "test-sibling", "test-sibling-skipped"];
  withSiblings.test_inventory.executed_test_ids = [selectedTestId, "test-sibling"];
  withSiblings.test_inventory.skipped_test_ids = ["test-sibling-skipped"];
  const result = evaluate([withSiblings]);
  assert.equal(result.status, "facts");
  assert.deepEqual(result.facts.inventory, {
    declared_test_ids: [selectedTestId],
    discovered_test_ids: [selectedTestId],
    executed_test_ids: [selectedTestId],
    skipped_test_ids: [],
    observed_test_count: 3
  });

  const skipped = receipt();
  skipped.test_inventory.skipped_test_ids = [selectedTestId];
  assert.deepEqual(evaluate([skipped]).facts.inventory.skipped_test_ids, [selectedTestId]);
  const notExecuted = receipt();
  notExecuted.test_inventory.discovered_test_ids = [selectedTestId, "test-sibling"];
  notExecuted.test_inventory.executed_test_ids = ["test-sibling"];
  assert.deepEqual(evaluate([notExecuted]).facts.inventory.executed_test_ids, []);
});

test("preserves complete valid negative facts for the exact evaluator", () => {
  const negative = receipt();
  negative.observed_shortcuts = ["source_text_inspection"];
  const result = evaluate([negative]);
  assert.equal(result.status, "facts");
  assert.deepEqual(result.facts.prohibited_shortcuts.violated,
    ["source_text_inspection"]);
});

test("distinguishes unavailable evidence from corrupt or cross-bound evidence", () => {
  assert.equal(evaluate([]).reason_code,
    "verify_proof.complete_receipts_unavailable.v1");

  const crossBound = receipt();
  crossBound.evidence_identity.source_snapshot_digest = digest("9");
  assert.throws(() => evaluate([crossBound]),
    (error) => error instanceof TestProofEvidenceSemanticKernelError &&
      error.code === "verify_proof.evidence_cross_bound.v1");

  const corrupt = receipt();
  corrupt.artifacts.find(({ kind }) => kind === "falsifier_result").payload.fixture = "corrupt";
  assert.throws(() => evaluate([corrupt]),
    (error) => error.code === "verify_proof.evidence_invalid.v1");
});

test("refuses duplicate and contradictory authenticated populations", () => {
  const duplicate = receipt();
  assert.throws(() => evaluate([duplicate, structuredClone(duplicate)]),
    (error) => error.code === "verify_proof.evidence_population_duplicate.v1");

  const second = receipt();
  second.evidence_identity.evidence_id = "test-proof-evidence-post-delivery-second";
  second.evidence_identity.run_id = "run-post-delivery-second";
  assert.throws(() => evaluate([receipt(), second]),
    (error) => error.code === "verify_proof.evidence_population_contradictory.v1");
});

const INSTRUMENTATION = { reason_code: "test_proof_native_instrumentation_unsupported",
  detail: { reason: "body_not_single_scalar_return" } };

function unavailableMember(value, index = 0) {
  const row = value.falsifier_executions[index];
  Object.assign(row, { provider_support: "unsupported", isolated: false, falsified_status: "not_run",
    failure_reason_code: null, status: "review_only", limitation: structuredClone(INSTRUMENTATION),
    evidence_artifact_ids: [] });
  row.mutation.observed = false;
  value.capability_limitations.push({ check_kind: "falsifier", check_id: row.falsifier_id,
    ...structuredClone(INSTRUMENTATION) });
  value.artifacts = value.artifacts.filter(({ kind }) => kind !== "falsifier_result");
  return value;
}

function secondMember(value) {
  const second = structuredClone(value.falsifier_executions[0]);
  second.falsifier_id = "falsifier-component-second";
  second.attempt_id = `attempt-${"e".repeat(64)}`;
  second.mutation.mutation_id = "mutation-component-second";
  value.falsifier_executions.push(second);
  return value;
}

function withDeclared(ids) {
  const bound = resolution();
  bound.test_proof.falsifiers = ids.map((id) => ({ falsifier_id: id }));
  return bound;
}

const currentVerdict = (facts) => evaluateCurrent({ semantic_facts: facts });

test("an unavailable declared mutation is a limitation beside a proven selected test", () => {
  const facts = evaluate([unavailableMember(receipt())]);
  assert.equal(facts.status, "facts");
  assert.equal(facts.facts.candidate.passed, true);
  assert.deepEqual(facts.facts.falsifiers.observations.map(({ outcome }) => outcome), ["unavailable"]);
  assert.equal(facts.facts.falsifiers.complete, true);
  assert.equal(facts.facts.falsifiers.all_detected, false, "raw detection fact is preserved");
  assert.deepEqual(facts.facts.falsifiers.outcome_counts,
    { detected: 0, survived: 0, unavailable: 1, unevaluable: 0 });

  assert.deepEqual(currentVerdict(facts), { satisfaction: "satisfied", diagnostics: [],
    semantic_judgment: "exact_pack_evaluator", authority: "non_authoritative" });
  assert.equal(currentVerdict(facts).diagnostics.some(
    ({ code }) => code === "test_validity_execution_falsifier_inert"), false);
});

test("registry-declared unavailable falsification proves a passing selected test", () => {
  const bound = withDeclared([]);
  bound.test_proof.falsification_provider = { mode: "registry_unsupported" };
  const value = receipt();
  value.falsifier_executions = [];
  value.artifacts = value.artifacts.filter(({ kind }) => kind !== "falsifier_result");
  value.capability_limitations = [{ check_kind: "falsifier", check_id: null,
    reason_code: "test_proof_registry_falsification_unsupported", detail: null }];
  const facts = evaluate([value], bound);
  assert.equal(facts.status, "facts");
  assert.equal(facts.facts.falsifiers.declared_unsupported, true);
  assert.equal(currentVerdict(facts).satisfaction, "satisfied");

  const missing = structuredClone(value);
  missing.capability_limitations = [];
  assert.throws(() => evaluate([missing], bound),
    (error) => error.code === "verify_proof.evidence_population_contradictory.v1");

  assert.throws(() => evaluate([value], withDeclared(["falsifier-component"])),
    (error) => error.code === "verify_proof.evidence_population_contradictory.v1");
});

test("an unavailable member neither excuses a survivor nor hides a detection", () => {
  const detectedBeside = unavailableMember(secondMember(receipt()), 1);
  detectedBeside.artifacts = receipt().artifacts;
  const bound = withDeclared(["falsifier-component", "falsifier-component-second"]);
  const mixed = evaluate([detectedBeside], bound);
  assert.deepEqual(mixed.facts.falsifiers.observations.map(({ outcome }) => outcome),
    ["detected", "unavailable"]);
  assert.equal(currentVerdict(mixed).satisfaction, "satisfied");

  const survivor = structuredClone(detectedBeside);
  Object.assign(survivor.falsifier_executions[0], { status: "not_detected",
    falsified_status: "passed", failure_reason_code: null });
  const survived = evaluate([survivor], bound);
  assert.deepEqual(survived.facts.falsifiers.observations.map(({ outcome }) => outcome),
    ["survived", "unavailable"]);
  const verdict = currentVerdict(survived);
  assert.equal(verdict.satisfaction, "unsatisfied");
  assert.deepEqual(verdict.diagnostics.map(({ code }) => code),
    ["test_validity_execution_falsifier_inert"]);
});

test("incomplete or unevaluable falsification for a passing candidate is relationship-local not_executable", () => {
  const incomplete = evaluate([receipt()],
    withDeclared(["falsifier-component", "falsifier-component-missing"]));
  assert.equal(incomplete.status, "not_executable");
  assert.equal(incomplete.reason_code, "verify_proof.falsifier_evidence_not_evaluable.v1");
  assert.deepEqual(incomplete.diagnostics, [{
    code: "verify_proof.falsifier_population_incomplete.v1",
    reason_code: "verify_proof.falsifier_population_incomplete.v1",
    details: { expected_falsifier_ids: ["falsifier-component", "falsifier-component-missing"],
      observed_falsifier_ids: ["falsifier-component"] }
  }]);

  const unreached = receipt();
  Object.assign(unreached.falsifier_executions[0], { status: "not_detected",
    falsified_status: "passed", failure_reason_code: null });
  unreached.falsifier_executions[0].mutation.observed = false;
  const unevaluable = evaluate([unreached]);
  assert.equal(unevaluable.status, "not_executable");
  assert.deepEqual(unevaluable.diagnostics.map(({ code }) => code),
    ["verify_proof.falsifier_outcome_unevaluable.v1"]);
  assert.equal(unevaluable.diagnostics[0].details.mutation_observed, false);
  assert.equal(unevaluable.diagnostics[0].details.outcome, "unevaluable");
});

test("inconsistent unsupported-member evidence is still refused as unauthenticated", () => {
  const withoutLimitation = unavailableMember(receipt());
  withoutLimitation.capability_limitations = [];
  assert.throws(() => evaluate([withoutLimitation]), (error) =>
    error.code === "verify_proof.evidence_invalid.v1" &&
    error.details.diagnostics.diagnostics.some(({ code }) =>
      code === "runtime_falsifier_limitation_incoherent"));
  const mismatched = unavailableMember(receipt());
  mismatched.capability_limitations[0].reason_code = "test_proof_native_runner_unsupported";
  assert.throws(() => evaluate([mismatched]),
    (error) => error.code === "verify_proof.evidence_invalid.v1");
});
