import assert from "node:assert/strict";
import test from "node:test";

import {
  createDispatchToolRegistry,
  createResumableLifecycleHarness,
  parseStructuredTextResponse
} from "../../packages/wiki-mcp/src/lib/dispatch-tools-test-helpers.mjs";
import {
  CLOSEOUT_WORKFLOW_CONTINUATION_SCHEMA_VERSION
} from "../../packages/wiki-mcp/src/lib/dispatch-run-monitor-routes.mjs";

const SUBJECT = "WK-1537#SLICE-001";
const HANDLE = "wkmh_worker_resumable";

const ZERO_FINDING_COUNTS = Object.freeze({
  total: 0,
  blocking: 0,
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
  info: 0
});

function parkedFixture(evidence = null) {
  const harness = createResumableLifecycleHarness({ sliceReviewAccepted: false });
  const tools = createDispatchToolRegistry({
    backend: {
      getRunStatus: async () => harness.status,
      waitForRunStatus: async () => harness.status,
      runPostWorkerSliceLifecycle: harness.invoke,
      resolveSliceReviewEvidenceSet: async () =>
        typeof evidence === "function" ? evidence(harness) : evidence
    }
  });
  const call = async (tool) => parseStructuredTextResponse(
    await tools.get(tool).handler({ monitor_handle: HANDLE, subject: SUBJECT })
  );
  return { harness, call };
}

async function parkedStatusWait(fixture) {
  const status = await fixture.call("workspace_agent_run_status");
  const wait = await fixture.call("workspace_agent_run_wait");
  assert.deepEqual(wait.closeout_continuation, status.closeout_continuation);
  return status;
}

test("parked slice review gives status and wait the same ordered closeout continuation", async () => {
  const fixture = parkedFixture();
  const status = await fixture.call("workspace_agent_run_status");
  const wait = await fixture.call("workspace_agent_run_wait");

  assert.equal(status.next_action, "complete_slice_review_then_retry_run_status");
  assert.deepEqual(wait.closeout_continuation, status.closeout_continuation);
  const continuation = status.closeout_continuation;
  assert.equal(continuation.schema_version, CLOSEOUT_WORKFLOW_CONTINUATION_SCHEMA_VERSION);
  assert.equal(continuation.advisory, true);
  assert.equal(continuation.grants_authority, false);
  assert.equal(continuation.decision_required, false);
  assert.deepEqual(continuation.ordered_steps.map(({ action, state }) => [action, state]), [
    ["findings_only_slice_review", "current"],
    ["coordinator_disposition", "conditional"],
    ["workspace_integrate_committed_slice", "pending"],
    ["resume_original_worker_monitor", "pending"]
  ]);
  assert.deepEqual(continuation.current_safe_call, {
    tool: "workspace_agent_dispatch",
    arguments: { role: "reviewer", subject: SUBJECT },
    source: "trusted_lifecycle"
  });
});

test("awaiting exact review never reads historical findings and always returns static guidance", async () => {
  const historicalShapes = [
    null,
    { outcome: "clean", findings: [] },
    { outcome: "changes_requested", findings: [{ severity: "critical", blocking: true }] },
    { outcome: null, findings: "schema-invalid" },
    new Error("receipt store unavailable")
  ];
  let evidenceReads = 0;
  let expected = null;

  for (const shape of historicalShapes) {
    const fixture = parkedFixture(() => {
      evidenceReads += 1;
      if (shape instanceof Error) throw shape;
      return shape;
    });
    const status = await parkedStatusWait(fixture);
    expected ??= status.closeout_continuation;
    assert.deepEqual(status.closeout_continuation, expected);
    assert.equal(status.closeout_continuation.stage, "slice_review_required");
  }
  assert.equal(evidenceReads, 0,
    "status/wait must not consult findings, receipts, results, or provenance at this boundary");
});

