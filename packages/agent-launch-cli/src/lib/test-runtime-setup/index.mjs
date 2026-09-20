

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { TEST_RUNTIME_RUNNER_CATALOG } from "@agent-chassis/controlled-contract/test-proof";

import { DEPENDENCY_ECOSYSTEMS, makeTreeReadOnly, makeTreeWritable } from "./ecosystems.mjs";
import {
  TEST_RUNTIME_READINESS_RELATIVE_PATH,
  defaultStateRoot,
  defaultToolchainRoot,
  digestJson,
  loadReadiness,
  measureProjectInputs,
  publishReadiness,
  withdrawReadiness
} from "./readiness.mjs";
import {
  TEST_RUNTIME_RECIPES_VERSION,
  TOOLCHAIN_NAMES,
  TOOLCHAIN_RECIPES,
  currentPlatformKey
} from "./recipes.mjs";
import { TestRuntimeSetupError, findOnPath, resolveToolchain } from "./toolchains.mjs";
import { fingerprintPopulation, measurePopulationContent } from "./tree-identity.mjs";
import { verifyCandidateReadiness } from "../test-execution/setup-verification.mjs";

export { TestRuntimeSetupError, findOnPath };
export const TEST_RUNTIME_SETUP_RESULT_SCHEMA_VERSION = "agent-launch-test-runtime-setup-result.v1";
export const SUPPORTED_SETUP_PLATFORMS = Object.freeze(["linux-x64"]);
const PREPARED_MARKER_FILE = ".agent-chassis-prepared.json";
const HOST_TOOLCHAIN_MODES = Object.freeze(["reuse", "ignore"]);

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

function resolveSelection({ repositoryRoot, runners }) {
  const names = testRuntimeRunnerNames();
  let requested = runners;
  if (requested === null || requested.length === 0) {
    const loaded = loadReadiness(repositoryRoot);
    if (!loaded.ok) {
      return { ok: false, failure: setupFailure("test_runtime_selection_required",
        "select at least one installed runner with --runner <name>[@<project>]",
        { available_runners: names }) };
    }
    requested = loaded.record.selection.map(({ provider_id: id, project }) =>
      ({ runner: TEST_RUNTIME_RUNNER_CATALOG.runners.find(({ runner_id: runnerId }) =>
        runnerId === id)?.name ?? id, project }));
  }
  const selection = [];
  for (const { runner, project } of requested) {
    const descriptor = TEST_RUNTIME_RUNNER_CATALOG.runners.find(({ name }) => name === runner);
    if (!descriptor) {
      return { ok: false, failure: setupFailure("test_runtime_runner_unknown",
        `unknown runner ${runner}`, { runner, available_runners: names }) };
    }
    const normalized = project === undefined || project === "" ? "." : project;
    if (normalized !== "." && (path.isAbsolute(normalized) ||
        normalized.split("/").some((segment) => segment === "" || segment === "." || segment === ".."))) {
      return { ok: false, failure: setupFailure("test_runtime_project_invalid",
        `project ${project} must be a normalized repository-relative directory`, { project }) };
    }
    const projectDir = normalized === "." ? repositoryRoot : path.join(repositoryRoot, normalized);
    if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) {
      return { ok: false, failure: setupFailure("test_runtime_project_invalid",
        `project ${normalized} is not a directory`, { project: normalized }) };
    }
    if (!selection.some((entry) => entry.descriptor === descriptor && entry.project === normalized)) {
      selection.push({ descriptor, project: normalized, projectDir });
    }
  }
  selection.sort((left, right) => `${left.descriptor.runner_id}\0${left.project}`
    .localeCompare(`${right.descriptor.runner_id}\0${right.project}`));
  return { ok: true, selection };
}

function readPreparedMarker(directory) {
  try {
    return JSON.parse(readFileSync(path.join(directory, PREPARED_MARKER_FILE), "utf8"));
  } catch {
    return null;
  }
}

