

import { randomBytes } from "node:crypto";

import {
  WORKSPACE_AGENT_DISPATCH_BACKEND_SCHEMA_VERSION,
  WORKSPACE_AGENT_DISPATCH_RUN_STATUS_SCHEMA_VERSION,
  BACKEND_RUN_STATUSES
} from "@agent-chassis/agent-launch-core";

const MONITOR_HANDLE_PREFIX = "wkmh_";
const RUN_ID_PREFIX = "wkdb_";

export function defaultRunIdFactory() {
  return `${RUN_ID_PREFIX}${randomBytes(8).toString("hex")}`;
}

export function defaultMonitorHandleFactory() {
  return `${MONITOR_HANDLE_PREFIX}${randomBytes(12).toString("hex")}`;
}

export function buildRefusal(schema_version, code, reason, detail) {
  return {
    schema_version,
    accepted: false,
    refusal: {
      code,
      reason: reason ?? null,
      detail: detail ?? null
    }
  };
}

export function dispatchRefusal(code, reason, detail) {
  return buildRefusal(WORKSPACE_AGENT_DISPATCH_BACKEND_SCHEMA_VERSION, code, reason, detail);
}

export function statusRefusal(code, reason, detail) {
  return buildRefusal(WORKSPACE_AGENT_DISPATCH_RUN_STATUS_SCHEMA_VERSION, code, reason, detail);
}

export function normalizeStatus(status) {
  if (typeof status !== "string") return null;
  return BACKEND_RUN_STATUSES.includes(status) ? status : null;
}
