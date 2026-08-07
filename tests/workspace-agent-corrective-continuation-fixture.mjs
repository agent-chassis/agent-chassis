

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  publishPendingManagedRunProcessIdentity,
  readManagedRunProcessIdentity
} from "../packages/agent-launch-cli/src/lib/managed-run-process-identity.mjs";
import { bindingFilePath } from "../packages/agent-launch-cli/src/lib/worktree-substrate-identity.mjs";
import {
  deriveExactUnitName,
  wkForkRefName
} from "../packages/agent-launch-cli/src/lib/worktree-substrate-exact-unit.mjs";
import { bindingIdentity } from "../packages/agent-launch-cli/src/lib/worktree-provisioning-dispatch-binding.mjs";
import { WORKTREE_SUBSTRATE_SCHEMA_VERSION } from "../packages/agent-launch-cli/src/lib/worktree-substrate.mjs";
import {
  computeWorkRecordSourceDigest,
  setWorkRecordStatusByUnit
} from "../packages/wiki-core/src/index.mjs";
import { jsonContent } from "../packages/wiki-mcp/src/lib/mcp-response.mjs";
import { registerWorkspaceCommitTool } from "../packages/wiki-mcp/src/lib/workspace-commit-tool.mjs";

export const SUBJECT = "WK-1712#SLICE-001";
export const INITIATIVE = "IN-0042";
export const SLICE_REF = `refs/heads/slice/${INITIATIVE}/WK-1712/SLICE-001`;

const WK_FORK_REF = wkForkRefName(INITIATIVE, "WK-1712");
const WK_UNIT_ADDRESS = `${INITIATIVE}/WK-1712`;
const SLICE_UNIT_ADDRESS = `${INITIATIVE}/WK-1712/SLICE-001`;
export const OLD_TUPLE = Object.freeze({
  assigned_unit: SUBJECT,
  launch_ref: "wkmh_original_worker",
  run_id: "wkdb_original_worker",
  retry_id: 0
});

const WK_RUN_ID = bindingIdentity(OLD_TUPLE.run_id, "wk");
const SLICE_RUN_ID = bindingIdentity(OLD_TUPLE.run_id, "slice");
const BOOT_ID = "11111111-2222-3333-4444-555555555555";

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
      return `${pid} (managed corrective worker) ${tail.join(" ")}`;
    },
    sendSignal: () => assert.fail("corrective dispatch must not signal a process")
  };
}

function writeIdentityBinding(repo, binding) {
  const filePath = bindingFilePath(repo, binding.launch_ref, binding.run_id, binding.retry_id);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(binding, null, 2)}\n`);
  return filePath;
}

function canonicalRecord(status = "todo") {
  return {
    schema_version: "work-record.v1",
    id: "WK-1712",
    repo: "fixture/repo",
    title: "Corrective continuation",
    record_kind: "work_item",
    work_kind: "implementation",
    status: "active",
    priority: "critical",
    owner: "codex",
    created: "2026-07-23",
    updated: "2026-07-23",
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
    acceptance: { criteria: ["Preserve corrective delivery."], validation: ["node --test"] },
    sections: {
      summary: "Corrective continuation.",
      why_it_matters: "Exercises the production composition.",
      scope: { items: ["corrective continuation"], out_of_scope: [] },
      tasks: [], references: [], agent_notes: "", closure: null
    },
    children: [],
    slices: [{
      id: "SLICE-001",
      title: "Corrective delivery",
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

function reviewerFinalResult(findings) {
  const payload = {
    schema_version: "agent-role-result.v1",
    reported_role: "reviewer",
    reported_subject: SUBJECT,
    reported_outcome: findings ? "changes_requested" : "no_findings",
    summary: findings ? "Advisory correction." : "No advisory findings.",
    findings: findings ? [{
      id: "F-001",
      title: "Advisory correction",
      severity: "high",
      blocking: true,
      affected_paths: [{ path: "src/canary.txt", line: 1 }]
    }] : [],
    finding_counts: findings
      ? { total: 1, blocking: 1, critical: 0, high: 1, medium: 0, low: 0, info: 0 }
      : { total: 0, blocking: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 },

    reviewed_controls: [
      { control_id: "max_write_file_loc", result: "pass" },
      { control_id: "write_scope_total_loc", result: "pass" }
    ]
  };
  return {
    schema_version: "workspace-agent-dispatch-final-result.v1",
    kind: findings ? "findings" : "no_findings",
    findings: findings ? { summary: "advisory finding recorded" } : null,
    no_findings: findings ? null : { reason: "clean" },
    missing_result: null,
    full_response: {
      format: "markdown",
      text: `Review.\n\n\`\`\`agent-role-result.v1\n${JSON.stringify(payload, null, 2)}\n\`\`\``,
      source: null
    },
    writeback: { kind: "wk_updated", detail: null }
  };
}

