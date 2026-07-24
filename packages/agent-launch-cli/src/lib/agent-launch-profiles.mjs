import { readNonSecretWorkspaceEnvValue } from "@agent-chassis/wiki-core/src/lib/node-engine-env-bootstrap.mjs";

import {
  MODEL_NAME_SET,
  appDefault,
  resolveModel
} from "./agent-launch-model-registry.mjs";
import {
  readRoleDefaultModel,
  readRoleEffort
} from "./agent-launch-role-config.mjs";

export const AGENT_LAUNCH_PROFILE_SCHEMA_VERSION = "agent-launch-profile.v1";

const ROLE_MODEL_ENV_KEY = Object.freeze({
  worker: "WORKER_MODEL",
  reviewer: "REVIEWER_MODEL",
  review: "REVIEWER_MODEL",
  redteam: "REDTEAM_MODEL",
  orchestrator: "ORCHESTRATOR_MODEL",
  resume: "ORCHESTRATOR_MODEL"
});

const ROLE_MODEL_UNSET_CODE = Object.freeze({
  worker: "worker_model_unset",
  reviewer: "reviewer_model_unset",
  review: "reviewer_model_unset",
  redteam: "redteam_model_unset",
  orchestrator: "orchestrator_model_unset",
  resume: "orchestrator_model_unset"
});

const ROLE_APP_ENV_KEY = Object.freeze({
  worker: "WORKER_APP",
  reviewer: "REVIEWER_APP",
  review: "REVIEWER_APP",
  redteam: "REDTEAM_APP",
  orchestrator: "ORCHESTRATOR_APP",
  resume: "ORCHESTRATOR_APP"
});

const ROLE_EFFORT_ENV_KEY = Object.freeze({
  worker: "WORKER_EFFORT",
  reviewer: "REVIEWER_EFFORT",
  review: "REVIEWER_EFFORT",
  redteam: "REDTEAM_EFFORT",
  orchestrator: "ORCHESTRATOR_EFFORT",
  resume: "ORCHESTRATOR_EFFORT"
});

export const AGENT_LAUNCH_NEUTRAL_EFFORTS = Object.freeze([
  "low",
  "medium",
  "high",
  "xhigh",
  "max"
]);

const NEUTRAL_EFFORT_SET = new Set(AGENT_LAUNCH_NEUTRAL_EFFORTS);

function freezeEffortMap(entries) {
  return Object.freeze(Object.fromEntries(
    Object.entries(entries).map(([level, value]) => [
      level,
      Object.freeze({
        ...value,
        ...(value.output_config ? { output_config: Object.freeze({ ...value.output_config }) } : {})
      })
    ])
  ));
}

export const AGENT_LAUNCH_FAMILY_EFFORT_MAP = Object.freeze({
  codex: freezeEffortMap({
    low: { model_reasoning_effort: "low", backend_profile_key: null },
    medium: { model_reasoning_effort: "medium", backend_profile_key: null },
    high: { model_reasoning_effort: "high", backend_profile_key: null },
    xhigh: {
      model_reasoning_effort: "xhigh",
      backend_profile_key: "orchestrator_xhigh",
      backend_profile_key_scope: "orchestrator_existing_tier"
    },
    max: {
      model_reasoning_effort: "xhigh",
      backend_profile_key: "orchestrator_xhigh",
      backend_profile_key_scope: "orchestrator_existing_tier",
      clamped_from: "max"
    }
  }),
  claude: freezeEffortMap({
    low: { output_config: { effort: "low" } },
    medium: { output_config: { effort: "medium" } },
    high: { output_config: { effort: "high" } },
    xhigh: { output_config: { effort: "xhigh" } },
    max: { output_config: { effort: "max" } }
  })
});

export function roleModelEnvKey(role) {
  if (typeof role !== "string") {
    return null;
  }
  return Object.prototype.hasOwnProperty.call(ROLE_MODEL_ENV_KEY, role)
    ? ROLE_MODEL_ENV_KEY[role]
    : null;
}

export function roleAppEnvKey(role) {
  if (typeof role !== "string") {
    return null;
  }
  return Object.prototype.hasOwnProperty.call(ROLE_APP_ENV_KEY, role)
    ? ROLE_APP_ENV_KEY[role]
    : null;
}

export function roleEffortEnvKey(role) {
  if (typeof role !== "string") {
    return null;
  }
  return Object.prototype.hasOwnProperty.call(ROLE_EFFORT_ENV_KEY, role)
    ? ROLE_EFFORT_ENV_KEY[role]
    : null;
}

export function isNeutralEffortLevel(value) {
  return typeof value === "string" && NEUTRAL_EFFORT_SET.has(value);
}

export function neutralEffortMapping({ family, effort } = {}) {
  if (typeof family !== "string" || typeof effort !== "string") {
    return null;
  }
  const familyMap = AGENT_LAUNCH_FAMILY_EFFORT_MAP[family];
  if (!familyMap) {
    return null;
  }
  return familyMap[effort] ?? null;
}

export function roleModelUnsetCode(role) {
  if (typeof role !== "string") {
    return null;
  }
  return Object.prototype.hasOwnProperty.call(ROLE_MODEL_UNSET_CODE, role)
    ? ROLE_MODEL_UNSET_CODE[role]
    : null;
}

