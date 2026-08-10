const DOMAINS = Object.freeze({
  capability_channel: {
    expected_success_state: "channel-authorized",
    createStore() {
      return {
        authority: { remaining_uses: 1, channel_enabled: true },
        alternate_authority: { remaining_uses: 1, channel_enabled: true },
        accepted_messages: []
      };
    },
    performValid(store, authorityKey) {
      const authority = store[authorityKey];
      const accepted = authority.remaining_uses > 0 && authority.channel_enabled;
      if (accepted) {
        authority.remaining_uses -= 1;
        store.accepted_messages.push("message");
      }
      return accepted ? "channel-authorized" : "channel-refused";
    }
  },
  tenant_lease: {
    expected_success_state: "tenant-write-accepted",
    createStore() {
      return {
        authority: { lease_active: true, remaining_operations: 1 },
        alternate_authority: { lease_active: true, remaining_operations: 1 },
        rows: []
      };
    },
    performValid(store, authorityKey) {
      const authority = store[authorityKey];
      const accepted = authority.lease_active && authority.remaining_operations > 0;
      if (accepted) {
        authority.remaining_operations -= 1;
        store.rows.push({ tenant: "authorized", value: 1 });
      }
      return accepted ? "tenant-write-accepted" : "tenant-write-refused";
    }
  },
  queue_permit: {
    expected_success_state: "queue-submission-accepted",
    createStore() {
      return {
        authority: { admission_slots: 1, permit_live: true },
        alternate_authority: { admission_slots: 1, permit_live: true },
        queue: []
      };
    },
    performValid(store, authorityKey) {
      const authority = store[authorityKey];
      const accepted = authority.permit_live && authority.admission_slots > 0;
      if (accepted) {
        authority.admission_slots -= 1;
        store.queue.push("job");
      }
      return accepted ? "queue-submission-accepted" : "queue-submission-refused";
    }
  }
});

function clone(value) {
  return structuredClone(value);
}

function consumeAuthority(authority) {
  if ("remaining_uses" in authority) authority.remaining_uses -= 1;
  if ("remaining_operations" in authority) authority.remaining_operations -= 1;
  if ("admission_slots" in authority) authority.admission_slots -= 1;
}

function executeScenario({
  domain = "capability_channel",
  strategy = "preserve"
} = {}) {
  const definition = DOMAINS[domain];
  if (!definition) throw new Error(`unknown failed-attempt domain ${domain}`);
  const store = definition.createStore();
  const events = [];
  const authorityStateBefore = clone(store.authority);
  events.push({ kind: "failed_attempt", authority: "authority" });

  if ([
    "consume_on_failure",
    "consume_then_restore",
    "replenish_after_observation"
  ].includes(strategy)) {
    consumeAuthority(store.authority);
    events.push({ kind: "authority_consumed", authority: "authority" });
  }
  if (strategy === "consume_then_restore") {
    store.authority = clone(authorityStateBefore);
    events.push({ kind: "authority_restored", authority: "authority" });
  }

  const refused = strategy !== "missing_refusal";
  if (refused) events.push({ kind: "refusal", attempt: "failed_attempt" });
  const authorityStateAfterRefusal = clone(store.authority);

  if (strategy === "replenish_after_observation") {
    store.authority = clone(authorityStateBefore);
    events.push({ kind: "authority_restored", authority: "authority" });
  }

  const validAuthority = strategy === "wrong_authority_later"
    ? "alternate_authority"
    : "authority";
  events.push({ kind: "valid_attempt", authority: validAuthority });
  const validResultState = strategy === "later_valid_fails"
    ? `${definition.expected_success_state}-forced-failure`
    : definition.performValid(store, validAuthority);
  const validAccepted = validResultState === definition.expected_success_state;
  events.push({
    kind: validAccepted ? "valid_result_accepted" : "valid_result_refused",
    authority: validAuthority
  });

  return {
    domain,
    strategy,
    store,
    events,
    authority_state_before: authorityStateBefore,
    authority_state_after_refusal: authorityStateAfterRefusal,
    authority_state_preserved:
      JSON.stringify(authorityStateBefore) === JSON.stringify(authorityStateAfterRefusal),
    refusal_observed: refused,
    valid_authority: validAuthority,
    same_authority_reused: validAuthority === "authority",
    valid_result_state: validResultState,
    expected_success_state: definition.expected_success_state,
    valid_result_accepted: validAccepted
  };
}

function implementationPassed(execution) {
  return execution.refusal_observed &&
    execution.authority_state_preserved &&
    execution.same_authority_reused &&
    execution.valid_result_accepted &&
    execution.valid_result_state === execution.expected_success_state;
}

export {
  DOMAINS,
  executeScenario,
  implementationPassed
};
