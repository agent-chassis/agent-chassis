import {
  isCriticalSurfacePath,
  isNonEmptyString,
  isObject,
  normalizeDeclaredPathEntries,
  pathCategory,
  sortStrings,
  uniqueBy
} from "./work-record-admission-shared.mjs";
import { resolveWorkUnitAtomicitySubjectAddress } from "./work-record-admission-work-unit.mjs";

export function normalizeDispatchReadiness(dispatchReadiness) {
  if (!isObject(dispatchReadiness)) {
    return {
      schema_version: "dispatch-readiness.v1",
      unit: {
        kind: "work_item",
        address: "unknown",
        record_id: null,
        slice_id: null
      },
      decision_code: "invalid_record",
      dispatchable: false,
      clusters: [],
      state: {
        graph_available: false,
        dirty_state: "unknown",
        staleness: "unknown",
        graph_state: {
          graph_available: false,
          edge_source: "unavailable",
          dirty_graph_mode: "unavailable",
          unavailable_paths: []
        }
      },
      reasons: ["dispatch readiness input is required"],
      accepted_escalations: [],
      blast_radius: {
        level: "low",
        reasons: [],
        accepted_escalation_id: null
      }
    };
  }

  const state = isObject(dispatchReadiness.state)
    ? {
        graph_available: Boolean(dispatchReadiness.state.graph_available),
        dirty_state: dispatchReadiness.state.dirty_state ?? "unknown",
        staleness: dispatchReadiness.state.staleness ?? "unknown",
        graph_state: isObject(dispatchReadiness.state.graph_state)
          ? {
              graph_available: Boolean(dispatchReadiness.state.graph_state.graph_available),
              edge_source: dispatchReadiness.state.graph_state.edge_source ?? "unavailable",
              dirty_graph_mode: dispatchReadiness.state.graph_state.dirty_graph_mode ?? "unavailable",
              unavailable_paths: sortStrings(dispatchReadiness.state.graph_state.unavailable_paths)
            }
          : {
              graph_available: Boolean(dispatchReadiness.state.graph_available),
              edge_source: "unavailable",
              dirty_graph_mode: "unavailable",
              unavailable_paths: []
            }
      }
    : {
        graph_available: false,
        dirty_state: "unknown",
        staleness: "unknown",
        graph_state: {
          graph_available: false,
          edge_source: "unavailable",
          dirty_graph_mode: "unavailable",
          unavailable_paths: []
        }
      };

  return {
    schema_version: String(dispatchReadiness.schema_version || "dispatch-readiness.v1"),
    unit: isObject(dispatchReadiness.unit)
      ? {
          kind: isNonEmptyString(dispatchReadiness.unit.kind) ? dispatchReadiness.unit.kind : "work_item",
          address: resolveWorkUnitAtomicitySubjectAddress(dispatchReadiness),
          record_id: isNonEmptyString(dispatchReadiness.unit.record_id)
            ? dispatchReadiness.unit.record_id
            : null,
          slice_id: isNonEmptyString(dispatchReadiness.unit.slice_id)
            ? dispatchReadiness.unit.slice_id
            : null
        }
      : {
          kind: "work_item",
          address: isNonEmptyString(dispatchReadiness.record_id) ? dispatchReadiness.record_id : "unknown",
          record_id: isNonEmptyString(dispatchReadiness.record_id) ? dispatchReadiness.record_id : null,
          slice_id: null
        },
    decision_code: isNonEmptyString(dispatchReadiness.decision_code)
      ? dispatchReadiness.decision_code
      : "invalid_record",
    dispatchable: Boolean(dispatchReadiness.dispatchable),
    clusters: Array.isArray(dispatchReadiness.clusters) ? dispatchReadiness.clusters : [],
    state,
    reasons: Array.isArray(dispatchReadiness.reasons) ? dispatchReadiness.reasons : [],
    accepted_escalations: Array.isArray(dispatchReadiness.accepted_escalations)
      ? dispatchReadiness.accepted_escalations
      : [],
    blast_radius: isObject(dispatchReadiness.blast_radius)
      ? {
          level: dispatchReadiness.blast_radius.level ?? "low",
          reasons: Array.isArray(dispatchReadiness.blast_radius.reasons)
            ? dispatchReadiness.blast_radius.reasons
            : [],
          accepted_escalation_id: dispatchReadiness.blast_radius.accepted_escalation_id ?? null
        }
      : {
          level: "low",
          reasons: [],
          accepted_escalation_id: null
        }
  };
}

function classifyDeclaredEntry(path) {
  const category = pathCategory(path);
  if (category === "test") {
    return { role: "declared_test", category };
  }
  if (category === "docs") {
    return { role: "declared_docs", category };
  }
  return { role: "declared_scope", category };
}