test("a finalized terminal-slice worker promotes the trusted terminal-review dispatch", async () => {
  const harness = createResumableLifecycleHarness({ sliceReviewAccepted: true });
  const tools = createDispatchToolRegistry({
    backend: {
      getRunStatus: async () => harness.status,
      waitForRunStatus: async () => harness.status,
      runPostWorkerSliceLifecycle: harness.invoke
    }
  });
  const response = parseStructuredTextResponse(await tools.get("workspace_agent_run_status").handler({
    monitor_handle: HANDLE,
    subject: SUBJECT
  }));

  assert.equal(response.terminal, true);
  assert.equal(response.closeout_continuation.stage, "terminal_whole_wk_review_required");
  assert.deepEqual(response.closeout_continuation.current_safe_call, {
    tool: "workspace_agent_dispatch",
    arguments: { role: "reviewer", subject: "WK-1537#SLICE-003" },
    source: "trusted_lifecycle"
  });
  assert.equal(response.closeout_continuation.ordered_steps[2].state, "pending");
});

function finalizedWholeWkFixture({ canonicalWorkKind = null, perturbLifecycle = null } = {}) {
  const harness = createResumableLifecycleHarness({ sliceReviewAccepted: true });
  if (canonicalWorkKind !== null) {
    const resolveCanonicalReviewUnit = harness.deps.resolveCanonicalReviewUnit;
    harness.deps.resolveCanonicalReviewUnit = (args) => ({
      ...resolveCanonicalReviewUnit(args),
      review_unit_contract: JSON.stringify({ work_kind: canonicalWorkKind })
    });
  }
  const tools = createDispatchToolRegistry({
    backend: {
      getRunStatus: async () => harness.status,
      waitForRunStatus: async () => harness.status,
      runPostWorkerSliceLifecycle: async (request) => {
        const lifecycle = await harness.invoke(request);
        return perturbLifecycle === null ? lifecycle : perturbLifecycle(lifecycle);
      }
    }
  });
  return async (tool) => parseStructuredTextResponse(await tools.get(tool).handler({
    monitor_handle: HANDLE,
    subject: SUBJECT
  }));
}

function withDispatchedRole(lifecycle, role) {
  const { role: _planned, ...rest } = lifecycle.reviewer_dispatch.args;
  return {
    ...lifecycle,
    reviewer_dispatch: {
      ...lifecycle.reviewer_dispatch,
      args: role === undefined ? rest : { ...rest, role }
    }
  };
}

function withPlannedClosure(lifecycle, closurePlan) {
  return {
    ...lifecycle,
    reviewer_dispatch: {
      ...lifecycle.reviewer_dispatch,
      closure_plan: { ...lifecycle.reviewer_dispatch.closure_plan, ...closurePlan }
    }
  };
}

test("a canonical redteam whole-WK unit keeps its trusted redteam role through closeout continuation", async () => {
  const call = finalizedWholeWkFixture({ canonicalWorkKind: "redteam" });
  const status = await call("workspace_agent_run_status");
  const wait = await call("workspace_agent_run_wait");

  assert.deepEqual(wait.closeout_continuation, status.closeout_continuation);
  const continuation = status.closeout_continuation;
  assert.equal(continuation.stage, "terminal_whole_wk_review_required");
  assert.equal(continuation.advisory, true);
  assert.equal(continuation.grants_authority, false);
  assert.equal(continuation.decision_required, false);
  assert.deepEqual(continuation.ordered_steps.map(({ order, action, state }) => [order, action, state]), [
    [1, "terminal_whole_wk_review", "current"],
    [2, "coordinator_disposition", "conditional"],
    [3, "workspace_wk_forge_handoff", "pending"]
  ]);
  assert.deepEqual(continuation.current_safe_call, {
    tool: "workspace_agent_dispatch",
    arguments: { role: "redteam", subject: "WK-1537#SLICE-003" },
    source: "trusted_lifecycle"
  });
});

test("an ordinary canonical findings whole-WK unit still keeps its trusted reviewer role", async () => {
  for (const canonicalWorkKind of [null, "review"]) {
    const call = finalizedWholeWkFixture({ canonicalWorkKind });
    const status = await call("workspace_agent_run_status");
    const wait = await call("workspace_agent_run_wait");

    assert.deepEqual(wait.closeout_continuation, status.closeout_continuation);
    assert.equal(status.closeout_continuation.stage, "terminal_whole_wk_review_required",
      String(canonicalWorkKind));
    assert.deepEqual(status.closeout_continuation.current_safe_call, {
      tool: "workspace_agent_dispatch",
      arguments: { role: "reviewer", subject: "WK-1537#SLICE-003" },
      source: "trusted_lifecycle"
    }, String(canonicalWorkKind));
  }
});

