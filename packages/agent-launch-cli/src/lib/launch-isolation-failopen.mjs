import { probeLauncherCanonicalBwrapAvailability } from "./launch-isolation-bwrap.mjs";
import {
  WORKSPACE_AGENT_RUN_ENFORCEMENT_REASONS,
  WORKSPACE_AGENT_RUN_ISOLATION_BACKENDS
} from "./workspace-agent-run-enforcement.mjs";
import {
  WORKSPACE_AGENT_SANDBOX_BACKEND_STATES,
  WORKSPACE_AGENT_SANDBOX_OUTCOMES,
  WORKSPACE_AGENT_SANDBOX_REFUSAL_REASONS,
  buildSandboxBackendSelectionFromBwrapFacts,
  buildWorkspaceAgentSandboxDecision,
  buildWorkspaceAgentSandboxDecisionFromTrustedLegacyBwrapFacts
} from "./workspace-agent-sandbox-decision.mjs";

export const WORKSPACE_AGENT_FAIL_OPEN_SCHEMA_VERSION =
  "workspace-agent-fail-open-plan.v1";

export const WORKSPACE_AGENT_FAIL_OPEN_WARNING_SCHEMA_VERSION =
  "workspace-agent-fail-open-warning.v1";

export const WORKSPACE_AGENT_FAIL_OPEN_DISPOSITIONS = Object.freeze({
  PLAIN_SPAWN: "plain_spawn",
  CLOSED: "closed"
});

export const WORKSPACE_AGENT_FAIL_OPEN_CLOSED_REASONS = Object.freeze({
  OPT_IN_DISABLED: "operator_opt_in_disabled",
  OPT_IN_INVALID: "operator_opt_in_invalid",
  BACKEND_AVAILABLE: "backend_available",
  BACKEND_TAMPERED_OR_BROKEN: "backend_tampered_or_broken",
  BACKEND_AVAILABILITY_UNTRUSTED: "backend_availability_untrusted",
  ENFORCEMENT_REQUIRED: "enforcement_required",
  LAUNCH_FACTS_INVALID: "launch_facts_invalid"
});

export const WORKSPACE_AGENT_BACKEND_AVAILABILITY_STATES = Object.freeze({
  AVAILABLE: "available",
  NO_SUPPORTED_ENABLED_BACKEND: "no_supported_enabled_backend",
  UNTRUSTED: "untrusted",
  TAMPERED_OR_BROKEN: "tampered_or_broken"
});

const LEGACY_BACKEND_SOURCE = "launcher_canonical_bwrap_probe";

