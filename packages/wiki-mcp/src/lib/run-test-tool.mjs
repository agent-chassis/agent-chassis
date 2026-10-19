

import path from "node:path";

import { mintTestProofExecutionBudget } from
  "../../../agent-launch-cli/src/lib/test-execution/confined-capture.mjs";
import { runOrdinaryTestWithComparison } from "../../../agent-launch-cli/src/lib/test-execution/ordinary-run.mjs";
import { runOrdinaryTest } from "../../../agent-launch-cli/src/lib/test-execution/ordinary-test-glob.mjs";
import { ordinaryRequestCorrection } from
  "../../../agent-launch-cli/src/lib/test-execution/ordinary-test-runner.mjs";
import { resolveLauncherRunState } from "./launcher-run-credential.mjs";
import { resolveWorkerRepositoryCommand, checkRepositoryCommandDefinitions } from './managed-test-command-context.mjs';
import { projectAssignmentChangeRecovery } from './verify-proof-source-repair-recovery.mjs';
import { buildNextCall } from '@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs';
import { registeredToolRequestContracts } from './registered-tool-request-contracts.mjs';
import { fitsRunTestResponse } from './run-test-format.mjs';
import { MANAGED_TEST_SOURCE_CODES, authenticateManagedWorkerSliceBinding, managedTestAuthorityIdentity, observeRuntimeAfterRun,
  resolveManagedTestSource } from "./managed-test-source-context.mjs";
import { MCP_WRITE_SEMANTICS } from "./register-tool.mjs";
import { RUN_TEST_INPUT_CODES, RUN_TEST_TOOL_NAME, applyRunTestRetry, parseRunTestRequest,
  runTestInputRefusal, runTestInputSchema, runTestReadCorrection, runTestRequestSeed } from "./run-test-input.mjs";
import { RUN_TEST_RETAINED_KINDS, presentRunTestAnswer, presentRunTestDetailRefusal, presentRunTestFailure,
  presentRunTestRead, presentRunTestRefusal, runTestCarrier, runTestExpectedBinding, runTestReadCall,
  runTestRefusalClipped, runTestRetentionFailure, runTestRetryCall, runTestViewSelection, runTestEnvironmentSelection } from
  "./run-test-result.mjs";
