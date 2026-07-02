import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHmac, randomBytes } from "node:crypto";

import {
  AGENT_BACKEND_VERIFIER_CHALLENGE_SCHEMA_VERSION,
  AGENT_BACKEND_VERIFIER_HANDSHAKE_RESULT_SCHEMA_VERSION,
  AGENT_BACKEND_VERIFIER_REFUSAL_CODES,
  AGENT_BACKEND_VERIFIER_REFUSAL_SCHEMA_VERSION,
  hasLauncherVerifierCapability,
  issueBackendHandshakeResult,
  loadLauncherVerifierCapability,
  refuseCallerSuppliedVerifierIdentity,
  verifyBackendHandshakeResult
} from "../packages/agent-launch-cli/src/lib/agent-backend-verifier.mjs";
import {
  IDENTITY_REFUSAL_CODES
} from "../packages/wiki-core/src/lib/agent-dispatch-identity.mjs";
import {
  createLauncherContextNonceStore
} from "../packages/agent-launch-core/src/lib/launcher-context-mint.mjs";
import { canonicalizeJson } from "../packages/agent-launch-core/src/lib/role-guard.mjs";

const TEST_SECRET = "fixture-launcher-verifier-secret-0123456789abcdef";
const TEST_SCOPE_DIGEST = "sha256:test-scope-digest-abc";

async function withNonceDir(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), "agent-backend-verifier-nonces-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function loadFixtureCapability(overrides = {}) {
  const nonceDir = overrides.nonceDir ?? await mkdtemp(path.join(tmpdir(), "agent-backend-verifier-nonces-"));
  const nonceStore = overrides.nonceStore ?? await createLauncherContextNonceStore({ dir: nonceDir });
  const capability = await loadLauncherVerifierCapability({
    secret: overrides.secret ?? TEST_SECRET,
    nonceStore
  });
  return { capability, nonceDir };
}

function freshChallenge(overrides = {}) {
  return {
    schema_version: AGENT_BACKEND_VERIFIER_CHALLENGE_SCHEMA_VERSION,
    backend_kind: "filesystem_mcp",
    challenge_nonce: overrides.challenge_nonce ?? randomBytes(16).toString("base64url"),
    normalized_scope_digest: overrides.normalized_scope_digest ?? TEST_SCOPE_DIGEST,
    validation_transport: overrides.validation_transport ?? "argv",
    provenance_sink: overrides.provenance_sink ?? "launcher_owned",
    raw_exec_enabled: false,
    ...overrides
  };
}

function freshBackendEvidence(overrides = {}) {
  return {
    backend_kind: "filesystem_mcp",
    backend_id: "portfolio-filesystem-mcp",
    backend_version: "0.1.0",
    status: "available",
    raw_exec_enabled: false,
    tool_surface: {
      read: true,
      write: true,
      structured_validation: true,
      final_report: true
    },
    scope_binding: true,
    bound_scope_digest: TEST_SCOPE_DIGEST,
    ...overrides
  };
}

test("loadLauncherVerifierCapability returns a registered capability identity", async () => {
  await withNonceDir(async (nonceDir) => {
    const { capability } = await loadFixtureCapability({ nonceDir });
    assert.equal(hasLauncherVerifierCapability(capability), true);
    assert.equal(hasLauncherVerifierCapability(null), false);
    assert.equal(hasLauncherVerifierCapability({}), false);

    const clone = JSON.parse(JSON.stringify(capability));
    assert.equal(hasLauncherVerifierCapability(clone), false);
  });
});

test("loadLauncherVerifierCapability refuses when no launcher secret is available", async () => {
  await withNonceDir(async (nonceDir) => {

    await assert.rejects(
      loadLauncherVerifierCapability({ secret: "", nonceStore: await createLauncherContextNonceStore({ dir: nonceDir }) }),
      (error) => error.code === AGENT_BACKEND_VERIFIER_REFUSAL_CODES.SECRET_MISSING
    );
  });
});

test("loadLauncherVerifierCapability surfaces missing launcher-held secret via the well-known refusal code", async () => {
  await withNonceDir(async (nonceDir) => {

    const isolated = await mkdtemp(path.join(tmpdir(), "agent-backend-verifier-empty-workspace-"));
    try {
      await assert.rejects(
        loadLauncherVerifierCapability({
          workspaceDir: isolated,
          nonceStore: await createLauncherContextNonceStore({ dir: nonceDir })
        }),
        (error) => error.code === AGENT_BACKEND_VERIFIER_REFUSAL_CODES.SECRET_MISSING
      );
    } finally {
      await rm(isolated, { recursive: true, force: true });
    }
  });
});

