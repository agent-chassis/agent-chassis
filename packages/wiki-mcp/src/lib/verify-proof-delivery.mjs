import { buildNextCall } from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";
import { assertNoControlledContractRawResponse, describeRetentionFailure, activeMcpInlineByteLimit, measureMcpInlineResultBytes, selectedFullContent } from "./mcp-response.mjs";
import { retainSelectedResponseSource, readSelectedResponseSource } from "./selected-response-snapshot.mjs";
import { VERIFY_PROOF_TOOL_NAME, projectPublicVerifyProofAggregate, projectVerifyProofSummary } from "./verify-proof-public-result.mjs";
import { requestedVerifyProofSource as requestedSource, verifyProofAnswerAdmission as answerAdmission,
  projectPublicVerifyProofSourceRefusal as publicSourceRefusal } from "./verify-proof-result-reader.mjs";
import { projectProofAuthoringAcquisition } from "./verify-proof-failure-detail.mjs";
import { readManagedProofVerification } from "../../../agent-launch-cli/src/lib/managed-run-process-identity-store.mjs";
import { readVerifyProofRunRecord } from "./verify-proof-run-record-reader.mjs";
import { distillCapturedCauses } from "./dispatch-tool-helpers.mjs";
import { projectVerifyProofExecutionResponse, projectVerifyProofExecutionRefusal } from "./verify-proof-execution-response.mjs";
import { isVerifyProofPopulationSubject } from "./verify-proof-result-detail.mjs";
import { captureDiagnosticEvidence } from "../../../agent-launch-cli/src/lib/diagnostic-evidence.mjs";
import { projectVerifyProofRegressionReads } from "./verify-proof-regression-reads.mjs";

export async function projectVerifyProofRecoveryForRegisteredTools(evidence, {
  requestContracts, receivingRole, resolveAuthoringSource, workspace, sessionEnv, responseEnv
}) {
  evidence = await projectVerifyProofRegressionReads(evidence, {
    requestContracts, workspace, sessionEnv, responseEnv });
  if (evidence.reason_code === "test_proof_source_snapshot_symlink_unsupported") {
    const { projectSymlinkSourceRecovery } = await import("./verify-proof-source-repair-recovery.mjs");
    return projectSymlinkSourceRecovery(evidence, { requestContracts, workspace, sessionEnv });
  }
  let authoringContext;
  const resolveSource = resolveAuthoringSource === undefined ? undefined
    : () => authoringContext ??= resolveAuthoringSource();
  const sourceOf = (recovery, call) => {
    const binding = evidence.execution_source_binding;
    const boundUnit = binding == null ? null : binding.selected_unit == null ? binding.wk_id
      : `${binding.wk_id}#${binding.selected_unit}`;
    const source = recovery.authoring_source ?? (binding == null ? null : {
      unit: boundUnit,
      focus: binding.focus ?? null
    });
    const unit = source?.unit ?? call.arguments.reads[0].subject;
    return { unit, ...(source === null ? { focus_status: "unknown" } : { focus: source.focus ?? null }),
      ...(binding?.source === undefined ? {} : unit === boundUnit
        ? { identity: structuredClone(binding.source) }
        : { execution_source: { unit: boundUnit, focus: binding.focus ?? null,
          identity: structuredClone(binding.source) } }) };
  };
  const project = (recovery, call, proof = null) => projectProofAuthoringAcquisition({
    call, recovery, requestContracts, receivingRole, resolveAuthoringSource: resolveSource,
    ambiguities: (proof?.relationship_results ?? []).flatMap(row => row.diagnostics
      .filter(diagnostic => diagnostic.reason_code === 'verify_proof.qualifying_verification_ambiguous.v1')
      .map(diagnostic => ({ obligationId: row.obligation_id, verificationIds: diagnostic.details?.verification_ids }))),
    intent: { requested_subject: evidence.subject.requested,
      source: sourceOf(recovery, call),
      obligation_ids: [...new Set((proof?.relationship_results ?? []).map(row => row.obligation_id))] }
  });
  const proofResults = await Promise.all(evidence.proof_results.map(async proof => {
    const call = proof.recovery?.recovery_call;
    if (call?.tool !== "workspace_read_wiki") return proof;
    const projected = await project(proof.recovery, call, proof);
    return { ...proof, recovery: projected.recovery };
  }));
  let recovery = evidence.recovery;
  const nextCalls = [];
  for (const call of evidence.next_calls ?? []) {
    if (call.tool !== "workspace_read_wiki") { nextCalls.push(call); continue; }
    const projected = await project(recovery, call);
    recovery = projected.recovery;
    if (projected.call !== null) nextCalls.push(projected.call);
  }
  return { ...evidence, proof_results: proofResults,
    ...(recovery === undefined ? {} : { recovery }),
    ...(evidence.next_calls === undefined ? {} : { next_calls: nextCalls }) };
}

