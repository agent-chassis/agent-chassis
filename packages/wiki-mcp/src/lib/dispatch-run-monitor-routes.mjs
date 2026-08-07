

import path from "node:path";

import {
  refuseCallerSuppliedIdentityFields
} from "@agent-chassis/wiki-core/src/lib/agent-dispatch-identity.mjs";
import { buildCloseoutWorkflowContinuation } from "./dispatch-closeout-continuation.mjs";
import {
  buildLifecycleFailure,
  publishableLifecycleFailure,
  RecordedLifecycleFailure
} from "./dispatch-lifecycle-failure-disclosure.mjs";
import {
  createLifecycleCheckpoint,
  LIFECYCLE_RESOLUTION_NEXT_ACTIONS,
  lifecycleResolutionRequiresExternalAction,
  POST_WORKER_LIFECYCLE_CHECKPOINT,
  POST_WORKER_LIFECYCLE_PHASES,
  projectLifecycleResolution,
  recordLifecycleFailure,
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
  LIFECYCLE_EXTERNAL_ACTION_NEXT_ACTIONS,
  LIFECYCLE_FAILURE_HISTORY_LIMIT,
  LIFECYCLE_RESOLUTION_NEXT_ACTIONS,
  lifecycleResolutionRequiresExternalAction,
  projectLifecycleResolution,
  RUN_LIFECYCLE_RESOLUTION_SCHEMA_VERSION
} from "./dispatch-post-worker-lifecycle-bindings.mjs";

export {
  TERMINAL_REVIEW_EVIDENCE_MODES,
  TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES,
  TERMINAL_REVIEW_MATERIALIZER_UNAVAILABLE_CODE
} from "./dispatch-terminal-review-evidence.mjs";

export { runPostWorkerSliceLifecycle } from "./dispatch-post-worker-lifecycle.mjs";

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

