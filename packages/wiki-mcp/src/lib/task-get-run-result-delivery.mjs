

import { z } from "zod";
import { isDeepStrictEqual } from 'node:util';
import { buildNextCall } from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";
import { selectedResponseDetailSchema, selectedResponseDeliveryBound,
  selectedResponseRequestSchema } from "./selected-response-snapshot.mjs";
import { readDeliveryOriginalForSession, DELIVERY_ORIGINAL_PRODUCER } from "./task-deliver-work-result.mjs";
import { ASSIGNMENT_CHANGE_TOOL, assignmentChangeAssignmentMeaning } from "./task-request-assignment-change-result.mjs";
import { INTEGRATION_ORIGINAL_PRODUCER } from "./task-integrate-work-result.mjs";
import { deliveryReadOutcome, integrationReadOutcome } from "./get-run-result-outcome-projection.mjs";
import { retainSelectedResponseEvidence, readSelectedResponseSource, selectedResponseLocator,
  selectedResponseQueryInvalidError, selectedResponseCorrectableError } from "./selected-response-snapshot.mjs";
import { resolveLauncherRunState } from "./launcher-run-credential.mjs";
import { managedTestAuthorityIdentity, managedTestAuthorityAuthenticated } from "./managed-test-source-context.mjs";
import { projectPublicFinalResult } from "./dispatch-final-result-projection.mjs";
import { distillDispatchFailureDetail } from "./dispatch-tool-helpers.mjs";
import { measureMcpInlineResultBytes, selectedFullContent } from "./mcp-response.mjs";
import { RUN_WAIT_TIMEOUT_MS_BOUNDS } from "./dispatch-monitor-call-deadline.mjs";
import { managedObservationFailureFacts } from "../../../agent-launch-core/src/lib/managed-run-observation.mjs";
import { publicFinalResult, runResultMeaning } from './get-run-result-final-result.mjs';
import { readDeliveryChanges, readDeliveryReviews } from './get-run-result-delivery-inspection.mjs';

export const OBSERVATION_ORIGINAL_PRODUCER = "workspace_agent_run_status";

const route = "get_run_result";

export const GET_RUN_RESULT_DETAIL_INPUT_SCHEMA = z.object({ member: z.string().min(1).max(128) }).strict();
const request = z.object({ result: selectedResponseDetailSchema(z).shape.source,
  detail: GET_RUN_RESULT_DETAIL_INPUT_SCHEMA.optional() }).strict();

