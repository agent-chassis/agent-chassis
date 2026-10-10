
import { NATIVE_USAGE_ADAPTERS } from "./native-usage-adapters.mjs";
import { AGENT_RUN_USAGE_TOKEN_QUANTITIES, reconcileInvocationUsage } from "./agent-run-usage.mjs";
import { createNativeUsageJsonlDecoder } from "./native-usage-jsonl.mjs";

export const AGENT_RUN_USAGE_RECORD_SCHEMA_VERSION = "agent-run-usage-record.v1";
export const NATIVE_USAGE_INVOCATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

const IDENTITY_KEYS = ["invocation_id", "attempt_id", "run_id", "parent_invocation_id", "repo", "subject",
  "role", "route", "mode"];
const COUNTER_SLOTS = ["input", "cache_read", "cache_creation", "output", "reasoning_output"];

function invalid(code, message) {
  const error = new TypeError(message);
  error.code = code;
  return error;
}

function readIdentity(identity) {
  if (identity === null || typeof identity !== "object" || Array.isArray(identity)) {
    throw invalid("native_usage_capture_invalid_identity", "native usage capture requires a launcher identity object");
  }
  const bound = {};
  for (const key of IDENTITY_KEYS) {
    const value = identity[key] ?? null;
    if (value !== null && (typeof value !== "string" || value === "")) {
      throw invalid("native_usage_capture_invalid_identity", "native usage capture identity fields are non-empty strings or null");
    }
    bound[key] = value;
  }
  if (bound.invocation_id === null || !NATIVE_USAGE_INVOCATION_ID_PATTERN.test(bound.invocation_id)) {
    throw invalid("native_usage_capture_invalid_identity", "native usage capture requires a launcher invocation_id");
  }
  return bound;
}

function mergeCounterSets(sets) {
  const merged = {};
  for (const slot of COUNTER_SLOTS) {
    let total = null;
    for (const set of sets) {
      const value = set?.[slot];
      if (!Number.isSafeInteger(value) || value < 0) {
        total = value ?? null;
        break;
      }
      total = (total ?? 0) + value;
      if (!Number.isSafeInteger(total)) break;
    }
    merged[slot] = sets.length === 0 ? null : total;
  }
  return merged;
}

const demote = (quantity) => (quantity.status === "complete"
  ? { value: null, observed: quantity.observed, status: "partial" } : quantity);

export function buildNativeUsageRecord({ family, source, identity: bound, resumed, facts, stream, drained, damaged = false,
  baseline = null, usagePresence = null, exit = null, causes = [], startedAt, now }) {
  const note = (code, quantity = null, detail = null) => causes.push({ code, quantity, detail });
  const presence = usagePresence === "present" || usagePresence === "absent" ? usagePresence : facts.usage_presence;
  const buildBaseline = () => {
    if (resumed === false) return { kind: "fresh_session", session_created: true, session_id: facts.session_id };
    if (resumed !== true || baseline === null || typeof baseline !== "object") return null;
    const end = baseline.end_snapshot;
    if (baseline.family !== family || baseline.native_session_id !== facts.session_id
        || baseline.source?.id !== source.id || end === null || typeof end !== "object") {
      note("baseline_not_bound_to_session");
      return null;
    }
    return { kind: "snapshot", session_id: facts.session_id, source_id: source.id, population_id: facts.session_id,
      interval_id: bound.invocation_id, counters: end.counters, cost: end.cost ?? null };
  };
  const snapshots = facts.snapshots.map((snapshot) => ({ sequence: snapshot.sequence, session_id: facts.session_id,
    source_id: source.id, population_id: facts.session_id, counters: mergeCounterSets(snapshot.counter_sets),
    cost: snapshot.cost }));
  const usage = reconcileInvocationUsage({
    identity: { invocation_id: bound.invocation_id, session_id: facts.session_id, source_id: source.id,
      population_id: facts.session_id, interval_id: bound.invocation_id },
    source: { input_semantics: source.input_semantics, counter_kind: source.counter_kind,
      descendant_coverage: facts.descendant_coverage },
    baseline: facts.session_id === null ? null : buildBaseline(),
    snapshots,

    requests: { coverage_complete: false, observations: facts.requests }
  });
  for (const cause of usage.causes) note(cause.code, cause.quantity, cause.detail);

  if (facts.session_conflict) note("native_session_changed");
  if (stream.complete !== true) note("stream_incomplete", null, { diagnostics: stream.diagnostics, drained });
  if (!facts.terminal_event) note("terminal_usage_missing");
  if (facts.requests_truncated) note("request_observations_truncated", "peak_context");
  const reported = AGENT_RUN_USAGE_TOKEN_QUANTITIES.some((name) => (usage.tokens[name].observed ?? 0) > 0);
  if (presence === "absent") note("source_usage_absent");
  else if (presence !== "present" && !reported && facts.terminal_event) note("source_usage_presence_unverified");
  const incomplete = facts.session_conflict || stream.complete !== true || damaged
    || !facts.terminal_event || presence === "absent" || (presence !== "present" && !reported);

  const tokens = {};
  for (const name of AGENT_RUN_USAGE_TOKEN_QUANTITIES) {
    tokens[name] = incomplete ? demote(usage.tokens[name]) : usage.tokens[name];
  }
  const cost = { ...usage.cost, amount: incomplete ? demote(usage.cost.amount) : usage.cost.amount };
  const last = snapshots.at(-1) ?? null;
  return Object.freeze({
    schema_version: AGENT_RUN_USAGE_RECORD_SCHEMA_VERSION,
    ...bound,
    family,
    client_version: facts.client_version,
    native_session_id: facts.session_id,
    source: { id: source.id, input_semantics: source.input_semantics, counter_kind: source.counter_kind,
      descendant_coverage: usage.descendant_coverage, usage_presence: presence },
    resumed,
    status: tokens.total.status,
    tokens,
    cost,
    peak_context: usage.peak_context,

    end_snapshot: last === null || stream.complete !== true ? null
      : { sequence: last.sequence, counters: last.counters, cost: last.cost },
    stream: { complete: stream.complete === true, records: stream.records, diagnostics: stream.diagnostics,
      drained, terminal_event: facts.terminal_event, error_event: facts.error_event },
    exit: exit === null ? null : { code: exit.code ?? null, signal: exit.signal ?? null },
    causes,
    started_at: startedAt,
    settled_at: now().toISOString()
  });
}

