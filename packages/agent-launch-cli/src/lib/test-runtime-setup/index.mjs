

import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

import { TEST_RUNTIME_RUNNER_CATALOG } from "@agent-chassis/controlled-contract/test-proof";

import { DEPENDENCY_ECOSYSTEMS } from "./ecosystems.mjs";
import {
  TEST_RUNTIME_READINESS_RELATIVE_PATH,
  beginPreparation,
  loadReadiness,
  measureProjectInputs,
  settlePreparation,
  testRuntimeEnvironmentId
} from "./readiness.mjs";
import { TOOLCHAIN_NAMES, TOOLCHAIN_RECIPES, currentPlatformKey } from "./recipes.mjs";
import { TestRuntimeSetupError, findOnPath, resolveToolchain } from "./toolchains.mjs";
import { fingerprintPopulation, measurePopulationContent } from "./tree-identity.mjs";
import { verifyCandidateReadiness } from "../test-execution/setup-verification.mjs";

export { TestRuntimeSetupError, findOnPath };
export const TEST_RUNTIME_SETUP_RESULT_SCHEMA_VERSION = "agent-launch-test-runtime-setup-result.v1";
export const SUPPORTED_SETUP_PLATFORMS = Object.freeze(["linux-x64"]);

export function testRuntimeRunnerNames() {
  return TEST_RUNTIME_RUNNER_CATALOG.runners.map(({ name }) => name);
}

export function testRuntimeRunners() {
  return TEST_RUNTIME_RUNNER_CATALOG.runners;
}

export function testRuntimeToolchainCommands() {
  return Object.fromEntries(TOOLCHAIN_NAMES.map((name) =>
    [name, TOOLCHAIN_RECIPES[name].host_command]));
}

function setupFailure(code, message, detail = {}) {
  return { code, message, detail };
}

function componentFromError(base, error) {
  if (!(error instanceof TestRuntimeSetupError)) throw error;
  return { ...base, status: "failed", code: error.code, message: error.message, detail: error.detail };
}

export function testRuntimeEcosystems() {
  return Object.fromEntries(Object.entries(DEPENDENCY_ECOSYSTEMS).map(([name, ecosystem]) =>
    [name, Object.freeze({ toolchains: ecosystem.toolchains })]));
}

export function environmentsFromRunnerSelection(runners) {
  const environments = new Map();
  for (const { runner, project = "." } of runners) {
    const descriptor = TEST_RUNTIME_RUNNER_CATALOG.runners.find(({ name }) => name === runner);
    const ecosystem = descriptor?.dependency_ecosystem ?? null;
    const key = `${ecosystem}\0${project}`;
    const entry = environments.get(key) ?? { ecosystem, project, members: [], runners: [] };
    if (!entry.runners.includes(runner)) entry.runners.push(runner);
    environments.set(key, entry);
  }
  return [...environments.values()];
}

function normalizedProject(project) {
  const normalized = project === undefined || project === "" ? "." : project;
  return normalized === "." || (!path.isAbsolute(normalized) &&
    !normalized.split("/").some((segment) => segment === "" || segment === "." || segment === ".."))
    ? normalized : null;
}

function publishedEnvironments(repositoryRoot) {
  const loaded = loadReadiness(repositoryRoot);
  const record = loaded.ok ? loaded.record : loaded.record ?? null;
  if (record === null) return null;
  return (record.environments ?? []).map(({ ecosystem, project, members, runners }) => ({
    ecosystem, project, members,
    runners: runners.map((id) => TEST_RUNTIME_RUNNER_CATALOG.runners
      .find(({ runner_id: runnerId }) => runnerId === id)?.name ?? id) }));
}

