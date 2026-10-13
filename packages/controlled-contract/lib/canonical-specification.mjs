

import { createHash } from 'node:crypto';
import { CONTROLLED_VOCABULARY, canonicalValue } from '../vocabulary/controlled-contract-vocabulary.v1.mjs';
import { MEMBERSHIP_FORM, STATEMENT_FORM, UNCONDITIONAL, entityKey, lowerSpecification } from './cel-lowering.mjs';
import { derive } from './closed-membership.mjs';

export const CANONICAL_VERSION = 'semantic-builder-canonical-specification.experimental.v2';
export { MEMBERSHIP_FORM, STATEMENT_FORM };

const canonicalJson = value => JSON.stringify(canonicalValue(value));
const digest = value => createHash('sha256').update(value).digest('hex');
const operators = new Map(CONTROLLED_VOCABULARY.operators.map(row => [row.term, row]));
const modes = new Map(CONTROLLED_VOCABULARY.applicability_modes.map(row => [row.term, row]));
const byJson = (left, right) => { const [a, b] = [canonicalJson(left), canonicalJson(right)]; return a < b ? -1 : a > b ? 1 : 0; };
const entity = bound => ({ type_term: bound.type_term, identity: structuredClone(bound.identity) });
const scope = (applies, context) => ({ ...structuredClone(applies ?? {}), mode: applies?.mode ?? UNCONDITIONAL,
  context: [...new Map(context.map(row => [canonicalJson(row), row])).values()].sort(byJson) });

export function statementConstraint(written, defaultNature) {
  const { relation: _relation, objects: _objects, applies: _applies, ...qualifiers } = written.behavior;
  return { form: STATEMENT_FORM, nature: written.nature ?? defaultNature, modality: written.modality, relation: written.behavior.relation,
    ...(Object.keys(qualifiers).length ? { unmapped_fields: { behavior: structuredClone(qualifiers) } } : {}),
    subject: entity(written.subject.declare),
    operands: written.behavior.objects.map(object => Object.hasOwn(object, 'referent') ? {
      ...structuredClone(Object.fromEntries(Object.entries(object).filter(([key]) => key !== 'referent'))),
      reference: entity(object.referent.declare) } : structuredClone(object)),
    applies: scope(written.behavior.applies, (written.behavior.applies?.context ?? []).map(row => entity(row.declare))) };
}

export function membershipConstraint({ subject, applies, clauses }) {
  return { form: MEMBERSHIP_FORM, subject: entity(subject), applies: scope(applies, applies.context.map(entity)),
    clauses: clauses.map(clause => ({ ...structuredClone(clause), member: entity(clause.member), modality: clause.modality })).sort(byJson) };
}

export const identityOf = (unit, constraint) => `constraint-${digest(canonicalJson([unit, constraint])).slice(0, 40)}`;

const named = row => `${entityKey(row)} [${row.type_term}]`;
const appliesWords = applies => `Applies ${applies.mode}${applies.context.length ? ` ${applies.context.map(named).join(', ')}` : ''}: ${modes.get(applies.mode).definition}`
  + `${applies.context.length > 1 ? ` Context referents combine as ${modes.get(applies.mode).context_reference_semantics.combination}.` : ''}`;
const operandWords = row => Object.hasOwn(row, 'reference') ? named(row.reference)
  : Object.hasOwn(row, 'range') ? `the inclusive range${row.range.minimum === undefined ? ' with no lower bound' : ` from ${row.range.minimum}`}${row.range.maximum === undefined ? ' with no upper bound' : ` up to ${row.range.maximum}`}`
    : String(Object.values(row)[0]);

