

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createResumableLifecycleHarness,
  createDispatchToolRegistry,
  readStructuredResult
} from "../../packages/wiki-mcp/src/lib/dispatch-tools-test-helpers.mjs";
import {
  RUN_STATUS_AUTHORED_CONTRACT_PROJECTION_SCHEMA_VERSION,
  RUN_STATUS_CONTROLLED_GENERATION_PROJECTION_SCHEMA_VERSION,
  TERMINAL_CANDIDATE_AUTHORED_CONTRACT_MEMBERS,
  projectPublishedControlledGeneration,
  projectPublishedSliceLifecycle,
  readTerminalCandidateAuthoredContracts,
  readTerminalCandidateControlledGeneration
} from "../../packages/wiki-mcp/src/lib/dispatch-run-status-authored-contract-projection.mjs";
import {
  readSelectedResponseSource,
  SELECTED_RESPONSE_SOURCE_SCHEMA_VERSION
} from "../../packages/wiki-mcp/src/lib/selected-response-snapshot.mjs";

import {
  BASE,
  CANDIDATE,
  GENERATION_REPOSITORY_ROOT,
  MALFORMED_FINAL_RESULT,
  REPOSITORY,
  SLICE_ID,
  SUBJECT,
  TIP,
  WK_ID,
  authoredRecord,
  controlledGeneration,
  controlledGenerationIdentity,
  finalizedLifecycle,
  followRetrievalCall,
  observationBackend,
  observe,
  retainedArtifacts,
  retrievalRegistry,
  sha256Hex,
  terminalCandidate,
  syntheticRecordedInvocation,
  terminalWorkerStatus,
  unfailedAttemptSelection,
  versionDecision
} from "../helpers/run-status-authored-document-fixture.mjs";
import {
  assertDefaultStatusFrame,
  defaultStatusConclusion,
  responseRepetitions
} from "../helpers/mcp-journey-accounting.mjs";

const COMPLETE = Object.freeze({ subject: SUBJECT, include_final_result: true });

const defaultFrame = (observed, label) =>
  assertDefaultStatusFrame([{ raw: observed.result, entry: { id: label } }], label);
import { createTestResourceScope } from "../helpers/test-resource-scope.mjs";
import { createAuthoredContractRetention } from
  "../../packages/wiki-mcp/src/lib/dispatch-run-status-authored-contract-retention.mjs";
import { measureMcpInlineResultBytes } from "../../packages/wiki-mcp/src/lib/mcp-response.mjs";

function authoredContractsOf(structured) {
  return structured.slice_lifecycle.terminal_candidate.review_unit.authored_contracts;
}

function unprojectedBytes(observed, candidate) {
  const clone = structuredClone(observed.structured);
  const reviewUnit = clone.slice_lifecycle.terminal_candidate.review_unit;
  delete reviewUnit.authored_contracts;
  reviewUnit.canonical_parent_wk_contract = candidate.contracts.canonical_parent_wk_contract;
  reviewUnit.review_unit_contract = candidate.contracts.slice_review_contract;
  return measureMcpInlineResultBytes(clone);
}

test("WK-2691: the reproduced leak — run status publishes the authored contracts as identity, not as documents", async () => {
  const scope = createTestResourceScope();
  try {
  const record = authoredRecord();
  const candidate = terminalCandidate(record);
  const { tools } = await retrievalRegistry(scope, "leak", observationBackend({
    status: terminalWorkerStatus(),
    lifecycle: finalizedLifecycle(candidate)
  }));

  const observed = await observe(tools, COMPLETE);
  const reviewUnit = observed.structured.slice_lifecycle.terminal_candidate.review_unit;

  for (const { member } of TERMINAL_CANDIDATE_AUTHORED_CONTRACT_MEMBERS) {
    assert.equal(Object.hasOwn(reviewUnit, member), false, `${member} must not be echoed`);
  }
  const wire = JSON.stringify(observed.structured);
  assert.equal(wire.includes("parent criterion 19"), false, "no parent acceptance criterion is echoed");
  assert.equal(wire.includes("slice 1 criterion"), false, "no sibling slice contract is echoed");

  const projection = reviewUnit.authored_contracts;
  assert.equal(projection.schema_version, RUN_STATUS_AUTHORED_CONTRACT_PROJECTION_SCHEMA_VERSION);
  assert.equal(projection.grants_authority, false);
  assert.equal(projection.source_member_count, 2);
  assert.equal(projection.returned_member_count, 0);
  assert.equal(projection.omitted_member_count, 2);
  assert.deepEqual(projection.omitted.map((row) => row.member),
    ["canonical_parent_wk_contract", "review_unit_contract"]);
  assert.equal(projection.omitted[0].utf8_bytes,
    Buffer.byteLength(candidate.contracts.canonical_parent_wk_contract, "utf8"));
  assert.match(projection.omitted[0].digest, /^sha256:[0-9a-f]{64}$/u);
  assert.notEqual(projection.omitted[0].digest, projection.omitted[1].digest);

  const retrieval = projection.retrieval;
  assert.equal(retrieval.state, "retained");
  assert.equal(retrieval.source_schema_version, SELECTED_RESPONSE_SOURCE_SCHEMA_VERSION);
  assert.equal(retrieval.retained_source_read.tool, "workspace_read_mcp_content_reference");
  assert.deepEqual(retrieval.retained_source_read.arguments,
    { ref_id: retrieval.ref_id, offset: 0 });
  assert.equal(typeof retrieval.retained_source_read.success_predicate.fact, "string");
  assert.deepEqual(retrieval.binding, {
    route: "workspace_agent_run_status",
    repository: "agent-chassis",
    unit: SUBJECT,
    observation_identity: {
      attempt_id: "run-worker-2691",
      monitor_handle: "wkmh_worker_2691",
      subject: SUBJECT,
      candidate: CANDIDATE,
      candidate_ref: `refs/terminal-candidates/${WK_ID}/1`,
      base: BASE,
      wk_tip: TIP,
      candidate_schema_version: "terminal-wk-candidate.v3",

      candidate_version: null
    }
  });
  assert.deepEqual(retrieval.carrier_members,
    ["canonical_parent_wk_contract", "review_unit_contract"]);
  assert.equal(projection.evidence_class, "historical_attempt_snapshot");
  assert.equal(projection.current_record_read_is_equivalent, false);

  const currentObservation = projection.current_candidate_status_observation;
  assert.equal(currentObservation.binds_historical_candidate, false);
  assert.equal(currentObservation.reconstructs_omitted_members, false);
  assert.equal(currentObservation.call.tool, "workspace_terminal_review_candidate_status");
  assert.deepEqual(currentObservation.call.arguments,
    { repo: "agent-chassis", wk_id: WK_ID });

  assert.equal(observed.structured.run_id, "run-worker-2691");
  assert.equal(observed.structured.attempt_id, "run-worker-2691");
  assert.equal(observed.structured.subject, SUBJECT);
  assert.equal(observed.structured.terminal, true);
  assert.equal(observed.structured.child_terminal, true);
  assert.equal(observed.structured.settled, true);
  assert.equal(observed.structured.slice_lifecycle.phase, "finalized");
  assert.equal(observed.structured.slice_lifecycle.wk_transitioned_to_review, true);
  assert.deepEqual(observed.structured.slice_lifecycle.integration.review_target,
    finalizedLifecycle(candidate).integration.review_target);
  assert.equal(observed.structured.lifecycle_resolution.resolved, true);
  assert.equal(observed.structured.lifecycle_resolution.phase, "finalized");

  const before = unprojectedBytes(observed, candidate);
  const savedFraction = (before - observed.bytes) / before;
  assert.ok(savedFraction >= 0.7,
    `record-heavy default response must lose at least 70% of its bytes; ${before} -> ${observed.bytes}`);
  } finally {
    await scope.dispose();
  }
});

