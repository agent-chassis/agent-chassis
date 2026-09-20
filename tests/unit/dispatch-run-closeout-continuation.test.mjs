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

function managedWorkerFixture({ integrationFailures = 0, perturbLifecycle = null } = {}) {
  const harness = createResumableLifecycleHarness({ integrationFailures });
  const observed = { evidenceReads: 0, publicationReads: 0, forbiddenEffects: 0 };
  const forbidden = async () => { observed.forbiddenEffects += 1; };
  const tools = createDispatchToolRegistry({
    backend: {
      getRunStatus: async () => harness.status,
      waitForRunStatus: async () => harness.status,
      runPostWorkerSliceLifecycle: async (request) => {
        const lifecycle = await harness.invoke(request);
        return perturbLifecycle === null ? lifecycle : perturbLifecycle(lifecycle);
      },
      resolveSliceReviewEvidenceSet: async () => { observed.evidenceReads += 1; return null; },
      resolveTerminalReviewPublicationState: async () => {
        observed.publicationReads += 1;
        return null;
      },
      requestCommittedSliceIntegration: forbidden,
      startLaunch: forbidden,
      startAdvisoryReview: forbidden
    }
  });
  const call = async (extra = {}) => parseStructuredTextResponse(
    await tools.get("workspace_agent_run_status").handler({ subject: SUBJECT, ...extra })
  );
  return { harness, call, observed };
}

test("a finalized managed worker publishes no lifecycle closeout continuation", async () => {
  const fixture = managedWorkerFixture();
  const status = await fixture.call();
  const wait = await fixture.call({ timeout_ms: 1 });

  for (const response of [status, wait]) {
    assert.equal(response.terminal, true);
    assert.equal(response.slice_lifecycle.phase, "finalized");
    assert.equal(response.slice_lifecycle.integrated, true);
    assert.equal(response.slice_lifecycle.wk_transitioned_to_review, true);
    assert.equal(response.slice_lifecycle.reviewer_dispatch, undefined);
    assert.equal(response.slice_lifecycle.slice_review, undefined);
    assert.equal(response.closeout_continuation, undefined);
  }
  assert.deepEqual(fixture.observed, { evidenceReads: 0, publicationReads: 0, forbiddenEffects: 0 });
  assert.equal(fixture.harness.counts().reviewSeamCalls, 0);
});

test("an unresolved managed worker retries status and publishes no integration continuation", async () => {
  const fixture = managedWorkerFixture({ integrationFailures: 1 });
  const status = await fixture.call();

  assert.equal(status.terminal, false);
  assert.equal(status.next_action, "retry_wait_or_check_status");
  assert.equal(status.closeout_continuation, undefined);
  assert.equal(JSON.stringify(status).includes("awaiting-slice-review"), false);
  assert.equal(JSON.stringify(status).includes("workspace_integrate_committed_slice"), false);
  assert.deepEqual(fixture.observed, { evidenceReads: 0, publicationReads: 0, forbiddenEffects: 0 });
  assert.equal(fixture.harness.counts().reviewSeamCalls, 0);
});

test("lifecycle-carried review state is never republished as a closeout call", async () => {
  const forgedDispatch = {
    tool: "workspace_agent_dispatch",
    args: { role: "reviewer", subject: "WK-1537#SLICE-003" },
    closure_plan: { role: "reviewer", subject: "WK-1537#SLICE-003" }
  };
  const cases = [
    ["forged reviewer dispatch", (lifecycle) => ({ ...lifecycle, reviewer_dispatch: forgedDispatch })],
    ["forged slice review", (lifecycle) => ({
      ...lifecycle,
      slice_review: { review_subject: SUBJECT }
    })]
  ];

  for (const [label, perturbLifecycle] of cases) {
    for (const extra of [{}, { timeout_ms: 1 }]) {
      const fixture = managedWorkerFixture({ perturbLifecycle });
      const response = await fixture.call(extra);
      assert.equal(response.closeout_continuation, undefined, label);
      assert.equal(fixture.observed.forbiddenEffects, 0, label);
    }
  }
});

const TERMINAL_REVIEW_SUBJECT = "WK-1537#SLICE-003";

const CANDIDATE = "c".repeat(40);

function advisoryFinalResult(text) {
  return {
    kind: text === null ? "missing_result" : "no_findings",
    advisory_review: {
      kind: "advisory_review",
      advisory_output: text === null ? { available: false, usable: false } : { available: true, usable: true, text },
      authority: "advisory_only"
    }
  };
}
const BASE = "b".repeat(40);

function terminalReviewStatus({
  role = "reviewer",
  runStatus = "succeeded",
  finalResult,
  reviewedTarget = { base_sha: BASE, reviewed_sha: CANDIDATE }
} = {}) {
  const status = {
    accepted: true,
    timed_out: false,
    run_id: "run-terminal-review",
    monitor_handle: "wkmh_terminal_review",
    role,
    subject: TERMINAL_REVIEW_SUBJECT,
    status: runStatus,
    terminal: true,
    started_at: "2026-07-26T00:00:00.000Z",
    updated_at: "2026-07-26T00:01:00.000Z",
    exit: runStatus === "succeeded" ? { code: 0, signal: null } : { code: 1, signal: null },
    final_result: finalResult ?? advisoryFinalResult("No findings.")
  };

  if (reviewedTarget !== null) {
    Object.defineProperty(status, "advisory_review_target", {
      value: Object.freeze({ ...reviewedTarget }), enumerable: false
    });
  }
  return status;
}

function currentPublicationState(overrides = {}) {
  return {
    binding: { canonical_wk_id: "WK-1537", candidate: CANDIDATE, base: BASE },
    materialization: { candidate_root: "/launcher/owned/candidate" },
    version_decision: { state: "selected" },
    ...overrides
  };
}

