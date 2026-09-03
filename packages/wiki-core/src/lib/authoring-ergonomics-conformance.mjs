

import {
  AUTHORING_ERGONOMICS_NORMALIZED_SCHEMA_VERSION,
  AUTHORING_ERGONOMICS_REPORT_SCHEMA_VERSION,
  AUTHORING_ERGONOMICS_TRACE_SCHEMA_VERSION,
  detectAuthoringErgonomicsFindings,
  normalizeAuthoringErgonomicsTrace
} from "./authoring-ergonomics-trace.mjs";

export const AUTHORING_ERGONOMICS_CONFORMANCE_SCHEMA_VERSION =
  "authoring-ergonomics-conformance.v1";

export const AUTHORING_ERGONOMICS_CONFORMANCE_OWNER = "IN-0016";

export const AUTHORING_ERGONOMICS_CONFORMANCE_OUTCOMES = Object.freeze([
  "pass",
  "fail",
  "unevaluable_missing_coverage"
]);

export const AUTHORING_ERGONOMICS_CONFORMANCE_AUTHORITY = Object.freeze({
  kind: "advisory_evidence",
  confers: Object.freeze([]),
  note:
    "Conformance evaluation is advisory evidence. It carries no admission, dispatch, closure, review, integration, or policy authority, and never authorizes or refuses an operation."
});

export const AUTHORING_ERGONOMICS_CONFORMANCE_REASON_CODES = Object.freeze({
  coverage_declaration_absent: "authoring_ergonomics.conformance.coverage_declaration_absent.v1",
  population_class_failure_only: "authoring_ergonomics.conformance.population_class_failure_only.v1",
  population_class_unknown: "authoring_ergonomics.conformance.population_class_unknown.v1",
  normal_success_population_incomplete:
    "authoring_ergonomics.conformance.normal_success_population_incomplete.v1",
  eligible_population_empty: "authoring_ergonomics.conformance.eligible_population_empty.v1",
  unknown_evidence_blocks_pass: "authoring_ergonomics.conformance.unknown_evidence_blocks_pass.v1",
  violation_observed: "authoring_ergonomics.conformance.violation_observed.v1",
  satisfied: "authoring_ergonomics.conformance.satisfied.v1"
});

export const AUTHORING_ERGONOMICS_ADVERTISED_NEXT_CALL_STATES = Object.freeze([
  "absent",
  "rejected",
  "executable",
  "missing_coverage"
]);

export const AUTHORING_ERGONOMICS_PUBLIC_CONTINUATION_STATES = Object.freeze([
  "absent",
  "unreachable_rejected",
  "executable",
  "missing_coverage"
]);

export const AUTHORING_ERGONOMICS_EFFECT_VERIFICATION_STATES = Object.freeze([
  "verified",
  "unverified",
  "missing_coverage"
]);

export const AUTHORING_ERGONOMICS_SESSION_RETRY_STATES = Object.freeze([
  "bounded",
  "exceeded",
  "ineligible"
]);

export const AUTHORING_ERGONOMICS_FRESH_SESSION_REJECTED_SUBMISSION_BOUND = 1;

