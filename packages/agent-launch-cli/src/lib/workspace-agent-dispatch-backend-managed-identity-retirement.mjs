

import {
  assessManagedRunProcessIdentity,
  attachTupleToManagedRunSubjectReservation,
  bindManagedRunSandboxProcessIdentity,
  deriveOuterSandboxKillShape,
  discardManagedRunProcessIdentity,
  MANAGED_RUN_PROCESS_IDENTITY_VERDICTS,
  publishPendingManagedRunProcessIdentity,
  releaseManagedRunSubjectReservation,
  retireManagedRunProcessIdentity
} from "./managed-run-process-identity.mjs";

import {
  retireNoCommitAndReserveSuccessor,
  retireProvenDeadAndReserveSuccessor
} from "./managed-run-subject-reservation.mjs";
import { EXACT_IMPLEMENTATION_SLICE_RE } from "./backend-constants.mjs";
import { resolveCanonicalSliceReviewUnit } from "./backend-scope-authority.mjs";

export function createManagedRunProvenDeathRetirement(ctx, seam) {
  const {
    worktreeProvisioningConfig,
    correctiveContinuationProofs,
    managedRunIdentityRoot,
    managedRunIdentityDeps
  } = ctx;

  const managedRunIdentityTuple = ({ subject, run_id, monitor_handle }) => ({
    assigned_unit: subject,
    launch_ref: monitor_handle,
    run_id,
    retry_id: 0
  });

  function supersedeNoDeliveryProvenDeadAttempt({ subject, priorAttempt }) {
    if (managedRunIdentityRoot === null ||
        priorAttempt?.verdict !== MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.PROVEN_DEAD) {
      return null;
    }
    if (priorAttempt.tuple) {
      const resolved = seam.resolveNoDeliveryRetirementEvidence(subject, priorAttempt.tuple);
      if (resolved === null || resolved.committed === true) return null;
      return retireNoCommitAndReserveSuccessor({
        mainRepo: managedRunIdentityRoot,
        tuple: priorAttempt.tuple,
        subject,
        role: "worker",
        evidence: resolved.evidence,
        ...(managedRunIdentityDeps ? { deps: managedRunIdentityDeps } : {})
      });
    }
    const provenDeadTuples = Array.isArray(priorAttempt.proven_dead_tuples)
      ? priorAttempt.proven_dead_tuples
      : null;
    if (provenDeadTuples === null || provenDeadTuples.length === 0) return null;
    const provenDeadSet = [];
    for (const tuple of provenDeadTuples) {
      const resolved = seam.resolveNoDeliveryRetirementEvidence(subject, tuple);
      if (resolved === null || resolved.committed === true) return null;
      provenDeadSet.push({ tuple, evidence: resolved.evidence });
    }
    return retireProvenDeadAndReserveSuccessor({
      mainRepo: managedRunIdentityRoot,
      subject,
      role: "worker",
      provenDeadSet,
      ...(managedRunIdentityDeps ? { deps: managedRunIdentityDeps } : {})
    });
  }

  function resolveCommittedReviewContinuation(subject, priorAttempt) {
    if (worktreeProvisioningConfig === null ||
        priorAttempt?.verdict !== MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.PROVEN_DEAD ||
        !EXACT_IMPLEMENTATION_SLICE_RE.test(subject ?? "")) {
      return null;
    }
    try {
      resolveCanonicalSliceReviewUnit(worktreeProvisioningConfig.mainRepo, subject);
    } catch {
      return null;
    }
    return Object.freeze({
      ...priorAttempt,
      may_launch: false,
      committed_review_continuation: true,
      reason: "the exact slice was committed and is in canonical review",
      review_route: "workspace_agent_dispatch(role=reviewer)",
      reservation: null
    });
  }

  const releaseManagedRunSubjectReservationForLaunch = managedRunIdentityRoot === null
    ? null
    : (reservation) => {
        const retained = correctiveContinuationProofs.get(reservation?.subject) ?? null;
        if (retained?.reservation_id === reservation?.reservation_id) {
          correctiveContinuationProofs.delete(reservation.subject);
        }
        return releaseManagedRunSubjectReservation({
          mainRepo: managedRunIdentityRoot,
          subject: reservation?.subject,
          reservationId: reservation?.reservation_id ?? null
        });
      };

  const publishPendingManagedRunIdentity = managedRunIdentityRoot === null
    ? null
    : ({ role, subject, run_id, monitor_handle, reservation = null }) => {
        const tuple = managedRunIdentityTuple({ subject, run_id, monitor_handle });
        const pending = publishPendingManagedRunProcessIdentity({
          mainRepo: managedRunIdentityRoot,
          tuple,
          role,
          ...(managedRunIdentityDeps ? { deps: managedRunIdentityDeps } : {})
        });

        if (reservation !== null) {
          attachTupleToManagedRunSubjectReservation({
            mainRepo: managedRunIdentityRoot,
            reservation,
            tuple
          });
        }
        return Object.freeze({
          tuple,
          bind: ({ pid, enforcement }) => bindManagedRunSandboxProcessIdentity(pending, {
            pid,
            killShape: deriveOuterSandboxKillShape({ pid, enforcement }),
            ...(managedRunIdentityDeps ? { deps: managedRunIdentityDeps } : {})
          }),
          discard: () => discardManagedRunProcessIdentity({ mainRepo: managedRunIdentityRoot, tuple })
        });
      };

  const bindManagedRunOuterIdentity = managedRunIdentityRoot === null
    ? null
    : (pending, { pid, enforcement }) => pending.bind({ pid, enforcement });

  const resolveManagedWorkerProvenDeath = ({ assigned_unit, launch_ref, run_id, retry_id }) => {
    if (managedRunIdentityRoot === null) {
      return Object.freeze({
        proven_dead: false,
        verdict: MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.ABSENT,
        reason: "this backend composes no durable managed-run identity store"
      });
    }
    const assessed = assessManagedRunProcessIdentity({
      mainRepo: managedRunIdentityRoot,
      tuple: { assigned_unit, launch_ref, run_id, retry_id },
      ...(managedRunIdentityDeps ? { deps: managedRunIdentityDeps } : {})
    });
    return Object.freeze({
      ...assessed,
      proven_dead: assessed.verdict === MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.PROVEN_DEAD
    });
  };

  const retireManagedWorkerIdentity = ({ assigned_unit, launch_ref, run_id, retry_id, reason, evidence }) => {
    if (managedRunIdentityRoot === null) {
      return Object.freeze({ retired: false, reason: "no durable managed-run identity store" });
    }
    const tuple = { assigned_unit, launch_ref, run_id, retry_id };
    let outcome;
    try {
      outcome = retireManagedRunProcessIdentity({
        mainRepo: managedRunIdentityRoot,
        tuple,
        reason,
        evidence,
        ...(managedRunIdentityDeps ? { deps: managedRunIdentityDeps } : {})
      });
    } catch (error) {

      return Object.freeze({
        retired: false,
        reason: error?.message ?? String(error),
        code: error?.code ?? null
      });
    }
    if (outcome.retired === true) {
      releaseManagedRunSubjectReservation({
        mainRepo: managedRunIdentityRoot,
        subject: assigned_unit,
        tuple
      });
    }
    return outcome;
  };

  return {
    managedRunIdentityTuple,
    supersedeNoDeliveryProvenDeadAttempt,
    resolveCommittedReviewContinuation,
    releaseManagedRunSubjectReservationForLaunch,
    publishPendingManagedRunIdentity,
    bindManagedRunOuterIdentity,
    resolveManagedWorkerProvenDeath,
    retireManagedWorkerIdentity
  };
}
