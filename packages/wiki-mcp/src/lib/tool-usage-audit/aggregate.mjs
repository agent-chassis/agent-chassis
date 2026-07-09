import {
  CONFIDENCE_LEVELS,
  SOURCE_KINDS,
  TRANSPORT_KINDS,
  UNSUPPORTED_GAP_CODES,
  isPlainObject,
  normalizeString,
  normalizeToolName
} from "./core.mjs";
import { redactPayload, redactSubject, sha256Text } from "./redaction.mjs";

export const TOOL_USAGE_AGGREGATE_SCHEMA_VERSION = "tool-usage-audit-aggregate.v1";

const DEFAULT_LIMITS = Object.freeze({
  maxFacts: 1000,
  maxBuckets: 50,
  maxTopCalls: 20,
  maxGuidance: 20
});

const HIGH_OUTPUT_SIZE_CLASSES = new Set(["large", "very_large"]);
const HIGH_RISK_MISUSE_CODES = new Set(["dispatch_without_readiness_validation"]);
const SAFE_PROVENANCE_LABELS = new Set([
  "unknown",
  "operator",
  "coordinator",
  "agent",
  "worker",
  "reviewer",
  "redteam",
  "tooling_test",
  "launcher_managed",
  "agent_safe",
  "full_profile",
  "operator_convenience",
  "mcp_client",
  "role_session",
  "codex",
  "claude",
  "deepswe"
]);
const HISTORICAL_BACKFILL_SOURCE_KINDS = new Set([
  "historical_launcher_metadata",
  "historical_codex_stderr_shell",
  "historical_apply_patch_text",
  "historical_review_context_bundle",
  "historical_deepswe_trajectory",
  "historical_deepswe_session_jsonl",
  "launcher_owned_command",
  "operator_shell_command",
  "agent_raw_shell_command"
]);
const SOURCE_GROUPS = new Set(["historical_backfill", "live_mcp_runtime", "other_observed"]);
const CLOSED_SOURCE_KIND_LABELS = new Set([...SOURCE_KINDS, ...TRANSPORT_KINDS]);
const CLOSED_CONFIDENCE_LABELS = new Set([...CONFIDENCE_LEVELS, "unknown"]);
const CLOSED_RESPONSE_SIZE_CLASSES = new Set(["small", "medium", "large", "very_large", "unavailable"]);
const WK1438_ROUTER_OUTPUT_LABELS = new Set([
  "wk1438_router_output",
  "workspace_tool_router_recommend"
]);
const ROUTER_OUTPUT_LABELS = new Set([
  "wk1438_router_output",
  "router_output",
  "tool_router_result",
  "tool_router_output",
  "workspace_tool_router_recommend"
]);

export function aggregateToolUsageAudit(facts = [], options = {}) {
  if (!Array.isArray(facts)) throw new Error("tool-usage aggregate facts must be an array");
  const limits = normalizeLimits(options);
  const filters = normalizeFilters(options.filter ?? options.filters);
  const policy = normalizePolicy(options.policy);
  const selectedFacts = facts.filter((fact) => matchesFilters(fact, filters)).slice(0, limits.maxFacts);
  const state = createAggregateState({ limits, filters: publicFilters(filters), totalInputFacts: facts.length });

  for (const [index, fact] of selectedFacts.entries()) {
    if (!isPlainObject(fact)) continue;
    const sourceGroup = sourceGroupFor(fact);
    increment(state.counts.by_source_group, sourceGroup);
    increment(state.counts.by_source_kind, publicSourceKind(fact.source_kind));
    increment(state.counts.by_confidence, publicConfidence(fact.confidence));
    if (fact.unsupported_gap_code) {
      increment(state.historical_unsupported_gap_counts, publicUnsupportedGapCode(fact.unsupported_gap_code));
    }

    const event = isPlainObject(fact.event) ? fact.event : null;
    const toolName = toolNameFor(event);
    if (toolName) increment(state.counts.by_tool, toolName);

    const provenance = provenanceFor(fact);
    incrementProvenanceBucket(state.provenance.buckets, provenance, "total");
    incrementProvenanceBucket(state.provenance.buckets, provenance, sourceGroup);
    incrementProvenanceBucket(state.provenance.buckets, provenance, `confidence:${publicConfidence(fact.confidence)}`);
    noteFirstTool(state.first_tool, provenance.bucket_id, fact, toolName);

    const response = isPlainObject(event?.response) ? event.response : {};
    const misuseEntries = normalizeMisuseEntries(event?.misuse_classifications);
    for (const misuse of misuseEntries) {
      increment(state.counts.by_misuse_code, misuse.code);
      incrementProvenanceBucket(state.provenance.buckets, provenance, `misuse:${misuse.code}`);
      addGuidance(state.guidance, misuse, policy, limits);
    }
    addNextActionIndicator(state.next_action, event, misuseEntries);
    addTopCall(state.top_calls, {
      index,
      fact,
      toolName,
      sourceGroup,
      provenance,
      response,
      misuseEntries
    });
  }

  return finalizeAggregate(state, limits);
}

