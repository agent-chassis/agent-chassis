

import { createHash } from 'node:crypto';
import { CONTROLLED_VOCABULARY, canonicalValue } from '../vocabulary/controlled-contract-vocabulary.v1.mjs';
import { CEL_REFERENCE, MEMBER_OBSERVATION } from './cel-observation-model.mjs';
import { MODALITIES as MEMBERSHIP_MODALITIES, conformityExpression } from './closed-membership.mjs';
import { buildEqualityNormalizationV1 } from './equality-normalization-v1.mjs';
import { DEFAULT_MANDATORY_MODALITIES } from './native-contract-dag.mjs';

import NATIVE_CONTRACT_SCHEMA_V1 from './stable-contract-schema-v1.mjs';
import { isValueConstraint, lowerValueSpecification, valueInventoryRows } from './cel-scope-lowering.mjs';
import { valueReferences } from './controlled-values-v1.mjs';

export const LOWERING_VERSION = 'semantic-builder-cel-lowering.experimental.v4';
export const STATEMENT_FORM = 'statement';
export const MEMBERSHIP_FORM = 'closed_membership';
export const UNCONDITIONAL = 'unconditional';

export const CEL_ENVIRONMENT = Object.freeze({ language: CEL_REFERENCE, macros: Object.freeze(['all', 'exists']),
  extension_functions: Object.freeze({ lists: Object.freeze(['distinct']) }) });

const MODALITIES = NATIVE_CONTRACT_SCHEMA_V1.$defs.declarative_claim.properties.modality.enum;
const NEGATIVE = Object.freeze(['MUST_NOT']);
export const FORCE = Object.freeze({ mandatory: 'mandatory', recommended: 'recommended', permitted: 'permitted' });
const forceOf = modality => {
  if (DEFAULT_MANDATORY_MODALITIES.includes(modality)) return FORCE.mandatory;
  if (modality === 'MAY') return FORCE.permitted;
  return drift(`modality ${JSON.stringify(modality)} is unsupported; use MUST, MUST_NOT or MAY`);
};

export const GAPS = Object.freeze({
  qualifier_not_encoded: 'An operative field or qualifier has no compiler mapping; it is retained and cannot receive complete conformance credit.',
  condition_definition_missing: 'The referenced condition has no applicable, complete Boolean predicate definition. Source existence or another statement cannot supply its Boolean meaning.',
  condition_value_binding_unsupported: 'The reference has no supported predicate binding. Author its Boolean/numeric/range predicate with the existing typed observation; source location alone supplies no runtime truth.',
  condition_definition_ambiguous: 'The condition resolves to competing identities or incompatible scopes; multiple contributing predicates alone are not ambiguity.',
  no_lowering_rule: 'The vocabulary\'s declarations of this relation (operand kind, multiplicity, complement, population semantics, cross-operator constraints) fit no lowering rule.',
  count_not_a_cel_int: 'The stated count is not a safe integer, so it has no exact CEL int literal.',
  entity_keys_collide: 'Two different entities of this specification have the same entity key, so a string literal would not say which is meant.',
  equality_scope_ambiguous: 'Mandatory equalities of more than one scope apply to this statement\'s applicability and normalize it differently; the production normalization reports the context as ambiguous and chooses none.' });

export const COVERAGE_CLASSES = Object.freeze({
  undefined: 'No existing definition states this meaning or policy. It is not manufactured.',
  defined_not_encoded: 'An existing definition states this meaning and the compiler does not encode it. A specification it bears on says so in its own result.',
  structural: 'The meaning is kept in the canonical and compiled structure, not as a Boolean predicate.',
  observation_assumption: 'It is a property of the observations supplied, which no expression can establish.',
  bounded_limitation: 'A limit of this implementation, with a stated bound.' });
export const COVERAGE = Object.freeze({
  permission_against_prohibition: { class: 'structural', text: 'A permission contributes its active value to the closed extension. Applicable MUST and MUST_NOT predicates remain mandatory, so MAY cannot weaken them.' },
  temporal_boundary: { class: 'undefined', text: 'The vocabulary does not say whether the boundary instant itself is inside "before", "after", "during", "while" or "until". The applicability observation says '
    + 'whether the situation is in scope, so this is also an observation assumption.' },
  modality_force: { class: 'structural', text: 'The force of MUST, MUST_NOT and MAY is carried as "modality" and "force" beside the statement\'s predicate, and by which aggregate the predicate is in.' },
  claim_nature: { class: 'structural', text: 'A claim\'s nature (behavior or evidence) is carried as "nature" and is in the identity; the schema defines evidence as a record of a fact "without turning it into behavior".' },
  collection_meaning: { class: 'structural', text: 'A collection "measures authored population/order and does not by itself imply implementation cohesion". Its kind and order are kept as structure. An ordered '
    + 'sequence is not reference:ordered_as: its authored order imposes no order of execution.' },
  interval_coverage: { class: 'observation_assumption', text: 'A predicate is of one observation. That an interval ("while", "during", "until") is observed throughout is the evaluator\'s to establish.' },
  supplied_observations: { class: 'observation_assumption', text: 'Every binding an expression reads must be supplied, and a single numeric or boolean value is assumed to exist. The input contract constrains the bindings a '
    + 'specification reads: a symmetric, transitive or inverse law is emitted between the extensions it reads (each clause names its subjects) and says nothing of a subject whose extension is not read.' },
  scope_relations: { class: 'bounded_limitation', text: 'The vocabulary declares no entailment between applicabilities ("controlled_entailments: none"), and none is compiled. Where mandatory equalities of two '
    + 'different scopes both apply to one observation, each names its references by its own class; the two classes are not merged.' } });

const digest = value => createHash('sha256').update(JSON.stringify(canonicalValue(value))).digest('hex');
const canonical = value => JSON.stringify(canonicalValue(value));
const drift = message => { throw new TypeError(`cel lowering: ${message}`); };
const operators = new Map(CONTROLLED_VOCABULARY.operators.map(row => [row.term, row]));
const modes = new Map(CONTROLLED_VOCABULARY.applicability_modes.map(row => [row.term, row]));
const local = term => term.slice(term.indexOf(':') + 1);
if (canonical(MODALITIES) !== canonical(['MUST', 'MUST_NOT', 'MAY'])) drift('the claim modalities disagree with MUST/MUST_NOT/MAY');

export function definitionMeaning(constraint) {
  if (constraint.relation?.startsWith('value:')) return constraint.definition
    ? [...(operators.get(constraint.relation)?.definition_capability ?? [])] : ['subject'];
  if (constraint.form === MEMBERSHIP_FORM) return ['structure', 'population'];
  if (constraint.nature !== 'behavior') return [];
  const operator = operators.get(constraint.relation);
  if (!operator) return [];
  const meanings = [];
  if (['boolean', 'number', 'range'].includes(operator.signature.operand_kind)) meanings.push('subject');

  if (['boolean', 'number', 'range'].includes(operator.signature.operand_kind)
    && MODALITIES.includes(constraint.modality) && !ruleOf(constraint.relation).unsupported) meanings.push('condition');

  const positiveValue = constraint.modality === 'MUST' || (constraint.modality === 'MUST_NOT'
    && operator.controlled_complement.kind === 'operator' && operator.controlled_complement.term === 'number:equals');
  const valueRelation = constraint.modality === 'MUST_NOT' && operator.controlled_complement.kind === 'operator'
    ? operator.controlled_complement.term : constraint.relation;
  if (positiveValue && ['number:equals', 'number:has_value', 'range:has_range', 'reference:has_value'].includes(valueRelation)) meanings.push('value');
  if (operator.population_semantics.kind === 'closed_extensional_relation' || MEMBERSHIP_CONTAINER[constraint.relation]
    || constraint.relation === POPULATION.exact_cardinality_operator) meanings.push('population');
  if (operator.multiplicity === 'complete_order' || ['reference:has_property', 'reference:has_state', 'reference:has_status'].includes(constraint.relation)) meanings.push('structure');
  if (['number:returns', 'number:emits', 'reference:accepts', 'reference:adds', 'reference:allows', 'reference:approves',
    'reference:authorizes', 'reference:blocks', 'reference:calls', 'reference:creates', 'reference:deletes', 'reference:depends_on',
    'reference:emits', 'reference:exports', 'reference:forwards_to', 'reference:generates', 'reference:imports', 'reference:modifies',
    'reference:mutates', 'reference:omits', 'reference:performs', 'reference:reads', 'reference:records', 'reference:rejects',
    'reference:replaces', 'reference:requests_authorization', 'reference:retains', 'reference:returns', 'reference:routes_to',
    'reference:starts', 'reference:targets', 'reference:writes'].includes(constraint.relation)) meanings.push('behavior');
  return meanings;
}

