

import { readFileSync } from "node:fs";
import path from "node:path";

import { computeWorkRecordSourceDigest } from "@agent-chassis/wiki-core";

import {
  resolveSliceReviewAcceptanceProof
} from "@agent-chassis/wiki-core/src/operations/work-record-slice-review-acceptance.mjs";
import {
  SLICE_REVIEW_ACCEPTANCE_DECISION_CODES
} from "@agent-chassis/wiki-core/src/lib/work-record-slice-review-acceptance.mjs";

import { defaultRunGit } from "./worktree-substrate.mjs";
import { buildWkSliceMarkerTrailer } from "./commit-tool-exposure-guard.mjs";

export const SLICE_INTEGRATION_SCHEMA_VERSION = "slice-integration.v1";
export const SLICE_REVIEW_ENFORCEMENT_MODES = Object.freeze({
  ENFORCED_CCE: "enforced_cce",
  POLICY_ONLY: "policy_only"
});

const MAX_WK_REF_CAS_ATTEMPTS = 8;
const MAX_RECORD_CAS_ATTEMPTS = 8;

export const SLICE_INTEGRATION_DIAGNOSTIC_CODES = Object.freeze({
  INVALID_ARG: "agent_launch.slice_integration.invalid_arg.v1",
  BINDING_MISMATCH: "agent_launch.slice_integration.binding_mismatch.v1",
  WORKER_NOT_TERMINATED: "agent_launch.slice_integration.worker_not_terminated.v1",
  INDEX_RECONCILE_FAILED: "agent_launch.slice_integration.index_reconcile_failed.v1",
  WORKTREE_DIRTY: "agent_launch.slice_integration.worktree_dirty.v1",
  REVIEW_UNRESOLVED: "agent_launch.slice_integration.review_unresolved.v1",
  DEPENDENCY_UNACCEPTED: "agent_launch.slice_integration.dependency_unaccepted.v1",
  SLICE_COMMIT_CONFLICT: "agent_launch.slice_integration.slice_commit_conflict.v1",
  REBASE_CONFLICT: "agent_launch.slice_integration.rebase_conflict.v1",
  REBASE_RESTORE_FAILED: "agent_launch.slice_integration.rebase_restore_failed.v1",
  WK_ADVANCE_CONFLICT: "agent_launch.slice_integration.wk_advance_conflict.v1",
  REVIEW_FREEZE_FAILED: "agent_launch.slice_integration.review_freeze_failed.v1",

  RECORD_CAS_EXHAUSTED: "agent_launch.slice_integration.record_cas_exhausted.v1",
  RECORD_WRITE_FAILED: "agent_launch.slice_integration.record_write_failed.v1",
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

function assertExactWorktreeBinding(runGit, worktreePath, sliceRef, expectedHead) {
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

function reconcileAndAssertCleanExactWorktree(runGit, worktreePath, expectedHead) {

  git(
    runGit,
    worktreePath,
    ["reset", "--mixed", "--no-refresh", expectedHead],
    "could not reconcile the retained slice worktree index",
    SLICE_INTEGRATION_DIAGNOSTIC_CODES.INDEX_RECONCILE_FAILED
  );
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

function isImplementationSlice(slice) {
  const kind = typeof slice?.work_kind === "string" && slice.work_kind.length > 0
    ? slice.work_kind
    : "implementation";
  return kind === "implementation";
}

function ereEscape(value) {
  return String(value).replace(/[.\\[\]()*+?{}|^$]/gu, "\\$&");
}

function resolveSliceMarkerCommit(runGit, mainRepo, wkTipSha, wkId, sliceId) {
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

function isLastIncompleteImplementationSlice(record, sliceId, runGit, mainRepo, wkTipSha, wkId) {
  return !record.slices.some((entry) =>
    entry &&
    entry.id !== sliceId &&
    isImplementationSlice(entry) &&
    !isSiblingImplementationComplete(entry, runGit, mainRepo, wkTipSha, wkId)
  );
}

const REVIEW_ACCEPTANCE_CODES = SLICE_REVIEW_ACCEPTANCE_DECISION_CODES;

const SLICE_REVIEW_BINDING_FIELDS = Object.freeze([
  "unit_address",
  "initiative",
  "slice_ref",
  "reviewed_sha",
  "diff_base_sha",
  "source_worker_run_id",
  "review_run_id"
]);

function assertSliceReviewObjectStoreProbes(runGit, mainRepo, binding) {
  const probes = [
    { name: "slice_ref_resolves_to_reviewed_sha", rev: `${binding.slice_ref}^{commit}`, expect: binding.reviewed_sha },
    { name: "reviewed_commit_object_present", rev: `${binding.reviewed_sha}^{commit}`, expect: binding.reviewed_sha },
    { name: "slice_diff_base_object_present", rev: `${binding.diff_base_sha}^{commit}`, expect: binding.diff_base_sha }
  ];
  for (const probe of probes) {
    const result = runGit({ repo: mainRepo, args: ["rev-parse", "--verify", probe.rev] });
    const actual = result && result.ok === true ? String(result.stdout ?? "").trim() : null;
    if (actual !== probe.expect) {
      fail(REVIEW_ACCEPTANCE_CODES.targetStale, "slice-review object-store probe does not confirm the reviewed slice target", {
        probe: probe.name,
        expected: probe.expect,
        actual
      });
    }
  }
}

function assertCanonicalSliceStillInReview(record, sliceId) {
  if (record.status === "review") {
    fail(REVIEW_ACCEPTANCE_CODES.targetStale, "parent WK entered whole-WK review; a slice-level acceptance no longer authorizes integration", {
      wk_id: record.id,
      parent_status: record.status
    });
  }
  const slice = record.slices.find((entry) => entry?.id === sliceId);
  const workKind = typeof slice?.work_kind === "string" && slice.work_kind.length > 0
    ? slice.work_kind
    : "implementation";
  if (!slice || workKind !== "implementation" || slice.status !== "review") {
    fail(REVIEW_ACCEPTANCE_CODES.reviewNotAccepted, "canonical slice is not an implementation slice under unresolved slice-level review", {
      slice_id: sliceId,
      work_kind: slice ? workKind : null,
      slice_status: slice?.status ?? null
    });
  }
}

async function assertSliceReviewAcceptance({
  runGit,
  mainRepo,
  record,
  sliceRef,
  wkId,
  sliceId,
  initiative,
  commit,
  sliceReviewAcceptance,
  deps
}) {
  const unitAddress = `${wkId}#${sliceId}`;
  if (sliceReviewAcceptance === null || sliceReviewAcceptance === undefined) {
    fail(REVIEW_ACCEPTANCE_CODES.missing, "integration requires the launcher-owned slice-review binding; no slice-level review has been accepted for this unit", {
      unit_address: unitAddress
    });
  }
  if (typeof sliceReviewAcceptance !== "object") {
    fail(REVIEW_ACCEPTANCE_CODES.malformed, "slice-review binding must be an object", { unit_address: unitAddress });
  }
  const missingField = SLICE_REVIEW_BINDING_FIELDS.find(
    (field) => typeof sliceReviewAcceptance[field] !== "string" || sliceReviewAcceptance[field].length === 0
  );
  if (missingField !== undefined) {
    fail(REVIEW_ACCEPTANCE_CODES.malformed, "slice-review binding is missing a required launcher-owned field", {
      unit_address: unitAddress,
      field: missingField
    });
  }

  if (sliceReviewAcceptance.unit_address !== unitAddress ||
      sliceReviewAcceptance.initiative !== initiative ||
      sliceReviewAcceptance.slice_ref !== sliceRef) {
    fail(REVIEW_ACCEPTANCE_CODES.bindingMismatch, "slice-review binding does not identify the slice being integrated", {
      expected: { unit_address: unitAddress, initiative, slice_ref: sliceRef },
      actual: {
        unit_address: sliceReviewAcceptance.unit_address,
        initiative: sliceReviewAcceptance.initiative,
        slice_ref: sliceReviewAcceptance.slice_ref
      }
    });
  }

  const currentSliceSha = revParse(runGit, mainRepo, sliceRef);
  if (currentSliceSha !== sliceReviewAcceptance.reviewed_sha || commit !== sliceReviewAcceptance.reviewed_sha) {
    fail(REVIEW_ACCEPTANCE_CODES.targetStale, "the slice tip under integration is not the reviewed SHA; the review must be repeated", {
      unit_address: unitAddress,
      reviewed_sha: sliceReviewAcceptance.reviewed_sha,
      current_slice_sha: currentSliceSha,
      integrating_commit: commit
    });
  }

  assertSliceReviewObjectStoreProbes(runGit, mainRepo, sliceReviewAcceptance);
  assertCanonicalSliceStillInReview(record, sliceId);

  const resolve = deps.resolveSliceReviewAcceptanceProof ?? resolveSliceReviewAcceptanceProof;
  const resolved = await resolve({
    dir: mainRepo,
    unit_address: unitAddress,
    expectation: {
      unit_address: unitAddress,
      initiative: sliceReviewAcceptance.initiative,
      slice_ref: sliceReviewAcceptance.slice_ref,
      reviewed_sha: sliceReviewAcceptance.reviewed_sha,
      diff_base_sha: sliceReviewAcceptance.diff_base_sha,
      source_worker_run_id: sliceReviewAcceptance.source_worker_run_id,
      review_run_id: sliceReviewAcceptance.review_run_id,
      review_monitor_handle: sliceReviewAcceptance.review_monitor_handle,
      reviewer_role: "reviewer",
      review_outcome: sliceReviewAcceptance.review_outcome,
      structured_result_digest: sliceReviewAcceptance.structured_result_digest,
      current_slice_sha: currentSliceSha
    }
  });
  if (!resolved || resolved.ok !== true) {
    const code = typeof resolved?.decision_code === "string" && resolved.decision_code.length > 0
      ? resolved.decision_code
      : REVIEW_ACCEPTANCE_CODES.missing;
    fail(code, "slice-review acceptance proof did not authorize this integration", {
      unit_address: unitAddress,
      decision_code: code,
      reasons: Array.isArray(resolved?.reasons) ? resolved.reasons : []
    });
  }
  return Object.freeze({
    schema_version: "slice-review-acceptance-gate.v1",
    unit_address: unitAddress,
    reviewed_sha: sliceReviewAcceptance.reviewed_sha,
    review_run_id: sliceReviewAcceptance.review_run_id,
    evidence_digest: resolved.proof?.evidence_digest ?? null,
    decision_code: resolved.decision_code
  });
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

function restoreCompletedRebase(runGit, worktreePath, sliceRef, preRebaseSha) {
  const reset = runGit({ repo: worktreePath, args: ["reset", "--hard", preRebaseSha] });
  if (!reset || reset.ok !== true) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.REBASE_RESTORE_FAILED, "failed to restore the retained slice after downstream integration failure", {
      slice_ref: sliceRef,
      pre_rebase_sha: preRebaseSha,
      detail: reset?.stderr ?? reset?.error ?? reset?.status ?? null
    });
  }
  const head = revParse(runGit, worktreePath, "HEAD");
  const tip = revParse(runGit, worktreePath, sliceRef);
  if (head !== preRebaseSha || tip !== preRebaseSha) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.REBASE_RESTORE_FAILED, "retained slice restoration did not recover the exact pre-rebase state", {
      slice_ref: sliceRef,
      pre_rebase_sha: preRebaseSha,
      head,
      tip
    });
  }
}

function advanceSliceRefCas({ runGit, mainRepo, worktreePath, sliceRef, wkRef, wkId, sliceId, baseSha, commit }) {
  let lastExpected = null;
  for (let attempt = 1; attempt <= MAX_WK_REF_CAS_ATTEMPTS; attempt += 1) {
    const wkOld = revParse(runGit, mainRepo, wkRef);
    const markerCommit = resolveSliceMarkerCommit(runGit, mainRepo, wkOld, wkId, sliceId);
    if (markerCommit !== null) {

      return { integratedCommit: markerCommit, previousWkSha: wkOld, rebased: false, already_present: true };
    }
    let integratedCommit;
    let rebased;
    if (baseSha === wkOld) {
      integratedCommit = commit;
      rebased = false;
    } else {

      const result = runGit({ repo: worktreePath, args: ["rebase", "--onto", wkOld, baseSha] });
      if (!result || result.ok !== true) {
        restorePreRebaseState(runGit, worktreePath, sliceRef, commit);
        fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.REBASE_CONFLICT, "trusted slice rebase conflicted; pre-rebase state restored and both refs preserved", {
          slice_ref: sliceRef,
          slice_sha: commit,
          wk_ref: wkRef,
          wk_sha: wkOld,
          stderr: result?.stderr ?? result?.error ?? null
        });
      }
      integratedCommit = revParse(runGit, worktreePath, "HEAD");
      rebased = true;
    }

    const ancestor = runGit({ repo: mainRepo, args: ["merge-base", "--is-ancestor", wkOld, integratedCommit] });
    if (!ancestor || ancestor.ok !== true) {
      if (rebased) restoreCompletedRebase(runGit, worktreePath, sliceRef, commit);
      fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.WK_ADVANCE_CONFLICT, "integrated slice is not a fast-forward of the WK tip", { wk_ref: wkRef, prior_wk_sha: wkOld, integrated_sha: integratedCommit });
    }
    const cas = runGit({ repo: mainRepo, args: ["update-ref", wkRef, integratedCommit, wkOld] });
    if (cas && cas.ok === true) {
      return { integratedCommit, previousWkSha: wkOld, rebased, already_present: false };
    }

    if (rebased) restoreCompletedRebase(runGit, worktreePath, sliceRef, commit);
    lastExpected = wkOld;
  }
  fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.WK_ADVANCE_CONFLICT, "bounded WK ref compare-and-swap retries exhausted (spurious lost race under replay herd; retryable)", {
    wk_ref: wkRef,
    attempts: MAX_WK_REF_CAS_ATTEMPTS,
    last_expected_old: lastExpected
  });
}

