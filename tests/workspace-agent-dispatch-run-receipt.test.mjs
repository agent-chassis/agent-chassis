import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

import {
  createExactSliceReviewReceipt,
  createExactSliceReviewReceiptStore,
  digestTrustedExactReviewEvidence,
  receiptCarriesUsableReviewVerdict,
  reviseExactSliceReviewReceipt,
  validateExactSliceReviewReceipt
} from "../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-receipt.mjs";

function receiptFields(overrides = {}) {
  const frozenSlice = {
    id: "SLICE-010",
    work_kind: "implementation",
    status: "review",
    write_scope: ["packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-receipt.mjs"]
  };
  const frozenRecord = {
    id: "WK-1666",
    initiative: "IN-0027",
    status: "active",
    slices: [frozenSlice]
  };
  const canonicalParentContract = JSON.stringify(frozenRecord);
  const sliceReviewContract = JSON.stringify(frozenSlice);
  const fields = {
    unit_address: "WK-1666#SLICE-010",
    record_id: "WK-1666",
    slice_id: "SLICE-010",
    initiative: "IN-0027",
    canonical_parent_wk_contract: canonicalParentContract,
    canonical_parent_contract_digest: digestTrustedExactReviewEvidence(canonicalParentContract),
    slice_review_contract: sliceReviewContract,
    slice_review_contract_digest: digestTrustedExactReviewEvidence(sliceReviewContract),
    source_worker_run_id: "worker-run-1",
    source_worker_monitor_handle: "worker-monitor-1",
    review_run_id: "review-run-1",
    review_monitor_handle: "review-monitor-1",
    reviewer_role: "reviewer",
    slice_ref: "refs/heads/slice/IN-0027/WK-1666/SLICE-010",
    worktree_path: "/tmp/exact-slice-worktree",
    worktree_identity: null,
    worktree_identity_digest: null,
    reviewed_sha: "a".repeat(40),
    diff_base_sha: "b".repeat(40),
    frozen_context_state: "consumed",
    terminal_run_status: "succeeded",
    structured_outcome: {
      outcome: "clean",
      clean_review: true,
      review_result: {
        review_outcome: "no_findings",
        clean_review: true,
        no_findings: true,
        blocking_finding_count: 0,
        medium_finding_count: 0,
        reviewed_controls: []
      }
    },
    proof_state: "unminted",
    ...overrides
  };
  const identity = overrides.worktree_identity ?? {
    schema_version: "worktree-identity-binding.v2",
    launch_ref: fields.source_worker_monitor_handle,
    run_id: `${fields.source_worker_run_id}.slice`,
    retry_id: 0,
    unit_address: `${fields.initiative}/${fields.record_id}/${fields.slice_id}`,
    initiative: fields.initiative,
    record_id: fields.record_id,
    slice_id: fields.slice_id,
    base_ref: `wk/${fields.initiative}/${fields.record_id}`,
    base_sha: fields.diff_base_sha,
    output_branch: `slice/${fields.initiative}/${fields.record_id}/${fields.slice_id}`,
    worktree_path: fields.worktree_path,
    read_scope: ["AGENTS.md"],
    repo_paths: ["packages/agent-launch-cli"],
    write_scope: ["packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-receipt.mjs"],
    write_scope_source: `wiki/work-records/${fields.record_id}.json#${fields.slice_id}`,
    selected_unit: {
      kind: "slice",
      address: fields.unit_address,
      record_id: fields.record_id,
      slice_id: fields.slice_id,
      repo: null
    },
    source_digest: `sha256:${"4".repeat(64)}`,
    source_version: null,
    checkout_mode: "full"
  };
  fields.worktree_identity = identity;
  fields.worktree_identity_digest = overrides.worktree_identity_digest ??
    digestTrustedExactReviewEvidence(identity);
  return fields;
}

const receiptModuleUrl = new URL(
  "../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-receipt.mjs",
  import.meta.url
).href;

