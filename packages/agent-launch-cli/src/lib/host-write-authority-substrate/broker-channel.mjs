

import { Buffer } from "node:buffer";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  HOST_WRITE_AUTHORITY_LAUNCH_INPUT_FIELDS,
  HOST_WRITE_AUTHORITY_OPS,
  isPlainObject,
  isNonEmptyString
} from "./protocol-constants.mjs";
import {
  normalizeEndpointShape
} from "./endpoint.mjs";
import {
  createHostWriteAuthoritySubstrateAdapter
} from "./adapter.mjs";

import {
  MANAGED_WORKTREE_BINDING_SCHEMA_VERSION,
  MANAGED_SLICE_CHECKOUT_MODE_FULL
} from "../worktree-provisioning-dispatch.mjs";

const FROZEN_SCOPE_AUTHORITY_FIELDS = Object.freeze([
  "schema_version", "unit_address", "selected_unit", "source", "source_digest",
  "source_version", "read_scope", "repo_paths", "readable_scope", "write_scope"
]);
const FROZEN_SELECTED_UNIT_FIELDS = Object.freeze([
  "kind", "address", "record_id", "slice_id", "repo"
]);

const FROZEN_MANAGED_PROVISIONING_FIELDS = Object.freeze([
  "schema_version", "complete", "main_repo", "initiative", "record_id", "slice_id",
  "unit_address", "retry_id", "wk_binding", "slice_binding",
  "worktree_path", "output_branch", "base_ref", "base_sha", "write_scope", "cone_dirs",
  "index_sparse", "validation_worktree_path", "shared_git_exposed"
]);

const FROZEN_NESTED_WK_BINDING_FIELDS = Object.freeze([
  "schema_version", "launch_ref", "run_id", "retry_id", "unit_address",
  "initiative", "record_id", "slice_id", "base_ref", "base_sha",
  "output_branch", "worktree_path", "write_scope", "write_scope_source"
]);
const FROZEN_NESTED_SLICE_BINDING_FIELDS = Object.freeze([
  ...FROZEN_NESTED_WK_BINDING_FIELDS,
  "read_scope", "repo_paths", "selected_unit", "source_digest", "source_version",
  "cone_dirs", "index_sparse"
]);

const FROZEN_MANAGED_PROVISIONING_FIELDS_V2 = Object.freeze([
  ...FROZEN_MANAGED_PROVISIONING_FIELDS.filter(
    (field) => field !== "cone_dirs" && field !== "index_sparse"
  ),
  "checkout_mode"
]);
const FROZEN_NESTED_SLICE_BINDING_FIELDS_V2 = Object.freeze([
  ...FROZEN_NESTED_WK_BINDING_FIELDS,
  "read_scope", "repo_paths", "selected_unit", "source_digest", "source_version",
  "checkout_mode"
]);
const LAUNCH_INPUT_FIELD_SET = new Set(HOST_WRITE_AUTHORITY_LAUNCH_INPUT_FIELDS);

function hasOwn(value, field) {
  return Object.prototype.hasOwnProperty.call(value, field);
}

function managedCarrierCheckoutMode(value) {
  if (!isPlainObject(value)) return null;
  const hasCone = hasOwn(value, "cone_dirs");
  const hasIndexSparse = hasOwn(value, "index_sparse");
  const hasCheckoutMode = hasOwn(value, "checkout_mode");
  if (hasCheckoutMode && !hasCone && !hasIndexSparse) {
    return value.checkout_mode === MANAGED_SLICE_CHECKOUT_MODE_FULL ? "full" : null;
  }
  if (!hasCheckoutMode && hasCone && hasIndexSparse) return "sparse";
  return null;
}

function hasExactFields(value, expected) {
  return isPlainObject(value) && Object.keys(value).length === expected.length &&
    expected.every((field) => hasOwn(value, field));
}

function effectiveWorkerRole(launchInput) {
  return launchInput?.app === "claude" || launchInput?.app === "agy"
    ? launchInput?.role ?? null
    : launchInput?.codex_role ?? launchInput?.role ?? null;
}

