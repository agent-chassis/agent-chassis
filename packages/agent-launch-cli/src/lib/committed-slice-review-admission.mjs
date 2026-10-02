

import { createHash } from "node:crypto";
import { existsSync, lstatSync } from "node:fs";
import path from "node:path";

import {
  CONTROLLED_CONTRACT_PRIVATE_PATH_ROOT
} from "@agent-chassis/wiki-core/src/lib/controlled-contract-private-path-policy.mjs";

import { createWorkerScopeTreeReader } from "./backend-worker-scope-tree.mjs";
import { deriveCanonicalUnitScope } from "./canonical-unit-scope.mjs";
import { resolveCommitWriteScopeMatcher } from "./exact-slice-commit-binding.mjs";
import { defaultRunGit } from "./worktree-substrate.mjs";
import {
  classifyExplicitBaseMergeTreeResult,
  explicitBaseMergeTreeArgs,
  explicitBaseMergeTreeCapabilityCorrection,
  registerExplicitBaseMergeTreeCapabilityCorrection
} from "./explicit-base-merge-tree.mjs";

const SUBJECT_RE = /^(WK-\d{4})#(SLICE-\d{3})$/u;
const OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const SOURCE_DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const COMMIT_SUBJECT_PREFIX = "agent-launch worker delivery: ";

export const COMMITTED_SLICE_REVIEW_ADMISSION_SCHEMA_VERSION =
  "workspace-agent-committed-slice-review-admission.v1";
export const COMMITTED_SLICE_REVIEW_IDENTITY_SCHEMA_VERSION =
  "canonical-committed-slice-review-binding.v1";
export const COMMITTED_SLICE_REVIEW_ADMISSION_CODES = Object.freeze({
  REFUSED: "agent_launch.committed_slice_review_admission.refused.v1",
  GIT_CAPABILITY_UNAVAILABLE:
    "agent_launch.committed_slice_review_admission.git_capability_unavailable.v1",
  MERGE_TREE_EXECUTION_FAILED:
    "agent_launch.committed_slice_review_admission.merge_tree_execution_failed.v1"
});

export class CommittedSliceReviewAdmissionError extends Error {
  constructor(message, {
    code = COMMITTED_SLICE_REVIEW_ADMISSION_CODES.REFUSED,
    detail = null,
    cause = undefined
  } = {}) {

    super(`agent-launch committed-slice review admission: ${message}`,
      cause === undefined ? undefined : { cause });
    this.name = "CommittedSliceReviewAdmissionError";
    this.code = code;
    if (detail !== null) this.detail = detail;
  }
}

function fail(reason, detail = null, code = COMMITTED_SLICE_REVIEW_ADMISSION_CODES.REFUSED,
  cause = undefined) {
  throw new CommittedSliceReviewAdmissionError(reason, {
    code,
    detail: { reason, ...(detail ?? {}) },
    cause
  });
}

export const COMMITTED_SLICE_SCOPE_CORRECTION_CONDITION = "committed_slice_scope_inputs_changed";
const SCOPE_REFUSAL_CORRECTIONS = new WeakMap();

