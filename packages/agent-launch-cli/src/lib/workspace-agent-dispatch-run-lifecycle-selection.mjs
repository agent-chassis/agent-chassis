

import {
  BACKEND_SUPPORTED_APPS,
  validateLauncherFamilyRole,
  normalizeDispatchModelHint,
  BACKEND_FAMILY_UNAVAILABLE_REASONS,
  BACKEND_REFUSAL_CODES,
  WORKSPACE_AGENT_DISPATCH_PLAN_SCHEMA_VERSION
} from "@agent-chassis/agent-launch-core";

import { DISPATCH_FORBIDDEN_ENVELOPE_TOKENS } from "./dispatch-envelope-policy.mjs";
import {
  resolveDispatchedRoleModel,
  resolveExplicitOverrideSelection,
  resolveModelOverrideBindingPermission
} from "./agent-launch-profiles.mjs";
import { resolveModelRuntime } from "./agent-launch-model-registry.mjs";
import { dispatchRefusal } from "./workspace-agent-dispatch-refusal.mjs";

const DISPATCH_TARGET_GRAMMAR = Object.freeze({
  initiative: /^IN-\d{4}$/,
  wk: /^WK-\d{4}$/,
  slice: /^WK-\d{4}#SLICE-\d{3}$/
});

const TARGET_ROLE_MATRIX = Object.freeze({
  worker: new Set(["initiative", "wk", "slice"]),
  reviewer: new Set(["wk", "slice"]),
  redteam: new Set(["wk", "slice"])
});

function refusalDetail(detail, authority_limb = "mechanical_failure") {
  const existingLimb = detail?.authority_limb;
  return {
    ...(detail ?? {}),
    authority_limb: existingLimb === "exact_returned_policy" || existingLimb === "mechanical_failure"
      ? existingLimb
      : authority_limb
  };
}

export function resolveDispatchSelection({
  role,
  app,
  model,
  target = null,
  target_role = null,
  subject = null,
  workspaceDir,
  configRootDir = null
}) {
  const appToken = typeof app === "string" && app.trim().length > 0 ? app.trim() : null;
  const modelToken = typeof model === "string" && model.trim().length > 0 ? model.trim() : null;

  if (appToken !== null && !BACKEND_SUPPORTED_APPS.includes(appToken)) {
    return {
      ok: false,
      reason: "unsupported_app",
      detail: refusalDetail({ app: appToken, supported_apps: [...BACKEND_SUPPORTED_APPS] })
    };
  }

  const targetProjection = resolveTargetRoleProjection({
    target: target ?? subject,
    targetRole: target_role,
    role
  });
  if (!targetProjection.ok) return targetProjection;

  const modelConfigDir = typeof configRootDir === "string" && configRootDir.length > 0
    ? configRootDir
    : workspaceDir;
  let roleSelection;
  try {

    roleSelection = modelToken !== null
      ? resolveExplicitOverrideSelection({ role, app: appToken, model: modelToken })
      : resolveDispatchedRoleModel({ role, dir: modelConfigDir });
  } catch (error) {
      const refusalRole = role;
      return {
        ok: false,
        reason: `${refusalRole ?? "role"}_role_config_invalid`,
        detail: refusalDetail({
          role: typeof refusalRole === "string" ? refusalRole : null,
          config_file: "agent-launch.toml",
          source_code: error?.code ?? "agent_launch_role_config_error",
          source_detail: error?.detail ?? null,
          message: error?.message ?? String(error)
        })
      };
  }
  if (!roleSelection?.ok) {
    return roleSelection ?? {
      ok: false,
      reason: "launcher_selection_unresolved",
      detail: refusalDetail({ role: typeof role === "string" ? role : null })
    };
  }

  if (modelToken !== null) {
    const permission = resolveModelOverrideBindingPermission({
      role,
      configRootDir: modelConfigDir,
      app: roleSelection.app ?? resolveModelRuntime(modelToken)?.app ?? null,
      modelOverride: modelToken
    });
    if (!permission.ok) {
      return {
        ...permission,
        detail: refusalDetail(permission.detail, "exact_returned_policy")
      };
    }
  }

  const roleValue = roleSelection.value ?? roleSelection;
  let runtime = resolveModelRuntime(roleValue?.model);
  if (!runtime) {
    return { ok: false, reason: "role_model_unknown", detail: refusalDetail({ role, model: roleValue?.model }) };
  }

  if (appToken !== null && modelToken === null) {
    const override = resolveExplicitOverrideSelection({ role, app: appToken, model: modelToken });
    if (!override || override.ok !== true) return override;
    if (appToken !== null && override.app !== runtime.app) {
      return {
        ok: false,
        reason: "launcher_override_app_model_mismatch",
        detail: refusalDetail({ role, app_token: appToken, derived_app: runtime.app, model: runtime.model })
      };
    }
  }
  return {
    ok: true,
    ...targetProjection,
    app: runtime.app,
    model: runtime.model,
    backend: runtime.backend,
    backend_profile: runtime.backend_profile,
    default_effort: runtime.default_effort,
    model_spec: runtime.model_spec
  };
}

