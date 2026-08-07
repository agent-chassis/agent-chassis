

import { spawnSync } from "node:child_process";

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
  SLICE_MARKER_EVIDENCE_STATES,
  resolveSliceMarkerEvidence,
  buildZeroDeltaIntegrationEvidenceMessage,
  authenticateZeroDeltaIntegrationEvidenceCommit,
  resolveZeroDeltaIntegrationEvidence,
  isLastIncompleteImplementationSlice,
  resolveFixedWkForkCommit,
  buildCompleteWkReviewTarget,
  isStaleSourceDigestResult,
  replayCommitRangeOnto
} from "./slice-integration-authorization.mjs";

const MAX_WK_REF_CAS_ATTEMPTS = 8;
const MAX_RECORD_CAS_ATTEMPTS = 8;

function defaultRunGitRefTransaction({ repo, input }) {
  let result;
  try {
    result = spawnSync(
      "git",
      ["-C", repo, "-c", "core.quotePath=false", "update-ref", "--stdin"],
      { encoding: "utf8", input, maxBuffer: 64 * 1024 * 1024 }
    );
  } catch (error) {
    return { ok: false, error: error?.message ?? String(error) };
  }
  if (result.error) return { ok: false, error: result.error.message ?? String(result.error) };
  return result.status === 0
    ? { ok: true, stdout: result.stdout }
    : {
        ok: false,
        status: result.status ?? null,
        signal: result.signal ?? null,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? ""
      };
}

function exactConcurrentZeroDeltaWinner({
  runGit,
  mainRepo,
  sliceRef,
  wkRef,
  subject,
  deliverySha,
  baseSha,
  wkParentSha
}) {
  let wkTip;
  try {
    wkTip = revParse(runGit, mainRepo, wkRef);
  } catch {
    return null;
  }
  const evidence = resolveZeroDeltaIntegrationEvidence({
    runGit,
    mainRepo,
    wkTip,
    subject,
    deliverySha,
    baseSha
  });
  if (evidence.count !== 1 || evidence.match.wk_parent_sha !== wkParentSha) return null;
  let sliceTip;
  try {
    sliceTip = revParse(runGit, mainRepo, sliceRef);
  } catch {
    return null;
  }
  if (sliceTip !== deliverySha) return null;
  return evidence.match;
}

export function advanceZeroDeltaEvidenceRefTransaction({
  runGit,
  runGitRefTransaction = defaultRunGitRefTransaction,
  mainRepo,
  sliceRef,
  wkRef,
  subject,
  deliverySha,
  baseSha,
  wkParentSha
}) {
  const observedSlice = revParse(runGit, mainRepo, sliceRef);
  const observedWk = revParse(runGit, mainRepo, wkRef);
  if (observedSlice !== deliverySha || observedWk !== wkParentSha) {
    fail(
      SLICE_INTEGRATION_DIAGNOSTIC_CODES.WK_ADVANCE_CONFLICT,
      "zero-delta integration refs moved before evidence publication",
      {
        slice_ref: sliceRef,
        expected_slice_sha: deliverySha,
        observed_slice_sha: observedSlice,
        wk_ref: wkRef,
        expected_wk_sha: wkParentSha,
        observed_wk_sha: observedWk
      }
    );
  }
  const tree = resolveTree(runGit, mainRepo, wkParentSha);
  const message = buildZeroDeltaIntegrationEvidenceMessage({
    subject,
    deliverySha,
    baseSha,
    wkParentSha
  });
  const evidenceSha = assertOid(
    git(
      runGit,
      mainRepo,
      ["commit-tree", tree, "-p", wkParentSha, "-m", message.slice(0, -1)],
      "could not mint zero-delta integration evidence"
    ).stdout.trim(),
    "zero-delta evidence commit"
  );
  const authenticated = authenticateZeroDeltaIntegrationEvidenceCommit({
    runGit,
    mainRepo,
    evidenceSha,
    subject,
    deliverySha,
    baseSha,
    wkParentSha
  });
  if (authenticated === null || authenticated.tree !== tree) {
    fail(
      SLICE_INTEGRATION_DIAGNOSTIC_CODES.ZERO_DELTA_EVIDENCE_INDETERMINATE,
      "minted zero-delta integration evidence failed exact reauthentication",
      { evidence_sha: evidenceSha }
    );
  }
  const transaction = [
    "option no-deref",
    "start",
    `verify ${sliceRef} ${deliverySha}`,

    `update ${wkRef} ${evidenceSha} ${wkParentSha}`,
    "prepare",
    "commit",
    ""
  ].join("\n");
  const advanced = runGitRefTransaction({ repo: mainRepo, input: transaction });
  if (advanced?.ok === true) {
    const currentSlice = revParse(runGit, mainRepo, sliceRef);
    const currentWk = revParse(runGit, mainRepo, wkRef);
    if (currentSlice !== deliverySha || currentWk !== evidenceSha) {
      fail(
        SLICE_INTEGRATION_DIAGNOSTIC_CODES.WK_ADVANCE_CONFLICT,
        "zero-delta ref transaction returned incoherent ref state",
        { current_slice_sha: currentSlice, current_wk_sha: currentWk, evidence_sha: evidenceSha }
      );
    }
    return Object.freeze({ ...authenticated, evidence_sha: evidenceSha, concurrent: false });
  }
  const winner = exactConcurrentZeroDeltaWinner({
    runGit,
    mainRepo,
    sliceRef,
    wkRef,
    subject,
    deliverySha,
    baseSha,
    wkParentSha
  });
  if (winner !== null) return Object.freeze({ ...winner, concurrent: true });
  fail(
    SLICE_INTEGRATION_DIAGNOSTIC_CODES.WK_ADVANCE_CONFLICT,
    "zero-delta integration ref transaction refused without one exact winner",
    {
      slice_ref: sliceRef,
      wk_ref: wkRef,
      expected_slice_sha: deliverySha,
      expected_wk_sha: wkParentSha,
      status: advanced?.status ?? null,
      stderr: advanced?.stderr ?? advanced?.error ?? null
    }
  );
}

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

