

import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

import {
  LITELLM_PINNED_VERSION,
  LITELLM_RUNTIME_LOCK_PATH,
  LITELLM_RUNTIME_PYTHON_SERIES,
  LiteLlmGatewayError,
  acquireLiteLlmRunKey,
  defaultLiteLlmStateRoot,
  ensureLiteLlmGateway,
  ensurePrivateDirectory,
  publishPrivateFile,
  withExclusiveStateLock
} from "@agent-chassis/agent-launch-core/src/lib/litellm-gateway.mjs";

import { isLiteLlmRoute } from "./agent-launch-model-route.mjs";
import {
  buildCodexModelProviderOverrides
} from "./codex-role-reasoning-effort.mjs";
import { injectCodexConfigOverridesBeforeFinalPositional } from "./codex-role-mcp-env.mjs";
import { runSetupProcess } from "./test-runtime-setup/process.mjs";
import { findOnPath } from "./test-runtime-setup/toolchains.mjs";

export const LITELLM_RUNTIME_READY_SCHEMA_VERSION = "agent-launch-litellm-runtime.v1";
export const LITELLM_LAUNCH_ERROR_CODES = Object.freeze({
  PYTHON_MISSING: "litellm_runtime_python_missing",
  PYTHON_UNSUPPORTED: "litellm_runtime_python_unsupported",
  PIP_MISSING: "litellm_runtime_pip_missing",
  INSTALL_FAILED: "litellm_runtime_install_failed",
  GENERATION_INCOMPLETE: "litellm_runtime_generation_incomplete",
  VERTEX_PROJECT_UNRESOLVED: "litellm_vertex_project_unresolved",
  VERTEX_CREDENTIALS_INVALID: "litellm_vertex_credentials_invalid"
});

const SYSTEM_PYTHON_SEARCH_PATH = "/usr/local/bin:/usr/bin:/bin";

