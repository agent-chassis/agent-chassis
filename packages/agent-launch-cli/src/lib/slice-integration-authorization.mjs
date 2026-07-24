

import { readFileSync } from "node:fs";
import path from "node:path";

import { buildWkSliceMarkerTrailer } from "./commit-tool-exposure-guard.mjs";

export const SLICE_INTEGRATION_SCHEMA_VERSION = "slice-integration.v1";
export const SLICE_INTEGRATION_BOUNDARY_AUTHORIZATION_SCHEMA_VERSION =
  "slice-integration-boundary-authorization.v1";
export const SLICE_INTEGRATION_POLICY_POSTURES = Object.freeze({
  FREE_SUBSTRATE: "free_substrate",
  CCE_POLICY: "cce_policy"
});

export const SLICE_INTEGRATION_DIAGNOSTIC_CODES = Object.freeze({
  INVALID_ARG: "agent_launch.slice_integration.invalid_arg.v1",
  BINDING_MISMATCH: "agent_launch.slice_integration.binding_mismatch.v1",
  WORKER_NOT_TERMINATED: "agent_launch.slice_integration.worker_not_terminated.v1",
  INDEX_RECONCILE_FAILED: "agent_launch.slice_integration.index_reconcile_failed.v1",
  SLICE_COMMIT_CONFLICT: "agent_launch.slice_integration.slice_commit_conflict.v1",
  SLICE_COMMIT_READ_INDETERMINATE:
    "agent_launch.slice_integration.slice_commit_read_indeterminate.v1",
  SLICE_COMMIT_COMPENSATION_CAS_LOST:
    "agent_launch.slice_integration.slice_commit_compensation_cas_lost.v1",
  SLICE_COMMIT_COMPENSATION_FAILED:
    "agent_launch.slice_integration.slice_commit_compensation_failed.v1",
  REBASE_CONFLICT: "agent_launch.slice_integration.rebase_conflict.v1",
  REBASE_RESTORE_FAILED: "agent_launch.slice_integration.rebase_restore_failed.v1",
  WK_ADVANCE_CONFLICT: "agent_launch.slice_integration.wk_advance_conflict.v1",
  REVIEW_FREEZE_FAILED: "agent_launch.slice_integration.review_freeze_failed.v1",
  BOUNDARY_AUTHORIZATION_MISSING:
    "agent_launch.slice_integration.boundary_authorization_missing.v1",
  BOUNDARY_AUTHORIZATION_MALFORMED:
    "agent_launch.slice_integration.boundary_authorization_malformed.v1",
  CCE_POLICY_DENIED: "agent_launch.slice_integration.cce_policy_denied.v1",
  CCE_POLICY_UNRATIFIED: "agent_launch.slice_integration.cce_policy_unratified.v1",

  RECORD_CAS_EXHAUSTED: "agent_launch.slice_integration.record_cas_exhausted.v1",
  RECORD_WRITE_FAILED: "agent_launch.slice_integration.record_write_failed.v1",
  GIT_FAILED: "agent_launch.slice_integration.git_failed.v1"
});

const OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
export const SLICE_REF_RE = /^refs\/heads\/slice\/(IN-\d{4})\/(WK-\d{4})\/(SLICE-\d{3})$/;
export const WK_REF_RE = /^refs\/heads\/wk\/(IN-\d{4})\/(WK-\d{4})$/;

export class SliceIntegrationError extends Error {
  constructor(message, { code, detail = null, cause = null } = {}) {
    super(message);
    this.name = "SliceIntegrationError";
    this.code = code ?? SLICE_INTEGRATION_DIAGNOSTIC_CODES.GIT_FAILED;
    if (detail !== null) this.detail = detail;
    if (cause !== null) this.cause = cause;
  }
}

export function fail(code, message, detail = null, cause = null) {
  throw new SliceIntegrationError(`agent-launch slice-integration: ${message}`, {
    code,
    detail,
    cause
  });
}

export function assertOid(value, label) {
  if (typeof value !== "string" || !OID_RE.test(value) || /^0+$/u.test(value)) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.INVALID_ARG, `${label} must be a non-zero git object id`);
  }
  return value;
}

