

import path from "node:path";
import { EXACT_IMPLEMENTATION_SLICE_RE } from "./backend-constants.mjs";
import {
  resolveCanonicalSliceReviewUnit,
  SLICE_REVIEW_AUTHORITY_REASONS
} from "./backend-scope-authority.mjs";
import {
  resolveUniqueManagedLifecycleBindingPairForRecovery
} from "./worktree-substrate-identity.mjs";
import { readManagedRunObservation } from "./managed-run-process-identity-store.mjs";
import {
  deriveManagedRunIdentityTupleFromBindingPair,
  sameTuple
} from "./managed-run-process-identity-contract.mjs";
import { captureDiagnosticEvidence } from "./diagnostic-evidence.mjs";
import {
  isWorkspaceAgentResultModeEnvelope
} from "./workspace-agent-dispatch-result-mode.mjs";

import {
  RECOVERED_CHILD_OUTCOME_STATES,
  recoveredChildOutcomeForResultMode
} from "../../../agent-launch-core/src/lib/dispatch-runtime.mjs";

const RECOVERED_LIFECYCLE_CONTROLS = Object.freeze({

  INTEGRATED_REPLAY: Object.freeze({ status: "succeeded", terminal: true }),

  RESERVATION_BINDING_INDETERMINATE: Object.freeze({
    status: "launching",
    terminal: false
  })
});

function projectRecoveredChildOutcome(outcome) {
  return Object.freeze({
    status: outcome.state === RECOVERED_CHILD_OUTCOME_STATES.UNAVAILABLE
      ? null
      : outcome.state,
    terminal: true,
    child_outcome: outcome
  });
}

function retainedChildOutcome(result) {
  const carried = result !== null && typeof result === "object" &&
    !Array.isArray(result) && Object.hasOwn(result, "result_mode")
    ? result.result_mode
    : null;
  if (carried === null || carried === undefined) {
    return recoveredChildOutcomeForResultMode({ present: false });
  }
  return recoveredChildOutcomeForResultMode({
    present: true,
    mode: isWorkspaceAgentResultModeEnvelope(carried) ? carried.mode : null
  });
}

function recoveredRunStatus({
  runId,
  monitorHandle,
  subject,
  control = null,
  outcome = null,
  finalResult = null,
  finalResultDurability = null,
  observationState = null
}) {
  if ((control === null) === (outcome === null)) {
    throw new TypeError(
      "a recovered run status carries exactly one of a synthetic lifecycle " +
      "control or a derived child outcome"
    );
  }
  const projected = control === null
    ? projectRecoveredChildOutcome(outcome)
    : control;
  return Object.freeze({
    accepted: true,
    recovered: true,
    run_id: runId,
    monitor_handle: monitorHandle,
    app: null,
    role: "worker",
    subject,
    status: projected.status,
    terminal: projected.terminal,

    started_at: null,
    updated_at: null,
    exit: null,
    final_result: finalResult,
    ...(projected.child_outcome === undefined
      ? {}
      : { child_outcome: projected.child_outcome }),
    ...(finalResultDurability === null
      ? {}
      : { final_result_durability: finalResultDurability }),
    ...(observationState === null ? {} : { observation_state: observationState })
  });
}

