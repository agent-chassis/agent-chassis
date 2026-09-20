

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createDispatchToolRegistry,
  createResumableLifecycleHarness,
  parseStructuredTextResponse
} from "../../packages/wiki-mcp/src/lib/dispatch-tools-test-helpers.mjs";
import {
  INTEGRATION_TRANSITION_RECORD_CARRIER_MEMBER,
  RUN_STATUS_INTEGRATION_RECEIPT_PROJECTION_SCHEMA_VERSION,
  projectPublishedIntegrationReceipt,
  readIntegrationTransitionAuthoredRecord
} from "../../packages/wiki-mcp/src/lib/dispatch-run-status-integration-receipt-projection.mjs";
import {
  activeMcpInlineByteLimit,
  jsonContent,
  normalizeMcpToolResult
} from "../../packages/wiki-mcp/src/lib/mcp-response.mjs";
import { SELECTED_RESPONSE_SOURCE_SCHEMA_VERSION } from
  "../../packages/wiki-mcp/src/lib/selected-response-snapshot.mjs";
import {
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
  terminalCandidate,
  terminalWorkerStatus
} from "../helpers/run-status-authored-document-fixture.mjs";
import { createTestResourceScope } from "../helpers/test-resource-scope.mjs";

function receiptOf(structured) {
  return structured.slice_lifecycle.integration.transition.written_record;
}

function unprojectedBytes(observed, record) {
  const clone = structuredClone(observed.structured);
  const transition = clone.slice_lifecycle.integration.transition;
  delete transition.written_record;
  transition.record = record;
  const text = JSON.stringify(clone);
  return Buffer.byteLength(
    JSON.stringify({ content: [{ type: "text", text }], structuredContent: clone }), "utf8");
}

test("WK-2691: the reproduced leak — the integration receipt publishes the written record as identity, not as a document", async () => {
  const scope = createTestResourceScope();
  try {
    const record = authoredRecord();
    const candidate = terminalCandidate(record);
    const { tools } = await retrievalRegistry(scope, "receipt-leak", observationBackend({
      status: terminalWorkerStatus(),
      lifecycle: finalizedLifecycle(candidate, { transitionRecord: record })
    }));

    const observed = await observe(tools, { subject: SUBJECT });
    const transition = observed.structured.slice_lifecycle.integration.transition;

    assert.equal(Object.hasOwn(transition, "record"), false,
      "the written record body must not be echoed");
    const wire = JSON.stringify(observed.structured);
    assert.equal(wire.includes("parent criterion 19"), false);
    assert.equal(wire.includes("slice 1 criterion"), false);
    assert.equal(wire.includes("coordination entry 24"), false);

    assert.equal(wire.includes("classification_rationale"), false);
    assert.equal(wire.includes("Operator-authorized expedited exception"), false);

    assert.equal(transition.valid, true);
    assert.equal(transition.written, true);

    const receipt = receiptOf(observed.structured);
    assert.equal(receipt.schema_version,
      RUN_STATUS_INTEGRATION_RECEIPT_PROJECTION_SCHEMA_VERSION);
    assert.equal(receipt.grants_authority, false);
    assert.equal(receipt.evidence_class, "historical_attempt_snapshot");
    assert.equal(receipt.current_record_read_is_equivalent, false);
    assert.equal(receipt.omitted.member, "record");
    assert.equal(receipt.omitted.carrier_member, INTEGRATION_TRANSITION_RECORD_CARRIER_MEMBER);
    assert.equal(receipt.omitted.record_id, WK_ID);
    assert.equal(receipt.omitted.record_schema_version, "work-record.v1");

    assert.equal(receipt.omitted.record_status, "review");
    assert.equal(receipt.omitted.slice_count, 4);
    assert.equal(receipt.omitted.utf8_bytes, Buffer.byteLength(JSON.stringify(record), "utf8"));
    assert.match(receipt.omitted.digest, /^sha256:[0-9a-f]{64}$/u);

    const retrieval = receipt.retrieval;
    assert.equal(retrieval.state, "retained");
    assert.equal(retrieval.source_schema_version, SELECTED_RESPONSE_SOURCE_SCHEMA_VERSION);
    assert.equal(retrieval.retained_source_read.tool, "workspace_read_mcp_content_reference");
    assert.deepEqual(retrieval.retained_source_read.arguments,
      { ref_id: retrieval.ref_id, offset: 0 });
    assert.equal(retrieval.binding.route, "workspace_agent_run_status");
    assert.equal(retrieval.binding.repository, "agent-chassis");
    assert.equal(retrieval.binding.unit, SUBJECT);
    assert.equal(retrieval.binding.observation_identity.attempt_id, "run-worker-2691");
    assert.ok(retrieval.carrier_members.includes(INTEGRATION_TRANSITION_RECORD_CARRIER_MEMBER));

    assert.equal(observed.structured.run_id, "run-worker-2691");
    assert.equal(observed.structured.subject, SUBJECT);
    assert.equal(observed.structured.terminal, true);
    assert.equal(observed.structured.child_terminal, true);
    assert.equal(observed.structured.settled, true);
    assert.equal(observed.structured.status, "succeeded");
    assert.equal(observed.structured.lifecycle_resolution.phase, "finalized");
    assert.equal(observed.structured.slice_lifecycle.phase, "finalized");
    assert.equal(observed.structured.slice_lifecycle.integrated, true);
    assert.equal(observed.structured.slice_lifecycle.integration.slice_sha, TIP);
    assert.equal(observed.structured.slice_lifecycle.integration.wk_sha, TIP);
    assert.equal(observed.structured.slice_lifecycle.integration.review_target.sha, TIP);
    assert.equal(observed.structured.slice_lifecycle.wk_transitioned_to_review, true);
    assert.equal(
      observed.structured.slice_lifecycle.terminal_candidate.materialization.root,
      `/worktrees/.terminal-candidates/${WK_ID}`);
    assert.equal(observed.structured.slice_lifecycle.terminal_candidate.dependency_proof.state,
      "verified");

    assert.equal(observed.structured.proof_verification.state, "none_recorded");
    assert.equal(observed.structured.proof_verification.grants_authority, false);

    const before = unprojectedBytes(observed, record);
    const savedFraction = (before - observed.bytes) / before;
    assert.ok(savedFraction >= 0.7,
      `record-heavy default response must lose at least 70% of its bytes; ${before} -> ${observed.bytes}`);
  } finally {
    await scope.dispose();
  }
});

