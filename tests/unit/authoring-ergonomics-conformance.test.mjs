

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AUTHORING_ERGONOMICS_TRACE_SCHEMA_VERSION,
  detectAuthoringErgonomicsFindings
} from "../../packages/wiki-core/src/lib/authoring-ergonomics-trace.mjs";
import {
  AUTHORING_ERGONOMICS_ADVERTISED_NEXT_CALL_STATES,
  AUTHORING_ERGONOMICS_CONFORMANCE_AUTHORITY,
  AUTHORING_ERGONOMICS_CONFORMANCE_IDENTITIES,
  AUTHORING_ERGONOMICS_CONFORMANCE_OUTCOMES,
  AUTHORING_ERGONOMICS_CONFORMANCE_REASON_CODES,
  AUTHORING_ERGONOMICS_CONFORMANCE_REGISTRY,
  AUTHORING_ERGONOMICS_CONFORMANCE_SCHEMA_VERSION,
  AUTHORING_ERGONOMICS_FRESH_SESSION_REJECTED_SUBMISSION_BOUND,
  AUTHORING_ERGONOMICS_PUBLIC_CONTINUATION_STATES,
  AuthoringErgonomicsConformanceError,
  describeAuthoringErgonomicsConformanceGate,
  evaluateAuthoringErgonomicsConformance
} from "../../packages/wiki-core/src/lib/authoring-ergonomics-conformance.mjs";

const MODULE_PATH = path.join(
  path.dirname(path.dirname(fileURLToPath(import.meta.url))),
  "../packages/wiki-core/src/lib/authoring-ergonomics-conformance.mjs"
);

const EFFECT_GATE = "authoring-ergonomics.zero-normal-success-without-verified-effect.v1";
const NEXT_CALL_GATE = "authoring-ergonomics.zero-advertised-nonexecutable-next-call.v1";
const PUBLIC_CONTINUATION_GATE = "authoring-ergonomics.zero-unreachable-public-continuation.v1";
const RETRY_GATE = "authoring-ergonomics.fresh-session-retry-bound.v1";

const ALL_FAMILIES = [
  "tool_discovery",
  "tool_call",
  "continuation",
  "persistence_receipt",
  "authoritative_ref_observation"
];

const BOUNDARY = {
  boundary_kind: "mcp_tool",
  boundary_id: "inline.boundary",
  producer_family: "inline_family"
};
const TARGET = { target_kind: "carrier_set", target_id: "CS-INLINE" };
const GEN = {
  identity_kind: "carrier_generation",
  identity_value: "GEN-1",
  descriptor_digest: "sha256:gen-1"
};

function coverage(overrides = {}) {
  return [
    {
      workload: "inline",
      event_families: ALL_FAMILIES,
      population_class: "normal_and_failure",
      normal_success_population_complete: true,
      ...overrides
    }
  ];
}

function failureOnlyCoverage() {
  return coverage({ population_class: "failure_only", normal_success_population_complete: false });
}

function envelope(events, declarations = coverage()) {
  return {
    schema_version: AUTHORING_ERGONOMICS_TRACE_SCHEMA_VERSION,
    trace_id: "INLINE",
    source: {
      source_kind: "inline_test",
      source_locator: "inline://authoring-ergonomics-conformance",
      source_ordinal: 0
    },
    coverage: { declarations },
    events
  };
}

function gatesOf(events, declarations) {
  const result = evaluateAuthoringErgonomicsConformance(envelope(events, declarations));
  const index = new Map(result.gates.map((gate) => [gate.identity, gate]));
  return { result, gate: (identity) => index.get(identity) };
}

function discovery(eventIndex, overrides = {}) {
  return {
    event_index: eventIndex,
    event_kind: "tool_discovery",
    actor_kind: "producer",
    workflow_token: "WF-1",
    producer_boundary: BOUNDARY,
    response: { transport_status: "ok", application_status: "normal" },
    ...overrides
  };
}

function claimedEffectCall(eventIndex, overrides = {}) {
  const { receipt_state = null, observed_effects = null, ...rest } = overrides;
  return {
    event_index: eventIndex,
    event_kind: "tool_call",
    actor_kind: "producer",
    workflow_token: "WF-1",
    producer_boundary: BOUNDARY,
    target_identity: TARGET,
    authoritative_input_identity: GEN,
    request: { request_id: `REQ-${eventIndex}`, tool: "inline.persist", diagnostic: false },
    response: { transport_status: "ok", application_status: "normal" },
    claimed_effects: [{ effect_kind: "carrier_generation_persisted", effect_target: "CS-INLINE" }],
    receipt: receipt_state === null ? null : { receipt_state },
    observed_effects,
    ...rest
  };
}

function rejectedSubmission(eventIndex, overrides = {}) {
  return {
    event_index: eventIndex,
    event_kind: "tool_call",
    actor_kind: "consumer",
    workflow_token: "WF-1",
    producer_boundary: BOUNDARY,
    target_identity: TARGET,
    authoritative_input_identity: GEN,
    request: { request_id: `REQ-${eventIndex}`, tool: "inline.submit", diagnostic: false },
    response: {
      transport_status: "ok",
      application_status: "rejected",
      reason_codes: ["inline_rejected"],
      invariant_family: "inline_family_invariant"
    },
    ...overrides
  };
}

function continuationEvent(eventIndex, continuation, overrides = {}) {
  return {
    event_index: eventIndex,
    event_kind: "continuation",
    actor_kind: "producer",
    workflow_token: "WF-1",
    producer_boundary: BOUNDARY,
    target_identity: TARGET,
    authoritative_input_identity: GEN,
    continuation,
    ...overrides
  };
}

