

import { z } from "zod";
import { buildSidecarIndex } from "@agent-chassis/wiki-core";
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
import { publishedQueryContext } from "@agent-chassis/wiki-core/src/lib/sidecar-published-preparation.mjs";
import { registerCodeIndexQueryTools } from "./code-index-query-tools.mjs";
import { resolveWorkspaceRepo } from "./workspace-repo-resolution.mjs";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
  env = process.env, published = publishedQueryContext() }) {
  const shared = { workspaceRepos, jsonContent, errorContent };
  registerTool(
    "workspace_code_index_build",
    {
      description:
        "Prepare the configured repo's ignored code-index cache for the current HEAD and wait for it; queries answer from the published index and refresh it in the background.",
      inputSchema: codeIndexWriterInputSchema()
    },
    codeIndexWriterHandler({ rebuild: false, ...shared })
  );

  registerTool(
    "workspace_code_index_rebuild",
    {
      description:
        "Force a clean rebuild that re-extracts current checkout sources and wait for it; queries answer from the published index and refresh it in the background.",
      inputSchema: codeIndexWriterInputSchema()
    },
    codeIndexWriterHandler({ rebuild: true, ...shared })
  );

  registerCodeIndexQueryTools({
    registerTool,
    env,
    published,
    navigation: {
      definition: getSidecarSymbolDefinition,
      references: getSidecarSymbolReferences,
      callers: getSidecarSymbolCallers,
      callees: getSidecarSymbolCallees
    },
    ...shared
  });
}
