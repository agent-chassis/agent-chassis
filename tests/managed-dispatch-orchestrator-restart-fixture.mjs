

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

import { createTestDispatchBackend } from "./workspace-agent-dispatch-backend-shared.mjs";
import {
  acquireManagedRunSubjectReservation,
  attachTupleToManagedRunSubjectReservation,
  bindManagedRunSandboxProcessIdentity,
  deriveOuterSandboxKillShape,
  managedRunSubjectReservationFilePath,
  MANAGED_RUN_PROCESS_IDENTITY_STATES,
  publishPendingManagedRunProcessIdentity,
  readManagedRunProcessIdentity
} from "../packages/agent-launch-cli/src/lib/managed-run-process-identity.mjs";
import { bindingFilePath } from "../packages/agent-launch-cli/src/lib/worktree-substrate-identity.mjs";
import { defaultRunGit } from "../packages/agent-launch-cli/src/lib/worktree-substrate.mjs";
import {
  computeWorkRecordSourceDigest,
  setWorkRecordStatusByUnit
} from "../packages/wiki-core/src/index.mjs";
import { jsonContent } from "../packages/wiki-mcp/src/lib/mcp-response.mjs";
import { registerWorkspaceCommitTool } from "../packages/wiki-mcp/src/lib/workspace-commit-tool.mjs";

export const WK = "WK-9099";
export const INITIATIVE = "IN-0099";
export const SUBJECT = `${WK}#SLICE-001`;
export const SLICE_REF = `refs/heads/slice/${INITIATIVE}/${WK}/SLICE-001`;
export const BOOT_ID = "abababab-cdcd-efef-0101-232345456767";
export const SANDBOX_PID = 5252;

export function git(repo, ...args) {
  const result = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return String(result.stdout ?? "").trim();
}

export function livenessDeps(procs) {
  return {
    procAvailable: () => true,
    readBootId: () => BOOT_ID,
    readUptime: () => 1000,
    readProcStat(pid) {
      const starttime = procs[pid];
      if (starttime === undefined) return null;
      const tail = Array.from({ length: 30 }, (_, index) => String(index + 3));
      tail[0] = "S";
      tail[19] = String(starttime);
      return `${pid} (managed restart worker) ${tail.join(" ")}`;
    },
    sendSignal: () => assert.fail("restart recovery is observation-only and must never signal")
  };
}

export const ALIVE = () => ({ [process.pid]: "555", [SANDBOX_PID]: "777" });

export const DEAD = () => ({ [process.pid]: "999", [SANDBOX_PID]: "888" });

export const LAUNCHER_ALIVE_SANDBOX_DEAD = () => ({ [process.pid]: "555", [SANDBOX_PID]: "888" });

function canonicalRecord(status = "todo") {
  return {
    schema_version: "work-record.v1",
    id: WK,
    repo: "fixture/repo",
    title: "Restart convergence",
    record_kind: "work_item",
    work_kind: "implementation",
    status: "active",
    priority: "critical",
    owner: "codex",
    created: "2026-07-24",
    updated: "2026-07-24",
    initiative: INITIATIVE,
    read_scope: ["src/canary.txt"],
    repo_paths: ["src/canary.txt"],
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
    acceptance: { criteria: ["Converge after restart."], validation: ["node --test"] },
    sections: {
      summary: "Restart convergence.",
      why_it_matters: "Exercises the registered production composition.",
      scope: { items: ["restart convergence"], out_of_scope: [] },
      tasks: [], references: [], agent_notes: "", closure: null
    },
    children: [],
    slices: [{
      id: "SLICE-001",
      title: "Restart delivery",
      work_kind: "implementation",
      status,
      priority: "critical",
      owner: "codex",
      depends_on: [],
      read_scope: ["src/canary.txt"],
      repo_paths: ["src/canary.txt"],
      write_scope: ["src/canary.txt"],
      dispatch_intent: {
        intended_agent_role: "worker",
        target_unit: "slice",
        requires_graph_impact: false,
        requires_escalation: false
      },
      acceptance: { criteria: ["Deliver the canary."], validation: ["Inspect the canary."] }
    }],
    escalations: [], projections: [], migration: null
  };
}

