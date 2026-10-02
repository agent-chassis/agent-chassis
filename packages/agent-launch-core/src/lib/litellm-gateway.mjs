

import { spawn as nodeSpawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeSync
} from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CRASH_DURABLE_LOCK_STATES,
  CRASH_DURABLE_RESULTS,
  classifyLockState,
  createSyncEffects,
  decideRelease,
  inspectLockPathSync,
  planLockAcquisition,
  planReplacement,
  planRetirementClaim,
  planTombstoneCleanup,
  runCrashDurablePlanSync
} from "@agent-chassis/wiki-core/src/lib/crash-durable-state.mjs";

export const LITELLM_GATEWAY_STATE_SCHEMA_VERSION = "agent-launch-litellm-gateway-state.v1";
export const LITELLM_PINNED_VERSION = "1.103.0";
export const LITELLM_RUNTIME_PYTHON_SERIES = "3.12";
export const LITELLM_RUNTIME_LOCK_PATH = fileURLToPath(
  new URL("../../data/litellm-gateway/runtime-requirements.lock", import.meta.url)
);

export const LITELLM_GATEWAY_POLICY = Object.freeze({
  drop_params: false,
  num_retries: 0,
  fallbacks: Object.freeze([]),
  context_window_fallbacks: Object.freeze([])
});

export const LITELLM_GATEWAY_ERROR_CODES = Object.freeze({
  STATE_DIRECTORY_UNSAFE: "litellm_gateway_state_directory_unsafe",
  STATE_INVALID: "litellm_gateway_state_invalid",
  STATE_STALE: "litellm_gateway_state_stale",
  CONFIG_CONFLICT: "litellm_gateway_config_conflict",
  FOREIGN_LISTENER: "litellm_gateway_foreign_listener",
  LOCK_UNCERTAIN: "litellm_gateway_lock_uncertain",
  LOCK_TIMEOUT: "litellm_gateway_lock_timeout",
  PUBLICATION_FAILED: "litellm_gateway_publication_failed",
  START_FAILED: "litellm_gateway_start_failed",
  START_TIMEOUT: "litellm_gateway_start_timeout",
  KEY_UNAVAILABLE: "litellm_gateway_key_unavailable"
});

export class LiteLlmGatewayError extends Error {
  constructor(code, message, { stage, correction, detail = {} } = {}) {
    super(`${code}: ${message}`);
    this.name = "LiteLlmGatewayError";
    this.code = code;
    this.stage = stage ?? null;
    this.correction = correction ?? null;
    this.detail = Object.freeze({ ...detail });
  }
}

function fail(code, message, options) {
  throw new LiteLlmGatewayError(code, message, options);
}

const GATEWAY_PASSTHROUGH_ENV = Object.freeze([
  "HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "NO_PROXY", "no_proxy"
]);

const DEFAULT_START_TIMEOUT_MS = 180_000;
const DEFAULT_LOCK_TIMEOUT_MS = 20 * 60_000;
const PROBE_TIMEOUT_MS = 3_000;
const POLL_INTERVAL_MS = 250;

export function defaultLiteLlmStateRoot(env = process.env) {
  const stateHome = typeof env.XDG_STATE_HOME === "string" && path.isAbsolute(env.XDG_STATE_HOME)
    ? env.XDG_STATE_HOME
    : path.join(typeof env.HOME === "string" && env.HOME.length > 0 ? env.HOME : os.homedir(),
      ".local", "state");
  return path.join(stateHome, "agent-launch", "litellm");
}

export function ensurePrivateDirectory(dir, { label = "state directory" } = {}) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const info = lstatSync(dir);
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (!info.isDirectory() || (uid !== null && info.uid !== uid) || (info.mode & 0o077) !== 0) {
    fail(LITELLM_GATEWAY_ERROR_CODES.STATE_DIRECTORY_UNSAFE,
      `${label} ${dir} is not a private directory owned by this user`, {
        stage: "state_directory",
        correction: `ensure ${dir} is a directory owned by this user with mode 0700`,
        detail: { path: dir, mode: (info.mode & 0o777).toString(8), owner_uid: info.uid }
      });
  }
  return dir;
}

