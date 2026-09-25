

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
  TEST_PROOF_PROVIDER_CATALOG
} from "../../packages/controlled-contract/lib/test-proof-provider-registry.mjs";
import { evaluateTestProofEvidenceSemantics } from
  "../../packages/controlled-contract/lib/test-proof-evidence-semantic-kernel.mjs";
import { resolveExactProofEvaluator } from
  "../../packages/controlled-contract/lib/proof-evaluator-registry.mjs";

const TEST_ID = `test-${"1".repeat(64)}`;
const MODULE = "lib/component.mjs";
const sha = (character) => `sha256:${character.repeat(64)}`;
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort()
    .map((key) => [key, canonical(value[key])])) : value;

function artifact(kind, value) {
  const payload = canonical(value);
  const digest = `sha256:${createHash("sha256").update(`${JSON.stringify(payload)}\n`).digest("hex")}`;
  return { artifact_id: `artifact-${digest.slice(7)}`, kind, digest, owner: "launcher", payload };
}

function provider(id, capability, mechanism, types) {
  return { provider_id: id, capability, observation_mechanism: mechanism,
    provider_version: TEST_PROOF_PROVIDER_CATALOG.providers.find(({ provider_id: pid }) =>
      pid === id).provider_version,
    capability_snapshot_digest: TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
    evidence_artifact_types: types };
}

function receipt({ selectedPassed = true, siblingPassed = false, falsifierDetected = true,
  traversalProven = true, shortcuts = [] } = {}) {
  const passEvents = [
    ...(selectedPassed ? [{ type: "test:pass", test_id: TEST_ID, name: "selected",
      file: "test/c.test.mjs", nesting: 0, status: "passed" }] : []),
    ...(siblingPassed ? [{ type: "test:pass", test_id: `test-${"2".repeat(64)}`, name: "sibling",
      file: "test/c.test.mjs", nesting: 0, status: "passed" }] : [])
  ];
  const structured = { mechanism: "node_test_structured_events", exit_code: 0,
    summary: { passed: passEvents.length, failed: 0, skipped: 0, cancelled: 0, todo: 0,
      tests: passEvents.length }, pass_events: passEvents, fail_events: [] };
  const candidate = artifact("structured_test_result", structured);
  const boundary = artifact("boundary_trace", { mechanism: "node_test_v8_coverage",
    boundary_kind: "module", module_path: MODULE, observable_seam: "node_test_structured_assertion",
    target_test_id: TEST_ID, target_pass_observed: true, observed: true,
    covered_module_paths: [MODULE] });
  const falsifier = artifact("falsifier_result", { mechanism: "module_substitution",
    strategy: "dependency_failure", mutation_id: "mutation-component", target_module_path: MODULE,
    target_test_id: TEST_ID, witness_identity: "f".repeat(64),
    observation: { dependency_invocation_count: 1, reached_assertion: true,
      selected_test_only: true, observed: true } });
  const discovered = [TEST_ID, ...(siblingPassed ? [`test-${"2".repeat(64)}`] : [])].sort();
  return {
    schema_version: "controlled-contract-test-proof-runtime-evidence.v2",
    test_proof_version: "controlled-contract-test-proof.v1",
    authority: "advisory_execution_facts",
    evidence_identity: { evidence_id: "test-proof-evidence-guarantee", run_id: "run-guarantee",
      wk_id: "WK-9659", selected_unit: "WK-9659#SLICE-001", controlled_contract_generation: sha("a"),
      verification_id: "claim-component", source_snapshot_digest: sha("b"),
      command_id: "command-node-test", command_target: "test/c.test.mjs", test_id: TEST_ID, attempt: 1 },
    contract_binding: { contract_digest: sha("c"), contract_schema_version: "controlled-acceptance-contract.v1",
      verification_claim_id: "claim-component", test_proof_id: "test-proof-component" },
    execution_result: { status: "passed", exit_code: 0, attempt_id: `attempt-${"a".repeat(64)}`,
      structured_result: structuredClone(structured), evidence_artifact_ids: [candidate.artifact_id],
      provider: provider("launcher.node-test", "candidate_execution", "node_test_structured_events",
        ["structured_test_result"]) },
    test_inventory: { selected_test_id: TEST_ID, declared_test_ids: [TEST_ID],
      discovered_test_ids: discovered, executed_test_ids: discovered, skipped_test_ids: [] },
    boundary_traversals: [{ boundary_id: "sut-boundary-component", observable_id: "observable-component",
      provider_support: "supported", authenticated: true, boundary_kind: "module",
      provider: provider("launcher.node-test-v8-coverage", "boundary_traversal", "node_test_v8_coverage",
        ["boundary_trace", "structured_test_result"]),
      observation_mechanism: "node_test_v8_coverage", observation_seam: "node_test_structured_assertion",
      status: traversalProven ? "proven" : "not_proven", limitation: null,
      evidence_artifact_ids: [boundary.artifact_id] }],
    falsifier_executions: [{ falsifier_id: "falsifier-component", attempt_id: `attempt-${"f".repeat(64)}`,
      target_verification_id: "claim-component",
      provider: provider("launcher.node-test-module-fault", "falsifier_execution",
        "node_test_structured_events", ["falsifier_result", "structured_test_result"]),
      provider_support: "supported",
      isolated: true, candidate_status: "passed", falsified_status: falsifierDetected ? "failed" : "passed",
      failure_reason_code: falsifierDetected ? "test_proof_fault.dependency_failure.v1" : null,
      mutation: { mutation_id: "mutation-component", strategy: "dependency_failure",
        mechanism: "module_substitution", target_kind: "module", module_path: MODULE, observed: true },
      status: falsifierDetected ? "detected" : "not_detected", limitation: null,
      evidence_artifact_ids: [falsifier.artifact_id] }],
    capability_limitations: [],
    observed_shortcuts: shortcuts,
    artifacts: [candidate, boundary, falsifier].sort((left, right) =>
      left.artifact_id < right.artifact_id ? -1 : 1)
  };
}

