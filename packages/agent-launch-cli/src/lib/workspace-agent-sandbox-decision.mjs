import {
  resolveLauncherPaidNodeEngineEnforcementPosture,
  resolveLauncherUnsandboxedOptIn
} from "@agent-chassis/agent-launch-core/src/lib/config.mjs";

import { probeLauncherCanonicalBwrapAvailability } from "./launch-isolation-bwrap.mjs";
import { BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES } from "./launch-isolation-errors.mjs";
import {
  WORKSPACE_AGENT_RUN_ENFORCEMENT_REASONS,
  WORKSPACE_AGENT_RUN_ISOLATION_BACKENDS,
  createWorkspaceAgentRunEnforcement,
  createWorkspaceAgentRunEnforcementForConfirmedSandbox,
  createWorkspaceAgentRunEnforcementForNoPaidKeyNoBackend,
  createWorkspaceAgentRunEnforcementForPaidKeyEnforcementRequiredRefusal,
  createWorkspaceAgentRunEnforcementForPaidKeyOperatorOptOutNoBackend
} from "./workspace-agent-run-enforcement.mjs";

export const WORKSPACE_AGENT_SANDBOX_DECISION_SCHEMA_VERSION =
  "workspace-agent-sandbox-decision.v1";

export const WORKSPACE_AGENT_SANDBOX_WARNING_SCHEMA_VERSION =
  "workspace-agent-sandbox-warning.v1";

export const WORKSPACE_AGENT_SANDBOX_OUTCOMES = Object.freeze({
  ENFORCED_BACKEND_LAUNCH: "enforced_backend_launch",
  UNENFORCED_PLAIN_LAUNCH: "unenforced_plain_launch",
  REFUSED: "refused"
});

export const WORKSPACE_AGENT_SANDBOX_REFUSAL_REASONS = Object.freeze({
  LAUNCH_FACTS_INVALID: "launch_facts_invalid",
  LAUNCHER_POSTURE_INVALID: "launcher_posture_invalid",
  LAUNCHER_POSTURE_UNTRUSTED_INPUT: "launcher_posture_untrusted_input",
  BACKEND_SELECTION_UNTRUSTED_INPUT: "backend_selection_untrusted_input",
  BACKEND_SELECTION_UNTRUSTED: "backend_selection_untrusted",
  BACKEND_LAUNCH_PLAN_MISSING: "backend_launch_plan_missing",
  PAID_KEY_ENFORCEMENT_REQUIRED_NO_BACKEND:
    "paid_key_enforcement_required_no_backend"
});

export const WORKSPACE_AGENT_SANDBOX_BACKEND_STATES = Object.freeze({
  AVAILABLE: "available",
  NO_SUPPORTED_ENABLED_BACKEND: "no_supported_enabled_backend",
  UNUSABLE: "unusable",
  UNTRUSTED: "untrusted"
});

export const WORKSPACE_AGENT_SANDBOX_BACKEND_IDS = WORKSPACE_AGENT_RUN_ISOLATION_BACKENDS;

const WORKSPACE_AGENT_SANDBOX_RESOLVER_HOOK_AUTHORITY =
  Symbol("agent-chassis.workspace-agent-sandbox-resolver-hook-authority");
const WORKSPACE_AGENT_SANDBOX_DECISION_BRAND = new WeakSet();

const CURRENT_BWRAP_BACKEND_ID = WORKSPACE_AGENT_RUN_ISOLATION_BACKENDS.BWRAP;
const UNENFORCED_BACKEND_ID = WORKSPACE_AGENT_RUN_ISOLATION_BACKENDS.NONE;
const TRUSTED_RESOLVER_HOOK_SOURCE = "launcher_owned_resolver_hook";

const RESOLVER_HOOK_OPTION_KEYS = Object.freeze([
  "resolveEnforcementPosture",
  "resolveUnsandboxedOptIn",
  "resolveBackendSelection",
  "probeCanonicalBwrapAvailability",
  "buildBwrapLaunchPlan"
]);

