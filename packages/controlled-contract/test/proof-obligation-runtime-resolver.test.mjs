import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { loadExactAdmittedProofPack } from "../lib/admitted-proof-packs.mjs";
import {
  ProofObligationResolutionError,
  resolveProofObligationRuntime
} from "../lib/proof-obligation-runtime-resolver.mjs";

const DIGEST = `sha256:${"a".repeat(64)}`;
const minimal = JSON.parse(await readFile(new URL(
  "../examples/minimal-controlled-acceptance-contract-v034.json", import.meta.url
)));
const postDeliveryPack = await loadExactAdmittedProofPack({
  profileId: "proof.verification.test-validity",
  profileVersion: "3.0.0",
  evaluationStage: "post_delivery"
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
  return {
    ...structuredClone(minimal),
    schema_version: "controlled-acceptance-contract.v1",
    vocabulary_version: "controlled-contract-vocabulary.v1",
    profile_id: "acceptance-contract.standard.v1",
    test_proof_version: "controlled-contract-test-proof.v1",
    test_proofs: [proof()]
  };
}

function coverage(nodeIds = [
  "claim-component-exists",
  "claim-suite-covers-component",
  "rel-suite-verifies-component"
]) {
  return {
    schema_version: "controlled-contract-obligation-coverage.v1",
    wk_id: "WK-2458",
    obligations: [{
      obligation_id: "AC-001",
      source_locator: "/acceptance/criteria/0",
      source_locator_digest: DIGEST,
      statement: "The exact declared test proves the delivered behavior.",
      controlled_contract_node_ids: nodeIds,
      mechanism: {
        owner: "packages/controlled-contract/test/example.test.mjs",
        kind: "test",
        selector: "declared node test"
      },
      proof: {
        kind: "pack_mapping",
        pack_id: "pack-test-validity",
        requested_intent: "controlled-proof-intent.test-verification-validity",
        profile_id: "proof.verification.test-validity",
        profile_version: "2.0.0",
        selector: { kind: "claim", component_id: "suite-covers-component" },
        evaluation_stage: "pre_dispatch"
      }
    }]
  };
}

function proofPlan() {
  return {
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
  const plan = overrides.proofPlan ?? proofPlan();
  return {
    obligationId: "AC-001",
    obligationCoverage,
    obligationCoverageDigest: carrierDigest(obligationCoverage),
    controlledContract,
    contractDigest: carrierDigest(controlledContract),
    contractGeneration: DIGEST,
    proofPlan: plan,
    proofPlanDigest: carrierDigest(plan),
    declaredTargetProjection: target(),
    postDeliveryPack,
    ...overrides
  };
}

test("resolves one exact obligation without rewriting the pre-dispatch proof plan", () => {
  const result = resolveProofObligationRuntime(inputs());
  assert.equal(result.status, "executable");
  assert.equal(result.verification_id, "claim-suite-covers-component");
  assert.equal(result.proof_plan_entry.profile_version, "2.0.0");
  assert.equal(result.post_delivery_pack.profile.profile_version, "3.0.0");
  assert.equal(Object.isFrozen(result), true);
});

test("missing runtime selection precedes declared-target evaluation", () => {
  const value = inputs({ declaredTargetProjection: { status: "unavailable" } });
  delete value.controlledContract.test_proofs[0].runtime_test_identity;
  value.contractDigest = carrierDigest(value.controlledContract);
  const result = resolveProofObligationRuntime(value);
  assert.equal(result.status, "not_executable");
  assert.equal(result.reason_code,
    "verify_proof.runtime_test_selection_missing.v1");
});

test("returns reason-coded non-executable outcomes for unsupported obligation shapes", () => {
  const cases = [
    ["verify_proof.obligation_not_test_backed.v1", (value) => {
      value.obligationCoverage.obligations[0].mechanism.kind = "code_symbol";
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
      value.controlledContract.test_proofs = [];
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
      result = resolveProofObligationRuntime(value);
    } catch (error) {
      assert.fail(`${reason}: ${JSON.stringify(error.details ?? error)}`);
    }
    assert.equal(result.reason_code, reason);
  }
});

test("treats more than one qualifying test verification as the v1 execution limit", () => {
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
  const result = resolveProofObligationRuntime(value);
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
  const result = resolveProofObligationRuntime(value);
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
  assert.throws(() => resolveProofObligationRuntime(relation),
    (error) => error.code === "verify_proof.explicit_relation_disagreement.v1");

  assert.throws(() => resolveProofObligationRuntime(inputs({
    declaredTargetProjection: target("claim-arbitrary-test")
  })), (error) => error.code === "verify_proof.declared_target_verification_mismatch.v1");

  assert.throws(() => resolveProofObligationRuntime(inputs({
    obligationCoverageDigest: DIGEST
  })), (error) => error instanceof ProofObligationResolutionError &&
    error.code === "verify_proof.identity_digest_mismatch.v1");
});
