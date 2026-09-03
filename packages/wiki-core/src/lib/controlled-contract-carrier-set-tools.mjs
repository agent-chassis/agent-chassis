

import {
  CARRIER_SET_SCHEMA_VERSION,
  carrierSetFailure,
  carrierSetManifestPath,
  inspectCarrierSetMember,
  processStartIdentity,
  samePlainData,
  validateControlledContractCarrierSetManifest,
  writeControlledContractCarrierSet
} from "./controlled-contract-carrier-set-publication.mjs";
import {
  assertBoundedStringArray,
  carrierFromCanonicalSet,
  persistedEvaluationInputBindings,
  projectedSelectedPackCount,
  readCanonicalProofPlanInputsImpl,
  readCanonicalProofPlanRequestImpl,
  readControlledContractCarrierFileImpl,
  resolveControlledContractEvaluationInputBindingImpl,
  selectedPackIdentityKey
} from "./controlled-contract-carrier-set-evaluation.mjs";
import {
  assertCanonicalCarrierSetIsNotFencedLegacyImpl,
  readControlledContractAuthoringCarriersImpl,
  resolveCanonicalControlledContractCarrierDirectory,
  resolveCanonicalControlledContractCarrierSetImpl,
  resolveCanonicalControlledContractGenerationSelectionImpl
} from "./controlled-contract-carrier-set-resolution.mjs";
import {
  clearControlledContractAuthoringContinuationsForTest,
  getControlledContractAuthoringContinuation,
  rememberControlledContractAuthoringContinuation,
  updateControlledContractAuthoringProofGraphContinuation
} from "./controlled-contract-authoring-continuations.mjs";
import {
  deriveCanonicalControlledContractAuthoringStateImpl,
  deriveControlledContractProofPlanBindingImpl,
  deriveControlledContractSelectedPackEvaluationInputs,
  resolveControlledContractAuthoringContinuationMutationImpl
} from "./controlled-contract-carrier-set-authoring.mjs";
import {
  assertControlledContractCarrierExpectedDigestImpl,
  assertControlledContractSourceLeaseImpl
} from "./controlled-contract-source-lease-primitives.mjs";
import {
  withCanonicalControlledContractSourceLeaseImpl
} from "./controlled-contract-source-lease-acquisition.mjs";
import {
  writeControlledContractCarrierFileImpl,
  writeControlledContractCarrierFileInternalImpl
} from "./controlled-contract-carrier-writes.mjs";
import { deriveControlledContractAuthoringState } from
  "./controlled-contract-authoring-state.mjs";
import { projectControlledContractAuthoringState } from
  "./controlled-contract-authoring-projections.mjs";
import { composeSelectedProofPack } from
  "./controlled-contract-proof-authoring-tools.mjs";

export {
  publishNewControlledContractCarrierGeneration,
  readControlledContractCarrierSetManifestDigest,
  rollbackControlledContractCarrierSetPublication,
  setCanonicalAuthoringPublisherHookForTest,
  validateControlledContractCarrierSetManifest,
  writeControlledContractCarrierSet
} from "./controlled-contract-carrier-set-publication.mjs";

export {
  assertBoundedStringArray,
  composeSelectedProofPack,
  persistedEvaluationInputBindings,
  projectedSelectedPackCount,
  selectedPackIdentityKey,
  clearControlledContractAuthoringContinuationsForTest,
  getControlledContractAuthoringContinuation,
  rememberControlledContractAuthoringContinuation,
  updateControlledContractAuthoringProofGraphContinuation,
  deriveControlledContractSelectedPackEvaluationInputs,
  resolveCanonicalControlledContractCarrierDirectory
};

function publicationDependencies() {
  return {
    CARRIER_SET_SCHEMA_VERSION,
    carrierSetFailure,
    carrierSetManifestPath,
    inspectCarrierSetMember,
    processStartIdentity,
    samePlainData
  };
}