const extraFields = (value, allowed) => Object.keys(value).filter(key => !allowed.includes(key));
export function unsupportedConstraintQualifiers(constraint) {
  const extras = extraFields(constraint, constraint.form === MEMBERSHIP_FORM
    ? ['form', 'subject', 'applies', 'clauses', 'for_each', 'within'] : ['form', 'nature', 'modality', 'relation', 'subject', 'operands', 'applies', 'definition', 'for_each', 'within']);
  extras.push(...extraFields(constraint.applies, ['mode', 'context']).map(key => `applies.${key}`));
  const mode = modes.get(constraint.applies.mode);
  if (!mode) extras.push('applies.mode');
  else {
    const count = new Set(constraint.applies.context.map(entityKey)).size;
    const bounds = mode.context_reference_cardinality;
    if (count < bounds.minimum || (bounds.maximum !== null && count > bounds.maximum)) extras.push('applies.context');
  }
  for (const [index, operand] of (constraint.operands ?? []).entries()) {
    extras.push(...extraFields(operand, ['reference', 'number', 'boolean', 'range', 'value', 'type', 'observation', 'binding']).map(key => `operands[${index}].${key}`));
    if (['reference', 'number', 'boolean', 'range', 'value', 'type', 'observation', 'binding'].filter(key => Object.hasOwn(operand, key)).length !== 1) extras.push(`operands[${index}]`);
    if (operand.range) extras.push(...extraFields(operand.range, ['minimum', 'maximum']).map(key => `operands[${index}].range.${key}`));
  }
  for (const [index, clause] of (constraint.clauses ?? []).entries()) extras.push(...extraFields(clause, ['member', 'domain', 'modality']).map(key => `clauses[${index}].${key}`));
  return extras;
}

const populations = CONTROLLED_VOCABULARY.operators.map(row => row.population_semantics).filter(row => row.kind === 'closed_extensional_relation');
if (!populations.length || new Set(populations.map(row => JSON.stringify([row.membership_operators, row.exact_cardinality_operator, row.equality_operator, row.closure]))).size !== 1) drift(
  'population relations do not share one definition of a population');
const [POPULATION] = populations;
if (POPULATION.closure !== 'exact_cardinality_equals_distinct_declared_members') drift('a population\'s cardinality is no longer its distinct members');

const MEMBERSHIP_CONTAINER = Object.freeze({ 'reference:contains': 'subject', 'reference:member_of': 'operand' });
for (const term of POPULATION.membership_operators) if (!MEMBERSHIP_CONTAINER[term]) drift(`membership relation ${term} has no stated container side`);

{ const declaredMembership = CONTROLLED_VOCABULARY.cross_operator_constraints.constraints.filter(row => row.kind === 'exact_number_not_below_declared_membership');
  const side = (name, container) => declaredMembership.length === 1 && canonical(declaredMembership[0][name]) === canonical(Object.keys(MEMBERSHIP_CONTAINER).filter(term => MEMBERSHIP_CONTAINER[term] === container));
  if (!side('contains_operators', 'subject') || !side('member_of_operators', 'operand')) drift('the declared membership of a population is no longer the two membership relations, one from each end'); }
const crossConstraints = CONTROLLED_VOCABULARY.cross_operator_constraints.constraints;
if (CONTROLLED_VOCABULARY.cross_operator_constraints.mechanical_support !== 'enforced') drift('the cross-operator constraints are no longer enforced');
const EQUALITY = new Set(crossConstraints.filter(row => row.kind === 'reference_equivalence_substitution').flatMap(row => row.equivalence_operators));
if (EQUALITY.size !== 1 || !EQUALITY.has(POPULATION.equality_operator)) drift('reference equality is no longer the one relation the production normalization substitutes by');

const boundedBy = term => [...new Set(crossConstraints.filter(row => row.kind === 'exact_number_within_range' && row.range_operators.includes(term)).flatMap(row => row.exact_operators))];
const POPULATION_RELATIONS = Object.freeze({ subset: (left, right) => `${left}.all(m, m in ${right})`, not_subset: (left, right) => `${left}.exists(m, !(m in ${right}))` });
const enforced = (operator, trait) => operator.algebraic_traits[trait] === true && operator.mechanical_support.algebraic_traits[trait] === 'enforced';
for (const term of POPULATION.membership_operators) if (!enforced(operators.get(term), 'irreflexive')) drift(`membership relation ${term} is no longer irreflexive`);

const INTERVAL = /\b(throughout|continuously|during)\b/;
const EXTENT = mode => INTERVAL.test(modes.get(mode).definition) ? 'interval' : 'situation';
for (const mode of ['while', 'until', 'during']) if (EXTENT(mode) !== 'interval') drift(`applicability mode ${mode} is no longer defined over an interval`);

export function ruleOf(term) {
  const operator = operators.get(term);
  if (!operator) drift(`relation ${term} is not in the vocabulary`);
  const kind = operator.signature.operand_kind;
  if (kind === 'value') return { rule: 'typed_value', positional_payloads: operator.signature.positional_payloads };
  const complement = operator.controlled_complement;
  if (operator.population_semantics.kind === 'closed_extensional_relation') return POPULATION_RELATIONS[operator.population_semantics.relation]
    ? { rule: 'population_relation', relation: operator.population_semantics.relation } : { unsupported: 'no_lowering_rule' };
  if (EQUALITY.has(term)) return { rule: 'denotation' };
  if (MEMBERSHIP_CONTAINER[term]) return { rule: 'membership', container: MEMBERSHIP_CONTAINER[term] };
  if (term === POPULATION.exact_cardinality_operator) return { rule: 'cardinality' };
  if (kind === 'range') { const bounds = boundedBy(term);
    return bounds.length && bounds.every(other => ['value', 'value_set', 'cardinality'].includes(ruleOf(other).rule)) ? { rule: 'range', bounds } : { unsupported: 'no_lowering_rule' }; }

  if (complement.kind === 'operator' && operator.multiplicity === 'conjunctive_constraint') {
    const positive = ruleOf(complement.term);
    return positive.rule ? { rule: 'negation', of: complement.term } : positive;
  }
  if (operator.mechanical_support.multiplicity !== 'enforced') return { unsupported: 'no_lowering_rule' };
  if (kind === 'boolean' && operator.multiplicity === 'single_value_per_subject_scope') return { rule: 'attribute' };

  if (term === 'number:returns' && operator.multiplicity === 'single_value_per_subject_scope') return { rule: 'value_set', single: true };
  if (kind === 'number' && operator.multiplicity === 'single_value_per_subject_scope') return { rule: 'value' };
  if (kind === 'number' && operator.multiplicity === 'relation_set') return { rule: 'value_set' };
  if (kind === 'reference' && operator.multiplicity === 'complete_order') return { rule: 'order' };

  if (kind === 'reference' && ['relation_set', 'equivalence_relation', 'single_value_per_subject_scope'].includes(operator.multiplicity)) return { rule: 'relation',
    ...(operator.multiplicity === 'single_value_per_subject_scope' ? { single: true } : {}) };
  return { unsupported: 'no_lowering_rule' };
}
for (const operator of CONTROLLED_VOCABULARY.operators.filter(row => row.signature.operand_kind !== 'value')) if ((operator.operand_semantics.ordering === 'significant') !== (ruleOf(operator.term).rule === 'order')) drift(`${operator.term}: operand order is significant exactly where the observation is an order`);

