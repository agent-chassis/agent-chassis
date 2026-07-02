import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  GENERATED_VIEW_NAMES,
  loadCanonicalState,
  pathExists,
  resolvePageFacets,
  resolveContractContext
} from "./wiki.mjs";

export const SEARCH_INDEX_VERSION = 2;
const SEARCH_CACHE_DIR = path.join(".cache", "wiki-search");
const SEARCH_INDEX_FILE = "index.json";

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
    cli: "npm run wiki -- build-search-index --dir <repo-dir>",
    mcp: "workspace_build_search_index",
    note: "Read-only search consumes an existing lexical index. Use the explicit build-search-index capability to create or refresh `.cache/wiki-search/index.json`."
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

export function inferPageKind(page) {
  const relativePath = page.relativePath;
  if (relativePath.startsWith("docs/")) {
    return "docs";
  }
  if (relativePath.startsWith("wiki/issues/")) {
    return "issues";
  }
  if (relativePath.startsWith("wiki/initiatives/")) {
    return "initiatives";
  }
  if (relativePath.startsWith("wiki/decisions/")) {
    return "decisions";
  }
  if (relativePath.startsWith("wiki/sources/")) {
    return "sources";
  }
  if (relativePath.startsWith("wiki/areas/")) {
    return "areas";
  }
  if (relativePath.startsWith("wiki/")) {
    const segments = relativePath.split("/");
    if (segments.length >= 3) {
      return segments[1];
    }
  }
  if (relativePath.startsWith("wiki/")) {
    return "wiki";
  }
  return "other";
}

export function resolveLocalMarkdownTarget(targetDir, page, rawTarget) {
  const target = String(rawTarget ?? "").split("#")[0].trim();
  if (
    !target ||
    target.startsWith("http://") ||
    target.startsWith("https://") ||
    target.startsWith("mailto:")
  ) {
    return null;
  }

  const absolutePath = path.resolve(path.dirname(page.path), target);
  if (!absolutePath.startsWith(targetDir) || !absolutePath.endsWith(".md")) {
    return null;
  }

  return path.relative(targetDir, absolutePath).replaceAll(path.sep, "/");
}

export function computePageAuthority(targetDir, state) {
  const pages = [
    ...state.docs,
    ...state.decisions,
    ...state.areas,
    ...state.issues,
    ...state.initiatives,
    ...state.sources,
    ...state.wikiPages,
    ...(state.extensionPages || [])
  ];
  const pagesByPath = new Map(pages.map((page) => [page.relativePath, page]));
  const pagesById = new Map(
    pages
      .filter((page) => page.frontmatter?.id)
      .map((page) => [String(page.frontmatter.id), page.relativePath])
  );

  const outgoing = new Map();
  for (const page of pages) {
    const targets = new Set();

    for (const markdownLink of page.markdownLinks || []) {
      const resolved = resolveLocalMarkdownTarget(targetDir, page, markdownLink);
      if (resolved && pagesByPath.has(resolved)) {
        targets.add(resolved);
      }
    }

    for (const docPath of asStringList(page.frontmatter?.docs)) {
      if (pagesByPath.has(docPath)) {
        targets.add(docPath);
      }
    }

    for (const relatedDoc of asStringList(page.frontmatter?.related_docs)) {
      if (pagesByPath.has(relatedDoc)) {
        targets.add(relatedDoc);
      }
    }

    for (const relatedId of asStringList(page.frontmatter?.related)) {
      const relatedPath = pagesById.get(relatedId);
      if (relatedPath) {
        targets.add(relatedPath);
      }
    }

    outgoing.set(page.relativePath, [...targets]);
  }

  const pagePaths = [...pagesByPath.keys()];
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

export function splitLongText(text, maxLength) {
  const normalized = normalizeSearchText(text);
  if (normalized.length <= maxLength) {
    return [normalized];
  }

  const chunks = [];
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(normalized.length, start + maxLength);
    if (end < normalized.length) {
      const boundary = normalized.lastIndexOf(". ", end);
      if (boundary > start + Math.floor(maxLength / 2)) {
        end = boundary + 1;
      }
    }
    chunks.push(normalized.slice(start, end).trim());
    start = end;
  }

  return chunks.filter(Boolean);
}

