import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, stat, unlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import {
  buildSearchSourceCorpus,
  captureSearchSourceCorpus,
  projectCapturedWorkRecordEntrySources
} from "./search-source-corpus.mjs";
import { findPassageMatchRange } from "./search-passages.mjs";

export const SEARCH_INDEX_VERSION = 5;
const SEARCH_CACHE_DIR = path.join(".cache", "wiki-search");
const SEARCH_INDEX_FILE = "index.json";
const inMemoryPreparedIndexes = new Map();
const inMemoryEntryOverlays = new Map();

export const SEARCH_INDEX_STATE_EXISTING = "existing";
export const SEARCH_INDEX_STATE_REBUILT_IN_MEMORY = "rebuilt_in_memory";
export const SEARCH_INDEX_STATE_REWRITTEN = "rewritten";

export const SEARCH_INDEX_DIAGNOSTIC_CONTRACT = "search_index_diagnostic.v1";

export const SEARCH_INDEX_DIAGNOSTIC_CODES = Object.freeze({
  MISSING: "search_index_missing",
  WRITE_UNAVAILABLE: "search_index_write_unavailable",
  READ_FAILED: "search_index_read_failed"
});

export class SearchIndexUnavailableError extends Error {
  constructor({ code, indexPath, message, remediation, cause = null }) {
    super(message);
    this.name = "SearchIndexUnavailableError";
    this.code = code;
    this.indexPath = indexPath;
    this.envelope = {
      contract: SEARCH_INDEX_DIAGNOSTIC_CONTRACT,
      code,
      message,
      indexPath,
      remediation
    };
    if (cause) {
      this.cause = cause;
    }
  }
}

export function getSearchIndexPath(targetDir) {
  return path.join(targetDir, SEARCH_CACHE_DIR, SEARCH_INDEX_FILE);
}

function buildIndexRemediation() {
  return {
    cli: "npm run wiki -- build-search-index --dir <repo-dir> --reindex",
    note:
      "Operator action. A missing, stale, or different-version `.cache/wiki-search/index.json` needs no recovery: " +
      "read-only search prepares the repository's complete current corpus in memory and writes nothing. A corrupt " +
      "or unreadable current-version index requires an operator to rebuild the persisted index explicitly. A " +
      "refused write requires the operator to make `.cache/wiki-search` real directories inside the repository, " +
      "with the index absent or a regular file, before rebuilding."
  };
}

export function normalizeSearchText(value) {
  return String(value ?? "")
    .replace(/\r/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizeSearchText(value) {
  return normalizeSearchText(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length >= 2);
}

const OPAQUE_HANDLE_PATTERN = /^(?:wkmh|wkdb)_[a-z0-9][a-z0-9._:-]*$/i;
const OPAQUE_RECORD_ID_PATTERN = /^(?:wk|in|dec|src)-\d+$/i;
const OPAQUE_HEX_PATTERN = /^[a-f0-9]{7,64}$/i;
const OPAQUE_DIGEST_PATTERN =
  /^(?:sha(?:1|224|256|384|512)|blake2b|blake3)[:_-][a-z0-9+/=_-]{16,}$/i;

function isOpaqueIdentifierQuery(value) {
  const normalized = normalizeSearchText(value);
  if (!normalized || /\s/.test(normalized)) {
    return false;
  }
  return (
    OPAQUE_HANDLE_PATTERN.test(normalized) ||
    OPAQUE_RECORD_ID_PATTERN.test(normalized) ||
    OPAQUE_HEX_PATTERN.test(normalized) ||
    OPAQUE_DIGEST_PATTERN.test(normalized)
  );
}

function resolveLocalMarkdownTarget(targetRoot, source, rawTarget) {
  const target = String(rawTarget ?? "").split("#")[0].trim();
  if (
    !target ||
    target.startsWith("http://") ||
    target.startsWith("https://") ||
    target.startsWith("mailto:")
  ) {
    return null;
  }

  const absolutePath = path.resolve(path.dirname(source.capture.absolutePath), target);
  const relativePath = path.relative(targetRoot, absolutePath);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath) ||
    !absolutePath.endsWith(".md")
  ) {
    return null;
  }

  return relativePath.replaceAll(path.sep, "/");
}

