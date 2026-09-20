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
  createCodeIndexImpactHandler,
  createCodeIndexQueryHandler
} from "./code-index-query-response.mjs";
import {
  createSelectedResponseSession,
  selectedResponseDetailSchema,
  selectedResponseRequestSchema
} from "./selected-response-snapshot.mjs";
import { resolveWorkspaceRepo } from "./workspace-repo-resolution.mjs";

const RETAINED_CONTRACT = "Compact keeps the original at full_result; verbose:true re-evaluates.";
const SELECTED_IMPACT_CONTRACT = "Bounded compact; detail reads retained answer; verbose:true re-evaluates.";
export const CODE_INDEX_IMPACT_ROUTE = "workspace_code_index_impact";
const CONTEXT_ARGUMENTS = new Set(["repo", "path", "cacheDir", "includeSuppressed", "verbose"]);
const IMPACT_ARGUMENTS = new Set(["repo", "cacheDir", "includeSuppressed", "verbose", "paths",
  "patchText", "diffRecords", "liveGit", "detail", "path", "symbol", "line", "character",
  "relationship"]);

const CODE_QUESTION_CONTRACT =
  "Selectors choose the answer: one of paths, patchText, diffRecords or liveGit:true asks change " +
  "impact, which path and symbol narrow; symbol, or path with line and optional character, asks " +
  "definition, references, callers and callees, which relationship narrows to one; path alone asks " +
  "that file's context. Conflicting or missing selectors return the alternatives.";

const fullAnswer = (result) => ({ ...structuredClone(result), verbose: true });

const contextInputSchema = () => z.object({
  repo: z.string().optional(),
  path: z.string(),
  cacheDir: z.string().optional(),
  includeSuppressed: z.boolean().optional(),
  verbose: z.boolean().optional()
}).strict();

const impactInputSchema = () => z.object({
  repo: z.string().optional(),
  cacheDir: z.string().optional(),
  includeSuppressed: z.boolean().optional(),
  verbose: z.boolean().optional(),
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
  detail: selectedResponseDetailSchema(z).optional()
}).strict();

export function createCodeIndexImpactSelection({ workspaceRepos, env = process.env, now = undefined,
  capacity = undefined, ttlMs = undefined } = {}) {
  return createSelectedResponseSession({
    route: CODE_INDEX_IMPACT_ROUTE,
    requestSchema: selectedResponseRequestSchema(z.object({
      repo: z.string().optional(),
      detail: selectedResponseDetailSchema(z)
    }).strict()),
    buildDetailArguments: (binding, selection) => ({ repo: binding.repository, detail: selection }),
    resolveCurrentObservationIdentity: async (retained) =>
      resolveCommittedHead(resolveWorkspaceRepo(workspaceRepos, retained.repository).dir),
    env,
    now,
    capacity,
    ttlMs
  });
}

export function registerCodeIndexQueryTools({ registerTool, workspaceRepos, jsonContent, errorContent,
  navigation, impactSelection = null }) {
  registerTool(
    "workspace_code_index_context_for_path",
    {
      description: "Committed context for one repo path: code-graph paths with exact totals; source and " +
        `guidance stay in the original. ${RETAINED_CONTRACT}`,
      inputSchema: contextInputSchema()
    },
    createCodeIndexQueryHandler({ query: getSidecarContextForPath, argumentNames: CONTEXT_ARGUMENTS,
      invalidCode: "sidecar_query_input_invalid", projectFull: fullAnswer,
      projectCompact: projectSidecarContextCompact,
      workspaceRepos, jsonContent, errorContent })
  );

  registerTool(
    "workspace_code_index_impact",
    {
      description: `One committed code question. ${CODE_QUESTION_CONTRACT} ${SELECTED_IMPACT_CONTRACT}`,
      inputSchema: impactInputSchema()
    },
    createCodeIndexImpactHandler({
      selectQuestion: normalizeSidecarCodeQuestionInput,
      queries: { impact: getSidecarQueryImpact, context: getSidecarContextForPath, navigation },
      projections: { impactFull: fullAnswer, impactSummary: projectSidecarImpactSelectedSummary,
        contextFull: fullAnswer, contextCompact: projectSidecarContextCompact },
      argumentNames: IMPACT_ARGUMENTS, invalidCode: "sidecar_query_input_invalid",
      alternatives: SIDECAR_CODE_QUESTION_ALTERNATIVES,
      session: impactSelection ?? createCodeIndexImpactSelection({ workspaceRepos }),
      workspaceRepos, jsonContent, errorContent })
  );
}
