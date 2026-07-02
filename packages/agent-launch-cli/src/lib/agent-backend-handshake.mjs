

import {
  AGENT_BACKEND_HANDSHAKE_REQUEST_SCHEMA_VERSION,
  AGENT_BACKEND_HANDSHAKE_RESULT_SCHEMA_VERSION,
  AGENT_BACKEND_HANDSHAKE_STATUSES,
  AGENT_BACKEND_HANDSHAKE_VALIDATION_TRANSPORTS,
  AGENT_BACKEND_DECISION_MODES,
  DEFAULT_FILESYSTEM_MCP_BACKEND_ID,
  DEFAULT_FILESYSTEM_MCP_BACKEND_VERSION
} from "./agent-backend-constants.mjs";
import {
  isObject,
  isNonEmptyString,
  createDiagnostic,
  normalizeIsoTimestamp,
  deriveValidationTransport,
  buildOrThrow
} from "./agent-backend-primitives.mjs";
import {
  normalizeAgentBackendRequestInput,
  normalizeBackendKind,
  normalizeFilesystemMcpToolSurface
} from "./agent-backend-request.mjs";

export function normalizeDecisionMode(input, diagnostics) {
  const mode = isNonEmptyString(input.mode) ? input.mode.trim() : "enforced";
  if (!AGENT_BACKEND_DECISION_MODES.includes(mode)) {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "decision mode must be local, advisory, or enforced",
        "mode"
      )
    );
    return null;
  }
  return mode;
}

export function normalizeAgentBackendHandshakeRequestInput(input) {
  const diagnostics = [];
  if (!isObject(input)) {
    diagnostics.push(createDiagnostic("invalid_agent_backend_input", "handshake request input must be an object", "input"));
    return { ok: false, diagnostics };
  }

  const requestInput = isObject(input.request) ? input.request : input;
  const request = normalizeAgentBackendRequestInput(requestInput);
  if (!request.ok) {
    return request;
  }

  const challengeNonce = isNonEmptyString(input.challenge_nonce ?? input.challengeNonce)
    ? String(input.challenge_nonce ?? input.challengeNonce).trim()
    : null;
  if (!challengeNonce) {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "challenge_nonce is required",
        "challenge_nonce"
      )
    );
  }

  const normalizedScopeDigest = isNonEmptyString(input.normalized_scope_digest ?? input.normalizedScopeDigest)
    ? String(input.normalized_scope_digest ?? input.normalizedScopeDigest).trim()
    : null;
  if (!normalizedScopeDigest) {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "normalized_scope_digest is required",
        "normalized_scope_digest"
      )
    );
  }

  const validationTransport = isNonEmptyString(input.validation_transport ?? input.validationTransport)
    ? String(input.validation_transport ?? input.validationTransport).trim()
    : deriveValidationTransport(request.value.validation);
  if (!AGENT_BACKEND_HANDSHAKE_VALIDATION_TRANSPORTS.includes(validationTransport)) {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "validation_transport must be argv, named, or unsupported",
        "validation_transport"
      )
    );
  }

  const provenanceSink = isNonEmptyString(input.provenance_sink ?? input.provenanceSink)
    ? String(input.provenance_sink ?? input.provenanceSink).trim()
    : request.value.provenance_destination.kind;
  if (!isNonEmptyString(provenanceSink)) {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "provenance_sink is required",
        "provenance_sink"
      )
    );
  }

  const rawExecEnabled = input.raw_exec_enabled === undefined
    ? request.value.tools.raw_exec_enabled
    : Boolean(input.raw_exec_enabled);
  if (request.value.backend_kind === "filesystem_mcp" && rawExecEnabled !== false) {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "filesystem_mcp handshake requests must disable raw exec",
        "raw_exec_enabled"
      )
    );
  }

  if (diagnostics.length > 0) {
    return { ok: false, diagnostics };
  }

  return {
    ok: true,
    diagnostics: [],
    value: {
      schema_version: AGENT_BACKEND_HANDSHAKE_REQUEST_SCHEMA_VERSION,
      backend_kind: request.value.backend_kind,
      challenge_nonce: challengeNonce,
      normalized_scope_digest: normalizedScopeDigest,
      validation_transport: validationTransport,
      provenance_sink: provenanceSink,
      raw_exec_enabled: false,
      requested_role: request.value.agent.role,
      requested_read_scope: request.value.scope.read_scope,
      requested_write_scope: request.value.scope.write_scope,
      request: request.value
    }
  };
}