test("WK-2691: the receipt does not grow with unrelated authored text, and both branches share one retained artifact", async () => {
  const scope = createTestResourceScope();
  try {
    const leanRecord = authoredRecord();

    const paddedRecord = authoredRecord({ padding: "x".repeat(21000) });
    const grownBy = Buffer.byteLength(JSON.stringify(paddedRecord), "utf8") -
      Buffer.byteLength(JSON.stringify(leanRecord), "utf8");
    assert.ok(grownBy >= 60000, `authored text must grow by at least 60KB; grew ${grownBy}`);

    const observations = [];
    const artifactCounts = [];
    for (const [label, record] of [["lean", leanRecord], ["padded", paddedRecord]]) {
      const { tools, dir } = await retrievalRegistry(scope, `receipt-${label}`, observationBackend({
        status: terminalWorkerStatus(),
        lifecycle: finalizedLifecycle(terminalCandidate(record), { transitionRecord: record })
      }));
      observations.push(await observe(tools, { subject: SUBJECT }));
      artifactCounts.push(retainedArtifacts(dir).length);
    }
    const [lean, padded] = observations;

    assert.deepEqual(artifactCounts, [1, 1]);
    assert.deepEqual(receiptOf(lean.structured).retrieval.carrier_members, [
      "canonical_parent_wk_contract",
      "review_unit_contract",
      INTEGRATION_TRANSITION_RECORD_CARRIER_MEMBER
    ]);
    assert.equal(
      receiptOf(lean.structured).retrieval.ref_id,
      lean.structured.slice_lifecycle.terminal_candidate.review_unit
        .authored_contracts.retrieval.ref_id,
      "both projections publish the one locator this observation minted");

    assert.notEqual(receiptOf(padded.structured).omitted.digest,
      receiptOf(lean.structured).omitted.digest);
    assert.equal(
      receiptOf(padded.structured).omitted.utf8_bytes -
        receiptOf(lean.structured).omitted.utf8_bytes,
      grownBy);
    assert.equal(receiptOf(padded.structured).omitted.record_status, "review");
    assert.equal(receiptOf(padded.structured).omitted.slice_count, 4);

    const growth = padded.bytes - lean.bytes;
    assert.ok(growth < 64,
      `compact status must not scale with unrelated authored text; grew ${growth} bytes for ${grownBy}`);

    const receiptRetrievalBytes = Buffer.byteLength(
      JSON.stringify(receiptOf(padded.structured).retrieval), "utf8");
    assert.ok(receiptRetrievalBytes < 2048,
      `the repeated retrieval limb stays bounded; was ${receiptRetrievalBytes}`);
    assert.ok(padded.bytes < 20_480,
      `default status stays inside the compact class; was ${padded.bytes}`);
  } finally {
    await scope.dispose();
  }
});

