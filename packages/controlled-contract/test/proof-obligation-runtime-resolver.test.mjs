import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { loadExactAdmittedProofPack } from "../lib/admitted-proof-packs.mjs";
import {
  ProofObligationResolutionError,
  prepareProofObligationRuntime,
  resolveProofObligationRuntime
} from "../lib/proof-obligation-runtime-resolver.mjs";

const DIGEST = `sha256:${"a".repeat(64)}`;
const example = JSON.parse(await readFile(new URL(
  "../examples/minimal-controlled-acceptance-contract.v1.json", import.meta.url
)));
const executionPack = await loadExactAdmittedProofPack({
  profileId: "proof.verification.test-validity",
  profileVersion: "10.0.0",

});
const definition = {
  proof_name: executionPack.profile.profile_id,
  proof_version: executionPack.profile.profile_version,
  profile_digest: executionPack.profile_digest,
  admission_digest: executionPack.admission_digest,
  parameter_contract_digest: executionPack.parameter_contract_digest
};

test("retired test-validity profiles are not selectable", async () => {
  await assert.rejects(loadExactAdmittedProofPack({
    profileId: "proof.verification.test-validity",
    profileVersion: "8.0.0"
  }), (error) => {
    assert.equal(error.code, "proof_pack_exact_version_not_current");
    assert.deepEqual(error.details.requested, {
      profile_id: "proof.verification.test-validity",
      profile_version: "8.0.0"
    });
    assert.deepEqual(error.details.current, {
      profile_id: "proof.verification.test-validity",
      profile_version: "10.0.0"
    });
    return true;
  });
});

function carrierDigest(value) {
  return `sha256:${createHash("sha256").update(
    `${JSON.stringify(value, null, 2)}\n`
  ).digest("hex")}`;
}

