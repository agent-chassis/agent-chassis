import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

import {
  AGENT_BACKEND_FILESYSTEM_MCP_HANDSHAKE_TRANSPORT_KINDS,
  buildAgentBackendDecisionV1,
  buildAgentBackendRequestV1,
  buildFilesystemMcpAgentBackendHandshakeRequestV1,
  buildFilesystemMcpAgentBackendHandshakeResultV1,
  buildFilesystemMcpAgentBackendRequestV1,
  buildRegistryBackedFilesystemMcpAgentBackendRequestV1,
  buildRegistryBackedVerifiedFilesystemMcpAgentBackendDecisionV1,
  normalizeAgentBackendDecisionV1,
  normalizeRegistryBackedVerifiedFilesystemMcpAgentBackendDecisionV1,
  normalizeVerifiedAgentBackendDecisionV1,
  resolveFilesystemMcpBackendAuthority,
  DEFAULT_FILESYSTEM_MCP_BACKEND_ID,
  DEFAULT_FILESYSTEM_MCP_BACKEND_VERSION
} from "../packages/agent-launch-cli/src/lib/agent-backend.mjs";
import {
  AGENT_BACKEND_VERIFIER_CHALLENGE_SCHEMA_VERSION,
  issueBackendHandshakeResult,
  loadLauncherVerifierCapability
} from "../packages/agent-launch-cli/src/lib/agent-backend-verifier.mjs";
import {
  createLauncherContextNonceStore
} from "../packages/agent-launch-core/src/lib/launcher-context-mint.mjs";

const REPO = "agent-chassis/agent-chassis";
const SCOPE_DIGEST = "sha256:wk-0403-self-mint-scope-digest";
const TEST_VERIFIER_SECRET = "fixture-wk-0403-self-mint-secret";

const SELF_MINT_REFUSAL_AUTHORITY_CODE = "agent_backend.filesystem_mcp.verifier_capability_missing.v1";

function baseSubject(recordId = "WK-0403") {
  return {
    kind: "work_unit",
    repo: REPO,
    unit: { record_id: recordId, slice_id: null, address: recordId }
  };
}

function baseRequestInput(overrides = {}) {
  return {
    backend_kind: "filesystem_mcp",
    subject: baseSubject(),
    agent: {
      family: "claude",
      role: "worker",
      profile: "filesystem-mcp-worker",
      model: null
    },
    scope: {
      read_scope: ["docs/agent-role-guard.md"],
      write_scope: ["packages/agent-launch-cli/src/lib/agent-backend.mjs"]
    },
    validation: {
      commands: [
        {
          form: "argv",
          argv: ["npm", "test", "--", "tests/agent-backend-self-mint.test.mjs"]
        }
      ]
    },
    environment_policy: { mode: "closed", allowed_keys: [] },
    provenance_destination: {
      kind: "launcher_owned",
      run_id: "RUN-WK-0403-self-mint",
      path: ".agent-runs/runs/HO-XXXX/RUN-WK-0403-self-mint/response.md"
    },
    tools: { raw_exec_enabled: false },
    evidence: { scope_digest: SCOPE_DIGEST },
    ...overrides
  };
}

function fabricatedShapeOnlyHandshake({ request, scopeDigest = SCOPE_DIGEST, overrides = {} } = {}) {

  return buildFilesystemMcpAgentBackendHandshakeResultV1({
    request,
    challenge_nonce: `forged-nonce-${randomBytes(8).toString("hex")}`,
    status: "available",
    mode: "enforced",
    raw_exec_enabled: false,
    tool_surface: request.tools.filesystem_mcp,
    scope_binding: true,
    validation_transport: "argv",
    provenance_sink: "launcher_owned",
    scope_digest: scopeDigest,
    handshake_digest: `sha256:forged-handshake-digest-${randomBytes(8).toString("hex")}`,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    ...overrides
  });
}

function findAuthorityDiagnostic(diagnostics) {
  return (diagnostics ?? []).find(
    (d) =>
      d.path === "allowed" &&
      d.authority_refusal_code === SELF_MINT_REFUSAL_AUTHORITY_CODE
  );
}

test("buildAgentBackendDecisionV1 throws when a same-process caller pairs a forged shape-only handshake with allowed=true", () => {
  const request = buildFilesystemMcpAgentBackendRequestV1({
    ...baseRequestInput(),
    tools: {
      raw_exec_enabled: false,
      filesystem_mcp: { read: true, write: true, structured_validation: true, final_report: true }
    }
  });
  const handshake = fabricatedShapeOnlyHandshake({ request });

  assert.throws(
    () =>
      buildAgentBackendDecisionV1({
        backend_kind: "filesystem_mcp",
        allowed: true,
        request,
        handshake,
        provenance: { scope_digest: SCOPE_DIGEST }
      }),
    /verified decision path|cannot self-mint/i,
    "legacy sync builder must throw rather than emit an allowed.v1 decision"
  );
});