const declared = (operator, trait) => operator.algebraic_traits[trait] === true;
for (const operator of CONTROLLED_VOCABULARY.operators) for (const trait of ['irreflexive', 'symmetric', 'transitive']) if (declared(operator, trait)
  && !['enforced', 'declared_only'].includes(operator.mechanical_support.algebraic_traits[trait])) drift(`${operator.term}: a declared ${trait} trait has a support this lowering does not know`);
const traitsOf = relation => { const operator = operators.get(relation); const rule = ruleOf(relation);
  return rule.rule !== 'relation' ? [] : [...(rule.single ? ['single_valued'] : []), ...['irreflexive', 'symmetric', 'transitive'].filter(trait => declared(operator, trait))]; };

export const entityKey = entity => entity.identity.kind === 'profile_term' ? entity.identity.term : `${entity.identity.kind}|${JSON.stringify(canonicalValue(entity.identity))}`;
const text = value => JSON.stringify(value);

const double = value => { const written = String(Object.is(value, -0) ? 0 : value); return /[.e]/.test(written) ? written : `${written}.0`; };
const MEANING = Object.freeze({
  attribute: definition => `the one true or false value of this for the subject, in the situation observed: ${definition}`,
  value: definition => `the one numeric value this is stated of, in the situation observed: ${definition}`,
  value_set: definition => `every number for which this holds of the subject in the situation observed; order and repetition carry no meaning: ${definition}`,
  relation: definition => `the entity key of every operand for which this holds of the subject in the situation observed; order and repetition carry no meaning: ${definition}`,
  order: definition => `the entity keys of the operands in their order, in the situation observed: ${definition}`,
  denotation: definition => `a stable name of the controlled value this reference denotes in the situation observed; two references have one name exactly when this holds of them: ${definition}`,
  applicability: (definition, mode) => `whether the situation observed is one this says of the context: ${definition}${EXTENT(mode) === 'interval'
    ? ' This is of ONE observation: the interval is covered only by observations throughout it, each of which the statement constrains.' : ''}`,

  condition_holds: () => `whether this referenced condition holds in the situation observed, as these read it: ${modes.get('if').definition} ${modes.get('unless').definition}` });
const TYPES = Object.freeze({ attribute: 'bool', value: 'double', value_set: 'list<double>', relation: 'list<string>', order: 'list<string>',
  members: MEMBER_OBSERVATION.type, denotation: 'string', applicability: 'bool' });

function binding(fact, entity, { relation = null, mode = null } = {}) {
  const word = fact === 'members' ? 'members' : fact === 'denotation' ? 'denotes' : fact === 'applicability' ? (mode === 'if' || mode === 'unless' ? 'holds' : mode) : local(relation);

  const about = fact === 'applicability' && word === 'holds' ? { fact, reads: 'condition_holds' } : { fact, ...(relation ? { relation } : {}), ...(mode ? { mode, extent: EXTENT(mode) } : {}) };
  const definition = relation ? operators.get(relation).definition : mode ? modes.get(mode).definition : fact === 'denotation' ? operators.get(POPULATION.equality_operator).definition : null;
  return { name: `${word}_${digest({ fact, ...(about.reads ? { reads: about.reads } : {}), ...(relation ? { relation } : {}), ...(mode && !about.reads ? { mode } : {}), identity: entity.identity }).slice(0, 10)}`,
    type: TYPES[fact], ...about, entity: { key: entityKey(entity), type_term: entity.type_term, identity: entity.identity },
    meaning: fact === 'members' ? MEMBER_OBSERVATION.meaning : about.reads ? MEANING[about.reads]() : MEANING[fact](definition, mode) };
}
const members = entity => binding('members', entity);

const bounds = (value, range) => [...(range.minimum === undefined ? [] : [`${value} >= ${double(range.minimum)}`]),
  ...(range.maximum === undefined ? [] : [`${value} <= ${double(range.maximum)}`])].join(' && ');
const distinctCount = name => `size(${name}.distinct())`;

function proposition(relation, subject, operands, read, key) {
  const rule = ruleOf(relation);
  if (rule.unsupported) return { unsupported: rule.unsupported };
  const [operand] = operands;
  const use = row => { read.push(row); return row.name; };
  switch (rule.rule) {

    case 'negation': { const own = operators.get(relation);
      const parts = [];
      for (const row of operands) { const positive = proposition(rule.of, subject, [row], read, key);
        if (positive.unsupported) return positive;
        const [mine, other] = row.reference && declared(own, 'irreflexive') && ruleOf(rule.of).rule !== 'denotation' ? [key(subject), key(row.reference)] : [null, null];
        parts.push(mine === null || (mine !== other && mine.startsWith('"') && other.startsWith('"')) ? `!(${positive.expression})` : `!(${positive.expression}) && ${mine} != ${other}`); }
      return { expression: parts.join(' && ') }; }
    case 'population_relation': return { expression: POPULATION_RELATIONS[rule.relation](use(members(subject)), use(members(operand.reference))) };
    case 'membership': return rule.container === 'subject' ? { expression: `${key(operand.reference)} in ${use(members(subject))}` }
      : { expression: `${key(subject)} in ${use(members(operand.reference))}` };
    case 'cardinality': return Number.isSafeInteger(operand.number) ? { expression: `${distinctCount(use(members(subject)))} == ${operand.number}` } : { unsupported: 'count_not_a_cel_int' };

    case 'range': return { expression: rule.bounds.map(other => { const stated = ruleOf(other).rule;
      return stated === 'cardinality' ? bounds(`double(${distinctCount(use(members(subject)))})`, operand.range)
        : stated === 'value' ? bounds(use(binding('value', subject, { relation: other })), operand.range)
          : `${use(binding('value_set', subject, { relation: other }))}.all(v, ${bounds('v', operand.range)})`; }).join(' && ') };
    case 'attribute': return { expression: `${use(binding('attribute', subject, { relation }))} == ${operand.boolean}` };
    case 'value': return { expression: `${use(binding('value', subject, { relation }))} == ${double(operand.number)}` };
    case 'value_set': return { expression: `${double(operand.number)} in ${use(binding('value_set', subject, { relation }))}` };
    case 'denotation': return { expression: `${use(binding('denotation', subject))} == ${use(binding('denotation', operand.reference))}` };
    case 'order': return { expression: `${use(binding('order', subject, { relation }))} == [${operands.map(row => key(row.reference)).join(', ')}]` };
    case 'relation': return { expression: operands.map(row => `${key(row.reference)} in ${use(binding('relation', subject, { relation }))}`).join(' && ') };
    default: return drift(`rule ${rule.rule} has no generator`);
  }
}

function applicability(applies, read) {
  if (applies.mode === UNCONDITIONAL) return null;
  const facts = [...new Map(applies.context.map(entity => binding('applicability', entity, { mode: applies.mode })).map(row => [row.name, row])).values()].sort((left, right) => left.name < right.name ? -1 : 1);
  read.push(...facts);
  const holds = facts.map(row => row.name).join(' && ');
  return { holds, except: applies.mode === 'unless', applies: applies.mode === 'unless' ? `!(${holds})` : holds };
}

