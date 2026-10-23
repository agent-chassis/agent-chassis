

import { MODALITIES as MEMBERSHIP_MODALITIES } from '@agent-chassis/controlled-contract/closed-membership';
import { NATIVE_CONTRACT_SCHEMA_V1, VOCABULARY_VERSION_V1 } from '@agent-chassis/controlled-contract/native-contract';
import { CONTROLLED_VOCABULARY, canonicalValue, relationAvailableForAuthoring } from '@agent-chassis/controlled-contract/vocabulary';
import { CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_UPSERT_DECLARED_INPUT_SCHEMA as NATIVE_INPUT_SCHEMA } from
  '../operations/controlled-contract/contract-requirement-input-schema.mjs';
import { CONTROLLED_CONTRACT_REQUIREMENT_LIMITS, deriveControlledContractAuthoringVocabulary } from
  '../operations/controlled-contract/contract-requirement-vocabulary.mjs';
import { shareRecordAuthoringDefinitions } from './record-authoring-shared-definitions.mjs';
import { REQUIREMENT_SOURCE_PASSAGES_SCHEMA } from './requirement-source-passage-schema.mjs';
import { requirementCapabilities, relationCapability, scopePrimitiveValueDefinitions } from './requirement-schema-exposure.mjs';
import { publicValueDefinitions } from '../operations/controlled-contract/contract-requirement-native-values.mjs';
import { buildPublicSelectionSchema } from '../operations/controlled-contract/public-selection.mjs';

export const TERM_IDENTITY_KIND = 'profile_term';

export const MEMBERSHIP_SUBJECT_TYPES = Object.freeze(['cc:population']);
export const UNCONDITIONAL = 'unconditional';

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const canonicalJson = value => JSON.stringify(canonicalValue(value));
const ref = name => ({ $ref: `#/$defs/${name}` });
const drift = message => { throw new TypeError(`authoring schema: ${message}`); };

const vocabulary = deriveControlledContractAuthoringVocabulary(NATIVE_CONTRACT_SCHEMA_V1);
const nativeRequirement = NATIVE_INPUT_SCHEMA.properties.contract_requirements.properties.requirements.items.anyOf[0];
const nativeReferent = nativeRequirement.properties.subject;
const nativeObservation = nativeRequirement.properties.verification.anyOf[0].properties.observes;
const nativeBranches = nativeObservation.anyOf;
const nativeDeclare = nativeReferent.oneOf.find(branch => branch.required.includes('declare'))?.properties.declare;
if (!nativeDeclare || !Array.isArray(nativeBranches)) drift('the semantic requirement input schema has no referent declaration or statement branches');
const operators = new Map(CONTROLLED_VOCABULARY.operators.map(row => [row.term, row]));
const typeTerms = CONTROLLED_VOCABULARY.type_terms.filter(row => vocabulary.type_terms.includes(row.term));
if (typeTerms.length !== vocabulary.type_terms.length) drift('a contract type term has no vocabulary definition');
const modes = new Map(CONTROLLED_VOCABULARY.applicability_modes.map(row => [row.term, row]));
if (!modes.has(UNCONDITIONAL) || MEMBERSHIP_SUBJECT_TYPES.some(type => !vocabulary.type_terms.includes(type))) drift(
  'the vocabulary lacks the unconditional mode or the population type a closed membership needs');
const restricted = types => types?.kind === 'restricted' ? Object.freeze([...types.terms]) : null;
for (const row of modes.values()) if (row.context_reference_semantics.ordering !== 'insignificant' || row.context_reference_semantics.duplicates !== 'ignored'
  || row.context_reference_semantics.combination !== 'all') drift(`applicability mode ${row.term} gives its context referents an order, a count or a combination other than all`);
export const COLLECTION_KINDS = Object.freeze([...NATIVE_CONTRACT_SCHEMA_V1.$defs.collection.properties.collection_kind.enum]);
const contextFree = [...vocabulary.applicability_modes.values()].filter(row => row.maximum_context === 0).map(row => row.mode);

function project(node) {
  if (node === nativeReferent) return ref('entity_id');
  if (Array.isArray(node)) return node.map(project);
  if (!isRecord(node)) return node;
  return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, project(value)]));
}

const PENDING_VALUE_TYPES = Object.freeze(['number', 'boolean']);
const isLiteralValue = node => isRecord(node) && Object.keys(node).length === 1 && PENDING_VALUE_TYPES.includes(node.type);
function projectObjects(node, valueShapes) {
  if (node === nativeReferent) return ref('entity_id');
  if (isLiteralValue(node)) return { oneOf: [{ ...node }, ref('pending')] };
  if (!isRecord(node) && !Array.isArray(node)) return node;

  const name = valueShapes.get(valueShapeKey(project(node)));
  if (name) return ref(name);
  if (Array.isArray(node)) return node.map(value => projectObjects(value, valueShapes));
  return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, projectObjects(value, valueShapes)]));
}

const valueShapeKey = node => {
  if (!isRecord(node)) return canonicalJson(node);
  const { description: _description, ...shape } = node;
  return canonicalJson(shape);
};
const described = (terms, definition) => ({ oneOf: terms.map(term => ({ const: term, description: definition(term) })) });
const typeList = types => types === null ? 'any type' : `[${types.join(' | ')}]`;

export const SINGLE_VALUED = 'single_value_per_subject_scope';

const MULTIPLICITY_MARK = Object.freeze({ [SINGLE_VALUED]: 'Single-valued.', relation_set: 'Not single-valued.',
  conjunctive_constraint: 'Holds together with every other such statement about the subject.' });
const MULTIPLICITY_WORDS = Object.freeze({
  [SINGLE_VALUED]: 'Single-valued: mandatory statements of this same relation that give one subject different values within one applicability scope contradict.',
  relation_set: 'Not single-valued: this relation allows one subject several values, so statements of it with different values stand together.',
  conjunctive_constraint: MULTIPLICITY_MARK.conjunctive_constraint });

