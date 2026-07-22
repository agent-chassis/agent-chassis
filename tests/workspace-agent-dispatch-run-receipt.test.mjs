import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

import {
  createExactSliceReviewReceipt,
  createExactSliceReviewReceiptStore,
  digestTrustedExactReviewEvidence,
  reviseExactSliceReviewReceipt,
  validateExactSliceReviewReceipt
} from "../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-receipt.mjs";
import {
  createWorkspaceAgentDispatchBackend
} from "../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend.mjs";
import {
  AGENT_ROLE_RESULT_REVIEWED_CONTROLS
} from "../packages/agent-launch-core/src/lib/agent-role-result.mjs";
import { canonicalizeWorkRecordJson } from "../packages/wiki-core/src/index.mjs";

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
  const receipt = createExactSliceReviewReceipt(receiptFields());
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

test("exact receipt replay is idempotent and revision preserves trusted bindings", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wk1666-replay-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createExactSliceReviewReceiptStore({
    ensureRuntimeStateDir: async () => ({ ok: true, dir: root })
  });
  const receipt = createExactSliceReviewReceipt(receiptFields());
  await store.persist(receipt);
  await store.persist(receipt);
  const minted = reviseExactSliceReviewReceipt(receipt, { proof_state: "minted" });
  await store.persist(minted);
  assert.equal((await store.loadLatest(receipt.unit_address)).proof_state, "minted");
  assert.equal(minted.reviewed_sha, receipt.reviewed_sha);
  assert.equal(minted.review_run_id, receipt.review_run_id);
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
  const receipt = createExactSliceReviewReceipt(receiptFields());
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
  const receipt = createExactSliceReviewReceipt(receiptFields());
  await store.persist(receipt);
  const conflicting = createExactSliceReviewReceipt(receiptFields({
    reviewed_sha: "c".repeat(40),
    review_monitor_handle: "review-monitor-conflict"
  }));
  await assert.rejects(store.persist(conflicting), /conflicts with an existing immutable selector/);
  const minted = reviseExactSliceReviewReceipt(receipt, { proof_state: "minted" });
  await store.persist(minted);
  await assert.rejects(store.persist(receipt), /non-monotonic/);
  assert.deepEqual(await store.loadLatest(receipt.unit_address), minted);
});

test("caller authority fields are outside the exact durable receipt contract", () => {
  assert.throws(() => createExactSliceReviewReceipt(receiptFields({
    proof: { caller_supplied: true }
  })), /forbidden field: proof/);
  assert.throws(() => createExactSliceReviewReceipt(receiptFields({
    attestation: "portfolio-local prose"
  })), /forbidden field: attestation/);
});

const LIVE_RECORD_ID = "WK-9971";
const LIVE_SLICE_ID = "SLICE-001";
const LIVE_INITIATIVE = "IN-0031";
const LIVE_SUBJECT = `${LIVE_RECORD_ID}#${LIVE_SLICE_ID}`;
const LIVE_SLICE_BRANCH = `slice/${LIVE_INITIATIVE}/${LIVE_RECORD_ID}/${LIVE_SLICE_ID}`;
const LIVE_SLICE_REF = `refs/heads/${LIVE_SLICE_BRANCH}`;
const LIVE_REVIEWED_SHA = "e".repeat(40);
const LIVE_DIFF_BASE_SHA = "f".repeat(40);
const LIVE_WORKER_RUN_ID = "live_slice_worker_run";
const LIVE_WORKER_MONITOR = "live_slice_worker_monitor";
const LIVE_WRITE_SCOPE = ["tests/fixtures/wk1666-live-canary.txt"];

const LIVE_ZERO_COUNTS = Object.freeze({
  total: 0, blocking: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0
});

const LIVE_ROLE_CONFIG =
  '[roles.worker]\nmodel = "gpt-5-codex"\n' +
  '[roles.reviewer]\nmodel = "gpt-5-codex"\n' +
  '[roles.redteam]\nmodel = "gpt-5-codex"\n';

function liveSliceReviewRecord() {
  return {
    schema_version: "work-record.v1",
    id: LIVE_RECORD_ID,
    repo: "agent-chassis/agent-chassis",
    title: "Live receipt-composition canary",
    record_kind: "work_item",
    work_kind: "implementation",
    status: "active",
    priority: "high",
    owner: "codex",
    created: "2026-07-20",
    updated: "2026-07-20",
    initiative: LIVE_INITIATIVE,
    read_scope: ["docs/work-record-schema.md"],
    repo_paths: LIVE_WRITE_SCOPE,
    write_scope: [],
    depends_on: [],
    blocks: [],
    related: [],
    dispatch_intent: {
      intended_agent_role: "worker",
      target_unit: "record",
      requires_graph_impact: false,
      requires_escalation: false
    },
    acceptance: {
      criteria: ["Parent WK: the receipt-composition canary is delivered end to end."],
      validation: ["Parent WK: workspace_work_record_validate returns valid=true."]
    },
    sections: {
      summary: "Receipt-composition canary parent record.",
      why_it_matters: "Drives the production structured-receipt derivation.",
      scope: { items: ["receipt composition"], out_of_scope: ["product promotion"] },
      tasks: [],
      references: ["docs/work-record-schema.md"],
      agent_notes: "",
      closure: null
    },
    children: [],
    slices: [
      {
        id: LIVE_SLICE_ID,
        title: "Implementation slice under slice-level review",
        work_kind: "implementation",
        status: "review",
        write_scope: LIVE_WRITE_SCOPE,
        repo_paths: LIVE_WRITE_SCOPE,
        read_scope: ["docs/work-record-schema.md"],
        dispatch_intent: {
          intended_agent_role: "worker",
          target_unit: "slice",
          requires_graph_impact: false,
          requires_escalation: false
        },
        depends_on: [],
        acceptance: {
          criteria: ["Slice: create the canary fixture."],
          validation: ["Slice: node --test"]
        }
      }
    ],
    escalations: [],
    projections: [],
    migration: null
  };
}

