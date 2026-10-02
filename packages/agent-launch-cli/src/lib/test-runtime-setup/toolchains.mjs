

import path from "node:path";

import { fingerprintPopulation, measurePopulationContent } from
  "@agent-chassis/wiki-core/src/lib/runtime-inputs/population-identity.mjs";
import { observeExecutable } from
  "@agent-chassis/wiki-core/src/lib/runtime-inputs/executable-lookup.mjs";
import { TOOLCHAIN_DESCRIPTIONS } from
  "@agent-chassis/wiki-core/src/lib/runtime-inputs/toolchain-descriptions.mjs";
import { observeToolchainInstallation } from
  "@agent-chassis/wiki-core/src/lib/runtime-inputs/toolchain-observation.mjs";

import {
  TOOLCHAIN_RECIPES,
  isVersionRequirement,
  readProjectToolchainPins,
  versionSatisfies
} from "./recipes.mjs";
import { processDiagnostic, runSetupProcess } from "./process.mjs";

const SYSTEM_BIN_DIRS = Object.freeze(["/usr/local/bin", "/usr/bin", "/bin"]);
const SETUP_PROBE_TIMEOUT_MS = 60000;

export class TestRuntimeSetupError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = "TestRuntimeSetupError";
    this.code = code;
    this.detail = detail;
  }
}

function fail(code, message, detail = {}) {
  throw new TestRuntimeSetupError(code, message, detail);
}

export function findOnPath(command, searchPath) {
  const observation = observeExecutable({ command, searchPath });
  if (observation.status === "found") {
    return { found: observation.requested_path, real: observation.resolved_path };
  }
  if (observation.status === "absent") return null;
  fail("test_runtime_toolchain_lookup_failed", observation.message,
    { observation, correction: observation.correction, cause: observation.cause ?? null });
}

export function detectNativePrerequisite(command) {
  const observation = observeExecutable({ command, searchPath: SYSTEM_BIN_DIRS.join(path.delimiter) });
  if (observation.status === "found") return observation.requested_path;
  if (observation.status === "absent") return null;
  fail("test_runtime_toolchain_lookup_failed", observation.message,
    { observation, correction: observation.correction, cause: observation.cause ?? null });
}

function selectRequirement(recipe, { requestedVersion, projectDirs }) {
  const pins = [];
  for (const projectDir of projectDirs) {
    for (const pin of readProjectToolchainPins(recipe, projectDir)) {
      pins.push({ ...pin, project_dir: projectDir });
    }
  }
  for (const pin of pins) {
    if (!isVersionRequirement(pin.version)) {
      fail("test_runtime_version_unsupported",
        `${recipe.name} pin ${pin.file} in ${pin.project_dir} is ${pin.version}, not a numeric version`,
        { toolchain: recipe.name, pin });
    }
  }
  const pinned = [...new Set(pins.map(({ version }) => version))];
  const candidates = [...new Set([...pinned, ...(requestedVersion ? [requestedVersion] : [])])];
  if (candidates.length > 1) {
    fail("test_runtime_version_conflict",
      `${recipe.name} version sources disagree: ${candidates.join(", ")}`,
      { toolchain: recipe.name, requested: requestedVersion ?? null, pins });
  }
  return {
    requirement: candidates[0] ?? null,
    requirement_source: pinned.length > 0 ? "project_pin" : requestedVersion ? "operator_request" : null,
    pins
  };
}

function resolveConfiguredExecutable(name, executable) {
  const observation = observeExecutable({ executable });
  if (observation.status === "found") return observation.resolved_path;
  if (observation.status === "absent") {
    fail("test_runtime_toolchain_executable_unavailable",
      `configured ${name} executable ${executable} does not exist`,
      { toolchain: name, executable, searched_paths: observation.searched_paths,
        correction: `set ${name} executable to an existing absolute path` });
  }
  const code = observation.code === "runtime_input_executable_invalid" ||
    observation.operation === "access"
    ? "test_runtime_toolchain_executable_invalid" : "test_runtime_toolchain_lookup_failed";
  fail(code, `configured ${name} executable ${executable}: ${observation.message}`,
    { toolchain: name, executable, operation: observation.operation, path: observation.path,
      errno: observation.errno, observation, correction: observation.correction,
      cause: observation.cause ?? null });
}

function setupProbe({ command, args, cwd, env, deadline, signal }) {
  const timeoutMs = deadline - Date.now();
  if (timeoutMs <= 0 && !signal?.aborted) {
    return { ok: false, command, code: null, signal: null, timed_out: true, cancelled: false,
      output_overflow: null, spawn_error: null, stdout: "", stderr: "" };
  }
  return runSetupProcess(command, args, { cwd, env, timeoutMs, signal });
}

