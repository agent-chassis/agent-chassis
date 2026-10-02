

import { spawnSync } from "node:child_process";
import { appendFileSync, lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync }
  from "node:fs";
import path from "node:path";

import { TEST_RUNTIME_RUNNER_CATALOG, testProofProviderFamily } from
  "@agent-chassis/controlled-contract/test-proof";

import { DEFAULT_SYSTEM_READ_ONLY_ROOTS } from "../launch-isolation-executable.mjs";
import { ATTEMPT_SCRATCH_ROOT, DEPENDENCY_ECOSYSTEMS } from "../test-runtime-setup/ecosystems.mjs";
import {
  TEST_RUNTIME_READINESS_CODES,
  loadReadiness,
  readinessRecovery,
  resolveReadyEnvironmentInputs,
  runnerNotProvedStatement,
  resolveReadyRunnerInputs
} from "../test-runtime-setup/readiness.mjs";

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

function composeRuntimeInputs(ready, { repositoryRoot = null, workProjectDir, scratchRoot, compilerCache = false }) {
  const toolchainBinds = [];
  const binDirs = [];
  const executables = {};
  const toolchainIdentity = {};
  for (const [name, toolchain] of Object.entries(ready.toolchains)) {
    Object.assign(executables, toolchain.executables);
    for (const executable of Object.values(toolchain.executables)) {
      const directory = path.dirname(executable);
      if (!binDirs.includes(directory)) binDirs.push(directory);
    }
    const roots = toolchain.root && !isUnderSystemRoot(toolchain.root) ? [toolchain.root] : [];
    for (const root of roots) toolchainBinds.push({ src: root, dst: root, toolchain: name });
    toolchainIdentity[name] = { version: toolchain.version, source: toolchain.source,
      content_digest: toolchain.content_digest };
  }
  const ecosystem = DEPENDENCY_ECOSYSTEMS[ready.preparation.ecosystem];

  const cacheDirectory = compilerCache && typeof ecosystem.compilerCacheEnv === "string"
    ? nativeCompilerCachePath(repositoryRoot, ecosystem.compilerCacheName(ready.preparation)) : null;
  const binding = workProjectDir !== null && ready.preparation.status === "present" &&
    typeof ecosystem.workingCopyBinding === "function"
    ? ecosystem.workingCopyBinding({ dependency: ready.preparation, workProjectDir, scratchRoot })
    : ecosystem.runtimeBinding({ dependency: ready.preparation, projectHostDir: ready.projectDir, scratchRoot,
      compilerCache: cacheDirectory });
  const binds = [...toolchainBinds.map(({ src, dst }) => ({ src, dst })), ...binding.binds];
  if (binding.values.python) {
    executables.python = binding.values.python;
    binDirs.unshift(path.dirname(binding.values.python));
  }
  const env = {
    PATH: [...binDirs, "/usr/local/bin", "/usr/bin", "/bin"].join(path.delimiter),
    HOME: `${scratchRoot}/home`,
    LANG: "C.UTF-8",
    CI: "true",
    ...binding.env,
    ...(cacheDirectory === null ? {} : { [ecosystem.compilerCacheEnv]: cacheDirectory })
  };
  return Object.freeze({
    ok: true,
    binds: uniqueBinds(binds),

    toolchainBinds: Object.freeze(toolchainBinds),
    dependencyBinds: Object.freeze(binding.binds),
    toolchains: ready.toolchains,
    bindingEnv: Object.freeze({ ...binding.env }),
    mountpoints: binding.mountpoints,
    directories: Object.freeze([...(binding.directories ?? [])]),
    links: binding.links ?? [],

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
      readiness_digest: ready.readiness_digest,
      environment: ready.environment.id,
      toolchains: toolchainIdentity,
      dependencies: Object.freeze({
        ecosystem: ready.preparation.ecosystem,
        status: ready.preparation.status,
        source: ready.preparation.source ?? null,
        inputs_digest: ready.preparation.inputs_digest,
        content_digest: ready.preparation.content_digest ?? null
      })
    })
  });
}

export function resolveRunnerRuntimeInputs({ repositoryRoot, checkoutRoot, descriptor, project,
  candidateRecord = null, workProjectDir = null, scratchRoot = ATTEMPT_SCRATCH_ROOT, compilerCache = false }) {
  const ready = resolveReadyRunnerInputs({ repositoryRoot, checkoutRoot, descriptor, project,
    candidateRecord });
  if (!ready.ok) return ready;
  return composeRuntimeInputs(ready, { repositoryRoot, workProjectDir, scratchRoot, compilerCache });
}

export function resolveEnvironmentRuntimeInputs({ repositoryRoot, checkoutRoot, ecosystem, project,
  candidateRecord = null, workProjectDir = null, scratchRoot = ATTEMPT_SCRATCH_ROOT }) {
  const ready = resolveReadyEnvironmentInputs({ repositoryRoot, checkoutRoot, ecosystem, project,
    candidateRecord });
  if (!ready.ok) return ready;
  return composeRuntimeInputs(ready, { workProjectDir, scratchRoot });
}

const depth = (project) => project === "." ? 0 : project.length;

