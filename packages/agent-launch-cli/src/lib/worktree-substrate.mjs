

import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  writeSync
} from "node:fs";

export const WORKTREE_SUBSTRATE_SCHEMA_VERSION = "worktree-identity-binding.v1";

export const WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES = Object.freeze({
  INVALID_ARG: "agent_launch.worktree_substrate.invalid_arg.v1",
  INVALID_INITIATIVE_ID: "agent_launch.worktree_substrate.invalid_initiative_id.v1",
  INVALID_SUBJECT: "agent_launch.worktree_substrate.invalid_subject.v1",
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

function fail(code, message, detail = null, cause = null) {
  throw new WorktreeSubstrateError(`agent-launch worktree-substrate: ${message}`, {
    code,
    detail,
    cause
  });
}

const INITIATIVE_ID_RE = /^IN-\d{4}$/;
const WK_ID_RE = /^WK-\d{4}$/;

const SUBJECT_RE = /^WK-\d{4}(#[A-Za-z0-9._-]+)?$/;

const OPAQUE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

function assertInitiativeId(initiative) {
  if (typeof initiative !== "string" || !INITIATIVE_ID_RE.test(initiative)) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_INITIATIVE_ID,
      `initiative must match ^IN-\\d{4}$, got: ${JSON.stringify(initiative)}`
    );
  }
  return initiative;
}

function parseSubject(subject) {
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

function assertOpaqueId(value, label) {
  if (typeof value !== "string" || !OPAQUE_ID_RE.test(value)) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_ARG,
      `${label} must match ${OPAQUE_ID_RE}, got: ${JSON.stringify(value)}`
    );
  }
  return value;
}

