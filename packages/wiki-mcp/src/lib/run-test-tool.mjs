

import path from "node:path";

import { mintTestProofExecutionBudget } from
  "../../../agent-launch-cli/src/lib/test-execution/confined-capture.mjs";
import { runOrdinaryTestWithComparison } from "../../../agent-launch-cli/src/lib/test-execution/ordinary-run.mjs";
import { ORDINARY_TEST_RUN_CODES, runOrdinaryTestFile } from
  "../../../agent-launch-cli/src/lib/test-execution/ordinary-test-runner.mjs";
import { resolveLauncherRunState } from "./launcher-run-credential.mjs";
import { MANAGED_TEST_SOURCE_CODES, managedTestAuthorityIdentity, observeRuntimeAfterRun,
  resolveManagedTestSource } from "./managed-test-source-context.mjs";
import { MCP_WRITE_SEMANTICS } from "./register-tool.mjs";
import { RUN_TEST_INPUT_CODES, RUN_TEST_STREAM_VIEWS, RUN_TEST_TOOL_NAME, applyRunTestRetry, parseRunTestRequest,
  runTestInputRefusal, runTestInputSchema, runTestRequestSeed } from "./run-test-input.mjs";
import { RUN_TEST_RESPONSE_MAX_BYTES, RUN_TEST_RETAINED_KINDS, presentRunTestAnswer, presentRunTestDetail,
  presentRunTestDetailRefusal, presentRunTestFailure, presentRunTestRefusal, runTestCarrier,
  runTestExpectedBinding, runTestReadCall, runTestRefusalClipped, runTestRetentionFailure, runTestRetryCall,
  runTestViewSelection } from "./run-test-result.mjs";
import { createSelectedResponseSession, readSelectedResponseSource, retainSelectedResponseSource,
  selectedResponseRequestSchema } from "./selected-response-snapshot.mjs";

export const RUN_TEST_DESCRIPTION = "Run one repository test file with its prepared runtime runner and report the " +
  "native outcome; never proof credit (use verify_proof for saved proofs). file is one literal " +
  "repository-relative file; the runner executes its normal unit for it, which may include neighboring tests, " +
  "and decides what passes. Optional environment, native selector and timeout. Orchestrators must name source: " +
  "{kind:\"current_main\"} (the configured checkout, dirty state included), {kind:\"exact_sha\",value} or " +
  "{kind:\"branch\",value} (a WK ID, WK#SLICE ID or canonical branch name; runs the commit that branch names " +
  "now and reports both), held by an existing owned clean checkout; workers and reviewers run their " +
  "launcher-bound source and omit it. " +
  "compare_parent:true reruns the same request " +
  "once on the parent's existing owned checkout when the run exits normally with a nonzero code, and reports both " +
  "outcomes without inferring a cause. Responses are limited to 1 KiB (1,024 UTF-8 bytes) total. stdout and " +
  "stderr share the remaining response budget and may be truncated; returned output is not a complete log. The " +
  "complete settled result is retained: copy next_calls (read, continue) to read each view and stream; reads " +
  "execute nothing. retry is a new execution of a refused request with the returned changes.";

const EXECUTION_ROLES = Object.freeze(["orchestrator", "reviewer", "worker"]);
const CODES = Object.freeze({

  CANCELLED_BEFORE_START: "run_test.cancelled_before_start.v1",
  EXECUTION_FAILED: "run_test.execution_failed.v1",
  SESSION_UNAVAILABLE: "run_test.session_unavailable.v1"
});

const NATIVE_CORRECTABLE_FIELDS = "file, runner, environment, selector";

function nativeChoice(result) {
  if (result.code !== ORDINARY_TEST_RUN_CODES.RUNNER_UNKNOWN || !Array.isArray(result.detail?.runners)) return {};
  return { set: "retry.changes.runner",
    ...(typeof result.detail.runner === "string" ? { rejected: result.detail.runner } : {}),
    choices: result.detail.runners.join(", ") };
}

function refusal(payload) {
  return Object.assign(new Error(payload.message ?? payload.code), { code: payload.code, envelope: payload });
}

