

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
import { digestNamedFiles, fingerprintPopulation, measurePopulationContent } from
  "@agent-chassis/wiki-core/src/lib/runtime-inputs/population-identity.mjs";

import { captureProcessIdentity, confirmedDead, defaultLivenessDeps } from "../worktree-lease.mjs";

import { TEST_RUNTIME_RUNNER_CATALOG } from "@agent-chassis/controlled-contract/test-proof";

import { discoverRepositoryEnvironments } from "./discovery.mjs";
import { DEPENDENCY_ECOSYSTEMS } from "./ecosystems.mjs";

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
  PUBLICATION_FAILED: "test_runtime_readiness_publication_failed",
  RUNNER_NOT_PREPARED: "test_runtime_runner_not_prepared",
  ENVIRONMENT_NOT_PREPARED: "test_runtime_environment_not_prepared",
  ENVIRONMENT_UNKNOWN: "test_runtime_environment_unknown",
  ENVIRONMENT_INCOMPATIBLE: "test_runtime_environment_incompatible"
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

function recordConfiguration(record) {
  return { preparation_id: record.preparation.id, platform: record.platform ?? null,
    environments: record.environments, selection: record.selection ?? [],
    toolchains: record.toolchains, preparations: record.preparations };
}

export function loadRuntimeConfiguration(repositoryRoot) {
  const loaded = loadReadiness(repositoryRoot);
  const record = loaded.record ?? null;
  if (record === null) return loaded;
  const configuration = record.status === "ready" ? recordConfiguration(record) : record.configured ?? null;
  if (configuration === null) return loaded;
  return Object.freeze({ ok: true, configuration, record_status: record.status,
    readiness_digest: record.readiness_digest });
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

function precedingConfiguration(repositoryRoot) {
  const loaded = loadRuntimeConfiguration(repositoryRoot);
  return loaded.ok ? structuredClone(loaded.configuration) : null;
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
  const configured = precedingConfiguration(root);
  const published = publishRecord(root, { status: "preparing", repository_root: root, preparation,
    environments, selection, last_failure: precedingFailure(root),
    ...(configured === null ? {} : { configured }) }, { faultInjector });
  if (!published.ok) {
    releasePreparationLock(lockPath, token, effects);
    return published;
  }
  return Object.freeze({ ok: true, attempt: Object.freeze({ root, lockPath, token, preparation, environments,
    selection, last_failure: published.record.last_failure, configured }) });
}

export function settlePreparation(attempt, { status, body = {}, result = null, faultInjector = null,
  now = () => new Date().toISOString() }) {
  const effects = createSyncEffects({ mode: 0o600 });
  try {
    const base = { repository_root: attempt.root, preparation: { ...attempt.preparation, settled_at: now() },
      environments: attempt.environments, selection: attempt.selection, last_failure: attempt.last_failure };
    return status === "ready"
      ? publishRecord(attempt.root, { ...body, ...base, status: "ready" }, { faultInjector })
      : publishRecord(attempt.root, { ...base, status: "failed", result,
        ...((attempt.configured ?? null) === null ? {} : { configured: attempt.configured }) }, { faultInjector });
  } finally {
    releasePreparationLock(attempt.lockPath, attempt.token, effects);
  }
}

export function measureProjectInputs(ecosystemName, projectDir, { members = [] } = {}) {
  const ecosystem = DEPENDENCY_ECOSYSTEMS[ecosystemName];
  const manifests = ecosystem.manifests(projectDir, { members });

  if (manifests.status === "lock_missing") {
    return manifests.files === undefined ? manifests
      : { ...manifests, inputs_digest: digestNamedFiles(manifests.files) };
  }
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

const observedContent = new Map();

function observePopulation(population, exclude, recorded) {
  let fingerprint;
  try {
    fingerprint = fingerprintPopulation(population, { exclude });
  } catch (error) {
    return { observed: "unobservable", content_digest: null, errno: error?.code ?? null };
  }
  if (fingerprint === recorded.fingerprint) return { observed: null, content_digest: recorded.content_digest ?? null };
  const key = JSON.stringify([population, exclude]);
  let measured = observedContent.get(key);
  if (measured?.fingerprint !== fingerprint) {
    try {
      measured = { fingerprint, content_digest: measurePopulationContent(population, { exclude }).content_digest };
    } catch (error) {
      return { observed: "unobservable", content_digest: null, errno: error?.code ?? null };
    }
    observedContent.set(key, measured);
  }
  return { observed: measured.content_digest === recorded.content_digest ? null : "changed_since_setup",
    content_digest: measured.content_digest };
}

function toolchainProvenance(toolchain) {
  const current = observePopulation(toolchain.population, toolchain.population_exclude, toolchain);

  if (toolchain.fingerprint === undefined) {
    return { version: toolchain.version, source: toolchain.source, content_digest: current.content_digest,
      observed: current.observed === "unobservable" ? current.observed : "located_for_this_run",
      ...(current.errno === undefined ? {} : { errno: current.errno }) };
  }
  if (current.observed === null) {
    return { version: toolchain.version, source: toolchain.source, content_digest: current.content_digest };
  }
  return { version: null, source: toolchain.source, content_digest: current.content_digest,
    observed: current.observed, ...(current.errno === undefined ? {} : { errno: current.errno }),
    setup_version: toolchain.version, setup_content_digest: toolchain.content_digest ?? null };
}

function dependencyProvenance(preparation, { ecosystem, projectDir, members }) {
  let inputs;
  try {
    inputs = measureProjectInputs(ecosystem, projectDir, { members });
  } catch (error) {
    inputs = { status: "unreadable", code: error?.code ?? null };
  }
  const inputsDigest = inputs.inputs_digest ?? null;
  const base = { ecosystem: preparation.ecosystem, status: preparation.status, source: preparation.source ?? null,
    inputs_digest: inputsDigest };

  const located = preparation.status === "absent" ||
    (preparation.status === "present" && preparation.fingerprint === undefined);
  const inputsChanged = located ? (inputsDigest === null ? { inputs_observed: inputs.status } : {})
    : inputsDigest === preparation.inputs_digest ? {}
      : { inputs_observed: inputsDigest === null ? inputs.status : "changed_since_setup",
        setup_inputs_digest: preparation.inputs_digest ?? null };
  if (preparation.status !== "present") {
    return { ...base, content_digest: preparation.content_digest ?? null, ...inputsChanged,
      ...(located ? { observed: "located_for_this_run" } : {}) };
  }
  const current = observePopulation(preparation.population, preparation.population_exclude, preparation);
  if (located) {
    return { ...base, content_digest: current.content_digest, ...inputsChanged,
      observed: current.observed === "unobservable" ? current.observed : "located_for_this_run",
      ...(current.errno === undefined ? {} : { errno: current.errno }) };
  }
  return { ...base, content_digest: current.content_digest, ...inputsChanged,
    ...(current.observed === null ? {} : { observed: current.observed,
      ...(current.errno === undefined ? {} : { errno: current.errno }),
      setup_content_digest: preparation.content_digest ?? null }) };
}

const NO_CONFIGURATION = Object.freeze({ environments: Object.freeze([]), selection: Object.freeze([]),
  toolchains: Object.freeze({}), preparations: Object.freeze([]) });

export function loadExecutionConfiguration(repositoryRoot) {
  const loaded = loadRuntimeConfiguration(repositoryRoot);
  if (loaded.ok) return loaded;
  if (loaded.code === TEST_RUNTIME_READINESS_CODES.RECORD_INVALID) {
    return Object.freeze({ ok: true, configuration: NO_CONFIGURATION, record_status: "invalid",
      readiness_digest: null });
  }
  return Object.freeze({ ok: true, configuration: NO_CONFIGURATION,
    record_status: loaded.record?.status ?? "absent", readiness_digest: loaded.record?.readiness_digest ?? null });
}

export function resolveCurrentEnvironmentInputs({ repositoryRoot, checkoutRoot, ecosystem, project,
  candidateRecord = null, toolchainNames = [], located = null }) {

  const loaded = candidateRecord === null ? loadExecutionConfiguration(repositoryRoot)
    : { ok: true, configuration: candidateRecord, record_status: candidateRecord.status ?? "ready",
      readiness_digest: candidateRecord.readiness_digest };
  if (!loaded.ok) return loaded;
  const { configuration } = loaded;
  const id = testRuntimeEnvironmentId({ ecosystem, project });
  if (!Object.hasOwn(DEPENDENCY_ECOSYSTEMS, ecosystem)) {
    return readinessFailure(TEST_RUNTIME_READINESS_CODES.ENVIRONMENT_UNKNOWN,
      `${ecosystem} is not a dependency ecosystem`, { environment: id });
  }
  const recorded = recordedEnvironment(configuration, { ecosystem, project });
  const names = [...new Set([...DEPENDENCY_ECOSYSTEMS[ecosystem].toolchains, ...(recorded?.toolchains ?? []),
    ...toolchainNames])].sort();

  const environment = recorded ?? Object.freeze({ id, ecosystem, project,
    members: Object.freeze([...(discoverRepositoryEnvironments(checkoutRoot, TEST_RUNTIME_RUNNER_CATALOG.runners,
      { targets: [project === "." ? "." : `${project}/member`] }).find((entry) => entry.id === id)?.members ?? [])]),
    runners: Object.freeze([]), toolchains: Object.freeze(names) });
  const configuredToolchains = Object.fromEntries(names.filter((name) => configuration.toolchains?.[name])
    .map((name) => [name, configuration.toolchains[name]]));
  const configuredPreparation = (configuration.preparations ?? []).find((entry) =>
    entry.ecosystem === ecosystem && entry.project === project) ?? null;
  const toolchains = Object.fromEntries(names.map((name) =>
    [name, configuredToolchains[name] ?? located?.toolchains?.[name] ?? null]));
  const preparation = configuredPreparation ?? located?.preparation ?? null;
  const unlocated = names.filter((name) => toolchains[name] === null);
  if (unlocated.length > 0 || preparation === null) {
    return Object.freeze({ ...readinessFailure(TEST_RUNTIME_READINESS_CODES.ENVIRONMENT_NOT_PREPARED,
      `no location is configured for ${[...unlocated.map((name) => `the ${name} toolchain`),
        ...(preparation === null ? [`the ${ecosystem} dependency environment`] : [])].join(" and ")} of ${id}`,
      { environment: id, toolchains: unlocated, dependency_environment: preparation === null }),
    locate: Object.freeze({ ecosystem, project, members: environment.members, toolchainNames: names,
      known: Object.freeze({ toolchains: configuredToolchains, preparation: configuredPreparation }) }) });
  }
  const projectDir = project === "." ? checkoutRoot : path.join(checkoutRoot, project);
  return Object.freeze({ ok: true, readiness_digest: loaded.readiness_digest, record_status: loaded.record_status,
    environment, toolchains, preparation, projectDir,
    provenance: Object.freeze({
      toolchains: Object.fromEntries(Object.entries(toolchains).map(([name, toolchain]) =>
        [name, toolchainProvenance(toolchain)])),
      dependencies: Object.freeze(dependencyProvenance(preparation,
        { ecosystem, projectDir, members: environment.members })) }) });
}

export function resolveCurrentRunnerInputs({ repositoryRoot, checkoutRoot, descriptor, project,
  candidateRecord = null, located = null }) {
  return resolveCurrentEnvironmentInputs({ repositoryRoot, checkoutRoot,
    ecosystem: descriptor.dependency_ecosystem, project, candidateRecord, located,
    toolchainNames: descriptor.toolchains ?? [] });
}
