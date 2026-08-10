const DOMAINS = Object.freeze({
  "capability-readiness-window": Object.freeze({
    subject: "capability:ready", baseline: "available", observationCount: 1,
    subjectType: "cc:capability"
  }),
  "cancellation-survivor-window": Object.freeze({
    subject: "workflow:survivor", baseline: "active", observationCount: 3,
    subjectType: "cc:resource"
  }),
  "configuration-freeze-window": Object.freeze({
    subject: "configuration:frozen", baseline: "revision-17", observationCount: 5,
    subjectType: "cc:lifecycle_entity"
  })
});

const LEGITIMATE_VARIANTS = Object.freeze({
  "mutate-and-restore-between-observations": Object.freeze({ transientRestore: true }),
  "nonterminal-reactivation-is-unconstrained": Object.freeze({ reactivation: true })
});

const MUTATIONS = Object.freeze({
  "in-population-state-regression": Object.freeze({ stateRegression: true }),
  "wrong-subject-observation": Object.freeze({ wrongSubject: true }),
  "observation-before-start": Object.freeze({ beforeStart: true }),
  "observation-after-end": Object.freeze({ afterEnd: true }),
  "incomplete-declared-population": Object.freeze({ incompletePopulation: true })
});

function executeBoundedStateStability({
  domain = "cancellation-survivor-window", variant, mutant
} = {}) {
  const selected = DOMAINS[domain];
  if (!selected) throw new Error(`unknown_domain:${domain}`);
  if (variant && !LEGITIMATE_VARIANTS[variant]) throw new Error(`unknown_variant:${variant}`);
  if (mutant && !MUTATIONS[mutant]) throw new Error(`unknown_mutant:${mutant}`);
  const start = 10;
  const end = 100;
  const observations = Array.from({ length: selected.observationCount }, (_, index) => ({
    id: `observation-${index + 1}`,
    time: 20 + index * 10,
    subject: selected.subject,
    state: selected.baseline
  }));
  if (mutant === "in-population-state-regression") {
    observations[Math.floor(observations.length / 2)].state = "regressed";
  }
  if (mutant === "wrong-subject-observation") observations.at(-1).subject = "other:subject";
  if (mutant === "observation-before-start") observations[0].time = start - 1;
  if (mutant === "observation-after-end") observations.at(-1).time = end + 1;
  const populationMembers = observations.map(({ id }) => id);
  if (mutant === "incomplete-declared-population") populationMembers.pop();
  return {
    domain,
    subject: selected.subject,
    subjectType: selected.subjectType,
    baseline: selected.baseline,
    baselineAtStart: true,
    start,
    end,
    observations,
    populationMembers,
    populationDeclaredComplete: true,
    transientChanges: variant === "mutate-and-restore-between-observations"
      ? [{ time: 25, from: selected.baseline, to: "transient" },
        { time: 29, from: "transient", to: selected.baseline }]
      : [],
    terminalityClaimed: false,
    reactivationEvents: variant === "nonterminal-reactivation-is-unconstrained"
      ? [{ time: end + 5 }] : [],
    externalActors: []
  };
}

function boundedStateStabilityGuaranteeSatisfied(execution) {
  if (!execution.baselineAtStart || !(execution.start < execution.end)) return false;
  if (!execution.populationDeclaredComplete || execution.populationMembers.length === 0) {
    return false;
  }
  const observationIds = execution.observations.map(({ id }) => id);
  if (observationIds.length !== execution.populationMembers.length ||
      observationIds.some((id, index) => id !== execution.populationMembers[index])) return false;
  return execution.observations.every(({ time, subject, state }) =>
    time > execution.start && time < execution.end &&
    subject === execution.subject && state === execution.baseline
  );
}

export { DOMAINS, LEGITIMATE_VARIANTS, MUTATIONS, executeBoundedStateStability,
  boundedStateStabilityGuaranteeSatisfied };