export function bareFixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "managed-restart-"));
  const repo = path.join(root, "repo");
  const worktreeRoot = path.join(root, "worktrees");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(repo, { recursive: true });
  mkdirSync(worktreeRoot, { recursive: true });
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.name", "Test");
  git(repo, "config", "user.email", "test@example.com");
  mkdirSync(path.join(repo, "wiki", "work-records"), { recursive: true });
  mkdirSync(path.join(repo, "src"), { recursive: true });
  writeFileSync(path.join(repo, "src", "canary.txt"), "base bytes\n");
  writeFileSync(
    path.join(repo, "wiki", "work-records", `${WK}.json`),
    `${JSON.stringify(canonicalRecord(), null, 2)}\n`
  );
  writeFileSync(
    path.join(repo, "agent-launch.toml"),
    '[roles.reviewer]\nmodel = "gpt-5.6-terra"\n[roles.worker]\nmodel = "gpt-5.6-terra"\n'
  );
  git(repo, "add", ".");
  git(repo, "commit", "-m", "base");
  return { root, repo, worktreeRoot };
}

export function idMint() {
  let seq = 0;
  return {
    runIdFactory: () => `wkdb_restart_${seq++}`,
    monitorHandleFactory: () => `wkmh_restart_${seq++}`
  };
}

export function inMemoryReceiptStore() {
  const receipts = [];
  return {
    store: {
      loadLatest: async (unitAddress) =>
        [...receipts].reverse().find((r) => r.unit_address === unitAddress) ?? null,
      loadAll: async ({ unit_address: unitAddress }) =>
        receipts.filter((r) => r.unit_address === unitAddress),
      load: async () => null,
      persist: async (receipt) => { receipts.push(receipt); return receipt; }
    },
    receipts
  };
}

export function reconstructBackend(fx, { procs, ids, launches, receiptStore, reviewContextRunGit = null }) {
  return createTestDispatchBackend({
    runIdFactory: ids.runIdFactory,
    monitorHandleFactory: ids.monitorHandleFactory,

    ...(reviewContextRunGit === null ? {} : { reviewContextRunGit }),
    worktreeProvisioning: {
      mainRepo: fx.repo,
      worktreeRoot: fx.worktreeRoot,
      confinementAvailable: true
    },
    requireManagedProvisioning: true,
    postWorkerSliceLifecycle: async () => null,
    managedRunProcessIdentityDeps: livenessDeps(procs),
    exactSliceReviewReceiptStore: receiptStore,
    launchExecutor: async (input) => {
      launches.push(input);
      return {
        accepted: true,
        status: "launching",
        pid: SANDBOX_PID,
        enforcement: { enforced: false },
        probe: async () => ({ status: "running" })
      };
    }
  });
}

export function dispatchWorker(backend, caller) {
  return backend.startLaunch({
    caller_session_id: caller,
    role: "worker",
    app: "codex",
    subject: SUBJECT,
    workspace_dir: undefined,
    readiness: { dispatchable: true, initiative: INITIATIVE }
  });
}

function registerCommit(repo, env) {
  const tools = new Map();
  registerWorkspaceCommitTool({
    registerTool: (name, config, handler) => tools.set(name, { config, handler }),
    workspaceRepos: [{ repo: "fixture/repo", dir: repo }],
    z,
    jsonContent,
    errorContent: (error) => ({ isError: true, content: [{ type: "text", text: error?.message ?? String(error) }] }),
    resolveWorkspaceRepo: () => ({ repo: "fixture/repo", dir: repo }),
    createCompactWorkRecordEditResponse: (_workspaceRepo, result) => ({ result }),
    setWorkRecordStatusByUnit,
    env
  });
  return tools.get("commit").handler;
}

function structured(result) {
  return result.structuredContent ?? JSON.parse(result.content[0].text);
}