function knownApps() {
  return APP_VOCABULARY.slice();
}

function knownModels() {
  return [...MODEL_NAME_SET].sort();
}

function unknownAppOrModelRefusal(token) {
  return {
    ok: false,
    reason: "unknown_launcher_app_or_model",
    detail: {
      token,
      known_apps: knownApps(),
      known_models: knownModels(),
      message: `unknown launcher app/model ${JSON.stringify(token)}; known apps: ${knownApps().join(", ")}; known models: ${knownModels().join(", ")}`
    }
  };
}

function unknownRoleModelRefusal({ role, model, source }) {
  const refusalRole = role === "review" ? "reviewer" : role === "resume" ? "orchestrator" : role;
  const code = typeof refusalRole === "string" && refusalRole.length > 0
    ? `${refusalRole}_model_unknown`
    : "role_model_unknown";
  return {
    ok: false,
    reason: code,
    detail: {
      role: typeof role === "string" ? role : null,
      model,
      model_source: source,
      known_models: knownModels(),
      message: `${code}: model ${JSON.stringify(model)} is not registered; known models: ${knownModels().join(", ")}`
    }
  };
}

function appDefaultRefusal(app) {
  return {
    ok: false,
    reason: "app_default_model_unset",
    detail: {
      app,
      known_apps: knownApps(),
      known_models: knownModels(),
      message: `launcher app ${app} has no app_default model in the model registry; pass a registered model instead`
    }
  };
}

function resolveKnownModel({ role, model, source }) {
  const resolved = resolveModel(model);
  if (!resolved) {
    return unknownRoleModelRefusal({ role, model, source });
  }
  return {
    ok: true,
    model,
    app: resolved.app,
    model_source: source,
    app_source: "model_registry",
    model_spec: resolved
  };
}

export function resolveLauncherOverrideToken(token) {
  if (typeof token !== "string" || token.trim().length === 0) {
    return unknownAppOrModelRefusal(typeof token === "string" ? token : null);
  }
  const normalized = token.trim();

  if (APP_VOCABULARY.includes(normalized)) {
    const defaultModel = appDefault(normalized);
    if (typeof defaultModel !== "string" || defaultModel.length === 0) {
      return appDefaultRefusal(normalized);
    }
    const resolvedDefault = resolveModel(defaultModel);
    if (!resolvedDefault) {
      return unknownRoleModelRefusal({
        role: null,
        model: defaultModel,
        source: "app_default"
      });
    }
    return {
      ok: true,
      token: normalized,
      app: normalized,
      model: defaultModel,
      app_source: "operator_override",
      model_source: "app_default",
      model_spec: resolvedDefault
    };
  }

  if (MODEL_NAME_SET.has(normalized)) {
    const resolved = resolveModel(normalized);
    return {
      ok: true,
      token: normalized,
      app: resolved.app,
      model: normalized,
      app_source: "model_registry",
      model_source: "operator_override",
      model_spec: resolved
    };
  }

  return unknownAppOrModelRefusal(normalized);
}

export function resolveExplicitOverrideSelection({ role, app, model }) {
  const appToken = typeof app === "string" && app.trim().length > 0 ? app.trim() : null;
  const modelToken = typeof model === "string" && model.trim().length > 0 ? model.trim() : null;

  const appSelection = appToken === null ? null : resolveLauncherOverrideToken(appToken);
  if (appSelection && appSelection.ok !== true) {
    return appSelection;
  }

  const modelSelection = modelToken === null ? null : resolveLauncherOverrideToken(modelToken);
  if (modelSelection && modelSelection.ok !== true) {
    return modelSelection;
  }

  if (appSelection && modelSelection && appSelection.app !== modelSelection.app) {
    return {
      ok: false,
      reason: "launcher_override_app_model_mismatch",
      detail: {
        role: typeof role === "string" ? role : null,
        app_token: appToken,
        model_token: modelToken,
        app_token_app: appSelection.app,
        model_token_app: modelSelection.app,
        message: `launcher override mismatch: ${appToken} resolves to app ${appSelection.app}, but ${modelToken} resolves to app ${modelSelection.app}`
      }
    };
  }

  if (modelSelection) {
    return { ...modelSelection, app_source: appSelection ? "operator_override" : modelSelection.app_source };
  }
  return appSelection ?? null;
}

function readDeprecatedRoleApp({ role, dir, readWorkspaceEnvValue }) {
  const envKey = roleAppEnvKey(role);
  if (!envKey) {
    return null;
  }
  if (typeof dir !== "string" || dir.length === 0) {
    return null;
  }
  const value = readWorkspaceEnvValue({ dir, key: envKey });
  return typeof value === "string" && value.trim().length > 0
    ? { env_key: envKey, app: value.trim() }
    : null;
}

