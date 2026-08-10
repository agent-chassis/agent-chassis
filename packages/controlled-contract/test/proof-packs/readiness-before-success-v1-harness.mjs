const DOMAINS = Object.freeze({
  message_broker: {
    expected_ready_state: "publish-accepted",
    createCapability() {
      return { connected: false, published: [] };
    },
    makeReady(capability) {
      capability.connected = true;
    },
    makeUnready(capability) {
      capability.connected = false;
    },
    probe(capability) {
      if (!capability.connected) return "publish-refused";
      capability.published.push("readiness-probe");
      return "publish-accepted";
    }
  },
  database_pool: {
    expected_ready_state: "query-accepted",
    createCapability() {
      return { accepting_queries: false, queries: [] };
    },
    makeReady(capability) {
      capability.accepting_queries = true;
    },
    makeUnready(capability) {
      capability.accepting_queries = false;
    },
    probe(capability) {
      if (!capability.accepting_queries) return "query-refused";
      capability.queries.push("select-1");
      return "query-accepted";
    }
  },
  inference_worker: {
    expected_ready_state: "inference-accepted",
    createCapability() {
      return { model_loaded: false, inferences: [] };
    },
    makeReady(capability) {
      capability.model_loaded = true;
    },
    makeUnready(capability) {
      capability.model_loaded = false;
    },
    probe(capability) {
      if (!capability.model_loaded) return "inference-refused";
      capability.inferences.push("readiness-probe");
      return "inference-accepted";
    }
  }
});

function executeScenario({
  domain = "message_broker",
  strategy = "ready_before_report"
} = {}) {
  const definition = DOMAINS[domain];
  if (!definition) throw new Error(`unknown readiness domain ${domain}`);
  const capability = definition.createCapability();
  const alternateCapability = definition.createCapability();
  const events = [{ kind: "initialization_attempt", time: 0 }];
  let readinessProbeTime = null;
  let readinessResultTime = null;
  let completionTime = null;
  let readinessState = null;
  let probeTarget = "capability";
  let probeExecuted = false;
  let probeAccepted = false;
  let completionObserved = true;
  let completionStatus = 200;

  if (strategy === "success_status_only") {
    completionTime = 1;
    events.push({ kind: "completion_report", time: completionTime, status: 200 });
  } else {
    if (strategy === "premature_completion") {
      completionTime = 1;
      events.push({ kind: "completion_report", time: completionTime, status: 200 });
    }

    if (strategy !== "probe_fails") definition.makeReady(capability);
    if (strategy === "wrong_capability") {
      definition.makeReady(alternateCapability);
      probeTarget = "alternate_capability";
    }
    events.push({ kind: "capability_transition", time: 1, ready: true });

    readinessProbeTime = strategy === "premature_completion" ? 2 : 1;
    probeExecuted = true;
    events.push({
      kind: "readiness_probe",
      time: readinessProbeTime,
      target: probeTarget
    });
    readinessState = definition.probe(
      probeTarget === "capability" ? capability : alternateCapability
    );
    probeAccepted = readinessState === definition.expected_ready_state;
    readinessResultTime = strategy === "premature_completion" ? 3 : 2;
    events.push({
      kind: "readiness_result",
      time: readinessResultTime,
      state: readinessState,
      accepted: probeAccepted
    });

    if (strategy === "regress_before_completion") {
      definition.makeUnready(capability);
      events.push({ kind: "capability_transition", time: 2.5, ready: false });
    }
    if (strategy === "missing_completion") {
      completionObserved = false;
      completionStatus = null;
    } else if (strategy !== "premature_completion") {
      completionTime = strategy === "ready_at_report" ? readinessResultTime : 3;
      events.push({ kind: "completion_report", time: completionTime, status: 200 });
    }
  }

  return {
    domain,
    strategy,
    capability,
    alternate_capability: alternateCapability,
    events,
    expected_ready_state: definition.expected_ready_state,
    observed_ready_state: readinessState,
    readiness_probe_time: readinessProbeTime,
    readiness_result_time: readinessResultTime,
    completion_time: completionTime,
    completion_status: completionStatus,
    completion_observed: completionObserved,
    probe_target: probeTarget,
    probe_executed: probeExecuted,
    probe_accepted: probeAccepted,
    ready_at_or_before_completion: completionObserved && probeAccepted &&
      readinessResultTime !== null && readinessResultTime <= completionTime
  };
}

function implementationPassed(execution) {
  return execution.completion_observed &&
    execution.probe_executed &&
    execution.probe_target === "capability" &&
    execution.probe_accepted &&
    execution.observed_ready_state === execution.expected_ready_state &&
    execution.ready_at_or_before_completion;
}

export {
  DOMAINS,
  executeScenario,
  implementationPassed
};