function liveSliceBinding(worktreePath) {
  return {
    schema_version: "worktree-identity-binding.v2",
    launch_ref: LIVE_WORKER_MONITOR,
    run_id: `${LIVE_WORKER_RUN_ID}.slice`,
    retry_id: 0,
    unit_address: `${LIVE_INITIATIVE}/${LIVE_RECORD_ID}/${LIVE_SLICE_ID}`,
    initiative: LIVE_INITIATIVE,
    record_id: LIVE_RECORD_ID,
    slice_id: LIVE_SLICE_ID,
    base_ref: `wk/${LIVE_INITIATIVE}/${LIVE_RECORD_ID}`,
    base_sha: LIVE_DIFF_BASE_SHA,
    output_branch: LIVE_SLICE_BRANCH,
    worktree_path: worktreePath,
    read_scope: ["AGENTS.md"],
    repo_paths: ["packages/agent-launch-cli"],
    write_scope: LIVE_WRITE_SCOPE,
    write_scope_source: `wiki/work-records/${LIVE_RECORD_ID}.json#${LIVE_SLICE_ID}`,
    selected_unit: {
      kind: "slice",
      address: LIVE_SUBJECT,
      record_id: LIVE_RECORD_ID,
      slice_id: LIVE_SLICE_ID,
      repo: null
    },
    source_digest: `sha256:${"7".repeat(64)}`,
    source_version: null,
    checkout_mode: "full"
  };
}

function liveReviewerFinalResult(payloadOverrides = {}, { kind = null } = {}) {
  const payload = {
    schema_version: "agent-role-result.v1",
    reported_role: "reviewer",
    reported_subject: LIVE_SUBJECT,
    reported_outcome: "no_findings",
    summary: "Slice review complete.",
    findings: [],
    finding_counts: LIVE_ZERO_COUNTS,
    reviewed_controls: AGENT_ROLE_RESULT_REVIEWED_CONTROLS.map((control_id) => ({
      control_id, result: "pass"
    })),
    ...payloadOverrides
  };
  const findings = payload.reported_outcome === "changes_requested";
  return {
    schema_version: "workspace-agent-dispatch-final-result.v1",
    kind: kind ?? (findings ? "findings" : "no_findings"),
    findings: findings ? { summary: "findings recorded" } : null,
    no_findings: findings ? null : { reason: "clean" },
    missing_result: null,
    full_response: {
      format: "markdown",
      text: `Reviewer notes.\n\n\`\`\`agent-role-result.v1\n${JSON.stringify(payload, null, 2)}\n\`\`\``,
      source: null
    },
    writeback: { kind: "wk_updated", detail: null }
  };
}

function liveProseOnlyFinalResult() {
  return {
    schema_version: "workspace-agent-dispatch-final-result.v1",
    kind: "no_findings",
    findings: null,
    no_findings: { reason: "No findings. Looks good to me. SIGNOFF." },
    missing_result: null,
    full_response: {
      format: "markdown",
      text: "No findings. Looks good to me. SIGNOFF.",
      source: null
    },
    writeback: { kind: "wk_updated", detail: null }
  };
}

function liveMalformedFinalResult() {
  const text = "Reviewer notes.\n\n```agent-role-result.v1\n" +
    '{"schema_version":"agent-role-result.v1","reported_role":"reviewer",' +
    `"reported_subject":"${LIVE_SUBJECT}","reported_outcome":"changes_requested",` +
    '"findings":"not-an-array","finding_counts":{"total":1},"reviewed_controls":[]}\n```';
  return {
    schema_version: "workspace-agent-dispatch-final-result.v1",
    kind: "findings",
    findings: { summary: "findings recorded" },
    no_findings: null,
    missing_result: null,
    full_response: { format: "markdown", text, source: null },
    writeback: { kind: "wk_updated", detail: null }
  };
}

const LIVE_FINDING = Object.freeze({
  id: "F-001",
  title: "Corrective finding on the exact slice",
  severity: "high",
  blocking: true,
  affected_paths: [{ path: "tests/fixtures/wk1666-live-canary.txt", line: 3 }]
});

function liveCorrectiveFinalResult() {
  return liveReviewerFinalResult({
    reported_outcome: "changes_requested",
    summary: "One blocking finding.",
    findings: [{ ...LIVE_FINDING, affected_paths: [{ ...LIVE_FINDING.affected_paths[0] }] }],
    finding_counts: { total: 1, blocking: 1, critical: 0, high: 1, medium: 0, low: 0, info: 0 }
  });
}

function withLegacyDocsField(unit) {
  const out = {};
  for (const [key, value] of Object.entries(unit)) {
    if (key === "read_scope") out.docs = value;
    else out[key] = value;
  }
  return out;
}

function liveSliceReviewRecordWithShape(legacyShape) {
  const record = liveSliceReviewRecord();
  const shaped = legacyShape === "record" || legacyShape === "both"
    ? withLegacyDocsField(record)
    : record;
  if (legacyShape === "slice" || legacyShape === "both") {
    shaped.slices = shaped.slices.map(withLegacyDocsField);
  }
  return shaped;
}

