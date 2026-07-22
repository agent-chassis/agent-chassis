

import {
  computeWorkRecordSourceDigest,
  setWorkRecordStatusByUnit
} from "../../../wiki-core/src/index.mjs";
import { defaultRunGit } from "../../../agent-launch-cli/src/lib/worktree-substrate.mjs";
import { SLICE_INTEGRATION_DIAGNOSTIC_CODES } from
  "../../../agent-launch-cli/src/lib/slice-integration.mjs";
import {
  classifyTerminalReviewPolicyRefusal,
  resolveTerminalReviewEvidence,
  TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES
} from "./dispatch-terminal-review-evidence.mjs";
import {
  checkpointFromStatus,
  delegateSliceIntegrationToHost,
  lifecycleError,
  POST_WORKER_LIFECYCLE_PHASES,
  recoverIntegratedSliceResult,
  resolveManagedLifecycleBindings,
  resolvedCommit,
  WORKER_SLICE_SUBJECT_RE
} from "./dispatch-post-worker-lifecycle-bindings.mjs";

export async function runPostWorkerSliceLifecycle({ workspace, status, deps = {} } = {}) {
  return runPostWorkerSliceLifecycleBody({ workspace, status, deps });
}

const REVIEW_ENFORCEMENT_MODES = Object.freeze({
  ENFORCED_CCE: "enforced_cce",
  POLICY_ONLY: "policy_only"
});

const POLICY_DISPOSITION_SCHEMA_VERSION =
  "workspace-agent-terminal-review-policy-disposition.v1";

const POLICY_LIFECYCLE_CODES = Object.freeze({
  RECONCILIATION_FAILED:
    "agent_launch.terminal_review_policy.reconciliation_failed.v1",
  INTEGRATION_MISMATCH:
    "agent_launch.terminal_review_policy.integration_mismatch.v1",
  CANONICAL_STATE_INVALID:
    "agent_launch.terminal_review_policy.canonical_state_invalid.v1",
  STATUS_CAS_FAILED:
    "agent_launch.terminal_review_policy.status_cas_failed.v1"
});

const SLICE_REVIEW_FREEZE_CODES = Object.freeze({
  STATUS_TRANSITION_FAILED:
    "agent_launch.slice_review_materialization.slice_status_transition_failed.v1",
  CANONICAL_SLICE_UNRESOLVED:
    "agent_launch.slice_review_materialization.canonical_slice_unresolved.v1"
});

const OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

function reviewEnforcementMode(deps) {
  const mode = deps.reviewEnforcementMode ?? REVIEW_ENFORCEMENT_MODES.ENFORCED_CCE;
  if (mode !== REVIEW_ENFORCEMENT_MODES.ENFORCED_CCE &&
      mode !== REVIEW_ENFORCEMENT_MODES.POLICY_ONLY) {
    throw new Error("post-worker lifecycle requires an exact launcher-owned review enforcement mode");
  }
  return mode;
}

function policyLifecycleError(code, message, detail = null, cause = null) {
  return lifecycleError(code, message, detail, cause);
}

function assertPolicyReviewTarget(target, { initiative, wkId, wkRef, wkSha }) {
  const expectedUnit = `${initiative}/${wkId}`;
  if (!target || target.schema_version !== "slice-integration.v1" ||
      target.unit_address !== expectedUnit || target.ref !== wkRef ||
      target.sha !== wkSha || target.diff_head_sha !== wkSha ||
      !OID_RE.test(target.diff_base_sha ?? "") ||
      target.diff_range !== `${target.diff_base_sha}..${wkSha}` ||
      target.complete_parent_wk_contract !== true ||
      target.accumulated_wk_diff !== true) {
    throw policyLifecycleError(
      POLICY_LIFECYCLE_CODES.INTEGRATION_MISMATCH,
      "policy-only completion requires the exact frozen whole-WK integration target",
      { expected_unit: expectedUnit, wk_ref: wkRef, wk_sha: wkSha }
    );
  }
  return target;
}

