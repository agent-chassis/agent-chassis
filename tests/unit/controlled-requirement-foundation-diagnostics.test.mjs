import test from 'node:test';
import { bindEntities, createRequirementNormalizer, termBinding } from '../../packages/wiki-core/src/operations/controlled-contract/contract-requirement-normalization.mjs';
import { workItemRequirementBatchSchema } from '../../packages/wiki-core/src/lib/record-authoring-schema.mjs';
import assert from 'node:assert/strict';
import { compileSpecification, identityOf } from '@agent-chassis/controlled-contract/canonical-specification';
import { normalizeCelValue } from '@agent-chassis/controlled-contract/controlled-values-v1';
import { resolveValueDefinitions } from '@agent-chassis/controlled-contract/controlled-value-definitions-v1';
import { lowerConstraint } from '@agent-chassis/controlled-contract/cel-lowering';
import { describeRequirementObjects } from '../../packages/wiki-core/src/operations/controlled-contract/contract-requirement-descriptions.mjs';

test('binding refusals preserve complete differing facts and uses with one author choice per family', () => {
  const saved = termBinding('saved', 'cc:operation');
  const other = { type_term: 'cc:operation', identity: { kind: 'durable_id', domain: 'operations', value: 'intended' } };
  const known = new Map([['op', saved], ['again', termBinding('again', 'cc:operation')]]);
  const uses = ['op', 'again', 'copy'].map((id, index) => ({ id, path: ['requirements', index, 'subject'], types: null, role: 'subject' }));
  const declared = { op: other, again: { ...other, type_term: 'cc:command' }, copy: saved };
  const before = structuredClone({ known, declared, uses });
  const result = bindEntities({ known, declared, uses });
  assert.deepEqual({ known, declared, uses }, before);
  const conflicts = result.refusals.filter(f => f.cause === 'entity_declaration_conflicts_with_established');
  assert.equal(conflicts.length, 2);
  for (const [index, finding] of conflicts.entries()) {
    const id = index === 0 ? 'op' : 'again';
    assert.deepEqual(finding.submitted, { id, ...declared[id] });
    assert.deepEqual(finding.established, { id, ...known.get(id) });
    assert.deepEqual(finding.uses, uses.filter(use => use.id === id));
    assert.deepEqual(result.bindings.get(id), known.get(id), 'the saved binding never changes');
  }
  assert.deepEqual(conflicts[0].recovery.correction.choices.map(c => c.intent), ['reuse_established_object', 'specify_distinct_object']);
  assert.equal(conflicts[1].recovery.correction, undefined, 'shared correction is supplied once');
  const alias = result.refusals.find(f => f.cause === 'entity_identity_declared_twice');
  assert.ok(alias);
  assert.equal(alias.bindings[1].id, 'copy');
  assert.deepEqual(alias.bindings[1].identity, saved.identity);
  assert.deepEqual(alias.recovery.correction.choices.map(c => c.intent), ['consolidate_true_aliases', 'correct_mistaken_identity']);
  const redundant = bindEntities({ known: new Map([['op', saved]]), declared: { op: saved }, uses: [uses[0]] });
  assert.equal(redundant.refusals[0].cause, 'entity_already_established');
});

