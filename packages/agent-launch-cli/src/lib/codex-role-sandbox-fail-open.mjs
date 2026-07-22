

import {
  BubblewrapIsolationError,
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES,
  assertBubblewrapAvailable
} from "./launch-isolation.mjs";
import {
  WORKSPACE_AGENT_BACKEND_AVAILABILITY_STATES,
  WORKSPACE_AGENT_FAIL_OPEN_CLOSED_REASONS,
  WORKSPACE_AGENT_FAIL_OPEN_DISPOSITIONS,
  WORKSPACE_AGENT_MANAGED_PLAIN_SPAWN_BLOCKER,
  buildWorkspaceAgentFailOpenPlan
} from "./launch-isolation-failopen.mjs";
import {
  WORKSPACE_AGENT_RUN_ISOLATION_BACKENDS
} from "./workspace-agent-run-enforcement.mjs";
import {
  OPERATOR_DIRECT_MODE_WARNING,
  ORCHESTRATOR_ISOLATION_MODES
} from "./orchestrator-launch-isolation.mjs";
import { writeStderr } from "./codex-role-io.mjs";
import { buildCodexRoleBubblewrapPlan } from "./workspace-agent-codex-role-adapter.mjs";

export const BROKEN_OR_TAMPERED_BWRAP_DIAGNOSTIC_CODES = new Set([
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BWRAP_NOT_EXECUTABLE,
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BWRAP_PROBE_FAILED,
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BWRAP_SPAWN_FAILED
]);

const ORCHESTRATOR_RESUME_PLAIN_SPAWN_PROVENANCE_CODE =
  "agent_launch.codex_orchestrator_resume.unenforced_plain_spawn.v1";

export function formatBubblewrapIsolationRefusal(role, err) {
  const base =
    `codex-${role}: bubblewrap isolation refused: ${err.code}: ${err.message}`;
  if (err.code === BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BWRAP_UNAVAILABLE) {
    return `${base}\nRemediation: install bubblewrap (bwrap) on PATH, or use an explicit supported unsandboxed opt-out/direct-mode path only where the invoked launch surface documents and supports it. Structured role launches remain fail-closed unless that surface has an explicit operator opt-in.`;
  }
  if (BROKEN_OR_TAMPERED_BWRAP_DIAGNOSTIC_CODES.has(err.code)) {
    return `${base}\nRemediation: repair or reinstall bubblewrap (bwrap), then retry. A present but unusable bwrap backend is treated as broken or tampered and is not remediated by structured-role opt-out/direct mode.`;
  }
  return base;
}

export function buildCodexOrchestratorIsolationSummary(availability) {
  const direct = availability?.available !== true;
  return {
    mode: direct
      ? ORCHESTRATOR_ISOLATION_MODES.DIRECT
      : ORCHESTRATOR_ISOLATION_MODES.BUBBLEWRAP,
    operator_direct_mode_allowed: true,
    bwrap_available: !direct,
    os_filesystem_isolation: !direct,
    write_scope_enforced: !direct,
    warning: direct ? OPERATOR_DIRECT_MODE_WARNING : null,
    diagnostic: direct ? (availability?.diagnostic ?? null) : null
  };
}

export function backendAvailabilityFromOrchestratorProbe(
  availability,
  source = "codex_orchestrator_resume_probe"
) {
  if (!availability || typeof availability !== "object") {
    return {
      ok: false,
      state: WORKSPACE_AGENT_BACKEND_AVAILABILITY_STATES.UNTRUSTED,
      backend: null,
      reason: "orchestrator bwrap probe result missing or malformed",
      diagnostic: null,
      source
    };
  }
  if (availability.available === true) {
    return {
      ok: true,
      state: WORKSPACE_AGENT_BACKEND_AVAILABILITY_STATES.AVAILABLE,
      backend: WORKSPACE_AGENT_RUN_ISOLATION_BACKENDS.BWRAP,
      reason: "bwrap backend is available for Codex orchestrator resume",
      diagnostic: null,
      source
    };
  }

  const diagnostic = availability.diagnostic && typeof availability.diagnostic === "object"
    ? {
        code: availability.diagnostic.code ?? null,
        message: availability.diagnostic.message ?? null,
        detail: availability.diagnostic.detail ?? null
      }
    : null;
  if (diagnostic?.code === BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BWRAP_UNAVAILABLE) {
    return {
      ok: true,
      state: WORKSPACE_AGENT_BACKEND_AVAILABILITY_STATES.NO_SUPPORTED_ENABLED_BACKEND,
      backend: null,
      reason: "bwrap backend is unavailable for Codex orchestrator resume",
      diagnostic,
      source
    };
  }
  if (BROKEN_OR_TAMPERED_BWRAP_DIAGNOSTIC_CODES.has(diagnostic?.code)) {
    return {
      ok: false,
      state: WORKSPACE_AGENT_BACKEND_AVAILABILITY_STATES.TAMPERED_OR_BROKEN,
      backend: WORKSPACE_AGENT_RUN_ISOLATION_BACKENDS.BWRAP,
      reason: "bwrap backend is present but unusable for Codex orchestrator resume",
      diagnostic,
      source
    };
  }
  return {
    ok: false,
    state: WORKSPACE_AGENT_BACKEND_AVAILABILITY_STATES.UNTRUSTED,
    backend: null,
    reason: "orchestrator bwrap probe did not return a trusted availability decision",
    diagnostic,
    source
  };
}