export const AUTHORING_ERGONOMICS_CONFORMANCE_REGISTRY = Object.freeze([
  Object.freeze({
    identity: "authoring-ergonomics.zero-normal-success-without-verified-effect.v1",
    unit_kind: "normal_success_claimed_effect_response",

    required_event_families: Object.freeze([
      "tool_call",
      "persistence_receipt",
      "authoritative_ref_observation"
    ]),
    requires_complete_normal_success_population: true,
    unit_states: AUTHORING_ERGONOMICS_EFFECT_VERIFICATION_STATES,
    requirement:
      "Zero producer-returned normal or accepted responses claiming an effect without an operation-issued receipt or an authoritative observation."
  }),
  Object.freeze({
    identity: "authoring-ergonomics.zero-advertised-nonexecutable-next-call.v1",
    unit_kind: "advertised_replacement_call",
    required_event_families: Object.freeze(["tool_call", "continuation"]),
    requires_complete_normal_success_population: false,
    unit_states: AUTHORING_ERGONOMICS_ADVERTISED_NEXT_CALL_STATES,
    requirement:
      "Zero advertised typed replacement calls that fail at their named ingress, including an unavailable named tool and a structural-only template with no completion route."
  }),
  Object.freeze({
    identity: "authoring-ergonomics.zero-unreachable-public-continuation.v1",
    unit_kind: "advertised_public_continuation_identity",
    required_event_families: Object.freeze(["tool_call", "continuation"]),
    requires_complete_normal_success_population: false,
    unit_states: AUTHORING_ERGONOMICS_PUBLIC_CONTINUATION_STATES,
    requirement:
      "Zero advertised public continuation identities that are absent or rejected at the live named ingress."
  }),
  Object.freeze({
    identity: "authoring-ergonomics.fresh-session-retry-bound.v1",
    unit_kind: "session_retry_window",

    required_event_families: Object.freeze([
      "tool_discovery",
      "tool_call",
      "continuation",
      "persistence_receipt",
      "authoritative_ref_observation"
    ]),
    requires_complete_normal_success_population: true,
    unit_states: AUTHORING_ERGONOMICS_SESSION_RETRY_STATES,
    requirement:
      "No more than one rejected authoring submission per session after the initial operation-ready discovery response and before either a verified effect or an executable continuation."
  })
]);

export const AUTHORING_ERGONOMICS_CONFORMANCE_IDENTITIES = Object.freeze(
  AUTHORING_ERGONOMICS_CONFORMANCE_REGISTRY.map((entry) => entry.identity)
);

export class AuthoringErgonomicsConformanceError extends Error {
  constructor(code, detail) {
    super(`${code}: ${detail}`);
    this.name = "AuthoringErgonomicsConformanceError";
    this.code = code;
    this.detail = detail;
  }
}

export function describeAuthoringErgonomicsConformanceGate(identity) {
  const entry = AUTHORING_ERGONOMICS_CONFORMANCE_REGISTRY.find(
    (candidate) => candidate.identity === identity
  );
  if (!entry) {
    throw new AuthoringErgonomicsConformanceError(
      "unknown_conformance_identity",
      `${String(identity)} is not one of the four registered identities`
    );
  }
  return entry;
}

function freezeDeep(value) {
  if (Array.isArray(value)) {
    value.forEach(freezeDeep);
    return Object.freeze(value);
  }
  if (typeof value === "object" && value !== null) {
    for (const key of Object.keys(value)) freezeDeep(value[key]);
    return Object.freeze(value);
  }
  return value;
}

function coverageForFamily(trace, family) {
  for (const declaration of trace.coverage.declarations) {
    if (declaration.event_families.includes(family)) return declaration;
  }
  return null;
}