function probeDeprecatedRoleApp({ role, derivedApp, dir, readWorkspaceEnvValue }) {
  const deprecated = readDeprecatedRoleApp({ role, dir, readWorkspaceEnvValue });
  if (!deprecated) {
    return { ok: true, diagnostic: null };
  }
  const diagnostic = {
    code: "role_app_deprecated",
    role,
    env_key: deprecated.env_key,
    declared_app: deprecated.app,
    derived_app: derivedApp,
    message: `${deprecated.env_key} is deprecated; app is derived from the selected model`
  };
  if (deprecated.app !== derivedApp) {
    return {
      ok: false,
      reason: "role_app_deprecated_mismatch",
      detail: {
        ...diagnostic,
        message: `${deprecated.env_key}=${deprecated.app} is deprecated and disagrees with model-derived app ${derivedApp}`
      }
    };
  }
  return { ok: true, diagnostic };
}

function readDeprecatedRoleEffort({ role, dir, readWorkspaceEnvValue }) {
  const envKey = roleEffortEnvKey(role);
  if (!envKey) {
    return null;
  }
  if (typeof dir !== "string" || dir.length === 0) {
    return null;
  }
  const value = readWorkspaceEnvValue({ dir, key: envKey });
  return typeof value === "string" && value.trim().length > 0
    ? { env_key: envKey, effort: value.trim() }
    : null;
}

function probeDeprecatedRoleEffort({
  role,
  configEffort,
  effectiveEffort,
  dir,
  readWorkspaceEnvValue
}) {
  const deprecated = readDeprecatedRoleEffort({ role, dir, readWorkspaceEnvValue });
  if (!deprecated) {
    return { ok: true, diagnostic: null };
  }
  const diagnostic = {
    code: "role_effort_deprecated",
    role,
    env_key: deprecated.env_key,
    declared_effort: deprecated.effort,
    config_effort: configEffort,
    effective_effort: effectiveEffort,
    message: `${deprecated.env_key} is deprecated; effort is read from agent-launch.toml or the model registry`
  };
  if (typeof configEffort === "string" && deprecated.effort !== configEffort) {
    return {
      ok: false,
      reason: "role_effort_deprecated_mismatch",
      detail: {
        ...diagnostic,
        message: `${deprecated.env_key}=${deprecated.effort} is deprecated and disagrees with agent-launch.toml effort ${configEffort}`
      }
    };
  }
  return { ok: true, diagnostic };
}

export function resolveEffectiveRoleEffort({
  role,
  effortOverride,
  selectedModel,
  dir,
  readRoleEffortValue = readRoleEffort
}) {
  const configEffort = readRoleEffortValue(role, { dir });
  const override = typeof effortOverride === "string" && effortOverride.trim().length > 0
    ? effortOverride.trim()
    : null;
  if (override !== null) {
    if (!isNeutralEffortLevel(override)) {
      return {
        ok: false,
        reason: "unknown_effort",
        detail: {
          role,
          effort: override,
          message: `unknown effort ${JSON.stringify(override)}; expected low|medium|high|xhigh|max`
        }
      };
    }
    return {
      ok: true,
      effort: override,
      effort_source: "operator_override",
      config_effort: configEffort
    };
  }

  if (typeof configEffort === "string" && configEffort.length > 0) {
    return {
      ok: true,
      effort: configEffort,
      effort_source: "role_config",
      config_effort: configEffort
    };
  }

  const resolvedModel = resolveModel(selectedModel);
  if (!resolvedModel) {
    return {
      ok: false,
      reason: "role_model_unknown",
      detail: {
        role,
        model: selectedModel,
        message: `cannot resolve default effort for unknown model ${JSON.stringify(selectedModel)}`
      }
    };
  }
  return {
    ok: true,
    effort: resolvedModel.default_effort,
    effort_source: "model_registry_default",
    config_effort: null
  };
}

export function resolveDispatchedRoleModel({
  role,
  resolvedProfile = null,
  dir = null,
  readRoleDefaultModelValue = readRoleDefaultModel
} = {}) {
  const envKey = roleModelEnvKey(role);
  const unsetCode = typeof role === "string"
    && Object.prototype.hasOwnProperty.call(ROLE_MODEL_UNSET_CODE, role)
    ? ROLE_MODEL_UNSET_CODE[role]
    : null;
  if (!envKey || !unsetCode) {
    return {
      ok: false,
      reason: "model_unset_for_unknown_role",
      detail: { role: typeof role === "string" ? role : null }
    };
  }

  const profileModel = typeof resolvedProfile?.model === "string" && resolvedProfile.model.length > 0
    ? resolvedProfile.model
    : null;
  if (profileModel !== null) {
    const modelSource = typeof resolvedProfile?.model_source === "string"
      ? resolvedProfile.model_source
      : "profile_default";
    const resolvedModel = resolveKnownModel({ role, model: profileModel, source: modelSource });
    if (!resolvedModel.ok) {
      return resolvedModel;
    }
    return {
      ok: true,
      model: profileModel,
      app: resolvedModel.app,
      model_source: modelSource,
      app_source: resolvedModel.app_source,
      env_key: envKey,
      resolvedProfile: {
        ...(resolvedProfile ?? {}),
        app: resolvedModel.app,
        model: profileModel,
        model_source: modelSource
      }
    };
  }

  const roleDefaultModel = readRoleDefaultModelValue(role, { dir });
  if (typeof roleDefaultModel === "string" && roleDefaultModel.length > 0) {
    const resolvedModel = resolveKnownModel({
      role,
      model: roleDefaultModel,
      source: "role_config"
    });
    if (!resolvedModel.ok) {
      return resolvedModel;
    }

    if (resolvedProfile && resolvedProfile.model_override_allowed === false) {
      return {
        ok: false,
        reason: "model_override_not_allowed_for_binding",
        detail: { role, env_key: envKey, requested_model: roleDefaultModel }
      };
    }
    return {
      ok: true,
      model: roleDefaultModel,
      app: resolvedModel.app,
      model_source: "role_config",
      app_source: resolvedModel.app_source,
      env_key: envKey,
      resolvedProfile: {
        ...(resolvedProfile ?? {}),
        app: resolvedModel.app,
        model: roleDefaultModel,
        model_source: "role_config"
      }
    };
  }

  return {
    ok: false,
    reason: unsetCode,
    detail: {
      role,
      env_key: envKey,
      message: `${unsetCode}: no model override, profile default_model, or [roles].${role === "review" ? "reviewer" : role} entry in agent-launch.toml was provided; set the role default model in agent-launch.toml to select the ${role} model`
    }
  };
}

