

import { mkdtempSync, existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync,
  rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { selectWorkingCopySource } from "../test-execution/source-selection.mjs";
import { processDiagnostic, runSetupProcess } from "./process.mjs";
import { TestRuntimeSetupError } from "./toolchains.mjs";

export const ATTEMPT_SCRATCH_ROOT = "/agent-validation-tmp";
export const DEPENDENCIES_MISSING = "test_runtime_dependencies_missing";
export const DEPENDENCY_SOURCE_UNSUPPORTED = "test_runtime_dependency_source_unsupported";

function fail(code, message, detail = {}) {
  throw new TestRuntimeSetupError(code, message, detail);
}

const SYSTEM_PATH = ["/usr/bin", "/bin"];

function pathWith(...directories) {
  return [...directories, ...SYSTEM_PATH].join(path.delimiter);
}

function absoluteOrNull(value) {
  return typeof value === "string" && path.isAbsolute(value) ? value : null;
}

function homeOf(env) {
  return absoluteOrNull(env.HOME) ?? os.homedir();
}

function readManifest(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    fail("test_runtime_manifest_invalid", `${file} is not valid JSON`, { manifest: file });
  }
}

function packageDeclaresDependencies(file) {
  const manifest = readManifest(file);

  const optionalPeers = new Set(Object.entries(manifest.peerDependenciesMeta ?? {})
    .filter(([, meta]) => meta?.optional === true).map(([name]) => name));
  return ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]
    .some((field) => Object.keys(manifest[field] ?? {}).some((name) =>
      field !== "peerDependencies" || !optionalPeers.has(name)));
}

function requiredPackages(file) {
  const manifest = readManifest(file);
  return ["dependencies", "devDependencies"].flatMap((field) => Object.keys(manifest[field] ?? {}));
}

const PYTHON_REQUIREMENT_FILES = Object.freeze(
  ["requirements.txt", "test-requirements.txt", "requirements-dev.txt"]);

function nodeModulesEntries(nodeModules) {
  const entries = [];
  for (const name of readdirSync(nodeModules).sort()) {
    if (name.startsWith(".")) continue;
    const absolute = path.join(nodeModules, name);
    if (name.startsWith("@") && lstatSync(absolute).isDirectory()) {
      for (const scoped of readdirSync(absolute).sort()) {
        entries.push({ name: `${name}/${scoped}`, absolute: path.join(absolute, scoped) });
      }
    } else {
      entries.push({ name, absolute });
    }
  }
  return entries;
}

function workspaceLinks(installRoot, members) {
  const nodeModules = path.join(installRoot, "node_modules");
  if (!existsSync(nodeModules)) return [];
  const links = [];
  for (const { name, absolute } of nodeModulesEntries(nodeModules)) {
    if (!lstatSync(absolute).isSymbolicLink()) continue;
    const target = readlinkSync(absolute);
    const resolved = path.resolve(path.dirname(absolute), target);
    const member = path.relative(installRoot, resolved).split(path.sep).join("/");
    if (path.isAbsolute(target) || !members.includes(member)) {
      fail("test_runtime_local_package_link_unsupported",
        `installed dependency ${name} links ${target}, which is not a declared workspace member`,
        { package: name, link_target: target, declared_members: members });
    }
    links.push(Object.freeze({ package: name, member }));
  }
  return links;
}

function dependenciesMissing(message, detail) {
  fail(DEPENDENCIES_MISSING, message, detail);
}

