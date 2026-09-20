

import { createHash, randomBytes } from "node:crypto";
import {
  accessSync, chmodSync, constants, createWriteStream, existsSync, mkdirSync, readFileSync,
  readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync
} from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  TOOLCHAIN_RECIPES,
  isSupportedToolchainVersion,
  readProjectToolchainPins,
  toolchainArtifact
} from "./recipes.mjs";
import { fingerprintPopulation, measurePopulationContent } from "./tree-identity.mjs";
import { processDiagnostic, runSetupProcess } from "./process.mjs";

export const TOOLCHAIN_MARKER_FILE = ".agent-chassis-toolchain.json";
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

function selectVersion(recipe, { requestedVersion, projectDirs }) {
  const pins = [];
  for (const projectDir of projectDirs) {
    for (const pin of readProjectToolchainPins(recipe, projectDir)) {
      pins.push({ ...pin, project_dir: projectDir });
    }
  }
  const pinned = [...new Set(pins.map(({ version }) => version))];
  const candidates = [...new Set([...pinned, ...(requestedVersion ? [requestedVersion] : [])])];
  if (candidates.length > 1) {
    fail("test_runtime_version_conflict",
      `${recipe.name} version sources disagree: ${candidates.join(", ")}`,
      { toolchain: recipe.name, requested: requestedVersion ?? null, pins });
  }
  const version = candidates[0] ?? recipe.baseline;
  if (!isSupportedToolchainVersion(recipe, version)) {
    fail("test_runtime_version_unsupported",
      `${recipe.name} ${version} is not a supported setup version`,
      { toolchain: recipe.name, version,
        supported: recipe.versions ? Object.keys(recipe.versions) : String(recipe.versionPattern) });
  }
  return {
    version,
    version_source: pinned.length > 0 ? "project_pin" : requestedVersion ? "operator_request"
      : "package_baseline",
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
  const result = await runSetupProcess(executable, ["-I", "-c", PYTHON_DESCRIBE_PROGRAM],
    { env: { PATH: "/usr/bin:/bin" }, timeoutMs: 60000 });
  if (!result.ok) return null;
  try { return JSON.parse(result.stdout); } catch { return null; }
}

function pythonComponent(described, version, source) {
  return {
    root: described.prefix,
    executables: { python: described.executable },
    population: [described.executable, described.stdlib],
    population_exclude: ["__pycache__", "site-packages", "dist-packages"],
    version, source
  };
}

async function describeComponent(recipe, { root, version, source, executableOverride = null }) {
  if (recipe.name === "python") {
    const described = await describePython(executableOverride ?? path.join(root, "bin", "python3"));
    if (described === null || described.version !== version) return null;
    return pythonComponent(described, version, source);
  }
  const executables = Object.fromEntries(Object.entries(recipe.executables)
    .map(([name, relative]) => [name, path.join(root, relative)]));
  if (Object.values(executables).some((file) => !existsSync(file))) return null;
  return {
    root,
    executables,
    ...(recipe.setup_executables ? { setup_executables: Object.fromEntries(
      Object.entries(recipe.setup_executables).map(([name, relative]) => [name, path.join(root, relative)])) } : {}),
    population: recipe.population.map((relative) => path.join(root, relative)),
    population_exclude: [],
    version, source
  };
}

async function probeHostVersion(recipe, component) {
  const executable = component.executables[recipe.probe.executable];
  const result = await runSetupProcess(executable, [...recipe.probe.args], {
    env: { PATH: [path.dirname(executable), "/usr/bin", "/bin"].join(path.delimiter),
      RUSTC: component.executables.rustc ?? "" },
    timeoutMs: 60000
  });
  return result.ok ? recipe.probe.version(result.stdout.trim()) : null;
}

async function resolveHostComponent(recipe, { version, searchPath }) {
  const located = findOnPath(recipe.host_command, searchPath);
  if (located === null) return null;
  let root;
  if (recipe.name === "python") {
    return describeComponent(recipe, { root: null, version, source: "host",
      executableOverride: located.real });
  }
  if (recipe.host_root_probe) {
    const result = await runSetupProcess(located.real, [...recipe.host_root_probe],
      { env: { PATH: "/usr/bin:/bin" }, timeoutMs: 60000 });
    if (!result.ok) return null;
    root = result.stdout.trim();
  } else {
    root = recipe.hostRoot(located.real);
  }
  const component = await describeComponent(recipe, { root, version, source: "host" });
  if (component === null) return null;
  return (await probeHostVersion(recipe, component)) === version ? component : null;
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

async function resolveConfiguredComponent(recipe, { version, executable }) {
  const name = recipe.name;
  const real = resolveConfiguredExecutable(name, executable);
  if (name === "python") {
    const described = await describePython(real);
    if (described === null) {
      fail("test_runtime_toolchain_incomplete",
        `configured python interpreter ${real} did not describe a usable installation`,
        { toolchain: name, executable: real });
    }
    if (described.version !== version) {
      fail("test_runtime_version_mismatch",
        `configured python at ${real} reports ${described.version}, not the selected ${version}`,
        { toolchain: name, executable: real, selected: version, reported: described.version });
    }
    return pythonComponent(described, version, "configured");
  }
  let root;
  if (recipe.host_root_probe) {
    const probed = await runSetupProcess(real, [...recipe.host_root_probe],
      { env: { PATH: "/usr/bin:/bin" }, timeoutMs: 60000 });
    if (!probed.ok) {
      fail("test_runtime_toolchain_incomplete",
        `configured ${name} executable ${real} did not report its toolchain root`,
        { toolchain: name, executable: real, diagnostic: processDiagnostic(probed) });
    }
    root = probed.stdout.trim();
  } else {
    root = recipe.hostRoot(real);
  }
  const component = await describeComponent(recipe, { root, version, source: "configured" });
  if (component === null) {
    fail("test_runtime_toolchain_incomplete",
      `configured ${name} installation at ${root} is missing required components`,
      { toolchain: name, executable: real, root,
        required: Object.values(recipe.executables) });
  }
  const reported = await probeHostVersion(recipe, component);
  if (reported !== version) {
    fail("test_runtime_version_mismatch",
      `configured ${name} at ${real} reports ${reported ?? "no usable version"}, not the selected ${version}`,
      { toolchain: name, executable: real, root, selected: version, reported });
  }
  return component;
}

function markerPath(installDir) {
  return `${installDir}${TOOLCHAIN_MARKER_FILE}`;
}

function readMarker(installDir) {
  try {
    return JSON.parse(readFileSync(markerPath(installDir), "utf8"));
  } catch {
    return null;
  }
}

async function download(url, destination, expectedSha256, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, { redirect: "follow" });
  } catch (error) {
    fail("test_runtime_download_failed", `download failed: ${url}`,
      { url, cause: error?.cause?.code ?? error?.message ?? String(error) });
  }
  if (!response.ok || response.body === null) {
    fail("test_runtime_download_failed", `download failed with HTTP ${response.status}: ${url}`,
      { url, status: response.status });
  }
  const hash = createHash("sha256");
  const hashing = Readable.fromWeb(response.body);
  hashing.on("data", (chunk) => hash.update(chunk));
  await pipeline(hashing, createWriteStream(destination));
  const actual = hash.digest("hex");
  if (actual !== expectedSha256) {
    fail("test_runtime_artifact_digest_mismatch", `artifact digest mismatch for ${url}`,
      { url, expected: expectedSha256, actual });
  }
}

