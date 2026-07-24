

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

export { normalizeSparseConeDirs };

export {
  sliceBranchRef,
  sliceWorktreePath,
  deriveExactUnitName,
  resolveIndependentUnitBase,
  resolveWkBranchTipBase
};

const WORKTREE_IDENTITY_BINDING_SCHEMA_VERSION_V2 = "worktree-identity-binding.v2";
const WORKTREE_SLICE_CHECKOUT_MODE_FULL = "full";

export const SLICE_TIP_RECONCILE_DIAGNOSTIC_CODES = Object.freeze({
  SLICE_TIP_RECONCILE_REQUIRED: "agent_launch.worktree_substrate.slice_tip_reconcile_required.v1"
});

export const SLICE_TIP_RECONCILE_STATES = Object.freeze({
  ABSENT: "absent",
  EQUAL: "equal",
  INTEGRATED: "integrated",
  AUTHENTICATED_CONTINUATION: "authenticated_continuation",
  ORPHANED: "orphaned",
  WK_BASE_UNRESOLVED: "wk_base_unresolved"
});

export const CORRECTIVE_CONTINUATION_PROOF_SCHEMA_VERSION =
  "workspace-agent-corrective-continuation-proof.v1";

const OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const CORRECTIVE_CONTINUATION_PROOF_FIELDS = Object.freeze([
  "schema_version", "subject", "unit_address", "slice_ref", "frozen_base_sha",
  "delivered_tip_sha", "commit_chain", "committed_target_digest", "worktree_path"
]);

export const SLICE_TIP_RECOVERY_ROUTES = Object.freeze({
  EXACT_SLICE_REVIEW_RECOVERY: "exact_slice_review_recovery",
  OPERATOR_RECONCILE: "operator_reconcile"
});

function reconcileRefusal(state, message, detail) {
  fail(
    SLICE_TIP_RECONCILE_DIAGNOSTIC_CODES.SLICE_TIP_RECONCILE_REQUIRED,
    message,
    Object.freeze({ reconcile_state: state, ...detail })
  );
}

function classifyExistingSliceTip({ runGit, repo, branch, wkBaseSha }) {
  const sliceTip = revParse(runGit, repo, branch);
  if (sliceTip === wkBaseSha) {
    return Object.freeze({ state: SLICE_TIP_RECONCILE_STATES.EQUAL, slice_tip: sliceTip });
  }
  const contained = runGit({ repo, args: ["merge-base", "--is-ancestor", sliceTip, wkBaseSha] });
  if (contained?.ok === true) {
    return Object.freeze({ state: SLICE_TIP_RECONCILE_STATES.INTEGRATED, slice_tip: sliceTip });
  }
  if (!contained || contained.status !== 1) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.GIT_FAILED,
      "failed to determine whether the existing slice tip is contained in the canonical WK base",
      {
        branch,
        slice_tip: sliceTip,
        wk_base_sha: wkBaseSha,
        status: contained?.status ?? null,
        stderr: contained?.stderr ?? null,
        error: contained?.error ?? null
      }
    );
  }
  return Object.freeze({ state: SLICE_TIP_RECONCILE_STATES.ORPHANED, slice_tip: sliceTip });
}

function hasExactKeys(value, expected) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join("|") === [...expected].sort().join("|");
}

