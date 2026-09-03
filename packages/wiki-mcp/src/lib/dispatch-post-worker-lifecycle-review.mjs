

import { setWorkRecordStatusByUnit } from "../../../wiki-core/src/index.mjs";
import { SLICE_INTEGRATION_DIAGNOSTIC_CODES } from
  "../../../agent-launch-cli/src/lib/slice-integration.mjs";

import { readCanonicalContractGenerationIdentity } from
  "../../../agent-launch-cli/src/lib/slice-integration-authorization.mjs";
import {
  lifecycleError,
  POST_WORKER_LIFECYCLE_PHASES,
  resolvedTree
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

async function resolveReviewGitFact({ operation, runGit, repo, value, message, code }) {
  const resolver = operation === "resolve_commit" ? resolvedCommit : resolvedTree;
  return await resolver(runGit, repo, value, message, code);
}

function resolveBoundReviewerTarget(context, sliceTarget, subject) {
  const base = context?.diff_base_sha;
  const range = context?.diff_range;
  if (typeof base !== "string" && typeof range !== "string") return sliceTarget;
  if (context.slice_ref !== sliceTarget.ref || context.reviewed_sha !== sliceTarget.sha ||
      !OID_RE.test(base ?? "") || context.diff_head_sha !== context.reviewed_sha ||
      range !== `${base}..${context.reviewed_sha}`) {
    throw lifecycleError(
      SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH,
      "bound frozen slice-review context does not describe the authenticated exact review target",
      {
        subject,
        slice_ref: sliceTarget.ref,
        reviewed_sha: sliceTarget.sha,
        context_slice_ref: context?.slice_ref ?? null,
        context_reviewed_sha: context?.reviewed_sha ?? null,
        context_diff_base_sha: base ?? null,
        context_diff_range: range ?? null
      }
    );
  }
  return Object.freeze({
    ref: context.slice_ref,
    sha: context.reviewed_sha,
    diff_base_sha: base,
    diff_head_sha: context.diff_head_sha,
    diff_range: range,
    slice_level_review: true
  });
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
  planReviewerClosure,
  deps
}) {
  if (typeof deps.resolveCanonicalSliceReviewUnit !== "function" ||
      typeof deps.bindFrozenSliceReviewContext !== "function") {
    throw new Error("post-worker lifecycle requires backend-owned slice-level review context composition");
  }

  if (typeof planReviewerClosure !== "function") {
    throw new Error("exact-slice review freeze requires the composed reviewer closure planner");
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

  const reviewerTarget = resolveBoundReviewerTarget(context, sliceTarget, subject);

  const resolveGeneration = typeof deps.readCanonicalContractGenerationIdentity === "function"
    ? deps.readCanonicalContractGenerationIdentity
    : readCanonicalContractGenerationIdentity;
  const closurePlan = planReviewerClosure({
    transport: "managed_terminal_result",
    repository: context.worktree_path,
    role: "reviewer",
    purpose: "canonical_committed_slice",
    subject,
    reviewed_sha: reviewerTarget.sha,
    diff_base_sha: reviewerTarget.diff_base_sha,
    controlled_generation: resolveGeneration(workspaceDir, wkId)?.digest ?? null,
    receipt_identity: "workspace-agent-exact-slice-review-receipt.v4",
    provenance_shape: "canonical_committed_slice"
  });
  return Object.freeze({
    schema_version: "workspace-agent-slice-review-surface.v1",
    review_subject: subject,
    slice_ref: reviewerTarget.ref,
    reviewed_sha: reviewerTarget.sha,
    diff_base_sha: reviewerTarget.diff_base_sha,
    worker_attempt_base_sha: binding.base_sha,
    empty_delivery: emptyDelivery === true,
    frozen_slice_review_target: reviewerTarget,
    slice_worktree_path: context.worktree_path,
    reviewer_dispatch: Object.freeze({
      tool: "workspace_agent_dispatch",
      args: Object.freeze({ role: "reviewer", subject }),
      closure_plan: closurePlan,
      context: Object.freeze({
        frozen_slice_review_target: reviewerTarget,

        workspace_dir: context.worktree_path,
        slice_level_review: true,
        review_context_schema_version: context.schema_version
      })
    })
  });
}

export async function prepareExactSliceReviewSurface({
  status,
  binding,
  sliceRef,
  commit,
  reviewedTree,
  deps
}) {
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
  commit,
  runGit,
  planReviewerClosure,
  deps
}) {
  const gitFactError =
    "post-worker lifecycle could not resolve a delivery tree for empty-delivery classification";

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

  const [baseTree, reviewedTree] = await Promise.all([
    resolveReviewGitFact({
      operation: "resolve_tree",
      runGit,
      repo: binding.worktree_path,
      value: binding.base_sha,
      message: gitFactError,
      code: SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH
    }),
    resolveReviewGitFact({
      operation: "resolve_tree",
      runGit,
      repo: binding.worktree_path,
      value: commit,
      message: gitFactError,
      code: SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH
    })
  ]);
  const emptyDelivery = baseTree === reviewedTree;

  await prepareExactSliceReviewSurface({
    status,
    binding,
    sliceRef,
    commit,
    reviewedTree,
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
    planReviewerClosure,
    deps
  });
}
