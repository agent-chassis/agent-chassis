

import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  CARGO_OFFLINE_ENV,
  cargoConfigFiles,
  cargoHomeFromEnvironment,
  cargoToolchainEnv
} from "./runtime-inputs/ecosystem-inputs-cargo.mjs";
import { observeExecutable } from "./runtime-inputs/executable-lookup.mjs";
import { TOOLCHAIN_DESCRIPTIONS } from "./runtime-inputs/toolchain-descriptions.mjs";
import { observeToolchainInstallation } from "./runtime-inputs/toolchain-observation.mjs";

export const SIDECAR_RUST_INDEXER = "rust-analyzer";

const SYSTEM_PATH = Object.freeze(["/usr/bin", "/bin"]);

const SYSROOT_POPULATION = Object.freeze(["bin", "lib", "libexec"]);

const TOOLCHAIN_FILES = Object.freeze(["rust-toolchain", "rust-toolchain.toml"]);
const CONFIG_FILES = Object.freeze([".cargo/config", ".cargo/config.toml"]);
const STDOUT_TEXT = (bytes) => Buffer.from(bytes).toString("utf8");

const directoryOf = (filePath) => {
  const directory = path.posix.dirname(filePath);
  return directory === "" ? "." : directory;
};
const joinRelative = (directory, name) => directory === "." ? name : `${directory}/${name}`;

export function isSidecarRustManifest(relativePath) {
  return path.posix.basename(relativePath) === "Cargo.toml";
}

export function rustupHomeFromEnvironment(env) {
  const absolute = (value) => typeof value === "string" && path.isAbsolute(value) ? value : null;
  return absolute(env.RUSTUP_HOME) ?? path.join(absolute(env.HOME) ?? os.homedir(), ".rustup");
}

export function sidecarRustToolRoles(sysroot, env) {
  const settings = path.join(rustupHomeFromEnvironment(env), "settings.toml");
  const selection = { role: "rustc", command: "rustc",
    population: (file) => [file, ...(existsSync(settings) ? [settings] : [])] };
  if (typeof sysroot !== "string") return [selection];
  const executable = (name) => path.join(sysroot, "bin", name);
  return [
    selection,
    { role: "indexer", executable: executable("rust-analyzer"), population: (file) => [file] },
    { role: "cargo", executable: executable("cargo"), population: (file) => [file] },
    { role: "sysroot_rustc", executable: executable("rustc"), population: () => SYSROOT_POPULATION
      .map((part) => path.join(sysroot, part)).filter((part) => existsSync(part)) }
  ];
}

export function sidecarRustEnvironmentSettings(env) {
  return { CARGO_HOME: cargoHomeFromEnvironment(env), RUSTUP_HOME: env.RUSTUP_HOME ?? null,
    RUSTUP_TOOLCHAIN: env.RUSTUP_TOOLCHAIN ?? null };
}

export function sidecarRustSettings(project) {
  return { RUST_SYSROOT: project.sysroot ?? null, features: "default", target: "host",
    CARGO_NET_OFFLINE: CARGO_OFFLINE_ENV.CARGO_NET_OFFLINE, locked: project.locked ? "true" : "false",
    dependency_mapping: sidecarRustDependencyMappingDigest(project.dependency_mapping ?? null) };
}

export function sidecarRustDependencyMappingDigest(mapping) {
  if (mapping === null) return "unobserved";
  return `sha256:${createHash("sha256").update(JSON.stringify(mapping)).digest("hex")}`;
}

const LIBRARY_KINDS = new Set(["lib", "rlib", "dylib", "cdylib", "staticlib", "proc-macro"]);

function containedDependencyMapping(metadata, snapshotRoot) {
  const packages = new Map((metadata.packages ?? []).map((entry) => [entry.id, entry]));
  const directoryOfPackage = (entry) => relativeWithin(snapshotRoot, path.dirname(String(entry.manifest_path)));
  const libraryOf = (entry) => {
    const target = (entry.targets ?? []).find(({ kind }) => (kind ?? []).some((value) => LIBRARY_KINDS.has(value)));
    return target ? relativeWithin(snapshotRoot, String(target.src_path)) : null;
  };
  const mapping = {};
  for (const node of metadata.resolve?.nodes ?? []) {
    const from = packages.get(node.id);
    const fromDir = from ? directoryOfPackage(from) : null;
    if (fromDir === null) continue;
    const dependencies = {};
    for (const dependency of node.deps ?? []) {
      const to = packages.get(dependency.pkg);
      const library = to && directoryOfPackage(to) !== null ? libraryOf(to) : null;
      if (library !== null && typeof dependency.name === "string") dependencies[dependency.name] = library;
    }
    mapping[fromDir] = Object.fromEntries(Object.entries(dependencies).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0));
  }
  return Object.fromEntries(Object.entries(mapping).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0));
}

