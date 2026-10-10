

import assert from "node:assert/strict";
import test from "node:test";

import { createCompletedIntegrationCandidateObservation } from
  "../../packages/agent-launch-cli/src/lib/backend-completed-integration-candidate-observation.mjs";

const SUBJECT = "WK-2731#SLICE-001";
const STATUS = Object.freeze({ subject: SUBJECT, run_id: "run-1", monitor_handle: "wkmh_1" });
const [PRODUCED, LIVE, CANDIDATE] = ["a".repeat(40), "b".repeat(40), "c".repeat(40)];
const candidateAt = (wkTip) => ({
  binding: { canonical_wk_id: "WK-2731", wk_tip: wkTip, candidate: CANDIDATE },
  materialization: { canonical_wk_id: "WK-2731", wk_tip: wkTip, candidate: CANDIDATE, verified: true }
});

function compose({ continuation, candidate }) {
  const calls = [];
  const observe = createCompletedIntegrationCandidateObservation({
    resolveCommittedSliceIntegrationContinuation: async (args) => {
      calls.push(["integration", args]);
      return typeof continuation === "function" ? continuation() : continuation;
    },
    observeTerminalCandidate: candidate === undefined ? undefined : async (wkId) => {
      calls.push(["candidate", wkId]);
      return typeof candidate === "function" ? candidate() : candidate;
    }
  });
  return { observe, calls };
}

test("WK-2731: a completed integration joins the candidate built from the tip it produced", async () => {
  const integration = { integrated: true, wk_sha: PRODUCED };
  const { observe, calls } = compose({
    continuation: { requested: true, completed: true, integration }, candidate: candidateAt(PRODUCED) });
  const observed = await observe({ subject: SUBJECT, status: STATUS });
  assert.deepEqual(observed, { invoked: false, phase: "finalized", integrated: true, integration,
    terminal_candidate: candidateAt(PRODUCED) });
  assert.deepEqual(calls, [["integration", { subject: SUBJECT, status: STATUS }], ["candidate", "WK-2731"]]);
});

test("WK-2731: the retained result's own tip, not a later live tip, selects the candidate", async () => {
  const continuation = { requested: true, completed: true,
    integration: { integrated: true, wk_sha: LIVE },
    completed_integration: { integrated: true, wk_sha: PRODUCED } };
  assert.equal((await compose({ continuation, candidate: candidateAt(PRODUCED) })
    .observe({ subject: SUBJECT, status: STATUS })).terminal_candidate.binding.wk_tip, PRODUCED);
  assert.equal(await compose({ continuation, candidate: candidateAt(LIVE) })
    .observe({ subject: SUBJECT, status: STATUS }), null);
});

test("WK-2731: nothing is observed without a composed observer, an exact slice, a completed integration or a candidate", async () => {
  const completed = { requested: true, completed: true, integration: { integrated: true, wk_sha: PRODUCED } };
  const unread = compose({ continuation: completed });
  assert.equal(await unread.observe({ subject: SUBJECT, status: STATUS }), null);
  assert.deepEqual(unread.calls, [], "no observer composed: the integration owner is not read");
  for (const subject of ["WK-2731", "WK-2731#review-1", undefined]) {
    const whole = compose({ continuation: completed, candidate: candidateAt(PRODUCED) });
    assert.equal(await whole.observe({ subject, status: STATUS }), null);
    assert.deepEqual(whole.calls, []);
  }
  for (const continuation of [null, { requested: true, completed: false },
    { requested: true, completed: true, integration: { integrated: false, wk_sha: PRODUCED } }]) {
    const pending = compose({ continuation, candidate: candidateAt(PRODUCED) });
    assert.equal(await pending.observe({ subject: SUBJECT, status: STATUS }), null);
    assert.equal(pending.calls.some(([owner]) => owner === "candidate"), false,
      "the candidate owner is read only for a completed integration");
  }
  for (const candidate of [null, { binding: candidateAt(PRODUCED).binding, materialization: null }]) {
    assert.equal(await compose({ continuation: completed, candidate })
      .observe({ subject: SUBJECT, status: STATUS }), null);
  }
});

test("WK-2731: each owner's refusal propagates with its own cause", async () => {
  const refused = Object.assign(new Error("refused"), { code: "owner_refused" });
  await assert.rejects(compose({ continuation: () => { throw refused; }, candidate: candidateAt(PRODUCED) })
    .observe({ subject: SUBJECT, status: STATUS }), refused);
  await assert.rejects(compose({
    continuation: { requested: true, completed: true, integration: { integrated: true, wk_sha: PRODUCED } },
    candidate: () => { throw refused; } }).observe({ subject: SUBJECT, status: STATUS }), refused);
});
