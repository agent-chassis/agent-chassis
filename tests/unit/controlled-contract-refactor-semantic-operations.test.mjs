import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildControlledContractRefactorPlanOperation,
  finalizeControlledContractRefactorPlanOperation,
  loadControlledContractRefactorPlanSnapshot,
  queryControlledContractRefactorPlan
} from "../../packages/wiki-core/src/operations/controlled-contract/refactor-semantic-operations.mjs";
import { readControlledContractRefactorResource,
  retainControlledContractRefactorResource } from
  "../../packages/wiki-core/src/lib/controlled-contract-refactor-staging.mjs";

async function repository(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "wk2504-refactor-semantic-"));
  await mkdir(path.join(root, "wiki", "contracts"), { recursive: true });
  await mkdir(path.join(root, "wiki", "work-records"), { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function source(referenceCount = 1) {
  return { generation: "G-1", manifestDigest: "sha256:manifest",
    liveCarriers: [{ carrier_kind: "contract", generation_id: "G-1",
      content: {
        propositions: [{ proposition_id: "P-old", modality: "must", text: "x" }],
        claims: Array.from({ length: referenceCount }, (_, index) => ({
          claim_id: `C-${String(index).padStart(3, "0")}`,
          proposition_id: "P-old"
        }))
      } }],
    obligationFacts: null, acceptanceCarrier: null };
}

function request(repoRoot) {
  return { repoRoot, wkId: "WK-2470", focus: null,
    expectedGeneration: "G-1", expectedManifestDigest: undefined,
    mode: { kind: "rename_identity", old_identity: "P-old",
      new_identity: "P-new" } };
}

async function retainedSnapshot(repoRoot, result) {
  return loadControlledContractRefactorPlanSnapshot({ repoRoot,
    planIdentity: result.resource_identity });
}

test("default plan is compact and selected pages are deterministic and lossless", async (t) => {
  const repoRoot = await repository(t);
  const first = await buildControlledContractRefactorPlanOperation(request(repoRoot), {
    resolvedSnapshot: source(90), applyContinuation: "sha256:continuation"
  });
  assert.equal(first.counts.returned, 0);
  assert.equal(first.items.length, 0);
  assert.ok(first.counts.complete > 64);
  assert.ok(Buffer.byteLength(JSON.stringify(first), "utf8") < 16_384);
  const snapshot = await retainedSnapshot(repoRoot, first);
  const selector = { kind: "affected_identity", stable_id: null };
  const firstSelected = await queryControlledContractRefactorPlan({ repoRoot,
    resourceIdentity: first.resource_identity, selector,
    authenticatedCursorPayload: { resource_kind: "plan",
      resource_identity: first.resource_identity,
      snapshot_digest: first.snapshot_digest, selector, offset: 0, page_size: 64 }
  }, { snapshot, resolveCurrent: async () => source() });
  assert.equal(firstSelected.counts.returned, 2);
  assert.equal(firstSelected.counts.remaining, 0);
  const all = firstSelected.items;
  assert.deepEqual(all.map(({ kind, stable_id }) => `${kind}\0${stable_id}`),
    all.map(({ kind, stable_id }) => `${kind}\0${stable_id}`).sort());
});

test("greater-than-1-MiB prospective state stays retained while public plan size is flat",
  async (t) => {
    const repoRoot = await repository(t);
    const small = await buildControlledContractRefactorPlanOperation(request(repoRoot), {
      resolvedSnapshot: source(3), applyContinuation: "sha256:continuation"
    });
    const largeSource = source(1);
    largeSource.liveCarriers[0].content.propositions[0].text = "x".repeat(700_000);
    const large = await buildControlledContractRefactorPlanOperation(request(repoRoot), {
      resolvedSnapshot: largeSource, applyContinuation: "sha256:continuation"
    });
    const retained = await readControlledContractRefactorResource({ repoRoot,
      identity: large.resource_identity, expectedKind: "plan" });
    const retainedBytes = Buffer.byteLength(JSON.stringify(retained.payload), "utf8");
    const smallBytes = Buffer.byteLength(JSON.stringify(small), "utf8");
    const largeBytes = Buffer.byteLength(JSON.stringify(large), "utf8");
    t.diagnostic(JSON.stringify({ retained_bytes: retainedBytes,
      compact_small_bytes: smallBytes, compact_large_bytes: largeBytes }));
    assert.ok(retainedBytes > 1_048_576, `retained ${retainedBytes} bytes`);
    assert.ok(smallBytes < 16_384);
    assert.ok(largeBytes < 16_384);
    assert.ok(Math.abs(largeBytes - smallBytes) < 1_024,
      `public sizes ${smallBytes}/${largeBytes}`);
    assert.equal(large.items.length, 0);

    assert.equal(large.final_action, null);
    assert.doesNotMatch(JSON.stringify(large), /package_result/u);
  });

test("explicit selectors support zero and one item after restart-style reload", async (t) => {
  const repoRoot = await repository(t);
  const initial = await buildControlledContractRefactorPlanOperation(request(repoRoot), {
    resolvedSnapshot: source(), applyContinuation: "sha256:continuation"
  });
  const snapshot = await retainedSnapshot(repoRoot, initial);
  for (const [stableId, expected] of [["absent", 0], ["contract", 1]]) {
    const selector = { kind: "carrier", stable_id: stableId };
    const page = await queryControlledContractRefactorPlan({ repoRoot,
      resourceIdentity: initial.resource_identity, selector,
      authenticatedCursorPayload: { resource_kind: "plan",
        resource_identity: initial.resource_identity,
        snapshot_digest: initial.snapshot_digest, selector,
        offset: 0, page_size: 64 }
    }, { snapshot, resolveCurrent: async () => source() });
    assert.equal(page.counts.returned, expected);
  }
});

test("wrong snapshot and changed current generation refuse before mutation", async (t) => {
  const repoRoot = await repository(t);
  const initial = await buildControlledContractRefactorPlanOperation(request(repoRoot), {
    resolvedSnapshot: source(90), applyContinuation: "sha256:continuation"
  });
  const snapshot = await retainedSnapshot(repoRoot, initial);
  const selector = { kind: "affected_identity", stable_id: null };
  const payload = { resource_kind: "plan", resource_identity: initial.resource_identity,
    snapshot_digest: initial.snapshot_digest, selector, offset: 0, page_size: 64 };
  await assert.rejects(queryControlledContractRefactorPlan({ repoRoot,
    resourceIdentity: initial.resource_identity, selector,
    authenticatedCursorPayload: { ...payload, snapshot_digest: "sha256:wrong" }
  }, { snapshot }), { code: "controlled_contract_refactor_cursor_stale" });
  await assert.rejects(queryControlledContractRefactorPlan({ repoRoot,
    resourceIdentity: initial.resource_identity, selector,
    authenticatedCursorPayload: payload
  }, { snapshot, resolveCurrent: async () => ({ generation: "G-2",
    manifestDigest: "sha256:other" }) }),
  { code: "controlled_contract_refactor_plan_stale" });
});

test("replace conflict summary returns finalization without exposing retained mode", async (t) => {
  const repoRoot = await repository(t);
  const input = { ...request(repoRoot), mode: { kind: "replace_subgraph",
    reason: "replace", correspondence: [{ old_identity: "P-old",
      new_identities: ["P-new"] }], carrier_operations: [{ carrier_kind: "contract",
      operations: [{ op: "remove", target: "propositions", id: "P-old" },
        { op: "upsert", target: "propositions", id: "P-new",
          value: { proposition_id: "P-new", modality: "must", text: "replacement" } },
        { op: "upsert", target: "claims", id: "C-000",
          value: { claim_id: "C-000", proposition_id: "P-new" } }] }] } };
  const publicConflict = { conflict_id: "sha256:conflict", kind: "changed",
    old_identity: { id: "old" }, current_identity: { id: "new" },
    allowed_dispositions: ["replace", "remove"] };
  const plan = { family: "obligation", conflictSetIdentity: "sha256:set",
    currentnessDigest: "sha256:current", conflictDigest: "sha256:conflicts",
    entries: [{ public: publicConflict }], safeRows: [] };
  const result = await buildControlledContractRefactorPlanOperation(input, {
    resolvedSnapshot: source(), coveragePlanSet: { obligation: plan, acceptance: null }
  });
  const snapshot = await retainedSnapshot(repoRoot, result);
  assert.equal(Object.hasOwn(result, "mode"), false);
  assert.equal(result.items.length, 0);

  assert.equal(result.final_action, null);
  assert.match(snapshot.conflictSetIdentity, /^sha256:[0-9a-f]{64}$/u);

  const frozenSnapshot = Object.freeze({ ...snapshot,
    plans: Object.freeze({ obligation: null, acceptance: null }),
    conflictSetIdentity: "sha256:frozen-finalization" });
  const finalized = await finalizeControlledContractRefactorPlanOperation({ repoRoot,
    wkId: "WK-2470", focus: null, planIdentity: result.resource_identity,
    conflictSetIdentity: frozenSnapshot.conflictSetIdentity,
    obligationDispositions: [], acceptanceDispositions: []
  }, { snapshot: frozenSnapshot, resolveCurrent: async () => ({ generation: "G-1",
    manifestDigest: "sha256:manifest" }),
  issueApplyContinuation: async () => ({ identity: "sha256:apply",
    transaction_identity: "sha256:transaction" }) });
  assert.equal(finalized.status, "finalized");
  assert.equal(finalized.final_action, null);
  const reloaded = await retainedSnapshot(repoRoot, result);
  assert.equal(reloaded.finalized, true);
  assert.equal(reloaded.applyContinuation, "sha256:apply");
});

test("planning refuses unresolved identities and stale recovery never echoes mode", async (t) => {
  const repoRoot = await repository(t);
  const corrupted = source();
  corrupted.liveCarriers[0].content.claims[0].proposition_id = "P-missing";
  await assert.rejects(buildControlledContractRefactorPlanOperation(request(repoRoot), {
    resolvedSnapshot: corrupted, applyContinuation: "sha256:continuation"
  }), (error) => error.code === "controlled_contract_refactor_closure_incomplete");
  let refusal;
  await assert.rejects(buildControlledContractRefactorPlanOperation({
    ...request(repoRoot), expectedGeneration: "G-stale"
  }, { resolvedSnapshot: source() }), (error) => { refusal = error; return true; });
  assert.equal(refusal.details.recovery, null);
  assert.doesNotMatch(JSON.stringify(refusal.details), /"mode"/u);
});

test("planning delegates an ungrounded external test selector before staging", async (t) => {
  const repoRoot = await repository(t);
  const invalid = source();

  invalid.liveCarriers[0].content.test_proofs = [{
    test_proof_id: "test-proof-c-000",
    verification_claim_id: "C-000",
    test_selector: { name: "declared assertion", nesting: -1 }
  }];
  await assert.rejects(buildControlledContractRefactorPlanOperation(
    request(repoRoot), { resolvedSnapshot: invalid }
  ), (error) => error.code === "controlled_contract_refactor_external_selector_invalid" &&
    error.details.owner === "projectStableTestProofSelector" &&
    error.details.recovery === null);
  await assert.rejects(readdir(path.join(repoRoot, ".agent-runs",
    "controlled-contract-refactor-staging", "v1")), { code: "ENOENT" });
});

test("retained resources expire, authenticate bytes, and remain repository-confined",
  async (t) => {
    const repoRoot = await repository(t);
    const otherRoot = await repository(t);
    const retained = await retainControlledContractRefactorResource({ repoRoot,
      resourceKind: "plan", payload: { marker: "immutable" }, now: 100, ttlMs: 10 });
    assert.equal(await readControlledContractRefactorResource({ repoRoot: otherRoot,
      identity: retained.identity, expectedKind: "plan", now: 105 }), null);
    await assert.rejects(readControlledContractRefactorResource({ repoRoot,
      identity: retained.identity, expectedKind: "plan", now: 111 }),
    { code: "controlled_contract_refactor_staging_expired" });

    const current = await retainControlledContractRefactorResource({ repoRoot,
      resourceKind: "plan", payload: { marker: "authenticated" } });
    const filename = path.join(repoRoot, ".agent-runs",
      "controlled-contract-refactor-staging", "v1",
      `${current.identity.slice(7)}.json`);
    await writeFile(filename, "{}\n", "utf8");
    await assert.rejects(readControlledContractRefactorResource({ repoRoot,
      identity: current.identity, expectedKind: "plan" }),
    { code: "controlled_contract_refactor_staging_tampered" });
  });