export function createDeliveryResultPresentation({ workspace, sessionEnv, responseEnv, requestContracts }) {
  const call = (source, member) => buildNextCall({ tool: route, arguments: { result: source, detail: { member } } });

  const members = (carrier, producer) => {
    const transaction = carrier.outcome?.response?.transaction;
    const hasDelivery = typeof transaction?.delivery_commit === 'string' && typeof transaction?.base_sha === 'string';
    const names = producer === OBSERVATION_ORIGINAL_PRODUCER ? ["final_result", "completion_failure",
      "completion_settlement_failure", "final_result_publication_failure"]
      : producer === ASSIGNMENT_CHANGE_TOOL ? ["request", "assignment"]
        : producer === DELIVERY_ORIGINAL_PRODUCER ? ["outcome", ...(hasDelivery ? ['changes',
          ...(resolveLauncherRunState(sessionEnv).role === 'orchestrator' ? ['reviews'] : [])] : [])]
          : producer === INTEGRATION_ORIGINAL_PRODUCER ? ["result"] : [];
    return producer === DELIVERY_ORIGINAL_PRODUCER ? names : names.filter(member => Object.hasOwn(carrier, member));
  };
  const memberCalls = (source, carrier, producer) => members(carrier, producer).map(member => call(source, member));
  async function detail(binding, input, sourceEnv = responseEnv) {
    const retained = readSelectedResponseSource(input.result, { env: sourceEnv, expected: binding, route });
    const member = GET_RUN_RESULT_DETAIL_INPUT_SCHEMA.parse(input.detail).member;
    if (!members(retained.carrier, binding.route).includes(member)) {
      const available = members(retained.carrier, binding.route);
      const facts = { member, available_members: available };
      if (available.length === 1) throw selectedResponseCorrectableError(route, "original_member_unavailable", facts, {
        arguments: call(input.result, available[0]).arguments, requestSchema: selectedResponseRequestSchema(request),
        prerequisite: "select the public semantic member of this same original",
        successCondition: "the selected original's public result is delivered without execution" });
      throw selectedResponseQueryInvalidError(route, "original_member_unavailable", { ...facts,
        choices: available.map(name => call(input.result, name)) });
    }

    const context = { workspace, sessionEnv, carrier: retained.carrier, result: input.result, responseEnv,
      role: resolveLauncherRunState(sessionEnv).role, requestContracts, subject: binding.unit };
    const outcome = binding.route === DELIVERY_ORIGINAL_PRODUCER ? await deliveryReadOutcome(context) : null;
    const inspection = binding.route === DELIVERY_ORIGINAL_PRODUCER && member !== 'outcome';
    const value = inspection ? member === 'changes' ? await readDeliveryChanges(context)
      : await readDeliveryReviews({ ...context, readOriginal: createObservationOriginals(context).read,
        taskChoice: attemptTaskChoice, detailCall: source => call(source, 'final_result') })
      : binding.route === DELIVERY_ORIGINAL_PRODUCER ? outcome
      : binding.route === INTEGRATION_ORIGINAL_PRODUCER ? await integrationReadOutcome(context)
        : binding.route === ASSIGNMENT_CHANGE_TOOL && member === 'assignment'
          ? assignmentChangeAssignmentMeaning(retained.carrier.assignment)
        : distillDispatchFailureDetail(binding.route === OBSERVATION_ORIGINAL_PRODUCER && member === "final_result"
          ? publicFinalResult(retained.carrier[member]) : retained.carrier[member], { nested: true }).detail;
    return selectedFullContent({ source: input.result, retained, projection: {
      result: input.result, member, value,
      selections: members(retained.carrier, binding.route).filter(other => other !== member).map(other => ({ member: other })),
      ...(inspection && outcome.current_delivery?.state === 'unavailable' ? { current_delivery: outcome.current_delivery } : {}),
      next_calls: inspection ? outcome.next_calls.filter(next => next.arguments.detail === undefined) : [] } });
  }
  async function read(input) {
    return readDeliveryOriginalForSession({ workspace, sessionEnv, responseEnv, request: { result: input.result },
      project: async ({ carrier, binding, result, responseEnv: sourceEnv }) => {
        if (input.detail !== undefined) return detail(binding, input, sourceEnv);
        return deliveryReadOutcome({ workspace, sessionEnv, carrier, result, responseEnv,
          role: resolveLauncherRunState(sessionEnv).role, requestContracts });
      } });
  }
  return Object.freeze({ read, detail, memberCalls,
    detailCall: (result, member = "final_result") => call(result, member) });
}

export function createObservationOriginals({ workspace, sessionEnv, responseEnv }) {
  function expected() {
    const state = resolveLauncherRunState(sessionEnv);
    const identity = managedTestAuthorityIdentity(state);
    if (state.role !== "orchestrator" || !managedTestAuthorityAuthenticated(identity)) {
      throw new TypeError("observation originals require the authenticated orchestrator session");
    }
    return { route: OBSERVATION_ORIGINAL_PRODUCER, repository: workspace.repo,
      authority_identity: identity };
  }
  return {
    capture(observation) {
      return retainSelectedResponseEvidence({ binding: { ...expected(), unit: observation.subject },
        carrier: { subject: observation.subject, run_id: observation.run_id, role: observation.role,
          status: observation.status, terminal: observation.terminal, exit: observation.exit,
          final_result: projectPublicFinalResult(observation.final_result),
          ...(observation.review_task === undefined ? {} : { review_task: observation.review_task }),
          ...(observation.worker_task === undefined ? {} : { worker_task: observation.worker_task }),
          ...Object.fromEntries(["completion_failure", "completion_settlement_failure", "result_publication",
            "final_result_publication_failure"].filter(field => observation[field] !== undefined)
            .map(field => [field, observation[field]])) },
        ownerCall: source => ({ tool: route, arguments: { result: source } }),
        ownerRequestSchema: selectedResponseRequestSchema(request) }, { env: responseEnv });
    },
    read(result, unit) { return readSelectedResponseSource(result, { env: responseEnv,
      expected: { ...expected(), ...(unit === undefined ? {} : { unit }) }, route }); }
  };
}