export function extractSectionChunks(page) {
  const sections = [];
  const lines = page.body.split("\n");
  let currentHeading = "Overview";
  let currentLines = [];

  const flushSection = () => {
    const content = normalizeSearchText(currentLines.join("\n"));
    if (!content) {
      currentLines = [];
      return;
    }

    const parts = [];
    if (page.frontmatter?.id) {
      parts.push(String(page.frontmatter.id));
    }
    parts.push(page.title);
    if (currentHeading && currentHeading !== "Overview") {
      parts.push(currentHeading);
    }

    for (const key of ["type", "status", "priority", "owner", "area", "initiative"]) {
      if (page.frontmatter?.[key]) {
        parts.push(`${key}: ${page.frontmatter[key]}`);
      }
    }

    const retrievalFacets = page.retrievalFacets || {};
    for (const key of [
      "canonicality",
      "maintenance_mode",
      "knowledge_role",
      "evidence_stage",
      "retrieval_visibility",
      "lifecycle",
      "sensitivity"
    ]) {
      if (retrievalFacets[key]) {
        parts.push(`${key}: ${retrievalFacets[key]}`);
      }
    }
    if (Array.isArray(retrievalFacets.retrieval_role) && retrievalFacets.retrieval_role.length > 0) {
      parts.push(`retrieval_role: ${retrievalFacets.retrieval_role.join(", ")}`);
    }
    if (Array.isArray(retrievalFacets.topics) && retrievalFacets.topics.length > 0) {
      parts.push(`topics: ${retrievalFacets.topics.join(", ")}`);
    }

    const tags = asStringList(page.frontmatter?.tags);
    if (tags.length > 0) {
      parts.push(`tags: ${tags.join(", ")}`);
    }

    const docs = asStringList(page.frontmatter?.docs);
    if (docs.length > 0) {
      parts.push(`docs: ${docs.join(", ")}`);
    }

    parts.push(content);
    const fullText = parts.join("\n");
    const segments = splitLongText(content, 1800);

    if (segments.length <= 1) {
      sections.push({
        heading: currentHeading,
        text: fullText,
        preview: content
      });
    } else {
      segments.forEach((segment, index) => {
        sections.push({
          heading: `${currentHeading} [${index + 1}/${segments.length}]`,
          text: [...parts.slice(0, -1), segment].join("\n"),
          preview: segment
        });
      });
    }

    currentLines = [];
  };

  for (const line of lines) {
    const match = line.match(/^(#{2,6})\s+(.+)$/);
    if (match) {
      flushSection();
      currentHeading = match[2].trim();
      continue;
    }

    if (!line.startsWith("# ")) {
      currentLines.push(line);
    }
  }

  flushSection();

  if (sections.length === 0) {
    const fallback = normalizeSearchText(page.body.replace(/^#\s+.+$/m, ""));
    if (fallback) {
      sections.push({
        heading: "Overview",
        text: `${page.title}\n${fallback}`,
        preview: fallback
      });
    }
  }

  return sections;
}

export function buildSearchChunks(targetDir, state) {
  const facetContext = state.context || {};
  const pageAuthority = computePageAuthority(targetDir, state);
  const pages = [
    ...state.docs,
    ...state.decisions,
    ...state.areas,
    ...state.issues,
    ...state.initiatives,
    ...state.sources,
    ...state.wikiPages,
    ...(state.extensionPages || [])
  ].filter((page) => !GENERATED_VIEW_NAMES.has(path.basename(page.relativePath)));

  return pages.flatMap((page) => {
    const pageKind = inferPageKind(page);
    const retrievalFacets = resolvePageFacets(page, facetContext).effective;
    return extractSectionChunks(page).map((section, index) => ({
      chunkId: `${page.relativePath}#${index}`,
      pageKind,
      relativePath: page.relativePath,
      title: page.title,
      heading: section.heading,
      preview: section.preview.slice(0, 280),
      text: section.text,
      authority: Number((pageAuthority.get(page.relativePath) || 0).toFixed(6)),
      frontmatter: page.frontmatter || {},
      retrievalFacets
    }));
  });
}

export async function computeSearchSourceSignature(targetDir, chunks) {
  const hash = createHash("sha256");
  const uniquePaths = [...new Set(chunks.map((chunk) => chunk.relativePath))].sort((left, right) =>
    left.localeCompare(right)
  );

  for (const relativePath of uniquePaths) {
    const absolutePath = path.join(targetDir, relativePath);
    const details = await stat(absolutePath);
    hash.update(relativePath);
    hash.update(":");
    hash.update(String(details.mtimeMs));
    hash.update(":");
    hash.update(String(details.size));
    hash.update("\n");
  }

  return hash.digest("hex");
}

export async function buildLexicalSearchIndex(
  targetDir,
  { profile = null, extensionNamespaces = null } = {}
) {
  const context = await resolveContractContext(targetDir, {
    profile,
    extensionNamespaces
  });
  const state = await loadCanonicalState(targetDir, {
    extensionNamespaces: context.extensionNamespaces
  });
  state.context = {
    manifest: context.manifest,
    metadata: context.metadata
  };
  const chunks = buildSearchChunks(targetDir, state);
  const sourceSignature = await computeSearchSourceSignature(targetDir, chunks);

  return {
    version: SEARCH_INDEX_VERSION,
    mode: "lexical",
    builtAt: new Date().toISOString(),
    sourceSignature,
    chunkCount: chunks.length,
    extensionNamespaces: context.extensionNamespaces,
    chunks
  };
}

export async function writeSearchIndex(targetDir, index) {
  const indexPath = getSearchIndexPath(targetDir);
  try {
    await mkdir(path.dirname(indexPath), { recursive: true });
    await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  } catch (error) {
    throw new SearchIndexUnavailableError({
      code: SEARCH_INDEX_DIAGNOSTIC_CODES.WRITE_UNAVAILABLE,
      indexPath,
      message: `Failed to write lexical search index at ${indexPath}: ${error.message}`,
      remediation: buildIndexRemediation(),
      cause: error
    });
  }
  return indexPath;
}

export async function readSearchIndex(targetDir) {
  const indexPath = getSearchIndexPath(targetDir);
  if (!(await pathExists(indexPath))) {
    return null;
  }

  try {
    return JSON.parse(await readFile(indexPath, "utf8"));
  } catch (error) {
    throw new SearchIndexUnavailableError({
      code: SEARCH_INDEX_DIAGNOSTIC_CODES.READ_FAILED,
      indexPath,
      message: `Failed to read lexical search index at ${indexPath}: ${error.message}`,
      remediation: buildIndexRemediation(),
      cause: error
    });
  }
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

  const current = await buildLexicalSearchIndex(targetDir, {
    profile,
    extensionNamespaces
  });
  if (existing.sourceSignature !== current.sourceSignature) {
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

export async function loadLexicalSearchIndexForRead(
  targetDir,
  { profile = null, extensionNamespaces = null } = {}
) {
  const indexPath = getSearchIndexPath(targetDir);
  const existing = await readSearchIndex(targetDir);

  if (!existing) {
    throw new SearchIndexUnavailableError({
      code: SEARCH_INDEX_DIAGNOSTIC_CODES.MISSING,
      indexPath,
      message:
        `No lexical search index exists at ${indexPath}. ` +
        `Read-only search does not create the cache; use the explicit build-search-index capability ` +
        `(CLI \`wiki build-search-index\` or MCP \`workspace_build_search_index\`) before retrying.`,
      remediation: buildIndexRemediation()
    });
  }

  if (existing.version !== SEARCH_INDEX_VERSION) {
    const rebuilt = await buildLexicalSearchIndex(targetDir, {
      profile,
      extensionNamespaces
    });
    return {
      index: rebuilt,
      indexPath,
      rebuilt: false,
      indexState: SEARCH_INDEX_STATE_REBUILT_IN_MEMORY,
      indexStateReason: "index_version_mismatch"
    };
  }

  const current = await buildLexicalSearchIndex(targetDir, {
    profile,
    extensionNamespaces
  });
  if (existing.sourceSignature !== current.sourceSignature) {
    return {
      index: current,
      indexPath,
      rebuilt: false,
      indexState: SEARCH_INDEX_STATE_REBUILT_IN_MEMORY,
      indexStateReason: "source_signature_mismatch"
    };
  }

  return {
    index: existing,
    indexPath,
    rebuilt: false,
    indexState: SEARCH_INDEX_STATE_EXISTING,
    indexStateReason: null
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
    if (
      filters[key] &&
      String(frontmatter[key] ?? "").toLowerCase() !== String(filters[key]).toLowerCase()
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
  const haystack = normalizeSearchText(
    `${chunk.title}\n${chunk.heading}\n${chunk.text}`
  ).toLowerCase();
  const id = String(chunk.frontmatter?.id ?? "").toLowerCase();
  const queryText = query.toLowerCase();

  let score = 0;
  if (id && id === queryText) {
    score += 100;
  }

  const titleText = normalizeSearchText(chunk.title).toLowerCase();
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

  score += chunk.authority * 4;
  return Number(score.toFixed(4));
}

function normalizeSearchLimit(limit) {
  const parsed = Number(limit);
  if (!parsed || !Number.isFinite(parsed)) {
    return 8;
  }
  return Math.max(1, Math.ceil(parsed));
}

function normalizeSearchOffset(offset) {
  const parsed = Number(offset);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.floor(parsed);
}

function rankLexicalSearchResults(index, { query, filters = {} }) {
  const normalizedQuery = normalizeSearchText(query);
  const queryTokens = tokenizeSearchText(normalizedQuery);

  if (!normalizedQuery || queryTokens.length === 0) {
    throw new Error("search requires a non-empty textual query");
  }

  const scored = [];
  for (const chunk of index.chunks || []) {
    if (!matchesSearchFilters(chunk, filters)) {
      continue;
    }

    const lexical = scoreLexicalMatch(normalizedQuery, queryTokens, chunk);
    if (lexical <= 0) {
      continue;
    }

    scored.push({
      ...chunk,
      score: lexical
    });
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

  const deduped = [];
  const seenPaths = new Set();
  for (const result of scored) {
    if (seenPaths.has(result.relativePath)) {
      continue;
    }
    deduped.push(result);
    seenPaths.add(result.relativePath);
  }

  return deduped;
}

export function searchLexicalIndexPage(
  index,
  { query, limit = 8, offset = 0, filters = {}, unbounded = false } = {}
) {
  const rankedResults = rankLexicalSearchResults(index, { query, filters });
  const totalCount = rankedResults.length;
  const normalizedOffset = normalizeSearchOffset(offset);
  const normalizedLimit = unbounded ? totalCount : normalizeSearchLimit(limit);
  const pageEnd = unbounded
    ? totalCount
    : Math.min(totalCount, normalizedOffset + normalizedLimit);
  const results = rankedResults.slice(normalizedOffset, pageEnd);
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
  { query, limit = 8, offset = 0, filters = {}, unbounded = false } = {}
) {
  return searchLexicalIndexPage(index, {
    query,
    limit,
    offset,
    filters,
    unbounded
  }).results;
}

function asStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => String(entry));
}