const EXTRACTION_PREREQUISITES = Object.freeze({
  "tar.gz": ["tar"], "tar.xz": ["tar", "xz"], zip: ["unzip"]
});

async function extract(artifact, archive, destination) {
  for (const command of EXTRACTION_PREREQUISITES[artifact.format]) {
    if (detectNativePrerequisite(command) === null) {
      fail("test_runtime_native_prerequisite_missing",
        `extracting ${artifact.format} requires ${command}`, { prerequisite: command });
    }
  }
  mkdirSync(destination, { recursive: true });
  const result = artifact.format === "zip"
    ? await runSetupProcess("unzip", ["-q", archive, "-d", destination],
      { env: { PATH: "/usr/bin:/bin" } })
    : await runSetupProcess("tar", ["-xf", archive, "-C", destination,
      `--strip-components=${artifact.strip_components}`], { env: { PATH: "/usr/bin:/bin" } });
  if (!result.ok) {
    fail("test_runtime_installer_failed", `extracting ${archive} failed`,
      { diagnostic: processDiagnostic(result) });
  }
}

async function installComponent(recipe, artifact, { version, stagingDir, fetchImpl, env }) {
  const downloads = path.join(stagingDir, ".download");
  mkdirSync(downloads, { recursive: true });
  if (artifact.installer === "archive") {
    const archive = path.join(downloads, path.basename(new URL(artifact.url).pathname));
    await download(artifact.url, archive, artifact.sha256, fetchImpl);
    await extract(artifact, archive, stagingDir);
    rmSync(downloads, { recursive: true, force: true });
    return { layoutRoot: "." };
  }
  if (artifact.installer === "rustup") {
    const installer = path.join(downloads, "rustup-init");
    await download(artifact.url, installer, artifact.sha256, fetchImpl);
    chmodSync(installer, 0o755);
    const result = await runSetupProcess(installer, ["-y", "--no-modify-path", "--profile", "minimal",
      "--default-toolchain", version], {
      env: { PATH: env.PATH ?? "/usr/bin:/bin", HOME: stagingDir,
        RUSTUP_HOME: path.join(stagingDir, "rustup"), CARGO_HOME: path.join(stagingDir, "cargo"),
        ...(env.HTTPS_PROXY ? { HTTPS_PROXY: env.HTTPS_PROXY } : {}) }
    });
    rmSync(downloads, { recursive: true, force: true });
    if (!result.ok) {
      fail("test_runtime_installer_failed", `rustup installation of ${version} failed`,
        { diagnostic: processDiagnostic(result) });
    }
    return { layoutRoot: path.join("rustup", "toolchains", `${version}-${artifact.target}`) };
  }
  if (artifact.installer === "uv_python") {
    const uv = findOnPath("uv", env.PATH);
    if (uv === null) {
      fail("test_runtime_installer_unavailable",
        "installing a Python version requires the uv installer on PATH", { installer: "uv" });
    }
    const result = await runSetupProcess(uv.real, ["python", "install", version, "--no-bin",
      "--install-dir", path.join(stagingDir, "cpython")], {
      env: { PATH: env.PATH ?? "/usr/bin:/bin", HOME: env.HOME ?? stagingDir,
        UV_PYTHON_INSTALL_DIR: path.join(stagingDir, "cpython") }
    });
    rmSync(downloads, { recursive: true, force: true });
    if (!result.ok) {
      fail("test_runtime_installer_failed", `uv python install ${version} failed`,
        { diagnostic: processDiagnostic(result) });
    }
    const [build] = readdirSync(path.join(stagingDir, "cpython"))
      .filter((name) => name.startsWith(`cpython-${version}-`));
    if (!build) fail("test_runtime_installer_failed", `uv did not install CPython ${version}`);
    return { layoutRoot: path.join("cpython", build) };
  }
  fail("test_runtime_installer_unavailable", `unknown installer ${artifact.installer}`);
}