test("WK-2691/WK-2671: omitted and false publish the compact view, true the complete result, neither the record echo", async () => {
  const record = authoredRecord();
  const candidate = terminalCandidate(record);
  const tools = createDispatchToolRegistry({
    backend: observationBackend({
      status: terminalWorkerStatus(),
      lifecycle: finalizedLifecycle(candidate)
    })
  });

  const omitted = await observe(tools, { subject: SUBJECT });
  const explicitFalse = await observe(tools, { subject: SUBJECT, include_final_result: false });
  const explicitTrue = await observe(tools, { subject: SUBJECT, include_final_result: true });

  assert.deepEqual(explicitFalse.structured, omitted.structured);
  const view = omitted.structured.slice_lifecycle;
  assert.equal(view.view, "workspace-agent-run-status-compact-lifecycle.v1");
  assert.ok(view.omitted_members.includes("terminal_candidate.review_unit"));
  assert.deepEqual(view.terminal_candidate.review_unit,
    { record_id: WK_ID, slice_id: SLICE_ID, subject: SUBJECT });
  assert.deepEqual(view.complete.call.arguments,
    { ...COMPLETE, attempt_id: omitted.structured.attempt_id });
  assert.equal(authoredContractsOf(explicitTrue.structured).omitted_member_count, 2);
  defaultFrame(omitted, "compact default with a review unit");
  for (const observation of [omitted, explicitFalse, explicitTrue]) {
    const wire = JSON.stringify(observation.structured);
    assert.equal(wire.includes("parent criterion 19"), false);
    assert.equal(wire.includes("slice 1 criterion"), false);
  }

  assert.equal(Object.hasOwn(omitted.structured, "final_result"), false);
  assert.equal(omitted.structured.final_result_summary.full_response_present, true);
  assert.equal(Object.hasOwn(explicitTrue.structured, "final_result_summary"), false);
  assert.equal(explicitTrue.structured.final_result.full_response.text,
    MALFORMED_FINAL_RESULT.full_response.text);
  assert.equal(explicitTrue.bytes > omitted.bytes, true,
    "requested complete evidence still costs more than the compact answer");
});

test("WK-2691: compact status does not grow with unrelated parent and sibling authored text", async () => {
  const lean = terminalCandidate(authoredRecord());

  const padded = terminalCandidate(authoredRecord({ padding: "x".repeat(21000) }));
  const grownBy = Buffer.byteLength(padded.contracts.canonical_parent_wk_contract, "utf8") -
    Buffer.byteLength(lean.contracts.canonical_parent_wk_contract, "utf8");
  assert.ok(grownBy >= 60000, `parent/sibling text must grow by at least 60KB; grew ${grownBy}`);
  assert.equal(padded.contracts.slice_review_contract, lean.contracts.slice_review_contract,
    "the queried slice's own contract is held constant");

  const scope = createTestResourceScope();
  try {
    const observations = [];
    for (const [label, candidate] of [["lean", lean], ["padded", padded]]) {
      const { tools } = await retrievalRegistry(scope, label, observationBackend({
        status: terminalWorkerStatus(),
        lifecycle: finalizedLifecycle(candidate)
      }));
      observations.push(await observe(tools, COMPLETE));
    }
    const [leanObserved, paddedObserved] = observations;

    const leanProjection = authoredContractsOf(leanObserved.structured);
    const paddedProjection = authoredContractsOf(paddedObserved.structured);
    assert.notEqual(paddedProjection.omitted[0].digest, leanProjection.omitted[0].digest);
    assert.equal(paddedProjection.omitted[0].utf8_bytes - leanProjection.omitted[0].utf8_bytes,
      grownBy);
    assert.deepEqual(paddedProjection.omitted[1], leanProjection.omitted[1]);

    const erase = (observed) => {
      const clone = structuredClone(observed.structured);
      const projection = authoredContractsOf(clone);
      projection.omitted[0] = "erased";
      for (const key of ["ref_id", "sha256"]) projection.retrieval[key] = "erased";
      projection.retrieval.retained_source_read.arguments = "erased";
      return clone;
    };
    assert.deepEqual(erase(paddedObserved), erase(leanObserved));

    const growth = paddedObserved.bytes - leanObserved.bytes;
    assert.ok(growth < 32,
      `compact status must not scale with unrelated authored text; grew ${growth} bytes for ${grownBy}`);

    const { tools: paddedTools } = await retrievalRegistry(scope, "padded-default",
      observationBackend({ status: terminalWorkerStatus(), lifecycle: finalizedLifecycle(padded) }));
    defaultFrame(await observe(paddedTools, { subject: SUBJECT }), "padded parent default");
  } finally {
    await scope.dispose();
  }
});

test("WK-2691: zero worker findings stays a parser outcome, and an unrecorded proof stays unrecorded", async () => {
  const candidate = terminalCandidate(authoredRecord());
  const tools = createDispatchToolRegistry({
    backend: observationBackend({
      status: terminalWorkerStatus({
        review_result: { review_outcome: "no_findings", no_findings: true, blocking_finding_count: 0 }
      }),
      lifecycle: finalizedLifecycle(candidate)
    })
  });

  const observed = await observe(tools, { subject: SUBJECT });

  assert.equal(observed.structured.status, "succeeded");
  assert.equal(observed.structured.review_result.no_findings, true);
  assert.equal(observed.structured.final_result_summary.structured_role_result.valid, false);
  assert.equal(observed.structured.final_result_summary.structured_role_result.status, "invalid");
  assert.deepEqual(observed.structured.final_result_summary.structured_role_result.diagnostic_codes,
    ["structured_result_ambiguous_candidates"]);
  assert.equal(observed.structured.proof_verification.state, "none_recorded");
  assert.equal(observed.structured.proof_verification.grants_authority, false);
  assert.match(observed.structured.proof_verification.meaning, /this is not a pass/u);

  assert.equal(observed.structured.final_result_summary.full_response_present, true);
  const complete = await observe(tools, { subject: SUBJECT, include_final_result: true });
  assert.match(complete.structured.final_result.full_response.text, /Tests never ran/u);
});

test("WK-2691: repeated observation of the same attempt is byte-stable and adds no lifecycle attempt", async () => {
  const candidate = terminalCandidate(authoredRecord());
  let lifecycleCalls = 0;
  const tools = createDispatchToolRegistry({
    backend: observationBackend({
      status: terminalWorkerStatus(),
      lifecycle: finalizedLifecycle(candidate),
      onLifecycle: () => { lifecycleCalls += 1; }
    })
  });

  const [first, second] = await Promise.all([
    observe(tools, COMPLETE),
    observe(tools, COMPLETE)
  ]);
  const third = await observe(tools, COMPLETE);

  assert.equal(lifecycleCalls, 1, "concurrent observers share one lifecycle attempt");
  assert.deepEqual(second.structured, first.structured);
  assert.deepEqual(third.structured, first.structured);
  assert.equal(third.bytes, first.bytes);
});

test("WK-2691: observations with no terminal candidate keep their exact envelope", async () => {
  const runningStatus = {
    accepted: true,
    timed_out: false,
    run_id: "run-worker-running",
    monitor_handle: "wkmh_running",
    role: "worker",
    subject: SUBJECT,
    status: "running",
    terminal: false,
    started_at: "2026-09-19T00:00:00.000Z",
    updated_at: "2026-09-19T00:00:30.000Z"
  };
  const running = createDispatchToolRegistry({
    backend: observationBackend({ status: runningStatus, lifecycle: null })
  });
  const observedRunning = await observe(running, { subject: SUBJECT });
  assert.equal(observedRunning.structured.terminal, false);
  assert.equal(Object.hasOwn(observedRunning.structured, "slice_lifecycle"), false);
  assert.equal(observedRunning.structured.next_action, "retry_wait_or_check_status");
  assert.ok(observedRunning.bytes < 2500,
    `a running observation stays small; was ${observedRunning.bytes}`);

});

