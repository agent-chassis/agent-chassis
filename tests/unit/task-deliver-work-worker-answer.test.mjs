import test from "node:test";
import assert from "node:assert/strict";
import { prepareWorkerDeliveryAnswer } from "../../packages/wiki-mcp/src/lib/task-deliver-work-worker-answer.mjs";

function frame(body = {}, isError = true) {
  return { isError, body: { outcome: "refused", subject: "WK-9732#SLICE-001", stage: "binding_resolution",
    effects: { commit_object: "not_created", delivery_ref: "unchanged", submitted_for_review: false, checkout: "not_attempted" },
    diagnostics: [], selected_delivery: null, output: { state: "prepared" }, ...body } };
}

test("successful worker answer selects the protocol owner's remaining steps and needs no read", () => {
  const source = frame({ outcome: "delivered", repository: "private-repository", tree: "private-tree",
    reconciliation: { candidate_commit: "private-candidate" }, original: { locator: { ref_id: "private-ref" } },
    delivery_receipt: { state: "published", appended: true },
    next_action: { instruction: "Completion protocol, in this order: for delivery, (1) successfully invoke workspace_deliver_work({}); " +
      "(2) emit `agent-role-result.v1` diagnostic evidence; (3) terminate. Other lifecycle instructions." } }, false);
  const answer = prepareWorkerDeliveryAnswer(source);
  assert.deepEqual(Object.keys(answer).sort(), ["next_action", "next_calls", "outcome"]);
  assert.match(answer.next_action.instruction, /emit `agent-role-result.v1` diagnostic evidence; terminate\./u);
  assert.doesNotMatch(JSON.stringify(answer), /private-|workspace_deliver_work|Other lifecycle/u);
  assert.deepEqual(answer.next_calls, []);
  const repeated = prepareWorkerDeliveryAnswer({ ...source, body: { ...source.body,
    invocation_effects: { commit_transaction_executed: false } } });
  assert.equal(repeated.acknowledgment, "already_delivered");
  assert.throws(() => prepareWorkerDeliveryAnswer({ ...source, body: { ...source.body,
    next_action: { instruction: "Delivery succeeded" } } }), /no post-delivery steps/u,
  "removing the necessary completion instructions cannot manufacture a terminal protocol");
});

test("completion consumption distinguishes prior intent, accepted change and terminal attempt", () => {
  for (const [code, pattern] of [
    ["completion_delivery_intent_exists", /Prior effects remain unresolved/u],
    ["completion_binding_consumed", /Do not deliver, emit another final report, or make another call/u],
    ["completion_attempt_terminal", /No worker continuation/u]
  ]) {
    const answer = prepareWorkerDeliveryAnswer(frame({ diagnostics: [
      { stage: "binding_resolution", code: "binding_wrapper", detail: { cause: { code } } },
      { stage: "binding_resolution.cause", code, message: `actual ${code}` }
    ] }));
    assert.match(answer.next_action.instruction, pattern);
    assert.deepEqual(answer.next_calls, []);
    assert.match(JSON.stringify(answer.diagnostics), new RegExp(code, "u"));
    if (code === "completion_delivery_intent_exists") {
      assert.equal(answer.effects.delivery_ref, "unknown");
      assert.equal(answer.outcome, "uncertain");
    }
  }
});

test("only the failed binding operation can select completion stopping behavior", () => {
  for (const code of ["completion_binding_consumed", "completion_delivery_intent_exists", "completion_attempt_terminal"]) {
    const diagnostic = { stage: "binding_resolution", code: "binding_wrapper",
      message: "the assigned binding could not be resolved", detail: { authored: { code } } };
    const ordinary = prepareWorkerDeliveryAnswer(frame({ diagnostics: [diagnostic] }));
    assert.match(ordinary.next_action.instruction, /launcher assignment or binding condition/u);
    assert.equal(ordinary.outcome, "refused");
    const wrongStage = prepareWorkerDeliveryAnswer(frame({ stage: "materialization", diagnostics: [
      { ...diagnostic, stage: "materialization" }, { stage: "binding_resolution.cause", code }
    ] }));
    assert.match(wrongStage.next_action.instruction, /exact transaction reconciliation/u);
    assert.equal(wrongStage.outcome, "refused");
  }
});

test("completion cause survives without the duplicate wrapper or journal population", () => {
  const cause = { stage: "binding_resolution.cause", code: "completion_delivery_intent_exists",
    message: "delivery intent already owns completion; effects may exist" };
  const answer = population => prepareWorkerDeliveryAnswer(frame({ diagnostics: [
    { stage: "binding_resolution", code: "binding_wrapper", detail: { cause: {
      code: cause.code, message: cause.message, completion: { intent_id: "server-only", history: population }
    } } }, cause
  ] }));
  const empty = answer([]);
  const large = answer(Array.from({ length: 1000 }, (_, i) => ({ intent_id: `internal-${i}` })));
  assert.equal(Buffer.byteLength(JSON.stringify(large)), Buffer.byteLength(JSON.stringify(empty)),
    "irrelevant journal growth cannot inflate the failure answer");
  assert.deepEqual(large, empty, "irrelevant journal growth cannot inflate the failure answer");
  assert.deepEqual(large.diagnostics, [cause]);
  assert.doesNotMatch(JSON.stringify(large), /binding_wrapper|intent_id|history|server-only/u);
  const removed = prepareWorkerDeliveryAnswer(frame({ diagnostics: [] }));
  const altered = prepareWorkerDeliveryAnswer(frame({ diagnostics: [{ ...cause, code: "unrelated_failure" }] }));
  for (const control of [removed, altered]) {
    assert.equal(control.outcome, "refused");
    assert.notEqual(control.next_action.instruction, large.next_action.instruction,
      "missing or altered operation identity cannot establish prior delivery authority");
  }
});

