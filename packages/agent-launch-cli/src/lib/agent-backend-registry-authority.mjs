

import {
  AGENT_BACKEND_DECISION_SCHEMA_VERSION,
  AGENT_BACKEND_FILESYSTEM_MCP_REGISTRY_MODES,
  AGENT_BACKEND_FILESYSTEM_MCP_ENDPOINT_KINDS,
  AGENT_BACKEND_FILESYSTEM_MCP_HANDSHAKE_TRANSPORT_KINDS,
  DEFAULT_FILESYSTEM_MCP_BACKEND_ID,
  DEFAULT_FILESYSTEM_MCP_BACKEND_VERSION
} from "./agent-backend-constants.mjs";
import {
  cloneJson,
  isObject,
  isNonEmptyString,
  createDiagnostic,
  buildOrThrow
} from "./agent-backend-primitives.mjs";
import { buildFilesystemMcpAgentBackendRequestV1 } from "./agent-backend-request.mjs";
import {
  buildAgentBackendDecisionV1,
  normalizeAgentBackendDecisionV1,
  normalizeVerifiedAgentBackendDecisionV1
} from "./agent-backend-decision.mjs";

const REGISTRY_ROLE_TO_PROFILE_ROLE = Object.freeze({
  worker: "worker",
  reviewer: "code_review",
  redteam: "redteam"
});

function refusalAuthority(decisionCode, reason) {
  return {
    ok: false,
    refusal: {
      decision_code: decisionCode,
      severity: "error",
      reason
    }
  };
}

