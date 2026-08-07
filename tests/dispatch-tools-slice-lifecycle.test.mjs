

import test from "node:test";
import assert from "node:assert/strict";

import {
  createDispatchToolRegistry,
  createResumableLifecycleHarness,
  parseStructuredTextResponse
} from "../packages/wiki-mcp/src/lib/dispatch-tools-test-helpers.mjs";
import {
  LIFECYCLE_FAILURE_HISTORY_LIMIT,
  LIFECYCLE_RESOLUTION_NEXT_ACTIONS,
  RUN_LIFECYCLE_RESOLUTION_SCHEMA_VERSION
} from "../packages/wiki-mcp/src/lib/dispatch-run-monitor-routes.mjs";

const MONITOR_HANDLE = "wkmh_worker_resumable";
const SUBJECT = "WK-1537#SLICE-001";
const PREPARE_FAILED_CODE = "agent_launch.slice_review_materialization.prepare_failed.v1";

const GENERIC_LIFECYCLE_FAILURE_CODE = "agent_launch.slice_lifecycle.failed.v1";
const GENERIC_LIFECYCLE_FAILURE_MESSAGE = "post-worker slice lifecycle invocation failed";

function closedFailureEntry(phase) {
  return {
    phase,
    error_code: GENERIC_LIFECYCLE_FAILURE_CODE,
    error_message: GENERIC_LIFECYCLE_FAILURE_MESSAGE,
    error_message_truncated: false
  };
}

const INJECTED_FAILURE_MESSAGE_TEXT = "injected slice-review preparation failure";

function assertNoInjectedFailureText(label, response) {
  const serialized = JSON.stringify(response);
  assert.equal(
    serialized.includes(INJECTED_FAILURE_MESSAGE_TEXT), false,
    `${label}: the injected raw error message reached the serialized response`
  );
  assert.equal(
    serialized.includes(PREPARE_FAILED_CODE), false,
    `${label}: the injected raw error code reached the serialized response`
  );
}

function createFailingPreparationHarness({
  prepareFailures = 1,
  prepareDelayMs = 0,
  sliceReviewAccepted = false
} = {}) {
  const harness = createResumableLifecycleHarness({ sliceReviewAccepted });
  const realPrepare = harness.deps.hostSliceReviewPreparationAdapter;
  let prepareCalls = 0;
  harness.deps.hostSliceReviewPreparationAdapter = async (request) => {
    prepareCalls += 1;

    if (prepareDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, prepareDelayMs));
    if (prepareCalls <= prepareFailures) {
      const error = new Error(`injected slice-review preparation failure #${prepareCalls}`);
      error.code = PREPARE_FAILED_CODE;
      throw error;
    }
    return realPrepare(request);
  };
  let accepted = sliceReviewAccepted;
  harness.deps.resolveCommittedSliceIntegrationContinuation = () => (accepted
    ? {
        schema_version: "workspace-agent-committed-slice-integration-continuation.v1",
        requested: true,
        completed: true,
        reviewed_sha: harness.reviewedSha,
      }
    : null);

  const tools = createDispatchToolRegistry({
    backend: {
      getRunStatus: async () => harness.status,
      waitForRunStatus: async () => harness.status,
      runPostWorkerSliceLifecycle: harness.invoke
    }
  });

  const call = async (tool, extraArgs = {}) => parseStructuredTextResponse(
    await tools.get(tool).handler({
      monitor_handle: MONITOR_HANDLE,
      subject: SUBJECT,
      ...extraArgs
    })
  );
  return {
    harness,
    tools,
    status: () => call("workspace_agent_run_status"),
    wait: (extraArgs = {}) => call("workspace_agent_run_wait", extraArgs),
    acceptSliceReview() { accepted = true; },
    prepareCalls: () => prepareCalls
  };
}

