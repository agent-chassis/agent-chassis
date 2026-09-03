import assert from "node:assert/strict";
import test from "node:test";

import {
  CARRIER_PATCH_LIMITS,
  CARRIER_TARGETS,
  applyControlledContractCarrierPatch,
  carrierPatchRequestProjection,
  carrierValueId
} from "../../lib/carrier-patch-v1.mjs";

function refusal(operation) {
  try {
    operation();
  } catch (error) {
    return error;
  }
  return assert.fail("the primitive accepted an input it must refuse");
}

function annotation(index, padding = 0) {
  return {
    annotation_id: `ann-${index}`,
    kind: "rationale",
    text: "x".repeat(padding)
  };
}

function requestOfExactly(byteTarget, carrierKind = "contract") {
  const operations = Array.from({ length: 8 }, (value, index) => ({
    op: "upsert", target: "annotations", value: annotation(index, 8000)
  }));
  const measure = () => Buffer.byteLength(JSON.stringify(
    carrierPatchRequestProjection(carrierKind, operations)), "utf8");
  const last = operations.at(-1).value;
  last.text = "x".repeat(8000 + (byteTarget - measure()));
  assert.equal(measure(), byteTarget);
  for (const operation of operations) {
    assert.ok(Buffer.byteLength(JSON.stringify(operation), "utf8") <=
      CARRIER_PATCH_LIMITS.operation_bytes);
  }
  return operations;
}

test("the primitive declares the exact stable-v1 carrier grammar and bounds", () => {
  assert.deepEqual(Object.keys(CARRIER_TARGETS),
    ["contract", "evaluation_input", "proof_plan_request",
      "obligation_coverage", "acceptance_coverage"]);
  assert.deepEqual(CARRIER_TARGETS.contract, {
    references: "reference_id", propositions: "proposition_id",
    claims: "claim_id", relations: "relation_id", collections: "collection_id",
    residue: "residue_id", annotations: "annotation_id"
  });
  assert.deepEqual(CARRIER_TARGETS.evaluation_input, {
    reference_bindings: "role", number_bindings: "role",
    claim_pattern_bindings: "claim_pattern", resolver_facts: "resolver_fact",
    delivered_evidence: "delivered_evidence", evaluation_stage: "scalar"
  });
  assert.deepEqual(CARRIER_TARGETS.proof_plan_request, {
    requested_intents: "value", selected_packs: "pack"
  });
  assert.deepEqual(CARRIER_TARGETS.obligation_coverage, {
    obligations: "obligation_id"
  });
  assert.deepEqual(CARRIER_TARGETS.acceptance_coverage, {
    rows: "criterion_identity"
  });
  assert.deepEqual({ ...CARRIER_PATCH_LIMITS },
    { operation_bytes: 16384, request_bytes: 65536 });
  assert.equal(Object.isFrozen(CARRIER_TARGETS), true);
  assert.equal(Object.isFrozen(CARRIER_PATCH_LIMITS), true);
});

test("stable selectors are resolved by the identity rule of each target", () => {
  assert.equal(carrierValueId("references", "reference_id",
    { reference_id: "ref-a" }), "ref-a");
  assert.equal(carrierValueId("requested_intents", "value", "intent"), "intent");
  assert.equal(carrierValueId("selected_packs", "pack",
    { profile_id: "proof.x", profile_version: "2.0.0" }), "proof.x@2.0.0");
  assert.equal(carrierValueId("claim_pattern_bindings", "claim_pattern",
    { pattern_id: "p", claim_id: "c" }), "p=>c");
  assert.equal(carrierValueId("delivered_evidence", "delivered_evidence",
    { evidence_kind: "k", verification_claim_id: "v" }), "k=>v");
  assert.equal(carrierValueId("evaluation_stage", "scalar", "pre_dispatch"),
    "evaluation_stage");
  assert.equal(carrierValueId("resolver_facts", "resolver_fact", {
    resolver_kind: "r", fact_key: "f", argument_reference_ids: ["ref-a"]
  }), Buffer.from(JSON.stringify(["r", "f", ["ref-a"]])).toString("base64url"));

  assert.equal(carrierValueId("references", "claim_pattern", {}), null);
});

