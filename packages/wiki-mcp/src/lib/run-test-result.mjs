

import { buildNextCall } from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";

import { ordinaryFailedResultDiagnostic, ordinaryRunDiagnostic } from
  "../../../agent-launch-cli/src/lib/test-execution/ordinary-test-runner.mjs";
import { managedTestAuthorityAuthenticated } from "./managed-test-source-context.mjs";
import { describeRetentionFailure, measureMcpInlineResultBytes } from "./mcp-response.mjs";
import { RUN_TEST_STREAM_VIEWS, RUN_TEST_STRUCTURED_VIEWS, RUN_TEST_TOOL_NAME, RUN_TEST_VIEWS } from
  "./run-test-input.mjs";
import { readSelectedResponseSource, selectedResponseQueryInvalidError } from "./selected-response-snapshot.mjs";

export const RUN_TEST_RESPONSE_MAX_BYTES = 1024;

export const RUN_TEST_RETAINED_KINDS = Object.freeze({
  NATIVE_RESULT: Object.freeze({ kind: "native_result" }),
  CORRECTION_SEED: Object.freeze({ kind: "correction_seed" })
});

const MECHANICAL_FAILURE = "mechanical_failure";
const PERSISTENCE_OWNER = "selected-response persistence (response state directory)";

const FIXED_FACT_MAX_BYTES = 64;

const ANSWER_ACTION_MAX_BYTES = 256;

const fits = (payload, isError) =>
  measureMcpInlineResultBytes(payload, { isError }) <= RUN_TEST_RESPONSE_MAX_BYTES;

function utf8Tail(text, limit) {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= limit) return text;
  let start = bytes.length - limit;
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start += 1;
  return bytes.subarray(start).toString("utf8");
}

function utf8HeadLength(bytes, limit) {
  if (bytes.length <= limit) return bytes.length;
  let end = limit;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return end;
}

function largestFitting(high, build, isError) {
  if (!fits(build(0), isError)) return -1;
  if (fits(build(high), isError)) return high;
  let low = 0;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(build(middle), isError)) low = middle;
    else high = middle - 1;
  }
  return low;
}

function clippedHead(text, limit) {
  const bytes = Buffer.from(text, "utf8");
  return bytes.subarray(0, utf8HeadLength(bytes, limit)).toString("utf8");
}

function fitPayload({ heads = {}, tails = {}, assemble, isError = false }) {
  const clip = (texts, cut, cap) => Object.fromEntries(Object.entries(texts)
    .map(([key, text]) => [key, cut(text, cap)]));
  const longest = (texts) => Math.max(0, ...Object.values(texts).map((text) => Buffer.byteLength(text, "utf8")));
  const groups = Array.isArray(heads) ? heads : [heads];
  const noTails = clip(tails, utf8Tail, 0);
  let shownHeads = {};
  groups.forEach((group, at) => {
    const later = Object.assign({}, ...groups.slice(at + 1).map((next) => clip(next, clippedHead, 0)));
    const cap = largestFitting(longest(group),
      (tried) => assemble({ ...shownHeads, ...clip(group, clippedHead, tried), ...later }, noTails), isError);
    if (cap < 0) throw new RangeError(`${RUN_TEST_TOOL_NAME} could not fit its essential facts in 1,024 bytes`);
    shownHeads = { ...shownHeads, ...clip(group, clippedHead, cap) };
  });
  const build = (cap) => assemble(shownHeads, clip(tails, utf8Tail, cap));
  return build(largestFitting(longest(tails), build, isError));
}

const omitted = (full, shown) => Buffer.byteLength(full, "utf8") - Buffer.byteLength(shown, "utf8");
const locatorOf = ({ ref_id: refId }) => ({ ref_id: refId });
const jsonText = (value) => value === undefined || value === null ? null : JSON.stringify(value);

