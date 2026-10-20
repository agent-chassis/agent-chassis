

import { buildNextCall } from '@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs';
import { ordinaryFailedResultDiagnostic, ordinaryRunDiagnostic } from '../../../agent-launch-cli/src/lib/test-execution/ordinary-test-runner.mjs';
import { ordinaryTestSemanticDiagnosis } from '../../../agent-launch-cli/src/lib/test-execution/ordinary-test-diagnosis.mjs';
import { managedTestAuthorityAuthenticated } from './managed-test-source-context.mjs';
import { describeRetentionFailure } from './mcp-response.mjs';
import { RUN_TEST_STRUCTURED_VIEWS, RUN_TEST_TOOL_NAME } from './run-test-input.mjs';
import { readSelectedResponseSource, selectedResponseQueryInvalidError } from './selected-response-snapshot.mjs';
import { RUN_TEST_RESPONSE_MAX_BYTES } from './run-test-format.mjs';
const PERSISTENCE_OWNER = 'selected-response persistence (response state directory)';
export const RUN_TEST_RETAINED_KINDS = Object.freeze({
  NATIVE_RESULT: Object.freeze({ kind: "native_result" }),
  CORRECTION_SEED: Object.freeze({ kind: "correction_seed" })
});
const locatorOf = ({ ref_id: refId }) => ({ ref_id: refId });
const jsonText = (value) => value === undefined || value === null ? null : JSON.stringify(value);

export function runTestReadCall(locator, view, reason = undefined, failure = null) {
  return buildNextCall({ tool: RUN_TEST_TOOL_NAME, ...(reason === undefined ? {} : { reason }),
    arguments: { read: { result: locatorOf(locator), view, ...(failure === null ? {} : { failure }) } } });
}

export function runTestSemanticReadCall(locator, view, failure = null) {
  return buildNextCall({ tool: 'get_run_result', arguments: { result: locatorOf(locator),
    native: { view, ...(failure === null ? {} : { failure }) } } });
}

export function runTestRetryCall(seed, { changes = null, clear = null } = {}, reason = undefined) {
  return buildNextCall({ tool: RUN_TEST_TOOL_NAME, ...(reason === undefined ? {} : { reason }),
    arguments: { retry: { request: locatorOf(seed), ...(changes === null ? {} : { changes }),
      ...(clear === null ? {} : { clear }) } } });
}

export function runTestViewSelection(locator, view, failure = undefined) {
  return { result: locatorOf(locator), view, ...(failure === undefined ? {} : { failure }) };
}

function globFacts(result) {
  if (!Array.isArray(result?.files)) return null;
  const ran = result.files.filter((file) => file.result?.status === "executed");
  const covered = result.files.filter((file) => file.result?.status === "covered").length;

  const unconfirmed = result.files.filter((file) => file.result?.status === "unconfirmed").length;
  return { matched: result.files.length, ran: ran.length, failed: ran.filter((file) => file.result.ok !== true).length,
    not_run: result.files.length - ran.length - covered - unconfirmed, ...(covered === 0 ? {} : { covered }),
    ...(result.stopped === null ? {} : { stopped: result.stopped }) };
}

function shownFile(result) {
  if (!Array.isArray(result?.files)) return null;
  const attempted = result.files.filter((file) => file.result !== null && file.result.status !== "covered");
  if (result.stopped === "unconfirmed") return attempted.at(-1) ?? null;
  return attempted.find((file) => file.result.ok !== true) ?? attempted[0] ?? null;
}

export const nativeResult = (result) => shownFile(result)?.result ?? result;

export function runTestExpectedBinding({ kind, repository, authorityIdentity }) {
  if (!managedTestAuthorityAuthenticated(authorityIdentity)) {
    throw selectedResponseQueryInvalidError(RUN_TEST_TOOL_NAME, "authority_identity_missing",
      { boundary: "expected" });
  }
  return { route: RUN_TEST_TOOL_NAME, repository, unit: null, query_identity: kind,
    authority_identity: authorityIdentity };
}

