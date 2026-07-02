

export const WORKSPACE_AGENT_RUN_ISOLATION_BACKENDS = Object.freeze({
  BWRAP: "bwrap",
  SEATBELT: "seatbelt",
  NONE: "none"
});

export const WORKSPACE_AGENT_RUN_ENFORCEMENT_REASONS = Object.freeze({
  SANDBOXED: "sandboxed",
  NO_PAID_KEY_NO_BACKEND: "no_paid_key_no_backend",
  PAID_KEY_OPERATOR_OPT_OUT_NO_BACKEND: "paid_key_operator_opt_out_no_backend",
  PAID_KEY_ENFORCEMENT_REQUIRED_REFUSED: "paid_key_enforcement_required_refused",
  OPERATOR_OPT_IN_NO_BACKEND: "operator_opt_in_no_backend",
  REFUSED: "refused",
  TAMPERED_REFUSED: "tampered_refused",
  LAUNCH_ERROR_REFUSED: "launch_error_refused"
});

export const DEFAULT_WORKSPACE_AGENT_RUN_ENFORCEMENT = Object.freeze({
  enforced: false,
  isolation_backend: WORKSPACE_AGENT_RUN_ISOLATION_BACKENDS.NONE,
  command_surface: null,
  reason: WORKSPACE_AGENT_RUN_ENFORCEMENT_REASONS.REFUSED
});

const LAUNCHER_OWNED_PAID_POSTURE_REASONS = Object.freeze(new Set([
  WORKSPACE_AGENT_RUN_ENFORCEMENT_REASONS.NO_PAID_KEY_NO_BACKEND,
  WORKSPACE_AGENT_RUN_ENFORCEMENT_REASONS.PAID_KEY_OPERATOR_OPT_OUT_NO_BACKEND,
  WORKSPACE_AGENT_RUN_ENFORCEMENT_REASONS.PAID_KEY_ENFORCEMENT_REQUIRED_REFUSED
]));

const WORKSPACE_AGENT_SANDBOX_DECISION_SCHEMA_VERSION =
  "workspace-agent-sandbox-decision.v1";

const WORKSPACE_AGENT_SANDBOX_OUTCOMES = Object.freeze({
  ENFORCED_BACKEND_LAUNCH: "enforced_backend_launch",
  UNENFORCED_PLAIN_LAUNCH: "unenforced_plain_launch",
  REFUSED: "refused"
});

function enumContains(enumObject, value) {
  return Object.values(enumObject).includes(value);
}

function normalizeIsolationBackend(value) {
  return enumContains(WORKSPACE_AGENT_RUN_ISOLATION_BACKENDS, value)
    ? value
    : WORKSPACE_AGENT_RUN_ISOLATION_BACKENDS.NONE;
}

function normalizeReason(value) {
  return enumContains(WORKSPACE_AGENT_RUN_ENFORCEMENT_REASONS, value)
    ? value
    : WORKSPACE_AGENT_RUN_ENFORCEMENT_REASONS.REFUSED;
}

function normalizeUnenforcedReason(value) {
  const reason = normalizeReason(value);
  return reason === WORKSPACE_AGENT_RUN_ENFORCEMENT_REASONS.SANDBOXED
    ? WORKSPACE_AGENT_RUN_ENFORCEMENT_REASONS.REFUSED
    : reason;
}

function normalizeCallerSuppliedUnenforcedReason(value) {
  const reason = normalizeUnenforcedReason(value);
  if (LAUNCHER_OWNED_PAID_POSTURE_REASONS.has(reason)) {
    return WORKSPACE_AGENT_RUN_ENFORCEMENT_REASONS.REFUSED;
  }
  return reason;
}

function createLauncherOwnedUnenforcedRunEnforcement(reason) {
  return Object.freeze({
    ...DEFAULT_WORKSPACE_AGENT_RUN_ENFORCEMENT,
    reason: normalizeUnenforcedReason(reason)
  });
}

