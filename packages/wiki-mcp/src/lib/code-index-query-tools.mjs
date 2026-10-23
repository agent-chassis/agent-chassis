import { CODE_INDEX_QUERY_ROUTE } from "./code-index-query-contract.mjs";
import { z } from "zod";
import { projectCodeIndexInputFailure } from "./code-index-query-input-recovery.mjs";
import { getSidecarIndexStatus } from "@agent-chassis/wiki-core";
import { publishedQueryContext } from "@agent-chassis/wiki-core/src/lib/sidecar-published-preparation.mjs";
import { collectSidecarCheckoutInputs, sidecarCheckoutObservationIdentity } from
  "@agent-chassis/wiki-core/src/lib/sidecar-checkout-inputs.mjs";
import { readSidecarStoreStatus } from "@agent-chassis/wiki-core/src/lib/sidecar-store.mjs";
import { sidecarProviderInputsChangedAtCommit } from "@agent-chassis/wiki-core/src/lib/sidecar-scip-projects.mjs";
import { codeIndexDetailSchema, codeIndexQueryInputSchema } from './code-index-query-schema.mjs';
import { codeIndexHostMechanics } from './paid-composition.mjs';
import { createCodeIndexPreparationGuidance, createCodeReviewAuthority } from './code-index-review-authority.mjs';
import { registeredToolRequestContracts } from "./registered-tool-request-contracts.mjs";
import { selectedResponseRequestSchema } from "./selected-response-snapshot.mjs";
import { resolveWorkspaceRepo } from "./workspace-repo-resolution.mjs";

export const SELECTED_CODE_ANSWER_CONTRACT =
  "Compact answer; follow next_calls for retained detail without rerunning the query.";

export const PUBLISHED_INDEX_CONTRACT =
  "Answers from published checkout content; authenticated review reads check the bound reviewed source and offer exact reviewed code when it differs.";

const CODE_QUESTION_CONTRACT =
  "Selectors choose the answer: one of paths, patchText, diffRecords or liveGit:true asks change " +
  "impact, which path and symbol narrow; symbol, or path with line and optional character, asks " +
  "definition, references, callers and callees, which relationship narrows to one; path alone asks " +
  "that file's context. Position resolution covers whole lines; character does not disambiguate columns. " +
  "References do not establish calls. Conflicting or missing selectors return the alternatives.";
const STATUS_CONTRACT =
  "status:true alone reports index availability and material limits without preparing or refreshing anything.";

function fitMeaning(project, result, { fits }) {
  for (let limit = 3; limit >= 0; limit -= 1) {
    const summary = project(result, { limit });
    if (fits(summary)) return summary;
  }
  throw new RangeError("code question meaning exceeds compact admission");
}

export function createCodeIndexSelection({ workspaceRepos, codeIntelligence, env = process.env }) {
  const { createCodeIndexAnswerSelection, createCodeReviewSource } = codeIntelligence.createMcpOperations(codeIndexHostMechanics);
  return createCodeIndexAnswerSelection({
    route: CODE_INDEX_QUERY_ROUTE,
    requestSchema: selectedResponseRequestSchema(z.object({ detail: codeIndexDetailSchema(z) }).strict()),
    detailSchema: codeIndexDetailSchema(z),
    review: createCodeReviewSource(createCodeReviewAuthority({ workspaceRepos, env })),
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
  codeIntelligence, navigation, selection = null, env = process.env, published = publishedQueryContext(),
  status = options => getSidecarIndexStatus({ ...options, verifyCheckout: false }) }) {
  const { getSidecarQueryImpact, getSidecarContextForPath } = codeIntelligence;
  const { createCodeIndexQuestionHandler, projectCodeContext, projectCodeImpact, projectCodeStatus } = codeIntelligence.createMcpOperations(codeIndexHostMechanics);
  const { fields, alternatives } = codeIntelligence.vocabulary;
  const inputSchema = codeIndexQueryInputSchema(codeIntelligence.vocabulary);
  const QUERY_ARGUMENTS = new Set([...fields, "status", "detail"]);
  const session = selection ?? createCodeIndexSelection({ workspaceRepos, codeIntelligence, env });
  const contracts = registeredToolRequestContracts(registerTool);

  registerTool(
    "query_code_index",
    {
      description: `One code question about this repository. ${CODE_QUESTION_CONTRACT} ` +
        `${STATUS_CONTRACT} ${PUBLISHED_INDEX_CONTRACT} ${SELECTED_CODE_ANSWER_CONTRACT}`,
      inputSchema, advertisedInputSchema: inputSchema,
      inputValidationErrorProjector: async ({ args, validationError }) => ({ terminal_result: {
        ...jsonContent(await projectCodeIndexInputFailure({ args, validationError, inputSchema, contracts, session, workspaceRepos, codeIntelligence }), { env }),
        isError: true } })
    },
    createCodeIndexQuestionHandler({
      selectQuestion: codeIntelligence.normalizeSidecarCodeQuestionInput,
      queries: { impact: (args) => getSidecarQueryImpact(args, published),
        context: (args) => getSidecarContextForPath(args, published),
        navigation, prepareNavigation: published.prepare, status },
      projections: { impactSummary: (result, options) => fitMeaning(projectCodeImpact, result, options),
        contextSummary: (result, options) => fitMeaning(projectCodeContext, result, options), status: (_repo, status, preparation) => projectCodeStatus(status, preparation) },
      argumentNames: QUERY_ARGUMENTS, invalidCode: "sidecar_query_input_invalid",
      alternatives,
      session,

      preparation: createCodeIndexPreparationGuidance(contracts),
      workspaceRepos, jsonContent, errorContent })
  );
}
