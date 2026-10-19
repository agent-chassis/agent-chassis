

import { createHash } from "node:crypto";
import { mkdtempSync, existsSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { CARGO_OFFLINE_ENV, cargoConfigFiles, cargoHomeFromEnvironment, cargoToolchainEnv } from
  "@agent-chassis/wiki-core/src/lib/runtime-inputs/ecosystem-inputs-cargo.mjs";
import { GO_OFFLINE_MODULE_ENV, goModuleCachePopulation } from
  "@agent-chassis/wiki-core/src/lib/runtime-inputs/ecosystem-inputs-go.mjs";

import { selectWorkingCopySource } from "../test-execution/source-selection.mjs";
import { denoConfigName, denoLockSelection } from "./deno-config.mjs";
import { PYTHON_PACKAGING_FILES, PYTHON_PROJECT_FILE, PYTHON_REQUIREMENT_FILES, distinctRequirementDeclarations,
  pyprojectRequirements, requirementDeclaration, splitTomlKey } from "./discovery.mjs";
import { GO_WORKSPACE_REFERENCE_REASONS, selectGoWorkspace } from "./go-workspace.mjs";
import { projectDependencyLocationEnvironment } from "./location-environment.mjs";
import { DEPENDENCIES_MISSING, NPM_ECOSYSTEM } from "./npm-installation.mjs";
import { processDiagnostic, runSetupProcess } from "./process.mjs";
import { TestRuntimeSetupError } from "./toolchains.mjs";

export const ATTEMPT_SCRATCH_ROOT = "/agent-validation-tmp";
export { DEPENDENCIES_MISSING };
export const DEPENDENCY_SOURCE_UNSUPPORTED = "test_runtime_dependency_source_unsupported";
export const GO_WORKSPACE_INVALID = "test_runtime_go_workspace_invalid";

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

function dependenciesMissing(message, detail) {
  fail(DEPENDENCIES_MISSING, message, detail);
}

function fileRequirements(files, projectDir) {
  const declarations = [];
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
      const declaration = requirementDeclaration(line.replace(/\s+(?:--[a-z][a-z-]*(?:[=\s].*)?|\\)$/u, ""));
      if (declaration !== null) declarations.push(declaration);
    }
  };
  for (const file of files) visit(file);
  return distinctRequirementDeclarations(declarations);
}