async function createLiveReceiptFixture(
  t,
  { finalResult, immediateTerminal = false, legacyShape = null }
) {
  const mainRepo = await mkdtemp(path.join(os.tmpdir(), "wk1666-live-main-"));
  const sliceWorktree = await mkdtemp(path.join(os.tmpdir(), "wk1666-live-worktree-"));
  const receiptRoot = await mkdtemp(path.join(os.tmpdir(), "wk1666-live-receipts-"));
  for (const dir of [mainRepo, sliceWorktree, receiptRoot]) {
    t.after(() => rm(dir, { recursive: true, force: true }));
  }

  await mkdir(path.join(mainRepo, "wiki", "work-records"), { recursive: true });
  await mkdir(path.join(mainRepo, "docs"), { recursive: true });
  await writeFile(path.join(mainRepo, "agent-launch.toml"), LIVE_ROLE_CONFIG, "utf8");
  await writeFile(
    path.join(mainRepo, "wiki", "work-records", `${LIVE_RECORD_ID}.json`),
    JSON.stringify(liveSliceReviewRecordWithShape(legacyShape), null, 2),
    "utf8"
  );

  const inner = createExactSliceReviewReceiptStore({
    ensureRuntimeStateDir: async () => ({ ok: true, dir: receiptRoot })
  });

  const publications = [];
  const receiptStore = {
    ...inner,
    persist: async (receipt) => {
      const before = await inner.loadLatest(receipt.unit_address);
      const result = await inner.persist(receipt);
      if (before?.receipt_digest !== result.receipt_digest) publications.push(result);
      return result;
    }
  };
  const sliceBinding = liveSliceBinding(sliceWorktree);
  const target = Object.freeze({
    ref: LIVE_SLICE_REF,
    sha: LIVE_REVIEWED_SHA,
    diff_base_sha: LIVE_DIFF_BASE_SHA,
    diff_head_sha: LIVE_REVIEWED_SHA,
    diff_range: `${LIVE_DIFF_BASE_SHA}..${LIVE_REVIEWED_SHA}`,
    slice_level_review: true
  });

  const backend = createWorkspaceAgentDispatchBackend({
    __testHooks: true,

    launchExecutor: async () => (immediateTerminal
      ? { accepted: true, status: "succeeded", final_result: finalResult }
      : {
          accepted: true,
          status: "running",
          probe: async () => ({ status: "succeeded", final_result: finalResult })
        }),
    worktreeProvisioning: { mainRepo, worktreeRoot: path.join(mainRepo, ".worktrees") },
    exactSliceReviewReceiptStore: receiptStore,
    reviewContextRunGit: ({ args }) => {
      const rev = String(args[args.length - 1] ?? "");
      if (rev.startsWith(LIVE_DIFF_BASE_SHA)) return { ok: true, stdout: LIVE_DIFF_BASE_SHA };
      return { ok: true, stdout: LIVE_REVIEWED_SHA };
    },
    postWorkerSliceLifecycle: async ({ status, deps }) => deps.bindFrozenSliceReviewContext({
      status,
      provisioning: {
        record_id: LIVE_RECORD_ID,
        slice_id: LIVE_SLICE_ID,
        slice_binding: sliceBinding
      },
      sliceTarget: target,
      reviewUnit: deps.resolveCanonicalSliceReviewUnit({ mainRepo, subject: LIVE_SUBJECT })
    })
  });

  await backend.runPostWorkerSliceLifecycle({
    workspace: { dir: mainRepo },
    status: {
      run_id: LIVE_WORKER_RUN_ID,
      monitor_handle: LIVE_WORKER_MONITOR,
      subject: LIVE_SUBJECT
    }
  });

  return { backend, mainRepo, receiptStore, sliceWorktree, publications, receiptRoot };
}

async function runLiveSliceReview(backend, mainRepo, betweenLaunchAndStatus = null) {
  const launch = await backend.startLaunch({
    caller_session_id: "wk1666_live_session",
    role: "reviewer",
    subject: LIVE_SUBJECT,
    workspace_alias: "test",
    workspace_dir: mainRepo,
    app: "codex"
  });
  assert.equal(launch.accepted, true,
    `slice reviewer must launch; got ${JSON.stringify(launch.refusal ?? null)}`);

  if (betweenLaunchAndStatus !== null) await betweenLaunchAndStatus(launch);
  const status = await backend.getRunStatus({
    caller_session_id: "wk1666_live_session",
    run_id: launch.run_id,
    monitor_handle: launch.monitor_handle,
    subject: LIVE_SUBJECT
  });
  return { launch, status };
}

function liveMintOutcome(backend, runId) {
  return backend.__snapshotRuns().find((run) => run.run_id === runId)
    ?.slice_review_acceptance_mint ?? null;
}

test("a clean terminal slice review composes a minted receipt through the production backend", async (t) => {
  const { backend, mainRepo, receiptStore, publications } = await createLiveReceiptFixture(t, {
    finalResult: liveReviewerFinalResult()
  });

  const { launch, status } = await runLiveSliceReview(backend, mainRepo);

  assert.equal(publications.length, 2, "admission receipt plus one terminal receipt");
  assert.equal(publications[1].proof_state, "minted");

  assert.equal(status.terminal, true);
  assert.equal(status.status, "succeeded");
  assert.equal(status.review_result?.clean_review, true);
  assert.equal(status.review_result?.review_outcome, "no_findings");
  assert.equal(liveMintOutcome(backend, launch.run_id)?.ok, true);

  const receipt = await receiptStore.loadLatest(LIVE_SUBJECT);
  assert.notEqual(receipt, null, "a durable receipt must be published");
  assert.equal(receipt.frozen_context_state, "consumed");
  assert.equal(receipt.terminal_run_status, "succeeded");
  assert.equal(receipt.structured_outcome?.outcome, "clean");
  assert.equal(receipt.structured_outcome.clean_review, true);
  assert.deepEqual(receipt.structured_outcome.review_result, {
    review_outcome: "no_findings",
    clean_review: true,
    no_findings: true,
    blocking_finding_count: 0,
    medium_finding_count: 0,
    reviewed_controls: [...AGENT_ROLE_RESULT_REVIEWED_CONTROLS].sort((a, b) => a.localeCompare(b))
  });
  assert.equal(receipt.proof_state, "minted");
  assert.equal(receipt.review_run_id, launch.run_id);

  const reread = await receiptStore.load({
    unit_address: LIVE_SUBJECT,
    review_run_id: launch.run_id
  });
  assert.equal(reread.proof_state, "minted");
  assert.deepEqual(reread, receipt);
});

test("a changes_requested terminal slice review composes exact corrective findings and mints nothing", async (t) => {
  const { backend, mainRepo, receiptStore, publications } = await createLiveReceiptFixture(t, {
    finalResult: liveCorrectiveFinalResult()
  });

  const { launch, status } = await runLiveSliceReview(backend, mainRepo);

  assert.equal(publications.length, 2, "admission receipt plus one terminal receipt");
  assert.equal(publications[0].terminal_run_status, "running");
  assert.equal(publications[1].terminal_run_status, "succeeded");
  assert.equal(status.terminal, true);
  assert.equal(status.status, "succeeded");

  assert.equal(status.review_result ?? null, null);
  assert.equal(liveMintOutcome(backend, launch.run_id), null);

  const receipt = await receiptStore.loadLatest(LIVE_SUBJECT);
  assert.equal(receipt.structured_outcome?.outcome, "changes_requested");
  assert.equal(receipt.structured_outcome.clean_review, false);
  assert.equal(receipt.proof_state, "unminted");

  assert.deepEqual(receipt.structured_outcome.findings, [LIVE_FINDING]);
  assert.deepEqual(receipt.structured_outcome.finding_counts, {
    total: 1, blocking: 1, critical: 0, high: 1, medium: 0, low: 0, info: 0
  });

  const serialized = JSON.stringify(receipt);
  assert.doesNotMatch(serialized, /One blocking finding|Reviewer notes|findings recorded/u);
});