function facts(evidence) {
  return evaluateTestProofEvidenceSemantics({
    resolution: { status: "executable", obligation_id: "OBL-GUARANTEE", contract_generation: sha("a"),
      contract_digest: sha("c"), verification_id: "claim-component",
      declared_target: { target: "test/c.test.mjs" },
      test_proof: { test_proof_id: "test-proof-component",
        falsifiers: [{ falsifier_id: "falsifier-component" }],
        prohibited_shortcuts: ["source_text_inspection"] } },
    receipts: evidence === null ? [] : [evidence],
    expected: { wk_id: "WK-9659", selected_unit: "WK-9659#SLICE-001",
      source_snapshot_digest: sha("b"), test_id: TEST_ID }
  });
}

test("saved proof requirements and exact evaluator determine satisfaction", async () => {
  const resolved = await resolveExactProofEvaluator({ proofPack: { profile: {
    profile_id: "proof.verification.test-validity", profile_version: "11.0.0" } } });
  assert.equal(resolved.status, "resolved");
  const evaluate = (evidence) => resolved.evaluate({ semantic_facts: facts(evidence) });
  assert.equal(evaluate(receipt()).satisfaction, "satisfied");
  const codes = (evidence) => evaluate(evidence).diagnostics.map(({ code }) => code);

  assert.deepEqual(codes(receipt({ selectedPassed: false, siblingPassed: true })),
    ["test_validity_execution_candidate_failed"]);
  const siblingOnly = receipt({ siblingPassed: true });
  assert.equal(evaluate(siblingOnly).satisfaction, "satisfied");
  assert.deepEqual(codes(receipt({ falsifierDetected: false })), ["test_validity_execution_falsifier_inert"]);
  assert.deepEqual(codes(receipt({ traversalProven: false })), ["test_validity_execution_traversal_unproven"]);
  assert.deepEqual(codes(receipt({ shortcuts: ["source_text_inspection"] })),
    ["test_validity_execution_prohibited_shortcut"]);

  assert.equal(facts(null).status, "not_executable");
  assert.throws(() => resolved.evaluate({ semantic_facts: facts(null) }),
    { code: "proof_evaluator.semantic_facts_invalid.v1" });

  assert.throws(() => facts({ schema_version: "workspace-agent-runner-test-result.v1",
    operation: "runner_test", ok: true }), { code: "verify_proof.evidence_invalid.v1" });

  for (const retired of ["9.0.0", "10.0.0"]) {
    const other = await resolveExactProofEvaluator({ proofPack: { profile: {
      profile_id: "proof.verification.test-validity", profile_version: retired } } });
    assert.equal(other.status, "not_executable", retired);
  }
  await assert.rejects(resolveExactProofEvaluator({ proofPack: { profile: {
    profile_id: "proof.verification.test-validity", profile_version: "11.0.0" } },
  expectedImplementationDigest: sha("0") }), { code: "verify_proof.evaluator_digest_mismatch.v1" });
});
