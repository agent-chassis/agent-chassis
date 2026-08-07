

import {
  resolveCanonicalIntegratedSliceState,
  resolveCanonicalSliceReviewUnit,
  resolveFrozenSliceReviewReceiptContract,
  classifyCanonicalIntegratedSliceContract,
  groupTrustedReviewReceiptsByReviewedIdentity,
  deepFreezeCanonicalSnapshot,
  CANONICAL_INTEGRATED_CONTRACT_CLASSIFICATIONS
} from "./backend-scope-authority.mjs";
import { EXACT_IMPLEMENTATION_SLICE_RE } from "./backend-constants.mjs";
import {
  CORRECTIVE_CONTINUATION_PROOF_SCHEMA_VERSION
} from "./worktree-substrate-exact-unit.mjs";
import {
  COMMITTED_SLICE_REVIEW_IDENTITY_SCHEMA_VERSION,
  resolveCommittedSliceReviewAdmission
} from "./committed-slice-review-admission.mjs";
import {
  digestTrustedExactReviewEvidence,
  receiptCarriesUsableReviewVerdict
} from "./workspace-agent-dispatch-run-receipt.mjs";
import {
  CORRECTIVE_COMMITTED_REVIEW_ADMISSION_KIND,
  CORRECTIVE_GROUP_DIAGNOSTIC_MAX,
  correctiveStatusReconciliationRecovery,
  failCorrectiveContinuation,
  MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES,
  ManagedCorrectiveContinuationError,
  observedCanonicalStatusFacts,
  sharedRejectedCanonicalStatusFacts,
  TRUSTED_CORRECTIVE_FINDINGS_CONTEXT_SCHEMA_VERSION
} from "./workspace-agent-dispatch-backend-managed-identity-diagnostics.mjs";

function carriesValidatedStructuredResult(receipt) {
  const outcome = receipt?.structured_outcome;
  return outcome !== null && outcome !== undefined && typeof outcome === "object" &&
    !Array.isArray(outcome);
}

function carriesProjectableFindings(receipt) {
  const findings = receipt?.structured_outcome?.findings;
  return Array.isArray(findings) && findings.length > 0;
}

