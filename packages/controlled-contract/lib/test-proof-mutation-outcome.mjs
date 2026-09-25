

const MUTATION_OUTCOMES = Object.freeze(["detected", "survived", "unavailable", "unevaluable"]);

function classifyMutationOutcome({ status, provider_support: providerSupport, isolated,
  candidate_status: candidateStatus, falsified_status: falsifiedStatus,
  mutation_observed: mutationObserved }) {
  if (providerSupport === "unsupported") return "unavailable";
  if (status === "detected") return "detected";
  if (status === "not_detected" && providerSupport === "supported" && isolated === true &&
      candidateStatus === "passed" && falsifiedStatus === "passed" &&
      mutationObserved === true) return "survived";
  return "unevaluable";
}

function countMutationOutcomes(outcomes) {
  const counts = Object.fromEntries(MUTATION_OUTCOMES.map((outcome) => [outcome, 0]));
  for (const outcome of outcomes) counts[outcome] += 1;
  return counts;
}

export { MUTATION_OUTCOMES, classifyMutationOutcome, countMutationOutcomes };
