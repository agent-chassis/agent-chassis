

import { z } from "zod";
import {
  buildSidecarIndex,
  getSidecarContextForPath,
  getSidecarGraphImpactDiff,
  getSidecarImpactPaths,
  getSidecarIndexStatus
} from "@agent-chassis/wiki-core";
import { getSidecarGraphImpactPaths } from "@agent-chassis/wiki-core/src/lib/sidecar-graph-impact.mjs";
import {
  getSidecarSymbolCallers,
  getSidecarSymbolCallees,
  getSidecarSymbolDefinition,
  getSidecarSymbolReferences,
  projectSidecarSymbolQueryForMcp
} from "@agent-chassis/wiki-core/src/lib/sidecar-symbol-query.mjs";
import {
  compactGraphImpactSummaryAffectedSurfaces,
  createBoundedGraphImpactResponse,
  normalizeGraphImpactPathList
} from "./graph-impact-response-boundary.mjs";
import { resolveWorkspaceRepo } from "./workspace-repo-resolution.mjs";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function cloneJsonSerializable(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    const seen = new WeakSet();
    return JSON.parse(
      JSON.stringify(value, (key, entry) => {
        if (entry !== null && typeof entry === "object") {
          if (seen.has(entry)) {
            return "[Circular]";
          }
          seen.add(entry);
        }
        return entry;
      })
    );
  }
}

const GRAPH_IMPACT_VERBOSE_NEXT_ACTION =
  "Re-call this tool with verbose:true to inspect suppressed graph-impact detail";

function graphImpactResponseSuppressesDetail({
  bounded,
  verboseFields,
  includeDerivedEvidence,
  rawGraphImpact,
  result
}) {
  return Boolean(
    isPlainObject(bounded?.graph_impact) ||
      Object.keys(verboseFields ?? {}).length > 0 ||
      (includeDerivedEvidence && result?.derived_evidence) ||
      rawGraphImpact
  );
}

function omitCompactContextForPathEcho(result, verbose) {
  if (verbose || !isPlainObject(result) || !("context" in result)) {
    return result;
  }
  const { context, ...rest } = result;
  return rest;
}

export function createGraphImpactToolResponse({
  workspaceRepo,
  result,
  graphImpact = null,
  verbose = false,
  graphImpactSummaryRef = null,
  compactFields = {},
  verboseFields = {},
  includeDerivedEvidence = false,
  rawGraphImpact = null
}) {
  const compactGraphImpact = graphImpact ?? result;
  const bounded = createBoundedGraphImpactResponse(compactGraphImpact, { graphImpactSummaryRef });
  const response = {
    workspaceRepo,
    query_kind: bounded.graph_impact.query_kind ?? compactGraphImpact?.query_kind ?? result?.query_kind ?? null,
    verbose: Boolean(verbose),
    graph_impact_summary: verbose
      ? bounded.graph_impact_summary
      : compactGraphImpactSummaryAffectedSurfaces(bounded.graph_impact_summary),
    ...(bounded.graph_impact_summary_ref ? { graph_impact_summary_ref: bounded.graph_impact_summary_ref } : {}),
    ...compactFields
  };

  if (verbose) {
    response.graph_impact = bounded.graph_impact;
    Object.assign(response, verboseFields);
    response.graph_impact_raw = rawGraphImpact ?? compactGraphImpact ?? result;
    if (includeDerivedEvidence && result?.derived_evidence) {
      response.derived_evidence = result.derived_evidence;
    }

    return cloneJsonSerializable(response);
  }

  if (
    graphImpactResponseSuppressesDetail({ bounded, verboseFields, includeDerivedEvidence, rawGraphImpact, result })
  ) {
    response.detail_available = true;
    if (!response.next_action) {
      response.next_action = GRAPH_IMPACT_VERBOSE_NEXT_ACTION;
    }
  }

  return response;
}

