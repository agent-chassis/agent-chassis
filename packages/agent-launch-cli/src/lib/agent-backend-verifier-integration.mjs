

import { isObject, isNonEmptyString } from "./agent-backend-primitives.mjs";
import { TOOL_SURFACE_KEYS } from "./agent-backend-constants.mjs";

let _verifierModule = null;
export async function loadVerifierModule() {
  if (_verifierModule === null) {
    _verifierModule = await import("./agent-backend-verifier.mjs");
  }
  return _verifierModule;
}

const VERIFIER_REFUSAL_TO_DECISION_CODE = Object.freeze({
  "agent_backend_verifier.capability_missing.v1": "agent_backend.filesystem_mcp.verifier_capability_missing.v1",
  "agent_backend_verifier.secret_missing.v1": "agent_backend.filesystem_mcp.verifier_capability_missing.v1",
  "agent_backend_verifier.integrity_invalid.v1": "agent_backend.filesystem_mcp.handshake_integrity_invalid.v1",
  "agent_backend_verifier.result_expired.v1": "agent_backend.filesystem_mcp.handshake_expired.v1",
  "agent_backend_verifier.result_mutated.v1": "agent_backend.filesystem_mcp.handshake_mutated.v1",
  "agent_backend_verifier.schema_invalid.v1": "agent_backend.filesystem_mcp.handshake_schema_invalid.v1",
  "agent_backend_verifier.raw_exec_forbidden.v1": "agent_backend.filesystem_mcp.handshake_raw_exec_forbidden.v1",
  "agent_backend_verifier.scope_binding_unavailable.v1": "agent_backend.filesystem_mcp.handshake_scope_binding_unavailable.v1",
  "agent_backend_verifier.challenge_nonce_reused.v1": "agent_backend.filesystem_mcp.handshake_nonce_reused.v1",
  "agent_backend_verifier.challenge_nonce_invalid.v1": "agent_backend.filesystem_mcp.handshake_schema_invalid.v1",
  "agent_backend_verifier.challenge_nonce_missing.v1": "agent_backend.filesystem_mcp.handshake_schema_invalid.v1",
  "agent_backend_verifier.backend_evidence_invalid.v1": "agent_backend.filesystem_mcp.handshake_schema_invalid.v1",
  "agent_backend_verifier.backend_unavailable.v1": "agent_backend.filesystem_mcp.handshake_schema_invalid.v1",
  "agent_backend_verifier.challenge_invalid.v1": "agent_backend.filesystem_mcp.handshake_schema_invalid.v1"
});

const HANDSHAKE_RESULT_CLOCK_SKEW_MS = 5000;

