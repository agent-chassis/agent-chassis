
import test from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_BACKEND_FILESYSTEM_MCP_HANDSHAKE_TRANSPORT_KINDS,
  buildFilesystemMcpAuthorityRefusalDecisionV1,
  buildRegistryBackedFilesystemMcpAgentBackendRequestV1,
  normalizeRegistryBackedVerifiedFilesystemMcpAgentBackendDecisionV1,
  resolveFilesystemMcpBackendAuthority
} from "../packages/agent-launch-cli/src/lib/agent-backend.mjs";
import {
  baseSubject,
  baseRequest,
  baseRegistry,
  REGISTRY_BACKEND_KEY,
  REGISTRY_BACKEND_ID,
  REGISTRY_BACKEND_VERSION,
  REGISTRY_PROFILE_FAMILY,
  REGISTRY_PROFILE_NAME
} from "./agent-backend-test-helpers.mjs";

test("resolveFilesystemMcpBackendAuthority returns a pinned authority from a valid registry", () => {
  const registry = baseRegistry();
  const result = resolveFilesystemMcpBackendAuthority({
    registry,
    agentFamily: REGISTRY_PROFILE_FAMILY,
    agentProfile: REGISTRY_PROFILE_NAME,
    agentRole: "worker"
  });
  assert.equal(result.ok, true);
  assert.equal(result.authority.backend_key, REGISTRY_BACKEND_KEY);
  assert.equal(result.authority.backend_id, REGISTRY_BACKEND_ID);
  assert.equal(result.authority.backend_version, REGISTRY_BACKEND_VERSION);
  assert.equal(result.authority.mode, "enforced");
  assert.equal(result.authority.endpoint.kind, "spawn");
  assert.equal(result.authority.handshake_source.kind, "spawn_stdout");
  assert.equal(result.authority.profile_entry.agent_family, REGISTRY_PROFILE_FAMILY);
  assert.equal(result.authority.profile_entry.profile, REGISTRY_PROFILE_NAME);
});

test("resolveFilesystemMcpBackendAuthority refuses missing registry with unavailable.v1", () => {
  const result = resolveFilesystemMcpBackendAuthority({
    registry: null,
    agentFamily: REGISTRY_PROFILE_FAMILY,
    agentProfile: REGISTRY_PROFILE_NAME,
    agentRole: "worker"
  });
  assert.equal(result.ok, false);
  assert.equal(result.refusal.decision_code, "agent_backend.filesystem_mcp.unavailable.v1");
});

test("resolveFilesystemMcpBackendAuthority refuses empty filesystem_mcp_backends with unavailable.v1", () => {
  const registry = baseRegistry({
    mutateData: (data) => {
      data.filesystem_mcp_backends = {};
    }
  });
  const result = resolveFilesystemMcpBackendAuthority({
    registry,
    agentFamily: REGISTRY_PROFILE_FAMILY,
    agentProfile: REGISTRY_PROFILE_NAME,
    agentRole: "worker"
  });
  assert.equal(result.ok, false);
  assert.equal(result.refusal.decision_code, "agent_backend.filesystem_mcp.unavailable.v1");
});

test("resolveFilesystemMcpBackendAuthority refuses unknown default backend with misconfigured.v1", () => {
  const registry = baseRegistry({
    mutateData: (data) => {
      data.filesystem_mcp_backend_default = "no-such-backend";
    }
  });
  const result = resolveFilesystemMcpBackendAuthority({
    registry,
    agentFamily: REGISTRY_PROFILE_FAMILY,
    agentProfile: REGISTRY_PROFILE_NAME,
    agentRole: "worker"
  });
  assert.equal(result.ok, false);
  assert.equal(result.refusal.decision_code, "agent_backend.filesystem_mcp.misconfigured.v1");
});

test("resolveFilesystemMcpBackendAuthority refuses schema-invalid entry with misconfigured.v1", () => {
  const registry = baseRegistry({
    mutateData: (data) => {
      delete data.filesystem_mcp_backends[REGISTRY_BACKEND_KEY].backend_id;
    }
  });
  const result = resolveFilesystemMcpBackendAuthority({
    registry,
    agentFamily: REGISTRY_PROFILE_FAMILY,
    agentProfile: REGISTRY_PROFILE_NAME,
    agentRole: "worker"
  });
  assert.equal(result.ok, false);
  assert.equal(result.refusal.decision_code, "agent_backend.filesystem_mcp.misconfigured.v1");
});

