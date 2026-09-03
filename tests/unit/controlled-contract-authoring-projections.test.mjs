import assert from "node:assert/strict";
import test from "node:test";

import {
  applyControlledContractCarrierPatch as packageCarrierPatch
} from "../../packages/controlled-contract/current.mjs";

import {
  AUTHORING_LIMITS,
  applyControlledContractCarrierPatch as wikiCoreCarrierPatch,
  getControlledContractProjectionSpills,
  measureControlledContractAuthoringValue,
  projectControlledContractAuthoringState,
  projectControlledContractCarrierQuery
} from "../../packages/wiki-core/src/lib/controlled-contract-authoring-projections.mjs";

test("wiki-core re-exports the exact package-owned carrier patch primitive", () => {
  assert.equal(wikiCoreCarrierPatch, packageCarrierPatch);
  const content = { requested_intents: ["intent-a"], selected_packs: [] };
  const request = {
    content,
    carrierKind: "proof_plan_request",
    operations: [{
      op: "upsert", target: "requested_intents", id: "intent-b", value: "intent-b"
    }]
  };
  assert.deepEqual(wikiCoreCarrierPatch(request), packageCarrierPatch(request));
  assert.throws(() => wikiCoreCarrierPatch({
    content, carrierKind: "proof_plan_request", operations: []
  }), (error) => error.code === "controlled_contract_patch_request_too_large");
});

test("default authoring projection is compact, decision-only, and measured", () => {
  const request = { wk_id: "WK-2024" };
  const result = projectControlledContractAuthoringState({
    schema_version: "controlled-contract-authoring-state.v1",
    stage: "proof_authoring_required",
    selected_resources: { contract: { content_digest: `sha256:${"a".repeat(64)}` } },
    unresolved_decisions: { identities: ["selected_proof_pack"], count: 1 },
    next_calls: [{ tool: "workspace_controlled_proof_intents_discover", arguments: {} }],
    complete_carrier: { forbidden: true },
    compatible_candidates: [{ forbidden: true }],
    generated_skeleton: { forbidden: true }
  }, { request });
  assert.deepEqual(Object.keys(result).sort(), [
    "next_calls", "schema_version", "selected_resources", "stage",
    "unresolved_decisions"
  ]);
  assert.equal(JSON.stringify(result).includes("forbidden"), false);
  assert.equal(measureControlledContractAuthoringValue(request).byte_count,
    Buffer.byteLength(JSON.stringify(request)));
  assert.ok(measureControlledContractAuthoringValue(result).byte_count < AUTHORING_LIMITS.index);
});

test("continuation appears only for reusable state and accepted choices are not duplicated", () => {
  const continuation = `sha256:${"b".repeat(64)}`;
  const result = projectControlledContractAuthoringState({
    schema_version: "controlled-contract-authoring-state.v1",
    stage: "evaluation_input_ready",
    selected_resources: {},
    unresolved_decisions: { identities: ["evaluation_input_persistence"], count: 1 },
    continuation,
    next_calls: [{ tool: "workspace_controlled_contract_authoring_continue",
      arguments: { wk_id: "WK-2024", continuation } }]
  });
  assert.equal(result.continuation, continuation);
  assert.equal(JSON.stringify(result).includes("requested_intents"), false);
  const complete = projectControlledContractAuthoringState({
    schema_version: "controlled-contract-authoring-state.v1", stage: "complete",
    selected_resources: {}, unresolved_decisions: { identities: [], count: 0 },
    stop_condition: "controlled_contract_authoring_complete"
  });
  assert.equal(complete.continuation, undefined);
});

test("request/result measurements report bytes and repeated fields", () => {
  const measured = measureControlledContractAuthoringValue({
    selected_pack: { profile_id: "one" }, nested: { profile_id: "two" }
  });
  assert.equal(measured.repeated_fields.profile_id, 2);
  assert.equal(measured.byte_count > 0, true);
});

test("existing targeted pagination and spill behavior remains bounded", () => {
  const carrier = {
    wk_id: "WK-2024", focus: null, carrier_kind: "contract",
    content_digest: `sha256:${"c".repeat(64)}`,
    content: { references: Array.from({ length: 200 }, (_, index) => ({
      reference_id: `ref-${String(index).padStart(4, "0")}`,
      payload: "x".repeat(100)
    })) }
  };
  const page = projectControlledContractCarrierQuery({ carrier });
  assert.ok(Buffer.byteLength(JSON.stringify(page, null, 2)) <= AUTHORING_LIMITS.index);
  assert.ok(page.continuation);
  const selected = projectControlledContractCarrierQuery({
    carrier, selectors: ["ref-0000"]
  });
  assert.equal(selected.items[0].value.reference_id, "ref-0000");
  assert.deepEqual(getControlledContractProjectionSpills(selected), []);
});
