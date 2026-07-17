

import path from "node:path";

import {
  refuseCallerSuppliedIdentityFields
} from "@agent-chassis/wiki-core/src/lib/agent-dispatch-identity.mjs";
import { setWorkRecordStatusByUnit } from "../../../wiki-core/src/index.mjs";
import {
  defaultRunGit,
  resolveWorktreeBinding
} from "../../../agent-launch-cli/src/lib/worktree-substrate.mjs";
import {
  integrateCommittedSlice,
  SLICE_INTEGRATION_DIAGNOSTIC_CODES,
  SLICE_INTEGRATION_SCHEMA_VERSION,
  SliceIntegrationError
} from "../../../agent-launch-cli/src/lib/slice-integration.mjs";
import { releaseRetainedSlice } from "../../../agent-launch-cli/src/lib/worktree-reaper.mjs";
import {
  AGENT_RUN_STATUS_SCHEMA_VERSION,
  AGENT_RUN_WAIT_SCHEMA_VERSION,
  DISPATCH_BLOCKER_CODES
} from "./dispatch-tool-constants.mjs";
import {
  buildBlockedRunStatusResult,
  buildBlockedRunWaitResult,
  buildDispatchToolExceptionDetail,
  compactRunStatusReviewResult,
  mapBackendRefusalToDispatchCode,
  omitNullFields,
  resolveMonitorHandleAlwaysUnknown,
  summarizeRunStatusFinalResult
} from "./dispatch-tool-helpers.mjs";

const WORKER_SLICE_SUBJECT_RE = /^(WK-\d{4})#(SLICE-\d{3})$/u;
const OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const POST_WORKER_LIFECYCLE_CHECKPOINT = Symbol("postWorkerLifecycleCheckpoint");
const POST_WORKER_LIFECYCLE_PHASES = Object.freeze({
  PRE_INTEGRATION: "pre-integration",
  INTEGRATED: "integrated",
  FINALIZED: "finalized"
});

function lifecycleError(code, message, detail = null, cause = null) {
  return new SliceIntegrationError(`workspace-agent post-worker lifecycle: ${message}`, {
    code,
    detail,
    cause
  });
}

function runGitOrThrow(runGit, repo, args, message, code) {
  const result = runGit({ repo, args });
  if (!result || result.ok !== true) {
    throw lifecycleError(code, message, {
      args,
      status: result?.status ?? null,
      stderr: result?.stderr ?? result?.error ?? null
    });
  }
  return result;
}

function resolvedCommit(runGit, repo, value, message, code) {
  const sha = String(runGitOrThrow(
    runGit,
    repo,
    ["rev-parse", "--verify", `${value}^{commit}`],
    message,
    code
  ).stdout ?? "").trim();
  if (!OID_RE.test(sha) || /^0+$/u.test(sha)) {
    throw lifecycleError(code, message, { value, sha: sha || null });
  }
  return sha;
}

function resolveSliceBindingForRun({ workspaceDir, status }, deps) {
  const resolveBinding = deps.resolveWorktreeBinding ?? resolveWorktreeBinding;
  return resolveBinding({
    mainRepo: workspaceDir,
    launchRef: status.monitor_handle,
    runId: `${status.run_id}.slice`,
    retryId: 0
  });
}

function resolveManagedLifecycleBindings({ workspaceDir, status }, deps) {
  if (typeof deps.resolveManagedRunBinding === "function") {
    const provisioning = deps.resolveManagedRunBinding(status);
    if (!provisioning?.slice_binding || !provisioning?.wk_binding ||
        provisioning.validation_worktree_path !== provisioning.wk_binding.worktree_path) {
      throw new Error("post-worker lifecycle requires the complete launcher-owned WK and slice provisioning binding");
    }
    return { provisioning, slice: provisioning.slice_binding, wk: provisioning.wk_binding };
  }
  const slice = resolveSliceBindingForRun({ workspaceDir, status }, deps);
  const resolveBinding = deps.resolveWorktreeBinding ?? resolveWorktreeBinding;
  const wk = resolveBinding({
    mainRepo: workspaceDir,
    launchRef: status.monitor_handle,
    runId: `${status.run_id}.wk`,
    retryId: 0
  });
  return {
    provisioning: {
      record_id: String(slice?.unit_address ?? "").split("/")[1],
      slice_id: String(slice?.unit_address ?? "").split("/")[2],
      slice_binding: slice,
      wk_binding: wk,
      validation_worktree_path: wk?.worktree_path
    },
    slice,
    wk
  };
}

