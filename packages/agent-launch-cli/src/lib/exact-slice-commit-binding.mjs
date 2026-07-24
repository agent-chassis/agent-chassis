

import path from "node:path";
import { isPlainObject } from "./trusted-operation-contracts.mjs";

const WORKTREE_SUBSTRATE_BINDING_SCHEMA_VERSION = "worktree-identity-binding.v1";
const WORKTREE_SUBSTRATE_BINDING_SCHEMA_VERSION_V2 = "worktree-identity-binding.v2";
const FULL_CHECKOUT_MODE = "full";
const COMMIT_BINDING_COMMIT_ID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const COMMIT_BINDING_SOURCE_DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;

const EXACT_SPARSE_SLICE_BINDING_FIELDS = Object.freeze([
  "schema_version", "launch_ref", "run_id", "retry_id", "unit_address", "initiative",
  "record_id", "slice_id", "base_ref", "base_sha", "output_branch", "worktree_path",
  "read_scope", "repo_paths", "write_scope", "write_scope_source", "selected_unit",
  "source_digest", "source_version", "cone_dirs", "index_sparse"
]);

const EXACT_FULL_SLICE_BINDING_FIELDS = Object.freeze([
  "schema_version", "launch_ref", "run_id", "retry_id", "unit_address", "initiative",
  "record_id", "slice_id", "base_ref", "base_sha", "output_branch", "worktree_path",
  "read_scope", "repo_paths", "write_scope", "write_scope_source", "selected_unit",
  "source_digest", "source_version", "checkout_mode"
]);
function commitPlainObject(value) {
  return isPlainObject(value);
}

function isNormalizedRepoPathEntry(value) {
  return typeof value === "string" && value.length > 0 && value === value.trim() &&
    !path.posix.isAbsolute(value) && !value.startsWith("-") && !value.includes("\\") &&
    // eslint-disable-next-line no-control-regex
    !/[\x00-\x1f\x7f]/u.test(value) && path.posix.normalize(value) === value && value !== "." &&
    value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function isCanonicalRepoPathArray(value, { nonEmpty = false } = {}) {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0) ||
      value.some((entry) => !isNormalizedRepoPathEntry(entry))) {
    return false;
  }

  return value.every((entry, index) => index === 0 || value[index - 1] < entry);
}

