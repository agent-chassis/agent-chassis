

import {
  refuseCallerSuppliedIdentityFields
} from "@agent-chassis/wiki-core/src/lib/agent-dispatch-identity.mjs";
import { setWorkRecordStatusByUnit } from "../../../wiki-core/src/index.mjs";
import {
  defaultRunGit,
  resolveWorktreeBinding
} from "../../../agent-launch-cli/src/lib/worktree-substrate.mjs";
import { integrateCommittedSlice } from "../../../agent-launch-cli/src/lib/slice-integration.mjs";
import { releaseRetainedSlice } from "../../../agent-launch-cli/src/lib/worktree-reaper.mjs";
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

const WORKER_SLICE_SUBJECT_RE = /^(WK-\d{4})#(SLICE-\d{3})$/u;

function resolveSliceBindingForRun({ workspaceDir, status }, deps) {
  const resolveBinding = deps.resolveWorktreeBinding ?? resolveWorktreeBinding;
  return resolveBinding({
    mainRepo: workspaceDir,
    launchRef: status.monitor_handle,
    runId: `${status.run_id}.slice`,
    retryId: 0
  });
}

export async function runPostWorkerSliceLifecycle({ workspace, status, deps = {} } = {}) {
  const subject = typeof status?.subject === "string" ? status.subject.match(WORKER_SLICE_SUBJECT_RE) : null;
  if (status?.role !== "worker" || status?.terminal !== true || status?.status !== "succeeded" || !subject) {
    return null;
  }
  const binding = resolveSliceBindingForRun({ workspaceDir: workspace.dir, status }, deps);
  const [initiative, wkId, sliceId] = String(binding?.unit_address ?? "").split("/");
  if (wkId !== subject[1] || sliceId !== subject[2]) {
    throw new Error("post-worker lifecycle binding does not match the terminal worker subject");
  }
  const sliceBranch = binding.output_branch;
  const sliceRef = sliceBranch?.startsWith("refs/heads/") ? sliceBranch : `refs/heads/${sliceBranch}`;
  const wkRef = `refs/heads/wk/${initiative}/${wkId}`;
  const runGit = deps.runGit ?? defaultRunGit;
  const tipResult = runGit({ repo: workspace.dir, args: ["rev-parse", "--verify", `${sliceRef}^{commit}`] });
  if (!tipResult?.ok) throw new Error("post-worker lifecycle could not resolve the committed slice tip");
  const commit = String(tipResult.stdout ?? "").trim();
  if (commit === binding.base_sha) {
    return Object.freeze({ invoked: false, reason: "committed_slice_result_absent" });
  }
  const integration = await (deps.integrateCommittedSlice ?? integrateCommittedSlice)({
    mainRepo: workspace.dir,
    worktreePath: binding.worktree_path,
    unitAddress: binding.unit_address,
    sliceRef,
    wkRef,
    baseSha: binding.base_sha,
    commit,
    workerTerminated: true,
    transitionToReview: async ({ unitAddress, status: nextStatus }) =>
      (deps.setWorkRecordStatusByUnit ?? setWorkRecordStatusByUnit)({
        dir: workspace.dir,
        unitAddress,
        status: nextStatus
      }),
    deps: deps.integrationDeps
  });
  return Object.freeze({
    invoked: true,
    integrated: true,
    integration,
    reviewer_dispatch: Object.freeze({
      tool: "workspace_agent_dispatch",
      args: Object.freeze({ role: "reviewer", subject: wkId }),
      context: Object.freeze({
        frozen_review_target: integration.review_target,
        complete_parent_wk_contract: true
      })
    }),
    review_result_evidence: Object.freeze({
      status_tool: "workspace_agent_run_status",
      wait_tool: "workspace_agent_run_wait"
    })
  });
}

export function runRetainedSliceCleanupDisposition({ workspace, run, disposition, reviewStatus = null, deps = {} } = {}) {
  const acceptedReview = disposition === "accepted-review" &&
    reviewStatus?.accepted === true &&
    reviewStatus?.terminal === true &&
    reviewStatus?.role === "reviewer" &&
    reviewStatus?.review_result?.clean_review === true;
  const explicitResolution = disposition === "orchestrator-cancelled" || disposition === "orchestrator-revert";
  return (deps.releaseRetainedSlice ?? releaseRetainedSlice)({
    mainRepo: workspace.dir,
    launchRef: run.monitor_handle,
    runId: `${run.run_id}.slice`,
    retryId: 0,
    disposition,
    workerTerminated: run.terminal === true,
    reviewResolved: acceptedReview || explicitResolution,
    deps: deps.cleanupDeps
  });
}

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

  async function completeTerminalWorkerLifecycle(workspace, status) {
    if (status?.role !== "worker" || status?.terminal !== true || !WORKER_SLICE_SUBJECT_RE.test(status?.subject ?? "")) {
      return null;
    }
    if (!postWorkerLifecycleByRun.has(status.run_id)) {
      const invoke = dispatchBackend?.runPostWorkerSliceLifecycle ?? runPostWorkerSliceLifecycle;
      postWorkerLifecycleByRun.set(status.run_id, Promise.resolve().then(() => invoke({ workspace, status })));
    }
    try {
      return await postWorkerLifecycleByRun.get(status.run_id);
    } catch (error) {
      postWorkerLifecycleByRun.delete(status.run_id);
      const detail = buildDispatchToolExceptionDetail("post_worker_slice_lifecycle", error);
      return Object.freeze({
        invoked: true,
        integrated: false,
        error_code: error?.code ?? "agent_launch.slice_lifecycle.failed.v1",
        error_message: detail.error_message,
        error_message_truncated: detail.error_message_truncated
      });
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

        const status = await dispatchBackend.getRunStatus({
          caller_session_id: dispatchSessionIdentity,
          monitor_handle: args.monitor_handle,
          subject: args.subject ?? null
        });
        if (!status || status.accepted !== true) {
          const refusal = status?.refusal ?? {};
          return jsonContent(
            buildBlockedRunStatusResult({
              blockerCode: mapBackendRefusalToDispatchCode(refusal.code),
              reason: refusal.reason ?? "run_status_backend_refused",
              detail: refusal.detail ?? null
            })
          );
        }
        const lifecycle = await completeTerminalWorkerLifecycle(workspace, status);

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

        const waitResult = await dispatchBackend.waitForRunStatus({
          caller_session_id: dispatchSessionIdentity,
          monitor_handle: args.monitor_handle,
          subject: args.subject ?? null,
          timeout_ms: timeoutMs,
          poll_interval_ms: pollIntervalMs
        });

        if (!waitResult || waitResult.accepted !== true) {
          const refusal = waitResult?.refusal ?? {};
          return jsonContent(
            buildBlockedRunWaitResult({
              blockerCode: mapBackendRefusalToDispatchCode(refusal.code),
              reason: refusal.reason ?? "run_wait_backend_refused",
              detail: refusal.detail ?? null
            })
          );
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

        const lifecycle = await completeTerminalWorkerLifecycle(workspace, waitResult);

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