function spawnPausedReceiptWriter({ root, receipt, boundary }) {
  const source = `
    const [moduleUrl, root, encoded, boundary] = process.argv.slice(1);
    const { createExactSliceReviewReceiptStore } = await import(moduleUrl);
    let paused = false;
    const store = createExactSliceReviewReceiptStore({
      ensureRuntimeStateDir: async () => ({ ok: true, dir: root }),
      faultInjector: async (observed) => {
        if (!paused && observed === boundary) {
          paused = true;
          process.stdout.write("paused\\n");
          process.stdin.resume();
          const keepalive = setInterval(() => {}, 1000);
          await new Promise((resolve) => process.stdin.once("data", resolve));
          clearInterval(keepalive);
        }
      }
    });
    await store.persist(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")));
  `;
  const child = spawn(process.execPath, [
    "--input-type=module", "-e", source, receiptModuleUrl, root,
    Buffer.from(JSON.stringify(receipt)).toString("base64url"), boundary
  ], { stdio: ["pipe", "pipe", "pipe"] });
  const paused = new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.includes("paused\n")) resolve();
    });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (!stdout.includes("paused\n")) {
        reject(new Error(`receipt child exited before pause: code=${code} signal=${signal} stderr=${stderr}`));
      }
    });
  });
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  return {
    child,
    paused,
    exited,
    resume: () => child.stdin.end("resume\n")
  };
}

test("exact review receipt round-trips by bounded run and monitor selectors", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wk1666-receipt-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createExactSliceReviewReceiptStore({
    workspaceDir: "/workspace",
    ensureRuntimeStateDir: async () => ({ ok: true, dir: root })
  });
  const receipt = createExactSliceReviewReceipt(receiptFields({
    frozen_context_state: "available",
    terminal_run_status: "launching",
    structured_outcome: null,
    verdict_evidence: "pending"
  }));
  await store.persist(receipt);
  assert.deepEqual(await store.load({
    unit_address: receipt.unit_address,
    review_run_id: receipt.review_run_id
  }), receipt);
  assert.deepEqual(await store.load({
    unit_address: receipt.unit_address,
    monitor_handle: receipt.review_monitor_handle
  }), receipt);
  assert.deepEqual(await store.loadLatest(receipt.unit_address), receipt);
});

test("exact receipt replay is idempotent and legacy proof state is immutable inert data", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wk1666-replay-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createExactSliceReviewReceiptStore({
    ensureRuntimeStateDir: async () => ({ ok: true, dir: root })
  });
  const receipt = createExactSliceReviewReceipt(receiptFields({
    frozen_context_state: "available",
    terminal_run_status: "launching",
    structured_outcome: null,
    verdict_evidence: "pending"
  }));
  await store.persist(receipt);
  await store.persist(receipt);
  const running = reviseExactSliceReviewReceipt(receipt, { terminal_run_status: "running" });
  await store.persist(running);
  assert.equal((await store.loadLatest(receipt.unit_address)).proof_state, "unminted");
  assert.equal(running.reviewed_sha, receipt.reviewed_sha);
  assert.equal(running.review_run_id, receipt.review_run_id);
  assert.throws(
    () => reviseExactSliceReviewReceipt(running, { proof_state: "minted" }),
    /cannot change immutable field: proof_state/u
  );
});

test("unknown run and handle selectors return no receipt", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wk1666-unknown-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createExactSliceReviewReceiptStore({
    ensureRuntimeStateDir: async () => ({ ok: true, dir: root })
  });
  assert.equal(await store.load({ unit_address: "WK-1666#SLICE-010", review_run_id: "unknown" }), null);
  assert.equal(await store.load({ unit_address: "WK-1666#SLICE-010", monitor_handle: "unknown" }), null);
});

test("wrong unit and wrong run selectors are rejected", () => {
  const receipt = createExactSliceReviewReceipt(receiptFields({
    frozen_context_state: "available",
    terminal_run_status: "launching",
    structured_outcome: null,
    verdict_evidence: "pending"
  }));
  assert.throws(() => validateExactSliceReviewReceipt(receipt, {
    unit_address: "WK-1666#SLICE-009"
  }), /unit selector mismatch/);
  assert.throws(() => validateExactSliceReviewReceipt(receipt, {
    review_run_id: "sibling-run"
  }), /run selector mismatch/);
});

