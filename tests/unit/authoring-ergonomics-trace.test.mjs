

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AUTHORING_ERGONOMICS_AXES,
  AUTHORING_ERGONOMICS_DETECTOR_IDS,
  AUTHORING_ERGONOMICS_METRIC_NAMES,
  AUTHORING_ERGONOMICS_NORMALIZED_SCHEMA_VERSION,
  AUTHORING_ERGONOMICS_RECOVERY_IDENTITY_COMPONENTS,
  AUTHORING_ERGONOMICS_REPORT_SCHEMA_VERSION,
  AUTHORING_ERGONOMICS_TRACE_SCHEMA_VERSION,
  AuthoringErgonomicsTraceError,
  buildAuthoringErgonomicsEpisodes,
  classifyAuthoringRecoveryPair,
  detectAuthoringErgonomicsFindings,
  normalizeAuthoringErgonomicsTrace
} from "../../packages/wiki-core/src/lib/authoring-ergonomics-trace.mjs";

const THIS_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FIXTURE_DIR = path.join(THIS_DIR, "fixtures/authoring-ergonomics");
const MODULE_PATH = path.join(
  THIS_DIR,
  "../packages/wiki-core/src/lib/authoring-ergonomics-trace.mjs"
);

function loadFixture(name) {
  return JSON.parse(readFileSync(path.join(FIXTURE_DIR, `${name}.json`), "utf8"));
}

function reportFor(name) {
  return detectAuthoringErgonomicsFindings(loadFixture(name));
}

function metric(report, name) {
  const entry = report.metrics.find((candidate) => candidate.metric === name);
  assert.ok(entry, `metric ${name} must be reported`);
  return entry;
}

function findings(report) {
  return report.observations.filter((observation) => observation.finding);
}

function clusterFor(report, axis) {
  return report.clusters.filter((cluster) => cluster.axis === axis);
}

function baseTrace(events, declarations) {
  return {
    schema_version: AUTHORING_ERGONOMICS_TRACE_SCHEMA_VERSION,
    trace_id: "INLINE",
    source: {
      source_kind: "inline_test",
      source_locator: "inline://authoring-ergonomics",
      source_ordinal: 0
    },
    coverage: {
      declarations: declarations ?? [
        {
          workload: "inline",
          event_families: ["tool_discovery", "tool_call"],
          population_class: "failure_only",
          normal_success_population_complete: false
        }
      ]
    },
    events
  };
}

const CARRIER_BOUNDARY = {
  boundary_kind: "mcp_tool",
  boundary_id: "inline.boundary",
  producer_family: "inline_family"
};
const CARRIER_TARGET = { target_kind: "carrier_set", target_id: "CS-INLINE" };
const GEN_1 = {
  identity_kind: "carrier_generation",
  identity_value: "GEN-1",
  descriptor_digest: "sha256:gen-1"
};
const GEN_2 = {
  identity_kind: "carrier_generation",
  identity_value: "GEN-2",
  descriptor_digest: "sha256:gen-2"
};

function rejectedCall(eventIndex, overrides = {}) {
  return {
    event_index: eventIndex,
    event_kind: "tool_call",
    actor_kind: "consumer",
    workflow_token: "WF-INLINE",
    producer_boundary: CARRIER_BOUNDARY,
    target_identity: CARRIER_TARGET,
    authoritative_input_identity: GEN_1,
    request: { request_id: `REQ-${eventIndex}`, tool: "inline.submit", diagnostic: false },
    response: {
      response_id: `RES-${eventIndex}`,
      transport_status: "ok",
      application_status: "rejected",
      reason_codes: ["inline_rejected"],
      invariant_family: "inline_family_invariant"
    },
    ...overrides
  };
}

test("the module declares the complete D3 detector, axis, and metric vocabulary", () => {
  assert.deepEqual(AUTHORING_ERGONOMICS_DETECTOR_IDS, [
    "ERG-001",
    "ERG-002",
    "ERG-003",
    "ERG-004",
    "ERG-005",
    "ERG-006",
    "ERG-007",
    "ERG-008",
    "ERG-009",
    "ERG-010",
    "ERG-011"
  ]);
  assert.deepEqual(AUTHORING_ERGONOMICS_AXES, [
    "producer",
    "consumer",
    "record_quality",
    "persistence_lifecycle",
    "public_consumer",
    "workload"
  ]);
  assert.deepEqual(AUTHORING_ERGONOMICS_METRIC_NAMES, [
    "workflow_count",
    "episode_count",
    "tool_call_count",
    "refusal_count",
    "unrecovered_authoring_failure_count",
    "repeated_refusal_episode_count",
    "unique_invariant_count",
    "source_inspection_escape_count",
    "unusable_continuation_count",
    "unverified_effect_response_count",
    "stage_transition_regression_count",
    "paid_dispatch_reached_count",
    "authoritative_effect_observed_count"
  ]);
});

test("the substrate stays workload-neutral and source-agnostic", () => {
  const source = readFileSync(MODULE_PATH, "utf8");

  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  assert.equal(/synthetic/i.test(code), false);
  assert.equal(/errors\.log/i.test(code), false);
  assert.equal(/\bsmoke\b/i.test(code), false);
  assert.equal(source.includes("node:fs"), false, "the module reads no files of its own");
});

test("normalization rejects a foreign schema version, unknown fields, and unknown enum values", () => {
  assert.throws(
    () => normalizeAuthoringErgonomicsTrace({ ...baseTrace([]), schema_version: "authoring-ergonomics-trace.v2" }),
    (error) => error instanceof AuthoringErgonomicsTraceError && error.code === "unsupported_schema_version"
  );

  assert.throws(
    () => normalizeAuthoringErgonomicsTrace({ ...baseTrace([]), retained_artifact_root: "/tmp/run" }),
    (error) => error.code === "unknown_field" && error.path === "trace.retained_artifact_root"
  );

  assert.throws(
    () =>
      normalizeAuthoringErgonomicsTrace(
        baseTrace([{ event_index: 0, event_kind: "tool_call", actor_kind: "consumer", raw_prompt: "..." }])
      ),
    (error) => error.code === "unknown_field" && error.path === "trace.events[0].raw_prompt"
  );

  assert.throws(
    () =>
      normalizeAuthoringErgonomicsTrace(
        baseTrace([{ event_index: 0, event_kind: "speculative_guess", actor_kind: "consumer" }])
      ),
    (error) => error.code === "invalid_enum"
  );

  assert.throws(
    () =>
      normalizeAuthoringErgonomicsTrace(
        baseTrace([
          {
            event_index: 0,
            event_kind: "tool_call",
            actor_kind: "consumer",
            authoritative_input_identity: { identity_kind: "caller_label", identity_value: "mine" }
          }
        ])
      ),
    (error) => error.code === "invalid_enum" && error.path.endsWith("identity_kind")
  );
});

