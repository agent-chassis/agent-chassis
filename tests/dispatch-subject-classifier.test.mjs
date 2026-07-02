import assert from 'node:assert/strict';
import test from 'node:test';

import * as subjectClassifier from '../packages/wiki-mcp/src/lib/dispatch-subject-classifier.mjs';

const classify =
  subjectClassifier.classifyDispatchSubject ??
  subjectClassifier.classifySubject ??
  subjectClassifier.dispatchSubjectClassifier ??
  subjectClassifier.default ??
  Object.entries(subjectClassifier).find(
    ([name, value]) => typeof value === 'function' && /classify|subject/i.test(name),
  )?.[1] ??
  Object.entries(subjectClassifier).find(([, value]) => typeof value === 'function')?.[1];

if (typeof classify !== 'function') {
  throw new Error('dispatch subject classifier export was not found');
}

function kindOf(subject) {
  const result = classify(subject);

  if (result == null) {
    return null;
  }

  if (typeof result === 'string') {
    return result;
  }

  return (
    result.kind ??
    result.subject_kind ??
    result.subjectKind ??
    result.unit?.kind ??
    result.unitKind ??
    null
  );
}

test('classifies record WK subjects', () => {
  const recordKind = kindOf('WK-0972');

  assert.notEqual(recordKind, null);
  assert.equal(recordKind, kindOf('WK-0001'));
});

test('classifies canonical ordinal and grandfathered semantic slice subjects', () => {
  const recordKind = kindOf('WK-0972');
  const initiativeKind = kindOf('IN-0011');
  const ordinalSliceKind = kindOf('WK-0972#SLICE-001');
  const semanticSliceKind = kindOf('WK-0972#capture-final-response');

  assert.notEqual(ordinalSliceKind, null);
  assert.notEqual(semanticSliceKind, null);
  assert.notEqual(ordinalSliceKind, recordKind);
  assert.notEqual(semanticSliceKind, recordKind);
  assert.notEqual(ordinalSliceKind, initiativeKind);
  assert.notEqual(semanticSliceKind, initiativeKind);
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