export function resolveDispatchedRoleApp({
  role,
  profile = null,
  app = null,
  model = null,
  dir = null,
  readWorkspaceEnvValue = readNonSecretWorkspaceEnvValue
} = {}) {
  const overrideSelection = resolveExplicitOverrideSelection({ role, app, model });
  if (overrideSelection) {
    return overrideSelection;
  }

  const profileDefault = typeof profile?.default_app === "string" && profile.default_app.length > 0
    ? profile.default_app
    : null;
  if (profileDefault !== null) {
    return {
      ok: true,
      app: profileDefault,
      app_source: "profile_default",
      env_key: roleAppEnvKey(role)
    };
  }

  const deprecated = readDeprecatedRoleApp({ role, dir, readWorkspaceEnvValue });
  return {
    ok: false,
    reason: "app_derived_model_required",
    detail: {
      role: typeof role === "string" ? role : null,
      env_key: roleAppEnvKey(role),
      deprecated_app: deprecated?.app ?? null,
      message: "launcher app is derived from a registered model; provide a model override, an app token with a registry app_default, or a role default model in agent-launch.toml"
    }
  };
}

export const FAST_PROFILE_REFUSAL_DIAGNOSTIC =
  "agent-launch: --fast / worker-fast / worker_fast are decommissioned; use agent-launch worker --profile worker_spark (or its shorthand --spark) to dispatch the canonical Spark worker profile";

export const FAMILY_DEPRECATED_DIAGNOSTIC =
  "agent-launch: --family is deprecated; use --app instead";

const FAST_PROFILE_NAMES = new Set(["worker_fast", "worker-fast"]);

const PROFILE_ALIAS_MAP = Object.freeze({
  "worker-spark": "worker_spark",
  "worker-fast": "worker_fast"
});

const APP_VOCABULARY = Object.freeze(["codex", "claude", "agy"]);
const BACKEND_VOCABULARY = Object.freeze([
  "codex",
  "claude",
  "unsupported"
]);

const APP_TO_BACKEND = Object.freeze({
  codex: "codex",
  claude: "claude",
  agy: "unsupported"
});

const APP_TO_VALIDATION_TRANSPORT = Object.freeze({
  codex: "stdio_mcp_conduit",
  claude: "stdio_mcp_conduit",
  agy: "unsupported"
});

const ROLE_DEFAULT_PROFILE = Object.freeze({
  worker: "worker",
  review: "review",
  redteam: "redteam",
  orchestrator: "orchestrator",
  resume: "orchestrator"
});

const KNOWN_ROLES = Object.freeze(["worker", "review", "redteam", "orchestrator", "resume"]);

function buildCodexBinding({ backendProfileKey, defaultModel }) {
  const binding = {
    app: "codex",
    backend: "codex",
    validation_transport: APP_TO_VALIDATION_TRANSPORT.codex,
    model_override_allowed: true
  };
  if (typeof backendProfileKey === "string") {
    binding.backend_profile_key = backendProfileKey;
  }
  if (typeof defaultModel === "string") {
    binding.default_model = defaultModel;
  } else {
    binding.default_model_source = "backend_default";
  }
  return binding;
}

function buildRegistryBinding({ app, registryRole }) {
  return {
    app,
    backend: APP_TO_BACKEND[app],
    validation_transport: APP_TO_VALIDATION_TRANSPORT[app],
    backend_profile_source: `registry_default_for_role:${registryRole}`,
    default_model_source: "backend_default",
    model_override_allowed: true
  };
}

function buildClaudeOrchestratorBinding({ registryRole }) {

  return {
    app: "claude",
    backend: "claude",
    validation_transport: APP_TO_VALIDATION_TRANSPORT.claude,
    backend_profile_source: `registry_default_for_role:${registryRole}`,
    default_model_source: "operator_declared",
    default_effort: "default",
    model_override_allowed: true
  };
}

function buildRoleBindings({ codexBackendKey, registryRole }) {
  return {
    codex: buildCodexBinding({ backendProfileKey: codexBackendKey }),
    claude: buildRegistryBinding({ app: "claude", registryRole }),
    agy: buildRegistryBinding({ app: "agy", registryRole })
  };
}