const UNUSABLE_BWRAP_DIAGNOSTIC_CODES = Object.freeze(new Set([
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BWRAP_NOT_EXECUTABLE,
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BWRAP_PROBE_FAILED,
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BWRAP_SPAWN_FAILED
]));

function freeze(value) {
  return Object.freeze(value);
}

function createSandboxDecisionRecord(value) {
  const decision = freeze(value);
  WORKSPACE_AGENT_SANDBOX_DECISION_BRAND.add(decision);
  return decision;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function cloneStringMap(value, label) {
  if (!isPlainObject(value)) {
    return { ok: false, reason: `${label} must be a plain string map` };
  }
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isNonEmptyString(key) || typeof entry !== "string") {
      return { ok: false, reason: `${label} must be a plain string map` };
    }
    out[key] = entry;
  }
  return { ok: true, value: freeze(out) };
}

function cloneStringArray(value, label) {
  if (!Array.isArray(value)) {
    return { ok: false, reason: `${label} must be an array` };
  }
  const out = [];
  for (let i = 0; i < value.length; i += 1) {
    if (typeof value[i] !== "string") {
      return { ok: false, reason: `${label}[${i}] must be a string` };
    }
    out.push(value[i]);
  }
  return { ok: true, value: freeze(out) };
}

function normalizeLaunchFacts(launchFacts) {
  if (!isPlainObject(launchFacts)) {
    return { ok: false, reason: "launchFacts must be a plain object" };
  }
  if (!isNonEmptyString(launchFacts.command)) {
    return { ok: false, reason: "launchFacts.command must be a non-empty string" };
  }
  const args = cloneStringArray(launchFacts.args, "launchFacts.args");
  if (!args.ok) return args;
  if (!isNonEmptyString(launchFacts.cwd)) {
    return { ok: false, reason: "launchFacts.cwd must be a non-empty string" };
  }
  const env = cloneStringMap(launchFacts.env, "launchFacts.env");
  if (!env.ok) return env;
  return {
    ok: true,
    launchFacts: freeze({
      command: launchFacts.command,
      args: args.value,
      cwd: launchFacts.cwd,
      env: env.value
    })
  };
}

function normalizeRoleSubjectWorkspace({ role, subject, workspaceDir }) {
  return freeze({
    role: isNonEmptyString(role) ? role : null,
    subject: isNonEmptyString(subject) ? subject : null,
    workspace: isNonEmptyString(workspaceDir) ? workspaceDir : null
  });
}

function normalizeBackendId(value) {
  if (
    value === WORKSPACE_AGENT_RUN_ISOLATION_BACKENDS.BWRAP
    || value === WORKSPACE_AGENT_RUN_ISOLATION_BACKENDS.SEATBELT
  ) {
    return value;
  }
  return null;
}

function normalizeOptOutPosture(optOut) {
  if (!isPlainObject(optOut)) {
    return freeze({ enabled: false, env_key: null, source: null });
  }
  return freeze({
    enabled: optOut.enabled === true,
    env_key: optOut.env_key ?? null,
    source: optOut.source ?? null
  });
}

function hasResolverHookAuthority(value) {
  return value === WORKSPACE_AGENT_SANDBOX_RESOLVER_HOOK_AUTHORITY;
}

function hasSuppliedResolverHooks(options) {
  return RESOLVER_HOOK_OPTION_KEYS.some(
    (key) => Object.hasOwn(options, key) && options[key] !== undefined
  );
}

