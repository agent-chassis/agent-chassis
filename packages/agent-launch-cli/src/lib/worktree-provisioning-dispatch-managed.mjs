

import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash, randomBytes } from "node:crypto";
import {
  captureProcessIdentity,
  confirmedDead,
  defaultLivenessDeps
} from "./worktree-lease.mjs";
import path from "node:path";

import {
  defaultWriteBindingFile,
  defaultRunGit
} from "./worktree-substrate.mjs";
import {
  WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES,
  WorktreeSubstrateError,
  branchExists
} from "./worktree-substrate-primitives.mjs";

import {
  allocateOrAdoptExactUnitWorktree as defaultAllocateOrAdoptExactUnitWorktree,
  allocateFullSliceExactUnitWorktree as defaultAllocateFullSliceExactUnitWorktree,
  classifyExistingSliceTipForDispatch as defaultClassifyExistingSliceTipForDispatch,
  deriveExactUnitName,
  SLICE_TIP_RECONCILE_STATES
} from "./worktree-substrate-exact-unit.mjs";
import { bindingFilePath, resolveCapturedWkBase } from "./worktree-substrate-identity.mjs";
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
import {
  resolveControlledContractAttachmentGeneration as defaultResolveControlledContractGeneration
} from
  "@agent-chassis/wiki-core/src/lib/controlled-contract-tools.mjs";

const loadDefaultClassifyControlledAcceptanceState = async () => (
  await import("@agent-chassis/wiki-core/src/operations/controlled-contract.mjs")
).classifyControlledAcceptanceStateOperation;
import { assertControlledAcceptanceStateProjection } from
  "@agent-chassis/wiki-core/src/lib/work-record-proof-posture.mjs";
import {
  admitVerifiedReceipt,
  defaultControlledContractGenerationRunGit,
  persistControlledContractGeneration as defaultPersistControlledContractGeneration,
  resolveControlledContractGenerationBinding as defaultResolveControlledContractGenerationBinding
} from "./controlled-carrier-attachment-primitive.mjs";

const WORKTREE_IDENTITY_BINDING_SCHEMA_VERSION_V2 = "worktree-identity-binding.v2";
const FULL_CHECKOUT_MODE = "full";

function exactGitOutput(result) {
  return result?.ok === true && typeof result.stdout === "string"
    ? result.stdout.trim()
    : null;
}

function gitFailureDetail(result) {
  return {
    status: result?.status ?? null,
    signal: result?.signal ?? null,
    error: result?.error ?? null,
    stderr: result?.stderr ?? null
  };
}

function failedGitProbes(probes) {
  return Object.entries(probes)
    .filter(([, result]) => result?.ok !== true || typeof result.stdout !== "string")
    .map(([probe, result]) => ({ probe, ...gitFailureDetail(result) }));
}

function observeRetainedWorktreeStatus(runGit, worktreePath, stage) {
  const status = runGit({
    repo: worktreePath,
    args: ["status", "--porcelain=v1", "--untracked-files=all"]
  });
  if (status?.ok !== true || typeof status.stdout !== "string") {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.GIT_FAILED,
      `failed to observe the retained slice worktree status ${stage} current-tip reconciliation`,
      { issue: "retained_slice_worktree_status_failed", stage, ...gitFailureDetail(status) }
    );
  }
}

function registeredWorktreeForBranch(runGit, repo, worktreePath, branch) {
  const listed = runGit({ repo, args: ["worktree", "list", "--porcelain", "-z"] });
  if (listed?.ok !== true || typeof listed.stdout !== "string") {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.GIT_FAILED,
      "failed to verify the retained slice worktree registration",
      { issue: "retained_slice_worktree_registration_failed", ...gitFailureDetail(listed) }
    );
  }
  const expectedRef = `refs/heads/${branch}`;
  let observedPath = null;
  let observedBranch = null;
  for (const token of listed.stdout.split("\0")) {
    if (token.startsWith("worktree ")) {
      if (observedPath === worktreePath && observedBranch === expectedRef) return true;
      observedPath = token.slice("worktree ".length);
      observedBranch = null;
    } else if (token.startsWith("branch ")) {
      observedBranch = token.slice("branch ".length);
    }
  }
  return observedPath === worktreePath && observedBranch === expectedRef;
}

function reconcileContainedSliceWorktreeToCurrentW({
  runGit,
  repo,
  worktreePath,
  branch,
  retainedTip,
  wkRef,
  currentWkTip
}) {
  if (!existsSync(worktreePath) ||
      !registeredWorktreeForBranch(runGit, repo, worktreePath, branch)) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BINDING_INCOMPLETE,
      "the retained slice branch is not attached to its expected managed worktree",
      { issue: "retained_slice_worktree_not_attached" }
    );
  }
  const expectedRef = `refs/heads/${branch}`;
  const identityProbes = {
    association: runGit({ repo: worktreePath, args: ["symbolic-ref", "--quiet", "HEAD"] }),
    branch_tip: runGit({ repo, args: ["show-ref", "--verify", "--hash", expectedRef] }),
    head: runGit({ repo: worktreePath, args: ["rev-parse", "--verify", "HEAD"] })
  };
  if (exactGitOutput(identityProbes.association) !== expectedRef ||
      exactGitOutput(identityProbes.branch_tip) !== retainedTip ||
      exactGitOutput(identityProbes.head) !== retainedTip) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BINDING_INCOMPLETE,
      "the retained slice worktree no longer equals its observed pre-reconciliation tip",
      { issue: "retained_slice_tip_mismatch", git_probe_failures: failedGitProbes(identityProbes) }
    );
  }
  observeRetainedWorktreeStatus(runGit, worktreePath, "before");
  const observedWResult = runGit({
    repo,
    args: ["show-ref", "--verify", "--hash", `refs/heads/${wkRef}`]
  });
  if (exactGitOutput(observedWResult) !== currentWkTip) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BASE_SHA_RACED,
      "the authenticated WK tip moved before retained-slice reconciliation",
      { issue: "current_wk_tip_moved", git_probe_failures: failedGitProbes({ wk_tip: observedWResult }) }
    );
  }

  const recheckedRResult = runGit({
    repo,
    args: ["show-ref", "--verify", "--hash", expectedRef]
  });
  if (exactGitOutput(recheckedRResult) !== retainedTip) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BASE_SHA_RACED,
      "the retained slice tip moved immediately before reconciliation",
      { issue: "retained_slice_tip_moved", git_probe_failures: failedGitProbes({ branch_tip: recheckedRResult }) }
    );
  }
  const merged = runGit({
    repo: worktreePath,
    args: ["merge", "--ff-only", "--no-edit", currentWkTip]
  });
  if (merged?.ok !== true) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.GIT_FAILED,
      "the retained slice worktree could not fast-forward to the authenticated WK tip",
      { issue: "retained_slice_fast_forward_failed", ...gitFailureDetail(merged) }
    );
  }
  const settledProbes = {
    branch_tip: runGit({ repo, args: ["show-ref", "--verify", "--hash", expectedRef] }),
    head: runGit({ repo: worktreePath, args: ["rev-parse", "--verify", "HEAD"] })
  };
  if (exactGitOutput(settledProbes.branch_tip) !== currentWkTip ||
      exactGitOutput(settledProbes.head) !== currentWkTip) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BINDING_INCOMPLETE,
      "the reconciled slice worktree did not settle at the authenticated WK tip",
      {
        issue: "retained_slice_fast_forward_postcondition_failed",
        git_probe_failures: failedGitProbes(settledProbes)
      }
    );
  }
  observeRetainedWorktreeStatus(runGit, worktreePath, "after");
  return currentWkTip;
}

