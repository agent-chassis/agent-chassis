import Ajv from 'ajv/dist/2020.js';
import { isDeepStrictEqual } from 'node:util';
import { buildPublicSelectionSchema } from './public-selection-schema.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const privateFields = new Set(['row_id', 'collection_row_id', 'claim_id', 'claim_ids', 'constraint_id', 'constraint_ids',
  'proposition_id', 'proposition_ids', 'reference_id', 'reference_ids', 'verification_id', 'verification_claim_ids',
  'case_revision', 'source_digest', 'current_source_digest', 'content_digest', 'digest', 'compiler', 'compiled', 'expression', 'dependency_keys',
  'controlled_contract_node_ids', 'defining_constraint_ids', 'defining_claim_ids', 'defining_proposition_ids', 'source_keys', 'available_definition_ids']);
const schema = buildPublicSelectionSchema({ kinds: ['requirement', 'claim', 'verification', 'collection', 'case', 'obligation', 'entity', 'criterion', 'unresolved'], allowLocalKeys: true });
const validate = new Ajv({ strict: false }).compile(schema);
const failure = (status, code, subject, cause, extra = {}) => ({ status, issue: { code, subject, cause, ...extra } });
const unique = values => values.filter((value, index) => !values.slice(0, index).some(previous => isDeepStrictEqual(value, previous)));
const resolved = (matches, extra = {}) => {
  const issues = unique(matches.flatMap(match => match.issues ?? []));
  return { status: 'resolved', matches, ...extra, ...(issues.length ? { issues } : {}) };
};

function patternIssue(pattern) {
  if (Array.isArray(pattern)) return pattern.map(patternIssue).find(Boolean);
  if (!object(pattern)) return null;
  for (const key of Object.keys(pattern)) if (privateFields.has(key)) return `Internal field ${key} is not a public selector.`;
  if (pattern.absent !== undefined && (!Array.isArray(pattern.absent) || pattern.absent.some(path => typeof path !== 'string' || !path.length))) return 'absent must contain authored field paths.';
  for (const path of pattern.absent ?? []) {
    if (path.split('.').some(part => privateFields.has(part))) return 'Absence patterns cannot address internal fields.';
    let supplied = pattern;
    for (const part of path.split('.')) supplied = object(supplied) && Object.hasOwn(supplied, part) ? supplied[part] : undefined;
    if (supplied !== undefined) return `absent contradicts supplied ${path}.`;
  }
  return Object.entries(pattern).filter(([key]) => !['absent', 'literal'].includes(key)).map(([, value]) => patternIssue(value)).find(Boolean) ?? null;
}

export function matchesPublicPattern(value, pattern) {
  if (!object(pattern)) return isDeepStrictEqual(value, pattern);
  for (const path of pattern.absent ?? []) {
    let held = value;
    for (const part of path.split('.')) held = object(held) && Object.hasOwn(held, part) ? held[part] : undefined;
    if (held !== undefined) return false;
  }
  return Object.entries(pattern).filter(([key]) => key !== 'absent').every(([key, expected]) =>
    key === 'id' && object(pattern.identity) ||
    object(value) && Object.hasOwn(value, key) && (object(expected)
      ? matchesPublicPattern(value[key], expected) : isDeepStrictEqual(value[key], expected)));
}