function sameReviewTarget(left, right) {
  const fields = [
    "schema_version", "unit_address", "ref", "sha", "diff_base_sha",
    "diff_head_sha", "diff_range", "complete_parent_wk_contract",
    "accumulated_wk_diff"
  ];
  return left !== null && right !== null && fields.every((field) => left[field] === right[field]);
}

function assertTerminalTargetOwnership(integration) {
  if (integration?.review_target !== null &&
      integration?.slice_sha !== integration?.wk_sha) {
    throw policyLifecycleError(
      POLICY_LIFECYCLE_CODES.INTEGRATION_MISMATCH,
      "terminal whole-WK review target requires the integrated slice to own the current WK tip",
      {
        slice_sha: integration?.slice_sha ?? null,
        wk_sha: integration?.wk_sha ?? null
      }
    );
  }
  return integration;
}

function reconstructPolicyReviewTarget({ runGit, workspaceDir, initiative, wkId, wkRef, wkSha }) {
  const mainSha = resolvedCommit(
    runGit,
    workspaceDir,
    "refs/heads/main",
    "policy-only replay could not resolve the canonical main tip",
    SLICE_INTEGRATION_DIAGNOSTIC_CODES.GIT_FAILED
  );
  const mergeBaseResult = runGit({ repo: workspaceDir, args: ["merge-base", mainSha, wkSha] });
  const diffBaseSha = mergeBaseResult?.ok === true
    ? String(mergeBaseResult.stdout ?? "").trim()
    : "";
  if (!OID_RE.test(diffBaseSha) || /^0+$/u.test(diffBaseSha)) {
    throw policyLifecycleError(
      SLICE_INTEGRATION_DIAGNOSTIC_CODES.GIT_FAILED,
      "policy-only replay could not derive the exact whole-WK diff base",
      {
        status: mergeBaseResult?.status ?? null,
        stderr: mergeBaseResult?.stderr ?? mergeBaseResult?.error ?? null
      }
    );
  }
  return Object.freeze({
    schema_version: "slice-integration.v1",
    unit_address: `${initiative}/${wkId}`,
    ref: wkRef,
    sha: wkSha,
    diff_base_sha: diffBaseSha,
    diff_head_sha: wkSha,
    diff_range: `${diffBaseSha}..${wkSha}`,
    complete_parent_wk_contract: true,
    accumulated_wk_diff: true
  });
}

function reconcileExactPolicyIntegration({
  workspaceDir,
  binding,
  sliceRef,
  wkRef,
  runGit,
  deps,
  integration
}) {
  const reconciled = recoverIntegratedSliceResult({
    mainRepo: workspaceDir,
    binding,
    sliceRef,
    wkRef,
    runGit,
    deps
  });
  if (!reconciled) {
    throw policyLifecycleError(
      POLICY_LIFECYCLE_CODES.RECONCILIATION_FAILED,
      "policy-only terminal completion could not independently reconcile the integrated slice",
      { slice_ref: sliceRef, wk_ref: wkRef }
    );
  }
  const exactFields = ["slice_ref", "slice_sha", "wk_ref", "wk_sha"];
  const mismatch = exactFields.find((field) => integration?.[field] !== reconciled[field]);
  if (integration?.integrated !== true || reconciled.integrated !== true || mismatch !== undefined) {
    throw policyLifecycleError(
      POLICY_LIFECYCLE_CODES.INTEGRATION_MISMATCH,
      "policy-only terminal completion reconciliation does not match the exact integration result",
      { field: mismatch ?? "integrated" }
    );
  }
  if (integration.slice_ref !== sliceRef || integration.wk_ref !== wkRef) {
    throw policyLifecycleError(
      POLICY_LIFECYCLE_CODES.INTEGRATION_MISMATCH,
      "policy-only terminal completion integration does not match the launcher-owned refs"
    );
  }
  return reconciled;
}