export async function committedFixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "managed-restart-committed-"));
  const repo = path.join(root, "repo");
  const worktreeRoot = path.join(root, "worktrees");
  const worktree = path.join(worktreeRoot, `slice-${INITIATIVE}-${WK}-SLICE-001`);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(repo, { recursive: true });
  mkdirSync(worktreeRoot, { recursive: true });
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.name", "Test");
  git(repo, "config", "user.email", "test@example.com");
  mkdirSync(path.join(repo, "wiki", "work-records"), { recursive: true });
  mkdirSync(path.join(repo, "src"), { recursive: true });
  writeFileSync(path.join(repo, "src", "canary.txt"), "base bytes\n");
  const record = canonicalRecord();
  writeFileSync(
    path.join(repo, "wiki", "work-records", `${WK}.json`),
    `${JSON.stringify(record, null, 2)}\n`
  );
  writeFileSync(
    path.join(repo, "agent-launch.toml"),
    '[roles.reviewer]\nmodel = "gpt-5.6-terra"\n[roles.worker]\nmodel = "gpt-5.6-terra"\n'
  );
  git(repo, "add", ".");
  git(repo, "commit", "-m", "base");
  const base = git(repo, "rev-parse", "HEAD");
  git(repo, "branch", `wk/${INITIATIVE}/${WK}`, base);

  git(repo, "update-ref", `refs/agent-launch/wk-forks/${INITIATIVE}/${WK}`, base);
  git(repo, "worktree", "add", path.join(worktreeRoot, `wk-${INITIATIVE}-${WK}`), `wk/${INITIATIVE}/${WK}`);
  git(repo, "worktree", "add", "-b", `slice/${INITIATIVE}/${WK}/SLICE-001`, worktree, base);
  mkdirSync(path.join(worktree, "src"), { recursive: true });
  writeFileSync(path.join(worktree, "src", "canary.txt"), "delivered bytes\n");

  const tuple = {
    assigned_unit: SUBJECT,
    launch_ref: "wkmh_committed_worker",
    run_id: "wkdb_committed_worker",
    retry_id: 0
  };
  const initialDeps = livenessDeps({ [process.pid]: "111", 4242: "777" });
  const reservation = acquireManagedRunSubjectReservation({
    mainRepo: repo, subject: SUBJECT, role: "worker", deps: initialDeps
  });
  const pending = publishPendingManagedRunProcessIdentity({
    mainRepo: repo, tuple, role: "worker", deps: initialDeps
  });
  attachTupleToManagedRunSubjectReservation({ mainRepo: repo, reservation: reservation.reservation, tuple });
  bindManagedRunSandboxProcessIdentity(pending, {
    pid: 4242, killShape: deriveOuterSandboxKillShape({ pid: 4242 }), deps: initialDeps
  });

  const binding = {
    schema_version: "worktree-identity-binding.v2",
    launch_ref: tuple.launch_ref,
    run_id: tuple.run_id,
    retry_id: 0,
    unit_address: `${INITIATIVE}/${WK}/SLICE-001`,
    initiative: INITIATIVE,
    record_id: WK,
    slice_id: "SLICE-001",
    base_ref: `wk/${INITIATIVE}/${WK}`,
    base_sha: base,
    output_branch: `slice/${INITIATIVE}/${WK}/SLICE-001`,
    worktree_path: worktree,
    read_scope: ["src/canary.txt"],
    repo_paths: ["src/canary.txt"],
    write_scope: ["src/canary.txt"],
    write_scope_source: `wiki/work-records/${WK}.json#SLICE-001`,
    selected_unit: {
      kind: "slice", address: SUBJECT, record_id: WK, slice_id: "SLICE-001", repo: "fixture/repo"
    },
    source_digest: computeWorkRecordSourceDigest(record),
    source_version: record.schema_version,
    checkout_mode: "full"
  };
  const identityPath = bindingFilePath(repo, tuple.launch_ref, tuple.run_id, 0);
  mkdirSync(path.dirname(identityPath), { recursive: true });
  writeFileSync(identityPath, `${JSON.stringify(binding)}\n`);
  const commit = structured(await registerCommit(repo, {
    WIKI_MCP_ASSIGNED_UNIT: SUBJECT,
    WIKI_MCP_COMMIT_LAUNCH_REF: tuple.launch_ref,
    WIKI_MCP_COMMIT_RUN_ID: tuple.run_id,
    WIKI_MCP_COMMIT_RETRY_ID: "0"
  })({}));
  assert.equal(commit.committed, true, JSON.stringify(commit));
  assert.equal(commit.submitted_for_review, true);
  return { root, repo, worktreeRoot, tuple };
}

export function clearSubjectReservation(repo) {
  const filePath = managedRunSubjectReservationFilePath(repo, SUBJECT);
  assert.equal(existsSync(filePath), true, "the fixture reserved the subject");
  rmSync(filePath);
  assert.equal(readSubjectReservation(repo), null, "the reservation holder is null");
}

