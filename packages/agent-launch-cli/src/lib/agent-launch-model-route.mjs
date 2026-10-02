

import path from "node:path";

import { MODEL_REGISTRY_BY_NAME, resolveModel } from "./agent-launch-model-registry.mjs";

export const MODEL_ROUTE_KINDS = Object.freeze({
  ORDINARY: "ordinary",
  LITELLM: "litellm"
});

export const LITELLM_GATEWAY_HOST = "127.0.0.1";
export const LITELLM_GATEWAY_DEFAULT_PORT = 4000;
export const LITELLM_VERTEX_DEFAULT_LOCATION = "global";
export const LITELLM_CODEX_PROVIDER_ID = "agent_launch_litellm";

const VERTEX_PROJECT_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const VERTEX_LOCATION_PATTERN = /^[a-z][a-z0-9-]{1,40}$/;

const LITELLM_ROUTABLE_APPS = new Set(["codex"]);

const ORDINARY_ROUTE = Object.freeze({ kind: MODEL_ROUTE_KINDS.ORDINARY });

function routeRefusal(reason, message, detail) {
  return { ok: false, reason, detail: { ...detail, message: `${reason}: ${message}` } };
}

function snapshotSource(snapshot) {
  return snapshot?.source?.path ?? null;
}

export function validateModelRouting(snapshot, registry = MODEL_REGISTRY_BY_NAME) {
  const configFile = snapshotSource(snapshot);
  for (const [model, entry] of Object.entries(snapshot?.models ?? {})) {
    const spec = resolveModel(model, registry);
    if (!spec) {
      return routeRefusal("model_route_unknown_model",
        `[models."${model}"] does not name a registered model`, {
          model, config_file: configFile, line_number: entry.line_number ?? null,
          known_models: [...registry.keys()].sort()
        });
    }
    if (entry.use_litellm === true && !LITELLM_ROUTABLE_APPS.has(spec.app)) {
      return routeRefusal("model_route_unsupported_client",
        `[models."${model}"] use_litellm = true is not supported for ${spec.app} models; ` +
        "LiteLLM routing is available only for Codex models", {
          model, app: spec.app, config_file: configFile, line_number: entry.line_number ?? null
        });
    }
    if (entry.use_litellm === true && spec.vertex_model === null) {
      return routeRefusal("model_route_vertex_model_undeclared",
        `[models."${model}"] use_litellm = true, but the model registry declares no verified Vertex AI ` +
        `model for ${model}; set use_litellm = false or select a model with a declared vertex_model`, {
          model, config_file: configFile, line_number: entry.line_number ?? null,
          routable_models: liteLlmRoutableModels(registry)
        });
    }
  }
  const vertexai = snapshot?.vertexai ?? null;
  const routesAny = Object.values(snapshot?.models ?? {}).some((entry) => entry.use_litellm === true);
  if (vertexai?.credentials_file != null && !path.isAbsolute(vertexai.credentials_file)) {
    return routeRefusal("model_route_vertex_credentials_invalid",
      `[vertexai] credentials_file ${JSON.stringify(vertexai.credentials_file)} must be an absolute path`, {
        config_file: configFile
      });
  }
  if (routesAny && vertexai?.credentials_file == null) {
    return routeRefusal("model_route_vertex_credentials_undeclared",
      "a model sets use_litellm = true, but [vertexai] credentials_file names no service-account key", {
        config_file: configFile,
        correction: 'add [vertexai] credentials_file = "/absolute/path/to/service-account.json" to agent-launch.toml'
      });
  }
  if (vertexai?.project != null && !VERTEX_PROJECT_PATTERN.test(vertexai.project)) {
    return routeRefusal("model_route_vertex_project_invalid",
      `[vertexai] project ${JSON.stringify(vertexai.project)} is not a Google Cloud project id`, {
        config_file: configFile
      });
  }
  if (vertexai?.location != null && !VERTEX_LOCATION_PATTERN.test(vertexai.location)) {
    return routeRefusal("model_route_vertex_location_invalid",
      `[vertexai] location ${JSON.stringify(vertexai.location)} is not a Vertex AI location`, {
        config_file: configFile
      });
  }
  return { ok: true };
}

export function liteLlmGatewayRoutes(registry = MODEL_REGISTRY_BY_NAME) {
  return Object.freeze([...registry]
    .filter(([, spec]) => LITELLM_ROUTABLE_APPS.has(spec.app) && spec.vertex_model !== null)
    .map(([model, spec]) => Object.freeze({ model, upstream: `vertex_ai/${spec.vertex_model}` }))
    .sort((left, right) => left.model.localeCompare(right.model)));
}

function liteLlmRoutableModels(registry) {
  return liteLlmGatewayRoutes(registry).map((route) => route.model);
}

export function liteLlmGatewaySettings(snapshot) {
  const vertexai = snapshot?.vertexai ?? null;
  return Object.freeze({
    host: LITELLM_GATEWAY_HOST,
    port: vertexai?.port ?? LITELLM_GATEWAY_DEFAULT_PORT,

    credentials_file: vertexai?.credentials_file ?? null,

    vertex_project: vertexai?.project ?? null,
    vertex_location: vertexai?.location ?? LITELLM_VERTEX_DEFAULT_LOCATION
  });
}

export function resolveModelRoute({ model, snapshot, registry = MODEL_REGISTRY_BY_NAME } = {}) {
  if (snapshot?.models?.[model]?.use_litellm !== true) return ORDINARY_ROUTE;
  const gateway = liteLlmGatewaySettings(snapshot);
  return Object.freeze({
    kind: MODEL_ROUTE_KINDS.LITELLM,
    provider_id: LITELLM_CODEX_PROVIDER_ID,
    base_url: `http://${gateway.host}:${gateway.port}/v1`,
    upstream_model: `vertex_ai/${resolveModel(model, registry).vertex_model}`,
    gateway,

    gateway_routes: liteLlmGatewayRoutes(registry)
  });
}

export function isLiteLlmRoute(route) {
  return route?.kind === MODEL_ROUTE_KINDS.LITELLM;
}
