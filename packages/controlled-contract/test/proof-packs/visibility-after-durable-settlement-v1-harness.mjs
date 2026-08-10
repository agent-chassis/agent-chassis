const DOMAINS = Object.freeze({
  "database-commit": Object.freeze({ effects: ["row:order/42", "row:outbox/42"], expected: "committed-v7" }),
  "object-publication": Object.freeze({ effects: ["object:blob/7", "object:index/7"], expected: "published-v7" }),
  "workflow-ack": Object.freeze({ effects: ["record:run/9", "ledger:run/9", "projection:run/9"], expected: "settled-v9" })
});

const MUTATIONS = Object.freeze({
  "ack-before-settlement": (execution) => { execution.visibilityIndex = 1; execution.settlementIndex = 2; },
  "partial-population": (execution) => { execution.settled = execution.durable.slice(0, -1); },
  "success-on-failure": (execution) => { execution.failureVisibility = ["success-visible"]; },
  "stale-observation": (execution) => { execution.observedState = `${execution.expectedState}-stale`; },
  "wrong-subject": (execution) => { execution.observedPopulation = execution.durable.map((id) => `${id}:other`); },
  "status-only": (execution) => { execution.observedPopulation = []; execution.observedState = "status:200"; },
  "same-count-substitution": (execution) => { execution.settled = [...execution.durable.slice(0, -1), "effect:substituted"]; }
});

function executeVisibilityAfterDurableSettlement({ domain = "database-commit", mutant = null } = {}) {
  const selected = DOMAINS[domain];
  if (!selected) throw new TypeError(`unknown domain: ${domain}`);
  const execution = { domain, durable: [...selected.effects], settled: [...selected.effects],
    selectedSettledState: "durably-settled", allowedSettledStates: ["durably-settled"],
    settlementIndex: 1, visibilityIndex: 2, observationIndex: 3,
    failureVisibility: [], observedPopulation: [...selected.effects],
    expectedState: selected.expected, observedState: selected.expected };
  if (mutant !== null) {
    const mutate = MUTATIONS[mutant];
    if (!mutate) throw new TypeError(`unknown mutant: ${mutant}`);
    mutate(execution);
  }
  return execution;
}

function visibilityAfterDurableSettlementGuaranteeSatisfied(execution) {
  const durable = new Set(execution.durable);
  const settled = new Set(execution.settled);
  const observed = new Set(execution.observedPopulation);
  const sameSet = (left, right) => left.size === right.size && [...left].every((id) => right.has(id));
  return durable.size > 0 && sameSet(durable, settled) &&
    execution.allowedSettledStates.includes(execution.selectedSettledState) &&
    execution.visibilityIndex >= execution.settlementIndex &&
    execution.observationIndex >= execution.visibilityIndex &&
    execution.failureVisibility.length === 0 && sameSet(observed, durable) &&
    execution.observedState === execution.expectedState;
}

export { DOMAINS, MUTATIONS, executeVisibilityAfterDurableSettlement,
  visibilityAfterDurableSettlementGuaranteeSatisfied };
