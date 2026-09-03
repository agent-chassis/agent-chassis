import { readNonSecretWorkspaceEnvValue } from "@agent-chassis/wiki-core/src/lib/node-engine-env-bootstrap.mjs";

import {
  MODEL_NAME_SET,
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
  redteam: "REDTEAM_MODEL",
  orchestrator: "ORCHESTRATOR_MODEL",
  resume: "ORCHESTRATOR_MODEL"
});

const ROLE_MODEL_UNSET_CODE = Object.freeze({
  worker: "worker_model_unset",
  reviewer: "reviewer_model_unset",
  redteam: "redteam_model_unset",
  orchestrator: "orchestrator_model_unset",
  resume: "orchestrator_model_unset"
});

const ROLE_APP_ENV_KEY = Object.freeze({
  worker: "WORKER_APP",
  reviewer: "REVIEWER_APP",
  redteam: "REDTEAM_APP",
  orchestrator: "ORCHESTRATOR_APP",
  resume: "ORCHESTRATOR_APP"
});

const ROLE_EFFORT_ENV_KEY = Object.freeze({
  worker: "WORKER_EFFORT",
  reviewer: "REVIEWER_EFFORT",
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
  const refusalRole = role === "resume" ? "orchestrator" : role;
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
    return {
      ok: true,
      token: normalized,
      app: normalized,
      model: null,
      app_source: "operator_override",
      model_source: null,
      model_spec: null
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

  const appSelection = appToken === null
    ? null
    : APP_VOCABULARY.includes(appToken)
      ? resolveLauncherOverrideToken(appToken)
      : unknownAppOrModelRefusal(appToken);
  if (appSelection && appSelection.ok !== true) {
    return appSelection;
  }

  const modelSelection = modelToken === null
    ? null
    : MODEL_NAME_SET.has(modelToken)
      ? resolveLauncherOverrideToken(modelToken)
      : unknownRoleModelRefusal({ role, model: modelToken, source: "operator_override" });
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
      : "resolved_profile";
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

    if (resolvedProfile) {
      const permission = resolveModelOverrideBindingPermission({
        role,
        configRootDir: dir,
        app: resolvedProfile.app,
        profileName: resolvedProfile.profile_name,
        resolvedProfile,
        modelOverride: roleDefaultModel
      });
      if (!permission.ok) {
        return permission;
      }
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
      message: `${unsetCode}: no model override or [roles].${role} entry in agent-launch.toml was provided; set the role model in agent-launch.toml to select the ${role} model`
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

  const deprecated = readDeprecatedRoleApp({ role, dir, readWorkspaceEnvValue });
  return {
    ok: false,
    reason: "app_derived_model_required",
    detail: {
      role: typeof role === "string" ? role : null,
      env_key: roleAppEnvKey(role),
      deprecated_app: deprecated?.app ?? null,
      message: "launcher app is derived from a registered model; provide a model override or a role model in agent-launch.toml"
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
  reviewer: "reviewer",
  redteam: "redteam",
  orchestrator: "orchestrator",
  resume: "orchestrator"
});

const KNOWN_ROLES = Object.freeze(["worker", "reviewer", "redteam", "orchestrator", "resume"]);

function buildCodexBinding({ backendProfileKey, modelOverrideAllowed = true }) {
  const binding = {
    app: "codex",
    backend: "codex",
    validation_transport: APP_TO_VALIDATION_TRANSPORT.codex,
    model_override_allowed: modelOverrideAllowed
  };
  if (typeof backendProfileKey === "string") {
    binding.backend_profile_key = backendProfileKey;
  }
  return binding;
}

function buildRegistryBinding({ app, registryRole }) {
  return {
    app,
    backend: APP_TO_BACKEND[app],
    validation_transport: APP_TO_VALIDATION_TRANSPORT[app],
    backend_profile_source: `registry_default_for_role:${registryRole}`,
    model_override_allowed: true
  };
}

function buildClaudeOrchestratorBinding({ registryRole }) {

  return {
    app: "claude",
    backend: "claude",
    validation_transport: APP_TO_VALIDATION_TRANSPORT.claude,
    backend_profile_source: `registry_default_for_role:${registryRole}`,
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
    allowed_apps: ["codex"],
    app_bindings: {
      codex: buildCodexBinding({
        backendProfileKey: "worker_spark"
      })
    }
  },
  reviewer: {
    profile_name: "reviewer",
    authority_role: "reviewer",
    prompt_policy_id: "reviewer",
    permission_policy_id: "reviewer",
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
    allowed_apps: ["claude"],
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
    if ("default_model" in binding || "default_model_source" in binding) {
      throw new Error(`agent-launch-profiles: profile ${entry.profile_name} binding ${app} must not declare a model default`);
    }
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

export function resolveModelOverrideBindingPermission({
  role,
  configRootDir = null,
  config_root_dir = null,
  app,
  profileName = null,
  modelOverride = null
} = {}) {
  const canonicalConfigRoot = typeof configRootDir === "string"
    ? configRootDir
    : typeof config_root_dir === "string" ? config_root_dir : null;
  const identityProfileName = typeof profileName === "string" && profileName.length > 0
    ? profileName
    : getDefaultProfileNameForRoleAndApp(role, app);
  const canonicalProfileName = typeof identityProfileName === "string" && identityProfileName.length > 0
    ? normalizeProfileAlias(identityProfileName)
    : null;
  const profile = canonicalProfileName === null
    ? null
    : getLauncherProfile(canonicalProfileName);
  const binding = profile?.app_bindings?.[app] ?? null;

  const allowed = binding?.model_override_allowed === true;
  const hasOverride = typeof modelOverride === "string" && modelOverride.length > 0;
  const fact = {
    role: typeof role === "string" ? role : null,
    config_root_dir: canonicalConfigRoot,
    app: typeof app === "string" ? app : null,
    profile_name: profile?.profile_name ?? canonicalProfileName,
    model_override_allowed: allowed
  };
  if (hasOverride && !allowed) {
    return {
      ok: false,
      reason: "model_override_not_allowed_for_binding",
      detail: { ...fact, requested_model: modelOverride }
    };
  }
  return { ok: true, value: fact };
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
  const selectedApp = typeof app === "string" && app.length > 0 ? app : null;
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
  return {
    ok: true,
    value: {
      app: selectedApp,
      backend: binding.backend,
      backend_profile_key: backendProfile.backend_profile_key,
      backend_profile_source: backendProfile.backend_profile_source,
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

  if (
    role === "worker"
    && typeof envProfile === "string"
    && isFastProfileName(normalizeProfileAlias(envProfile))
  ) {
    return refusal(
      "fast_profile_decommissioned",
      FAST_PROFILE_REFUSAL_DIAGNOSTIC,
      "env.CODEX_WORKER_PROFILE"
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
    const roleSelection = overrideSelection?.model
      ? overrideSelection
      : resolveRoleConfigSelection(role);
    if (roleSelection && roleSelection.ok !== true) {
      return refusal(
        roleSelection.reason,
        roleSelection.detail?.message ?? `unknown model for role ${role}`,
        "model"
      );
    }
    if (!roleSelection) {
      const unsetCode = roleModelUnsetCode(role) ?? "role_model_unset";
      return refusal(
        unsetCode,
        `${unsetCode}: no model override or [roles].${role} entry in agent-launch.toml was provided; app is derived from the selected model`,
        "model"
      );
    }
    if (overrideSelection?.model === null && overrideSelection.app !== roleSelection.app) {
      return refusal(
        "launcher_override_app_model_mismatch",
        `launcher override mismatch: ${overrideSelection.app} disagrees with model ${roleSelection.model}, which resolves to app ${roleSelection.app}`,
        "app"
      );
    }
    const defaultName = getDefaultProfileNameForRoleAndApp(
      role,
      roleSelection.app
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
  const modelSelection = overrideSelection?.model
    ? overrideSelection
    : resolveRoleConfigSelection(effectiveRole);
  if (modelSelection && modelSelection.ok !== true) {
    return refusal(
      modelSelection.reason,
      modelSelection.detail?.message ?? `unknown model for role ${effectiveRole}`,
      "model"
    );
  }
  if (!modelSelection) {
    const unsetCode = roleModelUnsetCode(effectiveRole) ?? "role_model_unset";
    return refusal(
      unsetCode,
      `${unsetCode}: no model override or [roles].${effectiveRole} entry in agent-launch.toml was provided; app is derived from the selected model`,
      "model"
    );
  }
  const selectedApp = modelSelection.app;
  if (overrideSelection?.model === null && overrideSelection.app !== selectedApp) {
    return refusal(
      "launcher_override_app_model_mismatch",
      `launcher override mismatch: ${overrideSelection.app} disagrees with model ${modelSelection.model}, which resolves to app ${selectedApp}`,
      "app"
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

  if (overrideSelection?.model) {
    const permission = resolveModelOverrideBindingPermission({
      role: effectiveRole,
      configRootDir: dir,
      app: selectedApp,
      profileName: profile.profile_name,
      modelOverride: overrideSelection.model
    });
    if (!permission.ok) {
      return refusal(
        permission.reason,
        `profile ${profile.profile_name} app ${selectedApp} does not allow --model overrides`,
        "model"
      );
    }
  }

  const backendProfile = resolveBackendProfileFields(binding);
  const modelFields = {
    model: modelSelection.model,
    model_source: modelSelection.model_source
  };

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