function classifyDispatchTarget(target) {
  if (typeof target !== "string" || target.trim().length === 0) return null;
  const value = target.trim();
  if (DISPATCH_TARGET_GRAMMAR.initiative.test(value)) return "initiative";
  if (DISPATCH_TARGET_GRAMMAR.wk.test(value)) return "wk";
  if (DISPATCH_TARGET_GRAMMAR.slice.test(value)) return "slice";
  return null;
}

function resolveTargetRoleProjection({ target, targetRole, role }) {
  const canonicalTarget = typeof target === "string" && target.trim().length > 0
    ? target.trim()
    : null;
  const canonicalRole = typeof role === "string" && role.length > 0 ? role : null;
  const requestedRole = typeof targetRole === "string" && targetRole.length > 0
    ? targetRole
    : canonicalRole;
  const routeKind = classifyDispatchTarget(canonicalTarget);
  if (canonicalTarget === null || routeKind === null) {
    return {
      ok: false,
      reason: "malformed_dispatch_target",
      detail: refusalDetail({ target: canonicalTarget, target_role: requestedRole })
    };
  }
  if (!validateLauncherFamilyRole(canonicalRole).ok ||
      requestedRole !== canonicalRole ||
      !TARGET_ROLE_MATRIX[canonicalRole]?.has(routeKind)) {
    return {
      ok: false,
      reason: "unsupported_target_role_relationship",
      detail: refusalDetail({ target: canonicalTarget, target_role: requestedRole, role: canonicalRole })
    };
  }
  return {
    ok: true,
    target: canonicalTarget,
    target_role: requestedRole,
    routeKind,
    applicable: true
  };
}

export function resolveLaunchSelection({
  role,
  target = null,
  target_role = null,
  subject,
  caller_session_id,
  app: requestedApp,
  model: requestedModel,
  workspace_dir,
  config_root_dir,
  executors,
  executorRegistryEntries,
  familyAwareWiring
}) {

  const dispatchModel = typeof requestedModel === "string" && requestedModel.length > 0
    ? requestedModel
    : null;

  if (dispatchModel !== null) {
    for (const token of DISPATCH_FORBIDDEN_ENVELOPE_TOKENS) {
      if (dispatchModel.includes(token)) {
        return {
          ok: false,
          refusal: dispatchRefusal(
            BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
            "forbidden_token_in_model_hint",
            { token }
          )
        };
      }
    }
  }

  const selection = resolveDispatchSelection({
    role,
    app: requestedApp,
    model: dispatchModel,
    target: target ?? subject,
    target_role,
    subject,
    workspaceDir: workspace_dir,
    configRootDir: config_root_dir
  });
  if (!selection.ok) {
    return {
      ok: false,
      refusal: dispatchRefusal(
        BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
        selection.reason,
        selection.detail ?? null
      )
    };
  }
  const { app, model: resolvedModel, backend: resolvedBackend,
    backend_profile: resolvedBackendProfile, default_effort: resolvedDefaultEffort } = selection;

  const familyExecutor = executors[app] ?? null;
  if (typeof familyExecutor !== "function") {
    const reason = BACKEND_FAMILY_UNAVAILABLE_REASONS[app];
    return {
      ok: false,
      refusal: dispatchRefusal(
        BACKEND_REFUSAL_CODES.BACKEND_UNAVAILABLE,
        reason,
        {
          app,
          missing_backend: familyAwareWiring
            ? `workspace_agent_dispatch_backend.launch_executors.${app}`
            : "workspace_agent_dispatch_backend.launch_executor",
          authority_limb: "mechanical_failure"
        }
      )
    };
  }
  const familyExecutorRegistryEntry = executorRegistryEntries[app] ?? familyExecutor;
  if (!caller_session_id || typeof caller_session_id !== "string") {
    return {
      ok: false,
      refusal: dispatchRefusal(
        BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
        "caller_session_id_required",
        null
      )
    };
  }

  if (!validateLauncherFamilyRole(role).ok) {
    return {
      ok: false,
      refusal: dispatchRefusal(
        BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
        "unsupported_role",
        { role }
      )
    };
  }
  if (!subject || typeof subject !== "string") {
    return {
      ok: false,
      refusal: dispatchRefusal(
        BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
        "subject_required",
        null
      )
    };
  }

  return {
    ok: true,
    app,
    target: selection.target,
    target_role: selection.target_role,
    routeKind: selection.routeKind,
    applicable: selection.applicable,
    resolvedModel,
    resolvedBackend,
    resolvedBackendProfile,
    resolvedDefaultEffort,
    familyExecutor,
    familyExecutorRegistryEntry
  };
}

