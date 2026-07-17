

import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  HOST_WRITE_AUTHORITY_OPS,
  HOST_WRITE_AUTHORITY_REQUEST_SCHEMA_VERSION,
  HOST_WRITE_AUTHORITY_RESPONSE_KINDS,
  HOST_WRITE_AUTHORITY_RESPONSE_SCHEMA_VERSION,
  HOST_WRITE_AUTHORITY_SUBSTRATE_ID,
  HOST_WRITE_AUTHORITY_SUBSTRATE_PROTOCOL_VERSION,
  isPlainObject
} from "./protocol-constants.mjs";
import {
  findForbiddenToken,
  findForbiddenTokenInLaunchInput,
  findForbiddenTokenInResponseEnvelope
} from "./forbidden-token-scan.mjs";

import {
  buildWorkspaceAgentFailOpenPlan,
  WORKSPACE_AGENT_FAIL_OPEN_DISPOSITIONS
} from "../launch-isolation-failopen.mjs";

import {
  bootstrapNodeEngineEnvFromFile,
  resolveNodeEngineEnvFilePath
} from "@agent-chassis/wiki-core/src/lib/node-engine-env-bootstrap.mjs";

export const HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS = Object.freeze({
  REQUEST_MALFORMED: "broker_request_malformed",
  PROTOCOL_VERSION_UNSUPPORTED: "broker_protocol_version_unsupported",
  OP_UNRECOGNIZED: "broker_op_unrecognized",
  FORBIDDEN_TOKEN_IN_REQUEST: "broker_forbidden_token_in_request",
  LAUNCH_INPUT_INVALID: "broker_launch_input_invalid",
  PLAN_REFUSED: "broker_plan_refused",
  PLAN_THREW: "broker_plan_threw",
  ISOLATION_UNAVAILABLE: "broker_isolation_unavailable",
  SPAWN_FAILED: "broker_spawn_failed",
  UNKNOWN_RUN_HANDLE: "broker_unknown_run_handle",

  FAMILY_NOT_CONFIGURED: "broker_family_not_configured",

  APP_REQUIRED: "broker_app_required",

  FINAL_RESULT_PARSER_MISSING: "broker_final_result_parser_missing",

  WORKER_ADMISSION_REFUSED: "broker_worker_admission_refused",
  WORKER_ADMISSION_THREW: "broker_worker_admission_threw",
  PRESPAWN_CLEANUP_DRIFT: "broker_prespawn_cleanup_drift",
  PRESPAWN_CLEANUP_FAILED: "broker_prespawn_cleanup_failed",

  PROVISIONING_UNAVAILABLE: "broker_provisioning_unavailable",

  PROVISIONING_REQUEST_INVALID: "broker_provisioning_request_invalid",

  PROVISIONING_THREW: "broker_provisioning_threw",

  COMMIT_UNAVAILABLE: "broker_commit_unavailable",

  COMMIT_REQUEST_INVALID: "broker_commit_request_invalid",

  COMMIT_THREW: "broker_commit_threw",

  COMMIT_SCOPE_REFUSED: "broker_commit_scope_refused",

  INTEGRATION_UNAVAILABLE: "broker_integration_unavailable",

  INTEGRATION_REQUEST_INVALID: "broker_integration_request_invalid",

  INTEGRATION_IN_FLIGHT: "broker_integration_in_flight",

  INTEGRATION_ALREADY_INTEGRATED: "broker_integration_already_integrated",

  INTEGRATION_LATCHED_INDETERMINATE: "broker_integration_latched_indeterminate",

  INTEGRATION_THREW: "broker_integration_threw"
});

export const HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES = Object.freeze({
  REQUEST_INVALID: "broker_request_invalid",
  PLAN_REFUSED: "broker_plan_refused",
  PLAN_THREW: "broker_plan_threw",
  ISOLATION_UNAVAILABLE: "broker_isolation_unavailable",
  SPAWN_FAILED: "broker_spawn_failed",
  RUN_HANDLE_UNKNOWN: "broker_run_handle_unknown"
});

const HOST_WRITE_AUTHORITY_BROKER_RUN_HANDLE_PREFIX = "hwa_run_";

const WRITABLE_FILE_PRECREATION_CLEANUP_SCHEMA_VERSION =
  "writable-file-precreation-cleanup.v1";

function sameManagedUnitSubject(subject, attemptBinding) {
  if (typeof subject !== "string" || subject.length === 0) return false;
  const selected = attemptBinding?.selected_unit_address;
  const unit = attemptBinding?.unit_address;
  return subject === selected || subject === unit ||
    (typeof selected === "string" && selected.length > 0 &&
      typeof unit === "string" && unit.endsWith(`/${subject.replace("#", "/")}`));
}

export function bindAttemptOwnedPreSpawnCleanup({
  bwrapPlan,
  role,
  subject,
  runId
} = {}) {
  const capability = bwrapPlan?.writableFilePrecreationCleanup ?? null;
  const authority = bwrapPlan?.workerScopeAuthority ?? null;
  if (role !== "worker" || (capability == null && authority == null)) {
    return null;
  }
  let invoked = false;
  let cleanupResult = null;
  const cleanupOnce = () => {
    if (invoked) return cleanupResult;
    invoked = true;
    if (capability == null) return null;
    cleanupResult = capability.cleanup();
    return cleanupResult;
  };
  const binding = capability?.attempt_binding;
  const entriesValid = Array.isArray(capability?.entries) &&
    Object.isFrozen(capability.entries) &&
    capability.entries.every((entry) => entry && typeof entry === "object" && Object.isFrozen(entry));
  const valid = capability && typeof capability === "object" && Object.isFrozen(capability) &&
    capability.schema_version === WRITABLE_FILE_PRECREATION_CLEANUP_SCHEMA_VERSION &&
    typeof capability.attempt_id === "string" && capability.attempt_id.length > 0 &&
    typeof capability.cleanup === "function" && Object.isFrozen(capability.cleanup) &&
    entriesValid && binding && typeof binding === "object" && Object.isFrozen(binding) &&
    authority && typeof authority === "object" && Object.isFrozen(authority) &&
    typeof runId === "string" && runId.length > 0 &&
    binding.unit_address === authority.unit_address &&
    binding.selected_unit_address === authority.selected_unit?.address &&
    binding.source_digest === authority.source_digest &&
    sameManagedUnitSubject(subject, binding);
  return Object.freeze({
    attempt_id: capability?.attempt_id ?? null,
    run_id: typeof runId === "string" ? runId : null,
    unit_address: binding?.unit_address ?? null,
    valid,
    cleanupOnce
  });
}

function defaultRunHandleFactory() {
  return `${HOST_WRITE_AUTHORITY_BROKER_RUN_HANDLE_PREFIX}${randomBytes(12).toString("hex")}`;
}

async function spawnPlainChildLaunch(command, args, options) {
  const childProcess = await import("node:" + "child_process");
  return childProcess.spawn(command, Array.isArray(args) ? [...args] : [], options);
}

export function buildBrokerWorkerAdmissionEnv({
  workspaceDir = null,
  baseEnv = process.env
} = {}) {
  const env = { ...baseEnv };
  const envFilePath = resolveNodeEngineEnvFilePath(
    typeof workspaceDir === "string" ? workspaceDir : ""
  );

  bootstrapNodeEngineEnvFromFile({ env, envFilePath });
  return env;
}

const REFUSAL_DETAIL_MAX_DEPTH = 4;
const REFUSAL_DETAIL_MAX_STRING = 2048;
const REFUSAL_DETAIL_MAX_ARRAY = 64;
const REFUSAL_DETAIL_MAX_KEYS = 64;

function boundStructuredRefusalDetail(value, depth = 0) {
  if (value === null) return null;
  const type = typeof value;
  if (type === "string") {
    return value.length > REFUSAL_DETAIL_MAX_STRING
      ? `${value.slice(0, REFUSAL_DETAIL_MAX_STRING)}…[truncated ${value.length - REFUSAL_DETAIL_MAX_STRING} chars]`
      : value;
  }
  if (type === "number") return Number.isFinite(value) ? value : null;
  if (type === "boolean") return value;
  if (Array.isArray(value)) {
    if (depth >= REFUSAL_DETAIL_MAX_DEPTH) return "[depth-capped array]";
    const out = value
      .slice(0, REFUSAL_DETAIL_MAX_ARRAY)
      .map((child) => boundStructuredRefusalDetail(child, depth + 1));
    if (value.length > REFUSAL_DETAIL_MAX_ARRAY) {
      out.push(`…[truncated ${value.length - REFUSAL_DETAIL_MAX_ARRAY} items]`);
    }
    return out;
  }
  if (isPlainObject(value)) {
    if (depth >= REFUSAL_DETAIL_MAX_DEPTH) return "[depth-capped object]";
    const out = {};
    for (const key of Object.keys(value).slice(0, REFUSAL_DETAIL_MAX_KEYS)) {
      out[key] = boundStructuredRefusalDetail(value[key], depth + 1);
    }
    return out;
  }
  return `[${type}]`;
}

