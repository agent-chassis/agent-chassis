import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { loadExactAdmittedProofPack } from
  "../../controlled-contract/lib/admitted-proof-packs.mjs";
import {
  VERIFY_PROOF_FORBIDDEN_AUTHORITY_KEYS,
  assertVerifyProofCallerShape,
  resolveVerifyProofOperation
} from "../src/operations/controlled-contract/verify-proof-operations.mjs";
import { resolveAuthorizedDeclaredTestTarget } from
  "../src/lib/work-record-test-proof-bindings.mjs";

const DIGEST = `sha256:${"a".repeat(64)}`;
const minimal = JSON.parse(await readFile(new URL(
  "../../controlled-contract/examples/minimal-controlled-acceptance-contract-v034.json",
  import.meta.url
)));
const postDeliveryPack = await loadExactAdmittedProofPack({
  profileId: "proof.verification.test-validity",
  profileVersion: "4.0.0",
  evaluationStage: "post_delivery"
});

function proof(verificationId, suffix) {
  return {
    test_proof_id: `test-proof-${suffix}`,
    verification_claim_id: verificationId,
    system_under_test_boundary: {
      boundary_id: `sut-boundary-${suffix}`,
      kind: "module",
      runtime_module_path: "packages/controlled-contract/lib/example.mjs",
      subject_reference_ids: ["ref-component"]
    },
    observable_result: {
      observable_id: `observable-${suffix}`,
      kind: "return_value",
      proposition_id: verificationId === "claim-suite-covers-component"
        ? "prop-suite-covers-component" : "prop-suite-covers-component-two"
    },
    candidate_execution_provider: {
      provider_id: "launcher.node-test",
      provider_version: "1.0.0",
      capability: "candidate_execution"
    },
    falsifiers: [{
      falsifier_id: `falsifier-${suffix}`,
      strategy: "dependency_failure",
      proposition_id: verificationId === "claim-suite-covers-component"
        ? "prop-component-absent" : "prop-component-absent-two",
      expected_outcome: "verification_fails",
      mutation: {
        mutation_id: `mutation-${suffix}`,
        mechanism: "module_substitution",
        target_kind: "module",
        module_path: "packages/controlled-contract/lib/example.mjs"
      },
      execution_provider: {
        provider_id: "launcher.node-test-module-fault",
        provider_version: "1.0.0",
        capability: "falsifier_execution"
      }
    }],
    traversal_provider: {
      mode: "provider",
      provider_id: "launcher.node-test-v8-coverage",
      provider_version: "1.0.0",
      capability: "boundary_traversal",
      boundary_kind: "module",
      observation_mechanism: "node_test_v8_coverage",
      observation_seam: "node_test_structured_assertion",
      evidence_artifact_type: "boundary_trace"
    },
    coverage_disposition: {
      baseline_id: `coverage-baseline-${suffix}`,
      baseline_state: "complete_executed_inventory",
      items: [{ test_id: `test-${suffix}`, disposition: "preserved" }]
    },
    runtime_test_identity: { test_id: `test-${suffix}` },
    prohibited_shortcuts: ["source_text_inspection"]
  };
}

function contract() {
  const value = {
    ...structuredClone(minimal),
    schema_version: "controlled-acceptance-contract.v1",
    vocabulary_version: "controlled-contract-vocabulary.v1",
    profile_id: "acceptance-contract.standard.v1",
    test_proof_version: "controlled-contract-test-proof.v1"
  };
  value.propositions.push({
    ...structuredClone(value.propositions[1]),
    proposition_id: "prop-suite-covers-component-two"
  }, {
    ...structuredClone(value.propositions[2]),
    proposition_id: "prop-component-absent-two"
  });
  value.claims.push({
    claim_id: "claim-suite-covers-component-two",
    kind: "verification",
    modality: "MUST",
    proposition_id: "prop-suite-covers-component-two",
    verification_method: "test_execution",
    falsifying_proposition_id: "prop-component-absent-two"
  });
  value.relations.push({
    relation_id: "rel-suite-two-verifies-component",
    role: "verifies",
    source_claim_id: "claim-suite-covers-component-two",
    target_claim_id: "claim-component-exists"
  });
  value.test_proofs = [
    proof("claim-suite-covers-component", "one"),
    proof("claim-suite-covers-component-two", "two")
  ];
  return value;
}