function replacementCall(overrides = {}) {
  return { tool: "inline.next", ingress: "public.ingress", ...overrides };
}

const NO_ROUTE = { route_present: false };
const ROUTE_WITHOUT_CALL = { route_present: true };
const TEMPLATE_WITHOUT_CALL = { route_present: true, template_only: true, replacement_call: null };
const NAMED_TOOL_UNAVAILABLE = {
  route_present: true,
  template_only: false,
  replacement_call: replacementCall({ named_tool_available: false, structural_only: false }),
  replacement_call_outcome: "not_attempted"
};
const REPLACEMENT_CALL_REJECTED = {
  route_present: true,
  template_only: false,
  replacement_call: replacementCall({ named_tool_available: true, structural_only: false }),
  replacement_call_outcome: "rejected"
};
const STRUCTURAL_ONLY_WITH_CALL = {
  route_present: true,
  template_only: false,
  replacement_call: replacementCall({ named_tool_available: true, structural_only: true }),
  replacement_call_outcome: "not_attempted"
};
const INGRESS_AVAILABILITY_UNKNOWN = {
  route_present: true,
  template_only: false,
  replacement_call: replacementCall({ structural_only: false }),
  replacement_call_outcome: "not_attempted"
};
const EXECUTABLE = {
  route_present: true,
  template_only: false,
  replacement_call: replacementCall({ named_tool_available: true, structural_only: false }),
  replacement_call_outcome: "accepted"
};
const EXECUTABLE_WITHOUT_NAMED_INGRESS = {
  route_present: true,
  template_only: false,
  replacement_call: { tool: "inline.next", named_tool_available: true, structural_only: false },
  replacement_call_outcome: "accepted"
};

test("the registry exposes exactly the four D3 conformance identities", () => {
  assert.deepEqual(AUTHORING_ERGONOMICS_CONFORMANCE_IDENTITIES, [
    "authoring-ergonomics.zero-normal-success-without-verified-effect.v1",
    "authoring-ergonomics.zero-advertised-nonexecutable-next-call.v1",
    "authoring-ergonomics.zero-unreachable-public-continuation.v1",
    "authoring-ergonomics.fresh-session-retry-bound.v1"
  ]);
  assert.equal(AUTHORING_ERGONOMICS_CONFORMANCE_REGISTRY.length, 4);
  assert.equal(new Set(AUTHORING_ERGONOMICS_CONFORMANCE_IDENTITIES).size, 4);

  assert.throws(
    () => describeAuthoringErgonomicsConformanceGate("authoring-ergonomics.some-other-check.v1"),
    (error) =>
      error instanceof AuthoringErgonomicsConformanceError &&
      error.code === "unknown_conformance_identity"
  );
  for (const identity of AUTHORING_ERGONOMICS_CONFORMANCE_IDENTITIES) {
    assert.equal(describeAuthoringErgonomicsConformanceGate(identity).identity, identity);
  }
});

test("every gate declares its required event families and its own closed state vocabulary", () => {
  const byIdentity = new Map(
    AUTHORING_ERGONOMICS_CONFORMANCE_REGISTRY.map((entry) => [entry.identity, entry])
  );

  assert.equal(byIdentity.get(EFFECT_GATE).requires_complete_normal_success_population, true);
  assert.equal(byIdentity.get(RETRY_GATE).requires_complete_normal_success_population, true);
  assert.equal(byIdentity.get(NEXT_CALL_GATE).requires_complete_normal_success_population, false);
  assert.equal(byIdentity.get(PUBLIC_CONTINUATION_GATE).requires_complete_normal_success_population, false);

  assert.deepEqual(byIdentity.get(EFFECT_GATE).required_event_families, [
    "tool_call",
    "persistence_receipt",
    "authoritative_ref_observation"
  ]);
  assert.deepEqual(byIdentity.get(RETRY_GATE).required_event_families, ALL_FAMILIES);
  assert.deepEqual(
    byIdentity.get(NEXT_CALL_GATE).unit_states,
    AUTHORING_ERGONOMICS_ADVERTISED_NEXT_CALL_STATES
  );
  assert.deepEqual(
    byIdentity.get(PUBLIC_CONTINUATION_GATE).unit_states,
    AUTHORING_ERGONOMICS_PUBLIC_CONTINUATION_STATES
  );
  assert.deepEqual(AUTHORING_ERGONOMICS_CONFORMANCE_OUTCOMES, [
    "pass",
    "fail",
    "unevaluable_missing_coverage"
  ]);
  assert.equal(AUTHORING_ERGONOMICS_FRESH_SESSION_REJECTED_SUBMISSION_BOUND, 1);
});