export function sidecarRustProjectInputs(project, entries) {
  return entries.filter(({ path: value }) => project.input_paths.includes(value) ||
    project.input_roots.some((root) => root === "." || value === root || value.startsWith(`${root}/`)));
}

export function sidecarRustProcessEnvironment({ settings, privateRoot }) {
  const sysroot = settings.RUST_SYSROOT;
  if (typeof sysroot !== "string") throw new TypeError("Rust execution requires the resolved sysroot");
  return {
    PATH: [path.join(sysroot, "bin"), ...SYSTEM_PATH].join(path.delimiter),
    HOME: path.join(privateRoot, "home"),
    CARGO_HOME: settings.CARGO_HOME,
    CARGO_TARGET_DIR: path.join(privateRoot, "cargo-target"),
    CARGO: path.join(sysroot, "bin", "cargo"),
    ...cargoToolchainEnv(path.join(sysroot, "bin", "rustc")),
    ...CARGO_OFFLINE_ENV,
    RUSTUP_AUTO_INSTALL: "0"
  };
}

function selectionEnvironment(env, rustc) {
  const passed = Object.fromEntries(["HOME", "RUSTUP_HOME", "RUSTUP_TOOLCHAIN", "CARGO_HOME"]
    .filter((name) => typeof env[name] === "string").map((name) => [name, env[name]]));
  return { ...passed, PATH: [path.dirname(rustc), ...SYSTEM_PATH].join(path.delimiter),
    RUSTUP_AUTO_INSTALL: "0" };
}

function inactiveProjects(manifests) {
  return manifests.map((manifest) => {
    const directory = directoryOf(manifest);
    return Object.freeze({ key: `${SIDECAR_RUST_INDEXER}#${directory}`, indexer: SIDECAR_RUST_INDEXER,
      project: directory, membership: "unobserved", sysroot: null, locked: false,
      input_roots: Object.freeze([directory]), input_paths: Object.freeze([]), dependency_population: null,
      dependency_mapping: null, refusal: null });
  }).sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
}

function relativeWithin(snapshotRoot, absolute) {
  const relative = path.relative(snapshotRoot, absolute);
  if (relative === "") return ".";
  return relative.startsWith("..") || path.isAbsolute(relative) ? null : relative.split(path.sep).join("/");
}

function selectionPaths(workspace) {
  const paths = [];
  for (let directory = workspace; ; directory = directoryOf(directory)) {
    for (const name of [...CONFIG_FILES, ...TOOLCHAIN_FILES]) paths.push(joinRelative(directory, name));
    if (directory === ".") break;
  }
  return paths.sort();
}

async function runText(run, request) {
  return STDOUT_TEXT(await run({ ...request, captureStdout: true }));
}

function failure(code, message) {
  return { code, message };
}

export async function describeSidecarRustProjects({ withSnapshot, manifests, env, run, timeoutMs }) {
  const sorted = [...manifests].sort((left, right) =>
    left.split("/").length - right.split("/").length || (left < right ? -1 : left > right ? 1 : 0));
  if (sorted.length === 0) return [];
  const rustc = observeExecutable({ command: "rustc", searchPath: env.PATH });
  if (rustc.status !== "found") return inactiveProjects(sorted);
  if (typeof withSnapshot !== "function") throw new TypeError("Rust description requires the committed snapshot");

  return withSnapshot((snapshotRoot) => describeWorkspaces({ snapshotRoot: realpathSync(snapshotRoot), sorted,
    env, run, timeoutMs, rustc }));
}