test("the fixed request projection is derived from carrier kind and operations", () => {
  const operations = [{ op: "remove", target: "annotations", id: "ann-0" }];
  assert.deepEqual(carrierPatchRequestProjection("contract", operations), {
    carrier_kind: "contract", operations
  });
  assert.deepEqual(Object.keys(carrierPatchRequestProjection("contract", operations)),
    ["carrier_kind", "operations"]);
});

test("an unsupported carrier kind and an empty population refuse", () => {
  const content = { annotations: [] };
  for (const [carrierKind, operations] of [
    ["proof_plan", [{ op: "upsert", target: "requested_intents", value: "x" }]],
    ["contract", []],
    ["contract", "not-an-array"]
  ]) {
    const error = refusal(() => applyControlledContractCarrierPatch({
      content, carrierKind, operations
    }));
    assert.equal(error.code, "controlled_contract_patch_request_too_large");
    assert.equal(typeof error.details.byte_length, "number");
  }
  const accepted = applyControlledContractCarrierPatch({
    content,
    carrierKind: "contract",
    operations: Array.from({ length: 65 }, (value, index) =>
      ({ op: "upsert", target: "annotations", value: annotation(index) }))
  });
  assert.equal(accepted.content.annotations.length, 65);
  assert.equal(accepted.operation_count, 65);
  assert.equal(accepted.upsert_count, 65);
  assert.equal(accepted.remove_count, 0);
  assert.equal(accepted.changed, true);
});

test("coverage-family vocabularies preserve target identity and no-op classification", () => {
  const obligation = { obligation_id: "WK2438-OBLIGATION", statement: "current" };
  const acceptance = { criterion_identity: "sha256:criterion", node_ids: [] };
  const obligationResult = applyControlledContractCarrierPatch({
    content: { obligations: [obligation] },
    carrierKind: "obligation_coverage",
    operations: [
      { op: "remove", target: "obligations", id: obligation.obligation_id },
      { op: "upsert", target: "obligations", id: obligation.obligation_id,
        value: { ...obligation, statement: "updated" } }
    ]
  });
  assert.equal(obligationResult.content.obligations[0].statement, "updated");
  assert.deepEqual({ operation_count: obligationResult.operation_count,
    upsert_count: obligationResult.upsert_count,
    remove_count: obligationResult.remove_count },
  { operation_count: 2, upsert_count: 1, remove_count: 1 });

  const acceptanceResult = applyControlledContractCarrierPatch({
    content: { rows: [acceptance] },
    carrierKind: "acceptance_coverage",
    operations: [{ op: "upsert", target: "rows",
      id: acceptance.criterion_identity, value: acceptance }]
  });
  assert.equal(acceptanceResult.changed, false);
  assert.deepEqual(acceptanceResult.content.rows, [acceptance]);
});

test("acceptance coverage admits 65 bounded operations and coverage failures remain atomic", () => {
  const rows = Array.from({ length: 65 }, (_, index) => ({
    criterion_identity: `sha256:criterion-${index}`,
    node_ids: []
  }));
  const accepted = applyControlledContractCarrierPatch({
    content: { rows: [] },
    carrierKind: "acceptance_coverage",
    operations: rows.map((value) => ({
      op: "upsert", target: "rows", id: value.criterion_identity, value
    }))
  });
  assert.equal(accepted.operation_count, 65);
  assert.equal(accepted.content.rows.length, 65);

  for (const fixture of [
    {
      carrierKind: "acceptance_coverage",
      content: { rows: [rows[0]] },
      operations: [
        { op: "remove", target: "rows", id: rows[0].criterion_identity },
        { op: "upsert", target: "obligations", value: { obligation_id: "wrong" } }
      ]
    },
    {
      carrierKind: "obligation_coverage",
      content: { obligations: [{ obligation_id: "obligation-0" }] },
      operations: [
        { op: "remove", target: "obligations", id: "obligation-0" },
        { op: "upsert", target: "rows", value: rows[0] }
      ]
    }
  ]) {
    const before = structuredClone(fixture.content);
    const error = refusal(() => applyControlledContractCarrierPatch(fixture));
    assert.equal(error.code, "controlled_contract_patch_operation_invalid");
    assert.deepEqual(fixture.content, before);
  }
});