function resolveEnvironments({ repositoryRoot, environments }) {
  const names = testRuntimeRunnerNames();
  let requested = environments;
  if (requested === null || requested.length === 0) {
    requested = publishedEnvironments(repositoryRoot);
    if (requested === null) {
      return { ok: false, failure: setupFailure("test_runtime_selection_required",
        "no environment was requested and none is published; run setup from the repository root " +
        "so it detects the environments the repository declares",
        { available_runners: names }) };
    }
  }
  const resolved = new Map();
  for (const entry of requested) {
    const ecosystemName = entry.ecosystem;
    if (!Object.hasOwn(DEPENDENCY_ECOSYSTEMS, ecosystemName ?? "")) {
      const [unknownRunner] = (entry.runners ?? []).filter((runner) =>
        !TEST_RUNTIME_RUNNER_CATALOG.runners.some(({ name }) => name === runner));
      return { ok: false, failure: unknownRunner === undefined
        ? setupFailure("test_runtime_ecosystem_unknown", `unknown dependency ecosystem ${ecosystemName}`,
          { ecosystem: ecosystemName ?? null, available_ecosystems: Object.keys(DEPENDENCY_ECOSYSTEMS) })
        : setupFailure("test_runtime_runner_unknown", `unknown runner ${unknownRunner}`,
          { runner: unknownRunner, available_runners: names }) };
    }
    const project = normalizedProject(entry.project);
    if (project === null) {
      return { ok: false, failure: setupFailure("test_runtime_project_invalid",
        `project ${entry.project} must be a normalized repository-relative directory`,
        { project: entry.project }) };
    }
    const projectDir = project === "." ? repositoryRoot : path.join(repositoryRoot, project);
    if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) {
      return { ok: false, failure: setupFailure("test_runtime_project_invalid",
        `project ${project} is not a directory`, { project }) };
    }
    const members = [...new Set(entry.members ?? [])].sort();
    for (const member of members) {
      if (normalizedProject(member) === null || member === "." ||
          !existsSync(path.join(projectDir, member)) || !statSync(path.join(projectDir, member)).isDirectory()) {
        return { ok: false, failure: setupFailure("test_runtime_project_invalid",
          `workspace member ${member} of ${project} is not a normalized member directory`,
          { project, member }) };
      }
    }
    const descriptors = [];
    for (const runner of entry.runners ?? []) {
      const descriptor = TEST_RUNTIME_RUNNER_CATALOG.runners.find(({ name }) => name === runner);
      if (!descriptor) {
        return { ok: false, failure: setupFailure("test_runtime_runner_unknown",
          `unknown runner ${runner}`, { runner, available_runners: names }) };
      }
      if (descriptor.dependency_ecosystem !== ecosystemName) {
        return { ok: false, failure: setupFailure("test_runtime_runner_ecosystem_mismatch",
          `runner ${runner} uses ${descriptor.dependency_ecosystem} dependencies, not ${ecosystemName}`,
          { runner, ecosystem: ecosystemName, runner_ecosystem: descriptor.dependency_ecosystem }) };
      }
      descriptors.push(descriptor);
    }
    const key = `${ecosystemName}\0${project}`;
    const existing = resolved.get(key) ?? { id: testRuntimeEnvironmentId({ ecosystem: ecosystemName, project }),
      ecosystem: ecosystemName, project, projectDir, members: [], descriptors: [] };
    existing.members = [...new Set([...existing.members, ...members])].sort();
    for (const descriptor of descriptors) {
      if (!existing.descriptors.includes(descriptor)) existing.descriptors.push(descriptor);
    }
    resolved.set(key, existing);
  }
  const result = [...resolved.values()].map((entry) => ({ ...entry,
    descriptors: entry.descriptors.sort((left, right) => left.runner_id.localeCompare(right.runner_id)),
    toolchains: [...new Set([...DEPENDENCY_ECOSYSTEMS[entry.ecosystem].toolchains,
      ...entry.descriptors.flatMap(({ toolchains }) => toolchains)])].sort() }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return { ok: true, environments: result };
}

async function detectDependencies({ root, ecosystemName, project, projectDir, members, toolchains, env,
  selection, measure }) {
  const ecosystem = DEPENDENCY_ECOSYSTEMS[ecosystemName];
  const base = { kind: "dependencies", ecosystem: ecosystemName, project,
    environment: testRuntimeEnvironmentId({ ecosystem: ecosystemName, project }) };
  const inputs = measureProjectInputs(ecosystemName, projectDir, { members });
  if (inputs.status === "lock_missing") {
    return { ...base, status: "failed", code: "test_runtime_dependency_lock_missing",
      message: `project ${project} requires ${inputs.required} for ${ecosystemName} dependencies`,
      detail: { required: inputs.required } };
  }
  const inputFiles = Object.keys(inputs.files).sort();
  const none = () => ({ ...base, status: "ready", source: "none", record: { ecosystem: ecosystemName, project,
    members, status: "none", inputs: inputFiles, inputs_digest: inputs.inputs_digest, workspace_links: [] } });
  if (inputs.status === "none") return none();
  let detected;
  try {
    detected = await ecosystem.detect({ repositoryRoot: root, projectDir, project, members, inputs, toolchains,
      env, selection });
  } catch (error) {
    return componentFromError(base, error);
  }
  if (detected.none === true) return none();
  const exclude = detected.exclude ?? [];
  const identity = measure ? { content_digest: measurePopulationContent(detected.population, { exclude })
    .content_digest, fingerprint: fingerprintPopulation(detected.population, { exclude }) } : {};
  return { ...base, status: "ready", source: detected.source, dir: detected.dir,
    record: { ecosystem: ecosystemName, project, members, status: "present", source: detected.source,
      inputs: inputFiles, inputs_digest: inputs.inputs_digest, dir: detected.dir,
      population: detected.population, population_exclude: exclude,
      workspace_links: detected.workspace_links ?? [],
      ...(detected.stores === undefined ? {} : { stores: detected.stores }),
      ...(detected.cargo_config === undefined ? {} : { cargo_config: detected.cargo_config }), ...identity } };
}

export async function runTestRuntimeSetup({
  repositoryRoot,
  environments = null,
  toolchainVersions = {},
  toolchainExecutables = {},
  environmentSelections = {},
  dryRun = false,
  progress = () => {},
  env = process.env,
  platformKey = currentPlatformKey()
} = {}) {
  const result = (status, extra) => Object.freeze({
    schema_version: TEST_RUNTIME_SETUP_RESULT_SCHEMA_VERSION,
    status,
    ok: status === "ready" || status === "detected",
    readiness_path: TEST_RUNTIME_READINESS_RELATIVE_PATH,
    dry_run: dryRun,
    ...extra
  });
  let root;
  try {
    root = realpathSync(repositoryRoot);
  } catch {
    return result("failed", { failure: setupFailure("test_runtime_repository_invalid",
      "the repository root does not exist", { repository_root: repositoryRoot }) });
  }
  for (const name of [...Object.keys(toolchainVersions), ...Object.keys(toolchainExecutables)]) {
    if (!TOOLCHAIN_NAMES.includes(name)) {
      return result("failed", { failure: setupFailure("test_runtime_toolchain_unknown",
        `unknown toolchain ${name}`, { toolchain: name, available_toolchains: TOOLCHAIN_NAMES }) });
    }
  }
  for (const [name, executable] of Object.entries(toolchainExecutables)) {
    if (typeof executable !== "string" || !path.isAbsolute(executable)) {
      return result("failed", { failure: setupFailure("test_runtime_toolchain_executable_invalid",
        `the ${name} executable location must be an absolute path`,
        { toolchain: name, executable: executable ?? null }) });
    }
  }
  const resolved = resolveEnvironments({ repositoryRoot: root, environments });
  if (!resolved.ok) return result("failed", { failure: resolved.failure });
  const planned = resolved.environments;
  const selectionFacts = planned.flatMap(({ project, descriptors }) =>
    descriptors.map(({ runner_id: id }) => ({ provider_id: id, project })))
    .sort((left, right) => `${left.provider_id}\0${left.project}`
      .localeCompare(`${right.provider_id}\0${right.project}`));
  const environmentFacts = planned.map(({ id, ecosystem, project, members, descriptors, toolchains }) =>
    ({ id, ecosystem, project, members, runners: descriptors.map(({ runner_id: runnerId }) => runnerId),
      toolchains }));
  const facts = { environments: environmentFacts, selection: selectionFacts };
  if (!SUPPORTED_SETUP_PLATFORMS.includes(platformKey)) {
    return result("failed", { ...facts, failure: setupFailure(
      "test_runtime_platform_unsupported", `local test-runtime setup does not support ${platformKey}`,
      { platform: platformKey, supported: SUPPORTED_SETUP_PLATFORMS }) });
  }

  const selectedToolchains = [...new Set(planned.flatMap(({ toolchains }) => toolchains))].sort();
  for (const [name, executable] of Object.entries(toolchainExecutables)) {
    if (!selectedToolchains.includes(name)) {
      return result("failed", { ...facts,
        failure: setupFailure("test_runtime_toolchain_unused",
          `no detected environment uses the ${name} toolchain`,
          { toolchain: name, executable, selected_toolchains: selectedToolchains }) });
    }
  }

  for (const [id, chosen] of Object.entries(environmentSelections)) {
    const environment = planned.find((entry) => entry.id === id);
    const fields = Object.keys(chosen ?? {});
    if (environment === undefined || environment.ecosystem !== "python" ||
        fields.length !== 1 || fields[0] !== "virtual_environment" ||
        typeof chosen.virtual_environment !== "string" || !path.isAbsolute(chosen.virtual_environment)) {
      return result("failed", { ...facts, failure: setupFailure("test_runtime_environment_selection_invalid",
        `environment selection ${id} is not an absolute virtual_environment for a detected Python environment`,
        { environment: id, selection: chosen ?? null,
          detected_environments: planned.map(({ id: known }) => known),
          supported: "{ virtual_environment: <absolute path> } for a python@<project> environment; npm, Go, " +
            "Deno and Cargo dependencies follow their own installation root and configuration" }) });
    }
  }
  if (dryRun) {
    return detectAndVerify({ root, planned, facts, environmentFacts, selectionFacts, result,
      toolchainVersions, toolchainExecutables, environmentSelections, platformKey, env, dryRun, progress });
  }
  const begun = beginPreparation(root, { environments: environmentFacts, selection: selectionFacts });
  if (!begun.ok) {
    return result("failed", { ...facts, failure: setupFailure(begun.code, begun.message, begun.detail) });
  }
  const { attempt } = begun;
  let outcome;
  try {
    outcome = await detectAndVerify({ root, planned, facts, environmentFacts, selectionFacts, result,
      toolchainVersions, toolchainExecutables, environmentSelections, platformKey, env, dryRun, progress });
  } catch (error) {
    outcome = result("failed", { ...facts,
      failure: setupFailure("test_runtime_setup_unexpected_error",
        `test-runtime detection stopped unexpectedly: ${error?.message ?? String(error)}`,
        { error_code: error?.code ?? null, error_name: error?.name ?? null, stack: error?.stack ?? null }) });
  }
  const preparation = { id: attempt.preparation.id };
  if (outcome.publish === undefined) {
    const settled = settlePreparation(attempt, { status: "failed", result: outcome });
    return settled.ok ? result("failed", { ...outcome, preparation }) : result("failed", { ...outcome, preparation,
      publication_failure: setupFailure(settled.code, settled.message, settled.detail) });
  }
  const settled = settlePreparation(attempt, { status: "ready", body: outcome.publish });
  if (!settled.ok) {
    return result("failed", { ...outcome.report, preparation,
      failure: setupFailure(settled.code, settled.message, settled.detail) });
  }
  return result("ready", { ...outcome.report, preparation,
    readiness_digest: settled.record.readiness_digest });
}

async function detectAndVerify({ root, planned, facts, environmentFacts, selectionFacts, result,
  toolchainVersions, toolchainExecutables, environmentSelections, platformKey, env, dryRun, progress }) {

  const components = [];
  const toolchains = {};
  const toolchainProjects = new Map();
  for (const { toolchains: needed, projectDir } of planned) {
    for (const name of needed) {
      toolchainProjects.set(name, [...new Set([...(toolchainProjects.get(name) ?? []), projectDir])]);
    }
  }
  for (const [name, projectDirs] of [...toolchainProjects].sort(([left], [right]) => left.localeCompare(right))) {
    const base = { kind: "toolchain", name };
    progress({ phase: "toolchain", toolchain: name });
    try {
      const component = await resolveToolchain({ name, requestedVersion: toolchainVersions[name] ?? null,
        configuredExecutable: toolchainExecutables[name] ?? null, projectDirs, env, measure: !dryRun });
      components.push({ ...base, status: "ready", version: component.version,
        version_source: component.version_source, source: component.source, root: component.root });
      toolchains[name] = component;
    } catch (error) {
      components.push(componentFromError(base, error));
    }
  }

  const detections = [];
  for (const { id, ecosystem: ecosystemName, project, projectDir, members } of planned) {
    const needed = DEPENDENCY_ECOSYSTEMS[ecosystemName].toolchains;
    const base = { kind: "dependencies", ecosystem: ecosystemName, project, environment: id };
    if (needed.some((name) => !toolchains[name])) {
      components.push({ ...base, status: "blocked", code: "test_runtime_toolchain_unavailable",
        message: `requires ready toolchains: ${needed.join(", ")}` });
      continue;
    }
    progress({ phase: "dependencies", environment: id });
    const detected = await detectDependencies({ root, ecosystemName, project, projectDir, members, toolchains,
      env, selection: environmentSelections[id] ?? null, measure: !dryRun });
    const { record, ...fact } = detected;
    components.push(fact);
    if (record) detections.push(record);
  }

  const failed = components.filter(({ status }) => status === "failed" || status === "blocked");
  if (failed.length > 0) {
    return result("failed", { ...facts, components, verification: [],
      failure: setupFailure("test_runtime_setup_incomplete",
        `${failed.length} requested component(s) are not ready; this detection failed`,
        { failed_components: failed.map(({ kind, name, ecosystem, project, environment, code }) =>
          ({ kind, name: name ?? ecosystem, project: project ?? null, environment: environment ?? null,
            code })) }) });
  }
  if (dryRun) return result("detected", { ...facts, components });
  const candidateRecord = {
    status: "ready",
    repository_root: root,
    platform: platformKey,
    environments: environmentFacts,
    selection: selectionFacts,
    toolchains: Object.fromEntries(Object.entries(toolchains).map(([name, component]) => [name, {
      name, version: component.version, version_source: component.version_source,
      source: component.source, root: component.root, executables: component.executables,
      population: component.population, population_exclude: component.population_exclude,
      content_digest: component.content_digest, fingerprint: component.fingerprint
    }])),
    preparations: detections
  };
  const verification = await verifyCandidateReadiness({ repositoryRoot: root, candidateRecord,
    environments: planned, progress });
  const unverified = verification.filter(({ ok }) => !ok);
  if (unverified.length > 0) {
    return result("failed", { ...facts, components, verification,
      failure: setupFailure("test_runtime_sandbox_verification_failed",
        `${unverified.length} sandbox verification check(s) failed; this detection failed`,
        { failed_checks: unverified.map(({ environment, provider_id: id, project, check, code }) =>
          ({ environment, provider_id: id, project, check, code })) }) });
  }
  const { status: _candidate, ...body } = candidateRecord;
  return { publish: { ...body,
    verification: verification.map(({ environment, provider_id: id, project, check }) =>
      ({ environment, provider_id: id, project, check, status: "passed" })),
    created_at: new Date().toISOString() },
  report: { ...facts, components, verification } };
}
