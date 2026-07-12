import {
  confidenceEnvelope,
  hasOwn,
  isPlainObject,
  normalizeAuditFact,
  normalizeString,
  normalizeToolName
} from "./core.mjs";
import { redactPayload, redactSubject, sha256Text } from "./redaction.mjs";

const DEFAULT_MAX_EVENTS = 500;
const MAX_EVENTS_HARD_LIMIT = 5000;

const RESPONSE_SIZE_CLASSES = Object.freeze([
  ["empty", 0],
  ["small", 4 * 1024],
  ["medium", 64 * 1024],
  ["large", 512 * 1024],
  ["very_large", Number.POSITIVE_INFINITY]
]);
export function createLiveMcpToolUsageRecorder(options = {}) {
  const maxEvents = boundedMaxEvents(options.maxEvents);
  const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();
  const events = [];
  const diagnostics = {
    max_events: maxEvents,
    dropped_event_count: 0,
    record_error_count: 0,
    last_record_error: null
  };

  function append(fact) {
    events.push(fact);
    while (events.length > maxEvents) {
      events.shift();
      diagnostics.dropped_event_count += 1;
    }
    return fact;
  }

  function safeRecord(input) {
    try {
      return append(createLiveMcpToolEvent({ ...input, observedAt: input.observedAt ?? now() }));
    } catch (error) {
      diagnostics.record_error_count += 1;
      diagnostics.last_record_error = String(error?.message ?? error).slice(0, 240);
      return null;
    }
  }

  return {
    recordEvent(input) {
      return append(createLiveMcpToolEvent({ ...input, observedAt: input.observedAt ?? now() }));
    },

    async observeToolCall(input, handler) {
      if (typeof handler !== "function") throw new Error("live MCP recorder handler must be a function");
      const startedAt = now();
      try {
        const result = await handler();
        safeRecord({
          ...input,
          observedAt: startedAt,
          result,
          outcome: "returned",
          response: { ...input?.response, result }
        });
        return result;
      } catch (error) {
        safeRecord({
          ...input,
          observedAt: startedAt,
          outcome: "threw",
          error
        });
        throw error;
      }
    },

    getEvents() {
      return events.map((event) => structuredClone(event));
    },

    clear() {
      events.length = 0;
    },

    getDiagnostics() {
      return { ...diagnostics };
    }
  };
}

export function createLiveMcpToolEvent(input = {}) {
  if (!isPlainObject(input)) throw new Error("live MCP event input must be an object");
  const toolName = normalizeToolName(input.toolName ?? input.tool_name);
  if (!toolName) throw new Error("live MCP event tool_name is required");

  const origin = normalizeOrigin(input.origin ?? input.provenance);
  const evidence = evidenceForOrigin(origin, input.evidence);
  const observedAt = normalizeTimestamp(input.observedAt ?? input.observed_at);
  const argsSummary = redactPayload(input.args ?? input.arguments ?? input.input);
  const responseSummary = summarizeResponse(input);
  const selected = normalizeSelectedContext(input.selected ?? input.context);

  return normalizeAuditFact(
    {
      fact_kind: "live_mcp_tool_event",
      source_kind: "live_mcp_tool_event",
      transport_kind: "live_mcp_tool_event",
      observed_at: observedAt,
      event: {
        event_type: "mcp_tool_call",
        tool_name: toolName,
        origin,
        selected,
        args: argsSummary,
        response: responseSummary
      }
    },
    evidence
  );
}

function boundedMaxEvents(value) {
  if (value === undefined) return DEFAULT_MAX_EVENTS;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > MAX_EVENTS_HARD_LIMIT) {
    throw new Error(`live MCP recorder maxEvents must be an integer from 1 to ${MAX_EVENTS_HARD_LIMIT}`);
  }
  return number;
}

function normalizeTimestamp(value) {
  const text = normalizeString(value);
  if (!text) return new Date(0).toISOString();
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw new Error(`invalid live MCP event timestamp: ${text}`);
  return date.toISOString();
}

