

import { createHash } from "node:crypto";
import {
  reconcileIntegratedSliceRecord,
  recoverZeroDeltaIntegratedSlice,
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

const SHA256_DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;

async function readPersistedGeneration({ runGit, repo, wkRef, expected }) {
  const listing = await runGit({
    repo,
    args: ["ls-tree", "-r", "--full-tree", "--format=%(objectname) %(path)", wkRef,
      "--", "wiki/contracts/.carrier-generations"]
  });
  if (listing?.ok !== true) continuationRefusal("controlled_contract_generation_unavailable");
  const entries = String(listing.stdout ?? "").trim().split("\n").filter(Boolean)
    .map((line) => {
      const separator = line.indexOf(" ");
      return separator < 1 ? null : { oid: line.slice(0, separator), path: line.slice(separator + 1) };
    });
  if (entries.some((entry) => entry === null)) {
    continuationRefusal("controlled_contract_generation_malformed");
  }
  const expectedPath = expected?.path ?? expected?.generation_path ??
    (expected?.id ? `.carrier-generations/${expected.id}` : null);
  const manifests = entries.filter((entry) => /\/manifest\.json$/u.test(entry.path) &&
    (expectedPath === null || entry.path === `wiki/contracts/${expectedPath}/manifest.json`));
  if (manifests.length === 0) {
    const absent = Object.freeze({ state: "absent", digest: "controlled-contract-generation:none",
      carrier_count: 0, manifest_digest: null });
    if (expected !== undefined && JSON.stringify({ state: expected.state ?? "absent", digest: expected.digest,
      carrier_count: expected.carrier_count, manifest_digest: expected.manifest_digest }) !==
      JSON.stringify(absent)) {
      continuationRefusal("controlled_contract_generation_stale");
    }
    return absent;
  }
  if (manifests.length !== 1) continuationRefusal("controlled_contract_generation_malformed");
  const manifest = await runGit({ repo, args: ["cat-file", "blob", manifests[0].oid] });
  if (manifest?.ok !== true) continuationRefusal("controlled_contract_generation_unavailable");
  let parsed;
  try { parsed = JSON.parse(String(manifest.stdout ?? "")); } catch (error) {
    continuationRefusal("controlled_contract_generation_malformed", null, error);
  }
  const bytes = Buffer.from(String(manifest.stdout ?? ""), "utf8");
  const digest = parsed?.generation?.digest ?? parsed?.digest;
  const carrierCount = parsed?.generation?.carrier_count ?? parsed?.carrier_count;
  const manifestDigest = parsed?.generation?.manifest_digest ?? parsed?.manifest_digest ??
    `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (!SHA256_DIGEST_RE.test(digest ?? "") || !Number.isInteger(carrierCount) || carrierCount < 1 ||
      !SHA256_DIGEST_RE.test(manifestDigest)) {
    continuationRefusal("controlled_contract_generation_malformed");
  }
  const current = Object.freeze({ state: "present", digest, carrier_count: carrierCount, manifest_digest: manifestDigest });
  if (expected !== undefined && JSON.stringify({ state: expected.state ?? "present", digest: expected.digest,
    carrier_count: expected.carrier_count, manifest_digest: expected.manifest_digest }) !==
    JSON.stringify(current)) {
    continuationRefusal("controlled_contract_generation_stale", {
      expected_generation: expected?.digest ?? null, observed_generation: current.digest
    });
  }
  return current;
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
    postWorkerLifecycleRunGit = reviewContextRunGit,
    frozenSliceReviewContexts,
    exactSliceReviewReceiptStore
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

  function refuseCanonicalRecordRepair() {
    continuationRefusal("canonical_record_repair_required");
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
    const args = {
      mainRepo: worktreeProvisioningConfig.mainRepo,
      unitAddress: pair.slice_binding.unit_address,
      sliceRef,
      wkRef,
      deps: { runGit: postWorkerLifecycleRunGit }
    };
    const zeroDelta = await recoverZeroDeltaIntegratedSlice({
      ...args,

      writeRecordCas: refuseCanonicalRecordRepair
    });
    if (zeroDelta !== null) return zeroDelta;
    const ordinary = await reconcileIntegratedSliceRecord(args);
    if (ordinary === null) return null;
    if (ordinary.empty_delivery !== false ||
        ordinary.slice_ref !== sliceRef || ordinary.wk_ref !== wkRef) {
      continuationRefusal("integration_result_invalid", {
        expected_subject: `${integrationUnit.record_id}#${integrationUnit.slice_id}`
      });
    }
    return Object.freeze({
      ...ordinary,
      previous_wk_sha: await resolveLiteralIntegrationBase(ordinary)
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

    const persistedGeneration = integration.contract_generation ??
      integration.authority?.contract_generation;
    if (integration.empty_delivery !== true && persistedGeneration === undefined) {
      continuationRefusal("controlled_contract_generation_missing");
    }
    const contractGeneration = await readPersistedGeneration({
      runGit: postWorkerLifecycleRunGit,
      repo: worktreeProvisioningConfig.mainRepo,
      wkRef,
      expected: persistedGeneration
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
    resolveDurableIntegrationContinuation
  };
}