export {
  buildCloseoutWorkflowContinuation,
  CLOSEOUT_WORKFLOW_CONTINUATION_SCHEMA_VERSION
} from "./dispatch-closeout-continuation.mjs";

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
        })

        .catch((error) => {
          throw new RecordedLifecycleFailure(
            recordLifecycleFailure(checkpoint, buildLifecycleFailure(checkpoint, error))
          );
        });
      checkpoint.in_flight = invocation;
    }
    const invocation = checkpoint.in_flight;
    try {
      return await invocation;
    } catch (error) {

      if (error instanceof RecordedLifecycleFailure) return error.failure;

      return recordLifecycleFailure(checkpoint, buildLifecycleFailure(checkpoint, error));
    } finally {
      if (checkpoint.in_flight === invocation) checkpoint.in_flight = null;
    }
  }

  function projectManagedTerminality({ runId, lifecycle, childTerminal }) {
    const checkpoint = postWorkerLifecycleByRun.get(runId) ?? null;
    const resolution = projectLifecycleResolution({ lifecycle, checkpoint });
    return {
      child_terminal: childTerminal === true,
      terminal: childTerminal === true && (resolution === null || resolution.resolved === true),
      lifecycle_resolution: resolution
    };
  }

  function resolveTopLevelNextAction(resolution) {
    return lifecycleResolutionRequiresExternalAction(resolution)
      ? resolution.next_action
      : LIFECYCLE_RESOLUTION_NEXT_ACTIONS.RETRY;
  }

  registerTool(
    "workspace_agent_run_status",
    {
      description:
        "Query a workspace_agent_dispatch run by monitor_handle. NOT read-only for a managed exact-slice worker run: each call ADVANCES that run's post-worker lifecycle, writing canonical work-record status and mutating Git refs through the trusted runtime. terminal:true means the COMPLETE managed run is finalized; child_terminal reports only that the child process ended. An unresolved run returns terminal:false, child_terminal:true, and a lifecycle_resolution projection (phase, latest retained typed failure, bounded attempt metadata, next step). next_action is that exact lifecycle action when the CALLER must act - notably \"complete_slice_review_then_retry_run_status\", which polling can never clear - else \"retry_wait_or_check_status\": poll again with the same monitor_handle and do NOT relaunch. status, exit, final_result, and review_result describe the CHILD and never contradict terminal:false. Stdio MCP is not an authentication boundary; caller-supplied identity carriers are refused. Unknown, subject-mismatch, and caller-session-mismatch handles refuse with the monitor_handle_* taxonomy. Responses are compact by default (null fields omitted, bounded final_result_summary); pass verbose:true or include_final_result:true for the full final_result. Free/local output is prose-only under DEC-0128, so structured_role_result.valid:false on a terminal success is EXPECTED, not a failed child run or missing findings.",
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
        const terminality = projectManagedTerminality({
          runId: status.run_id,
          lifecycle,
          childTerminal: status.terminal === true
        });
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
          terminal: terminality.terminal,
          child_terminal: terminality.child_terminal,
          started_at: status.started_at,

          updated_at: status.updated_at,
          exit: status.exit ?? null,
          review_result: reviewResult
        };
        if (Array.isArray(status.validation_evidence)) {
          accepted.validation_evidence = status.validation_evidence;
        }
        if (terminality.lifecycle_resolution) {
          accepted.lifecycle_resolution = terminality.lifecycle_resolution;
        }
        if (!terminality.terminal) {
          accepted.next_action = resolveTopLevelNextAction(terminality.lifecycle_resolution);
        }
        const closeoutContinuation = await buildCloseoutWorkflowContinuation({
          dispatchBackend,
          status,
          lifecycle
        });
        if (closeoutContinuation !== null) {
          accepted.closeout_continuation = closeoutContinuation;
        }

        if (lifecycle) accepted.slice_lifecycle = publishableLifecycleFailure(lifecycle);
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
        "Wait for a workspace_agent_dispatch run to finish, or until a bounded wait window expires. NOT read-only: like run_status it ADVANCES a managed exact-slice run's post-worker lifecycle (canonical status writes, trusted-runtime Git ref mutation). terminal:true means the COMPLETE managed run is finalized; child_terminal only that the child process ended. Normally OMIT timeout_ms: the 60000 ms default suits the outer MCP tool-call timeout. The window bounds the WHOLE call: after the child exits it keeps waiting on the same deadline for the lifecycle. Three outcomes: (1) terminal:true, timed_out:false; (2) terminal:false, timed_out:false, child_terminal:true, next_action:\"complete_slice_review_then_retry_run_status\" - returned PROMPTLY; only the caller can clear it; (3) timed_out:true with next_action:\"retry_wait_or_check_status\" - the window expired; nothing failed. Cases 2 and 3 carry a lifecycle_resolution projection (phase, latest retained typed failure, bounded attempt metadata) and never mean a failed child: call again with the SAME monitor_handle; do NOT relaunch. Bounds (out-of-range refused): timeout_ms [1,300000] default 60000; poll_interval_ms [500,60000] default 5000, both integers. Identity carriers are refused with the monitor_handle_* taxonomy. Terminal response is compact; pass verbose:true or include_final_result:true for the full final_result. Free/local output is prose-only under DEC-0128, so structured_role_result.valid:false on success is EXPECTED.",
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

        const waitDeadline = Date.now() + timeoutMs;

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

        const buildWaitTimeout = (source, childTerminal, resolution, lifecycle = null) => {
          const timeout = {
            schema_version: AGENT_RUN_WAIT_SCHEMA_VERSION,
            accepted: true,
            timed_out: true,
            verbose: args?.verbose === true,
            run_id: source.run_id,
            monitor_handle: source.monitor_handle,
            app: source.app ?? null,
            role: source.role,
            subject: source.subject,
            status: source.status,
            terminal: false,
            child_terminal: childTerminal === true,
            started_at: source.started_at,
            updated_at: source.updated_at,
            next_action: resolveTopLevelNextAction(resolution)
          };
          if (Array.isArray(source.validation_evidence)) {
            timeout.validation_evidence = source.validation_evidence;
          }
          if (resolution) timeout.lifecycle_resolution = resolution;
          const publishable = publishableLifecycleFailure(lifecycle);
          if (publishable) timeout.slice_lifecycle = publishable;
          return jsonContent(omitNullFields(timeout));
        };

        if (waitResult.timed_out) {

          return buildWaitTimeout(waitResult, false, null);
        }

        const childTerminal = waitResult.terminal === true;
        let lifecycle = recoveredLifecycle ?? await completeTerminalWorkerLifecycle(workspace, waitResult);
        let terminality = projectManagedTerminality({
          runId: waitResult.run_id,
          lifecycle,
          childTerminal
        });

        while (recoveredLifecycle === null &&
               !terminality.terminal &&
               terminality.lifecycle_resolution !== null &&
               !lifecycleResolutionRequiresExternalAction(terminality.lifecycle_resolution)) {
          const remainingMs = waitDeadline - Date.now();
          if (remainingMs <= 0) {

            return buildWaitTimeout(
              waitResult, childTerminal, terminality.lifecycle_resolution, lifecycle
            );
          }
          await sleep(Math.min(pollIntervalMs, remainingMs));
          lifecycle = await completeTerminalWorkerLifecycle(workspace, waitResult);
          terminality = projectManagedTerminality({
            runId: waitResult.run_id,
            lifecycle,
            childTerminal
          });
        }

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
          terminal: terminality.terminal,
          child_terminal: terminality.child_terminal,
          started_at: waitResult.started_at,
          updated_at: waitResult.updated_at,
          exit: waitResult.exit ?? null,
          review_result: reviewResult
        };
        if (Array.isArray(waitResult.validation_evidence)) {
          accepted.validation_evidence = waitResult.validation_evidence;
        }
        if (terminality.lifecycle_resolution) {
          accepted.lifecycle_resolution = terminality.lifecycle_resolution;
        }
        if (!terminality.terminal) {
          accepted.next_action = resolveTopLevelNextAction(terminality.lifecycle_resolution);
        }
        const closeoutContinuation = await buildCloseoutWorkflowContinuation({
          dispatchBackend,
          status: waitResult,
          lifecycle
        });
        if (closeoutContinuation !== null) {
          accepted.closeout_continuation = closeoutContinuation;
        }

        if (lifecycle) accepted.slice_lifecycle = publishableLifecycleFailure(lifecycle);
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