function installationFailure(recipe, observation) {
  const { toolchain: name, executable: real, source, phase } = observation;
  const detail = { toolchain: name, executable: real, source, observation };
  switch (observation.code) {
    case "runtime_input_installation_component_lookup_failed":
      fail("test_runtime_toolchain_lookup_failed", observation.message,
        { ...detail, root: observation.root, correction: observation.correction,
          cause: observation.cause ?? null });
      break;
    case "runtime_input_installation_components_missing":
      fail("test_runtime_toolchain_incomplete",
        `${source} ${name} installation at ${observation.root} is missing required components`,
        { ...detail, root: observation.root, required: Object.values(recipe.executables),
          missing: observation.missing.map(({ role, path: file }) => ({ executable: role, path: file })) });
      break;
    case "runtime_input_installation_probe_failed":
    case "runtime_input_installation_output_invalid": {
      const outcome = observation.result ? processDiagnostic(observation.result) : null;
      const diagnostic = observation.code === "runtime_input_installation_probe_failed" && outcome
        ? outcome : [observation.message, outcome].filter(Boolean).join("\n");
      if (phase === "version") {
        fail("test_runtime_toolchain_unusable", `${source} ${name} at ${real} did not report a usable version`,
          { ...detail, root: observation.root, diagnostic });
      }
      fail("test_runtime_toolchain_incomplete", phase === "describe"
        ? `${source} python interpreter ${real} did not describe a usable installation`
        : `${source} ${name} executable ${real} did not report its toolchain root`, { ...detail, diagnostic });
      break;
    }
    default:
      throw new TypeError(`${observation.message}; ${observation.correction}`, { cause: observation });
  }
}

async function identifyInstallation(recipe, { real, source }) {
  const observation = await observeToolchainInstallation({
    description: TOOLCHAIN_DESCRIPTIONS[recipe.name], executable: real,
    requiredRoles: Object.keys(recipe.executables), source, probe: setupProbe,
    probeContext: { cwd: process.cwd(), timeoutMs: SETUP_PROBE_TIMEOUT_MS, env: {
      root: { PATH: "/usr/bin:/bin" },
      describe: { PATH: "/usr/bin:/bin", PYTHONDONTWRITEBYTECODE: "1" },
      version: { PATH: "/usr/bin:/bin" } } }
  });
  if (observation.status !== "observed") installationFailure(recipe, observation);
  const { status, ...installation } = observation;
  return installation;
}

export async function resolveToolchain({
  name,
  requestedVersion = null,
  configuredExecutable = null,
  projectDirs = [],
  env = process.env,
  measure = true
}) {
  const recipe = TOOLCHAIN_RECIPES[name];
  if (!recipe) fail("test_runtime_toolchain_unknown", `unknown toolchain ${name}`);
  const selected = selectRequirement(recipe, { requestedVersion, projectDirs });
  for (const prerequisite of recipe.native_prerequisites ?? []) {
    if (detectNativePrerequisite(prerequisite) === null) {
      fail("test_runtime_native_prerequisite_missing",
        `${name} requires the native ${prerequisite} tool under a system root`,
        { toolchain: name, prerequisite, searched: SYSTEM_BIN_DIRS });
    }
  }
  let real;
  let source;
  if (configuredExecutable !== null) {
    real = resolveConfiguredExecutable(name, configuredExecutable);
    source = "configured";
  } else {
    const located = findOnPath(recipe.host_command, env.PATH);
    if (located === null) {
      fail("test_runtime_toolchain_not_found",
        `no ${recipe.host_command} was found on PATH and no ${name} location is configured`,
        { toolchain: name, command: recipe.host_command, searched_path: env.PATH ?? null,
          correction: `install ${name}, then rerun setup with it on PATH or with ` +
            `--executable ${name}=/absolute/path/to/${recipe.host_command}` });
    }
    real = located.real;
    source = "host";
  }
  const installation = await identifyInstallation(recipe, { real, source });
  if (selected.requirement !== null && !versionSatisfies(selected.requirement, installation.version)) {
    fail("test_runtime_version_mismatch",
      `${source} ${name} at ${real} reports ${installation.version}, not the required ${selected.requirement}`,
      { toolchain: name, executable: real, root: installation.root, source,
        selected: selected.requirement, requirement_source: selected.requirement_source,
        reported: installation.version, pins: selected.pins });
  }
  const component = { name, ...installation, version_source: selected.requirement_source ?? "installed",
    requirement: selected.requirement, pins: selected.pins };
  if (!measure) return component;
  const identity = measurePopulationContent(installation.population,
    { exclude: installation.population_exclude });
  return { ...component, content_digest: identity.content_digest,
    fingerprint: fingerprintPopulation(installation.population, { exclude: installation.population_exclude }) };
}
