

import {
  BACKEND_REFUSAL_CODES
} from "@agent-chassis/agent-launch-core";

import { dispatchRefusal } from "./workspace-agent-dispatch-refusal.mjs";
import { resolveWorkerSourceAccess } from "./workspace-agent-dispatch-source-access.mjs";
import { bindReviewerValidationEvidence } from "./terminal-wk-candidate-validation.mjs";

import { resolveLaunchSelection } from "./workspace-agent-dispatch-run-lifecycle-selection.mjs";
import {
  isPlainObject,
  discardPendingManagedRunIdentity,
  finalizeLaunchOutcome
} from "./workspace-agent-dispatch-run-lifecycle-settlement.mjs";

export const MANAGED_RUN_IDENTITY_ENFORCEMENT_UNAVAILABLE =
  "managed_run_identity_enforcement_unavailable";

const MANAGED_CORRECTIVE_CONTINUATION_CODE =
  "agent_launch.managed_run.corrective_integrated_state_unresolved.v1";
const MANAGED_CORRECTIVE_REVIEWED_TARGET_MISMATCH_CODE =
  "agent_launch.managed_run.corrective_reviewed_target_mismatch.v1";
const MANAGED_CORRECTIVE_RECEIPTS_CONTRADICTORY_CODE =
  "agent_launch.managed_run.corrective_receipts_contradictory.v1";
const CANONICAL_INTEGRATED_STATE_IMPOSSIBLE_CODE =
  "agent_launch.canonical_integrated_lifecycle_state.impossible.v1";
const CANONICAL_STATUS_VALUES = Object.freeze([
  "todo", "active", "blocked", "review", "done"
]);
const RECOVERY_KIND =
  "agent_launch.managed_run.corrective_status_reconciliation.v1";
const GENERIC_MANAGED_IDENTITY_CHECK_MESSAGE =
  "managed identity check failed";

function isClosedStatus(value) {
  return typeof value === "string" && CANONICAL_STATUS_VALUES.includes(value);
}

function isCanonicalId(value, prefix) {
  return typeof value === "string" && new RegExp(`^${prefix}-\\d+$`, "u").test(value);
}

function hasExactKeys(object, keys) {
  const actual = Object.keys(object).sort();
  return actual.length === keys.length && keys.every((key, index) => actual[index] === key);
}

function projectObservedCanonicalStatus(source) {
  const observed = source?.observed_canonical_status;
  if (observed === null || typeof observed !== "object" || Array.isArray(observed)) return null;
  if (!hasExactKeys(observed, ["parent_status", "record_id", "slice_id", "slice_status"])) {
    return null;
  }
  if (!isCanonicalId(observed.record_id, "WK") ||
      !isCanonicalId(observed.slice_id, "SLICE") ||
      !isClosedStatus(observed.parent_status) ||
      !isClosedStatus(observed.slice_status)) return null;
  return Object.freeze({
    record_id: observed.record_id,
    slice_id: observed.slice_id,
    parent_status: observed.parent_status,
    slice_status: observed.slice_status
  });
}

function projectRecovery(source, observed) {
  const recovery = source?.recovery;
  if (recovery === null || typeof recovery !== "object" || Array.isArray(recovery)) return null;
  if (!hasExactKeys(recovery, [
    "expected", "next_action", "observed", "recovery_kind", "responsible_actor", "slice_unit", "unit"
  ])) return null;
  const observedTuple = recovery.observed;
  const expectedTuple = recovery.expected;
  if (observedTuple === null || typeof observedTuple !== "object" || Array.isArray(observedTuple) ||
      expectedTuple === null || typeof expectedTuple !== "object" || Array.isArray(expectedTuple) ||
      !hasExactKeys(observedTuple, ["parent_status", "slice_status"]) ||
      !hasExactKeys(expectedTuple, ["parent_status", "slice_status"]) ||
      recovery.recovery_kind !== RECOVERY_KIND ||
      recovery.responsible_actor !== "coordinator" ||
      recovery.next_action !== "reissue_subject_dispatch_after_canonical_status_reconciliation" ||
      recovery.unit !== observed.record_id ||
      recovery.slice_unit !== `${observed.record_id}#${observed.slice_id}` ||
      observedTuple.parent_status !== observed.parent_status ||
      observedTuple.slice_status !== observed.slice_status ||
      expectedTuple.parent_status !== "active" ||
      expectedTuple.slice_status !== "todo") return null;
  return Object.freeze({
    recovery_kind: RECOVERY_KIND,
    observed: Object.freeze({
      parent_status: observedTuple.parent_status,
      slice_status: observedTuple.slice_status
    }),
    expected: Object.freeze({
      parent_status: expectedTuple.parent_status,
      slice_status: expectedTuple.slice_status
    }),
    unit: recovery.unit,
    slice_unit: recovery.slice_unit,
    responsible_actor: "coordinator",
    next_action: "reissue_subject_dispatch_after_canonical_status_reconciliation"
  });
}