export const MANAGED_CONTROLLED_CONTRACT_GENERATION_DIAGNOSTIC_CODES = Object.freeze({

  RECORD_UNREADABLE:
    "agent_launch.worktree_provisioning_dispatch.controlled_contract_record_unreadable.v1",

  GENERATION_REQUIRED_ABSENT:
    "agent_launch.worktree_provisioning_dispatch.controlled_contract_generation_required_absent.v1",
  DISPOSITION_MISSING:
    "agent_launch.worktree_provisioning_dispatch.controlled_acceptance_disposition_missing.v1",
  CONTROLLED_ACCEPTANCE_INCOMPLETE:
    "agent_launch.worktree_provisioning_dispatch.controlled_acceptance_incomplete.v1",
  CONTROLLED_ACCEPTANCE_SOURCE_NOT_CURRENT:
    "agent_launch.worktree_provisioning_dispatch.controlled_acceptance_source_not_current.v1",
  PROOF_POSTURE_INVALID:
    "agent_launch.worktree_provisioning_dispatch.controlled_acceptance_proof_posture_invalid.v1"
});

export const FINDINGS_SNAPSHOT_DIAGNOSTIC_CODES = Object.freeze({
  AUTHORITY_INVALID:
    "agent_launch.findings_snapshot.canonical_unit_mutation_authority_invalid.v1",
  BASE_UNRESOLVABLE:
    "agent_launch.findings_snapshot.review_source_unresolvable.v1",
  MATERIALIZATION_FAILED:
    "agent_launch.findings_snapshot.materialization_failed.v1",
  GENERATION_REQUIRED_ABSENT:
    "agent_launch.findings_snapshot.controlled_contract_generation_required_absent.v1"
});

const TRUSTED_FINDINGS_SNAPSHOT_SOURCE_SELECTIONS = new WeakSet();

export function mintFindingsSnapshotSourceSelection({
  subject,
  sourceRef,
  sourceCommit,
  effectiveWriteScope,
  authorityKind = "canonical_unit"
} = {}) {
  if (typeof subject !== "string" ||
      !(sourceRef === null || (typeof sourceRef === "string" && sourceRef.startsWith("refs/"))) ||
      typeof sourceCommit !== "string" || !SNAPSHOT_OID_RE.test(sourceCommit) ||
      !Array.isArray(effectiveWriteScope) || effectiveWriteScope.length !== 0 ||
      !Object.isFrozen(effectiveWriteScope) ||
      !new Set(["canonical_unit", "authenticated_operator"]).has(authorityKind)) {
    fail(
      FINDINGS_SNAPSHOT_DIAGNOSTIC_CODES.AUTHORITY_INVALID,
      "the launcher-authenticated findings source selection is malformed"
    );
  }
  const selection = Object.freeze({
    subject,
    authority_kind: authorityKind,
    source_ref: sourceRef,
    source_commit: sourceCommit,
    effective_write_scope: Object.freeze([])
  });
  TRUSTED_FINDINGS_SNAPSHOT_SOURCE_SELECTIONS.add(selection);
  return selection;
}

