import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  assertComparableControlledAuthoringMeasurements,
  measureControlledAuthoringJourney,
  validateControlledAuthoringBenchmarkArtifact
} from "../../packages/agent-launch-cli/src/lib/controlled-authoring-journey-measurement.mjs";

const TOOL = "workspace_controlled_contract_prepare_design";

function request(id, args, name = TOOL) {
  return JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call",
    params: { name, arguments: args } });
}

function response(id, result = { isError: false }) {
  return JSON.stringify({ jsonrpc: "2.0", id, result });
}

function initialize(id = 1) {
  return JSON.stringify({ jsonrpc: "2.0", id, method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {},
      clientInfo: { name: "measurement-test", version: "1.0.0" } } });
}

function failure(id, message = "runtime failed") {
  return JSON.stringify({ jsonrpc: "2.0", id,
    error: { code: -32_000, message } });
}

function identity(side = "candidate", overrides = {}) {
  return { run_id: `${side}-run`, side, journey: "add", task_identity: "task:add",
    source: { identity: `${side}:source`, content_digest: `${side}:content` },
    runtime: { identity: "node:v24" },
    configuration: { identity: "config:v1" }, ...overrides };
}

function observations(ids, evidenceIdentity, phases = []) {
  return ids.map((requestId, index) => ({ request_id: requestId,
    run_id: evidenceIdentity.run_id,
    source_identity: evidenceIdentity.source.identity,
    phase: phases[index] ?? `phase-${index + 1}`, elapsed_ms: index + 0.5 }));
}

function measure({ requests = [], responses = [], side = "candidate",
  identityOverrides = {}, observationOverrides = null,
  modelTokenObservation = null } = {}) {
  const evidenceIdentity = identity(side, identityOverrides);
  return measureControlledAuthoringJourney({
    requestBytes: requests.length === 0 ? "" : `${requests.join("\n")}\n`,
    responseBytes: responses.length === 0 ? "" : `${responses.join("\n")}\n`,
    observations: observationOverrides ?? observations(
      requests.map((line) => JSON.parse(line).id), evidenceIdentity),
    evidenceIdentity, modelTokenObservation
  });
}

test("complete capture counts successes, refusals, failures and cost classes", () => {
  const semantic = { kind: "contract_requirements",
    requirements: [{ modality: "MUST" }] };
  const refused = { isError: true, structuredContent: { warning: { payload: {
    details: { changed: false } } } } };
  const measured = measure({ requests: [
    request(1, { subject: { wk_id: "WK-2520" } }),
    request(2, { subject: { wk_id: "WK-2520" }, snapshot_identity: "one",
      collection: "actionable_rows" }),
    request(3, { subject: { wk_id: "WK-2520" }, continuation: "one",
      response: semantic }),
    request(4, { subject: { wk_id: "WK-2520" }, continuation: "one",
      response: { requirements: [{ modality: "MUST" }],
        kind: "contract_requirements" } }),
    request(5, { subject: { wk_id: "WK-2520" }, continuation: "two",
      response: { kind: "advance_authoring" } }),
    request(6, { routing_intents: ["controlled_contract_authoring"] },
      "workspace_tools_list")
  ], responses: [response(1), response(2), response(3),
    response(4, refused), failure(5), response(6)] });
  assert.deepEqual(measured.calls, { total: 6, succeeded: 4, refused: 1,
    failed: 1, unmatched: 0, semantic: 2, mechanical: 1, retrieval: 1,
    discovery: 1, preparation: 1, observed_retries: 0, repeated_semantic_input: 1,
    repeated_identical_request: 1 });
  assert.equal(measured.capture.state, "complete");
  assert.equal(measured.elapsed.state, "complete");
  assert.equal(measured.entries[3].effect, "reported_no_effect");
  assert.deepEqual(measured.entries[3].attribution,
    { responsibility: "unknown", basis: "not_authored" });
  assert.deepEqual(measured.entries[4].attribution,
    { responsibility: "unknown", basis: "not_authored" });
  assert.equal(measured.transcript_payload_values_emitted, false);
});

test("retries are counted only from an observed request relationship", () => {
  const evidenceIdentity = identity();
  const measured = measure({ requests: [request(1, {}), request(2, {})],
    responses: [failure(1), response(2)],
    observationOverrides: [
      { ...observations([1], evidenceIdentity)[0], phase: "initial" },
      { ...observations([2], evidenceIdentity)[0], phase: "retry",
        retry_of_request_id: 1 }
    ] });
  assert.equal(measured.calls.repeated_identical_request, 1);
  assert.equal(measured.calls.observed_retries, 1);
  assert.deepEqual(measured.entries[1].retry,
    { state: "observed", request_id: 1 });
});