function resolveCoverage(trace, gate) {
  const entries = gate.required_event_families.map((family) => ({
    family,
    declaration: coverageForFamily(trace, family)
  }));

  const undeclared = entries.filter((entry) => entry.declaration === null).map((entry) => entry.family);
  const declaredClasses = entries.map((entry) => ({
    event_family: entry.family,
    population_class: entry.declaration === null ? null : entry.declaration.population_class
  }));

  const declared = entries.filter((entry) => entry.declaration !== null);
  const normalSuccessComplete =
    declared.length > 0 &&
    declared.every((entry) => entry.declaration.normal_success_population_complete === true)
      ? true
      : declared.some((entry) => entry.declaration.normal_success_population_complete === false)
        ? false
        : null;

  const summary = {
    required_event_families: gate.required_event_families,
    undeclared_event_families: undeclared,
    declared_population_classes: declaredClasses,
    normal_success_population_complete: normalSuccessComplete,
    requires_complete_normal_success_population: gate.requires_complete_normal_success_population,
    observed_event_count: trace.events.filter((event) =>
      gate.required_event_families.includes(event.event_kind)
    ).length
  };

  if (undeclared.length > 0) {
    return {
      qualified: false,
      summary,
      reason_code: AUTHORING_ERGONOMICS_CONFORMANCE_REASON_CODES.coverage_declaration_absent,
      reason: `no coverage declaration for ${undeclared.join(", ")}; the gate stays unevaluable rather than passing on unobserved evidence`
    };
  }

  const failureOnly = declared
    .filter((entry) => entry.declaration.population_class === "failure_only")
    .map((entry) => entry.family);
  if (failureOnly.length > 0) {
    return {
      qualified: false,
      summary,
      reason_code: AUTHORING_ERGONOMICS_CONFORMANCE_REASON_CODES.population_class_failure_only,
      reason: `${failureOnly.join(", ")} is declared failure-only; a failure-biased population can neither green nor condemn this gate`
    };
  }

  const unknownClass = declared
    .filter((entry) => entry.declaration.population_class === "unknown")
    .map((entry) => entry.family);
  if (unknownClass.length > 0) {
    return {
      qualified: false,
      summary,
      reason_code: AUTHORING_ERGONOMICS_CONFORMANCE_REASON_CODES.population_class_unknown,
      reason: `${unknownClass.join(", ")} has an unknown population class; the adapter could not bound this population`
    };
  }

  if (gate.requires_complete_normal_success_population && normalSuccessComplete !== true) {
    return {
      qualified: false,
      summary,
      reason_code:
        AUTHORING_ERGONOMICS_CONFORMANCE_REASON_CODES.normal_success_population_incomplete,
      reason:
        normalSuccessComplete === false
          ? "the normal-success population is declared incomplete; unobserved normal successes could hide a violation"
          : "the normal-success population completeness was never declared; it stays unknown rather than assumed complete"
    };
  }

  return { qualified: true, summary, reason_code: null, reason: null };
}

function unevaluableForCoverage(gate, coverage) {
  return {
    identity: gate.identity,
    unit_kind: gate.unit_kind,
    requirement: gate.requirement,
    authority: AUTHORING_ERGONOMICS_CONFORMANCE_AUTHORITY,
    outcome: "unevaluable_missing_coverage",
    reason_code: coverage.reason_code,
    reason: coverage.reason,
    eligible_population: { ...coverage.summary, denominator: null },
    unit_state_counts: null,
    violations: null,
    unknown_evidence: null,
    detail: null
  };
}

function settleGate(gate, coverage, population, violations, unknownEvidence, states, detail) {
  const base = {
    identity: gate.identity,
    unit_kind: gate.unit_kind,
    requirement: gate.requirement,
    authority: AUTHORING_ERGONOMICS_CONFORMANCE_AUTHORITY,
    eligible_population: { ...coverage.summary, ...population },
    unit_state_counts: states,
    violations,
    unknown_evidence: unknownEvidence,
    detail: detail ?? null
  };

  if (violations.length > 0) {
    return {
      ...base,
      outcome: "fail",
      reason_code: AUTHORING_ERGONOMICS_CONFORMANCE_REASON_CODES.violation_observed,
      reason: `${violations.length} of ${population.denominator} eligible ${gate.unit_kind} unit(s) violate the requirement`
    };
  }

  if (unknownEvidence.length > 0) {
    return {
      ...base,
      outcome: "unevaluable_missing_coverage",
      reason_code: AUTHORING_ERGONOMICS_CONFORMANCE_REASON_CODES.unknown_evidence_blocks_pass,
      reason: `${unknownEvidence.length} deciding fact(s) were never observed; the gate cannot certify zero and does not pass`
    };
  }

  if (population.denominator === 0) {
    return {
      ...base,
      outcome: "unevaluable_missing_coverage",
      reason_code: AUTHORING_ERGONOMICS_CONFORMANCE_REASON_CODES.eligible_population_empty,
      reason: `no eligible ${gate.unit_kind} unit was observed; an empty population is ineligible, not a vacuous pass`
    };
  }

  return {
    ...base,
    outcome: "pass",
    reason_code: AUTHORING_ERGONOMICS_CONFORMANCE_REASON_CODES.satisfied,
    reason: `all ${population.denominator} eligible ${gate.unit_kind} unit(s) satisfy the requirement`
  };
}