function readLauncherAuthenticatedWorkRecord(repo, wkId) {
  const relativeRecordPath = `wiki/work-records/${wkId}.json`;
  const absoluteRecordPath = path.join(repo, relativeRecordPath);
  let entry;
  try {
    entry = lstatSync(absoluteRecordPath);
  } catch (error) {
    fail(
      MANAGED_CONTROLLED_CONTRACT_GENERATION_DIAGNOSTIC_CODES.RECORD_UNREADABLE,
      "the canonical WK record that decides the controlled-contract required population is not present",
      { record_path: relativeRecordPath },
      error
    );
  }
  if (!entry.isFile() || entry.isSymbolicLink()) {
    fail(
      MANAGED_CONTROLLED_CONTRACT_GENERATION_DIAGNOSTIC_CODES.RECORD_UNREADABLE,
      "the canonical WK record that decides the controlled-contract required population is not a regular file",
      { record_path: relativeRecordPath }
    );
  }
  try {
    const parsed = JSON.parse(readFileSync(absoluteRecordPath, "utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("canonical WK record is not one JSON object");
    }
    return parsed;
  } catch (error) {
    fail(
      MANAGED_CONTROLLED_CONTRACT_GENERATION_DIAGNOSTIC_CODES.RECORD_UNREADABLE,
      "the canonical WK record that decides the controlled-contract required population is malformed",
      { record_path: relativeRecordPath },
      error
    );
  }
}

function captureFindingsSnapshotAuthority(repo, wkId) {
  const recordPath = `wiki/work-records/${wkId}.json`;
  const recordAbsolutePath = path.join(repo, recordPath);
  const recordStat = lstatSync(recordAbsolutePath);
  if (!recordStat.isFile() || recordStat.isSymbolicLink()) {
    fail(
      FINDINGS_SNAPSHOT_DIAGNOSTIC_CODES.MATERIALIZATION_FAILED,
      "the canonical findings record is not a regular file",
      { record_path: recordPath }
    );
  }
  const recordBytes = readFileSync(recordAbsolutePath);
  let record;
  try {
    record = JSON.parse(recordBytes.toString("utf8"));
  } catch (error) {
    fail(
      FINDINGS_SNAPSHOT_DIAGNOSTIC_CODES.MATERIALIZATION_FAILED,
      "the canonical findings record could not be captured",
      { record_path: recordPath },
      error
    );
  }
  const contractsDirectory = path.join(repo, "wiki", "contracts");
  const manifests = new Map();
  let names = [];
  try {
    names = readdirSync(contractsDirectory);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  for (const name of names.sort()) {
    if (!name.startsWith(`${wkId}.`) || !name.endsWith("carrier-set-manifest.json")) continue;
    const relativePath = `wiki/contracts/${name}`;
    const absolutePath = path.join(repo, relativePath);
    const stat = lstatSync(absolutePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      fail(
        FINDINGS_SNAPSHOT_DIAGNOSTIC_CODES.MATERIALIZATION_FAILED,
        "a controlled carrier manifest is not a regular file",
        { path: relativePath }
      );
    }
    const bytes = readFileSync(absolutePath);
    let manifest;
    try {
      manifest = JSON.parse(bytes.toString("utf8"));
    } catch (error) {
      fail(
        FINDINGS_SNAPSHOT_DIAGNOSTIC_CODES.MATERIALIZATION_FAILED,
        "a controlled carrier manifest could not be captured",
        { path: relativePath },
        error
      );
    }
    manifests.set(manifest?.focus ?? null, Object.freeze({ relativePath, bytes }));
  }
  return Object.freeze({ record, recordPath, recordBytes, manifests });
}

function sha256Digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function removeBindingFile(repo, launchRef, runId, retryId, failures) {
  const filePath = bindingFilePath(repo, launchRef, runId, retryId);
  if (!existsSync(filePath)) return;
  try { unlinkSync(filePath); } catch (error) {
    failures.push({ stage: "binding", path: filePath, message: error?.message ?? String(error) });
  }
}

const WK_PROVISION_LOCK_DIRNAME = "worktree-provision-locks";
const PROVISION_LOCK_OWNER_FILE = "owner.json";
const WK_PROVISION_LOCK_ATTEMPTS = 1200;
const WK_PROVISION_LOCK_BACKOFF_MS = 50;
const LOCAL_WK_PROVISION_QUEUES = new Map();

function synchronousSleep(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch {   }
}

function provisioningOwnerIdentity(deps) {
  try {
    return captureProcessIdentity(process.pid, deps);
  } catch {

    return null;
  }
}

function provisioningOwnerIsReclaimable(owner, deps) {
  const identity = owner?.identity ?? null;
  if (identity === null || typeof identity !== "object") return false;
  if (!Number.isInteger(identity.pid) || identity.pid <= 0 ||
      typeof identity.starttime !== "string" || typeof identity.boot_id !== "string") {
    return false;
  }
  try {
    return confirmedDead(identity, deps) === true;
  } catch {
    return false;
  }
}

function readProvisioningOwner(lockDir) {
  try {
    return JSON.parse(readFileSync(path.join(lockDir, PROVISION_LOCK_OWNER_FILE), "utf8"));
  } catch {
    return null;
  }
}

export function defaultAcquireWkProvisioningLock({
  repo, key, attempts = WK_PROVISION_LOCK_ATTEMPTS, backoffMs = WK_PROVISION_LOCK_BACKOFF_MS,
  deps = defaultLivenessDeps
}) {
  const safeKey = String(key).replace(/[^A-Za-z0-9._-]/g, "-");
  const lockDir = path.join(repo, ".agent-launch", WK_PROVISION_LOCK_DIRNAME, `${safeKey}.lock`);
  mkdirSync(path.dirname(lockDir), { recursive: true, mode: 0o700 });
  const token = randomBytes(16).toString("hex");
  const staging = `${lockDir}.staging-${token}`;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {

      if (existsSync(lockDir)) {
        const current = readProvisioningOwner(lockDir);
        if (provisioningOwnerIsReclaimable(current, deps)) {
          const claimedNow = `${lockDir}.claimed-${current.owner_token}`;
          const tombstoneNow = `${lockDir}.reaped-${current.owner_token}`;
          try {
            renameSync(path.join(lockDir, PROVISION_LOCK_OWNER_FILE), claimedNow);
            renameSync(lockDir, tombstoneNow);
            rmSync(tombstoneNow, { recursive: true, force: true });
            rmSync(claimedNow, { force: true });
          } catch {   }
          continue;
        }
        synchronousSleep(backoffMs);
        continue;
      }

      mkdirSync(staging, { mode: 0o700 });
      writeFileSync(
        path.join(staging, PROVISION_LOCK_OWNER_FILE),
        `${JSON.stringify({ owner_token: token, identity: provisioningOwnerIdentity(deps) })}\n`,
        { mode: 0o600 }
      );
      renameSync(staging, lockDir);
      let released = false;
      return {
        release() {
          if (released) return;
          released = true;

          const current = readProvisioningOwner(lockDir);
          if (current?.owner_token !== token) return;
          const tombstone = `${lockDir}.released-${token}`;
          try {
            renameSync(lockDir, tombstone);
            rmSync(tombstone, { recursive: true, force: true });
          } catch {   }
        }
      };
    } catch (error) {
      try { rmSync(staging, { recursive: true, force: true }); } catch {   }
      if (error?.code !== "EEXIST" && error?.code !== "ENOTEMPTY") throw error;
      const current = readProvisioningOwner(lockDir);
      if (provisioningOwnerIsReclaimable(current, deps)) {

        const claimed = `${lockDir}.claimed-${current.owner_token}`;
        const tombstone = `${lockDir}.reaped-${current.owner_token}`;
        try {
          renameSync(path.join(lockDir, PROVISION_LOCK_OWNER_FILE), claimed);
          renameSync(lockDir, tombstone);
          rmSync(tombstone, { recursive: true, force: true });
          rmSync(claimed, { force: true });
        } catch {   }
        continue;
      }
      synchronousSleep(backoffMs);
    }
  }
  fail(
    WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BASE_SHA_RACED,
    "could not acquire the per-WK provisioning lock within the bounded window (a concurrent provision holds it); retryable",
    { issue: "wk_provisioning_lock_contended", key: safeKey }
  );
}

async function withWkProvisioningLock({ repo, key, deps }, criticalSection) {
  const localKey = `${repo}\0${key}`;
  const predecessor = LOCAL_WK_PROVISION_QUEUES.get(localKey) ?? Promise.resolve();
  let releaseLocal;
  const localTurn = new Promise((resolve) => { releaseLocal = resolve; });
  LOCAL_WK_PROVISION_QUEUES.set(localKey, localTurn);
  await predecessor;
  const acquire = deps.acquireWkProvisioningLock ?? defaultAcquireWkProvisioningLock;
  let handle = null;
  try {
    handle = acquire({ repo, key });
    return await criticalSection();
  } finally {
    if (handle && typeof handle.release === "function") handle.release();
    releaseLocal();
    if (LOCAL_WK_PROVISION_QUEUES.get(localKey) === localTurn) {
      LOCAL_WK_PROVISION_QUEUES.delete(localKey);
    }
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

    if (changed.length === 0) {
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

function findingsSnapshotGitOrFail(commitRunGit, ctx, args, whatFailed, stdin = null) {
  const result = commitRunGit({
    gitDir: ctx.gitDir,
    workTree: ctx.workTree ?? null,
    args,
    stdin,
    indexFile: ctx.indexFile ?? null
  });
  if (!result || result.ok !== true) {
    fail(
      FINDINGS_SNAPSHOT_DIAGNOSTIC_CODES.MATERIALIZATION_FAILED,
      whatFailed,
      { status: result?.status ?? null, stderr: result?.stderr ?? null }
    );
  }
  return result;
}

function assertCanonicalSnapshotPath(relativePath) {
  if (typeof relativePath !== "string" || relativePath.length === 0 ||
      path.isAbsolute(relativePath) || relativePath.split("/").includes("..")) {
    fail(
      FINDINGS_SNAPSHOT_DIAGNOSTIC_CODES.MATERIALIZATION_FAILED,
      "the canonical findings snapshot contains an invalid repository path",
      { path: typeof relativePath === "string" ? relativePath : null }
    );
  }
  return relativePath;
}

function deterministicFindingsSnapshotCommit({
  commitRunGit,
  gitDir,
  tree,
  parent,
  wkId
}) {
  const message = `snapshot ${wkId} findings source`;
  const body = [
    `tree ${tree}`,
    `parent ${parent}`,
    "author agent-launch findings snapshot <findings-snapshot@agent-launch.local> 0 +0000",
    "committer agent-launch findings snapshot <findings-snapshot@agent-launch.local> 0 +0000",
    "",
    message,
    ""
  ].join("\n");
  const result = findingsSnapshotGitOrFail(
    commitRunGit,
    { gitDir },
    ["hash-object", "-t", "commit", "-w", "--stdin"],
    "failed to write the immutable findings snapshot commit",
    body
  );
  const commit = String(result.stdout ?? "").trim();
  if (!SNAPSHOT_OID_RE.test(commit) || /^0+$/u.test(commit)) {
    fail(
      FINDINGS_SNAPSHOT_DIAGNOSTIC_CODES.MATERIALIZATION_FAILED,
      "writing the immutable findings snapshot produced no commit object"
    );
  }
  return commit;
}

export async function provisionFindingsSnapshotAtDispatch(input = {}) {
  const allowedFields = new Set([
    "mainRepo", "subject", "worktreeRoot", "deps", "trustedSourceSelection"
  ]);
  const unsupported = input !== null && typeof input === "object" && !Array.isArray(input)
    ? Object.keys(input).filter((field) => !allowedFields.has(field))
    : ["input"];
  if (unsupported.length > 0) {
    fail(
      FINDINGS_SNAPSHOT_DIAGNOSTIC_CODES.AUTHORITY_INVALID,
      "caller-provided review-source locators are not accepted",
      { unsupported_fields: unsupported.sort() }
    );
  }
  const {
    mainRepo,
    subject,
    worktreeRoot,
    deps = {},
    trustedSourceSelection = null
  } = input;
  const repo = canonicalizeOwnedPath(mainRepo, "mainRepo", { mustExist: true });
  const roots = Object.freeze({
    worktreeRoot: canonicalizeOwnedPath(worktreeRoot, "worktreeRoot")
  });
  assertDistinctOwnedRoots({ mainRepo: repo, ...roots });
  const { wkId, sliceId } = parseSubject(subject);
  let captured;
  try {
    captured = captureFindingsSnapshotAuthority(repo, wkId);
  } catch (error) {
    if (typeof error?.code === "string" &&
        error.code.startsWith("agent_launch.findings_snapshot.")) throw error;
    fail(
      FINDINGS_SNAPSHOT_DIAGNOSTIC_CODES.MATERIALIZATION_FAILED,
      "the canonical findings record and carrier manifests could not be captured",
      { record_id: wkId },
      error
    );
  }
  const record = captured.record;
  const selectedUnit = sliceId === null
    ? record
    : Array.isArray(record.slices)
      ? record.slices.find((candidate) => candidate?.id === sliceId) ?? null
      : null;
  const trustedSelection = trustedSourceSelection !== null &&
    TRUSTED_FINDINGS_SNAPSHOT_SOURCE_SELECTIONS.has(trustedSourceSelection) &&
    trustedSourceSelection.subject === subject &&
    new Set(["canonical_unit", "authenticated_operator"])
      .has(trustedSourceSelection.authority_kind) &&
    Array.isArray(trustedSourceSelection.effective_write_scope) &&
    trustedSourceSelection.effective_write_scope.length === 0 &&
    Object.isFrozen(trustedSourceSelection.effective_write_scope);
  if (!selectedUnit || !trustedSelection) {
    fail(
      FINDINGS_SNAPSHOT_DIAGNOSTIC_CODES.AUTHORITY_INVALID,
      "the routing-owned findings source selection is unavailable",
      { subject, source_selection_authenticated: trustedSelection }
    );
  }

  const runGit = deps.runGit ?? defaultRunGit;
  const commitRunGit = deps.runCommitGit ?? defaultRunCommitGit;
  const sourceRef = trustedSourceSelection.source_ref;
  if (sourceRef !== null && !/^refs\/[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(sourceRef)) {
    fail(
      FINDINGS_SNAPSHOT_DIAGNOSTIC_CODES.BASE_UNRESOLVABLE,
      "the launcher-authorized findings source ref could not be resolved once"
    );
  }
  const baseResult = runGit({
    repo,
    args: ["cat-file", "-e", `${trustedSourceSelection.source_commit}^{commit}`]
  });
  const baseCommit = baseResult?.ok === true ? trustedSourceSelection.source_commit : "";
  if (!SNAPSHOT_OID_RE.test(baseCommit) || /^0+$/u.test(baseCommit)) {
    fail(
      FINDINGS_SNAPSHOT_DIAGNOSTIC_CODES.BASE_UNRESOLVABLE,
      "the launcher-authorized review source could not be resolved once to an immutable commit"
    );
  }
  const baseTreeResult = runGit({
    repo,
    args: ["rev-parse", "--verify", `${baseCommit}^{tree}`]
  });
  const baseTree = baseTreeResult?.ok === true
    ? String(baseTreeResult.stdout ?? "").trim()
    : "";
  if (!SNAPSHOT_OID_RE.test(baseTree) || /^0+$/u.test(baseTree)) {
    fail(
      FINDINGS_SNAPSHOT_DIAGNOSTIC_CODES.BASE_UNRESOLVABLE,
      "the launcher-authorized review source has no authenticated tree identity"
    );
  }
  const gitDirResult = runGit({ repo, args: ["rev-parse", "--absolute-git-dir"] });
  const gitDir = gitDirResult?.ok === true ? String(gitDirResult.stdout ?? "").trim() : "";
  if (!path.isAbsolute(gitDir)) {
    fail(
      FINDINGS_SNAPSHOT_DIAGNOSTIC_CODES.BASE_UNRESOLVABLE,
      "the launcher-owned object store for the review source is unavailable"
    );
  }

  const resolveGeneration = deps.resolveControlledContractGeneration
    ?? defaultResolveControlledContractGeneration;
  let generation;
  try {
    generation = await resolveGeneration({ repoRoot: repo, wkId });
  } catch (error) {
    const uncontrolledRepositoryAbsent =
      error?.code === "controlled_contract_repository_unavailable" &&
      captured.manifests.size === 0;
    if (!uncontrolledRepositoryAbsent) {
      fail(
        FINDINGS_SNAPSHOT_DIAGNOSTIC_CODES.MATERIALIZATION_FAILED,
        "the complete controlled-contract generation could not be authenticated",
        {
          record_id: wkId,
          source_code: typeof error?.code === "string" ? error.code : null
        },
        error
      );
    }
    generation = null;
  }
  const recordPath = captured.recordPath;
  const snapshotEntries = new Map([[recordPath, captured.recordBytes.toString("utf8")]]);
  if (generation === null && captured.manifests.size > 0) {
    fail(
      FINDINGS_SNAPSHOT_DIAGNOSTIC_CODES.GENERATION_REQUIRED_ABSENT,
      "the controlled findings unit has no complete carrier generation",
      { record_id: wkId, subject }
    );
  }
  if (generation !== null) {
    if (!Array.isArray(generation.descriptors) || generation.descriptors.length === 0 ||
        generation.count !== generation.descriptors.length) {
      fail(
        FINDINGS_SNAPSHOT_DIAGNOSTIC_CODES.MATERIALIZATION_FAILED,
        "the controlled-contract generation population is incomplete",
        { expected_count: generation.count ?? null,
          observed_count: Array.isArray(generation.descriptors)
            ? generation.descriptors.length : null }
      );
    }
    const selectionByFocus = new Map();
    for (const selection of generation.manifest_selection ?? []) {
      const focus = selection?.focus ?? null;
      const generationId = selection?.generation;
      const manifest = captured.manifests.get(focus);
      if (!manifest || typeof generationId !== "string" ||
          !/^[0-9a-f]{64}$/u.test(generationId) ||
          sha256Digest(manifest.bytes) !== selection?.manifest_content_digest) {
        fail(
          FINDINGS_SNAPSHOT_DIAGNOSTIC_CODES.MATERIALIZATION_FAILED,
          "the carrier manifest moved during atomic findings snapshot capture",
          { record_id: wkId, focus }
        );
      }
      selectionByFocus.set(focus, generationId);
      snapshotEntries.set(manifest.relativePath, manifest.bytes.toString("utf8"));
      snapshotEntries.set(
        assertCanonicalSnapshotPath(
          `wiki/contracts/.carrier-generations/${generationId}/manifest.json`
        ),
        manifest.bytes.toString("utf8")
      );
    }
    if (selectionByFocus.size === 0) {
      fail(
        FINDINGS_SNAPSHOT_DIAGNOSTIC_CODES.MATERIALIZATION_FAILED,
        "the complete controlled-contract generation has no authenticated manifest"
      );
    }
    for (const descriptor of generation.descriptors ?? []) {
      const descriptorPath = assertCanonicalSnapshotPath(descriptor?.path);
      if (typeof descriptor?.bytes_base64 !== "string") {
        fail(
          FINDINGS_SNAPSHOT_DIAGNOSTIC_CODES.MATERIALIZATION_FAILED,
          "the controlled-contract generation did not retain authoritative bytes",
          { path: descriptorPath }
        );
      }
      const bytes = Buffer.from(descriptor.bytes_base64, "base64");
      if (bytes.toString("base64") !== descriptor.bytes_base64 ||
          bytes.byteLength !== descriptor.byte_length ||
          sha256Digest(bytes) !== descriptor.content_digest) {
        fail(
          FINDINGS_SNAPSHOT_DIAGNOSTIC_CODES.MATERIALIZATION_FAILED,
          "the controlled-contract generation retained mismatched bytes",
          { path: descriptorPath }
        );
      }
      const textBytes = bytes.toString("utf8");
      if (!Buffer.from(textBytes, "utf8").equals(bytes)) {
        fail(
          FINDINGS_SNAPSHOT_DIAGNOSTIC_CODES.MATERIALIZATION_FAILED,
          "controlled-contract carriers must be canonical UTF-8 JSON bytes",
          { path: descriptorPath }
        );
      }
      snapshotEntries.set(descriptorPath, textBytes);
      const generationId = selectionByFocus.get(descriptor?.focus ?? null);
      if (generationId === undefined) {
        fail(
          FINDINGS_SNAPSHOT_DIAGNOSTIC_CODES.MATERIALIZATION_FAILED,
          "a controlled-contract carrier has no selected generation",
          { path: descriptorPath }
        );
      }
      snapshotEntries.set(
        assertCanonicalSnapshotPath(
          `wiki/contracts/.carrier-generations/${generationId}/${descriptor.basename}`
        ),
        textBytes
      );
    }
  }

  const indexDir = mkdtempSync(path.join(tmpdir(), "findings-snapshot-index-"));
  let tree;
  let snapshotCommit;
  try {
    const indexFile = path.join(indexDir, "index");
    findingsSnapshotGitOrFail(
      commitRunGit,
      { gitDir, indexFile },
      [...COMMIT_OBJECT_MATERIALIZE_CONFIG, "read-tree", baseCommit],
      "failed to seed the immutable findings snapshot"
    );
    for (const [relativePath, bytes] of [...snapshotEntries.entries()]
      .sort(([left], [right]) => left.localeCompare(right))) {
      assertCanonicalSnapshotPath(relativePath);
      const blobResult = findingsSnapshotGitOrFail(
        commitRunGit,
        { gitDir },
        [...COMMIT_OBJECT_MATERIALIZE_CONFIG, "hash-object", "-w", "--stdin"],
        "failed to retain authoritative findings snapshot bytes",
        bytes
      );
      const blob = String(blobResult.stdout ?? "").trim();
      if (!SNAPSHOT_OID_RE.test(blob)) {
        fail(
          FINDINGS_SNAPSHOT_DIAGNOSTIC_CODES.MATERIALIZATION_FAILED,
          "the immutable findings snapshot produced no blob identity",
          { path: relativePath }
        );
      }
      findingsSnapshotGitOrFail(
        commitRunGit,
        { gitDir, indexFile },
        [...COMMIT_OBJECT_MATERIALIZE_CONFIG, "update-index", "--add", "--cacheinfo",
          `100644,${blob},${relativePath}`],
        "failed to bind authoritative bytes into the immutable findings snapshot"
      );
    }
    const treeResult = findingsSnapshotGitOrFail(
      commitRunGit,
      { gitDir, indexFile },
      [...COMMIT_OBJECT_MATERIALIZE_CONFIG, "write-tree"],
      "failed to write the immutable findings snapshot tree"
    );
    tree = String(treeResult.stdout ?? "").trim();
    if (!SNAPSHOT_OID_RE.test(tree)) {
      fail(
        FINDINGS_SNAPSHOT_DIAGNOSTIC_CODES.MATERIALIZATION_FAILED,
        "the immutable findings snapshot produced no tree identity"
      );
    }
    snapshotCommit = deterministicFindingsSnapshotCommit({
      commitRunGit, gitDir, tree, parent: baseCommit, wkId
    });
  } finally {
    rmSync(indexDir, { recursive: true, force: true });
  }

  const snapshotRoot = path.join(roots.worktreeRoot, ".findings-snapshots", wkId);
  mkdirSync(snapshotRoot, { recursive: true, mode: 0o700 });

  const actionRoot = mkdtempSync(path.join(snapshotRoot, "action-"));
  const actionName = path.basename(actionRoot);
  const worktreePath = path.join(actionRoot, `checkout-${actionName}`);
  const materialized = runGit({
    repo,
    args: ["worktree", "add", "--detach", worktreePath, snapshotCommit]
  });
  if (materialized?.ok !== true) {
    fail(
      FINDINGS_SNAPSHOT_DIAGNOSTIC_CODES.MATERIALIZATION_FAILED,
      "failed to materialize the confined immutable findings worktree",
      { status: materialized?.status ?? null, stderr: materialized?.stderr ?? null }
    );
  }
  const observedCommit = runGit({
    repo: worktreePath,
    args: ["rev-parse", "--verify", "HEAD^{commit}"]
  });
  const observedTree = runGit({
    repo: worktreePath,
    args: ["rev-parse", "--verify", "HEAD^{tree}"]
  });
  if (observedCommit?.ok !== true || String(observedCommit.stdout ?? "").trim() !== snapshotCommit ||
      observedTree?.ok !== true || String(observedTree.stdout ?? "").trim() !== tree) {
    fail(
      FINDINGS_SNAPSHOT_DIAGNOSTIC_CODES.MATERIALIZATION_FAILED,
      "the retained findings worktree does not match its immutable snapshot identity"
    );
  }
  for (const [relativePath, expectedBytes] of snapshotEntries) {
    let observedBytes;
    try {
      observedBytes = readFileSync(path.join(worktreePath, relativePath));
    } catch (error) {
      fail(
        FINDINGS_SNAPSHOT_DIAGNOSTIC_CODES.MATERIALIZATION_FAILED,
        "the retained findings snapshot is missing authenticated bytes",
        { path: relativePath },
        error
      );
    }
    const expected = Buffer.isBuffer(expectedBytes)
      ? expectedBytes
      : Buffer.from(expectedBytes, "utf8");
    if (observedBytes.byteLength !== expected.byteLength ||
        sha256Digest(observedBytes) !== sha256Digest(expected)) {
      fail(
        FINDINGS_SNAPSHOT_DIAGNOSTIC_CODES.MATERIALIZATION_FAILED,
        "the retained findings snapshot bytes do not match the atomic capture",
        { path: relativePath }
      );
    }
  }

  const generationIdentity = generation === null
    ? null
    : Object.freeze({
        schema_version: generation.schema_version,
        record_id: generation.record_id,
        count: generation.count,
        generation_digest: generation.generation_digest,
        manifest_selection: Object.freeze((generation.manifest_selection ?? []).map(
          (selection) => Object.freeze({ ...selection })
        )),
        descriptors: Object.freeze((generation.descriptors ?? []).map((descriptor) =>
          Object.freeze({
            path: descriptor.path,
            carrier_kind: descriptor.carrier_kind,
            content_digest: descriptor.content_digest,
            byte_length: descriptor.byte_length
          })))
      });
  return Object.freeze({
    schema_version: "workspace-agent-immutable-findings-snapshot.v1",
    complete: true,
    subject,
    record_id: wkId,
    slice_id: sliceId,
    source_ref: sourceRef,
    base_commit: baseCommit,
    base_tree: baseTree,
    snapshot_commit: snapshotCommit,
    snapshot_tree: tree,
    worktree_path: worktreePath,
    canonical_record_digest: sha256Digest(snapshotEntries.get(recordPath)),
    controlled_contract_generation: generationIdentity
  });
}

function rebindWkTip({ repo, launchRef, runId, retryId, binding, committedTip, deps, stage }) {
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
      `failed to bind the persistent WK worktree after ${stage}`,
      { filePath, committedTip, stage },
      error
    );
  }
}

function verifyPersistentWkRefCoherence({ repo, binding, committedTip, runGit, stage }) {
  const expectedRef = `refs/heads/${binding.output_branch}`;
  const symref = runGit({ repo: binding.worktree_path, args: ["symbolic-ref", "--quiet", "HEAD"] });
  const symHead = symref?.ok === true ? String(symref.stdout ?? "").trim() : "";
  if (symHead !== expectedRef) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BINDING_INCOMPLETE,
      `persistent WK worktree lost its branch association after ${stage}`,
      { expected: expectedRef, actual: symHead || null, worktree_path: binding.worktree_path, stage }
    );
  }
  const refTip = runGit({ repo, args: ["rev-parse", "--verify", `${binding.output_branch}^{commit}`] });
  const refSha = refTip?.ok === true ? String(refTip.stdout ?? "").trim() : "";

  if (refSha !== committedTip || binding.wk_tip_sha !== committedTip) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BINDING_INCOMPLETE,
      `WK branch ref, launcher binding wk_tip_sha, and expected tip disagree after ${stage}`,
      { ref: refSha || null, binding_wk_tip_sha: binding.wk_tip_sha ?? null, committed_tip: committedTip, stage }
    );
  }
}