function coverage() {
  const row = (id, nodes, index) => ({
    obligation_id: id,
    source_locator: `/acceptance/criteria/${index}`,
    source_locator_digest: DIGEST,
    statement: `Obligation ${id}`,
    controlled_contract_node_ids: nodes,
    mechanism: { owner: "tests/proof.test.mjs", kind: "test", selector: id },
    proof: {
      kind: "pack_mapping",
      pack_id: "pack-test-validity",
      requested_intent: "controlled-proof-intent.test-verification-validity",
      profile_id: "proof.verification.test-validity",
      profile_version: "2.0.0",
      selector: { kind: "claim", component_id: `component-${index}` },
      evaluation_stage: "pre_dispatch"
    }
  });
  return {
    schema_version: "controlled-contract-obligation-coverage.v1",
    wk_id: "WK-2458",
    obligations: [
      row("OBL-ONE-A", ["claim-suite-covers-component",
        "rel-suite-verifies-component"], 0),
      row("OBL-ONE-B", ["claim-suite-covers-component",
        "rel-suite-verifies-component"], 1),
      row("OBL-TWO", ["claim-suite-covers-component-two",
        "rel-suite-two-verifies-component"], 2),
      row("OBL-ALL", ["claim-component-exists"], 3)
    ]
  };
}

function context(overrides = {}) {
  const controlledContract = contract();
  return {
    authenticatedRole: "orchestrator",
    workRecord: {
      id: "WK-2458",
      acceptance: { validation: [] },
      slices: [{
        id: "SLICE-001",
        acceptance: { validation: [{
          operation: "node_test",
          target: "tests/one.test.mjs",
          verification_ids: ["claim-suite-covers-component"]
        }] }
      }, {
        id: "SLICE-002",
        acceptance: { validation: [{
          operation: "node_test",
          target: "tests/two.test.mjs",
          verification_ids: ["claim-suite-covers-component-two"]
        }] }
      }, { id: "SLICE-003", acceptance: { validation: [] } }]
    },
    selectedUnit: null,
    controlledContract,
    contractWkId: "WK-2458",
    contractGeneration: DIGEST,
    contractDigest: DIGEST,
    obligationCoverage: coverage(),
    obligationCoverageDigest: DIGEST,
    proofPlan: {
      schema_version: "controlled-contract-proof-plan.v1",
      requested_intents: ["controlled-proof-intent.test-verification-validity"],
      digests: {},
      packs: [{
        profile_id: "proof.verification.test-validity",
        profile_version: "2.0.0",
        requested_intents: ["controlled-proof-intent.test-verification-validity"],
        evaluation_input: { path: "WK-2458.evaluation-input.json" },
        exact_binding: null,
        source_digests: {}
      }]
    },
    proofPlanDigest: DIGEST,
    postDeliveryPack,
    sourceSnapshotDigest: DIGEST,
    ...overrides
  };
}

test("verify-proof caller shape is subject-only and keeps git_sha orchestrator-only", () => {
  assert.doesNotThrow(() => assertVerifyProofCallerShape(
    { subject: "OBL-ONE-A" }, { authenticatedRole: "worker" }
  ));
  assert.doesNotThrow(() => assertVerifyProofCallerShape({
    subject: "WK-2458", repo: "agent-chassis/agent-chassis"
  }, { authenticatedRole: "reviewer" }));
  assert.doesNotThrow(() => assertVerifyProofCallerShape({
    subject: "test-proof-one", git_sha: "a".repeat(40)
  }, { authenticatedRole: "orchestrator" }));
  assert.throws(() => assertVerifyProofCallerShape({ obligation_id: "OBL-ONE-A" },
    { authenticatedRole: "orchestrator" }),
  (error) => error.code === "verify_proof.input_invalid.v1");
  for (const key of VERIFY_PROOF_FORBIDDEN_AUTHORITY_KEYS) assert.throws(
    () => assertVerifyProofCallerShape({ subject: "WK-2458", [key]: "caller" },
      { authenticatedRole: "orchestrator" }),
    (error) => error.code === "verify_proof.caller_authority_forbidden.v1", key
  );
});

