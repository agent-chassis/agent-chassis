

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { POST_WORKER_LIFECYCLE_CHECKPOINT } from
  "../../packages/wiki-mcp/src/lib/dispatch-post-worker-lifecycle-bindings.mjs";

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
  followDocumentCall,
  observationBackend,
  observe,
  publicByteRead,
  readRetainedDocument,
  readRetainedEnvelope,
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
import { criterionIdentityDigest } from "../../packages/controlled-contract/current.mjs";

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
  assert.deepEqual(Object.keys(retrieval.document_calls),
    ["canonical_parent_wk_contract", "review_unit_contract"]);
  for (const [member, call] of Object.entries(retrieval.document_calls)) {
    assert.equal(call.tool, "workspace_agent_run_status");
    assert.deepEqual(call.arguments, { repo: "agent-chassis", subject: SUBJECT,
      attempt_id: "run-worker-2691", detail: { kind: "authored_document", source: retrieval.source,
        document: member } });
    assert.equal(call.success_predicate.fact, "monitor.authored_document_detail_read");
  }
  for (const forbidden of ["retained_source_read", "reconstruction", "ref_id", "sha256"]) {
    assert.equal(Object.hasOwn(retrieval, forbidden), false, `no ${forbidden}`);
  }
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

  assert.ok(view.omitted_members.includes("terminal_candidate"));
  assert.deepEqual(view.terminal_candidate.review_unit, { record_id: WK_ID, slice_id: SLICE_ID });
  assert.equal(`${WK_ID}#${SLICE_ID}`, SUBJECT);
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
      projection.retrieval.source = "erased";
      for (const call of Object.values(projection.retrieval.document_calls)) {
        call.arguments.detail.source = "erased";
      }
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
      runPostWorkerSliceLifecycle: (input) => {

        checkpoint = input.status[POST_WORKER_LIFECYCLE_CHECKPOINT];
        return harness.invoke(input);
      },
      readManagedRunObservation: async (input) => input?.detail === undefined
        ? unfailedAttemptSelection(harness.status)
        : ({ ok: false, code: "run_detail_unavailable" })
    }
  });
  let checkpoint = null;

  const observed = await observe(tools, { subject: harness.status.subject, include_final_result: true });
  assert.equal(observed.structured.terminal, false);
  assert.equal(observed.structured.child_terminal, true);
  assert.equal(observed.structured.slice_lifecycle.phase, "integrated");
  assert.equal(observed.structured.slice_lifecycle.integrated, true);
  assert.equal(observed.structured.slice_lifecycle.error_code,
    "agent_launch.slice_lifecycle.terminal_candidate_preparation_failed.v1");
  assert.deepEqual(observed.structured.slice_lifecycle.integration, harness.integrationResult);

  const publicEvidence = observed.structured.slice_lifecycle.evidence;
  assert.ok(publicEvidence.thrown.cause_chain.some((level) =>
    level.message === "injected terminal candidate preparation failure"),
  JSON.stringify(publicEvidence.thrown));
  assert.deepEqual(publicEvidence.retained_evidence, { retained: true,
    owner: "post_worker_lifecycle_failure_record", audience: "operator", fields: ["evidence.thrown"] });
  assert.equal(JSON.stringify(observed.structured).includes("\"stack\""), false);
  const original = checkpoint.retained_failure.evidence.thrown.value;
  assert.match(original.stack, /injected terminal candidate preparation failure/u);
  assert.ok(JSON.stringify(original).includes("injected terminal candidate preparation failure"));
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
  assert.match(unretained.retrieval.meaning, /not readable/u);

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

const LISTED_SELECTIONS = Object.freeze({ units: "unit", entries: "entry", criteria: "criterion",
  carriers: "carrier", obligations: "obligation", sections: "section" });