function attemptTaskChoice(item, attempts) {
  if (item.result_unavailable !== undefined) return { selection_limitation: { code: item.role === 'worker'
      ? 'worker_result_unavailable' : "review_result_unavailable",
    cause: item.result_unavailable,
    message: "This attempt's retained original cannot be read. There is no supported recovery for this result." } };
  if (item.role === 'worker') {
    const source = item.worker_task;
    if (source == null) return { selection_limitation: { code: 'worker_task_unavailable',
      message: 'This attempt has no readable original assignment meaning. Its task cannot be identified from current instructions.' } };
    const peers = attempts.filter(other => other !== item && other.role === 'worker');
    const task = typeof source.title === 'string' && source.title.trim() !== '' ? { title: source.title } : {};
    let same = peers.filter(other => other.worker_task?.title === source.title);
    for (const field of ['summary', 'instructions', 'notes', 'criteria']) {
      if (same.length === 0) break;
      if (same.some(other => !isDeepStrictEqual(other.worker_task?.[field], source[field]))) {
        task[field] = source[field];
        same = same.filter(other => isDeepStrictEqual(other.worker_task?.[field], source[field]));
      }
    }
    return { task, ...(same.length > 0 || Object.keys(task).length === 0 ? {
      selection_limitation: { code: 'worker_attempts_indistinguishable',
        message: 'These original task facts do not distinguish the attempts. Select only with an already-issued exact attempt tied to the intended task.' } } : {}) };
  }
  if (!["reviewer", "redteam"].includes(item.role)) return {};
  const peers = attempts.filter(other => other.role === item.role);
  if (peers.length < 2) return {};
  const title = value => value.review_task?.brief?.material?.selected?.title;
  const text = value => typeof value === "string" && value.trim().length > 0;
  const kind = candidate => candidate.review_task?.material_kind === 'canonical_design' ? 'canonical_design'
    : ['explicit_sha_range', 'canonical_implementation_slice', 'launcher_terminal_candidate']
      .includes(candidate.review_task?.material_kind) ? 'code' : 'unknown';
  const target = candidate => {
    const source = candidate.review_task;
    if (kind(candidate) === 'canonical_design') return text(source.reviewed_sha)
      ? { supporting_sha: source.reviewed_sha } : undefined;
    return kind(candidate) === 'code' && text(source?.base_sha) && text(source?.reviewed_sha)
      ? { base_sha: source.base_sha, reviewed_sha: source.reviewed_sha } : undefined;
  };
  const criteria = candidate => (candidate.review_task?.brief?.material?.selected?.acceptance?.criteria ?? [])
    .filter(value => text(value));
  const meaning = candidate => {
    const name = title(candidate);
    const task = text(name) ? { title: name } : {};
    if (kind(candidate) !== 'code') task.material = { kind: kind(candidate) };
    const sameTitle = peers.filter(other => title(other) === name);
    if (!text(name) || new Set(sameTitle.map(other => JSON.stringify(target(other)))).size > 1) {
      if (target(candidate) !== undefined) {
        if (kind(candidate) === 'canonical_design') Object.assign(task.material, target(candidate));
        else task.reviewed_range = target(candidate);
      }
    }
    const sameTarget = sameTitle.filter(other => kind(other) === kind(candidate) &&
      JSON.stringify(target(other)) === JSON.stringify(target(candidate)));
    if (sameTarget.length > 1) {
      const distinct = criteria(candidate).filter(criterion => sameTarget.every(other => other === candidate ||
        !criteria(other).includes(criterion))).sort((a, b) => a.length - b.length || a.localeCompare(b));
      if (distinct.length > 0) task.criterion = distinct[0];
    }
    return task;
  };
  const task = meaning(item);
  if (!text(task.title) && task.reviewed_range === undefined && task.material?.supporting_sha === undefined &&
      task.criterion === undefined) return { selection_limitation: { code: "review_task_unavailable",
    message: "This review has no recorded task title or known material target. Its purpose cannot be identified from this menu." } };
  const indistinguishable = peers.some(other => other !== item &&
    JSON.stringify(meaning(other)) === JSON.stringify(task));
  return { task, ...(indistinguishable ? { selection_limitation: { code: "review_attempts_indistinguishable",
    message: "The available task facts do not distinguish these reviews. Select only with an already-issued attempt ID tied to the intended review." } } : {}) };
}

