

import assert from "node:assert/strict";
import test from "node:test";

import { ATTEMPT_JOURNAL_REFUSALS, digestOf, selectManagedAdmissionAttempt } from
  "../../packages/agent-launch-core/src/index.mjs";
import { admitReviewOriginalBinding, reviewOriginalPartitionSubject, selectReviewOriginalBinding } from
  "../../packages/agent-launch-core/src/lib/managed-run-observation.mjs";

const repository = "/repo", subject = "WK-0001";
const binding = (runId, digit = "a", role = "reviewer") => ({ run_id: runId, role,
  original_result: { ref_id: `resp-${runId}`, sha256: digit.repeat(64) } });
const admit = (events, value) => admitReviewOriginalBinding({ repository, subject, events, binding: value });
const select = (events, attemptId = null) => selectReviewOriginalBinding({ repository, subject, events, attemptId });

test("WK-2731: a review binding is admitted once, repeated idempotently and never replaced", () => {
  const first = admit([], binding("wkdb_one"));
  assert.equal(first.appended, true);
  assert.deepEqual(Object.keys(first.events[0].binding).sort(), ["original_result", "role", "run_id"],
    "linkage only: no review text is carried");
  const repeated = admit(first.events, binding("wkdb_one"));
  assert.deepEqual([repeated.admitted, repeated.appended, repeated.events], [true, false, first.events]);
  const conflict = admit(first.events, binding("wkdb_one", "b"));
  assert.equal(conflict.admitted, false);
  assert.equal(conflict.refusal.code, ATTEMPT_JOURNAL_REFUSALS.BINDING_MISMATCH);
  for (const invalid of [binding("wkdb_two", "a", "worker"), binding("", "a"), binding("wkdb_two", "Z"),
    { ...binding("wkdb_two"), text: "review text" }]) {
    assert.equal(admit(first.events, invalid).refusal.code, ATTEMPT_JOURNAL_REFUSALS.BINDING_MISMATCH);
  }
});

test("WK-2731: several review bindings need the exact attempt and none is guessed", () => {
  assert.deepEqual(select([]), { ok: false, code: "attempt_observation_unavailable" });
  const one = admit([], binding("wkdb_one")).events;
  assert.deepEqual(select(one).review, binding("wkdb_one"));
  const two = admit(one, binding("wkdb_two", "b")).events;
  assert.deepEqual(select(two), { ok: false, code: "attempt_selection_ambiguous" });
  assert.deepEqual(select(two, "wkdb_two").review, binding("wkdb_two", "b"));
  assert.deepEqual(select(two, "wkdb_absent"), { ok: false, code: "attempt_selector_mismatch" });
});

test("WK-2731: a damaged binding chain refuses with its cause and selects nothing", () => {
  const events = admit(admit([], binding("wkdb_one")).events, binding("wkdb_two", "b")).events;
  const resign = (event) => { const { digest: _digest, ...unsigned } = event; return { ...unsigned, digest: digestOf(unsigned) }; };
  const faults = [
    [[{ ...events[0], extra: true }, events[1]], ATTEMPT_JOURNAL_REFUSALS.UNEXPECTED_KEYS],
    [[resign({ ...events[0], subject: "WK-9999" }), events[1]], ATTEMPT_JOURNAL_REFUSALS.BINDING_MISMATCH],
    [[events[0], resign({ ...events[1], binding: binding("wkdb_one", "b") })], ATTEMPT_JOURNAL_REFUSALS.BINDING_MISMATCH],
    [[events[1]], ATTEMPT_JOURNAL_REFUSALS.CHAIN_BROKEN],
    [[{ ...events[0], binding: binding("wkdb_one", "c") }, events[1]], ATTEMPT_JOURNAL_REFUSALS.DIGEST_MISMATCH]
  ];
  for (const [damaged, code] of faults) {
    for (const answer of [select(damaged, "wkdb_two"), select(damaged)]) {
      assert.equal(answer.ok, false);
      assert.equal(answer.refusal.code, code);
      assert.equal(answer.review, undefined);
    }
    assert.equal(admit(damaged, binding("wkdb_three", "d")).refusal.code, code);
  }
});

test("WK-2731: a review binding is never an attempt and never shares an attempt partition", () => {
  assert.notEqual(reviewOriginalPartitionSubject(subject), subject);
  const events = admit([], binding("wkdb_one")).events;

  assert.equal(selectManagedAdmissionAttempt({ repository, subject, events }).ok, false);
  assert.equal(selectManagedAdmissionAttempt({ repository, subject, events: [] }).selected, null);
});
