

import { existsSync, mkdirSync, rmSync, unlinkSync } from "node:fs";
import path from "node:path";

import {
  WORKTREE_SUBSTRATE_SCHEMA_VERSION,
  WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES,
  WK_ID_RE,
  SLICE_ID_RE,
  fail,
  parseUnitAddress,
  assertInitiativeId,
  assertOpaqueId,
  assertRetryIdZero,
  assertAbsolutePath,
  assertWorktreeRootOutsideMainRepo,
  assertRefFormat,
  assertStoreDisjointFromWorktree,
  assertNoRefNamespaceCollision,
  enumerateRefs,
  branchExists,
  revParse,
  gitOrThrow,
  rollbackWorktreeAndBranch,
  perWkBranchRef,
  perWkWorktreePath,
  defaultRunGit
} from "./worktree-substrate-primitives.mjs";
import {
  canonicalWriteScope,
  canonicalUnitScopes,
  bindingFilePath,
  defaultWriteBindingFile,
  resolveVerifiedSparseExactUnitBinding
} from "./worktree-substrate-identity.mjs";

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
    "failed to classify sparse cone path from captured WK-tip tree"
  );
  if (!result.stdout) return false;
  const metadataEnd = result.stdout.indexOf("\t");
  return metadataEnd !== -1 && result.stdout.slice(0, metadataEnd).split(" ")[1] === "tree";
}

function deriveCanonicalConeDirs(runGit, repo, treeSha, scopePaths) {
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
    fail(WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_ARG, "read_scope union write_scope contains no directory cone");
  }
  return normalizeSparseConeDirs(minimal);
}

export function sliceBranchRef(initiative, wkId, sliceId) {
  assertInitiativeId(initiative);
  if (typeof wkId !== "string" || !WK_ID_RE.test(wkId)) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_SUBJECT,
      `wk id must match ^WK-\\d{4}$, got: ${JSON.stringify(wkId)}`
    );
  }
  if (typeof sliceId !== "string" || !SLICE_ID_RE.test(sliceId)) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_SLICE_ID,
      `slice id must match ^SLICE-\\d{3}$ (normalized upper-case), got: ${JSON.stringify(sliceId)}`
    );
  }
  return `slice/${initiative}/${wkId}/${sliceId}`;
}

export function sliceWorktreePath(worktreeRoot, initiative, wkId, sliceId) {
  const root = assertAbsolutePath(worktreeRoot, "worktreeRoot");
  assertInitiativeId(initiative);
  if (typeof wkId !== "string" || !WK_ID_RE.test(wkId)) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_SUBJECT,
      `wk id must match ^WK-\\d{4}$, got: ${JSON.stringify(wkId)}`
    );
  }
  if (typeof sliceId !== "string" || !SLICE_ID_RE.test(sliceId)) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_SLICE_ID,
      `slice id must match ^SLICE-\\d{3}$ (normalized upper-case), got: ${JSON.stringify(sliceId)}`
    );
  }
  return path.join(root, `slice-${initiative}-${wkId}-${sliceId}`);
}

export function deriveExactUnitName({ unitAddress, worktreeRoot }) {
  const parsed = parseUnitAddress(unitAddress);
  const outputBranch =
    parsed.kind === "wk"
      ? perWkBranchRef(parsed.initiative, parsed.wkId)
      : sliceBranchRef(parsed.initiative, parsed.wkId, parsed.sliceId);
  const worktreePath =
    parsed.kind === "wk"
      ? perWkWorktreePath(worktreeRoot, parsed.initiative, parsed.wkId)
      : sliceWorktreePath(worktreeRoot, parsed.initiative, parsed.wkId, parsed.sliceId);
  return Object.freeze({
    kind: parsed.kind,
    unit_address: parsed.unitAddress,
    initiative: parsed.initiative,
    wk_id: parsed.wkId,
    slice_id: parsed.sliceId,
    output_branch: outputBranch,
    worktree_path: worktreePath
  });
}

export function resolveIndependentUnitBase({ mainRepo, base = "main", deps = {} } = {}) {
  const runGit = deps.runGit ?? defaultRunGit;
  const repo = assertAbsolutePath(mainRepo, "mainRepo");
  if (typeof base !== "string" || base.length === 0) {
    fail(WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_ARG, "base must be a non-empty string");
  }
  const baseSha = revParse(runGit, repo, base);
  return Object.freeze({ base_ref: base, base_sha: baseSha });
}

export function resolveWkBranchTipBase({ mainRepo, unitAddress, deps = {} } = {}) {
  const runGit = deps.runGit ?? defaultRunGit;
  const repo = assertAbsolutePath(mainRepo, "mainRepo");
  const parsed = parseUnitAddress(unitAddress);
  if (parsed.kind !== "slice") {
    fail(WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_UNIT_ADDRESS, "WK-tip base resolution requires a slice unit_address");
  }
  const baseRef = perWkBranchRef(parsed.initiative, parsed.wkId);
  return Object.freeze({ base_ref: baseRef, base_sha: revParse(runGit, repo, baseRef) });
}

