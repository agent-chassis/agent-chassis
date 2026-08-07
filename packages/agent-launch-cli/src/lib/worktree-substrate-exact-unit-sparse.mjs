

import { existsSync, mkdirSync, rmSync, unlinkSync } from "node:fs";

import {
  WORKTREE_SUBSTRATE_SCHEMA_VERSION,
  WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES,
  fail,
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
  normalizeSparseConeDirs,
  deriveCanonicalSparseConeDirs,
  rollbackWorktreeAndBranch,
  defaultRunGit
} from "./worktree-substrate-primitives.mjs";
import {
  deriveExactUnitName,
  resolveWkBranchTipBase
} from "./worktree-substrate-exact-unit-identity.mjs";
import {
  canonicalUnitScopes,
  bindingFilePath,
  defaultWriteBindingFile,
  resolveVerifiedSparseExactUnitBinding
} from "./worktree-substrate-identity.mjs";

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
  readScope,
  repoPaths,
  writeScope,
  selectedUnit,
  sourceDigest,
  sourceVersion,
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
  const callerScopeCarriers = { readScope, repoPaths, writeScope, selectedUnit, sourceDigest, sourceVersion };
  const suppliedCarrier = Object.entries(callerScopeCarriers).find(([, value]) => value !== undefined);
  if (suppliedCarrier) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_ARG,
      `caller-supplied sparse authority is forbidden; ${suppliedCarrier[0]} must be resolved from the exact canonical selected unit server-side`
    );
  }
  const scopes = canonicalUnitScopes(repo, name.wk_id, name.slice_id, {
    expectedInitiative: name.initiative
  });
  const { base_ref: baseRef, base_sha: baseSha } = resolveWkBranchTipBase({ mainRepo: repo, unitAddress: name.unit_address, deps: { runGit } });
  const canonicalCones = deriveCanonicalSparseConeDirs(
    runGit,
    repo,
    baseSha,
    [...scopes.readableScope, ...scopes.writeScope]
  );
  if (coneDirs !== undefined) {
    const suppliedCones = normalizeSparseConeDirs(coneDirs);
    const sortedSuppliedCones = [...suppliedCones].sort();
    const sameCones = sortedSuppliedCones.length === canonicalCones.length &&
      sortedSuppliedCones.every((cone, index) => cone === canonicalCones[index]);
    if (!sameCones) {
      fail(
        WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_ARG,
        "coneDirs must exactly equal the canonical read_scope union repo_paths union write_scope directory cones",
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
  const {
    readScope: canonicalReadScope,
    repoPaths: canonicalRepoPaths,
    writeScope: canonicalWriteScope,
    selectedUnit: canonicalSelectedUnit,
    source: writeScopeSource,
    sourceDigest: canonicalSourceDigest,
    sourceVersion: canonicalSourceVersion
  } = scopes;
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
      read_scope: canonicalReadScope,
      repo_paths: canonicalRepoPaths,
      write_scope: canonicalWriteScope,
      write_scope_source: writeScopeSource,
      selected_unit: canonicalSelectedUnit,
      source_digest: canonicalSourceDigest,
      source_version: canonicalSourceVersion,
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
