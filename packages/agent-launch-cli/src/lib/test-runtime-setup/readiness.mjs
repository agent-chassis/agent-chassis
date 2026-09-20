

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { DEPENDENCY_ECOSYSTEMS } from "./ecosystems.mjs";
import { digestNamedFiles, fingerprintPopulation } from "./tree-identity.mjs";

export const TEST_RUNTIME_READINESS_SCHEMA_VERSION = "agent-launch-test-runtime-readiness.v1";
export const TEST_RUNTIME_READINESS_RELATIVE_PATH =
  path.join(".agent-launch", "test-runtimes", "readiness.v1.json");

export const TEST_RUNTIME_READINESS_CODES = Object.freeze({
  NOT_READY: "test_runtime_not_ready",
  RECORD_INVALID: "test_runtime_readiness_invalid",
  RUNNER_NOT_PREPARED: "test_runtime_runner_not_prepared",
  INPUTS_STALE: "test_runtime_inputs_stale",
  TOOLCHAIN_STALE: "test_runtime_toolchain_stale",
  DEPENDENCIES_STALE: "test_runtime_dependencies_stale",
  LOCK_MISSING: "test_runtime_dependency_lock_missing"
});

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

export function digestJson(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")}`;
}

export function readinessPath(repositoryRoot) {
  return path.join(repositoryRoot, TEST_RUNTIME_READINESS_RELATIVE_PATH);
}

export function defaultToolchainRoot(env = process.env) {
  const base = env.XDG_DATA_HOME && path.isAbsolute(env.XDG_DATA_HOME)
    ? env.XDG_DATA_HOME : path.join(os.homedir(), ".local", "share");
  return path.join(base, "agent-chassis", "toolchains");
}

export function defaultStateRoot(repositoryRoot, env = process.env) {
  const base = env.XDG_STATE_HOME && path.isAbsolute(env.XDG_STATE_HOME)
    ? env.XDG_STATE_HOME : path.join(os.homedir(), ".local", "state");
  const repoKey = createHash("sha256").update(repositoryRoot).digest("hex").slice(0, 16);
  return path.join(base, "agent-chassis", "test-runtimes", repoKey);
}

export function readinessRecovery(selection = null) {
  const runners = selection === null ? "" : selection.map(({ provider_id: id, project }) =>
    ` --runner ${id.replace(/^runner\./u, "")}${project === "." ? "" : `@${project}`}`).join("");
  return Object.freeze({
    operator_action: `agent-chassis setup --test-runtimes${runners}`,
    statement: "Run explicit local test-runtime setup from the repository root; attempts never install runtimes or dependencies."
  });
}

export function withdrawReadiness(repositoryRoot) {
  rmSync(readinessPath(repositoryRoot), { force: true });
}

export function publishReadiness(repositoryRoot, body) {
  const record = { ...body, schema_version: TEST_RUNTIME_READINESS_SCHEMA_VERSION, status: "ready" };
  const published = { ...record, readiness_digest: digestJson(record) };
  const target = readinessPath(repositoryRoot);
  mkdirSync(path.dirname(target), { recursive: true });
  const staging = `${target}.${process.pid}.tmp`;
  writeFileSync(staging, `${JSON.stringify(published, null, 2)}\n`, { mode: 0o600 });
  renameSync(staging, target);
  return published;
}

function readinessFailure(code, message, detail = {}, selection = null) {
  return Object.freeze({ ok: false, code, message, detail, recovery: readinessRecovery(selection) });
}

export function loadReadiness(repositoryRoot) {
  const file = readinessPath(repositoryRoot);
  if (!existsSync(file)) {
    return readinessFailure(TEST_RUNTIME_READINESS_CODES.NOT_READY,
      "no local test-runtime readiness has been published for this repository",
      { readiness_path: TEST_RUNTIME_READINESS_RELATIVE_PATH });
  }
  let record;
  try {
    record = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return readinessFailure(TEST_RUNTIME_READINESS_CODES.RECORD_INVALID,
      "the test-runtime readiness record is unreadable");
  }
  const { readiness_digest: digest, ...body } = record ?? {};
  if (record?.schema_version !== TEST_RUNTIME_READINESS_SCHEMA_VERSION ||
      record.status !== "ready" || digest !== digestJson(body)) {
    return readinessFailure(TEST_RUNTIME_READINESS_CODES.RECORD_INVALID,
      "the test-runtime readiness record is not an intact current ready record");
  }
  return Object.freeze({ ok: true, record });
}

