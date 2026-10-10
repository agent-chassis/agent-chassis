import {
  canonicalAuthoringEntries,
  validateCanonicalAuthoringEntries,
  resolveCanonicalAuthoringCompilerContract,
  canonicalAuthoringGeneration,
  canonicalAuthoringManifest,
  validateCanonicalAuthoringDirectory
} from "./controlled-contract-authoring-validation.mjs";
import {
  carrierSetFailure,
  carrierSetInputs,
  carrierSetCapture,
  carrierSetGenerationDigest,
  carrierSetManifest,
  carrierSetManifestPath,
  isCanonicalAuthoringProfile,
  validateCarrierSetPopulation,
  validateCarrierSetDirectory,
  CARRIER_SET_SCHEMA_VERSION,
  INTEGRATION_CAPTURE_PROFILE
} from "./controlled-contract-carrier-set-validation.mjs";
export {
  projectControlledContractCanonicalAuthoringPopulation
} from "./controlled-contract-authoring-validation.mjs";
export {
  carrierSetFailure,
  carrierSetManifestPath,
  samePlainData,
  inspectCarrierSetMember,
  validateControlledContractCarrierSetManifest,
  CARRIER_SET_SCHEMA_VERSION
} from "./controlled-contract-carrier-set-validation.mjs";

import {
  randomUUID
} from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  rmdir,
  unlink,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  assertControlledContractSourceLease,
  resolveCanonicalControlledContractCarrierSet
} from "./controlled-contract-carrier-set-tools.mjs";
import {
  DIGEST_PATTERN,
  CANONICAL_AUTHORING_PROFILE_ID,
  ControlledContractToolError,
  fail,
  isPlainObject,
  normalizeControlledContractIdentity,
  normalizeControlledContractPackIdentity,
  digestBytes,
  canonicalJsonBytes,
  resolveControlledContractRepository,
  inspectCarrierFile,
  parseCarrierJson,
  deepFreezePlainData
} from "./controlled-contract-tool-shared.mjs";
import {
  canonicalControlledContractCarrierSetManifestBytes,
  parseControlledContractCarrierSetManifest
} from "./controlled-contract-carrier-set-manifest.mjs";

let canonicalAuthoringPublisherHook = null;
let controlledContractAuthorityExclusionHook = null;
const controlledContractAuthorityContexts = new WeakMap();

export function setCanonicalAuthoringPublisherHookForTest(hook = null) {
  if (hook !== null && typeof hook !== "function") {
    throw new TypeError("canonical authoring publisher hook must be a function or null");
  }
  canonicalAuthoringPublisherHook = hook;
}

export function setControlledContractAuthorityExclusionHookForTest(hook = null) {
  if (hook !== null && typeof hook !== "function") {
    throw new TypeError("controlled-contract authority exclusion hook must be a function or null");
  }
  controlledContractAuthorityExclusionHook = hook;
}

async function controlledContractAuthorityBoundary(boundary, details = {}) {
  if (controlledContractAuthorityExclusionHook !== null) {
    await controlledContractAuthorityExclusionHook(boundary, Object.freeze(details));
  }
}

async function canonicalAuthoringPublisherBoundary(boundary, details = {}) {
  if (canonicalAuthoringPublisherHook !== null) {
    await canonicalAuthoringPublisherHook(boundary, Object.freeze(details));
  }
}

