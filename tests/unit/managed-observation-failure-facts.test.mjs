

import assert from "node:assert/strict";
import test from "node:test";

import { isManagedAttemptSelectionRefusal, managedObservationFailureFacts, selectManagedAttempt } from
  "../../packages/agent-launch-core/src/lib/managed-run-observation.mjs";

test("WK-2731: a refused attempt selection is told apart from a failed read", () => {

  const unselected = selectManagedAttempt({ repository: "/repo", subject: "WK-0001#SLICE-001", events: [],
    attemptId: "wkdb_absent" });
  assert.equal(unselected.ok, false);
  assert.equal(isManagedAttemptSelectionRefusal(unselected), true);
  for (const code of ["attempt_selector_mismatch", "attempt_selection_ambiguous", "attempt_observation_unavailable"]) {
    assert.equal(isManagedAttemptSelectionRefusal({ ok: false, code }), true, code);
  }
  for (const failed of [{ ok: false, refusal: { code: "attempt_journal.binding_mismatch.v1" } },
    { ok: false, code: "proof_verification_record_invalid" }, { ok: false, code: "future_observation_failure" },
    { ok: true, code: "attempt_selector_mismatch" }, null, undefined]) {
    assert.equal(isManagedAttemptSelectionRefusal(failed), false, JSON.stringify(failed));
  }
});

test("WK-2731: a failed observation keeps every cause fact and drops only the journal carrier", () => {
  const refusal = { schema_version: "managed-worker-attempt-journal.v1",
    code: "attempt_journal.binding_mismatch.v1", reason: "run original conflicts", detail: null };
  const failed = Object.freeze({ ok: false, refusal, code: "attempt_journal.binding_mismatch.v1",
    structured_failure: { message: "owner fact" }, observation_failure: new Error("thrown"),
    repository: "/repo", prefix: { sequence: 5 },
    events: [{ payload: { result: { full_response: { text: "complete child text" } } } }],
    attempts: [{ result: { full_response: { text: "complete child text" } } }] });
  const facts = managedObservationFailureFacts(failed);
  assert.deepEqual(Object.keys(facts).sort(),
    ["code", "observation_failure", "ok", "refusal", "structured_failure"]);
  assert.equal(facts.refusal, refusal);
  assert.equal(facts.observation_failure, failed.observation_failure);
  assert.equal(JSON.stringify(facts).includes("complete child text"), false);
  assert.deepEqual(Object.keys(failed).length, 9, "the owner's record is not mutated");

  const page = { ok: true, events: [], summary: {} };
  assert.equal(managedObservationFailureFacts(page), page);
  assert.equal(managedObservationFailureFacts(null), null);
});