function normalizeResolverHooks(options = {}) {
  if (!hasSuppliedResolverHooks(options)) {
    return {
      ok: true,
      hooks: freeze({
        resolveEnforcementPosture: null,
        resolveUnsandboxedOptIn: null,
        resolveBackendSelection: null,
        probeCanonicalBwrapAvailability: probeLauncherCanonicalBwrapAvailability,
        buildBwrapLaunchPlan: null
      })
    };
  }

  if (!hasResolverHookAuthority(options.resolverHookAuthority)) {
    return {
      ok: false,
      detail: freeze({
        reason:
          "resolver/probe hooks can supply launcher-owned authority facts and require launcher/test resolver authority"
      })
    };
  }

  const hooks = {};
  for (const key of RESOLVER_HOOK_OPTION_KEYS) {
    const value = options[key] ?? null;
    if (value !== null && typeof value !== "function") {
      return {
        ok: false,
        detail: freeze({
          reason: `${key} must be a function when supplied through resolver authority`
        })
      };
    }
    hooks[key] = value;
  }

  return {
    ok: true,
    hooks: freeze({
      resolveEnforcementPosture: hooks.resolveEnforcementPosture,
      resolveUnsandboxedOptIn: hooks.resolveUnsandboxedOptIn,
      resolveBackendSelection: hooks.resolveBackendSelection,
      probeCanonicalBwrapAvailability:
        hooks.probeCanonicalBwrapAvailability ?? probeLauncherCanonicalBwrapAvailability,
      buildBwrapLaunchPlan: hooks.buildBwrapLaunchPlan
    })
  };
}

function normalizeLauncherPosture(posture) {
  if (!isPlainObject(posture)) {
    return {
      ok: false,
      detail: freeze({ reason: "launcher posture result missing or malformed" })
    };
  }
  if (posture.ok !== true) {
    return {
      ok: false,
      detail: freeze({
        code: posture.code ?? null,
        reason: posture.reason ?? null,
        paid_node_engine_key_present:
          posture.paid_node_engine_key_present === true,
        paid_node_engine_key_source:
          posture.paid_node_engine_key_source ?? null,
        paid_node_engine_key_preferred:
          posture.paid_node_engine_key_preferred ?? null,
        opt_out: normalizeOptOutPosture(posture.opt_out)
      })
    };
  }
  if (typeof posture.enforcement_required !== "boolean") {
    return {
      ok: false,
      detail: freeze({
        reason: "launcher posture did not declare enforcement_required"
      })
    };
  }
  return {
    ok: true,
    detail: freeze({
      enforcement_required: posture.enforcement_required,
      reason_code: posture.reason_code ?? null,
      reason: posture.reason ?? null,
      paid_node_engine_key_present:
        posture.paid_node_engine_key_present === true,
      paid_node_engine_key_source:
        posture.paid_node_engine_key_source ?? null,
      paid_node_engine_key_preferred:
        posture.paid_node_engine_key_preferred ?? null,
      opt_out: normalizeOptOutPosture(posture.opt_out)
    })
  };
}

function normalizeBackendSelection(selection) {
  if (!isPlainObject(selection)) {
    return {
      ok: false,
      state: WORKSPACE_AGENT_SANDBOX_BACKEND_STATES.UNTRUSTED,
      backend_id: null,
      reason: "launcher backend selection result missing or malformed",
      diagnostic: null,
      source: null,
      launch_plan: null
    };
  }

  const state = selection.state;
  const backendId = normalizeBackendId(selection.backend_id ?? selection.backend);
  const launchPlan = isPlainObject(selection.launch_plan)
    ? freeze({ ...selection.launch_plan })
    : null;
  const normalized = {
    ok: selection.ok === true,
    state: typeof state === "string"
      ? state
      : WORKSPACE_AGENT_SANDBOX_BACKEND_STATES.UNTRUSTED,
    backend_id: backendId,
    reason: selection.reason ?? null,
    diagnostic: selection.diagnostic ?? null,
    source: selection.source ?? null,
    launch_plan: launchPlan
  };

  if (
    normalized.ok
    && normalized.state === WORKSPACE_AGENT_SANDBOX_BACKEND_STATES.AVAILABLE
    && normalized.backend_id !== null
  ) {
    return freeze(normalized);
  }
  if (
    normalized.ok
    && normalized.state
      === WORKSPACE_AGENT_SANDBOX_BACKEND_STATES.NO_SUPPORTED_ENABLED_BACKEND
  ) {
    return freeze({
      ...normalized,
      backend_id: null,
      launch_plan: null
    });
  }
  if (normalized.state === WORKSPACE_AGENT_SANDBOX_BACKEND_STATES.UNUSABLE) {
    return freeze({
      ...normalized,
      ok: false,
      launch_plan: null
    });
  }
  return freeze({
    ...normalized,
    ok: false,
    state: WORKSPACE_AGENT_SANDBOX_BACKEND_STATES.UNTRUSTED,
    backend_id: null,
    launch_plan: null
  });
}

