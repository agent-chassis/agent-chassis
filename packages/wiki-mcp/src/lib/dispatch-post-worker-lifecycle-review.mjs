

import { setWorkRecordStatusByUnit } from "../../../wiki-core/src/index.mjs";
import { SLICE_INTEGRATION_DIAGNOSTIC_CODES } from
  "../../../agent-launch-cli/src/lib/slice-integration.mjs";
import {
  lifecycleError,
  POST_WORKER_LIFECYCLE_PHASES,
  resolvedCommit
} from "./dispatch-post-worker-lifecycle-bindings.mjs";
import { OID_RE } from "./dispatch-post-worker-lifecycle-policy.mjs";

const SLICE_REVIEW_FREEZE_CODES = Object.freeze({
  STATUS_TRANSITION_FAILED:
    "agent_launch.slice_review_materialization.slice_status_transition_failed.v1",
  CANONICAL_SLICE_UNRESOLVED:
    "agent_launch.slice_review_materialization.canonical_slice_unresolved.v1"
});

export const POST_WORKER_MISSING_DELIVERY_CODE =
  "agent_launch.post_worker_slice_lifecycle.missing_closed_input_delivery.v1";

function resolveDeliveryTree(runGit, repo, rev) {
  const res = runGit({ repo, args: ["rev-parse", "--verify", `${rev}^{tree}`] });
  const oid = res?.ok === true ? String(res.stdout ?? "").trim() : "";
  if (!OID_RE.test(oid)) {
    throw lifecycleError(
      SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH,
      "post-worker lifecycle could not resolve a delivery tree for empty-delivery classification",
      { rev }
    );
  }
  return oid;
}

export function awaitingSliceReviewResult(sliceReview, extra = null) {
  return Object.freeze({
    invoked: true,
    phase: POST_WORKER_LIFECYCLE_PHASES.AWAITING_SLICE_REVIEW,
    integrated: false,
    wk_transitioned_to_review: false,
    integration: null,
    empty_delivery: sliceReview.empty_delivery === true,
    slice_review: sliceReview,
    reviewer_dispatch: sliceReview.reviewer_dispatch,
    ...(extra ?? {})
  });
}

export async function freezeSliceReviewSurface({
  workspaceDir,
  status,
  bindings,
  binding,
  sliceRef,
  wkId,
  sliceId,
  commit,
  emptyDelivery = false,
  deps
}) {
  if (typeof deps.resolveCanonicalSliceReviewUnit !== "function" ||
      typeof deps.bindFrozenSliceReviewContext !== "function") {
    throw new Error("post-worker lifecycle requires backend-owned slice-level review context composition");
  }
  const subject = `${wkId}#${sliceId}`;
  const sliceTarget = Object.freeze({
    ref: sliceRef,
    sha: commit,
    diff_base_sha: binding.base_sha,
    diff_head_sha: commit,
    diff_range: `${binding.base_sha}..${commit}`,
    slice_level_review: true
  });

  let reviewUnit = null;
  try {
    reviewUnit = deps.resolveCanonicalSliceReviewUnit({ mainRepo: workspaceDir, subject });
  } catch {
    reviewUnit = null;
  }
  if (reviewUnit === null) {

    let transition;
    try {
      transition = await (deps.setWorkRecordStatusByUnit ?? setWorkRecordStatusByUnit)({
        dir: workspaceDir,
        unitAddress: subject,
        status: "review"
      });
    } catch (error) {
      throw lifecycleError(
        SLICE_REVIEW_FREEZE_CODES.STATUS_TRANSITION_FAILED,
        "slice-level review freeze could not transition the canonical slice to review",
        { subject, reviewed_sha: commit },
        error
      );
    }
    if (transition?.valid !== true || transition?.no_op === true ||
        (transition?.status !== undefined && transition.status !== "review")) {
      throw lifecycleError(
        SLICE_REVIEW_FREEZE_CODES.STATUS_TRANSITION_FAILED,
        "slice-level review freeze observed an invalid or conflicting canonical slice transition",
        {
          subject,
          reviewed_sha: commit,
          valid: transition?.valid ?? null,
          written: transition?.written ?? null,
          no_op: transition?.no_op ?? null,
          status: transition?.status ?? null,
          diagnostics: transition?.diagnostics ?? null
        }
      );
    }

    try {
      reviewUnit = deps.resolveCanonicalSliceReviewUnit({ mainRepo: workspaceDir, subject });
    } catch (error) {
      throw lifecycleError(
        SLICE_REVIEW_FREEZE_CODES.CANONICAL_SLICE_UNRESOLVED,
        "slice-level review freeze could not resolve the canonical slice after its transition",
        { subject, reviewed_sha: commit },
        error
      );
    }
    if (!reviewUnit) {
      throw lifecycleError(
        SLICE_REVIEW_FREEZE_CODES.CANONICAL_SLICE_UNRESOLVED,
        "canonical slice is not an unresolved implementation slice under slice-level review after its transition",
        { subject, reviewed_sha: commit }
      );
    }
  }
  const context = deps.bindFrozenSliceReviewContext({
    status,
    provisioning: bindings.provisioning,
    sliceTarget,
    reviewUnit
  });
  return Object.freeze({
    schema_version: "workspace-agent-slice-review-surface.v1",
    review_subject: subject,
    slice_ref: sliceRef,
    reviewed_sha: commit,
    diff_base_sha: binding.base_sha,
    empty_delivery: emptyDelivery === true,
    frozen_slice_review_target: sliceTarget,
    slice_worktree_path: context.worktree_path,
    reviewer_dispatch: Object.freeze({
      tool: "workspace_agent_dispatch",
      args: Object.freeze({ role: "reviewer", subject }),
      context: Object.freeze({
        frozen_slice_review_target: sliceTarget,

        workspace_dir: context.worktree_path,
        slice_level_review: true,
        review_context_schema_version: context.schema_version
      })
    })
  });
}

