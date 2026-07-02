

import {
  HOST_WRITE_AUTHORITY_SIDECAR_ENDPOINT_ENV_VAR,
  HostWriteAuthorityBrokerError,
  createHostWriteAuthorityBroker,
  createHostWriteAuthorityBrokerServer
} from "./host-write-authority-substrate.mjs";

import { evaluateWorkerAdmissionForBackend } from "./codex-worker-plan.mjs";

export const ORCHESTRATOR_IDENTITY_CARRIER_ENV_KEYS = Object.freeze([
  "AGENT_ROLE",
  "AGENT_WK",
  "AGENT_OPERATOR_WRITE_SCOPE"
]);

export function buildHostWriteAuthorityBrokerPlanningEnv({
  env,
  endpointEnvVar = HOST_WRITE_AUTHORITY_SIDECAR_ENDPOINT_ENV_VAR
} = {}) {
  const next = { ...(env && typeof env === "object" ? env : {}) };
  for (const key of ORCHESTRATOR_IDENTITY_CARRIER_ENV_KEYS) {
    delete next[key];
  }
  if (typeof endpointEnvVar === "string" && endpointEnvVar.length > 0) {
    delete next[endpointEnvVar];
  }
  return next;
}

export async function startOrchestratorDispatchSidecar({
  plan,
  io = {},
  adapter,
  evaluateWorkerAdmission = evaluateWorkerAdmissionForBackend
} = {}) {
  if (!plan || typeof plan !== "object") return null;
  const descriptor = plan.dispatchSidecar;
  if (!descriptor || typeof descriptor !== "object") return null;
  if (descriptor.kind !== "host_write_authority_localhost") return null;

  if (plan.role !== "orch" && plan.role !== "orch-resume") {
    throw new Error(
      `orchestrator dispatch sidecar refuses non-orchestrator role: ${plan.role ?? "<missing>"}`
    );
  }
  const host = typeof descriptor.host === "string" && descriptor.host.length > 0
    ? descriptor.host
    : "127.0.0.1";
  if (host !== "127.0.0.1") {
    throw new Error(
      `orchestrator dispatch sidecar refuses non-loopback host: ${host}`
    );
  }
  if (!adapter || typeof adapter !== "object") {
    throw new Error("orchestrator dispatch sidecar requires a family adapter");
  }
  if (typeof adapter.createBrokerPlanLaunch !== "function") {
    throw new Error(
      "orchestrator dispatch sidecar adapter must supply createBrokerPlanLaunch"
    );
  }
  if (typeof adapter.spawnLaunch !== "function") {
    throw new Error(
      "orchestrator dispatch sidecar adapter must supply spawnLaunch"
    );
  }

  const envVar = typeof descriptor.envVar === "string" && descriptor.envVar.length > 0
    ? descriptor.envVar
    : HOST_WRITE_AUTHORITY_SIDECAR_ENDPOINT_ENV_VAR;

  const planningEnv = buildHostWriteAuthorityBrokerPlanningEnv({
    env: plan.env,
    endpointEnvVar: envVar
  });

  const planLaunch = adapter.createBrokerPlanLaunch({
    env: planningEnv,
    cwd: plan.repo ?? process.cwd(),
    descriptor
  });

  const captureFinalResult = typeof adapter.createBrokerCaptureFinalResult === "function"
    ? adapter.createBrokerCaptureFinalResult({ descriptor })
    : null;

  const rawMap = typeof adapter.buildAppPlanLaunchMap === "function"
    ? adapter.buildAppPlanLaunchMap({ env: planningEnv, cwd: plan.repo ?? process.cwd() })
    : adapter.appPlanLaunchMap;
  const appPlanLaunchMap = (
    rawMap !== null &&
    rawMap !== undefined &&
    typeof rawMap === "object" &&
    !Array.isArray(rawMap)
  ) ? rawMap : null;

  const broker = createHostWriteAuthorityBroker({
    planLaunch,
    appPlanLaunchMap,
    spawnLaunch: adapter.spawnLaunch,
    captureFinalResult,
    evaluateWorkerAdmission
  });

  const logger = createBrokerLogger(io);
  const server = createHostWriteAuthorityBrokerServer({
    broker,
    endpoint: { host, port: 0 },
    logger
  });

  let started;
  try {
    started = await server.start();
  } catch (err) {
    throw err instanceof HostWriteAuthorityBrokerError
      ? err
      : new Error(`host write authority sidecar failed to start: ${err?.message ?? String(err)}`);
  }
  const endpoint = started?.endpoint ?? server.endpoint;
  if (!endpoint || typeof endpoint.port !== "number") {
    try { await server.stop(); } catch {   }
    throw new Error("host write authority sidecar did not report a bound endpoint");
  }
  const endpointValue = `${endpoint.host}:${endpoint.port}`;
  plan.env[envVar] = endpointValue;

  let applyContext = null;
  if (typeof adapter.applyEndpointToPlan === "function") {
    applyContext = adapter.applyEndpointToPlan({
      plan,
      descriptor,
      endpoint,
      endpointValue,
      envVar
    }) ?? null;
  }

  return {
    endpoint,
    endpointValue,
    envVar,
    applyContext,
    async stop() {
      try {
        await server.stop();
      } finally {
        if (plan.env[envVar] === endpointValue) {
          delete plan.env[envVar];
        }
        if (typeof adapter.removeEndpointFromPlan === "function") {
          try {
            adapter.removeEndpointFromPlan({
              plan,
              descriptor,
              endpoint,
              endpointValue,
              envVar,
              applyContext
            });
          } catch {

          }
        }
      }
    }
  };
}

