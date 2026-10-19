

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseToml } from "smol-toml";

import {
  GO_OFFLINE_MODULE_ENV,
  goModuleCacheFromEnvironment,
  parseGoModFile
} from "./runtime-inputs/ecosystem-inputs-go.mjs";
import { describeGoWorkspace } from "./runtime-inputs/go-workspace.mjs";
import { TOOLCHAIN_DESCRIPTIONS } from "./runtime-inputs/toolchain-descriptions.mjs";
import { isSidecarScipProviderInputPath } from "./sidecar-paths.mjs";
import { sidecarLanguageExtensions } from "./sidecar-language-descriptions.mjs";
import { TYPESCRIPT_EXECUTION_CONTRACT } from "./sidecar-scip-typescript-plan.mjs";
import {
  SIDECAR_RUST_INDEXER,
  sidecarRustEnvironmentSettings,
  sidecarRustProjectInputs,
  sidecarRustSettings,
  sidecarRustToolRoles
} from "./sidecar-scip-rust-projects.mjs";
import {
  compareSidecarProviderInputRecords,
  createSidecarProviderInputRecord,
  observeSidecarProviderDependencies,
  observeSidecarProviderTools,
  withSidecarProviderInputFacets
} from "./sidecar-scip-project-inputs.mjs";

export const SCIP_TYPESCRIPT_PROJECT_CONFIG = "tsconfig.json";

export const isSidecarProjectInputFile = file => file.mode !== "120000";

export function sidecarTypescriptProjectConfigs(trackedPaths) {
  return trackedPaths.filter((value) => !value.split("/").includes("node_modules") &&
    /^(?:ts|js)config(?:\.[^/]+)?\.json$/u.test(path.posix.basename(value))).sort();
}

const PYTHON_EXTENSIONS = new Set(sidecarLanguageExtensions(["python"], { declarations: true }));
const PYTHON_PROJECT_FILES = new Set(["pyproject.toml", "pyrightconfig.json", "setup.py", "setup.cfg", "Pipfile"]);

export function discoverSidecarPythonProjects(trackedPaths, repoRoot = null) {
  const roots = new Set(trackedPaths.filter((value) => {
    if (!PYTHON_PROJECT_FILES.has(path.posix.basename(value))) return false;
    if (path.posix.basename(value) !== "pyproject.toml" || repoRoot === null) return true;
    const parsed = parseToml(readFileSync(path.join(repoRoot, value), "utf8"));

    return Object.keys(parsed).some(key => key !== "tool") || parsed.tool?.pyright !== undefined ||
      parsed.tool?.poetry !== undefined;
  })
    .map((value) => path.posix.dirname(value)));
  const selected = new Set();
  for (const source of trackedPaths.filter((value) => PYTHON_EXTENSIONS.has(path.posix.extname(value)))) {
    let directory = path.posix.dirname(source);
    while (directory !== "." && !roots.has(directory)) directory = path.posix.dirname(directory);
    selected.add(directory);
  }
  return [...selected].sort().map((directory) => Object.freeze({ key: `scip-python#${directory}`,
    indexer: "scip-python", project: directory,

    excluded_roots: [...selected].filter((other) => other !== directory && withinRoot(directory, other)).sort() }));
}

export const SIDECAR_SCIP_CHECKOUT_TOKEN = "{checkout}";
export const SIDECAR_SCIP_OUTPUT_TOKEN = "{output}";
export const SIDECAR_SCIP_VERSION_TOKEN = "working-checkout";

const SYSTEM_PATH = Object.freeze(["/usr/bin", "/bin"]);

function withinRoot(root, relativePath) {
  return root === "." || relativePath === root || relativePath.startsWith(`${root}/`);
}

function providerPackage(resolved) {
  for (let directory = path.dirname(resolved); ; directory = path.dirname(directory)) {
    if (existsSync(path.join(directory, "package.json"))) return [directory];
    if (path.dirname(directory) === directory) return [resolved];
  }
}

function toolchainPopulation(name) {
  const description = TOOLCHAIN_DESCRIPTIONS[name];
  return (resolved) => {
    const root = description.hostRoot(resolved);
    return description.population.map((relative) => path.join(root, relative));
  };
}

function goToolRoles(toolchainRoot) {
  const indexer = { role: "indexer", command: "scip-go", population: executableFile };
  const pathGo = { command: "go", population: toolchainPopulation("go") };
  if (typeof toolchainRoot !== "string") return [indexer, { role: "go", ...pathGo }];
  return [indexer, { role: "go_selector", ...pathGo },
    { role: "go", executable: path.join(toolchainRoot, "bin", "go"), population: toolchainPopulation("go") }];
}