test("prose, malformed, mismatched, and misattributed reviewer output cannot mint or claim corrective authority", async (t) => {
  const cases = [
    ["prose-only no findings", liveProseOnlyFinalResult()],
    ["malformed structured payload", liveMalformedFinalResult()],
    ["wrong reported role", liveReviewerFinalResult({ reported_role: "redteam" })],
    ["wrong reported subject", liveReviewerFinalResult({
      reported_subject: `${LIVE_RECORD_ID}#SLICE-002`
    })],
    ["mismatched counts", liveReviewerFinalResult({
      reported_outcome: "changes_requested",
      findings: [{ ...LIVE_FINDING, affected_paths: [{ ...LIVE_FINDING.affected_paths[0] }] }],
      finding_counts: { total: 4, blocking: 2, critical: 0, high: 1, medium: 0, low: 0, info: 0 }
    })],
    ["changes_requested with empty findings", liveReviewerFinalResult({
      reported_outcome: "changes_requested",
      findings: [],
      finding_counts: LIVE_ZERO_COUNTS
    })]
  ];

  for (const [label, finalResult] of cases) {
    const { backend, mainRepo, receiptStore, publications } =
      await createLiveReceiptFixture(t, { finalResult });
    const { launch, status } = await runLiveSliceReview(backend, mainRepo);
    assert.equal(publications.length, 2, `${label}: admission receipt plus one terminal receipt`);

    assert.equal(status.terminal, true, `${label}: status must still be returned`);
    assert.equal(status.review_result ?? null, null, `${label}: no clean review_result`);
    assert.equal(liveMintOutcome(backend, launch.run_id), null, `${label}: no Proof A mint`);

    const receipt = await receiptStore.loadLatest(LIVE_SUBJECT);
    assert.notEqual(receipt, null, `${label}: the receipt is still published`);
    assert.equal(receipt.structured_outcome, null, `${label}: no trusted structured outcome`);
    assert.equal(receipt.proof_state, "unminted", `${label}: proof_state stays unminted`);
  }
});

test("repeating status for a terminal slice review replays exactly without regressing the minted receipt", async (t) => {
  const { backend, mainRepo, receiptStore, publications } = await createLiveReceiptFixture(t, {
    finalResult: liveReviewerFinalResult()
  });

  const { launch } = await runLiveSliceReview(backend, mainRepo);
  const first = await receiptStore.loadLatest(LIVE_SUBJECT);
  assert.equal(first.proof_state, "minted");
  assert.equal(publications.length, 2);

  const poll = () => backend.getRunStatus({
    caller_session_id: "wk1666_live_session",
    run_id: launch.run_id,
    monitor_handle: launch.monitor_handle,
    subject: LIVE_SUBJECT
  });

  const replayA = await poll();
  const replayB = await poll();
  assert.equal(replayA.terminal, true);
  assert.equal(replayB.terminal, true);
  assert.equal(replayA.review_result?.clean_review, true);

  const after = await receiptStore.loadLatest(LIVE_SUBJECT);
  assert.equal(after.proof_state, "minted");
  assert.deepEqual(after, first, "replay must be an exact idempotent receipt");
  assert.equal(liveMintOutcome(backend, launch.run_id)?.ok, true);

  assert.equal(publications.length, 2, "replay must be an exact no-op");
});

async function readLiveRecord(mainRepo) {
  return JSON.parse(
    await readFile(path.join(mainRepo, "wiki", "work-records", `${LIVE_RECORD_ID}.json`), "utf8")
  );
}

test("admission, clean terminal, Proof A, and the minted receipt form one monotonic selector chain", async (t) => {
  const { backend, mainRepo, receiptStore, publications } = await createLiveReceiptFixture(t, {
    finalResult: liveReviewerFinalResult()
  });
  const { launch } = await runLiveSliceReview(backend, mainRepo);

  assert.equal(publications.length, 2);
  const [admission, terminal] = publications;

  for (const field of ["unit_address", "record_id", "slice_id", "initiative",
    "review_run_id", "review_monitor_handle", "source_worker_run_id", "slice_ref",
    "reviewed_sha", "diff_base_sha", "worktree_path", "worktree_identity_digest",
    "canonical_parent_wk_contract", "canonical_parent_contract_digest",
    "slice_review_contract", "slice_review_contract_digest"]) {
    assert.equal(admission[field], terminal[field],
      `${field} must be immutable across the admission -> terminal chain`);
  }
  assert.equal(admission.review_run_id, launch.run_id);
  assert.equal(admission.terminal_run_status, "running");
  assert.equal(admission.proof_state, "unminted");
  assert.equal(admission.structured_outcome, null);
  assert.equal(terminal.terminal_run_status, "succeeded");
  assert.equal(terminal.structured_outcome.outcome, "clean");
  assert.equal(terminal.proof_state, "minted");
  assert.deepEqual(await receiptStore.loadLatest(LIVE_SUBJECT), terminal);
});

test("Proof A publication alone does not invalidate the frozen source contract", async (t) => {
  const { backend, mainRepo, publications } = await createLiveReceiptFixture(t, {
    finalResult: liveReviewerFinalResult()
  });
  await runLiveSliceReview(backend, mainRepo);

  const record = await readLiveRecord(mainRepo);
  assert.ok(Array.isArray(record.derived_evidence) && record.derived_evidence.length > 0,
    "Proof A must have published derived_evidence");

  const [admission, terminal] = publications;
  assert.equal(admission.canonical_parent_wk_contract, terminal.canonical_parent_wk_contract);
  const frozen = JSON.parse(terminal.canonical_parent_wk_contract);
  assert.equal(frozen.derived_evidence, undefined, "generated evidence is outside the frozen contract");
  assert.equal(frozen.projections, undefined, "generated projections are outside the frozen contract");

  assert.equal(frozen.id, LIVE_RECORD_ID);
  assert.equal(frozen.status, "active");
  assert.equal(frozen.slices[0].status, "review");

  assert.equal(admission.slice_review_contract, terminal.slice_review_contract);

  assert.equal(terminal.slice_review_contract, canonicalizeWorkRecordJson(record.slices[0]));
});

