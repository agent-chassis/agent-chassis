

import path from "node:path";
import { EXACT_IMPLEMENTATION_SLICE_RE } from "./backend-constants.mjs";
import {
  resolveCanonicalFindingsOnlyReviewUnit,
  resolveCanonicalSliceReviewUnit
} from "./backend-scope-authority.mjs";
import {
  resolveUniqueManagedLifecycleBindingPairForRecovery
} from "./worktree-substrate-identity.mjs";

export function createBackendRecovery(ctx) {
  const {
    postWorkerSliceLifecycle,
    worktreeProvisioningConfig,
    recoveredIntegratedRuns,
    exactSliceReviewReceiptStore
  } = ctx;

  const bindFrozenReviewContext = (args) => ctx.bindFrozenReviewContext(args);
  const bindFrozenSliceReviewContext = (args) => ctx.bindFrozenSliceReviewContext(args);
  const resolveManagedWorkerProvenDeath = (args) => ctx.resolveManagedWorkerProvenDeath(args);
  const retireManagedWorkerIdentity = (args) => ctx.retireManagedWorkerIdentity(args);

  const recoverIntegratedWorkerRunInternal = async ({
    workspace,
    monitor_handle,
    subject,
    allowMissingSliceWorktree = false
  } = {}) => {
    if (postWorkerSliceLifecycle === null || !worktreeProvisioningConfig ||
        !workspace || path.resolve(workspace.dir ?? "") !== worktreeProvisioningConfig.mainRepo ||
        typeof monitor_handle !== "string" || typeof subject !== "string" ||
        !EXACT_IMPLEMENTATION_SLICE_RE.test(subject)) {
      return null;
    }

    try {
      resolveCanonicalSliceReviewUnit(worktreeProvisioningConfig.mainRepo, subject);
      return null;
    } catch {

    }
    const key = JSON.stringify([monitor_handle, subject, allowMissingSliceWorktree]);
    if (!recoveredIntegratedRuns.has(key)) {
      const recovery = (async () => {
        try {
          const pair = resolveUniqueManagedLifecycleBindingPairForRecovery({
            mainRepo: worktreeProvisioningConfig.mainRepo,
            launchRef: monitor_handle,
            expectedSubject: subject,
            allowMissingSliceWorktree
          });
          if (!pair) return null;

          const status = Object.freeze({
            accepted: true,
            recovered: true,
            run_id: pair.run_id,
            monitor_handle,
            app: null,
            role: "worker",
            subject,
            status: "succeeded",
            terminal: true,
            started_at: null,
            updated_at: null,
            exit: null,
            final_result: null
          });

          const lifecycleResult = await postWorkerSliceLifecycle({
            workspace,
            status,
            deps: {
              resolveManagedRunBinding: () => pair.provisioning,
              resolveCanonicalReviewUnit: ({ mainRepo, wkId }) =>
                resolveCanonicalFindingsOnlyReviewUnit(mainRepo, wkId),
              bindFrozenReviewContext,
              resolveCanonicalSliceReviewUnit: ({ mainRepo, subject: sliceSubject }) =>
                resolveCanonicalSliceReviewUnit(mainRepo, sliceSubject),
              bindFrozenSliceReviewContext,

              resolveManagedWorkerProvenDeath,

              retireManagedWorkerIdentity,
              recoveryOnly: true
            }
          });

          const retiredNoCommit =
            lifecycleResult?.phase === "finalized" &&
            lifecycleResult.integrated === false &&
            lifecycleResult.integration === null &&
            lifecycleResult.recovered_from_proven_death === true &&
            lifecycleResult.retired === true &&
            lifecycleResult.retirement_reason === "no_commit_base_equal";
          if (!lifecycleResult ||
              (!retiredNoCommit &&
                (lifecycleResult.phase !== "finalized" ||
                  lifecycleResult.integration?.recovered !== true))) {
            return null;
          }
          return Object.freeze({ status, lifecycle: lifecycleResult });
        } catch (error) {

          return Object.freeze({
            recovery_failure: Object.freeze({
              code: typeof error?.code === "string"
                ? error.code
                : "agent_launch.slice_lifecycle.recovery_failed.v1",
              message: error?.message ?? String(error),
              detail: error?.detail ?? null
            })
          });
        }
      })();
      recoveredIntegratedRuns.set(key, recovery);
    }
    const pending = recoveredIntegratedRuns.get(key);
    const result = await pending;
    if ((result === null || result.recovery_failure != null) &&
        recoveredIntegratedRuns.get(key) === pending) {

      recoveredIntegratedRuns.delete(key);
    }
    return result;
  };

  const recoverIntegratedWorkerRun = (input = {}) =>
    recoverIntegratedWorkerRunInternal({ ...input, allowMissingSliceWorktree: true });

  const recoverExactSliceReviewRun = async ({ workspace, monitor_handle, subject } = {}) => {
    if (exactSliceReviewReceiptStore === null ||
        !workspace || path.resolve(workspace.dir ?? "") !== worktreeProvisioningConfig?.mainRepo ||
        typeof monitor_handle !== "string" || typeof subject !== "string" ||
        !EXACT_IMPLEMENTATION_SLICE_RE.test(subject)) return null;
    const receipt = await exactSliceReviewReceiptStore.load({
      unit_address: subject,
      monitor_handle
    });
    if (receipt === null) return null;
    return Object.freeze({
      status: Object.freeze({
        accepted: true,
        recovered: true,
        run_id: receipt.review_run_id,
        monitor_handle: receipt.review_monitor_handle,
        role: receipt.reviewer_role,
        subject,
        status: receipt.terminal_run_status,
        terminal: true,
        ...(receipt.structured_outcome?.outcome === "clean"
          ? { review_result: receipt.structured_outcome.review_result }
          : {}),
        final_result: null
      }),
      lifecycle: Object.freeze({
        invoked: false,
        integrated: false,
        reason: "advisory_review_recovered_coordinator_continuation_required",
        next_action: "call_workspace_integrate_committed_slice"
      }),
      review_evidence: receipt
    });
  };

  return {
    recoverIntegratedWorkerRunInternal,
    recoverIntegratedWorkerRun,
    recoverExactSliceReviewRun
  };
}