export function compactToolUsageAuditAggregate(input = {}) {
  if (Array.isArray(input)) return aggregateToolUsageAudit(input);
  if (!isPlainObject(input)) throw new Error("tool-usage aggregate input must be an object or facts array");
  return aggregateToolUsageAudit(input.facts ?? [], input);
}

function createAggregateState({ limits, filters, totalInputFacts }) {
  return {
    schema_version: TOOL_USAGE_AGGREGATE_SCHEMA_VERSION,
    aggregate_mode: "compact",
    bounded: {
      max_facts: limits.maxFacts,
      max_buckets: limits.maxBuckets,
      max_top_calls: limits.maxTopCalls,
      max_guidance: limits.maxGuidance,
      raw_events_included: false,
      redaction: "summaries_only_no_raw_args_results_prompts_paths_or_child_final_text"
    },
    filters,
    input: {
      total_fact_count: totalInputFacts,
      considered_fact_count: 0,
      truncated_fact_count: 0
    },
    counts: {
      by_tool: {},
      by_misuse_code: {},
      by_source_group: {},
      by_source_kind: {},
      by_confidence: {}
    },
    historical_unsupported_gap_counts: {},
    provenance: { buckets: {} },
    first_tool: { derivable_bucket_count: 0, buckets: {} },
    next_action: {
      derivable_event_count: 0,
      followed_count: 0,
      ignored_count: 0,
      unavailable_count: 0,
      ignored_required_next_action_misuse_count: 0
    },
    top_calls: [],
    guidance: {}
  };
}

function normalizeLimits(options) {
  return {
    maxFacts: boundedInteger(options.maxFacts ?? options.max_facts, DEFAULT_LIMITS.maxFacts, 1, 5000),
    maxBuckets: boundedInteger(options.maxBuckets ?? options.max_buckets, DEFAULT_LIMITS.maxBuckets, 1, 200),
    maxTopCalls: boundedInteger(options.maxTopCalls ?? options.max_top_calls, DEFAULT_LIMITS.maxTopCalls, 1, 100),
    maxGuidance: boundedInteger(options.maxGuidance ?? options.max_guidance, DEFAULT_LIMITS.maxGuidance, 1, 100)
  };
}

function boundedInteger(value, fallback, min, max) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`tool-usage aggregate limit must be an integer from ${min} to ${max}`);
  }
  return number;
}

function normalizeFilters(filters) {
  const source = isPlainObject(filters) ? filters : {};
  return {
    caller_kind: normalizeString(source.caller_kind ?? source.callerKind) ?? null,
    session_kind: normalizeString(source.session_kind ?? source.sessionKind) ?? null,
    tool_profile: normalizeString(source.tool_profile ?? source.toolProfile) ?? null,
    source_group: normalizeString(source.source_group ?? source.sourceGroup) ?? null,
    tool_name: normalizeString(source.tool_name ?? source.toolName) ?? null
  };
}

function publicFilters(filters) {
  return {
    caller_kind: publicFilterValue(filters.caller_kind, "provenance"),
    session_kind: publicFilterValue(filters.session_kind, "provenance"),
    tool_profile: publicFilterValue(filters.tool_profile, "provenance"),
    source_group: SOURCE_GROUPS.has(filters.source_group) ? filters.source_group : null,
    tool_name: filters.tool_name ? publicToolName(filters.tool_name) : null
  };
}

function publicFilterValue(value, kind) {
  if (!value) return null;
  const provenance = provenanceValue(value);
  return {
    kind,
    label: provenance.label,
    digest: provenance.digest
  };
}

function matchesFilters(fact, filters) {
  const event = isPlainObject(fact?.event) ? fact.event : {};
  const origin = originFor(event);
  if (filters.caller_kind && origin.caller_kind.raw !== filters.caller_kind) return false;
  if (filters.session_kind && origin.session_kind.raw !== filters.session_kind) return false;
  if (filters.tool_profile && origin.tool_profile.raw !== filters.tool_profile) return false;
  if (filters.source_group && sourceGroupFor(fact) !== filters.source_group) return false;
  if (filters.tool_name && toolNameFor(event) !== filters.tool_name) return false;
  return true;
}