export function measureProjectInputs(ecosystemName, projectDir) {
  const ecosystem = DEPENDENCY_ECOSYSTEMS[ecosystemName];
  const manifests = ecosystem.manifests(projectDir);
  if (manifests.status === "lock_missing") return manifests;
  return { status: manifests.status, files: manifests.files,
    inputs_digest: digestNamedFiles(manifests.files) };
}

export function resolveReadyRunnerInputs({ repositoryRoot, checkoutRoot, descriptor, project,
  candidateRecord = null }) {

  const loaded = candidateRecord === null ? loadReadiness(repositoryRoot)
    : { ok: true, record: candidateRecord };
  const selection = [{ provider_id: descriptor.runner_id, project }];
  if (!loaded.ok) return { ...loaded, recovery: readinessRecovery(selection) };
  const { record } = loaded;
  if (!record.selection.some((entry) => entry.provider_id === descriptor.runner_id &&
      entry.project === project)) {
    return readinessFailure(TEST_RUNTIME_READINESS_CODES.RUNNER_NOT_PREPARED,
      `${descriptor.runner_id} was not selected by local setup for project ${project}`,
      { provider_id: descriptor.runner_id, project }, [...record.selection, ...selection]);
  }
  const toolchains = {};
  for (const name of descriptor.toolchains) {
    const toolchain = record.toolchains[name];
    if (!toolchain) {
      return readinessFailure(TEST_RUNTIME_READINESS_CODES.RUNNER_NOT_PREPARED,
        `toolchain ${name} is not recorded as ready`, { toolchain: name }, record.selection);
    }
    let current;
    try {
      current = fingerprintPopulation(toolchain.population, { exclude: toolchain.population_exclude });
    } catch (error) {
      current = `unavailable:${error?.code ?? "error"}`;
    }
    if (current !== toolchain.fingerprint) {
      return readinessFailure(TEST_RUNTIME_READINESS_CODES.TOOLCHAIN_STALE,
        `recorded ${name} ${toolchain.version} changed or moved after setup`,
        { toolchain: name, version: toolchain.version }, record.selection);
    }
    toolchains[name] = toolchain;
  }
  const projectDir = project === "." ? checkoutRoot : path.join(checkoutRoot, project);
  const inputs = measureProjectInputs(descriptor.dependency_ecosystem, projectDir);
  if (inputs.status === "lock_missing") {
    return readinessFailure(TEST_RUNTIME_READINESS_CODES.LOCK_MISSING,
      `project ${project} has no ${inputs.required}`, { project, required: inputs.required },
      record.selection);
  }
  const preparation = record.preparations.find((entry) =>
    entry.ecosystem === descriptor.dependency_ecosystem && entry.project === project);
  if (!preparation) {
    return readinessFailure(TEST_RUNTIME_READINESS_CODES.RUNNER_NOT_PREPARED,
      `${descriptor.dependency_ecosystem} dependencies for ${project} were not prepared`,
      { project }, record.selection);
  }
  if (preparation.inputs_digest !== inputs.inputs_digest) {
    return readinessFailure(TEST_RUNTIME_READINESS_CODES.INPUTS_STALE,
      `dependency inputs of ${project} changed after setup`,
      { project, recorded: preparation.inputs_digest, current: inputs.inputs_digest },
      record.selection);
  }
  if (preparation.status === "present") {
    let current;
    try {
      current = fingerprintPopulation(preparation.population,
        { exclude: preparation.population_exclude });
    } catch (error) {
      current = `unavailable:${error?.code ?? "error"}`;
    }
    if (current !== preparation.fingerprint) {
      return readinessFailure(TEST_RUNTIME_READINESS_CODES.DEPENDENCIES_STALE,
        `prepared dependencies of ${project} changed after setup`, { project }, record.selection);
    }
  }
  return Object.freeze({ ok: true, readiness_digest: record.readiness_digest, toolchains,
    preparation, projectDir });
}
