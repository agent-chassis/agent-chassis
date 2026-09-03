import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  PROFILE_ID_V1,
  SCHEMA_VERSION_V1,
  TEST_PROOF_VERSION_V1,
  VOCABULARY_VERSION_V1,
  NATIVE_CONTRACT_SCHEMA_V1,
  buildNativeContractSchemaV1,
  validateAndResolveNativeContractV1
} from "../../lib/native-contract-carrier-v1.mjs";
import { migrateControlledAcceptanceContractV02ToV03 } from
  "../../lib/test-proof-contract.mjs";
import { CONTROLLED_VOCABULARY, validateVocabulary } from
  "../../lib/vocabulary-v1.mjs";

const source = JSON.parse(await readFile(new URL(
  "../../examples/minimal-controlled-acceptance-contract-v034.json", import.meta.url
)));

function proof() {
  return {
    test_proof_id: "test-proof-suite-covers-component",
    verification_claim_id: "claim-suite-covers-component",
    system_under_test_boundary: {
      boundary_id: "sut-boundary-example-component", kind: "module",
      runtime_module_path: "packages/controlled-contract/lib/native-contract-carrier-v1.mjs",
      subject_reference_ids: ["ref-component"]
    },
    observable_result: {
      observable_id: "observable-suite-result", kind: "return_value",
      proposition_id: "prop-suite-covers-component"
    },
    candidate_execution_provider: {
      provider_id: "launcher.node-test", provider_version: "1.0.0",
      capability: "candidate_execution"
    },
    falsifiers: [{
      falsifier_id: "falsifier-component-absent", strategy: "dependency_failure",
      proposition_id: "prop-component-absent", expected_outcome: "verification_fails",
      mutation: {
        mutation_id: "mutation-component-dependency", mechanism: "module_substitution",
        target_kind: "module",
        module_path: "packages/controlled-contract/lib/native-contract-carrier-v1.mjs"
      },
      execution_provider: {
        provider_id: "launcher.node-test-module-fault", provider_version: "1.0.0",
        capability: "falsifier_execution"
      }
    }],
    traversal_provider: {
      mode: "provider", provider_id: "launcher.node-test-v8-coverage",
      provider_version: "1.0.0", capability: "boundary_traversal",
      boundary_kind: "module", observation_mechanism: "node_test_v8_coverage",
      observation_seam: "node_test_structured_assertion",
      evidence_artifact_type: "boundary_trace"
    },
    coverage_disposition: {
      baseline_id: "coverage-baseline-example-suite",
      baseline_state: "complete_executed_inventory",
      items: [{ test_id: "test-component-exists", disposition: "preserved" }]
    },
    prohibited_shortcuts: ["coverage_percentage_only", "source_text_inspection"]
  };
}

function stableContract() {
  const migrated = migrateControlledAcceptanceContractV02ToV03({
    contract: structuredClone(source), testProofs: [proof()]
  });
  return {
    ...migrated,
    schema_version: SCHEMA_VERSION_V1,
    vocabulary_version: VOCABULARY_VERSION_V1,
    profile_id: PROFILE_ID_V1
  };
}

test("stable carrier schema is a standalone stable-v1 identity", async () => {
  assert.equal(NATIVE_CONTRACT_SCHEMA_V1.title, SCHEMA_VERSION_V1);
  assert.equal(NATIVE_CONTRACT_SCHEMA_V1.properties.test_proof_version.const,
    TEST_PROOF_VERSION_V1);
  assert.deepEqual(buildNativeContractSchemaV1(), NATIVE_CONTRACT_SCHEMA_V1);
  const tracked = JSON.parse(await readFile(new URL(
    "../../schema/controlled-acceptance-contract.v1.schema.json", import.meta.url
  )));
  assert.deepEqual(tracked, NATIVE_CONTRACT_SCHEMA_V1);
  assert.equal(JSON.stringify(tracked).includes(
    "controlled-acceptance-contract.experimental.v0.2.schema.json#"), false);
});