test("resolveFilesystemMcpBackendAuthority refuses unsupported endpoint kind with misconfigured.v1", () => {
  const registry = baseRegistry({
    mutateData: (data) => {
      data.filesystem_mcp_backends[REGISTRY_BACKEND_KEY].endpoint = { kind: "http", url: "http://forged" };
    }
  });
  const result = resolveFilesystemMcpBackendAuthority({
    registry,
    agentFamily: REGISTRY_PROFILE_FAMILY,
    agentProfile: REGISTRY_PROFILE_NAME,
    agentRole: "worker"
  });
  assert.equal(result.ok, false);
  assert.equal(result.refusal.decision_code, "agent_backend.filesystem_mcp.misconfigured.v1");
});

test("resolveFilesystemMcpBackendAuthority refuses unsupported handshake_source kind with misconfigured.v1", () => {
  const registry = baseRegistry({
    mutateData: (data) => {
      data.filesystem_mcp_backends[REGISTRY_BACKEND_KEY].handshake_source = { kind: "env_path" };
    }
  });
  const result = resolveFilesystemMcpBackendAuthority({
    registry,
    agentFamily: REGISTRY_PROFILE_FAMILY,
    agentProfile: REGISTRY_PROFILE_NAME,
    agentRole: "worker"
  });
  assert.equal(result.ok, false);
  assert.equal(result.refusal.decision_code, "agent_backend.filesystem_mcp.misconfigured.v1");
});

test("resolveFilesystemMcpBackendAuthority distinguishes unsupported agent family from unsupported profile and unsupported role", () => {
  const registry = baseRegistry();

  const unsupportedFamily = resolveFilesystemMcpBackendAuthority({
    registry,
    agentFamily: "gemini",
    agentProfile: REGISTRY_PROFILE_NAME,
    agentRole: "worker"
  });
  assert.equal(unsupportedFamily.ok, false);
  assert.equal(
    unsupportedFamily.refusal.decision_code,
    "agent_backend.profile.unsupported_agent_family.v1"
  );

  const unsupportedProfile = resolveFilesystemMcpBackendAuthority({
    registry,
    agentFamily: REGISTRY_PROFILE_FAMILY,
    agentProfile: "not-registered",
    agentRole: "worker"
  });
  assert.equal(unsupportedProfile.ok, false);
  assert.equal(
    unsupportedProfile.refusal.decision_code,
    "agent_backend.profile.unsupported_agent_profile.v1"
  );

  const familyOnly = baseRegistry({
    mutateData: (data) => {
      data.filesystem_mcp_backends[REGISTRY_BACKEND_KEY].supported_profiles = [
        {
          agent_family: REGISTRY_PROFILE_FAMILY,
          profile: REGISTRY_PROFILE_NAME,
          roles: ["worker"]
        }
      ];
    }
  });
  const unsupportedRole = resolveFilesystemMcpBackendAuthority({
    registry: familyOnly,
    agentFamily: REGISTRY_PROFILE_FAMILY,
    agentProfile: REGISTRY_PROFILE_NAME,
    agentRole: "redteam"
  });
  assert.equal(unsupportedRole.ok, false);
  assert.equal(
    unsupportedRole.refusal.decision_code,
    "agent_backend.profile.unsupported_agent_profile.v1"
  );
});