test("the evaluator is pure, source-agnostic, and workload-neutral", () => {
  const source = readFileSync(MODULE_PATH, "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  assert.equal(source.includes("node:fs"), false, "the evaluator reads no files of its own");
  assert.equal(/synthetic/i.test(code), false);
  assert.equal(/errors\.log/i.test(code), false);
  assert.equal(/\bsmoke\b/i.test(code), false);

  const imported = [...source.matchAll(/^import[\s\S]*?from\s+"([^"]+)";/gm)].map((match) => match[1]);
  assert.deepEqual(imported, ["./authoring-ergonomics-trace.mjs"]);
});

test("the result is advisory evidence and confers no authority", () => {
  const { result } = gatesOf([claimedEffectCall(0, { receipt_state: "present" })]);

  assert.equal(result.schema_version, AUTHORING_ERGONOMICS_CONFORMANCE_SCHEMA_VERSION);
  assert.equal(AUTHORING_ERGONOMICS_CONFORMANCE_AUTHORITY.kind, "advisory_evidence");
  assert.deepEqual(AUTHORING_ERGONOMICS_CONFORMANCE_AUTHORITY.confers, []);
  assert.deepEqual(result.authority, AUTHORING_ERGONOMICS_CONFORMANCE_AUTHORITY);
  for (const gate of result.gates) {
    assert.deepEqual(gate.authority, AUTHORING_ERGONOMICS_CONFORMANCE_AUTHORITY);
    assert.ok(AUTHORING_ERGONOMICS_CONFORMANCE_OUTCOMES.includes(gate.outcome));
  }

  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.gates), true);
  assert.throws(() => {
    result.gates[0].outcome = "pass";
  }, TypeError);
});

test("evaluation is deterministic and accepts an envelope or a normalized trace", () => {
  const events = [discovery(0), rejectedSubmission(1), claimedEffectCall(2, { receipt_state: "present" })];
  const first = evaluateAuthoringErgonomicsConformance(envelope(events));
  const second = evaluateAuthoringErgonomicsConformance(envelope(events));
  assert.deepEqual(first, second);

  const normalized = JSON.parse(JSON.stringify(first));
  assert.equal(normalized.gates.length, 4);
  assert.deepEqual(
    first.gates.map((gate) => gate.identity),
    AUTHORING_ERGONOMICS_CONFORMANCE_IDENTITIES
  );
});

test("a detector report and a non-object input are refused rather than silently coerced", () => {
  const report = { schema_version: "authoring-ergonomics-report.v1" };
  assert.throws(
    () => evaluateAuthoringErgonomicsConformance(report),
    (error) =>
      error instanceof AuthoringErgonomicsConformanceError && error.code === "unsupported_input"
  );
  for (const input of [null, undefined, "trace", 7, []]) {
    assert.throws(
      () => evaluateAuthoringErgonomicsConformance(input),
      (error) =>
        error instanceof AuthoringErgonomicsConformanceError && error.code === "unsupported_input"
    );
  }
});

test("the normal-success gate passes only when every claimed effect was verified", () => {
  const { gate } = gatesOf([
    claimedEffectCall(0, { receipt_state: "present" }),
    claimedEffectCall(1, {
      observed_effects: [
        {
          effect_kind: "carrier_generation_persisted",
          effect_target: "CS-INLINE",
          observation_provenance: "authoritative_observed"
        }
      ]
    })
  ]);

  const effect = gate(EFFECT_GATE);
  assert.equal(effect.outcome, "pass");
  assert.equal(effect.reason_code, AUTHORING_ERGONOMICS_CONFORMANCE_REASON_CODES.satisfied);
  assert.equal(effect.eligible_population.denominator, 2);
  assert.equal(effect.unit_state_counts.verified, 2);
  assert.equal(effect.unit_state_counts.unverified, 0);
  assert.deepEqual(effect.violations, []);
});

test("the normal-success gate fails on a normal success with no verified authoritative effect", () => {
  const { gate } = gatesOf([
    claimedEffectCall(0, { receipt_state: "present" }),
    claimedEffectCall(1, { receipt_state: "absent", observed_effects: [] })
  ]);

  const effect = gate(EFFECT_GATE);
  assert.equal(effect.outcome, "fail");
  assert.equal(effect.reason_code, AUTHORING_ERGONOMICS_CONFORMANCE_REASON_CODES.violation_observed);

  assert.equal(effect.eligible_population.denominator, 2);
  assert.equal(effect.violations.length, 1);
  assert.deepEqual(effect.violations[0].event_orders, [1]);
  assert.equal(effect.violations[0].receipt_state, "absent");
  assert.deepEqual(effect.violations[0].authoritative_observed_effects, []);
});

test("an accepted status with a claimed effect is inside the normal-success population", () => {
  const { gate } = gatesOf([
    claimedEffectCall(0, {
      response: { transport_status: "ok", application_status: "accepted" },
      receipt_state: "absent",
      observed_effects: []
    })
  ]);
  const effect = gate(EFFECT_GATE);
  assert.equal(effect.outcome, "fail");
  assert.equal(effect.violations[0].application_status, "accepted");
});

test("unobserved verification evidence blocks a pass instead of counting as verified", () => {

  const { gate } = gatesOf([claimedEffectCall(0)]);

  const effect = gate(EFFECT_GATE);
  assert.equal(effect.outcome, "unevaluable_missing_coverage");
  assert.equal(
    effect.reason_code,
    AUTHORING_ERGONOMICS_CONFORMANCE_REASON_CODES.unknown_evidence_blocks_pass
  );
  assert.equal(effect.unit_state_counts.missing_coverage, 1);
  assert.equal(effect.unit_state_counts.verified, 0);
  assert.equal(effect.unknown_evidence.length, 1);
  assert.equal(effect.unknown_evidence[0].kind, "unobserved_effect_verification");
});

test("an observed violation is decisive even when other evidence is unknown", () => {
  const { gate } = gatesOf([
    claimedEffectCall(0, { receipt_state: "absent", observed_effects: [] }),
    claimedEffectCall(1)
  ]);

  const effect = gate(EFFECT_GATE);
  assert.equal(effect.outcome, "fail");
  assert.equal(effect.eligible_population.denominator, 2);
  assert.equal(effect.unit_state_counts.missing_coverage, 1);
});