export function projectRunTestNativeResult({ result, repository, authorityIdentity,
  views = RUN_TEST_STRUCTURED_VIEWS, env = process.env }) {
  const refusedView = views.find((view) => !RUN_TEST_STRUCTURED_VIEWS.includes(view));
  if (refusedView !== undefined) {
    throw selectedResponseQueryInvalidError(RUN_TEST_TOOL_NAME, "view_not_projectable", { view: refusedView });
  }
  const envelope = readSelectedResponseSource(result, { env, expected: runTestExpectedBinding({
    kind: RUN_TEST_RETAINED_KINDS.NATIVE_RESULT, repository, authorityIdentity }) });
  return { retained: locatorOf(result),
    ...Object.fromEntries(views.map((view) => [view, envelope.carrier[view]])),
    native_read: runTestReadCall(result, views[0] ?? RUN_TEST_STRUCTURED_VIEWS[0]) };
}

const executionUnconfirmed = (run) => run?.ran === false && run.completion?.tests_may_have_executed === true;

const executedFact = (run) => executionUnconfirmed(run) ? "unknown" : run?.ran === true;

export function runFacts(run) {
  return { ...(executionUnconfirmed(run) ? { executed: "unknown" } : {}),
    exit_code: run.exit_code ?? null, ...(run.signal ? { signal: run.signal } : {}),
    timed_out: run.timed_out === true,
    cancelled: run.cancelled === true, cleanup_failed: run.cleanup_failed === true,
    output_lost: run.output_truncated === true,
    ...(run.ran === false && typeof run.blocker_code === "string" ? { blocker: run.blocker_code } : {}) };
}

function runtimeAfterRunFacts(result) {
  const observed = result?.runtime_after_run;
  if (observed === null || typeof observed !== "object") {
    return { status: null, changed: null, code: null, cause: null };
  }
  return { status: observed.status ?? null,
    changed: Array.isArray(observed.changed) ? observed.changed.join(",") : null,
    code: typeof observed.code === "string" ? observed.code : null,
    cause: typeof observed.cause === "string" ? observed.cause : null,
    ...(typeof observed.message === "string" ? { message: observed.message } : {}) };
}

function withoutStreams(result) {
  if (result === null || result === undefined || result.run === undefined) return result ?? null;
  if (Array.isArray(result.files)) return result;
  const { stdout: _stdout, stderr: _stderr, ...run } = result.run;
  return { ...result, run };
}

export function settledFailure(result) {
  if (result?.status === "refused" || result?.status === "selection_unresolved") {
    return { stage: `native_${result.status}`, code: result.code ?? null, message: result.message ?? null,
      detail: result.detail, recovery: result.recovery };
  }
  if (result?.run?.ran === false) {

    return { stage: executionUnconfirmed(result.run) ? "unconfirmed" : "not_run",
      code: result.run.blocker_code ?? null,
      message: ordinaryRunDiagnostic(result.run)?.text ?? jsonText(result.run.spawn_error),
      ...(executionUnconfirmed(result.run) ? { detail: result.run.completion,
        recovery: result.run.completion_recovery } : {}) };
  }
  return null;
}

export function capturedCause(result) {
  if (result.status === "selection_unresolved") {
    const diagnostic = result.detail?.diagnostic;
    return diagnostic !== null && typeof diagnostic === "object"
      ? { phase: result.detail.phase ?? "selection", ...diagnostic } : null;
  }
  if (result.run === undefined || result.ok === true) return null;
  const phase = result.run.phase ?? "run";
  const diagnostic = ordinaryRunDiagnostic(result.run);
  if (result.run.ran === false) return { phase, ...(diagnostic ?? { source: "none" }) };
  return diagnostic?.basis === "first_error_line"
    ? { phase, view: `candidate_${diagnostic.source}`, ...diagnostic } : null;
}

function ownerAction(cause) {
  const detail = cause?.detail !== null && typeof cause?.detail === "object" ? cause.detail : {};
  const stated = [detail.correction, detail.action?.statement, cause?.recovery?.statement]
    .find((text) => typeof text === "string" && text.length > 0);
  return stated ?? null;
}

const requestCorrectable = (correction) => correction !== null && correction?.retry_request !== undefined;

export const refusalAction = (cause, correction) => requestCorrectable(correction) &&
  cause?.code !== "test_runtime_runner_not_prepared" ? null : ownerAction(cause);

export function runTestEnvironmentSelection(result) {
  if (result?.status !== "refused" || !["test_runtime_environment_unknown",
    "test_runtime_environment_incompatible"].includes(result.code) ||
    !Array.isArray(result.detail?.valid_choices)) return null;
  return { reason: result.detail.reason ?? "environment_unknown",
    requested_environment: result.detail.requested_environment ?? null,
    valid_choices: [...result.detail.valid_choices] };
}

