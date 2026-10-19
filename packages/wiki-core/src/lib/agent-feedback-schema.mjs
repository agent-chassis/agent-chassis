
export const FEEDBACK_REPORT_MAX_BYTES = 16 * 1024;
const EVIDENCE_MAX_REFERENCES = 20;
const EVIDENCE_REFERENCE_MAX_BYTES = 1024;
export const FEEDBACK_CATEGORIES = Object.freeze(['confusion', 'limitation', 'token_waste']);
export const FEEDBACK_SESSION_PATTERN = /^fbs_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const FEEDBACK_ID_PATTERN = /^fbo_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export class FeedbackError extends Error {
  constructor(code, message, detail = {}, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'FeedbackError';
    this.code = code;
    this.detail = { effect: 'not_committed', ...detail };
  }
}
export function feedbackInvalid(message) {
  return new FeedbackError('feedback_input_invalid', message);
}
export function closedFeedbackObject(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw feedbackInvalid(`${label} must be an object`);
  const unknown = Object.keys(value).filter(key => !fields.includes(key));
  if (unknown.length) throw feedbackInvalid(`${label} has unknown fields: ${unknown.join(', ')}`);
}
function nonblank(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw feedbackInvalid(`${field} must be nonblank text`);
}
export function validateFeedbackReport(report) {
  closedFeedbackObject(report, ['category', 'observation', 'location', 'attempted_action', 'expected',
    'recovery', 'related_feedback_id', 'evidence_refs', 'direction', 'reason', 'suggested_reduction', 'numeric_evidence'], 'report');
  if (!FEEDBACK_CATEGORIES.includes(report.category)) throw feedbackInvalid('category must be confusion, limitation or token_waste');
  for (const field of ['observation', 'location', 'attempted_action']) nonblank(report[field], field);
  for (const field of ['expected', 'recovery', 'reason', 'suggested_reduction']) {
    if (Object.hasOwn(report, field) && typeof report[field] !== 'string') throw feedbackInvalid(`${field} must be text`);
  }
  if (report.category === 'token_waste') {
    if (!['input', 'output', 'both'].includes(report.direction)) throw feedbackInvalid('token_waste requires direction input, output or both');
    nonblank(report.reason, 'reason');
  } else if (Object.hasOwn(report, 'direction') && !['input', 'output', 'both'].includes(report.direction)) {
    throw feedbackInvalid('direction must be input, output or both');
  }
  if (Object.hasOwn(report, 'related_feedback_id') && (typeof report.related_feedback_id !== 'string' || !FEEDBACK_ID_PATTERN.test(report.related_feedback_id))) {
    throw feedbackInvalid('related_feedback_id must be a returned fbo_ UUID');
  }
  if (Object.hasOwn(report, 'evidence_refs')) {
    if (!Array.isArray(report.evidence_refs) || report.evidence_refs.length > EVIDENCE_MAX_REFERENCES) throw feedbackInvalid(`evidence_refs must be an array of at most ${EVIDENCE_MAX_REFERENCES} inert references`);
    for (const [index, ref] of report.evidence_refs.entries()) {
      nonblank(ref, `evidence_refs[${index}]`);
      if (Buffer.byteLength(ref, 'utf8') > EVIDENCE_REFERENCE_MAX_BYTES) throw feedbackInvalid(`evidence_refs[${index}] accepts at most ${EVIDENCE_REFERENCE_MAX_BYTES} UTF-8 bytes`);
    }
  }
  if (Object.hasOwn(report, 'numeric_evidence')) {
    const evidence = report.numeric_evidence;
    closedFeedbackObject(evidence, ['value', 'unit', 'source', 'scope'], 'numeric_evidence');
    if (typeof evidence.value !== 'number' || !Number.isFinite(evidence.value) || evidence.value < 0) throw feedbackInvalid('numeric_evidence.value must be finite and nonnegative');
    if (!['tokens', 'bytes'].includes(evidence.unit)) throw feedbackInvalid('numeric_evidence.unit must be tokens or bytes');
    if (!['exchange', 'turn', 'session'].includes(evidence.scope)) throw feedbackInvalid('numeric_evidence.scope must be exchange, turn or session');
    nonblank(evidence.source, 'numeric_evidence.source');
  }
  const bytes = Buffer.byteLength(JSON.stringify(report), 'utf8');
  if (bytes > FEEDBACK_REPORT_MAX_BYTES) throw new FeedbackError('feedback_report_too_large',
    'Parsed report exceeds its UTF-8 byte limit', { bytes, maximum_bytes: FEEDBACK_REPORT_MAX_BYTES });
  return JSON.parse(JSON.stringify(report));
}
export function validateFeedbackSubmission(input) {
  closedFeedbackObject(input, ['report', 'new_session', 'session_id'], 'submission');
  if (Object.hasOwn(input, 'new_session') && input.new_session !== true) throw feedbackInvalid('new_session, when present, must be true');
  if ((input.new_session === true) === Object.hasOwn(input, 'session_id')) throw feedbackInvalid('Supply exactly one new_session=true or session_id');
  if (Object.hasOwn(input, 'session_id') && (typeof input.session_id !== 'string' || !FEEDBACK_SESSION_PATTERN.test(input.session_id))) throw feedbackInvalid('session_id must be a returned fbs_ UUID');
  return { ...input, report: validateFeedbackReport(input.report) };
}

export function feedbackSubmissionInputSchema(z) {
  const report = z.object({
    category: z.enum([...FEEDBACK_CATEGORIES]).describe('confusion: unclear behavior; limitation: blocked capability; token_waste: excessive model input/output.'),
    observation: z.string().describe('Nonblank text; preserved verbatim.'),
    location: z.string().describe('Nonblank text.'), attempted_action: z.string().describe('Nonblank text.'),
    expected: z.string().optional(), recovery: z.string().optional(),
    related_feedback_id: z.string().describe('Existing returned fbo_ UUID (version 4).').optional(),
    evidence_refs: z.array(z.string()).describe(`At most ${EVIDENCE_MAX_REFERENCES} inert, nonblank references, each <= ${EVIDENCE_REFERENCE_MAX_BYTES} UTF-8 bytes.`).optional(),
    direction: z.enum(['input', 'output', 'both']).describe('Required for token_waste. Input: consumed responses; output: generated requests/answers.').optional(),
    reason: z.string().describe('Nonblank text required for token_waste.').optional(),
    suggested_reduction: z.string().optional(),
    numeric_evidence: z.object({ value: z.number().describe('Finite and nonnegative.'),
      unit: z.enum(['tokens', 'bytes']), source: z.string().describe('Nonblank text.'),
      scope: z.enum(['exchange', 'turn', 'session']) }).strict().describe('Optional agent-reported evidence.').optional()
  }).strict().describe(`Parsed report JSON accepts at most ${FEEDBACK_REPORT_MAX_BYTES} UTF-8 bytes.`);
  return z.object({ new_session: z.literal(true).describe('Create only when no feedback session handle is available.').optional(),
    session_id: z.string().describe('Returned fbs_ UUID (version 4); reuse across observations, compaction and resume.').optional(), report
  }).strict().describe('Supply exactly one of new_session:true or a returned session_id.');
}