function createBrokerLogger(io) {
  return {
    info: (msg, detail) => {
      if (io && io.stdout && typeof io.stdout.write === "function") {
        io.stdout.write(`${formatBrokerLog("info", msg, detail)}\n`);
      }
    },
    warn: (msg, detail) => {
      const stream = (io && io.stderr) ?? (io && io.stdout) ?? null;
      if (stream && typeof stream.write === "function") {
        stream.write(`${formatBrokerLog("warn", msg, detail)}\n`);
      }
    },
    error: (msg, detail) => {
      if (io && io.stderr && typeof io.stderr.write === "function") {
        io.stderr.write(`${formatBrokerLog("error", msg, detail)}\n`);
      }
    }
  };
}

function formatBrokerLog(level, message, detail) {
  const detailString = detail && typeof detail === "object"
    ? ` ${safeStringifyDetail(detail)}`
    : "";
  return `[host-write-authority-broker] ${level}: ${message}${detailString}`;
}

function safeStringifyDetail(detail) {
  try {
    return JSON.stringify(detail);
  } catch {
    return "<unserializable>";
  }
}
const SHARED_ORCHESTRATOR_APP_PLAN_LAUNCH_NAMES = Object.freeze(["codex", "claude", "agy"]);

function requireOrchestratorAppPlanLaunchHandler(app, handler) {
  if (typeof handler !== "function") {
    throw new TypeError(`Expected ${app} app plan-launch handler to be a function`);
  }

  return handler;
}

export function createSharedOrchestratorAppPlanLaunchMap({
  agy,
  claude,
  codex,
} = {}) {
  const appPlanLaunchMap = Object.create(null);
  const handlers = {
    agy,
    claude,
    codex,
  };

  for (const app of SHARED_ORCHESTRATOR_APP_PLAN_LAUNCH_NAMES) {
    appPlanLaunchMap[app] = requireOrchestratorAppPlanLaunchHandler(app, handlers[app]);
  }

  return appPlanLaunchMap;
}

export function createOrchestratorDispatchSidecarAdapter({
  createBrokerPlanLaunch,
  spawnLaunch,
  appPlanLaunchBuilders = null,
  buildAppPlanLaunchMap = null,
  applyEndpointToPlan = null,
  removeEndpointFromPlan = null,
  createBrokerCaptureFinalResult = null
} = {}) {
  if (typeof createBrokerPlanLaunch !== "function") {
    throw new Error(
      "createOrchestratorDispatchSidecarAdapter requires a createBrokerPlanLaunch family fact"
    );
  }
  if (typeof spawnLaunch !== "function") {
    throw new Error(
      "createOrchestratorDispatchSidecarAdapter requires a spawnLaunch family fact"
    );
  }
  if (appPlanLaunchBuilders != null && buildAppPlanLaunchMap != null) {
    throw new Error(
      "createOrchestratorDispatchSidecarAdapter: supply at most one of appPlanLaunchBuilders or buildAppPlanLaunchMap"
    );
  }

  const adapter = { createBrokerPlanLaunch, spawnLaunch };

  if (typeof buildAppPlanLaunchMap === "function") {
    adapter.buildAppPlanLaunchMap = buildAppPlanLaunchMap;
  } else if (appPlanLaunchBuilders != null) {
    if (typeof appPlanLaunchBuilders !== "object" || Array.isArray(appPlanLaunchBuilders)) {
      throw new TypeError(
        "createOrchestratorDispatchSidecarAdapter: appPlanLaunchBuilders must be an object of per-app planLaunch factories"
      );
    }
    const builders = {};
    for (const app of SHARED_ORCHESTRATOR_APP_PLAN_LAUNCH_NAMES) {
      const builder = appPlanLaunchBuilders[app];
      if (typeof builder !== "function") {
        throw new TypeError(
          `createOrchestratorDispatchSidecarAdapter: appPlanLaunchBuilders.${app} must be a function`
        );
      }
      builders[app] = builder;
    }
    adapter.buildAppPlanLaunchMap = ({ env, cwd } = {}) =>
      createSharedOrchestratorAppPlanLaunchMap({
        codex: builders.codex({ env, cwd }),
        claude: builders.claude({ env, cwd }),
        agy: builders.agy({ env, cwd })
      });
  }

  if (typeof applyEndpointToPlan === "function") {
    adapter.applyEndpointToPlan = applyEndpointToPlan;
  }
  if (typeof removeEndpointFromPlan === "function") {
    adapter.removeEndpointFromPlan = removeEndpointFromPlan;
  }
  if (typeof createBrokerCaptureFinalResult === "function") {
    adapter.createBrokerCaptureFinalResult = createBrokerCaptureFinalResult;
  }

  return adapter;
}
