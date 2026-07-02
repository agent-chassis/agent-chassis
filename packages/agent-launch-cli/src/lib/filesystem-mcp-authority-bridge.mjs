

import {
  AGENT_BACKEND_FILESYSTEM_MCP_HANDSHAKE_TRANSPORT_KINDS,
  resolveFilesystemMcpBackendAuthority
} from "./agent-backend.mjs";
import {
  hasLauncherVerifierCapability,
  verifyBackendHandshakeResult,
  AGENT_BACKEND_VERIFIER_REFUSAL_CODES,
  AGENT_BACKEND_VERIFIER_HANDSHAKE_RESULT_SCHEMA_VERSION
} from "./agent-backend-verifier.mjs";
import {
  loadLauncherRoleGuardSecret
} from "@agent-chassis/agent-launch-core/src/lib/launcher-context-mint.mjs";
import {
  canonicalizeJson,
  RoleGuardError
} from "@agent-chassis/agent-launch-core/src/lib/role-guard.mjs";

export const FILESYSTEM_MCP_AUTHORITY_BRIDGE_REFUSAL_CODES = Object.freeze({
  REGISTRY_BACKEND_MISSING: "filesystem_mcp_authority_bridge.registry_backend_missing.v1",
  REGISTRY_MODE_NOT_ENFORCED: "filesystem_mcp_authority_bridge.registry_mode_not_enforced.v1",
  HANDSHAKE_ENDPOINT_MISMATCH: "filesystem_mcp_authority_bridge.handshake_endpoint_mismatch.v1",
  HANDSHAKE_MALFORMED: "filesystem_mcp_authority_bridge.handshake_malformed.v1",
  HANDSHAKE_UNSIGNED_OR_TAMPERED: "filesystem_mcp_authority_bridge.handshake_unsigned_or_tampered.v1",
  HANDSHAKE_RAW_EXEC_ENABLED: "filesystem_mcp_authority_bridge.handshake_raw_exec_enabled.v1",
  HANDSHAKE_SCOPE_DIGEST_MISMATCH: "filesystem_mcp_authority_bridge.handshake_scope_digest_mismatch.v1",
  HANDSHAKE_TOOL_SURFACE_MISMATCH: "filesystem_mcp_authority_bridge.handshake_tool_surface_mismatch.v1",
  HANDSHAKE_NONCE_REPLAYED: "filesystem_mcp_authority_bridge.handshake_nonce_replayed.v1",
  ROLE_GUARD_SECRET_MISSING: "filesystem_mcp_authority_bridge.role_guard_secret_missing.v1",
  VERIFIER_CAPABILITY_MISSING: "filesystem_mcp_authority_bridge.verifier_capability_missing.v1",
  NONCE_STORE_MALFORMED: "filesystem_mcp_authority_bridge.nonce_store_malformed.v1"
});

const HANDSHAKE_REQUIRED_FIELDS = Object.freeze([
  "schema_version",
  "backend_kind",
  "backend_id",
  "backend_version",
  "challenge_nonce",
  "status",
  "mode",
  "raw_exec_enabled",
  "tool_surface",
  "scope_binding",
  "scope_digest",
  "validation_transport",
  "provenance_sink",
  "handshake_digest",
  "created_at",
  "expires_at",
  "nonce",
  "integrity"
]);