const PROFILE_DEFINITIONS = {
  worker: {
    profile_name: "worker",
    authority_role: "worker",
    prompt_policy_id: "worker",
    permission_policy_id: "worker",
    allowed_apps: ["codex", "claude", "agy"],
    app_bindings: buildRoleBindings({ codexBackendKey: "worker", registryRole: "worker" })
  },
  worker_spark: {
    profile_name: "worker_spark",
    authority_role: "worker",
    prompt_policy_id: "worker_spark",
    permission_policy_id: "worker_spark",
    default_app: "codex",
    allowed_apps: ["codex"],
    app_bindings: {
      codex: buildCodexBinding({
        backendProfileKey: "worker_spark",
        defaultModel: "codex-5.3-spark"
      })
    }
  },
  review: {
    profile_name: "review",
    authority_role: "review",
    prompt_policy_id: "review",
    permission_policy_id: "review",
    allowed_apps: ["codex", "claude", "agy"],
    app_bindings: buildRoleBindings({ codexBackendKey: "reviewer", registryRole: "code_review" })
  },
  redteam: {
    profile_name: "redteam",
    authority_role: "redteam",
    prompt_policy_id: "redteam",
    permission_policy_id: "redteam",
    allowed_apps: ["codex", "claude", "agy"],
    app_bindings: buildRoleBindings({ codexBackendKey: "redteam", registryRole: "redteam" })
  },

  orchestrator: {
    profile_name: "orchestrator",
    authority_role: "orchestrator",
    prompt_policy_id: "orchestrator",
    permission_policy_id: "orchestrator",
    allowed_apps: ["codex"],
    app_bindings: {
      codex: buildCodexBinding({ backendProfileKey: "orchestrator" })
    }
  },
  orchestrator_claude: {
    profile_name: "orchestrator_claude",
    authority_role: "orchestrator",
    prompt_policy_id: "orchestrator",
    permission_policy_id: "orchestrator",
    default_app: "claude",
    allowed_apps: ["claude"],
    planner_default_effort: "default",
    planner_default_effort_source: "profile_default",
    app_bindings: {
      claude: buildClaudeOrchestratorBinding({ registryRole: "orchestrator" })
    }
  },

  orchestrator_xhigh: {
    profile_name: "orchestrator_xhigh",
    authority_role: "orchestrator",
    prompt_policy_id: "orchestrator",
    permission_policy_id: "orchestrator",
    allowed_apps: ["codex"],
    app_bindings: {
      codex: buildCodexBinding({ backendProfileKey: "orchestrator_xhigh" })
    }
  }
};

function deepFreeze(value) {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Object.isFrozen(value)) {
    return value;
  }
  for (const key of Object.keys(value)) {
    deepFreeze(value[key]);
  }
  return Object.freeze(value);
}

function assertProfileShape(entry) {
  const requiredKeys = [
    "profile_name",
    "authority_role",
    "prompt_policy_id",
    "permission_policy_id",
    "allowed_apps",
    "app_bindings"
  ];
  for (const key of requiredKeys) {
    if (!(key in entry)) {
      throw new Error(`agent-launch-profiles: profile ${entry.profile_name ?? "<unknown>"} missing required field ${key}`);
    }
  }
  if ("default_app" in entry && !APP_VOCABULARY.includes(entry.default_app)) {
    throw new Error(`agent-launch-profiles: profile ${entry.profile_name} default_app ${entry.default_app} is not in app vocabulary`);
  }
  for (const app of entry.allowed_apps) {
    if (!APP_VOCABULARY.includes(app)) {
      throw new Error(`agent-launch-profiles: profile ${entry.profile_name} allowed_app ${app} is not in app vocabulary`);
    }
    const binding = entry.app_bindings[app];
    if (!binding) {
      throw new Error(`agent-launch-profiles: profile ${entry.profile_name} declares allowed_app ${app} but has no app_bindings entry`);
    }
    if (binding.app !== app) {
      throw new Error(`agent-launch-profiles: profile ${entry.profile_name} binding for ${app} has mismatched binding.app=${binding.app}`);
    }
    if (!BACKEND_VOCABULARY.includes(binding.backend)) {
      throw new Error(`agent-launch-profiles: profile ${entry.profile_name} binding ${app} has backend ${binding.backend} not in backend vocabulary`);
    }
    if (APP_TO_BACKEND[app] !== binding.backend) {
      throw new Error(`agent-launch-profiles: profile ${entry.profile_name} binding ${app} -> ${binding.backend} violates fixed app/backend mapping`);
    }
    if (typeof binding.validation_transport !== "string") {
      throw new Error(`agent-launch-profiles: profile ${entry.profile_name} binding ${app} missing validation_transport`);
    }
    const hasBackendProfileKey = typeof binding.backend_profile_key === "string";
    const hasBackendProfileSource = typeof binding.backend_profile_source === "string";
    if (!hasBackendProfileKey && !hasBackendProfileSource) {
      throw new Error(`agent-launch-profiles: profile ${entry.profile_name} binding ${app} must declare backend_profile_key or backend_profile_source`);
    }
    const hasDefaultModel = typeof binding.default_model === "string";
    const hasDefaultModelSource = typeof binding.default_model_source === "string";
    if (!hasDefaultModel && !hasDefaultModelSource) {
      throw new Error(`agent-launch-profiles: profile ${entry.profile_name} binding ${app} must declare default_model or default_model_source`);
    }
  }
  if ("default_app" in entry && !entry.allowed_apps.includes(entry.default_app)) {
    throw new Error(`agent-launch-profiles: profile ${entry.profile_name} default_app ${entry.default_app} not in allowed_apps`);
  }
  if (FAST_PROFILE_NAMES.has(entry.profile_name)) {
    throw new Error(`agent-launch-profiles: fast profile name ${entry.profile_name} must not be declared`);
  }
}