test("the request limit accepts exactly 65,536 bytes and refuses one byte more", () => {
  const atBound = requestOfExactly(CARRIER_PATCH_LIMITS.request_bytes);
  const accepted = applyControlledContractCarrierPatch({
    content: { annotations: [] }, carrierKind: "contract", operations: atBound
  });
  assert.equal(accepted.content.annotations.length, 8);

  const aboveBound = requestOfExactly(CARRIER_PATCH_LIMITS.request_bytes + 1);
  const error = refusal(() => applyControlledContractCarrierPatch({
    content: { annotations: [] }, carrierKind: "contract", operations: aboveBound
  }));
  assert.equal(error.code, "controlled_contract_patch_request_too_large");
  assert.equal(error.details.byte_length, CARRIER_PATCH_LIMITS.request_bytes + 1);
});

test("one oversized operation refuses independently of the request bound", () => {
  const error = refusal(() => applyControlledContractCarrierPatch({
    content: { annotations: [] },
    carrierKind: "contract",
    operations: [{
      op: "upsert", target: "annotations",
      value: annotation(0, CARRIER_PATCH_LIMITS.operation_bytes)
    }]
  }));
  assert.equal(error.code, "controlled_contract_patch_operation_too_large");
  for (const operation of [null, "text", ["array"]]) {
    assert.equal(refusal(() => applyControlledContractCarrierPatch({
      content: { annotations: [] }, carrierKind: "contract", operations: [operation]
    })).code, "controlled_contract_patch_operation_too_large");
  }
});

test("unknown keys, unsupported ops, and unsupported targets refuse as invalid", () => {
  for (const operation of [
    { op: "upsert", target: "annotations", value: annotation(0), extra: 1 },
    { op: "replace", target: "annotations", value: annotation(0) },
    { op: "upsert", target: "test_proofs", value: { test_proof_id: "t" } }
  ]) {
    assert.equal(refusal(() => applyControlledContractCarrierPatch({
      content: { annotations: [] }, carrierKind: "contract", operations: [operation]
    })).code, "controlled_contract_patch_operation_invalid");
  }
});

test("an unresolvable stable selector refuses before any mutation", () => {
  for (const operation of [
    { op: "remove", target: "annotations" },
    { op: "upsert", target: "annotations", value: { kind: "rationale" } },
    { op: "upsert", target: "annotations", id: "", value: annotation(0) }
  ]) {
    assert.equal(refusal(() => applyControlledContractCarrierPatch({
      content: { annotations: [] }, carrierKind: "contract", operations: [operation]
    })).code, "controlled_contract_patch_identity_invalid");
  }
});

test("an upsert value must carry the selector identity it is addressed by", () => {
  assert.equal(refusal(() => applyControlledContractCarrierPatch({
    content: { annotations: [] },
    carrierKind: "contract",
    operations: [{ op: "upsert", target: "annotations", id: "ann-9",
      value: annotation(0) }]
  })).code, "controlled_contract_patch_value_invalid");
  assert.equal(refusal(() => applyControlledContractCarrierPatch({
    content: { annotations: [] },
    carrierKind: "contract",
    operations: [{ op: "upsert", target: "annotations", id: "ann-0" }]
  })).code, "controlled_contract_patch_value_invalid");
});

test("a typed domain target that is not a JSON array refuses with its target", () => {
  const error = refusal(() => applyControlledContractCarrierPatch({
    content: { annotations: "not-an-array" },
    carrierKind: "contract",
    operations: [{ op: "upsert", target: "annotations", value: annotation(0) }]
  }));
  assert.equal(error.code, "controlled_contract_patch_operation_invalid");
  assert.equal(error.details.target, "annotations");
});

