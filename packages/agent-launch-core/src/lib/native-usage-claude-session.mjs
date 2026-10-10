
import path from "node:path";
import { lstat, realpath } from "node:fs/promises";

import {
  NATIVE_USAGE_SESSION_HOOK_EVENT,
  NATIVE_USAGE_SESSION_ID_PATTERN,
  createSessionRecordReader,
  createSessionUsageTracker,
  prepareSessionUsageLaunch
} from "./native-usage-session-binding.mjs";

export const CLAUDE_SESSION_USAGE_SOURCE = Object.freeze({
  id: "claude.session_record.cost_state",

  input_semantics: "exclusive",

  counter_kind: "cumulative",
  descendant_coverage: "unknown",
  cost_source: "claude.cost_state.total_cost_usd"
});

export const CLAUDE_USAGE_HOOK = Object.freeze({ event: NATIVE_USAGE_SESSION_HOOK_EVENT, matcher: "", timeoutSec: 10 });

export const CLAUDE_USAGE_CHECKPOINT_HOOK = Object.freeze({ event: "SessionEnd", timeoutSec: 10 });

const MAX_OBSERVATIONS = 4096;
const unbound = (cause) => ({ ok: false, cause });
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export function buildClaudeUsageHookSettings(usageHook) {
  const group = (hook) => [{ matcher: hook.matcher ?? "",
    hooks: [{ type: "command", command: hook.command, timeout: hook.timeoutSec }] }];
  return { hooks: { [usageHook.event]: group(usageHook),
    ...(usageHook.checkpoint ? { [usageHook.checkpoint.event]: group(usageHook.checkpoint) } : {}) } };
}

function createClaudeSessionExtractor({ sessionId, afterSequence }) {
  const facts = { session_id: null, session_conflict: false, client_version: null, snapshots: [], requests: [],
    requests_truncated: false, terminal_event: false, error_event: false, usage_presence: "unverified",
    descendant_coverage: CLAUDE_SESSION_USAGE_SOURCE.descendant_coverage, final_text: null, protocol_events: 0 };
  const seenMessages = new Set();
  let withUsage = 0;
  let withoutUsage = 0;
  let reports = 0;
  return {
    accept(value) {
      if (!isObject(value) || typeof value.sessionId !== "string") return;
      if (facts.session_id === null) facts.session_id = value.sessionId;
      else if (value.sessionId !== facts.session_id) facts.session_conflict = true;
      if (typeof value.version === "string") facts.client_version = value.version;
      if (value.type === "assistant" && isObject(value.message)) {

        const id = value.message.id;
        if (typeof id !== "string" || id === "" || seenMessages.has(id)) return;
        facts.terminal_event = false;
        const usage = value.message.usage;
        if (!isObject(usage)) {
          withoutUsage += 1;
        } else {
          withUsage += 1;
          if (facts.requests.length < MAX_OBSERVATIONS) {
            facts.requests.push({ request_id: id, counters: { input: usage.input_tokens,
              cache_read: usage.cache_read_input_tokens, cache_creation: usage.cache_creation_input_tokens } });
          } else {
            facts.requests_truncated = true;
          }
        }
        if (seenMessages.size < MAX_OBSERVATIONS) seenMessages.add(id);
        return;
      }
      if (value.type !== "cost-state") return;
      reports += 1;
      facts.terminal_event = true;

      if (reports <= afterSequence) return;
      const models = isObject(value.modelUsage) ? Object.values(value.modelUsage) : [];
      const snapshot = { sequence: reports,
        counter_sets: models.map((model) => ({ input: model?.inputTokens, cache_read: model?.cacheReadInputTokens,
          cache_creation: model?.cacheCreationInputTokens, output: model?.outputTokens })),
        cost: value.totalCostUSD === undefined || value.totalCostUSD === null ? null
          : { amount: value.totalCostUSD, currency: "USD", source: CLAUDE_SESSION_USAGE_SOURCE.cost_source } };

      if (facts.snapshots.length < MAX_OBSERVATIONS) facts.snapshots.push(snapshot);
      else facts.snapshots[MAX_OBSERVATIONS - 1] = snapshot;
    },
    facts() {
      facts.usage_presence = withoutUsage > 0 ? "absent" : withUsage > 0 ? "present" : "unverified";
      return facts;
    },
    bound: () => facts.session_id === sessionId && !facts.session_conflict
  };
}

export function openClaudeSessionUsageReader({ transcriptPath, sessionId, claudeConfigDir, afterSequence = 0 }) {
  const named = typeof sessionId === "string" && NATIVE_USAGE_SESSION_ID_PATTERN.test(sessionId)
    && typeof transcriptPath === "string" && typeof claudeConfigDir === "string"
    && path.basename(transcriptPath) === `${sessionId}.jsonl`;
  return createSessionRecordReader({
    extractor: createClaudeSessionExtractor({ sessionId, afterSequence }),
    locate: async () => {
      if (!named) return unbound("session_record_not_bound");
      const stats = await lstat(transcriptPath);
      const projects = path.join(await realpath(claudeConfigDir), "projects");
      const resolved = await realpath(transcriptPath);

      return stats.isFile() && resolved.startsWith(`${projects}${path.sep}`) ? { ok: true, path: resolved }
        : unbound("session_record_not_bound");
    }
  });
}

export function readClaudeSessionUsage(binding) {
  return openClaudeSessionUsageReader(binding).advance({ final: true });
}

const trackClaudeSessionUsage = ({ claudeConfigDir, ...launch }) => createSessionUsageTracker({ ...launch, family: "claude",
  source: CLAUDE_SESSION_USAGE_SOURCE, openReader: (binding) => openClaudeSessionUsageReader({ ...binding, claudeConfigDir }),
  incompleteCause: () => "auxiliary_requests_unreported" });

export function settleClaudeSessionUsage({ exit = null, ...launch } = {}) {
  return trackClaudeSessionUsage(launch).settle({ exit });
}

export function prepareClaudeSessionUsageLaunch({ claudeConfigDir, ...launch } = {}) {
  return prepareSessionUsageLaunch({ ...launch, bindingDir: typeof claudeConfigDir === "string" ? launch.bindingDir : null,
    family: "claude", hook: CLAUDE_USAGE_HOOK, checkpointHook: CLAUDE_USAGE_CHECKPOINT_HOOK,
    track: (tracked) => trackClaudeSessionUsage({ ...tracked, claudeConfigDir }) });
}
