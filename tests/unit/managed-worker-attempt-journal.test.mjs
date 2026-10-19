

import assert from "node:assert/strict";
import test from "node:test";
import { activeCompletion, arbitrateCompletion, completionObservations } from "../../packages/agent-launch-cli/src/lib/managed-run-completion-observation.mjs";

import {
  ATTEMPT_EVENT_KINDS,
  ATTEMPT_EXECUTION_LIVENESS,
  ATTEMPT_JOURNAL_REFUSALS,
  ATTEMPT_NEXT_COMMANDS,
  ATTEMPT_RELEASE_PROOFS,
  admitAttemptCommand,
  attemptPartitionId,
  digestOf,
  isLegalSuccessor,
  mintAttemptEvent,
  parseAttemptJournal,
  reduceAttemptJournal,
  serializeAttemptJournal,
  validateAttemptJournal
} from "../../packages/agent-launch-core/src/lib/managed-worker-attempt-journal.mjs";

const REPO = "agent-chassis/agent-chassis";
const SUBJECT = "WK-2358#SLICE-004";
const OTHER_SUBJECT = "WK-2358#SLICE-005";
const GENERATION = `sha256:${"a".repeat(64)}`;
const WK_TIP = "b".repeat(40);

test("completion observations preserve lifecycle while the binding owner arbitrates both alternatives", () => {
  const dispatch = tuple();
  const prefix = buildPrefix([ATTEMPT_EVENT_KINDS.RESERVATION_CLAIMED]);
  const pending = admitAttemptCommand({ repository: REPO, subject: SUBJECT, events: prefix,
    attempt: dispatch, kind: ATTEMPT_EVENT_KINDS.PENDING_PUBLISHED, payload: { dispatch_tuple: dispatch } });
  assert.equal(pending.admitted, true);
  const request = { alternative: "assignment_change_requested", intent_id: "request-one",
    request_digest: "a".repeat(64), assignment_digest: `sha256:${"b".repeat(64)}`,
    credential: { kind: "identity_store_tuple", launchRef: dispatch.launch_ref, runId: `${dispatch.run_id}.slice`, retryId: 0 },
    original: { ref_id: "retained-request-one", sha256: "c".repeat(64) }, storage: { state_dir: "/tmp/request-originals" } };
  const delivery = { alternative: "delivery", intent_id: "delivery-one", phase: "before_materialization", known_effects: "none at acquisition" };
  for (const [first, second] of [[request, delivery], [delivery, request]]) {
    const selected = { attempt: dispatch, dispatch_tuple: dispatch, released: false };
    assert.equal(arbitrateCompletion({ events: pending.events, selected, completion: first }).ok, true);
    const accepted = admitAttemptCommand({ repository: REPO, subject: SUBJECT, events: pending.events,
      attempt: dispatch, kind: ATTEMPT_EVENT_KINDS.COMPLETION_OBSERVATION_RECORDED,
      payload: { dispatch_tuple: dispatch, invocation_id: first.intent_id, completion: first } });
    assert.equal(accepted.admitted, true);
    const malformed = structuredClone(first);
    delete malformed[first === request ? "original" : "phase"];
    assert.equal(admitAttemptCommand({ repository: REPO, subject: SUBJECT, events: pending.events,
      attempt: dispatch, kind: ATTEMPT_EVENT_KINDS.COMPLETION_OBSERVATION_RECORDED,
      payload: { dispatch_tuple: dispatch, invocation_id: first.intent_id, completion: malformed } }).admitted, false);
    assert.equal(validateAttemptJournal({ repository: REPO, subject: SUBJECT, events: accepted.events }).valid, true);
    assert.deepEqual(reduce(accepted.events).next_command, reduce(pending.events).next_command);
    assert.equal(arbitrateCompletion({ events: accepted.events, selected, completion: second }).ok, false);
    assert.deepEqual(completionObservations(accepted.events, dispatch), [first]);

    assert.deepEqual(completionObservations(accepted.events.map(event => ({ ...event,
      attempt: { ...event.attempt, run_id: "reservation-owner" } })), dispatch), [first]);
    if (first === delivery) {
      const release = { alternative: "delivery", intent_id: `release-${delivery.intent_id}`,
        released_intent_id: delivery.intent_id, phase: "released_zero_effects",
        known_effects: "delivery ref unchanged; canonical review not attempted" };
      assert.equal(arbitrateCompletion({ events: accepted.events, selected,
        completion: { ...release, released_intent_id: "foreign" } }).code, "completion_release_owner_mismatch");
      assert.equal(arbitrateCompletion({ events: accepted.events, selected, completion: release }).ok, true);
      const released = admitAttemptCommand({ repository: REPO, subject: SUBJECT, events: accepted.events,
        attempt: dispatch, kind: ATTEMPT_EVENT_KINDS.COMPLETION_OBSERVATION_RECORDED,
        payload: { dispatch_tuple: dispatch, invocation_id: release.intent_id, completion: release } });
      assert.equal(released.admitted, true);
      assert.equal(validateAttemptJournal({ repository: REPO, subject: SUBJECT, events: released.events }).valid, true);
      assert.equal(activeCompletion(completionObservations(released.events, dispatch)), null);
      assert.equal(arbitrateCompletion({ events: released.events, selected, completion: request }).ok, true);
      assert.equal(arbitrateCompletion({ events: released.events, selected,
        completion: { ...delivery, intent_id: "corrected-delivery" } }).ok, true);
      assert.equal(arbitrateCompletion({ events: released.events, selected, completion: release }).appended, false);
      assert.deepEqual(reduce(released.events).next_command, reduce(pending.events).next_command);
    }
    if (first === request) {
      const retry = arbitrateCompletion({ events: accepted.events, selected,
        completion: { ...request, intent_id: "different-invocation" } });
      assert.equal(retry.ok, true); assert.equal(retry.appended, false);
      assert.equal(retry.completion.intent_id, request.intent_id);
      assert.equal(arbitrateCompletion({ events: accepted.events, selected,
        completion: { ...request, request_digest: "changed" } }).ok, false);
    }
  }
  const terminal = buildPrefix([ATTEMPT_EVENT_KINDS.ATTEMPT_TERMINAL], { events: pending.events });
  assert.equal(arbitrateCompletion({ events: terminal, selected: { attempt: dispatch, dispatch_tuple: dispatch }, completion: request }).code,
    "completion_attempt_terminal");
});

