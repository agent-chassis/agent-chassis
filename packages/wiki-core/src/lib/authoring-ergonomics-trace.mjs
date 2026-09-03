

export const AUTHORING_ERGONOMICS_TRACE_SCHEMA_VERSION = "authoring-ergonomics-trace.v1";
export const AUTHORING_ERGONOMICS_NORMALIZED_SCHEMA_VERSION =
  "authoring-ergonomics-trace.normalized.v1";
export const AUTHORING_ERGONOMICS_REPORT_SCHEMA_VERSION = "authoring-ergonomics-report.v1";
export const AUTHORING_ERGONOMICS_TRACE_OWNER = "IN-0016";

export const AUTHORING_ERGONOMICS_RECOVERY_IDENTITY_COMPONENTS = Object.freeze([
  "work_record_id",
  "carrier_generation",
  "verification_id",
  "semantic_objective"
]);

export const AUTHORING_ERGONOMICS_EVENT_KINDS = Object.freeze([
  "tool_discovery",
  "tool_call",
  "application_state",
  "continuation",
  "persistence_receipt",
  "authoritative_ref_observation",
  "public_read_observation",
  "public_query_observation",
  "dispatch_observation",
  "integration_observation",
  "validation_observation",
  "source_inspection"
]);

export const AUTHORING_ERGONOMICS_ACTOR_KINDS = Object.freeze([
  "producer",
  "consumer",
  "authority",
  "unknown"
]);

export const AUTHORING_ERGONOMICS_POPULATION_CLASSES = Object.freeze([
  "failure_only",
  "normal_and_failure",
  "unknown"
]);

export const AUTHORING_ERGONOMICS_STAGE_PROVENANCE = Object.freeze([
  "caller_expected",
  "producer_returned",
  "authoritative_observed"
]);

export const AUTHORING_ERGONOMICS_STAGE_COMPLETENESS = Object.freeze([
  "complete",
  "incomplete",
  "unknown"
]);

export const AUTHORING_ERGONOMICS_IDENTITY_KINDS = Object.freeze([
  "carrier_generation",
  "work_record_revision",
  "authoritative_ref_snapshot",
  "public_selection_fence"
]);

export const AUTHORING_ERGONOMICS_TRANSPORT_STATUSES = Object.freeze(["ok", "error", "unknown"]);

export const AUTHORING_ERGONOMICS_APPLICATION_STATUSES = Object.freeze([
  "accepted",
  "normal",
  "rejected",
  "unknown"
]);

export const AUTHORING_ERGONOMICS_BOUNDARY_KINDS = Object.freeze([
  "mcp_tool",
  "public_ingress",
  "launcher",
  "record_store",
  "unknown"
]);

export const AUTHORING_ERGONOMICS_INVARIANT_KINDS = Object.freeze([
  "identity",
  "relation",
  "target_type",
  "binding",
  "constraint"
]);

export const AUTHORING_ERGONOMICS_EFFECT_PROVENANCE = Object.freeze([
  "producer_returned",
  "authoritative_observed"
]);

export const AUTHORING_ERGONOMICS_RECEIPT_STATES = Object.freeze(["present", "absent", "unknown"]);

export const AUTHORING_ERGONOMICS_CARRIER_LIFECYCLE_STAGES = Object.freeze([
  "authoring",
  "wk_ref",
  "public_selection",
  "dispatch_snapshot",
  "integrated_tip",
  "terminal_candidate"
]);

export const AUTHORING_ERGONOMICS_CARRIER_PRESENCE = Object.freeze([
  "present",
  "absent",
  "unresolved"
]);

export const AUTHORING_ERGONOMICS_CAPABILITY_STATES = Object.freeze([
  "available",
  "unavailable",
  "unknown"
]);

export const AUTHORING_ERGONOMICS_WORKLOAD_OBSERVATION_KINDS = Object.freeze([
  "worker",
  "reviewer",
  "integration",
  "artifact",
  "test"
]);

export const AUTHORING_ERGONOMICS_WORKLOAD_OUTCOMES = Object.freeze([
  "success",
  "failure",
  "unknown"
]);

export const AUTHORING_ERGONOMICS_CONTINUATION_OUTCOMES = Object.freeze([
  "accepted",
  "rejected",
  "not_attempted",
  "unknown"
]);

export const AUTHORING_ERGONOMICS_AXES = Object.freeze([
  "producer",
  "consumer",
  "record_quality",
  "persistence_lifecycle",
  "public_consumer",
  "workload"
]);

export const AUTHORING_ERGONOMICS_DETECTORS = Object.freeze([
  Object.freeze({ id: "ERG-001", detector: "repeated_refusal_cascade" }),
  Object.freeze({ id: "ERG-002", detector: "progressively_revealed_invariant" }),
  Object.freeze({ id: "ERG-003", detector: "unusable_continuation" }),
  Object.freeze({ id: "ERG-004", detector: "ambiguous_alternative" }),
  Object.freeze({ id: "ERG-005", detector: "unverified_effect_response" }),
  Object.freeze({ id: "ERG-006", detector: "stage_transition_regression" }),
  Object.freeze({ id: "ERG-007", detector: "ignored_typed_next_action" }),
  Object.freeze({ id: "ERG-008", detector: "source_inspection_escape" }),
  Object.freeze({ id: "ERG-009", detector: "parent_slice_quality_divergence" }),
  Object.freeze({ id: "ERG-010", detector: "controlled_carrier_lifecycle_loss" }),
  Object.freeze({ id: "ERG-011", detector: "false_green_workload" })
]);

export const AUTHORING_ERGONOMICS_DETECTOR_IDS = Object.freeze(
  AUTHORING_ERGONOMICS_DETECTORS.map((entry) => entry.id)
);

const METRIC_POPULATIONS = Object.freeze({
  workflow_count: Object.freeze([]),
  episode_count: Object.freeze(["tool_call"]),
  tool_call_count: Object.freeze(["tool_call"]),
  refusal_count: Object.freeze(["tool_call"]),
  unrecovered_authoring_failure_count: Object.freeze(["tool_call"]),
  repeated_refusal_episode_count: Object.freeze(["tool_call"]),
  unique_invariant_count: Object.freeze(["tool_call", "source_inspection"]),
  source_inspection_escape_count: Object.freeze(["source_inspection"]),
  unusable_continuation_count: Object.freeze(["tool_call"]),
  unverified_effect_response_count: Object.freeze(["tool_call", "persistence_receipt"]),
  stage_transition_regression_count: Object.freeze(["tool_call", "application_state"]),
  paid_dispatch_reached_count: Object.freeze(["dispatch_observation"]),
  authoritative_effect_observed_count: Object.freeze([
    "authoritative_ref_observation",
    "persistence_receipt"
  ])
});

export const AUTHORING_ERGONOMICS_METRIC_NAMES = Object.freeze(Object.keys(METRIC_POPULATIONS));

export class AuthoringErgonomicsTraceError extends Error {
  constructor(code, path, detail) {
    super(`${code} at ${path}: ${detail}`);
    this.name = "AuthoringErgonomicsTraceError";
    this.code = code;
    this.path = path;
    this.detail = detail;
  }
}

function fail(code, path, detail) {
  throw new AuthoringErgonomicsTraceError(code, path, detail);
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function closedObject(value, path, allowedKeys) {
  if (!isPlainObject(value)) {
    fail("invalid_type", path, "expected an object");
  }
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      fail("unknown_field", `${path}.${key}`, "field is not part of the closed schema");
    }
  }
  return value;
}

function requireString(value, path) {
  if (typeof value !== "string" || value.length === 0) {
    fail("invalid_type", path, "expected a non-empty string");
  }
  return value;
}

function optionalString(value, path) {
  if (value === undefined || value === null) return null;
  return requireString(value, path);
}

function requireInteger(value, path) {
  if (!Number.isInteger(value) || value < 0) {
    fail("invalid_type", path, "expected a non-negative integer");
  }
  return value;
}

function optionalInteger(value, path) {
  if (value === undefined || value === null) return null;
  return requireInteger(value, path);
}

function requireEnum(value, path, allowed) {
  if (typeof value !== "string" || !allowed.includes(value)) {
    fail("invalid_enum", path, `expected one of ${allowed.join(", ")}`);
  }
  return value;
}

function optionalEnum(value, path, allowed) {
  if (value === undefined || value === null) return null;
  return requireEnum(value, path, allowed);
}

function optionalBoolean(value, path) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "boolean") {
    fail("invalid_type", path, "expected a boolean or null (unknown)");
  }
  return value;
}

function requireBoolean(value, path) {
  if (typeof value !== "boolean") {
    fail("invalid_type", path, "expected a boolean");
  }
  return value;
}

function optionalList(value, path, mapItem) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) {
    fail("invalid_type", path, "expected an array or null (unknown)");
  }
  return Object.freeze(value.map((item, index) => mapItem(item, `${path}[${index}]`)));
}

function requireList(value, path, mapItem) {
  const list = optionalList(value, path, mapItem);
  if (list === null) {
    fail("missing_field", path, "expected an array");
  }
  return list;
}

function optionalObject(value, path, read) {
  if (value === undefined || value === null) return null;
  return read(value, path);
}

function freezeDeep(value) {
  if (Array.isArray(value)) {
    value.forEach(freezeDeep);
    return Object.freeze(value);
  }
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) freezeDeep(value[key]);
    return Object.freeze(value);
  }
  return value;
}

function readIdentityRef(value, path) {
  closedObject(value, path, ["identity_kind", "identity_value", "descriptor_digest"]);
  return {
    identity_kind: requireEnum(value.identity_kind, `${path}.identity_kind`, AUTHORING_ERGONOMICS_IDENTITY_KINDS),
    identity_value: requireString(value.identity_value, `${path}.identity_value`),
    descriptor_digest: optionalString(value.descriptor_digest, `${path}.descriptor_digest`)
  };
}

function readBoundary(value, path) {
  closedObject(value, path, ["boundary_kind", "boundary_id", "producer_family"]);
  return {
    boundary_kind: requireEnum(value.boundary_kind, `${path}.boundary_kind`, AUTHORING_ERGONOMICS_BOUNDARY_KINDS),
    boundary_id: requireString(value.boundary_id, `${path}.boundary_id`),
    producer_family: optionalString(value.producer_family, `${path}.producer_family`)
  };
}

