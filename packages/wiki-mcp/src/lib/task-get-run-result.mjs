

import { buildDispatchToolExceptionDetail, projectRecordedFailureDetail, DISPATCH_FAILURE_ORIGINALS } from "./dispatch-tool-helpers.mjs";
import { jsonContent, selectedFullContent, completeProducedContent, measureMcpInlineResultBytes, activeMcpInlineByteLimit } from "./mcp-response.mjs";
import { observeRunProofVerification, projectCompactRunProofVerification,
  projectPublicVerifyProofRefusal } from "./dispatch-run-proof-verification.mjs";
import { readVerifyProofOriginal } from "./verify-proof-result-reader.mjs";
import { selectedResponseDeliveryBound } from "./selected-response-snapshot.mjs";
import { projectVerifyProofExecutionResponse, projectVerifyProofTestedSource } from "./verify-proof-execution-response.mjs";
import { readVerifyProofRunRecord } from "./verify-proof-run-record-reader.mjs";
import { realpathSync } from "node:fs";
import path from "node:path";

import { z } from "zod";
import { admitResultContinuations } from "./get-run-result-callability.mjs";
import { integrationReadOutcome } from "./get-run-result-outcome-projection.mjs";
import { readAssignmentChange } from "./task-request-assignment-change-result.mjs";
import { buildNextCall } from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";

import { resolveLauncherRunState } from "./launcher-run-credential.mjs";
import { createGetRunResultObservation, GET_RUN_RESULT_INVENTORY_INPUT_SCHEMA,
  projectRunObservationFailure } from "./task-get-run-result-observation.mjs";
import { createCandidateVerificationObservation } from "./task-get-run-result-candidate-verification.mjs";
import { isManagedAttemptSelectionRefusal, managedObservationFailureFacts } from
  "../../../agent-launch-core/src/lib/managed-run-observation.mjs";
import { createDeliveryResultPresentation, createObservationOriginals, OBSERVATION_ORIGINAL_PRODUCER,
  presentRunObservation, GET_RUN_RESULT_DETAIL_INPUT_SCHEMA } from "./task-get-run-result-delivery.mjs";
import { managedTestAuthorityAuthenticated, managedTestAuthorityIdentity } from "./managed-test-source-context.mjs";
import { proofAuthoringFocusInputSchema, proofAuthoringUnitInputSchema } from "./proof-authoring-input-schema.mjs";
import { verifyProofExecutionCall } from "./task-verify-proof.mjs";
import { shippedVerifyProofCalls, projectVerifyProofRecoveryForRegisteredTools } from "./verify-proof-delivery.mjs";
import { resolveObligationCoverageQueryContext } from "./controlled-contract-query-context.mjs";
import { RUN_TEST_TOOL_NAME, RUN_TEST_STRUCTURED_VIEWS } from "./run-test-input.mjs";
import { runTestViewSelection } from "./run-test-result.mjs";
import { createRunTestResultReader } from "./run-test-tool.mjs";
import { isCurrentSelectedResponseLocator, readSelectedResponseSource, selectedResponseDetailSchema,
  selectedResponseLocator, selectedResponseQueryInvalidError, SELECTED_RESPONSE_LOCATOR_NOT_CURRENT_REASON,
  SELECTED_RESPONSE_QUERY_INVALID_CODE } from "./selected-response-snapshot.mjs";
import { INTEGRATION_ORIGINAL_PRODUCER, createIntegrationOriginals } from "./task-integrate-work-result.mjs";
import { DELIVERY_ORIGINAL_PRODUCER, readDeliveryOriginalForSession, resolveDeliveryReceiptEnvironment,
  selectLogicalDeliveryAccounts } from "./task-deliver-work-result.mjs";
import { VERIFY_PROOF_TOOL_NAME } from "./verify-proof-public-result.mjs";
import { readRecordedVerification, readRetainedVerification, verifyProofRecordedInvocationInputSchema } from
  "./verify-proof-tool.mjs";

export const GET_RUN_RESULT_TASK = "get_run_result";

const proofSchema = z.union([z.object({ subject: z.string().min(1).max(512) }).strict(),
  z.object({ source: z.object({ unit: proofAuthoringUnitInputSchema(z),
    focus: proofAuthoringFocusInputSchema(z).optional() }).strict() }).strict()]);
