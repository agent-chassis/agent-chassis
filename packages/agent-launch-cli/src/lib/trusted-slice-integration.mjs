
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import {
  CRASH_DURABLE_RESULTS,
  createSyncEffects,
  planReplacement,
  runCrashDurablePlanSync
} from "@agent-chassis/wiki-core/src/lib/crash-durable-state.mjs";
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

export const CORRECTIVE_INTEGRATION_CHAIN_SCHEMA_VERSION =
  "corrective-integration-chain.v1";
const CORRECTIVE_INTEGRATION_HOP_SCHEMA_VERSION =
  "corrective-integration-chain-hop.v1";
const CORRECTIVE_INTEGRATION_STATE_SCHEMA_VERSION =
  "corrective-integration-state.v1";
const CORRECTIVE_INTEGRATION_RECEIPT_SCHEMA_VERSION =
  "trusted-corrective-integration-receipt.v1";

const canonicalDigest = (value) => `sha256:${createHash("sha256")
  .update(JSON.stringify(value)).digest("hex")}`;
const hasExactKeys = (value, fields) => isPlainObject(value) &&
  Object.keys(value).sort().join("|") === [...fields].sort().join("|");
const subjectFromSliceRef = (sliceRef) => {
  const match = String(sliceRef).match(
    /^refs\/heads\/slice\/[^/]+\/(WK-\d+)\/(SLICE-\d+)$/u
  );
  return match === null ? null : `${match[1]}#${match[2]}`;
};
const chainStatePath = (mainRepo, subject) => path.join(
  mainRepo,
  ".agent-launch", "durable-state", "v1", "corrective-integration-chains",
  `${createHash("sha256").update(subject).digest("hex")}.json`
);

export function validateCorrectiveIntegrationChain(chain, {
  subject,
  controlledContractGeneration,
  currentWkTip
}) {
  if (!hasExactKeys(chain, ["schema_version", "subject", "original_reviewed_delivery", "hops"]) ||
      chain.schema_version !== CORRECTIVE_INTEGRATION_CHAIN_SCHEMA_VERSION ||
      chain.subject !== subject || !WK_TIP_SHA_RE.test(chain.original_reviewed_delivery ?? "") ||
      !Array.isArray(chain.hops) || chain.hops.length === 0) {
    throw new Error("corrective integration chain is missing or malformed");
  }
  const receipts = new Set();
  for (let index = 0; index < chain.hops.length; index += 1) {
    const hop = chain.hops[index];
    if (!hasExactKeys(hop, ["schema_version", "index", "subject",
      "controlled_contract_generation", "pre_wk_tip", "delivery", "integration_receipt",
      "post_wk_tip", "hop_digest"]) ||
        hop.schema_version !== CORRECTIVE_INTEGRATION_HOP_SCHEMA_VERSION || hop.index !== index ||
        hop.subject !== subject || !WK_TIP_SHA_RE.test(hop.pre_wk_tip ?? "") ||
        !WK_TIP_SHA_RE.test(hop.post_wk_tip ?? "") ||
        !hasExactKeys(hop.delivery, ["slice_ref", "delivery_sha", "integrated_sha"]) ||
        subjectFromSliceRef(hop.delivery.slice_ref) !== subject ||
        !WK_TIP_SHA_RE.test(hop.delivery.delivery_sha ?? "") ||
        !WK_TIP_SHA_RE.test(hop.delivery.integrated_sha ?? "") ||
        hop.delivery.integrated_sha !== hop.post_wk_tip ||
        !hasExactKeys(hop.integration_receipt, ["schema_version", "digest"]) ||
        hop.integration_receipt.schema_version !== CORRECTIVE_INTEGRATION_RECEIPT_SCHEMA_VERSION ||
        !/^sha256:[0-9a-f]{64}$/u.test(hop.integration_receipt.digest ?? "") ||
        receipts.has(hop.integration_receipt.digest) ||
        canonicalDigest({ ...hop, hop_digest: undefined }) !== hop.hop_digest) {
      throw new Error("corrective integration chain contains a duplicated, rewritten, or malformed hop");
    }
    receipts.add(hop.integration_receipt.digest);
    if (index === 0 && hop.delivery.delivery_sha !== chain.original_reviewed_delivery) {
      throw new Error("corrective integration chain is not rooted in the original reviewed delivery");
    }
    if (index > 0 && hop.pre_wk_tip !== chain.hops[index - 1].post_wk_tip) {
      throw new Error("corrective integration chain is reordered or contains a gap");
    }
  }
  const terminal = chain.hops.at(-1);
  if (typeof controlledContractGeneration !== "string" ||
      terminal.controlled_contract_generation !== controlledContractGeneration ||
      terminal.post_wk_tip !== currentWkTip) {
    throw new Error("corrective integration chain is stale for the current generation or WK tip");
  }
  return chain;
}