test("digest-invalid and stale-SHA mutation is rejected", () => {
  const receipt = createExactSliceReviewReceipt(receiptFields());
  assert.throws(() => validateExactSliceReviewReceipt({
    ...receipt,
    reviewed_sha: "c".repeat(40)
  }), /trusted evidence digest mismatch/);
  assert.throws(() => validateExactSliceReviewReceipt({
    ...receipt,
    receipt_digest: `sha256:${"0".repeat(64)}`
  }), /receipt digest mismatch/);
});

test("nonterminal receipt persists consumed frozen context without clean authority", () => {
  const receipt = createExactSliceReviewReceipt(receiptFields({
    terminal_run_status: "running",
    structured_outcome: null
  }));
  assert.equal(receipt.frozen_context_state, "consumed");
  assert.equal(receipt.structured_outcome, null);
});

test("failed, malformed, and prose-only outcomes cannot claim clean review", () => {
  const failed = createExactSliceReviewReceipt(receiptFields({
    terminal_run_status: "failed",
    structured_outcome: null
  }));
  assert.equal(failed.structured_outcome, null);
  assert.throws(() => createExactSliceReviewReceipt(receiptFields({
    structured_outcome: { outcome: "clean", clean_review: false, prose: "looks good" }
  })), /structured_outcome must carry exactly/);
  assert.throws(() => createExactSliceReviewReceipt(receiptFields({
    structured_outcome: { outcome: "changes_requested", findings: [] }
  })), /structured_outcome must carry exactly/);
});

test("changes_requested receipt carries exact trusted corrective findings only", () => {
  const receipt = createExactSliceReviewReceipt(receiptFields({
    structured_outcome: {
      outcome: "changes_requested",
      clean_review: false,
      findings: [{
        id: "F-1",
        title: "Correct this",
        severity: "medium",
        blocking: false,
        affected_paths: [{ path: "packages/example.mjs", line: 10 }]
      }],
      finding_counts: {
        total: 1,
        blocking: 0,
        critical: 0,
        high: 0,
        medium: 1,
        low: 0,
        info: 0
      }
    }
  }));
  assert.equal(receipt.structured_outcome.findings[0].id, "F-1");
  assert.equal(receipt.unit_address, "WK-1666#SLICE-010");
  assert.equal(receipt.review_run_id, "review-run-1");
});

test("receipt event publication survives fault injection at every durability boundary", async (t) => {
  const boundaries = [
    "lock_acquired", "event_temp_created", "event_written", "event_file_synced",
    "event_published", "event_directory_synced"
  ];
  for (const boundary of boundaries) {
    const root = await mkdtemp(path.join(os.tmpdir(), `wk1666-fault-${boundary}-`));
    t.after(() => rm(root, { recursive: true, force: true }));
    const receipt = createExactSliceReviewReceipt(receiptFields());
    const store = createExactSliceReviewReceiptStore({
      ensureRuntimeStateDir: async () => ({ ok: true, dir: root }),
      faultInjector: (observed) => {
        if (observed === boundary) throw new Error(`fault:${boundary}`);
      }
    });
    await assert.rejects(store.persist(receipt), new RegExp(`fault:${boundary}`));
    const recoveredStore = createExactSliceReviewReceiptStore({
      ensureRuntimeStateDir: async () => ({ ok: true, dir: root })
    });
    const recovered = await recoveredStore.load({
      unit_address: receipt.unit_address,
      review_run_id: receipt.review_run_id
    });
    if (boundary === "event_published" || boundary === "event_directory_synced") {
      assert.deepEqual(recovered, receipt);
    } else {
      assert.equal(recovered, null);
    }
  }
});

