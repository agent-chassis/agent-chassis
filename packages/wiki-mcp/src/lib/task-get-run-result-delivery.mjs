

import { z } from "zod";
import { buildNextCall } from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";
import { selectedResponseDetailSchema, selectedResponseDeliveryBound,
  selectedResponseRequestSchema } from "./selected-response-snapshot.mjs";
import { readDeliveryOriginalForSession } from "./task-deliver-work-result.mjs";
import { prepareDeliveryOriginalResponse } from "./task-deliver-work-response.mjs";
import { retainSelectedResponseEvidence, readSelectedResponseSource, selectedResponseLocator,
  selectedResponseQueryInvalidError } from "./selected-response-snapshot.mjs";
import { resolveLauncherRunState } from "./launcher-run-credential.mjs";
import { managedTestAuthorityIdentity, managedTestAuthorityAuthenticated } from "./managed-test-source-context.mjs";
import { projectPublicFinalResult } from "./dispatch-final-result-projection.mjs";
import { projectRecordedFailureDetail, DISPATCH_FAILURE_ORIGINALS } from "./dispatch-tool-helpers.mjs";
import { measureMcpInlineResultBytes, selectedFullContent } from "./mcp-response.mjs";

export const OBSERVATION_ORIGINAL_PRODUCER = "workspace_agent_run_status";

const route = "get_run_result";

export const GET_RUN_RESULT_DETAIL_INPUT_SCHEMA = z.object({ member: z.string().min(1).max(128) }).strict();
const request = z.object({ result: selectedResponseDetailSchema(z).shape.source,
  detail: GET_RUN_RESULT_DETAIL_INPUT_SCHEMA.optional() }).strict();

