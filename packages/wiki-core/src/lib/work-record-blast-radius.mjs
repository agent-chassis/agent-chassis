import { getSidecarGraphImpactPaths } from "./sidecar-graph-impact.mjs";
import { matchSidecarPathPattern } from "./sidecar-paths.mjs";
import { mergeReadScopeRefs } from "./work-record-schema.mjs";
import {
  buildPolicyContext,
  evaluateWorkRecordPolicy
} from "./work-record-policy.mjs";

const HIGH_SURFACE_PATTERNS = Object.freeze([
  { pattern: "packages/wiki-cli/src/**", reason: "shared CLI surface" },
  { pattern: "packages/wiki-mcp/src/**", reason: "shared MCP surface" },
  { pattern: "packages/wiki-core/src/lib/sidecar-*.mjs", reason: "repo-code-index contract" }
]);

const CRITICAL_SURFACE_PATTERNS = Object.freeze([
  { pattern: "docs/agent-blackboard-protocol.md", reason: "authority-bearing launch protocol" },
  { pattern: "docs/agent-launch-quickstart.md", reason: "authority-bearing launch protocol" },
  { pattern: "packages/agent-launch-cli/**", reason: "authority-bearing launch surface" },
  { pattern: "packages/agent-launch-core/**", reason: "authority-bearing launch surface" }
]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function uniqueBy(values, keyFn) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const key = keyFn(value);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(value);
  }
  return result;
}

export function maxBlastRadiusLevel(levels) {
  const order = new Map([
    ["low", 0],
    ["medium", 1],
    ["high", 2],
    ["critical", 3]
  ]);
  return [...levels].sort((left, right) => order.get(left) - order.get(right)).at(-1) || "low";
}

export function collectBlastRadiusReasons(pathEntries, clusterCount, { graphAvailable }) {
  const reasons = [];
  let level = "low";
  const allPaths = pathEntries.map((entry) => entry.relative_path);

  if (!graphAvailable) {
    reasons.push("graph evidence unavailable; using path-family fallback");
  }

  const criticalReason = CRITICAL_SURFACE_PATTERNS.find(({ pattern }) =>
    allPaths.some((entryPath) => matchSidecarPathPattern(pattern, entryPath))
  );
  if (criticalReason) {
    reasons.push(criticalReason.reason);
    level = "critical";
  }

  const highReasons = HIGH_SURFACE_PATTERNS.filter(({ pattern }) =>
    allPaths.some((entryPath) => matchSidecarPathPattern(pattern, entryPath))
  ).map(({ reason }) => reason);
  reasons.push(...highReasons);
  if (highReasons.length > 0 && level !== "critical") {
    level = "high";
  }

  const implementationCount = pathEntries.filter((entry) => entry.kind === "implementation_path").length;
  const testCount = pathEntries.filter((entry) => entry.kind === "test_path").length;
  const docsCount = pathEntries.filter((entry) => entry.kind === "docs_contract").length;

  if (level === "low" && docsCount > 0 && implementationCount === 0 && testCount === 0) {
    reasons.push("single docs/wiki/design surface");
  } else if (level === "low" && implementationCount === 1 && testCount <= 1) {
    reasons.push("single explicit file with focused validation");
  } else if (level === "low" && implementationCount > 1) {
    level = "medium";
    reasons.push("one implementation cluster with multiple files");
  }

  if (level === "low" && clusterCount > 1) {
    level = "medium";
    reasons.push("multiple implementation clusters");
  }

  if (level === "low" && (implementationCount > 0 || testCount > 0) && docsCount === 0) {
    reasons.push("implementation surface without shared runtime indicators");
  }

  if (level === "low" && reasons.length === 0) {
    reasons.push("bounded implementation surface");
  }

  return {
    level,
    reasons: [...new Set(reasons)]
  };
}

function normalizeMarkdownScopeList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => String(entry ?? "").trim())
    .filter((entry) => entry.length > 0);
}

function createBlastRadiusFileEntry(entry) {
  return {
    path: entry.path,
    role: entry.role,
    source: entry.source,
    reason: entry.reason,
    ...(entry.action ? { action: entry.action } : {}),
    ...(entry.kind ? { kind: entry.kind } : {}),
    ...(entry.input_path ? { input_path: entry.input_path } : {}),
    ...(entry.source_field ? { source_field: entry.source_field } : {})
  };
}

function addBlastRadiusFileEntry(entries, entry) {
  if (!entry || typeof entry.path !== "string" || entry.path.trim().length === 0) {
    return;
  }

  entries.push(createBlastRadiusFileEntry(entry));
}