test("WK-1690: a child-succeeded run whose lifecycle failed is NOT terminal and retains its typed failure", async () => {
  const fixture = createFailingPreparationHarness({ prepareFailures: 1 });

  const first = await fixture.status();

  assert.equal(first.status, "succeeded", "the CHILD's own vocabulary is unchanged");
  assert.equal(first.child_terminal, true);
  assert.equal(first.terminal, false, "a failing lifecycle is not a finished managed run");
  assert.equal(first.next_action, "retry_wait_or_check_status");

  const resolution = first.lifecycle_resolution;
  assert.equal(resolution.schema_version, RUN_LIFECYCLE_RESOLUTION_SCHEMA_VERSION);
  assert.equal(resolution.resolved, false);
  assert.equal(resolution.phase, "pre-integration");
  assert.equal(resolution.integration_complete, false);
  assert.equal(resolution.failure_attempts, 1);
  assert.equal(resolution.failure_attempts_saturated, false);
  assert.equal(resolution.failure_history_truncated, false);

  assert.deepEqual(resolution.latest_failure, closedFailureEntry("pre-integration"));
  assert.equal(resolution.next_action, LIFECYCLE_RESOLUTION_NEXT_ACTIONS.RESOLVE_FAILURE);
  assertNoInjectedFailureText("first status poll", first);

  assert.deepEqual(fixture.harness.counts(), { integrationCalls: 0, bindCalls: 0 });
});

test("WK-1690: the next poll reaches awaiting-slice-review, still nonterminal, and the earlier failure does not silently disappear", async () => {
  const fixture = createFailingPreparationHarness({ prepareFailures: 1 });

  await fixture.status();
  const second = await fixture.status();

  assert.equal(second.child_terminal, true);
  assert.equal(second.terminal, false, "a parked slice review is not a finished managed run");

  assert.equal(second.next_action, LIFECYCLE_RESOLUTION_NEXT_ACTIONS.COMPLETE_SLICE_REVIEW);
  assert.equal(second.slice_lifecycle.phase, "awaiting-slice-review");
  assert.equal(second.slice_lifecycle.integrated, false);
  assert.equal(second.slice_lifecycle.integration, null);

  const resolution = second.lifecycle_resolution;
  assert.equal(resolution.resolved, false);
  assert.equal(resolution.phase, "awaiting-slice-review");
  assert.equal(resolution.integration_complete, false);

  assert.equal(resolution.failure_attempts, 1);

  assert.deepEqual(resolution.latest_failure, closedFailureEntry("pre-integration"));
  assert.equal(resolution.next_action, LIFECYCLE_RESOLUTION_NEXT_ACTIONS.COMPLETE_SLICE_REVIEW);
  assertNoInjectedFailureText("second status poll", second);

  assert.deepEqual(fixture.harness.counts(), { integrationCalls: 0, bindCalls: 0 });
});

test("WK-1690: status and wait agree on a child-succeeded/lifecycle-unresolved run", async () => {
  const fixture = createFailingPreparationHarness({ prepareFailures: 1 });

  await fixture.status();
  const viaStatus = await fixture.status();
  const viaWait = await fixture.wait();

  assert.equal(viaWait.timed_out, false);
  assert.equal(viaWait.child_terminal, true);
  assert.equal(viaWait.terminal, false);

  assert.equal(viaWait.next_action, LIFECYCLE_RESOLUTION_NEXT_ACTIONS.COMPLETE_SLICE_REVIEW);
  assert.equal(viaWait.next_action, viaStatus.next_action);
  assert.equal(viaWait.status, viaStatus.status);
  assert.equal(viaWait.updated_at, viaStatus.updated_at);
  assert.deepEqual(viaWait.lifecycle_resolution, viaStatus.lifecycle_resolution);
  assert.deepEqual(viaWait.slice_lifecycle, viaStatus.slice_lifecycle);
});

test("WK-1690: once finalized, both routes replay a byte-stable terminal projection", async () => {
  const fixture = createFailingPreparationHarness({ prepareFailures: 1 });

  await fixture.status();
  await fixture.status();
  fixture.acceptSliceReview();
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

  assert.equal(fixture.harness.counts().integrationCalls, 1);
});

