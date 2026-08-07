

import { existsSync, lstatSync, mkdirSync, rmSync, unlinkSync } from "node:fs";

import {
  WORKTREE_SUBSTRATE_SCHEMA_VERSION,
  WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES,
  fail,
  assertOpaqueId,
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
  rollbackWorktreeAndBranch,
  defaultRunGit
} from "./worktree-substrate-primitives.mjs";

import {
  sliceBranchRef,
  sliceWorktreePath,
  deriveExactUnitName,
  resolveIndependentUnitBase,
  resolveWkBranchTipBase
} from "./worktree-substrate-exact-unit-identity.mjs";
import {
  canonicalWriteScope,
  canonicalUnitScopes,
  bindingFilePath,
  defaultWriteBindingFile,
  resolveVerifiedSparseExactUnitBinding
} from "./worktree-substrate-identity.mjs";

import {
  SLICE_TIP_RECONCILE_STATES,
  reconcileExistingSliceTip
} from "./worktree-substrate-exact-unit-reconcile.mjs";
import {
  wkForkRefName,
  ensureWkForkRefAtFork,
  rollbackCreatedWkForkRef,
  recoverFixedWkFork
} from "./worktree-substrate-exact-unit-fork-ref.mjs";

export { normalizeSparseConeDirs };

export {
  sliceBranchRef,
  sliceWorktreePath,
  deriveExactUnitName,
  resolveIndependentUnitBase,
  resolveWkBranchTipBase
};

export { SLICE_TIP_RECONCILE_STATES, wkForkRefName };
export {
  SLICE_TIP_RECONCILE_DIAGNOSTIC_CODES,
  CORRECTIVE_CONTINUATION_PROOF_SCHEMA_VERSION,
  SLICE_TIP_RECOVERY_ROUTES,
  classifyExistingSliceTipForDispatch
} from "./worktree-substrate-exact-unit-reconcile.mjs";
export { WK_FORK_REF_DIAGNOSTIC_CODES } from "./worktree-substrate-exact-unit-fork-ref.mjs";
export { allocateSparseExactUnitWorktree } from "./worktree-substrate-exact-unit-sparse.mjs";

const WORKTREE_IDENTITY_BINDING_SCHEMA_VERSION_V2 = "worktree-identity-binding.v2";
const WORKTREE_SLICE_CHECKOUT_MODE_FULL = "full";

function assertNonNegativeRetryId(retryId) {
  if (!Number.isInteger(retryId) || retryId < 0) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_ARG,
      "retryId must be a non-negative integer",
      { retry_id: retryId ?? null }
    );
  }
}

