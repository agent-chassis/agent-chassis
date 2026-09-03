

import assert from "node:assert/strict";
import test from "node:test";

import {
  ATTEMPT_EVENT_KINDS,
  admitAttemptCommand
} from "../../packages/agent-launch-core/src/lib/managed-worker-attempt-journal.mjs";

import {
  INTEGRATION_INCOMPLETE,
  INTEGRATION_NEXT_ACTIONS,
  INTEGRATION_PREFIXES,
  admitIntegrationIntent,
  integrationBindingDigest,
  partitionIntegrationHops,
  reduceIntegrationSettlement
} from "../../packages/agent-launch-core/src/lib/managed-worker-integration-settlement.mjs";

const REPO = "agent-chassis/agent-chassis";
const SUBJECT = "WK-2358#SLICE-005";
const GENERATION = `sha256:${"a".repeat(64)}`;
const WK_TIP = "b".repeat(40);
const EXPECTED_SLICE_TIP = "c".repeat(40);
const DELIVERY = "d".repeat(40);
const DELIVERY_TREE = "e".repeat(40);
const RECORD_DIGEST = `sha256:${"f".repeat(64)}`;
const NEXT_RECORD_DIGEST = `sha256:${"1".repeat(64)}`;
const ACTION_ID = "coord-action-1";

const ATTEMPT = Object.freeze({
  assigned_unit: SUBJECT,
  launch_ref: "refs/agent/launch/1",
  run_id: "run-1",
  retry_id: 0
});

function resolvedBinding(overrides = {}) {
  return {
    coordinator_action_id: ACTION_ID,
    resolved_binding_digest: null,
    delivery_commit: DELIVERY,
    delivery_tree: DELIVERY_TREE,
    slice_ref: "refs/agent/slice/WK-2358/SLICE-005",
    wk_ref: "refs/agent/wk/WK-2358",
    expected_wk_tip: WK_TIP,
    expected_slice_tip: EXPECTED_SLICE_TIP,
    canonical_record_digest: RECORD_DIGEST,
    status_target: "done",
    contract_generation: GENERATION,
    predecessor_completion_digest: null,
    ...overrides
  };
}

function intentPayload(overrides = {}) {
  const admitted = admitIntegrationIntent({
    coordinatorAuthenticated: true,
    coordinatorActionId: ACTION_ID,
    resolvedBinding: resolvedBinding(overrides)
  });
  assert.equal(admitted.admitted, true, JSON.stringify(admitted.refusal));
  return admitted.payload;
}

function buildHop(steps, { bindingOverrides = {} } = {}) {
  let events = [];
  const base = [
    [ATTEMPT_EVENT_KINDS.RESERVATION_CLAIMED, {}],
    [ATTEMPT_EVENT_KINDS.PENDING_PUBLISHED, {}],
    [ATTEMPT_EVENT_KINDS.SUPERVISOR_BOUND, {}],
    [ATTEMPT_EVENT_KINDS.SPAWN_STARTED, {}],
    [ATTEMPT_EVENT_KINDS.SANDBOX_BOUND, {}],
    [ATTEMPT_EVENT_KINDS.EXECUTION_TERMINATED, {}],
    [ATTEMPT_EVENT_KINDS.DELIVERY_OBSERVED, {}]
  ];
  for (const [kind, payload] of [...base, ...steps]) {
    const result = admitAttemptCommand({
      repository: REPO, subject: SUBJECT, events, attempt: ATTEMPT, kind, payload,
      generationDigest: kind === ATTEMPT_EVENT_KINDS.RESERVATION_CLAIMED ? GENERATION : null,
      wkTip: kind === ATTEMPT_EVENT_KINDS.RESERVATION_CLAIMED ? WK_TIP : null
    });
    assert.equal(result.admitted, true, `${kind}: ${JSON.stringify(result.refusal)}`);
    events = result.events;
  }
  return events.filter((event) => event.kind.startsWith("integration_"));
}

const INTENT_STEP = () => [ATTEMPT_EVENT_KINDS.INTEGRATION_INTENT, intentPayload()];
const GIT_STEP = (tip = DELIVERY) => [ATTEMPT_EVENT_KINDS.INTEGRATION_GIT_EFFECT, {
  prior_tip: EXPECTED_SLICE_TIP, resulting_tip: tip, applied_cas: true
}];
const STATUS_STEP = (digest = NEXT_RECORD_DIGEST) => [ATTEMPT_EVENT_KINDS.INTEGRATION_STATUS_EFFECT, {
  prior_digest: RECORD_DIGEST, resulting_digest: digest, status: "done"
}];