test("normalization rejects duplicate source positions and duplicate coverage declarations", () => {
  assert.throws(
    () =>
      normalizeAuthoringErgonomicsTrace(
        baseTrace([
          { event_index: 0, event_kind: "tool_call", actor_kind: "consumer" },
          { event_index: 0, event_kind: "tool_call", actor_kind: "consumer" }
        ])
      ),
    (error) => error.code === "duplicate_source_position"
  );

  assert.throws(
    () =>
      normalizeAuthoringErgonomicsTrace(
        baseTrace([], [
          {
            event_families: ["tool_call"],
            population_class: "failure_only",
            normal_success_population_complete: false
          },
          {
            event_families: ["tool_call"],
            population_class: "normal_and_failure",
            normal_success_population_complete: true
          }
        ])
      ),
    (error) => error.code === "duplicate_coverage_declaration"
  );
});

test("an absent list stays unknown and an empty list stays observed-none", () => {
  const normalized = normalizeAuthoringErgonomicsTrace(
    baseTrace([
      {
        event_index: 0,
        event_kind: "tool_call",
        actor_kind: "consumer",
        response: {
          transport_status: "ok",
          application_status: "normal",
          reason_codes: []
        },
        claimed_effects: [{ effect_kind: "inline_effect", effect_target: "T" }]
      }
    ])
  );
  const event = normalized.events[0];
  assert.deepEqual(event.response.reason_codes, [], "an explicit empty list is observed-none");
  assert.equal(event.observed_effects, null, "an absent list is unknown, not an empty observation");
  assert.equal(event.receipt, null, "an absent receipt is unknown, not an absent receipt");
  assert.equal(event.workflow_token, null);
});

test("normalized events preserve optional recovery identity and producer-measured response bytes", () => {
  const normalized = normalizeAuthoringErgonomicsTrace(
    baseTrace([
      rejectedCall(0, {
        response: {
          transport_status: "ok",
          application_status: "rejected",
          response_bytes: 321
        },
        recovery_identity: {
          work_record_id: "WK-9001",
          carrier_generation: "GEN-A",
          semantic_objective: "persist_atomic_verification_bundle"
        }
      })
    ])
  );

  assert.equal(normalized.events[0].response.response_bytes, 321);
  assert.deepEqual(normalized.events[0].recovery_identity, {
    work_record_id: "WK-9001",
    carrier_generation: "GEN-A",
    verification_id: null,
    semantic_objective: "persist_atomic_verification_bundle"
  });
  assert.throws(
    () =>
      normalizeAuthoringErgonomicsTrace(
        baseTrace([
          rejectedCall(0, {
            response: {
              transport_status: "ok",
              application_status: "rejected",
              response_bytes: -1
            }
          })
        ])
      ),
    (error) => error.code === "invalid_type" && error.path.endsWith("response_bytes")
  );
});

test("[claim-semantic-recovery-validity] every recovery identity component is required and exact", () => {
  const identity = {
    work_record_id: "WK-9001",
    carrier_generation: "GEN-A",
    verification_id: "claim-a",
    semantic_objective: "persist_atomic_verification_bundle"
  };
  const failure = { recovery_identity: identity };

  assert.equal(
    classifyAuthoringRecoveryPair(failure, { recovery_identity: { ...identity } }).classification,
    "recovered"
  );
  for (const component of AUTHORING_ERGONOMICS_RECOVERY_IDENTITY_COMPONENTS) {
    const different = { ...identity, [component]: `${identity[component]}-different` };
    const mismatch = classifyAuthoringRecoveryPair(failure, { recovery_identity: different });
    assert.equal(mismatch.classification, "mismatched", `${component} must participate in exact matching`);
    assert.deepEqual(mismatch.differing_components, [component]);

    for (const side of ["failure", "recovery"]) {
      const incompleteFailure = { ...identity };
      const incompleteRecovery = { ...identity };
      delete (side === "failure" ? incompleteFailure : incompleteRecovery)[component];
      const unknown = classifyAuthoringRecoveryPair(
        { recovery_identity: incompleteFailure },
        { recovery_identity: incompleteRecovery }
      );
      assert.equal(unknown.classification, "unknown", `${side}.${component} absence must stay unknown`);
      assert.deepEqual(unknown.differing_components, []);
      assert.equal(unknown.missing_components[0].component, component);
    }
  }
});

test("ordering authority is the source ordinal and event index, never a timestamp", () => {
  const normalized = normalizeAuthoringErgonomicsTrace(
    baseTrace([
      {
        event_index: 2,
        source_ordinal: 0,
        event_kind: "tool_call",
        actor_kind: "consumer",
        observed_at: "2000-01-01T00:00:00Z"
      },
      {
        event_index: 1,
        source_ordinal: 1,
        event_kind: "tool_call",
        actor_kind: "consumer",
        observed_at: "1999-01-01T00:00:00Z"
      },
      {
        event_index: 1,
        source_ordinal: 0,
        event_kind: "tool_call",
        actor_kind: "consumer",
        observed_at: "2100-01-01T00:00:00Z"
      }
    ])
  );
  assert.equal(normalized.ordering_authority, "source_ordinal_then_event_index");
  assert.deepEqual(
    normalized.events.map((event) => [event.source_ordinal, event.event_index]),
    [
      [0, 1],
      [0, 2],
      [1, 1]
    ]
  );
});

test("workflow partitions are explicit and an absent token forbids cross-event grouping", () => {
  const report = detectAuthoringErgonomicsFindings(
    baseTrace([
      { event_index: 0, event_kind: "tool_call", actor_kind: "consumer", workflow_token: "WF-1" },
      { event_index: 1, event_kind: "tool_call", actor_kind: "consumer", workflow_token: "WF-2" },
      { event_index: 2, event_kind: "tool_call", actor_kind: "consumer" }
    ])
  );
  assert.deepEqual(
    report.workflow_partitions.map((partition) => [partition.workflow_token, partition.event_orders]),
    [
      ["WF-1", [0]],
      ["WF-2", [1]]
    ]
  );
  assert.equal(metric(report, "workflow_count").value, 2);
  assert.equal(metric(report, "workflow_count").unknown_workflow_event_count, 1);
  assert.ok(
    report.unknown_evidence.some(
      (entry) => entry.kind === "unknown_workflow_token" && entry.subject === "event_order:2"
    )
  );
});