export function structured(result) {
  return result.structuredContent ?? JSON.parse(result.content[0].text);
}

function registerCommit(repo, env) {
  const tools = new Map();
  registerWorkspaceCommitTool({
    registerTool: (name, config, handler) => tools.set(name, { config, handler }),
    workspaceRepos: [{ repo: "fixture/repo", dir: repo }],
    z,
    jsonContent,
    errorContent: (error) => ({
      isError: true,
      content: [{ type: "text", text: error?.message ?? String(error) }]
    }),
    resolveWorkspaceRepo: () => ({ repo: "fixture/repo", dir: repo }),
    createCompactWorkRecordEditResponse: (_workspaceRepo, result) => ({ result }),
    setWorkRecordStatusByUnit,
    env
  });
  return tools.get("commit").handler;
}

export async function fixture(t, {
  unauthenticatedSibling = false,
  cleanReviewsOnly = false,

  alwaysChangesRequested = false,

  canaryBase = "base bytes\n",
  deliveredBytes = "delivered bytes\n"
} = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "corrective-continuation-"));
  const repo = path.join(root, "repo");
  const worktreeRoot = path.join(root, "worktrees");

  const wkName = deriveExactUnitName({ unitAddress: WK_UNIT_ADDRESS, worktreeRoot });
  const sliceName = deriveExactUnitName({ unitAddress: SLICE_UNIT_ADDRESS, worktreeRoot });
  const worktree = sliceName.worktree_path;
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(repo, { recursive: true });
  mkdirSync(worktreeRoot, { recursive: true });
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.name", "Test");
  git(repo, "config", "user.email", "test@example.com");
  mkdirSync(path.join(repo, "wiki", "work-records"), { recursive: true });
  mkdirSync(path.join(repo, "src"), { recursive: true });
  writeFileSync(path.join(repo, "README.md"), "base\n");
  writeFileSync(path.join(repo, "src", "canary.txt"), canaryBase);
  writeFileSync(
    path.join(repo, "wiki", "work-records", "WK-1712.json"),
    `${JSON.stringify(canonicalRecord(), null, 2)}\n`
  );
  writeFileSync(
    path.join(repo, "agent-launch.toml"),
    '[roles.reviewer]\nmodel = "gpt-5.6-terra"\n[roles.worker]\nmodel = "gpt-5.6-terra"\n'
  );
  git(repo, "add", ".");
  git(repo, "commit", "-m", "base");
  const base = git(repo, "rev-parse", "HEAD");
  git(repo, "branch", `wk/${INITIATIVE}/WK-1712`, base);

  git(repo, "update-ref", WK_FORK_REF, base, "");
  assert.equal(git(repo, "rev-parse", WK_FORK_REF), base);
  git(repo, "worktree", "add", wkName.worktree_path, wkName.output_branch);
  git(repo, "worktree", "add", "-b", sliceName.output_branch, worktree, base);
  mkdirSync(path.join(worktree, "src"), { recursive: true });
  writeFileSync(path.join(worktree, "src", "canary.txt"), deliveredBytes);

  const initialProcs = { [process.pid]: "111", 4242: "777" };
  const initialDeps = livenessDeps(initialProcs);
  const reservation = acquireManagedRunSubjectReservation({
    mainRepo: repo, subject: SUBJECT, role: "worker", deps: initialDeps
  });
  const pending = publishPendingManagedRunProcessIdentity({
    mainRepo: repo, tuple: OLD_TUPLE, role: "worker", deps: initialDeps
  });
  attachTupleToManagedRunSubjectReservation({
    mainRepo: repo, reservation: reservation.reservation, tuple: OLD_TUPLE
  });
  bindManagedRunSandboxProcessIdentity(pending, {
    pid: 4242,
    killShape: deriveOuterSandboxKillShape({ pid: 4242 }),
    deps: initialDeps
  });

  const record = canonicalRecord();

  const publishWkBinding = () => writeIdentityBinding(repo, {
    schema_version: WORKTREE_SUBSTRATE_SCHEMA_VERSION,
    launch_ref: OLD_TUPLE.launch_ref,
    run_id: WK_RUN_ID,
    retry_id: 0,
    unit_address: WK_UNIT_ADDRESS,
    initiative: INITIATIVE,
    record_id: "WK-1712",
    slice_id: null,
    base_ref: "main",
    base_sha: base,
    output_branch: wkName.output_branch,
    worktree_path: wkName.worktree_path,
    write_scope: record.write_scope,
    write_scope_source: "wiki/work-records/WK-1712.json",

    wk_tip_sha: git(repo, "rev-parse", `refs/heads/${wkName.output_branch}`)
  });
  writeIdentityBinding(repo, {
    schema_version: "worktree-identity-binding.v2",
    launch_ref: OLD_TUPLE.launch_ref,
    run_id: SLICE_RUN_ID,
    retry_id: 0,
    unit_address: SLICE_UNIT_ADDRESS,
    initiative: INITIATIVE,
    record_id: "WK-1712",
    slice_id: "SLICE-001",
    base_ref: wkName.output_branch,
    base_sha: base,
    output_branch: sliceName.output_branch,
    worktree_path: worktree,
    read_scope: ["src/canary.txt"],
    repo_paths: ["src/canary.txt"],
    write_scope: ["src/canary.txt"],
    write_scope_source: "wiki/work-records/WK-1712.json#SLICE-001",
    selected_unit: {
      kind: "slice", address: SUBJECT, record_id: "WK-1712",
      slice_id: "SLICE-001", repo: "fixture/repo"
    },
    source_digest: computeWorkRecordSourceDigest(record),
    source_version: record.schema_version,
    checkout_mode: "full"
  });
  publishWkBinding();
  const commit = structured(await registerCommit(repo, {
    WIKI_MCP_ASSIGNED_UNIT: SUBJECT,
    WIKI_MCP_COMMIT_LAUNCH_REF: OLD_TUPLE.launch_ref,
    WIKI_MCP_COMMIT_RUN_ID: SLICE_RUN_ID,
    WIKI_MCP_COMMIT_RETRY_ID: "0"
  })({}));
  assert.equal(commit.committed, true, JSON.stringify(commit));
  assert.equal(commit.submitted_for_review, true);

  publishWkBinding();

  if (unauthenticatedSibling) {
    git(worktree, "reset", "--hard", base);
    writeFileSync(path.join(worktree, "src", "canary.txt"), "unauthenticated sibling\n");
    git(worktree, "add", "src/canary.txt");
    git(worktree, "commit", "-m", "caller-authored sibling");
  }

  const receipts = [];
  const launches = [];
  let reviewIndex = 0;
  const currentProcs = { [process.pid]: "999", 5252: "888" };

  let idSequence = 0;

  const exactSliceReviewReceiptStore = {
    loadLatest: async (unitAddress) =>
      [...receipts].reverse().find((receipt) => receipt.unit_address === unitAddress) ?? null,
    loadAll: async ({ unit_address: unitAddress, committed_target_digest: digest }) =>
      receipts.filter((receipt) => receipt.unit_address === unitAddress &&
        (digest === undefined || receipt.committed_target_digest === digest)),
    load: async () => null,
    persist: async (receipt) => { receipts.push(receipt); return receipt; }
  };

  const newBackend = () => createTestDispatchBackend({
    runIdFactory: () => `wkdb_corrective_${idSequence++}`,
    monitorHandleFactory: () => `wkmh_corrective_${idSequence++}`,
    launchExecutor: async (input) => {
      launches.push(input);
      if (input.role === "reviewer") {

        const requestsChanges = cleanReviewsOnly
          ? false
          : (alwaysChangesRequested || reviewIndex++ === 0);
        return {
          accepted: true,
          status: "succeeded",
          final_result: reviewerFinalResult(requestsChanges)
        };
      }
      return {
        accepted: true,
        status: "launching",
        pid: 5252,
        enforcement: { enforced: false },
        probe: async () => ({ status: "running" })
      };
    },
    worktreeProvisioning: { mainRepo: repo, worktreeRoot, confinementAvailable: true },
    requireManagedProvisioning: true,
    postWorkerSliceLifecycle: async () => null,
    managedRunProcessIdentityDeps: livenessDeps(currentProcs),
    exactSliceReviewReceiptStore
  });
  const backend = newBackend();
  return {
    repo,
    worktreeRoot,
    worktree,
    wkWorktree: wkName.worktree_path,
    sliceBranch: sliceName.output_branch,
    base,
    commit,
    backend,
    newBackend,
    launches,
    receipts,
    exactSliceReviewReceiptStore,
    registerCommit: (env) => registerCommit(repo, env),

    currentProcs,
    managedRunProcessIdentityDeps: livenessDeps(currentProcs)
  };
}

