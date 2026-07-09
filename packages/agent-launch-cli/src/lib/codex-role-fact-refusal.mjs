

export function isCodexFactResolutionRefusal(value) {
  return value && typeof value === "object" && value.ok === false && typeof value.reason === "string";
}

export function buildCodexFactResolutionRefusalPlan({
  role,
  subject,
  repo,
  env,
  result
}) {
  const reason = result?.reason ?? "launcher_runtime_home_fact_unresolvable";
  const detail = result?.detail ?? null;
  return {
    mode: "refusal",
    role,
    subject,
    repo,
    command: "codex",
    args: [],
    env,
    refusal: {
      wrapper_gate_code: reason,
      allowed: false,
      role,
      unit_address: typeof subject === "string" ? subject : null,
      expected_unit_address: typeof subject === "string" ? subject : null,
      diagnostics: [
        {
          code: reason,
          message: `codex-${role}: could not resolve Codex source home`,
          path: "runtime.codex_source_home",
          reason,
          detail
        }
      ],
      readiness: null,
      worker_admission: null,
      dependency_evidence: null
    }
  };
}