function freeze(value) {
  return Object.freeze(value);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeDiagnostic(diagnostic) {
  if (!isPlainObject(diagnostic)) return null;
  return freeze({
    code: diagnostic.code ?? null,
    message: diagnostic.message ?? null,
    detail: diagnostic.detail ?? null
  });
}

function legacyAvailabilityFromBackendSelection(selection) {
  const diagnostic = normalizeDiagnostic(selection?.diagnostic);
  const backend = selection?.backend_id ?? selection?.backend ?? null;
  if (
    selection?.ok === true
    && selection.state === WORKSPACE_AGENT_SANDBOX_BACKEND_STATES.AVAILABLE
    && backend !== null
  ) {
    return freeze({
      ok: true,
      state: WORKSPACE_AGENT_BACKEND_AVAILABILITY_STATES.AVAILABLE,
      backend,
      reason: selection.reason ?? "supported enabled isolation backend is available",
      bwrap_path: selection.bwrap_path ?? null,
      diagnostic: null,
      source: selection.source ?? LEGACY_BACKEND_SOURCE
    });
  }
  if (
    selection?.ok === true
    && selection.state
      === WORKSPACE_AGENT_SANDBOX_BACKEND_STATES.NO_SUPPORTED_ENABLED_BACKEND
  ) {
    return freeze({
      ok: true,
      state: WORKSPACE_AGENT_BACKEND_AVAILABILITY_STATES.NO_SUPPORTED_ENABLED_BACKEND,
      backend: null,
      reason:
        selection.reason
        ?? "launcher-owned backend selection found no supported enabled isolation backend for this launch",
      diagnostic,
      source: selection.source ?? LEGACY_BACKEND_SOURCE
    });
  }
  if (selection?.state === WORKSPACE_AGENT_SANDBOX_BACKEND_STATES.UNUSABLE) {
    return freeze({
      ok: false,
      state: WORKSPACE_AGENT_BACKEND_AVAILABILITY_STATES.TAMPERED_OR_BROKEN,
      backend: backend ?? WORKSPACE_AGENT_RUN_ISOLATION_BACKENDS.BWRAP,
      reason:
        selection.reason
        ?? "launcher-owned backend probe found a supported backend that is broken or tampered",
      diagnostic,
      source: selection.source ?? LEGACY_BACKEND_SOURCE
    });
  }
  return freeze({
    ok: false,
    state: WORKSPACE_AGENT_BACKEND_AVAILABILITY_STATES.UNTRUSTED,
    backend: null,
    reason:
      selection?.reason
      ?? "launcher-owned backend availability decision was not trusted",
    diagnostic,
    source: selection?.source ?? LEGACY_BACKEND_SOURCE
  });
}

function legacyBwrapFactsFromProbe(probe) {
  if (isPlainObject(probe)) return probe;
  return freeze({
    available: false,
    diagnostic: freeze({
      code: null,
      message: "canonical bwrap probe result missing or malformed",
      detail: null
    })
  });
}

function legacyBwrapFactsFromAvailability(availability) {
  if (!isPlainObject(availability)) {
    return freeze({
      available: false,
      diagnostic: freeze({
        code: null,
        message: "legacy backend availability result missing or malformed",
        detail: null
      })
    });
  }
  if (
    availability.ok === true
    && availability.state === WORKSPACE_AGENT_BACKEND_AVAILABILITY_STATES.AVAILABLE
  ) {
    return freeze({
      available: true,
      bwrapPath: availability.bwrap_path ?? availability.bwrapPath ?? null,
      diagnostic: null
    });
  }
  return freeze({
    available: false,
    diagnostic: normalizeDiagnostic(availability.diagnostic)
      ?? freeze({
        code: null,
        message: availability.reason ?? "legacy backend availability did not include a diagnostic",
        detail: null
      })
  });
}

function legacyBwrapFactsFromBackendError(error, fallbackMessage) {
  return freeze({
    available: false,
    diagnostic: freeze({
      code: error?.code ?? null,
      message: error?.message ?? fallbackMessage,
      detail: error?.detail ?? null
    })
  });
}

function buildTrustedLegacyBwrapFactsDecision({
  launchFacts,
  role,
  subject,
  workspaceDir,
  commandSurface,
  confirmedIsolatedSpawn,
  classifyIsolationBackendAvailability,
  probeCanonicalBwrapAvailability
}) {
  if (typeof classifyIsolationBackendAvailability === "function") {
    let availability;
    try {
      availability = classifyIsolationBackendAvailability({
        probeCanonicalBwrapAvailability
      });
    } catch (error) {
      availability = {
        source: "launcher_trusted_legacy_backend_availability_error",
        diagnostic: legacyBwrapFactsFromBackendError(
          error,
          "legacy backend availability classification threw"
        ).diagnostic
      };
    }
    return buildWorkspaceAgentSandboxDecisionFromTrustedLegacyBwrapFacts({
      launchFacts,
      role,
      subject,
      workspaceDir,
      commandSurface,
      confirmedIsolatedSpawn,
      bwrapAvailability: legacyBwrapFactsFromAvailability(availability),
      source: availability?.source ?? "launcher_trusted_legacy_backend_availability"
    });
  }

  if (typeof probeCanonicalBwrapAvailability === "function") {
    let bwrapAvailability;
    try {
      bwrapAvailability = legacyBwrapFactsFromProbe(probeCanonicalBwrapAvailability());
    } catch (error) {
      bwrapAvailability = legacyBwrapFactsFromBackendError(
        error,
        "canonical bwrap probe threw"
      );
    }
    return buildWorkspaceAgentSandboxDecisionFromTrustedLegacyBwrapFacts({
      launchFacts,
      role,
      subject,
      workspaceDir,
      commandSurface,
      confirmedIsolatedSpawn,
      bwrapAvailability,
      source: LEGACY_BACKEND_SOURCE
    });
  }

  return buildWorkspaceAgentSandboxDecision({
    launchFacts,
    role,
    subject,
    workspaceDir,
    commandSurface,
    confirmedIsolatedSpawn
  });
}

export function classifyLauncherIsolationBackendAvailability({
  probeCanonicalBwrapAvailability = probeLauncherCanonicalBwrapAvailability
} = {}) {
  const probe = typeof probeCanonicalBwrapAvailability === "function"
    ? probeCanonicalBwrapAvailability
    : probeLauncherCanonicalBwrapAvailability;
  const probeResult = legacyBwrapFactsFromProbe(probe());
  const selection = buildSandboxBackendSelectionFromBwrapFacts({
    availability: probeResult,
    source: LEGACY_BACKEND_SOURCE
  });
  return freeze({
    ...legacyAvailabilityFromBackendSelection(selection),
    bwrap_path: probeResult.available === true ? probeResult.bwrapPath ?? null : null
  });
}

function closedReasonFromSandboxDecision(decision) {
  const reason = decision?.refusal?.reason ?? null;
  if (reason === WORKSPACE_AGENT_SANDBOX_REFUSAL_REASONS.LAUNCH_FACTS_INVALID) {
    return WORKSPACE_AGENT_FAIL_OPEN_CLOSED_REASONS.LAUNCH_FACTS_INVALID;
  }
  if (
    reason === WORKSPACE_AGENT_SANDBOX_REFUSAL_REASONS.LAUNCHER_POSTURE_INVALID
    || reason === WORKSPACE_AGENT_SANDBOX_REFUSAL_REASONS.LAUNCHER_POSTURE_UNTRUSTED_INPUT
  ) {
    return WORKSPACE_AGENT_FAIL_OPEN_CLOSED_REASONS.OPT_IN_INVALID;
  }
  if (
    reason
      === WORKSPACE_AGENT_SANDBOX_REFUSAL_REASONS.PAID_KEY_ENFORCEMENT_REQUIRED_NO_BACKEND
  ) {
    return WORKSPACE_AGENT_FAIL_OPEN_CLOSED_REASONS.ENFORCEMENT_REQUIRED;
  }
  if (reason === WORKSPACE_AGENT_SANDBOX_REFUSAL_REASONS.BACKEND_LAUNCH_PLAN_MISSING) {
    return WORKSPACE_AGENT_FAIL_OPEN_CLOSED_REASONS.BACKEND_AVAILABLE;
  }
  const backendState =
    decision?.refusal?.detail?.backend_selection?.state
    ?? decision?.refusal?.detail?.state
    ?? null;
  if (backendState === WORKSPACE_AGENT_SANDBOX_BACKEND_STATES.UNUSABLE) {
    return WORKSPACE_AGENT_FAIL_OPEN_CLOSED_REASONS.BACKEND_TAMPERED_OR_BROKEN;
  }
  return WORKSPACE_AGENT_FAIL_OPEN_CLOSED_REASONS.BACKEND_AVAILABILITY_UNTRUSTED;
}

function backendAvailabilityFromSandboxDecision(decision) {
  const selection =
    decision?.warning?.backend_selection
    ?? decision?.refusal?.detail?.backend_selection
    ?? decision?.refusal?.detail
    ?? null;
  return legacyAvailabilityFromBackendSelection(selection);
}

function warningFromSandboxDecision({ decision, role, subject }) {
  const warning = decision.warning ?? {};
  const enforcement = warning.enforcement ?? decision.enforcement ?? {};
  return freeze({
    schema_version: WORKSPACE_AGENT_FAIL_OPEN_WARNING_SCHEMA_VERSION,
    code:
      warning.code
      ?? (enforcement.reason
        === WORKSPACE_AGENT_RUN_ENFORCEMENT_REASONS.NO_PAID_KEY_NO_BACKEND
        ? "agent_launch.isolation.no_paid_key_no_backend.v1"
        : "agent_launch.isolation.paid_key_operator_opt_out_no_backend.v1"),
    severity: warning.severity ?? "warning",
    role: warning.role ?? role ?? null,
    subject: warning.subject ?? subject ?? null,
    message:
      warning.message
      ?? "filesystem isolation is NOT active; launcher-owned enforcement posture permits this worker-family role to run unenforced because backend selection could not produce an enforced launch",
    enforcement: freeze({
      ...enforcement,
      enforced: false,
      isolation_backend: WORKSPACE_AGENT_RUN_ISOLATION_BACKENDS.NONE
    }),
    opt_in: freeze({ ...(warning.enforcement_posture?.opt_out ?? {}) }),
    enforcement_posture: freeze({ ...(warning.enforcement_posture ?? {}) }),
    backend_availability: backendAvailabilityFromSandboxDecision(decision),
    backend_selection: warning.backend_selection ?? null
  });
}

function buildClosedCompatibilityResult(decision) {
  return freeze({
    schema_version: WORKSPACE_AGENT_FAIL_OPEN_SCHEMA_VERSION,
    disposition: WORKSPACE_AGENT_FAIL_OPEN_DISPOSITIONS.CLOSED,
    accepted: false,
    plan: null,
    warning: null,
    enforcement: decision.enforcement ?? null,
    refusal: freeze({
      reason: closedReasonFromSandboxDecision(decision),
      detail: decision.refusal?.detail ?? null
    }),
    sandbox_decision: decision
  });
}

function buildPlainCompatibilityResult({ decision, role, subject }) {
  const plainLaunch = decision.plain_launch ?? {};
  const warning = warningFromSandboxDecision({ decision, role, subject });
  return freeze({
    schema_version: WORKSPACE_AGENT_FAIL_OPEN_SCHEMA_VERSION,
    disposition: WORKSPACE_AGENT_FAIL_OPEN_DISPOSITIONS.PLAIN_SPAWN,
    accepted: true,
    plan: freeze({
      command: plainLaunch.command,
      args: plainLaunch.args,
      cwd: plainLaunch.cwd,
      env: plainLaunch.env
    }),
    warning,
    enforcement: decision.enforcement ?? warning.enforcement,
    isolation: freeze({
      enforced: false,
      isolation_backend: WORKSPACE_AGENT_RUN_ISOLATION_BACKENDS.NONE,
      reason:
        decision.enforcement?.reason
        ?? warning.enforcement?.reason
        ?? WORKSPACE_AGENT_RUN_ENFORCEMENT_REASONS.NO_PAID_KEY_NO_BACKEND,
      shareNet: false,
      coordination_root: null
    }),
    refusal: null,
    sandbox_decision: decision
  });
}

function compatibilityResultFromSandboxDecision({ decision, role, subject }) {
  if (decision?.outcome === WORKSPACE_AGENT_SANDBOX_OUTCOMES.UNENFORCED_PLAIN_LAUNCH) {
    return buildPlainCompatibilityResult({ decision, role, subject });
  }
  return buildClosedCompatibilityResult(decision);
}

export function buildWorkspaceAgentFailOpenPlan({
  launchFacts,
  role = null,
  subject = null,
  workspaceDir = null,
  commandSurface = null,
  confirmedIsolatedSpawn = false,
  classifyIsolationBackendAvailability,
  probeCanonicalBwrapAvailability
} = {}) {
  const decision = buildTrustedLegacyBwrapFactsDecision({
    launchFacts,
    role,
    subject,
    workspaceDir,
    commandSurface,
    confirmedIsolatedSpawn,
    classifyIsolationBackendAvailability,
    probeCanonicalBwrapAvailability
  });
  return compatibilityResultFromSandboxDecision({ decision, role, subject });
}

export default {
  WORKSPACE_AGENT_FAIL_OPEN_SCHEMA_VERSION,
  WORKSPACE_AGENT_FAIL_OPEN_WARNING_SCHEMA_VERSION,
  WORKSPACE_AGENT_FAIL_OPEN_DISPOSITIONS,
  WORKSPACE_AGENT_FAIL_OPEN_CLOSED_REASONS,
  WORKSPACE_AGENT_BACKEND_AVAILABILITY_STATES,
  classifyLauncherIsolationBackendAvailability,
  buildWorkspaceAgentFailOpenPlan
};