function createFileEntry({
  path,
  role,
  source,
  reason,
  input_path = null,
  kind = null
}) {
  if (!isNonEmptyString(path)) {
    return null;
  }

  return {
    path: String(path),
    role,
    source,
    reason,
    ...(input_path ? { input_path } : {}),
    ...(kind ? { kind } : {})
  };
}

function addFileEntry(entries, entry) {
  const fileEntry = createFileEntry(entry);
  if (fileEntry) {
    entries.push(fileEntry);
  }
}

export function collectDeclaredFiles(dispatchReadiness) {
  const entries = [];
  const clusters = Array.isArray(dispatchReadiness.clusters) ? dispatchReadiness.clusters : [];

  for (const cluster of clusters) {
    for (const path of normalizeDeclaredPathEntries(cluster?.input_paths)) {
      const declared = classifyDeclaredEntry(path);
      addFileEntry(entries, {
        path,
        role: declared.role,
        source: "work_record",
        reason: "dispatch readiness input path"
      });
    }

    for (const path of normalizeDeclaredPathEntries(cluster?.docs_contracts)) {
      addFileEntry(entries, {
        path,
        role: "declared_docs",
        source: "work_record",
        reason: "dispatch readiness docs contract"
      });
    }

    for (const path of normalizeDeclaredPathEntries(cluster?.likely_tests)) {
      addFileEntry(entries, {
        path,
        role: "declared_test",
        source: "work_record",
        reason: "dispatch readiness likely test"
      });
    }
  }

  return uniqueBy(entries, (entry) =>
    [entry.path, entry.role, entry.source, entry.input_path ?? "", entry.kind ?? "", entry.reason].join("|")
  ).sort((left, right) =>
    String(left.path).localeCompare(String(right.path)) ||
    String(left.role).localeCompare(String(right.role)) ||
    String(left.source).localeCompare(String(right.source)) ||
    String(left.input_path ?? "").localeCompare(String(right.input_path ?? "")) ||
    String(left.reason).localeCompare(String(right.reason))
  );
}