export function normalizeRef(value, pattern, label) {
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

export function git(runGit, repo, args, label, code = SLICE_INTEGRATION_DIAGNOSTIC_CODES.GIT_FAILED) {
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

export function revParse(runGit, repo, value) {
  const oid = git(runGit, repo, ["rev-parse", "--verify", `${value}^{commit}`], `could not resolve ${value}`).stdout.trim();
  return assertOid(oid, value);
}

export function resolveTree(runGit, repo, rev) {
  const oid = git(runGit, repo, ["rev-parse", "--verify", `${rev}^{tree}`], `could not resolve the tree of ${rev}`).stdout.trim();
  return assertOid(oid, `${rev} tree`);
}

export function sliceHasNoRemainingDelta({ runGit, mainRepo, baseSha, commit, wkTip }) {
  const merged = runGit({
    repo: mainRepo,
    args: [
      "merge-tree", "--write-tree", "--no-messages",
      "--merge-base", baseSha,
      wkTip,
      commit
    ]
  });
  if (!merged || merged.ok !== true) {
    fail(
      SLICE_INTEGRATION_DIAGNOSTIC_CODES.REBASE_CONFLICT,
      "the immutable exact-slice delivery conflicts with the current WK tip",
      {
        base_sha: baseSha,
        slice_sha: commit,
        wk_sha: wkTip,
        stdout: String(merged?.stdout ?? "").slice(0, 8192),
        stderr: String(merged?.stderr ?? merged?.error ?? "").slice(0, 8192)
      }
    );
  }
  const appliedTree = assertOid(
    String(merged.stdout ?? "").split(/\r?\n/u)[0].trim(),
    "applied slice tree"
  );
  return appliedTree === resolveTree(runGit, mainRepo, wkTip);
}

export function assertExactWorktreeBinding(runGit, worktreePath, sliceRef, expectedHead) {
  if (typeof worktreePath !== "string" || !path.isAbsolute(worktreePath)) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.INVALID_ARG, "bound slice worktree path must be absolute");
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
}

export function parseCanonicalRecord(mainRepo, wkId) {
  const recordPath = path.join(mainRepo, "wiki", "work-records", `${wkId}.json`);
  try {
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    if (!record || record.id !== wkId || !Array.isArray(record.slices)) throw new Error("record identity/slices invalid");
    return record;
  } catch (error) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH, `canonical ${wkId} record is unavailable or incompatible`, { record_path: recordPath }, error);
  }
}

function isImplementationSlice(slice) {
  const kind = typeof slice?.work_kind === "string" && slice.work_kind.length > 0
    ? slice.work_kind
    : "implementation";
  return kind === "implementation";
}

function ereEscape(value) {
  return String(value).replace(/[.\\[\]()*+?{}|^$]/gu, "\\$&");
}

export function resolveSliceMarkerCommit(runGit, mainRepo, wkTipSha, wkId, sliceId) {
  const trailer = buildWkSliceMarkerTrailer(`${wkId}#${sliceId}`);
  if (trailer === null) return null;
  const grep = `--grep=^${ereEscape(trailer)}$`;
  const mainTip = runGit({ repo: mainRepo, args: ["rev-parse", "--verify", "--quiet", "refs/heads/main^{commit}"] });
  const range = mainTip && mainTip.ok === true && String(mainTip.stdout ?? "").trim().length > 0
    ? [`${String(mainTip.stdout).trim()}..${wkTipSha}`]
    : [wkTipSha];
  const res = runGit({ repo: mainRepo, args: ["rev-list", "--max-count=1", "-E", grep, ...range] });
  const sha = res && res.ok === true ? String(res.stdout ?? "").trim() : "";
  return OID_RE.test(sha) ? sha : null;
}

function sliceMarkerPresentInWkTip(runGit, mainRepo, wkTipSha, wkId, sliceId) {
  return resolveSliceMarkerCommit(runGit, mainRepo, wkTipSha, wkId, sliceId) !== null;
}

function isSiblingImplementationComplete(entry, runGit, mainRepo, wkTipSha, wkId) {
  if (entry.status === "cancelled") return true;
  if (entry.status !== "done") return false;
  return sliceMarkerPresentInWkTip(runGit, mainRepo, wkTipSha, wkId, entry.id);
}

