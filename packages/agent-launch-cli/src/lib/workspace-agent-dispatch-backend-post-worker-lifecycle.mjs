

import path from "node:path";
import {
  isPlainObject,
  createTrustedFrozenSliceReviewContract
} from "./backend-review-identity.mjs";
import {
  resolveCanonicalFindingsOnlyReviewUnit,
  assertFrozenSliceReviewTarget,
  resolveCanonicalSliceReviewUnit
} from "./backend-scope-authority.mjs";
import { resolveCommittedSliceReviewAdmission } from
  "./committed-slice-review-admission.mjs";
import { selectImmutableFindingsDependencyProjection } from
  "./terminal-wk-candidate-validation.mjs";
import { digestTrustedExactReviewEvidence } from
  "./workspace-agent-dispatch-run-receipt.mjs";

export function createBackendPostWorkerLifecycle(ctx) {
  const {
    frozenSliceReviewContexts,
    frozenReviewContexts,
    worktreeProvisioningConfig,
    reviewContextRunGit,
    sliceReviewRunContexts,
    runs,
    postWorkerSliceLifecycle,
    attemptStateAuthority,
    lifecycle
  } = ctx;

  const bindFrozenReviewContext = (args) => ctx.bindFrozenReviewContext(args);
  const resolveCommittedSliceIntegrationContinuation = (args) =>
    ctx.resolveCommittedSliceIntegrationContinuation(args);
  const retireManagedWorkerIdentity = (args) => ctx.retireManagedWorkerIdentity(args);

  function resolveManagedRunBinding(status) {
    return attemptStateAuthority.resolveProvisioningBinding(status);
  }

  function bindFrozenSliceReviewContext({ status, provisioning, sliceTarget, reviewUnit }) {
    const target = assertFrozenSliceReviewTarget(sliceTarget);
    const sliceBinding = provisioning?.slice_binding;

    const worktreePath = provisioning?.slice_worktree_path ?? sliceBinding?.worktree_path;
    const expectedSliceRef = sliceBinding?.output_branch?.startsWith("refs/heads/")
      ? sliceBinding.output_branch
      : `refs/heads/${sliceBinding?.output_branch ?? ""}`;
    if (!isPlainObject(reviewUnit) || typeof reviewUnit.subject !== "string" ||
        typeof reviewUnit.canonical_parent_wk_contract !== "string" ||
        typeof reviewUnit.review_unit_contract !== "string" ||
        reviewUnit.parent_status === "review" ||
        typeof reviewUnit.initiative !== "string" || !/^IN-\d{4}$/u.test(reviewUnit.initiative) ||
        target.ref !== `refs/heads/slice/${reviewUnit.initiative}/${reviewUnit.record_id}/${reviewUnit.slice_id}` ||
        !path.isAbsolute(worktreePath ?? "") ||
        worktreePath !== sliceBinding?.worktree_path || expectedSliceRef !== target.ref ||
        provisioning?.record_id !== reviewUnit.record_id ||
        provisioning?.slice_id !== reviewUnit.slice_id ||
        status?.subject !== reviewUnit.subject) {
      throw new Error("backend-owned frozen slice review context does not match managed provisioning and canonical slice-review identity");
    }

    if (frozenReviewContexts.has(reviewUnit.subject)) {
      throw new Error("subject already bound to a whole-WK review context; a slice-level review context cannot coexist");
    }

    if (target.diff_base_sha !== sliceBinding?.base_sha) {
      throw new Error("frozen slice review target base does not match the launcher-owned current attempt provisioning binding");
    }
    const committedAdmission = resolveCommittedSliceReviewAdmission({
      mainRepo: worktreeProvisioningConfig.mainRepo,
      worktreeRoot: worktreeProvisioningConfig.worktreeRoot,
      subject: reviewUnit.subject,
      reviewUnit,
      runGit: reviewContextRunGit
    });

    const reviewTarget = assertFrozenSliceReviewTarget(committedAdmission.target);
    if (reviewTarget.sha !== target.sha || reviewTarget.ref !== target.ref ||
        committedAdmission.worktree_path !== worktreePath) {
      throw new Error("canonical committed-slice admission disagrees with the frozen worker target");
    }
    const trustedFrozenReviewContract = createTrustedFrozenSliceReviewContract(reviewUnit);

    const reviewerDependencySelection = selectImmutableFindingsDependencyProjection({
      mainRepo: worktreeProvisioningConfig.mainRepo,
      checkoutPath: worktreePath,
      projectionRoot: path.join(
        worktreeProvisioningConfig.worktreeRoot,
        ".reviewer-dependencies",
        committedAdmission.committed_target_digest,
        "node_modules"
      )
    });
    const context = Object.freeze({
      schema_version: "workspace-agent-frozen-slice-review-context.v1",
      review_admission_kind: committedAdmission.review_admission_kind,
      committed_target_digest: committedAdmission.committed_target_digest,
      review_subject: reviewUnit.subject,
      record_id: reviewUnit.record_id,
      review_slice_id: reviewUnit.slice_id,
      initiative: reviewUnit.initiative,
      canonical_parent_wk_contract: reviewUnit.canonical_parent_wk_contract,
      review_unit_contract: reviewUnit.review_unit_contract,
      trusted_frozen_review_contract: trustedFrozenReviewContract,
      main_repo: worktreeProvisioningConfig.mainRepo,
      worktree_path: worktreePath,
      slice_ref: reviewTarget.ref,
      reviewed_sha: reviewTarget.sha,

      diff_base_sha: reviewTarget.diff_base_sha,
      diff_head_sha: reviewTarget.diff_head_sha,
      diff_range: reviewTarget.diff_range,
      empty_delivery: committedAdmission.empty_delivery === true,
      slice_level_review: true,

      worker_attempt_base_sha: target.diff_base_sha,
      source_worker_run_id: status.run_id,
      source_worker_monitor_handle: status.monitor_handle ?? status.run_id,
      source_worker_subject: status.subject,
      worktree_identity: committedAdmission.identity,
      worktree_identity_digest: digestTrustedExactReviewEvidence(committedAdmission.identity),
      reviewer_dependency_projection_selected: reviewerDependencySelection.selected === true,
      reviewer_dependency_unavailable_reason: reviewerDependencySelection.reason_code ?? null,
      dependency_projection_evidence: reviewerDependencySelection.evidence,
      reviewer_dependency_binds:
        reviewerDependencySelection.projection?.read_only_binds ?? Object.freeze([]),
      review_evidence_semantics: "immutable_advisory_history"
    });
    frozenSliceReviewContexts.set(reviewUnit.subject, context);
    return context;
  }

  const runPostWorkerSliceLifecycle = postWorkerSliceLifecycle === null
    ? null
    : async ({ workspace, status }) => postWorkerSliceLifecycle({
        workspace,
        status,
        deps: {
          resolveManagedRunBinding,
          resolveCanonicalReviewUnit: ({ mainRepo, wkId }) =>
            resolveCanonicalFindingsOnlyReviewUnit(mainRepo, wkId),
          bindFrozenReviewContext,

          resolveCanonicalSliceReviewUnit: ({ mainRepo, subject }) =>
            resolveCanonicalSliceReviewUnit(mainRepo, subject),
          bindFrozenSliceReviewContext,

          resolveCommittedSliceIntegrationContinuation,

          retireManagedWorkerIdentity
        }
      });

  return {
    resolveManagedRunBinding,
    bindFrozenSliceReviewContext,
    runPostWorkerSliceLifecycle
  };
}
