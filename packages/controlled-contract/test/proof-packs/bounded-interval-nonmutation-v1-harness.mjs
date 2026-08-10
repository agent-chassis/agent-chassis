const DOMAINS = Object.freeze({
  "database-snapshot": { actor: "process:snapshot", resources: ["row:account/7"] },
  "credential-audit": { actor: "actor:auditor", resources: ["secret:a", "secret:b", "secret:c"] },
  "artifact-publication": { actor: "runtime:publisher", resources:
    ["artifact:1", "artifact:2", "artifact:3", "artifact:4", "artifact:5", "artifact:6"] }
});
const MUTATIONS = Object.freeze({
  "during-interval-write": (run) => run.actions.push({ actor: run.actor, resource: run.resources[0], kind: "write", time: 2 }),
  "during-interval-mutation": (run) => run.actions.push({ actor: run.actor, resource: run.resources[0], kind: "mutate", time: 2 }),
  "mutate-then-restore": (run) => { run.actions.push(
    { actor: run.actor, resource: run.resources[0], kind: "mutate", time: 2 },
    { actor: run.actor, resource: run.resources[0], kind: "write", time: 3 }); },
  "wrong-actor-observation": (run) => { run.observedActor = "actor:other";
    run.actions.push({ actor: run.actor, resource: run.resources[0], kind: "mutate", time: 2 }); },
  "partial-protected-population": (run) => { run.observedResources = run.resources.slice(0, 1);
    run.actions.push({ actor: run.actor, resource: run.resources.at(-1), kind: "write", time: 2 }); },
  "collapsed-boundaries": (run) => { run.end = run.start; },
  "reversed-boundaries": (run) => { run.start = 4; run.end = 1; }
});
function executeBoundedIntervalNonmutation({ domain = "database-snapshot", mutant = null } = {}) {
  const selected = DOMAINS[domain];
  if (!selected) throw new TypeError(`unknown bounded-nonmutation domain: ${domain}`);
  const before = Object.fromEntries(selected.resources.map((id) => [id, "stable"]));
  const run = { domain, actor: selected.actor, observedActor: selected.actor,
    resources: [...selected.resources], observedResources: [...selected.resources],
    start: 1, end: 4, actions: [], before, after: structuredClone(before) };
  if (mutant !== null) { const mutate = MUTATIONS[mutant];
    if (!mutate) throw new TypeError(`unknown bounded-nonmutation mutant: ${mutant}`);
    mutate(run); }
  return run;
}
function boundedIntervalNonmutationGuaranteeSatisfied(run) {
  const samePopulation = run.resources.length > 0 && run.observedResources.length === run.resources.length &&
    run.resources.every((id) => run.observedResources.includes(id));
  const forbidden = run.actions.some((action) => action.actor === run.actor &&
    run.resources.includes(action.resource) && action.time >= run.start && action.time <= run.end &&
    ["write", "mutate"].includes(action.kind));
  return run.start < run.end && run.observedActor === run.actor && samePopulation && !forbidden;
}
export { DOMAINS, MUTATIONS, executeBoundedIntervalNonmutation,
  boundedIntervalNonmutationGuaranteeSatisfied };
