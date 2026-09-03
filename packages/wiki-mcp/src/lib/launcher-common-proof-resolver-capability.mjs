import { fstatSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  createWorkspaceAgentCommonProofCaptureResolver
} from "@agent-chassis/agent-launch-cli/src/lib/workspace-agent-common-proof-capture-resolver.mjs";

export const LAUNCHER_COMMON_PROOF_RESOLVER_FD = 5;
export const LAUNCHER_COMMON_PROOF_RESOLVER_CAPABILITY_VERSION =
  "launcher-common-proof-resolver-capability.v1";
export const LAUNCHER_COMMON_PROOF_RESOLVER_CAPABILITY_MAX_BYTES = 8192;

const ALIAS_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const AUTHENTICATED_CAPABILITIES = new WeakSet();

function capabilityError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

export function consumeLauncherCommonProofResolverCapability() {
  let stats;
  try {
    stats = fstatSync(LAUNCHER_COMMON_PROOF_RESOLVER_FD);
  } catch (error) {
    if (error?.code === "EBADF" || error?.code === "EINVAL") return null;
    throw capabilityError("common_proof_resolver_capability_failed",
      "launcher common-proof resolver descriptor could not be inspected");
  }

  if (!stats.isFile()) return null;
  if (stats.nlink !== 0 || (stats.mode & 0o077) !== 0) {
    throw capabilityError("common_proof_resolver_capability_failed",
      "launcher common-proof resolver descriptor is not one private inherited file");
  }
  let bytes;
  try {
    bytes = readFileSync(LAUNCHER_COMMON_PROOF_RESOLVER_FD);
  } catch {
    throw capabilityError("common_proof_resolver_capability_failed",
      "launcher common-proof resolver descriptor could not be read");
  }
  if (!(bytes instanceof Buffer) || bytes.byteLength === 0 ||
      bytes.byteLength > LAUNCHER_COMMON_PROOF_RESOLVER_CAPABILITY_MAX_BYTES) {
    throw capabilityError("common_proof_resolver_capability_failed",
      "launcher common-proof resolver descriptor is empty or over-bound");
  }
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw capabilityError("common_proof_resolver_capability_failed",
      "launcher common-proof resolver descriptor is malformed");
  }
  if (!isPlainObject(parsed) ||
      Object.keys(parsed).sort().join("\0") !==
        ["repository_alias", "schema_version", "workspace_dir"].join("\0") ||
      parsed.schema_version !== LAUNCHER_COMMON_PROOF_RESOLVER_CAPABILITY_VERSION ||
      typeof parsed.repository_alias !== "string" || !ALIAS_RE.test(parsed.repository_alias) ||
      typeof parsed.workspace_dir !== "string" || !path.isAbsolute(parsed.workspace_dir) ||
      path.normalize(parsed.workspace_dir) !== parsed.workspace_dir) {
    throw capabilityError("common_proof_resolver_capability_failed",
      "launcher common-proof resolver descriptor is unsupported or misbound");
  }
  const capability = Object.freeze({
    schema_version: parsed.schema_version,
    repository_alias: parsed.repository_alias,
    workspace_dir: parsed.workspace_dir
  });
  AUTHENTICATED_CAPABILITIES.add(capability);
  return capability;
}

export function createLauncherCommonProofResolverFromCapability(capability) {
  if (!AUTHENTICATED_CAPABILITIES.has(capability) || !Object.isFrozen(capability)) {
    throw capabilityError("common_proof_resolver_capability_failed",
      "common-proof resolver capability is not authenticated by the inherited descriptor");
  }
  return createWorkspaceAgentCommonProofCaptureResolver({
    workspaceDir: capability.workspace_dir,
    repositoryAlias: capability.repository_alias
  });
}