function assertExactCleanWkWorktree({ mainRepo, worktreePath, wkRef, expectedSha, runGit, message }) {
  if (typeof worktreePath !== "string" || !path.isAbsolute(worktreePath)) {
    throw lifecycleError(
      SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH,
      "persistent full WK worktree path is unavailable or non-absolute"
    );
  }
  const branch = runGitOrThrow(
    runGit,
    worktreePath,
    ["symbolic-ref", "-q", "HEAD"],
    message,
    SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH
  );
  const head = resolvedCommit(
    runGit,
    worktreePath,
    "HEAD",
    message,
    SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH
  );
  const ref = resolvedCommit(
    runGit,
    mainRepo,
    wkRef,
    message,
    SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH
  );
  const status = runGitOrThrow(
    runGit,
    worktreePath,
    ["status", "--porcelain=v1", "--untracked-files=all"],
    "could not inspect persistent full WK worktree status",
    SLICE_INTEGRATION_DIAGNOSTIC_CODES.WORKTREE_DIRTY
  );
  const actualBranch = String(branch.stdout ?? "").trim();
  const dirty = String(status.stdout ?? "");
  if (actualBranch !== wkRef || head !== expectedSha || ref !== expectedSha) {
    throw lifecycleError(
      SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH,
      message,
      {
        expected_ref: wkRef,
        actual_ref: actualBranch || null,
        expected_sha: expectedSha,
        head_sha: head,
        ref_sha: ref
      }
    );
  }
  if (dirty.length !== 0) {
    throw lifecycleError(
      SLICE_INTEGRATION_DIAGNOSTIC_CODES.WORKTREE_DIRTY,
      "persistent full WK worktree must be completely clean before fast-forward",
      { wk_ref: wkRef, expected_sha: expectedSha, status: dirty }
    );
  }
}

export function createPersistentWkWorktreeAdvance({
  mainRepo,
  worktreePath,
  wkRef,
  expectedOldSha,
  runGit = defaultRunGit
} = {}) {
  const state = { advancedSha: null };
  const assertOld = () => assertExactCleanWkWorktree({
    mainRepo,
    worktreePath,
    wkRef,
    expectedSha: expectedOldSha,
    runGit,
    message: "persistent full WK worktree/ref binding moved before fast-forward"
  });
  const restoreIntegrated = (integratedSha) => {
    assertExactCleanWkWorktree({
      mainRepo,
      worktreePath,
      wkRef,
      expectedSha: integratedSha,
      runGit,
      message: "persistent full WK worktree/ref moved before compensation"
    });
    runGitOrThrow(
      runGit,
      worktreePath,
      ["reset", "--keep", expectedOldSha],
      "persistent full WK compensation failed",
      SLICE_INTEGRATION_DIAGNOSTIC_CODES.REVIEW_FREEZE_FAILED
    );
    assertOld();
  };
  assertOld();

  return Object.freeze({
    advance(integratedSha) {
      if (!OID_RE.test(integratedSha) || /^0+$/u.test(integratedSha)) {
        throw lifecycleError(SLICE_INTEGRATION_DIAGNOSTIC_CODES.INVALID_ARG, "integrated WK SHA is invalid");
      }
      assertOld();
      const merge = runGit({
        repo: worktreePath,
        args: ["merge", "--ff-only", "--no-edit", integratedSha]
      });
      if (!merge || merge.ok !== true) {

        assertOld();
        throw lifecycleError(
          SLICE_INTEGRATION_DIAGNOSTIC_CODES.WK_ADVANCE_CONFLICT,
          "persistent full WK worktree fast-forward failed",
          {
            status: merge?.status ?? null,
            stderr: merge?.stderr ?? merge?.error ?? null
          }
        );
      }
      try {
        assertExactCleanWkWorktree({
          mainRepo,
          worktreePath,
          wkRef,
          expectedSha: integratedSha,
          runGit,
          message: "persistent full WK worktree/ref did not reach the integrated SHA"
        });
      } catch (error) {
        try {
          restoreIntegrated(integratedSha);
        } catch (rollback) {
          throw lifecycleError(
            SLICE_INTEGRATION_DIAGNOSTIC_CODES.WK_ADVANCE_CONFLICT,
            "persistent full WK fast-forward verification and compensation failed",
            { rollback: rollback?.message ?? String(rollback) },
            error
          );
        }
        throw error;
      }
      state.advancedSha = integratedSha;
    },
    compensate(integratedSha) {
      if (state.advancedSha !== integratedSha) {
        throw lifecycleError(
          SLICE_INTEGRATION_DIAGNOSTIC_CODES.REVIEW_FREEZE_FAILED,
          "persistent full WK compensation does not match the completed fast-forward",
          { expected_integrated_sha: state.advancedSha, actual_integrated_sha: integratedSha }
        );
      }
      restoreIntegrated(integratedSha);
      state.advancedSha = null;
    }
  });
}

