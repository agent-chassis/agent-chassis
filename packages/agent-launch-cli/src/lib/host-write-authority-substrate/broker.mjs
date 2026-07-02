

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
  WORKER_ADMISSION_THREW: "broker_worker_admission_threw"
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

    evaluateWorkerAdmission = null,

    resolveWorkerAdmissionEnv = buildBrokerWorkerAdmissionEnv,

    buildFailOpenPlan = buildWorkspaceAgentFailOpenPlan,
    plainSpawn = spawnPlainChildLaunch
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

    if (effectiveRole === "worker" && typeof evaluateWorkerAdmission === "function") {
      const launchSubject = typeof launchInput.subject === "string" ? launchInput.subject : null;
      const launchWorkspaceDir = typeof launchInput.workspace_dir === "string" ? launchInput.workspace_dir : null;

      const admissionEnv = resolveWorkerAdmissionEnv({ workspaceDir: launchWorkspaceDir });
      let admissionOutcome;
      try {
        admissionOutcome = await evaluateWorkerAdmission({
          workspaceDir: launchWorkspaceDir,
          subject: launchSubject,
          env: admissionEnv
        });
      } catch (err) {
        return brokerBuildRefusalResponse({
          code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.PLAN_THREW,
          reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.WORKER_ADMISSION_THREW,
          detail: { message: err?.message ?? String(err) }
        });
      }
      if (!admissionOutcome || typeof admissionOutcome !== "object") {
        return brokerBuildRefusalResponse({
          code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.PLAN_REFUSED,
          reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.WORKER_ADMISSION_REFUSED,
          detail: { issue: "worker_admission_no_result" }
        });
      }
      if (!admissionOutcome.allowed) {
        return brokerBuildRefusalResponse({
          code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.PLAN_REFUSED,
          reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.WORKER_ADMISSION_REFUSED,
          detail: isPlainObject(admissionOutcome.detail)
            ? admissionOutcome.detail
            : { reason: admissionOutcome.reason ?? null }
        });
      }
    }

    let planResult;
    try {
      planResult = await effectivePlanLaunch(launchInput);
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
    if (!isPlainObject(plan) || !isPlainObject(bwrapPlan)) {
      return brokerBuildRefusalResponse({
        code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.PLAN_REFUSED,
        reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.PLAN_REFUSED,
        detail: { issue: "plan_result_missing_plan_or_bwrap_plan" }
      });
    }

    const familyParseFinalResult = typeof planResult.parseFinalResult === "function"
      ? planResult.parseFinalResult
      : (typeof captureFinalResult === "function" ? captureFinalResult : null);
    if (familyParseFinalResult === null) {
      return brokerBuildRefusalResponse({
        code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.PLAN_REFUSED,
        reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.FINAL_RESULT_PARSER_MISSING,
        detail: { issue: "plan_result_missing_parse_final_result" }
      });
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
        return brokerBuildRefusalResponse({
          code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.SPAWN_FAILED,
          reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.SPAWN_FAILED,
          detail: { code: isolationCode, message: err?.message ?? String(err) }
        });
      }

      const failOpenPlan = buildFailOpenPlan({
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
          : null
      });
      if (
        !isPlainObject(failOpenPlan)
        || failOpenPlan.disposition !== WORKSPACE_AGENT_FAIL_OPEN_DISPOSITIONS.PLAIN_SPAWN
        || !isPlainObject(failOpenPlan.plan)
      ) {

        return brokerBuildRefusalResponse({
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
        });
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
        return brokerBuildRefusalResponse({
          code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.SPAWN_FAILED,
          reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.SPAWN_FAILED,
          detail: {
            issue: "fail_open_plain_spawn_threw",
            message: plainErr?.message ?? String(plainErr)
          }
        });
      }
      failOpenProvenance = Object.freeze({
        warning: failOpenPlan.warning ?? null,
        enforcement: failOpenPlan.enforcement ?? null,
        isolation: failOpenPlan.isolation ?? null
      });
    }
    if (!isPlainObject(child)) {
      return brokerBuildRefusalResponse({
        code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.SPAWN_FAILED,
        reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.SPAWN_FAILED,
        detail: { issue: "spawn_returned_no_child" }
      });
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
