

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, rmdirSync, unlinkSync } from "node:fs";
import path from "node:path";

import {
  defaultWriteBindingFile,
  defaultRunGit
} from "./worktree-substrate.mjs";
import { branchExists } from "./worktree-substrate-primitives.mjs";

import {
  allocateOrAdoptExactUnitWorktree as defaultAllocateOrAdoptExactUnitWorktree,
  allocateFullSliceExactUnitWorktree as defaultAllocateFullSliceExactUnitWorktree,
  deriveExactUnitName
} from "./worktree-substrate-exact-unit.mjs";
import { bindingFilePath } from "./worktree-substrate-identity.mjs";
import {
  WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES,
  fail,
  parseSubject,
  assertInitiativeId
} from "./worktree-provisioning-dispatch-constants.mjs";
import {
  bindingIdentity,
  canonicalizeOwnedPath,
  assertDistinctOwnedRoots,
  assertCompleteManagedBinding,
  freezeManagedResult
} from "./worktree-provisioning-dispatch-binding.mjs";
import {
  advanceWkRef,
  defaultRunGit as defaultRunCommitGit,
  materializeCommitObject
} from "./commit-object-primitive.mjs";

const WORKTREE_IDENTITY_BINDING_SCHEMA_VERSION_V2 = "worktree-identity-binding.v2";
const FULL_CHECKOUT_MODE = "full";

function removeBindingFile(repo, launchRef, runId, retryId, failures) {
  const filePath = bindingFilePath(repo, launchRef, runId, retryId);
  if (!existsSync(filePath)) return;
  try { unlinkSync(filePath); } catch (error) {
    failures.push({ stage: "binding", path: filePath, message: error?.message ?? String(error) });
  }
}

const WK_PROVISION_LOCK_DIRNAME = "worktree-provision-locks";
const WK_PROVISION_LOCK_ATTEMPTS = 1200;
const WK_PROVISION_LOCK_BACKOFF_MS = 50;

function synchronousSleep(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch {   }
}

export function defaultAcquireWkProvisioningLock({
  repo, key, attempts = WK_PROVISION_LOCK_ATTEMPTS, backoffMs = WK_PROVISION_LOCK_BACKOFF_MS
}) {
  const safeKey = String(key).replace(/[^A-Za-z0-9._-]/g, "-");
  const lockDir = path.join(repo, ".agent-launch", WK_PROVISION_LOCK_DIRNAME, `${safeKey}.lock`);
  mkdirSync(path.dirname(lockDir), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      mkdirSync(lockDir);
      let released = false;
      return {
        release() {
          if (released) return;
          released = true;
          try { rmdirSync(lockDir); } catch {   }
        }
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      synchronousSleep(backoffMs);
    }
  }
  fail(
    WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BASE_SHA_RACED,
    "could not acquire the per-WK provisioning lock within the bounded window (a concurrent provision holds it); retryable",
    { issue: "wk_provisioning_lock_contended", key: safeKey }
  );
}

function withWkProvisioningLock({ repo, key, deps }, criticalSection) {
  const acquire = deps.acquireWkProvisioningLock ?? defaultAcquireWkProvisioningLock;
  const handle = acquire({ repo, key });
  try {
    return criticalSection();
  } finally {
    if (handle && typeof handle.release === "function") handle.release();
  }
}

function commitCurrentWorkRecordToWkBranch({ repo, wkId, binding, runGit, worktreeRoot, deps }) {
  const gitDirResult = runGit({ repo, args: ["rev-parse", "--absolute-git-dir"] });
  const gitDir = gitDirResult?.ok === true ? String(gitDirResult.stdout ?? "").trim() : "";
  if (!path.isAbsolute(gitDir)) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.GIT_FAILED,
      "failed to resolve the launcher-owned Git directory for the dispatch-time WK-record commit",
      { status: gitDirResult?.status ?? null, stderr: gitDirResult?.stderr ?? null }
    );
  }

  const scratchRoot = mkdtempSync(path.join(worktreeRoot, ".wk-record-commit-"));
  const scratchWorktree = path.join(scratchRoot, "checkout");
  const add = runGit({
    repo,
    args: ["worktree", "add", "--detach", scratchWorktree, binding.base_sha]
  });
  if (!add || add.ok !== true) {
    rmSync(scratchRoot, { recursive: true, force: true });
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.GIT_FAILED,
      "failed to create the clean dispatch-time WK-record commit checkout",
      { status: add?.status ?? null, stderr: add?.stderr ?? null }
    );
  }

  let result = null;
  let primaryError = null;
  try {
    const relativeRecordPath = `wiki/work-records/${wkId}.json`;
    const scratchRecordPath = path.join(scratchWorktree, relativeRecordPath);
    mkdirSync(path.dirname(scratchRecordPath), { recursive: true });
    copyFileSync(path.join(repo, relativeRecordPath), scratchRecordPath);
    const commitRunGit = deps.runCommitGit ?? defaultRunCommitGit;
    const materialized = materializeCommitObject({
      gitDir,
      workTree: scratchWorktree,
      baseSha: binding.base_sha,
      message: `chore(wiki): snapshot ${wkId} dispatch contract`,
      deps: { runGit: commitRunGit }
    });
    result = advanceWkRef({
      gitDir,
      ref: `refs/heads/${binding.output_branch}`,
      baseSha: binding.base_sha,
      tree: materialized.tree,
      commit: materialized.commit,
      deps: { runGit: commitRunGit }
    });
  } catch (error) {
    primaryError = error;
  }

  const remove = runGit({ repo, args: ["worktree", "remove", "--force", scratchWorktree] });
  if (!remove || remove.ok !== true) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.ROLLBACK_FAILED,
      "dispatch-time WK-record commit checkout cleanup failed",
      { status: remove?.status ?? null, stderr: remove?.stderr ?? null },
      primaryError
    );
  }
  rmSync(scratchRoot, { recursive: true, force: true });
  if (primaryError) throw primaryError;
  return result.commit;
}