test("a real authored contract edit still invalidates the frozen source contract", async (t) => {
  const { mainRepo } = await createLiveReceiptFixture(t, {
    finalResult: liveReviewerFinalResult()
  });
  const { resolveCanonicalSliceReviewUnit } = await import(
    "../packages/agent-launch-cli/src/lib/backend-scope-authority.mjs"
  );
  const before = resolveCanonicalSliceReviewUnit(mainRepo, LIVE_SUBJECT);

  const record = await readLiveRecord(mainRepo);
  record.derived_evidence = [{ schema_version: "worker-admission-derived-evidence.v1" }];
  record.projections = [{ projection_id: "PR-0001" }];
  const recordPath = path.join(mainRepo, "wiki", "work-records", `${LIVE_RECORD_ID}.json`);
  await writeFile(recordPath, JSON.stringify(record, null, 2), "utf8");
  assert.equal(
    resolveCanonicalSliceReviewUnit(mainRepo, LIVE_SUBJECT).canonical_parent_wk_contract,
    before.canonical_parent_wk_contract,
    "generated surfaces must not move the frozen source contract"
  );

  record.acceptance.criteria = ["Parent WK: materially different acceptance."];
  record.slices[0].write_scope = ["tests/fixtures/wk1666-live-canary-moved.txt"];
  await writeFile(recordPath, JSON.stringify(record, null, 2), "utf8");
  const after = resolveCanonicalSliceReviewUnit(mainRepo, LIVE_SUBJECT);
  assert.notEqual(after.canonical_parent_wk_contract, before.canonical_parent_wk_contract,
    "an authored parent edit must invalidate the frozen contract");
  assert.notEqual(after.review_unit_contract, before.review_unit_contract,
    "an authored slice edit must invalidate the frozen slice contract");
});

test("an immediate-terminal clean launch mints Proof A and persists one minted receipt", async (t) => {
  const { backend, mainRepo, receiptStore, publications } = await createLiveReceiptFixture(t, {
    finalResult: liveReviewerFinalResult(),
    immediateTerminal: true
  });

  const launch = await backend.startLaunch({
    caller_session_id: "wk1666_live_session",
    role: "reviewer",
    subject: LIVE_SUBJECT,
    workspace_alias: "test",
    workspace_dir: mainRepo,
    app: "codex"
  });
  assert.equal(launch.accepted, true);
  assert.equal(launch.status, "succeeded");
  assert.equal(launch.review_result?.clean_review, true);

  assert.equal(liveMintOutcome(backend, launch.run_id)?.ok, true, "Proof A must mint at launch");
  assert.equal(publications.length, 1, "an immediate-terminal launch publishes exactly one receipt");
  const receipt = await receiptStore.loadLatest(LIVE_SUBJECT);
  assert.equal(receipt.terminal_run_status, "succeeded");
  assert.equal(receipt.structured_outcome.outcome, "clean");
  assert.equal(receipt.proof_state, "minted");
  const record = await readLiveRecord(mainRepo);
  assert.ok((record.derived_evidence ?? []).length > 0);

  const status = await backend.getRunStatus({
    caller_session_id: "wk1666_live_session",
    run_id: launch.run_id,
    monitor_handle: launch.monitor_handle,
    subject: LIVE_SUBJECT
  });
  assert.equal(status.terminal, true);
  assert.equal(publications.length, 1, "polling a synchronously-terminal run publishes nothing new");
  assert.deepEqual(await receiptStore.loadLatest(LIVE_SUBJECT), receipt);
});

test("the minted receipt survives restart recovery and resolves the broker acceptance binding", async (t) => {
  const { backend, mainRepo, receiptRoot } = await createLiveReceiptFixture(t, {
    finalResult: liveReviewerFinalResult()
  });
  const { launch } = await runLiveSliceReview(backend, mainRepo);

  const restarted = createExactSliceReviewReceiptStore({
    ensureRuntimeStateDir: async () => ({ ok: true, dir: receiptRoot })
  });
  const recovered = await restarted.load({
    unit_address: LIVE_SUBJECT,
    review_run_id: launch.run_id
  });
  assert.equal(recovered.proof_state, "minted");
  assert.deepEqual(
    await restarted.load({ unit_address: LIVE_SUBJECT, monitor_handle: recovered.review_monitor_handle }),
    recovered
  );

  assert.deepEqual(validateExactSliceReviewReceipt(recovered, {
    unit_address: LIVE_SUBJECT,
    review_run_id: launch.run_id
  }), recovered);

  const { resolveFrozenSliceReviewReceiptContract } = await import(
    "../packages/agent-launch-cli/src/lib/backend-scope-authority.mjs"
  );
  const frozenContract = resolveFrozenSliceReviewReceiptContract(recovered);
  assert.equal(frozenContract.subject, LIVE_SUBJECT);
  assert.equal(frozenContract.parent_status, "active");

  const { resolveSliceReviewAcceptanceProof } = await import(
    "../packages/wiki-core/src/operations/work-record-slice-review-acceptance.mjs"
  );
  const resolved = await resolveSliceReviewAcceptanceProof({
    dir: mainRepo,
    unit_address: LIVE_SUBJECT,
    expectation: {
      unit_address: LIVE_SUBJECT,
      initiative: LIVE_INITIATIVE,
      slice_ref: LIVE_SLICE_REF,
      reviewed_sha: LIVE_REVIEWED_SHA,
      diff_base_sha: LIVE_DIFF_BASE_SHA,
      source_worker_run_id: LIVE_WORKER_RUN_ID,
      review_run_id: launch.run_id,
      current_slice_sha: LIVE_REVIEWED_SHA
    }
  });
  assert.equal(resolved.ok, true,
    `broker must accept the minted proof; got ${JSON.stringify(resolved.reasons ?? resolved)}`);
});