export function committedSliceScopeRefusalCorrection(value) {
  return SCOPE_REFUSAL_CORRECTIONS.get(value) ??
    explicitBaseMergeTreeCapabilityCorrection(value) ?? null;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function digest(value) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonicalize(value)), "utf8")
    .digest("hex")}`;
}

function git(runGit, repo, args, reason) {
  const result = runGit({ repo, args });
  if (result?.ok !== true) {
    fail(reason, {
      args,
      status: result?.status ?? null,
      stderr: result?.stderr ?? result?.error ?? null
    });
  }
  return String(result.stdout ?? "").trim();
}

function oid(value, label) {
  if (!OID_RE.test(value) || /^0+$/u.test(value)) fail(`${label}_malformed`, { value });
  return value;
}

const COMMITTED_SLICE_SCOPE_EXCLUSIONS = Object.freeze([CONTROLLED_CONTRACT_PRIVATE_PATH_ROOT]);

function parseReviewContract(reviewUnit, scopeSource) {
  let slice;
  try {
    slice = JSON.parse(reviewUnit.review_unit_contract);
  } catch (error) {
    fail("canonical_review_contract_malformed", { message: error?.message ?? String(error) },
      COMMITTED_SLICE_REVIEW_ADMISSION_CODES.REFUSED, error);
  }
  if (slice?.id !== reviewUnit.slice_id || slice?.work_kind !== "implementation" ||
      !Array.isArray(slice.write_scope) ||
      slice.write_scope.length === 0) {
    fail("canonical_review_contract_inconsistent", {
      expected_slice_id: reviewUnit.slice_id ?? null,
      slice_id: slice?.id ?? null,
      work_kind: slice?.work_kind ?? null,
      write_scope: slice?.write_scope ?? null
    });
  }
  const writeScope = deriveCanonicalUnitScope(slice.write_scope, "write_scope", scopeSource, {
    forbidGitMetadata: true,

    invalid: (_message, facts = null) => fail("canonical_write_scope_malformed", {
      write_scope: slice.write_scope,
      path: facts?.path ?? null,
      kind: facts?.kind ?? null,
      selector_kind: facts?.selector_kind ?? null
    })
  });
  return { slice, writeScope };
}

function resolveScopeMembership({ runGit, mainRepo, writeScope, diffBaseSha }) {
  let reader;
  try {
    reader = createWorkerScopeTreeReader({ runGit, mainRepo, baseSha: diffBaseSha });
  } catch (error) {
    fail("committed_slice_scope_base_unresolvable", {
      diff_base_sha: diffBaseSha,
      message: error?.message ?? String(error)
    }, COMMITTED_SLICE_REVIEW_ADMISSION_CODES.REFUSED, error);
  }
  try {
    return Object.freeze({
      baseTreeSha: reader.root_tree,
      matcher: resolveCommitWriteScopeMatcher(reader, writeScope, COMMITTED_SLICE_SCOPE_EXCLUSIONS)
    });
  } catch (error) {
    fail("committed_slice_scope_membership_unresolvable", {
      diff_base_sha: diffBaseSha,
      message: error?.message ?? String(error)
    }, COMMITTED_SLICE_REVIEW_ADMISSION_CODES.REFUSED, error);
  }
}

function parseNulList(raw) {
  return String(raw ?? "").split("\0").filter(Boolean);
}

function resolveRemainingDelta({ runGit, mainRepo, diffBaseSha, wkSha, reviewedSha }) {
  const args = explicitBaseMergeTreeArgs({
    baseSha: diffBaseSha,
    currentSha: wkSha,
    incomingSha: reviewedSha
  });
  const merged = runGit({
    repo: mainRepo,
    args
  });
  const interpreted = classifyExplicitBaseMergeTreeResult({
    operation: "resolve_committed_slice_remaining_delta",
    repo: mainRepo,
    args,
    baseSha: diffBaseSha,
    currentSha: wkSha,
    incomingSha: reviewedSha,
    result: merged
  });
  if (interpreted.kind !== "success") {
    const reason = interpreted.kind === "content_conflict"
      ? "committed_slice_delta_not_applicable"
      : interpreted.kind === "required_capability_unavailable"
        ? "required_git_capability_unavailable"
        : "explicit_base_merge_tree_execution_failed";
    const code = interpreted.kind === "required_capability_unavailable"
      ? COMMITTED_SLICE_REVIEW_ADMISSION_CODES.GIT_CAPABILITY_UNAVAILABLE
      : interpreted.kind === "execution_failure"
        ? COMMITTED_SLICE_REVIEW_ADMISSION_CODES.MERGE_TREE_EXECUTION_FAILED
        : COMMITTED_SLICE_REVIEW_ADMISSION_CODES.REFUSED;
    const refusal = new CommittedSliceReviewAdmissionError(reason, {
      code,
      detail: { reason, merge_tree: interpreted.diagnostic }
    });
    if (interpreted.kind === "required_capability_unavailable") {
      registerExplicitBaseMergeTreeCapabilityCorrection(refusal, {
        repo: mainRepo,
        diagnostic: interpreted.diagnostic
      });
    }
    throw refusal;
  }
  const appliedTree = oid(
    String(merged.stdout ?? "").split(/\r?\n/u)[0].trim(),
    "applied_tree"
  );
  const wkTree = oid(
    git(runGit, mainRepo, ["rev-parse", `${wkSha}^{tree}`], "wk_tree_unresolvable"),
    "wk_tree"
  );
  const remainingRaw = runGit({
    repo: mainRepo,
    args: ["diff", "--name-only", "-z", wkTree, appliedTree, "--"]
  });
  if (remainingRaw?.ok !== true) fail("committed_slice_remaining_delta_unresolvable");
  return Object.freeze({
    appliedTree,
    wkTree,
    changedPaths: Object.freeze(parseNulList(remainingRaw.stdout))
  });
}

function parseWorktrees(raw) {
  const entries = [];
  let current = {};
  for (const token of String(raw ?? "").split("\0")) {
    if (token === "") {
      if (Object.keys(current).length > 0) entries.push(current);
      current = {};
      continue;
    }
    const separator = token.indexOf(" ");
    const key = separator === -1 ? token : token.slice(0, separator);
    const value = separator === -1 ? true : token.slice(separator + 1);
    if (Object.prototype.hasOwnProperty.call(current, key)) fail("worktree_registration_malformed");
    current[key] = value;
  }
  if (Object.keys(current).length > 0) entries.push(current);
  return entries;
}

function assertServerMintedCommitChain({ runGit, mainRepo, subject, baseSha, reviewedSha }) {
  const lines = git(
    runGit,
    mainRepo,
    ["rev-list", "--reverse", "--parents", `${baseSha}..${reviewedSha}`],
    "committed_range_unresolvable"
  ).split("\n").filter(Boolean);
  if (lines.length === 0) fail("committed_range_empty");
  let expectedParent = baseSha;
  for (const line of lines) {
    const parts = line.trim().split(/\s+/u);
    if (parts.length !== 2 || parts[1] !== expectedParent) {
      fail("committed_range_not_linear", { commit: parts[0] ?? null });
    }
    const commit = oid(parts[0], "committed_range_commit");
    const message = git(runGit, mainRepo, ["show", "-s", "--format=%B", commit], "commit_message_unreadable");
    const expectedMessage = `${COMMIT_SUBJECT_PREFIX}${subject} (base ${expectedParent.slice(0, 12)})\n\nWk-Slice: ${subject}`;
    if (message !== expectedMessage) {
      fail("trusted_commit_binding_mismatch", { commit });
    }
    expectedParent = commit;
  }
  if (expectedParent !== reviewedSha) fail("committed_range_tip_mismatch");
  return Object.freeze(lines.map((line) => line.split(/\s+/u)[0]));
}

function resolveExactWorktree({
  runGit,
  mainRepo,
  worktreeRoot,
  sliceRef,
  reviewedSha,
  changedPaths,
  subject
}) {
  const registrations = parseWorktrees(
    git(runGit, mainRepo, ["worktree", "list", "--porcelain", "-z"], "worktree_registry_unreadable")
  );
  const matches = registrations.filter((entry) => entry.branch === sliceRef);
  if (matches.length !== 1) fail("exact_slice_worktree_unresolvable", { match_count: matches.length });
  const registration = matches[0];
  const worktreePath = path.resolve(String(registration.worktree ?? ""));
  const expectedName = `slice-${sliceRef.slice("refs/heads/slice/".length).replaceAll("/", "-")}`;
  const resolvedRoot = path.resolve(worktreeRoot);
  const relative = path.relative(resolvedRoot, worktreePath);
  if (!path.isAbsolute(worktreeRoot) || relative.startsWith("..") || path.isAbsolute(relative) ||
      path.basename(worktreePath) !== expectedName || registration.HEAD !== reviewedSha ||
      registration.bare === true || registration.detached === true || registration.prunable === true) {
    fail("exact_slice_worktree_binding_mismatch", { subject });
  }
  const head = oid(git(runGit, worktreePath, ["rev-parse", "--verify", "HEAD^{commit}"], "worktree_head_unresolvable"), "worktree_head");
  const branch = git(runGit, worktreePath, ["symbolic-ref", "-q", "HEAD"], "worktree_branch_unresolvable");
  if (head !== reviewedSha || branch !== sliceRef) fail("exact_slice_worktree_target_moved");
  for (const key of ["core.sparseCheckout", "core.sparseCheckoutCone", "index.sparse"]) {
    const result = runGit({ repo: worktreePath, args: ["config", "--bool", "--get", key] });
    if (!(result?.ok === true || result?.status === 1) ||
        (result?.ok === true && String(result.stdout ?? "").trim() === "true")) {
      fail("exact_slice_worktree_not_full", { key });
    }
  }

  for (const entry of changedPaths) {
    const treeEntry = runGit({
      repo: worktreePath,
      args: ["ls-tree", "-z", reviewedSha, "--", entry]
    });
    const rawTreeEntry = treeEntry?.ok === true ? String(treeEntry.stdout ?? "") : "";
    if (rawTreeEntry === "") {
      if (existsSync(path.join(worktreePath, entry))) {
        fail("exact_slice_worktree_not_frozen", {
          probe: "reviewed target deletion",
          path: entry
        });
      }
      continue;
    }
    const match = /^([0-7]{6}) blob ([0-9a-f]{40,64})\t/u.exec(rawTreeEntry);
    const worktreeBlob = runGit({
      repo: worktreePath,
      args: ["hash-object", "--no-filters", "--", entry]
    });
    if (!match || worktreeBlob?.ok !== true || String(worktreeBlob.stdout ?? "").trim() !== match[2]) {
      fail("exact_slice_worktree_not_frozen", {
        probe: "reviewed target content",
        path: entry
      });
    }
    const stat = lstatSync(path.join(worktreePath, entry));
    const mode = match[1];
    const modeMatches = mode === "120000"
      ? stat.isSymbolicLink()
      : stat.isFile() && ((stat.mode & 0o111) !== 0) === (mode === "100755");
    if (!modeMatches) {
      fail("exact_slice_worktree_not_frozen", {
        probe: "reviewed target mode",
        path: entry
      });
    }
  }
  return worktreePath;
}

function deriveScopeDecisionInputs({ runGit, mainRepo, subject, reviewUnit, recordId, sliceId }) {
  const { slice, writeScope } = parseReviewContract(
    reviewUnit, `wiki/work-records/${recordId}.json#${sliceId}`
  );
  const initiative = reviewUnit.initiative;
  const sliceRef = `refs/heads/slice/${initiative}/${recordId}/${sliceId}`;
  const wkRef = `refs/heads/wk/${initiative}/${recordId}`;
  const reviewedSha = oid(git(runGit, mainRepo, ["rev-parse", "--verify", `${sliceRef}^{commit}`], "slice_target_missing"), "reviewed_sha");
  const wkSha = oid(git(runGit, mainRepo, ["rev-parse", "--verify", `${wkRef}^{commit}`], "wk_target_missing"), "wk_sha");
  const diffBaseSha = oid(git(runGit, mainRepo, ["merge-base", wkSha, reviewedSha], "slice_diff_base_unresolvable"), "diff_base_sha");
  const scope = resolveScopeMembership({ runGit, mainRepo, writeScope, diffBaseSha });
  return {
    slice, writeScope, initiative, sliceRef, wkRef, reviewedSha, wkSha, diffBaseSha,
    scopeMatcher: scope.matcher,
    decision_inputs: Object.freeze({
      subject,
      write_scope: writeScope,
      diff_base_sha: diffBaseSha,
      base_tree_sha: scope.baseTreeSha,
      reviewed_sha: reviewedSha
    })
  };
}

