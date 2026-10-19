

import assert from "node:assert/strict";
import { CONTROLLED_VOCABULARY } from "@agent-chassis/controlled-contract/vocabulary";
import { CONTROLLED_CONTRACT_REQUIREMENT_LIMITS } from
  "../../packages/wiki-core/src/operations/controlled-contract/contract-requirement-vocabulary.mjs";

export const OPERATORS = CONTROLLED_VOCABULARY.operators;
export const MODES = new Map(CONTROLLED_VOCABULARY.applicability_modes.map((row) => [row.term, row]));
export const TYPES = CONTROLLED_VOCABULARY.type_terms.map((row) => row.term);
export const MODALITIES = ["MUST", "MUST_NOT", "MAY"];
export const NATURES = ["behavior", "evidence"];
export const CONTEXT_LIMIT = CONTROLLED_CONTRACT_REQUIREMENT_LIMITS.context_referents;
export const json = (value) => JSON.stringify(value, (_key, node) => node && typeof node === "object" && !Array.isArray(node)
  ? Object.fromEntries(Object.entries(node).sort(([left], [right]) => left < right ? -1 : 1)) : node);
export const copy = (value) => JSON.parse(JSON.stringify(value));
export const sorted = (rows) => [...rows].sort((left, right) => json(left) < json(right) ? -1 : json(left) > json(right) ? 1 : 0);
export const unique = (rows) => [...new Map(rows.map((row) => [json(row), row])).values()];
export const restricted = (types) => types?.kind === "restricted" ? types.terms : null;
export const modesOf = (operator) => operator.applicability.kind === "all_declared_modes" ? [...MODES.keys()] : operator.applicability.modes;
export const contextBounds = (operator, mode) => {
  const bounds = operator.applicability.context_reference_cardinality ?? MODES.get(mode).context_reference_cardinality;
  return { minimum: bounds.minimum, maximum: Math.min(bounds.maximum ?? Infinity, CONTEXT_LIMIT) };
};
export const refusal = (result) => { assert.equal(result.status, "refused", json(result).slice(0, 400)); assert.equal(Object.hasOwn(result, "specification"), false); return result.findings; };
export const causes = (result) => refusal(result).map((row) => [row.path.join("."), row.cause]);

export const isSymmetric = (operator) => operator.algebraic_traits.symmetric && operator.mechanical_support.algebraic_traits.symmetric === "enforced";
export const enforcedInverse = (operator) => operator.inverse.kind === "operator" && operator.mechanical_support.inverse === "enforced" ? operator.inverse.term : null;

export function oriented(meaning) {
  const operator = OPERATORS.find((row) => row.term === meaning.operator);
  if (meaning.operands.length !== 1 || meaning.operands[0].kind !== "reference") return meaning;
  const exchanged = { ...meaning, subject: meaning.operands[0].entity, operands: [{ kind: "reference", entity: meaning.subject }] };
  if (isSymmetric(operator)) return json(meaning.subject) <= json(exchanged.subject) ? meaning : exchanged;
  const inverse = enforcedInverse(operator);
  return inverse && inverse < operator.term ? { ...exchanged, operator: inverse } : meaning;
}

export const profileTerm = (id, type) => ({ type_term: type, identity: { kind: "profile_term", term: id } });
export const bound = (entities, id) => typeof entities[id] === "string" ? profileTerm(id, entities[id]) : entities[id];

export const isPointwise = (operator) => operator.signature.operand_kind === "reference" && operator.signature.operand_cardinality.maximum !== 1
  && operator.operand_semantics.ordering === "insignificant"
  && ((operator.multiplicity === "relation_set" && operator.mechanical_support.multiplicity === "enforced") || isSymmetric(operator));

export const partsOf = (statement) => statement.constraints ? statement.constraints.map((constraint, index) => ({ identity: statement.identities[index], constraint }))
  : [{ identity: statement.identity, constraint: statement.constraint }];

export const identityOf = (statement) => partsOf(statement).map((part) => part.identity).sort().join("+");

export function expectedMeaning(entities, requirement) {
  const operator = OPERATORS.find((row) => row.term === requirement.behavior.relation);
  let operands = requirement.behavior.objects.map((object) => Object.hasOwn(object, "referent") ? { kind: "reference", entity: bound(entities, object.referent) }
    : Object.hasOwn(object, "range") ? { kind: "range", ...object.range } : { kind: Object.keys(object)[0], value: Object.values(object)[0] });
  if (operator.operand_semantics.duplicates === "ignored") operands = unique(operands);
  if (operator.operand_semantics.ordering === "insignificant") operands = sorted(operands);
  const whole = { kind: requirement.nature ?? "behavior", modality: requirement.modality, operator: operator.term, subject: bound(entities, requirement.subject),
    mode: requirement.behavior.applies?.mode ?? "unconditional",

    context: sorted(unique((requirement.behavior.applies?.context ?? []).map((id) => bound(entities, id)))), operands };

  return sorted((isPointwise(operator) && operands.length > 1 ? operands.map((operand) => ({ ...whole, operands: [operand] })) : [whole]).map(oriented));
}

