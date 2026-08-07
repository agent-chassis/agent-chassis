
import { lstatSync } from "node:fs";
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
  "output_branch", "worktree_path", "write_scope", "write_scope_source",
  "wk_tip_sha"
]);

const WK_TIP_SHA_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

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
    { setWorkRecordStatusByUnit, writeValidatedWorkRecord },
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
    writeValidatedWorkRecord,
    digestTrustedExactReviewEvidence,
    releaseRetainedSlice,
  };
}

const INTEGRATION_OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

export const INTEGRATED_SLICE_CLEANUP_STATES = Object.freeze({

  NOT_REQUIRED: "not_required",

  CONFIRMED_RELEASED: "confirmed_released"
});

export const INTEGRATED_SLICE_CLEANUP_UNCERTAIN_CODE =
  "agent_launch.slice_integration.integrated_cleanup_uncertain.v1";

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

function assertFreshIntegrationSliceBaseAdmission({
  wkBinding, sliceBinding, SliceIntegrationError, codes
}) {
  if (wkBinding.wk_tip_sha !== sliceBinding.base_sha) {
    throw new SliceIntegrationError("agent-launch trusted integration: full WK binding is missing or its moving wk_tip_sha does not match the slice's frozen base", {
      code: codes.BINDING_MISMATCH
    });
  }
}

function confirmIntegratedSliceCleanup({
  runGit, mainRepo, sliceRef, wkRef, sliceBinding, wkBinding, recovered,
  SliceIntegrationError, codes
}) {
  const refuse = (message, detail = null) => {
    throw new SliceIntegrationError(`agent-launch trusted integration: ${message}`, {
      code: codes.BINDING_MISMATCH,
      detail
    });
  };

  if (!isPlainObject(recovered) || recovered.integrated !== true ||
      recovered.recovered !== true || recovered.transition?.written !== false ||
      recovered.previous_wk_sha !== null) {
    refuse("integrated-slice cleanup requires a read-only recovered integration result");
  }
  if (recovered.slice_ref !== sliceRef || recovered.wk_ref !== wkRef) {
    refuse("integrated-slice cleanup result does not name the exact bound slice and WK refs", {
      slice_ref: recovered.slice_ref ?? null,
      wk_ref: recovered.wk_ref ?? null
    });
  }
  for (const field of ["slice_sha", "delivery_sha", "wk_sha"]) {
    if (!INTEGRATION_OID_RE.test(String(recovered[field] ?? ""))) {
      refuse("integrated-slice cleanup result carries a noncanonical commit id", { field });
    }
  }

  const wkTip = integrationResolvedCommit(runGit, mainRepo, wkRef, SliceIntegrationError, codes);
  if (wkTip !== recovered.wk_sha) {
    refuse("the current WK tip no longer matches the proven integrated marker state", {
      wk_tip: wkTip,
      proven_wk_sha: recovered.wk_sha
    });
  }
  const sliceTip = integrationResolvedCommit(runGit, mainRepo, sliceRef, SliceIntegrationError, codes);
  if (sliceTip !== recovered.delivery_sha) {
    refuse("the retained exact-slice delivery no longer matches the proven integrated delivery", {
      slice_tip: sliceTip,
      proven_delivery_sha: recovered.delivery_sha
    });
  }

  const ancestor = runGit({
    repo: mainRepo,
    args: ["merge-base", "--is-ancestor", wkBinding.base_sha, wkTip]
  });
  if (!ancestor || ancestor.ok !== true) {
    refuse("the WK binding's fixed fork is not retained in the current WK tip", {
      base_sha: wkBinding.base_sha,
      wk_tip: wkTip
    });
  }

  let state;
  try {
    lstatSync(sliceBinding.worktree_path);
    state = INTEGRATED_SLICE_CLEANUP_STATES.NOT_REQUIRED;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw new SliceIntegrationError("agent-launch trusted integration: the exact-slice checkout could not be observed, so integrated cleanup is uncertain", {
        code: INTEGRATED_SLICE_CLEANUP_UNCERTAIN_CODE,
        detail: { errno: typeof error?.code === "string" ? error.code : null }
      });
    }
    state = INTEGRATED_SLICE_CLEANUP_STATES.CONFIRMED_RELEASED;
  }
  return Object.freeze({
    state,
    reaped: null,
    reason: "integration_recovered",

    cleanup_only: true
  });
}

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
    writeValidatedWorkRecord,
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
      typeof wkBinding.wk_tip_sha !== "string" || !WK_TIP_SHA_RE.test(wkBinding.wk_tip_sha)) {
    throw new SliceIntegrationError("agent-launch trusted integration: full WK binding is missing or its moving wk_tip_sha does not match the slice's frozen base", {
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

  if (recoveredIntegration !== null) {
    const cleanup = confirmIntegratedSliceCleanup({
      runGit,
      mainRepo,
      sliceRef,
      wkRef,
      sliceBinding,
      wkBinding,
      recovered: recoveredIntegration,
      SliceIntegrationError,
      codes
    });

    return Object.freeze({
      ...recoveredIntegration,
      cleanup,
      terminal_review_evidence: null
    });
  }

  assertFreshIntegrationSliceBaseAdmission({
    wkBinding, sliceBinding, SliceIntegrationError, codes
  });
  const commit = integrationResolvedCommit(runGit, mainRepo, sliceRef, SliceIntegrationError, codes);

  const writeRecordCas = async ({
    record,
    expectedSourceDigest
  }) => writeValidatedWorkRecord({
    dir: mainRepo,
    record,
    expectedSourceDigest,
  });
  const integration = await integrateCommittedSlice({
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
      writeRecordCas,
      deps: { runGit }
    });

  let cleanup;
  {
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
