

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";

import {
  CRASH_DURABLE_LIVENESS,
  CRASH_DURABLE_LOCK_STATES,
  CRASH_DURABLE_RESULTS,
  classifyLockState,
  createSyncEffects,
  decideRelease,
  decideRetirement,
  inspectLockPathSync,
  planLockAcquisition,
  planReplacement,
  planRetirementClaim,
  planTombstoneCleanup,
  runCrashDurablePlanSync
} from "@agent-chassis/wiki-core/src/lib/crash-durable-state.mjs";

import { captureProcessIdentity, confirmedDead, defaultLivenessDeps } from "../worktree-lease.mjs";

import { DEPENDENCY_ECOSYSTEMS } from "./ecosystems.mjs";
import { digestNamedFiles, fingerprintPopulation } from "./tree-identity.mjs";

export const TEST_RUNTIME_READINESS_SCHEMA_VERSION = "agent-launch-test-runtime-readiness.v3";
export const TEST_RUNTIME_READINESS_RELATIVE_PATH =
  path.join(".agent-launch", "test-runtimes", "readiness.json");
export const TEST_RUNTIME_PREPARATION_LOCK_RELATIVE_PATH =
  path.join(".agent-launch", "test-runtimes", "preparation.lock");
export const TEST_RUNTIME_PREPARATION_STATES = Object.freeze(["preparing", "failed", "ready"]);

