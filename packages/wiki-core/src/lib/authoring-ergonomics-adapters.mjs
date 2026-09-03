

import {
  AUTHORING_ERGONOMICS_APPLICATION_STATUSES,
  AUTHORING_ERGONOMICS_CARRIER_LIFECYCLE_STAGES,
  AUTHORING_ERGONOMICS_CARRIER_PRESENCE,
  AUTHORING_ERGONOMICS_EFFECT_PROVENANCE,
  AUTHORING_ERGONOMICS_EVENT_KINDS,
  AUTHORING_ERGONOMICS_IDENTITY_KINDS,
  AUTHORING_ERGONOMICS_RECOVERY_IDENTITY_COMPONENTS,
  AUTHORING_ERGONOMICS_RECEIPT_STATES,
  AUTHORING_ERGONOMICS_TRACE_SCHEMA_VERSION,
  AUTHORING_ERGONOMICS_TRANSPORT_STATUSES,
  AUTHORING_ERGONOMICS_WORKLOAD_OBSERVATION_KINDS,
  AUTHORING_ERGONOMICS_WORKLOAD_OUTCOMES,
  normalizeAuthoringErgonomicsTrace
} from "./authoring-ergonomics-trace.mjs";

export const AUTHORING_ERGONOMICS_ADAPTER_RESULT_SCHEMA_VERSION =
  "authoring-ergonomics-adapter-result.v1";
export const AUTHORING_ERGONOMICS_RETAINED_SMOKE_SCHEMA_VERSION =
  "authoring-ergonomics-retained-smoke.v1";

export const AUTHORING_ERGONOMICS_ADAPTERS = Object.freeze(["errors_log", "retained_smoke"]);

export const AUTHORING_ERGONOMICS_ADAPTER_REFUSAL_CODES = Object.freeze([
  "adapter_input_invalid",
  "unsupported_retained_schema_version",
  "unknown_field",
  "missing_field",
  "invalid_type",
  "invalid_enum",
  "value_too_long",
  "source_too_large",
  "duplicate_source_position",
  "duplicate_capture_declaration",
  "no_recognizable_sections"
]);

export const AUTHORING_ERGONOMICS_CAPTURE_MODES = Object.freeze([
  "all_calls",
  "failures_only",
  "sampled"
]);

const MAX_EVENTS = 5000;
const MAX_SOURCE_LENGTH = 8_000_000;
const MAX_TEXT_LENGTH = 512;
const MAX_REASON_CODES = 32;
const MAX_INVARIANTS = 64;
const MAX_RECORD_IDENTITIES = 64;
const MAX_EFFECTS = 32;

export class AuthoringErgonomicsAdapterError extends Error {
  constructor(code, path, detail) {
    super(`${code} at ${path}: ${detail}`);
    this.name = "AuthoringErgonomicsAdapterError";
    this.code = code;
    this.path = path;
    this.detail = detail;
  }
}

function refuse(code, path, detail) {
  throw new AuthoringErgonomicsAdapterError(code, path, detail);
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const PATH_LIKE = /^(?:file:\/\/|\/|[A-Za-z]:[\\/]|\\\\)/;

function makeRedactionLog() {
  const entries = [];
  return {
    entries,
    record(kind, field, detail) {
      entries.push({ kind, field, detail });
    }
  };
}

function makeUnknownLog() {
  const entries = [];
  return {
    entries,
    record(kind, subject, detail) {
      entries.push({ kind, subject, detail });
    }
  };
}

function bounded(value, path, redactions, maxLength = MAX_TEXT_LENGTH) {
  if (typeof value !== "string" || value.length === 0) {
    refuse("invalid_type", path, "expected a non-empty string");
  }
  if (value.length > maxLength) {
    refuse("value_too_long", path, `exceeds the ${maxLength} character bound`);
  }
  if (!PATH_LIKE.test(value)) return value;
  const segments = value.replace(/[\\/]+$/, "").split(/[\\/]+/);
  const leaf = segments[segments.length - 1] || "unnamed";
  redactions.record("installation_root_redacted", path, "an absolute location was reduced to its final segment");
  return `<redacted-root>/${leaf}`;
}

function boundedPointer(value, path) {
  if (typeof value !== "string" || value.length === 0) {
    refuse("invalid_type", path, "expected a non-empty string");
  }
  if (value.length > MAX_TEXT_LENGTH) {
    refuse("value_too_long", path, `exceeds the ${MAX_TEXT_LENGTH} character bound`);
  }
  return value;
}

function boundedOptional(value, path, redactions, maxLength = MAX_TEXT_LENGTH) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    refuse("invalid_type", path, "expected a string or null (unknown)");
  }
  if (value.length === 0) return null;
  return bounded(value, path, redactions, maxLength);
}

function optionalIntegerAt(value, path) {
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value) || value < 0) {
    refuse("invalid_type", path, "expected a non-negative integer or null (unknown)");
  }
  return value;
}

function optionalBooleanAt(value, path) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "boolean") {
    refuse("invalid_type", path, "expected a boolean or null (unknown)");
  }
  return value;
}

function enumAt(value, path, allowed) {
  if (typeof value !== "string" || !allowed.includes(value)) {
    refuse("invalid_enum", path, `expected one of ${allowed.join(", ")}`);
  }
  return value;
}

function optionalEnumAt(value, path, allowed) {
  if (value === undefined || value === null) return null;
  return enumAt(value, path, allowed);
}

function closed(value, path, allowedKeys) {
  if (!isPlainObject(value)) {
    refuse("invalid_type", path, "expected an object");
  }
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      refuse("unknown_field", `${path}.${key}`, "field is not part of the closed adapter schema");
    }
  }
  return value;
}

function optionalArrayAt(value, path) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) {
    refuse("invalid_type", path, "expected an array or null (unknown)");
  }
  return value;
}

function capped(list, cap, path, kind) {
  if (list.length > cap) {
    refuse("source_too_large", path, `${kind} exceeds the ${cap} entry bound`);
  }
  return list;
}

function dedupe(values) {
  return Array.from(new Set(values));
}

