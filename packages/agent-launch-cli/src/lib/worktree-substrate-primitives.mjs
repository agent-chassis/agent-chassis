

import path from "node:path";
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";

export const WORKTREE_SUBSTRATE_SCHEMA_VERSION = "worktree-identity-binding.v1";

export const WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES = Object.freeze({
  INVALID_ARG: "agent_launch.worktree_substrate.invalid_arg.v1",
  INVALID_INITIATIVE_ID: "agent_launch.worktree_substrate.invalid_initiative_id.v1",
  INVALID_SUBJECT: "agent_launch.worktree_substrate.invalid_subject.v1",
  INVALID_UNIT_ADDRESS: "agent_launch.worktree_substrate.invalid_unit_address.v1",
  INVALID_SLICE_ID: "agent_launch.worktree_substrate.invalid_slice_id.v1",
  INVALID_REF: "agent_launch.worktree_substrate.invalid_ref.v1",
  REF_NAMESPACE_COLLISION: "agent_launch.worktree_substrate.ref_namespace_collision.v1",
  INTEGRATION_BRANCH_MISSING: "agent_launch.worktree_substrate.integration_branch_missing.v1",
  TARGET_EXISTS: "agent_launch.worktree_substrate.target_exists.v1",
  RETRY_NOT_SUPPORTED: "agent_launch.worktree_substrate.retry_not_supported.v1",
  WRITE_SCOPE_UNRESOLVABLE: "agent_launch.worktree_substrate.write_scope_unresolvable.v1",
  STORE_DIR_NOT_DISJOINT: "agent_launch.worktree_substrate.store_dir_not_disjoint.v1",
  STORE_COLLISION: "agent_launch.worktree_substrate.store_collision.v1",
  STORE_WRITE_FAILED: "agent_launch.worktree_substrate.store_write_failed.v1",
  ROLLBACK_FAILED: "agent_launch.worktree_substrate.rollback_failed.v1",
  BINDING_NOT_FOUND: "agent_launch.worktree_substrate.binding_not_found.v1",
  VERIFIED_BINDING_UNIT_MISMATCH: "agent_launch.worktree_substrate.verified_binding_unit_mismatch.v1",
  GIT_FAILED: "agent_launch.worktree_substrate.git_failed.v1"
});

export class WorktreeSubstrateError extends Error {
  constructor(message, { code, detail = null, cause = null } = {}) {
    super(message);
    this.name = "WorktreeSubstrateError";
    this.code = code ?? "agent_launch.worktree_substrate.error.v1";
    if (detail !== null) this.detail = detail;
    if (cause !== null) this.cause = cause;
  }
}

export function fail(code, message, detail = null, cause = null) {
  throw new WorktreeSubstrateError(`agent-launch worktree-substrate: ${message}`, {
    code,
    detail,
    cause
  });
}

const INITIATIVE_ID_RE = /^IN-\d{4}$/;
export const WK_ID_RE = /^WK-\d{4}$/;

const SUBJECT_RE = /^WK-\d{4}(#[A-Za-z0-9._-]+)?$/;

const OPAQUE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

export const SLICE_ID_RE = /^SLICE-\d{3}$/;
const SLICE_ID_CASE_INSENSITIVE_RE = /^SLICE-\d{3}$/i;

export function parseUnitAddress(unitAddress) {
  if (typeof unitAddress !== "string" || unitAddress.length === 0) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_UNIT_ADDRESS,
      `unit_address must be a non-empty string, got: ${JSON.stringify(unitAddress)}`
    );
  }
  const parts = unitAddress.split("/");
  if (parts.length !== 2 && parts.length !== 3) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_UNIT_ADDRESS,
      `unit_address must be IN-XXXX/WK-YYYY or IN-XXXX/WK-YYYY/SLICE-ZZZ, got: ${JSON.stringify(unitAddress)}`
    );
  }
  const [initiative, wkId, rawSliceId] = parts;
  assertInitiativeId(initiative);
  if (typeof wkId !== "string" || !WK_ID_RE.test(wkId)) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_UNIT_ADDRESS,
      `unit_address WK segment must match ^WK-\\d{4}$, got: ${JSON.stringify(wkId)}`
    );
  }
  if (parts.length === 2) {
    return Object.freeze({
      kind: "wk",
      initiative,
      wkId,
      sliceId: null,
      unitAddress: `${initiative}/${wkId}`
    });
  }
  if (typeof rawSliceId !== "string" || !SLICE_ID_CASE_INSENSITIVE_RE.test(rawSliceId)) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_SLICE_ID,
      `unit_address slice segment must match ^SLICE-\\d{3}$ (case-insensitive), got: ${JSON.stringify(rawSliceId)}`
    );
  }
  const sliceId = rawSliceId.toUpperCase();
  if (!SLICE_ID_RE.test(sliceId)) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_SLICE_ID,
      `normalized slice id must match ^SLICE-\\d{3}$, got: ${JSON.stringify(sliceId)}`
    );
  }
  return Object.freeze({
    kind: "slice",
    initiative,
    wkId,
    sliceId,
    unitAddress: `${initiative}/${wkId}/${sliceId}`
  });
}