export function presentRunObservation(observation, detailCall, responseEnv, subject, request = {}) {
  const selected = observation.selected;
  const attemptId = observation.run_id ?? selected?.dispatch_tuple?.run_id ?? request.attempt_id;
  const result = observation.original_result == null ? undefined : selectedResponseLocator(observation.original_result);
  const final = observation.final_result ?? selected?.result;
  const meaning = runResultMeaning(final);
  const change = observation.assignment_change ?? selected?.assignment_change;
  const publication = observation.original_publication;
  const worker = observation.role === "worker" || selected?.dispatch_tuple != null;
  const terminal = observation.terminal ?? (change != null ? selected?.result != null : undefined);
  const selectionRefused = ["attempt_selection_ambiguous", "attempt_selector_mismatch"]
    .includes(observation.code ?? observation.refusal?.reason);
  const summary = { subject: observation.subject ?? subject,
    ...(attemptId === undefined ? {} : { attempt_id: attemptId }),
    ...(observation.role === undefined ? {} : { role: observation.role }),
    ...(observation.status === undefined ? {} : { status: observation.status }),
    ...(terminal === undefined ? {} : { terminal }),
    ...(observation.producer_pending === true ? { producer_pending: true } : {}),
    ...(observation.timed_out === undefined ? {} : { timed_out: observation.timed_out }),
    next_calls: [] };
  const failure = value => distillDispatchFailureDetail(value, { nested: true }).detail;
  if (observation.accepted === false || observation.ok === false) summary.accepted = false;
  if (observation.code !== undefined && observation.observation_failure === undefined) summary.code = observation.code;
  if (observation.refusal !== undefined && observation.observation_failure === undefined) {

    const { attempts: _attempts, ...detail } = observation.refusal.detail ?? {};
    summary.refusal = { ...observation.refusal,
      ...(observation.refusal.detail == null ? {} : { detail }) };
  }
  if (observation.exit != null && (observation.status !== "succeeded" || observation.exit.code > 0 || observation.exit.signal != null)) {
    summary.exit = failure(observation.exit);
  }
  if (change == null) Object.assign(summary, meaning.facts);
  if (result === undefined && final != null && change == null && !meaning.unavailable) summary.final_result = meaning.value;
  for (const key of ["observation_failure", "completion_failure", "completion_settlement_failure", "final_result_publication_failure"]) {
    if (observation[key] !== undefined) summary[key] = failure(observation[key]);
  }
  if (publication?.state === "failed") summary.original_publication = { state: publication.state, stage: publication.stage };
  const resultPublication = observation.result_publication;
  if (resultPublication?.state === "unavailable" && resultPublication.correction?.ok === false) {
    const correction = resultPublication.correction;
    const observed = managedObservationFailureFacts(correction[correction.stage]);
    const appendEffects = [resultPublication.initial?.appended, correction.appended];
    summary.result_publication = { state: "unavailable", stage: correction.stage,
      appended: appendEffects.includes(true) ? true : appendEffects.every(value => value === false) ? false : null,
      ...(correction.cause == null ? {} : { cause: correction.cause }),
      ...(correction.evidence == null ? {} : { failure: failure(correction.evidence) }),
      ...(observed == null ? {} : { diagnostic: failure(observed) }) };
  }

  if (change == null && result !== undefined && !meaning.unavailable) {
    summary.original = { available: true, result };
    summary.next_calls.push(detailCall(result));
  } else if (change == null && !selectionRefused && !meaning.unavailable && observation.observation_failure === undefined) {
    summary.original = { available: false, reason: observation.producer_pending === true ? "producer_original_pending"
      : publication?.state === "failed" ? publication.stage === "original_capture"
        ? "producer_original_capture_failed" : "producer_completion_failed"
      : publication?.state === "not_configured" ? "producer_original_not_configured"
      : selected?.result != null ? "durable_result_has_no_retained_original"
      : terminal === true ? "producer_original_unavailable"
      : observation.accepted === false || observation.ok === false ? "observation_unavailable"
      : selected !== undefined && observation.accepted !== true ? "durable_result_unavailable" : "producer_not_terminal" };
  }
  if (change == null && observation.observation_failure === undefined && !meaning.unavailable && result === undefined && publication?.state !== "failed" &&
      observation.final_result_publication_failure?.repair_required?.retryable !== false &&
      observation.timed_out !== true && observation.accepted === true &&
      (terminal === false || observation.producer_pending === true)) {
    summary.next_calls.push(buildNextCall({ tool: route, arguments: request.assigned === true ? { assigned: true }
      : { subject: summary.subject, attempt_id: attemptId, timeout_ms: RUN_WAIT_TIMEOUT_MS_BOUNDS.max } }));
  }
  const attempts = observation.candidates ?? observation.attempts ?? observation.refusal?.detail?.attempts;
  if (selectionRefused && Array.isArray(attempts)) {
    summary.attempt_choices = attempts.map(item => {
      const id = item.attempt_id ?? item.run_id ?? item.dispatch_tuple?.run_id;
      if (typeof id !== "string" || id.length === 0) return { selection_limitation: {
        code: "attempt_identity_unavailable", message: "This candidate has no published attempt ID; no exact read is available." } };
      const call = buildNextCall({ tool: route, arguments: { subject: summary.subject, attempt_id: id } });
      return { attempt_id: id,
        ...(item.role === undefined && item.dispatch_tuple == null ? {} : { role: item.role ?? "worker" }),
        ...(item.status === undefined ? {} : { status: item.status }),
        ...(item.terminal === undefined ? {} : { terminal: item.terminal }),
        ...(Object.hasOwn(item, "result") ? { result_available: item.result != null } : {}),
        ...(item.result_available === undefined ? {} : { result_available: item.result_available }),
        ...attemptTaskChoice(item, attempts),
        ...(item.result_meaning ?? {}),
        ...(item.result_unavailable === undefined && item.result_meaning?.result_outcome !== 'unavailable' ? { call } : {}) };
    });
  }
  const proofs = observation.proof_verification;
  if (proofs?.state === "unavailable") summary.proof_verification = { state: proofs.state,
    code: proofs.code, diagnostic: proofs.diagnostic };
  else if (proofs?.recorded_count > 0) summary.proof_verification = {
    state: "recorded", recorded_count: proofs.recorded_count, detail_call: proofs.detail_call };
  if (change != null) {
    if (request.assigned === true) {
      summary.assignment_change = { accepted: true, pending_termination: terminal !== true,
        action: 'Stop this worker; the coordinator owns any assignment correction and separately authorized continuation.' };
      delete summary.proof_verification;
      summary.next_calls = [];
      return summary;
    }
    summary.assignment_change = { accepted: true, pending_termination: terminal !== true,
      result: { ref_id: change.original.ref_id } };
    summary.next_calls.push(buildNextCall({ tool: route, arguments: { result: summary.assignment_change.result } }));
  }
  if (observation.delivery !== undefined && change == null) {
    summary.delivery = observation.delivery.state === 'unavailable' || observation.delivery.cause === undefined ? observation.delivery
      : { available: false, references: [], cause: observation.delivery.cause };
    if (summary.delivery.choices === undefined) for (const reference of summary.delivery.references ?? []) {
      summary.next_calls.push(buildNextCall({ tool: route, arguments: { result: reference } }));
    }
    const references = observation.delivery.references ?? [];
    if (request.assigned !== true && references.length === 1 && observation.delivery.cause === undefined) {
      summary.next_calls.push(buildNextCall({ tool: "integrate_work", arguments: { delivery: references[0] } }));
    }
  }
  if (worker && terminal === true && change == null && final?.outcome !== "assignment_change_requested" && observation.delivery?.state === "absent") {
    summary.limitation = "The worker ended without an authenticated delivery; nothing is available to integrate.";
    if (request.assigned !== true && observation.producer_pending !== true) summary.next_calls.push(buildNextCall({
      tool: "start_agent", arguments: { subject: summary.subject, preview: true } }));
  }
  const verification = observation.candidate_verification;
  if (verification?.state === "offered" && change == null) summary.next_calls.push(verification.call);
  else if (verification?.state === "unavailable" && change == null) summary.candidate_verification = { state: "unavailable", cause: verification.cause };
  const bound = selectedResponseDeliveryBound(responseEnv);
  if (Object.hasOwn(summary, "final_result") && observation.verified_source === undefined &&
      measureMcpInlineResultBytes(summary) > bound) {

    delete summary.final_result;
    summary.result_limitation = { code: "unretained_result_exceeds_delivery_bound",
      message: "The response exceeds this route's inline bound and has no discoverable retained result reader. " +
        "Stop this result read; observation cannot recreate its missing original binding." };
  }
  return summary;
}