export async function processStartIdentity(pid) {
  try {
    const statText = await readFile(`/proc/${pid}/stat`, "utf8");
    const close = statText.lastIndexOf(")");
    const fields = statText.slice(close + 2).trim().split(/\s+/u);
    return fields[19] ?? null;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

const WK_AUTHORITY_LOCK_DIRECTORY = ".wk-authority-locks";
const WK_AUTHORITY_LOCK_OWNER_FILE = "owner.json";
const WK_AUTHORITY_LOCK_SCHEMA_VERSION = "controlled-contract-wk-authority-lock.v1";

function wkAuthorityLockFailure(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function wkAuthorityContextFailure(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function wkAuthorityLockRecord({ token, processStart }) {
  return Object.freeze({
    schema_version: WK_AUTHORITY_LOCK_SCHEMA_VERSION,
    token,
    process_id: process.pid,
    process_start_identity: processStart
  });
}

function validWkAuthorityLockRecord(value) {
  return isPlainObject(value) &&
    value.schema_version === WK_AUTHORITY_LOCK_SCHEMA_VERSION &&
    typeof value.token === "string" && /^[0-9a-f-]{36}$/u.test(value.token) &&
    Number.isSafeInteger(value.process_id) && value.process_id > 0 &&
    typeof value.process_start_identity === "string" && value.process_start_identity.length > 0;
}

async function acquireWkAuthorityLock({ contracts, wkId }) {
  const processStart = await processStartIdentity(process.pid);
  if (processStart === null) throw wkAuthorityLockFailure(
    "controlled_contract_wk_authority_lock_unavailable",
    "controlled-contract WK authority lock cannot bind the current process identity"
  );
  const directory = path.join(contracts, WK_AUTHORITY_LOCK_DIRECTORY);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const token = randomUUID();
  const record = wkAuthorityLockRecord({ token, processStart });
  const candidate = path.join(directory, `.${wkId}.candidate-${token}`);
  const lock = path.join(directory, `${wkId}.lock`);
  await mkdir(candidate, { mode: 0o700 });
  try {
    await writeFile(path.join(candidate, WK_AUTHORITY_LOCK_OWNER_FILE), canonicalJsonBytes(record), {
      flag: "wx", mode: 0o600
    });
    for (let attempt = 0; attempt < 500; attempt += 1) {
      try {
        await rename(candidate, lock);
        return Object.freeze({ lock, token });
      } catch (error) {
        if (error?.code !== "EEXIST" && error?.code !== "ENOTEMPTY") throw error;
      }
      let owner;
      try {
        owner = parseCarrierJson(await readFile(path.join(lock, WK_AUTHORITY_LOCK_OWNER_FILE)));
      } catch (error) {
        if (error?.code === "ENOENT") {
          await delay(10);
          continue;
        }
        throw wkAuthorityLockFailure(
          "controlled_contract_wk_authority_lock_unavailable",
          "controlled-contract WK authority lock owner is unverifiable"
        );
      }
      if (!validWkAuthorityLockRecord(owner)) throw wkAuthorityLockFailure(
        "controlled_contract_wk_authority_lock_unavailable",
        "controlled-contract WK authority lock owner is malformed"
      );
      let observedStart;
      try {
        observedStart = await processStartIdentity(owner.process_id);
      } catch {
        throw wkAuthorityLockFailure(
          "controlled_contract_wk_authority_lock_unavailable",
          "controlled-contract WK authority lock owner liveness is unverifiable"
        );
      }
      if (observedStart === owner.process_start_identity) {
        await delay(10);
        continue;
      }
      const stale = path.join(directory, `.${wkId}.stale-${owner.token}-${token}`);
      try {
        await rename(lock, stale);
        await rm(stale, { recursive: true, force: true });
      } catch (error) {
        if (error?.code !== "ENOENT" && error?.code !== "EEXIST" &&
            error?.code !== "ENOTEMPTY") throw error;
      }
      await delay(10);
    }
    throw wkAuthorityLockFailure(
      "controlled_contract_wk_authority_lock_timeout",
      "controlled-contract WK authority lock acquisition timed out"
    );
  } finally {
    await rm(candidate, { recursive: true, force: true });
  }
}

async function releaseWkAuthorityLock(locked) {
  if (locked === null) return;
  const owner = parseCarrierJson(await readFile(path.join(locked.lock, WK_AUTHORITY_LOCK_OWNER_FILE)));
  if (!validWkAuthorityLockRecord(owner) || owner.token !== locked.token) {
    throw wkAuthorityLockFailure(
      "controlled_contract_wk_authority_lock_ownership_changed",
      "controlled-contract WK authority lock ownership changed"
    );
  }
  const released = `${locked.lock}.released-${locked.token}`;
  await rename(locked.lock, released);
  await rm(released, { recursive: true, force: true });
  try {
    await rmdir(path.dirname(locked.lock));
  } catch (error) {
    if (error?.code !== "ENOENT" && error?.code !== "ENOTEMPTY") throw error;
  }
}

export async function withControlledContractAuthorityExclusion({ repoRoot, wkId, run } = {}) {
  normalizeControlledContractIdentity({ wkId, focus: null });
  if (typeof run !== "function") throw new TypeError("controlled-contract authority exclusion requires one callback");
  if (typeof repoRoot !== "string" || !path.isAbsolute(repoRoot) || path.resolve(repoRoot) !== repoRoot) {
    throw new TypeError("controlled-contract authority exclusion requires one normalized absolute repository root");
  }

  const contracts = path.join(repoRoot, "wiki", "contracts");
  await mkdir(contracts, { recursive: true, mode: 0o700 });
  const locked = await acquireWkAuthorityLock({ contracts, wkId });
  const authorityContext = Object.freeze({});
  const contextState = { repoRoot, wkId, active: true };
  controlledContractAuthorityContexts.set(authorityContext, contextState);
  try {
    await controlledContractAuthorityBoundary("authority_lock_acquired", { wk_id: wkId });
    return await run(authorityContext);
  } finally {
    contextState.active = false;
    try {
      await controlledContractAuthorityBoundary("authority_lock_releasing", { wk_id: wkId });
    } finally {
      await releaseWkAuthorityLock(locked);
    }
  }
}

export async function runWithControlledContractAuthorityContext({
  repoRoot, wkId, authorityContext, run
} = {}) {
  normalizeControlledContractIdentity({ wkId, focus: null });
  if (typeof run !== "function") {
    throw new TypeError("controlled-contract authority context requires one callback");
  }
  if (typeof repoRoot !== "string" || !path.isAbsolute(repoRoot) ||
      path.resolve(repoRoot) !== repoRoot) {
    throw new TypeError(
      "controlled-contract authority context requires one normalized absolute repository root"
    );
  }
  if ((typeof authorityContext !== "object" || authorityContext === null) &&
      typeof authorityContext !== "function") {
    throw wkAuthorityContextFailure(
      "controlled_contract_wk_authority_context_invalid",
      "controlled-contract WK authority context is invalid"
    );
  }
  const state = controlledContractAuthorityContexts.get(authorityContext);
  if (state === undefined) {
    throw wkAuthorityContextFailure(
      "controlled_contract_wk_authority_context_invalid",
      "controlled-contract WK authority context is not owner-authenticated"
    );
  }
  if (state.active !== true) {
    throw wkAuthorityContextFailure(
      "controlled_contract_wk_authority_context_stale",
      "controlled-contract WK authority context is outside its live callback"
    );
  }
  if (state.repoRoot !== repoRoot || state.wkId !== wkId) {
    throw wkAuthorityContextFailure(
      "controlled_contract_wk_authority_context_mismatch",
      "controlled-contract WK authority context does not match repository and WK"
    );
  }
  return await run();
}

function publicationLockRecord({ operationToken, generation, stagingName,
  temporaryManifestName, processStart }) {
  return {
    schema_version: "controlled-contract-carrier-set-lock.v1",
    operation_token: operationToken,
    process_id: process.pid,
    process_start_identity: processStart,
    generation,
    staging_name: stagingName,
    temporary_manifest_name: temporaryManifestName
  };
}

function validPublicationLockRecord(value) {
  return isPlainObject(value) &&
    value.schema_version === "controlled-contract-carrier-set-lock.v1" &&
    typeof value.operation_token === "string" &&
    /^[0-9a-f-]{36}$/u.test(value.operation_token) &&
    Number.isSafeInteger(value.process_id) && value.process_id > 0 &&
    typeof value.process_start_identity === "string" &&
    value.process_start_identity.length > 0 &&
    typeof value.generation === "string" && /^[0-9a-f]{64}$/u.test(value.generation) &&
    value.staging_name === `.carrier-set-staging-${value.operation_token}` &&
    value.temporary_manifest_name === `.carrier-set-manifest-tmp-${value.operation_token}`;
}

async function createPublicationLock(lockPath, record) {
  await writeFile(lockPath, canonicalJsonBytes(record), { flag: "wx", mode: 0o600 });
  return { lock: lockPath, record };
}

async function reconcileDeadPublication({ store, manifestPath, dead, quarantine }) {
  await rm(path.join(store.contracts, dead.staging_name), {
    recursive: true, force: true
  });
  await rm(path.join(path.dirname(manifestPath), dead.temporary_manifest_name), {
    force: true
  });
  let selectedGeneration = null;
  try {
    const visible = await inspectCarrierFile(manifestPath, { required: false });
    selectedGeneration = visible === null
      ? null : parseControlledContractCarrierSetManifest(visible.bytes).generation.id;
  } catch {
    selectedGeneration = null;
  }
  if (selectedGeneration !== dead.generation) {
    await rm(path.join(store.contracts, ".carrier-generations", dead.generation), {
      recursive: true, force: true
    });
  }
  await rm(quarantine, { force: true });
}

async function acquireCarrierSetPublicationLock({ store, manifestPath, record }) {
  const lockPath = `${manifestPath}.cas-lock`;
  try {
    return await createPublicationLock(lockPath, record);
  } catch (error) {
    if (error?.code !== "EEXIST") carrierSetFailure("busy",
      "canonical carrier set lock could not be created", {
        cause_code: error?.code ?? null
      });
  }
  let dead;
  try {
    dead = parseCarrierJson((await readFile(lockPath)).toString("utf8"));
  } catch {
    carrierSetFailure("busy",
      "canonical carrier set owner is unverifiable and remains untouched", {
        owner_state: "unverifiable"
      });
  }
  if (!validPublicationLockRecord(dead)) carrierSetFailure("busy",
    "canonical carrier set owner is unverifiable and remains untouched", {
      owner_state: "unverifiable"
    });
  let observedStart;
  try {
    observedStart = await processStartIdentity(dead.process_id);
  } catch {
    carrierSetFailure("busy",
      "canonical carrier set owner liveness is unverifiable and remains untouched", {
        owner_state: "unverifiable"
      });
  }
  if (observedStart === dead.process_start_identity) carrierSetFailure("busy",
    "canonical carrier set has a live concurrent writer", { owner_state: "live" });
  const quarantine = `${lockPath}.stale-${dead.operation_token}-${randomUUID()}`;
  try {
    await rename(lockPath, quarantine);
  } catch (error) {
    carrierSetFailure("busy", "stale-lock quarantine lost the ownership race", {
      cause_code: error?.code ?? null
    });
  }
  let acquired;
  try {
    acquired = await createPublicationLock(lockPath, record);
  } catch (error) {
    carrierSetFailure("busy", "fresh exclusive carrier-set acquisition lost", {
      cause_code: error?.code ?? null
    });
  }
  await reconcileDeadPublication({ store, manifestPath, dead, quarantine });
  return acquired;
}

async function releaseCarrierSetPublicationLock(locked) {
  if (!locked) return;
  await unlink(locked.lock).catch(() => {});
}

export async function readControlledContractCarrierSetManifestDigest({
  repoRoot, wkId, focus = null
}) {
  normalizeControlledContractIdentity({ wkId, focus });
  const store = await resolveControlledContractRepository(repoRoot);
  const inspected = await inspectCarrierFile(
    carrierSetManifestPath(store, wkId, focus), { required: false }
  );
  return inspected?.digest ?? null;
}

export async function settleControlledContractRefactorTransaction({
  assertSourceLease,
  participants
}) {
  if (typeof assertSourceLease !== "function" || !Array.isArray(participants) ||
      participants.length === 0 || participants.some((participant) =>
        !isPlainObject(participant) || typeof participant.name !== "string" ||
        typeof participant.prepare !== "function") ||
      participants.filter(({ terminal }) => terminal === true).length > 1 ||
      (participants.some(({ terminal }) => terminal === true) &&
        participants.at(-1).terminal !== true)) {
    carrierSetFailure("input_invalid",
      "refactor settlement requires one lease assertion and closed participant population");
  }
  const prepared = [];
  const committed = [];
  let terminalCommitted = false;
  try {
    await assertSourceLease();
    await canonicalAuthoringPublisherBoundary("refactor_source_lease_verified");
    for (const participant of participants) {
      await canonicalAuthoringPublisherBoundary("refactor_prepare", {
        participant: participant.name
      });
      const value = await participant.prepare();
      if (!isPlainObject(value) || typeof value.commit !== "function" ||
          typeof value.compensate !== "function" ||
          (value.finalize !== undefined && typeof value.finalize !== "function")) {
        carrierSetFailure("input_invalid",
        "refactor participant preparation returned no commit/compensate pair", {
          participant: participant.name
        });
      }
      prepared.push({ name: participant.name, value,
        terminal: participant.terminal === true });
      await assertSourceLease();
    }
    const receipts = {};
    const terminal = prepared.find(({ terminal: isTerminal }) => isTerminal) ?? null;
    for (const entry of prepared.filter(({ terminal: isTerminal }) => !isTerminal)) {
      await assertSourceLease();
      await canonicalAuthoringPublisherBoundary("refactor_commit", {
        participant: entry.name
      });
      receipts[entry.name] = await entry.value.commit();
      committed.push(entry);
    }
    await assertSourceLease();
    await canonicalAuthoringPublisherBoundary("refactor_settlement_verified");
    if (terminal !== null) {
      receipts[terminal.name] = await terminal.value.commit();
      committed.push(terminal);
      terminalCommitted = true;
    }
    for (const entry of [...prepared].reverse()) {
      if (entry !== terminal && typeof entry.value.finalize === "function") {
        await entry.value.finalize();
      }
    }
    return Object.freeze({
      schema_version: "controlled-contract-refactor-atomic-settlement.v1",
      status: "committed",
      receipts: deepFreezePlainData(receipts),
      committed_participants: Object.freeze(committed.map(({ name }) => name))
    });
  } catch (error) {
    if (terminalCommitted) throw error;
    const failures = [];
    const compensationErrors = [];
    for (const entry of [...prepared].reverse()) {
      try {
        await canonicalAuthoringPublisherBoundary("refactor_compensate", {
          participant: entry.name
        });
        await entry.value.compensate({
          committed: committed.includes(entry)
        });
      } catch (compensationError) {
        compensationErrors.push(compensationError);
        failures.push({ participant: entry.name,
          cause_code: compensationError?.code ?? null,
          cause_message: compensationError?.message ?? null,
          details: compensationError?.details ?? null });
      }
    }

    if (failures.length > 0) carrierSetFailure("write_failed",
      "refactor settlement compensation could not prove fully uncommitted state", {
        cause_code: error?.code ?? null, cause_message: error?.message ?? null,
        committed_participants: committed.map(({ name }) => name),
        compensation_failures: failures, commit_state: 'indeterminate', retry_safe: false
      }, new AggregateError([error, ...compensationErrors],
        "refactor settlement failure and its compensation failures"));
    if (error.details?.commit_state !== 'indeterminate')
      error.details = { ...error.details, changed: false, settlement_status: 'compensated' };
    throw error;
  }
}

async function carrierGenerationPresent(generationDir) {
  try {
    await lstat(generationDir);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export async function prepareControlledContractRefactorCarrierSettlement(input, {
  compilerContract = null,
  proofSourceOverride = null
} = {}) {
  if (!isPlainObject(input) || input.profile !== CANONICAL_AUTHORING_PROFILE_ID) {
    carrierSetFailure("input_invalid",
      "refactor carrier settlement requires one canonical-authoring publication");
  }
  const store = await resolveControlledContractRepository(input.repoRoot);
  const manifestPath = carrierSetManifestPath(store, input.wkId, input.focus ?? null);
  const prior = await inspectCarrierFile(manifestPath, { required: false });
  if ((prior?.digest ?? null) !== input.expected_manifest_digest) carrierSetFailure(
    "stale_manifest", "visible carrier-set manifest changed before refactor preparation", {
      expected_manifest_digest: input.expected_manifest_digest,
      actual_manifest_digest: prior?.digest ?? null
    });
  const entries = canonicalAuthoringEntries(input);
  const resolvedCompilerContract = await resolveCanonicalAuthoringCompilerContract({
    repoRoot: store.repository, wkId: input.wkId, focus: input.focus ?? null,
    entries, compilerContract, proofSourceOverride
  });
  await validateCanonicalAuthoringEntries({ wkId: input.wkId,
    focus: input.focus ?? null, entries,
    compilerContract: resolvedCompilerContract });
  const prospectiveGeneration = canonicalAuthoringGeneration({ input, entries });
  const generationDir = path.join(store.contracts, ".carrier-generations",
    prospectiveGeneration);

  let generationExisted;
  try {
    generationExisted = await carrierGenerationPresent(generationDir);
  } catch (error) {
    fail("controlled_contract_carrier_read_failed",
      "prospective carrier generation presence could not be observed", {
        operation: "prepare_generation_observation", generation: prospectiveGeneration,
        cause_code: error?.code ?? null
      }, error);
  }
  let publication = null;
  return Object.freeze({
    commit: async () => {
      publication = await writeControlledContractCarrierSet(input, {
        compilerContract: resolvedCompilerContract, proofSourceOverride
      });
      return publication;
    },
    compensate: async () => {
      if (publication === null || publication.no_op === true) return;
      await withControlledContractAuthorityExclusion({ repoRoot: store.repository,
        wkId: input.wkId, run: async () => {
          const current = await inspectCarrierFile(manifestPath, { required: false });
          if (current?.digest !== publication.manifest_content_digest) carrierSetFailure(
            "stale_manifest",
            "refactor compensation cannot replace a concurrently selected generation", {
              expected_manifest_digest: publication.manifest_content_digest,
              actual_manifest_digest: current?.digest ?? null
            });
          const effects = { manifest_restored: false, generation_removed: false };
          const unverified = (operation, error) => carrierSetFailure("write_failed",
            "refactor carrier compensation could not verify the exact prior selection", {
              operation, cause_code: error?.code ?? null, generation: prospectiveGeneration,
              generation_existed: generationExisted, effects: { ...effects },
              commit_state: "indeterminate", retry_safe: false
            }, error);
          const step = async (operation, action) => {
            try { return await action(); } catch (error) { return unverified(operation, error); }
          };
          await step("manifest_restore", async () => {
            const rollback = `${manifestPath}.rollback-${randomUUID()}`;
            if (prior === null) await unlink(manifestPath);
            else {
              await writeFile(rollback, prior.bytes, { flag: "wx", mode: 0o600 });
              await rename(rollback, manifestPath);
            }
          });
          effects.manifest_restored = true;

          if (!generationExisted) {
            await step("generation_cleanup", () =>
              rm(generationDir, { recursive: true, force: false }));
            effects.generation_removed = true;
          }
          const restored = await step("manifest_verify", () =>
            inspectCarrierFile(manifestPath, { required: false }));
          if ((restored?.digest ?? null) !== (prior?.digest ?? null)) {
            unverified("manifest_verify", null);
          }
          if (!generationExisted && await step("generation_verify", () =>
            carrierGenerationPresent(generationDir))) unverified("generation_verify", null);
        } });
    }
  });
}

async function publishCanonicalAuthoringGenerationUnderAuthority({
  input, store, expectedManifestDigest, publicationOwner, assertSources,
  compilerContract = null, proofSourceOverride = null
}) {
  const entries = canonicalAuthoringEntries(input);
  const resolvedCompilerContract = await resolveCanonicalAuthoringCompilerContract({
    repoRoot: store.repository, wkId: input.wkId, focus: input.focus ?? null,
    entries, compilerContract, proofSourceOverride
  });
  await validateCanonicalAuthoringEntries({
    wkId: input.wkId, focus: input.focus ?? null, entries,
    compilerContract: resolvedCompilerContract
  });
  const { inspectNativePublicationProofParameters } = await import('../operations/controlled-contract/proof-authoring-source.mjs');
  const native = entries.find(entry => entry.carrier_kind === 'contract');
  const assessParameters = async () => native === undefined ? null : inspectNativePublicationProofParameters({
    repoRoot: store.repository, wkId: input.wkId, focus: input.focus ?? null,
    contract: JSON.parse(native.bytes), sourceOverride: proofSourceOverride });
  const parameterIdentity = await assessParameters();
  const assertParameterSources = async () => {
    if (await assessParameters() !== parameterIdentity) carrierSetFailure('source_stale',
      'Proof source, owning targets or exact definition changed before native publication');
  };

  const generation = canonicalAuthoringGeneration({ input, entries });
  const generationPath = path.posix.join(".carrier-generations", generation);
  const generationDir = path.join(store.contracts, generationPath);
  const manifestPath = carrierSetManifestPath(store, input.wkId, input.focus ?? null);
  const operationToken = publicationOwner.operationToken;
  const stagingName = `.carrier-set-staging-${operationToken}`;
  const temporaryManifestName = `.carrier-set-manifest-tmp-${operationToken}`;
  const staging = path.join(store.contracts, stagingName);
  const temporaryManifest = path.join(store.contracts, temporaryManifestName);
  const processStart = publicationOwner.processStart;
  const lockRecord = publicationLockRecord({
    operationToken, generation, stagingName, temporaryManifestName, processStart
  });
  const manifest = canonicalAuthoringManifest({
    input, entries, generation, generationPath
  });
  const manifestBytes = canonicalControlledContractCarrierSetManifestBytes(manifest);
  let locked;
  let generationCreated = false;
  let manifestSwitched = false;
  let priorManifestBytes = null;
  try {
    locked = await acquireCarrierSetPublicationLock({
      store, manifestPath, record: lockRecord
    });
    await canonicalAuthoringPublisherBoundary("publication_lock_acquired");
    const visible = await inspectCarrierFile(manifestPath, { required: false });
    if ((visible?.digest ?? null) !== expectedManifestDigest) carrierSetFailure(
      "stale_manifest", "visible carrier-set manifest changed", {
        expected_manifest_digest: expectedManifestDigest,
        actual_manifest_digest: visible?.digest ?? null
      });
    priorManifestBytes = visible?.bytes ?? null;
    await assertSources();
    await canonicalAuthoringPublisherBoundary("initial_sources_verified");

    if (visible?.bytes.equals(manifestBytes)) {
      await validateCanonicalAuthoringDirectory({
        directory: generationDir, entries, manifest
      });
      const resolved = await resolveCanonicalControlledContractCarrierSet({
        repoRoot: store.repository, wkId: input.wkId, focus: input.focus ?? null
      });
      if (resolved.generation !== generation || resolved.members.length !== entries.length ||
          entries.some((entry) =>
            resolved.members_by_basename[entry.filename]?.content_digest !==
              digestBytes(entry.bytes))) carrierSetFailure("manifest_mismatch",
        "exact replay did not re-resolve the planned canonical generation");
      return Object.freeze({
        schema_version: CARRIER_SET_SCHEMA_VERSION,
        profile: CANONICAL_AUTHORING_PROFILE_ID,
        wk_id: input.wkId,
        focus: input.focus ?? null,
        generation,
        manifest_digest: manifest.manifest_digest,
        manifest_content_digest: digestBytes(manifestBytes),
        manifest_path: path.basename(manifestPath),
        carrier_count: entries.length,
        written: false,
        no_op: true
      });
    }

    await mkdir(staging, { recursive: false, mode: 0o700 });
    await canonicalAuthoringPublisherBoundary("staging_created", { stagingName });
    for (const entry of entries) {
      await writeFile(path.join(staging, entry.filename), entry.bytes,
        { flag: "wx", mode: 0o600 });
      await canonicalAuthoringPublisherBoundary("member_written", {
        filename: entry.filename
      });
    }
    await writeFile(path.join(staging, "manifest.json"), manifestBytes,
      { flag: "wx", mode: 0o600 });
    await canonicalAuthoringPublisherBoundary("embedded_manifest_written");
    await validateCanonicalAuthoringDirectory({ directory: staging, entries, manifest });
    await canonicalAuthoringPublisherBoundary("staging_verified");
    await mkdir(path.dirname(generationDir), { recursive: true });
    await canonicalAuthoringPublisherBoundary("before_generation_rename");
    try {
      await rename(staging, generationDir);
      generationCreated = true;
    } catch (error) {
      if (!["EEXIST", "ENOTEMPTY"].includes(error?.code)) throw error;
      await rm(staging, { recursive: true, force: true });
    }
    await canonicalAuthoringPublisherBoundary("after_generation_rename", { generation });
    await validateCanonicalAuthoringDirectory({ directory: generationDir, entries, manifest });
    await canonicalAuthoringPublisherBoundary("generation_verified", { generation });
    await assertSources();
    await canonicalAuthoringPublisherBoundary("pre_manifest_sources_verified");
    await canonicalAuthoringPublisherBoundary("before_temporary_manifest_write");
    await writeFile(temporaryManifest, manifestBytes, { flag: "wx", mode: 0o600 });
    await canonicalAuthoringPublisherBoundary("after_temporary_manifest_write", {
      temporaryManifestName
    });
    const temporary = await inspectCarrierFile(temporaryManifest, { required: true });
    if (!temporary.bytes.equals(manifestBytes)) carrierSetFailure("manifest_mismatch",
      "temporary canonical manifest bytes differ before switch");
    await canonicalAuthoringPublisherBoundary("temporary_manifest_verified");
    await assertSources();
    await canonicalAuthoringPublisherBoundary("pre_switch_sources_verified");
    await canonicalAuthoringPublisherBoundary("before_manifest_switch");
    await rename(temporaryManifest, manifestPath);
    manifestSwitched = true;
    await canonicalAuthoringPublisherBoundary("after_manifest_switch", { generation });
    const resolved = await resolveCanonicalControlledContractCarrierSet({
      repoRoot: store.repository, wkId: input.wkId, focus: input.focus ?? null
    });
    if (resolved.generation !== generation || resolved.members.length !== entries.length ||
        entries.some((entry) =>
          resolved.members_by_basename[entry.filename]?.content_digest !==
            digestBytes(entry.bytes))) carrierSetFailure("manifest_mismatch",
      "post-publication canonical generation re-resolution differs");
    await canonicalAuthoringPublisherBoundary("published_generation_verified", { generation });
    return Object.freeze({
      schema_version: CARRIER_SET_SCHEMA_VERSION,
      profile: CANONICAL_AUTHORING_PROFILE_ID,
      wk_id: input.wkId,
      focus: input.focus ?? null,
      generation,
      manifest_digest: manifest.manifest_digest,
      manifest_content_digest: digestBytes(manifestBytes),
      manifest_path: path.basename(manifestPath),
      carrier_count: entries.length,
      written: true,
      no_op: false
    });
  } catch (error) {
    const compensationFailures = [];
    const compensate = async (phase, action) => {
      try { await action(); } catch (failure) {
        compensationFailures.push({ phase, code: failure.code ?? null, message: failure.message });
      }
    };
    await compensate('staging_cleanup', () => rm(staging, { recursive: true, force: true }));
    await compensate('temporary_manifest_cleanup', () => rm(temporaryManifest, { force: true }));
    if (manifestSwitched) await compensate('manifest_restore', async () => {
      const current = await inspectCarrierFile(manifestPath, { required: false });
      if (!current?.bytes.equals(manifestBytes)) carrierSetFailure('stale_manifest',
        'Compensation cannot replace a concurrently selected manifest');
      if (priorManifestBytes === null) await unlink(manifestPath);
      else {
        const rollback = `${manifestPath}.rollback-${operationToken}`;
        await writeFile(rollback, priorManifestBytes, { flag: 'wx', mode: 0o600 });
        await rename(rollback, manifestPath);
      }
      const restored = await inspectCarrierFile(manifestPath, { required: false });
      if (priorManifestBytes === null ? restored !== null : !restored?.bytes.equals(priorManifestBytes)) {
        carrierSetFailure('write_failed', 'Manifest compensation did not restore exact prior bytes');
      }
    });
    if (generationCreated) await compensate('generation_cleanup', async () => {
      const current = await inspectCarrierFile(manifestPath, { required: false });
      const currentManifest = current === null ? null : parseControlledContractCarrierSetManifest(current.bytes);
      if (currentManifest?.generation?.id !== generation) await rm(generationDir, { recursive: true, force: true });
    });
    if (compensationFailures.length) carrierSetFailure('write_failed', 'Publication compensation could not prove prior state', {
      cause_code: error.code ?? null, compensation_failures: compensationFailures,
      commit_state: 'indeterminate', retry_safe: false });
    error.details = { ...error.details, changed: false, settlement_status: 'compensated' };
    if (error instanceof ControlledContractToolError) throw error;
    carrierSetFailure('write_failed', 'Canonical carrier set could not be published', {
      cause_code: error.code ?? null, changed: false, settlement_status: 'compensated' });
  } finally {
    await releaseCarrierSetPublicationLock(locked);
  }
}

async function publishCanonicalAuthoringGeneration(args) {
  return withControlledContractAuthorityExclusion({
    repoRoot: args.store.repository,
    wkId: args.input.wkId,
    run: () => publishCanonicalAuthoringGenerationUnderAuthority(args)
  });
}

export async function writeControlledContractCarrierSet(input, {
  compilerContract = null,
  proofSourceOverride = null
} = {}) {
  if (!isPlainObject(input)) carrierSetFailure("input_invalid", "input must be one plain object");
  normalizeControlledContractIdentity({ wkId: input.wkId, focus: input.focus ?? null });
  if (typeof input.repository !== "string" || input.repository.length === 0) {
    carrierSetFailure("repository_missing", "carrier set requires one durable repository identity");
  }
  const canonicalAuthoring = isCanonicalAuthoringProfile(input.profile);
  const profile = canonicalAuthoring
    ? null : normalizeControlledContractPackIdentity(input.profile ?? {});
  if (!canonicalAuthoring && (profile.profileId !== INTEGRATION_CAPTURE_PROFILE.profileId ||
      profile.profileVersion !== INTEGRATION_CAPTURE_PROFILE.profileVersion)) {
    carrierSetFailure("wrong_profile",
      "carrier-set publication supports only the exact integration-prefix profile");
  }
  const expectedManifestDigest = input.expected_manifest_digest;
  if (expectedManifestDigest !== null && (typeof expectedManifestDigest !== "string" ||
      !DIGEST_PATTERN.test(expectedManifestDigest))) carrierSetFailure("expected_manifest_invalid",
    "expected_manifest_digest must be null or one exact sha256 digest");
  const store = await resolveControlledContractRepository(input.repoRoot);
  const leaseState = await assertControlledContractSourceLease(input.sourceLease, {
    repoRoot: store.repository, wkId: input.wkId, focus: input.focus ?? null,
    repository: input.repository
  });
  if (canonicalAuthoring) {
    return publishCanonicalAuthoringGeneration({
      input,
      store,
      expectedManifestDigest,
      publicationOwner: leaseState.publicationOwner,
      compilerContract,
      proofSourceOverride,
      assertSources: () => assertControlledContractSourceLease(input.sourceLease, {
        repoRoot: store.repository, wkId: input.wkId, focus: input.focus ?? null,
        repository: input.repository
      })
    });
  }
  const entries = await carrierSetInputs(input);
  const capture = carrierSetCapture(input);
  await validateCarrierSetPopulation({
    wkId: input.wkId, focus: input.focus ?? null, profile, entries, capture
  });
  const generation = carrierSetGenerationDigest({
    repository: input.repository, wkId: input.wkId, focus: input.focus ?? null,
    profile, entries, capture
  });
  const generationPath = path.posix.join(".carrier-generations", generation);
  const generationDir = path.join(store.contracts, generationPath);
  const manifestPath = carrierSetManifestPath(store, input.wkId, input.focus ?? null);
  const operationToken = leaseState.publicationOwner.operationToken;
  const stagingName = `.carrier-set-staging-${operationToken}`;
  const temporaryManifestName = `.carrier-set-manifest-tmp-${operationToken}`;
  const staging = path.join(store.contracts, stagingName);
  const temporaryManifest = path.join(store.contracts, temporaryManifestName);
  const processStart = leaseState.publicationOwner.processStart;
  let setLock;
  let generationCreated = false;
  setLock = await acquireCarrierSetPublicationLock({
    store,
    manifestPath,
    record: publicationLockRecord({
      operationToken, generation, stagingName, temporaryManifestName, processStart
    })
  });
  try {
    const visible = await inspectCarrierFile(manifestPath, { required: false });
    if ((visible?.digest ?? null) !== expectedManifestDigest) carrierSetFailure("stale_manifest",
      "visible carrier-set manifest changed", {
        expected_manifest_digest: expectedManifestDigest,
        actual_manifest_digest: visible?.digest ?? null
      });
    await mkdir(staging, { recursive: false, mode: 0o700 });
    for (const entry of entries) await writeFile(path.join(staging, entry.filename), entry.bytes,
      { flag: "wx", mode: 0o600 });
    const manifest = carrierSetManifest({
      input, entries, generation, generationPath, profile, capture
    });
    const manifestBytes = canonicalControlledContractCarrierSetManifestBytes(manifest);
    await writeFile(path.join(staging, "manifest.json"), manifestBytes,
      { flag: "wx", mode: 0o600 });
    await validateCarrierSetDirectory({ directory: staging, entries, profile });
    await mkdir(path.dirname(generationDir), { recursive: true });
    try {
      await rename(staging, generationDir);
      generationCreated = true;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      await rm(staging, { recursive: true, force: true });
    }
    await validateCarrierSetDirectory({ directory: generationDir, entries, profile });
    await assertControlledContractSourceLease(input.sourceLease, {
      repoRoot: store.repository, wkId: input.wkId, focus: input.focus ?? null,
      repository: input.repository
    });
    await writeFile(temporaryManifest, manifestBytes, { flag: "wx", mode: 0o600 });
    await assertControlledContractSourceLease(input.sourceLease, {
      repoRoot: store.repository, wkId: input.wkId, focus: input.focus ?? null,
      repository: input.repository
    });
    await rename(temporaryManifest, manifestPath);
    return Object.freeze({
      schema_version: CARRIER_SET_SCHEMA_VERSION,
      wk_id: input.wkId,
      focus: input.focus ?? null,
      generation,
      manifest_digest: manifest.manifest_digest,
      manifest_content_digest: digestBytes(manifestBytes),
      manifest_path: path.basename(manifestPath),
      carrier_count: entries.length,
      written: true
    });
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
    if (generationCreated) {
      await rm(generationDir, { recursive: true, force: true }).catch(() => {});
    }
    await rm(temporaryManifest, { force: true }).catch(() => {});
    if (error instanceof ControlledContractToolError) throw error;
    carrierSetFailure("write_failed", "canonical carrier set could not be published",
      { cause_code: error?.code ?? null });
  } finally {
    await releaseCarrierSetPublicationLock(setLock);
  }
}

export const CONTROLLED_CONTRACT_CARRIER_GENERATION_RECEIPT_SCHEMA_VERSION =
  "controlled-contract-carrier-generation-receipt.v1";

export const CONTROLLED_CONTRACT_CARRIER_ROLLBACK_CAUSE_CODES = Object.freeze([
  "carrier_manifest_concurrently_mutated",
  "carrier_generation_concurrently_mutated",
  "carrier_manifest_removal_failed",
  "carrier_generation_removal_failed",
  "carrier_rollback_absence_unverified",
  "carrier_rollback_lock_unavailable"
]);

function carrierGenerationReceipt({ wkId, focus, store, manifestPath, published, entries }) {
  return Object.freeze({
    schema_version: CONTROLLED_CONTRACT_CARRIER_GENERATION_RECEIPT_SCHEMA_VERSION,
    wk_id: wkId,
    focus: focus ?? null,
    generation: published.generation,
    generation_path: path.posix.join(".carrier-generations", published.generation),
    manifest_basename: path.basename(manifestPath),
    manifest_digest: published.manifest_digest,
    manifest_content_digest: published.manifest_content_digest,
    carrier_count: published.carrier_count,
    members: Object.freeze(entries.map((entry) => Object.freeze({
      carrier_kind: entry.carrier_kind,
      filename: entry.filename,
      content_digest: digestBytes(entry.bytes)
    }))),
    repository_root: store.repository
  });
}

export async function validateNewControlledContractCarrierMembers({
  wkId, focus = null, repository, members
}) {
  normalizeControlledContractIdentity({ wkId, focus });
  if (typeof repository !== "string" || repository.length === 0) {
    carrierSetFailure("repository_missing", "carrier set requires one durable repository identity");
  }
  if (!isPlainObject(members) || Object.keys(members).length === 0) {
    carrierSetFailure("carrier_missing",
      "new-generation publication requires one nonempty basename-addressed carrier population");
  }
  const entries = canonicalAuthoringEntries({
    repository, wkId, focus: focus ?? null, canonical_members: members
  });
  await validateCanonicalAuthoringEntries({ wkId, focus: focus ?? null, entries });
  return entries.map((entry) => Object.freeze({
    carrier_kind: entry.carrier_kind,
    filename: entry.filename,
    content_digest: digestBytes(entry.bytes),
    byte_length: entry.bytes.byteLength
  }));
}

export async function publishNewControlledContractCarrierGeneration({
  repoRoot, wkId, focus = null, repository, members
}) {
  normalizeControlledContractIdentity({ wkId, focus });
  if (typeof repository !== "string" || repository.length === 0) {
    carrierSetFailure("repository_missing", "carrier set requires one durable repository identity");
  }
  if (!isPlainObject(members) || Object.keys(members).length === 0) {
    carrierSetFailure("carrier_missing",
      "new-generation publication requires one nonempty basename-addressed carrier population");
  }
  const store = await resolveControlledContractRepository(repoRoot);
  const processStart = await processStartIdentity(process.pid).catch(() => null);
  if (processStart === null) {
    carrierSetFailure("busy", "carrier-set publication cannot bind the current process identity");
  }
  const input = {
    repoRoot: store.repository,
    repository,
    wkId,
    focus: focus ?? null,
    profile: CANONICAL_AUTHORING_PROFILE_ID,
    canonical_members: members
  };
  const entries = canonicalAuthoringEntries(input);
  const published = await publishCanonicalAuthoringGeneration({
    input,
    store,
    expectedManifestDigest: null,
    publicationOwner: Object.freeze({ operationToken: randomUUID(), processStart }),
    assertSources: async () => {}
  });
  if (published.written !== true) {
    carrierSetFailure("manifest_mismatch",
      "new-generation publication resolved an already-published generation for a new identity", {
        generation: published.generation
      });
  }
  return carrierGenerationReceipt({
    wkId,
    focus: focus ?? null,
    store,
    manifestPath: carrierSetManifestPath(store, wkId, focus ?? null),
    published,
    entries
  });
}

function carrierRollbackFailure(causeCode, details = {}) {
  return Object.freeze({
    ok: false,
    verified_absent: false,
    cause_code: causeCode,
    removed: Object.freeze({ manifest: false, generation: false }),
    details: Object.freeze(details)
  });
}

async function readVisibleManifestDigest(manifestPath) {
  const inspected = await inspectCarrierFile(manifestPath, { required: false });
  return inspected?.digest ?? null;
}

async function embeddedGenerationManifestDigest(generationDir) {
  const inspected = await inspectCarrierFile(path.join(generationDir, "manifest.json"), {
    required: false
  });
  return inspected?.digest ?? null;
}

export async function rollbackControlledContractCarrierSetPublication({ repoRoot, receipt }) {
  if (!isPlainObject(receipt) ||
      receipt.schema_version !== CONTROLLED_CONTRACT_CARRIER_GENERATION_RECEIPT_SCHEMA_VERSION) {
    return carrierRollbackFailure("carrier_rollback_absence_unverified", {
      reason: "receipt is not one exact carrier-generation publication receipt"
    });
  }
  try {
    return await withControlledContractAuthorityExclusion({
      repoRoot,
      wkId: receipt.wk_id,
      run: () => rollbackControlledContractCarrierSetPublicationUnderAuthority({ repoRoot, receipt })
    });
  } catch (error) {
    return carrierRollbackFailure("carrier_rollback_lock_unavailable", {
      cause: error?.code ?? null
    });
  }
}

async function rollbackControlledContractCarrierSetPublicationUnderAuthority({ repoRoot, receipt }) {
  if (!isPlainObject(receipt) ||
      receipt.schema_version !== CONTROLLED_CONTRACT_CARRIER_GENERATION_RECEIPT_SCHEMA_VERSION) {
    return carrierRollbackFailure("carrier_rollback_absence_unverified", {
      reason: "receipt is not one exact carrier-generation publication receipt"
    });
  }
  let store;
  try {
    store = await resolveControlledContractRepository(repoRoot);
  } catch (error) {
    return carrierRollbackFailure("carrier_rollback_absence_unverified", {
      cause: error?.code ?? null
    });
  }
  const manifestPath = carrierSetManifestPath(store, receipt.wk_id, receipt.focus ?? null);
  const generationDir = path.join(store.contracts, receipt.generation_path);
  let locked = null;
  let removedManifest = false;
  let removedGeneration = false;
  try {
    try {

      const operationToken = randomUUID();
      locked = await acquireCarrierSetPublicationLock({
        store,
        manifestPath,
        record: publicationLockRecord({
          operationToken,
          generation: receipt.generation,
          stagingName: `.carrier-set-staging-${operationToken}`,
          temporaryManifestName: `.carrier-set-manifest-tmp-${operationToken}`,
          processStart: await processStartIdentity(process.pid).catch(() => null)
        })
      });
    } catch (error) {
      return carrierRollbackFailure("carrier_rollback_lock_unavailable", {
        cause: error?.code ?? null
      });
    }

    const visibleDigest = await readVisibleManifestDigest(manifestPath);
    if (visibleDigest !== null) {
      if (visibleDigest !== receipt.manifest_content_digest) {
        return carrierRollbackFailure("carrier_manifest_concurrently_mutated", {
          expected_manifest_content_digest: receipt.manifest_content_digest,
          actual_manifest_content_digest: visibleDigest
        });
      }
      try {
        await unlink(manifestPath);
        removedManifest = true;
      } catch (error) {
        if (error?.code !== "ENOENT") {
          return carrierRollbackFailure("carrier_manifest_removal_failed", {
            cause: error?.code ?? null
          });
        }
      }
    }

    const generationEntry = await lstat(generationDir).catch(() => null);
    if (generationEntry !== null) {
      const embedded = await embeddedGenerationManifestDigest(generationDir);
      if (embedded !== receipt.manifest_content_digest) {
        return carrierRollbackFailure("carrier_generation_concurrently_mutated", {
          expected_manifest_content_digest: receipt.manifest_content_digest,
          actual_embedded_manifest_content_digest: embedded
        });
      }
      try {
        await rm(generationDir, { recursive: true, force: false });
        removedGeneration = true;
      } catch (error) {
        if (error?.code !== "ENOENT") {
          return carrierRollbackFailure("carrier_generation_removal_failed", {
            cause: error?.code ?? null
          });
        }
      }
    }

    const manifestStillVisible = (await readVisibleManifestDigest(manifestPath)) !== null;
    const generationStillPresent = (await lstat(generationDir).catch(() => null)) !== null;
    if (manifestStillVisible || generationStillPresent) {
      return carrierRollbackFailure("carrier_rollback_absence_unverified", {
        manifest_present: manifestStillVisible,
        generation_present: generationStillPresent
      });
    }
    return Object.freeze({
      ok: true,
      verified_absent: true,
      cause_code: null,
      removed: Object.freeze({ manifest: removedManifest, generation: removedGeneration }),
      details: Object.freeze({})
    });
  } catch (error) {
    return carrierRollbackFailure("carrier_rollback_absence_unverified", {
      cause: error?.code ?? null
    });
  } finally {
    await releaseCarrierSetPublicationLock(locked);
  }
}
