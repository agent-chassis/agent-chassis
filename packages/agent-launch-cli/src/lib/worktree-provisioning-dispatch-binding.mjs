

import path from "node:path";
import { existsSync, lstatSync, realpathSync } from "node:fs";

import {
  assertManagedBindingShape,
  assertManagedProvisioningResultShape,
  bindingIdentity as coreBindingIdentity,
  discriminateManagedSliceCheckoutMode,
  isPathWithinRoot,
  assertDistinctManagedRoots,
  MANAGED_SLICE_CHECKOUT_MODE_FULL as CORE_MANAGED_SLICE_CHECKOUT_MODE_FULL,
  MANAGED_WORKTREE_BINDING_SCHEMA_VERSION as CORE_MANAGED_WORKTREE_BINDING_SCHEMA_VERSION
} from "@agent-chassis/agent-launch-core/src/lib/managed-provisioning-result-shape.mjs";
import {
  assertStructuralManagedProvisioningResult
} from "@agent-chassis/agent-launch-core/src/lib/managed-provisioning-result-assertion.mjs";

import { defaultRunGit } from "./worktree-substrate.mjs";
import {
  WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES,
  fail,
  assertAbsolutePath
} from "./worktree-provisioning-dispatch-constants.mjs";

export { assertStructuralManagedProvisioningResult };

export const MANAGED_WORKTREE_BINDING_SCHEMA_VERSION =
  CORE_MANAGED_WORKTREE_BINDING_SCHEMA_VERSION;

export const MANAGED_SLICE_CHECKOUT_MODE_FULL = CORE_MANAGED_SLICE_CHECKOUT_MODE_FULL;

function pathEntryExists(candidate) {
  try { lstatSync(candidate); return true; } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export function canonicalizeOwnedPath(candidate, label, { mustExist = false } = {}) {
  const absolute = path.resolve(assertAbsolutePath(candidate, label));
  const parsed = path.parse(absolute);
  let cursor = parsed.root;
  for (const component of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, component);
    if (!pathEntryExists(cursor)) break;
    const stat = lstatSync(cursor);
    if (stat.isSymbolicLink()) {
      fail(
        WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.ROOT_REFUSED,
        `${label} contains a symlink component`,
        { label, path: absolute, component: cursor }
      );
    }
  }
  if (mustExist && !pathEntryExists(absolute)) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.ROOT_REFUSED,
      `${label} does not exist`,
      { label, path: absolute }
    );
  }
  if (existsSync(absolute)) return realpathSync(absolute);
  let ancestor = path.dirname(absolute);
  const suffix = [path.basename(absolute)];
  while (!existsSync(ancestor)) {
    suffix.unshift(path.basename(ancestor));
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  return path.join(realpathSync(ancestor), ...suffix);
}

export function assertDistinctOwnedRoots(roots) {
  return assertDistinctManagedRoots(roots, fail);
}

export function bindingIdentity(runId, kind) {
  return coreBindingIdentity(runId, kind);
}

function canonicalizeContainedPath(candidate, label, root, { mustExist = true } = {}) {
  const canonical = canonicalizeOwnedPath(candidate, label, { mustExist });
  if (!isPathWithinRoot(canonical, root)) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BINDING_INCOMPLETE,
      `${label} escapes its launcher-owned canonical root`,
      { label, path: canonical, root }
    );
  }
  return canonical;
}

const physicalRootCanonicalizer = (candidate, label) =>
  canonicalizeOwnedPath(candidate, label, { mustExist: true });

const physicalBindingWorktreeCanonicalizer = (candidate, label, root) =>
  canonicalizeContainedPath(candidate, label, root);

