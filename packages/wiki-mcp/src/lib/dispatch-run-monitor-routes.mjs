

import path from "node:path";

import {
  refuseCallerSuppliedIdentityFields
} from "@agent-chassis/wiki-core/src/lib/agent-dispatch-identity.mjs";
import {
  createLifecycleCheckpoint,
  POST_WORKER_LIFECYCLE_CHECKPOINT,
  POST_WORKER_LIFECYCLE_PHASES,
  WORKER_SLICE_SUBJECT_RE
} from "./dispatch-post-worker-lifecycle-bindings.mjs";
import { runPostWorkerSliceLifecycle } from "./dispatch-post-worker-lifecycle.mjs";
import {
  AGENT_RUN_STATUS_SCHEMA_VERSION,
  AGENT_RUN_WAIT_SCHEMA_VERSION,
  DISPATCH_BLOCKER_CODES
} from "./dispatch-tool-constants.mjs";
import {
  buildBlockedRunStatusResult,
  buildBlockedRunWaitResult,
  buildDispatchToolExceptionDetail,
  compactRunStatusReviewResult,
  mapBackendRefusalToDispatchCode,
  omitNullFields,
  resolveMonitorHandleAlwaysUnknown,
  summarizeRunStatusFinalResult
} from "./dispatch-tool-helpers.mjs";

export {
  TERMINAL_REVIEW_EVIDENCE_MODES,
  TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES,
  TERMINAL_REVIEW_MATERIALIZER_UNAVAILABLE_CODE
} from "./dispatch-terminal-review-evidence.mjs";

export { runPostWorkerSliceLifecycle } from "./dispatch-post-worker-lifecycle.mjs";