function bwrapDiagnosticFromProbe(probe) {
  if (!isPlainObject(probe?.diagnostic)) return null;
  return freeze({
    code: probe.diagnostic.code ?? null,
    message: probe.diagnostic.message ?? null,
    detail: probe.diagnostic.detail ?? null
  });
}

export function buildSandboxBackendSelectionFromBwrapFacts({
  availability,
  launchPlan = null,
  source = "launcher_canonical_bwrap_probe"
} = {}) {
  if (!isPlainObject(availability)) {
    return freeze({
      ok: false,
      state: WORKSPACE_AGENT_SANDBOX_BACKEND_STATES.UNTRUSTED,
      backend_id: null,
      reason: "bwrap availability facts missing or malformed",
      diagnostic: null,
      source,
      launch_plan: null
    });
  }
  if (availability.available === true) {
    return freeze({
      ok: true,
      state: WORKSPACE_AGENT_SANDBOX_BACKEND_STATES.AVAILABLE,
      backend_id: CURRENT_BWRAP_BACKEND_ID,
      reason: "selected backend is available",
      diagnostic: null,
      source,
      launch_plan: isPlainObject(launchPlan) ? freeze({ ...launchPlan }) : null
    });
  }
  const diagnostic = bwrapDiagnosticFromProbe(availability);
  const code = diagnostic?.code ?? null;
  if (code === BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BWRAP_UNAVAILABLE) {
    return freeze({
      ok: true,
      state: WORKSPACE_AGENT_SANDBOX_BACKEND_STATES.NO_SUPPORTED_ENABLED_BACKEND,
      backend_id: null,
      reason: "launcher backend selection found no supported enabled backend",
      diagnostic,
      source,
      launch_plan: null
    });
  }
  if (UNUSABLE_BWRAP_DIAGNOSTIC_CODES.has(code)) {
    return freeze({
      ok: false,
      state: WORKSPACE_AGENT_SANDBOX_BACKEND_STATES.UNUSABLE,
      backend_id: CURRENT_BWRAP_BACKEND_ID,
      reason: "selected bwrap backend is unavailable or unusable",
      diagnostic,
      source,
      launch_plan: null
    });
  }
  return freeze({
    ok: false,
    state: WORKSPACE_AGENT_SANDBOX_BACKEND_STATES.UNTRUSTED,
    backend_id: null,
    reason: "bwrap availability facts are not trusted backend selection facts",
    diagnostic,
    source,
    launch_plan: null
  });
}

export function selectLauncherSandboxBackend(options = {}) {
  const resolverHooks = normalizeResolverHooks(options);
  if (!resolverHooks.ok) {
    return freeze({
      ok: false,
      state: WORKSPACE_AGENT_SANDBOX_BACKEND_STATES.UNTRUSTED,
      backend_id: null,
      reason: resolverHooks.detail.reason,
      diagnostic: null,
      source: "untrusted_resolver_hook",
      launch_plan: null
    });
  }
  const {
    probeCanonicalBwrapAvailability = probeLauncherCanonicalBwrapAvailability,
    buildBwrapLaunchPlan = null
  } = resolverHooks.hooks;
  const probe = typeof probeCanonicalBwrapAvailability === "function"
    ? probeCanonicalBwrapAvailability
    : probeLauncherCanonicalBwrapAvailability;
  const launchPlanBuilder = typeof buildBwrapLaunchPlan === "function"
    ? buildBwrapLaunchPlan
    : null;
  const availability = probe();
  return buildSandboxBackendSelectionFromBwrapFacts({
    availability,
    launchPlan: availability?.available === true && launchPlanBuilder !== null
      ? launchPlanBuilder()
      : null
  });
}

