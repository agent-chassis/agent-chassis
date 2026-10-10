

import path from "node:path";

import { verifyExactSliceCommitBinding } from "../../../agent-launch-cli/src/lib/exact-slice-commit-binding.mjs";
import { OWNED_WORKTREE_CHECKOUT_MUTATIONS, synchronizeOwnedWorktreeCheckout } from
  "../../../agent-launch-cli/src/lib/owned-worktree-checkout.mjs";
import { resolveWorktreeBinding } from "../../../agent-launch-cli/src/lib/worktree-substrate-identity.mjs";
import { settleCheckoutFinalization } from "./dispatch-integration-finalization.mjs";

export async function finalizeDeliveryCheckout({ workspaceDir, credential, assignedUnit, deliveryCommit }) {
  const mainRepo = path.resolve(workspaceDir);
  const settled = await settleCheckoutFinalization(() => {

    const binding = verifyExactSliceCommitBinding({
      binding: resolveWorktreeBinding({ mainRepo, launchRef: credential.launchRef, runId: credential.runId,
        retryId: credential.retryId }),
      mainRepo, assignedUnit, launchRef: credential.launchRef, runId: credential.runId, retryId: credential.retryId
    });
    const branch = binding.output_branch;
    return synchronizeOwnedWorktreeCheckout({ mainRepo, worktreePath: binding.worktree_path,
      branchRef: branch.startsWith("refs/heads/") ? branch : `refs/heads/${branch}`, targetSha: deliveryCommit,
      mutation: OWNED_WORKTREE_CHECKOUT_MUTATIONS.INDEX_ONLY });
  }, { operation: "delivery_finalization:worker_checkout", subject: "worker" });
  return Object.freeze({ ...settled, facts: Object.freeze({ state: settled.state, code: settled.code ?? null,
    ...(typeof settled.message === "string" ? { message: settled.message } : {}) }) });
}