test("WK, slice, test-proof, and obligation subjects share one deterministic population shape",
  () => {
    const cases = [
      ["WK-2458", "wk", ["test-proof-one", "test-proof-two"]],
      ["WK-2458#SLICE-001", "slice", ["test-proof-one"]],
      ["test-proof-two", "test_proof", ["test-proof-two"]],
      ["OBL-ALL", "obligation", ["test-proof-one", "test-proof-two"]]
    ];
    for (const [subject, kind, expected] of cases) {
      const result = resolveVerifyProofOperation({ args: { subject }, context: context() });
      assert.equal(result.schema_version,
        "controlled-contract-verify-proof-population-resolution.v1");
      assert.equal(result.status, "executable");
      assert.equal(result.subject.kind, kind);
      assert.deepEqual(result.proofs.map(({ test_proof_id: id }) => id), expected);
      assert.equal(result.proof_count, expected.length);
    }
  });

test("resolution refuses missing, ambiguous, empty, and cross-generation subjects", () => {
  assert.equal(resolveVerifyProofOperation({ args: { subject: "missing" },
    context: context() }).reason_code, "verify_proof.subject_unknown.v1");
  const ambiguous = context();
  ambiguous.workRecord.slices.push(structuredClone(ambiguous.workRecord.slices[0]));
  assert.throws(() => resolveVerifyProofOperation({
    args: { subject: "WK-2458#SLICE-001" }, context: ambiguous
  }), (error) => error.code === "verify_proof.subject_ambiguous.v1");
  assert.equal(resolveVerifyProofOperation({ args: { subject: "WK-2458#SLICE-003" },
    context: context() }).reason_code, "verify_proof.proof_population_empty.v1");
  assert.throws(() => resolveVerifyProofOperation({ args: { subject: "WK-2458" },
    context: context({ contractWkId: "WK-9999" }) }),
  (error) => error.code === "verify_proof.contract_generation_mismatch.v1");
});

test("whole-population readiness is atomic and preserves duplicate relationships", () => {
  const value = context();
  delete value.controlledContract.test_proofs[1].runtime_test_identity;
  const result = resolveVerifyProofOperation({ args: { subject: "WK-2458" }, context: value });
  assert.equal(result.status, "not_executable");
  assert.equal(result.reason_code, "verify_proof.population_not_ready.v1");
  assert.equal(result.proof_count, 2);
  assert.equal(result.diagnostics.some(({ reason_code: code }) =>
    code === "verify_proof.runtime_test_selection_missing.v1"), true);
  const ready = resolveVerifyProofOperation({ args: { subject: "test-proof-one" },
    context: context() });
  assert.deepEqual(ready.proofs[0].relationships.map(({ obligation_id: id }) => id),
    ["OBL-ALL", "OBL-ONE-A", "OBL-ONE-B"]);
});

test("orchestrator declared-target resolution is unique across root and slices", () => {
  const verificationId = "claim-verify";
  const base = {
    id: "WK-2466",
    acceptance: { validation: [] },
    slices: [{
      id: "SLICE-005",
      acceptance: { validation: [{
        operation: "node_test",
        target: "packages/wiki-core/test/verify-proof-operations.test.mjs",
        verification_ids: [verificationId]
      }] }
    }]
  };
  assert.equal(resolveAuthorizedDeclaredTestTarget({
    workRecord: base,
    selectedUnit: null,
    orchestrator: true,
    verificationId,
    controlledContractGeneration: DIGEST,
    sourceSnapshotDigest: DIGEST
  }).status, "resolved");
  const duplicate = structuredClone(base);
  duplicate.acceptance.validation.push({
    operation: "node_test",
    target: "tests/duplicate.test.mjs",
    verification_ids: [verificationId]
  });
  assert.equal(resolveAuthorizedDeclaredTestTarget({
    workRecord: duplicate,
    selectedUnit: null,
    orchestrator: true,
    verificationId,
    controlledContractGeneration: DIGEST
  }).status, "refused");
});
