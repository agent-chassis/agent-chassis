import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { migrateControlledAcceptanceContractV02ToV1 } from
  "../../packages/controlled-contract/lib/stable-v1-migration.mjs";
import { validateWorkRecordTestProofBindings } from
  "../../packages/wiki-core/src/lib/work-record-test-proof-bindings.mjs";

const v02 = JSON.parse(await readFile(new URL(
  "../../packages/controlled-contract/examples/minimal-controlled-acceptance-contract-v034.json",
  import.meta.url
)));

function proof() {
  return {
    test_proof_id: "test-proof-component",
    verification_claim_id: "claim-suite-covers-component",
    system_under_test_boundary: {boundary_id: "sut-boundary-component", kind: "module",
      runtime_module_path: "packages/controlled-contract/lib/test-proof-contract.mjs",
      subject_reference_ids: ["ref-component"]},
    observable_result: {observable_id: "observable-component", kind: "return_value",
      proposition_id: "prop-suite-covers-component"},
    candidate_execution_provider: {provider_id: "launcher.node-test",
      provider_version: "1.0.0", capability: "candidate_execution"},
    falsifiers: [{falsifier_id: "falsifier-component", strategy: "dependency_failure",
      proposition_id: "prop-component-absent", expected_outcome: "verification_fails",
      mutation: {mutation_id: "mutation-component", mechanism: "module_substitution",
        target_kind: "module", module_path: "packages/controlled-contract/lib/test-proof-contract.mjs"},
      execution_provider: {provider_id: "launcher.node-test-module-fault", provider_version: "1.0.0",
        capability: "falsifier_execution"}}],
    traversal_provider: {mode: "provider", provider_id: "launcher.node-test-v8-coverage",
      provider_version: "1.0.0", capability: "boundary_traversal", boundary_kind: "module",
      observation_mechanism: "node_test_v8_coverage",
      observation_seam: "node_test_structured_assertion", evidence_artifact_type: "boundary_trace"},
    coverage_disposition: {baseline_id: "coverage-baseline-component",
      baseline_state: "complete_executed_inventory",
      items: [{test_id: "test-component", disposition: "preserved"}]},
    prohibited_shortcuts: ["source_text_inspection"]
  };
}

const v03 = () => migrateControlledAcceptanceContractV02ToV1({
  contract: structuredClone(v02), testProofs: [proof()]
});
const record = {id: "WK-9000"};
const unit = (validation) => ({acceptance: {validation}});
const structured = (ids = ["claim-suite-covers-component"],
  target = "tests/example.test.mjs") =>
  ({ operation: "node_test", target, verification_ids: ids });

async function codes(validation, contract = v03()) {
  return (await validateWorkRecordTestProofBindings({
    workRecord: record, selectedUnit: unit(validation), controlledContract: contract
  })).diagnostics.map(({code}) => code);
}

test("admits exact structured operation and package-validated test-proof binding", async () => {
  const result = await validateWorkRecordTestProofBindings({
    workRecord: record, selectedUnit: unit([structured()]), controlledContract: v03()
  });
  assert.equal(result.status, "admitted");
  assert.deepEqual(result.validation_bindings, [{
    verification_id: "claim-suite-covers-component", operation: "node_test",
    target: "tests/example.test.mjs"
  }]);
  assert.equal(result.semantic_judgment, "not_performed_coordinator_owned");
});

test("discriminates absent, duplicate, stale, cross-WK, and non-test IDs", async () => {
  assert.ok((await codes([structured([])]))
    .includes("test_proof_validation_binding_missing"));
  assert.ok((await codes([structured([
    "claim-suite-covers-component", "claim-suite-covers-component"
  ])])).includes("validation_verification_id_duplicate"));
  assert.ok((await codes([structured(["claim-stale"])]))
    .includes("test_proof_verification_id_stale"));
  assert.ok((await codes([structured(["WK-9999#claim-suite-covers-component"])]))
    .includes("test_proof_verification_cross_wk"));
  assert.ok((await codes([structured(["claim-component-exists"])]))
    .includes("test_proof_verification_not_test_execution"));
});

test("discriminates invalid declarations, proof binding, and inert notes", async () => {
  assert.ok((await codes([{ operation: "node_test", target: "", verification_ids: [] }]))
    .includes("validation_target_invalid"));
  const missingProof = structuredClone(v03());
  missingProof.test_proofs = [];
  assert.ok((await codes([structured()], missingProof))
    .includes("test_proof_contract_invalid"));
  assert.ok((await codes(["node --test tests/example.test.mjs"]))
    .includes("test_proof_validation_binding_missing"));
  assert.ok((await codes([{
    command: "node --test tests/example.test.mjs",
    verification_ids: ["claim-suite-covers-component"]
  }])).includes("validation_note_fields_invalid"));
});

test("refuses unchanged v0.2 carriers before stable processing", async () => {
  const result = await validateWorkRecordTestProofBindings({
    workRecord: record,
    selectedUnit: unit(["node --test legacy.mjs"]),
    controlledContract: structuredClone(v02)
  });
  assert.equal(result.status, "refused");
  assert.deepEqual(result.diagnostics.map(({code}) => code), [
    "test_proof_contract_version_unsupported"
  ]);
});