const multiplicityGuide = equalities => 'Under a relation marked single-valued, two mandatory statements of that same relation, within one applicability '
  + 'scope, that give one subject (or subjects stated equal by ' + equalities.join(' or ') + ') different values are a contradiction. A relation marked not single-valued '
  + 'allows a subject several values by its meaning: such statements stand together, and that is not a conflict. Relations '
  + 'that take the same kind of value are not substitutes for one another.';
const RANGE_WORDS = 'A bound left out means no bound on that side, and the statement is complete; undecided, it is {"pending": true}.';
const marked = operator => operator.mechanical_support.multiplicity === 'enforced' && (operator.signature.operand_kind !== 'reference' || operator.multiplicity === SINGLE_VALUED);

function relationFacts() {
  const facts = new Map();
  nativeBranches.forEach((branch, index) => {
    for (const term of branch.properties.relation.enum) {
      const operator = operators.get(term);
      const signature = vocabulary.operator_signatures.get(term);
      if (!operator || !signature) drift(`relation ${term} has no vocabulary definition or signature`);
      if (facts.has(term)) drift(`relation ${term} is in two statement branches`);
      facts.set(term, Object.freeze({ term, branch: index, definition: operator.definition, operand_kind: signature.operand_kind,
        multiplicity: operator.mechanical_support.multiplicity === 'enforced' ? operator.multiplicity : null, mark: marked(operator) ? MULTIPLICITY_MARK[operator.multiplicity] ?? null : null, note: marked(operator) ? MULTIPLICITY_WORDS[operator.multiplicity] ?? null : null,

        guidance: signature.operand_kind === 'range' ? RANGE_WORDS : null,
        subject_types: restricted(operator.signature.subject_types), operand_types: restricted(operator.signature.operand_types),
        context_types: restricted(operator.applicability.context_reference_types),
        numeric_domain: operator.signature.operand_numeric_domain?.kind === 'integer_range' ? Object.freeze({ ...operator.signature.operand_numeric_domain }) : null,

        operand_ordering: operator.operand_semantics.ordering, operand_duplicates: operator.operand_semantics.duplicates,

        symmetric: operator.algebraic_traits.symmetric && operator.mechanical_support.algebraic_traits.symmetric === 'enforced',
        inverse: operator.inverse.kind === 'operator' && operator.mechanical_support.inverse === 'enforced' ? operator.inverse.term : null,
        declared_only: Object.freeze([...Object.entries(operator.mechanical_support.algebraic_traits).filter(([, support]) => support === 'declared_only').map(([trait]) => trait),
          ...(operator.mechanical_support.inverse === 'declared_only' ? ['inverse'] : [])]),

        pointwise: operator.signature.operand_kind === 'reference' && operator.signature.operand_cardinality.maximum !== 1
          && operator.operand_semantics.ordering === 'insignificant'
          && ((operator.multiplicity === 'relation_set' && operator.mechanical_support.multiplicity === 'enforced')
            || (operator.algebraic_traits.symmetric && operator.mechanical_support.algebraic_traits.symmetric === 'enforced')),
        same_roles: canonicalJson(operator.signature.subject_types) === canonicalJson(operator.signature.operand_types ?? null),
        population: operator.population_semantics.kind !== 'not_applicable',

        context_cardinality: operator.applicability.context_reference_cardinality ? Object.freeze({ ...operator.applicability.context_reference_cardinality }) : null,
        applicability_modes: signature.applicability_modes,
        complete_without_applies: signature.applicability_modes.some(mode => contextFree.includes(mode)),
        controlled_complement: operator.controlled_complement.kind }));
    }
  });
  for (const term of vocabulary.operator_signatures.keys()) if (!facts.has(term)) drift(`relation ${term} has no statement branch`);
  return facts;
}

export const NATIVE_AUTHORING = Object.freeze({ vocabulary, relations: relationFacts(), modes,

  equality_relations: Object.freeze(CONTROLLED_VOCABULARY.cross_operator_constraints.constraints.filter(row => row.kind === 'reference_equivalence_substitution')
    .flatMap(row => row.equivalence_operators)),
  type_terms: Object.freeze(typeTerms.map(row => row.term)), limits: CONTROLLED_CONTRACT_REQUIREMENT_LIMITS,
  vocabulary_version: VOCABULARY_VERSION_V1 });

const KEYWORDS = new Set(['$schema', '$id', '$defs', '$ref', 'title', 'description', 'type', 'enum', 'const', 'pattern', 'minLength', 'maxLength',
  'minimum', 'maximum', 'properties', 'required', 'additionalProperties', 'propertyNames', 'minProperties', 'maxProperties', 'items',
  'minItems', 'maxItems', 'uniqueItems', 'oneOf', 'anyOf', 'prefixItems', 'allOf', 'if', 'then', 'else']);
const SUBSCHEMAS = ['additionalProperties', 'propertyNames', 'items', 'if', 'then', 'else'];

export function assertInterpretable(node, where = '#') {
  for (const [keyword, value] of Object.entries(node)) {
    if (!KEYWORDS.has(keyword)) throw new TypeError(`${where}: keyword ${keyword} is not one admit() interprets`);
    if (keyword === '$defs' || keyword === 'properties') for (const [name, child] of Object.entries(value)) assertInterpretable(child, `${where}/${keyword}/${name}`);
    else if (keyword === 'oneOf' || keyword === 'anyOf' || keyword === 'prefixItems' || keyword === 'allOf') value.forEach((child, index) => assertInterpretable(child, `${where}/${keyword}/${index}`));
    else if (SUBSCHEMAS.includes(keyword) && isRecord(value)) assertInterpretable(value, `${where}/${keyword}`);
  }
}