export function bindNativeUsageIdentity(identity) {
  return readIdentity(identity);
}

export function createNativeUsageCapture({ family, identity, resumed, baseline = null, onText = null,
  now = () => new Date() } = {}) {
  const adapter = Object.hasOwn(NATIVE_USAGE_ADAPTERS, family) ? NATIVE_USAGE_ADAPTERS[family] : null;
  if (adapter === null) throw invalid("native_usage_capture_unknown_family", "native usage capture requires a known client family");
  if (resumed !== true && resumed !== false && resumed !== null) {
    throw invalid("native_usage_capture_invalid_resumed", "native usage capture requires resumed to be true, false or null");
  }
  if (onText !== null && typeof onText !== "function") {
    throw invalid("native_usage_capture_invalid_on_text", "native usage capture onText must be a function or null");
  }
  const bound = readIdentity(identity);
  const startedAt = now().toISOString();
  const extractor = adapter.createExtractor();
  const causes = [];
  const note = (code, quantity = null, detail = null) => causes.push({ code, quantity, detail });
  let sinkError = null;
  let extractorFailures = 0;
  let drained = null;
  let record = null;

  const emit = (text) => {
    if (onText === null || text === "" || sinkError !== null) return;
    try {
      onText(text);
    } catch (error) {
      sinkError = { error };
    }
  };
  const decoder = createNativeUsageJsonlDecoder({
    onRecord: ({ value }) => {
      let text = "";
      try {
        text = extractor.accept(value);
      } catch {
        extractorFailures += 1;
      }
      emit(text);
    },
    onDiagnostic: () => {}
  });
  const surfaceSinkError = () => {
    if (sinkError === null || sinkError.raised) return;
    sinkError.raised = true;
    throw sinkError.error;
  };

  function push(chunk) {
    if (record !== null || drained !== null) return;
    decoder.push(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk);
    surfaceSinkError();
  }

  function end(observation) {
    if (record !== null || drained !== null) return;
    drained = observation?.drained === true;
    decoder.finish(drained);
    const facts = extractor.facts();
    if (adapter.finalTextFromStream && facts.final_text !== null) emit(`${facts.final_text}\n`);
    surfaceSinkError();
  }

  function settle(observation = {}) {
    if (record !== null) return record;
    if (drained === null) end({ drained: false });
    if (extractorFailures > 0) note("event_extraction_failed", null, { events: extractorFailures });
    if (sinkError !== null) note("text_sink_failed");
    record = buildNativeUsageRecord({ family, source: adapter.source, identity: bound, resumed, facts: extractor.facts(),
      stream: decoder.getState(), drained: drained === true, damaged: extractorFailures > 0,
      baseline: observation.baseline === undefined ? baseline : observation.baseline,
      usagePresence: observation.usagePresence ?? null, exit: observation.exit ?? null, causes, startedAt, now });
    return record;
  }

  function provisional(observation = {}) {
    const facts = extractor.facts();
    if (record !== null || facts.snapshots.length === 0) return null;
    const read = decoder.getState();
    return buildNativeUsageRecord({ family, source: adapter.source, identity: bound, resumed, facts,
      stream: { complete: false, records: read.records, diagnostics: read.diagnostics }, drained: false,
      baseline: observation.baseline === undefined ? baseline : observation.baseline, causes: [], startedAt, now });
  }

  return Object.freeze({ push, end, settle, finalText: () => extractor.facts().final_text,
    sessionId: () => extractor.facts().session_id, events: () => extractor.facts().protocol_events,
    observations: () => extractor.facts().snapshots.length, provisional });
}