export function buildWorkspaceAgentSandboxDecisionFromTrustedLegacyBwrapFacts({
  launchFacts,
  role = null,
  subject = null,
  workspaceDir = null,
  commandSurface = null,
  confirmedIsolatedSpawn = false,
  bwrapAvailability,
  bwrapLaunchPlan = null,
  source = "launcher_trusted_legacy_bwrap_facts"
} = {}) {
  const backendSelection = buildSandboxBackendSelectionFromBwrapFacts({
    availability: bwrapAvailability,
    launchPlan: bwrapLaunchPlan,
    source: isNonEmptyString(source)
      ? source
      : "launcher_trusted_legacy_bwrap_facts"
  });

  return buildWorkspaceAgentSandboxDecision({
    launchFacts,
    role,
    subject,
    workspaceDir,
    commandSurface,
    confirmedIsolatedSpawn,
    resolverHookAuthority: WORKSPACE_AGENT_SANDBOX_RESOLVER_HOOK_AUTHORITY,
    resolveBackendSelection: () => backendSelection
  });
}

function buildRefusal({
  reason,
  detail = null,
  context,
  enforcement = createWorkspaceAgentRunEnforcement()
}) {
  return createSandboxDecisionRecord({
    schema_version: WORKSPACE_AGENT_SANDBOX_DECISION_SCHEMA_VERSION,
    outcome: WORKSPACE_AGENT_SANDBOX_OUTCOMES.REFUSED,
    accepted: false,
    context,
    backend: null,
    backend_launch: null,
    plain_launch: null,
    warning: null,
    provenance: null,
    enforcement,
    refusal: freeze({ reason, detail })
  });
}

function warningCodeForReason(reason) {
  return reason === WORKSPACE_AGENT_RUN_ENFORCEMENT_REASONS.NO_PAID_KEY_NO_BACKEND
    ? "agent_launch.isolation.no_paid_key_no_backend.v1"
    : "agent_launch.isolation.paid_key_operator_opt_out_no_backend.v1";
}

function warningMessageForReason(reason) {
  if (reason === WORKSPACE_AGENT_RUN_ENFORCEMENT_REASONS.NO_PAID_KEY_NO_BACKEND) {
    return "filesystem isolation is NOT active; launcher-owned enforcement posture permits this worker-family role to run unenforced because no canonical paid Node Engine key is configured and backend selection could not produce an enforced launch";
  }
  return "filesystem isolation is NOT active; launcher-owned enforcement posture permits this worker-family role to run unenforced because a canonical paid Node Engine key is configured and the operator explicitly opted out of local enforcement";
}

function buildUnenforcedReason(posture) {
  if (posture.paid_node_engine_key_present === true) {
    return WORKSPACE_AGENT_RUN_ENFORCEMENT_REASONS.PAID_KEY_OPERATOR_OPT_OUT_NO_BACKEND;
  }
  return WORKSPACE_AGENT_RUN_ENFORCEMENT_REASONS.NO_PAID_KEY_NO_BACKEND;
}

function buildUnenforcedEnforcement(reason) {
  if (reason === WORKSPACE_AGENT_RUN_ENFORCEMENT_REASONS.NO_PAID_KEY_NO_BACKEND) {
    return createWorkspaceAgentRunEnforcementForNoPaidKeyNoBackend();
  }
  return createWorkspaceAgentRunEnforcementForPaidKeyOperatorOptOutNoBackend();
}

