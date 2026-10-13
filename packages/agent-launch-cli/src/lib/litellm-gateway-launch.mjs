

import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  LiteLlmGatewayError,
  acquireLiteLlmRunKey,
  defaultLiteLlmStateRoot,
  ensureLiteLlmGateway
} from "@agent-chassis/agent-launch-core/src/lib/litellm-gateway.mjs";
import { withRoutedClientGatewayBypass } from "@agent-chassis/agent-launch-core/src/lib/proxy-environment.mjs";

import { isLiteLlmRoute } from "./agent-launch-model-route.mjs";
import {
  buildCodexModelProviderOverrides
} from "./codex-role-reasoning-effort.mjs";
import { injectCodexConfigOverridesBeforeFinalPositional } from "./codex-role-mcp-env.mjs";
import { provisionLiteLlmRuntime, runtimeLockDigest } from "./litellm-runtime-provisioning.mjs";

export const LITELLM_LAUNCH_ERROR_CODES = Object.freeze({
  VERTEX_PROJECT_UNRESOLVED: "litellm_vertex_project_unresolved",
  VERTEX_CREDENTIALS_INVALID: "litellm_vertex_credentials_invalid"
});

const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

function fail(code, message, { stage, correction, detail } = {}) {
  throw new LiteLlmGatewayError(code, message, { stage, correction, detail });
}

export function inspectVertexCredentialsFile(credentialsFile) {
  const refuse = (message, detail = {}) => fail(LITELLM_LAUNCH_ERROR_CODES.VERTEX_CREDENTIALS_INVALID, message, {
    stage: "vertex_credentials",
    correction: `point [vertexai] credentials_file at a service-account JSON key owned by this user with mode 0600 (chmod 600 ${credentialsFile})`,
    detail: { credentials_file: credentialsFile, ...detail }
  });
  let info;
  try {
    info = lstatSync(credentialsFile);
  } catch (error) {
    refuse(`[vertexai] credentials_file ${credentialsFile} cannot be read`, { errno: error?.code ?? null });
  }
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (!info.isFile()) refuse(`[vertexai] credentials_file ${credentialsFile} is not a regular file`);
  if (uid !== null && info.uid !== uid) refuse(`[vertexai] credentials_file ${credentialsFile} is not owned by this user`);
  if ((info.mode & 0o077) !== 0) {
    refuse(`[vertexai] credentials_file ${credentialsFile} is readable by group or others`,
      { mode: (info.mode & 0o777).toString(8) });
  }
  let key = null;
  try { key = JSON.parse(readFileSync(credentialsFile, "utf8")); } catch { key = null; }
  if (key?.type !== "service_account") {
    refuse(`[vertexai] credentials_file ${credentialsFile} is not a service-account JSON key`);
  }
  return Object.freeze({
    project_id: typeof key.project_id === "string" ? key.project_id : null
  });
}

export async function ensureAgentLaunchLiteLlmGateway({
  route,
  env = process.env,
  stateRoot = defaultLiteLlmStateRoot(env),
  inspectCredentials = inspectVertexCredentialsFile,
  provisionRuntime = provisionLiteLlmRuntime,
  ensureGateway = ensureLiteLlmGateway
}) {
  const settings = route.gateway;
  const credentials = inspectCredentials(settings.credentials_file);
  const project = settings.vertex_project ?? credentials.project_id;
  if (typeof project !== "string" || !PROJECT_ID_PATTERN.test(project)) {
    fail(LITELLM_LAUNCH_ERROR_CODES.VERTEX_PROJECT_UNRESOLVED,
      `the Vertex AI project could not be read from ${settings.credentials_file}`, {
        stage: "vertex_project",
        correction: 'set [vertexai] project = "<project-id>" in agent-launch.toml'
      });
  }
  return ensureGateway({
    settings: { ...settings, vertex_project: project },

    routes: route.gateway_routes,
    stateRoot,
    runtimeLockDigest: runtimeLockDigest(),
    provisionRuntime: () => provisionRuntime({ stateRoot, env }),
    env
  });
}

const NO_ROUTE_ATTACHMENT = Object.freeze({ attached: false, overrides: Object.freeze([]), release() {} });

export async function attachCodexModelRoute(plan, {
  env = process.env,
  ensureGateway = ensureAgentLaunchLiteLlmGateway
} = {}) {
  const selection = plan?.model_selection ?? null;
  if (!isLiteLlmRoute(selection?.route)) return NO_ROUTE_ATTACHMENT;
  const secretDir = plan.model_route_secret_dir;
  if (typeof secretDir !== "string" || !path.isAbsolute(secretDir)) {
    throw new Error("a LiteLLM-routed Codex plan must name the runtime directory for its per-run key");
  }
  const gateway = await ensureGateway({ route: selection.route, env });
  const runKey = acquireLiteLlmRunKey({ keyPath: gateway.key_path, dir: secretDir });
  let overrides;
  let clientEnv;
  try {
    clientEnv = withRoutedClientGatewayBypass(plan.env ?? env, selection.route.gateway.host);
    overrides = Object.freeze(buildCodexModelProviderOverrides({
      modelSelection: selection,
      keyFilePath: runKey.path
    }));
    injectCodexConfigOverridesBeforeFinalPositional(plan.args, [...overrides]);
  } catch (error) {
    runKey.release();
    throw error;
  }
  plan.model_route_run_key_path = runKey.path;
  plan.env = clientEnv;
  return Object.freeze({
    attached: true,
    overrides,
    release: runKey.release,
    gateway_generation: gateway.generation
  });
}

export function liteLlmRouteFailureDetail(error) {
  if (error instanceof LiteLlmGatewayError) {
    return Object.freeze({
      code: error.code,
      stage: error.stage,
      message: error.message,
      correction: error.correction,
      detail: error.detail
    });
  }
  return Object.freeze({
    code: "litellm_route_attach_failed",
    stage: "attach",
    message: error?.message ?? String(error),
    correction: null,
    detail: Object.freeze({})
  });
}
