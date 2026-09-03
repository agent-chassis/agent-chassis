import assert from "node:assert/strict";
import test from "node:test";
import { ControlledContractRefactorError,
  buildControlledContractRefactorClosure } from "../lib/refactor-graph-v1.mjs";

function population() {
  return [
    { carrier_kind: "contract", content: {
      propositions: [{ proposition_id: "P-old", modality: "must", text: "x" }],
      claims: [{ claim_id: "C-1", proposition_id: "P-old" }],
      relations: [{ relation_id: "R-1", source_id: "P-old", target_id: "C-1",
        role: "verifies" }],
      collections: [{ collection_id: "K-1", node_ids: ["P-old"] }]
    } },
    { carrier_kind: "stable_test_proof", mutable: false, content: {
      test_proofs: [{ proof_id: "T-1", verification_id: "P-old" }] } },
    { carrier_kind: "obligation_coverage", content: { obligations: [
      { obligation_id: "O-1", controlled_contract_node_ids: ["P-old"] }] } },
    { carrier_kind: "acceptance_coverage", content: { rows: [
      { criterion_identity: "A-1", controlled_contract_node_ids: ["P-old"] }] } },
    { carrier_kind: "proof_plan", content: { proof_plan_id: "PP-1",
      source_generation_id: "G-1", node_ids: ["P-old"] } },
    { carrier_kind: "assessment", content: { assessment_id: "AS-1",
      source_generation_id: "G-1", node_ids: ["P-old"] } }
  ];
}

function replaceContractOperations(newIdentities) {
  const operations = [
    { op: "remove", target: "propositions", id: "P-old" },
    { op: "remove", target: "claims", id: "C-1" },
    { op: "remove", target: "relations", id: "R-1" },
    { op: "remove", target: "collections", id: "K-1" }
  ];
  newIdentities.forEach((identity, index) => {
    operations.push({ op: "upsert", target: "propositions", id: identity,
      value: { proposition_id: identity, modality: "must", text: `replacement ${index}` } });
  });
  return [{ carrier_kind: "contract", operations }];
}

test("rename_identity closes and rewrites every live carrier reference", () => {
  const result = buildControlledContractRefactorClosure({ live_carriers: population(),
    mode: { kind: "rename_identity", old_identity: "P-old",
      new_identity: "P-new" } });
  assert.equal(result.classification, "identity_equivalent");
  assert.equal(result.proof_credit_transferred, false);
  assert.ok(result.closure.length >= 5);
  assert.equal(JSON.stringify(result.carriers).includes("P-old"), false);
  assert.equal(Object.isFrozen(result), true);
});

for (const field of ["modality", "applicability", "verification_method",
  "relation_role", "collection_membership", "proof_requirement"]) {
  test(`rename_identity refuses semantic change in ${field}`, () => {
    assert.throws(() => buildControlledContractRefactorClosure({
      live_carriers: population(), mode: { kind: "rename_identity",
        old_identity: "P-old", new_identity: "P-new",
        old_node: { proposition_id: "P-old", [field]: "before" },
        new_node: { proposition_id: "P-new", [field]: "after" } }
    }), (error) => error instanceof ControlledContractRefactorError &&
      error.code === "controlled_contract_refactor_rename_semantic_change" &&
      error.recovery.operation === "workspace_controlled_contract_refactor_plan");
  });
}

test("replace_subgraph preserves split correspondence and creates explicit gaps", () => {
  const result = buildControlledContractRefactorClosure({ live_carriers: population(),
    mode: { kind: "replace_subgraph", reason: "split the requirement",
      correspondence: [{ old_identity: "P-old",
        new_identities: ["P-2", "P-1"] }],
      carrier_operations: replaceContractOperations(["P-1", "P-2"])[0].operations
        ? replaceContractOperations(["P-1", "P-2"]) : [] } });
  assert.equal(result.classification, "semantic_replacement");
  assert.deepEqual(result.correspondence[0].new_identities, ["P-1", "P-2"]);
  assert.equal(result.proof_gaps.length, 2);
  assert.ok(result.proof_gaps.every((gap) => gap.proof_credit === "not_transferred"));
  assert.deepEqual(result.invalidated_derived.map(({ carrier_kind }) => carrier_kind),
    ["assessment", "proof_plan"]);
});

test("replace_subgraph accepts removal and rejects missing reason or unknown identity", () => {
  const removal = buildControlledContractRefactorClosure({ live_carriers: population(),
    mode: { kind: "replace_subgraph", reason: "remove obsolete requirement",
      correspondence: [{ old_identity: "P-old", new_identities: [] }],
      carrier_operations: replaceContractOperations([]) } });
  assert.deepEqual(removal.proof_gaps, [{ old_identity: "P-old",
    new_identity: null, change: "removal", proof_credit: "not_transferred",
    disposition: "explicit_gap_required" }]);
  assert.throws(() => buildControlledContractRefactorClosure({
    live_carriers: population(), mode: { kind: "replace_subgraph", reason: "",
      correspondence: [{ old_identity: "P-old", new_identities: [] }] }
  }), { code: "controlled_contract_refactor_replace_reason_required" });
  assert.throws(() => buildControlledContractRefactorClosure({
    live_carriers: population(), mode: { kind: "replace_subgraph", reason: "x",
      correspondence: [{ old_identity: "absent", new_identities: ["P-new"] }] }
  }), { code: "controlled_contract_refactor_identity_unknown" });
});