export function readTrustedCorrectiveIntegrationState({ mainRepo, subject }) {
  try {
    const state = JSON.parse(readFileSync(chainStatePath(mainRepo, subject), "utf8"));
    if (!hasExactKeys(state, ["schema_version", "chain", "remaining_scope_transition"]) ||
        state.schema_version !== CORRECTIVE_INTEGRATION_STATE_SCHEMA_VERSION) {
      throw new Error("trusted corrective integration state has an unknown schema");
    }
    return state;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export function appendCorrectiveIntegrationHop({ priorState, subject, generation, integration }) {
  const receipt = Object.freeze({
    schema_version: CORRECTIVE_INTEGRATION_RECEIPT_SCHEMA_VERSION,
    digest: canonicalDigest({ subject, generation, previous_wk_sha: integration.previous_wk_sha,
      slice_ref: integration.slice_ref, delivery_sha: integration.delivery_sha,
      slice_sha: integration.slice_sha, wk_sha: integration.wk_sha })
  });
  const unsigned = {
    schema_version: CORRECTIVE_INTEGRATION_HOP_SCHEMA_VERSION,
    index: priorState?.chain?.hops?.length ?? 0,
    subject,
    controlled_contract_generation: generation,
    pre_wk_tip: integration.previous_wk_sha,
    delivery: { slice_ref: integration.slice_ref, delivery_sha: integration.delivery_sha,
      integrated_sha: integration.slice_sha },
    integration_receipt: receipt,
    post_wk_tip: integration.wk_sha
  };
  const hop = Object.freeze({ ...unsigned, hop_digest: canonicalDigest({ ...unsigned, hop_digest: undefined }) });
  const chain = Object.freeze({
    schema_version: CORRECTIVE_INTEGRATION_CHAIN_SCHEMA_VERSION,
    subject,
    original_reviewed_delivery:
      priorState?.chain?.original_reviewed_delivery ?? integration.delivery_sha,
    hops: Object.freeze([...(priorState?.chain?.hops ?? []), hop])
  });
  validateCorrectiveIntegrationChain(chain, { subject,
    controlledContractGeneration: generation, currentWkTip: integration.wk_sha });
  return { chain, hop };
}

async function persistCorrectiveIntegrationState({ mainRepo, subject, integration, deps }) {
  if (!WK_TIP_SHA_RE.test(integration?.previous_wk_sha ?? "")) return null;
  const recordId = subject.split("#", 1)[0];
  const resolveGeneration = deps?.readCanonicalContractGenerationIdentity ??
    (await import("./slice-integration-authorization.mjs")).readCanonicalContractGenerationIdentity;
  const generation = resolveGeneration(mainRepo, recordId);
  if (typeof generation?.digest !== "string") {
    throw new Error("trusted integration could not bind the current controlled-contract generation");
  }
  const priorState = readTrustedCorrectiveIntegrationState({ mainRepo, subject });
  const { chain, hop } = appendCorrectiveIntegrationHop({
    priorState, subject, generation: generation.digest, integration
  });
  const { createIntegratedCorrectiveRemainingScopeTransition } =
    await import("./workspace-agent-dispatch-backend-scope.mjs");
  const transition = createIntegratedCorrectiveRemainingScopeTransition({
    mainRepo, subject, controlledContractGeneration: generation.digest,
    integrationChain: chain, integrationHop: hop,
    priorTransition: priorState?.remaining_scope_transition ?? null
  });
  const state = { schema_version: CORRECTIVE_INTEGRATION_STATE_SCHEMA_VERSION,
    chain, remaining_scope_transition: transition };
  const filename = chainStatePath(mainRepo, subject);
  mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });

  const temporary = `${filename}.${process.pid}.tmp`;
  const bytes = `${JSON.stringify(state)}\n`;
  const published = runCrashDurablePlanSync(
    planReplacement({ targetPath: filename, privatePath: temporary, bytes }),
    createSyncEffects({ mode: 0o600 })
  );
  if (published.classification !== CRASH_DURABLE_RESULTS.PUBLISHED) {
    throw published.error ?? new Error(`failed to publish corrective integration state: ${filename}`);
  }
  return Object.freeze(state);
}