const guarded = (scope, body) => scope === null ? body : scope.except ? `(${scope.holds}) || (${body})` : `!(${scope.holds}) || (${body})`;
const named = rows => [...new Map(rows.map(row => [row.name, row])).values()].sort((left, right) => left.name < right.name ? -1 : 1);

const knownObservations = names => {
  const reads = [...new Set(names)].sort();
  return reads.length ? `size([${reads.map(name => `${name} == ${name}`).join(', ')}]) == ${reads.length}` : null;
};
const representativesOf = (key, equality) => new Set([key, ...equality.of(key).map(alias => alias.as)]);
const relatedSubjects = (left, right, equality) => [...representativesOf(left, equality)].some(key => representativesOf(right, equality).has(key));
const normalizedKey = (identity, equality, read) => equality.of(identity).reduceRight((otherwise, alias) => {
  read.push(...alias.bindings);
  return `(${alias.when} ? ${text(alias.as)} : ${otherwise})`;
}, text(identity));
const sameSubject = (left, right, equality, read) => left === right ? 'true'
  : `${normalizedKey(left, equality, read)} == ${normalizedKey(right, equality, read)}`;

function closedExtensions(rows, bindings, equality, relevance = new Map()) {
  const expressions = [];
  const dependencies = [];
  const unresolved = [];
  for (const observed of bindings.filter(row => ['relation', 'value_set'].includes(row.fact))) {
    const governing = rows.flatMap(({ constraint }) => [constraint,
      ...(constraint.form === STATEMENT_FORM && operators.get(constraint.relation)?.algebraic_traits.symmetric
        ? constraint.operands.filter(operand => operand.reference).map(operand => ({ ...constraint,
          subject: operand.reference, operands: [{ reference: constraint.subject }] })) : [])])
      .filter(constraint => constraint.form === STATEMENT_FORM
      && constraint.nature === 'behavior' && relatedSubjects(entityKey(constraint.subject), observed.entity.key, equality)
      && (constraint.relation === observed.relation || (ruleOf(constraint.relation).rule === 'range'
        && ruleOf(constraint.relation).bounds.includes(observed.relation))));
    if (!governing.length) continue;
    for (const constraint of governing) {
      const lowered = lowerConstraint(constraint);
      if (lowered.state !== 'lowered') unresolved.push({ entity: observed.entity, relation: observed.relation,
        reason: lowered.reason, gap: lowered.gap, ...(lowered.qualifiers ? { qualifiers: lowered.qualifiers } : {}) });
    }
    const permits = [];
    for (const constraint of governing.filter(row => ['MUST', 'MAY'].includes(row.modality))) {
      const read = [];
      const scope = applicability(constraint.applies, read);
      dependencies.push(...read);
      const active = `(${scope === null ? 'true' : scope.applies}) && (${sameSubject(entityKey(constraint.subject), observed.entity.key, equality, dependencies)})`;
      for (const operand of constraint.operands) {
        const value = operand.range ? bounds('m', operand.range)
          : `m == ${operand.reference ? normalizedKey(entityKey(operand.reference), equality, dependencies) : double(operand.number)}`;
        permits.push(`(${active}) && (${value})`);
      }
    }
    const active = relevance.get(observed.name)?.expression ?? 'true';
    const relevant = expression => active === 'true' ? expression : `!(${active}) || (${expression})`;
    expressions.push(relevant(conformityExpression({ clauses: [] }, observed.name,
      { permittedPredicate: permits.length ? permits.map(value => `(${value})`).join(' || ') : 'false' })));
    if (observed.relation === 'number:returns') expressions.push(relevant(`${distinctCount(observed.name)} <= 1`));
  }
  return { expressions, bindings: dependencies, unresolved };
}

function lowerConditionPredicate(constraint, equality) {
  const qualifiers = unsupportedConstraintQualifiers(constraint);
  if (qualifiers.length) return { state: 'unsupported', reason: 'qualifier_not_encoded', qualifiers };
  const read = [];
  const stated = proposition(constraint.relation, constraint.subject, constraint.operands, read,
    entity => normalizedKey(entityKey(entity), equality, read));
  return stated.unsupported ? { state: 'unsupported', reason: stated.unsupported }
    : { state: 'lowered', expression: stated.expression, bindings: named(read) };
}

function conditionDefinitions(rows, bindings, equality) {
  const consistency = [], dependencies = [], unresolved = [], definitions = new Map();
  const globalKeys = key => new Set([key, ...equality.of(key).filter(alias => !alias.bindings.some(row => row.fact === 'applicability')).map(alias => alias.as)]);
  for (const observed of bindings.filter(row => row.fact === 'applicability' && row.reads === 'condition_holds')) {
    const wanted = globalKeys(observed.entity.key);
    const candidates = rows.filter(row => row.constraint.applies.mode === UNCONDITIONAL
      && definitionMeaning(row.constraint).includes('condition')
      && [...globalKeys(entityKey(row.constraint.subject))].some(key => wanted.has(key)));
    const lowered = candidates.map(row => ({ ...lowerConditionPredicate(row.constraint, equality), identity: row.identity, constraint: row.constraint }));
    const unsupported = lowered.find(row => row.state !== 'lowered');

    const reason = unsupported ? unsupported.reason : !lowered.length
      ? ['code_symbol', 'repository_path'].includes(observed.entity.identity.kind) ? 'condition_value_binding_unsupported' : 'condition_definition_missing'
      : null;
    if (reason !== null) {
      unresolved.push({ entity: observed.entity, use: 'condition', reason, gap: GAPS[reason],
        definition_constraint_ids: candidates.map(row => row.identity), ...(unsupported?.qualifiers ? { qualifiers: unsupported.qualifiers } : {}) });
      continue;
    }
    dependencies.push(...lowered.flatMap(row => row.bindings));
    const predicate = [...new Set(lowered.map(row => `(${row.expression})`))].join(' && ');
    consistency.push(clause('condition_consistency', { subject: observed.entity.key, definition_constraint_ids: candidates.map(row => row.identity) },
      `${observed.name} == (${predicate})`, [observed.name, ...lowered.flatMap(row => row.bindings.map(binding => binding.name))]));
    definitions.set(observed.name, { constraint_ids: candidates.map(row => row.identity), predicate });
  }
  return { consistency, bindings: dependencies, unresolved, definitions };
}

