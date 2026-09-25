

import { accessSync, constants, existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

import {
  TOOLCHAIN_RECIPES,
  isVersionRequirement,
  readProjectToolchainPins,
  versionSatisfies
} from "./recipes.mjs";
import { fingerprintPopulation, measurePopulationContent } from "./tree-identity.mjs";
import { processDiagnostic, runSetupProcess } from "./process.mjs";

const SYSTEM_BIN_DIRS = Object.freeze(["/usr/local/bin", "/usr/bin", "/bin"]);

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
  for (const directory of String(searchPath ?? "").split(path.delimiter)) {
    if (!path.isAbsolute(directory)) continue;
    const candidate = path.join(directory, command);
    try {
      accessSync(candidate, constants.X_OK);
      const real = realpathSync(candidate);
      if (statSync(real).isFile()) return { found: candidate, real };
    } catch {

    }
  }
  return null;
}

export function detectNativePrerequisite(command) {
  for (const directory of SYSTEM_BIN_DIRS) {
    const candidate = path.join(directory, command);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {

    }
  }
  return null;
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

const PYTHON_DESCRIBE_PROGRAM = [
  "import json, os, platform, sys, sysconfig",
  "print(json.dumps({'executable': os.path.realpath(sys.executable),",
  "  'version': platform.python_version(), 'prefix': sys.base_prefix,",
  "  'stdlib': os.path.realpath(sysconfig.get_paths()['stdlib'])}))"
].join("\n");

async function describePython(executable) {
  const result = await runSetupProcess(executable, ["-I", "-B", "-c", PYTHON_DESCRIBE_PROGRAM],
    { env: { PATH: "/usr/bin:/bin", PYTHONDONTWRITEBYTECODE: "1" }, timeoutMs: 60000 });
  if (!result.ok) return { ok: false, diagnostic: processDiagnostic(result) };
  try { return { ok: true, described: JSON.parse(result.stdout) }; } catch {
    return { ok: false, diagnostic: processDiagnostic(result) };
  }
}

async function probeVersion(recipe, executables) {
  const executable = executables[recipe.probe.executable];
  const result = await runSetupProcess(executable, [...recipe.probe.args], {
    env: { PATH: [path.dirname(executable), "/usr/bin", "/bin"].join(path.delimiter),
      RUSTC: executables.rustc ?? "" },
    timeoutMs: 60000
  });
  return { version: result.ok ? recipe.probe.version(result.stdout.trim()) : null,
    diagnostic: processDiagnostic(result) };
}

function resolveConfiguredExecutable(name, executable) {
  if (!path.isAbsolute(executable)) {
    fail("test_runtime_toolchain_executable_invalid",
      `configured ${name} executable ${executable} must be an absolute path`,
      { toolchain: name, executable });
  }
  let real;
  try {
    real = realpathSync(executable);
  } catch (error) {
    fail("test_runtime_toolchain_executable_unavailable",
      `configured ${name} executable ${executable} does not exist`,
      { toolchain: name, executable, errno: error?.code ?? null });
  }
  if (!statSync(real).isFile()) {
    fail("test_runtime_toolchain_executable_invalid",
      `configured ${name} executable ${executable} is not a regular file`,
      { toolchain: name, executable, resolved: real });
  }
  try {
    accessSync(real, constants.X_OK);
  } catch (error) {
    fail("test_runtime_toolchain_executable_invalid",
      `configured ${name} executable ${executable} is not executable`,
      { toolchain: name, executable, resolved: real, errno: error?.code ?? null });
  }
  return real;
}

async function identifyInstallation(recipe, { real, source }) {
  const name = recipe.name;
  if (name === "python") {
    const described = await describePython(real);
    if (!described.ok) {
      fail("test_runtime_toolchain_incomplete",
        `${source} python interpreter ${real} did not describe a usable installation`,
        { toolchain: name, executable: real, source, diagnostic: described.diagnostic });
    }
    const { executable, version, prefix, stdlib } = described.described;
    return { root: prefix, executables: { python: executable },
      population: [executable, stdlib], population_exclude: ["__pycache__", "site-packages", "dist-packages"],
      version, source };
  }
  let root;
  if (recipe.host_root_probe) {
    const probed = await runSetupProcess(real, [...recipe.host_root_probe],
      { env: { PATH: "/usr/bin:/bin" }, timeoutMs: 60000 });
    if (!probed.ok) {
      fail("test_runtime_toolchain_incomplete",
        `${source} ${name} executable ${real} did not report its toolchain root`,
        { toolchain: name, executable: real, source, diagnostic: processDiagnostic(probed) });
    }
    root = probed.stdout.trim();
  } else {
    root = recipe.hostRoot(real);
  }
  const executables = Object.fromEntries(Object.entries(recipe.executables)
    .map(([role, relative]) => [role, path.join(root, relative)]));
  const missing = Object.entries(executables).filter(([, file]) => !existsSync(file))
    .map(([role, file]) => ({ executable: role, path: file }));
  if (missing.length > 0) {
    fail("test_runtime_toolchain_incomplete",
      `${source} ${name} installation at ${root} is missing required components`,
      { toolchain: name, executable: real, root, source, required: Object.values(recipe.executables), missing });
  }
  const probed = await probeVersion(recipe, executables);
  if (probed.version === null) {
    fail("test_runtime_toolchain_unusable",
      `${source} ${name} at ${real} did not report a usable version`,
      { toolchain: name, executable: real, root, source, diagnostic: probed.diagnostic });
  }
  return { root, executables, population: recipe.population.map((relative) => path.join(root, relative)),
    population_exclude: [], version: probed.version, source };
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