export async function prepareExactSliceReviewSurface({ status, binding, sliceRef, commit, runGit, deps }) {
  if (typeof deps.hostSliceReviewPreparationAdapter !== "function") {
    throw lifecycleError(
      "agent_launch.slice_review_materialization.prepare_failed.v1",
      "managed post-worker lifecycle requires the trusted slice-review preparation adapter"
    );
  }

  const retryId = binding?.retry_id;
  if (!Number.isInteger(retryId) || retryId < 0) {
    throw lifecycleError(
      "agent_launch.slice_review_materialization.binding_mismatch.v1",
      "slice-review preparation requires the full launcher retry tuple"
    );
  }
  const delegated = await deps.hostSliceReviewPreparationAdapter({
    assigned_unit: status.subject,
    launch_ref: status.monitor_handle,
    run_id: status.run_id,
    retry_id: retryId
  });
  if (!delegated || delegated.accepted !== true || !delegated.preparation) {
    throw lifecycleError(
      "agent_launch.slice_review_materialization.prepare_failed.v1",
      "trusted slice-review preparation refused",
      { integration_refusal: delegated?.refusal ?? null }
    );
  }
  const preparation = delegated.preparation;
  const reviewedTreeResult = runGit({
    repo: binding.worktree_path,
    args: ["rev-parse", "--verify", `${commit}^{tree}`]
  });
  const reviewedTree = reviewedTreeResult?.ok === true
    ? String(reviewedTreeResult.stdout ?? "").trim()
    : "";
  if (!OID_RE.test(reviewedTree) ||
      preparation.assigned_unit !== status.subject ||
      preparation.launch_ref !== status.monitor_handle ||
      preparation.run_id !== status.run_id ||
      preparation.retry_id !== retryId ||
      preparation.worktree_path !== binding.worktree_path ||
      preparation.slice_ref !== sliceRef ||
      preparation.base_sha !== binding.base_sha ||
      preparation.reviewed_sha !== commit ||
      preparation.reviewed_tree !== reviewedTree) {
    throw lifecycleError(
      "agent_launch.slice_review_materialization.binding_mismatch.v1",
      "trusted slice-review preparation result does not match live launcher and Git state"
    );
  }
  return preparation;
}

export async function prepareFreshTerminalSliceReviewSurface({
  workspaceDir,
  status,
  bindings,
  binding,
  sliceRef,
  wkId,
  sliceId,
  runGit,
  deps
}) {
  const commit = resolvedCommit(
    runGit,
    workspaceDir,
    sliceRef,
    "post-worker lifecycle could not resolve the committed slice tip",
    SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH
  );

  if (commit === binding.base_sha) {
    throw lifecycleError(
      POST_WORKER_MISSING_DELIVERY_CODE,
      "managed worker terminated without an authenticated closed-input delivery; the launcher-bound slice ref is unchanged and any in-scope worktree delta is preserved for retry",
      {
        subject: `${wkId}#${sliceId}`,
        slice_ref: sliceRef,
        base_sha: binding.base_sha,
        slice_tip_sha: commit
      }
    );
  }

  const emptyDelivery =
    resolveDeliveryTree(runGit, binding.worktree_path, binding.base_sha) ===
    resolveDeliveryTree(runGit, binding.worktree_path, commit);

  await prepareExactSliceReviewSurface({
    status,
    binding,
    sliceRef,
    commit,
    runGit,
    deps
  });

  return freezeSliceReviewSurface({
    workspaceDir,
    status,
    bindings,
    binding,
    sliceRef,
    wkId,
    sliceId,
    commit,
    emptyDelivery,
    deps
  });
}