export function createCorrectiveReceiptAuthentication(ctx, projections) {
  const {
    worktreeProvisioningConfig,
    reviewContextRunGit,

    exactSliceReviewReceiptStore = null
  } = ctx;
  const {
    correctiveGroupExactReviewTarget,
    correctiveConvergedExactTargetWitness,
    correctiveProofCarrierAdmission,
    aggregateConvergedCorrectiveReceipts
  } = projections;

  async function resolveTrustedCorrectiveReviewEvidence(subject) {
    if (exactSliceReviewReceiptStore === null ||
        typeof exactSliceReviewReceiptStore.loadAll !== "function") return null;
    const loaded = await exactSliceReviewReceiptStore.loadAll({ unit_address: subject });
    if (!Array.isArray(loaded)) return null;
    const corrective = loaded.filter((receipt) =>
      receiptCarriesUsableReviewVerdict(receipt) &&
      receipt?.unit_address === subject &&
      receipt?.review_admission_kind === CORRECTIVE_COMMITTED_REVIEW_ADMISSION_KIND &&
      typeof receipt?.committed_target_digest === "string" &&
      carriesValidatedStructuredResult(receipt));
    if (corrective.length === 0) return null;

    return Object.freeze({
      receipt_count: corrective.length,

      groups: groupTrustedReviewReceiptsByReviewedIdentity(corrective)
    });
  }

  function authenticateCorrectiveReceiptGroup(subject, group) {
    const witness = group.witness;
    let frozenReviewUnit;
    try {

      frozenReviewUnit = resolveFrozenSliceReviewReceiptContract(witness);
      if (frozenReviewUnit.subject !== subject) {
        failCorrectiveContinuation(
          MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES.INTEGRATED_STATE_UNRESOLVED,
          "the trusted corrective review receipt does not name the exact dispatched subject",
          { detail: { subject, receipt_subject: frozenReviewUnit.subject ?? null } }
        );
      }

      const classification = classifyCanonicalIntegratedSliceContract(
        worktreeProvisioningConfig.mainRepo,
        subject,
        witness
      );
      if (classification.classification ===
          CANONICAL_INTEGRATED_CONTRACT_CLASSIFICATIONS.HISTORICAL_FROZEN_CONTRACT_UNCHANGED) {
        resolveCanonicalIntegratedSliceState(
          worktreeProvisioningConfig.mainRepo,
          subject,
          frozenReviewUnit
        );
      }
    } catch (error) {
      if (error instanceof ManagedCorrectiveContinuationError) throw error;

      const observed = observedCanonicalStatusFacts(error);
      const recovery = correctiveStatusReconciliationRecovery(subject, observed);
      failCorrectiveContinuation(
        MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES.INTEGRATED_STATE_UNRESOLVED,
        "the integrated canonical state for a reviewed delivery could not be authenticated",
        {
          detail: {
            subject,

            ...(observed === null ? {} : { observed_canonical_status: observed }),

            ...(recovery === null ? {} : { recovery })
          },
          cause: error
        }
      );
    }

    const frozenIdentity = witness.worktree_identity ?? null;
    if (frozenIdentity?.schema_version !== COMMITTED_SLICE_REVIEW_IDENTITY_SCHEMA_VERSION ||
        typeof frozenIdentity.wk_ref !== "string" || frozenIdentity.wk_ref.length === 0 ||
        frozenIdentity.slice_ref !== witness.slice_ref ||
        frozenIdentity.reviewed_sha !== witness.reviewed_sha ||
        frozenIdentity.diff_base_sha !== witness.diff_base_sha) {
      failCorrectiveContinuation(
        MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES.REVIEWED_TARGET_MISMATCH,
        "the trusted corrective review receipt carries no usable frozen pre-integration identity",

        { detail: { subject, receipt_self_authentication_failed: true } }
      );
    }

    const historicalWkIdentityRunGit = ({ repo, args }) =>
      (repo === worktreeProvisioningConfig.mainRepo && Array.isArray(args) &&
        args.length === 3 && args[0] === "rev-parse" && args[1] === "--verify" &&
        args[2] === `${frozenIdentity.wk_ref}^{commit}`)
        ? { ok: true, stdout: `${frozenIdentity.wk_sha}\n` }
        : reviewContextRunGit({ repo, args });
    let admission;
    try {
      admission = resolveCommittedSliceReviewAdmission({
        mainRepo: worktreeProvisioningConfig.mainRepo,
        worktreeRoot: worktreeProvisioningConfig.worktreeRoot,
        subject,
        reviewUnit: frozenReviewUnit,
        runGit: historicalWkIdentityRunGit
      });
    } catch (error) {
      if (error instanceof ManagedCorrectiveContinuationError) throw error;
      failCorrectiveContinuation(
        MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES.INTEGRATED_STATE_UNRESOLVED,
        "the committed delivery behind a reviewed integrated slice could not be authenticated",
        { detail: { subject }, cause: error }
      );
    }

    const identity = admission.identity;
    if (identity.slice_ref !== witness.slice_ref ||
        identity.reviewed_sha !== witness.reviewed_sha ||
        identity.diff_base_sha !== witness.diff_base_sha ||
        digestTrustedExactReviewEvidence(identity) !==
          digestTrustedExactReviewEvidence(frozenIdentity)) {
      failCorrectiveContinuation(
        MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES.REVIEWED_TARGET_MISMATCH,
        "the authenticated committed delivery is not the reviewed delivery",
        {
          detail: {
            subject,
            authenticated: {
              slice_ref: identity.slice_ref,
              reviewed_sha: identity.reviewed_sha,
              diff_base_sha: identity.diff_base_sha,
              frozen_identity_digest: digestTrustedExactReviewEvidence(identity)
            },
            reviewed: {
              slice_ref: witness.slice_ref,
              reviewed_sha: witness.reviewed_sha,
              diff_base_sha: witness.diff_base_sha,
              frozen_identity_digest: digestTrustedExactReviewEvidence(frozenIdentity)
            }
          }
        }
      );
    }
    return admission;
  }

  async function resolveIntegratedCorrectiveContinuationAdmission(subject) {
    const evidence = await resolveTrustedCorrectiveReviewEvidence(subject);
    if (evidence === null) return null;
    const matched = [];
    const rejected = [];
    for (const group of evidence.groups) {
      let admission;
      try {
        admission = authenticateCorrectiveReceiptGroup(subject, group);
      } catch (error) {
        if (!(error instanceof ManagedCorrectiveContinuationError)) throw error;
        rejected.push({ group, error });
        continue;
      }
      matched.push({ group, admission });
    }

    const selfContradictory = rejected.find((entry) =>
      entry.error?.detail?.receipt_self_authentication_failed === true);
    if (selfContradictory !== undefined) throw selfContradictory.error;
    if (matched.length === 1) {
      return Object.freeze({
        admission: matched[0].admission,
        evidence: Object.freeze({
          receipts: matched[0].group.receipts,
          witness: matched[0].group.witness
        })
      });
    }
    if (matched.length > 1) {

      const targets = matched.map((entry) =>
        correctiveGroupExactReviewTarget(subject, entry.group, entry.admission));
      if (targets.every((value) => value !== null && value === targets[0])) {

        const carrier = correctiveProofCarrierAdmission(matched);
        return Object.freeze({
          admission: carrier,
          evidence: Object.freeze({

            receipts: aggregateConvergedCorrectiveReceipts(matched),

            witness: correctiveConvergedExactTargetWitness(subject, carrier)
          })
        });
      }
      failCorrectiveContinuation(
        MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES.RECEIPTS_CONTRADICTORY,
        "more than one durable corrective review receipt group authenticates as the current reviewed delivery",
        {
          detail: {
            subject,
            matching_group_count: matched.length,
            candidate_group_count: evidence.groups.length,
            receipt_count: evidence.receipt_count,

            distinct_exact_target_count: new Set(targets).size
          }
        }
      );
    }

    if (rejected.length === 1) throw rejected[0].error;

    if (sharedRejectedCanonicalStatusFacts(subject, rejected) !== null) {
      throw rejected[0].error;
    }
    failCorrectiveContinuation(
      MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES.REVIEWED_TARGET_MISMATCH,
      "no durable corrective review receipt group authenticates as the current reviewed delivery",
      {
        detail: {
          subject,
          candidate_group_count: evidence.groups.length,
          receipt_count: evidence.receipt_count,
          rejected_group_codes: rejected
            .slice(0, CORRECTIVE_GROUP_DIAGNOSTIC_MAX)
            .map((entry) => entry.error.code ?? null),
          rejected_groups_omitted: Math.max(0, rejected.length - CORRECTIVE_GROUP_DIAGNOSTIC_MAX)
        }
      }
    );
    return null;
  }

  async function resolveMechanicallyAuthenticatedCorrectiveContinuation(subject) {
    if (worktreeProvisioningConfig === null ||
        !EXACT_IMPLEMENTATION_SLICE_RE.test(subject ?? "")) return null;
    let admission = null;
    let reviewEvidence = null;
    try {
      const reviewUnit = resolveCanonicalSliceReviewUnit(
        worktreeProvisioningConfig.mainRepo,
        subject
      );
      admission = resolveCommittedSliceReviewAdmission({
        mainRepo: worktreeProvisioningConfig.mainRepo,
        worktreeRoot: worktreeProvisioningConfig.worktreeRoot,
        subject,
        reviewUnit,
        runGit: reviewContextRunGit
      });
    } catch {

      admission = null;
    }
    if (admission === null) {
      const integrated = await resolveIntegratedCorrectiveContinuationAdmission(subject);
      if (integrated === null) return null;
      admission = integrated.admission;
      reviewEvidence = integrated.evidence;
    }
    const identity = admission.identity;
    return Object.freeze({
      proof: deepFreezeCanonicalSnapshot({
        schema_version: CORRECTIVE_CONTINUATION_PROOF_SCHEMA_VERSION,
        subject,
        unit_address: `${identity.initiative}/${identity.record_id}/${identity.slice_id}`,
        slice_ref: identity.slice_ref,
        frozen_base_sha: identity.diff_base_sha,
        delivered_tip_sha: identity.reviewed_sha,
        commit_chain: identity.commit_chain,
        committed_target_digest: identity.committed_target_digest,
        worktree_path: identity.worktree_path
      }),
      review_evidence: reviewEvidence
    });
  }

  function buildTrustedCorrectiveFindingsContext({ subject, reviewEvidence, sourceTuple }) {
    if (reviewEvidence === null) return null;
    const receipts = reviewEvidence.receipts.filter(carriesProjectableFindings);
    if (receipts.length === 0) return null;
    const witness = reviewEvidence.witness;
    return deepFreezeCanonicalSnapshot({
      schema_version: TRUSTED_CORRECTIVE_FINDINGS_CONTEXT_SCHEMA_VERSION,
      authority: "launcher_exact_review_receipt",
      unit_address: subject,

      source_worker_run_id: sourceTuple?.run_id ?? null,
      source_worker_monitor_handle: sourceTuple?.launch_ref ?? null,
      review_run_ids: receipts.map((receipt) => receipt.review_run_id),
      review_monitor_handles: receipts.map((receipt) => receipt.review_monitor_handle),
      reviewed_sha: witness.reviewed_sha,
      diff_base_sha: witness.diff_base_sha,
      findings: receipts.flatMap((receipt) => receipt.structured_outcome.findings),
      trusted_evidence_digests: receipts.map((receipt) => receipt.trusted_evidence_digest ?? null)
    });
  }

  return {
    resolveMechanicallyAuthenticatedCorrectiveContinuation,
    buildTrustedCorrectiveFindingsContext
  };
}