export function assertInitiativeId(initiative) {
  if (typeof initiative !== "string" || !INITIATIVE_ID_RE.test(initiative)) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_INITIATIVE_ID,
      `initiative must match ^IN-\\d{4}$, got: ${JSON.stringify(initiative)}`
    );
  }
  return initiative;
}

export function parseSubject(subject) {
  if (typeof subject !== "string" || !SUBJECT_RE.test(subject)) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_SUBJECT,
      `subject must match ^WK-\\d{4}(#<slice>)?$, got: ${JSON.stringify(subject)}`
    );
  }
  const hashIdx = subject.indexOf("#");
  if (hashIdx === -1) return { wkId: subject, sliceId: null };
  return { wkId: subject.slice(0, hashIdx), sliceId: subject.slice(hashIdx + 1) };
}

export function assertOpaqueId(value, label) {
  if (typeof value !== "string" || !OPAQUE_ID_RE.test(value)) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_ARG,
      `${label} must match ${OPAQUE_ID_RE}, got: ${JSON.stringify(value)}`
    );
  }
  return value;
}

export function assertRetryIdZero(retryId) {

  if (!Number.isInteger(retryId) || retryId < 0) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_ARG,
      `retry_id must be a non-negative integer, got: ${JSON.stringify(retryId)}`
    );
  }
  if (retryId !== 0) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.RETRY_NOT_SUPPORTED,
      `allocation is first-attempt only (retry_id=0); retry reuse/reset is SLICE-002 (got retry_id=${retryId})`
    );
  }
  return retryId;
}

export function assertAbsolutePath(p, label) {
  if (typeof p !== "string" || p.length === 0) {
    fail(WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_ARG, `${label} must be a non-empty string`);
  }
  if (!path.isAbsolute(p)) {
    fail(WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_ARG, `${label} must be absolute: ${p}`);
  }
  if (/[*?[\]{}]/.test(p)) {
    fail(WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_ARG, `${label} must not contain glob chars: ${p}`);
  }
  for (const seg of p.split(path.sep)) {
    if (seg === "..") {
      fail(WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_ARG, `${label} must not contain ".." segments: ${p}`);
    }
  }
  return path.normalize(p);
}

export function perWkBranchRef(initiative, wkId) {
  assertInitiativeId(initiative);
  if (typeof wkId !== "string" || !WK_ID_RE.test(wkId)) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_SUBJECT,
      `wk id must match ^WK-\\d{4}$, got: ${JSON.stringify(wkId)}`
    );
  }
  return `wk/${initiative}/${wkId}`;
}

export function perWkWorktreePath(worktreeRoot, initiative, wkId) {
  const root = assertAbsolutePath(worktreeRoot, "worktreeRoot");
  assertInitiativeId(initiative);
  if (typeof wkId !== "string" || !WK_ID_RE.test(wkId)) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_SUBJECT,
      `wk id must match ^WK-\\d{4}$, got: ${JSON.stringify(wkId)}`
    );
  }
  return path.join(root, `wk-${initiative}-${wkId}`);
}

export function defaultRunGit({ repo, args }) {
  let res;
  try {
    res = spawnSync("git", ["-C", repo, "-c", "core.quotePath=false", ...args], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024
    });
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }
  if (res.error) {
    return { ok: false, error: res.error.message ?? String(res.error) };
  }
  if (typeof res.status !== "number" || res.status !== 0) {
    return {
      ok: false,
      status: res.status ?? null,
      signal: res.signal ?? null,
      stdout: typeof res.stdout === "string" ? res.stdout : "",
      stderr: typeof res.stderr === "string" ? res.stderr.slice(0, 2048) : null
    };
  }
  return { ok: true, stdout: typeof res.stdout === "string" ? res.stdout : "" };
}

export function gitOrThrow(runGit, repo, args, whatFailed) {
  const res = runGit({ repo, args });
  if (!res || res.ok !== true) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.GIT_FAILED,
      `${whatFailed} (git ${args.join(" ")})`,
      {
        status: res?.status ?? null,
        signal: res?.signal ?? null,
        error: res?.error ?? null,
        stderr: res?.stderr ?? null
      }
    );
  }
  return res;
}