function readTarget(value, path) {
  closedObject(value, path, ["target_kind", "target_id"]);
  return {
    target_kind: requireString(value.target_kind, `${path}.target_kind`),
    target_id: requireString(value.target_id, `${path}.target_id`)
  };
}

function readInvariant(value, path) {
  closedObject(value, path, ["invariant_id", "invariant_kind", "invariant_family"]);
  return {
    invariant_id: requireString(value.invariant_id, `${path}.invariant_id`),
    invariant_kind: requireEnum(value.invariant_kind, `${path}.invariant_kind`, AUTHORING_ERGONOMICS_INVARIANT_KINDS),
    invariant_family: optionalString(value.invariant_family, `${path}.invariant_family`)
  };
}

function readAlternative(value, path) {
  closedObject(value, path, ["alternative_id", "discriminators", "precedence_declared"]);
  return {
    alternative_id: requireString(value.alternative_id, `${path}.alternative_id`),
    discriminators: optionalList(value.discriminators, `${path}.discriminators`, (item, itemPath) =>
      requireString(item, itemPath)
    ),
    precedence_declared: optionalBoolean(value.precedence_declared, `${path}.precedence_declared`)
  };
}

function readEffect(value, path) {
  closedObject(value, path, ["effect_kind", "effect_target", "observation_provenance"]);
  return {
    effect_kind: requireString(value.effect_kind, `${path}.effect_kind`),
    effect_target: optionalString(value.effect_target, `${path}.effect_target`),
    observation_provenance: optionalEnum(
      value.observation_provenance,
      `${path}.observation_provenance`,
      AUTHORING_ERGONOMICS_EFFECT_PROVENANCE
    )
  };
}

function readStageObservation(value, path) {
  closedObject(value, path, ["stage", "provenance", "completeness", "selected_resource_count"]);
  return {
    stage: requireString(value.stage, `${path}.stage`),
    provenance: requireEnum(value.provenance, `${path}.provenance`, AUTHORING_ERGONOMICS_STAGE_PROVENANCE),

    completeness: requireEnum(
      value.completeness,
      `${path}.completeness`,
      AUTHORING_ERGONOMICS_STAGE_COMPLETENESS
    ),
    selected_resource_count: optionalInteger(
      value.selected_resource_count,
      `${path}.selected_resource_count`
    )
  };
}

function readRequest(value, path) {
  closedObject(value, path, ["request_id", "tool", "ingress", "diagnostic"]);
  return {
    request_id: optionalString(value.request_id, `${path}.request_id`),
    tool: optionalString(value.tool, `${path}.tool`),
    ingress: optionalString(value.ingress, `${path}.ingress`),
    diagnostic: optionalBoolean(value.diagnostic, `${path}.diagnostic`)
  };
}

function readRecoveryIdentity(value, path) {
  closedObject(value, path, AUTHORING_ERGONOMICS_RECOVERY_IDENTITY_COMPONENTS);
  return Object.fromEntries(
    AUTHORING_ERGONOMICS_RECOVERY_IDENTITY_COMPONENTS.map((component) => [
      component,
      optionalString(value[component], `${path}.${component}`)
    ])
  );
}

function readResponse(value, path) {
  closedObject(value, path, [
    "response_id",
    "transport_status",
    "application_status",
    "reason_codes",
    "invariant_family",
    "revealed_invariants",
    "advertised_invariants",
    "advertised_alternatives",
    "validator_branch_matches",
    "response_bytes"
  ]);
  return {
    response_id: optionalString(value.response_id, `${path}.response_id`),
    transport_status: requireEnum(
      value.transport_status,
      `${path}.transport_status`,
      AUTHORING_ERGONOMICS_TRANSPORT_STATUSES
    ),
    application_status: requireEnum(
      value.application_status,
      `${path}.application_status`,
      AUTHORING_ERGONOMICS_APPLICATION_STATUSES
    ),
    reason_codes: optionalList(value.reason_codes, `${path}.reason_codes`, (item, itemPath) =>
      requireString(item, itemPath)
    ),
    invariant_family: optionalString(value.invariant_family, `${path}.invariant_family`),
    revealed_invariants: optionalList(value.revealed_invariants, `${path}.revealed_invariants`, readInvariant),
    advertised_invariants: optionalList(value.advertised_invariants, `${path}.advertised_invariants`, readInvariant),
    advertised_alternatives: optionalList(
      value.advertised_alternatives,
      `${path}.advertised_alternatives`,
      readAlternative
    ),

    validator_branch_matches: optionalList(
      value.validator_branch_matches,
      `${path}.validator_branch_matches`,
      (item, itemPath) => requireString(item, itemPath)
    ),

    response_bytes: optionalInteger(value.response_bytes, `${path}.response_bytes`)
  };
}

function readReplacementCall(value, path) {
  closedObject(value, path, ["tool", "ingress", "named_tool_available", "structural_only"]);
  return {
    tool: requireString(value.tool, `${path}.tool`),
    ingress: optionalString(value.ingress, `${path}.ingress`),
    named_tool_available: optionalBoolean(value.named_tool_available, `${path}.named_tool_available`),
    structural_only: optionalBoolean(value.structural_only, `${path}.structural_only`)
  };
}

function readContinuation(value, path) {
  closedObject(value, path, [
    "route_present",
    "template_only",
    "replacement_call",
    "replacement_call_outcome",
    "explicit_stop"
  ]);
  return {
    route_present: requireBoolean(value.route_present, `${path}.route_present`),
    template_only: optionalBoolean(value.template_only, `${path}.template_only`),
    replacement_call: optionalObject(value.replacement_call, `${path}.replacement_call`, readReplacementCall),
    replacement_call_outcome: optionalEnum(
      value.replacement_call_outcome,
      `${path}.replacement_call_outcome`,
      AUTHORING_ERGONOMICS_CONTINUATION_OUTCOMES
    ),
    explicit_stop: optionalBoolean(value.explicit_stop, `${path}.explicit_stop`)
  };
}

function readReceipt(value, path) {
  closedObject(value, path, ["receipt_state", "receipt_id"]);
  return {

    receipt_state: requireEnum(value.receipt_state, `${path}.receipt_state`, AUTHORING_ERGONOMICS_RECEIPT_STATES),
    receipt_id: optionalString(value.receipt_id, `${path}.receipt_id`)
  };
}

function readCarrierObservation(value, path) {
  closedObject(value, path, [
    "carrier_id",
    "lifecycle_stage",
    "presence",
    "content_identity",
    "selection_fence"
  ]);
  return {
    carrier_id: requireString(value.carrier_id, `${path}.carrier_id`),
    lifecycle_stage: requireEnum(
      value.lifecycle_stage,
      `${path}.lifecycle_stage`,
      AUTHORING_ERGONOMICS_CARRIER_LIFECYCLE_STAGES
    ),
    presence: requireEnum(value.presence, `${path}.presence`, AUTHORING_ERGONOMICS_CARRIER_PRESENCE),
    content_identity: optionalString(value.content_identity, `${path}.content_identity`),
    selection_fence: optionalString(value.selection_fence, `${path}.selection_fence`)
  };
}

function readValidationFacts(value, path) {
  closedObject(value, path, ["producer", "unit", "divergences"]);
  return {

    producer: requireString(value.producer, `${path}.producer`),
    unit: optionalString(value.unit, `${path}.unit`),
    divergences: optionalList(value.divergences, `${path}.divergences`, (item, itemPath) => {
      closedObject(item, itemPath, ["code", "parent_subject", "slice_subject", "severity"]);
      return {
        code: requireString(item.code, `${itemPath}.code`),
        parent_subject: optionalString(item.parent_subject, `${itemPath}.parent_subject`),
        slice_subject: optionalString(item.slice_subject, `${itemPath}.slice_subject`),
        severity: optionalString(item.severity, `${itemPath}.severity`)
      };
    })
  };
}

function readWorkloadObservation(value, path) {
  closedObject(value, path, ["observation_kind", "outcome", "label"]);
  return {
    observation_kind: requireEnum(
      value.observation_kind,
      `${path}.observation_kind`,
      AUTHORING_ERGONOMICS_WORKLOAD_OBSERVATION_KINDS
    ),
    outcome: requireEnum(value.outcome, `${path}.outcome`, AUTHORING_ERGONOMICS_WORKLOAD_OUTCOMES),
    label: optionalString(value.label, `${path}.label`)
  };
}

function readDispatchFacts(value, path) {
  closedObject(value, path, ["paid", "dispatched_unit", "action_kind"]);
  return {
    paid: optionalBoolean(value.paid, `${path}.paid`),
    dispatched_unit: optionalString(value.dispatched_unit, `${path}.dispatched_unit`),
    action_kind: optionalString(value.action_kind, `${path}.action_kind`)
  };
}

function readLookupCapabilities(value, path) {
  closedObject(value, path, ["structured_discovery", "structured_search", "code_index"]);
  return {
    structured_discovery: requireEnum(
      value.structured_discovery,
      `${path}.structured_discovery`,
      AUTHORING_ERGONOMICS_CAPABILITY_STATES
    ),
    structured_search: requireEnum(
      value.structured_search,
      `${path}.structured_search`,
      AUTHORING_ERGONOMICS_CAPABILITY_STATES
    ),
    code_index: requireEnum(value.code_index, `${path}.code_index`, AUTHORING_ERGONOMICS_CAPABILITY_STATES)
  };
}

const EVENT_KEYS = Object.freeze([
  "event_index",
  "source_ordinal",
  "event_kind",
  "actor_kind",
  "workflow_token",
  "observed_at",
  "producer_boundary",
  "target_identity",
  "request",
  "response",
  "recovery_identity",
  "authoritative_input_identity",
  "stage_observations",
  "continuation",
  "claimed_effects",
  "observed_effects",
  "receipt",
  "carrier_observation",
  "validation_facts",
  "workload_observation",
  "dispatch_facts",
  "lookup_capabilities",
  "advertised_invariants",
  "recovered_invariants",
  "provenance_note"
]);