function assertRetryIdZero(retryId) {

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

function assertAbsolutePath(p, label) {
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

export function integrationBranchRef(initiative) {
  assertInitiativeId(initiative);
  return `integration/${initiative}`;
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

function gitOrThrow(runGit, repo, args, whatFailed) {
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

function assertRefFormat(runGit, repo, branch) {
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

function enumerateRefs(runGit, repo) {
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

function assertNoRefNamespaceCollision(existingRefs, targetFullRef) {
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

function branchExists(runGit, repo, branch) {
  const res = runGit({ repo, args: ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`] });
  return Boolean(res && res.ok === true);
}

function revParse(runGit, repo, ref) {
  const res = gitOrThrow(runGit, repo, ["rev-parse", "--verify", `${ref}^{commit}`], `failed to resolve ${ref}`);
  return res.stdout.trim();
}

export function worktreeIdentityStoreDir(mainRepo) {
  const repo = assertAbsolutePath(mainRepo, "mainRepo");
  return path.join(repo, ".agent-launch", "worktree-identity");
}

function bindingFileName(launchRef, runId, retryId) {
  const key = JSON.stringify(["worktree-identity-binding.v1", launchRef, runId, retryId]);
  const h = createHash("sha256").update(key).digest("hex");
  return `binding-${h}.json`;
}

function bindingFilePath(mainRepo, launchRef, runId, retryId) {
  return path.join(worktreeIdentityStoreDir(mainRepo), bindingFileName(launchRef, runId, retryId));
}

export function defaultWriteBindingFile({ filePath, contents }) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  let fd;
  try {
    fd = openSync(filePath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
  } catch (err) {
    if (err && err.code === "EEXIST") {
      fail(
        WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.STORE_COLLISION,
        `identity binding already exists (duplicate allocation of the same run identity): ${filePath}`,
        { errno: err.code },
        err
      );
    }
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.STORE_WRITE_FAILED,
      `failed to create identity binding file: ${filePath}`,
      { errno: err?.code ?? null },
      err
    );
  }
  try {
    writeSync(fd, contents);
  } catch (err) {
    try { closeSync(fd); } catch {   }
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.STORE_WRITE_FAILED,
      `failed to write identity binding contents: ${filePath}`,
      { errno: err?.code ?? null },
      err
    );
  }
  try { closeSync(fd); } catch {   }
}

function canonicalWriteScope(mainRepo, wkId, sliceId) {
  const recordPath = path.join(mainRepo, "wiki", "work-records", `${wkId}.json`);
  let raw;
  try {
    raw = readFileSync(recordPath, "utf8");
  } catch (err) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.WRITE_SCOPE_UNRESOLVABLE,
      `canonical WK record not readable: ${recordPath}`,
      { errno: err?.code ?? null }
    );
  }
  let record;
  try {
    record = JSON.parse(raw);
  } catch (err) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.WRITE_SCOPE_UNRESOLVABLE,
      `canonical WK record is not valid JSON: ${recordPath}`,
      { message: err?.message ?? null }
    );
  }
  let scope;
  let source = `wiki/work-records/${wkId}.json`;
  if (sliceId === null) {
    scope = record?.write_scope;
  } else {
    const slices = Array.isArray(record?.slices) ? record.slices : [];
    const slice = slices.find((s) => s && s.id === sliceId);
    if (!slice) {
      fail(
        WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.WRITE_SCOPE_UNRESOLVABLE,
        `slice ${JSON.stringify(sliceId)} not found in ${recordPath}`,
        { wkId, sliceId }
      );
    }
    scope = slice.write_scope;
    source = `${source}#${sliceId}`;
  }
  if (!Array.isArray(scope) || scope.some((p) => typeof p !== "string" || p.length === 0)) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.WRITE_SCOPE_UNRESOLVABLE,
      `write_scope for ${JSON.stringify(sliceId ?? wkId)} is not a non-empty-string array in ${recordPath}`,
      { wkId, sliceId }
    );
  }

  return { writeScope: Object.freeze([...scope]), source };
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

function assertStoreDisjointFromWorktree(mainRepo, worktreePath) {
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

export function integrationWorktreePath(worktreeRoot, initiative) {
  const root = assertAbsolutePath(worktreeRoot, "worktreeRoot");
  assertInitiativeId(initiative);
  return path.join(root, `integration-${initiative}`);
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

function assertWorktreeRootOutsideMainRepo(mainRepo, worktreeRoot) {
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

function rollbackWorktreeAndBranch(runGit, mainRepo, worktreePath, branch, originalCause) {
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

export function allocateIntegrationWorktree({
  mainRepo,
  initiative,
  worktreeRoot,
  base = "main",
  deps = {}
} = {}) {
  const runGit = deps.runGit ?? defaultRunGit;
  const repo = assertAbsolutePath(mainRepo, "mainRepo");
  assertInitiativeId(initiative);
  const root = assertAbsolutePath(worktreeRoot, "worktreeRoot");
  assertWorktreeRootOutsideMainRepo(repo, root);
  if (typeof base !== "string" || base.length === 0) {
    fail(WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_ARG, "base must be a non-empty string");
  }

  const branch = integrationBranchRef(initiative);
  const fullRef = assertRefFormat(runGit, repo, branch);
  const worktreePath = integrationWorktreePath(root, initiative);
  assertStoreDisjointFromWorktree(repo, worktreePath);

  if (branchExists(runGit, repo, branch)) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.TARGET_EXISTS,
      `integration branch already exists: ${branch} (first-attempt allocation only)`,
      { branch }
    );
  }
  if (existsSync(worktreePath)) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.TARGET_EXISTS,
      `integration worktree path already exists: ${worktreePath} (first-attempt allocation only)`,
      { worktreePath }
    );
  }

  assertNoRefNamespaceCollision(enumerateRefs(runGit, repo), fullRef);

  mkdirSync(root, { recursive: true });
  const baseSha = revParse(runGit, repo, base);

  gitOrThrow(
    runGit,
    repo,
    ["worktree", "add", "-b", branch, worktreePath, base],
    `failed to create integration worktree/branch for ${initiative}`
  );

  return Object.freeze({
    schema_version: WORKTREE_SUBSTRATE_SCHEMA_VERSION,
    initiative,
    base_ref: base,
    base_sha: baseSha,
    integration_branch: branch,
    integration_worktree_path: worktreePath
  });
}

export function allocatePerWkWorktree({
  mainRepo,
  initiative,
  subject,
  launchRef,
  runId,
  retryId = 0,
  worktreeRoot,
  deps = {}
} = {}) {
  const runGit = deps.runGit ?? defaultRunGit;
  const writeBindingFile = deps.writeBindingFile ?? defaultWriteBindingFile;

  const repo = assertAbsolutePath(mainRepo, "mainRepo");
  assertInitiativeId(initiative);
  const { wkId, sliceId } = parseSubject(subject);
  assertOpaqueId(launchRef, "launch_ref");
  assertOpaqueId(runId, "run_id");
  assertRetryIdZero(retryId);
  const root = assertAbsolutePath(worktreeRoot, "worktreeRoot");
  assertWorktreeRootOutsideMainRepo(repo, root);

  const integrationBranch = integrationBranchRef(initiative);
  const branch = perWkBranchRef(initiative, wkId);
  const fullRef = assertRefFormat(runGit, repo, branch);
  const worktreePath = perWkWorktreePath(root, initiative, wkId);
  assertStoreDisjointFromWorktree(repo, worktreePath);

  if (!branchExists(runGit, repo, integrationBranch)) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INTEGRATION_BRANCH_MISSING,
      `integration branch ${integrationBranch} does not exist; allocate it before per-WK worktrees`,
      { integrationBranch }
    );
  }

  if (branchExists(runGit, repo, branch)) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.TARGET_EXISTS,
      `per-WK branch already exists: ${branch} (first-attempt only; reuse/reset is SLICE-002)`,
      { branch }
    );
  }
  if (existsSync(worktreePath)) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.TARGET_EXISTS,
      `per-WK worktree path already exists: ${worktreePath} (first-attempt only)`,
      { worktreePath }
    );
  }

  assertNoRefNamespaceCollision(enumerateRefs(runGit, repo), fullRef);

  const { writeScope, source: writeScopeSource } = canonicalWriteScope(repo, wkId, sliceId);

  const baseSha = revParse(runGit, repo, integrationBranch);

  mkdirSync(root, { recursive: true });

  gitOrThrow(
    runGit,
    repo,
    ["worktree", "add", "-b", branch, worktreePath, integrationBranch],
    `failed to create per-WK worktree/branch for ${subject}`
  );

  const binding = Object.freeze({
    schema_version: WORKTREE_SUBSTRATE_SCHEMA_VERSION,
    launch_ref: launchRef,
    run_id: runId,
    retry_id: retryId,
    initiative,
    subject,
    wk_id: wkId,
    slice_id: sliceId,
    base_ref: integrationBranch,
    base_sha: baseSha,
    output_branch: branch,
    worktree_path: worktreePath,
    write_scope: writeScope,
    write_scope_source: writeScopeSource
  });

  const filePath = bindingFilePath(repo, launchRef, runId, retryId);

  try {
    writeBindingFile({ filePath, contents: `${JSON.stringify(binding, null, 2)}\n` });
  } catch (storeErr) {
    rollbackWorktreeAndBranch(runGit, repo, worktreePath, branch, storeErr);

    throw storeErr;
  }

  return binding;
}

export function resolveWorktreeBinding({ mainRepo, launchRef, runId, retryId = 0 } = {}) {
  const repo = assertAbsolutePath(mainRepo, "mainRepo");
  assertOpaqueId(launchRef, "launch_ref");
  assertOpaqueId(runId, "run_id");
  if (!Number.isInteger(retryId) || retryId < 0) {
    fail(WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_ARG, `retry_id must be a non-negative integer`);
  }
  const filePath = bindingFilePath(repo, launchRef, runId, retryId);
  let raw;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (err) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.BINDING_NOT_FOUND,
      `no identity binding for (launch_ref,run_id,retry_id)=(${launchRef},${runId},${retryId}) at ${filePath}`,
      { errno: err?.code ?? null }
    );
  }
  let binding;
  try {
    binding = JSON.parse(raw);
  } catch (err) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.BINDING_NOT_FOUND,
      `identity binding is not valid JSON: ${filePath}`,
      { message: err?.message ?? null }
    );
  }
  return binding;
}

export function resolveWorktreePath(args) {
  const binding = resolveWorktreeBinding(args);
  return Object.freeze({
    output_branch: binding.output_branch,
    worktree_path: binding.worktree_path,
    write_scope: Object.freeze([...(binding.write_scope ?? [])]),
    base_ref: binding.base_ref,
    base_sha: binding.base_sha,
    subject: binding.subject,
    initiative: binding.initiative
  });
}
