

import { readFileSync } from "node:fs";
import path from "node:path";

import { computeWorkRecordSourceDigest } from "@agent-chassis/wiki-core";

import { defaultRunGit } from "./worktree-substrate.mjs";
import { buildWkSliceMarkerTrailer } from "./commit-tool-exposure-guard.mjs";

export const SLICE_INTEGRATION_SCHEMA_VERSION = "slice-integration.v1";
export const SLICE_INTEGRATION_BOUNDARY_AUTHORIZATION_SCHEMA_VERSION =
  "slice-integration-boundary-authorization.v1";
export const SLICE_INTEGRATION_POLICY_POSTURES = Object.freeze({
  FREE_SUBSTRATE: "free_substrate",
  CCE_POLICY: "cce_policy"
});

const MAX_WK_REF_CAS_ATTEMPTS = 8;
const MAX_RECORD_CAS_ATTEMPTS = 8;

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

function resolveTree(runGit, repo, rev) {
  const oid = git(runGit, repo, ["rev-parse", "--verify", `${rev}^{tree}`], `could not resolve the tree of ${rev}`).stdout.trim();
  return assertOid(oid, `${rev} tree`);
}

function sliceHasNoRemainingDelta({ runGit, mainRepo, baseSha, commit, wkTip }) {
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

const BOUNDARY_TARGET_FIELDS = Object.freeze([
  "subject", "initiative", "slice_ref", "reviewed_sha", "diff_base_sha"
]);

function assertBoundaryObjectStoreProbes(runGit, mainRepo, target) {
  const probes = [
    { name: "slice_ref_resolves_to_reviewed_sha", rev: `${target.slice_ref}^{commit}`, expect: target.reviewed_sha },
    { name: "reviewed_commit_object_present", rev: `${target.reviewed_sha}^{commit}`, expect: target.reviewed_sha },
    { name: "slice_diff_base_object_present", rev: `${target.diff_base_sha}^{commit}`, expect: target.diff_base_sha }
  ];
  for (const probe of probes) {
    const result = runGit({ repo: mainRepo, args: ["rev-parse", "--verify", probe.rev] });
    const actual = result && result.ok === true ? String(result.stdout ?? "").trim() : null;
    if (actual !== probe.expect) {
      fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH,
        "boundary authorization no longer matches the exact slice target", {
        probe: probe.name,
        expected: probe.expect,
        actual
      });
    }
  }
}