const GIT_AT = (tip) => ({ tip, readable: true, delivery_ancestor_of_tip: true });
const RECORD_AT = (digest, status = "review") => ({ digest, status, readable: true });

test("row 1 — no intent performs no integration mutation", () => {
  const result = reduceIntegrationSettlement({ integrationEvents: [] });
  assert.equal(result.prefix, INTEGRATION_PREFIXES.NO_INTENT);
  assert.equal(result.next_action.kind, INTEGRATION_NEXT_ACTIONS.NONE);
});

test("row 2 — intent only with the expected tip applies the Git CAS", () => {
  const hop = buildHop([INTENT_STEP()]);
  const result = reduceIntegrationSettlement({
    integrationEvents: hop,
    observations: { git: GIT_AT(EXPECTED_SLICE_TIP) }
  });
  assert.equal(result.prefix, INTEGRATION_PREFIXES.INTENT_ONLY);
  assert.equal(result.next_action.kind, INTEGRATION_NEXT_ACTIONS.APPLY_GIT_CAS);
  assert.equal(result.next_action.detail.delivery_commit, DELIVERY);
});

test("row 3 — Git already moved to OUR delivery records the equivalent winner", () => {
  const hop = buildHop([INTENT_STEP()]);
  const result = reduceIntegrationSettlement({
    integrationEvents: hop,
    observations: { git: GIT_AT(DELIVERY) }
  });
  assert.equal(result.next_action.kind, INTEGRATION_NEXT_ACTIONS.RECORD_GIT_EQUIVALENT_WINNER);
  assert.equal(result.incomplete, null);
});

test("row 3 conflict — Git moved to a foreign tip fails closed and never compensates", () => {
  const hop = buildHop([INTENT_STEP()]);
  const result = reduceIntegrationSettlement({
    integrationEvents: hop,
    observations: { git: GIT_AT("9".repeat(40)) }
  });
  assert.equal(result.settled, false);
  assert.equal(result.incomplete.code, INTEGRATION_INCOMPLETE.GIT_CONFLICTING_WINNER);
  assert.equal(result.next_action.kind, INTEGRATION_NEXT_ACTIONS.NONE,
    "a conflicting winner must produce NO mutation — no rollback, no compensation");
});

test("row 4 — Git effect recorded, record unchanged, applies the canonical CAS", () => {
  const hop = buildHop([INTENT_STEP(), GIT_STEP()]);
  const result = reduceIntegrationSettlement({
    integrationEvents: hop,
    observations: { git: GIT_AT(DELIVERY), record: RECORD_AT(RECORD_DIGEST) }
  });
  assert.equal(result.prefix, INTEGRATION_PREFIXES.GIT_EFFECT_RECORDED);
  assert.equal(result.next_action.kind, INTEGRATION_NEXT_ACTIONS.APPLY_STATUS_CAS);
});

test("row 5 — record already at the intended status records the equivalent transition", () => {
  const hop = buildHop([INTENT_STEP(), GIT_STEP()]);
  const result = reduceIntegrationSettlement({
    integrationEvents: hop,
    observations: { git: GIT_AT(DELIVERY), record: RECORD_AT(NEXT_RECORD_DIGEST, "done") }
  });
  assert.equal(result.next_action.kind, INTEGRATION_NEXT_ACTIONS.RECORD_STATUS_EQUIVALENT);
});

test("row 5 conflict — record moved to a different status fails closed", () => {
  const hop = buildHop([INTENT_STEP(), GIT_STEP()]);
  const result = reduceIntegrationSettlement({
    integrationEvents: hop,
    observations: { git: GIT_AT(DELIVERY), record: RECORD_AT(NEXT_RECORD_DIGEST, "cancelled") }
  });
  assert.equal(result.incomplete.code, INTEGRATION_INCOMPLETE.STATUS_CONFLICTING_TRANSITION);
  assert.equal(result.next_action.kind, INTEGRATION_NEXT_ACTIONS.NONE);
});

test("row 6 — both effects recorded re-authenticates both, then appends completion", () => {
  const hop = buildHop([INTENT_STEP(), GIT_STEP(), STATUS_STEP()]);
  const result = reduceIntegrationSettlement({
    integrationEvents: hop,
    observations: { git: GIT_AT(DELIVERY), record: RECORD_AT(NEXT_RECORD_DIGEST, "done") }
  });
  assert.equal(result.prefix, INTEGRATION_PREFIXES.STATUS_EFFECT_RECORDED);
  assert.equal(result.next_action.kind, INTEGRATION_NEXT_ACTIONS.APPEND_COMPLETION);
});

