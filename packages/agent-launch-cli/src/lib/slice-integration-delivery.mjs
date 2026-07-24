

import { computeWorkRecordSourceDigest } from "@agent-chassis/wiki-core";

import { defaultRunGit } from "./worktree-substrate.mjs";
import { buildWkSliceMarkerTrailer } from "./commit-tool-exposure-guard.mjs";

import {
  SLICE_INTEGRATION_DIAGNOSTIC_CODES,
  SLICE_REF_RE,
  fail,
  assertOid,
  normalizeRef,
  git,
  revParse,
  resolveTree,
  sliceHasNoRemainingDelta,
  resolveSliceMarkerCommit,
  isLastIncompleteImplementationSlice,
  buildCompleteWkReviewTarget,
  isStaleSourceDigestResult,
  replayCommitRangeOnto
} from "./slice-integration-authorization.mjs";

const MAX_WK_REF_CAS_ATTEMPTS = 8;
const MAX_RECORD_CAS_ATTEMPTS = 8;

function resolveExactSliceDeliveryIdentity(runGit, repo, commit, expectedSubject, baseSha) {
  let tree;
  let parents;
  let message;
  try {
    tree = resolveTree(runGit, repo, commit);
    const parentLine = git(
      runGit,
      repo,
      ["rev-list", "-n", "1", "--parents", commit],
      "could not resolve exact-slice delivery parents"
    ).stdout.trim().split(/\s+/u).filter(Boolean);
    parents = parentLine.slice(1);
    message = git(
      runGit,
      repo,
      ["show", "-s", "--format=%B", commit],
      "could not resolve exact-slice delivery markers"
    ).stdout.trimEnd();
  } catch (error) {
    fail(
      SLICE_INTEGRATION_DIAGNOSTIC_CODES.SLICE_COMMIT_READ_INDETERMINATE,
      "exact-slice delivery identity could not be resolved",
      { commit },
      error
    );
  }
  const requiredMessage =
    `agent-launch worker delivery: ${expectedSubject} (base ${baseSha.slice(0, 12)})` +
    `\n\n${buildWkSliceMarkerTrailer(expectedSubject)}`;
  return Object.freeze({
    commit,
    tree,
    parents: Object.freeze(parents),
    required_markers_present: message === requiredMessage
  });
}

function exactSliceDeliveryEquivalent(identity, { baseSha, tree }) {
  return identity.parents.length === 1 && identity.parents[0] === baseSha &&
    identity.tree === tree && identity.required_markers_present === true;
}

function exactSliceCommitResult({ ref, baseSha, tree, commit, priorTip, idempotent, empty }) {
  return Object.freeze({
    ref,
    base_sha: baseSha,
    tree,
    commit,
    prior_tip: priorTip,
    idempotent,
    ref_advanced: !idempotent,
    empty_delivery: empty === true
  });
}