export function storedMeaning(statement) {
  const parts = partsOf(statement);
  assert.equal(new Set(parts.map((part) => part.identity)).size, parts.length, "one stored statement appears twice");
  return sorted(parts.map(storedPart));
}
function storedPart({ identity, constraint }) {
  const operator = OPERATORS.find((row) => row.term === constraint.relation);
  assert.match(identity, /^constraint-[0-9a-f]{40}$/);
  const stored = constraint.operands.map((operand) => Object.hasOwn(operand, "reference") ? { kind: "reference", entity: operand.reference }
    : Object.hasOwn(operand, "range") ? { kind: "range", ...operand.range } : { kind: Object.keys(operand)[0], value: Object.values(operand)[0] });

  if (operator.operand_semantics.duplicates === "ignored") assert.equal(unique(stored).length, stored.length, "a repeated object was stored");
  const context = constraint.applies.context;
  assert.equal(unique(context).length, context.length, "a repeated context referent was stored");
  return oriented({ kind: constraint.nature, modality: constraint.modality, operator: constraint.relation, subject: constraint.subject,
    mode: constraint.applies.mode, context: sorted(context),
    operands: operator.operand_semantics.ordering === "insignificant" ? sorted(stored) : stored });
}

export const OPERAND_VALUES = { boolean: [{ boolean: true }, { boolean: false }], number: [{ number: 3 }, { number: 0 }],
  range: [{ range: { minimum: 1, maximum: 4 } }, { range: { maximum: 9 } }, { range: { minimum: 2 } }] };

export function sample(operator, { operands = 1, mode = null, contexts = null, pick = 0, value = 0, modality = "MUST", nature = undefined } = {}) {
  const typeOf = (types, fallback, at) => (restricted(types) ?? fallback)[at % (restricted(types) ?? fallback).length];
  const chosen = mode ?? (modesOf(operator).includes("unconditional") ? null : modesOf(operator)[0]);
  const entities = { subject: typeOf(operator.signature.subject_types, TYPES, pick) };
  const objects = operator.signature.operand_kind !== "reference" ? [OPERAND_VALUES[operator.signature.operand_kind][value]]
    : Array.from({ length: Math.min(operands, operator.signature.operand_cardinality.maximum ?? operands) }, (_, index) => {
      entities[`object-${index + 1}`] = typeOf(operator.signature.operand_types, TYPES, pick + index + 5);
      return { referent: `object-${index + 1}` };
    });
  let applies;
  if (chosen !== null) {
    const bounds = contextBounds(operator, chosen);
    const count = Math.max(bounds.minimum, Math.min(contexts ?? bounds.minimum, bounds.maximum));
    const context = Array.from({ length: count }, (_, index) => {
      entities[`context-${index + 1}`] = typeOf(operator.applicability.context_reference_types, TYPES, pick + index + 11);
      return `context-${index + 1}`;
    });
    applies = { mode: chosen, ...(count || chosen !== "unconditional" ? { context } : {}) };
  }
  return { entities, requirement: { subject: "subject", modality, ...(nature ? { nature } : {}),
    behavior: { relation: operator.term, objects, ...(applies ? { applies } : {}) } } };
}
export const population = (operator) => operator.population_semantics.kind !== "not_applicable";

export function authored(owner, { entities, requirement, supportingRequirements = [] }, label) {
  const result = owner.author({ entities, requirements: [requirement, ...supportingRequirements] });
  assert.notEqual(result.status, "refused", `${label}: ${json(result.findings)}`);
  assert.deepEqual([result.statements.map((row) => row.state), result.needed], [["complete", ...supportingRequirements.map(() => "complete")], []], label);
  const read = owner.author({ specification: result.specification });
  assert.deepEqual(storedMeaning(read.statements[0]), expectedMeaning(entities, requirement), label);

  assert.deepEqual(Object.keys(read.entities).sort(), Object.keys(entities).sort(), label);
  for (const [id, row] of Object.entries(read.entities)) {
    const { key, ...binding } = row;
    assert.deepEqual(binding, bound(entities, id), label);
    assert.equal(typeof key === "string" && key.length > 0, true, label);
  }

  return { result, read, statement: read.statements[0], identity: identityOf(read.statements[0]), parts: partsOf(read.statements[0]) };
}