function tuple(runId = "run-1", retryId = 0) {
  return {
    assigned_unit: SUBJECT,
    launch_ref: "refs/agent/launch/1",
    run_id: runId,
    retry_id: retryId
  };
}

function buildPrefix(kinds, { attempt = tuple(), subject = SUBJECT, liveness = ATTEMPT_EXECUTION_LIVENESS.INDETERMINATE, events = [] } = {}) {
  let current = events;
  for (const kind of kinds) {
    const result = admitAttemptCommand({
      repository: REPO,
      subject,
      events: current,
      attempt,
      kind,
      payload: kind === ATTEMPT_EVENT_KINDS.ATTEMPT_TERMINAL ? { reason: "execution_terminated" } : {},
      generationDigest: kind === ATTEMPT_EVENT_KINDS.RESERVATION_CLAIMED ? GENERATION : null,
      wkTip: kind === ATTEMPT_EVENT_KINDS.RESERVATION_CLAIMED ? WK_TIP : null,
      liveness
    });
    assert.equal(result.admitted, true, `expected ${kind} to be admitted, got ${JSON.stringify(result.refusal)}`);
    current = result.events;
  }
  return current;
}

function reduce(events, overrides = {}) {
  return reduceAttemptJournal({
    repository: REPO,
    subject: SUBJECT,
    events,
    liveness: ATTEMPT_EXECUTION_LIVENESS.INDETERMINATE,
    currentGenerationDigest: GENERATION,
    currentWkTip: WK_TIP,
    ...overrides
  });
}

test("subject partitions are distinct and stable per repository and subject", () => {
  const a = attemptPartitionId(REPO, SUBJECT);
  const b = attemptPartitionId(REPO, OTHER_SUBJECT);
  const c = attemptPartitionId("other/repo", SUBJECT);
  assert.notEqual(a, b);
  assert.notEqual(a, c);
  assert.equal(a, attemptPartitionId(REPO, SUBJECT));
  assert.match(a, /^v1-[0-9a-f]{64}$/);
});

test("an empty journal elects no attempt and invites a reservation claim", () => {
  const result = reduce([]);
  assert.equal(result.refusal, null);
  assert.equal(result.current_attempt, null);
  assert.equal(result.reservation.held, false);
  assert.equal(result.next_command.kind, ATTEMPT_NEXT_COMMANDS.CLAIM_RESERVATION);
});

test("each durable prefix yields exactly one forward next command", () => {
  const expected = [
    [[ATTEMPT_EVENT_KINDS.RESERVATION_CLAIMED], ATTEMPT_NEXT_COMMANDS.PUBLISH_PENDING],
    [[ATTEMPT_EVENT_KINDS.RESERVATION_CLAIMED, ATTEMPT_EVENT_KINDS.PENDING_PUBLISHED], ATTEMPT_NEXT_COMMANDS.BIND_SUPERVISOR],
    [[ATTEMPT_EVENT_KINDS.RESERVATION_CLAIMED, ATTEMPT_EVENT_KINDS.PENDING_PUBLISHED, ATTEMPT_EVENT_KINDS.SUPERVISOR_BOUND], ATTEMPT_NEXT_COMMANDS.START_SPAWN]
  ];
  for (const [kinds, command] of expected) {
    const result = reduce(buildPrefix(kinds));
    assert.equal(result.refusal, null);
    assert.equal(result.next_command.kind, command, `prefix ${kinds.join(",")}`);
  }
});

const SPAWNED = [
  ATTEMPT_EVENT_KINDS.RESERVATION_CLAIMED,
  ATTEMPT_EVENT_KINDS.PENDING_PUBLISHED,
  ATTEMPT_EVENT_KINDS.SUPERVISOR_BOUND,
  ATTEMPT_EVENT_KINDS.SPAWN_STARTED
];

test("spawn-before-bind retains the reservation under an indeterminate verdict", () => {
  const result = reduce(buildPrefix(SPAWNED), { liveness: ATTEMPT_EXECUTION_LIVENESS.INDETERMINATE });
  assert.equal(result.reservation.held, true);
  assert.equal(result.reservation.possibly_live, true);
  assert.equal(result.reservation.release_proof, null, "an indeterminate spawn must never carry a release proof");
  assert.equal(result.next_command.kind, ATTEMPT_NEXT_COMMANDS.BIND_SANDBOX);
});

test("spawn-before-bind retains the reservation under a LIVE verdict", () => {
  const result = reduce(buildPrefix(SPAWNED), { liveness: ATTEMPT_EXECUTION_LIVENESS.LIVE });
  assert.equal(result.reservation.possibly_live, true);
  assert.equal(result.reservation.release_proof, null);
});

test("spawn-before-bind converges only on an authenticated DEAD verdict", () => {
  const result = reduce(buildPrefix(SPAWNED), { liveness: ATTEMPT_EXECUTION_LIVENESS.DEAD });
  assert.equal(result.next_command.kind, ATTEMPT_NEXT_COMMANDS.RECORD_EXECUTION_TERMINATION);
  assert.equal(result.reservation.release_proof, ATTEMPT_RELEASE_PROOFS.AUTHENTICATED_DEATH);
});

test("a possibly live attempt cannot be terminally retired as an unused election", () => {

  assert.equal(isLegalSuccessor(ATTEMPT_EVENT_KINDS.SPAWN_STARTED, ATTEMPT_EVENT_KINDS.ATTEMPT_TERMINAL), false);
  const result = admitAttemptCommand({
    repository: REPO,
    subject: SUBJECT,
    events: buildPrefix(SPAWNED),
    attempt: tuple(),
    kind: ATTEMPT_EVENT_KINDS.ATTEMPT_TERMINAL,
    payload: { reason: "launcher_exit" }
  });
  assert.equal(result.admitted, false);
  assert.equal(result.refusal.code, ATTEMPT_JOURNAL_REFUSALS.ILLEGAL_TRANSITION);
});