function buildResult(adapter, trace, coverageSummary, redactions, unknowns) {

  const normalized = normalizeAuthoringErgonomicsTrace(trace);
  return Object.freeze({
    schema_version: AUTHORING_ERGONOMICS_ADAPTER_RESULT_SCHEMA_VERSION,
    adapter,
    trace,
    normalized,
    coverage_summary: Object.freeze(coverageSummary.map((entry) => Object.freeze({ ...entry }))),
    redactions: Object.freeze(redactions.entries.map((entry) => Object.freeze({ ...entry }))),
    unknown_evidence: Object.freeze(unknowns.entries.map((entry) => Object.freeze({ ...entry })))
  });
}

function assertUniquePositions(events, path) {
  const seen = new Set();
  for (const event of events) {
    const key = `${event.source_ordinal}:${event.event_index}`;
    if (seen.has(key)) {
      refuse(
        "duplicate_source_position",
        path,
        `source_ordinal ${event.source_ordinal} / event_index ${event.event_index} appears more than once`
      );
    }
    seen.add(key);
  }
}

function baseEvent(eventIndex, sourceOrdinal, eventKind, actorKind, workflowToken) {
  return {
    event_index: eventIndex,
    source_ordinal: sourceOrdinal,
    event_kind: eventKind,
    actor_kind: actorKind,
    workflow_token: workflowToken,
    observed_at: null,
    producer_boundary: null,
    target_identity: null,
    request: null,
    response: null,
    recovery_identity: null,
    authoritative_input_identity: null,
    stage_observations: null,
    continuation: null,
    claimed_effects: null,
    observed_effects: null,
    receipt: null,
    carrier_observation: null,
    validation_facts: null,
    workload_observation: null,
    dispatch_facts: null,
    lookup_capabilities: null,
    advertised_invariants: null,
    recovered_invariants: null,
    provenance_note: null
  };
}

const SECTION_HEADER = /^=== (\S+): (\S+) ===$/;
const BLOCK_LABEL = /^([A-Z][A-Z_]*):$/;
const MCP_PROTOCOL_ERROR = /^MCP error (-?\d+):/;

const REQUEST_TARGET_FIELDS = Object.freeze([
  Object.freeze(["unit", "work_unit"]),
  Object.freeze(["wk_id", "work_record"]),
  Object.freeze(["work_record_id", "work_record"]),
  Object.freeze(["record_id", "record"]),
  Object.freeze(["initiative", "initiative"]),
  Object.freeze(["initiative_id", "initiative"]),
  Object.freeze(["path", "page"])
]);

