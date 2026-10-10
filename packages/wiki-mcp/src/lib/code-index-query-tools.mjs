import { z } from "zod";
import {
  getSidecarContextForPath,
  getSidecarIndexStatus,
  getSidecarQueryImpact
} from "@agent-chassis/wiki-core";
import {
  projectSidecarContextCompact,
  projectSidecarImpactSelectedSummary
} from "@agent-chassis/wiki-core/src/lib/sidecar-query-projection.mjs";
import {
  SIDECAR_CODE_QUESTION_ALTERNATIVES,
  SIDECAR_CODE_QUESTION_FIELDS,
  SIDECAR_CODE_QUESTION_RELATIONSHIPS,
  normalizeSidecarCodeQuestionInput
} from "@agent-chassis/wiki-core/src/lib/sidecar-query-input.mjs";
import { indexedCommitLabels } from "@agent-chassis/wiki-core/src/lib/sidecar-query-selection.mjs";
import { publishedQueryContext } from "@agent-chassis/wiki-core/src/lib/sidecar-published-preparation.mjs";
import { resolveCommittedHead } from "@agent-chassis/wiki-core/src/lib/sidecar-repository-identity.mjs";
import {
  codeIndexDetailSchema,
  createCodeIndexAnswerSelection,
  createCodeIndexPreparationGuidance,
  createCodeIndexQuestionHandler
} from "./code-index-query-response.mjs";
import { registeredToolRequestContracts } from "./registered-tool-request-contracts.mjs";
import { selectedResponseRequestSchema } from "./selected-response-snapshot.mjs";
import { resolveWorkspaceRepo } from "./workspace-repo-resolution.mjs";

export const CODE_INDEX_QUERY_ROUTE = "query_code_index";

export const SELECTED_CODE_ANSWER_CONTRACT =
  "Compact answer; follow next_calls for retained detail without rerunning the query.";

export const PUBLISHED_INDEX_CONTRACT =
  "Answers from the published index without waiting and states its commit, current HEAD, freshness and refresh.";

const CODE_QUESTION_CONTRACT =
  "Selectors choose the answer: one of paths, patchText, diffRecords or liveGit:true asks change " +
  "impact, which path and symbol narrow; symbol, or path with line and optional character, asks " +
  "definition, references, callers and callees, which relationship narrows to one; path alone asks " +
  "that file's context. Conflicting or missing selectors return the alternatives.";
const STATUS_CONTRACT =
  "status:true alone reports the published index and observed HEAD without preparing or refreshing anything.";

const QUESTION_FIELD_SHAPES = Object.freeze({
  paths: () => z.array(z.string()),
  patchText: () => z.string(),
  diffRecords: () => z.array(z.object({
    changeKind: z.string().optional(),
    oldPath: z.string().nullable().optional(),
    newPath: z.string().nullable().optional()
  }).strict()),
  liveGit: () => z.boolean(),
  path: () => z.string(),
  symbol: () => z.string(),
  line: () => z.union([z.number(), z.string()]),
  character: () => z.union([z.number(), z.string()]),
  relationship: () => z.enum([...SIDECAR_CODE_QUESTION_RELATIONSHIPS]),
  includeSuppressed: () => z.boolean()
});
const QUERY_ARGUMENTS = new Set([...SIDECAR_CODE_QUESTION_FIELDS, "status", "detail"]);

const queryInputSchema = () => z.object({
  ...Object.fromEntries(SIDECAR_CODE_QUESTION_FIELDS.map((field) => {
    if (!Object.hasOwn(QUESTION_FIELD_SHAPES, field)) {
      throw new TypeError(`code question field ${field} has no registered shape`);
    }
    return [field, QUESTION_FIELD_SHAPES[field]().optional()];
  })),
  status: z.literal(true).optional(),
  detail: codeIndexDetailSchema(z).optional()
}).strict();

