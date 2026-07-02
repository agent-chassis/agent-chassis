export const AGENT_ROLE_RESULT_SCHEMA_VERSION = "agent-role-result.v1";
export const STRUCTURED_ROLE_RESULT_EVIDENCE_SCHEMA_VERSION =
  "structured-role-result.evidence.v1";

export const AGENT_ROLE_RESULT_ROLES = Object.freeze(["worker", "reviewer", "redteam"]);
export const AGENT_ROLE_RESULT_WORKER_OUTCOMES = Object.freeze([
  "completed",
  "partial",
  "blocked",
  "failed"
]);
export const AGENT_ROLE_RESULT_FINDINGS_OUTCOMES = Object.freeze([
  "no_findings",
  "passed_no_blocking_or_medium_findings",
  "changes_requested"
]);
export const AGENT_ROLE_RESULT_SEVERITIES = Object.freeze([
  "critical",
  "high",
  "medium",
  "low",
  "info"
]);
export const AGENT_ROLE_RESULT_COUNT_FIELDS = Object.freeze([
  "total",
  "blocking",
  "critical",
  "high",
  "medium",
  "low",
  "info"
]);
export const AGENT_ROLE_RESULT_REVIEWED_CONTROLS = Object.freeze([
  "write_scope_total_loc",
  "max_write_file_loc",
  "write_scope_count",
  "acceptance_criteria_count",
  "validation_command_count",
  "expected_changed_line_budget",
  "declared_runtime_mode_count",
  "artifact_kind_count"
]);

export const DEFAULT_AGENT_ROLE_RESULT_LIMITS = Object.freeze({
  maxResponseBytes: 128 * 1024,
  maxPayloadBytes: 64 * 1024,
  maxDiagnosticCount: 20
});

const TOP_LEVEL_REQUIRED_FIELDS = Object.freeze([
  "schema_version",
  "reported_role",
  "reported_subject",
  "reported_outcome",
  "findings",
  "finding_counts",
  "reviewed_controls"
]);
const TOP_LEVEL_OPTIONAL_FIELDS = Object.freeze(["summary"]);
const FINDING_REQUIRED_FIELDS = Object.freeze([
  "id",
  "title",
  "severity",
  "blocking",
  "affected_paths"
]);
const FINDING_OPTIONAL_FIELDS = Object.freeze(["control_id"]);
const AFFECTED_PATH_FIELDS = Object.freeze(["path", "line"]);
const REVIEWED_CONTROL_FIELDS = Object.freeze(["control_id", "result"]);
const AUTHORITY_FIELD_NAMES = new Set([
  "terminal_status",
  "status",
  "role_authority",
  "subject_authority",
  "source_digest_authority",
  "reviewed_at",
  "completed_at",
  "run_id",
  "monitor_handle",
  "source_digest"
]);
const ROLE_RESULT_FENCE_MARKERS = Object.freeze([
  "agent-role-result.v1",
  "agent-role-result"
]);

function byteLength(value) {
  return Buffer.byteLength(value, "utf8");
}

function diag(code, message, path = null, detail = null) {
  const diagnostic = { code, message };
  if (path !== null) diagnostic.path = path;
  if (detail !== null) diagnostic.detail = detail;
  return Object.freeze(diagnostic);
}

function evidence({ valid, result = null, diagnostics, candidate = null }) {
  const claims = result
    ? Object.freeze({
        reported_role: result.reported_role,
        reported_subject: result.reported_subject,
        reported_outcome: result.reported_outcome
      })
    : null;
  return Object.freeze({
    schema_version: STRUCTURED_ROLE_RESULT_EVIDENCE_SCHEMA_VERSION,
    valid,
    result: result ? deepFreeze(result) : null,
    claims,
    diagnostics: Object.freeze(diagnostics),
    candidate,
    authority: "child_evidence_only"
  });
}