test("an undeclared event family leaves its metrics unavailable rather than zero", () => {
  const report = detectAuthoringErgonomicsFindings(
    baseTrace([{ event_index: 0, event_kind: "tool_call", actor_kind: "consumer" }])
  );
  const paidDispatch = metric(report, "paid_dispatch_reached_count");
  assert.equal(paidDispatch.value, null);
  assert.equal(paidDispatch.evidence_state, "unavailable");
  assert.deepEqual(paidDispatch.eligible_population.undeclared_event_families, ["dispatch_observation"]);
  assert.ok(
    report.unknown_evidence.some(
      (entry) => entry.kind === "metric_population_unavailable" && entry.subject === "paid_dispatch_reached_count"
    )
  );

  const refusals = metric(report, "refusal_count");
  assert.equal(refusals.value, 0);
  assert.equal(refusals.evidence_state, "declared_failure_only");
  assert.equal(refusals.eligible_population.population_class, "failure_only");
});

test("an interleaved diagnostic call does not split an episode and is not an attempt", () => {
  const episodes = buildAuthoringErgonomicsEpisodes(
    baseTrace([
      rejectedCall(0),
      rejectedCall(1, {
        request: { request_id: "REQ-D", tool: "inline.describe", diagnostic: true },
        response: { transport_status: "ok", application_status: "normal", reason_codes: [] }
      }),
      rejectedCall(2)
    ])
  );
  assert.equal(episodes.length, 1);
  assert.equal(episodes[0].attempt_count, 2);
  assert.equal(episodes[0].rejected_submission_count, 2);
  assert.equal(episodes[0].diagnostic_call_count, 1);
});

test("a changed known identity, a boundary change, an observed effect, and an explicit stop each end an episode", () => {
  const identityChange = buildAuthoringErgonomicsEpisodes(
    baseTrace([rejectedCall(0), rejectedCall(1, { authoritative_input_identity: GEN_2 })])
  );
  assert.equal(identityChange.length, 2);
  assert.equal(identityChange[0].end_reason, "changed_known_identity");

  const boundaryChange = buildAuthoringErgonomicsEpisodes(
    baseTrace([
      rejectedCall(0),
      rejectedCall(1, {
        producer_boundary: { boundary_kind: "public_ingress", boundary_id: "other", producer_family: "other" }
      })
    ])
  );
  assert.equal(boundaryChange.length, 2);
  assert.equal(boundaryChange[0].end_reason, "owning_boundary_change");

  const observedEffect = buildAuthoringErgonomicsEpisodes(
    baseTrace([
      rejectedCall(0, {
        observed_effects: [
          {
            effect_kind: "inline_effect",
            effect_target: "CS-INLINE",
            observation_provenance: "authoritative_observed"
          }
        ]
      }),
      rejectedCall(1)
    ])
  );
  assert.equal(observedEffect.length, 2);
  assert.equal(observedEffect[0].end_reason, "observed_application_effect");

  const explicitStop = buildAuthoringErgonomicsEpisodes(
    baseTrace([
      rejectedCall(0, { continuation: { route_present: false, explicit_stop: true } }),
      rejectedCall(1)
    ])
  );
  assert.equal(explicitStop.length, 2);
  assert.equal(explicitStop[0].end_reason, "explicit_stop");
});

test("an unknown authoritative input identity forbids grouping beyond one request/response chain", () => {
  const report = detectAuthoringErgonomicsFindings(
    baseTrace([
      rejectedCall(0, { authoritative_input_identity: undefined }),
      rejectedCall(1, { authoritative_input_identity: undefined }),
      rejectedCall(2, { authoritative_input_identity: undefined })
    ])
  );
  assert.equal(report.episodes.length, 3, "unknown identity cannot anchor grouping");
  for (const episode of report.episodes) {
    assert.equal(episode.identity_state, "unknown");
    assert.equal(episode.attempt_count, 1);
    assert.equal(episode.end_reason, "unknown_authoritative_input_identity");
  }

  assert.equal(metric(report, "refusal_count").value, 3);
  assert.equal(metric(report, "repeated_refusal_episode_count").value, 0);
  assert.equal(report.clusters.length, 0);
  assert.equal(report.unknown_evidence.filter((entry) => entry.kind === "unknown_authoritative_input_identity").length, 3);
});

test("ERG-001 needs an observed discovery response before it calls a cascade a finding", () => {
  const withoutDiscovery = detectAuthoringErgonomicsFindings(baseTrace([rejectedCall(0), rejectedCall(1)]));
  const cascade = withoutDiscovery.observations.find((observation) => observation.observation_id === "ERG-001");
  assert.equal(cascade.finding, false);
  assert.equal(cascade.evidence_state, "unknown_discovery");
  assert.equal(cascade.evidence.discovery_observed, false);

  const withDiscovery = detectAuthoringErgonomicsFindings(
    baseTrace([
      {
        event_index: 0,
        event_kind: "tool_discovery",
        actor_kind: "producer",
        producer_boundary: CARRIER_BOUNDARY
      },
      rejectedCall(1),
      rejectedCall(2)
    ])
  );
  const confirmed = withDiscovery.observations.find((observation) => observation.observation_id === "ERG-001");
  assert.equal(confirmed.finding, true);
  assert.equal(confirmed.evidence.rejected_submission_count, 2);
  assert.equal(confirmed.evidence.discovery_event_order, 0);
});

test("ERG-004 reads ambiguity from the live validator's branch evidence and from colliding discriminators", () => {
  const fromValidator = detectAuthoringErgonomicsFindings(
    baseTrace([
      rejectedCall(0, {
        response: {
          transport_status: "ok",
          application_status: "rejected",
          reason_codes: ["ambiguous_input"],
          invariant_family: "alternative_selection",
          validator_branch_matches: ["ALT-A", "ALT-B"]
        }
      })
    ])
  );
  const validatorObservation = fromValidator.observations.find(
    (observation) => observation.observation_id === "ERG-004"
  );
  assert.equal(validatorObservation.outcome, "validator_admitted_multiple_alternatives");
  assert.deepEqual(validatorObservation.evidence.validator_branch_matches, ["ALT-A", "ALT-B"]);

  const fromDiscriminators = detectAuthoringErgonomicsFindings(
    baseTrace([
      rejectedCall(0, {
        response: {
          transport_status: "ok",
          application_status: "rejected",
          reason_codes: ["ambiguous_input"],
          invariant_family: "alternative_selection",
          advertised_alternatives: [
            { alternative_id: "ALT-A", discriminators: ["kind", "target"], precedence_declared: false },
            { alternative_id: "ALT-B", discriminators: ["target", "kind"], precedence_declared: false }
          ]
        }
      })
    ])
  );
  const discriminatorObservation = fromDiscriminators.observations.find(
    (observation) => observation.observation_id === "ERG-004"
  );
  assert.equal(discriminatorObservation.outcome, "shared_discriminator_population_without_precedence");
  assert.deepEqual(discriminatorObservation.evidence.colliding_alternatives, ["ALT-A", "ALT-B"]);

  const withPrecedence = detectAuthoringErgonomicsFindings(
    baseTrace([
      rejectedCall(0, {
        response: {
          transport_status: "ok",
          application_status: "rejected",
          reason_codes: ["ambiguous_input"],
          advertised_alternatives: [
            { alternative_id: "ALT-A", discriminators: ["kind"], precedence_declared: true },
            { alternative_id: "ALT-B", discriminators: ["kind"], precedence_declared: true }
          ]
        }
      })
    ])
  );
  assert.equal(
    withPrecedence.observations.some((observation) => observation.observation_id === "ERG-004"),
    false
  );
});

