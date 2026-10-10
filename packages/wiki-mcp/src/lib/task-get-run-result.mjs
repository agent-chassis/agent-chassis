

import { projectRecordedFailureDetail, DISPATCH_FAILURE_ORIGINALS } from "./dispatch-tool-helpers.mjs";
import { selectedFullContent, measureMcpInlineResultBytes, activeMcpInlineByteLimit } from "./mcp-response.mjs";
import { observeRunProofVerification, projectCompactRunProofVerification, projectListedItem,
  projectPublicVerifyProofRefusal } from "./dispatch-run-proof-verification.mjs";
import { readVerifyProofOriginal } from "./verify-proof-result-reader.mjs";
import { projectVerifyProofSummary } from "./verify-proof-result-summary.mjs";
import { projectVerifyProofSelectedDetail } from "./verify-proof-result-detail.mjs";
import { readVerifyProofRunRecord } from "./verify-proof-run-record-reader.mjs";
import { realpathSync } from "node:fs";
import path from "node:path";

import { z } from "zod";
import { buildNextCall } from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";

import { resolveLauncherRunState } from "./launcher-run-credential.mjs";
import { createGetRunResultObservation, GET_RUN_RESULT_INVENTORY_INPUT_SCHEMA } from "./task-get-run-result-observation.mjs";
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
import { RUN_TEST_TOOL_NAME } from "./run-test-input.mjs";
import { runTestViewSelection } from "./run-test-result.mjs";
import { createRunTestResultReader } from "./run-test-tool.mjs";
import { isCurrentSelectedResponseLocator, readSelectedResponseSource, selectedResponseDetailSchema,
  selectedResponseLocator, selectedResponseQueryInvalidError, SELECTED_RESPONSE_LOCATOR_NOT_CURRENT_REASON,
  SELECTED_RESPONSE_QUERY_INVALID_CODE } from "./selected-response-snapshot.mjs";
import { INTEGRATION_ORIGINAL_PRODUCER, createIntegrationOriginals } from "./task-integrate-work-result.mjs";
import { DELIVERY_ORIGINAL_PRODUCER, readDeliveryOriginalForSession, resolveDeliveryReceiptEnvironment } from "./task-deliver-work-result.mjs";
import { VERIFY_PROOF_TOOL_NAME } from "./verify-proof-public-result.mjs";
import { readRecordedVerification, readRetainedVerification, verifyProofRecordedInvocationInputSchema } from
  "./verify-proof-tool.mjs";

export const GET_RUN_RESULT_TASK = "get_run_result";

const proofSchema = z.union([z.object({ subject: z.string().min(1).max(512) }).strict(),
  z.object({ source: z.object({ unit: proofAuthoringUnitInputSchema(z),
    focus: proofAuthoringFocusInputSchema(z).optional() }).strict() }).strict()]);