export function runTestReadCall(locator, view, reason = undefined, failure = null) {
  return buildNextCall({ tool: RUN_TEST_TOOL_NAME, ...(reason === undefined ? {} : { reason }),
    arguments: { read: { result: locatorOf(locator), view, ...(failure === null ? {} : { failure }) } } });
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

const nativeResult = (result) => shownFile(result)?.result ?? result;

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

function runFacts(run) {
  return { ...(executionUnconfirmed(run) ? { executed: "unknown" } : {}),
    exit_code: run.exit_code ?? null, ...(run.signal ? { signal: run.signal } : {}),
    timed_out: run.timed_out === true,
    cancelled: run.cancelled === true, cleanup_failed: run.cleanup_failed === true,
    output_lost: run.output_truncated === true,
    ...(run.ran === false && typeof run.blocker_code === "string" ? { blocker: run.blocker_code } : {}) };
}

function baselineFacts(baseline) {
  const glob = globFacts(baseline.result);

  const result = glob === null ? baseline.result : { ...baseline.result, run: undefined };
  return { commit: baseline.commit, status: result?.status ?? null, ok: result?.ok === true,
    ...(glob === null ? {} : { glob }),
    ...(result?.run === undefined ? {} : { exit_code: result.run.exit_code ?? null,
      ...(result.run.timed_out === true ? { timed_out: true } : {}),
      ...(result.run.cancelled === true ? { cancelled: true } : {}),
      ...(result.run.output_truncated === true ? { output_lost: true } : {}) }),
    ...(typeof result?.code === "string" ? { code: result.code } : {}),
    ...(baseline.source?.current === false ? { current: false } : {}),
    ...(typeof result?.runtime_after_run?.status === "string"
      ? { runtime_after_run: result.runtime_after_run.status } : {}) };
}

function runtimeAfterRunFacts(result) {
  const observed = result?.runtime_after_run;
  if (observed === null || typeof observed !== "object") {
    return { status: null, changed: null, code: null, cause: null };
  }
  return { status: observed.status ?? null,
    changed: Array.isArray(observed.changed) ? observed.changed.join(",") : null,
    code: typeof observed.code === "string" ? observed.code : null,
    cause: typeof observed.cause === "string" ? observed.cause : null };
}

function compactRuntimeAfterRun(result) {
  const facts = runtimeAfterRunFacts(result);
  if (facts.status === null) return null;
  return Object.fromEntries(Object.entries(facts).filter(([, value]) => value !== null)
    .map(([name, value]) => [name, clipFact(value)]));
}

function clipFact(value) {
  const bytes = Buffer.from(value, "utf8");
  return bytes.length <= FIXED_FACT_MAX_BYTES ? value
    : bytes.subarray(0, FIXED_FACT_MAX_BYTES).toString("utf8").replace(/\uFFFD$/u, "");
}

const comparisonState = (comparison) => ({ state: comparison.state,
  ...(comparison.reason === undefined ? {} : { reason: comparison.reason }) });

function comparisonFacts(comparison) {
  if (comparison.state === "attempted") return { state: "attempted", baseline: baselineFacts(comparison.baseline) };
  return comparisonState(comparison);
}

export function runTestStreams(outcome) {
  const streams = {};
  const add = (side, settled) => {
    const result = nativeResult(settled);
    for (const stream of ["stdout", "stderr"]) {
      const text = result?.run?.[stream];
      if (typeof text === "string" && text.length > 0) streams[`${side}_${stream}`] = text;
    }
  };
  add("candidate", outcome.candidate.result);
  if (outcome.comparison.state === "attempted") add("baseline", outcome.comparison.baseline.result);
  return streams;
}

function withoutStreams(result) {
  if (result === null || result === undefined || result.run === undefined) return result ?? null;
  if (Array.isArray(result.files)) return result;
  const { stdout: _stdout, stderr: _stderr, ...run } = result.run;
  return { ...result, run };
}

function settledFailure(result) {
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

function capturedCause(result) {
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

const refusalAction = (cause, correction) => requestCorrectable(correction) &&
  cause?.code !== "test_runtime_runner_not_prepared" ? null : ownerAction(cause);

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
        offset: selected.offset, total_bytes: selected.total_bytes, text: selected.text };
    }
  }
  return diagnostic?.basis === "first_error_line"
    ? { identified: true, failures: ordinaryFailedResultDiagnostic(result.run[diagnostic.source]).failures,
      view: `candidate_${diagnostic.source}`, offset: diagnostic.offset,
      total_bytes: diagnostic.total_bytes, text: diagnostic.text }
    : { identified: false, view: null, offset: null, total_bytes: null, text: null };
}