test("buildRegistryBackedFilesystemMcpAgentBackendRequestV1 pins agent.family and agent.profile to authority and refuses request-payload overrides", () => {
  const authority = resolveFilesystemMcpBackendAuthority({
    registry: baseRegistry(),
    agentFamily: REGISTRY_PROFILE_FAMILY,
    agentProfile: REGISTRY_PROFILE_NAME,
    agentRole: "worker"
  }).authority;

  const request = buildRegistryBackedFilesystemMcpAgentBackendRequestV1(authority, {
    subject: baseSubject(),
    agent: { role: "worker" },
    scope: baseRequest().scope,
    validation: baseRequest().validation,
    environment_policy: baseRequest().environment_policy,
    provenance_destination: baseRequest().provenance_destination,
    tools: {
      raw_exec_enabled: false,
      filesystem_mcp: { read: true, write: true, structured_validation: true, final_report: true }
    }
  });
  assert.equal(request.backend_kind, "filesystem_mcp");
  assert.equal(request.agent.family, REGISTRY_PROFILE_FAMILY);
  assert.equal(request.agent.profile, REGISTRY_PROFILE_NAME);
  assert.equal(request.tools.raw_exec_enabled, false);

  assert.throws(
    () =>
      buildRegistryBackedFilesystemMcpAgentBackendRequestV1(authority, {
        subject: baseSubject(),
        agent: { role: "worker", family: "gemini" },
        scope: baseRequest().scope,
        validation: baseRequest().validation,
        environment_policy: baseRequest().environment_policy,
        provenance_destination: baseRequest().provenance_destination,
        tools: { raw_exec_enabled: false }
      }),
    /agent\.family/
  );

  assert.throws(
    () =>
      buildRegistryBackedFilesystemMcpAgentBackendRequestV1(authority, {
        subject: baseSubject(),
        backend_id: "forged-id",
        agent: { role: "worker" },
        scope: baseRequest().scope,
        validation: baseRequest().validation,
        environment_policy: baseRequest().environment_policy,
        provenance_destination: baseRequest().provenance_destination,
        tools: { raw_exec_enabled: false }
      }),
    /backend_id is registry-owned/
  );
});

test("buildFilesystemMcpAuthorityRefusalDecisionV1 produces a refusal decision from a resolver refusal", () => {
  const refusal = {
    decision_code: "agent_backend.filesystem_mcp.unavailable.v1",
    severity: "error",
    reason: "launcher registry is missing"
  };
  const decision = buildFilesystemMcpAuthorityRefusalDecisionV1(refusal);
  assert.equal(decision.allowed, false);
  assert.equal(decision.backend_kind, "filesystem_mcp");
  assert.equal(decision.decision_code, refusal.decision_code);
  assert.equal(decision.reason, refusal.reason);
  assert.equal(decision.severity, "error");
});

test("AGENT_BACKEND_FILESYSTEM_MCP_HANDSHAKE_TRANSPORT_KINDS lists only the two launcher-owned transports", () => {
  assert.deepEqual(
    [...AGENT_BACKEND_FILESYSTEM_MCP_HANDSHAKE_TRANSPORT_KINDS],
    ["spawn_stdout", "unix_socket_reply"]
  );
});

test("normalizeRegistryBackedVerifiedFilesystemMcpAgentBackendDecisionV1 preserves refusal-shaped inputs without contacting the verifier", async () => {
  const authority = resolveFilesystemMcpBackendAuthority({
    registry: baseRegistry(),
    agentFamily: REGISTRY_PROFILE_FAMILY,
    agentProfile: REGISTRY_PROFILE_NAME,
    agentRole: "worker"
  }).authority;
  const request = buildRegistryBackedFilesystemMcpAgentBackendRequestV1(authority, {
    subject: baseSubject(),
    agent: { role: "worker" },
    scope: baseRequest().scope,
    validation: baseRequest().validation,
    environment_policy: baseRequest().environment_policy,
    provenance_destination: baseRequest().provenance_destination,
    tools: { raw_exec_enabled: false }
  });

  const refused = await normalizeRegistryBackedVerifiedFilesystemMcpAgentBackendDecisionV1({
    authority,
    allowed: false,
    decision_code: "agent_backend.profile.unsupported_agent_profile.v1",
    severity: "error",
    effect: "blocks_launch",
    reason: "profile gated by registry",
    request,
    provenance: { scope_digest: "sha256:filesystem-mcp-scope-digest" }
  });
  assert.equal(refused.ok, true);
  assert.equal(refused.value.allowed, false);
  assert.equal(refused.value.backend_id, REGISTRY_BACKEND_ID);
  assert.equal(refused.value.backend_version, REGISTRY_BACKEND_VERSION);
  assert.equal(refused.value.mode, "enforced");
});
