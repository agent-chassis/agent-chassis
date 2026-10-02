const COMPACT_LIMIT = 20;
const RETAINED_ORIGINAL_NEXT_ACTION =
  "The complete original answer is retained; follow next_calls, or name one of its collections " +
  "with a row id, path, symbol or relationship in detail, to read that part without evaluating " +
  "the question again.";
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

export function projectNativeNavigation(result, base, { limit = COMPACT_LIMIT } = {}) {
  const field = RESULT_FIELDS[result?.query_kind] ?? "references";
  const rows = list(result?.[field]);
  const resolution = result?.symbol_resolution ?? {};
  const candidates = list(resolution.candidates);
  const allHits = list(result?.source_hits);
  const allRegions = list(result?.context_regions);
  const hitsById = new Map(allHits.map((hit) => [hit.hit_id, hit]));
  const shownRows = rows.slice(0, limit);
  const shownCandidates = candidates.slice(0, limit);
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

function withoutRegionText({ source_text: text, ...region }) {
  return { ...region, omitted: { source_text: { utf8_bytes: Buffer.byteLength(String(text ?? ""), "utf8") } } };
}

function regionHolders(summary) {
  if (Array.isArray(summary?.context_regions)) return [summary];
  return Object.values(summary?.parts ?? {}).filter((part) => Array.isArray(part?.context_regions));
}

function withoutRowHits(holder) {
  const rows = holder[RESULT_FIELDS[holder.query_kind] ?? "references"];
  const rowHits = new Set(list(rows).map((row) => row.hit_id));
  const hits = list(holder.source_hits);
  holder.source_hits = hits.filter((hit) => !rowHits.has(hit.hit_id));
  if (holder.counts?.source_hits) {
    holder.counts.source_hits = counted(holder.counts.source_hits.total, holder.source_hits.length);
  }
}

function answerHolders(summary) {
  if (Array.isArray(summary?.source_hits)) return [summary];
  return Object.values(summary?.parts ?? {}).filter((part) => Array.isArray(part?.source_hits));
}

export function fitNavigationSummary(project, fits) {
  for (let limit = COMPACT_LIMIT; limit >= 0; limit -= 1) {
    const complete = project(limit);
    if (fits(complete)) return complete;
    const holders = regionHolders(complete);
    const texts = holders.map((holder) => holder.context_regions);
    holders.forEach((holder) => { holder.context_regions = holder.context_regions.map(withoutRegionText); });
    if (!fits(complete)) answerHolders(complete).forEach(withoutRowHits);
    if (!fits(complete)) continue;
    holders.forEach((holder, index) => {
      texts[index].forEach((region, position) => {
        const reduced = holder.context_regions[position];
        holder.context_regions[position] = region;
        if (!fits(complete)) holder.context_regions[position] = reduced;
      });
    });
    return complete;
  }
  throw new RangeError("navigation summary identity exceeds the complete-frame class");
}
