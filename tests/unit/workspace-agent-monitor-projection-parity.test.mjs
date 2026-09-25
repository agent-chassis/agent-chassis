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

const SLICE_SUBJECT = "WK-2310#SLICE-001";

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
      prepareTerminalCandidate: () => {
        throw new Error("non-final delivery must not prepare a terminal candidate");
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

test("a managed worker slice status never yields closeout guidance from findings or lifecycle state", async () => {
  let reads = 0;
  const dispatchBackend = {
    resolveSliceReviewEvidenceSet: async () => { reads += 1; return { findings: ["x"] }; },
    resolveTerminalReviewPublicationState: async () => {
      reads += 1;
      return { binding: { canonical_wk_id: "WK-2310" }, version_decision: { state: "selected" } };
    }
  };
  const status = Object.freeze({
    role: "worker",
    subject: SLICE_SUBJECT,
    terminal: true,
    status: "succeeded"
  });
  const lifecycle = Object.freeze({
    phase: POST_WORKER_LIFECYCLE_PHASES.FINALIZED,
    integrated: true,
    wk_transitioned_to_review: true,
    reviewer_dispatch: Object.freeze({
      tool: "workspace_agent_dispatch",
      args: Object.freeze({ role: "reviewer", subject: SLICE_SUBJECT })
    })
  });
  assert.equal(await buildCloseoutWorkflowContinuation({ status, lifecycle, dispatchBackend }), null);
  assert.equal(reads, 0);
  assert.equal(Object.values(POST_WORKER_LIFECYCLE_PHASES).includes("awaiting-slice-review"), false);
});

test("terminal findings and clean output have the same forge continuation authority", async () => {
  const state = Object.freeze({
    binding: Object.freeze({ canonical_wk_id: "WK-2310" }),
    version_decision: Object.freeze({ state: "selected" })
  });
  const status = (text) => Object.freeze({
    role: "reviewer",
    subject: SLICE_SUBJECT,
    terminal: true,
    run_id: "review-run",
    monitor_handle: "review-handle",
    final_result: Object.freeze({ kind: "advisory_review", full_response: Object.freeze({ text }) })
  });
  const dispatchBackend = { resolveTerminalReviewPublicationState: async () => state };
  const clean = await buildCloseoutWorkflowContinuation({
    status: status("No findings."), dispatchBackend
  });
  const findings = await buildCloseoutWorkflowContinuation({
    status: status("HIGH: blocking finding."), dispatchBackend
  });

  assert.deepEqual(findings, clean);
  assert.equal(clean.stage, "forge_handoff_ready");
  assert.equal(clean.current_safe_call.tool, "workspace_wk_forge_handoff");
  assert.equal(clean.current_safe_call.arguments.assigned_unit, "WK-2310");
  assert.equal(clean.grants_authority, false);
  assert.equal(clean.decision_required, true);
});

test("an unavailable publication observer never manufactures continuation authority", async () => {
  const continuation = await buildCloseoutWorkflowContinuation({
    status: { role: "reviewer", subject: SLICE_SUBJECT, terminal: true },
    dispatchBackend: {
      resolveTerminalReviewPublicationState: async () => {
        throw new Error("targeted observer failure");
      }
    }
  });
  assert.equal(continuation, null);
});
