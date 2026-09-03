

import {
  MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES,
  MANAGED_NO_DELIVERY_EVIDENCE_DIAGNOSTIC_CODES,
  ManagedCorrectiveContinuationError,
  ManagedNoDeliveryEvidenceError,
  SUPERSEDED_ATTEMPT_RETIREMENT_RESULTS_SCHEMA_VERSION
} from "./workspace-agent-dispatch-backend-managed-identity-diagnostics.mjs";
import {
  createIndependentImplementationAttemptGate
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

export function createBackendManagedIdentity(ctx) {

  const seam = {};
  Object.assign(seam, createManagedRunProvenDeathRetirement(ctx, seam));
  Object.assign(seam, createIndependentImplementationAttemptGate(ctx, seam));

  return {
    managedRunIdentityTuple: seam.managedRunIdentityTuple,
    checkPriorManagedAttempt: seam.checkPriorManagedAttempt,
    releaseManagedRunSubjectReservationForLaunch:
      seam.releaseManagedRunSubjectReservationForLaunch,
    publishPendingManagedRunIdentity: seam.publishPendingManagedRunIdentity,
    bindManagedRunOuterIdentity: seam.bindManagedRunOuterIdentity,
    resolveManagedWorkerProvenDeath: seam.resolveManagedWorkerProvenDeath,
    resolveReviewerAttemptProvenDeath: seam.resolveReviewerAttemptProvenDeath,
    retireManagedWorkerIdentity: seam.retireManagedWorkerIdentity
  };
}
