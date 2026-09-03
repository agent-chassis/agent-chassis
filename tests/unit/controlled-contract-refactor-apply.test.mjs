import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  setCanonicalAuthoringPublisherHookForTest,
  settleControlledContractRefactorTransaction
} from "../../packages/wiki-core/src/lib/controlled-contract-carrier-set-publication.mjs";
import {
  rememberControlledContractRefactorContinuation,
  updateControlledContractRefactorContinuation
} from "../../packages/wiki-core/src/lib/controlled-contract-authoring-continuations.mjs";
import { queryControlledContractRefactorReceipt } from
  "../../packages/wiki-core/src/operations/controlled-contract/refactor-operations.mjs";
import { prepareControlledContractRefactorCoverageSettlement } from
  "../../packages/wiki-core/src/operations/controlled-contract/acceptance-coverage-operations.mjs";
import { controlledContractContentDigest } from
  "../../packages/wiki-core/src/lib/controlled-contract-tools.mjs";

test("claim-atomic-settlement-verification commits in order and finalizes before receipt", async (t) => {
  t.after(() => setCanonicalAuthoringPublisherHookForTest(null));
  const trace = [];
  const participant = (name, { terminal = false } = {}) => ({ name, terminal,
    prepare: async () => ({ terminal,
      commit: async () => { trace.push(`commit:${name}`); return { name }; },
      compensate: async () => { trace.push(`compensate:${name}`); },
      ...(terminal ? {} : { finalize: async () => { trace.push(`finalize:${name}`); } })
    }) });
  const result = await settleControlledContractRefactorTransaction({
    assertSourceLease: async () => trace.push("lease"),
    participants: [participant("coverage"), participant("generation"),
      participant("receipt", { terminal: true })]
  });
  assert.equal(result.status, "committed");
  assert.ok(trace.indexOf("commit:generation") < trace.indexOf("finalize:generation"));
  assert.ok(trace.indexOf("commit:receipt") < trace.indexOf("finalize:coverage"));
  assert.deepEqual(result.committed_participants,
    ["coverage", "generation", "receipt"]);
});

test("claim-atomic-settlement-verification compensates every prepared owner in exact reverse order", async (t) => {
  t.after(() => setCanonicalAuthoringPublisherHookForTest(null));
  for (const failedParticipant of ["coverage", "generation"]) {
    const compensated = [];
    setCanonicalAuthoringPublisherHookForTest(async (boundary, details) => {
      if (boundary === "refactor_commit" && details.participant === failedParticipant) {
        const error = new Error("injected"); error.code = `injected_${failedParticipant}`;
        throw error;
      }
    });
    const participants = ["coverage", "generation", "receipt"].map((name, index) => ({
      name, terminal: index === 2, prepare: async () => ({
        commit: async () => ({ name }),
        compensate: async () => compensated.push(name)
      })
    }));
    await assert.rejects(settleControlledContractRefactorTransaction({
      assertSourceLease: async () => {}, participants
    }), { code: `injected_${failedParticipant}` });
    assert.deepEqual(compensated, ["receipt", "generation", "coverage"]);
  }
});

