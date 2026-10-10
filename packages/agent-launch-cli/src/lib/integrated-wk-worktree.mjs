

import path from "node:path";

import {
  withControlledContractAuthorityExclusion
} from "@agent-chassis/wiki-core/src/lib/controlled-contract-carrier-set-publication.mjs";

import { OWNED_WORKTREE_CHECKOUT_CODES, OWNED_WORKTREE_CHECKOUT_MUTATIONS, OwnedWorktreeCheckoutError,
  synchronizeOwnedWorktreeCheckout } from "./owned-worktree-checkout.mjs";

const OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const WK_BRANCH_RE = /^wk\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;

export async function synchronizeIntegratedWkWorktree({ mainRepo, wkBinding, integratedSha, deps = {} } = {}) {
  if (typeof mainRepo !== "string" || !path.isAbsolute(mainRepo) || path.resolve(mainRepo) !== mainRepo ||
      typeof integratedSha !== "string" || !OID_RE.test(integratedSha) ||
      wkBinding === null || typeof wkBinding !== "object" || wkBinding.slice_id !== null ||
      typeof wkBinding.record_id !== "string" || typeof wkBinding.worktree_path !== "string" ||
      !path.isAbsolute(wkBinding.worktree_path) || typeof wkBinding.output_branch !== "string" ||
      !WK_BRANCH_RE.test(wkBinding.output_branch) || !wkBinding.output_branch.endsWith(`/${wkBinding.record_id}`) ||
      typeof wkBinding.base_sha !== "string" || !OID_RE.test(wkBinding.base_sha)) {
    throw new OwnedWorktreeCheckoutError(OWNED_WORKTREE_CHECKOUT_CODES.INVALID_ARG,
      "WK checkout finalization requires the configured repository, the WK binding and the integrated commit");
  }
  return withControlledContractAuthorityExclusion({
    repoRoot: mainRepo,
    wkId: wkBinding.record_id,
    run: () => synchronizeOwnedWorktreeCheckout({ mainRepo, worktreePath: wkBinding.worktree_path,
      branchRef: `refs/heads/${wkBinding.output_branch}`, targetSha: integratedSha,
      mutation: OWNED_WORKTREE_CHECKOUT_MUTATIONS.INDEX_AND_FILES, floorSha: wkBinding.base_sha, deps })
  });
}
