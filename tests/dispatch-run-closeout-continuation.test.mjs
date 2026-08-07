import assert from "node:assert/strict";
import test from "node:test";

import {
  createDispatchToolRegistry,
  createResumableLifecycleHarness,
  parseStructuredTextResponse
} from "../packages/wiki-mcp/src/lib/dispatch-tools-test-helpers.mjs";
import {
  CLOSEOUT_WORKFLOW_CONTINUATION_SCHEMA_VERSION
} from "../packages/wiki-mcp/src/lib/dispatch-run-monitor-routes.mjs";

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

function canonicalFindingCounts(findings) {
  const counts = { ...ZERO_FINDING_COUNTS, total: findings.length };
  for (const finding of findings) {
    counts[finding.severity] += 1;
    if (finding.blocking === true) counts.blocking += 1;
  }
  return counts;
}

function reviewFinding(severity, id = `F-${severity.toUpperCase()}`) {
  return {
    id,
    title: `${severity} disposition required`,
    severity,
    blocking: false,
    affected_paths: []
  };
}

function projectedReview(runId, outcome, findings = []) {
  return {
    run_id: runId,
    monitor_handle: `wkmh_${runId}`,
    role: "reviewer",
    terminal_disposition: "succeeded",
    structured_result_digest: "b".repeat(64),
    outcome,
    findings,
    finding_counts: outcome === "changes_requested"
      ? canonicalFindingCounts(findings)
      : null
  };
}

function sliceEvidence(harness, {
  clean = true,
  findings = null,
  activeRunIds = [],
  invalidRunIds = [],
  observationComplete = activeRunIds.length === 0
} = {}) {
  const reviews = [];
  if (clean) reviews.push(projectedReview("review-clean", "clean"));
  if (findings !== null) {
    reviews.push(projectedReview("review-findings", "changes_requested", findings));
  }
  for (const runId of invalidRunIds) {
    reviews.push(projectedReview(runId, null));
  }
  return {
    schema_version: "workspace-agent-slice-review-advisory-evidence.v1",
    unit_address: SUBJECT,
    initiative: "IN-0021",
    slice_ref: harness.sliceRef,
    reviewed_sha: harness.reviewedSha,
    diff_base_sha: "a".repeat(40),
    active_review_run_ids: activeRunIds,
    clean_review_run_ids: clean ? ["review-clean"] : [],
    findings_review_run_ids: findings === null ? [] : ["review-findings"],
    invalid_review_run_ids: invalidRunIds,
    reviews,
    observation_complete: observationComplete,
    authority: "advisory_only"
  };
}

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

test("a valid findings classification requires coordinator disposition", async () => {
  const fixture = parkedFixture((harness) => sliceEvidence(harness, {
    clean: false,
    findings: [reviewFinding("medium", "F-001")]
  }));
  const status = await parkedStatusWait(fixture);

  assert.equal(status.closeout_continuation.stage, "slice_review_disposition_required");
  assert.equal(status.closeout_continuation.decision_required, true);
  assert.equal(status.closeout_continuation.decision_reason, "canonical_review_changes_requested");
  assert.equal(status.closeout_continuation.current_safe_call, undefined);
  assert.equal(status.closeout_continuation.ordered_steps[1].state, "required");
  assert.equal(status.closeout_continuation.ordered_steps[2].state, "pending");
});

test("a valid clean classification makes the separate integration operation the current safe call", async () => {
  const fixture = parkedFixture((harness) => sliceEvidence(harness));
  const response = await parkedStatusWait(fixture);

  assert.equal(response.closeout_continuation.decision_required, false);
  assert.equal(response.closeout_continuation.stage, "slice_integration_ready");
  assert.deepEqual(response.closeout_continuation.current_safe_call, {
    tool: "workspace_integrate_committed_slice",
    arguments: { subject: SUBJECT },
    source: "trusted_slice_review_evidence"
  });
  assert.equal(response.closeout_continuation.ordered_steps[2].state, "current");
  assert.equal(response.closeout_continuation.ordered_steps[3].state, "pending");
});

test("findings classification wins when valid clean and findings receipts coexist", async () => {
  const fixture = parkedFixture((harness) => sliceEvidence(harness, {
    findings: [reviewFinding("low")]
  }));
  const status = await parkedStatusWait(fixture);

  assert.equal(status.closeout_continuation.stage, "slice_review_disposition_required");
  assert.equal(status.closeout_continuation.decision_required, true);
  assert.equal(status.closeout_continuation.current_safe_call, undefined);
});

