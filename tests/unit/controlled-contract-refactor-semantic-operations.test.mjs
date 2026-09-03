import assert from "node:assert/strict";
import test from "node:test";

import {
  buildControlledContractRefactorPlanOperation,
  consumeControlledContractRefactorPlanSnapshot,
  queryControlledContractRefactorPlan
} from "../../packages/wiki-core/src/operations/controlled-contract/refactor-semantic-operations.mjs";

function source(referenceCount = 1) {
  const liveCarriers = [{ carrier_kind: "contract", generation_id: "G-1",
    content: {
      propositions: [{ proposition_id: "P-old", modality: "must", text: "x" }],
      claims: Array.from({ length: referenceCount }, (_, index) => ({
        claim_id: `C-${String(index).padStart(3, "0")}`,
        proposition_id: "P-old"
      }))
    } }];
  const snapshot = { generation: "G-1", manifestDigest: "sha256:manifest",
    liveCarriers, obligationFacts: null, acceptanceCarrier: null };
  snapshot.resolveCurrent = async () => snapshot;
  return snapshot;
}

function request() {
  return { repoRoot: "/unused", wkId: "WK-2470", focus: null,
    expectedGeneration: "G-1", expectedManifestDigest: undefined,
    mode: { kind: "rename_identity", old_identity: "P-old",
      new_identity: "P-new" } };
}

test("plan and decoded-cursor pages are deterministic and lossless", async () => {
  const first = await buildControlledContractRefactorPlanOperation(request(), {
    resolvedSnapshot: source(90), applyContinuation: "sha256:continuation"
  });
  assert.equal(first.counts.returned, 64);
  assert.ok(first.counts.remaining > 0);
  assert.equal(first.final_action, null);
  const snapshot = consumeControlledContractRefactorPlanSnapshot(first);
  const payload = { ...first.next_cursor_binding, expires_at: Date.now() + 60_000 };
  const second = await queryControlledContractRefactorPlan({
    resourceIdentity: first.resource_identity,
    selector: null,
    authenticatedCursorPayload: payload
  }, { snapshot });
  assert.equal(first.counts.complete, first.counts.returned + second.counts.returned);
  assert.equal(second.counts.remaining, 0);
  assert.deepEqual(second.final_action, {
    operation: "workspace_controlled_contract_refactor_apply",
    arguments: { continuation: "sha256:continuation" }
  });
  const all = [...first.items, ...second.items];
  assert.deepEqual(all.map(({ kind, stable_id }) => `${kind}\0${stable_id}`),
    all.map(({ kind, stable_id }) => `${kind}\0${stable_id}`).sort());
});

test("selector start supports zero and one item without cursor authentication logic", async () => {
  const initial = await buildControlledContractRefactorPlanOperation(request(), {
    resolvedSnapshot: source(), applyContinuation: "sha256:continuation"
  });
  const snapshot = consumeControlledContractRefactorPlanSnapshot(initial);
  const noneSelector = { kind: "carrier", stable_id: "absent" };
  const none = await queryControlledContractRefactorPlan({
    resourceIdentity: initial.resource_identity, selector: noneSelector,
    authenticatedCursorPayload: { resource_kind: "plan",
      resource_identity: initial.resource_identity,
      snapshot_digest: initial.snapshot_digest, selector: noneSelector,
      offset: 0, page_size: 64, expires_at: Date.now() + 60_000 }
  }, { snapshot });
  assert.deepEqual(none.counts, { complete: 0, returned: 0, omitted: 0, remaining: 0 });

  const oneSelector = { kind: "carrier", stable_id: "contract" };
  const one = await queryControlledContractRefactorPlan({
    resourceIdentity: initial.resource_identity, selector: oneSelector,
    authenticatedCursorPayload: { resource_kind: "plan",
      resource_identity: initial.resource_identity,
      snapshot_digest: initial.snapshot_digest, selector: oneSelector,
      offset: 0, page_size: 64, expires_at: Date.now() + 60_000 }
  }, { snapshot });
  assert.equal(one.counts.returned, 1);
  assert.equal(one.final_action, null);
});

