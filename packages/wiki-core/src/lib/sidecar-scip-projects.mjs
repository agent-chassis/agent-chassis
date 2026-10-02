

import { existsSync } from "node:fs";
import path from "node:path";

import {
  GO_OFFLINE_MODULE_ENV,
  goModuleCacheFromEnvironment,
  parseGoModFile,
  parseGoWorkFile
} from "./runtime-inputs/ecosystem-inputs-go.mjs";
import { TOOLCHAIN_DESCRIPTIONS } from "./runtime-inputs/toolchain-descriptions.mjs";
import { isSidecarScipProviderInputPath } from "./sidecar-paths.mjs";
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

export const SIDECAR_SCIP_SNAPSHOT_TOKEN = "{snapshot}";
export const SIDECAR_SCIP_OUTPUT_TOKEN = "{output}";
export const SIDECAR_SCIP_COMMIT_TOKEN = "{commit}";

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

const NODE_RUNTIME = Object.freeze({ role: "node", command: "node", population: toolchainPopulation("node") });

const executableFile = (resolved) => [resolved];

function ruleInputs(indexer) {
  return (_project, entries) => entries.filter(({ path: value }) => isSidecarScipProviderInputPath(indexer, value));
}

const ADAPTERS = Object.freeze({
  "scip-typescript": Object.freeze({
    tools: Object.freeze([{ role: "indexer", command: "scip-typescript", population: providerPackage }, NODE_RUNTIME]),
    runtime: "node",
    commitSensitive: false,
    inputs: ruleInputs("scip-typescript"),
    settings: () => ({}),
    environmentSettings: () => ({}),

    args: (project) => ["index", "--cwd", SIDECAR_SCIP_SNAPSHOT_TOKEN, "--output", SIDECAR_SCIP_OUTPUT_TOKEN,
      path.posix.dirname(project.project) || "."]
  }),
  "scip-python": Object.freeze({
    tools: Object.freeze([{ role: "indexer", command: "scip-python", population: providerPackage }, NODE_RUNTIME]),
    runtime: "node",
    commitSensitive: true,
    inputs: ruleInputs("scip-python"),
    settings: () => ({}),
    environmentSettings: () => ({}),
    args: () => ["index", "--cwd", SIDECAR_SCIP_SNAPSHOT_TOKEN, "--output", SIDECAR_SCIP_OUTPUT_TOKEN, "--quiet",
      "--project-version", SIDECAR_SCIP_COMMIT_TOKEN]
  }),
  "scip-go": Object.freeze({
    tools: Object.freeze([{ role: "indexer", command: "scip-go", population: executableFile },
      { role: "go", command: "go", population: toolchainPopulation("go") }]),
    commitSensitive: true,
    dependencies: true,
    inputs: (project, entries) => entries.filter(({ path: value }) =>
      project.input_roots.some((root) => withinRoot(root, value))),
    settings: (project) => ({ ...GO_OFFLINE_MODULE_ENV, GONOPROXY: "none", GOWORK: project.workspace ?? "off" }),
    environmentSettings: (env) => ({ GOMODCACHE: goModuleCacheFromEnvironment(env) }),
    args: (project) => ["index", "--module-root=.", `--repository-remote=${project.module}`,
      `--module-version=${SIDECAR_SCIP_COMMIT_TOKEN}`, `--output=${SIDECAR_SCIP_OUTPUT_TOKEN}`]
  }),

  [SIDECAR_RUST_INDEXER]: Object.freeze({
    tools: (project, env) => sidecarRustToolRoles(project.sysroot, env),
    recordTools: (record, env) => sidecarRustToolRoles(record.settings?.RUST_SYSROOT, env),
    commitSensitive: false,
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

function containedPath(base, target) {
  if (path.posix.isAbsolute(target) || path.isAbsolute(target)) return null;
  const joined = path.posix.normalize(path.posix.join(base, target));
  return joined === ".." || joined.startsWith("../") ? null : joined.replace(/\/$/u, "") || ".";
}

export function sidecarGoModules(goFiles) {
  return [...goFiles.entries()]
    .filter(([filePath]) => path.posix.basename(filePath) === "go.mod" && !ignoredGoDirectory(filePath))
    .map(([filePath, content]) => ({ dir: goDirectory(filePath), go_mod: filePath,
      module: parseGoModFile(content).module }))
    .filter(({ module }) => typeof module === "string" && module.length > 0)
    .sort((left, right) => left.dir < right.dir ? -1 : left.dir > right.dir ? 1 : 0);
}

function nearestWorkspace(directory, trackedPaths) {
  for (let current = directory; ; current = goDirectory(current)) {
    const candidate = current === "." ? "go.work" : `${current}/go.work`;
    if (trackedPaths.has(candidate)) return candidate;
    if (current === ".") return null;
  }
}

const goModOf = (directory) => directory === "." ? "go.mod" : `${directory}/go.mod`;

function goProject(goModPath, trackedPaths, goFiles) {
  const dir = goDirectory(goModPath);
  const project = { key: `scip-go#${dir}`, indexer: "scip-go", project: dir, module: null,
    workspace: null, input_roots: [dir], refusal: null };
  const refuse = (code, message) => {
    project.refusal ??= { code, message };
  };
  const modContent = goFiles.get(goModPath);
  project.module = modContent === undefined ? null : parseGoModFile(modContent).module;
  if (!project.module) refuse("scip_go_module_path_missing", `${goModPath} declares no module path`);
  const localTargets = (base, replacementList, owner) => {
    for (const { target, local } of replacementList) {
      if (!local) continue;
      const contained = containedPath(base, target);
      if (contained === null) {
        refuse("scip_go_replacement_uncontained",
          `${owner} replaces a module with ${target}, outside the committed tree`);
      } else project.input_roots.push(contained);
    }
  };
  const moduleReplacements = (moduleDir) => {
    const content = goFiles.get(goModOf(moduleDir));
    if (content !== undefined) localTargets(moduleDir, parseGoModFile(content).replacements, goModOf(moduleDir));
  };
  moduleReplacements(dir);
  const workspace = nearestWorkspace(dir, trackedPaths);
  if (workspace !== null) {
    const workDir = goDirectory(workspace);
    const work = parseGoWorkFile(goFiles.get(workspace) ?? "");
    const members = work.uses.map((use) => ({ use, dir: containedPath(workDir, use) }));
    if (members.some((member) => member.dir === dir)) {
      project.workspace = workspace;
      project.input_roots.push(workspace, `${workspace}.sum`);
      for (const member of members) {
        if (member.dir === null) {
          refuse("scip_go_workspace_uncontained", `${workspace} uses ${member.use}, outside the committed tree`);
          continue;
        }
        project.input_roots.push(member.dir);
        moduleReplacements(member.dir);
      }
      localTargets(workDir, work.replacements, workspace);
    }
  }
  project.input_roots = [...new Set(project.input_roots)].sort();
  return Object.freeze({ ...project, input_roots: Object.freeze(project.input_roots) });
}

export function discoverSidecarGoProjects(trackedPaths, goFiles) {
  const tracked = new Set(trackedPaths);
  return trackedPaths.filter((value) => path.posix.basename(value) === "go.mod" && !ignoredGoDirectory(value))
    .sort().map((goModPath) => goProject(goModPath, tracked, goFiles));
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

function recordedArgs(adapter, project, head) {
  const args = adapter.args(project);
  return adapter.commitSensitive
    ? args.map((arg) => arg.replaceAll(SIDECAR_SCIP_COMMIT_TOKEN, head)) : args;
}

export function planSidecarProviderProjects({ projects, entries, head, env, priorRecords = {} }) {
  return projects.map((project) => {
    const adapter = adapterFor(project.indexer);
    const prior = Object.hasOwn(priorRecords, project.key) ? priorRecords[project.key] : null;
    const tool = observeSidecarProviderTools(toolRoles(adapter, project, env), env.PATH, { prior: prior?.tool ?? null });
    const record = createSidecarProviderInputRecord({
      provider: project.indexer, project: project.project,
      committedEntries: adapter.inputs(project, entries).map(({ path: value, mode, blob_oid }) =>
        ({ path: value, mode, blob_oid })),
      tool, settings: sidecarProjectSettings(project, env),
      dependencies: plannedDependencies(adapter, project, prior),
      invocation: { args: recordedArgs(adapter, project, head), commit_sensitive: adapter.commitSensitive }
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
    settings: { ...prior.settings, ...adapter.environmentSettings(env) },
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

export function materializeSidecarProviderArgs(args, { snapshotRoot, outputPath, committedHead }) {
  return args.map((arg) => arg.replaceAll(SIDECAR_SCIP_SNAPSHOT_TOKEN, snapshotRoot)
    .replaceAll(SIDECAR_SCIP_OUTPUT_TOKEN, outputPath)
    .replaceAll(SIDECAR_SCIP_COMMIT_TOKEN, committedHead));
}

export function observeSidecarProjectTools(project, env) {
  return observeSidecarProviderTools(toolRoles(adapterFor(project.indexer), project, env), env.PATH, { measure: false });
}

export function sidecarProjectSettings(project, env) {
  const adapter = adapterFor(project.indexer);
  return { ...adapter.settings(project), ...adapter.environmentSettings(env) };
}

export function sidecarProjectArgs(project) {
  return adapterFor(project.indexer).args(project);
}

export function sidecarGoProcessEnvironment({ tool, settings, snapshotRoot, privateRoot }) {
  const go = tool.find(({ role }) => role === "go")?.resolved_path;
  if (typeof go !== "string") throw new TypeError("Go execution requires the observed go executable");
  const { GOMODCACHE, GOWORK, ...fixed } = settings;
  return {
    PATH: [path.dirname(go), ...SYSTEM_PATH].join(path.delimiter),
    HOME: path.join(privateRoot, "home"),
    GOPATH: path.join(privateRoot, "gopath"),
    GOCACHE: path.join(privateRoot, "gocache"),
    ...fixed,
    GOWORK: GOWORK === "off" ? "off" : path.join(snapshotRoot, GOWORK),
    ...(GOMODCACHE ? { GOMODCACHE } : {})
  };
}