test('duplicate predicate findings retain every identity and reference one conditional correction', () => {
  const normalizer = createRequirementNormalizer({ schema: workItemRequirementBatchSchema(), unit: 'diagnostics' });
  const constraints = [[{ identity: 'predicate-a' }, { identity: 'predicate-b' }],
    [{ identity: 'predicate-b' }], [{ identity: 'predicate-a' }, { identity: 'predicate-c' }]];
  const findings = normalizer.restatedRequirements(constraints, ['first', 'second', 'third']);
  assert.deepEqual(findings.map(f => [f.path, f.restated, f.first_stated_by]), [
    [['requirements', 1], ['predicate-b'], ['first']], [['requirements', 2], ['predicate-a'], ['first']] ]);
  assert.deepEqual(findings[0].recovery.correction.choices.map(c => c.intent), ['consolidate_repeated_meaning', 'define_distinct_behaviors']);
  assert.equal(findings[1].recovery.correction, undefined);
  assert.ok(findings.every(f => f.message.includes('authored formal predicates')));
  assert.ok(findings.every(f => f.recovery.correct === 'state_once_or_define_distinct_behaviors'));
});
const entity = name => ({ type_term: 'cc:entity', identity: { kind: 'profile_term', term: name } });
const scope = { mode: 'unconditional', context: [] };
const row = (subject, definition, operands) => { const constraint = { form: 'statement', subject: entity(subject), relation: 'value:equals', operands, applies: scope,
  ...(definition ? { definition: true } : { nature: 'behavior', modality: 'MUST' }) }; return { constraint, identity: identityOf('diagnostics', constraint) }; };
const compile = constraints => compileSpecification({ unit: 'diagnostics', constraints, collections: [], orderedSequence: 'ordered_sequence', open: { statements: 0, collections: 0, unresolved: 0 } });
test('specification and execution facts remain distinct with exact causes', () => {
  const complete = compile([row('out', true, [{ value: { literal: { int64Value: '3' } } }]), row('out', false, [{ value: { literal: { int64Value: '3' } } }])]);
  assert.equal(complete.state, 'complete');
  assert.equal(complete.evaluation.availability, 'not_provided');
  const unresolved = [row('out', true, [{ value: { referent: entity('missing') } }]), row('out', false, [{ value: { literal: { int64Value: '3' } } }])];
  const partial = compile(unresolved);
  assert.equal(partial.state, 'partial');
  assert.equal(partial.cel.conformity, null);
  const diagnostic = partial.unresolved_definitions[0];
  assert.equal(diagnostic.reason, 'value_definition_missing');
  assert.deepEqual(diagnostic.subject, entity('out'));
  assert.deepEqual(diagnostic.effects, { changed: false });
  assert.equal(diagnostic.actor, 'requirement_author');
  assert.ok(diagnostic.recovery);
  const description = describeRequirementObjects({ specifications: [{ owner: 'diagnostics', constraints: unresolved }] });
  assert.equal(description.state, 'incomplete');
  assert.ok(description.missing.some(row => row.code === 'value_definition_missing'));
  assert.throws(() => normalizeCelValue({ int64Value: 3 }), error => error.code === 'value_int64_invalid' && error.details.subject === 'literal' && error.details.actor === 'requirement_author');
  const qualified = { ...unresolved[1].constraint, unmapped_fields: { behavior: { unknown: true } } };
  assert.equal(lowerConstraint(qualified).state, 'unsupported');
  assert.equal(compile([{ identity: 'qualified', constraint: qualified }]).cel.conformity, null);
  assert.equal(Object.hasOwn(complete, 'satisfied'), false);
  assert.equal(Object.hasOwn(complete, 'policy_authority'), false);
});