function buildEffectiveNow(options) {
  const supplied = options?.now;
  if (supplied instanceof Date) {
    return supplied;
  }
  if (typeof supplied === "string" || typeof supplied === "number") {
    const parsed = new Date(supplied);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return new Date();
}

function compareHandshakeToolSurface(expected, actual) {
  if (!isObject(expected)) {
    return { match: true };
  }
  if (!isObject(actual)) {
    return { match: false, reason: "handshake tool_surface is missing or not an object" };
  }
  for (const key of TOOL_SURFACE_KEYS) {
    if (typeof actual[key] !== "boolean") {
      return { match: false, reason: `handshake tool_surface.${key} must be a boolean` };
    }
    if (actual[key] !== Boolean(expected[key])) {
      return {
        match: false,
        reason: `handshake tool_surface.${key} (${actual[key]}) does not match expected (${Boolean(expected[key])})`
      };
    }
  }
  for (const key of Object.keys(actual)) {
    if (!TOOL_SURFACE_KEYS.includes(key)) {
      return { match: false, reason: `handshake tool_surface includes unsupported field ${key}` };
    }
  }
  return { match: true };
}

export async function verifyFilesystemMcpHandshakeWithCapability({
  handshake,
  normalizedHandshake = null,
  request,
  options
}) {
  const capability = options?.verifierCapability;
  const { hasLauncherVerifierCapability, verifyBackendHandshakeResult } = await loadVerifierModule();
  if (!hasLauncherVerifierCapability(capability)) {
    return {
      ok: false,
      decision_code: "agent_backend.filesystem_mcp.verifier_capability_missing.v1",
      reason: "launcher-owned verifier capability is required for filesystem_mcp allowed decisions"
    };
  }

  const verifierInput = { ...handshake };
  delete verifierInput.request;
  delete verifierInput.accepted;

  const now = buildEffectiveNow(options);
  const verification = verifyBackendHandshakeResult({
    capability,
    result: verifierInput,
    now
  });
  if (!verification.accepted) {
    const decisionCode = VERIFIER_REFUSAL_TO_DECISION_CODE[verification.refusal_code]
      ?? "agent_backend.filesystem_mcp.handshake_integrity_invalid.v1";
    return {
      ok: false,
      decision_code: decisionCode,
      reason: verification.refusal_message ?? `verifier refused handshake (${verification.refusal_code})`
    };
  }

  const createdAtMs = Date.parse(handshake.created_at);
  if (Number.isFinite(createdAtMs) && createdAtMs > now.getTime() + HANDSHAKE_RESULT_CLOCK_SKEW_MS) {
    return {
      ok: false,
      decision_code: "agent_backend.filesystem_mcp.handshake_future_dated.v1",
      reason: "handshake created_at is in the future beyond the allowed clock-skew tolerance"
    };
  }

  if (handshake.mode !== "enforced") {
    return {
      ok: false,
      decision_code: "agent_backend.filesystem_mcp.handshake_mode_invalid.v1",
      reason: "filesystem_mcp allowed decisions require enforced handshake mode"
    };
  }

  const expectedProfile = isNonEmptyString(options?.expectedProfile)
    ? options.expectedProfile.trim()
    : isNonEmptyString(request?.agent?.profile)
      ? request.agent.profile
      : null;
  const handshakeProfile = isNonEmptyString(handshake.request?.agent?.profile)
    ? handshake.request.agent.profile
    : null;
  if (expectedProfile && handshakeProfile && expectedProfile !== handshakeProfile) {
    return {
      ok: false,
      decision_code: "agent_backend.filesystem_mcp.handshake_profile_mismatch.v1",
      reason: `handshake profile ${handshakeProfile} does not match request profile ${expectedProfile}`
    };
  }

  const expectedToolSurface = isObject(options?.expectedToolSurface)
    ? options.expectedToolSurface
    : isObject(request?.tools?.filesystem_mcp)
      ? request.tools.filesystem_mcp
      : null;
  if (expectedToolSurface) {
    const surfaceMatch = compareHandshakeToolSurface(expectedToolSurface, handshake.tool_surface);
    if (!surfaceMatch.match) {
      return {
        ok: false,
        decision_code: "agent_backend.filesystem_mcp.handshake_tool_surface_mismatch.v1",
        reason: surfaceMatch.reason
      };
    }
  }

  const nonceStore = options?.nonceStore;
  if (!nonceStore || typeof nonceStore.checkAndMark !== "function") {
    return {
      ok: false,
      decision_code: "agent_backend.filesystem_mcp.nonce_state_unavailable.v1",
      reason: "launcher-owned nonce store is required for filesystem_mcp allowed decisions"
    };
  }
  let nonceAccepted;
  try {
    nonceAccepted = await nonceStore.checkAndMark(handshake.nonce, handshake.expires_at);
  } catch (error) {
    return {
      ok: false,
      decision_code: "agent_backend.filesystem_mcp.nonce_state_unavailable.v1",
      reason: `nonce store failure: ${error?.message ?? error}`
    };
  }
  if (nonceAccepted !== true) {
    return {
      ok: false,
      decision_code: "agent_backend.filesystem_mcp.handshake_nonce_reused.v1",
      reason: "filesystem_mcp handshake result.nonce has already been observed"
    };
  }

  return { ok: true };
}
