

import { spawnSync } from "node:child_process";
import { appendFileSync, lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync }
  from "node:fs";
import path from "node:path";

import { TEST_RUNTIME_RUNNER_CATALOG, testProofProviderFamily } from
  "@agent-chassis/controlled-contract/test-proof";

import { projectHostTestEnvironment } from "../launch-isolation-env-policy.mjs";
import { DEFAULT_SYSTEM_READ_ONLY_ROOTS } from "../launch-isolation-executable.mjs";
import { readRepositoryRuntimeConfig, repositoryRuntimeConfigPath } from "../test-runtime-setup/config.mjs";
import { discoverRepositoryEnvironments } from "../test-runtime-setup/discovery.mjs";
import { ATTEMPT_SCRATCH_ROOT, DEPENDENCY_ECOSYSTEMS } from "../test-runtime-setup/ecosystems.mjs";
import { resolvePnpmDataHome } from "../test-runtime-setup/pnpm-location.mjs";
import {
  TEST_RUNTIME_READINESS_CODES,
  loadExecutionConfiguration,
  readinessRecovery,
  resolveCurrentEnvironmentInputs,
  resolveCurrentRunnerInputs
} from "../test-runtime-setup/readiness.mjs";
import { TestRuntimeSetupError, resolveConfiguredExecutable } from "../test-runtime-setup/toolchains.mjs";

export const ATTEMPT_HOME = `${ATTEMPT_SCRATCH_ROOT}/home`;
export const ATTEMPT_WORK_ROOT = `${ATTEMPT_SCRATCH_ROOT}/work`;

export function workingCopyProjectDir(scratchRoot, project) {
  return project === "." ? path.join(scratchRoot, "work") : path.join(scratchRoot, "work", project);
}

export const NATIVE_COMPILER_CACHE_RELATIVE_PATH = ".cache/test-proof-native";

export const NATIVE_COMPILER_CACHE_EXCLUDE_PATTERN = `/${NATIVE_COMPILER_CACHE_RELATIVE_PATH}/`;
const CACHE_NAME_RE = /^[a-z0-9][a-z0-9-]*$/u;

function runGitIn(repository, args) {
  const result = spawnSync("git", ["-C", repository, ...args], { encoding: "utf8", env: process.env,
    maxBuffer: 16 * 1024 * 1024 });
  return { ok: result.status === 0, status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "",
    error: result.error ?? null };
}

function exclusionRefusal(code, message, detail) {
  return Object.assign(new Error(message), { code, detail });
}

export function ensureNativeCompilerCacheExcluded({ repositoryRoot, runGit = runGitIn }) {
  const code = "test_runtime_native_cache_exclusion_failed";
  const repository = realpathSync(repositoryRoot);
  const git = (args) => {
    const result = runGit(repository, args);
    if (!result.ok) {
      throw exclusionRefusal(code, `git ${args.join(" ")} failed in ${repository}`,
        { repository, args, status: result.status, stderr: result.stderr.trim().slice(-4096),
          errno: result.error?.code ?? null });
    }
    return result.stdout;
  };
  const top = git(["rev-parse", "--show-toplevel"]).trim();
  if (realpathSync(top) !== repository) {
    throw exclusionRefusal(code, `${repository} is not the top level of its Git work tree`,
      { repository, top_level: top });
  }
  const tracked = git(["ls-files", "-z", "--", NATIVE_COMPILER_CACHE_RELATIVE_PATH]).split("\0").filter(Boolean);
  if (tracked.length > 0) {
    throw exclusionRefusal(code, `Git tracks files below ${NATIVE_COMPILER_CACHE_RELATIVE_PATH}; ` +
      "native compiler caches never hold tracked content", { repository, tracked: tracked.slice(0, 16),
      tracked_count: tracked.length, correction: `remove ${NATIVE_COMPILER_CACHE_RELATIVE_PATH} from the index ` +
        "(it holds disposable compiler state), then rerun setup" });
  }
  const file = git(["rev-parse", "--path-format=absolute", "--git-path", "info/exclude"]).trim();
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw exclusionRefusal(code, `${file} cannot be read`, { path: file, errno: error?.code ?? null });
    }
  }
  if (text.split("\n").some((line) => line.trim() === NATIVE_COMPILER_CACHE_EXCLUDE_PATTERN)) {
    return Object.freeze({ status: "present", path: file });
  }
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    const separator = text === "" || text.endsWith("\n") ? "" : "\n";
    appendFileSync(file, `${separator}${NATIVE_COMPILER_CACHE_EXCLUDE_PATTERN}\n`);
  } catch (error) {
    throw exclusionRefusal(code, `${file} cannot be written`, { path: file, errno: error?.code ?? null });
  }
  return Object.freeze({ status: "added", path: file });
}