export function publishPrivateFile(targetPath, bytes, { stage = "publication" } = {}) {
  const run = runCrashDurablePlanSync(planReplacement({
    targetPath,
    privatePath: `${targetPath}.${process.pid}.${randomUUID()}.tmp`,
    bytes
  }), createSyncEffects({ mode: 0o600 }));
  if (run.classification !== CRASH_DURABLE_RESULTS.PUBLISHED) {
    fail(LITELLM_GATEWAY_ERROR_CODES.PUBLICATION_FAILED,
      `${targetPath} could not be durably published`, {
        stage,
        correction: `check that ${path.dirname(targetPath)} is writable and has free space`,
        detail: { path: targetPath, failed_fault: run.failed_fault, errno: run.error?.code ?? null }
      });
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withExclusiveStateLock(lockPath, fn, {
  deadline = Date.now() + DEFAULT_LOCK_TIMEOUT_MS,
  now = Date.now,
  wait = sleep,
  label = "state lock"
} = {}) {
  const token = randomUUID();
  const identity = JSON.stringify({ pid: process.pid, host: os.hostname(), token, acquired_at: new Date().toISOString() });
  const effects = createSyncEffects({ mode: 0o600 });
  for (;;) {
    const run = runCrashDurablePlanSync(planLockAcquisition({
      canonicalPath: lockPath,
      stagingPath: `${lockPath}.staging-${token}`,
      ownerToken: token,
      ownerIdentity: identity
    }), effects);
    if (run.classification === CRASH_DURABLE_RESULTS.LOCK_ACQUIRED) break;
    const inspection = inspectLockPathSync(lockPath);
    const state = classifyLockState(inspection);
    if (state === CRASH_DURABLE_LOCK_STATES.ABSENT) continue;
    if (state !== CRASH_DURABLE_LOCK_STATES.TOKEN_OWNED) {
      fail(LITELLM_GATEWAY_ERROR_CODES.LOCK_UNCERTAIN,
        `${label} ${lockPath} is in an uncertain state (${state})`, {
          stage: "lock",
          correction: `confirm no agent-launch process is starting this LiteLLM gateway, then remove ${lockPath}`,
          detail: { lock_path: lockPath, lock_state: state }
        });
    }
    if (now() >= deadline) {
      fail(LITELLM_GATEWAY_ERROR_CODES.LOCK_TIMEOUT,
        `${label} ${lockPath} is still held by another launch`, {
          stage: "lock",
          correction: `wait for that launch to finish; if its owner is no longer running, remove ${lockPath}`,
          detail: { lock_path: lockPath, owner_identity: inspection.ownerEntry.owner_identity }
        });
    }
    await wait(POLL_INTERVAL_MS);
  }
  try {
    return await fn();
  } finally {
    releaseStateLock(lockPath, token, effects);
  }
}

function releaseStateLock(lockPath, token, effects) {
  if (!decideRelease({ inspection: inspectLockPathSync(lockPath), token }).releasable) return;
  const tombstonePath = `${lockPath}.released-${token}`;
  const claimed = runCrashDurablePlanSync(planRetirementClaim({
    canonicalPath: lockPath,
    claimantMarkerPath: `${lockPath}.claim-${token}`,
    tombstonePath,
    claimantToken: token
  }), effects);
  if (claimed.classification !== CRASH_DURABLE_RESULTS.RETIREMENT_CLAIMED) return;
  runCrashDurablePlanSync(planTombstoneCleanup({ tombstonePath, claimantToken: token }), effects);
  rmSync(`${lockPath}.claim-${token}`, { force: true });
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function yamlString(value) {

  return JSON.stringify(String(value));
}

export function renderLiteLlmGatewayConfig({ routes, vertexProject, vertexLocation }) {
  const lines = ["model_list:"];
  for (const { model, upstream } of routes) {
    lines.push(
      `  - model_name: ${yamlString(model)}`,
      "    litellm_params:",
      `      model: ${yamlString(upstream)}`,
      `      vertex_project: ${yamlString(vertexProject)}`,
      `      vertex_location: ${yamlString(vertexLocation)}`
    );
  }
  lines.push(
    "general_settings:",
    "  master_key: os.environ/LITELLM_MASTER_KEY",
    "litellm_settings:",
    `  drop_params: ${LITELLM_GATEWAY_POLICY.drop_params}`,
    `  num_retries: ${LITELLM_GATEWAY_POLICY.num_retries}`,
    "router_settings:",
    `  num_retries: ${LITELLM_GATEWAY_POLICY.num_retries}`,
    "  fallbacks: []",
    "  context_window_fallbacks: []",
    ""
  );
  return lines.join("\n");
}

function gatewayPaths(stateRoot, port) {
  const dir = path.join(stateRoot, "gateways", String(port));
  return Object.freeze({
    dir,
    lock: path.join(stateRoot, "gateways", `${port}.lock`),
    state: path.join(dir, "state.json"),
    key: path.join(dir, "master.key"),
    config: path.join(dir, "config.yaml"),
    home: path.join(dir, "home"),
    log: path.join(dir, "gateway.log")
  });
}

function readState(paths) {
  if (!existsSync(paths.state)) return null;
  let record;
  try {
    record = JSON.parse(readFileSync(paths.state, "utf8"));
  } catch {
    record = null;
  }
  if (record?.schema_version !== LITELLM_GATEWAY_STATE_SCHEMA_VERSION ||
      typeof record.config_digest !== "string" || typeof record.base_url !== "string") {
    fail(LITELLM_GATEWAY_ERROR_CODES.STATE_INVALID,
      `gateway state record ${paths.state} is unreadable or not a current state record`, {
        stage: "state",
        correction: `stop any LiteLLM gateway serving this port, then remove ${paths.state}`,
        detail: { state_path: paths.state }
      });
  }
  return record;
}

function readKey(paths) {
  try {
    const key = readFileSync(paths.key, "utf8").trim();
    if (key.length >= 32) return key;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      fail(LITELLM_GATEWAY_ERROR_CODES.KEY_UNAVAILABLE, `gateway key ${paths.key} is unreadable`, {
        stage: "key",
        correction: `restore ${paths.key} (0600, owned by this user) or stop the gateway and remove its state directory`,
        detail: { key_path: paths.key, errno: error?.code ?? null }
      });
    }
  }
  return null;
}

export function probeLiteLlmGateway({ baseUrl, key, models, timeoutMs = PROBE_TIMEOUT_MS }) {
  return new Promise((resolve) => {
    const request = http.get(`${baseUrl}/models`, {
      headers: { authorization: `Bearer ${key}` },
      timeout: timeoutMs
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size <= 1024 * 1024) chunks.push(chunk);
      });
      response.on("end", () => {
        if (response.statusCode !== 200) {
          resolve({ status: "mismatch", http_status: response.statusCode });
          return;
        }
        let served = [];
        try {
          served = JSON.parse(Buffer.concat(chunks).toString("utf8"))?.data?.map((entry) => entry?.id) ?? [];
        } catch {
          resolve({ status: "mismatch", http_status: 200, reason: "models_response_invalid" });
          return;
        }
        const missing = models.filter((model) => !served.includes(model));
        resolve(missing.length === 0
          ? { status: "ready" }
          : { status: "mismatch", http_status: 200, reason: "models_missing", missing_models: missing });
      });
    });
    request.on("timeout", () => request.destroy(Object.assign(new Error("probe timeout"), { code: "ETIMEDOUT" })));
    request.on("error", (error) => {
      resolve(error?.code === "ECONNREFUSED"
        ? { status: "unreachable" }
        : { status: "mismatch", errno: error?.code ?? null });
    });
  });
}