function failureDiagnostic(result) {
  if (result?.status !== "executed" || result.ok === true || result.run?.ran !== true) return null;
  const diagnostic = ordinaryRunDiagnostic(result.run, { maxBytes: RUN_TEST_RESPONSE_MAX_BYTES });
  if (diagnostic?.basis === "first_error_line" &&
      ordinaryFailedResultDiagnostic(result.run[diagnostic.source]).failures === 0) {
    const source = diagnostic.source === "stderr" ? "stdout" : "stderr";
    const stream = result.run[source];
    const selected = typeof stream === "string"
      ? ordinaryFailedResultDiagnostic(stream, { failure: 1, maxBytes: RUN_TEST_RESPONSE_MAX_BYTES }) : null;
    if (selected?.failure !== undefined) {
      return { identified: true, failures: selected.failures, view: `candidate_${source}`,
        ...(selected.context === undefined ? {} : { context: selected.context }),
        offset: selected.offset, total_bytes: selected.total_bytes, text: selected.text };
    }
  }
  return diagnostic?.basis === "first_error_line"
    ? { identified: true, failures: ordinaryFailedResultDiagnostic(result.run[diagnostic.source]).failures,
      view: `candidate_${diagnostic.source}`, offset: diagnostic.offset,
      ...(diagnostic.context === undefined ? {} : { context: diagnostic.context }),
      total_bytes: diagnostic.total_bytes, text: diagnostic.text }
    : { identified: false, view: null, offset: null, total_bytes: null, text: null };
}

export function selectedFailureDiagnostic(carrier, failure) {
  const retained = carrier.failure?.diagnostic ?? null;
  const stream = retained?.identified === true ? carrier[retained.view] : null;
  const selected = typeof stream === "string"
    ? ordinaryFailedResultDiagnostic(stream, { failure, maxBytes: RUN_TEST_RESPONSE_MAX_BYTES }) : { failures: 0 };
  return selected.failure === undefined
    ? { identified: false, failure, failures: selected.failures, view: null, offset: null, total_bytes: null,
      text: null }
    : { identified: true, failure, failures: selected.failures, view: retained.view, offset: selected.offset,
      ...(selected.context === undefined ? {} : { context: selected.context }),
      total_bytes: selected.total_bytes, text: selected.text };
}

