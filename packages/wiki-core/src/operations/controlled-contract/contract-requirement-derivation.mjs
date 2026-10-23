
import { compileSpecification } from "@agent-chassis/controlled-contract/canonical-specification";
import { canonicalJson } from "../../lib/controlled-requirement-authoring-schema.mjs";
import { workItemRequirementBatchSchema } from "../../lib/record-authoring-schema.mjs";
import { ORDERED_SEQUENCE, createRequirementNormalizer, isMembership } from "./contract-requirement-normalization.mjs";
import { describeRequirementObjects, nativeSpecificationConstraints } from "./contract-requirement-descriptions.mjs";
import { projectRowValueReferences } from "./contract-requirement-value-projection.mjs";
import { valueRowMetadata } from "./contract-requirement-native-values.mjs";
const clone = value => structuredClone(value);

export function writtenRow(row) {
  if (isMembership(row)) return { ...valueRowMetadata(row), subject: row.subject, membership: row.membership.map(clause => ({ ...clause })), ...(row.applies === undefined ? {} : { applies: clone(row.applies) }) };
  return { ...valueRowMetadata(row), subject: row.subject, ...(row.modality === undefined ? {} : { modality: row.modality }), ...(row.nature === undefined ? {} : { nature: row.nature }),
    behavior: clone(row.behavior) };
}

export function boundInput(written, bindings) {
  const bound = id => bindings.has(id) ? { id, ...clone(bindings.get(id)) } : { id };
  written = projectRowValueReferences(written, bound);
  const applies = value => value === undefined ? {} : { applies: { ...clone(value), mode: value.mode, ...(value.context === undefined ? {} : { context: value.context.map(bound) }) } };
  if (isMembership(written)) return { ...valueRowMetadata(written), subject: bound(written.subject),
    membership: written.membership.map(clause => ({ ...clone(clause), ...(clause.member === undefined ? {} : { member: bound(clause.member) }), ...(clause.modality === undefined ? {} : { modality: clause.modality }) })),
    ...applies(written.applies) };
  return { ...valueRowMetadata(written), subject: bound(written.subject), ...(written.modality === undefined ? {} : { modality: written.modality }),
    ...(written.nature === undefined ? {} : { nature: written.nature }),
    behavior: { ...clone(written.behavior), relation: written.behavior.relation,
      ...(written.behavior.objects === undefined ? {} : { objects: written.behavior.objects.map(object => Object.hasOwn(object, "referent") ? { ...clone(object), referent: bound(object.referent) } : clone(object)) }),
      ...applies(written.behavior.applies) } };
}

export function unboundInput(input) {
  const bindings = new Map();
  const unbound = [];
  const named = entity => { if (entity.type_term === undefined) { if (!unbound.includes(entity.id)) unbound.push(entity.id); }
    else bindings.set(entity.id, { type_term: entity.type_term, identity: clone(entity.identity) }); return entity.id; };
  input = projectRowValueReferences(input, named);
  const applies = value => value === undefined ? {} : { applies: { ...clone(value), mode: value.mode, ...(value.context === undefined ? {} : { context: value.context.map(named) }) } };
  const written = Object.hasOwn(input, "membership")
    ? { ...valueRowMetadata(input), subject: named(input.subject), membership: input.membership.map(clause => ({ ...clone(clause), ...(clause.member === undefined ? {} : { member: named(clause.member) }), ...(clause.modality === undefined ? {} : { modality: clause.modality }) })),
      ...applies(input.applies) }
    : { ...valueRowMetadata(input), subject: named(input.subject), ...(input.modality === undefined ? {} : { modality: input.modality }), ...(input.nature === undefined ? {} : { nature: input.nature }),
      behavior: { ...clone(input.behavior), relation: input.behavior.relation,
        ...(input.behavior.objects === undefined ? {} : { objects: input.behavior.objects.map(object => Object.hasOwn(object, "referent") ? { ...clone(object), referent: named(object.referent) } : clone(object)) }),
        ...applies(input.behavior.applies) } };
  return { written, bindings, unbound };
}

export function boundEntities(input, into, conflicting) {
  const { bindings } = unboundInput(input);
  for (const [id, binding] of bindings) {
    if (conflicting.has(id)) continue;
    if (into.has(id) && canonicalJson(into.get(id)) !== canonicalJson(binding)) { into.delete(id); conflicting.add(id); } else into.set(id, binding);
  }
}

