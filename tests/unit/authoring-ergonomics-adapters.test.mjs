

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AUTHORING_ERGONOMICS_ADAPTER_RESULT_SCHEMA_VERSION,
  AUTHORING_ERGONOMICS_RETAINED_SMOKE_SCHEMA_VERSION,
  AuthoringErgonomicsAdapterError,
  adaptErrorsLogTrace,
  adaptRetainedSmokeTrace
} from "../../packages/wiki-core/src/lib/authoring-ergonomics-adapters.mjs";
import {
  AUTHORING_ERGONOMICS_TRACE_SCHEMA_VERSION,
  detectAuthoringErgonomicsFindings
} from "../../packages/wiki-core/src/lib/authoring-ergonomics-trace.mjs";

const THIS_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MODULE_PATH = path.join(
  THIS_DIR,
  "../packages/wiki-core/src/lib/authoring-ergonomics-adapters.mjs"
);

function metric(report, name) {
  const entry = report.metrics.find((candidate) => candidate.metric === name);
  assert.ok(entry, `metric ${name} must be reported`);
  return entry;
}

function unknownKinds(result) {
  return result.unknown_evidence.map((entry) => entry.kind);
}

function declarationFor(result, family) {
  return result.trace.coverage.declarations.find((declaration) =>
    declaration.event_families.includes(family)
  );
}

function section(token, tool, request, failure) {
  return [
    `=== ${token}: ${tool} ===`,
    "REQUEST:",
    JSON.stringify(request, null, 2),
    "FAILURE:",
    JSON.stringify(failure, null, 2),
    ""
  ].join("\n");
}

function typedRefusal(reasonCode, details) {
  return {
    content: [{ type: "text", text: JSON.stringify({ reason_code: reasonCode }) }],
    structuredContent: {
      schema_version: "inline-contract-mcp-refusal.v1",
      ok: false,
      warning: {
        code: "inline_contract_request_refused",
        severity: "blocking",
        message: `inline-contract MCP request refused: ${reasonCode}`,
        payload: {
          schema_version: "inline-contract-refusal-payload.v1",
          reason_code: reasonCode,
          details: details ?? {}
        }
      }
    },
    isError: true
  };
}

const SESSION_A = "20200101T000000000Z-0001";
const SESSION_B = "20200101T010000000Z-0002";

const JOURNAL = [
  section(
    SESSION_A,
    "inline_submit_unit",
    { repo: "inline-repo", unit: "WK-0001#SLICE-001", expected_source_digest: "sha256:caller-supplied" },
    {
      content: [
        {
          type: "text",
          text: "MCP error -32602: Input validation error: Invalid arguments for tool inline_submit_unit: Required at unit"
        }
      ],
      isError: true
    }
  ),
  section(
    SESSION_A,
    "inline_carrier_patch",
    { repo: "inline-repo", wk_id: "WK-0001", expected_content_digest: "sha256:caller-supplied", content: { secret_material: "REDACT-ME" } },
    typedRefusal("inline_carrier_validation_failed", {
      contract_family: "inline_v1",
      diagnostics: {
        diagnostic_projection_version: "inline.bounded-diagnostic-projection.v1",
        total_count: 2,
        returned_count: 2,
        omitted_count: 0,
        truncated: false,
        diagnostics: [
          {
            code: "mandatory_behavior_unverified",
            pointer: "/operations/0/bundle/claims",
            claim_id: "claim-alpha",
            reason_code: "inline_proof_refused",
            message: "an unbounded producer explanation that must never be forwarded"
          },
          { code: "target_type_mismatch", pointer: "/", claim_id: "", reason_code: "" }
        ]
      }
    })
  ),
  section(
    SESSION_A,
    "inline_read_only_query",
    { repo: "inline-repo", wk_id: "WK-0001" },
    { content: [{ type: "text", text: "canonical carrier does not exist in the authenticated generation" }], isError: true }
  ),
  section(
    SESSION_A,
    "inline_authoring_continue",
    { repo: "inline-repo", wk_id: "WK-0001", continuation: "caller-held-token", expected_stage: "evaluation_input_ready" },
    typedRefusal("inline_authoring_continuation_unknown", {
      replacement_call: { tool: "inline_authoring_state", arguments: { wk_id: "WK-0001" } }
    })
  ),
  section(
    SESSION_B,
    "inline_search_repo",
    { query: "inline", limit: 10 },
    {
      content: [{ type: "text", text: "No lexical search index exists at /var/run/installation-root/.cache/index.json." }],
      structuredContent: {
        contract: "inline_search_diagnostic.v1",
        code: "search_index_missing",
        message: "No lexical search index exists at /var/run/installation-root/.cache/index.json.",
        indexPath: "/var/run/installation-root/.cache/index.json",
        remediation: { cli: "npm run inline -- build-index", mcp: "inline_build_search_index" }
      },
      isError: true
    }
  )
].join("\n");

const GEN_1 = { identity_kind: "carrier_generation", identity_value: "GEN-1", descriptor_digest: "sha256:gen-1" };

