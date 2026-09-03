

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import {
  WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES,
  fail,
  assertAbsolutePath,
  branchExists,
  revParse,
  defaultRunGit,
  worktreeIdentityStoreDir
} from "./worktree-substrate-primitives.mjs";
import {
  deriveExactUnitName,
  resolveWkBranchTipBase
} from "./worktree-substrate-exact-unit-identity.mjs";
import {
  bindingFilePath,
  resolveVerifiedSparseExactUnitBinding
} from "./worktree-substrate-identity.mjs";

export const SLICE_TIP_RECONCILE_DIAGNOSTIC_CODES = Object.freeze({
  SLICE_TIP_RECONCILE_REQUIRED: "agent_launch.worktree_substrate.slice_tip_reconcile_required.v1"
});

export const SLICE_TIP_RECONCILE_STATES = Object.freeze({
  ABSENT: "absent",
  EQUAL: "equal",
  INTEGRATED: "integrated",
  ACCUMULATED_IMPLEMENTATION_TIP: "accumulated_implementation_tip",
  ORPHANED: "orphaned",
  WK_BASE_UNRESOLVED: "wk_base_unresolved"
});

export const SLICE_TIP_RECOVERY_ROUTES = Object.freeze({
  EXACT_SLICE_REVIEW_RECOVERY: "exact_slice_review_recovery",
  OPERATOR_RECONCILE: "operator_reconcile"
});

const BINDING_FILE_RE = /^binding-[0-9a-f]{64}\.json$/u;

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

function implementationBindingCandidates(repo, unitAddress) {
  const store = worktreeIdentityStoreDir(repo);
  let entries;
  try {
    entries = readdirSync(store, { withFileTypes: true })
      .filter((entry) => entry.isFile() && BINDING_FILE_RE.test(entry.name));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.BINDING_NOT_FOUND,
      "launcher-owned implementation binding store is unreadable",
      { store, errno: error?.code ?? null }
    );
  }
  const candidates = [];
  for (const entry of entries) {
    const filePath = path.join(store, entry.name);
    let binding;
    try {
      binding = JSON.parse(readFileSync(filePath, "utf8"));
    } catch (error) {
      fail(
        WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.BINDING_NOT_FOUND,
        "launcher-owned implementation binding is unreadable or malformed",
        { file_path: filePath, error: error?.message ?? String(error) }
      );
    }
    if (binding?.unit_address !== unitAddress) continue;
    const expectedPath = bindingFilePath(
      repo,
      binding.launch_ref,
      binding.run_id,
      binding.retry_id
    );
    if (expectedPath !== filePath) {
      fail(
        WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.BINDING_NOT_FOUND,
        "launcher-owned implementation binding is stored under the wrong identity",
        { file_path: filePath, expected_path: expectedPath }
      );
    }
    candidates.push(resolveVerifiedSparseExactUnitBinding({
      mainRepo: repo,
      launchRef: binding.launch_ref,
      runId: binding.run_id,
      retryId: binding.retry_id,
      expectedBinding: binding
    }));
  }
  return candidates;
}

function gitAncestor(runGit, repo, ancestor, descendant, detail) {
  const result = runGit({ repo, args: ["merge-base", "--is-ancestor", ancestor, descendant] });
  if (result?.ok === true) return true;
  if (result?.status === 1) return false;
  fail(
    WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.GIT_FAILED,
    "failed to authenticate implementation ancestry",
    { ...detail, ancestor, descendant, status: result?.status ?? null, stderr: result?.stderr ?? null }
  );
}

function exactLinearDeliveryDistance(runGit, repo, base, tip) {
  const result = runGit({ repo, args: ["rev-list", "--count", base + ".." + tip] });
  if (result?.ok !== true || !/^\d+$/u.test(String(result?.stdout ?? "").trim())) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.GIT_FAILED,
      "failed to measure launcher-owned implementation delivery ancestry",
      { base_sha: base, slice_tip: tip, status: result?.status ?? null }
    );
  }
  return Number(String(result.stdout).trim());
}