function servingDescriptions(result, memberWords) {
  const descriptions = {
  "entity_id": "Entity id throughout this request; supplies no definition.",
  "identity": "Identity other than the term spelled by its id.",
  "entities": "New entities by id: type identifies its spelled term; {type_term,identity} identifies otherwise. Omit type only if exactly one is admitted; reuse known entities.",
  "pending": "Undecided numeric/Boolean operand: preserves the incomplete statement; returns a value choice. Omitted optional operands (e.g. maximum) are absent and complete.",
  "requirement": `Subject satisfies behavior at this modality. Default nature: ${JSON.stringify(vocabulary.claim_natures[0])}.`,
  "definition_requirement": "Typed definition; no normative force, modality, applicability or verification.",
  "membership_clause": "Named member or complete typed domain. MUST: required; MAY: permitted. One clause kind per row.",
  "membership_requirement": "Closed population per subject/applicability; each member once. Order/repetition and other properties unconstrained; omitted applies: unconditional.",
  "behavior": `A behavioral/falsifying statement about the subject. The relation fixes operand kind/cardinality and allowed applicability. Omitted applies is unconditional only where admitted. Single-valued: mandatory statements of the same relation and scope contradict when one subject (including subjects equal by ${NATIVE_AUTHORING.equality_relations.join(' or ')}) has different values. Not single-valued: several values coexist according to the relation. Equal operand types do not make relations interchangeable. Signatures: guidance vocabulary.relation_details; follow relation_definition_read for canonical definitions and semantic references.`
  };
  const statements = { ...result.statements };
  for (const [name, description] of Object.entries(descriptions)) statements[name] = { ...statements[name], description };
  for (const [name, node] of Object.entries(statements)) {
    if (node.description === 'Listed context referents hold together; order and repetition do not matter.') {
      statements[name] = { ...node, description: 'Context referents hold together; unordered, repetition insignificant.' };
    }
  }
  const kindDescriptions = { closed_set: 'Exactly these members, unordered. Closes this collection, not the entire request.',
    ordered_sequence: 'Exactly these members in meaningful order.' };
  const collection = { ...result.collection, description: `A requirement group. ${memberWords} Each member once; purpose distinguishes groups with the same members.`,
    properties: { ...result.collection.properties, kind: { oneOf: result.collection.properties.kind.oneOf.map(node =>
      ({ ...node, description: kindDescriptions[node.const] ?? drift(`unknown collection kind ${node.const}`) })) } } };
  return { ...result, statements, collection,
    unresolved_meaning: { ...result.unresolved_meaning, description: "Unencodable operative meaning and its reason. candidate_concept suggests vocabulary; it creates no vocabulary or encoded meaning." },
    unresolved: { ...result.unresolved, description: "Preserve unencodable meaning verbatim, keeping the specification incomplete. Never approximate compound meaning by a nearby relation. Plain text or text plus reason." },
    verification: { ...result.verification, description: "Independently authored check: observes concerns the verifier; fails_when concerns the written requirement subject and states a violating outcome. Nothing is inferred from the requirement." } };
}

