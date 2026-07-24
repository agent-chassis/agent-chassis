

import {
  acquireManagedRunSubjectReservation,
  assessManagedRunProcessIdentity,
  attachTupleToManagedRunSubjectReservation,
  bindManagedRunSandboxProcessIdentity,
  deriveOuterSandboxKillShape,
  discardManagedRunProcessIdentity,
  MANAGED_RUN_PROCESS_IDENTITY_VERDICTS,
  publishPendingManagedRunProcessIdentity,
  releaseManagedRunSubjectReservation,
  retireManagedRunAndReserveCorrectiveSuccessor,
  retireManagedRunProcessIdentity
} from "./managed-run-process-identity.mjs";

import {
  retireNoCommitAndReserveSuccessor,
  retireProvenDeadAndReserveSuccessor
} from "./managed-run-subject-reservation.mjs";
import {
  resolveUniqueManagedLifecycleBindingPairForRecovery
} from "./worktree-substrate-identity.mjs";
import {
  CORRECTIVE_CONTINUATION_PROOF_SCHEMA_VERSION
} from "./worktree-substrate-exact-unit.mjs";
import { EXACT_IMPLEMENTATION_SLICE_RE } from "./backend-constants.mjs";
import {
  deepFreezeCanonicalSnapshot,
  resolveCanonicalSliceReviewUnit
} from "./backend-scope-authority.mjs";
import { resolveCommittedSliceReviewAdmission } from "./committed-slice-review-admission.mjs";

export const MANAGED_NO_DELIVERY_EVIDENCE_DIAGNOSTIC_CODES = Object.freeze({
  BINDING_UNRESOLVED: "agent_launch.managed_run.no_delivery_binding_unresolved.v1",
  GIT_UNRESOLVED: "agent_launch.managed_run.no_delivery_git_unresolved.v1"
});

const NO_DELIVERY_COMMIT_ID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

const NO_DELIVERY_DIAGNOSTIC_VALUE_MAX = 120;

export class ManagedNoDeliveryEvidenceError extends Error {
  constructor(message, { code, detail = null, cause = null } = {}) {
    super(message);
    this.name = "ManagedNoDeliveryEvidenceError";
    this.code = code;
    if (detail !== null) this.detail = detail;
    if (cause !== null) this.cause = cause;
  }
}

function failNoDeliveryEvidence(code, what, { detail = null, cause = null } = {}) {
  const causeCode = typeof cause?.code === "string" ? cause.code : null;
  const causeMessage = cause === null ? null : (cause.message ?? String(cause));
  throw new ManagedNoDeliveryEvidenceError(
    `agent-launch managed-run restart: ${what} [${code}]` +
      (causeCode === null ? "" : ` cause=${causeCode}`) +
      (causeMessage === null ? "" : `: ${causeMessage}`),
    { code, detail: { ...(detail ?? {}), cause_code: causeCode }, cause }
  );
}