test("ERG-005 leaves unknown receipt evidence unknown instead of calling the effect unverified", () => {
  const report = detectAuthoringErgonomicsFindings(
    baseTrace([
      rejectedCall(0, {
        response: { transport_status: "ok", application_status: "normal", reason_codes: [] },
        claimed_effects: [{ effect_kind: "inline_effect", effect_target: "CS-INLINE" }]
      })
    ])
  );
  const observation = report.observations.find((candidate) => candidate.observation_id === "ERG-005");
  assert.equal(observation.finding, false);
  assert.equal(observation.outcome, "verification_evidence_unknown");
  assert.equal(observation.evidence_state, "unknown_receipt_or_observation");
  assert.equal(report.clusters.length, 0);
});

test("ERG-006 cannot establish a regression from a caller_expected stage or across unknown identity", () => {
  const callerExpected = detectAuthoringErgonomicsFindings(
    baseTrace([
      {
        event_index: 0,
        event_kind: "application_state",
        actor_kind: "consumer",
        authoritative_input_identity: GEN_1,
        stage_observations: [{ stage: "complete", provenance: "caller_expected", completeness: "complete" }]
      },
      {
        event_index: 1,
        event_kind: "application_state",
        actor_kind: "producer",
        authoritative_input_identity: GEN_1,
        stage_observations: [{ stage: "required", provenance: "producer_returned", completeness: "incomplete" }]
      }
    ])
  );
  assert.equal(
    callerExpected.observations.some((observation) => observation.observation_id === "ERG-006"),
    false
  );

  const unknownIdentity = detectAuthoringErgonomicsFindings(
    baseTrace([
      {
        event_index: 0,
        event_kind: "application_state",
        actor_kind: "producer",
        stage_observations: [{ stage: "complete", provenance: "producer_returned", completeness: "complete" }]
      },
      {
        event_index: 1,
        event_kind: "application_state",
        actor_kind: "producer",
        stage_observations: [{ stage: "required", provenance: "producer_returned", completeness: "incomplete" }]
      }
    ])
  );
  assert.equal(
    unknownIdentity.observations.some((observation) => observation.observation_id === "ERG-006"),
    false
  );
});

test("ERG-007 fires only when an executable typed next action was observed and then bypassed", () => {
  const executableRoute = {
    route_present: true,
    template_only: false,
    replacement_call: {
      tool: "inline.continue",
      ingress: "inline.ingress",
      named_tool_available: true,
      structural_only: false
    },
    replacement_call_outcome: "not_attempted"
  };

  const ignored = detectAuthoringErgonomicsFindings(
    baseTrace([
      rejectedCall(0, { continuation: executableRoute }),
      rejectedCall(1, { request: { request_id: "REQ-X", tool: "inline.other", diagnostic: false } })
    ])
  );
  const observation = ignored.observations.find((candidate) => candidate.observation_id === "ERG-007");
  assert.equal(observation.finding, true);
  assert.equal(observation.axis, "consumer");
  assert.equal(observation.evidence.observed_next_action, "inline.continue");
  assert.equal(observation.evidence.consumer_route_taken, "inline.other");

  const followed = detectAuthoringErgonomicsFindings(
    baseTrace([
      rejectedCall(0, { continuation: executableRoute }),
      rejectedCall(1, { request: { request_id: "REQ-X", tool: "inline.continue", diagnostic: false } })
    ])
  );
  assert.equal(
    followed.observations.some((candidate) => candidate.observation_id === "ERG-007"),
    false
  );
});

test("ERG-008 records degraded lookup as evidence rather than as a source-inspection escape", () => {
  const events = (capabilities) => [
    {
      event_index: 0,
      event_kind: "tool_discovery",
      actor_kind: "producer",
      producer_boundary: CARRIER_BOUNDARY,
      advertised_invariants: [
        { invariant_id: "INV-KNOWN", invariant_kind: "identity", invariant_family: "inline_family_invariant" }
      ]
    },
    {
      event_index: 1,
      event_kind: "source_inspection",
      actor_kind: "consumer",
      producer_boundary: CARRIER_BOUNDARY,
      target_identity: CARRIER_TARGET,
      authoritative_input_identity: GEN_1,
      lookup_capabilities: capabilities,
      recovered_invariants: [
        { invariant_id: "INV-HIDDEN", invariant_kind: "constraint", invariant_family: "inline_family_invariant" }
      ]
    }
  ];

  const degraded = detectAuthoringErgonomicsFindings(
    baseTrace(
      events({ structured_discovery: "available", structured_search: "unavailable", code_index: "unknown" }),
      [
        {
          event_families: ["tool_discovery", "tool_call", "source_inspection"],
          population_class: "normal_and_failure",
          normal_success_population_complete: false
        }
      ]
    )
  );
  const degradedObservation = degraded.observations.find(
    (observation) => observation.observation_id === "ERG-008"
  );
  assert.equal(degradedObservation.finding, false);
  assert.equal(degradedObservation.outcome, "lookup_degraded");
  assert.equal(metric(degraded, "source_inspection_escape_count").value, 0);
  assert.equal(metric(degraded, "source_inspection_escape_count").lookup_degraded_count, 1);

  const available = detectAuthoringErgonomicsFindings(
    baseTrace(
      events({ structured_discovery: "available", structured_search: "available", code_index: "available" }),
      [
        {
          event_families: ["tool_discovery", "tool_call", "source_inspection"],
          population_class: "normal_and_failure",
          normal_success_population_complete: false
        }
      ]
    )
  );
  const escape = available.observations.find((observation) => observation.observation_id === "ERG-008");
  assert.equal(escape.finding, true);
  assert.equal(escape.outcome, "escape");
});

test("ERG-011 stays silent when a green workload has no open chassis finding", () => {
  const report = detectAuthoringErgonomicsFindings(
    baseTrace(
      [
        {
          event_index: 0,
          event_kind: "integration_observation",
          actor_kind: "authority",
          workload_observation: { observation_kind: "integration", outcome: "success" }
        }
      ],
      [
        {
          event_families: ["integration_observation"],
          population_class: "normal_and_failure",
          normal_success_population_complete: true
        }
      ]
    )
  );
  const observation = report.observations.find((candidate) => candidate.observation_id === "ERG-011");
  assert.equal(observation.finding, false);
  assert.equal(observation.outcome, "workload_success_without_open_findings");
  assert.equal(clusterFor(report, "workload").length, 0);
});