const TERMINATED = [...SPAWNED, ATTEMPT_EVENT_KINDS.SANDBOX_BOUND, ATTEMPT_EVENT_KINDS.EXECUTION_TERMINATED];

test("family 1: exact terminality with no unresolved execution releases", () => {
  const events = buildPrefix([...TERMINATED, ATTEMPT_EVENT_KINDS.ATTEMPT_TERMINAL]);
  const result = reduce(events);
  assert.equal(result.reservation.release_proof, ATTEMPT_RELEASE_PROOFS.EXACT_TERMINAL);
  assert.equal(result.next_command.kind, ATTEMPT_NEXT_COMMANDS.RELEASE_RESERVATION);

  const admitted = admitAttemptCommand({
    repository: REPO, subject: SUBJECT, events, attempt: tuple(),
    kind: ATTEMPT_EVENT_KINDS.RESERVATION_RELEASED, payload: {}
  });
  assert.equal(admitted.admitted, true);
  assert.equal(admitted.event.payload.release_proof, ATTEMPT_RELEASE_PROOFS.EXACT_TERMINAL);
});

test("family 2: authenticated death releases the exact attempt", () => {
  const events = buildPrefix(SPAWNED);
  const admitted = admitAttemptCommand({
    repository: REPO, subject: SUBJECT, events, attempt: tuple(),
    kind: ATTEMPT_EVENT_KINDS.EXECUTION_TERMINATED, payload: {},
    liveness: ATTEMPT_EXECUTION_LIVENESS.DEAD
  });
  assert.equal(admitted.admitted, true);
  const terminal = admitAttemptCommand({
    repository: REPO, subject: SUBJECT, events: admitted.events, attempt: tuple(),
    kind: ATTEMPT_EVENT_KINDS.ATTEMPT_TERMINAL, payload: { reason: "proven_dead" }
  });
  const released = admitAttemptCommand({
    repository: REPO, subject: SUBJECT, events: terminal.events, attempt: tuple(),
    kind: ATTEMPT_EVENT_KINDS.RESERVATION_RELEASED, payload: {},
    liveness: ATTEMPT_EXECUTION_LIVENESS.DEAD
  });
  assert.equal(released.admitted, true);
  assert.equal(released.event.payload.release_proof, ATTEMPT_RELEASE_PROOFS.AUTHENTICATED_DEATH);
});

test("family 3: completed delivery plus authenticated termination releases", () => {
  const events = buildPrefix([
    ...TERMINATED,
    ATTEMPT_EVENT_KINDS.DELIVERY_OBSERVED,
    ATTEMPT_EVENT_KINDS.INTEGRATION_INTENT,
    ATTEMPT_EVENT_KINDS.INTEGRATION_GIT_EFFECT,
    ATTEMPT_EVENT_KINDS.INTEGRATION_STATUS_EFFECT,
    ATTEMPT_EVENT_KINDS.INTEGRATION_COMPLETED
  ]);
  const result = reduce(events);
  assert.equal(result.reservation.release_proof, ATTEMPT_RELEASE_PROOFS.COMPLETED_DELIVERY);
});

test("a terminal attempt with unresolved execution is RETAINED, never released", () => {

  const events = buildPrefix(SPAWNED);
  const result = reduce(events, { liveness: ATTEMPT_EXECUTION_LIVENESS.INDETERMINATE });
  assert.equal(result.reservation.release_proof, null);
  assert.notEqual(result.next_command.kind, ATTEMPT_NEXT_COMMANDS.RELEASE_RESERVATION);
});

test("release is refused without an exact proof family", () => {
  const events = buildPrefix([...SPAWNED, ATTEMPT_EVENT_KINDS.SANDBOX_BOUND]);
  const result = admitAttemptCommand({
    repository: REPO, subject: SUBJECT, events, attempt: tuple(),
    kind: ATTEMPT_EVENT_KINDS.RESERVATION_RELEASED, payload: {},
    liveness: ATTEMPT_EXECUTION_LIVENESS.INDETERMINATE
  });
  assert.equal(result.admitted, false);
  assert.equal(result.refusal.code, ATTEMPT_JOURNAL_REFUSALS.ILLEGAL_TRANSITION);
});

test("a claimed release proof that the reducer does not derive is refused", () => {
  const events = buildPrefix([...TERMINATED, ATTEMPT_EVENT_KINDS.ATTEMPT_TERMINAL]);
  const result = admitAttemptCommand({
    repository: REPO, subject: SUBJECT, events, attempt: tuple(),
    kind: ATTEMPT_EVENT_KINDS.RESERVATION_RELEASED,
    payload: { release_proof: ATTEMPT_RELEASE_PROOFS.AUTHENTICATED_DEATH },
    liveness: ATTEMPT_EXECUTION_LIVENESS.INDETERMINATE
  });
  assert.equal(result.admitted, false);
  assert.equal(result.refusal.code, ATTEMPT_JOURNAL_REFUSALS.RELEASE_WITHOUT_PROOF);
});

test("a released historical attempt is excluded from the current election", () => {
  const first = buildPrefix([...TERMINATED, ATTEMPT_EVENT_KINDS.ATTEMPT_TERMINAL]);
  const released = admitAttemptCommand({
    repository: REPO, subject: SUBJECT, events: first, attempt: tuple(),
    kind: ATTEMPT_EVENT_KINDS.RESERVATION_RELEASED, payload: {}
  });
  assert.equal(released.admitted, true);

  const afterRelease = reduce(released.events);
  assert.equal(afterRelease.current_attempt, null, "a fully released subject elects no current attempt");
  assert.equal(afterRelease.next_command.kind, ATTEMPT_NEXT_COMMANDS.CLAIM_RESERVATION);
  assert.equal(afterRelease.history.length, 1);
  assert.equal(afterRelease.history[0].released, true);

  const second = buildPrefix([ATTEMPT_EVENT_KINDS.RESERVATION_CLAIMED], { attempt: tuple("run-2"), events: released.events });
  const reduced = reduce(second);
  assert.equal(reduced.current_attempt.attempt.run_id, "run-2");
  assert.equal(reduced.history.length, 2);
});

