import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { loadLexicalSearchIndexForRead, searchLexicalIndexPage } from "../lib/search.mjs";
import { buildNextCall } from "../lib/next-calls-descriptor.mjs";
import { encodeSearchToken, decodeSearchToken } from "../lib/search-source-reader.mjs";
import { scalarLength, sliceScalars } from "../lib/search-passages.mjs";
import { buildWorkRecordEntryBodyReadCall } from "./work-record-entries.mjs";

const TARGETED_CONTEXT_SCALARS = 160;

const FILTER_KEYS = ["kind", "type", "status", "priority", "owner", "area", "initiative",
  "retrieval_role", "canonicality", "maintenance_mode", "knowledge_role", "evidence_stage",
  "retrieval_visibility", "lifecycle", "sensitivity", "topic"];

function normalizeFilters(input) {
  return Object.fromEntries(FILTER_KEYS.filter((key) => input[key] !== null && input[key] !== undefined)
    .map((key) => [key, key === "initiative" ? String(input[key]) : String(input[key]).toLowerCase()]));
}

function concisePreview(text, matchRange, radius = 110) {
  const total = scalarLength(text);
  const start = Math.max(0, matchRange.offset - radius);
  const end = Math.min(total, matchRange.offset + Math.max(1, matchRange.length) + radius);
  return `${start > 0 ? "…" : ""}${sliceScalars(text, start, end - start)}${end < total ? "…" : ""}`;
}

function distinctSourceActions(targetedRead, sourceStart) {
  return targetedRead.tool === sourceStart.tool && isDeepStrictEqual(targetedRead.arguments, sourceStart.arguments)
    ? { targeted_read: targetedRead }
    : { targeted_read: targetedRead, source_start: sourceStart };
}

export function buildLexicalSearchSourceDescriptor(result, { repository, contextDigest, profile, extensionNamespaces, freshSearchArguments }) {
  const payload = {
    repository: repository ?? null,
    path: result.relativePath,
    source_id: result.sourceId,
    source_digest: result.sourceDigest,
    context_digest: contextDigest,
    profile: profile ?? null,
    extension_namespaces: extensionNamespaces ?? [],
    fresh_search: freshSearchArguments,
    match_offset: result.matchRange.offset,
    match_length: result.matchRange.length,
    offset: Math.max(0, result.matchRange.offset - TARGETED_CONTEXT_SCALARS)
  };
  const searchMatch = encodeSearchToken("source", payload);
  const startMatch = encodeSearchToken("source", { ...payload, offset: 0 });
  return {
    kind: "search_source",
    source_id: result.sourceId,
    location: result.location,
    scalar_length: result.scalarLength,
    ...distinctSourceActions(
      buildNextCall({ tool: "workspace_read_page", arguments: {
        ...(repository ? { repo: repository } : {}), path: result.relativePath, search_match: searchMatch
      }, recommended: true }),
      buildNextCall({ tool: "workspace_read_page", arguments: {
        ...(repository ? { repo: repository } : {}), path: result.relativePath, search_match: startMatch
      }, recommended: false }))
  };
}

export function buildWorkRecordEntrySearchSourceDescriptor(result, { repository }) {
  const { unit, entry_id: entryId, version_id: version } = result.location;
  return {
    kind: "work_record_entry",
    unit,
    entry_id: entryId,
    version_id: version,
    entry_kind: result.entry.entry_kind,
    scalar_length: result.scalarLength,
    utf8_bytes: result.entry.utf8_bytes,
    reference: result.entry.reference,
    source_closure: result.entry.source_closure,
    ...distinctSourceActions(
      buildWorkRecordEntryBodyReadCall({ repository, unit, entryId, version,
        offset: Math.max(0, result.matchRange.offset - TARGETED_CONTEXT_SCALARS) }),
      buildWorkRecordEntryBodyReadCall({ repository, unit, entryId, version, offset: 0 }))
  };
}

function buildFreshSearchArguments(repository, request) {
  return {
    ...(repository ? { repo: repository } : {}),
    query: request.query,
    limit: request.limit,
    ...(request.profile === null || request.profile === undefined ? {} : { profile: request.profile }),
    ...(Array.isArray(request.extensionNamespaces) ? { extensionNamespaces: [...request.extensionNamespaces] } : {}),
    ...(request.history ? { history: true } : {}),
    ...request.filters
  };
}