test("child-process death at every receipt boundary recovers only a published immutable event", async (t) => {
  const boundaries = [
    "lock_acquired", "event_temp_created", "event_written", "event_file_synced",
    "event_published", "event_directory_synced"
  ];
  for (const boundary of boundaries) {
    const root = await mkdtemp(path.join(os.tmpdir(), `wk1666-child-crash-${boundary}-`));
    t.after(() => rm(root, { recursive: true, force: true }));
    const receipt = createExactSliceReviewReceipt(receiptFields());
    const writer = spawnPausedReceiptWriter({ root, receipt, boundary });
    await writer.paused;
    writer.child.kill("SIGKILL");
    const exit = await writer.exited;
    assert.equal(exit.signal, "SIGKILL");

    const restartedStore = createExactSliceReviewReceiptStore({
      ensureRuntimeStateDir: async () => ({ ok: true, dir: root })
    });
    const recovered = await restartedStore.load({
      unit_address: receipt.unit_address,
      review_run_id: receipt.review_run_id
    });
    if (boundary === "event_published" || boundary === "event_directory_synced") {
      assert.deepEqual(recovered, receipt);
    } else {
      assert.equal(recovered, null);
    }
  }
});

test("a stalled live lock owner is never displaced and a killed owner is restart-recoverable", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wk1666-live-lock-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const receipt = createExactSliceReviewReceipt(receiptFields());
  const owner = spawnPausedReceiptWriter({ root, receipt, boundary: "lock_acquired" });
  await owner.paused;

  const contenderStore = createExactSliceReviewReceiptStore({
    ensureRuntimeStateDir: async () => ({ ok: true, dir: root })
  });
  let contenderSettled = false;
  const contender = contenderStore.persist(receipt).finally(() => { contenderSettled = true; });
  await delay(1250);
  assert.equal(contenderSettled, false, "a live stalled owner must retain the lock");

  owner.child.kill("SIGKILL");
  assert.equal((await owner.exited).signal, "SIGKILL");
  await contender;
  assert.deepEqual(await contenderStore.loadLatest(receipt.unit_address), receipt);
});

test("a reader waiting on publication observes the terminal event, never the older nonterminal event", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wk1666-reader-linearization-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createExactSliceReviewReceiptStore({
    ensureRuntimeStateDir: async () => ({ ok: true, dir: root })
  });
  const clean = createExactSliceReviewReceipt(receiptFields());
  const running = createExactSliceReviewReceipt(receiptFields({
    terminal_run_status: "running",
    structured_outcome: null
  }));
  await store.persist(running);
  const terminal = reviseExactSliceReviewReceipt(running, {
    terminal_run_status: "succeeded",
    structured_outcome: clean.structured_outcome
  });
  const writer = spawnPausedReceiptWriter({
    root,
    receipt: terminal,
    boundary: "event_temp_created"
  });
  await writer.paused;

  let readerSettled = false;
  const reader = store.loadLatest(running.unit_address).finally(() => { readerSettled = true; });
  await delay(100);
  assert.equal(readerSettled, false, "reader must serialize behind the active publisher");
  writer.resume();
  assert.deepEqual(await writer.exited, { code: 0, signal: null });
  assert.deepEqual(await reader, terminal);
});

test("concurrent processes cannot publish receipts with a shared selector", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wk1666-process-race-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const left = createExactSliceReviewReceipt(receiptFields());
  const right = createExactSliceReviewReceipt(receiptFields({
    reviewed_sha: "c".repeat(40),
    review_monitor_handle: "review-monitor-conflict"
  }));
  const moduleUrl = new URL("../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-receipt.mjs", import.meta.url).href;
  const source = `
    const [moduleUrl, root, encoded] = process.argv.slice(1);
    const { createExactSliceReviewReceiptStore } = await import(moduleUrl);
    const store = createExactSliceReviewReceiptStore({ ensureRuntimeStateDir: async () => ({ ok: true, dir: root }) });
    try { await store.persist(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"))); process.exit(0); }
    catch { process.exit(23); }
  `;
  const run = (receipt) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", source, moduleUrl, root,
      Buffer.from(JSON.stringify(receipt)).toString("base64url")]);
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  });
  const codes = await Promise.all([run(left), run(right)]);
  assert.deepEqual(codes.sort((a, b) => a - b), [0, 23]);
});

