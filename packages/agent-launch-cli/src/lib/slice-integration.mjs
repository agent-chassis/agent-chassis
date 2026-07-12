

import { readFileSync } from "node:fs";
import path from "node:path";

import { defaultRunGit } from "./worktree-substrate.mjs";

export const SLICE_INTEGRATION_SCHEMA_VERSION = "slice-integration.v1";

export const SLICE_INTEGRATION_DIAGNOSTIC_CODES = Object.freeze({
  INVALID_ARG: "agent_launch.slice_integration.invalid_arg.v1",
  BINDING_MISMATCH: "agent_launch.slice_integration.binding_mismatch.v1",
  WORKER_NOT_TERMINATED: "agent_launch.slice_integration.worker_not_terminated.v1",
  WORKTREE_DIRTY: "agent_launch.slice_integration.worktree_dirty.v1",
  REVIEW_UNRESOLVED: "agent_launch.slice_integration.review_unresolved.v1",
  DEPENDENCY_UNACCEPTED: "agent_launch.slice_integration.dependency_unaccepted.v1",
  SLICE_COMMIT_CONFLICT: "agent_launch.slice_integration.slice_commit_conflict.v1",
  REBASE_CONFLICT: "agent_launch.slice_integration.rebase_conflict.v1",
  REBASE_RESTORE_FAILED: "agent_launch.slice_integration.rebase_restore_failed.v1",
  WK_ADVANCE_CONFLICT: "agent_launch.slice_integration.wk_advance_conflict.v1",
  REVIEW_FREEZE_FAILED: "agent_launch.slice_integration.review_freeze_failed.v1",
  GIT_FAILED: "agent_launch.slice_integration.git_failed.v1"
});

const OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const SLICE_REF_RE = /^refs\/heads\/slice\/(IN-\d{4})\/(WK-\d{4})\/(SLICE-\d{3})$/;
const WK_REF_RE = /^refs\/heads\/wk\/(IN-\d{4})\/(WK-\d{4})$/;

export class SliceIntegrationError extends Error {
  constructor(message, { code, detail = null, cause = null } = {}) {
    super(message);
    this.name = "SliceIntegrationError";
    this.code = code ?? SLICE_INTEGRATION_DIAGNOSTIC_CODES.GIT_FAILED;
    if (detail !== null) this.detail = detail;
    if (cause !== null) this.cause = cause;
  }
}

function fail(code, message, detail = null, cause = null) {
  throw new SliceIntegrationError(`agent-launch slice-integration: ${message}`, {
    code,
    detail,
    cause
  });
}

function assertOid(value, label) {
  if (typeof value !== "string" || !OID_RE.test(value) || /^0+$/u.test(value)) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.INVALID_ARG, `${label} must be a non-zero git object id`);
  }
  return value;
}

function normalizeRef(value, pattern, label) {
  if (typeof value !== "string" || value.length === 0) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.INVALID_ARG, `${label} must be a non-empty string`);
  }
  const ref = value.startsWith("refs/heads/") ? value : `refs/heads/${value}`;
  const match = ref.match(pattern);
  if (!match) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.INVALID_ARG, `${label} is outside its exact-unit ref namespace`, { ref });
  }
  return { ref, match };
}

function git(runGit, repo, args, label, code = SLICE_INTEGRATION_DIAGNOSTIC_CODES.GIT_FAILED) {
  const result = runGit({ repo, args });
  if (!result || result.ok !== true) {
    fail(code, label, {
      args,
      status: result?.status ?? null,
      stderr: result?.stderr ?? result?.error ?? null
    });
  }
  return result;
}

function revParse(runGit, repo, value) {
  const oid = git(runGit, repo, ["rev-parse", "--verify", `${value}^{commit}`], `could not resolve ${value}`).stdout.trim();
  return assertOid(oid, value);
}

function assertCleanExactWorktree(runGit, worktreePath, sliceRef, expectedHead) {
  if (!path.isAbsolute(worktreePath)) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.INVALID_ARG, "slice worktree path must be absolute");
  }
  const branch = git(runGit, worktreePath, ["symbolic-ref", "-q", "HEAD"], "slice worktree is detached or unreadable").stdout.trim();
  const head = revParse(runGit, worktreePath, "HEAD");
  const refTip = revParse(runGit, worktreePath, sliceRef);
  if (branch !== sliceRef || head !== expectedHead || refTip !== expectedHead) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH, "slice ref/worktree binding does not match the committed slice", {
      expected_ref: sliceRef,
      actual_ref: branch,
      expected_head: expectedHead,
      actual_head: head,
      ref_tip: refTip
    });
  }
  const status = git(runGit, worktreePath, ["status", "--porcelain=v1", "--untracked-files=all"], "could not inspect slice worktree dirtiness").stdout;
  if (status.length > 0) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.WORKTREE_DIRTY, "slice worktree must be clean before trusted integration", { status });
  }
}