function readEvent(value, path, defaultSourceOrdinal) {
  closedObject(value, path, EVENT_KEYS);
  const event = {
    event_index: requireInteger(value.event_index, `${path}.event_index`),
    source_ordinal:
      value.source_ordinal === undefined || value.source_ordinal === null
        ? defaultSourceOrdinal
        : requireInteger(value.source_ordinal, `${path}.source_ordinal`),
    event_kind: requireEnum(value.event_kind, `${path}.event_kind`, AUTHORING_ERGONOMICS_EVENT_KINDS),
    actor_kind: requireEnum(value.actor_kind, `${path}.actor_kind`, AUTHORING_ERGONOMICS_ACTOR_KINDS),

    workflow_token: optionalString(value.workflow_token, `${path}.workflow_token`),

    observed_at: optionalString(value.observed_at, `${path}.observed_at`),
    producer_boundary: optionalObject(value.producer_boundary, `${path}.producer_boundary`, readBoundary),
    target_identity: optionalObject(value.target_identity, `${path}.target_identity`, readTarget),
    request: optionalObject(value.request, `${path}.request`, readRequest),
    response: optionalObject(value.response, `${path}.response`, readResponse),
    recovery_identity: optionalObject(
      value.recovery_identity,
      `${path}.recovery_identity`,
      readRecoveryIdentity
    ),
    authoritative_input_identity: optionalObject(
      value.authoritative_input_identity,
      `${path}.authoritative_input_identity`,
      readIdentityRef
    ),
    stage_observations: optionalList(value.stage_observations, `${path}.stage_observations`, readStageObservation),
    continuation: optionalObject(value.continuation, `${path}.continuation`, readContinuation),
    claimed_effects: optionalList(value.claimed_effects, `${path}.claimed_effects`, readEffect),
    observed_effects: optionalList(value.observed_effects, `${path}.observed_effects`, readEffect),
    receipt: optionalObject(value.receipt, `${path}.receipt`, readReceipt),
    carrier_observation: optionalObject(value.carrier_observation, `${path}.carrier_observation`, readCarrierObservation),
    validation_facts: optionalObject(value.validation_facts, `${path}.validation_facts`, readValidationFacts),
    workload_observation: optionalObject(value.workload_observation, `${path}.workload_observation`, readWorkloadObservation),
    dispatch_facts: optionalObject(value.dispatch_facts, `${path}.dispatch_facts`, readDispatchFacts),
    lookup_capabilities: optionalObject(value.lookup_capabilities, `${path}.lookup_capabilities`, readLookupCapabilities),
    advertised_invariants: optionalList(value.advertised_invariants, `${path}.advertised_invariants`, readInvariant),
    recovered_invariants: optionalList(value.recovered_invariants, `${path}.recovered_invariants`, readInvariant),
    provenance_note: optionalString(value.provenance_note, `${path}.provenance_note`)
  };
  return event;
}

function readCoverageDeclaration(value, path) {
  closedObject(value, path, [
    "workload",
    "event_families",
    "population_class",
    "normal_success_population_complete"
  ]);
  const families = requireList(value.event_families, `${path}.event_families`, (item, itemPath) =>
    requireEnum(item, itemPath, AUTHORING_ERGONOMICS_EVENT_KINDS)
  );
  if (families.length === 0) {
    fail("invalid_value", `${path}.event_families`, "a declaration must name at least one event family");
  }
  return {

    workload: optionalString(value.workload, `${path}.workload`),
    event_families: families,
    population_class: requireEnum(
      value.population_class,
      `${path}.population_class`,
      AUTHORING_ERGONOMICS_POPULATION_CLASSES
    ),
    normal_success_population_complete: optionalBoolean(
      value.normal_success_population_complete,
      `${path}.normal_success_population_complete`
    )
  };
}

function readSource(value, path) {
  closedObject(value, path, ["source_kind", "source_locator", "source_digest", "source_ordinal"]);
  return {
    source_kind: requireString(value.source_kind, `${path}.source_kind`),
    source_locator: requireString(value.source_locator, `${path}.source_locator`),
    source_digest: optionalString(value.source_digest, `${path}.source_digest`),
    source_ordinal: value.source_ordinal === undefined || value.source_ordinal === null
      ? 0
      : requireInteger(value.source_ordinal, `${path}.source_ordinal`)
  };
}

function readObservedIdentities(value, path) {
  closedObject(value, path, ["repository", "records", "focus"]);
  return {
    repository: optionalString(value.repository, `${path}.repository`),
    records: optionalList(value.records, `${path}.records`, (item, itemPath) => requireString(item, itemPath)),
    focus: optionalString(value.focus, `${path}.focus`)
  };
}

function readWorkflowPartition(value, path) {
  closedObject(value, path, ["workflow_token", "source_ordinal"]);
  return {
    workflow_token: requireString(value.workflow_token, `${path}.workflow_token`),
    source_ordinal: optionalInteger(value.source_ordinal, `${path}.source_ordinal`)
  };
}

export function normalizeAuthoringErgonomicsTrace(input) {
  const path = "trace";
  closedObject(input, path, [
    "schema_version",
    "trace_id",
    "source",
    "observed_identities",
    "workload_fixture",
    "workflows",
    "coverage",
    "events"
  ]);

  if (input.schema_version !== AUTHORING_ERGONOMICS_TRACE_SCHEMA_VERSION) {
    fail(
      "unsupported_schema_version",
      `${path}.schema_version`,
      `expected ${AUTHORING_ERGONOMICS_TRACE_SCHEMA_VERSION}`
    );
  }

  const source = readSource(input.source, `${path}.source`);
  const coverageRaw = closedObject(input.coverage, `${path}.coverage`, ["declarations"]);
  const declarations = requireList(
    coverageRaw.declarations,
    `${path}.coverage.declarations`,
    readCoverageDeclaration
  );

  const declaredFamilies = new Map();
  declarations.forEach((declaration, index) => {
    for (const family of declaration.event_families) {
      if (declaredFamilies.has(family)) {
        fail(
          "duplicate_coverage_declaration",
          `${path}.coverage.declarations[${index}]`,
          `event family ${family} is declared more than once`
        );
      }
      declaredFamilies.set(family, declaration);
    }
  });

  const events = requireList(input.events, `${path}.events`, (item, itemPath) =>
    readEvent(item, itemPath, source.source_ordinal)
  );

  const seenPositions = new Set();
  for (const event of events) {
    const positionKey = `${event.source_ordinal}:${event.event_index}`;
    if (seenPositions.has(positionKey)) {
      fail(
        "duplicate_source_position",
        `${path}.events`,
        `source_ordinal ${event.source_ordinal} / event_index ${event.event_index} appears more than once`
      );
    }
    seenPositions.add(positionKey);
  }

  const ordered = events
    .slice()
    .sort((left, right) =>
      left.source_ordinal === right.source_ordinal
        ? left.event_index - right.event_index
        : left.source_ordinal - right.source_ordinal
    )
    .map((event, order) => ({ ...event, order }));

  const declaredWorkflows = optionalList(input.workflows, `${path}.workflows`, readWorkflowPartition) ?? [];
  const partitionMap = new Map();
  for (const workflow of declaredWorkflows) {
    partitionMap.set(workflow.workflow_token, {
      workflow_token: workflow.workflow_token,
      source_ordinal: workflow.source_ordinal,
      event_orders: []
    });
  }
  const unknownWorkflowEventOrders = [];
  for (const event of ordered) {
    if (event.workflow_token === null) {
      unknownWorkflowEventOrders.push(event.order);
      continue;
    }
    if (!partitionMap.has(event.workflow_token)) {
      partitionMap.set(event.workflow_token, {
        workflow_token: event.workflow_token,
        source_ordinal: event.source_ordinal,
        event_orders: []
      });
    }
    partitionMap.get(event.workflow_token).event_orders.push(event.order);
  }

  const normalized = {
    schema_version: AUTHORING_ERGONOMICS_NORMALIZED_SCHEMA_VERSION,
    envelope_schema_version: AUTHORING_ERGONOMICS_TRACE_SCHEMA_VERSION,
    trace_id: requireString(input.trace_id, `${path}.trace_id`),
    source,
    observed_identities:
      optionalObject(input.observed_identities, `${path}.observed_identities`, readObservedIdentities) ?? {
        repository: null,
        records: null,
        focus: null
      },

    workload_fixture: input.workload_fixture === undefined ? null : input.workload_fixture,
    ordering_authority: "source_ordinal_then_event_index",
    coverage: {
      declarations,
      declared_event_families: Object.freeze(Array.from(declaredFamilies.keys()).sort()),
      undeclared_event_families: Object.freeze(
        Array.from(new Set(ordered.map((event) => event.event_kind)))
          .filter((family) => !declaredFamilies.has(family))
          .sort()
      )
    },
    workflow_partitions: Array.from(partitionMap.values()).sort((left, right) =>
      left.workflow_token < right.workflow_token ? -1 : left.workflow_token > right.workflow_token ? 1 : 0
    ),
    unknown_workflow_event_orders: unknownWorkflowEventOrders,
    events: ordered
  };

  return freezeDeep(JSON.parse(JSON.stringify(normalized)));
}

function isNormalizedTrace(value) {
  return isPlainObject(value) && value.schema_version === AUTHORING_ERGONOMICS_NORMALIZED_SCHEMA_VERSION;
}

function coverageForFamily(trace, family) {
  for (const declaration of trace.coverage.declarations) {
    if (declaration.event_families.includes(family)) return declaration;
  }
  return null;
}

const UNKNOWN_IDENTITY = "__unknown_authoritative_input_identity__";

function identityKeyOf(event) {
  const identity = event.authoritative_input_identity;
  if (!identity) return UNKNOWN_IDENTITY;
  return `${identity.identity_kind}:${identity.identity_value}:${identity.descriptor_digest ?? ""}`;
}

function boundaryKeyOf(event) {
  const boundary = event.producer_boundary;
  if (!boundary) return "__unknown_boundary__";
  return `${boundary.boundary_kind}:${boundary.boundary_id}:${boundary.producer_family ?? ""}`;
}

function targetKeyOf(event) {
  const target = event.target_identity;
  if (!target) return "__unknown_target__";
  return `${target.target_kind}:${target.target_id}`;
}

function chainKeyOf(event) {
  const requestId = event.request?.request_id ?? null;
  if (requestId !== null) return `request:${requestId}`;
  const responseId = event.response?.response_id ?? null;
  if (responseId !== null) return `response:${responseId}`;
  return null;
}