function invalid(diagnostics, candidate = null, options = {}) {
  const { maxDiagnosticCount } = normalizeLimits(options);
  return evidence({ valid: false, diagnostics: diagnostics.slice(0, maxDiagnosticCount), candidate });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

function normalizeLimits(options) {
  return {
    maxResponseBytes: Number.isInteger(options.maxResponseBytes) && options.maxResponseBytes > 0
      ? options.maxResponseBytes
      : DEFAULT_AGENT_ROLE_RESULT_LIMITS.maxResponseBytes,
    maxPayloadBytes: Number.isInteger(options.maxPayloadBytes) && options.maxPayloadBytes > 0
      ? options.maxPayloadBytes
      : DEFAULT_AGENT_ROLE_RESULT_LIMITS.maxPayloadBytes,
    maxDiagnosticCount:
      Number.isInteger(options.maxDiagnosticCount) && options.maxDiagnosticCount > 0
        ? options.maxDiagnosticCount
        : DEFAULT_AGENT_ROLE_RESULT_LIMITS.maxDiagnosticCount
  };
}

export function parseAgentRoleResult(finalResponseText, options = {}) {
  const limits = normalizeLimits(options);

  if (typeof finalResponseText !== "string") {
    return invalid([diag("invalid_response_text", "final response text must be a string")], null, limits);
  }

  if (byteLength(finalResponseText) > limits.maxResponseBytes) {
    return invalid([
      diag("response_oversized", "final response text exceeds the configured parser limit", null, {
        max_bytes: limits.maxResponseBytes
      })
    ], null, limits);
  }

  const extraction = extractTerminalJsonCandidate(finalResponseText);
  if (!extraction.ok) {
    return invalid(extraction.diagnostics, null, limits);
  }

  const candidate = Object.freeze({
    kind: extraction.candidate.kind,
    payload_bytes: byteLength(extraction.candidate.jsonText)
  });

  if (candidate.payload_bytes > limits.maxPayloadBytes) {
    return invalid([
      diag("payload_oversized", "structured role-result JSON exceeds the configured payload limit", null, {
        max_bytes: limits.maxPayloadBytes
      })
    ], candidate, limits);
  }

  const duplicateKeys = detectDuplicateJsonKeys(extraction.candidate.jsonText);
  if (duplicateKeys.length > 0) {
    return invalid(duplicateKeys.map((entry) => diag("duplicate_json_key", "JSON object contains a duplicate key", entry.path, {
      key: entry.key
    })), candidate, limits);
  }

  let parsed;
  try {
    parsed = JSON.parse(extraction.candidate.jsonText);
  } catch {
    return invalid([diag("malformed_json", "structured role-result block is not valid JSON")], candidate, limits);
  }

  return validateAgentRoleResult(parsed, { candidate, maxDiagnosticCount: limits.maxDiagnosticCount });
}

export function validateAgentRoleResult(payload, options = {}) {
  const diagnostics = [];
  const candidate = options.candidate ?? null;
  const maxDiagnosticCount = normalizeLimits(options).maxDiagnosticCount;

  function add(code, message, path = null, detail = null) {
    if (diagnostics.length < maxDiagnosticCount) diagnostics.push(diag(code, message, path, detail));
  }

  if (!isPlainObject(payload)) {
    return invalid([diag("invalid_payload_type", "agent-role-result payload must be a JSON object")], candidate);
  }

  validateExactKeys(payload, TOP_LEVEL_REQUIRED_FIELDS, TOP_LEVEL_OPTIONAL_FIELDS, "$", add, "top_level");

  if (payload.schema_version !== AGENT_ROLE_RESULT_SCHEMA_VERSION) {
    add("schema_mismatch", "schema_version must equal agent-role-result.v1", "$.schema_version");
  }

  if (!AGENT_ROLE_RESULT_ROLES.includes(payload.reported_role)) {
    add("invalid_reported_role", "reported_role is not in the allowed role vocabulary", "$.reported_role");
  }
  if (typeof payload.reported_subject !== "string" || payload.reported_subject.trim().length === 0) {
    add("invalid_reported_subject", "reported_subject must be a non-empty string claim", "$.reported_subject");
  }

  const workerRole = payload.reported_role === "worker";
  const findingsRole = payload.reported_role === "reviewer" || payload.reported_role === "redteam";
  if (workerRole && !AGENT_ROLE_RESULT_WORKER_OUTCOMES.includes(payload.reported_outcome)) {
    add("role_outcome_mismatch", "worker payload must use a worker outcome", "$.reported_outcome");
  } else if (findingsRole && !AGENT_ROLE_RESULT_FINDINGS_OUTCOMES.includes(payload.reported_outcome)) {
    add("role_outcome_mismatch", "reviewer/redteam payload must use a findings outcome", "$.reported_outcome");
  } else if (!workerRole && !findingsRole) {
    add("invalid_reported_outcome", "reported_outcome cannot be validated for an unknown role", "$.reported_outcome");
  }

  if (Object.prototype.hasOwnProperty.call(payload, "summary") && payload.summary !== null) {
    if (typeof payload.summary !== "string") {
      add("invalid_summary", "summary must be a string when present", "$.summary");
    } else if (payload.summary.length > 4000) {
      add("summary_oversized", "summary is too large for bounded diagnostic evidence", "$.summary");
    }
  }

  const findings = validateFindings(payload.findings, add);
  const counts = validateFindingCounts(payload.finding_counts, add);
  validateReviewedControls(payload.reviewed_controls, add, workerRole);

  if (workerRole) {
    if (Array.isArray(payload.findings) && payload.findings.length !== 0) {
      add("worker_findings_not_empty", "worker payload findings must be empty", "$.findings");
    }
    if (counts && !AGENT_ROLE_RESULT_COUNT_FIELDS.every((field) => counts[field] === 0)) {
      add("worker_finding_counts_not_zero", "worker payload finding_counts must be the all-zero object", "$.finding_counts");
    }
  }

  if (findings && counts) {
    validateFindingCountConsistency(findings, counts, add);
    validateOutcomeConsistency(payload.reported_outcome, findings, counts, add);
    validateSummaryCountConsistency(payload.summary, counts, add);
  }

  if (diagnostics.length > 0) {
    return invalid(diagnostics, candidate, { maxDiagnosticCount });
  }

  return evidence({ valid: true, result: normalizeResultPayload(payload), diagnostics: [], candidate });
}

function validateExactKeys(value, required, optional, path, add, context) {
  if (!isPlainObject(value)) {
    add("invalid_object", `${path} must be a JSON object`, path);
    return false;
  }
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      add("missing_required_field", `${key} is required`, `${path}.${key}`);
    }
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      if (context === "top_level" && AUTHORITY_FIELD_NAMES.has(key)) {
        add("authority_field_forbidden", "child payload must not carry backend authority fields", `${path}.${key}`, { key });
      } else {
        add("unknown_field", "object contains a field outside the exact schema", `${path}.${key}`, { key });
      }
    }
  }
  return true;
}

