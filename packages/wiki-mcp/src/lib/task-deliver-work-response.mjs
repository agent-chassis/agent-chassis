

import { DELIVERY_ORIGINAL_PRODUCER } from "./task-deliver-work-result.mjs";
import { buildNextCall } from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";
import { measureMcpInlineResultBytes } from "./mcp-response.mjs";
import { distillDispatchFailureDetail } from "./dispatch-tool-helpers.mjs";
import { selectedResponseDeliveryBound, selectedResponseQueryInvalidError } from "./selected-response-snapshot.mjs";
import { renderTerminalStructuredRoleResultContract, TERMINAL_STRUCTURED_ROLE_RESULT_MODES } from
  "../../../agent-launch-core/src/lib/work-record-launch-prompt.mjs";

function classify(effects, selected) {
  if (effects.commit_object === null || effects.delivery_ref === null ||
      effects.commit_object === "unknown" || effects.delivery_ref === "unknown" ||
      effects.submitted_for_review === null) return "uncertain";

  if (selected !== null && effects.commit_object === "created" && effects.submitted_for_review === true &&
      ["advanced", "unchanged"].includes(effects.delivery_ref)) {
    return effects.checkout === "complete" ? "delivered" : "partial";
  }
  if (effects.delivery_ref === "restored" && effects.submitted_for_review === false) return "refused";
  if (selected !== null || effects.delivery_ref === "advanced" || effects.submitted_for_review === true) return "partial";
  return "refused";
}

function completion(subject) {
  const wording = renderTerminalStructuredRoleResultContract({ role: "worker", subject,
    mode: TERMINAL_STRUCTURED_ROLE_RESULT_MODES.SCHEMA_CONSTRAINED }).split("\n")
    .find(line => line.startsWith("Completion protocol, in this order:"));
  if (wording === undefined) throw new Error("worker completion protocol owner supplied no ordered instruction");
  return { actor: "worker", action: "emit_diagnostic_evidence_then_terminate", completed_step: 1,
    instruction: `Delivery step (1) is complete. Follow steps (2) and (3). ${wording}` };
}

function recovery({ stage, outcome, resource, inputInvalid, outputFailed, effects, publicDelivery }) {

  if (!inputInvalid && !outputFailed && effects.submitted_for_review === true &&
      ["pending", "superseded"].includes(effects.checkout)) {
    return effects.checkout === "superseded"
      ? { actor: "worker", action: "inspect_newer_delivery", resource, availability: "no_callable_repair", instruction:
          "The commit and review submission stand. The slice branch already left this delivery, so its checkout is not finalized for it and no retry of this delivery can finish it." }
      : { actor: "worker", action: "finish_pending_checkout", resource,
        availability: publicDelivery ? "callable" : "no_callable_repair", instruction:
          "The commit and review submission stand; only the worker checkout's index is not aligned with the delivery. Correct the reported checkout cause without discarding work, then invoke workspace_deliver_work({}) to finish only the pending checkout. No commit, ref movement or review transition is repeated." };
  }
  if (inputInvalid) return { actor: "worker", action: "correct_arguments", availability: "pending_activation",
    instruction: "Prepare the normalized {} request for the delivery composition." };
  if (outputFailed) return { actor: "wiki-mcp response-state owner", action: "repair_response_state",
    resource, availability: "no_callable_repair", instruction:
      "Repair original serialization or response-state persistence. The original was not retained; settled transaction effects stand. Do not retry delivery blindly." };
  if (["authentication", "binding_resolution"].includes(stage) || outcome.transaction === undefined) {
    return { actor: "launcher provisioning / identity-store owner", action: "reconcile_launcher_binding", resource,
      availability: "no_callable_repair", instruction:
        "Reconcile the authenticated session and exact unit/run/retry identity-store binding; provision a valid worker session. Do not supply credentials as request arguments." };
  }
  if (outcome.scope?.contained === false) return { actor: "worker / scope containment owner",
    action: "repair_containment", resource, availability: "no_callable_repair", instruction:
      "The measured delta is not contained in the assigned write_scope or expected envelope. Repair that relation through its owner; this refusal grants no widening or discard authority." };
  return { actor: "delivery-ref / canonical unit-status owner", action: "reconcile_exact_transaction", resource,
    availability: "no_callable_repair", instruction:
      "Reconcile the exact delivery ref and assigned unit's canonical review status, including the reported compensation. No safe callable reconciliation is available here; do not retry delivery blindly." };
}