export function runTestCarrier({ request, source = null, outcome = null, failure = null,
  baselineSnapshotDigest = null, correction = null, assignedCommand = null }) {
  const candidate = outcome?.candidate.result ?? null;

  const shown = shownFile(candidate);
  const run = nativeResult(candidate)?.run ?? null;
  const comparison = outcome?.comparison ?? { state: "not_reached" };
  const attempted = comparison.baseline ?? null;
  const cause = failure ?? settledFailure(nativeResult(candidate));
  const mismatch = cause?.detail !== null && typeof cause?.detail === "object" ? cause.detail.mismatch : undefined;
  const stream = (result, name) => {
    const text = nativeResult(result)?.run?.[name];
    return typeof text === "string" ? text : null;
  };
  const beforeExecution = outcome === null && ['request_validation', 'session_authentication',
    'command_authorization', 'source_authentication'].includes(failure?.stage);
  const ran = (result) => outcome === null ? beforeExecution ? false : "unknown" : executedFact(nativeResult(result)?.run);
  const baselineRun = nativeResult(attempted?.result)?.run ?? null;
  const environmentSelection = runTestEnvironmentSelection(nativeResult(candidate));
  return {
    outcome: {
      execution: { status: candidate?.status ?? "not_settled", ok: candidate?.ok === true, proof_credit: false,
        executed: ran(candidate), code: candidate?.code ?? null, exit_code: run?.exit_code ?? null,
        signal: run?.signal ?? null, timed_out: run?.timed_out === true, cancelled: run?.cancelled === true,
        cleanup_failed: run?.cleanup_failed === true, output_lost: run?.output_truncated === true,
        output_elided_bytes: run?.output_elided_bytes ?? 0, blocker: run?.blocker_code ?? null },
      request: { ...(request.entrypoint !== undefined ? { entrypoint: request.entrypoint, selection: request.selection ?? null }
        : request.harness === undefined ? { runner: request.runner } : { harness: jsonText(request.harness) }),
        environment: request.environment,
        timeout_ms: request.timeout.milliseconds, source: request.source },
      runtime_after_run: runtimeAfterRunFacts(candidate),
      ...(globFacts(candidate) === null ? {} : { glob: globFacts(candidate), shown_file: shown?.target ?? null }),
      file: request.file,
      selector: request.selector,

      native: jsonText(withoutStreams(candidate)) },
    source: {
      identity: { kind: source?.kind ?? null, role: source?.role ?? null, branch: source?.branch ?? null,
        commit: source?.commit ?? null,
        tree: source?.tree ?? null, dirty: source?.dirty ?? null, snapshot_digest: source?.snapshotDigest ?? null,
        slice_start: source?.slice_start ?? null },
      currentness: { current: outcome?.candidate.source.current ?? null,
        moved: outcome?.candidate.source.reason ?? null,
        ...(outcome?.candidate.source.status === "unknown" ? outcome.candidate.source : {}) } },
    comparison: {
      eligibility: { state: comparison.state, reason: comparison.reason ?? null },
      candidate: { commit: source?.commit ?? null, snapshot_digest: source?.snapshotDigest ?? null,
        status: candidate?.status ?? null, ok: candidate?.ok === true, exit_code: run?.exit_code ?? null },
      baseline: { commit: attempted?.commit ?? null,
        dirty: attempted?.dirty ?? null,
        snapshot_digest: attempted === null ? null : baselineSnapshotDigest,
        status: attempted?.result?.status ?? null, ok: attempted?.result == null ? null : attempted.result.ok === true,
        exit_code: baselineRun?.exit_code ?? null, signal: baselineRun?.signal ?? null,
        timed_out: baselineRun?.timed_out === true, cancelled: baselineRun?.cancelled === true,
        output_lost: baselineRun?.output_truncated === true, code: attempted?.result?.code ?? null,
        current: attempted?.source?.current ?? null,
        moved: attempted?.source?.reason ?? null,
        ...(attempted?.source?.status === "unknown" ? { observation: attempted.source } : {}) },
      baseline_runtime_after_run: runtimeAfterRunFacts(attempted?.result),
      ...(globFacts(attempted?.result) === null ? {} : { baseline_glob: globFacts(attempted.result),
        baseline_shown_file: shownFile(attempted.result)?.target ?? null }),
      detail: jsonText(comparison.detail),
      ...(comparison.failure === undefined ? {} : { failure: comparison.failure }),
      baseline_native: jsonText(withoutStreams(attempted?.result)) },
    failure: {
      ...(environmentSelection === null ? {} : { environment_selection: environmentSelection,
        ...(assignedCommand === null ? {} : { assigned_command: assignedCommand }) }),
      cause: { present: cause !== null, stage: cause?.stage ?? null, code: cause?.code ?? null,
        cause_code: cause?.cause_code ?? null },
      effects: { candidate_executed: ran(candidate), baseline_executed: comparison.reason === "baseline_execution_failed"
        ? "unknown" : ran(attempted?.result),
        cleanup_failed: run?.cleanup_failed === true, output_lost: run?.output_truncated === true },
      message: cause?.message ?? null,

      action: refusalAction(cause, correction),
      mismatch: jsonText(mismatch),

      diagnostic: failureDiagnostic(nativeResult(candidate)),

      semantic_diagnosis: ordinaryTestSemanticDiagnosis(nativeResult(candidate)),
      detail: jsonText(cause?.detail),
      recovery: jsonText(cause?.recovery),

      correction: correction === null ? null : { retry_request: correction.retry_request === undefined ? null
        : locatorOf(correction.retry_request), changeable: correction.changeable, set: correction.set ?? null, rejected: correction.rejected ?? null,
        choices: correction.choices ?? null } },
    candidate_stdout: stream(candidate, "stdout"),
    candidate_stderr: stream(candidate, "stderr"),
    baseline_stdout: stream(attempted?.result, "stdout"),
    baseline_stderr: stream(attempted?.result, "stderr")
  };
}

export function runTestRetentionFailure(error, { operation, subject, capability }) {
  const described = describeRetentionFailure(error, { operation, subject });
  return { retained: false, failed_operation: described.failed_operation, subject: described.subject,
    cause_code: described.cause_code, unavailable_capability: capability, owner: PERSISTENCE_OWNER,
    repair_call: "none" };
}

