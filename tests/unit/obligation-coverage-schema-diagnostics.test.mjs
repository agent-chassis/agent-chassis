import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import { OBLIGATION_DRAFT_SCHEMA, validateObligationCoverageDraft } from
  '../../packages/controlled-contract/lib/obligation-coverage-carrier.mjs';
import { adaptRawSchemaDiagnostic, groupCompleteSchemaDiagnostics } from
  '../../packages/controlled-contract/lib/bounded-diagnostic-projection.mjs';

const validator = new Ajv2020({ allErrors: true, strict: false }).compile(OBLIGATION_DRAFT_SCHEMA);
const valid = () => ({ schema_version: 'controlled-contract-obligation-coverage.v3',
  wk_id: 'WK-9230', selected_unit: null, focus: null,
  obligations: Array.from({ length: 45 }, (_, i) => ({ obligation_id: `OBL-${i}`, statement: 'Saved statement' })) });
const tuples = rows => rows.map(row => JSON.stringify([row.pointer, row.field_pointer,
  row.keyword, row.schema_path, row.params, row.property_name, row.obligation_id ?? null])).sort();
const expand = group => group.subjects.map(values => {
  const row = { ...group.reason, ...Object.fromEntries(group.subject_fields.map((field, i) => [field, values[i]])) };
  for (const key of ['pointer', 'field_pointer']) if (typeof row[key] === 'object') {
    const { prefix, subject_field, suffix } = row[key];
    row[key] = prefix + row[subject_field] + suffix;
  }
  return row;
});
const escape = value => value.replaceAll('~', '~0').replaceAll('/', '~1');

test('carrier schema errors retain every raw occurrence, property and constraint before complete grouping', () => {
  const document = valid();
  assert.equal(validateObligationCoverageDraft(document).valid, true);
  document.focus = 'INVALID';
  for (const row of document.obligations) Object.assign(row, { unexpected: true, 'slash/name': 1, 'tilde~name': 2 });
  document.obligations[0].mechanism = { owner: '', kind: 'wrong' };
  document.obligations[1].statement = '';
  document.obligations[2].proof_opt_out = false;
  assert.equal(validator(document), false);
  const raw = structuredClone(validator.errors);
  const expected = raw.map(error => {
    const property = error.params.additionalProperty ?? error.params.missingProperty ?? null;
    const index = /^\/obligations\/([0-9]+)/u.exec(error.instancePath)?.[1];
    return { pointer: error.instancePath || '/',
      field_pointer: property === null ? error.instancePath || '/' : `${error.instancePath}/${escape(property)}`,
      keyword: error.keyword, schema_path: error.schemaPath, params: error.params,
      property_name: property, obligation_id: index === undefined ? null : document.obligations[Number(index)].obligation_id };
  });
  const result = validateObligationCoverageDraft(document);
  assert.equal(result.valid, false);
  assert.equal(result.carrier, null);
  assert.deepEqual(tuples(result.schema_errors), tuples(expected));
  assert.equal(result.schema_errors.filter(row => row.keyword === 'additionalProperties').length, 135);
  assert.equal(result.schema_errors.find(row => row.pointer === '/focus').actual_identity, 'INVALID');
  assert.equal(result.schema_errors.find(row => row.pointer === '/obligations/2/proof_opt_out').actual_identity, false);
  const grouped = groupCompleteSchemaDiagnostics(result.schema_errors);
  assert.equal(grouped.complete, true);
  assert.equal(grouped.total_count, raw.length);
  assert.equal(grouped.groups.reduce((sum, group) => sum + group.occurrence_count, 0), raw.length);
  assert.deepEqual(tuples(grouped.groups.flatMap(expand)), tuples(expected));
  for (const property of ['unexpected', 'slash/name', 'tilde~name']) {
    const group = grouped.groups.find(group => group.reason.property_name === property);
    assert.equal(group.occurrence_count, 45);
    assert.deepEqual(expand(group).map(subject => subject.obligation_id).sort(), document.obligations.map(row => row.obligation_id).sort());
  }
});

test('complete grouping preserves duplicate occurrences, long fields and distinct constraint values without a row cap', () => {
  const property = `slash/tilde~${'語'.repeat(5000)}`;
  const errors = Array.from({ length: 190 }, (_, index) => ({ instancePath: `/obligations/${index}`,
    schemaPath: '#/additionalProperties', keyword: 'additionalProperties', message: 'unexpected property',
    params: { additionalProperty: property } }));
  errors.push(errors[0]);
  for (const limit of [1, 2]) errors.push({ instancePath: '/statement', schemaPath: '#/minLength',
    keyword: 'minLength', message: 'too short', params: { limit } });
  const adapted = errors.map(error => adaptRawSchemaDiagnostic(error));
  const grouped = groupCompleteSchemaDiagnostics(adapted);
  assert.equal(grouped.total_count, 193);
  assert.equal(grouped.group_count, 3);
  assert.equal(grouped.groups[0].reason.property_name, property);
  assert.equal(expand(grouped.groups[0])[0].field_pointer, `/obligations/0/${escape(property)}`);
  assert.equal(grouped.groups[0].occurrence_count, 191);
  assert.deepEqual(grouped.groups[0].subjects.at(-1), grouped.groups[0].subjects[0]);
  assert.deepEqual(grouped.groups.slice(1).map(group => group.reason.params.limit), [1, 2]);
});