export function resolveFilesystemMcpBackendAuthority({
  registry,
  agentFamily,
  agentProfile,
  agentRole,
  backendKey
} = {}) {
  if (!isObject(registry)) {
    return refusalAuthority(
      "agent_backend.filesystem_mcp.unavailable.v1",
      "launcher registry is missing; run agent-launch init-config before requesting a filesystem_mcp launch"
    );
  }

  const data = isObject(registry.data) ? registry.data : null;
  if (!data) {
    return refusalAuthority(
      "agent_backend.filesystem_mcp.unavailable.v1",
      "launcher registry payload is missing the .data envelope"
    );
  }

  const backends = isObject(data.filesystem_mcp_backends) ? data.filesystem_mcp_backends : null;
  if (!backends || Object.keys(backends).length === 0) {
    return refusalAuthority(
      "agent_backend.filesystem_mcp.unavailable.v1",
      "launcher registry has no filesystem_mcp_backends configured"
    );
  }

  const resolvedKey = isNonEmptyString(backendKey)
    ? backendKey.trim()
    : isNonEmptyString(data.filesystem_mcp_backend_default)
      ? data.filesystem_mcp_backend_default.trim()
      : null;
  if (!resolvedKey) {
    return refusalAuthority(
      "agent_backend.filesystem_mcp.misconfigured.v1",
      "launcher registry filesystem_mcp_backend_default is missing or empty"
    );
  }
  if (!Object.prototype.hasOwnProperty.call(backends, resolvedKey)) {
    return refusalAuthority(
      "agent_backend.filesystem_mcp.misconfigured.v1",
      `launcher registry filesystem_mcp_backends has no entry for ${resolvedKey}`
    );
  }

  const entry = backends[resolvedKey];
  if (!isObject(entry)) {
    return refusalAuthority(
      "agent_backend.filesystem_mcp.misconfigured.v1",
      `launcher registry filesystem_mcp_backends.${resolvedKey} must be an object`
    );
  }
  if (!isNonEmptyString(entry.backend_id)) {
    return refusalAuthority(
      "agent_backend.filesystem_mcp.misconfigured.v1",
      `launcher registry filesystem_mcp_backends.${resolvedKey}.backend_id must be a non-empty string`
    );
  }
  if (!isNonEmptyString(entry.backend_version)) {
    return refusalAuthority(
      "agent_backend.filesystem_mcp.misconfigured.v1",
      `launcher registry filesystem_mcp_backends.${resolvedKey}.backend_version must be a non-empty string`
    );
  }
  if (!AGENT_BACKEND_FILESYSTEM_MCP_REGISTRY_MODES.includes(entry.mode)) {
    return refusalAuthority(
      "agent_backend.filesystem_mcp.misconfigured.v1",
      `launcher registry filesystem_mcp_backends.${resolvedKey}.mode must be advisory or enforced`
    );
  }
  if (!isObject(entry.endpoint) || !AGENT_BACKEND_FILESYSTEM_MCP_ENDPOINT_KINDS.includes(entry.endpoint.kind)) {
    return refusalAuthority(
      "agent_backend.filesystem_mcp.misconfigured.v1",
      `launcher registry filesystem_mcp_backends.${resolvedKey}.endpoint.kind is unsupported (must be spawn or unix_socket)`
    );
  }
  if (
    !isObject(entry.handshake_source)
    || !AGENT_BACKEND_FILESYSTEM_MCP_HANDSHAKE_TRANSPORT_KINDS.includes(entry.handshake_source.kind)
  ) {
    return refusalAuthority(
      "agent_backend.filesystem_mcp.misconfigured.v1",
      `launcher registry filesystem_mcp_backends.${resolvedKey}.handshake_source.kind is unsupported (must be spawn_stdout or unix_socket_reply)`
    );
  }
  if (!Array.isArray(entry.supported_profiles) || entry.supported_profiles.length === 0) {
    return refusalAuthority(
      "agent_backend.filesystem_mcp.misconfigured.v1",
      `launcher registry filesystem_mcp_backends.${resolvedKey}.supported_profiles must be a non-empty array`
    );
  }

  let childMount = null;
  if (entry.child_mount !== undefined && entry.child_mount !== null) {
    const candidate = entry.child_mount;
    if (!isObject(candidate)) {
      return refusalAuthority(
        "agent_backend.filesystem_mcp.misconfigured.v1",
        `launcher registry filesystem_mcp_backends.${resolvedKey}.child_mount must be an object`
      );
    }
    if (candidate.transport !== "stdio") {
      return refusalAuthority(
        "agent_backend.filesystem_mcp.misconfigured.v1",
        `launcher registry filesystem_mcp_backends.${resolvedKey}.child_mount.transport must be stdio`
      );
    }
    if (!isNonEmptyString(candidate.command)) {
      return refusalAuthority(
        "agent_backend.filesystem_mcp.misconfigured.v1",
        `launcher registry filesystem_mcp_backends.${resolvedKey}.child_mount.command must be a non-empty string`
      );
    }
    if (!Array.isArray(candidate.args) || candidate.args.some((entryArg) => typeof entryArg !== "string")) {
      return refusalAuthority(
        "agent_backend.filesystem_mcp.misconfigured.v1",
        `launcher registry filesystem_mcp_backends.${resolvedKey}.child_mount.args must be an array of strings`
      );
    }
    if (candidate.env !== undefined && candidate.env !== null) {
      if (!isObject(candidate.env)) {
        return refusalAuthority(
          "agent_backend.filesystem_mcp.misconfigured.v1",
          `launcher registry filesystem_mcp_backends.${resolvedKey}.child_mount.env must be an object of string values`
        );
      }
      for (const [envKey, envValue] of Object.entries(candidate.env)) {
        if (!isNonEmptyString(envKey) || typeof envValue !== "string") {
          return refusalAuthority(
            "agent_backend.filesystem_mcp.misconfigured.v1",
            `launcher registry filesystem_mcp_backends.${resolvedKey}.child_mount.env entries must be string key/value pairs`
          );
        }
      }
    }
    childMount = cloneJson(candidate);
  }

  const family = isNonEmptyString(agentFamily) ? agentFamily.trim() : null;
  const profile = isNonEmptyString(agentProfile) ? agentProfile.trim() : null;
  const role = isNonEmptyString(agentRole) ? agentRole.trim() : null;
  if (!family || !profile || !role) {
    return refusalAuthority(
      "agent_backend.filesystem_mcp.misconfigured.v1",
      "agentFamily, agentProfile, and agentRole are required to resolve registry authority"
    );
  }
  const registryRole = REGISTRY_ROLE_TO_PROFILE_ROLE[role];
  if (!registryRole) {
    return refusalAuthority(
      "agent_backend.profile.unsupported_agent_profile.v1",
      `agentRole ${role} is not a recognized backend role`
    );
  }

  const familyEntries = entry.supported_profiles.filter((row) => isObject(row) && row.agent_family === family);
  if (familyEntries.length === 0) {
    return refusalAuthority(
      "agent_backend.profile.unsupported_agent_family.v1",
      `launcher registry filesystem_mcp_backends.${resolvedKey} does not support agent family ${family}`
    );
  }
  const matchingProfile = familyEntries.find((row) => row.profile === profile);
  if (!matchingProfile) {
    return refusalAuthority(
      "agent_backend.profile.unsupported_agent_profile.v1",
      `launcher registry filesystem_mcp_backends.${resolvedKey} does not register profile ${profile} for agent family ${family}`
    );
  }
  if (!Array.isArray(matchingProfile.roles) || !matchingProfile.roles.includes(registryRole)) {
    return refusalAuthority(
      "agent_backend.profile.unsupported_agent_profile.v1",
      `launcher registry filesystem_mcp_backends.${resolvedKey} does not register role ${role} for ${family}/${profile}`
    );
  }

  return {
    ok: true,
    authority: {
      backend_key: resolvedKey,
      backend_id: entry.backend_id,
      backend_version: entry.backend_version,
      mode: entry.mode,
      endpoint: cloneJson(entry.endpoint),
      handshake_source: cloneJson(entry.handshake_source),
      child_mount: childMount,
      profile_entry: {
        agent_family: family,
        profile,
        roles: [...matchingProfile.roles]
      }
    }
  };
}

