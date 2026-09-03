import assert from "node:assert/strict";
import test from "node:test";

import {
  createLifecycleCheckpoint,
  POST_WORKER_LIFECYCLE_CHECKPOINT,
  POST_WORKER_LIFECYCLE_PHASES,
  projectLifecycleResolution,
  recordLifecycleFailure
} from "../../packages/wiki-mcp/src/lib/dispatch-post-worker-lifecycle-bindings.mjs";
import {
  runPostWorkerSliceLifecycleBody
} from "../../packages/wiki-mcp/src/lib/dispatch-post-worker-lifecycle-run.mjs";
import {
  buildCloseoutWorkflowContinuation
} from "../../packages/wiki-mcp/src/lib/dispatch-closeout-continuation.mjs";
import {
  projectLauncherAgentSessionContractForMonitoring
} from "../../packages/wiki-mcp/src/lib/dispatch-run-monitor-routes.mjs";
import {
  mintTrustedStdioMcpConduitAuthority,
  resolveLauncherAgentSessionContract
} from "../../packages/agent-launch-cli/src/lib/stdio-mcp-conduit-authority.mjs";
test("session-contract monitor projection preserves the launcher digest", () => {
  const authority = mintTrustedStdioMcpConduitAuthority({
    family: "claude",
    role: "worker",
    assignedUnit: "WK-2446#SLICE-007",
    workspaceDir: "/tmp/wk-2446-monitor-parity",
    canonicalWriteScope: ["packages/wiki-mcp"]
  });
  const contract = resolveLauncherAgentSessionContract(authority);
  const statusProjection = projectLauncherAgentSessionContractForMonitoring(contract);
  const waitProjection = projectLauncherAgentSessionContractForMonitoring(contract);
  assert.deepEqual(waitProjection, statusProjection);
  assert.equal(statusProjection.contract_digest, contract.contract_digest);
});

const SLICE_REVIEW = Object.freeze({
  review_subject: "WK-2310#SLICE-001",
  slice_ref: "refs/heads/slice/IN-0022/WK-2310/SLICE-001",
  reviewed_sha: "a".repeat(40),
  diff_base_sha: "b".repeat(40)
});

function sliceLifecycle() {
  return Object.freeze({
    phase: POST_WORKER_LIFECYCLE_PHASES.AWAITING_SLICE_REVIEW,
    slice_review: SLICE_REVIEW,
    reviewer_dispatch: Object.freeze({
      tool: "workspace_agent_dispatch",
      args: Object.freeze({ role: "reviewer", subject: SLICE_REVIEW.review_subject })
    })
  });
}

function evidence({ findings }) {
  return Object.freeze({
    schema_version: "workspace-agent-slice-review-advisory-evidence.v1",
    authority: "advisory_only",
    unit_address: SLICE_REVIEW.review_subject,
    slice_ref: SLICE_REVIEW.slice_ref,
    reviewed_sha: SLICE_REVIEW.reviewed_sha,
    diff_base_sha: SLICE_REVIEW.diff_base_sha,
    clean_review_run_ids: findings ? [] : ["clean-run"],
    findings_review_run_ids: findings ? ["findings-run"] : []
  });
}

test("hot checkpoint and cold recovered lifecycle project identical terminal resolution", () => {
  const lifecycle = Object.freeze({
    phase: POST_WORKER_LIFECYCLE_PHASES.FINALIZED,
    integrated: true,
    delivery_state: "delivery_finalized",
    cleanup_pending: false
  });
  const hot = createLifecycleCheckpoint();
  hot.phase = POST_WORKER_LIFECYCLE_PHASES.FINALIZED;
  hot.finalized = lifecycle;

  assert.deepEqual(
    projectLifecycleResolution({ lifecycle, checkpoint: hot }),
    projectLifecycleResolution({ lifecycle, checkpoint: null })
  );
});

test("hot status and wait observers share one bounded failure projection", () => {
  const checkpoint = createLifecycleCheckpoint();
  const failure = Object.freeze({
    phase: POST_WORKER_LIFECYCLE_PHASES.PRE_INTEGRATION,
    error_code: "targeted_dependency_failure.v1",
    error_message: "targeted dependency failed",
    error_message_truncated: false
  });
  recordLifecycleFailure(checkpoint, failure);
  const lifecycle = Object.freeze({ phase: checkpoint.phase });

  const statusProjection = projectLifecycleResolution({ lifecycle, checkpoint });
  const waitProjection = projectLifecycleResolution({ lifecycle, checkpoint });
  assert.deepEqual(waitProjection, statusProjection);
  assert.equal(statusProjection.failure_attempts, 1);
  assert.equal(statusProjection.latest_failure.error_code, "targeted_dependency_failure.v1");
});