function roleForMarkdownScopePath(sourceField) {
  if (sourceField === "docs") {
    return "declared_docs";
  }
  if (sourceField === "related") {
    return "canonical_ref";
  }
  return "declared_scope";
}

function roleForGraphImpactEntry(entry, path) {
  if (entry?.kind === "covering_test" || path.startsWith("tests/") || path.includes(".test.")) {
    return "likely_test";
  }
  if (entry?.kind === "docs_contract" || path.startsWith("docs/")) {
    return "docs_contract";
  }
  if (entry?.kind === "downstream_cli_command" || entry?.kind === "downstream_mcp_tool") {
    return "downstream_surface";
  }
  if (entry?.kind === "check_downstream_surface") {
    if (path.startsWith("tests/") || path.includes(".test.")) {
      return "check_this_test";
    }
    if (path.startsWith("docs/")) {
      return "check_this_docs";
    }
    return "check_this_surface";
  }
  if (entry?.kind === "schema_field_contract") {
    return "schema_contract";
  }
  if (entry?.kind === "work_scope_owner") {
    return "scope_owner";
  }
  return "affected_code";
}

function roleForGraphHintEntry(hint) {
  if (hint?.missing_surface === "test") {
    return "check_this_test";
  }
  if (hint?.missing_surface === "docs_contract") {
    return "check_this_docs";
  }
  return "check_this_surface";
}

function countBlastRadiusFiles(fileEntries) {
  const uniquePaths = new Map();
  for (const entry of fileEntries) {
    if (!entry || typeof entry.path !== "string" || entry.path.trim().length === 0) {
      continue;
    }
    if (!uniquePaths.has(entry.path)) {
      uniquePaths.set(entry.path, entry);
    }
  }

  const counts = {
    file_count: uniquePaths.size,
    implementation_file_count: 0,
    test_file_count: 0,
    docs_file_count: 0,
    downstream_surface_count: 0
  };

  for (const entry of uniquePaths.values()) {
    if (entry.path.startsWith("docs/")) {
      counts.docs_file_count += 1;
    } else if (entry.path.startsWith("tests/") || entry.path.includes(".test.")) {
      counts.test_file_count += 1;
    } else {
      counts.implementation_file_count += 1;
    }

    if (
      entry.role === "downstream_surface" ||
      entry.role === "check_this_surface" ||
      entry.kind === "downstream_cli_command" ||
      entry.kind === "downstream_mcp_tool"
    ) {
      counts.downstream_surface_count += 1;
    }
  }

  return counts;
}

function collectBlastRadiusFilesFromMarkdownScope(pathEntries) {
  const entries = [];
  for (const entry of pathEntries) {
    addBlastRadiusFileEntry(entries, {
      path: entry.relative_path,
      role: roleForMarkdownScopePath(entry.source_field),
      source: "markdown_frontmatter",
      reason:
        entry.source_field === "docs"
          ? "declared docs scope"
          : entry.source_field === "repo_paths"
            ? "declared repository path scope"
            : entry.source_field === "write_scope"
              ? "declared write scope"
              : "declared related reference",
      source_field: entry.source_field
    });
  }
  return entries;
}

