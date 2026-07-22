

import path from "node:path";
import os from "node:os";
import { mkdtempSync, rmSync } from "node:fs";

import { defaultRunGit } from "./worktree-substrate.mjs";
import {
  DEFAULT_EXPECTED_ENVELOPE_FIELD,
  WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES,
  fail,
  parseSubject,
  assertAbsolutePath
} from "./worktree-provisioning-dispatch-constants.mjs";

function isNonEmptyExpected(value) {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;

  return true;
}

function readWkRecordFromTree(runGit, mainRepo, baseSha, wkId) {
  const recordPathInTree = `wiki/work-records/${wkId}.json`;
  const res = runGit({ repo: mainRepo, args: ["show", `${baseSha}:${recordPathInTree}`] });
  if (!res || res.ok !== true) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.WK_RECORD_UNREADABLE_IN_TREE,
      `WK record ${recordPathInTree} not present in base_sha tree ${baseSha}`,
      { baseSha, recordPathInTree, stderr: res?.stderr ?? null }
    );
  }
  try {
    return JSON.parse(res.stdout);
  } catch (err) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.WK_RECORD_UNREADABLE_IN_TREE,
      `WK record ${recordPathInTree} in base_sha tree ${baseSha} is not valid JSON`,
      { baseSha, recordPathInTree, message: err?.message ?? null },
      err
    );
  }
}

function resolveExpectedForSubject(record, sliceId, expectedField) {
  if (sliceId !== null) {
    const slices = Array.isArray(record?.slices) ? record.slices : [];
    const slice = slices.find((s) => s && s.id === sliceId);
    if (slice && Object.prototype.hasOwnProperty.call(slice, expectedField)) {
      return { value: slice[expectedField], source: `slices[${sliceId}].${expectedField}` };
    }
  }
  return { value: record?.[expectedField], source: expectedField };
}

export function assertExpectedEnvelopePresent({
  runGit = defaultRunGit,
  mainRepo,
  baseSha,
  subject,
  expectedEnvelopeField = DEFAULT_EXPECTED_ENVELOPE_FIELD
} = {}) {
  const repo = assertAbsolutePath(mainRepo, "mainRepo");
  const { wkId, sliceId } = parseSubject(subject);
  if (typeof baseSha !== "string" || baseSha.trim().length === 0) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.INVALID_ARG,
      `baseSha must be a non-empty string, got: ${JSON.stringify(baseSha)}`
    );
  }
  const record = readWkRecordFromTree(runGit, repo, baseSha, wkId);
  const { value, source } = resolveExpectedForSubject(record, sliceId, expectedEnvelopeField);
  if (!isNonEmptyExpected(value)) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.EXPECTED_ENVELOPE_MISSING,
      `refusing to provision / mint base_sha: WK record for ${subject} carries no non-empty '${source}' ` +
        `as-of base_sha ${baseSha}; base_sha may be minted only AFTER the expected-envelope is committed ` +
        "(WK-1432 is the sole ordering guarantor)",
      { subject, baseSha, expectedField: expectedEnvelopeField, source }
    );
  }
  return Object.freeze({ present: true, baseSha, source });
}

export function assertFastForwardDescendant(runGit, mainRepo, currentWkTip, candidateBaseSha, detail) {
  if (currentWkTip === candidateBaseSha) return;
  const res = runGit({
    repo: mainRepo,
    args: ["merge-base", "--is-ancestor", currentWkTip, candidateBaseSha]
  });
  if (!res || res.ok !== true) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.RE_PROVISION_NOT_FAST_FORWARD,
      `refusing re-provision: recomputed base_sha ${candidateBaseSha} is not a fast-forward descendant of the ` +
        `current per-WK ref tip ${currentWkTip}; a reset would orphan un-integrated WK commits`,
      { ...detail, currentWkTip, candidateBaseSha }
    );
  }
}

const MAX_REPLAY_CAS_ATTEMPTS = 8;