function validateFindings(value, add) {
  if (!Array.isArray(value)) {
    add("invalid_findings", "findings must be an array", "$.findings");
    return null;
  }
  const ids = new Set();
  const normalized = [];
  value.forEach((finding, index) => {
    const path = `$.findings[${index}]`;
    if (!validateExactKeys(finding, FINDING_REQUIRED_FIELDS, FINDING_OPTIONAL_FIELDS, path, add)) return;
    if (typeof finding.id !== "string" || finding.id.trim().length === 0) {
      add("invalid_finding_id", "finding id must be a non-empty string", `${path}.id`);
    } else if (ids.has(finding.id)) {
      add("duplicate_finding_id", "finding id must be unique within findings", `${path}.id`);
    } else {
      ids.add(finding.id);
    }
    if (typeof finding.title !== "string" || finding.title.trim().length === 0) {
      add("invalid_finding_title", "finding title must be a non-empty string", `${path}.title`);
    }
    if (!AGENT_ROLE_RESULT_SEVERITIES.includes(finding.severity)) {
      add("invalid_severity", "finding severity is outside the closed enum", `${path}.severity`);
    }
    if (typeof finding.blocking !== "boolean") {
      add("invalid_blocking", "finding blocking must be a boolean", `${path}.blocking`);
    }
    validateAffectedPaths(finding.affected_paths, `${path}.affected_paths`, add);

    if (Object.prototype.hasOwnProperty.call(finding, "control_id") && finding.control_id !== null) {
      validateControlId(finding.control_id, `${path}.control_id`, add);
    }
    normalized.push(finding);
  });
  return normalized;
}

function validateAffectedPaths(value, path, add) {
  if (!Array.isArray(value)) {
    add("invalid_affected_paths", "affected_paths must be an array", path);
    return;
  }
  value.forEach((location, index) => {
    const locationPath = `${path}[${index}]`;
    if (!validateExactKeys(location, AFFECTED_PATH_FIELDS, [], locationPath, add)) return;
    if (typeof location.path !== "string" || !isRepoRelativePath(location.path)) {
      add("invalid_affected_path", "affected path must be a repo-relative path inside the repository", `${locationPath}.path`);
    }
    if (location.line !== null && (!Number.isInteger(location.line) || location.line < 1)) {
      add("invalid_affected_line", "affected path line must be a positive integer or null", `${locationPath}.line`);
    }
  });
}