export const GET_RUN_RESULT_RETAINED_INPUT_SCHEMA = z.object({ result: selectedResponseDetailSchema(z).shape.source,
  proof: proofSchema.optional(), detail: GET_RUN_RESULT_DETAIL_INPUT_SCHEMA.optional(),
  native: z.object({ view: z.enum(RUN_TEST_STRUCTURED_VIEWS),
    failure: z.number().int().positive().optional() }).strict().optional()
    .describe('Issued structured native-result selection. Complete semantic meaning only; no captured streams.') }).strict();
export const GET_RUN_RESULT_RECORDED_INPUT_SCHEMA = z.object({ assigned: z.literal(true),
  recorded_invocation: verifyProofRecordedInvocationInputSchema(z), proof: proofSchema.optional() }).strict();
export const GET_RUN_RESULT_COORDINATOR_RECORDED_INPUT_SCHEMA = z.object({
  subject: GET_RUN_RESULT_INVENTORY_INPUT_SCHEMA.shape.subject, attempt_id: z.string().min(1),
  recorded_invocation: verifyProofRecordedInvocationInputSchema(z),
  proof: proofSchema.optional() }).strict();
export const GET_RUN_RESULT_COORDINATOR_OUTCOME_INPUT_SCHEMA = GET_RUN_RESULT_COORDINATOR_RECORDED_INPUT_SCHEMA
  .omit({ proof: true }).extend({ detail: z.object({ member: z.literal("outcome") }).strict() }).strict();

const RESULT_READER_ROLES = Object.freeze(["orchestrator", "worker", "reviewer"]);
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const refuse = (reason, details = {}) => {
  throw selectedResponseQueryInvalidError(GET_RUN_RESULT_TASK, reason, details);
};

function parseRequest(schema, request, reason) {
  const parsed = schema.safeParse(request);
  if (parsed.success) return parsed.data;
  return refuse(reason, { rejected_arguments: [...new Set(parsed.error.issues
    .flatMap((issue) => (issue.keys ?? [null]).map((key) => [...issue.path, ...(key === null ? [] : [key])]
      .join(".") || "request")))] });
}

function proofReadCalls(request, original, evidence) {
  const common = (options, proof) => buildNextCall({ tool: GET_RUN_RESULT_TASK,
    recommended: options?.recommended ?? false,
    arguments: { ...request, ...(proof === undefined ? {} : { proof }) } });
  const row = (subject) => ({ subject });
  return { ...shippedVerifyProofCalls, original: () => common({}, undefined), execution: verifyProofExecutionCall, evidence,
    retained: (repo, locator, subject, options) =>
      common(options, row(subject)),
    recorded: (subject, invocationId, options) =>
      common(options, row(subject)),
    sourceRetained: (repo, locator, subject, source) =>
      common({}, { source }),
    sourceRecorded: (subject, invocationId, source) =>
      common({}, { source }) };
}