function requirementNames(files, projectDir) {
  const names = new Set();
  const seen = new Set();
  const visit = (file) => {
    const real = existsSync(file) ? realpathSync(file) : file;
    if (seen.has(real)) return;
    seen.add(real);
    for (const raw of readFileSync(file, "utf8").split(/\r?\n/u)) {
      const line = raw.replace(/(^|\s)#.*$/u, "").trim();
      if (line === "") continue;
      const include = /^(?:-r|--requirement)(?:\s+|=)(.+)$/u.exec(line);
      if (include) {
        const target = path.resolve(path.dirname(file), include[1].trim());
        if (target.startsWith(`${projectDir}${path.sep}`) && existsSync(target)) visit(target);
        continue;
      }
      if (line.startsWith("-")) continue;
      const name = /^([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)\s*(?:$|[[<>=!~;@ ])/u.exec(line)?.[1];
      if (name !== undefined) names.add(name);
    }
  };
  for (const file of files) visit(file);
  return [...names].sort();
}

const PYTHON_INSPECT_PROGRAM = [
  "import json, os, sys, sysconfig",
  "import importlib.metadata as metadata",
  "missing = []",
  "for name in json.loads(sys.argv[1]):",
  "    try:",
  "        metadata.distribution(name)",
  "    except metadata.PackageNotFoundError:",
  "        missing.append(name)",
  "paths = sysconfig.get_paths()",
  "site = sorted({os.path.realpath(paths[key]) for key in ('purelib', 'platlib')})",
  "print(json.dumps({'missing': missing, 'site': site, 'prefix': sys.prefix}))"
].join("\n");

function nearestVirtualEnvironment(repositoryRoot, projectDir, project) {
  for (let directory = projectDir; ; directory = path.dirname(directory)) {
    const found = [".venv", "venv"].map((name) => path.join(directory, name))
      .filter((candidate) => existsSync(path.join(candidate, "pyvenv.cfg")));
    if (found.length > 1) {
      fail("test_runtime_environment_ambiguous",
        `project ${project} has more than one virtual environment at ${directory}`,
        { project, candidates: found,
          correction: "remove or rename the virtual environment the project's tests do not use, then rerun setup" });
    }
    if (found.length === 1) return found[0];
    if (directory === repositoryRoot || path.dirname(directory) === directory) return null;
  }
}

function selectedVirtualEnvironment(selected, project) {
  if (!path.isAbsolute(selected) || !existsSync(path.join(selected, "pyvenv.cfg"))) {
    fail("test_runtime_environment_selection_invalid",
      `the virtual environment selected for project ${project} is not a virtual environment: ${selected}`,
      { project, virtual_environment: selected,
        correction: "select an existing virtual environment directory (one holding pyvenv.cfg) by its absolute path" });
  }
  return selected;
}

function parseGoModuleLines(text) {
  return text.split("\n").filter((line) => line.trim() !== "").map((line) => {
    const [modulePath, version, dir, goMod] = line.split("\t");
    return { path: modulePath, version, dir, goMod };
  });
}

function cargoLockPackages(lockFile) {
  const packages = [];
  for (const block of readFileSync(lockFile, "utf8").split(/^\[\[package\]\]\s*$/mu).slice(1)) {
    const field = (name) => new RegExp(`^${name}\\s*=\\s*"([^"]*)"\\s*$`, "mu").exec(block)?.[1] ?? null;
    const source = field("source");
    if (source !== null) packages.push({ name: field("name"), version: field("version"), source });
  }
  return packages;
}

function cargoIndexCacheRelative(name) {
  const lower = name.toLowerCase();
  if (lower.length <= 2) return path.join(String(lower.length), lower);
  if (lower.length === 3) return path.join("3", lower[0], lower);
  return path.join(lower.slice(0, 2), lower.slice(2, 4), lower);
}

function splitTomlKey(text) {
  return [...text.matchAll(/"([^"]*)"|'([^']*)'|([^.\s]+)/gu)].map((match) => match[1] ?? match[2] ?? match[3]);
}

function readCargoSourceConfig(file) {
  const values = {};
  let table = [];
  const assign = (keys, value) => {
    const [root, name, field] = keys;
    if (root === "source" && name !== undefined && field !== undefined && keys.length === 3) {
      values[`${name}\0${field}`] = value;
    }
  };
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/u)) {
    const line = raw.replace(/\s+#.*$/u, "").replace(/^#.*$/u, "").trim();
    if (line === "") continue;
    const header = /^\[([^\[\]]+)\]$/u.exec(line);
    if (header) { table = splitTomlKey(header[1]); continue; }
    const pair = /^([^=]+?)\s*=\s*(.+)$/u.exec(line);
    if (!pair) continue;
    const keys = [...table, ...splitTomlKey(pair[1])];
    const value = pair[2].trim();
    const string = /^"((?:[^"\\]|\\.)*)"$|^'([^']*)'$/u.exec(value);
    if (string) { assign(keys, string[1] ?? string[2]); continue; }
    const inline = /^\{(.*)\}$/u.exec(value);
    if (inline) {
      for (const entry of inline[1].matchAll(/([A-Za-z0-9_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu)) {
        assign([...keys, entry[1]], entry[2] ?? entry[3]);
      }
    }
  }
  return values;
}

function cargoConfigFiles(projectDir, cargoHome) {
  const files = [];
  for (let directory = projectDir; ; directory = path.dirname(directory)) {
    const found = ["config", "config.toml"].map((name) => path.join(directory, ".cargo", name)).find(existsSync);
    if (found !== undefined) files.push({ file: found, base: directory, scope: directory === projectDir
      ? "project" : "ancestor" });
    if (path.dirname(directory) === directory) break;
  }
  const home = ["config", "config.toml"].map((name) => path.join(cargoHome, name)).find(existsSync);
  if (home !== undefined && !files.some(({ file }) => file === home)) {
    files.push({ file: home, base: path.dirname(cargoHome), scope: "cargo_home" });
  }
  return files;
}

function effectiveCargoSources(projectDir, cargoHome) {
  const declared = new Map();
  for (const entry of cargoConfigFiles(projectDir, cargoHome)) {
    for (const [key, value] of Object.entries(readCargoSourceConfig(entry.file))) {
      if (!declared.has(key)) declared.set(key, { value, ...entry });
    }
  }
  const get = (name, field) => declared.get(`${name}\0${field}`) ?? null;
  const replaceWith = get("crates-io", "replace-with");
  if (replaceWith === null) return { replacement: null };
  const target = replaceWith.value;
  const fields = [...declared.entries()].filter(([key]) => key.startsWith(`${target}\0`))
    .map(([key, entry]) => ({ field: key.split("\0")[1], ...entry }));
  return { replacement: { name: target, declared: replaceWith, fields,
    directory: get(target, "directory") } };
}

function cargoLockedCrates(locked) {
  return locked.filter(({ source }) => source.startsWith("registry+") || source.startsWith("sparse+") ||
    source.startsWith("git+"));
}

function denoLockHasDependencies(lockFile) {
  let lock;
  try {
    lock = JSON.parse(readFileSync(lockFile, "utf8"));
  } catch {
    fail("test_runtime_manifest_invalid", `${lockFile} is not valid JSON`, { manifest: lockFile });
  }
  const count = (value) => Object.keys(value ?? {}).length;
  return count(lock.remote) + count(lock.jsr) + count(lock.npm) + count(lock.packages?.jsr) +
    count(lock.packages?.npm) > 0;
}

function detectCargoRegistry({ project, projectDir, cargoHome, locked }) {
  const registry = path.join(cargoHome, "registry");
  const indexes = existsSync(path.join(registry, "cache")) ? readdirSync(path.join(registry, "cache")).sort() : [];
  const population = [];
  const missing = [];
  for (const { name, version, source } of cargoLockedCrates(locked)) {
    if (source.startsWith("git+")) continue;
    const crate = `${name}-${version}`;
    const index = indexes.find((candidate) =>
      existsSync(path.join(registry, "cache", candidate, `${crate}.crate`)) &&
      existsSync(path.join(registry, "src", candidate, crate)));
    if (index === undefined) {
      missing.push(`${name}@${version}`);
      continue;
    }
    population.push(path.join(registry, "cache", index, `${crate}.crate`), path.join(registry, "src", index, crate));
    const indexCache = path.join(registry, "index", index, ".cache", cargoIndexCacheRelative(name));
    if (existsSync(indexCache)) population.push(indexCache);
  }
  const git = path.join(cargoHome, "git");
  const gitCrates = locked.filter(({ source }) => source.startsWith("git+"));
  if (gitCrates.length > 0 && !existsSync(git)) missing.push(...gitCrates.map(({ name, version }) => `${name}@${version}`));
  if (missing.length > 0) {
    dependenciesMissing(`project ${project} has locked crates that are not in the Cargo registry of ${cargoHome}: ` +
      missing.join(", "), { cargo_home: cargoHome, source: "cargo_home", missing,
      correction: `make the project's locked crates available (for example \`cargo fetch --locked\` in ${projectDir} ` +
        "with the CARGO_HOME setup sees, or configure the project's vendored sources), then rerun setup" });
  }
  if (gitCrates.length > 0) population.push(git);
  return { source: "cargo_home", dir: cargoHome, population: [...new Set(population)].sort(), exclude: [],
    stores: ["registry", ...(gitCrates.length > 0 ? ["git"] : [])] };
}

async function detectCargoVendor({ project, projectDir, cargoHome, locked, replacement }) {
  const unsupported = (message, detail) => fail(DEPENDENCY_SOURCE_UNSUPPORTED, message, { project,
    replacement: replacement.name, declared_in: replacement.declared.file, ...detail });
  const { directory } = replacement;
  if (directory === null) {
    unsupported(`project ${project} replaces crates.io with source ${replacement.name}, which is not a ` +
      "directory source", { fields: replacement.fields.map(({ field, value, file }) => ({ field, value, file })),
      supported: "a `directory` replacement (vendored sources) or no replacement (the CARGO_HOME registry)" });
  }
  const outside = [replacement.declared, directory].find(({ scope }) => scope === "ancestor");
  if (outside !== undefined) {
    unsupported(`the vendored source configuration of project ${project} is declared in ${outside.file}, ` +
      "outside the project and CARGO_HOME, where the confined command does not read it",
    { supported: "the project's own .cargo/config.toml or $CARGO_HOME/config.toml" });
  }
  const vendor = path.resolve(directory.base, directory.value);
  if (!path.isAbsolute(directory.value)) {

    const relative = path.relative(projectDir, vendor);
    const selection = relative.startsWith("..") || directory.scope !== "project" ? null
      : await selectWorkingCopySource(projectDir);
    if (selection === null || !selection.ok ||
        !selection.entries.some((entry) => (entry.path ?? entry) === relative ||
          String(entry.path ?? entry).startsWith(`${relative}/`))) {
      unsupported(`vendored directory ${directory.value} of project ${project} is relative and not part of the ` +
        "project's selected source", { vendor,
        supported: "an absolute vendored directory, or a relative one inside the project that Git selects" });
    }
  }
  const population = [];
  const missing = [];
  for (const { name, version } of cargoLockedCrates(locked)) {
    const crate = [`${name}-${version}`, name].map((entry) => path.join(vendor, entry))
      .find((candidate) => existsSync(path.join(candidate, ".cargo-checksum.json")));
    if (crate === undefined) missing.push(`${name}@${version}`);
    else population.push(crate);
  }
  if (missing.length > 0) {
    dependenciesMissing(`vendored sources ${vendor} of project ${project} lack locked crates: ${missing.join(", ")}`,
      { source: "cargo_vendor", vendor, declared_in: directory.file, missing,
        correction: `vendor the project's locked crates into ${vendor} (for example \`cargo vendor --locked\`), ` +
          "then rerun setup" });
  }
  return { source: "cargo_vendor", dir: vendor, population: [...new Set(population)].sort(), exclude: [],
    cargo_config: directory.scope === "cargo_home" || replacement.declared.scope === "cargo_home"
      ? path.join(cargoHome, path.basename(directory.scope === "cargo_home" ? directory.file
        : replacement.declared.file)) : null };
}

export const DEPENDENCY_ECOSYSTEMS = Object.freeze({
  npm: Object.freeze({
    name: "npm",
    toolchains: Object.freeze(["node"]),

    projectCommands: Object.freeze({}),

    manifests(projectDir, { members = [] } = {}) {
      const manifest = path.join(projectDir, "package.json");
      if (!existsSync(manifest)) return { status: "none", files: {} };
      const lock = path.join(projectDir, "package-lock.json");
      const memberFiles = Object.fromEntries(members
        .map((member) => [`${member}/package.json`, path.join(projectDir, member, "package.json")])
        .filter(([, file]) => existsSync(file)));
      if (members.length === 0 && !packageDeclaresDependencies(manifest)) {
        return { status: "none", files: { "package.json": manifest } };
      }
      if (!existsSync(lock)) return { status: "lock_missing", required: "package-lock.json" };
      return { status: "present",
        files: { "package.json": manifest, "package-lock.json": lock, ...memberFiles } };
    },

    async detect({ projectDir, project, members, inputs }) {
      const nodeModules = path.join(projectDir, "node_modules");
      const declared = [...new Set(Object.entries(inputs.files).filter(([name]) => name.endsWith("package.json"))
        .flatMap(([, file]) => requiredPackages(file)))].sort();
      const absent = existsSync(nodeModules) ? declared.filter((name) => {
        try { lstatSync(path.join(nodeModules, name)); return false; } catch { return true; }
      }) : declared;
      if (!existsSync(nodeModules) || absent.length > 0) {
        dependenciesMissing(`project ${project} has no installed ${existsSync(nodeModules)
          ? `${absent.join(", ")} in its node_modules` : "node_modules"}`,
        { dependency_root: nodeModules, missing: absent,
          correction: `install the project's locked dependencies (for example \`npm ci\` in ${projectDir}), ` +
            "then rerun setup" });
      }
      const nested = members.filter((member) => existsSync(path.join(projectDir, member, "node_modules")));
      if (nested.length > 0) {
        fail("test_runtime_workspace_layout_unsupported",
          "workspace members hold member-private node_modules that the shared workspace installation does not bind",
          { members: nested, dependency_root: nodeModules });
      }

      const installed = realpathSync(nodeModules);
      return { source: "project_node_modules", dir: installed, population: [installed],
        exclude: [".cache", ".vite"], workspace_links: workspaceLinks(projectDir, members) };
    },

    runtimeBinding({ dependency, projectHostDir }) {
      if (dependency.status !== "present") return { binds: [], mountpoints: [], links: [], env: {}, values: {} };

      let existing = null;
      try { existing = realpathSync(path.join(projectHostDir, "node_modules")); } catch { existing = null; }
      if (existing === dependency.dir) {
        return { binds: [{ src: dependency.dir, dst: dependency.dir }], mountpoints: [], links: [], env: {},
          values: { node_modules_source: dependency.dir, node_modules: path.join(projectHostDir, "node_modules") } };
      }
      return {
        binds: [{ src: dependency.dir, dst: path.join(projectHostDir, "node_modules") }],
        mountpoints: [path.join(projectHostDir, "node_modules")],
        links: [],
        env: {},
        values: { node_modules_source: dependency.dir, node_modules: path.join(projectHostDir, "node_modules") }
      };
    },

    workingCopyBinding({ dependency, workProjectDir }) {
      const installed = dependency.dir;
      const values = { node_modules_source: installed, node_modules: installed };
      const binds = [{ src: installed, dst: installed }];
      const workModules = path.join(workProjectDir, "node_modules");
      const linked = dependency.workspace_links ?? [];
      if (linked.length === 0) {
        return { binds, mountpoints: [], directories: [],
          links: [{ path: workModules, target: installed }], env: {}, values };
      }
      const members = new Map(linked.map(({ package: name, member }) => [name, member]));
      const entries = nodeModulesEntries(installed);
      const scopes = [...new Set(entries.map(({ name }) => name.includes("/") ? name.split("/")[0] : null)
        .filter(Boolean))];
      return {
        binds,
        mountpoints: [],
        directories: [workModules, ...scopes.map((scope) => path.join(workModules, scope))],
        links: entries.map(({ name, absolute }) => ({ path: path.join(workModules, name),
          target: members.has(name) ? path.join(workProjectDir, members.get(name)) : absolute })),
        env: {},
        values
      };
    }
  }),
  deno: Object.freeze({
    name: "deno",
    toolchains: Object.freeze(["deno"]),
    projectCommands: Object.freeze({ deno: Object.freeze({}) }),
    manifests(projectDir) {
      const config = ["deno.json", "deno.jsonc"].find((name) => existsSync(path.join(projectDir, name)));
      if (!config) return { status: "none", files: {} };
      const lock = path.join(projectDir, "deno.lock");
      if (!existsSync(lock)) return { status: "lock_missing", required: "deno.lock" };
      return { status: "present", files: { [config]: path.join(projectDir, config), "deno.lock": lock } };
    },

    async detect({ project, projectDir, inputs, toolchains, env }) {
      if (!denoLockHasDependencies(inputs.files["deno.lock"])) return { none: true };

      const deno = toolchains.deno.executables.deno;
      const described = await runSetupProcess(deno, ["info", "--json"], { cwd: projectDir,
        env: { PATH: pathWith(), HOME: homeOf(env), NO_COLOR: "1", DENO_NO_UPDATE_CHECK: "1",
          ...Object.fromEntries(["DENO_DIR", "XDG_CACHE_HOME"].filter((name) => typeof env[name] === "string")
            .map((name) => [name, env[name]])) }, timeoutMs: 60000 });
      let denoDir = null;
      try { denoDir = described.ok ? JSON.parse(described.stdout).denoDir ?? null : null; } catch { denoDir = null; }
      if (absoluteOrNull(denoDir) === null) {
        fail("test_runtime_environment_unusable", `deno at ${deno} did not report its cache directory`,
          { project, diagnostic: processDiagnostic(described) });
      }
      const population = ["remote", "npm"].map((name) => path.join(denoDir, name)).filter(existsSync);
      if (population.length === 0) {
        dependenciesMissing(`project ${project} has no cached Deno dependencies in ${denoDir}`,
          { dependency_root: denoDir,
            correction: `cache the project's locked dependencies (for example \`deno install --frozen\` in ${projectDir}) ` +
              `with DENO_DIR ${denoDir}, or point DENO_DIR at the existing cache, then rerun setup` });
      }
      return { source: "deno_dir", dir: denoDir, population, exclude: [] };
    },
    runtimeBinding({ dependency, scratchRoot = ATTEMPT_SCRATCH_ROOT }) {
      const common = { DENO_NO_UPDATE_CHECK: "1", NO_COLOR: "1" };
      if (dependency.status !== "present") {
        return { binds: [], mountpoints: [], links: [],
          env: { DENO_DIR: `${scratchRoot}/deno-dir`, ...common }, values: {} };
      }
      return {
        binds: [{ src: dependency.dir, dst: dependency.dir }],
        mountpoints: [],
        links: [],
        env: { DENO_DIR: dependency.dir, ...common },
        values: { deno_dir: dependency.dir }
      };
    }
  }),
  python: Object.freeze({
    name: "python",
    toolchains: Object.freeze(["python"]),

    projectCommands: Object.freeze({ python: Object.freeze({ executableValue: "python" }) }),
    manifests(projectDir) {
      const files = Object.fromEntries(PYTHON_REQUIREMENT_FILES
        .filter((name) => existsSync(path.join(projectDir, name)))
        .map((name) => [name, path.join(projectDir, name)]));
      return Object.keys(files).length === 0
        ? { status: "lock_missing", required: PYTHON_REQUIREMENT_FILES.join(" or ") }
        : { status: "present", files };
    },

    async detect({ repositoryRoot, projectDir, project, inputs, toolchains, selection = null }) {
      const interpreter = toolchains.python.executables.python;

      const venv = selection?.virtual_environment !== undefined
        ? selectedVirtualEnvironment(selection.virtual_environment, project)
        : nearestVirtualEnvironment(repositoryRoot, projectDir, project);
      let python = interpreter;
      if (venv !== null) {
        python = path.join(venv, "bin", "python");
        let base = null;
        try { base = realpathSync(python); } catch { base = null; }
        if (base !== interpreter) {
          fail("test_runtime_environment_interpreter_mismatch",
            `virtual environment ${venv} of project ${project} does not run the detected python ${interpreter}`,
            { project, virtual_environment: venv, environment_interpreter: base, detected_interpreter: interpreter,
              correction: base === null ? `repair ${venv} (its bin/python does not resolve)`
                : `rerun setup with --executable python=${base}, or recreate ${venv} from ${interpreter}` });
        }
      }
      const names = requirementNames(Object.values(inputs.files), projectDir);

      const inspected = await runSetupProcess(python, ["-I", "-B", "-c", PYTHON_INSPECT_PROGRAM,
        JSON.stringify(names)], { env: { PATH: pathWith(), PYTHONDONTWRITEBYTECODE: "1" }, timeoutMs: 60000 });
      let report = null;
      try { report = inspected.ok ? JSON.parse(inspected.stdout) : null; } catch { report = null; }
      if (report === null) {
        fail("test_runtime_environment_unusable", `python environment ${venv ?? interpreter} could not be inspected`,
          { project, environment: venv ?? interpreter, diagnostic: processDiagnostic(inspected) });
      }
      if (report.missing.length > 0) {
        dependenciesMissing(`python environment ${venv ?? interpreter} of project ${project} lacks ` +
          report.missing.join(", "), { project, environment: venv ?? interpreter, missing: report.missing,
          requirements: Object.keys(inputs.files).sort(),
          correction: venv !== null
            ? `install the project's requirements into ${venv} (for example \`${python} -m pip install ` +
              `${Object.keys(inputs.files).sort().map((name) => `-r ${name}`).join(" ")}\` in ${projectDir}), then rerun setup`
            : `create the project's virtual environment at ${path.join(projectDir, ".venv")} from ${interpreter} ` +
              "and install its requirements there, then rerun setup" });
      }
      if (venv !== null) {
        return { source: selection?.virtual_environment !== undefined ? "selected_virtual_environment"
          : "virtual_environment", dir: venv, population: [venv], exclude: ["__pycache__"] };
      }
      return { source: "interpreter", dir: null, population: report.site.filter(existsSync),
        exclude: ["__pycache__"] };
    },
    runtimeBinding({ dependency }) {
      const env = { PYTHONDONTWRITEBYTECODE: "1", PYTHONNOUSERSITE: "1" };
      if (dependency.status !== "present") return { binds: [], mountpoints: [], links: [], env, values: {} };
      if (dependency.dir === null) {
        return { binds: dependency.population.map((root) => ({ src: root, dst: root })), mountpoints: [],
          links: [], env, values: {} };
      }
      return {
        binds: [{ src: dependency.dir, dst: dependency.dir }],
        mountpoints: [],
        links: [],
        env,
        values: { python: path.join(dependency.dir, "bin", "python"), venv: dependency.dir }
      };
    }
  }),
  go_modules: Object.freeze({
    name: "go_modules",
    toolchains: Object.freeze(["go"]),

    projectCommands: Object.freeze({ go: Object.freeze({}) }),
    manifests(projectDir) {
      const mod = path.join(projectDir, "go.mod");
      if (!existsSync(mod)) return { status: "lock_missing", required: "go.mod" };
      const sum = path.join(projectDir, "go.sum");
      return { status: "present",
        files: { "go.mod": mod, ...(existsSync(sum) ? { "go.sum": sum } : {}) } };
    },

    async detect({ project, projectDir, toolchains, env }) {
      const go = toolchains.go.executables.go;
      const operatorEnv = Object.fromEntries(["HOME", "GOPATH", "GOMODCACHE", "GOENV", "XDG_CONFIG_HOME"]
        .filter((name) => typeof env[name] === "string").map((name) => [name, env[name]]));
      const located = await runSetupProcess(go, ["env", "GOMODCACHE"], { cwd: projectDir,
        env: { PATH: pathWith(path.dirname(go)), HOME: homeOf(env), ...operatorEnv, GOTOOLCHAIN: "local",
          GOTELEMETRY: "off" }, timeoutMs: 60000 });
      const cache = located.ok ? located.stdout.trim() : "";
      const correction = `download the module's dependencies (for example \`go mod download\` in ${projectDir}) ` +
        "into the module cache setup sees, then rerun setup";

      if (!path.isAbsolute(cache)) {
        dependenciesMissing(`project ${project} has no Go module cache${cache ? ` at ${cache}` : ""}`,
          { module_cache: cache || null, diagnostic: located.ok ? null : processDiagnostic(located), correction });
      }
      const scratch = mkdtempSync(path.join(os.tmpdir(), "agent-chassis-go-detect-"));
      try {
        const listed = await runSetupProcess(go, ["list", "-m", "-f",
          "{{if not .Main}}{{.Path}}\t{{.Version}}\t{{.Dir}}\t{{.GoMod}}{{end}}", "all"], { cwd: projectDir,
          env: { PATH: pathWith(path.dirname(go)), HOME: path.join(scratch, "home"), GOMODCACHE: cache,
            GOPROXY: "off", GOFLAGS: "-mod=readonly", GOWORK: "off", GOTOOLCHAIN: "local", GOTELEMETRY: "off",
            GOENV: "off", GOSUMDB: "off", GOCACHE: path.join(scratch, "gocache"),
            GOPATH: path.join(scratch, "gopath") }, timeoutMs: 120000 });
        if (!listed.ok) {
          dependenciesMissing(`the module graph of project ${project} does not resolve from ${cache}`,
            { module_cache: cache, diagnostic: processDiagnostic(listed), correction });
        }
        const within = (candidate) => typeof candidate === "string" && candidate.startsWith(`${cache}${path.sep}`);
        const population = [...new Set(parseGoModuleLines(listed.stdout).flatMap(({ dir, goMod }) =>
          [within(dir) && existsSync(dir) ? dir : null, within(goMod) ? path.dirname(goMod) : null])
          .filter(Boolean))].sort();
        if (population.length === 0) return { none: true };
        return { source: "module_cache", dir: cache, population, exclude: [] };
      } finally {

        try { rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch {   }
      }
    },
    runtimeBinding({ dependency, scratchRoot = ATTEMPT_SCRATCH_ROOT }) {
      const present = dependency.status === "present";
      return {
        binds: present ? [{ src: dependency.dir, dst: dependency.dir }] : [],
        mountpoints: [],
        links: [],
        env: { GOMODCACHE: present ? dependency.dir : `${scratchRoot}/gomodcache`, GOPROXY: "off",
          GOFLAGS: "-mod=readonly", GOTOOLCHAIN: "local", GOTELEMETRY: "off", GOENV: "off", GOSUMDB: "off",
          GOWORK: "off", GOCACHE: `${scratchRoot}/go-build`, GOPATH: `${scratchRoot}/gopath` },
        values: {}
      };
    }
  }),
  cargo: Object.freeze({
    name: "cargo",
    toolchains: Object.freeze(["rust"]),

    projectCommands: Object.freeze({ cargo: Object.freeze({}) }),

    toolchainEnv: (toolchains) => ({ RUSTC: toolchains.rust.executables.rustc,
      RUSTDOC: path.join(path.dirname(toolchains.rust.executables.rustc), "rustdoc") }),

    manifests(projectDir, { members = [] } = {}) {
      const manifest = path.join(projectDir, "Cargo.toml");
      if (!existsSync(manifest)) return { status: "lock_missing", required: "Cargo.toml" };
      const lock = path.join(projectDir, "Cargo.lock");
      if (!existsSync(lock)) return { status: "lock_missing", required: "Cargo.lock" };
      const memberFiles = Object.fromEntries(members
        .map((member) => [`${member}/Cargo.toml`, path.join(projectDir, member, "Cargo.toml")])
        .filter(([, file]) => existsSync(file)));
      return { status: "present", files: { "Cargo.toml": manifest, "Cargo.lock": lock, ...memberFiles } };
    },

    async detect({ project, projectDir, inputs, env }) {
      const cargoHome = absoluteOrNull(env.CARGO_HOME) ?? path.join(homeOf(env), ".cargo");
      const locked = cargoLockPackages(inputs.files["Cargo.lock"]);
      if (cargoLockedCrates(locked).length === 0) return { none: true };
      const { replacement } = effectiveCargoSources(projectDir, cargoHome);
      if (replacement !== null) return detectCargoVendor({ project, projectDir, cargoHome, locked, replacement });
      return detectCargoRegistry({ project, projectDir, cargoHome, locked });
    },
    runtimeBinding({ dependency, scratchRoot = ATTEMPT_SCRATCH_ROOT }) {
      const present = dependency.status === "present";
      const offline = { CARGO_TARGET_DIR: `${scratchRoot}/cargo-target`, CARGO_NET_OFFLINE: "true",
        CARGO_TERM_COLOR: "never" };
      if (!present) {
        return { binds: [], mountpoints: [], links: [], env: { CARGO_HOME: `${scratchRoot}/cargo-home`, ...offline },
          values: {} };
      }
      if (dependency.source === "cargo_vendor") {

        const binds = [{ src: dependency.dir, dst: dependency.dir },
          ...(dependency.cargo_config === null ? [] : [{ src: dependency.cargo_config, dst: dependency.cargo_config }])];
        return { binds, mountpoints: [], links: [], env: { CARGO_HOME: dependency.cargo_config === null
          ? `${scratchRoot}/cargo-home` : path.dirname(dependency.cargo_config), ...offline }, values: {} };
      }
      const stores = dependency.stores ?? ["registry"];
      return {
        binds: stores.map((store) => path.join(dependency.dir, store)).map((src) => ({ src, dst: src })),
        mountpoints: [],
        links: [],
        env: { CARGO_HOME: dependency.dir, ...offline },
        values: {}
      };
    }
  })
});