function authoringDependencies() {
  return {
    readCanonicalProofPlanInputs,
    readControlledContractAuthoringCarriers,
    resolveCanonicalControlledContractCarrierSet
  };
}

function writeDependencies() {
  return {
    resolveCanonicalControlledContractCarrierSet,
    validateControlledContractCarrierSetManifest,
    withCanonicalControlledContractSourceLease,
    writeControlledContractCarrierSet
  };
}

export async function readCanonicalProofPlanRequest(input) {
  return readCanonicalProofPlanRequestImpl(input, {
    resolveCanonicalControlledContractCarrierSet
  });
}

export async function resolveControlledContractEvaluationInputBinding(input) {
  return resolveControlledContractEvaluationInputBindingImpl(input, {
    resolveCanonicalControlledContractCarrierSet
  });
}

export async function readControlledContractCarrierFile(input) {
  return readControlledContractCarrierFileImpl(input, {
    resolveCanonicalControlledContractCarrierSet
  });
}

export async function resolveCanonicalControlledContractCarrierSet(input) {
  return resolveCanonicalControlledContractCarrierSetImpl(
    input,
    publicationDependencies()
  );
}

export async function assertCanonicalCarrierSetIsNotFencedLegacy(input) {
  return assertCanonicalCarrierSetIsNotFencedLegacyImpl(input, { carrierSetFailure });
}

export async function resolveCanonicalControlledContractGenerationSelection(input) {
  return resolveCanonicalControlledContractGenerationSelectionImpl(
    input,
    publicationDependencies()
  );
}

export async function readControlledContractAuthoringCarriers(input) {
  return readControlledContractAuthoringCarriersImpl(
    input,
    publicationDependencies()
  );
}

export async function deriveControlledContractProofPlanBinding(input) {
  return deriveControlledContractProofPlanBindingImpl(
    input,
    authoringDependencies()
  );
}

export async function deriveCanonicalControlledContractAuthoringState(input) {
  const projected = await deriveCanonicalControlledContractAuthoringStateImpl(
    input,
    authoringDependencies()
  );
  if (!input.proofPackAuthoring || projected.stage !== "proof_authoring_required") {
    return projected;
  }
  const focus = input.focus ?? null;
  const canonicalSet = await resolveCanonicalControlledContractCarrierSet({
    repoRoot: input.repoRoot, wkId: input.wkId, focus
  });
  const carriers = await readControlledContractAuthoringCarriers({
    repoRoot: input.repoRoot, wkId: input.wkId, focus, canonicalSet
  });
  const state = deriveControlledContractAuthoringState({
    wkId: input.wkId,
    focus,
    carriers,
    proofPackAuthoring: input.proofPackAuthoring
  });
  return projectControlledContractAuthoringState(state, { request: input.request ?? null });
}

export async function resolveControlledContractAuthoringContinuationMutation(input) {
  return resolveControlledContractAuthoringContinuationMutationImpl(
    input,
    authoringDependencies()
  );
}

export async function assertControlledContractCarrierExpectedDigest(input) {
  return assertControlledContractCarrierExpectedDigestImpl(input, {
    resolveCanonicalControlledContractCarrierSet
  });
}

export async function assertControlledContractSourceLease(lease, input) {
  return assertControlledContractSourceLeaseImpl(lease, input, {
    resolveCanonicalControlledContractCarrierSet
  });
}

export async function withCanonicalControlledContractSourceLease(input, callback) {
  return withCanonicalControlledContractSourceLeaseImpl(input, callback, {
    processStartIdentity,
    resolveCanonicalControlledContractCarrierSet
  });
}

export async function writeControlledContractCarrierFileInternal(input) {
  return writeControlledContractCarrierFileInternalImpl(input, writeDependencies());
}

export async function writeControlledContractCarrierFile(input) {
  return writeControlledContractCarrierFileImpl(input, writeDependencies());
}

export async function readCanonicalProofPlanInputs(input) {
  return readCanonicalProofPlanInputsImpl(input, {
    resolveCanonicalControlledContractCarrierSet
  });
}
