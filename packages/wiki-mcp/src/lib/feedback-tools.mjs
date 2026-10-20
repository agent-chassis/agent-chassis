import { recordAgentFeedback, feedbackRefusal } from '@agent-chassis/wiki-core/src/operations/agent-feedback.mjs';
import { FeedbackError, feedbackSubmissionInputSchema, validateFeedbackSubmission } from '@agent-chassis/wiki-core/src/lib/agent-feedback-schema.mjs';
import { bindRepositoryLocalStateRoot } from '@agent-chassis/wiki-core/src/lib/repository-local-state-root.mjs';
import { shouldExposeTool } from './tool-profile.mjs';
import { guardToolHandler, jsonContent } from './mcp-response.mjs';
import { registeredToolRequestContracts } from './registered-tool-request-contracts.mjs';
import { buildGuidanceCall, requestContractErrors } from '@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs';

export function registerFeedbackTools({ registerTool, z, workspace, sessionRole, responseEnv, packageDocsCarrier = null, docsCarrier = null }) {
  const recordInput = feedbackSubmissionInputSchema(z);
  const requestContracts = registeredToolRequestContracts(registerTool);
  const directory = workspace.dir;
  if (typeof directory !== 'string') throw new TypeError('Feedback registration needs the configured workspace.dir');

  let repositoryBinding, bindingError;
  try { repositoryBinding = bindRepositoryLocalStateRoot(directory); } catch (error) {
    if (!(error instanceof FeedbackError)) throw error;
    bindingError = error;
  }
  const refuse = async error => {
    const result = feedbackRefusal(error);
    if (bindingError === error) result.correction.action =
      'Feedback repository binding failed at server startup and remains unavailable in this server. ' +
      'There is no agent rebind or restart call. Stop reporting and continue the original work.';

    const reader = requestContracts?.contractFor('workspace_read_wiki');
    const args = { reads: [{ reference: { tool_name: 'workspace_record_feedback', path: 'docs/agent-feedback.md' },
      select: { field: 'text' } }] };
    if (error.code === 'feedback_input_invalid' && reader && await reader.acceptsArguments(args) &&
        requestContractErrors(reader.toolName, args, reader.publishedRequestSchema()).length === 0 &&
        docsCarrier?.bound === true && docsCarrier.servesLogicalPath(args.reads[0].reference.path)) {
      result.next_calls = [buildGuidanceCall({
        tool: 'workspace_read_wiki', arguments: args, information: 'Optional submission and correction rules; read only.'
      }, { requestSchema: reader.publishedRequestSchema(), registeredTools: name => name === reader.toolName })];
    }
    return { ...jsonContent(result, { env: responseEnv }), isError: true };
  };
  const validation = async ({ args, validationError }) => {

    try { validateFeedbackSubmission(args); } catch (error) {
      if (!(error instanceof FeedbackError)) throw error;
      return { terminal_result: await refuse(error) };
    }
    throw new Error('Feedback declaration rejected input accepted by the feedback validator', { cause: validationError });
  };
  const handle = fn => guardToolHandler(async args => {
    try {
      if (bindingError) throw bindingError;
      return await fn(args);
    } catch (error) {
      if (!(error instanceof FeedbackError)) throw error;
      return refuse(error);
    }
  }, { env: responseEnv });
  if (shouldExposeTool(sessionRole, 'workspace_record_feedback')) registerTool('workspace_record_feedback', {
    description: 'Record useful factual confusion, limitation or token waste during authorized work. Give observation, location and attempted_action; do not guess causes or report every routine corrected error. Choose exactly one session selector; reuse a retained session. Counts and suggestions are optional. Advisory only: no new authority or completion gate. After acknowledgment continue the original work. If feedback is unavailable or acknowledgment uncertain, stop reporting; do not retry or submit a persistence probe.',
    inputSchema: recordInput, advertisedInputSchema: recordInput, inputValidationErrorProjector: validation
  }, handle(async args => {
    const receipt = await recordAgentFeedback({ repositoryBinding, submission: args, transport: 'mcp', role: sessionRole,
      corePackage: packageDocsCarrier === null ? null
        : { name: packageDocsCarrier.packageName, version: packageDocsCarrier.packageVersion } });
    return jsonContent({ saved: true, ...receipt, next_calls: [] }, { env: responseEnv });
  }));
}
