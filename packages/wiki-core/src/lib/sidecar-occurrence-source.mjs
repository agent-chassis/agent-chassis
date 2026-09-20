import { readCommittedBlobBytes } from "./sidecar-committed-blobs.mjs";
import { isUnindexedSidecarSourcePath, validateVirtualSidecarPath } from "./sidecar-paths.mjs";
import { decodeCommittedSource, selectCommittedSourceRegion } from "./sidecar-source-regions.mjs";

const REGULAR_FILE_MODES = new Set(["100644", "100755"]);

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function hitId(row) {
  return JSON.stringify(["occurrence", row.provider_id, row.symbol_id, row.document_path,
    row.contribution_id, row.document_ordinal, row.occurrence_ordinal]);
}

function wellFormedRange(range) {
  return Number.isSafeInteger(range?.start_line) && Number.isSafeInteger(range?.end_line) &&
    range.start_line > 0 && range.start_line <= range.end_line;
}

function compareHits(left, right) {
  const [leftRange, rightRange] = [left.payload?.range, right.payload?.range];
  const [leftValid, rightValid] = [wellFormedRange(leftRange), wellFormedRange(rightRange)];
  return compareText(left.document_path, right.document_path) ||
    Number(rightValid) - Number(leftValid) ||
    (leftValid && rightValid
      ? leftRange.start_line - rightRange.start_line || leftRange.end_line - rightRange.end_line
      : 0) ||
    compareText(String(left.payload?.symbol_key ?? ""), String(right.payload?.symbol_key ?? "")) ||
    compareText(left.provider_id, right.provider_id) ||
    compareText(left.symbol_id, right.symbol_id) ||
    compareText(left.contribution_id, right.contribution_id) ||
    left.document_ordinal - right.document_ordinal ||
    left.occurrence_ordinal - right.occurrence_ordinal;
}

function compareRegions(left, right) {
  return compareText(left.path, right.path) ||
    (left.start_line ?? 0) - (right.start_line ?? 0) ||
    (left.end_line ?? 0) - (right.end_line ?? 0);
}

function groupSelection(selection) {
  const hits = new Map();
  for (const row of [...selection.occurrences, ...selection.position_occurrences]) {
    validateVirtualSidecarPath(row.document_path);
    const id = hitId(row);
    if (!hits.has(id)) hits.set(id, row);
  }
  const descriptors = new Map();
  for (const descriptor of selection.source_files) {
    validateVirtualSidecarPath(descriptor.path);
    if (descriptors.has(descriptor.path)) {
      throw new TypeError(
        `committed occurrence source names file descriptor ${descriptor.path} more than once`
      );
    }
    descriptors.set(descriptor.path, descriptor);
  }
  const definitions = new Map();
  for (const row of selection.source_definition_occurrences) {
    validateVirtualSidecarPath(row.document_path);
    if (!definitions.has(row.document_path)) definitions.set(row.document_path, []);
    definitions.get(row.document_path).push(row.payload);
  }
  return { hits, descriptors, definitions };
}

function unavailableFile(facts, reason) {
  return { source: null, entry: { ...facts, state: "unavailable", reason } };
}

function objectId({ blob_oid: oid }) {
  return typeof oid === "string" ? oid.toLowerCase() : oid;
}

export async function readCompleteFiles(repoRoot, paths, descriptors) {
  const files = new Map();
  const eligible = [];
  for (const filePath of paths) {
    const descriptor = descriptors.get(filePath);
    const facts = { path: filePath, blob_oid: descriptor?.blob_oid ?? null,
      mode: descriptor?.mode ?? null };
    if (isUnindexedSidecarSourcePath(filePath)) {
      files.set(filePath, unavailableFile(facts, "indexed_corpus_excluded"));
    } else if (!descriptor) {
      files.set(filePath, unavailableFile(facts, "missing_file_descriptor"));
    } else if (!REGULAR_FILE_MODES.has(descriptor.mode)) {
      files.set(filePath, unavailableFile(facts, "non_regular_file"));
    } else {
      eligible.push(facts);
    }
  }
  const objectIds = [...new Set(eligible.map(objectId))];
  const blobs = objectIds.length === 0
    ? new Map()
    : await readCommittedBlobBytes({ repoRoot, objectIds });
  const decoded = new Map();
  for (const facts of eligible) {
    const oid = objectId(facts);
    if (!decoded.has(oid)) {
      const blob = blobs.get(oid);
      decoded.set(oid, blob.state === "available" ? decodeCommittedSource(blob.bytes) : blob);
    }
    const source = decoded.get(oid);
    if (source.state !== "available") {
      files.set(facts.path, unavailableFile(facts, source.reason));
      continue;
    }
    const empty = source.line_count === 0;
    files.set(facts.path, { source, entry: { ...facts, state: "available",
      source_text: source.source_text, line_count: source.line_count,
      start_line: empty ? null : 1, end_line: empty ? null : source.line_count } });
  }
  return files;
}