test("a second attempt cannot claim while an attempt is unreleased", () => {
  const events = buildPrefix([ATTEMPT_EVENT_KINDS.RESERVATION_CLAIMED]);
  const result = admitAttemptCommand({
    repository: REPO, subject: SUBJECT, events, attempt: tuple("run-2"),
    kind: ATTEMPT_EVENT_KINDS.RESERVATION_CLAIMED,
    generationDigest: GENERATION, wkTip: WK_TIP
  });
  assert.equal(result.admitted, false);
  assert.equal(result.refusal.code, ATTEMPT_JOURNAL_REFUSALS.ILLEGAL_TRANSITION);
});

test("a stale attempt authorizes nothing forward but keeps a possibly live reservation", () => {
  const events = buildPrefix(SPAWNED);
  const result = reduce(events, { currentGenerationDigest: `sha256:${"c".repeat(64)}` });
  assert.equal(result.current_attempt.stale, true);
  assert.equal(result.reservation.held, true, "a stale attempt still holds its reservation");
  assert.equal(result.reservation.possibly_live, true);
  assert.equal(result.next_command.kind, ATTEMPT_NEXT_COMMANDS.NONE, "a stale attempt authorizes no forward command");
  assert.equal(result.next_command.detail.retained, "possibly_live");
});

test("a stale WK tip is equally non-authorizing", () => {
  const events = buildPrefix([ATTEMPT_EVENT_KINDS.RESERVATION_CLAIMED]);
  const result = reduce(events, { currentWkTip: "f".repeat(40) });
  assert.equal(result.current_attempt.stale, true);
  assert.equal(result.next_command.kind, ATTEMPT_NEXT_COMMANDS.NONE);
});

test("a later event may not change the frozen generation digest", () => {
  const events = buildPrefix([ATTEMPT_EVENT_KINDS.RESERVATION_CLAIMED]);
  const result = admitAttemptCommand({
    repository: REPO, subject: SUBJECT, events, attempt: tuple(),
    kind: ATTEMPT_EVENT_KINDS.PENDING_PUBLISHED,
    generationDigest: `sha256:${"d".repeat(64)}`
  });
  assert.equal(result.admitted, false);
  assert.equal(result.refusal.code, ATTEMPT_JOURNAL_REFUSALS.GENERATION_NOT_FROZEN);
});

test("a later event may not change the frozen WK tip", () => {
  const events = buildPrefix([ATTEMPT_EVENT_KINDS.RESERVATION_CLAIMED]);
  const result = admitAttemptCommand({
    repository: REPO, subject: SUBJECT, events, attempt: tuple(),
    kind: ATTEMPT_EVENT_KINDS.PENDING_PUBLISHED,
    wkTip: "e".repeat(40)
  });
  assert.equal(result.admitted, false);
  assert.equal(result.refusal.code, ATTEMPT_JOURNAL_REFUSALS.WK_TIP_NOT_FROZEN);
});

test("a tampered frozen generation is caught by validation", () => {
  const events = buildPrefix([ATTEMPT_EVENT_KINDS.RESERVATION_CLAIMED, ATTEMPT_EVENT_KINDS.PENDING_PUBLISHED]);
  const tampered = events.map((event, index) => {
    if (index !== 1) return event;
    const mutated = { ...event, generation_digest: `sha256:${"9".repeat(64)}` };
    return { ...mutated, digest: digestOf({ ...mutated, digest: undefined, ...{} }) };
  });

  const rebuilt = tampered.map((event) => {
    const { digest: _d, ...unsigned } = event;
    return { ...unsigned, digest: digestOf(unsigned) };
  });
  const validated = validateAttemptJournal({ repository: REPO, subject: SUBJECT, events: rebuilt });
  assert.equal(validated.valid, false);
  assert.equal(validated.refusal.code, ATTEMPT_JOURNAL_REFUSALS.GENERATION_NOT_FROZEN);
});

test("a sequence gap refuses", () => {
  const events = buildPrefix([ATTEMPT_EVENT_KINDS.RESERVATION_CLAIMED, ATTEMPT_EVENT_KINDS.PENDING_PUBLISHED]);
  const gapped = [events[0], { ...events[1], sequence: 5 }];
  const result = validateAttemptJournal({ repository: REPO, subject: SUBJECT, events: gapped });
  assert.equal(result.valid, false);
  assert.equal(result.refusal.code, ATTEMPT_JOURNAL_REFUSALS.SEQUENCE_GAP);
});

test("a broken digest chain refuses", () => {
  const events = buildPrefix([ATTEMPT_EVENT_KINDS.RESERVATION_CLAIMED, ATTEMPT_EVENT_KINDS.PENDING_PUBLISHED]);
  const broken = [events[0], { ...events[1], prior_digest: `sha256:${"0".repeat(64)}` }];
  const result = validateAttemptJournal({ repository: REPO, subject: SUBJECT, events: broken });
  assert.equal(result.valid, false);
  assert.equal(result.refusal.code, ATTEMPT_JOURNAL_REFUSALS.CHAIN_BROKEN);
});

test("a content-tampered event refuses on digest mismatch", () => {
  const events = buildPrefix([ATTEMPT_EVENT_KINDS.RESERVATION_CLAIMED]);
  const tampered = [{ ...events[0], payload: { forged: true } }];
  const result = validateAttemptJournal({ repository: REPO, subject: SUBJECT, events: tampered });
  assert.equal(result.valid, false);
  assert.equal(result.refusal.code, ATTEMPT_JOURNAL_REFUSALS.DIGEST_MISMATCH);
});

test("an unknown schema version refuses", () => {
  const events = buildPrefix([ATTEMPT_EVENT_KINDS.RESERVATION_CLAIMED]);
  const bad = [{ ...events[0], schema_version: "managed-worker-attempt-journal.v99" }];
  const result = validateAttemptJournal({ repository: REPO, subject: SUBJECT, events: bad });
  assert.equal(result.valid, false);
  assert.equal(result.refusal.code, ATTEMPT_JOURNAL_REFUSALS.UNKNOWN_SCHEMA_VERSION);
});