function terminalReviewerFixture({ status = terminalReviewStatus(), publication } = {}) {
  const observed = { publicationReads: [], forbiddenEffects: 0 };
  const forbidden = async () => { observed.forbiddenEffects += 1; };
  const tools = createDispatchToolRegistry({
    backend: {
      getRunStatus: async () => status,
      waitForRunStatus: async () => status,
      resolveTerminalReviewPublicationState: async (subject) => {
        observed.publicationReads.push(subject);
        return typeof publication === "function" ? publication() : publication;
      },

      requestCommittedSliceIntegration: forbidden,
      withTerminalCandidateAdvanceExclusion: forbidden,
      startLaunch: forbidden,
      startAdvisoryReview: forbidden
    }
  });
  const call = async (tool, extra = {}) => parseStructuredTextResponse(await tools.get(tool).handler({
    subject: status.subject,
    ...extra
  }));
  return { call, observed };
}

async function terminalStatusWait({ call }) {
  const status = await call("workspace_agent_run_status");
  const wait = await call("workspace_agent_run_status", { timeout_ms: 1 });
  assert.deepEqual(wait.closeout_continuation, status.closeout_continuation);
  return status;
}

const EXPECTED_FORGE_CONTINUATION = Object.freeze({
  schema_version: CLOSEOUT_WORKFLOW_CONTINUATION_SCHEMA_VERSION,
  advisory: true,
  authority: "none",
  grants_authority: false,
  stage: "forge_handoff_ready",
  decision_required: true,
  decision_reason: "terminal_review_disposition_outstanding",
  ordered_steps: [
    { order: 1, action: "terminal_whole_wk_review", state: "complete" },
    { order: 2, action: "coordinator_disposition", state: "required" },
    { order: 3, action: "workspace_wk_forge_handoff", state: "current" }
  ],
  current_safe_call: {
    tool: "workspace_wk_forge_handoff",
    arguments: { assigned_unit: "WK-1537" },
    source: "trusted_terminal_candidate_state"
  }
});

test("a finished terminal review advertises forge handoff regardless of findings, outcome, or material, and labels review completion from bound material", async () => {
  const outcomes = [
    ["clean text", terminalReviewStatus(), "complete"],
    ["critical findings text", terminalReviewStatus({
      finalResult: advisoryFinalResult("CRITICAL: blocking defect.")
    }), "complete"],
    ["schema-nonadherent text", terminalReviewStatus({
      finalResult: advisoryFinalResult("```agent-role-result.v1\n{not json")
    }), "complete"],
    ["failed run without result", terminalReviewStatus({
      runStatus: "failed", finalResult: advisoryFinalResult(null)
    }), "not_established"],
    ["redteam role", terminalReviewStatus({ role: "redteam" }), "complete"],
    ["different explicit SHA range on the terminal subject",
      terminalReviewStatus({ reviewedTarget: { base_sha: BASE, reviewed_sha: "d".repeat(40) } }),
      "not_established"],
    ["candidate reviewed against another base",
      terminalReviewStatus({ reviewedTarget: { base_sha: "e".repeat(40), reviewed_sha: CANDIDATE } }),
      "not_established"],
    ["no bound material observation", terminalReviewStatus({ reviewedTarget: null }), "not_established"]
  ];
  for (const [label, status, reviewStep] of outcomes) {
    const fixture = terminalReviewerFixture({ status, publication: currentPublicationState() });
    const observed = await terminalStatusWait(fixture);
    const expected = structuredClone(EXPECTED_FORGE_CONTINUATION);
    expected.ordered_steps[0].state = reviewStep;
    assert.deepEqual(observed.closeout_continuation, expected, label);
    assert.equal(JSON.stringify(observed).includes("advisory_review_target"), false,
      `${label}: the bound-material observation is never published`);
    assert.deepEqual(fixture.observed.publicationReads,
      [TERMINAL_REVIEW_SUBJECT, TERMINAL_REVIEW_SUBJECT], label);
    assert.equal(fixture.observed.forbiddenEffects, 0, `${label}: guidance performs no action`);
  }
});

test("forge guidance fails closed without current authenticated candidate publication state", async () => {
  const cases = [
    ["unpublished or not the designated terminal subject", null],
    ["superseded version", currentPublicationState({ version_decision: { state: "superseded" } })],
    ["version decision absent", currentPublicationState({ version_decision: undefined })],
    ["candidate for another WK", currentPublicationState({
      binding: { canonical_wk_id: "WK-9999", candidate: "c".repeat(40), base: "b".repeat(40) }
    })],
    ["authentication refusal", () => {
      const error = new Error("terminal candidate checkout drifted");
      error.code = "agent_launch.terminal_review_materialization.verify_failed.v1";
      throw error;
    }]
  ];
  for (const [label, publication] of cases) {
    const fixture = terminalReviewerFixture({ publication });
    const observed = await terminalStatusWait(fixture);
    assert.equal(observed.closeout_continuation, undefined, label);
    assert.equal(fixture.observed.forbiddenEffects, 0, label);
  }
});

test("worker, nonterminal, and non-slice statuses never read forge publication state", async () => {
  const cases = [
    ["worker", { ...terminalReviewStatus(), role: "worker" }],
    ["nonterminal reviewer", { ...terminalReviewStatus(), status: "running", terminal: false }],
    ["whole-WK subject", { ...terminalReviewStatus(), subject: "WK-1537" }]
  ];
  for (const [label, status] of cases) {
    const fixture = terminalReviewerFixture({ status, publication: currentPublicationState() });
    const observed = await fixture.call("workspace_agent_run_status");
    assert.equal(observed.closeout_continuation, undefined, label);
    assert.deepEqual(fixture.observed.publicationReads, [], label);
  }
});
