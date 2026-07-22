

import {
  HOST_WRITE_AUTHORITY_OPS,
  HOST_WRITE_AUTHORITY_RESPONSE_KINDS,
  HOST_WRITE_AUTHORITY_RESPONSE_SCHEMA_VERSION,
  HOST_WRITE_AUTHORITY_SUBSTRATE_ID,
  HOST_WRITE_AUTHORITY_SUBSTRATE_PROTOCOL_VERSION,
  isPlainObject
} from "./protocol-constants.mjs";
import { findForbiddenTokenInResponseEnvelope } from "./forbidden-token-scan.mjs";

import {
  buildWorkspaceAgentFailOpenPlan,
  WORKSPACE_AGENT_FAIL_OPEN_DISPOSITIONS
} from "../launch-isolation-failopen.mjs";
import {
  HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS,
  HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES,
  bindAttemptOwnedPreSpawnCleanup,
  buildBrokerWorkerAdmissionEnv,
  defaultRunHandleFactory,
  spawnPlainChildLaunch,
  boundStructuredRefusalDetail,
  brokerBuildRefusalResponse,
  brokerBuildAcceptedResponse,
  brokerBuildProbeResponse,
  brokerBuildProvisionedResponse,
  brokerBuildSliceCommittedResponse,
  brokerBuildSliceIntegratedResponse,
  brokerBuildWkForgeHandoffResponse
} from "./broker-refusals.mjs";
import {
  HOST_WRITE_AUTHORITY_WK_FORGE_HANDOFF_REQUEST_FIELDS
} from "./request-envelopes-wk-forge-handoff.mjs";

import {
  WK_FORGE_HANDOFF_BROKER_CATEGORIES
} from "./request-envelopes-wk-forge-handoff.mjs";
import {
  brokerValidateRequestEnvelope,
  PROVISION_WORKTREE_ENVELOPE_FIELDS,
  PROVISION_WORKTREE_REQUEST_FIELDS,
  EXACT_IMPLEMENTATION_SLICE_SUBJECT_RE,
  INITIATIVE_ID_RE
} from "./broker-request-envelope.mjs";
import {
  COMMIT_SLICE_ENVELOPE_FIELDS,
  COMMIT_SLICE_REQUEST_FIELDS,
  COMMIT_SLICE_ASSIGNED_UNIT_RE,
  defaultCommitManagedWorkerSlice
} from "./broker-slice-commit.mjs";
import {
  INTEGRATE_SLICE_ENVELOPE_FIELDS,
  INTEGRATE_SLICE_REQUEST_FIELDS,
  INTEGRATE_SLICE_ASSIGNED_UNIT_RE,
  SLICE_INTEGRATION_REBASE_RESTORE_FAILED_CODE,
  SLICE_INTEGRATION_REVIEW_FREEZE_FAILED_CODE,
  defaultIntegrateManagedWorkerSlice
} from "./broker-slice-integration.mjs";
import { verifyExactSliceCommitBinding } from "./broker-commit-binding.mjs";
import {
  HOST_WRITE_AUTHORITY_PREPARE_SLICE_REVIEW_SURFACE_REQUEST_FIELDS,
  buildHostWriteAuthorityPrepareSliceReviewSurfaceRequest,
  validateSliceReviewSurfacePreparationResult
} from "./request-envelopes.mjs";
import {
  prepareSliceReviewSurface as defaultPrepareSliceReviewSurface
} from "./slice-review-materialization.mjs";

const PREPARE_SLICE_REVIEW_SURFACE_ENVELOPE_FIELDS = Object.freeze([
  "schema_version", "substrate_id", "protocol_version", "op", "prepare_request"
]);

const WK_FORGE_HANDOFF_ENVELOPE_FIELDS = Object.freeze([
  "schema_version", "substrate_id", "protocol_version", "op", "forge_request"
]);
const WK_FORGE_HANDOFF_ASSIGNED_UNIT_RE = /^WK-\d{4}$/u;