test("an empty normal-success population is ineligible, never a vacuous pass", () => {
  const { gate } = gatesOf([discovery(0), rejectedSubmission(1)]);

  const effect = gate(EFFECT_GATE);
  assert.equal(effect.outcome, "unevaluable_missing_coverage");
  assert.equal(
    effect.reason_code,
    AUTHORING_ERGONOMICS_CONFORMANCE_REASON_CODES.eligible_population_empty
  );
  assert.equal(effect.eligible_population.denominator, 0);
});

test("failure-only evidence cannot green the normal-success gate", () => {

  const events = [claimedEffectCall(0, { receipt_state: "present" })];
  assert.equal(gatesOf(events).gate(EFFECT_GATE).outcome, "pass");

  const { gate } = gatesOf(events, failureOnlyCoverage());
  const effect = gate(EFFECT_GATE);
  assert.equal(effect.outcome, "unevaluable_missing_coverage");
  assert.equal(
    effect.reason_code,
    AUTHORING_ERGONOMICS_CONFORMANCE_REASON_CODES.population_class_failure_only
  );

  assert.equal(effect.eligible_population.denominator, null);
  assert.equal(effect.unit_state_counts, null);
  assert.equal(effect.violations, null);
  assert.equal(effect.unknown_evidence, null);
});

test("failure-only evidence yields no verdict in either direction", () => {

  const { gate } = gatesOf(
    [claimedEffectCall(0, { receipt_state: "absent", observed_effects: [] })],
    failureOnlyCoverage()
  );
  const effect = gate(EFFECT_GATE);
  assert.equal(effect.outcome, "unevaluable_missing_coverage");
  assert.notEqual(effect.outcome, "fail");
});

test("an unknown population class and an undeclared family are both unevaluable", () => {
  const events = [claimedEffectCall(0, { receipt_state: "present" })];

  const unknownClass = gatesOf(
    events,
    coverage({ population_class: "unknown", normal_success_population_complete: null })
  ).gate(EFFECT_GATE);
  assert.equal(unknownClass.outcome, "unevaluable_missing_coverage");
  assert.equal(
    unknownClass.reason_code,
    AUTHORING_ERGONOMICS_CONFORMANCE_REASON_CODES.population_class_unknown
  );

  const undeclared = gatesOf(events, [
    {
      workload: "inline",
      event_families: ["tool_call"],
      population_class: "normal_and_failure",
      normal_success_population_complete: true
    }
  ]).gate(EFFECT_GATE);
  assert.equal(undeclared.outcome, "unevaluable_missing_coverage");
  assert.equal(
    undeclared.reason_code,
    AUTHORING_ERGONOMICS_CONFORMANCE_REASON_CODES.coverage_declaration_absent
  );
  assert.deepEqual(undeclared.eligible_population.undeclared_event_families, [
    "persistence_receipt",
    "authoritative_ref_observation"
  ]);
});

test("an incomplete or undeclared normal-success population is unevaluable", () => {
  const events = [claimedEffectCall(0, { receipt_state: "present" })];

  const incomplete = gatesOf(events, coverage({ normal_success_population_complete: false })).gate(
    EFFECT_GATE
  );
  assert.equal(incomplete.outcome, "unevaluable_missing_coverage");
  assert.equal(
    incomplete.reason_code,
    AUTHORING_ERGONOMICS_CONFORMANCE_REASON_CODES.normal_success_population_incomplete
  );

  const undeclaredCompleteness = gatesOf(
    events,
    coverage({ normal_success_population_complete: null })
  ).gate(EFFECT_GATE);
  assert.equal(undeclaredCompleteness.outcome, "unevaluable_missing_coverage");
  assert.equal(
    undeclaredCompleteness.reason_code,
    AUTHORING_ERGONOMICS_CONFORMANCE_REASON_CODES.normal_success_population_incomplete
  );
  assert.equal(undeclaredCompleteness.eligible_population.normal_success_population_complete, null);
});

const CONTINUATION_SPECTRUM = [
  continuationEvent(0, NO_ROUTE),
  continuationEvent(1, ROUTE_WITHOUT_CALL),
  continuationEvent(2, TEMPLATE_WITHOUT_CALL),
  continuationEvent(3, NAMED_TOOL_UNAVAILABLE),
  continuationEvent(4, REPLACEMENT_CALL_REJECTED),
  continuationEvent(5, STRUCTURAL_ONLY_WITH_CALL),
  continuationEvent(6, INGRESS_AVAILABILITY_UNKNOWN),
  continuationEvent(7, EXECUTABLE)
];

test("the advertised-next-call gate separates absent, rejected, executable, and missing coverage", () => {
  const { gate } = gatesOf(CONTINUATION_SPECTRUM);
  const nextCall = gate(NEXT_CALL_GATE);

  assert.equal(nextCall.outcome, "fail");
  assert.deepEqual(nextCall.unit_state_counts, {
    absent: 2,
    rejected: 4,
    executable: 1,
    missing_coverage: 1
  });

  assert.equal(nextCall.eligible_population.denominator, 6);
  assert.equal(nextCall.detail.absent_continuations_excluded_from_denominator, 2);
  assert.deepEqual(
    nextCall.violations.map((violation) => violation.discriminator),
    [
      "structural_template_without_replacement_call",
      "named_tool_unavailable",
      "replacement_call_rejected",
      "structural_only_no_completion_route"
    ]
  );
  assert.deepEqual(
    nextCall.violations.map((violation) => violation.event_orders[0]),
    [2, 3, 4, 5]
  );
});