export function collectGraphEntries(graphImpact) {
  const entries = [];
  const graphState = isObject(graphImpact?.graph_state) ? graphImpact.graph_state : null;
  const graphAvailable = Boolean(graphState?.graph_available);
  if (!graphAvailable) {
    return entries;
  }

  const addSurface = (path, { role, reason, inputPath = null, kind = null }) => {
    if (!isNonEmptyString(path)) {
      return;
    }
    addFileEntry(entries, {
      path,
      role,
      source: "sidecar_graph_impact",
      reason,
      input_path: inputPath,
      kind
    });
  };

  const surfaces = graphImpact?.summary?.derived_evidence?.affected_surfaces;
  if (isObject(surfaces)) {
    for (const entry of Array.isArray(surfaces.cli) ? surfaces.cli : []) {
      addSurface(entry.path, {
        role: pathCategory(entry.path) === "test" ? "likely_test" : "downstream_surface",
        reason: entry.reason || "graph-derived CLI surface",
        inputPath: entry.input_path ?? null,
        kind: entry.kind ?? "cli_command"
      });
    }
    for (const entry of Array.isArray(surfaces.mcp) ? surfaces.mcp : []) {
      addSurface(entry.path, {
        role: pathCategory(entry.path) === "test" ? "likely_test" : "downstream_surface",
        reason: entry.reason || "graph-derived MCP surface",
        inputPath: entry.input_path ?? null,
        kind: entry.kind ?? "mcp_tool"
      });
    }
    for (const entry of Array.isArray(surfaces.code) ? surfaces.code : []) {
      const category = pathCategory(entry.path);
      addSurface(entry.path, {
        role:
          category === "test"
            ? "likely_test"
            : category === "docs"
              ? "docs_contract"
              : isCriticalSurfacePath(entry.path)
                ? "critical_surface"
                : "downstream_surface",
        reason: entry.reason || "graph-derived code surface",
        inputPath: entry.input_path ?? null,
        kind: entry.kind ?? "code_path"
      });
    }
  }

  for (const entry of Array.isArray(graphImpact?.summary?.derived_evidence?.likely_tests)
    ? graphImpact.summary.derived_evidence.likely_tests
    : []) {
    addSurface(entry.path, {
      role: "likely_test",
      reason: entry.reason || "graph-derived test surface",
      inputPath: entry.input_path ?? null,
      kind: entry.kind ?? "test"
    });
  }

  for (const entry of Array.isArray(graphImpact?.summary?.derived_evidence?.docs_contracts)
    ? graphImpact.summary.derived_evidence.docs_contracts
    : []) {
    addSurface(entry.path, {
      role: "docs_contract",
      reason: entry.reason || "graph-derived docs contract",
      inputPath: entry.input_path ?? null,
      kind: entry.kind ?? "docs_contract"
    });
  }

  for (const impact of Array.isArray(graphImpact?.structural_impacts) ? graphImpact.structural_impacts : []) {
    const inputPath = isNonEmptyString(impact?.input_path) ? impact.input_path : null;
    for (const nodeId of Array.isArray(impact?.node_ids) ? impact.node_ids : []) {
      const node = Array.isArray(graphImpact?.graph_nodes)
        ? graphImpact.graph_nodes.find((candidate) => candidate && candidate.id === nodeId)
        : null;
      const path = isNonEmptyString(node?.path) ? node.path : null;
      if (!path || path === inputPath) {
        continue;
      }
      const category = pathCategory(path);
      addSurface(path, {
        role:
          category === "test"
            ? "likely_test"
            : category === "docs"
              ? "docs_contract"
              : isCriticalSurfacePath(path)
                ? "critical_surface"
                : "downstream_surface",
        reason: String(impact?.reason || "graph-derived surface"),
        inputPath,
        kind: isNonEmptyString(impact?.kind) ? impact.kind : null
      });
    }
  }

  for (const hint of Array.isArray(graphImpact?.missing_update_hints) ? graphImpact.missing_update_hints : []) {
    const inputPath = isNonEmptyString(hint?.input_path) ? hint.input_path : null;
    const reason = String(hint?.reason || "graph-derived missing update hint");
    const kind = isNonEmptyString(hint?.kind) ? hint.kind : null;
    const role =
      hint?.missing_surface === "docs_contract"
        ? "docs_contract"
        : hint?.missing_surface === "test"
          ? "likely_test"
          : "downstream_surface";
    for (const path of sortStrings(hint?.suggested_paths)) {
      addSurface(path, {
        role,
        reason,
        inputPath,
        kind
      });
    }
  }

  for (const overlap of sortStrings(
    Array.isArray(graphImpact?.open_write_scope_overlaps)
      ? graphImpact.open_write_scope_overlaps.map((entry) => (isObject(entry) ? entry.path : entry))
      : Array.isArray(graphImpact?.write_scope_overlaps)
        ? graphImpact.write_scope_overlaps.map((entry) => (isObject(entry) ? entry.path : entry))
        : []
  )) {
    addSurface(overlap, {
      role: "open_write_scope_overlap",
      reason: "open write-scope overlap",
      kind: "write_scope_overlap"
    });
  }

  return uniqueBy(entries, (entry) =>
    [entry.path, entry.role, entry.source, entry.input_path ?? "", entry.kind ?? "", entry.reason].join("|")
  ).sort((left, right) =>
    String(left.path).localeCompare(String(right.path)) ||
    String(left.role).localeCompare(String(right.role)) ||
    String(left.source).localeCompare(String(right.source)) ||
    String(left.input_path ?? "").localeCompare(String(right.input_path ?? "")) ||
    String(left.reason).localeCompare(String(right.reason))
  );
}

function collectMissingUpdateHintCount(graphEntries, graphImpact) {
  const hintedPaths = new Set();
  for (const entry of Array.isArray(graphEntries) ? graphEntries : []) {
    if (entry.source !== "sidecar_graph_impact") {
      continue;
    }
    if (entry.role !== "likely_test" && entry.role !== "docs_contract") {
      continue;
    }
    hintedPaths.add(`${entry.path}|${entry.input_path ?? ""}`);
  }

  for (const hint of Array.isArray(graphImpact?.missing_update_hints) ? graphImpact.missing_update_hints : []) {
    const inputPath = isNonEmptyString(hint?.input_path) ? hint.input_path : "";
    for (const path of sortStrings(hint?.suggested_paths)) {
      hintedPaths.add(`${path}|${inputPath}`);
    }
  }

  return hintedPaths.size;
}

function countFilesByCategory(fileEntries) {
  const counts = {
    implementation: 0,
    test: 0,
    docs: 0,
    wiki: 0,
    cli: 0,
    mcp: 0,
    launcher: 0,
    node_engine: 0
  };

  for (const path of uniqueBy(fileEntries, (entry) => entry.path).map((entry) => entry.path)) {
    const category = pathCategory(path);
    if (category in counts) {
      counts[category] += 1;
    }
  }

  return counts;
}

