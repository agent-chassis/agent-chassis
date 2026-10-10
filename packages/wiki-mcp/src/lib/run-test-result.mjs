

import { buildNextCall } from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";

import { ordinaryRunDiagnostic } from
  "../../../agent-launch-cli/src/lib/test-execution/ordinary-test-runner.mjs";
import { managedTestAuthorityAuthenticated } from "./managed-test-source-context.mjs";
import { describeRetentionFailure, measureMcpInlineResultBytes } from "./mcp-response.mjs";
import { RUN_TEST_STREAM_VIEWS, RUN_TEST_STRUCTURED_VIEWS, RUN_TEST_TOOL_NAME, RUN_TEST_VIEWS } from
  "./run-test-input.mjs";
import { SELECTED_RESPONSE_MEMBERS_COLLECTION, readSelectedResponseSource, selectedResponseQueryInvalidError } from
  "./selected-response-snapshot.mjs";

export const RUN_TEST_RESPONSE_MAX_BYTES = 1024;

export const RUN_TEST_RETAINED_KINDS = Object.freeze({
  NATIVE_RESULT: Object.freeze({ kind: "native_result" }),
  CORRECTION_SEED: Object.freeze({ kind: "correction_seed" })
});

const MECHANICAL_FAILURE = "mechanical_failure";
const PERSISTENCE_OWNER = "selected-response persistence (response state directory)";

const READ_RANGE_BYTES = RUN_TEST_RESPONSE_MAX_BYTES;

const FIXED_FACT_MAX_BYTES = 64;

const VIEW_LAYOUT = Object.freeze({
  outcome: Object.freeze({
    execution: Object.freeze(["status", "ok", "proof_credit", "executed", "code", "exit_code", "signal", "timed_out",
      "cancelled", "cleanup_failed", "output_lost", "output_elided_bytes", "blocker"]),
    request: Object.freeze(["runner", "environment", "compare_parent", "timeout_ms", "source"]),
    runtime_after_run: Object.freeze(["status", "changed", "code", "cause"]),
    file: null, selector: null, native: null }),
  source: Object.freeze({
    identity: Object.freeze(["kind", "role", "branch", "commit", "tree", "dirty", "snapshot_digest", "slice_start"]),
    currentness: Object.freeze(["current", "moved"]) }),
  comparison: Object.freeze({
    eligibility: Object.freeze(["state", "reason"]),
    candidate: Object.freeze(["commit", "snapshot_digest", "status", "ok", "exit_code"]),
    baseline: Object.freeze(["commit", "snapshot_digest", "status", "ok", "exit_code", "signal", "timed_out",
      "cancelled", "output_lost", "code", "current", "moved"]),
    baseline_runtime_after_run: Object.freeze(["status", "changed", "code", "cause"]),
    detail: null, baseline_native: null }),
  failure: Object.freeze({
    cause: Object.freeze(["present", "stage", "code", "cause_code"]),
    effects: Object.freeze(["candidate_executed", "baseline_executed", "cleanup_failed", "output_lost"]),
    message: null, detail: null, recovery: null,
    correction: Object.freeze(["retry_request", "changeable", "set", "rejected", "choices"]) })
});

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
  const headCap = largestFitting(longest(heads),
    (cap) => assemble(clip(heads, clippedHead, cap), clip(tails, utf8Tail, 0)), isError);
  if (headCap < 0) throw new RangeError(`${RUN_TEST_TOOL_NAME} could not fit its essential facts in 1,024 bytes`);
  const shownHeads = clip(heads, clippedHead, headCap);
  const build = (cap) => assemble(shownHeads, clip(tails, utf8Tail, cap));
  return build(largestFitting(longest(tails), build, isError));
}

const omitted = (full, shown) => Buffer.byteLength(full, "utf8") - Buffer.byteLength(shown, "utf8");
const locatorOf = ({ ref_id: refId }) => ({ ref_id: refId });
const jsonText = (value) => value === undefined || value === null ? null : JSON.stringify(value);

export function runTestReadCall(locator, view, reason = undefined) {
  return buildNextCall({ tool: RUN_TEST_TOOL_NAME, ...(reason === undefined ? {} : { reason }),
    arguments: { read: { result: locatorOf(locator), view } } });
}

