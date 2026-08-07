

import {
  acquireManagedRunSubjectReservation,
  MANAGED_RUN_PROCESS_IDENTITY_RETIREMENT_REASONS,
  MANAGED_RUN_PROCESS_IDENTITY_VERDICTS,
  releaseManagedRunSubjectReservation,
  retireManagedRunAndReserveCorrectiveSuccessor,
  retireManagedRunProcessIdentity
} from "./managed-run-process-identity.mjs";

import {
  retireProvenDeadAndReserveSuccessor
} from "./managed-run-subject-reservation.mjs";

import {
  resolveUniqueManagedLifecycleBindingPairForRecovery
} from "./worktree-substrate-identity.mjs";
import { EXACT_IMPLEMENTATION_SLICE_RE } from "./backend-constants.mjs";
import {
  failNoDeliveryEvidence,
  MANAGED_NO_DELIVERY_EVIDENCE_DIAGNOSTIC_CODES,
  NO_DELIVERY_COMMIT_ID_RE,
  NO_DELIVERY_DIAGNOSTIC_VALUE_MAX,
  SUPERSEDED_ATTEMPT_RETIREMENT_REASON_MAX,
  SUPERSEDED_ATTEMPT_RETIREMENT_RESULT_MAX,
  SUPERSEDED_ATTEMPT_RETIREMENT_RESULTS_SCHEMA_VERSION
} from "./workspace-agent-dispatch-backend-managed-identity-diagnostics.mjs";

