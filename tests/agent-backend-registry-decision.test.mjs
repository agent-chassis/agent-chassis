
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRegistryBackedFilesystemMcpAgentBackendRequestV1,
  buildRegistryBackedVerifiedFilesystemMcpAgentBackendDecisionV1,
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
  REGISTRY_PROFILE_NAME,
  loadVerifierFixture,
  issueVerifiedHandshake
} from "./agent-backend-test-helpers.mjs";

const FORGED_FILESYSTEM_MCP_ENV_KEYS = Object.freeze([
  "AGENT_LAUNCH_FILESYSTEM_MCP_BACKEND_ID",
  "AGENT_LAUNCH_FILESYSTEM_MCP_BACKEND_VERSION",
  "AGENT_LAUNCH_FILESYSTEM_MCP_ENDPOINT",
  "AGENT_LAUNCH_FILESYSTEM_MCP_MODE",
  "AGENT_LAUNCH_FILESYSTEM_MCP_PROFILE",
  "AGENT_LAUNCH_FILESYSTEM_MCP_ALLOWED",
  "AGENT_LAUNCH_FILESYSTEM_MCP_HANDSHAKE_PATH",
  "AGENT_LAUNCH_FILESYSTEM_MCP_HANDSHAKE_FILE",
  "AGENT_LAUNCH_FILESYSTEM_MCP_HANDSHAKE_DIGEST",
  "AGENT_LAUNCH_FILESYSTEM_MCP_BACKEND_VERIFIED"
]);

const FORGED_ENV_VALUES = Object.freeze({
  AGENT_LAUNCH_FILESYSTEM_MCP_BACKEND_ID: "forged.attacker-backend.id",
  AGENT_LAUNCH_FILESYSTEM_MCP_BACKEND_VERSION: "9.9.9-forged",
  AGENT_LAUNCH_FILESYSTEM_MCP_ENDPOINT: "spawn:/usr/local/bin/forged-backend",
  AGENT_LAUNCH_FILESYSTEM_MCP_MODE: "enforced",
  AGENT_LAUNCH_FILESYSTEM_MCP_PROFILE: "forged-profile",
  AGENT_LAUNCH_FILESYSTEM_MCP_ALLOWED: "true",
  AGENT_LAUNCH_FILESYSTEM_MCP_HANDSHAKE_PATH: "/tmp/forged-handshake.json",
  AGENT_LAUNCH_FILESYSTEM_MCP_HANDSHAKE_FILE: "/tmp/forged-handshake.json",
  AGENT_LAUNCH_FILESYSTEM_MCP_HANDSHAKE_DIGEST: "sha256:forged-handshake-digest",
  AGENT_LAUNCH_FILESYSTEM_MCP_BACKEND_VERIFIED: "true"
});

function withForgedEnv(callback) {
  const previous = {};
  for (const key of FORGED_FILESYSTEM_MCP_ENV_KEYS) {
    previous[key] = process.env[key];
    process.env[key] = FORGED_ENV_VALUES[key];
  }
  try {
    return callback();
  } finally {
    for (const key of FORGED_FILESYSTEM_MCP_ENV_KEYS) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
  }
}

async function withForgedEnvAsync(callback) {
  const previous = {};
  for (const key of FORGED_FILESYSTEM_MCP_ENV_KEYS) {
    previous[key] = process.env[key];
    process.env[key] = FORGED_ENV_VALUES[key];
  }
  try {
    return await callback();
  } finally {
    for (const key of FORGED_FILESYSTEM_MCP_ENV_KEYS) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
  }
}

