import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyDispatchSubject } from '../../packages/wiki-mcp/src/lib/dispatch-subject-classifier.mjs';

function kindOf(subject) {
  return classifyDispatchSubject(subject)?.subject_kind ?? null;
}

test('classifies record WK subjects', () => {
  const recordKind = kindOf('WK-0972');

  assert.notEqual(recordKind, null);
  assert.equal(recordKind, kindOf('WK-0001'));
});

test('classifies canonical ordinal slice subjects', () => {
  const recordKind = kindOf('WK-0972');
  const initiativeKind = kindOf('IN-0011');
  const ordinalSliceKind = kindOf('WK-0972#SLICE-001');

  assert.notEqual(ordinalSliceKind, null);
  assert.notEqual(ordinalSliceKind, recordKind);
  assert.notEqual(ordinalSliceKind, initiativeKind);
});

test('classifies initiative subjects', () => {
  const initiativeKind = kindOf('IN-0011');

  assert.notEqual(initiativeKind, null);
  assert.notEqual(initiativeKind, kindOf('WK-0972'));
});

test('fail-closes malformed slice and address subjects', () => {
  const malformedSubjects = [
    'WK-0972#SLICE-21',
    'WK-0972#SLICE-0021',
    'WK-0972#SLICE-ABC',
    'WK-0972#',
    'WK-0972##SLICE-001',
  ];

  for (const subject of malformedSubjects) {
    assert.equal(kindOf(subject), null, subject);
  }
});