test("fixture A clusters one repeated-refusal cascade while preserving every raw refusal", () => {
  const report = reportFor("repeated-authoring-episode");
  assert.equal(report.schema_version, AUTHORING_ERGONOMICS_REPORT_SCHEMA_VERSION);

  assert.equal(report.episodes.length, 2);
  const [precise, cascade] = report.episodes;
  assert.equal(precise.attempt_count, 1, "the precise top-level refusal is its own episode");
  assert.equal(precise.rejected_submission_count, 1);
  assert.equal(precise.end_reason, "owning_boundary_change");
  assert.equal(cascade.attempt_count, 5);
  assert.equal(cascade.rejected_submission_count, 5);
  assert.equal(cascade.diagnostic_call_count, 1, "the interleaved diagnostic query did not split the episode");
  assert.equal(cascade.identity_state, "known");

  assert.equal(report.clusters.length, 1);
  assert.deepEqual(report.axes_present, ["producer"]);
  const [cluster] = report.clusters;
  assert.equal(cluster.axis, "producer");
  assert.equal(cluster.invariant_family, "carrier_set_binding");
  assert.deepEqual(cluster.observation_ids, ["ERG-001", "ERG-002", "ERG-003", "ERG-008"]);
  assert.deepEqual(cluster.detectors, [
    "progressively_revealed_invariant",
    "repeated_refusal_cascade",
    "source_inspection_escape",
    "unusable_continuation"
  ]);
  assert.deepEqual(cluster.raw_counts, {
    attempt_count: 5,
    rejected_submission_count: 5,
    diagnostic_call_count: 1,
    event_count: 6
  });
  assert.deepEqual(cluster.denominators, {
    trace_tool_call_count: 7,
    trace_refusal_count: 6,
    trace_episode_count: 2,
    eligible_population: {
      event_families: ["tool_discovery", "tool_call"],
      population_class: "failure_only",
      normal_success_population_complete: false
    }
  });

  assert.equal(
    report.observations.filter((observation) => observation.observation_id === "ERG-003").every(
      (observation) => observation.outcome === "structural_template_only"
    ),
    true,
    "the reused advertised template offers no completion route"
  );

  assert.equal(metric(report, "refusal_count").value, 6);
  assert.equal(metric(report, "tool_call_count").value, 7);
  assert.equal(metric(report, "tool_call_count").diagnostic_call_count, 1);
  assert.equal(metric(report, "repeated_refusal_episode_count").value, 1);
  assert.equal(metric(report, "unusable_continuation_count").value, 5);
  assert.equal(metric(report, "source_inspection_escape_count").value, 1);
  assert.equal(metric(report, "unique_invariant_count").value, 4);

  assert.equal(metric(report, "refusal_count").evidence_state, "declared_failure_only");
  assert.equal(metric(report, "unverified_effect_response_count").value, null);
  assert.equal(metric(report, "unverified_effect_response_count").evidence_state, "unavailable");
  assert.equal(metric(report, "authoritative_effect_observed_count").value, null);
});

test("fixture B keeps producer, consumer, record-quality, lifecycle, and workload axes distinct", () => {
  const report = reportFor("persistence-consumer-lifecycle");

  assert.deepEqual(report.axes_present, [
    "consumer",
    "persistence_lifecycle",
    "producer",
    "record_quality",
    "workload"
  ]);
  assert.equal(report.clusters.length, 5, "each boundary's own incorrect act is its own cluster");

  const [producer] = clusterFor(report, "producer");
  assert.deepEqual(producer.observation_ids, ["ERG-005", "ERG-006"]);
  assert.equal(producer.invariant_family, "persistence_effect");

  const unverified = report.observations.find(
    (observation) => observation.observation_id === "ERG-005" && observation.axis === "producer"
  );
  assert.equal(unverified.outcome, "claimed_effect_unverified");
  assert.equal(unverified.evidence.receipt_state, "absent");
  assert.deepEqual(unverified.evidence.authoritative_observed_effects, []);
  assert.equal(unverified.evidence.application_status, "normal");

  const regression = report.observations.find((observation) => observation.observation_id === "ERG-006");
  assert.equal(regression.outcome, "complete_to_incomplete");
  assert.equal(regression.evidence.provenance, "producer_returned");
  assert.equal(regression.evidence.earlier_completeness, "complete");
  assert.equal(regression.evidence.later_stage, "contract_required");
  assert.equal(regression.evidence.later_selected_resource_count, 0);
  assert.equal(
    regression.evidence.permitted_invalidation_authority,
    "authoring_state_contract",
    "whether the invalidation was permitted is not this module's call"
  );

  const [consumer] = clusterFor(report, "consumer");
  assert.deepEqual(consumer.detectors, ["unverified_effect_continuation"]);
  const continuation = report.observations.find(
    (observation) => observation.observation_id === "ERG-005" && observation.axis === "consumer"
  );
  assert.equal(continuation.outcome, "dispatched_after_unverified_effect");
  assert.equal(continuation.evidence.intervening_verification_observed, false);
  assert.equal(continuation.evidence.dispatch_facts.paid, true);

  const [recordQuality] = clusterFor(report, "record_quality");
  assert.deepEqual(recordQuality.detectors, ["parent_slice_quality_divergence"]);
  const divergence = report.observations.find((observation) => observation.observation_id === "ERG-009");
  assert.equal(divergence.evidence.validating_producer, "work_record_validation");
  assert.equal(divergence.evidence.divergences.length, 1);

  const [lifecycle] = clusterFor(report, "persistence_lifecycle");
  assert.equal(lifecycle.invariant_family, "carrier_lifecycle");
  const loss = report.observations.find(
    (observation) => observation.observation_id === "ERG-010" && observation.finding
  );
  assert.equal(loss.evidence.confirmed_present_stage, "authoring");
  assert.equal(loss.evidence.absent_stage, "wk_ref");

  const unresolved = report.observations.find(
    (observation) => observation.observation_id === "ERG-010" && observation.outcome === "unresolved_ref"
  );
  assert.equal(unresolved.finding, false);
  assert.equal(unresolved.evidence_state, "unknown_ref_resolution");

  const falseGreen = report.observations.find((observation) => observation.observation_id === "ERG-011");
  assert.equal(falseGreen.finding, true);
  assert.equal(falseGreen.outcome, "false_green_workload");
  assert.deepEqual(
    falseGreen.evidence.successful_observations.map((entry) => entry.observation_kind),
    ["worker", "reviewer", "integration", "artifact", "test"]
  );
  assert.deepEqual(falseGreen.evidence.open_chassis_finding_axes, [
    "consumer",
    "persistence_lifecycle",
    "producer",
    "record_quality"
  ]);

  assert.equal(metric(report, "unverified_effect_response_count").value, 1);
  assert.equal(metric(report, "unverified_effect_response_count").consumer_continuation_count, 1);
  assert.equal(metric(report, "unverified_effect_response_count").evidence_state, "declared_normal_and_failure");
  assert.equal(
    metric(report, "unverified_effect_response_count").eligible_population.normal_success_population_complete,
    true,
    "a source declaring a complete normal-success population is what a later gate needs"
  );
  assert.equal(metric(report, "stage_transition_regression_count").value, 1);
  assert.equal(metric(report, "paid_dispatch_reached_count").value, 1);
  assert.equal(metric(report, "authoritative_effect_observed_count").value, 0);
  assert.equal(metric(report, "refusal_count").value, 0, "a declared population may legitimately observe zero");
});