test("forged *_FILESYSTEM_MCP_* env variables do not change registry-backed backend identity, endpoint, mode, profile, allowed status, or accepted handshake digest", async () => {
  const registry = baseRegistry();

  function buildPair() {
    const authority = resolveFilesystemMcpBackendAuthority({
      registry,
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
      },
      evidence: { scope_digest: "sha256:filesystem-mcp-scope-digest" }
    });
    return { authority, request };
  }

  const baseline = buildPair();
  const forged = withForgedEnv(() => buildPair());

  assert.deepEqual(forged.authority, baseline.authority, "authority must be identical with forged env");
  assert.deepEqual(forged.request, baseline.request, "request must be identical with forged env");
  assert.notEqual(forged.authority.backend_id, FORGED_ENV_VALUES.AGENT_LAUNCH_FILESYSTEM_MCP_BACKEND_ID);
  assert.notEqual(forged.authority.backend_version, FORGED_ENV_VALUES.AGENT_LAUNCH_FILESYSTEM_MCP_BACKEND_VERSION);
  assert.notEqual(forged.authority.profile_entry.profile, FORGED_ENV_VALUES.AGENT_LAUNCH_FILESYSTEM_MCP_PROFILE);

  const scopeDigest = "sha256:filesystem-mcp-scope-digest";
  const fixture = await loadVerifierFixture();
  try {
    async function buildDecisionPair() {
      const { authority, request } = buildPair();
      const handshake = await issueVerifiedHandshake({
        capability: fixture.capability,
        request,
        scopeDigest
      });
      const decision = await buildRegistryBackedVerifiedFilesystemMcpAgentBackendDecisionV1(
        {
          authority,
          allowed: true,
          request,
          handshake,
          handshake_transport_source: authority.handshake_source.kind,
          provenance: { scope_digest: scopeDigest }
        },
        {
          verifierCapability: fixture.capability,
          nonceStore: fixture.resultNonceStore
        }
      );
      return { decision, acceptedHandshakeDigest: decision.accepted_handshake_digest };
    }

    const baselineDecision = await buildDecisionPair();
    const forgedDecision = await withForgedEnvAsync(() => buildDecisionPair());

    assert.equal(baselineDecision.decision.allowed, true);
    assert.equal(forgedDecision.decision.allowed, true);
    assert.equal(forgedDecision.decision.backend_id, REGISTRY_BACKEND_ID);
    assert.equal(forgedDecision.decision.backend_version, REGISTRY_BACKEND_VERSION);
    assert.equal(forgedDecision.decision.mode, "enforced");
    assert.equal(forgedDecision.decision.provenance.profile, REGISTRY_PROFILE_NAME);
    assert.notEqual(
      forgedDecision.acceptedHandshakeDigest,
      FORGED_ENV_VALUES.AGENT_LAUNCH_FILESYSTEM_MCP_HANDSHAKE_DIGEST
    );
    assert.notEqual(forgedDecision.acceptedHandshakeDigest, null);
    assert.notEqual(forgedDecision.acceptedHandshakeDigest, undefined);
  } finally {
    await fixture.cleanup();
  }
});

