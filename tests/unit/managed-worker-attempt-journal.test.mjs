

import assert from "node:assert/strict";
import test from "node:test";

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
    selected_proof_count: 0, tested_source: null, coverage_scope: "requested_selection_only",
    grants_authority: false
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