function validateFindingCounts(value, add) {
  if (!validateExactKeys(value, AGENT_ROLE_RESULT_COUNT_FIELDS, [], "$.finding_counts", add)) {
    return null;
  }
  if (!isPlainObject(value)) return null;
  for (const field of AGENT_ROLE_RESULT_COUNT_FIELDS) {
    if (!Number.isInteger(value[field]) || value[field] < 0) {
      add("invalid_finding_count", "finding_counts fields must be non-negative integers", `$.finding_counts.${field}`);
    }
  }
  return value;
}

function validateFindingCountConsistency(findings, counts, add) {
  const recomputed = recomputeFindingCounts(findings);
  for (const field of AGENT_ROLE_RESULT_COUNT_FIELDS) {
    if (counts[field] !== recomputed[field]) {
      add("finding_count_mismatch", "finding_counts does not match recomputed findings", `$.finding_counts.${field}`, {
        expected: recomputed[field],
        actual: counts[field]
      });
    }
  }
  if (counts.blocking > counts.total) {
    add("finding_count_mismatch", "finding_counts.blocking cannot exceed total", "$.finding_counts.blocking");
  }
}

function validateReviewedControls(value, add, workerRole) {
  if (!Array.isArray(value)) {
    add("invalid_reviewed_controls", "reviewed_controls must be an array", "$.reviewed_controls");
    return;
  }
  if (workerRole && value.length !== 0) {
    add("worker_reviewed_controls_not_empty", "worker payload reviewed_controls must be empty", "$.reviewed_controls");
  }
  const seen = new Set();
  value.forEach((entry, index) => {
    const path = `$.reviewed_controls[${index}]`;
    if (!validateExactKeys(entry, REVIEWED_CONTROL_FIELDS, [], path, add)) return;
    const validControl = validateControlId(entry.control_id, `${path}.control_id`, add);
    if (validControl) {
      if (seen.has(entry.control_id)) {
        add("duplicate_reviewed_control", "reviewed_controls must not duplicate control_id values", `${path}.control_id`);
      }
      seen.add(entry.control_id);
    }
    if (entry.result !== "pass" && entry.result !== "fail") {
      add("invalid_reviewed_control_result", "reviewed control result must be pass or fail", `${path}.result`);
    }
  });
}

function validateControlId(controlId, path, add) {
  if (typeof controlId !== "string" || controlId.trim().length === 0) {
    add("invalid_reviewed_control", "control_id must be a non-empty string from the closed vocabulary", path);
    return false;
  }
  if (!AGENT_ROLE_RESULT_REVIEWED_CONTROLS.includes(controlId)) {
    add("invalid_reviewed_control", "control_id is outside the closed reviewed_controls vocabulary", path, {
      reason: classifyInvalidControlId(controlId)
    });
    return false;
  }
  return true;
}

function classifyInvalidControlId(controlId) {
  if (controlId.trim().length === 0) return "empty";
  if (controlId.includes(":")) return "namespaced";
  if (/^(review|quality|general|all|none)$/i.test(controlId)) return "generic";
  if (/\s|[.!?]/.test(controlId)) return "prose_like";
  return "unknown";
}

function validateOutcomeConsistency(outcome, findings, counts, add) {
  if (outcome === "no_findings" && counts.total !== 0) {
    add("outcome_findings_mismatch", "no_findings requires zero findings", "$.reported_outcome");
  }
  if (
    outcome === "passed_no_blocking_or_medium_findings" &&
    (counts.blocking !== 0 || counts.critical !== 0 || counts.high !== 0 || counts.medium !== 0)
  ) {
    add(
      "outcome_findings_mismatch",
      "passed_no_blocking_or_medium_findings allows only low/info non-blocking findings",
      "$.reported_outcome"
    );
  }
  if (outcome === "changes_requested" && findings.length === 0) {
    add("outcome_findings_mismatch", "changes_requested requires at least one finding", "$.reported_outcome");
  }
}

function validateSummaryCountConsistency(summary, counts, add) {
  if (typeof summary !== "string" || summary.length === 0) return;
  const lower = summary.toLowerCase();
  if (/\b(no findings|zero findings|0 findings)\b/.test(lower) && counts.total !== 0) {
    add("summary_count_conflict", "summary prose conflicts with structured finding counts", "$.summary");
    return;
  }
  const summaryTotal = extractExplicitSummaryTotal(lower);
  if (summaryTotal !== null && summaryTotal !== counts.total) {
    add("summary_count_conflict", "summary prose conflicts with structured finding counts", "$.summary");
  }
}

