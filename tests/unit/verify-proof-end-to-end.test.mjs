import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { loadExactAdmittedProofPack } from
  "../../packages/controlled-contract/lib/admitted-proof-packs.mjs";
import { executeVerifyProofForContext } from
  "../../packages/wiki-mcp/src/lib/verify-proof-tool.mjs";
import {
  queryControlledContractTestProofBindings,
  resolveControlledContractTestProofRuntimeBindings
} from "../../packages/wiki-core/src/lib/controlled-contract-tools.mjs";

const DIGEST = (character) => `sha256:${character.repeat(64)}`;
const TEST_ID = (value) => `test-${createHash("sha256").update(value).digest("hex")}`;
const MANIFEST_GENERATION_ID = "f".repeat(64);
const pack = await loadExactAdmittedProofPack({
  profileId: "proof.verification.test-validity",
  profileVersion: "4.0.0",
  evaluationStage: "post_delivery"
});

function relationship(id) {
  return {
    obligation_id: id,
    obligation: { obligation_id: id },
    behavior_claim_ids: ["claim-behavior"],
    relation_ids: [`relation-${id}`],
    proof_plan_entry: { exact_binding: null },
    proof_plan_entry_digest: DIGEST("5")
  };
}

function resolvedProof(suffix, relationships = [relationship(`OBL-${suffix}`)]) {
  return {
    test_proof_id: `test-proof-${suffix}`,
    verification_id: `claim-verification-${suffix}`,
    test_proof: {
      test_proof_id: `test-proof-${suffix}`,
      verification_claim_id: `claim-verification-${suffix}`,
      runtime_test_identity: { test_id: TEST_ID(suffix) }
    },
    declared_target: {
      target_id: `declared-target:WK-2458#SLICE-008:claim-verification-${suffix}`,
      operation: "node_test",
      target: `tests/${suffix}.test.mjs`,
      unit: "WK-2458#SLICE-008",
      controlled_contract_generation: DIGEST("1"),
      source_snapshot_digest: DIGEST("6")
    },
    relationships
  };
}

function population(proofs = [resolvedProof("one")], overrides = {}) {
  return {
    schema_version: "controlled-contract-verify-proof-population-resolution.v1",
    status: "executable",
    authority: "non_authoritative",
    subject: { requested: "WK-2458", kind: "wk", canonical_id: "WK-2458" },
    wk_id: "WK-2458",
    contract_generation: DIGEST("1"),
    contract_digest: DIGEST("2"),
    obligation_coverage_digest: DIGEST("3"),
    proof_plan_digest: DIGEST("4"),
    post_delivery_pack: pack,
    proof_count: proofs.length,
    relationship_count: proofs.reduce((total, proof) => total + proof.relationships.length, 0),
    proofs,
    ...overrides
  };
}

function runtime(overrides = {}) {
  return {
    role: "reviewer",
    candidateIdentity: "a".repeat(40),
    authority: {
      wk_id: "WK-2458",
      selected_unit: "WK-2458#SLICE-008",
      worktree_path: "/frozen",
      candidate_identity: "a".repeat(40)
    },
    ...overrides
  };
}

function completeSelection(resolved, overrides = {}) {
  return {
    status: "complete",
    requested_count: resolved.proofs.length,
    matched_count: resolved.proofs.length,
    controlled_contract_generation: resolved.contract_generation,
    content_digest: resolved.contract_digest,
    bindings: resolved.proofs.map(({ test_proof: proof }) => proof),
    ...overrides
  };
}

function semanticFacts(obligationId, candidate, {
  negative = false,
  candidateStatus = "passed"
} = {}) {
  const facts = {
    candidate: { status: candidateStatus, passed: candidateStatus === "passed" },
    inventory: {
      declared_test_ids: ["test"], discovered_test_ids: ["test"],
      executed_test_ids: ["test"], skipped_test_ids: [],
      newly_skipped_test_ids: [], unexpected_test_ids: []
    },
    falsifiers: {
      expected_ids: ["falsifier"], observations: [{ falsifier_id: "falsifier",
        status: "detected", detected: true }], complete: true, all_detected: true
    },
    traversal: {
      observations: [{ boundary_id: "boundary", observable_id: "observable",
        provider_support: "supported", status: "proven", proven: true }],
      complete: true, all_proven: true
    },
    prohibited_shortcuts: negative
      ? { observed: ["source_text_inspection"], violated: ["source_text_inspection"] }
      : { observed: [], violated: [] }
  };
  return {
    schema_version: "controlled-contract-test-proof-semantic-facts.v1",
    status: "facts",
    authority: "non_authoritative",
    obligation_id: obligationId,
    execution_identity: {
      run_id: "run-review-independent", attempt: 1,
      candidate: { identity: candidate, role: "reviewer" },
      source_snapshot_digest: DIGEST("6")
    },
    receipt_population: { count: 1, receipt_digests: [DIGEST("7")], digest: DIGEST("8") },
    facts,
    facts_digest: DIGEST("9")
  };
}