test("partial, compensated and uncertain publication keep independent actual effects and causes", () => {
  for (const [outcome, delivery_ref, submitted_for_review] of [
    ["partial", "advanced", false], ["refused", "restored", false], ["uncertain", "unknown", null]
  ]) {
    const answer = prepareWorkerDeliveryAnswer(frame({ outcome, stage: "compensation",
      effects: { commit_object: "created", delivery_ref, submitted_for_review, checkout: "not_attempted" },
      diagnostics: [{ stage: "compensation", code: "compensation_cause", message: "exact compensation condition" }] }));
    assert.equal(answer.outcome, outcome);
    assert.equal(answer.effects.delivery_ref, delivery_ref);
    assert.equal(answer.effects.submitted_for_review, submitted_for_review);
    assert.equal(answer.diagnostics[0].message, "exact compensation condition");
    assert.deepEqual(answer.next_calls, []);
  }
});

test("receipt and checkout residue cannot masquerade as completion or erase the delivery", () => {
  const selected_delivery = { commit: "a".repeat(40), base: "b".repeat(40) };
  const source = frame({ outcome: "partial", selected_delivery, stage: "checkout",
    output: { state: "failed" }, delivery_receipt: { state: "failed" },
    effects: { commit_object: "created", delivery_ref: "advanced", submitted_for_review: true, checkout: "pending" },
    diagnostics: [{ stage: "delivery_receipt_publication", code: "attempt_partition_contended", message: "partition is held" },
      { stage: "canonical_review", state: "review", code: "review_transition_valid" },
      { stage: "checkout", code: "index_locked", message: "worker index is held" }] }, false);
  const answer = prepareWorkerDeliveryAnswer(source);
  assert.equal(answer.outcome, "partial");
  assert.deepEqual(answer.selected_delivery, { commit: selected_delivery.commit },
    "the worker can identify the surviving delivery without its server-only base binding");
  assert.deepEqual(answer.remaining, ["receipt_publication", "checkout_finalization"]);
  assert.match(answer.next_action.instruction, /receipt and pending checkout/u);
  assert.deepEqual(answer.next_calls, [{ tool: "workspace_deliver_work", arguments: {} }]);
  assert.equal(answer.diagnostics.length, 2, "both deciding failures survive");
  const superseded = prepareWorkerDeliveryAnswer({ ...source, body: { ...source.body,
    output: { state: "prepared" }, delivery_receipt: { state: "published" },
    effects: { ...source.body.effects, checkout: "superseded" } } });
  assert.equal(superseded.next_action.action, "stop");
  assert.deepEqual(superseded.next_calls, []);
});

test("scope paths survive a sibling original-retention failure without a fabricated recovery", () => {
  const answer = prepareWorkerDeliveryAnswer(frame({ output: { state: "failed" },
    diagnostics: [{ stage: "original_retention", code: "EACCES", message: "original could not be retained" }] }),
  { scopeRefusal: { code: "scope_refused", reasons: ["out_of_scope"], out_of_scope: ["src/missing.txt"] } });
  assert.deepEqual(answer.scope.out_of_scope, ["src/missing.txt"]);
  assert.equal(answer.diagnostics[0].code, "EACCES");
  assert.deepEqual(answer.next_calls, []);
});

test("failed retention preserves the native condition without transport budgets or carrier bookkeeping", () => {
  const answer = prepareWorkerDeliveryAnswer(frame({ output: { state: "failed" }, diagnostics: [{
    stage: "original_retention", code: "mcp_response.spill_persistence_failed.v1", detail: { cause: {
      code: "mcp_response.spill_persistence_failed.v1", message: "original could not be retained", envelope: {
        schema_version: "mcp-response-refusal.v1", code: "mcp_response.spill_persistence_failed.v1",
        inline_byte_limit: 8192, total_bytes: 12000, core_result: { preserved: "identity_only" },
        cause_diagnostic: { code: "EACCES", message: "permission denied at the response store", path: "/reported/store" }
      }
    } }
  }] }));
  assert.match(JSON.stringify(answer), /EACCES.*permission denied at the response store.*reported\/store/u);
  assert.doesNotMatch(JSON.stringify(answer), /inline_byte_limit|total_bytes|core_result|identity_only/u);
  assert.deepEqual(answer.next_calls, []);
});