for (const entry of Object.values(PROFILE_DEFINITIONS)) {
  assertProfileShape(entry);
}

export const AGENT_LAUNCH_PROFILES = deepFreeze(PROFILE_DEFINITIONS);

export function normalizeProfileAlias(value) {
  if (typeof value !== "string") {
    return value;
  }
  if (Object.prototype.hasOwnProperty.call(PROFILE_ALIAS_MAP, value)) {
    return PROFILE_ALIAS_MAP[value];
  }
  return value;
}

export function isFastProfileName(value) {
  if (typeof value !== "string") {
    return false;
  }
  return FAST_PROFILE_NAMES.has(value);
}

export function getLauncherProfile(profileName) {
  if (typeof profileName !== "string") {
    return null;
  }
  const canonical = normalizeProfileAlias(profileName);
  if (!Object.prototype.hasOwnProperty.call(AGENT_LAUNCH_PROFILES, canonical)) {
    return null;
  }
  return AGENT_LAUNCH_PROFILES[canonical];
}

export function getDefaultProfileNameForRole(role) {
  if (typeof role !== "string") {
    return null;
  }
  if (!Object.prototype.hasOwnProperty.call(ROLE_DEFAULT_PROFILE, role)) {
    return null;
  }
  return ROLE_DEFAULT_PROFILE[role];
}

function refusal(code, message, errorPath) {
  return { ok: false, error: { code, message, path: errorPath } };
}

function resolveBackendProfileFields(binding) {
  if (typeof binding.backend_profile_key === "string") {
    return {
      backend_profile_key: binding.backend_profile_key,
      backend_profile_source: "binding_literal"
    };
  }
  return {
    backend_profile_key: null,
    backend_profile_source: binding.backend_profile_source
  };
}

function resolveModelFields(binding, modelOverride) {
  if (typeof modelOverride === "string" && modelOverride.length > 0) {
    return { model: modelOverride, model_source: "operator_override" };
  }
  if (typeof binding.default_model === "string") {
    return { model: binding.default_model, model_source: "profile_default" };
  }
  return { model: null, model_source: binding.default_model_source };
}

function isRoleProfileCompatible(role, authorityRole) {
  if (role === authorityRole) {
    return true;
  }
  if (role === "resume" && authorityRole === "orchestrator") {
    return true;
  }
  return false;
}

function getDefaultProfileNameForRoleAndApp(role, app) {
  if ((role === "orchestrator" || role === "resume") && app === "claude") {
    return "orchestrator_claude";
  }
  return getDefaultProfileNameForRole(role);
}

export function resolveAppBinding({ profileName, app } = {}) {
  if (typeof profileName !== "string" || profileName.length === 0) {
    return refusal("unknown_profile", "profile name is required", "profileName");
  }
  const canonical = normalizeProfileAlias(profileName);
  if (FAST_PROFILE_NAMES.has(canonical)) {
    return refusal("fast_profile_decommissioned", FAST_PROFILE_REFUSAL_DIAGNOSTIC, "profileName");
  }
  const profile = getLauncherProfile(canonical);
  if (!profile) {
    return refusal("unknown_profile", `unknown launcher profile: ${profileName}`, "profileName");
  }
  const selectedApp = typeof app === "string" && app.length > 0 ? app : profile.default_app;
  if (!APP_VOCABULARY.includes(selectedApp)) {
    return refusal(
      "unsupported_app_binding",
      `app ${selectedApp} is not a recognized launcher app (codex|claude|agy)`,
      "app"
    );
  }
  if (!profile.allowed_apps.includes(selectedApp)) {
    return refusal(
      "unsupported_app_binding",
      `profile ${profile.profile_name} does not declare an app binding for ${selectedApp}`,
      "app"
    );
  }
  const binding = profile.app_bindings[selectedApp];
  if (!binding) {
    return refusal(
      "unsupported_app_binding",
      `profile ${profile.profile_name} app binding ${selectedApp} is undefined`,
      "app"
    );
  }
  const backendProfile = resolveBackendProfileFields(binding);
  const modelFields = resolveModelFields(binding, undefined);
  return {
    ok: true,
    value: {
      app: selectedApp,
      backend: binding.backend,
      backend_profile_key: backendProfile.backend_profile_key,
      backend_profile_source: backendProfile.backend_profile_source,
      default_model: modelFields.model,
      default_model_source: modelFields.model_source,
      validation_transport: binding.validation_transport,
      model_override_allowed: binding.model_override_allowed !== false
    }
  };
}

