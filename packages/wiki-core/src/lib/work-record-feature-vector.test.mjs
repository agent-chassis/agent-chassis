import assert from 'node:assert/strict';
import test from 'node:test';

import * as featureVectorModule from './work-record-feature-vector.mjs';
import * as schemaConstantsModule from './work-record-schema-constants.mjs';

const FEATURE_VECTOR_EXPORT_PREFIX = 'WORK_UNIT_FEATURE_VECTOR_';
const AUTHORED_SCHEMA_EXPORT_PREFIX = 'WORK_RECORD_';

const exportNames = (namespace) => Object.keys(namespace).filter((name) => name !== 'default');

const featureVectorPrefixedNames = (namespace) =>
  exportNames(namespace).filter((name) => name.startsWith(FEATURE_VECTOR_EXPORT_PREFIX));

test('feature-vector module owns the derived normalizer export', () => {
  assert.equal(
    typeof featureVectorModule.normalizeWorkUnitFeatureVector,
    'function',
    'work-record-feature-vector.mjs must export normalizeWorkUnitFeatureVector',
  );
});

test('feature-vector version constants stay in parity with matching schema constants', () => {
  const featureVectorNames = featureVectorPrefixedNames(featureVectorModule);
  const schemaConstantNames = featureVectorPrefixedNames(schemaConstantsModule);

  assert.ok(
    featureVectorNames.includes('WORK_UNIT_FEATURE_VECTOR_SCHEMA_VERSION'),
    'feature-vector module should export the feature-vector schema version constant',
  );

  const sharedNames = featureVectorNames.filter((name) => schemaConstantNames.includes(name));

  assert.ok(
    sharedNames.includes('WORK_UNIT_FEATURE_VECTOR_SCHEMA_VERSION'),
    'feature-vector and schema-constants should share at least the schema version constant',
  );

  for (const name of sharedNames) {
    assert.deepStrictEqual(
      featureVectorModule[name],
      schemaConstantsModule[name],
      `shared feature-vector constant ${name} must match between the derived module and the validator constants`,
    );
  }
});

test('validator-facing feature-vector vocabulary constants are present, non-empty, and frozen', () => {
  const vocabularyNames = featureVectorPrefixedNames(schemaConstantsModule).filter((name) =>
    name.endsWith('_VALUES'),
  );

  assert.ok(
    vocabularyNames.length > 0,
    'expected validator-facing feature-vector vocabulary constants in the schema-constants module',
  );

  for (const name of vocabularyNames) {
    const value = schemaConstantsModule[name];
    assert.ok(Array.isArray(value), `${name} should be an array of allowed values`);
    assert.ok(value.length > 0, `${name} should be non-empty`);
    assert.ok(
      Object.isFrozen(value),
      `${name} is declared with Object.freeze in current code and must stay immutable`,
    );
  }
});

test('feature-vector module does not re-export authored work-record schema constants', () => {
  const authoredSchemaNames = exportNames(schemaConstantsModule).filter((name) =>
    name.startsWith(AUTHORED_SCHEMA_EXPORT_PREFIX),
  );

  assert.ok(
    authoredSchemaNames.length > 0,
    'expected authored work-record schema constants to exist in the schema-constants module',
  );

  for (const name of authoredSchemaNames) {
    assert.ok(
      !Object.hasOwn(featureVectorModule, name),
      `derived feature-vector module must not re-export authored schema constant ${name}`,
    );
  }
});

test('authored and derived ontology namespaces stay separate', () => {
  const featureVectorExportNames = exportNames(featureVectorModule);

  const authoredLeakage = featureVectorExportNames.filter((name) =>
    name.startsWith(AUTHORED_SCHEMA_EXPORT_PREFIX),
  );
  assert.deepStrictEqual(
    authoredLeakage,
    [],
    'the derived feature-vector module must not surface authored WORK_RECORD_* ontology names',
  );

  const derivedVocabularyNames = featureVectorExportNames.filter((name) =>
    name.startsWith('WORK_UNIT_'),
  );
  assert.ok(
    derivedVocabularyNames.length > 0,
    'expected the derived feature-vector module to export its own WORK_UNIT_* vocabulary',
  );
});