test("selector conflicts and non-monotonic terminal transitions refuse without overwrite", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wk1666-conflicts-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createExactSliceReviewReceiptStore({
    ensureRuntimeStateDir: async () => ({ ok: true, dir: root })
  });
  const receipt = createExactSliceReviewReceipt(receiptFields({
    frozen_context_state: "available",
    terminal_run_status: "launching",
    structured_outcome: null,
    verdict_evidence: "pending"
  }));
  await store.persist(receipt);
  const conflicting = createExactSliceReviewReceipt(receiptFields({
    reviewed_sha: "c".repeat(40),
    review_monitor_handle: "review-monitor-conflict"
  }));
  await assert.rejects(store.persist(conflicting), /conflicts with an existing immutable selector/);
  const clean = receiptFields().structured_outcome;
  const terminal = reviseExactSliceReviewReceipt(receipt, {
    terminal_run_status: "succeeded",
    structured_outcome: clean,
    verdict_evidence: "verdict_recorded"
  });
  await store.persist(terminal);
  const regressed = reviseExactSliceReviewReceipt(receipt, { terminal_run_status: "running" });
  await assert.rejects(store.persist(regressed), /non-monotonic/);
  assert.deepEqual(await store.loadLatest(receipt.unit_address), terminal);
});

test("caller authority fields are outside the exact durable receipt contract", () => {
  assert.throws(() => createExactSliceReviewReceipt(receiptFields({
    proof: { caller_supplied: true }
  })), /forbidden field: proof/);
  assert.throws(() => createExactSliceReviewReceipt(receiptFields({
    attestation: "portfolio-local prose"
  })), /forbidden field: attestation/);
});

function committedReceiptFields({
  runId,
  monitorHandle,
  role = "reviewer",
  outcome = "clean"
}) {
  const base = receiptFields();
  const identityBody = {
    schema_version: "canonical-committed-slice-review-binding.v1",
    unit_address: base.unit_address,
    initiative: base.initiative,
    record_id: base.record_id,
    slice_id: base.slice_id,
    slice_ref: base.slice_ref,
    wk_ref: `refs/heads/wk/${base.initiative}/${base.record_id}`,
    wk_sha: base.diff_base_sha,
    reviewed_sha: base.reviewed_sha,
    diff_base_sha: base.diff_base_sha,
    worktree_path: base.worktree_path,
    changed_paths: ["packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-receipt.mjs"],
    write_scope: ["packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-receipt.mjs"],
    source_digest: `sha256:${"4".repeat(64)}`,
    commit_chain: [base.reviewed_sha]
  };
  const committedTargetDigest = digestTrustedExactReviewEvidence(identityBody);
  const identity = { ...identityBody, committed_target_digest: committedTargetDigest };
  const structuredOutcome = outcome === "clean"
    ? base.structured_outcome
    : {
        outcome: "changes_requested",
        clean_review: false,
        findings: [{
          id: "F-PLURAL",
          title: "Independent finding",
          severity: "high",
          blocking: true,
          affected_paths: [{ path: identityBody.changed_paths[0], line: 1 }]
        }],
        finding_counts: {
          total: 1, blocking: 1, critical: 0, high: 1, medium: 0, low: 0, info: 0
        }
      };
  const fields = {
    ...base,
    review_admission_kind: "canonical_committed_slice",
    committed_target_digest: committedTargetDigest,
    review_run_id: runId,
    review_monitor_handle: monitorHandle,
    reviewer_role: role,
    worktree_identity: identity,
    worktree_identity_digest: digestTrustedExactReviewEvidence(identity),
    structured_outcome: structuredOutcome,
    verdict_evidence: "verdict_recorded"
  };
  delete fields.source_worker_run_id;
  delete fields.source_worker_monitor_handle;
  delete fields.frozen_context_state;
  delete fields.proof_state;
  return fields;
}