export function prepareDeliverWorkResponse({ workspace, outcome = {}, observation = null,
  authenticatedSubject = null, error = null, isError = false, stage = null, inputInvalid = false,
  responseEnv = process.env, historicalObservation = false, originalCalls = [], publicDelivery = false,
  receiptPublication = null, receiptRecovery = false, checkoutRecovery = false }) {

  const settled = observation?.transactionOutcome ?? outcome;
  const admitted = observation?.identity !== null && observation?.identity !== undefined;
  const effects = {
    commit_object: Object.hasOwn(settled, "commit_object") ? settled.commit_object : (admitted ? "unknown" : "not_created"),
    delivery_ref: Object.hasOwn(settled, "delivery_ref") ? settled.delivery_ref : (admitted ? "unknown" : "unchanged"),
    submitted_for_review: Object.hasOwn(settled, "submitted_for_review")
      ? settled.submitted_for_review : (admitted ? null : false),

    checkout: Object.hasOwn(settled, "checkout") ? settled.checkout : "not_attempted",
    tests_executed: false, proofs_executed: false, integrated: false,
    forge_published: false, parent_completed: false
  };
  const transaction = settled.transaction ?? {};

  const selected = admitted && typeof transaction.delivery_commit === "string" &&
    typeof transaction.base_sha === "string"
    ? { commit: transaction.delivery_commit, base: transaction.base_sha } : null;
  const paths = observation?.phases?.scope_verification?.state === "returned"
    ? observation.phases.scope_verification.result?.changed_paths : settled.changed_paths ?? settled.scope?.changed_paths;
  const subject = observation?.identity?.unit ?? authenticatedSubject;
  const receiptFailed = receiptPublication?.state === "failed";
  const outputFailed = outcome.output?.state === "failed" || receiptFailed;
  const decidingStage = outcome.output?.stage ?? settled.stage ?? stage ??
    (settled.scope?.contained === false ? "scope_verification" :
      transaction.compensation?.state === "failed" ? "compensation" :
      ["threw", "refused"].includes(transaction.canonical_review?.state) ? "canonical_review" :
      ["pending", "superseded"].includes(effects.checkout) ? "checkout" :
      settled.transaction ? "settlement" : "binding_resolution");
  const resource = { subject, ref: transaction.ref ?? observation?.ref ?? null };
  const state = classify(effects, selected);
  const original = { availability: outcome.original?.available === true ? "retained" : admitted ? "unavailable" : "not_captured",
    locator: outcome.original?.available === true ? outcome.original.locator : null, operator_only: true,
    reader_scope: "operator_only applies to generic retained-evidence access. When worker_read_available is true, the worker may follow the returned get_run_result call for the delivery original.",
    worker_read_available: publicDelivery && outcome.original?.available === true };
  const continuations = {};
  if (original.locator !== null) continuations.original = { availability: "pending_delivery_reader",
    request: { result: original.locator }, owner: "shared authenticated result reader" };
  if (inputInvalid) continuations.correction = { availability: "pending_activation", request: {} };

  const checkoutOutstanding = ["pending", "superseded"].includes(effects.checkout);
  const decidingSource = error?.envelope?.diagnostic ?? error?.envelope ?? error ??
    (decidingStage === "checkout" ? transaction.checkout : settled);
  const diagnosticSources = [
    [decidingStage, decidingSource],
    [`${decidingStage}.cause`, decidingSource.cause],
    ["scope_verification", settled.scope?.refusal],
    ["canonical_review", transaction.canonical_review],
    ["compensation", transaction.compensation],
    ["checkout", checkoutOutstanding && decidingStage !== "checkout" ? transaction.checkout : null],
    ["original_retention", outcome.original?.retention_failure],
    ["delivery_receipt_publication", receiptFailed ? receiptPublication : null]
  ].filter(([, source]) => source !== null && source !== undefined);
  const omitted = new Set();
  if (observation?.phases) omitted.add("complete_phase_observations");
  if (Array.isArray(paths)) omitted.add("changed_paths");
  if (settled.scope || observation?.phases?.scope_verification?.result) omitted.add("scope_detail");
  if (settled.receipts !== undefined) omitted.add("receipts");
  function scalar(value) {
    if (typeof value !== "string") return null;
    return value;
  }
  const diagnostics = diagnosticSources.map(([at, source]) => ({ stage: at,
    code: scalar(source.code ?? source.decision_code ?? source.refusal_code ?? source.cause_code ?? source.cause?.code),
    authority_limb: scalar(source.authority_limb ?? source.envelope?.authority_limb),
    state: scalar(source.state),
    message: scalar(source.message ?? source.cause?.message ?? source.reason ??
      (Array.isArray(source.reasons) ? source.reasons.join("; ") : null)),
    ...(source.cause === undefined && source.detail === undefined ? {} : { detail:
      distillDispatchFailureDetail({ cause: source.cause, detail: source.detail }, { nested: true }).detail })
  }));

  const phaseFacts = (source, members) => Object.fromEntries(members.map(member =>
    [member, scalar(source?.[member]) ??
      (typeof source?.[member] === "boolean" ? source[member] : null)]));
  const reconciliation = {
    candidate_commit: transaction.candidate_commit ?? null,
    prior_tip: transaction.prior_tip ?? null, observed_tip: transaction.observed_tip ?? null,
    canonical_review: phaseFacts(transaction.canonical_review, ["state", "written", "no_op", "status", "reason"]),
    compensation: phaseFacts(transaction.compensation, ["state", "published_commit", "observed_tip", "restored_tip"]),
    checkout: phaseFacts(transaction.checkout, ["state", "code"])
  };
  const body = { producer: DELIVERY_ORIGINAL_PRODUCER, repository: workspace.repo, subject,
    outcome: state, selected_delivery: selected,
    tree: transaction.delivered_tree ?? observation?.phases?.materialization?.result?.tree ?? settled.tree ?? null,
    changed_path_count: Array.isArray(paths) ? paths.length : null,
    changed_paths_measurement: Array.isArray(paths) ? "measured" : "unmeasured",
    effects, diagnostics, stage: decidingStage, resource, reconciliation, original,
    output: { state: outputFailed ? "failed" : "prepared", stage: receiptFailed ? "delivery_receipt_publication" : outcome.output?.stage ?? null },
    next_action: state === "delivered" && !isError && !outputFailed ? completion(subject)
      : recovery({ stage: decidingStage, outcome: settled, resource, inputInvalid, outputFailed, effects,
        publicDelivery }),
    omitted_detail: [...omitted] };
  if (publicDelivery) {
    body.next_calls = original.locator === null ? [] : [buildNextCall({ tool: "get_run_result",
      arguments: { result: original.locator } })];
    if (inputInvalid || body.next_action.action === "finish_pending_checkout") {
      body.next_calls.push(buildNextCall({ tool: "workspace_deliver_work", arguments: {} }));
    }
    if (inputInvalid) body.next_action = { actor: "worker", action: "correct_arguments",
      instruction: "Invoke the returned empty delivery request." };
  }
  if (historicalObservation) {
    body.effects_scope = "historical_transaction";
    body.observation = { kind: "retained_original", effects: {
      executed: false, delivered: false, integrated: false, retained: false
    } };
    body.next_calls = originalCalls;
  }
  if (receiptPublication !== null) {
    body.delivery_receipt = { state: receiptPublication.state, recovered: receiptRecovery,
      appended: receiptPublication.appended ?? false };
    body.invocation_effects = { commit_transaction_executed: !receiptRecovery,
      checkout_finalization_attempted: !receiptRecovery || checkoutRecovery,
      receipt_published: receiptPublication.state === "published" };
    if (receiptFailed) {
      body.next_action = { actor: "worker", action: "publish_retained_delivery_receipt",
        instruction: "The commit and review submission stand; the original is retained. After the reported attempt-journal condition clears, invoke workspace_deliver_work({}) to publish only its receipt. Recovery bypasses the commit transaction." };
      body.next_calls = [buildNextCall({ tool: "workspace_deliver_work", arguments: {} })];
    } else if (receiptRecovery) {

      if (state === "delivered") body.next_action = completion(subject);
      body.next_calls = [buildNextCall({ tool: "get_run_result", arguments: { result: original.locator } }),
        ...(body.next_action.action === "finish_pending_checkout"
          ? [buildNextCall({ tool: "workspace_deliver_work", arguments: {} })] : [])];
    }
  }
  const bound = selectedResponseDeliveryBound(responseEnv);
  const frame = { registered: false, body, isError, continuations,
    delivery: { delivered: false, measured_bytes: 0, bound_bytes: bound, fits: true,
      complete_transport_required: false } };

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const bytes = measureMcpInlineResultBytes(frame, { isError });
    const fits = bytes <= bound;
    if (frame.delivery.fits !== fits || frame.delivery.complete_transport_required !== !fits) {
      frame.delivery.fits = fits;
      frame.delivery.complete_transport_required = !fits;
      frame.delivery.measured_bytes = 0;
      continue;
    }
    if (bytes === frame.delivery.measured_bytes) {
      return frame;
    }
    frame.delivery.measured_bytes = bytes;
  }
  throw new Error("delivery response byte measurement did not stabilize");
}

