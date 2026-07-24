

import path from "node:path";
import {
  isPlainObject,
  createTrustedFrozenReviewContract,
  assertRetainedReviewerLaunchIdentityMatchesContext
} from "./backend-review-identity.mjs";
import {
  assertFrozenReviewTarget,
  verifyFrozenWkReviewTargetAgainstObjectStore
} from "./backend-scope-authority.mjs";
import {
  managedRefusal,
  MANAGED_LIFECYCLE_REQUIRED
} from "./backend-provisioning-state.mjs";
import {
  assertTerminalCandidateMaterialization,
  verifyTerminalCandidateCheckout
} from "./terminal-review-materialization.mjs";
import { verifyTerminalWkCandidateObjectBinding } from "./terminal-wk-candidate.mjs";
import { verifyTerminalCandidateDependencies } from "./terminal-wk-candidate-validation.mjs";
import { deriveBackendReviewResult } from "./workspace-agent-dispatch-review-result.mjs";

export function createBackendTerminalReview(ctx) {
  const {
    frozenSliceReviewContexts,
    frozenReviewContexts,
    worktreeProvisioningConfig,
    reviewContextRunGit,
    recoverTerminalCandidate,
    terminalCandidateRecoveryInFlight,
    currentTerminalReviewTargetByWk,
    frozenReviewContextsByTarget,
    wholeReviewRunContexts,
    runs,
    wholeReviewTargetKey
  } = ctx;

  const structuredReceiptOutcome = (record) => ctx.structuredReceiptOutcome(record);

  function sameTerminalReviewAddress(left, right) {
    return left?.subject === (right?.subject ?? right?.review_subject) &&
      left?.record_id === right?.record_id &&
      left?.slice_id === (right?.slice_id ?? right?.review_slice_id);
  }

  function terminalCandidateReviewTarget(terminalCandidate) {
    const binding = terminalCandidate?.binding;
    const materialization = terminalCandidate?.materialization;
    return Object.freeze({
      schema_version: "agent_launch.terminal_candidate_review_target.v1",
      review_identity_kind: "terminal_candidate",
      ref: binding?.candidate_ref,
      sha: binding?.candidate,
      candidate_ref: binding?.candidate_ref,
      candidate_sha: binding?.candidate,
      base_ref: binding?.base_ref,
      base_sha: binding?.base,
      wk_ref: binding?.wk_ref,
      wk_sha: binding?.wk_tip,
      worktree_path: materialization?.checkout_path,
      canonical_wk_digest: binding?.canonical_wk_digest,
      diff_base_sha: binding?.base,
      diff_head_sha: binding?.candidate,
      diff_range: `${binding?.base}..${binding?.candidate}`,
      complete_parent_wk_contract: true,
      accumulated_wk_diff: true
    });
  }

  function bindFrozenReviewContext({
    status,
    provisioning,
    integration,
    reviewUnit,
    terminalCandidate = null,
    terminalCandidateValidations = null,
    recoveredTerminalCandidate = false
  }) {
    const target = assertFrozenReviewTarget(integration?.review_target);
    const wkBinding = provisioning?.wk_binding;
    const terminalCandidateReview = target.review_identity_kind === "terminal_candidate";
    const boundReviewUnit = terminalCandidateReview && terminalCandidate?.review_unit
      ? terminalCandidate.review_unit
      : reviewUnit;
    const worktreePath = terminalCandidateReview ? target.worktree_path : provisioning?.validation_worktree_path;
    const expectedWkRef = wkBinding?.output_branch?.startsWith("refs/heads/")
      ? wkBinding.output_branch
      : `refs/heads/${wkBinding?.output_branch ?? ""}`;
    const managedLifecycleMismatch = recoveredTerminalCandidate !== true && (
      (terminalCandidateReview ? expectedWkRef !== target.wk_ref : expectedWkRef !== target.ref) ||
      (!terminalCandidateReview && worktreePath !== wkBinding?.worktree_path) ||
      provisioning?.record_id !== reviewUnit?.record_id ||
      status?.subject !== `${reviewUnit?.record_id}#${provisioning?.slice_id}`
    );
    if (!isPlainObject(boundReviewUnit) || typeof boundReviewUnit.subject !== "string" ||
        typeof boundReviewUnit.canonical_parent_wk_contract !== "string" ||
        typeof boundReviewUnit.review_unit_contract !== "string" ||
        (!terminalCandidateReview && reviewUnit.parent_status !== "review") ||
        typeof boundReviewUnit?.initiative !== "string" || !/^IN-\d{4}$/u.test(boundReviewUnit.initiative) ||
        (terminalCandidateReview
          ? target.wk_ref !== `refs/heads/wk/${boundReviewUnit.initiative}/${boundReviewUnit.record_id}` ||
            terminalCandidate === null
          : target.ref !== `refs/heads/wk/${reviewUnit.initiative}/${reviewUnit.record_id}` ||
            terminalCandidate !== null) ||
        !path.isAbsolute(worktreePath ?? "") ||
        managedLifecycleMismatch ||
        (recoveredTerminalCandidate === true && !terminalCandidateReview)) {
      throw new Error("backend-owned frozen review context does not match managed provisioning and canonical review identity");
    }
    if (terminalCandidateReview && !sameTerminalReviewAddress(reviewUnit, boundReviewUnit)) {
      throw new Error("terminal-candidate review address disagrees with the selected terminal review unit");
    }
    if (terminalCandidateReview) {
      if (!isPlainObject(terminalCandidate.dependency_proof) ||
          !Array.isArray(terminalCandidate.dependency_proof.reviewer_read_only_binds) ||
          terminalCandidate.dependency_proof.reviewer_read_only_binds.length === 0) {
        throw new Error("terminal-candidate reviewer dependency projection proof is absent or incomplete");
      }
      assertTerminalCandidateMaterialization(terminalCandidate.materialization, terminalCandidate.binding);
      const targetFields = [
        ["candidate_ref", terminalCandidate.binding.candidate_ref],
        ["candidate_sha", terminalCandidate.binding.candidate],
        ["base_ref", terminalCandidate.binding.base_ref],
        ["base_sha", terminalCandidate.binding.base],
        ["wk_ref", terminalCandidate.binding.wk_ref],
        ["wk_sha", terminalCandidate.binding.wk_tip],
        ["canonical_wk_digest", terminalCandidate.binding.canonical_wk_digest],
        ["worktree_path", terminalCandidate.materialization.checkout_path]
      ];
      const mismatch = targetFields.find(([field, expected]) => target[field] !== expected);
      if (mismatch) throw new Error(`terminal-candidate backend binding disagrees at ${mismatch[0]}`);
      verifyTerminalCandidateCheckout({
        binding: terminalCandidate.binding,
        candidateRoot: terminalCandidate.materialization.candidate_root,
        runGit: reviewContextRunGit
      });
    }

    if (frozenSliceReviewContexts.has(reviewUnit.subject)) {
      throw new Error("subject already bound to a slice-level review context; a whole-WK review context cannot coexist");
    }
    const existing = frozenReviewContexts.get(reviewUnit.subject) ?? null;
    if (existing !== null) {
      const sameTarget = terminalCandidateReview
        ? existing.candidate_sha === target.candidate_sha &&
          existing.base_sha === target.base_sha &&
          existing.terminal_candidate_dependency_proof?.digest === terminalCandidate.dependency_proof?.digest &&
          sameTerminalReviewAddress(boundReviewUnit, existing)
        : existing.wk_sha === target.sha && existing.diff_base_sha === target.diff_base_sha;
      if (sameTarget) return existing;
    }
    const trustedFrozenReviewContract = createTrustedFrozenReviewContract(boundReviewUnit);
    const context = Object.freeze({
      schema_version: "workspace-agent-frozen-wk-review-context.v1",
      review_subject: boundReviewUnit.subject,
      record_id: boundReviewUnit.record_id,
      review_slice_id: boundReviewUnit.slice_id,
      initiative: boundReviewUnit.initiative,
      canonical_parent_wk_contract: boundReviewUnit.canonical_parent_wk_contract,
      review_unit_contract: boundReviewUnit.review_unit_contract,
      trusted_frozen_review_contract: trustedFrozenReviewContract,
      main_repo: worktreeProvisioningConfig.mainRepo,
      worktree_path: worktreePath,
      wk_ref: terminalCandidateReview ? target.wk_ref : target.ref,
      wk_sha: terminalCandidateReview ? target.wk_sha : target.sha,
      ...(terminalCandidateReview ? {
        review_identity_kind: "terminal_candidate",
        candidate_ref: target.candidate_ref,
        candidate_sha: target.candidate_sha,
        base_ref: target.base_ref,
        base_sha: target.base_sha,
        canonical_wk_digest: target.canonical_wk_digest,
        terminal_candidate_binding: terminalCandidate.binding,
        terminal_candidate_materialization: terminalCandidate.materialization,
        terminal_candidate_dependency_proof: terminalCandidate.dependency_proof ?? null,
        reviewer_dependency_binds: Object.freeze([
          ...(terminalCandidate.dependency_proof?.reviewer_read_only_binds ?? [])
        ]),
        reviewer_validation_evidence: Object.freeze([
          ...(Array.isArray(terminalCandidateValidations)
            ? terminalCandidateValidations
            : Array.isArray(terminalCandidate.validation_evidence)
              ? terminalCandidate.validation_evidence
              : [])
        ])
      } : {}),
      diff_base_sha: target.diff_base_sha,
      diff_head_sha: target.diff_head_sha,
      diff_range: target.diff_range,
      complete_parent_wk_contract: true,
      accumulated_wk_diff: true,
      source_worker_run_id: status?.run_id ?? null,
      source_worker_subject: status?.subject ?? null,
      review_evidence_semantics: "append_only_advisory"
    });
    frozenReviewContexts.set(reviewUnit.subject, context);
    return context;
  }

  function verifyTerminalReviewContext(context) {
    verifyTerminalWkCandidateObjectBinding({
      binding: context.terminal_candidate_binding,
      runGit: reviewContextRunGit
    });
    verifyTerminalCandidateCheckout({
      binding: context.terminal_candidate_binding,
      candidateRoot: context.terminal_candidate_materialization.candidate_root,
      runGit: reviewContextRunGit
    });
    const dependencyProof = verifyTerminalCandidateDependencies({
      binding: context.terminal_candidate_binding,
      materialization: context.terminal_candidate_materialization
    });
    if (dependencyProof.digest !== context.terminal_candidate_dependency_proof?.digest) {
      throw new Error("terminal-candidate dependency projection changed after the review context was frozen");
    }
    return context;
  }

  async function recoverTerminalReviewContext(reviewAddress) {
    if (recoverTerminalCandidate === null || worktreeProvisioningConfig === null) {
      return {
        ok: false,
        refusal: managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
          capability: "wk_context_review",
          reason: "terminal_candidate_recovery_unavailable",
          subject: reviewAddress.subject
        })
      };
    }
    let recovery = terminalCandidateRecoveryInFlight.get(reviewAddress.subject) ?? null;
    if (recovery === null) {
      recovery = (async () => {
        const terminalCandidate = await recoverTerminalCandidate(reviewAddress.record_id);
        if (!isPlainObject(terminalCandidate) || !isPlainObject(terminalCandidate.review_unit) ||
            terminalCandidate.review_unit.subject !== reviewAddress.subject ||
            terminalCandidate.review_unit.record_id !== reviewAddress.record_id) {
          const error = new Error("recovered terminal candidate does not bind the canonical selected review unit");
          error.code = "terminal_candidate_recovery_review_subject_mismatch";
          throw error;
        }
        return bindFrozenReviewContext({
          status: null,
          provisioning: null,
          integration: { review_target: terminalCandidateReviewTarget(terminalCandidate) },
          reviewUnit: terminalCandidate.review_unit,
          terminalCandidate,
          terminalCandidateValidations: terminalCandidate.validation_evidence,
          recoveredTerminalCandidate: true
        });
      })();
      terminalCandidateRecoveryInFlight.set(reviewAddress.subject, recovery);
    }
    try {
      const context = await recovery;
      verifyTerminalReviewContext(context);
      return { ok: true, context };
    } catch (error) {
      return {
        ok: false,
        refusal: managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
          capability: "wk_context_review",
          reason: "terminal_candidate_recovery_failed",

          recovery_code: isPlainObject(error?.terminal_candidate_failure) &&
              typeof error.terminal_candidate_failure.code === "string"
            ? error.terminal_candidate_failure.code
            : typeof error?.code === "string"
              ? error.code
              : "terminal_candidate_recovery_mechanical_disagreement",
          subject: reviewAddress.subject,
          message: error?.message ?? String(error),

          ...(isPlainObject(error?.terminal_candidate_failure)
            ? { recovery_detail: error.terminal_candidate_failure }
            : {})
        })
      };
    } finally {
      if (terminalCandidateRecoveryInFlight.get(reviewAddress.subject) === recovery) {
        terminalCandidateRecoveryInFlight.delete(reviewAddress.subject);
      }
    }
  }

  function resolveTerminalCandidatePublicationState(wkId) {
    if (typeof wkId !== "string" || !/^WK-\d{4}$/u.test(wkId)) return null;
    const targetKey = currentTerminalReviewTargetByWk.get(wkId);
    if (targetKey === undefined) return null;
    const context = frozenReviewContextsByTarget.get(targetKey);
    if (context === undefined) return null;
    const records = [...wholeReviewRunContexts.entries()]
      .filter(([, runContext]) => wholeReviewTargetKey(runContext) === targetKey)
      .map(([runId]) => runs.get(runId))
      .filter(Boolean);
    if (verifyFrozenWkReviewTargetAgainstObjectStore({
      mainRepo: context.main_repo,
      context,
      runGit: reviewContextRunGit
    }).ok !== true) return null;
    verifyTerminalCandidateCheckout({
      binding: context.terminal_candidate_binding,
      candidateRoot: context.terminal_candidate_materialization.candidate_root,
      runGit: reviewContextRunGit
    });
    const advisoryReviews = records.map((record) => {
      const outcome = structuredReceiptOutcome(record);
      let provenanceValid = false;
      try {
        assertRetainedReviewerLaunchIdentityMatchesContext(record.reviewer_launch_identity, context);
        provenanceValid = true;
      } catch {

      }
      return Object.freeze({
        run_id: record.run_id,
        monitor_handle: record.monitor_handle ?? null,
        role: record.role ?? "reviewer",
        terminal: record.terminal === true,
        status: record.status ?? null,
        provenance_valid: provenanceValid,
        outcome: outcome?.outcome ?? null,
        review_result: outcome === null ? null : deriveBackendReviewResult(record)
      });
    });
    return Object.freeze({
      binding: context.terminal_candidate_binding,
      materialization: context.terminal_candidate_materialization,
      advisory_review_evidence: Object.freeze({
        schema_version: "workspace-agent-terminal-review-advisory-evidence.v1",
        authority: "advisory_only",
        candidate_sha: context.candidate_sha,
        base_sha: context.base_sha,
        wk_sha: context.wk_sha,
        reviews: Object.freeze(advisoryReviews)
      })
    });
  }

  return {
    sameTerminalReviewAddress,
    terminalCandidateReviewTarget,
    bindFrozenReviewContext,
    verifyTerminalReviewContext,
    recoverTerminalReviewContext,
    resolveTerminalCandidatePublicationState
  };
}