test("replace_subgraph represents pure additions and many-to-one merges", () => {
  const addition = buildControlledContractRefactorClosure({ live_carriers: population(),
    mode: { kind: "replace_subgraph", reason: "add a requirement",
      correspondence: [{ old_identity: null, new_identities: ["P-added"] }],
      carrier_operations: [{ carrier_kind: "contract", operations: [{ op: "upsert",
        target: "propositions", id: "P-added", value: { proposition_id: "P-added",
          modality: "must", text: "added" } }] }] } });
  assert.deepEqual(addition.correspondence,
    [{ old_identity: null, new_identities: ["P-added"] }]);
  assert.equal(addition.proof_gaps[0].change, "addition");

  const mergedPopulation = population();
  mergedPopulation[0].content.propositions.push(
    { proposition_id: "P-other", modality: "must", text: "y" });
  const merge = buildControlledContractRefactorClosure({ live_carriers: mergedPopulation,
    mode: { kind: "replace_subgraph", reason: "merge requirements",
      correspondence: [
        { old_identity: "P-other", new_identities: ["P-merged"] },
        { old_identity: "P-old", new_identities: ["P-merged"] }
      ], carrier_operations: [{ carrier_kind: "contract", operations: [
        { op: "remove", target: "propositions", id: "P-old" },
        { op: "remove", target: "propositions", id: "P-other" },
        { op: "upsert", target: "propositions", id: "P-merged",
          value: { proposition_id: "P-merged", modality: "must", text: "merged" } },
        { op: "remove", target: "claims", id: "C-1" },
        { op: "remove", target: "relations", id: "R-1" },
        { op: "remove", target: "collections", id: "K-1" }
      ] }] } });
  assert.deepEqual(merge.correspondence.map(({ old_identity }) => old_identity),
    ["P-old", "P-other"]);
  assert.equal(merge.proof_gaps.length, 2);
});

test("replace_subgraph refuses an unchanged existing identity as a pure addition", () => {
  assert.throws(() => buildControlledContractRefactorClosure({
    live_carriers: population(),
    mode: { kind: "replace_subgraph", reason: "claim an existing requirement is new",
      correspondence: [{ old_identity: null, new_identities: ["P-old"] }],
      carrier_operations: [] }
  }), (error) => error instanceof ControlledContractRefactorError &&
    error.code === "controlled_contract_refactor_correspondence_invalid" &&
    error.deciding_facts.some(({ field, value }) =>
      field === "existing_addition_identities" &&
      JSON.stringify(value) === JSON.stringify(["P-old"])));
});

test("unresolved live identities refuse with exact bounded identities", () => {
  const unresolved = population();
  unresolved[0].content.references = [{ reference_id: "REF-1",
    node_id: "P-missing" }];
  assert.throws(() => buildControlledContractRefactorClosure({ live_carriers: unresolved,
    mode: { kind: "rename_identity", old_identity: "P-old",
      new_identity: "P-new" } }), (error) =>
    error.code === "controlled_contract_refactor_closure_incomplete" &&
    error.deciding_facts.some(({ field, value }) => field === "unresolved_identities" &&
      value.length === 1 && value[0] === "P-missing"));

  const overBound = population();
  overBound[0].content.node_ids = Array.from({ length: 257 },
    (_, index) => `missing-${String(index).padStart(3, "0")}`);
  assert.throws(() => buildControlledContractRefactorClosure({ live_carriers: overBound,
    mode: { kind: "rename_identity", old_identity: "P-old",
      new_identity: "P-new" } }), (error) =>
    error.code === "controlled_contract_refactor_bound_exceeded" &&
    error.deciding_facts.find(({ field }) =>
      field === "bounded_unresolved_identities").value.length === 256);
});

test("replace_subgraph rejects spoofed coverage output and duplicate carriers", () => {
  assert.throws(() => buildControlledContractRefactorClosure({
    live_carriers: population(), mode: { kind: "replace_subgraph", reason: "spoof",
      correspondence: [{ old_identity: "P-old", new_identities: [] }],
      obligation_rebase: { conflicts: [] } } }),
  (error) => error.code === "controlled_contract_refactor_input_invalid" &&
    error.deciding_facts.some(({ field, value }) =>
      field === "unknown" && value.includes("obligation_rebase")));

  assert.throws(() => buildControlledContractRefactorClosure({
    live_carriers: population(), mode: { kind: "replace_subgraph", reason: "duplicate",
      correspondence: [{ old_identity: "P-old", new_identities: [] }],
      carrier_operations: [
        { carrier_kind: "contract", operations: [{ op: "invalid" }] },
        { carrier_kind: "contract", operations: [] }
      ] } }), (error) => error.code ===
      "controlled_contract_refactor_replace_operations_invalid" &&
      error.deciding_facts[0].field === "duplicate_carrier_kinds");
});

test("closure and classification ordering are deterministic", () => {
  const mode = { kind: "rename_identity", old_identity: "P-old",
    new_identity: "P-new" };
  const first = buildControlledContractRefactorClosure({
    live_carriers: population(), mode });
  const second = buildControlledContractRefactorClosure({
    live_carriers: population().reverse(), mode });
  assert.equal(first.result_digest, second.result_digest);
  assert.deepEqual(first, second);
});