export function prepareDeliveryOriginalResponse({ workspace, original, result, responseEnv = process.env,
  originalCalls = [] }) {
  const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const invalid = (field, expected) => { throw selectedResponseQueryInvalidError(
    DELIVERY_ORIGINAL_PRODUCER, "delivery_original_outcome_invalid", { field, expected }); };
  if (!record(original?.outcome)) invalid("outcome", "producer outcome object");
  const { response, is_error: isError } = original.outcome;
  if (typeof isError !== "boolean") invalid("outcome.is_error", "boolean");
  if (!record(response)) invalid("outcome.response", "producer response object");
  for (const [field, values] of [
    ["commit_object", ["created", "not_created", "unknown", null]],
    ["delivery_ref", ["advanced", "unchanged", "restored", "unknown", null]],
    ["submitted_for_review", [true, false, null]],
    ["checkout", ["complete", "pending", "superseded", "not_attempted"]]
  ]) if (!Object.hasOwn(response, field) || !values.includes(response[field])) {
    invalid(`outcome.response.${field}`, "explicit producer transaction effect");
  }
  if (!record(response.transaction)) invalid("outcome.response.transaction", "producer transaction object");
  if (!record(original.identity) || typeof original.identity.unit !== "string") {
    invalid("identity.unit", "retained producer subject");
  }
  return prepareDeliverWorkResponse({ workspace,
    outcome: { ...response, original: { available: true, operator_only: true, locator: result } },
    observation: { identity: original.identity, phases: original, transactionOutcome: response },
    error: isError ? { envelope: response } : null, isError, responseEnv, historicalObservation: true,
    originalCalls, publicDelivery: true });
}