export function normalizeAgentBackendHandshakeRequestV1(input = {}) {
  return normalizeAgentBackendHandshakeRequestInput(input);
}

export function buildAgentBackendHandshakeRequestV1(input = {}) {
  return buildOrThrow(normalizeAgentBackendHandshakeRequestV1(input), AGENT_BACKEND_HANDSHAKE_REQUEST_SCHEMA_VERSION);
}

export function buildFilesystemMcpAgentBackendHandshakeRequestV1(input = {}) {
  return buildAgentBackendHandshakeRequestV1({
    ...input,
    backend_kind: "filesystem_mcp"
  });
}

export function normalizeAgentBackendHandshakeResultInput(input) {
  const diagnostics = [];
  if (!isObject(input)) {
    diagnostics.push(createDiagnostic("invalid_agent_backend_input", "handshake result input must be an object", "input"));
    return { ok: false, diagnostics };
  }

  const requestInput = isObject(input.request) ? input.request : null;
  const request = requestInput ? normalizeAgentBackendRequestInput(requestInput) : null;
  if (requestInput && !request.ok) {
    return request;
  }

  const backendKind = normalizeBackendKind(input.backend_kind ?? input.backendKind, diagnostics);
  if (backendKind && backendKind !== "filesystem_mcp") {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "handshake results must target filesystem_mcp",
        "backend_kind"
      )
    );
  }

  const backendId = isNonEmptyString(input.backend_id ?? input.backendId)
    ? String(input.backend_id ?? input.backendId).trim()
    : DEFAULT_FILESYSTEM_MCP_BACKEND_ID;
  const backendVersion = isNonEmptyString(input.backend_version ?? input.backendVersion)
    ? String(input.backend_version ?? input.backendVersion).trim()
    : DEFAULT_FILESYSTEM_MCP_BACKEND_VERSION;
  const challengeNonce = isNonEmptyString(input.challenge_nonce ?? input.challengeNonce)
    ? String(input.challenge_nonce ?? input.challengeNonce).trim()
    : null;
  if (!challengeNonce) {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "challenge_nonce is required",
        "challenge_nonce"
      )
    );
  }

  const status = isNonEmptyString(input.status) ? input.status.trim() : null;
  if (!status || !AGENT_BACKEND_HANDSHAKE_STATUSES.includes(status)) {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "status must be available, unavailable, or misconfigured",
        "status"
      )
    );
  }

  const mode = normalizeDecisionMode(input, diagnostics);
  if (backendKind === "filesystem_mcp" && mode && mode !== "enforced") {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "filesystem_mcp handshake results must use enforced mode",
        "mode"
      )
    );
  }
  const rawExecEnabled = input.raw_exec_enabled === undefined
    ? request?.value?.tools?.raw_exec_enabled ?? false
    : Boolean(input.raw_exec_enabled);
  if (backendKind === "filesystem_mcp" && rawExecEnabled !== false) {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "filesystem_mcp handshake results must disable raw exec",
        "raw_exec_enabled"
      )
    );
  }

  const toolSurfaceInput = isObject(input.tool_surface)
    ? input.tool_surface
    : isObject(request?.value?.tools?.filesystem_mcp)
      ? request.value.tools.filesystem_mcp
      : null;
  const toolSurface = toolSurfaceInput
    ? normalizeFilesystemMcpToolSurface(toolSurfaceInput, diagnostics)
    : null;
  if (!toolSurface) {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "tool_surface is required",
        "tool_surface"
      )
    );
  }

  const scopeBinding = typeof input.scope_binding === "boolean"
    ? input.scope_binding
    : typeof input.scopeBinding === "boolean"
      ? input.scopeBinding
      : null;
  if (scopeBinding === null) {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "scope_binding must be a boolean",
        "scope_binding"
      )
    );
  }

  const validationTransport = isNonEmptyString(input.validation_transport ?? input.validationTransport)
    ? String(input.validation_transport ?? input.validationTransport).trim()
    : deriveValidationTransport(request?.value?.validation);
  if (!AGENT_BACKEND_HANDSHAKE_VALIDATION_TRANSPORTS.includes(validationTransport)) {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "validation_transport must be argv, named, or unsupported",
        "validation_transport"
      )
    );
  }

  const provenanceSink = isNonEmptyString(input.provenance_sink ?? input.provenanceSink)
    ? String(input.provenance_sink ?? input.provenanceSink).trim()
    : isNonEmptyString(request?.value?.provenance_destination?.kind)
      ? request.value.provenance_destination.kind
      : null;
  if (!provenanceSink) {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "provenance_sink is required",
        "provenance_sink"
      )
    );
  }

  const scopeDigest = isNonEmptyString(input.scope_digest ?? input.scopeDigest)
    ? String(input.scope_digest ?? input.scopeDigest).trim()
    : isNonEmptyString(request?.value?.evidence?.scope_digest)
      ? request.value.evidence.scope_digest
      : null;
  if (!scopeDigest) {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "scope_digest is required",
        "scope_digest"
      )
    );
  }

  const handshakeDigest = isNonEmptyString(input.handshake_digest ?? input.handshakeDigest)
    ? String(input.handshake_digest ?? input.handshakeDigest).trim()
    : null;
  if (!handshakeDigest) {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "handshake_digest is required",
        "handshake_digest"
      )
    );
  }

  const expiresAt = normalizeIsoTimestamp(input.expires_at ?? input.expiresAt, "expires_at", diagnostics);
  if (expiresAt && Date.parse(expiresAt) <= Date.now()) {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "expires_at must be in the future",
        "expires_at"
      )
    );
  }

  if (request?.value?.backend_kind && backendKind && request.value.backend_kind !== backendKind) {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "request backend_kind must match the handshake backend_kind",
        "request.backend_kind"
      )
    );
  }

  if (request?.value?.tools?.raw_exec_enabled === true || rawExecEnabled !== false) {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "filesystem_mcp handshake results must report raw_exec_enabled false",
        "raw_exec_enabled"
      )
    );
  }

  if (diagnostics.length > 0) {
    return { ok: false, diagnostics };
  }

  return {
    ok: true,
    diagnostics: [],
    value: {
      schema_version: AGENT_BACKEND_HANDSHAKE_RESULT_SCHEMA_VERSION,
      backend_kind: backendKind,
      backend_id: backendId,
      backend_version: backendVersion,
      challenge_nonce: challengeNonce,
      status,
      mode,
      raw_exec_enabled: false,
      tool_surface: toolSurface,
      scope_binding: scopeBinding,
      validation_transport: validationTransport,
      provenance_sink: provenanceSink,
      scope_digest: scopeDigest,
      handshake_digest: handshakeDigest,
      expires_at: expiresAt,
      request: request?.value ?? null
    }
  };
}

export function normalizeAgentBackendHandshakeResultV1(input = {}) {
  return normalizeAgentBackendHandshakeResultInput(input);
}

export function buildAgentBackendHandshakeResultV1(input = {}) {
  return buildOrThrow(normalizeAgentBackendHandshakeResultV1(input), AGENT_BACKEND_HANDSHAKE_RESULT_SCHEMA_VERSION);
}

export function buildFilesystemMcpAgentBackendHandshakeResultV1(input = {}) {
  return buildAgentBackendHandshakeResultV1({
    ...input,
    backend_kind: "filesystem_mcp"
  });
}