export function probePortListener({ host, port, timeoutMs = PROBE_TIMEOUT_MS }) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const settle = (listening) => {
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(timeoutMs, () => settle(true));
    socket.once("connect", () => settle(true));
    socket.once("error", (error) => settle(error?.code !== "ECONNREFUSED"));
  });
}

function gatewayEnvironment({ env, home, executable, key, credentialsFile }) {
  const closed = {
    GOOGLE_APPLICATION_CREDENTIALS: credentialsFile,
    PATH: `${path.dirname(executable)}:/usr/bin:/bin`,
    HOME: home,
    LANG: "C.UTF-8",
    PYTHONNOUSERSITE: "1",
    LITELLM_MASTER_KEY: key,

    LITELLM_LOCAL_MODEL_COST_MAP: "True",
    LITELLM_LOG: "ERROR"
  };
  for (const name of GATEWAY_PASSTHROUGH_ENV) {
    if (typeof env?.[name] === "string" && env[name].length > 0) closed[name] = env[name];
  }
  return closed;
}

function startFailure(code, message, { paths, detail, correction }) {
  return new LiteLlmGatewayError(code, message, {
    stage: "start",
    correction: correction ?? `inspect ${paths.log} for the gateway's own error, correct it, and relaunch`,
    detail: { log_path: paths.log, ...detail }
  });
}

