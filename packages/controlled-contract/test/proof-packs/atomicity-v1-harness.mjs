

class InjectedFailure extends Error {
  constructor(boundaryIndex) {
    super(`injected failure at boundary ${boundaryIndex}`);
    this.name = "InjectedFailure";
    this.boundaryIndex = boundaryIndex;
  }
}

function ledgerDomain() {
  return {
    name: "ledger",
    createStore: () => ({
      balances: { source: 500, destination: 100 },
      journal: [],
      auditWrites: 0
    }),
    effects: [
      {
        key: "source-debit",
        commit(store) {
          store.balances.source -= 100;
          store.journal.push({ entry: "source-debit", amount: -100 });
        },
        rollback(store) {
          store.balances.source += 100;
          store.journal = store.journal.filter(({ entry }) => entry !== "source-debit");
        },
        isCommitted: (store) =>
          store.journal.some(({ entry }) => entry === "source-debit") &&
          store.balances.source === 400,

        state(store) {
          const journalled = store.journal.some(({ entry }) => entry === "source-debit");
          const moved = store.balances.source === 400;
          if (journalled && moved) return "committed";
          if (!journalled && !moved) return "absent";
          return "torn";
        },
        tearCommit(store) {
          store.journal.push({ entry: "source-debit", amount: -100 });
        }
      },
      {
        key: "destination-credit",
        commit(store) {
          store.balances.destination += 100;
          store.journal.push({ entry: "destination-credit", amount: 100 });
        },
        rollback(store) {
          store.balances.destination -= 100;
          store.journal = store.journal.filter(
            ({ entry }) => entry !== "destination-credit"
          );
        },
        isCommitted: (store) =>
          store.journal.some(({ entry }) => entry === "destination-credit")
      }
    ]
  };
}

function catalogDomain() {
  return {
    name: "catalog",
    createStore: () => ({
      rows: { "sku-1": { price: 1000, version: 1 } },
      events: []
    }),
    effects: [
      {
        key: "row-update",
        commit(store) {
          store.rows["sku-1"] = { price: 1200, version: 2 };
        },
        rollback(store) {
          store.rows["sku-1"] = { price: 1000, version: 1 };
        },
        isCommitted: (store) => store.rows["sku-1"].version === 2
      },
      {
        key: "event-publication",
        commit(store) {
          store.events.push({ type: "price-changed", sku: "sku-1", price: 1200 });
        },
        rollback(store) {
          store.events = store.events.filter(({ type }) => type !== "price-changed");
        },
        isCommitted: (store) => store.events.some(({ type }) => type === "price-changed")
      }
    ]
  };
}

function platformDomain() {
  const resource = (key, value) => ({
    key,
    commit(store) {
      store.resources.set(key, value);
    },
    rollback(store) {
      store.resources.delete(key);
    },
    isCommitted: (store) => store.resources.has(key)
  });
  return {
    name: "platform",
    createStore: () => ({ resources: new Map(), appliedRevision: 0 }),
    effects: [
      resource("dns-record", { host: "api", target: "edge-2" }),
      resource("load-balancer-rule", { route: "/v2", pool: "green" }),
      resource("feature-flag", { flag: "v2-routing", enabled: true })
    ]
  };
}

const DOMAINS = { ledger: ledgerDomain, catalog: catalogDomain, platform: platformDomain };

function committedVector(domain, store) {
  return domain.effects.map((effect) => effect.isCommitted(store));
}

function stateVector(domain, store) {
  return domain.effects.map((effect) => effect.state
    ? effect.state(store)
    : effect.isCommitted(store) ? "committed" : "absent");
}