test("the broker's historical Proof A comparison accepts generated evidence but refuses an authored edit", async (t) => {
  const { backend, mainRepo, receiptStore, receiptRoot } = await createLiveReceiptFixture(t, {
    finalResult: liveReviewerFinalResult()
  });
  const { launch } = await runLiveSliceReview(backend, mainRepo);

  const restarted = createExactSliceReviewReceiptStore({
    ensureRuntimeStateDir: async () => ({ ok: true, dir: receiptRoot })
  });
  const receipt = await restarted.load({ unit_address: LIVE_SUBJECT, review_run_id: launch.run_id });
  assert.equal(receipt.proof_state, "minted");
  const historicalContract = {
    canonical_parent_wk_contract: receipt.canonical_parent_wk_contract,
    canonical_parent_contract_digest: receipt.canonical_parent_contract_digest,
    slice_review_contract: receipt.slice_review_contract,
    slice_review_contract_digest: receipt.slice_review_contract_digest
  };

  const recordPath = path.join(mainRepo, "wiki", "work-records", `${LIVE_RECORD_ID}.json`);
  const integrated = await readLiveRecord(mainRepo);
  integrated.status = "review";
  integrated.slices[0].status = "done";
  integrated.updated = "2026-07-21";
  await writeFile(recordPath, JSON.stringify(integrated, null, 2), "utf8");
  assert.ok((integrated.derived_evidence ?? []).length > 0, "generated evidence is present on disk");

  const { resolveHistoricalSliceReviewAcceptanceProof } = await import(
    "../packages/wiki-core/src/operations/work-record-slice-review-acceptance.mjs"
  );
  const resolveHistorical = () => resolveHistoricalSliceReviewAcceptanceProof({
    dir: mainRepo,
    unit_address: LIVE_SUBJECT,
    historical_contract: historicalContract,
    review_result: receipt.structured_outcome.review_result,
    expectation: {
      unit_address: LIVE_SUBJECT,
      initiative: LIVE_INITIATIVE,
      slice_ref: LIVE_SLICE_REF,
      reviewed_sha: LIVE_REVIEWED_SHA,
      diff_base_sha: LIVE_DIFF_BASE_SHA,
      source_worker_run_id: LIVE_WORKER_RUN_ID,
      review_run_id: launch.run_id,
      current_slice_sha: LIVE_REVIEWED_SHA
    }
  });

  const accepted = await resolveHistorical();
  assert.equal(accepted.ok, true,
    `generated evidence must not invalidate the frozen contract; got ${JSON.stringify(accepted.reasons ?? accepted)}`);

  const edited = await readLiveRecord(mainRepo);
  edited.acceptance.criteria = ["Parent WK: materially different acceptance."];
  await writeFile(recordPath, JSON.stringify(edited, null, 2), "utf8");
  const refused = await resolveHistorical();
  assert.equal(refused.ok, false, "an authored contract edit must refuse");
  assert.match(JSON.stringify(refused.reasons ?? []), /changed beyond the exact lifecycle fields/u);
});

const LEGACY_SHAPE_CASES = [
  ["legacy docs at record scope", "record"],
  ["legacy docs at slice scope", "slice"],
  ["legacy docs at both record and slice scope", "both"]
];

for (const [label, legacyShape] of LEGACY_SHAPE_CASES) {
  test(`${label} still composes exactly one minted terminal receipt`, async (t) => {
    const { backend, mainRepo, receiptStore, publications } = await createLiveReceiptFixture(t, {
      finalResult: liveReviewerFinalResult(),
      legacyShape
    });

    const authored = await readLiveRecord(mainRepo);
    if (legacyShape === "record" || legacyShape === "both") {
      assert.ok(Array.isArray(authored.docs), `${label}: record must be authored with docs`);
      assert.equal(authored.read_scope, undefined);
    }
    if (legacyShape === "slice" || legacyShape === "both") {
      assert.ok(Array.isArray(authored.slices[0].docs), `${label}: slice must be authored with docs`);
      assert.equal(authored.slices[0].read_scope, undefined);
    }

    const { launch, status } = await runLiveSliceReview(backend, mainRepo);

    assert.equal(publications.length, 2, `${label}: admission receipt plus one terminal receipt`);
    assert.equal(publications[1].proof_state, "minted", `${label}: the terminal receipt is minted`);
    assert.equal(status.review_result?.clean_review, true, `${label}: clean review result`);
    assert.equal(liveMintOutcome(backend, launch.run_id)?.ok, true, `${label}: Proof A minted`);

    const [admission, terminal] = publications;
    assert.equal(admission.canonical_parent_wk_contract, terminal.canonical_parent_wk_contract,
      `${label}: the frozen parent contract must not move across the mint`);
    assert.equal(admission.slice_review_contract, terminal.slice_review_contract,
      `${label}: the frozen slice contract must not move across the mint`);

    const frozenParent = JSON.parse(terminal.canonical_parent_wk_contract);
    assert.equal(frozenParent.docs, undefined, `${label}: legacy docs is canonicalized out of the parent`);
    assert.ok(Array.isArray(frozenParent.read_scope), `${label}: parent carries canonical read_scope`);
    const frozenSlice = JSON.parse(terminal.slice_review_contract);
    assert.equal(frozenSlice.docs, undefined, `${label}: legacy docs is canonicalized out of the slice`);
    assert.ok(Array.isArray(frozenSlice.read_scope), `${label}: slice carries canonical read_scope`);
    assert.equal(
      JSON.stringify(frozenParent.slices.find((entry) => entry?.id === LIVE_SLICE_ID)),
      terminal.slice_review_contract,
      `${label}: parent-embedded slice and standalone slice contract must agree byte-for-byte`
    );

    assert.deepEqual(frozenParent.read_scope, authored.docs ?? authored.read_scope);
    assert.deepEqual(frozenSlice.read_scope, authored.slices[0].docs ?? authored.slices[0].read_scope);
    assert.deepEqual(await receiptStore.loadLatest(LIVE_SUBJECT), terminal);
  });
}

