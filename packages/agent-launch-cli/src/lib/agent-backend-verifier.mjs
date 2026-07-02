import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { canonicalizeJson, RoleGuardError } from "@agent-chassis/agent-launch-core/src/lib/role-guard.mjs";
import {
  createLauncherContextNonceStore,
  createWorkerFamilyTrustedLauncherContextNonceStore,
  loadLauncherRoleGuardSecret,
  loadWorkerFamilyTrustedLauncherRoleGuardSecret
} from "@agent-chassis/agent-launch-core/src/lib/launcher-context-mint.mjs";
import {
  IDENTITY_REFUSAL_CODES,
  refuseCallerSuppliedIdentityFields
} from "@agent-chassis/wiki-core/src/lib/agent-dispatch-identity.mjs";

export const AGENT_BACKEND_VERIFIER_HANDSHAKE_RESULT_SCHEMA_VERSION = "agent-backend-handshake-result.v1";
export const AGENT_BACKEND_VERIFIER_CHALLENGE_SCHEMA_VERSION = "agent-backend-handshake.v1";

export const AGENT_BACKEND_VERIFIER_REFUSAL_SCHEMA_VERSION = "agent-backend-verifier-refusal.v1";

export const AGENT_BACKEND_VERIFIER_REFUSAL_CODES = Object.freeze({
  CAPABILITY_MISSING: "agent_backend_verifier.capability_missing.v1",
  SECRET_MISSING: "agent_backend_verifier.secret_missing.v1",
  CHALLENGE_INVALID: "agent_backend_verifier.challenge_invalid.v1",
  CHALLENGE_NONCE_MISSING: "agent_backend_verifier.challenge_nonce_missing.v1",
  CHALLENGE_NONCE_INVALID: "agent_backend_verifier.challenge_nonce_invalid.v1",
  CHALLENGE_NONCE_REUSED: "agent_backend_verifier.challenge_nonce_reused.v1",
  BACKEND_EVIDENCE_INVALID: "agent_backend_verifier.backend_evidence_invalid.v1",
  BACKEND_UNAVAILABLE: "agent_backend_verifier.backend_unavailable.v1",
  SCOPE_BINDING_UNAVAILABLE: "agent_backend_verifier.scope_binding_unavailable.v1",
  RAW_EXEC_FORBIDDEN: "agent_backend_verifier.raw_exec_forbidden.v1",
  INTEGRITY_INVALID: "agent_backend_verifier.integrity_invalid.v1",
  RESULT_MUTATED: "agent_backend_verifier.result_mutated.v1",
  RESULT_EXPIRED: "agent_backend_verifier.result_expired.v1",
  SCHEMA_INVALID: "agent_backend_verifier.schema_invalid.v1",

  CALLER_SUPPLIED_IDENTITY: IDENTITY_REFUSAL_CODES.CALLER_SUPPLIED_ROLE
});

export function refuseCallerSuppliedVerifierIdentity(request) {
  const refusal = refuseCallerSuppliedIdentityFields(request);
  if (refusal === null) {
    return null;
  }
  return Object.freeze({
    schema_version: AGENT_BACKEND_VERIFIER_REFUSAL_SCHEMA_VERSION,
    accepted: false,
    refusal_code: AGENT_BACKEND_VERIFIER_REFUSAL_CODES.CALLER_SUPPLIED_IDENTITY,
    refusal_message: refusal.refusal_message,
    detail: refusal.detail ?? null
  });
}

const NONCE_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const CAPABILITY_BRAND = Symbol("agent_backend_verifier.capability");
const CAPABILITY_REGISTRY = new WeakSet();
const CAPABILITY_STATE = new WeakMap();

const HANDSHAKE_FIELD_ORDER = Object.freeze([
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
  "nonce"
]);

const HANDSHAKE_REQUIRED_FIELDS = Object.freeze(new Set(HANDSHAKE_FIELD_ORDER));