test("stable vocabulary is independently valid and no v0.4 family exists", () => {
  const result = validateVocabulary(CONTROLLED_VOCABULARY);
  assert.equal(result.vocabulary_version, VOCABULARY_VERSION_V1);
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  assert.equal(JSON.stringify({ vocabulary: CONTROLLED_VOCABULARY,
    schema: NATIVE_CONTRACT_SCHEMA_V1 }).includes("experimental.v0.4"), false);
});

test("stable carrier requires one provider-bound proof per test execution", () => {
  const contract = stableContract();
  const accepted = validateAndResolveNativeContractV1(contract);
  assert.equal(accepted.valid, true, JSON.stringify(accepted));
  contract.test_proofs = [];
  const missing = validateAndResolveNativeContractV1(contract);
  assert.equal(missing.valid, false);
  assert.equal(missing.diagnostics[0].code, "stable_test_proof_missing");
});

test("stable carrier rejects a forbidden-operation contradiction through native semantics", () => {
  const contract = stableContract();
  contract.propositions.push(
    {
      proposition_id: "prop-forbidden-use",
      subject_reference_id: "ref-component",
      operator: "reference:uses",
      applicability_context: { mode: "unconditional", operand_reference_ids: [] },
      operands: [{ kind: "reference", reference_id: "ref-suite" }]
    },
    {
      proposition_id: "prop-observed-use",
      subject_reference_id: "ref-component",
      operator: "reference:uses",
      applicability_context: { mode: "unconditional", operand_reference_ids: [] },
      operands: [{ kind: "reference", reference_id: "ref-suite" }]
    }
  );
  contract.claims.push(
    {
      claim_id: "claim-forbidden-use",
      kind: "behavior",
      modality: "MUST_NOT",
      proposition_id: "prop-forbidden-use"
    },
    {
      claim_id: "claim-observed-use",
      kind: "evidence",
      modality: "MUST",
      proposition_id: "prop-observed-use"
    }
  );
  const result = validateAndResolveNativeContractV1(contract);
  assert.equal(result.schema_valid, true);
  assert.equal(result.valid, false);
  assert.ok(result.diagnostics.some(({ code, reason }) =>
    code === "direct_proposition_contradiction" && reason === "opposed_modality"
  ));
});

test("stable test-proof population rejects duplicate and unknown bindings", () => {
  const duplicate = stableContract();
  duplicate.test_proofs.push(structuredClone(duplicate.test_proofs[0]));
  assert.deepEqual(new Set(validateAndResolveNativeContractV1(duplicate).diagnostics.map(
    ({ code }) => code
  )), new Set([
    "stable_test_proof_claim_duplicate",
    "stable_test_proof_identity_duplicate",
    "stable_test_proof_population_noncanonical"
  ]));

  const unknown = stableContract();
  unknown.test_proofs[0].verification_claim_id = "claim-unknown-test";
  const unknownCodes = new Set(validateAndResolveNativeContractV1(unknown).diagnostics.map(
    ({ code }) => code
  ));
  assert.ok(unknownCodes.has("stable_test_proof_missing"));
  assert.ok(unknownCodes.has("stable_test_proof_claim_unknown"));
});

test("stable schema refuses experimental, mixed, partial, and stale identities", () => {
  for (const mutation of [
    (value) => { value.schema_version = "controlled-acceptance-contract.experimental.v0.2"; },
    (value) => { value.profile_id = "acceptance-contract.standard.experimental.v0.3"; },
    (value) => { value.vocabulary_version = "cv.experimental.0.34"; },
    (value) => { delete value.test_proof_version; },
    (value) => { value.schema_version = "controlled-acceptance-contract.unknown"; }
  ]) {
    const candidate = stableContract();
    mutation(candidate);
    assert.equal(validateAndResolveNativeContractV1(candidate).schema_valid, false);
  }
});