test("wrong snapshot and changed current generation refuse before mutation", async () => {
  const initial = await buildControlledContractRefactorPlanOperation(request(), {
    resolvedSnapshot: source(90), applyContinuation: "sha256:continuation"
  });
  const snapshot = consumeControlledContractRefactorPlanSnapshot(initial);
  const payload = { ...initial.next_cursor_binding, expires_at: Date.now() + 60_000 };
  await assert.rejects(queryControlledContractRefactorPlan({
    resourceIdentity: initial.resource_identity, selector: null,
    authenticatedCursorPayload: { ...payload, snapshot_digest: "sha256:wrong" }
  }, { snapshot }), (error) => error.code === "controlled_contract_refactor_cursor_stale");
  await assert.rejects(queryControlledContractRefactorPlan({
    resourceIdentity: initial.resource_identity, selector: null,
    authenticatedCursorPayload: payload
  }, { snapshot, resolveCurrent: async () => ({ generation: "G-2",
    manifestDigest: "sha256:other" }) }),
  (error) => error.code === "controlled_contract_refactor_plan_stale");
});

test("replace conflict final page returns plan finalization rather than apply", async () => {
  const input = { ...request(), mode: { kind: "replace_subgraph", reason: "replace",
    correspondence: [{ old_identity: "P-old", new_identities: ["P-new"] }],
    carrier_operations: [{ carrier_kind: "contract", operations: [
      { op: "remove", target: "propositions", id: "P-old" },
      { op: "upsert", target: "propositions", id: "P-new",
        value: { proposition_id: "P-new", modality: "must", text: "replacement" } },
      { op: "upsert", target: "claims", id: "C-000",
        value: { claim_id: "C-000", proposition_id: "P-new" } }
    ] }] } };
  const publicConflict = { conflict_id: "sha256:conflict", kind: "changed",
    old_identity: { id: "old" }, current_identity: { id: "new" },
    allowed_dispositions: ["replace", "remove"] };
  const plan = { family: "obligation", conflictSetIdentity: "sha256:set",
    currentnessDigest: "sha256:current", conflictDigest: "sha256:conflicts",
    entries: [{ public: publicConflict }], safeRows: [] };
  const result = await buildControlledContractRefactorPlanOperation(input, {
    resolvedSnapshot: source(), coveragePlanSet: { obligation: plan, acceptance: null }
  });
  assert.equal(result.counts.remaining, 0);
  assert.equal(result.final_action.operation,
    "workspace_controlled_contract_refactor_plan");
  assert.equal(result.final_action.arguments.conflict_set_identity,
    consumeControlledContractRefactorPlanSnapshot(result).conflictSetIdentity);
});

test("planning refuses package-reported unresolved live identities with exact recovery", async () => {
  const corrupted = source();
  corrupted.liveCarriers[0].content.claims[0].proposition_id = "P-missing";
  await assert.rejects(buildControlledContractRefactorPlanOperation(request(), {
    resolvedSnapshot: corrupted, applyContinuation: "sha256:continuation"
  }), (error) => error.code === "controlled_contract_refactor_closure_incomplete" &&
    error.details.deciding_facts.some(({ field, value }) =>
      field === "unresolved_identities" && value.includes("P-missing")) &&
    error.details.recovery.operation === "workspace_controlled_contract_refactor_plan");
});

test("stale-plan recovery emits exactly one executable currentness precondition", async () => {
  let refusal;
  await assert.rejects(buildControlledContractRefactorPlanOperation({ ...request(),
    expectedGeneration: "G-stale" }, { resolvedSnapshot: source() }), (error) => {
    refusal = error;
    return error.code === "controlled_contract_refactor_plan_stale";
  });
  const recovery = refusal.details.recovery;
  assert.equal(recovery.operation, "workspace_controlled_contract_refactor_plan");
  assert.equal(Object.hasOwn(recovery.arguments, "expected_generation"), true);
  assert.equal(Object.hasOwn(recovery.arguments, "expected_manifest_digest"), false);
  const recovered = await buildControlledContractRefactorPlanOperation({ ...request(),
    expectedGeneration: recovery.arguments.expected_generation }, {
    resolvedSnapshot: source(), applyContinuation: "sha256:continuation"
  });
  assert.equal(recovered.source.generation, "G-1");
});