function populationOf(coverage, { authorableNativeCaseTarget }) {
  const references = new Map(coverage.references.map(row => [row.reference_id, row]));
  const publicValue = value => {
    if (Array.isArray(value)) return value.map(publicValue);
    if (!object(value)) return value;
    if (typeof value.reference_id === 'string') {
      const reference = references.get(value.reference_id);
      if (!reference) throw Object.assign(new Error('A saved component has no authorized entity meaning.'), { code: 'selection_unavailable' });
      return entity(reference);
    }
    if (typeof value.select === 'string') {
      const reference = references.get(value.select);
      if (!reference) throw Object.assign(new Error('A saved semantic reference has no authorized definition.'), { code: 'selection_unavailable' });
      return entity(reference);
    }
    if (value.identity !== undefined && value.type_term !== undefined) return entity(value);
    return Object.fromEntries(Object.entries(value).filter(([key]) => !privateFields.has(key))
      .map(([key, value]) => [key, key === 'literal' ? structuredClone(value) : publicValue(value)]));
  };
  const entity = row => ({ ...(row.type_term === undefined ? {} : { type_term: row.type_term }), identity: structuredClone(row.identity) });
  const criterion = row => ({ ...(object(row.authored) ? row.authored : {}), text: row.text,
    ...(row.identity_source === 'typed' ? { typed_identity: row.identity } : {}) });
  const runtimeMeaning = check => {
    const meaning = publicValue(check);
    if (meaning.runtime_test?.boundary?.subjects) meaning.runtime_test.boundary.subjects = check.runtime_test.boundary.subjects.map(subject => {
      if (typeof subject !== 'string') return publicValue(subject);
      const reference = references.get(subject);
      if (!reference) throw Object.assign(new Error('A saved runtime boundary subject has no authorized entity meaning.'), { code: 'selection_unavailable' });
      return entity(reference);
    });
    if (meaning.runtime_test?.falsifiers) {

      const { items } = meaning.runtime_test.falsifiers;
      meaning.runtime_test.falsifiers = { items: items.map(({ selector: _selector, mutation_id: _mutation, ...declaration }) => declaration) };
    }
    return meaning;
  };
  const rows = coverage.authored_requirements.rows;
  const claims = new Map(coverage.requirements.map(row => [row.claim_id, row]));
  const linked = row => unique(row.claim_ids.flatMap(id => claims.get(id)?.meaning?.verifications ?? []).map(verification => ({
    id: verification.claim_id, meaning: runtimeMeaning(verification) })));
  const definitions = row => {
    const descriptions = coverage.authored_requirements.descriptions;
    const roots = (descriptions?.roots ?? []).filter(root => isDeepStrictEqual(root.entity.identity, row.input.subject?.identity) &&
      root.defining_constraint_ids.some(id => row.constraint_ids.includes(id)));
    const keys = new Set(roots.flatMap(root => [root.key, ...root.dependency_keys]));
    const nodes = (descriptions?.nodes ?? []).filter(node => keys.has(node.key));
    const missing = unique([...roots.flatMap(root => root.missing ?? []),
      ...(descriptions?.missing ?? []).filter(cause => cause.key === undefined || keys.has(cause.key))].map(cause => ({
      ...publicValue(Object.fromEntries(Object.entries(cause).filter(([key]) => key !== 'key'))), ...(cause.key === undefined ? {} : { entity: publicValue((descriptions.nodes ?? []).find(node => node.key === cause.key)?.entity) }) })));
    return { state: roots.length === 0 ? 'not_established' : missing.length || roots.some(root => root.state !== 'complete') ? 'incomplete' : 'complete',
      ...(roots.length ? {} : { cause: 'No dependency closure is established for this declaration; this is not evidence that no definitions are needed.' }),
      nodes: nodes.map(node => ({ entity: entity(node.entity),
        definitions: node.definitions.map(definition => publicValue(definition.constraint)),
        uses: publicValue(node.uses.map(use => ({ ...use, missing: (use.missing ?? []).map(({ key: _key, ...cause }) => cause) }))), ...(node.source === undefined ? {} : { source: publicValue(node.source) }) })), missing };
  };
  const declarations = rows.map(row => publicValue(row.input));
  const selectorFor = (declaration, extra = {}) => {
    const match = {};
    const uniqueMatch = () => declarations.filter(value => matchesPublicPattern(value, match)).length === 1;
    const priority = ['subject', 'definition', 'modality', 'nature', 'membership', 'applies', 'for_each', 'within'];
    for (const field of priority) if (declaration[field] !== undefined) {
      match[field] = declaration[field];
      if (uniqueMatch()) return { kind: 'requirement', match };
    }
    if (declaration.behavior?.relation !== undefined) {
      match.behavior = { relation: declaration.behavior.relation };
      if (uniqueMatch()) return { kind: 'requirement', match };
    }
    return { kind: 'requirement', match: { ...declaration, ...extra } };
  };
  const requirements = rows.map(row => {
    const source = row.source ?? { state: 'absent' };
    const declaration = { ...publicValue(row.input),
      ...(source.user_requirement === undefined ? {} : { user_requirement: source.user_requirement,
        ...(source.user_requirement_occurrence === undefined ? {} : { user_requirement_occurrence: source.user_requirement_occurrence }) }) };
    const selector = selectorFor(publicValue(row.input));
    return { kind: 'requirement', internal: { row_id: row.row_id, claim_ids: [...row.claim_ids], state: row.state }, selector,
      meaning: { declaration, state: row.state, ...(row.pending?.length ? { pending: publicValue(row.pending) } : {}),
        ...(source.state === 'absent' ? {} : { source: publicValue(source) }) },
      verifications: linked(row), dependencies: () => definitions(row), row };
  });
  const verificationSelector = (requirement, verification) => {
    const base = { kind: 'verification', requirement: requirement.selector };
    if (requirement.verifications.length === 1) return base;
    const match = {};
    for (const field of ['method', 'verifier', 'observes', 'fails_when', 'runtime_test']) if (verification.meaning[field] !== undefined) {
      match[field] = verification.meaning[field];
      if (requirement.verifications.filter(candidate => matchesPublicPattern(candidate.meaning, match)).length === 1) return { ...base, match };
    }
    return { ...base, match: verification.meaning };
  };
  const verificationMatches = requirements.flatMap(requirement => requirement.verifications.map(verification => ({
    kind: 'verification', internal: { claim_id: verification.id },
    selector: verificationSelector(requirement, verification),
    meaning: { requirement: requirement.selector, ...verification.meaning } })));
  const ownedClaims = new Set(requirements.flatMap(row => row.internal.claim_ids));
  for (const row of coverage.requirements.filter(row => !ownedClaims.has(row.claim_id))) {
    for (const check of row.meaning.verifications ?? []) if (!verificationMatches.some(match => match.internal.claim_id === check.claim_id)) {
      const ownerCases = coverage.cases.filter(definition => definition.verification_id === check.claim_id);
      verificationMatches.push({ kind: 'verification', internal: { claim_id: check.claim_id },
        ...(ownerCases.length === 1 ? { selector: { kind: 'verification', case: ownerCases[0].case_id } } : {}),
        meaning: { ...runtimeMeaning(check), associated_statement: publicValue(Object.fromEntries(Object.entries(row.meaning).filter(([key]) => key !== 'verifications'))),
          ...(ownerCases.length === 1 ? {} : { targeting: { state: 'unavailable', cause: 'This saved verification has no whole authored declaration or uniquely established public case target.' } }) } });
    }
  }
  const collections = coverage.authored_requirements.collections.map(collection => {
    const members = collection.members.map(member => requirements.find(row => row.internal.row_id === member.row_id));
    if (members.some(member => member === undefined)) throw Object.assign(new Error('A saved collection member is outside the complete authorized declaration population.'), { code: 'selection_unavailable' });
    const declaration = { kind: collection.kind, ...(collection.purpose === undefined ? {} : { purpose: collection.purpose }),
      members: members.map(member => member.selector) };
    const match = {};
    for (const field of ['purpose', 'kind']) if (declaration[field] !== undefined) {
      match[field] = declaration[field];
      if (coverage.authored_requirements.collections.filter(candidate => matchesPublicPattern(candidate, match)).length === 1) break;
    }
    const uniqueMeaning = coverage.authored_requirements.collections.filter(candidate => matchesPublicPattern(candidate, match)).length === 1;
    return { kind: 'collection', internal: { collection_row_id: collection.collection_row_id },
      meaning: { ...declaration, state: collection.state }, selector: { kind: 'collection', match: uniqueMeaning ? match : declaration } };
  });
  const claimMatches = requirements.flatMap(requirement => requirement.internal.claim_ids.map(id => {
    const row = claims.get(id);
    if (!row) throw Object.assign(new Error('A declaration assertion has no meaning in the captured source.'), { code: 'selection_unavailable' });
    const { verifications: _checks, ...statement } = row.meaning;
    const meaning = publicValue(statement);
    return { kind: 'claim', internal: { claim_id: id }, selector: { kind: 'claim', requirement: requirement.selector, match: meaning },
      meaning: { requirement: requirement.selector, ...meaning } };
  }));
  const cases = coverage.cases.map(row => {
    const verification = row.verification_id === undefined ? null : verificationMatches.find(match => match.internal.claim_id === row.verification_id);
    const obligations = coverage.obligations.filter(obligation => obligation.case_id === row.case_id);
    return { kind: 'case', internal: { case_id: row.case_id }, selector: { kind: 'case', id: row.case_id },
      meaning: { ...publicValue({ ...row, ...(row.target === undefined ? {} : { target: authorableNativeCaseTarget(row.target) }) }),
        ...(verification ? { verification: verification.selector } : { verification_state: row.verification_id === undefined ? 'unselected' : 'unavailable' }),
        obligations: obligations.map(row => ({ id: row.obligation_id, ...(row.statement === undefined ? {} : { statement: row.statement }) })) } };
  });
  const associatedClaims = new Set([...claims.keys(), ...verificationMatches.map(match => match.internal.claim_id)]);
  const obligations = coverage.obligations.map(row => {

    const nodes = Object.hasOwn(row, 'controlled_contract_node_ids') ? row.controlled_contract_node_ids : [];
    let cause = !Array.isArray(nodes)
      ? `The saved obligation requirement association is malformed: expected a list, received ${nodes === null ? 'null' : typeof nodes}.`
      : nodes.some(id => typeof id !== 'string' || !id.length)
        ? 'The saved obligation requirement association is malformed: a saved binding is not a nonempty string.'
        : nodes.some(id => !associatedClaims.has(id))
          ? 'The saved obligation requirement association does not resolve in the complete authorized source.' : null;
    const selections = [];
    if (cause === null) {
      const represented = new Set();
      const whole = requirements.filter(requirement => requirement.internal.claim_ids.length &&
        requirement.internal.claim_ids.every(id => nodes.includes(id)));
      for (const id of nodes) {
        if (represented.has(id)) continue;
        const declarations = whole.filter(requirement => requirement.internal.claim_ids.includes(id));
        if (declarations.length) {
          for (const requirement of declarations) {
            selections.push(requirement.selector);
            requirement.internal.claim_ids.forEach(id => represented.add(id));
          }
          continue;
        }
        represented.add(id);
        const candidates = [...claimMatches, ...verificationMatches].filter(match => match.internal.claim_id === id);
        const selectors = unique(candidates.map(match => match.selector).filter(Boolean));
        if (selectors.length === 1) selections.push(selectors[0]);
        else if (candidates.length && candidates.every(match => match.kind === 'verification' && match.meaning.requirement)) {

          const meanings = unique(candidates.map(({ meaning: { requirement: _parent, ...meaning } }) => meaning));
          if (meanings.length !== 1) cause = 'The saved verification association has inconsistent meaning across its authored declarations.';
          else selections.push({ kind: 'verification', requirement: { kind: 'requirement', obligation: row.obligation_id }, match: meanings[0] });
        } else cause = 'A saved obligation association has no exact public semantic selection in the complete authorized source.';
      }
    }
    const issue = cause === null ? null : { code: 'selection_unavailable',
      subject: { unit: coverage.unit, kind: 'obligation', id: row.obligation_id }, field: 'claims', cause,
      uncertainty: 'The complete associated claim and verification set cannot be determined. No replacement association is inferred.' };
    const { controlled_contract_node_ids: _nodes, acceptance_criteria: criterionLinks, ...body } = row;
    return { kind: 'obligation', internal: { obligation_id: row.obligation_id, ...(issue ? {} : { claim_ids: [...nodes] }) },
      selector: { kind: 'obligation', id: row.obligation_id }, ...(issue ? { issues: [issue] } : {}),
      meaning: { ...publicValue(body), ...(issue ? {} : { claims: unique(selections) }),
        ...(criterionLinks === undefined ? {} : { acceptance_criteria: criterionLinks.map(link => {
          const saved = coverage.acceptance_criteria.find(row => row.identity === link.identity);
          return saved ? criterion(saved) : { state: 'unavailable', cause: 'The saved criterion association no longer resolves to current criterion meaning.' };
        }) }) } };
  });
  return { requirements, verifications: verificationMatches, collections, claims: claimMatches, cases, obligations,
    criteria: coverage.acceptance_criteria.map((row, index) => ({ kind: 'criterion',
      internal: { criterion_identity: row.identity, criterion_position: row.position ?? index }, meaning: criterion(row),
      selector: { kind: 'criterion', match: { text: row.text, ...(row.identity_source === 'typed' ? { typed_identity: row.identity } : {}) } } })),
    unresolved: (coverage.authored_requirements.unresolved ?? []).filter(row => typeof row === 'string' || typeof row.text === 'string').map((row, index) => {
      const { id: _position, ...meaning } = typeof row === 'string' ? { text: row } : row;
      const match = Object.fromEntries(['text', 'reason', 'candidate_concept'].filter(key => meaning[key] !== undefined).map(key => [key, meaning[key]]));
      const value = publicValue(meaning);
      if (value.grammar_exception) value.grammar_exception = Object.fromEntries(
        ['enforcement', 'rationale', 'source_passages', 'consequence'].filter(key => value.grammar_exception[key] !== undefined)
          .map(key => [key, value.grammar_exception[key]]));
      return { kind: 'unresolved', internal: { unresolved_index: index }, meaning: value,
        selector: { kind: 'unresolved', match } };
    }),
    references: coverage.references.map(row => ({ kind: 'entity', internal: { reference_id: row.reference_id },
      selector: { kind: 'entity', identity: row.identity, ...(row.type_term === undefined ? {} : { type_term: row.type_term }) }, meaning: entity(row) })),
    publicValue };
}