function authorityLinks(source) {
  if (source.record) {
    const record = source.record;
    return {
      id: record.id,
      markdownLinks: [],
      docs: record.docs || record.read_scope,
      relatedDocs: record.related_docs,
      related: record.related
    };
  }
  const frontmatter = source.page?.frontmatter ?? {};
  return {
    id: frontmatter.id,
    markdownLinks: source.page?.markdownLinks ?? [],
    docs: frontmatter.docs,
    relatedDocs: frontmatter.related_docs,
    related: frontmatter.related
  };
}

function computeCorpusAuthority(targetRoot, sources) {
  const pagePaths = sources.map((source) => source.capture.relativePath);
  const knownPaths = new Set(pagePaths);
  const links = sources.map((source) => ({ source, ...authorityLinks(source) }));
  const pathsById = new Map(
    links
      .filter((entry) => entry.id)
      .map((entry) => [String(entry.id), entry.source.capture.relativePath])
  );

  const outgoing = new Map();
  for (const entry of links) {
    const targets = new Set();

    for (const markdownLink of entry.markdownLinks) {
      const resolved = resolveLocalMarkdownTarget(targetRoot, entry.source, markdownLink);
      if (resolved && knownPaths.has(resolved)) {
        targets.add(resolved);
      }
    }

    for (const linkedPath of [...asStringList(entry.docs), ...asStringList(entry.relatedDocs)]) {
      if (knownPaths.has(linkedPath)) {
        targets.add(linkedPath);
      }
    }

    for (const relatedId of asStringList(entry.related)) {
      const relatedPath = pathsById.get(relatedId);
      if (relatedPath) {
        targets.add(relatedPath);
      }
    }

    outgoing.set(entry.source.capture.relativePath, [...targets]);
  }

  if (pagePaths.length === 0) {
    return new Map();
  }

  const initialRank = 1 / pagePaths.length;
  let ranks = new Map(pagePaths.map((pagePath) => [pagePath, initialRank]));
  const damping = 0.85;

  for (let iteration = 0; iteration < 20; iteration += 1) {
    const nextRanks = new Map(
      pagePaths.map((pagePath) => [pagePath, (1 - damping) / pagePaths.length])
    );

    for (const pagePath of pagePaths) {
      const targets = outgoing.get(pagePath) || [];
      if (targets.length === 0) {
        const shared = (damping * (ranks.get(pagePath) || 0)) / pagePaths.length;
        for (const targetPath of pagePaths) {
          nextRanks.set(targetPath, (nextRanks.get(targetPath) || 0) + shared);
        }
        continue;
      }

      const shared = (damping * (ranks.get(pagePath) || 0)) / targets.length;
      for (const targetPath of targets) {
        nextRanks.set(targetPath, (nextRanks.get(targetPath) || 0) + shared);
      }
    }

    ranks = nextRanks;
  }

  const maxRank = Math.max(...ranks.values(), 0);
  return new Map(
    [...ranks.entries()].map(([pagePath, value]) => [pagePath, maxRank > 0 ? value / maxRank : 0])
  );
}

export async function buildLexicalSearchIndex(
  targetDir,
  { profile = null, extensionNamespaces = null, capturedCorpus = null } = {}
) {
  const corpus = await buildSearchSourceCorpus(targetDir, {
    profile, extensionNamespaces, ...(capturedCorpus ? { capturedCorpus } : {})
  });
  const authority = computeCorpusAuthority(await realpath(path.resolve(targetDir)), corpus.sources);
  const chunks = corpus.passages.map((passage) => ({
    ...passage,
    text: normalizeSearchText(passage.originalText),
    authority: Number((authority.get(passage.relativePath) || 0).toFixed(6))
  }));
  const sourceSignature = digestCorpusIdentity(corpus);

  return {
    version: SEARCH_INDEX_VERSION,
    mode: "lexical",
    builtAt: new Date().toISOString(),
    sourceSignature,
    contextDigest: corpus.contextDigest,
    sourceDigests: corpus.sourceDigests,
    totalSourceBytes: corpus.totalSourceBytes,
    chunkCount: chunks.length,
    extensionNamespaces: corpus.context.extensionNamespaces,
    chunks
  };
}