const PYTHON_INSPECT_PROGRAM = [
  "import importlib, json, os, sys, sysconfig",
  "import importlib.metadata as metadata",
  "def evaluator():",
  "    for module in ('packaging.requirements', 'pip._vendor.packaging.requirements'):",
  "        try:",
  "            return importlib.import_module(module).Requirement",
  "        except Exception:",
  "            continue",
  "    return None",
  "missing, invalid, unevaluated, parse = [], [], [], False",
  "for declared in json.loads(sys.argv[1]):",
  "    name, requirement = declared['name'], declared['requirement']",
  "    try:",
  "        metadata.distribution(name)",
  "        continue",
  "    except metadata.PackageNotFoundError:",
  "        pass",
  "    if ';' in requirement:",
  "        parse = evaluator() if parse is False else parse",
  "        if parse is None:",
  "            unevaluated.append(declared)",
  "            continue",
  "        try:",
  "            marker = parse(requirement).marker",
  "            applies = marker is None or bool(marker.evaluate())",
  "        except Exception as error:",
  "            invalid.append({'requirement': requirement, 'error': f'{type(error).__name__}: {error}'})",
  "            continue",
  "        if not applies:",
  "            continue",
  "    if name not in missing:",
  "        missing.append(name)",
  "paths = sysconfig.get_paths()",
  "site = sorted({os.path.realpath(paths[key]) for key in ('purelib', 'platlib')})",
  "print(json.dumps({'missing': missing, 'invalid': invalid, 'unevaluated': unevaluated, 'site': site,",
  "    'prefix': sys.prefix}))"
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

function detectCargoRegistry({ project, projectDir, cargoHome, locked, complete, unlocked = false }) {
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
  if (missing.length > 0 && complete) {
    dependenciesMissing(`project ${project} has locked crates that are not in the Cargo registry of ${cargoHome}: ` +
      missing.join(", "), { cargo_home: cargoHome, source: "cargo_home", missing,
      correction: `make the project's locked crates available (for example \`cargo fetch --locked\` in ${projectDir} ` +
        "with the CARGO_HOME setup sees, or configure the project's vendored sources), then rerun setup" });
  }
  if (gitCrates.length > 0 && existsSync(git)) population.push(git);
  if (!complete && !existsSync(registry)) return { absent: true };
  if (unlocked) {
    const stores = ["registry", ...(existsSync(git) ? ["git"] : [])];
    return { source: "cargo_home", dir: cargoHome, population: stores.map((store) => path.join(cargoHome, store)),
      exclude: [], stores };
  }
  return { source: "cargo_home", dir: cargoHome, population: [...new Set(population)].sort(), exclude: [],
    stores: ["registry", ...(gitCrates.length > 0 ? ["git"] : [])] };
}

async function detectCargoVendor({ project, projectDir, cargoHome, locked, replacement, complete,
  unlocked = false }) {
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
  if (missing.length > 0 && complete) {
    dependenciesMissing(`vendored sources ${vendor} of project ${project} lack locked crates: ${missing.join(", ")}`,
      { source: "cargo_vendor", vendor, declared_in: directory.file, missing,
        correction: `vendor the project's locked crates into ${vendor} (for example \`cargo vendor --locked\`), ` +
          "then rerun setup" });
  }
  if (!complete && !existsSync(vendor)) return { absent: true };
  return { source: "cargo_vendor", dir: vendor, population: unlocked ? [vendor] : [...new Set(population)].sort(),
    exclude: [],
    cargo_config: directory.scope === "cargo_home" || replacement.declared.scope === "cargo_home"
      ? path.join(cargoHome, path.basename(directory.scope === "cargo_home" ? directory.file
        : replacement.declared.file)) : null };
}

export const DEPENDENCY_ECOSYSTEMS = Object.freeze({

  npm: NPM_ECOSYSTEM,
  deno: Object.freeze({
    name: "deno",
    toolchains: Object.freeze(["deno"]),
    projectCommands: Object.freeze({ deno: Object.freeze({}) }),

    manifests(projectDir) {
      const config = denoConfigName(projectDir);
      if (!config) return { status: "none", files: {} };
      const files = { [config]: path.join(projectDir, config) };
      const lock = denoLockSelection(projectDir);
      if (lock.disabled) return { status: "present", files };
      if (!existsSync(lock.file)) return { status: "lock_missing", required: lock.name, files };
      return { status: "present", files: { ...files, [lock.name]: lock.file } };
    },

    async detect({ project, projectDir, inputs, toolchains, env, complete = true }) {

      const lock = denoLockSelection(projectDir);
      const lockFile = lock.disabled ? undefined : inputs.files?.[lock.name];
      if (lockFile !== undefined && !denoLockHasDependencies(lockFile)) return { none: true };

      const deno = toolchains.deno.executables.deno;
      const described = await runSetupProcess(deno, ["info", "--json"], { cwd: projectDir,
        env: { PATH: pathWith(), HOME: homeOf(env), NO_COLOR: "1", DENO_NO_UPDATE_CHECK: "1",
          ...projectDependencyLocationEnvironment(env, "deno") }, timeoutMs: 60000 });
      let denoDir = null;
      try { denoDir = described.ok ? JSON.parse(described.stdout).denoDir ?? null : null; } catch { denoDir = null; }
      if (absoluteOrNull(denoDir) === null) {
        fail("test_runtime_environment_unusable", `deno at ${deno} did not report its cache directory`,
          { project, diagnostic: processDiagnostic(described) });
      }
      const population = ["remote", "npm"].map((name) => path.join(denoDir, name)).filter(existsSync);
      if (population.length === 0 && !complete) return { absent: true };

      if (population.length === 0 && lock.disabled) return { none: true };
      if (population.length === 0) {
        dependenciesMissing(`project ${project} has no cached Deno dependencies in ${denoDir}`,
          { dependency_root: denoDir,
            correction: `cache the project's locked dependencies (for example \`deno install --frozen\` in ${projectDir}) ` +
              `with DENO_DIR ${denoDir}, or point DENO_DIR at the existing cache, then rerun setup` });
      }
      return { source: "deno_dir", dir: denoDir, population, exclude: [] };
    },

    compilerCacheEnv: "DENO_DIR",
    compilerCacheName: (dependency) => dependency.status === "present"
      ? `deno-dir-${createHash("sha256").update(dependency.dir).digest("hex").slice(0, 16)}` : "deno-dir",

    runtimeBinding({ dependency, scratchRoot = ATTEMPT_SCRATCH_ROOT, compilerCache = null, host = false }) {
      const common = host ? {} : { DENO_NO_UPDATE_CHECK: "1", NO_COLOR: "1" };
      const denoDir = compilerCache ?? `${scratchRoot}/deno-dir`;
      if (dependency.status !== "present") {
        return { binds: [], mountpoints: [], links: [], env: host ? {} : { DENO_DIR: denoDir, ...common }, values: {} };
      }
      if (compilerCache !== null) {
        return {
          binds: dependency.population.map((store) => ({ src: store, dst: store })),
          cacheLinks: dependency.population.map((store) => ({ path: path.join(denoDir, path.basename(store)),
            target: store })),
          mountpoints: [],
          links: [],
          env: { DENO_DIR: denoDir, ...common },
          values: {}
        };
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
      if (Object.keys(files).length > 0) return { status: "present", files };

      const declaration = [PYTHON_PROJECT_FILE, ...PYTHON_PACKAGING_FILES]
        .find((name) => existsSync(path.join(projectDir, name)));
      if (declaration !== undefined) {
        return { status: "present", files: { [declaration]: path.join(projectDir, declaration) } };
      }
      return { status: "lock_missing",
        required: [...PYTHON_REQUIREMENT_FILES, PYTHON_PROJECT_FILE, ...PYTHON_PACKAGING_FILES].join(" or ") };
    },

    async detect({ repositoryRoot, projectDir, project, inputs, toolchains, selection = null, complete = true }) {
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
      const declaredIn = Object.keys(inputs.files).sort();

      const fromProjectFile = inputs.files[PYTHON_PROJECT_FILE] !== undefined;
      const declared = fromProjectFile
        ? pyprojectRequirements(readFileSync(inputs.files[PYTHON_PROJECT_FILE], "utf8"))
        : fileRequirements(PYTHON_REQUIREMENT_FILES.filter((name) => inputs.files[name] !== undefined)
          .map((name) => inputs.files[name]), projectDir);

      const inspected = await runSetupProcess(python, ["-I", "-B", "-c", PYTHON_INSPECT_PROGRAM,
        JSON.stringify(declared)], { env: { PATH: pathWith(), PYTHONDONTWRITEBYTECODE: "1" }, timeoutMs: 60000 });
      let report = null;
      try { report = inspected.ok ? JSON.parse(inspected.stdout) : null; } catch { report = null; }
      if (report === null) {
        fail("test_runtime_environment_unusable", `python environment ${venv ?? interpreter} could not be inspected`,
          { project, environment: venv ?? interpreter, diagnostic: processDiagnostic(inspected) });
      }
      if (report.invalid.length > 0 && complete) {
        fail("test_runtime_manifest_invalid", `project ${project} declares ` +
          `${report.invalid.map(({ requirement }) => JSON.stringify(requirement)).join(", ")}, which python ` +
          `environment ${venv ?? interpreter} cannot read as a requirement`,
        { project, environment: venv ?? interpreter, requirements: declaredIn, invalid: report.invalid,
          missing: report.missing,
          correction: `correct the named requirement in ${declaredIn.join(" or ")}, then rerun setup` });
      }

      const missing = [...new Set([...report.missing, ...report.unevaluated.map(({ name }) => name)])];
      if (missing.length > 0 && complete) {
        const unevaluated = report.unevaluated.length === 0 ? "" : ` (${venv ?? interpreter} has neither packaging ` +
          `nor pip to evaluate the environment marker of ${report.unevaluated.map(({ requirement }) =>
            JSON.stringify(requirement)).join(", ")})`;
        dependenciesMissing(`python environment ${venv ?? interpreter} of project ${project} lacks ` +
          `${missing.join(", ")}${unevaluated}`, { project, environment: venv ?? interpreter, missing,
          ...(report.unevaluated.length > 0 ? { marker_unevaluated: report.unevaluated } : {}),
          requirements: declaredIn,
          correction: venv === null
            ? `create the project's virtual environment at ${path.join(projectDir, ".venv")} from ${interpreter} ` +
              "and install its requirements there, then rerun setup"
            : fromProjectFile
              ? `install the dependencies ${PYTHON_PROJECT_FILE} requires into ${venv} (for example \`${python} -m pip ` +
                `install ${missing.join(" ")}\`, at the versions it declares), then rerun setup`
              : `install the project's requirements into ${venv} (for example \`${python} -m pip install ` +
                `${declaredIn.map((name) => `-r ${name}`).join(" ")}\` in ${projectDir}), then rerun setup` });
      }
      if (venv !== null) {
        return { source: selection?.virtual_environment !== undefined ? "selected_virtual_environment"
          : "virtual_environment", dir: venv, population: [venv], exclude: ["__pycache__"] };
      }
      return { source: "interpreter", dir: null, population: report.site.filter(existsSync),
        exclude: ["__pycache__"] };
    },
    runtimeBinding({ dependency, host = false }) {
      const env = host ? {} : { PYTHONDONTWRITEBYTECODE: "1", PYTHONNOUSERSITE: "1" };
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

    compilerCacheEnv: "GOCACHE",
    compilerCacheName: () => "go-build",

    projectCommands: Object.freeze({ go: Object.freeze({}) }),

    manifests(projectDir, { checkoutRoot = projectDir } = {}) {
      const mod = path.join(projectDir, "go.mod");
      if (!existsSync(mod)) return { status: "lock_missing", required: "go.mod" };
      const sum = path.join(projectDir, "go.sum");
      return { status: "present",
        files: { "go.mod": mod, ...(existsSync(sum) ? { "go.sum": sum } : {}),
          ...selectGoWorkspace(projectDir, checkoutRoot).files } };
    },

    async detect({ repositoryRoot, project, projectDir, toolchains, env, complete = true }) {
      const go = toolchains.go.executables.go;
      const workspace = selectGoWorkspace(projectDir, repositoryRoot);
      if (complete && workspace.invalid.length > 0) {
        const outside = workspace.invalid.filter(({ reason }) =>
          reason === GO_WORKSPACE_REFERENCE_REASONS.OUTSIDE_CHECKOUT);
        const [first] = workspace.invalid;
        fail(outside.length === workspace.invalid.length ? DEPENDENCY_SOURCE_UNSUPPORTED : GO_WORKSPACE_INVALID,
          `the Go workspace ${workspace.file} of project ${project} names ${first.reference} in ` +
          `${first.declared_in}, which ${first.reason === GO_WORKSPACE_REFERENCE_REASONS.OUTSIDE_CHECKOUT
            ? "lies outside the checkout" : "holds no go.mod"}`,
          { project, workspace: workspace.file, invalid: workspace.invalid,
            supported: "workspace modules and local replacements that are module directories inside the checkout",
            correction: "restore each named module directory, or correct the `use` or `replace` line that names " +
              "it, then rerun setup" });
      }
      const operatorEnv = projectDependencyLocationEnvironment(env, "go_modules");
      const located = await runSetupProcess(go, ["env", "GOMODCACHE"], { cwd: projectDir,
        env: { PATH: pathWith(path.dirname(go)), HOME: homeOf(env), ...operatorEnv, GOTOOLCHAIN: "local",
          GOTELEMETRY: "off" }, timeoutMs: 60000 });
      const cache = located.ok ? located.stdout.trim() : "";
      const correction = (workspace.file === null
        ? `download the module's dependencies (for example \`go mod download\` in ${projectDir}) `
        : `download the workspace's dependencies (for example \`go mod download\` in each module of ${workspace.file}) `) +
        "into the module cache setup sees, then rerun setup";

      if (!path.isAbsolute(cache) && !complete) return { absent: true };
      if (!path.isAbsolute(cache)) {
        dependenciesMissing(`project ${project} has no Go module cache${cache ? ` at ${cache}` : ""}`,
          { module_cache: cache || null, diagnostic: located.ok ? null : processDiagnostic(located), correction });
      }
      const scratch = mkdtempSync(path.join(os.tmpdir(), "agent-chassis-go-detect-"));
      try {
        const listed = await runSetupProcess(go, ["list", "-m", "-f",
          "{{if not .Main}}{{.Path}}\t{{.Version}}\t{{.Dir}}\t{{.GoMod}}{{end}}", "all"], { cwd: projectDir,
          env: { PATH: pathWith(path.dirname(go)), HOME: path.join(scratch, "home"), GOMODCACHE: cache,
            ...GO_OFFLINE_MODULE_ENV, GOWORK: workspace.file ?? "off", GOCACHE: path.join(scratch, "gocache"),
            GOPATH: path.join(scratch, "gopath") }, timeoutMs: 120000 });

        if (!listed.ok && !complete) {
          return existsSync(cache) ? { source: "module_cache", dir: cache, population: [cache], exclude: [] }
            : { absent: true };
        }
        if (!listed.ok) {
          dependenciesMissing(`the module graph of project ${project} does not resolve from ${cache}` +
            (workspace.file === null ? "" : ` in the workspace ${workspace.file}`),
          { module_cache: cache, workspace: workspace.file, diagnostic: processDiagnostic(listed), correction });
        }
        const population = goModuleCachePopulation(listed.stdout, cache, existsSync);
        if (population.length === 0) return { none: true };
        return { source: "module_cache", dir: cache, population, exclude: [] };
      } finally {

        try { rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch {   }
      }
    },

    runtimeBinding({ dependency, projectHostDir = null, checkoutRoot = projectHostDir,
      scratchRoot = ATTEMPT_SCRATCH_ROOT, host = false }) {
      const present = dependency.status === "present";
      const workspace = projectHostDir === null ? null : selectGoWorkspace(projectHostDir, checkoutRoot).file;
      return {
        binds: present ? [{ src: dependency.dir, dst: dependency.dir }] : [],
        mountpoints: [],
        links: [],
        env: host ? (present ? { GOMODCACHE: dependency.dir } : {})
          : { GOMODCACHE: present ? dependency.dir : `${scratchRoot}/gomodcache`, ...GO_OFFLINE_MODULE_ENV,
          GOWORK: workspace ?? "off", GOCACHE: `${scratchRoot}/go-build`, GOPATH: `${scratchRoot}/gopath` },
        values: {}
      };
    }
  }),
  cargo: Object.freeze({
    name: "cargo",
    toolchains: Object.freeze(["rust"]),

    compilerCacheEnv: "CARGO_TARGET_DIR",
    compilerCacheName: () => "cargo-target",

    projectCommands: Object.freeze({ cargo: Object.freeze({}) }),

    toolchainEnv: (toolchains) => cargoToolchainEnv(toolchains.rust.executables.rustc),

    manifests(projectDir, { members = [] } = {}) {
      const manifest = path.join(projectDir, "Cargo.toml");
      if (!existsSync(manifest)) return { status: "lock_missing", required: "Cargo.toml" };
      const lock = path.join(projectDir, "Cargo.lock");
      if (!existsSync(lock)) {
        return { status: "lock_missing", required: "Cargo.lock", files: { "Cargo.toml": manifest } };
      }
      const memberFiles = Object.fromEntries(members
        .map((member) => [`${member}/Cargo.toml`, path.join(projectDir, member, "Cargo.toml")])
        .filter(([, file]) => existsSync(file)));
      return { status: "present", files: { "Cargo.toml": manifest, "Cargo.lock": lock, ...memberFiles } };
    },

    async detect({ project, projectDir, inputs, env, complete = true }) {
      const cargoHome = cargoHomeFromEnvironment({ HOME: env.HOME,
        ...projectDependencyLocationEnvironment(env, "cargo") });

      const lockFile = inputs.files?.["Cargo.lock"];
      const unlocked = lockFile === undefined;
      const locked = unlocked ? [] : cargoLockPackages(lockFile);
      if (!unlocked && cargoLockedCrates(locked).length === 0) return { none: true };
      const { replacement } = effectiveCargoSources(projectDir, cargoHome);
      if (replacement !== null) {
        return detectCargoVendor({ project, projectDir, cargoHome, locked, replacement, complete, unlocked });
      }
      return detectCargoRegistry({ project, projectDir, cargoHome, locked, complete, unlocked });
    },
    runtimeBinding({ dependency, scratchRoot = ATTEMPT_SCRATCH_ROOT, host = false }) {
      const present = dependency.status === "present";
      const offline = host ? {} : { CARGO_TARGET_DIR: `${scratchRoot}/cargo-target`, ...CARGO_OFFLINE_ENV };
      if (!present) {
        return { binds: [], mountpoints: [], links: [], env: host ? {} : { CARGO_HOME: `${scratchRoot}/cargo-home`, ...offline },
          values: {} };
      }
      if (dependency.source === "cargo_vendor") {

        const binds = [{ src: dependency.dir, dst: dependency.dir },
          ...(dependency.cargo_config === null ? [] : [{ src: dependency.cargo_config, dst: dependency.cargo_config }])];
        return { binds, mountpoints: [], links: [], env: { ...(dependency.cargo_config === null
          ? (host ? {} : { CARGO_HOME: `${scratchRoot}/cargo-home` })
          : { CARGO_HOME: path.dirname(dependency.cargo_config) }), ...offline }, values: {} };
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