function compensateFullSliceAllocation({
  runGit,
  repo,
  worktreePath,
  branch,
  branchTip,
  branchCreated,
  worktreeAddAttempted,
  worktreeExistedBefore,
  worktreeCreated,
  bindingPath,
  bindingCreated,
  originalCause
}) {
  const failures = [];
  const bounded = (value) => String(value ?? "unknown").slice(0, 512);
  const recordFailure = (step, detail) => {
    if (failures.length < 12) failures.push({ step, detail: bounded(detail) });
  };
  const lstatPath = () => {
    try {
      return lstatSync(worktreePath);
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      recordFailure("worktree lstat", error?.message ?? error);
      return undefined;
    }
  };
  const registrations = () => {
    const result = runGit({ repo, args: ["worktree", "list", "--porcelain", "-z"] });
    if (!result || result.ok !== true) {
      recordFailure("worktree registration probe", result?.stderr ?? result?.error ?? result?.status);
      return null;
    }
    const records = [];
    let current = null;
    for (const token of String(result.stdout ?? "").split("\0")) {
      if (token.startsWith("worktree ")) {
        if (current !== null) records.push(current);
        current = { worktree: token.slice("worktree ".length), branch: null };
      } else if (current !== null && token.startsWith("branch ")) {
        current.branch = token.slice("branch ".length);
      }
    }
    if (current !== null) records.push(current);
    return records;
  };
  if (bindingCreated && bindingPath && existsSync(bindingPath)) {
    try { unlinkSync(bindingPath); } catch (err) {
      recordFailure("binding unlink", err?.message ?? err);
    }
  }

  let preserveBranch = false;
  const attemptedMissingTarget = worktreeAddAttempted && !worktreeExistedBefore;
  if (worktreeCreated) {
    const currentTip = branchExists(runGit, repo, branch)
      ? revParse(runGit, repo, branch)
      : null;
    if (currentTip !== null && currentTip !== branchTip) {
      preserveBranch = true;
      recordFailure("worktree ownership", "slice branch tip changed after allocation; registered or concurrent winner preserved");
    } else {
      const remove = runGit({ repo, args: ["worktree", "remove", "--force", worktreePath] });
      if (!remove || remove.ok !== true) {
        preserveBranch = true;
        recordFailure("worktree remove", remove?.stderr ?? remove?.error ?? remove?.status);
      }
    }
  } else if (attemptedMissingTarget) {
    const stat = lstatPath();
    const listed = registrations();
    const registeredAtTarget = listed?.find((entry) => entry.worktree === worktreePath);
    const registeredOnBranch = listed?.find((entry) => entry.branch === `refs/heads/${branch}`);
    if (stat?.isSymbolicLink()) {
      preserveBranch = true;
      recordFailure("worktree ownership", "attempt target is a symbolic link; preserved without following it");
    } else if (stat !== null && stat !== undefined && !stat.isDirectory()) {
      preserveBranch = true;
      recordFailure("worktree ownership", "attempt target is not an ordinary directory; possible concurrent winner preserved");
    } else if (registeredAtTarget || registeredOnBranch) {
      preserveBranch = true;
      recordFailure("worktree ownership", "registered worktree or concurrent winner appeared during failed add; preserved");
    } else if (listed !== null && stat?.isDirectory()) {

      const beforeRemove = lstatPath();
      if (beforeRemove?.isDirectory() && !beforeRemove.isSymbolicLink() &&
          beforeRemove.dev === stat.dev && beforeRemove.ino === stat.ino) {
        try { rmSync(worktreePath, { recursive: true, force: true }); } catch (err) {
          recordFailure("worktree directory removal", err?.message ?? err);
        }
      } else if (beforeRemove !== null) {
        preserveBranch = true;
        recordFailure("worktree ownership", "attempt target identity changed before removal; possible concurrent winner preserved");
      }
    }
  }
  if (worktreeCreated && !preserveBranch) {
    const remaining = lstatPath();
    if (remaining?.isSymbolicLink()) {
      preserveBranch = true;
      recordFailure("worktree directory removal", "remaining target is a symbolic link; preserved without following it");
    } else if (remaining?.isDirectory()) {
      try { rmSync(worktreePath, { recursive: true, force: true }); } catch (err) {
        recordFailure("worktree directory removal", err?.message ?? err);
      }
    } else if (remaining !== null && remaining !== undefined) {
      recordFailure("worktree directory removal", "remaining target is not an ordinary directory; preserved");
    }
  }
  if (branchCreated && !preserveBranch && branchExists(runGit, repo, branch)) {
    const del = runGit({
      repo,
      args: ["update-ref", "-d", `refs/heads/${branch}`, branchTip]
    });
    if (!del || del.ok !== true) {
      recordFailure("slice branch CAS delete", del?.stderr ?? del?.error ?? del?.status);
    }
  }
  if (failures.length > 0) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.ROLLBACK_FAILED,
      "full-checkout slice allocation rollback failed to fully compensate",
      {
        worktreePath,
        branch,
        compensationFailures: failures,
        originalError: bounded(originalCause?.message ?? originalCause),
        originalCode: originalCause?.code ?? null
      },
      originalCause
    );
  }
}