function authenticateCorrectiveContinuation({
  runGit,
  repo,
  name,
  branch,
  worktreePath,
  wkBaseSha,
  sliceTip,
  resolveProof
}) {
  if (typeof resolveProof !== "function") return null;
  const expectedSubject = `${name.wk_id}#${name.slice_id}`;
  const expectedSliceRef = `refs/heads/${branch}`;
  let proof;
  try {
    proof = resolveProof(Object.freeze({
      subject: expectedSubject,
      unit_address: name.unit_address,
      slice_ref: expectedSliceRef,
      slice_tip: sliceTip,
      worktree_path: worktreePath
    }));
  } catch {
    return null;
  }
  if (!hasExactKeys(proof, CORRECTIVE_CONTINUATION_PROOF_FIELDS) ||
      proof.schema_version !== CORRECTIVE_CONTINUATION_PROOF_SCHEMA_VERSION ||
      proof.subject !== expectedSubject || proof.unit_address !== name.unit_address ||
      proof.slice_ref !== expectedSliceRef || proof.delivered_tip_sha !== sliceTip ||
      proof.worktree_path !== worktreePath || !OID_RE.test(proof.frozen_base_sha ?? "") ||
      !OID_RE.test(proof.delivered_tip_sha ?? "") ||
      typeof proof.committed_target_digest !== "string" ||
      !/^sha256:[0-9a-f]{64}$/u.test(proof.committed_target_digest) ||
      !Array.isArray(proof.commit_chain) || proof.commit_chain.length === 0 ||
      proof.commit_chain.some((commit) => !OID_RE.test(commit))) {
    return null;
  }

  const baseRetained = runGit({
    repo,
    args: ["merge-base", "--is-ancestor", proof.frozen_base_sha, wkBaseSha]
  });
  if (!baseRetained || (baseRetained.ok !== true && baseRetained.status !== 1)) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.GIT_FAILED,
      "failed to verify that the authenticated delivery base remains in the canonical WK chain",
      { frozen_base_sha: proof.frozen_base_sha, wk_base_sha: wkBaseSha }
    );
  }
  if (baseRetained.ok !== true) return null;

  const range = runGit({
    repo,
    args: ["rev-list", "--reverse", "--parents", `${proof.frozen_base_sha}..${sliceTip}`]
  });
  if (range?.ok !== true) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.GIT_FAILED,
      "failed to verify the authenticated corrective delivery chain",
      { frozen_base_sha: proof.frozen_base_sha, slice_tip: sliceTip }
    );
  }
  const lines = String(range.stdout ?? "").trim().split("\n").filter(Boolean);
  if (lines.length !== proof.commit_chain.length) return null;
  let expectedParent = proof.frozen_base_sha;
  for (let index = 0; index < lines.length; index += 1) {
    const parts = lines[index].trim().split(/\s+/u);
    if (parts.length !== 2 || parts[0] !== proof.commit_chain[index] ||
        parts[1] !== expectedParent) return null;
    const message = runGit({ repo, args: ["show", "-s", "--format=%B", parts[0]] });
    if (message?.ok !== true) {
      fail(
        WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.GIT_FAILED,
        "failed to verify a corrective delivery commit identity",
        { commit: parts[0] }
      );
    }
    const expectedMessage =
      `agent-launch worker delivery: ${expectedSubject} (base ${expectedParent.slice(0, 12)})` +
      `\n\nWk-Slice: ${expectedSubject}`;
    if (String(message.stdout ?? "").trimEnd() !== expectedMessage) return null;
    expectedParent = parts[0];
  }
  if (expectedParent !== sliceTip || !existsSync(worktreePath)) return null;
  const association = runGit({ repo: worktreePath, args: ["symbolic-ref", "--quiet", "HEAD"] });
  if (association?.ok !== true || String(association.stdout ?? "").trim() !== expectedSliceRef) return null;
  if (revParse(runGit, worktreePath, "HEAD") !== sliceTip ||
      revParse(runGit, repo, branch) !== sliceTip) return null;

  return Object.freeze({
    state: SLICE_TIP_RECONCILE_STATES.AUTHENTICATED_CONTINUATION,
    slice_tip: sliceTip,
    authenticated_base_sha: proof.frozen_base_sha,
    committed_target_digest: proof.committed_target_digest
  });
}

function reconcileExistingSliceTip({
  runGit,
  repo,
  name,
  branch,
  worktreePath,
  resolveWkTip,
  resolveCorrectiveContinuationProof
}) {
  let wkBase;
  try {
    wkBase = resolveWkTip({ mainRepo: repo, unitAddress: name.unit_address, deps: { runGit } });
  } catch (error) {

    reconcileRefusal(
      SLICE_TIP_RECONCILE_STATES.WK_BASE_UNRESOLVED,
      "the canonical WK-derived base could not be resolved, so an existing slice tip cannot be reconciled",
      {
        branch,
        unit_address: name.unit_address,
        recovery_route: SLICE_TIP_RECOVERY_ROUTES.OPERATOR_RECONCILE,
        cause: error?.message ?? String(error)
      }
    );
  }
  const wkBaseSha = wkBase?.base_sha ?? null;
  if (typeof wkBaseSha !== "string" || wkBaseSha.length === 0) {
    reconcileRefusal(
      SLICE_TIP_RECONCILE_STATES.WK_BASE_UNRESOLVED,
      "the canonical WK-derived base resolver returned no base_sha for an existing slice branch",
      {
        branch,
        unit_address: name.unit_address,
        recovery_route: SLICE_TIP_RECOVERY_ROUTES.OPERATOR_RECONCILE
      }
    );
  }
  const classified = classifyExistingSliceTip({ runGit, repo, branch, wkBaseSha });
  if (classified.state === SLICE_TIP_RECONCILE_STATES.ORPHANED) {
    const authenticated = authenticateCorrectiveContinuation({
      runGit,
      repo,
      name,
      branch,
      worktreePath,
      wkBaseSha,
      sliceTip: classified.slice_tip,
      resolveProof: resolveCorrectiveContinuationProof
    });
    if (authenticated !== null) {
      return Object.freeze({
        ...authenticated,
        wk_base_ref: wkBase.base_ref,
        wk_base_sha: wkBaseSha
      });
    }

    reconcileRefusal(
      SLICE_TIP_RECONCILE_STATES.ORPHANED,
      "the existing slice tip carries commits that the canonical WK base does not contain; " +
        "an unreviewed delivery is never a continuation base and never authorizes another worker",
      {
        branch,
        unit_address: name.unit_address,
        slice_tip: classified.slice_tip,
        wk_base_ref: wkBase.base_ref,
        wk_base_sha: wkBaseSha,
        recovery_route: SLICE_TIP_RECOVERY_ROUTES.EXACT_SLICE_REVIEW_RECOVERY
      }
    );
  }
  return Object.freeze({ ...classified, wk_base_ref: wkBase.base_ref, wk_base_sha: wkBaseSha });
}