function assertSliceIntegrationBoundaryAuthorization({
  runGit,
  mainRepo,
  sliceRef,
  wkId,
  sliceId,
  initiative,
  baseSha,
  commit,
  boundaryAuthorization
}) {
  const subject = `${wkId}#${sliceId}`;
  if (boundaryAuthorization === null || boundaryAuthorization === undefined) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.BOUNDARY_AUTHORIZATION_MISSING,
      "integration requires a launcher-owned configured-policy disposition", { subject });
  }
  if (typeof boundaryAuthorization !== "object" || Array.isArray(boundaryAuthorization)) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.BOUNDARY_AUTHORIZATION_MALFORMED,
      "integration boundary authorization must be an object", { subject });
  }
  const target = boundaryAuthorization.target;
  if (boundaryAuthorization.schema_version !==
        SLICE_INTEGRATION_BOUNDARY_AUTHORIZATION_SCHEMA_VERSION ||
      boundaryAuthorization.operation !== "integrate_committed_slice" ||
      typeof target !== "object" || target === null || Array.isArray(target)) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.BOUNDARY_AUTHORIZATION_MALFORMED,
      "integration boundary authorization has an invalid schema", { subject });
  }
  const missingField = BOUNDARY_TARGET_FIELDS.find(
    (field) => typeof target[field] !== "string" || target[field].length === 0
  );
  if (missingField !== undefined) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.BOUNDARY_AUTHORIZATION_MALFORMED,
      "integration boundary authorization is missing an exact-target field", {
      subject,
      field: missingField
    });
  }
  if (target.subject !== subject || target.initiative !== initiative ||
      target.slice_ref !== sliceRef || target.reviewed_sha !== commit) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH,
      "integration boundary authorization identifies a different target", {
      expected: { subject, initiative, slice_ref: sliceRef, reviewed_sha: commit },
      actual: {
        subject: target.subject,
        initiative: target.initiative,
        slice_ref: target.slice_ref,
        reviewed_sha: target.reviewed_sha
      }
    });
  }
  const currentSliceSha = revParse(runGit, mainRepo, sliceRef);
  if (currentSliceSha !== target.reviewed_sha || target.diff_base_sha !== baseSha) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH,
      "integration boundary authorization is stale for the exact target", {
      subject,
      reviewed_sha: target.reviewed_sha,
      current_slice_sha: currentSliceSha,
      expected_diff_base_sha: baseSha,
      authorized_diff_base_sha: target.diff_base_sha
    });
  }
  if (boundaryAuthorization.policy_posture === SLICE_INTEGRATION_POLICY_POSTURES.CCE_POLICY) {
    if (boundaryAuthorization.authority !== "cce" ||
        boundaryAuthorization.policy_gate_configured !== true ||
        boundaryAuthorization.decision !== "allow" ||
        boundaryAuthorization.ratified !== true ||
        boundaryAuthorization.attestation_valid !== true ||
        boundaryAuthorization.audit_grade !== true) {
      const code = boundaryAuthorization.decision === "deny"
        ? SLICE_INTEGRATION_DIAGNOSTIC_CODES.CCE_POLICY_DENIED
        : SLICE_INTEGRATION_DIAGNOSTIC_CODES.CCE_POLICY_UNRATIFIED;
      fail(code, "configured CCE policy did not provide a ratified allow decision", { subject });
    }
  } else if (boundaryAuthorization.policy_posture ===
      SLICE_INTEGRATION_POLICY_POSTURES.FREE_SUBSTRATE) {
    if (boundaryAuthorization.authority !== "none" ||
        boundaryAuthorization.policy_gate_configured !== false ||
        boundaryAuthorization.decision !== "not_gated" ||
        boundaryAuthorization.ratified !== false ||
        boundaryAuthorization.attestation_valid !== false ||
        boundaryAuthorization.audit_grade !== false) {
      fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.BOUNDARY_AUTHORIZATION_MALFORMED,
        "free-substrate posture must report that no CCE gate or audit verdict exists", { subject });
    }
  } else {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.BOUNDARY_AUTHORIZATION_MALFORMED,
      "integration boundary authorization has an unknown policy posture", { subject });
  }
  assertBoundaryObjectStoreProbes(runGit, mainRepo, target);
  return Object.freeze({ ...boundaryAuthorization, target: Object.freeze({ ...target }) });
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
        ref, baseSha, tree, commit: current, priorTip: baseSha, idempotent: true, empty: false
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
  if (baseTree === tree) {
    return exactSliceCommitResult({
      ref, baseSha, tree, commit: current, priorTip: current, idempotent: true, empty: true
    });
  }

  const cas = runGit({ repo, args: ["update-ref", ref, commit, baseSha] });
  if (cas && cas.ok === true) {
    return exactSliceCommitResult({
      ref, baseSha, tree, commit, priorTip: baseSha, idempotent: false, empty: false
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
      ref, baseSha, tree, commit: winnerSha, priorTip: baseSha, idempotent: true, empty: false
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

function replayCommitRangeOnto({ runGit, mainRepo, baseSha, commit, onto }) {
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

function advanceSliceRefCas({ runGit, mainRepo, wkRef, wkId, sliceId, baseSha, commit }) {
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

  boundaryAuthorization = null,
  deps = {}
} = {}) {
  const runGit = deps.runGit ?? defaultRunGit;
  const coordinatorContinuation = boundaryAuthorization?.operation ===
    "integrate_committed_slice";
  if (workerTerminated !== true && !coordinatorContinuation) {
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
  const initialWkTip = revParse(runGit, mainRepo, wk.ref);
  const emptyDelivery = sliceHasNoRemainingDelta({
    runGit,
    mainRepo,
    baseSha,
    commit,
    wkTip: initialWkTip
  });

  if (!emptyDelivery) {
    if (!coordinatorContinuation) {
      assertExactWorktreeBinding(runGit, worktreePath, slice.ref, commit);
    }
  }
  const loadRecord = deps.loadCanonicalRecord ?? parseCanonicalRecord;

  const appliedBoundaryAuthorization = assertSliceIntegrationBoundaryAuthorization({
    runGit,
    mainRepo,
    sliceRef: slice.ref,
    wkId: slice.match[2],
    sliceId: slice.match[3],
    initiative: slice.match[1],
    baseSha,
    commit,
    boundaryAuthorization
  });

  const advance = advanceSliceRefCas({
    runGit,
    mainRepo,
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
    delivery_sha: advance.deliveryCommit,
    wk_ref: wk.ref,
    wk_sha: write.wkTip,
    empty_delivery: advance.empty_delivery,

    review_target: write.reviewTarget,
    transition: write.transition,
    boundary_authorization: appliedBoundaryAuthorization
  });
}

export function reconcileIntegratedSliceRecord({
  mainRepo,
  unitAddress,
  sliceRef,
  wkRef,
  baseSha = null,
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
  const loadRecord = deps.loadCanonicalRecord ?? parseCanonicalRecord;
  const record = loadRecord(mainRepo, slice.match[2]);
  const sliceEntry = Array.isArray(record?.slices)
    ? record.slices.find((entry) => entry?.id === slice.match[3])
    : null;
  const sliceComplete = sliceEntry ? (sliceEntry.status === "done" || sliceEntry.status === "cancelled") : false;
  const wkInReview = record?.status === "review";
  const wkInTerminalRecoveryPosture = wkInReview || record?.status === "done";
  if (markerSha === null) {

    if (baseSha === null) return null;
    assertOid(baseSha, "baseSha");
    const sliceTip = revParse(runGit, mainRepo, slice.ref);
    const baseInWk = runGit({ repo: mainRepo, args: ["merge-base", "--is-ancestor", baseSha, wkTip] });
    if (sliceTip !== baseSha || !baseInWk || baseInWk.ok !== true ||
        (!sliceComplete && !wkInTerminalRecoveryPosture)) {
      return null;
    }
    const reviewTarget = wkInReview
      ? buildCompleteWkReviewTarget({
          runGit,
          mainRepo,
          initiative: slice.match[1],
          wkId: slice.match[2],
          wkRef: wk.ref,
          wkTip
        })
      : null;
    return Object.freeze({
      schema_version: SLICE_INTEGRATION_SCHEMA_VERSION,
      integrated: true,
      recovered: true,
      rebased: false,
      previous_wk_sha: null,
      slice_ref: slice.ref,
      slice_sha: wkTip,
      delivery_sha: sliceTip,
      wk_ref: wk.ref,
      wk_sha: wkTip,
      empty_delivery: true,
      review_target: reviewTarget,
      transition: Object.freeze({
        valid: true,
        written: false,
        no_op: true,
        status: wkInReview ? "review" : "done",
        recovered: true
      }),
      integrated_state: wkInTerminalRecoveryPosture ? "final" : "non_final"
    });
  }
  const sliceTip = revParse(runGit, mainRepo, slice.ref);
  if (sliceTip !== markerSha) {

    const retainedMarker = resolveSliceMarkerCommit(
      runGit,
      mainRepo,
      sliceTip,
      slice.match[2],
      slice.match[3]
    );
    if (retainedMarker !== sliceTip) {
      fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH,
        "integrated slice marker does not match the retained slice delivery", {
          slice_ref: slice.ref,
          slice_tip: sliceTip,
          marker_sha: markerSha,
          retained_marker_sha: retainedMarker
        });
    }
  }
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
    delivery_sha: sliceTip,
    wk_ref: wk.ref,
    wk_sha: wkTip,
    empty_delivery: false,
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