function pick(matches, selector, subject, set = false) {
  if (set || matches.length === 1) return resolved(matches);
  const local = selector.kind === 'claim' && typeof selector.requirement === 'string';
  return failure(matches.length ? 'ambiguous' : 'not_found', matches.length ? 'selection_ambiguous' : 'selection_not_found',
    subject, matches.length ? `The supplied public meaning identifies several ${local ? 'submitted assertions' : 'saved declarations'}. No candidate was selected.`
      : local ? 'The supplied public meaning identifies no submitted assertion in this prepared source.'
        : 'The supplied public meaning identifies no saved declaration in this authorized source.',
    matches.length ? { choices: unique(matches.map(match => ({ selector: match.selector, meaning: match.meaning }))),
      uncertainty: 'Identical public meaning cannot be narrowed by storage order or internal identity.' } : {});
}

export async function resolvePublicSelections({ source, selectors, population, intent, expectedRevision, localBindings }) {
  const subject = source?.coverage?.unit;
  const bad = cause => failure('refused', 'selection_kind_mismatch', subject, cause);
  if (!['read', 'write'].includes(intent) || (population !== undefined) === (selectors !== undefined) ||
      selectors !== undefined && (!Array.isArray(selectors) || !selectors.length) || intent === 'write' && population !== undefined)
    return { results: [bad('Supply either a read population or a nonempty selector array; writes require explicit selections.')] };
  if (intent === 'read' && localBindings !== undefined) return {
    results: (selectors ?? [population]).map(() => bad('Request-local replacement bindings are write-only; saved reads do not consume them.')) };
  if (intent === 'write' && localBindings !== undefined && !(localBindings instanceof Map)) return {
    results: selectors.map(() => bad('Request-local bindings must be a Map of keys to their exact prepared source and match.')) };
  const unavailable = cause => failure('unavailable', 'selection_unavailable', subject, cause);
  if (!source || Object.keys(source).sort().join(',') !== 'authoringIdentity,coverage' || typeof source.authoringIdentity !== 'string' ||
      source.coverage?.view !== 'complete' || !['all', 'assigned'].includes(source.coverage.population?.mode) ||
      !source.coverage.authored_requirements || !['rows', 'collections'].every(key => Array.isArray(source.coverage.authored_requirements[key])) ||
      !['requirements', 'references', 'obligations', 'cases', 'acceptance_criteria', 'notes', 'residue'].every(key => Array.isArray(source.coverage[key])))
    return { results: (selectors ?? [population]).map(() => unavailable('The source does not supply complete authenticated saved meaning and its captured authoring identity.')) };
  if (intent === 'write' && (typeof expectedRevision !== 'string' || expectedRevision !== source.authoringIdentity))
    return { results: selectors.map(() => failure('refused', 'save_record_revision_stale', subject,
      'The selected source does not match the expected captured authoring revision; nothing was changed.')) };
  let populations;
  try {
    const { projectRequirementDefinitionMeaning } = await import('./contract-requirement-description-sources.mjs');
    const { loadControlledContractSharedContract } = await import('./package-runtime.mjs');
    populations = populationOf(projectRequirementDefinitionMeaning(source.coverage), await loadControlledContractSharedContract());
  }
  catch (error) {
    if (error.code !== 'selection_unavailable') throw error;
    return { results: (selectors ?? [population]).map(() => failure('unavailable', 'selection_unavailable', error.subject ?? subject, error.message)) };
  }
  const resolve = selector => {
    if (typeof selector === 'string') {
      if (intent !== 'write' || !validate(selector)) return bad('Request-local bindings are write-only and must name an explicit $key. Read saved content using its public semantic selection.');
      const binding = localBindings instanceof Map ? localBindings.get(selector.slice(1)) : undefined;
      if (!binding) return failure('not_found', 'selection_not_found', selector, 'The request-local key has no established declaration binding.');
      if (binding.source !== source) return failure('unavailable', 'selection_unavailable', selector,
        'The request-local binding belongs to another prepared source. No replacement membership was inferred.');
      const held = binding.match;
      if (!['requirement', 'verification'].includes(held?.kind)) return bad('A request-local assertion or check binding must carry its prepared requirement or verification match.');
      const candidates = populations[held.kind === 'requirement' ? 'requirements' : 'verifications'].filter(match =>
        isDeepStrictEqual(match.internal, held.internal) && isDeepStrictEqual(match.selector, held.selector) &&
        isDeepStrictEqual(match.meaning, held.meaning));
      return candidates.length === 1 ? resolved(candidates) : failure('unavailable', 'selection_unavailable', selector,
        'The request-local binding does not identify its exact prepared membership and meaning. No replacement association was inferred.');
    }
    if (!validate(selector)) return bad('The selector must satisfy the strict public semantic grammar.');
    const invalid = patternIssue(selector);
    if (invalid) return bad(invalid);
    if (selector.kind === 'requirement') {
      if (selector.obligation !== undefined) {
        const row = source.coverage.obligations.find(row => row.obligation_id === selector.obligation);
        if (!row) return failure('not_found', 'selection_not_found', selector, 'The public obligation does not exist in this authorized unit.');
        const obligation = populations.obligations.find(match => match.internal.obligation_id === row.obligation_id);
        if (obligation.issues?.length) return { status: 'unavailable', issue: obligation.issues[0] };
        const nodes = obligation.internal.claim_ids;
        return resolved(populations.requirements.filter(match => match.internal.claim_ids.some(id => nodes.includes(id)) ||
          match.verifications.some(check => nodes.includes(check.id))));
      }
      return pick(populations.requirements.filter(match => {
        const meanings = match.verifications.length ? match.verifications.map(check => ({ ...match.meaning.declaration, verification: check.meaning }))
          : [match.meaning.declaration];
        return meanings.some(meaning => matchesPublicPattern(meaning, selector.match));
      }), selector, selector);
    }
    if (selector.kind === 'criterion' || selector.kind === 'unresolved')
      if (selector.kind === 'unresolved' && (source.coverage.authored_requirements.unresolved ?? []).some(row => typeof row !== 'string' && typeof row.text !== 'string'))
        return unavailable('Saved unresolved meaning is outside the authorized assigned closure; no complete fragment population is available.');
    if (selector.kind === 'criterion' || selector.kind === 'unresolved')
      return pick(populations[selector.kind === 'criterion' ? 'criteria' : 'unresolved']
        .filter(match => matchesPublicPattern(match.meaning, selector.match)), selector, selector);
    if (['claim', 'verification'].includes(selector.kind)) {
      if (selector.case !== undefined) {
        const row = source.coverage.cases.find(row => row.case_id === selector.case);
        if (!row) return failure('not_found', 'selection_not_found', selector, 'The public case does not exist in this authorized unit.');
        if (row.verification_id === undefined) return failure('not_found', 'selection_not_found', selector, 'The saved case intentionally has no established verification association.');
        const matches = populations.verifications.filter(match => match.internal.claim_id === row.verification_id);
        return matches.length ? resolved([{ ...matches[0], meaning: { ...Object.fromEntries(Object.entries(matches[0].meaning).filter(([key]) => key !== 'requirement')),
          ...(matches.some(match => match.meaning.requirement !== undefined)
            ? { requirements: unique(matches.map(match => match.meaning.requirement).filter(Boolean)) } : {}) }, selector }]) : unavailable('The saved case association names verification meaning unavailable in this authorized source.');
      }
      const parent = resolve(selector.requirement);
      if (parent.status !== 'resolved') return parent;
      if (typeof selector.requirement === 'string' && parent.matches.some(match => match.kind !== 'requirement'))
        return failure('refused', 'selection_kind_mismatch', selector,
          'The request-local key names a verification, not a submitted assertion population. Select an explicitly bound requirement key; no assertion was selected.');
      const candidates = selector.kind === 'claim' ? populations.claims : populations.verifications;
      const filtered = candidates.filter(match => parent.matches.some(parent => isDeepStrictEqual(match.selector?.requirement, parent.selector)) &&
        (selector.match === undefined || matchesPublicPattern(match.meaning, selector.match)));
      if (selector.kind === 'verification' && filtered.length > 1 && new Set(filtered.map(match => match.internal.claim_id)).size === 1) {
        const meanings = unique(filtered.map(({ meaning: { requirement: _parent, ...meaning } }) => meaning));
        if (meanings.length !== 1) return unavailable('The saved verification binding has inconsistent meaning across its authored declarations.');
        return resolved([{ ...filtered[0], selector, meaning: { ...meanings[0], requirements: unique(filtered.map(match => match.meaning.requirement)) } }]);
      }
      return pick(unique(filtered).map(match => typeof selector.requirement === 'string'
        ? { ...match, selector: { ...match.selector, requirement: selector.requirement }, meaning: { ...match.meaning, requirement: selector.requirement } }
        : match), selector, selector);
    }
    if (selector.kind === 'collection') {
      let candidates = populations.collections;
      if (selector.match.members !== undefined) {
        const members = selector.match.members.map(resolve);
        const failed = members.find(result => result.status !== 'resolved' || result.matches.length !== 1);
        if (failed) return failed.status === 'resolved' ? bad('A collection member must identify exactly one whole declaration.') : failed;
        const expected = members.map(result => result.matches[0].internal.row_id);
        candidates = candidates.filter(match => {
          const actual = source.coverage.authored_requirements.collections.find(row => row.collection_row_id === match.internal.collection_row_id).members.map(member => member.row_id);
          return isDeepStrictEqual(match.meaning.kind === 'ordered_sequence' ? actual : [...actual].sort(),
            match.meaning.kind === 'ordered_sequence' ? expected : [...expected].sort());
        });
      }
      const { members: _members, ...pattern } = selector.match;
      return pick(candidates.filter(match => matchesPublicPattern(match.meaning, pattern)), selector, selector);
    }
    const list = selector.kind === 'entity' ? populations.references : populations[`${selector.kind}s`];
    return pick(list.filter(match => selector.kind === 'entity' ? isDeepStrictEqual(match.meaning.identity, selector.identity) &&
      (selector.type_term === undefined || match.meaning.type_term === selector.type_term) : match.selector.id === selector.id), selector, selector);
  };
  if (population !== undefined) {
    if (population === 'coverage') {
      const owned = new Set(populations.requirements.flatMap(match => match.internal.claim_ids));
      const native = source.coverage.requirements.filter(row => !owned.has(row.claim_id)).map(row => ({
        kind: 'claim', internal: { claim_id: row.claim_id }, meaning: {
          ...populations.publicValue(Object.fromEntries(Object.entries(row.meaning).filter(([key]) => key !== 'verifications'))),
          targeting: { state: 'unavailable', cause: 'This operative statement has no whole authored declaration; no public declaration target was invented.' } } }));
      return { results: [resolved([...Object.entries(populations).filter(([kind]) => !['claims', 'publicValue'].includes(kind))
        .flatMap(([, matches]) => matches), ...native], { population, annotations: {
          ...(source.coverage.notes.length ? { notes: populations.publicValue(source.coverage.notes) } : {}),
          ...(source.coverage.residue.length ? { residue: populations.publicValue(source.coverage.residue) } : {}),
          ...(source.coverage.controlled_acceptance === undefined ? {} : { controlled_acceptance: populations.publicValue(source.coverage.controlled_acceptance) }) } })] };
    }
    if (!Array.isArray(populations[population]) || population === 'claims') return { results: [bad('Unknown public semantic population.')] };
    return { results: [resolved(population === 'requirements' ? [...populations.requirements, ...populations.unresolved] : populations[population], { population, source_state: ['requirements', 'verifications', 'collections'].includes(population)
      ? source.coverage.authored_requirements.status : population === 'criteria' ? 'present' : source.coverage.status })] };
  }
  return { results: selectors.map(selector => {
    const result = resolve(selector);
    if (result.status !== 'resolved') return result;
    if (intent === 'write' && result.issues?.length) return { status: 'unavailable', issue: result.issues[0] };
    return { ...result, source_state: source.coverage.authored_requirements.status };
  }) };
}