function parseCanonicalRecord(mainRepo, wkId) {
  const recordPath = path.join(mainRepo, "wiki", "work-records", `${wkId}.json`);
  try {
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    if (!record || record.id !== wkId || !Array.isArray(record.slices)) throw new Error("record identity/slices invalid");
    return record;
  } catch (error) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH, `canonical ${wkId} record is unavailable or incompatible`, { record_path: recordPath }, error);
  }
}

function assertReviewAndDependencies(record, sliceId) {
  if (record.status === "review") {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.REVIEW_UNRESOLVED, "another integration is refused while the WK review is unresolved", {
      wk_id: record.id,
      status: record.status
    });
  }
  const slice = record.slices.find((entry) => entry?.id === sliceId);
  if (!slice) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH, `canonical slice ${sliceId} is unresolved in ${record.id}`);
  }
  const dependencies = Array.isArray(slice.depends_on) ? slice.depends_on : [];
  const unaccepted = [];
  for (const dependency of dependencies) {
    const localId = typeof dependency === "string" && dependency.includes("#")
      ? dependency.split("#").at(-1)
      : dependency;
    if (typeof localId !== "string" || !/^SLICE-\d{3}$/u.test(localId)) continue;
    const target = record.slices.find((entry) => entry?.id === localId);
    if (!target || target.status !== "done") unaccepted.push(dependency);
  }
  if (unaccepted.length > 0) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.DEPENDENCY_UNACCEPTED, "dependent slice integration requires every declared local dependency to have accepted WK-context review", {
      dependencies: unaccepted
    });
  }
}

export function commitSliceRef({ repo, sliceRef, baseSha, commit, tree, deps = {} } = {}) {
  const runGit = deps.runGit ?? defaultRunGit;
  const { ref } = normalizeRef(sliceRef, SLICE_REF_RE, "sliceRef");
  assertOid(baseSha, "baseSha");
  assertOid(commit, "commit");
  assertOid(tree, "tree");
  const current = revParse(runGit, repo, ref);
  if (current === commit) {
    return Object.freeze({ ref, base_sha: baseSha, commit, tree, idempotent: true });
  }
  if (current !== baseSha) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.SLICE_COMMIT_CONFLICT, "slice ref no longer equals the launcher-bound base", {
      ref,
      expected: baseSha,
      actual: current
    });
  }
  git(runGit, repo, ["update-ref", ref, commit, baseSha], "slice ref compare-and-swap failed", SLICE_INTEGRATION_DIAGNOSTIC_CODES.SLICE_COMMIT_CONFLICT);
  return Object.freeze({ ref, base_sha: baseSha, commit, tree, idempotent: false });
}

function restorePreRebaseState(runGit, worktreePath, sliceRef, preRebaseSha) {
  const failures = [];
  const abort = runGit({ repo: worktreePath, args: ["rebase", "--abort"] });
  if (!abort || abort.ok !== true) failures.push({ step: "rebase --abort", detail: abort?.stderr ?? abort?.error ?? abort?.status ?? null });
  const reset = runGit({ repo: worktreePath, args: ["reset", "--hard", preRebaseSha] });
  if (!reset || reset.ok !== true) failures.push({ step: "reset --hard pre-rebase", detail: reset?.stderr ?? reset?.error ?? reset?.status ?? null });
  try {
    const head = revParse(runGit, worktreePath, "HEAD");
    const tip = revParse(runGit, worktreePath, sliceRef);
    if (head !== preRebaseSha || tip !== preRebaseSha) failures.push({ step: "verify restoration", head, tip, expected: preRebaseSha });
  } catch (error) {
    failures.push({ step: "verify restoration", detail: error.message });
  }
  if (failures.length > 0) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.REBASE_RESTORE_FAILED, "failed to restore the exact pre-rebase slice state", {
      slice_ref: sliceRef,
      pre_rebase_sha: preRebaseSha,
      failures
    });
  }
}