function isOperationReadyDiscovery(event) {
  if (event.event_kind !== "tool_discovery") return false;
  const response = event.response;
  if (!response) return false;
  if (response.transport_status !== "ok") return false;
  return response.application_status === "accepted" || response.application_status === "normal";
}

function isRejectedAuthoringSubmission(event) {
  if (event.event_kind !== "tool_call") return false;

  if (event.request?.diagnostic === true) return false;
  return event.response?.application_status === "rejected";
}

function hasVerifiedEffect(event) {
  if (event.receipt?.receipt_state === "present") return true;
  const effects = event.observed_effects;
  return (
    Array.isArray(effects) &&
    effects.some((effect) => effect.observation_provenance === "authoritative_observed")
  );
}

function buildAuthoringOperationEvidenceBounds(trace) {
  const meaningful = trace.events.filter(
    (event) => event.event_kind === "tool_call" && event.request?.diagnostic !== true
  );
  const measured = meaningful.filter((event) => Number.isInteger(event.response?.response_bytes));
  const unmeasured = meaningful.filter((event) => !Number.isInteger(event.response?.response_bytes));
  const responseBytesAvailable = meaningful.length > 0 && unmeasured.length === 0;

  return {
    meaningful_operations: {
      value: meaningful.length,
      evidence_state: "trace_derived",
      definition: "non_diagnostic_tool_call",
      event_orders: meaningful.map((event) => event.order)
    },
    response_bytes: {
      value: responseBytesAvailable
        ? measured.reduce((sum, event) => sum + event.response.response_bytes, 0)
        : null,
      evidence_state: responseBytesAvailable ? "producer_measured" : "unavailable",
      unit: "bytes",
      measurement_source: "response.response_bytes",
      measured_operation_count: measured.length,
      unmeasured_operation_count: unmeasured.length,
      measured_event_orders: measured.map((event) => event.order),
      unmeasured_event_orders: unmeasured.map((event) => event.order)
    }
  };
}

function continuationObservations(report) {
  return report.observations.filter((observation) => observation.observation_id === "ERG-003");
}

function evaluateZeroNormalSuccessWithoutVerifiedEffect(gate, trace, report) {
  const coverage = resolveCoverage(trace, gate);
  if (!coverage.qualified) return unevaluableForCoverage(gate, coverage);

  const observations = report.observations.filter(
    (observation) => observation.observation_id === "ERG-005" && observation.axis === "producer"
  );

  const states = { verified: 0, unverified: 0, missing_coverage: 0 };
  const violations = [];
  const unknownEvidence = [];

  for (const observation of observations) {
    if (observation.outcome === "effect_verified") {
      states.verified += 1;
      continue;
    }
    if (observation.outcome === "claimed_effect_unverified") {
      states.unverified += 1;
      violations.push({
        state: "unverified",
        event_orders: observation.event_orders,
        episode_id: observation.episode_id,
        producer_boundary: observation.producer_boundary,
        target_identity: observation.target_identity,
        application_status: observation.evidence.application_status,
        claimed_effects: observation.evidence.claimed_effects,
        receipt_state: observation.evidence.receipt_state,
        authoritative_observed_effects: observation.evidence.authoritative_observed_effects
      });
      continue;
    }
    if (observation.outcome === "verification_evidence_unknown") {
      states.missing_coverage += 1;
      unknownEvidence.push({
        kind: "unobserved_effect_verification",
        subject: `event_order:${observation.event_orders[0]}`,
        detail:
          "neither an operation-issued receipt nor an authoritative observation was observed for this claimed effect; it is unknown, not verified"
      });
      continue;
    }
    throw new AuthoringErgonomicsConformanceError(
      "unexpected_detector_outcome",
      `ERG-005 producer outcome ${String(observation.outcome)} is not handled by ${gate.identity}`
    );
  }

  return settleGate(
    gate,
    coverage,
    { denominator: observations.length, ...states },
    violations,
    unknownEvidence,
    states,
    null
  );
}

