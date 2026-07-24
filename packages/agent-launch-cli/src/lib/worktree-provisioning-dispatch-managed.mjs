

import { existsSync, lstatSync, mkdirSync, mkdtempSync, renameSync, rmSync, rmdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  defaultWriteBindingFile,
  defaultRunGit
} from "./worktree-substrate.mjs";
import { branchExists } from "./worktree-substrate-primitives.mjs";

import {
  allocateOrAdoptExactUnitWorktree as defaultAllocateOrAdoptExactUnitWorktree,
  allocateFullSliceExactUnitWorktree as defaultAllocateFullSliceExactUnitWorktree,
  classifyExistingSliceTipForDispatch as defaultClassifyExistingSliceTipForDispatch,
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
  COMMIT_OBJECT_MATERIALIZE_CONFIG
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

const WK_RECORD_SNAPSHOT_COMMITTER = Object.freeze({
  name: "agent-launch commit primitive",
  email: "commit-primitive@agent-launch.local"
});
const SNAPSHOT_OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

function snapshotGitOrFail(commitRunGit, ctx, args, whatFailed) {
  const res = commitRunGit({
    gitDir: ctx.gitDir,
    workTree: ctx.workTree ?? null,
    args,
    indexFile: ctx.indexFile ?? null
  });
  if (!res || res.ok !== true) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.GIT_FAILED,
      `${whatFailed} (git ${args.join(" ")})`,
      { status: res?.status ?? null, stderr: res?.stderr ?? null, error: res?.error ?? null }
    );
  }
  return res;
}

function currentTipIsExactRecordOnlyChild({ commitRunGit, gitDir, baseSha, relativeRecordPath }) {
  const parentsRes = commitRunGit({ gitDir, args: ["rev-list", "-n", "1", "--parents", baseSha] });
  if (parentsRes?.ok !== true) return false;
  const parts = String(parentsRes.stdout ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length !== 2) return false;
  const parent = parts[1];
  const diffRes = commitRunGit({
    gitDir,
    args: ["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", `${parent}^{tree}`, `${baseSha}^{tree}`]
  });
  if (diffRes?.ok !== true) return false;
  const changed = String(diffRes.stdout ?? "").split("\0").filter(Boolean);
  return changed.length === 1 && changed[0] === relativeRecordPath;
}

