

import { projectFailureDiagnosis } from "@agent-chassis/wiki-core/src/lib/diagnostic-projection.mjs";
import { buildNextCall } from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";
import { projectToolInputValidationFailure } from "./register-tool.mjs";
import { completionReconciliationCall } from "./task-deliver-work-worker-answer.mjs";

const observeAssigned = () => buildNextCall({ tool: "get_run_result", arguments: { assigned: true } });
const stopAccepted = "This worker must stop; no further worker action or completion is permitted. " +
  "The coordinator observes the original handoff and decides any assignment revision separately.";

export async function assignmentChangeInputFailure({ args, validationError, subject }) {
  const { subject: _callerSubject, issue_count: _count, ...failure } =
    await projectToolInputValidationFailure({ tool: "request_assignment_change", args, validationError });
  const handoffFields = [...new Set(failure.invalid_fields.map(issue => issue.path[0])
    .filter(field => field === "completed_work" || field === "remaining_work"))];
  return { ...failure, subject, known_effects: "no new acceptance; prior completion not checked",
    correction: "Correct the reported constraints for the current worker assignment; preserve your requested correction." +
      (handoffFields.length === 0 ? "" : ` Supply your own ${handoffFields.join(" and ")} as the handoff; acceptance ends this worker without a later report.`) };
}

export function assignmentChangeCompletionRefusal({ decision, subject, retained, pending = null, release = null }) {
  const code = decision.code ?? decision.refusal?.code;
  const cause = decision.cause ?? decision.refusal?.reason;
  const base = { accepted: false, subject, code, ...(cause === undefined ? {} : { cause }) };
  if (code === "completion_binding_consumed") return { ...base, prior_acceptance: true,
    known_effects: "original handoff unchanged; this request was not accepted",
    recovery: { actor: "coordinator", action: stopAccepted }, next_calls: [] };
  if (code === "completion_delivery_intent_exists") {
    if (release !== null) return { ...base, cause: "the failed delivery's completion release has not been established",
      known_effects: Object.fromEntries(["commit_object", "delivery_ref", "submitted_for_review", "checkout"]
        .map(field => [field, release.carrier.outcome.response[field]])),
      recovery: { actor: "worker", action: "After the reported release cause is corrected within existing authority, follow the returned reconciliation call. It performs no delivery or review submission. After successful reconciliation, preserve your authored request and choose it again if the assignment gap remains." },
      release_failure: projectFailureDiagnosis(release.carrier.outcome.response.completion_recovery),
      next_calls: [completionReconciliationCall(release.result)] };
    const response = pending?.carrier.outcome.response;
    const complete = response?.submitted_for_review === true && response.checkout === "complete";
    const superseded = response?.checkout === "superseded";
    const checkout = response?.transaction?.checkout;
    return { ...base, known_effects: response === undefined
      ? { submitted_for_review: null, checkout: "unknown" }
      : Object.fromEntries(["submitted_for_review", "checkout"]
        .map(field => [field, Object.hasOwn(response, field) ? response[field] : "unknown"])),
    ...(response !== undefined && response.checkout !== "complete" && checkout !== undefined
      ? { checkout_failure: Object.fromEntries(["code", "message"].filter(field => typeof checkout[field] === "string")
        .map(field => [field, checkout[field]])) } : {}),
    recovery: response === undefined
      ? { actor: "delivery transaction owner", missing_capability: "delivery_without_receipt_reconciliation",
        action: "Delivery already owns completion, but no recoverable receipt is available. No callable reconciliation exists; do not retry either completion." }
      : complete ? { actor: "worker", action: "Finish the existing delivery's required final report and terminate. No further delivery or assignment-change call is needed." }
      : superseded ? { actor: "delivery transaction owner", missing_capability: "superseded_delivery_checkout_reconciliation",
        action: "The submitted delivery stands, but its checkout was superseded. No same-delivery checkout retry can finish it; stop without another completion." }
      : { actor: "worker", action: "Recover only the existing delivery receipt and any pending checkout through the returned call; do not create another commit or assignment-change request." },
    next_calls: response === undefined || complete || superseded ? [] : [buildNextCall({ tool: "workspace_deliver_work", arguments: {} })] };
  }
  if (code === "completion_attempt_terminal") return { ...base,
    known_effects: "no new acceptance; terminal attempt unchanged",
    recovery: { actor: "coordinator", action: "The terminal attempt cannot accept a new request. Read the current bound unit and decide any revision or separately authorized continuation; this worker has no next action." },
    next_calls: [] };
  return { ...base, known_effects: retained ? "request retained but not accepted by this call" : "no new acceptance",
    recovery: { actor: "worker", action: "Observe the assigned attempt through the returned call before deciding recovery. Do not retry completion or resume implementation while its completion authority is unresolved." },
    next_calls: [observeAssigned()] };
}

const FAILURES = Object.freeze({
  authentication: {
    action: "No callable session repair exists here. An authenticated current worker assignment is required; request fields cannot supply it." },
  input_validation: {
    action: "No callable repair exists for the reported request-validation failure. Stop this request; no completion authority was established." },
  binding_resolution: {
    action: "No callable repair exists for the failed attempt binding or completion read. Stop this request; completion authority is not established." },
  frozen_assignment: {
    action: "No callable frozen-assignment repair exists here. Stop this request; do not substitute live assignment data or bypass access boundaries." },
  terminal_capability: {
    action: "No callable repair exists for this attempt's unavailable termination capability. Stop this request; no assignment revision or new access was granted." },
  original_retention: {
    action: "No callable repair exists for failed handoff retention. Stop this request; retained bytes alone cannot establish acceptance." },
  journal_acceptance: { actor: "worker",
    action: "Observe the exact assigned attempt through the returned call. Do not resume implementation, deliver or retry the request while acceptance is unresolved. If observation cannot establish acceptance, no callable acceptance reconciliation exists here." }
});

export function assignmentChangeOwnerFailure({ error, stage, subject = null, retained = false, prior = null }) {
  const acceptedBefore = prior?.alternative === "assignment_change_requested";
  const deliveryBefore = prior?.alternative === "delivery";
  const uncertain = stage === "journal_acceptance" && !acceptedBefore && !deliveryBefore;
  const code = error.code ?? `assignment_change_${stage}_failed`;
  const cause = projectFailureDiagnosis(error);
  if (cause.code === code) delete cause.code;
  if (cause.name === "Error") delete cause.name;

  if (stage === "original_retention" && error.envelope?.cause_diagnostic !== undefined) {
    cause.retention_cause = projectFailureDiagnosis(error.envelope.cause_diagnostic);
  }
  return { accepted: uncertain ? null : false, subject,
    code, cause,
    ...(acceptedBefore ? { prior_acceptance: true } : {}),
    known_effects: acceptedBefore ? "original handoff unchanged; prior acceptance remains binding"
      : deliveryBefore ? "delivery owns completion; delivery effects unresolved; no new assignment-change acceptance"
      : uncertain ? "request retained; acceptance unresolved"
      : retained ? "request retained; no new acceptance" : "no new acceptance; completion authority not established",
    recovery: acceptedBefore ? { actor: "coordinator", action: stopAccepted }
      : deliveryBefore && stage === "journal_acceptance" ? {
        action: "No callable reconciliation exists for the reported receipt-read failure. Do not retry delivery or assignment change; existing delivery effects may stand." }
      : FAILURES[stage],
    next_calls: uncertain && subject !== null ? [observeAssigned()] : [] };
}
