import { z } from "zod";
import { projectToolInputValidationFailure } from "./register-tool.mjs";
import {
  getSidecarContextForPath,
  getSidecarIndexStatus,
  getSidecarQueryImpact
} from "@agent-chassis/wiki-core";
import { projectCodeContext, projectCodeImpact, projectCodeStatus } from "./code-index-query-meaning.mjs";
import {
  SIDECAR_CODE_QUESTION_ALTERNATIVES,
  SIDECAR_CODE_QUESTION_FIELDS,
  SIDECAR_CODE_QUESTION_RELATIONSHIPS,
  normalizeSidecarCodeQuestionInput
} from "@agent-chassis/wiki-core/src/lib/sidecar-query-input.mjs";
import { publishedQueryContext } from "@agent-chassis/wiki-core/src/lib/sidecar-published-preparation.mjs";
import { collectSidecarCheckoutInputs, sidecarCheckoutObservationIdentity } from
  "@agent-chassis/wiki-core/src/lib/sidecar-checkout-inputs.mjs";
import { readSidecarStoreStatus } from "@agent-chassis/wiki-core/src/lib/sidecar-store.mjs";
import { sidecarProviderInputsChangedAtCommit } from "@agent-chassis/wiki-core/src/lib/sidecar-scip-projects.mjs";
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
  "Answers from published checkout content; reports material coverage limits. This does not establish alignment with a reviewed version.";

const CODE_QUESTION_CONTRACT =
  "Selectors choose the answer: one of paths, patchText, diffRecords or liveGit:true asks change " +
  "impact, which path and symbol narrow; symbol, or path with line and optional character, asks " +
  "definition, references, callers and callees, which relationship narrows to one; path alone asks " +
  "that file's context. Position resolution covers whole lines; character does not disambiguate columns. " +
  "References do not establish calls. Conflicting or missing selectors return the alternatives.";
const STATUS_CONTRACT =
  "status:true alone reports index availability and material limits without preparing or refreshing anything.";

const QUESTION_FIELD_SHAPES = Object.freeze({
  paths: () => z.array(z.string()).describe("Empty [] explicitly selects no changes."),
  patchText: () => z.string().describe("Empty text explicitly selects no changes."),
  diffRecords: () => z.array(z.object({
    changeKind: z.string().describe("added, deleted, modified, renamed or copied; unsupported kinds are reported.").optional(),
    oldPath: z.string().nullable().optional(),
    newPath: z.string().nullable().optional()
  }).strict()).describe("Empty [] selects no changes. added needs only newPath; deleted only oldPath; modified/renamed/copied need both endpoints."),
  liveGit: () => z.boolean().describe("true selects live Git changes; false alone selects nothing."),
  path: () => z.string().describe("Repository-relative file. In navigation, accompanies only document-local symbols. In impact, path/symbol select a union of seed paths within the changed subject."),
  symbol: () => z.string().describe("Exact raw SCIP symbol returned by the index; preserve it unchanged. Navigation locals require their document path; impact uses the symbol's definition paths."),
  line: () => z.union([z.number(), z.string()]).describe("One-based line: safe integer >= 1 or canonical decimal text."),
  character: () => z.union([z.number(), z.string()]).describe("Zero-based character: safe integer >= 0 or canonical decimal text; requires line. Resolution remains whole-line; changing character does not narrow it."),
  relationship: () => z.enum([...SIDECAR_CODE_QUESTION_RELATIONSHIPS]).describe("One navigation relationship; omit only when all four are needed. References do not establish calls."),
  includeSuppressed: () => z.boolean().describe("Include suppressed canonical records for context/impact; not accepted in navigation.")
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

function fitMeaning(project, result, { fits }) {
  for (let limit = 3; limit >= 0; limit -= 1) {
    const summary = project(result, { limit });
    if (fits(summary)) return summary;
  }
  throw new RangeError("code question meaning exceeds compact admission");
}

export function createCodeIndexStatusResponse(_workspaceRepo, status, preparation) {
  return projectCodeStatus(status, preparation);
}

export function createCodeIndexSelection({ workspaceRepos, env = process.env }) {
  return createCodeIndexAnswerSelection({
    route: CODE_INDEX_QUERY_ROUTE,
    requestSchema: selectedResponseRequestSchema(z.object({ detail: codeIndexDetailSchema(z) }).strict()),
    detailSchema: codeIndexDetailSchema(z),
    buildDetailArguments: (_binding, selection) => ({ detail: selection }),
    resolveCurrentObservationIdentity: async (retained) => {
      const repoRoot = resolveWorkspaceRepo(workspaceRepos, retained.repository).dir;
      const inputs = await collectSidecarCheckoutInputs(repoRoot);
      const publication = readSidecarStoreStatus({ repoRoot }).publication;
      return sidecarCheckoutObservationIdentity(publication, inputs.identity,
        sidecarProviderInputsChangedAtCommit(publication, process.env));
    },
    env
  });
}

export function registerCodeIndexQueryTools({ registerTool, workspaceRepos, jsonContent, errorContent,
  navigation, selection = null, env = process.env, published = publishedQueryContext(),
  status = options => getSidecarIndexStatus({ ...options, verifyCheckout: false }) }) {
  const inputSchema = queryInputSchema();

  registerTool(
    "query_code_index",
    {
      description: `One code question about this repository. ${CODE_QUESTION_CONTRACT} ` +
        `${STATUS_CONTRACT} ${PUBLISHED_INDEX_CONTRACT} ${SELECTED_CODE_ANSWER_CONTRACT}`,
      inputSchema, advertisedInputSchema: inputSchema,
      inputValidationErrorProjector: async ({ args, validationError }) => ({ terminal_result: {
        ...jsonContent(await projectToolInputValidationFailure({ tool: CODE_INDEX_QUERY_ROUTE, args, validationError,
          ownerGuidance: { calls: [],
            information: "Preserve the intended question and correct the reported fields; status is not a correction." } }), { env }),
        isError: true } })
    },
    createCodeIndexQuestionHandler({
      selectQuestion: normalizeSidecarCodeQuestionInput,
      queries: { impact: (args) => getSidecarQueryImpact(args, published),
        context: (args) => getSidecarContextForPath(args, published),
        navigation, prepareNavigation: published.prepare, status },
      projections: { impactSummary: (result, options) => fitMeaning(projectCodeImpact, result, options),
        contextSummary: (result, options) => fitMeaning(projectCodeContext, result, options), status: createCodeIndexStatusResponse },
      argumentNames: QUERY_ARGUMENTS, invalidCode: "sidecar_query_input_invalid",
      alternatives: SIDECAR_CODE_QUESTION_ALTERNATIVES,
      session: selection ?? createCodeIndexSelection({ workspaceRepos, env }),

      preparation: createCodeIndexPreparationGuidance(registeredToolRequestContracts(registerTool)),
      workspaceRepos, jsonContent, errorContent })
  );
}
