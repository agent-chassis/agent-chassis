

import { buildNextCall } from '@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs';
import { RUN_TEST_STREAM_VIEWS, RUN_TEST_TOOL_NAME } from './run-test-input.mjs';
import { fitPayload, omitted, clippable, fitsRunTestResponse } from './run-test-format.mjs';
import { runTestReadCall, runTestRetryCall, nativeResult,
  settledFailure, refusalAction, runFacts, runTestEnvironmentSelection } from './run-test-carrier.mjs';
import { taskCapturedCause, taskFailureDiagnostic, distillCorrection, sourceFailureDetail } from './run-test-diagnosis.mjs';
export { RUN_TEST_RESPONSE_MAX_BYTES } from './run-test-format.mjs';
export { RUN_TEST_RETAINED_KINDS, runTestReadCall, runTestRetryCall, runTestViewSelection,
  runTestExpectedBinding, projectRunTestNativeResult, runTestCarrier, runTestRetentionFailure,
  runTestEnvironmentSelection } from './run-test-carrier.mjs';

const optionalRead = (locator, view) => ({ ...runTestReadCall(locator, view), recommended: false });
const sparse = facts => Object.fromEntries(Object.entries(facts).filter(([, value]) =>
  value !== null && value !== undefined && value !== false));
const materialRun = run => run === undefined || run === null ? {} : sparse(runFacts(run));
const presentDiagnostic = diagnostic => diagnostic == null ? null : diagnostic.semantic !== undefined
  ? { ...(diagnostic.failure === undefined ? {} : { failure: diagnostic.failure }), ...diagnostic.semantic }
  : diagnostic.identified === false
  ? { identified: false, ...sparse({ failure: diagnostic.failure, failures: diagnostic.failures }) }
  : { ...(diagnostic.identified === undefined ? {} : { identified: diagnostic.identified,
      ...(diagnostic.failure === undefined ? {} : { failure: diagnostic.failure }) }),
    ...(diagnostic.phase === undefined ? {} : { phase: diagnostic.phase }),
    ...(diagnostic.attributed === false ? { attributed: false } : {}),
    source: diagnostic.source ?? diagnostic.view,
    ...(diagnostic.text === undefined ? {} : { text: diagnostic.text }),
    ...(diagnostic.context === undefined ? {} : { context: diagnostic.context }) };

function fitMeaning(value, nextCalls = [], { isError = false, tails = false, completeCall = null } = {}) {
  const texts = {};
  const project = (node, trail = '') => {
    if (typeof node === 'string' && clippable(node)) {
      texts[trail] = node;
      return shown => shown[trail];
    }
    if (node === null || typeof node !== 'object') return () => node;
    if (Array.isArray(node)) {
      const items = node.map((child, index) => project(child, `${trail}.${index}`));
      return shown => items.map(item => item(shown));
    }
    const items = Object.entries(node).map(([key, child]) => [key, project(child, trail ? `${trail}.${key}` : key)]);
    return shown => Object.fromEntries(items.map(([key, build]) => [key, build(shown)]));
  };
  const build = project(value);
  const decidingText = key => /^(?:cause\.(?:text|context)|message|action|recovery\.action|read\.(?:message|action|diagnostic\.(?:text|context)))$/u.test(key);
  const priority = Object.fromEntries(Object.entries(texts).filter(([key]) => decidingText(key)));
  const remaining = Object.fromEntries(Object.entries(texts).filter(([key]) => !decidingText(key)));
  const fit = calls => fitPayload({ ...(tails ? { tails: texts } : { heads: [priority, remaining] }), isError,
    assemble: (heads, ends) => {
      const shown = tails ? ends : heads;
      const missing = Object.fromEntries(Object.entries(texts).map(([key, text]) => [key, omitted(text, shown[key])])
        .filter(([, bytes]) => bytes > 0));
      return { ...build(shown), ...(Object.keys(missing).length ? { omitted_bytes: missing } : {}), next_calls: calls };
    } });
  const bounded = fit(nextCalls);
  return completeCall !== null && bounded.omitted_bytes !== undefined
    ? fit([completeCall, ...nextCalls]) : bounded;
}

