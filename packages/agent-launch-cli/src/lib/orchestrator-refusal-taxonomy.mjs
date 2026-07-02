

export const ORCHESTRATOR_REFUSAL_MODE = "refusal";
export const ORCHESTRATOR_REFUSAL_ROLE = "orchestrator";

export const ORCHESTRATOR_REFUSAL_REASON_KINDS = Object.freeze({
  NO_PRIOR_SESSION: "no_prior_session",
  LOCAL_CONFIG_INVALID: "local_config_invalid",
  WIKI_MCP_UNRESOLVED: "wiki_mcp_unresolved"
});

const FAMILY_PREFIX_PATTERN = /^[a-z][a-z0-9]*$/;
const REASON_KIND_VALUES = new Set(Object.values(ORCHESTRATOR_REFUSAL_REASON_KINDS));

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

export function composeOrchestratorRefusalReason(family, reasonKind) {
  if (!isNonEmptyString(family) || !FAMILY_PREFIX_PATTERN.test(family)) {
    throw new Error(
      `composeOrchestratorRefusalReason: family must match ${FAMILY_PREFIX_PATTERN} (got ${JSON.stringify(family)})`
    );
  }
  if (!isNonEmptyString(reasonKind) || !REASON_KIND_VALUES.has(reasonKind)) {
    throw new Error(
      `composeOrchestratorRefusalReason: unknown orchestrator refusal reason kind ${JSON.stringify(reasonKind)}`
    );
  }
  return `${family}_orchestrator_${reasonKind}`;
}

export function makeOrchestratorRefusal({
  command,
  code,
  message,
  detail = null,
  subject = null,
  repo = null,
  args = [],
  env = {},
  role = ORCHESTRATOR_REFUSAL_ROLE
} = {}) {
  if (!isNonEmptyString(command)) {
    throw new Error("makeOrchestratorRefusal: command (family harness fact) is required");
  }
  if (!isNonEmptyString(code)) {
    throw new Error("makeOrchestratorRefusal: refusal code is required");
  }
  if (!isNonEmptyString(message)) {
    throw new Error("makeOrchestratorRefusal: refusal message is required");
  }
  return {
    mode: ORCHESTRATOR_REFUSAL_MODE,
    role,
    subject,
    repo,
    command,
    args: Array.isArray(args) ? [...args] : [],
    env: env && typeof env === "object" ? { ...env } : {},
    refusal: {
      code,
      message,
      detail
    }
  };
}