test("WK-2691: a typed integration-pending failure keeps its exact facts through the projection", async () => {

  const harness = createResumableLifecycleHarness();
  harness.deps.prepareTerminalCandidate = async () => {
    throw new Error("injected terminal candidate preparation failure");
  };
  const tools = createDispatchToolRegistry({
    backend: {
      getRunStatus: async () => harness.status,
      waitForRunStatus: async () => harness.status,
      runPostWorkerSliceLifecycle: harness.invoke,
      readManagedRunObservation: async (input) => input?.detail === undefined
        ? unfailedAttemptSelection(harness.status)
        : ({ ok: false, code: "run_detail_unavailable" })
    }
  });

  const observed = await observe(tools, { subject: harness.status.subject, include_final_result: true });
  assert.equal(observed.structured.terminal, false);
  assert.equal(observed.structured.child_terminal, true);
  assert.equal(observed.structured.slice_lifecycle.phase, "integrated");
  assert.equal(observed.structured.slice_lifecycle.integrated, true);
  assert.equal(observed.structured.slice_lifecycle.error_code,
    "agent_launch.slice_lifecycle.terminal_candidate_preparation_failed.v1");
  assert.deepEqual(observed.structured.slice_lifecycle.integration, harness.integrationResult);
  assert.equal(observed.structured.slice_lifecycle.evidence.thrown.value.message,
    "injected terminal candidate preparation failure");
  assert.equal(observed.structured.next_action, "retry_wait_or_check_status");

  assert.equal(observed.structured.proof_verification.state, "unavailable");
  assert.equal(observed.structured.proof_verification.grants_authority, false);
  assert.equal(harness.counts().integrationCalls, 1);

  assert.equal(JSON.stringify(observed.structured).includes("parent criterion"), false);

  const compact = await observe(tools, { subject: harness.status.subject });
  defaultFrame(compact, "typed integration-pending failure");
  assert.ok(compact.structured.slice_lifecycle.omitted_members.includes("evidence"));
  assert.equal(compact.structured.slice_lifecycle.error_code,
    observed.structured.slice_lifecycle.error_code);
  for (const [key, value] of Object.entries(harness.integrationResult)) {
    if (value === null || typeof value !== "object") {
      assert.equal(compact.structured.slice_lifecycle.integration[key], value,
        `integration.${key} keeps its path in the compact view`);
    }
  }
  assert.equal(harness.counts().integrationCalls, 1, "the second observation integrated nothing");
});

test("WK-2691: the projection replaces two named members and passes everything else through", () => {

  const bare = Object.freeze({ invoked: true, phase: "pre_integration" });
  assert.equal(projectPublishedSliceLifecycle(bare), bare);
  const noContracts = Object.freeze({
    invoked: true,
    terminal_candidate: Object.freeze({ review_unit: Object.freeze({ record_id: WK_ID }) })
  });
  assert.equal(projectPublishedSliceLifecycle(noContracts), noContracts);
  assert.equal(projectPublishedSliceLifecycle(null), null);

  const candidate = terminalCandidate(authoredRecord());
  const lifecycle = finalizedLifecycle(candidate);
  lifecycle.future_lifecycle_fact = { kind: "not_yet_invented" };
  lifecycle.terminal_candidate.future_candidate_fact = ["kept"];
  lifecycle.terminal_candidate.review_unit.future_review_unit_fact = "kept";
  const projected = projectPublishedSliceLifecycle(lifecycle);
  assert.deepEqual(projected.future_lifecycle_fact, { kind: "not_yet_invented" });
  assert.deepEqual(projected.terminal_candidate.future_candidate_fact, ["kept"]);
  assert.equal(projected.terminal_candidate.review_unit.future_review_unit_fact, "kept");
  assert.deepEqual(projected.terminal_candidate.binding, lifecycle.terminal_candidate.binding);
  assert.deepEqual(projected.terminal_candidate.canonical_targets, ["tests/unit/parent.test.mjs"]);

  const unretained = projectPublishedSliceLifecycle(lifecycle)
    .terminal_candidate.review_unit.authored_contracts;
  assert.equal(unretained.retrieval.state, "unavailable");
  assert.equal(unretained.retrieval.code, "authored_contract_source_not_retained");
  assert.equal(Object.hasOwn(unretained.retrieval, "retained_source_read"), false);
  assert.match(unretained.retrieval.meaning, /not retrievable/u);

  const failedRetention = projectPublishedSliceLifecycle(lifecycle, {
    retention: { state: "unavailable", code: "mcp_response.spill_persistence_failed.v1" }
  }).terminal_candidate.review_unit.authored_contracts;
  assert.equal(failedRetention.retrieval.state, "unavailable");
  assert.equal(failedRetention.retrieval.code, "mcp_response.spill_persistence_failed.v1");
  assert.match(failedRetention.retrieval.meaning, /no current read substitutes/u);

  const unaddressable = structuredClone(lifecycle);
  unaddressable.terminal_candidate.review_unit.record_id = "not-a-wk-id";
  const unaddressableProjection = projectPublishedSliceLifecycle(unaddressable)
    .terminal_candidate.review_unit.authored_contracts;
  assert.equal(
    Object.hasOwn(unaddressableProjection, "current_candidate_status_observation"), false);
  assert.equal(unaddressableProjection.omitted_member_count, 2);

  assert.equal(readTerminalCandidateAuthoredContracts(bare), null);
  assert.equal(readTerminalCandidateAuthoredContracts(noContracts), null);
  assert.deepEqual(readTerminalCandidateAuthoredContracts(lifecycle).present.map((r) => r.member),
    ["canonical_parent_wk_contract", "review_unit_contract"]);

  const oddly = structuredClone(lifecycle);
  oddly.terminal_candidate.review_unit.canonical_parent_wk_contract = { unexpected: true };
  const oddProjection = projectPublishedSliceLifecycle(oddly)
    .terminal_candidate.review_unit;
  assert.deepEqual(oddProjection.canonical_parent_wk_contract, { unexpected: true });
  assert.equal(oddProjection.authored_contracts.omitted_member_count, 1);
  assert.equal(oddProjection.authored_contracts.returned_member_count, 1);
});

test("WK-2691: following the emitted read reconstructs both omitted documents exactly, Unicode included", async () => {
  const scope = createTestResourceScope();
  try {

    const record = authoredRecord({ padding: " — ünïcodé ✓ 日本語 контракт " });
    const candidate = terminalCandidate(record);
    const { tools } = await retrievalRegistry(scope, "exact", observationBackend({
      status: terminalWorkerStatus(),
      lifecycle: finalizedLifecycle(candidate)
    }));

    const observed = await observe(tools, COMPLETE);
    const projection = authoredContractsOf(observed.structured);
    const retrieval = projection.retrieval;
    assert.equal(retrieval.state, "retained");
    assert.ok(/[^\x00-\x7F]/u.test(candidate.contracts.canonical_parent_wk_contract) ||
      candidate.contracts.canonical_parent_wk_contract.includes("\\u"),
      "the fixture must carry non-ASCII authored text");

    const { bytes, pages, readerDigest, totalBytes, maxLength, encodedPages } =
      await followRetrievalCall(tools, retrieval);
    assert.ok(pages >= 2, `a source larger than one range needs continuation; pages=${pages}`);

    assert.equal(bytes.byteLength, totalBytes);
    assert.ok(bytes.byteLength > maxLength);
    assert.equal(sha256Hex(bytes), retrieval.sha256);
    assert.equal(readerDigest, retrieval.sha256);

    const decodeStep = retrieval.reconstruction.findIndex((step) => /decode/u.test(step));
    const concatenateStep = retrieval.reconstruction.findIndex(
      (step) => /concatenate/u.test(step));
    const verifyStep = retrieval.reconstruction.findIndex((step) => /sha256/u.test(step));
    assert.ok(decodeStep >= 0 && concatenateStep > decodeStep && verifyStep >= concatenateStep,
      `guidance must decode, then concatenate, then verify: ${JSON.stringify(retrieval.reconstruction)}`);
    assert.match(retrieval.reconstruction[decodeStep], /each page/u);
    assert.match(retrieval.reconstruction[concatenateStep], /decoded bytes/u);
    assert.equal(retrieval.reconstruction.some((step) => /concatenate the base64/u.test(step)),
      false, "guidance must never tell a caller to concatenate encoded pages");

    const joinedEncoded = Buffer.from(encodedPages.join(""), "base64");
    assert.ok(encodedPages.length > 1);
    assert.notEqual(sha256Hex(joinedEncoded), retrieval.sha256);

    const envelope = JSON.parse(bytes.toString("utf8"));
    assert.equal(envelope.schema_version, SELECTED_RESPONSE_SOURCE_SCHEMA_VERSION);

    assert.equal(envelope.carrier.canonical_parent_wk_contract,
      candidate.contracts.canonical_parent_wk_contract);
    assert.equal(envelope.carrier.review_unit_contract, candidate.contracts.slice_review_contract);

    for (const row of projection.omitted) {
      const text = envelope.carrier[row.member];
      assert.equal(Buffer.byteLength(text, "utf8"), row.utf8_bytes);
      assert.equal(`sha256:${sha256Hex(Buffer.from(text, "utf8"))}`, row.digest);
    }

    assert.deepEqual(envelope.binding.observation_identity, retrieval.binding.observation_identity);
    assert.equal(envelope.binding.repository, retrieval.binding.repository);
    assert.equal(envelope.binding.unit, retrieval.binding.unit);
    assert.equal(envelope.binding.route, "workspace_agent_run_status");
  } finally {
    await scope.dispose();
  }
});