test("a structural-only template with no replacement call cannot green the advertised-next-call gate", () => {

  const report = detectAuthoringErgonomicsFindings(envelope([continuationEvent(0, TEMPLATE_WITHOUT_CALL)]));
  const erg003 = report.observations.filter((observation) => observation.observation_id === "ERG-003");
  assert.equal(erg003.length, 1);
  assert.equal(erg003[0].outcome, "structural_template_only");
  assert.equal(erg003[0].finding, true);

  const { gate } = gatesOf([continuationEvent(0, TEMPLATE_WITHOUT_CALL)]);
  const nextCall = gate(NEXT_CALL_GATE);
  assert.equal(nextCall.outcome, "fail");
  assert.notEqual(nextCall.outcome, "pass");
  assert.equal(nextCall.reason_code, AUTHORING_ERGONOMICS_CONFORMANCE_REASON_CODES.violation_observed);
  assert.equal(nextCall.eligible_population.denominator, 1);
  assert.deepEqual(nextCall.unit_state_counts, {
    absent: 0,
    rejected: 1,
    executable: 0,
    missing_coverage: 0
  });
  assert.equal(nextCall.violations[0].discriminator, "structural_template_without_replacement_call");
  assert.equal(nextCall.violations[0].state, "rejected");

  assert.equal(gate(PUBLIC_CONTINUATION_GATE).detail.continuations_without_named_public_ingress, 1);
});

test("the advertised-next-call gate passes only on an executable advertised call", () => {
  const { gate } = gatesOf([continuationEvent(0, EXECUTABLE)]);
  const nextCall = gate(NEXT_CALL_GATE);
  assert.equal(nextCall.outcome, "pass");
  assert.equal(nextCall.eligible_population.denominator, 1);
  assert.equal(nextCall.unit_state_counts.executable, 1);
});

test("an unknown ingress availability blocks the advertised-next-call gate from passing", () => {
  const { gate } = gatesOf([continuationEvent(0, INGRESS_AVAILABILITY_UNKNOWN)]);
  const nextCall = gate(NEXT_CALL_GATE);
  assert.equal(nextCall.outcome, "unevaluable_missing_coverage");
  assert.equal(
    nextCall.reason_code,
    AUTHORING_ERGONOMICS_CONFORMANCE_REASON_CODES.unknown_evidence_blocks_pass
  );
  assert.equal(nextCall.unknown_evidence[0].kind, "unobserved_ingress_availability");
});

test("advertising no replacement call at all is an empty population, not a pass", () => {
  const { gate } = gatesOf([continuationEvent(0, NO_ROUTE), continuationEvent(1, ROUTE_WITHOUT_CALL)]);
  const nextCall = gate(NEXT_CALL_GATE);
  assert.equal(nextCall.outcome, "unevaluable_missing_coverage");
  assert.equal(
    nextCall.reason_code,
    AUTHORING_ERGONOMICS_CONFORMANCE_REASON_CODES.eligible_population_empty
  );
  assert.equal(nextCall.eligible_population.denominator, 0);
  assert.equal(nextCall.unit_state_counts.absent, 2);
});

test("the continuation gates are unevaluable without a continuation coverage declaration", () => {
  const { gate } = gatesOf(CONTINUATION_SPECTRUM, [
    {
      workload: "inline",
      event_families: ["tool_call"],
      population_class: "normal_and_failure",
      normal_success_population_complete: true
    }
  ]);
  for (const identity of [NEXT_CALL_GATE, PUBLIC_CONTINUATION_GATE]) {
    const evaluated = gate(identity);
    assert.equal(evaluated.outcome, "unevaluable_missing_coverage");
    assert.equal(
      evaluated.reason_code,
      AUTHORING_ERGONOMICS_CONFORMANCE_REASON_CODES.coverage_declaration_absent
    );
    assert.deepEqual(evaluated.eligible_population.undeclared_event_families, ["continuation"]);
  }
});

test("failure-only evidence cannot green the continuation gates either", () => {
  const executableOnly = [continuationEvent(0, EXECUTABLE)];
  assert.equal(gatesOf(executableOnly).gate(NEXT_CALL_GATE).outcome, "pass");
  assert.equal(gatesOf(executableOnly).gate(PUBLIC_CONTINUATION_GATE).outcome, "pass");

  const { gate } = gatesOf(executableOnly, failureOnlyCoverage());
  for (const identity of [NEXT_CALL_GATE, PUBLIC_CONTINUATION_GATE]) {
    assert.equal(gate(identity).outcome, "unevaluable_missing_coverage");
    assert.equal(
      gate(identity).reason_code,
      AUTHORING_ERGONOMICS_CONFORMANCE_REASON_CODES.population_class_failure_only
    );
  }
});

test("the public-continuation gate separates absent, unreachable, executable, and missing coverage", () => {
  const { gate } = gatesOf(CONTINUATION_SPECTRUM);
  const publicContinuation = gate(PUBLIC_CONTINUATION_GATE);

  assert.equal(publicContinuation.outcome, "fail");
  assert.deepEqual(publicContinuation.unit_state_counts, {
    absent: 1,
    unreachable_rejected: 1,
    executable: 2,
    missing_coverage: 1
  });
  assert.equal(publicContinuation.eligible_population.denominator, 5);

  assert.equal(publicContinuation.detail.continuations_without_named_public_ingress, 3);
  assert.deepEqual(
    publicContinuation.violations.map((violation) => violation.discriminator),
    ["identity_absent_at_ingress", "rejected_at_live_ingress"]
  );
  assert.deepEqual(
    publicContinuation.violations.map((violation) => violation.event_orders[0]),
    [3, 4]
  );
});