async function prepareDependencies({ ecosystemName, project, projectDir, toolchains, stateRoot,
  env, dryRun }) {
  const ecosystem = DEPENDENCY_ECOSYSTEMS[ecosystemName];
  const base = { kind: "dependencies", ecosystem: ecosystemName, project };
  const inputs = measureProjectInputs(ecosystemName, projectDir);
  if (inputs.status === "lock_missing") {
    return { ...base, status: "failed", code: "test_runtime_dependency_lock_missing",
      message: `project ${project} requires ${inputs.required} for ${ecosystemName} dependencies`,
      detail: { required: inputs.required } };
  }
  const inputFiles = Object.keys(inputs.files).sort();
  if (inputs.status === "none") {
    return { ...base, status: "ready", record: { ecosystem: ecosystemName, project, status: "none",
      inputs: inputFiles, inputs_digest: inputs.inputs_digest } };
  }
  const key = digestJson({ ecosystem: ecosystemName, project, inputs: inputs.inputs_digest,
    toolchains: Object.fromEntries(ecosystem.toolchains.map((name) =>
      [name, toolchains[name].content_digest])) }).slice(7, 31);
  const directory = path.join(stateRoot, "prepared", ecosystemName, key);
  const marker = readPreparedMarker(directory);
  if (marker !== null) {
    const population = marker.population_relative.map((relative) => path.join(directory, relative));
    let current = null;
    try {
      current = fingerprintPopulation(population, { exclude: marker.population_exclude });
    } catch {
      current = null;
    }
    if (current === marker.fingerprint) {
      return { ...base, status: "ready", reused: true, record: { ecosystem: ecosystemName, project,
        status: "present", inputs: inputFiles, inputs_digest: inputs.inputs_digest, dir: directory,
        population, population_exclude: marker.population_exclude,
        content_digest: marker.content_digest, fingerprint: marker.fingerprint } };
    }
  }
  if (dryRun) return { ...base, status: "planned", directory };
  const staging = `${directory}.partial-${randomBytes(6).toString("hex")}`;
  const workspace = `${directory}.work-${randomBytes(6).toString("hex")}`;
  mkdirSync(staging, { recursive: true });
  mkdirSync(workspace, { recursive: true });
  try {
    const prepared = await ecosystem.prepare({ projectDir, outputDir: staging, stagingDir: workspace,
      toolchains, manifestFiles: inputs.files, stateRoot, env });
    const exclude = prepared.exclude ?? [];
    for (const relative of prepared.population) makeTreeReadOnly(path.join(staging, relative));
    makeTreeWritable(directory);
    rmSync(directory, { recursive: true, force: true });
    renameSync(staging, directory);
    const population = prepared.population.map((relative) => path.join(directory, relative));
    const identity = measurePopulationContent(population, { exclude });
    const fingerprint = fingerprintPopulation(population, { exclude });
    writeFileSync(path.join(directory, PREPARED_MARKER_FILE), `${JSON.stringify({
      schema_version: "agent-chassis-prepared-dependencies-marker.v1", ecosystem: ecosystemName,
      project, inputs_digest: inputs.inputs_digest, population_relative: prepared.population,
      population_exclude: exclude, content_digest: identity.content_digest, fingerprint
    }, null, 2)}\n`);
    return { ...base, status: "ready", reused: false, record: { ecosystem: ecosystemName, project,
      status: "present", inputs: inputFiles, inputs_digest: inputs.inputs_digest, dir: directory,
      population, population_exclude: exclude, content_digest: identity.content_digest,
      fingerprint } };
  } catch (error) {
    return componentFromError(base, error);
  } finally {
    makeTreeWritable(staging);
    rmSync(staging, { recursive: true, force: true });
    makeTreeWritable(workspace);
    rmSync(workspace, { recursive: true, force: true });
  }
}

