

import test from "node:test";
import assert from "node:assert/strict";

import {
  createDispatchToolRegistry,
  createResumableLifecycleHarness,
  readStructuredResult
} from "../../packages/wiki-mcp/src/lib/dispatch-tools-test-helpers.mjs";
import {
  createLifecycleCheckpoint,
  recordLifecycleFailure
} from "../../packages/wiki-mcp/src/lib/dispatch-post-worker-lifecycle-bindings.mjs";
import {
  LIFECYCLE_FAILURE_HISTORY_LIMIT,
  LIFECYCLE_RESOLUTION_NEXT_ACTIONS,
  projectLifecycleResolution,
  MONITOR_CALL_DEFAULT_TIMEOUT_MS,
  RUN_LIFECYCLE_RESOLUTION_SCHEMA_VERSION,
  RUN_STATUS_CALL_BUDGET_MS,
  RUN_WAIT_TIMEOUT_MS_BOUNDS
} from "../../packages/wiki-mcp/src/lib/dispatch-run-monitor-routes.mjs";

const MONITOR_HANDLE = "wkmh_worker_resumable";
const SUBJECT = "WK-1537#SLICE-001";
const INJECTED_REFUSAL_CODE = "injected_integration_refusal";

const INTEGRATION_LIFECYCLE_FAILURE_CODE =
  "agent_launch.slice_lifecycle.committed_slice_integration_failed.v1";
const INTEGRATION_LIFECYCLE_FAILURE_MESSAGE = "post-worker committed slice integration failed";
const UNREGISTERED_INTEGRATION_REFUSAL = Object.freeze({
  kind: "integration_refusal", reason: null,
  diagnostic_code: null, diagnostic_kind: null, public_blocker_code: null
});
const DELEGATION_ERROR_MESSAGE =
  "workspace-agent post-worker lifecycle: host-delegated slice-to-WK integration failed";
const INJECTED_FAILURE_SUMMARY = Object.freeze({
  operation: "seam:committed_slice_integration",
  type: "Error",
  name: "SliceIntegrationError",
  code: "agent_launch.slice_integration.git_failed.v1",
  message: DELEGATION_ERROR_MESSAGE,
  capture_failure_count: 0
});

function closedFailureEntry(phase) {
  return {
    phase,
    error_code: INTEGRATION_LIFECYCLE_FAILURE_CODE,
    error_message: INTEGRATION_LIFECYCLE_FAILURE_MESSAGE,
    error_message_truncated: false,
    failure_cause: UNREGISTERED_INTEGRATION_REFUSAL,
    evidence_summary: INJECTED_FAILURE_SUMMARY
  };
}

function assertInjectedFailureEvidence(label, response) {
  const { evidence, evidence_summary: _summary, ...classification } = response.slice_lifecycle;
  const thrown = evidence.thrown.value;
  assert.equal(thrown.message, DELEGATION_ERROR_MESSAGE, label);
  assert.deepEqual(thrown.properties.detail.integration_refusal, { code: INJECTED_REFUSAL_CODE }, label);
  assert.match(thrown.stack, /delegateSliceIntegrationToHost/u, label);
  assert.equal(JSON.stringify(classification).includes(INJECTED_REFUSAL_CODE), false, label);
}

function assertNoReviewFields(label, response) {
  const lifecycle = response.slice_lifecycle ?? {};
  for (const field of ["slice_review", "reviewer_dispatch", "terminal_review_materialization"]) {
    assert.equal(Object.hasOwn(lifecycle, field), false, `${label}: ${field}`);
  }
  assert.notEqual(response.lifecycle_resolution?.phase, "awaiting-slice-review", label);
}

function createFailingIntegrationHarness({
  integrationFailures = 1,
  integrationDelayMs = 0
} = {}) {

  const integrationGate = integrationDelayMs > 0
    ? new Promise((resolve) => setTimeout(resolve, integrationDelayMs))
    : null;
  const harness = createResumableLifecycleHarness({ integrationFailures, integrationGate });

  const tools = createDispatchToolRegistry({
    backend: {
      getRunStatus: async () => harness.status,
      waitForRunStatus: async () => harness.status,
      runPostWorkerSliceLifecycle: harness.invoke
    }
  });

  const call = async (tool, extraArgs = {}) => readStructuredResult(
    await tools.get(tool).handler({
      subject: SUBJECT,
      include_final_result: true,
      ...extraArgs
    })
  );
  return {
    harness,
    tools,
    status: () => call("workspace_agent_run_status"),
    wait: (extraArgs = {}) => call("workspace_agent_run_status", {
      timeout_ms: MONITOR_CALL_DEFAULT_TIMEOUT_MS,
      ...extraArgs
    }),
    integrationCalls: () => harness.counts().integrationCalls
  };
}