export function verifyExactSliceCommitBinding({ binding, mainRepo, assignedUnit, launchRef, runId, retryId }) {
  const UNIT_ADDRESS_RE = /^(IN-\d{4})\/(WK-\d{4})\/(SLICE-\d{3})$/u;
  const ASSIGNED_UNIT_RE = /^(WK-\d{4})#(SLICE-\d{3})$/u;

  if (typeof mainRepo !== "string" || !path.isAbsolute(mainRepo)) {
    throw new Error("commit binding verification requires an absolute launcher-composed commitMainRepo");
  }
  if (!commitPlainObject(binding)) {
    throw new Error("identity-store commit binding must be an object");
  }

  const mode = binding.schema_version === WORKTREE_SUBSTRATE_BINDING_SCHEMA_VERSION
    ? "v1"
    : binding.schema_version === WORKTREE_SUBSTRATE_BINDING_SCHEMA_VERSION_V2
      ? "v2"
      : null;
  if (mode === null) {
    throw new Error("identity-store commit binding schema_version is not a supported worktree identity schema (v1 sparse or v2 full)");
  }
  const expectedFields = mode === "v1" ? EXACT_SPARSE_SLICE_BINDING_FIELDS : EXACT_FULL_SLICE_BINDING_FIELDS;

  const missingFields = expectedFields.filter(
    (field) => !Object.prototype.hasOwnProperty.call(binding, field)
  );
  const extraFields = Object.keys(binding).filter(
    (key) => !expectedFields.includes(key)
  );
  if (missingFields.length > 0 || extraFields.length > 0) {
    throw new Error(
      `identity-store commit binding is not the exact canonical ${mode === "v1" ? "sparse" : "full"}-slice schema` +
      (missingFields.length > 0 ? `; missing ${JSON.stringify(missingFields)}` : "") +
      (extraFields.length > 0 ? `; unexpected ${JSON.stringify(extraFields)}` : "")
    );
  }

  if (binding.launch_ref !== launchRef || binding.run_id !== runId ||
      !Number.isInteger(binding.retry_id) || binding.retry_id !== retryId) {
    throw new Error("identity-store commit binding launch_ref/run_id/retry_id does not match the exact commit request");
  }
  const unitMatch = typeof binding.unit_address === "string"
    ? UNIT_ADDRESS_RE.exec(binding.unit_address)
    : null;
  if (!unitMatch) {
    throw new Error("identity-store commit binding unit_address must identify one canonical exact slice");
  }
  const [, initiative, recordId, sliceId] = unitMatch;
  const subject = `${recordId}#${sliceId}`;
  const assignedMatch = typeof assignedUnit === "string"
    ? ASSIGNED_UNIT_RE.exec(assignedUnit)
    : null;
  if (!assignedMatch || assignedMatch[1] !== recordId || assignedMatch[2] !== sliceId) {
    throw new Error("launcher-assigned unit does not match the identity-store exact slice");
  }
  if (binding.initiative !== initiative) {
    throw new Error("identity-store commit binding initiative does not match unit_address");
  }
  if (binding.record_id !== recordId) {
    throw new Error("identity-store commit binding record_id does not match unit_address");
  }
  if (binding.slice_id !== sliceId) {
    throw new Error("identity-store commit binding slice_id does not match unit_address");
  }

  const selectedUnit = binding.selected_unit;
  if (!commitPlainObject(selectedUnit) ||
      selectedUnit.kind !== "slice" ||
      selectedUnit.address !== subject ||
      selectedUnit.record_id !== recordId ||
      selectedUnit.slice_id !== sliceId ||
      !Object.prototype.hasOwnProperty.call(selectedUnit, "repo") ||
      !(selectedUnit.repo === null || (typeof selectedUnit.repo === "string" && selectedUnit.repo.length > 0))) {
    throw new Error("identity-store commit binding selected_unit does not match the exact slice");
  }

  const branch = `slice/${initiative}/${recordId}/${sliceId}`;
  if (binding.output_branch !== branch && binding.output_branch !== `refs/heads/${branch}`) {
    throw new Error("identity-store commit binding output_branch does not match the exact slice");
  }

  if (binding.base_ref !== `wk/${initiative}/${recordId}`) {
    throw new Error("identity-store commit binding base_ref does not match the exact slice");
  }
  if (typeof binding.base_sha !== "string" || !COMMIT_BINDING_COMMIT_ID_RE.test(binding.base_sha)) {
    throw new Error("identity-store commit binding base_sha is not a canonical commit id");
  }

  if (!isCanonicalRepoPathArray(binding.write_scope, { nonEmpty: true })) {
    throw new Error("identity-store commit binding write_scope is not a canonical repository-path array");
  }
  if (binding.write_scope_source !== `wiki/work-records/${recordId}.json#${sliceId}`) {
    throw new Error("identity-store commit binding write_scope_source does not match the exact slice");
  }

  for (const field of ["read_scope", "repo_paths"]) {
    if (!isCanonicalRepoPathArray(binding[field])) {
      throw new Error(`identity-store commit binding ${field} is not a canonical repository-path array`);
    }
  }

  if (mode === "v1") {
    if (!isCanonicalRepoPathArray(binding.cone_dirs, { nonEmpty: true })) {
      throw new Error("identity-store commit binding cone_dirs is not a canonical repository-path array");
    }
    if (binding.index_sparse !== false) {
      throw new Error("identity-store commit binding index_sparse must be false");
    }
  } else if (binding.checkout_mode !== FULL_CHECKOUT_MODE) {
    throw new Error("identity-store commit binding checkout_mode must be \"full\" for a v2 full-checkout binding");
  }
  if (typeof binding.source_digest !== "string" || !COMMIT_BINDING_SOURCE_DIGEST_RE.test(binding.source_digest)) {
    throw new Error("identity-store commit binding source_digest is not a canonical sha256 digest");
  }
  if (!(binding.source_version === null ||
        (typeof binding.source_version === "string" && binding.source_version.length > 0))) {
    throw new Error("identity-store commit binding source_version is not canonical");
  }

  const worktreePath = binding.worktree_path;
  if (typeof worktreePath !== "string" || !path.isAbsolute(worktreePath) ||
      path.normalize(worktreePath) !== worktreePath || /[*?[\]{}]/u.test(worktreePath) ||
      path.basename(worktreePath) !== `slice-${initiative}-${recordId}-${sliceId}`) {
    throw new Error("identity-store commit binding worktree_path is not the canonical exact-slice worktree path");
  }

  return Object.freeze({ ...binding, subject });
}