function backendAvailabilityFromCodexRoleBwrapError(error) {
  return backendAvailabilityFromOrchestratorProbe(
    {
      available: false,
      diagnostic: {
        code: error?.code ?? null,
        message: error?.message ?? null,
        detail: error?.detail ?? null
      }
    },
    "codex_role_bwrap_isolation"
  );
}

export function buildCodexRoleSandboxFailOpenPlan(plan, error, {
  resolveEnforcementPosture,
  resolveUnsandboxedOptIn
} = {}) {
  return buildWorkspaceAgentFailOpenPlan({
    launchFacts: {
      command: plan.command,
      args: plan.args,
      cwd: plan.repo,
      env: plan.env
    },
    role: plan.role,
    subject: plan.subject,
    workspaceDir: plan.repo,
    workerScopeAuthority:
      plan.worker_scope_authority ?? plan.isolation?.worker_scope_authority ?? null,
    classifyIsolationBackendAvailability: () =>
      backendAvailabilityFromCodexRoleBwrapError(error),
    ...(resolveEnforcementPosture ? { resolveEnforcementPosture } : {}),
    ...(resolveUnsandboxedOptIn ? { resolveUnsandboxedOptIn } : {})
  });
}

export function prepareCodexRoleSandboxLaunch(plan, {
  buildBwrapPlan = buildCodexRoleBubblewrapPlan,
  assertBackendAvailable = assertBubblewrapAvailable,
  resolveSandboxFailOpenPlan = buildCodexRoleSandboxFailOpenPlan
} = {}) {
  let bwrapPlan;
  try {
    bwrapPlan = buildBwrapPlan(plan);
    assertBackendAvailable({ env: plan.env, bwrapPath: bwrapPlan.bwrapPath });
  } catch (err) {
    if (!(err instanceof BubblewrapIsolationError)) {
      throw err;
    }
    const decision = resolveSandboxFailOpenPlan(plan, err);
    if (decision.disposition === WORKSPACE_AGENT_FAIL_OPEN_DISPOSITIONS.PLAIN_SPAWN) {
      return { outcome: "plain", decision, error: err };
    }
    return { outcome: "refused", decision, error: err };
  }
  return { outcome: "enforced", bwrapPlan };
}

const CODEX_ROLE_PLAIN_SPAWN_PROVENANCE_CODE =
  "agent_launch.codex_role.unenforced_plain_spawn.v1";

function formatCodexRolePlainSpawnProvenance(plan, decision) {
  const warning = decision?.warning ?? {};
  const posture = warning.enforcement_posture ?? {};
  const backend = warning.backend_availability ?? {};
  return `${CODEX_ROLE_PLAIN_SPAWN_PROVENANCE_CODE}: ${JSON.stringify({
    role: plan.role,
    subject: plan.subject,
    disposition: WORKSPACE_AGENT_FAIL_OPEN_DISPOSITIONS.PLAIN_SPAWN,
    enforced: false,
    isolation_backend: WORKSPACE_AGENT_RUN_ISOLATION_BACKENDS.NONE,
    reason_code: posture.reason_code ?? null,
    reason: posture.reason ?? null,
    paid_node_engine_key_present: posture.paid_node_engine_key_present === true,
    opt_out: posture.opt_out ?? null,
    backend_state: backend.state ?? null,
    backend_reason: backend.reason ?? null
  })}`;
}

export function emitCodexRolePlainSpawnNotice(plan, io, decision) {
  const message = decision?.warning?.message
    ?? "filesystem isolation is NOT active; this structured role launch is running unenforced";
  writeStderr(io.stderr, `codex-${plan.role}: WARNING: ${message}\n`);
  writeStderr(io.stderr, `${formatCodexRolePlainSpawnProvenance(plan, decision)}\n`);
}

export function formatCodexRoleSandboxFailOpenRefusal(plan, decision, error) {
  const refusal = decision?.refusal ?? null;
  const reason = refusal?.reason ?? "enforcement_required";
  const remediation = Array.isArray(refusal?.detail?.remediation)
    ? refusal.detail.remediation
    : [
        "install or repair the configured isolation backend (bubblewrap)",
        "remove the paid Chassis Control Engine key for local/free unenforced posture",
        "set the explicit unsandboxed opt-out only if the operator deliberately accepts unenforced local execution"
      ];
  const diagnosticText = error?.code
    ? `: ${error.code}: ${error.message ?? "isolation backend unavailable or unusable"}`
    : "";

  const cause = refusal?.detail?.blocker === WORKSPACE_AGENT_MANAGED_PLAIN_SPAWN_BLOCKER
    ? refusal.detail.message
    : "a paid enforcement key requires an enforced isolation backend";
  return [
    `codex-${plan.role}: structured role launch refused: ${cause}${diagnosticText} (${reason})`,
    `Remediation: ${remediation.join("; ")}.`
  ].join("\n");
}