function extractExplicitSummaryTotal(summary) {
  const explicitTotalPatterns = [
    /\btotal(?:\s+findings?)?\s*(?:=|:|is|of)?\s*(\d+)\s+findings?\b/,
    /\b(\d+)\s+total\s+findings?\b/,
    /\b(\d+)\s+findings?\s+total\b/
  ];
  for (const pattern of explicitTotalPatterns) {
    const match = summary.match(pattern);
    if (match) return Number.parseInt(match[1], 10);
  }

  const standaloneMatch = summary.match(/^\s*(?:found\s+)?(\d+)\s+findings?\.?\s*$/);
  return standaloneMatch ? Number.parseInt(standaloneMatch[1], 10) : null;
}

function normalizeResultPayload(payload) {
  return {
    schema_version: AGENT_ROLE_RESULT_SCHEMA_VERSION,
    reported_role: payload.reported_role,
    reported_subject: payload.reported_subject,
    reported_outcome: payload.reported_outcome,
    summary: Object.prototype.hasOwnProperty.call(payload, "summary") ? payload.summary : null,
    findings: payload.findings.map((finding) => ({ ...finding })),
    finding_counts: { ...payload.finding_counts },
    recomputed_finding_counts: recomputeFindingCounts(payload.findings),
    reviewed_controls: payload.reviewed_controls.map((entry) => ({ ...entry }))
  };
}

function recomputeFindingCounts(findings) {
  const counts = {
    total: Array.isArray(findings) ? findings.length : 0,
    blocking: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0
  };
  if (!Array.isArray(findings)) return counts;
  for (const finding of findings) {
    if (finding && finding.blocking === true) counts.blocking += 1;
    if (finding && AGENT_ROLE_RESULT_SEVERITIES.includes(finding.severity)) {
      counts[finding.severity] += 1;
    }
  }
  return counts;
}

