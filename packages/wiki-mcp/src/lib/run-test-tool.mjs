

import path from "node:path";

import { mintTestProofExecutionBudget } from
  "../../../agent-launch-cli/src/lib/test-execution/confined-capture.mjs";
import { runOrdinaryTestWithComparison } from "../../../agent-launch-cli/src/lib/test-execution/ordinary-run.mjs";
import { runOrdinaryTest } from "../../../agent-launch-cli/src/lib/test-execution/ordinary-test-glob.mjs";
import { ordinaryRequestCorrection } from
  "../../../agent-launch-cli/src/lib/test-execution/ordinary-test-runner.mjs";
import { resolveLauncherRunState } from "./launcher-run-credential.mjs";
import { withAuthenticatedTestExecution } from "../../../agent-launch-cli/src/lib/test-execution/authenticated-execution-context.mjs";
import { resolveWorkerRepositoryCommand, checkRepositoryCommandDefinitions } from './managed-test-command-context.mjs';
import { MANAGED_ASSIGNMENT_READ_REFUSAL_CODES } from '../../../agent-launch-cli/src/lib/managed-assignment-read-artifact.mjs';
import { projectAssignmentChangeRecoveryForCaller } from './verify-proof-source-repair-recovery.mjs';
import { buildNextCall } from '@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs';
import { registeredToolRequestContracts } from './registered-tool-request-contracts.mjs';
import { fitsRunTestResponse } from './run-test-format.mjs';
import { MANAGED_TEST_SOURCE_CODES, managedTestAuthorityIdentity, observeRuntimeAfterRun,
  resolveManagedTestSource } from "./managed-test-source-context.mjs";
import { MCP_WRITE_SEMANTICS, projectToolInputValidationFailure } from "./register-tool.mjs";
import { RUN_TEST_INPUT_CODES, RUN_TEST_TOOL_NAME, applyRunTestRetry, parseRunTestRequest,
  runTestInputSchema, runTestReadCorrection, runTestRequestSeed, runTestUnavailableInputs } from "./run-test-input.mjs";
import { RUN_TEST_RETAINED_KINDS, presentRunTestAnswer, presentRunTestDetailRefusal, presentRunTestFailure,
  presentRunTestRead, presentRunTestRefusal, presentRunTestInputFailure, runTestCarrier, runTestExpectedBinding, runTestReadCall,
  runTestRefusalClipped, runTestRetentionFailure, runTestRetryCall, runTestViewSelection, runTestEnvironmentSelection } from
  "./run-test-result.mjs";
import { readSelectedResponseSource, retainSelectedResponseSource, selectedResponseRequestSchema } from
  "./selected-response-snapshot.mjs";
import { runTestSemanticReadCall } from './run-test-carrier.mjs';

export const RUN_TEST_DESCRIPTION = "Run one permitted repository command when your assignment authorizes execution. " +
  "Workers use frozen {entrypoint,selection?,timeout?}; omit selection only for an authored default. " +
  "A typo returns permitted choices; a genuinely missing command uses request_assignment_change. " +
  "Orchestrators/reviewers use literal harness:{cwd,argv}, optional environment/timeout; orchestrators additionally " +
  "name source {kind:\"current_main\"}, {kind:\"exact_sha\",value} or {kind:\"branch\",value}. " +
  "Workers/reviewers use bound source. No worker executable overrides, shell parsing, inferred counts or proof credit. " +
  "Eligible nonzero exits compare the same request once on the authorized baseline, sharing the budget. " +
  "Responses are limited to 1 KiB (1,024 UTF-8 bytes) total. Captured stdout/stderr share that ceiling and may be clipped. " +
  "A pass finishes this check; optional detail is not required. A failure leads with its cause; follow a returned " +
  "diagnosis only if needed. Reads execute nothing. retry explicitly executes a corrected request using a refusal's " +
  "correction seed, never a native-result handle. Oversized structured diagnosis or environment choices use the returned " +
  "authenticated get_run_result call; it exposes no raw streams. Saved proofs use verify_proof.";