test("WK-1690: driving more failures than the history bound keeps storage fixed-size and retains the LATEST failure", async () => {
  const overBound = LIFECYCLE_FAILURE_HISTORY_LIMIT + 3;
  const fixture = createFailingPreparationHarness({ prepareFailures: overBound });

  let last = null;
  for (let poll = 0; poll < overBound; poll += 1) {
    last = await fixture.status();
    assert.equal(last.terminal, false, `poll ${poll + 1} must stay nonterminal`);
    assert.equal(last.child_terminal, true);
  }

  const resolution = last.lifecycle_resolution;

  assert.equal(resolution.retained_failures.length, LIFECYCLE_FAILURE_HISTORY_LIMIT);
  assert.equal(resolution.failure_attempts, LIFECYCLE_FAILURE_HISTORY_LIMIT);
  assert.equal(resolution.failure_attempts_saturated, true);
  assert.equal(resolution.failure_history_limit, LIFECYCLE_FAILURE_HISTORY_LIMIT);
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
  assertNoInjectedFailureText("over-bound polling", last);

  assert.deepEqual(fixture.harness.counts(), { integrationCalls: 0, bindCalls: 0 });
  assert.equal(fixture.prepareCalls(), overBound);
});

test("WK-1690: polling MUTATES lifecycle state — these routes are not read-only", async () => {
  const fixture = createFailingPreparationHarness({ prepareFailures: 0 });

  assert.deepEqual(fixture.harness.statusWrites, [],
    "no canonical write has happened before the first poll");

  await fixture.status();

  assert.deepEqual(fixture.harness.statusWrites, [{ unitAddress: SUBJECT, status: "review" }]);
  assert.equal(fixture.harness.sliceStatus(), "review");
  assert.equal(fixture.harness.counts().integrationCalls, 0);

  fixture.acceptSliceReview();
  const finalized = await fixture.wait();

  assert.equal(fixture.harness.counts().integrationCalls, 1);
  assert.equal(finalized.terminal, true);
  assert.equal(finalized.slice_lifecycle.integrated, true);
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

  for (const tool of ["workspace_agent_run_status", "workspace_agent_run_wait"]) {
    const result = parseStructuredTextResponse(await tools.get(tool).handler({
      monitor_handle: "wkmh_reviewer",
      subject: "WK-1537#SLICE-003"
    }));
    assert.equal(result.terminal, true, `${tool}: no lifecycle applies, so the child is the run`);
    assert.equal(result.child_terminal, true);
    assert.equal("lifecycle_resolution" in result, false);
    assert.equal(result.next_action, undefined);
  }
});

test("WK-1690 (review M-1): one shared lifecycle invocation records exactly one failure across concurrent status and wait", async () => {

  const fixture = createFailingPreparationHarness({ prepareFailures: 1, prepareDelayMs: 60 });

  const [viaStatus, viaWait] = await Promise.all([
    fixture.status(),
    fixture.wait({ timeout_ms: 1, poll_interval_ms: 500 })
  ]);

  assert.equal(fixture.prepareCalls(), 1, "both pollers coalesced onto one invocation");

  const statusResolution = viaStatus.lifecycle_resolution;
  const waitResolution = viaWait.lifecycle_resolution;

  assert.equal(statusResolution.failure_attempts, 1, "attempts count invocations, not observers");
  assert.equal(statusResolution.retained_failures.length, 1, "no duplicate from coalescing");
  assert.equal(statusResolution.failure_attempts_saturated, false);
  assert.equal(statusResolution.failure_history_truncated, false,
    "one attempt cannot truncate the bounded ring");

  assert.deepEqual(statusResolution.latest_failure, closedFailureEntry("pre-integration"));
  assertNoInjectedFailureText("coalesced status", viaStatus);
  assertNoInjectedFailureText("coalesced wait", viaWait);

  assert.deepEqual(waitResolution, statusResolution,
    "concurrent callers must not see different attempt accounting");
  assert.equal(viaStatus.terminal, false);
  assert.equal(viaWait.terminal, false);
  assert.equal(viaStatus.child_terminal, true);
  assert.equal(viaWait.child_terminal, true);
});