export async function resolveToolchain({
  name,
  requestedVersion = null,
  configuredExecutable = null,
  projectDirs = [],
  toolchainRoot,
  hostToolchains = "reuse",
  platformKey,
  env = process.env,
  dryRun = false,
  fetchImpl = globalThis.fetch
}) {
  const recipe = TOOLCHAIN_RECIPES[name];
  if (!recipe) fail("test_runtime_toolchain_unknown", `unknown toolchain ${name}`);
  const selected = selectVersion(recipe, { requestedVersion, projectDirs });
  const artifact = toolchainArtifact(recipe, selected.version, platformKey);
  if (artifact === null) {
    fail("test_runtime_platform_unsupported",
      `${name} ${selected.version} has no supported artifact for ${platformKey}`,
      { toolchain: name, version: selected.version, platform: platformKey });
  }
  for (const prerequisite of recipe.native_prerequisites ?? []) {
    if (detectNativePrerequisite(prerequisite) === null) {
      fail("test_runtime_native_prerequisite_missing",
        `${name} requires the native ${prerequisite} tool under a system root`,
        { toolchain: name, prerequisite });
    }
  }
  const base = { name, ...selected };

  if (configuredExecutable !== null) {
    const configured = await resolveConfiguredComponent(recipe,
      { version: selected.version, executable: configuredExecutable });
    if (dryRun) return { ...base, ...configured, reused: true };
    const identity = measurePopulationContent(configured.population,
      { exclude: configured.population_exclude });
    return { ...base, ...configured, content_digest: identity.content_digest,
      fingerprint: fingerprintPopulation(configured.population,
        { exclude: configured.population_exclude }), reused: true };
  }
  const installDir = path.join(toolchainRoot, name, selected.version);
  const marker = readMarker(installDir);
  if (marker !== null) {
    const component = await describeComponent(recipe, {
      root: path.join(installDir, marker.layout_root), version: selected.version, source: "installed"
    });
    if (component !== null && fingerprintPopulation(component.population,
      { exclude: component.population_exclude }) === marker.fingerprint) {
      return { ...base, ...component, content_digest: marker.content_digest,
        fingerprint: marker.fingerprint, reused: true };
    }
  }
  if (hostToolchains === "reuse") {
    const host = await resolveHostComponent(recipe, { version: selected.version,
      searchPath: env.PATH });
    if (host !== null && dryRun) return { ...base, ...host, reused: true };
    if (host !== null) {
      const identity = measurePopulationContent(host.population, { exclude: host.population_exclude });
      return { ...base, ...host, content_digest: identity.content_digest,
        fingerprint: fingerprintPopulation(host.population, { exclude: host.population_exclude }),
        reused: true };
    }
  }
  if (dryRun) {
    return { ...base, source: "planned_install", root: installDir, planned: artifact };
  }
  mkdirSync(path.dirname(installDir), { recursive: true });
  const stagingDir = `${installDir}.partial-${randomBytes(6).toString("hex")}`;
  try {
    const { layoutRoot } = await installComponent(recipe, artifact, {
      version: selected.version, stagingDir, fetchImpl, env });
    rmSync(markerPath(installDir), { force: true });
    rmSync(installDir, { recursive: true, force: true });
    renameSync(stagingDir, installDir);
    const component = await describeComponent(recipe, {
      root: path.join(installDir, layoutRoot), version: selected.version, source: "installed" });
    if (component === null) {
      fail("test_runtime_installer_failed",
        `${name} ${selected.version} installation is incomplete`, { install_dir: installDir });
    }
    if ((await probeHostVersion(recipe, component)) !== selected.version) {
      fail("test_runtime_version_mismatch",
        `installed ${name} does not report version ${selected.version}`, { install_dir: installDir });
    }
    const identity = measurePopulationContent(component.population,
      { exclude: component.population_exclude });
    const fingerprint = fingerprintPopulation(component.population,
      { exclude: component.population_exclude });
    writeFileSync(markerPath(installDir), `${JSON.stringify({
      schema_version: "agent-chassis-toolchain-marker.v1", name, version: selected.version,
      layout_root: layoutRoot, content_digest: identity.content_digest, fingerprint
    }, null, 2)}\n`);
    return { ...base, ...component, content_digest: identity.content_digest, fingerprint,
      reused: false, artifact: { url: artifact.url ?? null, sha256: artifact.sha256 ?? null,
        installer: artifact.installer } };
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
  }
}