test("WK-2691: a later candidate and a re-authored record do not move the retained bytes", async () => {
  const scope = createTestResourceScope();
  try {
    const original = terminalCandidate(authoredRecord());

    let servedStatus = terminalWorkerStatus();
    let servedLifecycle = finalizedLifecycle(original);
    const { tools } = await retrievalRegistry(scope, "historical", {
      getRunStatus: async () => ({ ...servedStatus }),
      waitForRunStatus: async () => ({ ...servedStatus }),
      runPostWorkerSliceLifecycle: async () => servedLifecycle,
      readManagedRunObservation: async (input) => input?.detail === undefined
        ? unfailedAttemptSelection(servedStatus)
        : ({ ok: false, code: "run_detail_unavailable" })
    });
    const captured = authoredContractsOf((await observe(tools, COMPLETE)).structured);

    const rewritten = authoredRecord({ padding: " REAUTHORED AFTER CAPTURE " });
    const laterCandidate = terminalCandidate(rewritten);
    laterCandidate.binding.candidate = "d".repeat(40);
    laterCandidate.binding.version_decision = versionDecision({
      generation: controlledGeneration(), candidate: "d".repeat(40), versionIdentity: "2"
    });
    servedStatus = terminalWorkerStatus({ run_id: "run-worker-2691-later" });
    servedLifecycle = finalizedLifecycle(laterCandidate);
    const later = authoredContractsOf((await observe(tools, COMPLETE)).structured);

    assert.notEqual(later.retrieval.ref_id, captured.retrieval.ref_id,
      "a different candidate over different text retains its own source");
    assert.notEqual(later.omitted[0].digest, captured.omitted[0].digest);
    assert.equal(later.retrieval.binding.observation_identity.candidate, "d".repeat(40));

    const { bytes } = await followRetrievalCall(tools, captured.retrieval);
    const envelope = JSON.parse(bytes.toString("utf8"));
    assert.equal(envelope.carrier.canonical_parent_wk_contract,
      original.contracts.canonical_parent_wk_contract);
    assert.equal(envelope.binding.observation_identity.candidate, CANDIDATE);
    assert.equal(envelope.carrier.canonical_parent_wk_contract.includes("REAUTHORED"), false);
  } finally {
    await scope.dispose();
  }
});

test("WK-2691: a missing or tampered retained source refuses precisely and substitutes nothing", async () => {
  const scope = createTestResourceScope();
  try {
    const candidate = terminalCandidate(authoredRecord());
    const { tools, dir, env } = await retrievalRegistry(scope, "integrity", observationBackend({
      status: terminalWorkerStatus(),
      lifecycle: finalizedLifecycle(candidate)
    }));
    const retrieval = authoredContractsOf(
      (await observe(tools, COMPLETE)).structured).retrieval;
    const reader = tools.get("workspace_read_mcp_content_reference").handler;
    const sourcePath = path.join(dir, `${retrieval.ref_id}.json`);
    const originalBytes = readFileSync(sourcePath);

    assert.throws(
      () => readSelectedResponseSource(
        { ref_id: retrieval.ref_id, sha256: retrieval.sha256 },
        { env, expected: { route: "workspace_agent_run_status", repository: "another-repo" } }),
      (error) => error?.envelope?.code === "selected_response_query_invalid");

    const authenticated = readSelectedResponseSource(
      { ref_id: retrieval.ref_id, sha256: retrieval.sha256 },
      { env, expected: { route: "workspace_agent_run_status", repository: "agent-chassis",
        unit: SUBJECT } });
    assert.equal(authenticated.carrier.canonical_parent_wk_contract,
      candidate.contracts.canonical_parent_wk_contract);

    const tampered = Buffer.from(originalBytes);
    tampered[tampered.length - 2] = tampered[tampered.length - 2] === 0x20 ? 0x21 : 0x20;
    writeFileSync(sourcePath, tampered);
    const afterTamper = await followRetrievalCall(tools, retrieval);
    assert.notEqual(sha256Hex(afterTamper.bytes), retrieval.sha256);
    assert.throws(
      () => readSelectedResponseSource(
        { ref_id: retrieval.ref_id, sha256: retrieval.sha256 },
        { env, expected: { route: "workspace_agent_run_status", repository: "agent-chassis" } }),
      (error) => error?.envelope?.code ===
        "mcp_response.content_reference_ranged_read_unavailable.v1");

    writeFileSync(sourcePath, originalBytes.subarray(0, originalBytes.length - 64));
    const truncated = await reader({ ...retrieval.retained_source_read.arguments });
    assert.equal(truncated.isError, true);
    assert.match(JSON.stringify(truncated), /content_reference_metadata_byte_count_mismatch/u);

    rmSync(sourcePath);
    const missing = await reader({ ...retrieval.retained_source_read.arguments });
    assert.equal(missing.isError, true);
    const missingText = JSON.stringify(missing);
    assert.match(missingText, /content_reference_not_found/u);
    assert.equal(missingText.includes("parent criterion"), false);
  } finally {
    await scope.dispose();
  }
});

test("WK-2691: repeat and concurrent observation reuse one retained artifact and add no lifecycle effect", async () => {
  const scope = createTestResourceScope();
  try {
    const candidate = terminalCandidate(authoredRecord());
    let lifecycleCalls = 0;
    const { tools, dir } = await retrievalRegistry(scope, "reuse", observationBackend({
      status: terminalWorkerStatus(),
      lifecycle: finalizedLifecycle(candidate),
      onLifecycle: () => { lifecycleCalls += 1; }
    }));

    const [first, second] = await Promise.all([
      observe(tools, COMPLETE),
      observe(tools, COMPLETE)
    ]);
    const third = await observe(tools, COMPLETE);
    const complete = await observe(tools, { subject: SUBJECT, include_final_result: true });

    assert.equal(lifecycleCalls, 1, "observation adds no lifecycle attempt");
    assert.equal(retainedArtifacts(dir).length, 1,
      "one observed state retains one transport artifact, however often it is observed");

    assert.deepEqual(second.structured, first.structured);
    assert.deepEqual(third.structured, first.structured);
    assert.equal(third.bytes, first.bytes);
    assert.deepEqual(complete.structured.slice_lifecycle, first.structured.slice_lifecycle);

    const { bytes } = await followRetrievalCall(tools, authoredContractsOf(third.structured).retrieval);
    assert.equal(JSON.parse(bytes.toString("utf8")).carrier.review_unit_contract,
      candidate.contracts.slice_review_contract);
  } finally {
    await scope.dispose();
  }
});

test("WK-2691: measured cost of the default answer and of the complete retrieval that follows it", async () => {
  const scope = createTestResourceScope();
  try {
    const candidate = terminalCandidate(authoredRecord({ padding: "y".repeat(21000) }));
    const authoredBytes = Buffer.byteLength(candidate.contracts.canonical_parent_wk_contract, "utf8");
    assert.ok(authoredBytes >= 60000, `authored text must exceed 60KB; was ${authoredBytes}`);
    const { tools } = await retrievalRegistry(scope, "cost", observationBackend({
      status: terminalWorkerStatus(),
      lifecycle: finalizedLifecycle(candidate)
    }));

    const observed = await observe(tools, { subject: SUBJECT });
    const complete = await observe(tools, COMPLETE);
    const before = unprojectedBytes(complete, candidate);
    const defaultTotal = observed.requestBytes + observed.bytes;
    defaultFrame(observed, `default status over a ${authoredBytes}-byte parent contract`);
    assert.ok((before - observed.bytes) / before >= 0.7);

    const retrieval = authoredContractsOf(complete.structured).retrieval;
    const reader = tools.get("workspace_read_mcp_content_reference").handler;
    let callArguments = { ...retrieval.retained_source_read.arguments };
    let retrievalTotal = 0;
    let pages = 0;
    let sourceBytes = 0;
    let maxLength = 0;
    for (;;) {
      const result = await reader(callArguments);
      retrievalTotal += Buffer.byteLength(JSON.stringify(callArguments), "utf8") +
        Buffer.byteLength(JSON.stringify(result), "utf8");
      pages += 1;
      const page = readStructuredResult(result);
      sourceBytes = page.total_bytes;
      maxLength = page.max_length;
      if (page.next_offset === null) break;
      callArguments = { ...callArguments, offset: page.next_offset };
    }

    assert.ok(sourceBytes >= authoredBytes);
    assert.ok(retrievalTotal > sourceBytes);
    assert.equal(pages, Math.ceil(sourceBytes / maxLength));
    assert.ok(defaultTotal + retrievalTotal > before,
      "the projection moves the cost off the default answer; it does not make the bytes smaller");
  } finally {
    await scope.dispose();
  }
});