async function execute({
  resolved = population(),
  negative = false,
  candidateStatus = "passed",
  hooks = {}
} = {}) {
  const observedIdentities = [];
  const result = await executeVerifyProofForContext({
    args: { subject: resolved.subject.requested },
    resolutionContext: {},
    runtime: runtime(),
    deps: {
      resolveVerifyProofOperation: () => resolved,
      resolveBindings: async () => completeSelection(resolved),
      executeLauncherVerifyProofReceiptPopulation: async (input) => {
        hooks.execution?.(input);
        return {
          evidence_by_target: Object.fromEntries(input.targets.map((target) => [target,
            input.validationBindings[target].map((id) => {
              const selectedTestId = resolved.proofs.find(
                (proof) => proof.verification_id === id
              ).test_proof.runtime_test_identity.test_id;
              return {
                evidence_identity: { evidence_id: `evidence-${createHash("sha256")
                  .update(id).digest("hex")}`,
                  test_id: selectedTestId },
                execution_result: { status: candidateStatus,
                  exit_code: candidateStatus === "passed" ? 1 : 0,
                  structured_result: {
                    pass_events: candidateStatus === "passed" ? [{ test_id: selectedTestId,
                      file: target, name: "selected proof", nesting: 0,
                      status: "passed" }] : [],
                    fail_events: [{ test_id: TEST_ID("sibling"), file: target,
                      name: "unrelated sibling", nesting: 0, status: "failed" },
                    ...(candidateStatus === "failed" ? [{ test_id: selectedTestId,
                      file: target, name: "selected proof", nesting: 0,
                      status: "failed" }] : [])]
                  }
                }
              };
            })
          ]))
        };
      },
      evaluateSemantics: ({ resolution, expected }) => {
        observedIdentities.push(expected.test_id);
        return semanticFacts(resolution.obligation_id, "a".repeat(40), {
          negative,
          candidateStatus
        });
      },
      ...hooks.deps
    }
  });
  return { result, observedIdentities };
}

test("singleton and multi-proof selections use one deterministic aggregate schema", async () => {
  const singleton = (await execute()).result;
  const proofs = [
    resolvedProof("one", [relationship("OBL-ONE-A"), relationship("OBL-ONE-B")]),
    resolvedProof("two")
  ];
  const multi = (await execute({ resolved: population(proofs) })).result;
  assert.equal(singleton.schema_version, "workspace-verify-proof-aggregate.v1");
  assert.equal(multi.schema_version, singleton.schema_version);
  assert.deepEqual(Object.keys(multi).sort(), Object.keys(singleton).sort());
  assert.deepEqual(multi.counts, {
    proofs: 2, relationships: 3, satisfied: 2, unsatisfied: 0, not_executable: 0,
    ready: 2, nonready: 0, execution_not_started: 0
  });
  assert.equal(multi.subject_binding, "a".repeat(40));
  assert.equal(multi.downstream_authority.merge, false);
});

test("deduplicated proofs execute once and project every obligation relationship", async () => {
  const proofs = [resolvedProof("one", [
    relationship("OBL-ONE-A"), relationship("OBL-ONE-B")
  ])];
  let execution = null;
  const { result } = await execute({ resolved: population(proofs),
    hooks: { execution(input) { execution = input; } } });
  assert.deepEqual(execution.targets, ["tests/one.test.mjs"]);
  assert.deepEqual(execution.validationBindings,
    { "tests/one.test.mjs": ["claim-verification-one"] });
  assert.deepEqual(result.proof_results[0].relationship_results.map(
    ({ obligation_id: id }) => id), ["OBL-ONE-A", "OBL-ONE-B"]);
});

