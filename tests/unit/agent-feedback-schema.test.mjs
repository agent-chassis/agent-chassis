import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { validateFeedbackReport, validateFeedbackSubmission, FEEDBACK_REPORT_MAX_BYTES } from '../../packages/wiki-core/src/lib/agent-feedback-schema.mjs';

const report = { category: 'confusion', observation: '  🦊 café\n"quoted" \\ ', location: 'exchange', attempted_action: 'read' };
test('feedback reports preserve observations and validate token evidence', () => {
  const inert = { ...report, expected: 'expected', recovery: 'recovered', evidence_refs: ['https://invalid.example/never-fetch', '/inert/path'], related_feedback_id: `fbo_${randomUUID()}` };
  assert.deepEqual(validateFeedbackReport(inert), inert);
  assert.notEqual(validateFeedbackReport(inert), inert);
  const optionalEmpty = { ...report, expected: '', recovery: '  ', suggested_reduction: '' };
  assert.deepEqual(validateFeedbackReport(optionalEmpty), optionalEmpty);
  assert.deepEqual(validateFeedbackReport({ ...report, observation: '\ud800 and \u0000' }).observation, '\ud800 and \u0000');
  for (const category of ['confusion', 'limitation']) assert.equal(validateFeedbackReport({ ...report, category }).category, category);
  for (const direction of ['input', 'output', 'both']) {
    const waste = { ...report, category: 'token_waste', direction, reason: 'duplicated material', suggested_reduction: 'read once' };
    assert.deepEqual(validateFeedbackReport(waste), waste, 'counts are optional');
    for (const unit of ['tokens', 'bytes']) for (const scope of ['exchange', 'turn', 'session']) {
      const numeric = { ...waste, numeric_evidence: { value: 0, unit, source: 'agent estimate', scope } };
      assert.deepEqual(validateFeedbackReport(numeric), numeric);
    }
  }
  for (const change of [{ category: 'bad' }, { observation: ' \n' }, { location: '' }, { attempted_action: null },
    { surprise: 'unknown' }, { runtime_package: { name: 'spoof', version: '9.0.0' } }, { evidence_refs: [1] },
    { evidence_refs: Array(21).fill('x') }, { evidence_refs: ['🦊'.repeat(257)] }, { expected: null },
    { category: 'token_waste', reason: 'missing direction' }, { category: 'token_waste', direction: 'input' },
    { direction: 'incoming' }, { related_feedback_id: 'unknown' }]) {
    assert.throws(() => validateFeedbackReport({ ...report, ...change }), { code: 'feedback_input_invalid' });
  }
  const evidence = { value: 7.5, unit: 'tokens', source: 'agent', scope: 'exchange' };
  for (const change of [{ value: -1 }, { value: Infinity }, { value: NaN }, { value: '4' }, { unit: 'chars' },
    { source: ' ' }, { scope: 'call' }, { authenticated: true }]) {
    assert.throws(() => validateFeedbackReport({ ...report, numeric_evidence: { ...evidence, ...change } }), { code: 'feedback_input_invalid' });
  }
  for (const missing of Object.keys(evidence)) {
    const numeric = { ...evidence }; delete numeric[missing];
    assert.throws(() => validateFeedbackReport({ ...report, numeric_evidence: numeric }));
  }
  const base = { ...report, observation: '🦊' };
  const room = FEEDBACK_REPORT_MAX_BYTES - Buffer.byteLength(JSON.stringify(base));
  const boundary = { ...base, observation: base.observation + 'x'.repeat(room) };
  assert.equal(Buffer.byteLength(JSON.stringify(boundary)), FEEDBACK_REPORT_MAX_BYTES);
  assert.deepEqual(validateFeedbackReport(boundary), boundary);
  assert.throws(() => validateFeedbackReport({ ...boundary, observation: boundary.observation + 'x' }), { code: 'feedback_report_too_large' });
  const escaped = JSON.stringify(boundary).replace('🦊', '\\ud83e\\udd8a');
  assert.deepEqual(validateFeedbackReport(JSON.parse(escaped)), boundary);
  const session = `fbs_${randomUUID()}`;
  assert.throws(() => validateFeedbackSubmission({ session_id: [session], report }), { code: 'feedback_input_invalid' });
  assert.throws(() => validateFeedbackReport({ ...report, related_feedback_id: [`fbo_${randomUUID()}`] }), { code: 'feedback_input_invalid' });
  assert.throws(() => validateFeedbackReport({ ...report, evidence_refs: ['valid', ' ', 'valid'] }), error => error.detail.invalid_fields.some(fault => JSON.stringify(fault.path) === JSON.stringify(['report', 'evidence_refs', 1]) && fault.constraint === 'must be nonblank text'));
  assert.throws(() => validateFeedbackReport({ ...report, evidence_refs: ['valid', 'x'.repeat(1025)] }), error => error.detail.invalid_fields.some(fault => JSON.stringify(fault.path) === JSON.stringify(['report', 'evidence_refs', 1]) && /1024 UTF-8 bytes/.test(fault.constraint)));
  assert.equal(validateFeedbackSubmission({ session_id: session, report }).session_id, session);
  assert.equal(validateFeedbackSubmission({ new_session: true, report }).new_session, true);
  for (const selection of [{}, { new_session: false }, { new_session: true, session_id: session }, { session_id: 'no' }, { new_session: true, role: 'operator' }]) {
    assert.throws(() => validateFeedbackSubmission({ ...selection, report }), { code: 'feedback_input_invalid' });
  }
});