function commitFirstNonEmptyString(source, names) {
  for (const name of names) {
    const value = source?.[name];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

export function resolveCommitGitIdentity(binding, canonicalRepo) {
  const direct = binding.provisionedWorktreeGitBinding ??
    binding.provisioned_worktree_git_binding ??
    binding.provisionedWorktreeGitIdentity ??
    binding.provisioned_worktree_git_identity ??
    binding.git_binding ??
    binding.git_identity ??
    binding;
  const workTree =
    commitFirstNonEmptyString(direct, ["worktreePath", "worktree_path"]) ??
    commitFirstNonEmptyString(binding, ["worktree_path", "worktreePath"]);
  if (!workTree) {
    throw new Error("commit binding lacks server-derived worktreePath/worktree_path");
  }
  const gitDir =
    commitFirstNonEmptyString(direct, ["gitDir", "git_dir", "worktreeGitDir", "worktree_git_dir"]) ??
    path.join(canonicalRepo, ".git", "worktrees", path.basename(workTree));

  const worktreesRoot = path.join(canonicalRepo, ".git", "worktrees");
  if (gitDir !== worktreesRoot && !gitDir.startsWith(`${worktreesRoot}${path.sep}`)) {
    throw new Error("commit binding Git directory is not contained in the launcher-composed commitMainRepo");
  }
  return Object.freeze({ gitDir, workTree });
}

export function normalizeCommitRef(outputBranch) {
  const branch = typeof outputBranch === "string" && outputBranch.trim().length > 0
    ? outputBranch.trim()
    : null;
  if (!branch) {
    throw new Error("commit binding lacks output_branch");
  }
  const ref = branch.startsWith("refs/heads/") ? branch : `refs/heads/${branch}`;
  if (/^refs\/heads\/wk\/IN-\d{4}\/WK-\d{4}$/u.test(ref)) {
    return Object.freeze({ kind: "wk", ref });
  }
  if (/^refs\/heads\/slice\/IN-\d{4}\/WK-\d{4}\/SLICE-\d{3}$/u.test(ref)) {
    return Object.freeze({ kind: "slice", ref });
  }
  throw new Error("commit binding output_branch is outside the WK/slice exact-unit namespaces");
}

export function resolveExpectedEnvelope(binding) {
  const value = binding.expected_envelope ?? binding.expectedEnvelope ?? binding.expected ?? null;
  return isPlainObject(value) ? value : null;
}

export function resolveSparseBinding(binding) {

  if (binding.schema_version === WORKTREE_SUBSTRATE_BINDING_SCHEMA_VERSION_V2 ||
      binding.checkout_mode === FULL_CHECKOUT_MODE) {
    return null;
  }
  const hasSparseAuthority =
    Object.prototype.hasOwnProperty.call(binding, "cone_dirs") ||
    Object.prototype.hasOwnProperty.call(binding, "index_sparse");
  if (!hasSparseAuthority) return null;
  return Object.freeze({
    base_sha: binding.base_sha,
    cone_dirs: binding.cone_dirs,
    index_sparse: binding.index_sparse
  });
}

export function resolveCommitWriteScopeMatcher(deriveWritableMountsFromWriteScope, canonicalRepo, writeScope) {
  const mounts = deriveWritableMountsFromWriteScope({ workspaceDir: canonicalRepo, writeScope });
  const repoRoot = path.resolve(canonicalRepo);
  const files = new Set(
    mounts.writableFiles.map((file) => path.relative(repoRoot, file).split(path.sep).join("/"))
  );
  const roots = mounts.writableRoots.map((root) => path.relative(repoRoot, root).split(path.sep).join("/"));
  const globRoots = (Array.isArray(writeScope) ? writeScope : [])
    .filter((entry) => typeof entry === "string" && entry.endsWith("/**"))
    .map((entry) => entry.slice(0, -3).replace(/\/+$/u, ""))
    .filter((entry) => entry.length > 0 && !path.isAbsolute(entry) && !entry.split("/").includes(".."));
  return Object.freeze({
    matches(relPath) {
      if (typeof relPath !== "string" || relPath.length === 0) return false;
      if (path.isAbsolute(relPath) || relPath.split("/").includes("..")) return false;
      if (files.has(relPath)) return true;
      return [...roots, ...globRoots].some((root) => relPath === root || relPath.startsWith(`${root}/`));
    }
  });
}