export function createGetRunResultTask({ workspace, sessionEnv, responseEnv,
  preparedDispatchBackend, dispatchSessionIdentity, requestContracts, receivingRole = null }) {
  const projectEvidence = evidence => projectVerifyProofRecoveryForRegisteredTools(evidence, {
    requestContracts, receivingRole, workspace, sessionEnv, responseEnv,
    resolveAuthoringSource: () => resolveObligationCoverageQueryContext({ workspace, env: sessionEnv }) });
  let nativeReader;
  const delivery = createDeliveryResultPresentation({ workspace, sessionEnv, responseEnv, requestContracts });

  function authenticateSession() {
    const state = resolveLauncherRunState(sessionEnv);
    const authorityIdentity = managedTestAuthorityIdentity(state);
    if (!RESULT_READER_ROLES.includes(state.role) || !managedTestAuthorityAuthenticated(authorityIdentity)) {
      refuse("session_not_authenticated_result_reader", { role: state.role ?? null });
    }
    return state;
  }

  function readProof(result, binding, proof) {
    const query = binding.query_identity;
    if (!isRecord(query)) refuse("source_binding_mismatch", { binding_field: "query_identity" });
    return readRetainedVerification({
      args: { subject: query.subject, result, ...(isRecord(query.source) ? { source: query.source } : {}) },
      repository: workspace.repo,
      jsonContent: (value) => value,
      errorContent: (error) => { throw error; },
      responseEnv,
      env: sessionEnv,
      deps: {},
      proofSelection: proof,
      readCalls: (original) => proofReadCalls({ result }, original, projectEvidence)
    });
  }

  async function retained(request) {
    const state = authenticateSession();
    const parsed = parseRequest(GET_RUN_RESULT_RETAINED_INPUT_SCHEMA, request, "read_names_exactly_one_retained_result");
    const result = { ref_id: parsed.result.ref_id };
    if (parsed.native !== undefined && (parsed.proof !== undefined || parsed.detail !== undefined ||
        parsed.native.failure !== undefined && parsed.native.view !== 'failure')) refuse('native_selection_names_one_structured_view');
    const assignmentOriginal = ["worker", "orchestrator"].includes(state.role)
      ? readAssignmentChange({ workspace, sessionEnv, responseEnv, result, allowMissing: true }) : null;
    if (assignmentOriginal !== null) {
      if (parsed.native !== undefined) refuse('native_selection_requires_native_original');
      if (parsed.proof !== undefined) refuse("proof_selection_requires_proof_original");
      return parsed.detail !== undefined ? delivery.detail(assignmentOriginal.binding, parsed, assignmentOriginal.responseEnv)
        : admitResultContinuations({ subject: assignmentOriginal.carrier.identity.unit, accepted: true,
          request: assignmentOriginal.carrier.request,
          next_calls: [...delivery.memberCalls(result, { assignment: assignmentOriginal.carrier.assignment }, assignmentOriginal.binding.route),
            ...(state.role === "orchestrator" ? [buildNextCall({ tool: "workspace_read_wiki", arguments: { reads: [{ subject: assignmentOriginal.carrier.identity.unit,
              for_changes: ['notes', 'read_scope', 'write_scope', 'material_refs'] }] } })] : [])] }, requestContracts);
    }
    const routed = resolveDeliveryReceiptEnvironment({ workspace, sessionEnv, responseEnv, result });
    const { binding } = readSelectedResponseSource(routed.receipt?.result ?? result, { env: routed.env,
      expected: { repository: workspace.repo }, route: GET_RUN_RESULT_TASK });
    if (parsed.native !== undefined && binding.route !== RUN_TEST_TOOL_NAME) refuse('native_selection_requires_native_original');
    if (parsed.detail !== undefined && (parsed.proof !== undefined || ![DELIVERY_ORIGINAL_PRODUCER,
      INTEGRATION_ORIGINAL_PRODUCER, OBSERVATION_ORIGINAL_PRODUCER].includes(binding.route))) {
      refuse("detail_requires_delivery_original_without_proof");
    }
    if (binding.route !== RUN_TEST_TOOL_NAME && state.role !== "orchestrator" &&
        !(binding.route === DELIVERY_ORIGINAL_PRODUCER && state.role === "worker") &&
        !(binding.route === VERIFY_PROOF_TOOL_NAME && state.role === "reviewer")) {
      refuse("producer_role_ineligible", { role: state.role });
    }
    if (parsed.proof !== undefined && [RUN_TEST_TOOL_NAME, INTEGRATION_ORIGINAL_PRODUCER,
      DELIVERY_ORIGINAL_PRODUCER, OBSERVATION_ORIGINAL_PRODUCER].includes(binding.route)) refuse("proof_selection_requires_proof_original");
    switch (binding.route) {
      case RUN_TEST_TOOL_NAME:
        nativeReader ??= createRunTestResultReader({ z, responseEnv, jsonContent: (value) => value,
          errorContent: (error) => { throw error; } });
        return nativeReader.read(runTestViewSelection(result, parsed.native?.view ?? "outcome", parsed.native?.failure),
          { workspace, state }, { completeSemantic: parsed.native !== undefined });
      case VERIFY_PROOF_TOOL_NAME:
        return readProof(result, binding, parsed.proof);
      case INTEGRATION_ORIGINAL_PRODUCER:
        return createIntegrationOriginals({ workspace, sessionEnv, responseEnv }).read({ result }, {
          project: ({ binding: expected, carrier }) => parsed.detail === undefined
            ? integrationReadOutcome({ carrier, result, responseEnv, role: state.role, requestContracts, subject: expected.unit })
            : delivery.detail(expected, parsed) });
      case DELIVERY_ORIGINAL_PRODUCER:
        return delivery.read(parsed);
      case OBSERVATION_ORIGINAL_PRODUCER: {
        const original = createObservationOriginals({ workspace, sessionEnv, responseEnv }).read(result);
        const answer = await delivery.detail(original.binding, parsed.detail === undefined
          ? { result, detail: { member: "final_result" } } : parsed);
        return parsed.detail === undefined ? answer.structuredContent : answer;
      }
      default:
        return refuse("producer_not_recognized");
    }
  }

  async function deliverRetained(request) {
    const value = await retained(request);
    if (request.detail !== undefined) return value;
    if (measureMcpInlineResultBytes(value) <= activeMcpInlineByteLimit(responseEnv)) {
      return jsonContent(value, { env: responseEnv });
    }
    const routed = resolveDeliveryReceiptEnvironment({ workspace, sessionEnv, responseEnv, result: request.result });
    const source = routed.receipt?.result ?? request.result;
    const original = readSelectedResponseSource(source, { env: routed.env,
      expected: { repository: workspace.repo }, route: GET_RUN_RESULT_TASK });
    if (![DELIVERY_ORIGINAL_PRODUCER, INTEGRATION_ORIGINAL_PRODUCER, VERIFY_PROOF_TOOL_NAME, OBSERVATION_ORIGINAL_PRODUCER,
      RUN_TEST_TOOL_NAME]
      .includes(original.binding.route)) return jsonContent(value, { env: responseEnv });
    return selectedFullContent({ source, retained: original, projection: value });
  }

  async function recorded(request, completeDelivery = false) {
    const state = resolveLauncherRunState(sessionEnv);
    const parsed = parseRequest(GET_RUN_RESULT_RECORDED_INPUT_SCHEMA, request, "read_names_exactly_one_assigned_recorded_invocation");
    return readRecordedVerification({
      args: { subject: state.assignedUnit,
        recorded_invocation: { invocation_id: parsed.recorded_invocation.invocation_id } },
      repoRoot: realpathSync(path.resolve(workspace.dir)),
      env: sessionEnv,
      deps: {},
      jsonContent: completeDelivery ? (value) => jsonContent(value, { env: responseEnv }) : (value) => value,
      errorContent: (error) => { throw error; },
      completeDelivery,
      responseEnv,
      originalSelection: true,
      proofSelection: parsed.proof,
      readCalls: (original) => proofReadCalls({ assigned: true,
        recorded_invocation: { invocation_id: parsed.recorded_invocation.invocation_id } }, original, projectEvidence)
    });
  }

  const observeRun = createGetRunResultObservation({
    workspace, sessionEnv, preparedDispatchBackend, dispatchSessionIdentity, parseRequest, refuse, responseEnv
  });
  const inventoryCall = (subject, attemptId) => buildNextCall({ tool: GET_RUN_RESULT_TASK,
    arguments: { subject, attempt_id: attemptId, detail: { member: "proof_verifications" } } });
  const invocationCall = (subject, attemptId, detail) => buildNextCall({ tool: GET_RUN_RESULT_TASK,
    arguments: { subject, attempt_id: attemptId,
      recorded_invocation: { invocation_id: detail.invocation_id } } });
  async function coordinator(request) {
    const parsed = parseRequest(request.recorded_invocation === undefined ? GET_RUN_RESULT_INVENTORY_INPUT_SCHEMA
      : request.detail === undefined ? GET_RUN_RESULT_COORDINATOR_RECORDED_INPUT_SCHEMA
        : GET_RUN_RESULT_COORDINATOR_OUTCOME_INPUT_SCHEMA, request, "read_names_exactly_one_coordinator_proof_selection");
    const page = await observeRun({ subject: parsed.subject, attempt_id: parsed.attempt_id },
      { kind: "proof_verification", complete: true,
        ...(parsed.recorded_invocation === undefined ? {} : { invocation_id: parsed.recorded_invocation.invocation_id }) });
    if (!page.ok) {
      const failure = projectRunObservationFailure(page);
      refuse(page.code ?? page.refusal?.code ?? "proof_verification_record_unavailable",
        { subject: parsed.subject, attempt_id: parsed.attempt_id, stage: "journal_selection", ...failure.cause.refusal,
          ...(page.refusal == null ? { cause: failure.cause } : {}),
          ...(parsed.recorded_invocation === undefined ? {} : { requested_invocation_id: parsed.recorded_invocation.invocation_id }) });
    }
    if (parsed.recorded_invocation === undefined) return selectedFullContent({ ...page.verified_source,
      projection: { member: "proof_verifications",
        value: page.items.map(item => ({ invocation_id: item.invocation_id,
          outcome: item.verification.outcome, status: item.verification.status,
          ...(item.verification.reason_code == null ? {} : { reason_code: item.verification.reason_code }),
          request: item.verification.request,
          ...(projectVerifyProofTestedSource({ candidate_identity: item.verification.tested_source?.candidate }) === undefined ? {} : {
            tested_source: projectVerifyProofTestedSource({ candidate_identity: item.verification.tested_source?.candidate }) }),
          coverage_scope: item.verification.coverage_scope,
          detail_call: invocationCall(parsed.subject, page.attempt_id, item) })) } });
    const verification = page.items[0].verification;
    let original;
    try { original = readVerifyProofRunRecord({ workspaceDir: workspace.dir, verification, includeVerifiedSource: true }); }
    catch (error) { refuse(error.code, { subject: parsed.subject, attempt_id: parsed.attempt_id,
      invocation_id: parsed.recorded_invocation.invocation_id, stage: "cached_record_read", cause: projectRecordedFailureDetail(error.details,
        { original: DISPATCH_FAILURE_ORIGINALS.READ_OBSERVATION, nested: true }) }); }
    const identity = { subject: verification.request.subject, source: verification.request.source ?? null };
    const readRequest = { subject: parsed.subject, attempt_id: parsed.attempt_id,
      recorded_invocation: parsed.recorded_invocation };
    const calls = proofReadCalls(readRequest, identity, projectEvidence);
    const decoration = { recorded_invocation: { invocation_id: parsed.recorded_invocation.invocation_id },
      observation: { kind: "retained_prior_observation" } };
    const ownerCalls = { execution: calls.execution, detail: (proof, options) => calls.recorded(proof, null, options),
      source: source => calls.sourceRecorded(identity.subject, null, source) };
    const evidence = await projectEvidence(original.record);
    const outcomeCall = buildNextCall({ tool: GET_RUN_RESULT_TASK,
      arguments: { ...readRequest, detail: { member: "outcome" } } });
    if (parsed.detail !== undefined) {

      const value = { ...(original.kind === "refusal" ? projectPublicVerifyProofRefusal(evidence, {
        readCall: ownerCalls.source, fits: () => true, executionCall: ownerCalls.execution, complete: true })
        : projectVerifyProofExecutionResponse(evidence, { detailCall: ownerCalls.detail, population: true })),
        ...decoration };
      return selectedFullContent({ source: original.source, serializedBytes: original.serializedBytes,
        projection: { member: "outcome", value } });
    }
    const answer = original.kind !== "refusal" && parsed.proof === undefined
      ? { kind: "answer", value: { ...projectVerifyProofExecutionResponse(evidence, {
        detailCall: ownerCalls.detail,
        fits: candidate => measureMcpInlineResultBytes({ ...candidate, ...decoration,
          next_calls: [...(candidate.next_calls ?? []), outcomeCall] }) <= activeMcpInlineByteLimit(responseEnv)
      }), ...decoration } }
      : readVerifyProofOriginal({ original: { ...original, ...identity,
      record: evidence },
      request: { ...identity, ...parsed.proof }, responseEnv, selectedSubject: parsed.proof?.subject !== undefined,
      decoration, calls: ownerCalls,
      refuse: (reason, facts) => selectedResponseQueryInvalidError(GET_RUN_RESULT_TASK, reason,
        { subject: parsed.proof?.subject ?? identity.subject, invocation_id: parsed.recorded_invocation.invocation_id,
          stage: "subject_selection", ...facts }) });
    if (answer.kind === "refusal") throw Object.assign(new Error("recorded proof refusal"), {
      envelope: { ...answer.envelope, next_calls: [...(answer.envelope.next_calls ?? []), outcomeCall] } });
    const value = { ...answer.value, next_calls: [...(answer.value.next_calls ?? []), outcomeCall] };
    return parsed.proof === undefined ? value : selectedFullContent({ source: original.source,
      serializedBytes: original.serializedBytes, projection: value });
  }
  const observeCandidateVerification = createCandidateVerificationObservation({
    workspace, sessionEnv, preparedDispatchBackend });
  async function observe(request) {

    let observation = await observeRun(request);
    const failed = observation.observation_detail ?? (observation.ok === false &&
      !isManagedAttemptSelectionRefusal(observation) ? observation : null);
    if (failed !== null) return { ...observation, observation_failure: projectRunObservationFailure(failed) };
    if (request.assigned !== true) {
      const verification = await observeCandidateVerification(request, observation);
      if (verification !== undefined) observation = { ...observation, candidate_verification: verification };

      const page = observation.proof_detail ?? null;

      if (page !== null) observation = { ...observation,
        proof_verification: projectCompactRunProofVerification(await observeRunProofVerification({
          observedPage: managedObservationFailureFacts(page), status: { subject: request.subject,
            run_id: observation.run_id ?? observation.selected?.dispatch_tuple?.run_id ?? request.attempt_id }, readCall: inventoryCall })) };
    }
    const receipts = observation.selected?.delivery_receipts ?? observation.delivery_receipts;

    if (receipts === undefined) return observation;
    if (receipts.length === 0) return { ...observation,
      delivery: { available: false, references: [], state: "absent" } };
    const references = [];
    const accounts = [];
    let nonCurrent = 0;
    for (const [index, { receipt }] of receipts.entries()) {

      if (!isCurrentSelectedResponseLocator(receipt.result)) { nonCurrent += 1; continue; }
      const result = selectedResponseLocator(receipt.result);

      try {
        const carrier = readDeliveryOriginalForSession({ workspace, sessionEnv, responseEnv, request: { result } });
        accounts.push({ result, carrier });
      }
      catch (error) {

        refuse("delivery_receipt_unreadable", {
          subject: request.assigned === true ? resolveLauncherRunState(sessionEnv).assignedUnit : request.subject,
          attempt_id: observation.run_id ?? observation.selected?.dispatch_tuple?.run_id ?? request.attempt_id,
          receipt: { index, result },
          cause: buildDispatchToolExceptionDetail(GET_RUN_RESULT_TASK, error,
            { original: DISPATCH_FAILURE_ORIGINALS.READ_OBSERVATION }),
          effects: { executed: false, integrated: false, retained: false },
          limitation: "The attempt's subordinate delivery receipt could not be read. No delivery success or integration is established; stop this dependent step." });
      }
    }
    let heads;
    try { heads = selectLogicalDeliveryAccounts(accounts, { readAncestor: result =>
      readDeliveryOriginalForSession({ workspace, sessionEnv, responseEnv, request: { result } }) }).heads; }
    catch (error) { refuse('delivery_recovery_unavailable', {
      subject: request.assigned === true ? resolveLauncherRunState(sessionEnv).assignedUnit : request.subject,
      cause: buildDispatchToolExceptionDetail(GET_RUN_RESULT_TASK, error),
      effects: { executed: false, integrated: false },
      limitation: 'The delivery recovery relationship could not be authenticated. No logical delivery was selected; do not guess or replay delivery.' }); }
    const choices = heads.map(({ result, carrier }) => {
      references.push(result);
      const response = carrier.outcome.response;
      const paths = response.changed_paths ?? carrier.scope_verification?.result?.changed_paths;
      return { commit: response.transaction.delivery_commit,
        ...(paths === undefined ? {} : { changed_paths: paths }), checkout: response.checkout,
        call: buildNextCall({ tool: GET_RUN_RESULT_TASK, arguments: { result } }) };
    });
    return { ...observation, delivery: { available: references.length > 0, references,
      ...(choices.length > 1 ? { choices } : {}),
      ...(nonCurrent === 0 ? {} : { cause: { code: SELECTED_RESPONSE_QUERY_INVALID_CODE,
        reason: SELECTED_RESPONSE_LOCATOR_NOT_CURRENT_REASON, receipts: nonCurrent } }) } };
  }
  const presentObservation = (observation, request) => admitResultContinuations(presentRunObservation(observation, delivery.detailCall, responseEnv,
    request.assigned === true ? resolveLauncherRunState(sessionEnv).assignedUnit : request.subject, request), requestContracts);
  async function deliverObservation(observation, request) {
    const value = await presentObservation(observation, request);
    if (measureMcpInlineResultBytes(value) <= selectedResponseDeliveryBound(responseEnv)) return jsonContent(value, { env: responseEnv });
    if (observation.verified_source !== undefined) return selectedFullContent({ ...observation.verified_source, projection: value });
    if (value.attempt_choices?.length > 0 || value.delivery?.choices?.length > 0) return completeProducedContent(value);
    return jsonContent({ subject: value.subject, attempt_id: value.attempt_id, complete: false,
      code: 'authenticated_observation_source_unavailable', no_supported_route: true,
      cause: 'The complete attempt or delivery choices exceed compact admission and this observation has no authenticated whole-selection source.',
      recovery: 'Stop the dependent selection. No attempt or delivery was selected; do not guess a choice or repeat an effectful operation.', next_calls: [] }, { env: responseEnv });
  }
  return Object.freeze({ retained, deliverRetained, recorded, deliverRecorded: request => recorded(request, true), coordinator, observe, deliverObservation,
    presentObservation });
}
