import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
  attachWorkRecordReadScopeAlias,
  computeWorkRecordSourceDigest,
  parseWorkRecordJson,
  validateWorkRecord
} from "./work-record-schema.mjs";

export const WORK_RECORD_DIRECTORY_NAME = "wiki/work-records";
export const WORK_RECORD_SCAN_TEMP_DIRECTORY_PREFIXES = [
  ".record-tmp-",
  ".work-record-escalation-",
  ".graph-sidecar-tmp-"
];

function isJsonFile(entry) {
  return entry.endsWith(".json");
}

export const CANONICAL_WORK_RECORD_BASENAME_PATTERN = /^WK-\d{4}\.json$/;

function toPosixRelativePath(targetDir, absolutePath) {
  return path.relative(targetDir, absolutePath).split(path.sep).join("/");
}

function createFileStore(targetDir) {
  return {
    async readBytes(filePath) {
      return readFile(filePath);
    },
    async readText(filePath) {
      return readFile(filePath, "utf8");
    },
    async pathExists(filePath) {
      try {
        await access(filePath);
        return true;
      } catch {
        return false;
      }
    },
    async listJsonPaths() {
      return listWorkRecordJsonPaths(targetDir);
    },
    async listCanonicalPaths() {
      return listCanonicalWorkRecordPaths(targetDir);
    }
  };
}

export function createWorkRecordStore(targetDir = ".") {
  return createFileStore(path.resolve(String(targetDir)));
}

export function getWorkRecordDirectory(targetDir = ".") {
  return path.resolve(String(targetDir), WORK_RECORD_DIRECTORY_NAME);
}

export function getWorkRecordPath(targetDir = ".", recordId) {
  return path.join(getWorkRecordDirectory(targetDir), `${String(recordId)}.json`);
}

export async function listWorkRecordJsonPaths(targetDir = ".") {
  const workRecordDir = getWorkRecordDirectory(targetDir);
  const entries = [];

  async function walk(currentDir) {
    let dirEntries;
    try {
      dirEntries = await readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of dirEntries) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (WORK_RECORD_SCAN_TEMP_DIRECTORY_PREFIXES.some((prefix) => entry.name.startsWith(prefix))) {
          continue;
        }
        await walk(absolutePath);
        continue;
      }
      if (entry.isFile() && isJsonFile(entry.name)) {
        entries.push(absolutePath);
      }
    }
  }

  await walk(workRecordDir);
  return entries.sort((left, right) => left.localeCompare(right));
}

