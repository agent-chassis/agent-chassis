

import { buildNextCall } from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";
import { prepareDeliveryOriginalResponse } from "./task-deliver-work-response.mjs";
import { prepareIntegrateWorkResponse } from "./task-integrate-work-result.mjs";
import { admitResultContinuations } from "./get-run-result-callability.mjs";
import { distillDispatchFailureDetail } from "./dispatch-tool-helpers.mjs";
import { currentDeliveryAccountForSession } from './task-deliver-work-result.mjs';

const deliveryDiagnostics = body => body.diagnostics
  .filter(item => !(item.stage === 'canonical_review' && item.state === 'review'))
  .filter(item => item.code != null || item.message != null || item.detail != null);

export async function deliveryReadOutcome({ workspace, sessionEnv, carrier, result, responseEnv, role, requestContracts }) {
  const { body } = prepareDeliveryOriginalResponse({ workspace, original: carrier, result, responseEnv });
  const answer = { subject: body.subject, outcome: body.outcome,
    ...(body.selected_delivery === null ? {} : { selected_delivery: body.selected_delivery }), next_calls: body.selected_delivery === null ? []
      : ['changes', ...(role === 'orchestrator' ? ['reviews'] : [])].map(member => buildNextCall({ tool: 'get_run_result',
        arguments: { result, detail: { member } } })) };
  const diagnostics = deliveryDiagnostics(body);
  if (diagnostics.length > 0) answer.diagnostics = diagnostics;
  let actionable = body, actionableResult = result;
  if (body.outcome !== "delivered") {
    answer.effects = Object.fromEntries(["commit_object", "delivery_ref", "submitted_for_review", "checkout"]
      .map(key => [key, body.effects[key]]));
    let current;
    try { current = currentDeliveryAccountForSession({ workspace, sessionEnv, responseEnv, carrier, result }); }
    catch (error) {
      answer.current_delivery = { state: 'unavailable', cause: { code: error.code, message: error.message },
        limitation: 'Historical effects stand. The current remainder is unestablished; do not replay delivery from this read.' };
      return admitResultContinuations(answer, requestContracts);
    }
    if (current.result.ref_id !== result.ref_id) {
      const latest = prepareDeliveryOriginalResponse({ workspace, original: current.carrier, result: current.result, responseEnv }).body;
      answer.historical = true;
      answer.current_delivery = { outcome: latest.outcome, checkout: latest.effects.checkout };
      actionable = latest;
      actionableResult = current.result;
      if (latest.outcome !== 'delivered') answer.current_delivery.diagnostics = deliveryDiagnostics(latest);
    }
  }
  if (actionable.outcome !== "delivered") {
    if (role === "worker") {
      answer.recovery = actionable.next_action;
      if (actionable.next_action.action === "finish_pending_checkout") answer.next_calls.push(buildNextCall({
        tool: "workspace_deliver_work", arguments: {} }));
    } else answer.remaining_effect = { actor: "worker", checkout: actionable.effects.checkout,
      limitation: "This result read cannot finish the producer's delivery or checkout recovery." };
  }
  if (role === "orchestrator" && actionable.selected_delivery !== null && actionable.effects.submitted_for_review === true &&
      ["advanced", "unchanged"].includes(actionable.effects.delivery_ref)) answer.next_calls.push(buildNextCall({
    tool: "integrate_work", arguments: { delivery: actionableResult } }));
  return admitResultContinuations(answer, requestContracts);
}

export async function integrationReadOutcome({ carrier, result, responseEnv, role, requestContracts, subject }) {

  const recorded = carrier.result != null;
  const effects = recorded ? carrier.result : carrier.completed_recovery_result != null
    ? { ...carrier.completed_recovery_result, recovery_failure: carrier.thrown }
    : { integration_effects_unconfirmed: true, recovery_failure: carrier.thrown,
      ...(carrier.thrown === undefined ? { reason: "No integration result was recorded." } : {}) };
  const { body } = await prepareIntegrateWorkResponse({ result: effects,
    original: { captured: true, retained: { subject, original: { available: true, locator: result } } },
    request: carrier.request, responseEnv, receivingRole: role, requestContracts });
  const answer = Object.fromEntries(["outcome", "effects", "effects_scope", "delivery", "cause", "remaining", "recovery",
    "correction", "selection", "candidate_version", "prior_integration", "candidate_preparation", "observed_facts", "continuation_limitations"].filter(key => Object.hasOwn(body, key))
    .map(key => [key, body[key]]));
  if (carrier.result?.blocker !== undefined) answer.blocker = distillDispatchFailureDetail(carrier.result.blocker,
    { nested: true }).detail;
  return admitResultContinuations({ ...answer, subject, ...(recorded ? {} : { result_recorded: false }),
    next_calls: body.next_calls.filter(call => call.tool !== "get_run_result" ||
      call.arguments.result?.ref_id !== result.ref_id) }, requestContracts);
}
