
export const CONTROLLED_ACCEPTANCE_PUBLICATION_ENV = "AGENT_CHASSIS_PUBLISH_CONTROLLED_ACCEPTANCE_OPT_OUT";

export function resolveControlledAcceptancePublication(env) {
  const value = env[CONTROLLED_ACCEPTANCE_PUBLICATION_ENV];
  if (value === undefined || value === "true") return true;
  if (value === "false") return false;
  throw Object.assign(new TypeError(`controlled_acceptance_publication_config_invalid: ${CONTROLLED_ACCEPTANCE_PUBLICATION_ENV} must be true or false; unset preserves publication. Correct the host environment and restart the session/server.`),
    { code: "controlled_acceptance_publication_config_invalid" });
}

export function createExceptionPublication(publishControlledAcceptanceOptOut = true) {
  const includes = kind => publishControlledAcceptanceOptOut || kind !== "controlled_acceptance";
  return Object.freeze({ includes,
    kinds: kinds => kinds.filter(includes),
    applicability: text => publishControlledAcceptanceOptOut ? text
      : "Required controlled acceptance remains required. Missing capability chooses no exemption and grants no proof credit.",
    guidance: artifact => artifact.publishControlledAcceptanceOptOut === publishControlledAcceptanceOptOut,
    document: reference => publishControlledAcceptanceOptOut || ![
      "docs/acceptance-coverage-mcp.md", "docs/mcp-controlled-contract-operations.md",
      "docs/tool-discovery-tiers.md",
      "packages/agent-launch-core/data/role-guides/orchestrator/01/authoring-vignette.md"
    ].includes(reference)
  });
}
export const DEFAULT_EXCEPTION_PUBLICATION = createExceptionPublication();
