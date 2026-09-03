

import {
  acquireManagedRunSubjectReservation
} from "./managed-run-process-identity.mjs";
import {
  resolveUniqueManagedLifecycleBindingPairForRecovery
} from "./worktree-substrate-identity.mjs";
import { EXACT_IMPLEMENTATION_SLICE_RE } from "./backend-constants.mjs";
import {
  failNoDeliveryEvidence,
  MANAGED_NO_DELIVERY_EVIDENCE_DIAGNOSTIC_CODES,
  NO_DELIVERY_COMMIT_ID_RE,
  NO_DELIVERY_DIAGNOSTIC_VALUE_MAX
} from "./workspace-agent-dispatch-backend-managed-identity-diagnostics.mjs";

export function createIndependentImplementationAttemptGate(ctx, seam) {
  const {
    worktreeProvisioningConfig,
    reviewContextRunGit,
    managedRunIdentityRoot,
    managedRunIdentityDeps
  } = ctx;

  function resolveNoDeliveryRetirementEvidence(subject, tuple) {
    if (worktreeProvisioningConfig === null || managedRunIdentityRoot === null ||
        !EXACT_IMPLEMENTATION_SLICE_RE.test(subject ?? "") ||
        !tuple || typeof tuple.launch_ref !== "string") {
      return null;
    }
    let pair;
    try {
      pair = resolveUniqueManagedLifecycleBindingPairForRecovery({
        mainRepo: worktreeProvisioningConfig.mainRepo,
        launchRef: tuple.launch_ref,
        expectedSubject: subject,
        allowMissingSliceWorktree: false
      });
    } catch (error) {
      failNoDeliveryEvidence(
        MANAGED_NO_DELIVERY_EVIDENCE_DIAGNOSTIC_CODES.BINDING_UNRESOLVED,
        "the retained launcher binding pair for a proven-dead implementation attempt could not be reconstructed",
        { detail: { subject, launch_ref: tuple.launch_ref }, cause: error }
      );
    }
    if (!pair) return null;
    const sliceBinding = pair.slice_binding;
    if (!sliceBinding || typeof sliceBinding.output_branch !== "string" ||
        typeof sliceBinding.base_sha !== "string" || sliceBinding.base_sha.length === 0) {
      failNoDeliveryEvidence(
        MANAGED_NO_DELIVERY_EVIDENCE_DIAGNOSTIC_CODES.BINDING_UNRESOLVED,
        "the reconstructed launcher binding pair carries no usable implementation slice ref and authenticated base",
        { detail: { subject, launch_ref: tuple.launch_ref } }
      );
    }
    const sliceRef = sliceBinding.output_branch.startsWith("refs/heads/")
      ? sliceBinding.output_branch
      : `refs/heads/${sliceBinding.output_branch}`;
    let result;
    try {
      result = reviewContextRunGit({
        repo: worktreeProvisioningConfig.mainRepo,
        args: ["rev-parse", "--verify", `${sliceRef}^{commit}`]
      });
    } catch (error) {
      failNoDeliveryEvidence(
        MANAGED_NO_DELIVERY_EVIDENCE_DIAGNOSTIC_CODES.GIT_UNRESOLVED,
        "trusted Git verification of the retained implementation slice ref threw",
        { detail: { subject, launch_ref: tuple.launch_ref, slice_ref: sliceRef }, cause: error }
      );
    }
    if (!result || result.ok !== true) {
      failNoDeliveryEvidence(
        MANAGED_NO_DELIVERY_EVIDENCE_DIAGNOSTIC_CODES.GIT_UNRESOLVED,
        "trusted Git verification of the retained implementation slice ref failed",
        {
          detail: {
            subject,
            launch_ref: tuple.launch_ref,
            slice_ref: sliceRef,
            status: result?.status ?? null,
            signal: result?.signal ?? null,
            git_error: result?.error ?? null,
            stderr: result?.stderr ?? null
          }
        }
      );
    }
    const tip = typeof result.stdout === "string" ? result.stdout.trim() : "";
    if (!NO_DELIVERY_COMMIT_ID_RE.test(tip)) {
      failNoDeliveryEvidence(
        MANAGED_NO_DELIVERY_EVIDENCE_DIAGNOSTIC_CODES.GIT_UNRESOLVED,
        "trusted Git verification of the retained implementation slice ref returned no canonical commit id",
        {
          detail: {
            subject,
            launch_ref: tuple.launch_ref,
            slice_ref: sliceRef,
            resolved_output: tip.slice(0, NO_DELIVERY_DIAGNOSTIC_VALUE_MAX),
            resolved_output_length: tip.length,
            status: result.status ?? null,
            stderr: result.stderr ?? null
          }
        }
      );
    }
    if (tip !== sliceBinding.base_sha) return { committed: true };
    return {
      committed: false,
      evidence: { slice_ref: sliceRef, base_sha: sliceBinding.base_sha, slice_tip_sha: tip }
    };
  }

  const checkPriorManagedAttempt = managedRunIdentityRoot === null
    ? null
    : async ({ role, subject }) => {
        const first = acquireManagedRunSubjectReservation({
          mainRepo: managedRunIdentityRoot,
          subject,
          role,
          ...(managedRunIdentityDeps ? { deps: managedRunIdentityDeps } : {})
        });
        if (first.may_launch === true) return first;
        const noDelivery = seam.supersedeNoDeliveryProvenDeadAttempt({
          subject,
          priorAttempt: first
        });
        if (noDelivery !== null) return noDelivery;
        return seam.resolveCommittedReviewContinuation(subject, first) ?? first;
      };

  return { resolveNoDeliveryRetirementEvidence, checkPriorManagedAttempt };
}