export function isLastIncompleteImplementationSlice(record, sliceId, runGit, mainRepo, wkTipSha, wkId) {
  return !record.slices.some((entry) =>
    entry &&
    entry.id !== sliceId &&
    isImplementationSlice(entry) &&
    !isSiblingImplementationComplete(entry, runGit, mainRepo, wkTipSha, wkId)
  );
}

export function buildCompleteWkReviewTarget({ runGit, mainRepo, initiative, wkId, wkRef, wkTip }) {
  const mainSha = revParse(runGit, mainRepo, "refs/heads/main");
  const diffBaseSha = git(runGit, mainRepo, ["merge-base", mainSha, wkTip], "could not derive complete-WK review diff base").stdout.trim();
  assertOid(diffBaseSha, "diffBaseSha");
  return Object.freeze({
    schema_version: SLICE_INTEGRATION_SCHEMA_VERSION,
    unit_address: `${initiative}/${wkId}`,
    ref: wkRef,
    sha: wkTip,
    diff_base_sha: diffBaseSha,
    diff_head_sha: wkTip,
    diff_range: `${diffBaseSha}..${wkTip}`,
    complete_parent_wk_contract: true,
    accumulated_wk_diff: true
  });
}

export function isStaleSourceDigestResult(result) {
  if (!result || result.valid !== false) return false;
  if (typeof result.current_source_digest === "string") return true;
  const diagnostics = Array.isArray(result.diagnostics) ? result.diagnostics : [];
  return diagnostics.some((entry) => entry?.code === "stale_source_digest");
}

export function replayCommitRangeOnto({ runGit, mainRepo, baseSha, commit, onto }) {
  const ancestry = runGit({ repo: mainRepo, args: ["merge-base", "--is-ancestor", baseSha, commit] });
  if (!ancestry || ancestry.ok !== true) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH,
      "the exact slice target is not descended from its authenticated base", {
        base_sha: baseSha,
        commit
      });
  }
  const range = git(
    runGit,
    mainRepo,
    ["rev-list", "--reverse", "--topo-order", `${baseSha}..${commit}`],
    "could not enumerate the exact authenticated delivery range"
  ).stdout.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean);
  let originalParent = baseSha;
  let replayedParent = onto;
  for (const originalCommit of range) {
    const parentLine = git(
      runGit,
      mainRepo,
      ["rev-list", "-n", "1", "--parents", originalCommit],
      "could not resolve an exact-slice delivery parent"
    ).stdout.trim().split(/\s+/u);
    if (parentLine.length !== 2 || parentLine[1] !== originalParent) {
      fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH,
        "the exact slice delivery range must be one linear commit chain", {
          commit: originalCommit,
          expected_parent: originalParent,
          parents: parentLine.slice(1)
        });
    }
    const merge = runGit({
      repo: mainRepo,
      args: [
        "merge-tree", "--write-tree", "--no-messages",
        "--merge-base", originalParent,
        replayedParent,
        originalCommit
      ]
    });
    if (!merge || merge.ok !== true) {
      fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.REBASE_CONFLICT,
        "the immutable exact-slice delivery conflicts with the current WK tip", {
          base_sha: originalParent,
          slice_sha: originalCommit,
          wk_sha: replayedParent,
          stdout: String(merge?.stdout ?? "").slice(0, 8192),
          stderr: String(merge?.stderr ?? merge?.error ?? "").slice(0, 8192)
        });
    }
    const tree = assertOid(String(merge.stdout ?? "").split(/\r?\n/u)[0].trim(), "replayed tree");
    const message = git(
      runGit,
      mainRepo,
      ["show", "-s", "--format=%B", originalCommit],
      "could not read exact-slice delivery markers"
    ).stdout.trimEnd();
    replayedParent = git(
      runGit,
      mainRepo,
      [
        "-c", "user.name=Agent Chassis",
        "-c", "user.email=agent-chassis@localhost",
        "commit-tree", tree, "-p", replayedParent, "-m", message
      ],
      "could not materialize the replayed exact-slice commit"
    ).stdout.trim();
    assertOid(replayedParent, "replayed commit");
    originalParent = originalCommit;
  }
  return replayedParent;
}