export function classifyExistingSliceTipForDispatch({
  mainRepo,
  unitAddress,
  worktreeRoot,
  deps = {}
} = {}) {
  const runGit = deps.runGit ?? defaultRunGit;
  const repo = assertAbsolutePath(mainRepo, "mainRepo");
  const root = assertAbsolutePath(worktreeRoot, "worktreeRoot");
  const name = deriveExactUnitName({ unitAddress, worktreeRoot: root });
  if (name.kind !== "slice") {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_UNIT_ADDRESS,
      "early slice-tip reconciliation requires a slice unit_address"
    );
  }
  const branch = name.output_branch;

  if (!branchExists(runGit, repo, branch)) {
    return Object.freeze({ state: SLICE_TIP_RECONCILE_STATES.ABSENT, slice_tip: null });
  }
  const resolveWkTip = deps.resolveWkBranchTipBase ?? resolveWkBranchTipBase;
  const source = deps.resolveCorrectiveContinuationProof;
  let capturedProof = null;
  const capturingResolver = typeof source === "function"
    ? (proofContext) => {
        const proof = source(proofContext);
        if (proof != null) capturedProof = proof;
        return proof;
      }
    : undefined;
  const verdict = reconcileExistingSliceTip({
    runGit,
    repo,
    name,
    branch,
    worktreePath: name.worktree_path,
    resolveWkTip,
    resolveCorrectiveContinuationProof: capturingResolver
  });
  if (verdict.state === SLICE_TIP_RECONCILE_STATES.AUTHENTICATED_CONTINUATION && capturedProof !== null) {
    return Object.freeze({ ...verdict, corrective_continuation_proof: capturedProof });
  }
  return verdict;
}

function assertNonNegativeRetryId(retryId) {
  if (!Number.isInteger(retryId) || retryId < 0) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_ARG,
      "retryId must be a non-negative integer",
      { retry_id: retryId ?? null }
    );
  }
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

function compensateFullSliceAllocation({
  runGit,
  repo,
  worktreePath,
  branch,
  branchTip,
  branchCreated,
  worktreeCreated,
  bindingPath,
  bindingCreated,
  originalCause
}) {
  const failures = [];
  if (bindingCreated && bindingPath && existsSync(bindingPath)) {
    try { unlinkSync(bindingPath); } catch (err) {
      failures.push({ step: "binding unlink", detail: err?.message ?? String(err) });
    }
  }
  if (worktreeCreated && existsSync(worktreePath)) {
    const remove = runGit({ repo, args: ["worktree", "remove", "--force", worktreePath] });
    if (!remove || remove.ok !== true) {
      failures.push({ step: "worktree remove", detail: remove?.stderr ?? remove?.error ?? remove?.status });
    }
  } else if (worktreeCreated) {
    const prune = runGit({ repo, args: ["worktree", "prune"] });
    if (!prune || prune.ok !== true) failures.push({ step: "worktree prune", detail: prune?.stderr ?? prune?.error ?? prune?.status });
  }
  if (branchCreated && branchExists(runGit, repo, branch)) {
    const del = runGit({
      repo,
      args: ["update-ref", "-d", `refs/heads/${branch}`, branchTip]
    });
    if (!del || del.ok !== true) {
      failures.push({ step: "slice branch CAS delete", detail: del?.stderr ?? del?.error ?? del?.status });
    }
  }
  if (worktreeCreated && existsSync(worktreePath)) {
    try { rmSync(worktreePath, { recursive: true, force: true }); } catch (err) {
      failures.push({ step: "worktree directory removal", detail: err?.message ?? String(err) });
    }
  }
  if (failures.length > 0) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.ROLLBACK_FAILED,
      "full-checkout slice allocation rollback failed to fully compensate",
      { worktreePath, branch, compensationFailures: failures, originalError: originalCause?.message ?? String(originalCause) },
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
  const worktreePresent = existsSync(worktreePath);
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
  let binding;
  try {

    if (!worktreePresent) {
      const addArgs = branchPresent
        ? ["worktree", "add", worktreePath, branch]
        : ["worktree", "add", "-b", branch, worktreePath, baseSha];
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
      worktreeCreated,
      bindingPath,
      bindingCreated,
      originalCause: err
    });
    throw err;
  }
  return binding;
}

