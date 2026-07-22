

import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import { z } from "zod";

import {
  TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES,
  TERMINAL_REVIEW_MATERIALIZATION_SCHEMA_VERSION,
  TERMINAL_REVIEW_VERIFY_PARTS
} from "../../../agent-launch-cli/src/lib/host-write-authority-substrate/terminal-review-materialization.mjs";
import {
  defaultIntegrateManagedWorkerSlice,
  SLICE_INTEGRATION_REVIEW_FREEZE_FAILED_CODE
} from "../../../agent-launch-cli/src/lib/host-write-authority-substrate/broker-slice-integration.mjs";
import {
  createWorkspaceAgentDispatchBackend
} from "../../../agent-launch-cli/src/lib/workspace-agent-dispatch-backend.mjs";
import {
  digestTrustedExactReviewEvidence
} from "../../../agent-launch-cli/src/lib/workspace-agent-dispatch-run-receipt.mjs";
import {
  TERMINAL_REVIEW_EVIDENCE_SCHEMA_VERSION
} from "../../../agent-launch-cli/src/lib/host-write-authority-substrate/request-envelopes-integrate-slice.mjs";
import {
  SLICE_REVIEW_SURFACE_PREPARATION_SCHEMA_VERSION,
  SLICE_REVIEW_SURFACE_PREPARATION_VERIFIED_PARTS
} from "../../../agent-launch-cli/src/lib/host-write-authority-substrate/protocol-constants.mjs";
import {
  integrateCommittedSlice,
  reconcileIntegratedSliceRecord
} from "../../../agent-launch-cli/src/lib/slice-integration.mjs";
import {
  buildServerGeneratedCommitMessage
} from "../../../agent-launch-cli/src/lib/commit-tool-exposure-guard.mjs";
import {
  runPostWorkerSliceLifecycle,
  TERMINAL_REVIEW_EVIDENCE_MODES,
  TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES,
  TERMINAL_REVIEW_MATERIALIZER_UNAVAILABLE_CODE
} from "./dispatch-run-monitor-routes.mjs";
import { TERMINAL_REVIEW_POLICY_CONVERTIBLE_CODES } from
  "./dispatch-terminal-review-evidence.mjs";
import {
  POST_WORKER_LIFECYCLE_CHECKPOINT,
  POST_WORKER_LIFECYCLE_PHASES
} from "./dispatch-post-worker-lifecycle-bindings.mjs";
import {
  composePostWorkerSliceLifecycle,
  reviewEnforcementModeForRegisteredTier,
  resolveLauncherOwnedLifecycleDeps
} from "./dispatch-launch-runtime.mjs";
import { registerDispatchTools } from "./dispatch-tools.mjs";
import { errorContent, jsonContent } from "./mcp-response.mjs";

const TMP_ROOT = mkdtempSync(path.join(tmpdir(), "wk1623-slice011-"));
const MAIN_REPO = path.join(TMP_ROOT, "main-repo");
mkdirSync(MAIN_REPO, { recursive: true });
const INITIATIVE = "IN-0030";
const RECORD_ID = "WK-1623";
const SLICE_ID = "SLICE-009";

const WK_WORKTREE = path.join(TMP_ROOT, `wk-${INITIATIVE}-${RECORD_ID}`);

const SLICE_WORKTREE = path.join(TMP_ROOT, `slice-${INITIATIVE}-${RECORD_ID}-${SLICE_ID}`);

const ASSIGNED_UNIT = `${RECORD_ID}#${SLICE_ID}`;
const UNIT_ADDRESS = `${INITIATIVE}/${RECORD_ID}/${SLICE_ID}`;
const WK_UNIT_ADDRESS = `${INITIATIVE}/${RECORD_ID}`;

const LAUNCH_REF = "wkmh_slice011";
const RUN_ID = "run-slice011";
const RETRY_ID = 0;

const BASE_SHA = "a".repeat(40);
const SLICE_COMMIT = "b".repeat(40);
const EARLIER_SLICE_COMMIT = "9".repeat(40);
const DIFF_BASE_SHA = "c".repeat(40);
const REVIEWED_TREE = "d".repeat(40);

const SLICE_REF = `refs/heads/slice/${INITIATIVE}/${RECORD_ID}/${SLICE_ID}`;
const WK_REF = `refs/heads/wk/${INITIATIVE}/${RECORD_ID}`;

const WORKSPACE = { repo: "agent-chassis", dir: MAIN_REPO };

const STATUS = Object.freeze({
  run_id: RUN_ID,
  monitor_handle: LAUNCH_REF,
  role: "worker",
  subject: ASSIGNED_UNIT,
  status: "succeeded",
  terminal: true
});

function sliceBinding(overrides = {}) {
  return {
    schema_version: "worktree-identity-binding.v2",
    launch_ref: LAUNCH_REF,
    run_id: `${RUN_ID}.slice`,
    retry_id: RETRY_ID,
    unit_address: UNIT_ADDRESS,
    initiative: INITIATIVE,
    record_id: RECORD_ID,
    slice_id: SLICE_ID,
    base_ref: `wk/${INITIATIVE}/${RECORD_ID}`,
    base_sha: BASE_SHA,
    output_branch: `slice/${INITIATIVE}/${RECORD_ID}/${SLICE_ID}`,
    worktree_path: SLICE_WORKTREE,
    read_scope: ["AGENTS.md"],
    repo_paths: ["packages/agent-launch-cli/src/lib"],
    write_scope: ["packages/agent-launch-cli/src/lib"],
    write_scope_source: `wiki/work-records/${RECORD_ID}.json#${SLICE_ID}`,
    selected_unit: {
      kind: "slice",
      address: ASSIGNED_UNIT,
      record_id: RECORD_ID,
      slice_id: SLICE_ID,
      repo: null
    },
    source_digest: `sha256:${"e".repeat(64)}`,
    source_version: null,
    checkout_mode: "full",
    ...overrides
  };
}

function wkBinding(overrides = {}) {
  return {
    schema_version: "worktree-identity-binding.v1",
    launch_ref: LAUNCH_REF,
    run_id: `${RUN_ID}.wk`,
    retry_id: RETRY_ID,
    unit_address: WK_UNIT_ADDRESS,
    initiative: INITIATIVE,
    record_id: RECORD_ID,
    slice_id: null,
    base_ref: "refs/heads/main",
    base_sha: BASE_SHA,
    output_branch: `wk/${INITIATIVE}/${RECORD_ID}`,
    worktree_path: WK_WORKTREE,
    write_scope: ["packages/agent-launch-cli/src/lib"],
    write_scope_source: `wiki/work-records/${RECORD_ID}.json`,
    ...overrides
  };
}

function reviewTarget(overrides = {}) {
  return {
    schema_version: "slice-integration.v1",
    unit_address: WK_UNIT_ADDRESS,
    ref: WK_REF,
    sha: SLICE_COMMIT,
    diff_base_sha: DIFF_BASE_SHA,
    diff_head_sha: SLICE_COMMIT,
    diff_range: `${DIFF_BASE_SHA}..${SLICE_COMMIT}`,
    complete_parent_wk_contract: true,
    accumulated_wk_diff: true,
    ...overrides
  };
}

function materializationAttestation(overrides = {}) {
  return {
    schema_version: TERMINAL_REVIEW_MATERIALIZATION_SCHEMA_VERSION,
    worktree_path: WK_WORKTREE,
    wk_ref: WK_REF,
    reviewed_sha: SLICE_COMMIT,
    reviewed_tree: REVIEWED_TREE,
    verified: true,
    verified_parts: TERMINAL_REVIEW_VERIFY_PARTS,
    ...overrides
  };
}

function terminalReviewEvidence(overrides = {}) {
  return {
    schema_version: TERMINAL_REVIEW_EVIDENCE_SCHEMA_VERSION,
    materialization: materializationAttestation(),
    review_target: reviewTarget(),
    run: {
      assigned_unit: ASSIGNED_UNIT,
      launch_ref: LAUNCH_REF,
      run_id: RUN_ID,
      retry_id: RETRY_ID
    },
    wk_binding: {
      schema_version: "worktree-identity-binding.v1",
      run_id: `${RUN_ID}.wk`,
      retry_id: RETRY_ID,
      unit_address: WK_UNIT_ADDRESS,
      output_branch: `wk/${INITIATIVE}/${RECORD_ID}`,
      worktree_path: WK_WORKTREE,
      base_ref: "refs/heads/main",
      base_sha: BASE_SHA
    },
    ...overrides
  };
}

function integrationResult({ evidence, recovered = false } = {}) {
  return {
    schema_version: "slice-integration.v1",
    integrated: true,
    rebased: false,
    previous_wk_sha: BASE_SHA,
    slice_ref: SLICE_REF,
    slice_sha: SLICE_COMMIT,
    wk_ref: WK_REF,
    wk_sha: SLICE_COMMIT,
    review_target: reviewTarget(),
    transition: { status: "review" },
    ...(recovered ? { recovered: true } : {}),
    ...(evidence === undefined ? {} : { terminal_review_evidence: evidence })
  };
}

function recoveredEarlierSliceResult() {
  const recovered = integrationResult({ evidence: undefined, recovered: true });
  recovered.slice_sha = EARLIER_SLICE_COMMIT;
  recovered.review_target = null;
  recovered.transition = { status: "done", recovered: true };
  recovered.integrated_state = "non_final";
  return recovered;
}