function assertFullWorktreePhysicalState(runGit, worktreePath) {
  for (const key of ["core.sparseCheckout", "core.sparseCheckoutCone", "index.sparse"]) {
    for (const scope of ["--local", "--worktree"]) {
      const result = runGit({ repo: worktreePath, args: ["config", scope, "--bool", key] });
      const worktreeScopeUnavailable = scope === "--worktree" && result?.status === 128;
      if (result && result.ok !== true && result.status !== 1 && !worktreeScopeUnavailable) {
        fail(
          WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.GIT_FAILED,
          "failed to verify full-checkout slice worktree configuration",
          { key, scope, status: result?.status ?? null, stderr: result?.stderr ?? null, error: result?.error ?? null }
        );
      }
      if (result?.ok === true && String(result.stdout ?? "").trim() === "true") {
        fail(
          WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.GIT_FAILED,
          "full-checkout slice worktree retains sparse configuration",
          { key, scope, value: "true" }
        );
      }
    }
  }

  const staged = gitOrThrow(
    runGit,
    worktreePath,
    ["ls-files", "--sparse", "--stage"],
    "failed to verify full-checkout slice index shape"
  ).stdout;
  const sparseDirectoryEntry = String(staged ?? "").split("\n")
    .find((line) => line.startsWith("040000 "));
  if (sparseDirectoryEntry) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.GIT_FAILED,
      "full-checkout slice index retains a sparse-directory entry",
      { index_entry: sparseDirectoryEntry }
    );
  }

  const tagged = gitOrThrow(
    runGit,
    worktreePath,
    ["ls-files", "--sparse", "-v"],
    "failed to verify full-checkout slice index materialization"
  ).stdout;
  const hiddenIndexEntry = String(tagged ?? "").split("\n")
    .find((line) => line.startsWith("S ") || /^[a-z] /.test(line));
  if (hiddenIndexEntry) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.GIT_FAILED,
      "full-checkout slice index retains skip-worktree or assume-unchanged state",
      { index_entry: hiddenIndexEntry }
    );
  }
}