function isDiagnosticCall(event) {
  return event.event_kind === "tool_call" && event.request?.diagnostic === true;
}

function isRejected(event) {
  return event.event_kind === "tool_call" && event.response?.application_status === "rejected";
}

function isMeaningfulAuthoringOperation(event) {
  return event.event_kind === "tool_call" && !isDiagnosticCall(event);
}

function isFailedAuthoringOperation(event) {
  if (!isMeaningfulAuthoringOperation(event) || event.response === null) return false;
  return (
    event.response.transport_status === "error" ||
    event.response.application_status === "rejected"
  );
}

function isSuccessfulAuthoringOperation(event) {
  if (!isMeaningfulAuthoringOperation(event) || event.response === null) return false;
  return (
    event.response.transport_status === "ok" &&
    (event.response.application_status === "accepted" ||
      event.response.application_status === "normal")
  );
}

export function classifyAuthoringRecoveryPair(failureEvent, recoveryEvent) {
  const missingComponents = [];
  const matchingComponents = [];
  const differingComponents = [];
  const failureIdentity = failureEvent?.recovery_identity ?? null;
  const recoveryIdentity = recoveryEvent?.recovery_identity ?? null;

  for (const component of AUTHORING_ERGONOMICS_RECOVERY_IDENTITY_COMPONENTS) {
    const failureValue = failureIdentity?.[component] ?? null;
    const recoveryValue = recoveryIdentity?.[component] ?? null;
    if (typeof failureValue !== "string" || typeof recoveryValue !== "string") {
      missingComponents.push({
        component,
        failure_missing: typeof failureValue !== "string",
        recovery_missing: typeof recoveryValue !== "string"
      });
      continue;
    }
    if (failureValue === recoveryValue) matchingComponents.push(component);
    else differingComponents.push(component);
  }

  const classification =
    missingComponents.length > 0
      ? "unknown"
      : differingComponents.length > 0
        ? "mismatched"
        : "recovered";

  return freezeDeep({
    classification,
    identity_components: AUTHORING_ERGONOMICS_RECOVERY_IDENTITY_COMPONENTS,
    matching_components: matchingComponents,
    differing_components: differingComponents,
    missing_components: missingComponents
  });
}

function authoringOperationEvidence(event) {
  if (event === null) return null;
  return {
    event_order: event.order,
    event_index: event.event_index,
    source_ordinal: event.source_ordinal,
    workflow_token: event.workflow_token,
    producer_boundary: event.producer_boundary,
    target_identity: event.target_identity,
    request: event.request,
    response: event.response,
    recovery_identity: event.recovery_identity
  };
}

function buildSemanticRecoveryClassification(trace) {
  const failures = trace.events.filter(isFailedAuthoringOperation);
  const successes = trace.events.filter(isSuccessfulAuthoringOperation);

  const classifications = failures.map((failure) => {
    const candidates = [];
    const representativeByClassification = new Map();

    for (const recovery of successes) {
      if (recovery.order <= failure.order) continue;
      const comparison = classifyAuthoringRecoveryPair(failure, recovery);
      if (representativeByClassification.has(comparison.classification)) continue;
      const candidate = {
        recovery_event_order: recovery.order,
        classification: comparison.classification,
        identity_comparison: comparison,
        recovery_evidence: authoringOperationEvidence(recovery)
      };
      representativeByClassification.set(comparison.classification, candidate);
      candidates.push(candidate);
      if (representativeByClassification.size === 3) break;
    }

    const selected =
      representativeByClassification.get("recovered") ??
      candidates[0] ??
      null;
    const classification = selected?.classification ?? "unknown";

    return {
      failure_event_order: failure.order,
      recovery_event_order: selected?.recovery_event_order ?? null,
      classification,
      identity_comparison:
        selected?.identity_comparison ?? {
          classification: "unknown",
          identity_components: AUTHORING_ERGONOMICS_RECOVERY_IDENTITY_COMPONENTS,
          matching_components: [],
          differing_components: [],
          missing_components: [
            {
              component: "recovery_event",
              failure_missing: false,
              recovery_missing: true
            }
          ]
        },
      failure_evidence: authoringOperationEvidence(failure),
      recovery_evidence: selected?.recovery_evidence ?? null,
      candidate_classifications: candidates
    };
  });

  const recovered = classifications.filter((entry) => entry.classification === "recovered");
  const unrecovered = classifications.filter((entry) => entry.classification !== "recovered");

  return freezeDeep({
    identity_components: AUTHORING_ERGONOMICS_RECOVERY_IDENTITY_COMPONENTS,
    selection_rule: "exact_match_else_first_later_success",
    classifications,
    recovered_authoring_failure_count: recovered.length,
    unrecovered_authoring_failure_count: unrecovered.length,
    recovered_failure_event_orders: recovered.map((entry) => entry.failure_event_order),
    unrecovered_failure_event_orders: unrecovered.map((entry) => entry.failure_event_order)
  });
}

function hasAuthoritativeObservedEffect(event) {
  const effects = event.observed_effects;
  if (!Array.isArray(effects)) return false;
  return effects.some((effect) => effect.observation_provenance === "authoritative_observed");
}

export function buildAuthoringErgonomicsEpisodes(traceInput) {
  const trace = isNormalizedTrace(traceInput) ? traceInput : normalizeAuthoringErgonomicsTrace(traceInput);
  const episodes = [];
  let current = null;

  const closeCurrent = (reason) => {
    if (current && current.end_reason === null) current.end_reason = reason;
    current = null;
  };

  for (const event of trace.events) {
    if (event.event_kind !== "tool_call") {
      if (current) {
        if (hasAuthoritativeObservedEffect(event)) {
          closeCurrent("observed_application_effect");
        } else if (event.continuation?.explicit_stop === true) {
          closeCurrent("explicit_stop");
        } else if (
          event.authoritative_input_identity &&
          identityKeyOf(event) !== current.identity_key &&
          current.identity_key !== UNKNOWN_IDENTITY
        ) {
          closeCurrent("changed_known_identity");
        }
      }
      continue;
    }

    const boundaryKey = boundaryKeyOf(event);
    const targetKey = targetKeyOf(event);
    const identityKey = identityKeyOf(event);
    const groupable =
      current !== null &&
      current.boundary_key === boundaryKey &&
      current.target_key === targetKey &&
      current.identity_key === identityKey &&
      identityKey !== UNKNOWN_IDENTITY;

    if (!groupable) {
      if (current) {
        closeCurrent(
          current.boundary_key !== boundaryKey
            ? "owning_boundary_change"
            : current.identity_key !== identityKey
              ? "changed_known_identity"
              : "target_change"
        );
      }
      current = {
        episode_id: `EP-${String(episodes.length + 1).padStart(3, "0")}`,
        boundary_key: boundaryKey,
        target_key: targetKey,
        identity_key: identityKey,
        identity_state: identityKey === UNKNOWN_IDENTITY ? "unknown" : "known",
        producer_boundary: event.producer_boundary,
        target_identity: event.target_identity,
        authoritative_input_identity: event.authoritative_input_identity,
        workflow_token: event.workflow_token,
        event_orders: [],
        attempt_orders: [],
        rejected_orders: [],
        diagnostic_orders: [],
        end_reason: null
      };
      episodes.push(current);
    }

    current.event_orders.push(event.order);
    if (isDiagnosticCall(event)) {
      current.diagnostic_orders.push(event.order);
    } else {
      current.attempt_orders.push(event.order);
      if (isRejected(event)) current.rejected_orders.push(event.order);
    }

    if (hasAuthoritativeObservedEffect(event)) {
      closeCurrent("observed_application_effect");
      continue;
    }
    if (event.continuation?.explicit_stop === true) {
      closeCurrent("explicit_stop");
      continue;
    }

    if (identityKey === UNKNOWN_IDENTITY) closeCurrent("unknown_authoritative_input_identity");
  }

  return freezeDeep(
    episodes.map((episode) => ({
      episode_id: episode.episode_id,
      producer_boundary: episode.producer_boundary,
      target_identity: episode.target_identity,
      authoritative_input_identity: episode.authoritative_input_identity,
      identity_state: episode.identity_state,
      workflow_token: episode.workflow_token,
      event_orders: episode.event_orders,
      attempt_count: episode.attempt_orders.length,
      rejected_submission_count: episode.rejected_orders.length,
      diagnostic_call_count: episode.diagnostic_orders.length,
      attempt_orders: episode.attempt_orders,
      rejected_orders: episode.rejected_orders,
      diagnostic_orders: episode.diagnostic_orders,
      end_reason: episode.end_reason ?? "trace_end"
    }))
  );
}

function makeObservation(fields) {
  return {
    observation_id: fields.observation_id,
    detector: fields.detector,
    axis: fields.axis,
    finding: fields.finding,
    outcome: fields.outcome ?? null,
    evidence_state: fields.evidence_state,
    invariant_family: fields.invariant_family ?? null,
    producer_boundary: fields.producer_boundary ?? null,
    target_identity: fields.target_identity ?? null,
    authoritative_input_identity: fields.authoritative_input_identity ?? null,
    identity_state: fields.identity_state ?? "unknown",
    identity_scope_key: fields.identity_scope_key,
    episode_id: fields.episode_id ?? null,
    event_orders: fields.event_orders,
    evidence: fields.evidence
  };
}

function observationContext(event, episodes) {
  return {
    producer_boundary: event.producer_boundary,
    target_identity: event.target_identity,
    authoritative_input_identity: event.authoritative_input_identity,
    identity_state: event.authoritative_input_identity ? "known" : "unknown",
    identity_scope_key: identityScopeKey(event),
    episode_id: episodeForEventOrder(episodes, event.order)?.episode_id ?? null,
    event_orders: [event.order]
  };
}

function identityScopeKey(event) {
  const key = identityKeyOf(event);

  return key === UNKNOWN_IDENTITY ? `${UNKNOWN_IDENTITY}#${event.order}` : key;
}

function detectorEntry(id) {
  return AUTHORING_ERGONOMICS_DETECTORS.find((entry) => entry.id === id);
}