function authenticateAccumulatedImplementationTip({
  runGit,
  repo,
  name,
  branch,
  worktreePath,
  wkBaseSha,
  sliceTip
}) {
  const expectedSubject = name.wk_id + "#" + name.slice_id;
  const expectedSliceRef = "refs/heads/" + branch;
  const candidates = implementationBindingCandidates(repo, name.unit_address)
    .filter((binding) => binding.output_branch === branch &&
      binding.worktree_path === worktreePath &&
      binding.record_id === name.wk_id && binding.slice_id === name.slice_id)
    .filter((binding) => gitAncestor(runGit, repo, binding.base_sha, wkBaseSha, {
      unit_address: name.unit_address,
      boundary: "controlled_generation_tip"
    }) && gitAncestor(runGit, repo, binding.base_sha, sliceTip, {
      unit_address: name.unit_address,
      boundary: "accumulated_implementation_tip"
    }))
    .map((binding) => ({
      binding,
      distance: exactLinearDeliveryDistance(runGit, repo, binding.base_sha, sliceTip)
    }))
    .sort((left, right) => left.distance - right.distance ||
      left.binding.base_sha.localeCompare(right.binding.base_sha));
  if (candidates.length === 0) return null;
  const nearest = candidates.filter((entry) => entry.distance === candidates[0].distance);
  if (new Set(nearest.map((entry) => entry.binding.base_sha)).size !== 1) return null;
  const binding = nearest[0].binding;
  const range = runGit({
    repo,
    args: ["rev-list", "--reverse", "--parents", binding.base_sha + ".." + sliceTip]
  });
  if (range?.ok !== true) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.GIT_FAILED,
      "failed to read the accumulated implementation delivery chain",
      { base_sha: binding.base_sha, slice_tip: sliceTip }
    );
  }
  const lines = String(range.stdout ?? "").trim().split("\n").filter(Boolean);
  if (lines.length === 0) return null;
  let expectedParent = binding.base_sha;
  for (const line of lines) {
    const parts = line.trim().split(/\s+/u);
    if (parts.length !== 2 || parts[1] !== expectedParent) return null;
    const message = runGit({ repo, args: ["show", "-s", "--format=%B", parts[0]] });
    if (message?.ok !== true) {
      fail(
        WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.GIT_FAILED,
        "failed to verify a launcher-owned implementation delivery commit",
        { commit: parts[0] }
      );
    }
    const expectedMessage =
      "agent-launch worker delivery: " + expectedSubject +
      " (base " + expectedParent.slice(0, 12) + ")" +
      "\n\nWk-Slice: " + expectedSubject;
    if (String(message.stdout ?? "").trimEnd() !== expectedMessage) return null;
    expectedParent = parts[0];
  }
  if (expectedParent !== sliceTip || !existsSync(worktreePath)) return null;
  const association = runGit({ repo: worktreePath, args: ["symbolic-ref", "--quiet", "HEAD"] });
  if (association?.ok !== true || String(association.stdout ?? "").trim() !== expectedSliceRef) {
    return null;
  }
  if (revParse(runGit, worktreePath, "HEAD") !== sliceTip ||
      revParse(runGit, repo, branch) !== sliceTip) {
    return null;
  }
  return Object.freeze({
    state: SLICE_TIP_RECONCILE_STATES.ACCUMULATED_IMPLEMENTATION_TIP,
    slice_tip: sliceTip,
    authenticated_base_sha: binding.base_sha,
    implementation_binding: Object.freeze({
      launch_ref: binding.launch_ref,
      run_id: binding.run_id,
      retry_id: binding.retry_id,
      source_digest: binding.source_digest,
      worktree_path: binding.worktree_path
    })
  });
}

export function reconcileExistingSliceTip({
  runGit,
  repo,
  name,
  branch,
  worktreePath,
  resolveWkTip
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
    const authenticated = authenticateAccumulatedImplementationTip({
      runGit, repo, name, branch, worktreePath, wkBaseSha,
      sliceTip: classified.slice_tip
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
  return reconcileExistingSliceTip({
    runGit,
    repo,
    name,
    branch,
    worktreePath: name.worktree_path,
    resolveWkTip
  });
}
