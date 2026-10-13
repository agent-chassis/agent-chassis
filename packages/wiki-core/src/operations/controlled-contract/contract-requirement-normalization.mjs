

import { canonicalCollection, identityOf, membershipConstraint, renderConstraint, statementConstraint } from
  "@agent-chassis/controlled-contract/canonical-specification";
import { derive, normalizeClauses } from "@agent-chassis/controlled-contract/closed-membership";

import { MEMBERSHIP_SUBJECT_TYPES, NATIVE_AUTHORING, TERM_IDENTITY_KIND, UNCONDITIONAL, COLLECTION_KINDS, behaviorBranch,
  canonicalJson, isPending, valueSchemaAt } from "../../lib/controlled-requirement-authoring-schema.mjs";

export const MEMBERSHIP_OWNER = "closed-membership.mjs";
export const MEMBERSHIP_FORM = "closed_membership";
export const [CLOSED_SET, ORDERED_SEQUENCE] = ["closed_set", "ordered_sequence"];
if (!COLLECTION_KINDS.includes(CLOSED_SET) || !COLLECTION_KINDS.includes(ORDERED_SEQUENCE) || COLLECTION_KINDS.length !== 2) {
  throw new TypeError("the contract schema names collection kinds requirement normalization does not know");
}

const { vocabulary, relations } = NATIVE_AUTHORING;
const clone = value => structuredClone(value);
const strip = ({ description, ...schema }) => { void description; return schema; };
const deepFreeze = value => { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; };
const unnamed = ({ id, ...bound }) => { void id; return bound; };
const referent = binding => ({ declare: clone(binding) });

const refuseClause = (field, message, accepted = null, correction = null) => { throw Object.assign(new Error(message),
  { membership: { field, accepted, correction } }); };

export const fieldPath = field => [...String(field ?? "").matchAll(/([^.[\]]+)|\[(\d+)\]/g)].map(match => match[2] === undefined ? match[1] : Number(match[2]));

export const finding = (path, cause, message, accepts = null, more = {}) => ({ path, cause, message, ...(accepts === null ? {} : { accepts }), ...more });

export const termBinding = (id, type) => ({ type_term: type, identity: { kind: TERM_IDENTITY_KIND, term: id } });
export const isMembership = row => Object.hasOwn(row, "membership");

export function behaviorUses(subject, subjectPath, behavior, path, uses) {
  const facts = relations.get(behavior.relation);
  uses.push({ id: subject, path: subjectPath, types: facts.subject_types, role: `the subject of ${facts.term}` });
  (behavior.objects ?? []).forEach((object, index) => { if (Object.hasOwn(object, "referent")) uses.push({ id: object.referent,
    path: [...path, "objects", index, "referent"], types: facts.operand_types, role: `an object of ${facts.term}` }); });
  (behavior.applies?.context ?? []).forEach((id, index) => uses.push({ id, path: [...path, "applies", "context", index],
    types: facts.context_types, role: `the ${behavior.applies.mode} context of ${facts.term}` }));
}

export function membershipUses(clauses, clausesPath, applies, path, uses) {
  clauses.forEach((clause, index) => uses.push({ id: clause.member, path: [...clausesPath, index, "member"], types: null,
    role: "a member named by a closed membership" }));
  (applies?.context ?? []).forEach((id, index) => uses.push({ id, path: [...path, "applies", "context", index], types: null,
    role: `the ${applies.mode} context of a closed membership` }));
}

export function requirementUses(requirements, uses) {
  requirements.forEach((row, index) => {
    if (!isMembership(row)) { behaviorUses(row.subject, ["requirements", index, "subject"], row.behavior, ["requirements", index, "behavior"], uses); return; }
    uses.push({ id: row.subject, path: ["requirements", index, "subject"], types: MEMBERSHIP_SUBJECT_TYPES, role: "the population of a closed membership" });
    membershipUses(row.membership, ["requirements", index, "membership"], row.applies, ["requirements", index], uses);
  });
}

function scopeOf(applies, bindings) {
  const context = new Map((applies?.context ?? []).map(id => [canonicalJson(bindings.get(id)), { id, ...clone(bindings.get(id)) }]));
  return { mode: applies?.mode ?? UNCONDITIONAL, context: [...context].sort(([left], [right]) => left < right ? -1 : 1).map(([, row]) => row) };
}
export const scopeKey = scope => canonicalJson([scope.mode, scope.context.map(unnamed)]);
export const renderScope = scope => `${scope.mode}${scope.context.length ? ` ${scope.context.map(row => `${row.id} [${row.type_term}]`).join(", ")}` : ""}`;

