import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
  attachWorkRecordReadScopeAlias,
  computeWorkRecordSourceDigest,
  parseWorkRecordJson,
  validateWorkRecord
} from "./work-record-schema.mjs";

export const WORK_RECORD_DIRECTORY_NAME = "wiki/work-records";

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isJsonFile(entry) {
  return entry.endsWith(".json");
}

function toPosixRelativePath(targetDir, absolutePath) {
  return path.relative(targetDir, absolutePath).split(path.sep).join("/");
}

function createFileStore(targetDir) {
  return {
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

async function resolveStore(targetDir, recordStore) {
  if (recordStore) {
    return recordStore;
  }
  return createFileStore(targetDir);
}

async function collectDuplicateClaims(targetDir, recordId, currentPath, recordStore) {
  const store = await resolveStore(targetDir, recordStore);
  if (typeof store.listJsonPaths !== "function") {
    return [];
  }

  const jsonPaths = await store.listJsonPaths();
  const claims = [];
  for (const absolutePath of jsonPaths) {
    if (path.resolve(absolutePath) === path.resolve(currentPath)) {
      continue;
    }
    let text;
    try {
      text = await store.readText(absolutePath);
    } catch {
      continue;
    }
    const parsed = parseWorkRecordJson(text, { sourcePath: absolutePath });
    if (!parsed.ok || !hasOwn(parsed.value, "id")) {
      continue;
    }
    if (parsed.value.id === recordId) {
      claims.push({
        path: absolutePath,
        id: parsed.value.id
      });
    }
  }
  return claims;
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
  const index = new Map();
  if (typeof store.listJsonPaths !== "function") {
    return index;
  }

  const jsonPaths = await store.listJsonPaths();
  for (const absolutePath of jsonPaths) {
    if (!isJsonFile(path.basename(absolutePath))) {
      continue;
    }
    let text;
    try {
      text = await store.readText(absolutePath);
    } catch {
      continue;
    }
    const parsed = parseWorkRecordJson(text, { sourcePath: absolutePath });
    if (!parsed.ok || !hasOwn(parsed.value, "id")) {
      continue;
    }
    const recordId = parsed.value.id;
    if (!recordId) {
      continue;
    }
    const claimants = index.get(recordId) || [];
    claimants.push(absolutePath);
    index.set(recordId, claimants);
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
