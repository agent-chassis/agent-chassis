import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createExactSliceReviewReceipt,
  createExactSliceReviewReceiptStore,
  digestTrustedExactReviewEvidence,
  reviseExactSliceReviewReceipt
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-receipt.mjs";
import { identityDigest } from
  "../../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-receipt-transitions.mjs";
import { buildWorkspaceAgentResultModeEnvelope } from
  "../../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-result-mode.mjs";

const sha = "a".repeat(40);

function generation(hex) {
  return { generation_digest: `sha256:${hex.repeat(64)}`, manifest_digest: `sha256:${hex.repeat(64)}` };
}

function receipt({ label, generationHex, contractVersion }) {
  const unit = "WK-2321#SLICE-010";
  const canonicalSourceDigest = `sha256:${contractVersion.repeat(64)}`;
  const identityBody = {
    schema_version: "canonical-standalone-findings-review-binding.v1",
    unit_address: unit,
    initiative: "IN-0040",
    record_id: "WK-2321",
    slice_id: "SLICE-010",
    repository_path: "/workspace",
    target_ref: "refs/heads/main",
    target_sha: sha,
    worktree_path: "/workspace",
    canonical_source_digest: canonicalSourceDigest
  };
  const committedTargetDigest = digestTrustedExactReviewEvidence(identityBody);
  const worktreeIdentity = { ...identityBody, committed_target_digest: committedTargetDigest };
  const target = {
    unit_address: unit,
    record_id: "WK-2321",
    slice_id: "SLICE-010",
    initiative: "IN-0040",
    review_admission_kind: "standalone_findings",
    target_ref: "refs/heads/main",
    committed_target_digest: committedTargetDigest,
    reviewed_sha: sha,
    diff_base_sha: sha
  };
  const currentGeneration = generation(generationHex);
  const dispatchId = `review-dispatch-${label}`;
  const canonicalContract = JSON.stringify({ id: "WK-2321", version: contractVersion });
  const sliceContract = JSON.stringify({ id: "SLICE-010", version: contractVersion });
  return createExactSliceReviewReceipt({
    unit_address: unit,
    record_id: "WK-2321",
    slice_id: "SLICE-010",
    initiative: "IN-0040",
    canonical_parent_wk_contract: canonicalContract,
    canonical_parent_contract_digest: digestTrustedExactReviewEvidence(canonicalContract),
    slice_review_contract: sliceContract,
    slice_review_contract_digest: digestTrustedExactReviewEvidence(sliceContract),
    review_admission_kind: "standalone_findings",
    committed_target_digest: committedTargetDigest,
    review_run_id: `review-run-${label}`,
    review_monitor_handle: `review-monitor-${label}`,
    reviewer_role: "reviewer",
    slice_ref: "refs/heads/main",
    worktree_path: "/workspace",
    worktree_identity: worktreeIdentity,
    worktree_identity_digest: digestTrustedExactReviewEvidence(worktreeIdentity),
    reviewed_sha: sha,
    diff_base_sha: sha,
    terminal_run_status: "launching",
    structured_outcome: null,
    verdict_evidence: "pending",
    review_dispatch_identity: {
      schema_version: "workspace-agent-review-dispatch-identity.v1",
      kind: "review_dispatch",
      review_dispatch_id: dispatchId,
      target,
      current_generation: currentGeneration
    },
    attempt_lineage_identity: {
      schema_version: "workspace-agent-attempt-lineage-identity.v1",
      kind: "attempt_lineage",
      review_dispatch_id: dispatchId,
      attempt_id: `attempt-lineage-${label}`,
      attempt_number: 1,
      target,
      current_generation: currentGeneration,
      run_id: `review-run-${label}`,
      monitor_handle: `review-monitor-${label}`
    },
    recovery_transition_identity: null
  });
}

function decision(prior, replacement) {
  return Object.freeze({
    schema_version: "workspace-agent-reviewer-generation-correction-decision.v1",
    decision: "eligible",
    owner: "reviewerLineageBinder",
    authority: "launcher_authenticated_lifecycle_facts",
    prior_identity_digest: identityDigest(prior),
    replacement_identity_digest: identityDigest(replacement),
    lifecycle_facts: Object.freeze({
      launch_state: "not_started",
      reviewer_child_created: false,
      terminal_child_fact: false,
      settled_result: false,
      downstream_authority_granted: false
    })
  });
}

