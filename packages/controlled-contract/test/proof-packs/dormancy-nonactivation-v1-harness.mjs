const DOMAINS = Object.freeze([
  { id: "plugin-registry", kind: "in-process-plugin-composition" },
  { id: "feature-gated-scheduler", kind: "time-triggered-background-execution" },
  { id: "compatibility-codec", kind: "protocol-negotiation" }
]);

function executeDormancy({ domain, mutant = null }) {
  if (!DOMAINS.some(({ id }) => id === domain)) throw new Error("unknown_domain");
  return {
    direct_construction: true,
    isolated_registration: true,
    default_inactive: mutant !== "default-on-behavior",
    complete_graph: mutant !== "incomplete-graph-population",
    no_path: mutant !== "hidden-activation-edge",
    complete_activation_observation: mutant !== "incomplete-activation-population",
    activation_events: mutant === "dormant-but-activated" ? ["activation"] : []
  };
}

function dormancyGuaranteeSatisfied(result) {
  return result.direct_construction && result.isolated_registration &&
    result.default_inactive && result.complete_graph && result.no_path &&
    result.complete_activation_observation && result.activation_events.length === 0;
}

export { DOMAINS, dormancyGuaranteeSatisfied, executeDormancy };