async function repository(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "wk2470-refactor-"));
  await mkdir(path.join(root, "wiki", "contracts"), { recursive: true });
  await mkdir(path.join(root, "wiki", "work-records"), { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("immutable receipt settlement survives restart-style lookup and pages losslessly", async (t) => {
  const repoRoot = await repository(t);
  const planned = await rememberControlledContractRefactorContinuation({
    repoRoot, wkId: "WK-2470", contractContentDigest: `sha256:${"1".repeat(64)}`,
    packageGeneration: "1.0.0",
    source: { generation: "old", manifest_digest: `sha256:${"2".repeat(64)}` },
    planIdentity: `sha256:${"3".repeat(64)}`,
    snapshotDigest: `sha256:${"4".repeat(64)}`,
    packageResult: { schema_version: "controlled-contract-refactor-graph.v1",
      result_digest: `sha256:${"5".repeat(64)}` },
    coverage: { obligation: null, acceptance: null },
    sourceLease: { generation: "old", manifest_digest: `sha256:${"2".repeat(64)}` }
  });
  const receipt = { schema_version: "controlled-contract-refactor-receipt.v1",
    source: { generation: "old" }, target: { generation: "new" },
    mode: "rename_identity", outcome: "written",
    snapshot_digest: `sha256:${"6".repeat(64)}`,
    carrier_changes: [{ carrier_kind: "contract", filename: "contract.json",
      source_content_digest: `sha256:${"7".repeat(64)}`,
      prospective_content_digest: `sha256:${"8".repeat(64)}` }],
    coverage_changes: [], correspondence: [{ old_identity: "P-1",
      new_identities: ["P-2"] }], invalidated_derived: [], proof_gaps: [],
    package: { schema_version: "controlled-contract-refactor-graph.v1",
      result_digest: `sha256:${"5".repeat(64)}`, package_generation: "1.0.0" },
    counts: { carrier_changes: 1, coverage_changes: 0, correspondence: 1,
      invalidated_derived: 0, proof_gaps: 0 } };
  const published = await updateControlledContractRefactorContinuation({
    repoRoot, wkId: "WK-2470", identity: planned.identity,
    changes: { status: "published", receipt }
  });
  const first = await queryControlledContractRefactorReceipt({ repoRoot,
    resourceIdentity: published.identity, selector: null,
    authenticatedCursorPayload: null });
  assert.equal(first.counts.complete, 2);
  assert.equal(first.counts.returned, 2);
  assert.equal(first.counts.remaining, 0);
  assert.equal(first.resource_identity, published.identity);
});

test("coverage settlement rejects observed presence for an expected-absent source", async (t) => {
  const repoRoot = await repository(t);
  const file = path.join(repoRoot, "wiki", "contracts", "WK-2470.obligation-coverage.json");
  const observed = { obligations: [] };
  await writeFile(file, `${JSON.stringify(observed)}\n`, "utf8");
  const prospective = { obligations: [{ obligation_id: "O-1" }] };
  await assert.rejects(prepareControlledContractRefactorCoverageSettlement({
    input: { repoRoot, wkId: "WK-2470", focus: null },
    coverage: { obligation: { content: prospective, source_content_digest: null,
      prospective_content_digest: controlledContractContentDigest(prospective) },
    acceptance: null }
  }), { code: "obligation_coverage_rebase_stale" });
});

test("coverage settlement refuses a stale planned source binding", async (t) => {
  const repoRoot = await repository(t);
  const file = path.join(repoRoot, "wiki", "contracts", "WK-2470.obligation-coverage.json");
  const observed = { obligations: [] };
  await writeFile(file, `${JSON.stringify(observed)}\n`, "utf8");
  const prospective = { obligations: [{ obligation_id: "O-1" }] };
  await assert.rejects(prepareControlledContractRefactorCoverageSettlement({
    input: { repoRoot, wkId: "WK-2470", focus: null },
    coverage: { obligation: { content: prospective,
      source_content_digest: `sha256:${"0".repeat(64)}`,
      prospective_content_digest: controlledContractContentDigest(prospective) },
    acceptance: null }
  }), { code: "obligation_coverage_rebase_stale" });
});

test("replace_subgraph uses the same ordered atomic settlement", async () => {
  const result = await settleControlledContractRefactorTransaction({
    assertSourceLease: async () => {}, participants: [
      { name: "coverage", prepare: async () => ({
        commit: async () => ({ mode: "replace_subgraph", family: "obligation" }),
        compensate: async () => {}, finalize: async () => {}
      }) },
      { name: "canonical_generation", prepare: async () => ({
        commit: async () => ({ mode: "replace_subgraph", generation: "target" }),
        compensate: async () => {}
      }) },
      { name: "receipt_transition", terminal: true, prepare: async () => ({
        commit: async () => ({ mode: "replace_subgraph", receipt: "settled" }),
        compensate: async () => {}
      }) }
    ]
  });
  assert.equal(result.status, "committed");
  assert.equal(result.receipts.coverage.mode, "replace_subgraph");
  assert.equal(result.receipts.canonical_generation.mode, "replace_subgraph");
  assert.equal(result.receipts.receipt_transition.mode, "replace_subgraph");
});