test("row 7 — completion present returns a byte-stable settlement with no mutation", () => {
  const hop = buildHop([INTENT_STEP(), GIT_STEP(), STATUS_STEP(),
    [ATTEMPT_EVENT_KINDS.INTEGRATION_COMPLETED, { intent_digest: "i", git_effect_digest: "g", status_effect_digest: "s" }]]);
  const first = reduceIntegrationSettlement({ integrationEvents: hop, observations: {} });
  const second = reduceIntegrationSettlement({ integrationEvents: hop, observations: { git: GIT_AT("z".repeat(40)) } });
  assert.equal(first.settled, true);
  assert.equal(first.next_action.kind, INTEGRATION_NEXT_ACTIONS.SETTLED);
  assert.deepEqual(first, second, "a completed hop is byte-stable regardless of later observations");
});

test("an unreadable Git observation is indeterminate, never 'unchanged'", () => {
  const hop = buildHop([INTENT_STEP()]);
  const result = reduceIntegrationSettlement({
    integrationEvents: hop, observations: { git: { tip: null, readable: false } }
  });
  assert.equal(result.incomplete.code, INTEGRATION_INCOMPLETE.GIT_EFFECT_UNREADABLE);
});

test("an unreadable canonical record is indeterminate", () => {
  const hop = buildHop([INTENT_STEP(), GIT_STEP()]);
  const result = reduceIntegrationSettlement({
    integrationEvents: hop,
    observations: { git: GIT_AT(DELIVERY), record: { digest: null, status: null, readable: false } }
  });
  assert.equal(result.incomplete.code, INTEGRATION_INCOMPLETE.STATUS_EFFECT_UNREADABLE);
});

test("Git moving away from a recorded effect before completion is moved authority", () => {
  const hop = buildHop([INTENT_STEP(), GIT_STEP(), STATUS_STEP()]);
  const result = reduceIntegrationSettlement({
    integrationEvents: hop,
    observations: { git: GIT_AT("7".repeat(40)), record: RECORD_AT(NEXT_RECORD_DIGEST, "done") }
  });
  assert.equal(result.incomplete.code, INTEGRATION_INCOMPLETE.AUTHORITY_MOVED);
  assert.equal(result.next_action.kind, INTEGRATION_NEXT_ACTIONS.NONE);
});

test("the record moving away from a recorded status effect is moved authority", () => {
  const hop = buildHop([INTENT_STEP(), GIT_STEP(), STATUS_STEP()]);
  const result = reduceIntegrationSettlement({
    integrationEvents: hop,
    observations: { git: GIT_AT(DELIVERY), record: RECORD_AT(`sha256:${"8".repeat(64)}`, "done") }
  });
  assert.equal(result.incomplete.code, INTEGRATION_INCOMPLETE.AUTHORITY_MOVED);
});

test("a Git effect naming another delivery is an intent/effect identity mismatch", () => {
  const hop = buildHop([INTENT_STEP(), GIT_STEP("6".repeat(40))]);
  const result = reduceIntegrationSettlement({
    integrationEvents: hop, observations: { git: GIT_AT(DELIVERY), record: RECORD_AT(RECORD_DIGEST) }
  });
  assert.equal(result.incomplete.code, INTEGRATION_INCOMPLETE.INTENT_EFFECT_IDENTITY_MISMATCH);
});

test("a stale frozen generation refuses the whole hop", () => {
  const hop = buildHop([INTENT_STEP()]);
  const result = reduceIntegrationSettlement({
    integrationEvents: hop, observations: { git: GIT_AT(EXPECTED_SLICE_TIP) },
    currentGenerationDigest: `sha256:${"5".repeat(64)}`
  });
  assert.equal(result.incomplete.code, INTEGRATION_INCOMPLETE.STALE_GENERATION);
});

test("a stale frozen WK tip refuses the whole hop", () => {
  const hop = buildHop([INTENT_STEP()]);
  const result = reduceIntegrationSettlement({
    integrationEvents: hop, observations: { git: GIT_AT(EXPECTED_SLICE_TIP) },
    currentWkTip: "4".repeat(40)
  });
  assert.equal(result.incomplete.code, INTEGRATION_INCOMPLETE.STALE_WK_TIP);
});

test("an unauthenticated coordinator cannot create intent", () => {
  const result = admitIntegrationIntent({
    coordinatorAuthenticated: false, coordinatorActionId: ACTION_ID, resolvedBinding: resolvedBinding()
  });
  assert.equal(result.admitted, false);
  assert.equal(result.refusal.code, INTEGRATION_INCOMPLETE.INTENT_UNAUTHENTICATED);
});