function digestCorpusIdentity(corpus) {
  const hash = createHash("sha256");
  hash.update(corpus.contextDigest);
  for (const [relativePath, digest] of Object.entries(corpus.sourceDigests)
    .sort(([left], [right]) => left.localeCompare(right))) {
    hash.update(`\n${relativePath}:${digest}`);
  }
  return hash.digest("hex");
}

async function lstatIfPresent(filePath) {
  try {
    return await lstat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function assertReplaceableIndexDestination(details) {
  if (details !== null && (details.isSymbolicLink() || !details.isFile())) {
    throw new Error("persisted lexical search index destination is not a regular file");
  }
}

export async function writeSearchIndex(targetDir, index) {
  const indexPath = getSearchIndexPath(targetDir);
  let temporaryPath = null;
  try {
    if (typeof constants.O_NOFOLLOW !== "number") {
      throw new Error("no-follow file opening is unavailable");
    }
    let directory = await realpath(path.resolve(targetDir));
    const directories = [];
    for (const component of SEARCH_CACHE_DIR.split(path.sep)) {
      directory = path.join(directory, component);
      let details = await lstatIfPresent(directory);
      if (details === null) {
        await mkdir(directory);
        details = await lstat(directory);
      }
      if (details.isSymbolicLink() || !details.isDirectory()) {
        throw new Error(`search cache path ${directory} is not a contained directory`);
      }
      directories.push({ directory, details });
    }
    const destination = path.join(directory, SEARCH_INDEX_FILE);
    assertReplaceableIndexDestination(await lstatIfPresent(destination));

    temporaryPath = path.join(directory, `.${SEARCH_INDEX_FILE}.${process.pid}-${randomUUID()}.tmp`);
    const handle = await open(
      temporaryPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o666
    );
    try {
      await handle.writeFile(`${JSON.stringify(index, null, 2)}\n`, "utf8");
    } finally {
      await handle.close();
    }

    for (const { directory: checked, details } of directories) {
      const current = await lstat(checked);
      if (current.isSymbolicLink() || current.dev !== details.dev || current.ino !== details.ino) {
        throw new Error(`search cache path ${checked} changed during index publication`);
      }
    }
    assertReplaceableIndexDestination(await lstatIfPresent(destination));
    await rename(temporaryPath, destination);
    temporaryPath = null;
  } catch (error) {
    let cleanup = "";
    if (temporaryPath !== null) {
      try {
        await unlink(temporaryPath);
      } catch (cleanupError) {
        if (cleanupError?.code !== "ENOENT") {
          cleanup = `; temporary file ${temporaryPath} could not be removed: ${cleanupError.message}`;
        }
      }
    }
    throw new SearchIndexUnavailableError({
      code: SEARCH_INDEX_DIAGNOSTIC_CODES.WRITE_UNAVAILABLE,
      indexPath,
      message: `Failed to write lexical search index at ${indexPath}: ${error.message}${cleanup}`,
      remediation: buildIndexRemediation(),
      cause: error
    });
  }
  return indexPath;
}

export async function readSearchIndex(targetDir) {
  const indexPath = getSearchIndexPath(targetDir);

  let initialIndexDetails;
  try {
    initialIndexDetails = await lstat(indexPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw new SearchIndexUnavailableError({
      code: SEARCH_INDEX_DIAGNOSTIC_CODES.READ_FAILED,
      indexPath,
      message: `Failed to read lexical search index at ${indexPath}: ${error.message}`,
      remediation: buildIndexRemediation(),
      cause: error
    });
  }

  let indexHandle;

  try {
    if (initialIndexDetails.isSymbolicLink()) {
      throw new Error("persisted lexical search index is a symbolic link");
    }
    if (typeof constants.O_NOFOLLOW !== "number") {
      throw new Error("no-follow file opening is unavailable");
    }

    indexHandle = await open(indexPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const openedIndexDetails = await indexHandle.stat();
    const targetRoot = await realpath(targetDir);
    const resolvedIndexPath = await realpath(indexPath);
    const resolvedIndexDetails = await stat(resolvedIndexPath);
    const relativeIndexPath = path.relative(targetRoot, resolvedIndexPath);
    if (
      !openedIndexDetails.isFile() ||
      openedIndexDetails.dev !== resolvedIndexDetails.dev ||
      openedIndexDetails.ino !== resolvedIndexDetails.ino ||
      relativeIndexPath === "" ||
      relativeIndexPath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeIndexPath)
    ) {
      throw new Error("persisted lexical search index is not a contained regular file");
    }

    return validatePersistedSearchIndex(
      JSON.parse(await indexHandle.readFile("utf8")),
      indexPath
    );
  } catch (error) {
    throw new SearchIndexUnavailableError({
      code: SEARCH_INDEX_DIAGNOSTIC_CODES.READ_FAILED,
      indexPath,
      message: `Failed to read lexical search index at ${indexPath}: ${error.message}`,
      remediation: buildIndexRemediation(),
      cause: error
    });
  } finally {
    await indexHandle?.close();
  }
}

function validatePersistedSearchIndex(index, indexPath) {
  const isRecord = (value) => value && typeof value === "object" && !Array.isArray(value);
  const hasWriterTimestamp = (value) => {
    if (typeof value !== "string") {
      return false;
    }
    try {
      return new Date(value).toISOString() === value;
    } catch {
      return false;
    }
  };

  if (
    isRecord(index) &&
    Number.isInteger(index.version) &&
    index.version !== SEARCH_INDEX_VERSION &&
    index.mode === "lexical" &&
    hasWriterTimestamp(index.builtAt)
  ) {
    return Object.freeze({ version: index.version, mode: index.mode, builtAt: index.builtAt });
  }

  const validChunk = (chunk) => (
    isRecord(chunk) &&
    typeof chunk.chunkId === "string" &&
    typeof chunk.pageKind === "string" &&
    typeof chunk.relativePath === "string" &&
    typeof chunk.title === "string" &&
    typeof chunk.heading === "string" &&
    typeof chunk.text === "string" &&
    typeof chunk.originalText === "string" &&
    typeof chunk.sourceId === "string" &&
    typeof chunk.sourceDigest === "string" &&
    Number.isInteger(chunk.scalarLength) &&
    isRecord(chunk.location) &&
    typeof chunk.authority === "number" &&
    isRecord(chunk.frontmatter) &&
    isRecord(chunk.retrievalFacets)
  );

  if (
    !isRecord(index) ||
    index.version !== SEARCH_INDEX_VERSION ||
    index.mode !== "lexical" ||
    !hasWriterTimestamp(index.builtAt) ||
    typeof index.sourceSignature !== "string" ||
    typeof index.contextDigest !== "string" ||
    !isRecord(index.sourceDigests) ||
    !Number.isSafeInteger(index.totalSourceBytes) || index.totalSourceBytes < 0 ||
    !Number.isInteger(index.chunkCount) ||
    index.chunkCount < 0 ||
    !Array.isArray(index.extensionNamespaces) ||
    !index.extensionNamespaces.every((namespace) => typeof namespace === "string") ||
    !Array.isArray(index.chunks) ||
    index.chunkCount !== index.chunks.length ||
    !index.chunks.every(validChunk)
  ) {
    throw new Error("invalid persisted index structure");
  }
  return index;
}

export async function ensureLexicalSearchIndex(
  targetDir,
  { reindex = false, profile = null, extensionNamespaces = null } = {}
) {
  const existing = !reindex ? await readSearchIndex(targetDir) : null;
  if (!existing || existing.version !== SEARCH_INDEX_VERSION) {
    const rebuilt = await buildLexicalSearchIndex(targetDir, {
      profile,
      extensionNamespaces
    });
    const indexPath = await writeSearchIndex(targetDir, rebuilt);
    return {
      index: rebuilt,
      indexPath,
      rebuilt: true,
      indexState: SEARCH_INDEX_STATE_REWRITTEN,
      indexStateReason: existing ? "index_version_mismatch" : "index_missing"
    };
  }

  const capturedCorpus = await captureSearchSourceCorpus(targetDir, { profile, extensionNamespaces });
  const currentSignature = digestCorpusIdentity(capturedCorpus);
  if (existing.sourceSignature !== currentSignature) {
    const current = await buildLexicalSearchIndex(targetDir, {
      profile, extensionNamespaces, capturedCorpus
    });
    const indexPath = await writeSearchIndex(targetDir, current);
    return {
      index: current,
      indexPath,
      rebuilt: true,
      indexState: SEARCH_INDEX_STATE_REWRITTEN,
      indexStateReason: "source_signature_mismatch"
    };
  }

  return {
    index: existing,
    indexPath: getSearchIndexPath(targetDir),
    rebuilt: false,
    indexState: SEARCH_INDEX_STATE_EXISTING,
    indexStateReason: null
  };
}

async function prepareLexicalSearchIndexInMemory(
  targetDir,
  { profile, extensionNamespaces, capturedCorpus, sourceSignature }
) {
  const memoryKey = `${path.resolve(targetDir)}\0${capturedCorpus.contextDigest}`;
  const prepared = inMemoryPreparedIndexes.get(memoryKey);
  if (prepared?.sourceSignature === sourceSignature) {
    return prepared;
  }
  const rebuilt = await buildLexicalSearchIndex(targetDir, { profile, extensionNamespaces, capturedCorpus });
  inMemoryPreparedIndexes.set(memoryKey, rebuilt);
  return rebuilt;
}

async function prepareWorkRecordEntryOverlay(targetDir, index, capturedCorpus, { repository, history }) {
  const memoryKey = JSON.stringify([path.resolve(targetDir), index.contextDigest, repository, history]);
  const prepared = inMemoryEntryOverlays.get(memoryKey);
  if (prepared?.sourceSignature === index.sourceSignature) {
    return prepared;
  }
  const projected = await projectCapturedWorkRecordEntrySources(targetDir, capturedCorpus, { repository, history });
  const recordChunks = new Map();
  for (const chunk of index.chunks) {
    if (!recordChunks.has(chunk.relativePath)) recordChunks.set(chunk.relativePath, chunk);
  }
  const chunks = [];
  for (const { relativePath, sourceDigest, descriptor } of projected.sources) {
    const recordChunk = recordChunks.get(relativePath);
    if (!recordChunk) continue;
    const location = {
      kind: "work_record_entry",
      unit: descriptor.unit,
      entry_id: descriptor.entry_id,
      version_id: descriptor.version_id
    };
    chunks.push({
      chunkId: `${relativePath}#entry:${descriptor.unit}:${descriptor.entry_id}:${descriptor.version_id}`,
      sourceId: createHash("sha256").update(JSON.stringify([relativePath, location])).digest("hex").slice(0, 24),
      pageKind: recordChunk.pageKind,
      relativePath,
      title: descriptor.title,
      heading: descriptor.title,
      originalText: descriptor.original_text,
      text: normalizeSearchText(descriptor.original_text),
      sourceDigest,
      scalarLength: descriptor.scalar_length,
      location,
      authority: recordChunk.authority,
      frontmatter: recordChunk.frontmatter,
      retrievalFacets: recordChunk.retrievalFacets,
      entry: {
        entry_kind: descriptor.entry_kind,
        utf8_bytes: descriptor.utf8_bytes,
        reference: descriptor.reference,
        source_closure: descriptor.source_closure
      }
    });
  }
  const overlay = Object.freeze({
    sourceSignature: index.sourceSignature,
    repository,
    history,
    chunks,
    diagnostics: projected.diagnostics
  });
  inMemoryEntryOverlays.set(memoryKey, overlay);
  return overlay;
}

export async function loadLexicalSearchIndexForRead(
  targetDir,
  { profile = null, extensionNamespaces = null, repository = null, history = false } = {}
) {
  const indexPath = getSearchIndexPath(targetDir);
  const existing = await readSearchIndex(targetDir);

  const capturedCorpus = await captureSearchSourceCorpus(targetDir, { profile, extensionNamespaces });
  const sourceSignature = digestCorpusIdentity(capturedCorpus);
  const loaded = existing?.version === SEARCH_INDEX_VERSION && existing.sourceSignature === sourceSignature
    ? {
        index: existing,
        indexPath,
        rebuilt: false,
        indexState: SEARCH_INDEX_STATE_EXISTING,
        indexStateReason: null
      }
    : {
        index: await prepareLexicalSearchIndexInMemory(targetDir, {
          profile, extensionNamespaces, capturedCorpus, sourceSignature
        }),
        indexPath,
        rebuilt: false,
        indexState: SEARCH_INDEX_STATE_REBUILT_IN_MEMORY,
        indexStateReason: !existing
          ? "index_missing"
          : existing.version !== SEARCH_INDEX_VERSION
            ? "index_version_mismatch"
            : "source_signature_mismatch"
      };

  return {
    ...loaded,
    entryOverlay: repository === null
      ? null
      : await prepareWorkRecordEntryOverlay(targetDir, loaded.index, capturedCorpus, {
          repository,
          history: history === true
        })
  };
}

export function matchesSearchFilters(chunk, filters = {}) {
  if (filters.kind && chunk.pageKind !== filters.kind) {
    return false;
  }

  const frontmatter = chunk.frontmatter || {};
  const retrievalFacets = chunk.retrievalFacets || {};

  if (
    !filters.retrieval_visibility &&
    String(retrievalFacets.retrieval_visibility || "").toLowerCase() === "suppressed"
  ) {
    return false;
  }

  for (const key of ["type", "status", "priority", "owner", "area", "initiative"]) {
    const actual = key === "owner" && frontmatter.owner === undefined && Array.isArray(frontmatter.owners)
      ? frontmatter.owners.map((entry) => String(entry).toLowerCase())
      : String(frontmatter[key] ?? "").toLowerCase();
    if (
      filters[key] &&
      !(Array.isArray(actual)
        ? actual.includes(String(filters[key]).toLowerCase())
        : actual === String(filters[key]).toLowerCase())
    ) {
      return false;
    }
  }

  for (const key of [
    "canonicality",
    "maintenance_mode",
    "knowledge_role",
    "evidence_stage",
    "retrieval_visibility",
    "lifecycle",
    "sensitivity"
  ]) {
    if (
      filters[key] &&
      String(retrievalFacets[key] ?? "").toLowerCase() !== String(filters[key]).toLowerCase()
    ) {
      return false;
    }
  }

  if (filters.retrieval_role) {
    const roles = Array.isArray(retrievalFacets.retrieval_role)
      ? retrievalFacets.retrieval_role.map((entry) => String(entry).toLowerCase())
      : [];
    if (!roles.includes(String(filters.retrieval_role).toLowerCase())) {
      return false;
    }
  }

  if (filters.topic) {
    const topics = Array.isArray(retrievalFacets.topics)
      ? retrievalFacets.topics.map((entry) => String(entry).toLowerCase())
      : [];
    if (!topics.includes(String(filters.topic).toLowerCase())) {
      return false;
    }
  }

  return true;
}

export function scoreLexicalMatch(query, queryTokens, chunk) {
  const isPrimaryPassage = chunk.location?.section_ordinal === 0 || chunk.location?.pointer === "/title";
  const titleText = isPrimaryPassage ? normalizeSearchText(chunk.title).toLowerCase() : "";
  const haystack = normalizeSearchText(
    `${titleText}\n${chunk.heading}\n${chunk.text}`
  ).toLowerCase();
  const id = String(chunk.frontmatter?.id ?? "").toLowerCase();
  const queryText = query.toLowerCase();

  let score = 0;
  if (id && id === queryText) {
    score += 100;
  }

  const headingText = normalizeSearchText(chunk.heading).toLowerCase();

  if (titleText.includes(queryText)) {
    score += 30;
  } else if (headingText.includes(queryText)) {
    score += 18;
  } else if (haystack.includes(queryText)) {
    score += 10;
  }

  const uniqueTokens = new Set(queryTokens);
  for (const token of uniqueTokens) {
    if (id === token) {
      score += 50;
      continue;
    }
    if (titleText.includes(token)) {
      score += 8;
      continue;
    }
    if (headingText.includes(token)) {
      score += 5;
      continue;
    }
    if (haystack.includes(token)) {
      score += 2;
    }
  }

  if (score <= 0) {
    return 0;
  }

  score += (Number(chunk.authority) || 0) * 4;
  return Number(score.toFixed(4));
}

function normalizeSearchLimit(limit) {
  const parsed = Number(limit);
  if (!parsed || !Number.isFinite(parsed)) {
    return 8;
  }
  return Math.min(50, Math.max(1, Math.ceil(parsed)));
}

function normalizeSearchOffset(offset) {
  const parsed = Number(offset);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.floor(parsed);
}

function interpretLexicalSearchQuery(query) {
  const normalizedQuery = normalizeSearchText(query);
  const queryTokens = isOpaqueIdentifierQuery(normalizedQuery)
    ? [normalizedQuery.toLowerCase()]
    : tokenizeSearchText(normalizedQuery);

  if (!normalizedQuery || queryTokens.length === 0) {
    throw new Error("search requires a non-empty textual query");
  }
  return { normalizedQuery, queryTokens };
}

export function rankLexicalSearchResults(index, { query, filters = {} }) {
  const { normalizedQuery, queryTokens } = interpretLexicalSearchQuery(query);

  const scored = [];
  for (const chunk of index.chunks || []) {
    if (!matchesSearchFilters(chunk, filters)) {
      continue;
    }

    const lexical = scoreLexicalMatch(normalizedQuery, queryTokens, chunk);
    if (lexical <= 0) {
      continue;
    }

    scored.push({ ...chunk, score: lexical });
  }

  scored.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    if (right.authority !== left.authority) {
      return right.authority - left.authority;
    }
    return left.relativePath.localeCompare(right.relativePath);
  });

  return scored;
}

export function searchLexicalIndexPage(
  index,
  { query, limit = 8, offset = 0, filters = {} } = {}
) {
  const rankedResults = rankLexicalSearchResults(index, { query, filters });
  const totalCount = rankedResults.length;
  const normalizedOffset = normalizeSearchOffset(offset);
  const normalizedLimit = normalizeSearchLimit(limit);
  const pageEnd = Math.min(totalCount, normalizedOffset + normalizedLimit);
  const { normalizedQuery, queryTokens } = interpretLexicalSearchQuery(query);
  const results = rankedResults.slice(normalizedOffset, pageEnd).map((result) => ({
    ...result,
    matchRange: findPassageMatchRange(result.originalText ?? result.text, normalizedQuery, queryTokens)
  }));
  const nextOffset = pageEnd < totalCount ? pageEnd : null;

  return {
    results,
    totalCount,
    returnedCount: results.length,
    limit: normalizedLimit,
    offset: normalizedOffset,
    hasMore: nextOffset !== null,
    nextOffset
  };
}

export function searchLexicalIndex(
  index,
  { query, limit = 8, offset = 0, filters = {} } = {}
) {
  return searchLexicalIndexPage(index, {
    query,
    limit,
    offset,
    filters
  }).results;
}

function asStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => String(entry));
}