export function runTestRetryCall(seed, { changes = null, clear = null } = {}, reason = undefined) {
  return buildNextCall({ tool: RUN_TEST_TOOL_NAME, ...(reason === undefined ? {} : { reason }),
    arguments: { retry: { request: locatorOf(seed), ...(changes === null ? {} : { changes }),
      ...(clear === null ? {} : { clear }) } } });
}

export function runTestViewSelection(locator, view) {
  return { source: locatorOf(locator), collection: SELECTED_RESPONSE_MEMBERS_COLLECTION, selector: { id: view },
    field_path: ["value"] };
}

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

function runFacts(run) {
  return { exit_code: run.exit_code ?? null, ...(run.signal ? { signal: run.signal } : {}),
    timed_out: run.timed_out === true,
    cancelled: run.cancelled === true, cleanup_failed: run.cleanup_failed === true,
    output_lost: run.output_truncated === true,
    ...(run.ran === false && typeof run.blocker_code === "string" ? { blocker: run.blocker_code } : {}) };
}

function baselineFacts(baseline) {
  const result = baseline.result;
  return { commit: baseline.commit, status: result?.status ?? null, ok: result?.ok === true,
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
  const add = (side, result) => {
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
  const { stdout: _stdout, stderr: _stderr, ...run } = result.run;
  return { ...result, run };
}

function settledFailure(result) {
  if (result?.status === "refused" || result?.status === "selection_unresolved") {
    return { stage: `native_${result.status}`, code: result.code ?? null, message: result.message ?? null,
      detail: result.detail, recovery: result.recovery };
  }
  if (result?.run?.ran === false) {

    return { stage: "not_run", code: result.run.blocker_code ?? null,
      message: ordinaryRunDiagnostic(result.run)?.text ?? jsonText(result.run.spawn_error) };
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

function composedSelectorFilter(result) {
  const composed = result.identity?.selection?.test_id_filter;
  return result.status === "executed" && result.ok !== true && typeof result.identity?.selector === "string" &&
    typeof composed === "string" ? composed : "";
}

export function runTestCarrier({ request, source = null, outcome = null, failure = null,
  baselineSnapshotDigest = null, correction = null }) {
  const candidate = outcome?.candidate.result ?? null;
  const run = candidate?.run ?? null;
  const comparison = outcome?.comparison ?? { state: "not_reached" };
  const attempted = comparison.state === "attempted" ? comparison.baseline : null;
  const cause = failure ?? settledFailure(candidate);
  const stream = (result, name) => typeof result?.run?.[name] === "string" ? result.run[name] : null;
  const ran = (result) => outcome === null ? "unknown" : result?.run?.ran === true;
  return {
    outcome: {
      execution: { status: candidate?.status ?? "not_settled", ok: candidate?.ok === true, proof_credit: false,
        executed: run?.ran === true, code: candidate?.code ?? null, exit_code: run?.exit_code ?? null,
        signal: run?.signal ?? null, timed_out: run?.timed_out === true, cancelled: run?.cancelled === true,
        cleanup_failed: run?.cleanup_failed === true, output_lost: run?.output_truncated === true,
        output_elided_bytes: run?.output_elided_bytes ?? 0, blocker: run?.blocker_code ?? null },
      request: { runner: request.runner, environment: request.environment, compare_parent: request.compareParent,
        timeout_ms: request.timeout.milliseconds, source: request.source },
      runtime_after_run: runtimeAfterRunFacts(candidate),
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
        exit_code: attempted?.result?.run?.exit_code ?? null, signal: attempted?.result?.run?.signal ?? null,
        timed_out: attempted?.result?.run?.timed_out === true, cancelled: attempted?.result?.run?.cancelled === true,
        output_lost: attempted?.result?.run?.output_truncated === true, code: attempted?.result?.code ?? null,
        current: attempted === null ? null : attempted.source?.current === true,
        moved: attempted?.source?.reason ?? null },
      baseline_runtime_after_run: runtimeAfterRunFacts(attempted?.result),
      detail: jsonText(comparison.detail),
      baseline_native: jsonText(withoutStreams(attempted?.result)) },
    failure: {
      cause: { present: cause !== null, stage: cause?.stage ?? null, code: cause?.code ?? null,
        cause_code: cause?.cause_code ?? null },
      effects: { candidate_executed: ran(candidate), baseline_executed: ran(attempted?.result),
        cleanup_failed: run?.cleanup_failed === true, output_lost: run?.output_truncated === true },
      message: cause?.message ?? null,
      detail: jsonText(cause?.detail),
      recovery: jsonText(cause?.recovery),
      correction: correction === null ? null : { retry_request: locatorOf(correction.retry_request),
        changeable: correction.changeable, set: correction.set ?? null, rejected: correction.rejected ?? null,
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
  const result = outcome.candidate.result;
  const streams = runTestStreams(outcome);
  const message = typeof result.message === "string" ? result.message : "";
  const isError = result.status === "refused" || result.status === "selection_unresolved";
  const runtimeAfter = compactRuntimeAfterRun(result);
  const cause = capturedCause(result);
  const causeText = typeof cause?.text === "string" ? cause.text : "";
  const filter = composedSelectorFilter(result);

  const causeView = isError || result.status === "not_run" ? "failure" : "outcome";

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

    const first = firstClipped ?? causeView;
    return {
      status: result.status,
      ok: result.ok === true,
      proof_credit: false,
      ...(isError ? { code: result.code, executed: false, authority_limb: MECHANICAL_FAILURE } : {}),
      ...(shownMessage === "" ? {} : { message: shownMessage }),
      ...(messageOmitted > 0 ? { message_omitted_bytes: messageOmitted } : {}),

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

      ...(shownFilter === "" ? {} : { selection: { test_id_filter: shownFilter,
        ...(filterOmitted > 0 ? { omitted_bytes: filterOmitted } : {}) } }),

      ...(runtimeAfter === null ? {} : { runtime_after_run: level >= 3 ? { status: runtimeAfter.status }
        : runtimeAfter }),
      comparison: level >= 2 ? comparisonState(outcome.comparison) : comparisonFacts(outcome.comparison),

      ...(output === null ? {} : { output, native_output_only: true }),
      output_complete: firstClipped === undefined && messageOmitted === 0 && causeOmitted === 0 &&
        filterOmitted === 0,
      ...(retention === null ? {} : { retention }),
      ...(level >= 3 || correction === null ? {} : { correction: typeof correction.rejected === "string"
        ? { ...correction, rejected: clipFact(correction.rejected) } : correction }),
      next_calls: locator === null ? [] : [runTestReadCall(locator, first)]
    };
  };

  const firstLineBytes = Buffer.byteLength(causeText.split("\n", 1)[0], "utf8");
  let fitted = null;
  for (const level of [0, 1, 2, 3, 4]) {
    try {
      const payload = fitPayload({ heads: level >= 4 ? {} : { ...(message === "" ? {} : { message }),
        ...(causeText === "" ? {} : { cause: causeText }), ...(filter === "" ? {} : { filter }) },
      tails: level >= 1 ? {} : streams, assemble: assembleAt(level), isError });
      const shown = payload.cause?.text === undefined ? null : Buffer.byteLength(payload.cause.text, "utf8");
      if (shown === null && fitted !== null) continue;
      if (fitted === null || shown > fitted.shown) fitted = { payload, shown };
      if (shown === null || shown >= firstLineBytes) break;
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
    }
  }
  if (fitted !== null) return { isError, payload: fitted.payload };

  return { isError, payload: { status: result.status, ok: result.ok === true, proof_credit: false,
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

function continuation(page, extra, options = {}) {
  const retained = page.retained_source;
  return buildNextCall({ tool: RUN_TEST_TOOL_NAME, ...options, arguments: { continue: {
    source: locatorOf(retained),
    ...(typeof page.task_result_identity === "string" ? { snapshot_identity: page.task_result_identity } : {}),
    collection: page.collection, ...(page.selector === null || page.selector === undefined
      ? {} : { selector: page.selector }), ...extra } } });
}

function nextFieldPath(view, fieldPath) {
  const layout = VIEW_LAYOUT[view];
  if (layout === undefined || fieldPath.length < 2) return null;
  const [, top, sub] = fieldPath;
  const subs = layout[top];
  if (sub !== undefined && Array.isArray(subs) && subs.indexOf(sub) >= 0 && subs.indexOf(sub) + 1 < subs.length) {
    return ["value", top, subs[subs.indexOf(sub) + 1]];
  }
  const tops = Object.keys(layout);
  return tops.indexOf(top) >= 0 && tops.indexOf(top) + 1 < tops.length
    ? ["value", tops[tops.indexOf(top) + 1]] : null;
}

function showsCorrection(view, fieldPath, value) {
  if (view !== "failure") return false;
  if (fieldPath.length === 1) return (value?.correction ?? null) !== null;
  return fieldPath[1] === "correction" && (fieldPath.length > 2 || (value ?? null) !== null);
}

function following(page, view, fieldPath, value = undefined) {
  const next = nextFieldPath(view, fieldPath);
  if (next !== null) return [continuation(page, { field_path: next }, { reason: "next_field" })];
  const after = showsCorrection(view, fieldPath, value) ? RUN_TEST_VIEWS[0]
    : RUN_TEST_VIEWS[(RUN_TEST_VIEWS.indexOf(view) + 1) % RUN_TEST_VIEWS.length];
  return [runTestReadCall(page.retained_source, after, "next_view")];
}

export function presentRunTestDetail(response) {
  const page = response.page;
  const view = page.selector?.id ?? null;
  const base = { observation: response.observation?.kind ?? "retained_prior_observation", executed: false };
  if (!Array.isArray(page.field_path)) {

    const views = (page.items ?? []).map((item) => item?.stable_id ?? item?.id ?? null);
    return { ...base, read: { views, total: page.total ?? page.matched_count ?? views.length },
      next_calls: [runTestReadCall(page.retained_source,
        RUN_TEST_VIEWS.find((known) => views.includes(known)) ?? RUN_TEST_VIEWS[0])] };
  }
  const fieldPath = page.field_path;
  const read = { view, ...(fieldPath.length > 1 ? { field: fieldPath.slice(1) } : {}) };
  if (typeof page.value_base64 === "string") {
    const bytes = Buffer.from(page.value_base64, "base64");
    let start = 0;
    while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start += 1;
    const body = bytes.subarray(start);
    const build = (cap) => {
      const length = utf8HeadLength(body, cap);
      const offset = page.offset + start;
      const nextOffset = offset + length < page.total ? offset + length : null;
      return { ...base, read: { ...read, offset, length, total: page.total,
        text: body.subarray(0, length).toString("utf8"), next_offset: nextOffset },
      next_calls: nextOffset === null ? following(page, view, fieldPath) : [continuation(page,
        { field_path: fieldPath, offset: nextOffset, length: Math.min(READ_RANGE_BYTES, page.total - nextOffset) },
        { recommended: true })] };
    };

    return build(Math.max(largestFitting(body.length, build, false), 0));
  }
  if (page.range_required === true) {
    return { ...base, read: { ...read, total: page.total, range_required: true, next_offset: 0 },
      next_calls: [continuation(page, { field_path: fieldPath, offset: 0,
        length: Math.min(READ_RANGE_BYTES, page.total) }, { recommended: true }),
      ...following(page, view, fieldPath)] };
  }
  if (Array.isArray(page.fields)) {

    return { ...base, read: { ...read, complete: false, field_count: page.total ?? page.fields.length },
      next_calls: page.fields.length === 0 ? following(page, view, fieldPath)
        : [continuation(page, { field_path: page.fields[0].path }, { recommended: true, reason: "first_field" })] };
  }
  const value = page.value;
  const stream = RUN_TEST_STREAM_VIEWS.includes(view) && fieldPath.length === 1;
  const shown = stream && (value === null || value === undefined) ? { state: "not_attempted" }
    : stream && value === "" ? { state: "empty", total: 0 }
      : typeof value === "string" ? { text: value, total: page.total ?? null, next_offset: null }
        : value === undefined ? { state: "absent" } : { value };
  return { ...base, read: { ...read, ...shown }, next_calls: following(page, view, fieldPath, value) };
}
