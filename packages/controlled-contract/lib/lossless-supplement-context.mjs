const ASSESSMENT_CONTEXTS = new WeakMap();
const MULTI_PACK_ARTIFACTS = new WeakMap();

function assessmentSupplementContextFor(projected) {
  return ASSESSMENT_CONTEXTS.get(projected) ?? null;
}

function proofAwarePlanningArtifactsFor(projected) {
  return MULTI_PACK_ARTIFACTS.get(projected) ?? null;
}

function registerAssessmentSupplementContext(projected, context) {
  ASSESSMENT_CONTEXTS.set(projected, context);
}

function registerProofAwarePlanningArtifacts(projected, artifacts) {
  MULTI_PACK_ARTIFACTS.set(projected, artifacts);
}

export {
  assessmentSupplementContextFor,
  proofAwarePlanningArtifactsFor,
  registerAssessmentSupplementContext,
  registerProofAwarePlanningArtifacts
};