function everyNarrowerRead(answer, label) {
  const { detail, next_calls: offered } = answer.structured;
  assert.ok(offered.length >= 1, `${label}: at least one narrower read is offered`);
  assert.equal(detail.narrower_selections.offered, offered.length, label);
  if (offered.length === detail.narrower_selections.total) return offered;
  const varying = Object.entries(LISTED_SELECTIONS).find(([listing, field]) =>
    Array.isArray(detail.summary[listing]) &&
    offered.every((call) => call.arguments.detail[field] !== undefined));
  assert.ok(varying !== undefined, `${label}: the unoffered identities are listed`);
  const [listing, field] = varying;

  const inline = new Set(Object.keys(detail.summary.scalars ?? {}));
  const identities = detail.summary[listing].map((row) => row[field])
    .filter((identity) => identity !== null && !inline.has(identity));
  assert.equal(identities.length, detail.narrower_selections.total, `${label}: every narrower identity is listed`);
  assert.deepEqual(offered.map((call) => call.arguments.detail[field]),
    identities.slice(0, offered.length), `${label}: offered reads are a document-order prefix`);
  return identities.map((identity, index) => index < offered.length ? offered[index]
    : { ...offered[0], arguments: { ...offered[0].arguments,
      detail: { ...offered[0].arguments.detail, [field]: identity } } });
}

function assertDocumentAnswer(observed, retrieval, label) {
  const { structured } = observed;
  assert.equal(structured.accepted, true, `${label}: ${JSON.stringify(structured).slice(0, 1500)}`);
  assert.ok(measureMcpInlineResultBytes(structured) <= 8192, `${label}: fits the delivery bound`);
  assert.equal(Object.hasOwn(structured, "response_spilled"), false, label);
  assert.deepEqual(structured.detail.source, retrieval.source, label);
  assert.deepEqual(structured.detail.retained_source.observation_identity,
    retrieval.binding.observation_identity, label);
  const wire = JSON.stringify(structured);
  for (const forbidden of ["data_base64", "next_offset", "bytes_base64", "content_reference"]) {
    assert.equal(wire.includes(forbidden), false, `${label}: no ${forbidden}`);
  }
  return structured.detail;
}