export function lowerConstraint(constraint, aliases = () => []) {
  const read = [];
  const unsupported = reason => ({ state: 'unsupported', reason, gap: GAPS[reason] });
  const qualifiers = unsupportedConstraintQualifiers(constraint);
  if (qualifiers.length) return { ...unsupported('qualifier_not_encoded'), qualifiers };
  if (isValueConstraint(constraint)) return { state: 'lowered', expression: null,
    force: constraint.definition ? 'structural' : constraint.modality === 'MAY' ? FORCE.permitted : FORCE.mandatory,
    bindings: [], context_required: 'typed definitions and lexical domains' };

  const key = entity => aliases(entityKey(entity)).reduceRight((otherwise, alias) => { read.push(...alias.bindings); return `(${alias.when} ? ${text(alias.as)} : ${otherwise})`; }, text(entityKey(entity)));
  let body;
  let force = FORCE.mandatory;
  if (constraint.form === MEMBERSHIP_FORM) {
    if (constraint.clauses.some(clause => !MEMBERSHIP_MODALITIES.includes(clause.modality))) drift('a closed membership clause has a modality its owner does not define');
    const keyed = constraint.clauses.map(clause => ({ member: entityKey(clause.member), modality: clause.modality })).sort((left, right) => left.member < right.member ? -1 : 1);
    read.push(members(constraint.subject));

    const named = new Map(constraint.clauses.map(clause => [text(entityKey(clause.member)), key(clause.member)]));
    body = conformityExpression({ clauses: keyed }, read[0].name).replace(/"(?:[^"\\]|\\.)*"/g, literal => named.get(literal) ?? literal);
  } else if (constraint.form === STATEMENT_FORM) {
    force = forceOf(constraint.modality);
    const stated = proposition(constraint.relation, constraint.subject, constraint.operands, read, key);
    if (stated.unsupported) return unsupported(stated.unsupported);
    body = NEGATIVE.includes(constraint.modality) ? `!(${stated.expression})` : stated.expression;

    if (constraint.relation === 'number:returns' && constraint.modality === 'MUST') {
      const observed = binding('value_set', constraint.subject, { relation: constraint.relation });
      body = `${body} && ${observed.name}.all(v, v == ${double(constraint.operands[0].number)})`;
    }
  } else drift(`constraint form ${constraint.form} is not one the canonical owner makes`);
  const scope = applicability(constraint.applies, read);
  const bindings = named(read);

  for (const row of read) if (canonical(row) !== canonical(bindings.find(other => other.name === row.name))) drift(`binding name ${row.name} names two observations`);
  return { state: 'lowered', expression: guarded(scope, body), force, bindings };
}

const entitiesOf = constraint => [constraint.subject, ...constraint.applies.context, ...(constraint.operands ?? []).filter(row => row.reference).map(row => row.reference),
  ...(constraint.clauses ?? []).flatMap(clause => clause.member ? [clause.member] : []),
  ...valueReferences([...(constraint.operands ?? []).filter(row => row.value || row.observation || row.binding),
    ...(constraint.clauses ?? []).flatMap(clause => clause.domain ? [clause.domain] : []), ...(constraint.for_each ?? [])]),
  ...(constraint.within ? [constraint.within.owner] : [])];

function equalityOf(rows, byKey) {
  const contextOf = applies => ({ mode: applies.mode, operand_reference_ids: applies.context.map(entityKey) });
  const propositions = rows.map(({ identity, constraint }) => ({ proposition_id: identity, operator: constraint.relation ?? MEMBERSHIP_FORM, subject_reference_id: entityKey(constraint.subject),
    operands: (constraint.operands ?? []).map(row => row.reference ? { kind: 'reference', reference_id: entityKey(row.reference) } : { kind: 'literal' }), applicability_context: contextOf(constraint.applies) }));
  const claims = rows.filter(({ constraint }) => constraint.form === STATEMENT_FORM).map(({ identity, constraint }) => ({ kind: constraint.nature, modality: constraint.modality, proposition_id: identity }));
  const normalization = buildEqualityNormalizationV1({ propositions, claims });
  const ambiguous = new Set(normalization.ambiguous_contexts.map(canonical));
  const named = new Map();
  for (const { constraint } of rows) {
    if (constraint.form !== STATEMENT_FORM || !EQUALITY.has(constraint.relation) || constraint.modality !== DEFAULT_MANDATORY_MODALITIES[0]) continue;
    const read = [];
    const scope = applicability(constraint.applies, read);
    for (const entity of [constraint.subject, constraint.operands[0].reference]) {
      const representative = byKey.get(normalization.canonicalize(entityKey(entity), contextOf(constraint.applies)));
      if (entityKey(representative) === entityKey(entity)) continue;
      const denoted = [binding('denotation', entity), binding('denotation', representative)];
      const holds = `${denoted[0].name} == ${denoted[1].name}`;
      const row = { reference: entityKey(entity), as: entityKey(representative), when: scope === null ? holds : `${scope.applies} && ${holds}`, bindings: [...read, ...denoted] };
      named.set(canonical([row.reference, row.as, row.when]), row);
    }
  }
  const aliases = [...named.values()].sort((left, right) => canonical([left.reference, left.when]) < canonical([right.reference, right.when]) ? -1 : 1);
  return { aliases, of: reference => aliases.filter(row => row.reference === reference),
    ambiguous: applies => ambiguous.has(canonical({ mode: applies.mode, operand_reference_ids: [...new Set(applies.context.map(entityKey))].sort() })) };
}

const sameSet = (left, right) => `${left}.all(m, m in ${right}) && ${right}.all(m, m in ${left})`;
const ORDERED_FACTS = Object.freeze(['order']);
const SET_FACTS = Object.freeze(['members', 'relation', 'value_set']);
const coincides = (row, other) => ORDERED_FACTS.includes(row.fact) ? `${row.name} == ${other.name}` : SET_FACTS.includes(row.fact) ? sameSet(row.name, other.name)
  : row.type.startsWith('list') ? drift(`fact ${row.fact} is a list with no stated comparison`) : `${row.name} == ${other.name}`;
const clause = (kind, basis, expression, reads) => ({ kind, basis, expression, reads: [...new Set(reads)].sort() });

const lawOf = (relation, declaration) => ({ relation, declaration, support: declaration === 'inverse' ? operators.get(relation).mechanical_support.inverse : operators.get(relation).mechanical_support.algebraic_traits[declaration] });

const CONTAINS = Object.keys(MEMBERSHIP_CONTAINER).find(term => MEMBERSHIP_CONTAINER[term] === 'subject');