test("post-integration cleanup failure stays an immutable finalized delivery", async () => {
  const checkpoint = createLifecycleCheckpoint();
  checkpoint.phase = POST_WORKER_LIFECYCLE_PHASES.INTEGRATED;
  checkpoint.integration = Object.freeze({
    integrated: true,
    review_target: null,
    slice_ref: "refs/heads/slice/IN-0022/WK-2310/SLICE-001",
    slice_sha: "a".repeat(40),
    wk_ref: "refs/heads/wk/IN-0022/WK-2310",
    wk_sha: "a".repeat(40),
    cleanup: Object.freeze({
      state: "failed",
      reaped: false,
      code: "targeted_cleanup_failure.v1"
    })
  });
  const status = {
    role: "worker",
    terminal: true,
    status: "succeeded",
    subject: "WK-2310#SLICE-001",
    run_id: "worker-run",
    monitor_handle: "worker-handle"
  };
  Object.defineProperty(status, POST_WORKER_LIFECYCLE_CHECKPOINT, { value: checkpoint });
  const result = await runPostWorkerSliceLifecycleBody({
    workspace: { dir: "/tmp/wk-2310-parity" },
    status,
    deps: {
      resolveManagedRunBinding: () => ({
        slice_binding: {
          unit_address: "IN-0022/WK-2310/SLICE-001",
          output_branch: "slice/IN-0022/WK-2310/SLICE-001"
        },
        wk_binding: {
          output_branch: "wk/IN-0022/WK-2310",
          worktree_path: "/tmp/wk-2310-parity"
        },
        validation_worktree_path: "/tmp/wk-2310-parity"
      }),
      resolveCanonicalReviewUnit: () => {
        throw new Error("non-final delivery must not resolve terminal review");
      },
      bindFrozenReviewContext: () => {
        throw new Error("non-final delivery must not bind terminal review");
      }
    }
  });

  assert.equal(result.phase, "finalized");
  assert.equal(result.integrated, true);
  assert.equal(result.delivery_state, "delivery_finalized");
  assert.equal(result.cleanup_pending, true);
  assert.equal(result.cleanup.state, "pending");
  assert.equal(result.integration.cleanup.code, "targeted_cleanup_failure.v1");
});

test("slice findings and clean output have the same integration continuation authority", async () => {
  const status = Object.freeze({ subject: SLICE_REVIEW.review_subject });
  const lifecycle = sliceLifecycle();
  const clean = await buildCloseoutWorkflowContinuation({
    status,
    lifecycle,
    dispatchBackend: { resolveSliceReviewEvidenceSet: async () => evidence({ findings: false }) }
  });
  const findings = await buildCloseoutWorkflowContinuation({
    status,
    lifecycle,
    dispatchBackend: { resolveSliceReviewEvidenceSet: async () => evidence({ findings: true }) }
  });

  for (const continuation of [clean, findings]) {
    assert.equal(continuation.stage, "slice_review_required");
    assert.equal(continuation.current_safe_call.tool, "workspace_agent_dispatch");
    assert.equal(continuation.current_safe_call.arguments.subject, SLICE_REVIEW.review_subject);
    assert.equal(continuation.grants_authority, false);
  }
  assert.equal(clean.decision_required, false);
  assert.equal(findings.decision_required, false);
});

test("terminal findings and clean output have the same forge continuation authority", async () => {
  const baseStatus = Object.freeze({
    role: "reviewer",
    subject: SLICE_REVIEW.review_subject,
    terminal: true,
    run_id: "review-run",
    monitor_handle: "review-handle"
  });
  const state = (review) => Object.freeze({
    advisory_review_evidence: Object.freeze({ reviews: Object.freeze([review]) })
  });
  const retained = (outcome, reviewResult) => Object.freeze({
    run_id: baseStatus.run_id,
    monitor_handle: baseStatus.monitor_handle,
    terminal: true,
    provenance_valid: true,
    outcome,
    review_result: reviewResult
  });
  const cleanResult = Object.freeze({
    blocking_finding_count: 0,
    clean_review: true,
    medium_finding_count: 0,
    no_findings: true,
    review_outcome: "no_findings",
    reviewed_controls: Object.freeze([])
  });
  const clean = await buildCloseoutWorkflowContinuation({
    status: baseStatus,
    dispatchBackend: {
      resolveTerminalCandidatePublicationState: async () =>
        state(retained("clean", cleanResult))
    }
  });
  const findings = await buildCloseoutWorkflowContinuation({
    status: baseStatus,
    dispatchBackend: {
      resolveTerminalCandidatePublicationState: async () =>
        state(retained("changes_requested", null))
    }
  });

  for (const continuation of [clean, findings]) {
    assert.equal(continuation.stage, "forge_handoff_ready");
    assert.equal(continuation.current_safe_call.tool, "workspace_wk_forge_handoff");
    assert.equal(continuation.current_safe_call.arguments.assigned_unit, "WK-2310");
    assert.equal(continuation.grants_authority, false);
  }
  assert.equal(clean.decision_required, false);
  assert.equal(findings.decision_required, true);
});

test("an unavailable advisory observer never manufactures continuation authority", async () => {
  const continuation = await buildCloseoutWorkflowContinuation({
    status: { subject: SLICE_REVIEW.review_subject },
    lifecycle: sliceLifecycle(),
    dispatchBackend: {
      resolveSliceReviewEvidenceSet: async () => {
        throw new Error("targeted observer failure");
      }
    }
  });
  assert.equal(continuation.stage, "slice_review_required");
  assert.equal(continuation.current_safe_call.tool, "workspace_agent_dispatch");
  assert.equal(continuation.current_safe_call.arguments.role, "reviewer");
});
