

import {
  computeWorkRecordSourceDigest,
  setWorkRecordStatusByUnit
} from "../../../wiki-core/src/index.mjs";
import { SLICE_INTEGRATION_DIAGNOSTIC_CODES } from
  "../../../agent-launch-cli/src/lib/slice-integration.mjs";
import {
  classifyTerminalReviewPolicyRefusal,
  TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES
} from "./dispatch-terminal-review-evidence.mjs";
import {
  lifecycleError,
  POST_WORKER_LIFECYCLE_PHASES,
  recoverIntegratedSliceResult,
  resolvedCommit
} from "./dispatch-post-worker-lifecycle-bindings.mjs";

export const REVIEW_ENFORCEMENT_MODES = Object.freeze({
  CONFIGURED_POLICY: "configured_policy",
  POLICY_ONLY: "policy_only"
});

const POLICY_DISPOSITION_SCHEMA_VERSION =
  "workspace-agent-terminal-review-policy-disposition.v1";

export const POLICY_LIFECYCLE_CODES = Object.freeze({
  RECONCILIATION_FAILED:
    "agent_launch.terminal_review_policy.reconciliation_failed.v1",
  INTEGRATION_MISMATCH:
    "agent_launch.terminal_review_policy.integration_mismatch.v1",
  CANONICAL_STATE_INVALID:
    "agent_launch.terminal_review_policy.canonical_state_invalid.v1",
  STATUS_CAS_FAILED:
    "agent_launch.terminal_review_policy.status_cas_failed.v1"
});

export const OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

export function reviewEnforcementMode(deps) {
  const mode = deps.reviewEnforcementMode ?? REVIEW_ENFORCEMENT_MODES.POLICY_ONLY;
  if (mode !== REVIEW_ENFORCEMENT_MODES.CONFIGURED_POLICY &&
      mode !== REVIEW_ENFORCEMENT_MODES.POLICY_ONLY) {
    throw new Error("post-worker lifecycle requires an exact launcher-owned review enforcement mode");
  }
  return mode;
}

export function policyLifecycleError(code, message, detail = null, cause = null) {
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

export function sameReviewTarget(left, right) {
  const fields = [
    "schema_version", "unit_address", "ref", "sha", "diff_base_sha",
    "diff_head_sha", "diff_range", "complete_parent_wk_contract",
    "accumulated_wk_diff"
  ];
  return left !== null && right !== null && fields.every((field) => left[field] === right[field]);
}

export function assertTerminalTargetOwnership(integration) {
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

export function reconstructPolicyReviewTarget({ runGit, workspaceDir, initiative, wkId, wkRef, wkSha }) {
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

export function assertCanonicalReviewIdentity(reviewUnit, { wkId, initiative }) {
  if (reviewUnit?.record_id !== wkId || reviewUnit?.initiative !== initiative) {
    throw policyLifecycleError(
      POLICY_LIFECYCLE_CODES.CANONICAL_STATE_INVALID,
      "policy-only completion canonical review unit does not match the exact launcher WK identity"
    );
  }
  return reviewUnit;
}

export async function finalizePolicyOnlyWithoutReviewer({
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

export function restartMissingEvidenceCause(integration) {
  const error = lifecycleError(
    TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.MODE_UNAVAILABLE,
    "restart reconstruction has no durably retained terminal-review evidence cause",
    {
      recovered: integration?.recovered === true,
      reconstruction: "exact_integration_reconciled_without_retained_evidence"
    }
  );
  return classifyTerminalReviewPolicyRefusal(error);
}