function replayResolveTip(runGit, repo, ref) {
  const res = runGit({ repo, args: ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`] });
  const sha = res && res.ok === true ? String(res.stdout ?? "").trim() : "";
  return sha.length > 0 ? sha : null;
}

function replayRangeOnScratch({ runGit, mainRepo, scratchRoot, wkTip, oldBase, ontoSha }) {
  let scratchDir;
  try {
    scratchDir = mkdtempSync(path.join(scratchRoot, "wk-replay-"));
  } catch (error) {
    fail(WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.REPLAY_SCRATCH_FAILED, "could not create the replay scratch directory", { scratchRoot, message: error?.message ?? String(error) }, error);
  }
  const scratchWorktree = path.join(scratchDir, "wt");
  const cleanup = () => {
    runGit({ repo: mainRepo, args: ["worktree", "remove", "--force", scratchWorktree] });
    try { rmSync(scratchDir, { recursive: true, force: true }); } catch {   }
    runGit({ repo: mainRepo, args: ["worktree", "prune"] });
  };
  const add = runGit({ repo: mainRepo, args: ["worktree", "add", "--detach", scratchWorktree, wkTip] });
  if (!add || add.ok !== true) {
    cleanup();
    fail(WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.REPLAY_SCRATCH_FAILED, "could not add the replay scratch worktree", { wk_tip: wkTip, stderr: add?.stderr ?? add?.error ?? null });
  }
  const rebase = runGit({ repo: scratchWorktree, args: ["rebase", "--onto", ontoSha, oldBase] });
  if (!rebase || rebase.ok !== true) {
    runGit({ repo: scratchWorktree, args: ["rebase", "--abort"] });
    cleanup();
    fail(WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.REPLAY_CONFLICT, "dispatch-time WK-branch replay onto current main conflicted; scratch state cleaned and the shared WK ref untouched", { wk_tip: wkTip, old_base: oldBase, onto: ontoSha, stderr: rebase?.stderr ?? rebase?.error ?? null });
  }
  const replayedTip = replayResolveTip(runGit, scratchWorktree, "HEAD");
  cleanup();
  if (!replayedTip) {
    fail(WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.REPLAY_SCRATCH_FAILED, "could not resolve the replayed WK tip after a clean rebase", { wk_tip: wkTip, onto: ontoSha });
  }
  return replayedTip;
}

export function replayWkBranchOntoMain({
  mainRepo,
  wkRef,
  mainRef = "refs/heads/main",
  scratchRoot = null,
  deps = {}
} = {}) {
  const runGit = deps.runGit ?? defaultRunGit;
  const repo = assertAbsolutePath(mainRepo, "mainRepo");
  if (typeof wkRef !== "string" || wkRef.length === 0) {
    fail(WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.INVALID_ARG, `wkRef must be a non-empty string, got: ${JSON.stringify(wkRef)}`);
  }
  const mainTip = replayResolveTip(runGit, repo, mainRef);
  const wkTip = replayResolveTip(runGit, repo, wkRef);
  if (!wkTip) {
    return Object.freeze({ replayed: false, reason: "wk_branch_absent", wk_ref: wkRef, wk_tip: null, main_tip: mainTip });
  }
  if (!mainTip) {
    return Object.freeze({ replayed: false, reason: "main_unresolvable", wk_ref: wkRef, wk_tip: wkTip, main_tip: null });
  }
  const ownedScratchRoot = scratchRoot === null;
  const resolvedScratchRoot = scratchRoot === null
    ? mkdtempSync(path.join(os.tmpdir(), "wk-replay-root-"))
    : assertAbsolutePath(scratchRoot, "scratchRoot");
  try {
    let lastExpected = null;
    for (let attempt = 1; attempt <= MAX_REPLAY_CAS_ATTEMPTS; attempt += 1) {
      const wOld = replayResolveTip(runGit, repo, wkRef);
      const mCur = replayResolveTip(runGit, repo, mainRef);
      if (!wOld || !mCur) {
        return Object.freeze({ replayed: false, reason: "ref_vanished", wk_ref: wkRef, wk_tip: wOld, main_tip: mCur });
      }

      const onMain = runGit({ repo, args: ["merge-base", "--is-ancestor", mCur, wOld] });
      if (onMain && onMain.ok === true) {
        return Object.freeze({ replayed: false, reason: "already_on_main", wk_ref: wkRef, wk_tip: wOld, main_tip: mCur });
      }
      const mergeBaseRes = runGit({ repo, args: ["merge-base", mCur, wOld] });
      const oldBase = mergeBaseRes && mergeBaseRes.ok === true ? String(mergeBaseRes.stdout ?? "").trim() : "";
      if (oldBase.length === 0) {
        fail(WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.REPLAY_CONFLICT, "could not derive the WK/main merge-base for the dispatch replay", { wk_tip: wOld, main_tip: mCur });
      }
      const replayedTip = replayRangeOnScratch({ runGit, mainRepo: repo, scratchRoot: resolvedScratchRoot, wkTip: wOld, oldBase, ontoSha: mCur });

      const cas = runGit({ repo, args: ["update-ref", wkRef, replayedTip, wOld] });
      if (cas && cas.ok === true) {
        return Object.freeze({ replayed: true, wk_ref: wkRef, previous_wk_tip: wOld, wk_tip: replayedTip, main_tip: mCur, replayed_onto: mCur });
      }
      lastExpected = wOld;
    }
    fail(WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.REPLAY_CAS_EXHAUSTED, "bounded WK-branch replay compare-and-swap retries exhausted (concurrent integration advanced the ref; retryable)", { wk_ref: wkRef, attempts: MAX_REPLAY_CAS_ATTEMPTS, last_expected_old: lastExpected });
  } finally {
    if (ownedScratchRoot) {
      try { rmSync(resolvedScratchRoot, { recursive: true, force: true }); } catch {   }
    }
  }
}
