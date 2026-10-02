import { realpathSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { assertVerifyProofCallerShape, verifyProofTimeoutInputSchema }
  from "../../../wiki-core/src/operations/controlled-contract/verify-proof-operations.mjs";
import { proofAuthoringFocusInputSchema, proofAuthoringUnitInputSchema } from "./proof-authoring-input-schema.mjs";
import { withOrchestratorTestProofRuntime } from "../../../agent-launch-cli/src/lib/workspace-agent-orchestrator-test-proof-runtime.mjs";
import { resolveLauncherRunState } from "./launcher-run-credential.mjs";
import { MCP_WRITE_SEMANTICS } from "./register-tool.mjs";
import { resolveDispatchWorktreeProvisioningConfig } from "./dispatch-launch-runtime.mjs";
import { activeMcpInlineByteLimit, assertNoControlledContractRawResponse, describeRetentionFailure,
  measureMcpInlineResultBytes, retainOperatorOnlyEvidence } from "./mcp-response.mjs";
import { buildNextCall } from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";
import { readSelectedResponseSource, retainSelectedResponseSource, selectedResponseDeliveryBound,
  selectedResponseQueryInvalidError, selectedResponseRequestSchema } from "./selected-response-snapshot.mjs";
import { projectVerifyProofSelectedDetail, selectVerifyProofRows } from "./verify-proof-result-detail.mjs";
import { VERIFY_PROOF_TOOL_NAME, projectPublicVerifyProofAggregate, projectPublicVerifyProofRefusal,
  projectVerifyProofFailure, projectVerifyProofSummary, selectedVerifyProofSourceChoice,
  verifyProofSourceAmbiguityChoices } from "./verify-proof-public-result.mjs";
import { authenticateManagedWorkerSliceBinding, resolveCanonicalSubjectWkId, resolveManagedRuntimeAuthority,
  resolveProductionContextFromRuntime } from "./verify-proof-candidate-context.mjs";
import { readManagedProofVerification }
  from "../../../agent-launch-cli/src/lib/managed-run-process-identity-store.mjs";
import { recordedProofVerificationOutcomeSummary }
  from "../../../agent-launch-core/src/lib/managed-run-observation.mjs";
import { readVerifyProofRunRecord } from "./verify-proof-run-record-reader.mjs";
import { mintVerifyProofInvocationId, recordVerifyProofRunResult, resolveVerifyProofRunAttempt }
  from "./verify-proof-run-cache.mjs";
import { executeVerifyProofForContext, aggregateResult, VERIFY_PROOF_AGGREGATE_SCHEMA_VERSION,
  withVerifyProofInvocationTiming } from "./verify-proof-execution.mjs";
import { startTestProofInvocationTiming } from "../../../agent-launch-core/src/lib/test-proof-timing.mjs";
import { TEST_RUNTIME_ENVIRONMENT_ID_RE } from "@agent-chassis/controlled-contract/test-proof";
export { executeVerifyProofForContext, projectDefinitionRepairQuestion } from "./verify-proof-execution.mjs";

async function executeProductionVerifyProof({ args, env, repoRoot, repository, deps, signal, run }) {
  const state = (deps.resolveLauncherRunState ?? resolveLauncherRunState)(env);
  assertVerifyProofCallerShape(args, { authenticatedRole: state.role });
  const wkId = state.role === "orchestrator"
    ? await (deps.resolveCanonicalSubjectWkId ?? resolveCanonicalSubjectWkId)({
      repoRoot, subject: args.subject, gitSha: args.git_sha,
      ...(args.source === undefined ? {} : { source: args.source }),
      ...(args.git_sha === undefined ? {} : { worktreeRoot: (deps.resolveDispatchWorktreeProvisioningConfig ??
        resolveDispatchWorktreeProvisioningConfig)(env)?.worktreeRoot })
    })
    : state.assignedUnit?.split("#")[0];
  if (typeof wkId !== "string") throw Object.assign(new Error(
    "launcher-bound subject has no canonical WK identity"
  ), { code: "verify_proof.subject_unknown.v1" });
  if (state.role !== "orchestrator") {
    let context;
    if (deps.resolveProductionContext !== undefined) {

      context = await deps.resolveProductionContext({ args, repoRoot, env, state, wkId });
    } else {
      const runtime = await resolveManagedRuntimeAuthority({ env, mainRepo: repoRoot, state, wkId });
      run.attempt = resolveVerifyProofRunAttempt(runtime);
      context = await resolveProductionContextFromRuntime({ args, runtime });
    }
    return executeVerifyProofForContext({
      args,
      resolutionContext: context.resolutionContext,
      runtime: context.runtime,
      deps,
      signal
    });
  }
  const result = await (deps.withOrchestratorTestProofRuntime ??
    withOrchestratorTestProofRuntime)({
    mainRepo: repoRoot,
    repository,
    selectedUnit: wkId,
    ...(args.git_sha === undefined ? {} : {
      worktreeRoot: (deps.resolveDispatchWorktreeProvisioningConfig ??
        resolveDispatchWorktreeProvisioningConfig)(env)?.worktreeRoot
    }),
    ...(args.git_sha === undefined ? {} : { gitSha: args.git_sha })
  }, async (runtime) => {
    const context = await resolveProductionContextFromRuntime({ args, runtime });
    return executeVerifyProofForContext({
      args,
      resolutionContext: context.resolutionContext,
      runtime: context.runtime,
      deps,
      signal
    });
  });
  if (result?.schema_version === VERIFY_PROOF_AGGREGATE_SCHEMA_VERSION) return result;
  const resolution = {
    subject: { requested: args.subject, kind: null, canonical_id: null },
    wk_id: wkId,
    contract_generation: null
  };
  return Object.freeze({ ...aggregateResult({
    resolution,
    runtime: null,
    proofResults: [],
    reasonCode: result.reason_code,
    diagnostics: [],
    requestedEnvironment: args.environment ?? null
  }), ...(result.recovery === undefined ? {} : { recovery: result.recovery }) });
}

const EXECUTION_ONLY_ARGUMENTS = Object.freeze(["timeout", "environment", "git_sha"]);

const RESULT_SUBJECT_CHOICE_LIMIT = 50;

function validatedVerifyProofEvidence(result) {
  const evidence = projectPublicVerifyProofAggregate(result);
  assertNoControlledContractRawResponse(evidence, { toolName: VERIFY_PROOF_TOOL_NAME });
  return evidence;
}

function requestedSource(args) {
  return args.source === undefined ? null : { unit: args.source.unit,
    ...(args.source.focus === undefined ? {} : { focus: args.source.focus }) };
}

function answerAdmission(responseEnv, decoration = {}) {
  const inlineByteLimit = activeMcpInlineByteLimit(responseEnv);
  const bound = selectedResponseDeliveryBound(responseEnv);
  const measure = (candidate) => measureMcpInlineResultBytes({ ...candidate, ...decoration });
  return { fits: (candidate) => measure(candidate) <= inlineByteLimit,
    selectedFits: (candidate) => measure(candidate) <= bound };
}

function selectedReadDetail(evidence, subject, responseEnv, decoration) {
  return projectVerifyProofSelectedDetail(evidence, subject,
    { fits: answerAdmission(responseEnv, decoration).selectedFits });
}

function resultBoundCall(repository, locator) {
  return (proofSubject, { recommended = false } = {}) => buildNextCall({
    tool: VERIFY_PROOF_TOOL_NAME, recommended,
    arguments: { repo: repository, subject: proofSubject,
      result: { ref_id: locator.ref_id, sha256: locator.sha256 } } });
}

function sourceResultCall(repository, locator, subject, source) {
  return buildNextCall({ tool: VERIFY_PROOF_TOOL_NAME, recommended: false,
    arguments: { repo: repository, subject, source,
      result: { ref_id: locator.ref_id, sha256: locator.sha256 } } });
}

function sourceRecordedCall(subject, invocationId, source) {
  return buildNextCall({ tool: VERIFY_PROOF_TOOL_NAME, recommended: false,
    arguments: { subject, source, recorded_invocation: { invocation_id: invocationId } } });
}

function publicSourceRefusal(refusal, { readCall = null, selectedSource = null,
  decoration = {}, responseEnv, retentionFailed = false }) {
  return projectPublicVerifyProofRefusal(refusal, { readCall, selectedSource, retentionFailed,
    fits: (candidate) => measureMcpInlineResultBytes({ ...candidate, ...decoration },
      { isError: true }) <= selectedResponseDeliveryBound(responseEnv) });
}

function deliverStandaloneVerification({ evidence, args, repository, jsonContent, responseEnv,
  requestSchema }) {
  let locator;
  try {
    locator = retainSelectedResponseSource({
      binding: { route: VERIFY_PROOF_TOOL_NAME, repository,
        unit: evidence.subject_binding?.wk_id ?? null,
        query_identity: { subject: args.subject, source: requestedSource(args) },
        observation_identity: evidence.result_digest },
      carrier: evidence,
      ownerCall: (retained) => ({ tool: VERIFY_PROOF_TOOL_NAME, arguments: { repo: repository,
        subject: args.subject, result: { ref_id: retained.ref_id, sha256: retained.sha256 } } }),
      ownerRequestSchema: requestSchema
    }, { env: responseEnv });
  } catch (error) {

    const retention = {
      ...describeRetentionFailure(error, { operation: "retain_selected_response_source",
        subject: { route: VERIFY_PROOF_TOOL_NAME, subject: args.subject } }),
      meaning: "this settled result could not be retained, so it cannot be read back by result; " +
        "its outcome above stands"
    };
    const summary = projectVerifyProofSummary(evidence, {
      ...answerAdmission(responseEnv, { result_retention: retention }), selectedSubject: args.subject });
    return jsonContent({ ...summary, result_retention: retention });
  }
  const summary = projectVerifyProofSummary(evidence, {
    ...answerAdmission(responseEnv, { result: locator }),
    detailCall: resultBoundCall(repository, locator),
    selectedSubject: args.subject
  });
  return jsonContent({ ...summary, result: locator });
}

function recordedInvocationCall(subject, invocationId, { recommended = false } = {}) {
  return buildNextCall({ tool: VERIFY_PROOF_TOOL_NAME, recommended,
    arguments: { subject, recorded_invocation: { invocation_id: invocationId } } });
}

function recordedInvocation(subject, invocationId) {
  return { invocation_id: invocationId, detail_call: recordedInvocationCall(subject, invocationId) };
}

function deliverManagedVerification({ evidence, args, run, jsonContent, responseEnv }) {
  const recorded = recordedInvocation(args.subject, run.invocationId);
  const summary = projectVerifyProofSummary(evidence, {
    ...answerAdmission(responseEnv, { recorded_invocation: recorded }),
    detailCall: (proofSubject, options) => recordedInvocationCall(proofSubject, run.invocationId, options),
    selectedSubject: args.subject
  });
  return jsonContent({ ...summary, recorded_invocation: recorded });
}

export const VERIFY_PROOF_RECORDED_READ_REFUSAL_SCHEMA_VERSION = "workspace-verify-proof-recorded-read-refusal.v1";
const RECORDED_READ_INVALID_CODE = "verify_proof.recorded_read_invalid.v1";

function recordedReadRefusal(code, message, { stage, subject, invocationId, facts = {},
  cause = null, correctedCall = null }) {
  const envelope = {
    schema_version: VERIFY_PROOF_RECORDED_READ_REFUSAL_SCHEMA_VERSION,
    code,
    accepted: false,
    operation: "workspace_verify_proof_recorded_invocation_read",
    stage,
    subject,
    invocation_id: invocationId,
    ...facts,
    ...(cause === null ? {} : {
      cause_code: typeof cause?.code === "string" ? cause.code : null,
      cause_message: typeof cause?.message === "string" ? cause.message : null
    }),
    executed: false,
    next_calls: correctedCall === null ? [] : [correctedCall]
  };
  return Object.assign(new Error(message), { code, envelope });
}

async function readRecordedVerification({ args, repoRoot, env, deps, jsonContent, errorContent, responseEnv }) {
  const invocationId = args.recorded_invocation.invocation_id;
  const base = { subject: args.subject, invocationId };
  const corrected = recordedInvocationCall(args.subject, invocationId);
  const mixed = [...EXECUTION_ONLY_ARGUMENTS, "result"].filter((field) => args[field] !== undefined);
  if (mixed.length > 0) {
    throw recordedReadRefusal(RECORDED_READ_INVALID_CODE,
      "a recorded-invocation read takes no execution or result-read argument",
      { ...base, stage: "request_validation", facts: { reason: "mixed_read_mode", arguments: mixed },
        correctedCall: corrected });
  }
  const state = (deps.resolveLauncherRunState ?? resolveLauncherRunState)(env);
  if (state.role !== "worker") {
    throw recordedReadRefusal("verify_proof.role_ineligible.v1",
      "a recorded-invocation read is available only to an authenticated managed worker for its own attempt",
      { ...base, stage: "worker_authentication" });
  }
  let sliceBinding;
  try {
    sliceBinding = authenticateManagedWorkerSliceBinding({ mainRepo: repoRoot, state,
      wkId: state.assignedUnit?.split("#")[0] });
  } catch (error) {
    throw recordedReadRefusal(typeof error?.code === "string" ? error.code
      : "verify_proof.worker_authority_unavailable.v1",
    "the managed worker binding could not be authenticated for this read",
    { ...base, stage: "worker_authentication", cause: error });
  }
  const page = (deps.readManagedProofVerification ?? readManagedProofVerification)({ mainRepo: repoRoot,
    subject: state.assignedUnit, sliceBinding, invocationId });
  if (page?.ok !== true) {
    const code = page?.code ?? page?.refusal?.code ?? "proof_verification_record_unavailable";

    const journal = page?.refusal ?? null;
    throw recordedReadRefusal(code, "the recorded invocation could not be selected in this attempt",
      { ...base, stage: "journal_selection",
        facts: journal?.code === undefined ? {} : { journal_refusal_code: journal.code,
          ...(typeof journal.invocation_id === "string" ? { offending_invocation_id: journal.invocation_id } : {}),
          ...(typeof journal.field === "string" ? { field: journal.field } : {}),
          ...(typeof journal.reason === "string" ? { reason: journal.reason } : {}) } });
  }
  const [item] = page.items;
  const verification = item.verification;
  const recorded = recordedProofVerificationOutcomeSummary(verification);
  if (!recorded.ok) {
    throw recordedReadRefusal(recorded.code, "the recorded invocation is not a current record",
      { ...base, stage: "current_record_validation", facts: { field: recorded.field, reason: recorded.reason } });
  }
  const originalSubject = verification.request?.subject ?? null;
  const originalSource = verification.request?.source ?? null;
  let read;
  try {
    read = readVerifyProofRunRecord({ workspaceDir: repoRoot, verification });
  } catch (error) {
    throw recordedReadRefusal(typeof error?.code === "string" ? error.code : "verify_proof_cache.record_unavailable.v1",
      "the recorded invocation's cached evidence could not be read",
      { ...base, stage: "cached_record_read", cause: error,
        facts: { recorded_outcome: verification.outcome ?? null, recorded_status: verification.status ?? null,
          record_identity: verification.record_identity ?? null } });
  }
  const recordedRead = { ...recordedInvocation(originalSubject, invocationId) };
  const observation = { kind: "retained_prior_observation" };
  const sourceChoices = read.kind === "refusal" ? verifyProofSourceAmbiguityChoices(read.record) : null;
  if (args.source !== undefined && sourceChoices === null &&
      !isDeepStrictEqual(requestedSource(args), originalSource)) {
    throw recordedReadRefusal(RECORDED_READ_INVALID_CODE,
      "source must be the recorded invocation's own request source",
      { ...base, stage: "request_validation", facts: { reason: "source_binding_mismatch" },
        correctedCall: recordedInvocationCall(args.subject, invocationId) });
  }
  if (read.kind === "refusal") {
    if (args.subject !== originalSubject) {
      throw recordedReadRefusal(RECORDED_READ_INVALID_CODE,
        "a recorded refusal holds no proof rows to select",
        { ...base, stage: "subject_selection", facts: { reason: "subject_not_in_result", choices: [], choice_count: 0 },
          correctedCall: recordedInvocationCall(originalSubject, invocationId) });
    }
    if (sourceChoices !== null && args.source !== undefined &&
        selectedVerifyProofSourceChoice(read.record, requestedSource(args)) === null) {
      throw recordedReadRefusal(RECORDED_READ_INVALID_CODE,
        "source is not an exact choice of the recorded ambiguity",
        { ...base, stage: "source_selection", facts: { reason: "source_not_in_result" },
          correctedCall: recordedInvocationCall(originalSubject, invocationId) });
    }
    const decoration = { recorded_invocation: recordedRead, observation };
    return errorContent(Object.assign(new Error("recorded workspace_verify_proof refusal"), {
      code: read.record.code,
      envelope: { ...publicSourceRefusal(read.record, { responseEnv, decoration,
        selectedSource: args.source === undefined || sourceChoices === null ? null : requestedSource(args),
        readCall: (source) => sourceRecordedCall(originalSubject, invocationId, source) }),
        ...decoration } }));
  }
  const evidence = read.record;
  if (args.subject === originalSubject) {
    const summary = projectVerifyProofSummary(evidence, {
      ...answerAdmission(responseEnv, { recorded_invocation: recordedRead, observation }),
      detailCall: (proofSubject, options) => recordedInvocationCall(proofSubject, invocationId, options),
      selectedSubject: args.subject
    });
    return jsonContent({ ...summary, recorded_invocation: recordedRead, observation });
  }
  if (selectVerifyProofRows(evidence, args.subject).length === 0) {
    const choices = resultSubjectChoices(evidence);
    throw recordedReadRefusal(RECORDED_READ_INVALID_CODE,
      "the subject is not a proof or obligation of the recorded invocation",
      { ...base, stage: "subject_selection", facts: { reason: "subject_not_in_result",
        result_digest: evidence.result_digest, choices: choices.slice(0, RESULT_SUBJECT_CHOICE_LIMIT),
        choice_count: choices.length },
      correctedCall: recordedInvocationCall(originalSubject, invocationId) });
  }
  const decoration = { recorded_invocation: recordedRead, observation };
  return jsonContent({ ...selectedReadDetail(evidence, args.subject, responseEnv, decoration), ...decoration });
}

function resultSubjectChoices(evidence) {
  const proofs = evidence.proof_results ?? [];
  return [...new Set([...proofs.map(({ test_proof_id: id }) => id),
    ...proofs.flatMap((proof) => (proof.relationship_results ?? []).map(({ obligation_id: id }) => id))])]
    .sort();
}

function readRetainedVerification({ args, repository, jsonContent, errorContent, responseEnv, env, deps }) {
  const execution = EXECUTION_ONLY_ARGUMENTS.filter((field) => args[field] !== undefined);
  if (execution.length > 0) {
    throw selectedResponseQueryInvalidError(VERIFY_PROOF_TOOL_NAME, "result_read_excludes_execution_arguments",
      { arguments: execution });
  }
  const locator = { ref_id: args.result.ref_id, sha256: args.result.sha256 };
  const envelope = readSelectedResponseSource(locator, { env: responseEnv,
    expected: { route: VERIFY_PROOF_TOOL_NAME, repository } });
  const query = envelope.binding.query_identity ?? {};
  const evidence = envelope.carrier;
  const sourceChoices = verifyProofSourceAmbiguityChoices(evidence);
  if (sourceChoices !== null) {
    const state = (deps.resolveLauncherRunState ?? resolveLauncherRunState)(env);
    if (state.role !== "orchestrator") {
      throw selectedResponseQueryInvalidError(VERIFY_PROOF_TOOL_NAME, "source_read_role_ineligible");
    }
    if (!isDeepStrictEqual(envelope.binding.authority_identity,
      { session_contract: state.sessionContract })) {
      throw selectedResponseQueryInvalidError(VERIFY_PROOF_TOOL_NAME, "source_binding_mismatch",
        { binding_field: "authority_identity" });
    }
  }
  if (args.source !== undefined && sourceChoices === null &&
      !isDeepStrictEqual(requestedSource(args), query.source ?? null)) {
    throw selectedResponseQueryInvalidError(VERIFY_PROOF_TOOL_NAME, "source_binding_mismatch",
      { binding_field: "source" });
  }
  const observation = { kind: "retained_prior_observation" };
  if (sourceChoices !== null) {
    if (args.subject !== query.subject) {
      throw selectedResponseQueryInvalidError(VERIFY_PROOF_TOOL_NAME, "subject_not_in_result",
        { subject: args.subject });
    }
    if (args.source !== undefined &&
        selectedVerifyProofSourceChoice(evidence, requestedSource(args)) === null) {
      throw selectedResponseQueryInvalidError(VERIFY_PROOF_TOOL_NAME, "source_not_in_result",
        { subject: args.subject });
    }
    const decoration = { result: locator, observation };
    return errorContent(Object.assign(new Error("retained workspace_verify_proof refusal"), {
      code: evidence.reason_code,
      envelope: { ...publicSourceRefusal(evidence, { responseEnv, decoration,
      selectedSource: args.source === undefined ? null : requestedSource(args),
      readCall: (source) => sourceResultCall(repository, locator, query.subject, source) }),
      ...decoration } }));
  }
  if (args.subject === query.subject) {
    const summary = projectVerifyProofSummary(evidence, {
      ...answerAdmission(responseEnv, { result: locator, observation }),
      detailCall: resultBoundCall(repository, locator),
      selectedSubject: args.subject
    });
    return jsonContent({ ...summary, result: locator, observation });
  }
  if (selectVerifyProofRows(evidence, args.subject).length === 0) {
    const choices = resultSubjectChoices(evidence);
    throw selectedResponseQueryInvalidError(VERIFY_PROOF_TOOL_NAME, "subject_not_in_result", {
      subject: args.subject, result_digest: evidence.result_digest,
      choices: choices.slice(0, RESULT_SUBJECT_CHOICE_LIMIT), choice_count: choices.length });
  }
  const decoration = { result: locator, observation };
  return jsonContent({ ...selectedReadDetail(evidence, args.subject, responseEnv, decoration), ...decoration });
}

function deliveryFailure(result, error) {
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

const VERIFY_PROOF_DESCRIPTION = "Execute existing saved proofs selected by one subject per call, using installed providers, with timeout and cancellation support. subject selects proofs, not code: orchestrators run the configured current checkout, dirty state included, unless git_sha selects an exact commit; workers and reviewers run their launcher-bound checkout. Each proof is proven, unproven or not_executable for its tested source. A passing test with unavailable mutation remains proven when every other required check holds; mutation limits and incomplete evidence are reported. A canonical work-record ID or slice address selects that unit's saved proof population; a saved test_proof_id or obligation_id narrows verification to that subject. When the ID has several sources, supply the intended source {unit, focus?} on execution, or inspect up to three source identities in the ambiguity refusal. Use the emitted result or recorded_invocation read with an exact source tuple to inspect any retained choice; that read returns its original execution call without executing it. Failed proofs carry selected error and authoring facts. Root next_calls separates owner-supplied authoring queries from result or recorded_invocation reads. result:{ref_id,sha256} from an earlier answer reads that settled result instead of executing. Advisory results.";
const VERIFY_PROOF_SOURCE_DESCRIPTION =
  "Optional for a saved test_proof_id or obligation_id; refused with a WK or slice subject. " +
  "Selects exactly one saved proof source: unit is the source's WK ID or slice address and focus is " +
  "its controlled-contract focus. Omitted focus selects the root source. The subject must exist in " +
  "that source; no other source is searched. Alongside result or recorded_invocation, it inspects " +
  "one exact tuple of a retained source ambiguity without executing. Other reads keep their original " +
  "source binding. Selection grants no execution authority.";
const VERIFY_PROOF_ENVIRONMENT_DESCRIPTION =
  "Optional. Names one prepared environment that local test-runtime setup published, as " +
  "<ecosystem>@<repository-relative installation root> (for example \"npm@.\", \"go_modules@services/api\" " +
  "or \"python@tools/lint\"); setup's readiness report lists every environment with its workspace members " +
  "and proved runners. Omitted, each selected test routes independently: its saved runner binding names the " +
  "dependency ecosystem, the target suffix is recorded as a language hint, and the environment whose " +
  "installation root owns the target runs it, so one call may use several environments and languages. " +
  "Named, it must serve every selected proof (same ecosystem, runner proved there, target inside it) or the " +
  "call refuses before anything executes and lists each incompatible target and the valid choices; nothing is " +
  "filtered out. It is an identity only, never a command, path, variable, root or mount, and grants no " +
  "visibility, source or preparation.";
const VERIFY_PROOF_SOURCE_UNIT_DESCRIPTION =
  "The saved proof source's canonical WK ID (\"WK-1234\") or slice address (\"WK-1234#SLICE-001\").";

export function registerVerifyProofTool({
  registerTool,
  workspaceRepos,
  z,
  jsonContent,
  errorContent,
  resolveWorkspaceRepo,
  env = process.env,
  responseEnv = process.env,
  deps = {}
}) {
  const resultSchema = z.object({
    ref_id: z.string().regex(/^[A-Za-z0-9._-]{1,200}$/u),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u)
  }).strict();

  const resultReadRequestSchema = selectedResponseRequestSchema(z.object({
    repo: z.string().optional(),
    subject: z.string().min(1).max(512),
    result: resultSchema,
    source: z.object({ unit: proofAuthoringUnitInputSchema(z),
      focus: proofAuthoringFocusInputSchema(z).optional() }).strict().optional()
  }).strict());
  registerTool(VERIFY_PROOF_TOOL_NAME, {
    writeSemantics: MCP_WRITE_SEMANTICS.NONE,
    description: VERIFY_PROOF_DESCRIPTION,
    inputSchema: z.object({
      subject: z.string().min(1).max(512).describe(
        "Exactly one saved proof subject: a canonical WK ID (\"WK-1234\") or slice address " +
        "(\"WK-1234#SLICE-001\") selects that unit's saved proof population; a saved test_proof_id " +
        "(\"test-proof-00170a30e83e042b20d409d42a2bb49cd3da7cda\") or obligation_id (\"ANON-BOUNDS\") " +
        "narrows verification to that subject. " +
        "Unknown or ambiguous subjects refuse without executing."
      ),
      source: z.object({
        unit: proofAuthoringUnitInputSchema(z).describe(VERIFY_PROOF_SOURCE_UNIT_DESCRIPTION),
        focus: proofAuthoringFocusInputSchema(z).optional()
      }).strict().optional().describe(VERIFY_PROOF_SOURCE_DESCRIPTION),
      repo: z.string().optional(),
      timeout: verifyProofTimeoutInputSchema(z),
      environment: z.string().min(3).max(512).regex(TEST_RUNTIME_ENVIRONMENT_ID_RE).optional()
        .describe(VERIFY_PROOF_ENVIRONMENT_DESCRIPTION),
      git_sha: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u).optional().describe(
        "Orchestrator only: execute this exact full commit. Omitted: configured current checkout, " +
        "not the WK delivery."),
      result: resultSchema.optional().describe(
        "Read-only. The result locator an earlier answer returned; reads that settled result and " +
        "selects subject within it without executing anything."),
      recorded_invocation: z.object({ invocation_id: z.string().min(1).max(200) }).strict().optional()
        .describe("Read-only. A managed worker's own recorded invocation, from an earlier answer's " +
          "recorded_invocation or failure next call; selects subject within it without executing anything.")
    }).strict()
  }, async (args, extra = undefined) => {
    if (args.recorded_invocation !== undefined) {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        return await readRecordedVerification({ args, repoRoot: realpathSync(path.resolve(workspace.dir)),
          env, deps, jsonContent, errorContent, responseEnv });
      } catch (error) {
        return errorContent(error);
      }
    }
    if (args.result !== undefined) {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        return readRetainedVerification({ args, repository: workspace.repo, jsonContent,
          errorContent, responseEnv, env, deps });
      } catch (error) {
        return errorContent(error);
      }
    }

    const signal = extra?.signal instanceof AbortSignal ? extra.signal : null;
    if (signal?.aborted) {
      return errorContent(Object.assign(new Error(
        "workspace_verify_proof request was cancelled before any proof work started"
      ), { code: "verify_proof.execution_cancelled_before_start.v1" }));
    }

    const run = { attempt: null, invocationId: mintVerifyProofInvocationId() };

    const request = { subject: args.subject, timeout: args.timeout ?? null,
      ...(args.environment === undefined ? {} : { environment: args.environment }),
      ...(args.source === undefined ? {} : { source: {
        unit: args.source.unit, ...(args.source.focus === undefined ? {} : { focus: args.source.focus })
      } }) };
    const recordRun = (kind, record) => run.attempt === null ? null : recordVerifyProofRunResult({
      attempt: run.attempt, invocationId: run.invocationId, request, kind, record, env: responseEnv });
    let result;
    let workspace;

    const timing = startTestProofInvocationTiming();
    try {
      workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
      result = await executeProductionVerifyProof({
        args,
        env,
        repoRoot: realpathSync(path.resolve(workspace.dir)),
        repository: workspace.repo,
        deps,
        signal,
        run
      });
      timing.stop();
      result = withVerifyProofInvocationTiming(result, timing.seal(result));
    } catch (error) {
      timing.stop();
      const envelope = projectVerifyProofFailure(error, { subject: args.subject, request: args,
        timing: timing.seal() });
      if (envelope === null) return errorContent(error);

      let recordedRefusal = null;
      let retention = null;
      let ambiguityLocator = null;
      const sourceChoices = verifyProofSourceAmbiguityChoices(envelope);
      if (run.attempt === null) {
        try {
          if (sourceChoices === null) {
            retainOperatorOnlyEvidence(envelope, { env: responseEnv });
          } else {
            const state = (deps.resolveLauncherRunState ?? resolveLauncherRunState)(env);
            if (state.role !== "orchestrator") {
              throw selectedResponseQueryInvalidError(VERIFY_PROOF_TOOL_NAME,
                "source_read_role_ineligible");
            }
            ambiguityLocator = retainSelectedResponseSource({
              binding: { route: VERIFY_PROOF_TOOL_NAME, repository: workspace.repo,
                unit: null, query_identity: { subject: args.subject, source: requestedSource(args) },
                observation_identity: envelope.reason_code,
                authority_identity: { session_contract: state.sessionContract } },
              carrier: envelope,
              ownerCall: (retained) => ({ tool: VERIFY_PROOF_TOOL_NAME,
                arguments: { repo: workspace.repo, subject: args.subject,
                  result: { ref_id: retained.ref_id, sha256: retained.sha256 } } }),
              ownerRequestSchema: resultReadRequestSchema
            }, { env: responseEnv });
          }
        } catch (retentionError) {
          retention = describeRetentionFailure(retentionError, {
            operation: sourceChoices === null ? "retain_operator_only_evidence"
              : "retain_selected_response_source",
            subject: { route: VERIFY_PROOF_TOOL_NAME, subject: args.subject, evidence: "refusal" } });
        }
      } else {
        try {
          recordedRefusal = await recordRun("refusal", envelope);
        } catch (recordingError) {
          return errorContent(recordingError);
        }
      }

      const decoration = {
        ...(ambiguityLocator === null ? {} : { result: ambiguityLocator }),
        ...(recordedRefusal === null ? {} : {
          recorded_invocation: recordedInvocation(args.subject, run.invocationId) }),
        ...(retention === null ? {} : { original_retention: retention }) };
      const delivered = { ...publicSourceRefusal(envelope, { responseEnv, decoration,
        retentionFailed: sourceChoices !== null && retention !== null,
        readCall: sourceChoices === null || retention !== null ? null : run.attempt === null
          ? (source) => sourceResultCall(workspace.repo, ambiguityLocator, args.subject, source)
          : (source) => sourceRecordedCall(args.subject, run.invocationId, source) }),
        ...decoration };
      const projected = Object.assign(new Error(
        "workspace_verify_proof refused a modeled proof failure"
      ), { code: envelope.code, envelope: delivered });
      return errorContent(projected);
    }
    let evidence;
    try {
      evidence = validatedVerifyProofEvidence(result);
    } catch (error) {
      return errorContent(error);
    }
    try {
      await recordRun("aggregate", evidence);
    } catch (recordingError) {
      return errorContent(recordingError);
    }
    try {
      return run.attempt === null
        ? deliverStandaloneVerification({ evidence, args, repository: workspace.repo, jsonContent,
          responseEnv, requestSchema: resultReadRequestSchema })
        : deliverManagedVerification({ evidence, args, run, jsonContent, responseEnv });
    } catch (error) {
      return errorContent(deliveryFailure(result, error));
    }
  });
}