function inputContract(bindings, equality, conditions, relevance) {
  const clauses = [];
  const extensions = bindings.filter(row => row.fact === 'relation');
  const populations = bindings.filter(row => row.fact === 'members');

  const key = reference => { const reads = []; return { text: equality.of(reference).reduceRight((otherwise, alias) => { reads.push(...alias.bindings.map(row => row.name)); return `(${alias.when} ? ${text(alias.as)} : ${otherwise})`; }, text(reference)), reads }; };
  const self = row => key(row.entity.key);
  const between = (row, other) => ({ subjects: [row.entity.key, other.entity.key], reads: [row.name, other.name, ...self(row).reads, ...self(other).reads] });
  const transitive = (row, other) => `!(${self(other).text} in ${row.name}) || ${other.name}.all(m, m in ${row.name})`;
  for (const row of populations) clauses.push(clause('irreflexive', { relations: [...POPULATION.membership_operators], support: 'enforced', subjects: [row.entity.key] }, `!(${self(row).text} in ${row.name})`, [row.name, ...self(row).reads]));
  for (const row of extensions) {
    const traits = traitsOf(row.relation);
    if (traits.includes('single_valued')) clauses.push(clause('single_valued', { relation: row.relation, multiplicity: operators.get(row.relation).multiplicity, subjects: [row.entity.key] }, `${distinctCount(row.name)} <= 1`, [row.name]));
    if (traits.includes('irreflexive')) clauses.push(clause('irreflexive', { ...lawOf(row.relation, 'irreflexive'), subjects: [row.entity.key] }, `!(${self(row).text} in ${row.name})`, [row.name, ...self(row).reads]));
    for (const other of extensions.filter(entry => entry.relation === row.relation && entry.name !== row.name)) {
      const { subjects, reads } = between(row, other);
      if (traits.includes('symmetric') && row.name < other.name) clauses.push(clause('symmetric', { ...lawOf(row.relation, 'symmetric'), subjects }, `(${self(other).text} in ${row.name}) == (${self(row).text} in ${other.name})`, reads));
      if (traits.includes('transitive')) clauses.push(clause('transitive', { ...lawOf(row.relation, 'transitive'), subjects }, transitive(row, other), reads));
    }

    const inverse = operators.get(row.relation).inverse;
    if (inverse.kind === 'operator' && ruleOf(inverse.term).rule === 'relation' && row.relation < inverse.term) for (const other of extensions.filter(entry => entry.relation === inverse.term)) {
      const { subjects, reads } = between(row, other);
      clauses.push(clause('inverse', { ...lawOf(row.relation, 'inverse'), inverse: inverse.term, subjects }, `(${self(other).text} in ${row.name}) == (${self(row).text} in ${other.name})`, reads));
    }
  }

  const contains = operators.get(CONTAINS);
  const membership = declaration => ({ ...lawOf(CONTAINS, declaration), observes: [...POPULATION.membership_operators] });
  if (declared(contains, 'transitive')) for (const row of populations) for (const other of populations.filter(entry => entry.name !== row.name)) { const { subjects, reads } = between(row, other);
    clauses.push(clause('transitive', { ...membership('transitive'), subjects }, transitive(row, other), reads)); }

  if (contains.inverse.kind === 'operator' && ruleOf(contains.inverse.term).rule === 'relation') for (const row of populations) for (const other of extensions.filter(entry => entry.relation === contains.inverse.term)) {
    const { subjects, reads } = between(row, other);
    clauses.push(clause('inverse', { ...membership('inverse'), inverse: contains.inverse.term, subjects }, `(${self(other).text} in ${row.name}) == (${self(row).text} in ${other.name})`, reads)); }

  for (const alias of equality.aliases) {
    const reads = alias.bindings.map(row => row.name);
    for (const row of bindings.filter(entry => entry.type === 'list<string>')) clauses.push(clause('equal_references_named_once', { relation: POPULATION.equality_operator, reference: alias.reference, named: alias.as },
      `!(${alias.when}) || !(${text(alias.reference)} in ${row.name})`, [...reads, row.name]));
    for (const row of bindings.filter(entry => entry.entity.key === alias.reference && entry.fact !== 'denotation')) {
      const other = bindings.find(entry => entry.entity.key === alias.as && entry.fact === row.fact && entry.relation === row.relation && entry.mode === row.mode && entry.reads === row.reads);
      if (other && !reads.includes(row.name) && !reads.includes(other.name)) clauses.push(clause('equal_references_coincide', { relation: POPULATION.equality_operator, reference: alias.reference, named: alias.as },
        `!(${alias.when}) || (${coincides(row, other)})`, [...reads, row.name, other.name]));
    }
  }

  const scoped = clauses.map(row => {
    const paths = row.reads.map(name => relevance.get(name)).filter(path => path && path.expression !== 'true');
    const guards = [...new Set(paths.map(path => path.expression))];
    return guards.length ? { ...row, expression: `!(${guards.map(value => `(${value})`).join(' && ')}) || (${row.expression})`,
      reads: [...new Set([...row.reads, ...paths.flatMap(path => path.reads)])].sort() } : row;
  });
  return [...new Map([...scoped, ...conditions].map(row => [row.expression, row])).values()].sort((left, right) => left.expression < right.expression ? -1 : 1);
}

export const EVALUATION = Object.freeze({
  availability: 'not_provided', capture_completeness: 'not_established_by_generation', satisfaction: 'not_assessed',
  observation: 'One situation. Every binding is the fact of that situation; an expression that reads a binding the observation does not supply does not evaluate, and that is not a truth value.',
  admissible: 'cel.admissible holds of an observation exactly when its bindings satisfy the input contract. An observation it does not hold of is invalid input: it neither conforms nor violates.',
  conformity: 'cel.conformity holds when every applicable mandatory statement and the closed permissions of every governed extension hold. Violating values remain evaluable observations.',
  intervals: 'An applicability whose binding has extent "interval" is met only by observations throughout the interval. One observation establishes nothing of the rest of it.',
  conditions: 'A condition holds exactly when its resolved authored Boolean predicate holds. Its binding carries the defining constraints and predicate. Missing or ambiguous Boolean meaning withholds whole conformance; a guarded definition cannot establish the truth needed to decide its own guard.',
  recommended: 'No recommendation modality is admitted; cel.recommended is null.',
  permitted: 'MAY permits its declared value only while applicable, without requiring occurrence. Generated conformity also enforces closure over the governed extension.',
  satisfiability: 'Nothing here says whether any admissible observation conforms. Statements that cannot hold together are all compiled.' });

