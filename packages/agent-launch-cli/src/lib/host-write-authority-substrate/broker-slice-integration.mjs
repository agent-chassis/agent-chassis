

import path from "node:path";
import { isPlainObject } from "./protocol-constants.mjs";
import { verifyExactSliceCommitBinding } from "./broker-commit-binding.mjs";

import {
  materializeTerminalReviewWorktree,
  assertTerminalReviewMaterializationAttestation
} from "./terminal-review-materialization.mjs";

import {
  TERMINAL_REVIEW_EVIDENCE_SCHEMA_VERSION,
  TERMINAL_REVIEW_EVIDENCE_WK_BINDING_FIELDS,
  TERMINAL_REVIEW_EVIDENCE_WK_BINDING_SCHEMA_VERSION
} from "./request-envelopes-integrate-slice.mjs";

const EXACT_WK_IDENTITY_BINDING_FIELDS = Object.freeze([
  "schema_version", "launch_ref", "run_id", "retry_id", "unit_address",
  "initiative", "record_id", "slice_id", "base_ref", "base_sha",
  "output_branch", "worktree_path", "write_scope", "write_scope_source"
]);

export const SLICE_INTEGRATION_REBASE_RESTORE_FAILED_CODE =
  "agent_launch.slice_integration.rebase_restore_failed.v1";
export const SLICE_INTEGRATION_REVIEW_FREEZE_FAILED_CODE =
  "agent_launch.slice_integration.review_freeze_failed.v1";

async function loadDefaultIntegrationDeps() {
  const [
    { resolveWorktreeBinding, defaultRunGit },
    {
      integrateCommittedSlice,
      reconcileIntegratedSliceRecord,
      SliceIntegrationError,
      SLICE_INTEGRATION_DIAGNOSTIC_CODES
    },
    { setWorkRecordStatusByUnit },
    { resolveCanonicalSliceReviewUnit },
    {
      createExactSliceReviewReceiptStore,
      digestTrustedExactReviewEvidence
    },
    { releaseRetainedSlice },
    { resolveHistoricalSliceReviewAcceptanceProof }
  ] = await Promise.all([
    import("../worktree-substrate.mjs"),
    import("../slice-integration.mjs"),
    import("@agent-chassis/wiki-core"),
    import("../backend-scope-authority.mjs"),
    import("../workspace-agent-dispatch-run-receipt.mjs"),
    import("../worktree-reaper.mjs"),
    import("@agent-chassis/wiki-core/src/operations/work-record-slice-review-acceptance.mjs")
  ]);
  return {
    resolveWorktreeBinding,
    defaultRunGit,
    integrateCommittedSlice,
    reconcileIntegratedSliceRecord,
    SliceIntegrationError,
    SLICE_INTEGRATION_DIAGNOSTIC_CODES,
    setWorkRecordStatusByUnit,
    resolveCanonicalSliceReviewUnit,
    createExactSliceReviewReceiptStore,
    digestTrustedExactReviewEvidence,
    releaseRetainedSlice,
    resolveHistoricalSliceReviewAcceptanceProof
  };
}

const INTEGRATION_OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

function integrationResolvedCommit(runGit, repo, value, SliceIntegrationError, codes) {
  const result = runGit({ repo, args: ["rev-parse", "--verify", `${value}^{commit}`] });
  const sha = result?.ok === true ? String(result.stdout ?? "").trim() : "";
  if (!INTEGRATION_OID_RE.test(sha) || /^0+$/u.test(sha)) {
    throw new SliceIntegrationError(`agent-launch broker integration: could not resolve ${value}`, {
      code: codes.BINDING_MISMATCH,
      detail: { value, sha: sha || null, status: result?.status ?? null, stderr: result?.stderr ?? result?.error ?? null }
    });
  }
  return sha;
}

export const TERMINAL_REVIEW_EVIDENCE_COMPOSITIONS = Object.freeze({
  TRANSPORTED_ATTESTATION: "transported_attestation",
  LIVE_MATERIALIZER: "live_materializer"
});

