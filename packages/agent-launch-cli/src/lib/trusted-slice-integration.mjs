
import path from "node:path";
import {
  isPlainObject,
  TERMINAL_REVIEW_EVIDENCE_WK_BINDING_FIELDS,
  TERMINAL_REVIEW_EVIDENCE_WK_BINDING_SCHEMA_VERSION
} from "./trusted-operation-contracts.mjs";
import { verifyExactSliceCommitBinding } from "./exact-slice-commit-binding.mjs";

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
    { digestTrustedExactReviewEvidence },
    { releaseRetainedSlice }
  ] = await Promise.all([
    import("./worktree-substrate.mjs"),
    import("./slice-integration.mjs"),
    import("@agent-chassis/wiki-core"),
    import("./workspace-agent-dispatch-run-receipt.mjs"),
    import("./worktree-reaper.mjs")
  ]);
  return {
    resolveWorktreeBinding,
    defaultRunGit,
    integrateCommittedSlice,
    reconcileIntegratedSliceRecord,
    SliceIntegrationError,
    SLICE_INTEGRATION_DIAGNOSTIC_CODES,
    setWorkRecordStatusByUnit,
    digestTrustedExactReviewEvidence,
    releaseRetainedSlice,
  };
}

const INTEGRATION_OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

function integrationResolvedCommit(runGit, repo, value, SliceIntegrationError, codes) {
  const result = runGit({ repo, args: ["rev-parse", "--verify", `${value}^{commit}`] });
  const sha = result?.ok === true ? String(result.stdout ?? "").trim() : "";
  if (!INTEGRATION_OID_RE.test(sha) || /^0+$/u.test(sha)) {
    throw new SliceIntegrationError(`agent-launch trusted integration: could not resolve ${value}`, {
      code: codes.BINDING_MISMATCH,
      detail: { value, sha: sha || null, status: result?.status ?? null, stderr: result?.stderr ?? result?.error ?? null }
    });
  }
  return sha;
}

export const TERMINAL_REVIEW_EVIDENCE_COMPOSITIONS = Object.freeze({
  LIVE_MATERIALIZER: "live_materializer"
});

export async function defaultIntegrateManagedWorkerSlice({
  mainRepo,
  assignedUnit,
  launchRef,
  runId,
  retryId,
  terminalReviewEvidenceComposition = TERMINAL_REVIEW_EVIDENCE_COMPOSITIONS.LIVE_MATERIALIZER,
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
    digestTrustedExactReviewEvidence: configuredEvidenceDigest,
    releaseRetainedSlice
  } = deps ?? await loadDefaultIntegrationDeps();
  const runGit = deps?.runGit ?? defaultRunGit;
  const digestTrustedExactReviewEvidence = configuredEvidenceDigest ??
    (await import("./workspace-agent-dispatch-run-receipt.mjs"))
      .digestTrustedExactReviewEvidence;

  if (typeof mainRepo !== "string" || !path.isAbsolute(mainRepo)) {
    throw new SliceIntegrationError("agent-launch trusted integration: launcher-composed integrationMainRepo must be absolute", {
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
    throw new SliceIntegrationError("agent-launch trusted integration: full WK binding is missing or does not share the exact frozen base", {
      code: codes.BINDING_MISMATCH
    });
  }

  if (wkBinding.schema_version !== TERMINAL_REVIEW_EVIDENCE_WK_BINDING_SCHEMA_VERSION) {
    throw new SliceIntegrationError("agent-launch trusted integration: full WK binding schema_version is not the canonical worktree identity schema", {
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
    throw new SliceIntegrationError("agent-launch trusted integration: full WK binding is not the exact canonical WK identity schema", {
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
    throw new SliceIntegrationError("agent-launch trusted integration: full WK binding is missing a field the terminal review evidence must bind", {
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
    throw new SliceIntegrationError("agent-launch trusted integration: full WK binding does not match the exact slice identity", {
      code: codes.BINDING_MISMATCH
    });
  }
  const commit = integrationResolvedCommit(runGit, mainRepo, sliceRef, SliceIntegrationError, codes);

  if (!Object.values(TERMINAL_REVIEW_EVIDENCE_COMPOSITIONS).includes(terminalReviewEvidenceComposition)) {
    throw new SliceIntegrationError("agent-launch trusted integration: launcher-owned terminal review evidence composition is invalid", {
      code: codes.INVALID_ARG
    });
  }

  const recoveredIntegration = typeof reconcileIntegratedSliceRecord === "function"
    ? reconcileIntegratedSliceRecord({
        mainRepo,
        unitAddress: sliceBinding.unit_address,
        sliceRef,
        wkRef,
        baseSha: sliceBinding.base_sha,
        deps: { runGit }
      })
    : null;

  const integration = recoveredIntegration ?? await integrateCommittedSlice({
      mainRepo,
      worktreePath: sliceBinding.worktree_path,
      unitAddress: sliceBinding.unit_address,
      sliceRef,
      wkRef,
      baseSha: sliceBinding.base_sha,
      commit,
      workerTerminated: true,
      transitionToReview: async ({ unitAddress, status: nextStatus, expectedSourceDigest }) =>
        setWorkRecordStatusByUnit({ dir: mainRepo, unitAddress, status: nextStatus, expectedSourceDigest }),
      deps: { runGit }
    });

  let cleanup;
  if (recoveredIntegration === null) {
    try {
      if (typeof releaseRetainedSlice !== "function") {
        throw new Error("writable trusted runtime exact-slice reaper is unavailable");
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
          integration.delivery_sha !== integratedSliceSha) {
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
        integratedSha: integration.delivery_sha,
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
      cleanup = Object.freeze({
        state: "reaped",
        reaped: true,
        result: reap
      });
    } catch (error) {

      cleanup = Object.freeze({
        state: "failed",
        reaped: false,
        code: typeof error?.code === "string" ? error.code : null,
        message: error?.message ?? String(error),
        detail: error?.detail ?? null
      });
    }
  } else {
    cleanup = Object.freeze({
      state: "not_required",
      reaped: null,
      reason: "integration_recovered"
    });
  }

  if (integration?.review_target == null) {

    return Object.freeze({ ...integration, cleanup, terminal_review_evidence: null });
  }

  return Object.freeze({ ...integration, cleanup, terminal_review_evidence: null });
}

function latchPostMutationFailure(SliceIntegrationError, step) {
  try {
    return step();
  } catch (err) {
    throw new SliceIntegrationError(`agent-launch trusted integration: terminal review materialization failed (${err?.code ?? "unknown"})`, {
      code: SLICE_INTEGRATION_REVIEW_FREEZE_FAILED_CODE,
      detail: { materialization_code: err?.code ?? null, materialization_detail: err?.detail ?? null },
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