export async function integrateCommittedSlice({
  mainRepo,
  worktreePath,
  unitAddress,
  sliceRef,
  wkRef,
  baseSha,
  commit,
  workerTerminated,
  transitionToReview,
  deps = {}
} = {}) {
  const runGit = deps.runGit ?? defaultRunGit;
  if (workerTerminated !== true) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.WORKER_NOT_TERMINATED, "trusted integration requires confirmed worker termination");
  }
  const slice = normalizeRef(sliceRef, SLICE_REF_RE, "sliceRef");
  const wk = normalizeRef(wkRef, WK_REF_RE, "wkRef");
  if (slice.match[1] !== wk.match[1] || slice.match[2] !== wk.match[2]) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH, "slice and WK refs do not identify the same WK");
  }
  const expectedUnit = `${slice.match[1]}/${slice.match[2]}/${slice.match[3]}`;
  if (unitAddress !== expectedUnit) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH, "unitAddress does not match the exact slice ref", { expected: expectedUnit, actual: unitAddress });
  }
  assertOid(baseSha, "baseSha");
  assertOid(commit, "commit");
  if (typeof transitionToReview !== "function") {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.REVIEW_FREEZE_FAILED, "canonical review transition callback is required");
  }
  const record = (deps.loadCanonicalRecord ?? parseCanonicalRecord)(mainRepo, slice.match[2]);
  assertReviewAndDependencies(record, slice.match[3]);
  assertCleanExactWorktree(runGit, worktreePath, slice.ref, commit);

  const wkOld = revParse(runGit, mainRepo, wk.ref);
  let integratedCommit = commit;
  let rebased = false;
  if (baseSha !== wkOld) {

    const result = runGit({ repo: worktreePath, args: ["rebase", "--onto", wkOld, baseSha] });
    if (!result || result.ok !== true) {
      restorePreRebaseState(runGit, worktreePath, slice.ref, commit);
      fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.REBASE_CONFLICT, "trusted slice rebase conflicted; pre-rebase state restored and both refs preserved", {
        slice_ref: slice.ref,
        slice_sha: commit,
        wk_ref: wk.ref,
        wk_sha: wkOld,
        stderr: result?.stderr ?? result?.error ?? null
      });
    }
    integratedCommit = revParse(runGit, worktreePath, "HEAD");
    rebased = true;
  }

  git(runGit, mainRepo, ["merge-base", "--is-ancestor", wkOld, integratedCommit], "integrated slice is not a fast-forward of the WK tip", SLICE_INTEGRATION_DIAGNOSTIC_CODES.WK_ADVANCE_CONFLICT);
  git(runGit, mainRepo, ["update-ref", wk.ref, integratedCommit, wkOld], "fast-forward WK ref advancement lost serialization", SLICE_INTEGRATION_DIAGNOSTIC_CODES.WK_ADVANCE_CONFLICT);

  const mainSha = revParse(runGit, mainRepo, "refs/heads/main");
  const diffBaseSha = git(runGit, mainRepo, ["merge-base", mainSha, integratedCommit], "could not derive complete-WK review diff base").stdout.trim();
  assertOid(diffBaseSha, "diffBaseSha");
  const reviewTarget = Object.freeze({
    schema_version: SLICE_INTEGRATION_SCHEMA_VERSION,
    unit_address: `${slice.match[1]}/${slice.match[2]}`,
    ref: wk.ref,
    sha: integratedCommit,
    diff_base_sha: diffBaseSha,
    diff_head_sha: integratedCommit,
    diff_range: `${diffBaseSha}..${integratedCommit}`,
    complete_parent_wk_contract: true,
    accumulated_wk_diff: true
  });

  let transition;
  try {
    transition = await transitionToReview({
      unitAddress: slice.match[2],
      status: "review",
      reviewTarget
    });
    if (!transition || transition.valid !== true || (transition.written !== true && transition.no_op !== true)) {
      throw new Error("canonical review transition did not confirm a write/no-op");
    }
  } catch (error) {
    const rollback = runGit({ repo: mainRepo, args: ["update-ref", wk.ref, wkOld, integratedCommit] });
    if (!rollback || rollback.ok !== true) {
      fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.REVIEW_FREEZE_FAILED, "review freeze failed and WK ref compensation also failed", {
        wk_ref: wk.ref,
        prior_wk_sha: wkOld,
        integrated_sha: integratedCommit,
        rollback: rollback?.stderr ?? rollback?.error ?? rollback?.status ?? null
      }, error);
    }
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.REVIEW_FREEZE_FAILED, "review freeze failed; WK ref restored and slice retained", {
      wk_ref: wk.ref,
      restored_sha: wkOld,
      slice_ref: slice.ref,
      slice_sha: integratedCommit
    }, error);
  }

  return Object.freeze({
    schema_version: SLICE_INTEGRATION_SCHEMA_VERSION,
    integrated: true,
    rebased,
    previous_wk_sha: wkOld,
    slice_ref: slice.ref,
    slice_sha: integratedCommit,
    wk_ref: wk.ref,
    wk_sha: integratedCommit,
    review_target: reviewTarget,
    transition
  });
}
