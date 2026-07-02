export const CODEX_WORKER_GRAPH_IMPACT_BRIDGE_ENV_VAR = "CODEX_WORKER_GRAPH_IMPACT_JSON_FILE";
export const AGENT_ROLE_GRAPH_IMPACT_BRIDGE_ENV_VAR = "AGENT_LAUNCH_GRAPH_IMPACT_JSON_FILE";

export async function loadGraphImpactEvidenceFromEnv({ env, envVar }) {
  if (typeof envVar !== "string" || envVar.length === 0) {
    return null;
  }
  const raw = env && typeof env[envVar] === "string" ? env[envVar].trim() : "";
  if (raw.length === 0) {
    return null;
  }
  return {
    ok: false,
    env_var: envVar,
    error: {
      code: "graph_impact_bridge.launch_authority_rejected.v1",
      reason: "caller-controlled graph-impact env evidence is not authoritative for launch readiness"
    }
  };
}

export function appendGraphImpactBridgeDiagnostic(diagnostics, bridge) {
  if (!bridge) {
    return;
  }
  if (bridge.error) {
    diagnostics.push({
      code: bridge.error.code,
      message: `graph-impact env evidence from ${bridge.env_var} is not authoritative: ${bridge.error.reason}`,
      path: `env.${bridge.env_var}`
    });
    return;
  }
  diagnostics.push({
    code: "graph_impact_bridge.evidence_incompatible.v1",
    message:
      `graph-impact env evidence from ${bridge.env_var} did not satisfy dispatch readiness; ` +
      `retry decision is ${bridge.retry_decision_code}`,
    path: `env.${bridge.env_var}`
  });
}

export async function applyGraphImpactBridge({ readiness, env, envVar }) {
  if (
    !readiness ||
    readiness.dispatchable ||
    readiness.decision_code !== "missing_graph_impact"
  ) {
    return { readiness, bridge: null };
  }
  const attempt = await loadGraphImpactEvidenceFromEnv({ env, envVar });
  if (!attempt) {
    return { readiness, bridge: null };
  }
  if (!attempt.ok) {
    return {
      readiness,
      bridge: {
        source: "env_file_non_authoritative",
        env_var: attempt.env_var,
        initial_decision_code: readiness.decision_code,
        error: attempt.error
      }
    };
  }
  return { readiness, bridge: null };
}