const SCOPED_TOOL_SURFACE_KEYS = Object.freeze(["read", "write", "structured_validation", "final_report"]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function safeEqualStrings(left, right) {
  if (typeof left !== "string" || typeof right !== "string") {
    return false;
  }
  const leftBuf = Buffer.from(left);
  const rightBuf = Buffer.from(right);
  if (leftBuf.length !== rightBuf.length) {
    return false;
  }
  return timingSafeEqual(leftBuf, rightBuf);
}

function buildRefusal(code, message, detail = null) {
  const refusal = {
    schema_version: AGENT_BACKEND_VERIFIER_REFUSAL_SCHEMA_VERSION,
    accepted: false,
    refusal_code: code,
    refusal_message: message
  };
  if (detail !== null) {
    refusal.detail = detail;
  }
  return Object.freeze(refusal);
}

function computeHandshakeDigest(payloadWithoutDigestOrIntegrity) {
  const digest = createHash("sha256").update(canonicalizeJson(payloadWithoutDigestOrIntegrity)).digest("base64url");
  return `sha256:${digest}`;
}

function signHandshakeResult(payloadWithoutIntegrity, secret) {
  const mac = createHmac("sha256", secret).update(canonicalizeJson(payloadWithoutIntegrity)).digest("base64url");
  return `hmac-sha256:${mac}`;
}

function cloneWithoutKeys(value, keys) {
  const clone = { ...value };
  for (const key of keys) {
    delete clone[key];
  }
  return clone;
}

function checkScopedToolSurfaceShape(toolSurface, pathLabel) {
  if (!isPlainObject(toolSurface)) {
    return `${pathLabel} is required and must be an object`;
  }
  for (const key of SCOPED_TOOL_SURFACE_KEYS) {
    if (typeof toolSurface[key] !== "boolean") {
      return `${pathLabel}.${key} must be a boolean`;
    }
  }
  for (const key of Object.keys(toolSurface)) {
    if (!SCOPED_TOOL_SURFACE_KEYS.includes(key)) {
      return `${pathLabel} includes unsupported field: ${key}`;
    }
  }
  return null;
}

export async function loadLauncherVerifierCapability({
  secret,
  nonceStore,
  trusted = false,
  workspaceDir,
  env = process.env
} = {}) {

  const secretLoader = trusted
    ? () => loadWorkerFamilyTrustedLauncherRoleGuardSecret(workspaceDir)
    : () => loadLauncherRoleGuardSecret(workspaceDir);
  const nonceStoreFactory = trusted
    ? () => createWorkerFamilyTrustedLauncherContextNonceStore(workspaceDir, env)
    : () => createLauncherContextNonceStore();
  let secretMaterial = secret;
  if (secretMaterial === undefined) {
    try {
      secretMaterial = await secretLoader();
    } catch (error) {
      if (error instanceof RoleGuardError && error.code === "launcher_context_secret_missing") {
        const refusalError = new Error(`launcher verifier secret unavailable: ${error.message}`);
        refusalError.code = AGENT_BACKEND_VERIFIER_REFUSAL_CODES.SECRET_MISSING;
        throw refusalError;
      }
      throw error;
    }
  }
  if (!isNonEmptyString(secretMaterial)) {
    const error = new Error("launcher verifier secret is empty");
    error.code = AGENT_BACKEND_VERIFIER_REFUSAL_CODES.SECRET_MISSING;
    throw error;
  }
  const store = nonceStore ?? await nonceStoreFactory();
  if (!store || typeof store.checkAndMark !== "function") {
    const error = new Error("launcher verifier nonce store is unavailable");
    error.code = AGENT_BACKEND_VERIFIER_REFUSAL_CODES.SCHEMA_INVALID;
    throw error;
  }
  const capability = Object.freeze({ [CAPABILITY_BRAND]: true });
  CAPABILITY_REGISTRY.add(capability);
  CAPABILITY_STATE.set(capability, { secret: secretMaterial, nonceStore: store });
  return capability;
}

export function hasLauncherVerifierCapability(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  return CAPABILITY_REGISTRY.has(value);
}

function validateChallenge(challenge) {
  if (!isPlainObject(challenge)) {
    return buildRefusal(
      AGENT_BACKEND_VERIFIER_REFUSAL_CODES.CHALLENGE_INVALID,
      "challenge is required and must be an object"
    );
  }
  if (challenge.schema_version !== AGENT_BACKEND_VERIFIER_CHALLENGE_SCHEMA_VERSION) {
    return buildRefusal(
      AGENT_BACKEND_VERIFIER_REFUSAL_CODES.CHALLENGE_INVALID,
      `challenge schema_version must be ${AGENT_BACKEND_VERIFIER_CHALLENGE_SCHEMA_VERSION}`
    );
  }
  if (challenge.backend_kind !== "filesystem_mcp") {
    return buildRefusal(
      AGENT_BACKEND_VERIFIER_REFUSAL_CODES.CHALLENGE_INVALID,
      "challenge backend_kind must be filesystem_mcp"
    );
  }
  if (!isNonEmptyString(challenge.challenge_nonce)) {
    return buildRefusal(
      AGENT_BACKEND_VERIFIER_REFUSAL_CODES.CHALLENGE_NONCE_MISSING,
      "challenge_nonce is required"
    );
  }
  if (!NONCE_PATTERN.test(challenge.challenge_nonce)) {
    return buildRefusal(
      AGENT_BACKEND_VERIFIER_REFUSAL_CODES.CHALLENGE_NONCE_INVALID,
      "challenge_nonce does not match the accepted nonce grammar"
    );
  }
  if (!isNonEmptyString(challenge.normalized_scope_digest)) {
    return buildRefusal(
      AGENT_BACKEND_VERIFIER_REFUSAL_CODES.CHALLENGE_INVALID,
      "challenge normalized_scope_digest is required"
    );
  }
  if (challenge.raw_exec_enabled === true) {
    return buildRefusal(
      AGENT_BACKEND_VERIFIER_REFUSAL_CODES.RAW_EXEC_FORBIDDEN,
      "filesystem_mcp challenges must not request raw exec"
    );
  }
  return null;
}

function validateBackendEvidence(evidence, challenge) {
  if (!isPlainObject(evidence)) {
    return buildRefusal(
      AGENT_BACKEND_VERIFIER_REFUSAL_CODES.BACKEND_EVIDENCE_INVALID,
      "backendEvidence is required and must be an object"
    );
  }
  if (evidence.backend_kind !== "filesystem_mcp") {
    return buildRefusal(
      AGENT_BACKEND_VERIFIER_REFUSAL_CODES.BACKEND_EVIDENCE_INVALID,
      "backendEvidence.backend_kind must be filesystem_mcp"
    );
  }
  if (!isNonEmptyString(evidence.backend_id) || !isNonEmptyString(evidence.backend_version)) {
    return buildRefusal(
      AGENT_BACKEND_VERIFIER_REFUSAL_CODES.BACKEND_EVIDENCE_INVALID,
      "backendEvidence requires non-empty backend_id and backend_version"
    );
  }
  if (evidence.status === "unavailable" || evidence.status === "misconfigured") {
    return buildRefusal(
      AGENT_BACKEND_VERIFIER_REFUSAL_CODES.BACKEND_UNAVAILABLE,
      `backend reported status=${evidence.status}`,
      { backend_status: evidence.status }
    );
  }
  if (evidence.status !== "available") {
    return buildRefusal(
      AGENT_BACKEND_VERIFIER_REFUSAL_CODES.BACKEND_EVIDENCE_INVALID,
      "backendEvidence.status must be available, unavailable, or misconfigured"
    );
  }
  if (evidence.raw_exec_enabled === true) {
    return buildRefusal(
      AGENT_BACKEND_VERIFIER_REFUSAL_CODES.RAW_EXEC_FORBIDDEN,
      "filesystem_mcp backend evidence must report raw_exec_enabled false"
    );
  }
  const toolSurfaceShape = checkScopedToolSurfaceShape(evidence.tool_surface, "backendEvidence.tool_surface");
  if (toolSurfaceShape !== null) {
    return buildRefusal(
      AGENT_BACKEND_VERIFIER_REFUSAL_CODES.BACKEND_EVIDENCE_INVALID,
      toolSurfaceShape
    );
  }
  if (evidence.scope_binding !== true) {
    return buildRefusal(
      AGENT_BACKEND_VERIFIER_REFUSAL_CODES.SCOPE_BINDING_UNAVAILABLE,
      "backend cannot bind the requested scope (scope_binding !== true)"
    );
  }
  if (!isNonEmptyString(evidence.bound_scope_digest)) {
    return buildRefusal(
      AGENT_BACKEND_VERIFIER_REFUSAL_CODES.SCOPE_BINDING_UNAVAILABLE,
      "backendEvidence.bound_scope_digest is required to prove scope binding"
    );
  }
  if (!safeEqualStrings(evidence.bound_scope_digest, challenge.normalized_scope_digest)) {
    return buildRefusal(
      AGENT_BACKEND_VERIFIER_REFUSAL_CODES.SCOPE_BINDING_UNAVAILABLE,
      "backend bound_scope_digest does not match challenge normalized_scope_digest"
    );
  }
  return null;
}

export async function issueBackendHandshakeResult({
  capability,
  challenge,
  backendEvidence,
  now = new Date(),
  ttlSeconds = 60
} = {}) {
  if (!hasLauncherVerifierCapability(capability)) {
    return buildRefusal(
      AGENT_BACKEND_VERIFIER_REFUSAL_CODES.CAPABILITY_MISSING,
      "launcher-owned verifier capability is required"
    );
  }

  const challengeIdentityRefusal = refuseCallerSuppliedVerifierIdentity(
    challenge && typeof challenge === "object" ? { request: challenge } : null
  );
  if (challengeIdentityRefusal) {
    return challengeIdentityRefusal;
  }
  const evidenceIdentityRefusal = refuseCallerSuppliedVerifierIdentity(
    backendEvidence && typeof backendEvidence === "object" ? { request: backendEvidence } : null
  );
  if (evidenceIdentityRefusal) {
    return evidenceIdentityRefusal;
  }
  const challengeRefusal = validateChallenge(challenge);
  if (challengeRefusal) {
    return challengeRefusal;
  }
  const evidenceRefusal = validateBackendEvidence(backendEvidence, challenge);
  if (evidenceRefusal) {
    return evidenceRefusal;
  }

  const state = CAPABILITY_STATE.get(capability);
  const createdAt = (now instanceof Date ? now : new Date(now)).toISOString();
  const expiresAt = new Date(new Date(createdAt).getTime() + ttlSeconds * 1000).toISOString();

  const accepted = await state.nonceStore.checkAndMark(challenge.challenge_nonce, expiresAt);
  if (!accepted) {
    return buildRefusal(
      AGENT_BACKEND_VERIFIER_REFUSAL_CODES.CHALLENGE_NONCE_REUSED,
      "challenge_nonce was already consumed by a previous verifier issuance"
    );
  }

  const validationTransport = isNonEmptyString(challenge.validation_transport)
    ? challenge.validation_transport
    : "argv";
  const provenanceSink = isNonEmptyString(challenge.provenance_sink)
    ? challenge.provenance_sink
    : "launcher_owned";
  const resultNonce = randomBytes(16).toString("base64url");

  const partial = {
    schema_version: AGENT_BACKEND_VERIFIER_HANDSHAKE_RESULT_SCHEMA_VERSION,
    backend_kind: "filesystem_mcp",
    backend_id: backendEvidence.backend_id,
    backend_version: backendEvidence.backend_version,
    challenge_nonce: challenge.challenge_nonce,
    status: "available",
    mode: "enforced",
    raw_exec_enabled: false,
    tool_surface: backendEvidence.tool_surface,
    scope_binding: true,
    scope_digest: backendEvidence.bound_scope_digest,
    validation_transport: validationTransport,
    provenance_sink: provenanceSink,
    created_at: createdAt,
    expires_at: expiresAt,
    nonce: resultNonce
  };

  const handshakeDigest = computeHandshakeDigest(partial);
  const withDigest = { ...partial, handshake_digest: handshakeDigest };
  const integrity = signHandshakeResult(withDigest, state.secret);

  return Object.freeze({
    ...withDigest,
    integrity,
    accepted: true
  });
}

export function verifyBackendHandshakeResult({
  capability,
  result,
  now = new Date()
} = {}) {
  if (!hasLauncherVerifierCapability(capability)) {
    return buildRefusal(
      AGENT_BACKEND_VERIFIER_REFUSAL_CODES.CAPABILITY_MISSING,
      "launcher-owned verifier capability is required to verify handshake results"
    );
  }

  const resultIdentityRefusal = refuseCallerSuppliedVerifierIdentity(
    result && typeof result === "object" ? { request: result } : null
  );
  if (resultIdentityRefusal) {
    return resultIdentityRefusal;
  }
  if (!isPlainObject(result)) {
    return buildRefusal(
      AGENT_BACKEND_VERIFIER_REFUSAL_CODES.SCHEMA_INVALID,
      "handshake result is required and must be an object"
    );
  }
  if (result.schema_version !== AGENT_BACKEND_VERIFIER_HANDSHAKE_RESULT_SCHEMA_VERSION) {
    return buildRefusal(
      AGENT_BACKEND_VERIFIER_REFUSAL_CODES.SCHEMA_INVALID,
      `handshake result schema_version must be ${AGENT_BACKEND_VERIFIER_HANDSHAKE_RESULT_SCHEMA_VERSION}`
    );
  }
  for (const field of HANDSHAKE_REQUIRED_FIELDS) {
    if (!(field in result)) {
      return buildRefusal(
        AGENT_BACKEND_VERIFIER_REFUSAL_CODES.SCHEMA_INVALID,
        `handshake result missing required field: ${field}`
      );
    }
  }
  if (!isNonEmptyString(result.integrity)) {
    return buildRefusal(
      AGENT_BACKEND_VERIFIER_REFUSAL_CODES.INTEGRITY_INVALID,
      "handshake result integrity tag is required"
    );
  }
  if (!result.integrity.startsWith("hmac-sha256:")) {
    return buildRefusal(
      AGENT_BACKEND_VERIFIER_REFUSAL_CODES.INTEGRITY_INVALID,
      "handshake result integrity tag must be hmac-sha256:<base64url>"
    );
  }
  if (result.backend_kind !== "filesystem_mcp") {
    return buildRefusal(
      AGENT_BACKEND_VERIFIER_REFUSAL_CODES.SCHEMA_INVALID,
      "handshake result backend_kind must be filesystem_mcp"
    );
  }
  if (result.raw_exec_enabled !== false) {
    return buildRefusal(
      AGENT_BACKEND_VERIFIER_REFUSAL_CODES.RAW_EXEC_FORBIDDEN,
      "filesystem_mcp handshake result must report raw_exec_enabled false"
    );
  }
  if (result.scope_binding !== true) {
    return buildRefusal(
      AGENT_BACKEND_VERIFIER_REFUSAL_CODES.SCOPE_BINDING_UNAVAILABLE,
      "filesystem_mcp handshake result must report scope_binding true"
    );
  }
  const resultToolSurfaceShape = checkScopedToolSurfaceShape(result.tool_surface, "handshake result tool_surface");
  if (resultToolSurfaceShape !== null) {
    return buildRefusal(
      AGENT_BACKEND_VERIFIER_REFUSAL_CODES.SCHEMA_INVALID,
      resultToolSurfaceShape
    );
  }

  const state = CAPABILITY_STATE.get(capability);
  const withoutIntegrity = cloneWithoutKeys(result, ["integrity", "accepted"]);
  const expectedIntegrity = signHandshakeResult(withoutIntegrity, state.secret);
  if (!safeEqualStrings(result.integrity, expectedIntegrity)) {
    return buildRefusal(
      AGENT_BACKEND_VERIFIER_REFUSAL_CODES.INTEGRITY_INVALID,
      "handshake result integrity tag does not match the launcher-held secret"
    );
  }

  const withoutDigestAndIntegrity = cloneWithoutKeys(withoutIntegrity, ["handshake_digest"]);
  const expectedDigest = computeHandshakeDigest(withoutDigestAndIntegrity);
  if (!safeEqualStrings(result.handshake_digest, expectedDigest)) {
    return buildRefusal(
      AGENT_BACKEND_VERIFIER_REFUSAL_CODES.RESULT_MUTATED,
      "handshake result handshake_digest does not match the canonical payload"
    );
  }

  const expiresAtMs = Date.parse(result.expires_at);
  const nowMs = (now instanceof Date ? now : new Date(now)).getTime();
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
    return buildRefusal(
      AGENT_BACKEND_VERIFIER_REFUSAL_CODES.RESULT_EXPIRED,
      "handshake result has expired"
    );
  }

  return Object.freeze({ ...result, accepted: true });
}