export function buildControlledRequirementDefinitions({ collectionMember, memberWords, relationDefinitions = true, capabilities = null }) {
  const scope = capabilities === null ? null : requirementCapabilities(capabilities);
  const typed = scope === null || scope.effective.includes('typed_values');
  const scalar = typed || scope.effective.includes('scalar_values');
  const accepts = term => {
    const capability = relationCapability(operators.get(term));
    return scope === null || scope.effective.includes(capability);
  };
  const { relations, limits } = NATIVE_AUTHORING;
  const identities = nativeDeclare.properties.identity.oneOf;
  const term = identities.find(branch => branch.properties.kind.const === TERM_IDENTITY_KIND)?.properties.term;
  if (!term) drift(`the referent declaration has no ${TERM_IDENTITY_KIND} identity`);
  const completeValues = publicValueDefinitions(NATIVE_CONTRACT_SCHEMA_V1, ref('entity_id'));
  const values = typed ? completeValues : scopePrimitiveValueDefinitions(completeValues);
  const valueBodies = [
    ['value_operand', values.value_operand], ['value_binding', values.value_binding],
    ['operand_value', values.value_operand.oneOf[0]], ['operand_type', values.value_operand.oneOf[1]],
    ['operand_observation', values.value_operand.oneOf[2]], ['value_bind', values.value_binding.properties.bind]
  ];
  const completeBodies = { ...completeValues, operand_value: completeValues.value_operand.oneOf[0],
    operand_type: completeValues.value_operand.oneOf[1], operand_observation: completeValues.value_operand.oneOf[2],
    value_bind: completeValues.value_binding.properties.bind };
  const valueShapes = new Map(valueBodies.map(([name]) => [valueShapeKey(completeBodies[name]), name]));
  const defs = {
    ...values,
    entity_id: { description: 'Names one entity throughout a request. It is an identity only: it carries no definition.',
      ...term },
    type_term: relationDefinitions
      ? described(NATIVE_AUTHORING.type_terms, name => typeTerms.find(row => row.term === name).definition)
      : { enum: [...NATIVE_AUTHORING.type_terms] },
    identity: { description: 'How an entity is identified when not simply by the term its id spells.',
      oneOf: identities.filter(branch => branch.properties.kind.const !== TERM_IDENTITY_KIND).map(project) },
    entities: { description: 'NEW entities only, by id. A type alone declares the entity identified by the term its id spells; { type_term, identity } '
        + 'declares one identified another way. One the host knows is not declared. A type may be omitted only where the relations using '
        + 'the entity admit exactly one; else it is asked for.',
      type: 'object', propertyNames: ref('entity_id'), additionalProperties: ref('entity') },
    entity: { oneOf: [ref('type_term'), ref('entity_declaration')] },
    entity_declaration: { type: 'object', required: ['type_term', 'identity'], additionalProperties: false,
      properties: { type_term: ref('type_term'), identity: ref('identity') } } };

  const appliesNames = new Map();
  const appliesGroups = new Map();
  const applies = native => {
    if (!appliesNames.has(native)) {
      const groups = (native.anyOf ?? [native]).map(group => {
        const node = project(group);
        return { ...node, properties: { ...node.properties,
          mode: relationDefinitions
            ? described(group.properties.mode.enum, mode => modes.get(mode)?.definition ?? drift(`applicability mode ${mode} has no definition`))
            : { enum: [...group.properties.mode.enum] } } };
      });
      const admitted = groups.flatMap(group => group.properties.mode.enum ?? group.properties.mode.oneOf.map(row => row.const));
      const name = admitted.length === modes.size ? 'applies' : `a${appliesNames.size}`;

      const several = groups.some(group => group.properties.context && group.properties.context.maxItems !== 1 && group.properties.context.maxItems !== 0);
      const reused = groups.map(group => {
        const key = canonicalJson(group);
        if (!appliesGroups.has(key)) appliesGroups.set(key, { name: `applies_group_${appliesGroups.size}`, body: group, uses: 0 });
        const entry = appliesGroups.get(key);
        entry.uses += 1;
        return entry.body;
      });
      defs[name] = { ...(several ? { description: 'Listed context referents hold together; order and repetition do not matter.' } : {}), oneOf: reused };
      appliesNames.set(native, name);
    }
    return ref(appliesNames.get(native));
  };
  const relationText = name => {
    const row = relations.get(name);
    return row.definition + (row.mark ? ` ${row.mark}` : '') + (row.guidance ? ` ${row.guidance}` : '') + (row.subject_types || row.operand_types ? ` Subject ${typeList(row.subject_types)}; objects ${typeList(row.operand_types)}.` : '')
      + (row.context_types?.length ? ` Context ${typeList(row.context_types)}.` : '')
      + (row.numeric_domain ? ` The number is an integer of at least ${row.numeric_domain.minimum}.` : '');
  };
  defs.pending = { description: 'In place of a number or boolean of a statement\'s object: the value exists, not yet decided. The statement stays '
      + 'incomplete, keeping all else it says, and the value returns as a choice. This is not omission: an optional value left out '
      + '(a range with no maximum) is stated absent, and complete.',
    type: 'object', required: ['pending'], additionalProperties: false, properties: { pending: { const: true } } };
  const objectNames = new Map();
  const objects = native => {
    const projected = projectObjects(native, valueShapes);
    const key = canonicalJson(projected);
    if (!objectNames.has(key)) {
      const name = `o${objectNames.size}`;
      defs[name] = projected;
      objectNames.set(key, name);
    }
    return ref(objectNames.get(key));
  };
  const statementBranch = (branch, terms) => ({ type: 'object', additionalProperties: false, required: ['relation'],
    properties: { relation: relationDefinitions ? described(terms, relationText)
      : { enum: terms }, objects: objects(branch.properties.objects),
      applies: applies(branch.properties.applies) } });

  const behavioralBranches = [];
  const observationOnlyBranches = [];
  nativeBranches.forEach((branch, index) => {
    const terms = branch.properties.relation.enum.filter(accepts);
    const retained = terms.filter(term => relationAvailableForAuthoring(term, 'requirement_behavior'));
    const observationOnly = terms.filter(term => !relationAvailableForAuthoring(term, 'requirement_behavior'));
    if (retained.length) {
      const name = `b${index}`;
      defs[name] = statementBranch(branch, retained);
      behavioralBranches.push(ref(name));
    }
    if (observationOnly.length) observationOnlyBranches.push(statementBranch(branch, observationOnly));
  });
  defs.behavior = { description: 'One controlled behavioral or falsifying statement about the subject: a relation, the objects its signature takes, and when it applies. '
      + 'The relation fixes the kind and number of objects. Without "applies" a statement is unconditional, where its relation admits that. '
      + multiplicityGuide(NATIVE_AUTHORING.equality_relations)
      + (relationDefinitions ? '' : ' Each relation\'s signature is in requirement guidance vocabulary.relation_details; follow its shared relation_definition_read for the complete canonical definition and semantic references.'),
    oneOf: behavioralBranches };
  defs.observation = { oneOf: [...behavioralBranches, ...observationOnlyBranches] };
  defs.requirement = { description: 'The subject, with the stated strength, stands in the behavior. "nature" omitted is '
      + `${JSON.stringify(vocabulary.claim_natures[0])}.`,
    type: 'object', required: ['subject', 'behavior'], additionalProperties: false,
    properties: { subject: ref('entity_id'), modality: { enum: [...vocabulary.modalities] }, nature: { enum: [...vocabulary.claim_natures] },
      ...(typed ? { for_each: ref('value_for_each'), within: ref('value_scope') } : {}), behavior: ref('behavior') } };
  defs.definition_requirement = { description: 'One named typed definition with no normative force, modality, applicability or verification.',
    type: 'object', additionalProperties: false, required: ['subject', 'behavior', 'definition'], properties: {
      subject: ref('entity_id'), definition: { const: true }, ...(typed ? { within: ref('value_scope') } : {}), behavior: ref('behavior') } };
  if (!defs.applies) drift('no statement branch admits every applicability mode');
  const clause = required => ({ type: 'object', required, additionalProperties: false,
    properties: { member: ref('entity_id'), modality: { enum: [...MEMBERSHIP_MODALITIES] } } });
  defs.membership_clause = { description: 'One named member or complete typed domain. MUST is required; MAY is permitted. One row uses one clause kind.',
    oneOf: [clause(['member']), ...(typed ? [{ type: 'object', additionalProperties: false, required: ['domain'], properties: {
      domain: ref('typed_value'), modality: { enum: [...MEMBERSHIP_MODALITIES] } } }] : [])] };
  defs.membership_requirement = { description: 'A closed membership specification of the subject population under one applicability, each member '
      + 'named once. The form closes the population: closure is not declared. Order and repetition of members, '
      + 'and every other property, are unconstrained. Stated once per subject and applicability; without "applies" it is unconditional.',
    type: 'object', required: ['subject', 'membership'], additionalProperties: false,
    properties: { subject: ref('entity_id'), membership: { type: 'array', minItems: 1, items: ref('membership_clause') }, applies: ref('applies'),
      ...(typed ? { for_each: ref('value_for_each'), within: ref('value_scope') } : {}) } };

  const nativeVerification = nativeRequirement.properties.verification;
  const nativeStatement = nativeRequirement.properties.behavior;
  const projectVerification = node => node === nativeReferent ? ref('entity_id') : node === nativeStatement ? ref('behavior')
    : node === nativeObservation ? ref('observation')
    : Array.isArray(node) ? node.map(projectVerification)
      : isRecord(node) ? Object.fromEntries(Object.entries(node).map(([key, value]) => [key, projectVerification(value)])) : node;
  const projected = nativeVerification ? projectVerification(nativeVerification) : null;
  if (!projected || /"(?:select|declare|relation)"/.test(JSON.stringify(projected))) drift(
    'the native verification names a referent or a statement this projection does not replace by an entity id or the batch behavior');
  const verification = { description: 'An independently authored check of this requirement. "observes" is about the verifier, "fails_when" about the requirement\'s '
      + 'subject as written: what, if it happened, would mean the requirement was not met. Nothing in it is derived from the requirement.',
    ...projected };

  const nativeCollection = NATIVE_CONTRACT_SCHEMA_V1.$defs?.collection?.properties;
  if (!nativeCollection?.collection_kind?.enum || !nativeCollection.purpose?.pattern) drift('the contract schema has no collection kinds or purpose');
  const KIND_WORDS = { closed_set: 'The listed requirements are all the members of this collection, and their order means nothing. It may hold part of a request: it does not say the request has no other requirement.',
    ordered_sequence: 'The listed requirements are in the order given, and the order is meaning.' };
  const collection = { description: `A group of some or all of this request's requirements. ${memberWords} Each member once. "purpose" tells apart two groups over the same requirements.`,
    type: 'object', required: ['members'], additionalProperties: false,
    properties: { kind: described(nativeCollection.collection_kind.enum, kind => KIND_WORDS[kind] ?? drift(`collection kind ${kind} has no description`)),
      members: { type: 'array', minItems: 1, uniqueItems: true, items: collectionMember }, purpose: { type: 'string', pattern: nativeCollection.purpose.pattern } } };
  const unresolvedMeaning = { description: 'An operative meaning fragment the grammar cannot faithfully encode, with the reason. "candidate_concept" may '
      + 'name a vocabulary opportunity; it creates no vocabulary and encodes nothing.',
    type: 'object', required: ['text', 'reason'], additionalProperties: false,
    properties: { text: { type: 'string', minLength: 1, pattern: '\\S' }, reason: { enum: [...vocabulary.residue_reasons] },
      candidate_concept: { type: 'string', minLength: 1, pattern: '\\S' }, source_passages: REQUIREMENT_SOURCE_PASSAGES_SCHEMA } };
  const unresolved = { description: 'Meaning no relation carries: kept verbatim, keeps the specification incomplete, never rewritten. A compound meaning is '
      + 'not approximated by the nearest relation: what a relation\'s definition does not say goes here. Plain text, or text with why it '
      + 'cannot be encoded.',
    type: 'array', items: { oneOf: [{ type: 'string', minLength: 1, pattern: '\\S' }, ref('unresolved_meaning')] } };

  const runtimeBodies = [];
  const runtimeTests = verification.anyOf.map(option => option.properties.runtime_test).filter(Boolean);
  if (runtimeTests.length > 1) for (const member of ['boundary', 'selector', 'observable']) {
    const body = runtimeTests[0].properties[member];
    if (!body || runtimeTests.some(row => canonicalJson(row.properties[member]) !== canonicalJson(body))) {
      drift(`runtime-test ${member} projections differ`);
    }
    for (const row of runtimeTests) row.properties[member] = body;
    runtimeBodies.push([`runtime_test_${member}`, body]);
  }

  const factored = shareRecordAuthoringDefinitions({ properties: { statements: defs, verification },
    shared: [...valueBodies.filter(([name]) => scalar && (typed || !['value_binding', 'value_bind'].includes(name))), ...runtimeBodies,
      ...[...appliesGroups.values()].filter(entry => entry.uses > 1).map(({ name, body }) => [name, body])] });
  const statements = { ...factored.properties.statements, ...factored.$defs };
  const requirementRows = { type: 'array', maxItems: limits.requirements_per_answer, items: { oneOf: [...(scope === null || scope.effective.includes('relationships') ? [ref('requirement'), ref('membership_requirement')] : [ref('requirement')]), ...(scalar ? [ref('definition_requirement')] : [])] } };
  const result = { statements, collection, unresolved_meaning: unresolvedMeaning, unresolved, requirementRows, membershipClause: clause, verification: factored.properties.verification };
  return relationDefinitions ? result : servingDescriptions(result, memberWords);
}