test("WK-1690 (review M-1): concurrent duplicate observers cannot saturate or truncate the bounded ring", async () => {
  const fixture = createFailingPreparationHarness({ prepareFailures: 1, prepareDelayMs: 60 });

  const responses = await Promise.all([
    fixture.status(), fixture.status(), fixture.status(),
    fixture.wait({ timeout_ms: 1, poll_interval_ms: 500 }),
    fixture.wait({ timeout_ms: 1, poll_interval_ms: 500 }),
    fixture.wait({ timeout_ms: 1, poll_interval_ms: 500 })
  ]);

  assert.equal(fixture.prepareCalls(), 1, "still one real lifecycle attempt");
  for (const response of responses) {
    const resolution = response.lifecycle_resolution;
    assert.equal(resolution.failure_attempts, 1);
    assert.equal(resolution.retained_failures.length, 1);
    assert.equal(resolution.failure_attempts_saturated, false);
    assert.equal(resolution.failure_history_truncated, false);
    assert.deepEqual(resolution, responses[0].lifecycle_resolution);
  }
});

test("WK-1690 (review M-2): run_wait returns promptly with the EXACT external action for a parked slice review", async () => {
  const fixture = createFailingPreparationHarness({ prepareFailures: 0 });

  const startedAt = Date.now();

  const parked = await fixture.wait({ timeout_ms: 20000, poll_interval_ms: 500 });
  const elapsedMs = Date.now() - startedAt;

  assert.equal(parked.timed_out, false);
  assert.equal(parked.child_terminal, true);
  assert.equal(parked.terminal, false);
  assert.equal(parked.next_action, LIFECYCLE_RESOLUTION_NEXT_ACTIONS.COMPLETE_SLICE_REVIEW,
    "the blocked-on-caller action is surfaced verbatim, not flattened to a retry string");
  assert.equal(parked.lifecycle_resolution.next_action,
    LIFECYCLE_RESOLUTION_NEXT_ACTIONS.COMPLETE_SLICE_REVIEW);
  assert.equal(parked.lifecycle_resolution.phase, "awaiting-slice-review");
  assert.ok(elapsedMs < 5000, `must return promptly, took ${elapsedMs}ms`);
});

test("WK-1690 (review M-2): a progress-capable unresolved lifecycle is WAITED on within the configured bound", async () => {

  const fixture = createFailingPreparationHarness({ prepareFailures: 2 });

  const startedAt = Date.now();
  const settled = await fixture.wait({ timeout_ms: 20000, poll_interval_ms: 500 });
  const elapsedMs = Date.now() - startedAt;

  assert.equal(fixture.prepareCalls(), 3);

  assert.ok(elapsedMs >= 900, `expected two ~500ms poll intervals, took ${elapsedMs}ms`);
  assert.ok(elapsedMs < 20000, "and it did not burn the whole window either");

  assert.equal(settled.timed_out, false);
  assert.equal(settled.terminal, false);
  assert.equal(settled.next_action, LIFECYCLE_RESOLUTION_NEXT_ACTIONS.COMPLETE_SLICE_REVIEW);

  assert.equal(settled.lifecycle_resolution.failure_attempts, 2);
});

test("WK-1690 (review M-2): a lifecycle that never resolves times out honestly on the same handle", async () => {
  const fixture = createFailingPreparationHarness({ prepareFailures: 1000 });

  const startedAt = Date.now();
  const timedOut = await fixture.wait({ timeout_ms: 1500, poll_interval_ms: 500 });
  const elapsedMs = Date.now() - startedAt;

  assert.equal(timedOut.timed_out, true);
  assert.equal(timedOut.terminal, false);

  assert.equal(timedOut.child_terminal, true);
  assert.equal(timedOut.monitor_handle, MONITOR_HANDLE, "same monitor handle to retry with");
  assert.equal(timedOut.next_action, "retry_wait_or_check_status",
    "a progress-capable lifecycle is genuinely worth retrying");
  assert.equal(timedOut.lifecycle_resolution.next_action,
    LIFECYCLE_RESOLUTION_NEXT_ACTIONS.RESOLVE_FAILURE);

  assert.ok(elapsedMs >= 1400, `must consume its window, took ${elapsedMs}ms`);
  assert.ok(elapsedMs < 6000, `must respect its deadline, took ${elapsedMs}ms`);
  assert.ok(fixture.prepareCalls() <= 6,
    `bounded retries, not a spin: ${fixture.prepareCalls()} attempts in ${elapsedMs}ms`);
});