async function validateFrozenAuthorityTransport(envelope, { parsed = false } = {}) {
  if (envelope?.op !== HOST_WRITE_AUTHORITY_OPS.START_LAUNCH ||
      !isPlainObject(envelope?.launch_input)) return envelope;
  const launchInput = envelope.launch_input;
  const unexpectedField = Object.keys(launchInput)
    .find((field) => !LAUNCH_INPUT_FIELD_SET.has(field));
  if (unexpectedField) {
    throw new Error(`broker launch input contains non-schema field ${JSON.stringify(unexpectedField)}`);
  }
  const authority = launchInput.worker_scope_authority ?? null;

  const provisioning = launchInput.worktree_provisioning ?? null;
  const hasAuthorityCarrier = authority !== null || provisioning !== null;
  if (!hasAuthorityCarrier) return envelope;
  if (effectiveWorkerRole(launchInput) !== "worker") {
    throw new Error("broker worker scope authority cannot bind a non-worker role");
  }
  if (!hasExactFields(authority, FROZEN_SCOPE_AUTHORITY_FIELDS) ||
      !hasExactFields(authority.selected_unit, FROZEN_SELECTED_UNIT_FIELDS)) {
    throw new Error("broker worker scope authority has an incomplete or extended schema");
  }
  if (parsed) {
    Object.freeze(authority.selected_unit);
    for (const field of ["read_scope", "repo_paths", "readable_scope", "write_scope"]) {
      if (Array.isArray(authority[field])) Object.freeze(authority[field]);
    }
    Object.freeze(authority);
  }

  validateFrozenManagedProvisioningTransport(provisioning, { parsed });
  const { assertFrozenWorkerScopeAuthority } = await import("../workspace-agent-launch-core.mjs");
  assertFrozenWorkerScopeAuthority(authority, {
    role: effectiveWorkerRole(launchInput),
    subject: typeof launchInput.subject === "string" ? launchInput.subject : null,

    worktreeProvisioning: provisioning,
    required: true
  });
  if (parsed) {
    Object.freeze(launchInput);
    Object.freeze(envelope);
  }
  return envelope;
}

function validateFrozenManagedProvisioningTransport(provisioning, { parsed }) {
  if (provisioning === null || provisioning === undefined) {
    return;
  }

  const carrierMode = managedCarrierCheckoutMode(provisioning);
  if (!isPlainObject(provisioning) ||
      provisioning.schema_version !== MANAGED_WORKTREE_BINDING_SCHEMA_VERSION ||
      provisioning.complete !== true ||
      carrierMode === null ||
      !hasExactFields(
        provisioning,
        carrierMode === "full" ? FROZEN_MANAGED_PROVISIONING_FIELDS_V2 : FROZEN_MANAGED_PROVISIONING_FIELDS
      )) {
    throw new Error("broker managed worktree provisioning carrier is incomplete or has an extended schema");
  }
  const sliceBinding = provisioning.slice_binding;
  const wkBinding = provisioning.wk_binding;
  if (!isPlainObject(sliceBinding) || !isPlainObject(wkBinding)) {
    throw new Error("broker managed worktree provisioning carrier is missing its nested bindings");
  }

  if (!hasExactFields(wkBinding, FROZEN_NESTED_WK_BINDING_FIELDS) ||
      !hasExactFields(
        sliceBinding,
        carrierMode === "full" ? FROZEN_NESTED_SLICE_BINDING_FIELDS_V2 : FROZEN_NESTED_SLICE_BINDING_FIELDS
      )) {
    throw new Error("broker managed worktree provisioning carrier nested binding has an extended or truncated schema");
  }
  if (!isNonEmptyString(provisioning.main_repo) ||
      provisioning.worktree_path !== sliceBinding.worktree_path ||
      provisioning.retry_id !== sliceBinding.retry_id ||
      provisioning.unit_address !== sliceBinding.unit_address) {
    throw new Error("broker managed worktree provisioning carrier is internally inconsistent");
  }
  if (parsed) {
    for (const nested of [wkBinding, sliceBinding]) {
      for (const key of Object.keys(nested)) {
        if (Array.isArray(nested[key])) Object.freeze(nested[key]);
      }
      Object.freeze(nested);
    }
    for (const key of ["write_scope", "cone_dirs"]) {
      if (Array.isArray(provisioning[key])) Object.freeze(provisioning[key]);
    }
    Object.freeze(provisioning);
  } else if (!Object.isFrozen(provisioning) || !Object.isFrozen(sliceBinding) || !Object.isFrozen(wkBinding)) {
    throw new Error("broker managed worktree provisioning carrier is mutable before serialization");
  }
}

export async function serializeHostWriteAuthorityBrokerEnvelope(envelope) {
  await validateFrozenAuthorityTransport(envelope);
  const serialized = JSON.stringify(envelope);
  if (typeof serialized !== "string") {
    throw new Error("host write authority broker envelope is not JSON serializable");
  }
  const authority = envelope?.launch_input?.worker_scope_authority ?? null;
  if (authority !== null) {
    const roundTripped = JSON.parse(serialized)?.launch_input?.worker_scope_authority ?? null;
    if (!isDeepStrictEqual(roundTripped, authority)) {
      throw new Error("host write authority broker serialization changed frozen worker scope authority");
    }
  }

  const provisioning = envelope?.launch_input?.worktree_provisioning ?? null;
  if (provisioning !== null) {
    const roundTripped = JSON.parse(serialized)?.launch_input?.worktree_provisioning ?? null;
    if (!isDeepStrictEqual(roundTripped, provisioning)) {
      throw new Error("host write authority broker serialization changed frozen managed worktree provisioning");
    }
  }
  return serialized;
}

