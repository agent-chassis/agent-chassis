
import { projectPublicFinalResult } from './dispatch-final-result-projection.mjs';
import { distillDispatchFailureDetail } from './dispatch-tool-helpers.mjs';

export function publicFinalResult(result) {
  const projected = projectPublicFinalResult(result);
  if (projected == null || typeof projected !== "object") return projected;
  const { schema_version: _schema, structured_role_result: _parser, text_projection: _projection, result_mode: _mode,
    advisory_review: advisory, ...meaning } = projected;
  for (const field of ["findings", "no_findings", "missing_result", "full_response", "writeback"]) {
    if (meaning[field] == null) delete meaning[field];
  }
  if (meaning.missing_result != null && typeof meaning.missing_result === 'object') {
    const { retained_evidence: _retention, ...cause } = meaning.missing_result;
    meaning.missing_result = cause;
  }
  if (meaning.writeback?.kind === "no_writeback_expected") delete meaning.writeback;
  if (meaning.full_response != null) {
    const { source: _source, ...response } = meaning.full_response;
    if (response.format == null) delete response.format;
    meaning.full_response = response;
  }
  for (const field of ["findings", "no_findings"]) {
    if (meaning[field] == null || typeof meaning[field] !== "object" || Array.isArray(meaning[field])) continue;
    const value = { ...meaning[field] };
    if (field === "no_findings") {
      delete value.source;
      for (const key of ["reason", "format", "text"]) if (value[key] == null) delete value[key];
    }
    if (value.text_reference?.reason === "duplicate_text") delete value.text_reference;
    if (Object.keys(value).length === 0) delete meaning[field];
    else meaning[field] = value;
  }
  const review = {};
  if (typeof advisory?.advisory_output?.text === "string") {
    review.advisory_output = { text: advisory.advisory_output.text };
  }
  if (advisory?.formal_attestation?.requested === true) {
    const { requested: _requested, ...formal } = advisory.formal_attestation;
    review.formal_attestation = formal;
  }
  if (Object.keys(review).length > 0) meaning.advisory_review = review;
  return meaning;
}

export function runResultMeaning(final) {
  const value = publicFinalResult(final);
  const hasMeaning = value != null && Object.entries(value).some(([key, entry]) => {
    if (['kind', 'missing_result'].includes(key)) return false;
    if (key === 'full_response') return typeof entry?.text === 'string' && entry.text.length > 0;
    return entry != null && (typeof entry !== 'object' || Object.keys(entry).length > 0);
  });
  const missing = value?.kind === 'missing_result';
  const unavailable = missing && !hasMeaning;
  return { value, unavailable, facts: {
    ...(value?.missing_result == null ? {} : { result_failure:
      distillDispatchFailureDetail(value.missing_result, { nested: true }).detail }),
    ...(missing ? { result_outcome: unavailable ? 'unavailable' : 'partial' } : {}),
    ...(unavailable ? { result_limitation: { message:
      'Stop report-dependent work. Process success supplies no review findings or task-completion evidence.' } } : {})
  } };
}