export function buildFilesystemMcpAuthorityRefusalDecisionV1(refusal, { request = null, remediation = null, authority = null } = {}) {
  if (!isObject(refusal) || !isNonEmptyString(refusal.decision_code) || !isNonEmptyString(refusal.reason)) {
    throw new Error("buildFilesystemMcpAuthorityRefusalDecisionV1 requires a refusal with decision_code and reason");
  }
  const requestSnapshot = isObject(request) ? cloneJson(request) : null;
  return buildAgentBackendDecisionV1({
    backend_kind: "filesystem_mcp",
    backend_id: isNonEmptyString(authority?.backend_id) ? authority.backend_id : DEFAULT_FILESYSTEM_MCP_BACKEND_ID,
    backend_version: isNonEmptyString(authority?.backend_version) ? authority.backend_version : DEFAULT_FILESYSTEM_MCP_BACKEND_VERSION,
    mode: isNonEmptyString(authority?.mode) ? authority.mode : "enforced",
    allowed: false,
    decision_code: refusal.decision_code,
    severity: refusal.severity ?? "error",
    effect: "blocks_launch",
    reason: refusal.reason,
    remediation: isNonEmptyString(remediation) ? remediation : null,
    run_id: null,
    request: requestSnapshot,
    provenance: {
      normalized_input_digest: null,
      scope_digest: null,
      profile: requestSnapshot?.agent?.profile ?? null,
      model: requestSnapshot?.agent?.model ?? null,
      raw_exec_enabled: false
    }
  });
}

function guardRegistryOwnedFields(input, ownedFields, label) {
  for (const field of ownedFields) {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      throw new Error(`${label}: ${field} is registry-owned; do not supply it via input`);
    }
  }
}

export function buildRegistryBackedFilesystemMcpAgentBackendRequestV1(authority, input = {}) {
  if (!isObject(authority) || !isNonEmptyString(authority.backend_id) || !isObject(authority.profile_entry)) {
    throw new Error("buildRegistryBackedFilesystemMcpAgentBackendRequestV1 requires a resolved registry authority");
  }
  if (!isObject(input)) {
    throw new Error("buildRegistryBackedFilesystemMcpAgentBackendRequestV1 requires an input object");
  }
  guardRegistryOwnedFields(
    input,
    ["backend_id", "backendId", "backend_version", "backendVersion", "endpoint", "handshake_source"],
    "registry-backed request"
  );
  if (Object.prototype.hasOwnProperty.call(input, "backend_kind") && input.backend_kind !== "filesystem_mcp") {
    throw new Error("registry-backed request: backend_kind is pinned to filesystem_mcp");
  }

  const agentInput = isObject(input.agent) ? input.agent : {};
  if (
    isNonEmptyString(agentInput.family)
    && agentInput.family.trim() !== authority.profile_entry.agent_family
  ) {
    throw new Error(
      `registry-backed request: agent.family ${agentInput.family} does not match registry authority family ${authority.profile_entry.agent_family}`
    );
  }
  if (
    isNonEmptyString(agentInput.profile)
    && agentInput.profile.trim() !== authority.profile_entry.profile
  ) {
    throw new Error(
      `registry-backed request: agent.profile ${agentInput.profile} does not match registry authority profile ${authority.profile_entry.profile}`
    );
  }

  return buildFilesystemMcpAgentBackendRequestV1({
    ...input,
    agent: {
      ...agentInput,
      family: authority.profile_entry.agent_family,
      profile: authority.profile_entry.profile
    }
  });
}

