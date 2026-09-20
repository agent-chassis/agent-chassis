import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { TEST_PROOF_PROVIDER_CATALOG } from
  "../../packages/controlled-contract/lib/test-proof-provider-registry.mjs";

import { loadAdmittedProofPack } from
  "../../packages/controlled-contract/lib/admitted-proof-packs.mjs";
import { executeVerifyProofForContext } from
  "../../packages/wiki-mcp/src/lib/verify-proof-tool.mjs";
import {
  queryControlledContractTestProofBindings,
  resolveControlledContractTestProofRuntimeBindings
} from "../../packages/wiki-core/src/lib/controlled-contract-tools.mjs";
import { stableRuntimeTestIdFromParts } from
  "../../packages/agent-launch-cli/src/lib/workspace-agent-test-proof-node-reporter.mjs";
import { readCarrierSetFixture } from
  "../helpers/controlled-contract-carrier-set-fixtures.mjs";

const DIGEST = (character) => `sha256:${character.repeat(64)}`;
const SIBLING_ID = (value) => `test-${createHash("sha256").update(value).digest("hex")}`;
const MANIFEST_GENERATION_ID = "f".repeat(64);

const SELECTOR = (suffix) => ({ name: `selected proof ${suffix}`, nesting: 0 });
const TARGET = (suffix) => `tests/${suffix}.test.mjs`;
const DERIVED_ID = (binding, target) => stableRuntimeTestIdFromParts({
  file: target, name: binding.test_selector.name, nesting: binding.test_selector.nesting
});
const TEST_ID = (suffix) => DERIVED_ID({ test_selector: SELECTOR(suffix) }, TARGET(suffix));
const pack = await loadAdmittedProofPack("proof.verification.test-validity");

function relationship(id) {
  return {
    obligation_id: id,
    obligation: { obligation_id: id },
    behavior_claim_ids: ["claim-behavior"],
    relation_ids: [`relation-${id}`],
    selected_definition: {
      proof_name: pack.profile.profile_id, proof_version: pack.profile.profile_version,
      profile_digest: pack.profile_digest, admission_digest: pack.admission_digest,
      parameter_contract_digest: pack.parameter_contract_digest
    },
    resolved_node_identity: "b".repeat(64)
  };
}

function resolvedProof(suffix, relationships = [relationship(`OBL-${suffix}`)]) {
  return {
    execution_key: `execution-${suffix}`,
    test_proof_id: `test-proof-${suffix}`,
    verification_id: `claim-verification-${suffix}`,
    test_proof: {
      test_proof_id: `test-proof-${suffix}`,
      verification_claim_id: `claim-verification-${suffix}`,
      test_selector: SELECTOR(suffix)
    },
    declared_target: {
      target_id: `declared-target:WK-2458#SLICE-008:claim-verification-${suffix}`,
      operation: "node_test",
      target: TARGET(suffix),
      unit: "WK-2458#SLICE-008",
      controlled_contract_generation: DIGEST("1"),
      source_snapshot_digest: DIGEST("6")
    },
    relationships
  };
}

function population(proofs = [resolvedProof("one")], overrides = {}) {
  return {
    schema_version: "controlled-contract-verify-proof-population-resolution.v3",
    status: "executable",
    authority: "non_authoritative",
    subject: { requested: "WK-2458", kind: "wk", canonical_id: "WK-2458" },
    wk_id: "WK-2458",
    contract_generation: DIGEST("1"),
    contract_digest: DIGEST("2"),
    obligation_coverage_digest: DIGEST("3"),
    execution_source_binding: { binding_digest: DIGEST("4") },
    execution_pack: pack,
    proof_count: proofs.length,
    relationship_count: proofs.reduce((total, proof) => total + proof.relationships.length, 0),
    proofs,
    ...overrides
  };
}