function compensateSparseAllocation({ runGit, repo, worktreePath, branch, bindingPath, bindingCreated, originalCause }) {
  const failures = [];
  if (bindingCreated && bindingPath && existsSync(bindingPath)) {
    try { unlinkSync(bindingPath); } catch (err) {
      failures.push({ step: "binding unlink", detail: err?.message ?? String(err) });
    }
  }
  if (existsSync(worktreePath)) {
    try {
      rollbackWorktreeAndBranch(runGit, repo, worktreePath, branch, originalCause);
    } catch (err) {
      throw err;
    }
  } else {
    const prune = runGit({ repo, args: ["worktree", "prune"] });
    if (!prune || prune.ok !== true) failures.push({ step: "worktree prune", detail: prune?.stderr ?? prune?.error ?? prune?.status });
    if (branchExists(runGit, repo, branch)) {
      const del = runGit({ repo, args: ["branch", "-D", branch] });
      if (!del || del.ok !== true) failures.push({ step: "branch -D", detail: del?.stderr ?? del?.error ?? del?.status });
    }
  }

  if (existsSync(worktreePath)) {
    try { rmSync(worktreePath, { recursive: true, force: true }); } catch (err) {
      failures.push({ step: "worktree directory removal", detail: err?.message ?? String(err) });
    }
  }
  if (failures.length > 0) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.ROLLBACK_FAILED,
      "sparse allocation rollback failed to fully compensate",
      { worktreePath, branch, compensationFailures: failures, originalError: originalCause?.message ?? String(originalCause) },
      originalCause
    );
  }
}

export function allocateSparseExactUnitWorktree({
  mainRepo,
  unitAddress,
  launchRef,
  runId,
  retryId = 0,
  worktreeRoot,
  coneDirs,
  deps = {}
} = {}) {
  const runGit = deps.runGit ?? defaultRunGit;
  const writeBindingFile = deps.writeBindingFile ?? defaultWriteBindingFile;
  const verifyBinding = deps.verifyBinding ?? resolveVerifiedSparseExactUnitBinding;
  const repo = assertAbsolutePath(mainRepo, "mainRepo");
  assertOpaqueId(launchRef, "launch_ref");
  assertOpaqueId(runId, "run_id");
  assertRetryIdZero(retryId);
  const root = assertAbsolutePath(worktreeRoot, "worktreeRoot");
  assertWorktreeRootOutsideMainRepo(repo, root);
  const name = deriveExactUnitName({ unitAddress, worktreeRoot: root });
  if (name.kind !== "slice") {
    fail(WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_UNIT_ADDRESS, "sparse exact-unit allocation requires a slice unit_address");
  }
  const scopes = canonicalUnitScopes(repo, name.wk_id, name.slice_id);
  const { base_ref: baseRef, base_sha: baseSha } = resolveWkBranchTipBase({ mainRepo: repo, unitAddress: name.unit_address, deps: { runGit } });
  const canonicalCones = deriveCanonicalConeDirs(
    runGit,
    repo,
    baseSha,
    [...scopes.readScope, ...scopes.writeScope]
  );
  if (coneDirs !== undefined) {
    const suppliedCones = normalizeSparseConeDirs(coneDirs);
    const sortedSuppliedCones = [...suppliedCones].sort();
    const sameCones = sortedSuppliedCones.length === canonicalCones.length &&
      sortedSuppliedCones.every((cone, index) => cone === canonicalCones[index]);
    if (!sameCones) {
      fail(
        WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_ARG,
        "coneDirs must exactly equal the canonical read_scope union write_scope directory cones",
        { expected: canonicalCones, actual: suppliedCones }
      );
    }
  }
  const cones = canonicalCones;
  const branch = name.output_branch;
  const worktreePath = name.worktree_path;
  const fullRef = assertRefFormat(runGit, repo, branch);
  assertStoreDisjointFromWorktree(repo, worktreePath);
  if (branchExists(runGit, repo, branch) || existsSync(worktreePath)) {
    fail(WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.TARGET_EXISTS, "sparse exact-unit target already exists", { branch, worktreePath });
  }
  assertNoRefNamespaceCollision(enumerateRefs(runGit, repo), fullRef);
  const { writeScope, source: writeScopeSource } = scopes;
  mkdirSync(root, { recursive: true });
  const bindingPath = bindingFilePath(repo, launchRef, runId, retryId);
  let bindingCreated = false;
  let binding;
  try {
    gitOrThrow(runGit, repo, ["worktree", "add", "--no-checkout", "-b", branch, worktreePath, baseSha], "failed to create sparse exact-unit worktree/branch");
    const head = revParse(runGit, worktreePath, "HEAD");
    if (head !== baseSha) {
      fail(WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.GIT_FAILED, "sparse worktree HEAD does not equal captured WK tip", { expected: baseSha, actual: head });
    }
    gitOrThrow(runGit, worktreePath, ["sparse-checkout", "init", "--cone", "--no-sparse-index"], "failed to initialize cone-mode sparse checkout");
    gitOrThrow(runGit, worktreePath, ["config", "--worktree", "index.sparse", "false"], "failed to pin worktree-local index.sparse=false");
    gitOrThrow(runGit, worktreePath, ["sparse-checkout", "set", "--cone", "--no-sparse-index", "--", ...cones], "failed to assign sparse cone directories");

    gitOrThrow(runGit, worktreePath, ["read-tree", "-mu", "HEAD"], "failed to materialize sparse cone checkout");
    const sparseIndex = gitOrThrow(runGit, worktreePath, ["config", "--worktree", "--get", "index.sparse"], "failed to verify worktree-local index.sparse").stdout.trim();
    if (sparseIndex !== "false") {
      fail(WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.GIT_FAILED, "worktree-local index.sparse must equal false", { actual: sparseIndex });
    }
    binding = Object.freeze({
      schema_version: WORKTREE_SUBSTRATE_SCHEMA_VERSION,
      launch_ref: launchRef,
      run_id: runId,
      retry_id: retryId,
      unit_address: name.unit_address,
      initiative: name.initiative,
      record_id: name.wk_id,
      slice_id: name.slice_id,
      base_ref: baseRef,
      base_sha: baseSha,
      output_branch: branch,
      worktree_path: worktreePath,
      write_scope: writeScope,
      write_scope_source: writeScopeSource,
      cone_dirs: cones,
      index_sparse: false
    });
    writeBindingFile({
      filePath: bindingPath,
      contents: `${JSON.stringify(binding, null, 2)}\n`,
      onCreated: () => { bindingCreated = true; }
    });
    bindingCreated = true;
    verifyBinding({ mainRepo: repo, launchRef, runId, retryId, expectedBinding: binding });
  } catch (err) {
    compensateSparseAllocation({
      runGit,
      repo,
      worktreePath,
      branch,
      bindingPath,
      bindingCreated,
      originalCause: err
    });
    throw err;
  }
  return binding;
}

