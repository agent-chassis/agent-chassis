import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHmac, randomBytes } from "node:crypto";

import {
  AGENT_BACKEND_DECISION_CODES,
  buildAgentBackendRequestV1,
  normalizeVerifiedAgentBackendDecisionV1
} from "../packages/agent-launch-cli/src/lib/agent-backend.mjs";
import {
  AGENT_BACKEND_VERIFIER_CHALLENGE_SCHEMA_VERSION,
  AGENT_BACKEND_VERIFIER_HANDSHAKE_RESULT_SCHEMA_VERSION,
  issueBackendHandshakeResult,
  loadLauncherVerifierCapability
} from "../packages/agent-launch-cli/src/lib/agent-backend-verifier.mjs";
import {
  createLauncherContextNonceStore
} from "../packages/agent-launch-core/src/lib/launcher-context-mint.mjs";
import { canonicalizeJson } from "../packages/agent-launch-core/src/lib/role-guard.mjs";

const TEST_SECRET = "fixture-WK-0321-handshake-verifier-secret";
const REPO = "agent-chassis/agent-chassis";
const SCOPE_DIGEST = "sha256:WK-0321-scope-digest";

function baseRequestInput(overrides = {}) {
  return {
    backend_kind: "filesystem_mcp",
    subject: {
      kind: "work_unit",
      repo: REPO,
      unit: { record_id: "WK-0321", slice_id: null, address: "WK-0321" }
    },
    agent: {
      family: "codex",
      role: "worker",
      profile: "filesystem-mcp-worker",
      model: null
    },
    scope: {
      read_scope: ["docs/agent-launch-quickstart.md"],
      write_scope: ["packages/agent-launch-cli/src/lib/agent-backend.mjs"]
    },
    validation: {
      commands: [
        { form: "argv", argv: ["node", "--test", "tests/agent-backend-handshake-verifier.test.mjs"] }
      ]
    },
    environment_policy: { mode: "closed", allowed_keys: [] },
    provenance_destination: {
      kind: "launcher_owned",
      run_id: "RUN-WK-0321-0000",
      path: ".agent-runs/runs/HO-0001/RUN-WK-0321-0000/response.md"
    },
    tools: { raw_exec_enabled: false },
    ...overrides
  };
}

async function loadFixture() {
  const issueDir = await mkdtemp(path.join(tmpdir(), "wk0321-issue-nonces-"));
  const resultDir = await mkdtemp(path.join(tmpdir(), "wk0321-result-nonces-"));
  const issueStore = await createLauncherContextNonceStore({ dir: issueDir });
  const resultStore = await createLauncherContextNonceStore({ dir: resultDir });
  const capability = await loadLauncherVerifierCapability({
    secret: TEST_SECRET,
    nonceStore: issueStore
  });
  return {
    capability,
    resultStore,
    issueStore,
    cleanup: async () => {
      await rm(issueDir, { recursive: true, force: true });
      await rm(resultDir, { recursive: true, force: true });
    }
  };
}

function freshChallenge(overrides = {}) {
  return {
    schema_version: AGENT_BACKEND_VERIFIER_CHALLENGE_SCHEMA_VERSION,
    backend_kind: "filesystem_mcp",
    challenge_nonce: overrides.challenge_nonce ?? randomBytes(16).toString("base64url"),
    normalized_scope_digest: overrides.normalized_scope_digest ?? SCOPE_DIGEST,
    validation_transport: "argv",
    provenance_sink: "launcher_owned",
    raw_exec_enabled: false,
    ...overrides
  };
}

function freshBackendEvidence(request, overrides = {}) {
  return {
    backend_kind: "filesystem_mcp",
    backend_id: "portfolio-filesystem-mcp",
    backend_version: "0.1.0",
    status: "available",
    raw_exec_enabled: false,
    tool_surface: request.tools.filesystem_mcp,
    scope_binding: true,
    bound_scope_digest: SCOPE_DIGEST,
    ...overrides
  };
}

async function issueFreshHandshake({
  capability,
  request,
  challengeOverrides = {},
  evidenceOverrides = {},
  now,
  ttlSeconds = 60
}) {
  const challenge = freshChallenge(challengeOverrides);
  const evidence = freshBackendEvidence(request, evidenceOverrides);
  return issueBackendHandshakeResult({
    capability,
    challenge,
    backendEvidence: evidence,
    now,
    ttlSeconds
  });
}

function decisionInput({ request, handshake, scopeDigest = SCOPE_DIGEST, allowed = true } = {}) {
  return {
    backend_kind: "filesystem_mcp",
    allowed,
    request,
    provenance: { scope_digest: scopeDigest },
    handshake
  };
}