function createLifecycleCheckpoint() {
  return {
    phase: POST_WORKER_LIFECYCLE_PHASES.PRE_INTEGRATION,
    integration: null,
    finalized: null,
    in_flight: null
  };
}

function checkpointFromStatus(status) {
  const checkpoint = status?.[POST_WORKER_LIFECYCLE_CHECKPOINT];
  return checkpoint ?? createLifecycleCheckpoint();
}

function recoverIntegratedSliceResult({
  mainRepo,
  bindings,
  binding,
  reviewUnit,
  sliceRef,
  wkRef,
  runGit
}) {
  if (reviewUnit.parent_status !== "review") return null;
  const baseSha = binding.base_sha;
  if (!OID_RE.test(baseSha) || bindings.wk?.base_sha !== baseSha) {
    throw lifecycleError(
      SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH,
      "launcher WK and slice bindings do not share the exact frozen base during recovery"
    );
  }
  const sliceSha = resolvedCommit(
    runGit,
    mainRepo,
    sliceRef,
    "committed slice ref is unavailable during integrated-state recovery",
    SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH
  );
  const wkSha = resolvedCommit(
    runGit,
    mainRepo,
    wkRef,
    "WK ref is unavailable during integrated-state recovery",
    SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH
  );
  if (sliceSha !== wkSha || wkSha === baseSha) {
    throw lifecycleError(
      SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH,
      "canonical review state is not backed by matching integrated slice and WK refs",
      { slice_sha: sliceSha, wk_sha: wkSha, base_sha: baseSha }
    );
  }
  const parents = String(runGitOrThrow(
    runGit,
    mainRepo,
    ["rev-list", "--parents", "-n", "1", wkSha],
    "could not reconstruct the integrated WK parent",
    SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH
  ).stdout ?? "").trim().split(/\s+/u);
  if (parents.length !== 2 || parents[0] !== wkSha || !OID_RE.test(parents[1])) {
    throw lifecycleError(
      SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH,
      "integrated WK tip is not the deterministic single-commit slice result"
    );
  }
  const previousWkSha = parents[1];
  runGitOrThrow(
    runGit,
    mainRepo,
    ["merge-base", "--is-ancestor", baseSha, previousWkSha],
    "integrated WK parent is outside the launcher-bound base lineage",
    SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH
  );

  const mainSha = resolvedCommit(
    runGit,
    mainRepo,
    "refs/heads/main",
    "main ref is unavailable during integrated-state recovery",
    SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH
  );
  const diffBaseSha = String(runGitOrThrow(
    runGit,
    mainRepo,
    ["merge-base", mainSha, wkSha],
    "could not reconstruct the complete-WK review diff base",
    SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH
  ).stdout ?? "").trim();
  if (!OID_RE.test(diffBaseSha)) {
    throw lifecycleError(SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH, "reconstructed review diff base is invalid");
  }
  const reviewTarget = Object.freeze({
    schema_version: SLICE_INTEGRATION_SCHEMA_VERSION,
    unit_address: String(binding.unit_address).split("/").slice(0, 2).join("/"),
    ref: wkRef,
    sha: wkSha,
    diff_base_sha: diffBaseSha,
    diff_head_sha: wkSha,
    diff_range: `${diffBaseSha}..${wkSha}`,
    complete_parent_wk_contract: true,
    accumulated_wk_diff: true
  });
  return Object.freeze({
    schema_version: SLICE_INTEGRATION_SCHEMA_VERSION,
    integrated: true,
    recovered: true,
    rebased: previousWkSha !== baseSha,
    previous_wk_sha: previousWkSha,
    slice_ref: sliceRef,
    slice_sha: sliceSha,
    wk_ref: wkRef,
    wk_sha: wkSha,
    review_target: reviewTarget,
    transition: Object.freeze({ valid: true, written: false, no_op: true, status: "review", recovered: true })
  });
}