export const WK_FORK_REF_DIAGNOSTIC_CODES = Object.freeze({
  WK_FORK_REF_MISSING: "agent_launch.worktree_substrate.wk_fork_ref_missing.v1",
  WK_FORK_REF_DISAGREEMENT: "agent_launch.worktree_substrate.wk_fork_ref_disagreement.v1",
  WK_FORK_REF_INVALID: "agent_launch.worktree_substrate.wk_fork_ref_invalid.v1"
});

export function wkForkRefName(initiative, wkId) {
  return `refs/agent-launch/wk-forks/${initiative}/${wkId}`;
}

function resolveWkForkRef(runGit, repo, ref) {
  const res = runGit({ repo, args: ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`] });
  if (!res || res.ok !== true) return null;
  const sha = String(res.stdout ?? "").trim();
  return OID_RE.test(sha) ? sha : null;
}

function ensureWkForkRefAtFork(runGit, repo, ref, forkSha) {
  const existing = resolveWkForkRef(runGit, repo, ref);
  if (existing === forkSha) return { created: false };
  if (existing !== null) {
    fail(
      WK_FORK_REF_DIAGNOSTIC_CODES.WK_FORK_REF_DISAGREEMENT,
      "the launcher-owned WK fork ref disagrees with the fork being recorded",
      { fork_ref: ref, expected_fork: forkSha, actual_fork: existing }
    );
  }
  const res = runGit({ repo, args: ["update-ref", ref, forkSha, ""] });
  if (!res || res.ok !== true) {

    const raced = resolveWkForkRef(runGit, repo, ref);
    if (raced === forkSha) return { created: false };
    fail(
      WK_FORK_REF_DIAGNOSTIC_CODES.WK_FORK_REF_DISAGREEMENT,
      "failed to create the launcher-owned WK fork ref and it does not match the fork",
      { fork_ref: ref, expected_fork: forkSha, actual_fork: raced, status: res?.status ?? null }
    );
  }
  return { created: true };
}

function rollbackCreatedWkForkRef(runGit, repo, ref, forkSha) {
  try { runGit({ repo, args: ["update-ref", "-d", ref, forkSha] }); } catch {   }
}

function recoverFixedWkFork(runGit, repo, ref, currentWkTip) {
  const fork = resolveWkForkRef(runGit, repo, ref);
  if (fork === null) {
    fail(
      WK_FORK_REF_DIAGNOSTIC_CODES.WK_FORK_REF_MISSING,
      "the persistent WK branch has no launcher-owned fork ref; the original WK fork must be recorded before this WK can be adopted",
      {
        fork_ref: ref,
        operator_remediation:
          `record the original WK fork commit at ${ref} (git update-ref ${ref} <original-fork-sha>) before re-dispatching; the fork is never inferred from main, the current WK tip, a merge-base, or reflog`
      }
    );
  }
  const ancestor = runGit({ repo, args: ["merge-base", "--is-ancestor", fork, currentWkTip] });
  if (!ancestor || ancestor.ok !== true) {
    fail(
      WK_FORK_REF_DIAGNOSTIC_CODES.WK_FORK_REF_INVALID,
      "the launcher-owned WK fork is not an ancestor of the current WK tip",
      { fork_ref: ref, fork, wk_tip: currentWkTip }
    );
  }
  return fork;
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
