const POSITIVE_DOMAINS = Object.freeze({
  "unauthorized-capability-channel-configuration": {
    operation: "capability:publish-protected-channel",
    subject: "principal:unauthorized-service",
    protected_effects: ["channel:protected", "configuration:channel-policy"]
  },
  "cross-tenant-record-store-secondary-index": {
    operation: "operation:create-cross-tenant-record",
    subject: "tenant:foreign-writer",
    protected_effects: ["store:tenant-records", "index:tenant-records-by-owner"]
  },
  "unauthenticated-queue-deduplication": {
    operation: "operation:submit-unauthenticated-job",
    subject: "principal:anonymous",
    protected_effects: ["queue:pending-jobs", "state:deduplication-keys"]
  }
});

function createExecution(domain) {
  return {
    declared: {
      attempt_id: `attempt:${domain.operation}`,
      operation: domain.operation,
      subject: domain.subject,
      subject_authorized: false,
      refusal_id: `refusal:${domain.operation}`,
      protected_interval_id: `interval:${domain.operation}`,
      protected_effects: [...domain.protected_effects]
    },
    observed: {
      attempt_id: `attempt:${domain.operation}`,
      refusal_id: `refusal:${domain.operation}`,
      operation: domain.operation,
      protected_effects: [...domain.protected_effects]
    },
    timeline: {
      attempt: 10,
      protected_interval: 20,
      refusal: 30
    },
    refusal: {
      rejects_attempt_id: `attempt:${domain.operation}`
    },
    effects: [],
    state: new Map(domain.protected_effects.map((resource) => [resource, "unchanged"]))
  };
}

function recordEffect(execution, {
  attempt_id: attemptId = execution.declared.attempt_id,
  operator,
  resource,
  time = 25,
  value = "changed"
}) {
  execution.effects.push({ attempt_id: attemptId, operator, resource, time });
  execution.state.set(resource, value);
}

function refusalBeforeEffectsOracle(execution) {
  const declared = execution.declared;
  const observed = execution.observed;
  const protectedEffects = new Set(declared.protected_effects);
  const observedEffects = new Set(observed.protected_effects);
  const forbiddenEffects = execution.effects.filter((effect) =>
    effect.attempt_id === declared.attempt_id &&
    effect.time < execution.timeline.refusal &&
    protectedEffects.has(effect.resource) &&
    (effect.operator === "write" || effect.operator === "mutate")
  );
  const sameObservedPopulation =
    observedEffects.size === protectedEffects.size &&
    [...protectedEffects].every((effect) => observedEffects.has(effect));
  const passed =
    declared.subject_authorized === false &&
    execution.refusal.rejects_attempt_id === declared.attempt_id &&
    execution.timeline.attempt < execution.timeline.protected_interval &&
    execution.timeline.protected_interval < execution.timeline.refusal &&
    observed.attempt_id === declared.attempt_id &&
    observed.refusal_id === declared.refusal_id &&
    observed.operation === declared.operation &&
    sameObservedPopulation &&
    forbiddenEffects.length === 0;
  return {
    passed,
    forbidden_effect_count: forbiddenEffects.length,
    forbidden_effects: forbiddenEffects
  };
}

function executePositiveDomain(domainId) {
  const execution = createExecution(POSITIVE_DOMAINS[domainId]);
  execution.effects.push({
    attempt_id: execution.declared.attempt_id,
    operator: "write",
    resource: "log:authorization-refusals",
    time: 28
  });
  return { execution, oracle: refusalBeforeEffectsOracle(execution) };
}

const EXECUTED_MUTANTS = Object.freeze({
  "protected-write-before-refusal"(execution) {
    recordEffect(execution, {
      operator: "write",
      resource: execution.declared.protected_effects[0]
    });
  },
  "protected-mutation-before-refusal"(execution) {
    recordEffect(execution, {
      operator: "mutate",
      resource: execution.declared.protected_effects[1] ??
        execution.declared.protected_effects[0]
    });
  },
  "mutation-followed-by-rollback"(execution) {
    const resource = execution.declared.protected_effects[0];
    const before = execution.state.get(resource);
    recordEffect(execution, { operator: "mutate", resource, value: "temporary" });
    execution.state.set(resource, before);
  },
  "refusal-after-protected-effect"(execution) {
    recordEffect(execution, {
      operator: "write",
      resource: execution.declared.protected_effects[0],
      time: execution.timeline.refusal - 1
    });
  }
});

function executeMutant(mutantId) {
  const execution = createExecution(
    POSITIVE_DOMAINS["cross-tenant-record-store-secondary-index"]
  );
  EXECUTED_MUTANTS[mutantId](execution);
  return { execution, oracle: refusalBeforeEffectsOracle(execution) };
}

export {
  EXECUTED_MUTANTS,
  POSITIVE_DOMAINS,
  createExecution,
  executeMutant,
  executePositiveDomain,
  recordEffect,
  refusalBeforeEffectsOracle
};