function rebindWkTipAfterRecordCommit({ repo, launchRef, runId, retryId, binding, committedTip, deps }) {
  const filePath = bindingFilePath(repo, launchRef, bindingIdentity(runId, "wk"), retryId);
  try {
    unlinkSync(filePath);
    const rebound = Object.freeze({ ...binding, base_sha: committedTip });
    const writer = deps.writeBindingFile ?? defaultWriteBindingFile;
    writer({ filePath, contents: `${JSON.stringify(rebound, null, 2)}\n` });
    return rebound;
  } catch (error) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BINDING_INCOMPLETE,
      "failed to bind the persistent WK worktree to the dispatch-time record commit",
      { filePath, committedTip },
      error
    );
  }
}

function compensateManagedAllocation({ runGit, repo, launchRef, runId, retryId, bindings, receipts = {}, createdRoots = [], cause }) {
  const failures = [];
  for (const [kind, binding] of [["slice", bindings.slice], ["wk", bindings.wk]]) {
    if (!binding) continue;
    removeBindingFile(repo, launchRef, bindingIdentity(runId, kind), retryId, failures);
  }

  const sliceBinding = bindings.slice;
  const sliceReceipt = receipts?.slice ?? {};
  if (sliceBinding && sliceReceipt.worktree_created === true) {
    const remove = runGit({ repo, args: ["worktree", "remove", "--force", sliceBinding.worktree_path] });
    if (!remove || remove.ok !== true) failures.push({ stage: "slice_worktree", detail: remove ?? null });
  }
  if (sliceBinding && sliceReceipt.branch_created === true) {
    const branch = runGit({
      repo,
      args: ["update-ref", "-d", `refs/heads/${sliceBinding.output_branch}`, sliceBinding.base_sha]
    });
    if (!branch || branch.ok !== true) failures.push({ stage: "slice_ref", detail: branch ?? null });
  }
  for (const root of createdRoots) {
    if (bindings.wk) continue;
    if (!existsSync(root)) continue;
    try { rmdirSync(root); } catch (error) {
      failures.push({ stage: "root", path: root, message: error?.message ?? String(error) });
    }
  }
  if (failures.length > 0) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.ROLLBACK_FAILED,
      "managed allocation rollback did not fully compensate",
      { failures, originalError: cause?.message ?? String(cause) },
      cause
    );
  }
}

