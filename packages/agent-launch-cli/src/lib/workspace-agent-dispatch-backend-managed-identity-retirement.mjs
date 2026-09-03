

import {
  assessManagedRunProcessIdentity,
  attachTupleToManagedRunSubjectReservation,
  bindManagedRunSandboxProcessIdentity,
  deriveOuterSandboxKillShape,
  discardManagedRunProcessIdentity,
  MANAGED_RUN_PROCESS_IDENTITY_RETIREMENT_REASONS,
  MANAGED_RUN_PROCESS_IDENTITY_VERDICTS,
  publishPendingManagedRunProcessIdentity,
  readManagedRunProcessIdentity,
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
      reason: MANAGED_RUN_PROCESS_IDENTITY_RETIREMENT_REASONS.NO_COMMIT_BASE_EQUAL,
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
    : (reservation) => releaseManagedRunSubjectReservation({
          mainRepo: managedRunIdentityRoot,
          subject: reservation?.subject,
          reservationId: reservation?.reservation_id ?? null
        });

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

  const resolveReviewerAttemptProvenDeath = ({
    assigned_unit, launch_ref, run_id, reviewer_role: reviewerRole
  }) => {
    if (managedRunIdentityRoot === null) {
      return Object.freeze({ proven_dead: false, verdict: "absent",
        reason: "this backend composes no durable managed-run identity store" });
    }
    const tuple = { assigned_unit, launch_ref, run_id, retry_id: 0 };
    const record = readManagedRunProcessIdentity({ mainRepo: managedRunIdentityRoot, tuple });
    if (record === null || record.unreadable === true || record.role !== reviewerRole) {
      return Object.freeze({
        proven_dead: false,
        verdict: record?.unreadable === true ? "unreadable" : record === null ? "absent" : "mismatched",
        reason: record === null
          ? "reviewer process identity evidence is absent"
          : record.unreadable === true
            ? "reviewer process identity evidence is unreadable"
            : "reviewer process identity role is mismatched"
      });
    }
    const assessed = assessManagedRunProcessIdentity({
      mainRepo: managedRunIdentityRoot,
      tuple,
      ...(managedRunIdentityDeps ? { deps: managedRunIdentityDeps } : {})
    });
    if (assessed.verdict !== MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.PROVEN_DEAD) {
      return Object.freeze({ ...assessed, proven_dead: false });
    }
    return Object.freeze({
      ...assessed,
      proven_dead: true,
      process_evidence: Object.freeze({
        schema_version: "launcher-reviewer-process-death-evidence.v1",
        verdict: "proven_dead",
        role: record.role,
        tuple: Object.freeze({ ...tuple }),
        launcher_identity: Object.freeze({ ...record.launcher_identity }),
        published_at: Object.freeze({ ...record.published_at }),
        sandbox_identity: Object.freeze({ ...record.sandbox_identity }),
        kill_shape: Object.freeze({ ...record.kill_shape }),
        liveness: Object.freeze({ ...assessed.liveness })
      })
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
    resolveReviewerAttemptProvenDeath,
    retireManagedWorkerIdentity
  };
}