test("Proof A persistence canonicalizes a legacy record without an immutable-selector conflict", async (t) => {
  const { backend, mainRepo, publications } = await createLiveReceiptFixture(t, {
    finalResult: liveReviewerFinalResult(),
    legacyShape: "both"
  });
  await runLiveSliceReview(backend, mainRepo);

  const persisted = await readLiveRecord(mainRepo);
  assert.ok((persisted.derived_evidence ?? []).length > 0, "Proof A must have published evidence");
  assert.equal(persisted.docs, undefined, "persistence canonicalizes the record-scope alias");
  assert.equal(persisted.slices[0].docs, undefined, "persistence canonicalizes the slice-scope alias");
  assert.ok(Array.isArray(persisted.read_scope));
  assert.ok(Array.isArray(persisted.slices[0].read_scope));

  const [admission, terminal] = publications;
  assert.equal(admission.canonical_parent_contract_digest, terminal.canonical_parent_contract_digest);
  assert.equal(admission.slice_review_contract_digest, terminal.slice_review_contract_digest);
});

test("an updated-only refresh between admission and terminal publication does not invalidate the receipt", async (t) => {
  const { backend, mainRepo, receiptStore, publications } = await createLiveReceiptFixture(t, {
    finalResult: liveReviewerFinalResult()
  });
  const recordPath = path.join(mainRepo, "wiki", "work-records", `${LIVE_RECORD_ID}.json`);

  const { launch } = await runLiveSliceReview(backend, mainRepo, async () => {

    assert.equal(publications.length, 1, "the admission receipt is already published");
    const record = await readLiveRecord(mainRepo);
    assert.equal(record.updated, "2026-07-20");
    record.updated = "2026-07-25";
    await writeFile(recordPath, JSON.stringify(record, null, 2), "utf8");
  });

  assert.equal(publications.length, 2, "admission receipt plus one terminal receipt");
  const [admission, terminal] = publications;
  assert.equal(terminal.proof_state, "minted");
  assert.equal(admission.canonical_parent_wk_contract, terminal.canonical_parent_wk_contract,
    "a coordination-only `updated` change must not move the frozen contract");

  const frozen = JSON.parse(terminal.canonical_parent_wk_contract);
  assert.equal(frozen.updated, undefined, "`updated` is excluded from review-receipt identity");
  assert.equal((await readLiveRecord(mainRepo)).updated, "2026-07-25", "the record itself still tracks it");
  assert.equal(liveMintOutcome(backend, launch.run_id)?.ok, true);
  assert.deepEqual(await receiptStore.loadLatest(LIVE_SUBJECT), terminal);
});

test("a running unminted admission receipt is never mistaken for a completed terminal replay", async (t) => {
  const { backend, mainRepo, receiptStore, publications } = await createLiveReceiptFixture(t, {
    finalResult: liveReviewerFinalResult()
  });

  const { launch } = await runLiveSliceReview(backend, mainRepo, async () => {

    const admission = await receiptStore.load({
      unit_address: LIVE_SUBJECT,
      review_run_id: publications[0].review_run_id
    });
    assert.notEqual(admission, null, "an admission receipt is on disk before the terminal poll");
    assert.equal(admission.terminal_run_status, "running");
    assert.equal(admission.proof_state, "unminted");
    assert.equal(admission.structured_outcome, null);
  });

  assert.equal(publications.length, 2, "the terminal transition must still publish");
  const [admission, terminal] = publications;
  assert.equal(admission.terminal_run_status, "running");
  assert.equal(admission.proof_state, "unminted");
  assert.equal(terminal.terminal_run_status, "succeeded");
  assert.equal(terminal.proof_state, "minted");
  assert.equal(terminal.structured_outcome?.outcome, "clean");
  assert.notEqual(admission.receipt_digest, terminal.receipt_digest,
    "the terminal receipt is a real monotonic transition, not a replayed admission receipt");
  assert.equal(liveMintOutcome(backend, launch.run_id)?.ok, true);
  assert.equal((await receiptStore.loadLatest(LIVE_SUBJECT)).proof_state, "minted");
});

test("a terminal minted receipt replays as an exact no-op after the slice has integrated", async (t) => {
  const { backend, mainRepo, receiptStore, publications } = await createLiveReceiptFixture(t, {
    finalResult: liveReviewerFinalResult()
  });
  const { launch } = await runLiveSliceReview(backend, mainRepo);
  const minted = await receiptStore.loadLatest(LIVE_SUBJECT);
  assert.equal(minted.proof_state, "minted");
  assert.equal(publications.length, 2);

  const poll = () => backend.getRunStatus({
    caller_session_id: "wk1666_live_session",
    run_id: launch.run_id,
    monitor_handle: launch.monitor_handle,
    subject: LIVE_SUBJECT
  });

  assert.equal((await readLiveRecord(mainRepo)).slices[0].status, "review");
  const preIntegration = await poll();
  assert.equal(preIntegration.terminal, true);
  assert.equal(publications.length, 2, "a pre-integration replay publishes nothing");
  assert.deepEqual(await receiptStore.loadLatest(LIVE_SUBJECT), minted);

  const { setWorkRecordStatusByUnit } = await import("../packages/wiki-core/src/index.mjs");
  const sliceDone = await setWorkRecordStatusByUnit({
    dir: mainRepo, unitAddress: LIVE_SUBJECT, status: "done"
  });
  assert.equal(sliceDone.valid, true,
    `the slice must transition to done; got ${JSON.stringify(sliceDone.diagnostics ?? null)}`);
  const parentReview = await setWorkRecordStatusByUnit({
    dir: mainRepo, unitAddress: LIVE_RECORD_ID, status: "review"
  });
  assert.equal(parentReview.valid, true,
    `the parent must transition to whole-WK review; got ${JSON.stringify(parentReview.diagnostics ?? null)}`);

  const integrated = await readLiveRecord(mainRepo);
  assert.equal(integrated.slices[0].status, "done", "the production lifecycle really integrated the slice");
  assert.equal(integrated.status, "review");

  const { resolveCanonicalSliceReviewUnit } = await import(
    "../packages/agent-launch-cli/src/lib/backend-scope-authority.mjs"
  );
  assert.throws(() => resolveCanonicalSliceReviewUnit(mainRepo, LIVE_SUBJECT),
    /whole-WK review|not an implementation slice under slice-level review/u);

  const postIntegration = await poll();
  assert.equal(postIntegration.terminal, true);
  assert.equal(postIntegration.status, "succeeded");
  assert.equal(postIntegration.review_result?.clean_review, true);
  assert.equal(publications.length, 2, "a post-integration replay publishes nothing new");
  assert.deepEqual(await receiptStore.loadLatest(LIVE_SUBJECT), minted,
    "the retained receipt must replay byte-identically");
});