export const REQUIREMENT_ROW_ID_PATTERN = '^row-[0-9a-f]{40}$';
export const REQUIREMENT_COLLECTION_ROW_ID_PATTERN = '^collection-row-[0-9a-f]{40}$';
export const REQUIREMENT_BATCH_MEMBERS = Object.freeze(['entities', 'requirements', 'collections', 'unresolved']);

export const REQUIREMENT_ROW_SOURCE_MEMBERS = Object.freeze(['user_requirement', 'user_requirement_occurrence']);

export function buildRequirementBatchSchema({ label, labelReference, rebindCaseIds, existingRows = true, capabilities = null }) {

  const shared = buildControlledRequirementDefinitions({ relationDefinitions: false, capabilities, ...(existingRows
    ? { collectionMember: buildPublicSelectionSchema({ kinds: ['requirement'], allowLocalKeys: true }),
      memberWords: 'A member is a requirement of this request by "$key", or a whole saved requirement selected by its authored meaning.' }
    : { collectionMember: labelReference, memberWords: 'A member is a requirement of this request by its label ("$key").' }) });
  const source = {
    user_requirement: { description: 'Exact saved user_requirements passage, compared literally without normalization, trimming or case folding. Omission infers no source.', type: 'string', minLength: 1 },
    user_requirement_occurrence: { description: '1-based left-to-right occurrence, including overlaps. Only with user_requirement; required for repeated passages.', type: 'integer', minimum: 1 } };
  const sourceRole = { description: 'Explicit classification of this exact source passage as context, not normative coverage. Context requires a complete definition:true and an explicitly supplied user_requirement. Omission preserves an existing role only for the unchanged binding. A targeted restatement may use null to clear only the classification; converting to normative meaning requires this explicit clearing.',
    ...(existingRows ? { oneOf: [{ const: 'context' }, { const: null }] } : { const: 'context' }) };
  const roleRules = existingRows ? [{ if: { required: ['source_role'], properties: { source_role: { const: null } } }, then: { required: ['target'], properties: { target: buildPublicSelectionSchema({ kinds: ['requirement'] }) } } }] : [];
  const contextualRules = [...roleRules, { if: { required: ['source_role'], properties: { source_role: { const: 'context' } } }, then: { required: ['user_requirement'] } }];
  const ordinaryRole = existingRows ? { source_role: { description: sourceRole.description, const: null } } : {};
  const key = { key: { ...label, description: 'Request-local row label; "$key" names its collection member/claims.' } };
  const addressed = existingRows ? { ...key,
    target: buildPublicSelectionSchema({ kinds: ['requirement'] }) } : key;
  const corrected = existingRows ? { target: buildPublicSelectionSchema({ kinds: ['requirement', 'claim'] }),
    rebind_case_ids: rebindCaseIds } : {};
  const verification = ref('requirement_verification');
  const verificationKey = { ...label, description: 'Request-local verification label; "$key" names its claims/case.' };
  const { requirement, membership_requirement: membership, ...statements } = shared.statements;
  const defs = { ...statements,
    definition_requirement: { ...statements.definition_requirement,
      properties: { ...addressed, ...statements.definition_requirement.properties, ...source, source_role: sourceRole },
      allOf: [...(statements.definition_requirement.allOf ?? []), ...contextualRules] },
    requirement: { ...requirement, description: `${requirement.description}${existingRows ? ' Use key for a new declaration or target for a saved declaration, never both.' : ''}`,
      properties: { ...addressed, ...corrected, ...requirement.properties, verification, ...source, ...ordinaryRole },
      ...(existingRows ? { allOf: [...(requirement.allOf ?? []), ...roleRules] } : {}) },
    membership_requirement: { ...membership, description: `${membership.description}${existingRows ? ' Use key for a new declaration or target for a saved declaration, never both.' : ''}`,
      properties: { ...addressed, ...membership.properties, ...source, ...ordinaryRole },
      ...(existingRows ? { allOf: [...(membership.allOf ?? []), ...roleRules] } : {}) },
    requirement_verification: { ...shared.verification, anyOf: shared.verification.anyOf.map(option => ({ ...option,
      properties: { key: verificationKey, ...option.properties } })) },
    collection: { ...shared.collection, properties: { key: label,
      ...(existingRows ? { target: buildPublicSelectionSchema({ kinds: ['collection'] }) } : {}), ...shared.collection.properties } },
    unresolved_meaning: shared.unresolved_meaning };
  const rowOptions = [...shared.requirementRows.items.oneOf];
  if (existingRows) {
    const replacementKey = { ...label, description: 'Request-local binding of this targeted declaration\'s complete submitted assertions. "$key" in claims selects all of them; a claim selection with requirement:"$key" and an exact match selects one submitted part. It names no verification or durable identity.' };
    for (const option of shared.requirementRows.items.oneOf) {
      const name = option.$ref.slice('#/$defs/'.length), base = defs[name];
      const { key: _creationKey, ...properties } = base.properties;
      const replacementName = `replacement_${name}`;
      defs[replacementName] = { ...base,
        description: 'Restate one saved whole declaration using target; replacement_key names only its submitted assertion population for explicit same-save associations.',
        required: [...new Set([...(base.required ?? []), 'target', 'replacement_key'])],
        properties: { ...properties, target: buildPublicSelectionSchema({ kinds: ['requirement'] }), replacement_key: replacementKey } };
      rowOptions.push(ref(replacementName));
    }
  }
  const batch = { description: 'Entities declared once by id; requirements: statements/memberships; collections: groups; unresolved: unencoded meaning. '
      + 'Every declared entity must be referenced by a statement or its check; a case component does not reference a request entity label. '
      + 'Absent modality/objects/required applicability/type or pending values save incomplete, without identity/expression. Expressions generated, never supplied.',
    type: 'object', additionalProperties: false, minProperties: 1,
    properties: { entities: ref('entities'),
      requirements: { ...shared.requirementRows, items: { oneOf: rowOptions }, minItems: 1,
        description: `At most ${shared.requirementRows.maxItems} rows plus claim retirements per request; whole-row removals have a separate bound. `
          + (existingRows
            ? 'New declarations append; omitted declarations remain. Correct saved meaning with target. '
            : 'Creation supplies initial rows; later saves append and retain omitted rows. ')
          + 'Declare new entities; reuse saved row-bound bindings.' },
      collections: { type: 'array', minItems: 1, items: ref('collection') },
      unresolved: { ...shared.unresolved, description: `${shared.unresolved.description} Supplied: replaces the list. Omitted: retains it.` } } };
  const factored = shareRecordAuthoringDefinitions({ properties: defs, shared: [
    ['requirement_key', key.key], ['verification_key', verificationKey],
    ['requirement_source_role', sourceRole],
    ...(existingRows ? [['cleared_requirement_source_role', ordinaryRole.source_role], ['requirement_source_role_clear_rule', roleRules[0]]] : []),
    ...Object.entries(source)
  ] });
  const definitions = { ...factored.properties, ...factored.$defs };
  const schema = { ...batch, $defs: definitions };
  assertInterpretable(schema);
  return { batch, $defs: definitions, schema };
}
const resolve = (schema, node) => {
  let current = node;
  while (current.$ref) {
    const name = current.$ref.slice('#/$defs/'.length);
    if (!current.$ref.startsWith('#/$defs/') || !Object.hasOwn(schema.$defs ?? {}, name)) throw new TypeError(`unresolvable reference ${current.$ref}`);

    current = schema.$defs[name];
  }
  return current;
};
const withoutDescription = ({ description, ...node }) => { void description; return node; };
const TYPES = { object: isRecord, array: Array.isArray, string: value => typeof value === 'string', integer: Number.isInteger,
  number: value => typeof value === 'number' && Number.isFinite(value), boolean: value => typeof value === 'boolean', null: value => value === null };

