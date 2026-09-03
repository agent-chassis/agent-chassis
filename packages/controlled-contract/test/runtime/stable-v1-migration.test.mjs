import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { migrateControlledAcceptanceContractV02ToV03 } from
  "../../lib/test-proof-contract.mjs";
import {
  StableMigrationError,
  migrateControlledAcceptanceContractV02ToV1,
  migrateControlledAcceptanceContractV03ToV1
} from "../../lib/stable-v1-migration.mjs";

const v02 = JSON.parse(await readFile(new URL(
  "../../examples/minimal-controlled-acceptance-contract-v034.json", import.meta.url
)));

function proof(overrides = {}) {
  return {
    test_proof_id: "test-proof-suite-covers-component",
    verification_claim_id: "claim-suite-covers-component",
    system_under_test_boundary: { boundary_id: "sut-boundary-example-component",
      kind: "module",
      runtime_module_path: "packages/controlled-contract/lib/stable-v1-migration.mjs",
      subject_reference_ids: ["ref-component"] },
    observable_result: { observable_id: "observable-suite-result", kind: "return_value",
      proposition_id: "prop-suite-covers-component" },
    candidate_execution_provider: { provider_id: "launcher.node-test",
      provider_version: "1.0.0", capability: "candidate_execution" },
    falsifiers: [{ falsifier_id: "falsifier-component-absent",
      strategy: "dependency_failure", proposition_id: "prop-component-absent",
      expected_outcome: "verification_fails",
      mutation: { mutation_id: "mutation-component-dependency",
        mechanism: "module_substitution", target_kind: "module",
        module_path: "packages/controlled-contract/lib/stable-v1-migration.mjs" },
      execution_provider: { provider_id: "launcher.node-test-module-fault",
        provider_version: "1.0.0", capability: "falsifier_execution" } }],
    traversal_provider: { mode: "provider",
      provider_id: "launcher.node-test-v8-coverage", provider_version: "1.0.0",
      capability: "boundary_traversal", boundary_kind: "module",
      observation_mechanism: "node_test_v8_coverage",
      observation_seam: "node_test_structured_assertion",
      evidence_artifact_type: "boundary_trace" },
    coverage_disposition: { baseline_id: "coverage-baseline-example-suite",
      baseline_state: "complete_executed_inventory",
      items: [{ test_id: "test-component-exists", disposition: "preserved" }] },
    prohibited_shortcuts: ["coverage_percentage_only", "source_text_inspection"],
    ...overrides
  };
}

const expectReason = (callback, reason) => assert.throws(callback,
  (error) => error instanceof StableMigrationError && error.reason_code === reason &&
    error.diagnostics.total_count > 0, reason);

test("direct v0.2 and v0.3 migrations are pure, deterministic, and preserving", () => {
  const before = structuredClone(v02);
  const first = migrateControlledAcceptanceContractV02ToV1({
    contract: structuredClone(v02), testProofs: [proof()]
  });
  const second = migrateControlledAcceptanceContractV02ToV1({
    contract: structuredClone(v02), testProofs: [proof()]
  });
  assert.deepEqual(first, second);
  assert.deepEqual(v02, before);
  for (const field of ["references", "propositions", "claims", "relations",
    "collections", "residue", "annotations"]) assert.deepEqual(first[field], v02[field]);

  const v03 = migrateControlledAcceptanceContractV02ToV03({
    contract: structuredClone(v02), testProofs: [proof()]
  });
  const stable03 = migrateControlledAcceptanceContractV03ToV1({ contract: v03 });
  assert.deepEqual(stable03.test_proofs, v03.test_proofs);
  assert.deepEqual(migrateControlledAcceptanceContractV03ToV1({ contract: v03 }), stable03);
});