test("a scalar target upserts by its own selector and removes its key", () => {
  const upserted = applyControlledContractCarrierPatch({
    content: { reference_bindings: [] },
    carrierKind: "evaluation_input",
    operations: [{ op: "upsert", target: "evaluation_stage",
      value: "pre_dispatch" }]
  });
  assert.equal(upserted.content.evaluation_stage, "pre_dispatch");

  const removed = applyControlledContractCarrierPatch({
    content: { evaluation_stage: "pre_dispatch" },
    carrierKind: "evaluation_input",
    operations: [{ op: "remove", target: "evaluation_stage",
      id: "evaluation_stage" }]
  });
  assert.equal(Object.hasOwn(removed.content, "evaluation_stage"), false);
  assert.equal(refusal(() => applyControlledContractCarrierPatch({
    content: { evaluation_stage: "pre_dispatch" },
    carrierKind: "evaluation_input",
    operations: [{ op: "remove", target: "evaluation_stage" }]
  })).code, "controlled_contract_patch_identity_invalid");

  assert.equal(refusal(() => applyControlledContractCarrierPatch({
    content: {},
    carrierKind: "evaluation_input",
    operations: [{ op: "upsert", target: "evaluation_stage",
      id: "evaluation_stage" }]
  })).code, "controlled_contract_patch_value_invalid");
  assert.equal(refusal(() => applyControlledContractCarrierPatch({
    content: {},
    carrierKind: "evaluation_input",
    operations: [{ op: "upsert", target: "evaluation_stage", id: "elsewhere",
      value: "pre_dispatch" }]
  })).code, "controlled_contract_patch_value_invalid");
});

test("an absent typed domain is created and an existing identity is replaced in place", () => {
  const created = applyControlledContractCarrierPatch({
    content: {},
    carrierKind: "contract",
    operations: [{ op: "upsert", target: "annotations", value: annotation(0) }]
  });
  assert.deepEqual(created.content.annotations, [annotation(0)]);

  const replaced = applyControlledContractCarrierPatch({
    content: { annotations: [annotation(0), annotation(1), annotation(2)] },
    carrierKind: "contract",
    operations: [{ op: "upsert", target: "annotations",
      value: { ...annotation(1), text: "replaced" } }]
  });
  assert.deepEqual(replaced.content.annotations.map(({ annotation_id: id }) => id),
    ["ann-0", "ann-1", "ann-2"]);
  assert.equal(replaced.content.annotations[1].text, "replaced");
});

test("a removed identity keeps its ordinal position when it is upserted again", () => {
  const result = applyControlledContractCarrierPatch({
    content: { annotations: [annotation(0), annotation(1), annotation(2)] },
    carrierKind: "contract",
    operations: [
      { op: "remove", target: "annotations", id: "ann-1" },
      { op: "upsert", target: "annotations",
        value: { ...annotation(1), text: "restored" } }
    ]
  });
  assert.deepEqual(result.content.annotations.map(({ annotation_id: id }) => id),
    ["ann-0", "ann-1", "ann-2"]);
  assert.equal(result.content.annotations[1].text, "restored");

  const appended = applyControlledContractCarrierPatch({
    content: { annotations: [annotation(0), annotation(2)] },
    carrierKind: "contract",
    operations: [{ op: "upsert", target: "annotations", value: annotation(1) }]
  });
  assert.deepEqual(appended.content.annotations.map(({ annotation_id: id }) => id),
    ["ann-0", "ann-2", "ann-1"]);
});

test("removing an absent identity is an accepted no-op", () => {
  const content = { annotations: [annotation(0)] };
  const result = applyControlledContractCarrierPatch({
    content, carrierKind: "contract",
    operations: [{ op: "remove", target: "annotations", id: "ann-absent" }]
  });
  assert.deepEqual(result.content, content);
  assert.notEqual(result.content, content);
});

test("the primitive canonicalizes by cloning and never mutates its inputs", () => {
  const content = { annotations: [annotation(0)] };
  const value = annotation(1);
  const operations = [{ op: "upsert", target: "annotations", value }];
  const result = applyControlledContractCarrierPatch({
    content, carrierKind: "contract", operations
  });
  value.text = "mutated after the call";
  content.annotations.push(annotation(9));
  assert.equal(result.content.annotations.length, 2);
  assert.equal(result.content.annotations[1].text, "");
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(Object.keys(result), [
    "content", "changed", "operation_count", "upsert_count", "remove_count"
  ]);
});
