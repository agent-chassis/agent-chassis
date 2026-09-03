import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";

import RESULT_SCHEMA from
  "../schema/controlled-contract-proof-verification-result.v1.schema.json" with { type: "json" };
import { loadExactAdmittedProofPack } from "../lib/admitted-proof-packs.mjs";
import { profileDigest } from "../lib/profile-digest.mjs";
import {
  buildNotExecutableProofVerificationResult,
  buildProofVerificationResult
} from "../lib/proof-obligation-runtime-resolver.mjs";

const DIGEST = (character) => `sha256:${character.repeat(64)}`;
const postDeliveryPack = await loadExactAdmittedProofPack({
  profileId: "proof.verification.test-validity",
  profileVersion: "3.0.0",
  evaluationStage: "post_delivery"
});
const correctedPostDeliveryPack = await loadExactAdmittedProofPack({
  profileId: "proof.verification.test-validity",
  profileVersion: "4.0.0",
  evaluationStage: "post_delivery"
});
const validateResult = new Ajv2020({ strict: true, allErrors: true })
  .compile(RESULT_SCHEMA);

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])])
  );
  return value;
}

function canonicalDigest(value) {
  return createHash("sha256").update(
    `${JSON.stringify(canonicalValue(value), null, 2)}\n`
  ).digest("hex");
}