test("worker, unknown, absent, and plan-mismatched whole-WK roles expose no dispatch call", async () => {
  const cases = [
    ["worker", (lifecycle) => withDispatchedRole(lifecycle, "worker")],
    ["unknown", (lifecycle) => withDispatchedRole(lifecycle, "auditor")],
    ["absent", (lifecycle) => withDispatchedRole(lifecycle, undefined)],
    ["null", (lifecycle) => withDispatchedRole(lifecycle, null)],

    ["dispatch drifted from plan", (lifecycle) => withDispatchedRole(lifecycle, "redteam")],
    ["plan drifted from dispatch", (lifecycle) => withPlannedClosure(lifecycle, { role: "redteam" })],
    ["plan drifted from subject", (lifecycle) =>
      withPlannedClosure(lifecycle, { subject: "WK-1537#SLICE-009" })],
    ["absent plan", (lifecycle) => {
      const { closure_plan: _plan, ...reviewerDispatch } = lifecycle.reviewer_dispatch;
      return { ...lifecycle, reviewer_dispatch: reviewerDispatch };
    }]
  ];

  for (const [label, perturbLifecycle] of cases) {
    for (const tool of ["workspace_agent_run_status", "workspace_agent_run_wait"]) {
      const call = finalizedWholeWkFixture({ perturbLifecycle });
      const response = await call(tool);
      assert.equal(response.closeout_continuation?.current_safe_call, undefined,
        `${label} via ${tool}`);
    }
  }
});

function canonicalCleanReviewResult(outcome) {
  return {
    review_outcome: outcome,
    clean_review: true,
    no_findings: outcome === "no_findings",
    blocking_finding_count: 0,
    medium_finding_count: 0,
    reviewed_controls: []
  };
}

function terminalReviewerFixture({
  reportedOutcome = "no_findings",
  findingCounts = ZERO_FINDING_COUNTS,
  reviewedControls = [],
  runStatus = "succeeded",
  cleanupOnly = false,
  retainedOutcome = "clean",
  retainedReviewResult = undefined
} = {}) {
  const canonicalReviewResult = retainedReviewResult === undefined
    ? retainedOutcome === "clean" ? canonicalCleanReviewResult(reportedOutcome) : null
    : retainedReviewResult;
  const status = {
    accepted: true,
    timed_out: false,
    run_id: "run-terminal-review",
    monitor_handle: "wkmh_terminal_review",
    role: "reviewer",
    subject: "WK-1537#SLICE-003",
    status: runStatus,
    terminal: true,
    started_at: "2026-07-26T00:00:00.000Z",
    updated_at: "2026-07-26T00:01:00.000Z",
    exit: runStatus === "succeeded" || cleanupOnly
      ? { code: 0, signal: null }
      : { code: 1, signal: null },
    ...(cleanupOnly
      ? {
          launcher_conduit_terminal_failure: {
            reason: "stdio_mcp_cleanup_failed",
            cleanup_only: true
          }
        }
      : {}),
    final_result: {
      structured_role_result: {
        valid: true,
        claims: {
          reported_role: "reviewer",
          reported_subject: "WK-1537#SLICE-003",
          reported_outcome: reportedOutcome
        },
        finding_counts: findingCounts,
        reviewed_controls: reviewedControls
      }
    }
  };
  const tools = createDispatchToolRegistry({
    backend: {
      getRunStatus: async () => status,
      waitForRunStatus: async () => status,
      resolveTerminalCandidatePublicationState: async () => ({
        advisory_review_evidence: {
          reviews: [{
            run_id: status.run_id,
            monitor_handle: status.monitor_handle,
            terminal: true,
            status: runStatus,
            provenance_valid: true,
            outcome: retainedOutcome,
            review_result: canonicalReviewResult
          }]
        }
      })
    }
  });
  return async (tool) => parseStructuredTextResponse(await tools.get(tool).handler({
    monitor_handle: status.monitor_handle,
    subject: status.subject
  }));
}

async function terminalStatusWait(call) {
  const status = await call("workspace_agent_run_status");
  const wait = await call("workspace_agent_run_wait");
  assert.deepEqual(wait.closeout_continuation, status.closeout_continuation);
  return status;
}

