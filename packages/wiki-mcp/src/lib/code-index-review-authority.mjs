import { isDeepStrictEqual } from 'node:util';
import { realpathSync } from 'node:fs';
import { resolveWorkspaceRepo } from './workspace-repo-resolution.mjs';
import { FindingsSourceRefusal, resolveAuthenticatedFindingsSource,
  WIKI_MCP_AGENT_SESSION_CONTRACT_ENV_VAR, WIKI_MCP_REVIEW_MATERIALIZATION_DIR_ENV_VAR } from './launcher-run-credential.mjs';
import { selectedResponseQueryInvalidError } from './selected-response-snapshot.mjs';
import { buildNextCall } from '@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs';

export function createCodeReviewAuthority({ workspaceRepos, env }) {
  function resolve() {
    if (!['reviewer', 'redteam'].includes(env.WIKI_MCP_TOOL_PROFILE) ||
        ![WIKI_MCP_AGENT_SESSION_CONTRACT_ENV_VAR, WIKI_MCP_REVIEW_MATERIALIZATION_DIR_ENV_VAR]
          .some(name => String(env[name] ?? '').trim())) return null;
    try {
      const source = resolveAuthenticatedFindingsSource(env);
      if (source.repositoryRoot !== realpathSync(resolveWorkspaceRepo(workspaceRepos).dir)) {
        throw new FindingsSourceRefusal('advisory_review_source_binding_mismatch',
          'The query repository does not match the authenticated review repository.', { assigned_unit: source.assignedUnit });
      }
      return source;
    } catch (error) {
      if (!(error instanceof FindingsSourceRefusal)) throw error;
      error.envelope = { accepted: false, code: error.code,
        cause: { code: error.code, message: error.message },
        ...(error.subject?.assigned_unit ? { subject: { unit: error.subject.assigned_unit } } : {}),
        effects: { index_query_executed: false }, next_calls: [],
        recovery: { state: 'no_supported_route',
          condition: 'This read cannot repair or replace its authenticated review source; conclusions requiring that source must stop.' } };
      throw error;
    }
  }

  return Object.freeze({
    resolve,
    authenticate(binding) {
      if (binding.authority_identity === undefined) return;
      if (!isDeepStrictEqual(resolve()?.binding, binding.authority_identity)) {
        throw selectedResponseQueryInvalidError('query_code_index', 'source_binding_mismatch', { field: 'review_source' });
      }
    }
  });
}

const PREPARATION_TOOL = "workspace_code_index_build";
const PREPARATION_PURPOSE = "prepare_index";

export function createCodeIndexPreparationGuidance(contracts = null) {
  return async () => {
    const contract = contracts?.contractFor(PREPARATION_TOOL) ?? null;
    if (contract === null || !await contract.acceptsArguments({})) {
      return { state: "capability_unavailable", call: null,
        slot: { state: "capability_unavailable", missing_capability: "prepare_code_index" },
        sentence: "This session has no registered operation that prepares the code index " +
          "(preparation.missing_capability)." };
    }
    return { state: "action_available",
      call: { ...buildNextCall({ tool: PREPARATION_TOOL, arguments: {} }), purpose: PREPARATION_PURPOSE },
      slot: { state: "action_available", operation: PREPARATION_TOOL },
      sentence: `Call ${PREPARATION_TOOL} with {} (next_calls, purpose ${PREPARATION_PURPOSE}) to prepare ` +
        "current HEAD and wait." };
  };
}