export function resolveLauncherProfile({
  role,
  profileName,
  app,
  model,
  effort,
  env,
  dir,
  readWorkspaceEnvValue = readNonSecretWorkspaceEnvValue,
  readRoleDefaultModelValue = readRoleDefaultModel,
  readRoleEffortValue = readRoleEffort
} = {}) {
  const envSource = env && typeof env === "object" ? env : null;
  const envProfile = envSource ? envSource.CODEX_WORKER_PROFILE : undefined;

  const hasRole = typeof role === "string" && role.length > 0;
  const hasProfileName = typeof profileName === "string" && profileName.length > 0;

  let canonicalProfileName = null;
  if (hasProfileName) {
    canonicalProfileName = normalizeProfileAlias(profileName);
    if (FAST_PROFILE_NAMES.has(canonicalProfileName)) {
      return refusal("fast_profile_decommissioned", FAST_PROFILE_REFUSAL_DIAGNOSTIC, "profileName");
    }
  }

  if (!hasRole && !hasProfileName) {
    return refusal(
      "unknown_role",
      "resolveLauncherProfile requires role or profileName",
      "role"
    );
  }

  if (hasRole && !KNOWN_ROLES.includes(role)) {
    return refusal("unknown_role", `unknown launcher role: ${role}`, "role");
  }

  const overrideSelection = resolveExplicitOverrideSelection({ role, app, model });
  if (overrideSelection && overrideSelection.ok !== true) {
    return refusal(
      overrideSelection.reason,
      overrideSelection.detail?.message ?? "unknown launcher app/model override",
      typeof model === "string" && model.length > 0 ? "model" : "app"
    );
  }

  let roleConfigSelection = null;
  const resolveRoleConfigSelection = (selectionRole) => {
    if (roleConfigSelection !== null) {
      return roleConfigSelection;
    }
    const roleDefault = readRoleDefaultModelValue(selectionRole, { dir });
    if (typeof roleDefault !== "string" || roleDefault.length === 0) {
      roleConfigSelection = false;
      return null;
    }
    const resolved = resolveKnownModel({
      role: selectionRole,
      model: roleDefault,
      source: "role_config"
    });
    roleConfigSelection = resolved.ok === true ? resolved : resolved;
    return roleConfigSelection;
  };

  if (!canonicalProfileName) {
    const roleSelection = overrideSelection ?? resolveRoleConfigSelection(role);
    if (roleSelection && roleSelection.ok !== true) {
      return refusal(
        roleSelection.reason,
        roleSelection.detail?.message ?? `unknown model for role ${role}`,
        "model"
      );
    }
    const defaultName = getDefaultProfileNameForRoleAndApp(
      role,
      roleSelection?.app ?? null
    );
    if (typeof defaultName !== "string") {
      return refusal("unknown_role", `no default profile registered for role: ${role}`, "role");
    }
    canonicalProfileName = defaultName;
  }

  const profile = getLauncherProfile(canonicalProfileName);
  if (!profile) {
    return refusal(
      "unknown_profile",
      `unknown launcher profile: ${profileName ?? canonicalProfileName}`,
      "profileName"
    );
  }

  const effectiveRole = hasRole ? role : profile.authority_role;
  if (!KNOWN_ROLES.includes(effectiveRole)) {
    return refusal("unknown_role", `unknown launcher role: ${effectiveRole}`, "role");
  }
  if (!isRoleProfileCompatible(effectiveRole, profile.authority_role)) {
    return refusal(
      "unsupported_role_profile_combination",
      `role ${effectiveRole} cannot use profile ${profile.profile_name} (authority_role=${profile.authority_role})`,
      "role"
    );
  }
  if (
    effectiveRole === "worker"
    && typeof envProfile === "string"
    && isFastProfileName(normalizeProfileAlias(envProfile))
  ) {
    return refusal(
      "fast_profile_decommissioned",
      FAST_PROFILE_REFUSAL_DIAGNOSTIC,
      "env.CODEX_WORKER_PROFILE"
    );
  }

  let selectedApp = overrideSelection?.app ?? null;
  if (selectedApp === null) {
    const roleSelection = resolveRoleConfigSelection(effectiveRole);
    if (roleSelection && roleSelection.ok !== true) {
      return refusal(
        roleSelection.reason,
        roleSelection.detail?.message ?? `unknown model for role ${effectiveRole}`,
        "model"
      );
    }
    selectedApp = roleSelection?.app ?? null;
  }
  if (selectedApp === null && typeof profile.default_app === "string" && profile.default_app.length > 0) {
    selectedApp = profile.default_app;
  }
  if (selectedApp === null) {
    const unsetCode = roleModelUnsetCode(effectiveRole) ?? "role_model_unset";
    return refusal(
      unsetCode,
      `${unsetCode}: no model override, profile default_model, or [roles].${effectiveRole === "review" ? "reviewer" : effectiveRole} entry in agent-launch.toml was provided; app is derived from the selected model`,
      "model"
    );
  }

  if (!APP_VOCABULARY.includes(selectedApp)) {
    return refusal(
      "unsupported_app_binding",
      `app ${selectedApp} is not a recognized launcher app (codex|claude|agy)`,
      "app"
    );
  }
  if (!profile.allowed_apps.includes(selectedApp)) {
    return refusal(
      "unsupported_app_binding",
      `profile ${profile.profile_name} does not declare an app binding for ${selectedApp}`,
      "app"
    );
  }
  const binding = profile.app_bindings[selectedApp];
  if (!binding) {
    return refusal(
      "unsupported_app_binding",
      `profile ${profile.profile_name} app binding ${selectedApp} is undefined`,
      "app"
    );
  }

  if (overrideSelection && binding.model_override_allowed === false) {
    return refusal(
      "unsupported_app_binding",
      `profile ${profile.profile_name} app ${selectedApp} does not allow --model overrides`,
      "model"
    );
  }

  const backendProfile = resolveBackendProfileFields(binding);
  let modelFields;
  if (overrideSelection) {
    modelFields = {
      model: overrideSelection.model,
      model_source: overrideSelection.model_source
    };
  } else {
    modelFields = resolveModelFields(binding, undefined);
  }

  if (modelFields.model !== null) {
    const resolvedModel = resolveKnownModel({
      role: effectiveRole,
      model: modelFields.model,
      source: modelFields.model_source
    });
    if (!resolvedModel.ok) {
      return refusal(
        resolvedModel.reason,
        resolvedModel.detail?.message ?? `unknown model ${modelFields.model}`,
        "model"
      );
    }
    if (resolvedModel.app !== selectedApp) {
      return refusal(
        "profile_app_model_mismatch",
        `profile ${profile.profile_name} selected app ${selectedApp}, but model ${modelFields.model} resolves to app ${resolvedModel.app}`,
        "model"
      );
    }
  }

  if (modelFields.model === null) {
    const roleSelection = resolveRoleConfigSelection(effectiveRole);
    if (roleSelection && roleSelection.ok !== true) {
      return refusal(
        roleSelection.reason,
        roleSelection.detail?.message ?? `unknown model for role ${effectiveRole}`,
        "model"
      );
    }
    if (roleSelection && roleSelection.app !== selectedApp) {
      return refusal(
        "profile_app_model_mismatch",
        `profile ${profile.profile_name} selected app ${selectedApp}, but role default model ${roleSelection.model} resolves to app ${roleSelection.app}`,
        "model"
      );
    }
    if (roleSelection) {
      modelFields = { model: roleSelection.model, model_source: roleSelection.model_source };
    } else {
      const unsetCode = roleModelUnsetCode(effectiveRole) ?? "role_model_unset";
      return refusal(
        unsetCode,
        `${unsetCode}: no model override, profile default_model, or [roles].${effectiveRole === "review" ? "reviewer" : effectiveRole} entry in agent-launch.toml was provided; app is derived from the selected model`,
        "model"
      );
    }
  }

  const deprecatedAppProbe = probeDeprecatedRoleApp({
    role: effectiveRole,
    derivedApp: selectedApp,
    dir,
    readWorkspaceEnvValue
  });
  if (!deprecatedAppProbe.ok) {
    return refusal(
      deprecatedAppProbe.reason,
      deprecatedAppProbe.detail?.message ?? "deprecated role app declaration disagrees with the selected model",
      "app"
    );
  }

  const effortResolution = resolveEffectiveRoleEffort({
    role: effectiveRole,
    effortOverride: effort,
    selectedModel: modelFields.model,
    dir,
    readRoleEffortValue
  });
  if (!effortResolution.ok) {
    return refusal(
      effortResolution.reason,
      effortResolution.detail?.message ?? "unknown launcher effort",
      "effort"
    );
  }

  const deprecatedEffortProbe = probeDeprecatedRoleEffort({
    role: effectiveRole,
    configEffort: effortResolution.config_effort,
    effectiveEffort: effortResolution.effort,
    dir,
    readWorkspaceEnvValue
  });
  if (!deprecatedEffortProbe.ok) {
    return refusal(
      deprecatedEffortProbe.reason,
      deprecatedEffortProbe.detail?.message ?? "deprecated role effort declaration disagrees with role config",
      "effort"
    );
  }

  const value = {
    role: effectiveRole,
    profile_name: profile.profile_name,
    app: selectedApp,
    model: modelFields.model,
    model_source: modelFields.model_source,
    effort: effortResolution.effort,
    effort_source: effortResolution.effort_source,
    default_effort: effortResolution.effort,
    default_effort_source: effortResolution.effort_source,
    backend: binding.backend,
    backend_profile_key: backendProfile.backend_profile_key,
    backend_profile_source: backendProfile.backend_profile_source,
    validation_transport: binding.validation_transport,

    model_override_allowed: binding.model_override_allowed !== false,
    prompt_policy_id: profile.prompt_policy_id,
    permission_policy_id: profile.permission_policy_id
  };
  const diagnostics = [deprecatedAppProbe.diagnostic, deprecatedEffortProbe.diagnostic].filter(Boolean);
  if (diagnostics.length > 0) {
    value.diagnostics = Object.freeze(diagnostics);
  }

  return {
    ok: true,
    value
  };
}
