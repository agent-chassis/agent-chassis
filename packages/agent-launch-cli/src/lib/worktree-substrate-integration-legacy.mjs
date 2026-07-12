

import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import {
  WORKTREE_SUBSTRATE_SCHEMA_VERSION,
  WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES,
  fail,
  parseSubject,
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
  bindingFilePath,
  defaultWriteBindingFile
} from "./worktree-substrate-identity.mjs";

export function integrationBranchRef(initiative) {
  assertInitiativeId(initiative);
  return `integration/${initiative}`;
}

export function integrationWorktreePath(worktreeRoot, initiative) {
  const root = assertAbsolutePath(worktreeRoot, "worktreeRoot");
  assertInitiativeId(initiative);
  return path.join(root, `integration-${initiative}`);
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