function collectBlastRadiusFilesFromGraphImpact(graphImpact) {
  const entries = [];
  const graphState = isObject(graphImpact?.graph_state) ? graphImpact.graph_state : null;
  const graphAvailable = Boolean(graphState?.graph_available);
  if (!graphAvailable) {
    return entries;
  }

  const summaryActionItems = graphImpact?.summary?.derived_evidence?.action_items;
  if (isObject(summaryActionItems)) {
    for (const item of [
      ...(Array.isArray(summaryActionItems.must_update) ? summaryActionItems.must_update : []),
      ...(Array.isArray(summaryActionItems.check_this) ? summaryActionItems.check_this : [])
    ]) {
      const reason = String(item?.reason ?? "").trim() || "graph-derived surface";
      const action = typeof item?.action === "string" ? item.action : null;
      const kind = typeof item?.kind === "string" ? item.kind : null;
      const inputPath = typeof item?.input_path === "string" ? item.input_path : null;
      const paths = [];
      if (typeof item?.path === "string" && item.path.trim().length > 0) {
        paths.push(item.path);
      }
      if (Array.isArray(item?.suggested_paths)) {
        for (const suggestedPath of item.suggested_paths) {
          if (typeof suggestedPath === "string" && suggestedPath.trim().length > 0) {
            paths.push(suggestedPath);
          }
        }
      }
      for (const path of paths) {
        addBlastRadiusFileEntry(entries, {
          path,
          role: roleForGraphImpactEntry({ kind, action }, path),
          source: "sidecar_graph_impact",
          reason,
          ...(action ? { action } : {}),
          ...(kind ? { kind } : {}),
          ...(inputPath ? { input_path: inputPath } : {})
        });
      }
    }
    return entries;
  }

  const nodesById = new Map(
    (Array.isArray(graphImpact?.graph_nodes) ? graphImpact.graph_nodes : []).map((node) => [node.id, node])
  );

  for (const impact of Array.isArray(graphImpact?.structural_impacts) ? graphImpact.structural_impacts : []) {
    const inputPath = String(impact?.input_path ?? "").trim();
    const paths = [];
    for (const nodeId of Array.isArray(impact?.node_ids) ? impact.node_ids : []) {
      const node = nodesById.get(nodeId);
      const path = String(node?.path ?? "").trim();
      if (!path || path === inputPath) {
        continue;
      }
      paths.push(path);
    }
    const role = roleForGraphImpactEntry(impact, inputPath);
    for (const path of uniqueBy(paths, (value) => value)) {
      addBlastRadiusFileEntry(entries, {
        path,
        role,
        source: "sidecar_graph_impact",
        reason: String(impact?.reason ?? "graph-derived surface"),
        kind: typeof impact?.kind === "string" ? impact.kind : null,
        ...(inputPath ? { input_path: inputPath } : {})
      });
    }
  }

  for (const hint of Array.isArray(graphImpact?.missing_update_hints) ? graphImpact.missing_update_hints : []) {
    const inputPath = String(hint?.input_path ?? "").trim();
    const role = roleForGraphHintEntry(hint);
    const reason = String(hint?.reason ?? "graph-derived missing update hint");
    for (const suggestedPath of Array.isArray(hint?.suggested_paths) ? hint.suggested_paths : []) {
      if (typeof suggestedPath !== "string" || suggestedPath.trim().length === 0) {
        continue;
      }
      addBlastRadiusFileEntry(entries, {
        path: suggestedPath,
        role,
        source: "sidecar_graph_impact",
        reason,
        kind: typeof hint?.kind === "string" ? hint.kind : null,
        ...(inputPath ? { input_path: inputPath } : {})
      });
    }
  }

  return entries;
}

function sortBlastRadiusFiles(entries) {
  return uniqueBy(entries, (entry) =>
    [entry.path, entry.role, entry.source, entry.action ?? "", entry.kind ?? "", entry.input_path ?? "", entry.reason ?? ""].join("|")
  ).sort((left, right) => {
    const pathComparison = String(left.path).localeCompare(String(right.path));
    if (pathComparison !== 0) {
      return pathComparison;
    }
    const roleComparison = String(left.role).localeCompare(String(right.role));
    if (roleComparison !== 0) {
      return roleComparison;
    }
    const sourceComparison = String(left.source).localeCompare(String(right.source));
    if (sourceComparison !== 0) {
      return sourceComparison;
    }
    const actionComparison = String(left.action ?? "").localeCompare(String(right.action ?? ""));
    if (actionComparison !== 0) {
      return actionComparison;
    }
    const kindComparison = String(left.kind ?? "").localeCompare(String(right.kind ?? ""));
    if (kindComparison !== 0) {
      return kindComparison;
    }
    const inputPathComparison = String(left.input_path ?? "").localeCompare(String(right.input_path ?? ""));
    if (inputPathComparison !== 0) {
      return inputPathComparison;
    }
    return String(left.reason ?? "").localeCompare(String(right.reason ?? ""));
  });
}

function createMarkdownGraphProvenance({
  graphImpact = null,
  graphInputPaths = [],
  graphAvailable = false
} = {}) {
  const graphState = isObject(graphImpact?.graph_state) ? graphImpact.graph_state : null;
  const provenance = {
    dirty_state: graphImpact?.dirty_state ?? "unknown",
    staleness: graphImpact?.staleness ?? "unknown",
    graph_available: Boolean(graphAvailable || graphState?.graph_available),
    edge_source: graphState?.edge_source ?? "unavailable",
    dirty_graph_mode: graphState?.dirty_graph_mode ?? "unavailable"
  };

  if (graphState?.graph_schema_version != null) {
    provenance.graph_schema_version = graphState.graph_schema_version;
  }
  if (graphState?.status_reason != null) {
    provenance.status_reason = graphState.status_reason;
  }
  if (Array.isArray(graphInputPaths) && graphInputPaths.length > 0) {
    provenance.input_paths = [...new Set(graphInputPaths)].sort((left, right) =>
      left.localeCompare(right)
    );
  }

  return provenance;
}