test("WK-2691: following the emitted read reconstructs the written record exactly", async () => {
  const scope = createTestResourceScope();
  try {

    const record = authoredRecord({ padding: " — ünïcodé ✓ 日本語 контракт " });
    const candidate = terminalCandidate(record);
    const { tools } = await retrievalRegistry(scope, "receipt-exact", observationBackend({
      status: terminalWorkerStatus(),
      lifecycle: finalizedLifecycle(candidate, { transitionRecord: record })
    }));

    const observed = await observe(tools, { subject: SUBJECT });
    const receipt = receiptOf(observed.structured);
    const { bytes, pages, readerDigest } = await followRetrievalCall(tools, receipt.retrieval);
    assert.ok(pages >= 2, `a source larger than one range needs continuation; pages=${pages}`);
    assert.equal(readerDigest, receipt.retrieval.sha256);

    const envelope = JSON.parse(bytes.toString("utf8"));
    assert.equal(envelope.schema_version, SELECTED_RESPONSE_SOURCE_SCHEMA_VERSION);
    const carried = envelope.carrier[INTEGRATION_TRANSITION_RECORD_CARRIER_MEMBER];

    assert.equal(carried, JSON.stringify(record));
    assert.deepEqual(JSON.parse(carried), record);
    assert.equal(Buffer.byteLength(carried, "utf8"), receipt.omitted.utf8_bytes);
    assert.equal(
      `sha256:${createHash("sha256").update(carried, "utf8").digest("hex")}`,
      receipt.omitted.digest);

    assert.match(JSON.parse(carried).proof_posture.classification_rationale,
      /Operator-authorized expedited exception/u);

    const carrierStep = receipt.retrieval.reconstruction.at(-1);
    assert.match(carrierStep, new RegExp(INTEGRATION_TRANSITION_RECORD_CARRIER_MEMBER, "u"));
    assert.match(carrierStep, /JSON\.parse/u);
  } finally {
    await scope.dispose();
  }
});