function facts(overrides = {}) {
  const value = {
    candidate: { status: "passed", passed: true },
    inventory: {
      declared_test_ids: ["test-component"],
      discovered_test_ids: ["test-component"],
      executed_test_ids: ["test-component"],
      skipped_test_ids: [],
      newly_skipped_test_ids: [],
      unexpected_test_ids: []
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

function resolution(pack = postDeliveryPack) {
  return {
    status: "executable",
    obligation_id: "AC-001",
    contract_generation: DIGEST("1"),
    contract_digest: DIGEST("2"),
    obligation_coverage_digest: DIGEST("3"),
    proof_plan_digest: DIGEST("4"),
    proof_plan_entry_digest: DIGEST("5"),
    proof_plan_entry: { exact_binding: null },
    behavior_claim_ids: ["claim-component-exists"],
    verification_id: "claim-suite-covers-component",
    relation_ids: ["rel-suite-verifies-component"],
    declared_target: {
      target_id: "declared-target:WK-2458#SLICE-008:claim-suite-covers-component:test",
      operation: "node_test",
      target: "test/example.test.mjs",
      unit: "WK-2458#SLICE-008",
      controlled_contract_generation: DIGEST("1"),
      source_snapshot_digest: DIGEST("6")
    },
    test_proof: { test_proof_id: "test-proof-component" },
    post_delivery_pack: pack
  };
}

test("the exact evaluator alone distinguishes satisfied from valid-negative unsatisfied", () => {
  const positiveFacts = facts();
  const satisfied = postDeliveryPack.test_validity_evaluator.evaluate({
    semantic_facts: positiveFacts
  });
  assert.equal(satisfied.satisfaction, "satisfied");

  const negativeFacts = facts({
    prohibited_shortcuts: {
      observed: ["source_text_inspection"],
      violated: ["source_text_inspection"]
    }
  });
  const unsatisfied = postDeliveryPack.test_validity_evaluator.evaluate({
    semantic_facts: negativeFacts
  });
  assert.equal(unsatisfied.satisfaction, "unsatisfied");
  assert.equal(unsatisfied.diagnostics[0].code,
    "test_validity_post_delivery_prohibited_shortcut");
});

test("4.0.0 requires exact declared, discovered, and executed inventories", () => {
  assert.equal(correctedPostDeliveryPack.test_validity_evaluator.evaluate({
    semantic_facts: facts()
  }).satisfaction, "satisfied");
  for (const [field, code] of [
    ["declared_test_ids", "test_validity_post_delivery_declared_discovered_inventory_mismatch"],
    ["discovered_test_ids", "test_validity_post_delivery_declared_discovered_inventory_mismatch"],
    ["executed_test_ids", "test_validity_post_delivery_declared_executed_inventory_mismatch"]
  ]) {
    const inventory = structuredClone(facts().facts.inventory);
    inventory[field] = [];
    const evaluation = correctedPostDeliveryPack.test_validity_evaluator.evaluate({
      semantic_facts: facts({ inventory })
    });
    assert.equal(evaluation.satisfaction, "unsatisfied", field);
    assert.equal(evaluation.diagnostics.some((entry) => entry.code === code), true, field);
  }
});

test("4.0.0 certification authenticates and executes its complete negative corpus", async () => {
  const root = new URL(
    "./certification/profiles/proof.verification.test-validity/4.0.0/",
    import.meta.url
  );
  const readJson = async (name) => JSON.parse(await readFile(new URL(name, root), "utf8"));
  const [profile, admission, corpus, adequacy, result] = await Promise.all([
    readJson("profile.json"), readJson("admission.json"), readJson("corpus.json"),
    readJson("adequacy.json"), readJson("result.json")
  ]);
  assert.equal(profileDigest(profile), admission.profile_digest);
  assert.equal(createHash("sha256").update(admission.guarantee).digest("hex"),
    admission.guarantee_digest);
  assert.equal(canonicalDigest(corpus), adequacy.corpus_digest);
  assert.equal(canonicalDigest(result), adequacy.result_digest);
  assert.equal(canonicalDigest(adequacy),
    admission.certification.adequacy_declaration_digest);
  assert.equal(corpus.single_axis_weakenings.length, 7);
  assert.equal(admission.certification.executable_control_count, 8);

  const mutate = {
    "failed-candidate": (value) => {
      value.candidate = { status: "failed", passed: false };
    },
    "missing-declared-test": (value) => { value.inventory.declared_test_ids = []; },
    "missing-discovered-test": (value) => { value.inventory.discovered_test_ids = []; },
    "missing-executed-test": (value) => { value.inventory.executed_test_ids = []; },
    "inert-falsifier": (value) => { value.falsifiers.all_detected = false; },
    "unproven-traversal": (value) => { value.traversal.all_proven = false; },
    "prohibited-shortcut": (value) => {
      value.prohibited_shortcuts = {
        observed: ["source_text_inspection"], violated: ["source_text_inspection"]
      };
    }
  };
  const passed = [];
  for (const control of corpus.single_axis_weakenings) {
    const semanticFacts = facts();
    mutate[control.case_id](semanticFacts.facts);
    const evaluation = correctedPostDeliveryPack.test_validity_evaluator.evaluate({
      semantic_facts: semanticFacts
    });
    assert.equal(evaluation.satisfaction, "unsatisfied", control.case_id);
    assert.equal(evaluation.diagnostics.some(({ code }) => code === control.expected_code),
      true, control.case_id);
    passed.push(control.case_id);
  }
  assert.deepEqual(passed, result.passed_single_axis_weakenings);
});

test("complete deterministic results bind every proof-instance identity", () => {
  const semanticFacts = facts();
  const evaluation = postDeliveryPack.test_validity_evaluator.evaluate({
    semantic_facts: semanticFacts
  });
  const result = buildProofVerificationResult({
    resolution: resolution(), semanticFacts, evaluation
  });
  assert.equal(result.status, "satisfied");
  assert.equal(result.proof_instance.profile.profile_version, "3.0.0");
  assert.equal(result.proof_instance.evaluator.implementation_digest,
    "sha256:c7920b44a165d830e8853c3e37be7a4ad7d76db64102d1e431e51c630403d606");
  assert.equal(result.proof_instance.evaluation_stage, "post_delivery");
  assert.equal(validateResult(result), true, JSON.stringify(validateResult.errors));
  assert.deepEqual(buildProofVerificationResult({
    resolution: resolution(), semanticFacts, evaluation
  }), result);
});

test("unavailable evidence uses the separate not-executable result partition", () => {
  const result = buildNotExecutableProofVerificationResult({
    obligationId: "AC-001",
    reasonCode: "verify_proof.complete_receipts_unavailable.v1"
  });
  assert.equal(result.status, "not_executable");
  assert.equal(result.proof_instance, null);
  assert.equal(validateResult(result), true, JSON.stringify(validateResult.errors));
});

test("caller-copied or mutated pack identities cannot produce a result", () => {
  const mutations = [
    ["admission identity", (pack) => { pack.admission.profile_version = "9.9.9"; }],
    ["admission digest", (pack) => { pack.admission_digest = "0".repeat(64); }],
    ["guarantee digest", (pack) => { pack.admission.guarantee_digest = "0".repeat(64); }],
    ["profile digest", (pack) => { pack.profile_digest = "0".repeat(64); }]
  ];
  const semanticFacts = facts();
  const evaluation = postDeliveryPack.test_validity_evaluator.evaluate({
    semantic_facts: semanticFacts
  });
  for (const [label, mutate] of mutations) {
    const pack = JSON.parse(JSON.stringify(postDeliveryPack));
    mutate(pack);
    assert.throws(() => buildProofVerificationResult({
      resolution: resolution(pack), semanticFacts, evaluation
    }), (error) => error.code === "proof_pack_snapshot_unrecognized", label);
  }
});

test("conditional exact-capture identities fail closed when incomplete", () => {
  const value = resolution();
  value.proof_plan_entry.exact_binding = { capture_root_digest: DIGEST("a") };
  const semanticFacts = facts();
  const evaluation = postDeliveryPack.test_validity_evaluator.evaluate({
    semantic_facts: semanticFacts
  });
  assert.throws(() => buildProofVerificationResult({
    resolution: value, semanticFacts, evaluation
  }), (error) => error.code === "verify_proof.exact_capture_binding_incomplete.v1");
});