test("all nine typed refusals are reachable with first-stage precedence", () => {
  const stable = migrateControlledAcceptanceContractV02ToV1({
    contract: structuredClone(v02), testProofs: [proof()]
  });
  expectReason(() => migrateControlledAcceptanceContractV02ToV1({
    contract: stable, testProofs: []
  }), "stable_migration_source_already_stable");

  expectReason(() => migrateControlledAcceptanceContractV02ToV1({ contract: {
    ...structuredClone(v02), profile_id: "acceptance-contract.standard.experimental.v0.3"
  }, testProofs: [] }), "stable_migration_partial_or_mixed_family");

  expectReason(() => migrateControlledAcceptanceContractV02ToV1({ contract: {
    ...structuredClone(v02), schema_version: "controlled-acceptance-contract.v2",
    profile_id: "acceptance-contract.standard.v2",
    vocabulary_version: "controlled-contract-vocabulary.v2"
  }, testProofs: [] }), "stable_migration_source_family_unsupported");

  expectReason(() => migrateControlledAcceptanceContractV02ToV1({
    contract: null, testProofs: []
  }), "stable_migration_source_invalid");

  expectReason(() => migrateControlledAcceptanceContractV02ToV1({
    contract: structuredClone(v02), testProofs: []
  }), "stable_migration_test_proofs_required");

  const noProvider = proof();
  delete noProvider.candidate_execution_provider;
  expectReason(() => migrateControlledAcceptanceContractV02ToV1({
    contract: structuredClone(v02), testProofs: [noProvider]
  }), "stable_migration_provider_bindings_required");

  const v03 = migrateControlledAcceptanceContractV02ToV03({
    contract: structuredClone(v02), testProofs: [proof()]
  });
  expectReason(() => migrateControlledAcceptanceContractV03ToV1({
    contract: v03, supplement: [proof()]
  }), "stable_migration_supplement_forbidden");

  const badSource = structuredClone(v02);
  badSource.claims = [];
  expectReason(() => migrateControlledAcceptanceContractV02ToV1({
    contract: badSource, testProofs: [proof()]
  }), "stable_migration_source_invalid");

  expectReason(() => migrateControlledAcceptanceContractV02ToV1({
    contract: structuredClone(v02), testProofs: [proof({ test_proof_id: "bad" })]
  }), "stable_migration_result_invalid");

  const conflicting = proof({ observable_result: { observable_id: "observable-conflict",
    kind: "return_value", proposition_id: "prop-suite-covers-component" } });
  expectReason(() => migrateControlledAcceptanceContractV02ToV1({
    contract: structuredClone(v02), testProofs: [proof(), conflicting]
  }), "stable_migration_ambiguous");
});

test("winning migration stage alone supplies bounded diagnostics", () => {
  const mixedAndMissing = structuredClone(v02);
  mixedAndMissing.profile_id = "acceptance-contract.standard.experimental.v0.3";
  expectReason(() => migrateControlledAcceptanceContractV02ToV1({
    contract: mixedAndMissing, testProofs: []
  }), "stable_migration_partial_or_mixed_family");
  const invalidAndMissing = structuredClone(v02);
  invalidAndMissing.references.push(structuredClone(invalidAndMissing.references[0]));
  expectReason(() => migrateControlledAcceptanceContractV02ToV1({
    contract: invalidAndMissing, testProofs: []
  }), "stable_migration_test_proofs_required");
});

test("v0.2 provider authority is closed and compatible before result validation", () => {
  const cases = [
    (value) => { delete value.candidate_execution_provider; },
    (value) => { value.candidate_execution_provider = {}; },
    (value) => { value.candidate_execution_provider = { provider_id: "launcher.node-test" }; },
    (value) => { value.candidate_execution_provider = "truthy"; },
    (value) => { value.candidate_execution_provider = {
      provider_id: "launcher.node-test-module-fault", provider_version: "1.0.0",
      capability: "candidate_execution" }; }
  ];
  for (const mutate of cases) {
    const candidate = proof();
    mutate(candidate);
    expectReason(() => migrateControlledAcceptanceContractV02ToV1({
      contract: structuredClone(v02), testProofs: [candidate]
    }), "stable_migration_provider_bindings_required");
  }
  assert.equal(migrateControlledAcceptanceContractV02ToV1({
    contract: structuredClone(v02), testProofs: [proof()]
  }).schema_version, "controlled-acceptance-contract.v1");
});

test("v0.3 source-owned provider defects remain source invalid", () => {
  const v03 = migrateControlledAcceptanceContractV02ToV03({
    contract: structuredClone(v02), testProofs: [proof()]
  });
  v03.test_proofs[0].candidate_execution_provider = {};
  expectReason(() => migrateControlledAcceptanceContractV03ToV1({ contract: v03 }),
    "stable_migration_source_invalid");
});

test("identical proof multiplicity stays incomplete while conflicts stay ambiguous", () => {
  const identical = proof();
  expectReason(() => migrateControlledAcceptanceContractV02ToV1({
    contract: structuredClone(v02), testProofs: [identical, structuredClone(identical)]
  }), "stable_migration_test_proofs_required");
  const conflicting = proof({ observable_result: { observable_id: "observable-conflict",
    kind: "return_value", proposition_id: "prop-suite-covers-component" } });
  expectReason(() => migrateControlledAcceptanceContractV02ToV1({
    contract: structuredClone(v02), testProofs: [proof(), conflicting]
  }), "stable_migration_ambiguous");
});

test("migration output ignores source property order without changing graph text", () => {
  const reordered = Object.fromEntries(Object.entries(structuredClone(v02)).reverse());
  const originalText = "Cafe\u0301 remains source-authored";
  reordered.annotations = [...reordered.annotations, {
    annotation_id: "ann-non-normalized-text", kind: "note", text: originalText
  }];
  const canonical = migrateControlledAcceptanceContractV02ToV1({
    contract: reordered, testProofs: [proof()]
  });
  const ordinary = structuredClone(v02);
  ordinary.annotations = [...ordinary.annotations, reordered.annotations.at(-1)];
  assert.deepEqual(canonical, migrateControlledAcceptanceContractV02ToV1({
    contract: ordinary, testProofs: [proof()]
  }));
  assert.equal(canonical.annotations.at(-1).text, originalText);
});