export function lowerSpecification(rows, { selectedConstraintIds = null } = {}) {
  if (rows.some(row => isValueConstraint(row.constraint))) {
    const defined = new Set(rows.filter(row => row.constraint.definition).map(row => JSON.stringify(row.constraint.subject.identity)));
    const typedRow = row => isValueConstraint(row.constraint) || (['reference:precedes', 'reference:follows'].includes(row.constraint.relation)
      && [row.constraint.subject, ...row.constraint.operands.map(operand => operand.reference)].some(entity => defined.has(JSON.stringify(entity.identity))));
    const typedRows = rows.filter(typedRow);
    const legacyRows = rows.filter(row => !typedRow(row));
    const typed = lowerValueSpecification(typedRows, { selectedConstraintIds, applicability, knownObservations });
    const legacySelection = selectedConstraintIds === null ? null : new Set(selectedConstraintIds);
    if (legacySelection) {
      const subjects = new Set(typedRows.filter(row => typed.constraints.some(included => included.identity === row.identity)).map(row => JSON.stringify(row.constraint.subject.identity)));
      for (const row of legacyRows) if (['MUST', 'MUST_NOT'].includes(row.constraint.modality) && subjects.has(JSON.stringify(row.constraint.subject.identity))) legacySelection.add(row.identity);
    }
    const legacy = lowerSpecification(legacyRows, { selectedConstraintIds: legacySelection });
    const hasLegacy = legacy.constraints.length > 0;
    const complete = typed.unresolved_definitions.length === 0 && typed.conformity !== null
      && (!hasLegacy || legacy.conformity !== null);
    return { ...legacy, constraints: [...legacy.constraints, ...typed.constraints],
      conformity: complete ? hasLegacy ? `(${legacy.conformity}) && (${typed.conformity})` : typed.conformity : null,
      admissible: complete ? hasLegacy ? `(${legacy.admissible}) && (${typed.admissible})` : typed.admissible : null,
      bindings: named([...legacy.bindings, ...typed.bindings]), input_contract: [...legacy.input_contract, ...typed.input_contract],
      unresolved_definitions: [...legacy.unresolved_definitions, ...typed.unresolved_definitions],
      environment: { ...legacy.environment, ...typed.environment,
        extension_functions: { ...legacy.environment.extension_functions, ...typed.environment.extension_functions } } };
  }
  const byKey = new Map();
  let collision = false;
  for (const { constraint } of rows) for (const entity of entitiesOf(constraint)) {
    if (byKey.has(entityKey(entity)) && canonical(byKey.get(entityKey(entity)).identity) !== canonical(entity.identity)) collision = true;
    byKey.set(entityKey(entity), entity);
  }
  const gap = (identity, reason) => ({ identity, state: 'unsupported', reason, gap: GAPS[reason] });
  const equality = collision ? { aliases: [], of: () => [], ambiguous: () => false } : equalityOf(rows, byKey);
  const whole = rows.map(({ identity, constraint }) => collision ? gap(identity, 'entity_keys_collide') : equality.ambiguous(constraint.applies) ? gap(identity, 'equality_scope_ambiguous')
    : { identity, ...lowerConstraint(constraint, equality.of) });
  const selected = selectedConstraintIds === null ? whole : whole.filter(row => selectedConstraintIds.has(row.identity));
  const observed = named(selected.flatMap(row => row.bindings ?? []));
  let closure = collision ? { expressions: [], bindings: [], unresolved: [] } : closedExtensions(rows, observed, equality);
  let conditionsResolved = conditionDefinitions(rows, named([...observed, ...closure.bindings]), equality);
  const governing = new Map();

  const relevanceOf = predicateBindings => {
    const guards = new Map();
    const add = (binding, active, reads = []) => {
      const paths = guards.get(binding.name) ?? new Map();
      paths.set(active, reads);
      guards.set(binding.name, paths);
    };
    for (const binding of [...observed, ...predicateBindings]) add(binding, 'true');
    for (const row of governing.values()) for (const binding of row.bindings ?? []) add(binding, row.relevance ?? 'true', row.relevance_reads);
    return new Map([...guards].map(([name, paths]) => [name, paths.has('true') ? { expression: 'true', reads: [] }
      : { expression: [...paths.keys()].sort().map(value => `(${value})`).join(' || '), reads: [...new Set([...paths.values()].flat())].sort() }]));
  };
  while (true) {
    const before = governing.size;
    const previousDependencies = canonical(named([...closure.bindings, ...conditionsResolved.bindings]));
    const contextBindings = named([...observed, ...closure.bindings, ...[...governing.values()].flatMap(row => row.bindings ?? [])]);
    conditionsResolved = conditionDefinitions(rows, contextBindings, equality);

    const relevance = relevanceOf(conditionsResolved.bindings);
    if (!collision) closure = closedExtensions(rows, named([...contextBindings, ...conditionsResolved.bindings]), equality, relevance);
    const definitionFacts = named([...contextBindings, ...conditionsResolved.bindings])
      .filter(row => !['applicability', 'denotation'].includes(row.fact));
    for (const row of selectedConstraintIds === null ? [] : whole) {
      if (selectedConstraintIds.has(row.identity) || governing.has(row.identity)) continue;
      const constraint = rows.find(candidate => candidate.identity === row.identity).constraint;
      if (constraint.form !== MEMBERSHIP_FORM && !(constraint.nature === 'behavior'
        && DEFAULT_MANDATORY_MODALITIES.includes(constraint.modality))) continue;
      const read = [];
      const relevanceReads = new Set();
      const matches = (row.bindings ?? []).flatMap(binding => definitionFacts.filter(fact => binding.fact === fact.fact
        && binding.relation === fact.relation && relatedSubjects(binding.entity.key, fact.entity.key, equality))
        .map(fact => {
          const same = sameSubject(binding.entity.key, fact.entity.key, equality, read);
          const path = relevance.get(fact.name);
          for (const name of path?.reads ?? []) relevanceReads.add(name);
          const active = path?.expression ?? 'true';
          return active === 'true' ? same : same === 'true' ? active : `(${active}) && (${same})`;
        }));

      const equalityContext = EQUALITY.has(constraint.relation) && [constraint.subject, ...constraint.operands.map(operand => operand.reference)]
        .some(entity => definitionFacts.some(fact => relatedSubjects(entityKey(entity), fact.entity.key, equality)));

      if (row.state !== 'lowered' && (equalityContext || definitionFacts.some(fact => fact.relation === constraint.relation
        && relatedSubjects(entityKey(constraint.subject), fact.entity.key, equality)))) {
        governing.set(row.identity, row);
        continue;
      }
      if (!matches.length && !equalityContext) continue;
      const active = equalityContext || matches.includes('true') ? null : [...new Set(matches)].map(value => `(${value})`).join(' || ');
      governing.set(row.identity, { ...row, relevance: active ?? 'true', relevance_reads: [...new Set([...read.map(binding => binding.name), ...relevanceReads])].sort(), expression: active === null ? row.expression : `!(${active}) || (${row.expression})`,
        bindings: named([...(row.bindings ?? []), ...read]) });
    }

    if (governing.size === before && previousDependencies === canonical(named([...closure.bindings, ...conditionsResolved.bindings]))) break;
  }
  const lowered = selectedConstraintIds === null ? whole : whole.flatMap(row => selectedConstraintIds.has(row.identity) ? [row]
    : governing.has(row.identity) ? [governing.get(row.identity)] : []);
  const merged = new Map();
  for (const row of lowered) for (const entry of row.bindings ?? []) {
    if (merged.has(entry.name) && canonical(merged.get(entry.name)) !== canonical(entry)) drift(`binding name ${entry.name} names two observations`);
    merged.set(entry.name, entry);
  }

  const conditionContext = conditionDefinitions(rows, named([...merged.values(), ...closure.bindings]), equality);
  for (const dependency of [...closure.bindings, ...conditionsResolved.bindings, ...conditionContext.bindings]) merged.set(dependency.name, dependency);
  const definitions = new Map([...conditionsResolved.definitions, ...conditionContext.definitions]);
  const bindings = named([...merged.values()]).map(row => definitions.has(row.name) ? { ...row, definition: definitions.get(row.name) } : row);

  const omitted = [];
  const consistency = [...new Map([...conditionsResolved.consistency, ...conditionContext.consistency].map(row => [row.expression, row])).values()];
  const relevance = relevanceOf([...conditionsResolved.bindings, ...conditionContext.bindings]);
  const contract = collision ? [] : inputContract(bindings, equality, consistency, relevance);
  const unresolvedDefinitions = [...new Map([...closure.unresolved, ...conditionsResolved.unresolved, ...conditionContext.unresolved]
    .map(row => [canonical(row), row])).values()];
  const complete = lowered.length > 0 && lowered.every(row => row.state === 'lowered') && unresolvedDefinitions.length === 0;
  const conjunction = (force, empty) => { const mine = lowered.filter(row => row.force === force); return mine.length ? mine.map(row => `(${row.expression})`).join(' && ') : empty; };
  const all = [...lowered.map(row => row.expression ?? ''), ...closure.expressions, ...contract.map(row => row.expression)];
  const conformance = [conjunction(FORCE.mandatory, 'true'), ...closure.expressions.map(expression => `(${expression})`)].join(' && ');

  const conditionReads = [...new Set([...bindings.filter(row => row.fact === 'applicability').map(row => row.name), ...consistency.flatMap(row => row.reads)])].sort();

  const knownConditions = knownObservations(conditionReads);
  const admission = contract.length ? contract.map(row => `(${row.expression})`).join(' && ') : 'true';
  return { constraints: lowered.map(row => row.state === 'lowered' ? { identity: row.identity, force: row.force, expression: row.expression, reads: row.bindings.map(entry => entry.name),
    ...(selectedConstraintIds === null || selectedConstraintIds.has(row.identity) ? {} : { role: 'definition_context' }) }
    : { identity: row.identity, expression: null, not_lowered: { reason: row.reason, gap: row.gap, ...(row.qualifiers ? { qualifiers: row.qualifiers } : {}) } }),

  conformity: complete ? knownConditions === null ? conformance : `${knownConditions} ? (${conformance}) : false` : null, recommended: complete ? conjunction(FORCE.recommended, null) : null,
  admissible: complete ? knownConditions === null ? admission : `${knownConditions} ? (${admission}) : false` : null,
  input_contract: contract, bindings, unresolved_definitions: unresolvedDefinitions, evaluation: EVALUATION,

  coverage: { state: omitted.length ? 'omissions' : 'complete', omitted },
  environment: { language: CEL_ENVIRONMENT.language, macros: [...CEL_ENVIRONMENT.macros], extension_functions: all.some(expression => expression.includes('.distinct()')) ? { lists: ['distinct'] } : {} } };
}

const SAMPLE = Object.freeze({ s: { type_term: 'cc:entity', identity: { kind: 'profile_term', term: 'S' } }, o: { type_term: 'cc:entity', identity: { kind: 'profile_term', term: 'O' } },
  p: { type_term: 'cc:entity', identity: { kind: 'profile_term', term: 'P' } }, c: { type_term: 'cc:entity', identity: { kind: 'profile_term', term: 'C' } } });