const valuesOf = (schema, node) => {
  const at = resolve(schema, node);
  if (Object.hasOwn(at, 'const')) return [at.const];
  if (at.enum) return at.enum;
  if (at.oneOf?.every(option => Object.hasOwn(resolve(schema, option), 'const'))) return at.oneOf.map(option => resolve(schema, option).const);
  return null;
};

export const finiteValues = (schema, node) => valuesOf(schema, node);
const kindOf = value => Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
const kindsOf = (schema, node) => {
  const at = resolve(schema, node);
  if (at.type) return [at.type === 'integer' ? 'number' : at.type];
  const values = valuesOf(schema, node);
  return values ? [...new Set(values.map(kindOf))] : null;
};

function discriminator(schema, options) {
  const nodes = options.map(option => resolve(schema, option));
  if (!nodes.every(node => node.type === 'object' && node.properties)) return null;
  for (const name of nodes[0].required ?? []) {
    const sets = nodes.map(node => (node.required ?? []).includes(name) && node.properties[name] ? valuesOf(schema, node.properties[name]) : null);
    if (sets.some(set => set === null)) continue;
    const all = sets.flat().map(canonicalJson);
    if (new Set(all).size === all.length) return { name, sets };
  }
  return null;
}

export function admit(schema, value, node = schema, path = []) {
  const at = resolve(schema, node);
  if (at.allOf || at.if) {
    const { allOf = [], if: condition, then: yes, else: no, ...base } = at;
    const selected = condition === undefined ? undefined : admit(schema, value, condition, path).length === 0 ? yes : no;
    return [...admit(schema, value, base, path), ...allOf.flatMap(child => admit(schema, value, child, path)),
      ...(selected === undefined ? [] : admit(schema, value, selected, path))];
  }
  const found = [];
  const bad = (cause, accepts = null, where = path) => found.push({ path: where, cause, accepts });
  if (at.oneOf) {
    const finite = valuesOf(schema, at);
    if (finite) {
      if (!finite.some(row => canonicalJson(row) === canonicalJson(value))) bad('not_an_accepted_value', { enum: finite });
      return found;
    }
    const selected = discriminator(schema, at.oneOf);
    if (selected && isRecord(value)) {
      const accepts = { enum: selected.sets.flat() };
      if (!Object.hasOwn(value, selected.name)) { bad('missing', accepts, [...path, selected.name]); return found; }
      const index = selected.sets.findIndex(set => set.some(row => canonicalJson(row) === canonicalJson(value[selected.name])));
      if (index === -1) { bad('not_an_accepted_value', { ...accepts,
        ...(selected.name === 'relation' ? { rejected_relation: value[selected.name] } : {}) }, [...path, selected.name]); return found; }
      return admit(schema, value, at.oneOf[index], path);
    }
    const options = at.oneOf.map(option => ({ option, node: resolve(schema, option), rows: admit(schema, value, option, path) }));
    const fitting = options.filter(row => row.rows.length === 0).length;
    if (fitting === 1) return found;
    if (fitting > 1) { bad('fits_more_than_one_alternative'); return found; }

    const same = options.every(row => canonicalJson(row.rows) === canonicalJson(options[0].rows));
    if (same) return options[0].rows;
    const kind = kindOf(value);
    const ofKind = options.filter(row => kindsOf(schema, row.option)?.includes(kind));
    if (ofKind.length === 1) return ofKind[0].rows;

    const plain = isRecord(value) ? [] : options.filter(row => row.node.type && row.node.type !== 'object');
    if (plain.length === 1) return plain[0].rows;
    const names = isRecord(value) ? Object.keys(value) : [];
    const declares = (row, name) => Object.hasOwn(row.node.properties ?? {}, name);
    const summary = (row, more = {}) => ({ ...(row.option.$ref ? { form: row.option.$ref.slice('#/$defs/'.length) } : {}), required: [...(row.node.required ?? [])],
      members: Object.keys(row.node.properties ?? {}), ...(row.node.anyOf ? { anyOf: row.node.anyOf } : {}), ...more });

    const own = row => names.filter(name => declares(row, name) && options.every(other => other === row || !declares(other, name)));
    const identified = options.filter(row => own(row).length);
    if (identified.length === 1) {
      const selected = identified[0];
      const conflicting = options.filter(row => row !== selected && names.some(name => declares(row, name) && !declares(selected, name)));
      if (conflicting.length) { bad('members_of_more_than_one_alternative', { alternatives: [selected, ...conflicting].map(row => summary(row)) }); return found; }
      return selected.rows;
    }
    if (identified.length > 1) { bad('members_of_more_than_one_alternative', { alternatives: identified.map(row => summary(row, { identified_by: own(row) })) }); return found; }

    const present = required => required.every(name => names.includes(name));
    const satisfied = options.filter(row => names.some(name => declares(row, name)) && present(row.node.required ?? [])
      && (!row.node.anyOf || row.node.anyOf.some(option => present(option.required ?? []))));
    if (satisfied.length === 1) return satisfied[0].rows;

    for (const name of names) if (!options.some(row => declares(row, name))) bad('not_a_member', null, [...path, name]);
    bad('alternative_not_identified', { alternatives: options.map(row => summary(row)) });
    return found;
  }

  if (at.anyOf) {
    const options = at.anyOf.map(option => admit(schema, value, option, path));
    if (!options.some(rows => rows.length === 0)) {

      const same = (left, right) => canonicalJson([left.path, left.cause]) === canonicalJson([right.path, right.cause]);

      const names = isRecord(value) ? Object.keys(value) : [];
      const alternative = index => resolve(schema, at.anyOf[index]);
      const attempted = options.filter((_rows, index) => names.every(name => Object.hasOwn(alternative(index).properties ?? {}, name)));

      const stated = attempted.filter(rows => (alternative(options.indexOf(rows)).required ?? []).every(name => names.includes(name)));
      const asked = stated.length ? stated : attempted.length ? attempted : options;
      const shared = asked[0].filter(row => asked.every(rows => rows.some(other => same(row, other))));
      if (shared.length) found.push(...shared); else bad('content_missing', { anyOf: at.anyOf });
    }
  }
  if (Object.hasOwn(at, 'const') && canonicalJson(value) !== canonicalJson(at.const)) bad('not_the_accepted_value', { const: at.const });
  if (at.enum && !at.enum.some(row => canonicalJson(row) === canonicalJson(value))) bad('not_an_accepted_value', { enum: at.enum });
  if (at.type && !(Array.isArray(at.type) ? at.type.some(type => TYPES[type](value)) : TYPES[at.type](value))) { bad(`not_${at.type === 'array' ? 'a_list' : at.type === 'object' ? 'an_object' : at.type === 'integer' ? 'an_integer' : `a_${at.type}`}`, { type: at.type }); return found; }
  if (typeof value === 'string') {
    if (at.minLength !== undefined && [...value].length < at.minLength) bad('too_short', { minLength: at.minLength });
    if (at.maxLength !== undefined && [...value].length > at.maxLength) bad('too_long', { maxLength: at.maxLength });
    if (at.pattern !== undefined && !new RegExp(at.pattern, 'u').test(value)) bad('does_not_match_pattern', { pattern: at.pattern });
  }
  if (typeof value === 'number') {
    if (at.minimum !== undefined && value < at.minimum) bad('below_minimum', { minimum: at.minimum });
    if (at.maximum !== undefined && value > at.maximum) bad('above_maximum', { maximum: at.maximum });
  }
  if (Array.isArray(value)) {
    if (at.minItems !== undefined && value.length < at.minItems) bad('too_few_items', { minItems: at.minItems });
    if (at.maxItems !== undefined && value.length > at.maxItems) bad('too_many_items', { maxItems: at.maxItems });
    if (at.uniqueItems && new Set(value.map(canonicalJson)).size !== value.length) bad('lists_a_value_twice');
    if (at.items) value.forEach((member, index) => found.push(...admit(schema, member, at.items, [...path, index])));
    if (at.prefixItems) value.slice(0, at.prefixItems.length).forEach((member, index) => found.push(...admit(schema, member, at.prefixItems[index], [...path, index])));
  }
  if (isRecord(value)) {
    const names = Object.keys(value);
    if (at.minProperties !== undefined && names.length < at.minProperties) bad('too_few_members', { members: Object.keys(at.properties ?? {}) });
    if (at.maxProperties !== undefined && names.length > at.maxProperties) bad('too_many_members', { maxProperties: at.maxProperties });
    for (const name of at.required ?? []) if (!Object.hasOwn(value, name)) bad('missing', at.properties?.[name] ? withoutDescription(at.properties[name]) : null, [...path, name]);
    for (const name of names) {
      if (at.propertyNames && admit(schema, name, at.propertyNames).length) bad('not_an_accepted_member_name', resolve(schema, at.propertyNames), [...path, name]);
      if (Object.hasOwn(at.properties ?? {}, name)) found.push(...admit(schema, value[name], at.properties[name], [...path, name]));
      else if (at.additionalProperties === false) bad('not_a_member', { members: Object.keys(at.properties ?? {}) }, [...path, name]);
      else if (isRecord(at.additionalProperties)) found.push(...admit(schema, value[name], at.additionalProperties, [...path, name]));
    }
  }
  return found;
}

export function behaviorBranch(schema, relation) {
  const branch = schema.$defs.observation.oneOf.map(branch => resolve(schema, branch))
    .find(branch => valuesOf(schema, branch.properties.relation).includes(relation));
  return branch ? { ...branch, properties: { ...branch.properties, objects: resolve(schema, branch.properties.objects) } } : null;
}

export function valueSchemaAt(schema, relation, path) {
  let node = behaviorBranch(schema, relation)?.properties.objects.items ?? null;
  for (const part of path) {
    if (!node) return null;
    node = resolve(schema, node);
    const holders = node.anyOf ?? node.oneOf ?? [node];
    node = holders.map(option => resolve(schema, option)).find(option => Object.hasOwn(option.properties ?? {}, part))?.properties[part] ?? null;
  }
  if (!node) return null;
  const value = (resolve(schema, node).oneOf ?? []).find(option => option.$ref !== '#/$defs/pending');
  return value && resolve(schema, node).oneOf.some(option => option.$ref === '#/$defs/pending') ? value : null;
}
export const isPending = value => isRecord(value) && value.pending === true && Object.keys(value).length === 1;