export function commitSliceRef({ repo, sliceRef, baseSha, commit, tree, deps = {} } = {}) {
  const runGit = deps.runGit ?? defaultRunGit;
  const { ref, match } = normalizeRef(sliceRef, SLICE_REF_RE, "sliceRef");
  assertOid(baseSha, "baseSha");
  assertOid(commit, "commit");
  assertOid(tree, "tree");
  const subject = `${match[2]}#${match[3]}`;
  const candidate = resolveExactSliceDeliveryIdentity(runGit, repo, commit, subject, baseSha);
  if (!exactSliceDeliveryEquivalent(candidate, { baseSha, tree })) {
    fail(
      SLICE_INTEGRATION_DIAGNOSTIC_CODES.SLICE_COMMIT_CONFLICT,
      "materialized commit does not match the authenticated exact-slice delivery identity",
      {
        ref,
        base_sha: baseSha,
        commit,
        expected_tree: tree,
        actual_tree: candidate.tree,
        parent_matches: candidate.parents.length === 1 && candidate.parents[0] === baseSha,
        required_markers_present: candidate.required_markers_present
      }
    );
  }

  let baseTree;
  try {
    baseTree = resolveTree(runGit, repo, baseSha);
  } catch (error) {
    fail(
      SLICE_INTEGRATION_DIAGNOSTIC_CODES.SLICE_COMMIT_READ_INDETERMINATE,
      "launcher-bound base tree could not be resolved",
      { ref, base_sha: baseSha },
      error
    );
  }
  const empty = baseTree === tree;

  let current;
  try {
    current = revParse(runGit, repo, ref);
  } catch (error) {
    fail(
      SLICE_INTEGRATION_DIAGNOSTIC_CODES.SLICE_COMMIT_READ_INDETERMINATE,
      "exact slice ref could not be read before compare-and-swap",
      { ref, base_sha: baseSha },
      error
    );
  }

  if (current !== baseSha) {
    const winner = resolveExactSliceDeliveryIdentity(runGit, repo, current, subject, baseSha);
    if (exactSliceDeliveryEquivalent(winner, { baseSha, tree })) {
      return exactSliceCommitResult({
        ref, baseSha, tree, commit: current, priorTip: baseSha, idempotent: true, empty
      });
    }
    fail(
      SLICE_INTEGRATION_DIAGNOSTIC_CODES.SLICE_COMMIT_CONFLICT,
      "slice ref carries a different authenticated delivery; it is never overwritten",
      {
        ref,
        base_sha: baseSha,
        tree,
        observed_tip: current,
        observed_tree: winner.tree,
        observed_parent_matches: winner.parents.length === 1 && winner.parents[0] === baseSha,
        observed_markers_match: winner.required_markers_present
      }
    );
  }

  const cas = runGit({ repo, args: ["update-ref", ref, commit, baseSha] });
  if (cas && cas.ok === true) {
    return exactSliceCommitResult({
      ref, baseSha, tree, commit, priorTip: baseSha, idempotent: false, empty
    });
  }

  let winnerSha;
  try {
    winnerSha = revParse(runGit, repo, ref);
  } catch (error) {
    fail(
      SLICE_INTEGRATION_DIAGNOSTIC_CODES.SLICE_COMMIT_READ_INDETERMINATE,
      "slice ref compare-and-swap lost and the winner could not be read",
      { ref, base_sha: baseSha, attempted_commit: commit },
      error
    );
  }
  const winner = resolveExactSliceDeliveryIdentity(runGit, repo, winnerSha, subject, baseSha);
  if (exactSliceDeliveryEquivalent(winner, { baseSha, tree })) {
    return exactSliceCommitResult({
      ref, baseSha, tree, commit: winnerSha, priorTip: baseSha, idempotent: true, empty
    });
  }
  fail(
    SLICE_INTEGRATION_DIAGNOSTIC_CODES.SLICE_COMMIT_CONFLICT,
    "slice ref compare-and-swap lost to a different delivery; the winner is never overwritten",
    {
      ref,
      base_sha: baseSha,
      attempted_commit: commit,
      observed_tip: winnerSha,
      observed_tree: winner.tree,
      observed_parent_matches: winner.parents.length === 1 && winner.parents[0] === baseSha,
      observed_markers_match: winner.required_markers_present
    }
  );
}