const NODE_RUNTIME = Object.freeze({ role: "node", command: "node", population: toolchainPopulation("node") });

const executableFile = (resolved) => [resolved];

function ruleInputs(indexer) {
  return (_project, entries) => entries.filter(({ path: value }) => isSidecarScipProviderInputPath(indexer, value));
}

const ADAPTERS = Object.freeze({
  "scip-typescript": Object.freeze({
    tools: Object.freeze([{ role: "indexer", command: "scip-typescript", population: providerPackage }, NODE_RUNTIME]),
    runtime: "node",
    runtimeSettings: Object.freeze({ node_max_old_space_size_mib: "8192",
      typescript_execution_contract: TYPESCRIPT_EXECUTION_CONTRACT }),
    runtimeArgs: (settings) => [`--max-old-space-size=${settings.node_max_old_space_size_mib}`],

    plannedDependencies: true,
    inputs: ruleInputs("scip-typescript"),
    settings: () => ({}),
    environmentSettings: () => ({}),

    directory: (project) => path.posix.dirname(project) || ".",

    args: (project) => project.membership?.state === "resolved"
      ? [SIDECAR_SCIP_CHECKOUT_TOKEN, SIDECAR_SCIP_OUTPUT_TOKEN, ...project.configurations]
      : ["index", "--cwd", SIDECAR_SCIP_CHECKOUT_TOKEN, "--output", SIDECAR_SCIP_OUTPUT_TOKEN, project.project]
  }),
  "scip-python": Object.freeze({
    tools: Object.freeze([{ role: "indexer", command: "scip-python", population: providerPackage }, NODE_RUNTIME]),
    runtime: "node",
    runtimeArgs: () => [],
    inputs: ruleInputs("scip-python"),
    settings: () => ({}),
    environmentSettings: () => ({}),
    args: (project) => ["index", "--cwd", project.project === "." ? SIDECAR_SCIP_CHECKOUT_TOKEN
      : `${SIDECAR_SCIP_CHECKOUT_TOKEN}/${project.project}`, "--output", SIDECAR_SCIP_OUTPUT_TOKEN, "--quiet",
      "--project-version", SIDECAR_SCIP_VERSION_TOKEN,
      ...(project.project === "." ? [] : ["--project-name", project.project])]
  }),

  "scip-go": Object.freeze({
    tools: (project) => goToolRoles(project.toolchain_root),
    recordTools: (record) => goToolRoles(record.settings?.GOROOT),
    dependencies: true,
    inputs: (project, entries) => entries.filter(({ path: value }) =>
      project.input_roots.some((root) => withinRoot(root, value))),
    settings: (project) => ({ ...GO_OFFLINE_MODULE_ENV, GONOPROXY: "none", GOWORK: project.workspace ?? "off",
      ...(typeof project.toolchain_root === "string" ? { GOROOT: project.toolchain_root } : {}) }),
    environmentSettings: (env) => ({ GOMODCACHE: goModuleCacheFromEnvironment(env) }),
    args: (project) => ["index", "--module-root=.", `--repository-remote=${project.module}`,
      `--module-version=${SIDECAR_SCIP_VERSION_TOKEN}`, `--output=${SIDECAR_SCIP_OUTPUT_TOKEN}`]
  }),

  [SIDECAR_RUST_INDEXER]: Object.freeze({
    tools: (project, env) => sidecarRustToolRoles(project.sysroot, env),
    recordTools: (record, env) => sidecarRustToolRoles(record.settings?.RUST_SYSROOT, env),
    plannedDependencies: true,
    inputs: sidecarRustProjectInputs,
    settings: sidecarRustSettings,
    environmentSettings: sidecarRustEnvironmentSettings,
    args: () => ["scip", ".", "--output", SIDECAR_SCIP_OUTPUT_TOKEN]
  })
});

export const SIDECAR_SCIP_PROVIDER_ADAPTERS = ADAPTERS;

function adapterFor(indexer) {
  const adapter = ADAPTERS[indexer];
  if (!adapter) throw new TypeError(`unsupported SCIP provider: ${indexer}`);
  return adapter;
}

function toolRoles(adapter, subject, env, { record = false } = {}) {
  if (typeof adapter.tools !== "function") return adapter.tools;
  return record ? adapter.recordTools(subject, env) : adapter.tools(subject, env);
}

function plannedDependencies(adapter, project, prior) {
  if (adapter.plannedDependencies) {
    return observeSidecarProviderDependencies(project.dependency_population ?? null,
      { prior: prior?.dependencies ?? null });
  }
  return priorDependencies(adapter, prior, true);
}

