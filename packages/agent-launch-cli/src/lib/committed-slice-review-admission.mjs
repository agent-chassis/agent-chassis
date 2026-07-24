

import { createHash } from "node:crypto";
import { existsSync, lstatSync } from "node:fs";
import path from "node:path";

import { defaultRunGit } from "./worktree-substrate.mjs";

const SUBJECT_RE = /^(WK-\d{4})#(SLICE-\d{3})$/u;
const OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const SOURCE_DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const COMMIT_SUBJECT_PREFIX = "agent-launch worker delivery: ";

export const COMMITTED_SLICE_REVIEW_ADMISSION_SCHEMA_VERSION =
  "workspace-agent-committed-slice-review-admission.v1";
export const COMMITTED_SLICE_REVIEW_IDENTITY_SCHEMA_VERSION =
  "canonical-committed-slice-review-binding.v1";
export const COMMITTED_SLICE_REVIEW_ADMISSION_CODES = Object.freeze({
  REFUSED: "agent_launch.committed_slice_review_admission.refused.v1"
});

export class CommittedSliceReviewAdmissionError extends Error {
  constructor(message, { code = COMMITTED_SLICE_REVIEW_ADMISSION_CODES.REFUSED, detail = null } = {}) {
    super(`agent-launch committed-slice review admission: ${message}`);
    this.name = "CommittedSliceReviewAdmissionError";
    this.code = code;
    if (detail !== null) this.detail = detail;
  }
}

function fail(reason, detail = null, code = COMMITTED_SLICE_REVIEW_ADMISSION_CODES.REFUSED) {
  throw new CommittedSliceReviewAdmissionError(reason, {
    code,
    detail: { reason, ...(detail ?? {}) }
  });
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

function parseReviewContract(reviewUnit) {
  let slice;
  try {
    slice = JSON.parse(reviewUnit.review_unit_contract);
  } catch (error) {
    fail("canonical_review_contract_malformed", { message: error?.message ?? String(error) });
  }
  if (slice?.id !== reviewUnit.slice_id || slice?.work_kind !== "implementation" ||
      !Array.isArray(slice.write_scope) ||
      slice.write_scope.length === 0) {
    fail("canonical_review_contract_inconsistent");
  }
  const scope = [...new Set(slice.write_scope)].sort();
  if (scope.length !== slice.write_scope.length || scope.some((entry) =>
    typeof entry !== "string" || entry.length === 0 || entry !== entry.trim() ||
    path.posix.isAbsolute(entry) || path.posix.normalize(entry) !== entry ||
    entry === "." || entry.split("/").some((part) => !part || part === "." || part === "..")
  )) {
    fail("canonical_write_scope_malformed");
  }
  return { slice, writeScope: Object.freeze(scope) };
}

function pathInWriteScope(changedPath, writeScope) {
  return writeScope.some((entry) => changedPath === entry || changedPath.startsWith(`${entry}/`));
}

function parseNulList(raw) {
  return String(raw ?? "").split("\0").filter(Boolean);
}

function resolveRemainingDelta({ runGit, mainRepo, diffBaseSha, wkSha, reviewedSha }) {
  const merged = runGit({
    repo: mainRepo,
    args: [
      "merge-tree", "--write-tree", "--no-messages",
      "--merge-base", diffBaseSha,
      wkSha,
      reviewedSha
    ]
  });
  if (merged?.ok !== true) {
    fail("committed_slice_delta_not_applicable", {
      status: merged?.status ?? null,
      stderr: merged?.stderr ?? merged?.error ?? null
    });
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
  const { slice, writeScope } = parseReviewContract(reviewUnit);
  const initiative = reviewUnit.initiative;
  const sliceRef = `refs/heads/slice/${initiative}/${recordId}/${sliceId}`;
  const wkRef = `refs/heads/wk/${initiative}/${recordId}`;
  const reviewedSha = oid(git(runGit, mainRepo, ["rev-parse", "--verify", `${sliceRef}^{commit}`], "slice_target_missing"), "reviewed_sha");
  const wkSha = oid(git(runGit, mainRepo, ["rev-parse", "--verify", `${wkRef}^{commit}`], "wk_target_missing"), "wk_sha");
  const diffBaseSha = oid(git(runGit, mainRepo, ["merge-base", wkSha, reviewedSha], "slice_diff_base_unresolvable"), "diff_base_sha");
  const remaining = resolveRemainingDelta({
    runGit, mainRepo, diffBaseSha, wkSha, reviewedSha
  });
  const emptyDelivery = remaining.changedPaths.length === 0;
  const changedRaw = emptyDelivery
    ? { ok: true, stdout: "" }
    : runGit({
        repo: mainRepo,
        args: ["diff", "--name-only", "-z", diffBaseSha, reviewedSha, "--"]
      });
  if (changedRaw?.ok !== true) fail("committed_slice_diff_unresolvable");
  const changedPaths = parseNulList(changedRaw.stdout);
  const commits = emptyDelivery
    ? Object.freeze([])
    : assertServerMintedCommitChain({
        runGit, mainRepo, subject, baseSha: diffBaseSha, reviewedSha
      });
  if (changedPaths.some((entry) => !pathInWriteScope(entry, writeScope))) {
    fail("trusted_commit_scope_mismatch", { changed_paths: changedPaths });
  }

  const worktreePath = emptyDelivery && !requireWorktree
    ? null
    : resolveExactWorktree({
        runGit, mainRepo, worktreeRoot, sliceRef, reviewedSha, changedPaths, subject
      });

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
