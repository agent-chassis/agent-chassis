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
const WK1438_ROUTER_OUTPUT_LABELS = new Set([
  "wk1438_router_output",
  "workspace_tool_router_recommend"
]);
const ROUTER_OUTPUT_LABELS = new Set([
  "router_output",
  "tool_router_result",
  "tool_router_output",
  "workspace_tool_router_recommend"
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
  const misuse = normalizeMisuse(input.misuse ?? input.misuse_classifications);
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
        response: responseSummary,
        misuse_classifications: misuse
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

function normalizeMisuse(value) {
  const entries = Array.isArray(value) ? value : [];
  return entries.map((entry) => {
    if (typeof entry === "string") return { code: entry.slice(0, 96) };
    if (!isPlainObject(entry)) return { code: "unknown_misuse_shape" };
    const code = normalizeString(entry.code)?.slice(0, 96) ?? "unknown_misuse_code";
    const replacementFamily = normalizeString(entry.replacement_family ?? entry.replacementFamily);
    const routingIntentRef = normalizeString(entry.routing_intent_ref ?? entry.routingIntentRef);
    const exactGuidance = normalizeExactRouterGuidance(entry);
    return {
      code,
      ...(replacementFamily ? { replacement_family: replacementFamily.slice(0, 96) } : {}),
      ...(routingIntentRef ? { routing_intent_ref: routingIntentRef.slice(0, 96) } : {}),
      ...(entry.confidence ? { confidence: boundedToken(entry.confidence) ?? "low" } : {}),
      ...(exactGuidance
        ? {
            exact_recommended_call: exactGuidance.call,
            exact_recommended_call_provenance: exactGuidance.provenance
          }
        : {})
    };
  });
}

function normalizeExactRouterGuidance(entry) {
  const exactRecommendedCall = entry.exact_recommended_call ?? entry.exactRecommendedCall;
  if (!isPlainObject(exactRecommendedCall)) return null;
  const provenance = routerGuidanceProvenance(entry);
  if (!provenance) return null;
  return {
    call: redactPayload(exactRecommendedCall),
    provenance
  };
}

function routerGuidanceProvenance(entry) {
  const candidates = [
    entry.exact_recommended_call_provenance,
    entry.exactRecommendedCallProvenance,
    entry.guidance_provenance,
    entry.guidanceProvenance,
    entry.router_output,
    entry.routerOutput,
    entry.exact_recommended_call_source,
    entry.exactRecommendedCallSource,
    entry.guidance_source,
    entry.guidanceSource,
    entry.source
  ];
  for (const candidate of candidates) {
    if (!hasExplicitWk1438RouterOutputProvenance(candidate)) continue;
    return normalizeRouterOutputProvenance(candidate);
  }
  return null;
}

function hasExplicitWk1438RouterOutputProvenance(value) {
  if (typeof value === "string") return isExplicitWk1438RouterOutputLabel(value);
  if (!isPlainObject(value)) return false;
  if (value.wk1438_router_output === true) return true;
  const sourceRecordId = value.source_record_id ?? value.sourceRecordId;
  const labels = [
    value.kind,
    value.source_kind,
    value.sourceKind,
    value.provenance_type,
    value.provenanceType,
    value.operation,
    value.tool_name,
    value.toolName,
    value.schema_version,
    value.schemaVersion,
    value.source,
    value.source_id,
    value.sourceId,
    value.owner,
    value.producer,
    value.router_output === true ? "router_output" : null,
    value.routerOutput === true ? "router_output" : null
  ].filter(Boolean);
  return (hasWk1438RouterSource(labels) || isWk1438RecordId(sourceRecordId)) && hasRouterOutputProvenance(labels);
}

function normalizeRouterOutputProvenance(value) {
  if (typeof value === "string") {
    return {
      source_kind: normalizeRouterLabel(value),
      provenance_type: "router_output"
    };
  }
  const provenance = {};
  addBoundedProvenanceField(provenance, "kind", value.kind);
  addBoundedProvenanceField(provenance, "source_kind", value.source_kind ?? value.sourceKind);
  addBoundedProvenanceField(provenance, "provenance_type", value.provenance_type ?? value.provenanceType);
  addBoundedProvenanceField(provenance, "operation", value.operation);
  addBoundedProvenanceField(provenance, "tool_name", value.tool_name ?? value.toolName);
  addBoundedProvenanceField(provenance, "schema_version", value.schema_version ?? value.schemaVersion);
  addBoundedProvenanceField(provenance, "source_id", value.source_id ?? value.sourceId);
  addBoundedProvenanceField(provenance, "source_record_id", value.source_record_id ?? value.sourceRecordId);
  addBoundedProvenanceField(provenance, "owner", value.owner);
  addBoundedProvenanceField(provenance, "producer", value.producer);
  if (value.wk1438_router_output === true) provenance.wk1438_router_output = true;
  if (value.router_output === true || value.routerOutput === true) provenance.router_output = true;
  return provenance;
}

function addBoundedProvenanceField(target, key, value) {
  const token = boundedToken(value);
  if (token) target[key] = token;
}

function isExplicitWk1438RouterOutputLabel(value) {
  const normalized = normalizeRouterLabel(value);
  return WK1438_ROUTER_OUTPUT_LABELS.has(normalized);
}

function hasWk1438RouterSource(labels) {
  return labels.some((label) => WK1438_ROUTER_OUTPUT_LABELS.has(normalizeRouterLabel(label)));
}

function hasRouterOutputProvenance(labels) {
  return labels.some((label) => ROUTER_OUTPUT_LABELS.has(normalizeRouterLabel(label)));
}

function isWk1438RecordId(value) {
  return normalizeString(value)?.toUpperCase() === "WK-1438";
}

function normalizeRouterLabel(value) {
  return normalizeString(value)?.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") ?? "";
}

function boundedToken(value) {
  const text = normalizeString(value);
  if (!text) return null;
  return text.replace(/[^A-Za-z0-9_.:-]+/g, "_").slice(0, 64);
}