function ignoredGoDirectory(relativePath) {
  return relativePath.split("/").slice(0, -1).some((segment) =>
    segment === "testdata" || segment === "vendor" || segment.startsWith(".") || segment.startsWith("_"));
}

function goDirectory(filePath) {
  const directory = path.posix.dirname(filePath);
  return directory === "" ? "." : directory;
}

export function sidecarGoModules(goFiles) {
  return [...goFiles.entries()]
    .filter(([filePath]) => path.posix.basename(filePath) === "go.mod" && !ignoredGoDirectory(filePath))
    .map(([filePath, content]) => ({ dir: goDirectory(filePath), go_mod: filePath,
      module: parseGoModFile(content).module }))
    .filter(({ module }) => typeof module === "string" && module.length > 0)
    .sort((left, right) => left.dir < right.dir ? -1 : left.dir > right.dir ? 1 : 0);
}

function goProject(goModPath, _trackedPaths, goFiles) {
  const dir = goDirectory(goModPath);

  const root = path.resolve("checkout");
  const relative = file => path.relative(root, file).split(path.sep).join("/") || ".";
  const facts = describeGoWorkspace(path.join(root, dir), root, {
    exists: file => goFiles.has(relative(file)), read: file => goFiles.get(relative(file))
  });
  const module = parseGoModFile(goFiles.get(goModPath)).module;
  const project = { key: `scip-go#${dir}`, indexer: "scip-go", project: dir, module,
    workspace: facts.file ? relative(facts.file) : null,
    input_roots: [...facts.input_roots.map(relative), ...(facts.file ? [relative(facts.file), `${relative(facts.file)}.sum`] : [])],
    refusal: module ? null : { code: "scip_go_module_path_missing", message: `${goModPath} declares no module path` } };
  for (const reference of facts.references) {
    const invalid = facts.invalid.find(entry => entry.directory === reference.directory &&
      entry.declared_in === reference.declared_in && entry.reference === reference.reference);
    if (path.isAbsolute(reference.reference) || invalid?.reason === "outside_checkout") {
      project.refusal ??= { code: reference.kind === "member" ? "scip_go_workspace_uncontained" : "scip_go_replacement_uncontained",
        message: `${relative(reference.declared_in)} references ${reference.reference}, outside the committed tree` };
    }
  }
  project.input_roots = [...new Set(project.input_roots)].sort();
  return Object.freeze({ ...project, input_roots: Object.freeze(project.input_roots) });
}

export function discoverSidecarGoProjects(trackedPaths, goFiles, goToolchains = new Map()) {
  const tracked = new Set(trackedPaths);
  return trackedPaths.filter((value) => path.posix.basename(value) === "go.mod" && !ignoredGoDirectory(value))
    .sort().map((goModPath) => goProject(goModPath, tracked, goFiles)).map((project) => {
      const selection = goToolchains.get(project.key);
      if (selection === undefined) return project;
      return Object.freeze({ ...project, ...(selection.root ? { toolchain_root: selection.root } : {}),
        refusal: project.refusal ?? selection.refusal ?? null,
        configuration_unavailable: project.configuration_unavailable ?? selection.configuration_unavailable });
    });
}

export function isSidecarGoProjectFile(relativePath) {
  const basename = path.posix.basename(relativePath);
  return basename === "go.mod" || basename === "go.work";
}

function activationOf(tool, project) {
  const failed = tool.find(({ status }) => status === "failed");
  if (failed) {
    return { activation: "failed", failure: { code: "scip_indexer_resolution_failed",
      message: `${project.key} executable ${failed.role} lookup failed: ${failed.message}` } };
  }
  if (tool.some(({ status }) => status === "absent")) return { activation: "inactive", failure: null };
  if (project.refusal) return { activation: "failed", failure: project.refusal };
  return { activation: "active", failure: null };
}

function priorDependencies(adapter, prior, measure) {
  if (!adapter.dependencies) return null;
  return Array.isArray(prior?.dependencies?.population)
    ? observeSidecarProviderDependencies(prior.dependencies.population, { prior: prior.dependencies, measure })
    : { state: "unobserved" };
}

export function planSidecarProviderProjects({ projects, entries, env, priorRecords = {} }) {
  return projects.map((project) => {
    const adapter = adapterFor(project.indexer);
    const prior = Object.hasOwn(priorRecords, project.key) ? priorRecords[project.key] : null;
    const tool = observeSidecarProviderTools(toolRoles(adapter, project, env), env.PATH, { prior: prior?.tool ?? null });
    const record = createSidecarProviderInputRecord({
      provider: project.indexer, project: project.project,
      sourceEntries: adapter.inputs(project, entries).map(({ path: value, mode, blob_oid }) =>
        ({ path: value, mode, blob_oid })),
      tool, settings: sidecarProjectSettings(project, env),
      dependencies: plannedDependencies(adapter, project, prior),
      invocation: { args: adapter.args(project), commit_sensitive: false }
    });
    const comparison = compareSidecarProviderInputRecords(prior, record);
    return Object.freeze({ project, record, prior, ...activationOf(tool, project),
      unchanged: comparison.equal, current: comparison.current, changed: comparison.changed });
  });
}