test("WK-1690: a child-succeeded run whose lifecycle failed is NOT terminal and retains its typed failure", async () => {
  const fixture = createFailingIntegrationHarness({ integrationFailures: 1 });

  const first = await fixture.status();

  assert.equal(first.status, "succeeded", "the CHILD's own vocabulary is unchanged");
  assert.equal(first.child_terminal, true);
  assert.equal(first.terminal, false, "a failing lifecycle is not a finished managed run");

  assert.equal(first.next_action, "escalate_missing_retry_capability");

  const resolution = first.lifecycle_resolution;
  assert.equal(resolution.schema_version, RUN_LIFECYCLE_RESOLUTION_SCHEMA_VERSION);
  assert.equal(resolution.resolved, false);
  assert.equal(resolution.phase, "pre-integration");
  assert.equal(resolution.integration_complete, false);
  assert.equal(resolution.failure_attempts, 1);
  assert.equal(resolution.failure_history_truncated, false);

  assert.deepEqual(resolution.latest_failure, closedFailureEntry("pre-integration"));
  assert.equal(resolution.next_action,
    LIFECYCLE_RESOLUTION_NEXT_ACTIONS.ESCALATE_MISSING_RETRY_CAPABILITY);
  assert.deepEqual(first.slice_lifecycle, {
    invoked: true,
    phase: "pre-integration",
    integrated: false,
    error_code: INTEGRATION_LIFECYCLE_FAILURE_CODE,
    error_message: INTEGRATION_LIFECYCLE_FAILURE_MESSAGE,
    error_message_truncated: false,
    failure_cause: UNREGISTERED_INTEGRATION_REFUSAL,
    evidence_summary: INJECTED_FAILURE_SUMMARY,
    evidence: first.slice_lifecycle.evidence
  });
  assertInjectedFailureEvidence("first status poll", first);
  assertNoReviewFields("first status poll", first);

  assert.deepEqual(fixture.harness.counts(),
    { integrationCalls: 1, reviewSeamCalls: 0 });
});

test("WK-2655: the next poll withholds a refusal no owner can establish as corrected", async () => {

  const fixture = createFailingIntegrationHarness({ integrationFailures: 1 });

  const first = await fixture.status();
  const second = await fixture.status();

  assert.equal(second.child_terminal, true);
  assert.equal(second.terminal, false);
  assert.equal(second.next_action, "escalate_missing_retry_capability");
  assert.deepEqual(second.lifecycle_resolution.latest_failure, first.lifecycle_resolution.latest_failure);
  assert.equal(second.lifecycle_resolution.failure_attempts, 1, "no duplicate failure record");
  assert.deepEqual(
    [second.lifecycle_resolution.retry_assessment.decision,
      second.lifecycle_resolution.retry_assessment.attempt_withheld],
    ["correction_condition_unavailable", true]
  );
  assertInjectedFailureEvidence("withheld second poll", second);
  assertNoReviewFields("second status poll", second);
  assert.deepEqual(fixture.harness.counts(),
    { integrationCalls: 1, reviewSeamCalls: 0 });
});

test("WK-2655: the next-action vocabulary names every withheld retry outcome", () => {
  assert.deepEqual(Object.values(LIFECYCLE_RESOLUTION_NEXT_ACTIONS).sort(), [
    "delivery_requires_new_generation_work",
    "escalate_missing_retry_capability",
    "repair_retry_assessment_then_check_status",
    "resolve_lifecycle_failure_then_retry_run_status",
    "retry_run_status_after_exact_slice_commit",
    "retry_wait_or_check_status"
  ]);
});