export function resolveCommittedSliceScopeDecisionInputs({
  mainRepo,
  subject,
  reviewUnit,
  runGit = defaultRunGit
} = {}) {
  const match = typeof subject === "string" ? SUBJECT_RE.exec(subject) : null;
  if (!match || typeof mainRepo !== "string" || !path.isAbsolute(mainRepo) ||
      reviewUnit?.subject !== subject || !/^IN-\d{4}$/u.test(reviewUnit?.initiative ?? "")) {
    fail("canonical_review_state_unavailable");
  }
  const [, recordId, sliceId] = match;
  return deriveScopeDecisionInputs({ runGit, mainRepo, subject, reviewUnit, recordId, sliceId });
}

export function resolveCommittedSliceScopeOffenders({
  mainRepo,
  writeScope,
  diffBaseSha,
  reviewedSha,
  runGit = defaultRunGit
} = {}) {
  if (typeof mainRepo !== "string" || !path.isAbsolute(mainRepo) || !Array.isArray(writeScope)) {
    fail("canonical_review_state_unavailable");
  }
  const scope = resolveScopeMembership({
    runGit, mainRepo, writeScope, diffBaseSha: oid(diffBaseSha, "diff_base_sha")
  });
  const changedRaw = runGit({
    repo: mainRepo,
    args: ["diff", "--name-only", "-z", diffBaseSha, oid(reviewedSha, "reviewed_sha"), "--"]
  });
  if (changedRaw?.ok !== true) fail("committed_slice_diff_unresolvable");
  return Object.freeze([...new Set(parseNulList(changedRaw.stdout).filter((entry) =>
    scope.matcher.matches(entry) !== true))].sort());
}