export async function defaultIntegrateManagedWorkerSlice({
  mainRepo,
  assignedUnit,
  launchRef,
  runId,
  retryId,
  reviewEnforcementMode = "enforced_cce",

  terminalReviewEvidenceComposition = TERMINAL_REVIEW_EVIDENCE_COMPOSITIONS.TRANSPORTED_ATTESTATION,
  deps = null
}) {
  const {
    resolveWorktreeBinding,
    defaultRunGit,
    integrateCommittedSlice,
    reconcileIntegratedSliceRecord,
    SliceIntegrationError,
    SLICE_INTEGRATION_DIAGNOSTIC_CODES: codes,
    setWorkRecordStatusByUnit,
    resolveCanonicalSliceReviewUnit,
    createExactSliceReviewReceiptStore,
    digestTrustedExactReviewEvidence,
    releaseRetainedSlice,
    resolveHistoricalSliceReviewAcceptanceProof: configuredHistoricalProofResolver
  } = deps ?? await loadDefaultIntegrationDeps();
  const runGit = deps?.runGit ?? defaultRunGit;
  const resolveHistoricalSliceReviewAcceptanceProof = configuredHistoricalProofResolver ??
    (await import("@agent-chassis/wiki-core/src/operations/work-record-slice-review-acceptance.mjs"))
      .resolveHistoricalSliceReviewAcceptanceProof;

  if (typeof mainRepo !== "string" || !path.isAbsolute(mainRepo)) {
    throw new SliceIntegrationError("agent-launch broker integration: launcher-composed integrationMainRepo must be absolute", {
      code: codes.INVALID_ARG
    });
  }

  const rawSliceBinding = resolveWorktreeBinding({ mainRepo, launchRef, runId: `${runId}.slice`, retryId });

  const sliceBinding = verifyExactSliceCommitBinding({
    binding: rawSliceBinding, mainRepo, assignedUnit, launchRef, runId: `${runId}.slice`, retryId
  });
  const worktreeIdentityDigest = digestTrustedExactReviewEvidence(rawSliceBinding);
  const [initiative, wkId, sliceId] = String(sliceBinding.unit_address).split("/");
  const wkBinding = resolveWorktreeBinding({ mainRepo, launchRef, runId: `${runId}.wk`, retryId });
  if (!isPlainObject(wkBinding) ||
      typeof wkBinding.worktree_path !== "string" || !path.isAbsolute(wkBinding.worktree_path) ||
      wkBinding.base_sha !== sliceBinding.base_sha) {
    throw new SliceIntegrationError("agent-launch broker integration: full WK binding is missing or does not share the exact frozen base", {
      code: codes.BINDING_MISMATCH
    });
  }

  if (wkBinding.schema_version !== TERMINAL_REVIEW_EVIDENCE_WK_BINDING_SCHEMA_VERSION) {
    throw new SliceIntegrationError("agent-launch broker integration: full WK binding schema_version is not the canonical worktree identity schema", {
      code: codes.BINDING_MISMATCH,
      detail: {
        expected: TERMINAL_REVIEW_EVIDENCE_WK_BINDING_SCHEMA_VERSION,
        actual: typeof wkBinding.schema_version === "string" ? wkBinding.schema_version : null
      }
    });
  }

  const wkBindingKeys = Object.keys(wkBinding);
  if (wkBindingKeys.length !== EXACT_WK_IDENTITY_BINDING_FIELDS.length ||
      !EXACT_WK_IDENTITY_BINDING_FIELDS.every((field) => Object.prototype.hasOwnProperty.call(wkBinding, field))) {
    throw new SliceIntegrationError("agent-launch broker integration: full WK binding is not the exact canonical WK identity schema", {
      code: codes.BINDING_MISMATCH,
      detail: { keys: [...wkBindingKeys].sort() }
    });
  }

  const unmintableWkBindingField = TERMINAL_REVIEW_EVIDENCE_WK_BINDING_FIELDS.find(
    (field) => field === "retry_id"
      ? !Number.isInteger(wkBinding[field])
      : typeof wkBinding[field] !== "string" || wkBinding[field].length === 0
  );
  if (unmintableWkBindingField !== undefined) {
    throw new SliceIntegrationError("agent-launch broker integration: full WK binding is missing a field the terminal review evidence must bind", {
      code: codes.BINDING_MISMATCH,
      detail: { field: unmintableWkBindingField }
    });
  }
  const sliceBranch = sliceBinding.output_branch;
  const sliceRef = sliceBranch?.startsWith("refs/heads/") ? sliceBranch : `refs/heads/${sliceBranch}`;
  const wkRef = `refs/heads/wk/${initiative}/${wkId}`;
  const boundWkRef = wkBinding.output_branch?.startsWith("refs/heads/")
    ? wkBinding.output_branch
    : `refs/heads/${wkBinding.output_branch ?? ""}`;
  if (boundWkRef !== wkRef) {
    throw new SliceIntegrationError("agent-launch broker integration: full WK binding does not match the exact slice identity", {
      code: codes.BINDING_MISMATCH
    });
  }
  const commit = integrationResolvedCommit(runGit, mainRepo, sliceRef, SliceIntegrationError, codes);
  if (commit === sliceBinding.base_sha) {

    throw new SliceIntegrationError("agent-launch broker integration: committed slice result absent (slice ref equals the launcher-bound base)", {
      code: codes.BINDING_MISMATCH,
      detail: { slice_ref: sliceRef, base_sha: sliceBinding.base_sha }
    });
  }

  if (reviewEnforcementMode !== "enforced_cce" && reviewEnforcementMode !== "policy_only") {
    throw new SliceIntegrationError("agent-launch broker integration: launcher-owned review enforcement mode is invalid", {
      code: codes.INVALID_ARG
    });
  }

  if (!Object.values(TERMINAL_REVIEW_EVIDENCE_COMPOSITIONS).includes(terminalReviewEvidenceComposition)) {
    throw new SliceIntegrationError("agent-launch broker integration: launcher-owned terminal review evidence composition is invalid", {
      code: codes.INVALID_ARG
    });
  }

  const recoveredIntegration = typeof reconcileIntegratedSliceRecord === "function"
    ? reconcileIntegratedSliceRecord({
        mainRepo,
        unitAddress: sliceBinding.unit_address,
        sliceRef,
        wkRef,
        deps: { runGit }
      })
    : null;

  let sliceReviewAcceptance = null;
  if (reviewEnforcementMode === "enforced_cce") {
    const receiptStore = deps?.exactSliceReviewReceiptStore ??
      createExactSliceReviewReceiptStore({ workspaceDir: mainRepo });
    const receipt = await receiptStore.loadLatest(assignedUnit);
    const current = recoveredIntegration === null
      ? resolveCanonicalSliceReviewUnit(mainRepo, assignedUnit)
      : null;
    const exactReceipt = receipt !== null &&
      receipt.frozen_context_state === "consumed" &&
      receipt.terminal_run_status === "succeeded" &&
      receipt.structured_outcome?.outcome === "clean" &&
      receipt.structured_outcome?.clean_review === true &&
      receipt.proof_state === "minted" &&
      receipt.source_worker_run_id === runId &&
      receipt.source_worker_monitor_handle === launchRef &&
      receipt.unit_address === assignedUnit &&
      receipt.initiative === initiative &&
      receipt.record_id === wkId &&
      receipt.slice_id === sliceId &&
      receipt.slice_ref === sliceRef &&
      receipt.reviewed_sha === commit &&
      receipt.diff_base_sha === sliceBinding.base_sha &&
      receipt.worktree_path === sliceBinding.worktree_path &&

      receipt.worktree_identity_digest === worktreeIdentityDigest &&
      (recoveredIntegration !== null ||
        (digestTrustedExactReviewEvidence(current.canonical_parent_wk_contract) ===
          receipt.canonical_parent_contract_digest &&
         digestTrustedExactReviewEvidence(current.review_unit_contract) ===
          receipt.slice_review_contract_digest));
    if (!exactReceipt) {
      throw new SliceIntegrationError("agent-launch broker integration: exact durable slice-review acceptance is missing, stale, or mismatched", {
        code: codes.BINDING_MISMATCH
      });
    }
    sliceReviewAcceptance = Object.freeze({
      schema_version: "workspace-agent-slice-review-binding.v1",
      unit_address: receipt.unit_address,
      initiative: receipt.initiative,
      slice_ref: receipt.slice_ref,
      reviewed_sha: receipt.reviewed_sha,
      diff_base_sha: receipt.diff_base_sha,
      source_worker_run_id: receipt.source_worker_run_id,
      review_run_id: receipt.review_run_id,
      review_monitor_handle: receipt.review_monitor_handle,
      reviewer_role: receipt.reviewer_role,
      review_outcome: receipt.structured_outcome.review_result.review_outcome,
      structured_result_digest: digestTrustedExactReviewEvidence(
        receipt.structured_outcome.review_result
      )
    });
    if (recoveredIntegration !== null) {
      const historicalProof = await resolveHistoricalSliceReviewAcceptanceProof({
        dir: mainRepo,
        unit_address: assignedUnit,
        expectation: {
          ...sliceReviewAcceptance,
          current_slice_sha: commit
        },
        historical_contract: {
          canonical_parent_wk_contract: receipt.canonical_parent_wk_contract,
          canonical_parent_contract_digest: receipt.canonical_parent_contract_digest,
          slice_review_contract: receipt.slice_review_contract,
          slice_review_contract_digest: receipt.slice_review_contract_digest
        },
        review_result: receipt.structured_outcome.review_result
      });
      if (historicalProof?.ok !== true) {
        throw new SliceIntegrationError(
          `agent-launch broker integration: persisted historical Proof A is missing or mismatched (${(
            Array.isArray(historicalProof?.reasons) ? historicalProof.reasons : ["unknown refusal"]
          ).join("; ")})`,
          { code: codes.BINDING_MISMATCH }
        );
      }
    }
  }

  const integration = recoveredIntegration ?? await integrateCommittedSlice({
      mainRepo,
      worktreePath: sliceBinding.worktree_path,
      unitAddress: sliceBinding.unit_address,
      sliceRef,
      wkRef,
      baseSha: sliceBinding.base_sha,
      commit,
      workerTerminated: true,
      sliceReviewAcceptance,
      reviewEnforcementMode,
      transitionToReview: async ({ unitAddress, status: nextStatus, expectedSourceDigest }) =>
        setWorkRecordStatusByUnit({ dir: mainRepo, unitAddress, status: nextStatus, expectedSourceDigest }),
      deps: { runGit }
    });

  if (recoveredIntegration === null) {
    await latchPostMutationReapFailure(SliceIntegrationError, async () => {
      if (typeof releaseRetainedSlice !== "function") {
        throw new Error("writable broker exact-slice reaper is unavailable");
      }
      const integratedSliceSha = integrationResolvedCommit(
        runGit,
        mainRepo,
        sliceRef,
        SliceIntegrationError,
        codes
      );
      if (integration?.integrated !== true ||
          integration.slice_ref !== sliceRef ||
          integration.slice_sha !== integratedSliceSha) {
        throw new Error("integration did not return the exact successful slice result");
      }
      const reap = await releaseRetainedSlice({
        mainRepo,
        launchRef,
        runId: `${runId}.slice`,
        retryId,
        disposition: "successful-integration",
        workerTerminated: true,
        integrationSucceeded: true,
        integratedSha: integration.slice_sha,
        worktreeIdentityDigest,
        deps: {
          runGit,
          resolveBinding: resolveWorktreeBinding,
          ...(deps?.reaperDeps ?? {})
        }
      });
      if (reap?.reaped !== true) {
        throw new Error("exact-slice worktree reap did not report completion");
      }
      return reap;
    });
  }

  if (integration?.review_target == null) {

    return Object.freeze({ ...integration, terminal_review_evidence: null });
  }

  if (terminalReviewEvidenceComposition === TERMINAL_REVIEW_EVIDENCE_COMPOSITIONS.LIVE_MATERIALIZER) {
    return Object.freeze({ ...integration, terminal_review_evidence: null });
  }

  const materialize = deps?.materializeTerminalReviewWorktree ?? materializeTerminalReviewWorktree;
  const materialization = latchPostMutationFailure(SliceIntegrationError, () => materialize({
    mainRepo,
    worktreePath: wkBinding.worktree_path,
    wkRef,
    frozenSha: integration.review_target.sha,
    runGit
  }));

  latchPostMutationFailure(SliceIntegrationError, () =>
    assertTerminalReviewMaterializationAttestation(materialization, {
      worktreePath: wkBinding.worktree_path,
      wkRef,
      wkSha: integration.review_target.sha
    }));

  return Object.freeze({
    ...integration,
    terminal_review_evidence: Object.freeze({
      schema_version: TERMINAL_REVIEW_EVIDENCE_SCHEMA_VERSION,
      materialization,
      review_target: integration.review_target,
      run: Object.freeze({
        assigned_unit: assignedUnit,
        launch_ref: launchRef,
        run_id: runId,
        retry_id: retryId
      }),
      wk_binding: Object.freeze({
        schema_version: wkBinding.schema_version,
        run_id: wkBinding.run_id,
        retry_id: wkBinding.retry_id,
        unit_address: wkBinding.unit_address,
        output_branch: wkBinding.output_branch,
        worktree_path: wkBinding.worktree_path,
        base_ref: wkBinding.base_ref,
        base_sha: wkBinding.base_sha
      })
    })
  });
}

