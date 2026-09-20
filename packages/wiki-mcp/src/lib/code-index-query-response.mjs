import { projectSidecarSymbolQueryForMcp } from
  "@agent-chassis/wiki-core/src/lib/sidecar-symbol-query.mjs";
import { measureMcpInlineResultBytes } from "./mcp-response.mjs";
import {
  selectedResponseCollectionCounts,
  selectedResponseDeliveryBound,
  selectedResponseQueryInvalidError
} from "./selected-response-snapshot.mjs";
import { resolveWorkspaceRepo } from "./workspace-repo-resolution.mjs";

export const CODE_INDEX_IMPACT_SELECTED_SUMMARY_SCHEMA_VERSION = "code-index-impact-selected-summary.v1";
export const CODE_INDEX_NAVIGATION_ANSWER_SCHEMA_VERSION = "code-index-question-navigation.v1";

const IMPACT_QUERY_ARGUMENTS = Object.freeze(["cacheDir", "includeSuppressed", "verbose", "paths",
  "patchText", "diffRecords", "liveGit", "path", "symbol", "line", "character", "relationship"]);

const NAVIGATION_RELATIONSHIPS = Object.freeze(["definition", "references", "callers", "callees"]);

function responseContractError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function createRetainedCodeIndexResponse({ workspaceRepo, result, verbose, jsonContent,
  projectFull, projectCompact }) {
  const full = { workspaceRepo, ...projectFull(result) };
  if (verbose === true) return jsonContent(full);
  const retained = jsonContent(full, { forceSpill: true });
  if (retained?.isError === true) return retained;
  const contentReference = retained?.structuredContent?.content_reference;
  if (retained?.structuredContent?.response_spilled !== true ||
      typeof contentReference?.ref_id !== "string" || typeof contentReference.sha256 !== "string") {
    throw responseContractError(
      "code-index original answer was not retained with a content reference",
      "code_index_original_not_retained"
    );
  }
  const fullResult = { content_reference: contentReference,
    total_bytes: retained.structuredContent.total_bytes, sha256: contentReference.sha256 };
  const frame = (compact) => ({ workspaceRepo, ...compact, full_result: fullResult });
  const bound = selectedResponseDeliveryBound();
  return jsonContent(frame(projectCompact(result, {
    fits: (candidate) => measureMcpInlineResultBytes(frame(candidate)) <= bound
  })));
}

export function createCodeIndexQueryHandler({ query, argumentNames, invalidCode, projectFull,
  projectCompact, workspaceRepos, jsonContent, errorContent }) {
  return async (args = {}) => {
    try {
      const unknown = Object.keys(args ?? {}).filter((key) => !argumentNames.has(key));
      if (unknown.length > 0) {
        throw responseContractError(`code-index query does not accept: ${unknown.join(", ")}`, invalidCode);
      }
      const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
      const result = await query({ ...args, dir: workspace.dir });
      return createRetainedCodeIndexResponse({ workspaceRepo: workspace.repo, result,
        verbose: args.verbose, jsonContent, projectFull, projectCompact });
    } catch (error) {
      return errorContent(error);
    }
  };
}

export function createSelectedImpactResponse({ workspaceRepo, result, verbose, jsonContent,
  projectFull, projectSummary, session, queryIdentity }) {
  const full = { workspaceRepo, ...projectFull(result) };
  if (verbose === true) return jsonContent(full);
  const binding = { route: session.route, repository: workspaceRepo, unit: null,
    query_identity: queryIdentity, observation_identity: result?.index_head ?? null };
  const { source, snapshot_identity: snapshotIdentity } = session.retain({ binding, carrier: full });
  const selectedDetail = {
    schema_version: CODE_INDEX_IMPACT_SELECTED_SUMMARY_SCHEMA_VERSION,
    source,
    snapshot_identity: snapshotIdentity,
    collections: selectedResponseCollectionCounts(full),
    next_calls: [session.detailCall(binding,
      { source, snapshot_identity: snapshotIdentity, collection: "affected_files" })]
  };
  const frame = (summary) => ({ workspaceRepo, ...summary, verbose: false, selected_detail: selectedDetail });
  const summary = projectSummary(result, {
    fits: (candidate) => measureMcpInlineResultBytes(frame(candidate)) <= session.maximumBytes
  });
  return jsonContent(frame(summary));
}

