

import path from "node:path";

import {
  ATTEMPT_LINEAGE_CONFLICT_CLASSES
} from "@agent-chassis/agent-launch-cli/src/lib/workspace-agent-dispatch-run-lifecycle-settlement.mjs";
import {
  LAUNCHER_AGENT_SESSION_CONTRACT_FIELDS,
  LAUNCHER_AGENT_SESSION_CONTRACT_SCHEMA_VERSION,
  digestLauncherAgentSessionContract
} from "@agent-chassis/agent-launch-cli/src/lib/stdio-mcp-conduit-authority.mjs";

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
  BACKEND_SETTLE_GRACE_MS,
  createCallDeadline,
  MONITOR_CALL_DEFAULT_TIMEOUT_MS,
  retainAbandonedWork,
  RUN_STATUS_CALL_BUDGET_MS,
  RUN_WAIT_TIMEOUT_MS_BOUNDS,
  settleWithinDeadline
} from "./dispatch-monitor-call-deadline.mjs";
import {
  createLifecycleCheckpoint,
  LIFECYCLE_RESOLUTION_NEXT_ACTIONS,
  lifecycleResolutionRequiresExternalAction,
  POST_WORKER_LIFECYCLE_CHECKPOINT,
  POST_WORKER_LIFECYCLE_PHASES,
  projectInFlightLifecycleResolution,
  projectLifecycleResolution,
  recordLifecycleFailure,
  WORKER_SLICE_SUBJECT_RE
} from "./dispatch-post-worker-lifecycle-bindings.mjs";
import { runPostWorkerSliceLifecycle } from "./dispatch-post-worker-lifecycle.mjs";
import {
  AGENT_RUNS_LIST_SCHEMA_VERSION,
  AGENT_RUN_STATUS_SCHEMA_VERSION,
  AGENT_RUN_WAIT_SCHEMA_VERSION,
  DISPATCH_BLOCKER_CODES
} from "./dispatch-tool-constants.mjs";
import {
  buildBlockedRunsListResult,
  buildBlockedRunStatusResult,
  buildBlockedRunWaitResult,
  buildDispatchContinuation,
  buildDispatchMechanicalRefusal,
  withRecordedRequestSchemas,
  NO_SUPPORTED_ROUTE_RECOVERY,
  buildDispatchToolExceptionDetail,
  classifyAgentDispatchSubject,
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
  BACKEND_SETTLE_GRACE_MS,
  MONITOR_CALL_DEFAULT_TIMEOUT_MS,
  RUN_STATUS_CALL_BUDGET_MS,
  RUN_WAIT_TIMEOUT_MS_BOUNDS
} from "./dispatch-monitor-call-deadline.mjs";

export {
  TERMINAL_REVIEW_EVIDENCE_MODES,
  TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES,
  TERMINAL_REVIEW_MATERIALIZER_UNAVAILABLE_CODE
} from "./dispatch-terminal-review-evidence.mjs";

export { runPostWorkerSliceLifecycle } from "./dispatch-post-worker-lifecycle.mjs";

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const ATTEMPT_LINEAGE_PROJECTION_KEYS = Object.freeze([
  "schema_version", "state", "prior_run_id", "replacement_run_id", "monitor_handle",
  "prior_mode", "attempted_mode", "conflict_class", "conflict_detail", "next_action"
]);

export function projectLauncherAgentSessionContractForMonitoring(contract) {
  const keys = contract && typeof contract === "object" && !Array.isArray(contract)
    ? Object.keys(contract).sort()
    : [];
  const expected = [...LAUNCHER_AGENT_SESSION_CONTRACT_FIELDS].sort();
  if (contract?.schema_version !== LAUNCHER_AGENT_SESSION_CONTRACT_SCHEMA_VERSION ||
      keys.length !== expected.length || keys.some((key, index) => key !== expected[index]) ||
      digestLauncherAgentSessionContract(contract) !== contract.contract_digest) {
    throw new TypeError("monitoring requires an intact launcher agent session contract");
  }
  return Object.freeze({
    schema_version: "launcher-agent-session-contract-monitoring-projection.v1",
    contract_schema_version: contract.schema_version,
    contract_digest: contract.contract_digest,
    role: contract.role,
    assigned_unit: contract.assigned_unit.address,
    repository_id: contract.repository.repository_id,
    lifecycle_position: contract.lifecycle.position,
    completion_transport_id: contract.completion_transport.transport_id
  });
}

