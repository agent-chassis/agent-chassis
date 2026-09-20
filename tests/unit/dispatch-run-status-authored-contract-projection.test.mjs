

import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  createResumableLifecycleHarness,
  createDispatchToolRegistry,
  parseStructuredTextResponse
} from "../../packages/wiki-mcp/src/lib/dispatch-tools-test-helpers.mjs";
import {
  RUN_STATUS_AUTHORED_CONTRACT_PROJECTION_SCHEMA_VERSION,
  TERMINAL_CANDIDATE_AUTHORED_CONTRACT_MEMBERS,
  projectPublishedSliceLifecycle,
  readTerminalCandidateAuthoredContracts
} from "../../packages/wiki-mcp/src/lib/dispatch-run-status-authored-contract-projection.mjs";
import {
  readSelectedResponseSource,
  SELECTED_RESPONSE_SOURCE_SCHEMA_VERSION
} from "../../packages/wiki-mcp/src/lib/selected-response-snapshot.mjs";

import {
  BASE,
  CANDIDATE,
  MALFORMED_FINAL_RESULT,
  SLICE_ID,
  SUBJECT,
  TIP,
  WK_ID,
  authoredRecord,
  finalizedLifecycle,
  followRetrievalCall,
  observationBackend,
  observe,
  retainedArtifacts,
  retrievalRegistry,
  sha256Hex,
  terminalCandidate,
  terminalWorkerStatus
} from "../helpers/run-status-authored-document-fixture.mjs";
import { createTestResourceScope } from "../helpers/test-resource-scope.mjs";

function authoredContractsOf(structured) {
  return structured.slice_lifecycle.terminal_candidate.review_unit.authored_contracts;
}

function unprojectedBytes(observed, candidate) {
  const clone = structuredClone(observed.structured);
  const reviewUnit = clone.slice_lifecycle.terminal_candidate.review_unit;
  delete reviewUnit.authored_contracts;
  reviewUnit.canonical_parent_wk_contract = candidate.contracts.canonical_parent_wk_contract;
  reviewUnit.review_unit_contract = candidate.contracts.slice_review_contract;
  const text = JSON.stringify(clone);
  return Buffer.byteLength(JSON.stringify({ content: [{ type: "text", text }], structuredContent: clone }), "utf8");
}

test("WK-2691: the reproduced leak — default run status publishes the authored contracts as identity, not as documents", async () => {
  const scope = createTestResourceScope();
  try {
  const record = authoredRecord();
  const candidate = terminalCandidate(record);
  const { tools } = await retrievalRegistry(scope, "leak", observationBackend({
    status: terminalWorkerStatus(),
    lifecycle: finalizedLifecycle(candidate)
  }));

  const observed = await observe(tools, { subject: SUBJECT });
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
      candidate_version: 1
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

test("WK-2691: omitted, false and true include_final_result observe the same retained state without the record echo", async () => {
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
  assert.deepEqual(explicitTrue.structured.slice_lifecycle, omitted.structured.slice_lifecycle);
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
      observations.push(await observe(tools, { subject: SUBJECT }));
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
    assert.ok(paddedObserved.bytes < 16_384,
      `default status stays inside the compact class; was ${paddedObserved.bytes}`);
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
    observe(tools, { subject: SUBJECT }),
    observe(tools, { subject: SUBJECT })
  ]);
  const third = await observe(tools, { subject: SUBJECT });

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

  const harness = createResumableLifecycleHarness({
    declaredTerminalReviewUnit: { record_id: "WK-1537", initiative: "IN-0021", subject: SUBJECT }
  });
  harness.deps.prepareTerminalCandidate = async () => {
    throw new Error("injected terminal candidate preparation failure");
  };
  const tools = createDispatchToolRegistry({
    backend: {
      getRunStatus: async () => harness.status,
      waitForRunStatus: async () => harness.status,
      runPostWorkerSliceLifecycle: harness.invoke,
      readManagedRunObservation: async () => ({ ok: false, code: "run_detail_unavailable" })
    }
  });

  const observed = await observe(tools, { subject: harness.status.subject });
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
  assert.ok(observed.bytes < 12000, `a failed observation stays bounded; was ${observed.bytes}`);
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

    const observed = await observe(tools, { subject: SUBJECT });
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
      readManagedRunObservation: async () => ({ ok: false, code: "run_detail_unavailable" })
    });
    const captured = authoredContractsOf((await observe(tools, { subject: SUBJECT })).structured);

    const rewritten = authoredRecord({ padding: " REAUTHORED AFTER CAPTURE " });
    const laterCandidate = terminalCandidate(rewritten);
    laterCandidate.binding.candidate = "d".repeat(40);
    laterCandidate.binding.version_decision = { state: "selected", version: 2 };
    servedStatus = terminalWorkerStatus({ run_id: "run-worker-2691-later" });
    servedLifecycle = finalizedLifecycle(laterCandidate);
    const later = authoredContractsOf((await observe(tools, { subject: SUBJECT })).structured);

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
      (await observe(tools, { subject: SUBJECT })).structured).retrieval;
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
      observe(tools, { subject: SUBJECT }),
      observe(tools, { subject: SUBJECT })
    ]);
    const third = await observe(tools, { subject: SUBJECT });
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
    const before = unprojectedBytes(observed, candidate);
    const defaultTotal = observed.requestBytes + observed.bytes;
    assert.ok(defaultTotal < 16_384,
      `default status stays bounded over a ${authoredBytes}-byte parent contract; was ${defaultTotal}`);
    assert.ok((before - observed.bytes) / before >= 0.7);

    const retrieval = authoredContractsOf(observed.structured).retrieval;
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
      const page = parseStructuredTextResponse(result);
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