export function renderConstraint(constraint, note = null) {
  if (constraint.form === MEMBERSHIP_FORM) {
    const clauses = constraint.clauses.map(clause => ({ member: entityKey(clause.member), modality: clause.modality })).sort((left, right) => left.member < right.member ? -1 : 1);
    const { required, permitted } = derive({ clauses });
    return `${named(constraint.subject)} closed membership: ${clauses.map(row => `${row.modality} ${row.member}`).join(', ')}. Required: ${required.join(', ') || 'none'}. `
      + `Permitted and not required: ${permitted.filter(member => !required.includes(member)).join(', ') || 'none'}. Every member not listed is forbidden. ${appliesWords(constraint.applies)}`;
  }
  return `${named(constraint.subject)} ${constraint.modality} ${constraint.relation} ${constraint.operands.map(operandWords).join(', ')} (${constraint.nature} claim). `
    + `${constraint.relation}: ${operators.get(constraint.relation).definition} ${note ? `${note} ` : ''}${appliesWords(constraint.applies)}`;
}

export function canonicalCollection(unit, { kind, purpose, members }, closedSet) {
  const listed = members.flat();
  const body = { collection_kind: kind, ...(purpose === undefined ? {} : { purpose }), members: kind === closedSet ? [...listed].sort() : listed };
  return { identity: `collection-${digest(canonicalJson([unit, body])).slice(0, 40)}`, ...body };
}

export function compileSpecification({ unit, constraints, collections, open, orderedSequence, selectedConstraintIds = null, contextConstraintIds = null }) {
  const rows = [...new Map(constraints.map(row => [row.identity, row])).values()].sort((left, right) => left.identity < right.identity ? -1 : 1);
  const groups = collections.filter(row => selectedConstraintIds === null || row.members.every(id =>
    selectedConstraintIds.has(id) || contextConstraintIds?.has(id))).sort((left, right) => left.identity < right.identity ? -1 : 1);
  const lowered = lowerSpecification(rows, { selectedConstraintIds });
  const notLowered = lowered.constraints.filter(row => row.not_lowered).map(row => ({ identity: row.identity, ...row.not_lowered }));
  const pending = open.statements + open.collections + open.unresolved + lowered.unresolved_definitions.length;
  const state = !lowered.constraints.length ? 'none' : pending === 0 && notLowered.length === 0 ? 'complete' : 'partial';
  const whole = value => state === 'complete' ? value : null;
  const stated = new Map(rows.map(row => [row.identity, row.constraint]));
  const expression = new Map(lowered.constraints.map(row => [row.identity, row.expression]));
  return { state,
    canonical: { version: CANONICAL_VERSION, unit,
      ...(selectedConstraintIds === null ? {} : { selection: { mode: 'assigned_roots', assigned_constraint_ids: [...selectedConstraintIds].sort(),
        definition_constraint_ids: [...(contextConstraintIds ?? [])].filter(id => !selectedConstraintIds.has(id)).sort() } }),
      constraints: rows.filter(row => selectedConstraintIds === null || selectedConstraintIds.has(row.identity) || contextConstraintIds?.has(row.identity))
        .map(row => ({ identity: row.identity, ...structuredClone(row.constraint) })), collections: groups },
    cel: { conformity: whole(lowered.conformity), recommended: whole(lowered.recommended), admissible: whole(lowered.admissible),

      constraints: lowered.constraints.map(row => ({ identity: row.identity, form: stated.get(row.identity).form, ...(stated.get(row.identity).form === STATEMENT_FORM
        ? { modality: stated.get(row.identity).modality, nature: stated.get(row.identity).nature } : {}), ...(({ identity, ...rest }) => { void identity; return rest; })(row) })),
      collections: groups.map(row => ({ identity: row.identity, collection_kind: row.collection_kind, ...(row.purpose === undefined ? {} : { purpose: row.purpose }),
        order: row.collection_kind === orderedSequence ? 'as_given' : 'none', predicate: null, members: row.members.map(identity => ({ identity, expression: expression.get(identity) ?? null })) })) },
    input_contract: lowered.input_contract, bindings: lowered.bindings, environment: lowered.environment, evaluation: lowered.evaluation, not_lowered: notLowered,
    unresolved_definitions: lowered.unresolved_definitions,

    coverage: lowered.coverage,

    not_included: { incomplete_statements: open.statements, incomplete_collections: open.collections,
      unresolved_meanings: open.unresolved + lowered.unresolved_definitions.length } };
}