async function describeWorkspaces({ snapshotRoot, sorted, env, run, timeoutMs, rustc }) {
  const cargoHome = cargoHomeFromEnvironment(env);
  const projects = new Map();
  const covered = new Set();
  const probe = async ({ command, args, cwd, env: probeEnv }) => {
    try {
      return { ok: true, stdout: await runText(run, { executable: command, args, cwd, env: probeEnv, timeoutMs }) };
    } catch (error) {
      return { ok: false, code: error?.code ?? null, message: String(error?.message ?? error).slice(0, 500) };
    }
  };
  for (const manifest of sorted) {
    if (covered.has(manifest)) continue;
    const manifestDir = directoryOf(manifest);
    const cwd = path.join(snapshotRoot, manifestDir);

    const selection = selectionEnvironment(env, rustc.requested_path);
    const installation = await observeToolchainInstallation({ description: TOOLCHAIN_DESCRIPTIONS.rust,
      executable: rustc.requested_path, requiredRoles: ["cargo", "rustc"], source: "path", probe,
      probeContext: { cwd, env: { root: selection, describe: selection, version: selection }, timeoutMs } });
    const base = { indexer: SIDECAR_RUST_INDEXER, sysroot: null, locked: false, input_paths: [],
      dependency_population: null, dependency_mapping: null, refusal: null };
    if (installation.status !== "observed") {
      covered.add(manifest);
      projects.set(manifestDir, { ...base, key: `${SIDECAR_RUST_INDEXER}#${manifestDir}`, project: manifestDir,
        input_roots: [manifestDir], refusal: failure("scip_rust_toolchain_unavailable",
          `Rust toolchain selected for ${manifest} could not be observed: ${installation.message}; ${
            installation.correction ?? "install the selected toolchain"}`) });
      continue;
    }
    const sysroot = installation.root;
    const cargo = installation.executables.cargo;
    const cargoEnv = sidecarRustProcessEnvironment({ settings: { RUST_SYSROOT: sysroot, CARGO_HOME: cargoHome },
      privateRoot: path.dirname(snapshotRoot) });
    const refuse = (workspace, code, message) => {
      projects.set(workspace, { ...base, sysroot, key: `${SIDECAR_RUST_INDEXER}#${workspace}`,
        project: workspace, input_roots: [workspace], refusal: failure(code, message) });
    };
    let workspaceManifest;
    try {
      workspaceManifest = (await runText(run, { executable: cargo, cwd, env: cargoEnv, timeoutMs,
        args: ["locate-project", "--workspace", "--message-format", "plain", "--offline"] })).trim();
    } catch (error) {
      covered.add(manifest);
      refuse(manifestDir, "scip_rust_workspace_unresolved",
        `Cargo could not locate the workspace of ${manifest}: ${String(error?.message ?? error).slice(0, 500)}`);
      continue;
    }
    const workspaceRelative = relativeWithin(snapshotRoot, workspaceManifest);
    if (workspaceRelative === null) {
      covered.add(manifest);
      refuse(manifestDir, "scip_rust_workspace_uncontained",
        `${manifest} belongs to workspace ${workspaceManifest}, outside the committed tree`);
      continue;
    }
    const workspace = directoryOf(workspaceRelative);
    covered.add(manifest);
    covered.add(workspaceRelative);
    if (projects.has(workspace)) continue;
    const project = { ...base, sysroot, key: `${SIDECAR_RUST_INDEXER}#${workspace}`, project: workspace,
      input_roots: [workspace], input_paths: selectionPaths(workspace) };
    projects.set(workspace, project);

    if (!existsSync(path.join(sysroot, "bin", "rust-analyzer"))) continue;
    const outside = cargoConfigFiles(path.join(snapshotRoot, workspace), cargoHome)
      .filter(({ file, scope }) => scope !== "cargo_home" && relativeWithin(snapshotRoot, file) === null);
    if (outside.length > 0) {
      project.refusal = failure("scip_rust_config_unsupported", `Cargo configuration ${outside.map(({ file }) =>
        file).join(", ")} outside the committed tree and the selected Cargo home would apply to ${workspace}; ` +
        "move it into the repository or the selected CARGO_HOME");
      continue;
    }
    project.locked = existsSync(path.join(snapshotRoot, workspace, "Cargo.lock"));
    let metadata;
    try {
      metadata = JSON.parse(await runText(run, { executable: cargo, cwd: path.join(snapshotRoot, workspace),
        env: cargoEnv, timeoutMs, args: ["metadata", "--format-version=1", "--offline",
          ...(project.locked ? ["--locked"] : [])] }));
    } catch (error) {
      project.refusal = failure(error?.code === "scip_indexer_timeout" ? error.code
        : "scip_rust_dependencies_unavailable", `Cargo metadata for workspace ${workspace} failed offline with ` +
        `CARGO_HOME ${cargoHome}: ${String(error?.message ?? error).slice(0, 500)}; make the locked ` +
        "dependencies available in that Cargo home (downloads stay disabled), then prepare again");
      continue;
    }
    const population = new Set();
    const cargoHomeConfig = cargoConfigFiles(path.join(snapshotRoot, workspace), cargoHome)
      .find(({ scope }) => scope === "cargo_home");
    if (cargoHomeConfig) population.add(cargoHomeConfig.file);

    const members = new Set(metadata.workspace_members ?? []);
    for (const entry of metadata.packages ?? []) {
      const packageDir = path.dirname(String(entry.manifest_path));
      const contained = relativeWithin(snapshotRoot, packageDir);
      if (contained !== null) {
        project.input_roots.push(contained);
        if (members.has(entry.id)) covered.add(joinRelative(contained, "Cargo.toml"));
      } else if (entry.source === null || entry.source === undefined) {
        project.refusal ??= failure("scip_rust_path_dependency_uncontained",
          `workspace ${workspace} uses path package ${entry.name} at ${packageDir}, outside the committed tree`);
      } else population.add(packageDir);
    }
    project.dependency_population = [...population].sort();
    project.dependency_mapping = containedDependencyMapping(metadata, snapshotRoot);
  }
  return [...projects.values()].map((project) => Object.freeze({ ...project,
    input_roots: Object.freeze([...new Set(project.input_roots)].sort()),
    input_paths: Object.freeze(project.input_paths) }))
    .sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
}
