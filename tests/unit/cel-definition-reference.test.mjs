import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { celDefinitionIndex, selectCelDefinition } from
  '@agent-chassis/controlled-contract/cel-definition-reference';
import { CONTROLLED_VOCABULARY } from
  '../../packages/controlled-contract/vocabulary/controlled-contract-vocabulary.v1.mjs';
import { CEL_ENVIRONMENT, loweringInventory } from '@agent-chassis/controlled-contract/cel-lowering';

const vendor = new URL('../../packages/controlled-contract/vendor/', import.meta.url);
const hash = value => createHash('sha256').update(value).digest('hex');

test('pinned sources and licenses retain upstream bytes; selected sections are exact and bounded', () => {
  const index = celDefinitionIndex();
  const expected = {
    language: ['cb51b4176013ad19bd00df94be273c322916a620', '46a377cde5a4b0fe1d3023bf7e663d91dfabf6c30868c6b5c2867e057a79ae5b', 81787],
    extensions: ['5cf3ab3c9f0a2ccb4ac449527d41689ed6aa6879', '8172385b89c6fde06cb34b4cbf508ec64988e071209e6a33682824f86de6e254', 34478]
  };
  for (const [key, source] of Object.entries(index.sources)) {
    const bytes = readFileSync(new URL(source.bundle_path, vendor));
    assert.equal(hash(bytes), source.sha256);
    assert.equal(bytes.length, source.bytes);
    if (key.endsWith('_license')) {
      assert.equal(source.sha256, 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30');
      assert.equal(source.license, 'Apache-2.0');
    } else assert.deepEqual([source.commit, source.sha256, source.bytes], expected[key]);
    assert.equal(source.url, `${source.repository}/blob/${source.commit}/${source.original_path}`);
  }
  assert.equal(CEL_ENVIRONMENT.language, index.sources.language.url);
  for (const id of Object.keys(index.operations)) {
    const selected = selectCelDefinition(['operations', id]);
    const { provenance } = selected;
    const bytes = readFileSync(new URL(provenance.bundle_path, vendor));
    const section = bytes.subarray(provenance.section.start_byte, provenance.section.end_byte);
    assert.equal(selected.text, section.toString('utf8'), id);
    assert.equal(hash(section), provenance.section.sha256);
    const lines = bytes.toString('utf8').split(/(?<=\n)/u);
    assert.equal(selected.text, lines.slice(provenance.section.start_line - 1, provenance.section.end_line).join(''), id);
    assert.ok(Buffer.byteLength(JSON.stringify(selected)) < 16_384, id);
    for (const link of selected.prerequisites) assert.ok(selectCelDefinition(link).text.length > 0);
  }
  assert.ok(Buffer.byteLength(JSON.stringify(index)) < 10_240, 'the catalogue contains no manuals');
  assert.doesNotMatch(JSON.stringify(index), /Language Definition|Returns the distinct elements/);
});

test('operation signatures, semantic prerequisites and extension attribution are truthful', () => {
  const membership = selectCelDefinition(['operations', 'cel.in']);
  assert.equal(membership.identifier, '_in_');
  assert.deepEqual(membership.signatures, [{ arguments: ['A', 'list(A)'], result: 'bool', notation: 'A in list(A) -> bool' }]);
  assert.match(membership.text, /A in list\(A\) -> bool/);
  assert.deepEqual(membership.prerequisites, [['operations', 'cel.equality_rules']]);
  const equality = selectCelDefinition(membership.prerequisites[0]);
  assert.match(equality.text, /Type-checking asserts/);
  assert.match(equality.text, /continuous number line/);
  assert.match(equality.text, /entries at each ordinal/);
  const distinct = selectCelDefinition(['operations', 'cel_java.lists.distinct']);
  assert.equal(distinct.attribution, 'cel_java_extension');
  assert.deepEqual(distinct.extension, { library: 'lists', introduced_at_version: 2 });
  assert.match(distinct.text, /Introduced at version: 2/);
  assert.match(distinct.text, /<list\(T\)>\.distinct\(\) -> <list\(T\)>/);
  assert.equal(membership.attribution, 'cel_language');
  assert.equal(distinct.provenance.version, 'v0.14.0');
  assert.equal(membership.provenance.version, 'v0.25.2');
  membership.signatures[0].result = 'string';
  assert.equal(selectCelDefinition(['operations', 'cel.in']).signatures[0].result, 'bool');
});

test('local definitions and required observations come from vocabulary and generated lowering only', () => {
  const inventory = loweringInventory();
  assert.deepEqual(celDefinitionIndex().relations, CONTROLLED_VOCABULARY.operators.map(row => row.term));
  for (const relation of CONTROLLED_VOCABULARY.operators) {
    const selected = selectCelDefinition(['relations', relation.term]);
    assert.equal(selected.attribution, 'local_application');
    assert.equal(selected.text, relation.definition);
    assert.deepEqual(selected.signatures, [relation.signature]);
    assert.deepEqual(selected.definition, relation);
    assert.equal(selected.provenance.vocabulary, CONTROLLED_VOCABULARY.vocabulary_version);
    const mapping = inventory.relations.find(row => row.relation === relation.term);
    assert.deepEqual(selected.lowering, mapping);
    assert.deepEqual(selected.required_observations, mapping.bindings);
    assert.deepEqual(selected.input_contract, mapping.input_contract);
    assert.deepEqual(selected.input_contract_observations, mapping.input_contract_observations);
    assert.ok(Buffer.byteLength(JSON.stringify(selected)) < 16_384, relation.term);
    for (const link of selected.cel_operations) assert.ok(selectCelDefinition(link).text.length > 0);
  }
  const supports = selectCelDefinition(['relations', 'reference:supports']);
  assert.deepEqual(supports.cel_operations, [['operations', 'cel.in']]);
  assert.equal(supports.multiplicity, 'relation_set');
  assert.equal(supports.required_observations[0].type, 'list<string>');
  const returns = selectCelDefinition(['relations', 'number:returns']);
  assert.equal(returns.multiplicity, 'relation_set');
  assert.equal(returns.required_observations[0].type, 'list<double>');
  assert.match(returns.lowering.must, / in /);
  const deterministic = selectCelDefinition(['relations', 'boolean:deterministic']);
  assert.equal(deterministic.required_observations[0].type, 'bool');
  assert.match(deterministic.observation_boundary, /does not establish determinism/);
  const cardinality = selectCelDefinition(['relations', 'number:has_cardinality']);
  assert.ok(cardinality.cel_operations.some(([, id]) => id === 'cel_java.lists.distinct'));
  const transitive = selectCelDefinition(['relations', 'reference:depends_on']);
  assert.deepEqual(transitive.input_contract_observations.map(row => row.subject).sort(), ['O', 'S']);
  assert.ok(transitive.input_contract_observations.every(row => row.type === 'list<string>' && row.meaning.length > 0));
});

test('unknown selections identify their subject and the supported package recovery', () => {
  for (const selection of [null, [], ['operations', 'absent'], ['relations', 'supports'],
    ['operations', '__proto__'], ['operations', 'cel.eq', 'extra']]) {
    assert.throws(() => selectCelDefinition(selection), error => {
      assert.equal(error.code, 'cel_definition_selection_not_found');
      assert.deepEqual(error.subject, selection);
      assert.deepEqual(error.recovery, { export: '@agent-chassis/controlled-contract/cel-definition-reference',
        function: 'celDefinitionIndex', arguments: [] });
      return true;
    });
  }
});

test('reference publication leaves compiler mappings unchanged', () => {
  const inventory = loweringInventory();
  delete inventory.environment;
  for (const row of inventory.relations) {
    delete row.input_contract_predicates;
    delete row.input_contract_observations;
    for (const binding of row.bindings ?? []) delete binding.meaning;
  }

  const beforeEnvironment = { macros: ['all', 'exists'], extension_functions: { lists: ['distinct'] } };
  const snapshot = { version: inventory.version, environment: beforeEnvironment, ...inventory };
  assert.equal(hash(JSON.stringify(snapshot)), '2ebd42c8b5984771d8d8bb497b4a6fee2c1567cb863ada609a70d476089c56ff');
});