test('missing comprehension bodies preserve exact cause, scope and use through dependent definitions', () => {
  const lexical = { owner: entity('filtered'), path: [0] };
  const missing = row('filtered', true, [{ value: { list: { element_type: 'string', items: [] } } },
    { binding: { scope: lexical, bind: { value: 'value' } } }, { value: { referent: entity('related') } }]);
  missing.constraint.relation = 'value:filter_over';
  const dependent = row('checked_ids', true, [{ value: { referent: entity('filtered') } }]);
  const good = row('independent', true, [{ value: { literal: { int64Value: '3' } } }]);
  const definitions = [missing, dependent, good];
  const resolved = resolveValueDefinitions(definitions);
  const reversed = resolveValueDefinitions([...definitions].reverse());
  assert.deepEqual(reversed.diagnostics.find(d => d.definition_identity === missing.identity),
    resolved.diagnostics.find(d => d.definition_identity === missing.identity));
  const diagnostic = resolved.diagnostics.find(d => d.definition_identity === missing.identity);
  assert.equal(diagnostic.reason, 'value_definition_missing');
  assert.deepEqual(diagnostic.referent, entity('related'));
  assert.deepEqual(diagnostic.scope, lexical);
  assert.deepEqual(diagnostic.use_path, ['operands', 2, 'value', 'referent']);
  assert.deepEqual(resolved.diagnostics.find(d => d.definition_identity === dependent.identity).root_cause,
    diagnostic.root_cause);
  const partial = compile(definitions);
  assert.equal(partial.state, 'partial');
  assert.equal(partial.cel.conformity, null);
  assert.equal(partial.cel.constraints.find(d => d.identity === good.identity).resolution, 'resolved');
  assert.equal(partial.cel.constraints.find(d => d.identity === dependent.identity).resolution, 'unresolved');
  assert.doesNotMatch(JSON.stringify(partial), /\[object Object\]/u);
  const wrong = row('related', true, [{ value: { literal: { int64Value: '1' } } }]);
  wrong.constraint.within = lexical;
  assert.equal(resolveValueDefinitions([...definitions, wrong]).diagnostics[0].reason, 'value_overload_unsupported');
  const repaired = row('related', true, [{ value: { literal: { boolValue: true } } }]);
  repaired.constraint.within = lexical;
  assert.deepEqual(resolveValueDefinitions([...definitions, repaired]).diagnostics, []);
});

test('selected correction excludes missing definitions in a different lexical declaration', () => {
  const definitions = [row('ok', true, [{ value: { literal: { int64Value: '3' } } }]),
    row('ok', false, [{ value: { literal: { int64Value: '3' } } }]),
    row('unrelated', true, [{ value: { referent: entity('missing_elsewhere') } }])];
  const selected = compileSpecification({ unit: 'diagnostics', constraints: definitions, collections: [],
    selectedConstraintIds: new Set([definitions[1].identity]), orderedSequence: 'ordered_sequence',
    open: { statements: 0, collections: 0, unresolved: 0 } });
  assert.equal(selected.state, 'complete');
  assert.deepEqual(selected.unresolved_definitions, []);
  assert.ok(!selected.canonical.constraints.some(d => d.subject.identity.term === 'unrelated'));
});

test('an undefined direct guard names its exact use while independent rows still resolve', () => {
  const before = row('out', true, [{ value: { literal: { stringValue: 'fixed' } } }]);
  const guarded = row('out', false, [{ value: { literal: { stringValue: 'fixed' } } }]);
  guarded.constraint.applies = { mode: 'if', context: [entity('is_tan')] };
  const independent = row('independent', true, [{ value: { literal: { int64Value: '7' } } }]);
  const partial = compile([before, guarded, independent]);
  assert.equal(partial.state, 'partial');
  const missing = partial.unresolved_definitions.find(d => d.constraint_identity === guarded.identity);
  assert.equal(missing.reason, 'value_definition_missing');
  assert.deepEqual(missing.referent, entity('is_tan'));
  assert.deepEqual(missing.use_path, ['applies', 'context', 0]);
  assert.equal(partial.cel.constraints.find(d => d.identity === independent.identity).resolution, 'resolved');
  assert.equal(partial.cel.conformity, null);
});


