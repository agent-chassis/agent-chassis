

import {
  AGENT_BACKEND_DECISION_SCHEMA_VERSION,
  AGENT_BACKEND_DECISION_SEVERITIES,
  AGENT_BACKEND_DECISION_CODES,
  DEFAULT_FILESYSTEM_MCP_BACKEND_ID,
  DEFAULT_FILESYSTEM_MCP_BACKEND_VERSION
} from "./agent-backend-constants.mjs";
import {
  cloneJson,
  isObject,
  isNonEmptyString,
  createDiagnostic,
  normalizeDiagnosticProbe,
  buildOrThrow
} from "./agent-backend-primitives.mjs";
import { normalizeBackendKind } from "./agent-backend-request.mjs";
import {
  normalizeDecisionMode,
  normalizeAgentBackendHandshakeResultInput
} from "./agent-backend-handshake.mjs";
import { verifyFilesystemMcpHandshakeWithCapability } from "./agent-backend-verifier-integration.mjs";

function normalizeDecisionCode(code, diagnostics) {
  if (!isNonEmptyString(code)) {
    return null;
  }
  const trimmed = code.trim();
  return AGENT_BACKEND_DECISION_CODES.includes(trimmed) ? trimmed : null;
}

function normalizeDecisionOutcome(input, diagnostics) {
  const allowed = typeof input.allowed === "boolean"
    ? input.allowed
    : input.decision === "allow" || input.action === "allow"
      ? true
      : input.decision === "refuse" || input.action === "refuse"
        ? false
        : null;

  if (allowed === null) {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "decision payload must include allowed, decision, or action",
        "allowed"
      )
    );
    return null;
  }
  return allowed;
}

function normalizeDecisionSeverity(input, diagnostics) {
  const severity = isNonEmptyString(input.severity) ? input.severity.trim() : null;
  if (severity === null) {
    return null;
  }
  if (!AGENT_BACKEND_DECISION_SEVERITIES.includes(severity)) {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "decision severity must be info, warning, or error",
        "severity"
      )
    );
    return null;
  }
  return severity;
}

function normalizeDecisionProvenance(input, diagnostics, backendKind, request) {
  if (!isObject(input.provenance)) {
    const rawExecEnabled = isObject(request?.tools) && typeof request.tools.raw_exec_enabled === "boolean"
      ? request.tools.raw_exec_enabled
      : false;
    return {
      normalized_input_digest: isObject(request?.evidence) && isNonEmptyString(request.evidence.normalized_input_digest)
        ? request.evidence.normalized_input_digest.trim()
        : null,
      scope_digest: isObject(request?.evidence) && isNonEmptyString(request.evidence.scope_digest)
        ? request.evidence.scope_digest.trim()
        : null,
      profile: isNonEmptyString(input.profile) ? input.profile.trim() : isNonEmptyString(request?.agent?.profile) ? request.agent.profile : null,
      model: request?.agent?.model ?? null,
      raw_exec_enabled: rawExecEnabled
    };
  }

  const provenance = input.provenance;
  const normalized = {};
  for (const key of ["normalized_input_digest", "scope_digest", "profile", "model"]) {
    if (key in provenance) {
      if (provenance[key] === null) {
        normalized[key] = null;
      } else if (isNonEmptyString(provenance[key])) {
        normalized[key] = provenance[key].trim();
      } else {
        diagnostics.push(
          createDiagnostic(
            "invalid_agent_backend_input",
            `${key} must be a non-empty string when present`,
            `provenance.${key}`
          )
        );
        return null;
      }
    }
  }
  const rawExecEnabled = provenance.raw_exec_enabled === undefined ? false : Boolean(provenance.raw_exec_enabled);
  if (backendKind === "filesystem_mcp" && rawExecEnabled !== false) {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "filesystem_mcp provenance.raw_exec_enabled must be false",
        "provenance.raw_exec_enabled"
      )
    );
    return null;
  }

  normalized.raw_exec_enabled = backendKind === "filesystem_mcp" ? false : rawExecEnabled;
  return normalized;
}