async function delegateSliceIntegrationToHost({ status, adapter }) {
  const delegated = await adapter({
    assigned_unit: status.subject,
    launch_ref: status.monitor_handle,
    run_id: status.run_id,
    retry_id: 0
  });
  if (!delegated || delegated.accepted !== true || !delegated.integration) {
    throw lifecycleError(
      SLICE_INTEGRATION_DIAGNOSTIC_CODES.GIT_FAILED,
      "host-delegated slice-to-WK integration failed",
      { broker_refusal: delegated?.refusal ?? null }
    );
  }
  return delegated.integration;
}

const wkIntegrationChains = new Map();

function serializePerWkIntegration(key, task) {
  const prior = wkIntegrationChains.get(key) ?? Promise.resolve();

  const gated = prior.then(() => task(), () => task());
  const tail = gated.then(() => undefined, () => undefined);
  wkIntegrationChains.set(key, tail);
  tail.then(() => {
    if (wkIntegrationChains.get(key) === tail) wkIntegrationChains.delete(key);
  });
  return gated;
}

export async function runPostWorkerSliceLifecycle({ workspace, status, deps = {} } = {}) {
  const subject = typeof status?.subject === "string" ? status.subject.match(WORKER_SLICE_SUBJECT_RE) : null;
  if (status?.role !== "worker" || status?.terminal !== true || status?.status !== "succeeded" || !subject) {
    return null;
  }

  return serializePerWkIntegration(
    `${workspace?.dir ?? ""}::${subject[1]}`,
    () => runPostWorkerSliceLifecycleBody({ workspace, status, deps })
  );
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
  let reviewUnit = deps.resolveCanonicalReviewUnit({ mainRepo: workspace.dir, wkId });
  if (reviewUnit?.record_id !== wkId ||
      (reviewUnit?.initiative !== undefined && reviewUnit.initiative !== initiative)) {
    throw new Error("canonical review unit does not match the exact launcher WK identity");
  }
  const runGit = deps.runGit ?? defaultRunGit;
  const checkpoint = checkpointFromStatus(status);
  if (!Object.values(POST_WORKER_LIFECYCLE_PHASES).includes(checkpoint.phase)) {
    throw new Error("post-worker lifecycle checkpoint carries an invalid phase");
  }

  if (checkpoint.phase === POST_WORKER_LIFECYCLE_PHASES.PRE_INTEGRATION) {
    const recovered = recoverIntegratedSliceResult({
      mainRepo: workspace.dir,
      bindings,
      binding,
      reviewUnit,
      sliceRef,
      wkRef,
      runGit
    });
    if (recovered) {
      checkpoint.integration = recovered;
      checkpoint.phase = POST_WORKER_LIFECYCLE_PHASES.INTEGRATED;
    } else if (deps.recoveryOnly === true) {
      return null;
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

      let integration;
      if (typeof deps.hostSliceIntegrationAdapter === "function") {
        integration = await delegateSliceIntegrationToHost({
          status,
          adapter: deps.hostSliceIntegrationAdapter
        });
      } else {
        const productionWkAdvance = deps.createWkAdvance ?? ((input) =>
          createPersistentWkWorktreeAdvance({
            ...input,
            worktreePath: bindings.provisioning.validation_worktree_path
          }));
        integration = await (deps.integrateCommittedSlice ?? integrateCommittedSlice)({
          mainRepo: workspace.dir,
          worktreePath: binding.worktree_path,
          unitAddress: binding.unit_address,
          sliceRef,
          wkRef,
          baseSha: binding.base_sha,
          commit,
          workerTerminated: true,
          transitionToReview: async ({ unitAddress, status: nextStatus }) =>
            (deps.setWorkRecordStatusByUnit ?? setWorkRecordStatusByUnit)({
              dir: workspace.dir,
              unitAddress,
              status: nextStatus
            }),
          deps: {
            ...(deps.integrationDeps ?? {}),
            createWkAdvance: productionWkAdvance
          }
        });
      }
      checkpoint.integration = integration;
      checkpoint.phase = POST_WORKER_LIFECYCLE_PHASES.INTEGRATED;
    }
  }

  if (checkpoint.phase === POST_WORKER_LIFECYCLE_PHASES.FINALIZED) {
    return checkpoint.finalized;
  }

  const integration = checkpoint.integration;

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

  reviewUnit = deps.resolveCanonicalReviewUnit({ mainRepo: workspace.dir, wkId });
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
    reviewer_dispatch: Object.freeze({
      tool: "workspace_agent_dispatch",
      args: Object.freeze({ role: "reviewer", subject: reviewUnit.subject }),
      context: Object.freeze({
        frozen_review_target: integration.review_target,
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

export function runRetainedSliceCleanupDisposition({ workspace, run, disposition, reviewStatus = null, deps = {} } = {}) {
  const acceptedReview = disposition === "accepted-review" &&
    reviewStatus?.accepted === true &&
    reviewStatus?.terminal === true &&
    reviewStatus?.role === "reviewer" &&
    reviewStatus?.review_result?.clean_review === true;
  const explicitResolution = disposition === "orchestrator-cancelled" || disposition === "orchestrator-revert";
  return (deps.releaseRetainedSlice ?? releaseRetainedSlice)({
    mainRepo: workspace.dir,
    launchRef: run.monitor_handle,
    runId: `${run.run_id}.slice`,
    retryId: 0,
    disposition,
    workerTerminated: run.terminal === true,
    reviewResolved: acceptedReview || explicitResolution,
    deps: deps.cleanupDeps
  });
}

export function registerRunMonitorRoutes(ctx) {
  const {
    registerTool,
    workspaceRepos,
    z,
    jsonContent,
    resolveWorkspaceRepo,
    dispatchBackend,
    dispatchSessionIdentity
  } = ctx;

  const postWorkerLifecycleByRun = new Map();

  async function attemptUnknownHandleRecovery(workspace, args, refusal) {
    if (mapBackendRefusalToDispatchCode(refusal?.code) !== DISPATCH_BLOCKER_CODES.MONITOR_HANDLE_UNKNOWN ||
        typeof dispatchBackend?.recoverIntegratedWorkerRun !== "function" ||
        typeof args?.subject !== "string" || !WORKER_SLICE_SUBJECT_RE.test(args.subject)) {
      return null;
    }
    return dispatchBackend.recoverIntegratedWorkerRun({
      workspace,
      monitor_handle: args.monitor_handle,
      subject: args.subject
    });
  }

  async function completeTerminalWorkerLifecycle(workspace, status) {
    if (status?.role !== "worker" || status?.terminal !== true || !WORKER_SLICE_SUBJECT_RE.test(status?.subject ?? "")) {
      return null;
    }
    if (!postWorkerLifecycleByRun.has(status.run_id)) {
      postWorkerLifecycleByRun.set(status.run_id, createLifecycleCheckpoint());
    }
    const checkpoint = postWorkerLifecycleByRun.get(status.run_id);
    if (checkpoint.phase === POST_WORKER_LIFECYCLE_PHASES.FINALIZED) {
      return checkpoint.finalized;
    }
    if (checkpoint.in_flight === null) {
      const invoke = dispatchBackend?.runPostWorkerSliceLifecycle ?? runPostWorkerSliceLifecycle;
      const statusWithCheckpoint = { ...status };
      Object.defineProperty(statusWithCheckpoint, POST_WORKER_LIFECYCLE_CHECKPOINT, {
        value: checkpoint,
        enumerable: false
      });
      const invocation = Promise.resolve()
        .then(() => invoke({ workspace, status: statusWithCheckpoint }))
        .then((result) => {

          if (checkpoint.phase === POST_WORKER_LIFECYCLE_PHASES.PRE_INTEGRATION) {
            checkpoint.integration = result?.integration ?? null;
            checkpoint.finalized = result;
            checkpoint.phase = POST_WORKER_LIFECYCLE_PHASES.FINALIZED;
          }
          return result;
        });
      checkpoint.in_flight = invocation;
    }
    const invocation = checkpoint.in_flight;
    try {
      return await invocation;
    } catch (error) {
      const detail = buildDispatchToolExceptionDetail("post_worker_slice_lifecycle", error);
      const failure = {
        invoked: true,
        phase: checkpoint.phase,
        integrated: checkpoint.phase !== POST_WORKER_LIFECYCLE_PHASES.PRE_INTEGRATION,
        error_code: error?.code ?? "agent_launch.slice_lifecycle.failed.v1",
        error_message: detail.error_message,
        error_message_truncated: detail.error_message_truncated
      };
      if (checkpoint.integration) failure.integration = checkpoint.integration;
      return Object.freeze(failure);
    } finally {
      if (checkpoint.in_flight === invocation) checkpoint.in_flight = null;
    }
  }

  registerTool(
    "workspace_agent_run_status",
    {
      description:
        "Query the status of a workspace_agent_dispatch run by monitor_handle. Stdio MCP is not an authentication boundary; caller-supplied identity carriers are refused. Unknown, subject-mismatch, and caller-session-mismatch handles refuse with the monitor_handle_* taxonomy. The accepted response is compact by default: null fields are omitted and a terminal run returns a bounded final_result_summary instead of the captured agent text. Pass verbose:true or include_final_result:true for the full final_result envelope. Free/local dispatched reviewer/redteam/worker output is prose-only under DEC-0128, so a terminal success carrying structured_role_result.valid:false is EXPECTED and is not a failed child run, a failed dispatch, or missing findings; a schema-valid structured role result is a paid/CCE capability enabled only by a canonical paid key.",
      inputSchema: {
        repo: z.string().optional(),
        monitor_handle: z.string(),
        subject: z.string().optional(),
        verbose: z.boolean().optional(),
        include_final_result: z.boolean().optional(),
        env: z.record(z.unknown()).optional(),
        request: z.record(z.unknown()).optional(),
        prompt: z.record(z.unknown()).optional(),
        argv: z.record(z.unknown()).optional(),
        claimed_identity: z
          .object({
            role: z.string().optional()
          })
          .optional()
      }
    },
    async (args) => {
      try {
        const identityRefusal = refuseCallerSuppliedIdentityFields(args);
        if (identityRefusal) {
          return jsonContent(
            buildBlockedRunStatusResult({
              blockerCode: DISPATCH_BLOCKER_CODES.CALLER_SUPPLIED_IDENTITY,
              reason: "caller_supplied_identity_carrier",
              detail: identityRefusal
            })
          );
        }

        const workspace = resolveWorkspaceRepo(workspaceRepos, args?.repo);

        if (!dispatchBackend) {
          const lookup = resolveMonitorHandleAlwaysUnknown(args.monitor_handle);
          return jsonContent(
            buildBlockedRunStatusResult({
              blockerCode: lookup.blocker_code,
              reason: lookup.reason,
              detail: null
            })
          );
        }

        let status = await dispatchBackend.getRunStatus({
          caller_session_id: dispatchSessionIdentity,
          monitor_handle: args.monitor_handle,
          subject: args.subject ?? null
        });
        let recoveredLifecycle = null;
        if (!status || status.accepted !== true) {
          const refusal = status?.refusal ?? {};
          const recovered = await attemptUnknownHandleRecovery(workspace, args, refusal);
          if (recovered?.status?.accepted === true && recovered.lifecycle) {
            status = recovered.status;
            recoveredLifecycle = recovered.lifecycle;
          } else {
            return jsonContent(
              buildBlockedRunStatusResult({
                blockerCode: mapBackendRefusalToDispatchCode(refusal.code),
                reason: refusal.reason ?? "run_status_backend_refused",
                detail: refusal.detail ?? null
              })
            );
          }
        }
        const lifecycle = recoveredLifecycle ?? await completeTerminalWorkerLifecycle(workspace, status);

        const includeFullFinalResult =
          args?.verbose === true || args?.include_final_result === true;
        const finalResult = status.final_result ?? null;
        const reviewResult = compactRunStatusReviewResult(status.review_result);
        const accepted = {
          schema_version: AGENT_RUN_STATUS_SCHEMA_VERSION,
          accepted: true,
          verbose: args?.verbose === true,
          run_id: status.run_id,
          monitor_handle: status.monitor_handle,
          app: status.app ?? null,
          role: status.role,
          subject: status.subject,
          status: status.status,
          terminal: status.terminal,
          started_at: status.started_at,
          updated_at: status.updated_at,
          exit: status.exit ?? null,
          review_result: reviewResult
        };
        if (lifecycle) accepted.slice_lifecycle = lifecycle;
        if (finalResult) {
          if (includeFullFinalResult) {
            accepted.final_result = finalResult;
          } else {
            accepted.final_result_summary = summarizeRunStatusFinalResult(finalResult);
          }
        }
        return jsonContent(omitNullFields(accepted));
      } catch (error) {
        return jsonContent(
          buildBlockedRunStatusResult({
            blockerCode: DISPATCH_BLOCKER_CODES.OPERATOR_RECOVERY_NEEDED,
            reason: "run_status_tool_exception",
            detail: buildDispatchToolExceptionDetail("workspace_agent_run_status", error)
          })
        );
      }
    }
  );

  registerTool(
    "workspace_agent_run_wait",
    {
      description:
        "Wait for a workspace_agent_dispatch run to reach a terminal state or until a bounded wait window expires. Normally OMIT timeout_ms: the 60000 ms default is a client-safe window sized to return within the outer MCP tool-call timeout. Returns terminal with timed_out:false, or non-terminal with timed_out:true and next_action:\"retry_wait_or_check_status\" when the window expires. timed_out:true is a CLEAN wait-window timeout, NOT a failed child — the child is still running; call run_wait or run_status again with the SAME monitor_handle and do NOT relaunch. Stdio MCP is not an authentication boundary; caller-supplied identity carriers are refused, with the same monitor-handle/subject/caller-session refusal taxonomy as workspace_agent_run_status. Bounds (out-of-range refused): timeout_ms integer [1,300000] default 60000; poll_interval_ms integer [500,60000] default 5000. Terminal response is compact by default; pass verbose:true or include_final_result:true for the full final_result envelope. Free/local dispatched reviewer/redteam/worker output is prose-only under DEC-0128, so a terminal success carrying structured_role_result.valid:false is EXPECTED and is not a failed run, a failed dispatch, or missing findings; a schema-valid structured role result is a paid/CCE capability enabled only by a canonical paid key.",
      inputSchema: {
        repo: z.string().optional(),
        monitor_handle: z.string(),
        subject: z.string().optional(),
        timeout_ms: z.number().optional(),
        poll_interval_ms: z.number().optional(),
        verbose: z.boolean().optional(),
        include_final_result: z.boolean().optional(),
        env: z.record(z.unknown()).optional(),
        request: z.record(z.unknown()).optional(),
        prompt: z.record(z.unknown()).optional(),
        argv: z.record(z.unknown()).optional(),
        claimed_identity: z
          .object({
            role: z.string().optional()
          })
          .optional()
      }
    },
    async (args) => {
      try {
        const identityRefusal = refuseCallerSuppliedIdentityFields(args);
        if (identityRefusal) {
          return jsonContent(
            buildBlockedRunWaitResult({
              blockerCode: DISPATCH_BLOCKER_CODES.CALLER_SUPPLIED_IDENTITY,
              reason: "caller_supplied_identity_carrier",
              detail: identityRefusal
            })
          );
        }

        const workspace = resolveWorkspaceRepo(workspaceRepos, args?.repo);

        const timeoutMs = args?.timeout_ms ?? 60000;
        const pollIntervalMs = args?.poll_interval_ms ?? 5000;

        if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000) {
          return jsonContent(
            buildBlockedRunWaitResult({
              blockerCode: DISPATCH_BLOCKER_CODES.VALIDATION_FAILURE,
              reason: "timeout_ms_out_of_range",
              detail: {
                timeout_ms: timeoutMs,
                valid_range: [1, 300000],
                message: "timeout_ms must be an integer in [1, 300000]"
              }
            })
          );
        }
        if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 500 || pollIntervalMs > 60000) {
          return jsonContent(
            buildBlockedRunWaitResult({
              blockerCode: DISPATCH_BLOCKER_CODES.VALIDATION_FAILURE,
              reason: "poll_interval_ms_out_of_range",
              detail: {
                poll_interval_ms: pollIntervalMs,
                valid_range: [500, 60000],
                message: "poll_interval_ms must be an integer in [500, 60000]"
              }
            })
          );
        }

        if (!dispatchBackend) {
          const lookup = resolveMonitorHandleAlwaysUnknown(args.monitor_handle);
          return jsonContent(
            buildBlockedRunWaitResult({
              blockerCode: lookup.blocker_code,
              reason: lookup.reason,
              detail: null
            })
          );
        }

        let waitResult = await dispatchBackend.waitForRunStatus({
          caller_session_id: dispatchSessionIdentity,
          monitor_handle: args.monitor_handle,
          subject: args.subject ?? null,
          timeout_ms: timeoutMs,
          poll_interval_ms: pollIntervalMs
        });

        let recoveredLifecycle = null;
        if (!waitResult || waitResult.accepted !== true) {
          const refusal = waitResult?.refusal ?? {};
          const recovered = await attemptUnknownHandleRecovery(workspace, args, refusal);
          if (recovered?.status?.accepted === true && recovered.lifecycle) {
            waitResult = recovered.status;
            recoveredLifecycle = recovered.lifecycle;
          } else {
            return jsonContent(
              buildBlockedRunWaitResult({
                blockerCode: mapBackendRefusalToDispatchCode(refusal.code),
                reason: refusal.reason ?? "run_wait_backend_refused",
                detail: refusal.detail ?? null
              })
            );
          }
        }

        if (waitResult.timed_out) {
          const timeout = {
            schema_version: AGENT_RUN_WAIT_SCHEMA_VERSION,
            accepted: true,
            timed_out: true,
            verbose: args?.verbose === true,
            run_id: waitResult.run_id,
            monitor_handle: waitResult.monitor_handle,
            app: waitResult.app ?? null,
            role: waitResult.role,
            subject: waitResult.subject,
            status: waitResult.status,
            terminal: false,
            started_at: waitResult.started_at,
            updated_at: waitResult.updated_at,
            next_action: "retry_wait_or_check_status"
          };
          return jsonContent(omitNullFields(timeout));
        }

        const lifecycle = recoveredLifecycle ?? await completeTerminalWorkerLifecycle(workspace, waitResult);

        const includeFullFinalResult =
          args?.verbose === true || args?.include_final_result === true;
        const finalResult = waitResult.final_result ?? null;
        const reviewResult = compactRunStatusReviewResult(waitResult.review_result);
        const accepted = {
          schema_version: AGENT_RUN_WAIT_SCHEMA_VERSION,
          accepted: true,
          timed_out: false,
          verbose: args?.verbose === true,
          run_id: waitResult.run_id,
          monitor_handle: waitResult.monitor_handle,
          app: waitResult.app ?? null,
          role: waitResult.role,
          subject: waitResult.subject,
          status: waitResult.status,
          terminal: true,
          started_at: waitResult.started_at,
          updated_at: waitResult.updated_at,
          exit: waitResult.exit ?? null,
          review_result: reviewResult
        };
        if (lifecycle) accepted.slice_lifecycle = lifecycle;
        if (finalResult) {
          if (includeFullFinalResult) {
            accepted.final_result = finalResult;
          } else {
            accepted.final_result_summary = summarizeRunStatusFinalResult(finalResult);
          }
        }
        return jsonContent(omitNullFields(accepted));
      } catch (error) {
        return jsonContent(
          buildBlockedRunWaitResult({
            blockerCode: DISPATCH_BLOCKER_CODES.OPERATOR_RECOVERY_NEEDED,
            reason: "run_wait_tool_exception",
            detail: buildDispatchToolExceptionDetail("workspace_agent_run_wait", error)
          })
        );
      }
    }
  );
}