test('operative operands and domains report exact missing uses and isolate selection', () => {
  const good = row('ok', true, [{ value: { literal: { int64Value: '3' } } }]);
  const use = row('ok', false, [{ value: { selection: { from: { list: { element_type: 'int', items: [] } },
    path: [{ index: { referent: entity('missing_index') } }] } } }]);
  const domain = row('ok', false, [{ value: { literal: { int64Value: '3' } } }]);
  const lexical = { owner: entity('ok'), path: [0] };
  domain.identity = 'domain';
  domain.constraint.for_each = [{ scope: lexical, domain: { referent: entity('missing_domain') }, bind: { value: 'value' } }];
  const membership = { identity: 'membership', constraint: { form: 'closed_membership', subject: entity('items'),
    clauses: [{ modality: 'MAY', domain: { referent: entity('missing_members') } }], applies: scope } };
  const items = row('items', true, [{ value: { list: { element_type: 'int', items: [] } } }]);
  const independent = row('independent', true, [{ value: { literal: { int64Value: '7' } } }]);
  const rows = [good, use, domain, membership, items, independent];
  const partial = compile(rows);
  for (const [identity, name, path, activeScope] of [[use.identity, 'missing_index', ['operands', 0, 'value', 'selection', 'path', 0, 'index', 'referent'], null],
    ['domain', 'missing_domain', ['for_each', 0, 'domain', 'referent'], null],
    ['membership', 'missing_members', ['clauses', 0, 'domain', 'referent'], null]]) {
    const diagnostic = partial.unresolved_definitions.find(d => d.constraint_identity === identity && d.referent?.identity.term === name);
    assert.ok(diagnostic, JSON.stringify(partial.unresolved_definitions));
    assert.equal(diagnostic.reason, 'value_definition_missing');
    assert.deepEqual(diagnostic.use_path, path);
    assert.deepEqual(diagnostic.scope, activeScope);
  }
  assert.equal(partial.cel.conformity, null);
  assert.equal(partial.cel.constraints.find(d => d.identity === independent.identity).resolution, 'resolved');
  const selected = compileSpecification({ unit: 'diagnostics', constraints: rows, collections: [],
    selectedConstraintIds: new Set([independent.identity]), orderedSequence: 'ordered_sequence', open: { statements: 0, collections: 0, unresolved: 0 } });
  assert.equal(selected.state, 'complete');
  assert.deepEqual(selected.unresolved_definitions, []);
});

test('nested operative selection preserves its active scope and ordinary object relations need no typed value', () => {
  const lexical = { owner: entity('value'), path: [0] };
  const declaration = row('value', false, [{ value: { local: { slot: 'value', depth: 0 } } }]);
  declaration.constraint.for_each = [{ scope: lexical, domain: { list: { element_type: 'int', items: [] } }, bind: { value: 'value' } }];
  const value = row('value', true, [{ value: { literal: { int64Value: '3' } } }]);
  const nested = row('value', false, [{ value: { selection: { from: { list: { element_type: 'int', items: [] } }, path: [{ index: { referent: entity('missing_nested') } }] } } }]);
  nested.constraint.within = lexical;
  nested.identity = 'nested-use';
  const partial = compile([value, declaration, nested]);
  const diagnostic = partial.unresolved_definitions.find(d => d.constraint_identity === nested.identity);
  assert.equal(diagnostic.reason, 'value_definition_missing');
  assert.deepEqual(diagnostic.scope, lexical);
  assert.deepEqual(diagnostic.use_path, ['operands', 0, 'value', 'selection', 'path', 0, 'index', 'referent']);
  const object = { identity: 'object', constraint: { form: 'statement', subject: entity('op'), relation: 'reference:supports',
    nature: 'behavior', modality: 'MUST', operands: [{ reference: entity('thing') }], applies: scope } };
  const ordinary = compile([object]);
  assert.equal(ordinary.state, 'complete');
  assert.deepEqual(ordinary.unresolved_definitions, []);
});


test('a typed ordering operand reports its reference field without an invented value wrapper', () => {
  const definition = row('event', true, [{ observation: { operation: entity('op'), occurrence: entity('call'), root: 'events', path: [],
    type: { record: { fields: [{ name: 'position', type: 'int', presence: 'required' }] } } } }]);
  definition.constraint.relation = 'value:observed_at';
  const use = row('event', false, [{ reference: entity('missing_event') }]);
  use.constraint.relation = 'reference:precedes';
  const partial = compile([definition, use]);
  const diagnostic = partial.unresolved_definitions.find(d => d.constraint_identity === use.identity);
  assert.equal(diagnostic.reason, 'value_definition_missing');
  assert.deepEqual(diagnostic.referent, entity('missing_event'));
  assert.deepEqual(diagnostic.use_path, ['operands', 0, 'reference']);
  assert.equal(partial.cel.conformity, null);
});