export async function restoreHostWriteAuthorityBrokerEnvelope(parsed) {
  return await validateFrozenAuthorityTransport(parsed, { parsed: true });
}

export function createHostWriteAuthorityBrokerChannel(options = {}) {
  const {
    socketPath = null,
    endpoint = null,
    connectTimeoutMs = 5000,
    readTimeoutMs = 60000
  } = options;

  const hasEndpoint = endpoint !== null && endpoint !== undefined;
  const hasSocketPath = !hasEndpoint && isNonEmptyString(socketPath);
  if (hasEndpoint && isNonEmptyString(socketPath)) {
    throw new Error(
      "createHostWriteAuthorityBrokerChannel: exactly one of { socketPath, endpoint } may be provided"
    );
  }
  let resolvedEndpoint = null;
  if (hasEndpoint) {
    resolvedEndpoint = normalizeEndpointShape(endpoint, { requireLoopback: true });
    if (resolvedEndpoint === null) {
      throw new Error(
        `createHostWriteAuthorityBrokerChannel: endpoint must be { host: "127.0.0.1", port: <integer in [1, 65535]> }: ${JSON.stringify(endpoint)}`
      );
    }
  } else {
    if (!isNonEmptyString(socketPath)) {
      throw new Error(
        "createHostWriteAuthorityBrokerChannel: socketPath is required"
      );
    }
    if (!path.isAbsolute(socketPath)) {
      throw new Error(
        `createHostWriteAuthorityBrokerChannel: socketPath must be absolute: ${socketPath}`
      );
    }
  }

  function connect() {
    if (hasSocketPath) {
      return net.createConnection(socketPath);
    }
    return net.createConnection({ host: resolvedEndpoint.host, port: resolvedEndpoint.port });
  }

  return async function hostWriteAuthorityBrokerChannel(envelope) {
    const serializedEnvelope = await serializeHostWriteAuthorityBrokerEnvelope(envelope);
    return await new Promise((resolve, reject) => {
      const socket = connect();
      let buffer = Buffer.alloc(0);
      let settled = false;

      const connectTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { socket.destroy(); } catch {   }
        reject(new Error(`host write authority broker connect timed out after ${connectTimeoutMs}ms`));
      }, connectTimeoutMs);
      connectTimer.unref?.();

      let readTimer = null;

      socket.once("connect", () => {
        clearTimeout(connectTimer);
        readTimer = setTimeout(() => {
          if (settled) return;
          settled = true;
          try { socket.destroy(); } catch {   }
          reject(new Error(`host write authority broker read timed out after ${readTimeoutMs}ms`));
        }, readTimeoutMs);
        readTimer.unref?.();
        try {
          socket.write(serializedEnvelope + "\n");
        } catch (err) {
          if (settled) return;
          settled = true;
          clearTimeout(readTimer);
          try { socket.destroy(); } catch {   }
          reject(err);
        }
      });
      socket.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        const newlineIdx = buffer.indexOf(0x0a);
        if (newlineIdx === -1) return;
        const line = buffer.subarray(0, newlineIdx).toString("utf8");
        if (settled) return;
        settled = true;
        if (readTimer) clearTimeout(readTimer);
        try { socket.end(); } catch {   }
        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch (err) {
          reject(new Error(`host write authority broker returned non-JSON: ${err?.message ?? String(err)}`));
          return;
        }
        resolve(parsed);
      });
      socket.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimer);
        if (readTimer) clearTimeout(readTimer);
        reject(err);
      });
      socket.on("close", () => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimer);
        if (readTimer) clearTimeout(readTimer);
        reject(new Error("host write authority broker connection closed before response"));
      });
    });
  };
}

export function createHostWriteAuthoritySubstrateAdapterIfBrokerReachable({
  socketPath = null,
  endpoint = null,
  requireEndpoint = false,
  existsSync: existsSyncImpl = existsSync,
  createBrokerChannel = createHostWriteAuthorityBrokerChannel,
  createAdapter = createHostWriteAuthoritySubstrateAdapter
} = {}) {

  if (endpoint !== null && endpoint !== undefined) {
    const normalized = normalizeEndpointShape(endpoint, { requireLoopback: true });
    if (normalized === null) return null;
    const channel = createBrokerChannel({ endpoint: normalized });
    return createAdapter({ channel });
  }
  if (requireEndpoint) return null;
  if (!isNonEmptyString(socketPath)) return null;
  if (!path.isAbsolute(socketPath)) return null;
  if (typeof existsSyncImpl !== "function") return null;
  if (!existsSyncImpl(socketPath)) return null;
  const channel = createBrokerChannel({ socketPath });
  return createAdapter({ channel });
}
