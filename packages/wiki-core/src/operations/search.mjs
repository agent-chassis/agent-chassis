import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  loadLexicalSearchIndexForRead,
  matchesSearchFilters,
  rankLexicalSearchResults,
  searchLexicalIndexPage
} from "../lib/search.mjs";
import { buildNextCall } from "../lib/next-calls-descriptor.mjs";
import { encodeSearchToken, decodeSearchToken, captureSearchSource } from "../lib/search-source-reader.mjs";
import { computeWorkRecordSourceDigest, parseWorkRecordJson } from "../lib/work-record-schema.mjs";
import { projectWorkRecordFreshness } from "../lib/work-record-schema-constants.mjs";
import { scalarLength, sliceScalars } from "../lib/search-passages.mjs";
import { buildWorkRecordEntryBodyReadCall } from "./work-record-entries.mjs";

const TARGETED_CONTEXT_SCALARS = 160;

export const FILTER_KEYS = Object.freeze(["kind", "type", "status", "priority", "owner", "area", "initiative",
  "retrieval_role", "canonicality", "maintenance_mode", "knowledge_role", "evidence_stage",
  "retrieval_visibility", "lifecycle", "sensitivity", "topic"]);

export function normalizeFilters(input) {
  return Object.fromEntries(FILTER_KEYS.filter((key) => input[key] !== null && input[key] !== undefined)
    .map((key) => [key, key === "initiative" ? String(input[key]) : String(input[key]).toLowerCase()]));
}

function searchRefusal(code, reason) {
  const error = new Error(reason);
  error.code = code;
  error.envelope = { schema_version: "search-refusal.v1", accepted: false, code, reason, next_calls: [] };
  return error;
}

function entryHistoryRequiresRepository() {
  return searchRefusal("work_record_entry_search_requires_repository",
    "Entry history search requires a registered repository identity");
}

async function loadSearchPopulation(dir, request, { capturedContent = false } = {}) {
  const loaded = await loadLexicalSearchIndexForRead(path.resolve(String(dir ?? ".")), {
    profile: request.profile,
    extensionNamespaces: request.extensionNamespaces,
    repository: request.repository,
    history: request.history === true,
    capturedContent
  });
  const index = loaded.entryOverlay === null
    ? loaded.index
    : { ...loaded.index, chunks: [...loaded.index.chunks, ...loaded.entryOverlay.chunks] };
  return { loaded, index };
}

function populationDiagnostics(loaded) {
  return [{ code: "search_source_hashing_required", severity: "info",
    message: "Search hashes current corpus bytes for freshness; warm projections and tokenization are reused." },
  ...(loaded.indexState === "existing" ? [] : [{ code: loaded.indexStateReason, severity: "warning",
    message: `Search used ${loaded.indexState} lexical preparation.` }]),
  ...(loaded.entryOverlay === null
    ? [{ code: "work_record_entry_search_requires_repository", severity: "info",
        message: "Work-record entry sources need a registered repository identity; this search covers canonical files only." }]
    : loaded.entryOverlay.diagnostics)];
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
    throw searchRefusal("search_continuation_context_mismatch", "Search continuation repository is incompatible");
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
  if (request.history === true && repository === null) throw entryHistoryRequiresRepository();
  const { loaded, index: rankedIndex } = await loadSearchPopulation(options.dir, { ...request, repository });
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
  const diagnostics = populationDiagnostics(loaded);

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

function inventoryMember(chunk) {
  const entry = chunk.location?.kind === "work_record_entry";
  return {
    relativePath: chunk.relativePath,
    id: chunk.frontmatter?.id ?? null,
    title: chunk.title,
    heading: chunk.heading,
    text: chunk.originalText,
    ...(chunk.score === undefined ? {} : { score: chunk.score }),
    metadata: pickMetadata(chunk.frontmatter, chunk.retrievalFacets),
    source: entry
      ? { kind: "work_record_entry", unit: chunk.location.unit, entry_id: chunk.location.entry_id,
          version_id: chunk.location.version_id, entry_kind: chunk.entry.entry_kind,
          source_digest: chunk.sourceDigest, scalar_length: chunk.scalarLength,
          utf8_bytes: chunk.entry.utf8_bytes, reference: chunk.entry.reference,
          source_closure: chunk.entry.source_closure }
      : { kind: "search_source", source_id: chunk.sourceId, source_digest: chunk.sourceDigest,
          location: chunk.location, scalar_length: chunk.scalarLength }
  };
}

export async function readSearchInventory(options = {}) {
  if (options.query !== undefined && options.query !== null &&
      (typeof options.query !== "string" || options.query.trim() === "")) {
    throw searchRefusal("search_inventory_query_invalid", "Inventory query must be a nonempty string when supplied");
  }
  const request = {
    repository: options.repository ?? null,
    query: options.query ?? null,
    profile: options.profile ?? null,
    extensionNamespaces: options.extensionNamespaces ?? null,
    history: options.history === true,
    filters: normalizeFilters(options)
  };
  if (request.history && request.repository === null) throw entryHistoryRequiresRepository();

  const { loaded, index } = await loadSearchPopulation(options.dir, request, { capturedContent: true });
  const selected = request.query === null
    ? index.chunks.filter((chunk) => matchesSearchFilters(chunk, request.filters))
    : rankLexicalSearchResults(index, { query: request.query, filters: request.filters });
  const members = selected.map(inventoryMember);
  const observedRecords = [];
  const observedPaths = new Set();
  for (const member of members) {
    if (member.source.kind === "search_source") {
      member.source.reference = encodeSearchToken("source", {
        repository: request.repository, path: member.relativePath,
        source_id: member.source.source_id, source_digest: member.source.source_digest,
        context_digest: loaded.index.contextDigest, profile: request.profile,
        extension_namespaces: loaded.index.extensionNamespaces, offset: 0,
        fresh_search: null
      });
    }
    if (!/^wiki\/work-records\/WK-[0-9]{4}\.json$/u.test(member.relativePath) ||
        observedPaths.has(member.relativePath)) continue;
    observedPaths.add(member.relativePath);

    const capture = await captureSearchSource(path.resolve(options.dir ?? "."), member.relativePath);
    if (capture.digest !== member.source.source_digest) {
      throw searchRefusal("search_source_changed", `Search record changed during selection: ${member.relativePath}`);
    }
    const parsed = parseWorkRecordJson(capture.text, { sourcePath: capture.absolutePath });
    if (!parsed.ok) throw searchRefusal("search_source_unreadable", `Search record is unreadable: ${member.relativePath}`);
    observedRecords.push({ id: parsed.value.id,
      observed_source_digest: projectWorkRecordFreshness(computeWorkRecordSourceDigest(parsed.value)) });
  }
  return {
    repository: request.repository,
    query: request.query,
    history: request.history,
    filters: request.filters,
    total_count: members.length,
    source_signature: loaded.index.sourceSignature,
    context_digest: loaded.index.contextDigest,
    indexState: loaded.indexState,
    indexStateReason: loaded.indexStateReason,
    diagnostics: populationDiagnostics(loaded),
    observed_records: observedRecords,
    members
  };
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