function createCompactCodeIndexImpactPathsSummary(summary) {
  if (!isPlainObject(summary)) {
    return summary;
  }

  return {
    schema_version: summary.schema_version ?? null,
    kind: summary.kind ?? null,
    query_kind: summary.query_kind ?? null,
    record_id: summary.record_id ?? null,
    slice_id: summary.slice_id ?? null,
    unit: summary.unit ?? null,
    source_record_digest: summary.source_record_digest ?? null,
    graph_quality: summary.graph_quality ?? null,
    warning_counts: summary.warning_counts ?? null,
    counts: summary.counts ?? null
  };
}

const COMPACT_CODE_INDEX_PATH_HINT_LIMIT = 5;

function createCompactCodeIndexPathHints(values) {
  return normalizeGraphImpactPathList(values).slice(0, COMPACT_CODE_INDEX_PATH_HINT_LIMIT);
}

function createCompactCodeIndexImpactPathsResponse(workspaceRepo, result, verbose = false) {
  const bounded = createBoundedGraphImpactResponse(result, {
    lightweightRef: !verbose
  });
  const relatedCodePaths = normalizeGraphImpactPathList(result?.related_code_paths);
  const likelyTests = normalizeGraphImpactPathList(result?.likely_tests);
  const response = {
    workspaceRepo,
    query_kind: bounded.graph_impact_summary?.query_kind ?? result?.query_kind ?? "impact_paths",
    verbose: Boolean(verbose),
    graph_impact_summary: createCompactCodeIndexImpactPathsSummary(bounded.graph_impact_summary),
    ...(bounded.graph_impact_summary_ref ? { graph_impact_summary_ref: bounded.graph_impact_summary_ref } : {}),

    index_head: result?.index_head ?? null,
    artifact_exists: result?.artifact_exists ?? false,
    status_reason: result?.status_reason ?? null,
    overlay_state: result?.overlay_state ?? null,
    derived_evidence_count: Array.isArray(result?.derived_evidence) ? result.derived_evidence.length : 0,
    related_code_path_count: relatedCodePaths.length,
    likely_test_count: likelyTests.length
  };

  const compactRelatedCodePaths = createCompactCodeIndexPathHints(relatedCodePaths);
  const compactLikelyTests = createCompactCodeIndexPathHints(likelyTests);

  if (compactRelatedCodePaths.length > 0) {
    response.related_code_paths = compactRelatedCodePaths;
  }
  if (compactLikelyTests.length > 0) {
    response.likely_tests = compactLikelyTests;
  }

  if (verbose) {
    response.graph_impact = bounded.graph_impact;
    response.graph_impact_raw = cloneJson(result);
    response.input_paths = Array.isArray(result?.input_paths) ? cloneJson(result.input_paths) : [];
    response.validated_paths = Array.isArray(result?.validated_paths) ? cloneJson(result.validated_paths) : [];
    response.invalid_paths = Array.isArray(result?.invalid_paths) ? cloneJson(result.invalid_paths) : [];
    response.validation_hints = Array.isArray(result?.validation_hints) ? cloneJson(result.validation_hints) : [];
    response.canonical_refs = Array.isArray(result?.canonical_refs) ? cloneJson(result.canonical_refs) : [];
    response.derived_evidence = Array.isArray(result?.derived_evidence) ? cloneJson(result.derived_evidence) : [];
    response.related_code_paths = Array.isArray(result?.related_code_paths) ? cloneJson(result.related_code_paths) : [];
    response.related_code_paths_by_path = isPlainObject(result?.related_code_paths_by_path)
      ? cloneJson(result.related_code_paths_by_path)
      : {};
    response.likely_tests = Array.isArray(result?.likely_tests) ? cloneJson(result.likely_tests) : [];
    response.likely_tests_by_path = isPlainObject(result?.likely_tests_by_path)
      ? cloneJson(result.likely_tests_by_path)
      : {};
    response.source_entries = Array.isArray(result?.source_entries) ? cloneJson(result.source_entries) : [];
    response.artifact_path = result?.artifact_path ?? null;
    response.cache_path = result?.cache_path ?? null;
    response.overlay_source_count = result?.overlay_source_count ?? null;
    response.dirty_details = result?.dirty_details ?? null;
    response.graph_state = result?.graph_state ?? null;
  }

  return response;
}

