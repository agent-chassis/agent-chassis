const SINGLE_USE_DOMAINS = Object.freeze({
  password_reset: {
    before: { credential: "old" },
    after: { credential: "new" },
    result: "credential-reset"
  },
  queue_permit: {
    before: { jobs: [] },
    after: { jobs: ["job-1"] },
    result: "job-admitted"
  },
  voucher_claim: {
    before: { credit: 0 },
    after: { credit: 25 },
    result: "voucher-claimed"
  }
});

function executeSingleUseScenario({
  domain = "password_reset",
  strategy = "correct"
} = {}) {
  const definition = SINGLE_USE_DOMAINS[domain];
  if (!definition) throw new Error(`unknown single-use domain ${domain}`);
  let live = true;
  let state = structuredClone(definition.before);
  const firstAccepted = strategy !== "first_refused";
  const effects = [];

  if (firstAccepted) {
    live = [
      "authority_remains_live", "manual_refusal_with_live_authority"
    ].includes(strategy);
    if (strategy !== "first_no_effect") {
      state = structuredClone(definition.after);
      effects.push("effect-1");
      if (strategy === "two_effects_on_first") effects.push("effect-2");
    }
  }
  const afterFirst = structuredClone(state);
  let replayAccepted = live || strategy === "replay_accepted";
  if (strategy === "manual_refusal_with_live_authority") replayAccepted = false;
  if (["duplicate_on_refused_replay", "duplicate_then_restore"].includes(strategy)) {
    effects.push("effect-replay");
    state = { ...structuredClone(state), replay_mutation: true };
  }
  if (replayAccepted) {
    effects.push("effect-replay");
    state = { ...structuredClone(state), replay_mutation: true };
  }
  if (strategy === "duplicate_then_restore") state = structuredClone(afterFirst);

  return {
    domain,
    strategy,
    first_accepted: firstAccepted,
    replay_accepted: replayAccepted,
    authority_consumed: !live,
    state_before: structuredClone(definition.before),
    state_after_first: afterFirst,
    state_after_replay: structuredClone(state),
    effects,
    expected_result: definition.result
  };
}

function singleUseImplementationPassed(execution) {
  return execution.first_accepted && execution.authority_consumed &&
    !execution.replay_accepted &&
    JSON.stringify(execution.state_before) !==
      JSON.stringify(execution.state_after_first) &&
    JSON.stringify(execution.state_after_first) ===
      JSON.stringify(execution.state_after_replay) &&
    execution.effects.length === 1;
}

export {
  SINGLE_USE_DOMAINS,
  executeSingleUseScenario,
  singleUseImplementationPassed
};