test("fixture C yields one public-consumer cluster and no producer or lifecycle defect", () => {
  const report = reportFor("cross-focus-public-consumer");

  assert.deepEqual(report.axes_present, ["public_consumer"]);
  assert.equal(report.clusters.length, 1);
  const [cluster] = report.clusters;
  assert.equal(cluster.invariant_family, "public_selection");
  assert.deepEqual(cluster.raw_event_orders, [0, 1, 2]);

  const divergences = findings(report);
  assert.equal(divergences.length, 2, "the read and the query are both preserved as raw observations");
  assert.deepEqual(
    divergences.map((observation) => observation.evidence.observation_kind),
    ["public_read_observation", "public_query_observation"]
  );
  for (const divergence of divergences) {
    assert.equal(divergence.outcome, "cross_focus_selection_divergence");
    assert.equal(divergence.evidence.selection_fence, "MANIFEST-C");
    assert.equal(divergence.evidence.authoritative_content_identity, "sha256:manifest-current");
    assert.equal(divergence.evidence.returned_content_identity, "sha256:legacy-cross-focus");
  }

  assert.equal(clusterFor(report, "persistence_lifecycle").length, 0, "divergence is not a lifecycle loss");
  assert.equal(
    report.observations.some((observation) => observation.outcome === "carrier_absent_after_confirmed_presence"),
    false
  );

  const unresolved = report.observations.find((observation) => observation.outcome === "unresolved_ref");
  assert.equal(unresolved.finding, false);
  assert.equal(unresolved.axis, "public_consumer");

  for (const name of ["tool_call_count", "refusal_count", "episode_count", "repeated_refusal_episode_count"]) {
    assert.equal(metric(report, name).value, null, `${name} must stay unavailable`);
    assert.equal(metric(report, name).evidence_state, "unavailable");
  }

  assert.equal(metric(report, "authoritative_effect_observed_count").evidence_state, "unknown_population");
  assert.ok(
    report.unknown_evidence.some(
      (entry) => entry.kind === "unknown_population_class" && entry.subject === "persistence_receipt"
    )
  );
});

test("fixture D isolates continuation reachability from diagnostic fidelity", () => {
  const report = reportFor("unreachable-continuation");

  assert.equal(report.clusters.length, 1);
  const [cluster] = report.clusters;
  assert.equal(cluster.axis, "producer");
  assert.deepEqual(cluster.detectors, ["unusable_continuation"]);
  assert.equal(cluster.invariant_family, "continuation_reachability");

  const observations = report.observations.filter((observation) => observation.observation_id === "ERG-003");
  assert.equal(observations.length, 2);
  assert.equal(observations[0].finding, false);
  assert.equal(observations[0].outcome, "executable", "the route looked executable when it was advertised");
  assert.equal(observations[1].finding, true);
  assert.equal(observations[1].outcome, "replacement_call_rejected");
  assert.equal(observations[1].evidence.advertised_ingress, "public.authoring_ingress");
  assert.equal(observations[1].evidence.replacement_call.named_tool_available, true);

  assert.equal(metric(report, "tool_call_count").value, 3);
  assert.equal(metric(report, "tool_call_count").diagnostic_call_count, 1);
  assert.equal(report.episodes.length, 2);
  assert.equal(report.episodes[0].attempt_count, 1);
  assert.equal(report.episodes[0].diagnostic_call_count, 1);
  assert.equal(report.episodes[1].attempt_count, 1);

  assert.equal(metric(report, "refusal_count").value, 2);
  assert.equal(metric(report, "repeated_refusal_episode_count").value, 0);
  assert.equal(metric(report, "unusable_continuation_count").value, 1);

  assert.equal(clusterFor(report, "consumer").length, 0);
  assert.equal(
    report.observations.some((observation) => observation.observation_id === "ERG-007"),
    false
  );
});

test("[claim-semantic-recovery-covers] cross-tool recovery is semantic, evidence-preserving, and additive", () => {
  const report = reportFor("cross-tool-semantic-recovery");
  const recovery = report.semantic_recovery;

  assert.deepEqual(
    recovery.classifications.map((entry) => [
      entry.failure_event_order,
      entry.recovery_event_order,
      entry.classification
    ]),
    [
      [0, 1, "recovered"],
      [2, 3, "mismatched"],
      [4, 5, "unknown"]
    ]
  );
  const matched = recovery.classifications[0];
  assert.notEqual(
    matched.failure_evidence.request.tool,
    matched.recovery_evidence.request.tool,
    "tool identity is not the recovery identity"
  );
  assert.equal(matched.failure_evidence.response.application_status, "rejected");
  assert.equal(matched.recovery_evidence.response.application_status, "accepted");
  assert.deepEqual(matched.identity_comparison.matching_components, [
    "work_record_id",
    "carrier_generation",
    "verification_id",
    "semantic_objective"
  ]);

  assert.deepEqual(recovery.recovered_failure_event_orders, [0]);
  assert.deepEqual(recovery.unrecovered_failure_event_orders, [2, 4]);
  assert.equal(recovery.unrecovered_authoring_failure_count, 2);
  assert.equal(metric(report, "unrecovered_authoring_failure_count").value, 2);
  assert.deepEqual(metric(report, "unrecovered_authoring_failure_count").semantic_recovery, recovery);
  assert.equal(
    metric(report, "unrecovered_authoring_failure_count").recovered_authoring_failure_count,
    1
  );
  assert.equal(recovery.classifications[1].identity_comparison.differing_components[0], "work_record_id");
  assert.equal(recovery.classifications[2].identity_comparison.missing_components[0].component, "verification_id");
  assert.ok(
    report.unknown_evidence.some(
      (entry) => entry.kind === "semantic_recovery_identity_unknown" && entry.subject === "event_order:4"
    )
  );

  const trace = loadFixture("repeated-authoring-episode");
  const baseline = detectAuthoringErgonomicsFindings(trace);
  const enriched = JSON.parse(JSON.stringify(trace));
  for (const event of enriched.events) {
    if (event.event_kind !== "tool_call") continue;
    event.recovery_identity = {
      work_record_id: "WK-9005",
      carrier_generation: "GEN-D",
      verification_id: "claim-d",
      semantic_objective: "persist_atomic_verification_bundle"
    };
  }
  const additive = detectAuthoringErgonomicsFindings(enriched);
  assert.deepEqual(additive.observations, baseline.observations);
  assert.deepEqual(additive.clusters, baseline.clusters);
  assert.deepEqual(
    additive.metrics.filter((entry) => entry.metric !== "unrecovered_authoring_failure_count"),
    baseline.metrics.filter((entry) => entry.metric !== "unrecovered_authoring_failure_count")
  );
});