test("an unknown event kind refuses", () => {
  const events = buildPrefix([ATTEMPT_EVENT_KINDS.RESERVATION_CLAIMED]);
  const bad = [{ ...events[0], kind: "invented_kind" }];
  const result = validateAttemptJournal({ repository: REPO, subject: SUBJECT, events: bad });
  assert.equal(result.valid, false);
  assert.equal(result.refusal.code, ATTEMPT_JOURNAL_REFUSALS.UNKNOWN_EVENT_KIND);
});

test("an extra envelope key refuses", () => {
  const events = buildPrefix([ATTEMPT_EVENT_KINDS.RESERVATION_CLAIMED]);
  const bad = [{ ...events[0], smuggled: true }];
  const result = validateAttemptJournal({ repository: REPO, subject: SUBJECT, events: bad });
  assert.equal(result.valid, false);
  assert.equal(result.refusal.code, ATTEMPT_JOURNAL_REFUSALS.UNEXPECTED_KEYS);
});

test("an event bound to another subject refuses", () => {
  const events = buildPrefix([ATTEMPT_EVENT_KINDS.RESERVATION_CLAIMED]);
  const result = validateAttemptJournal({ repository: REPO, subject: OTHER_SUBJECT, events });
  assert.equal(result.valid, false);
  assert.equal(result.refusal.code, ATTEMPT_JOURNAL_REFUSALS.BINDING_MISMATCH);
});

test("a damaged subject partition cannot change another subject's dispatchability", () => {
  const damaged = [{ ...buildPrefix([ATTEMPT_EVENT_KINDS.RESERVATION_CLAIMED])[0], digest: "sha256:tampered" }];
  const damagedResult = reduceAttemptJournal({
    repository: REPO, subject: SUBJECT, events: damaged,
    liveness: ATTEMPT_EXECUTION_LIVENESS.INDETERMINATE
  });
  assert.notEqual(damagedResult.refusal, null, "the damaged subject refuses");
  assert.equal(damagedResult.current_attempt, null);

  const healthy = reduceAttemptJournal({
    repository: REPO, subject: OTHER_SUBJECT, events: [],
    liveness: ATTEMPT_EXECUTION_LIVENESS.INDETERMINATE
  });
  assert.equal(healthy.refusal, null);
  assert.equal(healthy.next_command.kind, ATTEMPT_NEXT_COMMANDS.CLAIM_RESERVATION);
});

test("a journal round-trips through serialization", () => {
  const events = buildPrefix([...TERMINATED]);
  const parsed = parseAttemptJournal(serializeAttemptJournal(events));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.events, events.map((event) => JSON.parse(JSON.stringify(event))));
  const validated = validateAttemptJournal({ repository: REPO, subject: SUBJECT, events: parsed.events });
  assert.equal(validated.valid, true);
});

test("a torn final line refuses and reports the durable prefix", () => {
  const events = buildPrefix([ATTEMPT_EVENT_KINDS.RESERVATION_CLAIMED, ATTEMPT_EVENT_KINDS.PENDING_PUBLISHED]);
  const torn = `${serializeAttemptJournal(events)}{"schema_version":"managed-worker-att`;
  const parsed = parseAttemptJournal(torn);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.refusal.code, ATTEMPT_JOURNAL_REFUSALS.UNREADABLE);
  assert.equal(parsed.durable_prefix.length, 2, "the durable prefix is every event before the torn line");
});

test("the reducer passes the integration subreducer result through opaquely", () => {
  const events = buildPrefix([...TERMINATED, ATTEMPT_EVENT_KINDS.DELIVERY_OBSERVED, ATTEMPT_EVENT_KINDS.INTEGRATION_INTENT]);
  const opaque = Object.freeze({ opaque_marker: "owned-by-the-subreducer", prefix: "intent_only" });
  const result = reduce(events, { integrationResult: opaque });
  assert.equal(result.integration, opaque, "the reducer must not copy, reshape, or reclassify the subreducer result");
  assert.equal(result.next_command.kind, ATTEMPT_NEXT_COMMANDS.RUN_INTEGRATION_SETTLEMENT);
});

test("mintAttemptEvent refuses an unbound or misordered event", () => {
  const args = {
    repository: REPO, subject: SUBJECT, attempt: tuple(), sequence: 0,
    priorDigest: null, generationDigest: GENERATION, wkTip: WK_TIP,
    kind: ATTEMPT_EVENT_KINDS.RESERVATION_CLAIMED, payload: {}
  };
  assert.doesNotThrow(() => mintAttemptEvent(args));
  assert.throws(() => mintAttemptEvent({ ...args, sequence: 1 }), /prior_digest/);
  assert.throws(() => mintAttemptEvent({ ...args, kind: "nope" }), /unknown attempt event kind/);
  assert.throws(() => mintAttemptEvent({ ...args, attempt: { assigned_unit: "x" } }), /complete launcher-minted tuple/);
  assert.throws(() => mintAttemptEvent({ ...args, generationDigest: "" }), /generationDigest/);
});