export function createDeliveryResultPresentation({ workspace, sessionEnv, responseEnv }) {
  const call = (source, member) => buildNextCall({ tool: route, arguments: { result: source, detail: { member } } });
  const memberCalls = (source, carrier) => Object.keys(carrier).map(member => call(source, member));
  async function detail(binding, input, sourceEnv = responseEnv) {
    const retained = readSelectedResponseSource(input.result, { env: sourceEnv, expected: binding, route });
    const member = GET_RUN_RESULT_DETAIL_INPUT_SCHEMA.parse(input.detail).member;
    if (!Object.hasOwn(retained.carrier, member)) throw selectedResponseQueryInvalidError(route,
      "original_member_unavailable", { member, available_members: Object.keys(retained.carrier) });

    return selectedFullContent({ source: input.result, retained, projection: {
      observation: { kind: "retained_original", executed: false, retained: false, integrated: false },
      result: input.result, member, value: retained.carrier[member],
      selections: Object.keys(retained.carrier).filter(other => other !== member).map(other => ({ member: other })),
      next_calls: [] } });
  }
  async function read(input) {
    return readDeliveryOriginalForSession({ workspace, sessionEnv, responseEnv, request: { result: input.result },
      project: async ({ carrier, binding, result, responseEnv: sourceEnv }) => {
        if (input.detail !== undefined) return detail(binding, input, sourceEnv);
        return prepareDeliveryOriginalResponse({ workspace, original: carrier, result, responseEnv,
          originalCalls: [...memberCalls(result, carrier), ...(resolveLauncherRunState(sessionEnv).role === "orchestrator"
            ? [buildNextCall({ tool: "integrate_work", arguments: { delivery: result } })] : [])] }).body;
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

export function presentRunObservation(observation, detailCall, responseEnv, subject, request = {}) {

  const result = observation.original_result == null ? undefined
    : selectedResponseLocator(observation.original_result);
  const selected = observation.selected;
  const final = observation.final_result ?? selected?.result;
  const publication = observation.original_publication;
  const verification = observation.candidate_verification;
  const observeAgain = result === undefined && publication?.state !== "failed" && observation.accepted === true &&
    (observation.terminal === false || observation.producer_pending === true);
  const summary = { accepted: observation.accepted, ok: observation.ok,
    subject: observation.subject ?? subject ?? null,
    attempt_id: observation.run_id ?? selected?.dispatch_tuple?.run_id ?? null,
    role: observation.role ?? null, status: observation.status ?? observation.selected?.status ?? null,
    terminal: observation.terminal ?? null, producer_pending: observation.producer_pending ?? null,
    ...(publication === undefined ? {} : { original_publication: {
      state: publication.state, ...(publication.stage === undefined ? {} : { stage: publication.stage }),
      ...(publication.bound === undefined ? {} : { bound: publication.bound }),
      ...(publication.owner === undefined ? {} : { owner: publication.owner }) } }),
    final_result_summary: final == null ? null : { kind: final.kind, schema_version: final.schema_version,
      missing_result: final.missing_result == null ? null : projectRecordedFailureDetail(final.missing_result,
        { original: DISPATCH_FAILURE_ORIGINALS.RUN_FINAL_RESULT, nested: true }),
      full_response_chars: typeof final.full_response?.text === "string" ? final.full_response.text.length : 0 },
    ...(selected === undefined ? {} : { recorded: { result_available: selected.result !== null,
      result_digest: selected.result_digest, released: selected.released,
      last_lifecycle_kind: selected.last_lifecycle_kind, failure_count: selected.failures.length,
      proof_verification_count: selected.proof_verifications.length } }),
    ...(observation.result_publication === undefined ? {} : { result_publication: {
      state: observation.result_publication.state, attempts: observation.result_publication.attempts,
      result_available: observation.result_publication.result != null } }),
    ...Object.fromEntries(["completion_failure", "completion_settlement_failure",
      "final_result_publication_failure"].filter(field => observation[field] !== undefined).map(field => [field,
      projectRecordedFailureDetail(observation[field], { original: DISPATCH_FAILURE_ORIGINALS.READ_OBSERVATION, nested: true })])),
    ...(observation.proof_verification === undefined ? {} : { proof_verification: observation.proof_verification }),
    ...(observation.refusal === undefined ? {} : { refusal: observation.refusal }),
    ...(observation.code === undefined ? {} : { code: observation.code }),
    original: result === undefined ? { available: false, reason: observation.producer_pending === true
      ? "producer_original_pending" : publication?.state === "failed"
        ? publication.stage === "original_capture" ? "producer_original_capture_failed" : "producer_completion_failed"
      : publication?.state === "not_configured" ? "producer_original_not_configured" : observation.terminal === true
      ? "producer_original_unavailable" : selected?.result !== null && selected !== undefined
        ? "durable_result_has_no_retained_original"

      : observation.ok === false || observation.accepted === false ? "observation_unavailable"
      : "producer_not_terminal" } : { available: true, result },
    observation: { executed: false, integrated: false, retained: false },
    ...(observation.delivery === undefined ? {} : { delivery: observation.delivery }),
    ...(verification === undefined ? {} : { candidate_verification: verification.state === "offered"
      ? { state: verification.state, candidate: verification.candidate }
      : { state: verification.state, cause: verification.cause } }),
    next_calls: result !== undefined ? [detailCall(result)] : observeAgain ? [buildNextCall({ tool: route,
      arguments: request.assigned === true ? { assigned: true }
        : { subject: observation.subject, attempt_id: observation.run_id } })] : [] };
  for (const result of observation.delivery?.references ?? []) summary.next_calls.push(buildNextCall({
    tool: route, arguments: { result } }));

  if (observation.delivery !== undefined && request.assigned !== true) {
    const references = observation.delivery.references ?? [];
    summary.integration = references.length === 1 ? { requested: false, offered: true }
      : { requested: false, offered: false, reason: references.length > 1 ? "delivery_locator_ambiguous"
        : observation.delivery.cause?.reason ?? observation.delivery.cause?.code ?? "delivery_locator_unavailable" };
    if (references.length === 1) summary.next_calls.push(buildNextCall({
      tool: "integrate_work", arguments: { delivery: references[0] } }));
  }

  if (verification?.state === "offered") summary.next_calls.push(verification.call);
  const bound = selectedResponseDeliveryBound(responseEnv);
  if (measureMcpInlineResultBytes(summary) > bound) throw selectedResponseQueryInvalidError(route,
    "observation_projection_exceeds_delivery_bound", { bound, subject: summary.subject });
  return summary;
}