test("initialize is paired and timed as protocol traffic without becoming a tool operation", () => {
  const evidenceIdentity = identity();
  const measured = measure({
    requests: [initialize(1), request(2, {})],
    responses: [response(1, { protocolVersion: "2024-11-05" }), response(2)],
    observationOverrides: [
      { request_id: 1, run_id: evidenceIdentity.run_id,
        source_identity: evidenceIdentity.source.identity, phase: null, elapsed_ms: 4.25 },
      { request_id: 2, run_id: evidenceIdentity.run_id,
        source_identity: evidenceIdentity.source.identity, phase: "dispatch", elapsed_ms: 2.5 }
    ]
  });
  assert.equal(measured.capture.state, "complete");
  assert.deepEqual(measured.capture.unmatched_response_ids, []);
  assert.deepEqual(measured.protocol, { request_count: 2, response_count: 2,
    handshake_count: 1, handshake_elapsed_ms: 4.25, tool_operation_count: 1 });
  assert.equal(measured.calls.total, 1);
  assert.equal(measured.elapsed.total_ms, 2.5);
});

test("request ids may be reused only across separately measured server sessions", () => {
  for (const side of ["baseline", "candidate"]) {
    const evidenceIdentity = identity(side);
    const measured = measure({ side,
      requests: [initialize(1), request(2, {})], responses: [response(1), response(2)],
      observationOverrides: observations([1, 2], evidenceIdentity) });
    assert.equal(measured.capture.state, "complete");
    assert.deepEqual(measured.capture.duplicate_request_ids, []);
    assert.deepEqual(measured.capture.duplicate_response_ids, []);
  }
  const duplicate = measure({ requests: [initialize(1), request(1, {})],
    responses: [response(1), response(1)] });
  assert.equal(duplicate.capture.state, "incomplete");
  assert.deepEqual(duplicate.capture.duplicate_request_ids, ["number:1"]);
  assert.deepEqual(duplicate.capture.duplicate_response_ids, ["number:1"]);
});

test("missing requests, results, observations and phases make capture incomplete", () => {
  const evidenceIdentity = identity();
  const measured = measureControlledAuthoringJourney({
    requestBytes: `${request(1, {})}\n${request(2, {})}\n`,
    responseBytes: `${response(1)}\n${response(3)}\n`,
    observations: [...observations([1], evidenceIdentity), {
      request_id: 4, run_id: evidenceIdentity.run_id,
      source_identity: evidenceIdentity.source.identity,
      phase: "orphan", elapsed_ms: 1 }],
    expectedPhases: ["phase-1", "never-observed"], evidenceIdentity
  });
  assert.equal(measured.capture.state, "incomplete");
  assert.deepEqual(measured.capture.unmatched_request_ids, [2]);
  assert.deepEqual(measured.capture.unmatched_response_ids, ["number:3"]);
  assert.deepEqual(measured.capture.unmatched_observation_ids, ["number:4"]);
  assert.deepEqual(measured.capture.unobserved_phases, ["never-observed"]);
  assert.equal(measured.calls.total, 2,
    "the unmatched call remains in the denominator");
});

test("mixed run or source observations are rejected as incomplete evidence", () => {
  const measured = measure({ requests: [request(1, {})], responses: [response(1)],
    observationOverrides: [{ request_id: 1, run_id: "another-run",
      source_identity: "another-source", phase: "prepare", elapsed_ms: 1 }] });
  assert.equal(measured.evidence_identity.state, "incomplete");
  assert.equal(measured.evidence_identity.mixed_observation_identity, true);
  assert.equal(measured.capture.state, "incomplete");
  assert.throws(() => assertComparableControlledAuthoringMeasurements(
    measure({ side: "baseline" }), measured), /capture is incomplete/u);
});

test("token totals require an observed client projection and complete identities", () => {
  const incomplete = measure({ modelTokenObservation: {
    client: "client-v1", model: "model-v1", tokenizer: "tokenizer-v1",
    input_tokens: 10, output_tokens: 4 } });
  assert.equal(incomplete.tokens.state, "unavailable");
  assert.equal(incomplete.tokens.input_tokens, null);
  const measured = measure({ modelTokenObservation: {
    source: "observed_client_projection", client: "client-v1", model: "model-v1",
    tokenizer: "tokenizer-v1", projection: "mcp-visible-v1",
    input_tokens: 10, output_tokens: 4 } });
  assert.deepEqual(measured.tokens, { state: "measured", reason: null,
    input_tokens: 10, output_tokens: 4, client: "client-v1", model: "model-v1",
    tokenizer: "tokenizer-v1", projection: "mcp-visible-v1",
    source: "observed_client_projection", bytes_are_not_tokens: true });
});

test("comparisons reject mixed task, runtime, configuration and source identities", () => {
  const baseline = measure({ side: "baseline" });
  const candidate = measure({ side: "candidate" });
  assert.equal(assertComparableControlledAuthoringMeasurements(baseline, candidate), true);
  for (const overrides of [{ journey: "edit" },
    { task_identity: "task:other" }, { runtime: { identity: "node:other" } },
    { configuration: { identity: "config:other" } }]) {
    const incompatible = measure({ side: "candidate", identityOverrides: overrides });
    assert.throws(() => assertComparableControlledAuthoringMeasurements(
      baseline, incompatible), /incompatible|distinct run and source/u);
  }
  const missingContentIdentity = measure({ side: "candidate",
    identityOverrides: { source: { identity: "candidate:source" } } });
  assert.throws(() => assertComparableControlledAuthoringMeasurements(
    baseline, missingContentIdentity), /capture is incomplete/u);
});

