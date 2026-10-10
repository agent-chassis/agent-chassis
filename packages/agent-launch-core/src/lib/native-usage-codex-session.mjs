
import path from "node:path";
import { lstat, realpath } from "node:fs/promises";

import {
  CODEX_SESSION_START_EVENT_LABEL,
  CODEX_STOP_EVENT_LABEL,
  buildCodexSessionStartHookOverrides
} from "./codex-session-hook-config.mjs";
import {
  NATIVE_USAGE_SESSION_HOOK_EVENT,
  NATIVE_USAGE_SESSION_ID_PATTERN,
  createSessionRecordReader,
  createSessionUsageTracker,
  prepareSessionUsageLaunch
} from "./native-usage-session-binding.mjs";

export const CODEX_SESSION_USAGE_SOURCE = Object.freeze({
  id: "codex.session_record.token_count",

  input_semantics: "inclusive",

  counter_kind: "cumulative",

  descendant_coverage: "root_only",
  cost_source: null
});

export const CODEX_USAGE_HOOK = Object.freeze({ event: NATIVE_USAGE_SESSION_HOOK_EVENT, matcher: "^(startup|resume)$", timeoutSec: 10 });

export const CODEX_USAGE_CHECKPOINT_HOOK = Object.freeze({ event: "Stop", timeoutSec: 10 });

const SESSION_ID = NATIVE_USAGE_SESSION_ID_PATTERN;
const MAX_OBSERVATIONS = 4096;

export function buildCodexUsageHookIdentity(usageHook) {
  const handler = (hook) => [{ type: "command", command: hook.command, timeout: hook.timeoutSec, async: false }];
  return {
    event_name: CODEX_SESSION_START_EVENT_LABEL,
    matcher: usageHook.matcher,
    hooks: handler(usageHook),
    ...(usageHook.checkpoint ? { companions: [{ event_name: CODEX_STOP_EVENT_LABEL, hooks: handler(usageHook.checkpoint) }] } : {})
  };
}

export function buildCodexUsageHookArgs(usageHook) {
  return buildCodexSessionStartHookOverrides([buildCodexUsageHookIdentity(usageHook)]).flatMap((override) => ["-c", override]);
}

const unbound = (cause) => ({ ok: false, cause });

function createCodexSessionExtractor({ sessionId, afterSequence }) {
  const facts = { session_id: null, session_conflict: false, client_version: null, snapshots: [], requests: [],
    requests_truncated: false, terminal_event: false, error_event: false, usage_presence: "unverified",
    descendant_coverage: CODEX_SESSION_USAGE_SOURCE.descendant_coverage, final_text: null, protocol_events: 0 };
  let reports = 0;
  let absent = false;
  return {
    accept(value) {
      if (value?.type === "session_meta") {
        const id = value.payload?.id;
        if (facts.session_id === null && typeof id === "string") facts.session_id = id;
        else if (id !== facts.session_id) facts.session_conflict = true;
        if (typeof value.payload?.cli_version === "string") facts.client_version = value.payload.cli_version;
        return;
      }
      if (value?.type !== "event_msg") return;
      const kind = value.payload?.type;
      if (kind === "task_started") facts.terminal_event = false;
      else if (kind === "task_complete") facts.terminal_event = true;
      else if (kind === "token_count") {
        const info = value.payload.info;
        if (info === null || typeof info !== "object") {
          if (reports >= afterSequence) absent = true;
          return;
        }
        reports += 1;
        const total = info.total_token_usage ?? {};
        const snapshot = { sequence: reports, cost: null, counter_sets: [{ input: total.input_tokens,
          cache_read: total.cached_input_tokens, output: total.output_tokens,
          reasoning_output: total.reasoning_output_tokens }] };

        if (reports <= afterSequence) return;

        if (facts.snapshots.length < MAX_OBSERVATIONS) facts.snapshots.push(snapshot);
        else facts.snapshots[MAX_OBSERVATIONS - 1] = snapshot;
        if (facts.requests.length < MAX_OBSERVATIONS) {
          facts.requests.push({ request_id: `report-${reports}`, counters: { input: info.last_token_usage?.input_tokens } });
        } else {
          facts.requests_truncated = true;
        }
      }
    },
    facts() {
      facts.usage_presence = absent ? "absent" : reports > afterSequence ? "present" : "unverified";
      return facts;
    },
    bound: () => facts.session_id === sessionId
  };
}

export function openCodexSessionUsageReader({ transcriptPath, sessionId, codexHome, afterSequence = 0 }) {
  const named = typeof sessionId === "string" && SESSION_ID.test(sessionId) && typeof transcriptPath === "string"
    && typeof codexHome === "string" && path.basename(transcriptPath).startsWith("rollout-")
    && path.basename(transcriptPath).endsWith(`-${sessionId}.jsonl`);
  return createSessionRecordReader({
    extractor: createCodexSessionExtractor({ sessionId, afterSequence }),
    locate: async () => {
      if (!named) return unbound("session_record_not_bound");
      const stats = await lstat(transcriptPath);
      const sessions = path.join(await realpath(codexHome), "sessions");
      const resolved = await realpath(transcriptPath);

      return stats.isFile() && resolved.startsWith(`${sessions}${path.sep}`) ? { ok: true, path: resolved }
        : unbound("session_record_not_bound");
    }
  });
}

export function readCodexSessionUsage(binding) {
  return openCodexSessionUsageReader(binding).advance({ final: true });
}

const trackCodexSessionUsage = ({ codexHome, ...launch }) => createSessionUsageTracker({ ...launch, family: "codex",
  source: CODEX_SESSION_USAGE_SOURCE, openReader: (binding) => openCodexSessionUsageReader({ ...binding, codexHome }),
  incompleteCause: (identity) => (identity.mode === "interactive" ? "auxiliary_requests_unreported" : null) });

export function settleCodexSessionUsage({ exit = null, ...launch } = {}) {
  return trackCodexSessionUsage(launch).settle({ exit });
}

export function prepareCodexSessionUsageLaunch({ codexHome, checkpoints = false, ...launch } = {}) {
  return prepareSessionUsageLaunch({ ...launch, bindingDir: typeof codexHome === "string" ? launch.bindingDir : null,
    family: "codex", hook: CODEX_USAGE_HOOK, checkpointHook: checkpoints === true ? CODEX_USAGE_CHECKPOINT_HOOK : null,
    track: (tracked) => trackCodexSessionUsage({ ...tracked, codexHome }) });
}