function addRegion(regions, row, id, selected) {
  const regionId = JSON.stringify([row.document_path, selected.start_line, selected.end_line]);
  let region = regions.get(regionId);
  if (!region) {
    region = { region_id: regionId, path: row.document_path, selected, bases: new Map(),
      complete: false, symbol_keys: new Set(), hit_ids: new Set() };
    regions.set(regionId, region);
  }
  region.complete ||= selected.kind === "complete_file";
  region.bases.set(JSON.stringify(selected.selection_basis), selected.selection_basis);
  if (typeof row.payload?.symbol_key === "string") region.symbol_keys.add(row.payload.symbol_key);
  region.hit_ids.add(id);
  return regionId;
}

function publicRegion(region) {
  const bases = [...region.bases.values()];
  const basis = bases.length === 1 ? bases[0] : [...new Set(bases.flat())].sort(compareText);
  return {
    region_id: region.region_id,
    path: region.path,
    start_line: region.selected.start_line,
    end_line: region.selected.end_line,
    line_count: region.selected.line_count,
    kind: region.complete ? "complete_file" : region.selected.kind,
    selection_basis: [...basis],
    source_text: region.selected.source_text,
    symbol_keys: [...region.symbol_keys].sort(compareText),
    hit_ids: [...region.hit_ids].sort(compareText)
  };
}

function callSitePath(edge) {
  if (typeof edge.document_path !== "string") return null;
  try {
    validateVirtualSidecarPath(edge.document_path);
    return edge.document_path;
  } catch {
    return null;
  }
}

function callEdgeHit(edge, { files, definitions, regions, selections }) {
  const id = JSON.stringify(["call_edge", edge.provider_id, edge.edge_id]);
  const lines = Array.isArray(edge.lines) ? [...edge.lines] : [];
  const callEdge = { provider_id: edge.provider_id, edge_id: edge.edge_id,
    document_path: edge.document_path ?? null, lines };
  const documentPath = callSitePath(edge);
  const file = documentPath === null ? null : files.get(documentPath);
  if (!file?.source) {
    return { hit_id: id, call_edge: callEdge, source: { state: "unavailable",
      reason: file ? file.entry.reason : "call_site_document_unavailable" } };
  }
  const valid = lines.length > 0 && lines.every((line) => Number.isSafeInteger(line) && line > 0);
  const target = valid ? { start_line: lines.reduce((low, line) => Math.min(low, line)),
    end_line: lines.reduce((high, line) => Math.max(high, line)) } : null;
  const key = JSON.stringify([documentPath, target?.start_line, target?.end_line]);
  if (!selections.has(key)) {
    selections.set(key, selectCommittedSourceRegion({ source: file.source, target_range: target,
      definition_occurrences: definitions.get(documentPath) ?? [] }));
  }
  const row = { document_path: documentPath, payload: { symbol_key: edge.symbol_key } };
  return { hit_id: id, call_edge: callEdge,
    source: { state: "available", region_id: addRegion(regions, row, id, selections.get(key)) } };
}

export async function assembleCommittedOccurrenceSource({ repoRoot, selection, callEdges = [] }) {
  const { hits, descriptors, definitions } = groupSelection(selection);
  const rows = [...hits.values()].sort(compareHits);
  const paths = [...new Set([...descriptors.keys(), ...rows.map((row) => row.document_path),
    ...callEdges.map(callSitePath).filter((value) => value !== null)])]
    .sort(compareText);
  const files = await readCompleteFiles(repoRoot, paths, descriptors);
  const selections = new Map();
  const regions = new Map();
  const sourceHits = rows.map((row) => {
    const id = hitId(row);
    const file = files.get(row.document_path);
    if (!file.source) {
      return { hit_id: id, occurrence: structuredClone(row),
        source: { state: "unavailable", reason: file.entry.reason } };
    }
    const target = row.payload?.range;
    const key = JSON.stringify([row.document_path, target?.start_line, target?.end_line]);
    if (!selections.has(key)) {
      selections.set(key, selectCommittedSourceRegion({ source: file.source, target_range: target,
        definition_occurrences: definitions.get(row.document_path) ?? [] }));
    }
    const regionId = addRegion(regions, row, id, selections.get(key));
    return { hit_id: id, occurrence: structuredClone(row),
      source: { state: "available", region_id: regionId } };
  });
  const edgeHits = callEdges.map((edge) => callEdgeHit(edge, { files, definitions, regions, selections }));
  return {
    publication: structuredClone(selection.publication),
    source_hits: [...sourceHits, ...edgeHits],
    context_regions: [...regions.values()].map(publicRegion).sort(compareRegions),
    complete_files: paths.map((filePath) => files.get(filePath).entry)
  };
}