const WK_FORGE_HANDOFF_CATEGORY_TO_REASON = Object.freeze({
  [WK_FORGE_HANDOFF_BROKER_CATEGORIES.REQUEST_INVALID]:
    HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.FORGE_HANDOFF_REQUEST_INVALID,
  [WK_FORGE_HANDOFF_BROKER_CATEGORIES.REMOTE_INVALID]:
    HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.FORGE_HANDOFF_REMOTE_INVALID,
  [WK_FORGE_HANDOFF_BROKER_CATEGORIES.ELIGIBILITY]:
    HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.FORGE_HANDOFF_ELIGIBILITY_REFUSED,
  [WK_FORGE_HANDOFF_BROKER_CATEGORIES.PUBLICATION_DISAGREEMENT]:
    HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.FORGE_HANDOFF_PUBLICATION_DISAGREEMENT,
  [WK_FORGE_HANDOFF_BROKER_CATEGORIES.INDETERMINATE]:
    HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.FORGE_HANDOFF_INDETERMINATE,
  [WK_FORGE_HANDOFF_BROKER_CATEGORIES.GIT_FAILED]:
    HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.FORGE_HANDOFF_THREW
});

function brokerBuildSliceReviewSurfacePreparedResponse(preparation) {
  return Object.freeze({
    schema_version: HOST_WRITE_AUTHORITY_RESPONSE_SCHEMA_VERSION,
    substrate_id: HOST_WRITE_AUTHORITY_SUBSTRATE_ID,
    protocol_version: HOST_WRITE_AUTHORITY_SUBSTRATE_PROTOCOL_VERSION,
    kind: HOST_WRITE_AUTHORITY_RESPONSE_KINDS.SLICE_REVIEW_SURFACE_PREPARED,
    preparation
  });
}