function normalizePolicy(policy) {
  if (!isPlainObject(policy)) return {};
  const entries = Array.isArray(policy.misuse_codes) ? policy.misuse_codes : [];
  return Object.fromEntries(entries.map((entry) => [entry.code, entry]).filter(([code]) => normalizeString(code)));
}

function sourceGroupFor(fact) {
  if (fact?.source_kind === "live_mcp_tool_event" || fact?.transport_kind === "live_mcp_tool_event") {
    return "live_mcp_runtime";
  }
  if (
    HISTORICAL_BACKFILL_SOURCE_KINDS.has(fact?.source_kind) ||
    HISTORICAL_BACKFILL_SOURCE_KINDS.has(fact?.transport_kind)
  ) {
    return "historical_backfill";
  }
  if (String(fact?.source_kind ?? "").startsWith("historical_")) return "historical_backfill";
  if (fact?.transport_kind === "unsupported_gap") return "historical_backfill";
  return "other_observed";
}

function toolNameFor(event) {
  return publicToolName(event?.tool_name ?? event?.command_name);
}

function provenanceFor(fact) {
  const event = isPlainObject(fact.event) ? fact.event : {};
  const origin = originFor(event);
  const runRole = provenanceValue(fact.run?.role);
  const runSubject = Array.isArray(fact.run?.subject?.canonical_ids) ? fact.run.subject.canonical_ids.join(",") : null;
  const parts = [
    `caller:${origin.caller_kind.raw}`,
    `session:${origin.session_kind.raw}`,
    `profile:${origin.tool_profile.raw}`,
    runRole.raw !== "unknown" ? `run_role:${runRole.raw}` : null,
    runSubject ? `subject:${runSubject}` : null
  ].filter(Boolean).join("|");
  const subject = runSubject ? redactSubject(runSubject) : null;
  return {
    bucket_id: `bucket:${sha256Text(parts).slice("sha256:".length, "sha256:".length + 16)}`,
    caller_kind: origin.caller_kind.label,
    session_kind: origin.session_kind.label,
    tool_profile: origin.tool_profile.label,
    caller_kind_digest: origin.caller_kind.digest,
    session_kind_digest: origin.session_kind.digest,
    tool_profile_digest: origin.tool_profile.digest,
    ...(runRole.raw !== "unknown" ? { run_role: runRole.label, run_role_digest: runRole.digest } : {}),
    ...(subject ? { subject } : {})
  };
}

function originFor(event) {
  const origin = isPlainObject(event?.origin) ? event.origin : {};
  return {
    caller_kind: provenanceValue(origin.caller_kind),
    session_kind: provenanceValue(origin.session_kind),
    tool_profile: provenanceValue(origin.tool_profile)
  };
}

function provenanceValue(value) {
  const raw = normalizeString(value) ?? "unknown";
  const normalized = raw.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return {
    raw,
    label: SAFE_PROVENANCE_LABELS.has(normalized) ? normalized : "other",
    digest: sha256Text(raw)
  };
}

function normalizeMisuseEntries(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (typeof entry === "string") return { code: publicCode(entry, "unknown_misuse_code") };
    if (!isPlainObject(entry)) return { code: "unknown_misuse_shape" };
    return {
      code: publicCode(entry.code, "unknown_misuse_code"),
      replacement_family: optionalClosedToken(entry.replacement_family),
      routing_intent_ref: optionalClosedToken(entry.routing_intent_ref),
      guidance_confidence: optionalToken(entry.confidence, 32),
      exact_recommended_call: hasWk1438RouterExactGuidance(entry) ? redactPayload(entry.exact_recommended_call) : null
    };
  });
}

function hasWk1438RouterExactGuidance(entry) {
  if (!isPlainObject(entry.exact_recommended_call)) return false;
  return [
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
  ].some((candidate) => hasExplicitWk1438RouterOutputProvenance(candidate));
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
  return (hasWk1438RouterSource(labels) || isWk1438RecordId(sourceRecordId)) && hasSeparateRouterOutputProvenance(labels);
}

function isExplicitWk1438RouterOutputLabel(value) {
  return WK1438_ROUTER_OUTPUT_LABELS.has(normalizeRouterLabel(value));
}

function hasWk1438RouterSource(labels) {
  return labels.some((label) => WK1438_ROUTER_OUTPUT_LABELS.has(normalizeRouterLabel(label)));
}