function buildUnenforcedPlainLaunch({
  launchFacts,
  context,
  posture,
  backendSelection
}) {
  const reason = buildUnenforcedReason(posture);
  const enforcement = buildUnenforcedEnforcement(reason);
  const provenance = freeze({
    schema_version: WORKSPACE_AGENT_SANDBOX_WARNING_SCHEMA_VERSION,
    outcome: WORKSPACE_AGENT_SANDBOX_OUTCOMES.UNENFORCED_PLAIN_LAUNCH,
    enforced: false,
    isolation_backend: UNENFORCED_BACKEND_ID,
    reason,
    role: context.role,
    subject: context.subject,
    workspace: context.workspace,
    backend_selection: backendSelection,
    enforcement_posture: posture
  });
  return createSandboxDecisionRecord({
    schema_version: WORKSPACE_AGENT_SANDBOX_DECISION_SCHEMA_VERSION,
    outcome: WORKSPACE_AGENT_SANDBOX_OUTCOMES.UNENFORCED_PLAIN_LAUNCH,
    accepted: true,
    context,
    backend: freeze({
      id: UNENFORCED_BACKEND_ID,
      state: backendSelection.state,
      selected: false
    }),
    backend_launch: null,
    plain_launch: freeze({
      command: launchFacts.command,
      args: launchFacts.args,
      cwd: launchFacts.cwd,
      env: launchFacts.env
    }),
    warning: freeze({
      schema_version: WORKSPACE_AGENT_SANDBOX_WARNING_SCHEMA_VERSION,
      code: warningCodeForReason(reason),
      severity: "warning",
      message: warningMessageForReason(reason),
      role: context.role,
      subject: context.subject,
      workspace: context.workspace,
      enforcement,
      enforcement_posture: posture,
      backend_selection: backendSelection
    }),
    provenance,
    enforcement,
    refusal: null
  });
}

function buildEnforcedBackendLaunch({
  context,
  backendSelection,
  commandSurface = null,
  confirmedIsolatedSpawn = false
}) {
  const enforcement = confirmedIsolatedSpawn === true
    ? createWorkspaceAgentRunEnforcementForConfirmedSandbox({
        isolation_backend: backendSelection.backend_id,
        command_surface: commandSurface,
        confirmedIsolatedSpawn: true
      })
    : createWorkspaceAgentRunEnforcement({
        enforced: true,
        isolation_backend: backendSelection.backend_id,
        command_surface: commandSurface,
        confirmedIsolatedSpawn: false
      });
  return createSandboxDecisionRecord({
    schema_version: WORKSPACE_AGENT_SANDBOX_DECISION_SCHEMA_VERSION,
    outcome: WORKSPACE_AGENT_SANDBOX_OUTCOMES.ENFORCED_BACKEND_LAUNCH,
    accepted: true,
    context,
    backend: freeze({
      id: backendSelection.backend_id,
      state: backendSelection.state,
      selected: true,
      source: backendSelection.source ?? null,
      diagnostic: backendSelection.diagnostic ?? null
    }),
    backend_launch: freeze({
      backend_id: backendSelection.backend_id,
      plan: backendSelection.launch_plan
    }),
    plain_launch: null,
    warning: null,
    provenance: freeze({
      schema_version: WORKSPACE_AGENT_SANDBOX_WARNING_SCHEMA_VERSION,
      outcome: WORKSPACE_AGENT_SANDBOX_OUTCOMES.ENFORCED_BACKEND_LAUNCH,
      enforced: enforcement.enforced,
      isolation_backend: backendSelection.backend_id,
      reason: WORKSPACE_AGENT_RUN_ENFORCEMENT_REASONS.SANDBOXED,
      role: context.role,
      subject: context.subject,
      workspace: context.workspace,
      backend_selection: backendSelection
    }),
    enforcement,
    refusal: null
  });
}

function resolveLauncherOwnedPosture({
  workspaceDir,
  resolveEnforcementPosture,
  resolveUnsandboxedOptIn
}) {
  const resolver = typeof resolveEnforcementPosture === "function"
    ? resolveEnforcementPosture
    : resolveLauncherPaidNodeEngineEnforcementPosture;
  const optOutResolver = typeof resolveUnsandboxedOptIn === "function"
    ? resolveUnsandboxedOptIn
    : resolveLauncherUnsandboxedOptIn;
  return resolver({
    workspaceDir,
    resolveUnsandboxedOptIn: optOutResolver
  });
}

