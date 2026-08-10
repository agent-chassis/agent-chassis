const DOMAINS = Object.freeze({
  filesystem: Object.freeze({
    observed: Object.freeze(["file:config/app.json"]),
    authorized: Object.freeze(["file:config/app.json", "file:cache/index.json"])
  }),
  database: Object.freeze({
    observed: Object.freeze(["row:orders/42", "row:ledger/42"]),
    authorized: Object.freeze(["row:orders/42", "row:ledger/42", "row:outbox/42"])
  }),
  kubernetes: Object.freeze({
    observed: Object.freeze(["kube:deployment/api"]),
    authorized: Object.freeze(["kube:deployment/api", "kube:configmap/api"])
  })
});

const MUTATIONS = Object.freeze({
  "extra-unauthorized-mutation": ({ observed }) => ({
    observed: [...observed, "target:unauthorized"],
    declaredObserved: [...observed, "target:unauthorized"],
    observedCount: observed.length + 1
  }),
  "nonempty-observed-empty-authorized": ({ observed }) => ({
    observed: observed.length === 0 ? ["target:unauthorized"] : [...observed],
    declaredObserved: observed.length === 0 ? ["target:unauthorized"] : [...observed],
    authorized: [],
    declaredAuthorized: [],
    authorizedCount: 0
  }),
  "same-count-member-substitution": ({ observed, authorized }) => ({
    observed: [...observed.slice(0, -1), "target:substituted"],
    declaredObserved: [...observed.slice(0, -1), "target:substituted"],
    authorized: authorized.length === observed.length
      ? [...authorized]
      : [...authorized.slice(0, observed.length)],
    declaredAuthorized: authorized.length === observed.length
      ? [...authorized]
      : [...authorized.slice(0, observed.length)],
    authorizedCount: observed.length
  }),
  "observed-count-mismatch": ({ observed }) => ({ observedCount: observed.length + 1 }),
  "authorized-count-mismatch": ({ authorized }) => ({
    authorizedCount: authorized.length + 1
  }),
  "observed-population-omission": ({ observed }) => ({
    declaredObserved: observed.slice(0, -1),
    observedCount: observed.length
  }),
  "authorized-population-omission": ({ authorized }) => ({
    declaredAuthorized: authorized.slice(0, -1),
    authorizedCount: authorized.length
  }),
  "same-count-authorized-substitution": ({ observed, authorized }) => ({
    observed: [...observed],
    authorized: ["target:different-authorized-member", ...authorized.slice(1)],
    declaredAuthorized: [
      "target:different-authorized-member", ...authorized.slice(1)
    ]
  })
});

function executeWriteConfinement({ domain = "filesystem", mutant = null } = {}) {
  const selected = DOMAINS[domain];
  if (!selected) throw new TypeError(`unknown write-confinement domain: ${domain}`);
  const execution = {
    domain,
    observed: [...selected.observed],
    authorized: [...selected.authorized],
    declaredObserved: [...selected.observed],
    declaredAuthorized: [...selected.authorized],
    observedCount: selected.observed.length,
    authorizedCount: selected.authorized.length
  };
  if (mutant === null) return execution;
  const mutate = MUTATIONS[mutant];
  if (!mutate) throw new TypeError(`unknown write-confinement mutant: ${mutant}`);
  Object.assign(execution, mutate(execution));
  return execution;
}

function writeConfinementGuaranteeSatisfied(execution) {
  if (execution.observedCount !== execution.declaredObserved.length) return false;
  if (execution.authorizedCount !== execution.declaredAuthorized.length) return false;
  const authorized = new Set(execution.declaredAuthorized);
  return execution.declaredObserved.every((target) => authorized.has(target));
}

export {
  DOMAINS,
  MUTATIONS,
  executeWriteConfinement,
  writeConfinementGuaranteeSatisfied
};