export function projectPublicSelection(resolution, { include = [] } = {}) {
  if (resolution.status !== 'resolved') return { status: resolution.status === 'ambiguous' ? 'ambiguous'
    : resolution.status === 'unavailable' ? 'unavailable' : 'refused', issue: structuredClone(resolution.issue) };
  const members = resolution.matches.map(match => {
    const { kind, meaning, selector } = match;
    const value = { kind, ...(selector === undefined ? {} : { selector: structuredClone(selector) }), ...structuredClone(meaning) };
    if (kind === 'requirement') {
      const dependencies = match.dependencies();
      const definitions = dependencies.nodes.filter(node => node.definitions.length);
      if (definitions.length) value.definitions = definitions;
      if (include.includes('dependencies')) {

        delete value.definitions;
        value.dependencies = dependencies;
      }
      if (include.includes('verifications')) value.verifications = match.verifications.map(row => structuredClone(row.meaning));
    }
    return value;
  });
  return { status: resolution.issues?.length ? 'partial' : 'ok',
    value: { ...(resolution.source_state === 'absent' ? { source_state: 'authored_declarations_absent' } : resolution.source_state === 'source_absent' ? { source_state: 'absent' } : {}), members, ...structuredClone(resolution.annotations ?? {}) },
    ...(resolution.issues?.length ? { issues: structuredClone(resolution.issues) } : {}) };
}