test("verifier-issued handshake produces an allowed filesystem_mcp decision with the verified digest", async () => {
  const fixture = await loadFixture();
  try {
    const request = buildAgentBackendRequestV1(baseRequestInput());
    const handshake = await issueFreshHandshake({ capability: fixture.capability, request });
    const result = await normalizeVerifiedAgentBackendDecisionV1(
      decisionInput({ request, handshake }),
      { verifierCapability: fixture.capability, nonceStore: fixture.resultStore }
    );
    assert.equal(result.ok, true);
    assert.equal(result.value.allowed, true);
    assert.equal(result.value.decision_code, "agent_backend.filesystem_mcp.allowed.v1");
    assert.equal(result.value.accepted_handshake_digest, handshake.handshake_digest);
    assert.ok(AGENT_BACKEND_DECISION_CODES.includes(result.value.decision_code));
  } finally {
    await fixture.cleanup();
  }
});

test("missing verifier capability refuses with the namespaced filesystem_mcp.verifier_capability_missing code", async () => {
  const fixture = await loadFixture();
  try {
    const request = buildAgentBackendRequestV1(baseRequestInput());
    const handshake = await issueFreshHandshake({ capability: fixture.capability, request });
    const result = await normalizeVerifiedAgentBackendDecisionV1(
      decisionInput({ request, handshake }),
      { nonceStore: fixture.resultStore }
    );
    assert.equal(result.ok, true);
    assert.equal(result.value.allowed, false);
    assert.equal(
      result.value.decision_code,
      "agent_backend.filesystem_mcp.verifier_capability_missing.v1"
    );
    assert.ok(AGENT_BACKEND_DECISION_CODES.includes(result.value.decision_code));
  } finally {
    await fixture.cleanup();
  }
});

test("integrity-tag tampering refuses with handshake_integrity_invalid", async () => {
  const fixture = await loadFixture();
  try {
    const request = buildAgentBackendRequestV1(baseRequestInput());
    const handshake = await issueFreshHandshake({ capability: fixture.capability, request });
    const tampered = { ...handshake, integrity: "hmac-sha256:attacker-substituted-integrity" };
    const result = await normalizeVerifiedAgentBackendDecisionV1(
      decisionInput({ request, handshake: tampered }),
      { verifierCapability: fixture.capability, nonceStore: fixture.resultStore }
    );
    assert.equal(result.value.allowed, false);
    assert.equal(
      result.value.decision_code,
      "agent_backend.filesystem_mcp.handshake_integrity_invalid.v1"
    );
  } finally {
    await fixture.cleanup();
  }
});

test("expired handshake (per options.now) refuses with handshake_expired", async () => {
  const fixture = await loadFixture();
  try {
    const request = buildAgentBackendRequestV1(baseRequestInput());
    const handshake = await issueFreshHandshake({
      capability: fixture.capability,
      request,
      ttlSeconds: 60
    });
    const futureNow = new Date(Date.parse(handshake.expires_at) + 5_000);
    const result = await normalizeVerifiedAgentBackendDecisionV1(
      decisionInput({ request, handshake }),
      {
        verifierCapability: fixture.capability,
        nonceStore: fixture.resultStore,
        now: futureNow
      }
    );
    assert.equal(result.value.allowed, false);
    assert.equal(
      result.value.decision_code,
      "agent_backend.filesystem_mcp.handshake_expired.v1"
    );
  } finally {
    await fixture.cleanup();
  }
});

test("future-dated created_at refuses with handshake_future_dated", async () => {
  const fixture = await loadFixture();
  try {
    const request = buildAgentBackendRequestV1(baseRequestInput());

    const futureIssue = new Date(Date.now() + 600_000);
    const handshake = await issueFreshHandshake({
      capability: fixture.capability,
      request,
      now: futureIssue,
      ttlSeconds: 3600
    });

    const result = await normalizeVerifiedAgentBackendDecisionV1(
      decisionInput({ request, handshake }),
      { verifierCapability: fixture.capability, nonceStore: fixture.resultStore }
    );
    assert.equal(result.value.allowed, false);
    assert.equal(
      result.value.decision_code,
      "agent_backend.filesystem_mcp.handshake_future_dated.v1"
    );
  } finally {
    await fixture.cleanup();
  }
});