function commitCurrentWorkRecordToWkBranch({ repo, wkId, binding, runGit, deps }) {
  const gitDirResult = runGit({ repo, args: ["rev-parse", "--absolute-git-dir"] });
  const gitDir = gitDirResult?.ok === true ? String(gitDirResult.stdout ?? "").trim() : "";
  if (!path.isAbsolute(gitDir)) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.GIT_FAILED,
      "failed to resolve the launcher-owned Git directory for the dispatch-time WK-record commit",
      { status: gitDirResult?.status ?? null, stderr: gitDirResult?.stderr ?? null }
    );
  }

  const wkTipSha = binding.wk_tip_sha;
  const relativeRecordPath = `wiki/work-records/${wkId}.json`;
  const absoluteRecordPath = path.join(repo, relativeRecordPath);

  let recordStat;
  try {
    recordStat = lstatSync(absoluteRecordPath);
  } catch (error) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.GIT_FAILED,
      "the canonical WK record to snapshot is not present",
      { record_path: relativeRecordPath },
      error
    );
  }
  if (!recordStat.isFile()) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.GIT_FAILED,
      "the canonical WK record to snapshot is not a regular file",
      { record_path: relativeRecordPath }
    );
  }
  const commitRunGit = deps.runCommitGit ?? defaultRunCommitGit;

  const indexDir = mkdtempSync(path.join(tmpdir(), "wk-record-snapshot-index-"));
  const indexFile = path.join(indexDir, "index");
  try {

    snapshotGitOrFail(
      commitRunGit,
      { gitDir, indexFile },
      [...COMMIT_OBJECT_MATERIALIZE_CONFIG, "read-tree", wkTipSha],
      "failed to seed the dispatch-time snapshot index from the current WK tip"
    );

    const hashRes = snapshotGitOrFail(
      commitRunGit,
      { gitDir },
      [...COMMIT_OBJECT_MATERIALIZE_CONFIG, "hash-object", "-w", "--no-filters", "--", absoluteRecordPath],
      "failed to hash the canonical WK record blob"
    );
    const blobSha = String(hashRes.stdout ?? "").trim();
    if (!SNAPSHOT_OID_RE.test(blobSha)) {
      fail(
        WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.GIT_FAILED,
        "hashing the canonical WK record produced no object name",
        { blob_sha: blobSha || null }
      );
    }

    snapshotGitOrFail(
      commitRunGit,
      { gitDir, indexFile },
      [...COMMIT_OBJECT_MATERIALIZE_CONFIG, "update-index", "--add", "--cacheinfo", `100644,${blobSha},${relativeRecordPath}`],
      "failed to stage the exact WK record blob"
    );

    const treeRes = snapshotGitOrFail(
      commitRunGit,
      { gitDir, indexFile },
      [...COMMIT_OBJECT_MATERIALIZE_CONFIG, "write-tree"],
      "failed to write the dispatch-time snapshot tree"
    );
    const tree = String(treeRes.stdout ?? "").trim();
    if (!SNAPSHOT_OID_RE.test(tree)) {
      fail(
        WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.GIT_FAILED,
        "writing the dispatch-time snapshot tree produced no object name",
        { tree: tree || null }
      );
    }

    const baseTreeRes = snapshotGitOrFail(
      commitRunGit,
      { gitDir },
      ["rev-parse", "--verify", `${wkTipSha}^{tree}`],
      "failed to resolve the current WK tip tree"
    );
    const baseTree = String(baseTreeRes.stdout ?? "").trim();
    const diffRes = snapshotGitOrFail(
      commitRunGit,
      { gitDir },
      ["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", baseTree, tree],
      "failed to diff the snapshot tree against the WK base"
    );
    const changed = String(diffRes.stdout ?? "").split("\0").filter(Boolean);
    const foreign = changed.filter((entry) => entry !== relativeRecordPath);
    if (foreign.length > 0) {
      fail(
        WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.GIT_FAILED,
        "the dispatch-time snapshot tree changes paths outside the canonical WK record",
        { record_path: relativeRecordPath, changed, foreign }
      );
    }

    if (changed.length === 0 &&
        currentTipIsExactRecordOnlyChild({ commitRunGit, gitDir, baseSha: wkTipSha, relativeRecordPath })) {
      return Object.freeze({ committed_tip: wkTipSha, tree, owned: false });
    }

    const commitRes = snapshotGitOrFail(
      commitRunGit,
      { gitDir },
      [
        ...COMMIT_OBJECT_MATERIALIZE_CONFIG,
        "-c", `user.name=${WK_RECORD_SNAPSHOT_COMMITTER.name}`,
        "-c", `user.email=${WK_RECORD_SNAPSHOT_COMMITTER.email}`,
        "commit-tree", tree,
        "-p", wkTipSha,
        "-m", `chore(wiki): snapshot ${wkId} dispatch contract`
      ],
      "failed to write the dispatch-time snapshot commit"
    );
    const commit = String(commitRes.stdout ?? "").trim();
    if (!SNAPSHOT_OID_RE.test(commit)) {
      fail(
        WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.GIT_FAILED,
        "writing the dispatch-time snapshot commit produced no object name",
        { commit: commit || null }
      );
    }

    const advanced = advanceWkRef({
      gitDir,
      ref: `refs/heads/${binding.output_branch}`,
      baseSha: wkTipSha,
      tree,
      commit,
      deps: { runGit: commitRunGit }
    });
    return Object.freeze({
      committed_tip: advanced.commit,
      tree,
      owned: advanced.idempotent !== true
    });
  } finally {

    try { rmSync(indexDir, { recursive: true, force: true }); } catch {   }
  }
}

function rebindWkTipAfterRecordCommit({ repo, launchRef, runId, retryId, binding, committedTip, deps }) {
  const filePath = bindingFilePath(repo, launchRef, bindingIdentity(runId, "wk"), retryId);
  const tempPath = `${filePath}.wk1743-rebind.tmp`;
  try {

    if (existsSync(tempPath)) unlinkSync(tempPath);
    const rebound = Object.freeze({ ...binding, wk_tip_sha: committedTip });
    const writer = deps.writeBindingFile ?? defaultWriteBindingFile;
    writer({ filePath: tempPath, contents: `${JSON.stringify(rebound, null, 2)}\n` });
    renameSync(tempPath, filePath);
    return rebound;
  } catch (error) {
    try { if (existsSync(tempPath)) unlinkSync(tempPath); } catch {   }
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BINDING_INCOMPLETE,
      "failed to bind the persistent WK worktree to the dispatch-time record commit",
      { filePath, committedTip },
      error
    );
  }
}

