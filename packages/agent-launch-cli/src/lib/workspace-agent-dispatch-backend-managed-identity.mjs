

import {
  digestTrustedExactReviewEvidence
} from "./workspace-agent-dispatch-run-receipt.mjs";
import {
  MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES,
  MANAGED_NO_DELIVERY_EVIDENCE_DIAGNOSTIC_CODES,
  ManagedCorrectiveContinuationError,
  ManagedNoDeliveryEvidenceError,
  SUPERSEDED_ATTEMPT_RETIREMENT_RESULTS_SCHEMA_VERSION
} from "./workspace-agent-dispatch-backend-managed-identity-diagnostics.mjs";
import {
  createCorrectiveReceiptAuthentication
} from "./workspace-agent-dispatch-backend-managed-identity-receipts.mjs";
import {
  createCorrectiveSupersession
} from "./workspace-agent-dispatch-backend-managed-identity-supersession.mjs";
import {
  createManagedRunProvenDeathRetirement
} from "./workspace-agent-dispatch-backend-managed-identity-retirement.mjs";

export {
  MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES,
  MANAGED_NO_DELIVERY_EVIDENCE_DIAGNOSTIC_CODES,
  ManagedCorrectiveContinuationError,
  ManagedNoDeliveryEvidenceError,
  SUPERSEDED_ATTEMPT_RETIREMENT_RESULTS_SCHEMA_VERSION
};

const DEC_0164_EXACT_REVIEW_TARGET_SCHEMA_VERSION =
  "workspace-agent-dec0164-exact-review-target.v1";

function createCorrectiveExactTargetProjections() {

  function correctiveExactReviewTargetKey(subject, admission) {
    const identity = admission.identity;
    const target = admission.target;
    if (identity.unit_address !== subject ||
        target.ref !== identity.slice_ref ||
        target.sha !== identity.reviewed_sha ||
        target.diff_base_sha !== identity.diff_base_sha) {
      return null;
    }
    return digestTrustedExactReviewEvidence({
      schema_version: DEC_0164_EXACT_REVIEW_TARGET_SCHEMA_VERSION,
      unit_address: identity.unit_address,
      initiative: identity.initiative,
      record_id: identity.record_id,
      slice_id: identity.slice_id,
      slice_ref: target.ref,
      reviewed_sha: target.sha,
      diff_base_sha: target.diff_base_sha
    });
  }

  function correctiveGroupExactReviewTarget(subject, group, admission) {
    if (group.witness.committed_target_digest !== admission.identity.committed_target_digest) {
      return null;
    }
    return correctiveExactReviewTargetKey(subject, admission);
  }

  const correctiveConvergedExactTargetWitness = (subject, admission) => Object.freeze({
    unit_address: subject,
    slice_ref: admission.target.ref,
    reviewed_sha: admission.target.sha,
    diff_base_sha: admission.target.diff_base_sha
  });

  const correctiveProofCarrierAdmission = (matched) => matched
    .map((entry) => [digestTrustedExactReviewEvidence(entry.admission.identity), entry.admission])
    .reduce((best, entry) => (entry[0] < best[0] ? entry : best))[1];

  const correctiveReceiptSortKey = (receipt) => JSON.stringify([
    receipt.review_run_id ?? null,
    receipt.review_monitor_handle ?? null,
    receipt.trusted_evidence_digest ?? null,
    digestTrustedExactReviewEvidence(receipt)
  ]);

  const aggregateConvergedCorrectiveReceipts = (matched) => Object.freeze(
    matched
      .flatMap((entry) => entry.group.receipts)
      .map((receipt) => [correctiveReceiptSortKey(receipt), receipt])
      .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
      .map((entry) => entry[1])
  );

  return {
    correctiveExactReviewTargetKey,
    correctiveGroupExactReviewTarget,
    correctiveConvergedExactTargetWitness,
    correctiveProofCarrierAdmission,
    aggregateConvergedCorrectiveReceipts
  };
}

export function createBackendManagedIdentity(ctx) {

  const seam = {};
  Object.assign(seam, createCorrectiveReceiptAuthentication(
    ctx,
    createCorrectiveExactTargetProjections()
  ));
  Object.assign(seam, createManagedRunProvenDeathRetirement(ctx, seam));
  Object.assign(seam, createCorrectiveSupersession(ctx, seam));

  return {
    managedRunIdentityTuple: seam.managedRunIdentityTuple,
    resolveMechanicallyAuthenticatedCorrectiveContinuation:
      seam.resolveMechanicallyAuthenticatedCorrectiveContinuation,
    retainCorrectiveContinuationProof: seam.retainCorrectiveContinuationProof,
    supersedeProvenDeadAttemptForCorrectiveWorker:
      seam.supersedeProvenDeadAttemptForCorrectiveWorker,
    checkPriorManagedAttempt: seam.checkPriorManagedAttempt,
    releaseManagedRunSubjectReservationForLaunch:
      seam.releaseManagedRunSubjectReservationForLaunch,
    publishPendingManagedRunIdentity: seam.publishPendingManagedRunIdentity,
    bindManagedRunOuterIdentity: seam.bindManagedRunOuterIdentity,
    resolveManagedWorkerProvenDeath: seam.resolveManagedWorkerProvenDeath,
    retireManagedWorkerIdentity: seam.retireManagedWorkerIdentity
  };
}