export function provisionManagedWorktreesAtDispatch({
  mainRepo,
  initiative,
  subject,
  launchRef,
  runId,
  retryId = 0,
  worktreeRoot,
  deps = {}
} = {}) {
  const repo = canonicalizeOwnedPath(mainRepo, "mainRepo", { mustExist: true });
  assertInitiativeId(initiative);
  const { wkId, sliceId } = parseSubject(subject);
  if (sliceId === null || !/^SLICE-\d{3}$/.test(sliceId)) {
    fail(WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.INVALID_SUBJECT, "managed implementation dispatch requires one exact SLICE-NNN subject");
  }
  if (!Number.isInteger(retryId) || retryId < 0) {
    fail(WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.INVALID_ARG, "retryId must be a non-negative integer");
  }
  const roots = Object.freeze({
    worktreeRoot: canonicalizeOwnedPath(worktreeRoot, "worktreeRoot")
  });
  assertDistinctOwnedRoots({ mainRepo: repo, ...roots });
  const runGit = deps.runGit ?? defaultRunGit;
  const allocateOrAdoptWk = deps.allocateOrAdoptExactUnitWorktree ?? defaultAllocateOrAdoptExactUnitWorktree;

  const allocateSlice = deps.allocateFullSliceExactUnitWorktree
    ?? defaultAllocateFullSliceExactUnitWorktree;

  return withWkProvisioningLock({ repo, key: `${initiative}/${wkId}`, deps }, () => {
    const bindings = { wk: null, slice: null };

    const receipts = { wk: null, slice: null };
    let recordCommit = null;
    const createdRoots = [];
    try {
      if (!existsSync(roots.worktreeRoot)) {
        mkdirSync(roots.worktreeRoot, { recursive: true, mode: 0o700 });
        createdRoots.unshift(roots.worktreeRoot);
      }
      const wkAllocation = allocateOrAdoptWk({
        mainRepo: repo,
        unitAddress: `${initiative}/${wkId}`,
        launchRef,
        runId: bindingIdentity(runId, "wk"),
        retryId,
        worktreeRoot: roots.worktreeRoot,
        deps: { ...deps, runGit }
      });
      bindings.wk = wkAllocation.binding;
      receipts.wk = wkAllocation.receipt;
      assertCompleteManagedBinding({
        binding: bindings.wk, repo, unitAddress: `${initiative}/${wkId}`, launchRef,
        runId: bindingIdentity(runId, "wk"), retryId, worktreeRoot: roots.worktreeRoot, sparse: false,
        runGit
      });
      const committedRecordTip = commitCurrentWorkRecordToWkBranch({
        repo, wkId, binding: bindings.wk, runGit, worktreeRoot: roots.worktreeRoot, deps
      });
      recordCommit = Object.freeze({
        ref: `refs/heads/${bindings.wk.output_branch}`,
        previous_tip: bindings.wk.base_sha,
        committed_tip: committedRecordTip
      });
      bindings.wk = rebindWkTipAfterRecordCommit({
        repo, launchRef, runId, retryId, binding: bindings.wk, committedTip: committedRecordTip, deps
      });
      assertCompleteManagedBinding({
        binding: bindings.wk, repo, unitAddress: `${initiative}/${wkId}`, launchRef,
        runId: bindingIdentity(runId, "wk"), retryId, worktreeRoot: roots.worktreeRoot, sparse: false,
        runGit
      });
      const sliceName = deriveExactUnitName({
        unitAddress: `${initiative}/${wkId}/${sliceId}`,
        worktreeRoot: roots.worktreeRoot
      });
      const sliceBranchPresent = branchExists(runGit, repo, sliceName.output_branch);
      const sliceWorktreePresent = existsSync(sliceName.worktree_path);
      bindings.slice = allocateSlice({
        mainRepo: repo,
        unitAddress: `${initiative}/${wkId}/${sliceId}`,
        launchRef,
        runId: bindingIdentity(runId, "slice"),
        retryId,
        worktreeRoot: roots.worktreeRoot,
        deps: { ...deps, runGit }
      });
      receipts.slice = Object.freeze({
        branch_created: !sliceBranchPresent,
        worktree_created: !sliceWorktreePresent
      });

      assertCompleteManagedBinding({
        binding: bindings.slice, repo, unitAddress: `${initiative}/${wkId}/${sliceId}`, launchRef,
        runId: bindingIdentity(runId, "slice"), retryId, worktreeRoot: roots.worktreeRoot, sparse: true,
        runGit
      });

      if (bindings.slice.schema_version !== WORKTREE_IDENTITY_BINDING_SCHEMA_VERSION_V2 ||
          bindings.slice.checkout_mode !== FULL_CHECKOUT_MODE) {
        fail(
          WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BINDING_INCOMPLETE,
          "slice ensure must produce the launcher-owned FULL (v2) checkout; sparse (v1) provisioning is unsupported (DEC-0164)",
          {
            issue: "slice_ensure_not_full_checkout",
            schema_version: bindings.slice.schema_version ?? null,
            checkout_mode: bindings.slice.checkout_mode ?? null
          }
        );
      }
      if (bindings.wk.output_branch === bindings.slice.output_branch ||
          bindings.wk.worktree_path === bindings.slice.worktree_path) {
        fail(WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BINDING_INCOMPLETE, "persistent WK and slice resources collide");
      }
      return freezeManagedResult({ mainRepo: repo, initiative, wkId, sliceId, wkBinding: bindings.wk, sliceBinding: bindings.slice, retryId });
    } catch (error) {
      if (recordCommit && receipts.wk?.reused === true) {
        const rollback = runGit({
          repo,
          args: ["update-ref", recordCommit.ref, recordCommit.previous_tip, recordCommit.committed_tip]
        });
        if (!rollback || rollback.ok !== true) {
          fail(
            WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.ROLLBACK_FAILED,
            "failed to roll back the dispatch-time WK-record commit after slice provisioning failed",
            { recordCommit, status: rollback?.status ?? null, stderr: rollback?.stderr ?? null },
            error
          );
        }
      }
      compensateManagedAllocation({ runGit, repo, launchRef, runId, retryId, bindings, receipts, createdRoots, cause: error });
      throw error;
    }
  });
}