export function resolveCommittedSliceReviewAdmission({
  mainRepo,
  worktreeRoot,
  subject,
  reviewUnit,
  requireWorktree = true,
  runGit = defaultRunGit
} = {}) {
  const match = typeof subject === "string" ? SUBJECT_RE.exec(subject) : null;
  if (!match || typeof mainRepo !== "string" || !path.isAbsolute(mainRepo) ||
      typeof worktreeRoot !== "string" || !path.isAbsolute(worktreeRoot) ||
      reviewUnit?.subject !== subject || (requireWorktree && reviewUnit?.parent_status === "review") ||
      !/^IN-\d{4}$/u.test(reviewUnit?.initiative ?? "") ||
      typeof requireWorktree !== "boolean") {
    fail("canonical_review_state_unavailable");
  }
  const [, recordId, sliceId] = match;
  const {
    slice, writeScope, initiative, sliceRef, wkRef, reviewedSha, wkSha, diffBaseSha,
    scopeMatcher, decision_inputs: decisionInputs
  } = deriveScopeDecisionInputs({ runGit, mainRepo, subject, reviewUnit, recordId, sliceId });
  const remaining = resolveRemainingDelta({
    runGit, mainRepo, diffBaseSha, wkSha, reviewedSha
  });
  const emptyDelivery = remaining.changedPaths.length === 0;
  const changedRaw = runGit({
    repo: mainRepo,
    args: ["diff", "--name-only", "-z", diffBaseSha, reviewedSha, "--"]
  });
  if (changedRaw?.ok !== true) fail("committed_slice_diff_unresolvable");
  const changedPaths = parseNulList(changedRaw.stdout);

  const commits = assertServerMintedCommitChain({
    runGit, mainRepo, subject, baseSha: diffBaseSha, reviewedSha
  });

  const offendingPaths = Object.freeze([...new Set(changedPaths.filter((entry) =>
    scopeMatcher.matches(entry) !== true))].sort());
  if (offendingPaths.length > 0) {
    const reason = "trusted_commit_scope_mismatch";
    const refusal = new CommittedSliceReviewAdmissionError(reason, {
      code: COMMITTED_SLICE_REVIEW_ADMISSION_CODES.REFUSED,
      detail: {
        reason,
        subject,
        offending_paths: offendingPaths,
        write_scope: writeScope,
        diff_base_sha: diffBaseSha,
        reviewed_sha: reviewedSha,
        changed_path_count: new Set(changedPaths).size,
        offending_path_count: offendingPaths.length
      }
    });
    SCOPE_REFUSAL_CORRECTIONS.set(refusal, Object.freeze({
      condition: COMMITTED_SLICE_SCOPE_CORRECTION_CONDITION,
      reason,
      decision_inputs: decisionInputs
    }));
    throw refusal;
  }

  const worktreePath = requireWorktree
    ? resolveExactWorktree({
        runGit, mainRepo, worktreeRoot, sliceRef, reviewedSha, changedPaths, subject
      })
    : null;

  const finalTip = oid(git(runGit, mainRepo, ["rev-parse", "--verify", `${sliceRef}^{commit}`], "slice_target_recheck_failed"), "final_reviewed_sha");
  if (finalTip !== reviewedSha) fail("committed_slice_target_moved");

  const identityBody = Object.freeze({
    schema_version: COMMITTED_SLICE_REVIEW_IDENTITY_SCHEMA_VERSION,
    unit_address: subject,
    initiative,
    record_id: recordId,
    slice_id: sliceId,
    slice_ref: sliceRef,
    wk_ref: wkRef,
    wk_sha: wkSha,
    reviewed_sha: reviewedSha,
    diff_base_sha: diffBaseSha,
    worktree_path: worktreePath,
    changed_paths: Object.freeze([...changedPaths].sort()),
    write_scope: writeScope,
    source_digest: typeof slice.source_digest === "string" && SOURCE_DIGEST_RE.test(slice.source_digest)
      ? slice.source_digest
      : digest(reviewUnit.review_unit_contract),
    commit_chain: commits
  });
  const committedTargetDigest = digest(identityBody);
  return Object.freeze({
    schema_version: COMMITTED_SLICE_REVIEW_ADMISSION_SCHEMA_VERSION,
    review_admission_kind: "canonical_committed_slice",
    empty_delivery: emptyDelivery,
    committed_target_digest: committedTargetDigest,
    identity: Object.freeze({ ...identityBody, committed_target_digest: committedTargetDigest }),
    target: Object.freeze({
      ref: sliceRef,
      sha: reviewedSha,
      diff_base_sha: diffBaseSha,
      diff_head_sha: reviewedSha,
      diff_range: `${diffBaseSha}..${reviewedSha}`,
      slice_level_review: true
    }),
    worktree_path: worktreePath
  });
}