function normalizeOrigin(origin) {
  const source = isPlainObject(origin) ? origin : {};
  const callerKind = boundedToken(source.caller_kind ?? source.callerKind);
  const sessionKind = boundedToken(source.session_kind ?? source.sessionKind);
  const toolProfile = boundedToken(source.tool_profile ?? source.toolProfile);
  const launcherRunId = normalizeString(source.launcher_run_id ?? source.launcherRunId);
  const clientOrigin = normalizeString(source.client_origin ?? source.clientOrigin);
  const clientId = normalizeString(source.client_id ?? source.clientId);
  return {
    caller_kind: callerKind ?? "unknown",
    session_kind: sessionKind ?? "unknown",
    tool_profile: toolProfile ?? "unknown",
    ...(launcherRunId ? { launcher_run_digest: sha256Text(launcherRunId) } : {}),
    ...(clientOrigin ? { client_origin_digest: sha256Text(clientOrigin) } : {}),
    ...(clientId ? { client_origin_digest: sha256Text(clientId) } : {})
  };
}

function evidenceForOrigin(origin, evidence) {
  const explicitBasis = normalizeString(evidence?.evidence_basis ?? evidence?.basis);
  const hasBoundedOrigin =
    origin.caller_kind !== "unknown" ||
    origin.session_kind !== "unknown" ||
    origin.tool_profile !== "unknown" ||
    origin.launcher_run_digest ||
    origin.client_origin_digest;
  const confidence = hasBoundedOrigin ? (evidence?.confidence ?? "high") : "low";
  return confidenceEnvelope({
    confidence,
    evidence_basis: explicitBasis ?? (hasBoundedOrigin ? "live_mcp_handler_boundary_with_origin" : "live_mcp_handler_boundary_unknown_origin"),
    sourceArtifact: liveSourceArtifact(origin)
  });
}

function liveSourceArtifact(origin) {
  const originDigestMaterial = JSON.stringify(origin);
  return {
    path_category: "live_mcp_handler_boundary",
    path_digest: sha256Text(originDigestMaterial),
    digest: sha256Text(`live_mcp_tool_event:${originDigestMaterial}`)
  };
}

function summarizeResponse(input) {
  const response = isPlainObject(input.response) ? input.response : {};
  const result = response.result ?? input.result;
  const error = input.error;
  const explicitBytes = response.byte_count ?? response.bytes ?? response.response_bytes;
  const resultSummary = redactPayload(result);
  const byteCount = Number.isFinite(Number(explicitBytes)) ? Number(explicitBytes) : (resultSummary.byte_count ?? 0);
  return {
    outcome: normalizeOutcome(input.outcome, error),
    byte_count: byteCount,
    size_class: sizeClass(byteCount),
    truncated: optionalBooleanStatus(response, ["truncated", "was_truncated"]),
    spilled: optionalBooleanStatus(response, ["spilled", "spill"]),
    refused: optionalBooleanStatus(response, ["refused", "refusal"]),
    ...(response.spill_reference ? { spill_reference: redactPayload(response.spill_reference) } : {}),
    ...(response.refusal ? { refusal: redactPayload(response.refusal) } : {}),
    ...(error ? { error: redactPayload(errorSummary(error)) } : { result: resultSummary })
  };
}

function optionalBooleanStatus(object, keys) {
  for (const key of keys) {
    if (hasOwn(object, key)) return Boolean(object[key]);
  }
  return "unavailable";
}

function normalizeOutcome(value, error) {
  const outcome = boundedToken(value);
  if (outcome) return outcome;
  return error ? "threw" : "returned";
}

function sizeClass(byteCount) {
  for (const [name, max] of RESPONSE_SIZE_CLASSES) {
    if (byteCount <= max) return name;
  }
  return "very_large";
}

function errorSummary(error) {
  return {
    name: normalizeString(error?.name) ?? "Error",
    message_digest: sha256Text(error?.message ?? String(error)),
    message_bytes: Buffer.byteLength(String(error?.message ?? error), "utf8")
  };
}

function normalizeSelectedContext(value) {
  if (!isPlainObject(value)) return {};
  const selected = {};
  const workspaceRepo = normalizeString(value.workspace_repo ?? value.workspaceRepo ?? value.repo);
  const unit = normalizeString(value.selected_unit ?? value.selectedUnit ?? value.unit);
  const initiative = normalizeString(value.initiative);
  const resourcePath = normalizeString(value.path ?? value.resource_path ?? value.resourcePath);
  if (workspaceRepo) selected.workspace_repo_digest = sha256Text(workspaceRepo);
  if (unit) selected.selected_unit = redactSubject(unit);
  if (initiative) selected.initiative = redactSubject(initiative);
  if (resourcePath) selected.resource_path = redactPayload(resourcePath);
  return selected;
}

function boundedToken(value) {
  const text = normalizeString(value);
  if (!text) return null;
  return text.replace(/[^A-Za-z0-9_.:-]+/g, "_").slice(0, 64);
}