function generationSummaryOf(structured) {
  return structured.slice_lifecycle.terminal_candidate.binding.controlled_generation_summary;
}

function withGenerationRestored(structured, generation) {
  const clone = structuredClone(structured);
  const binding = clone.slice_lifecycle.terminal_candidate.binding;
  delete binding.controlled_generation_summary;
  binding.controlled_generation = generation;
  return clone;
}

function generationLifecycle({ generation = controlledGeneration(), reviewUnit = false,
  transitionRecord = null } = {}) {
  const candidate = terminalCandidate(authoredRecord(), { generation, reviewUnit });
  return { generation, candidate, lifecycle: finalizedLifecycle(candidate, { transitionRecord }) };
}

function assertNoGenerationBodies(structured, generation) {
  const wire = JSON.stringify(structured);
  for (const descriptor of [...generation.descriptors, ...generation.manifest_descriptors]) {
    assert.equal(wire.includes(descriptor.bytes_base64), false,
      `${descriptor.path} body must not be published inline`);
  }
  assert.equal(wire.includes("bytes_base64"), false);

  assert.equal(Object.hasOwn(structured.slice_lifecycle.terminal_candidate.binding ?? {},
    "controlled_generation"), false);
}

test("WK-2671: a generation without a review unit is summarized, not echoed, for every include_final_result", async (t) => {
  const scope = createTestResourceScope();
  try {
    const generation = controlledGeneration({ descriptorCount: 6, body: "carrier body ".repeat(400) });
    const { candidate, lifecycle } = generationLifecycle({ generation });
    assert.equal(Object.hasOwn(candidate, "review_unit"), false);
    const original = structuredClone(lifecycle);
    const { tools } = await retrievalRegistry(scope, "generation-flags", observationBackend({
      status: terminalWorkerStatus(),
      lifecycle
    }));

    const omitted = await observe(tools, { subject: SUBJECT });
    const explicitFalse = await observe(tools, { subject: SUBJECT, include_final_result: false });
    const explicitTrue = await observe(tools, { subject: SUBJECT, include_final_result: true });

    for (const observation of [omitted, explicitFalse, explicitTrue]) {
      assertNoGenerationBodies(observation.structured, generation);
    }

    assert.deepEqual(explicitFalse.structured, omitted.structured);
    const view = omitted.structured.slice_lifecycle.terminal_candidate;
    assert.equal(view.candidate, candidate.binding.candidate);
    assert.equal(view.base, candidate.binding.base);
    assert.equal(view.wk_tip, candidate.binding.wk_tip);
    assert.ok(omitted.structured.slice_lifecycle.omitted_members.includes("terminal_candidate.binding"));
    defaultFrame(omitted, "generation without a review unit");
    assert.equal(Object.hasOwn(omitted.structured, "final_result"), false);
    assert.equal(explicitTrue.structured.final_result.full_response.text,
      MALFORMED_FINAL_RESULT.full_response.text);

    const summary = generationSummaryOf(explicitTrue.structured);
    assert.equal(summary.schema_version, RUN_STATUS_CONTROLLED_GENERATION_PROJECTION_SCHEMA_VERSION);
    assert.equal(summary.projection_scope, "terminal_candidate_controlled_generation");
    assert.equal(summary.grants_authority, false);
    assert.equal(summary.evidence_class, "historical_attempt_snapshot");
    assert.equal(summary.current_record_read_is_equivalent, false);
    assert.equal(summary.source_schema_version, generation.schema_version);
    assert.deepEqual(summary.identity_source, {
      path: "terminal_candidate.binding.version_decision.controlled_generation",
      present: true
    });
    assert.deepEqual(summary.source_facts, {
      repository: generation.repository,
      record_source_digest: generation.record_source_digest,
      wk_tip_sha: generation.wk_tip_sha
    });

    assert.equal(summary.source_facts.repository, GENERATION_REPOSITORY_ROOT);
    assert.equal(path.isAbsolute(summary.source_facts.repository), true);
    assert.equal(summary.retrieval.binding.repository, REPOSITORY);
    assert.notEqual(summary.source_facts.repository, summary.retrieval.binding.repository);
    assert.equal(summary.descriptor_count, 6);
    assert.equal(summary.manifest_descriptor_count, 1);

    for (const restated of ["wk_id", "generation_digest", "manifest_identity", "count",
      "identity", "descriptors"]) {
      assert.equal(Object.hasOwn(summary, restated), false, `${restated} is not restated`);
    }
    const text = JSON.stringify(generation);
    assert.deepEqual(summary.omitted, {
      member: "controlled_generation",
      carrier_member: "terminal_candidate_controlled_generation",
      digest: `sha256:${sha256Hex(Buffer.from(text, "utf8"))}`,
      utf8_bytes: Buffer.byteLength(text, "utf8")
    });
    assert.equal(summary.retrieval.state, "retained");
    assert.deepEqual(summary.retrieval.carrier_members, ["terminal_candidate_controlled_generation"]);

    assert.deepEqual(
      explicitTrue.structured.slice_lifecycle.terminal_candidate.binding.version_decision,
      candidate.binding.version_decision);
    assert.deepEqual(
      explicitTrue.structured.slice_lifecycle.terminal_candidate.binding.version_decision
        .controlled_generation,
      controlledGenerationIdentity(generation));

    assert.deepEqual(lifecycle, original);
    assert.deepEqual(withGenerationRestored(explicitTrue.structured, generation).slice_lifecycle,
      original);
    assert.equal(omitted.structured.terminal, true);
    assert.equal(omitted.structured.child_terminal, true);
    assert.equal(omitted.structured.settled, true);
    assert.equal(omitted.structured.slice_lifecycle.phase, "finalized");
    assert.equal(omitted.structured.slice_lifecycle.integrated, true);
    assert.equal(omitted.structured.lifecycle_resolution.resolved, true);
    assert.equal(omitted.structured.proof_verification.state, "none_recorded");

    const bare = createDispatchToolRegistry({
      backend: observationBackend({
        status: terminalWorkerStatus(),
        lifecycle: finalizedLifecycle(terminalCandidate(authoredRecord(), { reviewUnit: false }))
      })
    });
    const bareObserved = await observe(bare, { subject: SUBJECT });
    const bareComplete = await observe(bare, COMPLETE);
    for (const fact of ["status", "terminal", "child_terminal", "settled", "next_action",
      "lifecycle_resolution", "proof_verification", "final_result_summary"]) {
      assert.deepEqual(omitted.structured[fact], bareObserved.structured[fact], fact);
    }
    assert.equal(Object.hasOwn(
      bareComplete.structured.slice_lifecycle.terminal_candidate.binding,
      "controlled_generation_summary"), false, "no placeholder summary without a generation");

    const before = measureMcpInlineResultBytes(withGenerationRestored(explicitTrue.structured, generation));
    const after = measureMcpInlineResultBytes(explicitTrue.structured);
    assert.ok(before - after >= Buffer.byteLength(text, "utf8") / 2,
      `the generation body leaves the default answer; ${before} -> ${after}`);
    t.diagnostic(`WK-2671 generation response bytes: before=${before} after=${after}`);
  } finally {
    await scope.dispose();
  }
});