function createFakeGit({
  headTree = REVIEWED_TREE,
  symbolicHead = WK_REF,
  canonicalWkSha = SLICE_COMMIT
} = {}) {
  return ({ repo, args }) => {
    const key = args.join(" ");
    if (repo === MAIN_REPO) {
      if (key === `rev-parse --verify ${WK_REF}^{commit}`) return { ok: true, stdout: `${canonicalWkSha}\n` };
      if (key === `rev-parse --verify ${SLICE_REF}^{commit}`) return { ok: true, stdout: `${SLICE_COMMIT}\n` };
      if (key === `rev-parse --verify ${SLICE_COMMIT}^{tree}`) return { ok: true, stdout: `${REVIEWED_TREE}\n` };
      if (key === "rev-parse --verify refs/heads/main^{commit}") return { ok: true, stdout: `${DIFF_BASE_SHA}\n` };
      if (args[0] === "merge-base") return { ok: true, stdout: `${DIFF_BASE_SHA}\n` };
      if (args[0] === "worktree") return { ok: true, stdout: "" };
    }
    if (repo === WK_WORKTREE) {
      if (key === "symbolic-ref --quiet HEAD") return { ok: true, stdout: `${symbolicHead}\n` };
      if (key === `rev-parse --verify ${WK_REF}^{commit}`) return { ok: true, stdout: `${SLICE_COMMIT}\n` };
      if (key === "rev-parse --verify HEAD^{commit}") return { ok: true, stdout: `${SLICE_COMMIT}\n` };
      if (key === `rev-parse --verify ${SLICE_COMMIT}^{tree}`) return { ok: true, stdout: `${REVIEWED_TREE}\n` };
      if (key === "rev-parse --verify HEAD^{tree}") return { ok: true, stdout: `${headTree}\n` };
      if (key === "write-tree") return { ok: true, stdout: `${headTree}\n` };
      if (args[0] === "diff") return { ok: true, stdout: "" };
      if (key === "ls-files --others --exclude-standard") return { ok: true, stdout: "" };
    }
    if (repo === SLICE_WORKTREE) {
      if (key === `rev-parse --verify ${SLICE_REF}^{commit}`) {
        return { ok: true, stdout: `${SLICE_COMMIT}\n` };
      }
      if (key === `rev-parse --verify ${SLICE_COMMIT}^{tree}`) {
        return { ok: true, stdout: `${REVIEWED_TREE}\n` };
      }
    }
    return { ok: false, status: 1, stderr: `unexpected git: ${repo} :: ${key}` };
  };
}