function resolveLauncherOwnedBackendSelection({
  resolveBackendSelection,
  probeCanonicalBwrapAvailability,
  buildBwrapLaunchPlan,
  resolverHookAuthority
}) {
  const selector = typeof resolveBackendSelection === "function"
    ? resolveBackendSelection
    : selectLauncherSandboxBackend;
  return selector({
    probeCanonicalBwrapAvailability,
    buildBwrapLaunchPlan,
    resolverHookAuthority,
    source: TRUSTED_RESOLVER_HOOK_SOURCE
  });
}

function hasCallerSuppliedAuthorityFacts(options) {
  return [
    "enforcementPosture",
    "paidKeyEnforcementPosture",
    "explicitOptOutPosture",
    "optOut",
    "backendAvailability",
    "backendSelection",
    "backendLaunchPlan",
    "bwrapProbe"
  ].some((key) => Object.hasOwn(options, key) && options[key] !== undefined);
}

function refusedEnforcementForBackendSelection(backendSelection) {
  if (backendSelection.state === WORKSPACE_AGENT_SANDBOX_BACKEND_STATES.UNUSABLE) {
    return createWorkspaceAgentRunEnforcement({
      reason: WORKSPACE_AGENT_RUN_ENFORCEMENT_REASONS.TAMPERED_REFUSED
    });
  }
  return createWorkspaceAgentRunEnforcement();
}

export function isWorkspaceAgentSandboxDecision(value) {
  return (
    isPlainObject(value)
    && value.schema_version === WORKSPACE_AGENT_SANDBOX_DECISION_SCHEMA_VERSION
    && WORKSPACE_AGENT_SANDBOX_DECISION_BRAND.has(value)
  );
}

