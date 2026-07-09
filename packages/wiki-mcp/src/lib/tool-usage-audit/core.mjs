export const TOOL_USAGE_AUDIT_SCHEMA_VERSION = "tool-usage-audit.v1";
export const HISTORICAL_BASELINE_SCHEMA_VERSION = "tool-usage-historical-baseline.v1";

export const CONFIDENCE_LEVELS = Object.freeze(["high", "medium", "low", "none"]);

export const SOURCE_KINDS = Object.freeze([
  "historical_launcher_metadata",
  "historical_codex_stderr_shell",
  "historical_apply_patch_text",
  "historical_review_context_bundle",
  "historical_deepswe_trajectory",
  "historical_deepswe_session_jsonl",
  "live_mcp_tool_event",
  "launcher_owned_command",
  "operator_shell_command",
  "agent_raw_shell_command"
]);

export const TRANSPORT_KINDS = Object.freeze([
  "historical_launcher_metadata",
  "live_mcp_tool_event",
  "launcher_owned_command",
  "operator_shell_command",
  "agent_raw_shell_command",
  "historical_apply_patch_text",
  "historical_review_context_bundle",
  "historical_deepswe_trajectory",
  "historical_deepswe_session_jsonl",
  "unsupported_gap"
]);

export const UNSUPPORTED_HISTORICAL_MCP_GAP_CODES = Object.freeze([
  "historical_gap_verbose_full_mcp_read_before_compact",
  "historical_gap_dispatch_readiness_validation_skipped",
  "historical_gap_ignored_next_action",
  "historical_gap_mcp_response_spill_or_refusal_status",
  "historical_gap_mcp_specific_misuse_without_structured_mcp_transcript"
]);

export const UNSUPPORTED_GAP_CODES = Object.freeze([
  ...UNSUPPORTED_HISTORICAL_MCP_GAP_CODES,
  "historical_gap_ambiguous_shell_provenance",
  "historical_gap_review_context_semantic_inclusion_reason"
]);

export const MAX_FACTS_DEFAULT = 1000;
export const MAX_FILES_DEFAULT = 2000;
export const MAX_FILE_BYTES_DEFAULT = 512 * 1024;
export const MAX_KEYS = 16;
export const MAX_JSONL_LINES = 2000;
export const MAX_TEXT_LINES = 2000;

const TOOL_NAME_RE = /^[A-Za-z0-9_.:-]{1,96}$/;

export function normalizeString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeToolName(value) {
  const trimmed = normalizeString(value);
  if (!trimmed) return null;
  const normalized = trimmed.replace(/[^A-Za-z0-9_.:-]+/g, "_").slice(0, 96);
  return TOOL_NAME_RE.test(normalized) ? normalized : null;
}

export function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validateEvidenceEnvelope(envelope) {
  if (!isPlainObject(envelope)) throw new Error("tool-usage evidence envelope must be an object");
  if (!CONFIDENCE_LEVELS.includes(envelope.confidence)) {
    throw new Error(`invalid tool-usage confidence: ${envelope.confidence}`);
  }
  if (!normalizeString(envelope.evidence_basis)) {
    throw new Error("tool-usage evidence_basis is required");
  }
  if (!isPlainObject(envelope.source_artifact)) {
    throw new Error("tool-usage source_artifact is required");
  }
  if (!normalizeString(envelope.source_artifact.path_category)) {
    throw new Error("tool-usage source_artifact.path_category is required");
  }
  if (!normalizeString(envelope.source_artifact.path_digest)) {
    throw new Error("tool-usage source_artifact.path_digest is required");
  }
  if (
    envelope.unsupported_gap_code !== undefined &&
    !UNSUPPORTED_GAP_CODES.includes(envelope.unsupported_gap_code)
  ) {
    throw new Error(`invalid tool-usage unsupported_gap_code: ${envelope.unsupported_gap_code}`);
  }
  if (envelope.confidence === "none" && !envelope.unsupported_gap_code) {
    throw new Error("tool-usage none confidence requires unsupported_gap_code");
  }
  return true;
}

export function confidenceEnvelope({ confidence, evidence_basis, unsupported_gap_code = undefined, sourceArtifact }) {
  const envelope = {
    confidence,
    evidence_basis,
    source_artifact: sourceArtifact
  };
  if (unsupported_gap_code !== undefined) envelope.unsupported_gap_code = unsupported_gap_code;
  validateEvidenceEnvelope(envelope);
  return envelope;
}

export function normalizeAuditFact(base, envelope) {
  if (!isPlainObject(base)) throw new Error("tool-usage fact base must be an object");
  if (!SOURCE_KINDS.includes(base.source_kind)) {
    throw new Error(`invalid tool-usage source_kind: ${base.source_kind}`);
  }
  if (base.transport_kind !== undefined && !TRANSPORT_KINDS.includes(base.transport_kind)) {
    throw new Error(`invalid tool-usage transport_kind: ${base.transport_kind}`);
  }
  validateEvidenceEnvelope(envelope);
  return {
    schema_version: TOOL_USAGE_AUDIT_SCHEMA_VERSION,
    ...base,
    ...envelope
  };
}

export function summarizeFacts(facts) {
  const bySourceKind = {};
  const byConfidence = {};
  const unsupportedGapCounts = {};
  const toolCounts = {};
  for (const entry of facts) {
    bySourceKind[entry.source_kind] = (bySourceKind[entry.source_kind] ?? 0) + 1;
    byConfidence[entry.confidence] = (byConfidence[entry.confidence] ?? 0) + 1;
    if (entry.unsupported_gap_code) {
      unsupportedGapCounts[entry.unsupported_gap_code] = (unsupportedGapCounts[entry.unsupported_gap_code] ?? 0) + 1;
    }
    const toolName = entry.event?.tool_name ?? entry.event?.command_name;
    if (toolName) toolCounts[toolName] = (toolCounts[toolName] ?? 0) + 1;
  }
  return {
    fact_count: facts.length,
    by_source_kind: Object.fromEntries(Object.entries(bySourceKind).sort(([a], [b]) => a.localeCompare(b))),
    by_confidence: Object.fromEntries(Object.entries(byConfidence).sort(([a], [b]) => a.localeCompare(b))),
    unsupported_gap_counts: Object.fromEntries(Object.entries(unsupportedGapCounts).sort(([a], [b]) => a.localeCompare(b))),
    tool_counts: Object.fromEntries(Object.entries(toolCounts).sort(([a], [b]) => a.localeCompare(b)))
  };
}