function attachSessionContractProjection(target, status) {
  if (status?.session_contract === null || status?.session_contract === undefined) {
    if (status?.session_contract_required === true) {
      throw new TypeError("production monitoring status omitted its required session contract");
    }
    return;
  }
  target.session_contract = projectLauncherAgentSessionContractForMonitoring(
    status.session_contract
  );
}

const ATTEMPT_LINEAGE_CONFLICT_CLASS_SET = new Set(
  ATTEMPT_LINEAGE_CONFLICT_CLASSES
);
const ATTEMPT_LINEAGE_PUBLIC_SCHEMA_VERSION =
  "workspace-agent-attempt-lineage-resolution.v2";
const ATTEMPT_LINEAGE_PUBLIC_KEYS = Object.freeze([
  "schema_version", "state", "root_cause", "replacement_run_id", "continuation"
]);
const ATTEMPT_LINEAGE_CONTINUATION_TOOLS = new Set([
  "workspace_agent_run_status",
  "workspace_agent_run_wait"
]);

function publishAttemptLineageResolution(status, continuationTool) {
  try {
    const projection = status?.attempt_lineage_resolution ?? null;
    if (projection === null) return null;
    if (!ATTEMPT_LINEAGE_CONTINUATION_TOOLS.has(continuationTool) ||
        projection?.schema_version !== "workspace-agent-attempt-lineage-resolution.v1" ||
        Reflect.ownKeys(projection).sort().join("\0") !==
          [...ATTEMPT_LINEAGE_PROJECTION_KEYS].sort().join("\0") ||
        !new Set(["selected", "operator_recovery_needed"]).has(projection.state) ||
        !ATTEMPT_LINEAGE_CONFLICT_CLASS_SET.has(projection.conflict_class) ||
        ((projection.state === "selected") !== (projection.conflict_class === "none")) ||
        projection.replacement_run_id !== status.run_id ||
        projection.monitor_handle !== status.monitor_handle ||
        typeof status.subject !== "string" || status.subject.length === 0) {
      throw new TypeError();
    }
    const continuation = projection.state === "selected" &&
        projection.next_action === "consume_selected_result"
      ? null
      : Object.freeze({
          tool: continuationTool,
          arguments: Object.freeze({
            monitor_handle: status.monitor_handle,
            subject: status.subject
          })
        });
    const publicProjection = Object.freeze({
      schema_version: ATTEMPT_LINEAGE_PUBLIC_SCHEMA_VERSION,
      state: projection.state,
      root_cause: projection.conflict_class === "none"
        ? null
        : projection.conflict_class,
      replacement_run_id: projection.replacement_run_id,
      continuation
    });
    if (Reflect.ownKeys(publicProjection).join("\0") !==
        ATTEMPT_LINEAGE_PUBLIC_KEYS.join("\0")) throw new TypeError();
    return publicProjection;
  } catch {

    throw new TypeError("launcher attempt-lineage projection is not publishable");
  }
}

export {
  buildCloseoutWorkflowContinuation,
  CLOSEOUT_WORKFLOW_CONTINUATION_SCHEMA_VERSION
} from "./dispatch-closeout-continuation.mjs";

