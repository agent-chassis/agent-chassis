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
      if (key !== 'kubernetes_license') assert.equal(source.sha256, 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30');
      assert.equal(source.license, 'Apache-2.0');
    } else if (Object.hasOwn(expected, key)) assert.deepEqual([source.commit, source.sha256, source.bytes], expected[key]);
    else assert.ok(["value_format", "type_format", "kubernetes"].includes(key));
    assert.equal(source.url, `${source.repository}/blob/${source.commit}/${source.original_path}`);
  }
  assert.equal(CEL_ENVIRONMENT.language, index.sources.language.url);
  for (const id of Object.keys(index.operations)) {
    const selected = selectCelDefinition(['operations', id]);
    const { provenance } = selected;
    const bytes = readFileSync(new URL(provenance.bundle_path, vendor));
    const section = bytes.subarray(provenance.section.start_byte, provenance.section.end_byte);
    assert.equal(selected.upstream_text ?? selected.text, section.toString('utf8'), id);
    if (selected.reference_note) {
      assert.equal(selected.text, `Local reference ${selected.reference_note.correction ? 'erratum' : 'conflict'}: ${selected.reference_note.correction ?? selected.reference_note.limitation}\n\nPinned upstream excerpt (verbatim; provenance.section describes these bytes):\n\n${selected.upstream_text}`);
    }
    assert.equal(hash(section), provenance.section.sha256);
    const lines = bytes.toString('utf8').split(/(?<=\n)/u);
    assert.equal(selected.upstream_text ?? selected.text, lines.slice(provenance.section.start_line - 1, provenance.section.end_line).join(''), id);
    assert.ok(Buffer.byteLength(JSON.stringify(selected)) < 16_384, id);
    for (const link of selected.prerequisites) assert.ok(selectCelDefinition(link).text.length > 0);
  }
  assert.ok(Buffer.byteLength(JSON.stringify(index)) < 16_384, 'the catalogue contains no manuals');
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
    assert.equal(selected.provenance.lowering_version, inventory.version);
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
  assert.equal(returns.multiplicity, 'single_value_per_subject_scope');
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

test('reference index digest retains the complete inventory and returned objects are isolated', () => {
  const manifest = JSON.parse(readFileSync(new URL('cel-reference-sources.json', vendor), 'utf8'));
  const inventory = loweringInventory();
  const expectedDigest = hash(JSON.stringify({ definitions: manifest.definitions,
    vocabulary: CONTROLLED_VOCABULARY, inventory }));
  const index = celDefinitionIndex();
  const savedIndex = structuredClone(index);
  assert.equal(index.definition_digest, expectedDigest);
  assert.equal(index.relations.length, inventory.relations.length);
  const selection = ['relations', 'reference:depends_on'];
  const selected = selectCelDefinition(selection);
  const savedSelection = structuredClone(selected);
  index.sources.language.commit = 'mutated';
  index.relations.length = 0;
  index.operations['cel.in'].selection[1] = 'mutated';
  selected.provenance.lowering_version = 'mutated';
  selected.definition.signature.operand_kind = 'mutated';
  selected.lowering.bindings[0].meaning = 'mutated';
  selected.required_observations.length = 0;
  selected.input_contract_observations[0].meaning = 'mutated';
  assert.deepEqual(celDefinitionIndex(), savedIndex);
  assert.deepEqual(selectCelDefinition(selection), savedSelection);
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
  const inventory = structuredClone(loweringInventory());
  inventory.relations = inventory.relations.filter(row => row.operand_kind !== 'value');
  for (const key of ['availability', 'capture_completeness', 'satisfaction']) delete inventory.evaluation[key];
  delete inventory.environment;
  for (const row of inventory.relations) {
    delete row.input_contract_predicates;
    delete row.input_contract_observations;
    for (const binding of row.bindings ?? []) delete binding.meaning;
  }

  const beforeEnvironment = { macros: ['all', 'exists'], extension_functions: { lists: ['distinct'] } };
  const snapshot = { version: inventory.version, environment: beforeEnvironment, ...inventory };
  assert.equal(hash(JSON.stringify(snapshot)), 'f40212882ed8c78c9def443ef9f9db0735543344130e8ec9139de18375fd4a8b');
});

