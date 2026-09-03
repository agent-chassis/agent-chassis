

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

async function loadKindAuthority() {
  const manifest = await loadManifest();
  const types = manifest?.types ?? {};
  const byKind = new Map();
  const byPrefix = new Map();
  for (const [kind, definition] of Object.entries(types)) {
    if (!isSupportedKind(kind)) {
      continue;
    }
    if (typeof definition.prefix !== "string" || typeof definition.directory !== "string") {
      continue;
    }
    const entry = Object.freeze({ kind, prefix: definition.prefix, directory: definition.directory });
    byKind.set(kind, entry);
    byPrefix.set(definition.prefix, entry);
  }
  return { byKind, byPrefix };
}

function idPrefix(id) {
  return String(id).split("-")[0];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function canonicalKindRecordId(prefix, id) {
  return typeof id === "string" &&
    new RegExp(`^${escapeRegExp(prefix)}-[0-9]{4}$`, "u").test(id);
}

function canonicalPathFor(authority, id) {
  return `${authority.directory}/${id}.json`;
}

function projectionPathFor(authority, id) {
  return `${authority.directory}/${id}.md`;
}

function invalidIdentityDiagnostic(id, authority = null) {
  return {
    code: "invalid_record_identity",
    severity: "error",
    message: authority
      ? `Record identity must match the canonical ${authority.prefix}-#### grammar`
      : `Unsupported record identity: ${id}`,
    path: "id"
  };
}

function unresolvedIdentityResult(id, diagnostic) {
  return {
    recognized: false,
    record_id: typeof id === "string" ? id : null,
    record_kind: null,
    canonical_record_path: null,
    projection_path: null,
    diagnostics: [diagnostic]
  };
}

export async function resolveKindRecordIdentity(id) {
  const authority = await loadKindAuthority();
  const prefix = idPrefix(id);
  const resolved = authority.byPrefix.get(prefix);
  if (!resolved) {
    const caseMatched = [...authority.byPrefix.values()].find((entry) =>
      entry.prefix.toLowerCase() === prefix.toLowerCase());
    return unresolvedIdentityResult(
      id,
      caseMatched ? invalidIdentityDiagnostic(id, caseMatched) : unsupportedKindDiagnostic(prefix, "id")
    );
  }
  if (!canonicalKindRecordId(resolved.prefix, id)) {
    return unresolvedIdentityResult(id, invalidIdentityDiagnostic(id, resolved));
  }
  return {
    recognized: true,
    record_id: id,
    record_kind: resolved.kind,
    canonical_record_path: canonicalPathFor(resolved, id),
    projection_path: projectionPathFor(resolved, id),
    diagnostics: []
  };
}

export async function getKindRecordPath(kind, id) {
  const authority = await loadKindAuthority();
  const resolved = authority.byKind.get(kind);
  if (!resolved || !canonicalKindRecordId(resolved.prefix, id)) {
    return null;
  }
  return canonicalPathFor(resolved, id);
}

function markdownPathFor(relativeJsonPath) {
  return relativeJsonPath.replace(/\.json$/, ".md");
}

function unregisteredSourceResult(sourcePath) {
  return {
    recognized: false,
    source_classification: "unregistered",
    source_path: typeof sourcePath === "string" ? sourcePath : null,
    record_id: null,
    record_kind: null,
    canonical_record_path: null,
    diagnostics: [{
      code: "unregistered_kind_record_source",
      severity: "error",
      message: "Path is not an exact registered canonical kind record or generated projection",
      path: typeof sourcePath === "string" ? sourcePath : null
    }]
  };
}

export async function classifyKindRecordSource(sourcePath) {
  if (typeof sourcePath !== "string" || sourcePath.length === 0 || path.isAbsolute(sourcePath)) {
    return unregisteredSourceResult(sourcePath);
  }
  const normalized = path.posix.normalize(sourcePath);
  if (normalized !== sourcePath || normalized.startsWith("../")) {
    return unregisteredSourceResult(sourcePath);
  }
  const extension = path.posix.extname(sourcePath);
  if (extension !== ".json" && extension !== ".md") {
    return unregisteredSourceResult(sourcePath);
  }
  const id = path.posix.basename(sourcePath, extension);
  const identity = await resolveKindRecordIdentity(id);
  if (!identity.recognized) {
    return unregisteredSourceResult(sourcePath);
  }
  const expectedPath = extension === ".json"
    ? identity.canonical_record_path
    : identity.projection_path;
  if (sourcePath !== expectedPath) {
    return unregisteredSourceResult(sourcePath);
  }
  return {
    recognized: true,
    source_classification: extension === ".json" ? "canonical" : "projection",
    source_path: sourcePath,
    record_id: identity.record_id,
    record_kind: identity.record_kind,
    canonical_record_path: identity.canonical_record_path,
    diagnostics: []
  };
}

function canonicalRecordResult(identity) {
  return {
    valid: false,
    classification: "invalid_identity",
    source_classification: identity.source_classification ??
      (identity.recognized ? "canonical" : "unregistered"),
    record_kind: identity.record_kind,
    source_path: identity.canonical_record_path,
    canonical_record_path: identity.canonical_record_path,
    source_digest: null,
    id: identity.record_id,
    record_id: identity.record_id,
    record: null,
    diagnostics: [...identity.diagnostics]
  };
}

function unreadableRecordDiagnostic(relativePath, error) {
  return {
    code: "unreadable_json_record",
    severity: "error",
    message: `Could not read canonical kind record JSON: ${relativePath}`,
    path: relativePath,
    ...(typeof error?.code === "string" ? { cause_code: error.code } : {})
  };
}

async function loadCanonicalKindRecord({ repoRoot, identity, statRecord, readRecord }) {
  const targetRoot = path.resolve(String(repoRoot));
  const result = canonicalRecordResult(identity);
  if (!identity.recognized) {
    return result;
  }
  const relativePath = identity.canonical_record_path;
  const absolutePath = path.resolve(targetRoot, relativePath);
  const relativeToRoot = path.relative(targetRoot, absolutePath);
  if (relativeToRoot.startsWith(`..${path.sep}`) || path.isAbsolute(relativeToRoot) ||
      relativeToRoot.split(path.sep).join("/") !== relativePath) {
    result.diagnostics = [invalidIdentityDiagnostic(identity.record_id)];
    return result;
  }

  try {
    await statRecord(absolutePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      result.diagnostics = [{
        code: "missing_json_record",
        severity: "error",
        message: `Missing canonical ${identity.record_kind} record JSON: ${relativePath}`,
        path: relativePath
      }];
      result.classification = "missing";
      return result;
    }
    result.diagnostics = [unreadableRecordDiagnostic(relativePath, error)];
    result.classification = "unreadable";
    return result;
  }

  let text;
  try {
    text = await readRecord(absolutePath, "utf8");
  } catch (error) {
    result.diagnostics = [unreadableRecordDiagnostic(relativePath, error)];
    result.classification = "unreadable";
    return result;
  }

  let record;
  try {
    record = JSON.parse(text);
  } catch {
    result.diagnostics = [{
      code: "invalid_json",
      severity: "error",
      message: `Could not parse canonical kind record JSON: ${relativePath}`,
      path: relativePath
    }];
    result.classification = "invalid_record";
    return result;
  }

  result.record = record;
  const loadedRecordId = typeof record?.id === "string" ? record.id : null;
  result.source_digest = computeWorkRecordSourceDigest(record);
  if (loadedRecordId !== identity.record_id || record?.record_kind !== identity.record_kind) {
    result.diagnostics = [{
      code: "record_identity_mismatch",
      severity: "error",
      message: "Loaded canonical record identity or kind does not match the requested identity",
      path: loadedRecordId !== identity.record_id ? "id" : "record_kind"
    }];
    result.classification = "invalid_record";
    return result;
  }
  result.diagnostics = validateRecordByKind(record);
  result.valid = result.diagnostics.every((entry) => entry.severity !== "error");
  result.classification = result.valid ? "loaded" : "invalid_record";
  return result;
}

export async function loadKindRecordById({
  repoRoot = ".",
  id,
  statRecord = stat,
  readRecord = readFile
} = {}) {
  if (!id) {
    throw new Error("loadKindRecordById requires id");
  }
  const identity = await resolveKindRecordIdentity(id);
  return loadCanonicalKindRecord({ repoRoot, identity, statRecord, readRecord });
}

export async function loadKindRecordByPath({
  repoRoot = ".",
  sourcePath,
  statRecord = stat,
  readRecord = readFile
} = {}) {
  if (!sourcePath) {
    throw new Error("loadKindRecordByPath requires sourcePath");
  }
  const source = await classifyKindRecordSource(sourcePath);
  if (!source.recognized || source.source_classification !== "canonical") {
    const identity = {
      recognized: false,
      source_classification: source.source_classification,
      record_id: source.record_id,
      record_kind: source.record_kind,
      canonical_record_path: source.canonical_record_path,
      diagnostics: source.source_classification === "projection"
        ? [{
            code: "noncanonical_kind_record_projection",
            severity: "error",
            message: "Generated Markdown projection is not a canonical kind record source",
            path: sourcePath
          }]
        : source.diagnostics
    };
    return canonicalRecordResult(identity);
  }
  const identity = {
    recognized: true,
    record_id: source.record_id,
    record_kind: source.record_kind,
    canonical_record_path: source.canonical_record_path,
    diagnostics: []
  };
  return loadCanonicalKindRecord({ repoRoot, identity, statRecord, readRecord });
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

  const identity = await resolveKindRecordIdentity(recordId);
  if (!identity.recognized || identity.record_kind !== kind) {
    return refusal([
      identity.diagnostics[0] ?? {
        code: "record_identity_mismatch",
        severity: "error",
        message: "Record identity does not match record_kind",
        path: "id"
      }
    ], sourceDigest);
  }

  const relativeJsonPath = identity.canonical_record_path;
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