function fixedRawObjectDelta(runGit, repo, parent, commit) {
  const result = runGit({
    repo,
    args: [
      "--no-replace-objects",
      "-c", "core.quotePath=true",
      "-c", "color.ui=false",
      "diff-tree", "--raw", "-r", "--no-renames", "--no-abbrev",
      "--ignore-submodules=none", "--no-ext-diff", "--no-textconv", "--no-color",
      parent, commit
    ]
  });
  if (!result || result.ok !== true || typeof result.stdout !== "string") return null;

  if (result.stdout === "") return Object.freeze([]);
  if (!result.stdout.endsWith("\n")) return null;

  const records = result.stdout.slice(0, -1).split("\n");
  if (records.length === 1 && records[0] === "") return Object.freeze([]);
  const normalized = records.map((record) => {
    const match = record.match(/^:([0-7]{6}) ([0-7]{6}) ((?:[0-9a-f]{40}|[0-9a-f]{64})) ((?:[0-9a-f]{40}|[0-9a-f]{64})) ([ADMT])\t(.+)$/u);
    return match === null ? null : `${match[1]} ${match[2]} ${match[3]} ${match[4]} ${match[5]} ${match[6]}`;
  });
  if (normalized.some((record) => record === null) || new Set(normalized).size !== normalized.length) return null;
  normalized.sort();
  return Object.freeze(normalized);
}

const OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

function parseLiteralCommitObject(raw, oid) {
  if (typeof raw !== "string" || !OID_RE.test(oid) || raw.includes("\u0000") || raw.includes("\r") || raw.includes("\uFFFD")) return null;
  const separator = raw.indexOf("\n\n");
  if (separator < 0) return null;
  const headers = raw.slice(0, separator).split("\n");
  if (headers.length === 0 || headers.some((line) => line.length === 0)) return null;
  const parsed = [];
  let continuedKey = null;
  for (const line of headers) {
    if (line.startsWith(" ")) {
      if (continuedKey === null || continuedKey === "tree" || continuedKey === "parent" || /[\x00-\x1f\x7f]/u.test(line.slice(1))) return null;
      continue;
    }
    const space = line.indexOf(" ");
    if (space <= 0 || space === line.length - 1) return null;
    const key = line.slice(0, space);
    const value = line.slice(space + 1);
    if (!/^[\x21-\x7e]+$/u.test(key) || value.startsWith(" ") || /[\x00-\x1f\x7f]/u.test(value)) return null;
    parsed.push({ key, value });
    continuedKey = key;
  }
  const treeHeaders = parsed.filter(({ key }) => key === "tree");
  const parentHeaders = parsed.filter(({ key }) => key === "parent");
  if (treeHeaders.length !== 1 || !OID_RE.test(treeHeaders[0].value) || treeHeaders[0].value.length !== oid.length ||
      parentHeaders.some(({ value }) => !OID_RE.test(value) || value.length !== oid.length)) return null;
  return Object.freeze({
    tree: treeHeaders[0].value,
    parents: Object.freeze(parentHeaders.map(({ value }) => value)),
    message: raw.slice(separator + 2)
  });
}

