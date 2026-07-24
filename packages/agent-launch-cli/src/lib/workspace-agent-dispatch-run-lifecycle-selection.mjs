

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
  resolveExplicitOverrideSelection
} from "./agent-launch-profiles.mjs";
import { resolveModel } from "./agent-launch-model-registry.mjs";
import { dispatchRefusal } from "./workspace-agent-dispatch-refusal.mjs";

export function resolveDispatchSelection({ role, app, model, workspaceDir, configRootDir = null }) {
  const appToken = typeof app === "string" && app.trim().length > 0 ? app.trim() : null;
  const modelToken = typeof model === "string" && model.trim().length > 0 ? model.trim() : null;

  if (appToken !== null && !BACKEND_SUPPORTED_APPS.includes(appToken)) {
    return {
      ok: false,
      reason: "unsupported_app",
      detail: { app: appToken, supported_apps: [...BACKEND_SUPPORTED_APPS] }
    };
  }

  let selection;
  if (appToken !== null || modelToken !== null) {

    selection = appToken !== null && modelToken === null
      ? { ok: true, app: appToken, model: null, model_spec: null }
      : resolveExplicitOverrideSelection({ role, app: appToken, model: modelToken });
  } else {
    const modelConfigDir = typeof configRootDir === "string" && configRootDir.length > 0
      ? configRootDir
      : workspaceDir;
    try {
      selection = resolveDispatchedRoleModel({ role, dir: modelConfigDir });
    } catch (error) {
      const refusalRole = role === "review" ? "reviewer" : role;
      return {
        ok: false,
        reason: `${refusalRole ?? "role"}_role_config_invalid`,
        detail: {
          role: typeof refusalRole === "string" ? refusalRole : null,
          config_file: "agent-launch.toml",
          source_code: error?.code ?? "agent_launch_role_config_error",
          source_detail: error?.detail ?? null,
          message: error?.message ?? String(error)
        }
      };
    }
  }

  if (!selection || selection.ok !== true) {
    return selection ?? {
      ok: false,
      reason: "launcher_selection_unresolved",
      detail: { role: typeof role === "string" ? role : null }
    };
  }

  const modelSpec = selection.model_spec
    ?? (typeof selection.model === "string" ? resolveModel(selection.model) : null);
  return {
    ok: true,
    app: selection.app,
    model: selection.model ?? null,
    backend: modelSpec?.backend ?? null
  };
}

export function resolveLaunchSelection({
  role,
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
  const { app, model: resolvedModel, backend: resolvedBackend } = selection;

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
            : "workspace_agent_dispatch_backend.launch_executor"
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
    resolvedModel,
    resolvedBackend,
    familyExecutor,
    familyExecutorRegistryEntry
  };
}

export function createPlanLaunch({ executors }) {
  return function planLaunch(input = {}) {
    const {
      role = null,
      subject = null,
      app: requestedApp = null,
      model: requestedModel = null,
      workspace_dir = null,
      config_root_dir = null
    } = input;

    const planRefusal = (reason, detail) => Object.freeze({
      schema_version: WORKSPACE_AGENT_DISPATCH_PLAN_SCHEMA_VERSION,
      dry_run: true,
      accepted: false,
      role: typeof role === "string" ? role : null,
      app: typeof requestedApp === "string" ? requestedApp : null,
      subject: typeof subject === "string" ? subject : null,
      model: null,
      workspace_dir: workspace_dir ?? null,
      executor_available: false,
      refusal: Object.freeze({ reason, detail: detail ?? null })
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
      workspaceDir: workspace_dir,
      configRootDir: config_root_dir
    });
    if (!selection.ok) {
      return planRefusal(selection.reason, selection.detail ?? null);
    }
    const { app, model: resolvedModel, backend: resolvedBackend } = selection;

    if (!validateLauncherFamilyRole(role).ok) {
      return planRefusal("unsupported_role", { role });
    }

    if (!subject || typeof subject !== "string") {
      return planRefusal("subject_required", null);
    }

    const executor_available = typeof executors[app] === "function";

    return Object.freeze({
      schema_version: WORKSPACE_AGENT_DISPATCH_PLAN_SCHEMA_VERSION,
      dry_run: true,
      accepted: true,
      role,
      app,
      backend: resolvedBackend,
      subject,
      model: resolvedModel,
      workspace_dir: workspace_dir ?? null,
      executor_available,
      refusal: null
    });
  };
}
