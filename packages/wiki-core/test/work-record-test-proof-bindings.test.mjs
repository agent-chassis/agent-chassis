import assert from "node:assert/strict";
import test from "node:test";

import { resolveAuthorizedDeclaredTestTarget } from
  "../src/lib/work-record-test-proof-bindings.mjs";
import { projectWorkRecordTestProofValidation } from
  "../src/lib/work-record-test-proof-bindings.mjs";

const GENERATION = `sha256:${"a".repeat(64)}`;
const SNAPSHOT = `sha256:${"b".repeat(64)}`;
const VERIFICATION = "claim-suite-covers-component";

function selectedUnit(allowed) {
  return {
    id: "SLICE-005",
    acceptance: { validation: allowed }
  };
}

function entry(overrides = {}) {
  return {
    operation: "node_test",
    target: "packages/wiki-core/test/example.test.mjs",
    verification_ids: [VERIFICATION],
    ...overrides
  };
}

function resolve(allowed, overrides = {}) {
  return resolveAuthorizedDeclaredTestTarget({
    workRecord: { id: "WK-2458" },
    selectedUnit: selectedUnit(allowed),
    verificationId: VERIFICATION,
    controlledContractGeneration: GENERATION,
    sourceSnapshotDigest: SNAPSHOT,
    ...overrides
  });
}

test("derives one immutable target from the exact canonical Node-test declaration", () => {
  const result = resolve([entry()]);
  assert.equal(result.status, "resolved");
  assert.equal(result.operation, "node_test");
  assert.equal(result.target, "packages/wiki-core/test/example.test.mjs");
  assert.equal(result.unit, "WK-2458#SLICE-005");
  assert.equal(result.controlled_contract_generation, GENERATION);
  assert.equal(result.source_snapshot_digest, SNAPSHOT);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result), true);
});

test("missing and duplicate verification bindings are unavailable or refused", () => {
  assert.equal(resolve([]).reason_code, "verify_proof.declared_target_missing.v1");
  const duplicate = resolve([entry(), entry({
    target: "packages/wiki-core/test/other.test.mjs"
  })]);
  assert.equal(duplicate.status, "refused");
  assert.equal(duplicate.diagnostics.at(-1).code,
    "validation_verification_binding_duplicate");

  const repeatedInEntry = resolve([entry({
    verification_ids: [VERIFICATION, VERIFICATION]
  })]);
  assert.equal(repeatedInEntry.status, "refused");
  assert.equal(repeatedInEntry.diagnostics.at(-1).code,
    "validation_verification_id_duplicate");
});

test("rejects obsolete command objects, unknown operations, and non-closed targets", () => {
  const entries = [
    { command: "node --test tests/example.test.mjs", verification_ids: [VERIFICATION] },
    entry({ operation: "node_check" }),
    entry({ target: "/tmp/example.test.mjs" }),
    entry({ target: "C:\\tmp\\example.test.mjs" }),
    entry({ target: "../outside.test.mjs" }),
    entry({ target: "tests/../outside.test.mjs" }),
    entry({ target: "tests//example.test.mjs" }),
    entry({ target: "./tests/example.test.mjs" }),
    entry({ target: "tests/example.test.js" }),
    entry({ target: "tests/example.MJS" }),
    entry({ target: "-example.test.mjs" }),
    entry({ target: "tests/example;echo.mjs" }),
    { ...entry(), extra: true }
  ];
  for (const invalid of entries) {
    const result = resolve([invalid]);
    assert.equal(result.status, "refused");
    assert.match(result.diagnostics[0].code, /^validation_/u);
  }
});

test("never executes textual notes", () => {
  const missing = resolve([
    "node --test packages/wiki-core/test/example.test.mjs",
    { note: "node_test packages/wiki-core/test/example.test.mjs",
      verification_ids: ["claim-other"] }
  ]);
  assert.equal(missing.status, "unavailable");
  assert.equal(missing.reason_code, "verify_proof.declared_target_missing.v1");
});