function buildFanoutByInputPath(graphEntries) {
  const byInputPath = new Map();
  for (const entry of Array.isArray(graphEntries) ? graphEntries : []) {
    if (!isNonEmptyString(entry.input_path)) {
      continue;
    }
    if (!byInputPath.has(entry.input_path)) {
      byInputPath.set(entry.input_path, {
        input_path: entry.input_path,
        downstream_surface_paths: new Set(),
        missing_update_hint_paths: new Set()
      });
    }
    const bucket = byInputPath.get(entry.input_path);
    if (entry.role === "downstream_surface") {
      bucket.downstream_surface_paths.add(entry.path);
    }
    if (entry.role === "open_write_scope_overlap") {
      bucket.downstream_surface_paths.add(entry.path);
    }
    if (entry.role === "likely_test" || entry.role === "docs_contract") {
      bucket.missing_update_hint_paths.add(entry.path);
    }
  }

  return [...byInputPath.values()]
    .map((entry) => ({
      input_path: entry.input_path,
      downstream_surface_count: entry.downstream_surface_paths.size,
      missing_update_hint_count: entry.missing_update_hint_paths.size
    }))
    .sort((left, right) => left.input_path.localeCompare(right.input_path));
}

function collectCriticalSurfaceCount(fileEntries) {
  return uniqueBy(
    fileEntries.filter((entry) => isCriticalSurfacePath(entry.path)),
    (entry) => entry.path
  ).length;
}

function collectOpenWriteScopeOverlapCount(fileEntries) {
  return uniqueBy(
    fileEntries.filter((entry) => entry.role === "open_write_scope_overlap"),
    (entry) => entry.path
  ).length;
}

function collectGraphDerivedFileCount(fileEntries) {
  return uniqueBy(
    fileEntries.filter((entry) => entry.source === "sidecar_graph_impact"),
    (entry) => `${entry.path}|${entry.role}|${entry.input_path ?? ""}|${entry.kind ?? ""}`
  ).length;
}

function collectDownstreamSurfaceCount(fileEntries) {
  return uniqueBy(
    fileEntries.filter(
      (entry) =>
        entry.source === "sidecar_graph_impact" &&
        (entry.role === "downstream_surface" || entry.role === "open_write_scope_overlap")
    ),
    (entry) => `${entry.path}|${entry.input_path ?? ""}`
  ).length;
}

function collectFanoutMax(fileEntries) {
  return buildFanoutByInputPath(fileEntries).reduce(
    (max, entry) => Math.max(max, entry.downstream_surface_count),
    0
  );
}

function computeTestToImplRatio(fileEntries) {
  const counts = countFilesByCategory(fileEntries);
  if (counts.implementation === 0) {
    return counts.test;
  }
  return Number((counts.test / counts.implementation).toFixed(2));
}

export function evaluateAtomicity({
  dispatchReadiness,
  graphImpact,
  fileEntries
}) {
  const clusters = Array.isArray(dispatchReadiness.clusters) ? dispatchReadiness.clusters : [];
  const graphState = isObject(graphImpact?.graph_state)
    ? graphImpact.graph_state
    : isObject(dispatchReadiness.state?.graph_state)
      ? dispatchReadiness.state.graph_state
      : {
          graph_available: false,
          edge_source: "unavailable",
          dirty_graph_mode: "unavailable",
          unavailable_paths: []
        };
  const graphAvailable = Boolean(graphState.graph_available);

  return {
    decision: "allow",
    decision_codes: [],
    metrics: {
      cluster_count: clusters.length,
      declared_file_count: uniqueBy(
        fileEntries.filter((entry) => entry.source === "work_record"),
        (entry) => entry.path
      ).length,
      direct_write_scope_count: uniqueBy(
        fileEntries.filter((entry) => entry.source === "work_record" && entry.role === "declared_scope"),
        (entry) => entry.path
      ).length,
      graph_derived_file_count: collectGraphDerivedFileCount(fileEntries),
      downstream_surface_count: collectDownstreamSurfaceCount(fileEntries),
      missing_update_hint_count: collectMissingUpdateHintCount(fileEntries, graphImpact),
      critical_surface_count: collectCriticalSurfaceCount(fileEntries),
      open_write_scope_overlap_count: collectOpenWriteScopeOverlapCount(fileEntries),
      max_fanout: collectFanoutMax(fileEntries),
      fanout_by_input_path: buildFanoutByInputPath(fileEntries),
      surface_type_counts: countFilesByCategory(fileEntries),
      test_to_impl_ratio: computeTestToImplRatio(fileEntries),
      graph_quality: {
        graph_available: graphAvailable,
        dirty_state: graphImpact?.dirty_state ?? dispatchReadiness.state?.dirty_state ?? "unknown",
        staleness: graphImpact?.staleness ?? dispatchReadiness.state?.staleness ?? "unknown",
        edge_source: graphState.edge_source ?? "unavailable",
        dirty_graph_mode: graphState.dirty_graph_mode ?? "unavailable",
        unavailable_path_count: Array.isArray(graphState.unavailable_paths)
          ? graphState.unavailable_paths.length
          : 0
      }
    }
  };
}
