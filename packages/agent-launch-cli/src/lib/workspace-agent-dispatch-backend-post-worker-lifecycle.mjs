

import {
  resolveDeclaredCanonicalFindingsOnlyReviewUnit
} from "./backend-scope-authority.mjs";
import { EXACT_IMPLEMENTATION_SLICE_RE } from "./backend-constants.mjs";
import { resolveUniqueManagedLifecycleBindingPairForRecovery } from
  "./worktree-substrate-identity.mjs";

export function createBackendPostWorkerLifecycle(ctx) {
  const {
    worktreeProvisioningConfig,
    postWorkerSliceLifecycle,
    attemptStateAuthority
  } = ctx;

  const authenticateTerminalCandidatePreparation = (args) =>
    ctx.authenticateTerminalCandidatePreparation(args);
  const resolveCommittedSliceIntegrationContinuation = (args) =>
    ctx.resolveCommittedSliceIntegrationContinuation(args);
  const resolveManagedWorkerProvenDeath = (args) => ctx.resolveManagedWorkerProvenDeath(args);
  const retireManagedWorkerIdentity = (args) => ctx.retireManagedWorkerIdentity(args);

  function resolveManagedRunBinding(status) {
    try {
      return attemptStateAuthority.resolveProvisioningBinding(status);
    } catch (processLocalAbsence) {

      if (status?.recovered !== true || !worktreeProvisioningConfig ||
          typeof status.monitor_handle !== "string" || typeof status.run_id !== "string" ||
          !EXACT_IMPLEMENTATION_SLICE_RE.test(status.subject ?? "")) {
        throw processLocalAbsence;
      }
      const pair = resolveUniqueManagedLifecycleBindingPairForRecovery({
        mainRepo: worktreeProvisioningConfig.mainRepo,
        launchRef: status.monitor_handle,
        expectedSubject: status.subject,
        allowMissingSliceWorktree: true
      });
      if (!pair || pair.run_id !== status.run_id) throw processLocalAbsence;
      return pair.provisioning;
    }
  }

  const runPostWorkerSliceLifecycle = postWorkerSliceLifecycle === null
    ? null
    : async ({ workspace, status }) => postWorkerSliceLifecycle({
        workspace,
        status,
        deps: {
          resolveManagedRunBinding,
          resolveDeclaredTerminalReviewUnit: ({ mainRepo, wkId }) =>
            resolveDeclaredCanonicalFindingsOnlyReviewUnit(mainRepo, wkId),
          authenticateTerminalCandidatePreparation,

          resolveCommittedSliceIntegrationContinuation,

          retireManagedWorkerIdentity,

          resolveManagedWorkerProvenDeath
        }
      });

  return {
    resolveManagedRunBinding,
    runPostWorkerSliceLifecycle
  };
}
