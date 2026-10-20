

import { resolveDerivedProofAuthoringContract } from './controlled-contract/proof-authoring-source.mjs';
import { ControlledContractToolError } from '../lib/controlled-contract-tools.mjs';
import { createPublicSelectionSource, resolvePublicSelections, projectPublicSelection } from './controlled-contract/public-selection.mjs';

const pathOf = (member, index) => `changes.${member}[${index}]`;
const refuse = (code, field, cause, details = {}) => {
  throw new ControlledContractToolError(code, cause, { changed: false, field, ...details });
};

export async function resolveRecordAuthoringSelections({ captured, changes, exception = null }) {
  const slots = [];
  const add = (selector, field, single = false) => {
    if (selector === undefined || typeof selector === 'string' ||
        selector.kind === 'claim' && typeof selector.requirement === 'string') return null;
    const at = slots.length;
    slots.push({ selector, field, single });
    return at;
  };
  const criterionTargets = (changes.criteria ?? []).map((row, index) =>
    add(row.target, `${pathOf('criteria', index)}.target`, true));
  const removedCriteria = (changes.remove?.criteria ?? []).map((selector, index) =>
    add(selector, pathOf('remove.criteria', index), true));
  const unresolved = exception?.kind === 'grammar' ? add(exception.subject, 'exception.subject', true) : null;
  const requirementTargets = (changes.requirements?.requirements ?? []).map((row, index) =>
    add(row.target, `${pathOf('requirements.requirements', index)}.target`, true));
  const collectionTargets = (changes.requirements?.collections ?? []).map((row, index) => ({
    target: add(row.target, `${pathOf('requirements.collections', index)}.target`, true),
    members: row.members.map((member, at) => add(member, `${pathOf('requirements.collections', index)}.members[${at}]`, true))
  }));
  const removals = (changes.remove?.requirements ?? []).map((selector, index) =>
    add(selector, pathOf('remove.requirements', index), true));
  const removedCollections = (changes.remove?.collections ?? []).map((selector, index) =>
    add(selector, pathOf('remove.collections', index), true));
  const obligations = (changes.obligations ?? []).map((row, index) => ({
    criteria: row.criteria?.map((selector, at) => add(selector, `${pathOf('obligations', index)}.criteria[${at}]`, true)),
    claims: row.claims?.map((selector, at) => add(selector, `${pathOf('obligations', index)}.claims[${at}]`)),
    verification: add(row.case?.verification, `${pathOf('obligations', index)}.case.verification`, true)
  }));
  const source = slots.length === 0 ? null : await createPublicSelectionSource({ captured: { ...captured,
    contract: await resolveDerivedProofAuthoringContract(captured) }, population: 'all' });
  const { results } = slots.length === 0 ? { results: [] } : await resolvePublicSelections({
    source, selectors: slots.map(slot => slot.selector), intent: 'write', expectedRevision: captured.authoringIdentity });
  const matches = slots.map(({ selector, field, single }, index) => {
    const result = results[index];
    if (result.status !== 'resolved') {
      const { issue } = result;
      refuse(issue.code, field, typeof issue.cause === 'string' ? issue.cause : JSON.stringify(issue.cause),
        { target: selector, selection: projectPublicSelection(result) });
    }
    if (single && result.matches.length !== 1) refuse(result.matches.length === 0 ? 'selection_not_found' : 'selection_ambiguous', field,
      'This amendment requires exactly one authored declaration.', {
        target: selector, choices: result.matches.map(match => ({ target: match.selector, meaning: match.meaning })),
        correction: 'Narrow the target with distinguishing authored meaning. No amendment was applied.' });
    return result.matches;
  });
  const selected = index => index === null ? null : matches[index];
  const identities = entries => entries.flatMap(match => {
    if (match.kind !== 'requirement') return [match.internal.claim_id];
    if (match.internal.claim_ids.length === 0) refuse('controlled_contract_requirement_association_population_empty',
      slots.find((slot, index) => matches[index] === entries).field,
      'The selected declaration has no assertions to associate. Complete its authored meaning or omit this association.',
      { target: match.selector, requirement: match.meaning });
    return match.internal.claim_ids;
  });
  const batch = changes.requirements === undefined ? undefined : {
    ...changes.requirements,
    ...(changes.requirements.requirements === undefined ? {} : { requirements: changes.requirements.requirements.map((row, index) => {
      const target = selected(requirementTargets[index])?.[0];
      if (target === undefined) return row;
      if (target.kind === 'requirement' && row.rebind_case_ids !== undefined && target.internal.claim_ids.length !== 1)
        refuse('controlled_contract_requirement_batch_group_correction_required',
          `${pathOf('requirements.requirements', index)}.rebind_case_ids`,
          'Case rebinding requires one assertion. This selected declaration has no unique assertion mapping.',
          { target: row.target, correction: 'rebind_case_ids cannot infer a grouped assertion mapping. Keep the saved whole-requirement target and declare replacement_key to bind its submitted assertions. Use that $key for the complete population or a claim selector with requirement:"$key" and an exact submitted-part match. Select the check separately with verification.key/$key and case.verification. Explicitly amend intended associations in the selected unit; unresolved retiring uses in another unit still refuse. Preserve required associations rather than clearing them.' });
      return { ...row, ...(target.kind === 'requirement'
        ? { row_id: target.internal.row_id, ...(row.rebind_case_ids === undefined ? {} : { id: target.internal.claim_ids[0] }) }
        : { id: target.internal.claim_id }) };
    }) }),
    ...(changes.requirements.collections === undefined ? {} : { collections: changes.requirements.collections.map((row, index) => {
      const selection = collectionTargets[index];
      const target = selected(selection.target)?.[0];
      return { ...row, ...(target === undefined ? {} : { row_id: target.internal.collection_row_id }),
        members: row.members.map((member, at) => {
          const matches = selected(selection.members[at]);
          return matches === null ? member : matches[0].internal.row_id;
        }) };
    }) }) };
  const removeRowIds = [], retireClaimIds = [];
  const removalContext = new Map();
  removals.forEach(index => selected(index).forEach(match => {
    removalContext.set(match.kind === 'requirement' ? match.internal.row_id : match.internal.claim_id,
      { field: slots[index].field, target: slots[index].selector, meaning: match.meaning });
    if (match.kind === 'requirement') removeRowIds.push(match.internal.row_id);
    else retireClaimIds.push(match.internal.claim_id);
  }));
  removedCollections.forEach(index => {
    const match = selected(index)[0];
    removeRowIds.push(match.internal.collection_row_id);
    removalContext.set(match.internal.collection_row_id,
      { field: slots[index].field, target: slots[index].selector, meaning: match.meaning });
  });
  let collections = [];
  if (removeRowIds.length > 0) {
    const { results: [population] } = await resolvePublicSelections({ source, population: 'collections', intent: 'read' });
    if (population.status !== 'resolved') refuse(population.issue.code, 'changes.remove',
      typeof population.issue.cause === 'string' ? population.issue.cause : JSON.stringify(population.issue.cause),
      { selection: projectPublicSelection(population) });
    collections = population.matches;
  }
  return { batch, removeRowIds, retireClaimIds,
    criteria: (changes.criteria ?? []).map((row, index) => ({ ...row,
      ...(criterionTargets[index] === null ? {} : { id: selected(criterionTargets[index])[0].internal.criterion_identity }) })),
    removedCriteria: removedCriteria.map(index => selected(index)[0].internal.criterion_identity),
    exception: unresolved === null ? exception : { ...exception, selectedUnresolved: selected(unresolved)[0] },
    selectionContext: { removals: removalContext,
    collections: new Map(collections.map(match => [match.internal.collection_row_id, { target: match.selector, meaning: match.meaning }])) },
    obligations: (changes.obligations ?? []).map((row, index) => ({ ...row,
      ...(row.criteria === undefined ? {} : { criteria: row.criteria.map((selector, at) => {
        const selection = selected(obligations[index].criteria[at]);
        return selection === null ? selector : selection[0].internal.criterion_identity;
      }) }),
      ...(row.claims === undefined ? {} : { claims: row.claims.flatMap((selector, at) => {
        const selection = selected(obligations[index].claims[at]);
        return selection === null ? [selector] : identities(selection);
      }) }),
      ...(obligations[index].verification === null ? {} : { case: { ...row.case,
        verification: selected(obligations[index].verification)[0].internal.claim_id } }) })) };
}