const VERIFIER_REFUSAL_TO_BRIDGE_CODE = Object.freeze({
  [AGENT_BACKEND_VERIFIER_REFUSAL_CODES.CAPABILITY_MISSING]:
    FILESYSTEM_MCP_AUTHORITY_BRIDGE_REFUSAL_CODES.VERIFIER_CAPABILITY_MISSING,
  [AGENT_BACKEND_VERIFIER_REFUSAL_CODES.SCHEMA_INVALID]:
    FILESYSTEM_MCP_AUTHORITY_BRIDGE_REFUSAL_CODES.HANDSHAKE_MALFORMED,
  [AGENT_BACKEND_VERIFIER_REFUSAL_CODES.INTEGRITY_INVALID]:
    FILESYSTEM_MCP_AUTHORITY_BRIDGE_REFUSAL_CODES.HANDSHAKE_UNSIGNED_OR_TAMPERED,
  [AGENT_BACKEND_VERIFIER_REFUSAL_CODES.RESULT_MUTATED]:
    FILESYSTEM_MCP_AUTHORITY_BRIDGE_REFUSAL_CODES.HANDSHAKE_UNSIGNED_OR_TAMPERED,
  [AGENT_BACKEND_VERIFIER_REFUSAL_CODES.RESULT_EXPIRED]:
    FILESYSTEM_MCP_AUTHORITY_BRIDGE_REFUSAL_CODES.HANDSHAKE_UNSIGNED_OR_TAMPERED,
  [AGENT_BACKEND_VERIFIER_REFUSAL_CODES.RAW_EXEC_FORBIDDEN]:
    FILESYSTEM_MCP_AUTHORITY_BRIDGE_REFUSAL_CODES.HANDSHAKE_RAW_EXEC_ENABLED,
  [AGENT_BACKEND_VERIFIER_REFUSAL_CODES.SCOPE_BINDING_UNAVAILABLE]:
    FILESYSTEM_MCP_AUTHORITY_BRIDGE_REFUSAL_CODES.HANDSHAKE_SCOPE_DIGEST_MISMATCH
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function refusal(code, reason) {
  return { ok: false, refusal: { code, reason } };
}

function canonicalEquals(left, right) {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

function validateRegistryShape(registry) {
  if (!isPlainObject(registry) || !isPlainObject(registry.data)) {
    return refusal(
      FILESYSTEM_MCP_AUTHORITY_BRIDGE_REFUSAL_CODES.REGISTRY_BACKEND_MISSING,
      "registry is required and must carry a .data envelope produced by loadRegistry"
    );
  }
  const backends = registry.data.filesystem_mcp_backends;
  if (!isPlainObject(backends) || Object.keys(backends).length === 0) {
    return refusal(
      FILESYSTEM_MCP_AUTHORITY_BRIDGE_REFUSAL_CODES.REGISTRY_BACKEND_MISSING,
      "launcher registry has no filesystem_mcp_backends configured"
    );
  }
  return null;
}

function validateHandshakeShape(handshakeResult) {
  if (!isPlainObject(handshakeResult)) {
    return refusal(
      FILESYSTEM_MCP_AUTHORITY_BRIDGE_REFUSAL_CODES.HANDSHAKE_MALFORMED,
      "handshakeResult must be a verifier-issued agent-backend-handshake-result.v1 object"
    );
  }
  if (handshakeResult.schema_version !== AGENT_BACKEND_VERIFIER_HANDSHAKE_RESULT_SCHEMA_VERSION) {
    return refusal(
      FILESYSTEM_MCP_AUTHORITY_BRIDGE_REFUSAL_CODES.HANDSHAKE_MALFORMED,
      `handshakeResult.schema_version must be ${AGENT_BACKEND_VERIFIER_HANDSHAKE_RESULT_SCHEMA_VERSION}`
    );
  }
  for (const field of HANDSHAKE_REQUIRED_FIELDS) {
    if (!(field in handshakeResult)) {
      return refusal(
        FILESYSTEM_MCP_AUTHORITY_BRIDGE_REFUSAL_CODES.HANDSHAKE_MALFORMED,
        `handshakeResult is missing required field ${field}; backend stdout did not produce a verifier-issued result`
      );
    }
  }
  return null;
}

function wrapResultNonceStoreForAuthorizedHandshake(realStore, authorizedNonce, authorizedExpiry) {
  let consumed = false;
  return {
    async checkAndMark(nonce, expiresAt) {
      if (!consumed && nonce === authorizedNonce && expiresAt === authorizedExpiry) {

        consumed = true;
        return true;
      }
      return realStore.checkAndMark(nonce, expiresAt);
    }
  };
}

export async function assembleLauncherOwnedFilesystemMcpAuthorityContext({
  registry,
  agentFamily,
  agentRole,
  agentProfile,
  backendKey = null,
  verifierCapability,
  resultNonceStore,
  handshakeResult,
  expectedScopeDigest,
  expectedToolSurface,
  workspaceDir,
  now = new Date()
} = {}) {
  const registryRefusal = validateRegistryShape(registry);
  if (registryRefusal) {
    return registryRefusal;
  }

  try {
    const secret = await loadLauncherRoleGuardSecret(workspaceDir);
    if (!isNonEmptyString(secret)) {
      return refusal(
        FILESYSTEM_MCP_AUTHORITY_BRIDGE_REFUSAL_CODES.ROLE_GUARD_SECRET_MISSING,
        "launcher role-guard secret loaded as an empty value"
      );
    }
  } catch (error) {
    if (error instanceof RoleGuardError && error.code === "launcher_context_secret_missing") {
      return refusal(
        FILESYSTEM_MCP_AUTHORITY_BRIDGE_REFUSAL_CODES.ROLE_GUARD_SECRET_MISSING,
        `launcher role-guard secret unavailable: ${error.message}`
      );
    }
    return refusal(
      FILESYSTEM_MCP_AUTHORITY_BRIDGE_REFUSAL_CODES.ROLE_GUARD_SECRET_MISSING,
      `launcher role-guard secret could not be loaded: ${error?.message ?? error}`
    );
  }

  const authorityResult = resolveFilesystemMcpBackendAuthority({
    registry,
    agentFamily,
    agentProfile,
    agentRole,
    backendKey
  });
  if (!authorityResult.ok) {
    return refusal(
      FILESYSTEM_MCP_AUTHORITY_BRIDGE_REFUSAL_CODES.REGISTRY_BACKEND_MISSING,
      `registry-pinned authority resolution failed: ${authorityResult.refusal.reason}`
    );
  }
  const authority = authorityResult.authority;

  if (authority.mode !== "enforced") {
    return refusal(
      FILESYSTEM_MCP_AUTHORITY_BRIDGE_REFUSAL_CODES.REGISTRY_MODE_NOT_ENFORCED,
      `registry-pinned mode for backend ${authority.backend_key} is ${authority.mode}; only enforced backends may produce an accepted launcher-owned authority context`
    );
  }

  const handshakeTransportSource = authority.handshake_source?.kind;
  if (!AGENT_BACKEND_FILESYSTEM_MCP_HANDSHAKE_TRANSPORT_KINDS.includes(handshakeTransportSource)) {
    return refusal(
      FILESYSTEM_MCP_AUTHORITY_BRIDGE_REFUSAL_CODES.HANDSHAKE_ENDPOINT_MISMATCH,
      `registry-pinned handshake_source.kind ${handshakeTransportSource} is not an accepted launcher-owned transport`
    );
  }

  if (!hasLauncherVerifierCapability(verifierCapability)) {
    return refusal(
      FILESYSTEM_MCP_AUTHORITY_BRIDGE_REFUSAL_CODES.VERIFIER_CAPABILITY_MISSING,
      "verifierCapability must be a loadLauncherVerifierCapability-minted object branded by the in-process WeakSet"
    );
  }

  if (!isPlainObject(resultNonceStore) || typeof resultNonceStore.checkAndMark !== "function") {
    return refusal(
      FILESYSTEM_MCP_AUTHORITY_BRIDGE_REFUSAL_CODES.NONCE_STORE_MALFORMED,
      "resultNonceStore must be a createLauncherContextNonceStore-returned object exposing async checkAndMark(nonce, expires_at)"
    );
  }

  const shapeRefusal = validateHandshakeShape(handshakeResult);
  if (shapeRefusal) {
    return shapeRefusal;
  }

  if (handshakeResult.backend_id !== authority.backend_id) {
    return refusal(
      FILESYSTEM_MCP_AUTHORITY_BRIDGE_REFUSAL_CODES.HANDSHAKE_ENDPOINT_MISMATCH,
      `handshakeResult.backend_id ${handshakeResult.backend_id} does not match registry-pinned backend_id ${authority.backend_id}`
    );
  }
  if (handshakeResult.backend_version !== authority.backend_version) {
    return refusal(
      FILESYSTEM_MCP_AUTHORITY_BRIDGE_REFUSAL_CODES.HANDSHAKE_ENDPOINT_MISMATCH,
      `handshakeResult.backend_version ${handshakeResult.backend_version} does not match registry-pinned backend_version ${authority.backend_version}`
    );
  }
  if (handshakeResult.mode !== "enforced") {
    return refusal(
      FILESYSTEM_MCP_AUTHORITY_BRIDGE_REFUSAL_CODES.REGISTRY_MODE_NOT_ENFORCED,
      `handshakeResult.mode ${handshakeResult.mode} is not enforced; advisory or local handshakes never authorize an accepted launch`
    );
  }
  if (handshakeResult.raw_exec_enabled !== false) {
    return refusal(
      FILESYSTEM_MCP_AUTHORITY_BRIDGE_REFUSAL_CODES.HANDSHAKE_RAW_EXEC_ENABLED,
      "handshakeResult.raw_exec_enabled must be false for filesystem_mcp launches"
    );
  }

  const verification = verifyBackendHandshakeResult({
    capability: verifierCapability,
    result: handshakeResult,
    now
  });
  if (!verification.accepted) {
    const bridgeCode = VERIFIER_REFUSAL_TO_BRIDGE_CODE[verification.refusal_code]
      ?? FILESYSTEM_MCP_AUTHORITY_BRIDGE_REFUSAL_CODES.HANDSHAKE_UNSIGNED_OR_TAMPERED;
    return refusal(
      bridgeCode,
      verification.refusal_message
        ?? `launcher-owned verifier refused handshakeResult (${verification.refusal_code})`
    );
  }

  if (!isNonEmptyString(expectedScopeDigest)) {
    return refusal(
      FILESYSTEM_MCP_AUTHORITY_BRIDGE_REFUSAL_CODES.HANDSHAKE_SCOPE_DIGEST_MISMATCH,
      "expectedScopeDigest is required; the bridge cannot validate handshake scope binding without it"
    );
  }
  if (handshakeResult.scope_digest !== expectedScopeDigest) {
    return refusal(
      FILESYSTEM_MCP_AUTHORITY_BRIDGE_REFUSAL_CODES.HANDSHAKE_SCOPE_DIGEST_MISMATCH,
      `handshakeResult.scope_digest does not match the canonical request scope digest expected by the launcher`
    );
  }

  if (!isPlainObject(expectedToolSurface)) {
    return refusal(
      FILESYSTEM_MCP_AUTHORITY_BRIDGE_REFUSAL_CODES.HANDSHAKE_TOOL_SURFACE_MISMATCH,
      "expectedToolSurface is required; the bridge cannot validate scoped tool-surface enforcement without it"
    );
  }
  if (!canonicalEquals(handshakeResult.tool_surface, expectedToolSurface)) {
    return refusal(
      FILESYSTEM_MCP_AUTHORITY_BRIDGE_REFUSAL_CODES.HANDSHAKE_TOOL_SURFACE_MISMATCH,
      "handshakeResult.tool_surface does not match the launcher-requested scoped tool surface"
    );
  }

  let nonceClaimed;
  try {
    nonceClaimed = await resultNonceStore.checkAndMark(handshakeResult.nonce, handshakeResult.expires_at);
  } catch (error) {
    return refusal(
      FILESYSTEM_MCP_AUTHORITY_BRIDGE_REFUSAL_CODES.NONCE_STORE_MALFORMED,
      `launcher-owned result nonce store raised while marking handshake nonce: ${error?.message ?? error}`
    );
  }
  if (nonceClaimed !== true) {
    return refusal(
      FILESYSTEM_MCP_AUTHORITY_BRIDGE_REFUSAL_CODES.HANDSHAKE_NONCE_REPLAYED,
      "handshake nonce has already been observed by the launcher-owned result store"
    );
  }

  const wrappedNonceStore = wrapResultNonceStoreForAuthorizedHandshake(
    resultNonceStore,
    handshakeResult.nonce,
    handshakeResult.expires_at
  );

  return {
    ok: true,
    value: Object.freeze({
      registry,
      verifierCapability,
      resultNonceStore: wrappedNonceStore,
      handshakeResult,
      handshakeTransportSource
    })
  };
}
