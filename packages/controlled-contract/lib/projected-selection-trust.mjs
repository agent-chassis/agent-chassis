const TRUSTED_CYCLES = new WeakSet();
const TRUSTED_SUPPLEMENTS = new WeakSet();

const hasTrustedAssessmentPackCycle = (value) => TRUSTED_CYCLES.has(value);
const hasTrustedProjectedSelectionSupplement = (value) =>
  TRUSTED_SUPPLEMENTS.has(value);
const registerAssessmentPackCycle = (value) => TRUSTED_CYCLES.add(value);
const registerProjectedSelectionSupplement = (value) =>
  TRUSTED_SUPPLEMENTS.add(value);

export {
  hasTrustedAssessmentPackCycle,
  hasTrustedProjectedSelectionSupplement,
  registerAssessmentPackCycle,
  registerProjectedSelectionSupplement
};