function normalizeFilesystemMcpHandshakeForDecision(input, diagnostics, request, provenance) {
  const handshakeInput = isObject(input.handshake)
    ? input.handshake
    : isObject(input.backend_handshake)
      ? input.backend_handshake
      : null;
  if (!handshakeInput) {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "filesystem_mcp allowed decisions require a handshake",
        "handshake"
      )
    );
    return null;
  }

  const handshake = normalizeAgentBackendHandshakeResultInput(handshakeInput);
  if (!handshake.ok) {
    diagnostics.push(...handshake.diagnostics);
    return null;
  }

  const value = handshake.value;
  if (value.backend_kind !== "filesystem_mcp") {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "filesystem_mcp allowed decisions require a filesystem_mcp handshake",
        "handshake.backend_kind"
      )
    );
    return null;
  }

  if (value.backend_id !== (isNonEmptyString(input.backend_id ?? input.backendId)
    ? String(input.backend_id ?? input.backendId).trim()
    : DEFAULT_FILESYSTEM_MCP_BACKEND_ID)) {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "filesystem_mcp allowed decisions require a matching backend_id",
        "handshake.backend_id"
      )
    );
    return null;
  }

  if (value.backend_version !== (isNonEmptyString(input.backend_version ?? input.backendVersion)
    ? String(input.backend_version ?? input.backendVersion).trim()
    : DEFAULT_FILESYSTEM_MCP_BACKEND_VERSION)) {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "filesystem_mcp allowed decisions require a matching backend_version",
        "handshake.backend_version"
      )
    );
    return null;
  }

  if (value.status !== "available") {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "filesystem_mcp allowed decisions require an available handshake",
        "handshake.status"
      )
    );
    return null;
  }

  if (value.mode !== "enforced") {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "filesystem_mcp allowed decisions require enforced handshake mode",
        "handshake.mode"
      )
    );
    return null;
  }

  if (value.raw_exec_enabled !== false) {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "filesystem_mcp allowed decisions require raw_exec_enabled false",
        "handshake.raw_exec_enabled"
      )
    );
    return null;
  }

  if (value.scope_binding !== true) {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "filesystem_mcp allowed decisions require scope_binding true",
        "handshake.scope_binding"
      )
    );
    return null;
  }

  const requestProfile = isNonEmptyString(request?.agent?.profile)
    ? request.agent.profile
    : isNonEmptyString(input.profile)
      ? String(input.profile).trim()
      : isNonEmptyString(provenance?.profile)
        ? provenance.profile
        : null;
  const handshakeProfile = isNonEmptyString(value.request?.agent?.profile)
    ? value.request.agent.profile
    : null;
  if (requestProfile && handshakeProfile && requestProfile !== handshakeProfile) {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "filesystem_mcp allowed decisions require a matching agent profile",
        "handshake.request.agent.profile"
      )
    );
    return null;
  }

  const scopeDigest = isNonEmptyString(provenance?.scope_digest)
    ? provenance.scope_digest
    : isObject(request?.evidence) && isNonEmptyString(request.evidence.scope_digest)
      ? request.evidence.scope_digest.trim()
      : null;
  if (!scopeDigest) {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "filesystem_mcp allowed decisions require a scope digest",
        "provenance.scope_digest"
      )
    );
    return null;
  }

  if (value.scope_digest !== scopeDigest) {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "filesystem_mcp allowed decisions require a matching handshake scope digest",
        "handshake.scope_digest"
      )
    );
    return null;
  }

  const acceptedHandshakeDigest = isNonEmptyString(input.accepted_handshake_digest ?? input.acceptedHandshakeDigest)
    ? String(input.accepted_handshake_digest ?? input.acceptedHandshakeDigest).trim()
    : null;
  if (acceptedHandshakeDigest && acceptedHandshakeDigest !== value.handshake_digest) {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "accepted_handshake_digest must match the handshake digest",
        "accepted_handshake_digest"
      )
    );
    return null;
  }

  if (Date.parse(value.expires_at) <= Date.now()) {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "filesystem_mcp allowed decisions require a non-expired handshake",
        "handshake.expires_at"
      )
    );
    return null;
  }

  return {
    accepted_handshake_digest: value.handshake_digest,
    handshake: value
  };
}