function verifyPersistentWkRefCoherenceAfterSnapshot({ repo, binding, committedTip, runGit }) {
  const expectedRef = `refs/heads/${binding.output_branch}`;
  const symref = runGit({ repo: binding.worktree_path, args: ["symbolic-ref", "--quiet", "HEAD"] });
  const symHead = symref?.ok === true ? String(symref.stdout ?? "").trim() : "";
  if (symHead !== expectedRef) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BINDING_INCOMPLETE,
      "persistent WK worktree lost its branch association after the dispatch-time record commit",
      { expected: expectedRef, actual: symHead || null, worktree_path: binding.worktree_path }
    );
  }
  const refTip = runGit({ repo, args: ["rev-parse", "--verify", `${binding.output_branch}^{commit}`] });
  const refSha = refTip?.ok === true ? String(refTip.stdout ?? "").trim() : "";

  if (refSha !== committedTip || binding.wk_tip_sha !== committedTip) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BINDING_INCOMPLETE,
      "WK branch ref, launcher binding wk_tip_sha, and committed record tip disagree after the dispatch-time record commit",
      { ref: refSha || null, binding_wk_tip_sha: binding.wk_tip_sha ?? null, committed_tip: committedTip }
    );
  }
}

function compensateManagedAllocation({ runGit, repo, launchRef, runId, retryId, bindings, receipts = {}, createdRoots = [], recordCommit = null, cause }) {
  const failures = [];

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

  if (recordCommit && recordCommit.owned === true && receipts?.wk?.reused === true) {
    const rollback = runGit({
      repo,
      args: ["update-ref", recordCommit.ref, recordCommit.previous_tip, recordCommit.committed_tip]
    });
    if (!rollback || rollback.ok !== true) {
      failures.push({ stage: "wk_record_ref", detail: rollback ?? null });
    }
  }

  for (const [kind, binding] of [["slice", bindings.slice], ["wk", bindings.wk]]) {
    if (!binding) continue;
    removeBindingFile(repo, launchRef, bindingIdentity(runId, kind), retryId, failures);
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
  const classifyEarlySliceTip = deps.classifyExistingSliceTipForDispatch
    ?? defaultClassifyExistingSliceTipForDispatch;

  return withWkProvisioningLock({ repo, key: `${initiative}/${wkId}`, deps }, () => {

    const earlyReconcile = classifyEarlySliceTip({
      mainRepo: repo,
      unitAddress: `${initiative}/${wkId}/${sliceId}`,
      worktreeRoot: roots.worktreeRoot,
      deps: { ...deps, runGit }
    });
    const carriedCorrectiveProof = earlyReconcile?.corrective_continuation_proof ?? null;
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
      const snapshot = commitCurrentWorkRecordToWkBranch({
        repo, wkId, binding: bindings.wk, runGit, deps
      });
      recordCommit = Object.freeze({
        ref: `refs/heads/${bindings.wk.output_branch}`,

        previous_tip: bindings.wk.wk_tip_sha,
        committed_tip: snapshot.committed_tip,

        owned: snapshot.owned
      });
      bindings.wk = rebindWkTipAfterRecordCommit({
        repo, launchRef, runId, retryId, binding: bindings.wk, committedTip: snapshot.committed_tip, deps
      });
      assertCompleteManagedBinding({
        binding: bindings.wk, repo, unitAddress: `${initiative}/${wkId}`, launchRef,
        runId: bindingIdentity(runId, "wk"), retryId, worktreeRoot: roots.worktreeRoot, sparse: false,
        runGit
      });

      verifyPersistentWkRefCoherenceAfterSnapshot({
        repo, binding: bindings.wk, committedTip: snapshot.committed_tip, runGit
      });
      const sliceName = deriveExactUnitName({
        unitAddress: `${initiative}/${wkId}/${sliceId}`,
        worktreeRoot: roots.worktreeRoot
      });
      const sliceBranchPresent = branchExists(runGit, repo, sliceName.output_branch);
      const sliceWorktreePresent = existsSync(sliceName.worktree_path);

      const sliceDeps = { ...deps, runGit };
      if (carriedCorrectiveProof !== null) {
        sliceDeps.resolveCorrectiveContinuationProof = () => carriedCorrectiveProof;
      }
      bindings.slice = allocateSlice({
        mainRepo: repo,
        unitAddress: `${initiative}/${wkId}/${sliceId}`,
        launchRef,
        runId: bindingIdentity(runId, "slice"),
        retryId,
        worktreeRoot: roots.worktreeRoot,
        deps: sliceDeps
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

      compensateManagedAllocation({ runGit, repo, launchRef, runId, retryId, bindings, receipts, createdRoots, recordCommit, cause: error });
      throw error;
    }
  });
}