function classifyAdvertisedNextCall(observation) {
  const evidence = observation.evidence;
  switch (observation.outcome) {
    case "no_route":
    case "no_replacement_call":

      return { state: "absent", eligible: false, violation: false, discriminator: observation.outcome };
    case "structural_template_only":

      return {
        state: "rejected",
        eligible: true,
        violation: true,
        discriminator:
          evidence.replacement_call === null
            ? "structural_template_without_replacement_call"
            : "structural_only_no_completion_route"
      };
    case "named_tool_unavailable":
      return { state: "rejected", eligible: true, violation: true, discriminator: "named_tool_unavailable" };
    case "replacement_call_rejected":
      return { state: "rejected", eligible: true, violation: true, discriminator: "replacement_call_rejected" };
    case "ingress_availability_unknown":
      return {
        state: "missing_coverage",
        eligible: true,
        violation: false,
        discriminator: "ingress_availability_unknown"
      };
    case "executable":
      return { state: "executable", eligible: true, violation: false, discriminator: "executable" };
    default:
      throw new AuthoringErgonomicsConformanceError(
        "unexpected_detector_outcome",
        `ERG-003 outcome ${String(observation.outcome)} is not handled by the advertised-next-call gate`
      );
  }
}

function evaluateZeroAdvertisedNonexecutableNextCall(gate, trace, report) {
  const coverage = resolveCoverage(trace, gate);
  if (!coverage.qualified) return unevaluableForCoverage(gate, coverage);

  const states = { absent: 0, rejected: 0, executable: 0, missing_coverage: 0 };
  const violations = [];
  const unknownEvidence = [];
  let denominator = 0;

  for (const observation of continuationObservations(report)) {
    const classified = classifyAdvertisedNextCall(observation);
    states[classified.state] += 1;
    if (!classified.eligible) continue;
    denominator += 1;

    if (classified.violation) {
      violations.push({
        state: classified.state,
        discriminator: classified.discriminator,
        event_orders: observation.event_orders,
        episode_id: observation.episode_id,
        producer_boundary: observation.producer_boundary,
        advertised_ingress: observation.evidence.advertised_ingress,
        replacement_call: observation.evidence.replacement_call,
        replacement_call_outcome: observation.evidence.replacement_call_outcome
      });
      continue;
    }
    if (classified.state === "missing_coverage") {
      unknownEvidence.push({
        kind: "unobserved_ingress_availability",
        subject: `event_order:${observation.event_orders[0]}`,
        detail:
          "the advertised replacement call's named ingress availability was never observed; it is unknown, not executable"
      });
    }
  }

  return settleGate(
    gate,
    coverage,
    { denominator, ...states },
    violations,
    unknownEvidence,
    states,

    { absent_continuations_excluded_from_denominator: states.absent }
  );
}

function classifyPublicContinuation(observation) {
  const call = observation.evidence.replacement_call;
  if (observation.evidence.route_present === false || call === null) {
    return { eligible: false, discriminator: "no_advertised_continuation" };
  }
  if (call.ingress === null) {

    return { eligible: false, discriminator: "no_named_public_ingress" };
  }
  if (call.named_tool_available === false) {
    return { eligible: true, state: "absent", violation: true, discriminator: "identity_absent_at_ingress" };
  }
  if (observation.evidence.replacement_call_outcome === "rejected") {
    return {
      eligible: true,
      state: "unreachable_rejected",
      violation: true,
      discriminator: "rejected_at_live_ingress"
    };
  }
  if (call.named_tool_available === null) {
    return {
      eligible: true,
      state: "missing_coverage",
      violation: false,
      discriminator: "ingress_availability_unknown"
    };
  }
  return { eligible: true, state: "executable", violation: false, discriminator: "reachable_at_ingress" };
}