export function bindEntities({ uses, declared = {}, known, open = null }) {
  const refusals = [];
  const holes = [];
  const bindings = new Map();
  const inferred = {};
  const typeOf = id => typeof declared[id] === "string" ? declared[id] : declared[id].type_term;
  for (const id of Object.keys(declared)) {

    if (known.has(id)) refusals.push(finding(["entities", id], typeOf(id) === known.get(id).type_term ? "entity_already_established"
      : "entity_declaration_conflicts_with_established", `${id} is already established as ${known.get(id).type_term}`
      + `${typeOf(id) === known.get(id).type_term ? "" : ` and is not ${typeOf(id)}`}. Remove this declaration; the established entity is used as it is.`,
    null, { recovery: { kind: "remove_member", path: ["entities", id], established: { id, type: known.get(id).type_term } } }));
    else if (open?.has(id)) refusals.push(finding(["entities", id], "entity_type_open_in_referenced_specification",
      `${id} is an entity of the referenced specification, which leaves its type open. A check request cannot settle it; remove this declaration.`,
      null, { recovery: { kind: "remove_member", path: ["entities", id] } }));
    else if (!uses.some(row => row.id === id)) refusals.push(finding(["entities", id], "entity_not_referenced",
      `${id} is declared and no statement or check refers to it; remove it`));
  }
  for (const id of [...new Set(uses.map(row => row.id))]) {
    const mine = uses.filter(row => row.id === id);
    const restricted = mine.filter(row => row.types !== null);

    if (open?.has(id)) continue;
    const fits = (type, cause, words) => {
      const wrong = restricted.filter(row => !row.types.includes(type));
      for (const row of wrong) refusals.push(finding(row.path, cause, `${id} is ${words} ${type}, which cannot be ${row.role} [${row.types.join(" | ")}]`,
        { enum: [...row.types] }));
      return wrong.length === 0;
    };
    if (known.has(id)) {

      fits(known.get(id).type_term, "established_entity_cannot_fill_role", "established as");
      bindings.set(id, known.get(id));
    } else if (Object.hasOwn(declared, id)) {
      if (fits(typeOf(id), "entity_type_not_accepted_by_role", "declared")) bindings.set(id, typeof declared[id] === "string"
        ? termBinding(id, declared[id]) : clone(declared[id]));
    } else {
      const candidates = NATIVE_AUTHORING.type_terms.filter(type => restricted.every(row => row.types.includes(type)));
      if (!candidates.length) refusals.push(finding(mine[0].path, "entity_roles_disagree_on_type",
        `no one type lets ${id} be ${restricted.map(row => `${row.role} [${row.types.join(" | ")}]`).join(" and ")}; these are different entities, or one reference is wrong`));
      else if (candidates.length === 1) { bindings.set(id, termBinding(id, candidates[0])); inferred[id] = candidates[0]; }

      else holes.push({ path: ["entities", id], accepts: restricted.length ? { oneOf: [{ enum: candidates }, { $ref: "#/$defs/entity_declaration" }] }
        : { $ref: "#/$defs/entity" },
        question: `type of ${id}, which is ${[...new Set(mine.map(row => row.role))].join("; ")}` });
    }
  }

  const identities = new Map([...known].map(([id, bound]) => [canonicalJson(bound.identity), id]));
  for (const [id, bound] of bindings) {
    const key = canonicalJson(bound.identity);
    const first = identities.get(key);
    if (first === undefined) { identities.set(key, id); continue; }
    if (first === id) continue;
    const other = known.get(first) ?? bindings.get(first);
    refusals.push(finding(Object.hasOwn(declared, id) ? ["entities", id] : uses.find(row => row.id === id).path, "entity_identity_declared_twice",
      `${id} [${bound.type_term}] has the identity of ${first} [${other.type_term}]. One entity has one id: name it ${first} everywhere and remove ${id}.`, null,
      { recovery: { kind: "use_entity", id: first, in_place_of: id, ...(Object.hasOwn(declared, id) ? { remove: ["entities", id] } : {}) } }));
  }
  return { bindings, inferred, refusals, holes };
}