test("an authored slice-contract edit still refuses the historical Proof A comparison", async (t) => {
  const { backend, mainRepo, receiptStore } = await createLiveReceiptFixture(t, {
    finalResult: liveReviewerFinalResult()
  });
  const { launch } = await runLiveSliceReview(backend, mainRepo);
  const receipt = await receiptStore.loadLatest(LIVE_SUBJECT);
  const historicalContract = {
    canonical_parent_wk_contract: receipt.canonical_parent_wk_contract,
    canonical_parent_contract_digest: receipt.canonical_parent_contract_digest,
    slice_review_contract: receipt.slice_review_contract,
    slice_review_contract_digest: receipt.slice_review_contract_digest
  };

  const recordPath = path.join(mainRepo, "wiki", "work-records", `${LIVE_RECORD_ID}.json`);
  const integrated = await readLiveRecord(mainRepo);
  integrated.status = "review";
  integrated.slices[0].status = "done";

  integrated.slices[0].write_scope = ["tests/fixtures/wk1666-live-canary-moved.txt"];
  await writeFile(recordPath, JSON.stringify(integrated, null, 2), "utf8");

  const { resolveHistoricalSliceReviewAcceptanceProof } = await import(
    "../packages/wiki-core/src/operations/work-record-slice-review-acceptance.mjs"
  );
  const refused = await resolveHistoricalSliceReviewAcceptanceProof({
    dir: mainRepo,
    unit_address: LIVE_SUBJECT,
    historical_contract: historicalContract,
    review_result: receipt.structured_outcome.review_result,
    expectation: {
      unit_address: LIVE_SUBJECT,
      initiative: LIVE_INITIATIVE,
      slice_ref: LIVE_SLICE_REF,
      reviewed_sha: LIVE_REVIEWED_SHA,
      diff_base_sha: LIVE_DIFF_BASE_SHA,
      source_worker_run_id: LIVE_WORKER_RUN_ID,
      review_run_id: launch.run_id,
      current_slice_sha: LIVE_REVIEWED_SHA
    }
  });
  assert.equal(refused.ok, false, "an authored slice-contract edit must refuse");
  assert.match(JSON.stringify(refused.reasons ?? []), /changed beyond the exact lifecycle fields/u);
});

test("receipt-store corruption surfaces its own typed error and mutates nothing", async (t) => {
  const { backend, mainRepo, receiptRoot, publications } = await createLiveReceiptFixture(t, {
    finalResult: liveReviewerFinalResult()
  });
  const { launch } = await runLiveSliceReview(backend, mainRepo);
  assert.equal(publications.length, 2, "the minted terminal receipt is published first");
  assert.equal(publications[1].proof_state, "minted");

  const { setWorkRecordStatusByUnit } = await import("../packages/wiki-core/src/index.mjs");
  assert.equal((await setWorkRecordStatusByUnit({
    dir: mainRepo, unitAddress: LIVE_SUBJECT, status: "done"
  })).valid, true);
  assert.equal((await setWorkRecordStatusByUnit({
    dir: mainRepo, unitAddress: LIVE_RECORD_ID, status: "review"
  })).valid, true);

  const eventDir = path.join(receiptRoot, "exact-slice-review-receipts");
  const eventNames = (await readdir(eventDir)).filter((name) => name.startsWith("event-")).sort();
  assert.ok(eventNames.length >= 2, "the store holds the admission and terminal events");

  const corruptedName = eventNames.at(-1);
  const corruptedPath = path.join(eventDir, corruptedName);
  const original = await readFile(corruptedPath, "utf8");
  const tampered = JSON.parse(original);
  tampered.receipt.reviewed_sha = "c".repeat(40);
  await writeFile(corruptedPath, `${JSON.stringify(tampered, null, 2)}\n`, "utf8");

  const recordBefore = await readLiveRecord(mainRepo);
  const mintBefore = liveMintOutcome(backend, launch.run_id);
  const namesBefore = (await readdir(eventDir)).sort();

  await assert.rejects(
    () => backend.getRunStatus({
      caller_session_id: "wk1666_live_session",
      run_id: launch.run_id,
      monitor_handle: launch.monitor_handle,
      subject: LIVE_SUBJECT
    }),
    (error) => {
      assert.match(error.message, /exact slice review receipt/u,
        `must surface the store's own typed diagnostic; got: ${error.message}`);
      assert.doesNotMatch(error.message, /slice-level review|implementation slice/u,
        `must NOT report an unrelated canonical-state failure; got: ${error.message}`);
      return true;
    }
  );

  assert.equal(publications.length, 2, "a corrupt store publishes nothing");
  assert.deepEqual(liveMintOutcome(backend, launch.run_id), mintBefore, "no Proof A re-mint");
  assert.deepEqual(await readLiveRecord(mainRepo), recordBefore, "the canonical record is untouched");
  assert.deepEqual((await readdir(eventDir)).sort(), namesBefore, "no receipt is deleted or added");
  assert.equal(await readFile(corruptedPath, "utf8"), `${JSON.stringify(tampered, null, 2)}\n`,
    "the corrupt receipt is left exactly as found — never rewritten or repaired");
});

test("receipt recovery adds no public integrate-slice operation", async () => {
  const sources = await Promise.all([
    readFile(new URL("../packages/wiki-mcp/src/server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../packages/wiki-mcp/src/lib/dispatch-tools/register.mjs", import.meta.url), "utf8")
  ]);
  for (const source of sources) {
    assert.doesNotMatch(source, /registerTool\(\s*["'](?:integrate_slice|integrate-slice)["']/u);
  }
});