function resultBoundCall(repository, locator) {
  return (proofSubject, { recommended = false } = {}) => buildNextCall({
    tool: "get_run_result", recommended,
    arguments: { proof: { subject: proofSubject },
      result: { ref_id: locator.ref_id } } });
}

function sourceResultCall(repository, locator, subject, source) {
  return buildNextCall({ tool: "get_run_result", recommended: false,
    arguments: { proof: { source },
      result: { ref_id: locator.ref_id } } });
}

function sourceRecordedCall(subject, invocationId, source) {
  return buildNextCall({ tool: "get_run_result", recommended: false,
    arguments: { assigned: true, proof: { source }, recorded_invocation: { invocation_id: invocationId } } });
}

function recordedInvocationCall(subject, invocationId, { recommended = false } = {}) {
  return buildNextCall({ tool: "get_run_result", recommended,
    arguments: { assigned: true, proof: { subject }, recorded_invocation: { invocation_id: invocationId } } });
}

export function recordedInvocation(subject, invocationId, calls = shippedVerifyProofCalls) {
  return { invocation_id: invocationId, detail_call: calls.recorded(subject, invocationId) };
}

export const shippedVerifyProofCalls = Object.freeze({
  retained: (repository, locator, subject, options) => resultBoundCall(repository, locator)(subject, options),
  originalRetained: (repository, locator, subject) => resultBoundCall(repository, locator)(subject),
  recorded: recordedInvocationCall,
  sourceRetained: sourceResultCall,
  sourceRecorded: sourceRecordedCall,
  execution: null,
  retentionFailure: describeRetentionFailure,
  evidence: (evidence) => evidence,
  refusal: (evidence) => evidence,
  presentEvidence: (evidence) => evidence,
  presentRefusal: publicSourceRefusal,
  settledFailure: ({ error, errorContent }) => errorContent(error),
  unmodeledFailure: ({ error, errorContent }) => errorContent(error),
  refusalRecordingFailure: ({ recordingError, errorContent }) => errorContent(recordingError),
  summary: projectVerifyProofSummary
});

export function verifyProofRetainedResultCall(locator, { recommended = false, subject = null, population = false } = {}) {
  return Object.freeze({ tool: "get_run_result", ...(recommended ? { recommended: true } : {}),
    arguments: { result: { ref_id: locator.ref_id },
      ...(subject === null || !population && isVerifyProofPopulationSubject(subject) ? {} : { proof: { subject } }) } });
}

export function verifyProofRecordedResultCall(invocationId, { recommended = false, subject = null, population = false } = {}) {
  return Object.freeze({ tool: "get_run_result", ...(recommended ? { recommended: true } : {}),
    arguments: { assigned: true, recorded_invocation: { invocation_id: invocationId },
      ...(subject === null || !population && isVerifyProofPopulationSubject(subject) ? {} : { proof: { subject } }) } });
}