function advertisedMaterialScope(event) {
  const boundaryKey = boundaryKeyOf(event);
  const identityKey = identityKeyOf(event);
  if (identityKey !== UNKNOWN_IDENTITY) {
    return { kind: "boundary_identity", boundary_key: boundaryKey, identity_key: identityKey, chain_key: null };
  }
  const chainKey = chainKeyOf(event);
  if (chainKey !== null) {
    return { kind: "chain", boundary_key: boundaryKey, identity_key: identityKey, chain_key: chainKey };
  }
  return { kind: "boundary_surface", boundary_key: boundaryKey, identity_key: identityKey, chain_key: null };
}

function advertisedMaterialVisibleTo(scope, event) {
  if (scope.boundary_key !== boundaryKeyOf(event)) return false;
  if (scope.kind === "boundary_identity") return identityKeyOf(event) === scope.identity_key;
  if (scope.kind === "chain") return chainKeyOf(event) === scope.chain_key;
  return true;
}

function advertisedInvariantIndex(trace) {

  const entries = [];
  for (const event of trace.events) {
    const lists = [event.advertised_invariants, event.response?.advertised_invariants].filter((list) =>
      Array.isArray(list)
    );
    if (lists.length === 0) continue;
    entries.push({
      order: event.order,
      scope: advertisedMaterialScope(event),
      ids: lists.flatMap((list) => list.map((invariant) => invariant.invariant_id))
    });
  }

  const index = [];
  for (const event of trace.events) {
    const ids = new Set();
    let anyAdvertised = false;
    for (const entry of entries) {
      if (entry.order >= event.order) continue;
      if (!advertisedMaterialVisibleTo(entry.scope, event)) continue;
      anyAdvertised = true;
      for (const id of entry.ids) ids.add(id);
    }
    index[event.order] = { ids, any_advertised: anyAdvertised };
  }
  return index;
}

function episodeForEventOrder(episodes, order) {
  return episodes.find((episode) => episode.event_orders.includes(order)) ?? null;
}

function detectRepeatedRefusalCascade(trace, episodes) {
  const observations = [];
  for (const episode of episodes) {
    if (episode.rejected_submission_count < 2) continue;
    const boundaryId = episode.producer_boundary?.boundary_id ?? null;
    const firstRejectedOrder = episode.rejected_orders[0];
    const discoveryEvent = trace.events.find(
      (event) =>
        event.event_kind === "tool_discovery" &&
        event.order < firstRejectedOrder &&
        (boundaryId === null || event.producer_boundary?.boundary_id === boundaryId)
    );
    const discoveryObserved = discoveryEvent !== undefined;
    const rejectedEvents = episode.rejected_orders.map((order) => trace.events[order]);
    observations.push(
      makeObservation({
        observation_id: "ERG-001",
        detector: detectorEntry("ERG-001").detector,
        axis: "producer",
        finding: discoveryObserved,
        outcome: discoveryObserved ? "repeated_refusal" : "discovery_unobserved",
        evidence_state: discoveryObserved ? "observed" : "unknown_discovery",
        invariant_family: rejectedEvents.find((event) => event.response?.invariant_family)?.response
          ?.invariant_family ?? null,
        producer_boundary: episode.producer_boundary,
        target_identity: episode.target_identity,
        authoritative_input_identity: episode.authoritative_input_identity,
        identity_state: episode.identity_state,
        identity_scope_key:
          episode.identity_state === "known"
            ? identityKeyOf({ authoritative_input_identity: episode.authoritative_input_identity })
            : `${UNKNOWN_IDENTITY}#${episode.episode_id}`,
        episode_id: episode.episode_id,
        event_orders: episode.rejected_orders,
        evidence: {
          attempt_count: episode.attempt_count,
          rejected_submission_count: episode.rejected_submission_count,
          diagnostic_call_count: episode.diagnostic_call_count,
          discovery_observed: discoveryObserved,
          discovery_event_order: discoveryEvent?.order ?? null,
          reason_codes: rejectedEvents.map((event) => event.response?.reason_codes ?? null)
        }
      })
    );
  }
  return observations;
}

function detectProgressivelyRevealedInvariant(trace, episodes, advertised) {
  const observations = [];
  for (const event of trace.events) {
    const revealed = [];
    if (Array.isArray(event.response?.revealed_invariants)) revealed.push(...event.response.revealed_invariants);
    if (Array.isArray(event.recovered_invariants)) revealed.push(...event.recovered_invariants);
    if (revealed.length === 0) continue;

    const before = advertised[event.order];
    const novel = revealed.filter((invariant) => !before.ids.has(invariant.invariant_id));
    if (novel.length === 0) continue;

    const advertisedMaterialKnown = before.any_advertised;
    observations.push(
      makeObservation({
        observation_id: "ERG-002",
        detector: detectorEntry("ERG-002").detector,
        axis: "producer",
        finding: advertisedMaterialKnown,
        outcome: advertisedMaterialKnown ? "invariant_revealed_late" : "advertised_material_unknown",
        evidence_state: advertisedMaterialKnown ? "observed" : "unknown_advertised_material",
        invariant_family: event.response?.invariant_family ?? novel[0].invariant_family ?? null,
        ...observationContext(event, episodes),
        evidence: {
          revealed_invariants: novel,
          revelation_source: event.event_kind,
          advertised_invariant_count: before.ids.size,

          advertised_material_observed_in_scope: advertisedMaterialKnown
        }
      })
    );
  }
  return observations;
}

function detectUnusableContinuation(trace, episodes) {
  const observations = [];
  for (const event of trace.events) {
    const continuation = event.continuation;
    if (!continuation) continue;

    let outcome;
    let evidenceState = "observed";
    if (continuation.route_present === false) {
      outcome = "no_route";
    } else if (continuation.replacement_call === null) {
      outcome = continuation.template_only === true ? "structural_template_only" : "no_replacement_call";
    } else if (continuation.replacement_call.named_tool_available === false) {
      outcome = "named_tool_unavailable";
    } else if (continuation.replacement_call.structural_only === true || continuation.template_only === true) {
      outcome = "structural_template_only";
    } else if (continuation.replacement_call_outcome === "rejected") {
      outcome = "replacement_call_rejected";
    } else if (continuation.replacement_call.named_tool_available === null) {
      outcome = "ingress_availability_unknown";
      evidenceState = "unknown_ingress_availability";
    } else {
      outcome = "executable";
    }

    const finding =
      evidenceState === "observed" &&
      outcome !== "executable" &&

      outcome !== "no_replacement_call";

    observations.push(
      makeObservation({
        observation_id: "ERG-003",
        detector: detectorEntry("ERG-003").detector,
        axis: "producer",
        finding,
        outcome,
        evidence_state: evidenceState,
        invariant_family: event.response?.invariant_family ?? "continuation",
        ...observationContext(event, episodes),
        evidence: {
          route_present: continuation.route_present,
          template_only: continuation.template_only,
          replacement_call: continuation.replacement_call,
          replacement_call_outcome: continuation.replacement_call_outcome,
          advertised_ingress: continuation.replacement_call?.ingress ?? null
        }
      })
    );
  }
  return observations;
}

function detectAmbiguousAlternative(trace, episodes) {
  const observations = [];
  for (const event of trace.events) {
    const response = event.response;
    if (!response) continue;

    const branchMatches = response.validator_branch_matches;
    const alternatives = response.advertised_alternatives;
    let outcome = null;
    let evidence = null;

    if (Array.isArray(branchMatches) && branchMatches.length > 1) {
      outcome = "validator_admitted_multiple_alternatives";
      evidence = { validator_branch_matches: branchMatches, advertised_alternatives: alternatives };
    } else if (Array.isArray(alternatives) && alternatives.length > 1) {
      const groups = new Map();
      for (const alternative of alternatives) {
        if (!Array.isArray(alternative.discriminators)) continue;
        const key = alternative.discriminators.slice().sort().join("|");
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(alternative);
      }
      const collided = Array.from(groups.entries()).find(
        ([, members]) => members.length > 1 && !members.every((member) => member.precedence_declared === true)
      );
      if (collided) {
        outcome = "shared_discriminator_population_without_precedence";
        evidence = {
          discriminator_population: collided[0].length === 0 ? [] : collided[0].split("|"),
          colliding_alternatives: collided[1].map((member) => member.alternative_id),
          validator_branch_matches: branchMatches
        };
      }
    }

    if (outcome === null) continue;
    observations.push(
      makeObservation({
        observation_id: "ERG-004",
        detector: detectorEntry("ERG-004").detector,
        axis: "producer",
        finding: true,
        outcome,
        evidence_state: "observed",
        invariant_family: response.invariant_family ?? "alternative_selection",
        ...observationContext(event, episodes),
        evidence
      })
    );
  }
  return observations;
}