export function integrateCommittedSlice(fx, bytes = "delivered bytes\n") {
  writeFileSync(path.join(fx.wkWorktree, "src", "canary.txt"), bytes);
  git(fx.wkWorktree, "add", "src/canary.txt");
  git(fx.wkWorktree, "commit", "-m", "integrate WK-1712#SLICE-001");
  const recordPath = path.join(fx.repo, "wiki", "work-records", "WK-1712.json");
  const record = JSON.parse(readFileSync(recordPath, "utf8"));
  record.status = "review";
  for (const slice of record.slices) {
    if (slice.id === "SLICE-001") slice.status = "done";
  }
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
}

export function clearSubjectReservation(fx) {
  const filePath = managedRunSubjectReservationFilePath(fx.repo, SUBJECT);
  assert.equal(existsSync(filePath), true, "the fixture reserved the subject");
  rmSync(filePath);
  assert.equal(existsSync(filePath), false, "the reservation holder is null");
}

export async function dispatchAdvisoryReviews(fx) {
  const before = fx.receipts.length;
  const prepared = await fx.backend.prepareCanonicalCommittedSliceReviewAdmission({
    subject: SUBJECT,
    workspace_dir: fx.repo
  });
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  for (let index = 0; index < 2; index += 1) {
    const review = await fx.backend.startLaunch({
      caller_session_id: `review-session-${before + index}`,
      role: "reviewer",
      app: "codex",
      subject: SUBJECT,
      workspace_dir: fx.repo,
      readiness: { dispatchable: true }
    });
    assert.equal(review.accepted, true, JSON.stringify(review));
  }

  assert.equal(fx.receipts.length, before + 2);
}