test("WK-2671: the summary is bounded as bodies and inventory grow; the version-decision inventory still scales", async (t) => {
  const scope = createTestResourceScope();
  try {
    const shapes = {
      small: controlledGeneration({ descriptorCount: 2, body: "short " }),
      largeUnicodeBodies: controlledGeneration({
        descriptorCount: 2, body: "ünïcodé ✓ 日本語 контракт ".repeat(2000)
      }),
      manyDescriptors: controlledGeneration({ descriptorCount: 40, body: "short " })
    };
    const measured = {};
    for (const [label, generation] of Object.entries(shapes)) {
      const { lifecycle } = generationLifecycle({ generation });
      const { tools } = await retrievalRegistry(scope, `generation-scale-${label}`,
        observationBackend({ status: terminalWorkerStatus(), lifecycle }));
      const observed = await observe(tools, COMPLETE);
      assertNoGenerationBodies(observed.structured, generation);
      const summary = generationSummaryOf(observed.structured);
      const compact = await observe(tools, { subject: SUBJECT });
      defaultFrame(compact, `default answer, ${label} generation`);
      measured[label] = {
        defaultBytes: compact.bytes,
        summaryBytes: Buffer.byteLength(JSON.stringify(summary), "utf8"),
        responseBytes: observed.bytes,
        before: measureMcpInlineResultBytes(withGenerationRestored(observed.structured, generation)),
        after: measureMcpInlineResultBytes(observed.structured),
        summary
      };
    }
    for (const [label, { summaryBytes }] of Object.entries(measured)) {
      assert.ok(summaryBytes <= 4096, `${label} summary is ${summaryBytes} bytes`);
      assert.ok(summaryBytes - measured.small.summaryBytes <= 256,
        `${label} summary grew ${summaryBytes - measured.small.summaryBytes} bytes`);
    }
    assert.equal(measured.manyDescriptors.summary.descriptor_count, 40);

    assert.ok(measured.largeUnicodeBodies.after - measured.small.after <= 256,
      `body growth leaked into the response: ${measured.small.after} -> ${measured.largeUnicodeBodies.after}`);

    assert.ok(measured.manyDescriptors.after > measured.small.after + 38 * 64);

    for (const label of ["largeUnicodeBodies", "manyDescriptors"]) {
      assert.ok(measured[label].defaultBytes - measured.small.defaultBytes <= 16,
        `${label} default grew ${measured[label].defaultBytes - measured.small.defaultBytes} bytes`);
    }
    t.diagnostic(`WK-2671 generation scale: ${JSON.stringify(Object.fromEntries(
      Object.entries(measured).map(([label, { summaryBytes, before, after, defaultBytes }]) =>
        [label, { summaryBytes, before, after, defaultBytes }])))}`);
  } finally {
    await scope.dispose();
  }
});

test("WK-2671: the emitted read reconstructs the exact historical generation, and a later one does not move it", async () => {
  const scope = createTestResourceScope();
  try {
    const generation = controlledGeneration({
      descriptorCount: 5, body: "ünïcodé ✓ 日本語 контракт ".repeat(600)
    });
    let servedStatus = terminalWorkerStatus();
    let servedLifecycle = generationLifecycle({ generation }).lifecycle;
    const { tools } = await retrievalRegistry(scope, "generation-exact", {
      getRunStatus: async () => ({ ...servedStatus }),
      waitForRunStatus: async () => ({ ...servedStatus }),
      runPostWorkerSliceLifecycle: async () => servedLifecycle,
      readManagedRunObservation: async (input) => input?.detail === undefined
        ? unfailedAttemptSelection(servedStatus)
        : ({ ok: false, code: "run_detail_unavailable" })
    });
    const captured = generationSummaryOf((await observe(tools, COMPLETE)).structured);
    assert.equal(captured.retrieval.state, "retained");
    assert.equal(captured.retrieval.binding.observation_identity.candidate, CANDIDATE);
    assert.equal(captured.retrieval.binding.observation_identity.candidate_version, null);

    const reconstruct = async (summary) => {
      const { bytes, readerDigest } = await followRetrievalCall(tools, summary.retrieval);
      assert.equal(sha256Hex(bytes), summary.retrieval.sha256);
      assert.equal(readerDigest, summary.retrieval.sha256);
      const envelope = JSON.parse(bytes.toString("utf8"));
      assert.equal(envelope.schema_version, SELECTED_RESPONSE_SOURCE_SCHEMA_VERSION);
      const text = envelope.carrier.terminal_candidate_controlled_generation;
      assert.equal(`sha256:${sha256Hex(Buffer.from(text, "utf8"))}`, summary.omitted.digest);
      assert.equal(Buffer.byteLength(text, "utf8"), summary.omitted.utf8_bytes);
      assert.deepEqual(envelope.binding.observation_identity,
        summary.retrieval.binding.observation_identity);
      return JSON.parse(text);
    };
    const restored = await reconstruct(captured);
    assert.deepEqual(restored, generation);
    for (const key of ["descriptors", "manifest_descriptors"]) {
      restored[key].forEach((descriptor, index) => {
        const expected = generation[key][index];
        assert.equal(descriptor.path, expected.path);
        assert.ok(Buffer.from(descriptor.bytes_base64, "base64")
          .equals(Buffer.from(expected.bytes_base64, "base64")), expected.path);
        assert.equal(`sha256:${sha256Hex(Buffer.from(descriptor.bytes_base64, "base64"))}`,
          expected.content_digest);
      });
    }

    const laterGeneration = controlledGeneration({ descriptorCount: 5, body: "REWRITTEN " });
    servedStatus = terminalWorkerStatus({ run_id: "run-worker-2671-later" });
    servedLifecycle = generationLifecycle({ generation: laterGeneration }).lifecycle;
    const later = generationSummaryOf((await observe(tools, COMPLETE)).structured);
    assert.notEqual(later.retrieval.ref_id, captured.retrieval.ref_id);
    assert.notEqual(later.omitted.digest, captured.omitted.digest);
    assert.deepEqual(await reconstruct(later), laterGeneration);

    assert.deepEqual(await reconstruct(captured), generation);
  } finally {
    await scope.dispose();
  }
});

test("WK-2671: review contracts, integration record and generation share one retained artifact", async () => {
  const scope = createTestResourceScope();
  try {
    const record = authoredRecord();
    const { generation, candidate, lifecycle } = generationLifecycle({
      reviewUnit: true, transitionRecord: record
    });
    let lifecycleCalls = 0;
    const { tools, dir } = await retrievalRegistry(scope, "generation-combined", observationBackend({
      status: terminalWorkerStatus(),
      lifecycle,
      onLifecycle: () => { lifecycleCalls += 1; }
    }));

    const [first, second] = await Promise.all([
      observe(tools, COMPLETE),
      observe(tools, COMPLETE)
    ]);
    const complete = await observe(tools, { subject: SUBJECT, include_final_result: true });
    assert.equal(lifecycleCalls, 1);
    assert.equal(retainedArtifacts(dir).length, 1);
    assert.deepEqual(second.structured, first.structured);
    assert.deepEqual(complete.structured.slice_lifecycle, first.structured.slice_lifecycle);
    assertNoGenerationBodies(first.structured, generation);

    const lifecycleView = first.structured.slice_lifecycle;
    const members = ["canonical_parent_wk_contract", "review_unit_contract",
      "terminal_candidate_controlled_generation", "integration_transition_record"];
    const retrievals = [
      lifecycleView.terminal_candidate.review_unit.authored_contracts.retrieval,
      generationSummaryOf(first.structured).retrieval,
      lifecycleView.integration.transition.written_record.retrieval
    ];
    for (const retrieval of retrievals) {
      assert.equal(retrieval.ref_id, retrievals[0].ref_id);
      assert.deepEqual(retrieval.carrier_members, members);
    }
    const { bytes } = await followRetrievalCall(tools, retrievals[1]);
    const envelope = JSON.parse(bytes.toString("utf8"));
    assert.deepEqual(Object.keys(envelope.carrier), members);
    const retainedGeneration = JSON.parse(envelope.carrier.terminal_candidate_controlled_generation);
    assert.deepEqual(retainedGeneration, generation);

    assert.equal(retainedGeneration.repository, GENERATION_REPOSITORY_ROOT);
    assert.equal(envelope.binding.repository, REPOSITORY);
    assert.equal(envelope.carrier.review_unit_contract, candidate.contracts.slice_review_contract);
    assert.deepEqual(JSON.parse(envelope.carrier.integration_transition_record), record);
  } finally {
    await scope.dispose();
  }
});

test("WK-2671: changed generation content under the same candidate and attempt retains distinct content", () => {
  const scope = createTestResourceScope();
  return (async () => {
    try {
      const dir = await scope.acquire("generation-memo",
        () => mkdtempSync(path.join(os.tmpdir(), "wk2671-retained-")),
        (created) => rmSync(created, { recursive: true, force: true }));
      const retention = createAuthoredContractRetention({
        env: { ...process.env, WIKI_MCP_RESPONSE_STATE_DIR: dir }
      });
      const status = terminalWorkerStatus();
      const observeWith = (generation) => retention.retain({
        repository: "agent-chassis",
        status,
        lifecycle: generationLifecycle({ generation }).lifecycle
      });
      const first = observeWith(controlledGeneration({ body: "one " }));
      const repeat = observeWith(controlledGeneration({ body: "one " }));
      const changed = observeWith(controlledGeneration({ body: "two " }));
      assert.equal(first.state, "retained");
      assert.equal(repeat, first, "identical observed state reuses its memoized locator");
      assert.deepEqual(changed.observation_identity, first.observation_identity,
        "same attempt and candidate");
      assert.notEqual(changed.locator.ref_id, first.locator.ref_id);
      assert.notEqual(changed.locator.sha256, first.locator.sha256);
      assert.equal(retainedArtifacts(dir).length, 2);
    } finally {
      await scope.dispose();
    }
  })();
});