function detectUnverifiedEffectResponse(trace, episodes) {
  const observations = [];
  const unverified = [];

  for (const event of trace.events) {
    const response = event.response;
    if (!response) continue;
    if (response.transport_status !== "ok") continue;
    if (response.application_status !== "normal" && response.application_status !== "accepted") continue;
    const claimed = event.claimed_effects;
    if (!Array.isArray(claimed) || claimed.length === 0) continue;

    const receiptState = event.receipt?.receipt_state ?? null;
    const authoritative = Array.isArray(event.observed_effects)
      ? event.observed_effects.filter((effect) => effect.observation_provenance === "authoritative_observed")
      : null;

    let outcome;
    let evidenceState;
    if (receiptState === "present" || (Array.isArray(authoritative) && authoritative.length > 0)) {
      outcome = "effect_verified";
      evidenceState = "observed";
    } else if (receiptState === "absent" && Array.isArray(authoritative) && authoritative.length === 0) {
      outcome = "claimed_effect_unverified";
      evidenceState = "observed";
    } else {
      outcome = "verification_evidence_unknown";
      evidenceState = "unknown_receipt_or_observation";
    }

    const finding = outcome === "claimed_effect_unverified";
    if (finding) unverified.push(event);

    observations.push(
      makeObservation({
        observation_id: "ERG-005",
        detector: detectorEntry("ERG-005").detector,
        axis: "producer",
        finding,
        outcome,
        evidence_state: evidenceState,
        invariant_family: response.invariant_family ?? "effect_verification",
        ...observationContext(event, episodes),
        evidence: {
          transport_status: response.transport_status,
          application_status: response.application_status,
          claimed_effects: claimed,
          receipt_state: receiptState,
          authoritative_observed_effects: authoritative
        }
      })
    );
  }

  const groups = new Map();
  for (const source of unverified) {
    const key = unverifiedEffectGroupKey(source, episodes);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(source);
  }

  for (const continuation of trace.events) {
    if (continuation.actor_kind !== "consumer") continue;
    if (
      continuation.event_kind !== "dispatch_observation" &&
      continuation.event_kind !== "integration_observation"
    ) {
      continue;
    }

    const arming = [];
    for (const sources of groups.values()) {
      const earlier = sources.filter((source) => source.order < continuation.order);
      if (earlier.length === 0) continue;
      const nearest = earlier[earlier.length - 1];
      const link = consumerCausalLink(nearest, continuation);
      if (!link.linked) continue;
      const interveningVerification = trace.events.some(
        (event) =>
          event.order > nearest.order &&
          event.order < continuation.order &&
          (event.receipt?.receipt_state === "present" || hasAuthoritativeObservedEffect(event))
      );
      if (interveningVerification) continue;
      arming.push({ sources: earlier, link });
    }
    if (arming.length === 0) continue;

    const armingSources = arming
      .flatMap((entry) => entry.sources)
      .slice()
      .sort((left, right) => left.order - right.order);
    const primary = armingSources[0];
    const causalBasis = Array.from(new Set(arming.flatMap((entry) => entry.link.basis))).sort();
    const armingEpisodeIds = Array.from(
      new Set(
        armingSources
          .map((source) => episodeForEventOrder(episodes, source.order)?.episode_id ?? null)
          .filter((episodeId) => episodeId !== null)
      )
    ).sort();

    observations.push(
      makeObservation({
        observation_id: "ERG-005",
        detector: "unverified_effect_continuation",
        axis: "consumer",
        finding: true,
        outcome:
          continuation.event_kind === "dispatch_observation"
            ? "dispatched_after_unverified_effect"
            : "integrated_after_unverified_effect",
        evidence_state: "observed",
        invariant_family: "effect_verification",
        producer_boundary: continuation.producer_boundary,
        target_identity: continuation.target_identity ?? primary.target_identity,
        authoritative_input_identity: continuation.authoritative_input_identity,
        identity_state: continuation.authoritative_input_identity ? "known" : "unknown",
        identity_scope_key: identityScopeKey(continuation),
        episode_id: episodeForEventOrder(episodes, continuation.order)?.episode_id ?? null,
        event_orders: [...armingSources.map((source) => source.order), continuation.order],
        evidence: {
          unverified_effect_event_order: primary.order,

          unverified_effect_event_orders: armingSources.map((source) => source.order),
          unverified_effect_response_count: armingSources.length,
          unverified_effect_episode_ids: armingEpisodeIds,
          causal_link_basis: causalBasis,
          consumer_action_kind: continuation.event_kind,
          dispatch_facts: continuation.dispatch_facts,
          intervening_verification_observed: false
        }
      })
    );
  }

  return observations;
}

function unverifiedEffectGroupKey(source, episodes) {
  const episode = episodeForEventOrder(episodes, source.order);
  if (episode) return `episode:${episode.episode_id}`;
  const identityKey = identityKeyOf(source);
  if (identityKey === UNKNOWN_IDENTITY) return `event:${source.order}`;
  return `chain:${boundaryKeyOf(source)}|${targetKeyOf(source)}|${identityKey}`;
}

function consumerCausalLink(source, continuation) {
  const basis = [];
  const contradictions = [];

  const sourceIdentity = identityKeyOf(source);
  const continuationIdentity = identityKeyOf(continuation);
  if (sourceIdentity !== UNKNOWN_IDENTITY && continuationIdentity !== UNKNOWN_IDENTITY) {
    if (sourceIdentity === continuationIdentity) basis.push("authoritative_input_identity");
    else contradictions.push("authoritative_input_identity");
  }

  if (source.workflow_token !== null && continuation.workflow_token !== null) {
    if (source.workflow_token === continuation.workflow_token) basis.push("workflow_token");
    else contradictions.push("workflow_token");
  }

  const sourceBoundary = boundaryKeyOf(source);
  if (sourceBoundary !== "__unknown_boundary__" && sourceBoundary === boundaryKeyOf(continuation)) {
    basis.push("producer_boundary");
  }

  const sourceTarget = targetKeyOf(source);
  if (sourceTarget !== "__unknown_target__" && sourceTarget === targetKeyOf(continuation)) {
    basis.push("target_identity");
  }

  const claimedTargets = Array.isArray(source.claimed_effects)
    ? source.claimed_effects.map((effect) => effect.effect_target).filter((target) => target !== null)
    : [];
  const continuationSubjects = [
    continuation.target_identity?.target_id ?? null,
    continuation.dispatch_facts?.dispatched_unit ?? null
  ].filter((subject) => subject !== null);
  if (claimedTargets.some((target) => continuationSubjects.includes(target))) {
    basis.push("claimed_effect_target");
  }

  if (sourceIdentity === UNKNOWN_IDENTITY) {
    const chainKey = chainKeyOf(source);
    const sameChain = chainKey !== null && chainKeyOf(continuation) === chainKey;
    return {
      linked: sameChain,
      basis: sameChain ? ["request_response_chain"] : [],
      contradictions
    };
  }

  return {
    linked: basis.length > 0 && contradictions.length === 0,
    basis,
    contradictions
  };
}

function detectStageTransitionRegression(trace, episodes) {
  const observations = [];
  const latest = new Map();

  for (const event of trace.events) {
    if (!Array.isArray(event.stage_observations)) continue;
    const identityKey = identityKeyOf(event);
    for (const stage of event.stage_observations) {
      if (stage.provenance === "caller_expected") continue;
      if (identityKey === UNKNOWN_IDENTITY) continue;
      const comparisonKey = `${identityKey}|${stage.provenance}`;
      const previous = latest.get(comparisonKey);
      if (previous && previous.stage.completeness === "complete" && stage.completeness === "incomplete") {
        observations.push(
          makeObservation({
            observation_id: "ERG-006",
            detector: detectorEntry("ERG-006").detector,
            axis: "producer",
            finding: true,
            outcome: "complete_to_incomplete",
            evidence_state: "observed",
            invariant_family: event.response?.invariant_family ?? "authoring_state",
            producer_boundary: event.producer_boundary,
            target_identity: event.target_identity ?? previous.event.target_identity,
            authoritative_input_identity: event.authoritative_input_identity,
            identity_state: "known",
            identity_scope_key: identityKey,
            episode_id: episodeForEventOrder(episodes, event.order)?.episode_id ?? null,
            event_orders: [previous.event.order, event.order],
            evidence: {
              provenance: stage.provenance,
              earlier_stage: previous.stage.stage,
              earlier_completeness: previous.stage.completeness,
              earlier_selected_resource_count: previous.stage.selected_resource_count,
              later_stage: stage.stage,
              later_completeness: stage.completeness,
              later_selected_resource_count: stage.selected_resource_count,
              permitted_invalidation_authority: "authoring_state_contract"
            }
          })
        );
      }
      latest.set(comparisonKey, { stage, event });
    }
  }
  return observations;
}

function detectIgnoredTypedNextAction(trace, episodes) {
  const observations = [];
  for (const event of trace.events) {
    const replacement = event.continuation?.replacement_call;
    if (!replacement) continue;
    if (event.continuation.route_present !== true) continue;
    if (replacement.named_tool_available !== true) continue;
    if (replacement.structural_only === true || event.continuation.template_only === true) continue;
    if (event.continuation.replacement_call_outcome === "rejected") continue;

    const next = trace.events.find(
      (candidate) =>
        candidate.order > event.order &&
        candidate.event_kind === "tool_call" &&
        candidate.actor_kind === "consumer" &&
        candidate.request?.diagnostic !== true
    );
    if (!next) continue;
    if (next.request?.tool === null || next.request?.tool === undefined) continue;
    if (next.request.tool === replacement.tool) continue;

    const authorityChanged = trace.events.some(
      (candidate) =>
        candidate.order > event.order &&
        candidate.order < next.order &&
        (candidate.continuation?.explicit_stop === true ||
          (candidate.authoritative_input_identity !== null &&
            identityKeyOf(candidate) !== identityKeyOf(event)))
    );
    if (authorityChanged) continue;

    observations.push(
      makeObservation({
        observation_id: "ERG-007",
        detector: detectorEntry("ERG-007").detector,
        axis: "consumer",
        finding: true,
        outcome: "typed_next_action_ignored",
        evidence_state: "observed",
        invariant_family: "continuation",
        producer_boundary: next.producer_boundary ?? event.producer_boundary,
        target_identity: next.target_identity ?? event.target_identity,
        authoritative_input_identity: next.authoritative_input_identity,
        identity_state: next.authoritative_input_identity ? "known" : "unknown",
        identity_scope_key: identityScopeKey(next),
        episode_id: episodeForEventOrder(episodes, next.order)?.episode_id ?? null,
        event_orders: [event.order, next.order],
        evidence: {
          observed_next_action: replacement.tool,
          consumer_route_taken: next.request.tool,
          authority_change_observed: false
        }
      })
    );
  }
  return observations;
}

function detectSourceInspectionEscape(trace, episodes, advertised) {
  const observations = [];
  for (const event of trace.events) {
    if (event.event_kind !== "source_inspection") continue;
    const recovered = event.recovered_invariants;
    if (!Array.isArray(recovered) || recovered.length === 0) continue;

    const capabilities = event.lookup_capabilities;
    const before = advertised[event.order];
    const novel = recovered.filter((invariant) => !before.ids.has(invariant.invariant_id));

    let outcome;
    let finding;
    let evidenceState;
    if (
      !capabilities ||
      capabilities.structured_discovery !== "available" ||
      capabilities.structured_search !== "available"
    ) {
      outcome = "lookup_degraded";
      finding = false;
      evidenceState = "lookup_degraded";
    } else if (novel.length === 0) {
      outcome = "invariant_already_advertised";
      finding = false;
      evidenceState = "observed";
    } else {
      outcome = "escape";
      finding = true;
      evidenceState = "observed";
    }

    observations.push(
      makeObservation({
        observation_id: "ERG-008",
        detector: detectorEntry("ERG-008").detector,
        axis: "producer",
        finding,
        outcome,
        evidence_state: evidenceState,
        invariant_family: novel[0]?.invariant_family ?? recovered[0].invariant_family ?? null,
        ...observationContext(event, episodes),
        evidence: {
          recovered_invariants: recovered,
          invariants_absent_from_advertised_material: novel,
          advertised_material_observed_in_scope: before.any_advertised,
          lookup_capabilities: capabilities
        }
      })
    );
  }
  return observations;
}