export function createRequirementNormalizer({ schema, unit }) {

  function prepareMembership({ subject, clauses, applies }, clausesPath, bindings) {
    const out = { holes: [], refusals: [], inputs: null, membership: null };

    const firstAt = new Map();
    clauses.forEach((clause, index) => {
      if (!firstAt.has(clause.member)) { firstAt.set(clause.member, index); return; }
      const conflicting = [[...clausesPath, firstAt.get(clause.member)], [...clausesPath, index]];
      out.refusals.push(finding([...clausesPath, index, "member"], "closed_membership_member_stated_twice",
        `${clause.member} has two clauses in the closed membership of ${subject} (positions ${firstAt.get(clause.member)} and ${index}); a member has one. Resubmit the batch with one clause for ${clause.member}.`, null,
        { owner: MEMBERSHIP_OWNER, conflicting, recovery: { kind: "resubmit_corrected_batch", correct: "keep_one_clause_for_the_member", member: clause.member, clauses: conflicting } }));
    });
    if (out.refusals.length) return out;
    clauses.forEach((clause, index) => { if (clause.modality === undefined) out.holes.push({ path: [...clausesPath, index, "modality"],
      accepts: strip(schema.$defs.membership_clause.properties.modality),
      question: `modality of ${clause.member} in the closed membership of ${subject}: MUST is required; MAY is permitted and not required; `
        + "a member left out is forbidden" }); });
    if (out.holes.length) return out;
    let specification;
    try { specification = normalizeClauses(clauses, "clauses", refuseClause); } catch (error) {
      if (!error.membership) throw error;
      out.refusals.push(finding([...clausesPath, ...fieldPath(error.membership.field).slice(1)], "closed_membership_clause_refused",
        `${error.message}${error.membership.correction ? `; ${error.membership.correction}` : ""}`, null, { owner: MEMBERSHIP_OWNER }));
      return out;
    }
    if ([subject, ...clauses.map(clause => clause.member), ...(applies?.context ?? [])].some(id => !bindings.has(id))) return out;
    const members = specification.clauses.map(clause => ({ id: clause.member, ...clone(bindings.get(clause.member)) }));
    const scope = scopeOf(applies, bindings);
    const { required, permitted } = derive(specification);
    const declaration = { form: MEMBERSHIP_FORM, owner: MEMBERSHIP_OWNER, subject: { id: subject, ...clone(bindings.get(subject)) }, applies: scope,
      specification, members,
      derived: { required, optional: permitted.filter(member => !required.includes(member)), permitted, unlisted: "forbidden" } };

    const constraint = membershipConstraint({ subject: unnamed(declaration.subject), applies: { mode: scope.mode, context: scope.context.map(unnamed) },
      clauses: specification.clauses.map((clause, index) => ({ member: unnamed(members[index]), modality: clause.modality })) });
    out.membership = deepFreeze({ identity: identityOf(unit, constraint), constraint, declaration });
    return out;
  }

  function prepareBehavior(behavior, path, bindings, out) {
    const facts = relations.get(behavior.relation);
    const branch = behaviorBranch(schema, behavior.relation);
    let complete = true;
    if (behavior.objects === undefined) {
      out.holes.push({ path: [...path, "objects"], accepts: strip(branch.properties.objects), question: `objects of ${facts.term}: ${facts.definition}` });
      complete = false;
    }
    if (behavior.applies === undefined && !facts.complete_without_applies) {
      out.holes.push({ path: [...path, "applies"], accepts: strip(branch.properties.applies),
        question: `applicability of ${facts.term}, which admits only ${facts.applicability_modes.join(", ")}` });
      complete = false;
    }

    const pendingAt = [];
    const seek = (value, at) => { if (isPending(value)) pendingAt.push(at);
      else if (value !== null && typeof value === "object") for (const [key, child] of Object.entries(value)) seek(child, [...at, Array.isArray(value) ? Number(key) : key]); };
    (behavior.objects ?? []).forEach((object, index) => seek(object, [index]));
    for (const at of pendingAt) {
      const domain = at.at(-1) === "number" && facts.numeric_domain ? { type: "integer", minimum: facts.numeric_domain.minimum } : null;
      out.holes.push({ path: [...path, "objects", ...at], pending: true, accepts: domain ?? strip(valueSchemaAt(schema, behavior.relation, at.slice(1))),
        question: `${at.slice(1).join(" ")} of ${facts.term}, stated as pending: ${facts.definition}` });
      complete = false;
    }
    (behavior.objects ?? []).forEach((object, index) => {
      if (facts.numeric_domain && Object.hasOwn(object, "number") && !isPending(object.number) && (!Number.isInteger(object.number) || object.number < facts.numeric_domain.minimum)) {
        out.refusals.push(finding([...path, "objects", index, "number"], "not_in_numeric_domain",
          `${facts.term} takes an integer of at least ${facts.numeric_domain.minimum}`, { type: "integer", minimum: facts.numeric_domain.minimum }));
      }
    });

    const stated = new Set(behavior.applies?.context ?? []).size;
    if (behavior.applies && facts.context_cardinality && (stated < facts.context_cardinality.minimum
      || (facts.context_cardinality.maximum !== null && stated > facts.context_cardinality.maximum))) out.refusals.push(finding([...path, "applies", "context"],
      stated < facts.context_cardinality.minimum ? "too_few_items" : "too_many_items", `${facts.term} takes ${facts.context_cardinality.minimum === facts.context_cardinality.maximum
        ? `exactly ${facts.context_cardinality.minimum}` : `from ${facts.context_cardinality.minimum} to ${facts.context_cardinality.maximum ?? "any number of"}`} context referent(s)`,
      { minItems: facts.context_cardinality.minimum, ...(facts.context_cardinality.maximum === null ? {} : { maxItems: facts.context_cardinality.maximum }) }));
    const named = [...(behavior.objects ?? []).filter(object => Object.hasOwn(object, "referent")).map(object => object.referent),
      ...(behavior.applies?.context ?? [])];
    if (!complete || named.some(id => !bindings.has(id))) return null;

    const keyOf = object => canonicalJson(Object.hasOwn(object, "referent") ? { ...object, referent: bindings.get(object.referent) } : object);
    const once = (rows, key) => [...new Map(rows.map(row => [key(row), row]).reverse()).values()].reverse();
    const ordered = (rows, key) => [...rows].sort((left, right) => key(left) < key(right) ? -1 : key(left) > key(right) ? 1 : 0);
    let { objects } = behavior;
    if (facts.operand_duplicates !== "significant") objects = once(objects, keyOf);

    if (objects.length < behavior.objects.length) out.notes?.push({ change: "repeated_object_stated_once", path: [...path, "objects"],
      stated: behavior.objects.length, stored: objects.length });
    if (new Set((behavior.applies?.context ?? []).map(id => canonicalJson(bindings.get(id)))).size < (behavior.applies?.context ?? []).length) out.notes?.push({
      change: "repeated_context_stated_once", path: [...path, "applies", "context"], stated: behavior.applies.context.length,
      stored: new Set(behavior.applies.context.map(id => canonicalJson(bindings.get(id)))).size });
    if (facts.operand_ordering !== "significant") objects = ordered(objects, keyOf);
    const contextKey = id => canonicalJson(bindings.get(id));
    return { ...clone(behavior), relation: behavior.relation,
      ...(behavior.applies === undefined ? {} : { applies: { ...clone(behavior.applies), mode: behavior.applies.mode,
        context: ordered(once(behavior.applies.context ?? [], contextKey), contextKey).map(id => referent(bindings.get(id))) } }),
      objects: objects.map(object => Object.hasOwn(object, "referent") ? { ...clone(object), referent: referent(bindings.get(object.referent)) } : clone(object)) };
  }

  function prepareRequirement(statement, path, bindings) {
    const out = { holes: [], refusals: [], notes: [], inputs: null, written: null };
    if (statement.modality === undefined) out.holes.push({ path: [...path, "modality"], accepts: strip(schema.$defs.requirement.properties.modality),
      question: `modality: the strength with which ${statement.subject} stands in ${statement.behavior.relation}` });
    const behavior = prepareBehavior(statement.behavior, [...path, "behavior"], bindings, out);
    if (!behavior || statement.modality === undefined || !bindings.has(statement.subject)) return out;
    const subject = bindings.get(statement.subject);

    out.written = { ...(statement.nature === undefined ? {} : { nature: statement.nature }), modality: statement.modality, subject: referent(subject), behavior };
    const facts = relations.get(behavior.relation);
    const claimOf = (from, stated) => ({ ...(statement.nature === undefined ? {} : { nature: statement.nature }), modality: statement.modality, subject: referent(from), behavior: stated });

    const pairs = facts.pointwise && behavior.objects.length > 1 ? behavior.objects.map(object => [object]) : [behavior.objects];
    if (pairs.length > 1) out.notes.push({ change: "grouped_statement_stated_per_object", path, stated: 1, stored: pairs.length });

    out.inputs = pairs.map(objects => {
      const [object] = objects;
      if (objects.length !== 1 || !Object.hasOwn(object, "referent") || !facts.same_roles || !(facts.symmetric || facts.inverse)) return claimOf(subject, { ...behavior, objects });
      const other = object.referent.declare;
      const relation = facts.inverse && facts.inverse < facts.term ? facts.inverse : facts.term;
      if (relation === facts.term && !(facts.symmetric && canonicalJson(other) < canonicalJson(subject))) return claimOf(subject, { ...behavior, objects });
      const writtenObject = statement.behavior.objects.find(row => canonicalJson(bindings.get(row.referent)) === canonicalJson(other)).referent;
      out.notes.push({ change: facts.symmetric ? "symmetric_statement_oriented" : "inverse_statement_oriented", path,
        stated: { subject: statement.subject, relation: facts.term, object: writtenObject }, stored: { subject: writtenObject, relation, object: statement.subject } });
      return claimOf(other, { ...behavior, relation, objects: [{ referent: referent(subject) }] });
    });
    return out;
  }

  const prepareRows = (requirements, bindings) => requirements.map((row, index) => isMembership(row)
    ? prepareMembership({ subject: row.subject, clauses: row.membership, applies: row.applies }, ["requirements", index, "membership"], bindings)
    : prepareRequirement(row, ["requirements", index], bindings));

  function membershipsStatedTwice(requirements, ids) {
    const refusals = [];
    const stated = new Map();
    requirements.forEach((row, index) => {
      if (!isMembership(row)) return;
      const key = canonicalJson([row.subject, row.applies?.mode ?? UNCONDITIONAL, [...new Set(row.applies?.context ?? [])].sort()]);
      if (stated.has(key)) refusals.push(finding(["requirements", index], "closed_membership_stated_twice",
        `${ids[index]} and ${ids[stated.get(key)]} are both the closed membership of ${row.subject} under the same applicability. `
          + "One closed specification holds every clause of its population: resubmit the batch with one of them holding every clause.", null,
        { conflicting: [["requirements", stated.get(key)], ["requirements", index]],
          recovery: { kind: "resubmit_corrected_batch", correct: "state_one_closed_membership_for_the_population", requirements: [ids[stated.get(key)], ids[index]] } }));
      else stated.set(key, index);
    });
    return refusals;
  }

  function constraintsOfRows(prepared) {
    const [defaultNature] = vocabulary.claim_natures;
    return prepared.map(row => row.membership ? [{ identity: row.membership.identity, constraint: row.membership.constraint }]
      : row.inputs ? row.inputs.map(input => { const constraint = statementConstraint(input, defaultNature); return { identity: identityOf(unit, constraint), constraint }; }) : null);
  }

  function restatedRequirements(constraintsOf, ids) {
    const refusals = [];
    const first = new Map();
    constraintsOf.forEach((rows, index) => {
      const mine = (rows ?? []).map(row => row.identity);
      const repeated = mine.filter(identity => first.has(identity) && first.get(identity) !== index);
      if (repeated.length) refusals.push(finding(["requirements", index], "restates_requirement",
        `${ids[index]} states ${repeated.length === mine.length ? "exactly" : "in part"} what ${[...new Set(repeated.map(identity => ids[first.get(identity)]))].join(", ")} `
          + `${repeated.length === mine.length ? "states" : "already says"} (${repeated.join(", ")}); state it once`, null, { restated: repeated,
          first_stated_by: [...new Set(repeated.map(identity => ids[first.get(identity)]))] }));
      for (const identity of mine) if (!first.has(identity)) first.set(identity, index);
    });
    return refusals;
  }

  function statementsOfRows({ ids, requirements, prepared, constraintsOf, memberships }) {
    return ids.map((id, position) => {
      const mine = constraintsOf[position];

      const pending = (prepared[position]?.holes ?? []).filter(hole => hole.pending).map(hole => hole.path.slice(2));
      if (!mine) return { id, state: "incomplete", meaning: null, ...(pending.length ? { pending } : {}), supplied: clone(requirements[position]) };
      const meaning = mine.map(row => renderConstraint(row.constraint, row.constraint.relation ? relations.get(row.constraint.relation).note : null)).join("\n");
      return { id, state: "complete", meaning, ...(mine.length === 1 ? { identity: mine[0].identity, constraint: mine[0].constraint } : { identities: mine.map(row => row.identity), constraints: mine.map(row => row.constraint) }),
        ...(memberships[position] ? { declaration: memberships[position].declaration } : {}) };
    });
  }

  function resolveCollections({ rows, collectionIds, ids, requirements, statements, refusals, holes, scope = "request" }) {
    return rows.map((row, at) => {
      const path = ["collections", at];
      const id = collectionIds[at];
      const before = refusals.length;
      row.members.forEach((member, position) => {
        if (!ids.includes(member)) refusals.push(finding([...path, "members", position], "requirement_unknown", `${member} is not a requirement of this ${scope}`, { enum: ids }));
        else if (row.members.indexOf(member) !== position) refusals.push(finding([...path, "members", position], "collection_member_stated_twice",
          `${member} is already a member of ${id} at position ${row.members.indexOf(member)}; a collection lists each requirement once`, null,
          { recovery: { kind: "remove_member", path: [...path, "members", position] } }));
      });
      if (row.kind === undefined) holes.push({ path: [...path, "kind"], accepts: strip(schema.$defs.collection.properties.kind),
        question: `kind of ${id}: whether ${row.members.join(", ")} are a complete population or an order` });
      if (refusals.length > before) return null;
      const parts = row.members.map(member => statements[ids.indexOf(member)]);

      if (row.kind === ORDERED_SEQUENCE) parts.forEach((part, position) => {
        const written = requirements[ids.indexOf(part.id)];
        const facts = isMembership(written) ? null : relations.get(written.behavior.relation);
        if (!facts?.pointwise || !written.behavior.objects) return;
        const several = new Set(written.behavior.objects.map(object => Object.hasOwn(object, "referent") ? object.referent : canonicalJson(object))).size;
        if (several > 1) refusals.push(finding([...path, "members", position], "ordered_member_is_several_statements",
          `${part.id} is ${several} statements, one per object, with no order among them. State each object as its own requirement to place it in an order.`, null,
          { recovery: { kind: "state_each_object_as_its_own_requirement", requirement: part.id } })); });
      if (refusals.length > before) return null;
      const waiting = parts.filter(part => part.state !== "complete").map(part => part.id);

      const membersOf = () => parts.map(part => part.state === "complete" ? { requirement: part.id, identities: part.identities ?? [part.identity] } : { requirement: part.id, state: "incomplete" });
      const base = { id, kind: row.kind ?? null, ...(row.purpose === undefined ? {} : { purpose: row.purpose }), members: membersOf(), listed: [...row.members] };
      if (row.kind === undefined || waiting.length) return { ...base, state: "incomplete" };
      const canonical = canonicalCollection(unit, { kind: row.kind, purpose: row.purpose, members: parts.map(part => part.identities ?? [part.identity]) }, CLOSED_SET);
      return { ...base, state: "complete", identity: canonical.identity, canonical,
        meaning: row.kind === CLOSED_SET ? `${id} closed set${row.purpose === undefined ? "" : ` (${row.purpose})`} of ${row.members.join(", ")}: these are all the members of this collection, and their order means nothing. ${row.members.length < ids.length
          ? `It holds ${row.members.length} of the ${ids.length} requirements of this ${scope}; ${ids.filter(member => !row.members.includes(member)).join(", ")} ${ids.length - row.members.length === 1 ? "is" : "are"} not in it.`
          : `It holds every requirement of this ${scope}.`}`
          : `${id} ordered sequence${row.purpose === undefined ? "" : ` (${row.purpose})`}: ${row.members.join(", then ")}. The order is meaning.` };
    });
  }

  function restatedCollections(collections) {
    const refusals = [];
    collections.forEach((row, at) => { const first = collections.findIndex(other => other?.identity && other.identity === row?.identity);
      if (row?.identity && first !== at) refusals.push(finding(["collections", at], "restates_collection", `${row.id} is exactly ${collections[first].id} (${row.identity}); state it once`)); });
    return refusals;
  }

  return Object.freeze({ prepareMembership, prepareBehavior, prepareRequirement, prepareRows, membershipsStatedTwice, constraintsOfRows,
    restatedRequirements, statementsOfRows, resolveCollections, restatedCollections });
}