export function createRunTestResultReader({ z, inputSchema = runTestInputSchema(z), jsonContent,
  errorContent, responseEnv = process.env }) {

  const modeRequestSchema = (mode) => selectedResponseRequestSchema(inputSchema.innerType()
    .pick({ [mode]: true }));
  const session = createSelectedResponseSession({
    route: RUN_TEST_TOOL_NAME,
    requestSchema: modeRequestSchema("continue"),
    buildDetailArguments: (_binding, selection) => ({ continue: selection }),
    requireAuthorityIdentity: true,
    maximumBytes: RUN_TEST_RESPONSE_MAX_BYTES,
    presentResponse: presentRunTestDetail,
    env: responseEnv
  });
  const refuse = (payload) => errorContent(refusal(payload));
  const expected = (kind, { workspace, state }) => runTestExpectedBinding({ kind, repository: workspace.repo,
    authorityIdentity: managedTestAuthorityIdentity(state) });

  const read = async (selection, caller) => {
    try {
      const detail = (chosen) => session.detail({
        expected: expected(RUN_TEST_RETAINED_KINDS.NATIVE_RESULT, caller), detail: chosen });
      const response = await detail(selection);
      const first = response.read?.range_required === true && response.read.field === undefined &&
        RUN_TEST_STREAM_VIEWS.includes(response.read.view) ? response.next_calls?.[0]?.arguments?.continue : undefined;
      return jsonContent(first === undefined ? response : await detail(first));
    } catch (error) {
      if (error?.envelope === undefined) throw error;
      return refuse(presentRunTestDetailRefusal(error));
    }
  };

  return Object.freeze({ session, modeRequestSchema, expected, read });
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
  deps = {}
}) {
  const inputSchema = runTestInputSchema(z);
  const { session, modeRequestSchema, expected, read } = createRunTestResultReader({
    z, inputSchema, jsonContent, errorContent, responseEnv });
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

  const retainOriginal = (carrier, caller, commit = null) => session.retain({
    binding: { ...expected(RUN_TEST_RETAINED_KINDS.NATIVE_RESULT, caller), observation_identity: commit },
    carrier,
    ownerCall: (retained) => runTestReadCall(retained, "outcome"),
    ownerRequestSchema: modeRequestSchema("read")
  }).source;

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
    const options = { code: CODES.EXECUTION_FAILED, stage, nextCalls: offered };
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
      return refuse(presentRunTestFailure(error, { ...options, facts: { cause_complete: false, ...unavailable } }));
    }
    return refuse(presentRunTestFailure(error, { ...options,
      nextCalls: [...offered, runTestReadCall(locator, "failure")] }));
  };

  const execute = async ({ request, args, caller, signal }) => {
    const { workspace, state } = caller;
    const budget = mintTestProofExecutionBudget({ timeoutMs: request.timeout.milliseconds, signal });
    let source;
    let outcome;
    let baselineSnapshotDigest = null;
    const ordinary = { target: request.file, runner: request.runner, environment: request.environment,
      selector: request.selector };
    try {
      try {
        source = await (deps.resolveSource ?? resolveManagedTestSource)({ state, env,
          mainRepo: path.resolve(workspace.dir), source: request.source, request: ordinary });
      } catch (error) {
        return refuseWithCause(error, { stage: "source_authentication", request, caller });
      }

      const currentFor = (checkout) => () => checkout.current();
      const runAndObserve = async (runRequest) => {
        const result = await (deps.runFile ?? runOrdinaryTestFile)(runRequest);
        return Object.freeze({ ...result, runtime_after_run: await (deps.observeRuntime ?? observeRuntimeAfterRun)({
          repositoryRoot: runRequest.repositoryRoot, checkoutRoot: runRequest.checkoutRoot,
          request: ordinary, result }) });
      };
      try {
        outcome = await runOrdinaryTestWithComparison({
          request: ordinary,
          candidate: { repositoryRoot: source.repositoryRoot, checkoutRoot: source.checkoutRoot,
            current: currentFor(source) },
          compareParent: request.compareParent,
          resolveBaseline: () => {
            const baseline = source.baseline();
            if (baseline.status !== "available") return baseline;
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
    } finally {
      budget.dispose();
    }

    const status = outcome.candidate.result.status;
    let correction = null;
    let retainedCorrection = null;
    if (status === "refused" || status === "selection_unresolved") {
      const { seed, failure } = retainSeed(args, caller);
      if (failure === undefined) {
        retainedCorrection = { retry_request: seed, changeable: NATIVE_CORRECTABLE_FIELDS,
          ...nativeChoice(outcome.candidate.result) };
      }
      correction = retainedCorrection ?? { correction_seed: "unavailable", ...failure };
    }

    let locator = null;
    let retention = null;
    try {
      locator = retainOriginal(runTestCarrier({ request, source, outcome, baselineSnapshotDigest,
        correction: retainedCorrection }), caller, source.commit);
    } catch (error) {
      retention = { ...runTestRetentionFailure(error, { operation: "retain_native_result",
        subject: "settled result", capability: "original_read" }), original_output: "unavailable_beyond_this_answer" };
    }
    const { isError, payload } = presentRunTestAnswer({ outcome, source, locator, retention, correction });
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

    inputValidationErrorProjector: ({ validationError }) => ({
      terminal_result: refuse(presentRunTestFailure(runTestInputRefusal(validationError),
        { code: RUN_TEST_INPUT_CODES.INVALID, stage: "request_validation" }))
    })
  }, async (received, extra = undefined) => {
    try {
      const invalid = (error) => refuse(presentRunTestFailure(error, { code: RUN_TEST_INPUT_CODES.INVALID,
        stage: "request_validation" }));
      let args = received;
      let request;
      try {
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
        return await read(runTestViewSelection(request.read.result, request.read.view), caller);
      }
      if (request.mode === "continue") return await read(request.selection, caller);
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
          facts: { missing_fields: "source", source_kinds: "current_main, exact_sha, branch" },
          correction: "with its source named",
          corrections: (seed) => [runTestRetryCall(seed, { changes: { source: { kind: "current_main" } } },
            "select_current_main")] });
      }

      const signal = extra?.signal instanceof AbortSignal ? extra.signal : null;
      if (signal?.aborted) {
        return refuse(presentRunTestRefusal({ code: CODES.CANCELLED_BEFORE_START,
          message: "workspace_run_test was cancelled before any source or test work started",
          facts: { executed: false } }));
      }
      return await execute({ request, args, caller, signal });
    } catch (error) {
      return fail(error, "route");
    }
  });
}
