

import { resolveRetainedManagedWorkerTuple } from "./dispatch-post-worker-lifecycle-bindings.mjs";
import { captureLifecycleFailureEvidence } from "./dispatch-lifecycle-failure-projection.mjs";

export async function withDeliveryFinalization(result, { status, bindings, deps }) {
  const integrationCleanup = result?.integration?.cleanup ?? null;
  const wkCheckout = typeof deps.synchronizeIntegratedWkWorktree === "function"
    ? await settleCheckoutFinalization(deps.synchronizeIntegratedWkWorktree,
      { operation: "delivery_finalization:wk_checkout", subject: "WK" }) : null;
  let managedIdentityRetirement;
  if (typeof deps.retireManagedWorkerIdentity !== "function") {
    managedIdentityRetirement = Object.freeze({
      state: "pending",
      retired: false,
      code: "managed_worker_identity_retirement_unavailable"
    });
  } else {
    try {
      const workerTuple = resolveRetainedManagedWorkerTuple({ status, bindings });
      const retirement = await deps.retireManagedWorkerIdentity({
        ...workerTuple,
        reason: "finalized_integration",
        evidence: {
          slice_ref: result.integration?.slice_ref ?? bindings.slice?.output_branch ?? null,
          integrated_sha: result.integration?.wk_sha ?? result.integration?.slice_sha ?? null
        }
      });
      managedIdentityRetirement = Object.freeze({
        state: retirement?.retired === true ? "complete" : "pending",
        retired: retirement?.retired === true,
        code: typeof retirement?.code === "string" ? retirement.code : null
      });
    } catch (error) {
      managedIdentityRetirement = Object.freeze({
        state: "pending",
        retired: false,
        code: typeof error?.code === "string" ? error.code : null,
        evidence: captureLifecycleFailureEvidence(error, {
          operation: "delivery_finalization:managed_worker_identity_retirement"
        })
      });
    }
  }
  const cleanupPending = integrationCleanup?.state === "failed" ||
    managedIdentityRetirement.state !== "complete" || wkCheckout?.state === "pending";
  return Object.freeze({
    ...result,
    delivery_state: "delivery_finalized",
    cleanup_pending: cleanupPending,
    cleanup: Object.freeze({
      state: cleanupPending ? "pending" : "complete",
      integration_cleanup_state: typeof integrationCleanup?.state === "string"
        ? integrationCleanup.state
        : null,
      managed_identity_retirement: managedIdentityRetirement,
      ...(wkCheckout === null ? {} : { wk_checkout: wkCheckout })
    })
  });
}

export async function settleCheckoutFinalization(synchronize, { operation, subject }) {
  try {
    const checkout = await synchronize();
    if (checkout?.state === "superseded") {
      return Object.freeze({ state: "superseded", code: checkout.code ?? null, message: checkout.message ?? null,
        checkout });
    }
    if (checkout?.clean !== true) {
      return Object.freeze({ state: "pending", code: `${subject.toLowerCase()}_checkout_not_clean`,
        message: `the ${subject} checkout owner did not report a clean exact checkout`, checkout });
    }
    return Object.freeze({ state: "complete", code: null, checkout });
  } catch (error) {
    return Object.freeze({
      state: "pending",
      code: typeof error?.code === "string" ? error.code : null,
      message: typeof error?.message === "string" ? error.message : null,
      evidence: captureLifecycleFailureEvidence(error, { operation })
    });
  }
}