test('new value operators retain local type constraints and pinned upstream attribution', () => {
  const contains = selectCelDefinition(['relations', 'value:contains']);
  assert.equal(contains.attribution, 'local_application');
  assert.equal(contains.definition.signature.type_rule, 'string_contains');
  assert.ok(contains.cel_operations.some(([, name]) => name === 'cel.contains'));
  const operation = selectCelDefinition(['operations', 'cel.contains']);
  assert.equal(operation.attribution, 'cel_language');
  assert.equal(operation.provenance.sha256, '46a377cde5a4b0fe1d3023bf7e663d91dfabf6c30868c6b5c2867e057a79ae5b');
  assert.match(operation.text, /contains.*substring/su);
  const comparison = selectCelDefinition(['relations', 'value:equal_to']);
  assert.equal(comparison.definition.signature.type_rule, 'typed_equality');
  assert.ok(comparison.cel_operations.some(([, name]) => name === 'cel.eq'));
  assert.match(comparison.text, /optional-field presence/u);
  assert.match(comparison.application_semantics, /int 3 differs from double 3.0.*no numeric coercion/u);
  assert.match(comparison.application_semantics, /Required missing captures remain unavailable/u);
  assert.match(comparison.application_semantics, /upstream CEL heterogeneous numeric equality/u);
  assert.match(comparison.permission_boundary, /empty-search.*nonempty-search/u);
  const choice = selectCelDefinition(['relations', 'value:choose']);
  assert.equal(choice.permission_boundary, comparison.permission_boundary);
  assert.match(choice.predicate_boundary, /when the condition is false.*leaves behavior unconstrained/u);
  assert.match(choice.predicate_boundary, /does not complete an unresolved behavioral specification/u);
  assert.match(choice.predicate_boundary, /not adopt it as an automatic repair/u);
  assert.match(choice.predicate_boundary, /Test both condition branches/u);
  assert.equal(selectCelDefinition(['relations', 'value:equals']).definition.signature.type_rule, 'same_subject');
});

test('selected definitions are complete and distinguish pinned mistakes from local errata', () => {
  const read = id => selectCelDefinition(['operations', id]);
  assert.match(read('cel.type').text, /^\*\*type\*\* `type`/u);
  assert.match(read('cel.type').text, /type\(A\) -> type/u);
  assert.doesNotMatch(read('cel.type').text, /\*\*bool\*\*|\*\*uint\*\*/u);
  for (const [id, heading] of [['cel.divide', '**Division'], ['cel.remainder', '**Modulus'], ['cel.multiply', '**Multiply']]) {
    const selected = read(id);
    assert.ok((selected.upstream_text ?? selected.text).startsWith(heading), id);
    assert.equal((selected.text.match(/^```/gmu) ?? []).length, 2, id);
    assert.ok(selected.text.trimEnd().endsWith('```'), id);
  }
  for (const [id, heading, excluded] of [
    ['cel_java.comprehensions.all', '### All', '### Exists'],
    ['cel_java.comprehensions.exists_in', '### Exists', '### Exists_One'],
    ['cel_java.comprehensions.map_over', '### TransformList', '### TransformMap'],
    ['cel_java.comprehensions.filter_over', '### TransformList', '### TransformMap'],
    ['cel_java.math.isFinite', '### Math.IsFinite', '### Math.sqrt']]) {
    assert.ok((read(id).upstream_text ?? read(id).text).startsWith(heading));
    assert.ok(!read(id).text.includes(excluded));
  }
  assert.match(read('cel.contains').text, /string.contains\(string\) -> bool/u);
  assert.match(read('cel.contains').text, /"foobar".contains\("baz"\) \/\/ false/u);
  assert.match(read('cel.multiply').text, /-2 \* 6 \/\/ 12/u, 'pinned upstream bytes stay unchanged');
  assert.match(read('cel.multiply').reference_note.correction, /-2 \* 6 \/\/ -12/u);
  assert.equal(-2 * 6, -12);
  for (const id of ['cel_java.comprehensions.map_over', 'cel_java.comprehensions.filter_over']) {
    assert.match(read(id).reference_note.correction, /indexVar % 2 == 0, \(indexVar \* valueVar\)/u);
    assert.deepEqual([1, 2, 3].flatMap((value, index) => index % 2 === 0 ? [index * value + value] : []), [1, 9]);
  }
  for (const id of ['cel.numeric_values', 'cel.equality_rules']) {
    assert.equal(read(id).reference_note.attribution, 'local_reference_conflict');
    assert.match(read(id).reference_note.limitation, /Do not infer evaluator behavior/u);
    assert.ok(read(read(id).reference_note.compare[1]).text);
  }
});