export function liteLlmSeededInputs(stateRoot) {
  return Object.freeze({
    pythonBin: path.join(stateRoot, "python", "bin"),
    wheelhouse: path.join(stateRoot, "wheelhouse")
  });
}
const PROBE_TIMEOUT_MS = 60_000;
const INSTALL_TIMEOUT_MS = 20 * 60_000;
const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const PROXY_ENV = Object.freeze(["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "NO_PROXY", "no_proxy"]);

function fail(code, message, { stage, correction, detail } = {}) {
  throw new LiteLlmGatewayError(code, message, { stage, correction, detail });
}

function processCause(result) {
  const errorLine = `${result.stderr ?? ""}\n${result.stdout ?? ""}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^(ERROR|error)\b|Error:/.test(line))
    .pop() ?? null;
  return {
    exit_code: result.code ?? null,
    signal: result.signal ?? null,
    timed_out: result.timed_out === true,
    output_overflow: result.output_overflow ?? null,
    spawn_error: result.spawn_error ?? null,
    tool_error: errorLine === null ? null : errorLine.slice(0, 300)
  };
}

function setupEnv(env, extra) {
  const closed = { PATH: "/usr/bin:/bin", LANG: "C.UTF-8", ...extra };
  for (const name of PROXY_ENV) {
    if (typeof env?.[name] === "string" && env[name].length > 0) closed[name] = env[name];
  }
  return closed;
}

function runtimeLockDigest(lockPath = LITELLM_RUNTIME_LOCK_PATH) {
  return createHash("sha256").update(readFileSync(lockPath)).digest("hex");
}

export async function provisionLiteLlmRuntime({
  stateRoot,
  env = process.env,
  lockPath = LITELLM_RUNTIME_LOCK_PATH,
  runProcess = runSetupProcess,
  findExecutable = findOnPath
}) {
  const seeded = liteLlmSeededInputs(stateRoot);
  const pythonSearchPath = `${seeded.pythonBin}:${SYSTEM_PYTHON_SEARCH_PATH}`;
  const python = findExecutable("python3", pythonSearchPath);
  if (python === null) {
    fail(LITELLM_LAUNCH_ERROR_CODES.PYTHON_MISSING, "no python3 interpreter was found for the private LiteLLM runtime", {
      stage: "runtime_python",
      correction: `install CPython ${LITELLM_RUNTIME_PYTHON_SERIES} with pip (for example the python3 and python3-pip packages)`,
      detail: { searched_path: pythonSearchPath }
    });
  }
  const probeEnv = setupEnv(env, {});
  const version = await runProcess(python.real, ["-I", "-c",
    "import sys, venv; print('%d.%d.%d' % sys.version_info[:3])"], { env: probeEnv, timeoutMs: PROBE_TIMEOUT_MS });
  const pythonVersion = version.ok ? version.stdout.trim() : null;
  if (pythonVersion === null || !pythonVersion.startsWith(`${LITELLM_RUNTIME_PYTHON_SERIES}.`)) {
    fail(LITELLM_LAUNCH_ERROR_CODES.PYTHON_UNSUPPORTED,
      `python3 at ${python.real} is ${pythonVersion ?? "unusable"}; the pinned LiteLLM runtime requires CPython ${LITELLM_RUNTIME_PYTHON_SERIES} with the venv module`, {
        stage: "runtime_python",
        correction: `install CPython ${LITELLM_RUNTIME_PYTHON_SERIES} as python3`,
        detail: { python: python.real, python_version: pythonVersion, ...(version.ok ? {} : processCause(version)) }
      });
  }
  const pip = await runProcess(python.real, ["-I", "-m", "pip", "--version"], { env: probeEnv, timeoutMs: PROBE_TIMEOUT_MS });
  if (!pip.ok) {
    fail(LITELLM_LAUNCH_ERROR_CODES.PIP_MISSING, `python3 at ${python.real} has no usable pip module`, {
      stage: "runtime_python",
      correction: "install pip for the host python3 (for example the python3-pip package)",
      detail: { python: python.real, ...processCause(pip) }
    });
  }

  const lockDigest = runtimeLockDigest(lockPath);
  const generation = createHash("sha256")
    .update(JSON.stringify({ lock: lockDigest, python: python.real, python_version: pythonVersion }))
    .digest("hex").slice(0, 32);
  const runtimesDir = ensurePrivateDirectory(path.join(stateRoot, "runtimes"), { label: "runtime directory" });
  const generationDir = path.join(runtimesDir, generation);
  const readyPath = path.join(runtimesDir, `${generation}.ready.json`);
  const executable = path.join(generationDir, "venv", "bin", "litellm");
  const ready = () => readReady(readyPath, { generation, lockDigest, executable });

  const existing = ready();
  if (existing !== null) return existing;
  return withExclusiveStateLock(path.join(runtimesDir, `${generation}.lock`), async () => {
    const raced = ready();
    if (raced !== null) return raced;
    if (existsSync(generationDir)) {
      fail(LITELLM_LAUNCH_ERROR_CODES.GENERATION_INCOMPLETE,
        `runtime generation ${generationDir} exists but was never published ready`, {
          stage: "runtime_install",
          correction: `remove ${generationDir} and relaunch to reprovision it`,
          detail: { generation_dir: generationDir }
        });
    }
    ensurePrivateDirectory(generationDir, { label: "runtime generation" });
    try {
      await installGeneration({
        python: python.real, generationDir, lockPath, env, runProcess,
        wheelhouse: existsSync(seeded.wheelhouse) ? seeded.wheelhouse : null
      });
      publishPrivateFile(readyPath, `${JSON.stringify({
        schema_version: LITELLM_RUNTIME_READY_SCHEMA_VERSION,
        generation,
        lock_digest: lockDigest,
        python: python.real,
        python_version: pythonVersion,
        litellm_version: LITELLM_PINNED_VERSION,
        executable
      }, null, 2)}\n`, { stage: "runtime_ready" });
    } catch (error) {

      rmSync(generationDir, { recursive: true, force: true });
      throw error;
    }
    return ready();
  }, { label: "runtime provisioning lock" });
}

function readReady(readyPath, { generation, lockDigest, executable }) {
  if (!existsSync(readyPath)) return null;
  let record = null;
  try { record = JSON.parse(readFileSync(readyPath, "utf8")); } catch { record = null; }
  if (record?.schema_version !== LITELLM_RUNTIME_READY_SCHEMA_VERSION || record.generation !== generation ||
      record.lock_digest !== lockDigest || record.executable !== executable || !existsSync(executable)) {
    fail(LITELLM_LAUNCH_ERROR_CODES.GENERATION_INCOMPLETE,
      `runtime readiness record ${readyPath} does not describe an intact generation`, {
        stage: "runtime_ready",
        correction: `remove ${readyPath} and ${path.dirname(path.dirname(path.dirname(executable)))}, then relaunch`,
        detail: { ready_path: readyPath }
      });
  }
  return Object.freeze({ generation, executable, args: [], lock_digest: lockDigest });
}

async function installGeneration({ python, generationDir, lockPath, env, runProcess, wheelhouse = null }) {
  const venv = path.join(generationDir, "venv");
  const pipHome = ensurePrivateDirectory(path.join(generationDir, "setup-home"), { label: "setup home" });
  const installEnv = setupEnv(env, {
    HOME: pipHome,
    PIP_CONFIG_FILE: "/dev/null",
    PIP_NO_INPUT: "1",
    PIP_DISABLE_PIP_VERSION_CHECK: "1",
    PYTHONNOUSERSITE: "1",

    LITELLM_LOCAL_MODEL_COST_MAP: "True"
  });
  const steps = [
    ["create_venv", python, ["-I", "-m", "venv", "--without-pip", venv], PROBE_TIMEOUT_MS],
    ["install_locked_packages", python, ["-I", "-m", "pip", "--python", path.join(venv, "bin", "python"),
      "install", "--quiet", "--isolated", "--no-cache-dir", "--require-hashes", "--no-deps",
      "--only-binary=:all:",
      ...(wheelhouse === null ? [] : ["--no-index", "--find-links", wheelhouse]),
      "-r", lockPath], INSTALL_TIMEOUT_MS],
    ["validate_install", path.join(venv, "bin", "python"), ["-I", "-c",
      "import importlib.metadata as m, litellm, google.auth, vertexai; print(m.version('litellm'))"], PROBE_TIMEOUT_MS]
  ];
  for (const [step, command, args, timeoutMs] of steps) {
    const result = await runProcess(command, args, { env: installEnv, timeoutMs, cwd: generationDir });
    const validated = step !== "validate_install" || result.stdout.trim() === LITELLM_PINNED_VERSION;
    if (!result.ok || !validated) {
      fail(LITELLM_LAUNCH_ERROR_CODES.INSTALL_FAILED, `private LiteLLM runtime step ${step} failed`, {
        stage: "runtime_install",
        correction: step === "install_locked_packages"
          ? (wheelhouse === null
            ? "check network access to the Python package index (or the configured proxy), then relaunch"
            : `the seeded wheelhouse ${wheelhouse} does not satisfy the packaged lock; reseed it from that lock, then relaunch`)
          : "check the host python3 installation, then relaunch",
        detail: { step, ...processCause(result),
          ...(validated ? {} : { installed_version: result.stdout.trim().slice(0, 40) }) }
      });
    }
  }
  rmSync(pipHome, { recursive: true, force: true });
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
  try {
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