export function selectContainingProject(candidates, relative) {
  return [...new Set(candidates)]
    .filter((project) => project === "." || relative === project || relative.startsWith(`${project}/`))
    .sort((left, right) => depth(right) - depth(left))[0] ?? null;
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

function unrecordedInstallationRoot({ checkoutRoot, environment, target, record }) {
  const ecosystem = DEPENDENCY_ECOSYSTEMS[environment.ecosystem];
  const recorded = new Set((record.environments ?? []).filter((entry) =>
    entry.ecosystem === environment.ecosystem).map(({ project }) => project));
  const members = new Set(environment.members.map((member) =>
    environment.project === "." ? member : `${environment.project}/${member}`));
  for (let directory = path.posix.dirname(target); directory !== "." && directory !== environment.project;
    directory = path.posix.dirname(directory)) {
    if (!contains(environment.project, directory) || recorded.has(directory) || members.has(directory)) continue;
    let declared;
    try {
      declared = ecosystem.manifests(path.join(checkoutRoot, directory));
    } catch {
      declared = null;
    }
    if (declared?.status === "present") return directory;
  }
  return null;
}

export function resolveProofEnvironment({ repositoryRoot, checkoutRoot = repositoryRoot, target, runner,
  environment = null }) {
  const loaded = loadReadiness(repositoryRoot);
  const recovery = readinessRecovery();
  const route = { requested_environment: environment, runner: runner.runner_id,
    suffix_ecosystems: suffixEcosystems(target) };
  if (!loaded.ok) {
    if (loaded.code !== TEST_RUNTIME_READINESS_CODES.NOT_READY) {
      return { configured: true, ok: false, failure: loaded };
    }
    return environment === null ? { configured: false, failure: loaded }
      : routeFailure(TEST_RUNTIME_READINESS_CODES.ENVIRONMENT_UNKNOWN,
        `no prepared environment ${environment} is published for this repository`,
        { ...route, target, prepared_environments: [] }, recovery);
  }
  const { record } = loaded;
  const environments = record.environments ?? [];
  const applicable = environments.filter((entry) => entry.ecosystem === runner.dependency_ecosystem &&
    entry.runners.includes(runner.runner_id) && contains(entry.project, target));
  let selected;
  if (environment !== null) {
    selected = environments.find(({ id }) => id === environment) ?? null;
    if (selected === null) {
      return routeFailure(TEST_RUNTIME_READINESS_CODES.ENVIRONMENT_UNKNOWN,
        `no prepared environment ${environment} is published for this repository`,
        { ...route, target, prepared_environments: environments.map(({ id }) => id),
          valid_choices: applicable.map(({ id }) => id) }, recovery);
    }
    const reason = selected.ecosystem !== runner.dependency_ecosystem ? "ecosystem_mismatch"
      : !selected.runners.includes(runner.runner_id) ? "runner_not_proved"
        : !contains(selected.project, target) ? "target_outside_environment" : null;
    if (reason !== null) {
      return routeFailure(TEST_RUNTIME_READINESS_CODES.ENVIRONMENT_INCOMPATIBLE,
        `prepared environment ${environment} cannot run ${runner.runner_id} for ${target}: ${reason}`,
        { ...route, target, reason, environment_runners: selected.runners,
          valid_choices: applicable.map(({ id }) => id) }, recovery);
    }
  } else {
    const project = selectContainingProject(environments.filter((entry) =>
      entry.ecosystem === runner.dependency_ecosystem).map(({ project: root }) => root), target);
    if (project === null) return { configured: false, failure: null };
    selected = environments.find((entry) => entry.ecosystem === runner.dependency_ecosystem &&
      entry.project === project);

    const nearer = unrecordedInstallationRoot({ checkoutRoot, environment: selected, target, record });
    if (nearer !== null) {
      return routeFailure(TEST_RUNTIME_READINESS_CODES.INVENTORY_STALE,
        `${nearer} declares its own ${selected.ecosystem} dependencies but was not inventoried by setup`,
        { ...route, target, environment: selected.id, unrecorded_project: nearer }, recovery);
    }
    if (!selected.runners.includes(runner.runner_id)) {
      return routeFailure(TEST_RUNTIME_READINESS_CODES.RUNNER_NOT_PREPARED,
        `environment ${selected.id} owns ${target} but did not prove ${runner.runner_id}`,
        { ...route, target, environment: selected.id, environment_runners: selected.runners,
          valid_choices: applicable.map(({ id }) => id) },
        readinessRecovery(runnerNotProvedStatement(runner, selected.project)));
    }
  }
  const added = unrecordedInstallationRoot({ checkoutRoot, environment: selected, target, record });
  if (added !== null) {
    return routeFailure(TEST_RUNTIME_READINESS_CODES.INVENTORY_STALE,
      `${added} declares its own ${selected.ecosystem} dependencies but was not inventoried by setup`,
      { ...route, target, environment: selected.id, unrecorded_project: added }, recovery);
  }
  return Object.freeze({ configured: true, ok: true, project: selected.project,
    environment: selected, applicable: Object.freeze(applicable.map(({ id }) => id)), route: Object.freeze({ ...route, environment: selected.id,
      basis: environment === null ? "saved_runner_binding_and_project_ownership" : "named_environment" }) });
}

export function resolveConfiguredPytestRuntime({ repositoryRoot, checkoutRoot, target, runner,
  environment = null }) {
  const located = resolveProofEnvironment({ repositoryRoot, checkoutRoot, target, runner, environment });
  if (!located.configured) return { configured: false };
  if (!located.ok) return located;
  const runtime = resolveRunnerRuntimeInputs({ repositoryRoot, checkoutRoot, descriptor: runner,
    project: located.project });
  if (!runtime.ok) return { configured: true, ok: false, failure: runtime };
  return { configured: true, ok: true, project: located.project, route: located.route,
    interpreter: runtime.executables.python, readiness_digest: runtime.identity.readiness_digest,
    toolchains: runtime.identity.toolchains, dependencies: runtime.identity.dependencies,
    read_only_binds: runtime.binds,
    dependency_roots: runtime.values.venv === undefined ? [] : [runtime.values.venv] };
}