const EXECUTION_ROLES = Object.freeze(["orchestrator", "reviewer", "worker"]);
const CODES = Object.freeze({

  CANCELLED_BEFORE_START: "run_test.cancelled_before_start.v1",
  EXECUTION_FAILED: "run_test.execution_failed.v1",
  SESSION_UNAVAILABLE: "run_test.session_unavailable.v1"
});

function nativeCorrection(requested) {
  return { changeable: requested.fields.join(", "),
    ...(requested.set === undefined ? {} : { set: `retry.changes.${requested.set}`,
      ...(typeof requested.rejected === "string" ? { rejected: requested.rejected } : {}),
      choices: requested.choices.length === 0 ? "none" : requested.choices.join(", ") }) };
}

const NO_REQUEST_CORRECTION = Object.freeze({ changeable: "none" });

function refusal(payload) {
  return Object.assign(new Error(payload.message ?? payload.code), { code: payload.code, envelope: payload });
}

function environmentRecoveryEvidence({ command, selection, caller }) {
  return [{ description: `${command.entrypoint}/${command.selection}: ${selection.reason}`,
    references: [caller.state.assignedUnit] }];
}

export async function runOrdinaryTestAndObserve({ runRequest, expansion = [], request, runFile = runOrdinaryTest,
  observeRuntime = observeRuntimeAfterRun }) {
  const result = await runFile(runRequest, ...expansion);
  let observed;
  try {
    observed = await observeRuntime({ repositoryRoot: runRequest.repositoryRoot,
      checkoutRoot: runRequest.checkoutRoot, request, result });
  } catch (error) {
    observed = { status: 'unknown', code: error.code ?? error.name, cause: error.message,
      detail: error.detail ?? null };
  }
  return Object.freeze({ ...result, runtime_after_run: observed });
}

export function createRunTestResultReader({ z, inputSchema = runTestInputSchema(z), jsonContent,
  errorContent, responseEnv = process.env, refreshEnvironmentRecovery = null,
  refreshAssignmentChangeRecovery = null, sessionEnv = process.env, requestContracts = null, completeReadCall = null }) {

  const modeRequestSchema = (mode) => selectedResponseRequestSchema(inputSchema.innerType()
    .pick({ [mode]: true }));
  const refuse = (payload) => errorContent(refusal(payload));
  const expected = (kind, { workspace, state }) => runTestExpectedBinding({ kind, repository: workspace.repo,
    authorityIdentity: managedTestAuthorityIdentity(state) });
  const refreshAssignment = refreshAssignmentChangeRecovery ?? (({ evidence, caller }) =>
    projectAssignmentChangeRecoveryForCaller({ workspace: caller.workspace, state: caller.state,
      sessionEnv, requestContracts, evidence }));
  const refreshEnvironment = refreshEnvironmentRecovery ?? (context => refreshAssignment({ caller: context.caller,
    evidence: environmentRecoveryEvidence(context) }));

  const read = async ({ result, view, failure = null }, caller, { completeSemantic = false } = {}) => {
    try {
      const envelope = readSelectedResponseSource(result, { env: responseEnv,
        expected: expected(RUN_TEST_RETAINED_KINDS.NATIVE_RESULT, caller) });
      const command = envelope.carrier.failure?.assigned_command;
      const selection = envelope.carrier.failure?.environment_selection;
      const priorRecovery = envelope.carrier.failure?.recovery == null ? null : JSON.parse(envelope.carrier.failure.recovery);

      const environmentRecovery = view === "failure" && command !== undefined && selection !== undefined
        ? await refreshEnvironment({ command, selection, caller }) : null;
      const assignmentChangeRecovery = view === 'failure' && priorRecovery?.assignment_change !== undefined
        ? await refreshAssignment({ evidence: priorRecovery.assignment_change.known_arguments.evidence, caller }) : null;
      return jsonContent(presentRunTestRead({ view, failure, carrier: envelope.carrier, locator: result,
        environmentRecovery, assignmentChangeRecovery, completeSemantic, completeCall: completeSemantic || completeReadCall === null
          ? null : await completeReadCall(result, view, failure) }));
    } catch (error) {
      if (error?.envelope === undefined) throw error;
      return refuse(presentRunTestDetailRefusal(error));
    }
  };

  const retain = (carrier, caller, commit = null) => retainSelectedResponseSource({
    binding: { ...expected(RUN_TEST_RETAINED_KINDS.NATIVE_RESULT, caller), observation_identity: commit },
    carrier,
    ownerCall: (retained) => runTestReadCall(retained, "outcome"),
    ownerRequestSchema: modeRequestSchema("read")
  }, { env: responseEnv });

  return Object.freeze({ modeRequestSchema, expected, read, retain });
}