test("recorded proof verification is informational, invocation-identified and paged by snapshot", async () => {
  const { pageManagedAttemptDetail } = await import(
    "../../packages/agent-launch-core/src/lib/managed-run-observation.mjs");
  const dispatchTuple = { ...tuple("wkdb_0123456789abcdef"), launch_ref: "wkmh_0123456789abcdef" };
  let events = buildPrefix([ATTEMPT_EVENT_KINDS.RESERVATION_CLAIMED]);
  events = admitAttemptCommand({ repository: REPO, subject: SUBJECT, events, attempt: tuple(),
    kind: ATTEMPT_EVENT_KINDS.PENDING_PUBLISHED, payload: { dispatch_tuple: dispatchTuple } }).events;
  const record = (invocationId, verification, payload = {}) => admitAttemptCommand({ repository: REPO,
    subject: SUBJECT, events, attempt: tuple(), kind: ATTEMPT_EVENT_KINDS.PROOF_VERIFICATION_RECORDED,
    payload: { dispatch_tuple: dispatchTuple, invocation_id: invocationId, verification, ...payload } });
  const before = reduce(events);
  const verificationFor = (index, outcome) => ({ outcome,
    status: outcome === "refused" ? "not_executable" : "satisfied",
    reason_code: outcome === "refused" ? "obligation_coverage_source_not_found" : null,
    counts: { proofs: outcome === "refused" ? 0 : 2 }, request: { subject: SUBJECT },
    caller: { assigned_unit: SUBJECT }, record_identity: `record-${index}`,
    tested_source: outcome === "refused" ? null : { candidate: `candidate-${index}`,
      source_snapshot_digest: `snapshot-${index}`, cases: Array.from({ length: 50 }, () => "not-inline") } });
  for (const [index, outcome] of ["completed", "completed", "refused"].entries()) {
    const admitted = record(`inv-${index}`, verificationFor(index, outcome));
    assert.equal(admitted.appended, true);
    events = admitted.events;
  }
  assert.deepEqual(reduce(events).next_command, before.next_command, "recording advances no lifecycle");
  assert.equal(record("inv-0", verificationFor(0, "completed")).appended, false,
    "an identical replay is idempotent");
  assert.equal(record("inv-0", { outcome: "refused", status: "not_executable" }).admitted, false,
    "one invocation cannot be rebound to another outcome");
  assert.equal(record("inv-9", { outcome: "completed" }, {
    dispatch_tuple: { ...dispatchTuple, run_id: "wkdb_ffffffffffffffff" } }).admitted, false,
  "evidence cannot attach to another retained dispatch binding");
  assert.equal(record("inv-9", "not an object").admitted, false);
  const tampered = structuredClone(events);
  tampered.at(-1).payload.verification = "altered";
  assert.equal(validateAttemptJournal({ repository: REPO, subject: SUBJECT, events: tampered }).valid, false);

  const page = (args) => pageManagedAttemptDetail({ repository: REPO, subject: SUBJECT, events,
    attemptId: dispatchTuple.run_id, kind: "proof_verification", ...args });
  const first = page({ limit: 2 });
  assert.deepEqual([first.total_count, first.items.map((item) => item.invocation_id)], [3, ["inv-0", "inv-1"]]);
  assert.deepEqual(first.summary.outcome_counts, { completed: 2, refused: 1 });
  assert.deepEqual(first.summary.last_recorded_invocation, {
    invocation_id: "inv-2", sequence: first.snapshot.sequence, event_digest: first.snapshot.digest,
    record_identity: "record-2", requested_unit: SUBJECT, assigned_unit: SUBJECT,
    outcome: "refused", status: "not_executable", reason_code: "obligation_coverage_source_not_found",
    selected_proof_count: 0, tested_source: null, result_digest: null,
    coverage_scope: "requested_selection_only", grants_authority: false
  });
  events = record("inv-3", { outcome: "completed", status: "unsatisfied" }).events;
  const rest = page({ limit: 2, cursor: first.cursor });
  assert.deepEqual([rest.items.map((item) => item.invocation_id), rest.cursor, rest.snapshot],
    [["inv-2"], null, first.snapshot], "an open walk stays bound to its snapshot");
  assert.equal(rest.summary.last_recorded_invocation.invocation_id, "inv-2",
    "the last observation stays inside the cursor snapshot");
  const latest = page({ limit: 1 }).summary.last_recorded_invocation;
  assert.deepEqual([latest.invocation_id, latest.selected_proof_count], ["inv-3", null],
    "a fresh observation selects greatest journal sequence, not page.items[0]");
  assert.deepEqual(page({ invocationId: "inv-3" }).items.map((item) => item.verification.status), ["unsatisfied"]);
  assert.equal(page({ invocationId: "inv-404" }).code, "proof_verification_invocation_unknown");
  assert.equal(page({ invocationId: "inv-3", cursor: first.cursor }).code, "attempt_detail_request_invalid");
  assert.equal(pageManagedAttemptDetail({ repository: REPO, subject: SUBJECT, events,
    attemptId: dispatchTuple.run_id, kind: "failure_history", invocationId: "inv-3" }).code,
  "attempt_detail_request_invalid");
  assert.equal(page({ cursor: first.cursor.replace(/.$/u, "A") }).ok, false);
});

