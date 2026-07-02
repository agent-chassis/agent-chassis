
import test from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_BACKEND_DECISION_CODES,
  buildAgentBackendDecisionV1,
  buildAgentBackendRequestV1,
  buildFilesystemMcpAgentBackendRequestV1,
  buildFilesystemMcpAgentBackendHandshakeResultV1,
  buildVerifiedAgentBackendDecisionV1,
  normalizeAgentBackendDecisionV1,
  normalizeVerifiedAgentBackendDecisionV1
} from "../packages/agent-launch-cli/src/lib/agent-backend.mjs";
import {
  baseRequest,
  loadVerifierFixture,
  issueVerifiedHandshake
} from "./agent-backend-test-helpers.mjs";

function buildCurrentFilesystemMcpHandshake(overrides = {}) {
  const request = overrides.request ?? buildAgentBackendRequestV1(baseRequest());
  const scopeDigest = overrides.scope_digest ?? "sha256:filesystem-mcp-scope-digest";

  return buildFilesystemMcpAgentBackendHandshakeResultV1({
    request,
    challenge_nonce: "nonce-current",
    status: "available",
    mode: "enforced",
    raw_exec_enabled: false,
    tool_surface: request.tools.filesystem_mcp,
    scope_binding: true,
    validation_transport: "argv",
    provenance_sink: "launcher_owned",
    scope_digest: scopeDigest,
    handshake_digest: "sha256:filesystem-mcp-handshake-digest",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  });
}

test("verified decisions preserve verifier-issued reviewer/redteam read-only handshakes", async () => {
  const fixture = await loadVerifierFixture();
  const scopeDigest = "sha256:filesystem-mcp-scope-digest";
  try {
    for (const role of ["reviewer", "redteam"]) {
      const request = buildFilesystemMcpAgentBackendRequestV1(
        baseRequest({
          agent: {
            family: "codex",
            role,
            profile: `filesystem-mcp-${role}`,
            model: null
          },
          scope: {
            read_scope: ["docs/agent-launch-quickstart.md"],
            write_scope: []
          },
          tools: {
            raw_exec_enabled: false,
            filesystem_mcp: {
              read: true,
              write: false,
              structured_validation: true,
              final_report: true
            }
          }
        })
      );
      const handshake = await issueVerifiedHandshake({
        capability: fixture.capability,
        request,
        scopeDigest
      });
      const result = await normalizeVerifiedAgentBackendDecisionV1(
        {
          backend_kind: "filesystem_mcp",
          allowed: true,
          request,
          provenance: { scope_digest: scopeDigest },
          handshake
        },
        {
          verifierCapability: fixture.capability,
          nonceStore: fixture.resultNonceStore
        }
      );

      assert.equal(result.ok, true, `${role} decision should normalize`);
      assert.equal(result.value.allowed, true);
      assert.equal(result.value.handshake.tool_surface.write, false);
      assert.deepEqual(result.value.handshake.tool_surface, request.tools.filesystem_mcp);
    }
  } finally {
    await fixture.cleanup();
  }
});

test("decision normalization preserves allow/refuse inputs and stable agent_backend.*.v1 codes", async () => {
  const allowedRequest = buildAgentBackendRequestV1(
    baseRequest({
      backend_kind: "filesystem_mcp",
      agent: {
        family: "codex",
        role: "worker",
        profile: "filesystem-mcp-worker",
        model: null
      }
    })
  );
  const scopeDigest = "sha256:filesystem-mcp-scope-digest";
  const fixture = await loadVerifierFixture();
  try {
    const handshake = await issueVerifiedHandshake({
      capability: fixture.capability,
      request: allowedRequest,
      scopeDigest
    });
    const allowResult = await normalizeVerifiedAgentBackendDecisionV1(
      {
        backend_kind: "filesystem_mcp",
        allowed: true,
        request: allowedRequest,
        provenance: {
          scope_digest: scopeDigest
        },
        handshake
      },
      {
        verifierCapability: fixture.capability,
        nonceStore: fixture.resultNonceStore
      }
    );
    assert.equal(allowResult.ok, true);
    assert.equal(allowResult.value.allowed, true);
    assert.equal(allowResult.value.decision_code, "agent_backend.filesystem_mcp.allowed.v1");
    assert.equal(allowResult.value.accepted_handshake_digest, handshake.handshake_digest);
  } finally {
    await fixture.cleanup();
  }

  const refusedRequest = buildAgentBackendRequestV1(
    baseRequest({
      backend_kind: "local_cli",
      tools: {
        raw_exec_enabled: true
      },
      agent: {
        family: "claude",
        role: "worker",
        profile: "local-cli-worker",
        model: null
      }
    })
  );
  const refuseResult = buildAgentBackendDecisionV1({
    backend_kind: "local_cli",
    decision: "refuse",
    reason: "local cli socket unavailable",
    request: refusedRequest
  });
  assert.equal(refuseResult.allowed, false);
  assert.equal(refuseResult.decision_code, "agent_backend.local_cli.socket_failure.v1");
  assert.ok(AGENT_BACKEND_DECISION_CODES.includes(refuseResult.decision_code));
});