function detectParentSliceQualityDivergence(trace, episodes) {
  const observations = [];
  for (const event of trace.events) {
    const facts = event.validation_facts;
    if (!facts) continue;
    if (!Array.isArray(facts.divergences)) {
      observations.push(
        makeObservation({
          observation_id: "ERG-009",
          detector: detectorEntry("ERG-009").detector,
          axis: "record_quality",
          finding: false,
          outcome: "divergence_evidence_unknown",
          evidence_state: "unknown_validation_facts",
          invariant_family: "record_quality",
          ...observationContext(event, episodes),
          evidence: { validating_producer: facts.producer, unit: facts.unit }
        })
      );
      continue;
    }
    if (facts.divergences.length === 0) continue;

    observations.push(
      makeObservation({
        observation_id: "ERG-009",
        detector: detectorEntry("ERG-009").detector,
        axis: "record_quality",
        finding: true,
        outcome: "parent_slice_divergence",
        evidence_state: "observed",
        invariant_family: "record_quality",
        ...observationContext(event, episodes),
        evidence: {
          validating_producer: facts.producer,
          unit: facts.unit,
          divergences: facts.divergences
        }
      })
    );
  }
  return observations;
}

function detectControlledCarrierLifecycleLoss(trace, episodes) {
  const observations = [];
  const timelines = new Map();

  for (const event of trace.events) {
    const observation = event.carrier_observation;
    if (!observation) continue;
    if (!timelines.has(observation.carrier_id)) timelines.set(observation.carrier_id, []);
    timelines.get(observation.carrier_id).push({ event, observation });
  }

  for (const [carrierId, entries] of timelines) {
    const confirmedPresent = entries.filter((entry) => entry.observation.presence === "present");
    const authoritativePresent = confirmedPresent.filter(
      (entry) => entry.observation.lifecycle_stage !== "public_selection"
    );

    for (const entry of entries) {
      const publicSelectionObservation =
        entry.observation.lifecycle_stage === "public_selection" ||
        entry.event.event_kind === "public_read_observation" ||
        entry.event.event_kind === "public_query_observation";

      if (entry.observation.presence === "unresolved") {
        observations.push(
          makeObservation({
            observation_id: "ERG-010",
            detector: detectorEntry("ERG-010").detector,
            axis: publicSelectionObservation ? "public_consumer" : "persistence_lifecycle",
            finding: false,
            outcome: "unresolved_ref",
            evidence_state: "unknown_ref_resolution",
            invariant_family: "carrier_lifecycle",
            producer_boundary: entry.event.producer_boundary,
            target_identity: entry.event.target_identity,
            authoritative_input_identity: entry.event.authoritative_input_identity,
            identity_state: entry.event.authoritative_input_identity ? "known" : "unknown",
            identity_scope_key: identityScopeKey(entry.event),
            episode_id: null,
            event_orders: [entry.event.order],
            evidence: { carrier_id: carrierId, lifecycle_stage: entry.observation.lifecycle_stage }
          })
        );
        continue;
      }

      if (entry.observation.presence === "absent") {
        const earlierPresent = confirmedPresent.filter((candidate) => candidate.event.order < entry.event.order);
        if (earlierPresent.length === 0) continue;
        observations.push(
          makeObservation({
            observation_id: "ERG-010",
            detector: detectorEntry("ERG-010").detector,
            axis: "persistence_lifecycle",
            finding: true,
            outcome: "carrier_absent_after_confirmed_presence",
            evidence_state: "observed",
            invariant_family: "carrier_lifecycle",
            producer_boundary: entry.event.producer_boundary,
            target_identity: entry.event.target_identity,
            authoritative_input_identity: entry.event.authoritative_input_identity,
            identity_state: entry.event.authoritative_input_identity ? "known" : "unknown",
            identity_scope_key: `carrier:${carrierId}`,
            episode_id: null,
            event_orders: [earlierPresent[0].event.order, entry.event.order],
            evidence: {
              carrier_id: carrierId,
              confirmed_present_stage: earlierPresent[0].observation.lifecycle_stage,
              confirmed_present_event_order: earlierPresent[0].event.order,
              absent_stage: entry.observation.lifecycle_stage
            }
          })
        );
        continue;
      }

      if (!publicSelectionObservation) continue;
      if (entry.observation.content_identity === null) continue;

      const authoritative = authoritativePresent.find(
        (candidate) => candidate.observation.content_identity !== null
      );
      if (!authoritative) continue;
      if (authoritative.observation.content_identity === entry.observation.content_identity) continue;

      observations.push(
        makeObservation({
          observation_id: "ERG-010",
          detector: detectorEntry("ERG-010").detector,
          axis: "public_consumer",
          finding: true,
          outcome: "cross_focus_selection_divergence",
          evidence_state: "observed",
          invariant_family: "public_selection",
          producer_boundary: entry.event.producer_boundary,
          target_identity: entry.event.target_identity,
          authoritative_input_identity: entry.event.authoritative_input_identity,
          identity_state: entry.event.authoritative_input_identity ? "known" : "unknown",
          identity_scope_key: `carrier:${carrierId}`,
          episode_id: null,
          event_orders: [authoritative.event.order, entry.event.order],
          evidence: {
            carrier_id: carrierId,
            observation_kind: entry.event.event_kind,
            selection_fence: entry.observation.selection_fence,
            returned_content_identity: entry.observation.content_identity,
            authoritative_stage: authoritative.observation.lifecycle_stage,
            authoritative_content_identity: authoritative.observation.content_identity
          }
        })
      );
    }
  }

  return observations;
}

function detectFalseGreenWorkload(trace, chassisObservations) {
  const workloadEvents = trace.events.filter((event) => event.workload_observation !== null);
  if (workloadEvents.length === 0) return [];

  const successes = workloadEvents.filter((event) => event.workload_observation.outcome === "success");
  if (successes.length === 0) return [];

  const openChassisFindings = chassisObservations.filter(
    (observation) => observation.finding && observation.axis !== "workload"
  );

  return [
    makeObservation({
      observation_id: "ERG-011",
      detector: detectorEntry("ERG-011").detector,
      axis: "workload",
      finding: openChassisFindings.length > 0,
      outcome: openChassisFindings.length > 0 ? "false_green_workload" : "workload_success_without_open_findings",
      evidence_state: "observed",
      invariant_family: "workload_result",
      producer_boundary: null,
      target_identity: null,
      authoritative_input_identity: null,
      identity_state: "known",
      identity_scope_key: "workload_result",
      episode_id: null,
      event_orders: successes.map((event) => event.order),
      evidence: {
        successful_observations: successes.map((event) => ({
          observation_kind: event.workload_observation.observation_kind,
          label: event.workload_observation.label,
          event_order: event.order
        })),
        workload_observation_count: workloadEvents.length,
        open_chassis_finding_ids: openChassisFindings.map((observation) => observation.observation_id),
        open_chassis_finding_axes: Array.from(
          new Set(openChassisFindings.map((observation) => observation.axis))
        ).sort()
      }
    })
  ];
}

export function authoringErgonomicsClusterIdentityKey(value) {
  const boundaryId = value?.producer_boundary
    ? `${value.producer_boundary.boundary_kind}:${value.producer_boundary.boundary_id}:${value.producer_boundary.producer_family ?? ""}`
    : "__no_boundary__";
  const targetId = value?.target_identity
    ? `${value.target_identity.target_kind}:${value.target_identity.target_id}`
    : "__no_target__";
  return [
    value?.axis,
    boundaryId,
    value?.invariant_family ?? "__unknown_family__",
    targetId,
    value?.identity_scope_key
  ].join("||");
}

export function clusterAuthoringErgonomicsObservations(observations, trace, episodes) {
  const clusters = new Map();
  const traceToolCallCount = trace.events.filter((event) => event.event_kind === "tool_call").length;
  const traceRefusalCount = trace.events.filter((event) => isRejected(event)).length;
  const toolCallCoverage = coverageForFamily(trace, "tool_call");

  for (const observation of observations) {
    if (!observation.finding) continue;
    const key = authoringErgonomicsClusterIdentityKey(observation);

    if (!clusters.has(key)) {
      clusters.set(key, {
        cluster_id: `CL-${String(clusters.size + 1).padStart(3, "0")}`,
        axis: observation.axis,
        producer_boundary: observation.producer_boundary,
        invariant_family: observation.invariant_family,
        target_identity: observation.target_identity,
        authoritative_input_identity: observation.authoritative_input_identity,
        identity_state: observation.identity_state,
        identity_scope_key: observation.identity_scope_key,
        observation_ids: [],
        detectors: [],
        episode_ids: [],
        raw_event_orders: []
      });
    }

    const cluster = clusters.get(key);
    if (!cluster.observation_ids.includes(observation.observation_id)) {
      cluster.observation_ids.push(observation.observation_id);
    }
    if (!cluster.detectors.includes(observation.detector)) cluster.detectors.push(observation.detector);
    if (observation.episode_id && !cluster.episode_ids.includes(observation.episode_id)) {
      cluster.episode_ids.push(observation.episode_id);
    }
    for (const order of observation.event_orders) {
      if (!cluster.raw_event_orders.includes(order)) cluster.raw_event_orders.push(order);
    }
  }

  return freezeDeep(
    Array.from(clusters.values()).map((cluster) => {
      const clusterEpisodes = episodes.filter((episode) => cluster.episode_ids.includes(episode.episode_id));
      const attemptCount = clusterEpisodes.reduce((total, episode) => total + episode.attempt_count, 0);
      const rejectedCount = clusterEpisodes.reduce(
        (total, episode) => total + episode.rejected_submission_count,
        0
      );
      const diagnosticCount = clusterEpisodes.reduce(
        (total, episode) => total + episode.diagnostic_call_count,
        0
      );
      return {
        ...cluster,
        observation_ids: cluster.observation_ids.slice().sort(),
        detectors: cluster.detectors.slice().sort(),
        raw_event_orders: cluster.raw_event_orders.slice().sort((left, right) => left - right),

        raw_counts: {
          attempt_count: attemptCount,
          rejected_submission_count: rejectedCount,
          diagnostic_call_count: diagnosticCount,
          event_count: cluster.raw_event_orders.length
        },
        denominators: {
          trace_tool_call_count: traceToolCallCount,
          trace_refusal_count: traceRefusalCount,
          trace_episode_count: episodes.length,
          eligible_population: toolCallCoverage
            ? {
                event_families: toolCallCoverage.event_families,
                population_class: toolCallCoverage.population_class,
                normal_success_population_complete: toolCallCoverage.normal_success_population_complete
              }
            : null
        }
      };
    })
  );
}