function evaluateZeroUnreachablePublicContinuation(gate, trace, report) {
  const coverage = resolveCoverage(trace, gate);
  if (!coverage.qualified) return unevaluableForCoverage(gate, coverage);

  const states = { absent: 0, unreachable_rejected: 0, executable: 0, missing_coverage: 0 };
  const violations = [];
  const unknownEvidence = [];
  let denominator = 0;
  let ineligible = 0;

  for (const observation of continuationObservations(report)) {
    const classified = classifyPublicContinuation(observation);
    if (!classified.eligible) {
      ineligible += 1;
      continue;
    }
    states[classified.state] += 1;
    denominator += 1;

    if (classified.violation) {
      violations.push({
        state: classified.state,
        discriminator: classified.discriminator,
        event_orders: observation.event_orders,
        episode_id: observation.episode_id,
        producer_boundary: observation.producer_boundary,
        advertised_ingress: observation.evidence.advertised_ingress,
        named_tool_available: observation.evidence.replacement_call.named_tool_available,
        replacement_call_outcome: observation.evidence.replacement_call_outcome
      });
      continue;
    }
    if (classified.state === "missing_coverage") {
      unknownEvidence.push({
        kind: "unobserved_public_ingress_reachability",
        subject: `event_order:${observation.event_orders[0]}`,
        detail:
          "the advertised public continuation identity's presence at the live ingress was never observed; it is unknown, not reachable"
      });
    }
  }

  return settleGate(
    gate,
    coverage,
    { denominator, ...states },
    violations,
    unknownEvidence,
    states,
    { continuations_without_named_public_ingress: ineligible }
  );
}

function evaluateFreshSessionRetryBound(gate, trace, report) {
  const coverage = resolveCoverage(trace, gate);
  if (!coverage.qualified) return unevaluableForCoverage(gate, coverage);

  const executableContinuationOrders = new Set(
    continuationObservations(report)
      .filter((observation) => classifyAdvertisedNextCall(observation).state === "executable")
      .map((observation) => observation.event_orders[0])
  );

  const states = { bounded: 0, exceeded: 0, ineligible: 0 };
  const violations = [];
  const unknownEvidence = [];
  const sessions = [];

  for (const partition of trace.workflow_partitions) {
    const sessionEvents = partition.event_orders.map((order) => trace.events[order]);
    const discovery = sessionEvents.find(isOperationReadyDiscovery);

    if (discovery === undefined) {
      states.ineligible += 1;
      sessions.push({
        workflow_token: partition.workflow_token,
        state: "ineligible",
        discriminator: "no_operation_ready_discovery_response_observed",
        rejected_submission_count: null,
        window_event_orders: null
      });
      continue;
    }

    const terminator =
      sessionEvents.find(
        (event) =>
          event.order > discovery.order &&
          (hasVerifiedEffect(event) || executableContinuationOrders.has(event.order))
      ) ?? null;

    const windowEvents = sessionEvents.filter(
      (event) => event.order > discovery.order && (terminator === null || event.order < terminator.order)
    );

    for (const event of windowEvents) {
      if (event.event_kind !== "tool_call") continue;

      if (event.request?.diagnostic === true) continue;

      const response = event.response;
      if (response === null) {
        unknownEvidence.push({
          kind: "unobserved_submission_response",
          subject: `event_order:${event.order}`,
          detail:
            "a submission inside the retry window has no observed response; whether it was rejected is unknown"
        });
        continue;
      }
      if (response.transport_status !== "ok") {
        unknownEvidence.push({
          kind: "unobserved_submission_outcome",
          subject: `event_order:${event.order}`,
          detail: `a submission inside the retry window has transport status ${response.transport_status}; the application outcome was not reliably observed`
        });
        continue;
      }
      if (response.application_status === "unknown") {
        unknownEvidence.push({
          kind: "unobserved_submission_outcome",
          subject: `event_order:${event.order}`,
          detail:
            "a submission inside the retry window has an unknown application status; it is not read as accepted"
        });
      }
    }

    const rejected = windowEvents.filter(isRejectedAuthoringSubmission);
    const exceeded = rejected.length > AUTHORING_ERGONOMICS_FRESH_SESSION_REJECTED_SUBMISSION_BOUND;
    states[exceeded ? "exceeded" : "bounded"] += 1;

    const session = {
      workflow_token: partition.workflow_token,
      state: exceeded ? "exceeded" : "bounded",
      discriminator: terminator === null ? "window_open_at_trace_end" : "window_closed_by_terminator",
      discovery_event_order: discovery.order,
      terminator_event_order: terminator === null ? null : terminator.order,
      terminator_kind:
        terminator === null
          ? null
          : hasVerifiedEffect(terminator)
            ? "verified_effect"
            : "executable_continuation",
      rejected_submission_count: rejected.length,
      rejected_submission_orders: rejected.map((event) => event.order),
      bound: AUTHORING_ERGONOMICS_FRESH_SESSION_REJECTED_SUBMISSION_BOUND,
      window_event_orders: windowEvents.map((event) => event.order)
    };
    sessions.push(session);
    if (exceeded) violations.push(session);
  }

  for (const order of trace.unknown_workflow_event_orders) {
    const event = trace.events[order];
    if (event.event_kind !== "tool_call" && event.event_kind !== "tool_discovery") continue;
    unknownEvidence.push({
      kind: "unknown_workflow_token",
      subject: `event_order:${order}`,
      detail:
        "this event carries no session token, so it cannot be attributed to a retry window; the bound cannot be certified"
    });
  }

  return settleGate(
    gate,
    coverage,
    { denominator: states.bounded + states.exceeded, ...states },
    violations,
    unknownEvidence,
    states,
    { sessions }
  );
}