function buildCompleteWkReviewTarget({ runGit, mainRepo, initiative, wkId, wkRef, wkTip }) {
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

function isStaleSourceDigestResult(result) {
  if (!result || result.valid !== false) return false;
  if (typeof result.current_source_digest === "string") return true;
  const diagnostics = Array.isArray(result.diagnostics) ? result.diagnostics : [];
  return diagnostics.some((entry) => entry?.code === "stale_source_digest");
}

async function driveRecordCasWrite({
  runGit,
  mainRepo,
  wkRef,
  initiative,
  wkId,
  sliceId,
  loadRecord,
  transitionToReview,
  markSliceComplete
}) {
  let lastCurrent = null;
  for (let attempt = 1; attempt <= MAX_RECORD_CAS_ATTEMPTS; attempt += 1) {
    const record = loadRecord(mainRepo, wkId);
    const expectedSourceDigest = computeWorkRecordSourceDigest(record);

    const wkTip = revParse(runGit, mainRepo, wkRef);
    const finalSlice = isLastIncompleteImplementationSlice(record, sliceId, runGit, mainRepo, wkTip, wkId);
    let reviewTarget = null;
    let transition;
    if (finalSlice) {
      reviewTarget = buildCompleteWkReviewTarget({ runGit, mainRepo, initiative, wkId, wkRef, wkTip });
      transition = await transitionToReview({
        unitAddress: wkId,
        status: "review",
        reviewTarget,
        expectedSourceDigest
      });
    } else {

      const writeSliceStatus = markSliceComplete ?? transitionToReview;
      transition = await writeSliceStatus({
        unitAddress: `${wkId}#${sliceId}`,
        status: "done",
        reviewTarget: null,
        expectedSourceDigest
      });
    }
    if (transition && transition.valid === true && (transition.written === true || transition.no_op === true)) {
      return { reviewTarget, transition, finalSlice };
    }
    if (isStaleSourceDigestResult(transition)) {
      lastCurrent = transition?.current_source_digest ?? null;
      continue;
    }

    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.RECORD_WRITE_FAILED, finalSlice
      ? "canonical review transition did not confirm a write/no-op"
      : "canonical slice-completion transition did not confirm a write/no-op", {
      wk_id: wkId,
      slice_id: sliceId,
      final_slice: finalSlice,
      transition: transition ?? null
    });
  }
  fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.RECORD_CAS_EXHAUSTED, "bounded record compare-and-swap retries exhausted (concurrent coordinator churn; retryable via re-poll)", {
    wk_id: wkId,
    slice_id: sliceId,
    attempts: MAX_RECORD_CAS_ATTEMPTS,
    last_current_source_digest: lastCurrent
  });
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
  markSliceComplete,

  sliceReviewAcceptance = null,

  reviewEnforcementMode = SLICE_REVIEW_ENFORCEMENT_MODES.ENFORCED_CCE,
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
  assertExactWorktreeBinding(runGit, worktreePath, slice.ref, commit);
  const record = (deps.loadCanonicalRecord ?? parseCanonicalRecord)(mainRepo, slice.match[2]);
  assertReviewAndDependencies(record, slice.match[3]);
  reconcileAndAssertCleanExactWorktree(runGit, worktreePath, commit);

  const loadRecord = deps.loadCanonicalRecord ?? parseCanonicalRecord;

  if (!Object.values(SLICE_REVIEW_ENFORCEMENT_MODES).includes(reviewEnforcementMode)) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.INVALID_ARG,
      "launcher-owned slice review enforcement mode is invalid");
  }

  const reviewAcceptance = reviewEnforcementMode === SLICE_REVIEW_ENFORCEMENT_MODES.ENFORCED_CCE
    ? await assertSliceReviewAcceptance({
        runGit,
        mainRepo,
        record,
        sliceRef: slice.ref,
        wkId: slice.match[2],
        sliceId: slice.match[3],
        initiative: slice.match[1],
        commit,
        sliceReviewAcceptance,
        deps
      })
    : null;

  const advance = advanceSliceRefCas({
    runGit,
    mainRepo,
    worktreePath,
    sliceRef: slice.ref,
    wkRef: wk.ref,
    wkId: slice.match[2],
    sliceId: slice.match[3],
    baseSha,
    commit
  });
  const integratedCommit = advance.integratedCommit;
  const wkOld = advance.previousWkSha;
  const rebased = advance.rebased;

  const write = await driveRecordCasWrite({
    runGit,
    mainRepo,
    wkRef: wk.ref,
    initiative: slice.match[1],
    wkId: slice.match[2],
    sliceId: slice.match[3],
    loadRecord,
    transitionToReview,
    markSliceComplete
  });

  return Object.freeze({
    schema_version: SLICE_INTEGRATION_SCHEMA_VERSION,
    integrated: true,
    rebased,
    previous_wk_sha: wkOld,
    slice_ref: slice.ref,
    slice_sha: integratedCommit,
    wk_ref: wk.ref,
    wk_sha: integratedCommit,

    review_target: write.reviewTarget,
    transition: write.transition,

    slice_review_acceptance: reviewAcceptance,

    slice_review_policy: reviewEnforcementMode === SLICE_REVIEW_ENFORCEMENT_MODES.POLICY_ONLY
      ? Object.freeze({
          schema_version: "slice-review-policy-only.v1",
          enforcement_mode: SLICE_REVIEW_ENFORCEMENT_MODES.POLICY_ONLY,
          audit_grade: false,
          review_evidence_required: false
        })
      : null
  });
}

