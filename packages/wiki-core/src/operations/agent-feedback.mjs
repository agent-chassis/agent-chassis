import { resolveRepositoryLocalStateRoot } from '../lib/repository-local-state-root.mjs';
import { resolvePackageIdentity } from '../lib/wiki-package-provenance.mjs';
import { appendFeedback } from '../lib/agent-feedback-store.mjs';
import { FeedbackError, validateFeedbackSubmission } from '../lib/agent-feedback-schema.mjs';
import { forwardRefusal } from '../lib/refusal-payload.mjs';

export function feedbackRefusal(error) {
  if (!(error instanceof FeedbackError)) throw error;
  const { directory: _directory, retryable: _retryable, effects: _effects, ...detail } = error.detail;
  const committed = detail.effect === 'committed';
  return forwardRefusal(error.code, { message: error.message, ...detail,
    saved: committed, next_calls: [], correction: {
      action: committed
        ? 'The observation was committed; closing storage failed. Do not resubmit it; continue the original work.'
        : detail.effect === 'possibly_committed'
          ? 'Recording may have committed. Retain available tentative IDs; they are not proof of persistence. No feedback lookup is supported. Do not resubmit this observation; continue the original work.'
          : correctionFor(error.code)
    } });
}
function correctionFor(code) {
  switch (code) {
    case 'feedback_report_too_large': return 'Author a sufficient concise observation within the stated limit, or stop feedback and continue work. Do not silently truncate it; whitespace minification does not reduce the parsed size.';
    case 'feedback_stdin_too_large': return 'Minify the same lossless JSON to fit the 256 KiB raw stdin transport.';
    case 'feedback_input_invalid': return 'Correct the input with known facts, preserving session and relation intent; otherwise stop feedback and continue work.';
    case 'feedback_busy': return 'Stop reporting and continue the original work; do not poll or automatically retry.';
    case 'feedback_session_unknown': return 'Choose a known returned session_id from this repository, or explicitly choose new_session:true when no usable handle is available. Do not guess an identity. Otherwise stop reporting and continue the original work.';
    case 'feedback_reference_unknown': return 'Supply a known returned related_feedback_id from this repository. Omit it only if you explicitly intend an independent observation; otherwise stop reporting. No feedback lookup is supported.';
    default: return 'Feedback is unavailable for the named cause. No tool recovery is supported here; stop reporting and continue the original work. Do not delete or rebuild storage or submit a recovery probe.';
  }
}
export async function recordAgentFeedback({ directory, repositoryBinding = null, submission, transport, role = null, corePackage = null }, deps = {}) {
  const input = validateFeedbackSubmission(submission);
  let runtimePackage;
  try { runtimePackage = resolvePackageIdentity(); } catch (cause) {
    throw new FeedbackError('feedback_provenance_invalid', cause.message, {}, cause);
  }
  if (runtimePackage.name !== '@agent-chassis/wiki-core') throw new FeedbackError('feedback_provenance_invalid',
    `Executing manifest must declare @agent-chassis/wiki-core; found ${runtimePackage.name}`);
  if (corePackage !== null && (corePackage.name !== '@agent-chassis/core' ||
      typeof corePackage.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/.test(corePackage.version))) {
    throw new FeedbackError('feedback_provenance_invalid', 'Core carrier has invalid package identity');
  }
  if (!['cli', 'mcp'].includes(transport) || (role !== null && !['operator', 'orchestrator', 'worker', 'reviewer', 'redteam'].includes(role))) {
    throw new FeedbackError('feedback_provenance_invalid', 'Host feedback transport/role is invalid');
  }
  const paths = repositoryBinding === null ? resolveRepositoryLocalStateRoot(directory) : repositoryBinding.resolve();
  return appendFeedback(paths, input, { runtime_package: runtimePackage,
    core_package: corePackage, transport, role }, deps);
}
