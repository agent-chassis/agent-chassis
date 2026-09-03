const SELECTION_STATUSES = Object.freeze({
  HARD_INCOMPATIBILITY: "hard_incompatibility_present",
  UNCOVERED: "requested_intents_uncovered",
  BINDINGS: "compatible_candidates_require_bindings",
  READY: "compatible_candidates_ready_for_authoring"
});

function assertOutcomePopulation(outcomes) {
  if (!Array.isArray(outcomes) || outcomes.length === 0) {
    throw new TypeError("selection status requires a non-empty intent outcome population");
  }
  for (const outcome of outcomes) {
    if (!outcome || typeof outcome !== "object" ||
        !Array.isArray(outcome.candidate_outcomes)) {
      throw new TypeError("selection status requires candidate outcomes for every intent");
    }
    for (const candidate of outcome.candidate_outcomes) {
      if (!candidate || typeof candidate !== "object" ||
          !["compatible", "hard_incompatible"].includes(
            candidate.compatibility_state
          )) {
        throw new TypeError("selection status received an invalid candidate outcome");
      }
      if (candidate.compatibility_state === "compatible" &&
          !["ready_for_authoring", "requires_bindings"].includes(
            candidate.authoring_state
          )) {
        throw new TypeError("compatible candidate outcome requires an authoring state");
      }
    }
  }
}

function reduceProofIntentSelectionStatus(outcomes) {
  assertOutcomePopulation(outcomes);
  if (outcomes.some(({ candidate_outcomes: candidates }) =>
    candidates.some(({ compatibility_state: state }) =>
      state === "hard_incompatible"))) {
    return SELECTION_STATUSES.HARD_INCOMPATIBILITY;
  }
  if (outcomes.some(({ candidate_outcomes: candidates }) => candidates.length === 0)) {
    return SELECTION_STATUSES.UNCOVERED;
  }
  if (outcomes.some(({ candidate_outcomes: candidates }) =>
    candidates.some(({ compatibility_state: compatibility, authoring_state: authoring }) =>
      compatibility === "compatible" && authoring === "requires_bindings"))) {
    return SELECTION_STATUSES.BINDINGS;
  }
  return SELECTION_STATUSES.READY;
}

export { reduceProofIntentSelectionStatus, SELECTION_STATUSES };