test("wrapper-issued JSON cannot pass verification without going through the verifier", async () => {
  await withNonceDir(async (nonceDir) => {
    const { capability } = await loadFixtureCapability({ nonceDir });
    const wrapperForgery = {
      schema_version: AGENT_BACKEND_VERIFIER_HANDSHAKE_RESULT_SCHEMA_VERSION,
      backend_kind: "filesystem_mcp",
      backend_id: "portfolio-filesystem-mcp",
      backend_version: "0.1.0",
      challenge_nonce: "wrapper-nonce-1",
      status: "available",
      mode: "enforced",
      raw_exec_enabled: false,
      tool_surface: { read: true, write: true, structured_validation: true, final_report: true },
      scope_binding: true,
      scope_digest: TEST_SCOPE_DIGEST,
      validation_transport: "argv",
      provenance_sink: "launcher_owned",
      handshake_digest: "sha256:wrapper-forged-digest",
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      nonce: "wrapper-result-nonce",

      integrity: "hmac-sha256:wrapper-forged-integrity"
    };
    const decision = verifyBackendHandshakeResult({ capability, result: wrapperForgery });
    assert.equal(decision.accepted, false);
    assert.equal(decision.refusal_code, AGENT_BACKEND_VERIFIER_REFUSAL_CODES.INTEGRITY_INVALID);
  });
});

test("wrapper cannot forge a passing result even by computing HMAC over its own constants", async () => {
  await withNonceDir(async (nonceDir) => {
    const { capability } = await loadFixtureCapability({ nonceDir });

    const wrapperSecret = "wrapper-known-constant";
    const payload = {
      schema_version: AGENT_BACKEND_VERIFIER_HANDSHAKE_RESULT_SCHEMA_VERSION,
      backend_kind: "filesystem_mcp",
      backend_id: "portfolio-filesystem-mcp",
      backend_version: "0.1.0",
      challenge_nonce: "wrapper-nonce-2",
      status: "available",
      mode: "enforced",
      raw_exec_enabled: false,
      tool_surface: { read: true, write: true, structured_validation: true, final_report: true },
      scope_binding: true,
      scope_digest: TEST_SCOPE_DIGEST,
      validation_transport: "argv",
      provenance_sink: "launcher_owned",
      handshake_digest: "sha256:wrapper-forged-digest",
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      nonce: "wrapper-result-nonce-2"
    };
    const forged = `hmac-sha256:${createHmac("sha256", wrapperSecret).update(canonicalizeJson(payload)).digest("base64url")}`;
    const decision = verifyBackendHandshakeResult({
      capability,
      result: { ...payload, integrity: forged }
    });
    assert.equal(decision.accepted, false);
    assert.equal(decision.refusal_code, AGENT_BACKEND_VERIFIER_REFUSAL_CODES.INTEGRITY_INVALID);
  });
});

test("issueBackendHandshakeResult mints a result that round-trips through verifyBackendHandshakeResult", async () => {
  await withNonceDir(async (nonceDir) => {
    const { capability } = await loadFixtureCapability({ nonceDir });
    const challenge = freshChallenge();
    const issued = await issueBackendHandshakeResult({
      capability,
      challenge,
      backendEvidence: freshBackendEvidence()
    });
    assert.equal(issued.accepted, true);
    assert.equal(issued.schema_version, AGENT_BACKEND_VERIFIER_HANDSHAKE_RESULT_SCHEMA_VERSION);
    assert.equal(issued.backend_kind, "filesystem_mcp");
    assert.equal(issued.mode, "enforced");
    assert.equal(issued.raw_exec_enabled, false);
    assert.equal(issued.scope_binding, true);
    assert.equal(issued.scope_digest, TEST_SCOPE_DIGEST);
    assert.equal(issued.challenge_nonce, challenge.challenge_nonce);
    assert.ok(issued.integrity.startsWith("hmac-sha256:"));
    assert.ok(issued.handshake_digest.startsWith("sha256:"));

    const verified = verifyBackendHandshakeResult({ capability, result: issued });
    assert.equal(verified.accepted, true);
    assert.equal(verified.handshake_digest, issued.handshake_digest);
    assert.equal(verified.integrity, issued.integrity);
  });
});