function isLauncherObservedSandboxConfirmation(value) {
  return (
    value === true
    || (
      value !== null
      && typeof value === "object"
      && !Array.isArray(value)
      && value.confirmedIsolatedSpawn === true
    )
  );
}

function createConfirmedSandboxRunEnforcement({
  confirmation,
  isolationBackend,
  commandSurface = null
}) {
  if (!isLauncherObservedSandboxConfirmation(confirmation)) {
    return null;
  }
  const backend = normalizeIsolationBackend(isolationBackend);
  if (backend === WORKSPACE_AGENT_RUN_ISOLATION_BACKENDS.NONE) {
    return null;
  }
  return Object.freeze({
    enforced: true,
    isolation_backend: backend,
    command_surface: commandSurface ?? null,
    reason: WORKSPACE_AGENT_RUN_ENFORCEMENT_REASONS.SANDBOXED
  });
}

export function createWorkspaceAgentRunEnforcement({
  command_surface: commandSurface = null,
  reason
} = {}) {
  return Object.freeze({
    ...DEFAULT_WORKSPACE_AGENT_RUN_ENFORCEMENT,
    command_surface: commandSurface ?? DEFAULT_WORKSPACE_AGENT_RUN_ENFORCEMENT.command_surface,
    reason: normalizeCallerSuppliedUnenforcedReason(
      reason ?? DEFAULT_WORKSPACE_AGENT_RUN_ENFORCEMENT.reason
    )
  });
}

export function createWorkspaceAgentRunEnforcementForOperatorOptInNoBackend() {
  return createLauncherOwnedUnenforcedRunEnforcement(
    WORKSPACE_AGENT_RUN_ENFORCEMENT_REASONS.OPERATOR_OPT_IN_NO_BACKEND
  );
}

export function createWorkspaceAgentRunEnforcementForNoPaidKeyNoBackend() {
  return createLauncherOwnedUnenforcedRunEnforcement(
    WORKSPACE_AGENT_RUN_ENFORCEMENT_REASONS.NO_PAID_KEY_NO_BACKEND
  );
}

export function createWorkspaceAgentRunEnforcementForPaidKeyOperatorOptOutNoBackend() {
  return createLauncherOwnedUnenforcedRunEnforcement(
    WORKSPACE_AGENT_RUN_ENFORCEMENT_REASONS.PAID_KEY_OPERATOR_OPT_OUT_NO_BACKEND
  );
}

export function createWorkspaceAgentRunEnforcementForPaidKeyEnforcementRequiredRefusal() {
  return createLauncherOwnedUnenforcedRunEnforcement(
    WORKSPACE_AGENT_RUN_ENFORCEMENT_REASONS.PAID_KEY_ENFORCEMENT_REQUIRED_REFUSED
  );
}

export function createWorkspaceAgentRunEnforcementForConfirmedSandbox({
  isolation_backend: isolationBackend = WORKSPACE_AGENT_RUN_ISOLATION_BACKENDS.BWRAP,
  command_surface: commandSurface = null,
  launcherObservedConfirmation = null,
  confirmedIsolatedSpawn = false
} = {}) {
  const backend = normalizeIsolationBackend(isolationBackend);
  return createConfirmedSandboxRunEnforcement({
    confirmation: launcherObservedConfirmation ?? confirmedIsolatedSpawn,
    isolationBackend: backend,
    commandSurface
  }) ?? createWorkspaceAgentRunEnforcement();
}

function createWorkspaceAgentRunEnforcementForObservedSandboxDecision({
  sandboxDecision,
  launcherObservedConfirmation
}) {
  const expectedBackend = normalizeIsolationBackend(sandboxDecisionBackendId(sandboxDecision));
  if (
    !isLauncherObservedSandboxConfirmation(launcherObservedConfirmation)
  ) {
    return createWorkspaceAgentRunEnforcement();
  }
  return createConfirmedSandboxRunEnforcement({
    confirmation: launcherObservedConfirmation,
    isolationBackend: expectedBackend,
    commandSurface: sandboxDecisionCommandSurface(sandboxDecision)
      ?? launcherObservedConfirmation?.command_surface
  }) ?? createWorkspaceAgentRunEnforcement();
}

