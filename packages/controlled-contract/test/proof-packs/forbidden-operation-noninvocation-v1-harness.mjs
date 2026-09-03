const DOMAINS = Object.freeze({
  "slice-review": {
    subject: "prepareSliceReviewSurface",
    context: "worktree-identity-binding.v2-checkout-mode-full",
    forbidden: ["assertFullIndexShape", "readSparseCheckoutConfiguration"],
    observed: ["physicalTreeFromIsolatedIndex", "reconcileOrdinaryIndexTree"]
  },
  "request-routing": {
    subject: "routeRequest",
    context: "canonical-router-v3",
    forbidden: ["legacyHttpTransport", "directDatabaseFallback"],
    observed: ["canonicalTransport"]
  },
  "artifact-publication": {
    subject: "publishArtifact",
    context: "hermetic-publication",
    forbidden: ["walkHostHome", "scanHiddenIndex", "readAmbientRegistry"],
    observed: ["readDeclaredArtifact", "writeDeclaredDestination"]
  }
});

const MUTATIONS = Object.freeze({
  "first-forbidden-operation-restored": (run) => run.observed.push(run.forbidden[0]),
  "last-forbidden-operation-restored": (run) => run.observed.push(run.forbidden.at(-1)),
  "multiple-forbidden-operations-restored": (run) => run.observed.push(...run.forbidden),
  "forbidden-operation-after-allowed-call": (run) => {
    run.observed.push("allowedIntermediateOperation", run.forbidden[0]);
  }
});

function executeForbiddenOperationNoninvocation({ domain = "slice-review", mutant = null } = {}) {
  const selected = DOMAINS[domain];
  if (!selected) throw new TypeError(`unknown forbidden-operation domain: ${domain}`);
  const run = structuredClone({ domain, ...selected });
  if (mutant !== null) {
    const mutate = MUTATIONS[mutant];
    if (!mutate) throw new TypeError(`unknown forbidden-operation mutant: ${mutant}`);
    mutate(run);
  }
  return run;
}

function forbiddenOperationNoninvocationGuaranteeSatisfied(run) {
  return run.forbidden.length > 0 && !run.observed.some(
    (operation) => run.forbidden.includes(operation)
  );
}

export {
  DOMAINS,
  MUTATIONS,
  executeForbiddenOperationNoninvocation,
  forbiddenOperationNoninvocationGuaranteeSatisfied
};