function executionRecovery(recovery, executionCall, request, binding, role) {
  const projected = { ...recovery };
  if (recovery?.retry_operation === VERIFY_PROOF_TOOL_NAME) {
    projected.retry_operation = executionCall({ subject: request.subject }).tool;
    projected.previous_execution = executionCall(request).arguments;
  }
  if (recovery?.follow_up_call?.tool === VERIFY_PROOF_TOOL_NAME) {
    const arguments_ = { ...request, ...recovery.follow_up_call.arguments };
    if (arguments_.subject !== request.subject && !isVerifyProofPopulationSubject(arguments_.subject) &&
        request.source === undefined && typeof binding?.wk_id === "string") {
      arguments_.source = { unit: binding.selected_unit == null ? binding.wk_id
        : `${binding.wk_id}#${binding.selected_unit}`,
      ...(binding.focus == null ? {} : { focus: binding.focus }) };
    }
    if (recovery.condition === "evaluated_counterevidence" &&
        (arguments_.git_sha !== undefined || role !== "worker")) {

      delete projected.follow_up_call;
      projected.previous_execution = executionCall(arguments_).arguments;
      if (role === "reviewer") {
        projected.next_step = "Report the counterevidence for this reviewed source; the implementation owner corrects it.";
        projected.stopping_condition = "Corrected-source verification requires a separately authorized source/session; this reviewer cannot change its bound source.";
      } else projected.required_choice = "Choose corrected branch or git_sha; keep the other choices in previous_execution.";
    } else projected.follow_up_call = executionCall(arguments_);
  }
  if (recovery?.correction?.verify_after_correction?.tool === VERIFY_PROOF_TOOL_NAME) {
    projected.correction = { ...recovery.correction,
      verify_after_correction: executionCall({ ...request,
        ...recovery.correction.verify_after_correction.arguments }) };
  }
  return projected;
}

function preparedBoundaryFailure(error, { operation, subject }) {
  const captured = describeRetentionFailure(error, { operation, subject });
  const retainedCause = captured.cause?.envelope?.cause_diagnostic ?? captured.cause;
  const cause = retainedCause?.schema_version === "agent_launch.diagnostic_evidence.v1"
    ? distillCapturedCauses(retainedCause)[0] : retainedCause;
  const diagnosis = {};

  for (const field of ["name", "message", "code", "syscall", "path"]) {
    const value = cause?.[field];
    if (typeof value !== "string") continue;
    diagnosis[field] = value;
  }
  return { failed_operation: operation, subject,
    cause_code: captured.cause_code,
    ...(error?.details?.stage === undefined ? {} : { stage: error.details.stage }),
    diagnosis,
    ...(retainedCause?.schema_version === "agent_launch.diagnostic_evidence.v1"
      ? { causes: distillCapturedCauses(retainedCause, { nested: true }) } : {}),
    correction: operation === "retain_selected_response_source"
      ? "Repair the response state path named by the diagnosis so it is a writable directory; this settled original was not retained. No automatic retry occurred."
      : operation === "record_verify_proof_run_result"
        ? "Repair the named run-cache or journal boundary; the settled outcome stands. No automatic retry occurred."
        : "Repair the result delivery boundary; use the original's supplied read call when available. No automatic retry occurred." };
}

function preparedRetentionFailure(error, context) {
  return { retained: false, ...preparedBoundaryFailure(error, context),
    ...(error?.details?.cause_code === undefined ? {} : { recording_cause_code: error.details.cause_code }) };
}

function unmodeledExecutionFailure({ error, effects, subject, errorContent }) {
  const causes = distillCapturedCauses(captureDiagnosticEvidence(error));
  return errorContent(Object.assign(new Error("Proof execution failed without a modeled correction", { cause: error }), {
    code: causes[0]?.code,
    envelope: { subject: { requested: subject }, status: "not_executable",
      cause: causes[0],
      ...(causes.length <= 1 ? {} : { causes: causes.slice(1) }),
      ...(effects === undefined ? {} : { execution_effects: effects }),
      stopping_condition: "The execution owner failed without a modeled correction. Preserve these effects; no supported automatic retry is available.",
      next_calls: [] }
  }));
}