function realGit(repo, ...args) {
  const result = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function runRealGit({ repo, args }) {
  const result = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  return result.status === 0
    ? { ok: true, stdout: result.stdout }
    : { ok: false, status: result.status, stdout: result.stdout, stderr: result.stderr };
}

async function buildRealTwoSliceRecoveryHistory() {
  const root = mkdtempSync(path.join(tmpdir(), "wk1623-terminal-ownership-"));
  const repo = path.join(root, "repo");
  const init = spawnSync("git", ["init", "-q", repo], { encoding: "utf8" });
  if (init.status !== 0) throw new Error(`git init failed: ${init.stderr || init.stdout}`);
  realGit(repo, "config", "user.name", "Terminal Ownership Test");
  realGit(repo, "config", "user.email", "terminal-ownership@example.com");
  realGit(repo, "config", "commit.gpgsign", "false");
  writeFileSync(path.join(repo, "base.txt"), "base\n");
  realGit(repo, "add", "base.txt");
  realGit(repo, "commit", "-qm", "base");
  realGit(repo, "branch", "-M", "main");

  const baseSha = realGit(repo, "rev-parse", "HEAD");
  const wkBranch = `wk/${INITIATIVE}/${RECORD_ID}`;
  const wkRef = `refs/heads/${wkBranch}`;
  realGit(repo, "branch", wkBranch, baseSha);

  const sliceIds = ["SLICE-001", "SLICE-002"];
  const slices = {};
  for (const sliceId of sliceIds) {
    const branch = `slice/${INITIATIVE}/${RECORD_ID}/${sliceId}`;
    const worktreePath = path.join(root, `slice-${sliceId}`);
    realGit(repo, "worktree", "add", "-q", "-b", branch, worktreePath, baseSha);
    writeFileSync(path.join(worktreePath, `${sliceId}.txt`), `${sliceId}\n`);
    realGit(worktreePath, "add", `${sliceId}.txt`);
    realGit(worktreePath, "commit", "-qm", buildServerGeneratedCommitMessage({
      subject: `${RECORD_ID}#${sliceId}`,
      base_sha: baseSha
    }));
    slices[sliceId] = {
      branch,
      ref: `refs/heads/${branch}`,
      worktree_path: worktreePath,
      commit: realGit(worktreePath, "rev-parse", "HEAD")
    };
  }

  const record = {
    schema_version: "work-record.v1",
    id: RECORD_ID,
    initiative: INITIATIVE,
    status: "in_progress",
    updated: "2026-07-20",
    slices: sliceIds.map((id) => ({
      id,
      status: "review",
      work_kind: "implementation",
      depends_on: []
    }))
  };
  const loadRecord = () => JSON.parse(JSON.stringify(record));
  const writeStatus = async ({ unitAddress, status }) => {
    if (unitAddress.includes("#")) {
      record.slices.find((slice) => slice.id === unitAddress.split("#")[1]).status = status;
    } else {
      record.status = status;
    }
    record.updated = record.updated === "2026-07-20" ? "2026-07-21" : "2026-07-20";
    return { valid: true, written: true, no_op: false, status };
  };
  const integrate = (sliceId) => integrateCommittedSlice({
    mainRepo: repo,
    worktreePath: slices[sliceId].worktree_path,
    unitAddress: `${INITIATIVE}/${RECORD_ID}/${sliceId}`,
    sliceRef: slices[sliceId].branch,
    wkRef: wkBranch,
    baseSha,
    commit: slices[sliceId].commit,
    workerTerminated: true,
    transitionToReview: writeStatus,
    markSliceComplete: writeStatus,
    reviewEnforcementMode: "policy_only",
    deps: { runGit: runRealGit, loadCanonicalRecord: loadRecord }
  });

  const first = await integrate("SLICE-001");
  const final = await integrate("SLICE-002");
  assert.equal(first.review_target, null);
  assert.notEqual(first.slice_sha, final.wk_sha);
  realGit(repo, "merge-base", "--is-ancestor", first.slice_sha, final.wk_sha);
  assert.equal(final.slice_sha, final.wk_sha);
  assert.equal(realGit(repo, "rev-parse", wkRef), final.wk_sha);
  assert.notEqual(final.review_target, null);
  assert.equal(record.status, "review");

  const recordDir = path.join(repo, "wiki", "work-records");
  mkdirSync(recordDir, { recursive: true });
  writeFileSync(path.join(recordDir, `${RECORD_ID}.json`), `${JSON.stringify(record, null, 2)}\n`);
  const recover = (sliceId) => reconcileIntegratedSliceRecord({
    mainRepo: repo,
    unitAddress: `${INITIATIVE}/${RECORD_ID}/${sliceId}`,
    sliceRef: slices[sliceId].ref,
    wkRef,
    deps: { runGit: runRealGit }
  });
  const recoveredA = recover("SLICE-001");
  const recoveredB = recover("SLICE-002");
  assert.equal(recoveredA.slice_sha, first.slice_sha);
  assert.equal(recoveredA.wk_sha, final.wk_sha);
  assert.equal(recoveredA.review_target, null);
  assert.equal(recoveredA.integrated_state, "non_final");
  assert.equal(recoveredB.slice_sha, final.wk_sha);
  assert.deepEqual(recoveredB.review_target, final.review_target);

  return {
    repo,
    base_sha: baseSha,
    wk_ref: wkRef,
    wk_branch: wkBranch,
    wk_worktree_path: path.join(root, "wk-review-worktree"),
    slices,
    record,
    first,
    final,
    recoveredA,
    recoveredB,
    reviewed_tree: realGit(repo, "rev-parse", `${final.wk_sha}^{tree}`)
  };
}

function realRecoveryBindings(history, sliceId) {
  const subject = `${RECORD_ID}#${sliceId}`;
  const slice = history.slices[sliceId];
  const sliceIdentity = {
    ...sliceBinding(),
    unit_address: `${INITIATIVE}/${RECORD_ID}/${sliceId}`,
    record_id: RECORD_ID,
    slice_id: sliceId,
    base_sha: history.base_sha,
    output_branch: slice.branch,
    worktree_path: slice.worktree_path,
    selected_unit: {
      kind: "slice",
      address: subject,
      record_id: RECORD_ID,
      slice_id: sliceId,
      repo: null
    }
  };
  const wkIdentity = {
    ...wkBinding(),
    base_sha: history.base_sha,
    output_branch: history.wk_branch,
    worktree_path: history.wk_worktree_path
  };
  return {
    subject,
    slice: sliceIdentity,
    wk: wkIdentity,
    provisioning: {
      record_id: RECORD_ID,
      slice_id: sliceId,
      slice_binding: sliceIdentity,
      wk_binding: wkIdentity,
      validation_worktree_path: history.wk_worktree_path
    }
  };
}

function realRecoveryEvidence(history, bindings) {
  const target = history.final.review_target;
  return {
    schema_version: TERMINAL_REVIEW_EVIDENCE_SCHEMA_VERSION,
    materialization: {
      schema_version: TERMINAL_REVIEW_MATERIALIZATION_SCHEMA_VERSION,
      worktree_path: history.wk_worktree_path,
      wk_ref: history.wk_ref,
      reviewed_sha: history.final.wk_sha,
      reviewed_tree: history.reviewed_tree,
      verified: true,
      verified_parts: TERMINAL_REVIEW_VERIFY_PARTS
    },
    review_target: target,
    run: {
      assigned_unit: bindings.subject,
      launch_ref: LAUNCH_REF,
      run_id: RUN_ID,
      retry_id: RETRY_ID
    },
    wk_binding: {
      schema_version: bindings.wk.schema_version,
      run_id: bindings.wk.run_id,
      retry_id: bindings.wk.retry_id,
      unit_address: bindings.wk.unit_address,
      output_branch: bindings.wk.output_branch,
      worktree_path: bindings.wk.worktree_path,
      base_ref: bindings.wk.base_ref,
      base_sha: bindings.wk.base_sha
    }
  };
}

function runRealRecoveredLifecycle({ history, sliceId, integration, enforcementMode }) {
  const bindings = realRecoveryBindings(history, sliceId);
  const counters = {
    integration_replays: 0,
    canonical_reads: 0,
    context_bindings: 0,
    status_writes: 0
  };
  const status = {
    run_id: RUN_ID,
    monitor_handle: LAUNCH_REF,
    role: "worker",
    subject: bindings.subject,
    status: "succeeded",
    terminal: true
  };
  Object.defineProperty(status, POST_WORKER_LIFECYCLE_CHECKPOINT, {
    value: {
      phase: POST_WORKER_LIFECYCLE_PHASES.INTEGRATED,
      integration,
      slice_review: null,
      finalized: null,
      in_flight: null
    }
  });
  const lifecycle = composePostWorkerSliceLifecycle({
    worktreeProvisioning: { mainRepo: history.repo },
    reviewEnforcementMode: enforcementMode,
    hostSliceIntegrationAdapter: async () => {
      counters.integration_replays += 1;
      throw new Error("terminal ownership guard must precede integration replay");
    }
  });
  const promise = lifecycle({
    workspace: { repo: "agent-chassis", dir: history.repo },
    status,
    deps: {
      runGit: runRealGit,
      resolveManagedRunBinding: () => bindings.provisioning,
      resolveCanonicalReviewUnit: () => {
        counters.canonical_reads += 1;
        return {
          record_id: RECORD_ID,
          initiative: INITIATIVE,
          subject: `${RECORD_ID}#SLICE-020`,
          parent_status: history.record.status,
          canonical_parent_wk_contract: JSON.stringify(history.record)
        };
      },
      bindFrozenReviewContext: () => {
        counters.context_bindings += 1;
        return { schema_version: "workspace-agent-frozen-wk-review-context.v1" };
      },
      setWorkRecordStatusByUnit: async () => {
        counters.status_writes += 1;
        throw new Error("terminal ownership guard must precede status mutation");
      }
    }
  });
  return { promise, counters, bindings };
}

function callerDeps({ bind, integration, git = createFakeGit(), extra = {} } = {}) {
  return {
    resolveManagedRunBinding: () => ({
      record_id: RECORD_ID,
      slice_id: SLICE_ID,
      slice_binding: sliceBinding(),
      wk_binding: wkBinding(),
      validation_worktree_path: WK_WORKTREE
    }),
    resolveCanonicalReviewUnit: () => ({
      record_id: RECORD_ID,
      initiative: INITIATIVE,
      subject: `${RECORD_ID}#SLICE-020`,
      unit_contract: "canonical-review"
    }),

    resolveCanonicalSliceReviewUnit: () => ({
      record_id: RECORD_ID,
      initiative: INITIATIVE,
      slice_id: SLICE_ID,
      subject: ASSIGNED_UNIT,
      work_kind: "implementation"
    }),
    bindFrozenSliceReviewContext: () => ({
      schema_version: "workspace-agent-frozen-slice-review-context.v1",
      worktree_path: SLICE_WORKTREE
    }),
    resolveSliceReviewAcceptanceBinding: () => ({
      schema_version: "workspace-agent-slice-review-binding.v1",
      reviewed_sha: SLICE_COMMIT
    }),
    runGit: git,
    reconcileIntegratedSliceRecord: () => null,

    integrateCommittedSlice: async () => integration,
    setWorkRecordStatusByUnit: async () => ({ valid: true, written: true }),

    bindFrozenReviewContext: (input) => {
      bind?.push(input);
      return { schema_version: "workspace-agent-frozen-wk-review-context.v1" };
    },
    ...extra
  };
}

function launcherOwnedDirectIntegrationAdapter(deps) {
  return async (request) => {
    const integrated = (await deps.integrateCommittedSlice({ request })) ??
      deps.reconcileIntegratedSliceRecord?.({ request }) ?? null;
    if (!integrated || integrated.integrated !== true) {
      throw new Error("direct slice integration returned no successful trusted result");
    }
    return { accepted: true, integration: { ...integrated, tuple: request } };
  };
}

function productionShapedSliceReviewPreparationAdapter(deps) {
  return async (request) => {
    const provisioning = deps.resolveManagedRunBinding();
    const binding = provisioning?.slice_binding;
    const sliceRef = binding?.output_branch?.startsWith("refs/heads/")
      ? binding.output_branch
      : `refs/heads/${binding?.output_branch ?? ""}`;
    const qualifiedRunId = binding?.run_id;
    const runId = typeof qualifiedRunId === "string" && qualifiedRunId.endsWith(".slice")
      ? qualifiedRunId.slice(0, -".slice".length)
      : null;
    const expectedRequest = {
      assigned_unit: `${binding?.record_id ?? ""}#${binding?.slice_id ?? ""}`,
      launch_ref: binding?.launch_ref,
      run_id: runId,
      retry_id: binding?.retry_id
    };
    assert.deepEqual(Object.keys(request), ["assigned_unit", "launch_ref", "run_id", "retry_id"]);
    assert.deepEqual(request, expectedRequest);
    const reviewed = deps.runGit({
      repo: MAIN_REPO,
      args: ["rev-parse", "--verify", `${sliceRef}^{commit}`]
    });
    assert.equal(reviewed?.ok, true);
    const reviewedSha = String(reviewed.stdout ?? "").trim();
    const tree = deps.runGit({
      repo: MAIN_REPO,
      args: ["rev-parse", "--verify", `${reviewedSha}^{tree}`]
    });
    assert.equal(tree?.ok, true);
    const reviewedTree = String(tree.stdout ?? "").trim();
    return {
      accepted: true,
      preparation: {
        schema_version: SLICE_REVIEW_SURFACE_PREPARATION_SCHEMA_VERSION,
        ...expectedRequest,
        worktree_identity_digest: digestTrustedExactReviewEvidence(binding),
        worktree_path: binding.worktree_path,
        slice_ref: sliceRef,
        base_sha: binding.base_sha,
        reviewed_sha: reviewedSha,
        reviewed_tree: reviewedTree,
        verified_parts: [...SLICE_REVIEW_SURFACE_PREPARATION_VERIFIED_PARTS]
      }
    };
  };
}

function lifecycleThroughPublicBackend({ lifecycle, environmentDeps }) {
  const backend = createWorkspaceAgentDispatchBackend({
    __testHooks: true,
    launchExecutor: async () => ({
      accepted: true,
      status: "running",
      probe: async () => ({ status: "running" })
    }),
    worktreeProvisioning: {
      mainRepo: MAIN_REPO,
      worktreeRoot: path.join(TMP_ROOT, "managed-worktrees")
    },
    postWorkerSliceLifecycle: ({ workspace, status, deps }) => lifecycle({
      workspace,
      status,
      deps: { ...deps, ...environmentDeps }
    })
  });
  return () => backend.runPostWorkerSliceLifecycle({ workspace: WORKSPACE, status: STATUS });
}

function composedLifecycle(options = {}) {
  const { broker, adapter, reviewEnforcementMode = "enforced_cce" } = options;
  return ({ deps }) => {
    const preparationAdapter = Object.prototype.hasOwnProperty.call(
      options,
      "hostSliceReviewPreparationAdapter"
    )
      ? options.hostSliceReviewPreparationAdapter
      : productionShapedSliceReviewPreparationAdapter(deps);

    const directAdapter = broker ? null : launcherOwnedDirectIntegrationAdapter(deps);
    const lifecycle = composePostWorkerSliceLifecycle({
      worktreeProvisioning: { mainRepo: MAIN_REPO },
      hostSliceIntegrationAdapter: broker ? adapter : undefined,
      directSliceIntegrationAdapter: directAdapter,
      hostSliceReviewPreparationAdapter: preparationAdapter,
      reviewEnforcementMode
    });
    return lifecycleThroughPublicBackend({
      lifecycle,
      environmentDeps: deps
    })();
  };
}

function lifecycleWithLauncherDeps(launcherDeps) {
  return ({ deps }) => {
    const withPreparation = Object.prototype.hasOwnProperty.call(
      launcherDeps,
      "hostSliceReviewPreparationAdapter"
    )
      ? launcherDeps
      : {
          ...launcherDeps,
          hostSliceReviewPreparationAdapter: productionShapedSliceReviewPreparationAdapter(deps)
        };

    const launcherOwned = Object.prototype.hasOwnProperty.call(
      launcherDeps,
      "hostSliceIntegrationAdapter"
    )
      ? withPreparation
      : {
          ...withPreparation,
          hostSliceIntegrationAdapter: launcherOwnedDirectIntegrationAdapter(deps)
        };
    return lifecycleThroughPublicBackend({
      lifecycle: ({ workspace, status, deps: publicDeps }) => runPostWorkerSliceLifecycle({
        workspace,
        status,
        deps: { ...publicDeps, ...launcherOwned }
      }),
      environmentDeps: deps
    })();
  };
}

function brokerAdapterReturning(integration) {
  return async () => ({ accepted: true, integration });
}

async function refusalCode(promise) {
  const error = await promise.then(
    () => null,
    (err) => err
  );
  assert.ok(error, "expected the lifecycle to refuse, but it resolved");
  return error.code;
}

function canonicalReviewRecord(status) {
  return {
    id: RECORD_ID,
    initiative: INITIATIVE,
    status,
    slices: [{
      id: "SLICE-020",
      work_kind: "review",
      review_purpose: "terminal_whole_wk",
      status: "todo",
      write_scope: [],
      dispatch_intent: { intended_agent_role: "reviewer", target_unit: "slice" }
    }]
  };
}

function policyCallerDeps({
  bind = [],
  integration = integrationResult({ evidence: undefined }),
  reconciliations = null,
  parentStatus = "review",
  git = createFakeGit(),
  statusTransition = null,
  extra = {}
} = {}) {
  const state = {
    parentStatus,
    statusWrites: [],
    reconciliationCalls: 0,
    canonicalReads: 0
  };
  const defaultRecovered = () => {
    const recovered = integrationResult({ evidence: undefined, recovered: true });
    if (state.parentStatus === "done") {
      recovered.review_target = null;
      recovered.integrated_state = "non_final";
      recovered.transition = { status: "done", recovered: true };
    }
    return recovered;
  };
  const queue = Array.isArray(reconciliations) ? [...reconciliations] : null;
  const deps = callerDeps({
    bind,
    integration,
    git,
    extra: {
      resolveCanonicalReviewUnit: () => {
        state.canonicalReads += 1;
        const record = canonicalReviewRecord(state.parentStatus);
        return {
          record_id: RECORD_ID,
          initiative: INITIATIVE,
          subject: `${RECORD_ID}#SLICE-020`,
          parent_status: state.parentStatus,
          canonical_parent_wk_contract: JSON.stringify(record),
          review_unit_contract: JSON.stringify(record.slices[0])
        };
      },
      reconcileIntegratedSliceRecord: () => {
        state.reconciliationCalls += 1;
        if (queue !== null && queue.length > 0) {
          const next = queue.shift();
          return typeof next === "function" ? next(state) : next;
        }
        return defaultRecovered();
      },
      setWorkRecordStatusByUnit: async (input) => {
        state.statusWrites.push(input);
        if (typeof statusTransition === "function") return statusTransition(input, state);
        state.parentStatus = "done";
        return {
          valid: true,
          written: true,
          no_op: false,
          status: "done",
          diagnostics: []
        };
      },
      ...extra
    }
  });
  return { deps, state, bind };
}

function assertPolicyOnlyNoReviewer(result, { code, bind, state, statusDisposition = "review_to_done" }) {
  assert.equal(result.phase, "finalized");
  assert.equal(result.integrated, true);
  assert.equal(result.reviewer_dispatch, null);
  assert.equal(bind.length, 0, "no frozen whole-WK review context may bind");
  assert.equal(result.terminal_review_policy.enforcement_mode, "policy_only");
  assert.equal(result.terminal_review_policy.reviewer_launched, false);
  assert.equal(result.terminal_review_policy.evidence_enforced, false);
  assert.equal(result.terminal_review_policy.audit_disposition, "non_audit");
  assert.equal(result.terminal_review_policy.cause.code, code);
  assert.equal(result.terminal_review_policy.status_disposition, statusDisposition);
  assert.equal(state.parentStatus, "done");
  const serialized = JSON.stringify(result);
  for (const forbidden of [
    "slice_review_acceptance", "reviewer_identity", "review_run_identity",
    "proof_a", "clean_review", '"accepted"', "cce_verdict", "audit_grade"
  ]) {
    assert.equal(serialized.includes(forbidden), false, `policy disposition must not carry ${forbidden}`);
  }
}

function upstreamBrokerMaterializationRefusal(
  materializationCode = TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.VERIFY_FAILED
) {
  return {
    accepted: false,
    refusal: {
      code: "launch_failed_before_start",
      reason: "broker_refused",
      detail: {
        broker_refusal_code: "broker_plan_threw",
        broker_refusal_reason: "broker_integration_latched_indeterminate",
        broker_refusal_detail: {
          message: `materialization failed (${materializationCode})`,
          code: SLICE_INTEGRATION_REVIEW_FREEZE_FAILED_CODE,
          latched_failed_indeterminate: true,
          error_detail: {
            materialization_code: materializationCode,
            materialization_detail: { part: "write_tree_is_frozen_tree" }
          }
        }
      }
    }
  };
}

test("the launcher-owned composition root pairs each route with exactly one evidence mode", () => {
  const direct = resolveLauncherOwnedLifecycleDeps({ worktreeProvisioning: { mainRepo: MAIN_REPO } });
  assert.equal(direct.terminalReviewEvidenceMode, TERMINAL_REVIEW_EVIDENCE_MODES.LIVE_MATERIALIZER);
  assert.equal(typeof direct.materializeTerminalReviewWorktree, "function");

  const broker = resolveLauncherOwnedLifecycleDeps({
    worktreeProvisioning: { mainRepo: MAIN_REPO },
    hostSliceIntegrationAdapter: () => {}
  });
  assert.equal(broker.terminalReviewEvidenceMode, TERMINAL_REVIEW_EVIDENCE_MODES.TRANSPORTED_ATTESTATION);

  assert.equal("materializeTerminalReviewWorktree" in broker, false);

  assert.equal("terminalReviewEvidenceMode" in resolveLauncherOwnedLifecycleDeps({}), false);
});

test("a caller cannot select, narrow, or forge the evidence mode", async () => {
  const captured = [];
  const lifecycle = composePostWorkerSliceLifecycle({
    worktreeProvisioning: { mainRepo: MAIN_REPO },
    hostSliceIntegrationAdapter: () => {},
    lifecycle: async ({ deps }) => { captured.push(deps); return null; }
  });
  await lifecycle({
    workspace: WORKSPACE,
    status: STATUS,
    deps: {

      terminalReviewEvidenceMode: TERMINAL_REVIEW_EVIDENCE_MODES.LIVE_MATERIALIZER,
      materializeTerminalReviewWorktree: () => materializationAttestation(),
      callerExtra: 1
    }
  });
  assert.equal(captured[0].terminalReviewEvidenceMode,
    TERMINAL_REVIEW_EVIDENCE_MODES.TRANSPORTED_ATTESTATION,
    "the launcher-owned mode must win over a caller-supplied one");

  assert.equal(captured[0].callerExtra, 1);
});

test("WK-1623#SLICE-011 the DIRECT composition now carries a launcher-owned integration adapter with the live materializer", () => {
  const directAdapter = async () => ({ accepted: true });
  const direct = resolveLauncherOwnedLifecycleDeps({
    worktreeProvisioning: { mainRepo: MAIN_REPO },
    hostSliceIntegrationAdapter: null,
    directSliceIntegrationAdapter: directAdapter
  });

  assert.equal(direct.hostSliceIntegrationAdapter, directAdapter,
    "the launcher-owned direct adapter must reach the lifecycle's integration seam");

  assert.equal(direct.terminalReviewEvidenceMode, TERMINAL_REVIEW_EVIDENCE_MODES.LIVE_MATERIALIZER);
  assert.equal(typeof direct.materializeTerminalReviewWorktree, "function");
});

test("WK-1623#SLICE-011 evidence mode is derived from COMPOSITION, not from whether an adapter exists", () => {

  const brokerAdapter = async () => ({ accepted: true });
  const directAdapter = async () => ({ accepted: true });

  const broker = resolveLauncherOwnedLifecycleDeps({
    worktreeProvisioning: { mainRepo: MAIN_REPO },
    hostSliceIntegrationAdapter: brokerAdapter
  });
  assert.equal(broker.terminalReviewEvidenceMode, TERMINAL_REVIEW_EVIDENCE_MODES.TRANSPORTED_ATTESTATION);
  assert.equal(broker.hostSliceIntegrationAdapter, brokerAdapter);
  assert.equal("materializeTerminalReviewWorktree" in broker, false,
    "the broker composition still composes NO materializer");

  const direct = resolveLauncherOwnedLifecycleDeps({
    worktreeProvisioning: { mainRepo: MAIN_REPO },
    directSliceIntegrationAdapter: directAdapter
  });
  assert.equal(direct.terminalReviewEvidenceMode, TERMINAL_REVIEW_EVIDENCE_MODES.LIVE_MATERIALIZER);

  const both = resolveLauncherOwnedLifecycleDeps({
    worktreeProvisioning: { mainRepo: MAIN_REPO },
    hostSliceIntegrationAdapter: brokerAdapter,
    directSliceIntegrationAdapter: directAdapter
  });
  assert.equal(both.terminalReviewEvidenceMode, TERMINAL_REVIEW_EVIDENCE_MODES.TRANSPORTED_ATTESTATION);
  assert.equal(both.hostSliceIntegrationAdapter, brokerAdapter,
    "the broker adapter must win; a direct adapter never serves a transported route");
});

test("WK-1623#SLICE-011 an INCOMPLETE direct composition still fails closed rather than inventing an adapter", () => {

  const incomplete = resolveLauncherOwnedLifecycleDeps({
    worktreeProvisioning: { mainRepo: MAIN_REPO }
  });
  assert.equal("hostSliceIntegrationAdapter" in incomplete, false);
  assert.equal(incomplete.terminalReviewEvidenceMode, TERMINAL_REVIEW_EVIDENCE_MODES.LIVE_MATERIALIZER);
});

test("WK-1623#SLICE-011 a caller cannot omit, replace, or weaken the launcher-owned direct adapter", async () => {
  const launcherOwned = async () => ({ accepted: true, integration: { launcher: true } });
  const callerSupplied = async () => ({ accepted: true, integration: { caller: true } });
  const captured = [];
  const lifecycle = composePostWorkerSliceLifecycle({
    worktreeProvisioning: { mainRepo: MAIN_REPO },
    hostSliceIntegrationAdapter: null,
    directSliceIntegrationAdapter: launcherOwned,
    lifecycle: async ({ deps }) => { captured.push(deps); return null; }
  });
  await lifecycle({
    workspace: WORKSPACE,
    status: STATUS,
    deps: {

      hostSliceIntegrationAdapter: callerSupplied,
      terminalReviewEvidenceMode: TERMINAL_REVIEW_EVIDENCE_MODES.TRANSPORTED_ATTESTATION,
      materializeTerminalReviewWorktree: () => materializationAttestation()
    }
  });
  assert.equal(captured[0].hostSliceIntegrationAdapter, launcherOwned,
    "launcher-owned deps are spread last, so the caller's adapter cannot replace it");
  assert.equal(captured[0].terminalReviewEvidenceMode,
    TERMINAL_REVIEW_EVIDENCE_MODES.LIVE_MATERIALIZER,
    "nor can a caller convert the direct composition into a transported one");
});

test("an unrecognized or absent evidence mode refuses before the review context is bound", async () => {
  const bind = [];
  for (const mode of [undefined, null, "", "live", "transported_attestation_v2", 7]) {
    const lifecycle = lifecycleWithLauncherDeps(
      mode === undefined ? {} : { terminalReviewEvidenceMode: mode }
    );
    const code = await refusalCode(lifecycle({
      deps: callerDeps({ bind, integration: integrationResult({ evidence: terminalReviewEvidence() }) })
    }));
    assert.equal(code, TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.MODE_UNAVAILABLE, `mode: ${String(mode)}`);
  }
  assert.equal(bind.length, 0, "no review context may be bound on a refused mode");
});

test("BROKER: a valid bound attestation satisfies the guard and the reviewer launches", async () => {
  const bind = [];

  const minted = integrationResult({ evidence: terminalReviewEvidence() });
  assert.equal(minted.terminal_review_evidence.schema_version, TERMINAL_REVIEW_EVIDENCE_SCHEMA_VERSION);

  const lifecycle = composedLifecycle({ broker: true, adapter: brokerAdapterReturning(minted) });
  const finalized = await lifecycle({
    workspace: WORKSPACE,
    status: STATUS,
    deps: callerDeps({ bind, integration: null })
  });

  assert.equal(finalized.phase, "finalized");
  assert.equal(finalized.wk_transitioned_to_review, true);
  assert.equal(finalized.reviewer_dispatch.args.role, "reviewer");
  assert.equal(bind.length, 1, "the review context binds exactly once");

  assert.equal(finalized.terminal_review_materialization.reviewed_sha, SLICE_COMMIT);
  assert.equal(finalized.terminal_review_materialization.worktree_path, WK_WORKTREE);
  assert.deepEqual(
    finalized.reviewer_dispatch.context.terminal_review_materialization,
    finalized.terminal_review_materialization
  );
});

test("BROKER: an ABSENT or NULL transported attestation refuses and launches no reviewer", async () => {
  for (const evidence of [undefined, null]) {
    const bind = [];
    const lifecycle = composedLifecycle({
      broker: true,
      adapter: brokerAdapterReturning(integrationResult({ evidence }))
    });
    const code = await refusalCode(lifecycle({
      workspace: WORKSPACE, status: STATUS, deps: callerDeps({ bind, integration: null })
    }));
    assert.equal(code, TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.TRANSPORTED_EVIDENCE_MISSING);
    assert.equal(bind.length, 0);
  }
});

test("BROKER: a MALFORMED transported attestation refuses", async () => {
  const cases = [
    ["extra field", { ...terminalReviewEvidence(), extra: 1 }],
    ["missing field", (() => { const e = terminalReviewEvidence(); delete e.wk_binding; return e; })()],
    ["unknown schema", terminalReviewEvidence({ schema_version: "agent_launch.terminal_review_evidence.v2" })],
    ["null review target", terminalReviewEvidence({ review_target: null })],
    ["null run binding", terminalReviewEvidence({ run: null })],
    ["null WK binding", terminalReviewEvidence({ wk_binding: null })],
    ["not an object", "proof"],
    ["array", [terminalReviewEvidence()]]
  ];
  for (const [label, evidence] of cases) {
    const bind = [];
    const lifecycle = composedLifecycle({
      broker: true,
      adapter: brokerAdapterReturning(integrationResult({ evidence }))
    });
    const code = await refusalCode(lifecycle({
      workspace: WORKSPACE, status: STATUS, deps: callerDeps({ bind, integration: null })
    }));
    assert.equal(code, TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.TRANSPORTED_EVIDENCE_MALFORMED, label);
    assert.equal(bind.length, 0, label);
  }
});

test("BROKER: an attestation not bound to THIS worktree, ref, or frozen SHA refuses", async () => {

  const cases = [
    ["foreign worktree", materializationAttestation({ worktree_path: "/srv/other/wk-worktree" })],
    ["foreign ref", materializationAttestation({ wk_ref: "refs/heads/wk/IN-0030/WK-9999" })],
    ["stale SHA", materializationAttestation({ reviewed_sha: "f".repeat(40) })],
    ["unverified", materializationAttestation({ verified: false })],
    ["partial parts", materializationAttestation({ verified_parts: TERMINAL_REVIEW_VERIFY_PARTS.slice(0, 5) })]
  ];
  for (const [label, materialization] of cases) {
    const bind = [];
    const lifecycle = composedLifecycle({
      broker: true,
      adapter: brokerAdapterReturning(integrationResult({ evidence: terminalReviewEvidence({ materialization }) }))
    });
    const code = await refusalCode(lifecycle({
      workspace: WORKSPACE, status: STATUS, deps: callerDeps({ bind, integration: null })
    }));
    assert.equal(code, TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.ATTESTATION_INVALID, label);
    assert.equal(bind.length, 0, label);
  }
});

test("BROKER: STATUS run replay and locally resolved BINDING replay fail independent re-verification", async () => {
  const cases = [

    ["run id replay", terminalReviewEvidence({
      run: { assigned_unit: ASSIGNED_UNIT, launch_ref: LAUNCH_REF, run_id: "run-other", retry_id: RETRY_ID }
    })],
    ["launch ref replay", terminalReviewEvidence({
      run: { assigned_unit: ASSIGNED_UNIT, launch_ref: "wkmh_other", run_id: RUN_ID, retry_id: RETRY_ID }
    })],
    ["assigned unit replay", terminalReviewEvidence({
      run: { assigned_unit: `${RECORD_ID}#SLICE-001`, launch_ref: LAUNCH_REF, run_id: RUN_ID, retry_id: RETRY_ID }
    })],

    ["binding worktree replay", terminalReviewEvidence({
      wk_binding: { ...terminalReviewEvidence().wk_binding, worktree_path: `${WK_WORKTREE}-other` }
    })],
    ["binding run replay", terminalReviewEvidence({
      wk_binding: { ...terminalReviewEvidence().wk_binding, run_id: "run-other.wk" }
    })],
    ["binding base replay", terminalReviewEvidence({
      wk_binding: { ...terminalReviewEvidence().wk_binding, base_sha: "8".repeat(40) }
    })]
  ];
  for (const [label, evidence] of cases) {
    const bind = [];
    const lifecycle = composedLifecycle({
      broker: true,
      adapter: brokerAdapterReturning(integrationResult({ evidence }))
    });
    const code = await refusalCode(lifecycle({
      workspace: WORKSPACE, status: STATUS, deps: callerDeps({ bind, integration: null })
    }));
    assert.equal(code, TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.TRANSPORTED_EVIDENCE_BINDING_MISMATCH, label);
    assert.equal(bind.length, 0, label);
  }
});

test("BROKER: a composed materializer is a wiring fault, not a fallback", async () => {

  const bind = [];
  const lifecycle = lifecycleWithLauncherDeps({
      terminalReviewEvidenceMode: TERMINAL_REVIEW_EVIDENCE_MODES.TRANSPORTED_ATTESTATION,
      materializeTerminalReviewWorktree: () => materializationAttestation()
  });
  const code = await refusalCode(lifecycle({
    deps: callerDeps({ bind, integration: integrationResult({ evidence: terminalReviewEvidence() }) })
  }));
  assert.equal(code, TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.UNEXPECTED_MATERIALIZER);
  assert.equal(bind.length, 0);
});

test("DIRECT: the live materializer runs against the physical worktree and the reviewer launches", async () => {
  const bind = [];

  const lifecycle = composedLifecycle({ broker: false });
  const finalized = await lifecycle({
    workspace: WORKSPACE,
    status: STATUS,
    deps: callerDeps({ bind, integration: integrationResult({ evidence: undefined }) })
  });
  assert.equal(finalized.phase, "finalized");
  assert.equal(bind.length, 1);
  assert.equal(finalized.terminal_review_materialization.verified, true);
  assert.deepEqual(
    finalized.terminal_review_materialization.verified_parts,
    TERMINAL_REVIEW_VERIFY_PARTS,
    "all seven parts must be probed, in canonical order"
  );
  assert.equal(finalized.terminal_review_materialization.worktree_path, WK_WORKTREE);
  assert.equal(finalized.terminal_review_materialization.reviewed_sha, SLICE_COMMIT);
});

test("DIRECT: a stale worktree fails the live verify and launches no reviewer", async () => {

  const bind = [];
  const lifecycle = composedLifecycle({ broker: false });
  const code = await refusalCode(lifecycle({
    workspace: WORKSPACE,
    status: STATUS,
    deps: callerDeps({
      bind,
      integration: integrationResult({ evidence: undefined }),
      git: createFakeGit({ headTree: "7".repeat(40) })
    })
  }));
  assert.equal(code, TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.VERIFY_FAILED);
  assert.equal(bind.length, 0);
});

test("DIRECT: a transported attestation is REJECTED — this route measures, it does not inherit claims", async () => {
  const bind = [];
  const lifecycle = composedLifecycle({ broker: false });
  const code = await refusalCode(lifecycle({
    workspace: WORKSPACE,
    status: STATUS,

    deps: callerDeps({ bind, integration: integrationResult({ evidence: terminalReviewEvidence() }) })
  }));
  assert.equal(code, TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.UNEXPECTED_TRANSPORTED_EVIDENCE);
  assert.equal(bind.length, 0);
});

test("DIRECT: an absent materializer on the live branch refuses", async () => {
  const bind = [];
  const lifecycle = lifecycleWithLauncherDeps({
    terminalReviewEvidenceMode: TERMINAL_REVIEW_EVIDENCE_MODES.LIVE_MATERIALIZER
  });
  const code = await refusalCode(lifecycle({
    deps: callerDeps({ bind, integration: integrationResult({ evidence: undefined }) })
  }));
  assert.equal(code, TERMINAL_REVIEW_MATERIALIZER_UNAVAILABLE_CODE);
  assert.equal(bind.length, 0);
});

test("review enforcement mode is launcher-owned and spread last", async () => {
  assert.equal(reviewEnforcementModeForRegisteredTier("paid_cce"), "enforced_cce");
  for (const registeredTier of ["free_local", "free_registered", "local_only", null]) {
    assert.equal(reviewEnforcementModeForRegisteredTier(registeredTier), "policy_only");
  }
  for (const launcherMode of ["enforced_cce", "policy_only"]) {
    const captured = [];
    const lifecycle = composePostWorkerSliceLifecycle({
      worktreeProvisioning: { mainRepo: MAIN_REPO },
      reviewEnforcementMode: launcherMode,
      lifecycle: async ({ deps }) => { captured.push(deps); return null; }
    });
    await lifecycle({
      workspace: WORKSPACE,
      status: STATUS,
      deps: { reviewEnforcementMode: launcherMode === "enforced_cce" ? "policy_only" : "enforced_cce" }
    });
    assert.equal(captured[0].reviewEnforcementMode, launcherMode);
  }
});

test("policy_only: valid direct evidence may launch the optional verified reviewer", async () => {
  const bind = [];
  const fixture = policyCallerDeps({ bind });
  const lifecycle = composedLifecycle({ broker: false, reviewEnforcementMode: "policy_only" });
  const result = await lifecycle({ deps: fixture.deps });
  assert.equal(result.reviewer_dispatch.args.role, "reviewer");
  assert.equal(bind.length, 1);
  assert.equal(fixture.state.parentStatus, "review");
  assert.equal(fixture.state.statusWrites.length, 0);
  assert.equal(result.terminal_review_policy, undefined);
});

test("policy_only: valid broker evidence may launch the optional verified reviewer", async () => {
  const bind = [];
  const fixture = policyCallerDeps({ bind });
  const lifecycle = composedLifecycle({
    broker: true,
    adapter: brokerAdapterReturning(integrationResult({ evidence: terminalReviewEvidence() })),
    reviewEnforcementMode: "policy_only"
  });
  const result = await lifecycle({ deps: fixture.deps });
  assert.equal(result.reviewer_dispatch.args.role, "reviewer");
  assert.equal(bind.length, 1);
  assert.equal(fixture.state.parentStatus, "review");
  assert.equal(fixture.state.statusWrites.length, 0);
});

test("policy_only: absent, null, and malformed broker evidence complete without a reviewer and replay idempotently", async () => {
  const cases = [
    ["absent", undefined, TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.TRANSPORTED_EVIDENCE_MISSING],
    ["null", null, TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.TRANSPORTED_EVIDENCE_MISSING],
    ["malformed", { schema_version: "broken" }, TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.TRANSPORTED_EVIDENCE_MALFORMED]
  ];
  for (const [label, evidence, code] of cases) {
    const bind = [];
    const integration = integrationResult({ evidence });
    const fixture = policyCallerDeps({ bind, integration });
    const lifecycle = composedLifecycle({
      broker: true,
      adapter: brokerAdapterReturning(integration),
      reviewEnforcementMode: "policy_only"
    });
    const result = await lifecycle({ deps: fixture.deps });
    assertPolicyOnlyNoReviewer(result, { code, bind, state: fixture.state });
    assert.equal(fixture.state.statusWrites.length, 1, `${label}: review transitions once`);
    assert.ok(fixture.state.reconciliationCalls >= 2, `${label}: integration is independently reconciled`);

    const replay = await lifecycle({ deps: fixture.deps });
    assertPolicyOnlyNoReviewer(replay, {
      code,
      bind,
      state: fixture.state,
      statusDisposition: "already_done_revalidated"
    });
    assert.equal(fixture.state.statusWrites.length, 1, `${label}: done replay performs no second CAS`);
  }
});

test("policy_only: wrong/mixed evidence modes become only the closed non-enforced disposition", async () => {
  const cases = [
    [{}, TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.MODE_UNAVAILABLE],
    [{
      terminalReviewEvidenceMode: TERMINAL_REVIEW_EVIDENCE_MODES.LIVE_MATERIALIZER,
      materializeTerminalReviewWorktree: () => materializationAttestation()
    }, TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.UNEXPECTED_TRANSPORTED_EVIDENCE],
    [{
      terminalReviewEvidenceMode: TERMINAL_REVIEW_EVIDENCE_MODES.TRANSPORTED_ATTESTATION,
      materializeTerminalReviewWorktree: () => materializationAttestation()
    }, TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.UNEXPECTED_MATERIALIZER]
  ];
  for (const [launcherDeps, code] of cases) {
    const bind = [];
    const fixture = policyCallerDeps({
      bind,
      integration: integrationResult({ evidence: terminalReviewEvidence() })
    });
    const lifecycle = lifecycleWithLauncherDeps({
      reviewEnforcementMode: "policy_only",
      ...launcherDeps
    });
    const result = await lifecycle({ deps: fixture.deps });
    assertPolicyOnlyNoReviewer(result, { code, bind, state: fixture.state });
    const replay = await lifecycle({ deps: fixture.deps });
    assertPolicyOnlyNoReviewer(replay, {
      code,
      bind,
      state: fixture.state,
      statusDisposition: "already_done_revalidated"
    });
    assert.equal(fixture.state.statusWrites.length, 1);
  }
});

test("policy_only: failed direct materialization completes without reviewer only after reconciliation", async () => {
  const bind = [];
  const fixture = policyCallerDeps({
    bind,
    git: createFakeGit({ headTree: "7".repeat(40) })
  });
  const lifecycle = composedLifecycle({ broker: false, reviewEnforcementMode: "policy_only" });
  const result = await lifecycle({ deps: fixture.deps });
  assertPolicyOnlyNoReviewer(result, {
    code: TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.VERIFY_FAILED,
    bind,
    state: fixture.state
  });
  assert.equal(result.terminal_review_policy.cause.detail.part, "head_tree_is_frozen_tree");
  const replay = await lifecycle({ deps: fixture.deps });
  assertPolicyOnlyNoReviewer(replay, {
    code: TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.VERIFY_FAILED,
    bind,
    state: fixture.state,
    statusDisposition: "already_done_revalidated"
  });
  assert.equal(fixture.state.statusWrites.length, 1);
});

test("policy_only: a closed adapter evidence refusal reconciles; unrelated adapter issues do not", async () => {
  const bind = [];
  const recovered = integrationResult({ evidence: undefined, recovered: true });
  const fixture = policyCallerDeps({ bind, reconciliations: [null, recovered, recovered] });
  const lifecycle = composedLifecycle({
    broker: true,
    adapter: async () => ({
      accepted: false,
      refusal: {
        code: "launch_failed_before_start",
        reason: "broker_refused",
        detail: { issue: "integration_terminal_review_evidence_fields_not_exact", keys: [] }
      }
    }),
    reviewEnforcementMode: "policy_only"
  });
  const result = await lifecycle({ deps: fixture.deps });
  assertPolicyOnlyNoReviewer(result, {
    code: TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.TRANSPORTED_EVIDENCE_MALFORMED,
    bind,
    state: fixture.state
  });
  assert.equal(result.terminal_review_policy.cause.origin, "upstream_adapter_evidence");
  assert.equal(result.terminal_review_policy.cause.detail.issue,
    "integration_terminal_review_evidence_fields_not_exact");
});

test("policy_only: same-invocation upstream materialization refusal preserves cause and reconciles", async () => {
  const bind = [];
  const recovered = integrationResult({ evidence: undefined, recovered: true });
  const fixture = policyCallerDeps({
    bind,
    reconciliations: [null, recovered, recovered]
  });
  const lifecycle = composedLifecycle({
    broker: true,
    adapter: async () => upstreamBrokerMaterializationRefusal(),
    reviewEnforcementMode: "policy_only"
  });
  const result = await lifecycle({ deps: fixture.deps });
  assertPolicyOnlyNoReviewer(result, {
    code: TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.VERIFY_FAILED,
    bind,
    state: fixture.state
  });
  assert.equal(result.terminal_review_policy.cause.origin, "upstream_broker_materialization");
  assert.equal(result.terminal_review_policy.cause.detail.part, "write_tree_is_frozen_tree");
  assert.equal(fixture.state.reconciliationCalls, 3);
  const replay = await lifecycle({ deps: fixture.deps });
  assertPolicyOnlyNoReviewer(replay, {
    code: TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.VERIFY_FAILED,
    bind,
    state: fixture.state,
    statusDisposition: "already_done_revalidated"
  });
  assert.equal(fixture.state.statusWrites.length, 1);
});

test("enforced_cce: the same upstream materialization refusal stays fail-closed", async () => {
  const bind = [];
  const lifecycle = composedLifecycle({
    broker: true,
    adapter: async () => upstreamBrokerMaterializationRefusal(),
    reviewEnforcementMode: "enforced_cce"
  });
  const code = await refusalCode(lifecycle({
    deps: callerDeps({
      bind,
      integration: null,
      extra: { reconcileIntegratedSliceRecord: () => null }
    })
  }));
  assert.equal(code, "agent_launch.slice_integration.git_failed.v1");
  assert.equal(bind.length, 0);
});

test("policy_only: restart recovery reports transported_evidence_missing and never monitor_handle_unknown", async () => {
  const bind = [];
  const recovered = integrationResult({ evidence: undefined, recovered: true });
  const fixture = policyCallerDeps({
    bind,
    integration: recovered,
    reconciliations: [recovered, recovered]
  });
  const lifecycle = composedLifecycle({
    broker: true,
    adapter: brokerAdapterReturning(recovered),
    reviewEnforcementMode: "policy_only"
  });
  const result = await lifecycle({ deps: fixture.deps });
  assertPolicyOnlyNoReviewer(result, {
    code: TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.TRANSPORTED_EVIDENCE_MISSING,
    bind,
    state: fixture.state
  });
  assert.notEqual(result.terminal_review_policy.cause.code, "monitor_handle_unknown");
  assert.equal(result.integration.recovered, true);
});

test("multi-slice recovery: earlier slice A stays non-final after slice B owns the WK tip in review or done", async (t) => {
  for (const enforcementMode of ["policy_only", "enforced_cce"]) {
    for (const parentStatus of ["review", "done"]) {
      await t.test(`${enforcementMode}/${parentStatus}`, async () => {
        const bind = [];
        const recoveredA = recoveredEarlierSliceResult();
        const fixture = policyCallerDeps({
          bind,
          parentStatus,
          integration: recoveredA,
          reconciliations: [recoveredA]
        });
        const lifecycle = composedLifecycle({
          broker: true,
          adapter: brokerAdapterReturning(recoveredA),
          reviewEnforcementMode: enforcementMode
        });

        const result = await lifecycle({ deps: fixture.deps });
        assert.equal(result.phase, "finalized");
        assert.equal(result.integration.slice_sha, EARLIER_SLICE_COMMIT);
        assert.equal(result.integration.wk_sha, SLICE_COMMIT);
        assert.equal(result.integration.review_target, null);
        assert.equal(result.integration.integrated_state, "non_final");
        assert.equal(result.wk_transitioned_to_review, false);
        assert.equal(result.reviewer_dispatch, null);
        assert.equal(result.terminal_review_policy, undefined,
          "a non-final replay has no terminal-review policy disposition");
        assert.equal(fixture.state.parentStatus, parentStatus);
        assert.equal(fixture.state.statusWrites.length, 0,
          "an earlier slice replay must perform no review-to-done CAS");
        assert.equal(fixture.state.canonicalReads, 0,
          "an earlier slice replay must not enter terminal target reconstruction");
        assert.equal(bind.length, 0, "an earlier slice replay must bind no whole-WK reviewer");
      });
    }
  }
});

test("terminal ownership: real two-slice recovery refuses a promoted slice A target before evidence in every tier", async (t) => {
  const history = await buildRealTwoSliceRecoveryHistory();

  for (const enforcementMode of ["enforced_cce", "policy_only"]) {
    await t.test(`${enforcementMode}: promoted slice A target refuses before terminal machinery`, async () => {
      const bindings = realRecoveryBindings(history, "SLICE-001");
      const promotedA = {
        ...history.recoveredA,
        review_target: history.final.review_target,
        terminal_review_evidence: realRecoveryEvidence(history, bindings)
      };
      const invocation = runRealRecoveredLifecycle({
        history,
        sliceId: "SLICE-001",
        integration: promotedA,
        enforcementMode
      });
      const error = await invocation.promise.then(() => null, (failure) => failure);

      assert.ok(error, "a promoted earlier-slice target must refuse");
      assert.equal(error.code, "agent_launch.terminal_review_policy.integration_mismatch.v1");
      assert.deepEqual(error.detail, {
        slice_sha: history.first.slice_sha,
        wk_sha: history.final.wk_sha
      });
      assert.equal(invocation.counters.integration_replays, 0);
      assert.equal(invocation.counters.canonical_reads, 0,
        "ownership refuses before terminal review-unit reconstruction");
      assert.equal(invocation.counters.context_bindings, 0,
        "valid evidence cannot authorize frozen-context binding for an earlier marker");
      assert.equal(invocation.counters.status_writes, 0,
        "ownership refuses before policy-only review-to-done CAS");
      assert.equal(history.record.status, "review");
    });

    await t.test(`${enforcementMode}: genuine recovered slice A remains non-final without evidence`, async () => {
      const invocation = runRealRecoveredLifecycle({
        history,
        sliceId: "SLICE-001",
        integration: history.recoveredA,
        enforcementMode
      });
      const result = await invocation.promise;

      assert.equal(result.phase, POST_WORKER_LIFECYCLE_PHASES.FINALIZED);
      assert.equal(result.integration.slice_sha, history.first.slice_sha);
      assert.equal(result.integration.wk_sha, history.final.wk_sha);
      assert.equal(result.integration.review_target, null);
      assert.equal(result.integration.integrated_state, "non_final");
      assert.equal(result.wk_transitioned_to_review, false);
      assert.equal(result.reviewer_dispatch, null);
      assert.equal(result.terminal_review_policy, undefined);
      assert.deepEqual(invocation.counters, {
        integration_replays: 0,
        canonical_reads: 0,
        context_bindings: 0,
        status_writes: 0
      });
      assert.equal(history.record.status, "review");
    });

    await t.test(`${enforcementMode}: genuine recovered slice B retains verified reviewer behavior`, async () => {
      const bindings = realRecoveryBindings(history, "SLICE-002");
      const recoveredB = {
        ...history.recoveredB,
        terminal_review_evidence: realRecoveryEvidence(history, bindings)
      };
      const invocation = runRealRecoveredLifecycle({
        history,
        sliceId: "SLICE-002",
        integration: recoveredB,
        enforcementMode
      });
      const result = await invocation.promise;

      assert.equal(result.integration.slice_sha, history.final.wk_sha);
      assert.deepEqual(result.integration.review_target, history.final.review_target);
      assert.equal(result.reviewer_dispatch.tool, "workspace_agent_dispatch");
      assert.equal(result.reviewer_dispatch.args.role, "reviewer");
      assert.equal(invocation.counters.integration_replays, 0);
      assert.equal(invocation.counters.context_bindings, 1,
        "the same valid evidence remains sufficient for the actual final slice");
      assert.equal(invocation.counters.status_writes, 0);
      assert.equal(history.record.status, "review");
    });
  }
});

test("recovery: a broker result cannot promote earlier slice A to a terminal target", async () => {
  const bind = [];
  const recoveredA = recoveredEarlierSliceResult();
  const forgedTerminalA = { ...recoveredA, review_target: reviewTarget() };
  const fixture = policyCallerDeps({
    bind,
    integration: forgedTerminalA,
    reconciliations: [recoveredA]
  });
  const lifecycle = composedLifecycle({
    broker: true,
    adapter: brokerAdapterReturning(forgedTerminalA),
    reviewEnforcementMode: "policy_only"
  });

  await assert.rejects(lifecycle({ deps: fixture.deps }),
    /broker recovery result does not match the exact recovered integration marker/);
  assert.equal(fixture.state.statusWrites.length, 0);
  assert.equal(fixture.state.parentStatus, "review");
  assert.equal(bind.length, 0);
});

test("policy_only terminal finalization independently refuses recovered slice A when slice B owns the WK tip", async () => {
  const bind = [];
  const recoveredA = recoveredEarlierSliceResult();
  const forgedTerminalA = { ...recoveredA, review_target: reviewTarget() };
  const fixture = policyCallerDeps({ bind, reconciliations: [recoveredA] });
  const resumedStatus = { ...STATUS };
  Object.defineProperty(resumedStatus, POST_WORKER_LIFECYCLE_CHECKPOINT, {
    value: {
      phase: POST_WORKER_LIFECYCLE_PHASES.INTEGRATED,
      integration: forgedTerminalA,
      slice_review: null,
      finalized: null,
      in_flight: null
    }
  });

  const code = await refusalCode(runPostWorkerSliceLifecycle({
    workspace: WORKSPACE,
    status: resumedStatus,
    deps: {
      ...fixture.deps,
      reviewEnforcementMode: "policy_only",
      terminalReviewEvidenceMode: TERMINAL_REVIEW_EVIDENCE_MODES.TRANSPORTED_ATTESTATION
    }
  }));
  assert.equal(code, "agent_launch.terminal_review_policy.integration_mismatch.v1");
  assert.equal(fixture.state.statusWrites.length, 0);
  assert.equal(fixture.state.parentStatus, "review");
  assert.equal(bind.length, 0);
});

test("policy_only: exact already-done restart replay reconstructs honestly and performs no second CAS", async () => {
  const bind = [];
  const recoveredDone = integrationResult({ evidence: undefined, recovered: true });
  recoveredDone.review_target = null;
  recoveredDone.integrated_state = "non_final";
  recoveredDone.transition = { status: "done", recovered: true };
  const fixture = policyCallerDeps({
    bind,
    parentStatus: "done",
    integration: recoveredDone,
    reconciliations: [recoveredDone, recoveredDone]
  });
  const lifecycle = composedLifecycle({
    broker: true,
    adapter: brokerAdapterReturning(recoveredDone),
    reviewEnforcementMode: "policy_only"
  });
  const result = await lifecycle({ deps: fixture.deps });
  assertPolicyOnlyNoReviewer(result, {
    code: TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.TRANSPORTED_EVIDENCE_MISSING,
    bind,
    state: fixture.state,
    statusDisposition: "already_done_revalidated"
  });
  assert.equal(result.terminal_review_policy.cause.detail.reconstruction,
    "exact_integration_reconciled_without_retained_evidence");
  assert.equal(fixture.state.statusWrites.length, 0);
});

test("enforced_cce: already-done recovery without transported evidence remains fail-closed", async () => {
  const bind = [];
  const recoveredDone = integrationResult({ evidence: undefined, recovered: true });
  recoveredDone.review_target = null;
  const fixture = policyCallerDeps({
    bind,
    parentStatus: "done",
    integration: recoveredDone,
    reconciliations: [recoveredDone]
  });
  const lifecycle = composedLifecycle({
    broker: true,
    adapter: brokerAdapterReturning(recoveredDone),
    reviewEnforcementMode: "enforced_cce"
  });
  const code = await refusalCode(lifecycle({ deps: fixture.deps }));
  assert.equal(code, TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.TRANSPORTED_EVIDENCE_MISSING);
  assert.equal(bind.length, 0);
});

test("policy-only conversion taxonomy is closed and excludes invalid-arg programming faults", () => {
  assert.deepEqual(new Set(TERMINAL_REVIEW_POLICY_CONVERTIBLE_CODES).size,
    TERMINAL_REVIEW_POLICY_CONVERTIBLE_CODES.length);
  assert.equal(
    TERMINAL_REVIEW_POLICY_CONVERTIBLE_CODES.includes(
      TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.INVALID_ARG
    ),
    false
  );
  assert.equal(
    TERMINAL_REVIEW_POLICY_CONVERTIBLE_CODES.includes(
      TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.FROZEN_TARGET_MISMATCH
    ),
    false
  );
  assert.equal(TERMINAL_REVIEW_POLICY_CONVERTIBLE_CODES.length, 10);
});

test("policy_only error boundary: unrelated and unknown failures still throw", async (t) => {
  const assertThrowsBeforeReview = async (label, build) => {
    await t.test(label, async () => {
      const bind = [];
      const { lifecycle, deps, expectedCode } = build(bind);
      const code = await refusalCode(lifecycle({ deps }));
      assert.equal(code, expectedCode);
      assert.equal(bind.length, 0);
    });
  };

  await assertThrowsBeforeReview("unknown broker refusal", (bind) => ({
    lifecycle: composedLifecycle({
      broker: true,
      adapter: async () => ({
        accepted: false,
        refusal: {
          code: "launch_failed_before_start",
          reason: "broker_refused",
          detail: { broker_refusal_detail: { code: "unknown_terminal_code" } }
        }
      }),
      reviewEnforcementMode: "policy_only"
    }),
    deps: callerDeps({ bind, integration: null, extra: { reconcileIntegratedSliceRecord: () => null } }),
    expectedCode: "agent_launch.slice_integration.git_failed.v1"
  }));

  await assertThrowsBeforeReview("malformed unrelated transport", (bind) => ({
    lifecycle: composedLifecycle({
      broker: true,
      adapter: async () => ({
        accepted: false,
        refusal: { code: "launch_failed_before_start", reason: "integration_result_invalid", detail: { issue: "integration_tuple_not_object" } }
      }),
      reviewEnforcementMode: "policy_only"
    }),
    deps: callerDeps({ bind, integration: null, extra: { reconcileIntegratedSliceRecord: () => null } }),
    expectedCode: "agent_launch.slice_integration.git_failed.v1"
  }));

  await assertThrowsBeforeReview("cleanup/reaper failure", (bind) => ({
    lifecycle: composedLifecycle({
      broker: true,
      adapter: async () => ({
        accepted: false,
        refusal: {
          code: "launch_failed_before_start",
          reason: "broker_refused",
          detail: {
            broker_refusal_detail: {
              code: SLICE_INTEGRATION_REVIEW_FREEZE_FAILED_CODE,
              error_detail: { reap_code: "agent_launch.worktree_reap.failed.v1" }
            }
          }
        }
      }),
      reviewEnforcementMode: "policy_only"
    }),
    deps: callerDeps({ bind, integration: null, extra: { reconcileIntegratedSliceRecord: () => null } }),
    expectedCode: "agent_launch.slice_integration.git_failed.v1"
  }));
});

test("policy_only error boundary: binding, canonical, reconciliation, identity, lifecycle, status, and CAS faults throw", async (t) => {
  await t.test("binding failure", async () => {
    const lifecycle = composedLifecycle({ broker: false, reviewEnforcementMode: "policy_only" });
    await assert.rejects(
      lifecycle({ deps: callerDeps({ extra: { resolveManagedRunBinding: () => { throw new Error("binding failed"); } } }) }),
      /binding failed/
    );
  });

  await t.test("canonical-record failure", async () => {
    const bind = [];
    const lifecycle = composedLifecycle({
      broker: true,
      adapter: brokerAdapterReturning(integrationResult({ evidence: undefined })),
      reviewEnforcementMode: "policy_only"
    });
    await assert.rejects(
      lifecycle({ deps: callerDeps({ bind, extra: { resolveCanonicalReviewUnit: () => { throw new Error("canonical failed"); } } }) }),
      /canonical failed/
    );
    assert.equal(bind.length, 0);
  });

  await t.test("reconciliation failure", async () => {
    const bind = [];
    const fixture = policyCallerDeps({ bind, reconciliations: [null, null] });
    const lifecycle = composedLifecycle({
      broker: true,
      adapter: brokerAdapterReturning(integrationResult({ evidence: undefined })),
      reviewEnforcementMode: "policy_only"
    });
    assert.equal(await refusalCode(lifecycle({ deps: fixture.deps })),
      "agent_launch.terminal_review_policy.reconciliation_failed.v1");
  });

  await t.test("marker/ref/identity mismatch", async () => {
    const bind = [];
    const mismatched = integrationResult({ evidence: undefined, recovered: true });
    mismatched.slice_sha = "9".repeat(40);
    const fixture = policyCallerDeps({ bind, reconciliations: [null, mismatched] });
    const lifecycle = composedLifecycle({
      broker: true,
      adapter: brokerAdapterReturning(integrationResult({ evidence: undefined })),
      reviewEnforcementMode: "policy_only"
    });
    assert.equal(await refusalCode(lifecycle({ deps: fixture.deps })),
      "agent_launch.terminal_review_policy.integration_mismatch.v1");
  });

  await t.test("live frozen target mismatch", async () => {
    const bind = [];
    const fixture = policyCallerDeps({
      bind,
      git: createFakeGit({ canonicalWkSha: "8".repeat(40) })
    });
    const lifecycle = composedLifecycle({ broker: false, reviewEnforcementMode: "policy_only" });
    assert.equal(await refusalCode(lifecycle({ deps: fixture.deps })),
      TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.FROZEN_TARGET_MISMATCH);
    assert.equal(bind.length, 0);
  });

  await t.test("injected lifecycle error", async () => {
    const lifecycle = composedLifecycle({
      broker: true,
      adapter: brokerAdapterReturning(integrationResult({ evidence: terminalReviewEvidence() })),
      reviewEnforcementMode: "policy_only"
    });
    await assert.rejects(
      lifecycle({ deps: callerDeps({ extra: { bindFrozenReviewContext: () => { throw new Error("injected lifecycle error"); } } }) }),
      /injected lifecycle error/
    );
  });

  await t.test("unexpected canonical status", async () => {
    const fixture = policyCallerDeps({ parentStatus: "active" });
    const lifecycle = composedLifecycle({
      broker: true,
      adapter: brokerAdapterReturning(integrationResult({ evidence: undefined })),
      reviewEnforcementMode: "policy_only"
    });
    assert.equal(await refusalCode(lifecycle({ deps: fixture.deps })),
      "agent_launch.terminal_review_policy.canonical_state_invalid.v1");
  });

  await t.test("status CAS conflict", async () => {
    const fixture = policyCallerDeps({
      statusTransition: async () => ({
        valid: false,
        written: false,
        no_op: false,
        status: null,
        diagnostics: [{ code: "stale_source_digest" }]
      })
    });
    const lifecycle = composedLifecycle({
      broker: true,
      adapter: brokerAdapterReturning(integrationResult({ evidence: undefined })),
      reviewEnforcementMode: "policy_only"
    });
    assert.equal(await refusalCode(lifecycle({ deps: fixture.deps })),
      "agent_launch.terminal_review_policy.status_cas_failed.v1");
  });
});

test("RECOVERY: a reconstructed broker result carrying no evidence remains a fail-closed refusal", async () => {

  const bind = [];
  const recovered = integrationResult({ evidence: undefined, recovered: true });
  const lifecycle = composedLifecycle({ broker: true, adapter: brokerAdapterReturning(recovered) });
  const code = await refusalCode(lifecycle({
    workspace: WORKSPACE,
    status: STATUS,
    deps: callerDeps({
      bind,
      integration: null,
      extra: { reconcileIntegratedSliceRecord: () => recovered }
    })
  }));
  assert.equal(code, TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.TRANSPORTED_EVIDENCE_MISSING);
  assert.equal(bind.length, 0, "recovery must not bind a review context without proof");
});

test("RECOVERY: the direct route's reconstructed result is verified live, not waved through", async () => {
  const bind = [];
  const recovered = integrationResult({ evidence: undefined, recovered: true });
  const lifecycle = composedLifecycle({ broker: false });
  const code = await refusalCode(lifecycle({
    workspace: WORKSPACE,
    status: STATUS,
    deps: callerDeps({
      bind,
      integration: null,
      git: createFakeGit({ symbolicHead: "refs/heads/main" }),
      extra: { reconcileIntegratedSliceRecord: () => recovered }
    })
  }));
  assert.equal(code, TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.VERIFY_FAILED);
  assert.equal(bind.length, 0);
});

function createRunStatusTool({ backend }) {
  const tools = new Map();
  registerDispatchTools({
    registerTool: (name, config, handler) => tools.set(name, { config, handler }),
    registeredToolNames: new Set(["workspace_agent_dispatch"]),
    workspaceRepos: [{ repo: "agent-chassis", dir: MAIN_REPO }],
    z,
    jsonContent,
    errorContent,
    resolveWorkspaceRepo: () => WORKSPACE,
    dispatchBackend: backend,
    dispatchSessionIdentity: "session-slice011"
  });
  return tools.get("workspace_agent_run_status").handler;
}

test("M-3: after a LATCHED materialize failure, recovery reports the true cause and not monitor_handle_unknown", async () => {

  const trueCause = "verify failed part write_tree_is_frozen_tree";
  const handler = createRunStatusTool({
    backend: {

      getRunStatus: async () => ({ accepted: false, refusal: { code: "monitor_handle_unknown", reason: "unknown_handle" } }),
      recoverIntegratedWorkerRun: async () => ({
        recovery_failure: {
          code: TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.VERIFY_FAILED,
          message: trueCause,
          detail: { part: "write_tree_is_frozen_tree" }
        }
      })
    }
  });

  const result = await handler({ monitor_handle: LAUNCH_REF, subject: ASSIGNED_UNIT });
  const structured = JSON.parse(result.content[0].text);

  assert.notEqual(structured.blocker.code, "monitor_handle_unknown",
    "the misleading refusal must not survive");
  assert.equal(structured.blocker.reason, "post_worker_lifecycle_recovery_failed");
  assert.equal(structured.blocker.detail.recovery_failure.code,
    TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.VERIFY_FAILED);
  assert.match(structured.blocker.detail.recovery_failure.message, /write_tree_is_frozen_tree/);

  assert.equal(structured.blocker.detail.backend_refusal.code, "monitor_handle_unknown");
});

test("M-3: a recovery that simply found nothing keeps the ordinary unknown-handle refusal", async () => {
  const handler = createRunStatusTool({
    backend: {
      getRunStatus: async () => ({ accepted: false, refusal: { code: "monitor_handle_unknown", reason: "unknown_handle" } }),
      recoverIntegratedWorkerRun: async () => null
    }
  });
  const structured = JSON.parse((await handler({ monitor_handle: LAUNCH_REF, subject: ASSIGNED_UNIT })).content[0].text);
  assert.equal(structured.blocker.code, "monitor_handle_unknown");
  assert.equal(structured.blocker.reason, "unknown_handle");
});

test("MINT: a malformed WK binding refuses BEFORE any mutation, not after", async () => {

  class FakeSliceIntegrationError extends Error {
    constructor(message, { code, detail } = {}) { super(message); this.code = code; this.detail = detail; }
  }
  const boundFields = [
    "schema_version", "run_id", "retry_id", "unit_address",
    "output_branch", "worktree_path", "base_ref", "base_sha"
  ];

  for (const field of boundFields) {
    const integrateCalls = [];
    const broken = wkBinding();
    delete broken[field];

    const error = await defaultIntegrateManagedWorkerSlice({
      mainRepo: MAIN_REPO,
      assignedUnit: ASSIGNED_UNIT,
      launchRef: LAUNCH_REF,
      runId: RUN_ID,
      retryId: RETRY_ID,
      deps: {
        runGit: createFakeGit(),
        digestTrustedExactReviewEvidence,
        resolveWorktreeBinding: ({ runId }) => runId.endsWith(".slice") ? sliceBinding() : broken,
        integrateCommittedSlice: async () => {
          integrateCalls.push(field);
          return integrationResult({ evidence: undefined });
        },
        SliceIntegrationError: FakeSliceIntegrationError,
        SLICE_INTEGRATION_DIAGNOSTIC_CODES: { INVALID_ARG: "invalid_arg", BINDING_MISMATCH: "binding_mismatch" },
        setWorkRecordStatusByUnit: async () => ({ ok: true }),
        materializeTerminalReviewWorktree: () => materializationAttestation()
      }
    }).then(() => null, (err) => err);

    assert.ok(error, `missing ${field} must refuse`);
    assert.equal(error.code, "binding_mismatch", `missing ${field}`);
    assert.equal(integrateCalls.length, 0,
      `missing ${field} must refuse BEFORE integrateCommittedSlice mutates anything`);
  }
});

test("MINT: a WK binding with a wrong-typed bound field refuses pre-mutation", async () => {
  class FakeSliceIntegrationError extends Error {
    constructor(message, { code, detail } = {}) { super(message); this.code = code; this.detail = detail; }
  }
  const cases = [
    ["retry_id", "0"],
    ["run_id", 12],
    ["output_branch", ""],
    ["base_ref", null]
  ];
  for (const [field, value] of cases) {
    const integrateCalls = [];
    const error = await defaultIntegrateManagedWorkerSlice({
      mainRepo: MAIN_REPO,
      assignedUnit: ASSIGNED_UNIT,
      launchRef: LAUNCH_REF,
      runId: RUN_ID,
      retryId: RETRY_ID,
      deps: {
        runGit: createFakeGit(),
        digestTrustedExactReviewEvidence,
        resolveWorktreeBinding: ({ runId }) =>
          runId.endsWith(".slice") ? sliceBinding() : wkBinding({ [field]: value }),
        integrateCommittedSlice: async () => {
          integrateCalls.push(field);
          return integrationResult({ evidence: undefined });
        },
        SliceIntegrationError: FakeSliceIntegrationError,
        SLICE_INTEGRATION_DIAGNOSTIC_CODES: { INVALID_ARG: "invalid_arg", BINDING_MISMATCH: "binding_mismatch" },
        setWorkRecordStatusByUnit: async () => ({ ok: true }),
        materializeTerminalReviewWorktree: () => materializationAttestation()
      }
    }).then(() => null, (err) => err);
    assert.ok(error, `${field}=${String(value)} must refuse`);
    assert.equal(error.code, "binding_mismatch", `${field}=${String(value)}`);
    assert.equal(integrateCalls.length, 0, `${field}=${String(value)} must refuse pre-mutation`);
  }
});