async function startGateway({ settings, paths, routes, models, provisionRuntime, env, spawn, probe, now, wait, startTimeoutMs }) {
  const runtime = await provisionRuntime();
  ensurePrivateDirectory(paths.home, { label: "gateway home" });
  let key = readKey(paths);
  if (key === null) {
    publishPrivateFile(paths.key, `sk-agent-launch-${randomBytes(32).toString("hex")}\n`, { stage: "key" });
    key = readKey(paths);
  }
  publishPrivateFile(paths.config, renderLiteLlmGatewayConfig({
    routes,
    vertexProject: settings.vertex_project,
    vertexLocation: settings.vertex_location
  }), { stage: "config" });

  const logFd = openSync(paths.log, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_APPEND, 0o600);
  let child;
  try {
    child = spawn(runtime.executable, [
      ...(runtime.args ?? []),
      "--config", paths.config,
      "--host", settings.host,
      "--port", String(settings.port)
    ], {
      cwd: paths.home,
      env: gatewayEnvironment({
        env, home: paths.home, executable: runtime.executable, key, credentialsFile: settings.credentials_file
      }),
      detached: true,
      stdio: ["ignore", logFd, logFd]
    });
  } finally {
    closeSync(logFd);
  }
  let exited = null;
  let spawnError = null;
  child.once("exit", (code, signal) => { exited = { code, signal }; });
  child.once("error", (error) => { spawnError = error?.code ?? String(error); });
  const stopOwnChild = () => {
    if (exited === null && spawnError === null) {
      try { child.kill("SIGKILL"); } catch {   }
    }
  };

  const baseUrl = `http://${settings.host}:${settings.port}/v1`;
  const deadline = now() + startTimeoutMs;
  for (;;) {
    if (spawnError !== null) {
      throw startFailure(LITELLM_GATEWAY_ERROR_CODES.START_FAILED,
        `the gateway executable ${runtime.executable} could not start (${spawnError})`, {
          paths, detail: { executable: runtime.executable, errno: spawnError },
          correction: "reprovision the private LiteLLM runtime by removing its generation directory, then relaunch"
        });
    }
    if (exited !== null) {
      throw startFailure(LITELLM_GATEWAY_ERROR_CODES.START_FAILED,
        `the gateway exited during startup (${exited.signal ? `signal ${exited.signal}` : `exit code ${exited.code}`})`, {
          paths, detail: { exit_code: exited.code, signal: exited.signal }
        });
    }
    const observed = await probe({ baseUrl, key, models });
    if (observed.status === "ready") break;
    if (observed.status === "mismatch" && observed.reason !== "models_missing" && observed.http_status !== 500) {
      stopOwnChild();
      throw startFailure(LITELLM_GATEWAY_ERROR_CODES.FOREIGN_LISTENER,
        `another service answered on ${settings.host}:${settings.port} while the gateway was starting`, {
          paths, detail: { port: settings.port, http_status: observed.http_status ?? null },
          correction: `stop the service on port ${settings.port} or set [vertexai] port to a free port`
        });
    }
    if (now() >= deadline) {
      stopOwnChild();
      throw startFailure(LITELLM_GATEWAY_ERROR_CODES.START_TIMEOUT,
        `the gateway did not become ready within ${startTimeoutMs} ms`, {
          paths, detail: { timeout_ms: startTimeoutMs }
        });
    }
    await wait(POLL_INTERVAL_MS);
  }
  child.unref();

  return { key, runtime, pid: child.pid, baseUrl, stopOwnChild };
}

