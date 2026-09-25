

import {
  resolveControlledContractAttachmentGeneration
} from "@agent-chassis/wiki-core/src/lib/controlled-contract-tools.mjs";
import {
  authenticateControlledContractGenerationAtW,
  CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES,
  resolveControlledContractGenerationBinding
} from "./controlled-carrier-attachment-primitive.mjs";
import {
  readCanonicalContractGenerationIdentity
} from "./slice-integration-authorization.mjs";
import {
  observeIntegratedSliceDelivery,
  resolveAuthenticatedExactSliceDeliveryBase,
  SliceIntegrationError
} from "./slice-integration.mjs";
import {
  resolveCanonicalSliceIntegrationUnit
} from "./backend-scope-authority.mjs";
import {
  resolveUniqueManagedLifecycleBindingPairForRecovery
} from "./worktree-substrate-identity.mjs";

export const AUTHENTICATED_INTEGRATION_CONTINUATION = Symbol(
  "workspace-agent.authenticated-integration-continuation"
);

export const INTEGRATION_CONTINUATION_DIAGNOSTIC_CODE =
  "agent_launch.slice_integration.continuation_authority_refused.v1";

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

const UNAVAILABLE_GENERATION_CODES = new Set([
  CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.GIT_FAILED,
  CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.REF_UNRESOLVABLE,
  CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.INDETERMINATE
]);

function readContinuationGenerationIdentity(repo, wkId) {
  try {
    return readCanonicalContractGenerationIdentity(repo, wkId);
  } catch (error) {
    continuationRefusal("controlled_contract_generation_malformed", {
      source_code: typeof error?.code === "string" ? error.code : null,
      source_reason: error?.detail?.reason ?? null
    }, error);
  }
}

