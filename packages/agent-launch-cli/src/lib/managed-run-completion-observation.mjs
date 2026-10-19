
import { ATTEMPT_EVENT_KINDS, sameAttempt } from "@agent-chassis/agent-launch-core";

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
    recovery: { owner: "delivery transaction owner", action: "workspace_deliver_work receipt recovery",
      missing_capability: "no callable reconciliation for an intent without a retained delivery receipt; do not blindly retry" } };
  const terminal = events.some(event => sameAttempt(event.attempt, selected.attempt) &&
    [ATTEMPT_EVENT_KINDS.EXECUTION_TERMINATED, ATTEMPT_EVENT_KINDS.ATTEMPT_TERMINAL,
      ATTEMPT_EVENT_KINDS.RESERVATION_RELEASED, ATTEMPT_EVENT_KINDS.RUN_RESULT_RECORDED].includes(event.kind));
  if (terminal || selected.released) return { ok: false, code: "completion_attempt_terminal",
    cause: "a first completion request cannot change a terminated or released attempt" };
  return { ok: true, appended: true, completion };
}