test("WK-1690: status and wait agree on a child-succeeded/lifecycle-unresolved run", async () => {
  const fixture = createFailingIntegrationHarness({ integrationFailures: 1000 });

  const viaStatus = await fixture.status();
  const viaWait = await fixture.wait({ timeout_ms: 300 });

  assert.equal(viaWait.child_terminal, true);
  assert.equal(viaWait.terminal, false);
  assert.equal(viaStatus.terminal, false);

  assert.equal(viaWait.next_action, "escalate_missing_retry_capability");
  assert.equal(viaWait.next_action, viaStatus.next_action);
  assert.equal(viaWait.status, viaStatus.status);
  assert.equal(viaWait.updated_at, viaStatus.updated_at);
  assert.equal(viaWait.lifecycle_resolution.phase, viaStatus.lifecycle_resolution.phase);
  assert.equal(viaWait.lifecycle_resolution.next_action, viaStatus.lifecycle_resolution.next_action);
  assert.deepEqual(viaWait.lifecycle_resolution.latest_failure, viaStatus.lifecycle_resolution.latest_failure);
  assert.deepEqual(viaWait.slice_lifecycle, viaStatus.slice_lifecycle);

  assert.equal(fixture.integrationCalls(), 1);
  assert.equal(viaWait.lifecycle_resolution.failure_attempts, 1);
  assert.equal(viaStatus.lifecycle_resolution.failure_attempts, 1);
});

test("WK-1690: once finalized, both routes replay a byte-stable terminal projection", async () => {
  const fixture = createFailingIntegrationHarness({ integrationFailures: 0 });

  const finalizedStatus = await fixture.status();

  assert.equal(finalizedStatus.terminal, true, "the complete managed run is finalized");
  assert.equal(finalizedStatus.child_terminal, true);
  assert.equal(finalizedStatus.next_action, undefined,
    "a finalized run has no outstanding next step");
  assert.equal(finalizedStatus.slice_lifecycle.phase, "finalized");
  assert.deepEqual(finalizedStatus.lifecycle_resolution, {
    schema_version: RUN_LIFECYCLE_RESOLUTION_SCHEMA_VERSION,
    resolved: true,
    phase: "finalized"
  });

  assert.equal("latest_failure" in finalizedStatus.lifecycle_resolution, false);

  const replayWait = await fixture.wait();
  const replayStatus = await fixture.status();
  assert.equal(
    JSON.stringify(replayWait.lifecycle_resolution),
    JSON.stringify(finalizedStatus.lifecycle_resolution),
    "byte-stable across wait"
  );
  assert.equal(
    JSON.stringify(replayStatus.slice_lifecycle),
    JSON.stringify(finalizedStatus.slice_lifecycle),
    "byte-stable across status"
  );
  assert.equal(replayWait.terminal, true);
  assert.equal(replayStatus.terminal, true);

  assert.equal(fixture.integrationCalls(), 1);
});

test("WK-1690: recording more failures than the history bound keeps storage fixed-size and retains the LATEST failure", async () => {

  const fixture = createFailingIntegrationHarness({ integrationFailures: 1 });
  const published = (await fixture.status()).slice_lifecycle;
  const overBound = LIFECYCLE_FAILURE_HISTORY_LIMIT + 3;
  const checkpoint = createLifecycleCheckpoint();
  for (let attempt = 0; attempt < overBound; attempt += 1) {
    recordLifecycleFailure(checkpoint, published);
  }
  const resolution = projectLifecycleResolution({ lifecycle: published, checkpoint });

  assert.equal(resolution.retained_failures.length, LIFECYCLE_FAILURE_HISTORY_LIMIT);
  assert.equal(resolution.failure_attempts, overBound);
  assert.equal(resolution.failure_history_truncated, true);

  const closedEntry = closedFailureEntry("pre-integration");
  assert.deepEqual(resolution.latest_failure, closedEntry);
  assert.deepEqual(
    resolution.latest_failure,
    resolution.retained_failures[resolution.retained_failures.length - 1],
    "latest_failure is the ring's most recent slot"
  );
  for (const [index, entry] of resolution.retained_failures.entries()) {
    assert.deepEqual(entry, closedEntry, `retained entry ${index}`);
  }
  assert.equal(fixture.integrationCalls(), 1);
});

test("WK-1690: polling MUTATES lifecycle state — these routes are not read-only", async () => {
  const fixture = createFailingIntegrationHarness({ integrationFailures: 0 });

  assert.equal(fixture.integrationCalls(), 0, "nothing has been requested before the first poll");

  const finalized = await fixture.status();

  assert.equal(fixture.integrationCalls(), 1);
  assert.equal(finalized.terminal, true);
  assert.equal(finalized.slice_lifecycle.integrated, true);
  assert.equal(finalized.slice_lifecycle.wk_transitioned_to_review, true);

  const replay = await fixture.wait();
  assert.equal(replay.terminal, true);
  assert.equal(fixture.integrationCalls(), 1);
});

