

import { randomBytes } from "node:crypto";
import {
  HOST_WRITE_AUTHORITY_RESPONSE_KINDS,
  HOST_WRITE_AUTHORITY_RESPONSE_SCHEMA_VERSION,
  HOST_WRITE_AUTHORITY_SUBSTRATE_ID,
  HOST_WRITE_AUTHORITY_SUBSTRATE_PROTOCOL_VERSION,
  isPlainObject
} from "./protocol-constants.mjs";

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

  INTEGRATION_THREW: "broker_integration_threw",

  FORGE_HANDOFF_UNAVAILABLE: "broker_forge_handoff_unavailable",

  FORGE_HANDOFF_REQUEST_INVALID: "broker_forge_handoff_request_invalid",

  FORGE_HANDOFF_REMOTE_INVALID: "broker_forge_handoff_remote_invalid",

  FORGE_HANDOFF_ELIGIBILITY_REFUSED: "broker_forge_handoff_eligibility_refused",

  FORGE_HANDOFF_PUBLICATION_DISAGREEMENT: "broker_forge_handoff_publication_disagreement",

  FORGE_HANDOFF_INDETERMINATE: "broker_forge_handoff_indeterminate",

  FORGE_HANDOFF_THREW: "broker_forge_handoff_threw"
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

export function defaultRunHandleFactory() {
  return `${HOST_WRITE_AUTHORITY_BROKER_RUN_HANDLE_PREFIX}${randomBytes(12).toString("hex")}`;
}

export async function spawnPlainChildLaunch(command, args, options) {
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

export function boundStructuredRefusalDetail(value, depth = 0) {
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

export function brokerBuildAcceptedResponse({ runHandle, status, pid, failOpen = null }) {
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

export function brokerBuildProbeResponse({ status, exit, finalResult }) {
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

export function brokerBuildProvisionedResponse({ provisioning }) {
  return Object.freeze({
    schema_version: HOST_WRITE_AUTHORITY_RESPONSE_SCHEMA_VERSION,
    substrate_id: HOST_WRITE_AUTHORITY_SUBSTRATE_ID,
    protocol_version: HOST_WRITE_AUTHORITY_SUBSTRATE_PROTOCOL_VERSION,
    kind: HOST_WRITE_AUTHORITY_RESPONSE_KINDS.WORKTREE_PROVISIONED,
    provisioning
  });
}

export function brokerBuildSliceCommittedResponse({ commitResult }) {
  return Object.freeze({
    schema_version: HOST_WRITE_AUTHORITY_RESPONSE_SCHEMA_VERSION,
    substrate_id: HOST_WRITE_AUTHORITY_SUBSTRATE_ID,
    protocol_version: HOST_WRITE_AUTHORITY_SUBSTRATE_PROTOCOL_VERSION,
    kind: HOST_WRITE_AUTHORITY_RESPONSE_KINDS.SLICE_COMMITTED,
    commit_result: commitResult
  });
}

export function brokerBuildSliceIntegratedResponse({ integration }) {
  return Object.freeze({
    schema_version: HOST_WRITE_AUTHORITY_RESPONSE_SCHEMA_VERSION,
    substrate_id: HOST_WRITE_AUTHORITY_SUBSTRATE_ID,
    protocol_version: HOST_WRITE_AUTHORITY_SUBSTRATE_PROTOCOL_VERSION,
    kind: HOST_WRITE_AUTHORITY_RESPONSE_KINDS.SLICE_INTEGRATED,
    integration
  });
}

export function brokerBuildWkForgeHandoffResponse({ forgeHandoff }) {
  return Object.freeze({
    schema_version: HOST_WRITE_AUTHORITY_RESPONSE_SCHEMA_VERSION,
    substrate_id: HOST_WRITE_AUTHORITY_SUBSTRATE_ID,
    protocol_version: HOST_WRITE_AUTHORITY_SUBSTRATE_PROTOCOL_VERSION,
    kind: HOST_WRITE_AUTHORITY_RESPONSE_KINDS.WK_FORGE_HANDOFF_COMPLETED,
    forge_handoff: forgeHandoff
  });
}