export function registerRunMonitorRoutes(ctx) {
  const {
    registerTool,
    workspaceRepos,
    z,
    jsonContent,
    resolveWorkspaceRepo,
    dispatchBackend,
    dispatchSessionIdentity
  } = ctx;

  const postWorkerLifecycleByRun = new Map();

  async function attemptUnknownHandleRecovery(workspace, args, refusal) {
    if (mapBackendRefusalToDispatchCode(refusal?.code) !== DISPATCH_BLOCKER_CODES.MONITOR_HANDLE_UNKNOWN ||
        typeof args?.subject !== "string" || !WORKER_SLICE_SUBJECT_RE.test(args.subject)) {
      return null;
    }
    if (typeof dispatchBackend?.recoverExactSliceReviewRun === "function") {
      const exactReview = await dispatchBackend.recoverExactSliceReviewRun({
        workspace,
        monitor_handle: args.monitor_handle,
        subject: args.subject
      });
      if (exactReview !== null) return exactReview;
    }
    if (typeof dispatchBackend?.recoverIntegratedWorkerRun !== "function") return null;
    return dispatchBackend.recoverIntegratedWorkerRun({
      workspace,
      monitor_handle: args.monitor_handle,
      subject: args.subject
    });
  }

  function resolveRecoveryRefusal(recovered, refusal, fallbackReason) {
    const failure = recovered?.recovery_failure ?? null;
    if (failure === null) {
      return {
        blockerCode: mapBackendRefusalToDispatchCode(refusal.code),
        reason: refusal.reason ?? fallbackReason,
        detail: refusal.detail ?? null
      };
    }
    return {
      blockerCode: DISPATCH_BLOCKER_CODES.OPERATOR_RECOVERY_NEEDED,
      reason: "post_worker_lifecycle_recovery_failed",
      detail: {
        recovery_failure: failure,

        backend_refusal: { code: refusal.code ?? null, reason: refusal.reason ?? null }
      }
    };
  }

  async function completeTerminalWorkerLifecycle(workspace, status) {
    if (status?.role !== "worker" || status?.terminal !== true || !WORKER_SLICE_SUBJECT_RE.test(status?.subject ?? "")) {
      return null;
    }
    if (!postWorkerLifecycleByRun.has(status.run_id)) {
      postWorkerLifecycleByRun.set(status.run_id, createLifecycleCheckpoint());
    }
    const checkpoint = postWorkerLifecycleByRun.get(status.run_id);
    if (checkpoint.phase === POST_WORKER_LIFECYCLE_PHASES.FINALIZED) {
      return checkpoint.finalized;
    }
    if (checkpoint.in_flight === null) {
      const invoke = dispatchBackend?.runPostWorkerSliceLifecycle ?? runPostWorkerSliceLifecycle;
      const statusWithCheckpoint = { ...status };
      Object.defineProperty(statusWithCheckpoint, POST_WORKER_LIFECYCLE_CHECKPOINT, {
        value: checkpoint,
        enumerable: false
      });
      const invocation = Promise.resolve()
        .then(() => invoke({ workspace, status: statusWithCheckpoint }))
        .then((result) => {

          if (checkpoint.phase === POST_WORKER_LIFECYCLE_PHASES.PRE_INTEGRATION) {
            checkpoint.integration = result?.integration ?? null;
            checkpoint.finalized = result;
            checkpoint.phase = POST_WORKER_LIFECYCLE_PHASES.FINALIZED;
          }
          return result;
        });
      checkpoint.in_flight = invocation;
    }
    const invocation = checkpoint.in_flight;
    try {
      return await invocation;
    } catch (error) {
      const detail = buildDispatchToolExceptionDetail("post_worker_slice_lifecycle", error);
      const failure = {
        invoked: true,
        phase: checkpoint.phase,
        integrated: checkpoint.phase !== POST_WORKER_LIFECYCLE_PHASES.PRE_INTEGRATION,
        error_code: error?.code ?? "agent_launch.slice_lifecycle.failed.v1",
        error_message: detail.error_message,
        error_message_truncated: detail.error_message_truncated
      };
      if (checkpoint.integration) failure.integration = checkpoint.integration;
      return Object.freeze(failure);
    } finally {
      if (checkpoint.in_flight === invocation) checkpoint.in_flight = null;
    }
  }

  registerTool(
    "workspace_agent_run_status",
    {
      description:
        "Query the status of a workspace_agent_dispatch run by monitor_handle. Stdio MCP is not an authentication boundary; caller-supplied identity carriers are refused. Unknown, subject-mismatch, and caller-session-mismatch handles refuse with the monitor_handle_* taxonomy. The accepted response is compact by default: null fields are omitted and a terminal run returns a bounded final_result_summary instead of the captured agent text. Pass verbose:true or include_final_result:true for the full final_result envelope. Free/local dispatched reviewer/redteam/worker output is prose-only under DEC-0128, so a terminal success carrying structured_role_result.valid:false is EXPECTED and is not a failed child run, a failed dispatch, or missing findings; a schema-valid structured role result is a paid/CCE capability enabled only by a canonical paid key.",
      inputSchema: {
        repo: z.string().optional(),
        monitor_handle: z.string(),
        subject: z.string().optional(),
        verbose: z.boolean().optional(),
        include_final_result: z.boolean().optional(),
        env: z.record(z.unknown()).optional(),
        request: z.record(z.unknown()).optional(),
        prompt: z.record(z.unknown()).optional(),
        argv: z.record(z.unknown()).optional(),
        claimed_identity: z
          .object({
            role: z.string().optional()
          })
          .optional()
      }
    },
    async (args) => {
      try {
        const identityRefusal = refuseCallerSuppliedIdentityFields(args);
        if (identityRefusal) {
          return jsonContent(
            buildBlockedRunStatusResult({
              blockerCode: DISPATCH_BLOCKER_CODES.CALLER_SUPPLIED_IDENTITY,
              reason: "caller_supplied_identity_carrier",
              detail: identityRefusal
            })
          );
        }

        const workspace = resolveWorkspaceRepo(workspaceRepos, args?.repo);

        if (!dispatchBackend) {
          const lookup = resolveMonitorHandleAlwaysUnknown(args.monitor_handle);
          return jsonContent(
            buildBlockedRunStatusResult({
              blockerCode: lookup.blocker_code,
              reason: lookup.reason,
              detail: null
            })
          );
        }

        let status = await dispatchBackend.getRunStatus({
          caller_session_id: dispatchSessionIdentity,
          monitor_handle: args.monitor_handle,
          subject: args.subject ?? null
        });
        let recoveredLifecycle = null;
        if (!status || status.accepted !== true) {
          const refusal = status?.refusal ?? {};
          const recovered = await attemptUnknownHandleRecovery(workspace, args, refusal);
          if (recovered?.status?.accepted === true && recovered.lifecycle) {
            status = recovered.status;
            recoveredLifecycle = recovered.lifecycle;
          } else {
            return jsonContent(
              buildBlockedRunStatusResult(
                resolveRecoveryRefusal(recovered, refusal, "run_status_backend_refused")
              )
            );
          }
        }
        const lifecycle = recoveredLifecycle ?? await completeTerminalWorkerLifecycle(workspace, status);

        const includeFullFinalResult =
          args?.verbose === true || args?.include_final_result === true;
        const finalResult = status.final_result ?? null;
        const reviewResult = compactRunStatusReviewResult(status.review_result);
        const accepted = {
          schema_version: AGENT_RUN_STATUS_SCHEMA_VERSION,
          accepted: true,
          verbose: args?.verbose === true,
          run_id: status.run_id,
          monitor_handle: status.monitor_handle,
          app: status.app ?? null,
          role: status.role,
          subject: status.subject,
          status: status.status,
          terminal: status.terminal,
          started_at: status.started_at,
          updated_at: status.updated_at,
          exit: status.exit ?? null,
          review_result: reviewResult
        };
        if (lifecycle) accepted.slice_lifecycle = lifecycle;
        if (finalResult) {
          if (includeFullFinalResult) {
            accepted.final_result = finalResult;
          } else {
            accepted.final_result_summary = summarizeRunStatusFinalResult(finalResult);
          }
        }
        return jsonContent(omitNullFields(accepted));
      } catch (error) {
        return jsonContent(
          buildBlockedRunStatusResult({
            blockerCode: DISPATCH_BLOCKER_CODES.OPERATOR_RECOVERY_NEEDED,
            reason: "run_status_tool_exception",
            detail: buildDispatchToolExceptionDetail("workspace_agent_run_status", error)
          })
        );
      }
    }
  );

  registerTool(
    "workspace_agent_run_wait",
    {
      description:
        "Wait for a workspace_agent_dispatch run to reach a terminal state or until a bounded wait window expires. Normally OMIT timeout_ms: the 60000 ms default is a client-safe window sized to return within the outer MCP tool-call timeout. Returns terminal with timed_out:false, or non-terminal with timed_out:true and next_action:\"retry_wait_or_check_status\" when the window expires. timed_out:true is a CLEAN wait-window timeout, NOT a failed child — the child is still running; call run_wait or run_status again with the SAME monitor_handle and do NOT relaunch. Stdio MCP is not an authentication boundary; caller-supplied identity carriers are refused, with the same monitor-handle/subject/caller-session refusal taxonomy as workspace_agent_run_status. Bounds (out-of-range refused): timeout_ms integer [1,300000] default 60000; poll_interval_ms integer [500,60000] default 5000. Terminal response is compact by default; pass verbose:true or include_final_result:true for the full final_result envelope. Free/local dispatched reviewer/redteam/worker output is prose-only under DEC-0128, so a terminal success carrying structured_role_result.valid:false is EXPECTED and is not a failed run, a failed dispatch, or missing findings; a schema-valid structured role result is a paid/CCE capability enabled only by a canonical paid key.",
      inputSchema: {
        repo: z.string().optional(),
        monitor_handle: z.string(),
        subject: z.string().optional(),
        timeout_ms: z.number().optional(),
        poll_interval_ms: z.number().optional(),
        verbose: z.boolean().optional(),
        include_final_result: z.boolean().optional(),
        env: z.record(z.unknown()).optional(),
        request: z.record(z.unknown()).optional(),
        prompt: z.record(z.unknown()).optional(),
        argv: z.record(z.unknown()).optional(),
        claimed_identity: z
          .object({
            role: z.string().optional()
          })
          .optional()
      }
    },
    async (args) => {
      try {
        const identityRefusal = refuseCallerSuppliedIdentityFields(args);
        if (identityRefusal) {
          return jsonContent(
            buildBlockedRunWaitResult({
              blockerCode: DISPATCH_BLOCKER_CODES.CALLER_SUPPLIED_IDENTITY,
              reason: "caller_supplied_identity_carrier",
              detail: identityRefusal
            })
          );
        }

        const workspace = resolveWorkspaceRepo(workspaceRepos, args?.repo);

        const timeoutMs = args?.timeout_ms ?? 60000;
        const pollIntervalMs = args?.poll_interval_ms ?? 5000;

        if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000) {
          return jsonContent(
            buildBlockedRunWaitResult({
              blockerCode: DISPATCH_BLOCKER_CODES.VALIDATION_FAILURE,
              reason: "timeout_ms_out_of_range",
              detail: {
                timeout_ms: timeoutMs,
                valid_range: [1, 300000],
                message: "timeout_ms must be an integer in [1, 300000]"
              }
            })
          );
        }
        if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 500 || pollIntervalMs > 60000) {
          return jsonContent(
            buildBlockedRunWaitResult({
              blockerCode: DISPATCH_BLOCKER_CODES.VALIDATION_FAILURE,
              reason: "poll_interval_ms_out_of_range",
              detail: {
                poll_interval_ms: pollIntervalMs,
                valid_range: [500, 60000],
                message: "poll_interval_ms must be an integer in [500, 60000]"
              }
            })
          );
        }

        if (!dispatchBackend) {
          const lookup = resolveMonitorHandleAlwaysUnknown(args.monitor_handle);
          return jsonContent(
            buildBlockedRunWaitResult({
              blockerCode: lookup.blocker_code,
              reason: lookup.reason,
              detail: null
            })
          );
        }

        let waitResult = await dispatchBackend.waitForRunStatus({
          caller_session_id: dispatchSessionIdentity,
          monitor_handle: args.monitor_handle,
          subject: args.subject ?? null,
          timeout_ms: timeoutMs,
          poll_interval_ms: pollIntervalMs
        });

        let recoveredLifecycle = null;
        if (!waitResult || waitResult.accepted !== true) {
          const refusal = waitResult?.refusal ?? {};
          const recovered = await attemptUnknownHandleRecovery(workspace, args, refusal);
          if (recovered?.status?.accepted === true && recovered.lifecycle) {
            waitResult = recovered.status;
            recoveredLifecycle = recovered.lifecycle;
          } else {
            return jsonContent(
              buildBlockedRunWaitResult(
                resolveRecoveryRefusal(recovered, refusal, "run_wait_backend_refused")
              )
            );
          }
        }

        if (waitResult.timed_out) {
          const timeout = {
            schema_version: AGENT_RUN_WAIT_SCHEMA_VERSION,
            accepted: true,
            timed_out: true,
            verbose: args?.verbose === true,
            run_id: waitResult.run_id,
            monitor_handle: waitResult.monitor_handle,
            app: waitResult.app ?? null,
            role: waitResult.role,
            subject: waitResult.subject,
            status: waitResult.status,
            terminal: false,
            started_at: waitResult.started_at,
            updated_at: waitResult.updated_at,
            next_action: "retry_wait_or_check_status"
          };
          return jsonContent(omitNullFields(timeout));
        }

        const lifecycle = recoveredLifecycle ?? await completeTerminalWorkerLifecycle(workspace, waitResult);

        const includeFullFinalResult =
          args?.verbose === true || args?.include_final_result === true;
        const finalResult = waitResult.final_result ?? null;
        const reviewResult = compactRunStatusReviewResult(waitResult.review_result);
        const accepted = {
          schema_version: AGENT_RUN_WAIT_SCHEMA_VERSION,
          accepted: true,
          timed_out: false,
          verbose: args?.verbose === true,
          run_id: waitResult.run_id,
          monitor_handle: waitResult.monitor_handle,
          app: waitResult.app ?? null,
          role: waitResult.role,
          subject: waitResult.subject,
          status: waitResult.status,
          terminal: true,
          started_at: waitResult.started_at,
          updated_at: waitResult.updated_at,
          exit: waitResult.exit ?? null,
          review_result: reviewResult
        };
        if (lifecycle) accepted.slice_lifecycle = lifecycle;
        if (finalResult) {
          if (includeFullFinalResult) {
            accepted.final_result = finalResult;
          } else {
            accepted.final_result_summary = summarizeRunStatusFinalResult(finalResult);
          }
        }
        return jsonContent(omitNullFields(accepted));
      } catch (error) {
        return jsonContent(
          buildBlockedRunWaitResult({
            blockerCode: DISPATCH_BLOCKER_CODES.OPERATOR_RECOVERY_NEEDED,
            reason: "run_wait_tool_exception",
            detail: buildDispatchToolExceptionDetail("workspace_agent_run_wait", error)
          })
        );
      }
    }
  );
}