function buildCodexOrchestratorResumeFailOpenPlan(plan, availability) {
  return buildWorkspaceAgentFailOpenPlan({
    launchFacts: {
      command: plan.command,
      args: plan.args,
      cwd: plan.repo,
      env: plan.env
    },
    role: plan.role,
    subject: plan.subject,
    workspaceDir: plan.repo,
    classifyIsolationBackendAvailability: () =>
      backendAvailabilityFromOrchestratorProbe(availability)
  });
}

export function buildCodexOrchestratorResumeIsolationSummary(plan, availability) {
  if (availability?.available === true) {
    return buildCodexOrchestratorIsolationSummary(availability);
  }

  const failOpenPlan = buildCodexOrchestratorResumeFailOpenPlan(plan, availability);
  if (failOpenPlan.disposition === WORKSPACE_AGENT_FAIL_OPEN_DISPOSITIONS.PLAIN_SPAWN) {
    return {
      ...buildCodexOrchestratorIsolationSummary(availability),
      fail_open_disposition: failOpenPlan.disposition,
      failOpenWarning: failOpenPlan.warning ?? null,
      enforcement: failOpenPlan.enforcement ?? null,
      isolation: failOpenPlan.isolation ?? null
    };
  }
  return {
    mode: ORCHESTRATOR_ISOLATION_MODES.BUBBLEWRAP,
    operator_direct_mode_allowed: true,
    bwrap_available: false,
    os_filesystem_isolation: true,
    write_scope_enforced: true,
    warning: null,
    diagnostic: availability?.diagnostic ?? null,
    fail_open_disposition: failOpenPlan.disposition,
    refusal: failOpenPlan.refusal ?? {
      reason: WORKSPACE_AGENT_FAIL_OPEN_CLOSED_REASONS.BACKEND_AVAILABILITY_UNTRUSTED,
      detail: null
    },
    enforcement: failOpenPlan.enforcement ?? null
  };
}

export function formatOrchestratorResumeFailOpenRefusal(plan) {
  const refusal = plan.operatorIsolation.refusal;
  const reason = refusal?.reason ?? "unknown";
  const detail = refusal?.detail ?? null;
  const diagnostic = detail?.backend_availability?.diagnostic
    ?? plan.operatorIsolation?.diagnostic
    ?? null;
  const diagnosticText = diagnostic?.code
    ? `: ${diagnostic.code}: ${diagnostic.message ?? "bwrap backend unavailable or unusable"}`
    : "";
  const remediation = Array.isArray(detail?.remediation)
    ? detail.remediation
    : [
        "install or repair bubblewrap (bwrap)",
        "remove the paid Node Engine key for local/free unenforced posture",
        "set the explicit unsandboxed opt-out only if the operator deliberately accepts unenforced local execution"
      ];
  return [
    `codex-${plan.role}: bubblewrap isolation refused for Codex orchestrator resume: ${reason}${diagnosticText}`,
    `Remediation: ${remediation.join("; ")}.`
  ].join("\n");
}

export function formatOrchestratorResumePlainSpawnProvenance(plan) {
  const warning = plan.operatorIsolation.failOpenWarning;
  const posture = warning?.enforcement_posture ?? {};
  const backend = warning?.backend_availability ?? {};
  return `${ORCHESTRATOR_RESUME_PLAIN_SPAWN_PROVENANCE_CODE}: ${JSON.stringify({
    role: plan.role,
    subject: plan.subject,
    disposition: WORKSPACE_AGENT_FAIL_OPEN_DISPOSITIONS.PLAIN_SPAWN,
    enforced: false,
    isolation_backend: WORKSPACE_AGENT_RUN_ISOLATION_BACKENDS.NONE,
    reason_code: posture.reason_code ?? null,
    reason: posture.reason ?? null,
    paid_node_engine_key_present: posture.paid_node_engine_key_present === true,
    opt_out: posture.opt_out ?? null,
    backend_state: backend.state ?? null,
    backend_reason: backend.reason ?? null
  })}`;
}

export function buildCodexOrchestratorResumeLateBwrapSpawnFailureSummary(plan, error) {
  const availability = {
    available: false,
    diagnostic: {
      code: error?.code ?? null,
      message: error?.message ?? null,
      detail: error?.detail ?? null
    }
  };
  return buildCodexOrchestratorResumeIsolationSummary(plan, availability);
}
