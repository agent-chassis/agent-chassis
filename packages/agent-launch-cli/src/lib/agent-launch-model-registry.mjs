const APP_VOCABULARY = Object.freeze(["codex", "claude", "agy"]);
const APP_NAME_SET = new Set(APP_VOCABULARY);

const BACKEND_BY_APP = Object.freeze({
  codex: "codex",
  claude: "claude",
  agy: "unsupported"
});

const NEUTRAL_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);

export const MODEL_REGISTRY = Object.freeze([
  Object.freeze([
    "gpt-5.5",
    Object.freeze({
      app: "codex",
      backend: "codex",
      codex_profile: "orchestrator",
      default_effort: "high"
    })
  ]),
  Object.freeze([
    "gpt-5.6-sol",
    Object.freeze({
      app: "codex",
      backend: "codex",
      codex_profile: "orchestrator",
      default_effort: "high"
    })
  ]),
  Object.freeze([
    "gpt-5.6-terra",
    Object.freeze({
      app: "codex",
      backend: "codex",
      codex_profile: "worker",
      default_effort: "medium"
    })
  ]),
  Object.freeze([
    "gpt-5.6-luna",
    Object.freeze({
      app: "codex",
      backend: "codex",
      codex_profile: "worker",
      default_effort: "low"
    })
  ]),
  Object.freeze([
    "gpt-5.5-pro",
    Object.freeze({
      app: "codex",
      backend: "codex",
      codex_profile: "orchestrator_xhigh",
      default_effort: "xhigh"
    })
  ]),
  Object.freeze([
    "gpt-5.4",
    Object.freeze({
      app: "codex",
      backend: "codex",
      codex_profile: "reviewer",
      default_effort: "medium"
    })
  ]),
  Object.freeze([
    "gpt-5.4-pro",
    Object.freeze({
      app: "codex",
      backend: "codex",
      codex_profile: "reviewer",
      default_effort: "high"
    })
  ]),
  Object.freeze([
    "gpt-5.4-mini",
    Object.freeze({
      app: "codex",
      backend: "codex",
      codex_profile: "worker",
      default_effort: "medium"
    })
  ]),
  Object.freeze([
    "gpt-5.4-nano",
    Object.freeze({
      app: "codex",
      backend: "codex",
      codex_profile: "worker",
      default_effort: "low"
    })
  ]),
  Object.freeze([
    "gpt-5.3-codex",
    Object.freeze({
      app: "codex",
      backend: "codex",
      codex_profile: "worker",
      default_effort: "high"
    })
  ]),
  Object.freeze([
    "codex-5.3-spark",
    Object.freeze({
      app: "codex",
      backend: "codex",
      codex_profile: "worker_spark",
      default_effort: "low"
    })
  ]),
  Object.freeze([
    "fable",
    Object.freeze({
      app: "claude",
      backend: "claude",
      codex_profile: null,
      default_effort: "max"
    })
  ]),
  Object.freeze([
    "opus",
    Object.freeze({
      app: "claude",
      backend: "claude",
      codex_profile: null,
      default_effort: "max"
    })
  ]),
  Object.freeze([
    "sonnet",
    Object.freeze({
      app: "claude",
      backend: "claude",
      codex_profile: null,
      default_effort: "high"
    })
  ]),
  Object.freeze([
    "haiku",
    Object.freeze({
      app: "claude",
      backend: "claude",
      codex_profile: null,
      default_effort: "medium"
    })
  ])
]);

function assertSpecObject(model, spec) {
  if (spec === null || typeof spec !== "object" || Array.isArray(spec)) {
    throw new Error(`agent-launch-model-registry: model ${model} spec must be an object`);
  }
}

function assertSupportedApp(model, app) {
  if (!APP_NAME_SET.has(app)) {
    throw new Error(`agent-launch-model-registry: model ${model} app ${app} is not in app vocabulary`);
  }
}

function assertBackend(model, app, backend) {
  if (backend !== BACKEND_BY_APP[app]) {
    throw new Error(`agent-launch-model-registry: model ${model} backend ${backend} does not match app ${app}`);
  }
}

function assertDefaultEffort(model, defaultEffort) {
  if (!NEUTRAL_EFFORTS.has(defaultEffort)) {
    throw new Error(`agent-launch-model-registry: model ${model} default_effort ${defaultEffort} is not in low|medium|high|xhigh|max`);
  }
}

function assertCodexProfile(model, spec) {
  if (!Object.prototype.hasOwnProperty.call(spec, "codex_profile")) {
    throw new Error(`agent-launch-model-registry: model ${model} missing codex_profile`);
  }
  if (spec.app === "codex" && (typeof spec.codex_profile !== "string" || spec.codex_profile.length === 0)) {
    throw new Error(`agent-launch-model-registry: codex model ${model} codex_profile must be a non-empty string`);
  }
  if (spec.app !== "codex" && spec.codex_profile !== null) {
    throw new Error(`agent-launch-model-registry: non-codex model ${model} codex_profile must be null`);
  }
}

export function buildModelRegistry(entries) {
  if (!Array.isArray(entries)) {
    throw new Error("agent-launch-model-registry: source entries must be an array");
  }

  const registry = new Map();
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length !== 2) {
      throw new Error("agent-launch-model-registry: each entry must be [model, spec]");
    }

    const [model, spec] = entry;
    if (typeof model !== "string" || model.length === 0) {
      throw new Error("agent-launch-model-registry: model name must be a non-empty string");
    }
    if (APP_NAME_SET.has(model)) {
      throw new Error(`agent-launch-model-registry: model name ${model} collides with app vocabulary`);
    }
    if (registry.has(model)) {
      throw new Error(`agent-launch-model-registry: duplicate model name ${model}`);
    }

    assertSpecObject(model, spec);
    assertSupportedApp(model, spec.app);
    assertBackend(model, spec.app, spec.backend);
    assertDefaultEffort(model, spec.default_effort);
    assertCodexProfile(model, spec);

    const normalizedSpec = Object.freeze({
      app: spec.app,
      backend: spec.backend,
      backend_profile: spec.backend_profile ?? spec.codex_profile,
      codex_profile: spec.codex_profile,
      default_effort: spec.default_effort
    });

    registry.set(model, normalizedSpec);
  }

  return registry;
}

export const MODEL_REGISTRY_BY_NAME = buildModelRegistry(MODEL_REGISTRY);
export const MODEL_NAME_SET = Object.freeze(new Set(MODEL_REGISTRY_BY_NAME.keys()));

export function resolveModel(model, registry = MODEL_REGISTRY_BY_NAME) {
  if (typeof model !== "string" || model.length === 0) {
    return null;
  }
  return registry.get(model) ?? null;
}

export function resolveModelRuntime(model, registry = MODEL_REGISTRY_BY_NAME) {
  const spec = resolveModel(model, registry);
  if (!spec) return null;
  return Object.freeze({
    model,
    app: spec.app,
    backend: spec.backend,
    backend_profile: spec.backend_profile,
    default_effort: spec.default_effort,
    model_spec: spec
  });
}

export function appDefault(app, registry = MODEL_REGISTRY_BY_NAME) {
  if (typeof app !== "string" || app.length === 0) {
    return null;
  }
  if (!(registry instanceof Map)) {
    throw new Error("agent-launch-model-registry: registry lookup requires a Map");
  }

  return null;
}