export function registerRunMonitorRoutes(ctx) {
  const {
    registerTool: registerToolInput,
    workspaceRepos,
    z,
    jsonContent,
    resolveWorkspaceRepo,
    dispatchBackend,
    dispatchSessionIdentity,

    runStatusCallBudgetMs = RUN_STATUS_CALL_BUDGET_MS
  } = ctx;

  const registerTool = withRecordedRequestSchemas(registerToolInput);

  const monitorRefusal = ({ code, decidingFacts, observedFacts, continuation = null, carried = null, route }) => {
    const common = { code, decidingFacts, observedFacts, route, carried };
    if (continuation === null) {
      return buildDispatchMechanicalRefusal({
        ...common,
        noSupportedRoute: true,
        recovery: NO_SUPPORTED_ROUTE_RECOVERY
      });
    }
    const projectedContinuation = continuation.call.tool === route
      ? Object.freeze({
          ...continuation.call,
          prerequisite_predicate: continuation.call.success_predicate
        })
      : continuation.call;
    return buildDispatchMechanicalRefusal({
      ...common,
      nextCalls: [projectedContinuation],
      recovery: {
        state: "callable",
        prerequisite: continuation.prerequisite,
        operation: projectedContinuation.tool,
        success_condition: continuation.successCondition,
        success_predicate: projectedContinuation.success_predicate
      }
    });
  };

  const enumerateRunsContinuation = () => {
    const call = buildDispatchContinuation({
      tool: "workspace_agent_runs_list",
      arguments: { state: "active" },
      successPredicate: { fact: "monitor.known_runs_enumerated", operator: "is_true" }
    });
    return call === null ? null : {
      call,
      prerequisite: "the supplied monitor handle is not one this server minted",
      successCondition:
        "workspace_agent_runs_list returns the runs this server minted, from which a recognised monitor_handle can be selected"
    };
  };

  const unknownHandleRefusal = (code, route) => monitorRefusal({
    code,
    decidingFacts: [
      { field: "monitor.handle_minted_by_server", value: false },
      { field: "monitor.known_runs_enumerated", value: false }
    ],
    observedFacts: {
      "monitor.handle_minted_by_server": false,
      "monitor.known_runs_enumerated": false
    },
    continuation: enumerateRunsContinuation(),
    route
  });

  const unsettledCallContinuation = (route, monitorHandle) => {
    const call = buildDispatchContinuation({
      tool: route,
      arguments: { monitor_handle: monitorHandle },
      successPredicate: { fact: "monitor.call_settled_within_bound", operator: "is_true" }
    });
    return call === null ? null : {
      call,
      prerequisite: "this monitor call's server-owned bound elapsed before the backend answered",
      successCondition: `${route} returns a settled run status for the same monitor_handle`
    };
  };

  const backendAbsentRefusal = (route, missingBackend) => monitorRefusal({
    code: DISPATCH_BLOCKER_CODES.BACKEND_UNAVAILABLE,
    decidingFacts: [
      { field: "monitor.backend_registered", value: false },
      { field: "monitor.missing_backend", value: missingBackend }
    ],
    observedFacts: {
      "monitor.backend_registered": false,
      "monitor.missing_backend": missingBackend
    },

    continuation: null,
    route
  });

  const routeExceptionRefusal = (route) => monitorRefusal({
    code: DISPATCH_BLOCKER_CODES.OPERATOR_RECOVERY_NEEDED,
    decidingFacts: [{ field: "monitor.call_completed", value: false }],
    observedFacts: { "monitor.call_completed": false },
    continuation: null,
    route
  });

  const invalidArgumentRefusal = (route, field, value, code = DISPATCH_BLOCKER_CODES.VALIDATION_FAILURE) => monitorRefusal({
    code,
    decidingFacts: [{ field, value }],
    observedFacts: { [field]: value },

    continuation: null,
    route
  });

  const postWorkerLifecycleByRun = new Map();

  registerTool(
    "workspace_agent_runs_list",
    {
      description:
        "Read-only current-process discovery of runs visible to this server-injected dispatch session. Use after hot context compaction to recover monitor handles, then call workspace_agent_run_status or workspace_agent_run_wait. The list is not durable or historically complete. After a cold restart, already-returned reviewer/redteam advisory text remains usable and needs no re-dispatch, append, or monitor repair.",
      inputSchema: z.object({
        subject: z.string().refine(
          (value) => classifyAgentDispatchSubject(value) !== null,
          { message: "subject must be a canonical WK, WK slice, or IN address" }
        ).optional(),
        state: z.enum(["active", "terminal", "all"]).optional()
      }).strict()
    },
    async (args) => {
      try {
        const state = args?.state ?? "active";
        const subject = args?.subject ?? null;
        if (typeof dispatchBackend?.listRuns !== "function") {
          return jsonContent(buildBlockedRunsListResult({
            blockerCode: DISPATCH_BLOCKER_CODES.BACKEND_UNAVAILABLE,
            reason: "run_list_backend_unavailable",
            detail: { missing_backend: "workspace_agent_dispatch_backend.listRuns" },
            refusal: backendAbsentRefusal(
              "workspace_agent_runs_list",
              "workspace_agent_dispatch_backend.listRuns"
            )
          }));
        }

        const listed = await dispatchBackend.listRuns({
          caller_session_id: dispatchSessionIdentity,
          subject,
          state
        });
        if (!listed || listed.accepted !== true) {
          const refusal = listed?.refusal ?? {};
          const listCode = mapBackendRefusalToDispatchCode(refusal.code);
          return jsonContent(buildBlockedRunsListResult({
            blockerCode: listCode,
            reason: refusal.reason ?? "run_list_backend_refused",
            detail: refusal.detail ?? null,
            refusal: monitorRefusal({
              code: listCode,
              decidingFacts: [{ field: "monitor.run_listing_returned", value: false }],
              observedFacts: { "monitor.run_listing_returned": false },

              carried: { backend_refusal: { code: refusal.code ?? null, reason: refusal.reason ?? null } },
              continuation: null,
              route: "workspace_agent_runs_list"
            })
          }));
        }

        const runs = listed.runs;
        const totalCount = runs.length;
        return jsonContent({
          schema_version: AGENT_RUNS_LIST_SCHEMA_VERSION,
          accepted: true,
          availability: "current_process",
          retention_state: "unknown",
          state,
          ...(subject === null ? {} : { subject }),
          total_count: totalCount,
          returned_count: totalCount,
          has_more: false,
          runs
        });
      } catch (error) {
        return jsonContent(buildBlockedRunsListResult({
          blockerCode: DISPATCH_BLOCKER_CODES.OPERATOR_RECOVERY_NEEDED,
          reason: "run_list_tool_exception",
          detail: buildDispatchToolExceptionDetail("workspace_agent_runs_list", error),
          refusal: routeExceptionRefusal("workspace_agent_runs_list")
        }));
      }
    }
  );

  async function attemptUnknownHandleRecovery(workspace, args, refusal) {
    if (mapBackendRefusalToDispatchCode(refusal?.code) !== DISPATCH_BLOCKER_CODES.MONITOR_HANDLE_UNKNOWN ||
        typeof args?.subject !== "string" || !WORKER_SLICE_SUBJECT_RE.test(args.subject)) {
      return null;
    }
    if (typeof dispatchBackend?.recoverIntegratedWorkerRun !== "function") return null;
    return dispatchBackend.recoverIntegratedWorkerRun({
      workspace,
      monitor_handle: args.monitor_handle,
      subject: args.subject
    });
  }

  function unresponsiveBackendRefusal(reason, budgetMs, { route, monitorHandle } = {}) {
    return {
      blockerCode: DISPATCH_BLOCKER_CODES.BACKEND_UNAVAILABLE,
      reason,
      detail: {
        call_budget_ms: budgetMs,
        message: "the dispatch backend did not answer inside this monitor call's bound; the run is unaffected"
      },
      nextAction: "retry the same monitor route with the same monitor_handle; do not relaunch",

      refusal: monitorRefusal({
        code: DISPATCH_BLOCKER_CODES.BACKEND_UNAVAILABLE,
        decidingFacts: [
          { field: "monitor.call_settled_within_bound", value: false },
          { field: "monitor.call_budget_ms", value: budgetMs ?? null }
        ],
        observedFacts: {
          "monitor.call_settled_within_bound": false,
          "monitor.call_budget_ms": budgetMs ?? null
        },
        continuation: route ? unsettledCallContinuation(route, monitorHandle) : null,
        route: route ?? null
      })
    };
  }

  function unresponsiveRecoveryRefusal(refusal, budgetMs, { route, monitorHandle } = {}) {
    return {
      blockerCode: DISPATCH_BLOCKER_CODES.OPERATOR_RECOVERY_NEEDED,
      reason: "post_worker_lifecycle_recovery_unresponsive",
      refusal: monitorRefusal({
        code: DISPATCH_BLOCKER_CODES.OPERATOR_RECOVERY_NEEDED,
        decidingFacts: [
          { field: "monitor.recovery_settled_within_bound", value: false },
          { field: "monitor.call_settled_within_bound", value: false }
        ],
        observedFacts: {
          "monitor.recovery_settled_within_bound": false,
          "monitor.call_settled_within_bound": false
        },
        carried: { backend_refusal: { code: refusal?.code ?? null, reason: refusal?.reason ?? null } },
        continuation: route ? unsettledCallContinuation(route, monitorHandle) : null,
        route: route ?? null
      }),
      detail: {
        call_budget_ms: budgetMs,

        backend_refusal: { code: refusal?.code ?? null, reason: refusal?.reason ?? null }
      },
      nextAction: "retry the same monitor route with the same monitor_handle; do not relaunch"
    };
  }

  function resolveRecoveryRefusal(recovered, refusal, fallbackReason, { route } = {}) {
    const failure = recovered?.recovery_failure ?? null;
    if (failure === null) {
      const code = mapBackendRefusalToDispatchCode(refusal.code);
      return {
        blockerCode: code,
        reason: refusal.reason ?? fallbackReason,
        detail: refusal.detail ?? null,

        refusal: unknownHandleRefusal(code, route ?? null)
      };
    }
    return {
      blockerCode: DISPATCH_BLOCKER_CODES.OPERATOR_RECOVERY_NEEDED,

      refusal: monitorRefusal({
        code: DISPATCH_BLOCKER_CODES.OPERATOR_RECOVERY_NEEDED,
        decidingFacts: [{ field: "monitor.post_worker_lifecycle_recovered", value: false }],
        observedFacts: { "monitor.post_worker_lifecycle_recovered": false },
        carried: { backend_refusal: { code: refusal.code ?? null, reason: refusal.reason ?? null } },
        continuation: null,
        route: route ?? null
      }),
      reason: typeof failure.reason === "string" && failure.reason.length > 0
        ? failure.reason
        : "post_worker_lifecycle_recovery_failed",
      detail: {
        recovery_failure: failure,

        backend_refusal: { code: refusal.code ?? null, reason: refusal.reason ?? null }
      }
    };
  }

  const NO_MANAGED_LIFECYCLE = Object.freeze({ lifecycle: null, advance_in_flight: false });
  const settledAdvance = (lifecycle) => ({ lifecycle, advance_in_flight: false });

  async function advanceManagedSliceLifecycle(workspace, status, deadline) {
    if (status?.role !== "worker" || status?.terminal !== true || !WORKER_SLICE_SUBJECT_RE.test(status?.subject ?? "")) {
      return NO_MANAGED_LIFECYCLE;
    }
    if (!postWorkerLifecycleByRun.has(status.run_id)) {
      postWorkerLifecycleByRun.set(status.run_id, createLifecycleCheckpoint());
    }
    const checkpoint = postWorkerLifecycleByRun.get(status.run_id);
    if (checkpoint.phase === POST_WORKER_LIFECYCLE_PHASES.FINALIZED) {
      return settledAdvance(checkpoint.finalized);
    }
    if (checkpoint.in_flight === null) {
      const invoke = dispatchBackend?.runPostWorkerSliceLifecycle ?? runPostWorkerSliceLifecycle;
      const statusWithCheckpoint = { ...status };
      Object.defineProperty(statusWithCheckpoint, POST_WORKER_LIFECYCLE_CHECKPOINT, {
        value: checkpoint,
        enumerable: false
      });
      // eslint-disable-next-line prefer-const -- the settlement seam below closes over

      let attempt;
      attempt = Promise.resolve()
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
        })

        .finally(() => {
          if (checkpoint.in_flight === attempt) checkpoint.in_flight = null;
        });
      checkpoint.in_flight = attempt;

      retainAbandonedWork(attempt);
    }
    const invocation = checkpoint.in_flight;
    let outcome;
    try {
      outcome = await settleWithinDeadline(invocation, deadline);
    } catch (error) {

      if (error instanceof RecordedLifecycleFailure) return settledAdvance(error.failure);

      return settledAdvance(
        recordLifecycleFailure(checkpoint, buildLifecycleFailure(checkpoint, error))
      );
    }
    if (outcome.settled) return settledAdvance(outcome.value);

    if (checkpoint.phase === POST_WORKER_LIFECYCLE_PHASES.FINALIZED) {
      return settledAdvance(checkpoint.finalized);
    }
    return { lifecycle: null, advance_in_flight: true };
  }

  function projectManagedTerminality({ runId, lifecycle, childTerminal, advanceInFlight = false }) {
    const checkpoint = postWorkerLifecycleByRun.get(runId) ?? null;

    const resolution = advanceInFlight
      ? projectInFlightLifecycleResolution(checkpoint)
      : projectLifecycleResolution({ lifecycle, checkpoint });
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
        "Query a workspace_agent_dispatch run by monitor_handle. For a managed exact-slice worker this advances the trusted post-worker lifecycle and is not read-only. terminal:true means the complete managed run is finalized; child_terminal means only that the child ended. An unresolved run returns terminal:false plus lifecycle_resolution and an exact next_action. Poll again with the same handle when instructed; never relaunch merely because monitoring is incomplete. The whole call has a server-owned 60000 ms budget, and advance_in_flight:true means its lifecycle attempt continues. Caller identity carriers are refused; handle errors use the monitor_handle_* taxonomy. Reviewer/redteam final_result is text-first advisory evidence. Captured text remains usable despite schema diagnostics; requested formal attestation is settled in that same result and grants no lifecycle authority.",
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
              detail: identityRefusal,
              refusal: invalidArgumentRefusal(
                "workspace_agent_run_status",
                "request.caller_supplied_identity_present",
                true,
                DISPATCH_BLOCKER_CODES.CALLER_SUPPLIED_IDENTITY
              )
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
              detail: null,
              refusal: unknownHandleRefusal(lookup.blocker_code, "workspace_agent_run_status")
            })
          );
        }

        const deadline = createCallDeadline(runStatusCallBudgetMs);

        const statusOutcome = await settleWithinDeadline(dispatchBackend.getRunStatus({
          caller_session_id: dispatchSessionIdentity,
          monitor_handle: args.monitor_handle,
          subject: args.subject ?? null
        }), deadline);
        if (!statusOutcome.settled) {
          return jsonContent(buildBlockedRunStatusResult(
            unresponsiveBackendRefusal("run_status_backend_unresponsive", runStatusCallBudgetMs, {
              route: "workspace_agent_run_status",
              monitorHandle: args.monitor_handle
            })
          ));
        }
        let status = statusOutcome.value;
        let recoveredLifecycle = null;
        if (!status || status.accepted !== true) {
          const refusal = status?.refusal ?? {};
          const recoveryOutcome = await settleWithinDeadline(
            attemptUnknownHandleRecovery(workspace, args, refusal), deadline
          );
          if (!recoveryOutcome.settled) {
            return jsonContent(buildBlockedRunStatusResult(
              unresponsiveRecoveryRefusal(refusal, runStatusCallBudgetMs, {
              route: "workspace_agent_run_status",
              monitorHandle: args.monitor_handle
            })
            ));
          }
          const recovered = recoveryOutcome.value;
          if (recovered?.status?.accepted === true &&
              Object.prototype.hasOwnProperty.call(recovered, "lifecycle")) {
            status = recovered.status;
            recoveredLifecycle = recovered.lifecycle;
          } else {
            return jsonContent(
              buildBlockedRunStatusResult(
                resolveRecoveryRefusal(recovered, refusal, "run_status_backend_refused", {
                  route: "workspace_agent_run_status"
                })
              )
            );
          }
        }
        const advance = recoveredLifecycle === null
          ? await advanceManagedSliceLifecycle(workspace, status, deadline)
          : settledAdvance(recoveredLifecycle);
        const lifecycle = advance.lifecycle;

        const includeFullFinalResult =
          args?.verbose === true || args?.include_final_result === true;
        const finalResult = status.final_result ?? null;
        const reviewResult = compactRunStatusReviewResult(status.review_result);
        const terminality = projectManagedTerminality({
          runId: status.run_id,
          lifecycle,
          childTerminal: status.terminal === true,
          advanceInFlight: advance.advance_in_flight
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
        attachSessionContractProjection(accepted, status);
        const attemptLineageResolution = publishAttemptLineageResolution(
          status,
          "workspace_agent_run_status"
        );
        if (attemptLineageResolution !== null) {
          accepted.attempt_lineage_resolution = attemptLineageResolution;
        }
        if (Array.isArray(status.validation_evidence)) {
          accepted.validation_evidence = status.validation_evidence;
        }
        if (terminality.lifecycle_resolution) {
          accepted.lifecycle_resolution = terminality.lifecycle_resolution;
        }
        if (!terminality.terminal) {
          accepted.next_action = resolveTopLevelNextAction(terminality.lifecycle_resolution);
        }

        const closeoutOutcome = await settleWithinDeadline(buildCloseoutWorkflowContinuation({
          dispatchBackend,
          status,
          lifecycle
        }), deadline);
        if (closeoutOutcome.settled && closeoutOutcome.value !== null) {
          accepted.closeout_continuation = closeoutOutcome.value;
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
            detail: buildDispatchToolExceptionDetail("workspace_agent_run_status", error),

            refusal: routeExceptionRefusal("workspace_agent_run_status")
          })
        );
      }
    }
  );

  registerTool(
    "workspace_agent_run_wait",
    {
      description:
        "Wait for a workspace_agent_dispatch run or a bounded window. For a managed exact-slice worker this advances the trusted post-worker lifecycle and is not read-only. terminal:true means the complete managed run is finalized; child_terminal means only that the child ended. Omit timeout_ms for the 60000 ms default. A timed-out call does not fail or cancel the run; retry with the same monitor_handle and never relaunch merely because the wait expired. lifecycle_resolution and next_action identify any caller action. Bounds: timeout_ms [1,300000], poll_interval_ms [500,60000] default 5000; both require integers. Caller identity carriers are refused with the monitor_handle_* taxonomy. Terminal output is compact unless verbose or include_final_result is true. Reviewer/redteam text remains usable despite schema diagnostics; requested formal attestation is settled in the same result.",
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
              detail: identityRefusal,
              refusal: invalidArgumentRefusal(
                "workspace_agent_run_wait",
                "request.caller_supplied_identity_present",
                true,
                DISPATCH_BLOCKER_CODES.CALLER_SUPPLIED_IDENTITY
              )
            })
          );
        }

        const workspace = resolveWorkspaceRepo(workspaceRepos, args?.repo);

        const timeoutMs = args?.timeout_ms ?? MONITOR_CALL_DEFAULT_TIMEOUT_MS;
        const pollIntervalMs = args?.poll_interval_ms ?? 5000;

        if (!Number.isInteger(timeoutMs) ||
            timeoutMs < RUN_WAIT_TIMEOUT_MS_BOUNDS.min ||
            timeoutMs > RUN_WAIT_TIMEOUT_MS_BOUNDS.max) {
          return jsonContent(
            buildBlockedRunWaitResult({
              blockerCode: DISPATCH_BLOCKER_CODES.VALIDATION_FAILURE,
              reason: "timeout_ms_out_of_range",
              refusal: invalidArgumentRefusal(
                "workspace_agent_run_wait",
                "request.timeout_ms_within_range",
                false
              ),
              detail: {
                timeout_ms: timeoutMs,
                valid_range: [RUN_WAIT_TIMEOUT_MS_BOUNDS.min, RUN_WAIT_TIMEOUT_MS_BOUNDS.max],
                message: `timeout_ms must be an integer in [${RUN_WAIT_TIMEOUT_MS_BOUNDS.min}, ${RUN_WAIT_TIMEOUT_MS_BOUNDS.max}]`
              }
            })
          );
        }
        if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 500 || pollIntervalMs > 60000) {
          return jsonContent(
            buildBlockedRunWaitResult({
              blockerCode: DISPATCH_BLOCKER_CODES.VALIDATION_FAILURE,
              reason: "poll_interval_ms_out_of_range",
              refusal: invalidArgumentRefusal(
                "workspace_agent_run_wait",
                "request.poll_interval_ms_within_range",
                false
              ),
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
              detail: null,
              refusal: unknownHandleRefusal(lookup.blocker_code, "workspace_agent_run_wait")
            })
          );
        }

        const deadline = createCallDeadline(timeoutMs);

        const waitOutcome = await settleWithinDeadline(dispatchBackend.waitForRunStatus({
          caller_session_id: dispatchSessionIdentity,
          monitor_handle: args.monitor_handle,
          subject: args.subject ?? null,
          timeout_ms: timeoutMs,
          poll_interval_ms: pollIntervalMs
        }), deadline, { graceMs: BACKEND_SETTLE_GRACE_MS });
        if (!waitOutcome.settled) {
          return jsonContent(buildBlockedRunWaitResult(
            unresponsiveBackendRefusal("run_wait_backend_unresponsive", timeoutMs, {
              route: "workspace_agent_run_wait",
              monitorHandle: args.monitor_handle
            })
          ));
        }
        let waitResult = waitOutcome.value;

        let recoveredLifecycle = null;
        if (!waitResult || waitResult.accepted !== true) {
          const refusal = waitResult?.refusal ?? {};
          const recoveryOutcome = await settleWithinDeadline(
            attemptUnknownHandleRecovery(workspace, args, refusal), deadline
          );
          if (!recoveryOutcome.settled) {
            return jsonContent(buildBlockedRunWaitResult(
              unresponsiveRecoveryRefusal(refusal, timeoutMs, {
              route: "workspace_agent_run_wait",
              monitorHandle: args.monitor_handle
            })
            ));
          }
          const recovered = recoveryOutcome.value;
          if (recovered?.status?.accepted === true &&
              Object.prototype.hasOwnProperty.call(recovered, "lifecycle")) {
            waitResult = recovered.status;
            recoveredLifecycle = recovered.lifecycle;
          } else {
            return jsonContent(
              buildBlockedRunWaitResult(
                resolveRecoveryRefusal(recovered, refusal, "run_wait_backend_refused", {
                  route: "workspace_agent_run_wait"
                })
              )
            );
          }
        }

        if (waitResult?.terminal === true &&
            (waitResult.role === "reviewer" || waitResult.role === "redteam") &&
            publishAttemptLineageResolution(
              waitResult,
              "workspace_agent_run_wait"
            ) === null) {
          const lineageOutcome = await settleWithinDeadline(dispatchBackend.getRunStatus({
            caller_session_id: dispatchSessionIdentity,
            monitor_handle: args.monitor_handle,
            subject: args.subject ?? null
          }), deadline);
          const lineageStatus = lineageOutcome.settled ? lineageOutcome.value : null;
          if (lineageStatus?.accepted === true &&
              lineageStatus.run_id === waitResult.run_id &&
              lineageStatus.monitor_handle === waitResult.monitor_handle &&
              lineageStatus.status === waitResult.status &&
              publishAttemptLineageResolution(
                lineageStatus,
                "workspace_agent_run_wait"
              ) !== null) {
            waitResult = Object.freeze({
              ...waitResult,
              attempt_lineage_resolution: lineageStatus.attempt_lineage_resolution
            });
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
          attachSessionContractProjection(timeout, source);
          if (Array.isArray(source.validation_evidence)) {
            timeout.validation_evidence = source.validation_evidence;
          }
          if (resolution) timeout.lifecycle_resolution = resolution;
          const attemptLineageResolution = publishAttemptLineageResolution(
            source,
            "workspace_agent_run_wait"
          );
          if (attemptLineageResolution !== null) {
            timeout.attempt_lineage_resolution = attemptLineageResolution;
          }
          const publishable = publishableLifecycleFailure(lifecycle);
          if (publishable) timeout.slice_lifecycle = publishable;
          return jsonContent(omitNullFields(timeout));
        };

        if (waitResult.timed_out) {

          return buildWaitTimeout(waitResult, false, null);
        }

        const childTerminal = waitResult.terminal === true;
        let advance = recoveredLifecycle === null
          ? await advanceManagedSliceLifecycle(workspace, waitResult, deadline)
          : settledAdvance(recoveredLifecycle);

        let lifecycle = advance.lifecycle;
        let terminality = projectManagedTerminality({
          runId: waitResult.run_id,
          lifecycle,
          childTerminal,
          advanceInFlight: advance.advance_in_flight
        });

        while (recoveredLifecycle === null &&
               !terminality.terminal &&
               terminality.lifecycle_resolution !== null &&
               !lifecycleResolutionRequiresExternalAction(terminality.lifecycle_resolution)) {
          const remainingMs = deadline.remainingMs();
          if (remainingMs <= 0) {

            return buildWaitTimeout(
              waitResult, childTerminal, terminality.lifecycle_resolution, lifecycle
            );
          }
          const sleepMs = Math.min(pollIntervalMs, remainingMs);
          await sleep(sleepMs);

          if (sleepMs === remainingMs) {
            return buildWaitTimeout(
              waitResult, childTerminal, terminality.lifecycle_resolution, lifecycle
            );
          }
          advance = await advanceManagedSliceLifecycle(workspace, waitResult, deadline);
          if (advance.lifecycle !== null) lifecycle = advance.lifecycle;
          terminality = projectManagedTerminality({
            runId: waitResult.run_id,
            lifecycle,
            childTerminal,
            advanceInFlight: advance.advance_in_flight
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
        attachSessionContractProjection(accepted, waitResult);
        const attemptLineageResolution = publishAttemptLineageResolution(
          waitResult,
          "workspace_agent_run_wait"
        );
        if (attemptLineageResolution !== null) {
          accepted.attempt_lineage_resolution = attemptLineageResolution;
        }
        if (Array.isArray(waitResult.validation_evidence)) {
          accepted.validation_evidence = waitResult.validation_evidence;
        }
        if (terminality.lifecycle_resolution) {
          accepted.lifecycle_resolution = terminality.lifecycle_resolution;
        }
        if (!terminality.terminal) {
          accepted.next_action = resolveTopLevelNextAction(terminality.lifecycle_resolution);
        }

        const closeoutOutcome = await settleWithinDeadline(buildCloseoutWorkflowContinuation({
          dispatchBackend,
          status: waitResult,
          lifecycle
        }), deadline);
        if (closeoutOutcome.settled && closeoutOutcome.value !== null) {
          accepted.closeout_continuation = closeoutOutcome.value;
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
            detail: buildDispatchToolExceptionDetail("workspace_agent_run_wait", error),
            refusal: routeExceptionRefusal("workspace_agent_run_wait")
          })
        );
      }
    }
  );
}