test("missing nonce store refuses with nonce_state_unavailable", async () => {
  const fixture = await loadFixture();
  try {
    const request = buildAgentBackendRequestV1(baseRequestInput());
    const handshake = await issueFreshHandshake({ capability: fixture.capability, request });
    const result = await normalizeVerifiedAgentBackendDecisionV1(
      decisionInput({ request, handshake }),
      { verifierCapability: fixture.capability }
    );
    assert.equal(result.value.allowed, false);
    assert.equal(
      result.value.decision_code,
      "agent_backend.filesystem_mcp.nonce_state_unavailable.v1"
    );
  } finally {
    await fixture.cleanup();
  }
});

test("non-atomic nonce store failure refuses with nonce_state_unavailable", async () => {
  const fixture = await loadFixture();
  try {
    const request = buildAgentBackendRequestV1(baseRequestInput());
    const handshake = await issueFreshHandshake({ capability: fixture.capability, request });
    const brokenStore = {
      async checkAndMark() {
        throw new Error("simulated nonce store I/O failure");
      }
    };
    const result = await normalizeVerifiedAgentBackendDecisionV1(
      decisionInput({ request, handshake }),
      { verifierCapability: fixture.capability, nonceStore: brokenStore }
    );
    assert.equal(result.value.allowed, false);
    assert.equal(
      result.value.decision_code,
      "agent_backend.filesystem_mcp.nonce_state_unavailable.v1"
    );
  } finally {
    await fixture.cleanup();
  }
});

test("duplicate result.nonce within expiry refuses with handshake_nonce_reused", async () => {
  const fixture = await loadFixture();
  try {
    const request = buildAgentBackendRequestV1(baseRequestInput());
    const handshake = await issueFreshHandshake({ capability: fixture.capability, request });
    const first = await normalizeVerifiedAgentBackendDecisionV1(
      decisionInput({ request, handshake }),
      { verifierCapability: fixture.capability, nonceStore: fixture.resultStore }
    );
    assert.equal(first.value.allowed, true);
    const replay = await normalizeVerifiedAgentBackendDecisionV1(
      decisionInput({ request, handshake }),
      { verifierCapability: fixture.capability, nonceStore: fixture.resultStore }
    );
    assert.equal(replay.value.allowed, false);
    assert.equal(
      replay.value.decision_code,
      "agent_backend.filesystem_mcp.handshake_nonce_reused.v1"
    );
  } finally {
    await fixture.cleanup();
  }
});

test("scope-digest mismatch refuses at the shape contract before verifier runs", async () => {
  const fixture = await loadFixture();
  try {
    const request = buildAgentBackendRequestV1(baseRequestInput());
    const handshake = await issueFreshHandshake({ capability: fixture.capability, request });

    const result = await normalizeVerifiedAgentBackendDecisionV1(
      decisionInput({
        request,
        handshake,
        scopeDigest: "sha256:attacker-substituted-scope"
      }),
      { verifierCapability: fixture.capability, nonceStore: fixture.resultStore }
    );
    assert.equal(result.ok, false);
    assert.ok(
      result.diagnostics.some((d) => d.path === "handshake.scope_digest"),
      `expected handshake.scope_digest diagnostic, got ${JSON.stringify(result.diagnostics)}`
    );
  } finally {
    await fixture.cleanup();
  }
});

test("backend identity mismatch refuses at the shape contract before verifier runs", async () => {
  const fixture = await loadFixture();
  try {
    const request = buildAgentBackendRequestV1(baseRequestInput());
    const handshake = await issueFreshHandshake({
      capability: fixture.capability,
      request,
      evidenceOverrides: { backend_id: "attacker-backend" }
    });
    const result = await normalizeVerifiedAgentBackendDecisionV1(
      decisionInput({ request, handshake }),
      { verifierCapability: fixture.capability, nonceStore: fixture.resultStore }
    );
    assert.equal(result.ok, false);
    assert.ok(
      result.diagnostics.some((d) => d.path === "handshake.backend_id"),
      `expected handshake.backend_id diagnostic, got ${JSON.stringify(result.diagnostics)}`
    );
  } finally {
    await fixture.cleanup();
  }
});

test("profile mismatch (wrapper-attached handshake.request) refuses at the shape contract", async () => {

  const fixture = await loadFixture();
  try {
    const request = buildAgentBackendRequestV1(baseRequestInput());
    const issued = await issueFreshHandshake({ capability: fixture.capability, request });
    const wrapperAttached = {
      ...issued,
      request: {
        ...request,
        agent: { ...request.agent, profile: "different-profile" }
      }
    };
    const result = await normalizeVerifiedAgentBackendDecisionV1(
      decisionInput({ request, handshake: wrapperAttached }),
      { verifierCapability: fixture.capability, nonceStore: fixture.resultStore }
    );
    assert.equal(result.ok, false);
    assert.ok(
      result.diagnostics.some((d) => d.path === "handshake.request.agent.profile"),
      `expected handshake.request.agent.profile diagnostic, got ${JSON.stringify(result.diagnostics)}`
    );
  } finally {
    await fixture.cleanup();
  }
});