export async function ensureLiteLlmGateway({
  settings,
  routes,
  stateRoot,
  runtimeLockDigest,
  provisionRuntime,
  env = process.env,
  spawn = nodeSpawn,
  probe = probeLiteLlmGateway,
  probeListener = probePortListener,
  now = Date.now,
  wait = sleep,
  startTimeoutMs = DEFAULT_START_TIMEOUT_MS,
  lockTimeoutMs = DEFAULT_LOCK_TIMEOUT_MS,
  publishState = publishPrivateFile
}) {
  if (typeof settings.credentials_file !== "string" || !path.isAbsolute(settings.credentials_file)) {
    throw new Error("the LiteLLM gateway requires the declared absolute service-account key path");
  }

  const sortedRoutes = [...routes]
    .map(({ model, upstream }) => ({ model, upstream }))
    .sort((left, right) => left.model.localeCompare(right.model));
  const sortedModels = sortedRoutes.map((route) => route.model);
  const configDigest = sha256(JSON.stringify({
    host: settings.host,
    port: settings.port,
    credentials_file: settings.credentials_file,
    vertex_project: settings.vertex_project,
    vertex_location: settings.vertex_location,
    routes: sortedRoutes,
    policy: LITELLM_GATEWAY_POLICY,
    runtime_lock_digest: runtimeLockDigest
  }));
  ensurePrivateDirectory(stateRoot);
  ensurePrivateDirectory(path.join(stateRoot, "gateways"));
  const paths = gatewayPaths(stateRoot, settings.port);
  ensurePrivateDirectory(paths.dir, { label: "gateway state directory" });
  const baseUrl = `http://${settings.host}:${settings.port}/v1`;

  const observePublished = async ({ underLock }) => {
    const record = readState(paths);
    if (record === null) {
      if (underLock && await probeListener({ host: settings.host, port: settings.port })) {
        fail(LITELLM_GATEWAY_ERROR_CODES.FOREIGN_LISTENER,
          `${settings.host}:${settings.port} is in use by a service this launcher did not start`, {
            stage: "readiness",
            correction: `stop the service on port ${settings.port} or set [vertexai] port to a free port`,
            detail: { port: settings.port, state_path: paths.state }
          });
      }
      return null;
    }
    const key = readKey(paths);
    const observed = key === null
      ? { status: "mismatch", reason: "key_missing" }
      : await probe({ baseUrl, key, models: sortedModels });
    if (observed.status === "unreachable") {
      fail(LITELLM_GATEWAY_ERROR_CODES.STATE_STALE,
        `gateway state ${paths.state} names a gateway that is not running`, {
          stage: "readiness",
          correction: `confirm no LiteLLM gateway (last pid ${record.pid ?? "unknown"}) is running, then remove ${paths.state} and relaunch`,
          detail: { state_path: paths.state, recorded_pid: record.pid ?? null }
        });
    }
    if (observed.status !== "ready") {
      fail(LITELLM_GATEWAY_ERROR_CODES.FOREIGN_LISTENER,
        `the service on ${settings.host}:${settings.port} does not accept this gateway's key or model list`, {
          stage: "readiness",
          correction: `stop the service on port ${settings.port} (recorded pid ${record.pid ?? "unknown"}), remove ${paths.state}, and relaunch`,
          detail: { port: settings.port, state_path: paths.state, http_status: observed.http_status ?? null,
            reason: observed.reason ?? null }
        });
    }
    if (record.config_digest !== configDigest) {
      fail(LITELLM_GATEWAY_ERROR_CODES.CONFIG_CONFLICT,
        `the running gateway on port ${settings.port} was started with a different configuration`, {
          stage: "readiness",
          correction: "align [vertexai] project/location across repositories, or give this configuration its own [vertexai] port",
          detail: { state_path: paths.state, running_generation: record.generation ?? null }
        });
    }
    return { base_url: record.base_url, key_path: paths.key, generation: record.generation, reused: true };
  };

  const published = await observePublished({ underLock: false });
  if (published !== null) return published;

  return withExclusiveStateLock(paths.lock, async () => {
    const racedPublished = await observePublished({ underLock: true });
    if (racedPublished !== null) return racedPublished;
    const started = await startGateway({
      settings, paths, routes: sortedRoutes, models: sortedModels, provisionRuntime, env, spawn, probe, now, wait, startTimeoutMs
    });
    try {
      publishState(paths.state, `${JSON.stringify({
        schema_version: LITELLM_GATEWAY_STATE_SCHEMA_VERSION,
        config_digest: configDigest,
        generation: started.runtime.generation,
        base_url: started.baseUrl,
        pid: started.pid,
        started_at: new Date(now()).toISOString()
      }, null, 2)}\n`, { stage: "state" });
    } catch (error) {
      started.stopOwnChild();
      throw error;
    }
    return { base_url: started.baseUrl, key_path: paths.key, generation: started.runtime.generation, reused: false };
  }, { deadline: now() + lockTimeoutMs, now, wait, label: "gateway startup lock" });
}

export function acquireLiteLlmRunKey({ keyPath, dir }) {
  let key;
  try {
    key = readFileSync(keyPath, "utf8").trim();
  } catch (error) {
    fail(LITELLM_GATEWAY_ERROR_CODES.KEY_UNAVAILABLE, `gateway key ${keyPath} is unreadable`, {
      stage: "run_key",
      correction: "relaunch to re-establish the gateway, or restore its key file",
      detail: { key_path: keyPath, errno: error?.code ?? null }
    });
  }
  const runKeyPath = path.join(dir, `litellm-run-${randomUUID()}.key`);
  const fd = openSync(runKeyPath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    rmSync(runKeyPath, { force: true });
  };
  try {
    writeSync(fd, key);
  } catch (error) {
    closeSync(fd);
    release();
    throw error;
  }
  closeSync(fd);
  return Object.freeze({ path: runKeyPath, release });
}