function normalizeDecisionDiagnostic(input, diagnostics) {
  const probe = normalizeDiagnosticProbe(
    input.local_cli_probe ?? input.localCliProbe ?? input.diagnostic?.local_cli_probe ?? input.diagnostic?.localCliProbe,
    diagnostics
  );
  if (!probe) {
    return null;
  }
  return { local_cli_probe: probe };
}

function inferDecisionCode({ backendKind, allowed, reason, effect }) {
  if (allowed) {
    return backendKind === "local_cli"
      ? "agent_backend.local_cli.operator_only.v1"
      : `agent_backend.${backendKind}.allowed.v1`;
  }

  const text = `${reason ?? ""} ${effect ?? ""}`.toLowerCase();
  if (text.includes("raw exec") || text.includes("raw_exec") || text.includes("exec required")) {
    return "agent_backend.filesystem_mcp.raw_exec_required_but_disabled.v1";
  }
  if (text.includes("socket") || text.includes("connect") || text.includes("open")) {
    return "agent_backend.local_cli.socket_failure.v1";
  }
  if (text.includes("operator only")) {
    return "agent_backend.local_cli.operator_only.v1";
  }
  if (
    text.includes("unsupported agent profile")
    || text.includes("unsupported profile")
  ) {
    return "agent_backend.profile.unsupported_agent_profile.v1";
  }
  if (text.includes("unsupported agent family") || text.includes("unsupported family")) {
    return "agent_backend.profile.unsupported_agent_family.v1";
  }
  if (text.includes("misconfig") || text.includes("invalid") || text.includes("malformed")) {
    return "agent_backend.filesystem_mcp.misconfigured.v1";
  }
  return backendKind === "local_cli"
    ? "agent_backend.local_cli.operator_only.v1"
    : "agent_backend.filesystem_mcp.unavailable.v1";
}

const INTERNAL_LAUNCHER_DECISION_AUTHORITY = Symbol("agent-backend.internal-launcher-decision-authority");