export function createCorrectiveSupersession(ctx, seam) {
  const {
    worktreeProvisioningConfig,
    reviewContextRunGit,
    correctiveContinuationProofs,
    managedRunIdentityRoot,
    managedRunIdentityDeps
  } = ctx;

  function retainCorrectiveContinuationProof(subject, reservation, continuation) {
    if (reservation === null || continuation === null) return;
    correctiveContinuationProofs.set(subject, Object.freeze({
      reservation_id: reservation.reservation_id,
      proof: continuation.proof
    }));
  }

  function retireSupersededCorrectiveAttempt(tuple, evidence) {
    try {
      return retireManagedRunProcessIdentity({
        mainRepo: managedRunIdentityRoot,
        tuple,
        reason: MANAGED_RUN_PROCESS_IDENTITY_RETIREMENT_REASONS.CORRECTIVE_SUPERSESSION,
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
  }

  const projectAttemptRetirement = (tuple, outcome) => Object.freeze({
    tuple: Object.freeze({ ...tuple }),
    retired: outcome?.retired === true,
    verdict: typeof outcome?.verdict === "string" ? outcome.verdict : null,
    reason: typeof outcome?.reason === "string"
      ? outcome.reason.slice(0, SUPERSEDED_ATTEMPT_RETIREMENT_REASON_MAX)
      : null,
    code: typeof outcome?.code === "string" ? outcome.code : null
  });

  const withSupersededAttemptRetirements = (successor, results, omitted) => Object.freeze({
    ...successor,
    superseded_attempt_retirements: Object.freeze({
      schema_version: SUPERSEDED_ATTEMPT_RETIREMENT_RESULTS_SCHEMA_VERSION,
      attempted: results.length + omitted,
      settled: results.filter((entry) => entry.retired === true).length,
      unsettled: results.filter((entry) => entry.retired !== true).length,

      omitted_count: omitted,
      results: Object.freeze([...results])
    })
  });

  function bindAuthenticatedCorrectiveFindings(successor, findingsContext) {
    if (findingsContext === null) return successor;
    return Object.freeze({
      ...successor,
      trusted_corrective_findings_context: findingsContext
    });
  }

  const releaseFreshlyMintedReservation = (reservation) => {
    if (managedRunIdentityRoot === null ||
        typeof reservation?.reservation_id !== "string") return;
    try {
      releaseManagedRunSubjectReservation({
        mainRepo: managedRunIdentityRoot,
        subject: reservation.subject,
        reservationId: reservation.reservation_id
      });
    } catch {

    }
  };

  async function withFreshlyMintedReservation(reservation, produce) {
    try {
      return await produce();
    } catch (error) {
      releaseFreshlyMintedReservation(reservation);
      throw error;
    }
  }

  async function supersedeProvenDeadAttemptForCorrectiveWorker({ subject, priorAttempt }) {
    if (managedRunIdentityRoot === null ||
        priorAttempt?.verdict !== MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.PROVEN_DEAD) {
      return null;
    }

    const provenDeadTuples = priorAttempt.tuple
      ? [priorAttempt.tuple]
      : (Array.isArray(priorAttempt.proven_dead_tuples) &&
          priorAttempt.proven_dead_tuples.length > 0
          ? priorAttempt.proven_dead_tuples
          : null);
    if (provenDeadTuples === null) return null;
    const continuation =
      await seam.resolveMechanicallyAuthenticatedCorrectiveContinuation(subject);
    if (continuation === null) return null;
    const proof = continuation.proof;

    const correctiveEvidence = (tuple) => ({
      source_worker_run_id: tuple.run_id,
      source_worker_monitor_handle: tuple.launch_ref,
      subject,
      slice_ref: proof.slice_ref,
      frozen_base_sha: proof.frozen_base_sha,
      delivered_tip_sha: proof.delivered_tip_sha,
      commit_chain: proof.commit_chain,
      committed_target_digest: proof.committed_target_digest
    });

    const accept = (successor, sourceTuple) =>
      withFreshlyMintedReservation(successor.reservation, () => {
        retainCorrectiveContinuationProof(subject, successor.reservation, continuation);
        return bindAuthenticatedCorrectiveFindings(
          successor,
          seam.buildTrustedCorrectiveFindingsContext({
            subject,
            reviewEvidence: continuation.review_evidence,
            sourceTuple
          })
        );
      });

    if (priorAttempt.tuple) {
      const owned = retireManagedRunAndReserveCorrectiveSuccessor({
        mainRepo: managedRunIdentityRoot,
        tuple: priorAttempt.tuple,
        subject,
        role: "worker",
        evidence: correctiveEvidence(priorAttempt.tuple),
        ...(managedRunIdentityDeps ? { deps: managedRunIdentityDeps } : {})
      });
      if (owned.may_launch === true) return accept(owned, priorAttempt.tuple);

      if (owned.verdict !== MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.MISMATCHED) return owned;
    }

    const successor = retireProvenDeadAndReserveSuccessor({
      mainRepo: managedRunIdentityRoot,
      subject,
      role: "worker",
      provenDeadSet: provenDeadTuples.map((tuple) => ({
        tuple,
        evidence: correctiveEvidence(tuple)
      })),
      ...(managedRunIdentityDeps ? { deps: managedRunIdentityDeps } : {})
    });
    if (successor.may_launch !== true) return successor;
    const retirements = [];
    let omitted = 0;
    for (const tuple of provenDeadTuples) {
      const outcome = retireSupersededCorrectiveAttempt(tuple, correctiveEvidence(tuple));
      if (retirements.length < SUPERSEDED_ATTEMPT_RETIREMENT_RESULT_MAX) {
        retirements.push(projectAttemptRetirement(tuple, outcome));
      } else {
        omitted += 1;
      }
    }
    return accept(
      withSupersededAttemptRetirements(successor, retirements, omitted),
      priorAttempt.tuple ?? null
    );
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

  const checkPriorManagedAttempt = managedRunIdentityRoot === null
    ? null
    : async ({ role, subject }) => {
        const acquire = () => acquireManagedRunSubjectReservation({
          mainRepo: managedRunIdentityRoot,
          subject,
          role,
          ...(managedRunIdentityDeps ? { deps: managedRunIdentityDeps } : {})
        });

        const acceptFreshlyReservedSubject = (outcome) =>
          withFreshlyMintedReservation(outcome.reservation, async () => {
            const continuation =
              await seam.resolveMechanicallyAuthenticatedCorrectiveContinuation(subject);
            retainCorrectiveContinuationProof(subject, outcome.reservation, continuation);
            if (continuation === null) return outcome;
            return bindAuthenticatedCorrectiveFindings(
              outcome,
              seam.buildTrustedCorrectiveFindingsContext({
                subject,
                reviewEvidence: continuation.review_evidence,
                sourceTuple: null
              })
            );
          });
        const first = acquire();
        if (first.may_launch === true) return acceptFreshlyReservedSubject(first);
        const corrective = await supersedeProvenDeadAttemptForCorrectiveWorker({
          subject,
          priorAttempt: first
        });
        if (corrective !== null) {
          if (corrective.may_launch === true ||
              corrective.verdict !== MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.RESERVED) {
            return corrective;
          }

          const observed = acquire();
          if (observed.may_launch === true) return acceptFreshlyReservedSubject(observed);
          return observed.verdict === MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.PROVEN_DEAD
            ? corrective
            : observed;
        }
        const noDelivery = seam.supersedeNoDeliveryProvenDeadAttempt({
          subject,
          priorAttempt: first
        });
        if (noDelivery !== null) return noDelivery;
        return seam.resolveCommittedReviewContinuation(subject, first) ?? first;
      };

  return {
    retainCorrectiveContinuationProof,
    supersedeProvenDeadAttemptForCorrectiveWorker,
    resolveNoDeliveryRetirementEvidence,
    checkPriorManagedAttempt
  };
}