function sourceMeaning(source) {
  const identity = source.identity ?? {};
  const current = source.currentness ?? {};
  return { kind: identity.kind, ...(identity.branch === null ? {} : { branch: identity.branch }),
    commit: identity.commit, dirty: identity.dirty, current: current.current,
    ...(current.moved === null ? {} : { moved: current.moved }),
    ...(current.status === 'unknown' ? { observation: 'unknown', code: current.code, message: current.message } : {}) };
}
function comparisonMeaning(comparison, { identities = false } = {}) {
  const state = comparison.eligibility;
  if (state.state === 'not_reached') return state;
  const side = row => ({ ...(identities ? { commit: row.commit } : {}), status: row.status, ok: row.ok,
    exit_code: row.exit_code, ...sparse({ signal: row.signal, timed_out: row.timed_out,
      cancelled: row.cancelled, output_lost: row.output_lost, code: row.code }),
    ...(row.current === false ? { current: false, moved: row.moved } : {}),
    ...(row.observation?.status === 'unknown' ? { current: null, observation: 'unknown',
      code: row.observation.code, message: row.observation.message } : {}) });
  return { state: state.state, ...(state.reason === null ? {} : { reason: state.reason }),
    ...(identities ? { candidate: side(comparison.candidate) } : {}),
    ...(comparison.baseline.status === null ? {} : { baseline: side(comparison.baseline) }),
    ...(comparison.failure === undefined ? {} : { failure: { code: comparison.failure.code,
      stage: comparison.failure.stage, message: comparison.failure.message } }) };
}
function runtimeMeaning(runtime) {
  if (runtime?.status !== 'changed' && runtime?.status !== 'unknown') return null;
  return Object.fromEntries(Object.entries(runtime).filter(([, value]) => value !== null));
}

function environmentMeaning({ selection, code, locator, recovery, correction, retained, retention,
  completeSemantic = false, completeCall = null }) {
  const calls = recovery?.call == null ? [] : [recovery.call];
  if (correction?.retry_request != null) calls.push(...selection.valid_choices.map(environment => ({
    ...runTestRetryCall(correction.retry_request, { changes: { environment } }, 'choose_environment'), recommended: false
  })));
  const value = { ...(retained ? { observation: 'retained_prior_observation', executed: false,
    read: { view: 'failure', code, ...selection } } : { status: 'refused', ok: false, code, executed: false, ...selection }) };
  const target = retained ? value.read : value;
  if (recovery !== null && recovery !== undefined) {
    if (recovery.call === null) target.recovery = recovery.recovery;
    else {
      target.testimony_required = ['Confirm facts; supply completed_work and remaining_work before submission.'];
      target.acceptance_effect = 'Ends this worker attempt; no automatic submission.';
    }
  }
  if (retention != null) target.retention = retention;

  const detailCall = !retained && locator !== null ? optionalRead(locator, 'failure') : null;
  if (detailCall !== null && fitsRunTestResponse({ ...value, next_calls: [...calls, detailCall] }, !retained)) calls.push(detailCall);
  if (completeSemantic || fitsRunTestResponse({ ...value, next_calls: calls }, !retained)) return { ...value, next_calls: calls };
  if (completeCall !== null) return fitMeaning({ ...(retained ? { observation: 'retained_prior_observation' }
    : { status: 'refused', ok: false }), code, executed: false, reason: selection.reason,
    requested_environment: selection.requested_environment,
    action: 'Read the complete environment choices and correction before choosing.' }, [completeCall], { isError: !retained });

  return fitMeaning({ ...(retained ? { observation: 'retained_prior_observation' } : { status: 'refused', ok: false }),
    code, executed: false, reason: selection.reason, requested_environment: selection.requested_environment,
    stopping_condition: 'The complete environment choice and correction do not fit this route. No bounded environment-choice reader is available.' }, [], { isError: !retained });
}