function retained(overrides = {}) {
  return {
    schema_version: AUTHORING_ERGONOMICS_RETAINED_SMOKE_SCHEMA_VERSION,
    trace_id: "RETAINED-INLINE",
    retained_source: {
      source_kind: "retained_smoke",
      source_locator: "retained://inline",
      source_digest: "sha256:retained",
      source_ordinal: 0
    },
    workload_label: "inline-workload",
    observed_identities: { repository: "inline-repo", records: ["WK-0001"], focus: null },
    sessions: [{ session_token: "RUN-1", source_ordinal: 0 }],
    capture: {
      declarations: [
        {
          event_families: ["tool_call"],
          capture_mode: "all_calls",
          captured_record_count: 2,
          total_record_count: 2
        }
      ]
    },
    observations: [
      {
        kind: "mcp_call",
        session_token: "RUN-1",
        tool: "inline_persist",
        diagnostic: false,
        target: { target_kind: "work_record", target_id: "WK-0001" },
        authoritative_identity: GEN_1,
        request_assertions: { expected_stage: "contract_required" },
        response: {
          transport_status: "ok",
          application_status: "normal",
          reason_codes: ["inline_persisted"],
          producer_family: "inline-contract.v1",
          returned_stage: { stage: "proof_ready", completeness: "complete", selected_resource_count: 2 },
          route_present: false
        },
        receipt: { receipt_state: "absent" },
        claimed_effects: [{ effect_kind: "carrier_persisted", effect_target: "CS-1" }]
      },
      {
        kind: "mcp_call",
        session_token: "RUN-1",
        tool: "inline_persist",
        diagnostic: true,
        target: { target_kind: "work_record", target_id: "WK-0001" },
        authoritative_identity: GEN_1,
        response: {
          transport_status: "ok",
          application_status: "normal",
          returned_stage: { stage: "contract_required", completeness: "incomplete" },
          route_present: false
        },
        receipt: { receipt_state: "present", receipt_id: "RCPT-1" },
        observed_effects: [
          { effect_kind: "carrier_persisted", effect_target: "CS-1", observation_provenance: "authoritative_observed" }
        ]
      }
    ],
    ...overrides
  };
}