function hasSeparateRouterOutputProvenance(labels) {
  return labels.some((label) => {
    const normalized = normalizeRouterLabel(label);
    return ROUTER_OUTPUT_LABELS.has(normalized) && !WK1438_ROUTER_OUTPUT_LABELS.has(normalized);
  });
}

function isWk1438RecordId(value) {
  return normalizeString(value)?.toUpperCase() === "WK-1438";
}

function normalizeRouterLabel(value) {
  return normalizeString(value)?.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") ?? "";
}

function addGuidance(guidance, misuse, policy, limits) {
  if (!misuse.code || Object.keys(guidance).length >= limits.maxGuidance && !guidance[misuse.code]) return;
  const policyEntry = policy[misuse.code] ?? {};
  const replacementFamily = misuse.replacement_family ?? policyEntry.replacement_family ?? null;
  const routingIntentRef = misuse.routing_intent_ref ?? policyEntry.routing_intent_ref ?? null;
  const existing = guidance[misuse.code] ?? {
    count: 0,
    replacement_family: replacementFamily,
    routing_intent_ref: routingIntentRef,
    guidance_kind: "unavailable",
    exact_recommended_call: null
  };
  existing.count += 1;
  if (misuse.exact_recommended_call) {
    existing.guidance_kind = "wk1438_router_exact";
    existing.exact_recommended_call = misuse.exact_recommended_call;
  } else if (routingIntentRef) {
    existing.guidance_kind = "wk1438_routing_intent_ref";
  } else if (replacementFamily) {
    existing.guidance_kind = "coarse_replacement_family";
  }
  guidance[misuse.code] = existing;
}

function addNextActionIndicator(nextAction, event, misuseEntries) {
  const required = event?.next_action ?? event?.required_next_action;
  const followed = event?.next_action_followed;
  if (misuseEntries.some((entry) => entry.code === "ignored_required_next_action")) {
    nextAction.ignored_required_next_action_misuse_count += 1;
  }
  if (required === undefined && followed === undefined) {
    nextAction.unavailable_count += 1;
    return;
  }
  nextAction.derivable_event_count += 1;
  if (followed === true) nextAction.followed_count += 1;
  else if (followed === false) nextAction.ignored_count += 1;
  else nextAction.unavailable_count += 1;
}

function noteFirstTool(firstTool, provenanceKey, fact, toolName) {
  if (!toolName || firstTool.buckets[provenanceKey]) return;
  firstTool.derivable_bucket_count += 1;
  firstTool.buckets[provenanceKey] = {
    tool_name: toolName,
    source_group: sourceGroupFor(fact),
    confidence: publicConfidence(fact.confidence),
    observed_at: publicObservedAt(fact.observed_at)
  };
}

function addTopCall(topCalls, input) {
  const response = input.response;
  const byteCount = Number.isFinite(Number(response.byte_count)) ? Number(response.byte_count) : 0;
  const sizeClass = publicResponseSizeClass(response.size_class);
  const misuseCodes = input.misuseEntries.map((entry) => entry.code).sort();
  const highRisk = misuseCodes.some((code) => HIGH_RISK_MISUSE_CODES.has(code));
  const highOutput = HIGH_OUTPUT_SIZE_CLASSES.has(sizeClass) || byteCount >= 512 * 1024;
  if (!highRisk && !highOutput && misuseCodes.length === 0) return;
  topCalls.push({
    tool_name: input.toolName ?? "unknown",
    source_group: input.sourceGroup,
    provenance_bucket: input.provenance.bucket_id,
    confidence: publicConfidence(input.fact.confidence),
    response_size_class: sizeClass,
    response_byte_count: byteCount,
    misuse_codes: misuseCodes,
    rank_score: (highRisk ? 1_000_000_000 : 0) + byteCount + misuseCodes.length * 10_000 + input.index
  });
}