export function presentRunTestAnswer({ outcome, locator, retention = null, correction = null,
  environmentRecovery = null, carrier, completeCall = null }) {
  if (carrier === null || typeof carrier !== 'object') throw new TypeError('A settled native carrier is required for presentation');
  const settled = outcome.candidate.result;
  const result = nativeResult(settled);
  const isError = ['refused', 'selection_unresolved'].includes(settled.status);
  const environment = runTestEnvironmentSelection(result);
  if (environment !== null) return { isError: true, payload: environmentMeaning({ selection: environment,
    code: result.code, locator, recovery: environmentRecovery, correction, retained: false, retention, completeCall }) };
  const current = outcome.candidate.source;
  const runtime = runtimeMeaning(carrier.outcome.runtime_after_run);
  const material = { ...(current.current === false || current.status === 'unknown'
    ? { source: { current: current.current ?? null, ...(current.reason === undefined ? {} : { moved: current.reason }),
      ...(current.status === 'unknown' ? { observation: 'unknown', code: current.code, message: current.message } : {}) } } : {}),
    ...(runtime === null ? {} : { runtime_after_run: runtime }),
    ...(retention === null ? {} : { retention }) };
  const optionalOutcome = locator === null ? [] : [optionalRead(locator, 'outcome')];
  if (settled.ok === true) {
    const limits = sparse({ cleanup_failed: result.run?.cleanup_failed,
      output_lost: result.run?.output_truncated });
    return { isError: false, payload: fitMeaning({ ok: true,
      ...(Object.keys(limits).length ? { run: limits } : {}), ...material }, optionalOutcome) };
  }
  const run = result.run;
  const diagnostic = taskCapturedCause(result, carrier);
  const cause = presentDiagnostic(diagnostic);
  const failure = settledFailure(result);
  const action = refusalAction(failure, correction);
  const unconfirmed = carrier.outcome.execution.executed === 'unknown';
  const recovery = unconfirmed ? run?.completion_recovery : null;
  const message = result.message ?? (unconfirmed ? 'Command completion is unknown; tests may have executed.'
    : run?.timed_out ? 'The command exceeded its execution budget.'
      : run?.cancelled ? 'The command was interrupted by cancellation.'
        : run?.signal ? `The command terminated with ${run.signal}.`
          : cause === null ? `The command exited with code ${run?.exit_code ?? 'unknown'} without a captured failure diagnosis.` : null);

  const calls = locator === null ? [] : diagnostic?.semantic !== undefined
    ? [...(diagnostic.failures > 1 ? [runTestReadCall(locator, 'failure', 'next_failed_result', 2)] : []), optionalRead(locator, 'outcome')]
    : [runTestReadCall(locator, 'failure'), optionalRead(locator, 'outcome')];
  return { isError, payload: fitMeaning({ status: settled.status, ok: false,
    ...(carrier.outcome.shown_file == null ? {} : { shown_file: carrier.outcome.shown_file,
      file_status: result.status }),
    ...(typeof result.code === 'string' ? { code: result.code } : {}),
    ...(isError ? { executed: false } : {}),
    ...(cause === null ? {} : { cause }), ...(message === null ? {} : { message }),
    ...(action === null ? {} : { action }), ...(run === undefined ? {} : { run: materialRun(run) }),
    ...(recovery == null ? {} : { recovery: { action: recovery.action, repair_call: recovery.repair_call,
      automatic_rerun: recovery.automatic_rerun } }),
    ...(correction?.retry_request == null ? {} : { correction }),
    comparison: comparisonMeaning(carrier.comparison), ...material }, calls, { isError,
      completeCall: cause?.text === undefined && cause?.context === undefined ? completeCall : null }) };
}

function executionMeaning(execution) {
  return { status: execution.status, ok: execution.ok, executed: execution.executed,
    ...Object.fromEntries(Object.entries(execution).filter(([key, value]) =>
      ['code', 'exit_code', 'signal', 'timed_out', 'cancelled', 'cleanup_failed', 'output_lost', 'blocker'].includes(key) &&
      value !== null && value !== false)) };
}
const streamCalls = (carrier, locator, side) => ['stdout', 'stderr']
  .map(stream => `${side}_${stream}`).filter(view => carrier[view] !== null && carrier[view] !== undefined)
  .map(view => optionalRead(locator, view));