function isSandboxDecision(value) {
  return (
    value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && value.schema_version === WORKSPACE_AGENT_SANDBOX_DECISION_SCHEMA_VERSION
  );
}

function sandboxDecisionReason(decision) {
  return decision?.enforcement?.reason
    ?? decision?.provenance?.reason
    ?? decision?.warning?.enforcement?.reason
    ?? null;
}

function sandboxDecisionCommandSurface(decision) {
  return decision?.enforcement?.command_surface ?? null;
}

function sandboxDecisionBackendId(decision) {
  return decision?.backend?.id
    ?? decision?.backend_launch?.backend_id
    ?? decision?.enforcement?.isolation_backend
    ?? null;
}

export function createWorkspaceAgentRunEnforcementFromSandboxDecision(
  sandboxDecision,
  { launcherObservedConfirmation = null } = {}
) {
  if (!isSandboxDecision(sandboxDecision)) {
    return createWorkspaceAgentRunEnforcement();
  }

  if (
    sandboxDecision.accepted === true
    && sandboxDecision.outcome
      === WORKSPACE_AGENT_SANDBOX_OUTCOMES.ENFORCED_BACKEND_LAUNCH
  ) {
    return createWorkspaceAgentRunEnforcementForObservedSandboxDecision({
      sandboxDecision,
      launcherObservedConfirmation
    });
  }

  if (
    sandboxDecision.accepted === true
    && sandboxDecision.outcome
      === WORKSPACE_AGENT_SANDBOX_OUTCOMES.UNENFORCED_PLAIN_LAUNCH
  ) {
    const reason = sandboxDecisionReason(sandboxDecision);
    if (reason === WORKSPACE_AGENT_RUN_ENFORCEMENT_REASONS.NO_PAID_KEY_NO_BACKEND) {
      return createWorkspaceAgentRunEnforcementForNoPaidKeyNoBackend();
    }
    if (
      reason
        === WORKSPACE_AGENT_RUN_ENFORCEMENT_REASONS.PAID_KEY_OPERATOR_OPT_OUT_NO_BACKEND
    ) {
      return createWorkspaceAgentRunEnforcementForPaidKeyOperatorOptOutNoBackend();
    }
    return createWorkspaceAgentRunEnforcement();
  }

  if (
    sandboxDecision.outcome === WORKSPACE_AGENT_SANDBOX_OUTCOMES.REFUSED
    && sandboxDecisionReason(sandboxDecision)
      === WORKSPACE_AGENT_RUN_ENFORCEMENT_REASONS.PAID_KEY_ENFORCEMENT_REQUIRED_REFUSED
  ) {
    return createWorkspaceAgentRunEnforcementForPaidKeyEnforcementRequiredRefusal();
  }

  return createWorkspaceAgentRunEnforcement();
}

export default {
  WORKSPACE_AGENT_RUN_ISOLATION_BACKENDS,
  WORKSPACE_AGENT_RUN_ENFORCEMENT_REASONS,
  DEFAULT_WORKSPACE_AGENT_RUN_ENFORCEMENT,
  createWorkspaceAgentRunEnforcement,
  createWorkspaceAgentRunEnforcementForOperatorOptInNoBackend,
  createWorkspaceAgentRunEnforcementForNoPaidKeyNoBackend,
  createWorkspaceAgentRunEnforcementForPaidKeyOperatorOptOutNoBackend,
  createWorkspaceAgentRunEnforcementForPaidKeyEnforcementRequiredRefusal,
  createWorkspaceAgentRunEnforcementForConfirmedSandbox,
  createWorkspaceAgentRunEnforcementFromSandboxDecision
};