test("normalizeAgentBackendDecisionV1 emits the authority-refusal diagnostic for self-minted allowed.v1 inputs", () => {
  const request = buildFilesystemMcpAgentBackendRequestV1({
    ...baseRequestInput(),
    tools: {
      raw_exec_enabled: false,
      filesystem_mcp: { read: true, write: true, structured_validation: true, final_report: true }
    }
  });
  const handshake = fabricatedShapeOnlyHandshake({ request });
  const result = normalizeAgentBackendDecisionV1({
    backend_kind: "filesystem_mcp",
    allowed: true,
    request,
    handshake,
    provenance: { scope_digest: SCOPE_DIGEST }
  });

  assert.equal(result.ok, false, "sync normalizer must not produce an allowed result");
  assert.ok(
    findAuthorityDiagnostic(result.diagnostics),
    "diagnostics must include the authority-refusal entry pointing at the verified decision path"
  );
});

test("self-mint refusal still fires when the caller also forges a matching handshake request", () => {
  const requestInput = {
    ...baseRequestInput(),
    tools: {
      raw_exec_enabled: false,
      filesystem_mcp: { read: true, write: true, structured_validation: true, final_report: true }
    },
    evidence: { scope_digest: SCOPE_DIGEST }
  };
  const request = buildFilesystemMcpAgentBackendRequestV1(requestInput);

  const handshakeRequest = buildFilesystemMcpAgentBackendHandshakeRequestV1({
    request,
    challenge_nonce: "wrapper-forged-challenge",
    normalized_scope_digest: SCOPE_DIGEST,
    validation_transport: "argv",
    provenance_sink: "launcher_owned",
    raw_exec_enabled: false
  });

  const handshakeResult = buildFilesystemMcpAgentBackendHandshakeResultV1({
    request,
    challenge_nonce: handshakeRequest.challenge_nonce,
    status: "available",
    mode: "enforced",
    raw_exec_enabled: false,
    tool_surface: request.tools.filesystem_mcp,
    scope_binding: true,
    validation_transport: "argv",
    provenance_sink: "launcher_owned",
    scope_digest: SCOPE_DIGEST,
    handshake_digest: "sha256:wrapper-forged-handshake-digest",
    expires_at: new Date(Date.now() + 60_000).toISOString()
  });

  const result = normalizeAgentBackendDecisionV1({
    backend_kind: "filesystem_mcp",
    allowed: true,
    request,
    handshake: handshakeResult,
    provenance: { scope_digest: SCOPE_DIGEST }
  });
  assert.equal(result.ok, false);
  assert.ok(findAuthorityDiagnostic(result.diagnostics));
});

test("self-mint refusal fires even when the caller supplies the registry-pinned backend identity and matching scope digest", () => {
  const request = buildFilesystemMcpAgentBackendRequestV1({
    ...baseRequestInput(),
    tools: {
      raw_exec_enabled: false,
      filesystem_mcp: { read: true, write: true, structured_validation: true, final_report: true }
    },
    evidence: { scope_digest: SCOPE_DIGEST }
  });
  const handshake = fabricatedShapeOnlyHandshake({ request });

  const result = normalizeAgentBackendDecisionV1({
    backend_kind: "filesystem_mcp",
    backend_id: DEFAULT_FILESYSTEM_MCP_BACKEND_ID,
    backend_version: DEFAULT_FILESYSTEM_MCP_BACKEND_VERSION,
    mode: "enforced",
    allowed: true,
    request,
    handshake,
    provenance: { scope_digest: SCOPE_DIGEST }
  });
  assert.equal(result.ok, false);
  assert.ok(findAuthorityDiagnostic(result.diagnostics));
});

test("normalizeVerifiedAgentBackendDecisionV1 refuses when no verifier capability is supplied (the legitimate launcher must pass one)", async () => {
  const request = buildFilesystemMcpAgentBackendRequestV1({
    ...baseRequestInput(),
    tools: {
      raw_exec_enabled: false,
      filesystem_mcp: { read: true, write: true, structured_validation: true, final_report: true }
    }
  });
  const handshake = fabricatedShapeOnlyHandshake({ request });

  const result = await normalizeVerifiedAgentBackendDecisionV1(
    {
      backend_kind: "filesystem_mcp",
      allowed: true,
      request,
      handshake,
      provenance: { scope_digest: SCOPE_DIGEST }
    },
    {}
  );
  assert.equal(result.ok, true, "verified path returns a normalized refusal decision instead of throwing");
  assert.equal(result.value.allowed, false);
  assert.equal(result.value.decision_code, SELF_MINT_REFUSAL_AUTHORITY_CODE);
});