test("manifest path identity stays separate from the canonical generation digest", async () => {
  const resolved = population();
  const manifestGeneration = {
    id: MANIFEST_GENERATION_ID,
    path: `.carrier-generations/${MANIFEST_GENERATION_ID}`
  };
  assert.notEqual(`sha256:${manifestGeneration.id}`, resolved.contract_generation);
  let executed = 0;
  await execute({ resolved, hooks: {
    execution() { executed += 1; },
    deps: {
      resolveBindings: async () => completeSelection(resolved, {
        carrier_set_manifest_generation: manifestGeneration
      })
    }
  } });
  assert.equal(executed, 1);
});

test("WK-2462-shaped singleton authenticates canonical generation before execution", async () => {
  const proof = resolvedProof("wk-2462-01", [relationship("OBL-WK2462-01")]);
  proof.test_proof_id = "test-proof-wk-2462-01";
  proof.verification_id = "claim-wk-2462-verify-01";
  proof.test_proof.test_proof_id = proof.test_proof_id;
  proof.test_proof.verification_claim_id = proof.verification_id;
  proof.test_proof.runtime_test_identity.test_id = `test-${"2".repeat(64)}`;
  proof.declared_target.target =
    "tests/integration/agent-launch-stdio-mcp-conduit-real-clients.test.mjs";
  const resolved = population([proof], {
    subject: { requested: "OBL-WK2462-01", kind: "obligation",
      canonical_id: "OBL-WK2462-01" },
    wk_id: "WK-2462"
  });
  let execution = null;
  await execute({ resolved, hooks: {
    execution(input) { execution = input; },
    deps: {
      resolveBindings: async () => completeSelection(resolved, {
        carrier_set_manifest_generation: {
          id: MANIFEST_GENERATION_ID,
          path: `.carrier-generations/${MANIFEST_GENERATION_ID}`
        }
      })
    }
  } });
  assert.deepEqual(execution.targets, [proof.declared_target.target]);
  assert.deepEqual(execution.validationBindings,
    { [proof.declared_target.target]: [proof.verification_id] });
});

test("only declared stable identities supply evidence while full observations remain auditable",
  async () => {
    const proofs = [resolvedProof("one"), resolvedProof("two")];
    const { result, observedIdentities } = await execute({ resolved: population(proofs) });
    assert.deepEqual(observedIdentities, [TEST_ID("one"), TEST_ID("two")]);
    assert.equal(result.proof_results[0].observed_evidence.observed_count, 2);
    assert.deepEqual(result.proof_results[0].observed_evidence
      .observed_identity_candidates.map(({ test_id: id }) => id),
    [TEST_ID("one"), TEST_ID("sibling")]);
    const publicEvidence = JSON.stringify(result.proof_results[0].observed_evidence);
    for (const prohibited of ["pass_events", "fail_events", "stdout", "stderr",
      "provider", "command", "environment"]) {
      assert.equal(publicEvidence.includes(prohibited), false, prohibited);
    }
  });

test("one incomplete proof prevents binding resolution and every process execution", async () => {
  let bindings = 0;
  let executions = 0;
  const resolved = population([resolvedProof("one"), resolvedProof("two")], {
    status: "not_executable",
    reason_code: "verify_proof.population_not_ready.v1",
    diagnostics: [{ test_proof_id: "test-proof-two",
      reason_code: "verify_proof.runtime_test_selection_missing.v1" }]
  });
  const { result } = await execute({ resolved, hooks: { deps: {
    resolveBindings: async () => { bindings += 1; },
    executeLauncherVerifyProofReceiptPopulation: async () => { executions += 1; }
  } } });
  assert.equal(result.status, "not_executable");
  assert.equal(result.proof_results.length, 2);
  assert.equal(bindings, 0);
  assert.equal(executions, 0);
});

test("a nine-proof population over the public query ceiling enters atomic execution", async () => {
  const verificationIds = Array.from({ length: 9 }, (_, index) =>
    `claim-wk-2462-verify-${String(index + 1).padStart(2, "0")}`);
  await assert.rejects(() => queryControlledContractTestProofBindings({
    repoRoot: process.cwd(), wkId: "WK-2462", verificationIds
  }), ({ code }) => code === "stable_test_proof_query_too_large");
  const internal = await resolveControlledContractTestProofRuntimeBindings({
    repoRoot: process.cwd(), wkId: "WK-2462", verificationIds
  });
  assert.equal(internal.bindings.length, 9);
  assert.ok(Buffer.byteLength(JSON.stringify(internal), "utf8") > 16_384);
  const proofs = internal.bindings.map((binding, index) => {
    const proof = resolvedProof(`population-${String(index + 1).padStart(2, "0")}`);
    return { ...proof, test_proof_id: binding.test_proof_id,
      verification_id: binding.verification_claim_id, test_proof: binding };
  });
  const resolved = population(proofs, {
    subject: { requested: "WK-2462#SLICE-003", kind: "slice",
      canonical_id: "WK-2462#SLICE-003" },
    wk_id: "WK-2462",
    contract_generation: internal.controlled_contract_generation,
    contract_digest: internal.content_digest
  });
  let execution = null;
  const { result, observedIdentities } = await execute({
    resolved,
    hooks: {
      execution(input) { execution = input; },
      deps: { resolveBindings: async () => internal }
    }
  });
  assert.equal(Object.values(execution.validationBindings).flat().length, 9);
  assert.equal(observedIdentities.length, 9);
  assert.deepEqual(result.counts, {
    proofs: 9, relationships: 9, satisfied: 9, unsatisfied: 0,
    not_executable: 0, ready: 9, nonready: 0, execution_not_started: 0
  });
});

