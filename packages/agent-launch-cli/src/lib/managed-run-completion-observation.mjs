
import { ATTEMPT_EVENT_KINDS, sameAttempt } from "@agent-chassis/agent-launch-core";
import { DELIVERY_COMPLETION_RELEASE_FACTS } from "../../../agent-launch-core/src/lib/managed-worker-attempt-journal.mjs";
import { isDeepStrictEqual } from "node:util";

export const COMPLETION_OBSERVATION_KIND = ATTEMPT_EVENT_KINDS.COMPLETION_OBSERVATION_RECORDED;

export function completionObservations(events, tuple) {
  if (tuple === null || tuple === undefined) return [];
  return events.filter(event => event.kind === COMPLETION_OBSERVATION_KIND &&
    sameAttempt(event.payload.dispatch_tuple, tuple)).map(event => event.payload.completion);
}

export function activeCompletion(history) {
  const released = new Set(history.filter(item => item.phase === "released_zero_effects")
    .map(item => item.released_intent_id));
  return history.find(item => item.alternative === "assignment_change_requested" ||
    (item.phase === "before_materialization" && !released.has(item.intent_id))) ?? null;
}

const attemptTerminal = (events, selected) => selected.released || events.some(event =>
  sameAttempt(event.attempt, selected.attempt) && [ATTEMPT_EVENT_KINDS.EXECUTION_TERMINATED,
    ATTEMPT_EVENT_KINDS.ATTEMPT_TERMINAL, ATTEMPT_EVENT_KINDS.RESERVATION_RELEASED,
    ATTEMPT_EVENT_KINDS.RUN_RESULT_RECORDED].includes(event.kind));

export function deliveryCompletionReleaseFacts(outcome) {
  const tx = outcome?.transaction;
  if (outcome?.committed !== false || outcome.submitted_for_review !== false) return null;
  if (outcome.delivery_ref === "unchanged" && tx?.delivery_commit === null &&
      tx.canonical_review?.state === "not_attempted") return DELIVERY_COMPLETION_RELEASE_FACTS.UNPUBLISHED;
  if (outcome.delivery_ref === "restored" && tx?.canonical_review?.written === false &&
      typeof tx.delivery_commit === "string" && typeof tx.prior_tip === "string" &&
      tx.compensation?.state === "restored" && tx.compensation.published_commit === tx.delivery_commit &&
      tx.compensation.restored_tip === tx.prior_tip) return DELIVERY_COMPLETION_RELEASE_FACTS.COMPENSATED;
  return null;
}

export function deliveryCompletionRelease({ subject, sliceBinding, original }) {
  const outcome = original?.outcome?.response;
  const facts = deliveryCompletionReleaseFacts(outcome);
  const intent = original?.completion_intent;
  if (original?.identity?.unit !== subject || !isDeepStrictEqual(original?.identity?.binding, sliceBinding) ||
      facts === null || outcome.completion_recovery?.available !== false ||
      intent?.alternative !== "delivery" || intent.phase !== "before_materialization" ||
      typeof intent.intent_id !== "string" || intent.intent_id.length === 0) {
    return { ok: false, code: "completion_release_evidence_unproven",
      cause: "the selected transaction does not establish this bound delivery's safe failed release" };
  }
  return { ok: true, intent, completion: { alternative: "delivery", intent_id: `release-${intent.intent_id}`,
    released_intent_id: intent.intent_id, phase: "released_zero_effects", known_effects: facts } };
}

export function reconcileDeliveryCompletion({ events, selected, intent, completion }) {
  const history = completionObservations(events, selected.dispatch_tuple);
  if (!history.some(item => isDeepStrictEqual(item, intent))) return { ok: false,
    code: "completion_release_owner_mismatch", cause: "the selected transaction's intent is not owned by this attempt" };
  const active = activeCompletion(history);
  if (active !== null && !isDeepStrictEqual(active, intent)) return { ok: false,
    code: "completion_binding_consumed", cause: "another completion owns this attempt; the selected transaction cannot release it" };
  if (attemptTerminal(events, selected)) return { ok: false, code: "completion_attempt_terminal",
    cause: "the selected transaction cannot restore a terminal attempt's completion capability" };
  return arbitrateCompletion({ events, selected, completion });
}

export function arbitrateCompletion({ events, selected, completion }) {
  const history = completionObservations(events, selected.dispatch_tuple);
  if (completion.phase === "released_zero_effects") {
    const existing = history.find(item => item.intent_id === completion.intent_id);
    if (existing !== undefined) return JSON.stringify(existing) === JSON.stringify(completion)
      ? { ok: true, appended: false, completion: existing }
      : { ok: false, code: "completion_release_conflict" };
    const active = activeCompletion(history);
    return active?.alternative === "delivery" && active.intent_id === completion.released_intent_id
      ? { ok: true, appended: true, completion }
      : { ok: false, code: "completion_release_owner_mismatch" };
  }
  const request = history.find(item => item.alternative === "assignment_change_requested");
  if (request !== undefined) {
    return completion.alternative === request.alternative &&
      completion.request_digest === request.request_digest &&
      completion.assignment_digest === request.assignment_digest
      ? { ok: true, appended: false, completion: request }
      : { ok: false, code: "completion_binding_consumed", completion: request,
        cause: "active completion authority consumed by accepted assignment-change request" };
  }
  const delivery = activeCompletion(history);
  if (delivery !== null) return { ok: false, code: "completion_delivery_intent_exists",
    completion: delivery, cause: "delivery intent already owns completion; effects may exist",
    recovery: { owner: "delivery transaction owner",
      action: "select the exact authenticated retained transaction for receipt recovery or proven failed-release reconciliation; absent or unproven evidence cannot authorize replay" } };
  if (attemptTerminal(events, selected)) return { ok: false, code: "completion_attempt_terminal",
    cause: "a first completion request cannot change a terminated or released attempt" };
  return { ok: true, appended: true, completion };
}
