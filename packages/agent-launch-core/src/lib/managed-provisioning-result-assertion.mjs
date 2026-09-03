

import {
  assertManagedProvisioningResultShape,
  MANAGED_PROVISIONING_SHAPE_DIAGNOSTIC_CODES,
  MANAGED_WORKTREE_BINDING_SCHEMA_VERSION,
  ManagedProvisioningResultShapeError
} from "./managed-provisioning-result-shape.mjs";

export {
  MANAGED_PROVISIONING_SHAPE_DIAGNOSTIC_CODES,
  MANAGED_WORKTREE_BINDING_SCHEMA_VERSION,
  ManagedProvisioningResultShapeError
};

export function assertStructuralManagedProvisioningResult({
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

    requireRestoredCarrierImmutability: true
  });
}