async function fixture(t, name) {
  const root = await mkdtemp(path.join(os.tmpdir(), `${name}-`));
  t.after(() => rm(root, { recursive: true, force: true }));
  const options = { ensureRuntimeStateDir: async () => ({ ok: true, dir: root }) };
  return { root, options, store: createExactSliceReviewReceiptStore(options) };
}

test("WK-2321 correction CAS elects one winner and cold replay preserves immutable retirement", async (t) => {
  const { options, store } = await fixture(t, "wk2321-correction-cas");
  const prior = receipt({ label: "prior", generationHex: "1", contractVersion: "1" });
  const left = receipt({ label: "left", generationHex: "2", contractVersion: "2" });
  const right = receipt({ label: "right", generationHex: "2", contractVersion: "2" });
  await store.persist(prior);
  const priorBytes = JSON.stringify(await store.load({
    unit_address: prior.unit_address,
    review_run_id: prior.review_run_id
  }));

  const outcomes = await Promise.all([left, right].map((replacement) =>
    store.retireAndElectReplacement({
      prior_receipt: prior,
      replacement_receipt: replacement,
      lineage_decision: decision(prior, replacement)
    })));
  assert.equal(outcomes.filter((outcome) => outcome.kind === "elected").length, 1);
  assert.equal(outcomes.filter((outcome) => outcome.kind === "resume").length, 1);
  assert.equal(new Set(outcomes.map((outcome) => outcome.receipt.review_run_id)).size, 1);
  const winner = outcomes[0].receipt;
  assert.equal(JSON.stringify(await store.load({
    unit_address: prior.unit_address,
    review_run_id: prior.review_run_id
  })), priorBytes, "retirement never revises the stale receipt");
  assert.equal((await store.loadAll({ unit_address: prior.unit_address })).length, 2,
    "one stale lineage and one corrected lineage are durable");
  for (const loser of [left, right].filter((candidate) =>
    candidate.review_run_id !== winner.review_run_id)) {
    assert.equal(await store.load({
      unit_address: loser.unit_address,
      review_run_id: loser.review_run_id
    }), null, "a losing reservation leaves no receipt selector behind");
  }

  const retirementBytes = JSON.stringify(await store.loadAttemptRetirement({ receipt: prior }));
  const restarted = createExactSliceReviewReceiptStore(options);
  const replayCandidate = receipt({ label: "replay", generationHex: "2", contractVersion: "2" });
  const replay = await restarted.retireAndElectReplacement({
    prior_receipt: prior,
    replacement_receipt: replayCandidate,
    lineage_decision: decision(prior, replayCandidate)
  });
  assert.equal(replay.kind, "resume");
  assert.equal(replay.receipt.review_run_id, winner.review_run_id);
  assert.equal(JSON.stringify(await restarted.loadAttemptRetirement({ receipt: prior })),
    retirementBytes, "cold replay cannot rewrite retirement evidence");
  assert.equal((await restarted.loadAll({ unit_address: prior.unit_address })).length, 2,
    "cold replay creates neither a duplicate child lineage nor a leaked reservation");
});