test("every accepted canonical clean outcome recommends launcher-owned forge handoff with status/wait parity", async () => {
  for (const reportedOutcome of [
    "no_findings",
    "passed_no_blocking_or_medium_findings"
  ]) {
    const findingCounts = reportedOutcome === "no_findings"
      ? ZERO_FINDING_COUNTS
      : { ...ZERO_FINDING_COUNTS, total: 1, low: 1 };
    const status = await terminalStatusWait(terminalReviewerFixture({
      reportedOutcome,
      findingCounts
    }));
    assert.equal(status.closeout_continuation.decision_required, false, reportedOutcome);
    assert.deepEqual(status.closeout_continuation.current_safe_call, {
      tool: "workspace_wk_forge_handoff",
      arguments: { assigned_unit: "WK-1537" },
      source: "trusted_terminal_review_state"
    });
  }
});

test("terminal-review findings remain advisory and do not suppress forge handoff", async () => {
  const call = terminalReviewerFixture({
    reportedOutcome: "changes_requested",
    findingCounts: {
      ...ZERO_FINDING_COUNTS,
      total: 1,
      blocking: 1,
      high: 1
    },
    retainedOutcome: "changes_requested"
  });
  const status = await terminalStatusWait(call);

  assert.equal(status.closeout_continuation.decision_required, true);
  assert.equal(status.closeout_continuation.decision_reason,
    "canonical_review_changes_requested");
  assert.deepEqual(status.closeout_continuation.current_safe_call, {
    tool: "workspace_wk_forge_handoff",
    arguments: { assigned_unit: "WK-1537" },
    source: "trusted_terminal_review_state"
  });
  assert.equal(status.closeout_continuation.ordered_steps[1].state, "required");
  assert.equal(status.closeout_continuation.ordered_steps[2].state, "current");
});

test("a failed non-cleanup terminal reviewer cannot recommend forge handoff", async () => {
  const status = await terminalStatusWait(terminalReviewerFixture({
    runStatus: "failed",
    retainedOutcome: null,
    retainedReviewResult: null
  }));
  assert.equal(status.closeout_continuation, undefined);
});

test("an eligible cleanup-only terminal reviewer preserves the canonical clean recommendation", async () => {
  const status = await terminalStatusWait(terminalReviewerFixture({
    runStatus: "failed",
    cleanupOnly: true
  }));
  assert.equal(status.closeout_continuation.stage, "forge_handoff_ready");
  assert.equal(status.closeout_continuation.current_safe_call.tool,
    "workspace_wk_forge_handoff");
});

test("a failed reviewed control cannot recommend forge handoff", async () => {
  const status = await terminalStatusWait(terminalReviewerFixture({
    reviewedControls: [{ control_id: "write_scope_total_loc", result: "fail" }],
    retainedOutcome: null,
    retainedReviewResult: null
  }));
  assert.equal(status.closeout_continuation, undefined);
});

test("malformed, incomplete, null, or canonically ineligible terminal outcomes fail closed", async () => {
  const cases = [
    { retainedOutcome: null, retainedReviewResult: null },
    { retainedOutcome: "invalid", retainedReviewResult: null },
    { retainedOutcome: "clean", retainedReviewResult: null },
    { retainedOutcome: "clean", retainedReviewResult: {} },
    {
      retainedOutcome: "clean",
      retainedReviewResult: {
        review_outcome: "no_findings",
        clean_review: true
      }
    },
    {
      retainedOutcome: "clean",
      retainedReviewResult: {
        ...canonicalCleanReviewResult("no_findings"),
        reviewed_controls: ["write_scope_total_loc", "write_scope_total_loc"]
      }
    },
    { retainedOutcome: "changes_requested", retainedReviewResult: {} }
  ];
  for (const testCase of cases) {
    const status = await terminalStatusWait(terminalReviewerFixture(testCase));
    assert.equal(status.closeout_continuation, undefined, JSON.stringify(testCase));
  }
});

test("incomplete child finding counts cannot override a null retained canonical outcome", async () => {
  const status = await terminalStatusWait(terminalReviewerFixture({
    findingCounts: { blocking: 0, medium: 0 },
    retainedOutcome: null,
    retainedReviewResult: null
  }));
  assert.equal(status.closeout_continuation, undefined);
});
