

export const ANONYMOUS_METRICS_SCHEMA_VERSION = "anonymous-mcp-metrics.v1";

export const METRIC_OUTCOMES = Object.freeze(["returned", "returned_error", "threw"]);
export const METRIC_CLOCK_STATUSES = Object.freeze(["measured", "clock_unavailable"]);
export const METRIC_DURATION_STATUSES = Object.freeze(["measured", "clock_unavailable", "invalid_duration"]);
export const METRIC_MEASUREMENT_STATUSES = Object.freeze([
  "measured",
  "unsafe_value",
  "budget_exceeded",
  "not_returned",
  "measurement_failed"
]);
export const METRIC_HEALTH_REASONS = Object.freeze([
  "invalid_config",
  "invalid_record",
  "queue_full",
  "measurement_failed",
  "compression_failed",
  "file_failed",
  "shutdown_timeout",
  "late_completion"
]);
export const METRIC_TOKEN_STATUS = "not_instrumented";
export const METRIC_REPRESENTATION = "handler_compact_json";

const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]{0,127}$/u;
const HOUR_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:00:00\.000Z$/u;
const HOUR_MS = 60 * 60 * 1000;

export const CALL_RECORD_FIELDS = Object.freeze([
  "schema_version",
  "kind",
  "hour_utc",
  "clock_status",
  "tool",
  "outcome",
  "elapsed_us",
  "duration_status",
  "request_json_bytes",
  "request_status",
  "response_json_bytes",
  "response_status",
  "input_tokens",
  "output_tokens",
  "token_status",
  "representation"
]);

export const HEALTH_RECORD_FIELDS = Object.freeze([
  "schema_version",
  "kind",
  "hour_utc",
  "clock_status",
  "reason",
  "count"
]);

export function projectHourBucket(date) {
  const time = date instanceof Date ? date.getTime() : Number.NaN;
  if (!Number.isFinite(time) || time < 0) {
    return { hour_utc: null, clock_status: "clock_unavailable" };
  }
  try {
    return {
      hour_utc: new Date(Math.floor(time / HOUR_MS) * HOUR_MS).toISOString(),
      clock_status: "measured"
    };
  } catch {
    return { hour_utc: null, clock_status: "clock_unavailable" };
  }
}

export function projectElapsedMicros(startNs, endNs) {
  if (typeof startNs !== "bigint" || typeof endNs !== "bigint") {
    return { elapsed_us: null, duration_status: "clock_unavailable" };
  }
  const elapsedNs = endNs - startNs;
  if (elapsedNs < 0n) return { elapsed_us: null, duration_status: "invalid_duration" };
  const micros = elapsedNs / 1000n;
  if (micros > BigInt(Number.MAX_SAFE_INTEGER)) {
    return { elapsed_us: null, duration_status: "invalid_duration" };
  }
  return { elapsed_us: Number(micros), duration_status: "measured" };
}

function isNonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function hasExactFields(record, fields) {
  if (record === null || typeof record !== "object" || Array.isArray(record)) return false;
  const keys = Object.keys(record);
  return keys.length === fields.length && fields.every((field, index) => keys[index] === field);
}

function validHour(record) {
  return record.clock_status === "measured"
    ? typeof record.hour_utc === "string" && HOUR_PATTERN.test(record.hour_utc)
    : record.clock_status === "clock_unavailable" && record.hour_utc === null;
}

function validMeasurement(bytes, status) {
  if (!METRIC_MEASUREMENT_STATUSES.includes(status)) return false;
  return status === "measured" ? isNonNegativeSafeInteger(bytes) : bytes === null;
}

export function isRegistrableMetricToolName(name) {
  return typeof name === "string" && TOOL_NAME_PATTERN.test(name);
}

export function validateAnonymousMetricRecord(record) {
  if (record?.schema_version !== ANONYMOUS_METRICS_SCHEMA_VERSION) return false;
  if (record.kind === "call") {
    return hasExactFields(record, CALL_RECORD_FIELDS) &&
      validHour(record) &&
      isRegistrableMetricToolName(record.tool) &&
      METRIC_OUTCOMES.includes(record.outcome) &&
      METRIC_DURATION_STATUSES.includes(record.duration_status) &&
      (record.duration_status === "measured"
        ? isNonNegativeSafeInteger(record.elapsed_us)
        : record.elapsed_us === null) &&
      validMeasurement(record.request_json_bytes, record.request_status) &&
      record.request_status !== "not_returned" &&
      validMeasurement(record.response_json_bytes, record.response_status) &&
      (record.response_status === "not_returned") === (record.outcome === "threw") &&
      record.input_tokens === null &&
      record.output_tokens === null &&
      record.token_status === METRIC_TOKEN_STATUS &&
      record.representation === METRIC_REPRESENTATION;
  }
  if (record.kind === "health") {
    return hasExactFields(record, HEALTH_RECORD_FIELDS) &&
      validHour(record) &&
      METRIC_HEALTH_REASONS.includes(record.reason) &&
      Number.isSafeInteger(record.count) && record.count > 0;
  }
  return false;
}

export function buildAnonymousMetric({
  tool,
  registeredToolNames,
  hour,
  outcome,
  elapsed,
  request,
  response
}) {
  if (!(registeredToolNames instanceof Set) || !registeredToolNames.has(tool)) return null;
  const record = {
    schema_version: ANONYMOUS_METRICS_SCHEMA_VERSION,
    kind: "call",
    hour_utc: hour?.hour_utc ?? null,
    clock_status: hour?.clock_status ?? "clock_unavailable",
    tool,
    outcome,
    elapsed_us: elapsed?.elapsed_us ?? null,
    duration_status: elapsed?.duration_status ?? "clock_unavailable",
    request_json_bytes: request?.bytes ?? null,
    request_status: request?.status ?? "measurement_failed",
    response_json_bytes: response?.bytes ?? null,
    response_status: response?.status ?? "measurement_failed",
    input_tokens: null,
    output_tokens: null,
    token_status: METRIC_TOKEN_STATUS,
    representation: METRIC_REPRESENTATION
  };
  return validateAnonymousMetricRecord(record) ? Object.freeze(record) : null;
}

export function buildHealthRecord({ hour, reason, count }) {
  const record = {
    schema_version: ANONYMOUS_METRICS_SCHEMA_VERSION,
    kind: "health",
    hour_utc: hour?.hour_utc ?? null,
    clock_status: hour?.clock_status ?? "clock_unavailable",
    reason,
    count
  };
  return validateAnonymousMetricRecord(record) ? Object.freeze(record) : null;
}

export function encodeAnonymousMetricLine(record) {
  if (!validateAnonymousMetricRecord(record)) return null;
  return `${JSON.stringify(record)}\n`;
}