test("runtime binding invariants fail specifically with bounded expected and actual facts",
  async () => {
    const resolved = population([resolvedProof("one"), resolvedProof("two")]);
    const first = resolved.proofs[0].verification_id;
    const second = resolved.proofs[1].verification_id;
    const cases = [
      ["selection status", { status: "partial" },
        "verify_proof.runtime_binding_selection_status_incomplete.v1"],
      ["requested count", { requested_count: 1 },
        "verify_proof.runtime_binding_requested_count_mismatch.v1"],
      ["matched count", { matched_count: 1 },
        "verify_proof.runtime_binding_matched_count_mismatch.v1"],
      ["missing binding", { bindings: [resolved.proofs[0].test_proof] },
        "verify_proof.runtime_binding_count_mismatch.v1"],
      ["duplicate identity", { bindings: [resolved.proofs[0].test_proof,
        resolved.proofs[0].test_proof] },
      "verify_proof.runtime_binding_verification_identity_duplicate.v1"],
      ["unexpected identity", { bindings: [resolved.proofs[0].test_proof, {
        ...resolved.proofs[1].test_proof,
        verification_claim_id: "claim-verification-unexpected"
      }] }, "verify_proof.runtime_binding_verification_identity_unexpected.v1"],
      ["contract content", { content_digest: DIGEST("8") },
        "verify_proof.runtime_binding_contract_content_digest_mismatch.v1"],
      ["invalid generation", { controlled_contract_generation: "manifest-selector" },
        "verify_proof.runtime_binding_controlled_generation_invalid.v1"],
      ["generation movement", { controlled_contract_generation: DIGEST("9") },
        "verify_proof.runtime_binding_controlled_generation_moved.v1"]
    ];
    for (const [label, overrides, code] of cases) {
      let executions = 0;
      await assert.rejects(() => execute({ resolved, hooks: { deps: {
        resolveBindings: async () => completeSelection(resolved, overrides),
        executeLauncherVerifyProofReceiptPopulation: async () => { executions += 1; }
      } } }), (error) => {
        assert.equal(error.code, code, label);
        assert.equal(error.details.expected_selection_status, "complete");
        assert.equal(error.details.expected_requested_count, 2);
        assert.equal(error.details.expected_matched_count, 2);
        assert.equal(error.details.expected_binding_count, 2);
        assert.equal(error.details.expected_unique_verification_identity_count, 2);
        assert.deepEqual(error.details.expected_verification_ids, [first, second]);
        assert.equal(error.details.expected_contract_content_digest, resolved.contract_digest);
        assert.equal(error.details.expected_controlled_contract_generation_digest,
          resolved.contract_generation);
        assert.ok(JSON.stringify(error.details).length < 8192, label);
        return true;
      });
      assert.equal(executions, 0, label);
    }
  });

test("aggregate status is deterministic across satisfied and unsatisfied relationships", async () => {
  const positive = (await execute()).result;
  const negative = (await execute({ negative: true })).result;
  assert.equal(positive.status, "satisfied");
  assert.equal(negative.status, "unsatisfied");
  assert.notEqual(positive.result_digest, negative.result_digest);
});

test("a completed selected assertion failure is unsatisfied rather than not executable",
  async () => {
    const { result } = await execute({ candidateStatus: "failed" });
    assert.equal(result.status, "unsatisfied");
    assert.equal(result.counts.unsatisfied, 1);
    assert.equal(result.counts.not_executable, 0);
    assert.equal(result.proof_results[0].status, "unsatisfied");
    assert.equal(result.proof_results[0].relationship_results[0].status, "unsatisfied");
  });