function selectedFailureDiagnostic(carrier, failure) {
  const retained = carrier.failure?.diagnostic ?? null;
  const stream = retained?.identified === true ? carrier[retained.view] : null;
  const selected = typeof stream === "string"
    ? ordinaryFailedResultDiagnostic(stream, { failure, maxBytes: RUN_TEST_RESPONSE_MAX_BYTES }) : { failures: 0 };
  return selected.failure === undefined
    ? { identified: false, failure, failures: selected.failures, view: null, offset: null, total_bytes: null,
      text: null }
    : { identified: true, failure, failures: selected.failures, view: retained.view, offset: selected.offset,
      total_bytes: selected.total_bytes, text: selected.text };
}

function composedSelectorFilter(result) {
  const composed = result.identity?.selection?.test_id_filter;
  return result.status === "executed" && result.ok !== true && typeof result.identity?.selector === "string" &&
    typeof composed === "string" ? composed : "";
}

export function runTestCarrier({ request, source = null, outcome = null, failure = null,
  baselineSnapshotDigest = null, correction = null }) {
  const candidate = outcome?.candidate.result ?? null;

  const shown = shownFile(candidate);
  const run = nativeResult(candidate)?.run ?? null;
  const comparison = outcome?.comparison ?? { state: "not_reached" };
  const attempted = comparison.state === "attempted" ? comparison.baseline : null;
  const cause = failure ?? settledFailure(nativeResult(candidate));
  const mismatch = cause?.detail !== null && typeof cause?.detail === "object" ? cause.detail.mismatch : undefined;
  const stream = (result, name) => {
    const text = nativeResult(result)?.run?.[name];
    return typeof text === "string" ? text : null;
  };
  const ran = (result) => outcome === null ? "unknown" : executedFact(nativeResult(result)?.run);
  const baselineRun = nativeResult(attempted?.result)?.run ?? null;
  return {
    outcome: {
      execution: { status: candidate?.status ?? "not_settled", ok: candidate?.ok === true, proof_credit: false,
        executed: executedFact(run), code: candidate?.code ?? null, exit_code: run?.exit_code ?? null,
        signal: run?.signal ?? null, timed_out: run?.timed_out === true, cancelled: run?.cancelled === true,
        cleanup_failed: run?.cleanup_failed === true, output_lost: run?.output_truncated === true,
        output_elided_bytes: run?.output_elided_bytes ?? 0, blocker: run?.blocker_code ?? null },
      request: { runner: request.runner, environment: request.environment, compare_parent: request.compareParent,
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
      currentness: { current: outcome === null ? null : outcome.candidate.source.current === true,
        moved: outcome?.candidate.source.reason ?? null } },
    comparison: {
      eligibility: { state: comparison.state, reason: comparison.reason ?? null },
      candidate: { commit: source?.commit ?? null, snapshot_digest: source?.snapshotDigest ?? null,
        status: candidate?.status ?? null, ok: candidate?.ok === true, exit_code: run?.exit_code ?? null },
      baseline: { commit: attempted?.commit ?? null,
        snapshot_digest: attempted === null ? null : baselineSnapshotDigest,
        status: attempted?.result?.status ?? null, ok: attempted === null ? null : attempted.result?.ok === true,
        exit_code: baselineRun?.exit_code ?? null, signal: baselineRun?.signal ?? null,
        timed_out: baselineRun?.timed_out === true, cancelled: baselineRun?.cancelled === true,
        output_lost: baselineRun?.output_truncated === true, code: attempted?.result?.code ?? null,
        current: attempted === null ? null : attempted.source?.current === true,
        moved: attempted?.source?.reason ?? null },
      baseline_runtime_after_run: runtimeAfterRunFacts(attempted?.result),
      ...(globFacts(attempted?.result) === null ? {} : { baseline_glob: globFacts(attempted.result),
        baseline_shown_file: shownFile(attempted.result)?.target ?? null }),
      detail: jsonText(comparison.detail),
      baseline_native: jsonText(withoutStreams(attempted?.result)) },
    failure: {
      cause: { present: cause !== null, stage: cause?.stage ?? null, code: cause?.code ?? null,
        cause_code: cause?.cause_code ?? null },
      effects: { candidate_executed: ran(candidate), baseline_executed: ran(attempted?.result),
        cleanup_failed: run?.cleanup_failed === true, output_lost: run?.output_truncated === true },
      message: cause?.message ?? null,

      action: refusalAction(cause, correction),
      mismatch: jsonText(mismatch),

      diagnostic: failureDiagnostic(nativeResult(candidate)),
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

export function presentRunTestAnswer({ outcome, source, locator, retention = null, correction = null }) {

  const settled = outcome.candidate.result;
  const glob = globFacts(settled);
  const shown = shownFile(settled);
  const result = shown?.result ?? settled;
  const streams = runTestStreams(outcome);
  const message = typeof result.message === "string" ? result.message : "";
  const isError = settled.status === "refused" || settled.status === "selection_unresolved";
  const runtimeAfter = compactRuntimeAfterRun(settled);
  const cause = capturedCause(result);
  const causeText = typeof cause?.text === "string" ? cause.text : "";
  const filter = composedSelectorFilter(result);

  const unconfirmed = executionUnconfirmed(result.run);
  const recovery = unconfirmed && typeof result.run.completion_recovery?.action === "string"
    ? result.run.completion_recovery : null;
  const recoveryText = recovery?.action ?? "";

  const action = isError ? refusalAction(settledFailure(result), correction) ?? "" : "";
  const actionHead = clippedHead(action, ANSWER_ACTION_MAX_BYTES);

  const causeView = isError || result.status !== "executed" || unconfirmed ? "failure" : "outcome";

  const assembleAt = (level) => (heads, tails) => {

    const output = level >= 1 ? null : Object.fromEntries(Object.entries(streams).map(([member, full]) => [member,
      { ...(tails[member] === "" ? {} : { text: tails[member] }), omitted_bytes: omitted(full, tails[member]) }]));
    const firstClipped = RUN_TEST_STREAM_VIEWS.find((member) => output === null
      ? streams[member] !== undefined : output[member]?.omitted_bytes > 0);
    const shownMessage = heads.message ?? "";
    const messageOmitted = omitted(message, shownMessage);

    const reached = cause?.view !== undefined && output?.[cause.view]?.omitted_bytes <= cause.offset;
    const shownCause = reached ? causeText : heads.cause ?? "";
    const causeOmitted = omitted(causeText, shownCause);
    const shownFilter = heads.filter ?? "";
    const filterOmitted = filter === "" ? 0 : omitted(filter, shownFilter);
    const shownRecovery = heads.recovery ?? "";
    const recoveryOmitted = omitted(recoveryText, shownRecovery);
    const shownAction = heads.action ?? "";
    const actionOmitted = omitted(action, shownAction);

    const diagnosed = cause?.view !== undefined && !reached ? "failure" : undefined;
    const first = unconfirmed ? causeView : diagnosed ?? firstClipped ?? causeView;
    return {
      status: settled.status,
      ok: settled.ok === true,
      proof_credit: false,
      ...(isError ? { code: settled.code, executed: false, authority_limb: MECHANICAL_FAILURE } : {}),

      ...(glob === null ? {} : { glob }),
      ...(shown === null ? {} : { file: clipFact(shown.target), file_status: result.status,
        ...(typeof result.code === "string" ? { file_code: result.code } : {}) }),
      ...(shownMessage === "" ? {} : { message: shownMessage }),
      ...(messageOmitted > 0 ? { message_omitted_bytes: messageOmitted } : {}),

      ...(shownAction === "" ? {} : { action: shownAction }),
      ...(actionOmitted > 0 ? { action_omitted_bytes: actionOmitted } : {}),

      ...(cause === null || reached || (level >= 4 && cause.source !== "none") ? {}
        : { cause: { phase: cause.phase, source: cause.source,
          ...(cause.view === undefined ? {} : { view: cause.view }),
          ...(cause.source === "none" ? {} : { offset: cause.offset, text: shownCause }),
          ...(causeOmitted > 0 ? { omitted_bytes: causeOmitted } : {}) } }),

      source: { kind: source.kind, ...(source.branch === undefined ? {} : { branch: source.branch }),
        commit: source.commit, snapshot_digest: source.snapshotDigest ?? null,
        ...(level >= 3 ? {} : { dirty: source.dirty }),
        current: outcome.candidate.source.current === true,
        ...(outcome.candidate.source.reason === undefined ? {} : { moved: outcome.candidate.source.reason }) },
      ...(result.run === undefined ? {} : { run: runFacts(result.run) }),

      ...(shownRecovery === "" ? {} : { recovery: { action: shownRecovery, repair_call: recovery.repair_call,
        automatic_rerun: recovery.automatic_rerun,
        ...(recoveryOmitted > 0 ? { omitted_bytes: recoveryOmitted } : {}) } }),

      ...(shownFilter === "" ? {} : { selection: { test_id_filter: shownFilter,
        ...(filterOmitted > 0 ? { omitted_bytes: filterOmitted } : {}) } }),

      ...(runtimeAfter === null ? {} : { runtime_after_run: level >= 3 ? { status: runtimeAfter.status }
        : runtimeAfter }),
      comparison: level >= 2 ? comparisonState(outcome.comparison) : comparisonFacts(outcome.comparison),

      ...(output === null ? {} : { output, native_output_only: true }),

      output_complete: glob === null && firstClipped === undefined && messageOmitted === 0 && causeOmitted === 0 &&
        filterOmitted === 0 && recoveryOmitted === 0 && actionOmitted === 0,
      ...(retention === null ? {} : { retention }),
      ...(level >= 3 || correction === null ? {} : { correction: typeof correction.rejected === "string"
        ? { ...correction, rejected: clipFact(correction.rejected) } : correction }),
      next_calls: locator === null ? [] : [runTestReadCall(locator, first)]
    };
  };

  const firstLineBytes = Buffer.byteLength(causeText.split("\n", 1)[0], "utf8");
  const actionBytes = Buffer.byteLength(actionHead, "utf8") +
    (action === "" ? 0 : Buffer.byteLength(message, "utf8"));
  let fitted = null;
  for (const level of [0, 1, 2, 3, 4]) {
    try {

      const payload = fitPayload({ heads: level >= 4 ? {} : [action === "" ? {} : { action: actionHead },
        { ...(message === "" ? {} : { message }),
          ...(causeText === "" ? {} : { cause: causeText }), ...(filter === "" ? {} : { filter }),
          ...(recoveryText === "" ? {} : { recovery: recoveryText }) }],
      tails: level >= 1 ? {} : streams, assemble: assembleAt(level), isError });
      const shown = payload.cause?.text === undefined ? null : Buffer.byteLength(payload.cause.text, "utf8");
      const shownAction = Buffer.byteLength(payload.action ?? "", "utf8") +
        (action === "" ? 0 : Buffer.byteLength(payload.message ?? "", "utf8"));
      if (shown === null && shownAction === 0 && fitted !== null) continue;
      const score = (shown ?? 0) + shownAction;
      if (fitted === null || score > fitted.score) fitted = { payload, score };
      if ((shown === null || shown >= firstLineBytes) && shownAction >= actionBytes) break;
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
    }
  }
  if (fitted !== null) return { isError, payload: fitted.payload };

  return { isError, payload: { status: settled.status, ok: settled.ok === true, proof_credit: false,
    presentation: "overflow", output_complete: false,
    next_calls: locator === null ? [] : [runTestReadCall(locator, causeView)] } };
}

function scalarDetail(detail) {
  return Object.fromEntries(Object.entries(detail ?? {}).filter(([, value]) =>
    value === null || ["string", "number", "boolean"].includes(typeof value)));
}

const clippable = (value) => typeof value === "string" && Buffer.byteLength(value, "utf8") > FIXED_FACT_MAX_BYTES;

export function presentRunTestRefusal({ code, message = "", facts = {}, detail = {}, nextCalls = [] }) {
  const details = scalarDetail(detail);
  const stringDetails = Object.fromEntries(Object.entries(details).filter(([, value]) => clippable(value)));
  const assemble = (heads) => {
    const shownDetail = { ...details, ...Object.fromEntries(Object.keys(stringDetails)
      .map((key) => [key, heads[`detail.${key}`]])) };
    const omittedDetail = Object.keys(stringDetails).filter((key) =>
      omitted(stringDetails[key], heads[`detail.${key}`]) > 0);
    return {
      code,
      accepted: false,
      authority_limb: MECHANICAL_FAILURE,
      ...facts,
      message: heads.message,
      ...(omitted(message, heads.message) > 0 ? { message_omitted_bytes: omitted(message, heads.message) } : {}),
      ...(Object.keys(shownDetail).length === 0 ? {} : { detail: shownDetail }),
      ...(omittedDetail.length === 0 ? {} : { detail_clipped: omittedDetail }),
      next_calls: nextCalls
    };
  };
  return fitPayload({ heads: { message, ...Object.fromEntries(Object.entries(stringDetails)
    .map(([key, value]) => [`detail.${key}`, value])) }, assemble, isError: true });
}

export function runTestRefusalClipped(payload) {
  return payload.message_omitted_bytes > 0 || Array.isArray(payload.detail_clipped);
}

export function presentRunTestFailure(error, { code, stage, facts: added = {}, nextCalls = [] }) {
  const envelope = error?.envelope;
  if (envelope !== null && typeof envelope === "object" && typeof envelope.code === "string") {
    const { code: declared, message, accepted: _accepted, next_calls: calls = [],
      exact_returned_policy: policy, ...facts } = envelope;
    const scalars = scalarDetail(facts);
    return presentRunTestRefusal({ code: declared, message: typeof message === "string" ? message
      : String(error?.message ?? ""), facts: { ...Object.fromEntries(Object.entries(scalars)
      .filter(([, value]) => !clippable(value))), ...(policy === undefined ? {} : { exact_returned_policy: policy }),
    ...added },
    detail: Object.fromEntries(Object.entries(scalars).filter(([, value]) => clippable(value))),
    nextCalls: [...(Array.isArray(calls) ? calls : []), ...nextCalls] });
  }
  if (typeof error?.code === "string" && error.code.startsWith("run_test.")) {
    return presentRunTestRefusal({ code: error.code, message: error.message ?? "",
      facts: { executed: false, stage, ...added }, detail: error.detail ?? {}, nextCalls });
  }
  return presentRunTestRefusal({ code, message: String(error?.message ?? error), facts: { stage,
    cause_code: typeof error?.code === "string" ? error.code : null, ...added }, nextCalls });
}

export function presentRunTestDetailRefusal(error) {
  const envelope = error?.envelope ?? {};
  const facts = Object.fromEntries((envelope.deciding_facts ?? envelope.refusal?.deciding_facts ?? [])
    .filter(({ value }) => value === null || ["string", "number", "boolean"].includes(typeof value))
    .map(({ field, value }) => [field.split(".").at(-1), value]));
  const calls = (envelope.next_calls ?? envelope.refusal?.next_calls ?? [])
    .filter((call) => call?.tool === RUN_TEST_TOOL_NAME).slice(0, 1)
    .map(({ tool, arguments: callArguments }) => buildNextCall({ tool, arguments: callArguments }));
  return presentRunTestRefusal({ code: typeof envelope.code === "string" ? envelope.code
    : typeof error?.code === "string" ? error.code : "run_test.retained_read_failed.v1",
  message: String(error?.message ?? "the retained result could not be read"),
  facts: { executed: false, ...facts }, nextCalls: calls });
}

const RETAINED_ONLY = Object.freeze(["native", "baseline_native"]);

const LAST_FITTED = Object.freeze(["detail", "recovery"]);

export function presentRunTestRead({ view, carrier, locator, failure = null }) {
  const base = { observation: "retained_prior_observation", executed: false };
  const value = failure === null ? carrier[view]
    : { ...carrier[view], diagnostic: selectedFailureDiagnostic(carrier, failure) };

  const following = [...RUN_TEST_VIEWS.slice(RUN_TEST_VIEWS.indexOf(view) + 1), ...RUN_TEST_VIEWS];
  const after = view !== "failure" ? following[0]
    : following.find((next) => !RUN_TEST_STREAM_VIEWS.includes(next) || (carrier[next] ?? null) !== null);

  const shown = view === "failure" && value?.diagnostic?.identified === true ? failure ?? 1 : null;
  const nextCalls = [...(shown !== null && shown < value.diagnostic.failures
    ? [runTestReadCall(locator, "failure", "next_failed_result", shown + 1)] : []),
  runTestReadCall(locator, after, "next_view")];
  if (RUN_TEST_STREAM_VIEWS.includes(view)) {
    if (value === null || value === undefined) {
      return { ...base, read: { view, state: "not_attempted" }, next_calls: nextCalls };
    }
    if (value === "") return { ...base, read: { view, state: "empty", total_bytes: 0 }, next_calls: nextCalls };
    return fitPayload({ tails: { text: value }, assemble: (_heads, tails) => ({ ...base, read: { view,
      state: "captured", total_bytes: Buffer.byteLength(value, "utf8"), text: tails.text,
      omitted_bytes: omitted(value, tails.text), partial: omitted(value, tails.text) > 0 }, next_calls: nextCalls }) });
  }

  let withNulls = null;
  for (const dropNull of [false, true]) {
    const heads = {};

    const tiers = [{}, {}, {}];
    const facts = (node, trail) => {
      if (typeof node === "string" && clippable(node)) {
        heads[trail] = node;
        tiers[LAST_FITTED.includes(trail) ? 2 : trail === "mismatch" ? 1 : 0][trail] = node;
        return (shown) => shown[trail];
      }
      if (node === null || typeof node !== "object") return () => node;
      const members = Object.entries(node).filter(([, child]) => !(dropNull && child === null))
        .map(([key, child]) => [key, trail === "" && RETAINED_ONLY.includes(key)
          ? () => (child === null ? null : { retained: true, bytes: Buffer.byteLength(child, "utf8") })
          : facts(child, trail === "" ? key : `${trail}.${key}`)]);
      return (shown) => Object.fromEntries(members.map(([key, build]) => [key, build(shown)]));
    };
    const build = facts(value ?? {}, "");
    try {
      const payload = fitPayload({ heads: tiers, assemble: (shown) => {
        const clipped = Object.fromEntries(Object.keys(heads).map((key) => [key, omitted(heads[key], shown[key])])
          .filter(([, bytes]) => bytes > 0));
        return { ...base, read: { view, ...build(shown),
          ...(Object.keys(clipped).length === 0 ? {} : { omitted_bytes: clipped }),
          ...(dropNull ? { omitted_facts: "null" } : {}) }, next_calls: nextCalls };
      } });
      const firstClipped = Object.keys(payload.read.omitted_bytes ?? {}).some((key) => key in tiers[0]);
      if (dropNull || !firstClipped || !JSON.stringify(value ?? {}).includes(":null")) return payload;
      withNulls = payload;
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
    }
  }
  return withNulls ?? { ...base, read: { view, presentation: "overflow" }, next_calls: nextCalls };
}