export async function composeCodeIndexNavigationAnswer({ navigation, input, relationship }) {
  const requested = relationship === null ? NAVIGATION_RELATIONSHIPS : [relationship];
  const parts = {};
  for (const kind of requested) {
    parts[kind] = await navigation[kind](input);
  }
  return { schema_version: CODE_INDEX_NAVIGATION_ANSWER_SCHEMA_VERSION, query_kind: "code_question_navigation",
    relationship, requested_relationships: [...requested], target: { symbol: input.symbol ?? null,
      path: input.path ?? null, line: input.line ?? null, character: input.character ?? null }, parts };
}

function projectNavigationAnswer(answer, { verbose }) {
  const parts = {};
  const counts = {};
  for (const [relationship, result] of Object.entries(answer.parts)) {
    parts[relationship] = projectSidecarSymbolQueryForMcp(result, { verbose });
    counts[relationship] = parts[relationship].result_count
      ?? { total: null, returned: null, truncated: null };
  }
  return { schema_version: answer.schema_version, query_kind: answer.query_kind,
    relationship: answer.relationship,
    requested_relationships: [...answer.requested_relationships], target: { ...answer.target },
    parts, ...(verbose ? { verbose: true } : { counts }) };
}

async function answerCodeQuestion({ selected, queries, workspace, args, jsonContent, projections,
  session }) {

  const selectedArguments = { ...selected.arguments, dir: workspace.dir };
  if (selected.query_kind === "impact") {
    const result = await queries.impact(selectedArguments);
    const { repo: _repo, verbose: _verbose, ...queryIdentity } = args;
    return createSelectedImpactResponse({ workspaceRepo: workspace.repo, result, verbose: args.verbose,
      jsonContent, projectFull: projections.impactFull, projectSummary: projections.impactSummary,
      session, queryIdentity });
  }
  if (selected.query_kind === "context") {
    const result = await queries.context(selectedArguments);
    return createRetainedCodeIndexResponse({ workspaceRepo: workspace.repo, result,
      verbose: args.verbose, jsonContent, projectFull: projections.contextFull,
      projectCompact: projections.contextCompact });
  }
  const answer = await composeCodeIndexNavigationAnswer({ navigation: queries.navigation,
    input: selectedArguments, relationship: selected.relationship });
  return createRetainedCodeIndexResponse({ workspaceRepo: workspace.repo, result: answer,
    verbose: args.verbose, jsonContent,
    projectFull: (result) => projectNavigationAnswer(result, { verbose: true }),
    projectCompact: (result) => projectNavigationAnswer(result, { verbose: false }) });
}

export function createCodeIndexImpactHandler({ selectQuestion, queries, argumentNames, invalidCode,
  alternatives = [], projections, session, workspaceRepos, jsonContent, errorContent }) {
  return async (args = {}) => {
    try {
      const unknown = Object.keys(args ?? {}).filter((key) => !argumentNames.has(key));
      if (unknown.length > 0) {

        throw responseContractError(`code-index query does not accept: ${unknown.join(", ")}` +
          (alternatives.length > 0 ? `. Supported code questions: ${alternatives
            .map((text, index) => `(${index + 1}) ${text}`).join(" ")}` : ""), invalidCode);
      }
      const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
      if (args.detail !== undefined) {
        const queryArguments = IMPACT_QUERY_ARGUMENTS.filter((field) => args[field] !== undefined);
        if (queryArguments.length > 0) {
          throw selectedResponseQueryInvalidError(session.route, "detail_excludes_query_arguments",
            { arguments: queryArguments });
        }
        return jsonContent(await session.detail({
          expected: { route: session.route, repository: workspace.repo },
          detail: args.detail
        }));
      }
      const { repo: _repo, detail: _detail, ...question } = args;
      const selected = selectQuestion(question);
      return await answerCodeQuestion({ selected, queries, workspace, args, jsonContent, projections,
        session });
    } catch (error) {
      return errorContent(error);
    }
  };
}

const NAVIGATION_TOOL_ARGUMENTS = new Set([
  "repo", "symbol", "path", "line", "character", "cacheDir", "verbose"
]);

export function createCodeIndexNavigationHandler({ query, workspaceRepos, jsonContent, errorContent }) {
  return createCodeIndexQueryHandler({ query, argumentNames: NAVIGATION_TOOL_ARGUMENTS,
    invalidCode: "sidecar_navigation_input_invalid", workspaceRepos, jsonContent, errorContent,
    projectFull: (result) => projectSidecarSymbolQueryForMcp(result, { verbose: true }),
    projectCompact: (result) => projectSidecarSymbolQueryForMcp(result) });
}