export const SLICE_INTEGRATION_REBASE_RESTORE_FAILED_CODE =
  "agent_launch.slice_integration.rebase_restore_failed.v1";
export const SLICE_INTEGRATION_REVIEW_FREEZE_FAILED_CODE =
  "agent_launch.slice_integration.review_freeze_failed.v1";

async function loadDefaultIntegrationDeps() {
  const [
    { resolveWorktreeBinding, defaultRunGitAsync },
    {
      reconcileIntegratedSliceRecord,
      SliceIntegrationError,
      SLICE_INTEGRATION_DIAGNOSTIC_CODES
    },
    { digestTrustedExactReviewEvidence },
    { releaseRetainedSlice },
    { readCanonicalContractGenerationIdentity }
  ] = await Promise.all([
    import("./worktree-substrate.mjs"),
    import("./slice-integration.mjs"),
    import("./workspace-agent-dispatch-run-receipt.mjs"),
    import("./worktree-reaper.mjs"),
    import("./slice-integration-authorization.mjs")
  ]);
  return {
    resolveWorktreeBinding,
    defaultRunGitAsync,
    reconcileIntegratedSliceRecord,
    SliceIntegrationError,
    SLICE_INTEGRATION_DIAGNOSTIC_CODES,
    digestTrustedExactReviewEvidence,
    releaseRetainedSlice,
    readCanonicalContractGenerationIdentity,
  };
}

const INTEGRATION_OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

export const INTEGRATED_SLICE_CLEANUP_STATES = Object.freeze({

  NOT_REQUIRED: "not_required",

  CONFIRMED_RELEASED: "confirmed_released"
});

export const INTEGRATED_SLICE_CLEANUP_UNCERTAIN_CODE =
  "agent_launch.slice_integration.integrated_cleanup_uncertain.v1";

