import { isObject, normalizeStringEntry, toNonNegativeInteger } from "./work-record-admission-shared.mjs";

export const WORK_RECORD_GRAPH_IMPACT_SUMMARY_SCHEMA_VERSION =
  "work-record-graph-impact-summary.v1";
export const WORK_RECORD_GRAPH_IMPACT_SUMMARY_KIND = "work_record_graph_impact_summary";
const WORK_RECORD_GRAPH_IMPACT_SUMMARY_DETAIL_LIMIT = 5;

function countEntries(value) {
  return Array.isArray(value) ? value.length : 0;
}

function takeBoundedStringEntries(values, limit = WORK_RECORD_GRAPH_IMPACT_SUMMARY_DETAIL_LIMIT) {
  if (!Array.isArray(values) || limit <= 0) {
    return [];
  }

  const entries = [];
  const seen = new Set();
  for (const value of values) {
    const entry = normalizeStringEntry(value);
    if (!entry || seen.has(entry)) {
      continue;
    }
    seen.add(entry);
    entries.push(entry);
    if (entries.length >= limit) {
      break;
    }
  }
  return entries;
}

function normalizeSurfaceTargeting(targeting) {
  if (!isObject(targeting)) {
    return null;
  }

  const normalized = {};
  const granularity = normalizeStringEntry(targeting.granularity);
  const command = normalizeStringEntry(targeting.command);
  const tool = normalizeStringEntry(targeting.tool);

  if (granularity) {
    normalized.granularity = granularity;
  }
  if (command) {
    normalized.command = command;
  }
  if (tool) {
    normalized.tool = tool;
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function normalizeSurfaceEntry(entry) {
  if (!isObject(entry)) {
    return null;
  }

  const path = normalizeStringEntry(entry.path);
  if (!path) {
    return null;
  }

  const normalized = { path };
  const name = normalizeStringEntry(entry.name);
  const kind = normalizeStringEntry(entry.kind);
  const reason = normalizeStringEntry(entry.reason);
  const inputPath = normalizeStringEntry(entry.input_path);
  const targeting = normalizeSurfaceTargeting(entry.targeting);

  if (name) {
    normalized.name = name;
  }
  if (kind) {
    normalized.kind = kind;
  }
  if (reason) {
    normalized.reason = reason;
  }
  if (inputPath) {
    normalized.input_path = inputPath;
  }
  if (targeting) {
    normalized.targeting = targeting;
  }

  return normalized;
}

function normalizeSurfaceEntries(values, limit = WORK_RECORD_GRAPH_IMPACT_SUMMARY_DETAIL_LIMIT) {
  if (!Array.isArray(values) || limit <= 0) {
    return [];
  }

  const entries = [];
  const seen = new Set();
  for (const value of values) {
    const entry = normalizeSurfaceEntry(value);
    if (!entry) {
      continue;
    }
    const key = `${entry.path}:${entry.name ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    entries.push(entry);
    if (entries.length >= limit) {
      break;
    }
  }
  return entries;
}

function normalizeMissingUpdateHint(entry) {
  if (!isObject(entry)) {
    return null;
  }

  const normalized = {};
  const kind = normalizeStringEntry(entry.kind);
  const inputPath = normalizeStringEntry(entry.input_path);
  const missingSurface = normalizeStringEntry(entry.missing_surface);
  const reason = normalizeStringEntry(entry.reason);
  const action = normalizeStringEntry(entry.action);
  const suggestedPaths = takeBoundedStringEntries(entry.suggested_paths);

  if (kind) {
    normalized.kind = kind;
  }
  if (inputPath) {
    normalized.input_path = inputPath;
  }
  if (missingSurface) {
    normalized.missing_surface = missingSurface;
  }
  if (reason) {
    normalized.reason = reason;
  }
  if (action) {
    normalized.action = action;
  }
  if (suggestedPaths.length > 0) {
    normalized.suggested_paths = suggestedPaths;
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function normalizeGraphState(graphImpact, summary) {
  const summaryState = isObject(summary?.state) ? summary.state : null;
  const graphState = isObject(graphImpact.graph_state)
    ? graphImpact.graph_state
    : isObject(summaryState?.graph_state)
      ? summaryState.graph_state
      : {};

  const unavailablePaths = Array.isArray(graphState.unavailable_paths) ? graphState.unavailable_paths : [];
  const dirtyState =
    normalizeStringEntry(graphState.dirty_state) ??
    normalizeStringEntry(graphImpact.dirty_state) ??
    normalizeStringEntry(summaryState?.dirty_state) ??
    "unknown";
  const staleness =
    normalizeStringEntry(graphState.staleness) ??
    normalizeStringEntry(graphImpact.staleness) ??
    normalizeStringEntry(summaryState?.staleness) ??
    "unknown";

  return {
    graph_available: Boolean(graphState.graph_available),
    dirty_state: dirtyState,
    staleness,
    edge_source: normalizeStringEntry(graphState.edge_source) ?? "unavailable",
    dirty_graph_mode: normalizeStringEntry(graphState.dirty_graph_mode) ?? "unavailable",
    graph_schema_version: normalizeStringEntry(graphState.graph_schema_version) ?? null,
    unavailable_path_count: unavailablePaths.length
  };
}

function normalizeWarningCounts(graphImpact, summary) {
  const warningCounts = isObject(graphImpact.warning_counts)
    ? graphImpact.warning_counts
    : isObject(summary?.warning_counts)
      ? summary.warning_counts
      : null;
  const status = toNonNegativeInteger(warningCounts?.status) ?? 0;
  const invalidPaths = toNonNegativeInteger(warningCounts?.invalid_paths) ?? 0;
  const invalidDiffRecords = toNonNegativeInteger(warningCounts?.invalid_diff_records) ?? 0;
  const unavailableGraphPaths = toNonNegativeInteger(warningCounts?.unavailable_graph_paths) ?? 0;
  const total =
    toNonNegativeInteger(warningCounts?.total) ??
    status + invalidPaths + invalidDiffRecords + unavailableGraphPaths;

  return {
    total,
    status,
    invalid_paths: invalidPaths,
    invalid_diff_records: invalidDiffRecords,
    unavailable_graph_paths: unavailableGraphPaths
  };
}

function summarizeDegradedState(graphState, warningCount) {
  if (!graphState.graph_available) {
    return {
      kind: "graph_unavailable",
      message: "graph-impact evidence is unavailable"
    };
  }

  if (graphState.staleness === "missing") {
    return {
      kind: "missing_index",
      message: "graph-impact evidence is missing a base index"
    };
  }
  if (graphState.staleness === "rebuild_required") {
    return {
      kind: "rebuild_required",
      message: "graph-impact evidence requires a rebuild"
    };
  }
  if (graphState.staleness === "stale") {
    return {
      kind: "stale_index",
      message: "graph-impact evidence is stale"
    };
  }
  if (graphState.edge_source === "dirty_overlay") {
    return {
      kind: "dirty_overlay",
      message: "graph-impact evidence is derived from a dirty overlay"
    };
  }
  if (graphState.unavailable_path_count > 0) {
    return {
      kind: "partial_path_coverage",
      message: `graph-impact evidence has ${graphState.unavailable_path_count} unavailable path(s)`
    };
  }
  if (warningCount > 0) {
    return {
      kind: "warning_pressure",
      message: `graph-impact evidence carries ${warningCount} warning(s)`
    };
  }
  return {
    kind: "healthy",
    message: "graph-impact evidence is fresh and bounded"
  };
}

function normalizeUnit(graphImpact, recordId, sliceId) {
  const unit = isObject(graphImpact.unit) ? graphImpact.unit : {};
  const address =
    normalizeStringEntry(unit.address) ??
    (normalizeStringEntry(recordId)
      ? `${normalizeStringEntry(recordId)}${normalizeStringEntry(sliceId) ? `#${normalizeStringEntry(sliceId)}` : ""}`
      : null);
  const normalizedRecordId =
    normalizeStringEntry(unit.record_id) ??
    (address && address.includes("#") ? address.split("#")[0] : normalizeStringEntry(recordId));
  const normalizedSliceId =
    normalizeStringEntry(unit.slice_id) ??
    (address && address.includes("#") ? address.split("#")[1] ?? null : normalizeStringEntry(sliceId));
  const kind =
    normalizeStringEntry(unit.kind)?.toLowerCase() ??
    (normalizedSliceId ? "slice" : normalizedRecordId ? "work_item" : null);

  if (!kind || !normalizedRecordId || !address) {
    return null;
  }
  if (kind === "slice" && !normalizedSliceId) {
    return null;
  }

  return {
    kind,
    address,
    record_id: normalizedRecordId,
    ...(kind === "slice" ? { slice_id: normalizedSliceId } : { slice_id: null })
  };
}

function normalizeGraphImpactSummaryDerivedEvidence(graphImpact, summary) {
  const derivedSummary = isObject(summary?.derived_evidence) ? summary.derived_evidence : null;
  const unavailablePaths = takeBoundedStringEntries(
    isObject(graphImpact.graph_state)
      ? graphImpact.graph_state.unavailable_paths
      : derivedSummary?.unavailable_paths
  );

  return {
    unavailable_paths: unavailablePaths,
    missing_update_hints: normalizeMissingUpdateHintCollection(graphImpact, derivedSummary),
    affected_surfaces: {
      test: normalizeSurfaceEntries(derivedSummary?.likely_tests),
      docs: normalizeSurfaceEntries(derivedSummary?.docs_contracts),
      cli: normalizeSurfaceEntries(derivedSummary?.affected_surfaces?.cli),
      mcp: normalizeSurfaceEntries(derivedSummary?.affected_surfaces?.mcp)
    }
  };
}

function normalizeMissingUpdateHintCollection(graphImpact, derivedSummary) {
  const graphHints = Array.isArray(graphImpact.missing_update_hints) ? graphImpact.missing_update_hints : [];
  const summaryHints = Array.isArray(derivedSummary?.missing_update_hints)
    ? derivedSummary.missing_update_hints
    : [];
  const sourceHints = graphHints.length > 0 ? graphHints : summaryHints;

  const entries = [];
  const seen = new Set();
  for (const hint of sourceHints) {
    const entry = normalizeMissingUpdateHint(hint);
    if (!entry) {
      continue;
    }
    const key = [
      entry.kind ?? "",
      entry.input_path ?? "",
      entry.missing_surface ?? "",
      entry.action ?? "",
      entry.reason ?? "",
      (entry.suggested_paths || []).join("|")
    ].join("::");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    entries.push(entry);
    if (entries.length >= WORK_RECORD_GRAPH_IMPACT_SUMMARY_DETAIL_LIMIT) {
      break;
    }
  }
  return entries;
}

export function normalizeWorkRecordGraphImpactSummary(value, { unit = null } = {}) {
  const graphImpact = isObject(value?.graph_impact) ? value.graph_impact : isObject(value) ? value : null;
  if (!graphImpact) {
    return null;
  }

  const summary = isObject(graphImpact.summary) ? graphImpact.summary : null;
  const graphState = normalizeGraphState(graphImpact, summary);
  const warningCounts = normalizeWarningCounts(graphImpact, summary);
  const warningCount = warningCounts.total;
  const normalizedUnit = normalizeUnit(
    graphImpact,
    unit?.record_id ?? graphImpact.record_id ?? null,
    unit?.slice_id ?? graphImpact.slice_id ?? null
  );

  return {
    schema_version: WORK_RECORD_GRAPH_IMPACT_SUMMARY_SCHEMA_VERSION,
    kind: WORK_RECORD_GRAPH_IMPACT_SUMMARY_KIND,
    query_kind: normalizeStringEntry(graphImpact.query_kind) ?? normalizeStringEntry(summary?.query_kind) ?? null,
    record_id: normalizeStringEntry(graphImpact.record_id) ?? normalizeStringEntry(normalizedUnit?.record_id) ?? null,
    slice_id: normalizeStringEntry(graphImpact.slice_id) ?? normalizeStringEntry(normalizedUnit?.slice_id) ?? null,
    unit: normalizedUnit,
    source_record_digest: normalizeStringEntry(graphImpact.source_record_digest) ?? null,
    graph_state: graphState,
    warning_counts: warningCounts,
    graph_quality: {
      dirty_state: graphState.dirty_state,
      staleness: graphState.staleness,
      edge_source: graphState.edge_source,
      unavailable_path_count: graphState.unavailable_path_count,
      warning_count: warningCount,
      degraded_state: summarizeDegradedState(graphState, warningCount)
    },
    derived_evidence: normalizeGraphImpactSummaryDerivedEvidence(graphImpact, summary),
    counts: {
      canonical_refs: countEntries(graphImpact.canonical_refs ?? summary?.canonical_refs),
      graph_nodes: countEntries(graphImpact.graph_nodes),
      graph_edges: countEntries(graphImpact.graph_edges),
      structural_impacts: countEntries(graphImpact.structural_impacts),
      missing_update_hints: countEntries(graphImpact.missing_update_hints ?? summary?.derived_evidence?.missing_update_hints),
      input_paths: countEntries(graphImpact.input_paths),
      validated_paths: countEntries(graphImpact.validated_paths),
      invalid_paths: countEntries(graphImpact.invalid_paths)
    }
  };
}

export function createWorkRecordGraphImpactSummary(value, options = {}) {
  return normalizeWorkRecordGraphImpactSummary(value, options);
}
