import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  applyControlledContractCarrierPatch
} from "@agent-chassis/controlled-contract";

import {
  AUTHORING_LIMITS,
  getControlledContractProjectionSpills,
  measureControlledContractAuthoringValue,
  projectControlledContractAuthoringState,
  projectControlledContractCarrierQuery
} from "../../packages/wiki-core/src/lib/controlled-contract-authoring-projections.mjs";

test("the carrier patch primitive is owned only by its package", async () => {

  const projections = await import(
    "../../packages/wiki-core/src/lib/controlled-contract-authoring-projections.mjs");
  const tools = await import(
    "../../packages/wiki-core/src/lib/controlled-contract-tools.mjs");
  for (const [name, namespace] of [["authoring projections", projections],
    ["the tools barrel", tools]]) {
    assert.equal(namespace.applyControlledContractCarrierPatch, undefined,
      `${name} must not re-export the package-owned carrier patch primitive`);
  }

  assert.equal(typeof projections.projectControlledContractCarrierQuery, "function");
  assert.equal(typeof tools.diffControlledContractCarrierContent, "function");
  assert.equal(tools.CARRIER_TARGETS, projections.CARRIER_TARGETS);
});

test("the carrier patch its one consumer reaches still patches and still refuses", async () => {

  const consumer = await readFile(new URL(
    "../../packages/wiki-core/src/operations/controlled-contract/carrier-operations.mjs",
    import.meta.url), "utf8");
  assert.match(consumer,
    /import \{ applyControlledContractCarrierPatch \} from\s*\n?\s*"@agent-chassis\/controlled-contract";/u,
    "carrier-operations must reach the primitive through the package that owns it");

  const obligation = { obligation_id: "OBL-PATCH-ROUNDTRIP", statement: "current" };
  const patched = applyControlledContractCarrierPatch({
    content: { obligations: [obligation] },
    carrierKind: "obligation_coverage",
    operations: [{ op: "upsert", target: "obligations", id: obligation.obligation_id,
      value: { ...obligation, statement: "updated" } }]
  });
  assert.deepEqual(patched.content.obligations, [{ ...obligation, statement: "updated" }]);
  assert.deepEqual({ changed: patched.changed, operation_count: patched.operation_count,
    upsert_count: patched.upsert_count, remove_count: patched.remove_count },
  { changed: true, operation_count: 1, upsert_count: 1, remove_count: 0 });
  assert.deepEqual(obligation, { obligation_id: "OBL-PATCH-ROUNDTRIP", statement: "current" },
    "the pure primitive must not mutate the caller's content");

  let refusal = null;
  try {
    applyControlledContractCarrierPatch({
      content: { obligations: [] }, carrierKind: "obligation_coverage",
      operations: Array.from({ length: 4096 }, (value, index) => ({
        op: "upsert", target: "obligations", id: `OBL-${index}`,
        value: { obligation_id: `OBL-${index}`, statement: "x".repeat(64) }
      }))
    });
  } catch (error) { refusal = error; }
  assert.equal(refusal?.code, "controlled_contract_patch_request_too_large");
  assert.equal(typeof refusal.details.byte_length, "number");
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