import { readSelectedResponseSource, retainSelectedResponseSource, selectedResponseRequestSchema } from
  "./selected-response-snapshot.mjs";

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
  "correction seed, never a native-result handle. Saved proofs use verify_proof.";

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
  errorContent, responseEnv = process.env, refreshEnvironmentRecovery = null }) {

  const modeRequestSchema = (mode) => selectedResponseRequestSchema(inputSchema.innerType()
    .pick({ [mode]: true }));
  const refuse = (payload) => errorContent(refusal(payload));
  const expected = (kind, { workspace, state }) => runTestExpectedBinding({ kind, repository: workspace.repo,
    authorityIdentity: managedTestAuthorityIdentity(state) });

  const read = async ({ result, view, failure = null }, caller) => {
    try {
      const envelope = readSelectedResponseSource(result, { env: responseEnv,
        expected: expected(RUN_TEST_RETAINED_KINDS.NATIVE_RESULT, caller) });
      const command = envelope.carrier.failure?.assigned_command;
      const selection = envelope.carrier.failure?.environment_selection;

      const environmentRecovery = view === "failure" && command !== undefined && selection !== undefined
        ? refreshEnvironmentRecovery === null
          ? { call: null, recovery: { missing_capability: "authenticated_assignment_change_recovery" } }
          : await refreshEnvironmentRecovery({ command, selection, caller }) : null;
      return jsonContent(presentRunTestRead({ view, failure, carrier: envelope.carrier, locator: result,
        environmentRecovery }));
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
  const refreshEnvironmentRecovery = async ({ command, selection, caller }) => {
    try {
      const binding = authenticateManagedWorkerSliceBinding({ mainRepo: caller.workspace.dir,
        state: caller.state, wkId: caller.state.assignedUnit.split('#')[0] });
      return await projectAssignmentChangeRecovery({ workspace: caller.workspace, sessionEnv: env,
        requestContracts, state: caller.state, binding, request: {
          assignment_fact: { kind: selection.requested_environment === null ? 'missing' : 'contradictory',
            statement: `${command.entrypoint}/${command.selection}: environment ${selection.requested_environment ?? 'unspecified'}.` },
          evidence: [{ description: selection.reason, references: selection.valid_choices }],
          prevents: 'Assigned command execution.',
          requested_change: 'Select a valid frozen environment; authorize a successor.',
          completed_work: [], remaining_work: []
        } });
    } catch (error) {
      return { call: null, recovery: { missing_capability: 'authenticated_assignment_change_recovery',
        cause_code: error.code ?? error.name, cause: error.message } };
    }
  };
  const { modeRequestSchema, expected, read, retain: retainOriginal } = createRunTestResultReader({
    z, inputSchema, jsonContent, errorContent, responseEnv, refreshEnvironmentRecovery });
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

  const refuseWithCause = (error, { stage, request, source = null, caller }) => {
    const offered = Array.isArray(error?.next_calls) ? error.next_calls : [];
    const testimony = offered.some(call => call.tool === 'request_assignment_change') ? {
      acceptance_effect: 'Ends this worker attempt.',
      testimony_required: 'Confirm facts and supply completed_work and remaining_work.'
    } : error.detail?.recovery?.missing_capability === undefined ? {} : {
      stopping_condition: `Assignment correction is unavailable: ${error.detail.recovery.missing_capability}.`,
      ...(error.detail.recovery.cause_code === undefined ? {} : { recovery_cause_code: error.detail.recovery.cause_code })
    };
    const options = { code: stage === 'command_authorization' && typeof error?.code === 'string'
      ? error.code : CODES.EXECUTION_FAILED, stage, nextCalls: offered, facts: testimony };
    const bounded = presentRunTestFailure(error, options);
    if (!runTestRefusalClipped(bounded)) return refuse(bounded);
    let locator;
    try {
      locator = retainOriginal(runTestCarrier({ request, source, failure: { stage,
        code: bounded.code, message: String(error?.message ?? error),
        cause_code: typeof error?.code === "string" ? error.code : null,
        detail: error?.detail ?? error?.envelope ?? null,
        ...(offered.length === 0 ? {} : { recovery: { next_calls: offered } }) } }), caller, source?.commit ?? null);
    } catch (retentionError) {
      const { retained: _retained, ...unavailable } = runTestRetentionFailure(retentionError,
        { operation: "retain_failure_cause", subject: "complete failure cause", capability: "original_read" });
      return refuse(presentRunTestFailure(error, { ...options, facts: { ...testimony, cause_complete: false, ...unavailable } }));
    }
    return refuse(presentRunTestFailure(error, { ...options,
      nextCalls: [...offered, runTestReadCall(locator, "failure")] }));
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
      environmentRecovery, carrier });
    return isError ? refuse(payload) : jsonContent(payload);
  };

  const retried = (request, caller) => {
    const envelope = readSelectedResponseSource(request.seed, { env: responseEnv,
      expected: expected(RUN_TEST_RETAINED_KINDS.CORRECTION_SEED, caller) });
    const merged = applyRunTestRetry(envelope.carrier.request, request);
    return inputSchema.safeParse(merged);
  };

  registerTool(RUN_TEST_TOOL_NAME, {
    writeSemantics: MCP_WRITE_SEMANTICS.NONE,
    description: RUN_TEST_DESCRIPTION,
    inputSchema,

    inputValidationErrorProjector: ({ args, validationError }) => {
      const correction = runTestReadCorrection(args, inputSchema);
      return { terminal_result: refuse(presentRunTestFailure(runTestInputRefusal(validationError),
        { code: RUN_TEST_INPUT_CODES.INVALID, stage: "request_validation",
          facts: correction.requiredChoice === undefined ? {} : { required_choice: correction.requiredChoice },
          nextCalls: correction.read === undefined ? [] : [runTestReadCall(correction.read.result,
            correction.read.view, "correct_read_shape", correction.read.failure ?? null)] })) };
    }
  }, async (received, extra = undefined) => {
    try {
      const invalid = (error) => refuse(presentRunTestFailure(error, { code: RUN_TEST_INPUT_CODES.INVALID,
        stage: "request_validation" }));
      let args = received;
      let request;
      try {
        const parsed = inputSchema.safeParse(args);
        if (!parsed.success) return invalid(runTestInputRefusal(parsed.error));
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
        if (!parsed.success) return invalid(runTestInputRefusal(parsed.error));
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
            const canRead = reader !== null && reader !== undefined && await reader.acceptsArguments({ assignment: true });
            error.next_calls = canRead ? [buildNextCall({ tool: 'workspace_read_wiki', arguments: { assignment: true } })] : [];
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
                'test_proof_source_snapshot_unsupported_entry'].includes(error.code)) {
            try {
              const binding = authenticateManagedWorkerSliceBinding({ mainRepo: caller.workspace.dir, state,
                wkId: state.assignedUnit.split('#')[0] });
              const proposed = await projectAssignmentChangeRecovery({ workspace: caller.workspace, sessionEnv: env,
                requestContracts, state, binding, request: {
                  assignment_fact: { kind: error.code === 'run_test.definition_changed.v1' || error.code === 'test_proof_source_snapshot_symlink_unsupported'
                    ? 'contradictory' : 'missing', statement: 'Assigned command definitions need correction.' },
                  evidence: [{ description: error.code, references: [state.assignedUnit,
                    ...(typeof error.detail?.path === 'string' ? [error.detail.path] : error.detail?.paths ?? [])] }],
                  prevents: 'Assigned test execution.',
                  requested_change: 'Correct the frozen command assignment.',
                  completed_work: [], remaining_work: []
                } });
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
      return await execute({ request, args, caller, signal, commandContext, budget });
      } finally { budget.dispose(); }
    } catch (error) {
      return fail(error, "route");
    }
  });
}