const STRATEGIES = {

  "rollback-on-boundary-failure"(context) {
    const { domain, store, boundaryIndex, trace, raise } = context;
    const applied = [];
    try {
      for (const [index, effect] of domain.effects.entries()) {
        if (index === boundaryIndex) raise();
        trace.push({ kind: "effect_attempt", index });
        effect.commit(store);
        applied.push(effect);
      }
    } catch (error) {
      if (!(error instanceof InjectedFailure)) throw error;
      context.snapshot();
      for (const effect of applied.reverse()) effect.rollback(store);
    }
  },

  "complete-forward-then-report-failure"(context) {
    const { domain, store, boundaryIndex, trace, raise } = context;
    for (const [index, effect] of domain.effects.entries()) {
      if (index === boundaryIndex) {
        try {
          raise();
        } catch (error) {
          if (!(error instanceof InjectedFailure)) throw error;
          context.reportedFailure = true;
        }
      }
      trace.push({ kind: "effect_attempt", index });
      effect.commit(store);
    }
  },

  "abandon-without-rollback"(context) {
    const { domain, store, boundaryIndex, trace, raise } = context;
    try {
      for (const [index, effect] of domain.effects.entries()) {
        if (index === boundaryIndex) raise();
        trace.push({ kind: "effect_attempt", index });
        effect.commit(store);
      }
    } catch (error) {
      if (!(error instanceof InjectedFailure)) throw error;
    }
  },

  "compensate-earlier-and-apply-later"(context) {
    const { domain, store, boundaryIndex, trace, raise } = context;
    const applied = [];
    try {
      for (const [index, effect] of domain.effects.entries()) {
        if (index === boundaryIndex) raise();
        trace.push({ kind: "effect_attempt", index });
        effect.commit(store);
        applied.push(effect);
      }
    } catch (error) {
      if (!(error instanceof InjectedFailure)) throw error;
      for (const effect of applied) effect.rollback(store);
      const later = domain.effects[boundaryIndex];
      trace.push({ kind: "effect_attempt", index: boundaryIndex });
      later.commit(store);
    }
  },

  "repair-after-settlement"(context) {
    STRATEGIES["abandon-without-rollback"](context);
    context.afterSettlement = (store) => {
      for (const effect of context.domain.effects) {
        if (!effect.isCommitted(store)) effect.commit(store);
      }
    };
  },

  "complete-forward-dropping-last-effect"(context) {
    const { domain, store, boundaryIndex, trace, raise } = context;
    const lastIndex = domain.effects.length - 1;
    for (const [index, effect] of domain.effects.entries()) {
      if (index === boundaryIndex) {
        try {
          raise();
        } catch (error) {
          if (!(error instanceof InjectedFailure)) throw error;
        }
      }
      if (index === lastIndex) continue;
      trace.push({ kind: "effect_attempt", index });
      effect.commit(store);
    }
  },

  "fail-before-first-effect"(context) {
    const { domain, store, trace, raise } = context;
    try {
      raise();
      for (const [index, effect] of domain.effects.entries()) {
        trace.push({ kind: "effect_attempt", index });
        effect.commit(store);
      }
    } catch (error) {
      if (!(error instanceof InjectedFailure)) throw error;
    }
  },

  "never-inject-failure"(context) {
    const { domain, store, trace } = context;
    for (const [index, effect] of domain.effects.entries()) {
      trace.push({ kind: "effect_attempt", index });
      effect.commit(store);
    }
  },

  "torn-write-on-boundary-failure"(context) {
    const { domain, store, boundaryIndex, trace, raise } = context;
    try {
      trace.push({ kind: "effect_attempt", index: 0 });
      domain.effects[0].tearCommit(store);
      if (boundaryIndex === 1) raise();
      trace.push({ kind: "effect_attempt", index: 1 });
      domain.effects[1].commit(store);
    } catch (error) {
      if (!(error instanceof InjectedFailure)) throw error;
    }
  },

  "rollback-with-audit-write"(context) {
    STRATEGIES["rollback-on-boundary-failure"](context);
    context.store.auditWrites += 1;
  }
};

function executeAttempt({
  domain: domainName = "ledger",
  strategy: strategyName = "rollback-on-boundary-failure",
  boundary_index: boundaryIndex = 1,
  store: suppliedStore = null
} = {}) {
  const domain = DOMAINS[domainName]();
  const store = suppliedStore ?? domain.createStore();
  const trace = [];
  const transientlyCommitted = [];
  const context = {
    domain,
    store,
    boundaryIndex,
    trace,
    afterSettlement: null,
    reportedFailure: false,
    snapshot() {
      transientlyCommitted.push(committedVector(domain, store));
    },
    raise() {
      trace.push({ kind: "failure_injected", boundary_index: boundaryIndex });
      throw new InjectedFailure(boundaryIndex);
    }
  };

  STRATEGIES[strategyName](context);
  trace.push({ kind: "settlement" });
  const settlementCommitted = committedVector(domain, store);
  const settlementStates = stateVector(domain, store);
  if (context.afterSettlement) context.afterSettlement(store);
  const observationCommitted = committedVector(domain, store);
  const observationStates = stateVector(domain, store);

  const failureIndex = trace.findIndex(({ kind }) => kind === "failure_injected");
  const firstAttemptIndex = trace.findIndex(
    ({ kind, index }) => kind === "effect_attempt" && index === 0
  );
  const secondAttemptIndex = trace.findIndex(
    ({ kind, index }) => kind === "effect_attempt" && index === 1
  );
  let boundaryPosition = "between";
  if (failureIndex === -1) boundaryPosition = "absent";
  else if (firstAttemptIndex === -1 || failureIndex < firstAttemptIndex) {
    boundaryPosition = "before_earlier";
  } else if (secondAttemptIndex !== -1 && failureIndex > secondAttemptIndex) {
    boundaryPosition = "after_later";
  }

  return {
    domain: domainName,
    strategy: strategyName,
    store,
    trace,
    settlement_committed: settlementCommitted,
    observation_committed: observationCommitted,
    settlement_states: settlementStates,
    observation_states: observationStates,
    transiently_committed: transientlyCommitted,
    failure_injected: failureIndex !== -1,
    settlement_follows_failure: failureIndex !== -1,
    boundary_position: boundaryPosition === "absent" ? "between" : boundaryPosition,
    observation_drifted: settlementStates.some(
      (value, index) => value !== observationStates[index]
    )
  };
}

function runForFixture(execution) {
  return {
    settlement_committed: execution.settlement_committed,
    observation_committed: execution.observation_committed,
    settlement_states: execution.settlement_states,
    observation_states: execution.observation_states,
    failure_injected: execution.failure_injected,
    settlement_follows_failure: execution.settlement_follows_failure,
    boundary_position: execution.boundary_position
  };
}

export {
  DOMAINS,
  InjectedFailure,
  STRATEGIES,
  committedVector,
  executeAttempt,
  runForFixture,
  stateVector
};