test("append-only store retains every exact-target review run independently", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "plural-review-receipts-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createExactSliceReviewReceiptStore({
    ensureRuntimeStateDir: async () => ({ ok: true, dir: root })
  });
  const first = createExactSliceReviewReceipt(committedReceiptFields({
    runId: "plural-review-1",
    monitorHandle: "plural-monitor-1",
    outcome: "clean"
  }));
  const second = createExactSliceReviewReceipt(committedReceiptFields({
    runId: "plural-review-2",
    monitorHandle: "plural-monitor-2",
    outcome: "changes_requested"
  }));
  await Promise.all([store.persist(first), store.persist(second)]);
  const all = await store.loadAll({
    unit_address: first.unit_address,
    committed_target_digest: first.committed_target_digest
  });
  assert.deepEqual(all.map((receipt) => receipt.review_run_id).sort(), [
    "plural-review-1", "plural-review-2"
  ]);
  assert.deepEqual(all.map((receipt) => receipt.structured_outcome.outcome).sort(), [
    "changes_requested", "clean"
  ]);
  assert.equal(Object.hasOwn(first, "proof_state"), false);
  assert.equal(Object.hasOwn(second, "frozen_context_state"), false);
});

test("reviewer and policy-allowed redteam receipts share exact-target binding without selector collision", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "plural-review-roles-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createExactSliceReviewReceiptStore({
    ensureRuntimeStateDir: async () => ({ ok: true, dir: root })
  });
  const reviewer = createExactSliceReviewReceipt(committedReceiptFields({
    runId: "role-reviewer",
    monitorHandle: "role-reviewer-monitor",
    role: "reviewer"
  }));
  const redteam = createExactSliceReviewReceipt(committedReceiptFields({
    runId: "role-redteam",
    monitorHandle: "role-redteam-monitor",
    role: "redteam"
  }));
  await store.persist(reviewer);
  await store.persist(redteam);
  const all = await store.loadAll({
    unit_address: reviewer.unit_address,
    committed_target_digest: reviewer.committed_target_digest
  });
  assert.deepEqual(all.map((receipt) => receipt.reviewer_role).sort(), ["redteam", "reviewer"]);
});

test("loadLatest remains a compatibility projection and never replaces the complete evidence set", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "plural-review-latest-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createExactSliceReviewReceiptStore({
    ensureRuntimeStateDir: async () => ({ ok: true, dir: root })
  });
  const receipts = [
    createExactSliceReviewReceipt(committedReceiptFields({
      runId: "history-review-1", monitorHandle: "history-monitor-1"
    })),
    createExactSliceReviewReceipt(committedReceiptFields({
      runId: "history-review-2", monitorHandle: "history-monitor-2"
    }))
  ];
  for (const receipt of receipts) await store.persist(receipt);
  assert.equal((await store.loadLatest(receipts[0].unit_address)).review_run_id, "history-review-2");
  assert.equal((await store.loadAll({
    unit_address: receipts[0].unit_address,
    committed_target_digest: receipts[0].committed_target_digest
  })).length, 2);
});

test("legacy cleanup-only receipts remain readable but their historical proof field is inert", () => {
  const clean = createExactSliceReviewReceipt(receiptFields({
    terminal_run_status: "failed",
    cleanup_only_terminal_failure: true,
    verdict_evidence: "verdict_recorded",
    proof_state: "minted"
  }));
  assert.equal(clean.terminal_run_status, "failed", "the cleanup failure is not hidden");
  assert.equal(clean.cleanup_only_terminal_failure, true);
  assert.equal(clean.proof_state, "minted");
  assert.equal(receiptCarriesUsableReviewVerdict(clean), true);
  assert.equal(Object.hasOwn(clean, "proof_state"), true,
    "the compatibility field is readable but never becomes runtime authority");

  const withoutDisposition = createExactSliceReviewReceipt(receiptFields({
    terminal_run_status: "succeeded",
    verdict_evidence: "verdict_recorded",
    proof_state: "minted"
  }));
  assert.notEqual(clean.receipt_digest, withoutDisposition.receipt_digest);
});