export async function listCanonicalWorkRecordPaths(targetDir = ".") {
  const workRecordDir = getWorkRecordDirectory(targetDir);
  let entries;
  try {
    entries = await readdir(workRecordDir, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter(
      (entry) =>
        entry.isFile() && CANONICAL_WORK_RECORD_BASENAME_PATTERN.test(entry.name)
    )
    .map((entry) => path.join(workRecordDir, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

function recordInstrumentation(instrumentation, name, amount = 1) {
  if (typeof instrumentation?.increment === "function") {
    instrumentation.increment(name, amount);
  }
}

function filterCanonicalPaths(targetDir, paths) {
  const workRecordDir = getWorkRecordDirectory(targetDir);
  return paths
    .map((entry) => path.resolve(String(entry)))
    .filter(
      (entry) =>
        path.dirname(entry) === workRecordDir &&
        CANONICAL_WORK_RECORD_BASENAME_PATTERN.test(path.basename(entry))
    )
    .sort((left, right) => left.localeCompare(right));
}

async function listCanonicalPathsFromStore(targetDir, store) {
  if (typeof store.listCanonicalPaths === "function") {
    return filterCanonicalPaths(targetDir, await store.listCanonicalPaths());
  }
  if (typeof store.listJsonPaths === "function") {
    return filterCanonicalPaths(targetDir, await store.listJsonPaths());
  }
  return [];
}

async function readStoreBytes(store, absolutePath) {
  if (typeof store.readBytes === "function") {
    const value = await store.readBytes(absolutePath);
    return Buffer.isBuffer(value) ? value : Buffer.from(value);
  }
  if (typeof store.readText === "function") {
    return Buffer.from(await store.readText(absolutePath), "utf8");
  }
  throw new TypeError("work-record store must expose readBytes or readText");
}

export class WorkRecordCorpusUnstableError extends Error {
  constructor({ before, after }) {
    super("Canonical work-record path population changed while the corpus was being captured");
    this.name = "WorkRecordCorpusUnstableError";
    this.code = "work_record_corpus_unstable";
    this.before = Object.freeze([...before]);
    this.after = Object.freeze([...after]);
  }
}

export async function captureCanonicalWorkRecordInventory({
  dir = ".",
  recordStore = null,
  instrumentation = null
} = {}) {
  const targetDir = path.resolve(String(dir));
  const store = await resolveStore(targetDir, recordStore);
  const before = await listCanonicalPathsFromStore(targetDir, store);
  recordInstrumentation(instrumentation, "canonical_inventory_count", before.length);
  const captured = [];

  for (const absolutePath of before) {
    let rawBytes = null;
    let readError = null;
    try {
      rawBytes = await readStoreBytes(store, absolutePath);
      recordInstrumentation(instrumentation, "canonical_read_count");
      recordInstrumentation(instrumentation, "canonical_bytes_read", rawBytes.byteLength);
    } catch (error) {
      readError = error;
      recordInstrumentation(instrumentation, "canonical_read_count");
    }
    captured.push({
      absolutePath,
      relativePath: toPosixRelativePath(targetDir, absolutePath),
      rawBytes,
      prefix: rawBytes === null ? Buffer.alloc(0) : rawBytes.subarray(0, 2),
      readError
    });
  }

  const after = await listCanonicalPathsFromStore(targetDir, store);
  if (before.length !== after.length || before.some((entry, index) => entry !== after[index])) {
    throw new WorkRecordCorpusUnstableError({
      before: before.map((entry) => toPosixRelativePath(targetDir, entry)),
      after: after.map((entry) => toPosixRelativePath(targetDir, entry))
    });
  }

  return captured;
}

async function resolveStore(targetDir, recordStore) {
  if (recordStore) {
    return recordStore;
  }
  return createFileStore(targetDir);
}

function isDuplicateClaimsIndex(value) {
  return value && typeof value.get === "function" && typeof value.has === "function";
}

function lookupDuplicateClaimsFromIndex(index, recordId, currentPath) {
  if (!recordId || !isDuplicateClaimsIndex(index)) {
    return [];
  }
  const entries = index.get(recordId);
  if (!entries) {
    return [];
  }
  const currentResolved = path.resolve(currentPath);
  const claims = [];
  for (const claimedPath of entries) {
    if (path.resolve(claimedPath) === currentResolved) {
      continue;
    }
    claims.push({ path: claimedPath, id: recordId });
  }
  return claims;
}

export async function buildWorkRecordDuplicateClaimsIndex({
  dir = ".",
  recordStore = null
} = {}) {
  const targetDir = path.resolve(String(dir));
  const store = await resolveStore(targetDir, recordStore);
  if (typeof store.listJsonPaths !== "function") {
    throw new TypeError(
      "duplicate-claim indexing requires a work-record store with listJsonPaths"
    );
  }

  const jsonPaths = [...new Set(
    (await store.listJsonPaths()).map((entry) => path.resolve(String(entry)))
  )].sort((left, right) => left.localeCompare(right));
  const index = new Map();
  for (const absolutePath of jsonPaths) {
    const rawBytes = await readStoreBytes(store, absolutePath);
    const parsed = parseWorkRecordJson(rawBytes.toString("utf8"), { sourcePath: absolutePath });
    if (!parsed.ok || typeof parsed.value?.id !== "string" || parsed.value.id.length === 0) {
      continue;
    }
    const claimants = index.get(parsed.value.id) || [];
    claimants.push(absolutePath);
    index.set(parsed.value.id, claimants);
  }
  return index;
}

export async function loadWorkRecordByPath({
  dir = ".",
  path: requestedPath,
  recordStore = null,
  duplicateClaimsIndex = null
} = {}) {
  if (!requestedPath) {
    throw new Error("loadWorkRecordByPath requires path");
  }

  const targetDir = path.resolve(String(dir));
  const store = await resolveStore(targetDir, recordStore);
  const absolutePath = path.isAbsolute(String(requestedPath))
    ? path.resolve(String(requestedPath))
    : path.resolve(targetDir, String(requestedPath));
  const sourcePath = toPosixRelativePath(targetDir, absolutePath);
  const expectedPath = absolutePath;
  const result = {
    valid: false,
    source_path: expectedPath,
    source_path_relative: sourcePath,
    source_digest: null,
    record_id: null,
    record: null,
    diagnostics: [],
    duplicate_claims: []
  };

  if (typeof store.pathExists === "function" && !(await store.pathExists(absolutePath))) {
    result.diagnostics.push({
      code: "missing_json_record",
      severity: "error",
      message: `Missing canonical work record JSON: ${sourcePath}`,
      path: sourcePath
    });
    return result;
  }

  let text;
  try {
    text = await store.readText(absolutePath);
  } catch (error) {
    result.diagnostics.push({
      code: "missing_json_record",
      severity: "error",
      message: `Missing canonical work record JSON: ${sourcePath}`,
      path: sourcePath
    });
    return result;
  }

  const parsed = parseWorkRecordJson(text, { sourcePath: absolutePath });
  if (!parsed.ok) {
    result.diagnostics.push(...parsed.diagnostics);
    return result;
  }

  const record = parsed.value;
  const sourceDigest = computeWorkRecordSourceDigest(record);
  const diagnostics = validateWorkRecord(record, {
    sourcePath: absolutePath,
    sourceDigest
  });
  let duplicateClaims = [];
  if (isJsonFile(path.basename(absolutePath))) {
    duplicateClaims = isDuplicateClaimsIndex(duplicateClaimsIndex)
      ? lookupDuplicateClaimsFromIndex(duplicateClaimsIndex, record.id, absolutePath)
      : [];
  }

  if (duplicateClaims.length > 0) {
    diagnostics.push({
      code: "duplicate_record_id",
      severity: "error",
      message: `Record id ${record.id} is also claimed by ${duplicateClaims
        .map((claim) => toPosixRelativePath(targetDir, claim.path))
        .join(", ")}`,
      path: sourcePath
    });
  }

  result.valid = diagnostics.every((entry) => entry.severity !== "error");
  result.source_digest = sourceDigest;
  result.record_id = record.id || null;

  result.record = attachWorkRecordReadScopeAlias(record);
  result.diagnostics = diagnostics;
  result.duplicate_claims = duplicateClaims.map((claim) => ({
    path: toPosixRelativePath(targetDir, claim.path),
    id: claim.id
  }));
  return result;
}

export async function loadWorkRecordById({
  dir = ".",
  id,
  recordStore = null,
  duplicateClaimsIndex = null
} = {}) {
  if (!id) {
    throw new Error("loadWorkRecordById requires id");
  }

  const targetDir = path.resolve(String(dir));
  const canonicalPath = getWorkRecordPath(targetDir, id);
  const result = await loadWorkRecordByPath({
    dir: targetDir,
    path: canonicalPath,
    recordStore,
    duplicateClaimsIndex
  });

  if (result.diagnostics.some((entry) => entry.code === "missing_json_record")) {
    result.diagnostics[0].message = `Missing canonical work record JSON: ${path
      .relative(targetDir, canonicalPath)
      .split(path.sep)
      .join("/")}`;
    return result;
  }

  return result;
}