function normalizeAgentBackendDecisionInput(input, internalOptions = {}) {
  const diagnostics = [];
  if (!isObject(input)) {
    diagnostics.push(createDiagnostic("invalid_agent_backend_input", "decision input must be an object", "input"));
    return { ok: false, diagnostics };
  }

  const launcherAuthority = internalOptions.internalLauncherAuthority === INTERNAL_LAUNCHER_DECISION_AUTHORITY;
  const backendKind = normalizeBackendKind(input.backend_kind ?? input.backendKind, diagnostics);
  const allowed = normalizeDecisionOutcome(input, diagnostics);
  const mode = normalizeDecisionMode(input, diagnostics);
  const severity = normalizeDecisionSeverity(input, diagnostics);
  const decisionCode = normalizeDecisionCode(input.decision_code ?? input.decisionCode, diagnostics);
  const backendId = isNonEmptyString(input.backend_id ?? input.backendId)
    ? String(input.backend_id ?? input.backendId).trim()
    : DEFAULT_FILESYSTEM_MCP_BACKEND_ID;
  const backendVersion = isNonEmptyString(input.backend_version ?? input.backendVersion)
    ? String(input.backend_version ?? input.backendVersion).trim()
    : DEFAULT_FILESYSTEM_MCP_BACKEND_VERSION;
  const effect = isNonEmptyString(input.effect) ? input.effect.trim() : allowed ? "allows_launch" : "blocks_launch";
  const reason = isNonEmptyString(input.reason) ? input.reason.trim() : allowed ? "backend request allowed" : "backend request refused";
  const remediation = input.remediation === null || input.remediation === undefined
    ? null
    : isNonEmptyString(input.remediation)
      ? input.remediation.trim()
      : null;
  if (input.remediation !== null && input.remediation !== undefined && remediation === null) {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "remediation must be a non-empty string when present",
        "remediation"
      )
    );
  }
  const runId = input.run_id === null || input.run_id === undefined
    ? null
    : isNonEmptyString(input.run_id)
      ? input.run_id.trim()
      : null;
  if (input.run_id !== null && input.run_id !== undefined && runId === null) {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "run_id must be a non-empty string when present",
        "run_id"
      )
    );
  }

  const request = isObject(input.request) ? cloneJson(input.request) : null;
  const provenance = normalizeDecisionProvenance(input, diagnostics, backendKind ?? "filesystem_mcp", request);
  const diagnostic = normalizeDecisionDiagnostic(input, diagnostics);
  let acceptedHandshakeDigest = null;
  let handshake = null;
  if (backendKind === "filesystem_mcp" && allowed === true) {
    const handshakeResult = normalizeFilesystemMcpHandshakeForDecision(input, diagnostics, request, provenance);
    if (handshakeResult) {
      acceptedHandshakeDigest = handshakeResult.accepted_handshake_digest;
      handshake = handshakeResult.handshake;
    }

    if (!launcherAuthority) {
      diagnostics.push(
        createDiagnostic(
          "invalid_agent_backend_input",
          "filesystem_mcp allowed.v1 decisions require the launcher-owned verified decision path (buildVerifiedAgentBackendDecisionV1 or buildRegistryBackedVerifiedFilesystemMcpAgentBackendDecisionV1); same-process buildAgentBackendDecisionV1 callers cannot self-mint authority",
          "allowed",
          { authority_refusal_code: "agent_backend.filesystem_mcp.verifier_capability_missing.v1" }
        )
      );
    }
  }
  if (diagnostics.length > 0 || !backendKind || allowed === null || !mode || !provenance) {
    return { ok: false, diagnostics };
  }

  return {
    ok: true,
    diagnostics: [],
    value: {
      schema_version: AGENT_BACKEND_DECISION_SCHEMA_VERSION,
      backend_kind: backendKind,
      backend_id: backendId,
      backend_version: backendVersion,
      mode,
      allowed,
      decision_code: decisionCode ?? inferDecisionCode({
        backendKind,
        allowed,
        reason,
        effect
      }),
      severity: severity ?? (allowed ? "info" : "error"),
      effect,
      reason,
      remediation,
      run_id: runId,
      provenance,
      accepted_handshake_digest: acceptedHandshakeDigest,
      handshake,
      diagnostic
    }
  };
}

export function normalizeAgentBackendDecisionV1(input = {}) {
  return normalizeAgentBackendDecisionInput(input);
}

export function buildAgentBackendDecisionV1(input = {}) {
  return buildOrThrow(normalizeAgentBackendDecisionV1(input), AGENT_BACKEND_DECISION_SCHEMA_VERSION);
}

export async function normalizeVerifiedAgentBackendDecisionV1(input = {}, options = {}) {
  const shapeResult = normalizeAgentBackendDecisionInput(input, {
    internalLauncherAuthority: INTERNAL_LAUNCHER_DECISION_AUTHORITY
  });
  if (!shapeResult.ok) {
    return shapeResult;
  }
  const value = shapeResult.value;
  if (value.backend_kind !== "filesystem_mcp" || value.allowed !== true) {
    return shapeResult;
  }

  const rawHandshake = isObject(input.handshake)
    ? input.handshake
    : isObject(input.backend_handshake)
      ? input.backend_handshake
      : value.handshake;
  const requestForVerifier = isObject(input.request) ? input.request : value.handshake?.request ?? null;

  const verification = await verifyFilesystemMcpHandshakeWithCapability({
    handshake: rawHandshake,
    normalizedHandshake: value.handshake,
    request: requestForVerifier,
    options
  });
  if (verification.ok) {
    return shapeResult;
  }
  return {
    ok: true,
    diagnostics: [],
    value: {
      ...value,
      allowed: false,
      decision_code: verification.decision_code,
      severity: "error",
      effect: "blocks_launch",
      reason: verification.reason,
      accepted_handshake_digest: null,
      handshake: null
    }
  };
}

export async function buildVerifiedAgentBackendDecisionV1(input = {}, options = {}) {
  const result = await normalizeVerifiedAgentBackendDecisionV1(input, options);
  return buildOrThrow(result, AGENT_BACKEND_DECISION_SCHEMA_VERSION);
}