test("the adapters read no files, resolve no path, and bind to no run layout", () => {
  const source = readFileSync(MODULE_PATH, "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  assert.equal(/node:fs/.test(code), false, "the adapters open no file of their own");
  assert.equal(/node:path/.test(code), false, "the adapters resolve no path");
  assert.equal(/process\s*\.\s*env/.test(code), false, "the adapters read no ambient environment");
  assert.equal(/agent-runs|run_root|\.cache/.test(code), false, "the adapters know no run directory layout");

  assert.equal(/synthetic/i.test(code), false);
});

test("the errors.log adapter declares failure_only coverage that no input can raise", () => {
  for (const options of [{}, { workload: "anything" }, { source_kind: "normal_and_failure" }]) {
    const result = adaptErrorsLogTrace(JOURNAL, options);
    assert.equal(result.schema_version, AUTHORING_ERGONOMICS_ADAPTER_RESULT_SCHEMA_VERSION);
    assert.equal(result.adapter, "errors_log");
    assert.equal(result.trace.schema_version, AUTHORING_ERGONOMICS_TRACE_SCHEMA_VERSION);

    const declaration = declarationFor(result, "tool_call");
    assert.equal(declaration.population_class, "failure_only");
    assert.equal(declaration.normal_success_population_complete, false);

    for (const entry of result.trace.coverage.declarations) {
      assert.notEqual(entry.normal_success_population_complete, true);
    }
    for (const entry of result.coverage_summary) {
      assert.notEqual(entry.normal_success_population_complete, true);
    }
  }
});

test("failure-only evidence cannot green a normal-success population", () => {
  const report = detectAuthoringErgonomicsFindings(adaptErrorsLogTrace(JOURNAL).trace);

  for (const name of ["tool_call_count", "refusal_count", "episode_count", "unusable_continuation_count"]) {
    assert.equal(metric(report, name).evidence_state, "declared_failure_only");
    assert.equal(metric(report, name).eligible_population.normal_success_population_complete, false);
  }

  for (const name of [
    "unverified_effect_response_count",
    "authoritative_effect_observed_count",
    "paid_dispatch_reached_count",
    "stage_transition_regression_count"
  ]) {
    const entry = metric(report, name);
    assert.equal(entry.value, null, `${name} must stay unknown rather than zero`);
    assert.equal(entry.evidence_state, "unavailable");
  }

  assert.ok(
    report.unknown_evidence.some((entry) => entry.kind === "metric_population_unavailable"),
    "the report must carry the unavailable populations as explicit unknown evidence"
  );
});

test("the errors.log adapter preserves source ordinal, event index, and source order", () => {
  const result = adaptErrorsLogTrace(JOURNAL, { source_ordinal: 7 });
  assert.equal(result.trace.source.source_ordinal, 7);
  assert.deepEqual(
    result.trace.events.map((event) => event.event_index),
    [0, 1, 2, 3, 4]
  );
  assert.deepEqual(
    result.trace.events.map((event) => event.source_ordinal),
    [7, 7, 7, 7, 7]
  );

  assert.deepEqual(
    result.normalized.events.map((event) => event.request.tool),
    [
      "inline_submit_unit",
      "inline_carrier_patch",
      "inline_read_only_query",
      "inline_authoring_continue",
      "inline_search_repo"
    ]
  );
  assert.equal(result.normalized.ordering_authority, "source_ordinal_then_event_index");
});

test("the errors.log adapter preserves explicit session tokens and never synthesizes one", () => {
  const result = adaptErrorsLogTrace(JOURNAL);
  assert.deepEqual(
    result.trace.workflows.map((workflow) => workflow.workflow_token),
    [SESSION_A, SESSION_B]
  );
  assert.deepEqual(
    result.trace.events.map((event) => event.workflow_token),
    [SESSION_A, SESSION_A, SESSION_A, SESSION_A, SESSION_B]
  );

  assert.throws(
    () => adaptErrorsLogTrace("REQUEST:\n{}\nFAILURE:\n{}\n"),
    (error) =>
      error instanceof AuthoringErgonomicsAdapterError && error.code === "no_recognizable_sections"
  );
});

test("the errors.log adapter preserves interleaved diagnostic calls in place", () => {
  const result = adaptErrorsLogTrace(JOURNAL, { diagnostic_tools: ["inline_read_only_query"] });
  assert.deepEqual(
    result.trace.events.map((event) => event.request.diagnostic),
    [false, false, true, false, false]
  );

  assert.equal(result.trace.events[2].request.tool, "inline_read_only_query");
  assert.equal(result.trace.events[2].event_index, 2);

  const undeclared = adaptErrorsLogTrace(JOURNAL);
  for (const event of undeclared.trace.events) assert.equal(event.request.diagnostic, null);
  assert.ok(unknownKinds(undeclared).includes("undeclared_diagnostic_intent"));
});

test("the errors.log adapter preserves caller-visible operation fields with request-side provenance", () => {
  const result = adaptErrorsLogTrace(JOURNAL, { ingress: "inline-mcp" });
  const [submit, , , authoring] = result.trace.events;

  assert.deepEqual(submit.request, {
    request_id: null,
    tool: "inline_submit_unit",
    ingress: "inline-mcp",
    diagnostic: null
  });
  assert.deepEqual(submit.target_identity, { target_kind: "work_unit", target_id: "WK-0001#SLICE-001" });
  assert.equal(submit.producer_boundary.boundary_id, "inline_submit_unit");
  assert.match(submit.provenance_note, /request-side caller assertions/);

  assert.deepEqual(result.trace.observed_identities, {
    repository: "inline-repo",
    records: ["WK-0001", "WK-0001#SLICE-001"],
    focus: null
  });

  assert.deepEqual(authoring.stage_observations, [
    {
      stage: "evaluation_input_ready",
      provenance: "caller_expected",
      completeness: "unknown",
      selected_resource_count: null
    }
  ]);
});

test("the errors.log adapter preserves bounded reason codes, diagnostic identities, and continuations", () => {
  const result = adaptErrorsLogTrace(JOURNAL);
  const [protocol, carrier, untyped, authoring, search] = result.trace.events;

  assert.deepEqual(protocol.response.reason_codes, ["mcp_protocol_error.-32602"]);
  assert.equal(protocol.response.transport_status, "error");
  assert.equal(protocol.response.application_status, "rejected");

  assert.deepEqual(carrier.response.reason_codes, [
    "inline_carrier_validation_failed",
    "inline_contract_request_refused",
    "inline_proof_refused"
  ]);
  assert.equal(carrier.response.invariant_family, "inline_v1");
  assert.equal(carrier.producer_boundary.producer_family, "inline-contract-mcp-refusal.v1");

  assert.deepEqual(carrier.response.revealed_invariants, [
    { invariant_id: "claim:claim-alpha", invariant_kind: "constraint", invariant_family: "mandatory_behavior_unverified" },
    { invariant_id: "pointer:/", invariant_kind: "constraint", invariant_family: "target_type_mismatch" }
  ]);

  assert.equal(carrier.continuation.route_present, false);
  assert.equal(carrier.continuation.replacement_call, null);

  assert.equal(untyped.continuation, null);
  assert.equal(untyped.response.reason_codes, null);
  assert.ok(unknownKinds(result).includes("untyped_producer_failure"));
  assert.ok(unknownKinds(result).includes("unknown_continuation_route"));

  assert.equal(authoring.continuation.replacement_call.tool, "inline_authoring_state");
  assert.equal(search.continuation.replacement_call.tool, "inline_build_search_index");

  assert.equal(search.continuation.replacement_call.named_tool_available, null);
});

test("errors.log never fabricates producer-measured response bytes", () => {
  const result = adaptErrorsLogTrace(JOURNAL, { diagnostic_tools: ["inline_read_only_query"] });
  assert.ok(result.trace.events.length > 0);
  assert.ok(result.trace.events.every((event) => event.response === null || event.response.response_bytes === null));
});

test("the errors.log adapter excludes prompts, carriers, secrets, environment, roots, and unbounded output", () => {
  const result = adaptErrorsLogTrace(JOURNAL, { source_locator: "/var/run/installation-root/errors.log" });
  const serialized = JSON.stringify(result.trace);

  for (const excluded of [
    "REDACT-ME",
    "secret_material",
    "/var/run/installation-root",
    "npm run inline",
    "No lexical search index",
    "Invalid arguments for tool",
    "an unbounded producer explanation",
    "canonical carrier does not exist"
  ]) {
    assert.equal(serialized.includes(excluded), false, `${excluded} must not reach the envelope`);
  }

  assert.equal(result.trace.source.source_locator, "<redacted-root>/errors.log");
  assert.ok(result.redactions.some((entry) => entry.kind === "installation_root_redacted"));

  assert.throws(
    () => adaptErrorsLogTrace(JOURNAL, { source_locator: "x".repeat(600) }),
    (error) => error.code === "value_too_long"
  );
});

test("a caller-supplied repository label crosses the same bound and root redaction", () => {
  const withRoot = section(
    SESSION_A,
    "inline_submit_unit",
    { repo: "/var/run/installation-root/checkouts/inline-repo", wk_id: "WK-0001" },
    typedRefusal("inline_refused", {})
  );
  const result = adaptErrorsLogTrace(withRoot);

  assert.equal(result.trace.observed_identities.repository, "<redacted-root>/inline-repo");
  assert.equal(
    JSON.stringify(result.trace).includes("/var/run/installation-root"),
    false,
    "an installation root must not reach the envelope through the repository label"
  );
  assert.ok(
    result.redactions.some(
      (entry) =>
        entry.kind === "installation_root_redacted" &&
        entry.field === "errors_log:section[0].request.repo"
    ),
    "the reduction must be recorded against the repository field"
  );

  assert.throws(
    () =>
      adaptErrorsLogTrace(
        section(SESSION_A, "inline_submit_unit", { repo: "r".repeat(513), wk_id: "WK-0001" }, typedRefusal("inline_refused", {}))
      ),
    (error) => error instanceof AuthoringErgonomicsAdapterError && error.code === "value_too_long"
  );

  const ordinary = adaptErrorsLogTrace(
    section(SESSION_A, "inline_submit_unit", { repo: "inline-repo", wk_id: "WK-0001" }, typedRefusal("inline_refused", {}))
  );
  assert.equal(ordinary.trace.observed_identities.repository, "inline-repo");
  assert.deepEqual(ordinary.redactions, []);
});

test("caller-supplied digests are not an authoritative identity and establish no producer defect", () => {
  const result = adaptErrorsLogTrace(JOURNAL);
  const serialized = JSON.stringify(result.trace);
  assert.equal(serialized.includes("sha256:caller-supplied"), false);
  assert.equal(serialized.includes("caller-held-token"), false);

  for (const event of result.trace.events) {
    assert.equal(event.authoritative_input_identity, null);
  }
  assert.equal(
    unknownKinds(result).filter((kind) => kind === "absent_authoritative_input_identity").length,
    result.trace.events.length
  );

  const report = detectAuthoringErgonomicsFindings(result.trace);

  assert.equal(metric(report, "repeated_refusal_episode_count").value, 0);
  assert.equal(report.episodes.length, result.trace.events.length);
  for (const episode of report.episodes) assert.equal(episode.identity_state, "unknown");

  assert.equal(
    report.observations.filter((observation) => observation.observation_id === "ERG-006").length,
    0
  );

  const producerFindings = report.observations.filter(
    (observation) => observation.finding && observation.axis === "producer"
  );
  assert.ok(producerFindings.length > 0);
  for (const finding of producerFindings) assert.equal(finding.observation_id, "ERG-003");
});

test("missing and malformed journal evidence becomes typed unknown, never an inferred fact", () => {
  const damaged = [
    `=== ${SESSION_A}: inline_a ===`,
    "REQUEST:",
    "{ this is not json",
    "FAILURE:",
    JSON.stringify(typedRefusal("inline_refused", {}), null, 2),
    "",
    `=== ${SESSION_A}: inline_b ===`,
    "REQUEST:",
    JSON.stringify({ repo: "inline-repo", wk_id: "WK-0002" }, null, 2),
    "",
    `=== ${SESSION_A}: inline_c ===`,
    "REQUEST:",
    "{}",
    "NOTES:",
    "an unrecognized block",
    "FAILURE:",
    JSON.stringify({ content: [{ type: "text", text: "no error flag" }] }, null, 2),
    ""
  ].join("\n");

  const result = adaptErrorsLogTrace(damaged);
  const kinds = unknownKinds(result);
  assert.ok(kinds.includes("malformed_request_block"));
  assert.ok(kinds.includes("missing_failure_block"));
  assert.ok(kinds.includes("unrecognized_block_label"));
  assert.ok(kinds.includes("absent_producer_error_flag"));

  assert.equal(result.trace.events[0].target_identity, null);

  assert.equal(result.trace.events[1].response, null);
  assert.equal(result.trace.events[1].continuation, null);

  assert.equal(result.trace.events[2].response.application_status, "unknown");

  assert.equal(result.trace.events.length, 3);
});

test("an unusable or empty journal refuses or reports unknown, never successful coverage", () => {
  assert.throws(
    () => adaptErrorsLogTrace(null),
    (error) => error.code === "adapter_input_invalid"
  );
  assert.throws(
    () => adaptErrorsLogTrace("a log body with no section headers at all"),
    (error) => error.code === "no_recognizable_sections"
  );
  assert.throws(
    () => adaptErrorsLogTrace(JOURNAL, { unexpected_option: true }),
    (error) => error.code === "unknown_field"
  );

  const empty = adaptErrorsLogTrace("   \n\n");
  assert.deepEqual(empty.trace.events, []);
  assert.ok(unknownKinds(empty).includes("empty_failure_journal"));

  assert.equal(declarationFor(empty, "tool_call").population_class, "failure_only");
  assert.equal(declarationFor(empty, "tool_call").normal_success_population_complete, false);
});

test("errors.log parsing is unchanged by irrelevant locator and workload-label changes", () => {
  const first = adaptErrorsLogTrace(JOURNAL, {
    trace_id: "T-1",
    source_locator: "runs/2020-01-01/alpha/errors.log",
    source_digest: "sha256:one",
    workload: "workload-alpha"
  });
  const second = adaptErrorsLogTrace(JOURNAL, {
    trace_id: "T-2",
    source_locator: "elsewhere/2099-12-31/omega/nested/deeper/errors.log",
    source_digest: "sha256:two",
    workload: "workload-omega"
  });

  assert.deepEqual(second.trace.events, first.trace.events);
  assert.deepEqual(second.trace.workflows, first.trace.workflows);
  assert.deepEqual(second.trace.observed_identities, first.trace.observed_identities);
  assert.deepEqual(
    second.trace.coverage.declarations.map(({ workload, ...rest }) => rest),
    first.trace.coverage.declarations.map(({ workload, ...rest }) => rest)
  );
  assert.deepEqual(unknownKinds(second), unknownKinds(first));
});

test("the retained-smoke adapter refuses a foreign envelope with a typed code", () => {
  assert.throws(
    () => adaptRetainedSmokeTrace(retained({ schema_version: "authoring-ergonomics-retained-smoke.v2" })),
    (error) =>
      error instanceof AuthoringErgonomicsAdapterError &&
      error.code === "unsupported_retained_schema_version"
  );
  assert.throws(
    () => adaptRetainedSmokeTrace("not an envelope"),
    (error) => error.code === "adapter_input_invalid"
  );
  assert.throws(
    () => adaptRetainedSmokeTrace(retained({ run_directory: "/var/run/installation-root/run-1" })),
    (error) => error.code === "unknown_field" && error.path === "retained_smoke.run_directory"
  );
  assert.throws(
    () =>
      adaptRetainedSmokeTrace(
        retained({ observations: [{ kind: "mcp_call", tool: "t", raw_prompt: "..." }] })
      ),
    (error) => error.code === "unknown_field" && error.path.endsWith(".raw_prompt")
  );
  assert.throws(
    () => adaptRetainedSmokeTrace(retained({ observations: [{ kind: "speculative_guess" }] })),
    (error) => error.code === "invalid_enum"
  );

  assert.throws(
    () =>
      adaptRetainedSmokeTrace(
        retained({
          observations: [
            { kind: "dispatch", ordinal: 3, paid: true },
            { kind: "dispatch", ordinal: 3, paid: false }
          ]
        })
      ),
    (error) => error.code === "duplicate_source_position"
  );
});

test("a retained family is marked complete only when the source proves it captured every call", () => {
  const proven = adaptRetainedSmokeTrace(retained());
  const declaration = declarationFor(proven, "tool_call");
  assert.equal(declaration.population_class, "normal_and_failure");
  assert.equal(declaration.normal_success_population_complete, true);
  assert.match(proven.coverage_summary[0].basis, /captured every call/);
  assert.equal(unknownKinds(proven).includes("unproven_capture_completeness"), false);

  const report = detectAuthoringErgonomicsFindings(proven.trace);
  assert.equal(metric(report, "tool_call_count").evidence_state, "declared_normal_and_failure");
  assert.equal(metric(report, "tool_call_count").eligible_population.normal_success_population_complete, true);
});

test("every weaker capture statement becomes typed unknown coverage, never a completeness claim", () => {
  const weaker = [
    { capture_mode: "all_calls", captured_record_count: 1, total_record_count: 2 },
    { capture_mode: "all_calls", captured_record_count: null, total_record_count: null },
    { capture_mode: "all_calls" },
    { capture_mode: "sampled", captured_record_count: 2, total_record_count: 2 },
    {}
  ];

  for (const statement of weaker) {
    const result = adaptRetainedSmokeTrace(
      retained({ capture: { declarations: [{ event_families: ["tool_call"], ...statement }] } })
    );
    const declaration = declarationFor(result, "tool_call");
    assert.equal(declaration.population_class, "unknown", JSON.stringify(statement));
    assert.equal(declaration.normal_success_population_complete, null, JSON.stringify(statement));
    assert.ok(unknownKinds(result).includes("unproven_capture_completeness"));

    const report = detectAuthoringErgonomicsFindings(result.trace);
    assert.equal(metric(report, "tool_call_count").evidence_state, "unknown_population");
    assert.notEqual(
      metric(report, "tool_call_count").eligible_population.normal_success_population_complete,
      true
    );
  }

  const failuresOnly = adaptRetainedSmokeTrace(
    retained({ capture: { declarations: [{ event_families: ["tool_call"], capture_mode: "failures_only" }] } })
  );
  assert.equal(declarationFor(failuresOnly, "tool_call").population_class, "failure_only");
  assert.equal(declarationFor(failuresOnly, "tool_call").normal_success_population_complete, false);

  assert.throws(
    () =>
      adaptRetainedSmokeTrace(
        retained({ capture: { declarations: [{ event_families: ["tool_call"], capture_mode: "probably_all" }] } })
      ),
    (error) => error.code === "invalid_enum"
  );
  assert.throws(
    () =>
      adaptRetainedSmokeTrace(
        retained({
          capture: {
            declarations: [
              { event_families: ["tool_call"], capture_mode: "all_calls", captured_record_count: 1, total_record_count: 1 },
              { event_families: ["tool_call"], capture_mode: "failures_only" }
            ]
          }
        })
      ),
    (error) => error.code === "duplicate_capture_declaration"
  );
});

test("an observed family with no capture declaration stays unavailable rather than zero", () => {
  const result = adaptRetainedSmokeTrace(
    retained({
      observations: [
        { kind: "dispatch", session_token: "RUN-1", paid: true, dispatched_unit: "WK-0001#SLICE-001" }
      ],
      capture: { declarations: [{ event_families: ["tool_call"], capture_mode: "failures_only" }] }
    })
  );
  assert.ok(unknownKinds(result).includes("undeclared_observed_family"));

  const report = detectAuthoringErgonomicsFindings(result.trace);
  const paid = metric(report, "paid_dispatch_reached_count");
  assert.equal(paid.value, null, "an undeclared population is unknown, not zero");
  assert.equal(paid.evidence_state, "unavailable");

  const noCapture = adaptRetainedSmokeTrace(retained({ capture: null }));
  assert.deepEqual(noCapture.trace.coverage.declarations, []);
  assert.ok(unknownKinds(noCapture).includes("absent_capture_declaration"));
});

test("the retained-smoke adapter keeps request assertions and producer observations apart", () => {
  const result = adaptRetainedSmokeTrace(retained());
  const [first, second] = result.trace.events;

  const callerStages = first.stage_observations.filter((stage) => stage.provenance === "caller_expected");
  assert.deepEqual(callerStages, [
    { stage: "contract_required", provenance: "caller_expected", completeness: "unknown", selected_resource_count: null }
  ]);
  assert.match(first.provenance_note, /never establish a producer defect/);

  assert.deepEqual(first.stage_observations.filter((stage) => stage.provenance === "producer_returned"), [
    { stage: "proof_ready", provenance: "producer_returned", completeness: "complete", selected_resource_count: 2 }
  ]);

  const report = detectAuthoringErgonomicsFindings(result.trace);
  const regressions = report.observations.filter((observation) => observation.observation_id === "ERG-006");
  assert.equal(regressions.length, 1);
  assert.equal(regressions[0].evidence.provenance, "producer_returned");
  assert.equal(regressions[0].evidence.earlier_completeness, "complete");
  assert.equal(regressions[0].evidence.later_completeness, "incomplete");

  const withoutAssertions = retained();
  delete withoutAssertions.observations[0].request_assertions;
  const bare = detectAuthoringErgonomicsFindings(adaptRetainedSmokeTrace(withoutAssertions).trace);
  assert.equal(
    bare.observations.filter((observation) => observation.observation_id === "ERG-006").length,
    1
  );

  const assertionsOnly = retained({
    observations: [
      {
        kind: "mcp_call",
        session_token: "RUN-1",
        tool: "inline_persist",
        authoritative_identity: GEN_1,
        request_assertions: { expected_stage: "proof_ready" }
      },
      {
        kind: "mcp_call",
        session_token: "RUN-1",
        tool: "inline_persist",
        authoritative_identity: GEN_1,
        request_assertions: { expected_stage: "contract_required" }
      }
    ]
  });
  const noProducerFacts = detectAuthoringErgonomicsFindings(adaptRetainedSmokeTrace(assertionsOnly).trace);
  assert.equal(
    noProducerFacts.observations.filter(
      (observation) => observation.finding && observation.axis === "producer"
    ).length,
    0
  );
  assert.equal(second.stage_observations[0].provenance, "producer_returned");
});

test("[claim-semantic-recovery-validity] retained responses carry only structured recovery identity and measured bytes", () => {
  const recoveryIdentity = {
    work_record_id: "WK-9001",
    carrier_generation: "GEN-A",
    verification_id: "claim-a",
    semantic_objective: "persist_atomic_verification_bundle"
  };
  const input = retained();
  input.observations[0].response.recovery_identity = recoveryIdentity;
  input.observations[0].response.response_bytes = 777;
  input.observations[1].response.recovery_identity = {
    work_record_id: "WK-9001",
    carrier_generation: "GEN-A",
    semantic_objective: "persist_atomic_verification_bundle"
  };

  const result = adaptRetainedSmokeTrace(input);
  assert.deepEqual(result.trace.events[0].recovery_identity, recoveryIdentity);
  assert.equal(result.trace.events[0].response.response_bytes, 777);
  assert.deepEqual(result.trace.events[1].recovery_identity, {
    work_record_id: "WK-9001",
    carrier_generation: "GEN-A",
    verification_id: null,
    semantic_objective: "persist_atomic_verification_bundle"
  });
  assert.equal(result.trace.events[1].response.response_bytes, null);

  const callerLabel = retained();
  callerLabel.observations[0].recovery_identity = recoveryIdentity;
  assert.throws(
    () => adaptRetainedSmokeTrace(callerLabel),
    (error) => error.code === "unknown_field" && error.path.endsWith("recovery_identity")
  );

  const promptDerived = retained();
  promptDerived.observations[0].response.prompt_text = "WK-9001 GEN-A claim-a";
  assert.throws(
    () => adaptRetainedSmokeTrace(promptDerived),
    (error) => error.code === "unknown_field" && error.path.endsWith("prompt_text")
  );

  const runBound = retained();
  runBound.observations[0].response.run_identity = "retained-run-1";
  assert.throws(
    () => adaptRetainedSmokeTrace(runBound),
    (error) => error.code === "unknown_field" && error.path.endsWith("run_identity")
  );
});

test("the retained-smoke adapter preserves receipts, effects, lifecycle, dispatch, and workload facts", () => {
  const result = adaptRetainedSmokeTrace(
    retained({
      capture: {
        declarations: [
          { event_families: ["tool_call"], capture_mode: "all_calls", captured_record_count: 2, total_record_count: 2 },
          {

            event_families: [
              "authoritative_ref_observation",
              "persistence_receipt",
              "dispatch_observation",
              "validation_observation",
              "integration_observation"
            ],
            capture_mode: "all_calls",
            captured_record_count: 6,
            total_record_count: 6
          }
        ]
      },
      observations: [
        ...retained().observations,
        {
          kind: "carrier_observation",
          session_token: "RUN-1",
          carrier_id: "CS-1",
          lifecycle_stage: "wk_ref",
          presence: "absent",
          content_identity: "sha256:carrier"
        },
        { kind: "carrier_observation", session_token: "RUN-1", carrier_id: "CS-2", lifecycle_stage: "integrated_tip", presence: "unresolved" },
        { kind: "dispatch", session_token: "RUN-1", paid: true, dispatched_unit: "WK-0001#SLICE-001", action_kind: "worker" },
        {
          kind: "record_validation",
          session_token: "RUN-1",
          producer: "inline_record_validator",
          unit: "WK-0001",
          divergences: [{ code: "parent_placeholder_summary", parent_subject: "WK-0001", severity: "high" }]
        },
        { kind: "workload_result", session_token: "RUN-1", observation_kind: "test", outcome: "success", label: "inline suite" },
        { kind: "workload_result", session_token: "RUN-1", observation_kind: "integration", outcome: "success" }
      ]
    })
  );

  const byKind = (kind) => result.trace.events.filter((event) => event.event_kind === kind);

  assert.deepEqual(result.trace.events[0].receipt, { receipt_state: "absent", receipt_id: null });
  assert.deepEqual(result.trace.events[1].receipt, { receipt_state: "present", receipt_id: "RCPT-1" });

  assert.equal(result.trace.events[0].claimed_effects[0].observation_provenance, "producer_returned");
  assert.equal(result.trace.events[1].observed_effects[0].observation_provenance, "authoritative_observed");

  assert.equal(byKind("authoritative_ref_observation").length, 2);
  assert.equal(byKind("authoritative_ref_observation")[0].carrier_observation.presence, "absent");
  assert.ok(unknownKinds(result).includes("unresolved_carrier_reference"));

  assert.equal(byKind("dispatch_observation")[0].dispatch_facts.paid, true);
  assert.equal(byKind("validation_observation")[0].validation_facts.producer, "inline_record_validator");
  assert.equal(
    byKind("validation_observation")[0].validation_facts.divergences[0].code,
    "parent_placeholder_summary"
  );
  assert.equal(byKind("validation_observation")[1].workload_observation.outcome, "success");
  assert.equal(byKind("integration_observation")[0].workload_observation.observation_kind, "integration");

  const report = detectAuthoringErgonomicsFindings(result.trace);
  assert.equal(metric(report, "paid_dispatch_reached_count").value, 1);
  assert.equal(metric(report, "authoritative_effect_observed_count").value, 1);

  const falseGreen = report.observations.find((observation) => observation.observation_id === "ERG-011");
  assert.equal(falseGreen.finding, true);
  assert.equal(falseGreen.outcome, "false_green_workload");
  assert.ok(report.axes_present.includes("record_quality"));
  assert.ok(report.axes_present.includes("workload"));
});

test("absent optional retained evidence stays unknown and is reported, never zeroed", () => {
  const sparse = adaptRetainedSmokeTrace(
    retained({
      sessions: null,
      observed_identities: null,
      retained_source: { source_kind: "retained_smoke", source_locator: "retained://inline" },
      observations: [{ kind: "mcp_call", tool: "inline_persist" }]
    })
  );

  const [event] = sparse.trace.events;
  assert.equal(event.workflow_token, null);
  assert.equal(event.response, null);
  assert.equal(event.receipt, null);
  assert.equal(event.continuation, null);
  assert.equal(event.claimed_effects, null, "an absent effect list is unknown, not observed-none");
  assert.equal(event.observed_effects, null);
  assert.equal(event.authoritative_input_identity, null);
  assert.equal(event.request.diagnostic, null);
  assert.equal(sparse.trace.source.source_digest, null);
  assert.deepEqual(sparse.trace.observed_identities, { repository: null, records: null, focus: null });

  const kinds = unknownKinds(sparse);
  for (const expected of [
    "absent_session_token",
    "absent_session_partition",
    "absent_source_digest",
    "absent_producer_response",
    "absent_receipt_observation",
    "absent_authoritative_input_identity",
    "undeclared_diagnostic_intent"
  ]) {
    assert.ok(kinds.includes(expected), `${expected} must be reported as unknown evidence`);
  }

  const explicit = adaptRetainedSmokeTrace(
    retained({
      observations: [
        { kind: "record_validation", producer: "inline_record_validator", divergences: [] },
        { kind: "record_validation", producer: "inline_record_validator" }
      ]
    })
  );
  assert.deepEqual(explicit.trace.events[0].validation_facts.divergences, []);
  assert.equal(explicit.trace.events[1].validation_facts.divergences, null);
  assert.ok(unknownKinds(explicit).includes("unknown_validation_divergences"));
});

test("the retained-smoke adapter excludes installation roots and refuses unbounded values", () => {
  const result = adaptRetainedSmokeTrace(
    retained({
      retained_source: {
        source_kind: "retained_smoke",
        source_locator: "/var/run/installation-root/runs/run-1/progress.ndjson",
        source_ordinal: 0
      }
    })
  );
  assert.equal(result.trace.source.source_locator, "<redacted-root>/progress.ndjson");
  assert.ok(result.redactions.some((entry) => entry.kind === "installation_root_redacted"));
  assert.equal(JSON.stringify(result.trace).includes("/var/run/installation-root"), false);

  assert.throws(
    () => adaptRetainedSmokeTrace(retained({ workload_label: "w".repeat(600) })),
    (error) => error.code === "value_too_long"
  );
  assert.throws(
    () =>
      adaptRetainedSmokeTrace(
        retained({
          observations: Array.from({ length: 5001 }, (unused, index) => ({ kind: "dispatch", ordinal: index }))
        })
      ),
    (error) => error.code === "source_too_large"
  );
});

test("retained-smoke parsing is unchanged by run-directory and workload-identity changes", () => {
  const first = adaptRetainedSmokeTrace(retained());
  const second = adaptRetainedSmokeTrace(
    retained({
      trace_id: "OTHER-TRACE",
      retained_source: {
        source_kind: "retained_smoke_v2_layout",
        source_locator: "some/other/run-root/2099/nested/deeper/retained.json",
        source_digest: "sha256:different",
        source_ordinal: 0
      },
      workload_label: "a completely different workload",
      observed_identities: { repository: "other-repo", records: ["WK-9999", "IN-9999"], focus: "other-focus" }
    })
  );

  assert.deepEqual(second.trace.events, first.trace.events);
  assert.deepEqual(second.trace.coverage, first.trace.coverage);
  assert.deepEqual(second.trace.workflows, first.trace.workflows);
  assert.deepEqual(second.coverage_summary, first.coverage_summary);
  assert.deepEqual(unknownKinds(second), unknownKinds(first));

  assert.equal(second.trace.observed_identities.repository, "other-repo");
  assert.equal(second.trace.workload_fixture, "a completely different workload");

  const firstReport = detectAuthoringErgonomicsFindings(first.trace);
  const secondReport = detectAuthoringErgonomicsFindings(second.trace);
  assert.deepEqual(
    secondReport.observations.map((observation) => [observation.observation_id, observation.outcome, observation.finding]),
    firstReport.observations.map((observation) => [observation.observation_id, observation.outcome, observation.finding])
  );
  assert.deepEqual(
    secondReport.metrics.map((entry) => [entry.metric, entry.value, entry.evidence_state]),
    firstReport.metrics.map((entry) => [entry.metric, entry.value, entry.evidence_state])
  );
});