export function presentRunTestRead({ view, carrier, locator, failure = null, environmentRecovery = null,
  completeSemantic = false, completeCall = null }) {
  const base = { observation: 'retained_prior_observation', executed: false };
  if (view === 'failure' && carrier.failure?.environment_selection !== undefined) return environmentMeaning({
    selection: carrier.failure.environment_selection, code: carrier.failure.cause.code, locator,
    recovery: environmentRecovery, correction: carrier.failure.correction, retained: true, completeSemantic, completeCall });
  if (RUN_TEST_STREAM_VIEWS.includes(view)) {
    const value = carrier[view];
    if (value === null || value === undefined) return { ...base, read: { view, state: 'not_attempted' }, next_calls: [] };
    if (value === '') return { ...base, read: { view, state: 'empty' }, next_calls: [] };
    return fitMeaning({ ...base, read: { view, state: 'captured', text: value } }, [], { tails: true });
  }
  let value;
  let calls = [];
  switch (view) {
    case 'outcome': {
      const result = carrier.outcome;
      value = { ...executionMeaning(result.execution), timeout_ms: result.request.timeout_ms,
        ...(result.shown_file == null || result.execution.ok ? {} : { shown_file: result.shown_file }) };
      calls = [optionalRead(locator, 'source'),
        ...(carrier.comparison.eligibility.state === 'not_reached' ? [] : [optionalRead(locator, 'comparison')]),
        ...(result.execution.ok === true ? [] : [optionalRead(locator, 'failure')]), ...streamCalls(carrier, locator, 'candidate')];
      break;
    }
    case 'source': value = sourceMeaning(carrier.source); break;
    case 'comparison':
      value = comparisonMeaning(carrier.comparison, { identities: true });
      calls = streamCalls(carrier, locator, 'baseline');
      break;
    case 'failure': {
      const selected = taskFailureDiagnostic(carrier, failure);
      const original = carrier.failure;
      const detail = sourceFailureDetail(original);
      value = { ...(original.cause.present ? { cause: { stage: original.cause.stage, code: original.cause.code,
          ...(original.cause.cause_code === null || original.cause.cause_code === original.cause.code
            ? {} : { cause_code: original.cause.cause_code }) } } : {}),
        effects: { candidate_executed: original.effects.candidate_executed,
          baseline_executed: original.effects.baseline_executed, ...sparse({ cleanup_failed: original.effects.cleanup_failed,
            output_lost: original.effects.output_lost }) },
        ...(original.message === null ? {} : { message: distillCorrection(original.message) }),
        ...(original.action === null ? {} : { action: original.action }),
        ...(detail === null ? {} : { detail }),
        ...(selected === null ? {} : { diagnostic: presentDiagnostic(selected) }),
        ...(original.correction?.retry_request == null ? {} : { correction: original.correction }) };
      if (original.recovery !== null) {
        const recovery = JSON.parse(original.recovery);
        if (original.cause.stage === 'source_authentication' && Array.isArray(recovery.next_calls))
          calls.push(...recovery.next_calls);
        if (recovery.action !== undefined || recovery.statement !== undefined) value.recovery = {
          action: recovery.action ?? recovery.statement,
          ...(recovery.repair_call === undefined ? {} : { repair_call: recovery.repair_call }),
          ...(recovery.automatic_rerun === undefined ? {} : { automatic_rerun: recovery.automatic_rerun }) };
      }
      if (selected?.identified === true && (failure ?? 1) < selected.failures)
        calls.push(runTestReadCall(locator, 'failure', 'next_failed_result', (failure ?? 1) + 1));
      if (selected?.identified === false && selected.failures > 0) {
        if (selected.failures === 1) calls.push(runTestReadCall(locator, 'failure', 'correct_failure_selection', 1));
        else value.required_choice = { field: 'read.failure', minimum: 1, maximum: selected.failures };
      }
      calls.push(...streamCalls(carrier, locator, 'candidate'));
      break;
    }
    default: throw new TypeError(`Unknown native result view: ${view}`);
  }

  const structured = view !== 'failure' || value.diagnostic?.text === undefined && value.diagnostic?.context === undefined;
  if (completeSemantic) {
    if (!structured) {
      const { failures: _failures, ...limits } = carrier.failure.semantic_diagnosis ?? {
        state: 'unavailable', reason: 'structured_failure_diagnosis_unavailable',
        uncertainty: 'Captured output does not establish a structured failure diagnosis.' };
      value.diagnostic = limits;
      calls = [{ ...optionalRead(locator, 'failure'),
        condition: 'if a bounded captured excerpt is needed; it does not establish causal attribution' }];
    }
    return { ...base, read: { view, ...value },
      next_calls: calls.filter(call => !RUN_TEST_STREAM_VIEWS.includes(call.arguments?.read?.view)) };
  }
  return fitMeaning({ ...base, read: { view, ...value } }, calls, { completeCall: structured ? completeCall : null });
}

function scalarDetail(detail) {
  return Object.fromEntries(Object.entries(detail ?? {}).filter(([, value]) =>
    value === null || ["string", "number", "boolean"].includes(typeof value)));
}

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
