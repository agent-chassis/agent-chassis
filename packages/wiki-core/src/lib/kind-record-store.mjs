

import path from "node:path";
import { mkdtemp, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { loadManifest } from "./contract.mjs";
import { getRecordKindSpec, validateRecordByKind } from "./work-record-kind-registry.mjs";
import { renderRecordByKindMarkdown } from "./work-record-kind-renderer.mjs";
import { computeWorkRecordSourceDigest } from "./work-record-schema.mjs";
import { ensureDirectory } from "./wiki-shared.mjs";

const KIND_RECORD_WRITE_LOCK_FILE = ".kind-record-write.lock";
const KIND_RECORD_WRITE_LOCK_STALE_AFTER_MS = 60_000;
const KIND_RECORD_WRITE_LOCK_RETRY_DELAY_MS = 100;
const KIND_RECORD_WRITE_LOCK_RETRY_ATTEMPTS = 50;

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSupportedKind(kind) {
  return typeof kind === "string" && kind !== "work_item" && getRecordKindSpec(kind) !== null;
}

function unsupportedKindDiagnostic(kind, targetPath = "record_kind") {
  return {
    code: "unsupported_record_kind",
    severity: "error",
    message: `Unsupported record kind: ${kind}`,
    path: targetPath
  };
}

async function resolveKindDirectory(kind) {
  const manifest = await loadManifest();
  const definition = manifest?.types?.[kind];
  if (!definition || typeof definition.directory !== "string" || definition.directory === "") {
    return null;
  }
  return definition.directory;
}

async function buildKindPrefixIndex() {
  const manifest = await loadManifest();
  const types = manifest?.types ?? {};
  const index = new Map();
  for (const [kind, definition] of Object.entries(types)) {
    if (!isSupportedKind(kind)) {
      continue;
    }
    if (typeof definition.prefix !== "string" || typeof definition.directory !== "string") {
      continue;
    }
    index.set(definition.prefix, { kind, directory: definition.directory });
  }
  return index;
}

function idPrefix(id) {
  return String(id).split("-")[0];
}

export async function getKindRecordPath(kind, id) {
  if (!isSupportedKind(kind)) {
    return null;
  }
  const directory = await resolveKindDirectory(kind);
  if (!directory) {
    return null;
  }
  return `${directory}/${id}.json`;
}

function markdownPathFor(relativeJsonPath) {
  return relativeJsonPath.replace(/\.json$/, ".md");
}

export async function loadKindRecordById({ repoRoot = ".", id } = {}) {
  if (!id) {
    throw new Error("loadKindRecordById requires id");
  }
  const targetRoot = path.resolve(String(repoRoot));
  const result = {
    valid: false,
    source_path: null,
    source_digest: null,
    record_id: null,
    record: null,
    diagnostics: []
  };

  const prefixIndex = await buildKindPrefixIndex();
  const resolved = prefixIndex.get(idPrefix(id));
  if (!resolved) {
    result.diagnostics.push(unsupportedKindDiagnostic(idPrefix(id)));
    return result;
  }

  const relativePath = `${resolved.directory}/${id}.json`;
  const absolutePath = path.resolve(targetRoot, relativePath);
  result.source_path = relativePath;

  let text;
  try {
    text = await readFile(absolutePath, "utf8");
  } catch {
    result.diagnostics.push({
      code: "missing_json_record",
      severity: "error",
      message: `Missing canonical ${resolved.kind} record JSON: ${relativePath}`,
      path: relativePath
    });
    return result;
  }

  let record;
  try {
    record = JSON.parse(text);
  } catch (error) {
    result.diagnostics.push({
      code: "invalid_json",
      severity: "error",
      message: `Could not parse ${relativePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      path: relativePath
    });
    return result;
  }

  const diagnostics = validateRecordByKind(record);
  result.record = record;
  result.record_id = typeof record?.id === "string" ? record.id : null;
  result.source_digest = computeWorkRecordSourceDigest(record);
  result.diagnostics = diagnostics;
  result.valid = diagnostics.every((entry) => entry.severity !== "error");
  return result;
}

function getKindRecordWriteLockPath(targetRoot) {
  return path.join(targetRoot, "wiki", KIND_RECORD_WRITE_LOCK_FILE);
}

function buildLockMetadata() {
  return { acquired_at: new Date().toISOString(), pid: process.pid };
}

function getProcessLiveness(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return "unknown";
  }
  try {
    process.kill(pid, 0);
    return "alive";
  } catch (error) {
    if (error?.code === "ESRCH") {
      return "dead";
    }
    if (error?.code === "EPERM") {
      return "alive";
    }
    return "unknown";
  }
}

async function readLockState(lockPath) {
  try {
    const [lockStats, rawText] = await Promise.all([stat(lockPath), readFile(lockPath, "utf8")]);
    let pid = null;
    let ageMs = Number.isFinite(lockStats.mtimeMs) ? Math.max(0, Date.now() - lockStats.mtimeMs) : null;
    try {
      const parsed = JSON.parse(rawText);
      pid = Number.isInteger(parsed?.pid) ? parsed.pid : null;
      const acquiredAtMs = parsed?.acquired_at ? Date.parse(parsed.acquired_at) : Number.NaN;
      if (Number.isFinite(acquiredAtMs) && acquiredAtMs > 0) {
        ageMs = Math.max(0, Date.now() - acquiredAtMs);
      }
    } catch {

    }
    return { exists: true, rawText, ageMs, liveness: getProcessLiveness(pid) };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { exists: false, rawText: null, ageMs: null, liveness: "unknown" };
    }
    throw error;
  }
}

function shouldRecoverStaleLock(lockState) {
  if (!lockState?.exists) {
    return false;
  }
  if (lockState.liveness === "dead") {
    return true;
  }
  if (lockState.liveness === "unknown" && lockState.ageMs !== null) {
    return lockState.ageMs >= KIND_RECORD_WRITE_LOCK_STALE_AFTER_MS;
  }
  return false;
}

async function breakStaleLock(lockPath, observedState) {
  const currentState = await readLockState(lockPath);
  if (
    !currentState.exists ||
    currentState.rawText !== observedState.rawText ||
    !shouldRecoverStaleLock(currentState)
  ) {
    return false;
  }
  const recoveryPath = `${lockPath}.stale-${process.pid}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
  try {
    await rename(lockPath, recoveryPath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  } finally {
    await rm(recoveryPath, { force: true });
  }
}

async function withKindRecordWriteLock(targetRoot, callback) {
  const lockPath = getKindRecordWriteLockPath(targetRoot);
  await ensureDirectory(path.dirname(lockPath));
  let handle = null;

  for (let attempt = 0; attempt < KIND_RECORD_WRITE_LOCK_RETRY_ATTEMPTS; attempt += 1) {
    try {
      handle = await open(lockPath, "wx");
      try {
        await handle.writeFile(`${JSON.stringify(buildLockMetadata(), null, 2)}\n`, {
          encoding: "utf8"
        });
      } catch (error) {
        await handle.close();
        handle = null;
        await rm(lockPath, { force: true });
        throw error;
      }
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
      const lockState = await readLockState(lockPath);
      if (shouldRecoverStaleLock(lockState) && (await breakStaleLock(lockPath, lockState))) {
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, KIND_RECORD_WRITE_LOCK_RETRY_DELAY_MS));
    }
  }

  if (!handle) {
    throw new Error(`Timed out waiting for kind-record write lock at ${lockPath}`);
  }

  try {
    return await callback();
  } finally {
    await handle.close();
    await rm(lockPath, { force: true });
  }
}

async function writeFileToTemp(filePath, contents) {
  const directory = path.dirname(filePath);
  const tempDir = await mkdtemp(path.join(directory, ".kind-record-tmp-"));
  const tempPath = path.join(tempDir, path.basename(filePath));
  await writeFile(tempPath, contents, { encoding: "utf8", flag: "wx" });
  return { tempDir, tempPath };
}

async function readOnDiskDigest(absoluteJsonPath) {
  let text;
  try {
    text = await readFile(absoluteJsonPath, "utf8");
  } catch {
    return null;
  }
  try {
    return computeWorkRecordSourceDigest(JSON.parse(text));
  } catch {
    return null;
  }
}

function serializeRecord(record) {
  return `${JSON.stringify(record, null, 2)}\n`;
}

function refusal(diagnostics, sourceDigest = null) {
  return { ok: false, written: false, source_digest: sourceDigest, diagnostics };
}

export async function writeValidatedKindRecord({
  repoRoot = ".",
  record,
  expectedSourceDigest = null
} = {}) {
  const targetRoot = path.resolve(String(repoRoot));

  if (!isObject(record)) {
    return refusal([
      { code: "invalid_record", severity: "error", message: "record must be an object", path: null }
    ]);
  }

  const kind = record.record_kind;
  if (!isSupportedKind(kind)) {
    return refusal([unsupportedKindDiagnostic(kind)]);
  }

  const recordId = typeof record.id === "string" ? record.id : null;
  if (!recordId) {
    return refusal([
      { code: "invalid_record", severity: "error", message: "id is required", path: "id" }
    ]);
  }

  const diagnostics = validateRecordByKind(record);
  const sourceDigest = computeWorkRecordSourceDigest(record);
  if (diagnostics.some((entry) => entry.severity === "error")) {
    return refusal(diagnostics, sourceDigest);
  }

  const projection = renderRecordByKindMarkdown(record);
  if (!projection.valid || typeof projection.markdown !== "string") {
    return refusal(projection.diagnostics ?? [unsupportedKindDiagnostic(kind)], sourceDigest);
  }

  if (
    expectedSourceDigest !== null &&
    expectedSourceDigest !== undefined &&
    (typeof expectedSourceDigest !== "string" || expectedSourceDigest.length === 0)
  ) {
    return refusal(
      [
        {
          code: "invalid_expected_source_digest",
          severity: "error",
          message: "expected source digest must be a non-empty string",
          path: null
        }
      ],
      sourceDigest
    );
  }

  const directory = await resolveKindDirectory(kind);
  if (!directory) {
    return refusal([unsupportedKindDiagnostic(kind)], sourceDigest);
  }

  const relativeJsonPath = `${directory}/${recordId}.json`;
  const relativeMarkdownPath = markdownPathFor(relativeJsonPath);
  const absoluteJsonPath = path.resolve(targetRoot, relativeJsonPath);
  const absoluteMarkdownPath = path.resolve(targetRoot, relativeMarkdownPath);

  await ensureDirectory(path.dirname(absoluteJsonPath));

  let jsonTemp = null;
  let markdownTemp = null;
  try {
    jsonTemp = await writeFileToTemp(absoluteJsonPath, serializeRecord(record));
    markdownTemp = await writeFileToTemp(absoluteMarkdownPath, projection.markdown);

    const writeResult = await withKindRecordWriteLock(targetRoot, async () => {
      const currentDigest = await readOnDiskDigest(absoluteJsonPath);

      const guardDigest =
        expectedSourceDigest !== null && expectedSourceDigest !== undefined
          ? expectedSourceDigest
          : currentDigest;
      if (currentDigest !== guardDigest) {
        return { status: "stale", current_source_digest: currentDigest };
      }
      try {
        await rename(jsonTemp.tempPath, absoluteJsonPath);
        await rename(markdownTemp.tempPath, absoluteMarkdownPath);
      } catch {
        return { status: "write_failed" };
      }
      return { status: "written" };
    });

    if (writeResult.status === "stale") {
      return {
        ok: false,
        written: false,
        source_digest: sourceDigest,
        diagnostics: [
          {
            code: "stale_source_digest",
            severity: "error",
            message: "source digest does not match the current on-disk record",
            path: relativeJsonPath
          }
        ],
        current_source_digest: writeResult.current_source_digest,
        ...(expectedSourceDigest !== null && expectedSourceDigest !== undefined
          ? { expected_source_digest: expectedSourceDigest }
          : {})
      };
    }

    if (writeResult.status === "write_failed") {
      return refusal(
        [
          {
            code: "kind_record_write_failed",
            severity: "error",
            message: `failed to write canonical ${kind} record`,
            path: relativeJsonPath
          }
        ],
        sourceDigest
      );
    }
  } catch (error) {
    return refusal(
      [
        {
          code: "kind_record_write_failed",
          severity: "error",
          message: `failed to write canonical ${kind} record: ${
            error instanceof Error ? error.message : String(error)
          }`,
          path: relativeJsonPath
        }
      ],
      sourceDigest
    );
  } finally {
    if (jsonTemp) {
      await rm(jsonTemp.tempDir, { recursive: true, force: true });
    }
    if (markdownTemp) {
      await rm(markdownTemp.tempDir, { recursive: true, force: true });
    }
  }

  return {
    ok: true,
    written: true,
    source_digest: sourceDigest,
    diagnostics: [],
    canonical_record_path: relativeJsonPath,
    canonical_markdown_path: relativeMarkdownPath
  };
}