export function projectManagedIdentityCheckFailure(error) {
  const detail = { message: GENERIC_MANAGED_IDENTITY_CHECK_MESSAGE };
  let source;
  try {
    source = error?.detail ?? null;
    if (source === null || typeof source !== "object" || Array.isArray(source) ||
        (error?.code !== MANAGED_CORRECTIVE_CONTINUATION_CODE &&
          error?.code !== MANAGED_CORRECTIVE_REVIEWED_TARGET_MISMATCH_CODE &&
          error?.code !== MANAGED_CORRECTIVE_RECEIPTS_CONTRADICTORY_CODE)) {
      return Object.freeze(detail);
    }

    if (error.code === MANAGED_CORRECTIVE_REVIEWED_TARGET_MISMATCH_CODE ||
        error.code === MANAGED_CORRECTIVE_RECEIPTS_CONTRADICTORY_CODE) {
      return Object.freeze({ message: GENERIC_MANAGED_IDENTITY_CHECK_MESSAGE, code: error.code });
    }
    if (source.cause_code !== CANONICAL_INTEGRATED_STATE_IMPOSSIBLE_CODE) {
      return Object.freeze(detail);
    }
    const observed = projectObservedCanonicalStatus(source);
    if (observed === null) return Object.freeze(detail);
    detail.code = MANAGED_CORRECTIVE_CONTINUATION_CODE;
    detail.cause_code = CANONICAL_INTEGRATED_STATE_IMPOSSIBLE_CODE;
    detail.observed_canonical_status = observed;
    const recovery = projectRecovery(source, observed);

    const actionable = observed.parent_status === "todo" && observed.slice_status === "todo";
    if (recovery === null &&
        (Object.hasOwn(source, "recovery") || actionable)) {
      return Object.freeze({ message: GENERIC_MANAGED_IDENTITY_CHECK_MESSAGE });
    }
    if (recovery !== null) detail.recovery = recovery;
  } catch {
    return Object.freeze({ message: GENERIC_MANAGED_IDENTITY_CHECK_MESSAGE });
  }
  return Object.freeze(detail);
}