test("WK-2321 crash after retirement publication replays the embedded corrected winner", async (t) => {
  const { root } = await fixture(t, "wk2321-correction-crash");
  let crash = true;
  const crashingStore = createExactSliceReviewReceiptStore({
    ensureRuntimeStateDir: async () => ({ ok: true, dir: root }),
    faultInjector: async (boundary) => {
      if (crash && boundary === "attempt_retirement_published") {
        crash = false;
        throw new Error("simulated-cold-restart");
      }
    }
  });
  const prior = receipt({ label: "crash-prior", generationHex: "3", contractVersion: "3" });
  const replacement = receipt({ label: "crash-winner", generationHex: "4", contractVersion: "4" });
  await crashingStore.persist(prior);
  await assert.rejects(crashingStore.retireAndElectReplacement({
    prior_receipt: prior,
    replacement_receipt: replacement,
    lineage_decision: decision(prior, replacement)
  }), /simulated-cold-restart/u);

  const restarted = createExactSliceReviewReceiptStore({
    ensureRuntimeStateDir: async () => ({ ok: true, dir: root })
  });
  const contender = receipt({ label: "crash-contender", generationHex: "4", contractVersion: "4" });
  const replay = await restarted.retireAndElectReplacement({
    prior_receipt: prior,
    replacement_receipt: contender,
    lineage_decision: decision(prior, contender)
  });
  assert.equal(replay.kind, "resume");
  assert.equal(replay.receipt.review_run_id, replacement.review_run_id);
  const retirementBytes = JSON.stringify(await restarted.loadAttemptRetirement({ receipt: prior }));
  const continued = receipt({ label: "crash-continued", generationHex: "4", contractVersion: "4" });
  const reElected = await restarted.retireAndElectReplacement({
    prior_receipt: replay.receipt,
    replacement_receipt: continued,
    lineage_decision: decision(replay.receipt, continued)
  });
  assert.equal(reElected.kind, "elected");
  assert.equal(reElected.receipt.review_run_id, continued.review_run_id);
  assert.equal((await restarted.loadAll({ unit_address: prior.unit_address })).length, 3);
  assert.equal(JSON.stringify(await restarted.loadAttemptRetirement({ receipt: prior })),
    retirementBytes, "re-election leaves the first retirement byte-immutable");
  assert.ok(await restarted.loadAttemptRetirement({ receipt: replay.receipt }),
    "the abandoned embedded winner is retired without rewriting it");
});

test("WK-2321 same-generation re-election is limited to an embedded corrected winner", async (t) => {
  const { store } = await fixture(t, "wk2321-correction-replay-authority");
  const prior = receipt({ label: "current-prior", generationHex: "7", contractVersion: "7" });
  const peer = receipt({ label: "current-peer", generationHex: "7", contractVersion: "7" });
  await store.persist(prior);
  await assert.rejects(store.retireAndElectReplacement({
    prior_receipt: prior,
    replacement_receipt: peer,
    lineage_decision: decision(prior, peer)
  }), /preserves the stale contract/u);
  assert.equal(await store.loadAttemptRetirement({ receipt: prior }), null);
  assert.equal(await store.load({
    unit_address: peer.unit_address,
    review_run_id: peer.review_run_id
  }), null);
});

test("WK-2321 store lock refuses settled, terminal-fact, and downstream-authority races", async (t) => {
  for (const state of ["settled", "terminal_fact", "downstream_authority"]) {
    const { store } = await fixture(t, `wk2321-${state}`);
    const prior = receipt({ label: `${state}-prior`, generationHex: "5", contractVersion: "5" });
    const replacement = receipt({ label: `${state}-replacement`, generationHex: "6", contractVersion: "6" });
    await store.persist(prior);
    if (state === "settled") {
      await store.persist(reviseExactSliceReviewReceipt(prior, {
        terminal_run_status: "failed",
        result_mode: buildWorkspaceAgentResultModeEnvelope({ mode: "runtime_failure" }),
        verdict_evidence: "no_verdict_launch_failed"
      }));
    } else if (state === "terminal_fact") {
      const terminal = reviseExactSliceReviewReceipt(prior, {
        terminal_run_status: "failed",
        result_mode: buildWorkspaceAgentResultModeEnvelope({ mode: "runtime_failure" }),
        verdict_evidence: "no_verdict_child_terminal"
      });
      await store.persistTerminalRunResult({
        receipt: terminal,
        repository_path: "/workspace",
        final_result: {
          kind: "missing_result",
          result_mode: buildWorkspaceAgentResultModeEnvelope({ mode: "runtime_failure" })
        }
      });
    } else {
      await store.persistTerminalSettlementConflict({
        receipt: prior,
        conflict: { conflict_class: "stale_contract_generation", conflict_detail: null }
      });
    }
    await assert.rejects(store.retireAndElectReplacement({
      prior_receipt: prior,
      replacement_receipt: replacement,
      lineage_decision: decision(prior, replacement)
    }), (error) => error?.code === "contract_moved" &&
      error.contract_moved_state === ({
        settled: "settled_result",
        terminal_fact: "terminal_child_fact",
        downstream_authority: "downstream_authority_granted"
      })[state]);
    assert.equal(await store.loadAttemptRetirement({ receipt: prior }), null);
    assert.equal(await store.load({
      unit_address: replacement.unit_address,
      review_run_id: replacement.review_run_id
    }), null);
  }
});