export function registerRunTestTool({
  registerTool,
  z,
  jsonContent,
  errorContent,
  workspaceRepos,
  resolveWorkspaceRepo,
  env = process.env,
  responseEnv = process.env,
  requestContracts = registeredToolRequestContracts(registerTool),
  deps = {}
}) {
  const inputSchema = runTestInputSchema(z, { role: env.WIKI_MCP_TOOL_PROFILE ?? null });
  const completeReadCall = async (locator, view, failure = null) => {
    const call = runTestSemanticReadCall(locator, view, failure);
    const contract = requestContracts?.contractFor(call.tool);
    return contract != null && await contract.acceptsArguments(call.arguments) ? call : null;
  };
  const refreshAssignmentChangeRecovery = ({ evidence, caller }) => projectAssignmentChangeRecoveryForCaller({
    workspace: caller.workspace, state: caller.state, sessionEnv: env, requestContracts, evidence });
  const refreshEnvironmentRecovery = context => refreshAssignmentChangeRecovery({ caller: context.caller,
    evidence: environmentRecoveryEvidence(context) });
  const { modeRequestSchema, expected, read, retain: retainOriginal } = createRunTestResultReader({
    z, inputSchema, jsonContent, errorContent, responseEnv, refreshEnvironmentRecovery, refreshAssignmentChangeRecovery, completeReadCall });
  const refuse = (payload) => errorContent(refusal(payload));
  const fail = (error, stage) => refuse(presentRunTestFailure(error, { code: CODES.EXECUTION_FAILED, stage }));

  const runState = () => {
    try {
      return { state: (deps.resolveLauncherRunState ?? resolveLauncherRunState)(env) };
    } catch (error) {
      return { error: refuse(presentRunTestRefusal({ code: typeof error?.code === "string" ? error.code
        : CODES.SESSION_UNAVAILABLE, message: String(error?.message ?? error),
      facts: { executed: false, stage: "session_authentication" } })) };
    }
  };

  const inputFailure = async (args, validationError) => {
    const correction = runTestReadCorrection(args, inputSchema);
    const projected = await projectToolInputValidationFailure({ tool: RUN_TEST_TOOL_NAME, args, validationError,
      inputSchema, ownerGuidance: runTestUnavailableInputs(validationError, env.WIKI_MCP_TOOL_PROFILE) });
    const diagnosis = { ...projected, code: RUN_TEST_INPUT_CODES.INVALID, executed: false,
      ...(correction.requiredChoice === undefined ? {} : { required_choice: correction.requiredChoice }),
      next_calls: correction.read === undefined ? [] : [runTestReadCall(correction.read.result,
        correction.read.view, 'correct_read_shape', correction.read.failure ?? null)] };
    if (fitsRunTestResponse(diagnosis, true)) return refuse(diagnosis);
    const { state, error } = runState();
    if (error !== undefined) return refuse(presentRunTestInputFailure(diagnosis, {
      unavailable: { reason: 'authenticated_session_unavailable' } }));
    const caller = { workspace: resolveWorkspaceRepo(workspaceRepos), state };
    try {
      const locator = retainOriginal(runTestCarrier({ request: { timeout: { milliseconds: null } },
        failure: { stage: 'request_validation', code: RUN_TEST_INPUT_CODES.INVALID,
          input_validation: diagnosis } }), caller);
      return refuse(presentRunTestInputFailure(diagnosis, { completeCall: await completeReadCall(locator, 'failure') }));
    } catch (error) {
      if (error?.envelope === undefined && error?.code === undefined) throw error;
      return refuse(presentRunTestInputFailure(diagnosis, { unavailable: runTestRetentionFailure(error,
        { operation: 'retain_input_diagnosis', subject: 'rejected request', capability: 'complete_diagnosis' }) }));
    }
  };

  const retainSeed = (args, caller) => {
    try {
      return { seed: retainSelectedResponseSource({
        binding: { ...expected(RUN_TEST_RETAINED_KINDS.CORRECTION_SEED, caller), observation_identity: null },
        carrier: { request: runTestRequestSeed(args) },
        ownerCall: (retained) => runTestRetryCall(retained),
        ownerRequestSchema: modeRequestSchema("retry")
      }, { env: responseEnv }) };
    } catch (error) {
      return { failure: runTestRetentionFailure(error, { operation: "retain_correction_seed",
        subject: "original request", capability: "correction_seed" }) };
    }
  };

  const refuseCorrectable = ({ code, message, facts, correction, corrections, args, caller }) => {
    const { seed, failure } = retainSeed(args, caller);
    if (failure !== undefined) {
      const { retained: _retained, repair_call: repairCall, ...unavailable } = failure;
      return refuse(presentRunTestRefusal({ code, facts: { executed: false, ...facts, correction_seed: "unavailable",
        uncertainty: "retention_state_unknown", repair_call: repairCall, ...unavailable },
      message: `${message}; the correction could not be retained, and no repair call exists: after its owner ` +
        `restores retention, resubmit the original request ${correction}` }));
    }
    return refuse(presentRunTestRefusal({ code, message, facts: { executed: false, ...facts },
      nextCalls: corrections(seed) }));
  };

  const refuseWithCause = async (error, { stage, request, source = null, caller }) => {
    const offered = Array.isArray(error?.next_calls) ? error.next_calls : [];
    const template = error.detail?.recovery?.assignment_change;
    const testimony = error.detail?.recovery?.assignment_change === undefined ?
      error.detail?.recovery?.missing_capability === undefined ? {} : {
      stopping_condition: `Assignment correction is unavailable: ${error.detail.recovery.missing_capability}.`,
      ...(error.detail.recovery.cause_code === undefined ? {} : { recovery_cause_code: error.detail.recovery.cause_code })
    } : {};
    const options = { code: stage === 'command_authorization' && typeof error?.code === 'string'
      ? error.code : CODES.EXECUTION_FAILED, stage, nextCalls: offered,
      detail: error.detail?.recovery?.cause === undefined ? {} : { recovery_cause: error.detail.recovery.cause },
      facts: { ...(stage === 'command_authorization' ? { executed: false } : {}), ...testimony } };
    const bounded = presentRunTestFailure(error, options);

    const withTemplate = template === undefined ? bounded : { ...bounded, recovery: error.detail.recovery };
    const templateFits = fitsRunTestResponse(withTemplate, true);
    if (!runTestRefusalClipped(bounded) && templateFits) return refuse(withTemplate);
    let locator;
    try {
      locator = retainOriginal(runTestCarrier({ request, source, failure: { stage,
        code: bounded.code, message: String(error?.message ?? error),
        cause_code: typeof error?.code === "string" ? error.code : null,
        detail: error?.detail ?? error?.envelope ?? null,
        ...(offered.length === 0 && error.detail?.recovery === undefined ? {} : {
          recovery: { ...error.detail?.recovery, next_calls: offered } }) } }), caller, source?.commit ?? null);
    } catch (retentionError) {
      const { retained: _retained, ...unavailable } = runTestRetentionFailure(retentionError,
        { operation: "retain_failure_cause", subject: "complete failure cause", capability: "original_read" });
      return refuse(presentRunTestFailure(error, { ...options, facts: { ...options.facts, cause_complete: false, ...unavailable } }));
    }
    const readCall = template !== undefined && !templateFits
      ? await completeReadCall(locator, 'failure') ?? runTestReadCall(locator, 'failure')
      : runTestReadCall(locator, 'failure');
    const answer = presentRunTestFailure(error, { ...options,
      nextCalls: [...offered, readCall] });
    const complete = template === undefined ? answer : { ...answer, recovery: error.detail.recovery };
    if (fitsRunTestResponse(complete, true)) return refuse(complete);
    const assignment = error.detail?.recovery?.assignment;
    if (assignment === undefined) return refuse(answer);
    const withCause = { ...answer, assignment };
    if (fitsRunTestResponse(withCause, true)) return refuse(withCause);

    return refuse(presentRunTestFailure(error, { ...options,
      facts: { ...options.facts, assignment: { state: assignment.state,
        cause: { operation: assignment.cause.operation, code: assignment.cause.code } } },
      nextCalls: [...offered, readCall] }));
  };

  const execute = async ({ request, args, caller, signal, commandContext = null, budget }) => {
    const { workspace, state } = caller;
    let source;
    let outcome;
    let baselineSnapshotDigest = null;
    const ordinary = { harness: commandContext?.selection.harness ?? request.harness,
      environment: commandContext?.selection.environment ?? request.environment };
    try {
      try {
        source = await (deps.resolveSource ?? resolveManagedTestSource)({ state, env,
          mainRepo: path.resolve(workspace.dir), source: request.source, request: ordinary });
      } catch (error) {
        return refuseWithCause(error, { stage: "source_authentication", request, caller });
      }

      const currentFor = (checkout) => () => {
        if (commandContext !== null) checkRepositoryCommandDefinitions(commandContext, checkout.checkoutRoot,
          { baseline: checkout.checkoutRoot !== source.checkoutRoot });
        return checkout.current();
      };
      const runAndObserve = (runRequest, ...expansion) => {
        if (commandContext !== null) checkRepositoryCommandDefinitions(commandContext, runRequest.checkoutRoot,
          { baseline: runRequest.checkoutRoot !== source.checkoutRoot });
        return runOrdinaryTestAndObserve({ runRequest, expansion,
        request: ordinary, ...(deps.runFile === undefined ? {} : { runFile: deps.runFile }),
        ...(deps.observeRuntime === undefined ? {} : { observeRuntime: deps.observeRuntime }) });
      };
      try {
        outcome = await runOrdinaryTestWithComparison({
          request: ordinary,

          candidate: { repositoryRoot: source.repositoryRoot, checkoutRoot: source.checkoutRoot,
            current: currentFor(source), ...(source.targets === undefined ? {} : { targets: source.targets }) },
          resolveBaseline: () => {
            const baseline = source.baseline({ budget });
            if (baseline.status !== "available") return baseline;
            if (commandContext !== null) {
              try { checkRepositoryCommandDefinitions(commandContext, baseline.checkoutRoot, { baseline: true }); }
              catch (error) {

                return { ...baseline, definitionRefusal: error };
              }
            }
            baselineSnapshotDigest = baseline.snapshotDigest ?? null;
            return { ...baseline, current: currentFor(baseline) };
          },
          budget,
          timeoutMs: request.timeout.milliseconds,
          runFile: runAndObserve
        });
      } catch (error) {
        return refuseWithCause(error, { stage: "execution", request, source, caller });
      }
    } catch (error) {
      return refuseWithCause(error, { stage: 'execution', request, source, caller });
    }

    const status = outcome.candidate.result.status;
    const nativeRequested = ordinaryRequestCorrection(outcome.candidate.result);
    const environmentSelection = runTestEnvironmentSelection(outcome.candidate.result);
    const assignedCommand = commandContext === null ? null : {
      entrypoint: commandContext.command.id, selection: commandContext.selection.id };
    const environmentRecovery = assignedCommand === null || environmentSelection === null ? null
      : await refreshEnvironmentRecovery({ command: assignedCommand, selection: environmentSelection, caller });
    const requested = commandContext === null && nativeRequested?.fields.every(field => ["harness", "environment"].includes(field))
      ? nativeRequested : null;
    let correction = null;
    let retainedCorrection = null;
    if (requested !== null) {
      const { seed, failure } = retainSeed(args, caller);
      if (failure === undefined) retainedCorrection = { retry_request: seed, ...nativeCorrection(requested) };
      correction = retainedCorrection ?? { correction_seed: "unavailable", ...failure };
    } else if (status === "refused" || status === "selection_unresolved") {
      retainedCorrection = NO_REQUEST_CORRECTION;
      correction = NO_REQUEST_CORRECTION;
    }

    let locator = null;
    let retention = null;
    const carrier = runTestCarrier({ request, source, outcome, baselineSnapshotDigest,
      correction: retainedCorrection, assignedCommand });
    try {
      locator = retainOriginal(carrier, caller, source.commit);
    } catch (error) {
      retention = { ...runTestRetentionFailure(error, { operation: "retain_native_result",
        subject: "settled result", capability: "original_read" }), original_output: "unavailable_beyond_this_answer" };
    }
    const { isError, payload } = presentRunTestAnswer({ outcome, source, locator, retention, correction,
      environmentRecovery, carrier, completeCall: locator === null ? null : await completeReadCall(locator, 'failure') });
    return isError ? refuse(payload) : jsonContent(payload);
  };

  const retried = (request, caller) => {
    const envelope = readSelectedResponseSource(request.seed, { env: responseEnv,
      expected: expected(RUN_TEST_RETAINED_KINDS.CORRECTION_SEED, caller) });
    const merged = applyRunTestRetry(envelope.carrier.request, request);
    return { ...inputSchema.safeParse(merged), request: merged };
  };

  registerTool(RUN_TEST_TOOL_NAME, {
    writeSemantics: MCP_WRITE_SEMANTICS.NONE,
    description: RUN_TEST_DESCRIPTION,
    inputSchema,

    inputValidationErrorProjector: async ({ args, validationError }) => ({
      terminal_result: await inputFailure(args, validationError) })
  }, async (received, extra = undefined) => {
    try {
      const invalid = (error) => refuse(presentRunTestFailure(error, { code: RUN_TEST_INPUT_CODES.INVALID,
        stage: "request_validation" }));
      let args = received;
      let request;
      try {
        const parsed = inputSchema.safeParse(args);
        if (!parsed.success) return inputFailure(args, parsed.error);
        args = parsed.data;
        request = parseRunTestRequest(args);
      } catch (error) {
        return invalid(error);
      }
      const { state, error } = runState();
      if (error !== undefined) return error;
      if (!EXECUTION_ROLES.includes(state?.role)) {
        return refuse(presentRunTestRefusal({ code: MANAGED_TEST_SOURCE_CODES.ROLE_INELIGIBLE,
          message: "workspace_run_test is available only to authenticated orchestrator, worker and reviewer sessions",
          facts: { executed: false, role: state?.role ?? null } }));
      }
      const caller = { workspace: resolveWorkspaceRepo(workspaceRepos), state };
      if (request.mode === "read") {
        return await read(runTestViewSelection(request.read.result, request.read.view, request.read.failure), caller);
      }
      if (request.mode === "retry") {
        let parsed;
        try {
          parsed = retried(request, caller);
        } catch (seedError) {
          if (seedError?.envelope === undefined) throw seedError;
          return refuse(presentRunTestDetailRefusal(seedError));
        }
        if (!parsed.success) return inputFailure(parsed.request, parsed.error);
        args = parsed.data;
        try {
          request = parseRunTestRequest(args);
        } catch (parseError) {
          return invalid(parseError);
        }
      }

      const signal = extra?.signal instanceof AbortSignal ? extra.signal : null;
      if (signal?.aborted) {
        return refuse(presentRunTestRefusal({ code: CODES.CANCELLED_BEFORE_START,
          message: "workspace_run_test was cancelled before any source or test work started",
          facts: { executed: false } }));
      }
      const budget = mintTestProofExecutionBudget({ timeoutMs: request.timeout.milliseconds, signal });
      try {
      let commandContext = null;
      if (state.role === 'worker') {
        try { commandContext = resolveWorkerRepositoryCommand({ request, state, env,
          mainRepo: path.resolve(caller.workspace.dir) }); }
        catch (error) {
          const permitted = error.detail?.permitted_calls ?? [];
          error.next_calls = permitted.map(call => buildNextCall({ ...call,
            arguments: { ...call.arguments, ...(args.timeout === undefined ? {} : { timeout: args.timeout }) } }));
          if (permitted.length > 0 && !fitsRunTestResponse({ code: error.code, accepted: false,
            executed: false, stage: 'command_authorization',
            message: error.message, detail: { entrypoint: request.entrypoint,
              ...(request.selection === undefined ? {} : { selection: request.selection }) }, next_calls: error.next_calls }, true)) {
            const reader = requestContracts?.contractFor('workspace_read_wiki');
            const canRead = reader !== null && reader !== undefined && await reader.acceptsArguments({ reads: [{ assignment: true }] });
            error.next_calls = canRead ? [buildNextCall({ tool: 'workspace_read_wiki', arguments: { reads: [{ assignment: true }] } })] : [];
            if (canRead) {
              const { seed, failure } = retainSeed(args, caller);
              return refuse(presentRunTestRefusal({ code: error.code, message: error.message,
                facts: { executed: false, required_choice: 'Read the assignment context, then select field:"test_commands" through its returned reference. Choose entrypoint/selection from those frozen commands.',
                  ...(seed === undefined ? { correction_seed: 'unavailable', retention: failure,
                    timeout: args.timeout ?? 'medium' }
                    : { correction: { retry_request: seed, changeable: 'entrypoint, selection' } }) },
                nextCalls: error.next_calls }));
            }
            error.detail = { entrypoint: request.entrypoint,
              stopping_condition: 'The command choices exceed this response and the assignment reader is unavailable.' };
          }
          if (/^run_test\.(?:entrypoint_unavailable|definition_changed)\.v1$/u.test(error.code ?? '') ||
              ['repository_test_definition_unavailable', 'test_proof_source_snapshot_symlink_unsupported',
                'test_proof_source_snapshot_unsupported_entry', MANAGED_ASSIGNMENT_READ_REFUSAL_CODES.UNAVAILABLE].includes(error.code)) {
            try {
              const proposed = await refreshAssignmentChangeRecovery({ caller,
                evidence: [{ description: error.code, references: [state.assignedUnit,
                  ...(typeof error.detail?.path === 'string' ? [error.detail.path] : error.detail?.paths ?? [])] }] });
              error.detail = { ...error.detail, recovery: proposed.recovery };
              if (proposed.call !== null) error.next_calls.push(proposed.call);
            } catch (recoveryError) {
              error.detail = { ...error.detail, recovery: { missing_capability: 'authenticated_assignment_change_recovery',
                cause_code: recoveryError.code ?? recoveryError.name, cause: recoveryError.message } };
            }
          }
          return refuseWithCause(error, { stage: 'command_authorization', request, caller });
        }
      } else if (request.entrypoint !== undefined) {
        return refuse(presentRunTestRefusal({ code: 'run_test.entrypoint_role_forbidden.v1',
          message: 'Only an authenticated worker selects assigned entrypoints; this role uses harness.',
          facts: { executed: false, role: state.role } }));
      }
      if (request.source !== null && state.role !== "orchestrator") {
        return refuseCorrectable({ code: MANAGED_TEST_SOURCE_CODES.SOURCE_NOT_PERMITTED, args, caller,
          message: `a ${state.role} runs its launcher-bound source; source is an orchestrator selection`,
          facts: { role: state.role }, correction: "without source",
          corrections: (seed) => [runTestRetryCall(seed, { clear: ["source"] }, "remove_source")] });
      }
      if (request.source === null && state.role === "orchestrator") {
        return refuseCorrectable({ code: MANAGED_TEST_SOURCE_CODES.SOURCE_REQUIRED, args, caller,
          message: "an orchestrator names its execution source; the returned retry selects current_main, and the " +
            "same retry with changes.source of kind exact_sha and the full commit as value selects that commit, " +
            "or of kind branch and a WK ID, WK#SLICE ID or canonical branch name selects that branch's commit",
          facts: { missing_fields: "source", source_kinds: "current_main, exact_sha, branch", required_choice: 'source; no default' },
          correction: "with its source named",
          corrections: (seed) => [{ ...runTestRetryCall(seed, { changes: { source: { kind: "current_main" } } },
            "select_current_main"), recommended: false }] });
      }
      return await withAuthenticatedTestExecution(state.sessionContract,
        () => execute({ request, args, caller, signal, commandContext, budget }));
      } finally { budget.dispose(); }
    } catch (error) {
      return fail(error, "route");
    }
  });
}