test("normalizeVerifiedAgentBackendDecisionV1 refuses a shape-only fabricated handshake even when a verifier capability and nonce store are supplied", async () => {
  const issueNonceDir = await mkdtemp(path.join(tmpdir(), "wk0403-self-mint-issue-"));
  const resultNonceDir = await mkdtemp(path.join(tmpdir(), "wk0403-self-mint-result-"));
  try {
    const issueNonceStore = await createLauncherContextNonceStore({ dir: issueNonceDir });
    const resultNonceStore = await createLauncherContextNonceStore({ dir: resultNonceDir });
    const capability = await loadLauncherVerifierCapability({
      secret: TEST_VERIFIER_SECRET,
      nonceStore: issueNonceStore
    });

    const request = buildFilesystemMcpAgentBackendRequestV1({
      ...baseRequestInput(),
      tools: {
        raw_exec_enabled: false,
        filesystem_mcp: { read: true, write: true, structured_validation: true, final_report: true }
      }
    });
    const fabricated = fabricatedShapeOnlyHandshake({ request });
    const result = await normalizeVerifiedAgentBackendDecisionV1(
      {
        backend_kind: "filesystem_mcp",
        allowed: true,
        request,
        handshake: fabricated,
        provenance: { scope_digest: SCOPE_DIGEST }
      },
      { verifierCapability: capability, nonceStore: resultNonceStore }
    );
    assert.equal(result.ok, true);
    assert.equal(result.value.allowed, false);

    assert.notEqual(result.value.decision_code, "agent_backend.filesystem_mcp.allowed.v1");
    assert.match(result.value.decision_code, /^agent_backend\.filesystem_mcp\./);
  } finally {
    await rm(issueNonceDir, { recursive: true, force: true });
    await rm(resultNonceDir, { recursive: true, force: true });
  }
});

test("normalizeVerifiedAgentBackendDecisionV1 emits an allowed.v1 only when a verifier-issued handshake matches the request and a fresh nonce store accepts the result", async () => {
  const issueNonceDir = await mkdtemp(path.join(tmpdir(), "wk0403-self-mint-issue-ok-"));
  const resultNonceDir = await mkdtemp(path.join(tmpdir(), "wk0403-self-mint-result-ok-"));
  try {
    const issueNonceStore = await createLauncherContextNonceStore({ dir: issueNonceDir });
    const resultNonceStore = await createLauncherContextNonceStore({ dir: resultNonceDir });
    const capability = await loadLauncherVerifierCapability({
      secret: TEST_VERIFIER_SECRET,
      nonceStore: issueNonceStore
    });

    const request = buildAgentBackendRequestV1(
      baseRequestInput({
        tools: {
          raw_exec_enabled: false,
          filesystem_mcp: { read: true, write: true, structured_validation: true, final_report: true }
        }
      })
    );

    const challenge = {
      schema_version: AGENT_BACKEND_VERIFIER_CHALLENGE_SCHEMA_VERSION,
      backend_kind: "filesystem_mcp",
      challenge_nonce: randomBytes(16).toString("base64url"),
      normalized_scope_digest: SCOPE_DIGEST,
      validation_transport: "argv",
      provenance_sink: "launcher_owned",
      raw_exec_enabled: false
    };
    const evidence = {
      backend_kind: "filesystem_mcp",
      backend_id: "portfolio-filesystem-mcp",
      backend_version: "0.1.0",
      status: "available",
      raw_exec_enabled: false,
      tool_surface: request.tools.filesystem_mcp,
      scope_binding: true,
      bound_scope_digest: SCOPE_DIGEST
    };
    const handshake = await issueBackendHandshakeResult({
      capability,
      challenge,
      backendEvidence: evidence
    });

    const result = await normalizeVerifiedAgentBackendDecisionV1(
      {
        backend_kind: "filesystem_mcp",
        allowed: true,
        request,
        handshake,
        provenance: { scope_digest: SCOPE_DIGEST }
      },
      { verifierCapability: capability, nonceStore: resultNonceStore }
    );
    assert.equal(result.ok, true);
    assert.equal(result.value.allowed, true);
    assert.equal(result.value.decision_code, "agent_backend.filesystem_mcp.allowed.v1");
    assert.equal(result.value.accepted_handshake_digest, handshake.handshake_digest);
  } finally {
    await rm(issueNonceDir, { recursive: true, force: true });
    await rm(resultNonceDir, { recursive: true, force: true });
  }
});