const RECORD_IDENTITY = /^(?:WK|IN|DEC|SRC)-\d+(?:#[A-Z]+-\d+)?$/;

function splitErrorsLogSections(text, unknowns) {
  const lines = text.split(/\r?\n/);
  const sections = [];
  let current = null;
  let preamble = [];

  const flushBlock = (section) => {
    if (section.label === null) return;
    section.blocks.push({ label: section.label, text: section.buffer.join("\n") });
    section.label = null;
    section.buffer = [];
  };

  for (const line of lines) {
    const header = SECTION_HEADER.exec(line);
    if (header) {
      if (current) flushBlock(current);
      current = {
        session_token: header[1],
        tool: header[2],
        blocks: [],
        label: null,
        buffer: [],
        stray: []
      };
      sections.push(current);
      continue;
    }
    if (current === null) {
      preamble.push(line);
      continue;
    }
    const label = BLOCK_LABEL.exec(line);
    if (label) {
      flushBlock(current);
      current.label = label[1];
      continue;
    }
    if (current.label === null) {
      current.stray.push(line);
      continue;
    }
    current.buffer.push(line);
  }
  if (current) flushBlock(current);

  if (preamble.join("").trim().length > 0) {
    unknowns.record(
      "unparsed_source_preamble",
      "errors_log:preamble",
      "content before the first section header was not interpreted"
    );
  }
  return sections;
}

function parseJsonBlock(section, label, index, unknowns) {
  const block = section.blocks.find((entry) => entry.label === label);
  if (block === undefined) {
    unknowns.record(
      `missing_${label.toLowerCase()}_block`,
      `errors_log:section[${index}]`,
      `the section carries no ${label} block, so its facts stay unknown`
    );
    return null;
  }
  try {
    const parsed = JSON.parse(block.text);
    if (!isPlainObject(parsed)) {
      unknowns.record(
        `malformed_${label.toLowerCase()}_block`,
        `errors_log:section[${index}]`,
        `the ${label} block is not a JSON object, so its facts stay unknown`
      );
      return null;
    }
    return parsed;
  } catch {
    unknowns.record(
      `malformed_${label.toLowerCase()}_block`,
      `errors_log:section[${index}]`,
      `the ${label} block is not parseable JSON, so its facts stay unknown`
    );
    return null;
  }
}

function failureText(failure) {
  const content = failure.content;
  if (!Array.isArray(content)) return null;
  const first = content.find((entry) => isPlainObject(entry) && typeof entry.text === "string");
  return first ? first.text : null;
}

function readDiagnosticIdentities(details, index, redactions, unknowns) {
  if (!isPlainObject(details) || !isPlainObject(details.diagnostics)) return null;
  const projection = details.diagnostics;
  const list = Array.isArray(projection.diagnostics) ? projection.diagnostics : null;
  if (list === null) return null;

  if (projection.truncated === true || (Number.isInteger(projection.omitted_count) && projection.omitted_count > 0)) {
    unknowns.record(
      "bounded_diagnostic_projection_clipped",
      `errors_log:section[${index}]`,
      "the producer's diagnostic projection reported omitted entries, so the returned identities are partial"
    );
  }

  const invariants = [];
  const reasonCodes = [];
  for (const [position, entry] of list.entries()) {
    if (!isPlainObject(entry)) continue;
    const entryPath = `errors_log:section[${index}].diagnostics[${position}]`;
    const code = typeof entry.code === "string" && entry.code.length > 0 ? entry.code : null;
    const claim = typeof entry.claim_id === "string" && entry.claim_id.length > 0 ? entry.claim_id : null;
    const pointer = typeof entry.pointer === "string" && entry.pointer.length > 0 ? entry.pointer : null;
    if (typeof entry.reason_code === "string" && entry.reason_code.length > 0) {
      reasonCodes.push(bounded(entry.reason_code, `${entryPath}.reason_code`, redactions));
    }

    let identity = null;
    if (claim !== null) identity = `claim:${bounded(claim, `${entryPath}.claim_id`, redactions)}`;
    else if (pointer !== null) identity = `pointer:${boundedPointer(pointer, `${entryPath}.pointer`)}`;
    else if (code !== null) identity = `code:${bounded(code, `${entryPath}.code`, redactions)}`;

    if (identity === null) {
      unknowns.record(
        "unidentified_producer_diagnostic",
        entryPath,
        "the diagnostic carries no code, claim, or pointer identity"
      );
      continue;
    }
    invariants.push({
      invariant_id: identity,

      invariant_kind: "constraint",
      invariant_family: code ? bounded(code, `${entryPath}.code`, redactions) : null
    });
  }
  if (invariants.length === 0) return { invariants: null, reason_codes: reasonCodes };
  return {
    invariants: capped(invariants, MAX_INVARIANTS, `errors_log:section[${index}].diagnostics`, "diagnostic identities"),
    reason_codes: reasonCodes
  };
}

function readFailureFacts(failure, index, redactions, unknowns) {
  const text = failureText(failure);
  const structured = isPlainObject(failure.structuredContent) ? failure.structuredContent : null;
  const warning = structured && isPlainObject(structured.warning) ? structured.warning : null;
  const payload = warning && isPlainObject(warning.payload) ? warning.payload : null;
  const details = payload && isPlainObject(payload.details) ? payload.details : null;

  const protocolMatch = typeof text === "string" ? MCP_PROTOCOL_ERROR.exec(text) : null;

  const isError = failure.isError;
  let applicationStatus = "unknown";
  if (isError === true) applicationStatus = "rejected";
  else if (isError === false) applicationStatus = "normal";
  else {
    unknowns.record(
      "absent_producer_error_flag",
      `errors_log:section[${index}]`,
      "the failure record carries no isError flag, so the application status stays unknown"
    );
  }

  const diagnostics = readDiagnosticIdentities(details, index, redactions, unknowns);

  const reasonCodes = [];
  if (payload && typeof payload.reason_code === "string" && payload.reason_code.length > 0) {
    reasonCodes.push(payload.reason_code);
  }
  if (warning && typeof warning.code === "string" && warning.code.length > 0) {
    reasonCodes.push(warning.code);
  }
  if (structured && typeof structured.code === "string" && structured.code.length > 0) {
    reasonCodes.push(structured.code);
  }
  if (protocolMatch) reasonCodes.push(`mcp_protocol_error.${protocolMatch[1]}`);

  if (diagnostics !== null) reasonCodes.push(...diagnostics.reason_codes);

  if (reasonCodes.length === 0) {

    unknowns.record(
      "untyped_producer_failure",
      `errors_log:section[${index}]`,
      "the failure carries no stable reason code; its unbounded text is excluded rather than parsed"
    );
  }

  const producerFamily =
    (structured && typeof structured.schema_version === "string" && structured.schema_version) ||
    (structured && typeof structured.contract === "string" && structured.contract) ||
    null;

  let replacementTool = null;
  if (details && isPlainObject(details.replacement_call) && typeof details.replacement_call.tool === "string") {
    replacementTool = details.replacement_call.tool;
  } else if (
    structured &&
    isPlainObject(structured.remediation) &&
    typeof structured.remediation.mcp === "string" &&
    structured.remediation.mcp.length > 0
  ) {
    replacementTool = structured.remediation.mcp;
  }

  let continuation = null;
  if (structured !== null) {

    continuation = {
      route_present: replacementTool !== null,
      template_only: null,
      replacement_call:
        replacementTool === null
          ? null
          : {
              tool: bounded(replacementTool, `errors_log:section[${index}].replacement_call.tool`, redactions),
              ingress: null,
              named_tool_available: null,
              structural_only: null
            },
      replacement_call_outcome: null,
      explicit_stop: null
    };
  } else {
    unknowns.record(
      "unknown_continuation_route",
      `errors_log:section[${index}]`,
      "the failure carries no typed envelope, so continuation availability stays unknown"
    );
  }

  const producerStage =
    details && typeof details.stage === "string" && details.stage.length > 0 ? details.stage : null;

  return {
    transport_status: protocolMatch ? "error" : "ok",
    application_status: applicationStatus,
    reason_codes:
      reasonCodes.length === 0
        ? null
        : capped(dedupe(reasonCodes), MAX_REASON_CODES, `errors_log:section[${index}].reason_codes`, "reason codes").map(
            (code, position) => bounded(code, `errors_log:section[${index}].reason_codes[${position}]`, redactions)
          ),
    invariant_family:
      details && typeof details.contract_family === "string" && details.contract_family.length > 0
        ? bounded(details.contract_family, `errors_log:section[${index}].contract_family`, redactions)
        : null,
    revealed_invariants: diagnostics === null ? null : diagnostics.invariants,
    producer_family: producerFamily
      ? bounded(producerFamily, `errors_log:section[${index}].producer_family`, redactions)
      : null,
    continuation,
    producer_stage: producerStage
      ? bounded(producerStage, `errors_log:section[${index}].stage`, redactions)
      : null
  };
}

function readRequestFacts(request, index, redactions) {
  if (request === null) return { target: null, expected_stage: null, repo: null, records: [] };

  let target = null;
  for (const [field, kind] of REQUEST_TARGET_FIELDS) {
    const value = request[field];
    if (typeof value === "string" && value.length > 0) {
      target = {
        target_kind: kind,
        target_id: bounded(value, `errors_log:section[${index}].request.${field}`, redactions)
      };
      break;
    }
  }

  const records = [];
  for (const [field] of REQUEST_TARGET_FIELDS) {
    const value = request[field];
    if (typeof value === "string" && RECORD_IDENTITY.test(value)) records.push(value);
  }

  return {
    target,

    expected_stage:
      typeof request.expected_stage === "string" && request.expected_stage.length > 0
        ? bounded(request.expected_stage, `errors_log:section[${index}].request.expected_stage`, redactions)
        : null,

    repo: boundedOptional(request.repo, `errors_log:section[${index}].request.repo`, redactions),
    records
  };
}

export function adaptErrorsLogTrace(text, options = {}) {
  if (typeof text !== "string") {
    refuse("adapter_input_invalid", "errors_log", "expected the journal text as a string");
  }
  if (text.length > MAX_SOURCE_LENGTH) {
    refuse("source_too_large", "errors_log", `exceeds the ${MAX_SOURCE_LENGTH} character bound`);
  }
  closed(options, "errors_log.options", [
    "trace_id",
    "source_kind",
    "source_locator",
    "source_digest",
    "source_ordinal",
    "workload",
    "ingress",
    "diagnostic_tools"
  ]);

  const redactions = makeRedactionLog();
  const unknowns = makeUnknownLog();

  const sourceOrdinal = optionalIntegerAt(options.source_ordinal, "errors_log.options.source_ordinal") ?? 0;
  const sourceLocator =
    boundedOptional(options.source_locator, "errors_log.options.source_locator", redactions) ?? "errors.log";
  const ingress = boundedOptional(options.ingress, "errors_log.options.ingress", redactions);
  const declaredDiagnostics = optionalArrayAt(options.diagnostic_tools, "errors_log.options.diagnostic_tools");
  const diagnosticTools =
    declaredDiagnostics === null
      ? null
      : new Set(
          declaredDiagnostics.map((entry, position) =>
            bounded(entry, `errors_log.options.diagnostic_tools[${position}]`, redactions)
          )
        );

  const sections = splitErrorsLogSections(text, unknowns);
  if (sections.length === 0) {
    if (text.trim().length > 0) {
      refuse("no_recognizable_sections", "errors_log", "the source carries content but no parseable section header");
    }
    unknowns.record(
      "empty_failure_journal",
      "errors_log",
      "the journal records no failure sections; an absence of failures is not normal-success coverage"
    );
  }
  capped(sections, MAX_EVENTS, "errors_log.sections", "sections");

  const events = [];
  const workflowTokens = [];
  const repositories = new Set();
  const records = new Set();

  for (const [index, section] of sections.entries()) {
    if (section.stray.join("").trim().length > 0) {
      unknowns.record(
        "unlabelled_section_content",
        `errors_log:section[${index}]`,
        "content between the section header and its first block label was not interpreted"
      );
    }
    for (const block of section.blocks) {
      if (block.label !== "REQUEST" && block.label !== "FAILURE") {
        unknowns.record(
          "unrecognized_block_label",
          `errors_log:section[${index}].${block.label}`,
          "the adapter interprets only REQUEST and FAILURE blocks"
        );
      }
    }

    const token = bounded(section.session_token, `errors_log:section[${index}].session_token`, redactions);
    const tool = bounded(section.tool, `errors_log:section[${index}].tool`, redactions);
    workflowTokens.push(token);

    const request = parseJsonBlock(section, "REQUEST", index, unknowns);
    const failure = parseJsonBlock(section, "FAILURE", index, unknowns);
    const requestFacts = readRequestFacts(request, index, redactions);
    if (requestFacts.repo !== null) repositories.add(requestFacts.repo);
    for (const record of requestFacts.records) records.add(record);

    const event = baseEvent(index, sourceOrdinal, "tool_call", "consumer", token);
    event.request = {
      request_id: null,
      tool,
      ingress,

      diagnostic: diagnosticTools === null ? null : diagnosticTools.has(tool)
    };
    event.target_identity = requestFacts.target;
    event.provenance_note = "target identity and expected stage are request-side caller assertions";

    const stages = [];
    if (requestFacts.expected_stage !== null) {
      stages.push({
        stage: requestFacts.expected_stage,
        provenance: "caller_expected",
        completeness: "unknown",
        selected_resource_count: null
      });
    }

    if (failure !== null) {
      const facts = readFailureFacts(failure, index, redactions, unknowns);
      event.producer_boundary = {
        boundary_kind: "mcp_tool",
        boundary_id: tool,
        producer_family: facts.producer_family
      };
      event.response = {
        response_id: null,
        transport_status: facts.transport_status,
        application_status: facts.application_status,
        reason_codes: facts.reason_codes,
        invariant_family: facts.invariant_family,
        revealed_invariants: facts.revealed_invariants,
        advertised_invariants: null,
        advertised_alternatives: null,
        validator_branch_matches: null,

        response_bytes: null
      };
      event.continuation = facts.continuation;
      if (facts.producer_stage !== null) {
        stages.push({
          stage: facts.producer_stage,
          provenance: "producer_returned",
          completeness: "unknown",
          selected_resource_count: null
        });
      }
    } else {
      event.producer_boundary = { boundary_kind: "mcp_tool", boundary_id: tool, producer_family: null };
    }

    unknowns.record(
      "absent_authoritative_input_identity",
      `errors_log:section[${index}]`,
      "the journal carries no boundary-issued identity; caller digests are not authoritative"
    );

    event.stage_observations = stages.length === 0 ? null : stages;
    events.push(event);
  }

  if (diagnosticTools === null && sections.length > 0) {
    unknowns.record(
      "undeclared_diagnostic_intent",
      "errors_log",
      "no caller declaration of diagnostic tools was supplied, so every call's diagnostic intent stays unknown"
    );
  }
  if (repositories.size > 1) {
    unknowns.record(
      "ambiguous_observed_repository",
      "errors_log",
      "requests named more than one repository, so the observed repository stays unknown"
    );
  }

  assertUniquePositions(events, "errors_log.events");

  const recordList = Array.from(records).sort();
  capped(recordList, MAX_RECORD_IDENTITIES, "errors_log.observed_identities.records", "record identities");

  const coverage = {
    workload: boundedOptional(options.workload, "errors_log.options.workload", redactions),
    event_families: ["tool_call"],

    population_class: "failure_only",
    normal_success_population_complete: false
  };

  const trace = {
    schema_version: AUTHORING_ERGONOMICS_TRACE_SCHEMA_VERSION,
    trace_id: boundedOptional(options.trace_id, "errors_log.options.trace_id", redactions) ?? "errors-log",
    source: {
      source_kind: boundedOptional(options.source_kind, "errors_log.options.source_kind", redactions) ?? "errors_log",
      source_locator: sourceLocator,
      source_digest: boundedOptional(options.source_digest, "errors_log.options.source_digest", redactions),
      source_ordinal: sourceOrdinal
    },
    observed_identities: {
      repository: repositories.size === 1 ? Array.from(repositories)[0] : null,
      records: recordList,
      focus: null
    },
    workload_fixture: null,
    workflows: dedupe(workflowTokens).map((token) => ({
      workflow_token: token,
      source_ordinal: sourceOrdinal
    })),
    coverage: { declarations: [coverage] },
    events
  };

  return buildResult(
    "errors_log",
    trace,
    [
      {
        event_families: ["tool_call"],
        population_class: "failure_only",
        normal_success_population_complete: false,
        basis: "the source is a failure journal and records no successful call"
      }
    ],
    redactions,
    unknowns
  );
}

const WORKLOAD_EVENT_KINDS = Object.freeze({
  worker: "dispatch_observation",
  reviewer: "dispatch_observation",
  integration: "integration_observation",
  artifact: "validation_observation",
  test: "validation_observation"
});

const RETAINED_OBSERVATION_KINDS = Object.freeze([
  "mcp_call",
  "carrier_observation",
  "dispatch",
  "record_validation",
  "workload_result"
]);

function readRetainedIdentity(value, path, redactions) {
  if (value === undefined || value === null) return null;
  closed(value, path, ["identity_kind", "identity_value", "descriptor_digest"]);
  return {
    identity_kind: enumAt(value.identity_kind, `${path}.identity_kind`, AUTHORING_ERGONOMICS_IDENTITY_KINDS),
    identity_value: bounded(value.identity_value, `${path}.identity_value`, redactions),
    descriptor_digest: boundedOptional(value.descriptor_digest, `${path}.descriptor_digest`, redactions)
  };
}

function readRetainedRecoveryIdentity(value, path, redactions) {
  if (value === undefined || value === null) return null;
  closed(value, path, AUTHORING_ERGONOMICS_RECOVERY_IDENTITY_COMPONENTS);
  return Object.fromEntries(
    AUTHORING_ERGONOMICS_RECOVERY_IDENTITY_COMPONENTS.map((component) => [
      component,
      boundedOptional(value[component], `${path}.${component}`, redactions)
    ])
  );
}

function readRetainedEffects(value, path, redactions, allowProvenance) {
  const list = optionalArrayAt(value, path);
  if (list === null) return null;
  capped(list, MAX_EFFECTS, path, "effects");
  return list.map((entry, index) => {
    const entryPath = `${path}[${index}]`;
    closed(entry, entryPath, ["effect_kind", "effect_target", "observation_provenance"]);
    return {
      effect_kind: bounded(entry.effect_kind, `${entryPath}.effect_kind`, redactions),
      effect_target: boundedOptional(entry.effect_target, `${entryPath}.effect_target`, redactions),
      observation_provenance: allowProvenance
        ? optionalEnumAt(
            entry.observation_provenance,
            `${entryPath}.observation_provenance`,
            AUTHORING_ERGONOMICS_EFFECT_PROVENANCE
          )
        : "producer_returned"
    };
  });
}

function readRetainedMcpCall(observation, path, event, redactions, unknowns) {
  const tool = bounded(observation.tool, `${path}.tool`, redactions);
  const diagnostic = optionalBooleanAt(observation.diagnostic, `${path}.diagnostic`);
  if (diagnostic === null) {
    unknowns.record("undeclared_diagnostic_intent", path, "the retained call declares no diagnostic intent");
  }

  event.request = {
    request_id: boundedOptional(observation.request_id, `${path}.request_id`, redactions),
    tool,
    ingress: boundedOptional(observation.ingress, `${path}.ingress`, redactions),
    diagnostic
  };

  if (observation.target !== undefined && observation.target !== null) {
    closed(observation.target, `${path}.target`, ["target_kind", "target_id"]);
    event.target_identity = {
      target_kind: bounded(observation.target.target_kind, `${path}.target.target_kind`, redactions),
      target_id: bounded(observation.target.target_id, `${path}.target.target_id`, redactions)
    };
  }

  event.authoritative_input_identity = readRetainedIdentity(
    observation.authoritative_identity,
    `${path}.authoritative_identity`,
    redactions
  );
  if (event.authoritative_input_identity === null) {
    unknowns.record(
      "absent_authoritative_input_identity",
      path,
      "the retained call carries no boundary-issued identity, so grouping stays confined to this call"
    );
  }

  const stages = [];

  if (observation.request_assertions !== undefined && observation.request_assertions !== null) {
    closed(observation.request_assertions, `${path}.request_assertions`, ["expected_stage"]);
    const expected = boundedOptional(
      observation.request_assertions.expected_stage,
      `${path}.request_assertions.expected_stage`,
      redactions
    );
    if (expected !== null) {
      stages.push({
        stage: expected,
        provenance: "caller_expected",
        completeness: "unknown",
        selected_resource_count: null
      });
    }
    event.provenance_note = "request_assertions are caller-side and never establish a producer defect";
  }

  if (observation.response === undefined || observation.response === null) {
    unknowns.record("absent_producer_response", path, "the retained call records no producer response");
  } else {
    const responsePath = `${path}.response`;
    closed(observation.response, responsePath, [
      "response_id",
      "transport_status",
      "application_status",
      "reason_codes",
      "invariant_family",
      "producer_family",
      "returned_stage",
      "route_present",
      "replacement_call",
      "recovery_identity",
      "response_bytes"
    ]);
    const reasonCodes = optionalArrayAt(observation.response.reason_codes, `${responsePath}.reason_codes`);
    event.response = {
      response_id: boundedOptional(observation.response.response_id, `${responsePath}.response_id`, redactions),
      transport_status: enumAt(
        observation.response.transport_status,
        `${responsePath}.transport_status`,
        AUTHORING_ERGONOMICS_TRANSPORT_STATUSES
      ),
      application_status: enumAt(
        observation.response.application_status,
        `${responsePath}.application_status`,
        AUTHORING_ERGONOMICS_APPLICATION_STATUSES
      ),
      reason_codes:
        reasonCodes === null
          ? null
          : capped(reasonCodes, MAX_REASON_CODES, `${responsePath}.reason_codes`, "reason codes").map((code, index) =>
              bounded(code, `${responsePath}.reason_codes[${index}]`, redactions)
            ),
      invariant_family: boundedOptional(
        observation.response.invariant_family,
        `${responsePath}.invariant_family`,
        redactions
      ),
      revealed_invariants: null,
      advertised_invariants: null,
      advertised_alternatives: null,
      validator_branch_matches: null,
      response_bytes: optionalIntegerAt(
        observation.response.response_bytes,
        `${responsePath}.response_bytes`
      )
    };
    event.recovery_identity = readRetainedRecoveryIdentity(
      observation.response.recovery_identity,
      `${responsePath}.recovery_identity`,
      redactions
    );
    if (event.recovery_identity === null) {
      unknowns.record(
        "absent_recovery_identity",
        path,
        "the producer response carries no boundary-issued semantic recovery identity"
      );
    }

    const routePresent = optionalBooleanAt(observation.response.route_present, `${responsePath}.route_present`);
    const replacement = observation.response.replacement_call;
    if (replacement !== undefined && replacement !== null) {
      closed(replacement, `${responsePath}.replacement_call`, [
        "tool",
        "ingress",
        "named_tool_available",
        "structural_only"
      ]);
    }
    if (routePresent === null && (replacement === undefined || replacement === null)) {
      unknowns.record("unknown_continuation_route", path, "the retained response declares no continuation route state");
    } else {
      event.continuation = {
        route_present: routePresent === null ? replacement !== undefined && replacement !== null : routePresent,
        template_only: null,
        replacement_call:
          replacement === undefined || replacement === null
            ? null
            : {
                tool: bounded(replacement.tool, `${responsePath}.replacement_call.tool`, redactions),
                ingress: boundedOptional(replacement.ingress, `${responsePath}.replacement_call.ingress`, redactions),
                named_tool_available: optionalBooleanAt(
                  replacement.named_tool_available,
                  `${responsePath}.replacement_call.named_tool_available`
                ),
                structural_only: optionalBooleanAt(
                  replacement.structural_only,
                  `${responsePath}.replacement_call.structural_only`
                )
              },
        replacement_call_outcome: null,
        explicit_stop: null
      };
    }

    const returned = observation.response.returned_stage;
    if (returned !== undefined && returned !== null) {
      closed(returned, `${responsePath}.returned_stage`, ["stage", "completeness", "selected_resource_count"]);
      stages.push({
        stage: bounded(returned.stage, `${responsePath}.returned_stage.stage`, redactions),
        provenance: "producer_returned",

        completeness: returned.completeness === undefined || returned.completeness === null
          ? "unknown"
          : enumAt(returned.completeness, `${responsePath}.returned_stage.completeness`, [
              "complete",
              "incomplete",
              "unknown"
            ]),
        selected_resource_count: optionalIntegerAt(
          returned.selected_resource_count,
          `${responsePath}.returned_stage.selected_resource_count`
        )
      });
    }

    event.producer_boundary = {
      boundary_kind: "mcp_tool",
      boundary_id: tool,
      producer_family: boundedOptional(
        observation.response.producer_family,
        `${responsePath}.producer_family`,
        redactions
      )
    };
  }

  if (event.producer_boundary === null) {
    event.producer_boundary = { boundary_kind: "mcp_tool", boundary_id: tool, producer_family: null };
  }

  if (observation.receipt !== undefined && observation.receipt !== null) {
    closed(observation.receipt, `${path}.receipt`, ["receipt_state", "receipt_id"]);
    event.receipt = {
      receipt_state: enumAt(
        observation.receipt.receipt_state,
        `${path}.receipt.receipt_state`,
        AUTHORING_ERGONOMICS_RECEIPT_STATES
      ),
      receipt_id: boundedOptional(observation.receipt.receipt_id, `${path}.receipt.receipt_id`, redactions)
    };
  } else {
    unknowns.record("absent_receipt_observation", path, "the retained call records no receipt state");
  }

  event.claimed_effects = readRetainedEffects(observation.claimed_effects, `${path}.claimed_effects`, redactions, false);
  event.observed_effects = readRetainedEffects(observation.observed_effects, `${path}.observed_effects`, redactions, true);
  event.stage_observations = stages.length === 0 ? null : stages;
}

function readRetainedObservation(observation, index, sourceOrdinal, redactions, unknowns) {
  const path = `retained_smoke.observations[${index}]`;
  if (!isPlainObject(observation)) {
    refuse("invalid_type", path, "expected an object");
  }
  const kind = enumAt(observation.kind, `${path}.kind`, RETAINED_OBSERVATION_KINDS);
  const ordinal = optionalIntegerAt(observation.ordinal, `${path}.ordinal`);
  const sessionToken = boundedOptional(observation.session_token, `${path}.session_token`, redactions);
  if (sessionToken === null) {
    unknowns.record(
      "absent_session_token",
      path,
      "the retained observation carries no explicit session token, so cross-event grouping is forbidden"
    );
  }

  if (kind === "mcp_call") {
    closed(observation, path, [
      "kind",
      "ordinal",
      "session_token",
      "tool",
      "ingress",
      "request_id",
      "diagnostic",
      "target",
      "authoritative_identity",
      "request_assertions",
      "response",
      "receipt",
      "claimed_effects",
      "observed_effects"
    ]);
    const event = baseEvent(ordinal ?? index, sourceOrdinal, "tool_call", "consumer", sessionToken);
    readRetainedMcpCall(observation, path, event, redactions, unknowns);
    return event;
  }

  if (kind === "carrier_observation") {
    closed(observation, path, [
      "kind",
      "ordinal",
      "session_token",
      "carrier_id",
      "lifecycle_stage",
      "presence",
      "content_identity",
      "selection_fence",
      "authoritative_identity"
    ]);
    const event = baseEvent(ordinal ?? index, sourceOrdinal, "authoritative_ref_observation", "authority", sessionToken);
    event.carrier_observation = {
      carrier_id: bounded(observation.carrier_id, `${path}.carrier_id`, redactions),
      lifecycle_stage: enumAt(
        observation.lifecycle_stage,
        `${path}.lifecycle_stage`,
        AUTHORING_ERGONOMICS_CARRIER_LIFECYCLE_STAGES
      ),
      presence: enumAt(observation.presence, `${path}.presence`, AUTHORING_ERGONOMICS_CARRIER_PRESENCE),
      content_identity: boundedOptional(observation.content_identity, `${path}.content_identity`, redactions),
      selection_fence: boundedOptional(observation.selection_fence, `${path}.selection_fence`, redactions)
    };
    if (event.carrier_observation.presence === "unresolved") {
      unknowns.record(
        "unresolved_carrier_reference",
        path,
        "the retained lifecycle observation could not resolve the reference; it stays unresolved rather than absent"
      );
    }
    event.authoritative_input_identity = readRetainedIdentity(
      observation.authoritative_identity,
      `${path}.authoritative_identity`,
      redactions
    );
    return event;
  }

  if (kind === "dispatch") {
    closed(observation, path, ["kind", "ordinal", "session_token", "paid", "dispatched_unit", "action_kind"]);
    const event = baseEvent(ordinal ?? index, sourceOrdinal, "dispatch_observation", "consumer", sessionToken);
    const paid = optionalBooleanAt(observation.paid, `${path}.paid`);
    if (paid === null) {
      unknowns.record("unknown_paid_dispatch", path, "the retained dispatch observation does not state whether it was paid");
    }
    event.dispatch_facts = {
      paid,
      dispatched_unit: boundedOptional(observation.dispatched_unit, `${path}.dispatched_unit`, redactions),
      action_kind: boundedOptional(observation.action_kind, `${path}.action_kind`, redactions)
    };
    return event;
  }

  if (kind === "record_validation") {
    closed(observation, path, ["kind", "ordinal", "session_token", "producer", "unit", "divergences"]);
    const event = baseEvent(ordinal ?? index, sourceOrdinal, "validation_observation", "authority", sessionToken);
    const divergences = optionalArrayAt(observation.divergences, `${path}.divergences`);
    event.validation_facts = {

      producer: bounded(observation.producer, `${path}.producer`, redactions),
      unit: boundedOptional(observation.unit, `${path}.unit`, redactions),
      divergences:
        divergences === null
          ? null
          : divergences.map((entry, position) => {
              const entryPath = `${path}.divergences[${position}]`;
              closed(entry, entryPath, ["code", "parent_subject", "slice_subject", "severity"]);
              return {
                code: bounded(entry.code, `${entryPath}.code`, redactions),
                parent_subject: boundedOptional(entry.parent_subject, `${entryPath}.parent_subject`, redactions),
                slice_subject: boundedOptional(entry.slice_subject, `${entryPath}.slice_subject`, redactions),
                severity: boundedOptional(entry.severity, `${entryPath}.severity`, redactions)
              };
            })
    };
    if (divergences === null) {
      unknowns.record(
        "unknown_validation_divergences",
        path,
        "the retained validation observation lists no divergences; absence of a list is unknown, not none"
      );
    }
    return event;
  }

  closed(observation, path, ["kind", "ordinal", "session_token", "observation_kind", "outcome", "label"]);
  const observationKind = enumAt(
    observation.observation_kind,
    `${path}.observation_kind`,
    AUTHORING_ERGONOMICS_WORKLOAD_OBSERVATION_KINDS
  );
  const event = baseEvent(
    ordinal ?? index,
    sourceOrdinal,
    WORKLOAD_EVENT_KINDS[observationKind],
    "authority",
    sessionToken
  );
  event.workload_observation = {
    observation_kind: observationKind,
    outcome: enumAt(observation.outcome, `${path}.outcome`, AUTHORING_ERGONOMICS_WORKLOAD_OUTCOMES),

    label: boundedOptional(observation.label, `${path}.label`, redactions)
  };
  return event;
}

function readCaptureCoverage(capture, redactions, unknowns) {
  const declarations = [];
  const summary = [];
  const claimed = new Set();

  const entries = optionalArrayAt(capture, "retained_smoke.capture.declarations");
  if (entries === null || entries.length === 0) {
    unknowns.record(
      "absent_capture_declaration",
      "retained_smoke.capture",
      "the retained source declares no captured population, so every observed family stays undeclared"
    );
    return { declarations, summary };
  }

  for (const [index, entry] of entries.entries()) {
    const path = `retained_smoke.capture.declarations[${index}]`;
    closed(entry, path, [
      "event_families",
      "capture_mode",
      "captured_record_count",
      "total_record_count",
      "workload"
    ]);
    const families = optionalArrayAt(entry.event_families, `${path}.event_families`);
    if (families === null || families.length === 0) {
      refuse("missing_field", `${path}.event_families`, "a capture declaration must name at least one event family");
    }
    const normalizedFamilies = families.map((family, position) =>
      enumAt(family, `${path}.event_families[${position}]`, AUTHORING_ERGONOMICS_EVENT_KINDS)
    );
    for (const family of normalizedFamilies) {
      if (claimed.has(family)) {
        refuse("duplicate_capture_declaration", path, `event family ${family} is declared more than once`);
      }
      claimed.add(family);
    }

    const mode = optionalEnumAt(entry.capture_mode, `${path}.capture_mode`, AUTHORING_ERGONOMICS_CAPTURE_MODES);
    const capturedCount = optionalIntegerAt(entry.captured_record_count, `${path}.captured_record_count`);
    const totalCount = optionalIntegerAt(entry.total_record_count, `${path}.total_record_count`);

    let populationClass;
    let complete;
    let basis;
    if (mode === "all_calls" && capturedCount !== null && totalCount !== null && capturedCount === totalCount) {
      populationClass = "normal_and_failure";
      complete = true;
      basis = "the retained source states it captured every call and its own counts agree";
    } else if (mode === "failures_only") {
      populationClass = "failure_only";
      complete = false;
      basis = "the retained source states it captured failures only";
    } else {
      populationClass = "unknown";
      complete = null;
      basis =
        mode === "all_calls"
          ? "the retained source claims complete capture but its counts are absent or disagree"
          : mode === null
            ? "the retained source states no capture mode"
            : `the retained source states ${mode} capture, which cannot prove completeness`;
      unknowns.record("unproven_capture_completeness", path, basis);
    }

    declarations.push({
      workload: boundedOptional(entry.workload, `${path}.workload`, redactions),
      event_families: normalizedFamilies,
      population_class: populationClass,
      normal_success_population_complete: complete
    });
    summary.push({
      event_families: normalizedFamilies,
      population_class: populationClass,
      normal_success_population_complete: complete,
      basis
    });
  }

  return { declarations, summary };
}

export function adaptRetainedSmokeTrace(input) {
  if (!isPlainObject(input)) {
    refuse("adapter_input_invalid", "retained_smoke", "expected a retained-smoke envelope object");
  }
  closed(input, "retained_smoke", [
    "schema_version",
    "trace_id",
    "retained_source",
    "workload_label",
    "observed_identities",
    "sessions",
    "capture",
    "observations"
  ]);
  if (input.schema_version !== AUTHORING_ERGONOMICS_RETAINED_SMOKE_SCHEMA_VERSION) {
    refuse(
      "unsupported_retained_schema_version",
      "retained_smoke.schema_version",
      `expected ${AUTHORING_ERGONOMICS_RETAINED_SMOKE_SCHEMA_VERSION}`
    );
  }

  const redactions = makeRedactionLog();
  const unknowns = makeUnknownLog();

  const sourcePath = "retained_smoke.retained_source";
  closed(input.retained_source ?? {}, sourcePath, [
    "source_kind",
    "source_locator",
    "source_digest",
    "source_ordinal"
  ]);
  const retainedSource = input.retained_source ?? {};
  const sourceOrdinal = optionalIntegerAt(retainedSource.source_ordinal, `${sourcePath}.source_ordinal`) ?? 0;
  const sourceDigest = boundedOptional(retainedSource.source_digest, `${sourcePath}.source_digest`, redactions);
  if (sourceDigest === null) {
    unknowns.record("absent_source_digest", sourcePath, "the retained source declares no content digest");
  }

  const observations = optionalArrayAt(input.observations, "retained_smoke.observations") ?? [];
  capped(observations, MAX_EVENTS, "retained_smoke.observations", "observations");

  const events = observations.map((observation, index) =>
    readRetainedObservation(observation, index, sourceOrdinal, redactions, unknowns)
  );
  assertUniquePositions(events, "retained_smoke.observations");

  const capture = isPlainObject(input.capture) ? input.capture : null;
  if (input.capture !== undefined && input.capture !== null && capture === null) {
    refuse("invalid_type", "retained_smoke.capture", "expected an object or null (unknown)");
  }
  if (capture !== null) closed(capture, "retained_smoke.capture", ["declarations"]);
  const { declarations, summary } = readCaptureCoverage(
    capture === null ? null : capture.declarations,
    redactions,
    unknowns
  );

  const declaredFamilies = new Set(declarations.flatMap((declaration) => declaration.event_families));
  for (const family of new Set(events.map((event) => event.event_kind))) {
    if (declaredFamilies.has(family)) continue;
    unknowns.record(
      "undeclared_observed_family",
      `retained_smoke:${family}`,
      "events of this family were retained with no capture declaration, so its population stays unavailable"
    );
  }

  const sessions = optionalArrayAt(input.sessions, "retained_smoke.sessions");
  const declaredSessions = (sessions ?? []).map((entry, index) => {
    const path = `retained_smoke.sessions[${index}]`;
    closed(entry, path, ["session_token", "source_ordinal"]);
    return {
      workflow_token: bounded(entry.session_token, `${path}.session_token`, redactions),
      source_ordinal: optionalIntegerAt(entry.source_ordinal, `${path}.source_ordinal`) ?? sourceOrdinal
    };
  });
  if (sessions === null) {
    unknowns.record(
      "absent_session_partition",
      "retained_smoke.sessions",
      "the retained source declares no explicit sessions; only tokens carried by observations partition workflows"
    );
  }

  const identitiesPath = "retained_smoke.observed_identities";
  const identities = input.observed_identities;
  if (identities !== undefined && identities !== null) {
    closed(identities, identitiesPath, ["repository", "records", "focus"]);
  }
  const identityRecords = optionalArrayAt(identities?.records, `${identitiesPath}.records`);
  if (identityRecords !== null) {
    capped(identityRecords, MAX_RECORD_IDENTITIES, `${identitiesPath}.records`, "record identities");
  }

  const trace = {
    schema_version: AUTHORING_ERGONOMICS_TRACE_SCHEMA_VERSION,
    trace_id: boundedOptional(input.trace_id, "retained_smoke.trace_id", redactions) ?? "retained-smoke",
    source: {
      source_kind: boundedOptional(retainedSource.source_kind, `${sourcePath}.source_kind`, redactions) ?? "retained_smoke",

      source_locator:
        boundedOptional(retainedSource.source_locator, `${sourcePath}.source_locator`, redactions) ?? "retained-smoke",
      source_digest: sourceDigest,
      source_ordinal: sourceOrdinal
    },
    observed_identities: {
      repository: boundedOptional(identities?.repository, `${identitiesPath}.repository`, redactions),
      records:
        identityRecords === null
          ? null
          : identityRecords.map((record, index) => bounded(record, `${identitiesPath}.records[${index}]`, redactions)),
      focus: boundedOptional(identities?.focus, `${identitiesPath}.focus`, redactions)
    },

    workload_fixture: boundedOptional(input.workload_label, "retained_smoke.workload_label", redactions),
    workflows: declaredSessions,
    coverage: { declarations },
    events
  };

  return buildResult("retained_smoke", trace, summary, redactions, unknowns);
}