export function preparedVerifyProofCalls(executionCall, projectRecovery = evidence => evidence) {
  return Object.freeze({
    summary: projectVerifyProofExecutionResponse,
    presentRefusal: (evidence, { request }) => projectVerifyProofExecutionRefusal(evidence, { executionCall, request }),
    originalRetained: (_repository, locator) => verifyProofRetainedResultCall(locator),
    retained: (_repository, locator, subject, options) => verifyProofRetainedResultCall(locator, { ...options, subject }),
    recorded: (subject, invocationId, options) => verifyProofRecordedResultCall(invocationId, { ...options, subject }),

    sourceRetained: (_repository, _locator, subject, source, request) =>
      executionCall({ ...request, subject, source }),
    sourceRecorded: (subject, _invocationId, source, request) =>
      executionCall({ ...request, subject, source }),
    execution: executionCall,
    refusalRecordingFailure: ({ envelope, recordingError, errorContent, request }) => errorContent(Object.assign(
      new Error("Proof verification refused and its original could not be recorded"), {
        code: envelope.reason_code,
        envelope: { ...projectVerifyProofExecutionRefusal(envelope, { executionCall, request }),
          original_retention: preparedRetentionFailure(recordingError, {
            operation: "record_verify_proof_run_result", subject: envelope.subject }) }
      })),
    unmodeledFailure: unmodeledExecutionFailure,
    retentionFailure: preparedRetentionFailure,
    refusal: evidence => evidence,
    presentEvidence: projectRecovery,
    evidence: (evidence, request, role) => ({ ...evidence,
      ...(evidence.recovery === undefined ? {} : {
        recovery: executionRecovery(evidence.recovery, executionCall, request, evidence.execution_source_binding, role) }),
      proof_results: evidence.proof_results.map((proof) => ({ ...proof,
        ...(proof.recovery === undefined ? {} : {
          recovery: executionRecovery(proof.recovery, executionCall, request, evidence.execution_source_binding, role) }) })) }),
    settledFailure: ({ evidence, error, errorContent, responseEnv, original = null, phase = "recording" }) => {
      const delivery = phase === "delivery";
      const failure = (delivery ? preparedBoundaryFailure : preparedRetentionFailure)(error, {
        operation: delivery ? "deliver_settled_verify_proof" : "record_verify_proof_run_result",
        subject: evidence.subject });
      if (delivery) failure.delivery_cause_code = error.details.cause_code;
      const decoration = { ...(original ?? {}), original_available: original !== null,
        ...(delivery ? { delivery_failure: failure } : { original_retention: failure }) };
      const detailCall = original === null ? null : (_subject, options) => original.result
        ? verifyProofRetainedResultCall(original.result, options)
        : verifyProofRecordedResultCall(original.recorded_invocation.invocation_id, options);
      if (detailCall !== null) decoration.next_calls = [detailCall(null, { recommended: true })];
      const summary = projectVerifyProofExecutionResponse(evidence, {
        ...answerAdmission(responseEnv, decoration), detailCall,
        selectedSubject: evidence.subject.requested });
      return errorContent(Object.assign(new Error(delivery
        ? "verify_proof settled but result delivery failed"
        : "verify_proof settled but original recording failed"), {
        code: error.code, envelope: { ...summary, code: error.code,
          ...decoration } }));
    }
  });
}

export async function validatedVerifyProofEvidence(result, calls, request, role) {
  const evidence = await calls.evidence(projectPublicVerifyProofAggregate(result), request, role);
  assertNoControlledContractRawResponse(evidence, { toolName: VERIFY_PROOF_TOOL_NAME });
  const presentation = await calls.presentEvidence(evidence);
  assertNoControlledContractRawResponse(presentation, { toolName: VERIFY_PROOF_TOOL_NAME });
  return { evidence, presentation };
}