function finalizeAggregate(state, limits) {
  state.input.considered_fact_count = Object.values(state.counts.by_source_group).reduce((sum, count) => sum + count, 0);
  state.input.truncated_fact_count = Math.max(0, state.input.total_fact_count - state.input.considered_fact_count);
  state.counts.by_tool = sortedLimitedCounts(state.counts.by_tool, limits.maxBuckets);
  state.counts.by_misuse_code = sortedLimitedCounts(state.counts.by_misuse_code, limits.maxBuckets);
  state.counts.by_source_group = sortedLimitedCounts(state.counts.by_source_group, limits.maxBuckets);
  state.counts.by_source_kind = sortedLimitedCounts(state.counts.by_source_kind, limits.maxBuckets);
  state.counts.by_confidence = sortedLimitedCounts(state.counts.by_confidence, limits.maxBuckets);
  state.historical_unsupported_gap_counts = sortedLimitedCounts(state.historical_unsupported_gap_counts, limits.maxBuckets);
  state.provenance.buckets = sortedLimitedObjects(state.provenance.buckets, limits.maxBuckets);
  state.first_tool.buckets = sortedLimitedObjects(state.first_tool.buckets, limits.maxBuckets);
  state.top_calls = state.top_calls
    .sort((a, b) => b.rank_score - a.rank_score || a.tool_name.localeCompare(b.tool_name))
    .slice(0, limits.maxTopCalls)
    .map(({ rank_score: _rankScore, ...entry }) => entry);
  state.guidance = sortedLimitedObjects(state.guidance, limits.maxGuidance);
  return state;
}

function increment(target, key) {
  target[key] = (target[key] ?? 0) + 1;
}

function incrementNested(target, key, field) {
  target[key] ??= {};
  increment(target[key], field);
}

function incrementProvenanceBucket(target, provenance, field) {
  target[provenance.bucket_id] ??= {
    caller_kind: provenance.caller_kind,
    session_kind: provenance.session_kind,
    tool_profile: provenance.tool_profile,
    caller_kind_digest: provenance.caller_kind_digest,
    session_kind_digest: provenance.session_kind_digest,
    tool_profile_digest: provenance.tool_profile_digest,
    ...(provenance.run_role ? { run_role: provenance.run_role } : {}),
    ...(provenance.subject ? { subject: provenance.subject } : {})
  };
  increment(target[provenance.bucket_id], field);
}

function sortedLimitedCounts(counts, limit) {
  return Object.fromEntries(
    Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)).slice(0, limit)
  );
}

function sortedLimitedObjects(object, limit) {
  return Object.fromEntries(
    Object.entries(object).sort(([a], [b]) => a.localeCompare(b)).slice(0, limit)
  );
}

function token(value, fallback) {
  return normalizeString(value)?.replace(/[^A-Za-z0-9_.:-]+/g, "_").slice(0, 96) ?? fallback;
}

function optionalToken(value, maxLength = 96) {
  const text = normalizeString(value);
  return text ? text.replace(/[^A-Za-z0-9_.:-]+/g, "_").slice(0, maxLength) : undefined;
}

function publicSourceKind(value) {
  const text = normalizeString(value);
  if (!text) return "unknown";
  return CLOSED_SOURCE_KIND_LABELS.has(text) ? text : digestBucket("other_source_kind", text);
}

function publicConfidence(value) {
  const text = normalizeString(value);
  return text && CLOSED_CONFIDENCE_LABELS.has(text) ? text : "unknown";
}

function publicUnsupportedGapCode(value) {
  const text = normalizeString(value);
  if (!text) return "unknown_gap";
  return UNSUPPORTED_GAP_CODES.includes(text) ? text : digestBucket("other_unsupported_gap", text);
}

function publicResponseSizeClass(value) {
  const text = normalizeString(value);
  if (!text) return "unavailable";
  return CLOSED_RESPONSE_SIZE_CLASSES.has(text) ? text : digestBucket("other_response_size", text);
}

function publicObservedAt(value) {
  const text = normalizeString(value);
  if (!text) return null;
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) return digestBucket("other_observed_at", text);
  return new Date(timestamp).toISOString();
}

function publicToolName(value) {
  const text = normalizeString(value);
  if (!text) return null;
  const normalized = normalizeToolName(text);
  if (normalized && !isSensitiveFreeText(text)) return normalized;
  return digestBucket("other_tool", text);
}

function publicCode(value, fallback) {
  const text = normalizeString(value);
  if (!text) return fallback;
  if (isSensitiveFreeText(text)) return digestBucket(fallback, text);
  return token(text, fallback);
}

function optionalClosedToken(value) {
  const text = normalizeString(value);
  if (!text || isSensitiveFreeText(text)) return undefined;
  return optionalToken(text);
}

function digestBucket(prefix, value) {
  return `${prefix}:${sha256Text(value).slice("sha256:".length, "sha256:".length + 16)}`;
}

function isSensitiveFreeText(value) {
  const text = String(value);
  return (
    /(?:\/|\\|\.agent-runs|[A-Za-z]:\\)/.test(text) ||
    /\b(?:token|secret|api[_-]?key|authorization|bearer|password|passwd|credential|auth|cookie|session)\b/i.test(text)
  );
}
