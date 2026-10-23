

import { canonicalCollection, identityOf, membershipConstraint, renderConstraint, statementConstraint } from
  "@agent-chassis/controlled-contract/canonical-specification";
import { derive, normalizeClauses } from "@agent-chassis/controlled-contract/closed-membership";
import { createValueScopeNormalizer } from '@agent-chassis/controlled-contract/controlled-value-definitions-v1';
import { ControlledValueError, valueReferences, valueFailure, mapValueReferences } from '@agent-chassis/controlled-contract/controlled-values-v1';

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

const BINDING_CORRECTIONS = {
  resolve_declarations_and_references: {
    executable: false,
    choices: [
      { intent: 'correct_authored_reference', instruction: 'If a use names the wrong entity, correct that exact reference to the intended declared or established id.' },
      { intent: 'correct_or_complete_declaration', instruction: 'If the declaration or binding is missing or mistaken, supply its intended id, type or typed identity and keep its intended uses consistent.' },
      { intent: 'remove_genuinely_unused_declaration', instruction: 'Remove a declaration only if it is genuinely unwanted; this does not resolve any independently unfinished reference.' }
    ],
    preserve: 'Keep all intended meaning and unrelated edits. Unused declarations and unresolved references establish no correspondence; do not infer a match or normalize supplied spelling or quotation marks.'
  },
  choose_established_or_distinct_entity: {
    executable: false,
    choices: [
      { intent: 'reuse_established_object', instruction: 'Only if the saved object is intended, omit the submitted declaration and reuse its established id and binding.' },
      { intent: 'specify_distinct_object', instruction: 'If a different object is intended, declare its full intended binding under a fresh id and update its affected uses. Saved bindings remain immutable. Select each saved declaration by its semantic target and restate its complete intended meaning. When its assertion population changes, use replacement_key and explicit local claim selections for dependent associations; verification.key binds a submitted check separately. Preserve intended verification, case and obligation associations through their existing amendments. Dependencies outside the selected unit retain their existing revision and authority boundaries.' }
    ],
    preserve: 'Keep requested behavior, operands, applicability, source passages and occurrences, and intended evidence associations. The binding conflict establishes no intended object; the author chooses.'
  },
  distinguish_alias_from_mistaken_identity: {
    executable: false,
    choices: [
      { intent: 'consolidate_true_aliases', instruction: 'Only if these ids intentionally denote the same object, use one established binding at the affected uses and remove the redundant declaration, preserving applicable source and evidence mappings.' },
      { intent: 'correct_mistaken_identity', instruction: 'If distinct objects are intended, correct the mistaken declaration to the intended distinct identity and retain their distinct uses. An established id needs a fresh id for a different binding; use existing row correction and case/obligation amendments for saved uses.' }
    ],
    preserve: 'Keep requested behavior, operands, applicability, source passages and occurrences, and intended verification/case/obligation associations. Identical declared identities establish no equality of intended objects; the author chooses.'
  }
};

export function behaviorUses(subject, subjectPath, behavior, path, uses) {
  const facts = relations.get(behavior.relation);
  uses.push({ id: subject, path: subjectPath, types: facts.subject_types, role: `the subject of ${facts.term}` });
  (behavior.objects ?? []).forEach((object, index) => { if (Object.hasOwn(object, "referent")) uses.push({ id: object.referent,
    path: [...path, "objects", index, "referent"], types: facts.operand_types, role: `an object of ${facts.term}` }); });
  (behavior.applies?.context ?? []).forEach((id, index) => uses.push({ id, path: [...path, "applies", "context", index],
    types: facts.context_types, role: `the ${behavior.applies.mode} context of ${facts.term}` }));
  for (const [index, operand] of (behavior.objects ?? []).entries()) if (operand.value || operand.observation || operand.binding) {
    for (const id of valueReferences(operand)) uses.push({ id, path: [...path, 'objects', index], types: null, role: `a typed dependency of ${facts.term}` });
  }
}

export function membershipUses(clauses, clausesPath, applies, path, uses) {
  clauses.forEach((clause, index) => {
    for (const id of clause.domain ? valueReferences(clause.domain) : [clause.member]) uses.push({ id, path: [...clausesPath, index], types: null,
      role: 'a member or typed domain named by a closed membership' });
  });
  (applies?.context ?? []).forEach((id, index) => uses.push({ id, path: [...path, "applies", "context", index], types: null,
    role: `the ${applies.mode} context of a closed membership` }));
}