function createCompactCodeIndexStatusResponse(workspaceRepo, result) {
  return {
    workspaceRepo,
    dirty_state: result?.dirty_state ?? "unknown",
    staleness: result?.staleness ?? "unknown",
    artifact_exists: result?.artifact_exists ?? false,
    status_reason: result?.status_reason ?? null,
    index_head: result?.index_head ?? null,
    graph_available: result?.graph_state?.graph_available === true
  };
}

function createWorkspaceCodeIndexSymbolResponse(workspaceRepo, result, verbose = false) {
  return {
    workspaceRepo,
    ...projectSidecarSymbolQueryForMcp(result, { verbose })
  };
}

export function registerCodeIndexTools({ registerTool, workspaceRepos, jsonContent, errorContent }) {
  registerTool(
    "sidecar_build",
    {
      description:
        "Explicitly build the sidecar code index, writing generated artifacts only to an ignored cache path.",
      inputSchema: {
        dir: z.string(),
        cacheDir: z.string().optional()
      }
    },
    async (args) => {
      try {
        return jsonContent(await buildSidecarIndex(args));
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "workspace_sidecar_build",
    {
      description:
        "Explicitly build the sidecar code index for a configured workspace repository, writing generated artifacts only to an ignored cache path.",
      inputSchema: {
        repo: z.string().optional(),
        cacheDir: z.string().optional()
      }
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        const result = await buildSidecarIndex({
          ...args,
          dir: workspace.dir
        });
        return jsonContent({ workspaceRepo: workspace.repo, ...result });
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "workspace_code_index_build",
    {
      description:
        "Explicitly build the repo code index for a configured workspace repository, writing generated artifacts only to an ignored cache path.",
      inputSchema: {
        repo: z.string().optional(),
        cacheDir: z.string().optional()
      }
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        const result = await buildSidecarIndex({
          ...args,
          dir: workspace.dir
        });
        return jsonContent({ workspaceRepo: workspace.repo, ...result });
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "sidecar_rebuild",
    {
      description:
        "Explicitly rebuild the sidecar code index, writing generated artifacts only to an ignored cache path.",
      inputSchema: {
        dir: z.string(),
        cacheDir: z.string().optional()
      }
    },
    async (args) => {
      try {
        return jsonContent(await buildSidecarIndex({ ...args, rebuild: true }));
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "workspace_sidecar_rebuild",
    {
      description:
        "Explicitly rebuild the sidecar code index for a configured workspace repository, writing generated artifacts only to an ignored cache path.",
      inputSchema: {
        repo: z.string().optional(),
        cacheDir: z.string().optional()
      }
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        const result = await buildSidecarIndex({
          ...args,
          dir: workspace.dir,
          rebuild: true
        });
        return jsonContent({ workspaceRepo: workspace.repo, ...result });
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "workspace_code_index_rebuild",
    {
      description:
        "Explicitly rebuild the repo code index for a configured workspace repository, writing generated artifacts only to an ignored cache path.",
      inputSchema: {
        repo: z.string().optional(),
        cacheDir: z.string().optional()
      }
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        const result = await buildSidecarIndex({
          ...args,
          dir: workspace.dir,
          rebuild: true
        });
        return jsonContent({ workspaceRepo: workspace.repo, ...result });
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "sidecar_status",
    {
      description:
        "Report read-only sidecar code index status without building or rebuilding the index.",
      inputSchema: {
        dir: z.string(),
        cacheDir: z.string().optional()
      }
    },
    async (args) => {
      try {
        return jsonContent(await getSidecarIndexStatus(args));
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "workspace_sidecar_status",
    {
      description:
        "Report read-only sidecar code index status for a configured workspace repository without building or rebuilding the index.",
      inputSchema: {
        repo: z.string().optional(),
        cacheDir: z.string().optional()
      }
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        const result = await getSidecarIndexStatus({
          ...args,
          dir: workspace.dir
        });
        return jsonContent({ workspaceRepo: workspace.repo, ...result });
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "workspace_code_index_status",
    {
      description:
        "Report read-only repo code index status for a configured workspace repository without building or rebuilding the index. Compact by default; pass verbose:true for the full derived evidence, graph state, and artifact paths.",
      inputSchema: {
        repo: z.string().optional(),
        cacheDir: z.string().optional(),
        verbose: z.boolean().optional()
      }
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        const result = await getSidecarIndexStatus({
          ...args,
          dir: workspace.dir
        });
        if (args.verbose === true) {
          return jsonContent({ workspaceRepo: workspace.repo, ...result });
        }
        return jsonContent(createCompactCodeIndexStatusResponse(workspace.repo, result));
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "sidecar_impact_paths",
    {
      description:
        "Return read-only sidecar impact context for one or more repository-relative paths.",
      inputSchema: {
        dir: z.string(),
        paths: z.array(z.string()),
        cacheDir: z.string().optional(),
        includeSuppressed: z.boolean().optional()
      }
    },
    async (args) => {
      try {
        return jsonContent(await getSidecarImpactPaths(args));
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "workspace_sidecar_impact_paths",
    {
      description:
        "Return read-only sidecar impact context for repository-relative paths in a configured workspace repository.",
      inputSchema: {
        repo: z.string().optional(),
        paths: z.array(z.string()),
        cacheDir: z.string().optional(),
        includeSuppressed: z.boolean().optional()
      }
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        const result = await getSidecarImpactPaths({
          ...args,
          dir: workspace.dir
        });
        return jsonContent({ workspaceRepo: workspace.repo, ...result });
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "workspace_code_index_impact_paths",
    {
      description:
        "Return read-only repo code index impact context for repository-relative paths in a configured workspace repository. Compact, decision-oriented default with bounded related code paths and likely tests; pass verbose:true for the full derived evidence and debug details.",
      inputSchema: {
        repo: z.string().optional(),
        paths: z.array(z.string()),
        cacheDir: z.string().optional(),
        includeSuppressed: z.boolean().optional(),
        verbose: z.boolean().optional()
      }
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        const result = await getSidecarImpactPaths({
          ...args,
          dir: workspace.dir
        });
        return jsonContent(
          createCompactCodeIndexImpactPathsResponse(workspace.repo, result, Boolean(args.verbose))
        );
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "workspace_code_index_graph_impact_paths",
    {
      description:
        "Return read-only graph-backed repo code index impact context for repository-relative paths in a configured workspace repository. Compact by default (one bounded graph_impact_summary plus a persistable graph_impact_summary_ref); pass verbose:true for the expanded graph_impact alias, full path arrays, and raw envelope.",
      inputSchema: {
        repo: z.string().optional(),
        paths: z.array(z.string()),
        cacheDir: z.string().optional(),
        includeSuppressed: z.boolean().optional(),
        verbose: z.boolean().optional()
      }
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        const result = await getSidecarGraphImpactPaths({
          ...args,
          dir: workspace.dir
        });
        return jsonContent(
          createGraphImpactToolResponse({
            workspaceRepo: workspace.repo,
            result,
            verbose: Boolean(args.verbose),

            verboseFields: {
              input_paths: result.input_paths ?? [],
              validated_paths: result.validated_paths ?? [],
              invalid_paths: result.invalid_paths ?? [],
              validation_hints: result.validation_hints ?? [],
              graph_state: result.graph_state ?? null
            }
          })
        );
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "workspace_code_index_graph_impact_diff",
    {
      description:
        "Return read-only graph-backed repo code index impact context for a parsed, raw, or live git diff in a configured workspace repository. Compact by default (one bounded graph_impact_summary plus a persistable graph_impact_summary_ref); pass verbose:true for the expanded graph_impact alias, full path and diff-record arrays, and raw envelope.",
      inputSchema: {
        repo: z.string().optional(),
        patchText: z.string().optional(),
        diffRecords: z
          .array(
            z.object({
              changeKind: z.string().optional(),
              oldPath: z.string().nullable().optional(),
              newPath: z.string().nullable().optional()
            })
          )
          .optional(),
        liveGit: z.boolean().optional(),
        cacheDir: z.string().optional(),
        includeSuppressed: z.boolean().optional(),
        verbose: z.boolean().optional()
      }
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        const result = await getSidecarGraphImpactDiff({
          ...args,
          dir: workspace.dir
        });
        return jsonContent(
          createGraphImpactToolResponse({
            workspaceRepo: workspace.repo,
            result,
            graphImpact: result,
            verbose: Boolean(args.verbose),

            verboseFields: {
              input_paths: result.input_paths ?? [],
              validated_paths: result.validated_paths ?? [],
              invalid_paths: result.invalid_paths ?? [],
              validation_hints: result.validation_hints ?? [],
              input_diff_sources: result.input_diff_sources ?? [],
              parsed_diff_records: result.parsed_diff_records ?? [],
              validated_diff_records: result.validated_diff_records ?? [],
              invalid_diff_records: result.invalid_diff_records ?? [],
              affected_paths: result.affected_paths ?? [],
              old_paths: result.old_paths ?? [],
              new_paths: result.new_paths ?? [],
              graph_state: result.graph_state ?? null
            }
          })
        );
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "workspace_code_index_find_references",
    {
      description:
        "Return SCIP-derived repo code index references for a symbol or repository-relative position. Compact by default with bounded results, freshness, resolution reason, counts, and next action; pass verbose:true for the full derived envelope, provider descriptors, coverage, canonical refs, and evidence.",
      inputSchema: {
        repo: z.string().optional(),
        symbol: z.string().optional(),
        path: z.string().optional(),
        line: z.union([z.number(), z.string()]).optional(),
        character: z.union([z.number(), z.string()]).optional(),
        cacheDir: z.string().optional(),
        verbose: z.boolean().optional()
      }
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        const result = await getSidecarSymbolReferences({
          ...args,
          dir: workspace.dir
        });
        return jsonContent(createWorkspaceCodeIndexSymbolResponse(workspace.repo, result, args.verbose));
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "workspace_code_index_definition",
    {
      description:
        "Return SCIP-derived repo code index definition targets for a symbol or repository-relative position. Compact by default with bounded results, freshness, resolution reason, counts, and next action; pass verbose:true for the full derived envelope, provider descriptors, coverage, canonical refs, and evidence.",
      inputSchema: {
        repo: z.string().optional(),
        symbol: z.string().optional(),
        path: z.string().optional(),
        line: z.union([z.number(), z.string()]).optional(),
        character: z.union([z.number(), z.string()]).optional(),
        cacheDir: z.string().optional(),
        verbose: z.boolean().optional()
      }
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        const result = await getSidecarSymbolDefinition({
          ...args,
          dir: workspace.dir
        });
        return jsonContent(createWorkspaceCodeIndexSymbolResponse(workspace.repo, result, args.verbose));
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "workspace_code_index_callers",
    {
      description:
        "Return SCIP-derived repo code index callers for a symbol or repository-relative position. Compact by default with bounded results, freshness, resolution reason, counts, and next action; pass verbose:true for the full derived envelope, provider descriptors, coverage, canonical refs, and evidence.",
      inputSchema: {
        repo: z.string().optional(),
        symbol: z.string().optional(),
        path: z.string().optional(),
        line: z.union([z.number(), z.string()]).optional(),
        character: z.union([z.number(), z.string()]).optional(),
        cacheDir: z.string().optional(),
        verbose: z.boolean().optional()
      }
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        const result = await getSidecarSymbolCallers({
          ...args,
          dir: workspace.dir
        });
        return jsonContent(createWorkspaceCodeIndexSymbolResponse(workspace.repo, result, args.verbose));
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "workspace_code_index_callees",
    {
      description:
        "Return SCIP-derived repo code index callees for a symbol or repository-relative position. Compact by default with bounded results, freshness, resolution reason, counts, and next action; pass verbose:true for the full derived envelope, provider descriptors, coverage, canonical refs, and evidence.",
      inputSchema: {
        repo: z.string().optional(),
        symbol: z.string().optional(),
        path: z.string().optional(),
        line: z.union([z.number(), z.string()]).optional(),
        character: z.union([z.number(), z.string()]).optional(),
        cacheDir: z.string().optional(),
        verbose: z.boolean().optional()
      }
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        const result = await getSidecarSymbolCallees({
          ...args,
          dir: workspace.dir
        });
        return jsonContent(createWorkspaceCodeIndexSymbolResponse(workspace.repo, result, args.verbose));
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "sidecar_context_for_path",
    {
      description:
        "Return read-only sidecar implementation context for one repository-relative path. Compact by default (context_available:\"compact\": counts plus bounded top canonical refs, related code paths, and likely tests, with a next_action); files over the 1200 LOC large-file threshold return context_available:\"degraded\". Pass verbose:true for the full context.",
      inputSchema: {
        dir: z.string(),
        path: z.string(),
        cacheDir: z.string().optional(),
        includeSuppressed: z.boolean().optional(),
        verbose: z.boolean().optional()
      }
    },
    async (args) => {
      try {
        const verbose = Boolean(args.verbose);
        const result = await getSidecarContextForPath({ ...args, verbose });
        return jsonContent(omitCompactContextForPathEcho(result, verbose));
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "workspace_sidecar_context_for_path",
    {
      description:
        "Return read-only sidecar implementation context for one repository-relative path in a configured workspace repository. Compact by default (context_available:\"compact\": counts plus bounded top canonical refs, related code paths, and likely tests, with a next_action); files over the 1200 LOC large-file threshold return context_available:\"degraded\". Pass verbose:true for the full context.",
      inputSchema: {
        repo: z.string().optional(),
        path: z.string(),
        cacheDir: z.string().optional(),
        includeSuppressed: z.boolean().optional(),
        verbose: z.boolean().optional()
      }
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        const verbose = Boolean(args.verbose);
        const result = await getSidecarContextForPath({
          ...args,
          dir: workspace.dir,
          verbose
        });
        return jsonContent({
          workspaceRepo: workspace.repo,
          ...omitCompactContextForPathEcho(result, verbose)
        });
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "workspace_code_index_context_for_path",
    {
      description:
        "Return read-only repo code index implementation context for one repository-relative path in a configured workspace repository. Compact by default (a routing hint with counts plus bounded top canonical refs, related code paths, likely tests, and a next_action); files over the code-index implementation large-file guard (LARGE_FILE_CONTEXT_LOC_THRESHOLD, currently 1200 LOC) return context_available:\"degraded\" with narrower-tool guidance. Pass verbose:true for the full implementation context; verbose also bypasses the large-file guard.",
      inputSchema: {
        repo: z.string().optional(),
        path: z.string(),
        cacheDir: z.string().optional(),
        includeSuppressed: z.boolean().optional(),
        verbose: z.boolean().optional()
      }
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        const verbose = Boolean(args.verbose);
        const result = await getSidecarContextForPath({
          ...args,
          dir: workspace.dir,
          verbose
        });
        return jsonContent({
          workspaceRepo: workspace.repo,
          ...omitCompactContextForPathEcho(result, verbose)
        });
      } catch (error) {
        return errorContent(error);
      }
    }
  );
}