export async function runTestRuntimeSetup({
  repositoryRoot,
  runners = null,
  toolchainVersions = {},
  toolchainExecutables = {},
  toolchainRoot = null,
  stateRoot = null,
  hostToolchains = "reuse",
  dryRun = false,
  env = process.env,
  platformKey = currentPlatformKey(),
  fetchImpl = globalThis.fetch
} = {}) {
  const result = (status, extra) => Object.freeze({
    schema_version: TEST_RUNTIME_SETUP_RESULT_SCHEMA_VERSION,
    status,
    ok: status === "ready" || status === "planned",
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
  if (!HOST_TOOLCHAIN_MODES.includes(hostToolchains)) {
    return result("failed", { failure: setupFailure("test_runtime_option_invalid",
      `host toolchain mode must be one of ${HOST_TOOLCHAIN_MODES.join(", ")}`) });
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
  for (const [label, value] of [["toolchain root", toolchainRoot], ["state root", stateRoot]]) {
    if (value !== null && !path.isAbsolute(value)) {
      return result("failed", { failure: setupFailure("test_runtime_option_invalid",
        `${label} must be an absolute path`) });
    }
  }
  const selected = resolveSelection({ repositoryRoot: root, runners });
  if (!selected.ok) return result("failed", { failure: selected.failure });
  const selectionFacts = selected.selection.map(({ descriptor, project }) =>
    ({ provider_id: descriptor.runner_id, project }));
  if (!SUPPORTED_SETUP_PLATFORMS.includes(platformKey)) {
    return result("failed", { selection: selectionFacts, failure: setupFailure(
      "test_runtime_platform_unsupported", `local test-runtime setup does not support ${platformKey}`,
      { platform: platformKey, supported: SUPPORTED_SETUP_PLATFORMS }) });
  }

  const selectedToolchains = [...new Set(selected.selection
    .flatMap(({ descriptor }) => descriptor.toolchains))].sort();
  for (const [name, executable] of Object.entries(toolchainExecutables)) {
    if (!selectedToolchains.includes(name)) {
      return result("failed", { selection: selectionFacts,
        failure: setupFailure("test_runtime_toolchain_unused",
          `no selected runner uses the ${name} toolchain`,
          { toolchain: name, executable, selected_toolchains: selectedToolchains }) });
    }
  }
  const resolvedToolchainRoot = toolchainRoot ?? defaultToolchainRoot(env);
  const resolvedStateRoot = stateRoot ?? defaultStateRoot(root, env);
  if (!dryRun) withdrawReadiness(root);

  const components = [];
  const toolchains = {};
  const toolchainProjects = new Map();
  for (const { descriptor, projectDir } of selected.selection) {
    for (const name of descriptor.toolchains) {
      toolchainProjects.set(name, [...new Set([...(toolchainProjects.get(name) ?? []), projectDir])]);
    }
  }
  for (const [name, projectDirs] of [...toolchainProjects].sort(([left], [right]) => left.localeCompare(right))) {
    const base = { kind: "toolchain", name };
    try {
      const component = await resolveToolchain({ name, requestedVersion: toolchainVersions[name] ?? null,
        configuredExecutable: toolchainExecutables[name] ?? null,
        projectDirs, toolchainRoot: resolvedToolchainRoot, hostToolchains, platformKey, env, dryRun,
        fetchImpl });
      components.push({ ...base, status: component.source === "planned_install" ? "planned" : "ready",
        version: component.version, version_source: component.version_source,
        source: component.source, reused: component.reused ?? false, root: component.root });
      if (component.source !== "planned_install") toolchains[name] = component;
    } catch (error) {
      components.push(componentFromError(base, error));
    }
  }

  const uv = findOnPath("uv", env.PATH);
  const preparations = [];
  const ecosystemProjects = new Map();
  for (const { descriptor, project, projectDir } of selected.selection) {
    ecosystemProjects.set(`${descriptor.dependency_ecosystem}\0${project}`,
      { ecosystemName: descriptor.dependency_ecosystem, project, projectDir });
  }
  for (const { ecosystemName, project, projectDir } of ecosystemProjects.values()) {
    const needed = DEPENDENCY_ECOSYSTEMS[ecosystemName].toolchains;
    const base = { kind: "dependencies", ecosystem: ecosystemName, project };
    if (needed.some((name) => !toolchains[name])) {
      components.push({ ...base, status: dryRun ? "planned" : "blocked",
        code: dryRun ? null : "test_runtime_toolchain_unavailable",
        message: `requires ready toolchains: ${needed.join(", ")}` });
      continue;
    }
    const prepared = await prepareDependencies({ ecosystemName, project, projectDir, toolchains,
      stateRoot: resolvedStateRoot, env: { ...env, uvExecutable: uv?.real ?? null }, dryRun });
    const { record, ...fact } = prepared;
    components.push(fact);
    if (record) preparations.push(record);
  }

  const failed = components.filter(({ status }) => status === "failed" || status === "blocked");
  if (dryRun) {
    return result(failed.length > 0 ? "failed" : "planned", { selection: selectionFacts,
      toolchain_root: resolvedToolchainRoot, state_root: resolvedStateRoot, components });
  }
  if (failed.length > 0) {
    return result("failed", { selection: selectionFacts, toolchain_root: resolvedToolchainRoot,
      state_root: resolvedStateRoot, components, verification: [],
      failure: setupFailure("test_runtime_setup_incomplete",
        `${failed.length} requested component(s) are not ready; no readiness was published`,
        { failed_components: failed.map(({ kind, name, ecosystem, project, code }) =>
          ({ kind, name: name ?? ecosystem, project: project ?? null, code })) }) });
  }
  const candidateRecord = {
    status: "ready",
    repository_root: root,
    platform: platformKey,
    recipes_version: TEST_RUNTIME_RECIPES_VERSION,
    toolchain_root: resolvedToolchainRoot,
    state_root: resolvedStateRoot,
    selection: selectionFacts,
    toolchains: Object.fromEntries(Object.entries(toolchains).map(([name, component]) => [name, {
      name, version: component.version, version_source: component.version_source,
      source: component.source, root: component.root, executables: component.executables,
      population: component.population, population_exclude: component.population_exclude,
      content_digest: component.content_digest, fingerprint: component.fingerprint
    }])),
    preparations
  };
  const verification = await verifyCandidateReadiness({ repositoryRoot: root, candidateRecord,
    selection: selected.selection });
  const unverified = verification.filter(({ ok }) => !ok);
  if (unverified.length > 0) {
    return result("failed", { selection: selectionFacts, toolchain_root: resolvedToolchainRoot,
      state_root: resolvedStateRoot, components, verification,
      failure: setupFailure("test_runtime_sandbox_verification_failed",
        `${unverified.length} sandbox verification check(s) failed; no readiness was published`,
        { failed_checks: unverified.map(({ provider_id: id, project, check, code }) =>
          ({ provider_id: id, project, check, code })) }) });
  }
  const published = publishReadiness(root, {
    ...candidateRecord,
    verification: verification.map(({ provider_id: id, project, check }) =>
      ({ provider_id: id, project, check, status: "passed" })),
    created_at: new Date().toISOString()
  });
  return result("ready", { selection: selectionFacts, toolchain_root: resolvedToolchainRoot,
    state_root: resolvedStateRoot, components, verification,
    readiness_digest: published.readiness_digest });
}