function retainsCreatedWkCapturedBase({ repo, receipts }) {
  const captured = receipts?.wk_captured_base;
  if (receipts?.wk?.reused !== false || !captured) return false;
  let resolved;
  try {
    resolved = resolveCapturedWkBase({ mainRepo: repo, unitAddress: captured.unit_address });
  } catch {

    return false;
  }
  return resolved !== null &&
    resolved.base_ref === captured.base_ref &&
    resolved.base_sha === captured.base_sha;
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
    if (kind === "wk" && retainsCreatedWkCapturedBase({ repo, receipts })) continue;
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

async function establishManagedWkLifecycleLocked({
  repo, initiative, wkId, subject, launchRef, runId, retryId, roots, deps,
  runGit, allocateOrAdoptWk, bindings, receipts, createdRoots
}) {
  const resolveGeneration = deps.resolveControlledContractGeneration
    ?? defaultResolveControlledContractGeneration;
  const resolveGenerationBinding = deps.resolveControlledContractGenerationBinding
    ?? defaultResolveControlledContractGenerationBinding;
  const persistGeneration = deps.persistControlledContractGeneration
    ?? defaultPersistControlledContractGeneration;
  const canonicalRecord = readLauncherAuthenticatedWorkRecord(repo, wkId);
  const { sliceId } = parseSubject(subject);
  const selectedUnit = sliceId === null ? canonicalRecord
    : canonicalRecord.slices?.find(({ id }) => id === sliceId) ?? null;
  if (selectedUnit === null) {
    fail(
      MANAGED_CONTROLLED_CONTRACT_GENERATION_DIAGNOSTIC_CODES.RECORD_UNREADABLE,
      "the exact canonical dispatch unit is absent from the work record",
      { issue: "controlled_acceptance_selected_unit_absent", record_id: wkId,
        slice_id: sliceId }
    );
  }
  const implementationContract = selectedUnit?.work_kind === "implementation";
  const classifyControlledAcceptance = deps.classifyControlledAcceptanceState
    ?? await loadDefaultClassifyControlledAcceptanceState();
  let controlledAcceptanceState;
  try {

    controlledAcceptanceState = await classifyControlledAcceptance({ repoRoot: repo, wkId,
      selectedUnit: sliceId, record: canonicalRecord });
  } catch (error) {
    const sourceCode = error?.code ?? "controlled_acceptance_internal_failure";
    fail(
      MANAGED_CONTROLLED_CONTRACT_GENERATION_DIAGNOSTIC_CODES.PROOF_POSTURE_INVALID,
      "the controlled-acceptance classifier failed internally",
      { issue: sourceCode, record_id: wkId,
        selected_unit: sliceId,
        recovery: null,
        failure_ownership: "system",
        responsible_owner: "classifyControlledAcceptanceStateOperation",
        source_code: sourceCode,
        source_details: structuredClone(error?.details ?? {}) },
      error
    );
  }
  try {
    assertControlledAcceptanceStateProjection(controlledAcceptanceState, wkId, sliceId);
  } catch (error) {
    fail(
      MANAGED_CONTROLLED_CONTRACT_GENERATION_DIAGNOSTIC_CODES.PROOF_POSTURE_INVALID,
      "the derived controlled-acceptance projection is malformed",
      { issue: "controlled_acceptance_state_invalid", record_id: wkId,
        selected_unit: sliceId,
        recovery: null,
        failure_ownership: "system",
        responsible_owner: "assertControlledAcceptanceStateProjection",
        source_code: error?.code ?? null },
      error
    );
  }

  if (implementationContract &&
      !controlledAcceptanceState.semantic.admission.admits) {
    const blockedReason = controlledAcceptanceState.semantic.admission.blocked_reason_code;
    const sourceNotCurrent = blockedReason === "controlled_acceptance_source_not_current";
    fail(
      controlledAcceptanceState.state === "absent"
        ? MANAGED_CONTROLLED_CONTRACT_GENERATION_DIAGNOSTIC_CODES.DISPOSITION_MISSING
        : sourceNotCurrent
          ? MANAGED_CONTROLLED_CONTRACT_GENERATION_DIAGNOSTIC_CODES
            .CONTROLLED_ACCEPTANCE_SOURCE_NOT_CURRENT
          : MANAGED_CONTROLLED_CONTRACT_GENERATION_DIAGNOSTIC_CODES.CONTROLLED_ACCEPTANCE_INCOMPLETE,
      controlledAcceptanceState.state === "absent"
        ? "the canonical proof posture has no controlled-acceptance disposition"
        : sourceNotCurrent
          ? "the authenticated controlled-acceptance source moved before provisioning"
          : controlledAcceptanceState.recovery?.explanation ??
            "the required controlled-acceptance contract is mechanically incomplete",
      {
        issue: blockedReason,
        record_id: wkId,
        initiative,
        controlled_acceptance_state: controlledAcceptanceState.state,
        controlled_acceptance_semantic: controlledAcceptanceState.semantic,
        recovery: controlledAcceptanceState.recovery
      }
    );
  }
  const generation = ["absent", "opted_out"].includes(controlledAcceptanceState.state)
    ? null : await resolveGeneration({ repoRoot: repo, wkId });
  if (generation === null && controlledAcceptanceState.state === "complete") {
    fail(
      MANAGED_CONTROLLED_CONTRACT_GENERATION_DIAGNOSTIC_CODES.GENERATION_REQUIRED_ABSENT,
      "the complete controlled-acceptance contract no longer resolves to its authenticated generation",
      { issue: "controlled_contract_generation_required_absent", record_id: wkId,
        initiative, controlled_acceptance_state: controlledAcceptanceState.state,
        controlled_contract_required: true }
    );
  }
  const resolvedAllocationGeneration = generation?.manifest_selection?.find(
    ({ focus }) => focus === null)?.generation ?? null;
  if (["complete", "incomplete"].includes(controlledAcceptanceState.state) &&
      generation !== null &&
      controlledAcceptanceState.generation !== resolvedAllocationGeneration) {
    fail(
      MANAGED_CONTROLLED_CONTRACT_GENERATION_DIAGNOSTIC_CODES.PROOF_POSTURE_INVALID,
      "the derived controlled-acceptance state and resolved carrier generation disagree",
      { issue: "controlled_acceptance_generation_identity_mismatch", record_id: wkId,
        initiative, projected_generation: controlledAcceptanceState.generation,
        resolved_generation: resolvedAllocationGeneration,
        recovery: controlledAcceptanceState.recovery }
    );
  }
  if (!existsSync(roots.worktreeRoot)) {
    mkdirSync(roots.worktreeRoot, { recursive: true, mode: 0o700 });
    createdRoots.unshift(roots.worktreeRoot);
  }
  let wkAllocation;
  try {
    wkAllocation = allocateOrAdoptWk({
      mainRepo: repo,
      unitAddress: `${initiative}/${wkId}`,
      launchRef,
      runId: bindingIdentity(runId, "wk"),
      retryId,
      worktreeRoot: roots.worktreeRoot,
      base: canonicalRecord.base_branch,
      deps: { ...deps, runGit }
    });
  } catch (error) {

    const requiredBaseFailure = error instanceof WorktreeSubstrateError &&
      error.code === WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.GIT_FAILED &&
      error.detail?.git_operation === "rev_parse_required_base_commit" &&
      error.detail?.repository_path === repo &&
      typeof error.detail?.required_ref === "string";
    const missingBaseSelection = error instanceof WorktreeSubstrateError &&
      error.code === WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_REF &&
      error.detail?.base_selection === "work_record.base_branch" &&
      (error.detail?.required_ref === null || error.detail?.required_ref === undefined);
    const branchProbe = requiredBaseFailure
      ? runGit({ repo, args: ["show-ref", "--verify", "--quiet", `refs/heads/${error.detail.required_ref}`] })
      : null;
    if (missingBaseSelection || (requiredBaseFailure && branchProbe?.ok === false && branchProbe.status === 1)) {
      throw new WorktreeSubstrateError(error.message, {
        code: WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.GIT_FAILED,
        cause: error,
        detail: Object.freeze({
          ...(error.detail ?? {}),
          failure_kind: missingBaseSelection
            ? "required_base_selection_missing"
            : "required_base_ref_missing",
          provisioning_stage: "pre_worker_worktree_provisioning",
          provisioning_operation: "base_ref_resolution",
          repository_path: repo,
          required_ref: error.detail?.required_ref ?? null,
          base_selection: Object.freeze({
            source: "work_record.base_branch",
            policy: "explicit_per_wk_branch"
          })
        })
      });
    }
    throw error;
  }
  bindings.wk = wkAllocation.binding;
  receipts.wk = wkAllocation.receipt;
  assertCompleteManagedBinding({
    binding: bindings.wk, repo, unitAddress: `${initiative}/${wkId}`, launchRef,
    runId: bindingIdentity(runId, "wk"), retryId,
    worktreeRoot: roots.worktreeRoot, sparse: false, runGit
  });

  receipts.wk_captured_base = Object.freeze({
    unit_address: bindings.wk.unit_address,
    base_ref: bindings.wk.base_ref,
    base_sha: bindings.wk.base_sha
  });

  if (generation !== null) {
    const generationBinding = await resolveGenerationBinding({
      repoRoot: repo, wkId, generation, lifecycleBinding: bindings.wk
    });
    const generationReceipt = await persistGeneration({ binding: generationBinding });
    const verifiedGenerationReceipt = admitVerifiedReceipt({
      runGit: defaultControlledContractGenerationRunGit,
      binding: generationBinding,
      receiptValue: generationReceipt
    });
    bindings.wk = rebindWkTip({
      repo, launchRef, runId, retryId, binding: bindings.wk,
      committedTip: verifiedGenerationReceipt.final_tip, deps,
      stage: "controlled-contract generation persistence"
    });
    assertCompleteManagedBinding({
      binding: bindings.wk, repo, unitAddress: `${initiative}/${wkId}`, launchRef,
      runId: bindingIdentity(runId, "wk"), retryId,
      worktreeRoot: roots.worktreeRoot, sparse: false, runGit
    });
    verifyPersistentWkRefCoherence({
      repo, binding: bindings.wk, committedTip: verifiedGenerationReceipt.final_tip,
      runGit, stage: "controlled-contract generation persistence"
    });
  }

  const snapshot = commitCurrentWorkRecordToWkBranch({
    repo, wkId, binding: bindings.wk, runGit, deps
  });
  const recordCommit = Object.freeze({
    ref: `refs/heads/${bindings.wk.output_branch}`,
    previous_tip: bindings.wk.wk_tip_sha,
    committed_tip: snapshot.committed_tip,
    owned: snapshot.owned
  });
  bindings.wk = rebindWkTip({
    repo, launchRef, runId, retryId, binding: bindings.wk,
    committedTip: snapshot.committed_tip, deps,
    stage: "dispatch-time record snapshot"
  });
  assertCompleteManagedBinding({
    binding: bindings.wk, repo, unitAddress: `${initiative}/${wkId}`, launchRef,
    runId: bindingIdentity(runId, "wk"), retryId,
    worktreeRoot: roots.worktreeRoot, sparse: false, runGit
  });
  verifyPersistentWkRefCoherence({
    repo, binding: bindings.wk, committedTip: snapshot.committed_tip,
    runGit, stage: "dispatch-time record snapshot"
  });
  return Object.freeze({ controlledAcceptanceState, generation, snapshot, recordCommit });
}

function managedWkLifecycleResult({
  repo, initiative, wkId, subject, launchRef, runId, retryId, roots,
  binding, controlledAcceptanceState, generation, snapshot
}) {
  return Object.freeze({
    schema_version: "managed-wk-lifecycle-allocation.v1",
    complete: true,
    main_repo: repo,
    initiative,
    record_id: wkId,
    subject,
    launch_ref: launchRef,
    run_id: runId,
    retry_id: retryId,
    worktree_root: roots.worktreeRoot,
    wk_binding: binding,
    controlled_acceptance_state: controlledAcceptanceState,
    controlled_contract_generation: generation,
    wk_snapshot: Object.freeze({
      ref: `refs/heads/${binding.output_branch}`,
      tip: snapshot.committed_tip,
      tree: snapshot.tree
    })
  });
}

export function authenticateManagedWkTipAtDispatch({
  mainRepo,
  initiative,
  subject,
  worktreeRoot,
  deps = {}
} = {}) {
  const repo = canonicalizeOwnedPath(mainRepo, "mainRepo", { mustExist: true });
  assertInitiativeId(initiative);
  const { wkId } = parseSubject(subject);
  const roots = Object.freeze({
    worktreeRoot: canonicalizeOwnedPath(worktreeRoot, "worktreeRoot")
  });
  assertDistinctOwnedRoots({ mainRepo: repo, ...roots });
  const name = deriveExactUnitName({
    unitAddress: `${initiative}/${wkId}`,
    worktreeRoot: roots.worktreeRoot
  });
  const runGit = deps.runGit ?? defaultRunGit;
  const observed = runGit({
    repo,
    args: ["show-ref", "--verify", "--hash", `refs/heads/${name.output_branch}`]
  });
  const sha = observed?.ok === true ? String(observed.stdout ?? "").trim() : "";
  if (!SNAPSHOT_OID_RE.test(sha) || /^0+$/u.test(sha)) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BINDING_INCOMPLETE,
      "persistent WK tip authentication failed",
      { stage: "pre_executor_wk_tip_authentication" }
    );
  }
  return Object.freeze({ base_ref: name.output_branch, base_sha: sha });
}