export function nativeCompilerCachePath(repositoryRoot, name) {
  if (typeof name !== "string" || !CACHE_NAME_RE.test(name)) {
    throw new Error(`invalid native compiler cache name ${JSON.stringify(name)}`);
  }
  return path.join(realpathSync(repositoryRoot), NATIVE_COMPILER_CACHE_RELATIVE_PATH, name);
}

function cacheRefusal(message, detail) {
  return Object.assign(new Error(message), { code: "test_proof_native_compiler_cache_unavailable", detail });
}

export function openNativeCompilerCache({ repositoryRoot, directory, links = [], runGit = runGitIn }) {
  const repository = realpathSync(repositoryRoot);
  const relative = path.relative(repository, directory);
  const segments = relative.split(path.sep);
  if (path.isAbsolute(relative) || segments.length !== 3 ||
      segments.slice(0, 2).join("/") !== NATIVE_COMPILER_CACHE_RELATIVE_PATH || !CACHE_NAME_RE.test(segments[2])) {
    throw cacheRefusal("native compiler cache path escapes its launcher-owned root", { path: directory });
  }

  const assertRealDirectory = (component) => {
    const stat = lstatSync(component);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw cacheRefusal("native compiler cache location is redirected or not a directory", { path: component });
    }
  };
  let existing = repository;
  for (const segment of segments) {
    existing = path.join(existing, segment);
    try {
      assertRealDirectory(existing);
    } catch (error) {
      if (error?.code === "ENOENT") break;
      throw error;
    }
  }

  const ignored = runGit(repository, ["check-ignore", "-q", "--", `${relative}/`]);
  if (ignored.status !== 0) {
    throw Object.assign(new Error(`Git does not ignore the native compiler cache ${relative}`), {
      code: "test_proof_native_compiler_cache_not_excluded",
      detail: { path: directory, check_ignore_status: ignored.status,
        recovery: "rerun local test-runtime setup, which adds the exact " +
          `${NATIVE_COMPILER_CACHE_EXCLUDE_PATTERN} exclusion to the repository's Git info/exclude` } });
  }
  let current = repository;
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      mkdirSync(current, { mode: 0o700 });
    } catch (error) {
      if (error?.code !== "EEXIST") throw cacheRefusal("native compiler cache directory cannot be created",
        { path: current, errno: error?.code ?? null });
    }
    assertRealDirectory(current);
  }
  const linked = (link) => {
    try { return readlinkSync(link.path) === link.target; } catch { return false; }
  };
  for (const link of links) {
    if (linked(link)) continue;
    rmSync(link.path, { recursive: true, force: true });
    try {
      symlinkSync(link.target, link.path);
    } catch (error) {

      if (error?.code !== "EEXIST" || !linked(link)) throw cacheRefusal("native compiler cache link cannot be made",
        { path: link.path, errno: error?.code ?? null });
    }
  }
  return current;
}

export function isUnderSystemRoot(absolute) {
  return DEFAULT_SYSTEM_READ_ONLY_ROOTS.some((root) =>
    absolute === root || absolute.startsWith(`${root}/`));
}