test("a structural-only template present at its ingress is a next-call defect, not an unreachable identity", () => {
  const { gate } = gatesOf([continuationEvent(0, STRUCTURAL_ONLY_WITH_CALL)]);

  assert.equal(gate(NEXT_CALL_GATE).outcome, "fail");
  assert.equal(gate(NEXT_CALL_GATE).violations[0].discriminator, "structural_only_no_completion_route");
  assert.equal(gate(PUBLIC_CONTINUATION_GATE).outcome, "pass");
  assert.equal(gate(PUBLIC_CONTINUATION_GATE).unit_state_counts.executable, 1);
});

test("a continuation with no named public ingress is outside the public-continuation population", () => {
  const { gate } = gatesOf([continuationEvent(0, EXECUTABLE_WITHOUT_NAMED_INGRESS)]);

  assert.equal(gate(NEXT_CALL_GATE).outcome, "pass");
  const publicContinuation = gate(PUBLIC_CONTINUATION_GATE);
  assert.equal(publicContinuation.outcome, "unevaluable_missing_coverage");
  assert.equal(
    publicContinuation.reason_code,
    AUTHORING_ERGONOMICS_CONFORMANCE_REASON_CODES.eligible_population_empty
  );
  assert.equal(publicContinuation.detail.continuations_without_named_public_ingress, 1);
});

test("an unknown live-ingress reachability blocks the public-continuation gate from passing", () => {
  const { gate } = gatesOf([
    continuationEvent(0, EXECUTABLE),
    continuationEvent(1, INGRESS_AVAILABILITY_UNKNOWN)
  ]);
  const publicContinuation = gate(PUBLIC_CONTINUATION_GATE);
  assert.equal(publicContinuation.outcome, "unevaluable_missing_coverage");
  assert.equal(
    publicContinuation.reason_code,
    AUTHORING_ERGONOMICS_CONFORMANCE_REASON_CODES.unknown_evidence_blocks_pass
  );
  assert.equal(publicContinuation.eligible_population.denominator, 2);
  assert.equal(publicContinuation.unknown_evidence[0].kind, "unobserved_public_ingress_reachability");
});

test("one rejected submission after the operation-ready discovery response is within the bound", () => {
  const { gate } = gatesOf([discovery(0), rejectedSubmission(1)]);
  const retry = gate(RETRY_GATE);

  assert.equal(retry.outcome, "pass");
  assert.equal(retry.eligible_population.denominator, 1);
  assert.equal(retry.detail.sessions[0].rejected_submission_count, 1);
  assert.equal(retry.detail.sessions[0].discovery_event_order, 0);
  assert.equal(retry.detail.sessions[0].terminator_event_order, null);
  assert.equal(retry.detail.sessions[0].discriminator, "window_open_at_trace_end");
});

test("more than one rejected submission in the window fails the retry bound", () => {
  const { gate } = gatesOf([discovery(0), rejectedSubmission(1), rejectedSubmission(2)]);
  const retry = gate(RETRY_GATE);

  assert.equal(retry.outcome, "fail");
  assert.equal(retry.violations.length, 1);
  assert.equal(retry.violations[0].rejected_submission_count, 2);
  assert.deepEqual(retry.violations[0].rejected_submission_orders, [1, 2]);
  assert.equal(retry.violations[0].bound, 1);
  assert.equal(retry.unit_state_counts.exceeded, 1);
});

test("a verified effect closes the retry window", () => {

  const { gate } = gatesOf([
    discovery(0),
    rejectedSubmission(1),
    claimedEffectCall(2, { receipt_state: "present" }),
    rejectedSubmission(3),
    rejectedSubmission(4)
  ]);
  const retry = gate(RETRY_GATE);

  assert.equal(retry.outcome, "pass");
  assert.equal(retry.detail.sessions[0].terminator_event_order, 2);
  assert.equal(retry.detail.sessions[0].terminator_kind, "verified_effect");
  assert.deepEqual(retry.detail.sessions[0].window_event_orders, [1]);
});

test("an executable continuation closes the retry window", () => {
  const { gate } = gatesOf([
    discovery(0),
    rejectedSubmission(1),
    continuationEvent(2, EXECUTABLE),
    rejectedSubmission(3),
    rejectedSubmission(4)
  ]);
  const retry = gate(RETRY_GATE);

  assert.equal(retry.outcome, "pass");
  assert.equal(retry.detail.sessions[0].terminator_event_order, 2);
  assert.equal(retry.detail.sessions[0].terminator_kind, "executable_continuation");
});

test("a non-executable continuation does not close the retry window", () => {
  const { gate } = gatesOf([
    discovery(0),
    rejectedSubmission(1),
    continuationEvent(2, REPLACEMENT_CALL_REJECTED),
    rejectedSubmission(3)
  ]);
  const retry = gate(RETRY_GATE);

  assert.equal(retry.outcome, "fail");
  assert.equal(retry.violations[0].rejected_submission_count, 2);
});

