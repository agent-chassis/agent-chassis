import { realpathSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { verifyProofTimeoutInputSchema } from "../../../wiki-core/src/operations/controlled-contract/verify-proof-operations.mjs";
import { proofAuthoringFocusInputSchema, proofAuthoringUnitInputSchema } from "./proof-authoring-input-schema.mjs";
import { managedTestAuthorityIdentity, managedTestAuthorityAuthenticated } from "./managed-test-source-context.mjs";
import { activeMcpInlineByteLimit, measureMcpInlineResultBytes, selectedFullContent } from "./mcp-response.mjs";
import { resolveLauncherRunState, resolveAuthenticatedFindingsSource } from "./launcher-run-credential.mjs";
import { MCP_WRITE_SEMANTICS } from "./register-tool.mjs";
import { readSelectedResponseSource, selectedResponseLocatorSchema, selectedResponseQueryInvalidError,
  selectedResponseRequestSchema } from "./selected-response-snapshot.mjs";
import { VERIFY_PROOF_TOOL_NAME, verifyProofSourceAmbiguityChoices } from "./verify-proof-public-result.mjs";
import { readVerifyProofOriginal, requestedVerifyProofSource as requestedSource } from "./verify-proof-result-reader.mjs";
import { authenticateManagedWorkerSliceBinding } from "./verify-proof-candidate-context.mjs";
import { readManagedProofVerification } from "../../../agent-launch-cli/src/lib/managed-run-process-identity-store.mjs";
import { recordedProofVerificationOutcomeSummary } from "../../../agent-launch-core/src/lib/managed-run-observation.mjs";
import { readVerifyProofRunRecord } from "./verify-proof-run-record-reader.mjs";
import { TEST_RUNTIME_ENVIRONMENT_ID_RE } from "@agent-chassis/controlled-contract/test-proof";
export { executeVerifyProofForContext, projectDefinitionRepairQuestion } from "./verify-proof-execution.mjs";

import { createVerifyProofExecutionHandler } from "./verify-proof-execution-handler.mjs";
import { shippedVerifyProofCalls, recordedInvocation } from "./verify-proof-delivery.mjs";
const EXECUTION_ONLY_ARGUMENTS = Object.freeze(["timeout", "environment", "git_sha"]);
const recordedInvocationCall = shippedVerifyProofCalls.recorded;

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

export async function readRecordedVerification({ args, repoRoot, env, deps, jsonContent, errorContent, responseEnv,
  originalSelection = false, proofSelection = undefined, readCalls = null, completeDelivery = false }) {
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
    read = readVerifyProofRunRecord({ workspaceDir: repoRoot, verification, includeVerifiedSource: completeDelivery });
  } catch (error) {
    throw recordedReadRefusal(typeof error?.code === "string" ? error.code : "verify_proof_cache.record_unavailable.v1",
      "the recorded invocation's cached evidence could not be read",
      { ...base, stage: "cached_record_read", cause: error,
        facts: { recorded_outcome: verification.outcome ?? null, recorded_status: verification.status ?? null,
          record_identity: verification.record_identity ?? null } });
  }
  const original = { kind: read.kind, record: read.record, subject: originalSubject, source: originalSource };
  const calls = readCalls === null ? shippedVerifyProofCalls : readCalls(original);
  const decoration = { recorded_invocation: readCalls === null ? recordedInvocation(originalSubject, invocationId, calls)
    : { invocation_id: invocationId, detail_call: calls.original() },
    observation: { kind: "retained_prior_observation" } };
  const answer = readVerifyProofOriginal({
    original: { ...original, record: calls.evidence === undefined ? original.record
      : await calls.evidence(original.record) },
    request: { ...(originalSelection ? { subject: originalSubject, source: originalSource }
      : { subject: args.subject, source: requestedSource(args) }), ...proofSelection },
    decoration,
    responseEnv,
    selectedSubject: proofSelection?.subject !== undefined,
    calls: { execution: calls.execution, detail: (proofSubject, options) => calls.recorded(proofSubject, invocationId, options),
      source: (source) => calls.sourceRecorded(originalSubject, invocationId, source) },
    refuse: (reason, { held, selection }) => {
      const original = readCalls === null ? calls.recorded(originalSubject, invocationId) : calls.original();
      if (reason === "source_binding_mismatch") {
        return recordedReadRefusal(RECORDED_READ_INVALID_CODE,
          "source must be the recorded invocation's own request source",
          { ...base, stage: "request_validation", facts: { reason },
            correctedCall: originalSelection ? original : corrected });
      }
      if (reason === "source_not_in_result") {
        return recordedReadRefusal(RECORDED_READ_INVALID_CODE,
          "source is not an exact choice of the recorded ambiguity",
          { ...base, stage: "source_selection", facts: { reason }, correctedCall: original });
      }
      return recordedReadRefusal(RECORDED_READ_INVALID_CODE, held === "refusal"
        ? "a recorded refusal holds no proof rows to select"
        : "the subject is not a proof or obligation of the recorded invocation",
      { ...base, subject: proofSelection?.subject ?? args.subject, stage: "subject_selection",
        facts: { reason, ...(selection ?? { choices: [], choice_count: 0 }) }, correctedCall: original });
    }
  });
  const value = answer.kind === "refusal" ? answer.envelope : answer.value;
  if (completeDelivery && measureMcpInlineResultBytes(value, { isError: answer.kind === "refusal" }) > activeMcpInlineByteLimit(responseEnv)) {
    const result = selectedFullContent({ source: read.source, serializedBytes: read.serializedBytes, projection: value });
    if (answer.kind === "refusal") result.isError = true;
    return result;
  }
  if (answer.kind !== "refusal") return jsonContent(answer.value);
  return errorContent(Object.assign(new Error("recorded workspace_verify_proof refusal"), {
    code: read.record.code, envelope: answer.envelope }));
}