export function normalizeSparseConeDirs(coneDirs) {
  if (!Array.isArray(coneDirs) || coneDirs.length === 0) {
    fail(WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_ARG, "coneDirs must be a non-empty array");
  }
  const normalized = [];
  for (const coneDir of coneDirs) {
    if (typeof coneDir !== "string" || coneDir.length === 0) {
      fail(WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_ARG, "every coneDir must be a non-empty string");
    }
    if (/^[/-]/.test(coneDir) || /[\x00-\x1f\x7f]/.test(coneDir)) {
      fail(
        WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_ARG,
        `coneDir must be relative, non-option-like, and control-free: ${JSON.stringify(coneDir)}`
      );
    }
    const parts = coneDir.split("/");
    if (parts.some((part) => part === "" || part === "." || part === "..") ||
        path.posix.normalize(coneDir) !== coneDir) {
      fail(
        WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_ARG,
        `coneDir must be a normalized repository-relative directory: ${JSON.stringify(coneDir)}`
      );
    }
    normalized.push(coneDir);
  }
  const sorted = [...normalized].sort();
  for (let index = 0; index < sorted.length; index += 1) {
    if (index > 0 && sorted[index] === sorted[index - 1]) {
      fail(WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_ARG, `duplicate coneDir: ${JSON.stringify(sorted[index])}`);
    }
    for (let ancestor = 0; ancestor < index; ancestor += 1) {
      if (sorted[index].startsWith(`${sorted[ancestor]}/`)) {
        fail(
          WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_ARG,
          `ancestor-redundant coneDirs are forbidden: ${JSON.stringify(sorted[ancestor])} contains ${JSON.stringify(sorted[index])}`
        );
      }
    }
  }
  return Object.freeze([...normalized]);
}

function treeEntryIsDirectory(runGit, repo, treeSha, scopePath) {
  const result = gitOrThrow(
    runGit,
    repo,
    ["ls-tree", "-z", "--full-tree", treeSha, "--", scopePath],
    "failed to classify sparse cone path from historical base tree"
  );
  if (!result.stdout) return false;
  const metadataEnd = result.stdout.indexOf("\t");
  const metadata = metadataEnd === -1 ? [] : result.stdout.slice(0, metadataEnd).split(" ");
  if (metadata.length !== 3 || !["blob", "tree", "commit"].includes(metadata[1])) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.GIT_FAILED,
      "failed to parse sparse cone path classification from historical base tree",
      { tree_sha: treeSha, scope_path: scopePath }
    );
  }
  return metadata[1] === "tree";
}

export function deriveCanonicalSparseConeDirs(runGit, repo, treeSha, scopePaths) {
  gitOrThrow(
    runGit,
    repo,
    ["cat-file", "-e", `${treeSha}^{tree}`],
    "failed to read historical base tree for sparse cone derivation"
  );
  const candidates = [];
  for (const scopePath of scopePaths) {
    if (typeof scopePath !== "string" || scopePath.length === 0 || path.posix.isAbsolute(scopePath) ||
        /[\x00-\x1f\x7f]/.test(scopePath) || path.posix.normalize(scopePath) !== scopePath) {
      fail(WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.WRITE_SCOPE_UNRESOLVABLE, `scope path cannot be mapped to a sparse cone: ${JSON.stringify(scopePath)}`);
    }
    const parts = scopePath.split("/");
    const wildcardIndex = parts.findIndex((part) => /[*?[]/.test(part));
    let coneDir;
    if (wildcardIndex !== -1) {
      coneDir = parts.slice(0, wildcardIndex).join("/");
    } else {
      coneDir = treeEntryIsDirectory(runGit, repo, treeSha, scopePath)
        ? scopePath
        : path.posix.dirname(scopePath);
    }
    if (coneDir !== "." && coneDir !== "") candidates.push(coneDir);
  }
  const minimal = [...new Set(candidates)].sort().filter((candidate, index, all) =>
    !all.some((possibleAncestor, ancestorIndex) => ancestorIndex !== index && candidate.startsWith(`${possibleAncestor}/`))
  );
  if (minimal.length === 0) {
    fail(WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_ARG, "read_scope union repo_paths union write_scope contains no directory cone");
  }
  return normalizeSparseConeDirs(minimal);
}

export function assertRefFormat(runGit, repo, branch) {
  const fullRef = `refs/heads/${branch}`;
  const res = runGit({ repo, args: ["check-ref-format", fullRef] });
  if (!res || res.ok !== true) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_REF,
      `git check-ref-format rejected ${JSON.stringify(fullRef)}`,
      { branch, stderr: res?.stderr ?? null, status: res?.status ?? null }
    );
  }
  return fullRef;
}