function proof(claimId = "claim-suite-covers-component", suffix = "component") {
  return {
    test_proof_id: `test-proof-${suffix}`,
    verification_claim_id: claimId,
    system_under_test_boundary: {
      boundary_id: `sut-boundary-${suffix}`,
      kind: "module",
      runtime_module_path: "packages/controlled-contract/lib/example.mjs",
      subject_reference_ids: ["ref-component"]
    },
    observable_result: {
      observable_id: `observable-${suffix}`,
      kind: "return_value",
      proposition_id: "prop-suite-covers-component"
    },
    candidate_execution_provider: {
      provider_id: "launcher.node-test",
      provider_version: "1.0.0",
      capability: "candidate_execution"
    },
    falsifiers: [{
      falsifier_id: `falsifier-${suffix}`,
      strategy: "dependency_failure",
      proposition_id: "prop-component-absent",
      expected_outcome: "verification_fails",
      mutation: {
        mutation_id: `mutation-${suffix}`,
        mechanism: "module_substitution",
        target_kind: "module",
        module_path: "packages/controlled-contract/lib/example.mjs"
      },
      execution_provider: {
        provider_id: "launcher.node-test-module-fault",
        provider_version: "2.0.0",
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
    test_selector: { name: `${suffix} result is returned`, nesting: 0 },
    prohibited_shortcuts: ["source_text_inspection"]
  };
}

function contract() {
  return { ...structuredClone(example), test_proofs: [proof()] };
}

function coverage(nodeIds = [
  "claim-component-exists",
  "claim-suite-covers-component",
  "rel-suite-verifies-component"
]) {
  return {
    schema_version: "controlled-contract-obligation-coverage.v3",
    wk_id: "WK-2458",
    selected_unit: null,
    focus: null,
    obligations: [{
      obligation_id: "AC-001",
      statement: "The exact declared test proves the delivered behavior.",
      controlled_contract_node_ids: nodeIds,
      mechanism: {
        owner: "packages/controlled-contract/test/example.test.mjs",
        kind: "test",
        selector: "declared node test"
      },
      selection: { ...definition, parameters: {} }
    }]
  };
}

function target(verificationId = "claim-suite-covers-component") {
  return {
    status: "resolved",
    verification_id: verificationId,
    unit: "WK-2458#SLICE-003",
    operation: "node_test",
    target: "packages/controlled-contract/test/example.test.mjs",
    target_id: `declared-target:WK-2458#SLICE-003:${verificationId}:example`,
    controlled_contract_generation: DIGEST,
    source_snapshot_digest: DIGEST
  };
}

function inputs(overrides = {}) {
  const controlledContract = overrides.controlledContract ?? contract();
  const obligationCoverage = overrides.obligationCoverage ?? coverage();
  return {
    wkId: "WK-2458",
    obligationId: "AC-001",
    obligationCoverage,
    obligationCoverageDigest: carrierDigest(obligationCoverage),
    controlledContract,
    contractDigest: carrierDigest(controlledContract),
    contractGeneration: DIGEST,
    declaredTargetProjection: target(),
    executionPack,
    ...overrides
  };
}

function selectedTestExecutionAssessment() {
  return {
    requirements: {
      authored_case: "required",
      native_test_binding: "required",
      declared_test_target: "required",
      test_execution_evidence: "required"
    }
  };
}

function resolve(value) {
  const defaultResolvedRow = { definition, input_status: "valid",
    resolved_identity: "b".repeat(64),
    selected_proof_assessment: selectedTestExecutionAssessment() };
  return resolveProofObligationRuntime({
    ...value,
    prepared: prepareProofObligationRuntime(value),
    resolvedRow: { ...defaultResolvedRow, ...value.resolvedRow,
      selected_proof_assessment: value.resolvedRow?.selected_proof_assessment ??
        defaultResolvedRow.selected_proof_assessment },
    resolvedNode: value.resolvedNode ?? { identity: "b".repeat(64), dependencies: [] },
    executionSourceBinding: { binding_digest: DIGEST }
  });
}

test("resolves the selected current application without a proof plan", () => {
  const result = resolve(inputs());
  assert.equal(result.schema_version, "controlled-contract-proof-obligation-resolution.v3");
  assert.equal(result.status, "executable");
  assert.equal(result.verification_id, "claim-suite-covers-component");
  assert.deepEqual(result.selected_definition, definition);
  assert.equal(result.execution_pack.profile.profile_version, "10.0.0");
  assert.equal(result.execution_pack.test_validity_evaluator.implementation_id,
    "proof.verification.test-validity.execution-evaluator");
  assert.equal(result.execution_pack.test_validity_evaluator.implementation_version, "8.0.0");
  assert.deepEqual(result.execution_source_binding, { binding_digest: DIGEST });
  assert.equal(Object.hasOwn(result, "planning_pack"), false);
  assert.equal(Object.hasOwn(result, "proof_plan_entry"), false);
  assert.equal(Object.isFrozen(result), true);
});

test("refuses a selected definition that differs from the authenticated evaluator", () => {
  for (const field of Object.keys(definition)) {
    const altered = { ...definition, [field]: field.endsWith("digest")
      ? "0".repeat(64) : "noncurrent" };
    assert.throws(() => resolve(inputs({ resolvedRow: {
      definition: altered, input_status: "valid", resolved_identity: "b".repeat(64)
    } })), { code: "verify_proof.execution_pack_binding_mismatch.v1" });
  }
});

test("reports unavailable node inputs and unexecutable dependency edges explicitly", () => {
  assert.equal(resolve(inputs({ resolvedRow: { input_status: "invalid" } })).reason_code,
    "verify_proof.runtime_inputs_unavailable.v1");
  assert.equal(resolve(inputs({ resolvedNode: {
    identity: "b".repeat(64), dependencies: ["c".repeat(64)]
  } })).reason_code, "verify_proof.runtime_dependency_unavailable.v1");
});

test("a malformed declarative selector is refused as a contract defect before any obligation resolves", () => {

  const cases = [
    ["absent", "binding_incomplete", (binding) => { delete binding.test_selector; }],
    ["negative nesting", "contract_invalid",
      (binding) => { binding.test_selector.nesting = -1; }],
    ["empty name", "contract_invalid", (binding) => { binding.test_selector.name = ""; }],
    ["unsupported member", "contract_invalid",
      (binding) => { binding.test_selector.file = "test/x.test.mjs"; }]
  ];
  for (const [label, expectedStage, mutate] of cases) {
    const value = inputs({ declaredTargetProjection: { status: "unavailable" } });
    mutate(value.controlledContract.test_proofs[0]);
    value.contractDigest = carrierDigest(value.controlledContract);
    let details;
    if (expectedStage === "binding_incomplete") {
      const result = resolve(value);
      assert.equal(result.status, "not_executable", label);
      assert.equal(result.reason_code,
        "verify_proof.test_proof_binding_incomplete.v1", label);
      assert.equal(result.details.owner_code, "stable_test_proof_incomplete", label);
      details = result.details;
    } else {
      assert.throws(() => resolve(value), (error) => {
        assert.ok(error instanceof ProofObligationResolutionError, label);
        assert.equal(error.code, "verify_proof.controlled_contract_invalid.v1", label);
        details = error.details;
        return true;
      }, label);
    }
    const diagnostics = JSON.stringify(details.diagnostics);
    assert.ok(diagnostics.includes("test_selector"), `${label}: ${diagnostics}`);
    const serialized = JSON.stringify(details);
    for (const retired of ["runtime_test", "readiness", "inventory", "capture"]) {
      assert.equal(serialized.includes(retired), false, `${label}: ${retired}`);
    }
  }
});

test("a selector naming a test that does not exist yet is a complete definition", () => {
  const value = inputs();
  value.controlledContract.test_proofs[0].test_selector = {
    name: "an assertion nobody has written", nesting: 3
  };
  value.contractDigest = carrierDigest(value.controlledContract);
  const result = resolve(value);
  assert.equal(result.status, "executable");
  assert.deepEqual(result.test_proof.test_selector,
    { name: "an assertion nobody has written", nesting: 3 });
});

test("uses selected proof capability and retains binding failures for code-symbol mechanisms", () => {
  const executable = inputs();
  executable.obligationCoverage.obligations[0].mechanism.kind = "code_symbol";
  executable.obligationCoverageDigest = carrierDigest(executable.obligationCoverage);
  assert.equal(resolve(executable).status, "executable");

  const cases = [
    ["verify_proof.obligation_not_test_backed.v1", (value) => {
      value.resolvedRow = { definition, input_status: "valid", resolved_identity: "b".repeat(64),
        selected_proof_assessment: { requirements: { test_execution_evidence: "not_applicable" } } };
    }],
    ["verify_proof.qualifying_verification_missing.v1", (value) => {
      value.controlledContract.claims.push({
        claim_id: "claim-unverified-behavior",
        kind: "behavior",
        modality: "SHOULD",
        proposition_id: "prop-component-exists"
      });
      value.obligationCoverage = coverage(["claim-unverified-behavior"]);
    }],
    ["verify_proof.test_proof_binding_missing.v1", (value) => {
      value.obligationCoverage.obligations[0].mechanism.kind = "code_symbol";
      value.controlledContract.test_proofs = [];
    }],
    ["verify_proof.test_proof_binding_incomplete.v1", (value) => {
      value.obligationCoverage.obligations[0].mechanism.kind = "code_symbol";
      delete value.controlledContract.test_proofs[0].test_selector;
    }],
    ["verify_proof.declared_target_missing.v1", (value) => {
      value.declaredTargetProjection = { status: "unavailable" };
    }]
  ];
  for (const [reason, mutate] of cases) {
    const value = inputs();
    mutate(value);
    value.obligationCoverageDigest = carrierDigest(value.obligationCoverage);
    value.contractDigest = carrierDigest(value.controlledContract);
    let result;
    try {
      result = resolve(value);
    } catch (error) {
      assert.fail(`${reason}: ${JSON.stringify(error.details ?? error)}`);
    }
    assert.equal(result.reason_code, reason);
  }
});

test("treats more than one qualifying test verification as an ambiguous native binding", () => {
  const value = inputs();
  value.controlledContract.claims.push({
    claim_id: "claim-second-test",
    kind: "verification",
    modality: "MUST",
    proposition_id: "prop-suite-covers-component",
    verification_method: "test_execution",
    falsifying_proposition_id: "prop-component-absent"
  });
  value.controlledContract.relations.push({
    relation_id: "rel-second-verifies-component",
    role: "verifies",
    source_claim_id: "claim-second-test",
    target_claim_id: "claim-component-exists"
  });
  value.controlledContract.test_proofs.push(proof("claim-second-test", "second"));
  value.controlledContract.claims.sort((left, right) =>
    left.claim_id.localeCompare(right.claim_id));
  value.controlledContract.relations.sort((left, right) =>
    left.relation_id.localeCompare(right.relation_id));
  value.controlledContract.test_proofs.sort((left, right) =>
    left.verification_claim_id.localeCompare(right.verification_claim_id));
  value.obligationCoverage.obligations[0].controlled_contract_node_ids.push(
    "claim-second-test", "rel-second-verifies-component"
  );
  value.obligationCoverageDigest = carrierDigest(value.obligationCoverage);
  value.contractDigest = carrierDigest(value.controlledContract);
  const result = resolve(value);
  assert.equal(result.reason_code, "verify_proof.qualifying_verification_ambiguous.v1");
  assert.deepEqual(result.details.verification_ids,
    ["claim-second-test", "claim-suite-covers-component"]);
});

test("requires every behavior in an applicable mandatory behavior collection", () => {
  const value = inputs();
  value.controlledContract.claims.push({
    claim_id: "claim-second-behavior",
    kind: "behavior",
    modality: "SHOULD",
    proposition_id: "prop-component-exists"
  });
  value.controlledContract.collections.push({
    collection_id: "set-mandatory-verify-proof-behaviors",
    collection_kind: "closed_set",
    purpose: "mandatory_verify_proof_behaviors",
    member_claim_ids: ["claim-component-exists", "claim-second-behavior"]
  });
  value.controlledContract.claims.sort((left, right) =>
    left.claim_id.localeCompare(right.claim_id));
  value.obligationCoverage = coverage([
    "claim-component-exists",
    "claim-suite-covers-component",
    "rel-suite-verifies-component",
    "set-mandatory-verify-proof-behaviors"
  ]);
  value.obligationCoverageDigest = carrierDigest(value.obligationCoverage);
  value.contractDigest = carrierDigest(value.controlledContract);
  const result = resolve(value);
  assert.equal(result.reason_code,
    "verify_proof.mandatory_behavior_coverage_incomplete.v1");
  assert.deepEqual(result.details.missing_behavior_claim_ids, ["claim-second-behavior"]);
});

test("refuses relation disagreement, target substitution, and coverage corruption", () => {
  const relation = inputs();
  relation.controlledContract.relations.push({
    relation_id: "rel-component-depends-on-suite",
    role: "depends_on",
    source_claim_id: "claim-component-exists",
    target_claim_id: "claim-suite-covers-component"
  });
  relation.obligationCoverage.obligations[0].controlled_contract_node_ids.push(
    "rel-component-depends-on-suite"
  );
  relation.obligationCoverageDigest = carrierDigest(
    relation.obligationCoverage
  );
  relation.contractDigest = carrierDigest(relation.controlledContract);
  assert.throws(() => resolve(relation),
    (error) => error.code === "verify_proof.explicit_relation_disagreement.v1");

  assert.throws(() => resolve(inputs({
    declaredTargetProjection: target("claim-arbitrary-test")
  })), (error) => error.code === "verify_proof.declared_target_verification_mismatch.v1");

  assert.throws(() => resolve(inputs({
    obligationCoverageDigest: DIGEST
  })), (error) => error instanceof ProofObligationResolutionError &&
    error.code === "verify_proof.identity_digest_mismatch.v1");
});

test("a missing authenticated execution definition cannot execute", () => {
  assert.equal(resolve(inputs({ executionPack: null })).reason_code,
    "verify_proof.execution_pack_unavailable.v1");
});