const EFFECT_COVERAGE = [
  {
    workload: "inline",
    event_families: ["tool_call", "persistence_receipt"],
    population_class: "normal_and_failure",
    normal_success_population_complete: true
  },
  {
    workload: "inline",
    event_families: ["dispatch_observation", "integration_observation"],
    population_class: "normal_and_failure",
    normal_success_population_complete: true
  }
];

function unverifiedEffectCall(eventIndex, overrides = {}) {
  return rejectedCall(eventIndex, {
    response: {
      response_id: `RES-${eventIndex}`,
      transport_status: "ok",
      application_status: "normal",
      reason_codes: [],
      invariant_family: "persistence_effect"
    },
    claimed_effects: [{ effect_kind: "inline_persisted", effect_target: "CS-INLINE" }],
    observed_effects: [],
    receipt: { receipt_state: "absent", receipt_id: null },
    ...overrides
  });
}

test("ERG-005 charges only the consumer act causally linked to the unverified effect", () => {
  const report = detectAuthoringErgonomicsFindings(
    baseTrace(
      [
        unverifiedEffectCall(0),
        {
          event_index: 1,
          event_kind: "dispatch_observation",
          actor_kind: "consumer",
          workflow_token: "WF-INLINE",
          producer_boundary: {
            boundary_kind: "launcher",
            boundary_id: "dispatch.worker",
            producer_family: "agent_dispatch"
          },
          target_identity: { target_kind: "record", target_id: "UNIT-INLINE" },
          dispatch_facts: { paid: true, dispatched_unit: "UNIT-INLINE", action_kind: "implementation_dispatch" }
        },

        {
          event_index: 2,
          event_kind: "dispatch_observation",
          actor_kind: "consumer",
          workflow_token: "WF-UNRELATED",
          producer_boundary: {
            boundary_kind: "launcher",
            boundary_id: "dispatch.other",
            producer_family: "other_dispatch"
          },
          target_identity: { target_kind: "record", target_id: "UNIT-OTHER" },
          authoritative_input_identity: GEN_2,
          dispatch_facts: { paid: true, dispatched_unit: "UNIT-OTHER", action_kind: "implementation_dispatch" }
        }
      ],
      EFFECT_COVERAGE
    )
  );

  const consumerFindings = report.observations.filter(
    (observation) => observation.observation_id === "ERG-005" && observation.axis === "consumer"
  );
  assert.equal(consumerFindings.length, 1, "only the causally linked dispatch is charged");
  assert.deepEqual(consumerFindings[0].event_orders, [0, 1]);
  assert.deepEqual(consumerFindings[0].evidence.causal_link_basis, ["workflow_token"]);
  assert.equal(consumerFindings[0].evidence.dispatch_facts.dispatched_unit, "UNIT-INLINE");
  assert.equal(
    report.observations.some(
      (observation) =>
        observation.observation_id === "ERG-005" &&
        observation.axis === "consumer" &&
        observation.event_orders.includes(2)
    ),
    false,
    "an unrelated later paid dispatch is never charged"
  );

  assert.equal(metric(report, "unverified_effect_response_count").value, 1);
  assert.equal(metric(report, "unverified_effect_response_count").consumer_continuation_count, 1);
  assert.equal(metric(report, "paid_dispatch_reached_count").value, 2, "both paid dispatches stay counted");
  assert.equal(clusterFor(report, "consumer").length, 1);
});

test("producer retries in one causal episode arm one consumer act exactly once", () => {
  const report = detectAuthoringErgonomicsFindings(
    baseTrace(
      [
        unverifiedEffectCall(0),
        unverifiedEffectCall(1),
        unverifiedEffectCall(2),
        {
          event_index: 3,
          event_kind: "dispatch_observation",
          actor_kind: "consumer",
          workflow_token: "WF-INLINE",
          producer_boundary: {
            boundary_kind: "launcher",
            boundary_id: "dispatch.worker",
            producer_family: "agent_dispatch"
          },
          target_identity: { target_kind: "record", target_id: "UNIT-INLINE" },
          dispatch_facts: { paid: true, dispatched_unit: "UNIT-INLINE", action_kind: "implementation_dispatch" }
        }
      ],
      EFFECT_COVERAGE
    )
  );

  assert.equal(report.episodes.length, 1);
  assert.equal(report.episodes[0].attempt_count, 3);
  assert.equal(metric(report, "unverified_effect_response_count").value, 3);
  assert.equal(clusterFor(report, "producer").length, 1);

  const consumerFindings = report.observations.filter(
    (observation) => observation.observation_id === "ERG-005" && observation.axis === "consumer"
  );
  assert.equal(consumerFindings.length, 1, "producer retries never cross-product with the consumer act");
  assert.equal(metric(report, "unverified_effect_response_count").consumer_continuation_count, 1);
  assert.deepEqual(consumerFindings[0].evidence.unverified_effect_event_orders, [0, 1, 2]);
  assert.equal(consumerFindings[0].evidence.unverified_effect_response_count, 3);
  assert.deepEqual(consumerFindings[0].evidence.unverified_effect_episode_ids, ["EP-001"]);

  const consumerClusters = clusterFor(report, "consumer");
  assert.equal(consumerClusters.length, 1, "the intended single consumer cluster remains");
  assert.deepEqual(consumerClusters[0].raw_event_orders, [0, 1, 2, 3]);
  assert.equal(
    consumerClusters[0].raw_event_orders.filter((order) => order === 3).length,
    1,
    "the consumer act appears once in the cluster's raw event accounting"
  );
});

