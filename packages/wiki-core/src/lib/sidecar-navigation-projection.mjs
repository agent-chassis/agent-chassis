const COMPACT_LIMIT = 20;
const RETAINED_ORIGINAL_NEXT_ACTION =
  "The complete original answer is retained at full_result.content_reference; read it with its " +
  "read_tool. verbose:true runs a new evaluation and does not recover this answer.";
const RESULT_FIELDS = Object.freeze({ definition: "definitions", find_references: "references",
  symbol_callers: "callers", symbol_callees: "callees" });

const list = (value) => (Array.isArray(value) ? value : []);

function counted(total, returned) {
  return { total, returned, truncated: total > returned };
}

function containsLine(range, line) {
  return Number.isSafeInteger(range?.start_line) && Number.isSafeInteger(range?.end_line) &&
    range.start_line <= line && line <= range.end_line;
}

function candidateAnchor(candidate, hitsById, resolution) {
  const hits = list(candidate.hit_ids).map((id) => hitsById.get(id)).filter((hit) => hit?.occurrence);
  const positioned = resolution?.kind === "path_position"
    ? hits.find(({ occurrence }) => occurrence.document_path === resolution.path &&
      containsLine(occurrence.payload?.range, resolution.line))
    : null;
  return positioned ?? hits.find(({ occurrence }) => (occurrence.payload?.symbol_roles & 1) === 1) ??
    hits[0] ?? null;
}

function compactRow(row) {
  if (row.edge_id !== undefined) {
    return { hit_id: row.hit_id, symbol_key: row.symbol_key, caller_symbol: row.caller_symbol,
      callee_symbol: row.callee_symbol, occurrence_count: row.occurrence_count, lines: [...list(row.lines)],
      provider_id: row.provider_id, document_path: row.document_path, source: structuredClone(row.source) };
  }
  return { hit_id: row.hit_id, symbol_key: row.symbol_key, symbol: row.symbol, path: row.path,
    line: row.line, symbol_roles: row.symbol_roles, provider_id: row.provider_id,
    source: structuredClone(row.source) };
}

function compactHit({ hit_id: hitId, occurrence, call_edge: callEdge, source }) {
  if (callEdge) {
    return { hit_id: hitId, provider_id: callEdge.provider_id, path: callEdge.document_path,
      lines: [...callEdge.lines], source: structuredClone(source) };
  }
  return { hit_id: hitId, provider_id: occurrence.provider_id, path: occurrence.document_path,
    range: structuredClone(occurrence.payload?.range ?? null),
    symbol_key: occurrence.payload?.symbol_key ?? null,
    symbol_roles: occurrence.payload?.symbol_roles ?? null, source: structuredClone(source) };
}

export function projectNativeNavigation(result, base) {
  const field = RESULT_FIELDS[result?.query_kind] ?? "references";
  const rows = list(result?.[field]);
  const resolution = result?.symbol_resolution ?? {};
  const candidates = list(resolution.candidates);
  const allHits = list(result?.source_hits);
  const allRegions = list(result?.context_regions);
  const hitsById = new Map(allHits.map((hit) => [hit.hit_id, hit]));
  const shownRows = rows.slice(0, COMPACT_LIMIT);
  const shownCandidates = candidates.slice(0, COMPACT_LIMIT);
  const displayed = new Set(shownRows.map((row) => row.hit_id));
  for (const candidate of shownCandidates) {
    const anchor = candidateAnchor(candidate, hitsById, resolution);
    if (anchor) displayed.add(anchor.hit_id);
  }
  const hits = allHits.filter((hit) => displayed.has(hit.hit_id));
  const regionIds = new Set(hits.map((hit) => hit.source?.region_id).filter(Boolean));
  const regions = allRegions.filter((region) => regionIds.has(region.region_id))
    .map(({ hit_ids: hitIds, ...region }) => ({ ...structuredClone(region),
      hit_ids: hitIds.filter((id) => displayed.has(id)), total_hit_count: hitIds.length }));
  const scipAvailable = result?.scip_state?.scip_available === true &&
    result?.scip_state?.graph_available === true;
  return {
    ...base,
    resolution: { ...base.resolution, kind: resolution.kind ?? null,
      ...(resolution.position_granularity ? { position_granularity: resolution.position_granularity } : {}),
      candidate_count: candidates.length },
    graph_snapshot: structuredClone(result?.graph_snapshot ?? null),
    scip_state: structuredClone(result?.scip_state ?? null),
    ...(result?.call_attribution ? { call_attribution: structuredClone(result.call_attribution) } : {}),
    result_count: counted(rows.length, shownRows.length),
    counts: {
      candidates: counted(candidates.length, shownCandidates.length),
      results: counted(rows.length, shownRows.length),
      source_hits: counted(allHits.length, hits.length),
      context_regions: counted(allRegions.length, regions.length),
      complete_files: counted(list(result?.complete_files).length, 0),
      summary: structuredClone(result?.summary?.counts ?? null)
    },
    candidates: shownCandidates.map((candidate) => {
      const { hit_ids: hitIds = [], region_ids: candidateRegions = [], result_hit_ids: resultIds,
        ...rest } = candidate;
      const shownHits = hitIds.filter((id) => displayed.has(id));
      const shownRegions = new Set(shownHits.map((id) => hitsById.get(id)?.source?.region_id));
      return { ...structuredClone(rest), hit_ids: shownHits,
        region_ids: candidateRegions.filter((id) => shownRegions.has(id)),
        total_hit_count: hitIds.length, total_region_count: candidateRegions.length,
        ...(Array.isArray(resultIds) ? { result_hit_ids: resultIds.filter((id) => displayed.has(id)),
          total_result_count: resultIds.length } : {}) };
    }),
    [field]: shownRows.map(compactRow),
    source_hits: hits.map(compactHit),
    context_regions: regions,
    limitations: list(result?.symbol_facts).filter((fact) => list(fact.limitations).length > 0)
      .map((fact) => ({ provider_id: fact.provider_id, symbol_id: fact.symbol_id,
        limitations: [...fact.limitations] })),
    next_action: [base.next_action, scipAvailable ? RETAINED_ORIGINAL_NEXT_ACTION : null]
      .filter(Boolean).join(" ")
  };
}
