

export async function readRequirementModel(source, select, reference, { selectionOwner }) {
  const { resolvePublicSelections, projectPublicSelection } = selectionOwner;
  const kinds = { requirements: ['requirement', 'claim', 'unresolved'], verifications: ['verification'], collections: ['collection'],
    cases: ['case'], obligations: ['obligation'], references: ['entity'], criteria: ['criterion'] };
  if (select.where && select.contract !== 'coverage' && !kinds[select.contract]?.includes(select.where.kind))
    return { status: 'refused', issue: { code: 'selection_kind_mismatch', subject: source.coverage.unit,
      cause: `The ${select.contract} population does not admit a ${select.where.kind} selector.` } };
  const resolved = await resolvePublicSelections({ source, ...(select.where === undefined ? { population: select.contract } : { selectors: [select.where] }), intent: 'read' });
  if (resolved.results.length !== 1) throw new TypeError('The shared selection owner did not resolve the requested selection.');

  if (select.view === 'choices') {
    const population = resolved.results[0];
    if (population.status !== 'resolved') return projectPublicSelection(population);
    const terms = select.query?.trim().toLowerCase().split(/\s+/u) ?? [];
    const scalars = value => Array.isArray(value) ? value.flatMap(scalars) : value !== null && typeof value === 'object'
      ? Object.values(value).flatMap(scalars) : [String(value).toLowerCase()];
    const matches = population.matches.filter(match => terms.every(term => scalars(match.meaning.declaration ?? match.meaning).some(value => value.includes(term))));
    return { status: 'ok', value: { ...(population.source_state === 'absent' ? { source_state: 'authored_declarations_absent' } : {}),
      ...(source.coverage.unit.includes('#') && source.coverage.population.mode === 'all'
        ? { scope: { kind: 'parent_requirements', unit: source.coverage.unit.split('#')[0], slice_applicability: 'not_established' } } : {}),
      members: matches.map(match => ({ selector: match.selector, ...(match.meaning.state === undefined ? {} : { state: match.meaning.state }),
        ...(match.meaning.pending === undefined ? {} : { pending: match.meaning.pending }) })),
      ...(select.query === undefined ? {} : { matching: matches.length ? 'matched' : population.matches.length ? 'no_lexical_match' : 'empty_population' }),
      selection_context: { tool: 'workspace_read_wiki', reference, binding: 'Use members[i].selector unchanged as where; call {reads:[{reference,select:{contract:"requirements",where:members[i].selector,include:["verifications","dependencies"]}},...]}. Choose include only for needed detail.' } } };
  }
  const result = projectPublicSelection(resolved.results[0], { include: select.include });
  if (source.coverage.unit.includes('#') && source.coverage.population.mode === 'all' && select.contract === 'requirements' && result.value)
    result.value.scope = { kind: 'parent_requirements', unit: source.coverage.unit.split('#')[0], slice_applicability: 'not_established' };
  return result;
}