export function createPlanLaunch({ executors }) {
  return function planLaunch(input = {}) {
    const {
      role = null,
      target = null,
      target_role = null,
      subject = null,
      app: requestedApp = null,
      model: requestedModel = null,
      workspace_dir = null,
      config_root_dir = null
    } = input;

    const planRefusal = (reason, detail, resolved = null) => Object.freeze({
      schema_version: WORKSPACE_AGENT_DISPATCH_PLAN_SCHEMA_VERSION,
      dry_run: true,
      accepted: false,
      role: typeof role === "string" ? role : null,
      app: resolved?.app ?? (typeof requestedApp === "string" ? requestedApp : null),
      subject: typeof subject === "string" ? subject : null,
      target: resolved?.target ?? (typeof (target ?? subject) === "string" ? (target ?? subject) : null),
      target_role: resolved?.target_role ?? null,
      routeKind: resolved?.routeKind ?? null,
      applicable: resolved?.applicable ?? null,
      model: resolved?.model ?? null,
      backend: resolved?.backend ?? null,
      backend_profile: resolved?.backend_profile ?? null,
      default_effort: resolved?.default_effort ?? null,
      workspace_dir: workspace_dir ?? null,
      executor_available: false,
      refusal: Object.freeze({ reason, detail: refusalDetail(detail) })
    });

    const dispatchModel = normalizeDispatchModelHint(requestedModel);

    if (dispatchModel !== null) {
      for (const token of DISPATCH_FORBIDDEN_ENVELOPE_TOKENS) {
        if (dispatchModel.includes(token)) {
          return planRefusal("forbidden_token_in_model_hint", { token });
        }
      }
    }

    const selection = resolveDispatchSelection({
      role,
      app: requestedApp,
      model: dispatchModel,
      target: target ?? subject,
      target_role,
      subject,
      workspaceDir: workspace_dir,
      configRootDir: config_root_dir
    });
    if (!selection.ok) {
      return planRefusal(selection.reason, selection.detail ?? null);
    }
    const {
      app,
      model: resolvedModel,
      backend: resolvedBackend,
      backend_profile: resolvedBackendProfile,
      default_effort: resolvedDefaultEffort
    } = selection;

    if (!validateLauncherFamilyRole(role).ok) {
      return planRefusal("unsupported_role", { role });
    }

    if (!subject || typeof subject !== "string") {
      return planRefusal("subject_required", null);
    }

    const executor_available = typeof executors?.[app] === "function";
    if (!executor_available) {
      return planRefusal(BACKEND_FAMILY_UNAVAILABLE_REASONS[app], {
        app,
        selected_model: resolvedModel,
        backend: resolvedBackend
      }, selection);
    }

    return Object.freeze({
      schema_version: WORKSPACE_AGENT_DISPATCH_PLAN_SCHEMA_VERSION,
      dry_run: true,
      accepted: true,
      role,
      app,
      backend: resolvedBackend,
      backend_profile: resolvedBackendProfile,
      default_effort: resolvedDefaultEffort,
      target: selection.target,
      target_role: selection.target_role,
      routeKind: selection.routeKind,
      applicable: selection.applicable,
      subject,
      model: resolvedModel,
      workspace_dir: workspace_dir ?? null,
      executor_available,
      refusal: null
    });
  };
}