export async function provisionManagedWkLifecycleAtDispatch({
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
  const { wkId } = parseSubject(subject);
  if (!Number.isInteger(retryId) || retryId < 0) {
    fail(WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.INVALID_ARG, "retryId must be a non-negative integer");
  }
  const roots = Object.freeze({
    worktreeRoot: canonicalizeOwnedPath(worktreeRoot, "worktreeRoot")
  });
  assertDistinctOwnedRoots({ mainRepo: repo, ...roots });
  const runGit = deps.runGit ?? defaultRunGit;
  const allocateOrAdoptWk = deps.allocateOrAdoptExactUnitWorktree
    ?? defaultAllocateOrAdoptExactUnitWorktree;
  return withWkProvisioningLock({ repo, key: `${initiative}/${wkId}`, deps }, async () => {
    const bindings = { wk: null, slice: null };
    const receipts = { wk: null, slice: null };
    const createdRoots = [];
    let recordCommit = null;
    try {
      const established = await establishManagedWkLifecycleLocked({
        repo, initiative, wkId, subject, launchRef, runId, retryId, roots, deps,
        runGit, allocateOrAdoptWk, bindings, receipts, createdRoots
      });
      recordCommit = established.recordCommit;
      return managedWkLifecycleResult({
        repo, initiative, wkId, subject, launchRef, runId, retryId, roots,
        binding: bindings.wk,
        controlledAcceptanceState: established.controlledAcceptanceState,
        generation: established.generation,
        snapshot: established.snapshot
      });
    } catch (error) {
      compensateManagedAllocation({
        runGit, repo, launchRef, runId, retryId, bindings, receipts,
        createdRoots, recordCommit, cause: error
      });
      throw error;
    }
  });
}

export async function provisionManagedWorktreesAtDispatch({
  mainRepo,
  initiative,
  subject,
  launchRef,
  runId,
  retryId = 0,
  worktreeRoot,
  observeManagedWkLifecycle = null,
  deps = {}
} = {}) {
  const implementationDeps = { ...deps };
  delete implementationDeps.resolveCorrectiveContinuationProof;
  delete implementationDeps.corrective_continuation_proof;
  delete implementationDeps.trusted_corrective_findings_context;
  delete implementationDeps.launcher_exact_review_receipt;
  deps = implementationDeps;
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

  return withWkProvisioningLock({ repo, key: `${initiative}/${wkId}`, deps }, async () => {
    const bindings = { wk: null, slice: null };

    const receipts = { wk: null, slice: null };
    let recordCommit = null;
    const createdRoots = [];
    try {
      const established = await establishManagedWkLifecycleLocked({
        repo, initiative, wkId, subject, launchRef, runId, retryId, roots, deps,
        runGit, allocateOrAdoptWk, bindings, receipts, createdRoots
      });
      recordCommit = established.recordCommit;

      if (observeManagedWkLifecycle !== null) {
        if (typeof observeManagedWkLifecycle !== "function") {
          fail(
            WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.INVALID_ARG,
            "observeManagedWkLifecycle must be a function when supplied"
          );
        }
        observeManagedWkLifecycle(managedWkLifecycleResult({
          repo, initiative, wkId, subject, launchRef, runId, retryId, roots,
          binding: bindings.wk,
          controlledAcceptanceState: established.controlledAcceptanceState,
          generation: established.generation,
          snapshot: established.snapshot
        }));
      }

      const resolveAuthenticatedCurrentWkBase = () => Object.freeze({
        base_ref: bindings.wk.output_branch,
        base_sha: bindings.wk.wk_tip_sha
      });
      const earlyReconcile = classifyEarlySliceTip({
        mainRepo: repo,
        unitAddress: `${initiative}/${wkId}/${sliceId}`,
        worktreeRoot: roots.worktreeRoot,
        deps: {
          ...deps,
          runGit,

          resolveWkBranchTipBase: resolveAuthenticatedCurrentWkBase
        }
      });
      const sliceName = deriveExactUnitName({
        unitAddress: `${initiative}/${wkId}/${sliceId}`,
        worktreeRoot: roots.worktreeRoot
      });
      if (earlyReconcile.state === SLICE_TIP_RECONCILE_STATES.INTEGRATED) {
        const settledTip = reconcileContainedSliceWorktreeToCurrentW({
          runGit,
          repo,
          worktreePath: sliceName.worktree_path,
          branch: sliceName.output_branch,
          retainedTip: earlyReconcile.slice_tip,
          wkRef: bindings.wk.output_branch,
          currentWkTip: bindings.wk.wk_tip_sha
        });
        if (settledTip !== bindings.wk.wk_tip_sha) {
          fail(
            WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BINDING_INCOMPLETE,
            "the retained slice reconciliation returned a non-current execution binding",
            { issue: "retained_slice_settlement_not_current" }
          );
        }
      }
      const sliceBranchPresent = branchExists(runGit, repo, sliceName.output_branch);
      const sliceWorktreePresent = existsSync(sliceName.worktree_path);
      bindings.slice = allocateSlice({
        mainRepo: repo,
        unitAddress: `${initiative}/${wkId}/${sliceId}`,
        launchRef,
        runId: bindingIdentity(runId, "slice"),
        retryId,
        worktreeRoot: roots.worktreeRoot,
        deps: {
          ...deps,
          runGit,
          resolveWkBranchTipBase: resolveAuthenticatedCurrentWkBase
        }
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
      if (bindings.slice.base_ref !== bindings.wk.output_branch ||
          bindings.slice.base_sha !== bindings.wk.wk_tip_sha) {
        fail(
          WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BINDING_INCOMPLETE,
          "the exact slice execution binding must equal the authenticated current WK tip",
          {
            issue: "slice_execution_binding_not_current",
            mismatch_field: bindings.slice.base_ref !== bindings.wk.output_branch
              ? "slice_binding.base_ref"
              : "slice_binding.base_sha",
            expected: bindings.slice.base_ref !== bindings.wk.output_branch
              ? bindings.wk.output_branch
              : bindings.wk.wk_tip_sha,
            actual: bindings.slice.base_ref !== bindings.wk.output_branch
              ? bindings.slice.base_ref
              : bindings.slice.base_sha
          }
        );
      }

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