test("WK-1690: a run with no managed post-worker lifecycle keeps child terminality as its public terminality", async () => {
  const reviewerStatus = Object.freeze({
    accepted: true,
    timed_out: false,
    run_id: "run-reviewer",
    monitor_handle: "wkmh_reviewer",
    role: "reviewer",
    subject: "WK-1537#SLICE-003",
    status: "succeeded",
    terminal: true,
    started_at: "2026-07-12T00:00:00.000Z",
    updated_at: "2026-07-12T00:01:00.000Z"
  });
  const tools = createDispatchToolRegistry({
    backend: {
      getRunStatus: async () => reviewerStatus,
      waitForRunStatus: async () => reviewerStatus
    }
  });

  for (const [label, extra] of [["immediate", {}], ["bounded", { timeout_ms: 1000 }]]) {
    const result = readStructuredResult(await tools.get("workspace_agent_run_status").handler({
      subject: "WK-1537#SLICE-003",
      ...extra
    }));
    assert.equal(result.terminal, true, `${label}: no lifecycle applies, so the child is the run`);
    assert.equal(result.child_terminal, true);
    assert.equal("lifecycle_resolution" in result, false);
    assert.equal(result.next_action, undefined);
  }
});

test("WK-1690 (review M-1): one shared lifecycle invocation records exactly one failure across concurrent status and wait", async () => {

  const fixture = createFailingIntegrationHarness({ integrationFailures: 1, integrationDelayMs: 60 });

  const [viaStatus, viaWait] = await Promise.all([
    fixture.status(),
    fixture.wait({ timeout_ms: 300 })
  ]);

  assert.equal(fixture.integrationCalls(), 1, "both pollers coalesced onto one invocation");

  const statusResolution = viaStatus.lifecycle_resolution;
  const waitResolution = viaWait.lifecycle_resolution;

  assert.equal(statusResolution.failure_attempts, 1, "attempts count invocations, not observers");
  assert.equal(statusResolution.retained_failures.length, 1, "no duplicate from coalescing");
  assert.equal(statusResolution.failure_history_truncated, false,
    "one attempt cannot truncate the bounded ring");

  assert.deepEqual(statusResolution.latest_failure, closedFailureEntry("pre-integration"));
  assertInjectedFailureEvidence("coalesced status", viaStatus);
  assertInjectedFailureEvidence("coalesced wait", viaWait);

  assert.deepEqual(waitResolution, statusResolution,
    "concurrent callers must not see different attempt accounting");
  assert.equal(viaStatus.terminal, false);
  assert.equal(viaWait.terminal, false);
  assert.equal(viaStatus.child_terminal, true);
  assert.equal(viaWait.child_terminal, true);
});

test("WK-1690 (review M-1): concurrent duplicate observers cannot saturate or truncate the bounded ring", async () => {
  const fixture = createFailingIntegrationHarness({ integrationFailures: 1, integrationDelayMs: 60 });

  const responses = await Promise.all([
    fixture.status(), fixture.status(), fixture.status(),
    fixture.wait({ timeout_ms: 300 }),
    fixture.wait({ timeout_ms: 300 }),
    fixture.wait({ timeout_ms: 300 })
  ]);

  assert.equal(fixture.integrationCalls(), 1, "still one real lifecycle attempt");
  for (const response of responses) {
    const resolution = response.lifecycle_resolution;
    assert.equal(resolution.failure_attempts, 1);
    assert.equal(resolution.retained_failures.length, 1);
    assert.equal(resolution.failure_history_truncated, false);
    assert.deepEqual(resolution, responses[0].lifecycle_resolution);
  }
});