export function assertConvergentLoser(refusal, { winnerRunId }) {
  const detail = refusal.detail ?? {};
  assert.notEqual(refusal.reason, "managed_run_prior_attempt_proven_dead",
    `a loser must never be refused against a proven-dead attempt: ${JSON.stringify(detail)}`);
  assert.notEqual(detail.verdict, "proven_dead");
  assertNoOldHandleStatusRoute(refusal);
  const observedRunId = detail.continuation?.run_id ?? null;
  assert.equal(observedRunId === winnerRunId || detail.reservation_holder !== null, true,
    `the loser must observe the current winner or holder: ${JSON.stringify(detail)}`);
  if (detail.continuation?.next_action === "reissue_subject_dispatch_when_current_attempt_settles") {
    assert.equal(detail.verdict, "live", `only a live attempt may be waited on: ${JSON.stringify(detail)}`);
    assert.equal(observedRunId, winnerRunId);
  }
}

export function assertNoOldHandleStatusRoute(refusal) {
  const detail = refusal.detail ?? {};
  const route = detail.recovery_route ?? "";
  const nextAction = detail.continuation?.next_action ?? "";
  assert.notEqual(route, "workspace_agent_run_status");
  assert.notEqual(route, "workspace_agent_run_wait");
  assert.equal(/run_status|run_wait/.test(route), false, `recovery_route: ${route}`);
  assert.equal(/run_status|run_wait/.test(nextAction), false, `next_action: ${nextAction}`);
}

export function assertTypedNoDeliveryEvidenceFailure(refusal, { code, causeCode = null, causeText = null }) {
  assert.equal(refusal.reason, "managed_run_identity_check_threw", JSON.stringify(refusal));
  assert.notEqual(refusal.reason, "managed_run_prior_attempt_proven_dead");
  const message = refusal.detail?.message ?? "";
  assert.equal(message.includes(code), true, `stable code ${code} is absent from: ${message}`);
  if (causeCode !== null) {
    assert.equal(
      message.includes(`cause=${causeCode}`), true,
      `original cause code ${causeCode} is absent from: ${message}`
    );
  }
  if (causeText !== null) {
    assert.equal(message.includes(causeText), true, `original cause text is absent from: ${message}`);
  }
}

export function readSubjectReservation(repo) {
  const file = managedRunSubjectReservationFilePath(repo, SUBJECT);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

export async function launchedNoDeliveryAttempt(t) {
  const fx = bareFixture(t);
  const ids = idMint();
  const { store } = inMemoryReceiptStore();
  const launches = [];
  const start = reconstructBackend(fx, { procs: ALIVE(), ids, launches, receiptStore: store });
  const launched = await dispatchWorker(start, "start-session");
  assert.equal(launched.accepted, true, JSON.stringify(launched));
  assert.equal(git(fx.repo, "rev-parse", SLICE_REF), git(fx.repo, "rev-parse", `wk/${INITIATIVE}/${WK}`));
  return {
    fx,
    ids,
    store,
    launches,
    launched,
    priorTuple: {
      assigned_unit: SUBJECT, launch_ref: launched.monitor_handle, run_id: launched.run_id, retry_id: 0
    },
    reservationBefore: readSubjectReservation(fx.repo)
  };
}

export function assertNoDeliveryEvidenceFailureMutatedNothing(state) {
  assert.equal(state.launches.filter((entry) => entry.role === "worker").length, 1,
    "no successor worker launches over unresolved no-delivery evidence");
  const record = readManagedRunProcessIdentity({ mainRepo: state.fx.repo, tuple: state.priorTuple });
  assert.equal(record.state, MANAGED_RUN_PROCESS_IDENTITY_STATES.BOUND,
    "the prior attempt is neither retired nor deleted");
  assert.deepEqual(readSubjectReservation(state.fx.repo), state.reservationBefore,
    "no replacement successor reservation is minted");
}

export function sliceRefVerificationSeam(onSliceRefVerify) {
  return (input) => {
    const args = input?.args ?? [];
    if (args[0] === "rev-parse" && args.includes(`${SLICE_REF}^{commit}`)) {
      return onSliceRefVerify();
    }
    return defaultRunGit(input);
  };
}