test("a caller-supplied binding can never create or override intent", () => {
  const result = admitIntegrationIntent({
    coordinatorAuthenticated: true, coordinatorActionId: ACTION_ID,
    resolvedBinding: resolvedBinding(),
    callerSuppliedBinding: { slice_ref: "refs/attacker" }
  });
  assert.equal(result.admitted, false);
  assert.match(result.refusal.reason, /caller input selects only the public subject/);
});

test("a tampered binding digest is refused at reduction", () => {
  const payload = intentPayload();
  const tampered = {
    ...payload,
    binding: { ...payload.binding, slice_ref: "refs/agent/slice/other" }
  };
  const hop = buildHop([[ATTEMPT_EVENT_KINDS.INTEGRATION_INTENT, tampered]]);
  const result = reduceIntegrationSettlement({
    integrationEvents: hop, observations: { git: GIT_AT(EXPECTED_SLICE_TIP) }
  });
  assert.equal(result.incomplete.code, INTEGRATION_INCOMPLETE.INTENT_UNAUTHENTICATED);
});

test("hops partition on completion boundaries", () => {
  const hop = buildHop([INTENT_STEP(), GIT_STEP(), STATUS_STEP(),
    [ATTEMPT_EVENT_KINDS.INTEGRATION_COMPLETED, { intent_digest: "i" }]]);
  assert.equal(partitionIntegrationHops(hop).length, 1);
});

test("a corrective hop must bind the exact prior completion digest", () => {
  const firstHop = buildHop([INTENT_STEP(), GIT_STEP(), STATUS_STEP(),
    [ATTEMPT_EVENT_KINDS.INTEGRATION_COMPLETED, { intent_digest: "i", git_effect_digest: "g", status_effect_digest: "s" }]]);
  const completionDigest = firstHop[firstHop.length - 1].digest;

  const good = [...firstHop, {
    ...firstHop[0],
    payload: intentPayload({ predecessor_completion_digest: completionDigest })
  }];
  const okResult = reduceIntegrationSettlement({
    integrationEvents: good, observations: { git: GIT_AT(EXPECTED_SLICE_TIP) }
  });
  assert.equal(okResult.incomplete, null, JSON.stringify(okResult.incomplete));
  assert.equal(okResult.next_action.kind, INTEGRATION_NEXT_ACTIONS.APPLY_GIT_CAS);

  const bad = [...firstHop, {
    ...firstHop[0],
    payload: intentPayload({ predecessor_completion_digest: `sha256:${"3".repeat(64)}` })
  }];
  const badResult = reduceIntegrationSettlement({
    integrationEvents: bad, observations: { git: GIT_AT(EXPECTED_SLICE_TIP) }
  });
  assert.equal(badResult.incomplete.code, INTEGRATION_INCOMPLETE.CORRECTIVE_ANCESTRY_UNPROVEN);
});

test("a corrective hop whose Git ancestry is disproven is refused", () => {
  const firstHop = buildHop([INTENT_STEP(), GIT_STEP(), STATUS_STEP(),
    [ATTEMPT_EVENT_KINDS.INTEGRATION_COMPLETED, { intent_digest: "i" }]]);
  const completionDigest = firstHop[firstHop.length - 1].digest;
  const corrective = [...firstHop, {
    ...firstHop[0],
    payload: intentPayload({ predecessor_completion_digest: completionDigest })
  }];
  const result = reduceIntegrationSettlement({
    integrationEvents: corrective,
    observations: { git: { tip: EXPECTED_SLICE_TIP, readable: true, delivery_ancestor_of_tip: false } }
  });
  assert.equal(result.incomplete.code, INTEGRATION_INCOMPLETE.CORRECTIVE_ANCESTRY_UNPROVEN);
});

test("review findings and awaiting-review projections cannot change any branch", () => {
  const hop = buildHop([INTENT_STEP()]);
  const withoutReview = reduceIntegrationSettlement({
    integrationEvents: hop, observations: { git: GIT_AT(EXPECTED_SLICE_TIP) }
  });
  const withReview = reduceIntegrationSettlement({
    integrationEvents: hop,
    observations: {
      git: GIT_AT(EXPECTED_SLICE_TIP),

      awaiting_slice_review: true,
      findings: [{ severity: "blocker" }]
    }
  });
  assert.deepEqual(withoutReview, withReview,
    "an awaiting-review projection or blocking finding must not change the mechanical settlement");
  assert.equal(withReview.next_action.kind, INTEGRATION_NEXT_ACTIONS.APPLY_GIT_CAS);
});
