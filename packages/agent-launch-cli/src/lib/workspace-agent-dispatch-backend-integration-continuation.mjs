

import path from "node:path";
import {
  recoverZeroDeltaIntegratedSlice,
  resolveAuthenticatedExactSliceDeliveryBase,
  SliceIntegrationError
} from "./slice-integration.mjs";
import { isPlainObject } from "./backend-review-identity.mjs";
import { EXACT_IMPLEMENTATION_SLICE_RE } from "./backend-constants.mjs";
import {
  deepFreezeCanonicalSnapshot,
  groupTrustedReviewReceiptsByReviewedIdentity,
  resolveCanonicalIntegratedSliceState,
  resolveCanonicalSliceReviewUnit,
  verifyFrozenSliceReviewTargetAgainstObjectStore,
  resolveCanonicalSliceIntegrationUnit,
  resolveFrozenSliceReviewReceiptContract
} from "./backend-scope-authority.mjs";
import {
  digestTrustedExactReviewEvidence,
  EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V3,
  validateExactSliceReviewReceipt,
  receiptCarriesUsableReviewVerdict
} from "./workspace-agent-dispatch-run-receipt.mjs";
import {
  resolveUniqueManagedLifecycleBindingPairForRecovery
} from "./worktree-substrate-identity.mjs";

export const AUTHENTICATED_INTEGRATION_CONTINUATION = Symbol(
  "workspace-agent.authenticated-integration-continuation"
);

export const INTEGRATION_CONTINUATION_DIAGNOSTIC_CODE =
  "agent_launch.slice_integration.continuation_authority_refused.v1";

const CANONICAL_CONTINUATION_REFUSAL_MESSAGES = new Set([
  "exact slice review receipt frozen contract is not valid JSON",
  "exact slice review receipt frozen contract is not a pre-integration review unit",
  "exact slice review receipt parent and slice contracts disagree",
  "canonical integrated contract projection is not a work record",
  "canonical integrated contract projection carries no slices",
  "canonical integrated slice is absent from the frozen receipt contract",
  "integrated slice subject is not canonical",
  "canonical integrated slice identity is unavailable",
  "canonical corrective integrated slice state is inconsistent",
  "canonical final integrated slice state is inconsistent",
  "canonical non-final integrated slice state is inconsistent",
  "canonical integrated state changed beyond the permitted lifecycle transition"
]);

export function continuationRefusal(reason, detail = null, cause = null) {
  throw new SliceIntegrationError(
    `agent-launch slice-integration: durable integration continuation refused: ${reason}`,
    {
      code: INTEGRATION_CONTINUATION_DIAGNOSTIC_CODE,
      detail: Object.freeze({ reason, ...(detail ?? {}) }),
      cause
    }
  );
}

function normalizedBranchRef(value) {
  return typeof value === "string" && value.startsWith("refs/heads/")
    ? value
    : `refs/heads/${value ?? ""}`;
}

export function brandedContinuation(fields) {
  const continuation = { ...fields };
  Object.defineProperty(continuation, AUTHENTICATED_INTEGRATION_CONTINUATION, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false
  });
  return Object.freeze(continuation);
}