test("WK-1689#SLICE-004 M-1: a failed receipt WITHOUT the disposition still cannot carry an outcome", () => {
  assert.throws(() => createExactSliceReviewReceipt(receiptFields({
    terminal_run_status: "failed",
    verdict_evidence: "verdict_recorded"
  })), /non-succeeded exact slice review receipt cannot carry a structured outcome/);
  assert.throws(() => createExactSliceReviewReceipt(receiptFields({
    terminal_run_status: "failed",
    verdict_evidence: "verdict_recorded",
    proof_state: "minted"
  })), /non-succeeded exact slice review receipt cannot carry a structured outcome/);
});

test("WK-1689#SLICE-004 M-1: the cleanup-only disposition is closed and failed-only", () => {

  assert.throws(() => createExactSliceReviewReceipt(receiptFields({
    terminal_run_status: "failed",
    cleanup_only_terminal_failure: "true",
    verdict_evidence: "verdict_recorded"
  })), /invalid closed vocabulary/);

  assert.throws(() => createExactSliceReviewReceipt(receiptFields({
    terminal_run_status: "succeeded",
    cleanup_only_terminal_failure: true,
    verdict_evidence: "verdict_recorded"
  })), /cleanup-only exact slice review evidence requires a failed reviewer run/);

  assert.throws(() => createExactSliceReviewReceipt(receiptFields({
    terminal_run_status: "cancelled",
    cleanup_only_terminal_failure: true,
    structured_outcome: null,
    verdict_evidence: "no_verdict_child_terminal"
  })), /cleanup-only exact slice review evidence requires a failed reviewer run/);
});

test("WK-1689#SLICE-004 M-1: a settled cleanup-only disposition can never be withdrawn", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wk1689-m1-cleanup-only-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createExactSliceReviewReceiptStore({
    ensureRuntimeStateDir: async () => ({ ok: true, dir: root })
  });

  const settled = createExactSliceReviewReceipt(receiptFields({
    terminal_run_status: "failed",
    cleanup_only_terminal_failure: true,
    verdict_evidence: "verdict_recorded"
  }));
  await store.persist(settled);

  const withdrawn = {
    ...Object.fromEntries(Object.entries(settled)
      .filter(([field]) => !["cleanup_only_terminal_failure", "schema_version",
        "trusted_evidence_digest", "receipt_digest"].includes(field)))
  };
  assert.throws(
    () => createExactSliceReviewReceipt(withdrawn),
    /cannot carry a structured outcome/,
    "a receipt that drops the disposition cannot even be constructed with its outcome"
  );

  const strippedNoOutcome = createExactSliceReviewReceipt({
    ...withdrawn,
    structured_outcome: null,
    proof_state: "unminted",
    verdict_evidence: "no_verdict_child_terminal"
  });
  await assert.rejects(store.persist(strippedNoOutcome),
    /cannot withdraw its cleanup-only disposition|non-monotonic/);
  assert.deepEqual(await store.loadLatest(settled.unit_address), settled);
});

test("WK-1689#SLICE-004 M-1: a cancelled or non-cleanup failed run is never a usable verdict carrier", () => {
  for (const status of ["failed", "cancelled", "running", "launching"]) {
    assert.equal(
      receiptCarriesUsableReviewVerdict({ terminal_run_status: status }),
      false,
      `${status} without the durable cleanup-only disposition is not usable`
    );
  }
  assert.equal(receiptCarriesUsableReviewVerdict({ terminal_run_status: "succeeded" }), true);
  assert.equal(
    receiptCarriesUsableReviewVerdict({
      terminal_run_status: "cancelled",
      cleanup_only_terminal_failure: true
    }),
    false,
    "the disposition only rescues a FAILED run"
  );
});