export const GET_RUN_RESULT_RETAINED_INPUT_SCHEMA = z.object({ result: selectedResponseDetailSchema(z).shape.source,
  proof: proofSchema.optional(), detail: GET_RUN_RESULT_DETAIL_INPUT_SCHEMA.optional() }).strict();
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
  const row = (subject) => subject === original.subject ? undefined : { subject };
  return { ...shippedVerifyProofCalls, execution: verifyProofExecutionCall, evidence,
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
    requestContracts, receivingRole,
    resolveAuthoringSource: () => resolveObligationCoverageQueryContext({ workspace, env: sessionEnv }) });
  let nativeReader;
  const delivery = createDeliveryResultPresentation({ workspace, sessionEnv, responseEnv });

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
    const routed = resolveDeliveryReceiptEnvironment({ workspace, sessionEnv, responseEnv, result });
    const { binding } = readSelectedResponseSource(routed.receipt?.result ?? result, { env: routed.env,
      expected: { repository: workspace.repo }, route: GET_RUN_RESULT_TASK });
    if (parsed.detail !== undefined && (parsed.proof !== undefined || ![DELIVERY_ORIGINAL_PRODUCER,
      INTEGRATION_ORIGINAL_PRODUCER, OBSERVATION_ORIGINAL_PRODUCER].includes(binding.route))) {
      refuse("detail_requires_delivery_original_without_proof");
    }
    if (binding.route !== RUN_TEST_TOOL_NAME && state.role !== "orchestrator" &&
        !(binding.route === DELIVERY_ORIGINAL_PRODUCER && state.role === "worker")) {
      refuse("producer_role_ineligible", { role: state.role });
    }
    if (parsed.proof !== undefined && [RUN_TEST_TOOL_NAME, INTEGRATION_ORIGINAL_PRODUCER,
      DELIVERY_ORIGINAL_PRODUCER, OBSERVATION_ORIGINAL_PRODUCER].includes(binding.route)) refuse("proof_selection_requires_proof_original");
    switch (binding.route) {
      case RUN_TEST_TOOL_NAME:
        nativeReader ??= createRunTestResultReader({ z, responseEnv, jsonContent: (value) => value,
          errorContent: (error) => { throw error; } });
        return nativeReader.read(runTestViewSelection(result, "outcome"), { workspace, state });
      case VERIFY_PROOF_TOOL_NAME:
        return readProof(result, binding, parsed.proof);
      case INTEGRATION_ORIGINAL_PRODUCER:
        return createIntegrationOriginals({ workspace, sessionEnv, responseEnv }).read({ result }, {
          project: ({ binding: expected, carrier, summary }) => parsed.detail === undefined
            ? { ...summary, next_calls: delivery.memberCalls(result, carrier) } : delivery.detail(expected, parsed) });
      case DELIVERY_ORIGINAL_PRODUCER:
        return delivery.read(parsed);
      case OBSERVATION_ORIGINAL_PRODUCER: {
        const original = createObservationOriginals({ workspace, sessionEnv, responseEnv }).read(result);
        return parsed.detail === undefined ? presentRunObservation({ ...original.carrier, original_result: result },
          delivery.detailCall, responseEnv) : delivery.detail(original.binding, parsed);
      }
      default:
        return refuse("producer_not_recognized");
    }
  }

  async function recorded(request) {
    const state = resolveLauncherRunState(sessionEnv);
    const parsed = parseRequest(GET_RUN_RESULT_RECORDED_INPUT_SCHEMA, request, "read_names_exactly_one_assigned_recorded_invocation");
    return readRecordedVerification({
      args: { subject: state.assignedUnit,
        recorded_invocation: { invocation_id: parsed.recorded_invocation.invocation_id } },
      repoRoot: realpathSync(path.resolve(workspace.dir)),
      env: sessionEnv,
      deps: {},
      jsonContent: (value) => value,
      errorContent: (error) => { throw error; },
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
    if (!page.ok) refuse(page.code ?? page.refusal?.code ?? "proof_verification_record_unavailable",
      { subject: parsed.subject, attempt_id: parsed.attempt_id, stage: "journal_selection", ...page.refusal,
        ...(parsed.recorded_invocation === undefined ? {} : { requested_invocation_id: parsed.recorded_invocation.invocation_id }) });
    if (parsed.recorded_invocation === undefined) return selectedFullContent({ ...page.verified_source,
      projection: { member: "proof_verifications", snapshot: page.snapshot,
        value: page.items.map(item => projectListedItem({ subject: parsed.subject, attemptId: page.attempt_id,
          item, readCall: invocationCall })) } });
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
    const evidence = original.kind === "refusal" ? original.record : await projectEvidence(original.record);
    const outcomeCall = buildNextCall({ tool: GET_RUN_RESULT_TASK,
      arguments: { ...readRequest, detail: { member: "outcome" } } });
    if (parsed.detail !== undefined) {

      const value = { ...(original.kind === "refusal" ? projectPublicVerifyProofRefusal(evidence, {
        readCall: ownerCalls.source, fits: () => true, executionCall: ownerCalls.execution, complete: true })
        : { ...projectVerifyProofSummary(evidence, { detailCall: ownerCalls.detail }),
        proof_details: evidence.proof_results.map(proof => projectVerifyProofSelectedDetail(evidence, proof.test_proof_id)),
        }),
        ...decoration };
      return selectedFullContent({ source: original.source, serializedBytes: original.serializedBytes,
        projection: { member: "outcome", value } });
    }
    const answer = original.kind !== "refusal" && parsed.proof === undefined
      ? { kind: "answer", value: { ...projectVerifyProofSummary(evidence, {
        detailCall: ownerCalls.detail,
        fits: candidate => measureMcpInlineResultBytes({ ...candidate, ...decoration,
          next_calls: [...(candidate.next_calls ?? []), outcomeCall] }) <= activeMcpInlineByteLimit(responseEnv)
      }), ...decoration } }
      : readVerifyProofOriginal({ original: { ...original, ...identity,
      record: evidence },
      request: { ...identity, ...parsed.proof }, responseEnv,
      decoration, calls: ownerCalls,
      refuse: (reason, facts) => selectedResponseQueryInvalidError(GET_RUN_RESULT_TASK, reason,
        { subject: parsed.proof?.subject ?? identity.subject, invocation_id: parsed.recorded_invocation.invocation_id,
          stage: "subject_selection", ...facts }) });
    if (answer.kind === "refusal") throw Object.assign(new Error("recorded proof refusal"), {
      envelope: { ...answer.envelope, next_calls: [...(answer.envelope.next_calls ?? []), outcomeCall] } });
    const permitted = answer.value.schema_version === "workspace-verify-proof-selected-detail.v1"
      ? { ...answer.value, ...projectVerifyProofSelectedDetail(evidence, parsed.proof.subject) } : answer.value;
    const value = { ...permitted, next_calls: [...(permitted.next_calls ?? []), outcomeCall] };
    return parsed.proof === undefined ? value : selectedFullContent({ source: original.source,
      serializedBytes: original.serializedBytes, projection: value });
  }
  const observeCandidateVerification = createCandidateVerificationObservation({
    workspace, sessionEnv, preparedDispatchBackend });
  async function observe(request) {

    let observation = await observeRun(request);
    if (request.assigned !== true) {
      const verification = await observeCandidateVerification(request, observation);
      if (verification !== undefined) observation = { ...observation, candidate_verification: verification };

      const page = observation.proof_detail ?? (observation.ok === false &&
        !isManagedAttemptSelectionRefusal(observation) ? observation : null);

      if (page !== null) observation = { ...observation,
        proof_verification: projectCompactRunProofVerification(await observeRunProofVerification({
          observedPage: managedObservationFailureFacts(page), status: { subject: request.subject,
            run_id: observation.run_id ?? observation.selected?.dispatch_tuple?.run_id ?? request.attempt_id }, readCall: inventoryCall })) };
    }
    const receipts = observation.selected?.delivery_receipts ?? observation.delivery_receipts ?? [];
    if (receipts.length === 0) return observation;
    const references = [];
    let nonCurrent = 0;
    for (const { receipt } of receipts) {

      if (!isCurrentSelectedResponseLocator(receipt.result)) { nonCurrent += 1; continue; }
      const result = selectedResponseLocator(receipt.result);

      readDeliveryOriginalForSession({ workspace, sessionEnv, responseEnv, request: { result } });
      references.push(result);
    }
    return { ...observation, delivery: { available: references.length > 0, references,
      ...(nonCurrent === 0 ? {} : { cause: { code: SELECTED_RESPONSE_QUERY_INVALID_CODE,
        reason: SELECTED_RESPONSE_LOCATOR_NOT_CURRENT_REASON, receipts: nonCurrent } }) } };
  }
  return Object.freeze({ retained, recorded, coordinator, observe,
    presentObservation: (observation, request) => presentRunObservation(observation, delivery.detailCall, responseEnv,
      request.assigned === true ? resolveLauncherRunState(sessionEnv).assignedUnit : request.subject, request) });
}
