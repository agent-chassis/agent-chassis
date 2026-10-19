

import { canonicalJson } from '@agent-chassis/wiki-core/src/lib/controlled-requirement-authoring-schema.mjs';
import { projectRequirementSourceLink } from '@agent-chassis/wiki-core/src/operations/controlled-contract/contract-requirement-source-links.mjs';
const call = (reference, select) => ({ tool: 'workspace_read_wiki', arguments: { reference, select } });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const STATEMENT_FIELDS = ['subject', 'modality', 'nature', 'definition', 'behavior', 'membership', 'applies', 'for_each', 'within'];
const statementOf = input => Object.fromEntries(Object.entries(input).filter(([key]) => STATEMENT_FIELDS.includes(key)));
const matchingRule = 'Each whitespace-separated term must occur literally within an authored scalar value, ignoring case. Punctuation is literal; definitions from other rows are not searched.';

export function requirementQuerySelection(reference) {
  return { tool: 'workspace_read_wiki', reference,
    select: { contract: 'requirements', view: 'choices' }, missing_inputs: ['query'],
    binding: 'Supply your task words as query; call {reference,select:{...select,query:<caller query>}}. Omitting query explicitly selects the complete inventory.',
    matching_rule: matchingRule };
}

function authoredScalars(value) {
  if (Array.isArray(value)) return value.flatMap(authoredScalars);
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(authoredScalars);
  return value === null || ['string', 'number', 'boolean'].includes(typeof value) ? [String(value).toLowerCase()] : [];
}

function rowMeaning(row) {
  if (row.source === undefined) return row;
  return { ...row, source: projectRequirementSourceLink(row.source) };
}