function faultsFor(input) {
  let failure;
  try { validateFeedbackSubmission(input); } catch (error) { failure = error; }
  assert.equal(failure?.code, 'feedback_input_invalid');
  assert.equal(failure.detail.effect, 'not_committed');
  return failure.detail.invalid_fields;
}

test('independent envelope, evidence and numeric faults retain authored paths together', () => {
  const input = { new_session: true, session_id: 'wrong', role: 'spoof', report: {
    ...report, category: 'token_waste', severity: 'high', location: '',
    evidence_refs: ['inert', 42, '🦊'.repeat(257)], numeric_evidence: {
      authenticated: true, value: -1, unit: 'characters', source: '', scope: 'call'
    }
  } };
  const faults = faultsFor(input);
  assert.deepEqual(faults.map(fault => fault.path), [
    ['role'], [], ['session_id'], ['report', 'severity'], ['report', 'location'],
    ['report', 'direction'], ['report', 'reason'], ['report', 'evidence_refs', 1],
    ['report', 'evidence_refs', 2], ['report', 'numeric_evidence', 'authenticated'],
    ['report', 'numeric_evidence', 'value'], ['report', 'numeric_evidence', 'unit'],
    ['report', 'numeric_evidence', 'scope'], ['report', 'numeric_evidence', 'source']
  ]);
  for (const fault of faults) assert.ok(fault.constraint.length > 0);
  assert.match(faults.find(fault => fault.path.at(-1) === 'unit').constraint, /tokens or bytes/);
  assert.doesNotMatch(JSON.stringify(faults), /spoof|high|characters|authenticated.*true/);
});

test('unresolved containers and categories stop only dependent checks', () => {
  assert.deepEqual(faultsFor({ session_id: [], report: null }).map(fault => fault.path), [['session_id'], ['report']]);
  const category = faultsFor({ new_session: true, report: { ...report, category: 'unknown', location: '', numeric_evidence: [] } });
  assert.deepEqual(category.map(fault => fault.path), [['report', 'category'], ['report', 'location'], ['report', 'numeric_evidence']]);
  assert.deepEqual(faultsFor(null), [{ path: [], constraint: 'must be an object' }]);
});

test('container bounds and independent element or size faults are collected', () => {
  const refs = Array(21).fill('inert'); refs[1] = ''; refs[20] = 42;
  const evidence = faultsFor({ new_session: true, report: { ...report, evidence_refs: refs } });
  assert.deepEqual(evidence.map(fault => fault.path), [['report', 'evidence_refs'], ['report', 'evidence_refs', 1], ['report', 'evidence_refs', 20]]);
  const blankOversized = faultsFor({ new_session: true, report: { ...report, evidence_refs: [' '.repeat(1025)] } });
  assert.deepEqual(blankOversized.map(fault => fault.path), [['report', 'evidence_refs', 0], ['report', 'evidence_refs', 0]]);
  assert.match(blankOversized[0].constraint, /nonblank text/);
  assert.match(blankOversized[1].constraint, /1024 UTF-8 bytes/);
  const oversized = faultsFor({ new_session: true, report: { ...report, observation: 'x'.repeat(FEEDBACK_REPORT_MAX_BYTES), location: '' } });
  assert.deepEqual(oversized.map(fault => fault.path), [['report', 'location'], ['report']]);
  assert.equal(oversized[1].maximum_bytes, FEEDBACK_REPORT_MAX_BYTES);
  assert.ok(oversized[1].bytes > oversized[1].maximum_bytes);
});
