

import { CANONICAL_VERSION, identityOf, statementConstraint } from '@agent-chassis/controlled-contract/canonical-specification';
import { LOWERING_VERSION, definitionMeaning, lowerConstraint } from '@agent-chassis/controlled-contract/cel-lowering';
import { canonicalValue, CONTROLLED_VOCABULARY } from '@agent-chassis/controlled-contract/vocabulary';
import { resolveClosedPopulationV1 } from '@agent-chassis/controlled-contract/population-semantics';
import { buildEqualityNormalizationV1 } from '@agent-chassis/controlled-contract/equality-normalization';

const canonical = value => JSON.stringify(canonicalValue(value));
const ordered = values => [...new Set(values)].sort();
const entityOf = ({ type_term, identity }) => ({ type_term, identity });
export const descriptionKey = (owner, entity) => canonical([owner, entity.identity]);
const usesOf = constraint => [constraint.subject, ...(constraint.operands ?? []).flatMap(row => row.reference ? [row.reference] : []),
  ...(constraint.clauses ?? []).map(row => row.member), ...(constraint.applies?.context ?? [])];

export function nativeSpecificationConstraints(contract, unit) {
  const references = new Map((contract?.references ?? []).map(row => [row.reference_id, row]));
  const propositions = new Map((contract?.propositions ?? []).map(row => [row.proposition_id, row]));
  const constraints = [];
  const missing = [];
  for (const claim of contract?.claims ?? []) {
    if (!['behavior', 'evidence'].includes(claim.kind)) continue;
    const proposition = propositions.get(claim.proposition_id);
    const ids = proposition ? [proposition.subject_reference_id, ...proposition.operands.flatMap(row => row.kind === 'reference' ? [row.reference_id] : []),
      ...proposition.applicability_context.operand_reference_ids] : [];
    if (!proposition || ids.some(id => !references.has(id))) {
      missing.push({ code: 'description_native_node_missing', claim_id: claim.claim_id,
        proposition_id: claim.proposition_id, reference_ids: ids.filter(id => !references.has(id)) });
      continue;
    }
    const declare = id => ({ declare: entityOf(references.get(id)) });
    const { proposition_id: _proposition, subject_reference_id: _subject, operator: _operator, operands: _operands,
      applicability_context: _context, ...qualifiers } = proposition;
    const { claim_id: _claim, proposition_id: _claimProposition, kind: _kind, modality: _modality, ...claimQualifiers } = claim;
    const { operand_reference_ids: _references, ...scopeQualifiers } = proposition.applicability_context;
    const constraint = statementConstraint({ subject: declare(proposition.subject_reference_id), modality: claim.modality,
      nature: claim.kind, behavior: { ...(Object.keys(qualifiers).length || Object.keys(claimQualifiers).length
        ? { unmapped_fields: { proposition: qualifiers, claim: claimQualifiers } } : {}), relation: proposition.operator,
        objects: proposition.operands.map(row => {
          const { kind, reference_id: referenceId, value, ...extra } = row;
          return kind === 'reference' ? { ...extra, referent: declare(referenceId) }
            : kind === 'range' ? { range: { ...extra, ...(value === undefined ? {} : { value }) } } : { ...extra, [kind]: value };
        }),
        applies: { ...scopeQualifiers, mode: proposition.applicability_context.mode,
          context: proposition.applicability_context.operand_reference_ids.map(declare) } } }, claim.kind);
    constraints.push({ identity: identityOf(unit, constraint), constraint, claim_id: claim.claim_id, proposition_id: claim.proposition_id });
  }
  return { constraints, missing };
}

