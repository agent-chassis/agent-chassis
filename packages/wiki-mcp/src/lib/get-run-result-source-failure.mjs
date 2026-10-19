import { SELECTED_RESPONSE_QUERY_INVALID_CODE } from './selected-response-snapshot.mjs';
import { CONTENT_REFERENCE_RANGED_READ_UNAVAILABLE_CODE } from './mcp-response-shared.mjs';

export function retainedRunSourceFailure(error) {
  const envelope = error?.envelope;
  const invalid = envelope?.code === SELECTED_RESPONSE_QUERY_INVALID_CODE && envelope.no_supported_route === true;
  if (envelope?.code !== CONTENT_REFERENCE_RANGED_READ_UNAVAILABLE_CODE && !invalid) throw error;
  const reason = invalid ? envelope.observed_facts?.['selected_response.invalid_reason']
    : envelope.reason ?? envelope.observed_facts?.['content_reference.failed_step'];
  if (typeof reason !== 'string') throw error;
  const details = invalid ? envelope.observed_facts?.['selected_response.invalid_details'] : undefined;
  return { code: envelope.code, reason, ...(details === undefined ? {} : { details }) };
}