test("WK-2671: unavailable retention and a missing or corrupt artifact stay truthful, with no inline fallback", async () => {
  const { generation, lifecycle } = generationLifecycle();

  for (const [retention, code] of [
    [null, "authored_contract_source_not_retained"],
    [{ state: "unavailable", code: "mcp_response.spill_persistence_failed.v1" },
      "mcp_response.spill_persistence_failed.v1"]
  ]) {
    const projected = projectPublishedControlledGeneration(lifecycle, { retention });
    const summary = projected.terminal_candidate.binding.controlled_generation_summary;
    assert.equal(summary.retrieval.state, "unavailable");
    assert.equal(summary.retrieval.code, code);
    assert.equal(Object.hasOwn(summary.retrieval, "retained_source_read"), false);
    assert.equal(JSON.stringify(projected).includes("bytes_base64"), false);
    assert.equal(summary.omitted.utf8_bytes, Buffer.byteLength(JSON.stringify(generation), "utf8"));
  }

  const scope = createTestResourceScope();
  try {

    const root = await scope.acquire("generation-unwritable",
      () => mkdtempSync(path.join(os.tmpdir(), "wk2671-unwritable-")),
      (created) => rmSync(created, { recursive: true, force: true }));
    const blocker = path.join(root, "not-a-directory");
    writeFileSync(blocker, "file");
    const failing = createDispatchToolRegistry({
      backend: observationBackend({ status: terminalWorkerStatus(), lifecycle }),
      responseEnv: { ...process.env, WIKI_MCP_RESPONSE_STATE_DIR: path.join(blocker, "spill") }
    });
    const failed = await observe(failing, COMPLETE);
    assert.equal(failed.structured.terminal, true);
    assert.equal(failed.structured.slice_lifecycle.phase, "finalized");
    const failedSummary = generationSummaryOf(failed.structured);
    assert.equal(failedSummary.retrieval.state, "unavailable");
    assert.equal(typeof failedSummary.retrieval.code, "string");
    assert.equal(Object.hasOwn(failedSummary.retrieval, "retained_source_read"), false);
    assertNoGenerationBodies(failed.structured, generation);

    const { tools, dir } = await retrievalRegistry(scope, "generation-integrity",
      observationBackend({ status: terminalWorkerStatus(), lifecycle }));
    const retrieval = generationSummaryOf((await observe(tools, COMPLETE)).structured)
      .retrieval;
    const sourcePath = path.join(dir, `${retrieval.ref_id}.json`);
    const originalBytes = readFileSync(sourcePath);
    const tampered = Buffer.from(originalBytes);
    tampered[tampered.length - 2] = tampered[tampered.length - 2] === 0x20 ? 0x21 : 0x20;
    writeFileSync(sourcePath, tampered);
    const afterTamper = await followRetrievalCall(tools, retrieval);
    assert.notEqual(sha256Hex(afterTamper.bytes), retrieval.sha256);

    rmSync(sourcePath);
    const missing = await tools.get("workspace_read_mcp_content_reference")
      .handler({ ...retrieval.retained_source_read.arguments });
    assert.equal(missing.isError, true);
    const missingText = JSON.stringify(missing);
    assert.match(missingText, /content_reference_not_found/u);
    assert.equal(missingText.includes("bytes_base64"), false);
  } finally {
    await scope.dispose();
  }
});

test("WK-2671: the generation projection replaces one named member and passes everything else through", () => {
  const bare = Object.freeze({ invoked: true, phase: "pre_integration" });
  assert.equal(projectPublishedControlledGeneration(bare), bare);
  assert.equal(projectPublishedControlledGeneration(null), null);
  const noGeneration = finalizedLifecycle(terminalCandidate(authoredRecord(), { reviewUnit: false }));
  assert.equal(projectPublishedControlledGeneration(noGeneration), noGeneration);
  assert.equal(readTerminalCandidateControlledGeneration(noGeneration), null);

  const odd = structuredClone(noGeneration);
  odd.terminal_candidate.binding.controlled_generation = "not-an-object";
  assert.equal(projectPublishedControlledGeneration(odd), odd);

  const { lifecycle } = generationLifecycle({ reviewUnit: true });
  lifecycle.terminal_candidate.binding.future_binding_fact = "kept";
  const composed = projectPublishedControlledGeneration(projectPublishedSliceLifecycle(lifecycle));
  const reversed = projectPublishedSliceLifecycle(projectPublishedControlledGeneration(lifecycle));
  assert.deepEqual(composed, reversed);
  assert.equal(composed.terminal_candidate.binding.future_binding_fact, "kept");
  assert.equal(Object.hasOwn(composed.terminal_candidate.review_unit, "authored_contracts"), true);
  assert.equal(Object.hasOwn(composed.terminal_candidate.binding, "controlled_generation"), false);
  const restored = structuredClone(composed.terminal_candidate.binding);
  delete restored.controlled_generation_summary;
  const expected = structuredClone(lifecycle.terminal_candidate.binding);
  delete expected.controlled_generation;
  assert.deepEqual(restored, expected);

  const noIdentity = structuredClone(lifecycle);
  delete noIdentity.terminal_candidate.binding.version_decision.controlled_generation;
  assert.equal(projectPublishedControlledGeneration(noIdentity)
    .terminal_candidate.binding.controlled_generation_summary.identity_source.present, false);
});

const LIMITATION = "test_proof_registry_falsification_unsupported";

function populatedObservation({ proofRows = 1, recordedCount = 3, recoveryText = "",
  workerText = null, diagnosticDepth = 0, materializationPath = null, descriptorCount = 6,
  padding = "" } = {}) {
  const record = authoredRecord({ padding });
  const generation = controlledGeneration({ descriptorCount, body: "carrier ".repeat(50) });
  const candidate = terminalCandidate(record, { generation });
  if (materializationPath !== null) candidate.materialization.root = materializationPath;
  const lifecycle = finalizedLifecycle(candidate, { transitionRecord: record });
  if (diagnosticDepth > 0) {
    let evidence = { message: "诊断 🙂 ".repeat(400) };
    for (let level = 0; level < diagnosticDepth; level += 1) {
      evidence = { level, stack: `frame ${level} ✓ `.repeat(40), cause: evidence };
    }
    lifecycle.evidence = evidence;
  }
  const status = terminalWorkerStatus(workerText === null ? {} : {
    final_result: { ...MALFORMED_FINAL_RESULT, full_response: { text: workerText } } });
  const invocation = syntheticRecordedInvocation({ rows: proofRows, status: "unproven",
    limitation: LIMITATION, recoveryText });
  return { candidate, lifecycle, status, invocation, recordedCount };
}

async function observePopulated(scope, label, shape, hooks = {}) {
  const { tools } = await retrievalRegistry(scope, label, observationBackend({
    status: shape.status, lifecycle: shape.lifecycle, recordedCount: shape.recordedCount,
    lastRecordedInvocation: shape.invocation, ...hooks
  }));
  return { tools, observed: await observe(tools, { subject: SUBJECT }) };
}