test("WK-2655: a bounded request makes ONE attempt and its failure ends that request's polling", async () => {

  const fixture = createFailingIntegrationHarness({ integrationFailures: 2 });

  const startedAt = Date.now();
  const bounded = await fixture.wait({ timeout_ms: 20000 });
  const elapsedMs = Date.now() - startedAt;

  assert.equal(fixture.integrationCalls(), 1, "one attempt for one explicit request");
  assert.ok(elapsedMs < 5000, `the failure ended the request promptly, took ${elapsedMs}ms`);
  assert.equal(bounded.settled, false, "the bounded request did not resolve the run");
  assert.equal(bounded.terminal, false);
  assert.equal(bounded.child_terminal, true);
  assert.equal(bounded.next_action, "escalate_missing_retry_capability");
  assert.equal(bounded.lifecycle_resolution.failure_attempts, 1);
  assert.deepEqual(
    [bounded.lifecycle_resolution.retry_assessment.failure_class,
      bounded.lifecycle_resolution.retry_assessment.automatic_retry],
    ["no_producer_correction_condition", "stopped_within_this_request"]
  );

  const second = await fixture.status();
  const third = await fixture.wait({ timeout_ms: 20000 });
  assert.equal(fixture.integrationCalls(), 1);
  for (const later of [second, third]) {
    assert.equal(later.terminal, false);
    assert.equal(later.lifecycle_resolution.failure_attempts, 1);
    assert.equal(later.lifecycle_resolution.retry_assessment.attempt_withheld, true);
  }
  assert.equal(third.settled, false);
});

test("WK-2655: a lifecycle that keeps failing reports honestly on the same handle without spinning", async () => {
  const fixture = createFailingIntegrationHarness({ integrationFailures: 1000 });

  const startedAt = Date.now();
  const timedOut = await fixture.wait({ timeout_ms: 1500 });
  const elapsedMs = Date.now() - startedAt;

  assert.equal(timedOut.settled, false);
  assert.equal(timedOut.terminal, false);

  assert.equal(timedOut.child_terminal, true);
  assert.equal(timedOut.monitor_handle, MONITOR_HANDLE, "same monitor handle to retry with");

  assert.equal(timedOut.next_action, "escalate_missing_retry_capability");
  assert.equal(timedOut.lifecycle_resolution.next_action, timedOut.next_action);

  assert.equal(fixture.integrationCalls(), 1,
    `bounded retries, not a spin: ${fixture.integrationCalls()} attempts in ${elapsedMs}ms`);
  assert.ok(elapsedMs < 1500, `it did not burn its window, took ${elapsedMs}ms`);
});

test("WK-1690 (review M-2): a finalized lifecycle still returns terminal normally and promptly", async () => {
  const fixture = createFailingIntegrationHarness({ integrationFailures: 0 });

  const startedAt = Date.now();
  const finalized = await fixture.wait({ timeout_ms: 20000 });
  const elapsedMs = Date.now() - startedAt;

  assert.equal(finalized.settled, true);
  assert.equal(finalized.terminal, true, "the complete managed run is finalized");
  assert.equal(finalized.child_terminal, true);
  assert.equal(finalized.next_action, undefined, "nothing left to do");
  assert.deepEqual(finalized.lifecycle_resolution, {
    schema_version: RUN_LIFECYCLE_RESOLUTION_SCHEMA_VERSION,
    resolved: true,
    phase: "finalized"
  });
  assert.equal(finalized.slice_lifecycle.integrated, true);
  assertNoReviewFields("finalized wait", finalized);
  assert.ok(elapsedMs < 5000, `a resolvable run must not wait, took ${elapsedMs}ms`);
});

test("WK-1690 (review M-1): distinct attempts are distinct records, and later polls add none", async () => {

  const fixture = createFailingIntegrationHarness({ integrationFailures: 2, integrationDelayMs: 40 });

  const [firstStatus, firstWait] = await Promise.all([
    fixture.status(),
    fixture.wait({ timeout_ms: 300 })
  ]);
  assert.equal(fixture.integrationCalls(), 1, "round 1 is a single shared invocation");
  assert.equal(firstStatus.lifecycle_resolution.failure_attempts, 1);
  assert.deepEqual(firstWait.lifecycle_resolution, firstStatus.lifecycle_resolution);

  const secondStatus = await fixture.status();
  assert.equal(fixture.integrationCalls(), 1, "a later poll starts no unestablished attempt");
  assert.equal(secondStatus.lifecycle_resolution.failure_attempts, 1);
  assert.equal(secondStatus.lifecycle_resolution.retained_failures.length, 1);
  assertInjectedFailureEvidence("later poll", secondStatus);

  const checkpoint = createLifecycleCheckpoint();
  recordLifecycleFailure(checkpoint, firstStatus.slice_lifecycle);
  recordLifecycleFailure(checkpoint, secondStatus.slice_lifecycle);
  const resolution = projectLifecycleResolution({ lifecycle: secondStatus.slice_lifecycle, checkpoint });
  assert.equal(resolution.failure_attempts, 2, "distinct attempts increment separately");
  assert.equal(resolution.retained_failures.length, 2, "and append separately");
  const closedEntry = closedFailureEntry("pre-integration");
  assert.deepEqual(resolution.retained_failures[0], closedEntry);
  assert.deepEqual(resolution.latest_failure, closedEntry);
});