function latchPostMutationFailure(SliceIntegrationError, step) {
  try {
    return step();
  } catch (err) {
    throw new SliceIntegrationError(`agent-launch broker integration: terminal review materialization failed (${err?.code ?? "unknown"})`, {
      code: SLICE_INTEGRATION_REVIEW_FREEZE_FAILED_CODE,
      detail: { materialization_code: err?.code ?? null, materialization_detail: err?.detail ?? null },
      cause: err
    });
  }
}

async function latchPostMutationReapFailure(SliceIntegrationError, step) {
  try {
    return await step();
  } catch (err) {
    throw new SliceIntegrationError(`agent-launch broker integration: exact-slice worktree reap failed (${err?.code ?? "unknown"})`, {
      code: SLICE_INTEGRATION_REVIEW_FREEZE_FAILED_CODE,
      detail: { reap_code: err?.code ?? null, reap_detail: err?.detail ?? null },
      cause: err
    });
  }
}

export const INTEGRATE_SLICE_ENVELOPE_FIELDS = Object.freeze([
  "schema_version", "substrate_id", "protocol_version", "op", "integrate_request"
]);
export const INTEGRATE_SLICE_REQUEST_FIELDS = Object.freeze([
  "assigned_unit", "launch_ref", "run_id", "retry_id"
]);
export const INTEGRATE_SLICE_ASSIGNED_UNIT_RE = /^WK-\d{4}#SLICE-\d{3}$/u;