function runtime(overrides = {}) {
  return {
    role: "reviewer",
    assertCurrentIdentity: async () => {},
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
      executed_test_ids: ["test"], skipped_test_ids: [], observed_test_count: 1
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

              const binding = resolved.proofs.find(
                (proof) => proof.verification_id === id
              ).test_proof;
              const selectedTestId = DERIVED_ID(binding, target);
              return {
                evidence_identity: { evidence_id: `evidence-${createHash("sha256")
                  .update(id).digest("hex")}`,
                  test_id: selectedTestId },
                capability_limitations: [],
                execution_result: { status: candidateStatus,
                  exit_code: candidateStatus === "passed" ? 1 : 0,
                  structured_result: {
                    pass_events: candidateStatus === "passed" ? [{ test_id: selectedTestId,
                      file: target, name: binding.test_selector.name,
                      nesting: binding.test_selector.nesting, status: "passed" }] : [],
                    fail_events: [{ test_id: SIBLING_ID("sibling"), file: target,
                      name: "unrelated sibling", nesting: 0, status: "failed" },
                    ...(candidateStatus === "failed" ? [{ test_id: selectedTestId,
                      file: target, name: binding.test_selector.name,
                      nesting: binding.test_selector.nesting, status: "failed" }] : [])]
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
  assert.equal(pack.profile.profile_version, "10.0.0");
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
  const instance = singleton.proof_results[0].relationship_results[0].proof_instance;
  assert.deepEqual(instance.selected_definition, relationship("OBL-one").selected_definition);
  assert.equal(instance.resolved_node_identity, relationship("OBL-one").resolved_node_identity);
  assert.equal(instance.execution_source_binding.binding_digest, population().execution_source_binding.binding_digest);
  assert.equal(Object.hasOwn(instance, "planning_pack"), false);
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

  proof.declared_target.target =
    "tests/integration/agent-launch-stdio-mcp-conduit-real-clients.test.mjs";
  const resolved = population([proof], {
    subject: { requested: "OBL-WK2462-01", kind: "obligation",
      canonical_id: "OBL-WK2462-01" },
    wk_id: "WK-2462"
  });
  let execution = null;
  const { result, observedIdentities } = await execute({ resolved, hooks: {
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
  const expected = DERIVED_ID(proof.test_proof, proof.declared_target.target);
  assert.notEqual(expected, TEST_ID("wk-2462-01"));
  assert.deepEqual(observedIdentities, [expected]);
  assert.deepEqual(result.proof_results[0].selected_test, {
    test_id: expected, file: proof.declared_target.target,
    name: proof.test_proof.test_selector.name,
    nesting: proof.test_proof.test_selector.nesting
  });
});

test("only declared stable identities supply evidence while full observations remain auditable",
  async () => {
    const proofs = [resolvedProof("one"), resolvedProof("two")];
    const { result, observedIdentities } = await execute({ resolved: population(proofs) });
    assert.deepEqual(observedIdentities, [TEST_ID("one"), TEST_ID("two")]);
    assert.deepEqual(result.proof_results[0].selected_test, {
      test_id: TEST_ID("one"), file: TARGET("one"),
      name: SELECTOR("one").name, nesting: SELECTOR("one").nesting
    });
    assert.equal(result.proof_results[0].observed_evidence.observed_count, 2);
    assert.deepEqual(result.proof_results[0].observed_evidence
      .observed_identity_candidates.map(({ test_id: id }) => id),
    [TEST_ID("one"), SIBLING_ID("sibling")]);
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
      reason_code: "verify_proof.test_selector_invalid.v1",
      details: {
        package_code: "stable_test_proof_selector_invalid",
        authority_limb: "mechanical_failure",
        admissibility_effect: "none",
        recovery_call: {
          tool: "workspace_controlled_contract_obligation_coverage_query",
          arguments: { unit: "WK-2458" }
        },
        complete_retrieval: {
          tool: "workspace_controlled_test_proof_query",
          arguments: { wk_id: "WK-2458",
            verification_ids: ["claim-verification-two"] }
        }
      } }]
  });
  const { result } = await execute({ resolved, hooks: { deps: {
    resolveBindings: async () => { bindings += 1; },
    executeLauncherVerifyProofReceiptPopulation: async () => { executions += 1; }
  } } });
  assert.equal(result.status, "not_executable");
  assert.equal(result.proof_results.length, 2);
  assert.equal(bindings, 0);
  assert.equal(executions, 0);
  const blocked = result.proof_results.find(({ test_proof_id: id }) => id === "test-proof-two");
  assert.equal(blocked.reason_code, "verify_proof.test_selector_invalid.v1");
  assert.equal(blocked.recovery.action, "author_a_valid_declarative_test_selector_then_retry");
  assert.deepEqual(blocked.recovery.repair, {
    semantic_owner: "saved_obligation_proof",
    capability_status: "semantic_correction_requires_saved_obligation_identity",
    verification_id: "claim-verification-two",
    required_meaning: blocked.recovery.repair.required_meaning,
    correction_route: null,
    next_step: "Read the saved obligation that owns this verification identity, then amend its semantic proof inputs through workspace_controlled_contract_obligation_coverage_upsert.",
    execution_evidence: "owned_by_workspace_verify_proof"
  });
  assert.deepEqual(Object.keys(blocked.recovery.repair.required_meaning).sort(),
    ["runtime_test.falsifier.select", "runtime_test.selector"]);
  assert.equal(Object.hasOwn(result, "readiness_source"), false);
  assert.equal(Object.hasOwn(result, "recovery_binding"), false);
});

async function nineProofCarrierRoot(t) {
  const { wkId, members, record } = await readCarrierSetFixture("WK-2462");
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "verify-proof-nine-"));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const contracts = path.join(repoRoot, "wiki/contracts");
  await mkdir(contracts, { recursive: true });
  await mkdir(path.join(repoRoot, "wiki/work-records"), { recursive: true });
  await writeFile(path.join(repoRoot, "wiki/work-records", `${wkId}.json`),
    `${JSON.stringify(record, null, 2)}\n`);
  const contract = structuredClone(members.get(`${wkId}.controlled-acceptance.json`));

  const current = (provider) => {
    const descriptor = TEST_PROOF_PROVIDER_CATALOG.providers.find(
      ({ provider_id: id }) => id === provider.provider_id);
    assert.ok(descriptor?.capabilities.includes(provider.capability), provider.provider_id);
    return { ...provider, provider_version: descriptor.provider_version };
  };
  contract.test_proofs = contract.test_proofs.map((proof) => ({
    ...proof,
    candidate_execution_provider: current(proof.candidate_execution_provider),
    falsifiers: proof.falsifiers.map((falsifier) => ({ ...falsifier,
      execution_provider: current(falsifier.execution_provider) })),
    traversal_provider: proof.traversal_provider.mode === "provider"
      ? current(proof.traversal_provider) : proof.traversal_provider,
    test_selector: {
      name: `${proof.test_proof_id} ${"selected assertion ".repeat(24)}`.trim(),
      nesting: 0
    }
  }));

  await writeFile(path.join(contracts, `${wkId}.controlled-acceptance.json`),
    `${JSON.stringify(contract, null, 2)}\n`);
  return repoRoot;
}

test("a nine-proof population over the public query ceiling enters atomic execution", async (t) => {
  const nineProofRoot = await nineProofCarrierRoot(t);
  const verificationIds = Array.from({ length: 9 }, (_, index) =>
    `claim-wk-2462-verify-${String(index + 1).padStart(2, "0")}`);
  await assert.rejects(() => queryControlledContractTestProofBindings({
    repoRoot: nineProofRoot, wkId: "WK-2462", verificationIds
  }), ({ code }) => code === "stable_test_proof_query_too_large");
  const internal = await resolveControlledContractTestProofRuntimeBindings({
    repoRoot: nineProofRoot, wkId: "WK-2462", verificationIds
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
  const executions = [];
  const { result, observedIdentities } = await execute({
    resolved,
    hooks: {
      execution(input) { executions.push(input); },
      deps: { resolveBindings: async () => internal }
    }
  });
  assert.equal(executions.length, 9);
  assert.equal(executions.flatMap(input => Object.values(input.validationBindings).flat()).length, 9);
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