test("registry-backed allowed decisions still refuse a fabricated wrapper-side handshake when the launcher-pinned transport is supplied", async () => {
  const registry = {
    data: {
      schema_version: 1,
      filesystem_mcp_backend_default: "default",
      filesystem_mcp_backends: {
        default: {
          backend_id: "portfolio-filesystem-mcp",
          backend_version: "0.1.0",
          mode: "enforced",
          endpoint: { kind: "spawn", argv: ["fake-backend"] },
          handshake_source: { kind: "spawn_stdout" },
          supported_profiles: [
            {
              agent_family: "claude",
              profile: "filesystem-mcp-worker",
              roles: ["worker"]
            }
          ]
        }
      }
    }
  };
  const authorityResult = resolveFilesystemMcpBackendAuthority({
    registry,
    agentFamily: "claude",
    agentProfile: "filesystem-mcp-worker",
    agentRole: "worker"
  });
  assert.equal(authorityResult.ok, true);
  const authority = authorityResult.authority;

  const request = buildRegistryBackedFilesystemMcpAgentBackendRequestV1(authority, {
    subject: baseSubject(),
    agent: { role: "worker" },
    scope: baseRequestInput().scope,
    validation: baseRequestInput().validation,
    environment_policy: baseRequestInput().environment_policy,
    provenance_destination: baseRequestInput().provenance_destination,
    tools: {
      raw_exec_enabled: false,
      filesystem_mcp: { read: true, write: true, structured_validation: true, final_report: true }
    },
    evidence: { scope_digest: SCOPE_DIGEST }
  });
  const fabricated = fabricatedShapeOnlyHandshake({ request });
  const decision = await buildRegistryBackedVerifiedFilesystemMcpAgentBackendDecisionV1({
    authority,
    allowed: true,
    request,
    handshake: fabricated,
    handshake_transport_source: authority.handshake_source.kind,
    provenance: { scope_digest: SCOPE_DIGEST }
  });
  assert.equal(decision.allowed, false);
  assert.match(decision.decision_code, /^agent_backend\.filesystem_mcp\./);
  assert.notEqual(decision.decision_code, "agent_backend.filesystem_mcp.allowed.v1");
});

test("authority refusal still applies even if a wrapper supplies a launcher-pinned transport string out of band", async () => {

  const request = buildFilesystemMcpAgentBackendRequestV1({
    ...baseRequestInput(),
    tools: {
      raw_exec_enabled: false,
      filesystem_mcp: { read: true, write: true, structured_validation: true, final_report: true }
    },
    evidence: { scope_digest: SCOPE_DIGEST }
  });
  const handshake = fabricatedShapeOnlyHandshake({ request });

  assert.ok(
    Array.isArray(AGENT_BACKEND_FILESYSTEM_MCP_HANDSHAKE_TRANSPORT_KINDS),
    "AGENT_BACKEND_FILESYSTEM_MCP_HANDSHAKE_TRANSPORT_KINDS must be an array"
  );
  assert.ok(
    AGENT_BACKEND_FILESYSTEM_MCP_HANDSHAKE_TRANSPORT_KINDS.length > 0,
    "AGENT_BACKEND_FILESYSTEM_MCP_HANDSHAKE_TRANSPORT_KINDS must contain at least one entry"
  );

  for (const transport of AGENT_BACKEND_FILESYSTEM_MCP_HANDSHAKE_TRANSPORT_KINDS) {
    const result = normalizeAgentBackendDecisionV1({
      backend_kind: "filesystem_mcp",
      allowed: true,
      request,
      handshake,
      handshake_transport_source: transport,
      provenance: { scope_digest: SCOPE_DIGEST }
    });
    assert.equal(result.ok, false, `caller-asserted transport ${transport} must not satisfy the authority guard`);
    assert.ok(
      findAuthorityDiagnostic(result.diagnostics),
      `caller-asserted transport ${transport} must yield the authority refusal diagnostic`
    );
  }
});

test("legacy refusal decisions still flow through buildAgentBackendDecisionV1 (the guard fires only on allowed.v1 attempts)", () => {
  const request = buildFilesystemMcpAgentBackendRequestV1({
    ...baseRequestInput(),
    tools: {
      raw_exec_enabled: false,
      filesystem_mcp: { read: true, write: true, structured_validation: true, final_report: true }
    }
  });

  const decision = buildAgentBackendDecisionV1({
    backend_kind: "filesystem_mcp",
    backend_id: DEFAULT_FILESYSTEM_MCP_BACKEND_ID,
    backend_version: DEFAULT_FILESYSTEM_MCP_BACKEND_VERSION,
    mode: "enforced",
    allowed: false,
    decision_code: "agent_backend.filesystem_mcp.unavailable.v1",
    severity: "error",
    effect: "blocks_launch",
    reason: "filesystem MCP handshake is missing",
    remediation: null,
    run_id: null,
    request,
    provenance: {
      normalized_input_digest: "sha256:test-input-digest",
      scope_digest: SCOPE_DIGEST,
      profile: "filesystem-mcp-worker",
      model: null,
      raw_exec_enabled: false
    }
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.decision_code, "agent_backend.filesystem_mcp.unavailable.v1");
});
