import assert from 'node:assert/strict';
import test from 'node:test';

import * as schemaConstants from '../packages/wiki-core/src/lib/work-record-schema-constants.mjs';

const VALID_ORDINAL_SLICE_ID = 'SLICE-001';
const GRANDFATHERED_SEMANTIC_SLICE_ID = 'parser-slice';
const MALFORMED_ORDINAL_SLICE_IDS = [
  'SLICE-1',
  'SLICE-01',
  'SLICE-0010',
  'SLICE-00A',
  'SLICE001',
  'SLICE--001',
];

function normalizeOutcome(outcome) {
  if (typeof outcome === 'boolean') {
    return outcome;
  }

  if (outcome && typeof outcome === 'object') {
    for (const key of ['valid', 'isValid', 'ok', 'accepted', 'result', 'value']) {
      if (typeof outcome[key] === 'boolean') {
        return outcome[key];
      }
    }
  }

  return null;
}

function isSliceIdValidatorCandidate(fn) {
  const cases = [
    [VALID_ORDINAL_SLICE_ID, true],
    [GRANDFATHERED_SEMANTIC_SLICE_ID, true],
    ...MALFORMED_ORDINAL_SLICE_IDS.map((sliceId) => [sliceId, false]),
  ];

  for (const [input, expected] of cases) {
    let outcome;
    try {
      outcome = fn(input);
    } catch {
      return false;
    }

    const normalized = normalizeOutcome(outcome);
    if (normalized === null || normalized !== expected) {
      return false;
    }
  }

  return true;
}

function isOrdinalPatternCandidate(value) {
  if (!(value instanceof RegExp)) {
    return false;
  }

  const pattern = new RegExp(value);
  return pattern.test(VALID_ORDINAL_SLICE_ID) && !MALFORMED_ORDINAL_SLICE_IDS.some((sliceId) => pattern.test(sliceId));
}

function findSliceIdContract() {
  const entries = Object.entries(schemaConstants);
  const functionEntries = entries.filter(([, value]) => typeof value === 'function');

  for (const [name, value] of functionEntries) {
    if (/(slice|id|valid|tracker|match|pattern|compat|grandfather)/i.test(name) && isSliceIdValidatorCandidate(value)) {
      return {
        kind: 'function',
        name,
        validate: value,
      };
    }
  }

  for (const [name, value] of functionEntries) {
    if (isSliceIdValidatorCandidate(value)) {
      return {
        kind: 'function',
        name,
        validate: value,
      };
    }
  }

  const regexpEntries = entries.filter(([, value]) => isOrdinalPatternCandidate(value));
  if (regexpEntries.length > 0) {
    const [, validate] = regexpEntries[0];
    return {
      kind: 'regexp',
      name: regexpEntries[0][0],
      validate: (sliceId) => new RegExp(validate).test(sliceId),
    };
  }

  const exportList = entries.map(([name]) => name).sort().join(', ');
  throw new Error(`Unable to locate a slice-id validator or ordinal pattern export in work-record-schema-constants.mjs. Exports: ${exportList}`);
}

const sliceIdContract = findSliceIdContract();

test('ordinal slice ids are valid', () => {
  assert.equal(sliceIdContract.validate(VALID_ORDINAL_SLICE_ID), true);
});

test('existing semantic slice ids remain grandfathered', () => {
  assert.equal(sliceIdContract.validate(GRANDFATHERED_SEMANTIC_SLICE_ID), true);
});

test('malformed ordinal-like slice ids remain invalid', () => {
  for (const sliceId of MALFORMED_ORDINAL_SLICE_IDS) {
    assert.equal(sliceIdContract.validate(sliceId), false, `expected ${sliceId} to be rejected by ${sliceIdContract.kind}:${sliceIdContract.name}`);
  }
});
