

import { isDeepStrictEqual } from 'node:util';
import { realpathSync } from 'node:fs';
import { collectSidecarCheckoutInputs } from '@agent-chassis/wiki-core/src/lib/sidecar-checkout-inputs.mjs';
import { readCompleteFiles } from '@agent-chassis/wiki-core/src/lib/sidecar-occurrence-source.mjs';
import { projectFailureDiagnosis } from '@agent-chassis/wiki-core/src/lib/diagnostic-projection.mjs';
import { codeSource } from './code-index-query-meaning.mjs';
import { resolveWorkspaceRepo } from './workspace-repo-resolution.mjs';
import { FindingsSourceRefusal, resolveAuthenticatedFindingsSource,
  WIKI_MCP_AGENT_SESSION_CONTRACT_ENV_VAR, WIKI_MCP_REVIEW_MATERIALIZATION_DIR_ENV_VAR } from './launcher-run-credential.mjs';
import { selectedResponseQueryInvalidError } from './selected-response-snapshot.mjs';

const list = value => Array.isArray(value) ? value : [];
const parts = result => result.parts ? Object.values(result.parts) : [result];
const subjectPaths = result => [...new Set([result.path, ...list(result.validated_paths),
  ...parts(result).flatMap(part => list(part.complete_files).map(file => file.path))]
  .filter(value => typeof value === 'string'))];

export function createCodeReviewSource({ workspaceRepos, env }) {
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

  return {
    resolve,
    authenticate(binding) {
      if (binding.authority_identity === undefined) return;
      if (!isDeepStrictEqual(resolve()?.binding, binding.authority_identity)) {
        throw selectedResponseQueryInvalidError('query_code_index', 'source_binding_mismatch', { field: 'review_source' });
      }
    },
    async capture(result, context) {
      if (!context) return null;
      if (['no_change', 'invalid_input', 'unsupported_input'].includes(result.impact_state?.state) &&
          !list(result.narrowing_sources).length) return null;
      const paths = subjectPaths(result);
      try {
        const inputs = await collectSidecarCheckoutInputs(context.sourceRoot);
        if (parts(result).every(part => part.graph_snapshot?.base_coverage?.checkout_identity === inputs.identity)) {
          return null;
        }
        const files = await readCompleteFiles(context.sourceRoot, paths,
          new Map(inputs.files.map(file => [file.path, file])));
        return { state: parts(result).every(part => typeof part.graph_snapshot?.base_coverage?.checkout_identity === 'string')
          ? 'different_review_source' : 'review_alignment_unavailable', paths,
          files: [...files.values()].map(file => codeSource(file.entry)) };
      } catch (error) {
        const diagnosis = projectFailureDiagnosis(error);
        return { state: 'review_source_unavailable', paths, files: [],
          cause: diagnosis };
      }
    }
  };
}

function shownPaths(response) {
  const paths = new Set();
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    for (const field of ['path', 'document_path']) if (typeof value[field] === 'string') paths.add(value[field]);
    for (const [key, child] of Object.entries(value)) {
      if (!['next_calls', 'selected_detail'].includes(key)) {
        if (Array.isArray(child)) child.forEach(visit);
        else if (child && typeof child === 'object') visit(child);
      }
    }
  }
  visit(response);
  return paths;
}

export function presentCodeReviewSource(response, notice, { files = [], supplementalRead = false } = {}) {
  if (!notice) return response;
  response.review_limit = { state: notice.state,
    ...(notice.cause ? { operation: 'read_review_source' } : {}),
    meaning: 'Indexed code and relationships are supplemental; use the bound reviewed checkout for reviewed-source conclusions.',
    ...(notice.cause ? { cause: notice.cause } : {}) };
  if (!supplementalRead) {
    delete response.context_regions;
    if (response.source) delete response.source.source_text;
  }
  const paths = shownPaths(response);
  if (!paths.size) for (const path of notice.paths) paths.add(path);
  const selected = notice.choices.filter(choice => paths.has(choice.path));
  const inline = files.filter(file => paths.has(file.path) && file.state === 'available' &&
    Buffer.byteLength(file.source_text ?? '') <= 1024).slice(0, 3);
  const unavailable = selected.filter(choice => choice.state !== 'available').map(({ call: _call, ...meaning }) => meaning);
  if (inline.length || unavailable.length) response.reviewed_files = [...inline, ...unavailable];
  const delivered = new Set(inline.map(file => file.path));
  response.next_calls = [
    ...selected.filter(choice => choice.call && !delivered.has(choice.path)).map(choice => choice.call),
    ...list(response.next_calls).map(call => call.arguments?.detail ? { ...call, recommended: false,
      information: 'Inspect supplemental indexed meaning; this does not read the reviewed version.' } : call)
  ];
  if (!selected.some(choice => choice.state === 'available')) {
    response.review_limit.stopping_condition = notice.paths.length
      ? 'Exact reviewed content is unavailable for this selection; stop conclusions requiring it.'
      : 'This selection identifies no reviewed file; choose the intended file path before drawing a reviewed-source conclusion.';
  }
  return response;
}