export function classifyWorkRecordBlastRadius(record, clustersOrOptions = [], maybeOptions = {}) {
  const clusters = Array.isArray(clustersOrOptions) ? clustersOrOptions : [];
  const options = Array.isArray(clustersOrOptions) ? maybeOptions : clustersOrOptions;
  const context = buildPolicyContext(record, options);
  const blastRadius = collectBlastRadiusReasons(context.path_entries, clusters.length, {
    graphAvailable: context.state.graph_available
  });

  return {
    level: blastRadius.level,
    reasons: blastRadius.reasons,
    accepted_escalation_id: null
  };
}

export async function deriveMarkdownBlastRadiusEvidence(
  record,
  {
    dir = ".",
    graphImpactProvider = getSidecarGraphImpactPaths
  } = {}
) {
  if (!isObject(record)) {
    throw new TypeError("work record markdown blast radius requires a record object");
  }

  const docs = normalizeMarkdownScopeList(mergeReadScopeRefs(record));
  const repoPaths = normalizeMarkdownScopeList(record.repo_paths);
  const writeScope = normalizeMarkdownScopeList(record.write_scope);
  const related = normalizeMarkdownScopeList(record.related);
  const structuredEvidenceCount =
    docs.length + repoPaths.length + writeScope.length + related.length;
  const scopePaths = [...new Set([...docs, ...repoPaths, ...writeScope])].sort((left, right) =>
    left.localeCompare(right)
  );

  if (structuredEvidenceCount === 0) {
    return {
      level: "unknown",
      reasons: [
        "missing structured scope evidence in markdown frontmatter (docs, repo_paths, write_scope, or related)"
      ],
      source: "markdown_frontmatter",
      dispatch_authority: "informational",
      status: "needs_review",
      graph_provenance: createMarkdownGraphProvenance({
        graphAvailable: false
      })
    };
  }

  let graphImpact = null;
  if (scopePaths.length > 0 && typeof graphImpactProvider === "function") {
    try {
      graphImpact = await graphImpactProvider({
        dir,
        paths: scopePaths
      });
    } catch {
      graphImpact = null;
    }
  }

  const graphAvailable = Boolean(graphImpact?.graph_state?.graph_available);
  const graphProvenance = createMarkdownGraphProvenance({
    graphImpact,
    graphInputPaths: scopePaths,
    graphAvailable
  });
  const markdownRecord = {
    id: String(record.id ?? ""),
    docs,
    repo_paths: repoPaths,
    write_scope: writeScope,
    related
  };
  const policy = evaluateWorkRecordPolicy(markdownRecord, {
    graph_state: {
      graph_available: graphAvailable,
      dirty_state: graphImpact?.dirty_state ?? "unknown",
      staleness: graphImpact?.staleness ?? "unknown",
      edge_source: graphImpact?.graph_state?.edge_source ?? "unavailable",
      dirty_graph_mode: graphImpact?.graph_state?.dirty_graph_mode ?? "unavailable",
      graph_schema_version: graphImpact?.graph_state?.graph_schema_version ?? null,
      status_reason: graphImpact?.graph_state?.status_reason ?? null
    }
  });
  const fileEntries = sortBlastRadiusFiles([
    ...collectBlastRadiusFilesFromMarkdownScope(
      buildPolicyContext(markdownRecord, {
        graph_state: {
          graph_available: graphAvailable,
          dirty_state: graphImpact?.dirty_state ?? "unknown",
          staleness: graphImpact?.staleness ?? "unknown",
          edge_source: graphImpact?.graph_state?.edge_source ?? "unavailable",
          dirty_graph_mode: graphImpact?.graph_state?.dirty_graph_mode ?? "unavailable",
          graph_schema_version: graphImpact?.graph_state?.graph_schema_version ?? null,
          status_reason: graphImpact?.graph_state?.status_reason ?? null
        }
      }).path_entries
    ),
    ...collectBlastRadiusFilesFromGraphImpact(graphImpact)
  ]);

  if (graphAvailable) {
    return {
      level: policy.blast_radius.level,
      reasons: policy.blast_radius.reasons,
      source: "markdown_frontmatter",
      dispatch_authority: "informational",
      status: "derived",
      files: fileEntries,
      atomicity: countBlastRadiusFiles(fileEntries),
      graph_provenance: graphProvenance
    };
  }

  return {
    level: policy.blast_radius.level,
    reasons: [
      "graph evidence unavailable; using path-family fallback",
      ...policy.blast_radius.reasons.filter(
        (reason) => reason !== "graph evidence unavailable; using path-family fallback"
      )
    ],
    source: "markdown_frontmatter",
    dispatch_authority: "informational",
    status: "derived",
    files: fileEntries,
    atomicity: countBlastRadiusFiles(fileEntries),
    graph_provenance: graphProvenance
  };
}