export {
  HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS,
  HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES,
  bindAttemptOwnedPreSpawnCleanup,
  buildBrokerWorkerAdmissionEnv,
  brokerBuildRefusalResponse,
  verifyExactSliceCommitBinding,
  defaultCommitManagedWorkerSlice,
  defaultIntegrateManagedWorkerSlice
};

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
    integrationMainRepo = null,
    prepareManagedSliceReviewSurface = defaultPrepareSliceReviewSurface,
    sliceReviewPreparationMainRepo = integrationMainRepo,

    integrationReviewEnforcementMode = "enforced_cce",

    wkForgeHandoff = null,
    forgeHandoffMainRepo = null,

    forgeHandoffDeps = {}
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
        !Number.isInteger(retryId) || retryId < 0) {
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
        retryId,
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
    if (provisioning.retry_id !== retryId ||
        provisioning.wk_binding?.retry_id !== retryId ||
        provisioning.slice_binding?.retry_id !== retryId) {
      return brokerBuildRefusalResponse({
        code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.PLAN_REFUSED,
        reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.PROVISIONING_THREW,
        detail: {
          issue: "provisioner_retry_identity_mismatch",
          expected_retry_id: retryId,
          carrier_retry_id: provisioning.retry_id ?? null
        }
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

        integrationTuples.set(key, { integration_state: "in_flight" });
      } else if (tupleState.integration_state === "failed_indeterminate") {
        return brokerBuildRefusalResponse({
          code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.PLAN_REFUSED,
          reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.INTEGRATION_LATCHED_INDETERMINATE,
          detail: { issue: "tuple_integration_latched_failed_indeterminate" }
        });
      } else if (tupleState.integration_state !== "cleanup_pending") {

        return brokerBuildRefusalResponse({
          code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.PLAN_REFUSED,
          reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.INTEGRATION_IN_FLIGHT,
          detail: { issue: "tuple_integration_in_flight" }
        });
      }

      integrationTuples.set(key, { integration_state: "in_flight" });
    } else {

      integrationTuples.set(key, { integration_state: "in_flight" });
    }
    let integrationResult;
    try {
      integrationResult = await integrateManagedWorkerSlice({
        mainRepo: integrationMainRepo,
        assignedUnit,
        launchRef,
        runId,
        retryId,
        reviewEnforcementMode: integrationReviewEnforcementMode
      });
    } catch (err) {

      const latched =
        err?.code === SLICE_INTEGRATION_REBASE_RESTORE_FAILED_CODE ||
        err?.code === SLICE_INTEGRATION_REVIEW_FREEZE_FAILED_CODE;
      const cleanupPending = latched &&
        isPlainObject(err?.detail) &&
        Object.prototype.hasOwnProperty.call(err.detail, "reap_code");
      if (cleanupPending) {
        integrationTuples.set(key, { integration_state: "cleanup_pending" });
      } else if (latched) {
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

    const recoveredIntegration = integrationResult.recovered === true;
    const integration = Object.freeze({
      schema_version: integrationResult.schema_version,
      integrated: integrationResult.integrated,
      rebased: integrationResult.rebased,
      previous_wk_sha: integrationResult.previous_wk_sha,
      slice_ref: integrationResult.slice_ref,
      slice_sha: integrationResult.slice_sha,
      wk_ref: integrationResult.wk_ref,
      wk_sha: integrationResult.wk_sha,
      review_target: integrationResult.review_target,
      transition: integrationResult.transition,
      tuple: Object.freeze({
        assigned_unit: assignedUnit,
        launch_ref: launchRef,
        run_id: runId,
        retry_id: retryId
      }),
      terminal_review_evidence: integrationResult.terminal_review_evidence,
      ...(recoveredIntegration
        ? {
            recovered: true,
            integrated_state: integrationResult.integrated_state
          }
        : {})
    });
    const response = brokerBuildSliceIntegratedResponse({ integration });
    integrationTuples.set(key, {
      integration_state: "integrated",
      review_enforcement_mode: integrationReviewEnforcementMode,
      slice_review_policy: integrationResult.slice_review_policy ?? null,
      response
    });
    return response;
  }

  async function handlePrepareSliceReviewSurface(envelope) {
    if (typeof prepareManagedSliceReviewSurface !== "function" ||
        typeof sliceReviewPreparationMainRepo !== "string" ||
        sliceReviewPreparationMainRepo.length === 0) {
      return brokerBuildRefusalResponse({
        code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.REQUEST_INVALID,
        reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.PLAN_REFUSED,
        detail: { issue: "slice_review_preparation_not_composed" }
      });
    }
    const outerKeys = Object.keys(envelope);
    const outerExact = outerKeys.length === PREPARE_SLICE_REVIEW_SURFACE_ENVELOPE_FIELDS.length &&
      PREPARE_SLICE_REVIEW_SURFACE_ENVELOPE_FIELDS.every(
        (field) => Object.prototype.hasOwnProperty.call(envelope, field)
      );
    if (!outerExact || !isPlainObject(envelope.prepare_request)) {
      return brokerBuildRefusalResponse({
        code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.REQUEST_INVALID,
        reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.REQUEST_MALFORMED,
        detail: { issue: "prepare_slice_review_surface_outer_envelope_invalid", keys: outerKeys.sort() }
      });
    }
    const request = envelope.prepare_request;
    const requestKeys = Object.keys(request);
    const exactRequest = requestKeys.length ===
      HOST_WRITE_AUTHORITY_PREPARE_SLICE_REVIEW_SURFACE_REQUEST_FIELDS.length &&
      HOST_WRITE_AUTHORITY_PREPARE_SLICE_REVIEW_SURFACE_REQUEST_FIELDS.every(
        (field) => Object.prototype.hasOwnProperty.call(request, field)
      );
    const normalized = buildHostWriteAuthorityPrepareSliceReviewSurfaceRequest(request);
    const { assigned_unit: assignedUnit, launch_ref: launchRef, run_id: runId, retry_id: retryId } = normalized;
    if (!exactRequest || typeof assignedUnit !== "string" ||
        !/^WK-\d{4}#SLICE-\d{3}$/u.test(assignedUnit) ||
        typeof launchRef !== "string" || launchRef.length === 0 ||
        typeof runId !== "string" || runId.length === 0 ||
        runId.endsWith(".slice") || runId.endsWith(".wk") ||
        !Number.isInteger(retryId) || retryId < 0) {
      return brokerBuildRefusalResponse({
        code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.REQUEST_INVALID,
        reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.REQUEST_MALFORMED,
        detail: { issue: "prepare_slice_review_surface_request_invalid" }
      });
    }
    let preparation;
    try {
      preparation = await prepareManagedSliceReviewSurface({
        mainRepo: sliceReviewPreparationMainRepo,
        assignedUnit,
        launchRef,
        runId,
        retryId
      });
    } catch (error) {
      return brokerBuildRefusalResponse({
        code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.PLAN_THREW,
        reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.PLAN_THREW,
        detail: {
          issue: "slice_review_preparation_threw",
          message: error?.message ?? String(error),
          code: error?.code ?? null,
          error_detail: error?.detail == null ? null : boundStructuredRefusalDetail(error.detail)
        }
      });
    }
    const resultCheck = validateSliceReviewSurfacePreparationResult(preparation, normalized);
    if (!resultCheck.ok) {
      return brokerBuildRefusalResponse({
        code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.PLAN_THREW,
        reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.PLAN_THREW,
        detail: { issue: "slice_review_preparation_result_invalid", result_detail: resultCheck.detail }
      });
    }
    return brokerBuildSliceReviewSurfacePreparedResponse(preparation);
  }

  async function handleWkForgeHandoff(envelope) {
    if (typeof wkForgeHandoff !== "function" ||
        typeof forgeHandoffMainRepo !== "string" || forgeHandoffMainRepo.length === 0) {
      return brokerBuildRefusalResponse({
        code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.REQUEST_INVALID,
        reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.FORGE_HANDOFF_UNAVAILABLE,
        detail: { issue: "forge_handoff_not_composed" }
      });
    }
    const outerKeys = Object.keys(envelope);
    const outerExact = outerKeys.length === WK_FORGE_HANDOFF_ENVELOPE_FIELDS.length &&
      WK_FORGE_HANDOFF_ENVELOPE_FIELDS.every(
        (field) => Object.prototype.hasOwnProperty.call(envelope, field)
      );
    if (!outerExact) {
      return brokerBuildRefusalResponse({
        code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.REQUEST_INVALID,
        reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.FORGE_HANDOFF_REQUEST_INVALID,
        detail: { issue: "wk_forge_handoff_outer_envelope_not_exact", keys: [...outerKeys].sort() }
      });
    }
    const request = isPlainObject(envelope.forge_request) ? envelope.forge_request : null;
    const requestKeys = request === null ? [] : Object.keys(request);
    const exactRequest = request !== null &&
      requestKeys.length === HOST_WRITE_AUTHORITY_WK_FORGE_HANDOFF_REQUEST_FIELDS.length &&
      HOST_WRITE_AUTHORITY_WK_FORGE_HANDOFF_REQUEST_FIELDS.every(
        (field) => Object.prototype.hasOwnProperty.call(request, field)
      );
    if (!exactRequest || typeof request.assigned_unit !== "string" ||
        !WK_FORGE_HANDOFF_ASSIGNED_UNIT_RE.test(request.assigned_unit)) {
      return brokerBuildRefusalResponse({
        code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.REQUEST_INVALID,
        reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.FORGE_HANDOFF_REQUEST_INVALID,
        detail: { issue: "forge_request_shape_invalid" }
      });
    }
    let outcome;
    try {
      outcome = await wkForgeHandoff({
        mainRepo: forgeHandoffMainRepo,
        assignedUnit: request.assigned_unit,
        deps: forgeHandoffDeps
      });
    } catch (error) {
      return brokerBuildRefusalResponse({
        code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.PLAN_THREW,
        reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.FORGE_HANDOFF_THREW,
        detail: { issue: "forge_handoff_executor_threw", message: error?.message ?? String(error) }
      });
    }
    if (isPlainObject(outcome) && outcome.ok === true && isPlainObject(outcome.result)) {
      return brokerBuildWkForgeHandoffResponse({ forgeHandoff: outcome.result });
    }
    const category = isPlainObject(outcome) ? outcome.category : null;
    const reason = WK_FORGE_HANDOFF_CATEGORY_TO_REASON[category] ??
      HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.FORGE_HANDOFF_THREW;
    return brokerBuildRefusalResponse({
      code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.PLAN_REFUSED,
      reason,
      detail: {
        issue: "forge_handoff_refused",
        category: typeof category === "string" ? category : null,
        refusal_detail: isPlainObject(outcome) && outcome.detail != null
          ? boundStructuredRefusalDetail(outcome.detail)
          : null
      }
    });
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
    } else if (envelope.op === HOST_WRITE_AUTHORITY_OPS.PREPARE_SLICE_REVIEW_SURFACE) {
      response = await handlePrepareSliceReviewSurface(envelope);
    } else if (envelope.op === HOST_WRITE_AUTHORITY_OPS.INTEGRATE_SLICE) {
      response = await handleIntegrateSlice(envelope);
    } else if (envelope.op === HOST_WRITE_AUTHORITY_OPS.WK_FORGE_HANDOFF) {
      response = await handleWkForgeHandoff(envelope);
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