export function createBackendIntegrationContinuation(ctx) {
  const {
    worktreeProvisioningConfig,
    reviewContextRunGit,
    frozenSliceReviewContexts,
    exactSliceReviewReceiptStore
  } = ctx;

  function resolveLiveCommit(ref, reason) {
    const result = reviewContextRunGit({
      repo: worktreeProvisioningConfig.mainRepo,
      args: ["rev-parse", "--verify", `${ref}^{commit}`]
    });
    const sha = result?.ok === true ? String(result.stdout ?? "").trim() : null;
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(sha ?? "") || /^0+$/u.test(sha)) {
      continuationRefusal(reason, { ref, source_code: result?.code ?? null });
    }
    return sha;
  }

  function refuseCanonicalRecordRepair() {
    continuationRefusal("canonical_record_repair_required");
  }

  function authenticateCanonicalContinuationState({ receipt, integrationUnit, integration }) {
    let frozenReviewUnit;
    let canonicalState;
    try {
      frozenReviewUnit = resolveFrozenSliceReviewReceiptContract(receipt);
      canonicalState = resolveCanonicalIntegratedSliceState(
        worktreeProvisioningConfig.mainRepo,
        receipt.unit_address,
        frozenReviewUnit
      );
    } catch (error) {

      if (!(error instanceof Error) ||
          !CANONICAL_CONTINUATION_REFUSAL_MESSAGES.has(error.message)) {
        throw error;
      }
      continuationRefusal("canonical_record_contract_disagreement", {
        expected_subject: `${integrationUnit.record_id}#${integrationUnit.slice_id}`
      }, error);
    }
    const expectedSubject = `${integrationUnit.record_id}#${integrationUnit.slice_id}`;
    if (frozenReviewUnit.subject !== expectedSubject || receipt.unit_address !== expectedSubject ||
        canonicalState.record_id !== integrationUnit.record_id ||
        canonicalState.slice_id !== integrationUnit.slice_id ||
        canonicalState.initiative !== integrationUnit.initiative) {
      continuationRefusal("canonical_record_identity_disagreement", {
        expected_subject: expectedSubject,
        receipt_subject: receipt.unit_address,
        frozen_subject: frozenReviewUnit.subject
      });
    }
    if (canonicalState.corrective === true) {
      continuationRefusal("canonical_record_corrective_state", {
        expected_subject: expectedSubject,
        parent_status: canonicalState.parent_status,
        slice_status: canonicalState.slice_status
      });
    }
    if (canonicalState.lifecycle_state !== integration.integrated_state) {
      continuationRefusal("canonical_record_lifecycle_state_disagreement", {
        expected_subject: expectedSubject,
        canonical_integrated_state: canonicalState.lifecycle_state,
        recovered_integrated_state: integration.integrated_state
      });
    }
    return Object.freeze({
      parent_status: canonicalState.parent_status,
      slice_status: canonicalState.slice_status,
      integrated_state: canonicalState.lifecycle_state
    });
  }

  async function resolveDurableZeroDeltaIntegrationContinuation({ subject, status }) {
    if (worktreeProvisioningConfig === null || status === null || status === undefined) {
      return null;
    }
    if (typeof status.run_id !== "string" || typeof status.monitor_handle !== "string" ||
        status.subject !== subject) {
      continuationRefusal("worker_status_selector_mismatch");
    }
    let integrationUnit;
    let pair;
    try {
      integrationUnit = resolveCanonicalSliceIntegrationUnit(
        worktreeProvisioningConfig.mainRepo,
        subject
      );
      pair = resolveUniqueManagedLifecycleBindingPairForRecovery({
        mainRepo: worktreeProvisioningConfig.mainRepo,
        launchRef: status.monitor_handle,
        expectedSubject: subject,
        allowMissingSliceWorktree: true
      });
    } catch (error) {
      continuationRefusal("durable_worker_binding_invalid", {
        source_code: typeof error?.code === "string" ? error.code : null
      }, error);
    }
    if (pair === null) return null;
    if (pair.run_id !== status.run_id || pair.retry_id !== pair.slice_binding.retry_id ||
        pair.retry_id !== pair.wk_binding.retry_id ||
        pair.slice_binding.launch_ref !== status.monitor_handle ||
        pair.wk_binding.launch_ref !== status.monitor_handle ||
        pair.slice_binding.unit_address !==
          `${integrationUnit.initiative}/${integrationUnit.record_id}/${integrationUnit.slice_id}`) {
      continuationRefusal("durable_worker_tuple_mismatch", {
        expected_run_id: pair.run_id,
        actual_run_id: status.run_id,
        retry_id: pair.retry_id
      });
    }
    const sliceRef = `refs/heads/slice/${integrationUnit.initiative}/${integrationUnit.record_id}/${integrationUnit.slice_id}`;
    const wkRef = `refs/heads/wk/${integrationUnit.initiative}/${integrationUnit.record_id}`;
    if (normalizedBranchRef(pair.slice_binding.output_branch) !== sliceRef ||
        normalizedBranchRef(pair.wk_binding.output_branch) !== wkRef) {
      continuationRefusal("durable_worker_ref_mismatch", { slice_ref: sliceRef, wk_ref: wkRef });
    }

    const integration = await recoverZeroDeltaIntegratedSlice({
      mainRepo: worktreeProvisioningConfig.mainRepo,
      unitAddress: pair.slice_binding.unit_address,
      sliceRef,
      wkRef,

      writeRecordCas: refuseCanonicalRecordRepair,
      deps: { runGit: reviewContextRunGit }
    });
    if (integration === null) return null;

    if (exactSliceReviewReceiptStore === null ||
        typeof exactSliceReviewReceiptStore.loadAll !== "function") {
      continuationRefusal("exact_v3_review_receipt_unavailable");
    }

    const deliveryBase = resolveAuthenticatedExactSliceDeliveryBase({
      runGit: reviewContextRunGit,
      mainRepo: worktreeProvisioningConfig.mainRepo,
      subject,
      deliverySha: integration.delivery_sha
    });
    if (deliveryBase === null || pair.slice_binding.base_sha !== deliveryBase) {
      continuationRefusal("reviewed_delivery_base_mismatch", {
        binding_base_sha: pair.slice_binding.base_sha,
        authenticated_base_sha: deliveryBase
      });
    }

    let receipts;
    try {
      receipts = await exactSliceReviewReceiptStore.loadAll({ unit_address: subject });
      if (!Array.isArray(receipts)) throw new TypeError("receipt store returned a non-array result");
      receipts = receipts.map((receipt) => validateExactSliceReviewReceipt(receipt, {
        unit_address: subject
      }));
    } catch (error) {
      continuationRefusal("exact_v3_review_receipt_unavailable", {
        source_code: typeof error?.code === "string" ? error.code : null
      }, error);
    }
    const completeMatches = receipts.filter((receipt) =>
      receipt.schema_version === EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V3 &&
      receiptCarriesUsableReviewVerdict(receipt) &&
      receipt.review_admission_kind === "canonical_committed_slice" &&
      receipt.initiative === integrationUnit.initiative &&
      receipt.record_id === integrationUnit.record_id &&
      receipt.slice_id === integrationUnit.slice_id &&
      receipt.slice_ref === sliceRef &&
      receipt.reviewed_sha === integration.delivery_sha &&
      receipt.diff_base_sha === deliveryBase &&
      receipt.worktree_path === pair.slice_binding.worktree_path &&
      receipt.worktree_identity?.slice_ref === sliceRef &&
      receipt.worktree_identity?.wk_ref === wkRef &&
      receipt.worktree_identity?.reviewed_sha === integration.delivery_sha &&
      receipt.worktree_identity?.diff_base_sha === deliveryBase &&
      receipt.worktree_identity?.wk_sha === integration.previous_wk_sha);
    if (completeMatches.length !== 1) {
      continuationRefusal(
        completeMatches.length === 0
          ? "exact_v3_review_receipt_missing"
          : "exact_v3_review_receipt_ambiguous",
        { match_count: completeMatches.length, reviewed_sha: integration.delivery_sha }
      );
    }
    const receipt = completeMatches[0];
    authenticateCanonicalContinuationState({
      receipt,
      integrationUnit,
      integration
    });
    const liveSliceTip = resolveLiveCommit(sliceRef, "live_slice_ref_unavailable");
    const liveWkTip = resolveLiveCommit(wkRef, "live_wk_ref_unavailable");
    if (liveSliceTip !== integration.delivery_sha || liveWkTip !== integration.wk_sha) {
      continuationRefusal("live_ref_disagreement", {
        expected_slice_tip: integration.delivery_sha,
        actual_slice_tip: liveSliceTip,
        expected_wk_tip: integration.wk_sha,
        actual_wk_tip: liveWkTip
      });
    }

    const confirmed = await recoverZeroDeltaIntegratedSlice({
      mainRepo: worktreeProvisioningConfig.mainRepo,
      unitAddress: pair.slice_binding.unit_address,
      sliceRef,
      wkRef,
      writeRecordCas: refuseCanonicalRecordRepair,
      deps: { runGit: reviewContextRunGit }
    });
    if (confirmed === null ||
        confirmed.delivery_sha !== integration.delivery_sha ||
        confirmed.previous_wk_sha !== integration.previous_wk_sha ||
        confirmed.slice_sha !== integration.slice_sha ||
        confirmed.wk_sha !== integration.wk_sha ||
        confirmed.integrated_state !== integration.integrated_state ||
        JSON.stringify(confirmed.review_target) !== JSON.stringify(integration.review_target) ||
        JSON.stringify(confirmed.transition) !== JSON.stringify(integration.transition)) {
      continuationRefusal("continuation_authority_changed_during_lookup");
    }

    const canonicalState = authenticateCanonicalContinuationState({
      receipt,
      integrationUnit,
      integration: confirmed
    });

    const authority = Object.freeze({
      schema_version: "workspace-agent-zero-delta-integration-continuation-authority.v1",
      repository: worktreeProvisioningConfig.mainRepo,
      subject,
      run_id: pair.run_id,
      launch_ref: status.monitor_handle,
      retry_id: pair.retry_id,
      review_receipt_digest: receipt.receipt_digest,
      review_run_id: receipt.review_run_id,
      review_monitor_handle: receipt.review_monitor_handle,
      committed_target_digest: receipt.committed_target_digest,
      reviewed_delivery_sha: integration.delivery_sha,
      delivery_base_sha: deliveryBase,
      integration_base_sha: integration.previous_wk_sha,
      integration_result_sha: integration.slice_sha,
      slice_ref: sliceRef,
      slice_tip_sha: liveSliceTip,
      wk_ref: wkRef,
      wk_tip_sha: liveWkTip,
      canonical_state: canonicalState
    });
    return brandedContinuation({
      requested: true,
      completed: true,
      reviewed_sha: integration.delivery_sha,
      integration: confirmed,
      authority
    });
  }

  function isCanonicalCorrectiveContinuationTuple(subject) {
    const unit = resolveCanonicalSliceIntegrationUnit(
      worktreeProvisioningConfig.mainRepo,
      subject
    );

    const slice = JSON.parse(unit.review_unit_contract);
    return unit.parent_status === "active" && isPlainObject(slice) && slice.status === "todo";
  }

  async function resolveCorrectiveFindingsContext({ subject, workspace_dir: workspaceDir }) {
    if (exactSliceReviewReceiptStore === null ||
        path.resolve(workspaceDir ?? "") !== worktreeProvisioningConfig?.mainRepo ||
        !EXACT_IMPLEMENTATION_SLICE_RE.test(subject ?? "")) return null;
    const targetContext = frozenSliceReviewContexts.get(subject) ?? null;
    if (targetContext === null) return null;
    const receipts = await exactSliceReviewReceiptStore.loadAll({
      unit_address: subject,
      committed_target_digest: targetContext.committed_target_digest
    });
    const findingsReceipts = receipts.filter((receipt) =>
      receiptCarriesUsableReviewVerdict(receipt) &&
      receipt.structured_outcome?.outcome === "changes_requested"
    );
    if (findingsReceipts.length === 0) return null;

    const groups = groupTrustedReviewReceiptsByReviewedIdentity(findingsReceipts);

    if (isCanonicalCorrectiveContinuationTuple(subject)) return null;
    const current = resolveCanonicalSliceReviewUnit(worktreeProvisioningConfig.mainRepo, subject);
    const currentParentDigest = digestTrustedExactReviewEvidence(current.canonical_parent_wk_contract);
    const currentSliceDigest = digestTrustedExactReviewEvidence(current.review_unit_contract);

    const matched = groups.filter((group) =>
      group.witness.canonical_parent_contract_digest === currentParentDigest &&
      group.witness.slice_review_contract_digest === currentSliceDigest);

    if (matched.length !== 1) return null;
    const elected = matched[0];
    const witness = elected.witness;
    const context = {
      slice_ref: witness.slice_ref,
      reviewed_sha: witness.reviewed_sha,
      diff_base_sha: witness.diff_base_sha
    };
    if (verifyFrozenSliceReviewTargetAgainstObjectStore({
      mainRepo: worktreeProvisioningConfig.mainRepo,
      context,
      runGit: reviewContextRunGit
    }).ok !== true) return null;
    return deepFreezeCanonicalSnapshot({
      schema_version: "workspace-agent-trusted-corrective-findings-context.v1",
      authority: "launcher_exact_review_receipt",
      unit_address: subject,
      source_worker_run_id: targetContext.source_worker_run_id ?? null,
      source_worker_monitor_handle: targetContext.source_worker_monitor_handle ?? null,
      review_run_ids: elected.receipts.map((entry) => entry.review_run_id),
      review_monitor_handles: elected.receipts.map((entry) => entry.review_monitor_handle),
      reviewed_sha: witness.reviewed_sha,
      diff_base_sha: witness.diff_base_sha,
      findings: elected.receipts.flatMap((entry) => entry.structured_outcome.findings),
      trusted_evidence_digests: elected.receipts.map((entry) => entry.trusted_evidence_digest)
    });
  }

  return {
    resolveDurableZeroDeltaIntegrationContinuation,
    resolveCorrectiveFindingsContext
  };
}