test("a diagnostic call is not an authoring submission", () => {
  const { gate } = gatesOf([
    discovery(0),
    rejectedSubmission(1),
    rejectedSubmission(2, {
      request: { request_id: "REQ-2", tool: "inline.query", diagnostic: true }
    })
  ]);
  const retry = gate(RETRY_GATE);

  assert.equal(retry.outcome, "pass");
  assert.deepEqual(retry.detail.sessions[0].rejected_submission_orders, [1]);
});

test("rejections before the initial operation-ready discovery response are outside the window", () => {
  const { gate } = gatesOf([rejectedSubmission(0), rejectedSubmission(1), discovery(2), rejectedSubmission(3)]);
  const retry = gate(RETRY_GATE);

  assert.equal(retry.outcome, "pass");
  assert.equal(retry.detail.sessions[0].discovery_event_order, 2);
  assert.deepEqual(retry.detail.sessions[0].rejected_submission_orders, [3]);
});

test("a rejected discovery response does not open a retry window", () => {
  const { gate } = gatesOf([
    discovery(0, { response: { transport_status: "ok", application_status: "rejected" } }),
    rejectedSubmission(1),
    rejectedSubmission(2)
  ]);
  const retry = gate(RETRY_GATE);

  assert.equal(retry.outcome, "unevaluable_missing_coverage");
  assert.equal(
    retry.reason_code,
    AUTHORING_ERGONOMICS_CONFORMANCE_REASON_CODES.eligible_population_empty
  );
  assert.equal(retry.unit_state_counts.ineligible, 1);
  assert.equal(retry.detail.sessions[0].discriminator, "no_operation_ready_discovery_response_observed");
});

test("the bound is evaluated per session and ineligible sessions stay out of the denominator", () => {
  const { gate } = gatesOf([
    discovery(0),
    rejectedSubmission(1),
    rejectedSubmission(2, { workflow_token: "WF-2" }),
    rejectedSubmission(3, { workflow_token: "WF-2" }),
    discovery(4, { workflow_token: "WF-3" }),
    rejectedSubmission(5, { workflow_token: "WF-3" }),
    rejectedSubmission(6, { workflow_token: "WF-3" })
  ]);
  const retry = gate(RETRY_GATE);

  assert.equal(retry.outcome, "fail");
  assert.equal(retry.eligible_population.denominator, 2);
  assert.equal(retry.unit_state_counts.ineligible, 1);
  assert.deepEqual(
    retry.violations.map((violation) => violation.workflow_token),
    ["WF-3"]
  );
});

test("an unattributable event blocks the retry bound from passing", () => {
  const { gate } = gatesOf([discovery(0), rejectedSubmission(1), rejectedSubmission(2, { workflow_token: null })]);
  const retry = gate(RETRY_GATE);

  assert.equal(retry.outcome, "unevaluable_missing_coverage");
  assert.equal(
    retry.reason_code,
    AUTHORING_ERGONOMICS_CONFORMANCE_REASON_CODES.unknown_evidence_blocks_pass
  );
  assert.equal(retry.unknown_evidence[0].kind, "unknown_workflow_token");
});

test("a submission with no observed response leaves the retry bound uncertain", () => {
  const { gate } = gatesOf([discovery(0), rejectedSubmission(1, { response: null })]);
  const retry = gate(RETRY_GATE);

  assert.equal(retry.outcome, "unevaluable_missing_coverage");
  assert.equal(retry.unknown_evidence[0].kind, "unobserved_submission_response");
});

test("an unknown application status is not read as a non-rejected submission", () => {

  const { gate } = gatesOf([
    discovery(0),
    rejectedSubmission(1, {
      response: { transport_status: "ok", application_status: "unknown" }
    }),
    rejectedSubmission(2, {
      response: { transport_status: "ok", application_status: "unknown" }
    })
  ]);
  const retry = gate(RETRY_GATE);

  assert.equal(retry.outcome, "unevaluable_missing_coverage");
  assert.notEqual(retry.outcome, "pass");
  assert.equal(
    retry.reason_code,
    AUTHORING_ERGONOMICS_CONFORMANCE_REASON_CODES.unknown_evidence_blocks_pass
  );
  assert.equal(retry.unknown_evidence.length, 2);
  assert.deepEqual(
    retry.unknown_evidence.map((entry) => entry.kind),
    ["unobserved_submission_outcome", "unobserved_submission_outcome"]
  );
  assert.deepEqual(
    retry.unknown_evidence.map((entry) => entry.subject),
    ["event_order:1", "event_order:2"]
  );
});

test("a transport error leaves the submission outcome unobserved", () => {
  const { gate } = gatesOf([
    discovery(0),
    rejectedSubmission(1, {
      response: { transport_status: "error", application_status: "normal" }
    })
  ]);
  const retry = gate(RETRY_GATE);

  assert.equal(retry.outcome, "unevaluable_missing_coverage");
  assert.notEqual(retry.outcome, "pass");
  assert.equal(
    retry.reason_code,
    AUTHORING_ERGONOMICS_CONFORMANCE_REASON_CODES.unknown_evidence_blocks_pass
  );
  assert.equal(retry.unknown_evidence.length, 1);
  assert.equal(retry.unknown_evidence[0].kind, "unobserved_submission_outcome");
});

test("an observed violation still outranks an unobserved submission outcome", () => {

  const { gate } = gatesOf([
    discovery(0),
    rejectedSubmission(1),
    rejectedSubmission(2),
    rejectedSubmission(3, {
      response: { transport_status: "ok", application_status: "unknown" }
    })
  ]);
  const retry = gate(RETRY_GATE);

  assert.equal(retry.outcome, "fail");
  assert.equal(retry.violations[0].rejected_submission_count, 2);
  assert.equal(retry.unknown_evidence.length, 1);
});

