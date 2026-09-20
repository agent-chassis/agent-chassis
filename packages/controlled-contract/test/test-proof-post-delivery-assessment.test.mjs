import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";

import RESULT_SCHEMA from
  "../schema/controlled-contract-proof-verification-result.v3.schema.json" with { type: "json" };
import { loadExactAdmittedProofPack } from "../lib/admitted-proof-packs.mjs";
import { profileDigest } from "../lib/profile-digest.mjs";
import {
  buildNotExecutableProofVerificationResult,
  buildProofVerificationResult
} from "../lib/proof-obligation-runtime-resolver.mjs";

const DIGEST = (character) => `sha256:${character.repeat(64)}`;
const executionPack = await loadExactAdmittedProofPack({
  profileId: "proof.verification.test-validity",
  profileVersion: "10.0.0",

});
const SELECTED_TEST_ID = "test-component";
const validateResult = new Ajv2020({ strict: true, allErrors: true })
  .compile(RESULT_SCHEMA);

import { canonicalDigest } from "./support/proof-pack-adequacy.mjs";

import { facts, mutate } from "./support/test-validity-execution-controls.mjs";

function resolution(pack = executionPack) {
  return {
    status: "executable",
    obligation_id: "AC-001",
    contract_generation: DIGEST("1"),
    contract_digest: DIGEST("2"),
    obligation_coverage_digest: DIGEST("3"),
    execution_source_binding: { schema_version: "verify-proof-execution-source-binding.v1", binding_digest: DIGEST("4") },
    resolved_node_identity: "5".repeat(64),
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
    selected_definition: {
      proof_name: pack.profile.profile_id, proof_version: pack.profile.profile_version,
      profile_digest: pack.profile_digest, admission_digest: pack.admission_digest,
      parameter_contract_digest: pack.parameter_contract_digest
    },
    execution_pack: pack
  };
}

test("the exact evaluator alone distinguishes satisfied from valid-negative unsatisfied", () => {
  assert.deepEqual({
    profile_id: executionPack.profile.profile_id,
    profile_version: executionPack.profile.profile_version,
    implementation_id: executionPack.test_validity_evaluator.implementation_id,
    implementation_version: executionPack.test_validity_evaluator.implementation_version
  }, {
    profile_id: "proof.verification.test-validity",
    profile_version: "10.0.0",
    implementation_id: "proof.verification.test-validity.execution-evaluator",
    implementation_version: "8.0.0"
  });
  const positiveFacts = facts();
  const satisfied = executionPack.test_validity_evaluator.evaluate({
    semantic_facts: positiveFacts
  });
  assert.equal(satisfied.satisfaction, "satisfied");

  const negativeFacts = facts({
    prohibited_shortcuts: {
      observed: ["source_text_inspection"],
      violated: ["source_text_inspection"]
    }
  });
  const unsatisfied = executionPack.test_validity_evaluator.evaluate({
    semantic_facts: negativeFacts
  });
  assert.equal(unsatisfied.satisfaction, "unsatisfied");
  assert.equal(unsatisfied.diagnostics[0].code,
    "test_validity_execution_prohibited_shortcut");
});

test("10.0.0 profile judges only the one declaratively selected test", () => {
  const evaluate = (inventory) => executionPack.test_validity_evaluator.evaluate({
    semantic_facts: facts({ inventory: { ...facts().facts.inventory, ...inventory } })
  });
  assert.equal(evaluate({}).satisfaction, "satisfied");
  for (const [label, inventory, code] of [
    ["not discovered", { discovered_test_ids: [] },
      "test_validity_execution_selected_test_not_discovered"],
    ["not executed", { executed_test_ids: [] },
      "test_validity_execution_selected_test_not_executed"],
    ["skipped", { skipped_test_ids: [SELECTED_TEST_ID] },
      "test_validity_execution_selected_test_skipped"]
  ]) {
    const evaluation = evaluate(inventory);
    assert.equal(evaluation.satisfaction, "unsatisfied", label);
    assert.equal(evaluation.diagnostics.some((entry) => entry.code === code), true, label);
  }

  const siblings = evaluate({ observed_test_count: 7 });
  assert.equal(siblings.satisfaction, "satisfied");
  assert.deepEqual(siblings.diagnostics, []);
});

test("10.0.0 certification authenticates and executes its complete negative corpus", async () => {
  const root = new URL(
    "./certification/profiles/proof.verification.test-validity/10.0.0/",
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
  assert.equal(canonicalDigest(corpus), result.corpus_digest);
  assert.equal(canonicalDigest(result), admission.certification.adequacy_result_digest);
  assert.equal(canonicalDigest(adequacy),
    admission.certification.adequacy_declaration_digest);
  assert.equal(corpus.single_axis_weakenings.length, 9);
  assert.equal(admission.certification.executable_control_count, 10);
  assert.equal(admission.certification.negative_fixture_count, 9);
  assert.equal(admission.certification.coverage_witness_count, 9);
  assert.deepEqual(adequacy.certification_population,
    { positive_case_count: 1, single_axis_weakening_count: 9 });

  assert.deepEqual(Object.keys(mutate).sort(),
    corpus.single_axis_weakenings.map(({ case_id: id }) => id).sort());
  for (const caseId of corpus.positive_cases) {
    assert.equal(executionPack.test_validity_evaluator.evaluate({
      semantic_facts: facts()
    }).satisfaction, "satisfied", caseId);
  }
  const passed = [];
  for (const control of corpus.single_axis_weakenings) {
    const semanticFacts = facts();
    mutate[control.case_id](semanticFacts.facts);
    const evaluation = executionPack.test_validity_evaluator.evaluate({
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
  const evaluation = executionPack.test_validity_evaluator.evaluate({
    semantic_facts: semanticFacts
  });
  const result = buildProofVerificationResult({
    resolution: resolution(), semanticFacts, evaluation
  });
  assert.equal(result.status, "satisfied");
  assert.equal(result.proof_instance.profile.profile_version, "10.0.0");
  assert.equal(result.proof_instance.evaluator.implementation_id,
    "proof.verification.test-validity.execution-evaluator");
  assert.equal(result.proof_instance.evaluator.implementation_version, "8.0.0");
  assert.equal(result.proof_instance.evaluator.implementation_digest,
    "sha256:8aff870dc00038e340e6e9bf889eb2c8f74b2f8b1fd70024fd54994b90cee90f");

  assert.deepEqual(result.proof_instance.selected_definition, resolution().selected_definition);
  assert.equal(validateResult(result), true, JSON.stringify(validateResult.errors));
  const unbound = resolution();
  delete unbound.selected_definition;
  assert.throws(() => buildProofVerificationResult({
    resolution: unbound, semanticFacts, evaluation
  }), (error) => error.code === "verify_proof.result_input_invalid.v1");
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
  const evaluation = executionPack.test_validity_evaluator.evaluate({
    semantic_facts: semanticFacts
  });
  for (const [label, mutate] of mutations) {
    const pack = JSON.parse(JSON.stringify(executionPack));
    mutate(pack);
    assert.throws(() => buildProofVerificationResult({
      resolution: resolution(pack), semanticFacts, evaluation
    }), (error) => error.code === "proof_pack_snapshot_unrecognized", label);
  }
});