test("last recorded invocation forwards, omits or refuses a deficient outcome summary exactly", async () => {
  const { pageManagedAttemptDetail, recordedProofVerificationOutcomeSummary } = await import(
    "../../packages/agent-launch-core/src/lib/managed-run-observation.mjs");
  const dispatchTuple = { ...tuple("wkdb_1123456789abcdef"), launch_ref: "wkmh_1123456789abcdef" };
  let events = buildPrefix([ATTEMPT_EVENT_KINDS.RESERVATION_CLAIMED]);
  events = admitAttemptCommand({ repository: REPO, subject: SUBJECT, events, attempt: tuple(),
    kind: ATTEMPT_EVENT_KINDS.PENDING_PUBLISHED, payload: { dispatch_tuple: dispatchTuple } }).events;
  const append = (invocationId, verification) => {
    events = admitAttemptCommand({ repository: REPO, subject: SUBJECT, events, attempt: tuple(),
      kind: ATTEMPT_EVENT_KINDS.PROOF_VERIFICATION_RECORDED,
      payload: { dispatch_tuple: dispatchTuple, invocation_id: invocationId, verification } }).events;
  };
  const page = (args = { limit: 1 }) => pageManagedAttemptDetail({ repository: REPO, subject: SUBJECT,
    events, attemptId: dispatchTuple.run_id, kind: "proof_verification", ...args });
  const last = (invocationId, verification) => {
    append(invocationId, verification);
    return page().summary.last_recorded_invocation;
  };
  const outcomeSummary = { schema_version: "workspace-verify-proof-outcome-summary.v1",
    status: "proven", proofs: [{ test_proof_id: "test-proof-1", selected_status: "passed" }] };
  const current = last("inv-current", { outcome: "completed", status: "proven",
    result_digest: "sha256:current", evidence: { kind: "aggregate" }, outcome_summary: outcomeSummary });
  assert.deepEqual(current.outcome_summary, outcomeSummary);
  assert.equal(current.result_digest, "sha256:current");
  const refusal = last("inv-refusal", { outcome: "refused", status: "not_executable",
    reason_code: "verify_proof.subject_unknown.v1", evidence: { kind: "refusal" } });
  assert.equal(Object.hasOwn(refusal, "outcome_summary"), false);
  assert.equal(refusal.reason_code, "verify_proof.subject_unknown.v1");

  const eventsBeforeDeficient = events;
  for (const [label, summary, reason] of [["missing", undefined, "missing"], ["null", null, "invalid_type"],
    ["scalar", "proven", "invalid_type"], ["array", [], "invalid_type"]]) {
    events = eventsBeforeDeficient;
    const verification = { outcome: "completed", status: "satisfied", result_digest: `sha256:${label}`,
      evidence: { kind: "aggregate" }, ...(summary === undefined ? {} : { outcome_summary: summary }) };
    const expected = { code: "proof_verification_record_invalid",
      field: "verification.outcome_summary", reason };
    assert.deepEqual({ ...recordedProofVerificationOutcomeSummary(verification) },
      { ok: false, ...expected }, label);
    append(`inv-${label}`, verification);
    for (const read of [page(), page({ limit: 20 }), page({ invocationId: "inv-current" }),
      page({ invocationId: `inv-${label}` })]) {
      assert.deepEqual([read.ok, read.code, { ...read.refusal }],
        [false, expected.code, { ...expected, invocation_id: `inv-${label}` }], label);
      assert.equal(Object.hasOwn(read, "summary"), false, `${label}: no partial summary is published`);
    }
  }
  events = eventsBeforeDeficient;
  assert.equal(page().ok, true, "the current population remains readable");
});

test("delivery receipts preserve election and reject changed producer bindings", async () => {
  const { projectManagedAttemptObservations } = await import(
    "../../packages/agent-launch-core/src/lib/managed-run-observation.mjs");
  const dispatchTuple = { ...tuple("wkdb_0123456789abcdef"), launch_ref: "wkmh_0123456789abcdef" };
  let events = buildPrefix([ATTEMPT_EVENT_KINDS.RESERVATION_CLAIMED]);
  events = admitAttemptCommand({ repository: REPO, subject: SUBJECT, events, attempt: tuple(),
    kind: ATTEMPT_EVENT_KINDS.PENDING_PUBLISHED, payload: { dispatch_tuple: dispatchTuple } }).events;
  const receipt = { repository: REPO, unit: SUBJECT, producer: "workspace_deliver_work",
    producer_tuple: { launch_ref: dispatchTuple.launch_ref, run_id: `${dispatchTuple.run_id}.slice`, retry_id: 0 },
    source: { digest: GENERATION, version: "work-record.v1" },
    delivery: { commit: "c".repeat(40), base: WK_TIP },
    result: { ref_id: "resp-delivery-1", sha256: "d".repeat(64) },
    storage: { state_dir: "/host/worker-response-state" } };
  const record = (value, dispatch = dispatchTuple) => admitAttemptCommand({ repository: REPO,
    subject: SUBJECT, events, attempt: tuple(), kind: ATTEMPT_EVENT_KINDS.DELIVERY_RECEIPT_RECORDED,
    payload: { dispatch_tuple: dispatch, invocation_id: receipt.result.ref_id, receipt: value } });
  const before = reduce(events);
  const priorProjection = projectManagedAttemptObservations({ repository: REPO, subject: SUBJECT, events });
  const admitted = record(receipt);
  assert.equal(admitted.admitted, true);
  events = admitted.events;
  assert.deepEqual(reduce(events).next_command, before.next_command);
  assert.deepEqual(reduce(events).reservation, before.reservation);
  const projected = projectManagedAttemptObservations({ repository: REPO, subject: SUBJECT, events });
  assert.equal(projected.ok, true);
  assert.deepEqual(projected.attempts[0].delivery_receipts[0].receipt, receipt);
  assert.equal(projected.attempts[0].last_lifecycle_kind, priorProjection.attempts[0].last_lifecycle_kind);
  assert.equal(record(receipt).appended, false);
  for (const replacement of [
    { ...receipt, producer: "start_agent" }, { ...receipt, unit: OTHER_SUBJECT },
    { ...receipt, producer_tuple: { ...receipt.producer_tuple, retry_id: 1 } },
    { ...receipt, producer_tuple: { ...receipt.producer_tuple, launch_ref: "foreign" } },
    { ...receipt, result: { ...receipt.result, sha256: "wrong" } },
    { ...receipt, storage: { state_dir: "caller-relative" } },
    { ...receipt, storage: { ...receipt.storage, selector: "extra" } }
  ]) assert.equal(record(replacement).admitted, false);
  assert.equal(record(receipt, { ...dispatchTuple, run_id: "foreign-attempt" }).admitted, false);
});