export function createBackendManagedIdentity(ctx) {
  const {
    worktreeProvisioningConfig,
    reviewContextRunGit,
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

  function resolveMechanicallyAuthenticatedCorrectiveContinuation(subject) {
    if (worktreeProvisioningConfig === null ||
        !EXACT_IMPLEMENTATION_SLICE_RE.test(subject ?? "")) return null;
    try {
      const reviewUnit = resolveCanonicalSliceReviewUnit(
        worktreeProvisioningConfig.mainRepo,
        subject
      );
      const admission = resolveCommittedSliceReviewAdmission({
        mainRepo: worktreeProvisioningConfig.mainRepo,
        worktreeRoot: worktreeProvisioningConfig.worktreeRoot,
        subject,
        reviewUnit,
        runGit: reviewContextRunGit
      });
      const identity = admission.identity;
      return deepFreezeCanonicalSnapshot({
        schema_version: CORRECTIVE_CONTINUATION_PROOF_SCHEMA_VERSION,
        subject,
        unit_address: `${identity.initiative}/${identity.record_id}/${identity.slice_id}`,
        slice_ref: identity.slice_ref,
        frozen_base_sha: identity.diff_base_sha,
        delivered_tip_sha: identity.reviewed_sha,
        commit_chain: identity.commit_chain,
        committed_target_digest: identity.committed_target_digest,
        worktree_path: identity.worktree_path
      });
    } catch {
      return null;
    }
  }

  function retainCorrectiveContinuationProof(subject, reservation, proof) {
    if (reservation === null || proof === null) return;
    correctiveContinuationProofs.set(subject, Object.freeze({
      reservation_id: reservation.reservation_id,
      proof
    }));
  }

  async function supersedeProvenDeadAttemptForCorrectiveWorker({ subject, priorAttempt }) {
    if (managedRunIdentityRoot === null ||
        priorAttempt?.verdict !== MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.PROVEN_DEAD ||
        !priorAttempt.tuple) {
      return null;
    }
    const proof = resolveMechanicallyAuthenticatedCorrectiveContinuation(subject);
    if (proof === null) return null;
    const successor = retireManagedRunAndReserveCorrectiveSuccessor({
      mainRepo: managedRunIdentityRoot,
      tuple: priorAttempt.tuple,
      subject,
      role: "worker",
      evidence: {
        source_worker_run_id: priorAttempt.tuple.run_id,
        source_worker_monitor_handle: priorAttempt.tuple.launch_ref,
        subject,
        slice_ref: proof.slice_ref,
        frozen_base_sha: proof.frozen_base_sha,
        delivered_tip_sha: proof.delivered_tip_sha,
        commit_chain: proof.commit_chain,
        committed_target_digest: proof.committed_target_digest
      },
      ...(managedRunIdentityDeps ? { deps: managedRunIdentityDeps } : {})
    });
    if (successor.may_launch === true) {
      retainCorrectiveContinuationProof(subject, successor.reservation, proof);
    }
    return successor;
  }

  function resolveNoDeliveryRetirementEvidence(subject, tuple) {

    if (worktreeProvisioningConfig === null || managedRunIdentityRoot === null ||
        !EXACT_IMPLEMENTATION_SLICE_RE.test(subject ?? "") ||
        !tuple || typeof tuple.launch_ref !== "string") {
      return null;
    }

    let pair;
    try {
      pair = resolveUniqueManagedLifecycleBindingPairForRecovery({
        mainRepo: worktreeProvisioningConfig.mainRepo,
        launchRef: tuple.launch_ref,
        expectedSubject: subject,
        allowMissingSliceWorktree: false
      });
    } catch (error) {
      failNoDeliveryEvidence(
        MANAGED_NO_DELIVERY_EVIDENCE_DIAGNOSTIC_CODES.BINDING_UNRESOLVED,
        "the retained launcher binding pair for a proven-dead attempt could not be reconstructed",
        { detail: { subject, launch_ref: tuple.launch_ref }, cause: error }
      );
    }

    if (!pair) return null;
    const sliceBinding = pair.slice_binding;
    if (!sliceBinding || typeof sliceBinding.output_branch !== "string" ||
        typeof sliceBinding.base_sha !== "string" || sliceBinding.base_sha.length === 0) {

      failNoDeliveryEvidence(
        MANAGED_NO_DELIVERY_EVIDENCE_DIAGNOSTIC_CODES.BINDING_UNRESOLVED,
        "the reconstructed launcher binding pair carries no usable slice ref and authenticated base",
        { detail: { subject, launch_ref: tuple.launch_ref } }
      );
    }
    const sliceRef = sliceBinding.output_branch.startsWith("refs/heads/")
      ? sliceBinding.output_branch
      : `refs/heads/${sliceBinding.output_branch}`;

    let result;
    try {
      result = reviewContextRunGit({
        repo: worktreeProvisioningConfig.mainRepo,
        args: ["rev-parse", "--verify", `${sliceRef}^{commit}`]
      });
    } catch (error) {
      failNoDeliveryEvidence(
        MANAGED_NO_DELIVERY_EVIDENCE_DIAGNOSTIC_CODES.GIT_UNRESOLVED,
        "trusted Git verification of the retained slice ref threw",
        { detail: { subject, launch_ref: tuple.launch_ref, slice_ref: sliceRef }, cause: error }
      );
    }
    if (!result || result.ok !== true) {
      failNoDeliveryEvidence(
        MANAGED_NO_DELIVERY_EVIDENCE_DIAGNOSTIC_CODES.GIT_UNRESOLVED,
        "trusted Git verification of the retained slice ref failed",
        {
          detail: {
            subject,
            launch_ref: tuple.launch_ref,
            slice_ref: sliceRef,
            status: result?.status ?? null,
            signal: result?.signal ?? null,
            git_error: result?.error ?? null,
            stderr: result?.stderr ?? null
          }
        }
      );
    }
    const tip = typeof result.stdout === "string" ? result.stdout.trim() : "";
    if (tip.length === 0) {
      failNoDeliveryEvidence(
        MANAGED_NO_DELIVERY_EVIDENCE_DIAGNOSTIC_CODES.GIT_UNRESOLVED,
        "trusted Git verification of the retained slice ref returned no commit id",
        { detail: { subject, launch_ref: tuple.launch_ref, slice_ref: sliceRef } }
      );
    }

    if (!NO_DELIVERY_COMMIT_ID_RE.test(tip)) {
      failNoDeliveryEvidence(
        MANAGED_NO_DELIVERY_EVIDENCE_DIAGNOSTIC_CODES.GIT_UNRESOLVED,
        "trusted Git verification of the retained slice ref returned no canonical commit id",
        {
          detail: {
            subject,
            launch_ref: tuple.launch_ref,
            slice_ref: sliceRef,
            resolved_output: tip.slice(0, NO_DELIVERY_DIAGNOSTIC_VALUE_MAX),
            resolved_output_length: tip.length,
            status: result.status ?? null,
            stderr: result.stderr ?? null
          }
        }
      );
    }
    if (tip !== sliceBinding.base_sha) return { committed: true };
    return {
      committed: false,
      evidence: { slice_ref: sliceRef, base_sha: sliceBinding.base_sha, slice_tip_sha: tip }
    };
  }

  function supersedeNoDeliveryProvenDeadAttempt({ subject, priorAttempt }) {
    if (managedRunIdentityRoot === null ||
        priorAttempt?.verdict !== MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.PROVEN_DEAD) {
      return null;
    }
    if (priorAttempt.tuple) {
      const resolved = resolveNoDeliveryRetirementEvidence(subject, priorAttempt.tuple);
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
      const resolved = resolveNoDeliveryRetirementEvidence(subject, tuple);
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

  const checkPriorManagedAttempt = managedRunIdentityRoot === null
    ? null
    : async ({ role, subject }) => {
        const acquire = () => acquireManagedRunSubjectReservation({
          mainRepo: managedRunIdentityRoot,
          subject,
          role,
          ...(managedRunIdentityDeps ? { deps: managedRunIdentityDeps } : {})
        });
        const first = acquire();
        if (first.may_launch === true) {
          retainCorrectiveContinuationProof(
            subject,
            first.reservation,
            resolveMechanicallyAuthenticatedCorrectiveContinuation(subject)
          );
          return first;
        }
        const corrective = await supersedeProvenDeadAttemptForCorrectiveWorker({
          subject,
          priorAttempt: first
        });
        if (corrective !== null) return corrective;
        const noDelivery = supersedeNoDeliveryProvenDeadAttempt({ subject, priorAttempt: first });
        if (noDelivery !== null) return noDelivery;
        return resolveCommittedReviewContinuation(subject, first) ?? first;
      };

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
    resolveMechanicallyAuthenticatedCorrectiveContinuation,
    retainCorrectiveContinuationProof,
    supersedeProvenDeadAttemptForCorrectiveWorker,
    checkPriorManagedAttempt,
    releaseManagedRunSubjectReservationForLaunch,
    publishPendingManagedRunIdentity,
    bindManagedRunOuterIdentity,
    resolveManagedWorkerProvenDeath,
    retireManagedWorkerIdentity
  };
}