test("raw_exec_enabled=true on the handshake refuses at the shape contract", async () => {
  const fixture = await loadFixture();
  try {
    const request = buildAgentBackendRequestV1(baseRequestInput());
    const handshake = await issueFreshHandshake({ capability: fixture.capability, request });
    const result = await normalizeVerifiedAgentBackendDecisionV1(
      decisionInput({ request, handshake: { ...handshake, raw_exec_enabled: true } }),
      { verifierCapability: fixture.capability, nonceStore: fixture.resultStore }
    );
    assert.equal(result.ok, false);
    assert.ok(
      result.diagnostics.some((d) => d.path === "raw_exec_enabled"),
      "raw_exec_enabled handshake must be refused by shape contract"
    );
  } finally {
    await fixture.cleanup();
  }
});

test("non-enforced mode refuses at the shape contract", async () => {
  const fixture = await loadFixture();
  try {
    const request = buildAgentBackendRequestV1(baseRequestInput());
    const handshake = await issueFreshHandshake({ capability: fixture.capability, request });
    const result = await normalizeVerifiedAgentBackendDecisionV1(
      decisionInput({ request, handshake: { ...handshake, mode: "advisory" } }),
      { verifierCapability: fixture.capability, nonceStore: fixture.resultStore }
    );
    assert.equal(result.ok, false);
    assert.ok(
      result.diagnostics.some((d) => d.path === "mode"),
      `expected mode diagnostic, got ${JSON.stringify(result.diagnostics)}`
    );
  } finally {
    await fixture.cleanup();
  }
});

test("tool_surface mismatch between request and handshake refuses with handshake_tool_surface_mismatch", async () => {
  const fixture = await loadFixture();
  try {
    const request = buildAgentBackendRequestV1(baseRequestInput());
    const handshake = await issueFreshHandshake({
      capability: fixture.capability,
      request,
      evidenceOverrides: {
        tool_surface: { read: true, write: false, structured_validation: true, final_report: true }
      }
    });
    const result = await normalizeVerifiedAgentBackendDecisionV1(
      decisionInput({ request, handshake }),
      { verifierCapability: fixture.capability, nonceStore: fixture.resultStore }
    );
    assert.equal(result.value.allowed, false);
    assert.equal(
      result.value.decision_code,
      "agent_backend.filesystem_mcp.handshake_tool_surface_mismatch.v1"
    );
  } finally {
    await fixture.cleanup();
  }
});

test("request-builder self-mint forgery cannot satisfy verification (criterion 5)", async () => {
  const fixture = await loadFixture();
  try {
    const request = buildAgentBackendRequestV1(baseRequestInput());

    const wrapperSecret = "wrapper-known-constant";
    const payload = {
      schema_version: AGENT_BACKEND_VERIFIER_HANDSHAKE_RESULT_SCHEMA_VERSION,
      backend_kind: "filesystem_mcp",
      backend_id: "portfolio-filesystem-mcp",
      backend_version: "0.1.0",
      challenge_nonce: "wrapper-issued-challenge",
      status: "available",
      mode: "enforced",
      raw_exec_enabled: false,
      tool_surface: request.tools.filesystem_mcp,
      scope_binding: true,
      scope_digest: SCOPE_DIGEST,
      validation_transport: "argv",
      provenance_sink: "launcher_owned",
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      nonce: randomBytes(16).toString("base64url"),
      handshake_digest: "sha256:wrapper-forged-digest"
    };
    const forgedIntegrity = `hmac-sha256:${createHmac("sha256", wrapperSecret)
      .update(canonicalizeJson(payload))
      .digest("base64url")}`;
    const handshake = { ...payload, integrity: forgedIntegrity };
    const result = await normalizeVerifiedAgentBackendDecisionV1(
      decisionInput({ request, handshake }),
      { verifierCapability: fixture.capability, nonceStore: fixture.resultStore }
    );
    assert.equal(result.value.allowed, false);

    assert.ok(
      result.value.decision_code === "agent_backend.filesystem_mcp.handshake_integrity_invalid.v1"
        || result.value.decision_code === "agent_backend.filesystem_mcp.handshake_mutated.v1",
      `unexpected decision_code for wrapper-issued forgery: ${result.value.decision_code}`
    );
  } finally {
    await fixture.cleanup();
  }
});