function canonicalContractDigest(reviewUnit, expectedStatus) {
  let contract;
  try {
    contract = JSON.parse(reviewUnit.canonical_parent_wk_contract);
  } catch (error) {
    throw policyLifecycleError(
      POLICY_LIFECYCLE_CODES.CANONICAL_STATE_INVALID,
      "policy-only completion could not parse the canonical parent WK contract",
      null,
      error
    );
  }
  if (contract?.id !== reviewUnit.record_id || contract?.initiative !== reviewUnit.initiative ||
      contract?.status !== expectedStatus) {
    throw policyLifecycleError(
      POLICY_LIFECYCLE_CODES.CANONICAL_STATE_INVALID,
      "policy-only completion canonical parent contract does not match the resolved review unit",
      { expected_status: expectedStatus, actual_status: contract?.status ?? null }
    );
  }
  return computeWorkRecordSourceDigest(contract);
}

function assertCanonicalReviewIdentity(reviewUnit, { wkId, initiative }) {
  if (reviewUnit?.record_id !== wkId || reviewUnit?.initiative !== initiative) {
    throw policyLifecycleError(
      POLICY_LIFECYCLE_CODES.CANONICAL_STATE_INVALID,
      "policy-only completion canonical review unit does not match the exact launcher WK identity"
    );
  }
  return reviewUnit;
}

async function finalizePolicyOnlyWithoutReviewer({
  workspaceDir,
  deps,
  binding,
  sliceRef,
  wkRef,
  runGit,
  integration,
  initiative,
  wkId,
  cause
}) {
  const reconciled = reconcileExactPolicyIntegration({
    workspaceDir,
    binding,
    sliceRef,
    wkRef,
    runGit,
    deps,
    integration
  });
  let reviewUnit = assertCanonicalReviewIdentity(
    deps.resolveCanonicalReviewUnit({ mainRepo: workspaceDir, wkId }),
    { wkId, initiative }
  );
  const parentStatus = reviewUnit.parent_status ?? null;
  let reviewTarget = integration.review_target;
  if (reviewTarget === null && parentStatus === "done") {
    reviewTarget = reconstructPolicyReviewTarget({
      runGit,
      workspaceDir,
      initiative,
      wkId,
      wkRef,
      wkSha: integration.wk_sha
    });
  }
  assertPolicyReviewTarget(reviewTarget, {
    initiative,
    wkId,
    wkRef,
    wkSha: integration.wk_sha
  });
  if (reconciled.review_target !== null && !sameReviewTarget(reviewTarget, reconciled.review_target)) {
    throw policyLifecycleError(
      POLICY_LIFECYCLE_CODES.INTEGRATION_MISMATCH,
      "policy-only terminal completion review target does not match live reconciliation"
    );
  }
  if (reconciled.review_target === null && parentStatus !== "done") {
    throw policyLifecycleError(
      POLICY_LIFECYCLE_CODES.INTEGRATION_MISMATCH,
      "policy-only terminal completion lacks a final integration target outside exact already-done replay",
      { parent_status: parentStatus }
    );
  }

  let statusDisposition;
  if (parentStatus === "review") {
    const expectedSourceDigest = canonicalContractDigest(reviewUnit, "review");
    const transition = await (deps.setWorkRecordStatusByUnit ?? setWorkRecordStatusByUnit)({
      dir: workspaceDir,
      unitAddress: wkId,
      status: "done",
      expectedSourceDigest
    });
    if (transition?.valid !== true || transition?.written !== true ||
        transition?.no_op === true || transition?.status !== "done") {
      throw policyLifecycleError(
        POLICY_LIFECYCLE_CODES.STATUS_CAS_FAILED,
        "policy-only terminal completion could not CAS the exact parent from review to done",
        {
          valid: transition?.valid ?? null,
          written: transition?.written ?? null,
          no_op: transition?.no_op ?? null,
          status: transition?.status ?? null,
          diagnostics: transition?.diagnostics ?? null
        }
      );
    }
    reviewUnit = assertCanonicalReviewIdentity(
      deps.resolveCanonicalReviewUnit({ mainRepo: workspaceDir, wkId }),
      { wkId, initiative }
    );
    if (reviewUnit.parent_status !== "done") {
      throw policyLifecycleError(
        POLICY_LIFECYCLE_CODES.STATUS_CAS_FAILED,
        "policy-only terminal completion did not observe the canonical parent at done after CAS",
        { parent_status: reviewUnit.parent_status ?? null }
      );
    }
    canonicalContractDigest(reviewUnit, "done");
    statusDisposition = "review_to_done";
  } else if (parentStatus === "done") {
    canonicalContractDigest(reviewUnit, "done");
    statusDisposition = "already_done_revalidated";
  } else {
    throw policyLifecycleError(
      POLICY_LIFECYCLE_CODES.CANONICAL_STATE_INVALID,
      "policy-only terminal completion requires the exact parent at review or done",
      { parent_status: parentStatus }
    );
  }

  deps.markCommitAuthorityExercised?.();
  const policyDisposition = Object.freeze({
    schema_version: POLICY_DISPOSITION_SCHEMA_VERSION,
    enforcement_mode: REVIEW_ENFORCEMENT_MODES.POLICY_ONLY,
    reviewer_launched: false,
    evidence_enforced: false,
    audit_disposition: "non_audit",
    disposition: "completed_without_reviewer",
    cause,
    canonical_status: "done",
    status_disposition: statusDisposition
  });
  return Object.freeze({
    invoked: true,
    phase: POST_WORKER_LIFECYCLE_PHASES.FINALIZED,
    integrated: true,
    wk_transitioned_to_review: true,
    wk_transitioned_to_done: statusDisposition === "review_to_done",
    integration: Object.freeze({ ...integration, review_target: reviewTarget }),
    reviewer_dispatch: null,
    terminal_review_policy: policyDisposition
  });
}