export async function searchRepo(options = {}) {
  for (const retired of ["offset", "unbounded", "reindex", "verbose", "result_count"]) {
    if (options[retired] !== undefined) throw new Error(`searchRepo does not accept retired ${retired}`);
  }
  const continued = options.continuation ? decodeSearchToken(options.continuation, "ranked") : null;
  if (!continued && !options.query) throw new Error("searchRepo requires query");
  const repository = options.repository ?? options.repo ?? continued?.repository ?? null;
  if (continued && repository !== continued.repository) {
    const error = new Error("Search continuation repository is incompatible");
    error.code = "search_continuation_context_mismatch";
    error.envelope = { schema_version: "search-refusal.v1", accepted: false,
      code: error.code, reason: error.message, next_calls: [] };
    throw error;
  }
  const request = continued ?? {
    repository,
    query: String(options.query),
    limit: Math.min(50, Math.max(1, Number(options.limit) || 8)),
    offset: 0,
    profile: options.profile ?? null,
    extensionNamespaces: options.extensionNamespaces ?? null,
    history: options.history === true,
    filters: normalizeFilters(options)
  };
  if (request.history === true && repository === null) {
    const error = new Error("Entry history search requires a registered repository identity");
    error.code = "work_record_entry_search_requires_repository";
    error.envelope = { schema_version: "search-refusal.v1", accepted: false,
      code: error.code, reason: error.message, next_calls: [] };
    throw error;
  }
  const targetDir = path.resolve(String(options.dir ?? "."));
  const loaded = await loadLexicalSearchIndexForRead(targetDir, {
    profile: request.profile,
    extensionNamespaces: request.extensionNamespaces,
    repository,
    history: request.history === true
  });
  if (continued && (continued.sourceSignature !== loaded.index.sourceSignature ||
      continued.contextDigest !== loaded.index.contextDigest)) {
    const error = new Error("Search continuation is stale because the ranked source population changed");
    error.code = "search_continuation_stale";
    error.next_calls = [buildNextCall({ tool: "workspace_search_repo",
      arguments: buildFreshSearchArguments(repository, request), recommended: true })];
    error.envelope = { schema_version: "search-refusal.v1", accepted: false,
      code: error.code, reason: error.message, next_calls: error.next_calls };
    throw error;
  }
  const rankedIndex = loaded.entryOverlay === null
    ? loaded.index
    : { ...loaded.index, chunks: [...loaded.index.chunks, ...loaded.entryOverlay.chunks] };
  const page = searchLexicalIndexPage(rankedIndex, {
    query: request.query, limit: request.limit, offset: request.offset, filters: request.filters
  });
  const results = page.results.map((result) => ({
    relativePath: result.relativePath,
    id: result.frontmatter?.id ?? null,
    title: result.title,
    heading: result.heading,
    preview: concisePreview(result.originalText, result.matchRange),
    score: result.score,
    metadata: pickMetadata(result.frontmatter, result.retrievalFacets),
    source: result.location?.kind === "work_record_entry"
      ? buildWorkRecordEntrySearchSourceDescriptor(result, { repository })
      : buildLexicalSearchSourceDescriptor(result, { repository,
      contextDigest: loaded.index.contextDigest, profile: request.profile,
      extensionNamespaces: loaded.index.extensionNamespaces,
      freshSearchArguments: buildFreshSearchArguments(repository, request) })
  }));
  const diagnostics = [{ code: "search_source_hashing_required", severity: "info",
    message: "Search hashes current corpus bytes for freshness; warm projections and tokenization are reused." },
  ...(loaded.indexState === "existing" ? [] : [{ code: loaded.indexStateReason, severity: "warning",
    message: `Search used ${loaded.indexState} lexical preparation.` }]),
  ...(loaded.entryOverlay === null
    ? [{ code: "work_record_entry_search_requires_repository", severity: "info",
        message: "Work-record entry sources need a registered repository identity; this search covers canonical files only." }]
    : loaded.entryOverlay.diagnostics)];

  const servedPage = (count) => {
    const nextOffset = request.offset + count < page.totalCount ? request.offset + count : null;
    return {
      query: request.query,
      total_count: page.totalCount,
      returned_count: count,
      limit: page.limit,
      has_more: nextOffset !== null,
      next_calls: nextOffset === null ? [] : [buildNextCall({ tool: "workspace_search_repo", arguments: {
        ...(repository ? { repo: repository } : {}),
        continuation: encodeSearchToken("ranked", { ...request, offset: nextOffset,
          sourceSignature: loaded.index.sourceSignature, contextDigest: loaded.index.contextDigest })
      }, recommended: true })],
      diagnostics,
      indexState: loaded.indexState,
      indexStateReason: loaded.indexStateReason,
      results: results.slice(0, count)
    };
  };
  if (typeof options.fits !== "function") return servedPage(results.length);

  for (let count = results.length; count > 1; count -= 1) {
    const candidate = servedPage(count);
    if (options.fits(candidate)) return candidate;
  }
  return servedPage(Math.min(1, results.length));
}

function pickMetadata(frontmatter = {}, facets = {}) {
  return Object.fromEntries(Object.entries({
    type: frontmatter.type, status: frontmatter.status, priority: frontmatter.priority,
    owner: frontmatter.owner, owners: frontmatter.owners, area: frontmatter.area,
    initiative: frontmatter.initiative, canonicality: facets.canonicality,
    maintenance_mode: facets.maintenance_mode, knowledge_role: facets.knowledge_role,
    evidence_stage: facets.evidence_stage, retrieval_visibility: facets.retrieval_visibility,
    lifecycle: facets.lifecycle, sensitivity: facets.sensitivity,
    retrieval_role: facets.retrieval_role, topics: facets.topics
  }).filter(([, value]) => value !== undefined && value !== null && value !== ""));
}
