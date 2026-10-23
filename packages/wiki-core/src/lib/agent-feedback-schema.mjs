
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
const REPORT_FIELDS = ['category', 'observation', 'location', 'attempted_action', 'expected',
  'recovery', 'related_feedback_id', 'evidence_refs', 'direction', 'reason', 'suggested_reduction', 'numeric_evidence'];

function closedObject(value, fields, path, faults) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    faults.push({ path, constraint: 'must be an object' });
    return false;
  }
  for (const key of Object.keys(value)) if (!fields.includes(key)) {
    faults.push({ path: [...path, key], constraint: 'is not a supported field; remove it' });
  }
  return true;
}
function nonblank(value, path, faults) {
  if (typeof value !== 'string' || !value.trim()) {
    faults.push({ path, constraint: 'must be nonblank text' });
    return false;
  }
  return true;
}
function reportFaults(report, faults) {
  const path = ['report'];
  if (!closedObject(report, REPORT_FIELDS, path, faults)) return;
  if (!FEEDBACK_CATEGORIES.includes(report.category)) faults.push({ path: [...path, 'category'],
    constraint: 'must be confusion, limitation or token_waste' });
  for (const field of ['observation', 'location', 'attempted_action']) nonblank(report[field], [...path, field], faults);
  for (const field of ['expected', 'recovery', 'suggested_reduction']) {
    if (Object.hasOwn(report, field) && typeof report[field] !== 'string') {
      faults.push({ path: [...path, field], constraint: 'must be text' });
    }
  }
  if (report.category === 'token_waste') {
    if (!['input', 'output', 'both'].includes(report.direction)) faults.push({ path: [...path, 'direction'],
      constraint: 'token_waste requires direction input, output or both' });
    nonblank(report.reason, [...path, 'reason'], faults);
  } else {
    if (Object.hasOwn(report, 'direction') && !['input', 'output', 'both'].includes(report.direction)) {
      faults.push({ path: [...path, 'direction'], constraint: 'must be input, output or both' });
    }
    if (Object.hasOwn(report, 'reason') && typeof report.reason !== 'string') {
      faults.push({ path: [...path, 'reason'], constraint: 'must be text' });
    }
  }
  if (Object.hasOwn(report, 'related_feedback_id') && (typeof report.related_feedback_id !== 'string' || !FEEDBACK_ID_PATTERN.test(report.related_feedback_id))) {
    faults.push({ path: [...path, 'related_feedback_id'], constraint: 'must be a returned fbo_ UUID (version 4)' });
  }
  if (Object.hasOwn(report, 'evidence_refs')) {
    if (!Array.isArray(report.evidence_refs)) {
      faults.push({ path: [...path, 'evidence_refs'], constraint: `must be an array of at most ${EVIDENCE_MAX_REFERENCES} inert references` });
    } else {
      if (report.evidence_refs.length > EVIDENCE_MAX_REFERENCES) faults.push({ path: [...path, 'evidence_refs'],
        constraint: `must contain at most ${EVIDENCE_MAX_REFERENCES} inert references` });
      for (const [index, ref] of report.evidence_refs.entries()) {
        const refPath = [...path, 'evidence_refs', index];
        nonblank(ref, refPath, faults);
        if (typeof ref === 'string' && Buffer.byteLength(ref, 'utf8') > EVIDENCE_REFERENCE_MAX_BYTES) {
          faults.push({ path: refPath, constraint: `accepts at most ${EVIDENCE_REFERENCE_MAX_BYTES} UTF-8 bytes` });
        }
      }
    }
  }
  if (Object.hasOwn(report, 'numeric_evidence')) {
    const evidence = report.numeric_evidence, evidencePath = [...path, 'numeric_evidence'];
    if (closedObject(evidence, ['value', 'unit', 'source', 'scope'], evidencePath, faults)) {
      if (typeof evidence.value !== 'number' || !Number.isFinite(evidence.value) || evidence.value < 0) faults.push({
        path: [...evidencePath, 'value'], constraint: 'must be finite and nonnegative' });
      if (!['tokens', 'bytes'].includes(evidence.unit)) faults.push({ path: [...evidencePath, 'unit'], constraint: 'must be tokens or bytes' });
      if (!['exchange', 'turn', 'session'].includes(evidence.scope)) faults.push({ path: [...evidencePath, 'scope'], constraint: 'must be exchange, turn or session' });
      nonblank(evidence.source, [...evidencePath, 'source'], faults);
    }
  }
  const bytes = Buffer.byteLength(JSON.stringify(report), 'utf8');
  if (bytes > FEEDBACK_REPORT_MAX_BYTES) faults.push({ path,
    constraint: `parsed report JSON accepts at most ${FEEDBACK_REPORT_MAX_BYTES} UTF-8 bytes`,
    bytes, maximum_bytes: FEEDBACK_REPORT_MAX_BYTES });
}
function rejectFaults(faults) {
  if (faults.length === 1 && faults[0].maximum_bytes !== undefined) {
    const { bytes, maximum_bytes } = faults[0];
    throw new FeedbackError('feedback_report_too_large', 'Parsed report exceeds its UTF-8 byte limit', { bytes, maximum_bytes });
  }
  if (faults.length) throw new FeedbackError('feedback_input_invalid', 'Invalid feedback input', { invalid_fields: faults });
}
export function validateFeedbackReport(report) {
  const faults = [];
  reportFaults(report, faults);
  rejectFaults(faults);
  return JSON.parse(JSON.stringify(report));
}
export function validateFeedbackSubmission(input) {
  const faults = [];
  if (closedObject(input, ['report', 'new_session', 'session_id'], [], faults)) {
    if (Object.hasOwn(input, 'new_session') && input.new_session !== true) faults.push({ path: ['new_session'],
      constraint: 'when present, must be true' });
    if ((input.new_session === true) === Object.hasOwn(input, 'session_id')) faults.push({ path: [],
      constraint: 'supply exactly one new_session=true or session_id; preserve the intended session choice' });
    if (Object.hasOwn(input, 'session_id') && (typeof input.session_id !== 'string' || !FEEDBACK_SESSION_PATTERN.test(input.session_id))) {
      faults.push({ path: ['session_id'], constraint: 'must be a returned fbs_ UUID (version 4)' });
    }
    reportFaults(input.report, faults);
  }
  rejectFaults(faults);
  return { ...input, report: JSON.parse(JSON.stringify(input.report)) };
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