test("advertised invariant material is owned by its producer boundary and identity", () => {
  const SHARED = "INV-SHARED";
  const report = detectAuthoringErgonomicsFindings(
    baseTrace(
      [

        {
          event_index: 0,
          event_kind: "tool_discovery",
          actor_kind: "producer",
          producer_boundary: {
            boundary_kind: "mcp_tool",
            boundary_id: "producer.one",
            producer_family: "family_one"
          },
          advertised_invariants: [
            { invariant_id: SHARED, invariant_kind: "binding", invariant_family: "family_one_invariant" }
          ]
        },

        {
          event_index: 1,
          event_kind: "tool_call",
          actor_kind: "consumer",
          producer_boundary: {
            boundary_kind: "mcp_tool",
            boundary_id: "producer.two",
            producer_family: "family_two"
          },
          target_identity: { target_kind: "carrier_set", target_id: "CS-TWO" },
          authoritative_input_identity: GEN_1,
          request: { request_id: "REQ-TWO", tool: "producer.two.submit", diagnostic: false },
          response: {
            response_id: "RES-TWO",
            transport_status: "ok",
            application_status: "rejected",
            reason_codes: ["two_rejected"],
            invariant_family: "family_two_invariant",
            revealed_invariants: [
              { invariant_id: "INV-TWO-LATE", invariant_kind: "binding", invariant_family: "family_two_invariant" }
            ]
          }
        },

        {
          event_index: 2,
          event_kind: "source_inspection",
          actor_kind: "consumer",
          producer_boundary: {
            boundary_kind: "mcp_tool",
            boundary_id: "producer.two",
            producer_family: "family_two"
          },
          target_identity: { target_kind: "carrier_set", target_id: "CS-TWO" },
          authoritative_input_identity: GEN_1,
          lookup_capabilities: {
            structured_discovery: "available",
            structured_search: "available",
            code_index: "available"
          },
          recovered_invariants: [
            { invariant_id: SHARED, invariant_kind: "binding", invariant_family: "family_two_invariant" }
          ]
        },

        {
          event_index: 3,
          event_kind: "tool_call",
          actor_kind: "consumer",
          producer_boundary: {
            boundary_kind: "mcp_tool",
            boundary_id: "producer.one",
            producer_family: "family_one"
          },
          target_identity: { target_kind: "carrier_set", target_id: "CS-ONE" },
          authoritative_input_identity: GEN_2,
          request: { request_id: "REQ-ONE", tool: "producer.one.submit", diagnostic: false },
          response: {
            response_id: "RES-ONE",
            transport_status: "ok",
            application_status: "rejected",
            reason_codes: ["one_rejected"],
            invariant_family: "family_one_invariant",
            revealed_invariants: [
              { invariant_id: "INV-ONE-LATE", invariant_kind: "binding", invariant_family: "family_one_invariant" }
            ]
          }
        }
      ],
      [
        {
          workload: "inline",
          event_families: ["tool_discovery", "tool_call", "source_inspection"],
          population_class: "normal_and_failure",
          normal_success_population_complete: false
        }
      ]
    )
  );

  const crossBoundary = report.observations.find(
    (observation) => observation.observation_id === "ERG-002" && observation.event_orders.includes(1)
  );
  assert.equal(crossBoundary.finding, false);
  assert.equal(crossBoundary.outcome, "advertised_material_unknown");
  assert.equal(crossBoundary.evidence.advertised_material_observed_in_scope, false);
  assert.equal(crossBoundary.evidence.advertised_invariant_count, 0);

  const escape = report.observations.find((observation) => observation.observation_id === "ERG-008");
  assert.equal(escape.finding, true);
  assert.equal(escape.outcome, "escape");
  assert.deepEqual(
    escape.evidence.invariants_absent_from_advertised_material.map((invariant) => invariant.invariant_id),
    [SHARED]
  );
  assert.equal(metric(report, "source_inspection_escape_count").value, 1);

  const ownScope = report.observations.find(
    (observation) => observation.observation_id === "ERG-002" && observation.event_orders.includes(3)
  );
  assert.equal(ownScope.finding, true);
  assert.equal(ownScope.outcome, "invariant_revealed_late");
  assert.equal(ownScope.evidence.advertised_invariant_count, 1);
});

const FIXTURE_NAMES = [
  "repeated-authoring-episode",
  "persistence-consumer-lifecycle",
  "cross-focus-public-consumer",
  "unreachable-continuation",
  "cross-tool-semantic-recovery"
];

test("detection is deterministic, non-mutating, and frozen for every fixture", () => {
  for (const name of FIXTURE_NAMES) {
    const trace = loadFixture(name);
    const before = JSON.stringify(trace);
    const first = detectAuthoringErgonomicsFindings(trace);
    const second = detectAuthoringErgonomicsFindings(trace);
    assert.equal(JSON.stringify(trace), before, `${name}: the input envelope must not be mutated`);
    assert.deepEqual(second, first, `${name}: repeated detection must return the identical report`);
    assert.equal(Object.isFrozen(first), true);
    assert.equal(Object.isFrozen(first.clusters), true);
  }
});

test("a normalized trace is accepted directly and produces the same report as its envelope", () => {
  for (const name of FIXTURE_NAMES) {
    const trace = loadFixture(name);
    const normalized = normalizeAuthoringErgonomicsTrace(trace);
    assert.equal(normalized.schema_version, AUTHORING_ERGONOMICS_NORMALIZED_SCHEMA_VERSION);
    assert.equal(normalized.envelope_schema_version, AUTHORING_ERGONOMICS_TRACE_SCHEMA_VERSION);
    assert.deepEqual(detectAuthoringErgonomicsFindings(normalized), detectAuthoringErgonomicsFindings(trace));
  }
});

test("every fixture reports its coverage, its episodes, and its unknown evidence explicitly", () => {
  for (const name of FIXTURE_NAMES) {
    const report = reportFor(name);
    assert.ok(report.coverage.declarations.length > 0, `${name}: coverage must be declared`);
    assert.equal(report.ordering_authority, "source_ordinal_then_event_index");
    assert.equal(Array.isArray(report.unknown_evidence), true);
    for (const observation of report.observations) {
      assert.ok(
        AUTHORING_ERGONOMICS_DETECTOR_IDS.includes(observation.observation_id),
        `${name}: ${observation.observation_id} must be a declared detector`
      );
      assert.ok(
        AUTHORING_ERGONOMICS_AXES.includes(observation.axis),
        `${name}: ${observation.axis} must be a declared axis`
      );

      if (!observation.finding && observation.evidence_state !== "observed") {
        assert.ok(
          report.unknown_evidence.some((entry) => entry.kind === observation.evidence_state),
          `${name}: ${observation.evidence_state} must be surfaced as unknown evidence`
        );
      }
    }
    for (const cluster of report.clusters) {
      assert.ok(cluster.raw_event_orders.length > 0);
      assert.ok(cluster.denominators.trace_episode_count >= 0);
    }
  }
});