test("high and critical nonblocking changes_requested results always require coordinator disposition", async () => {
  for (const severity of ["high", "critical"]) {
    const fixture = parkedFixture((harness) => sliceEvidence(harness, {
      clean: false,
      findings: [reviewFinding(severity)]
    }));
    const status = await parkedStatusWait(fixture);

    assert.equal(status.closeout_continuation.decision_required, true, severity);
    assert.equal(status.closeout_continuation.decision_reason,
      "canonical_review_changes_requested", severity);
    assert.equal(status.closeout_continuation.current_safe_call, undefined, severity);
    assert.equal(status.closeout_continuation.ordered_steps[1].state, "required", severity);
    assert.equal(status.closeout_continuation.ordered_steps[2].state, "pending", severity);
  }
});

test("no clean or findings classification keeps slice review required", async () => {
  const fixture = parkedFixture((harness) => sliceEvidence(harness, { clean: false }));
  const status = await parkedStatusWait(fixture);

  assert.equal(status.closeout_continuation.stage, "slice_review_required");
  assert.equal(status.closeout_continuation.decision_required, false);
  assert.notEqual(status.closeout_continuation.current_safe_call?.tool,
    "workspace_integrate_committed_slice");
});

test("active reviews alone keep slice review required", async () => {
  const fixture = parkedFixture((harness) => sliceEvidence(harness, {
    clean: false,
    activeRunIds: ["review-active"]
  }));
  const status = await parkedStatusWait(fixture);

  assert.equal(status.closeout_continuation.stage, "slice_review_required");
  assert.notEqual(status.closeout_continuation.current_safe_call?.tool,
    "workspace_integrate_committed_slice");
});

test("invalid reviews alone keep slice review required", async () => {
  const fixture = parkedFixture((harness) => sliceEvidence(harness, {
    clean: false,
    invalidRunIds: ["review-invalid"]
  }));
  const status = await parkedStatusWait(fixture);

  assert.equal(status.closeout_continuation.stage, "slice_review_required");
  assert.notEqual(status.closeout_continuation.current_safe_call?.tool,
    "workspace_integrate_committed_slice");
});

test("a valid clean classification remains integration-ready with an active review", async () => {
  const fixture = parkedFixture((harness) => sliceEvidence(harness, {
    activeRunIds: ["review-active"]
  }));
  const status = await parkedStatusWait(fixture);

  assert.equal(status.closeout_continuation.stage, "slice_integration_ready");
  assert.equal(status.closeout_continuation.current_safe_call.tool,
    "workspace_integrate_committed_slice");
});

test("a valid clean classification remains integration-ready with an invalid historical attempt", async () => {
  const fixture = parkedFixture((harness) => sliceEvidence(harness, {
    invalidRunIds: ["review-invalid"]
  }));
  const status = await parkedStatusWait(fixture);

  assert.equal(status.closeout_continuation.stage, "slice_integration_ready");
  assert.equal(status.closeout_continuation.current_safe_call.tool,
    "workspace_integrate_committed_slice");
});

test("observation completeness does not veto a valid clean classification", async () => {
  const fixture = parkedFixture((harness) => sliceEvidence(harness, {
    observationComplete: false
  }));
  const status = await parkedStatusWait(fixture);

  assert.equal(status.closeout_continuation.stage, "slice_integration_ready");
  assert.equal(status.closeout_continuation.current_safe_call.tool,
    "workspace_integrate_committed_slice");
});

test("a valid findings classification wins over active and invalid attempts", async () => {
  const fixture = parkedFixture((harness) => sliceEvidence(harness, {
    clean: false,
    findings: [reviewFinding("low")],
    activeRunIds: ["review-active"],
    invalidRunIds: ["review-invalid"]
  }));
  const status = await parkedStatusWait(fixture);

  assert.equal(status.closeout_continuation.stage, "slice_review_disposition_required");
  assert.equal(status.closeout_continuation.decision_required, true);
  assert.equal(status.closeout_continuation.current_safe_call, undefined);
});

test("missing, wrong-identity, or unavailable evidence fails closed", async () => {
  const fixtures = [
    parkedFixture(),
    parkedFixture((harness) => ({
      ...sliceEvidence(harness),
      reviewed_sha: "c".repeat(40)
    })),
    parkedFixture(() => { throw new Error("observation unavailable"); })
  ];

  for (const fixture of fixtures) {
    const status = await parkedStatusWait(fixture);
    assert.equal(status.closeout_continuation.stage, "slice_review_required");
    assert.notEqual(status.closeout_continuation.current_safe_call?.tool,
      "workspace_integrate_committed_slice");
  }
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

test("terminal-review blocking or medium findings require disposition and omit forge handoff as the safe call", async () => {
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
  assert.equal(status.closeout_continuation.current_safe_call, undefined);
  assert.equal(status.closeout_continuation.ordered_steps[1].state, "required");
  assert.equal(status.closeout_continuation.ordered_steps[2].state, "pending");
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