test("WK-1690 (review L-3): run_wait derives child_terminal from the backend result, never hardcodes it", async () => {

  const runningStatus = Object.freeze({
    accepted: true,
    timed_out: false,
    run_id: "run-still-running",
    monitor_handle: "wkmh_still_running",
    role: "worker",
    subject: SUBJECT,
    status: "running",
    terminal: false,
    started_at: "2026-07-12T00:00:00.000Z",
    updated_at: "2026-07-12T00:01:00.000Z"
  });
  const tools = createDispatchToolRegistry({
    backend: {
      getRunStatus: async () => runningStatus,
      waitForRunStatus: async () => runningStatus,
      runPostWorkerSliceLifecycle: async () => {
        throw new Error("a non-terminal child must never drive the post-worker lifecycle");
      }
    }
  });
  const call = async (extra = {}) => readStructuredResult(await tools.get("workspace_agent_run_status").handler({
    subject: SUBJECT,
    ...extra
  }));

  const viaWait = await call({ timeout_ms: 1 });
  const viaStatus = await call();

  assert.equal(viaWait.child_terminal, false, "derived from the backend result, not hardcoded");
  assert.equal(viaWait.terminal, false, "and a non-terminal child is never a terminal managed run");
  assert.equal(viaWait.settled, true, "the backend observation settled");
  assert.equal(viaWait.next_action, "retry_wait_or_check_status");

  assert.equal(viaStatus.child_terminal, viaWait.child_terminal);
  assert.equal(viaStatus.terminal, viaWait.terminal);
  assert.equal("lifecycle_resolution" in viaWait, false, "no lifecycle was driven");
});

test("WK-1690: status and wait agree on terminality for a RECOVERED projection", async () => {

  const recoveredStatus = Object.freeze({
    accepted: true,
    recovered: true,
    timed_out: false,
    run_id: "run-recovered",
    monitor_handle: "wkmh_recovered",
    role: "worker",
    subject: SUBJECT,
    status: "succeeded",
    terminal: true,
    started_at: null,
    updated_at: null
  });
  const recoveredLifecycle = Object.freeze({
    invoked: true,
    phase: "finalized",
    integrated: true,
    wk_transitioned_to_review: true,
    integration: Object.freeze({ integrated: true, recovered: true })
  });
  let lifecycleDriven = 0;
  const tools = createDispatchToolRegistry({
    backend: {
      getRunStatus: async () => ({ accepted: false, refusal: { code: "monitor_handle_unknown" } }),
      waitForRunStatus: async () => ({ accepted: false, refusal: { code: "monitor_handle_unknown" } }),
      recoverManagedWorkerRun: async () => ({ status: recoveredStatus, lifecycle: recoveredLifecycle }),
      runPostWorkerSliceLifecycle: async () => {
        lifecycleDriven += 1;
        throw new Error("a recovered projection must not be re-driven by the monitor routes");
      }
    }
  });
  const call = async (extra = {}) => readStructuredResult(await tools.get("workspace_agent_run_status").handler({
    subject: SUBJECT,
    ...extra
  }));

  const viaStatus = await call();
  const viaWait = await call({ timeout_ms: 1000 });

  assert.equal(lifecycleDriven, 0, "recovery carries its own result; polling drives nothing");
  for (const [label, result] of [["status", viaStatus], ["wait", viaWait]]) {
    assert.equal(result.terminal, true, `${label}: a recovered finalized run is terminal`);
    assert.equal(result.child_terminal, true, `${label}: the recovered child is terminal`);
    assert.equal(result.next_action, undefined, `${label}: nothing left to do`);
    assert.deepEqual(result.lifecycle_resolution, {
      schema_version: RUN_LIFECYCLE_RESOLUTION_SCHEMA_VERSION,
      resolved: true,
      phase: "finalized"
    }, `${label}: the finalized projection is the shared constant`);

    const { view, complete, omitted_members: omitted, ...facts } = result.slice_lifecycle;
    assert.equal(view, "workspace-agent-run-status-compact-lifecycle.v1", label);
    assert.deepEqual(omitted, [], label);
    assert.deepEqual(complete.complete_mode, { include_final_result: true }, label);
    assert.deepEqual(facts, recoveredLifecycle, `${label}: the view carries every recovered fact`);
  }
  assert.deepEqual((await call({ include_final_result: true })).slice_lifecycle, recoveredLifecycle,
    "the complete result carries the recovered envelope unchanged");
  assert.equal(viaWait.settled, true);
  assert.equal(viaStatus.terminal, viaWait.terminal);
});

