import test from "node:test";
import assert from "node:assert/strict";
import { assignmentChangeCompletionRefusal, assignmentChangeOwnerFailure }
  from "../../packages/wiki-mcp/src/lib/task-request-assignment-change-response.mjs";

test("assignment-change diagnosis keeps specific nested causes and excludes captured internals", () => {
  const leaf = Object.assign(new Error("cannot publish selected completion"), { code: "EIO", syscall: "rename" });
  const error = Object.assign(new Error("completion publication was not acknowledged", { cause: leaf }),
    { code: "completion_store_write_failed", retained_completion: { credential: "server-only" } });
  const refusal = assignmentChangeOwnerFailure({ error, stage: "journal_acceptance", subject: "WK-9500#SLICE-001", retained: true });
  assert.equal(refusal.accepted, null);
  assert.equal(refusal.cause.message, error.message);
  assert.equal(refusal.cause.cause.message, leaf.message);
  assert.equal(refusal.cause.cause.code, "EIO");
  assert.equal(refusal.cause.cause.syscall, "rename");
  assert.doesNotMatch(JSON.stringify(refusal), /server-only|retained_completion|"stack"/u);
  assert.deepEqual(refusal.next_calls.map(({ tool, arguments: args }) => [tool, args]),
    [["get_run_result", { assigned: true }]]);
});

test("assignment-change stop failure cannot reopen a handoff already accepted", () => {
  const error = Object.assign(new Error("stop capability unavailable"), { code: "assignment_change_terminal_capability_unavailable" });
  const unaccepted = assignmentChangeOwnerFailure({ error, stage: "terminal_capability" });
  const accepted = assignmentChangeOwnerFailure({ error, stage: "terminal_capability",
    prior: { alternative: "assignment_change_requested", credential: "server-only" } });
  assert.equal(unaccepted.accepted, false);
  assert.equal(Object.hasOwn(unaccepted, "prior_acceptance"), false);
  assert.equal(unaccepted.recovery.missing_capability, "worker_attempt_termination");
  assert.equal(accepted.prior_acceptance, true);
  assert.equal(accepted.recovery.actor, "coordinator");
  assert.match(accepted.recovery.action, /worker must stop/u);
  assert.deepEqual(accepted.next_calls, []);
  assert.doesNotMatch(JSON.stringify(accepted), /server-only/u);
});

test("assignment-change retention diagnosis includes the persistence owner's envelope cause without its trace", () => {
  const error = Object.assign(new Error("selected-response source could not be retained"), {
    code: "mcp_response.spill_persistence_failed.v1",
    envelope: { cause_diagnostic: { code: "ENOTDIR", message: "ENOTDIR: response storage is not a directory", stack: "server-only" } }
  });
  const refusal = assignmentChangeOwnerFailure({ error, stage: "original_retention" });
  assert.equal(refusal.accepted, false);
  assert.equal(refusal.cause.retention_cause.code, "ENOTDIR");
  assert.equal(refusal.cause.retention_cause.message, error.envelope.cause_diagnostic.message);
  assert.doesNotMatch(JSON.stringify(refusal), /server-only|"stack"/u);
});

test("assignment-change completion conflict returns consequences instead of owner records", () => {
  const refusal = assignmentChangeCompletionRefusal({ subject: "WK-9500#SLICE-001", retained: null,
    decision: { ok: false, code: "completion_binding_consumed", pending_termination: true,
      cause: "active completion authority consumed by accepted assignment-change request",
      completion: { alternative: "assignment_change_requested", original: { ref_id: "private-reference" }, credential: "server-only" } } });
  assert.equal(refusal.accepted, false);
  assert.equal(refusal.prior_acceptance, true);
  assert.match(refusal.cause, /consumed/u);
  assert.match(refusal.known_effects, /original handoff unchanged/u);
  assert.deepEqual(refusal.next_calls, []);
  assert.doesNotMatch(JSON.stringify(refusal), /private-reference|server-only|pending_termination|"completion"/u);
});

test("assignment-change receipt recovery preserves the unfinished task without growing with transaction bookkeeping", () => {
  const subject = "WK-9500#SLICE-001";
  const decision = { code: "completion_delivery_intent_exists", cause: "delivery already owns completion" };
  const response = { commit_object: "created", delivery_ref: "advanced", submitted_for_review: true, checkout: "pending",
    transaction: { checkout: { state: "pending", code: "checkout.index_locked", message: "The worker checkout index is locked." } } };
  const present = value => assignmentChangeCompletionRefusal({ decision, subject, retained: true,
    pending: { carrier: { outcome: { response: value } } } });
  const focused = present(response);
  const grown = present({ ...response, transaction: { ...response.transaction, commit: "server-only", receipts: Array.from({ length: 1000 },
    (_, index) => ({ index, private_storage: `private-${index}`, successful_checks: ["binding", "scope", "publication"] })) } });
  assert.deepEqual(grown, focused, "irrelevant retained history cannot expand the focused response");
  assert.deepEqual(focused.known_effects, { submitted_for_review: true, checkout: "pending" });
  assert.deepEqual(focused.checkout_failure, { code: "checkout.index_locked", message: "The worker checkout index is locked." });
  assert.deepEqual(focused.next_calls.map(({ tool, arguments: args }) => [tool, args]), [["workspace_deliver_work", {}]]);
  assert.doesNotMatch(JSON.stringify(focused), /commit_object|delivery_ref|transaction|server-only|private_storage/u);
  const absent = assignmentChangeCompletionRefusal({ decision, subject, retained: true });
  assert.deepEqual(absent.known_effects, { submitted_for_review: null, checkout: "unknown" });
  assert.deepEqual(absent.next_calls, []);
  assert.equal(absent.recovery.missing_capability, "delivery_without_receipt_reconciliation");
  const complete = present({ ...response, checkout: "complete" });
  assert.deepEqual(complete.next_calls, [], "a complete delivery requires no repeated call");
  assert.equal(Object.hasOwn(complete, "checkout_failure"), false, "do not copy stale checkout failure into a completed outcome");
  assert.match(complete.recovery.action, /required final report and terminate/u);
  const superseded = present({ ...response, checkout: "superseded", transaction: {
    checkout: { code: "checkout.superseded", message: "A later commit moved the branch." } } });
  assert.equal(superseded.recovery.missing_capability, "superseded_delivery_checkout_reconciliation");
  assert.deepEqual(superseded.next_calls, [], "do not offer an unchanged retry of a superseded checkout");
  assert.equal(superseded.checkout_failure.code, "checkout.superseded");
});