export function createCodeIndexStatusResponse(workspaceRepo, status, preparation) {
  const scalars = (value) => value == null ? null : Object.fromEntries(Object.entries(value)
    .filter(([, member]) => member === null || typeof member !== "object"));
  const snapshot = status?.graph_snapshot;
  const provider = snapshot?.provider_coverage;
  const projects = provider?.projects;

  const sum = (read) => Array.isArray(projects) && projects.every((project) =>
    Number.isSafeInteger(read(project))) ? projects.reduce((total, project) => total + read(project), 0) : null;
  const freshness = status?.staleness ?? "unknown";
  const available = status?.artifact_exists === true;
  const needsPreparation = status?.index_action !== "use" || status?.scip_state?.index_action !== "use";
  return {
    workspaceRepo,
    read_mode: "status",
    ...indexedCommitLabels(status?.graph_snapshot),
    current_head: status?.index_head ?? null,
    available,
    graph_snapshot: snapshot ? {
      schema_version: snapshot.schema_version,
      repository_commit: snapshot.repository_commit,
      repository_tree: snapshot.repository_tree,
      base_coverage: scalars(snapshot.base_coverage),
      provider_coverage: provider ? { ...scalars(provider),
        project_count: Array.isArray(projects) ? projects.length : null,
        inactive_project_count: Array.isArray(provider.inactive_projects) ? provider.inactive_projects.length : null,
        project_document_count: sum((project) => project.document_count),
        covered_project_document_count: sum((project) => project.covered_document_count),
        uncovered_project_document_count: sum((project) => Array.isArray(project.uncovered_documents)
          ? project.uncovered_documents.length : null) } : null
    } : null,
    freshness,
    dirty_state: status?.dirty_state ?? "unknown",
    staleness: freshness,
    artifact_exists: status?.artifact_exists ?? false,
    status_reason: status?.status_reason ?? null,
    index_action: status?.index_action ?? null,
    index_head: status?.index_head ?? null,
    graph_available: status?.graph_state?.graph_available === true,
    scip_state: scalars(status?.scip_state),
    preparation: needsPreparation ? preparation.slot : { state: "not_needed" },
    next_action: needsPreparation
      ? `Index status: ${status?.status_reason ?? "unknown"}; SCIP: ${status?.scip_state?.status_reason ?? "unknown"}. ` +
        `${preparation.sentence} Status and evidence selections inspect the published index; ` +
        "they do not prepare, refresh or repair it."
      : "The published index is usable at indexed_commit: ask a code question with the selectors " +
        "supported_questions lists. The evidence selections inspect this status's retained provider and " +
        "provenance facts; no question needs them first."
  };
}

function projectFileContext(result, options) {
  const project = (summary) => {
    const { query_kind, path, source, loc, ...rest } = summary;
    return { query_kind, path, source, loc, ...rest };
  };
  return project(projectSidecarContextCompact(result, { fits: (summary) => options.fits(project(summary)) }));
}

export function createCodeIndexSelection({ workspaceRepos, env = process.env }) {
  return createCodeIndexAnswerSelection({
    route: CODE_INDEX_QUERY_ROUTE,
    requestSchema: selectedResponseRequestSchema(z.object({ detail: codeIndexDetailSchema(z) }).strict()),
    detailSchema: codeIndexDetailSchema(z),
    buildDetailArguments: (_binding, selection) => ({ detail: selection }),
    resolveCurrentObservationIdentity: async (retained) =>
      resolveCommittedHead(resolveWorkspaceRepo(workspaceRepos, retained.repository).dir),
    env
  });
}

export function registerCodeIndexQueryTools({ registerTool, workspaceRepos, jsonContent, errorContent,
  navigation, selection = null, env = process.env, published = publishedQueryContext(),
  status = getSidecarIndexStatus }) {

  registerTool(
    "query_code_index",
    {
      description: `One committed code question about this repository. ${CODE_QUESTION_CONTRACT} ` +
        `${STATUS_CONTRACT} ${PUBLISHED_INDEX_CONTRACT} ${SELECTED_CODE_ANSWER_CONTRACT}`,
      inputSchema: queryInputSchema()
    },
    createCodeIndexQuestionHandler({
      selectQuestion: normalizeSidecarCodeQuestionInput,
      queries: { impact: (args) => getSidecarQueryImpact(args, published),
        context: (args) => getSidecarContextForPath(args, published),
        navigation, prepareNavigation: published.prepare, status },
      projections: { impactSummary: projectSidecarImpactSelectedSummary,
        contextSummary: projectFileContext, status: createCodeIndexStatusResponse },
      argumentNames: QUERY_ARGUMENTS, invalidCode: "sidecar_query_input_invalid",
      alternatives: SIDECAR_CODE_QUESTION_ALTERNATIVES,
      session: selection ?? createCodeIndexSelection({ workspaceRepos, env }),

      preparation: createCodeIndexPreparationGuidance(registeredToolRequestContracts(registerTool)),
      workspaceRepos, jsonContent, errorContent })
  );
}