test("mutating any field, nonce, or scope digest in a verifier-issued result rejects verification", async () => {
  await withNonceDir(async (nonceDir) => {
    const { capability } = await loadFixtureCapability({ nonceDir });
    const mutationsByField = {
      backend_id: "attacker-controlled-backend",
      backend_version: "9.9.9",
      challenge_nonce: "mutated-challenge-nonce",
      status: "unavailable",
      mode: "advisory",
      raw_exec_enabled: true,
      scope_binding: false,
      scope_digest: "sha256:attacker-substituted-scope",
      validation_transport: "unsupported",
      provenance_sink: "path",
      nonce: "attacker-substituted-nonce",
      tool_surface: { read: false, write: false, structured_validation: false, final_report: false }
    };
    for (const [field, mutation] of Object.entries(mutationsByField)) {
      const issued = await issueBackendHandshakeResult({
        capability,
        challenge: freshChallenge(),
        backendEvidence: freshBackendEvidence()
      });
      const mutated = { ...issued, [field]: mutation };
      const decision = verifyBackendHandshakeResult({ capability, result: mutated });
      assert.equal(decision.accepted, false, `mutation of ${field} should reject`);

      assert.ok(
        decision.refusal_code === AGENT_BACKEND_VERIFIER_REFUSAL_CODES.INTEGRITY_INVALID ||
          decision.refusal_code === AGENT_BACKEND_VERIFIER_REFUSAL_CODES.RAW_EXEC_FORBIDDEN ||
          decision.refusal_code === AGENT_BACKEND_VERIFIER_REFUSAL_CODES.SCOPE_BINDING_UNAVAILABLE,
        `unexpected refusal_code for ${field}: ${decision.refusal_code}`
      );
    }
  });
});

test("mutating handshake_digest alone rejects verification", async () => {
  await withNonceDir(async (nonceDir) => {
    const { capability } = await loadFixtureCapability({ nonceDir });
    const issued = await issueBackendHandshakeResult({
      capability,
      challenge: freshChallenge(),
      backendEvidence: freshBackendEvidence()
    });
    const mutated = { ...issued, handshake_digest: "sha256:attacker-substituted-digest" };
    const decision = verifyBackendHandshakeResult({ capability, result: mutated });
    assert.equal(decision.accepted, false);
    assert.equal(decision.refusal_code, AGENT_BACKEND_VERIFIER_REFUSAL_CODES.INTEGRITY_INVALID);
  });
});

test("reused challenge nonces refuse on the second issuance", async () => {
  await withNonceDir(async (nonceDir) => {
    const { capability } = await loadFixtureCapability({ nonceDir });
    const challenge = freshChallenge();
    const first = await issueBackendHandshakeResult({
      capability,
      challenge,
      backendEvidence: freshBackendEvidence()
    });
    assert.equal(first.accepted, true);

    const replay = await issueBackendHandshakeResult({
      capability,
      challenge,
      backendEvidence: freshBackendEvidence()
    });
    assert.equal(replay.accepted, false);
    assert.equal(replay.refusal_code, AGENT_BACKEND_VERIFIER_REFUSAL_CODES.CHALLENGE_NONCE_REUSED);
    assert.equal(replay.schema_version, AGENT_BACKEND_VERIFIER_REFUSAL_SCHEMA_VERSION);
  });
});

test("missing capability rejects both issuance and verification", async () => {
  await withNonceDir(async (nonceDir) => {
    const { capability } = await loadFixtureCapability({ nonceDir });
    const issueRefusal = await issueBackendHandshakeResult({
      capability: null,
      challenge: freshChallenge(),
      backendEvidence: freshBackendEvidence()
    });
    assert.equal(issueRefusal.accepted, false);
    assert.equal(issueRefusal.refusal_code, AGENT_BACKEND_VERIFIER_REFUSAL_CODES.CAPABILITY_MISSING);

    const issued = await issueBackendHandshakeResult({
      capability,
      challenge: freshChallenge(),
      backendEvidence: freshBackendEvidence()
    });
    const verifyRefusal = verifyBackendHandshakeResult({
      capability: { fake: true },
      result: issued
    });
    assert.equal(verifyRefusal.accepted, false);
    assert.equal(verifyRefusal.refusal_code, AGENT_BACKEND_VERIFIER_REFUSAL_CODES.CAPABILITY_MISSING);
  });
});

test("missing or invalid challenge nonce rejects issuance with the stable refusal payload", async () => {
  await withNonceDir(async (nonceDir) => {
    const { capability } = await loadFixtureCapability({ nonceDir });
    const missing = await issueBackendHandshakeResult({
      capability,
      challenge: freshChallenge({ challenge_nonce: "" }),
      backendEvidence: freshBackendEvidence()
    });
    assert.equal(missing.accepted, false);
    assert.equal(missing.refusal_code, AGENT_BACKEND_VERIFIER_REFUSAL_CODES.CHALLENGE_NONCE_MISSING);

    const invalid = await issueBackendHandshakeResult({
      capability,
      challenge: freshChallenge({ challenge_nonce: "has spaces and !!" }),
      backendEvidence: freshBackendEvidence()
    });
    assert.equal(invalid.accepted, false);
    assert.equal(invalid.refusal_code, AGENT_BACKEND_VERIFIER_REFUSAL_CODES.CHALLENGE_NONCE_INVALID);
  });
});

