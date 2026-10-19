

const MAX_STEPS = 4096;
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const factsFor = () => ({ session_id: null, session_conflict: false, client_version: null,
  snapshots: [], requests: [], requests_truncated: false, terminal_event: false, error_event: false,
  usage_presence: "unverified", descendant_coverage: "root_only", final_text: null, protocol_events: 0,
  observation_count: 0 });
function bind(facts, id) {
  if (typeof id !== "string" || id === "") throw new Error("native_usage_session_missing");
  if (facts.session_id === null) facts.session_id = id;
  else if (facts.session_id !== id) {
    facts.session_conflict = true;
    throw new Error("native_usage_session_conflict");
  }
}
function put(steps, id, value, { replace = false } = {}) {
  if ((typeof id !== "string" && !Number.isSafeInteger(id)) || id === "") throw new Error("native_usage_step_identity_missing");
  if (!replace && steps.has(id) && JSON.stringify(steps.get(id)) !== JSON.stringify(value)) {
    throw new Error("native_usage_step_conflict");
  }
  if (!steps.has(id) && steps.size >= MAX_STEPS) throw new Error("native_usage_step_limit");
  const changed = JSON.stringify(steps.get(id)) !== JSON.stringify(value);
  steps.set(id, value);
  return changed;
}
const openCodeSource = Object.freeze({ id: "opencode.native.step_finish", input_semantics: "exclusive",
  counter_kind: "incremental", descendant_coverage: "root_only", cost_source: "opencode.step_finish.cost" });
function openCodeExtractor() {
  const facts = factsFor();
  const steps = new Map();

  return { bindSession(id, { clientVersion = null } = {}) {
    bind(facts, id);
    if (clientVersion !== null) {
      if (clientVersion !== "1.19.3") throw new Error("native_usage_client_version_unsupported");
      facts.client_version = clientVersion;
    }
  }, accept(event) {
    if (!object(event) || !["step_start", "step_finish", "text", "reasoning", "tool_use", "error"].includes(event.type)) return "";
    facts.protocol_events += 1;
    bind(facts, event.sessionID);
    if (event.type === "error") { facts.error_event = true; facts.terminal_event = false; return ""; }
    const part = event.part;
    if (!object(part) || part.sessionID !== facts.session_id || typeof part.messageID !== "string") {
      throw new Error("native_usage_part_identity_conflict");
    }
    if (event.type === "step_start") facts.terminal_event = false;
    if (event.type === "step_finish") {
      const tokens = part.tokens;
      const changed = put(steps, part.id, { message_id: part.messageID, counters: { input: tokens?.input, cache_read: tokens?.cache?.read,
        cache_creation: tokens?.cache?.write, output: [tokens?.output, tokens?.reasoning],
        reasoning_output: tokens?.reasoning }, cost: part.cost });
      if (!changed) return "";
      facts.usage_presence = object(tokens) ? "present" : "absent";
      facts.terminal_event = ["stop", "length", "content-filter"].includes(part.reason);
      facts.observation_count += 1;
      facts.events = [...steps].map(([id, step]) => ({ event_id: id, counters: step.counters,
        cost: step.cost === undefined || step.cost === null ? null
          : { amount: step.cost, currency: "USD", source: openCodeSource.cost_source } }));
      facts.requests = [...steps].map(([id, step]) => ({ request_id: id, counters: step.counters }));
    }

    return "";
  }, facts: () => facts };
}
const agySource = Object.freeze({ id: "agy.stream_json.result_usage", input_semantics: "inclusive",
  counter_kind: "cumulative", descendant_coverage: "root_only", cost_source: null });
function agyCounters(usage) {
  return { input: [usage?.input_tokens, usage?.cache_read_tokens], cache_read: usage?.cache_read_tokens,
    output: usage?.output_tokens, reasoning_output: usage?.thinking_tokens };
}
function agyExtractor() {
  const facts = factsFor();
  const steps = new Map();
  let aggregateSeen = false;
  let lastAggregate = null;
  const coveredSteps = new Set();
  return { accept(event) {
    if (!object(event) || !["init", "step_update", "result"].includes(event.event)) return "";
    facts.protocol_events += 1;
    if (event.event === "init") bind(facts, event.conversation_id);
    if (event.event === "step_update") {
      const step = event.step_update;
      bind(facts, step?.conversation_id);
      if (object(step?.usage)) {
        if (!Number.isSafeInteger(step.step_index) || step.step_index < 0) throw new Error("native_usage_step_identity_missing");
        if (coveredSteps.has(step.step_index)) return "";
        if (!put(steps, step.step_index, agyCounters(step.usage), { replace: true })) return "";
        facts.terminal_event = false;
        facts.observation_count += 1;

        facts.interval_only = !aggregateSeen;
        facts.snapshots = [{ sequence: facts.observation_count,
          counter_sets: [...(lastAggregate === null ? [] : [lastAggregate]), ...steps.values()], cost: null }];
        facts.usage_presence = "present";
        facts.requests = [...steps].map(([id, counters]) => ({ request_id: String(id), counters }));
      } else {
        facts.terminal_event = false;
      }
    }
    if (event.event === "result") {
      const result = event.result;
      bind(facts, result?.conversation_id);
      facts.terminal_event = ["SUCCESS", "ERROR", "CANCELED", "INTERRUPTED", "INVALID"].includes(result.status);
      facts.error_event = result.status !== "SUCCESS";
      if (object(result.usage)) {
        if (!aggregateSeen) facts.snapshots = [];
        aggregateSeen = true;
        facts.interval_only = false;
        lastAggregate = agyCounters(result.usage);
        for (const index of steps.keys()) coveredSteps.add(index);
        if (coveredSteps.size > MAX_STEPS) throw new Error("native_usage_step_limit");
        steps.clear();
        if (facts.snapshots.length >= MAX_STEPS) throw new Error("native_usage_report_limit");
        facts.observation_count += 1;
        facts.snapshots.push({ sequence: facts.observation_count, counter_sets: [agyCounters(result.usage)], cost: null });
        facts.usage_presence = "present";
      } else {
        facts.usage_presence = "absent";
      }
    }
    return "";
  }, facts: () => facts };
}
const selected = (args, flag, format) => args.includes(flag) && args[args.indexOf(flag) + 1] === format;
export const STEP_NATIVE_USAGE_ADAPTERS = Object.freeze({
  opencode: Object.freeze({ family: "opencode", source: openCodeSource, preserveProtocol: true,
    outputArgs: args => args.includes("run") && selected(args, "--format", "json") ? args : null,
    finalTextFromStream: false, createExtractor: openCodeExtractor }),
  agy: Object.freeze({ family: "agy", source: agySource, preserveProtocol: true,
    outputArgs: args => args.includes("--print") && selected(args, "--output-format", "stream-json") ? args : null,
    finalTextFromStream: false, createExtractor: agyExtractor })
});