export function deliverStandaloneVerification({ evidence, presentation, args, repository, jsonContent, responseEnv,
  requestSchema, calls, run }) {
  let locator;
  try {
    locator = retainSelectedResponseSource({
      binding: { route: VERIFY_PROOF_TOOL_NAME, repository,
        unit: evidence.subject_binding?.wk_id ?? null,
        query_identity: { subject: args.subject, source: requestedSource(args) },
        observation_identity: evidence.result_digest,
        authority_identity: run.authorityIdentity },
      carrier: evidence,
      ownerCall: (retained) => calls.originalRetained(repository, retained, args.subject),
      ownerRequestSchema: requestSchema
    }, { env: responseEnv });
  } catch (error) {

    const retention = {
      ...calls.retentionFailure(error, { operation: "retain_selected_response_source",
        subject: { route: VERIFY_PROOF_TOOL_NAME, subject: args.subject } }),
      meaning: "this settled result could not be retained, so it cannot be read back by result; " +
        "its outcome above stands"
    };
    const summary = calls.summary(presentation, {
      ...answerAdmission(responseEnv, { result_retention: retention }), selectedSubject: args.subject });
    return jsonContent({ ...summary, result_retention: retention });
  }
  run.original = { result: locator };
  const summary = calls.summary(presentation, {
    ...answerAdmission(responseEnv, { result: locator }),
    detailCall: (_subject, options) => calls.retained(repository, locator, _subject, options),
    selectedSubject: args.subject
  });
  const value = { ...summary, result: locator };
  if (measureMcpInlineResultBytes(value) <= activeMcpInlineByteLimit(responseEnv)) return jsonContent(value);

  const retained = readSelectedResponseSource(locator, { env: responseEnv,
    expected: { route: VERIFY_PROOF_TOOL_NAME, repository } });
  return selectedFullContent({ source: locator, retained, projection: value });
}

export function deliverRecordedProofProjection({ run, projection, isError = false }) {
  const page = readManagedProofVerification({ mainRepo: run.attempt.repository,
    subject: run.attempt.subject, sliceBinding: run.attempt.slice_binding, invocationId: run.invocationId });
  if (page?.ok !== true) throw Object.assign(new Error("the settled proof's recorded original could not be selected"), {
    code: page?.code ?? page?.refusal?.code ?? "proof_verification_record_unavailable", details: page?.refusal });
  const original = readVerifyProofRunRecord({ workspaceDir: run.attempt.repository,
    verification: page.items[0].verification, includeVerifiedSource: true });
  const result = selectedFullContent({ source: original.source, serializedBytes: original.serializedBytes, projection });
  if (isError) result.isError = true;
  return result;
}

export function deliverManagedVerification({ evidence, args, run, jsonContent, responseEnv, calls }) {
  const recorded = recordedInvocation(args.subject, run.invocationId, calls);
  const summary = calls.summary(evidence, {
    ...answerAdmission(responseEnv, { recorded_invocation: recorded }),
    detailCall: (proofSubject, options) => calls.recorded(proofSubject, run.invocationId, options),
    selectedSubject: args.subject
  });
  const value = { ...summary, recorded_invocation: recorded };
  return measureMcpInlineResultBytes(value) <= activeMcpInlineByteLimit(responseEnv)
    ? jsonContent(value) : deliverRecordedProofProjection({ run, projection: value });
}

export function deliveryFailure(result, error) {
  return Object.assign(new Error(
    "workspace_verify_proof settled its execution but could not deliver the result"
  ), { code: "verify_proof.result_delivery_failed.v1", details: {
    authority_limb: "mechanical_failure",
    execution_status: typeof result?.status === "string" ? result.status : null,
    result_digest: typeof result?.result_digest === "string" ? result.result_digest : null,
    cause_code: typeof error?.code === "string" ? error.code : null,
    cause_message: typeof error?.message === "string" ? error.message : null
  } });
}