const shaped = (expression, bindings) => bindings.reduce((written, row) => written.replaceAll(row.name, `${row.name.slice(0, row.name.lastIndexOf('_'))}<${row.entity.key}>`), expression);
const sampleOperands = operator => operator.signature.operand_kind === 'boolean' ? [{ boolean: true }] : operator.signature.operand_kind === 'number' ? [{ number: 2 }]
  : operator.signature.operand_kind === 'range' ? [{ range: { minimum: 1, maximum: 3 } }]
    : operator.signature.operand_cardinality.maximum === 1 ? [{ reference: SAMPLE.o }] : [{ reference: SAMPLE.o }, { reference: SAMPLE.p }];
const statement = (relation, operands, more = {}) => ({ form: STATEMENT_FORM, nature: 'behavior', modality: 'MUST', relation, subject: SAMPLE.s, operands, applies: { mode: UNCONDITIONAL, context: [] }, ...more });

export function loweringInventory() {
  const relations = CONTROLLED_VOCABULARY.operators.map(operator => {
    const rule = ruleOf(operator.term);
    if (operator.signature.operand_kind === 'value') {
      const example = lowerValueSpecification(valueInventoryRows(operator, SAMPLE.s, SAMPLE.o));
      return { relation: operator.term, operand_kind: 'value', operands_per_constraint: 'all, in declared positional order',
        multiplicity: operator.multiplicity, applicability_modes: 'all', positional_payloads: operator.signature.positional_payloads,
        type_rule: operator.signature.type_rule, authoring_roles: operator.authoring_roles,
        ...(example.conformity === null ? { rule: null, not_lowered: example.unresolved_definitions[0]?.reason }
          : { rule: 'typed_value', must: example.conformity, bindings: example.bindings,
            input_contract: example.input_contract, input_contract_predicates: [], input_contract_observations: [], environment: example.environment }) };
    }

    const operands = sampleOperands(operator);
    const row = { identity: 'sample', constraint: statement(operator.term, rule.rule === 'order' ? operands : operands.slice(0, 1)) };

    const mirrored = operator.signature.operand_kind === 'reference' ? [{ identity: 'mirror', constraint: { ...row.constraint, subject: SAMPLE.o, operands: [{ reference: SAMPLE.s }] } }] : [];
    const spec = lowerSpecification([row, ...mirrored]);
    const [lowered] = spec.constraints;
    const about = name => spec.bindings.filter(entry => entry.name === name);
    return { relation: operator.term, operand_kind: operator.signature.operand_kind, operands_per_constraint: rule.rule === 'order' ? 'all, in order' : 'one',
      multiplicity: operator.multiplicity, applicability_modes: operator.applicability.kind === 'all_declared_modes' ? 'all' : [...operator.applicability.modes],
      ...(lowered.expression ? { rule: rule.rule, ...(rule.of ? { negates: rule.of } : {}), ...(rule.bounds ? { bounds: rule.bounds } : {}),
        must: shaped(lowered.expression, spec.bindings), bindings: lowered.reads.flatMap(about).map(entry => ({ observes: entry.fact, ...(entry.relation ? { relation: entry.relation } : {}), type: entry.type, meaning: entry.meaning })),
        input_contract: [...new Set(spec.input_contract.map(entry => entry.kind))],
        input_contract_predicates: spec.input_contract.map(entry => ({ kind: entry.kind, expression: shaped(entry.expression, spec.bindings) })),
        input_contract_observations: spec.bindings.filter(entry => spec.input_contract.some(clause => clause.reads.includes(entry.name)))
          .map(entry => ({ binding: shaped(entry.name, [entry]), subject: entry.entity.key, observes: entry.fact,
            ...(entry.relation ? { relation: entry.relation } : {}), type: entry.type, meaning: entry.meaning })) }
        : { rule: null, not_lowered: lowered.not_lowered.reason }) };
  });
  const modalities = MODALITIES.map(modality => { const lowered = lowerConstraint(statement('boolean:exists', [{ boolean: true }], { modality }));
    return { modality, force: lowered.force, predicate: NEGATIVE.includes(modality) ? 'the negation of the statement' : 'the statement', example: shaped(lowered.expression, lowered.bindings),
      aggregate: lowered.force === FORCE.mandatory ? 'conformity' : lowered.force === FORCE.recommended ? 'recommended' : null }; });
  const applicability_modes = CONTROLLED_VOCABULARY.applicability_modes.map(mode => {
    const lowered = lowerConstraint(statement('boolean:exists', [{ boolean: true }], { applies: { mode: mode.term, context: mode.term === UNCONDITIONAL ? [] : [SAMPLE.c] } }));
    return { mode: mode.term, lowering: mode.term === UNCONDITIONAL ? 'the statement, unguarded' : mode.term === 'unless' ? 'every context observation holds, or the statement' : 'not every context observation holds, or the statement',
      example: shaped(lowered.expression, lowered.bindings), bindings: lowered.bindings.filter(row => row.fact === 'applicability').map(row => ({ observes: row.reads ?? row.mode, type: row.type, ...(row.extent ? { extent: row.extent } : {}) })) };
  });
  const membership = lowerConstraint({ form: MEMBERSHIP_FORM, subject: SAMPLE.s, applies: { mode: UNCONDITIONAL, context: [] },
    clauses: [{ member: SAMPLE.o, modality: 'MUST' }, { member: SAMPLE.p, modality: 'MAY' }] });
  return { version: LOWERING_VERSION, environment: CEL_ENVIRONMENT, relations, modalities, applicability_modes,
    closed_membership: { clause_modalities: [...MEMBERSHIP_MODALITIES], lowering: 'every MUST member is present and every present member is listed (closed-membership.mjs)',
      example: shaped(membership.expression, membership.bindings), bindings: membership.bindings.map(row => ({ observes: row.fact, type: row.type })), input_contract: ['irreflexive'] },
    collections: [{ kind: 'closed_set', canonical: 'member constraint identities, sorted', predicate: null }, { kind: 'ordered_sequence', canonical: 'member constraint identities, in the order given', predicate: null }],
    collection_basis: NATIVE_CONTRACT_SCHEMA_V1.$defs.collection.description, claim_nature_basis: NATIVE_CONTRACT_SCHEMA_V1.$defs.declarative_claim.description,
    evaluation: EVALUATION, gaps: GAPS, coverage_classes: COVERAGE_CLASSES, coverage: COVERAGE,

    declared_laws: CONTROLLED_VOCABULARY.operators.flatMap(operator => { const rule = ruleOf(operator.term);
      const where = declaration => rule.rule === 'relation' ? (declaration === 'irreflexive' ? 'input contract, per extension read' : 'input contract, between the extensions read')
        : rule.rule === 'membership' ? (declaration === 'irreflexive' ? 'input contract, per population read' : operator.term === CONTAINS ? 'input contract, between the member observations read, however the membership is stated' : 'none declared')
          : rule.rule === 'negation' ? (declaration === 'irreflexive' && ruleOf(rule.of).rule !== 'denotation' ? 'the relation\'s own predicate: the operand is another entity than the subject' : 'inherent in the predicate')
            : rule.rule === 'order' ? 'none declared' : 'inherent in the predicate';
      return [...['irreflexive', 'symmetric', 'transitive'].filter(trait => declared(operator, trait)).map(trait => ({ relation: operator.term, declaration: trait, support: operator.mechanical_support.algebraic_traits[trait], encoded: where(trait) })),
        ...(operator.inverse.kind === 'operator' ? [{ relation: operator.term, declaration: `inverse of ${operator.inverse.term}`, support: operator.mechanical_support.inverse,
          encoded: operator.mechanical_support.inverse === 'enforced' ? 'one stored name for the pair (author.mjs), so one observation' : where('inverse') }] : [])]; }),

    defined_not_encoded: [] };
}