export function compensateCommittedSliceRef({
  repo,
  sliceRef,
  publishedCommit,
  priorTip,
  deps = {}
} = {}) {
  const runGit = deps.runGit ?? defaultRunGit;
  const { ref } = normalizeRef(sliceRef, SLICE_REF_RE, "sliceRef");
  assertOid(publishedCommit, "publishedCommit");
  assertOid(priorTip, "priorTip");

  const readCurrent = () => {
    try {
      return revParse(runGit, repo, ref);
    } catch (error) {
      fail(
        SLICE_INTEGRATION_DIAGNOSTIC_CODES.SLICE_COMMIT_COMPENSATION_FAILED,
        "exact slice ref could not be read during compensation",
        { ref, published_commit: publishedCommit, prior_tip: priorTip, observed_tip: null },
        error
      );
    }
  };
  const before = readCurrent();
  if (before !== publishedCommit) {
    fail(
      SLICE_INTEGRATION_DIAGNOSTIC_CODES.SLICE_COMMIT_COMPENSATION_CAS_LOST,
      "compensation refused because the exact slice ref moved concurrently",
      { ref, published_commit: publishedCommit, prior_tip: priorTip, observed_tip: before }
    );
  }
  const cas = runGit({ repo, args: ["update-ref", ref, priorTip, publishedCommit] });
  if (!cas || cas.ok !== true) {
    let observed = null;
    try {
      observed = revParse(runGit, repo, ref);
    } catch {

    }
    const code = observed !== null && observed !== publishedCommit
      ? SLICE_INTEGRATION_DIAGNOSTIC_CODES.SLICE_COMMIT_COMPENSATION_CAS_LOST
      : SLICE_INTEGRATION_DIAGNOSTIC_CODES.SLICE_COMMIT_COMPENSATION_FAILED;
    fail(code, "exact slice ref compensation compare-and-swap failed", {
      ref,
      published_commit: publishedCommit,
      prior_tip: priorTip,
      observed_tip: observed,
      status: cas?.status ?? null
    });
  }
  const after = readCurrent();
  if (after !== priorTip) {
    fail(
      SLICE_INTEGRATION_DIAGNOSTIC_CODES.SLICE_COMMIT_COMPENSATION_CAS_LOST,
      "exact slice ref moved after compensation",
      { ref, published_commit: publishedCommit, prior_tip: priorTip, observed_tip: after }
    );
  }
  return Object.freeze({
    compensated: true,
    ref,
    published_commit: publishedCommit,
    restored_tip: priorTip
  });
}

export function advanceSliceRefCas({ runGit, mainRepo, wkRef, wkId, sliceId, baseSha, commit }) {
  let lastExpected = null;
  for (let attempt = 1; attempt <= MAX_WK_REF_CAS_ATTEMPTS; attempt += 1) {
    const wkOld = revParse(runGit, mainRepo, wkRef);
    if (sliceHasNoRemainingDelta({ runGit, mainRepo, baseSha, commit, wkTip: wkOld })) {
      return {
        integratedCommit: wkOld,
        deliveryCommit: commit,
        previousWkSha: wkOld,
        rebased: false,
        already_present: true,
        empty_delivery: true
      };
    }
    const markerCommit = resolveSliceMarkerCommit(runGit, mainRepo, wkOld, wkId, sliceId);
    if (markerCommit !== null) {

      return {
        integratedCommit: markerCommit,
        deliveryCommit: commit,
        previousWkSha: wkOld,
        rebased: false,
        already_present: true,
        empty_delivery: false
      };
    }
    let integratedCommit;
    let rebased;
    if (baseSha === wkOld) {
      integratedCommit = commit;
      rebased = false;
    } else {
      integratedCommit = replayCommitRangeOnto({
        runGit,
        mainRepo,
        baseSha,
        commit,
        onto: wkOld
      });
      rebased = true;
    }

    const ancestor = runGit({ repo: mainRepo, args: ["merge-base", "--is-ancestor", wkOld, integratedCommit] });
    if (!ancestor || ancestor.ok !== true) {
      fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.WK_ADVANCE_CONFLICT, "integrated slice is not a fast-forward of the WK tip", { wk_ref: wkRef, prior_wk_sha: wkOld, integrated_sha: integratedCommit });
    }
    const cas = runGit({ repo: mainRepo, args: ["update-ref", wkRef, integratedCommit, wkOld] });
    if (cas && cas.ok === true) {
      return {
        integratedCommit,
        deliveryCommit: commit,
        previousWkSha: wkOld,
        rebased,
        already_present: false,
        empty_delivery: false
      };
    }

    lastExpected = wkOld;
  }
  fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.WK_ADVANCE_CONFLICT, "bounded WK ref compare-and-swap retries exhausted (spurious lost race under replay herd; retryable)", {
    wk_ref: wkRef,
    attempts: MAX_WK_REF_CAS_ATTEMPTS,
    last_expected_old: lastExpected
  });
}

export async function driveRecordCasWrite({
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
      return { reviewTarget, transition, finalSlice, wkTip };
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
