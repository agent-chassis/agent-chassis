import assert from 'node:assert/strict';
import test from 'node:test';
import { candidateInspectionView } from '../../packages/wiki-mcp/src/lib/task-inspect-candidate-view.mjs';

const subject = { unit: 'WK-1634' };
const selection = { kind: 'current' };

test('failed review comparison is unknown while independently observed candidate state survives', () => {
  const { answer, detail } = candidateInspectionView({ subject, selection, state: 'candidate_healthy',
    review_consumer: { compatibility: 'incompatible', subject: 'WK-1634#SLICE-008',
      cause: 'review_lifecycle_inadmissible', recovery: { prerequisite: 'change the review designation' } },
    diagnostic: { operation: 'compare_review_contract', condition: 'review_lifecycle_inadmissible',
      cause_chain: [{ name: 'RangeError', message: 'Review comparison exhausted its input range.' }] } });
  assert.equal(answer.state, 'candidate_healthy');
  assert.equal(answer.review_consumer.compatibility, null);
  assert.equal(answer.review_consumer.cause, 'RangeError');
  assert.match(answer.diagnostic.cause_chain[0].message, /exhausted its input range/u);
  assert.doesNotMatch(JSON.stringify(answer), /change the review designation/u);
  assert.deepEqual(answer.next_calls, []);
  assert.equal(detail, null);
});

test('unavailable selected history keeps its exact question and deciding cause without an unrelated retry', () => {
  const historical = { kind: 'historical', version: 'a'.repeat(64) };
  const { answer, detail } = candidateInspectionView({ code: 'candidate_version_missing',
    carried: { subject, selection: historical,
      diagnostic: { condition: 'candidate_version_missing', uncertainty: 'Selected version could not be verified.',
        cause_chain: [{ name: 'CandidateError', code: 'candidate_version_missing',
          message: 'The selected immutable version is absent.', detail: { field: 'version_ref',
            ref: 'private-ref', expected: 'private-tuple' } }] } },
    recovery: { state: 'no_supported_route', retry_condition: 'choose an existing version' } });
  assert.equal(answer.state, 'candidate_unavailable');
  assert.deepEqual(answer.selection, historical);
  assert.equal(answer.code, 'candidate_version_missing');
  assert.equal(answer.diagnostic.cause_chain[0].field, 'version_ref');
  assert.equal(answer.diagnostic.cause_chain[0].message, 'The selected immutable version is absent.');
  assert.equal(answer.diagnostic.uncertainty, 'Selected version could not be verified.');
  assert.deepEqual(answer.effects, { observation_only: true });
  assert.match(answer.recovery.prerequisite, /same selected immutable version/u);
  assert.doesNotMatch(JSON.stringify(answer), /choose an existing version|private-ref|private-tuple/u);
  assert.deepEqual(answer.next_calls, []);
  assert.equal(detail, null);
});

test('a recovered movement notice replaces discarded authentication tuples', () => {
  const { answer } = candidateInspectionView({ subject, selection, state: 'candidate_absent',
    automatic_correction: { original_condition: { expected: 'discarded-candidate', ref: 'private-current-ref' },
      verified_outcome: { observed: true, state: 'candidate_absent' } } });
  assert.equal(answer.state, 'candidate_absent');
  assert.match(answer.notice, /fresh observation established/u);
  assert.doesNotMatch(JSON.stringify(answer), /discarded-candidate|private-current-ref/u);
  assert.deepEqual(answer.next_calls, []);
});

test('a native Git deciding diagnosis survives without its internal invocation inventory', () => {
  const gitDiagnosis = { capture: 'captured', diagnostics: [{ msg: 'cannot read the candidate object: permission denied',
    fmt: 'cannot read the candidate object: %s' }] };
  const { answer } = candidateInspectionView({ code: 'candidate_git_read_failed',
    carried: { subject, selection, diagnostic: { condition: 'candidate_git_read_failed',
      cause_chain: [{ name: 'CandidateError', message: 'Candidate observation failed.' }],
      candidate_failure: { detail: { git_diagnosis: gitDiagnosis, git_status: 128, git_operation: 'cat-file',
        git_args: ['private-invocation'], git_stderr_bytes: 500, git_ref: 'private-ref' } } } },
    recovery: { state: 'no_supported_route', prerequisite: 'The diagnosed candidate object read must succeed.' } });
  assert.deepEqual(answer.diagnostic.git_diagnosis, gitDiagnosis);
  assert.equal(answer.diagnostic.git_status, 128);
  assert.equal(answer.diagnostic.git_operation, 'cat-file');
  assert.doesNotMatch(JSON.stringify(answer), /private-invocation|private-ref|git_stderr_bytes/u);
});
