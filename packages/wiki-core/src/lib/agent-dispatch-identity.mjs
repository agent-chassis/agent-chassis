

export const AGENT_DISPATCH_IDENTITY_SCHEMA_VERSION = "agent-dispatch-identity.v1";

export const CALLER_ROLE_KIND_VALUES = Object.freeze([
  "coordinator",
  "worker",
  "reviewer",
  "redteam",
  "human_operator",
  "unknown"
]);

export const IDENTITY_TRUST_SOURCE_VALUES = Object.freeze([
  "launcher_minted",
  "transport_minted",
  "caller_supplied",
  "ambient_env",
  "request_payload",
  "prompt_text",
  "docs_inference",
  "unknown"
]);

export const ACCEPTED_IDENTITY_TRUST_SOURCES = Object.freeze(
  new Set(["launcher_minted", "transport_minted"])
);

export const BOOTSTRAP_STATE_CODES = Object.freeze({
  BOOTSTRAP_EXCEPTION_ACTIVE: "bootstrap_exception_active",
  BOOTSTRAP_REVIEW_MISSING: "bootstrap_review_missing",
  BOOTSTRAP_EXCEPTION_CONSUMED: "bootstrap_exception_consumed",
  GRAPH_IMPACT_PERSISTENCE_UNAVAILABLE: "graph_impact_persistence_unavailable"
});

export const BOOTSTRAP_STATE_VALUES = Object.freeze(
  Object.values(BOOTSTRAP_STATE_CODES)
);

export const IDENTITY_REFUSAL_CODES = Object.freeze({
  CALLER_SUPPLIED_ROLE: "agent_dispatch_identity.caller_supplied_role.v1",
  AMBIENT_ENV_ROLE: "agent_dispatch_identity.ambient_env_role.v1",
  REQUEST_PAYLOAD_ROLE: "agent_dispatch_identity.request_payload_role.v1",
  PROMPT_TEXT_ROLE: "agent_dispatch_identity.prompt_text_role.v1",
  UNKNOWN_TRUST_SOURCE: "agent_dispatch_identity.unknown_trust_source.v1",
  ORCHESTRATOR_NOT_OPERATOR: "agent_dispatch_identity.orchestrator_not_operator.v1",
  IDENTITY_ENVELOPE_MISSING: "agent_dispatch_identity.envelope_missing.v1",
  IDENTITY_ENVELOPE_MALFORMED: "agent_dispatch_identity.envelope_malformed.v1",
  IDENTITY_ROLE_KIND_INVALID: "agent_dispatch_identity.role_kind_invalid.v1"
});

const FIELDS_THAT_ARE_NEVER_AUTHORITY = Object.freeze([

  "request.role",
  "request.caller_role",
  "request.session_role",
  "request.agent_role",
  "prompt.role",
  "env.AGENT_ROLE",
  "env.AGENT_WK",
  "env.AGENT_OPERATOR_WRITE_SCOPE",
  "argv.role",
  "claimed_identity.role"
]);

export const CALLER_SUPPLIED_IDENTITY_CARRIERS = Object.freeze(
  new Set(FIELDS_THAT_ARE_NEVER_AUTHORITY)
);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function buildIdentityRefusal(code, message, detail = null) {
  const refusal = {
    schema_version: AGENT_DISPATCH_IDENTITY_SCHEMA_VERSION,
    accepted: false,
    refusal_code: code,
    refusal_message: message
  };
  if (detail !== null && detail !== undefined) {
    refusal.detail = detail;
  }
  return Object.freeze(refusal);
}

export function resolveCallerIdentity(envelope) {
  if (envelope === null || envelope === undefined) {
    return buildIdentityRefusal(
      IDENTITY_REFUSAL_CODES.IDENTITY_ENVELOPE_MISSING,
      "caller/session identity envelope is required"
    );
  }
  if (!isPlainObject(envelope)) {
    return buildIdentityRefusal(
      IDENTITY_REFUSAL_CODES.IDENTITY_ENVELOPE_MALFORMED,
      "caller/session identity envelope must be an object"
    );
  }
  if (envelope.schema_version !== AGENT_DISPATCH_IDENTITY_SCHEMA_VERSION) {
    return buildIdentityRefusal(
      IDENTITY_REFUSAL_CODES.IDENTITY_ENVELOPE_MALFORMED,
      `identity envelope schema_version must be ${AGENT_DISPATCH_IDENTITY_SCHEMA_VERSION}`
    );
  }
  if (!CALLER_ROLE_KIND_VALUES.includes(envelope.role_kind)) {
    return buildIdentityRefusal(
      IDENTITY_REFUSAL_CODES.IDENTITY_ROLE_KIND_INVALID,
      `role_kind must be one of ${CALLER_ROLE_KIND_VALUES.join(", ")}`
    );
  }
  const trustSource = envelope.trust_source;
  if (!IDENTITY_TRUST_SOURCE_VALUES.includes(trustSource)) {
    return buildIdentityRefusal(
      IDENTITY_REFUSAL_CODES.UNKNOWN_TRUST_SOURCE,
      "identity trust_source must be a controlled value"
    );
  }
  if (!ACCEPTED_IDENTITY_TRUST_SOURCES.has(trustSource)) {
    return buildIdentityRefusal(
      identityRefusalCodeForRejectedSource(trustSource),
      `identity trust_source ${trustSource} is not authority; only launcher_minted or transport_minted is accepted`,
      { trust_source: trustSource }
    );
  }
  return Object.freeze({
    schema_version: AGENT_DISPATCH_IDENTITY_SCHEMA_VERSION,
    accepted: true,
    role_kind: envelope.role_kind,
    trust_source: trustSource,
    mint_evidence: envelope.mint_evidence ?? null
  });
}