export function reissueWorkerDispatch(backend, caller) {
  return backend.startLaunch({
    caller_session_id: caller,
    role: "worker",
    app: "codex",
    subject: SUBJECT,
    workspace_dir: null,
    readiness: { dispatchable: true, initiative: INITIATIVE }
  });
}

export function readReservationRecord(repo) {
  const filePath = managedRunSubjectReservationFilePath(repo, SUBJECT);
  return existsSync(filePath) ? JSON.parse(readFileSync(filePath, "utf8")) : null;
}

export function captureDurableState(fx) {
  return {
    slice: git(fx.repo, "rev-parse", SLICE_REF),
    wk: git(fx.repo, "rev-parse", `refs/heads/wk/${INITIATIVE}/WK-1712`),
    head: git(fx.worktree, "rev-parse", "HEAD"),
    identity: readManagedRunProcessIdentity({ mainRepo: fx.repo, tuple: OLD_TUPLE }),
    reservation: readReservationRecord(fx.repo),
    workerLaunches: fx.launches.filter((entry) => entry.role === "worker").length
  };
}

export function assertMutatedNothing(fx, before) {
  assert.equal(git(fx.repo, "rev-parse", SLICE_REF), before.slice);
  assert.equal(git(fx.repo, "rev-parse", `refs/heads/wk/${INITIATIVE}/WK-1712`), before.wk);
  assert.equal(git(fx.worktree, "rev-parse", "HEAD"), before.head);
  assert.deepEqual(
    readManagedRunProcessIdentity({ mainRepo: fx.repo, tuple: OLD_TUPLE }),
    before.identity,
    "the proven-dead attempt is neither retired nor deleted"
  );
  assert.deepEqual(readReservationRecord(fx.repo), before.reservation,
    "no successor reservation is minted");
  assert.equal(fx.launches.filter((entry) => entry.role === "worker").length,
    before.workerLaunches, "no remediation worker launches");
}

export function assertTypedCorrectiveFailure(refusal, code) {
  assert.equal(refusal.reason, "managed_run_identity_check_threw", JSON.stringify(refusal));
  assert.notEqual(refusal.reason, "managed_run_prior_attempt_proven_dead");
  assert.equal(refusal.detail?.code, code, JSON.stringify(refusal));
}

export function correctiveReceipt(fx) {
  const receipt = fx.receipts.find((entry) =>
    entry.structured_outcome?.outcome === "changes_requested");
  assert.notEqual(receipt, undefined, "a trusted changes_requested receipt exists");
  return receipt;
}