test("decision inference distinguishes unsupported agent profile from unsupported agent family", () => {
  const refusedRequest = buildAgentBackendRequestV1(
    baseRequest({
      agent: {
        family: "claude",
        role: "worker",
        profile: "filesystem-mcp-worker",
        model: null
      }
    })
  );

  const unsupportedProfile = buildAgentBackendDecisionV1({
    backend_kind: "filesystem_mcp",
    decision: "refuse",
    reason: "unsupported agent profile: filesystem-mcp-worker is not registered for claude",
    request: refusedRequest
  });
  assert.equal(unsupportedProfile.allowed, false);
  assert.equal(
    unsupportedProfile.decision_code,
    "agent_backend.profile.unsupported_agent_profile.v1"
  );
  assert.ok(AGENT_BACKEND_DECISION_CODES.includes(unsupportedProfile.decision_code));

  const unsupportedFamily = buildAgentBackendDecisionV1({
    backend_kind: "filesystem_mcp",
    decision: "refuse",
    reason: "unsupported agent family: gemini is not registered for this backend",
    request: refusedRequest
  });
  assert.equal(unsupportedFamily.allowed, false);
  assert.equal(
    unsupportedFamily.decision_code,
    "agent_backend.profile.unsupported_agent_family.v1"
  );

  const explicitProfileCode = buildAgentBackendDecisionV1({
    backend_kind: "filesystem_mcp",
    decision: "refuse",
    decision_code: "agent_backend.profile.unsupported_agent_profile.v1",
    reason: "profile registry rejected the requested profile",
    request: refusedRequest
  });
  assert.equal(
    explicitProfileCode.decision_code,
    "agent_backend.profile.unsupported_agent_profile.v1"
  );
});

test("filesystem-MCP allowed decisions require a current handshake digest and refuse stale or invalid evidence", async () => {
  const allowedRequest = buildAgentBackendRequestV1(
    baseRequest({
      backend_kind: "filesystem_mcp",
      agent: {
        family: "codex",
        role: "worker",
        profile: "filesystem-mcp-worker",
        model: null
      }
    })
  );
  const scopeDigest = "sha256:filesystem-mcp-scope-digest";
  const fixture = await loadVerifierFixture();
  try {
    const handshake = await issueVerifiedHandshake({
      capability: fixture.capability,
      request: allowedRequest,
      scopeDigest
    });

    const allowedResult = await buildVerifiedAgentBackendDecisionV1(
      {
        backend_kind: "filesystem_mcp",
        allowed: true,
        request: allowedRequest,
        provenance: {
          scope_digest: scopeDigest
        },
        handshake
      },
      {
        verifierCapability: fixture.capability,
        nonceStore: fixture.resultNonceStore
      }
    );
    assert.equal(allowedResult.allowed, true);
    assert.equal(allowedResult.decision_code, "agent_backend.filesystem_mcp.allowed.v1");
    assert.equal(allowedResult.accepted_handshake_digest, handshake.handshake_digest);
  } finally {
    await fixture.cleanup();
  }

  const shapeOnlyHandshake = buildCurrentFilesystemMcpHandshake({
    request: allowedRequest,
    scope_digest: scopeDigest
  });

  const missingHandshakeResult = normalizeAgentBackendDecisionV1({
    backend_kind: "filesystem_mcp",
    allowed: true,
    request: allowedRequest,
    provenance: {
      scope_digest: scopeDigest
    }
  });
  assert.equal(missingHandshakeResult.ok, false);
  assert.ok(
    missingHandshakeResult.diagnostics.some((diagnostic) => diagnostic.path === "handshake"),
    "missing handshake evidence should be rejected"
  );
  assert.ok(
    missingHandshakeResult.diagnostics.every((diagnostic) => diagnostic.code === "invalid_agent_backend_input"),
    "missing handshake evidence should not normalize to an allowed decision"
  );

  const staleHandshakeResult = normalizeAgentBackendDecisionV1({
    backend_kind: "filesystem_mcp",
    allowed: true,
    request: allowedRequest,
    provenance: {
      scope_digest: scopeDigest
    },
    handshake: {
      ...shapeOnlyHandshake,
      expires_at: new Date(Date.now() - 60_000).toISOString()
    }
  });
  assert.equal(staleHandshakeResult.ok, false);
  assert.ok(
    staleHandshakeResult.diagnostics.some((diagnostic) => diagnostic.path === "expires_at"),
    "expired handshake evidence should be rejected"
  );

  const invalidHandshakeResult = normalizeAgentBackendDecisionV1({
    backend_kind: "filesystem_mcp",
    allowed: true,
    request: allowedRequest,
    provenance: {
      scope_digest: scopeDigest
    },
    handshake: {
      ...shapeOnlyHandshake,
      raw_exec_enabled: true
    }
  });
  assert.equal(invalidHandshakeResult.ok, false);
  assert.ok(
    invalidHandshakeResult.diagnostics.some((diagnostic) => diagnostic.path === "raw_exec_enabled"),
    "handshake evidence that enables raw exec should be rejected"
  );
  assert.ok(
    invalidHandshakeResult.diagnostics.every((diagnostic) => diagnostic.code === "invalid_agent_backend_input"),
    "invalid handshake evidence should not normalize to an allowed decision"
  );
});
