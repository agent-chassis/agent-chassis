

import { SidecarPathValidationError } from '@agent-chassis/wiki-core/src/lib/sidecar-paths.mjs';
import { buildNextCall } from '@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs';
import { projectFailureDiagnosis } from '@agent-chassis/wiki-core/src/lib/diagnostic-projection.mjs';
import { projectToolInputValidationFailure } from './register-tool.mjs';
import { enrichValidationIssue, validationConstraintContext } from './tool-validation-constraints.mjs';
import { CODE_INDEX_QUERY_ROUTE } from './code-index-query-contract.mjs';
import { resolveWorkspaceRepo } from './workspace-repo-resolution.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const atPrefix = (issue, prefix) => ({ ...issue, path: [...prefix, ...issue.path],
  ...(issue.unionErrors ? { unionErrors: issue.unionErrors.map(branch => ({
    issues: branch.issues.map(child => atPrefix(child, prefix))
  })) } : {}) });

function inputGuidance({ supplied, inputSchema, issues, prefix, alternatives, selectedEnvelope }) {
  const keys = object(supplied) ? Object.keys(supplied) : [];
  const preserve = keys.filter(key => Object.hasOwn(inputSchema.shape, key));
  const selected = preserve.length > 0 || selectedEnvelope;
  const guidance = { ...(preserve.length ? { preserve_inputs: preserve } : {}) };
  if (!selected) {
    guidance.supported_questions = [...alternatives];
    guidance.symbol_input = inputSchema.shape.symbol.unwrap().description;
    guidance.position_inputs = [inputSchema.shape.line.unwrap().description, inputSchema.shape.character.unwrap().description];
    guidance.missing_inputs = ['Choose the supported question and its required subject; no indexed path or symbol was inferred.'];
  }
  if (keys.some(key => ['operation', 'query', 'queries', 'reads'].includes(key))) {
    guidance.unsupported_intent = 'General text search, operation/query forms and batch envelopes are not supported. Query text is not an indexed symbol; status is not a substitute for a code question.';
  }
  const rules = issues.flatMap(issue => {
    const path = issue.path.slice(prefix.length);
    if (path.length !== 1 || path[0] === 'detail' || path[0] === 'status') return [];
    const description = inputSchema.shape[path[0]]?.unwrap().description;
    return description ? [{ path: issue.path, description }] : [];
  });
  if (rules.length) guidance.input_rules = rules;
  return guidance;
}

export async function projectCodeIndexInputFailure({ args, validationError, inputSchema, contracts, session, workspaceRepos, codeIntelligence }) {
  const { alternatives } = codeIntelligence.vocabulary;
  const keys = args !== null && typeof args === 'object' && !Array.isArray(args) ? Object.keys(args) : [];
  const envelope = keys.length === 1 && ['queries', 'reads'].includes(keys[0]) ? keys[0] : null;
  const questions = envelope && Array.isArray(args[envelope]) ? args[envelope] : null;
  const candidate = questions?.length === 1 ? questions[0] : null;
  const supplied = candidate ?? args;
  const parsed = candidate === null ? null : inputSchema.safeParse(candidate);
  const context = validationConstraintContext(inputSchema);

  const enrich = (issue, value) => issue.code === 'unrecognized_keys' && issue.path.length === 0
    ? issue : enrichValidationIssue(issue, context, value);

  const issues = [...validationError.issues.map(issue => enrich(issue, args)),
    ...(parsed?.success === false ? parsed.error.issues.map(issue =>
      atPrefix(enrich(issue, candidate), [envelope, 0])) : [])];
  const selectedEnvelope = questions?.some(question => object(question) &&
    Object.keys(question).some(key => Object.hasOwn(inputSchema.shape, key)));
  const guidance = inputGuidance({ supplied, inputSchema, issues, prefix: candidate === null ? [] : [envelope, 0],
    alternatives, selectedEnvelope });
  if (questions) guidance.unexecuted_questions = questions.length;
  let corrected = null;
  if (questions && questions.length !== 1) {
    guidance.missing_inputs = ['Choose one complete question to submit at the root. Batch envelopes are unsupported; every supplied question remains unexecuted.'];
  } else if (candidate !== null) {
    if (parsed.success) {
      try {
        if (candidate.detail !== undefined) {
          if (Object.keys(candidate).length !== 1) {
            guidance.missing_inputs = ['Choose the retained read or the code question; preserve its source binding and every intended query constraint.'];
          } else {
            session.validate({ repository: resolveWorkspaceRepo(workspaceRepos).repo, detail: candidate.detail });
            corrected = candidate;
          }
        } else if (candidate.status !== undefined) {
          if (Object.keys(candidate).length === 1) corrected = candidate;
          else guidance.missing_inputs = ['Choose the explicit status request or the code question; neither replaces the other.'];
        } else {
          codeIntelligence.normalizeSidecarCodeQuestionInput(candidate);
          corrected = candidate;
        }
      } catch (error) {
        if (!['sidecar_query_input_invalid', 'sidecar_navigation_input_invalid'].includes(error?.code) &&
            !(error instanceof SidecarPathValidationError) && error?.envelope === undefined) throw error;
        guidance.cause = projectFailureDiagnosis(error);

        if (error.alternatives) delete guidance.supported_questions;
      }
    }
  }
  if (corrected !== null) {
    const contract = contracts?.contractFor(CODE_INDEX_QUERY_ROUTE);
    if (!contract || !await contract.acceptsArguments(corrected)) {
      corrected = null;
      guidance.missing_inputs = [contract
        ? 'The serving request contract rejects this proposed correction; choose a supported request before executing.'
        : 'The serving request contract is unavailable; no executable correction can be validated.'];
    }
  }
  const response = await projectToolInputValidationFailure({ tool: CODE_INDEX_QUERY_ROUTE, args, validationError,
    ownerDiagnostics: issues, ...(corrected === null ? { ownerGuidance: guidance } : {}) });
  response.effects = { question_executed: false, detail_served: false };
  if (corrected === null) response.correction = object(supplied) && Object.hasOwn(supplied, 'detail')
    ? 'Correct the reported retained-read fields using the held source binding, collection and valid selectors. Explicitly resolve unsupported work; a read returns the complete chosen selection.'
    : 'Correct the reported fields using the held request. Preserve its complete subject and valid constraints; explicitly resolve unsupported work before submitting again.';
  if (corrected !== null) {
    response.correction = 'The envelope was not executed. Submit the unchanged complete request below at the root only if this is the intended action; existing authorization still applies.';
    response.next_calls = [{ ...buildNextCall({ tool: CODE_INDEX_QUERY_ROUTE, arguments: structuredClone(corrected),
      purpose: 'correct_request' }), recommended: false }];
  }
  return response;
}
