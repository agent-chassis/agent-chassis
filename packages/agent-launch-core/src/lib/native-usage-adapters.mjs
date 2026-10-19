import { STEP_NATIVE_USAGE_ADAPTERS } from "./native-usage-step-adapters.mjs";

const MAX_REQUEST_OBSERVATIONS = 4096;

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function baseFacts(descendantCoverage) {
  return {
    session_id: null,
    session_conflict: false,
    client_version: null,
    snapshots: [],
    requests: [],
    requests_truncated: false,
    terminal_event: false,
    error_event: false,
    usage_presence: "unverified",
    descendant_coverage: descendantCoverage,
    final_text: null,
    protocol_events: 0
  };
}

function bindSession(facts, sessionId) {
  if (typeof sessionId !== "string" || sessionId === "") return;
  if (facts.session_id === null) facts.session_id = sessionId;
  else if (facts.session_id !== sessionId) facts.session_conflict = true;
}

const CLAUDE_SOURCE = Object.freeze({
  id: "claude.stream_json.result_model_usage",

  input_semantics: "exclusive",

  counter_kind: "cumulative",

  descendant_coverage: "inclusive",
  cost_source: "claude.result.total_cost_usd"
});

function createClaudeExtractor() {
  const facts = baseFacts(CLAUDE_SOURCE.descendant_coverage);
  const seenRequests = new Set();
  let withUsage = 0;
  let withoutUsage = 0;
  return {
    accept(event) {
      if (!isObject(event)) return "";
      if (["system", "assistant", "user", "result"].includes(event.type) && typeof event.session_id === "string") {
        facts.protocol_events += 1;
      }
      bindSession(facts, event.session_id);
      if (event.type === "system" && event.subtype === "init") {
        if (typeof event.claude_code_version === "string") facts.client_version = event.claude_code_version;
      } else if (event.type === "assistant" && isObject(event.message)) {
        const id = event.message.id;
        if (typeof id !== "string" || id === "" || seenRequests.has(id)) return "";
        const usage = event.message.usage;
        if (!isObject(usage)) {
          withoutUsage += 1;
        } else {
          withUsage += 1;
          if (seenRequests.size < MAX_REQUEST_OBSERVATIONS) {
            facts.requests.push({ request_id: id, counters: { input: usage.input_tokens,
              cache_read: usage.cache_read_input_tokens, cache_creation: usage.cache_creation_input_tokens } });
          } else {
            facts.requests_truncated = true;
          }
        }
        if (seenRequests.size < MAX_REQUEST_OBSERVATIONS) seenRequests.add(id);
        facts.usage_presence = withoutUsage > 0 ? "absent" : withUsage > 0 ? "present" : "unverified";
      } else if (event.type === "result") {
        facts.terminal_event = true;
        if (event.is_error === true) facts.error_event = true;
        if (typeof event.result === "string") facts.final_text = event.result;
        const models = isObject(event.modelUsage) ? Object.values(event.modelUsage) : [];
        facts.snapshots.push({
          sequence: facts.snapshots.length + 1,
          counter_sets: models.map((model) => ({ input: model?.inputTokens, cache_read: model?.cacheReadInputTokens,
            cache_creation: model?.cacheCreationInputTokens, output: model?.outputTokens })),
          cost: event.total_cost_usd === undefined || event.total_cost_usd === null ? null
            : { amount: event.total_cost_usd, currency: "USD", source: CLAUDE_SOURCE.cost_source }
        });
      }
      return "";
    },
    facts: () => facts
  };
}

function claudeOutputArgs(args) {
  if (!args.includes("--print") && !args.includes("-p")) return null;
  const FLAG = "--output-format";
  const selections = [];
  for (let at = 0; at < args.length; at += 1) {
    if (args[at] === FLAG) {
      selections.push({ at, width: 2, value: args[at + 1] ?? null });
      at += 1;
    } else if (args[at].startsWith(`${FLAG}=`)) {
      selections.push({ at, width: 1, value: args[at].slice(FLAG.length + 1) });
    }
  }
  if (selections.length > 1 || (selections.length === 1 && selections[0].value !== "text")) return null;

  const mode = [FLAG, "stream-json", "--verbose"];
  const selected = selections[0] ?? null;
  const next = [];
  let placed = false;
  for (let at = 0; at < args.length; at += 1) {
    if (args[at] === "--verbose") continue;
    if (selected !== null && at === selected.at) {
      next.push(...mode);
      at += selected.width - 1;
      continue;
    }
    next.push(args[at]);
    if (selected === null && !placed && (args[at] === "--print" || args[at] === "-p")) {
      next.push(...mode);
      placed = true;
    }
  }
  return next;
}

export const NATIVE_USAGE_ADAPTERS = Object.freeze({
  ...STEP_NATIVE_USAGE_ADAPTERS,
  claude: Object.freeze({ family: "claude", source: CLAUDE_SOURCE, outputArgs: claudeOutputArgs,
    finalTextFromStream: true, createExtractor: createClaudeExtractor })
});

export const NATIVE_USAGE_FAMILIES = Object.freeze(Object.keys(NATIVE_USAGE_ADAPTERS));