function uniqueBinds(binds) {
  const seen = new Set();
  return binds.filter(({ src, dst }) => {
    const key = `${src}\0${dst}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function composeRuntimeInputs(ready, { repositoryRoot = null, workProjectDir, scratchRoot, compilerCache = false,
  hostPath = undefined, env: locationEnv = process.env }) {
  const host = hostPath !== undefined;
  const configuration = host && repositoryRoot !== null
    ? loadExecutionConfiguration(repositoryRoot).configuration : null;
  const selectedBinDirs = [];
  const toolchainBinds = [];
  const binDirs = [];
  const executables = {};
  const toolchainIdentity = {};
  for (const [name, toolchain] of Object.entries(ready.toolchains)) {
    Object.assign(executables, toolchain.executables);
    for (const executable of Object.values(toolchain.executables)) {
      const directory = path.dirname(executable);
      if (!binDirs.includes(directory)) binDirs.push(directory);

      if ((toolchain.source === "configured" || configuration?.toolchains?.[name] !== undefined) &&
          !selectedBinDirs.includes(directory)) selectedBinDirs.push(directory);
    }
    const roots = toolchain.root && !isUnderSystemRoot(toolchain.root) ? [toolchain.root] : [];
    for (const root of roots) toolchainBinds.push({ src: root, dst: root, toolchain: name });
    toolchainIdentity[name] = ready.provenance.toolchains[name];
  }
  const ecosystem = ready.preparation === null ? null : DEPENDENCY_ECOSYSTEMS[ready.preparation.ecosystem];

  const cacheDirectory = compilerCache && typeof ecosystem?.compilerCacheEnv === "string"
    ? nativeCompilerCachePath(repositoryRoot, ecosystem.compilerCacheName(ready.preparation)) : null;
  const binding = ecosystem === null ? { binds: [], env: {}, values: {}, mountpoints: [], directories: [] }
    : workProjectDir !== null && ready.preparation.status === "present" &&
    typeof ecosystem.workingCopyBinding === "function"
    ? ecosystem.workingCopyBinding({ dependency: ready.preparation, workProjectDir, scratchRoot })
    : ecosystem.runtimeBinding({ dependency: ready.preparation, projectHostDir: ready.projectDir,
      checkoutRoot: ready.checkoutRoot, scratchRoot,
      compilerCache: cacheDirectory, host });

  const pnpmHome = ready.environment.ecosystem === "npm" || ready.preparation === null
    ? resolvePnpmDataHome({ env: locationEnv }) : null;
  const pnpmEnv = pnpmHome === null ? {} : { PNPM_HOME: pnpmHome };
  const pnpmBinds = [];
  if (pnpmHome !== null && hostPath === undefined) {
    const tools = path.join(pnpmHome, ".tools");
    try {
      const source = realpathSync(tools);
      pnpmBinds.push({ src: source, dst: tools });
      if (source !== tools) pnpmBinds.push({ src: source, dst: source });
    } catch (error) {

      if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR" &&
          error?.code !== "EACCES" && error?.code !== "EPERM") throw error;
    }
  }
  const dependencyBinds = [...binding.binds, ...pnpmBinds];
  const selectedPreparation = configuration?.preparations?.some(entry =>
    entry.ecosystem === ready.preparation?.ecosystem && entry.project === ready.preparation?.project) === true ||
    ready.preparation?.source === "selected_virtual_environment";
  const bindingEnv = host ? (selectedPreparation ? { ...binding.env } : {}) : { ...binding.env, ...pnpmEnv };
  const binds = [...toolchainBinds.map(({ src, dst }) => ({ src, dst })), ...dependencyBinds];
  if (binding.values.python) {
    executables.python = binding.values.python;
    binDirs.unshift(path.dirname(binding.values.python));
    if (selectedPreparation) selectedBinDirs.unshift(path.dirname(binding.values.python));
  }
  const env = host ? {
    ...projectHostTestEnvironment(locationEnv),
    ...bindingEnv,
    ...(cacheDirectory === null ? {} : { [ecosystem.compilerCacheEnv]: cacheDirectory })
  } : {
    PATH: [...binDirs, "/usr/local/bin", "/usr/bin", "/bin"].join(path.delimiter),
    HOME: `${scratchRoot}/home`,
    LANG: "C.UTF-8",
    CI: "true",
    ...bindingEnv,
    ...(cacheDirectory === null ? {} : { [ecosystem.compilerCacheEnv]: cacheDirectory })
  };
  if (host) {
    if (hostPath === null) delete env.PATH;
    else env.PATH = hostPath;
    if (selectedBinDirs.length > 0) {
      env.PATH = [...selectedBinDirs, ...(hostPath === null ? [] : [hostPath])].join(path.delimiter);
    }
  }
  return Object.freeze({
    ok: true,
    binds: uniqueBinds(binds),

    toolchainBinds: Object.freeze(toolchainBinds),
    dependencyBinds: Object.freeze(dependencyBinds),
    toolchains: ready.toolchains,
    bindingEnv: Object.freeze(bindingEnv),
    mountpoints: binding.mountpoints,
    directories: Object.freeze([...(binding.directories ?? [])]),
    links: binding.links ?? [],
    writes: binding.writes ?? [],

    compilerCache: cacheDirectory === null ? null
      : Object.freeze({ directory: cacheDirectory, links: Object.freeze([...(binding.cacheLinks ?? [])]) }),
    env,
    executables,
    values: binding.values,
    scratchRoot,
    projectDir: ready.projectDir,
    environment: ready.environment,
    preparation: ready.preparation,

    identity: Object.freeze({
      readiness_digest: ready.readiness_digest ?? null,
      ...(ready.record_status === "ready" ? {} : { configuration_record_status: ready.record_status }),
      environment: ready.environment.id,
      toolchains: toolchainIdentity,
      dependencies: pnpmHome === null ? ready.provenance.dependencies
        : Object.freeze({ ...ready.provenance.dependencies, pnpm_home: pnpmHome })
    })
  });
}

export function configuredExecutableFailure(runtime, command) {
  const owner = Object.entries(runtime.toolchains ?? {}).find(([, toolchain]) =>
    Object.values(toolchain.executables ?? {}).includes(command))?.[0] ??
    (command === runtime.values?.python ? "python" : null);
  if (owner === null) return null;
  try {
    resolveConfiguredExecutable(owner, command);
    return null;
  } catch (error) {
    if (!(error instanceof TestRuntimeSetupError)) throw error;
    return Object.freeze({ ok: false, code: error.code, message: error.message,
      detail: { ...error.detail, authority_limb: "mechanical" }, recovery: readinessRecovery() });
  }
}

export function resolveRunnerRuntimeInputs({ repositoryRoot, checkoutRoot, descriptor, project,
  candidateRecord = null, located = null, workProjectDir = null, scratchRoot = ATTEMPT_SCRATCH_ROOT,
  compilerCache = false, hostPath = undefined, env = process.env }) {
  const ready = resolveCurrentRunnerInputs({ repositoryRoot, checkoutRoot, descriptor, project,
    candidateRecord, located });
  if (!ready.ok) return ready;
  return composeRuntimeInputs(ready, { repositoryRoot, workProjectDir, scratchRoot, compilerCache,
    hostPath, env });
}

export function resolveEnvironmentRuntimeInputs({ repositoryRoot, checkoutRoot, ecosystem, project,
  candidateRecord = null, located = null, workProjectDir = null, scratchRoot = ATTEMPT_SCRATCH_ROOT,
  hostPath = undefined, env = process.env }) {
  const ready = resolveCurrentEnvironmentInputs({ repositoryRoot, checkoutRoot, ecosystem, project,
    candidateRecord, located });
  if (!ready.ok) return ready;
  return composeRuntimeInputs(ready, { repositoryRoot, workProjectDir, scratchRoot, hostPath, env });
}

export function resolveHostRuntimeInputs({ checkoutRoot, scratchRoot, hostPath, env = process.env }) {
  return composeRuntimeInputs({ toolchains: {}, preparation: null, projectDir: checkoutRoot, checkoutRoot,
    environment: { id: null }, record_status: "not_applicable",
    provenance: { toolchains: {}, dependencies: null } },
  { workProjectDir: null, scratchRoot, hostPath, env });
}

const depth = (project) => project === "." ? 0 : project.length;

export function selectContainingProject(candidates, relative) {
  return [...new Set(candidates)]
    .filter((project) => project === "." || relative === project || relative.startsWith(`${project}/`))
    .sort((left, right) => depth(right) - depth(left))[0] ?? null;
}

export function selectConfiguredFileRunner({ repositoryRoot, target }) {
  const file = repositoryRuntimeConfigPath(repositoryRoot);
  let saved;
  try {
    saved = readRepositoryRuntimeConfig(repositoryRoot);
  } catch (error) {
    return Object.freeze({ ok: false, reason: "configuration_invalid", file, project: null,
      candidates: Object.freeze([]), message: error.message });
  }
  const explicit = saved.present ? saved.runners : [];
  const { configuration } = loadExecutionConfiguration(repositoryRoot);
  const recorded = configuration.selection.map(({ provider_id: id, project }) => ({ project,
    runner: TEST_RUNTIME_RUNNER_CATALOG.runners.find(({ runner_id: runnerId }) => runnerId === id)?.name ?? id }));
  const project = selectContainingProject([...explicit, ...recorded, ...configuration.environments]
    .map((entry) => entry.project), target);
  const choices = explicit.filter((entry) => entry.project === project);
  const selections = choices.length > 0 ? choices : recorded.filter((entry) => entry.project === project);
  const candidates = Object.freeze(project === null ? []
    : [...new Set(selections.filter((entry) => entry.project === project).map((entry) => entry.runner))].sort());
  if (candidates.length !== 1) {
    return Object.freeze({ ok: false, reason: candidates.length === 0 ? "runner_unconfigured" : "runner_ambiguous",
      file, project, candidates });
  }
  return Object.freeze({ ok: true, runner: candidates[0], project });
}

const TEST_PROOF_FAMILY_SUFFIXES = Object.freeze(TEST_RUNTIME_RUNNER_CATALOG.runners.map((runner) =>
  Object.freeze({ ecosystem: runner.dependency_ecosystem,
    suffixes: testProofProviderFamily(runner.selector_kind)?.source_suffixes ?? [] })));

export function suffixEcosystems(target) {
  return [...new Set(TEST_PROOF_FAMILY_SUFFIXES.filter(({ suffixes }) =>
    suffixes.some((suffix) => target.endsWith(suffix))).map(({ ecosystem }) => ecosystem))].sort();
}

const contains = (project, relative) => project === "." || relative === project ||
  relative.startsWith(`${project}/`);

function routeFailure(code, message, detail, recovery) {
  return Object.freeze({ configured: true, ok: false, failure: Object.freeze({ ok: false, code, message,
    detail, recovery }) });
}

function environmentSelectionRecovery() {
  return Object.freeze({ owner: "environment selection",
    statement: "Select a valid environment. Workers request a frozen assignment correction and an authorized successor." });
}

function declaredEnvironment(declared, runner) {
  return Object.freeze({ id: declared.id, ecosystem: declared.ecosystem, project: declared.project,
    members: declared.members, runners: Object.freeze([]),
    toolchains: Object.freeze([...new Set([...DEPENDENCY_ECOSYSTEMS[declared.ecosystem].toolchains,
      ...(runner?.toolchains ?? [])])].sort()) });
}

export function resolveProofEnvironment({ repositoryRoot, checkoutRoot = repositoryRoot, target, runner,
  environment = null, unconfigured = "discover" }) {
  const loaded = loadExecutionConfiguration(repositoryRoot);
  const route = { requested_environment: environment, runner: runner?.runner_id ?? null,
    suffix_ecosystems: runner === null ? [] : suffixEcosystems(target) };
  const ecosystem = runner?.dependency_ecosystem ?? null;
  const published = loaded.configuration.environments ?? [];
  if (published.length === 0 && unconfigured === "launcher" && environment === null) {
    return { configured: false, failure: null };
  }

  const declared = discoverRepositoryEnvironments(checkoutRoot, TEST_RUNTIME_RUNNER_CATALOG.runners,
    { targets: [runner === null ? `${target}/member` : target] });
  const declaredOwning = declared.filter((entry) => (ecosystem === null || entry.ecosystem === ecosystem) &&
    contains(entry.project, target));
  const owning = published.filter((entry) => (ecosystem === null || entry.ecosystem === ecosystem) && contains(entry.project, target));
  const applicable = [...new Set([...owning, ...declaredOwning].map(({ id }) => id))].sort();
  let selected;
  if (environment !== null) {
    selected = published.find(({ id }) => id === environment) ?? null;
    if (selected === null) {

      const named = declared.find(({ id }) => id === environment) ?? null;
      if (named !== null) selected = declaredEnvironment(named, runner);
    }
    if (selected === null) {
      return routeFailure(TEST_RUNTIME_READINESS_CODES.ENVIRONMENT_UNKNOWN,
        `no environment ${environment} is published or declared by this checkout`,
        { ...route, target, reason: "environment_unknown",
          prepared_environments: published.map(({ id }) => id), valid_choices: applicable },
        environmentSelectionRecovery());
    }
    const reason = ecosystem !== null && selected.ecosystem !== ecosystem ? "ecosystem_mismatch"
      : !contains(selected.project, target) ? "target_outside_environment" : null;
    if (reason !== null) {
      return routeFailure(TEST_RUNTIME_READINESS_CODES.ENVIRONMENT_INCOMPATIBLE,
        `environment ${environment} cannot run ${runner?.runner_id ?? "the harness"} for ${target}: ${reason}`,
        { ...route, target, reason, environment_runners: selected.runners, valid_choices: applicable }, environmentSelectionRecovery());
    }
  } else {
    const project = selectContainingProject([...owning, ...declaredOwning].map(({ project: root }) => root),
      target);
    if (project === null) return { configured: false, failure: null };
    const choices = [...new Set([...owning, ...declaredOwning].filter((entry) => entry.project === project)
      .map(({ id }) => id))];
    if (choices.length > 1) return routeFailure(TEST_RUNTIME_READINESS_CODES.ENVIRONMENT_INCOMPATIBLE,
      `several environments own ${target}; select environment explicitly`,
      { ...route, target, reason: "environment_ambiguous", valid_choices: choices }, environmentSelectionRecovery());
    selected = owning.find((entry) => entry.project === project) ??
      declaredEnvironment(declaredOwning.find((entry) => entry.project === project), runner);
  }
  return Object.freeze({ configured: true, ok: true, project: selected.project,
    environment: selected, published: published.includes(selected), applicable: Object.freeze(applicable),
    route: Object.freeze({ ...route, environment: selected.id,
      basis: environment === null ? "saved_runner_binding_and_project_ownership" : "named_environment" }) });
}

export function configuredPytestRuntime({ located, runtime }) {
  if (!located.configured) return { configured: false };
  if (!located.ok) return located;
  if (!runtime.ok) return { configured: true, ok: false, failure: runtime };
  const unavailable = configuredExecutableFailure(runtime, runtime.executables.python);
  if (unavailable !== null) return { configured: true, ok: false, failure: unavailable };
  return { configured: true, ok: true, project: located.project, route: located.route,
    interpreter: runtime.executables.python, readiness_digest: runtime.identity.readiness_digest,
    toolchains: runtime.identity.toolchains, dependencies: runtime.identity.dependencies,
    read_only_binds: runtime.binds,
    dependency_roots: runtime.values.venv === undefined ? [] : [runtime.values.venv] };
}
