

import { lstat, mkdtemp, open, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { classifyControlledContractRepositoryPath } from
  "./controlled-contract-tool-shared.mjs";
import { ensureDirectory, normalizeType, pathExists } from "./wiki-shared.mjs";

const ALLOCATOR_STATE_FILE = ".id-state.json";
const ALLOCATOR_LOCK_FILE = ".id-state.lock";

export function getAllocatorPaths(targetDir) {
  const wikiDir = path.join(targetDir, "wiki");
  return {
    statePath: path.join(wikiDir, ALLOCATOR_STATE_FILE),
    lockPath: path.join(wikiDir, ALLOCATOR_LOCK_FILE)
  };
}

export async function ensureAllocatorState(targetDir, manifest) {
  await ensureDirectory(path.join(targetDir, "wiki"));
  return withAllocatorLock(targetDir, async () => {
    const { statePath } = getAllocatorPaths(targetDir);
    if (await allocatorStateEntryIsPresent(statePath)) {
      return readAllocatorState(targetDir, manifest);
    }

    const state = await scanAllocatorState(targetDir, manifest);
    await writeAllocatorStateAtomically(targetDir, state);
    return state;
  });
}

export async function nextId(targetDir, type, manifest, { reserve = false } = {}) {
  const normalizedType = normalizeType(type, manifest);
  const definition = manifest.types[normalizedType];
  if (definition.idStrategy !== "allocated") {
    throw new Error(`${normalizedType} does not use allocated IDs`);
  }

  if (reserve) {
    return withAllocatorLock(targetDir, async () => {
      const state = await readOrInitializeAllocatorState(targetDir, manifest);
      const nextValue = Number.parseInt(state[definition.stateKey] ?? 0, 10) + 1;
      state[definition.stateKey] = nextValue;
      await writeAllocatorStateAtomically(targetDir, state);
      return formatAllocatedId(definition, nextValue);
    });
  }

  const state = await ensureAllocatorState(targetDir, manifest);
  const nextValue = Number.parseInt(state[definition.stateKey] ?? 0, 10) + 1;
  return formatAllocatedId(definition, nextValue);
}

const ALLOCATOR_CLEANUP_EVIDENCE_FIELD = "cleanup_failures";

function allocatorCleanupEvidence(failures, offset = 0) {
  return failures.map(({ step, error }, index) => Object.freeze({
    step,
    order: offset + index,
    code: error?.code ?? null,
    message: error instanceof Error ? error.message : String(error),
    error
  }));
}

function withAllocatorCleanupEvidence(primary, failures) {
  if (failures.length === 0) return primary;
  if (primary instanceof Error || (primary && typeof primary === "object")) {
    const existing = Array.isArray(primary[ALLOCATOR_CLEANUP_EVIDENCE_FIELD])
      ? primary[ALLOCATOR_CLEANUP_EVIDENCE_FIELD]
      : [];
    primary[ALLOCATOR_CLEANUP_EVIDENCE_FIELD] = Object.freeze([
      ...existing,
      ...allocatorCleanupEvidence(failures, existing.length)
    ]);
  }
  return primary;
}

export async function withAllocatorLock(targetDir, callback, { faultInjector = null } = {}) {
  await ensureDirectory(path.join(targetDir, "wiki"));
  const { lockPath } = getAllocatorPaths(targetDir);
  const retries = 50;
  const delayMs = 100;
  let handle = null;

  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      handle = await open(lockPath, "wx");
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  if (!handle) {
    throw new Error(`Timed out waiting for allocator lock at ${lockPath}`);
  }

  let primary = null;
  let hasPrimary = false;
  let result;
  try {
    result = await callback();
  } catch (error) {
    primary = error;
    hasPrimary = true;
  }

  const failures = [];
  for (const { step, cleanup } of [
    { step: "allocator_lock_handle_close", cleanup: () => handle.close() },

    { step: "allocator_lock_path_remove", cleanup: () => rm(lockPath, { force: true }) }
  ]) {
    try {
      if (typeof faultInjector === "function") await faultInjector(step);
      await cleanup();
    } catch (error) {
      failures.push({ step, error });
    }
  }

  if (hasPrimary) throw withAllocatorCleanupEvidence(primary, failures);
  if (failures.length > 0) {
    throw withAllocatorCleanupEvidence(failures[0].error, failures.slice(1));
  }
  return result;
}

export async function readOrInitializeAllocatorState(targetDir, manifest) {
  const { statePath } = getAllocatorPaths(targetDir);
  if (await allocatorStateEntryIsPresent(statePath)) {
    return readAllocatorState(targetDir, manifest);
  }

  const state = await scanAllocatorState(targetDir, manifest);
  await writeAllocatorStateAtomically(targetDir, state);
  return state;
}

async function allocatorStateEntryIsPresent(statePath) {
  let entry;
  try {
    entry = await lstat(statePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw new Error(
      `Allocator state entry is unreadable at ${statePath} (${error?.code ?? "unknown"})`,
      { cause: error }
    );
  }

  if (!entry.isFile()) {
    throw new Error(`Allocator state entry at ${statePath} is not a regular file`);
  }

  return true;
}

async function readAllocatorState(targetDir, manifest) {
  const { statePath } = getAllocatorPaths(targetDir);
  const raw = JSON.parse(await readFile(statePath, "utf8"));
  const state = {};
  for (const definition of getAllocatedTypes(manifest)) {
    const value = raw[definition.stateKey];
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(
        `Allocator state is malformed for '${definition.stateKey}' at ${statePath}`
      );
    }
    state[definition.stateKey] = value;
  }
  return state;
}

export async function writeAllocatorStateAtomically(targetDir, state) {
  const { statePath } = getAllocatorPaths(targetDir);
  const tempDir = await mkdtemp(path.join(path.dirname(statePath), ".state-tmp-"));
  const tempPath = path.join(tempDir, path.basename(statePath));
  try {
    await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(tempPath, statePath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function scanAllocatorState(targetDir, manifest) {
  const state = {};
  for (const definition of getAllocatedTypes(manifest)) {
    state[definition.stateKey] = await scanHighestAllocatedValue(targetDir, definition);
  }
  return state;
}

export async function collectOccupiedAllocatedRecordValues(targetDir, definition) {
  const occupied = new Set();
  await collectAllocatedMarkdownValues(targetDir, definition, occupied);
  if (definition.directory === "wiki/issues") {
    await collectAllocatedJsonWorkRecordValues(targetDir, definition, occupied);
    await collectAllocatedControlledCarrierValues(targetDir, definition, occupied);
  }
  return occupied;
}

async function scanHighestAllocatedValue(targetDir, definition) {
  const occupied = await collectOccupiedAllocatedRecordValues(targetDir, definition);
  let highest = 0;
  for (const value of occupied) {
    highest = Math.max(highest, value);
  }
  return highest;
}

async function collectAllocatedMarkdownValues(targetDir, definition, occupied) {
  const directoryPath = path.join(targetDir, definition.directory);
  if (!(await pathExists(directoryPath))) {
    return;
  }

  const entries = await readdir(directoryPath, { withFileTypes: true });
  const pattern = new RegExp(`^${definition.prefix}-(\\d{4})\\.md$`);
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const match = entry.name.match(pattern);
    if (!match) {
      continue;
    }
    occupied.add(Number.parseInt(match[1], 10));
  }
}

async function collectAllocatedJsonWorkRecordValues(targetDir, definition, occupied) {
  const directoryPath = path.join(targetDir, "wiki", "work-records");
  if (!(await pathExists(directoryPath))) {
    return;
  }

  const entries = await readdir(directoryPath, { withFileTypes: true });
  const pattern = new RegExp(`^${definition.prefix}-(\\d{4})\\.json$`);
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const match = entry.name.match(pattern);
    if (!match) {
      continue;
    }
    occupied.add(Number.parseInt(match[1], 10));
  }
}

const CONTROLLED_CONTRACT_STORE_SEGMENTS = ["wiki", "contracts"];

function collectAllocatedCarrierPath(repositoryPath, definition, occupied) {
  const name = path.posix.basename(repositoryPath);
  const pattern = new RegExp(`^${definition.prefix}-(\\d{4})(?:[-.]|$)`);
  const match = name.match(pattern);
  if (!match) return;
  const wkId = `${definition.prefix}-${match[1]}`;
  const classification = classifyControlledContractRepositoryPath({ wkId, repositoryPath });
  if (classification.active === true || classification.accumulated === true) {
    occupied.add(Number.parseInt(match[1], 10));
  }
}

async function collectAllocatedControlledCarrierValues(targetDir, definition, occupied) {
  const storePath = path.join(targetDir, ...CONTROLLED_CONTRACT_STORE_SEGMENTS);
  if (!(await pathExists(storePath))) {
    return;
  }

  async function visit(directoryPath, relativeSegments) {
    let entries;
    try {
      entries = await readdir(directoryPath, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const childSegments = [...relativeSegments, entry.name];
      const repositoryPath = ["wiki", "contracts", ...childSegments].join("/");
      collectAllocatedCarrierPath(repositoryPath, definition, occupied);
      if (entry.isDirectory()) {
        await visit(path.join(directoryPath, entry.name), childSegments);
      }
    }
  }
  await visit(storePath, []);
}

function getAllocatedTypes(manifest) {
  return Object.values(manifest.types).filter(
    (definition) => definition.idStrategy === "allocated"
  );
}

export function formatAllocatedId(definition, value) {
  return `${definition.prefix}-${String(value).padStart(4, "0")}`;
}

export function normalizeAllocatedRecordId(id, definition, type) {
  if (id == null) {
    return null;
  }

  const normalized = String(id).trim().toUpperCase();
  if (!normalized) {
    return null;
  }

  const pattern = new RegExp(`^${definition.prefix}-(\\d{4})$`);
  if (!pattern.test(normalized)) {
    throw new Error(`Expected ${type} ID to match ${definition.prefix}-0001`);
  }

  return normalized;
}

export function parseAllocatedIdValue(id, definition) {
  const match = String(id).match(new RegExp(`^${definition.prefix}-(\\d{4})$`));
  if (!match) {
    throw new Error(`Malformed allocated ID: ${id}`);
  }
  return Number.parseInt(match[1], 10);
}

export async function nextAllocatedRecordValue(targetDir, definition, stateValue) {
  const occupied = await collectOccupiedAllocatedRecordValues(targetDir, definition);
  let highestExisting = 0;
  for (const value of occupied) {
    highestExisting = Math.max(highestExisting, value);
  }
  let candidate = highestExisting < stateValue
    ? highestExisting + 1
    : Math.max(highestExisting, stateValue) + 1;
  while (occupied.has(candidate)) {
    candidate += 1;
  }
  return candidate;
}