const GATE_EVALUATORS = Object.freeze({
  "authoring-ergonomics.zero-normal-success-without-verified-effect.v1":
    evaluateZeroNormalSuccessWithoutVerifiedEffect,
  "authoring-ergonomics.zero-advertised-nonexecutable-next-call.v1":
    evaluateZeroAdvertisedNonexecutableNextCall,
  "authoring-ergonomics.zero-unreachable-public-continuation.v1":
    evaluateZeroUnreachablePublicContinuation,
  "authoring-ergonomics.fresh-session-retry-bound.v1": evaluateFreshSessionRetryBound
});

export function evaluateAuthoringErgonomicsConformance(traceInput) {
  if (typeof traceInput !== "object" || traceInput === null || Array.isArray(traceInput)) {
    throw new AuthoringErgonomicsConformanceError(
      "unsupported_input",
      `expected an ${AUTHORING_ERGONOMICS_TRACE_SCHEMA_VERSION} envelope or a normalized trace object`
    );
  }
  if (traceInput.schema_version === AUTHORING_ERGONOMICS_REPORT_SCHEMA_VERSION) {
    throw new AuthoringErgonomicsConformanceError(
      "unsupported_input",
      `a ${AUTHORING_ERGONOMICS_REPORT_SCHEMA_VERSION} report carries no events; pass the trace this gate set must be bound to`
    );
  }

  const trace =
    traceInput.schema_version === AUTHORING_ERGONOMICS_NORMALIZED_SCHEMA_VERSION
      ? traceInput
      : normalizeAuthoringErgonomicsTrace(traceInput);
  const report = detectAuthoringErgonomicsFindings(trace);
  const evidenceBounds = buildAuthoringOperationEvidenceBounds(trace);

  const gates = AUTHORING_ERGONOMICS_CONFORMANCE_REGISTRY.map((gate) => ({
    ...GATE_EVALUATORS[gate.identity](gate, trace, report),
    evidence_bounds: evidenceBounds
  }));

  const outcomeCounts = { pass: 0, fail: 0, unevaluable_missing_coverage: 0 };
  for (const gate of gates) outcomeCounts[gate.outcome] += 1;

  return freezeDeep({
    schema_version: AUTHORING_ERGONOMICS_CONFORMANCE_SCHEMA_VERSION,
    owner: AUTHORING_ERGONOMICS_CONFORMANCE_OWNER,
    authority: AUTHORING_ERGONOMICS_CONFORMANCE_AUTHORITY,
    trace_id: trace.trace_id,
    source: trace.source,
    observed_identities: trace.observed_identities,
    coverage: trace.coverage,
    report_schema_version: report.schema_version,
    identities: AUTHORING_ERGONOMICS_CONFORMANCE_IDENTITIES,
    gates,
    outcome_counts: outcomeCounts,

    evaluated_gate_count: outcomeCounts.pass + outcomeCounts.fail
  });
}
