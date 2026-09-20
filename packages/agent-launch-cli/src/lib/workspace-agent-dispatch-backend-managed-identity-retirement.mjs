

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
  deriveManagedRunIdentityTupleFromBindingPair,
  fail,
  MANAGED_RUN_PROCESS_IDENTITY_CODES,
  sameTuple
} from "./managed-run-process-identity-contract.mjs";

import {
  retireNoCommitAndReserveSuccessor,
  retireProvenDeadAndReserveSuccessor
} from "./managed-run-subject-reservation.mjs";
import { EXACT_IMPLEMENTATION_SLICE_RE } from "./backend-constants.mjs";
import { resolveCanonicalSliceIntegrationUnit } from "./backend-scope-authority.mjs";

export function createManagedRunProvenDeathRetirement(ctx, seam) {
  const {
    worktreeProvisioningConfig,
    managedRunIdentityRoot,
    managedRunIdentityDeps,
    managedWorktreeProvisioningAuthority = null
  } = ctx;

  const managedRunIdentityTuple = ({ app, subject, run_id, monitor_handle, provisioning_ticket }) => {
    const prepared = managedWorktreeProvisioningAuthority?.resolve?.({
      ticket: provisioning_ticket ?? null,
      input: { subject, run_id, monitor_handle },
      app
    }) ?? null;
    const provisioning = prepared?.provisioning ?? null;
    if (provisioning === null) {
      fail(
        MANAGED_RUN_PROCESS_IDENTITY_CODES.BINDING_MISMATCH,
        "the managed worker execution tuple requires this launch's launcher-private provisioning pair",
        { assigned_unit: subject ?? null, launch_ref: monitor_handle ?? null, run_id: run_id ?? null }
      );
    }
    const tuple = deriveManagedRunIdentityTupleFromBindingPair({
      assignedUnit: subject,
      launchRef: monitor_handle,
      wkBinding: provisioning.wk_binding,
      sliceBinding: provisioning.slice_binding,
      expectedRunId: run_id
    });
    if (tuple.retry_id !== prepared.retry_id) {
      fail(
        MANAGED_RUN_PROCESS_IDENTITY_CODES.BINDING_MISMATCH,
        "the provisioning pair does not carry the prepared attempt's retry id",
        { binding_retry_id: tuple.retry_id, prepared_retry_id: prepared.retry_id ?? null }
      );
    }
    return tuple;
  };

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
      resolveCanonicalSliceIntegrationUnit(worktreeProvisioningConfig.mainRepo, subject);
    } catch {
      return null;
    }
    const tuples = priorAttempt.tuple
      ? [priorAttempt.tuple]
      : Array.isArray(priorAttempt.proven_dead_tuples) ? priorAttempt.proven_dead_tuples : [];
    const unintegratedDelivery = tuples.some((tuple) => {
      const resolved = seam.resolveNoDeliveryRetirementEvidence(subject, tuple);
      return resolved?.committed === true && resolved.evidence?.integrated === false;
    });
    if (!unintegratedDelivery) return null;
    return Object.freeze({
      ...priorAttempt,
      may_launch: false,
      committed_review_continuation: true,
      reason: "the exact slice has an authenticated committed delivery not yet integrated",
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
    : ({ app, role, subject, run_id, monitor_handle, provisioning_ticket, reservation = null }) => {
        const tuple = managedRunIdentityTuple({
          app, subject, run_id, monitor_handle, provisioning_ticket
        });
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

          confirmProvisioning: ({ provisioning_ticket: ticket }) => {
            try {
              return sameTuple(tuple, managedRunIdentityTuple({
                app, subject, run_id, monitor_handle, provisioning_ticket: ticket
              }));
            } catch {
              return false;
            }
          },
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