test("scope digest binding is required: backend evidence must bind the same digest as the challenge", async () => {
  await withNonceDir(async (nonceDir) => {
    const { capability } = await loadFixtureCapability({ nonceDir });
    const refusal = await issueBackendHandshakeResult({
      capability,
      challenge: freshChallenge(),
      backendEvidence: freshBackendEvidence({ bound_scope_digest: "sha256:wrong-digest" })
    });
    assert.equal(refusal.accepted, false);
    assert.equal(refusal.refusal_code, AGENT_BACKEND_VERIFIER_REFUSAL_CODES.SCOPE_BINDING_UNAVAILABLE);
  });
});

test("scope_binding=false on backend evidence rejects issuance", async () => {
  await withNonceDir(async (nonceDir) => {
    const { capability } = await loadFixtureCapability({ nonceDir });
    const refusal = await issueBackendHandshakeResult({
      capability,
      challenge: freshChallenge(),
      backendEvidence: freshBackendEvidence({ scope_binding: false })
    });
    assert.equal(refusal.accepted, false);
    assert.equal(refusal.refusal_code, AGENT_BACKEND_VERIFIER_REFUSAL_CODES.SCOPE_BINDING_UNAVAILABLE);
  });
});

test("WK-0526 refuseCallerSuppliedVerifierIdentity is the WK-0532 caller_supplied_role refusal", () => {
  const refusal = refuseCallerSuppliedVerifierIdentity({
    request: { role: "worker" }
  });
  assert.ok(refusal);
  assert.equal(
    refusal.refusal_code,
    AGENT_BACKEND_VERIFIER_REFUSAL_CODES.CALLER_SUPPLIED_IDENTITY
  );
  assert.equal(
    AGENT_BACKEND_VERIFIER_REFUSAL_CODES.CALLER_SUPPLIED_IDENTITY,
    IDENTITY_REFUSAL_CODES.CALLER_SUPPLIED_ROLE
  );
  assert.equal(refusal.detail.carrier, "request.role");
  assert.equal(refuseCallerSuppliedVerifierIdentity({ request: {} }), null);
});

test("WK-0526 issueBackendHandshakeResult refuses caller-supplied identity smuggled in the challenge", async () => {
  await withNonceDir(async (nonceDir) => {
    const { capability } = await loadFixtureCapability({ nonceDir });
    const refusal = await issueBackendHandshakeResult({
      capability,
      challenge: freshChallenge({ role: "worker" }),
      backendEvidence: freshBackendEvidence()
    });
    assert.equal(refusal.accepted, false);
    assert.equal(
      refusal.refusal_code,
      AGENT_BACKEND_VERIFIER_REFUSAL_CODES.CALLER_SUPPLIED_IDENTITY
    );
  });
});

test("WK-0526 issueBackendHandshakeResult refuses caller-supplied identity smuggled in backendEvidence", async () => {
  await withNonceDir(async (nonceDir) => {
    const { capability } = await loadFixtureCapability({ nonceDir });
    const refusal = await issueBackendHandshakeResult({
      capability,
      challenge: freshChallenge(),
      backendEvidence: freshBackendEvidence({ caller_role: "worker" })
    });
    assert.equal(refusal.accepted, false);
    assert.equal(
      refusal.refusal_code,
      AGENT_BACKEND_VERIFIER_REFUSAL_CODES.CALLER_SUPPLIED_IDENTITY
    );
  });
});

test("WK-0526 verifyBackendHandshakeResult refuses caller-supplied identity smuggled in the result", async () => {
  await withNonceDir(async (nonceDir) => {
    const { capability } = await loadFixtureCapability({ nonceDir });
    const issued = await issueBackendHandshakeResult({
      capability,
      challenge: freshChallenge(),
      backendEvidence: freshBackendEvidence()
    });
    assert.equal(issued.accepted, true);
    const decision = verifyBackendHandshakeResult({
      capability,
      result: { ...issued, role: "worker" }
    });
    assert.equal(decision.accepted, false);
    assert.equal(
      decision.refusal_code,
      AGENT_BACKEND_VERIFIER_REFUSAL_CODES.CALLER_SUPPLIED_IDENTITY
    );
  });
});

test("expired results reject verification even with intact integrity", async () => {
  await withNonceDir(async (nonceDir) => {
    const { capability } = await loadFixtureCapability({ nonceDir });
    const issued = await issueBackendHandshakeResult({
      capability,
      challenge: freshChallenge(),
      backendEvidence: freshBackendEvidence(),
      now: new Date(Date.now() - 120_000),
      ttlSeconds: 60
    });
    assert.equal(issued.accepted, true);
    const decision = verifyBackendHandshakeResult({ capability, result: issued });
    assert.equal(decision.accepted, false);
    assert.equal(decision.refusal_code, AGENT_BACKEND_VERIFIER_REFUSAL_CODES.RESULT_EXPIRED);
  });
});