export function brokerBuildRefusalResponse({ code, reason, detail = null, runHandle = null }) {
  return Object.freeze({
    schema_version: HOST_WRITE_AUTHORITY_RESPONSE_SCHEMA_VERSION,
    substrate_id: HOST_WRITE_AUTHORITY_SUBSTRATE_ID,
    protocol_version: HOST_WRITE_AUTHORITY_SUBSTRATE_PROTOCOL_VERSION,
    kind: HOST_WRITE_AUTHORITY_RESPONSE_KINDS.REFUSAL,
    run_handle: runHandle,
    refusal: Object.freeze({
      code,
      reason,
      detail: detail === null ? null : Object.freeze({ ...detail })
    })
  });
}

function brokerBuildAcceptedResponse({ runHandle, status, pid, failOpen = null }) {
  return Object.freeze({
    schema_version: HOST_WRITE_AUTHORITY_RESPONSE_SCHEMA_VERSION,
    substrate_id: HOST_WRITE_AUTHORITY_SUBSTRATE_ID,
    protocol_version: HOST_WRITE_AUTHORITY_SUBSTRATE_PROTOCOL_VERSION,
    kind: HOST_WRITE_AUTHORITY_RESPONSE_KINDS.LAUNCH_ACCEPTED,
    run_handle: runHandle,
    status,
    pid: typeof pid === "number" ? pid : null,

    fail_open: isPlainObject(failOpen) ? Object.freeze({ ...failOpen }) : null
  });
}

function brokerBuildProbeResponse({ status, exit, finalResult }) {
  return Object.freeze({
    schema_version: HOST_WRITE_AUTHORITY_RESPONSE_SCHEMA_VERSION,
    substrate_id: HOST_WRITE_AUTHORITY_SUBSTRATE_ID,
    protocol_version: HOST_WRITE_AUTHORITY_SUBSTRATE_PROTOCOL_VERSION,
    kind: HOST_WRITE_AUTHORITY_RESPONSE_KINDS.PROBE_RESULT,
    status,
    exit: exit === null ? null : Object.freeze({ ...exit }),
    final_result: finalResult ?? null
  });
}

function brokerBuildProvisionedResponse({ provisioning }) {
  return Object.freeze({
    schema_version: HOST_WRITE_AUTHORITY_RESPONSE_SCHEMA_VERSION,
    substrate_id: HOST_WRITE_AUTHORITY_SUBSTRATE_ID,
    protocol_version: HOST_WRITE_AUTHORITY_SUBSTRATE_PROTOCOL_VERSION,
    kind: HOST_WRITE_AUTHORITY_RESPONSE_KINDS.WORKTREE_PROVISIONED,
    provisioning
  });
}

function brokerBuildSliceCommittedResponse({ commitResult }) {
  return Object.freeze({
    schema_version: HOST_WRITE_AUTHORITY_RESPONSE_SCHEMA_VERSION,
    substrate_id: HOST_WRITE_AUTHORITY_SUBSTRATE_ID,
    protocol_version: HOST_WRITE_AUTHORITY_SUBSTRATE_PROTOCOL_VERSION,
    kind: HOST_WRITE_AUTHORITY_RESPONSE_KINDS.SLICE_COMMITTED,
    commit_result: commitResult
  });
}

function brokerBuildSliceIntegratedResponse({ integration }) {
  return Object.freeze({
    schema_version: HOST_WRITE_AUTHORITY_RESPONSE_SCHEMA_VERSION,
    substrate_id: HOST_WRITE_AUTHORITY_SUBSTRATE_ID,
    protocol_version: HOST_WRITE_AUTHORITY_SUBSTRATE_PROTOCOL_VERSION,
    kind: HOST_WRITE_AUTHORITY_RESPONSE_KINDS.SLICE_INTEGRATED,
    integration
  });
}

const SLICE_INTEGRATION_REBASE_RESTORE_FAILED_CODE =
  "agent_launch.slice_integration.rebase_restore_failed.v1";
const SLICE_INTEGRATION_REVIEW_FREEZE_FAILED_CODE =
  "agent_launch.slice_integration.review_freeze_failed.v1";