test("recorded run originals bind one immutable result without lifecycle effects", async () => {
  const { selectManagedAttempt } = await import("../../packages/agent-launch-core/src/lib/managed-run-observation.mjs");
  const kinds = ATTEMPT_EVENT_KINDS, dispatch = tuple("original-attempt");
  let events = buildPrefix([kinds.RESERVATION_CLAIMED]);
  const append = (kind, payload, attempt = tuple()) => admitAttemptCommand({ repository: REPO,
    subject: SUBJECT, events, attempt, kind, payload });
  events = append(kinds.PENDING_PUBLISHED, { dispatch_tuple: dispatch }).events;
  const result = { outcome: "failed", text: "Complete failure 原始🙂".repeat(600), nested: { code: "F" } };
  const original = { dispatch_tuple: dispatch, result_digest: digestOf(result),
    original_result: { ref_id: "resp-original-F", sha256: "c".repeat(64) } };
  assert.equal(append(kinds.RUN_ORIGINAL_RECORDED, original).refusal.code,
    ATTEMPT_JOURNAL_REFUSALS.ILLEGAL_TRANSITION);
  const beforeResult = events;
  events = append(kinds.RUN_RESULT_RECORDED, { dispatch_tuple: dispatch, result_digest: digestOf(result), result }).events;
  const before = reduce(events), recorded = events;
  const bound = append(kinds.RUN_ORIGINAL_RECORDED, original);
  assert.equal(bound.appended, true);
  events = bound.events;
  assert.equal(append(kinds.RUN_ORIGINAL_RECORDED, structuredClone(original)).appended, false);
  const lifecycle = value => JSON.parse(JSON.stringify(value, (key, field) =>
    ["event_count", "history_total", "terminal_digest"].includes(key) ? undefined : field));
  assert.deepEqual(lifecycle(reduce(events)), lifecycle(before),
    "binding changes no lifecycle, reservation, release or election fact");
  const selected = selectManagedAttempt({ repository: REPO, subject: SUBJECT, events, attemptId: dispatch.run_id });
  assert.deepEqual(selected.selected.original_result, original.original_result);
  assert.deepEqual(selected.selected.result, result);
  assert.equal(selected.selected.last_lifecycle_kind, kinds.RESERVATION_CLAIMED);
  assert.equal(selected.selected.released, false);
  const rechain = source => source.map((event, index, rows) => {
    event.sequence = index; event.prior_digest = index === 0 ? null : rows[index - 1].digest;
    const { digest, ...unsigned } = event; event.digest = digestOf(unsigned); return event;
  });
  const defects = [
    value => { value.extra = true; },
    value => { delete value.original_result; },
    value => { value.original_result.extra = true; },
    value => { value.original_result.ref_id = ""; },
    value => { value.original_result.ref_id = "../foreign"; },
    value => { value.original_result.ref_id = "a".repeat(201); },
    value => { value.original_result.ref_id = ["resp-original-F"]; },
    value => { value.original_result.sha256 = "invalid"; },
    value => { value.original_result.sha256 = ["c".repeat(64)]; },
    value => { value.original_result = null; },
    value => { value.result_digest = "sha256:wrong"; },
    ...["assigned_unit", "launch_ref", "run_id", "retry_id"].map(field => value => {
      value.dispatch_tuple[field] = field === "retry_id" ? 9 : "foreign";
    })
  ];
  for (const mutate of defects) {
    const altered = structuredClone(original); mutate(altered);
    assert.equal(append(kinds.RUN_ORIGINAL_RECORDED, altered).admitted, false);
    const journal = structuredClone(events); journal.at(-1).payload = altered;
    assert.equal(validateAttemptJournal({ repository: REPO, subject: SUBJECT, events: rechain(journal) }).valid, false,
      "recomputed digest does not authorize a contradictory original");
  }
  for (const field of ["ref_id", "sha256"]) {
    const conflicting = structuredClone(original);
    conflicting.original_result[field] = field === "ref_id" ? "resp-second-original" : "d".repeat(64);
    assert.equal(append(kinds.RUN_ORIGINAL_RECORDED, conflicting).admitted, false);
    const second = structuredClone(bound.event); second.payload = conflicting;
    assert.equal(validateAttemptJournal({ repository: REPO, subject: SUBJECT,
      events: rechain([...structuredClone(events), second]) }).valid, false);
  }
  const corrupt = structuredClone(events); corrupt.at(-1).payload.original_result.ref_id = "resp-tampered";
  assert.equal(validateAttemptJournal({ repository: REPO, subject: SUBJECT, events: corrupt }).refusal.code,
    ATTEMPT_JOURNAL_REFUSALS.DIGEST_MISMATCH);
  const outOfOrder = rechain([...structuredClone(beforeResult), structuredClone(bound.event)]);
  assert.equal(validateAttemptJournal({ repository: REPO, subject: SUBJECT, events: outOfOrder }).refusal.code,
    ATTEMPT_JOURNAL_REFUSALS.ILLEGAL_TRANSITION);
  const changedResult = structuredClone(recorded.at(-1)); changedResult.payload.result.text = "S";
  changedResult.payload.result_digest = digestOf(changedResult.payload.result);
  assert.equal(validateAttemptJournal({ repository: REPO, subject: SUBJECT,
    events: rechain([...structuredClone(events), changedResult]) }).valid, false, "later result cannot invalidate an earlier binding");
  const changedBinding = structuredClone(beforeResult.at(-1)); changedBinding.payload.dispatch_tuple.retry_id = 99;
  assert.equal(validateAttemptJournal({ repository: REPO, subject: SUBJECT,
    events: rechain([...structuredClone(events), changedBinding]) }).valid, false,
    "later pending bytes cannot retarget an already bound original");
  events = append(kinds.ATTEMPT_TERMINAL, { reason: "completed" }).events;
  events = append(kinds.RESERVATION_RELEASED, { reason: "completed" }).events;
  assert.equal(append(kinds.RUN_ORIGINAL_RECORDED, original).appended, false);
  const released = selectManagedAttempt({ repository: REPO, subject: SUBJECT, events, attemptId: dispatch.run_id });
  assert.equal(released.selected.released, true);
  assert.equal(released.selected.last_lifecycle_kind, kinds.RESERVATION_RELEASED);
  let unboundReleased = events.filter(event => event.kind !== kinds.RUN_ORIGINAL_RECORDED);
  unboundReleased = rechain(structuredClone(unboundReleased));
  assert.equal(admitAttemptCommand({ repository: REPO, subject: SUBJECT, events: unboundReleased,
    attempt: tuple(), kind: kinds.RUN_ORIGINAL_RECORDED, payload: original }).appended, true);
  const other = buildPrefix([kinds.RESERVATION_CLAIMED], { subject: OTHER_SUBJECT,
    attempt: { ...tuple(), assigned_unit: OTHER_SUBJECT } });
  assert.equal(reduceAttemptJournal({ repository: REPO, subject: OTHER_SUBJECT, events: other }).refusal, null,
    "original corruption is partition-local");
});
