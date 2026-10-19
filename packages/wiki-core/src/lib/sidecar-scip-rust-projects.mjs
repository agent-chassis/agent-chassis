

import { prepareSidecarCargoScratch } from "./sidecar-scip-cargo-scratch.mjs";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseToml } from "smol-toml";

import {
  CARGO_OFFLINE_ENV,
  cargoConfigurationInputs,
  cargoConfigFiles,
  cargoHomeFromEnvironment,
  cargoToolchainEnv,
  observeCargoOptionalAbsences
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

export function sidecarRustEnvironmentSettings(env, record = null) {

  const optionalAbsent = record ? {
    configuration_optional_absent: typeof record.settings?.configuration_optional_absent !== "string" ? null
      : JSON.stringify(observeCargoOptionalAbsences(JSON.parse(record.settings.configuration_optional_absent)))
  } : {};
  return { CARGO_HOME: cargoHomeFromEnvironment(env), RUSTUP_HOME: env.RUSTUP_HOME ?? null,
    RUSTUP_TOOLCHAIN: env.RUSTUP_TOOLCHAIN ?? null, ...optionalAbsent };
}

export function sidecarRustSettings(project) {
  return { RUST_SYSROOT: project.sysroot ?? null, features: "default", target: "host",
    CARGO_NET_OFFLINE: CARGO_OFFLINE_ENV.CARGO_NET_OFFLINE, locked: project.locked ? "true" : "false",
    dependency_mapping: sidecarRustDependencyMappingDigest(project.dependency_mapping ?? null),
    configuration_missing: JSON.stringify(project.configuration?.missing ?? []),
    configuration_optional_absent: JSON.stringify(project.configuration?.optional_absent ?? []) };
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

function absentRustupSelection({ rustc, env, cwd }) {
  const rustup = observeExecutable({ command: "rustup", searchPath: env.PATH });
  if (rustup.status !== "found" || rustup.resolved_path !== rustc.resolved_path) return null;
  const home = rustupHomeFromEnvironment(env);
  const read = file => {
    try { return readFileSync(file, "utf8"); }
    catch (error) {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
      throw error;
    }
  };
  const settingsText = read(path.join(home, "settings.toml"));
  const settings = settingsText === null ? {} : parseToml(settingsText);
  let selected = env.RUSTUP_TOOLCHAIN;
  for (let directory = cwd; !selected; directory = path.dirname(directory)) {
    selected = settings.overrides?.[directory];
    if (!selected) {
      const plain = read(path.join(directory, "rust-toolchain"));
      const toml = plain === null ? read(path.join(directory, "rust-toolchain.toml")) : null;
      if (plain !== null) selected = plain.trim().startsWith("[") ? parseToml(plain).toolchain?.channel : plain.trim();
      else if (toml !== null) selected = parseToml(toml).toolchain?.channel;
    }
    if (directory === path.dirname(directory)) break;
  }
  selected ||= settings.default_toolchain;
  if (typeof selected !== "string" || !/^[\w.+-]+$/u.test(selected)) return null;
  let installed;
  try { installed = readdirSync(path.join(home, "toolchains")); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    installed = [];
  }
  const official = /^(?:stable|beta|nightly)(?:-\d{4}-\d{2}-\d{2})?$|^\d+\.\d+(?:\.\d+)?$/u.test(selected);
  return installed.some(name => name === selected || (official && name.startsWith(`${selected}-`))) ? null : selected;
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

function parseCargoMetadata(text) {
  const metadata = JSON.parse(text);
  if (!metadata || Array.isArray(metadata) || metadata.version !== 1 ||
      typeof metadata.workspace_root !== "string" || !path.isAbsolute(metadata.workspace_root) ||
      !Array.isArray(metadata.workspace_members) || metadata.workspace_members.some(id => typeof id !== "string") ||
      !Array.isArray(metadata.packages) || metadata.packages.some(entry => !entry ||
        typeof entry.id !== "string" || typeof entry.name !== "string" ||
        typeof entry.manifest_path !== "string" || !path.isAbsolute(entry.manifest_path) ||
        !Array.isArray(entry.targets) || entry.targets.some(target => !target || !Array.isArray(target.kind) ||
          typeof target.src_path !== "string")) ||
      (metadata.resolve !== null && (!metadata.resolve || !Array.isArray(metadata.resolve.nodes) ||
        metadata.resolve.nodes.some(node => !node || typeof node.id !== "string" || !Array.isArray(node.deps) ||
          node.deps.some(dep => !dep || typeof dep.name !== "string" || typeof dep.pkg !== "string"))))) {
    throw new TypeError("Cargo metadata lacks valid workspace, package, target or resolution facts");
  }
  return metadata;
}

export async function describeSidecarRustProjects({ checkoutRoot, privateRoot, manifests, env, run, timeoutMs }) {
  const sorted = [...manifests].sort((left, right) =>
    left.split("/").length - right.split("/").length || (left < right ? -1 : left > right ? 1 : 0));
  if (sorted.length === 0) return [];
  const rustc = observeExecutable({ command: "rustc", searchPath: env.PATH });
  if (rustc.status !== "found") return inactiveProjects(sorted);
  if (typeof checkoutRoot !== "string") throw new TypeError("Rust description requires checkoutRoot");

  checkoutRoot = realpathSync(checkoutRoot);
  const configurations = new Map(sorted.map((manifest) => [manifest, cargoConfigurationInputs({ checkoutRoot,
    projectDir: path.join(checkoutRoot, directoryOf(manifest)), cargoHome: cargoHomeFromEnvironment(env) })]));
  const configurationFiles = [...new Set([...configurations.values()].flatMap(({ files }) => files
    .filter(({ file, scope }) => scope !== "cargo_home" && relativeWithin(checkoutRoot, file) !== null)
    .map(({ file }) => file)))];
  const scratch = await prepareSidecarCargoScratch({ checkoutRoot, privateRoot, manifests, configurationFiles });
  return describeWorkspaces({ snapshotRoot: scratch, checkoutRoot, privateRoot, sorted,
    env, run, timeoutMs, rustc, configurations });
}

async function describeWorkspaces({ snapshotRoot, checkoutRoot, privateRoot, sorted, env, run, timeoutMs, rustc, configurations }) {
  const cargoHome = cargoHomeFromEnvironment(env);
  const projects = new Map();
  const covered = new Set();
  const probe = async ({ command, args, cwd, env: probeEnv }) => {
    try {
      return { ok: true, stdout: await runText(run, { executable: command, args, cwd, env: probeEnv, timeoutMs }) };
    } catch (error) {
      return { ok: false, code: error?.code ?? null, message: String(error?.message ?? error).slice(0, 500), cause: error };
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
      dependency_population: null, dependency_mapping: null, dependency_limitation: null, refusal: null };
    if (installation.status !== "observed") {
      covered.add(manifest);
      const cause = installation.result?.cause;
      const diagnostic = cause?.message ?? installation.message;
      let missing = null;
      let secondary = null;
      if (cause?.code === "scip_indexer_exit_failed" && cause.exit?.code === 1 && cause.exit.signal === null) {
        try { missing = absentRustupSelection({ rustc, env, cwd }); }
        catch (error) { secondary = error; }
      }
      const unavailable = missing !== null || installation.code === "runtime_input_installation_components_missing";
      const message = `Rust toolchain selected for ${manifest} could not be observed: ${diagnostic}` +
        (missing ? `; selected rustup toolchain ${missing} is not installed; restore it and explicitly build again` : "") +
        (secondary ? `; availability observation also failed: ${secondary.message}` : "");
      projects.set(manifestDir, { ...base, key: `${SIDECAR_RUST_INDEXER}#${manifestDir}`, project: manifestDir,
        membership: "unobserved", input_roots: [manifestDir], input_paths: selectionPaths(manifestDir),
        ...(unavailable ? { configuration_unavailable: {
          dependency_limitation: failure("scip_rust_toolchain_unavailable", message), provider_failure: diagnostic }
        } : { refusal: failure(secondary?.code ?? cause?.code ?? installation.code, message) }) });
      continue;
    }
    const sysroot = installation.root;
    const cargo = installation.executables.cargo;
    const cargoEnv = sidecarRustProcessEnvironment({ settings: { RUST_SYSROOT: sysroot, CARGO_HOME: cargoHome },
      privateRoot });
    const refuse = (workspace, code, message) => {
      projects.set(workspace, { ...base, sysroot, key: `${SIDECAR_RUST_INDEXER}#${workspace}`,
        project: workspace, input_roots: [workspace], refusal: failure(code, message) });
    };
    const configuration = configurations.get(manifest);
    if (configuration.refusal || configuration.missing.length > 0) {
      covered.add(manifest);
      const dependency_limitation = configuration.missing.length > 0 ? failure("scip_rust_config_input_unavailable",
        `${manifest} requires missing Cargo configuration: ${configuration.missing.map(({ config, target }) =>
          `${config} includes ${target}`).join("; ")}; restore the input, then explicitly build again`) : null;
      projects.set(manifestDir, { ...base, sysroot, key: `${SIDECAR_RUST_INDEXER}#${manifestDir}`, project: manifestDir,
        membership: "unobserved", input_roots: [manifestDir], configuration,
        dependency_population: [...new Set(configuration.files.flatMap(({ file, resolved }) => [file, resolved]))].sort(),
        refusal: configuration.refusal,
        ...(dependency_limitation ? { configuration_unavailable: { dependency_limitation,
          provider_failure: `Cargo configuration observation for ${manifest} found a required absent include; workspace discovery and indexing were not run` } } : {}) });
      continue;
    }
    let workspaceManifest;
    try {
      workspaceManifest = (await runText(run, { executable: cargo, cwd, env: cargoEnv, timeoutMs,
        args: ["locate-project", "--workspace", "--message-format", "plain", "--offline"] })).trim();
    } catch (error) {
      covered.add(manifest);
      const message = `Cargo could not locate the workspace of ${manifest}: ${String(error?.message ?? error).slice(0, 500)}`;
      if (error.code === "scip_indexer_exit_failed" && error.exit?.code === 101 && error.exit.signal === null) {
        projects.set(manifestDir, { ...base, sysroot, key: `${SIDECAR_RUST_INDEXER}#${manifestDir}`,
          project: manifestDir, membership: "unobserved", input_roots: [manifestDir],
          input_paths: selectionPaths(manifestDir), configuration,
          configuration_unavailable: { dependency_limitation: failure("scip_rust_workspace_unresolved", message),
            provider_failure: message } });
      } else refuse(manifestDir, error.code ?? "scip_rust_workspace_probe_failed", message);
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
      configuration, input_roots: [workspace], input_paths: selectionPaths(workspace) };
    projects.set(workspace, project);

    if (!existsSync(path.join(sysroot, "bin", "rust-analyzer"))) continue;
    const outside = cargoConfigFiles(path.join(checkoutRoot, workspace), cargoHome)
      .filter(({ file, scope }) => scope !== "cargo_home" && relativeWithin(checkoutRoot, file) === null);
    if (outside.length > 0) {
      project.refusal = failure("scip_rust_config_unsupported", `Cargo configuration ${outside.map(({ file }) =>
        file).join(", ")} outside the committed tree and the selected Cargo home would apply to ${workspace}; ` +
        "move it into the repository or the selected CARGO_HOME");
      continue;
    }
    project.locked = existsSync(path.join(snapshotRoot, workspace, "Cargo.lock"));
    const metadataRequest = (extra) => ({ executable: cargo, cwd: path.join(snapshotRoot, workspace),
      env: cargoEnv, timeoutMs, args: ["metadata", "--format-version=1", "--offline", ...extra] });

    const cargoRefused = (error) => error?.code === "scip_indexer_exit_failed" &&
      Number.isInteger(error.exit?.code) && error.exit.signal === null;
    const reason = (error) => String(error?.message ?? error).slice(0, 170);
    let metadataText;
    try {
      metadataText = await runText(run, metadataRequest(project.locked ? ["--locked"] : []));
    } catch (error) {
      if (!cargoRefused(error)) {
        project.refusal = failure(error?.code ?? "scip_rust_metadata_failed",
          `Cargo metadata for workspace ${workspace} did not complete: ${reason(error)}`);
        continue;
      }

      const lockPath = path.join(snapshotRoot, workspace, "Cargo.lock");
      let lockless = error;
      if (project.locked) {
        renameSync(lockPath, `${lockPath}.aside`);
        try { await runText(run, metadataRequest([])); lockless = null; }
        catch (inner) { lockless = inner; }
        finally { rmSync(lockPath, { force: true }); renameSync(`${lockPath}.aside`, lockPath); }
        if (lockless === null) {
          project.refusal = failure("scip_rust_lockfile_unusable", `Cargo resolves workspace ${workspace} offline ` +
            `without its Cargo.lock but not with it: ${reason(error)}`);
          continue;
        }
        if (!cargoRefused(lockless)) {
          project.refusal = failure(lockless?.code ?? "scip_rust_metadata_failed",
            `Cargo metadata for workspace ${workspace} failed: ${reason(error)}; lockless probe did not complete: ${reason(lockless)}`);
          continue;
        }
      }

      let unresolved = null;
      try {
        const text = await runText(run, metadataRequest(["--no-deps"]));
        try { parseCargoMetadata(text); }
        catch (cause) { throw Object.assign(cause, { code: "scip_rust_metadata_malformed" }); }
      } catch (inner) {
        unresolved = inner;
      }
      if (unresolved === null) {

        project.dependency_limitation = failure("scip_rust_dependencies_unavailable",
          `Cargo metadata for workspace ${workspace} failed offline with ` +
          `CARGO_HOME ${cargoHome}: ${reason(lockless)}; make the locked ` +
          "dependencies available in that Cargo home (downloads stay disabled), then prepare again");
      } else {
        project.refusal = failure(cargoRefused(unresolved) ? "scip_rust_metadata_failed"
          : unresolved?.code ?? "scip_rust_metadata_failed",
        `Cargo metadata for workspace ${workspace} failed: ${reason(lockless)}; ` +
          `failed without resolving any dependency: ${reason(unresolved)}`);
      }
      continue;
    }
    let metadata;
    try {
      metadata = parseCargoMetadata(metadataText);
    } catch (error) {
      project.refusal = failure("scip_rust_metadata_malformed",
        `Cargo metadata for workspace ${workspace} is not the JSON Cargo documents: ${reason(error)}`);
      continue;
    }
    const population = new Set(configuration.files.flatMap(({ file, resolved }) => [file, resolved]));

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
