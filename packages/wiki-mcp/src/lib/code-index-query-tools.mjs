import { z } from "zod";
import {
  getSidecarContextForPath,
  getSidecarQueryImpact
} from "@agent-chassis/wiki-core";
import {
  projectSidecarContextCompact,
  projectSidecarImpactSelectedSummary
} from "@agent-chassis/wiki-core/src/lib/sidecar-query-projection.mjs";
import {
  SIDECAR_CODE_QUESTION_ALTERNATIVES,
  SIDECAR_CODE_QUESTION_RELATIONSHIPS,
  normalizeSidecarCodeQuestionInput
} from "@agent-chassis/wiki-core/src/lib/sidecar-query-input.mjs";
import { resolveCommittedHead } from "@agent-chassis/wiki-core/src/lib/sidecar-repository-identity.mjs";
import {
  codeIndexDetailSchema,
  createCodeIndexAnswerSelection,
  createCodeIndexImpactHandler,
  createCodeIndexQueryHandler
} from "./code-index-query-response.mjs";
import { selectedResponseRequestSchema } from "./selected-response-snapshot.mjs";
import { resolveWorkspaceRepo } from "./workspace-repo-resolution.mjs";

export const SELECTED_CODE_ANSWER_CONTRACT =
  "Bounded compact answer; next_calls' detail selects retained rows by selector.id, path, symbol or relationship, affected-file relationships by input_path, candidates by symbol/path, or absolute source lines within one region or file; never re-evaluates.";
export const CODE_INDEX_IMPACT_ROUTE = "workspace_code_index_impact";
export const CODE_INDEX_CONTEXT_ROUTE = "workspace_code_index_context_for_path";
const CONTEXT_ARGUMENTS = new Set(["repo", "path", "cacheDir", "includeSuppressed", "detail"]);
const IMPACT_ARGUMENTS = new Set(["repo", "cacheDir", "includeSuppressed", "paths",
  "patchText", "diffRecords", "liveGit", "detail", "path", "symbol", "line", "character",
  "relationship"]);

const CODE_QUESTION_CONTRACT =
  "Selectors choose the answer: one of paths, patchText, diffRecords or liveGit:true asks change " +
  "impact, which path and symbol narrow; symbol, or path with line and optional character, asks " +
  "definition, references, callers and callees, which relationship narrows to one; path alone asks " +
  "that file's context. Conflicting or missing selectors return the alternatives.";

const contextInputSchema = () => z.object({
  repo: z.string().optional(),
  path: z.string().optional(),
  cacheDir: z.string().optional(),
  includeSuppressed: z.boolean().optional(),
  detail: codeIndexDetailSchema(z).optional()
}).strict();

const impactInputSchema = () => z.object({
  repo: z.string().optional(),
  cacheDir: z.string().optional(),
  includeSuppressed: z.boolean().optional(),
  paths: z.array(z.string()).optional(),
  patchText: z.string().optional(),
  diffRecords: z.array(z.object({
    changeKind: z.string().optional(),
    oldPath: z.string().nullable().optional(),
    newPath: z.string().nullable().optional()
  }).strict()).optional(),
  liveGit: z.boolean().optional(),
  path: z.string().optional(),
  symbol: z.string().optional(),
  line: z.union([z.number(), z.string()]).optional(),
  character: z.union([z.number(), z.string()]).optional(),
  relationship: z.enum([...SIDECAR_CODE_QUESTION_RELATIONSHIPS]).optional(),
  detail: codeIndexDetailSchema(z).optional()
}).strict();

export function createCodeIndexSelection({ route, workspaceRepos, env = process.env }) {
  return createCodeIndexAnswerSelection({
    route,
    requestSchema: selectedResponseRequestSchema(z.object({
      repo: z.string().optional(),
      detail: codeIndexDetailSchema(z)
    }).strict()),
    detailSchema: codeIndexDetailSchema(z),
    buildDetailArguments: (binding, selection) => ({ repo: binding.repository, detail: selection }),
    resolveCurrentObservationIdentity: async (retained) =>
      resolveCommittedHead(resolveWorkspaceRepo(workspaceRepos, retained.repository).dir),
    env
  });
}

export function createCodeIndexImpactSelection(options = {}) {
  return createCodeIndexSelection({ ...options, route: CODE_INDEX_IMPACT_ROUTE });
}

export function registerCodeIndexQueryTools({ registerTool, workspaceRepos, jsonContent, errorContent,
  navigation, impactSelection = null, contextSelection = null, env = process.env }) {
  registerTool(
    CODE_INDEX_CONTEXT_ROUTE,
    {
      description: "Committed context for one repo path: code-graph paths with exact totals; source and " +
        `guidance stay in the original. ${SELECTED_CODE_ANSWER_CONTRACT}`,
      inputSchema: contextInputSchema()
    },
    createCodeIndexQueryHandler({ query: getSidecarContextForPath, argumentNames: CONTEXT_ARGUMENTS,
      invalidCode: "sidecar_query_input_invalid", requiredArguments: ["path"],
      projectSummary: projectSidecarContextCompact, collections: ["affected_files"],
      session: contextSelection ?? createCodeIndexSelection({ route: CODE_INDEX_CONTEXT_ROUTE,
        workspaceRepos, env }),
      workspaceRepos, jsonContent, errorContent })
  );

  registerTool(
    "workspace_code_index_impact",
    {
      description: `One committed code question. ${CODE_QUESTION_CONTRACT} ${SELECTED_CODE_ANSWER_CONTRACT}`,
      inputSchema: impactInputSchema()
    },
    createCodeIndexImpactHandler({
      selectQuestion: normalizeSidecarCodeQuestionInput,
      queries: { impact: getSidecarQueryImpact, context: getSidecarContextForPath, navigation },
      projections: { impactSummary: projectSidecarImpactSelectedSummary,
        contextSummary: projectSidecarContextCompact },
      argumentNames: IMPACT_ARGUMENTS, invalidCode: "sidecar_query_input_invalid",
      alternatives: SIDECAR_CODE_QUESTION_ALTERNATIVES,
      session: impactSelection ?? createCodeIndexImpactSelection({ workspaceRepos, env }),
      workspaceRepos, jsonContent, errorContent })
  );
}