function physicalBindingCoherence(runGit) {
  return ({ binding, repo, worktree, sparse }) => {
    const head = runGit({ repo: worktree, args: ["rev-parse", "--verify", "HEAD^{commit}"] });
    const ref = runGit({ repo, args: ["rev-parse", "--verify", `${binding.output_branch}^{commit}`] });
    const headSha = head?.ok === true ? String(head.stdout ?? "").trim() : "";
    const refSha = ref?.ok === true ? String(ref.stdout ?? "").trim() : "";

    const expectedTip = sparse ? binding.base_sha : binding.wk_tip_sha;
    if (!headSha || headSha !== refSha || headSha !== expectedTip) {
      fail(
        WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BINDING_INCOMPLETE,
        sparse
          ? "exact-unit worktree HEAD, bound ref, and commit base do not match"
          : "WK worktree HEAD, bound ref, and moving wk_tip_sha do not match",
        {
          head: headSha || null,
          ref: refSha || null,
          base_sha: binding.base_sha ?? null,
          wk_tip_sha: sparse ? undefined : (binding.wk_tip_sha ?? null)
        }
      );
    }

    if (!sparse) {
      const ancestor = runGit({
        repo,
        args: ["merge-base", "--is-ancestor", binding.base_sha, binding.wk_tip_sha]
      });
      if (!ancestor || ancestor.ok !== true) {
        fail(
          WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BINDING_INCOMPLETE,
          "WK binding fixed base_sha is not a retained ancestor of the moving wk_tip_sha",
          { base_sha: binding.base_sha ?? null, wk_tip_sha: binding.wk_tip_sha ?? null }
        );
      }
    }
  };
}

export function assertCompleteManagedBinding({
  binding,
  repo,
  unitAddress,
  launchRef,
  runId,
  retryId,
  worktreeRoot,
  sparse,
  runGit = defaultRunGit,
  physical = true
}) {
  assertManagedBindingShape({
    binding,
    repo,
    unitAddress,
    launchRef,
    runId,
    retryId,
    worktreeRoot,
    sparse,
    fail,
    ...(physical
      ? {
          canonicalizeBindingWorktreePath: physicalBindingWorktreeCanonicalizer,
          verifyBindingPhysicalCoherence: physicalBindingCoherence(runGit)
        }
      : {})
  });
}

export function freezeManagedResult({ mainRepo, initiative, wkId, sliceId, wkBinding, sliceBinding, retryId }) {

  const mode = discriminateManagedSliceCheckoutMode(sliceBinding, "slice binding", fail);
  const base = {
    schema_version: MANAGED_WORKTREE_BINDING_SCHEMA_VERSION,
    complete: true,
    main_repo: mainRepo,
    initiative,
    record_id: wkId,
    slice_id: sliceId,
    unit_address: `${initiative}/${wkId}/${sliceId}`,
    retry_id: retryId,
    wk_binding: Object.freeze({ ...wkBinding }),
    slice_binding: Object.freeze({ ...sliceBinding }),
    worktree_path: sliceBinding.worktree_path,
    output_branch: sliceBinding.output_branch,
    base_ref: sliceBinding.base_ref,
    base_sha: sliceBinding.base_sha,
    write_scope: Object.freeze([...(sliceBinding.write_scope ?? [])]),
    validation_worktree_path: wkBinding.worktree_path,
    shared_git_exposed: false
  };
  const carrier = mode === "full"
    ? { ...base, checkout_mode: MANAGED_SLICE_CHECKOUT_MODE_FULL }
    : {
        ...base,
        cone_dirs: Object.freeze([...(sliceBinding.cone_dirs ?? [])]),
        index_sparse: sliceBinding.index_sparse
      };
  return Object.freeze(carrier);
}

export function assertCompleteManagedProvisioningResult({
  provisioning,
  mainRepo,
  initiative,
  subject,
  launchRef,
  runId,
  retryId,
  worktreeRoot
} = {}) {
  return assertManagedProvisioningResultShape({
    provisioning,
    mainRepo,
    initiative,
    subject,
    launchRef,
    runId,
    retryId,
    worktreeRoot,

    requireRestoredCarrierImmutability: false,
    canonicalizeRoot: physicalRootCanonicalizer,
    canonicalizeBindingWorktreePath: physicalBindingWorktreeCanonicalizer,
    verifyBindingPhysicalCoherence: physicalBindingCoherence(defaultRunGit),
    fail
  });
}