test("does not borrow a verification binding from a sibling implementation unit", () => {
  const selected = selectedUnit([]);
  const sibling = { id: "SLICE-006", acceptance: { validation: [entry()] } };
  const result = resolveAuthorizedDeclaredTestTarget({
    workRecord: { id: "WK-2458", slices: [selected, sibling] },
    selectedUnit: selected,
    verificationId: VERIFICATION,
    controlledContractGeneration: GENERATION,
    sourceSnapshotDigest: SNAPSHOT
  });
  assert.equal(result.status, "unavailable");
  assert.equal(result.reason_code, "verify_proof.declared_target_missing.v1");
  assert.equal(result.unit, "WK-2458#SLICE-005");
});

test("reviewers resolve only the explicitly frozen reviewed implementation target", () => {
  const implementation = selectedUnit([entry()]);
  const reviewer = {
    id: "SLICE-008",
    admission_review_target_unit: "WK-2458#SLICE-005",
    acceptance: { validation: [] }
  };
  const workRecord = { id: "WK-2458", slices: [implementation, reviewer] };
  const result = resolveAuthorizedDeclaredTestTarget({
    workRecord,
    selectedUnit: reviewer,
    reviewedTargetBinding: {
      schema_version: "launcher-frozen-reviewed-test-target-binding.v1",
      reviewer_unit: "WK-2458#SLICE-008",
      reviewed_unit: "WK-2458#SLICE-005"
    },
    verificationId: VERIFICATION,
    controlledContractGeneration: GENERATION,
    sourceSnapshotDigest: SNAPSHOT
  });
  assert.equal(result.status, "resolved");
  assert.equal(result.unit, "WK-2458#SLICE-005");
});

test("reviewer target binding absence is unavailable; stale, ambiguous, and cross-bound refuse", () => {
  const implementation = selectedUnit([entry()]);
  const reviewer = {
    id: "SLICE-008",
    admission_review_target_unit: "WK-2458#SLICE-005",
    acceptance: { validation: [] }
  };
  const base = {
    workRecord: { id: "WK-2458", slices: [implementation, reviewer] },
    selectedUnit: reviewer,
    verificationId: VERIFICATION,
    controlledContractGeneration: GENERATION,
    sourceSnapshotDigest: SNAPSHOT
  };
  const binding = (reviewedUnit) => ({
    schema_version: "launcher-frozen-reviewed-test-target-binding.v1",
    reviewer_unit: "WK-2458#SLICE-008",
    reviewed_unit: reviewedUnit
  });
  const absent = resolveAuthorizedDeclaredTestTarget({
    ...base, reviewedTargetBinding: binding(null)
  });
  assert.equal(absent.status, "unavailable");
  assert.equal(absent.reason_code, "verify_proof.reviewed_target_binding_missing.v1");

  const stale = resolveAuthorizedDeclaredTestTarget({
    ...base, reviewedTargetBinding: binding("WK-2458#SLICE-006")
  });
  assert.equal(stale.status, "refused");
  assert.equal(stale.diagnostics[0].code, "test_proof_reviewed_target_binding_stale");

  const ambiguous = resolveAuthorizedDeclaredTestTarget({
    ...base,
    workRecord: { id: "WK-2458", slices: [implementation,
      structuredClone(implementation), reviewer] },
    reviewedTargetBinding: binding("WK-2458#SLICE-005")
  });
  assert.equal(ambiguous.status, "refused");
  assert.equal(ambiguous.diagnostics[0].code,
    "test_proof_reviewed_target_binding_ambiguous");

  const crossBound = resolveAuthorizedDeclaredTestTarget({
    ...base,
    reviewedTargetBinding: binding("WK-9999#SLICE-005")
  });
  assert.equal(crossBound.status, "refused");
  assert.equal(crossBound.diagnostics[0].code,
    "test_proof_reviewed_target_binding_cross_bound");
});

test("wiki-core owns the target-to-verification projection", () => {
  const projection = projectWorkRecordTestProofValidation({ selectedUnit: {
    acceptance: { validation: [
      { operation: "node_test", target: "tests/example.test.mjs",
        verification_ids: ["claim-b", "claim-a"] },
      { note: "node_test tests/ignored.test.mjs", verification_ids: ["claim-c"] }
    ] }
  } });
  assert.deepEqual(projection.targets, ["tests/example.test.mjs"]);
  assert.deepEqual(projection.validation_bindings,
    { "tests/example.test.mjs": ["claim-a", "claim-b"] });
  assert.equal(Object.isFrozen(projection.validation_bindings), true);
});
