const DOMAINS = Object.freeze({
  search_session: {
    protected_state: "query:newest:page-2",
    success_state: "results:complete",
    cancelled_state: "search:cancelled"
  },
  media_transcode: {
    protected_state: "segment:42:encoded",
    success_state: "rendition:published",
    cancelled_state: "transcode:cancelled"
  },
  deployment_rollout: {
    protected_state: "replica-set:v2:healthy",
    success_state: "rollout:v2:complete",
    cancelled_state: "rollout:v1:cancelled"
  }
});

function executeScenario({
  domain = "search_session",
  strategy = "isolated_cancellation"
} = {}) {
  const definition = DOMAINS[domain];
  if (!definition) throw new Error(`unknown cancellation-isolation domain ${domain}`);
  const generations = {
    cancelled: { id: `${domain}:generation-a`, state: "running" },
    surviving: { id: `${domain}:generation-b`, state: "running" }
  };
  const protectedResource = { state: definition.protected_state };
  const authority = { valid: true };
  const events = [
    { kind: "cancelled_attempt", generation: generations.cancelled.id, time: 0 },
    { kind: "surviving_attempt", generation: generations.surviving.id, time: 1 }
  ];
  let cancellationTarget = "cancelled";
  let cancellationAccepted = true;
  let survivingResultAccepted = true;
  let survivingResultObserved = true;

  if (strategy === "status_only") return {
    domain,
    strategy,
    events: [{ kind: "status", status: 200, time: 0 }],
    generations,
    protected_state_before: protectedResource.state,
    protected_state_after: null,
    authority_valid_after: null,
    cancellation_target: null,
    cancellation_accepted: false,
    cancelled_observed_state: null,
    expected_cancelled_state: definition.cancelled_state,
    surviving_result_observed: false,
    surviving_result_accepted: false,
    observed_success_state: null,
    expected_success_state: definition.success_state
  };

  const stateBefore = protectedResource.state;
  if (strategy === "wrong_generation_target") cancellationTarget = "surviving";
  events.push({ kind: "cancellation_request", target: cancellationTarget, time: 2 });
  const target = generations[cancellationTarget];
  target.state = definition.cancelled_state;
  if (strategy === "cancelled_attempt_continues") {
    generations.cancelled.state = "running";
    cancellationAccepted = false;
  }
  if (strategy === "shared_state_corruption") {
    protectedResource.state = `${definition.protected_state}:corrupted`;
  }
  if (strategy === "shared_authority_revocation") authority.valid = false;
  events.push({
    kind: "cancellation_result",
    target: cancellationTarget,
    accepted: cancellationAccepted,
    time: 3
  });

  if (strategy === "survivor_result_missing") {
    survivingResultObserved = false;
    survivingResultAccepted = false;
  } else {
    if (strategy === "survivor_fails") survivingResultAccepted = false;
    generations.surviving.state = survivingResultAccepted
      ? definition.success_state
      : "failed";
    events.push({
      kind: "surviving_result",
      accepted: survivingResultAccepted,
      state: generations.surviving.state,
      time: 4
    });
  }

  return {
    domain,
    strategy,
    events,
    generations,
    protected_state_before: stateBefore,
    protected_state_after: protectedResource.state,
    authority_valid_after: authority.valid,
    cancellation_target: cancellationTarget,
    cancellation_accepted: cancellationAccepted,
    cancelled_observed_state: generations.cancelled.state,
    expected_cancelled_state: definition.cancelled_state,
    surviving_result_observed: survivingResultObserved,
    surviving_result_accepted: survivingResultAccepted,
    observed_success_state: survivingResultObserved ? generations.surviving.state : null,
    expected_success_state: definition.success_state
  };
}

function implementationPassed(execution) {
  return execution.cancellation_target === "cancelled" &&
    execution.cancellation_accepted &&
    execution.cancelled_observed_state === execution.expected_cancelled_state &&
    execution.protected_state_after === execution.protected_state_before &&
    execution.authority_valid_after === true &&
    execution.surviving_result_observed &&
    execution.surviving_result_accepted &&
    execution.observed_success_state === execution.expected_success_state;
}

export { DOMAINS, executeScenario, implementationPassed };