test("a diagnostic call with an unobserved outcome is not deciding evidence", () => {

  const { gate } = gatesOf([
    discovery(0),
    rejectedSubmission(1),
    rejectedSubmission(2, {
      request: { request_id: "REQ-2", tool: "inline.query", diagnostic: true },
      response: { transport_status: "error", application_status: "unknown" }
    })
  ]);
  const retry = gate(RETRY_GATE);

  assert.equal(retry.outcome, "pass");
  assert.deepEqual(retry.unknown_evidence, []);
  assert.deepEqual(retry.detail.sessions[0].rejected_submission_orders, [1]);
  assert.equal(retry.detail.sessions[0].bound, AUTHORING_ERGONOMICS_FRESH_SESSION_REJECTED_SUBMISSION_BOUND);
});

test("failure-only evidence cannot green or condemn the retry bound", () => {
  const events = [discovery(0), rejectedSubmission(1), rejectedSubmission(2)];
  assert.equal(gatesOf(events).gate(RETRY_GATE).outcome, "fail");

  const retry = gatesOf(events, failureOnlyCoverage()).gate(RETRY_GATE);
  assert.equal(retry.outcome, "unevaluable_missing_coverage");
  assert.equal(
    retry.reason_code,
    AUTHORING_ERGONOMICS_CONFORMANCE_REASON_CODES.population_class_failure_only
  );
  assert.equal(retry.eligible_population.denominator, null);
});

test("outcome counts separate evaluated gates from unevaluated ones", () => {
  const { result } = gatesOf([
    discovery(0),
    rejectedSubmission(1),
    claimedEffectCall(2, { receipt_state: "present" }),
    continuationEvent(3, EXECUTABLE)
  ]);

  assert.equal(result.outcome_counts.pass + result.outcome_counts.fail, result.evaluated_gate_count);
  assert.equal(
    result.outcome_counts.pass +
      result.outcome_counts.fail +
      result.outcome_counts.unevaluable_missing_coverage,
    4
  );
  assert.deepEqual(result.identities, AUTHORING_ERGONOMICS_CONFORMANCE_IDENTITIES);
});

test("[claim-semantic-recovery-covers] the existing four gates carry meaningful-operation and measured-byte bounds", () => {
  const measured = evaluateAuthoringErgonomicsConformance(
    envelope([
      rejectedSubmission(0, {
        response: {
          transport_status: "ok",
          application_status: "rejected",
          reason_codes: ["inline_rejected"],
          response_bytes: 400
        }
      }),
      claimedEffectCall(1, {
        receipt_state: "present",
        response: {
          transport_status: "ok",
          application_status: "normal",
          response_bytes: 200
        }
      }),
      rejectedSubmission(2, {
        request: { request_id: "REQ-2", tool: "inline.query", diagnostic: true },
        response: {
          transport_status: "ok",
          application_status: "rejected",
          response_bytes: 900
        }
      })
    ])
  );

  assert.equal(measured.identities.length, 4);
  assert.equal(measured.gates.length, 4);
  for (const gate of measured.gates) {
    assert.equal(gate.evidence_bounds.meaningful_operations.value, 2);
    assert.deepEqual(gate.evidence_bounds.meaningful_operations.event_orders, [0, 1]);
    assert.equal(gate.evidence_bounds.response_bytes.value, 600);
    assert.equal(gate.evidence_bounds.response_bytes.evidence_state, "producer_measured");
    assert.equal(gate.evidence_bounds.response_bytes.measured_operation_count, 2);
    assert.equal(gate.evidence_bounds.response_bytes.unmeasured_operation_count, 0);
    assert.deepEqual(Object.keys(gate.evidence_bounds).sort(), [
      "meaningful_operations",
      "response_bytes"
    ]);
  }

  const unmeasured = evaluateAuthoringErgonomicsConformance(
    envelope([
      rejectedSubmission(0, {
        response: {
          transport_status: "ok",
          application_status: "rejected",
          response_bytes: 400
        }
      }),
      claimedEffectCall(1, { receipt_state: "present" })
    ])
  );
  for (const gate of unmeasured.gates) {
    assert.equal(gate.evidence_bounds.response_bytes.value, null, "partial measurement is unavailable, not zero");
    assert.equal(gate.evidence_bounds.response_bytes.evidence_state, "unavailable");
    assert.equal(gate.evidence_bounds.response_bytes.measured_operation_count, 1);
    assert.equal(gate.evidence_bounds.response_bytes.unmeasured_operation_count, 1);
  }

  assert.equal(JSON.stringify(measured.gates).includes("prompt"), false);
  assert.equal(JSON.stringify(measured.gates).includes("run_identity"), false);
  assert.equal(measured.gates.some((gate) => gate.identity.includes("response-byte")), false);
});

test("an entirely failure-only source evaluates nothing at all", () => {
  const { result } = gatesOf(
    [discovery(0), rejectedSubmission(1), rejectedSubmission(2), continuationEvent(3, REPLACEMENT_CALL_REJECTED)],
    failureOnlyCoverage()
  );

  assert.equal(result.evaluated_gate_count, 0);
  assert.equal(result.outcome_counts.unevaluable_missing_coverage, 4);
  assert.equal(result.outcome_counts.pass, 0);
  for (const gate of result.gates) {
    assert.equal(gate.eligible_population.denominator, null);
    assert.equal(gate.unit_state_counts, null);
  }
});