export const TEST_RUNTIME_READINESS_CODES = Object.freeze({
  NOT_READY: "test_runtime_not_ready",
  RECORD_INVALID: "test_runtime_readiness_invalid",
  PREPARING: "test_runtime_preparation_in_progress",
  PREPARATION_FAILED: "test_runtime_preparation_failed",
  PREPARATION_CHANGED: "test_runtime_preparation_changed",
  PUBLICATION_FAILED: "test_runtime_readiness_publication_failed",
  RUNNER_NOT_PREPARED: "test_runtime_runner_not_prepared",
  INPUTS_STALE: "test_runtime_inputs_stale",
  TOOLCHAIN_STALE: "test_runtime_toolchain_stale",
  DEPENDENCIES_STALE: "test_runtime_dependencies_stale",
  LOCK_MISSING: "test_runtime_dependency_lock_missing",
  ENVIRONMENT_NOT_PREPARED: "test_runtime_environment_not_prepared",
  ENVIRONMENT_UNKNOWN: "test_runtime_environment_unknown",
  ENVIRONMENT_INCOMPATIBLE: "test_runtime_environment_incompatible",
  INVENTORY_STALE: "test_runtime_inventory_stale"
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

export function readinessRecovery(statement = null) {
  return Object.freeze({
    owner: "local test-runtime detection",
    operator_action: "agent-chassis setup --test-runtimes",
    statement: statement ?? "Install or repair what the cause names yourself (the toolchain, or the project's " +
      "dependencies with its own package manager), then let local test-runtime detection run again from the " +
      "repository root; it detects and validates every environment the repository declares and never installs " +
      "runtimes or dependencies."
  });
}

function readinessFailure(code, message, detail = {}, statement = null, record = null) {
  return Object.freeze({ ok: false, code, message, detail, recovery: readinessRecovery(statement),
    ...(record === null ? {} : { record }) });
}

function canonicalRoot(repositoryRoot) {
  try { return realpathSync(repositoryRoot); } catch { return path.resolve(repositoryRoot); }
}

export function preparationDecidingCodes(result) {
  const failure = result?.failure ?? null;
  return structuredClone({
    failure: failure === null ? null : { code: failure.code ?? null, message: failure.message ?? null },
    components: (result?.components ?? []).filter(({ status }) => status === "failed" || status === "blocked"),
    checks: (result?.verification ?? []).filter(({ ok }) => ok === false)
  });
}

function stateFailure(record) {
  const preparation = record.preparation;
  const environments = (record.environments ?? []).map(({ id }) => id);
  if (record.status === "preparing") {
    return readinessFailure(TEST_RUNTIME_READINESS_CODES.PREPARING,
      `test-runtime preparation ${preparation.id} for ${environments.join(", ")} has not completed`,
      { status: "preparing", preparation, environments, readiness_digest: record.readiness_digest },
      "Wait for the running preparation to finish, or, when its process has exited without settling, " +
      "let local test-runtime detection run again; an unfinished preparation is never usable.", record);
  }
  const deciding = preparationDecidingCodes(record.result);
  return readinessFailure(TEST_RUNTIME_READINESS_CODES.PREPARATION_FAILED,
    `test-runtime preparation ${preparation.id} failed for ${environments.join(", ")}: ` +
      `${deciding.failure?.code ?? "unknown"}`,
    { status: "failed", preparation, environments, readiness_digest: record.readiness_digest,
      deciding, result: record.result }, null, record);
}

export function loadReadiness(repositoryRoot) {
  const file = readinessPath(repositoryRoot);
  if (!existsSync(file)) {
    return readinessFailure(TEST_RUNTIME_READINESS_CODES.NOT_READY,
      "no local test-runtime preparation has been accepted for this repository",
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
      !TEST_RUNTIME_PREPARATION_STATES.includes(record.status) || digest !== digestJson(body) ||
      typeof record.preparation?.id !== "string" || !Array.isArray(record.environments)) {
    return readinessFailure(TEST_RUNTIME_READINESS_CODES.RECORD_INVALID,
      "the test-runtime readiness record is not an intact current preparation record");
  }
  if (record.repository_root !== canonicalRoot(repositoryRoot)) {
    return readinessFailure(TEST_RUNTIME_READINESS_CODES.RECORD_INVALID,
      "the test-runtime readiness record belongs to another repository",
      { recorded_repository: record.repository_root, repository: canonicalRoot(repositoryRoot) });
  }
  if (record.status !== "ready") return stateFailure(record);
  return Object.freeze({ ok: true, record });
}

function publishRecord(repositoryRoot, body, { faultInjector = null } = {}) {
  const record = { ...body, schema_version: TEST_RUNTIME_READINESS_SCHEMA_VERSION };
  const published = { ...record, readiness_digest: digestJson(record) };
  const target = readinessPath(repositoryRoot);
  mkdirSync(path.dirname(target), { recursive: true });
  const run = runCrashDurablePlanSync(planReplacement({ targetPath: target,
    privatePath: `${target}.${process.pid}.${randomUUID()}.tmp`,
    bytes: `${JSON.stringify(published, null, 2)}\n` }), createSyncEffects({ faultInjector, mode: 0o600 }));
  if (run.classification !== CRASH_DURABLE_RESULTS.PUBLISHED) {
    return Object.freeze({ ok: false, code: TEST_RUNTIME_READINESS_CODES.PUBLICATION_FAILED,
      message: "the test-runtime preparation state could not be durably published",
      detail: { failed_fault: run.failed_fault, errno: run.error?.code ?? null,
        error: run.error?.message ?? String(run.error) } });
  }
  return Object.freeze({ ok: true, record: published });
}

function preparationLockPath(repositoryRoot) {
  return path.join(repositoryRoot, TEST_RUNTIME_PREPARATION_LOCK_RELATIVE_PATH);
}

function retireDeadPreparationOwner(lockPath, contenderToken, effects, deps) {
  const inspection = inspectLockPathSync(lockPath);
  if (classifyLockState(inspection) !== CRASH_DURABLE_LOCK_STATES.TOKEN_OWNED) {
    return { retired: false, owner: null };
  }
  const observedIdentity = inspection.ownerEntry.owner_identity;
  let owner = null;
  try { owner = JSON.parse(observedIdentity); } catch { owner = null; }
  let dead = false;
  try { dead = owner !== null && confirmedDead(owner, deps); } catch { dead = false; }
  const decision = decideRetirement({ inspection, contenderToken,
    liveness: dead ? CRASH_DURABLE_LIVENESS.DEAD : CRASH_DURABLE_LIVENESS.INDETERMINATE, observedIdentity });
  if (!decision.retirable) return { retired: false, owner };
  const tombstonePath = `${lockPath}.retired-${contenderToken}`;
  const claimed = runCrashDurablePlanSync(planRetirementClaim({ canonicalPath: lockPath,
    claimantMarkerPath: `${lockPath}.claim-${contenderToken}`, tombstonePath, claimantToken: contenderToken }),
  effects);
  if (claimed.classification !== CRASH_DURABLE_RESULTS.RETIREMENT_CLAIMED) return { retired: false, owner };
  runCrashDurablePlanSync(planTombstoneCleanup({ tombstonePath, claimantToken: contenderToken }), effects);
  rmSync(`${lockPath}.claim-${contenderToken}`, { force: true });
  return { retired: true, owner };
}

function releasePreparationLock(lockPath, token, effects) {
  const inspection = inspectLockPathSync(lockPath);
  if (!decideRelease({ inspection, token }).releasable) return false;
  const tombstonePath = `${lockPath}.released-${token}`;
  const claimed = runCrashDurablePlanSync(planRetirementClaim({ canonicalPath: lockPath,
    claimantMarkerPath: `${lockPath}.claim-${token}`, tombstonePath, claimantToken: token }), effects);
  if (claimed.classification !== CRASH_DURABLE_RESULTS.RETIREMENT_CLAIMED) return false;
  runCrashDurablePlanSync(planTombstoneCleanup({ tombstonePath, claimantToken: token }), effects);
  rmSync(`${lockPath}.claim-${token}`, { force: true });
  return true;
}

function precedingFailure(repositoryRoot) {
  const loaded = loadReadiness(repositoryRoot);
  const record = loaded.record ?? null;
  if (record === null) return null;
  if (record.status === "failed") {
    return { preparation: record.preparation, environments: record.environments, result: record.result };
  }
  return record.last_failure ?? null;
}

export function beginPreparation(repositoryRoot, { environments, selection = [], faultInjector = null,
  livenessDeps = defaultLivenessDeps, now = () => new Date().toISOString() } = {}) {
  const root = canonicalRoot(repositoryRoot);
  const lockPath = preparationLockPath(root);
  mkdirSync(path.dirname(lockPath), { recursive: true });
  const identity = captureProcessIdentity(process.pid, livenessDeps);
  const token = randomUUID();
  const effects = createSyncEffects({ mode: 0o600 });
  const acquire = () => runCrashDurablePlanSync(planLockAcquisition({ canonicalPath: lockPath,
    stagingPath: `${lockPath}.staging-${token}`, ownerToken: token, ownerIdentity: JSON.stringify(identity) }),
  effects);
  let acquired = acquire();
  let owner = null;
  if (acquired.classification !== CRASH_DURABLE_RESULTS.LOCK_ACQUIRED) {
    const retired = retireDeadPreparationOwner(lockPath, token, effects, livenessDeps);
    owner = retired.owner;
    if (retired.retired) acquired = acquire();
  }
  if (acquired.classification !== CRASH_DURABLE_RESULTS.LOCK_ACQUIRED) {
    return Object.freeze({ ok: false, code: TEST_RUNTIME_READINESS_CODES.PREPARING,
      message: "another test-runtime preparation is running for this repository",
      detail: { lock_path: TEST_RUNTIME_PREPARATION_LOCK_RELATIVE_PATH, owner } });
  }
  const preparation = Object.freeze({ id: `prep-${randomUUID()}`, started_at: now(),
    owner: identity, environment_ids: environments.map(({ id }) => id) });
  const published = publishRecord(root, { status: "preparing", repository_root: root, preparation,
    environments, selection, last_failure: precedingFailure(root) }, { faultInjector });
  if (!published.ok) {
    releasePreparationLock(lockPath, token, effects);
    return published;
  }
  return Object.freeze({ ok: true, attempt: Object.freeze({ root, lockPath, token, preparation, environments,
    selection, last_failure: published.record.last_failure }) });
}

export function settlePreparation(attempt, { status, body = {}, result = null, faultInjector = null,
  now = () => new Date().toISOString() }) {
  const effects = createSyncEffects({ mode: 0o600 });
  try {
    const base = { repository_root: attempt.root, preparation: { ...attempt.preparation, settled_at: now() },
      environments: attempt.environments, selection: attempt.selection, last_failure: attempt.last_failure };
    return status === "ready"
      ? publishRecord(attempt.root, { ...body, ...base, status: "ready" }, { faultInjector })
      : publishRecord(attempt.root, { ...base, status: "failed", result }, { faultInjector });
  } finally {
    releasePreparationLock(attempt.lockPath, attempt.token, effects);
  }
}

export function measureProjectInputs(ecosystemName, projectDir, { members = [] } = {}) {
  const ecosystem = DEPENDENCY_ECOSYSTEMS[ecosystemName];
  const manifests = ecosystem.manifests(projectDir, { members });
  if (manifests.status === "lock_missing") return manifests;
  return { status: manifests.status, files: manifests.files,
    inputs_digest: digestNamedFiles(manifests.files) };
}

export function testRuntimeEnvironmentId({ ecosystem, project }) {
  return `${ecosystem}@${project}`;
}

export function recordedEnvironment(record, { ecosystem, project }) {
  return (record.environments ?? []).find((entry) => entry.ecosystem === ecosystem &&
    entry.project === project) ?? null;
}

function currentFingerprint(population, exclude) {
  try {
    return fingerprintPopulation(population, { exclude });
  } catch (error) {
    return `unavailable:${error?.code ?? "error"}`;
  }
}

export function resolveReadyEnvironmentInputs({ repositoryRoot, checkoutRoot, ecosystem, project,
  candidateRecord = null }) {

  const loaded = candidateRecord === null ? loadReadiness(repositoryRoot)
    : { ok: true, record: candidateRecord };
  if (!loaded.ok) return loaded;
  const { record } = loaded;
  const id = testRuntimeEnvironmentId({ ecosystem, project });
  const environment = recordedEnvironment(record, { ecosystem, project });
  if (environment === null) {
    return readinessFailure(TEST_RUNTIME_READINESS_CODES.ENVIRONMENT_NOT_PREPARED,
      `environment ${id} was not detected by local setup`,
      { environment: id, prepared_environments: (record.environments ?? []).map(({ id: known }) => known) });
  }
  const toolchains = {};
  for (const name of environment.toolchains) {
    const toolchain = record.toolchains[name];
    if (!toolchain) {
      return readinessFailure(TEST_RUNTIME_READINESS_CODES.RUNNER_NOT_PREPARED,
        `toolchain ${name} is not recorded as ready`, { toolchain: name });
    }
    if (currentFingerprint(toolchain.population, toolchain.population_exclude) !== toolchain.fingerprint) {
      return readinessFailure(TEST_RUNTIME_READINESS_CODES.TOOLCHAIN_STALE,
        `detected ${name} ${toolchain.version} changed or moved after setup`,
        { toolchain: name, version: toolchain.version });
    }
    toolchains[name] = toolchain;
  }
  const preparation = record.preparations.find((entry) =>
    entry.ecosystem === ecosystem && entry.project === project);
  if (!preparation) {
    return readinessFailure(TEST_RUNTIME_READINESS_CODES.RUNNER_NOT_PREPARED,
      `${ecosystem} dependencies for ${project} were not detected`, { project });
  }
  const projectDir = project === "." ? checkoutRoot : path.join(checkoutRoot, project);
  const inputs = measureProjectInputs(ecosystem, projectDir, { members: environment.members });
  if (inputs.status === "lock_missing") {
    return readinessFailure(TEST_RUNTIME_READINESS_CODES.LOCK_MISSING,
      `project ${project} has no ${inputs.required}`, { project, required: inputs.required });
  }
  if (preparation.inputs_digest !== inputs.inputs_digest) {
    return readinessFailure(TEST_RUNTIME_READINESS_CODES.INPUTS_STALE,
      `dependency inputs of ${project} changed after setup`,
      { project, recorded: preparation.inputs_digest, current: inputs.inputs_digest });
  }
  if (preparation.status === "present" &&
      currentFingerprint(preparation.population, preparation.population_exclude) !== preparation.fingerprint) {
    return readinessFailure(TEST_RUNTIME_READINESS_CODES.DEPENDENCIES_STALE,
      `detected dependencies of ${project} changed after setup`, { project, dependency_root: preparation.dir });
  }
  return Object.freeze({ ok: true, readiness_digest: record.readiness_digest, environment,
    toolchains, preparation, projectDir });
}

export function runnerNotProvedStatement(descriptor, project) {
  return `Declare ${descriptor.name}'s package in the ${descriptor.dependency_ecosystem} project at ` +
    `${project} and install it there (runners its toolchain provides need nothing), then rerun local ` +
    "test-runtime setup, which detects every environment the repository declares.";
}

export function resolveReadyRunnerInputs({ repositoryRoot, checkoutRoot, descriptor, project,
  candidateRecord = null }) {
  const loaded = candidateRecord === null ? loadReadiness(repositoryRoot)
    : { ok: true, record: candidateRecord };
  if (!loaded.ok) return loaded;
  const environment = recordedEnvironment(loaded.record,
    { ecosystem: descriptor.dependency_ecosystem, project });
  if (environment === null || !environment.runners.includes(descriptor.runner_id)) {
    return readinessFailure(TEST_RUNTIME_READINESS_CODES.RUNNER_NOT_PREPARED,
      `${descriptor.runner_id} was not selected by local setup for project ${project}`,
      { provider_id: descriptor.runner_id, project }, runnerNotProvedStatement(descriptor, project));
  }
  return resolveReadyEnvironmentInputs({ repositoryRoot, checkoutRoot,
    ecosystem: descriptor.dependency_ecosystem, project, candidateRecord: loaded.record });
}