export function createLaunchFlow(deps = {}) {
  const {
    executors,
    executorRegistryEntries,
    familyAwareWiring,
    runs,
    clock,
    runIdFactory,
    monitorHandleFactory,
    evaluateWorkerAdmission = null,

    freezeWorkerScopeSnapshot = null,
    validateWorkerScopeSnapshot = null,

    deriveReviewerLaunchIdentity = null,

    proveAssignedSourceReadable = null,
    captureSliceReviewTerminalResult = null,
    resolveCorrectiveFindingsContext = null,

    managedWorkerIdentityRequired = false,
    managedRunIdentityRootPresent = false,
    checkPriorManagedAttempt = null,
    publishPendingManagedRunIdentity = null,
    bindManagedRunOuterIdentity = null,

    releaseManagedRunSubjectReservationForLaunch = null,

    verifyTerminalReviewAttemptContractAtSpawn = null
  } = deps;

  const managedWorkerRequiresIdentityReconciliation = (role) =>
    role === "worker" && managedWorkerIdentityRequired === true;

  function assertManagedWorkerIdentityEnforceable(role, subject) {
    if (!managedWorkerRequiresIdentityReconciliation(role)) return null;
    const missing = [];
    if (managedRunIdentityRootPresent !== true) missing.push("managed_run_identity_root");
    if (typeof checkPriorManagedAttempt !== "function") missing.push("prior_attempt_resolver");
    if (typeof publishPendingManagedRunIdentity !== "function") missing.push("pending_identity_publisher");
    if (typeof bindManagedRunOuterIdentity !== "function") missing.push("outer_identity_binder");
    if (missing.length === 0) return null;
    return dispatchRefusal(
      BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
      MANAGED_RUN_IDENTITY_ENFORCEMENT_UNAVAILABLE,
      {
        subject,
        role,
        missing_dependencies: Object.freeze([...missing]),
        remediation: "compose the managed dispatch backend with a resolved managed-run identity root"
      }
    );
  }

  async function startLaunch(input = {}) {
    const reservationHolder = { reservation: null, retain: false, subject: null };
    let result;
    try {
      result = await startLaunchWithSubjectReservation(input, reservationHolder);
    } catch (error) {
      await releaseSubjectReservation(reservationHolder);
      throw error;
    }
    if (result?.accepted !== true) await releaseSubjectReservation(reservationHolder);
    return result;
  }

  async function releaseSubjectReservation(holder) {
    if (holder.reservation === null || holder.retain === true) return;
    const reservation = holder.reservation;
    holder.reservation = null;
    if (typeof releaseManagedRunSubjectReservationForLaunch !== "function") return;
    try {
      await releaseManagedRunSubjectReservationForLaunch(reservation);
    } catch {

    }
  }

  async function startLaunchWithSubjectReservation(input = {}, reservationHolder = { reservation: null }) {
    const {
      caller_session_id = null,
      role = null,
      subject = null,
      workspace_alias = null,
      workspace_dir = null,

      config_root_dir = null,

      trusted_frozen_review_contract = null,

      trusted_terminal_review_attempt_contract = null,

      reviewer_dependency_binds = null,
      readiness = null,
      app: requestedApp = null,

      model: requestedModel = null
    } = input;

    const selection = resolveLaunchSelection({
      role,
      subject,
      caller_session_id,
      app: requestedApp,
      model: requestedModel,
      workspace_dir,
      config_root_dir,
      executors,
      executorRegistryEntries,
      familyAwareWiring
    });
    if (!selection.ok) return selection.refusal;
    const {
      app,
      resolvedModel,
      resolvedBackend,
      familyExecutor,
      familyExecutorRegistryEntry
    } = selection;

    const identityEnforcementRefusal = assertManagedWorkerIdentityEnforceable(role, subject);
    if (identityEnforcementRefusal) return identityEnforcementRefusal;

    let authenticatedCorrectiveFindingsContext = null;

    if (role === "worker" && typeof checkPriorManagedAttempt === "function") {
      let priorAttempt;
      try {
        priorAttempt = await checkPriorManagedAttempt({ role, subject });
      } catch (error) {
        return dispatchRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
          "managed_run_identity_check_threw",
          projectManagedIdentityCheckFailure(error)
        );
      }
      if (!priorAttempt || typeof priorAttempt !== "object") {
        return dispatchRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
          "managed_run_identity_check_no_result",
          null
        );
      }
      if (priorAttempt.may_launch !== true) {

        const priorTuple = priorAttempt.tuple ?? null;
        const committedReview = priorAttempt.committed_review_continuation === true;
        const continuation = priorTuple !== null
          ? Object.freeze({
              kind: committedReview ? "committed_review" : priorAttempt.verdict,
              subject,
              run_id: priorTuple.run_id ?? null,
              monitor_handle: priorTuple.launch_ref ?? null,

              next_action: committedReview
                ? "dispatch_reviewer_for_committed_slice"
                : "reissue_subject_dispatch_when_current_attempt_settles"
            })
          : null;
        return dispatchRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
          `managed_run_prior_attempt_${priorAttempt.verdict}`,
          {
            subject,
            verdict: priorAttempt.verdict ?? null,
            verdict_reason: priorAttempt.reason ?? null,
            liveness: priorAttempt.liveness ?? null,
            prior_tuple: priorTuple,

            continuation,

            reservation_holder: priorAttempt.holder ?? null,

            recovery_route: committedReview
              ? (priorAttempt.review_route ?? "workspace_agent_dispatch(role=reviewer)")
              : "workspace_agent_dispatch"
          }
        );
      }

      reservationHolder.subject = subject;
      reservationHolder.reservation = priorAttempt.reservation ?? null;

      authenticatedCorrectiveFindingsContext =
        priorAttempt.trusted_corrective_findings_context ?? null;
    }

    let frozenWorkerScopeSnapshot = null;
    if (role === "worker" && typeof freezeWorkerScopeSnapshot === "function") {
      let freezeResult;
      try {
        freezeResult = await freezeWorkerScopeSnapshot({
          input,
          app,
          role,
          subject,
          workspace_dir: workspace_dir ?? null
        });
      } catch (error) {
        return dispatchRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
          "worker_scope_snapshot_freeze_threw",
          { message: error?.message ?? String(error) }
        );
      }
      if (!freezeResult?.ok) {
        const refusal = freezeResult?.refusal ?? {};
        return dispatchRefusal(
          refusal.code ?? BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
          refusal.reason ?? "worker_scope_snapshot_freeze_failed",
          refusal.detail ?? null
        );
      }
      frozenWorkerScopeSnapshot = freezeResult.snapshot ?? null;
    }

    const validateFrozenWorkerScope = async (consumer, result = null) => {
      if (frozenWorkerScopeSnapshot === null || typeof validateWorkerScopeSnapshot !== "function") {
        return null;
      }
      let validation;
      try {
        validation = await validateWorkerScopeSnapshot({
          snapshot: frozenWorkerScopeSnapshot,
          consumer,
          result
        });
      } catch (error) {
        return dispatchRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
          "worker_scope_snapshot_validation_threw",
          { consumer, message: error?.message ?? String(error) }
        );
      }
      if (validation?.ok) return null;
      const refusal = validation?.refusal ?? {};
      return dispatchRefusal(
        refusal.code ?? BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
        refusal.reason ?? "worker_scope_snapshot_validation_failed",
        refusal.detail ?? { consumer }
      );
    };

    let workerAdmissionDiagnostic = null;
    if (role === "worker" && typeof evaluateWorkerAdmission === "function") {
      let admissionOutcome;
      try {
        admissionOutcome = await evaluateWorkerAdmission({
          workspaceDir: workspace_dir ?? null,
          subject,

          canonical_work_record: frozenWorkerScopeSnapshot?.record ?? null,
          canonical_selected_unit: frozenWorkerScopeSnapshot?.selected_unit_contract ?? null,
          source_record_digest: frozenWorkerScopeSnapshot?.authority?.source_digest ?? null,
          worker_scope_authority: frozenWorkerScopeSnapshot?.authority ?? null
        });
      } catch (error) {
        return dispatchRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
          "worker_admission_threw",
          { message: error?.message ?? String(error) }
        );
      }
      if (!admissionOutcome || typeof admissionOutcome !== "object") {
        return dispatchRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
          "worker_admission_no_result",
          null
        );
      }
      const admissionSnapshotRefusal = await validateFrozenWorkerScope(
        "worker_admission",
        admissionOutcome
      );
      if (admissionSnapshotRefusal) return admissionSnapshotRefusal;
      if (!admissionOutcome.allowed) {

        const refusalDetail = admissionOutcome.remote_admission
          ? { ...(admissionOutcome.detail ?? {}), remote_admission: admissionOutcome.remote_admission }
          : (admissionOutcome.detail ?? null);
        return dispatchRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
          admissionOutcome.reason ?? "worker_admission_refused",
          refusalDetail
        );
      }
      workerAdmissionDiagnostic = admissionOutcome.remote_admission ?? null;
    }

    const sourceAccessResult = await resolveWorkerSourceAccess({
      app,
      role,
      subject,
      workspace_dir,
      familyExecutorRegistryEntry,
      proveAssignedSourceReadable,

      scopeExistence: frozenWorkerScopeSnapshot?.scope_existence ?? null
    });
    if (!sourceAccessResult.ok) {
      return dispatchRefusal(
        sourceAccessResult.refusal.code,
        sourceAccessResult.refusal.reason,
        sourceAccessResult.refusal.detail
      );
    }
    const sourceSnapshotRefusal = await validateFrozenWorkerScope(
      "source_preparation",
      sourceAccessResult
    );
    if (sourceSnapshotRefusal) return sourceSnapshotRefusal;

    const reviewerLaunchIdentity = typeof deriveReviewerLaunchIdentity === "function"
      ? deriveReviewerLaunchIdentity({ role, subject, workspace_dir })
      : null;

    const correctiveFindingsContext = (role === "worker" &&
        typeof resolveCorrectiveFindingsContext === "function"
      ? await resolveCorrectiveFindingsContext({ subject, workspace_dir })
      : null) ?? authenticatedCorrectiveFindingsContext;
    const executorReadiness = isPlainObject(readiness)
      ? { ...readiness }
      : readiness;
    if (isPlainObject(executorReadiness)) {
      delete executorReadiness.trusted_corrective_findings_context;
      delete executorReadiness.config_root_dir;
      delete executorReadiness.trusted_frozen_review_contract;
      if (role === "worker" && correctiveFindingsContext !== null) {
        executorReadiness.trusted_corrective_findings_context = correctiveFindingsContext;
      }
      if (role === "reviewer" && typeof config_root_dir === "string" &&
          trusted_frozen_review_contract !== null) {
        executorReadiness.config_root_dir = config_root_dir;
        executorReadiness.trusted_frozen_review_contract = trusted_frozen_review_contract;
      }
    }

    const run_id = runIdFactory();
    const monitor_handle = monitorHandleFactory();
    const startedAtMs = clock();
    const startedAt = new Date(startedAtMs).toISOString();

    let reviewerValidationEvidence = null;
    if (role === "reviewer" && Array.isArray(executorReadiness?.reviewer_validation_evidence) &&
        executorReadiness.reviewer_validation_evidence.length > 0) {
      const target = executorReadiness.frozen_terminal_candidate_review_target ?? null;
      reviewerValidationEvidence = bindReviewerValidationEvidence(
        executorReadiness.reviewer_validation_evidence,
        {
          reviewerRunId: run_id,
          subject,
          reviewedSha: target?.candidate_sha ?? null,
          diffBaseSha: target?.base_sha ?? null
        }
      );
      executorReadiness.reviewer_validation_evidence = reviewerValidationEvidence;
    }

    const executorSnapshotRefusal = await validateFrozenWorkerScope("executor_planning");
    if (executorSnapshotRefusal) return executorSnapshotRefusal;

    let pendingManagedRunIdentity = null;
    if (role === "worker" && typeof publishPendingManagedRunIdentity === "function") {
      try {
        pendingManagedRunIdentity = await publishPendingManagedRunIdentity({
          role,
          subject,
          run_id,
          monitor_handle,

          reservation: reservationHolder.reservation
        });
      } catch (error) {
        return dispatchRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
          "managed_run_identity_publication_failed",
          { subject, code: error?.code ?? null, message: error?.message ?? String(error) }
        );
      }
      if (pendingManagedRunIdentity === null || pendingManagedRunIdentity === undefined) {
        return dispatchRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
          "managed_run_identity_publication_incomplete",
          { subject }
        );
      }
    }

    let terminalReviewSpawnBarrier = null;
    if (trusted_terminal_review_attempt_contract !== null &&
        trusted_terminal_review_attempt_contract !== undefined) {
      if (typeof verifyTerminalReviewAttemptContractAtSpawn !== "function") {
        return dispatchRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
          "terminal_review_attempt_contract_verifier_unavailable",
          { subject, role }
        );
      }
      terminalReviewSpawnBarrier = () => verifyTerminalReviewAttemptContractAtSpawn(
        trusted_terminal_review_attempt_contract
      );
      const earlyVerdict = terminalReviewSpawnBarrier();
      if (earlyVerdict?.ok !== true) {
        return dispatchRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
          earlyVerdict?.reason ?? "terminal_review_attempt_contract_recheck_failed",
          { subject, role, ...(earlyVerdict?.detail ?? {}) }
        );
      }
    }

    let executorResult;
    try {
      executorResult = await familyExecutor({
        caller_session_id,
        role,
        subject,
        workspace_alias: workspace_alias ?? null,
        workspace_dir: workspace_dir ?? null,
        readiness: executorReadiness ?? null,
        run_id,
        monitor_handle,
        app,

        model: resolvedModel,
        backend: resolvedBackend,

        frozen_worker_scope_snapshot: frozenWorkerScopeSnapshot,

        config_root_dir: role === "reviewer" ? (config_root_dir ?? null) : null,
        trusted_frozen_review_contract:
          role === "reviewer" ? (trusted_frozen_review_contract ?? null) : null,
        reviewer_dependency_binds:
          role === "reviewer" && Array.isArray(reviewer_dependency_binds)
            ? reviewer_dependency_binds
            : null,

        terminal_review_spawn_barrier: terminalReviewSpawnBarrier,
      });
    } catch (error) {
      const cleanupRefusal = await discardPendingManagedRunIdentity({
        pending: pendingManagedRunIdentity,
        reservationHolder,
        releaseSubjectReservation,
        subject,
        reason: "launch_executor_threw"
      });
      return cleanupRefusal ?? dispatchRefusal(
        BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
        "launch_executor_threw",
        { message: error?.message ?? String(error) }
      );
    }

    return finalizeLaunchOutcome({
      executorResult,
      pendingManagedRunIdentity,
      reservationHolder,
      releaseSubjectReservation,
      bindManagedRunOuterIdentity,
      runs,
      captureSliceReviewTerminalResult,
      run_id,
      monitor_handle,
      app,
      resolvedModel,
      resolvedBackend,
      role,
      subject,
      workspace_alias,
      caller_session_id,
      startedAt,
      reviewerValidationEvidence,
      reviewerLaunchIdentity,
      workerAdmissionDiagnostic
    });
  }

  return { startLaunch };
}