export function deriveRow(normalizer, input, index) {
  const { written, bindings, unbound } = unboundInput(input);
  const prepared = isMembership(written)
    ? normalizer.prepareMembership({ subject: written.subject, clauses: written.membership, applies: written.applies, for_each: written.for_each, within: written.within }, ["requirements", index, "membership"], bindings)
    : normalizer.prepareRequirement(written, ["requirements", index], bindings);
  const pending = [...unbound.map(id => ["entities", id]), ...prepared.holes.map(hole => hole.path.slice(2))];
  return { written, prepared, pending };
}

export function deriveAuthored({ unit, authored, contract = null, sourceDescriptions = new Map(), claimIds = null, visibleNodeIds = null, additionalRoots = [] }) {
  const normalizer = createRequirementNormalizer({ schema: workItemRequirementBatchSchema(), unit });
  const inputs = authored.rows.map(row => unboundInput(row.input));
  normalizer.configureScopes(inputs.map(row => row.written), new Map(inputs.flatMap(row => [...row.bindings])));
  const derived = authored.rows.map((row, index) => deriveRow(normalizer, row.input, index));
  const prepared = derived.map(row => row.prepared);
  const ids = authored.rows.map(row => row.row_id);
  const requirements = derived.map(row => row.written);
  const constraintsOf = normalizer.constraintsOfRows(prepared);
  const statements = normalizer.statementsOfRows({ ids, requirements, prepared, constraintsOf, memberships: prepared.map(row => row.membership ?? null) });
  const refusals = [];
  const holes = [];
  const collections = normalizer.resolveCollections({ rows: authored.collections.map(row => ({ ...(row.kind === undefined ? {} : { kind: row.kind }),
    ...(row.purpose === undefined ? {} : { purpose: row.purpose }), members: row.member_row_ids })),
  collectionIds: authored.collections.map(row => row.collection_row_id), ids, requirements, statements, refusals, holes, scope: "contract" });
  refusals.push(...normalizer.restatedCollections(collections));
  const native = nativeSpecificationConstraints(contract, unit);
  const constraints = [...native.constraints, ...constraintsOf.flatMap(rows => rows ?? [])];
  const selected = claimIds === null ? null : new Set([...native.constraints.filter(row => claimIds.has(row.claim_id)).map(row => row.identity),
    ...authored.rows.filter(row => row.claim_ids.length && row.claim_ids.every(id => claimIds.has(id))).flatMap(row => row.constraint_ids)]);
  const roots = selected === null ? null : constraints.filter(row => selected.has(row.identity)).map(row => ({ owner: unit,
    entity: row.constraint.subject, meaning: 'subject', applies: row.constraint.applies }));
  const descriptions = describeRequirementObjects({ specifications: [{ owner: unit, contract, constraints, visibleNodeIds,
    incompleteSubjects: derived.flatMap((row, index) => row.pending.length && authored.rows[index].input.subject.identity
      ? [authored.rows[index].input.subject] : []) }], roots, additionalRoots, sourceDescriptions });
  const context = new Set(descriptions.roots.flatMap(row => row.defining_constraint_ids));
  const describedKeys = new Set(descriptions.nodes.map(row => canonicalJson(row.entity.identity)));
  const compiled = compileSpecification({ unit, constraints,
    collections: collections.filter(row => row?.canonical).map(row => row.canonical), orderedSequence: ORDERED_SEQUENCE,
    selectedConstraintIds: selected, contextConstraintIds: context,
    open: { statements: statements.filter((row, index) => row.state !== "complete" &&
      (selected === null || describedKeys.has(canonicalJson(authored.rows[index].input.subject.identity)))).length,
      collections: selected === null ? collections.filter(row => row?.state !== "complete").length : 0,
      unresolved: authored.unresolved.length + descriptions.missing.length + native.missing.length } });
  return { derived, statements, constraintsOf, collections, compiled, descriptions, refusals };
}

export const emptyAuthoredRequirements = () => ({ rows: [], collections: [], unresolved: [] });

export function assertRowConstraintIdentities(row, constraintIds, refuse) {
  if (canonicalJson(constraintIds) !== canonicalJson(row.constraint_ids)) refuse('controlled_contract_requirement_row_disagrees',
    'The stored declaration disagrees with the constraints derived from its authored meaning',
    { phase: "projection", subject: row.input.subject.identity,
      correction: 'Stop: stored requirement integrity is inconsistent. No supported save can safely choose between the stored and derived constraints.' });
}

