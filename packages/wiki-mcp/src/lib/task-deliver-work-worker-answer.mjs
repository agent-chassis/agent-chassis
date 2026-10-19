

import { buildNextCall } from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";

const retry = () => buildNextCall({ tool: "workspace_deliver_work", arguments: {} });
const stop = instruction => ({ action: "stop", instruction });
const completionFailures = new Set([
  "completion_binding_consumed", "completion_delivery_intent_exists", "completion_attempt_terminal"
]);

function failureMeaning(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(failureMeaning);
  if (value.schema_version === "mcp-response-refusal.v1") return Object.fromEntries(
    ["code", "reason", "cause_diagnostic", "cause_serialization_failure"]
      .filter(key => Object.hasOwn(value, key)).map(key => [key, failureMeaning(value[key])]));
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, failureMeaning(child)]));
}

export function prepareWorkerDeliveryAnswer(frame, { scopeRefusal = null, inputInvalid = false } = {}) {
  const source = frame.body;
  const outputFailed = source.output.state === "failed";
  if (source.outcome === "delivered" && !frame.isError && !outputFailed) {

    const steps = source.next_action.instruction.match(/; \(2\) ([^;]+); \(3\) ([^.]+\.)/u);
    if (steps === null) throw new TypeError("delivery completion owner supplied no post-delivery steps");
    return { outcome: "delivered",
      ...(source.invocation_effects?.commit_transaction_executed === false ? { acknowledgment: "already_delivered" } : {}),
      next_action: {
      action: "emit_diagnostic_evidence_then_terminate",
      instruction: `Use the launcher's required final-result format: ${steps[1]}; ${steps[2]}`
    }, next_calls: [] };
  }

  const priorUnresolved = source.stage === "receipt_recovery";
  const effects = priorUnresolved ? {
    commit_object: "unknown", delivery_ref: "unknown", submitted_for_review: null, checkout: null
  } : Object.fromEntries(["commit_object", "delivery_ref", "submitted_for_review", "checkout"]
    .map(key => [key, source.effects[key]]));

  const bindingCause = source.stage === "binding_resolution"
    ? source.diagnostics.find(row => row.stage === "binding_resolution.cause") : null;
  const completionCode = completionFailures.has(bindingCause?.code) ? bindingCause.code : null;
  const diagnostics = source.diagnostics

    .filter(row => !(completionCode !== null && row.stage === "binding_resolution"))
    .filter(row => !(row.stage === "canonical_review" && row.state === "review"))
    .map(row => Object.fromEntries(Object.entries(failureMeaning(row))
    .filter(([key, value]) => value !== null && key !== "state")))
    .filter(row => row.code !== undefined || row.message !== undefined || row.detail !== undefined)
    .filter(row => !(scopeRefusal !== null && row.stage === "scope_verification" &&
      row.code === scopeRefusal.code && row.detail === undefined));
  const receiptFailed = source.delivery_receipt?.state === "failed";
  const checkoutPending = effects.checkout === "pending";
  const checkoutSuperseded = effects.checkout === "superseded";
  const answer = { outcome: priorUnresolved ? "uncertain"
    : source.outcome === "delivered" && outputFailed ? "partial" : source.outcome,
    subject: source.subject, stage: source.stage, effects, diagnostics, next_action: null, next_calls: [] };

  if (source.selected_delivery !== null) answer.selected_delivery = { commit: source.selected_delivery.commit };
  if (scopeRefusal !== null) answer.scope = Object.fromEntries(
    ["code", "reasons", "out_of_scope", "symlink_or_type_swap", "forbidden_repository_paths"]
      .filter(key => scopeRefusal[key] !== undefined && (!Array.isArray(scopeRefusal[key]) || scopeRefusal[key].length > 0))
      .map(key => [key, scopeRefusal[key]]));
  if (source.effects_scope === "historical_transaction") {
    answer.effects_scope = "prior_delivery";
    answer.invocation_effects = {
      commit_transaction_executed: false,
      checkout_finalization_attempted: source.invocation_effects?.checkout_finalization_attempted === true
    };
  }
  if (priorUnresolved) {
    answer.invocation_effects = { commit_transaction_executed: false };
    answer.next_action = stop("Prior delivery effects could not be resolved. This request started no new commit transaction. " +
      "Preserve any earlier delivery acknowledgment. No callable reconciliation is available; do not retry delivery or create another commit. " +
      "Report the specific limitation without claiming completed.");
  } else if (inputInvalid) {
    answer.next_action = { action: "correct_arguments", instruction:
      "Delivery accepts only {} for the authenticated assignment. Explicitly resolve the rejected inputs before choosing delivery; " +
      "no corrected mutation was selected." };
  } else if (completionCode === "completion_binding_consumed") {
    answer.next_action = stop("An accepted assignment-change request already consumed completion and ends this worker. " +
      "Do not deliver, emit another final report, or make another call.");
  } else if (completionCode === "completion_delivery_intent_exists") {
    answer.effects = { commit_object: "unknown", delivery_ref: "unknown", submitted_for_review: null, checkout: null };
    answer.outcome = "uncertain";
    answer.next_action = stop("A prior delivery intent owns completion, but no recoverable successful original was selected. " +
      "Prior effects remain unresolved. No callable reconciliation is available; do not retry delivery, create another commit, " +
      "or switch completion alternatives. Report the specific limitation without claiming completed.");
  } else if (completionCode === "completion_attempt_terminal") {
    answer.next_action = stop("This attempt is terminal; a first delivery cannot change it. No worker continuation is available. " +
      "Do not create a successor or replace completion authority.");
  } else if (receiptFailed) {
    answer.remaining = ["receipt_publication", ...(checkoutPending ? ["checkout_finalization"] : [])];
    answer.next_action = { action: "recover_delivery", instruction:
      "The commit and review submission stand; receipt publication failed. After the reported cause is corrected, use the returned request " +
      "to recover only the receipt" + (checkoutPending ? " and pending checkout" : "") +
      ". No commit, ref movement or review submission is repeated." +
      (checkoutSuperseded ? " The checkout is superseded and has no same-delivery repair." : "") };
    answer.next_calls = [retry()];
  } else if (outputFailed) {
    answer.remaining = ["delivery_original"];
    answer.next_action = stop("The reported transaction effects stand, but its complete delivery original is unavailable. " +
      "No callable recovery is available. Do not retry delivery or create another commit; report the specific limitation without claiming completed.");
  } else if (checkoutPending && effects.submitted_for_review === true) {
    answer.remaining = ["checkout_finalization"];
    answer.next_action = { action: "finish_pending_checkout", instruction:
      "The commit and review submission stand. Correct the reported checkout cause within your authority, without discarding work, " +
      "then use the returned request to finish the retained delivery's checkout. No commit, ref movement or review submission is repeated." };
    answer.next_calls = [retry()];
  } else if (checkoutSuperseded && effects.submitted_for_review === true) {
    answer.next_action = stop("The commit and review submission stand, but the checkout is superseded. " +
      "No same-delivery checkout retry can finish it. Report this specific limitation without claiming completed.");
  } else if (scopeRefusal !== null) {
    answer.next_action = { action: "correct_scope", instruction:
      "The reported paths violate the assigned scope or path-kind restrictions. Correct only your authorized accidental changes, " +
      "recheck affected behavior, then choose the returned delivery request. If required work needs missing assignment paths, author request_assignment_change " +
      "with the actual gap, evidence, exact correction, completed_work and remaining_work. Acceptance ends the worker immediately. " +
      "This refusal grants no widening or discard authority." };
    answer.next_calls = [buildNextCall({ tool: "workspace_deliver_work", arguments: {}, recommended: false,
      reason: "Only after the reported task-owned scope violation is corrected and affected behavior is checked." })];
  } else if (["authentication", "binding_resolution"].includes(source.stage)) {
    answer.next_action = stop("The reported launcher assignment or binding condition prevents delivery. " +
      "No callable provisioning repair is available. Request arguments cannot replace the session, binding or credentials. " +
      "Report the specific limitation without claiming completed.");
  } else {
    answer.next_action = stop("The reported delivery effects require exact transaction reconciliation; no callable repair is available. " +
      "Do not retry delivery, create another commit, or change refs or canonical review state. Report the specific limitation without claiming completed.");
  }
  return answer;
}