async function loadDefaultIntegrationDeps() {
  const [
    { resolveWorktreeBinding, defaultRunGit },
    { integrateCommittedSlice, SliceIntegrationError, SLICE_INTEGRATION_DIAGNOSTIC_CODES },
    { setWorkRecordStatusByUnit }
  ] = await Promise.all([
    import("../worktree-substrate.mjs"),
    import("../slice-integration.mjs"),
    import("@agent-chassis/wiki-core")
  ]);
  return {
    resolveWorktreeBinding,
    defaultRunGit,
    integrateCommittedSlice,
    SliceIntegrationError,
    SLICE_INTEGRATION_DIAGNOSTIC_CODES,
    setWorkRecordStatusByUnit
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

function integrationAssertExactCleanWkWorktree({ mainRepo, worktreePath, wkRef, expectedSha, runGit, message, SliceIntegrationError, codes }) {
  if (typeof worktreePath !== "string" || !path.isAbsolute(worktreePath)) {
    throw new SliceIntegrationError("agent-launch broker integration: persistent full WK worktree path is unavailable or non-absolute", {
      code: codes.BINDING_MISMATCH
    });
  }
  const branch = runGit({ repo: worktreePath, args: ["symbolic-ref", "-q", "HEAD"] });
  if (!branch || branch.ok !== true) {
    throw new SliceIntegrationError(`agent-launch broker integration: ${message}`, {
      code: codes.BINDING_MISMATCH,
      detail: { stderr: branch?.stderr ?? branch?.error ?? null }
    });
  }
  const head = integrationResolvedCommit(runGit, worktreePath, "HEAD", SliceIntegrationError, codes);
  const ref = integrationResolvedCommit(runGit, mainRepo, wkRef, SliceIntegrationError, codes);
  const status = runGit({ repo: worktreePath, args: ["status", "--porcelain=v1", "--untracked-files=all"] });
  if (!status || status.ok !== true) {
    throw new SliceIntegrationError("agent-launch broker integration: could not inspect persistent full WK worktree status", {
      code: codes.WORKTREE_DIRTY
    });
  }
  const actualBranch = String(branch.stdout ?? "").trim();
  const dirty = String(status.stdout ?? "");
  if (actualBranch !== wkRef || head !== expectedSha || ref !== expectedSha) {
    throw new SliceIntegrationError(`agent-launch broker integration: ${message}`, {
      code: codes.BINDING_MISMATCH,
      detail: { expected_ref: wkRef, actual_ref: actualBranch || null, expected_sha: expectedSha, head_sha: head, ref_sha: ref }
    });
  }
  if (dirty.length !== 0) {
    throw new SliceIntegrationError("agent-launch broker integration: persistent full WK worktree must be completely clean before fast-forward", {
      code: codes.WORKTREE_DIRTY,
      detail: { wk_ref: wkRef, expected_sha: expectedSha, status: dirty }
    });
  }
}

function createBrokerPersistentWkWorktreeAdvance({ mainRepo, worktreePath, wkRef, expectedOldSha, runGit, SliceIntegrationError, codes }) {
  const state = { advancedSha: null };
  const assertOld = () => integrationAssertExactCleanWkWorktree({
    mainRepo, worktreePath, wkRef, expectedSha: expectedOldSha, runGit,
    message: "persistent full WK worktree/ref binding moved before fast-forward",
    SliceIntegrationError, codes
  });
  const restoreIntegrated = (integratedSha) => {
    integrationAssertExactCleanWkWorktree({
      mainRepo, worktreePath, wkRef, expectedSha: integratedSha, runGit,
      message: "persistent full WK worktree/ref moved before compensation",
      SliceIntegrationError, codes
    });
    const reset = runGit({ repo: worktreePath, args: ["reset", "--keep", expectedOldSha] });
    if (!reset || reset.ok !== true) {
      throw new SliceIntegrationError("agent-launch broker integration: persistent full WK compensation failed", {
        code: codes.REVIEW_FREEZE_FAILED,
        detail: { stderr: reset?.stderr ?? reset?.error ?? null }
      });
    }
    assertOld();
  };
  assertOld();
  return Object.freeze({
    advance(integratedSha) {
      if (!INTEGRATION_OID_RE.test(integratedSha) || /^0+$/u.test(integratedSha)) {
        throw new SliceIntegrationError("agent-launch broker integration: integrated WK SHA is invalid", { code: codes.INVALID_ARG });
      }
      assertOld();
      const merge = runGit({ repo: worktreePath, args: ["merge", "--ff-only", "--no-edit", integratedSha] });
      if (!merge || merge.ok !== true) {

        assertOld();
        throw new SliceIntegrationError("agent-launch broker integration: persistent full WK worktree fast-forward failed", {
          code: codes.WK_ADVANCE_CONFLICT,
          detail: { status: merge?.status ?? null, stderr: merge?.stderr ?? merge?.error ?? null }
        });
      }
      try {
        integrationAssertExactCleanWkWorktree({
          mainRepo, worktreePath, wkRef, expectedSha: integratedSha, runGit,
          message: "persistent full WK worktree/ref did not reach the integrated SHA",
          SliceIntegrationError, codes
        });
      } catch (error) {
        try {
          restoreIntegrated(integratedSha);
        } catch (rollback) {
          throw new SliceIntegrationError("agent-launch broker integration: persistent full WK fast-forward verification and compensation failed", {
            code: codes.WK_ADVANCE_CONFLICT,
            detail: { rollback: rollback?.message ?? String(rollback) },
            cause: error
          });
        }
        throw error;
      }
      state.advancedSha = integratedSha;
    },
    compensate(integratedSha) {
      if (state.advancedSha !== integratedSha) {
        throw new SliceIntegrationError("agent-launch broker integration: persistent full WK compensation does not match the completed fast-forward", {
          code: codes.REVIEW_FREEZE_FAILED,
          detail: { expected_integrated_sha: state.advancedSha, actual_integrated_sha: integratedSha }
        });
      }
      restoreIntegrated(integratedSha);
      state.advancedSha = null;
    }
  });
}

export async function defaultIntegrateManagedWorkerSlice({ mainRepo, assignedUnit, launchRef, runId, retryId, deps = null }) {
  const {
    resolveWorktreeBinding,
    defaultRunGit,
    integrateCommittedSlice,
    SliceIntegrationError,
    SLICE_INTEGRATION_DIAGNOSTIC_CODES: codes,
    setWorkRecordStatusByUnit
  } = deps ?? await loadDefaultIntegrationDeps();
  const runGit = deps?.runGit ?? defaultRunGit;

  if (typeof mainRepo !== "string" || !path.isAbsolute(mainRepo)) {
    throw new SliceIntegrationError("agent-launch broker integration: launcher-composed integrationMainRepo must be absolute", {
      code: codes.INVALID_ARG
    });
  }

  const rawSliceBinding = resolveWorktreeBinding({ mainRepo, launchRef, runId: `${runId}.slice`, retryId });

  const sliceBinding = verifyExactSliceCommitBinding({
    binding: rawSliceBinding, mainRepo, assignedUnit, launchRef, runId: `${runId}.slice`, retryId
  });
  const [initiative, wkId, sliceId] = String(sliceBinding.unit_address).split("/");
  const wkBinding = resolveWorktreeBinding({ mainRepo, launchRef, runId: `${runId}.wk`, retryId });
  if (!isPlainObject(wkBinding) ||
      typeof wkBinding.worktree_path !== "string" || !path.isAbsolute(wkBinding.worktree_path) ||
      wkBinding.base_sha !== sliceBinding.base_sha) {
    throw new SliceIntegrationError("agent-launch broker integration: full WK binding is missing or does not share the exact frozen base", {
      code: codes.BINDING_MISMATCH
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

  return integrateCommittedSlice({
    mainRepo,
    worktreePath: sliceBinding.worktree_path,
    unitAddress: sliceBinding.unit_address,
    sliceRef,
    wkRef,
    baseSha: sliceBinding.base_sha,
    commit,
    workerTerminated: true,
    transitionToReview: async ({ unitAddress, status: nextStatus }) =>
      setWorkRecordStatusByUnit({ dir: mainRepo, unitAddress, status: nextStatus }),
    deps: {
      runGit,
      createWkAdvance: (input) => createBrokerPersistentWkWorktreeAdvance({
        ...input,
        worktreePath: wkBinding.worktree_path,
        SliceIntegrationError,
        codes
      })
    }
  });
}

const COMMIT_SLICE_ENVELOPE_FIELDS = Object.freeze([
  "schema_version", "substrate_id", "protocol_version", "op", "commit_request"
]);
const COMMIT_SLICE_REQUEST_FIELDS = Object.freeze([
  "assigned_unit", "launch_ref", "run_id", "retry_id"
]);
const COMMIT_SLICE_ASSIGNED_UNIT_RE = /^WK-\d{4}#SLICE-\d{3}$/u;

const INTEGRATE_SLICE_ENVELOPE_FIELDS = Object.freeze([
  "schema_version", "substrate_id", "protocol_version", "op", "integrate_request"
]);
const INTEGRATE_SLICE_REQUEST_FIELDS = Object.freeze([
  "assigned_unit", "launch_ref", "run_id", "retry_id"
]);
const INTEGRATE_SLICE_ASSIGNED_UNIT_RE = /^WK-\d{4}#SLICE-\d{3}$/u;

async function loadDefaultCommitDeps() {
  const [
    { resolveWorktreeBinding },
    { materializeCommitObject, advanceWkRef },
    { verifyAndMeasureCommitScope },
    { commitSliceRef },
    { deriveWritableMountsFromWriteScope },
    { admitWorkerCommitCall }
  ] = await Promise.all([
    import("../worktree-substrate.mjs"),
    import("../commit-object-primitive.mjs"),
    import("../commit-scope-envelope.mjs"),
    import("../slice-integration.mjs"),
    import("../workspace-agent-write-scope.mjs"),
    import("../commit-tool-exposure-guard.mjs")
  ]);
  return {
    resolveWorktreeBinding, materializeCommitObject, advanceWkRef,
    verifyAndMeasureCommitScope, commitSliceRef, deriveWritableMountsFromWriteScope,
    admitWorkerCommitCall
  };
}

export async function defaultCommitManagedWorkerSlice({ mainRepo, assignedUnit, launchRef, runId, retryId, deps = null }) {
  const {
    resolveWorktreeBinding,
    materializeCommitObject,
    advanceWkRef,
    verifyAndMeasureCommitScope,
    commitSliceRef,
    deriveWritableMountsFromWriteScope,
    admitWorkerCommitCall
  } = deps ?? await loadDefaultCommitDeps();

  let rawBinding = null;
  const admitted = admitWorkerCommitCall({

    credential: Object.freeze({ kind: "commit_slice_tuple", launchRef, runId, retryId }),
    workerArgs: {},
    deps: {
      resolveBinding() {
        const binding = resolveWorktreeBinding({ mainRepo, launchRef, runId, retryId });
        rawBinding = verifyExactSliceCommitBinding({
          binding, mainRepo, assignedUnit, launchRef, runId, retryId
        });
        return rawBinding;
      }
    }
  });
  const binding = admitted.binding;
  const serverResolvedBinding = rawBinding ?? binding;
  const gitIdentity = resolveCommitGitIdentity(serverResolvedBinding, mainRepo);
  const commitTarget = normalizeCommitRef(binding.output_branch);

  const materialized = materializeCommitObject({
    gitDir: gitIdentity.gitDir,
    workTree: gitIdentity.workTree,
    baseSha: binding.base_sha,
    message: admitted.server_generated_message,
    sparseBinding: resolveSparseBinding(serverResolvedBinding)
  });

  const scope = verifyAndMeasureCommitScope({
    gitDir: gitIdentity.gitDir,
    baseSha: materialized.base_sha,
    commit: materialized.commit,
    tree: materialized.tree,
    writeScope: binding.write_scope,
    expectedEnvelope: resolveExpectedEnvelope(serverResolvedBinding),
    deps: {
      resolveWriteScope(writeScope) {
        return resolveCommitWriteScopeMatcher(deriveWritableMountsFromWriteScope, mainRepo, writeScope);
      }
    }
  });
  if (scope.contained !== true) {
    return {
      scope_refused: true,
      changed_paths: scope.changed_paths ?? [],
      refusal: scope.refusal ?? null
    };
  }

  let advanced;
  if (commitTarget.kind === "slice") {
    advanced = commitSliceRef({
      repo: mainRepo,
      sliceRef: commitTarget.ref,
      baseSha: materialized.base_sha,
      tree: materialized.tree,
      commit: materialized.commit
    });
  } else {
    advanced = advanceWkRef({
      gitDir: gitIdentity.gitDir,
      ref: commitTarget.ref,
      baseSha: materialized.base_sha,
      tree: materialized.tree,
      commit: materialized.commit
    });
  }

  return {
    committed: true,
    submitted_for_review: false,
    assigned_unit: assignedUnit,
    commit: advanced.commit,
    tree: advanced.tree,
    base_sha: advanced.base_sha,
    ref: advanced.ref,
    idempotent: advanced.idempotent,
    changed_paths: scope.changed_paths,
    metrics: scope.metrics,
    baseline: scope.baseline,
    attestation: scope.attestation,
    expected_envelope_invariant: scope.expected_envelope_invariant,
    transition: {
      submitted: false,
      status: "awaiting_worker_termination_and_wk_integration"
    }
  };
}

const WORKTREE_SUBSTRATE_BINDING_SCHEMA_VERSION = "worktree-identity-binding.v1";
const COMMIT_BINDING_COMMIT_ID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const COMMIT_BINDING_SOURCE_DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;

const EXACT_SPARSE_SLICE_BINDING_FIELDS = Object.freeze([
  "schema_version", "launch_ref", "run_id", "retry_id", "unit_address", "initiative",
  "record_id", "slice_id", "base_ref", "base_sha", "output_branch", "worktree_path",
  "read_scope", "repo_paths", "write_scope", "write_scope_source", "selected_unit",
  "source_digest", "source_version", "cone_dirs", "index_sparse"
]);

function commitPlainObject(value) {
  return isPlainObject(value);
}

function isNormalizedRepoPathEntry(value) {
  return typeof value === "string" && value.length > 0 && value === value.trim() &&
    !path.posix.isAbsolute(value) && !value.startsWith("-") && !value.includes("\\") &&
    // eslint-disable-next-line no-control-regex
    !/[\x00-\x1f\x7f]/u.test(value) && path.posix.normalize(value) === value && value !== "." &&
    value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function isCanonicalRepoPathArray(value, { nonEmpty = false } = {}) {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0) ||
      value.some((entry) => !isNormalizedRepoPathEntry(entry))) {
    return false;
  }

  return value.every((entry, index) => index === 0 || value[index - 1] < entry);
}

export function verifyExactSliceCommitBinding({ binding, mainRepo, assignedUnit, launchRef, runId, retryId }) {
  const UNIT_ADDRESS_RE = /^(IN-\d{4})\/(WK-\d{4})\/(SLICE-\d{3})$/u;
  const ASSIGNED_UNIT_RE = /^(WK-\d{4})#(SLICE-\d{3})$/u;

  if (typeof mainRepo !== "string" || !path.isAbsolute(mainRepo)) {
    throw new Error("commit binding verification requires an absolute launcher-composed commitMainRepo");
  }
  if (!commitPlainObject(binding)) {
    throw new Error("identity-store commit binding must be an object");
  }

  const bindingKeys = Object.keys(binding);
  if (bindingKeys.length !== EXACT_SPARSE_SLICE_BINDING_FIELDS.length ||
      !EXACT_SPARSE_SLICE_BINDING_FIELDS.every((field) => Object.prototype.hasOwnProperty.call(binding, field))) {
    throw new Error("identity-store commit binding is not the exact canonical sparse-slice schema");
  }
  if (binding.schema_version !== WORKTREE_SUBSTRATE_BINDING_SCHEMA_VERSION) {
    throw new Error("identity-store commit binding schema_version is not the canonical worktree identity schema");
  }

  if (binding.launch_ref !== launchRef || binding.run_id !== runId ||
      !Number.isInteger(binding.retry_id) || binding.retry_id !== retryId) {
    throw new Error("identity-store commit binding launch_ref/run_id/retry_id does not match the exact commit request");
  }
  const unitMatch = typeof binding.unit_address === "string"
    ? UNIT_ADDRESS_RE.exec(binding.unit_address)
    : null;
  if (!unitMatch) {
    throw new Error("identity-store commit binding unit_address must identify one canonical exact slice");
  }
  const [, initiative, recordId, sliceId] = unitMatch;
  const subject = `${recordId}#${sliceId}`;
  const assignedMatch = typeof assignedUnit === "string"
    ? ASSIGNED_UNIT_RE.exec(assignedUnit)
    : null;
  if (!assignedMatch || assignedMatch[1] !== recordId || assignedMatch[2] !== sliceId) {
    throw new Error("launcher-assigned unit does not match the identity-store exact slice");
  }
  if (binding.initiative !== initiative) {
    throw new Error("identity-store commit binding initiative does not match unit_address");
  }
  if (binding.record_id !== recordId) {
    throw new Error("identity-store commit binding record_id does not match unit_address");
  }
  if (binding.slice_id !== sliceId) {
    throw new Error("identity-store commit binding slice_id does not match unit_address");
  }

  const selectedUnit = binding.selected_unit;
  if (!commitPlainObject(selectedUnit) ||
      selectedUnit.kind !== "slice" ||
      selectedUnit.address !== subject ||
      selectedUnit.record_id !== recordId ||
      selectedUnit.slice_id !== sliceId ||
      !Object.prototype.hasOwnProperty.call(selectedUnit, "repo") ||
      !(selectedUnit.repo === null || (typeof selectedUnit.repo === "string" && selectedUnit.repo.length > 0))) {
    throw new Error("identity-store commit binding selected_unit does not match the exact slice");
  }

  const branch = `slice/${initiative}/${recordId}/${sliceId}`;
  if (binding.output_branch !== branch && binding.output_branch !== `refs/heads/${branch}`) {
    throw new Error("identity-store commit binding output_branch does not match the exact slice");
  }

  if (binding.base_ref !== `wk/${initiative}/${recordId}`) {
    throw new Error("identity-store commit binding base_ref does not match the exact slice");
  }
  if (typeof binding.base_sha !== "string" || !COMMIT_BINDING_COMMIT_ID_RE.test(binding.base_sha)) {
    throw new Error("identity-store commit binding base_sha is not a canonical commit id");
  }

  if (!isCanonicalRepoPathArray(binding.write_scope, { nonEmpty: true })) {
    throw new Error("identity-store commit binding write_scope is not a canonical repository-path array");
  }
  if (binding.write_scope_source !== `wiki/work-records/${recordId}.json#${sliceId}`) {
    throw new Error("identity-store commit binding write_scope_source does not match the exact slice");
  }

  for (const field of ["read_scope", "repo_paths"]) {
    if (!isCanonicalRepoPathArray(binding[field])) {
      throw new Error(`identity-store commit binding ${field} is not a canonical repository-path array`);
    }
  }
  if (!isCanonicalRepoPathArray(binding.cone_dirs, { nonEmpty: true })) {
    throw new Error("identity-store commit binding cone_dirs is not a canonical repository-path array");
  }
  if (binding.index_sparse !== false) {
    throw new Error("identity-store commit binding index_sparse must be false");
  }
  if (typeof binding.source_digest !== "string" || !COMMIT_BINDING_SOURCE_DIGEST_RE.test(binding.source_digest)) {
    throw new Error("identity-store commit binding source_digest is not a canonical sha256 digest");
  }
  if (!(binding.source_version === null ||
        (typeof binding.source_version === "string" && binding.source_version.length > 0))) {
    throw new Error("identity-store commit binding source_version is not canonical");
  }

  const worktreePath = binding.worktree_path;
  if (typeof worktreePath !== "string" || !path.isAbsolute(worktreePath) ||
      path.normalize(worktreePath) !== worktreePath || /[*?[\]{}]/u.test(worktreePath) ||
      path.basename(worktreePath) !== `slice-${initiative}-${recordId}-${sliceId}`) {
    throw new Error("identity-store commit binding worktree_path is not the canonical exact-slice worktree path");
  }

  return Object.freeze({ ...binding, subject });
}

function commitFirstNonEmptyString(source, names) {
  for (const name of names) {
    const value = source?.[name];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function resolveCommitGitIdentity(binding, canonicalRepo) {
  const direct = binding.provisionedWorktreeGitBinding ??
    binding.provisioned_worktree_git_binding ??
    binding.provisionedWorktreeGitIdentity ??
    binding.provisioned_worktree_git_identity ??
    binding.git_binding ??
    binding.git_identity ??
    binding;
  const workTree =
    commitFirstNonEmptyString(direct, ["worktreePath", "worktree_path"]) ??
    commitFirstNonEmptyString(binding, ["worktree_path", "worktreePath"]);
  if (!workTree) {
    throw new Error("commit binding lacks server-derived worktreePath/worktree_path");
  }
  const gitDir =
    commitFirstNonEmptyString(direct, ["gitDir", "git_dir", "worktreeGitDir", "worktree_git_dir"]) ??
    path.join(canonicalRepo, ".git", "worktrees", path.basename(workTree));

  const worktreesRoot = path.join(canonicalRepo, ".git", "worktrees");
  if (gitDir !== worktreesRoot && !gitDir.startsWith(`${worktreesRoot}${path.sep}`)) {
    throw new Error("commit binding Git directory is not contained in the launcher-composed commitMainRepo");
  }
  return Object.freeze({ gitDir, workTree });
}

function normalizeCommitRef(outputBranch) {
  const branch = typeof outputBranch === "string" && outputBranch.trim().length > 0
    ? outputBranch.trim()
    : null;
  if (!branch) {
    throw new Error("commit binding lacks output_branch");
  }
  const ref = branch.startsWith("refs/heads/") ? branch : `refs/heads/${branch}`;
  if (/^refs\/heads\/wk\/IN-\d{4}\/WK-\d{4}$/u.test(ref)) {
    return Object.freeze({ kind: "wk", ref });
  }
  if (/^refs\/heads\/slice\/IN-\d{4}\/WK-\d{4}\/SLICE-\d{3}$/u.test(ref)) {
    return Object.freeze({ kind: "slice", ref });
  }
  throw new Error("commit binding output_branch is outside the WK/slice exact-unit namespaces");
}

function resolveExpectedEnvelope(binding) {
  const value = binding.expected_envelope ?? binding.expectedEnvelope ?? binding.expected ?? null;
  return isPlainObject(value) ? value : null;
}

function resolveSparseBinding(binding) {
  const hasSparseAuthority =
    Object.prototype.hasOwnProperty.call(binding, "cone_dirs") ||
    Object.prototype.hasOwnProperty.call(binding, "index_sparse");
  if (!hasSparseAuthority) return null;
  return Object.freeze({
    base_sha: binding.base_sha,
    cone_dirs: binding.cone_dirs,
    index_sparse: binding.index_sparse
  });
}

function resolveCommitWriteScopeMatcher(deriveWritableMountsFromWriteScope, canonicalRepo, writeScope) {
  const mounts = deriveWritableMountsFromWriteScope({ workspaceDir: canonicalRepo, writeScope });
  const repoRoot = path.resolve(canonicalRepo);
  const files = new Set(
    mounts.writableFiles.map((file) => path.relative(repoRoot, file).split(path.sep).join("/"))
  );
  const roots = mounts.writableRoots.map((root) => path.relative(repoRoot, root).split(path.sep).join("/"));
  const globRoots = (Array.isArray(writeScope) ? writeScope : [])
    .filter((entry) => typeof entry === "string" && entry.endsWith("/**"))
    .map((entry) => entry.slice(0, -3).replace(/\/+$/u, ""))
    .filter((entry) => entry.length > 0 && !path.isAbsolute(entry) && !entry.split("/").includes(".."));
  return Object.freeze({
    matches(relPath) {
      if (typeof relPath !== "string" || relPath.length === 0) return false;
      if (path.isAbsolute(relPath) || relPath.split("/").includes("..")) return false;
      if (files.has(relPath)) return true;
      return [...roots, ...globRoots].some((root) => relPath === root || relPath.startsWith(`${root}/`));
    }
  });
}

const PROVISION_WORKTREE_REQUEST_FIELDS = Object.freeze([
  "role", "subject", "initiative", "launch_ref", "run_id", "retry_id"
]);

const PROVISION_WORKTREE_ENVELOPE_FIELDS = Object.freeze([
  "schema_version", "substrate_id", "protocol_version", "op", "provision_request"
]);
const EXACT_IMPLEMENTATION_SLICE_SUBJECT_RE = /^WK-\d{4}#SLICE-\d{3}$/u;
const INITIATIVE_ID_RE = /^IN-\d{4}$/u;

function brokerValidateRequestEnvelope(envelope) {
  if (!isPlainObject(envelope)) {
    return brokerBuildRefusalResponse({
      code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.REQUEST_INVALID,
      reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.REQUEST_MALFORMED,
      detail: { issue: "request_not_object" }
    });
  }
  if (envelope.schema_version !== HOST_WRITE_AUTHORITY_REQUEST_SCHEMA_VERSION) {
    return brokerBuildRefusalResponse({
      code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.REQUEST_INVALID,
      reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.REQUEST_MALFORMED,
      detail: {
        issue: "request_schema_version_mismatch",
        expected: HOST_WRITE_AUTHORITY_REQUEST_SCHEMA_VERSION,
        received: envelope.schema_version ?? null
      }
    });
  }
  if (envelope.substrate_id !== HOST_WRITE_AUTHORITY_SUBSTRATE_ID) {
    return brokerBuildRefusalResponse({
      code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.REQUEST_INVALID,
      reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.REQUEST_MALFORMED,
      detail: {
        issue: "request_substrate_id_mismatch",
        expected: HOST_WRITE_AUTHORITY_SUBSTRATE_ID,
        received: envelope.substrate_id ?? null
      }
    });
  }
  if (envelope.protocol_version !== HOST_WRITE_AUTHORITY_SUBSTRATE_PROTOCOL_VERSION) {
    return brokerBuildRefusalResponse({
      code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.REQUEST_INVALID,
      reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.PROTOCOL_VERSION_UNSUPPORTED,
      detail: {
        expected: HOST_WRITE_AUTHORITY_SUBSTRATE_PROTOCOL_VERSION,
        received: envelope.protocol_version ?? null
      }
    });
  }
  const validOps = Object.values(HOST_WRITE_AUTHORITY_OPS);
  if (!validOps.includes(envelope.op)) {
    return brokerBuildRefusalResponse({
      code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.REQUEST_INVALID,
      reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.OP_UNRECOGNIZED,
      detail: {
        received_op: typeof envelope.op === "string" ? envelope.op : null
      }
    });
  }
  const forbidden = envelope.op === HOST_WRITE_AUTHORITY_OPS.START_LAUNCH
    ? findForbiddenTokenInLaunchInput(envelope.launch_input ?? null)
    : findForbiddenToken(envelope);
  if (forbidden) {
    return brokerBuildRefusalResponse({
      code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.REQUEST_INVALID,
      reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.FORBIDDEN_TOKEN_IN_REQUEST,
      detail: { token: forbidden }
    });
  }
  return { ok: true, envelope };
}

export function createHostWriteAuthorityBroker(options = {}) {
  const {
    planLaunch,

    appPlanLaunchMap = null,
    spawnLaunch,

    captureFinalResult = null,
    runHandleFactory = defaultRunHandleFactory,

    buildFailOpenPlan = buildWorkspaceAgentFailOpenPlan,
    plainSpawn = spawnPlainChildLaunch,

    provisionManagedWorktrees = null,
    provisioningMainRepo = null,
    provisioningWorktreeRoot = null,

    commitManagedWorkerSlice = null,
    commitMainRepo = null,

    resolveWorkerMcpHostWriteEndpoint = null,

    integrateManagedWorkerSlice = null,
    integrationMainRepo = null
  } = options;

  if (typeof planLaunch !== "function") {
    throw new Error(
      "createHostWriteAuthorityBroker: planLaunch is required"
    );
  }
  if (typeof spawnLaunch !== "function") {
    throw new Error(
      "createHostWriteAuthorityBroker: spawnLaunch is required"
    );
  }

  const runs = new Map();

  const integrationTuples = new Map();

  function integrationTupleKey(assignedUnit, launchRef, runId, retryId) {
    return JSON.stringify([assignedUnit, launchRef, runId, retryId]);
  }

  async function handleStartLaunch(envelope) {
    const launchInput = isPlainObject(envelope.launch_input)
      ? envelope.launch_input
      : null;
    if (launchInput === null) {
      return brokerBuildRefusalResponse({
        code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.REQUEST_INVALID,
        reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.LAUNCH_INPUT_INVALID,
        detail: { issue: "launch_input_not_object" }
      });
    }

    const app =
      typeof launchInput.app === "string" && launchInput.app.length > 0
        ? launchInput.app
        : null;
    const launchRole =
      typeof launchInput.role === "string" && launchInput.role.length > 0
        ? launchInput.role
        : null;
    const codexRole =
      typeof launchInput.codex_role === "string" && launchInput.codex_role.length > 0
        ? launchInput.codex_role
        : null;

    const effectiveRole =
      app === "claude" || app === "agy"
        ? launchRole
        : codexRole ?? launchRole;

    let effectivePlanLaunch = planLaunch;
    if (isPlainObject(appPlanLaunchMap)) {
      if (app === null) {

        return brokerBuildRefusalResponse({
          code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.REQUEST_INVALID,
          reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.APP_REQUIRED,
          detail: { issue: "app_required_for_family_aware_broker", supported_apps: Object.keys(appPlanLaunchMap) }
        });
      }
      if (typeof appPlanLaunchMap[app] === "function") {
        effectivePlanLaunch = appPlanLaunchMap[app];
      } else {
        return brokerBuildRefusalResponse({
          code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.PLAN_REFUSED,
          reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.FAMILY_NOT_CONFIGURED,
          detail: { app }
        });
      }
    }

    const managedWorkerLaunch =
      effectiveRole === "worker" &&
      (launchInput.worker_scope_authority != null ||
        launchInput.provisionedWorktreeGitBinding != null ||
        launchInput.provisioned_worktree_git_binding != null);

    const isManagedCodexImplementationWorker =
      app === "codex" && effectiveRole === "worker" && managedWorkerLaunch;
    let launchContext;
    if (isManagedCodexImplementationWorker && typeof resolveWorkerMcpHostWriteEndpoint === "function") {
      const resolved = resolveWorkerMcpHostWriteEndpoint();
      const workerMcpHostWriteEndpoint =
        typeof resolved === "string" && resolved.length > 0 ? resolved : null;
      launchContext = { workerMcpHostWriteEndpoint };
    }

    let planResult;
    try {
      planResult = await effectivePlanLaunch(launchInput, launchContext);
    } catch (err) {
      return brokerBuildRefusalResponse({
        code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.PLAN_THREW,
        reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.PLAN_THREW,
        detail: { message: err?.message ?? String(err) }
      });
    }
    if (!isPlainObject(planResult)) {
      return brokerBuildRefusalResponse({
        code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.PLAN_REFUSED,
        reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.PLAN_REFUSED,
        detail: { issue: "plan_result_not_object" }
      });
    }
    if (planResult.ok !== true) {
      const refusalDetail = isPlainObject(planResult.refusal?.detail)
        ? planResult.refusal.detail
        : null;
      return brokerBuildRefusalResponse({
        code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.PLAN_REFUSED,
        reason: typeof planResult.refusal?.reason === "string"
          ? planResult.refusal.reason
          : HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.PLAN_REFUSED,
        detail: refusalDetail
      });
    }
    const plan = planResult.plan;
    const bwrapPlan = planResult.bwrapPlan;
    const cleanupController = bindAttemptOwnedPreSpawnCleanup({
      bwrapPlan,
      role: effectiveRole,
      subject: launchInput.subject,
      runId: launchInput.run_id
    });
    const compensateBeforeRefusal = (response) => {
      if (cleanupController === null) return response;
      try {
        cleanupController.cleanupOnce();
      } catch (error) {
        return brokerBuildRefusalResponse({
          code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.PLAN_THREW,
          reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.PRESPAWN_CLEANUP_FAILED,
          detail: {
            attempt_id: cleanupController.attempt_id,
            run_id: cleanupController.run_id,
            unit_address: cleanupController.unit_address,
            message: error?.message ?? String(error)
          }
        });
      }
      return response;
    };
    if (cleanupController !== null && cleanupController.valid !== true) {
      return compensateBeforeRefusal(brokerBuildRefusalResponse({
        code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.PLAN_REFUSED,
        reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.PRESPAWN_CLEANUP_DRIFT,
        detail: {
          attempt_id: cleanupController.attempt_id,
          run_id: cleanupController.run_id,
          unit_address: cleanupController.unit_address
        }
      }));
    }
    if (!isPlainObject(plan) || !isPlainObject(bwrapPlan)) {
      return compensateBeforeRefusal(brokerBuildRefusalResponse({
        code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.PLAN_REFUSED,
        reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.PLAN_REFUSED,
        detail: { issue: "plan_result_missing_plan_or_bwrap_plan" }
      }));
    }

    const familyParseFinalResult = typeof planResult.parseFinalResult === "function"
      ? planResult.parseFinalResult
      : (typeof captureFinalResult === "function" ? captureFinalResult : null);
    if (familyParseFinalResult === null) {
      return compensateBeforeRefusal(brokerBuildRefusalResponse({
        code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.PLAN_REFUSED,
        reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.FINAL_RESULT_PARSER_MISSING,
        detail: { issue: "plan_result_missing_parse_final_result" }
      }));
    }

    let child;

    let failOpenProvenance = null;
    try {
      child = spawnLaunch(bwrapPlan, { env: plan.env, stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      const isolationCode = err && typeof err.code === "string"
        ? err.code
        : null;

      const isolationFailure = typeof isolationCode === "string"
        && isolationCode.startsWith("agent_launch.isolation.")
        && (isolationCode.includes("bwrap_unavailable")
          || isolationCode.includes("bwrap_not_executable")
          || isolationCode.includes("bwrap_probe_failed")
          || isolationCode.includes("bwrap_spawn_failed"));

      if (!isolationFailure) {
        return compensateBeforeRefusal(brokerBuildRefusalResponse({
          code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.SPAWN_FAILED,
          reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.SPAWN_FAILED,
          detail: { code: isolationCode, message: err?.message ?? String(err) }
        }));
      }

      let failOpenPlan;
      try {
        failOpenPlan = buildFailOpenPlan({
          launchFacts: {
            command: bwrapPlan.childCommand,
            args: bwrapPlan.childArgs,
            cwd: bwrapPlan.cwd,
            env: bwrapPlan.env
          },
          role: effectiveRole,
          subject: typeof launchInput.subject === "string" ? launchInput.subject : null,
          workspaceDir: typeof launchInput.workspace_dir === "string"
            ? launchInput.workspace_dir
            : null,
          workerScopeAuthority: bwrapPlan.workerScopeAuthority ?? null
        });
      } catch (failOpenError) {
        return compensateBeforeRefusal(brokerBuildRefusalResponse({
          code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.PLAN_THREW,
          reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.PLAN_THREW,
          detail: {
            issue: "fail_open_plan_threw",
            message: failOpenError?.message ?? String(failOpenError)
          }
        }));
      }
      if (
        bwrapPlan.workerScopeAuthority != null &&
        failOpenPlan?.disposition === WORKSPACE_AGENT_FAIL_OPEN_DISPOSITIONS.PLAIN_SPAWN
      ) {
        return compensateBeforeRefusal(brokerBuildRefusalResponse({
          code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.ISOLATION_UNAVAILABLE,
          reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.ISOLATION_UNAVAILABLE,
          detail: { issue: "managed_worker_plain_spawn_forbidden" }
        }));
      }
      if (
        !isPlainObject(failOpenPlan)
        || failOpenPlan.disposition !== WORKSPACE_AGENT_FAIL_OPEN_DISPOSITIONS.PLAIN_SPAWN
        || !isPlainObject(failOpenPlan.plan)
      ) {

        return compensateBeforeRefusal(brokerBuildRefusalResponse({
          code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.ISOLATION_UNAVAILABLE,
          reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.ISOLATION_UNAVAILABLE,
          detail: {
            code: isolationCode,
            message: err?.message ?? null,
            fail_open_disposition: isPlainObject(failOpenPlan)
              ? failOpenPlan.disposition ?? null
              : null,
            fail_open_refusal: isPlainObject(failOpenPlan)
              ? failOpenPlan.refusal ?? null
              : null,
            fail_open_enforcement: isPlainObject(failOpenPlan)
              ? failOpenPlan.enforcement ?? null
              : null
          }
        }));
      }

      const failOpenLaunchPlan = failOpenPlan.plan;
      try {
        child = await plainSpawn(failOpenLaunchPlan.command, failOpenLaunchPlan.args, {
          cwd: failOpenLaunchPlan.cwd,
          env: failOpenLaunchPlan.env,
          stdio: ["ignore", "pipe", "pipe"],
          detached: false
        });
      } catch (plainErr) {
        return compensateBeforeRefusal(brokerBuildRefusalResponse({
          code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.SPAWN_FAILED,
          reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.SPAWN_FAILED,
          detail: {
            issue: "fail_open_plain_spawn_threw",
            message: plainErr?.message ?? String(plainErr)
          }
        }));
      }
      failOpenProvenance = Object.freeze({
        warning: failOpenPlan.warning ?? null,
        enforcement: failOpenPlan.enforcement ?? null,
        isolation: failOpenPlan.isolation ?? null
      });
    }
    if (!isPlainObject(child)) {
      return compensateBeforeRefusal(brokerBuildRefusalResponse({
        code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.SPAWN_FAILED,
        reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.SPAWN_FAILED,
        detail: { issue: "spawn_returned_no_child" }
      }));
    }

    const runHandle = runHandleFactory();

    const { superviseChildLaunch } = await import("../workspace-agent-launch-core.mjs");

    const launchFamily =
      typeof launchInput.app === "string" && launchInput.app.length > 0
        ? launchInput.app
        : null;

    const planKillTimeoutMs =
      typeof planResult.killTimeoutMs === "number" && planResult.killTimeoutMs > 0
        ? planResult.killTimeoutMs
        : null;
    const supervised = superviseChildLaunch({
      child,
      parseFinalResult: ({ status, exit, stdout, stderr, plan: capturePlan }) =>
        familyParseFinalResult({ status, exit, plan: capturePlan, stdout, stderr }),
      role: effectiveRole,
      subject: typeof launchInput.subject === "string" ? launchInput.subject : null,
      family: launchFamily,
      killTimeoutMs: planKillTimeoutMs,
      passthrough: { plan }
    });
    runs.set(runHandle, { runHandle, supervised });

    return brokerBuildAcceptedResponse({
      runHandle,
      status: supervised.status,
      pid: supervised.pid,
      failOpen: failOpenProvenance
    });
  }

  async function handleProbeRun(envelope) {
    const runHandle = typeof envelope.run_handle === "string"
      ? envelope.run_handle
      : null;
    if (!runHandle) {
      return brokerBuildRefusalResponse({
        code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.REQUEST_INVALID,
        reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.REQUEST_MALFORMED,
        detail: { issue: "probe_run_handle_missing" }
      });
    }
    const record = runs.get(runHandle);
    if (!record) {
      return brokerBuildRefusalResponse({
        code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.RUN_HANDLE_UNKNOWN,
        reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.UNKNOWN_RUN_HANDLE,
        detail: { run_handle: runHandle },
        runHandle
      });
    }

    const probed = await record.supervised.probe();
    return brokerBuildProbeResponse({
      status: probed.status,
      exit: probed.exit,
      finalResult: probed.final_result
    });
  }

  async function handleProvisionWorktree(envelope) {
    if (typeof provisionManagedWorktrees !== "function" ||
        typeof provisioningMainRepo !== "string" || provisioningMainRepo.length === 0 ||
        typeof provisioningWorktreeRoot !== "string" || provisioningWorktreeRoot.length === 0) {
      return brokerBuildRefusalResponse({
        code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.REQUEST_INVALID,
        reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.PROVISIONING_UNAVAILABLE,
        detail: { issue: "provisioning_not_composed" }
      });
    }

    const outerKeys = Object.keys(envelope);
    const outerExact = outerKeys.length === PROVISION_WORKTREE_ENVELOPE_FIELDS.length &&
      PROVISION_WORKTREE_ENVELOPE_FIELDS.every(
        (field) => Object.prototype.hasOwnProperty.call(envelope, field)
      );
    if (!outerExact) {
      return brokerBuildRefusalResponse({
        code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.REQUEST_INVALID,
        reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.PROVISIONING_REQUEST_INVALID,
        detail: { issue: "provision_worktree_outer_envelope_not_exact", keys: [...outerKeys].sort() }
      });
    }
    const request = isPlainObject(envelope.provision_request)
      ? envelope.provision_request
      : null;
    if (request === null) {
      return brokerBuildRefusalResponse({
        code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.REQUEST_INVALID,
        reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.PROVISIONING_REQUEST_INVALID,
        detail: { issue: "provision_request_not_object" }
      });
    }
    const requestKeys = Object.keys(request);
    const exactShape = requestKeys.length === PROVISION_WORKTREE_REQUEST_FIELDS.length &&
      PROVISION_WORKTREE_REQUEST_FIELDS.every(
        (field) => Object.prototype.hasOwnProperty.call(request, field)
      );
    if (!exactShape) {
      return brokerBuildRefusalResponse({
        code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.REQUEST_INVALID,
        reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.PROVISIONING_REQUEST_INVALID,
        detail: { issue: "provision_request_shape_invalid" }
      });
    }
    const { role, subject, initiative, launch_ref: launchRef, run_id: runId, retry_id: retryId } = request;
    if (role !== "worker" ||
        typeof subject !== "string" || !EXACT_IMPLEMENTATION_SLICE_SUBJECT_RE.test(subject) ||
        typeof initiative !== "string" || !INITIATIVE_ID_RE.test(initiative) ||
        typeof launchRef !== "string" || launchRef.length === 0 ||
        typeof runId !== "string" || runId.length === 0 ||
        retryId !== 0) {
      return brokerBuildRefusalResponse({
        code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.REQUEST_INVALID,
        reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.PROVISIONING_REQUEST_INVALID,
        detail: { issue: "provision_request_identity_invalid" }
      });
    }
    let provisioning;
    try {
      provisioning = provisionManagedWorktrees({
        mainRepo: provisioningMainRepo,
        initiative,
        subject,
        launchRef,
        runId,
        retryId: 0,
        worktreeRoot: provisioningWorktreeRoot
      });
    } catch (err) {
      return brokerBuildRefusalResponse({
        code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.PLAN_THREW,
        reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.PROVISIONING_THREW,
        detail: { code: err?.code ?? null, message: err?.message ?? String(err) }
      });
    }
    if (!isPlainObject(provisioning)) {
      return brokerBuildRefusalResponse({
        code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.PLAN_REFUSED,
        reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.PROVISIONING_THREW,
        detail: { issue: "provisioner_returned_no_carrier" }
      });
    }
    return brokerBuildProvisionedResponse({ provisioning });
  }

  async function handleCommitSlice(envelope) {
    if (typeof commitManagedWorkerSlice !== "function" ||
        typeof commitMainRepo !== "string" || commitMainRepo.length === 0) {
      return brokerBuildRefusalResponse({
        code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.REQUEST_INVALID,
        reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.COMMIT_UNAVAILABLE,
        detail: { issue: "commit_not_composed" }
      });
    }

    const outerKeys = Object.keys(envelope);
    const outerExact = outerKeys.length === COMMIT_SLICE_ENVELOPE_FIELDS.length &&
      COMMIT_SLICE_ENVELOPE_FIELDS.every(
        (field) => Object.prototype.hasOwnProperty.call(envelope, field)
      );
    if (!outerExact) {
      return brokerBuildRefusalResponse({
        code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.REQUEST_INVALID,
        reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.COMMIT_REQUEST_INVALID,
        detail: { issue: "commit_slice_outer_envelope_not_exact", keys: [...outerKeys].sort() }
      });
    }
    const request = isPlainObject(envelope.commit_request) ? envelope.commit_request : null;
    if (request === null) {
      return brokerBuildRefusalResponse({
        code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.REQUEST_INVALID,
        reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.COMMIT_REQUEST_INVALID,
        detail: { issue: "commit_request_not_object" }
      });
    }
    const requestKeys = Object.keys(request);
    const exactShape = requestKeys.length === COMMIT_SLICE_REQUEST_FIELDS.length &&
      COMMIT_SLICE_REQUEST_FIELDS.every(
        (field) => Object.prototype.hasOwnProperty.call(request, field)
      );
    if (!exactShape) {
      return brokerBuildRefusalResponse({
        code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.REQUEST_INVALID,
        reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.COMMIT_REQUEST_INVALID,
        detail: { issue: "commit_request_shape_invalid" }
      });
    }
    const { assigned_unit: assignedUnit, launch_ref: launchRef, run_id: runId, retry_id: retryId } = request;
    if (typeof assignedUnit !== "string" || !COMMIT_SLICE_ASSIGNED_UNIT_RE.test(assignedUnit) ||
        typeof launchRef !== "string" || launchRef.length === 0 ||
        typeof runId !== "string" || runId.length === 0 ||
        !Number.isInteger(retryId) || retryId < 0) {
      return brokerBuildRefusalResponse({
        code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.REQUEST_INVALID,
        reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.COMMIT_REQUEST_INVALID,
        detail: { issue: "commit_request_identity_invalid" }
      });
    }
    let commitOutcome;
    try {
      commitOutcome = await commitManagedWorkerSlice({
        mainRepo: commitMainRepo,
        assignedUnit,
        launchRef,
        runId,
        retryId
      });
    } catch (err) {

      return brokerBuildRefusalResponse({
        code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.PLAN_THREW,
        reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.COMMIT_THREW,
        detail: {
          message: err?.message ?? String(err),
          code: err?.code ?? null,
          error_detail:
            err?.detail === undefined || err?.detail === null
              ? null
              : boundStructuredRefusalDetail(err.detail)
        }
      });
    }
    if (isPlainObject(commitOutcome) && commitOutcome.scope_refused === true) {
      return brokerBuildRefusalResponse({
        code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.PLAN_REFUSED,
        reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.COMMIT_SCOPE_REFUSED,
        detail: {
          issue: "materialized_commit_not_contained_in_write_scope",
          changed_paths: Array.isArray(commitOutcome.changed_paths) ? commitOutcome.changed_paths : []
        }
      });
    }
    if (!isPlainObject(commitOutcome) || commitOutcome.committed !== true) {
      return brokerBuildRefusalResponse({
        code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.PLAN_REFUSED,
        reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.COMMIT_THREW,
        detail: { issue: "commit_primitive_returned_no_result" }
      });
    }
    return brokerBuildSliceCommittedResponse({ commitResult: commitOutcome });
  }

  async function handleIntegrateSlice(envelope) {
    if (typeof integrateManagedWorkerSlice !== "function" ||
        typeof integrationMainRepo !== "string" || integrationMainRepo.length === 0) {
      return brokerBuildRefusalResponse({
        code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.REQUEST_INVALID,
        reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.INTEGRATION_UNAVAILABLE,
        detail: { issue: "integration_not_composed" }
      });
    }

    const outerKeys = Object.keys(envelope);
    const outerExact = outerKeys.length === INTEGRATE_SLICE_ENVELOPE_FIELDS.length &&
      INTEGRATE_SLICE_ENVELOPE_FIELDS.every(
        (field) => Object.prototype.hasOwnProperty.call(envelope, field)
      );
    if (!outerExact) {
      return brokerBuildRefusalResponse({
        code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.REQUEST_INVALID,
        reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.INTEGRATION_REQUEST_INVALID,
        detail: { issue: "integrate_slice_outer_envelope_not_exact", keys: [...outerKeys].sort() }
      });
    }
    const request = isPlainObject(envelope.integrate_request) ? envelope.integrate_request : null;
    if (request === null) {
      return brokerBuildRefusalResponse({
        code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.REQUEST_INVALID,
        reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.INTEGRATION_REQUEST_INVALID,
        detail: { issue: "integrate_request_not_object" }
      });
    }
    const requestKeys = Object.keys(request);
    const exactShape = requestKeys.length === INTEGRATE_SLICE_REQUEST_FIELDS.length &&
      INTEGRATE_SLICE_REQUEST_FIELDS.every(
        (field) => Object.prototype.hasOwnProperty.call(request, field)
      );
    if (!exactShape) {
      return brokerBuildRefusalResponse({
        code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.REQUEST_INVALID,
        reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.INTEGRATION_REQUEST_INVALID,
        detail: { issue: "integrate_request_shape_invalid" }
      });
    }
    const { assigned_unit: assignedUnit, launch_ref: launchRef, run_id: runId, retry_id: retryId } = request;
    if (typeof assignedUnit !== "string" || !INTEGRATE_SLICE_ASSIGNED_UNIT_RE.test(assignedUnit) ||
        typeof launchRef !== "string" || launchRef.length === 0 ||
        typeof runId !== "string" || runId.length === 0 ||
        !Number.isInteger(retryId) || retryId < 0) {
      return brokerBuildRefusalResponse({
        code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.REQUEST_INVALID,
        reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.INTEGRATION_REQUEST_INVALID,
        detail: { issue: "integrate_request_identity_invalid" }
      });
    }

    if (runId.endsWith(".slice") || runId.endsWith(".wk")) {
      return brokerBuildRefusalResponse({
        code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.REQUEST_INVALID,
        reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.INTEGRATION_REQUEST_INVALID,
        detail: { issue: "integrate_request_run_id_pre_qualified" }
      });
    }
    const key = integrationTupleKey(assignedUnit, launchRef, runId, retryId);

    const tupleState = integrationTuples.get(key);
    if (tupleState) {
      if (tupleState.integration_state === "integrated") {
        return brokerBuildRefusalResponse({
          code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.PLAN_REFUSED,
          reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.INTEGRATION_ALREADY_INTEGRATED,
          detail: { issue: "tuple_already_integrated" }
        });
      }
      if (tupleState.integration_state === "failed_indeterminate") {
        return brokerBuildRefusalResponse({
          code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.PLAN_REFUSED,
          reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.INTEGRATION_LATCHED_INDETERMINATE,
          detail: { issue: "tuple_integration_latched_failed_indeterminate" }
        });
      }

      return brokerBuildRefusalResponse({
        code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.PLAN_REFUSED,
        reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.INTEGRATION_IN_FLIGHT,
        detail: { issue: "tuple_integration_in_flight" }
      });
    }

    integrationTuples.set(key, { integration_state: "in_flight" });
    let integrationResult;
    try {
      integrationResult = await integrateManagedWorkerSlice({
        mainRepo: integrationMainRepo,
        assignedUnit,
        launchRef,
        runId,
        retryId
      });
    } catch (err) {

      const latched =
        err?.code === SLICE_INTEGRATION_REBASE_RESTORE_FAILED_CODE ||
        err?.code === SLICE_INTEGRATION_REVIEW_FREEZE_FAILED_CODE;
      if (latched) {
        integrationTuples.set(key, { integration_state: "failed_indeterminate" });
      } else {
        integrationTuples.delete(key);
      }
      return brokerBuildRefusalResponse({
        code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.PLAN_THREW,
        reason: latched
          ? HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.INTEGRATION_LATCHED_INDETERMINATE
          : HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.INTEGRATION_THREW,
        detail: {
          message: err?.message ?? String(err),
          code: err?.code ?? null,
          latched_failed_indeterminate: latched,
          error_detail:
            err?.detail === undefined || err?.detail === null
              ? null
              : boundStructuredRefusalDetail(err.detail)
        }
      });
    }
    if (!isPlainObject(integrationResult) || integrationResult.integrated !== true) {

      integrationTuples.delete(key);
      return brokerBuildRefusalResponse({
        code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.PLAN_REFUSED,
        reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.INTEGRATION_THREW,
        detail: { issue: "integration_primitive_returned_no_result" }
      });
    }
    integrationTuples.set(key, { integration_state: "integrated" });

    const integration = Object.freeze({
      ...integrationResult,
      tuple: Object.freeze({
        assigned_unit: assignedUnit,
        launch_ref: launchRef,
        run_id: runId,
        retry_id: retryId
      })
    });
    return brokerBuildSliceIntegratedResponse({ integration });
  }

  async function handleRequest(rawEnvelope) {
    const validation = brokerValidateRequestEnvelope(rawEnvelope);
    if (validation.kind === HOST_WRITE_AUTHORITY_RESPONSE_KINDS.REFUSAL) {
      return validation;
    }
    const envelope = validation.envelope;
    let response;
    if (envelope.op === HOST_WRITE_AUTHORITY_OPS.START_LAUNCH) {
      response = await handleStartLaunch(envelope);
    } else if (envelope.op === HOST_WRITE_AUTHORITY_OPS.PROBE_RUN) {
      response = await handleProbeRun(envelope);
    } else if (envelope.op === HOST_WRITE_AUTHORITY_OPS.PROVISION_WORKTREE) {
      response = await handleProvisionWorktree(envelope);
    } else if (envelope.op === HOST_WRITE_AUTHORITY_OPS.COMMIT_SLICE) {
      response = await handleCommitSlice(envelope);
    } else if (envelope.op === HOST_WRITE_AUTHORITY_OPS.INTEGRATE_SLICE) {
      response = await handleIntegrateSlice(envelope);
    } else {
      response = brokerBuildRefusalResponse({
        code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.REQUEST_INVALID,
        reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.OP_UNRECOGNIZED,
        detail: { received_op: envelope.op }
      });
    }

    const forbidden = findForbiddenTokenInResponseEnvelope(response);
    if (forbidden) {
      return brokerBuildRefusalResponse({
        code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.REQUEST_INVALID,
        reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.REQUEST_MALFORMED,
        detail: { issue: "response_contains_forbidden_token", token: forbidden }
      });
    }
    return response;
  }

  return {
    handleRequest,

    snapshotActiveRunHandles: () => [...runs.keys()],
    getRunRecordForTests: (runHandle) => runs.get(runHandle) ?? null
  };
}
