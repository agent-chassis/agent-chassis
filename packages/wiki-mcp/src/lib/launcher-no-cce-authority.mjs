import { fstatSync, readFileSync } from "node:fs";

import {
  API_KEY_ENV_KEYS,
  REQUEST_CONTRACT_DIGEST_ENV_KEYS,
  SERVICE_URL_ENV_KEYS,
  WORKER_ADMISSION_AUTHORITY_BINDING_ENV_KEYS,
  WORKER_ADMISSION_ROUTE_ENV_KEYS
} from "../../../wiki-core/src/lib/node-engine-api-client.mjs";

export const LAUNCHER_NO_CCE_AUTHORITY_FD = 4;
export const LAUNCHER_NO_CCE_AUTHORITY_SCHEMA_VERSION =
  "launcher-authenticated-no-cce-authority-declaration.v1";

const MAX_DECLARATION_BYTES = 4096;
const AUTHENTICATED_CAPABILITIES = new WeakSet();
const CARRIER_FIELDS = Object.freeze([
  "serviceUrl",
  "apiKey",
  "workerAdmissionRoute",
  "requestContractDigest",
  "workerAdmissionAuthorityBinding"
]);
const AUTHORITY_ENV_KEYS = new Set([
  ...SERVICE_URL_ENV_KEYS,
  ...API_KEY_ENV_KEYS,
  ...WORKER_ADMISSION_ROUTE_ENV_KEYS,
  ...REQUEST_CONTRACT_DIGEST_ENV_KEYS,
  ...WORKER_ADMISSION_AUTHORITY_BINDING_ENV_KEYS
]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function exactDeclaration(value) {
  if (!isPlainObject(value)) return false;
  if (Object.keys(value).length !== 4) return false;
  if (value.schema_version !== LAUNCHER_NO_CCE_AUTHORITY_SCHEMA_VERSION ||
      value.authenticated_node_engine_request_exists !== false ||
      value.node_engine_backing_exists !== false ||
      !isPlainObject(value.authority_carriers)) {
    return false;
  }
  const keys = Object.keys(value.authority_carriers);
  return keys.length === CARRIER_FIELDS.length &&
    keys.every((key) => CARRIER_FIELDS.includes(key)) &&
    CARRIER_FIELDS.every(
      (field) => value.authority_carriers[field] === "intentionally_undeclared"
    );
}

function declarationObject() {
  return {
    schema_version: LAUNCHER_NO_CCE_AUTHORITY_SCHEMA_VERSION,
    authenticated_node_engine_request_exists: false,
    node_engine_backing_exists: false,
    authority_carriers: Object.fromEntries(
      CARRIER_FIELDS.map((field) => [field, "intentionally_undeclared"])
    )
  };
}

export function serializeLauncherNoCceAuthorityDeclaration(bootstrap) {
  if (!isPlainObject(bootstrap) ||
      !Array.isArray(bootstrap.applied_keys) ||
      !Array.isArray(bootstrap.skipped_existing_keys) ||
      !Number.isInteger(bootstrap.ignored_malformed_line_count) ||
      bootstrap.ignored_malformed_line_count !== 0) {
    return null;
  }
  const declaredKeys = [...bootstrap.applied_keys, ...bootstrap.skipped_existing_keys];
  if (declaredKeys.some((key) => AUTHORITY_ENV_KEYS.has(key))) return null;
  return `${JSON.stringify(declarationObject())}\n`;
}

export function consumeLauncherNoCceAuthorityCapability() {
  try {
    const carrier = fstatSync(LAUNCHER_NO_CCE_AUTHORITY_FD);
    if (!carrier.isFile() || carrier.nlink !== 0) return null;
  } catch {
    return null;
  }
  let bytes;
  try {
    bytes = readFileSync(LAUNCHER_NO_CCE_AUTHORITY_FD);
  } catch {
    return null;
  }
  if (!(bytes instanceof Buffer) || bytes.byteLength === 0 || bytes.byteLength > MAX_DECLARATION_BYTES) {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    return null;
  }
  if (!exactDeclaration(parsed)) return null;
  const capability = Object.freeze({
    schema_version: LAUNCHER_NO_CCE_AUTHORITY_SCHEMA_VERSION
  });
  AUTHENTICATED_CAPABILITIES.add(capability);
  return capability;
}

export function isAuthenticatedLauncherNoCceAuthorityCapability(value) {
  return isPlainObject(value) && Object.isFrozen(value) &&
    value.schema_version === LAUNCHER_NO_CCE_AUTHORITY_SCHEMA_VERSION &&
    AUTHENTICATED_CAPABILITIES.has(value);
}