export function allocateFullSliceExactUnitWorktree({
  mainRepo,
  unitAddress,
  launchRef,
  runId,
  retryId = 0,
  worktreeRoot,
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
  assertNonNegativeRetryId(retryId);
  const root = assertAbsolutePath(worktreeRoot, "worktreeRoot");
  assertWorktreeRootOutsideMainRepo(repo, root);
  const name = deriveExactUnitName({ unitAddress, worktreeRoot: root });
  if (name.kind !== "slice") {
    fail(WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_UNIT_ADDRESS, "full-checkout exact-unit allocation requires a slice unit_address");
  }
  const callerScopeCarriers = { readScope, repoPaths, writeScope, selectedUnit, sourceDigest, sourceVersion };
  const suppliedCarrier = Object.entries(callerScopeCarriers).find(([, value]) => value !== undefined);
  if (suppliedCarrier) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_ARG,
      `caller-supplied full-checkout authority is forbidden; ${suppliedCarrier[0]} must be resolved from the exact canonical selected unit server-side`
    );
  }
  const scopes = canonicalUnitScopes(repo, name.wk_id, name.slice_id, {
    expectedInitiative: name.initiative
  });
  const branch = name.output_branch;
  const worktreePath = name.worktree_path;
  const fullRef = assertRefFormat(runGit, repo, branch);
  assertStoreDisjointFromWorktree(repo, worktreePath);
  const branchPresent = branchExists(runGit, repo, branch);
  let worktreePresent;
  try {
    lstatSync(worktreePath);
    worktreePresent = true;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      fail(
        WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.GIT_FAILED,
        "failed to inspect deterministic slice worktree path without following links",
        { worktreePath, error: String(error?.message ?? error).slice(0, 512) },
        error
      );
    }
    worktreePresent = false;
  }
  if (!branchPresent && worktreePresent) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.TARGET_EXISTS,
      "slice worktree path exists without its deterministic slice branch",
      { slice_resource_state: "branch_absent_worktree_present", branch, worktreePath }
    );
  }
  if (!branchPresent) assertNoRefNamespaceCollision(enumerateRefs(runGit, repo), fullRef);
  const baseRef = `wk/${name.initiative}/${name.wk_id}`;
  const resolveWkTip = deps.resolveWkBranchTipBase ?? resolveWkBranchTipBase;

  const reconcile = branchPresent
    ? reconcileExistingSliceTip({
        runGit,
        repo,
        name,
        branch,
        worktreePath,
        resolveWkTip,
        resolveCorrectiveContinuationProof: deps.resolveCorrectiveContinuationProof
      })
    : Object.freeze({ state: SLICE_TIP_RECONCILE_STATES.ABSENT, slice_tip: null });
  const baseSha = branchPresent
    ? reconcile.slice_tip
    : resolveWkTip({
        mainRepo: repo,
        unitAddress: name.unit_address,
        deps: { runGit }
      }).base_sha;
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
  let worktreeCreated = false;
  let worktreeAddAttempted = false;
  let binding;
  try {

    if (!worktreePresent) {
      const addArgs = branchPresent
        ? ["worktree", "add", worktreePath, branch]
        : ["worktree", "add", "-b", branch, worktreePath, baseSha];
      worktreeAddAttempted = true;
      gitOrThrow(runGit, repo, addArgs, "failed to provision full-checkout exact-unit worktree/branch");
      worktreeCreated = true;
    } else {
      const association = gitOrThrow(
        runGit,
        worktreePath,
        ["symbolic-ref", "--quiet", "HEAD"],
        "failed to verify the existing full-checkout exact-unit worktree association"
      ).stdout.trim();
      if (association !== fullRef) {
        fail(
          WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.GIT_FAILED,
          "existing full-checkout exact-unit worktree is not attached to the deterministic slice branch",
          { expected: fullRef, actual: association || null, worktreePath }
        );
      }
    }
    const head = revParse(runGit, worktreePath, "HEAD");
    const branchTip = revParse(runGit, repo, branch);
    if (head !== baseSha || branchTip !== baseSha) {
      fail(
        WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.GIT_FAILED,
        "slice worktree HEAD and deterministic slice branch do not equal the selected continuation tip",
        { expected: baseSha, head, branch_tip: branchTip }
      );
    }
    assertFullWorktreePhysicalState(runGit, worktreePath);
    binding = Object.freeze({
      schema_version: WORKTREE_IDENTITY_BINDING_SCHEMA_VERSION_V2,
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
      checkout_mode: WORKTREE_SLICE_CHECKOUT_MODE_FULL
    });
    writeBindingFile({
      filePath: bindingPath,
      contents: `${JSON.stringify(binding, null, 2)}\n`,
      onCreated: () => { bindingCreated = true; }
    });
    bindingCreated = true;
    verifyBinding({ mainRepo: repo, launchRef, runId, retryId, expectedBinding: binding });
  } catch (err) {
    compensateFullSliceAllocation({
      runGit,
      repo,
      worktreePath,
      branch,
      branchTip: baseSha,
      branchCreated: !branchPresent,
      worktreeAddAttempted,
      worktreeExistedBefore: worktreePresent,
      worktreeCreated,
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
  assertNonNegativeRetryId(retryId);
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

  const isWk = name.kind === "wk";
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
    write_scope_source: writeScopeSource,
    ...(isWk ? { wk_tip_sha: baseSha } : {})
  });

  const forkRef = isWk ? wkForkRefName(name.initiative, wkId) : null;
  let forkRefReceipt = null;
  if (isWk) {
    try {
      forkRefReceipt = ensureWkForkRefAtFork(runGit, repo, forkRef, baseSha);
    } catch (forkErr) {
      rollbackWorktreeAndBranch(runGit, repo, worktreePath, branch, forkErr);
      throw forkErr;
    }
  }

  const filePath = bindingFilePath(repo, launchRef, runId, retryId);

  try {
    writeBindingFile({ filePath, contents: `${JSON.stringify(binding, null, 2)}\n` });
  } catch (storeErr) {
    if (forkRefReceipt?.created === true) rollbackCreatedWkForkRef(runGit, repo, forkRef, baseSha);
    rollbackWorktreeAndBranch(runGit, repo, worktreePath, branch, storeErr);
    throw storeErr;
  }

  return binding;
}