async function authenticateContinuationGeneration({ repo, wkId, wkTip, emptyDelivery }) {
  const identity = readContinuationGenerationIdentity(repo, wkId);
  if (identity.state === "absent") {

    if (emptyDelivery !== true) continuationRefusal("controlled_contract_generation_missing");
    return identity;
  }
  try {
    const generation = await resolveControlledContractAttachmentGeneration({ repoRoot: repo, wkId });
    if (generation === null) {
      continuationRefusal("continuation_authority_changed_during_lookup");
    }
    const binding = await resolveControlledContractGenerationBinding({
      repoRoot: repo, wkId, generation, lifecycleBinding: null, deps: {}
    });
    if (binding.wk_tip_sha !== wkTip) {
      continuationRefusal("continuation_authority_changed_during_lookup");
    }
    await authenticateControlledContractGenerationAtW({ binding, deps: {} });
  } catch (error) {
    if (error instanceof SliceIntegrationError) throw error;
    const reason = error?.code ===
        CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.W_AUTHENTICATION_FAILED
      ? "controlled_contract_generation_stale"
      : UNAVAILABLE_GENERATION_CODES.has(error?.code)
        ? "controlled_contract_generation_unavailable"
        : "controlled_contract_generation_malformed";
    continuationRefusal(reason, {
      source_code: typeof error?.code === "string" ? error.code : null,
      cause_code: error?.details?.cause_code ?? null,
      expected_generation: identity.digest
    }, error);
  }
  const confirmed = readContinuationGenerationIdentity(repo, wkId);
  if (JSON.stringify(confirmed) !== JSON.stringify(identity)) {
    continuationRefusal("controlled_contract_generation_stale", {
      expected_generation: identity.digest,
      observed_generation: confirmed.digest
    });
  }
  return identity;
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

export function committedSliceIntegrationDeliveryKey(context) {
  const fields = [
    context?.main_repo,
    context?.review_admission_kind,
    context?.review_subject,
    context?.initiative,
    context?.record_id,
    context?.review_slice_id,
    context?.slice_ref,
    context?.reviewed_sha,
    context?.diff_base_sha
  ];
  if (fields.some((value) => typeof value !== "string")) {
    throw new TypeError("committed-slice completion requires exact delivery identity");
  }
  return JSON.stringify(fields);
}

export function createBackendIntegrationContinuation(ctx) {
  const {
    worktreeProvisioningConfig,
    reviewContextRunGit,
    postWorkerLifecycleRunGit = reviewContextRunGit,
    frozenSliceReviewContexts,
    exactSliceReviewReceiptStore,
    canonicalCommittedSliceIntegrationsByDelivery
  } = ctx;

  async function resolveLiveCommit(ref, reason) {
    const result = await postWorkerLifecycleRunGit({
      repo: worktreeProvisioningConfig.mainRepo,
      args: ["rev-parse", "--verify", `${ref}^{commit}`]
    });
    const sha = result?.ok === true ? String(result.stdout ?? "").trim() : null;
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(sha ?? "") || /^0+$/u.test(sha)) {
      continuationRefusal(reason, { ref, source_code: result?.code ?? null });
    }
    return sha;
  }

  async function resolveLiveCompletedIntegration({ subject, status }) {
    if (canonicalCommittedSliceIntegrationsByDelivery?.size === 0) return null;
    if (worktreeProvisioningConfig === null || status === null || status === undefined) {
      return null;
    }
    if (typeof status.run_id !== "string" || typeof status.monitor_handle !== "string" ||
        status.subject !== subject) {
      continuationRefusal("worker_status_selector_mismatch");
    }
    let pair;
    try {
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
        pair.wk_binding.launch_ref !== status.monitor_handle) {
      continuationRefusal("durable_worker_tuple_mismatch", {
        expected_run_id: pair.run_id,
        actual_run_id: status.run_id,
        retry_id: pair.retry_id
      });
    }
    const [initiative, recordId, sliceId, extra] =
      String(pair.slice_binding.unit_address ?? "").split("/");
    if (extra !== undefined || subject !== `${recordId}#${sliceId}` ||
        pair.wk_binding.unit_address !== `${initiative}/${recordId}`) {
      continuationRefusal("durable_worker_tuple_mismatch", {
        expected_subject: `${recordId}#${sliceId}`,
        actual_subject: subject,
        retry_id: pair.retry_id
      });
    }
    const sliceRef = `refs/heads/slice/${initiative}/${recordId}/${sliceId}`;
    const wkRef = `refs/heads/wk/${initiative}/${recordId}`;
    if (normalizedBranchRef(pair.slice_binding.output_branch) !== sliceRef ||
        normalizedBranchRef(pair.wk_binding.output_branch) !== wkRef) {
      continuationRefusal("durable_worker_ref_mismatch", { slice_ref: sliceRef, wk_ref: wkRef });
    }
    const deliverySha = await resolveLiveCommit(sliceRef, "live_slice_ref_unavailable");
    const deliveryBase = await resolveAuthenticatedExactSliceDeliveryBase({
      runGit: postWorkerLifecycleRunGit,
      mainRepo: worktreeProvisioningConfig.mainRepo,
      subject,
      deliverySha
    });
    if (deliveryBase === null || pair.slice_binding.base_sha !== deliveryBase) {
      continuationRefusal("reviewed_delivery_base_mismatch", {
        binding_base_sha: pair.slice_binding.base_sha,
        authenticated_base_sha: deliveryBase
      });
    }
    const completed = canonicalCommittedSliceIntegrationsByDelivery.get(
      committedSliceIntegrationDeliveryKey({
        main_repo: worktreeProvisioningConfig.mainRepo,
        review_admission_kind: "canonical_committed_slice",
        review_subject: subject,
        initiative,
        record_id: recordId,
        review_slice_id: sliceId,
        slice_ref: sliceRef,
        reviewed_sha: deliverySha,
        diff_base_sha: deliveryBase
      })
    );
    if (completed === undefined) return null;
    const completedIntegration = await completed;
    const liveWkTip = await resolveLiveCommit(wkRef, "live_wk_ref_unavailable");
    const target = completedIntegration?.boundary_authorization?.target;
    if (completedIntegration?.integrated !== true ||
        completedIntegration.delivery_sha !== deliverySha ||
        completedIntegration.slice_ref !== sliceRef ||
        completedIntegration.wk_ref !== wkRef ||
        completedIntegration.wk_sha !== liveWkTip ||
        target?.subject !== subject || target?.slice_ref !== sliceRef ||
        target?.reviewed_sha !== deliverySha || target?.diff_base_sha !== deliveryBase ||
        typeof target?.committed_target_digest !== "string") {
      continuationRefusal("warm_completed_integration_mismatch");
    }
    return brandedContinuation({
      requested: true,
      completed: true,
      reviewed_sha: deliverySha,
      integration: completedIntegration
    });
  }

  async function resolveLiteralIntegrationBase(integration) {
    if (integration?.empty_delivery === true) return integration.previous_wk_sha;
    const oid = integration?.slice_sha;
    const type = await postWorkerLifecycleRunGit({
      repo: worktreeProvisioningConfig.mainRepo,
      args: ["--no-replace-objects", "cat-file", "-t", oid]
    });
    const body = await postWorkerLifecycleRunGit({
      repo: worktreeProvisioningConfig.mainRepo,
      args: ["--no-replace-objects", "cat-file", "commit", oid]
    });
    if (type?.ok !== true || type.stdout !== "commit\n" || body?.ok !== true ||
        typeof body.stdout !== "string" || body.stdout.includes("\0") ||
        body.stdout.includes("\r") || body.stdout.includes("\uFFFD")) {
      continuationRefusal("integration_result_invalid", { integration_result_sha: oid ?? null });
    }
    const separator = body.stdout.indexOf("\n\n");
    const headers = separator < 0 ? [] : body.stdout.slice(0, separator).split("\n");
    const parents = headers
      .filter((line) => line.startsWith("parent "))
      .map((line) => line.slice("parent ".length));
    if (parents.length !== 1 ||
        !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(parents[0]) ||
        /^0+$/u.test(parents[0]) || parents[0].length !== oid.length) {
      continuationRefusal("integration_result_invalid", { integration_result_sha: oid ?? null });
    }
    const parentType = await postWorkerLifecycleRunGit({
      repo: worktreeProvisioningConfig.mainRepo,
      args: ["--no-replace-objects", "cat-file", "-t", parents[0]]
    });
    if (parentType?.ok !== true || parentType.stdout !== "commit\n") {
      continuationRefusal("integration_result_invalid", {
        integration_result_sha: oid,
        integration_base_sha: parents[0]
      });
    }
    return parents[0];
  }

  async function recoverDurableIntegratedSlice({ integrationUnit, pair, sliceRef, wkRef }) {
    const integration = await observeIntegratedSliceDelivery({
      mainRepo: worktreeProvisioningConfig.mainRepo,
      unitAddress: pair.slice_binding.unit_address,
      sliceRef,
      wkRef,
      deps: { runGit: postWorkerLifecycleRunGit }
    });
    if (integration === null) return null;
    if (integration.slice_ref !== sliceRef || integration.wk_ref !== wkRef) {
      continuationRefusal("integration_result_invalid", {
        expected_subject: `${integrationUnit.record_id}#${integrationUnit.slice_id}`
      });
    }
    if (integration.empty_delivery === true) return integration;
    return Object.freeze({
      ...integration,
      previous_wk_sha: await resolveLiteralIntegrationBase(integration)
    });
  }

  async function resolveDurableIntegrationContinuation({ subject, status }) {
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

    const integration = await recoverDurableIntegratedSlice({
      integrationUnit,
      pair,
      sliceRef,
      wkRef
    });
    if (integration === null) return null;

    const deliveryBase = await resolveAuthenticatedExactSliceDeliveryBase({
      runGit: postWorkerLifecycleRunGit,
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

    const liveSliceTip = await resolveLiveCommit(sliceRef, "live_slice_ref_unavailable");
    const liveWkTip = await resolveLiveCommit(wkRef, "live_wk_ref_unavailable");
    if (liveSliceTip !== integration.delivery_sha || liveWkTip !== integration.wk_sha) {
      continuationRefusal("live_ref_disagreement", {
        expected_slice_tip: integration.delivery_sha,
        actual_slice_tip: liveSliceTip,
        expected_wk_tip: integration.wk_sha,
        actual_wk_tip: liveWkTip
      });
    }

    const contractGeneration = await authenticateContinuationGeneration({
      repo: worktreeProvisioningConfig.mainRepo,
      wkId: integrationUnit.record_id,
      wkTip: liveWkTip,
      emptyDelivery: integration.empty_delivery
    });

    const confirmed = await recoverDurableIntegratedSlice({
      integrationUnit,
      pair,
      sliceRef,
      wkRef
    });
    if (confirmed === null ||
        confirmed.delivery_sha !== integration.delivery_sha ||
        confirmed.previous_wk_sha !== integration.previous_wk_sha ||
        confirmed.slice_sha !== integration.slice_sha ||
        confirmed.wk_sha !== integration.wk_sha ||
        confirmed.integrated_state !== integration.integrated_state ||
        confirmed.record_reconciliation?.state !== integration.record_reconciliation?.state ||
        JSON.stringify(confirmed.review_target) !== JSON.stringify(integration.review_target) ||
        JSON.stringify(confirmed.transition) !== JSON.stringify(integration.transition)) {
      continuationRefusal("continuation_authority_changed_during_lookup");
    }

    const authority = Object.freeze({
      schema_version: "workspace-agent-integration-continuation-authority.v1",
      repository: worktreeProvisioningConfig.mainRepo,
      subject,
      run_id: pair.run_id,
      launch_ref: status.monitor_handle,
      retry_id: pair.retry_id,
      reviewed_delivery_sha: integration.delivery_sha,
      delivery_base_sha: deliveryBase,
      integration_base_sha: integration.previous_wk_sha,
      integration_result_sha: integration.slice_sha,
      slice_ref: sliceRef,
      slice_tip_sha: liveSliceTip,
      wk_ref: wkRef,
      wk_tip_sha: liveWkTip,
      contract_generation: contractGeneration
    });
    return brandedContinuation({
      requested: true,
      completed: true,
      reviewed_sha: integration.delivery_sha,
      integration: confirmed,
      authority
    });
  }

  return {
    resolveDurableIntegrationContinuation,
    resolveLiveCompletedIntegration
  };
}