export function createBackendRecovery(ctx) {
  const {
    postWorkerSliceLifecycle,
    worktreeProvisioningConfig,
    recoveredIntegratedRuns
  } = ctx;

  const resolveCommittedSliceIntegrationContinuation =
    typeof ctx.resolveCommittedSliceIntegrationContinuation === "function"
      ? (args) => ctx.resolveCommittedSliceIntegrationContinuation(args)
      : null;
  const resolveManagedWorkerProvenDeath = (args) => ctx.resolveManagedWorkerProvenDeath(args);
  const retireManagedWorkerIdentity = (args) => ctx.retireManagedWorkerIdentity(args);

  const recoverIntegratedWorkerRunInternal = async ({
    workspace,
    monitor_handle,
    subject,
    allowMissingSliceWorktree = false
  } = {}) => {
    if (postWorkerSliceLifecycle === null || !worktreeProvisioningConfig ||
        !workspace || path.resolve(workspace.dir ?? "") !== worktreeProvisioningConfig.mainRepo ||
        typeof monitor_handle !== "string" || typeof subject !== "string" ||
        !EXACT_IMPLEMENTATION_SLICE_RE.test(subject)) {
      return null;
    }

    try {
      resolveCanonicalSliceReviewUnit(worktreeProvisioningConfig.mainRepo, subject);
      return null;
    } catch {

    }
    const key = JSON.stringify([monitor_handle, subject, allowMissingSliceWorktree]);
    if (!recoveredIntegratedRuns.has(key)) {
      const recovery = (async () => {
        try {
          const pair = resolveUniqueManagedLifecycleBindingPairForRecovery({
            mainRepo: worktreeProvisioningConfig.mainRepo,
            launchRef: monitor_handle,
            expectedSubject: subject,
            allowMissingSliceWorktree
          });
          if (!pair) return null;

          const status = recoveredRunStatus({
            runId: pair.run_id,
            monitorHandle: monitor_handle,
            subject,
            control: RECOVERED_LIFECYCLE_CONTROLS.INTEGRATED_REPLAY
          });

          const lifecycleResult = await postWorkerSliceLifecycle({
            workspace,
            status,
            deps: {
              resolveManagedRunBinding: () => pair.provisioning,

              ...(resolveCommittedSliceIntegrationContinuation === null
                ? {}
                : { resolveCommittedSliceIntegrationContinuation }),

              resolveManagedWorkerProvenDeath,

              retireManagedWorkerIdentity,
              recoveryOnly: true
            }
          });

          const retiredNoCommit =
            lifecycleResult?.phase === "finalized" &&
            lifecycleResult.integrated === false &&
            lifecycleResult.integration === null &&
            lifecycleResult.recovered_from_proven_death === true &&
            lifecycleResult.retired === true &&
            lifecycleResult.retirement_reason === "no_commit_base_equal";
          if (!lifecycleResult ||
              (!retiredNoCommit &&
                (lifecycleResult.phase !== "finalized" ||
                  lifecycleResult.integration?.recovered !== true))) {
            return null;
          }
          return Object.freeze({ status, lifecycle: lifecycleResult });
        } catch (error) {

          return Object.freeze({
            recovery_failure: Object.freeze({
              code: typeof error?.code === "string"
                ? error.code
                : "agent_launch.slice_lifecycle.recovery_failed.v1",
              message: error?.message ?? String(error),
              detail: error?.detail ?? null,
              evidence: captureDiagnosticEvidence(error)
            })
          });
        }
      })();
      recoveredIntegratedRuns.set(key, recovery);
    }
    const pending = recoveredIntegratedRuns.get(key);
    const result = await pending;
    if ((result === null || result.recovery_failure != null ||
        result?.lifecycle?.cleanup_pending === true) &&
        recoveredIntegratedRuns.get(key) === pending) {

      recoveredIntegratedRuns.delete(key);
    }
    return result;
  };

  const recoverIntegratedWorkerRun = (input = {}) =>
    recoverIntegratedWorkerRunInternal({ ...input, allowMissingSliceWorktree: true });

  const isCanonicalNonImplementationSlice = (subject) => {
    try {
      resolveCanonicalSliceReviewUnit(worktreeProvisioningConfig.mainRepo, subject, {
        requireReview: false
      });
      return false;
    } catch (error) {
      return error?.detail?.refusal_reason ===
        SLICE_REVIEW_AUTHORITY_REASONS.SLICE_NOT_IMPLEMENTATION;
    }
  };

  const recoverManagedWorkerRun = async ({ workspace, subject, attempt_id = null } = {}) => {
    if (!worktreeProvisioningConfig || !workspace ||
        path.resolve(workspace.dir ?? "") !== worktreeProvisioningConfig.mainRepo ||
        typeof subject !== "string" || !EXACT_IMPLEMENTATION_SLICE_RE.test(subject)) {
      return Object.freeze({ recovery_failure: Object.freeze({
        code: "recovery_unsupported_for_subject",
        message: "cold managed observation supports exact implementation slices only",
        detail: null
      }) });
    }
    const observed = readManagedRunObservation({
      mainRepo: worktreeProvisioningConfig.mainRepo,
      subject,
      attemptId: attempt_id
    });
    if (!observed.ok) {

      const noRetainedExecutionAttempt =
        (observed.code === "attempt_selector_mismatch" ||
          observed.code === "attempt_observation_unavailable") &&
        !(observed.attempts ?? []).some((item) => item.dispatch_tuple !== null);
      if (noRetainedExecutionAttempt && isCanonicalNonImplementationSlice(subject)) {
        return Object.freeze({ recovery_failure: Object.freeze({
          code: "findings_observation_unavailable",
          message: "findings observation is process-local and has no cold recovery",
          detail: null
        }) });
      }
      return observed;
    }
    if (observed.indeterminate || observed.selected?.dispatch_tuple === null) {
      return Object.freeze({
        status: recoveredRunStatus({
          runId: null,
          monitorHandle: null,
          subject,
          control: RECOVERED_LIFECYCLE_CONTROLS.RESERVATION_BINDING_INDETERMINATE,
          observationState: "reservation_binding_indeterminate"
        }),

        lifecycle: undefined
      });
    }
    const tuple = observed.selected.dispatch_tuple;

    const childOutcome = retainedChildOutcome(observed.selected.result);
    const durableResultStatus = (lifecycle) => Object.freeze({
      status: recoveredRunStatus({
        runId: tuple.run_id,
        monitorHandle: tuple.launch_ref,
        subject,
        outcome: childOutcome,
        finalResult: observed.selected.result,
        finalResultDurability: "durable"
      }),
      lifecycle
    });

    if (observed.selected.released && observed.selected.result !== null) {
      return durableResultStatus(null);
    }
    let pair;
    try {
      pair = resolveUniqueManagedLifecycleBindingPairForRecovery({
        mainRepo: worktreeProvisioningConfig.mainRepo,
        launchRef: tuple.launch_ref,
        expectedSubject: subject,
        allowMissingSliceWorktree: true
      });
    } catch (error) {
      return Object.freeze({ recovery_failure: Object.freeze({
        code: error?.code ?? "managed_run_binding_recovery_failed",
        message: error?.message ?? String(error),
        detail: error?.detail ?? null
      }) });
    }

    let pairTuple = null;
    try {
      pairTuple = pair
        ? deriveManagedRunIdentityTupleFromBindingPair({
            assignedUnit: subject,
            launchRef: tuple.launch_ref,
            wkBinding: pair.wk_binding,
            sliceBinding: pair.slice_binding,
            expectedRunId: tuple.run_id
          })
        : null;
    } catch {
      pairTuple = null;
    }
    if (pairTuple === null || !sameTuple(pairTuple, tuple)) {
      return Object.freeze({ recovery_failure: Object.freeze({
        code: "managed_run_binding_mismatch",
        message: "retained binding does not authenticate the selected attempt",
        detail: null
      }) });
    }
    if (observed.selected.result !== null) {

      return durableResultStatus(undefined);
    }
    return await recoverIntegratedWorkerRun({
      workspace,
      monitor_handle: tuple.launch_ref,
      subject
    }) ?? Object.freeze({ recovery_failure: Object.freeze({
      code: "report_unavailable",
      message: "the selected attempt has no durably recorded final report",
      detail: null
    }) });
  };

  return {
    recoverIntegratedWorkerRunInternal,
    recoverIntegratedWorkerRun,
    recoverManagedWorkerRun
  };
}