export function enumerateRefs(runGit, repo) {
  const res = gitOrThrow(
    runGit,
    repo,
    ["for-each-ref", "--format=%(refname)"],
    "failed to enumerate refs for D/F-collision guard"
  );
  return res.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

function isRefPrefixOrExtension(a, b) {
  if (a === b) return true;
  return a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

export function assertNoRefNamespaceCollision(existingRefs, targetFullRef) {
  for (const existing of existingRefs) {
    if (isRefPrefixOrExtension(existing, targetFullRef)) {
      fail(
        WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.REF_NAMESPACE_COLLISION,
        `existing ref ${JSON.stringify(existing)} is a path-prefix/extension of target ${JSON.stringify(targetFullRef)} ` +
          "(loose/packed directory-file conflict); refusing rather than relying on packed-refs to mask it",
        { existing, target: targetFullRef }
      );
    }
  }
}

export function branchExists(runGit, repo, branch) {
  const res = runGit({ repo, args: ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`] });
  return Boolean(res && res.ok === true);
}

export function revParse(runGit, repo, ref) {
  const res = gitOrThrow(runGit, repo, ["rev-parse", "--verify", `${ref}^{commit}`], `failed to resolve ${ref}`);
  return res.stdout.trim();
}

export function worktreeIdentityStoreDir(mainRepo) {
  const repo = assertAbsolutePath(mainRepo, "mainRepo");
  return path.join(repo, ".agent-launch", "worktree-identity");
}

function realpathOrLexical(p) {
  try {
    return realpathSync(p);
  } catch {

    const parent = path.dirname(p);
    try {
      return path.join(realpathSync(parent), path.basename(p));
    } catch {
      return p;
    }
  }
}

function pathWithin(inner, outer) {
  if (inner === outer) return true;
  const prefix = outer.endsWith(path.sep) ? outer : `${outer}${path.sep}`;
  return inner.startsWith(prefix);
}

export function assertStoreDisjointFromWorktree(mainRepo, worktreePath) {
  const storeReal = realpathOrLexical(worktreeIdentityStoreDir(mainRepo));
  const worktreeReal = realpathOrLexical(worktreePath);
  if (pathWithin(storeReal, worktreeReal) || pathWithin(worktreeReal, storeReal)) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.STORE_DIR_NOT_DISJOINT,
      "identity store dir and worktree subtree must be disjoint (worker-unwritability is a mount-namespace " +
        `property): store ${storeReal} vs worktree ${worktreeReal}`,
      { storeReal, worktreeReal }
    );
  }
}

export function assertWorktreeRootOutsideMainRepo(mainRepo, worktreeRoot) {
  const repoReal = realpathOrLexical(mainRepo);
  const rootReal = realpathOrLexical(worktreeRoot);
  if (pathWithin(rootReal, repoReal) || pathWithin(repoReal, rootReal)) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.STORE_DIR_NOT_DISJOINT,
      `worktreeRoot must be disjoint from the main repo working tree: root ${rootReal} vs repo ${repoReal}`,
      { rootReal, repoReal }
    );
  }
}

export function rollbackWorktreeAndBranch(runGit, mainRepo, worktreePath, branch, originalCause) {
  const failures = [];
  const remove = runGit({ repo: mainRepo, args: ["worktree", "remove", "--force", worktreePath] });
  if (!remove || remove.ok !== true) {
    failures.push({ step: "worktree remove --force", detail: remove?.stderr ?? remove?.error ?? remove?.status });
  }
  const prune = runGit({ repo: mainRepo, args: ["worktree", "prune"] });
  if (!prune || prune.ok !== true) {
    failures.push({ step: "worktree prune", detail: prune?.stderr ?? prune?.error ?? prune?.status });
  }

  if (branchExists(runGit, mainRepo, branch)) {
    const del = runGit({ repo: mainRepo, args: ["branch", "-D", branch] });
    if (!del || del.ok !== true) {
      failures.push({ step: "branch -D", detail: del?.stderr ?? del?.error ?? del?.status });
    }
  }
  if (failures.length > 0) {

    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.ROLLBACK_FAILED,
      "allocation rollback failed to fully compensate; half-state remains and must be resolved by the operator",
      {
        worktreePath,
        branch,
        compensationFailures: failures,
        originalError: originalCause?.message ?? String(originalCause),
        originalCode: originalCause?.code ?? null
      },
      originalCause
    );
  }
}