export function readRetainedVerification({ args, repository, jsonContent, errorContent, responseEnv, env, deps,
  proofSelection = undefined, readCalls = null }) {
  const execution = EXECUTION_ONLY_ARGUMENTS.filter((field) => args[field] !== undefined);
  if (execution.length > 0) {
    throw selectedResponseQueryInvalidError(VERIFY_PROOF_TOOL_NAME, "result_read_excludes_execution_arguments",
      { arguments: execution });
  }
  const locator = { ref_id: args.result.ref_id };
  const envelope = readSelectedResponseSource(locator, { env: responseEnv,
    expected: { route: VERIFY_PROOF_TOOL_NAME, repository } });
  const query = envelope.binding.query_identity ?? {};
  const evidence = envelope.carrier;
  const state = (deps.resolveLauncherRunState ?? resolveLauncherRunState)(env);
  if (state.role === "reviewer") {
    resolveAuthenticatedFindingsSource(env);
    const identity = managedTestAuthorityIdentity(state);
    if (!managedTestAuthorityAuthenticated(identity) ||
        !isDeepStrictEqual(envelope.binding.authority_identity, identity)) {
      throw selectedResponseQueryInvalidError(VERIFY_PROOF_TOOL_NAME, "source_binding_mismatch",
        { binding_field: "authority_identity" });
    }
  }
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
  const original = { kind: sourceChoices === null ? "aggregate" : "refusal", record: evidence,
    subject: query.subject, source: query.source ?? null };
  const calls = readCalls === null ? shippedVerifyProofCalls : readCalls(original);
  const present = (record) => {
    const answer = readVerifyProofOriginal({
      original: { ...original, record },
      request: { subject: args.subject, source: requestedSource(args), ...proofSelection },
      decoration: { result: locator, observation: { kind: "retained_prior_observation" } },
      responseEnv,
      selectedSubject: proofSelection?.subject !== undefined,
      calls: { execution: calls.execution, detail: (subject, options) => calls.retained(repository, locator, subject, options),
        source: (source) => calls.sourceRetained(repository, locator, query.subject, source) },
      refuse: (reason, { selection }) => {
        const error = selectedResponseQueryInvalidError(VERIFY_PROOF_TOOL_NAME, reason,
          reason === "source_binding_mismatch" ? { binding_field: "source" }
            : { subject: proofSelection?.subject ?? args.subject, ...(selection ?? {}) });

        if (readCalls !== null) error.next_calls = [calls.original()];
        return error;
      }
    });
    if (answer.kind !== "refusal") return jsonContent(answer.value);
    return errorContent(Object.assign(new Error("retained workspace_verify_proof refusal"), {
      code: evidence.reason_code, envelope: answer.envelope }));
  };

  return readCalls === null || calls.evidence === undefined ? present(original.record)
    : (async () => present(await calls.evidence(original.record)))();
}

const VERIFY_PROOF_DESCRIPTION = "Execute existing saved proofs selected by one subject per call, using installed providers, with timeout and cancellation support. subject selects proofs, not code: orchestrators run the configured current checkout, dirty state included, unless git_sha selects an exact commit; workers and reviewers run their launcher-bound checkout. Each proof is proven, unproven or not_executable for its tested source. Selected-test outcomes and the exact execution evaluation are preserved, including without mutation support. Execution validity alone grants no requirement-satisfaction credit: behavioral coverage not established is unproven; mutation limits and incomplete evidence remain distinct. A canonical work-record ID or slice address selects that unit's saved proof population; a saved test_proof_id or obligation_id narrows verification to that subject. When the ID has several sources, supply the intended source {unit, focus?} on execution, or inspect up to three source identities in the ambiguity refusal. Use the emitted result or recorded_invocation read with an exact source tuple to inspect any retained choice; that read returns its original execution call without executing it. Failed proofs carry selected error and authoring facts. Root next_calls separates owner-supplied authoring queries from result or recorded_invocation reads. result:{ref_id} from an earlier answer reads that settled result instead of executing. Advisory results.";
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

export function verifyProofRecordedInvocationInputSchema(z) {
  return z.object({ invocation_id: z.string().min(1).max(200) }).strict();
}

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
  const resultSchema = selectedResponseLocatorSchema(z);

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
      recorded_invocation: verifyProofRecordedInvocationInputSchema(z).optional()
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
        return await readRetainedVerification({ args, repository: workspace.repo, jsonContent,
          errorContent, responseEnv, env, deps });
      } catch (error) {
        return errorContent(error);
      }
    }
    return createVerifyProofExecutionHandler({
      resolveWorkspace: (request) => resolveWorkspaceRepo(workspaceRepos, request.repo),
      env, responseEnv, deps, jsonContent, errorContent, requestSchema: resultReadRequestSchema
    })(args, extra);
  });
}
