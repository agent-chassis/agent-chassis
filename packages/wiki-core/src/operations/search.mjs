import path from "node:path";
import {
  ensureLexicalSearchIndex,
  loadLexicalSearchIndexForRead,
  searchLexicalIndexPage
} from "../lib/search.mjs";

export async function searchRepo({
  dir = ".",
  query,
  limit = 8,
  offset = 0,
  unbounded = false,
  reindex = false,
  verbose = false,
  profile = null,
  extensionNamespaces = null,
  kind = null,
  type = null,
  status = null,
  priority = null,
  owner = null,
  area = null,
  initiative = null,
  retrieval_role = null,
  canonicality = null,
  maintenance_mode = null,
  knowledge_role = null,
  evidence_stage = null,
  retrieval_visibility = null,
  lifecycle = null,
  sensitivity = null,
  topic = null
} = {}) {
  if (!query) {
    throw new Error("searchRepo requires query");
  }

  const targetDir = path.resolve(String(dir));
  const { index, indexPath, rebuilt, indexState, indexStateReason } = reindex
    ? await ensureLexicalSearchIndex(targetDir, {
        reindex: true,
        profile,
        extensionNamespaces
      })
    : await loadLexicalSearchIndexForRead(targetDir, {
        profile,
        extensionNamespaces
      });
  const filters = {
    ...(kind ? { kind: String(kind).toLowerCase() } : {}),
    ...(type ? { type: String(type).toLowerCase() } : {}),
    ...(status ? { status: String(status).toLowerCase() } : {}),
    ...(priority ? { priority: String(priority).toLowerCase() } : {}),
    ...(owner ? { owner: String(owner).toLowerCase() } : {}),
    ...(area ? { area: String(area).toLowerCase() } : {}),
    ...(initiative ? { initiative: String(initiative) } : {}),
    ...(retrieval_role ? { retrieval_role: String(retrieval_role).toLowerCase() } : {}),
    ...(canonicality ? { canonicality: String(canonicality).toLowerCase() } : {}),
    ...(maintenance_mode ? { maintenance_mode: String(maintenance_mode).toLowerCase() } : {}),
    ...(knowledge_role ? { knowledge_role: String(knowledge_role).toLowerCase() } : {}),
    ...(evidence_stage ? { evidence_stage: String(evidence_stage).toLowerCase() } : {}),
    ...(retrieval_visibility
      ? { retrieval_visibility: String(retrieval_visibility).toLowerCase() }
      : {}),
    ...(lifecycle ? { lifecycle: String(lifecycle).toLowerCase() } : {}),
    ...(sensitivity ? { sensitivity: String(sensitivity).toLowerCase() } : {}),
    ...(topic ? { topic: String(topic).toLowerCase() } : {})
  };

  const page = searchLexicalIndexPage(index, {
    query: String(query),
    limit: Number(limit) || 8,
    offset,
    unbounded: Boolean(unbounded),
    filters
  });
  const {
    results,
    totalCount,
    returnedCount,
    limit: pageLimit,
    offset: pageOffset,
    hasMore,
    nextOffset
  } = page;

  const documentCount = countSearchDocuments(index);
  const warningCount = indexState === "existing" ? 0 : 1;
  const nextAction =
    returnedCount > 0
      ? "open one of the matching pages"
      : totalCount > 0
        ? "request an earlier offset or use unbounded retrieval"
      : indexState === "existing"
        ? "refine the query or adjust filters"
        : "run build-search-index to refresh the lexical index cache";

  const compactResults = results.map((result) => summarizeSearchResult(result, { verbose }));
  const compactOutput = {
    query: String(query),
    total_count: totalCount,
    returned_count: returnedCount,
    result_count: returnedCount,
    limit: pageLimit,
    offset: pageOffset,
    has_more: hasMore,
    next_offset: nextOffset,
    retrieval_mode: Boolean(unbounded) ? "unbounded" : "paged",
    unbounded: Boolean(unbounded),
    rebuilt,
    indexState,
    next_action: nextAction,
    results: compactResults
  };

  if (verbose) {
    return {
      ...compactOutput,
      indexed: true,
      document_count: documentCount,
      warning_count: warningCount,
      error_count: 0,
      mode: index.mode,
      targetDir,
      indexPath,
      indexStateReason,
      filters,
      extensionNamespaces: index.extensionNamespaces || []
    };
  }

  return compactOutput;
}

function pickMetadata(frontmatter = {}, retrievalFacets = {}, { verbose = false } = {}) {
  const metadata = {};

  for (const key of ["type", "status", "priority", "owner", "area", "initiative"]) {
    if (frontmatter[key]) {
      metadata[key] = frontmatter[key];
    }
  }
  if (!verbose) {
    return metadata;
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
    if (retrievalFacets[key]) {
      metadata[key] = retrievalFacets[key];
    }
  }
  if (Array.isArray(retrievalFacets.retrieval_role) && retrievalFacets.retrieval_role.length > 0) {
    metadata.retrieval_role = retrievalFacets.retrieval_role;
  }
  if (Array.isArray(retrievalFacets.topics) && retrievalFacets.topics.length > 0) {
    metadata.topics = retrievalFacets.topics;
  }
  return metadata;
}

function countSearchDocuments(index) {
  if (!Array.isArray(index?.chunks) || index.chunks.length === 0) {
    return 0;
  }

  return new Set(index.chunks.map((chunk) => chunk.relativePath)).size;
}

function summarizeSearchResult(result, { verbose = false } = {}) {
  const metadata = pickMetadata(result.frontmatter, result.retrievalFacets, { verbose });
  const summary = {
    relativePath: result.relativePath,
    id: result.frontmatter?.id || null,
    title: result.title,
    heading: result.heading,
    preview: result.preview,
    score: result.score,
    metadata
  };

  if (verbose) {
    return {
      ...summary,
      pageKind: result.pageKind,
      authority: result.authority
    };
  }

  return summary;
}
