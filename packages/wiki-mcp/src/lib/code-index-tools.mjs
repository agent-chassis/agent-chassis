

import { z } from "zod";
import {
  buildSidecarIndex,
  getSidecarIndexStatus
} from "@agent-chassis/wiki-core";
import {
  getSidecarSymbolCallers,
  getSidecarSymbolCallees,
  getSidecarSymbolDefinition,
  getSidecarSymbolReferences
} from "@agent-chassis/wiki-core/src/lib/sidecar-symbol-query.mjs";
import {
  compactGraphImpactSummaryAffectedSurfaces,
  createBoundedGraphImpactResponse
} from "./graph-impact-response-boundary.mjs";
import { codeIndexDetailSchema, createCodeIndexNavigationHandler } from "./code-index-query-response.mjs";
import { SELECTED_CODE_ANSWER_CONTRACT, createCodeIndexSelection, registerCodeIndexQueryTools }
  from "./code-index-query-tools.mjs";
import { resolveWorkspaceRepo } from "./workspace-repo-resolution.mjs";

const CODE_INDEX_NAVIGATION_CONTRACT = `ambiguity keeps all candidates. ${SELECTED_CODE_ANSWER_CONTRACT}`;
const describeCodeIndexNavigationRoute = (subject) =>
  `SCIP ${subject} with committed source; ${CODE_INDEX_NAVIGATION_CONTRACT}`;

const codeIndexNavigationInputSchema = () => z.object({
  repo: z.string().optional(),
  symbol: z.string().optional(),
  path: z.string().optional(),
  line: z.union([z.number(), z.string()]).optional(),
  character: z.union([z.number(), z.string()]).optional(),
  cacheDir: z.string().optional(),
  detail: codeIndexDetailSchema(z).optional()
}).strict();

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

export const GRAPH_IMPACT_VERBOSE_NEXT_ACTION =
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

function createCompactCodeIndexStatusResponse(workspaceRepo, result) {
  return {
    workspaceRepo,
    dirty_state: result?.dirty_state ?? "unknown",
    staleness: result?.staleness ?? "unknown",
    artifact_exists: result?.artifact_exists ?? false,
    status_reason: result?.status_reason ?? null,
    index_head: result?.index_head ?? null,
    graph_available: result?.graph_state?.graph_available === true,
    scip_state: result?.scip_state ? cloneJson(result.scip_state) : null
  };
}

function codeIndexWriterHandler({ rebuild, workspaceRepos, jsonContent, errorContent }) {
  return async (args) => {
    try {
      const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
      const result = await buildSidecarIndex({
        ...args,
        dir: workspace.dir,
        ...(rebuild ? { rebuild: true } : {})
      });
      return jsonContent({ workspaceRepo: workspace.repo, ...result });
    } catch (error) {
      return errorContent(error);
    }
  };
}

const codeIndexWriterInputSchema = () => ({
  repo: z.string().optional(),
  cacheDir: z.string().optional()
});

export function registerCodeIndexTools({ registerTool, workspaceRepos, jsonContent, errorContent,
  env = process.env }) {
  const shared = { workspaceRepos, jsonContent, errorContent };
  registerTool(
    "workspace_code_index_build",
    {
      description:
        "Optionally prepare the configured repo's ignored code-index cache now; queries prepare it automatically.",
      inputSchema: codeIndexWriterInputSchema()
    },
    codeIndexWriterHandler({ rebuild: false, ...shared })
  );

  registerTool(
    "workspace_code_index_rebuild",
    {
      description:
        "Optionally force a clean rebuild that re-extracts every committed source; queries prepare the ignored cache automatically.",
      inputSchema: codeIndexWriterInputSchema()
    },
    codeIndexWriterHandler({ rebuild: true, ...shared })
  );

  registerTool(
    "workspace_code_index_status",
    {
      description:
        "Report read-only base and SCIP identity/freshness for a configured repo without building, rebuilding, or running providers. Compact by default; verbose:true adds derived evidence, graph state, and artifact paths.",
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
    "workspace_code_index_find_references",
    { description: describeCodeIndexNavigationRoute("references"), inputSchema: codeIndexNavigationInputSchema() },
    createCodeIndexNavigationHandler({ query: getSidecarSymbolReferences, ...shared,
      session: createCodeIndexSelection({ env, route: "workspace_code_index_find_references", workspaceRepos }) })
  );

  registerTool(
    "workspace_code_index_definition",
    { description: describeCodeIndexNavigationRoute("definitions"), inputSchema: codeIndexNavigationInputSchema() },
    createCodeIndexNavigationHandler({ query: getSidecarSymbolDefinition, ...shared,
      session: createCodeIndexSelection({ env, route: "workspace_code_index_definition", workspaceRepos }) })
  );

  registerTool(
    "workspace_code_index_callers",
    { description: describeCodeIndexNavigationRoute("callers"), inputSchema: codeIndexNavigationInputSchema() },
    createCodeIndexNavigationHandler({ query: getSidecarSymbolCallers, ...shared,
      session: createCodeIndexSelection({ env, route: "workspace_code_index_callers", workspaceRepos }) })
  );

  registerTool(
    "workspace_code_index_callees",
    { description: describeCodeIndexNavigationRoute("callees"), inputSchema: codeIndexNavigationInputSchema() },
    createCodeIndexNavigationHandler({ query: getSidecarSymbolCallees, ...shared,
      session: createCodeIndexSelection({ env, route: "workspace_code_index_callees", workspaceRepos }) })
  );

  registerCodeIndexQueryTools({
    registerTool,
    env,
    navigation: {
      definition: getSidecarSymbolDefinition,
      references: getSidecarSymbolReferences,
      callers: getSidecarSymbolCallers,
      callees: getSidecarSymbolCallees
    },
    ...shared
  });
}