function readLiteralCommitObject(runGit, repo, oid) {
  const result = runGit({ repo, args: ["--no-replace-objects", "cat-file", "commit", oid] });
  if (!result || result.ok !== true || typeof result.stdout !== "string") return null;
  return parseLiteralCommitObject(result.stdout, oid);
}

function exactCurrentMarkerMatch(runGit, repo, markerCommit, deliveryCommit) {
  const marker = readLiteralCommitObject(runGit, repo, markerCommit);
  const delivery = readLiteralCommitObject(runGit, repo, deliveryCommit);
  if (marker === null || delivery === null || marker.parents.length !== 1 || delivery.parents.length !== 1) {
    fail(
      SLICE_INTEGRATION_DIAGNOSTIC_CODES.ZERO_DELTA_EVIDENCE_INDETERMINATE,
      "same-slice marker or retained delivery commit object could not be authenticated",
      { marker_commit: markerCommit, delivery_commit: deliveryCommit }
    );
  }
  if (marker.message !== delivery.message) return false;
  if (marker.tree !== delivery.tree) return false;
  const markerDelta = fixedRawObjectDelta(runGit, repo, marker.parents[0], markerCommit);
  const deliveryDelta = fixedRawObjectDelta(runGit, repo, delivery.parents[0], deliveryCommit);
  if (markerDelta === null || deliveryDelta === null) {
    fail(
      SLICE_INTEGRATION_DIAGNOSTIC_CODES.ZERO_DELTA_EVIDENCE_INDETERMINATE,
      "same-slice marker raw object delta could not be authenticated",
      { marker_commit: markerCommit, delivery_commit: deliveryCommit }
    );
  }
  return markerDelta.length === deliveryDelta.length &&
    markerDelta.every((record, index) => record === deliveryDelta[index]);
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

export function advanceSliceRefCas({
  runGit,
  runGitRefTransaction,
  mainRepo,
  sliceRef,
  wkRef,
  wkId,
  sliceId,
  baseSha,
  commit,
  expectedWkTip = null
}) {
  let lastExpected = null;
  for (let attempt = 1; attempt <= MAX_WK_REF_CAS_ATTEMPTS; attempt += 1) {
    const wkOld = revParse(runGit, mainRepo, wkRef);
    if (expectedWkTip !== null && wkOld !== expectedWkTip) {
      fail(
        SLICE_INTEGRATION_DIAGNOSTIC_CODES.WK_ADVANCE_CONFLICT,
        "WK ref moved before same-slice marker authentication",
        { wk_ref: wkRef, expected_wk_sha: expectedWkTip, observed_wk_sha: wkOld }
      );
    }
    const subject = `${wkId}#${sliceId}`;

    const markerEvidence = resolveSliceMarkerEvidence(runGit, mainRepo, wkOld, wkId, sliceId);
    if (markerEvidence.state === SLICE_MARKER_EVIDENCE_STATES.INDETERMINATE) {
      fail(
        SLICE_INTEGRATION_DIAGNOSTIC_CODES.ZERO_DELTA_EVIDENCE_INDETERMINATE,
        "same-slice marker evidence could not be authenticated",
        { subject, reason: markerEvidence.reason }
      );
    }
    const markerCommits = markerEvidence.state === SLICE_MARKER_EVIDENCE_STATES.FOUND
      ? markerEvidence.candidates
      : [];
    let matchingMarkerCommits;
    try {
      matchingMarkerCommits = markerCommits.filter((markerCommit) =>
        exactCurrentMarkerMatch(runGit, mainRepo, markerCommit, commit)
      );
    } catch (error) {
      fail(
        SLICE_INTEGRATION_DIAGNOSTIC_CODES.ZERO_DELTA_EVIDENCE_INDETERMINATE,
        "same-slice marker delivery identity could not be authenticated",
        { subject },
        error
      );
    }
    if (matchingMarkerCommits.length > 1) {
      fail(
        SLICE_INTEGRATION_DIAGNOSTIC_CODES.ZERO_DELTA_EVIDENCE_AMBIGUOUS,
        "multiple same-slice markers match the retained delivery",
        { subject, match_count: matchingMarkerCommits.length }
      );
    }
    if (matchingMarkerCommits.length === 1) {
      const markerCommit = matchingMarkerCommits[0];

      return {
        integratedCommit: markerCommit,
        deliveryCommit: commit,
        previousWkSha: wkOld,
        rebased: false,
        already_present: true,
        empty_delivery: false
      };
    }
    if (matchingMarkerCommits.length === 0 && sliceHasNoRemainingDelta({ runGit, mainRepo, baseSha, commit, wkTip: wkOld })) {
      const existing = resolveZeroDeltaIntegrationEvidence({
        runGit,
        mainRepo,
        wkTip: wkOld,
        subject,
        deliverySha: commit,
        baseSha
      });
      if (existing.count > 1) {
        fail(
          SLICE_INTEGRATION_DIAGNOSTIC_CODES.ZERO_DELTA_EVIDENCE_AMBIGUOUS,
          "multiple exact zero-delta integration evidence commits are reachable",
          { subject, match_count: existing.count }
        );
      }
      if (existing.count === 1) {
        return {
          integratedCommit: existing.match.evidence_sha,
          deliveryCommit: commit,
          previousWkSha: existing.match.wk_parent_sha,
          rebased: false,
          already_present: true,
          empty_delivery: true
        };
      }
      const published = advanceZeroDeltaEvidenceRefTransaction({
        runGit,
        runGitRefTransaction,
        mainRepo,
        sliceRef,
        wkRef,
        subject,
        deliverySha: commit,
        baseSha,
        wkParentSha: wkOld
      });
      return {
        integratedCommit: published.evidence_sha,
        deliveryCommit: commit,
        previousWkSha: wkOld,
        rebased: false,
        already_present: published.concurrent === true,
        empty_delivery: true
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
  writeRecordCas = null,
  transitionToReview,
  markSliceComplete,
  validateRecord = null
}) {
  let lastCurrent = null;
  for (let attempt = 1; attempt <= MAX_RECORD_CAS_ATTEMPTS; attempt += 1) {
    const record = loadRecord(mainRepo, wkId);
    const expectedSourceDigest = computeWorkRecordSourceDigest(record);

    const wkTip = revParse(runGit, mainRepo, wkRef);

    const fixedFork = resolveFixedWkForkCommit({ runGit, mainRepo, initiative, wkId });
    const finalSlice = isLastIncompleteImplementationSlice(
      record, sliceId, runGit, mainRepo, wkTip, wkId, { fixedForkSha: fixedFork.sha }
    );
    if (typeof validateRecord === "function") {
      validateRecord({ record, wkTip, finalSlice });
    }
    let reviewTarget = null;
    let transition;
    if (finalSlice) {
      reviewTarget = buildCompleteWkReviewTarget({ runGit, mainRepo, initiative, wkId, wkRef, wkTip });
    }
    const currentSlice = record.slices.find((entry) => entry?.id === sliceId);
    const parentTerminal = record.status === "review" || record.status === "done";
    const alreadyConsistent = currentSlice?.status === "done" &&
      ((finalSlice && parentTerminal) || (!finalSlice && !parentTerminal));
    if (alreadyConsistent) {
      return {
        reviewTarget: record.status === "review" && finalSlice ? reviewTarget : null,
        transition: Object.freeze({
          valid: true,
          written: false,
          no_op: true,
          status: record.status === "review" && finalSlice ? "review" : "done"
        }),
        finalSlice,
        wkTip
      };
    }

    const recheckedFork = resolveFixedWkForkCommit({ runGit, mainRepo, initiative, wkId });
    if (recheckedFork.sha !== fixedFork.sha) {
      fail(
        SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH,
        "the launcher-owned fixed WK fork moved during the final-slice completeness proof",
        {
          fork_ref: fixedFork.ref,
          expected_fork_sha: fixedFork.sha,
          observed_fork_sha: recheckedFork.sha
        }
      );
    }
    if (typeof writeRecordCas === "function") {
      const updatedRecord = JSON.parse(JSON.stringify(record));
      const updatedSlice = updatedRecord.slices.find((entry) => entry?.id === sliceId);
      if (!updatedSlice) {
        fail(
          SLICE_INTEGRATION_DIAGNOSTIC_CODES.RECORD_WRITE_FAILED,
          "canonical integration slice disappeared before compound record CAS",
          { wk_id: wkId, slice_id: sliceId }
        );
      }
      updatedSlice.status = "done";
      if (finalSlice) updatedRecord.status = "review";
      updatedRecord.updated = new Date().toISOString().slice(0, 10);
      transition = await writeRecordCas({
        record: updatedRecord,
        unitAddress: `${wkId}#${sliceId}`,
        status: finalSlice ? "review" : "done",
        sliceStatus: "done",
        parentStatus: finalSlice ? "review" : record.status,
        reviewTarget,
        expectedSourceDigest
      });
    } else if (finalSlice) {
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
    if (transition && transition.valid === true &&
        (transition.written === true || transition.no_op === true || transition.noOp === true)) {
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