export function reconcileIntegratedSliceRecord({
  mainRepo,
  unitAddress,
  sliceRef,
  wkRef,
  deps = {}
} = {}) {
  const runGit = deps.runGit ?? defaultRunGit;
  const slice = normalizeRef(sliceRef, SLICE_REF_RE, "sliceRef");
  const wk = normalizeRef(wkRef, WK_REF_RE, "wkRef");
  if (slice.match[1] !== wk.match[1] || slice.match[2] !== wk.match[2]) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH, "slice and WK refs do not identify the same WK");
  }
  const expectedUnit = `${slice.match[1]}/${slice.match[2]}/${slice.match[3]}`;
  if (unitAddress !== expectedUnit) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH, "unitAddress does not match the exact slice ref", { expected: expectedUnit, actual: unitAddress });
  }
  const wkTip = revParse(runGit, mainRepo, wk.ref);
  const markerSha = resolveSliceMarkerCommit(runGit, mainRepo, wkTip, slice.match[2], slice.match[3]);
  if (markerSha === null) {
    return null;
  }
  const sliceTip = revParse(runGit, mainRepo, slice.ref);
  if (sliceTip !== markerSha) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH,
      "integrated slice marker does not match the retained slice ref", {
        slice_ref: slice.ref,
        slice_tip: sliceTip,
        marker_sha: markerSha
      });
  }
  const loadRecord = deps.loadCanonicalRecord ?? parseCanonicalRecord;
  const record = loadRecord(mainRepo, slice.match[2]);
  const sliceEntry = Array.isArray(record?.slices)
    ? record.slices.find((entry) => entry?.id === slice.match[3])
    : null;
  const sliceComplete = sliceEntry ? (sliceEntry.status === "done" || sliceEntry.status === "cancelled") : false;
  const wkInReview = record?.status === "review";
  const wkInTerminalRecoveryPosture = wkInReview || record?.status === "done";
  if (!sliceComplete && !wkInTerminalRecoveryPosture) {

    return null;
  }

  const ownsCurrentWkTip = markerSha === wkTip;
  const reviewTarget = wkInReview && ownsCurrentWkTip
    ? buildCompleteWkReviewTarget({ runGit, mainRepo, initiative: slice.match[1], wkId: slice.match[2], wkRef: wk.ref, wkTip })
    : null;
  return Object.freeze({
    schema_version: SLICE_INTEGRATION_SCHEMA_VERSION,
    integrated: true,
    recovered: true,
    rebased: false,
    previous_wk_sha: null,
    slice_ref: slice.ref,
    slice_sha: markerSha,
    wk_ref: wk.ref,
    wk_sha: wkTip,
    review_target: reviewTarget,
    transition: Object.freeze({
      valid: true,
      written: false,
      no_op: true,
      status: wkInReview && ownsCurrentWkTip ? "review" : "done",
      recovered: true
    }),
    integrated_state: wkInTerminalRecoveryPosture && ownsCurrentWkTip ? "final" : "non_final"
  });
}