test("registry-backed allowed decisions refuse missing, unknown, and mismatched handshake_transport_source before any allowed.v1 decision", async () => {
  const registry = baseRegistry();
  const authority = resolveFilesystemMcpBackendAuthority({
    registry,
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
    },
    evidence: { scope_digest: "sha256:filesystem-mcp-scope-digest" }
  });

  const scopeDigest = "sha256:filesystem-mcp-scope-digest";
  const fixture = await loadVerifierFixture();
  try {
    const handshake = await issueVerifiedHandshake({
      capability: fixture.capability,
      request,
      scopeDigest
    });

    const missingTransport = await buildRegistryBackedVerifiedFilesystemMcpAgentBackendDecisionV1(
      {
        authority,
        allowed: true,
        request,
        handshake,
        provenance: { scope_digest: scopeDigest }
      },
      {
        verifierCapability: fixture.capability,
        nonceStore: fixture.resultNonceStore
      }
    );
    assert.equal(missingTransport.allowed, false);
    assert.equal(missingTransport.decision_code, "agent_backend.filesystem_mcp.misconfigured.v1");
    assert.equal(missingTransport.backend_id, REGISTRY_BACKEND_ID);
    assert.equal(missingTransport.backend_version, REGISTRY_BACKEND_VERSION);
    assert.equal(missingTransport.mode, "enforced");
    assert.match(missingTransport.reason, /handshake_transport_source/);

    for (const untrusted of ["env_path", "wrapper_injected_json", "request_derivable_digest"]) {
      const refused = await buildRegistryBackedVerifiedFilesystemMcpAgentBackendDecisionV1(
        {
          authority,
          allowed: true,
          request,
          handshake,
          handshake_transport_source: untrusted,
          provenance: { scope_digest: scopeDigest }
        },
        {
          verifierCapability: fixture.capability,
          nonceStore: fixture.resultNonceStore
        }
      );
      assert.equal(refused.allowed, false, `untrusted transport ${untrusted} must refuse`);
      assert.equal(refused.backend_id, REGISTRY_BACKEND_ID);
      assert.equal(refused.backend_version, REGISTRY_BACKEND_VERSION);
      assert.equal(refused.mode, "enforced");
      assert.equal(
        refused.decision_code,
        "agent_backend.filesystem_mcp.misconfigured.v1",
        `untrusted transport ${untrusted} must refuse with misconfigured.v1`
      );
      assert.equal(refused.accepted_handshake_digest, null);
    }

    const mismatched = await buildRegistryBackedVerifiedFilesystemMcpAgentBackendDecisionV1(
      {
        authority,
        allowed: true,
        request,
        handshake,
        handshake_transport_source: "unix_socket_reply",
        provenance: { scope_digest: scopeDigest }
      },
      {
        verifierCapability: fixture.capability,
        nonceStore: fixture.resultNonceStore
      }
    );
    assert.equal(mismatched.allowed, false);
    assert.equal(mismatched.decision_code, "agent_backend.filesystem_mcp.misconfigured.v1");
    assert.equal(mismatched.backend_id, REGISTRY_BACKEND_ID);
    assert.equal(mismatched.backend_version, REGISTRY_BACKEND_VERSION);
    assert.equal(mismatched.mode, "enforced");
    assert.match(mismatched.reason, /does not match registry-pinned/);
  } finally {
    await fixture.cleanup();
  }
});

test("registry-backed allowed decisions refuse when authority mode is advisory", async () => {
  const advisoryRegistry = baseRegistry({
    mutateData: (data) => {
      data.filesystem_mcp_backends[REGISTRY_BACKEND_KEY].mode = "advisory";
    }
  });
  const authority = resolveFilesystemMcpBackendAuthority({
    registry: advisoryRegistry,
    agentFamily: REGISTRY_PROFILE_FAMILY,
    agentProfile: REGISTRY_PROFILE_NAME,
    agentRole: "worker"
  }).authority;
  assert.equal(authority.mode, "advisory");

  const request = buildRegistryBackedFilesystemMcpAgentBackendRequestV1(authority, {
    subject: baseSubject(),
    agent: { role: "worker" },
    scope: baseRequest().scope,
    validation: baseRequest().validation,
    environment_policy: baseRequest().environment_policy,
    provenance_destination: baseRequest().provenance_destination,
    tools: { raw_exec_enabled: false }
  });

  const decision = await buildRegistryBackedVerifiedFilesystemMcpAgentBackendDecisionV1({
    authority,
    allowed: true,
    request,
    handshake_transport_source: authority.handshake_source.kind,
    provenance: { scope_digest: "sha256:filesystem-mcp-scope-digest" }
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.decision_code, "agent_backend.filesystem_mcp.misconfigured.v1");
  assert.equal(decision.backend_id, REGISTRY_BACKEND_ID);
  assert.equal(decision.backend_version, REGISTRY_BACKEND_VERSION);
  assert.equal(decision.mode, "advisory");
  assert.match(decision.reason, /advisory/);
});