function buildMetric(trace, name, rawValue, extra) {
  const families = METRIC_POPULATIONS[name];
  if (families.length === 0) {

    return {
      metric: name,
      value: rawValue,
      evidence_state: "trace_derived",
      eligible_population: {
        event_families: families,
        undeclared_event_families: [],
        population_class: null,
        normal_success_population_complete: null,
        observed_event_count: trace.events.length
      },
      ...extra
    };
  }
  const declarations = families.map((family) => ({ family, declaration: coverageForFamily(trace, family) }));
  const undeclared = declarations.filter((entry) => entry.declaration === null).map((entry) => entry.family);
  const observedEventCount = trace.events.filter((event) => families.includes(event.event_kind)).length;

  if (undeclared.length > 0) {

    return {
      metric: name,
      value: null,
      evidence_state: "unavailable",
      eligible_population: {
        event_families: families,
        undeclared_event_families: undeclared,
        population_class: null,
        normal_success_population_complete: null,
        observed_event_count: observedEventCount
      },
      ...extra
    };
  }

  const classes = declarations.map((entry) => entry.declaration.population_class);
  const evidenceState = classes.includes("unknown")
    ? "unknown_population"
    : classes.includes("failure_only")
      ? "declared_failure_only"
      : "declared_normal_and_failure";
  const normalSuccessComplete = declarations.every(
    (entry) => entry.declaration.normal_success_population_complete === true
  )
    ? true
    : declarations.some((entry) => entry.declaration.normal_success_population_complete === false)
      ? false
      : null;

  return {
    metric: name,
    value: rawValue,
    evidence_state: evidenceState,
    eligible_population: {
      event_families: families,
      undeclared_event_families: [],
      population_class: classes.length === 1 ? classes[0] : classes,
      normal_success_population_complete: normalSuccessComplete,
      observed_event_count: observedEventCount
    },
    ...extra
  };
}

function countFindings(observations, id, predicate) {
  return observations.filter(
    (observation) => observation.observation_id === id && observation.finding && (!predicate || predicate(observation))
  ).length;
}

function buildMetrics(trace, episodes, observations, semanticRecovery) {
  const knownWorkflowTokens = trace.workflow_partitions.filter(
    (partition) => partition.event_orders.length > 0
  ).length;
  const uniqueInvariants = new Set();
  for (const event of trace.events) {
    for (const list of [
      event.advertised_invariants,
      event.recovered_invariants,
      event.response?.advertised_invariants,
      event.response?.revealed_invariants
    ]) {
      if (!Array.isArray(list)) continue;
      for (const invariant of list) uniqueInvariants.add(invariant.invariant_id);
    }
  }

  return freezeDeep([
    buildMetric(trace, "workflow_count", knownWorkflowTokens, {
      unknown_workflow_event_count: trace.unknown_workflow_event_orders.length
    }),
    buildMetric(trace, "episode_count", episodes.length, {
      unknown_identity_episode_count: episodes.filter((episode) => episode.identity_state === "unknown").length
    }),
    buildMetric(trace, "tool_call_count", trace.events.filter((event) => event.event_kind === "tool_call").length, {
      diagnostic_call_count: trace.events.filter((event) => isDiagnosticCall(event)).length
    }),
    buildMetric(trace, "refusal_count", trace.events.filter((event) => isRejected(event)).length, {}),
    buildMetric(
      trace,
      "unrecovered_authoring_failure_count",
      semanticRecovery.unrecovered_authoring_failure_count,
      {
        recovered_authoring_failure_count: semanticRecovery.recovered_authoring_failure_count,
        failed_authoring_operation_count: semanticRecovery.classifications.length,

        semantic_recovery: semanticRecovery
      }
    ),
    buildMetric(
      trace,
      "repeated_refusal_episode_count",
      countFindings(observations, "ERG-001"),
      {}
    ),
    buildMetric(trace, "unique_invariant_count", uniqueInvariants.size, {}),
    buildMetric(
      trace,
      "source_inspection_escape_count",
      countFindings(observations, "ERG-008"),
      {
        lookup_degraded_count: observations.filter(
          (observation) => observation.observation_id === "ERG-008" && observation.outcome === "lookup_degraded"
        ).length
      }
    ),
    buildMetric(trace, "unusable_continuation_count", countFindings(observations, "ERG-003"), {}),
    buildMetric(
      trace,
      "unverified_effect_response_count",
      countFindings(observations, "ERG-005", (observation) => observation.axis === "producer"),
      {
        consumer_continuation_count: countFindings(
          observations,
          "ERG-005",
          (observation) => observation.axis === "consumer"
        )
      }
    ),
    buildMetric(trace, "stage_transition_regression_count", countFindings(observations, "ERG-006"), {}),
    buildMetric(
      trace,
      "paid_dispatch_reached_count",
      trace.events.filter((event) => event.dispatch_facts?.paid === true).length,
      {}
    ),
    buildMetric(
      trace,
      "authoritative_effect_observed_count",
      trace.events.filter((event) => hasAuthoritativeObservedEffect(event)).length,
      {}
    )
  ]);
}

function buildUnknownEvidence(trace, episodes, observations, metrics, semanticRecovery) {
  const entries = [];
  for (const metric of metrics) {
    if (metric.evidence_state !== "unavailable") continue;
    entries.push({
      kind: "metric_population_unavailable",
      subject: metric.metric,
      detail: `no coverage declaration for ${metric.eligible_population.undeclared_event_families.join(", ")}; the metric stays null rather than zero`
    });
  }
  for (const family of trace.coverage.undeclared_event_families) {
    entries.push({
      kind: "undeclared_event_family_coverage",
      subject: family,
      detail: "events of this family were observed with no coverage declaration"
    });
  }
  for (const declaration of trace.coverage.declarations) {
    if (declaration.population_class === "unknown") {
      entries.push({
        kind: "unknown_population_class",
        subject: declaration.event_families.join(","),
        detail: "the adapter could not declare this family's population"
      });
    }
  }
  for (const order of trace.unknown_workflow_event_orders) {
    entries.push({
      kind: "unknown_workflow_token",
      subject: `event_order:${order}`,
      detail: "cross-event workflow grouping is forbidden for this event"
    });
  }
  for (const episode of episodes) {
    if (episode.identity_state === "unknown") {
      entries.push({
        kind: "unknown_authoritative_input_identity",
        subject: episode.episode_id,
        detail: "grouping is limited to the directly linked request/response chain"
      });
    }
  }
  for (const observation of observations) {
    if (observation.finding) continue;
    if (observation.evidence_state === "observed") continue;
    entries.push({
      kind: observation.evidence_state,
      subject: `${observation.observation_id}:${observation.event_orders.join(",")}`,
      detail: `${observation.detector} could not establish a finding from available evidence`
    });
  }
  for (const classification of semanticRecovery.classifications) {
    if (classification.classification !== "unknown") continue;
    entries.push({
      kind: "semantic_recovery_identity_unknown",
      subject: `event_order:${classification.failure_event_order}`,
      detail:
        classification.recovery_event_order === null
          ? "no later successful authoring operation was observed; the failure remains unrecovered"
          : "the failure/recovery pair lacks at least one recovery identity component; it is unknown and the failure remains unrecovered"
    });
  }
  return entries;
}

export function detectAuthoringErgonomicsFindings(traceInput) {
  const trace = isNormalizedTrace(traceInput) ? traceInput : normalizeAuthoringErgonomicsTrace(traceInput);
  const episodes = buildAuthoringErgonomicsEpisodes(trace);
  const advertised = advertisedInvariantIndex(trace);

  const chassisObservations = [
    ...detectRepeatedRefusalCascade(trace, episodes),
    ...detectProgressivelyRevealedInvariant(trace, episodes, advertised),
    ...detectUnusableContinuation(trace, episodes),
    ...detectAmbiguousAlternative(trace, episodes),
    ...detectUnverifiedEffectResponse(trace, episodes),
    ...detectStageTransitionRegression(trace, episodes),
    ...detectIgnoredTypedNextAction(trace, episodes),
    ...detectSourceInspectionEscape(trace, episodes, advertised),
    ...detectParentSliceQualityDivergence(trace, episodes),
    ...detectControlledCarrierLifecycleLoss(trace, episodes)
  ];

  const observations = [...chassisObservations, ...detectFalseGreenWorkload(trace, chassisObservations)].sort(
    (left, right) => {
      const leftOrder = left.event_orders[0] ?? -1;
      const rightOrder = right.event_orders[0] ?? -1;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return left.observation_id < right.observation_id ? -1 : left.observation_id > right.observation_id ? 1 : 0;
    }
  );

  const clusters = clusterAuthoringErgonomicsObservations(observations, trace, episodes);
  const semanticRecovery = buildSemanticRecoveryClassification(trace);
  const metrics = buildMetrics(trace, episodes, observations, semanticRecovery);

  return freezeDeep({
    schema_version: AUTHORING_ERGONOMICS_REPORT_SCHEMA_VERSION,
    trace_id: trace.trace_id,
    source: trace.source,
    observed_identities: trace.observed_identities,
    coverage: trace.coverage,
    ordering_authority: trace.ordering_authority,
    workflow_partitions: trace.workflow_partitions,
    episodes,
    observations,
    clusters,
    semantic_recovery: semanticRecovery,
    axes_present: Array.from(new Set(clusters.map((cluster) => cluster.axis))).sort(),
    metrics,
    unknown_evidence: buildUnknownEvidence(trace, episodes, observations, metrics, semanticRecovery)
  });
}