test("WK-2691: repeated and concurrent observation add no lifecycle effect and no extra artifact", async () => {
  const scope = createTestResourceScope();
  try {
    const record = authoredRecord();
    let lifecycleCalls = 0;
    const { tools, dir } = await retrievalRegistry(scope, "receipt-reuse", observationBackend({
      status: terminalWorkerStatus(),
      lifecycle: finalizedLifecycle(terminalCandidate(record), { transitionRecord: record }),
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
    assert.ok(complete.bytes > first.bytes,
      "requested complete evidence still costs more than the compact answer");

    const { bytes } = await followRetrievalCall(tools, receiptOf(third.structured).retrieval);
    assert.deepEqual(
      JSON.parse(JSON.parse(bytes.toString("utf8"))
        .carrier[INTEGRATION_TRANSITION_RECORD_CARRIER_MEMBER]),
      record);
  } finally {
    await scope.dispose();
  }
});

test("WK-2691: adverse, unsettled and record-free observations stay truthful", async () => {

  const record = authoredRecord();
  const plain = createDispatchToolRegistry({
    backend: observationBackend({
      status: terminalWorkerStatus(),
      lifecycle: finalizedLifecycle(terminalCandidate(record))
    })
  });
  const noRecord = await observe(plain, { subject: SUBJECT });
  assert.deepEqual(noRecord.structured.slice_lifecycle.integration.transition,
    { valid: true, written: true });

  const running = createDispatchToolRegistry({
    backend: observationBackend({
      status: {
        accepted: true, timed_out: false, run_id: "run-worker-running",
        monitor_handle: "wkmh_running", role: "worker", subject: SUBJECT,
        status: "running", terminal: false,
        started_at: "2026-09-19T00:00:00.000Z", updated_at: "2026-09-19T00:00:30.000Z"
      },
      lifecycle: null
    })
  });
  const observedRunning = await observe(running, { subject: SUBJECT });
  assert.equal(observedRunning.structured.terminal, false);
  assert.equal(Object.hasOwn(observedRunning.structured, "slice_lifecycle"), false);
  assert.equal(observedRunning.structured.next_action, "retry_wait_or_check_status");

  const harness = createResumableLifecycleHarness({
    declaredTerminalReviewUnit: { record_id: WK_ID, initiative: "IN-0021", subject: SUBJECT }
  });
  harness.deps.prepareTerminalCandidate = async () => {
    throw new Error("injected terminal candidate preparation failure");
  };
  const failing = createDispatchToolRegistry({
    backend: {
      getRunStatus: async () => harness.status,
      waitForRunStatus: async () => harness.status,
      runPostWorkerSliceLifecycle: harness.invoke,
      readManagedRunObservation: async () => ({ ok: false, code: "run_detail_unavailable" })
    }
  });
  const failed = await observe(failing, { subject: harness.status.subject });
  assert.equal(failed.structured.slice_lifecycle.phase, "integrated");
  assert.equal(failed.structured.slice_lifecycle.integrated, true);
  assert.equal(failed.structured.slice_lifecycle.error_code,
    "agent_launch.slice_lifecycle.terminal_candidate_preparation_failed.v1");
  assert.deepEqual(failed.structured.slice_lifecycle.integration, harness.integrationResult);
  assert.equal(failed.structured.next_action, "retry_wait_or_check_status");
  assert.equal(failed.structured.proof_verification.state, "unavailable");
  assert.equal(harness.counts().integrationCalls, 1);
});

test("WK-2691: the receipt projection replaces one named member and passes everything else through", () => {

  const bare = Object.freeze({ invoked: true, phase: "pre_integration" });
  assert.equal(projectPublishedIntegrationReceipt(bare), bare);
  assert.equal(projectPublishedIntegrationReceipt(null), null);
  const noTransition = Object.freeze({ integration: Object.freeze({ integrated: true }) });
  assert.equal(projectPublishedIntegrationReceipt(noTransition), noTransition);
  const noRecord = Object.freeze({
    integration: Object.freeze({ transition: Object.freeze({ valid: true, written: false }) })
  });
  assert.equal(projectPublishedIntegrationReceipt(noRecord), noRecord);
  assert.equal(readIntegrationTransitionAuthoredRecord(bare), null);
  assert.equal(readIntegrationTransitionAuthoredRecord(noRecord), null);

  const scalarRecord = Object.freeze({
    integration: Object.freeze({ transition: Object.freeze({ valid: true, record: "WK-1537" }) })
  });
  assert.equal(projectPublishedIntegrationReceipt(scalarRecord), scalarRecord);

  const record = authoredRecord();
  const lifecycle = finalizedLifecycle(terminalCandidate(record), { transitionRecord: record });
  lifecycle.future_lifecycle_fact = { kind: "not_yet_invented" };
  lifecycle.integration.future_integration_fact = ["kept"];
  lifecycle.integration.transition.future_transition_fact = "kept";
  const projected = projectPublishedIntegrationReceipt(lifecycle);
  assert.deepEqual(projected.future_lifecycle_fact, { kind: "not_yet_invented" });
  assert.deepEqual(projected.integration.future_integration_fact, ["kept"]);
  assert.equal(projected.integration.transition.future_transition_fact, "kept");
  assert.deepEqual(projected.integration.review_target, lifecycle.integration.review_target);
  assert.equal(projected.integration.wk_sha, TIP);

  assert.equal(projected.terminal_candidate.review_unit.canonical_parent_wk_contract,
    lifecycle.terminal_candidate.review_unit.canonical_parent_wk_contract);

  const unretained = receiptOf({ slice_lifecycle: projected });
  assert.equal(unretained.retrieval.state, "unavailable");
  assert.equal(unretained.retrieval.code, "authored_contract_source_not_retained");
  assert.equal(Object.hasOwn(unretained.retrieval, "retained_source_read"), false);
  const failedRetention = receiptOf({
    slice_lifecycle: projectPublishedIntegrationReceipt(lifecycle, {
      retention: { state: "unavailable", code: "mcp_response.spill_persistence_failed.v1" }
    })
  });
  assert.equal(failedRetention.retrieval.state, "unavailable");
  assert.equal(failedRetention.retrieval.code, "mcp_response.spill_persistence_failed.v1");
  assert.match(failedRetention.retrieval.meaning, /no current read substitutes/u);
});

test("WK-2691: a spilled response names the frame it compared apart from the payload it retained", async () => {
  const scope = createTestResourceScope();
  try {
    const dir = await scope.acquire("spill-measure",
      () => mkdtempSync(path.join(os.tmpdir(), "wk2691-spill-")),
      (created) => rmSync(created, { recursive: true, force: true }));
    const env = { ...process.env, WIKI_MCP_RESPONSE_STATE_DIR: dir };
    const limit = activeMcpInlineByteLimit(env);

    const payload = { schema_version: "test.v1", blob: "z".repeat(Math.floor(limit * 0.62)) };
    const payloadBytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
    assert.ok(payloadBytes < limit, `payload must fit under the limit; ${payloadBytes} >= ${limit}`);

    const envelope = parseStructuredTextResponse(jsonContent(payload, { env }));
    assert.equal(envelope.response_spilled, true);
    assert.equal(envelope.reason, "response_exceeds_inline_byte_limit");

    assert.equal(envelope.inline_byte_limit, limit);
    assert.ok(envelope.total_bytes < limit,
      "the retained payload is smaller than the limit, which is not a contradiction");
    const measurement = envelope.measurement;
    assert.equal(measurement.schema_version, "mcp-response-spill-measurement.v1");
    assert.equal(measurement.compared, "complete_frame_bytes_exceeded_inline_byte_limit");
    assert.equal(measurement.inline_byte_limit, limit);
    assert.equal(measurement.retained_payload_bytes, envelope.total_bytes);
    assert.ok(measurement.complete_frame_bytes > limit,
      `the compared frame must exceed the limit; ${measurement.complete_frame_bytes} <= ${limit}`);

    assert.ok(measurement.complete_frame_bytes > envelope.total_bytes);
    assert.match(measurement.meaning, /two-channel/u);
    assert.match(measurement.retained_payload_encoding, /indent=2/u);
  } finally {
    await scope.dispose();
  }
});

test("WK-2691 remediation: normalization reports its oversized frame while deliberate retention stays unmeasured", async () => {
  const scope = createTestResourceScope();
  try {
    const dir = await scope.acquire("normalize-spill-measure",
      () => mkdtempSync(path.join(os.tmpdir(), "wk2691-normalize-spill-")),
      (created) => rmSync(created, { recursive: true, force: true }));
    const env = { ...process.env, WIKI_MCP_RESPONSE_STATE_DIR: dir };
    const limit = activeMcpInlineByteLimit(env);
    const payload = { schema_version: "test.v1", blob: "n".repeat(Math.floor(limit * 0.62)) };

    const normalized = normalizeMcpToolResult({
      content: [{ type: "text", text: "stale pre-normalization channel" }],
      structuredContent: payload,
      protocol_extension: { preserved: true }
    }, { env });
    const measured = parseStructuredTextResponse(normalized);
    assert.equal(measured.response_spilled, true);
    assert.equal(measured.measurement.compared,
      "complete_frame_bytes_exceeded_inline_byte_limit");
    assert.ok(measured.measurement.complete_frame_bytes > limit);
    assert.equal(normalized.protocol_extension.preserved, true);

    const retained = parseStructuredTextResponse(jsonContent(payload, { env, forceSpill: true }));
    assert.equal(retained.response_spilled, true);
    assert.equal(retained.measurement.compared, "not_compared_retention_forced");
    assert.equal(retained.measurement.complete_frame_bytes, null);
  } finally {
    await scope.dispose();
  }
});