const NON_MANAGED_TERMINAL_RUN = Object.freeze({
  accepted: true,
  timed_out: false,
  run_id: "run-window-owner",
  monitor_handle: "wkmh_window_owner",
  role: "reviewer",
  subject: "WK-1537",
  status: "succeeded",
  terminal: true,
  started_at: "2026-08-20T00:00:00.000Z",
  updated_at: "2026-08-20T00:01:00.000Z"
});

function createWindowObservingRegistry() {
  const observed = [];
  const tools = createDispatchToolRegistry({
    backend: {
      getRunStatus: async () => ({ ...NON_MANAGED_TERMINAL_RUN }),
      waitForRunStatus: async ({ timeout_ms }) => {
        observed.push(timeout_ms);
        return { ...NON_MANAGED_TERMINAL_RUN };
      },
      runPostWorkerSliceLifecycle: async () => {
        throw new Error("a non-slice reviewer subject must drive no managed lifecycle");
      }
    }
  });
  return { observed, tools };
}

test("WK-2201: omitted timeout performs one immediate status observation", async () => {
  const { observed, tools } = createWindowObservingRegistry();

  const waited = readStructuredResult(await tools.get("workspace_agent_run_status").handler({
    subject: NON_MANAGED_TERMINAL_RUN.subject
  }));

  assert.equal(waited.accepted, true);
  assert.equal(waited.settled, true);
  assert.deepEqual(observed, [], "omitting timeout_ms does not enter bounded wait");

  assert.equal(RUN_STATUS_CALL_BUDGET_MS, MONITOR_CALL_DEFAULT_TIMEOUT_MS,
    "the two routes share one window rather than two values that happen to agree");
});

test("WK-2201: an explicit timeout_ms still reaches the backend verbatim and is never replaced by the default", async () => {
  const { observed, tools } = createWindowObservingRegistry();

  await tools.get("workspace_agent_run_status").handler({
    subject: NON_MANAGED_TERMINAL_RUN.subject,
    timeout_ms: 1234
  });

  assert.deepEqual(observed, [1234],
    "the owned default fills in an ABSENT window; it never overrides a supplied one");
  assert.notEqual(1234, MONITOR_CALL_DEFAULT_TIMEOUT_MS,
    "the probe value must differ from the default or it discriminates nothing");
});

test("WK-2201: the published timeout_ms range is the range the route enforces", async () => {
  const { observed, tools } = createWindowObservingRegistry();
  const { min, max } = RUN_WAIT_TIMEOUT_MS_BOUNDS;
  const wait = async (timeoutMs) =>
    readStructuredResult(await tools.get("workspace_agent_run_status").handler({
      subject: NON_MANAGED_TERMINAL_RUN.subject,
      timeout_ms: timeoutMs
    }));

  for (const accepted of [min, max]) {
    const result = await wait(accepted);
    assert.equal(result.accepted, true, `timeout_ms ${accepted} is within the published range`);
  }
  assert.deepEqual(observed, [min, max], "an in-range window reaches the backend verbatim");

  for (const refusedValue of [min - 1, max + 1]) {
    const refused = await wait(refusedValue);
    assert.equal(refused.accepted, false, `timeout_ms ${refusedValue} is out of range`);
    assert.equal(refused.blocker.reason, "timeout_ms_out_of_range");
    assert.equal(refused.blocker.detail.timeout_ms, refusedValue);
    assert.deepEqual(refused.blocker.detail.valid_range, [min, max],
      "the published range is read from the same owner the comparison uses");
    assert.equal(refused.blocker.detail.message,
      `timeout_ms must be an integer in [${min}, ${max}]`);
  }
  assert.deepEqual(observed, [min, max],
    "a refused window never reaches the backend, so nothing was clamped into range");
});