function restartMissingEvidenceCause(integration) {
  const error = lifecycleError(
    TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.TRANSPORTED_EVIDENCE_MISSING,
    "restart reconstruction has no durably retained terminal-review evidence cause",
    {
      recovered: integration?.recovered === true,
      reconstruction: "exact_integration_reconciled_without_retained_evidence"
    }
  );
  return classifyTerminalReviewPolicyRefusal(error);
}

function awaitingSliceReviewResult(sliceReview, extra = null) {
  return Object.freeze({
    invoked: true,
    phase: POST_WORKER_LIFECYCLE_PHASES.AWAITING_SLICE_REVIEW,
    integrated: false,
    wk_transitioned_to_review: false,
    integration: null,
    slice_review: sliceReview,
    reviewer_dispatch: sliceReview.reviewer_dispatch,
    ...(extra ?? {})
  });
}

async function freezeSliceReviewSurface({
  workspaceDir,
  status,
  bindings,
  binding,
  sliceRef,
  wkId,
  sliceId,
  commit,
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

async function prepareExactSliceReviewSurface({ status, binding, sliceRef, commit, runGit, deps }) {
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
      { broker_refusal: delegated?.refusal ?? null }
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

async function runPostWorkerSliceLifecycleBody({ workspace, status, deps = {} } = {}) {
  const subject = typeof status?.subject === "string" ? status.subject.match(WORKER_SLICE_SUBJECT_RE) : null;
  if (status?.role !== "worker" || status?.terminal !== true || status?.status !== "succeeded" || !subject) {
    return null;
  }
  const bindings = resolveManagedLifecycleBindings({ workspaceDir: workspace.dir, status }, deps);
  const binding = bindings.slice;
  const [initiative, wkId, sliceId] = String(binding?.unit_address ?? "").split("/");
  if (wkId !== subject[1] || sliceId !== subject[2]) {
    throw new Error("post-worker lifecycle binding does not match the terminal worker subject");
  }
  const sliceBranch = binding.output_branch;
  const sliceRef = sliceBranch?.startsWith("refs/heads/") ? sliceBranch : `refs/heads/${sliceBranch}`;
  const wkRef = `refs/heads/wk/${initiative}/${wkId}`;
  const boundWkRef = bindings.wk?.output_branch?.startsWith("refs/heads/")
    ? bindings.wk.output_branch
    : `refs/heads/${bindings.wk?.output_branch ?? ""}`;
  if (boundWkRef !== wkRef) {
    throw new Error("post-worker lifecycle WK binding does not match the exact slice identity");
  }
  if (typeof deps.resolveCanonicalReviewUnit !== "function" ||
      typeof deps.bindFrozenReviewContext !== "function") {
    throw new Error("post-worker lifecycle requires backend-owned canonical review context composition");
  }

  let reviewUnit = null;
  const runGit = deps.runGit ?? defaultRunGit;
  const enforcementMode = reviewEnforcementMode(deps);
  const checkpoint = checkpointFromStatus(status);
  if (!Object.values(POST_WORKER_LIFECYCLE_PHASES).includes(checkpoint.phase)) {
    throw new Error("post-worker lifecycle checkpoint carries an invalid phase");
  }

  if (checkpoint.phase === POST_WORKER_LIFECYCLE_PHASES.PRE_INTEGRATION) {

    const recovered = recoverIntegratedSliceResult({
      mainRepo: workspace.dir,
      binding,
      sliceRef,
      wkRef,
      runGit,
      deps
    });
    if (recovered) {

      if (typeof deps.hostSliceIntegrationAdapter !== "function") {
        throw new Error("managed post-worker lifecycle requires the writable host slice integration adapter");
      }
      let brokerIntegration;
      try {
        brokerIntegration = await delegateSliceIntegrationToHost({
          status,
          adapter: deps.hostSliceIntegrationAdapter
        });
      } catch (error) {
        if (enforcementMode !== REVIEW_ENFORCEMENT_MODES.POLICY_ONLY) throw error;
        const cause = classifyTerminalReviewPolicyRefusal(error);
        if (cause === null) throw error;

        const independentlyRecovered = recoverIntegratedSliceResult({
          mainRepo: workspace.dir,
          binding,
          sliceRef,
          wkRef,
          runGit,
          deps
        });
        if (!independentlyRecovered) {
          throw policyLifecycleError(
            POLICY_LIFECYCLE_CODES.RECONCILIATION_FAILED,
            "known upstream terminal-review refusal could not reconcile the integrated slice",
            { cause_code: cause.code },
            error
          );
        }
        checkpoint.terminal_review_policy_cause = cause;
        brokerIntegration = independentlyRecovered;
      }
      if (brokerIntegration.slice_ref !== recovered.slice_ref ||
          brokerIntegration.slice_sha !== recovered.slice_sha ||
          brokerIntegration.wk_ref !== recovered.wk_ref ||
          brokerIntegration.wk_sha !== recovered.wk_sha ||
          (recovered.slice_sha !== recovered.wk_sha && brokerIntegration.review_target !== null) ||
          (brokerIntegration.review_target !== null && recovered.review_target !== null &&
            !sameReviewTarget(brokerIntegration.review_target, recovered.review_target))) {
        throw new Error("broker recovery result does not match the exact recovered integration marker");
      }
      checkpoint.integration = Object.freeze({
        ...brokerIntegration,
        recovered: true,
        integrated_state: recovered.integrated_state
      });
      checkpoint.phase = POST_WORKER_LIFECYCLE_PHASES.INTEGRATED;
    } else if (deps.recoveryOnly === true) {

      const recoveryCommit = resolvedCommit(
        runGit,
        workspace.dir,
        sliceRef,
        "post-worker recovery could not resolve the retained slice tip",
        SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH
      );
      if (recoveryCommit === binding.base_sha) return null;
      throw lifecycleError(
        "agent_launch.slice_review_materialization.recovery_terminal_authority_unavailable.v1",
        "committed exact-slice recovery cannot establish trusted worker termination",
        {
          assigned_unit: status.subject,
          launch_ref: status.monitor_handle,
          qualified_run_id: binding.run_id,
          retry_id: binding.retry_id,
          slice_ref: sliceRef,
          base_sha: binding.base_sha,
          reviewed_sha: recoveryCommit,
          recovery_authority: "binding_and_git_truth_only"
        }
      );
    } else {
      const commit = resolvedCommit(
        runGit,
        workspace.dir,
        sliceRef,
        "post-worker lifecycle could not resolve the committed slice tip",
        SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH
      );
      if (commit === binding.base_sha) {
        return Object.freeze({
          invoked: false,
          phase: POST_WORKER_LIFECYCLE_PHASES.PRE_INTEGRATION,
          reason: "committed_slice_result_absent"
        });
      }

      await prepareExactSliceReviewSurface({
        status,
        binding,
        sliceRef,
        commit,
        runGit,
        deps
      });

      checkpoint.slice_review = await freezeSliceReviewSurface({
        workspaceDir: workspace.dir,
        status,
        bindings,
        binding,
        sliceRef,
        wkId,
        sliceId,
        commit,
        deps
      });
      checkpoint.phase = POST_WORKER_LIFECYCLE_PHASES.AWAITING_SLICE_REVIEW;
    }
  }

  if (checkpoint.phase === POST_WORKER_LIFECYCLE_PHASES.AWAITING_SLICE_REVIEW) {
    const sliceReview = checkpoint.slice_review;

    const acceptance = enforcementMode === REVIEW_ENFORCEMENT_MODES.ENFORCED_CCE &&
      typeof deps.resolveSliceReviewAcceptanceBinding === "function"
      ? deps.resolveSliceReviewAcceptanceBinding({ subject: sliceReview.review_subject })
      : null;
    if (enforcementMode === REVIEW_ENFORCEMENT_MODES.ENFORCED_CCE && !acceptance) {
      return awaitingSliceReviewResult(sliceReview);
    }

    if (acceptance !== null && acceptance.reviewed_sha !== sliceReview.reviewed_sha) {
      return awaitingSliceReviewResult(sliceReview, {
        reason: "slice_review_acceptance_sha_moved",
        accepted_sha: acceptance.reviewed_sha
      });
    }

    if (typeof deps.hostSliceIntegrationAdapter !== "function") {
      throw new Error("managed post-worker lifecycle requires the writable host slice integration adapter");
    }
    let integration;
    try {
      integration = await delegateSliceIntegrationToHost({
        status,
        adapter: deps.hostSliceIntegrationAdapter
      });
    } catch (error) {
      if (enforcementMode !== REVIEW_ENFORCEMENT_MODES.POLICY_ONLY) throw error;
      const cause = classifyTerminalReviewPolicyRefusal(error);
      if (cause === null) throw error;
      integration = recoverIntegratedSliceResult({
        mainRepo: workspace.dir,
        binding,
        sliceRef,
        wkRef,
        runGit,
        deps
      });
      if (!integration) {
        throw policyLifecycleError(
          POLICY_LIFECYCLE_CODES.RECONCILIATION_FAILED,
          "known upstream terminal-review refusal could not reconcile the integrated slice",
          { cause_code: cause.code },
          error
        );
      }
      checkpoint.terminal_review_policy_cause = cause;
    }
    checkpoint.integration = integration;
    checkpoint.phase = POST_WORKER_LIFECYCLE_PHASES.INTEGRATED;
  }

  if (checkpoint.phase === POST_WORKER_LIFECYCLE_PHASES.FINALIZED) {
    return checkpoint.finalized;
  }

  let integration = checkpoint.integration;

  if (integration?.recovered === true && integration.review_target == null &&
      integration.slice_sha === integration.wk_sha) {
    const recoveredReviewUnit = assertCanonicalReviewIdentity(
      deps.resolveCanonicalReviewUnit({ mainRepo: workspace.dir, wkId }),
      { wkId, initiative }
    );
    if (recoveredReviewUnit.parent_status === "done") {
      if (enforcementMode === REVIEW_ENFORCEMENT_MODES.ENFORCED_CCE) {
        throw lifecycleError(
          TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.TRANSPORTED_EVIDENCE_MISSING,
          "enforced CCE recovery requires transported terminal-review evidence",
          { recovered: true, canonical_status: "done" }
        );
      }
      const reviewTarget = reconstructPolicyReviewTarget({
        runGit,
        workspaceDir: workspace.dir,
        initiative,
        wkId,
        wkRef,
        wkSha: integration.wk_sha
      });
      integration = Object.freeze({ ...integration, review_target: reviewTarget });
      checkpoint.integration = integration;
      checkpoint.terminal_review_policy_cause ??= restartMissingEvidenceCause(integration);
    }
  }

  if (integration && integration.review_target == null) {
    const dispatchable = Object.freeze({
      invoked: true,
      phase: POST_WORKER_LIFECYCLE_PHASES.FINALIZED,
      integrated: true,
      wk_transitioned_to_review: false,
      integration,
      reviewer_dispatch: null
    });
    checkpoint.finalized = dispatchable;
    checkpoint.phase = POST_WORKER_LIFECYCLE_PHASES.FINALIZED;
    return dispatchable;
  }

  assertTerminalTargetOwnership(integration);

  reviewUnit = deps.resolveCanonicalReviewUnit({ mainRepo: workspace.dir, wkId });
  if (reviewUnit?.record_id !== wkId ||
      (reviewUnit?.initiative !== undefined && reviewUnit.initiative !== initiative)) {
    throw new Error("canonical review unit does not match the exact launcher WK identity");
  }

  let materialization;
  let policyCause = checkpoint.terminal_review_policy_cause ?? null;
  if (policyCause === null) {
    try {
      materialization = resolveTerminalReviewEvidence({
        deps,
        integration,
        bindings,
        status,
        wkRef,
        runGit,
        workspaceDir: workspace.dir
      });
    } catch (error) {
      if (enforcementMode !== REVIEW_ENFORCEMENT_MODES.POLICY_ONLY) throw error;
      policyCause = classifyTerminalReviewPolicyRefusal(error);
      if (policyCause === null) throw error;
    }
  }
  if (policyCause !== null) {
    const finalized = await finalizePolicyOnlyWithoutReviewer({
      workspaceDir: workspace.dir,
      deps,
      binding,
      sliceRef,
      wkRef,
      runGit,
      integration,
      initiative,
      wkId,
      cause: policyCause
    });
    checkpoint.finalized = finalized;
    checkpoint.phase = POST_WORKER_LIFECYCLE_PHASES.FINALIZED;
    return finalized;
  }
  const reviewContext = await deps.bindFrozenReviewContext({
    status,
    provisioning: bindings.provisioning,
    integration,
    reviewUnit
  });
  deps.markCommitAuthorityExercised?.();
  const finalized = Object.freeze({
    invoked: true,
    phase: POST_WORKER_LIFECYCLE_PHASES.FINALIZED,
    integrated: true,
    wk_transitioned_to_review: true,
    integration,
    terminal_review_materialization: materialization,
    reviewer_dispatch: Object.freeze({
      tool: "workspace_agent_dispatch",
      args: Object.freeze({ role: "reviewer", subject: reviewUnit.subject }),
      context: Object.freeze({
        frozen_review_target: integration.review_target,
        terminal_review_materialization: materialization,
        complete_parent_wk_contract: true,
        accumulated_wk_diff: true,
        review_context_schema_version: reviewContext.schema_version
      })
    }),
    review_result_evidence: Object.freeze({
      status_tool: "workspace_agent_run_status",
      wait_tool: "workspace_agent_run_wait"
    })
  });
  checkpoint.finalized = finalized;
  checkpoint.phase = POST_WORKER_LIFECYCLE_PHASES.FINALIZED;
  return finalized;
}