function isRepoRelativePath(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  if (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value)) return false;
  if (value.includes("\0") || value.startsWith("~")) return false;
  return value.split(/[\\/]/).every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function extractTerminalJsonCandidate(text) {
  const trimEnd = text.search(/\s*$/);
  const terminalRawJson = extractWholeRawJsonCandidate(text, trimEnd);
  if (terminalRawJson) {
    return { ok: true, candidate: terminalRawJson };
  }

  const fences = collectFences(text);
  const candidates = [];

  for (const fence of fences) {
    if (isRoleResultFenceInfo(fence.info)) {
      candidates.push({
        kind: "marked_fence",
        start: fence.start,
        end: fence.end,
        jsonText: fence.body.trim()
      });
    } else if (isJsonObjectText(fence.body.trim())) {
      candidates.push({
        kind: "ordinary_json_fence",
        start: fence.start,
        end: fence.end,
        jsonText: fence.body.trim()
      });
    }
  }

  for (const raw of collectRawJsonObjectCandidates(text, fences)) {
    candidates.push(raw);
  }

  if (candidates.length === 0) {
    if (/^\s*\{/.test(text) || fences.some((fence) => isRoleResultFenceInfo(fence.info))) {
      return { ok: false, diagnostics: [diag("malformed_json", "terminal structured role-result JSON is malformed")] };
    }
    return { ok: false, diagnostics: [diag("missing_result", "final response does not contain a terminal structured role-result JSON object")] };
  }

  if (candidates.length > 1) {
    return {
      ok: false,
      diagnostics: [
        diag("multiple_json_candidates", "final response contains more than one JSON candidate", null, {
          candidate_count: candidates.length
        })
      ]
    };
  }

  const [candidate] = candidates;
  if (candidate.kind === "ordinary_json_fence") {
    return {
      ok: false,
      diagnostics: [
        diag("ordinary_json_code_block", "ordinary JSON code blocks are not terminal agent-role-result blocks")
      ]
    };
  }
  if (candidate.end !== trimEnd) {
    return {
      ok: false,
      diagnostics: [
        diag("trailing_prose_after_result", "terminal structured role-result JSON must be the final content")
      ]
    };
  }
  return { ok: true, candidate };
}

function extractWholeRawJsonCandidate(text, trimEnd) {
  const start = text.search(/\S/);
  if (start === -1) return null;
  const jsonText = text.slice(start, trimEnd);
  if (!isJsonObjectText(jsonText)) return null;
  return { kind: "raw_json", start, end: trimEnd, jsonText };
}

function collectFences(text) {
  const fences = [];
  const fenceRe = /(^|\n)```([^\n\r`]*)\r?\n([\s\S]*?)(\n```[ \t]*(?=\n|$))/g;
  let match;
  while ((match = fenceRe.exec(text)) !== null) {
    const leadingNewline = match[1] === "\n" ? 1 : 0;
    const start = match.index + leadingNewline;
    const end = match.index + match[0].length;
    fences.push({
      start,
      end,
      info: match[2].trim(),
      body: match[3]
    });
  }
  return fences;
}

function isRoleResultFenceInfo(info) {
  const normalized = info.toLowerCase().trim();
  return ROLE_RESULT_FENCE_MARKERS.some((marker) => normalized.split(/\s+/).includes(marker));
}

function isJsonObjectText(text) {
  if (!text.startsWith("{") || !text.endsWith("}")) return false;
  try {
    const parsed = JSON.parse(text);
    return isPlainObject(parsed);
  } catch {
    return false;
  }
}

function collectRawJsonObjectCandidates(text, fences) {
  const masked = [...text];
  for (const fence of fences) {
    for (let index = fence.start; index < fence.end; index += 1) masked[index] = " ";
  }
  const candidates = [];
  for (let index = 0; index < masked.length; index += 1) {
    if (masked[index] !== "{") continue;
    const end = findJsonObjectEnd(masked, index);
    if (end === null) continue;
    const jsonText = text.slice(index, end);
    if (isJsonObjectText(jsonText.trim())) {
      candidates.push({ kind: "raw_json", start: index, end, jsonText: jsonText.trim() });
      index = end - 1;
    }
  }
  return candidates;
}

function findJsonObjectEnd(chars, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < chars.length; index += 1) {
    const char = chars[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return null;
}

function detectDuplicateJsonKeys(jsonText) {
  const duplicates = [];
  let index = 0;

  function skipWhitespace() {
    while (/\s/.test(jsonText[index] ?? "")) index += 1;
  }

  function parseValue(path) {
    skipWhitespace();
    const char = jsonText[index];
    if (char === "{") return parseObject(path);
    if (char === "[") return parseArray(path);
    if (char === "\"") {
      parseString();
      return;
    }
    parsePrimitive();
  }

  function parseObject(path) {
    index += 1;
    skipWhitespace();
    const seen = new Set();
    if (jsonText[index] === "}") {
      index += 1;
      return;
    }
    while (index < jsonText.length) {
      skipWhitespace();
      const key = parseString();
      const keyPath = `${path}.${key}`;
      if (seen.has(key)) duplicates.push({ path: keyPath, key });
      seen.add(key);
      skipWhitespace();
      if (jsonText[index] !== ":") throw new Error("expected colon");
      index += 1;
      parseValue(keyPath);
      skipWhitespace();
      if (jsonText[index] === "}") {
        index += 1;
        return;
      }
      if (jsonText[index] !== ",") throw new Error("expected comma");
      index += 1;
    }
    throw new Error("unterminated object");
  }

  function parseArray(path) {
    index += 1;
    skipWhitespace();
    if (jsonText[index] === "]") {
      index += 1;
      return;
    }
    let itemIndex = 0;
    while (index < jsonText.length) {
      parseValue(`${path}[${itemIndex}]`);
      itemIndex += 1;
      skipWhitespace();
      if (jsonText[index] === "]") {
        index += 1;
        return;
      }
      if (jsonText[index] !== ",") throw new Error("expected comma");
      index += 1;
    }
    throw new Error("unterminated array");
  }

  function parseString() {
    if (jsonText[index] !== "\"") throw new Error("expected string");
    const start = index;
    index += 1;
    let escaped = false;
    while (index < jsonText.length) {
      const char = jsonText[index];
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        index += 1;
        return JSON.parse(jsonText.slice(start, index));
      }
      index += 1;
    }
    throw new Error("unterminated string");
  }

  function parsePrimitive() {
    const rest = jsonText.slice(index);
    const match = rest.match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/);
    if (!match) throw new Error("expected primitive");
    index += match[0].length;
  }

  try {
    parseValue("$");
    skipWhitespace();
    if (index !== jsonText.length) return [];
    return duplicates;
  } catch {
    return [];
  }
}
