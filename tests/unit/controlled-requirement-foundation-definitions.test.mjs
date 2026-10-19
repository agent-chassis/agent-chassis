import test from 'node:test';
import assert from 'node:assert/strict';
import { createValueScopeNormalizer, resolveValueDefinitions } from '@agent-chassis/controlled-contract/controlled-value-definitions-v1';
import { compileSpecification, statementConstraint, identityOf } from '@agent-chassis/controlled-contract/canonical-specification';
import { definition, int, ref, local, list, must, observed } from '../fixtures/controlled-requirement-foundation-values.mjs';
const binding = name => ({ type_term: 'cc:entity', identity: { kind: 'profile_term', term: name } });
function rowsOf(rows) {
  const names = [...new Set(rows.map(row => row.subject).concat(['missing', 'domain', 'op', 'call']))];
  const bindings = new Map(names.map(name => [name, binding(name)]));
  const normalizer = createValueScopeNormalizer(rows, bindings);
  return rows.map(row => { const normalized = normalizer.normalize(row); const constraint = statementConstraint({ ...row, ...normalized,
    subject: { declare: binding(row.subject) }, behavior: { ...row.behavior, objects: normalized.objects } }, 'behavior'); return { constraint, identity: identityOf('foundation', constraint) }; });
}
test('definitions have structural force and selected compilation retains dependencies and independent obligations', () => {
  const rows = rowsOf([definition('a', 'equals', [int(1)]), definition('b', 'add', [ref('a'), int(1)]), must('b', 'equals', [int(2)]), must('a', 'equals', [int(7)]), definition('unrelated', 'equals', [int(9)])]);
  const selected = compileSpecification({ unit: 'foundation', constraints: rows, collections: [], open: { statements: 0, collections: 0, unresolved: 0 }, orderedSequence: 'ordered_sequence', selectedConstraintIds: new Set([rows[2].identity]) });
  assert.equal(selected.state, 'complete');
  assert.deepEqual(new Set(selected.canonical.constraints.map(row => row.subject.identity.term)), new Set(['a', 'b']));
  assert.ok(selected.cel.constraints.some(row => row.identity === rows[3].identity && row.force === 'mandatory'));
  assert.ok(selected.cel.constraints.filter(row => row.definition).every(row => row.force === 'structural' && row.expression === null));
  assert.equal(resolveValueDefinitions(rowsOf([definition('a', 'equals', [ref('b')]), definition('b', 'equals', [ref('a')])])).diagnostics[0].reason, 'value_definition_cycle');
  assert.equal(resolveValueDefinitions(rowsOf([definition('a', 'equals', [ref('missing')])])).diagnostics[0].reason, 'value_definition_missing');
});
test('scope identities retain declaring meaning, ancestry and position without binder spellings', () => {
  const scopeRow = (scope, domain, operand, more = {}) => must('n', 'equals', [operand], {
    for_each: [{ scope, domain, bind: { value: `${scope}_item` } }], ...more
  });
  const rows = rowsOf([scopeRow('one', list('int', int(3)), int(3)), scopeRow('two', list('int', int(5)), int(5)),
    scopeRow('three', list('int', int(3)), int(7)), scopeRow('nested', list('int', int(3)), int(3), { within: 'one' })]);
  assert.equal(new Set(rows.map(row => JSON.stringify(row.constraint.for_each[0].scope))).size, 4);
  const sameDomain = rowsOf([scopeRow('first', list('int', int(3)), int(5)), scopeRow('second', list('int', int(3)), int(5)),
    definition('aux', 'equals', [int(1)], { within: 'first' }), definition('aux', 'equals', [int(2)], { within: 'second' })]);
  assert.notDeepEqual(sameDomain[0].constraint.for_each[0].scope, sameDomain[1].constraint.for_each[0].scope);
  assert.deepEqual(resolveValueDefinitions(sameDomain).diagnostics, []);
  assert.deepEqual(rowsOf([scopeRow('first', list('int', int(3)), int(5))])[0], sameDomain[0]);
  assert.throws(() => rowsOf([definition('a', 'equals', [ref('unknown')])]), /value_reference_unknown/);
  assert.equal(resolveValueDefinitions(rowsOf([definition('a', 'equals', [int(1)]), definition('a', 'equals', [int(2)])])).diagnostics[0].reason, 'value_definition_ambiguous');
  assert.deepEqual(resolveValueDefinitions(rowsOf([definition('a', 'equals', [int(1)]), definition('b', 'equals', [ref('a')])])).diagnostics, []);
});
test('inner definitions cannot replace an already visible observation or ancestor definition', () => {
  const outer = must('n', 'equals', [int(5)], { for_each: [{ scope: 'items', domain: list('int', int(5)), bind: { value: 'item' } }] });
  for (const root of [definition('n', 'equals', [int(3)]), observed('n', 'arguments', [], 'int')]) {
    assert.equal(resolveValueDefinitions(rowsOf([root, outer, definition('n', 'equals', [int(5)], { within: 'items' })])).diagnostics[0].reason, 'value_definition_shadowing');
  }
  assert.deepEqual(resolveValueDefinitions(rowsOf([outer, definition('n', 'equals', [local('item')], { within: 'items' })])).diagnostics, []);
});
test('lexical names disappear from identity and illegal captures refuse exactly', () => {
  const row = name => must('out', 'equals', [local(name)], { for_each: [{ scope: 's', domain: list('int', int(1)), bind: { value: name } }] });
  assert.deepEqual(rowsOf([row('x')]), rowsOf([row('renamed')]));
  assert.throws(() => rowsOf([row('out')]), /value_local_shadowing/);
  assert.throws(() => rowsOf([must('out', 'equals', [local('missing')])]), /value_local_out_of_scope/);
  assert.throws(() => rowsOf([{ ...row('x'), for_each: [{ scope: 's', domain: local('x'), bind: { value: 'x' } }] }]), /value_local_out_of_scope/);
  assert.throws(() => rowsOf([row('x'), { ...row('x'), subject: 'other' }]), /value_scope_duplicate/);
});