test("WK-1690 (review M-2): a finalized lifecycle still returns terminal normally and promptly", async () => {
  const fixture = createFailingPreparationHarness({ prepareFailures: 0, sliceReviewAccepted: true });

  const startedAt = Date.now();
  const finalized = await fixture.wait({ timeout_ms: 20000, poll_interval_ms: 500 });
  const elapsedMs = Date.now() - startedAt;

  assert.equal(finalized.timed_out, false);
  assert.equal(finalized.terminal, true, "the complete managed run is finalized");
  assert.equal(finalized.child_terminal, true);
  assert.equal(finalized.next_action, undefined, "nothing left to do");
  assert.deepEqual(finalized.lifecycle_resolution, {
    schema_version: RUN_LIFECYCLE_RESOLUTION_SCHEMA_VERSION,
    resolved: true,
    phase: "finalized"
  });
  assert.equal(finalized.slice_lifecycle.integrated, true);
  assert.ok(elapsedMs < 5000, `a resolvable run must not wait, took ${elapsedMs}ms`);
});

test("WK-1690 (review M-1): a later DISTINCT failing invocation still increments to attempt 2", async () => {

  const fixture = createFailingPreparationHarness({ prepareFailures: 2, prepareDelayMs: 40 });

  const [firstStatus, firstWait] = await Promise.all([
    fixture.status(),
    fixture.wait({ timeout_ms: 1, poll_interval_ms: 500 })
  ]);
  assert.equal(fixture.prepareCalls(), 1, "round 1 is a single shared invocation");
  assert.equal(firstStatus.lifecycle_resolution.failure_attempts, 1);
  assert.deepEqual(firstWait.lifecycle_resolution, firstStatus.lifecycle_resolution);

  const secondStatus = await fixture.status();
  assert.equal(fixture.prepareCalls(), 2, "round 2 is a genuinely separate invocation");

  const resolution = secondStatus.lifecycle_resolution;
  assert.equal(resolution.failure_attempts, 2, "distinct retries increment separately");
  assert.equal(resolution.retained_failures.length, 2, "and append separately");

  const closedEntry = closedFailureEntry("pre-integration");
  assert.deepEqual(resolution.retained_failures[0], closedEntry);
  assert.deepEqual(resolution.latest_failure, closedEntry);
  assertNoInjectedFailureText("distinct second invocation", secondStatus);
  assert.equal(secondStatus.terminal, false);
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
  const call = async (tool) => parseStructuredTextResponse(await tools.get(tool).handler({
    monitor_handle: "wkmh_still_running",
    subject: SUBJECT
  }));

  const viaWait = await call("workspace_agent_run_wait");
  const viaStatus = await call("workspace_agent_run_status");

  assert.equal(viaWait.child_terminal, false, "derived from the backend result, not hardcoded");
  assert.equal(viaWait.terminal, false, "and a non-terminal child is never a terminal managed run");
  assert.equal(viaWait.timed_out, false, "honest: the window did not expire");
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
    integration: Object.freeze({ integrated: true, recovered: true }),
    reviewer_dispatch: null
  });
  let lifecycleDriven = 0;
  const tools = createDispatchToolRegistry({
    backend: {
      getRunStatus: async () => ({ accepted: false, refusal: { code: "monitor_handle_unknown" } }),
      waitForRunStatus: async () => ({ accepted: false, refusal: { code: "monitor_handle_unknown" } }),
      recoverIntegratedWorkerRun: async () => ({ status: recoveredStatus, lifecycle: recoveredLifecycle }),
      runPostWorkerSliceLifecycle: async () => {
        lifecycleDriven += 1;
        throw new Error("a recovered projection must not be re-driven by the monitor routes");
      }
    }
  });
  const call = async (tool) => parseStructuredTextResponse(await tools.get(tool).handler({
    monitor_handle: "wkmh_recovered",
    subject: SUBJECT
  }));

  const viaStatus = await call("workspace_agent_run_status");
  const viaWait = await call("workspace_agent_run_wait");

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
    assert.deepEqual(result.slice_lifecycle, recoveredLifecycle);
  }
  assert.equal(viaWait.timed_out, false);
  assert.equal(viaStatus.terminal, viaWait.terminal);
});