export function allocateExactUnitWorktree({
  mainRepo,
  unitAddress,
  launchRef,
  runId,
  retryId = 0,
  worktreeRoot,
  base = "main",
  deps = {}
} = {}) {
  const runGit = deps.runGit ?? defaultRunGit;
  const writeBindingFile = deps.writeBindingFile ?? defaultWriteBindingFile;

  const repo = assertAbsolutePath(mainRepo, "mainRepo");
  assertOpaqueId(launchRef, "launch_ref");
  assertOpaqueId(runId, "run_id");
  assertRetryIdZero(retryId);
  const root = assertAbsolutePath(worktreeRoot, "worktreeRoot");
  assertWorktreeRootOutsideMainRepo(repo, root);

  const name = deriveExactUnitName({ unitAddress, worktreeRoot: root });
  const branch = name.output_branch;
  const worktreePath = name.worktree_path;
  const fullRef = assertRefFormat(runGit, repo, branch);
  assertStoreDisjointFromWorktree(repo, worktreePath);
  const wkId = name.wk_id;
  const sliceId = name.slice_id;

  if (branchExists(runGit, repo, branch)) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.TARGET_EXISTS,
      `exact-unit branch already exists: ${branch} (first-attempt only; reuse/reset is a separate concern)`,
      { branch }
    );
  }
  if (existsSync(worktreePath)) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.TARGET_EXISTS,
      `exact-unit worktree path already exists: ${worktreePath} (first-attempt only)`,
      { worktreePath }
    );
  }

  assertNoRefNamespaceCollision(enumerateRefs(runGit, repo), fullRef);

  const { writeScope, source: writeScopeSource } = canonicalWriteScope(repo, wkId, sliceId);

  const { base_ref: baseRef, base_sha: baseSha } = resolveIndependentUnitBase({
    mainRepo: repo,
    base,
    deps: { runGit }
  });

  mkdirSync(root, { recursive: true });
  gitOrThrow(
    runGit,
    repo,
    ["worktree", "add", "-b", branch, worktreePath, baseRef],
    `failed to create exact-unit worktree/branch for ${name.unit_address}`
  );

  const binding = Object.freeze({
    schema_version: WORKTREE_SUBSTRATE_SCHEMA_VERSION,
    launch_ref: launchRef,
    run_id: runId,
    retry_id: retryId,
    unit_address: name.unit_address,
    initiative: name.initiative,
    record_id: wkId,
    slice_id: sliceId,
    base_ref: baseRef,
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