test("equal content with differently encoded source identities is comparable only as a control",
  () => {
    const baseline = measure({ side: "baseline",
      identityOverrides: { source: { identity: "git:one", content_digest: "tree:same" } } });
    const candidate = measure({ side: "candidate",
      identityOverrides: { source: { identity: "worktree:two", content_digest: "tree:same" } } });
    assert.equal(assertComparableControlledAuthoringMeasurements(baseline, candidate), true);
  });

test("benchmark validator refuses synthetic sequences and lost semantic outcomes", () => {
  const required = {
    add: { contract_absent_before: true, contract_present_after: true,
      authored_requirement_present: true, next_semantic_question_present: true,
      final_handoff_succeeded: true },
    edit: { unrelated_meaning_preserved: true, selected_proof_changed: true,
      selected_observable_changed: true, durable_outcome_present: true,
      final_handoff_succeeded: true },
    recover: { refusal_reported_no_effect: true, refusal_published_nothing: true,
      correction_published_exactly_once: true, corrected_requirement_present: true,
      next_semantic_question_present: true, final_handoff_succeeded: true },
    population: { complete_definition_population: true,
      extension_after_first_four: true, final_handoff_succeeded: true }
  };
  const run = (measurement, checks) => ({ measurement,
    raw_capture: { boundary: "local_work_evidence_only",
      request: "request.jsonl", response: "response.jsonl",
      evidence_directory: "side/journey" },
    outcome_checks: { all_passed: true, checks,
      durable_effect: { equivalent: true } } });
  const artifact = { schema_version: "controlled-authoring-paired-benchmark.v2",
    evidence_kind: "actual_production_registered_mcp_execution",
    execution_mode: "isolated_production_registered_mcp_transport",
    baseline: { intent: "improvement" },
    validity: { state: "valid", first_cause: null },
    source_comparison: { classification: "different_source_candidate" },
    tokens: { state: "unavailable" },
    improvement_claim: { eligible: false, reason: "token_evidence_unavailable" }, sides: {
      baseline: { source: { content_digest: "baseline:content" },
        runs: Object.fromEntries(Object.entries(required)
        .map(([journey, checks]) => [journey, run(measure({ side: "baseline",
          identityOverrides: { journey, task_identity: `task:${journey}` } }), checks)])) },
      candidate: { source: { content_digest: "candidate:content" },
        runs: Object.fromEntries(Object.entries(required)
        .map(([journey, checks]) => [journey, run(measure({ side: "candidate",
          identityOverrides: { journey, task_identity: `task:${journey}` } }), checks)])) }
    } };
  assert.equal(validateControlledAuthoringBenchmarkArtifact(artifact), true);
  const equalSourceControl = structuredClone(artifact);
  equalSourceControl.baseline.intent = "control";
  equalSourceControl.sides.candidate.source.content_digest = "baseline:content";
  for (const runResult of Object.values(equalSourceControl.sides.candidate.runs)) {
    runResult.measurement.evidence_identity.value.source.content_digest =
      "baseline:content";
  }
  equalSourceControl.source_comparison.classification = "equal_source_control";
  equalSourceControl.improvement_claim = { eligible: false,
    reason: "equal_source_control" };
  assert.equal(validateControlledAuthoringBenchmarkArtifact(equalSourceControl), true);
  equalSourceControl.improvement_claim.eligible = true;
  assert.throws(() => validateControlledAuthoringBenchmarkArtifact(equalSourceControl),
    /cannot produce an improvement claim/u);
  const synthetic = structuredClone(artifact);
  synthetic.execution_mode = "predefined_step_lists";
  assert.throws(() => validateControlledAuthoringBenchmarkArtifact(synthetic),
    /not production-registered MCP transport evidence/u);
  const losesMeaning = structuredClone(artifact);
  losesMeaning.sides.candidate.runs.edit.outcome_checks.checks
    .unrelated_meaning_preserved = false;
  assert.throws(() => validateControlledAuthoringBenchmarkArtifact(losesMeaning),
    /failed required check unrelated_meaning_preserved/u);
  const differentOutcome = structuredClone(artifact);
  differentOutcome.sides.candidate.runs.add.outcome_checks.durable_effect = {
    equivalent: false };
  assert.throws(() => validateControlledAuthoringBenchmarkArtifact(differentOutcome),
    /durable outcomes are not equivalent/u);
});

test("legacy step-list fixture is labeled synthetic counter input, not benchmark evidence", () => {
  const fixture = JSON.parse(readFileSync(new URL(
    "../fixtures/wk2520-authoring-journeys.v1.json", import.meta.url), "utf8"));
  assert.equal(fixture.evidence_kind, "synthetic_counter_unit_fixture_not_benchmark_evidence");
  assert.equal(fixture.token_measurement.state, "unavailable");
});