function buildAllowedDecisionInputFromAuthority(authority, input) {
  const baseProvenance = isObject(input.provenance) ? { ...input.provenance } : {};
  if (!isNonEmptyString(baseProvenance.profile)) {
    baseProvenance.profile = authority.profile_entry.profile;
  }
  if (baseProvenance.raw_exec_enabled === undefined) {
    baseProvenance.raw_exec_enabled = false;
  }
  return {
    ...input,
    backend_kind: "filesystem_mcp",
    backend_id: authority.backend_id,
    backend_version: authority.backend_version,
    mode: authority.mode,
    allowed: true,
    provenance: baseProvenance
  };
}

export async function normalizeRegistryBackedVerifiedFilesystemMcpAgentBackendDecisionV1(input = {}, options = {}) {
  if (!isObject(input)) {
    return {
      ok: false,
      diagnostics: [createDiagnostic("invalid_agent_backend_input", "registry-backed decision input must be an object", "input")]
    };
  }
  const { authority, handshake_transport_source: handshakeTransportSource, ...rest } = input;
  if (!isObject(authority) || !isNonEmptyString(authority.backend_id) || !isObject(authority.handshake_source)) {
    return {
      ok: false,
      diagnostics: [createDiagnostic("invalid_agent_backend_input", "registry-backed decision input requires a resolved authority", "authority")]
    };
  }
  guardRegistryOwnedFields(
    rest,
    ["backend_id", "backendId", "backend_version", "backendVersion"],
    "registry-backed decision"
  );

  const request = isObject(rest.request) ? rest.request : null;

  if (rest.allowed === true || rest.decision === "allow" || rest.action === "allow") {
    if (!isNonEmptyString(handshakeTransportSource)) {
      return {
        ok: true,
        diagnostics: [],
        value: buildFilesystemMcpAuthorityRefusalDecisionV1(
          {
            decision_code: "agent_backend.filesystem_mcp.misconfigured.v1",
            reason: "filesystem_mcp allowed decisions require an explicit handshake_transport_source identifying the launcher-owned transport"
          },
          { request, authority }
        )
      };
    }
    const trimmedSource = handshakeTransportSource.trim();
    if (!AGENT_BACKEND_FILESYSTEM_MCP_HANDSHAKE_TRANSPORT_KINDS.includes(trimmedSource)) {
      return {
        ok: true,
        diagnostics: [],
        value: buildFilesystemMcpAuthorityRefusalDecisionV1(
          {
            decision_code: "agent_backend.filesystem_mcp.misconfigured.v1",
            reason: `handshake_transport_source ${trimmedSource} is not a launcher-owned transport; inherited env paths, wrapper-injected same-process JSON, and request-derivable digests are refused before any allowed.v1 decision`
          },
          { request, authority }
        )
      };
    }
    if (trimmedSource !== authority.handshake_source.kind) {
      return {
        ok: true,
        diagnostics: [],
        value: buildFilesystemMcpAuthorityRefusalDecisionV1(
          {
            decision_code: "agent_backend.filesystem_mcp.misconfigured.v1",
            reason: `handshake_transport_source ${trimmedSource} does not match registry-pinned handshake_source.kind ${authority.handshake_source.kind}`
          },
          { request, authority }
        )
      };
    }
    if (authority.mode !== "enforced") {
      return {
        ok: true,
        diagnostics: [],
        value: buildFilesystemMcpAuthorityRefusalDecisionV1(
          {
            decision_code: "agent_backend.filesystem_mcp.misconfigured.v1",
            reason: `registry-pinned mode for backend ${authority.backend_key} is ${authority.mode}; allowed.v1 decisions require enforced mode`
          },
          { request, authority }
        )
      };
    }
    return normalizeVerifiedAgentBackendDecisionV1(
      buildAllowedDecisionInputFromAuthority(authority, rest),
      options
    );
  }

  const refusalInput = {
    ...rest,
    backend_kind: "filesystem_mcp",
    backend_id: authority.backend_id,
    backend_version: authority.backend_version,
    mode: authority.mode
  };
  return normalizeAgentBackendDecisionV1(refusalInput);
}

export async function buildRegistryBackedVerifiedFilesystemMcpAgentBackendDecisionV1(input = {}, options = {}) {
  const result = await normalizeRegistryBackedVerifiedFilesystemMcpAgentBackendDecisionV1(input, options);
  return buildOrThrow(result, AGENT_BACKEND_DECISION_SCHEMA_VERSION);
}