test("WK-2716: the emitted document read answers both omitted documents from their exact originals, Unicode included", async () => {
  const scope = createTestResourceScope();
  try {

    const record = authoredRecord({ padding: " — ünïcodé ✓ 日本語 контракт " });
    const candidate = terminalCandidate(record);
    const { tools, dir, env } = await retrievalRegistry(scope, "exact", observationBackend({
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
    const artifactsBefore = retainedArtifacts(dir);

    const envelope = readRetainedEnvelope(env, retrieval);
    assert.equal(envelope.carrier.canonical_parent_wk_contract,
      candidate.contracts.canonical_parent_wk_contract);
    assert.equal(envelope.carrier.review_unit_contract, candidate.contracts.slice_review_contract);
    for (const row of projection.omitted) {
      const text = envelope.carrier[row.member];
      assert.equal(Buffer.byteLength(text, "utf8"), row.utf8_bytes);
      assert.equal(`sha256:${sha256Hex(Buffer.from(text, "utf8"))}`, row.digest);
    }
    const refusedResult = await publicByteRead(tools, retrieval);
    assert.equal(refusedResult.isError, true);
    const refused = refusedResult.structuredContent;
    assert.equal(refused.accepted, false);
    assert.equal(refused.limb, "selected_access");
    assert.equal(JSON.stringify(refused).includes("parent criterion"), false);
    assert.deepEqual(refused.refusal.next_calls.map((call) => call.tool), ["workspace_agent_run_status"]);
    assert.deepEqual(refused.refusal.next_calls[0].arguments.detail.source, retrieval.source);

    const slice = await readRetainedDocument(tools, retrieval, "review_unit_contract");
    const sliceDetail = assertDocumentAnswer(slice, retrieval, "review unit contract");
    assert.equal(sliceDetail.presentation, "complete");
    assert.deepEqual(sliceDetail.value, JSON.parse(candidate.contracts.slice_review_contract));
    assert.deepEqual(sliceDetail.document_identity, { digest: projection.omitted[1].digest,
      utf8_bytes: projection.omitted[1].utf8_bytes });

    const parent = JSON.parse(candidate.contracts.canonical_parent_wk_contract);
    const summary = await readRetainedDocument(tools, retrieval, "canonical_parent_wk_contract");
    const summaryDetail = assertDocumentAnswer(summary, retrieval, "parent summary");
    assert.deepEqual(summaryDetail.document_identity, { digest: projection.omitted[0].digest,
      utf8_bytes: projection.omitted[0].utf8_bytes });
    const units = [parent.id, ...parent.slices.map((unit) => `${parent.id}#${unit.id}`)];
    assert.equal(summaryDetail.presentation, "summary");
    assert.deepEqual(summaryDetail.summary.units.map((row) => row.unit), units);
    const unitReads = everyNarrowerRead(summary, "parent summary");
    assert.deepEqual(unitReads.map((call) => call.arguments.detail.unit), units,
      "one executable read per unit, in document order");

    const { slices, ...root } = parent;
    const original = (selection) => {
      const unit = selection.unit === undefined || selection.unit === parent.id ? root
        : slices.find((candidateUnit) => `${parent.id}#${candidateUnit.id}` === selection.unit);
      if (selection.entry !== undefined) {
        return unit.sections.entries.find((entry) => entry.id === selection.entry);
      }
      if (selection.section !== undefined) {
        return selection.section.startsWith("sections.")
          ? unit.sections[selection.section.slice("sections.".length)] : unit[selection.section];
      }
      return unit;
    };
    const leaves = new Set();
    const verify = async (call) => {
      const { detail: selection } = call.arguments;
      const answer = await followDocumentCall(tools, call);
      const detail = assertDocumentAnswer(answer, retrieval, JSON.stringify(selection));
      if (detail.presentation === "complete") {
        assert.deepEqual(detail.value, original(selection), JSON.stringify(selection));
        leaves.add(JSON.stringify(selection));
        return;
      }
      assert.equal(detail.presentation, "summary");

      for (const next of everyNarrowerRead(answer, JSON.stringify(selection))) await verify(next);
    };
    for (const call of unitReads) await verify(call);

    for (const entry of root.sections.entries) {
      assert.ok(leaves.has(JSON.stringify({ kind: "authored_document", source: retrieval.source,
        document: "canonical_parent_wk_contract", unit: parent.id, entry: entry.id })),
      `entry ${entry.id} is readable by its identity`);
    }

    const position = parent.acceptance.criteria.length - 1;
    const criterion = parent.acceptance.criteria[position];
    const identity = typeof criterion?.typed_identity === "string" ? criterion.typed_identity
      : `derived:${criterionIdentityDigest(position, typeof criterion === "string" ? criterion : criterion.text)}`;
    const criterionRead = assertDocumentAnswer(await readRetainedDocument(tools, retrieval,
      "canonical_parent_wk_contract", { criterion: identity }), retrieval, "parent criterion");
    assert.deepEqual([criterionRead.presentation, criterionRead.value, criterionRead.identity],
      ["complete", criterion, { criterion: identity, position }]);
    const sectionRead = assertDocumentAnswer(await readRetainedDocument(tools, retrieval,
      "canonical_parent_wk_contract", { unit: parent.id, section: "sections.summary" }), retrieval,
    "parent summary section");
    assert.deepEqual(sectionRead.value, parent.sections.summary);
    const unknown = (await readRetainedDocument(tools, retrieval, "canonical_parent_wk_contract",
      { criterion: "derived:sha256:unknown" })).structured;
    assert.equal(unknown.accepted, false);
    assert.equal(unknown.blocker.reason, "criterion_unknown");

    assert.deepEqual(retainedArtifacts(dir), artifactsBefore, "document reads retain nothing");
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

    assert.notEqual(later.retrieval.source.ref_id, captured.retrieval.source.ref_id,
      "a different candidate over different text retains its own source");
    assert.notEqual(later.omitted[0].digest, captured.omitted[0].digest);
    assert.equal(later.retrieval.binding.observation_identity.candidate, "d".repeat(40));

    const originalParent = JSON.parse(original.contracts.canonical_parent_wk_contract);
    const read = await readRetainedDocument(tools, captured.retrieval, "canonical_parent_wk_contract",
      { unit: WK_ID, section: "sections.summary" });
    assert.equal(read.structured.accepted, true, JSON.stringify(read.structured).slice(0, 1500));
    assert.deepEqual(read.structured.detail.value, originalParent.sections.summary);
    assert.equal(read.structured.detail.retained_source.observation_identity.candidate, CANDIDATE);
    assert.equal(JSON.stringify(read.structured).includes("REAUTHORED"), false);
    const call = captured.retrieval.document_calls.canonical_parent_wk_contract;
    const borrowed = await observe(tools, { ...call.arguments, attempt_id: "run-worker-2691-later" });
    assert.equal(borrowed.structured.accepted, false);
    assert.equal(borrowed.structured.blocker.reason, "source_binding_mismatch");
    assert.equal(JSON.stringify(borrowed.structured).includes("REAUTHORED"), false);
  } finally {
    await scope.dispose();
  }
});

test("WK-2691: a missing, tampered or foreign retained source refuses precisely and substitutes nothing", async () => {
  const scope = createTestResourceScope();
  try {
    const candidate = terminalCandidate(authoredRecord());
    const { tools, dir, env } = await retrievalRegistry(scope, "integrity", observationBackend({
      status: terminalWorkerStatus(),
      lifecycle: finalizedLifecycle(candidate)
    }));
    const retrieval = authoredContractsOf(
      (await observe(tools, COMPLETE)).structured).retrieval;
    const call = retrieval.document_calls.review_unit_contract;
    const sourcePath = path.join(dir, `${retrieval.source.ref_id}.json`);
    const originalBytes = readFileSync(sourcePath);
    const refusal = async (args, label) => {
      const observed = await observe(tools, args);
      assert.equal(observed.structured.accepted, false, `${label}: ${JSON.stringify(observed.structured)}`);
      const wire = JSON.stringify(observed.structured);
      assert.equal(wire.includes("parent criterion"), false, `${label}: nothing current is served`);
      assert.equal(wire.includes("slice 4 criterion"), false, `${label}: nothing retained is served`);
      return observed.structured;
    };

    assert.throws(
      () => readSelectedResponseSource(retrieval.source,
        { env, expected: { route: "workspace_agent_run_status", repository: "another-repo" } }),
      (error) => error?.envelope?.code === "selected_response_query_invalid");
    const foreignSubject = await refusal({ ...call.arguments, subject: `${WK_ID}#SLICE-001` },
      "foreign subject");
    assert.equal(foreignSubject.blocker.reason, "source_binding_mismatch");
    const foreignQuestion = await refusal({ ...call.arguments,
      detail: { kind: "retry_assessment", source: retrieval.source } }, "retry-assessment read");
    assert.equal(foreignQuestion.blocker.reason, "source_binding_mismatch");
    const noAttempt = await refusal({ ...call.arguments, attempt_id: undefined }, "no attempt");
    assert.equal(noAttempt.blocker.reason, "retained_detail_requires_attempt_id");
    const unknownDocument = await refusal({ ...call.arguments,
      detail: { ...call.arguments.detail, document: "integration_transition_record" } }, "absent member");
    assert.equal(unknownDocument.blocker.reason, "document_not_retained");

    const authenticated = await observe(tools, call.arguments);
    assert.equal(authenticated.structured.accepted, true);

    const tampered = Buffer.from(originalBytes);
    tampered[tampered.length - 2] = tampered[tampered.length - 2] === 0x20 ? 0x21 : 0x20;
    writeFileSync(sourcePath, tampered);
    const afterTamper = await refusal(call.arguments, "tampered");
    assert.equal(afterTamper.refusal.code, "mcp_response.content_reference_ranged_read_unavailable.v1");
    assert.equal(afterTamper.blocker.reason, "content_reference_digest_mismatch");

    writeFileSync(sourcePath, originalBytes.subarray(0, originalBytes.length - 64));
    const truncated = await refusal(call.arguments, "truncated");
    assert.equal(truncated.refusal.code, "mcp_response.content_reference_ranged_read_unavailable.v1");

    rmSync(sourcePath);
    const missing = await refusal(call.arguments, "missing");
    assert.equal(missing.refusal.code, "mcp_response.content_reference_ranged_read_unavailable.v1");
    assert.match(JSON.stringify(missing), /content_reference_not_found/u);
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

    const read = await readRetainedDocument(tools, authoredContractsOf(third.structured).retrieval,
      "review_unit_contract");
    assert.deepEqual(read.structured.detail.value, JSON.parse(candidate.contracts.slice_review_contract));
    assert.equal(retainedArtifacts(dir).length, 1);
    assert.equal(lifecycleCalls, 1);
  } finally {
    await scope.dispose();
  }
});

test("WK-2691: measured cost of the default answer and of a document question that follows it", async () => {
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
    defaultFrame(observed, `default status over a ${authoredBytes}-byte parent contract`);
    assert.ok((before - observed.bytes) / before >= 0.7);

    const retrieval = authoredContractsOf(complete.structured).retrieval;
    const summary = await readRetainedDocument(tools, retrieval, "canonical_parent_wk_contract");
    assert.equal(summary.structured.detail.presentation, "summary");
    const padded = await followDocumentCall(tools, summary.structured.next_calls[1]);
    const unit = padded.structured.detail;
    assert.ok(measureMcpInlineResultBytes(padded.structured) <= 8192);
    assert.equal(unit.selection.unit, `${WK_ID}#SLICE-001`);

    assert.equal(unit.presentation, "summary");
    const notes = unit.summary.sections.find((row) => row.section === "notes");
    assert.equal(notes.utf8_bytes, Buffer.byteLength("y".repeat(21000), "utf8"));
    const oversized = await readRetainedDocument(tools, retrieval, "canonical_parent_wk_contract",
      { unit: `${WK_ID}#SLICE-001`, section: "notes" });
    assert.equal(oversized.structured.accepted, false);
    assert.equal(oversized.structured.blocker.reason, "selected_value_exceeds_delivery_bound");
    assert.ok(summary.bytes + padded.bytes < authoredBytes,
      "a document question costs its answer, not the document");
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
    assert.ok(omitted.structured.slice_lifecycle.omitted_members.includes("terminal_candidate"));
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

test("WK-2716: the emitted read answers the exact historical generation carrier by carrier, and a later one does not move it", async () => {
  const scope = createTestResourceScope();
  try {
    const generation = controlledGeneration({
      descriptorCount: 5, body: "ünïcodé ✓ 日本語 контракт ".repeat(20)
    });
    let servedStatus = terminalWorkerStatus();
    let servedLifecycle = generationLifecycle({ generation }).lifecycle;
    const { tools, dir, env } = await retrievalRegistry(scope, "generation-exact", {
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
    const member = "terminal_candidate_controlled_generation";

    const text = readRetainedEnvelope(env, captured.retrieval).carrier[member];
    assert.equal(`sha256:${sha256Hex(Buffer.from(text, "utf8"))}`, captured.omitted.digest);
    assert.deepEqual(JSON.parse(text), generation);

    const answer = async (retrieval, selection = {}) => {
      const observed = await readRetainedDocument(tools, retrieval, member, selection);
      assert.equal(observed.structured.accepted, true, JSON.stringify(observed.structured).slice(0, 1500));
      assert.ok(measureMcpInlineResultBytes(observed.structured) <= 8192);
      assert.equal(JSON.stringify(observed.structured).includes("bytes_base64"), false);
      return observed.structured;
    };
    const verify = async (retrieval, expectedGeneration) => {
      const overview = await answer(retrieval);
      assert.equal(overview.detail.presentation, "summary");
      assert.deepEqual(overview.detail.summary.identity.generation_digest,
        expectedGeneration.generation_digest);
      assert.deepEqual(overview.detail.summary.counts, { descriptors: 5, manifest_descriptors: 1 });
      const expectedCarriers = [...expectedGeneration.descriptors, ...expectedGeneration.manifest_descriptors];

      assert.deepEqual(overview.detail.summary.carriers.map((row) => row.carrier),
        expectedCarriers.map((descriptor) => descriptor.path));
      for (const [index, row] of overview.detail.summary.carriers.entries()) {
        if (row.content_digest !== undefined) {
          assert.equal(row.content_digest, expectedCarriers[index].content_digest);
        }
      }
      const carrierReads = everyNarrowerRead({ structured: overview }, "generation overview");
      assert.deepEqual(carrierReads.map((call) => call.arguments.detail.carrier),
        expectedCarriers.map((descriptor) => descriptor.path));
      for (const call of carrierReads) {
        const carrier = (await followDocumentCall(tools, call)).structured.detail;
        const descriptor = expectedCarriers.find((entry) => entry.path === call.arguments.detail.carrier);
        assert.equal(carrier.presentation, "complete", descriptor.path);
        assert.deepEqual(carrier.value,
          JSON.parse(Buffer.from(descriptor.bytes_base64, "base64").toString("utf8")), descriptor.path);
      }

      const [first] = expectedGeneration.descriptors;
      const focused = await answer(retrieval, { focus: first.focus });
      assert.deepEqual(focused.detail.value, JSON.parse(Buffer.from(first.bytes_base64, "base64").toString("utf8")));
    };
    await verify(captured.retrieval, generation);

    const artifacts = retainedArtifacts(dir).length;
    const laterGeneration = controlledGeneration({ descriptorCount: 5, body: "REWRITTEN " });
    servedStatus = terminalWorkerStatus({ run_id: "run-worker-2671-later" });
    servedLifecycle = generationLifecycle({ generation: laterGeneration }).lifecycle;
    const later = generationSummaryOf((await observe(tools, COMPLETE)).structured);
    assert.notEqual(later.retrieval.source.ref_id, captured.retrieval.source.ref_id);
    assert.notEqual(later.omitted.digest, captured.omitted.digest);
    assert.equal(retainedArtifacts(dir).length, artifacts + 1, "the later observation retains its own");
    await verify(later.retrieval, laterGeneration);

    await verify(captured.retrieval, generation);
    assert.equal(retainedArtifacts(dir).length, artifacts + 1, "reads retain nothing");

    const unknown = (await readRetainedDocument(tools, captured.retrieval, member,
      { carrier: "wiki/contracts/absent.json" })).structured;
    assert.deepEqual([unknown.accepted, unknown.blocker.reason], [false, "carrier_unknown"]);
  } finally {
    await scope.dispose();
  }
});

test("WK-2716: an indivisible carrier value larger than one answer is reported exactly, never paged", async () => {
  const scope = createTestResourceScope();
  try {
    const generation = controlledGeneration({ descriptorCount: 1,
      body: "ünïcodé ✓ 日本語 контракт ".repeat(600) });
    const { lifecycle } = generationLifecycle({ generation });
    const { tools } = await retrievalRegistry(scope, "generation-indivisible",
      observationBackend({ status: terminalWorkerStatus(), lifecycle }));
    const retrieval = generationSummaryOf((await observe(tools, COMPLETE)).structured).retrieval;
    const member = "terminal_candidate_controlled_generation";
    const [descriptor] = generation.descriptors;
    const carrier = (await readRetainedDocument(tools, retrieval, member,
      { carrier: descriptor.path })).structured;
    assert.equal(carrier.detail.presentation, "summary");
    const body = carrier.detail.summary.sections.find((row) => row.section === "body");
    const decoded = JSON.parse(Buffer.from(descriptor.bytes_base64, "base64").toString("utf8"));
    assert.equal(body.utf8_bytes, Buffer.byteLength(decoded.body, "utf8"));
    assert.deepEqual(carrier.detail.summary.scalars, { schema_version: decoded.schema_version,
      wk_id: decoded.wk_id, slice: decoded.slice });
    const refused = (await followDocumentCall(tools, carrier.next_calls.find((call) =>
      call.arguments.detail.section === "body"))).structured;
    assert.equal(refused.accepted, false);
    assert.equal(refused.blocker.reason, "selected_value_exceeds_delivery_bound");
    assert.match(JSON.stringify(refused.refusal), new RegExp(String(body.utf8_bytes), "u"));
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
    const { tools, dir, env } = await retrievalRegistry(scope, "generation-combined", observationBackend({
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
      assert.deepEqual(retrieval.source, retrievals[0].source);
      assert.deepEqual(retrieval.carrier_members, members);
    }

    assert.deepEqual(retrievals.map((retrieval) => Object.keys(retrieval.document_calls)),
      [members.slice(0, 2), [members[2]], [members[3]]]);
    const envelope = readRetainedEnvelope(env, retrievals[1]);
    assert.deepEqual(Object.keys(envelope.carrier), members);
    const retainedGeneration = JSON.parse(envelope.carrier.terminal_candidate_controlled_generation);
    assert.deepEqual(retainedGeneration, generation);

    assert.equal(retainedGeneration.repository, GENERATION_REPOSITORY_ROOT);
    assert.equal(envelope.binding.repository, REPOSITORY);
    assert.equal(envelope.carrier.review_unit_contract, candidate.contracts.slice_review_contract);
    assert.deepEqual(JSON.parse(envelope.carrier.integration_transition_record), record);

    const written = (await readRetainedDocument(tools, retrievals[2], "integration_transition_record",
      { unit: `${WK_ID}#${SLICE_ID}` })).structured.detail;
    assert.deepEqual(written.value, record.slices.find((slice) => slice.id === SLICE_ID));
    assert.equal(retainedArtifacts(dir).length, 1);
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
    const call = retrieval.document_calls.terminal_candidate_controlled_generation;
    const sourcePath = path.join(dir, `${retrieval.source.ref_id}.json`);
    const originalBytes = readFileSync(sourcePath);
    const tampered = Buffer.from(originalBytes);
    tampered[tampered.length - 2] = tampered[tampered.length - 2] === 0x20 ? 0x21 : 0x20;
    writeFileSync(sourcePath, tampered);
    const afterTamper = (await observe(tools, call.arguments)).structured;
    assert.equal(afterTamper.accepted, false);
    assert.equal(afterTamper.blocker.reason, "content_reference_digest_mismatch");
    assert.equal(JSON.stringify(afterTamper).includes("bytes_base64"), false);

    rmSync(sourcePath);
    const missing = (await observe(tools, call.arguments)).structured;
    assert.equal(missing.accepted, false);
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
    for (const omitted of ["terminal_candidate", "integration.review_target",
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

    const restored = clone();
    restored.slice_lifecycle.terminal_candidate.binding = shape.candidate.binding;
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

const WK2670_DELIVERY = "d".repeat(40);

function candidateBoundObservation(options = {}) {
  const shape = populatedObservation(options);
  shape.candidate.binding.canonical_wk_id = WK_ID;
  shape.candidate.materialization = { ...shape.candidate.materialization,
    canonical_wk_id: WK_ID, candidate: CANDIDATE, verified: true };
  shape.lifecycle.terminal_candidate = { ...shape.lifecycle.terminal_candidate,
    materialization: shape.candidate.materialization };
  shape.lifecycle.integration.delivery_sha = WK2670_DELIVERY;
  shape.lifecycle.integration.slice_sha = WK2670_DELIVERY;
  return shape;
}

async function roleRegistry(scope, label, backend, role) {
  const dir = await scope.acquire(`${label}-spill`,
    () => mkdtempSync(path.join(os.tmpdir(), "wk2670-status-")),
    (created) => rmSync(created, { recursive: true, force: true }));
  return createDispatchToolRegistry({ backend, responseEnv: { ...process.env,
    WIKI_MCP_RESPONSE_STATE_DIR: dir, WIKI_MCP_TOOL_PROFILE: role } });
}

const verifyCallsOf = (structured) =>
  (structured.next_calls ?? []).filter(({ tool }) => tool === "workspace_verify_proof");

const sameRetention = (value) => JSON.parse(JSON.stringify(value)
  .replace(/"ref_id":"resp-[^"]+"/gu, '"ref_id":"<retained>"'));
const withoutVerifyCalls = (structured) => {
  const { next_calls: calls = [], ...rest } = structured;
  const kept = calls.filter(({ tool }) => tool !== "workspace_verify_proof");
  return sameRetention(kept.length === 0 ? rest : { ...rest, next_calls: kept });
};

test("WK-2670: an orchestrator gets one candidate-bound verify call, identical in compact and complete status", async (t) => {
  const scope = createTestResourceScope();
  try {
    const shape = candidateBoundObservation();

    const effects = { orchestrator: { lifecycle: 0, detail: 0 }, operator: { lifecycle: 0, detail: 0 } };
    const backend = (role) => observationBackend({ status: shape.status, lifecycle: shape.lifecycle,
      recordedCount: shape.recordedCount, lastRecordedInvocation: shape.invocation,
      onLifecycle: () => { effects[role].lifecycle += 1; },
      onDetail: () => { effects[role].detail += 1; } });
    const orchestrator = await roleRegistry(scope, "orchestrator", backend("orchestrator"), "orchestrator");
    const operator = await roleRegistry(scope, "operator", backend("operator"), "operator");
    const compact = await observe(orchestrator, { subject: SUBJECT });
    const complete = await observe(orchestrator, COMPLETE);
    const expected = { tool: "workspace_verify_proof",
      arguments: { repo: REPOSITORY, subject: WK_ID, git_sha: CANDIDATE } };
    for (const [label, observed] of [["compact", compact], ["complete", complete]]) {
      assert.deepEqual(verifyCallsOf(observed.structured), [expected], label);

      assert.equal(JSON.stringify(observed.structured).split("\"workspace_verify_proof\"").length, 2,
        `${label}: one occurrence`);
    }

    const { arguments: args } = verifyCallsOf(compact.structured)[0];
    for (const other of [BASE, TIP, WK2670_DELIVERY]) assert.notEqual(args.git_sha, other);
    assert.equal(compact.structured.slice_lifecycle.integration.delivery_sha, WK2670_DELIVERY);
    assert.equal(compact.structured.slice_lifecycle.terminal_candidate.wk_tip, TIP);
    assert.equal(compact.structured.slice_lifecycle.terminal_candidate.candidate, CANDIDATE);

    const operatorCompact = await observe(operator, { subject: SUBJECT });
    const operatorComplete = await observe(operator, COMPLETE);
    assert.deepEqual(verifyCallsOf(operatorCompact.structured), []);
    assert.deepEqual(verifyCallsOf(operatorComplete.structured), []);
    assert.deepEqual(withoutVerifyCalls(compact.structured), sameRetention(operatorCompact.structured));
    assert.deepEqual(withoutVerifyCalls(complete.structured), sameRetention(operatorComplete.structured));

    assert.deepEqual(effects.orchestrator, effects.operator);
    const again = await observe(orchestrator, { subject: SUBJECT });
    assert.deepEqual(again.structured, compact.structured);
    assert.equal(orchestrator.has("workspace_verify_proof"), false, "status registers no verifier");

    const structuredBytes = (observed) => Buffer.byteLength(JSON.stringify(observed.structured));
    const compactDelta = structuredBytes(compact) - structuredBytes(operatorCompact);
    const completeDelta = structuredBytes(complete) - structuredBytes(operatorComplete);
    assert.ok(compactDelta <= 320, `compact grew ${compactDelta} bytes`);
    assert.ok(completeDelta <= 320, `complete grew ${completeDelta} bytes`);
    assert.deepEqual(responseRepetitions(compact.structured), []);
    t.diagnostic(`WK-2670 structured increment: compact +${compactDelta}, complete +${completeDelta}; ` +
      `transport: compact ${operatorCompact.bytes} -> ${compact.bytes}, complete ` +
      `${operatorComplete.bytes} -> ${complete.bytes}`);
    defaultFrame(compact, "candidate-bound orchestrator compact default");
  } finally {
    await scope.dispose();
  }
});

test("WK-2670: a non-orchestrator session or an incomplete candidate is offered no verify call", async () => {
  const scope = createTestResourceScope();
  try {
    const observeWith = async (label, shape, role = "orchestrator") => {
      const tools = await roleRegistry(scope, label, observationBackend({ status: shape.status,
        lifecycle: shape.lifecycle }), role);
      return [await observe(tools, { subject: SUBJECT }), await observe(tools, COMPLETE)];
    };
    const assertNone = (label, observations) => {
      for (const observed of observations) {
        assert.deepEqual(verifyCallsOf(observed.structured), [], label);
        assert.equal(JSON.stringify(observed.structured).includes("workspace_verify_proof"), false, label);
      }
    };

    const [control] = await observeWith("control", candidateBoundObservation());
    assert.equal(verifyCallsOf(control.structured).length, 1);
    for (const role of ["operator", "worker", "reviewer", "redteam", ""]) {
      assertNone(`role ${role || "unbound"}`,
        await observeWith(`role-${role || "unbound"}`, candidateBoundObservation(), role));
    }
    const variants = {
      "materialization unverified": (shape) => { shape.lifecycle.terminal_candidate.materialization =
        { ...shape.candidate.materialization, verified: false }; },
      "materialization absent": (shape) => { delete shape.lifecycle.terminal_candidate.materialization; },
      "materialized another commit": (shape) => { shape.lifecycle.terminal_candidate.materialization =
        { ...shape.candidate.materialization, candidate: TIP }; },
      "candidate for another WK": (shape) => { shape.lifecycle.terminal_candidate = {
        ...shape.lifecycle.terminal_candidate,
        binding: { ...shape.candidate.binding, canonical_wk_id: "WK-9999" },
        materialization: { ...shape.candidate.materialization, canonical_wk_id: "WK-9999" } }; },
      "candidate absent": (shape) => { delete shape.lifecycle.terminal_candidate; },
      "binding without a commit": (shape) => { shape.lifecycle.terminal_candidate = {
        ...shape.lifecycle.terminal_candidate,
        binding: { ...shape.candidate.binding, candidate: "HEAD" } }; },
      "integration not finalized": (shape) => { shape.lifecycle.phase = "integrated"; },
      "not integrated": (shape) => { shape.lifecycle.integrated = false; }
    };
    for (const [label, mutate] of Object.entries(variants)) {
      const shape = candidateBoundObservation();
      mutate(shape);
      assertNone(label, await observeWith(label.replaceAll(" ", "-"), shape));
    }
  } finally {
    await scope.dispose();
  }
});