async function integrationResolvedCommit(runGit, repo, value, SliceIntegrationError, codes) {
  const result = await runGit({ repo, args: ["rev-parse", "--verify", `${value}^{commit}`] });
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

async function confirmIntegratedSliceCleanup({
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

  const wkTip = await integrationResolvedCommit(runGit, mainRepo, wkRef, SliceIntegrationError, codes);
  if (wkTip !== recovered.wk_sha) {
    refuse("the current WK tip no longer matches the proven integrated marker state", {
      wk_tip: wkTip,
      proven_wk_sha: recovered.wk_sha
    });
  }
  const sliceTip = await integrationResolvedCommit(runGit, mainRepo, sliceRef, SliceIntegrationError, codes);
  if (sliceTip !== recovered.delivery_sha) {
    refuse("the retained exact-slice delivery no longer matches the proven integrated delivery", {
      slice_tip: sliceTip,
      proven_delivery_sha: recovered.delivery_sha
    });
  }

  const ancestor = await runGit({
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
  authorizedRequest = null,
  authorizedContinuation = null,
  deps = null
}) {
  const {
    resolveWorktreeBinding,
    defaultRunGitAsync,
    reconcileIntegratedSliceRecord,
    SliceIntegrationError,
    SLICE_INTEGRATION_DIAGNOSTIC_CODES: codes,
    digestTrustedExactReviewEvidence: configuredEvidenceDigest,
    releaseRetainedSlice,
    readCanonicalContractGenerationIdentity: configuredReadCanonicalContractGeneration
  } = deps ?? await loadDefaultIntegrationDeps();
  const runGit = deps?.runGit ?? defaultRunGitAsync;
  const readCanonicalContractGenerationIdentity = configuredReadCanonicalContractGeneration ??
    (await import("./slice-integration-authorization.mjs")).readCanonicalContractGenerationIdentity;
  const digestTrustedExactReviewEvidence = configuredEvidenceDigest ??
    (await import("./workspace-agent-dispatch-run-receipt.mjs"))
      .digestTrustedExactReviewEvidence;

  const authorization = authorizedRequest ?? authorizedContinuation;
  if (!isPlainObject(authorization) ||
      (authorizedRequest !== null && authorizedContinuation !== null)) {
    throw new SliceIntegrationError("agent-launch trusted integration: launcher-owned integration authorization is unavailable", {
      code: codes.BINDING_MISMATCH
    });
  }
  if (typeof mainRepo !== "string" || !path.isAbsolute(mainRepo) ||
      path.normalize(mainRepo) !== mainRepo) {
    throw new SliceIntegrationError("agent-launch trusted integration: launcher-composed integrationMainRepo must be normalized and absolute", {
      code: codes.INVALID_ARG
    });
  }
  const canonicalCommittedSliceIntegration = deps?.canonicalCommittedSliceIntegration ??
    (await import("./workspace-agent-dispatch-backend-integration.mjs"))
      .createCanonicalCommittedSliceIntegrationAdapter(mainRepo);
  if (typeof canonicalCommittedSliceIntegration !== "function") {
    throw new SliceIntegrationError("agent-launch trusted integration: canonical committed-slice integration adapter is unavailable", {
      code: codes.BINDING_MISMATCH
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
  const authorizedContext = authorization.context;
  const authorizedBinding = authorizedContext?.integration_binding;
  const expectedSubject = `${wkId}#${sliceId}`;
  if (!isPlainObject(authorizedContext) || !isPlainObject(authorizedBinding) ||
      !isPlainObject(authorization.contract_generation) ||
      authorizedContext.review_admission_kind !== "canonical_committed_slice" ||
      authorizedContext.review_subject !== expectedSubject ||
      authorizedContext.initiative !== initiative ||
      authorizedContext.record_id !== wkId ||
      authorizedContext.review_slice_id !== sliceId ||
      authorizedContext.slice_ref !== sliceRef ||
      authorizedContext.diff_base_sha !== sliceBinding.base_sha ||
      authorizedBinding.wk_ref !== wkRef ||
      authorizedBinding.wk_tip_sha !== wkBinding.wk_tip_sha ||
      JSON.stringify(authorizedBinding.contract_generation) !==
        JSON.stringify(authorization.contract_generation)) {
    throw new SliceIntegrationError("agent-launch trusted integration: authorized integration binding is stale or mismatched", {
      code: codes.BINDING_MISMATCH
    });
  }
  const boundaryTarget = authorization.boundaryAuthorization?.target;
  if (!isPlainObject(boundaryTarget) ||
      boundaryTarget.subject !== expectedSubject ||
      boundaryTarget.initiative !== initiative ||
      boundaryTarget.slice_ref !== sliceRef ||
      boundaryTarget.diff_base_sha !== sliceBinding.base_sha) {
    throw new SliceIntegrationError("agent-launch trusted integration: authorized integration target is absent or mismatched", {
      code: codes.BINDING_MISMATCH
    });
  }

  if (!Object.values(TERMINAL_REVIEW_EVIDENCE_COMPOSITIONS).includes(terminalReviewEvidenceComposition)) {
    throw new SliceIntegrationError("agent-launch trusted integration: launcher-owned terminal review evidence composition is invalid", {
      code: codes.INVALID_ARG
    });
  }

  const currentContractGeneration = await readCanonicalContractGenerationIdentity(mainRepo, wkId);
  if (!isPlainObject(currentContractGeneration) ||
      JSON.stringify(currentContractGeneration) !== JSON.stringify(authorization.contract_generation) ||
      JSON.stringify(currentContractGeneration) !== JSON.stringify(authorizedBinding.contract_generation)) {
    throw new SliceIntegrationError("agent-launch trusted integration: authorized contract generation is stale or mismatched with the current canonical generation", {
      code: codes.BINDING_MISMATCH
    });
  }

  const recoveredIntegration = typeof reconcileIntegratedSliceRecord === "function"
    ? await reconcileIntegratedSliceRecord({
        mainRepo,
        unitAddress: sliceBinding.unit_address,
        sliceRef,
        wkRef,
        baseSha: sliceBinding.base_sha,
        deps: { runGit }
      })
    : null;

  if (recoveredIntegration !== null) {
    const cleanup = await confirmIntegratedSliceCleanup({
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

    const correctiveState = readTrustedCorrectiveIntegrationState({
      mainRepo, subject: assignedUnit
    });
    return Object.freeze({
      ...recoveredIntegration,
      cleanup,
      terminal_review_evidence: null,
      corrective_integration_chain: correctiveState?.chain ?? null,
      corrective_remaining_scope_transition:
        correctiveState?.remaining_scope_transition ?? null
    });
  }

  assertFreshIntegrationSliceBaseAdmission({
    wkBinding, sliceBinding, SliceIntegrationError, codes
  });
  const commit = await integrationResolvedCommit(runGit, mainRepo, sliceRef, SliceIntegrationError, codes);

  const committedTarget = Object.freeze({
    ...authorizedContext,
    reviewed_sha: commit,
    diff_head_sha: commit,
    integration_binding: authorizedBinding
  });
  if (boundaryTarget.reviewed_sha !== commit ||
      authorizedContext.committed_target_digest !== boundaryTarget.committed_target_digest) {
    throw new SliceIntegrationError("agent-launch trusted integration: authorized integration target is stale", {
      code: codes.BINDING_MISMATCH
    });
  }
  const integration = await canonicalCommittedSliceIntegration({
    context: committedTarget,
    boundaryAuthorization: authorization.boundaryAuthorization
  });
  let correctiveState;
  try {
    correctiveState = await persistCorrectiveIntegrationState({
      mainRepo, subject: assignedUnit, integration, deps
    });
  } catch (error) {
    throw new SliceIntegrationError(
      "agent-launch trusted integration: corrective integration state persistence failed",
      { code: SLICE_INTEGRATION_REVIEW_FREEZE_FAILED_CODE,
        detail: { corrective_state_code: error?.code ?? null }, cause: error }
    );
  }

  let cleanup;
  {
    try {
      if (typeof releaseRetainedSlice !== "function") {
        throw new Error("writable trusted runtime exact-slice reaper is unavailable");
      }
      const integratedSliceSha = await integrationResolvedCommit(
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

    return Object.freeze({ ...integration, cleanup, terminal_review_evidence: null,
      corrective_integration_chain: correctiveState?.chain ?? null,
      corrective_remaining_scope_transition: correctiveState?.remaining_scope_transition ?? null });
  }

  return Object.freeze({ ...integration, cleanup, terminal_review_evidence: null,
    corrective_integration_chain: correctiveState?.chain ?? null,
    corrective_remaining_scope_transition: correctiveState?.remaining_scope_transition ?? null });
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