export function observeSidecarProviderRecordAgain(prior, env, { measure = true } = {}) {
  const adapter = ADAPTERS[prior?.provider];
  if (!adapter) return null;
  return withSidecarProviderInputFacets(prior, {
    tool: observeSidecarProviderTools(toolRoles(adapter, prior, env, { record: true }), env.PATH,
      { prior: prior.tool, measure }),
    settings: { ...prior.settings, ...adapter.runtimeSettings, ...adapter.environmentSettings(env, prior) },
    dependencies: Array.isArray(prior.dependencies?.population)
      ? observeSidecarProviderDependencies(prior.dependencies.population, { prior: prior.dependencies, measure })
      : prior.dependencies
  });
}

export function sidecarProviderInputsChangedAtCommit(publication, env) {
  const records = publication?.provider_input_identity?.records;
  if (!records || typeof records !== "object" || Array.isArray(records)) return true;
  for (const prior of Object.values(records)) {
    const current = observeSidecarProviderRecordAgain(prior, env, { measure: false });
    if (current === null || !compareSidecarProviderInputRecords(prior, current).current) return true;
  }
  return false;
}

export const SIDECAR_INACTIVE_DEPENDENCIES_UNAVAILABLE = "dependencies_unavailable";

function projectDirectory({ indexer, project }) {
  return ADAPTERS[indexer]?.directory?.(project) ?? project;
}

export function sidecarDependencyLimitations(coverage, relativePath = null) {
  const list = (value) => Array.isArray(value) ? value : [];
  const entry = (project, kind) => ({ key: project.key, indexer: project.indexer, project: project.project,
    ...(project.indexer === "scip-typescript" && project.membership ? { membership: project.membership } : {}),
    coverage: kind, code: project.dependency_limitation.code, message: project.dependency_limitation.message,
    ...(typeof project.provider_failure === "string" ? { provider_failure: project.provider_failure } : {}) });
  return [
    ...list(coverage?.projects).filter((project) => project?.dependency_limitation)
      .map((project) => entry(project, "partial")),
    ...list(coverage?.inactive_projects)
      .filter((project) => project?.reason === SIDECAR_INACTIVE_DEPENDENCIES_UNAVAILABLE)
      .map((project) => entry(project, "unavailable"))
  ].filter((entry) => typeof relativePath !== "string" ||
    (entry.membership?.configurations ?? [entry.project]).some((project) =>
      withinRoot(projectDirectory({ ...entry, project }), relativePath)))
    .sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
}

export function materializeSidecarProviderArgs(args, { checkoutRoot, outputPath }) {
  return args.map((arg) => arg.replaceAll(SIDECAR_SCIP_CHECKOUT_TOKEN, checkoutRoot)
    .replaceAll(SIDECAR_SCIP_OUTPUT_TOKEN, outputPath));
}

export function observeSidecarProjectTools(project, env) {
  return observeSidecarProviderTools(toolRoles(adapterFor(project.indexer), project, env), env.PATH, { measure: false });
}

export function sidecarProjectSettings(project, env) {
  const adapter = adapterFor(project.indexer);
  return { ...adapter.settings(project), ...adapter.runtimeSettings, ...adapter.environmentSettings(env) };
}

export function sidecarProjectArgs(project) {
  return adapterFor(project.indexer).args(project);
}

export function sidecarGoProcessEnvironment({ tool, settings, checkoutRoot, privateRoot }) {
  const go = tool.find(({ role }) => role === "go")?.resolved_path;
  if (typeof go !== "string") throw new TypeError("Go execution requires the observed go executable");
  const { GOMODCACHE, GOWORK, ...fixed } = settings;
  return {
    PATH: [path.dirname(go), ...SYSTEM_PATH].join(path.delimiter),
    HOME: path.join(privateRoot, "home"),
    GOPATH: path.join(privateRoot, "gopath"),
    GOCACHE: path.join(privateRoot, "gocache"),
    ...fixed,
    GOWORK: GOWORK === "off" ? "off" : path.join(checkoutRoot, GOWORK),
    ...(GOMODCACHE ? { GOMODCACHE } : {})
  };
}