export function readRequirementModel(saved, select, reference, { refuseRow }) {
  const model = saved.authored_requirements;
  const parent = saved.unit.includes('#') && saved.population?.mode === 'all';
  const common = { contract: 'requirements', view: select.view, unit: saved.unit,
    population: parent ? { kind: 'parent_requirements', unit: saved.unit.split('#')[0],
      slice_applicability: 'not_established' } : { kind: saved.population?.mode ?? 'all' },
    source_state: saved.status, status: model.status, state: model.state };
  const read = view => call(reference, { contract: 'requirements', view });
  const rowChoices = { tool: 'workspace_read_wiki', reference,
    binding: 'Choose rows[i].row_id and one of the returned views; call {reference,select:{contract:"requirements",view,row_id:rows[i].row_id}} unchanged.',
    views: ['row', 'verifications', 'dependencies'] };
  if (select.view === 'identities') return { ...common,
    rows: model.rows.map(({ row_id, state, constraint_ids, claim_ids }) => ({ row_id, state, constraint_ids, claim_ids,
      verifications: saved.requirements.filter(requirement => claim_ids.includes(requirement.claim_id))
        .map(({ claim_id, verification_claim_ids }) => ({ claim_id, verification_claim_ids })) })),
    collections: model.collections.map(({ collection_row_id, members }) => ({ collection_row_id, members })),
    ...(model.rows.length ? { selection_context: rowChoices } : {}), next_calls: [] };
  if (select.view === 'choices') {

    const queried = select.query !== undefined;
    const terms = queried ? select.query.trim().toLowerCase().split(/\s+/u) : [];
    const rows = queried ? model.rows.filter(row => {
      const values = authoredScalars(statementOf(row.input));
      return terms.every(term => values.some(value => value.includes(term)));
    }) : model.rows;
    const choices = rows.map(({ row_id, state, source, input, pending }) => ({ row_id, state,
        authored_statement: Object.fromEntries(Object.entries(statementOf(input))
          .map(([key, value]) => [key, key === 'behavior' && input.definition === true
            ? Object.fromEntries(Object.entries(value).filter(([field]) => field !== 'objects')) : value])),
        ...(input.definition === true ? { definition_body: 'selected_row' } : {}),
        ...(state === 'incomplete' ? { pending } : {}), source_state: source.state }));
    const description = ({ row_id: _id, ...meaning }) => canonicalJson(meaning);
    const counts = new Map();
    for (const choice of choices) counts.set(description(choice), (counts.get(description(choice)) ?? 0) + 1);
    const state = model.status === 'absent' ? 'source_absent' : model.rows.length === 0 ? 'empty_population'
      : rows.length === 0 ? 'no_lexical_match' : 'matched';
    return { ...common,
      ...(queried ? { query: select.query, matching: { state, population_count: model.rows.length,
        matched_count: rows.length, scope: 'own_authored_statement_scalars', rule: matchingRule },
        ...(state === 'no_lexical_match' ? { information: 'No lexical match in this authorized population; applicability was not evaluated.' } : {}) } : {}),
      rows: choices.map(choice => ({ ...choice,
      ...(counts.get(description(choice)) > 1 ? { choice_state: 'ambiguous' } : {}) })),
      ...(rows.length ? { selection_context: rowChoices }
        : queried ? { selection_context: requirementQuerySelection(reference) } : {}),
      next_calls: queried ? [{ ...read('choices'), purpose: 'complete_requirement_inventory' }] : [] };
  }
  if (select.view === 'definitions') return { ...common, definitions: model.descriptions ?? null };
  if (select.view === 'compiled') return { ...common, compiler: model.compiler, compiled: model.compiled };
  if (select.view === 'unresolved') return { ...common, unresolved: model.unresolved,
    complete: !model.unresolved.some(row => row.code === 'description_unresolved_scope') };
  if (['row', 'verifications', 'dependencies'].includes(select.view)) {
    const row = model.rows.find(row => row.row_id === select.row_id);
    if (row === undefined) throw refuseRow(select.row_id);

    const { state: _modelState, status: _modelStatus, ...selectedCommon } = common;
    if (select.view === 'row') return { ...selectedCommon, row: rowMeaning(row),
      next_calls: ['verifications', 'dependencies'].map(view => ({
        ...call(reference, { contract: 'requirements', view, row_id: row.row_id }), purpose: `optional_${view}` })) };
    if (select.view === 'verifications') {
      const requirements = saved.requirements.filter(requirement => row.claim_ids.includes(requirement.claim_id));
      const verifications = [...new Map(requirements.flatMap(requirement => requirement.meaning.verifications)
        .map(verification => [verification.claim_id, verification])).values()];
      const referenceIds = new Set();
      const collect = value => {
        if (value === null || typeof value !== 'object') return;
        if (typeof value.select === 'string') referenceIds.add(value.select);
        Object.values(value).forEach(collect);
      };
      for (const verification of verifications) {
        collect(verification);
        for (const id of verification.runtime_test?.boundary.subjects ?? []) referenceIds.add(id);
      }
      return { ...selectedCommon, row_id: row.row_id, row_state: row.state,
        ...(row.state === 'incomplete' ? { pending: row.pending } : {}),
        requirements: requirements.map(({ claim_id, verification_claim_ids }) => ({ claim_id, verification_claim_ids })),
        verifications, references: saved.references.filter(reference => referenceIds.has(reference.reference_id)), next_calls: [] };
    }
    const descriptions = model.descriptions;
    const roots = (descriptions?.roots ?? []).filter(root => same(root.entity.identity, row.input.subject.identity) &&
      root.defining_constraint_ids.some(id => row.constraint_ids.includes(id)));
    const keys = new Set(roots.flatMap(root => [root.key, ...root.dependency_keys]));
    const nodes = (descriptions?.nodes ?? []).filter(node => keys.has(node.key));
    const missing = [...new Map([
      ...roots.flatMap(root => root.missing ?? []),
      ...(descriptions?.missing ?? []).filter(cause => cause.key === undefined || keys.has(cause.key)),
      ...[...keys].filter(key => !nodes.some(node => node.key === key))
        .map(key => ({ code: 'requirement_dependency_node_unavailable', key }))
    ].map(cause => [canonicalJson(cause), cause])).values()];
    const definitionState = roots.length === 0 ? 'not_established'
      : missing.length || roots.some(root => root.state === 'incomplete') ? 'incomplete'
        : roots.every(root => root.state === 'complete') ? 'complete' : 'not_established';
    return { ...selectedCommon, row_id: row.row_id, definition_state: definitionState,
      ...(roots.length === 0 ? { cause: { code: 'requirement_dependency_closure_not_established',
        message: 'No dependency closure is established for this selected row; this is not evidence that no definitions are needed.' },
        ...(row.pending?.length ? { pending: row.pending } : {}) } : {}),
      roots: roots.map(({ missing: _missing, ...root }) => root), nodes, missing, next_calls: [] };
  }

  return { ...common, compilation: model.compiled === null ? null : { state: model.compiled.state },
    definitions: model.descriptions === undefined ? null : {
      state: model.descriptions.state, missing: model.descriptions.missing.length },
    row_count: model.rows.length,
    unresolved_count: model.unresolved.reduce((sum, row) => sum + (row.unresolved_meanings ?? 1), 0),
    meaning_extent: 'summary_only',
    selection_context: requirementQuerySelection(reference),
    next_calls: [
      ...(model.rows.length ? [{ ...read('choices'), purpose: 'requirement_choices' },
        { ...read('identities'), purpose: 'requirement_identities' }] : []),
      ...(model.unresolved.length ? [read('unresolved')] : []),
      ...(model.descriptions ? [read('definitions')] : []),
      ...(model.compiled === null ? [] : [read('compiled')]),
      call(reference, { contract: 'requirements' })] };
}