export function buildWorkspaceAgentSandboxDecision(options = {}) {
  const {
    launchFacts,
    role = null,
    subject = null,
    workspaceDir = null,
    commandSurface = null,
    confirmedIsolatedSpawn = false
  } = options;
  const context = normalizeRoleSubjectWorkspace({ role, subject, workspaceDir });

  const normalizedLaunchFacts = normalizeLaunchFacts(launchFacts);
  if (!normalizedLaunchFacts.ok) {
    return buildRefusal({
      reason: WORKSPACE_AGENT_SANDBOX_REFUSAL_REASONS.LAUNCH_FACTS_INVALID,
      detail: { reason: normalizedLaunchFacts.reason },
      context
    });
  }

  if (hasCallerSuppliedAuthorityFacts(options)) {
    return buildRefusal({
      reason: WORKSPACE_AGENT_SANDBOX_REFUSAL_REASONS.LAUNCHER_POSTURE_UNTRUSTED_INPUT,
      detail: {
        reason:
          "caller-supplied posture/backend results are not launcher-owned authority; use launcher resolver hooks only"
      },
      context
    });
  }

  const resolverHooks = normalizeResolverHooks(options);
  if (!resolverHooks.ok) {
    return buildRefusal({
      reason: WORKSPACE_AGENT_SANDBOX_REFUSAL_REASONS.LAUNCHER_POSTURE_UNTRUSTED_INPUT,
      detail: resolverHooks.detail,
      context
    });
  }

  let postureResult;
  try {
    postureResult = resolveLauncherOwnedPosture({
      workspaceDir,
      resolveEnforcementPosture: resolverHooks.hooks.resolveEnforcementPosture,
      resolveUnsandboxedOptIn: resolverHooks.hooks.resolveUnsandboxedOptIn
    });
  } catch (error) {
    return buildRefusal({
      reason: WORKSPACE_AGENT_SANDBOX_REFUSAL_REASONS.LAUNCHER_POSTURE_INVALID,
      detail: {
        reason: "launcher posture resolver threw",
        message: error?.message ?? String(error),
        code: error?.code ?? null
      },
      context
    });
  }
  const posture = normalizeLauncherPosture(postureResult);
  if (!posture.ok) {
    return buildRefusal({
      reason: WORKSPACE_AGENT_SANDBOX_REFUSAL_REASONS.LAUNCHER_POSTURE_INVALID,
      detail: posture.detail,
      context,
      enforcement: createWorkspaceAgentRunEnforcementForPaidKeyEnforcementRequiredRefusal()
    });
  }

  let backendSelectionResult;
  try {
    backendSelectionResult = resolveLauncherOwnedBackendSelection({
      resolveBackendSelection: resolverHooks.hooks.resolveBackendSelection,
      probeCanonicalBwrapAvailability:
        resolverHooks.hooks.probeCanonicalBwrapAvailability,
      buildBwrapLaunchPlan: resolverHooks.hooks.buildBwrapLaunchPlan,
      resolverHookAuthority: WORKSPACE_AGENT_SANDBOX_RESOLVER_HOOK_AUTHORITY
    });
  } catch (error) {
    return buildRefusal({
      reason: WORKSPACE_AGENT_SANDBOX_REFUSAL_REASONS.BACKEND_SELECTION_UNTRUSTED,
      detail: {
        reason: "launcher backend selector threw",
        message: error?.message ?? String(error),
        code: error?.code ?? null
      },
      context
    });
  }
  const backendSelection = normalizeBackendSelection(backendSelectionResult);

  if (
    backendSelection.ok
    && backendSelection.state === WORKSPACE_AGENT_SANDBOX_BACKEND_STATES.AVAILABLE
  ) {
    if (!isPlainObject(backendSelection.launch_plan)) {
      return buildRefusal({
        reason: WORKSPACE_AGENT_SANDBOX_REFUSAL_REASONS.BACKEND_LAUNCH_PLAN_MISSING,
        detail: {
          backend_selection: backendSelection,
          remediation: [
            "supply launch-plan facts through the launcher-owned backend adapter"
          ]
        },
        context
      });
    }
    return buildEnforcedBackendLaunch({
      context,
      backendSelection,
      commandSurface,
      confirmedIsolatedSpawn
    });
  }

  if (posture.detail.enforcement_required === true) {
    return buildRefusal({
      reason:
        WORKSPACE_AGENT_SANDBOX_REFUSAL_REASONS.PAID_KEY_ENFORCEMENT_REQUIRED_NO_BACKEND,
      detail: {
        enforcement_posture: posture.detail,
        backend_selection: backendSelection,
        remediation: [
          "install or repair the configured isolation backend",
          "remove the paid Node Engine key for local/free unenforced posture",
          "set the explicit unsandboxed opt-out only if the operator deliberately accepts unenforced local execution"
        ]
      },
      context,
      enforcement: createWorkspaceAgentRunEnforcementForPaidKeyEnforcementRequiredRefusal()
    });
  }

  if (
    backendSelection.state === WORKSPACE_AGENT_SANDBOX_BACKEND_STATES.NO_SUPPORTED_ENABLED_BACKEND
    || backendSelection.state === WORKSPACE_AGENT_SANDBOX_BACKEND_STATES.UNUSABLE
  ) {
    return buildUnenforcedPlainLaunch({
      launchFacts: normalizedLaunchFacts.launchFacts,
      context,
      posture: posture.detail,
      backendSelection
    });
  }

  return buildRefusal({
    reason: WORKSPACE_AGENT_SANDBOX_REFUSAL_REASONS.BACKEND_SELECTION_UNTRUSTED,
    detail: backendSelection,
    context,
    enforcement: refusedEnforcementForBackendSelection(backendSelection)
  });
}

export default {
  WORKSPACE_AGENT_SANDBOX_DECISION_SCHEMA_VERSION,
  WORKSPACE_AGENT_SANDBOX_WARNING_SCHEMA_VERSION,
  WORKSPACE_AGENT_SANDBOX_OUTCOMES,
  WORKSPACE_AGENT_SANDBOX_REFUSAL_REASONS,
  WORKSPACE_AGENT_SANDBOX_BACKEND_STATES,
  WORKSPACE_AGENT_SANDBOX_BACKEND_IDS,
  buildSandboxBackendSelectionFromBwrapFacts,
  buildWorkspaceAgentSandboxDecisionFromTrustedLegacyBwrapFacts,
  selectLauncherSandboxBackend,
  isWorkspaceAgentSandboxDecision,
  buildWorkspaceAgentSandboxDecision
};