export function describeRequirementObjects({ specifications, roots = null, additionalRoots = [], sourceDescriptions = new Map(), nodeLimit = Infinity }) {
  const nodes = new Map();
  const operativeRoots = [];
  const gaps = [];
  const obtain = (owner, entity) => {
    entity = entityOf(entity);
    const key = descriptionKey(owner, entity);
    if (!nodes.has(key)) nodes.set(key, { key, owner, entity: structuredClone(entity), references: new Set(), definitions: new Map(),
      missing: new Map() });
    const node = nodes.get(key);
    if (canonical(node.entity) !== canonical(entity)) node.missing.set('identity', { code: 'description_identity_ambiguous', key });
    return node;
  };
  const visibility = new Map();
  const contracts = new Map();
  const equalityByOwner = new Map();
  for (const specification of specifications) {
    const { owner, contract = null, constraints = [], visibleNodeIds = null, incompleteSubjects = [] } = specification;
    visibility.set(owner, visibleNodeIds);
    contracts.set(owner, contract);
    const native = nativeSpecificationConstraints(contract, owner);
    gaps.push(...native.missing.map(row => ({ owner, ...row })));
    for (const reference of contract?.references ?? []) obtain(owner, entityOf(reference)).references.add(reference.reference_id);
    const rows = new Map(native.constraints.map(row => [row.identity, row]));
    for (const row of constraints) rows.set(row.identity, { ...rows.get(row.identity), ...row });

    equalityByOwner.set(owner, buildEqualityNormalizationV1({ propositions: [...rows.values()].map(({ identity, constraint }) => ({
      proposition_id: identity, operator: constraint.relation ?? constraint.form,
      subject_reference_id: descriptionKey(owner, constraint.subject),
      operands: (constraint.operands ?? []).map(operand => operand.reference ? { kind: 'reference', reference_id: descriptionKey(owner, operand.reference) } : { kind: 'literal' }),
      applicability_context: { mode: constraint.applies.mode, operand_reference_ids: constraint.applies.context.map(entity => descriptionKey(owner, entity)) }
    })), claims: [...rows.values()].filter(row => row.constraint.form === 'statement').map(({ identity, constraint }) => ({
      proposition_id: identity, kind: constraint.nature, modality: constraint.modality })) }));
    for (const row of rows.values()) {
      const constraint = row.constraint;
      for (const entity of usesOf(constraint)) obtain(owner, entity);
      if (constraint.form !== 'closed_membership' && constraint.nature !== 'behavior') continue;
      operativeRoots.push({ owner, entity: constraint.subject, meaning: 'subject', applies: constraint.applies });
      const subject = obtain(owner, constraint.subject);
      subject.definitions.set(row.identity, row);

      if (constraint.form === 'statement' && constraint.relation === 'reference:equals' && constraint.modality === 'MUST') {
        const other = obtain(owner, constraint.operands[0].reference);
        other.definitions.set(row.identity, row);
      }
    }
    for (const entity of incompleteSubjects) obtain(owner, entity).missing.set('authored',
      { code: 'description_statement_incomplete', key: descriptionKey(owner, entity) });
  }

  const states = new Map();
  const requests = [];
  const unconditional = { mode: 'unconditional', context: [] };
  const request = ({ owner, entity, meaning = 'subject', applies = unconditional }) => {
    const node = obtain(owner, entity);
    const scope = { ...structuredClone(applies), context: [...(applies.context ?? [])] };
    const id = canonical([node.key, meaning, scope]);
    if (!states.has(id)) {
      states.set(id, { id, node, meaning, applies: scope, dependencies: new Set(), aliases: new Set(),
        missing: new Map(node.missing), established: false });
      requests.push(id);
    }
    return id;
  };
  const rootIds = ordered([...(roots ?? operativeRoots), ...additionalRoots].map(request));
  const reachable = new Set();
  const inScope = (owner, definition, use) => {
    if (definition.mode === 'unconditional') return true;
    const equality = equalityByOwner.get(owner);
    const nativeScope = scope => ({ mode: scope.mode, operand_reference_ids: scope.context.map(entity => descriptionKey(owner, entity)) });
    const wanted = nativeScope(use);
    if (equality.ambiguous_contexts.some(row => canonical(row) === canonical(wanted))) return false;
    return canonical(equality.normalizeApplicability(nativeScope(definition))) === canonical(equality.normalizeApplicability(wanted));
  };
  const acceptsMeaning = (meaning, entity, row) => {
    const capabilities = definitionMeaning(row.constraint);
    const population = ['cc:population', 'cc:scope'].includes(entity.type_term);
    if (meaning === 'subject') return capabilities.length > 0;
    if (meaning === 'condition') return capabilities.includes('condition');
    if (meaning === 'population') return population && capabilities.includes('population');
    if (meaning === 'value') return capabilities.some(kind => ['value', 'structure'].includes(kind)) || (population && capabilities.includes('population')) ||
      (capabilities.includes('condition') && ['cc:criterion', 'cc:invariant'].includes(entity.type_term)) ||
      (capabilities.includes('behavior') && ['cc:operation', 'cc:command', 'cc:process', 'cc:runtime_component', 'cc:test', 'cc:capability'].includes(entity.type_term));
    return capabilities.some(kind => ['value', 'structure', 'behavior'].includes(kind)) || (population && capabilities.includes('population')) ||
      (capabilities.includes('condition') && ['cc:criterion', 'cc:invariant'].includes(entity.type_term));
  };
  const neededBy = (constraint, state) => {
    const operands = (constraint.operands ?? []).flatMap(operand => operand.reference ? [{ entity: operand.reference,
      meaning: constraint.relation === 'reference:equals' ? state.meaning
        : ['reference:returns', 'reference:has_value', 'reference:has_property', 'reference:has_state', 'reference:has_status', 'reference:resolves_to'].includes(constraint.relation) ? 'value'
        : constraint.relation === 'reference:subset_of' || constraint.relation === 'reference:not_subset_of' ? 'population' : 'object',
      applies: constraint.applies }] : []);
    return [...operands, ...(constraint.clauses ?? []).map(clause => ({ entity: clause.member, meaning: 'value', applies: constraint.applies })),
      ...constraint.applies.context.map(entity => ({ entity, meaning: ['if', 'unless'].includes(constraint.applies.mode) ? 'condition' : 'object',

        applies: unconditional }))];
  };
  while (requests.length) {
    const state = states.get(requests.shift()), { node } = state;
    reachable.add(node.key);
    if (reachable.size > nodeLimit || states.size > nodeLimit) return { state: 'incomplete', roots: [], nodes: [],
      missing: [{ code: 'description_delivery_capacity_exceeded', maximum_nodes: nodeLimit,
        required_nodes_at_least: Math.max(reachable.size, states.size) }] };
    const visible = visibility.get(node.owner);
    if (visible != null && [...node.references].some(id => !visible.has(id))) {
      state.missing.set('visibility', { code: 'description_dependency_not_visible', key: node.key });
      continue;
    }
    if (!CONTROLLED_VOCABULARY.type_terms.some(row => row.term === node.entity.type_term)) state.missing.set('type',
      { code: 'description_type_incomplete', key: node.key, type_term: node.entity.type_term ?? null });
    if (state.meaning === 'population' && !['cc:population', 'cc:scope'].includes(node.entity.type_term)) state.missing.set('use_type',
      { code: 'description_use_type_incomplete', key: node.key, required_meaning: 'population', type_term: node.entity.type_term });
    const codeBound = ['code_symbol', 'repository_path'].includes(node.entity.identity.kind);
    if (codeBound) {
      const source = sourceDescriptions.get(node.key);
      if (source?.state !== 'complete') state.missing.set('source', { key: node.key, code: source?.code ?? 'description_source_unavailable',
        ...(source === undefined ? {} : { source: structuredClone(source) }) });
      else {
        node.source = structuredClone(source);

        state.established = (source.defined_meanings ?? []).includes(state.meaning);
      }
    }
    const applicable = [];
    for (const row of node.definitions.values()) {
      if (visible != null && row.claim_id !== undefined && !visible.has(row.claim_id)) {
        state.missing.set(row.identity, { code: 'description_definition_not_visible', key: node.key, claim_id: row.claim_id });
        continue;
      }
      const lowered = lowerConstraint(row.constraint);
      if (lowered.state !== 'lowered') state.missing.set(row.identity, { code: 'description_lowering_unsupported', key: node.key,
        constraint_id: row.identity, reason: lowered.reason, ...(lowered.qualifiers ? { qualifiers: lowered.qualifiers } : {}) });
      if (inScope(node.owner, row.constraint.applies, state.applies)) {
        applicable.push(row);
        if (lowered.state === 'lowered' && acceptsMeaning(state.meaning, node.entity, row)) state.established = true;
        if (row.constraint.relation === 'reference:equals' && row.constraint.modality === 'MUST') {
          for (const entity of [row.constraint.subject, ...row.constraint.operands.map(operand => operand.reference)]) {
            if (descriptionKey(node.owner, entity) === node.key) continue;
            const child = request({ owner: node.owner, entity, meaning: state.meaning, applies: state.applies });
            state.aliases.add(child); state.dependencies.add(child);
          }
        }
      }

      for (const needed of neededBy(row.constraint, state)) state.dependencies.add(request({ owner: node.owner, ...needed }));
    }
    if ((state.meaning === 'population' || node.entity.type_term === 'cc:population') &&
      !applicable.some(row => row.constraint.form === 'closed_membership') &&
      !(node.source?.defined_meanings ?? []).includes('population')) {
      const contract = contracts.get(node.owner);
      if (contract && node.references.size) {
        const population = resolveClosedPopulationV1(contract, [...node.references][0], { mode: state.applies.mode,
          operand_reference_ids: state.applies.context.flatMap(entity => [...obtain(node.owner, entity).references]) });
        state.established = population.complete;
        for (const diagnostic of population.diagnostics) state.missing.set(canonical(diagnostic), { key: node.key, ...diagnostic });
        const references = new Map(contract.references.map(row => [row.reference_id, row]));
        for (const id of population.member_reference_ids) {
          if (!references.has(id)) state.missing.set(id, { code: 'description_native_node_missing', key: node.key, reference_id: id });
          else state.dependencies.add(request({ owner: node.owner,
            entity: entityOf(references.get(id)), meaning: 'value', applies: state.applies }));
        }
      } else state.established = false;
    }
  }

  let changed;
  do {
    changed = false;
    for (const state of states.values()) if (!state.established && [...state.aliases].some(id => states.get(id).established)) {
      state.established = true; changed = true;
    }
  } while (changed);
  for (const state of states.values()) if (state.meaning === 'condition' && !state.established &&
    ['code_symbol', 'repository_path'].includes(state.node.entity.identity.kind)) state.missing.set('binding', {
    code: 'description_condition_value_binding_unsupported', key: state.node.key, required_meaning: 'condition',
    recovery: 'Author the applicable predicate with its typed Boolean/numeric/range observation; locating code source alone supplies no runtime truth.' });
  for (const state of states.values()) if (!state.established && state.node.source && ['value', 'population'].includes(state.meaning))
    state.missing.set('binding', { code: 'description_value_binding_unsupported', key: state.node.key,
      required_meaning: state.meaning, source_definition_present: true,
      recovery: 'Define the required value, population or state boundary through operative statements; this located source does not supply that binding.' });
  for (const state of states.values()) if (!state.established) state.missing.set('definition', {
    code: state.node.definitions.size || state.node.source ? 'description_use_definition_missing' : 'description_definition_missing',
    key: state.node.key, required_meaning: state.meaning, applicability: state.applies,
    available_definition_ids: [...state.node.definitions.keys()].sort(),
    recovery: 'Supply the applicable definition for this use through existing typed statements or exact definition source; do not add a redundant existence assertion.' });
  const closures = new Map([...states.keys()].map(id => [id, new Set([id])]));
  const parents = new Map([...states.keys()].map(id => [id, new Set()]));
  for (const state of states.values()) for (const child of state.dependencies) parents.get(child).add(state.id);
  const pending = [...states.keys()];
  while (pending.length) {
    const id = pending.shift();
    for (const parent of parents.get(id)) {
      const into = closures.get(parent), size = into.size;
      for (const child of closures.get(id)) into.add(child);
      if (into.size !== size) pending.push(parent);
    }
  }
  const project = id => {
    const state = states.get(id), { node } = state;
    const closure = [...closures.get(id)].map(child => states.get(child));
    const keys = ordered(closure.map(child => child.node.key));
    const definitions = new Map(keys.flatMap(key => {
      const node = nodes.get(key), visible = visibility.get(node.owner);
      if (visible != null && [...node.references].some(id => !visible.has(id))) return [];
      return [...node.definitions].filter(([, row]) => visible == null || row.claim_id === undefined || visible.has(row.claim_id));
    }));
    const missing = [...new Map([...gaps.filter(row => row.owner === node.owner),
      ...closure.flatMap(child => [...child.missing.values()])].map(row => [canonical(row), row])).values()];
    return { key: node.key, owner: node.owner, entity: node.entity, required_meaning: state.meaning, applicability: state.applies,
      state: missing.length ? 'incomplete' : 'complete', dependency_keys: keys.filter(key => key !== node.key),
      defining_constraint_ids: ordered(definitions.keys()),
      defining_claim_ids: ordered([...definitions.values()].flatMap(row => row.claim_id === undefined ? [] : [row.claim_id])),
      defining_proposition_ids: ordered([...definitions.values()].flatMap(row => row.proposition_id === undefined ? [] : [row.proposition_id])),
      source_keys: keys.filter(key => nodes.get(key).source), missing };
  };
  const descriptions = rootIds.map(project);
  return { state: descriptions.every(row => row.state === 'complete') ? 'complete' : 'incomplete',
    compiler: { canonical_version: CANONICAL_VERSION, lowering_version: LOWERING_VERSION }, roots: descriptions,
    nodes: [...reachable].sort().map(key => {
      const node = nodes.get(key), visible = visibility.get(node.owner);
      const definitions = visible != null && [...node.references].some(id => !visible.has(id)) ? []
        : [...node.definitions.values()].filter(row => visible == null || row.claim_id === undefined || visible.has(row.claim_id));
      return { key, owner: node.owner, entity: node.entity, reference_ids: ordered(node.references),
        defining_constraint_ids: ordered(definitions.map(row => row.identity)),
        definitions: definitions.map(({ identity, ...row }) => ({ constraint_id: identity, ...structuredClone(row) })),
        uses: [...states.values()].filter(state => state.node.key === key).map(state => ({ required_meaning: state.meaning,
          applicability: state.applies, established: state.established, missing: [...state.missing.values()] })),
        ...(node.source === undefined ? {} : { source: node.source }) };
    }),
    missing: [...new Map(descriptions.flatMap(row => row.missing).map(row => [canonical(row), row])).values()] };
}