function assertNoRefNamespaceCollisionExceptSelf(existingRefs, targetFullRef) {
  assertNoRefNamespaceCollision(existingRefs.filter((existing) => existing !== targetFullRef), targetFullRef);
}

export function allocateOrAdoptExactUnitWorktree({
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
  assertNonNegativeRetryId(retryId);
  const root = assertAbsolutePath(worktreeRoot, "worktreeRoot");
  assertWorktreeRootOutsideMainRepo(repo, root);

  const name = deriveExactUnitName({ unitAddress, worktreeRoot: root });
  const branch = name.output_branch;
  const worktreePath = name.worktree_path;
  const fullRef = assertRefFormat(runGit, repo, branch);
  assertStoreDisjointFromWorktree(repo, worktreePath);

  const branchPresent = branchExists(runGit, repo, branch);
  const pathPresent = existsSync(worktreePath);

  if (!branchPresent && !pathPresent) {
    const binding = allocateExactUnitWorktree({
      mainRepo: repo, unitAddress, launchRef, runId, retryId, worktreeRoot: root, base, deps
    });
    return { binding, receipt: Object.freeze({ reused: false }) };
  }

  const refuse = (state, message, detail = {}) =>
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.TARGET_EXISTS,
      `adopt refused (${state}): ${message}`,
      { adopt_state: state, branch, worktreePath, ...detail }
    );

  if (name.kind !== "wk") {
    refuse("unexpected-slice-reuse", "a slice unit branch/worktree already exists", { unit_address: name.unit_address });
  }
  if (branchPresent && !pathPresent) refuse("branch-only", "WK branch exists without its persistent worktree");
  if (!branchPresent && pathPresent) refuse("path-only", "WK worktree path exists without the WK branch");

  const symref = runGit({ repo: worktreePath, args: ["symbolic-ref", "--quiet", "HEAD"] });
  const symHead = symref?.ok === true ? String(symref.stdout ?? "").trim() : null;
  if (symHead === null || symHead.length === 0) {
    refuse("detached-or-unregistered", "WK worktree HEAD is detached or the path is not a registered worktree");
  }
  if (symHead !== fullRef) {
    refuse("wrong-branch", "WK worktree is attached to a different branch", { attached_to: symHead });
  }

  const wkTipSha = revParse(runGit, repo, branch);
  const forkRef = wkForkRefName(name.initiative, name.wk_id);
  const baseSha = recoverFixedWkFork(runGit, repo, forkRef, wkTipSha);
  assertNoRefNamespaceCollisionExceptSelf(enumerateRefs(runGit, repo), fullRef);

  const { writeScope, source: writeScopeSource } = canonicalWriteScope(repo, name.wk_id, name.slice_id);

  const binding = Object.freeze({
    schema_version: WORKTREE_SUBSTRATE_SCHEMA_VERSION,
    launch_ref: launchRef,
    run_id: runId,
    retry_id: retryId,
    unit_address: name.unit_address,
    initiative: name.initiative,
    record_id: name.wk_id,
    slice_id: name.slice_id,
    base_ref: base,
    base_sha: baseSha,
    output_branch: branch,
    worktree_path: worktreePath,
    write_scope: writeScope,
    write_scope_source: writeScopeSource,
    wk_tip_sha: wkTipSha
  });

  const filePath = bindingFilePath(repo, launchRef, runId, retryId);
  try {
    writeBindingFile({ filePath, contents: `${JSON.stringify(binding, null, 2)}\n` });
  } catch (storeErr) {

    if (existsSync(filePath)) {
      try { unlinkSync(filePath); } catch {   }
    }
    throw storeErr;
  }

  return { binding, receipt: Object.freeze({ reused: true }) };
}