function identityRefusalCodeForRejectedSource(source) {
  switch (source) {
    case "caller_supplied":
      return IDENTITY_REFUSAL_CODES.CALLER_SUPPLIED_ROLE;
    case "ambient_env":
      return IDENTITY_REFUSAL_CODES.AMBIENT_ENV_ROLE;
    case "request_payload":
      return IDENTITY_REFUSAL_CODES.REQUEST_PAYLOAD_ROLE;
    case "prompt_text":
      return IDENTITY_REFUSAL_CODES.PROMPT_TEXT_ROLE;
    default:
      return IDENTITY_REFUSAL_CODES.UNKNOWN_TRUST_SOURCE;
  }
}

export function refuseCallerSuppliedIdentityFields(request) {
  if (!isPlainObject(request)) {
    return null;
  }
  for (const carrier of FIELDS_THAT_ARE_NEVER_AUTHORITY) {
    const [container, field] = carrier.split(".");
    const containerValue = request[container];
    if (isPlainObject(containerValue) && Object.prototype.hasOwnProperty.call(containerValue, field)) {
      return buildIdentityRefusal(
        IDENTITY_REFUSAL_CODES.CALLER_SUPPLIED_ROLE,
        `caller-supplied identity is not authority: ${carrier}`,
        { carrier }
      );
    }
  }
  return null;
}

export function enforceOrchestratorOperatorOnly(identity) {
  if (!isPlainObject(identity) || identity.accepted !== true) {
    return buildIdentityRefusal(
      IDENTITY_REFUSAL_CODES.IDENTITY_ENVELOPE_MISSING,
      "orchestrator launch requires an accepted identity envelope"
    );
  }
  if (identity.role_kind !== "human_operator") {
    return buildIdentityRefusal(
      IDENTITY_REFUSAL_CODES.ORCHESTRATOR_NOT_OPERATOR,
      "orchestrator launch/resume is human/operator-only",
      { observed_role_kind: identity.role_kind }
    );
  }
  return null;
}

export function evaluateBootstrapReviewState({
  mcp_dispatch_reviewer_available = false,
  review_evidence_recorded = false,
  graph_impact_persistence_available = false,
  graph_impact_required = false
} = {}) {
  if (graph_impact_required && !graph_impact_persistence_available) {
    return Object.freeze({
      schema_version: AGENT_DISPATCH_IDENTITY_SCHEMA_VERSION,
      state: BOOTSTRAP_STATE_CODES.GRAPH_IMPACT_PERSISTENCE_UNAVAILABLE,
      blocking: true,
      message:
        "graph-impact evidence persistence is unavailable until WK-0528; agents must report this code instead of using shell/CLI persistence"
    });
  }
  if (!mcp_dispatch_reviewer_available) {
    if (review_evidence_recorded) {
      return Object.freeze({
        schema_version: AGENT_DISPATCH_IDENTITY_SCHEMA_VERSION,
        state: BOOTSTRAP_STATE_CODES.BOOTSTRAP_EXCEPTION_ACTIVE,
        blocking: false,
        message:
          "MCP reviewer dispatch is unavailable in this session; findings-only review evidence has been recorded under the WK-0532 bootstrap exception"
      });
    }
    return Object.freeze({
      schema_version: AGENT_DISPATCH_IDENTITY_SCHEMA_VERSION,
      state: BOOTSTRAP_STATE_CODES.BOOTSTRAP_REVIEW_MISSING,
      blocking: true,
      message:
        "implementation WK/slice must record bootstrap findings-only review evidence before close when MCP reviewer dispatch is unavailable in-session"
    });
  }
  return Object.freeze({
    schema_version: AGENT_DISPATCH_IDENTITY_SCHEMA_VERSION,
    state: BOOTSTRAP_STATE_CODES.BOOTSTRAP_EXCEPTION_CONSUMED,
    blocking: false,
    message:
      "MCP reviewer dispatch is available; the WK-0532 bootstrap exception is consumed for new work"
  });
}

export function isAcceptedIdentityTrustSource(trustSource) {
  return ACCEPTED_IDENTITY_TRUST_SOURCES.has(trustSource);
}