function assertPopulatedDefault(observed, shape, label) {
  const conclusion = defaultStatusConclusion(observed.structured, label);
  const binding = shape.candidate.binding;
  assert.deepEqual(conclusion.run, { attempt_id: shape.status.run_id, subject: SUBJECT,
    child_status: "succeeded", terminal: true, child_terminal: true }, label);
  assert.deepEqual(conclusion.delivery, { delivery_sha: TIP, wk_sha: TIP, previous_wk_sha: BASE },
    label);
  assert.deepEqual(conclusion.candidate, { candidate: binding.candidate, base: binding.base,
    wk_tip: binding.wk_tip, candidate_ref: binding.candidate_ref }, label);
  assert.equal(conclusion.cleanup, "complete", label);
  assert.equal(conclusion.verification.recorded, shape.recordedCount, label);
  assert.equal(conclusion.verification.latest.status, "unproven", label);
  assert.equal(conclusion.verification.latest.tested_source,
    shape.invocation.tested_source.source_snapshot_digest, label);
  const latest = observed.structured.proof_verification.last_recorded_invocation;
  const carried = latest.outcome.proofs_returned;
  assert.ok(carried >= 1, `${label}: at least one proof row is carried`);
  assert.equal(carried + latest.outcome.proofs_omitted, shape.invocation.outcome_summary.proofs.length,
    `${label}: rows not carried are counted`);
  assert.deepEqual(conclusion.verification.latest.proofs,
    shape.invocation.outcome_summary.proofs.slice(0, carried).map((row) => ({ status: row.status,
      execution_status: row.execution_status, selected_status: row.selected_status,
      limitations: [LIMITATION] })), `${label}: every carried row keeps its limitation`);
  assert.equal(latest.outcome.reasons["reason-1"].reason_code,
    "verify_proof.selected_test_failed.v1", `${label}: the failing row's reason`);
  return conclusion;
}

test("WK-2671: the compact default answer carries the populated facts within the shared budget", async (t) => {
  const scope = createTestResourceScope();
  try {
    const shape = populatedObservation();
    const { tools, observed } = await observePopulated(scope, "compact-populated", shape);
    const frame = defaultFrame(observed, "synthetic populated finalized default");
    assertPopulatedDefault(observed, shape, "synthetic populated finalized default");
    assert.deepEqual(responseRepetitions(observed.structured), []);

    const view = observed.structured.slice_lifecycle;
    const complete = await observe(tools, COMPLETE);
    for (const member of view.omitted_members) {
      const [head, ...rest] = member.split(".");
      assert.notEqual(rest.reduce((node, key) => node?.[key], complete.structured.slice_lifecycle[head]),
        undefined, `the complete result carries ${member}`);
    }
    for (const omitted of ["terminal_candidate.binding", "terminal_candidate.materialization",
      "terminal_candidate.version_decision", "terminal_candidate.review_unit",
      "integration.transition.written_record"]) {
      assert.ok(view.omitted_members.includes(omitted), omitted);
    }
    assert.equal(complete.structured.proof_verification.last_recorded_invocation.outcome_summary
      .reasons["reason-1"].recovery.next_step.startsWith("rerun"), true,
    "the recovery text the default leaves out is the complete result's");
    t.diagnostic(`WK-2671 compact default: ${frame.utf8_bytes} bytes; complete: ${complete.bytes}`);
  } finally {
    await scope.dispose();
  }
});

test("WK-2671: each growth dimension, and all of them at once, stay within the default budget", async (t) => {
  const scope = createTestResourceScope();
  try {
    const dimensions = {
      baseline: {},
      carrierBodies: { padding: "z".repeat(21000) },
      descriptorInventory: { descriptorCount: 200 },
      proofRowsAndInvocations: { proofRows: 12, recordedCount: 500,
        recoveryText: "é".repeat(3000) },
      diagnosticDepthMultibyte: { diagnosticDepth: 30 },
      workerText: { workerText: "日本語の作業結果 ".repeat(20000) },
      materializationPath: { materializationPath: `/${"deep-segment/".repeat(600)}candidate` }
    };
    dimensions.combined = Object.assign({}, ...Object.values(dimensions));
    const measured = {};
    for (const [label, options] of Object.entries(dimensions)) {
      const shape = populatedObservation(options);
      const { observed } = await observePopulated(scope, `growth-${label}`, shape);
      measured[label] = defaultFrame(observed, `${label} default`).utf8_bytes;
      assertPopulatedDefault(observed, shape, `${label} default`);
      assert.deepEqual(responseRepetitions(observed.structured), [], label);
    }

    for (const label of ["carrierBodies", "descriptorInventory", "diagnosticDepthMultibyte",
      "workerText", "materializationPath"]) {
      assert.ok(measured[label] - measured.baseline <= 32,
        `${label} grew the default answer by ${measured[label] - measured.baseline} bytes`);
    }
    t.diagnostic(`WK-2671 default growth: ${JSON.stringify(measured)}`);
  } finally {
    await scope.dispose();
  }
});

test("WK-2671: the default-answer oracles detect bloat, lost facts, false claims, wrong identities and repeated effects", async () => {
  const scope = createTestResourceScope();
  try {
    let lifecycleCalls = 0;
    let detailReads = 0;
    const shape = populatedObservation({ descriptorCount: 200, proofRows: 4 });
    const { tools, observed } = await observePopulated(scope, "sensitivity", shape, {
      onLifecycle: () => { lifecycleCalls += 1; },
      onDetail: () => { detailReads += 1; }
    });
    const label = "sensitivity default";
    defaultFrame(observed, label);
    assertPopulatedDefault(observed, shape, label);
    const clone = () => structuredClone(observed.structured);
    const asFrame = (structured) => ({ raw: { content: [], structuredContent: structured },
      entry: { id: "control" } });

    const complete = await observe(tools, COMPLETE);
    const restored = clone();
    restored.slice_lifecycle.terminal_candidate.binding =
      complete.structured.slice_lifecycle.terminal_candidate.binding;
    assert.throws(() => assertDefaultStatusFrame([asFrame(restored)], "restored binding"),
      /output_budget_exceeded/u);

    const duplicated = clone();
    const block = { descriptors: shape.candidate.binding.version_decision.controlled_generation.descriptors };
    duplicated.slice_lifecycle.integration.metadata = block;
    duplicated.slice_lifecycle.terminal_candidate.metadata = structuredClone(block);
    assert.ok(responseRepetitions(duplicated).some((finding) =>
      finding.kind === "duplicate_response_subtree"));

    const noLimitation = clone();
    delete noLimitation.proof_verification.last_recorded_invocation.outcome.proofs[0]
      .capability_limitations;
    assert.throws(() => assertPopulatedDefault({ structured: noLimitation }, shape, "no limitation"),
      assert.AssertionError);
    const noReason = clone();
    noReason.proof_verification.last_recorded_invocation.outcome.reasons = {};
    assert.throws(() => assertPopulatedDefault({ structured: noReason }, shape, "no reason"));
    const running = clone();
    running.terminal = false;
    delete running.next_action;
    assert.throws(() => defaultStatusConclusion(running, "no next action"),
      /default_status_fact_missing/u);

    const falseCompletion = clone();
    falseCompletion.slice_lifecycle.phase = "integrated";
    assert.throws(() => defaultStatusConclusion(falseCompletion, "false completion"),
      /default_status_fact_missing/u);
    const booleanProof = clone();
    booleanProof.proof_verification.last_recorded_invocation.outcome = { proven: true };
    assert.throws(() => defaultStatusConclusion(booleanProof, "boolean proof"),
      /default_status_fact_missing/u);
    const published = clone();
    published.slice_lifecycle.terminal_candidate.merged = true;
    assert.throws(() => defaultStatusConclusion(published, "publication claim"),
      /default_status_fact_missing/u);

    const swapped = clone();
    swapped.slice_lifecycle.terminal_candidate.candidate =
      shape.invocation.tested_source.source_snapshot_digest;
    assert.throws(() => assertPopulatedDefault({ structured: swapped }, shape, "tested source as candidate"));
    const stale = clone();
    stale.slice_lifecycle.integration.delivery_sha = BASE;
    assert.throws(() => assertPopulatedDefault({ structured: stale }, shape, "stale delivery"));

    const lifecycleBefore = lifecycleCalls;
    await observe(tools, { subject: SUBJECT, detail: { kind: "proof_verification" } });
    await observe(tools, COMPLETE);
    assert.equal(lifecycleCalls, lifecycleBefore, "reads drove no lifecycle");
    assert.ok(detailReads >= 1);
    const replaying = createDispatchToolRegistry({ backend: observationBackend({
      status: shape.status, lifecycle: shape.lifecycle, recordedCount: shape.recordedCount,
      lastRecordedInvocation: shape.invocation,
      onDetail: () => { lifecycleCalls += 1; }
    }) });
    await observe(replaying, { subject: SUBJECT, detail: { kind: "proof_verification" } });
    assert.throws(() => assert.equal(lifecycleCalls, lifecycleBefore, "a replaying read"),
      assert.AssertionError);
  } finally {
    await scope.dispose();
  }
});