export function requirementUses(requirements, uses) {
  requirements.forEach((row, index) => {
    for (const declaration of row.for_each ?? []) for (const id of valueReferences(declaration.domain)) uses.push({ id,
      path: ['requirements', index, 'for_each'], types: null, role: 'a lexical domain dependency' });
    if (!isMembership(row)) { behaviorUses(row.subject, ["requirements", index, "subject"], row.behavior, ["requirements", index, "behavior"], uses); return; }
    uses.push({ id: row.subject, path: ["requirements", index, "subject"], types: row.membership.some(clause => clause.domain) ? null : MEMBERSHIP_SUBJECT_TYPES, role: "the subject of a closed membership" });
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
  const bindingOf = id => typeof declared[id] === 'string' ? termBinding(id, declared[id]) : clone(declared[id]);
  const usesOf = id => uses.filter(use => use.id === id).map(use => clone(use));
  for (const id of Object.keys(declared)) {

    if (known.has(id)) {
      const submitted = bindingOf(id), established = clone(known.get(id));
      const same = canonicalJson(submitted) === canonicalJson(established);
      refusals.push(finding(['entities', id], same ? 'entity_already_established' : 'entity_declaration_conflicts_with_established',
        same ? `${id} repeats its complete established binding` : `${id} submits a different binding from its immutable established binding`,
        null, { submitted: { id, ...submitted }, established: { id, ...established }, uses: usesOf(id),
          recovery: { kind: 'resubmit_corrected_batch', correct: 'choose_established_or_distinct_entity' } }));
    }
    else if (open?.has(id)) refusals.push(finding(["entities", id], "entity_type_open_in_referenced_specification",
      `${id} is an entity of the referenced specification, which leaves its type open. A check request cannot settle it; remove this declaration.`,
      null, { recovery: { kind: "remove_member", path: ["entities", id] } }));
    else if (!uses.some(row => row.id === id)) refusals.push(finding(["entities", id], "entity_not_referenced",
      `${id} is declared and no statement or check refers to it; choose whether its declaration, a reference, or genuinely unused material needs correction`,
      null, { id, submitted: clone(declared[id]), recovery: { kind: 'resubmit_corrected_batch', correct: 'resolve_declarations_and_references' } }));
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

      else holes.push({ id, uses: usesOf(id), path: ["entities", id], accepts: restricted.length ? { oneOf: [{ enum: candidates }, { $ref: "#/$defs/entity_declaration" }] }
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
      `${id} [${bound.type_term}] and ${first} [${other.type_term}] declare the same identity`, null,
      { bindings: [{ id: first, ...clone(other) }, { id, ...clone(bound) }], uses: [...usesOf(first), ...usesOf(id)],
        recovery: { kind: 'resubmit_corrected_batch', correct: 'distinguish_alias_from_mistaken_identity' } }));
  }
  const corrected = new Set();
  for (const row of refusals) if (BINDING_CORRECTIONS[row.recovery?.correct] && !corrected.has(row.recovery.correct)) {
    corrected.add(row.recovery.correct);
    row.recovery.correction = clone(BINDING_CORRECTIONS[row.recovery.correct]);
  }
  return { bindings, inferred, refusals, holes };
}

export function createRequirementNormalizer({ schema, unit }) {
  let values = null, scopeFailure = null;
  const configureScopes = (rows, bindings) => {
    values = null; scopeFailure = null;
    try { values = createValueScopeNormalizer(rows, bindings); } catch (error) {
      if (!(error instanceof ControlledValueError)) throw error;
      scopeFailure = error;
    }
  };
  const valueRefusal = (error, path) => finding(path, error.code, error.message, null, {
    subject: error.details.subject, reason: error.details.cause, effects: error.details.effects,
    actor: error.details.actor, recovery: error.details.recovery });
  const guarded = (prepare, pathIndex) => (...args) => {
    try {
      if (scopeFailure) throw scopeFailure;
      return prepare(...args);
    } catch (error) {
      if (!(error instanceof ControlledValueError)) throw error;
      return { holes: [], refusals: [valueRefusal(error, args[pathIndex])], notes: [], inputs: null, written: null };
    }
  };

  function prepareMembershipValue({ subject, clauses, applies, for_each, within }, clausesPath, bindings) {
    const out = { holes: [], refusals: [], inputs: null, membership: null };

    const firstAt = new Map();
    clauses.forEach((clause, index) => {
      const memberKey = clause.domain ? canonicalJson(clause.domain) : clause.member;
      if (!firstAt.has(memberKey)) { firstAt.set(memberKey, index); return; }
      const conflicting = [[...clausesPath, firstAt.get(memberKey)], [...clausesPath, index]];
      out.refusals.push(finding([...clausesPath, index, "member"], "closed_membership_member_stated_twice",
        `${clause.member ?? "typed domain"} has two clauses in the closed membership of ${subject} (positions ${firstAt.get(memberKey)} and ${index}); a member has one. Resubmit the batch with one clause for ${clause.member}.`, null,
        { owner: MEMBERSHIP_OWNER, conflicting, recovery: { kind: "resubmit_corrected_batch", correct: "keep_one_clause_for_the_member", member: clause.member, clauses: conflicting } }));
    });
    if (out.refusals.length) return out;
    clauses.forEach((clause, index) => { if (clause.modality === undefined) out.holes.push({ path: [...clausesPath, index, "modality"],
      accepts: strip((schema.$defs.membership_clause.oneOf?.find(branch => branch.properties.domain) ?? schema.$defs.membership_clause).properties.modality),
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
    if ([subject, ...clauses.flatMap(clause => clause.domain ? valueReferences(clause.domain) : [clause.member]), ...(applies?.context ?? [])].some(id => !bindings.has(id))) return out;
    if (clauses.some(clause => clause.domain)) {
      const map = id => structuredClone(bindings.get(id));
      const metadata = values?.normalize({ subject, for_each, within }) ?? {};
      const scope = scopeOf(applies, bindings);
      const constraint = membershipConstraint({ subject: bindings.get(subject), applies: { mode: scope.mode, context: scope.context.map(unnamed) },
        clauses: specification.clauses.map(clause => ({ ...clause, domain: values.normalize({ subject, for_each, within,
          behavior: { relation: 'value:equals', objects: [{ value: clause.domain }] } }, map).objects[0].value })),
        ...(metadata.for_each === undefined ? {} : { for_each: metadata.for_each }), ...(metadata.within === undefined ? {} : { within: metadata.within }) });
      out.membership = deepFreeze({ identity: identityOf(unit, constraint), constraint, declaration: {
        form: MEMBERSHIP_FORM, owner: MEMBERSHIP_OWNER, subject: { id: subject, ...clone(bindings.get(subject)) },
        applies: scope, specification, members: [], derived: derive(specification) } });
      return out;
    }
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

  function prepareVerificationBehavior(statement, subject, behavior, path, bindings, out) {
    if (relations.get(behavior.relation).operand_kind !== 'value') return prepareBehavior(behavior, path, bindings, out);
    if (!bindings.has(subject) || valueReferences(behavior.objects ?? []).some(id => !bindings.has(id))) return null;
    let metadata;
    try {
      if (!values) configureScopes([statement], bindings);
      if (scopeFailure) throw scopeFailure;
      metadata = values.normalize({ ...statement, subject, behavior });
    } catch (error) {
      if (!(error instanceof ControlledValueError)) throw error;
      out.refusals.push(finding(path, error.code, error.message, null, { subject: error.details.subject,
        reason: error.details.cause, effects: error.details.effects, actor: error.details.actor, recovery: error.details.recovery }));
      return null;
    }
    return prepareBehavior({ ...behavior, ...(metadata.objects ? { objects: metadata.objects } : {}) }, path, bindings, out);
  }

  function prepareRequirementValue(statement, path, bindings) {
    const out = { holes: [], refusals: [], notes: [], inputs: null, written: null };
    const facts = relations.get(statement.behavior.relation);
    const declaration = NATIVE_AUTHORING.vocabulary.operator_signatures.get(statement.behavior.relation);
    if (statement.definition && (statement.modality !== undefined || statement.nature !== undefined || statement.behavior.applies !== undefined || statement.verification !== undefined || statement.for_each !== undefined)) {
      valueFailure('value_definition_normative_fields', statement.subject, 'definitions have no modality, nature, applicability, verification or for_each');
    }
    if (declaration.authoring_roles && !declaration.authoring_roles.includes(statement.definition ? 'definition' : 'normative')) {
      valueFailure('value_relation_role_invalid', statement.subject, `${statement.behavior.relation} does not admit this row role`);
    }
    if (!statement.definition && statement.modality === undefined) out.holes.push({ path: [...path, "modality"], accepts: strip(schema.$defs.requirement.properties.modality),
      question: `modality: the strength with which ${statement.subject} stands in ${statement.behavior.relation}` });
    const typed = facts.operand_kind === 'value' || statement.for_each !== undefined || statement.within !== undefined;
    let metadata = {};
    if (typed) {
      if (!bindings.has(statement.subject) || valueReferences([...(statement.behavior.objects ?? []), ...(statement.for_each ?? []).map(row => row.domain)]).some(id => !bindings.has(id))) {

        prepareBehavior(statement.behavior, [...path, 'behavior'], bindings, out);
        return out;
      }
      if (!values) configureScopes([statement], bindings);
      if (scopeFailure) throw scopeFailure;
      metadata = values.normalize(statement);
    }
    const behavior = prepareBehavior({ ...statement.behavior, ...(metadata.objects ? { objects: metadata.objects } : {}) }, [...path, "behavior"], bindings, out);
    if (!behavior || (!statement.definition && statement.modality === undefined) || !bindings.has(statement.subject)) return out;
    const subject = bindings.get(statement.subject);

    const rowMetadata = { ...(statement.definition ? { definition: true } : { modality: statement.modality }),
      ...(metadata.for_each === undefined ? {} : { for_each: metadata.for_each }), ...(metadata.within === undefined ? {} : { within: metadata.within }) };
    out.written = { ...(statement.nature === undefined ? {} : { nature: statement.nature }), ...rowMetadata, subject: referent(subject), behavior };
    const claimOf = (from, stated) => ({ ...(statement.nature === undefined ? {} : { nature: statement.nature }), ...rowMetadata, subject: referent(from), behavior: stated });

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

  const prepareRequirement = guarded(prepareRequirementValue, 1);
  const prepareMembership = guarded(prepareMembershipValue, 1);

  const prepareRows = (requirements, bindings) => { if (!values) configureScopes(requirements, bindings); return requirements.map((row, index) => isMembership(row)
    ? prepareMembership({ subject: row.subject, clauses: row.membership, applies: row.applies, for_each: row.for_each, within: row.within }, ["requirements", index, "membership"], bindings)
    : prepareRequirement(row, ["requirements", index], bindings)); };

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
        `${ids[index]} has ${repeated.length === mine.length ? "identical" : "overlapping"} authored formal predicates with ${[...new Set(repeated.map(identity => ids[first.get(identity)]))].join(", ")}`,
        null, { restated: repeated,
          overlap: repeated.length === mine.length ? 'identical' : 'partial',
          conflicting: [...new Set(repeated.map(identity => first.get(identity))), index].map(at => ['requirements', at]),
          first_stated_by: [...new Set(repeated.map(identity => ids[first.get(identity)]))],
          recovery: { kind: 'resubmit_corrected_batch', correct: 'state_once_or_define_distinct_behaviors',
            ...(refusals.length === 0 ? { correction: { executable: false,
              choices: [
                { intent: 'consolidate_repeated_meaning', instruction: 'Only if the intended meaning genuinely repeats, author it once while preserving all applicable source passages and intended evidence associations through explicit row source links, definitions and obligation/case associations.' },
                { intent: 'define_distinct_behaviors', instruction: 'If distinct requested behaviors were encoded identically, retain those requested clauses and complete their actual definitions through the existing grammar. Changing names or choosing unrelated symbols is not a repair.' }
              ],
              limitation: 'Identical formal predicates do not establish identical intended meaning. A duplicate-encoding or batch-size refusal does not establish an unsupported concept. The author chooses; no row, source passage or evidence mapping is automatically merged or deleted.' } } : {}) } }));
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

  return Object.freeze({ prepareMembership, prepareBehavior, prepareVerificationBehavior, prepareRequirement, prepareRows, membershipsStatedTwice, constraintsOfRows,
    restatedRequirements, statementsOfRows, resolveCollections, restatedCollections, configureScopes });
}
