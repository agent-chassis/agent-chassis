

import { createPublicSelectionSource, resolvePublicSelections } from './public-selection.mjs';
import { resolveDerivedProofAuthoringContract } from './proof-authoring-source.mjs';

const identityFields = {
  replace_claim_id: 'requirement', claim_id: 'requirement', retire_claim_id: 'requirement',
  source_claim_id: 'source_requirement', target_claim_id: 'target_requirement',
  verification_id: 'verification', verification_claim_id: 'verification', prior_claim_id: 'prior_requirement',
  surviving_verification_ids: 'surviving_verifications', retired_verification_id: 'retired_verification',
  replacement_verification_id: 'replacement_verification',
  requirement_claim_ids: 'requirements', prior_claim_ids: 'prior_requirements',
  retired_claim_ids: 'retired_requirements', retired_verification_ids: 'retired_verifications',
  prior_verification_ids: 'prior_verifications', replacement_verification_ids: 'replacement_verifications',
  verification_ids: 'verifications', eligible_verification_ids: 'eligible_verifications',
  controlled_contract_node_ids: 'associations', retired_identities: 'retired_associations',
  surviving_link_ids: 'surviving_associations', surviving_requirement_claim_ids: 'surviving_requirements'
};
const internalFields = new Set(['phase', 'limb', 'requirement_index', 'requirement_indexes', 'retire_index',
  'field_path', 'guidance_path', 'next_calls', 'affected_case_count', 'conflict_count',
  'relation_id', 'dependency_count', 'retire_indexes']);
const unitOf = source => source.selectedUnit == null ? source.wkId : `${source.wkId}#${source.selectedUnit}`;
const unique = values => [...new Map(values.map(value => [JSON.stringify(value), value])).values()];
const unavailable = cause => ({ state: 'unavailable', cause });
const publicCasePath = value => typeof value === 'string' ? value.replaceAll('/verification_id', '/verification') : value;

export async function caseAuthoringFailureMeaning(error, captured, { authoringContext = null, prospective = null, rebinding = null } = {}) {

  if (error.code === 'obligation_coverage_case_target_invalid' && authoringContext !== null) {
    const { pointer: _pointer, limb: _limb, ...details } = error.details;
    for (const key of ['field', 'correction_field', 'preserve_field'])
      if (typeof details[key] === 'string') details[key] = details[key].replace(/^obligations\[/u, 'changes.obligations[');
    return details;
  }
  if (error.code === 'obligation_coverage_case_verification_conflict' &&
      error.details?.condition === 'competing_submitted_cases' && authoringContext !== null) {
    const submitted = (authoringContext.submittedObligations ?? []).filter(row => error.details.obligation_ids.includes(row.obligation_id));
    const cases = submitted.map(({ index }) => {
      const row = authoringContext.changes.obligations[index];
      return { field: `changes.obligations[${index}].case`, ...(row.key === undefined ? {} : { obligation_key: row.key }),
        ...(row.id === undefined ? {} : { obligation_id: row.id }),
        ...(row.case.key === undefined ? {} : { case_key: row.case.key }),
        verification: { field: `changes.obligations[${index}].case.verification`, selection: row.case.verification },
        claims_field: `changes.obligations[${index}].claims` };
    });
    const verifications = (authoringContext.rows ?? []).filter(row => row.verification_claim_id === error.details.verification_id)
      .map(row => ({ state: 'submitted', field: `changes.requirements.requirements[${row.index}].verification`,
        ...(row.verification_key === undefined ? {} : { request_local_binding: `$${row.verification_key}` }) }));
    return { condition: error.details.condition, submitted_cases: cases, ...(verifications.length ? { verification: verifications } : {}),
      changed: false, effects: { canonical_written: false, proofs_executed: false }, correction: error.details.correction,
      recovery: { caller_decision_required: true,
        choices: ['distinct_tests', 'shared_evidence', 'require_atomic_amendment'],
        after_initial_save: { tool: 'workspace_read_wiki', arguments: { reads: [{ subject: unitOf(captured),
          select: { contract: 'requirements' }, for_changes: ['requirements', 'obligations'] },
        { subject: unitOf(captured), select: { contract: 'verifications' } }] } } },
      ...(cases.length === error.details.obligation_ids.length && cases.length > 1 ? {} : {
        attribution: { state: 'incomplete', cause: 'Some competing case uses could not be mapped to submitted fields. No correspondence is inferred.' } }),
      next_calls: [] };
  }
  let population;
  try {
    const source = await createPublicSelectionSource({ captured: { ...captured,
      contract: await resolveDerivedProofAuthoringContract(captured) }, population: 'all' });
    ({ results: [population] } = await resolvePublicSelections({ source, population: 'coverage', intent: 'read' }));
  } catch (cause) {
    population = { status: 'unavailable', issue: { code: cause.code ?? null, cause: cause.message } };
  }
  const matches = population.status === 'resolved' ? population.matches : [];
  const requirementRow = index => authoringContext?.rows?.find(row => row.requirement_indexes.includes(index));
  const rowOf = (facts, index = facts.requirement_index ?? Number(/^requirements\[(\d+)\]/u.exec(facts.field ?? '')?.[1])) => {
    const row = requirementRow(index);
    if (row) return row;
    const id = facts.replace_claim_id;
    if (id === undefined) return undefined;
    const at = authoringContext?.selections?.batch?.requirements?.findIndex(row => row.id === id);
    return at !== undefined && at >= 0 ? { index: at } : undefined;
  };
  const authoredField = (value, facts = {}) => {
    if (typeof value !== 'string') return value;
    const native = /^requirements\[(\d+)\](.*)$/u.exec(value);
    const row = rowOf(facts, facts.requirement_index ?? (native ? Number(native[1]) : undefined));
    if (native) return `changes.requirements.requirements${row ? `[${row.index}]` : '[]'}${native[2].replaceAll('.replace_claim_id', '.target')}`;
    const id = facts.claim_id ?? facts.retire_claim_id;
    const removals = authoringContext?.selections?.selectionContext?.removals;
    const removed = removals?.get(id) ?? matches.filter(match => match.kind === 'requirement' && match.internal.claim_ids.includes(id))
      .map(match => removals?.get(match.internal.row_id)).find(Boolean);
    if (value.startsWith('retire_claim_ids')) return removed?.field ?? 'changes.remove.requirements';
    return value.replace(/^requirements\[\]/u, 'changes.requirements.requirements[]');
  };
  const meanings = (id, kind) => {
    if (kind === 'requirement' && matches.some(match => match.kind === 'verification' && match.internal.claim_id === id)) return meanings(id, 'verification');
    let selected = matches.filter(match => match.kind === (kind === 'row' ? 'requirement' : kind === 'verification' ? 'verification' : 'claim') &&
      (kind === 'row' ? match.internal.row_id === id : match.internal.claim_id === id));

    if (!selected.length && kind === 'requirement') selected = matches.filter(match =>
      match.kind === 'requirement' && match.internal.claim_ids.includes(id));
    if (selected.length) return unique(selected.map(match => ({ target: match.selector,
      ...(match.kind === 'verification' ? { meaning: match.meaning } : {}) })));
    const submitted = authoringContext?.rows?.filter(row => row.verification_claim_id === id) ?? [];
    if (kind === 'verification' && submitted.length) return unique(submitted.map(row => ({ state: 'submitted',
      field: `changes.requirements.requirements[${row.index}].verification`,
      ...(row.verification_key === undefined ? {} : { request_local_binding: `$${row.verification_key}` }),
      method: authoringContext.changes.requirements.requirements[row.index].verification.method })));
    const replacement = rebinding?.selections.filter(selection => selection.verification_claim_id === id) ?? [];
    if (kind === 'verification' && replacement.length) return unique(replacement.map(selection => ({ state: 'submitted',
      field: authoredField(`requirements[${selection.requirement_index}].verification`, selection),
      method: prospective?.contract?.content.claims.find(claim => claim.claim_id === id)?.verification_method ?? null })));
    return [unavailable(population.issue?.cause ?? 'This association has no saved public declaration in the captured source. No replacement selection is inferred.')];
  };
  const entity = id => {
    const reference = [...(prospective?.contract?.content.references ?? []), ...(captured.contract?.content.references ?? [])]
      .find(reference => reference.reference_id === id);
    return reference ? { type_term: reference.type_term, identity: reference.identity }
      : unavailable('The compared component has no available authored identity.');
  };
  const comparison = (entry, facts) => ({ ...Object.fromEntries(Object.entries(entry).filter(([key]) => key !== 'obligation_id' || !entry.obligation_id.startsWith('requirements['))),
    ...(entry.obligation_id?.startsWith('requirements[') ? { field: authoredField(entry.obligation_id, facts) } : {}),
    ...(typeof entry.source === 'string' ? { source: authoredField(publicCasePath(entry.source), facts) } : {}),
    value: facts.path === '/verification_id' ? meanings(entry.value, 'verification')
      : facts.path === '/component' ? (Array.isArray(entry.value) ? entry.value.map(entity) : entity(entry.value)) : entry.value });

  const dependency = facts => {
    const result = {};
    for (const [key, value] of Object.entries(facts)) {
      if (internalFields.has(key)) continue;
      if (key === 'row_id') result.requirement = meanings(value, 'row');
      else if (Object.hasOwn(identityFields, key)) result[identityFields[key]] = value === null ? null
        : unique((Array.isArray(value) ? value : [value]).flatMap(id => meanings(id, key.includes('verification') ? 'verification' : 'requirement')));
      else if (key === 'obligation_id' && value.startsWith('requirements[')) result.field = authoredField(value, facts);
      else if (key === 'obligation_ids') {
        const fields = value.filter(id => id.startsWith('requirements['));
        const ids = value.filter(id => !id.startsWith('requirements['));
        if (fields.length) result.fields = fields.map(field => authoredField(field, facts));
        if (ids.length) result.obligation_ids = ids;
      }
      else if (key === 'collection_id') result.collection = unavailable('This native collection has no authored public selection. No supported save can amend this dependency.');
      else if (key === 'field') result.field = authoredField(value, facts);
      else if (key === 'path' || key === 'descendant_path') result[key] = publicCasePath(value);
      else if (key === 'values') result.values = value.map(entry => comparison(entry, facts));
      else if (['affected_rows', 'affected_uses', 'affected_cases', 'conflicts', 'retirement_selections', 'dependencies'].includes(key)) result[key] = value.map(dependency);
      else result[key] = value;
    }
    return result;
  };
  const details = dependency(error.details ?? {});
  if (error.code === 'obligation_coverage_requirement_row_correction_requires_amendment') {

    details.affected_rows = (details.affected_rows ?? []).map(({ prior_requirements: _prior, ...row }) => row);
    const replacements = (error.details.affected_rows ?? []).flatMap(affected => {
      const row = authoringContext?.rows?.find(row => row.row_id === affected.row_id);
      if (!row) return [];
      const key = authoringContext.changes.requirements.requirements[row.index].replacement_key;
      return [{ field: `changes.requirements.requirements[${row.index}].replacement_key`,
        ...(key === undefined ? { caller_choice: 'Declare a unique request-local label for this submitted assertion population.' }
          : { whole_population: `$${key}`, subset: `Use a claim selector with requirement:"$${key}" and one exact submitted-part match per intended member.` }) }];
    });
    if (replacements.length) details.replacement_bindings = replacements;
    const otherUses = (details.affected_uses ?? []).filter(use => use.unit !== unitOf(captured));
    if (otherUses.length) details.stopping_condition = 'A retiring assertion remains required by the named uses in other units. This grouped amendment cannot rewrite those units or infer their replacement associations; nothing was published.';
  }
  const selectedRow = rowOf(error.details ?? {});
  const submittedTarget = selectedRow && authoringContext.changes?.requirements?.requirements?.[selectedRow.index]?.target;
  if (submittedTarget) details.requirement = [{ target: submittedTarget }];
  if (error.code === 'obligation_coverage_case_unknown' && selectedRow) {
    const selected = authoringContext.selections.batch.requirements[selectedRow.index];
    const claims = selected.id ? [selected.id] : (captured.contract?.content.authored_requirements?.rows ?? [])
      .find(row => row.row_id === selected.row_id)?.claim_ids ?? [];
    const verifications = new Set((captured.contract?.content.relations ?? []).filter(relation =>
      relation.role === 'verifies' && claims.includes(relation.target_claim_id)).map(relation => relation.source_claim_id));
    const eligible = new Set(captured.cases.filter(row => verifications.has(row.verification_id)).map(row => row.case_id));
    details.case_choices = matches.filter(match => match.kind === 'case' && eligible.has(match.internal.case_id))
      .map(match => ({ id: match.internal.case_id, target: match.meaning.target, component: match.meaning.component }));
    details.correction = details.case_choices.length ? 'Choose the intended saved case from case_choices and correct the addressed rebind_case_ids. No case was selected for you.'
      : 'No saved case of the selected requirement is available to retain. Correct the authored case selection; the save did not execute.';
  }
  const caseIds = unique(['case_ids', 'missing_case_ids', 'affected_case_ids', 'saved_case_ids', 'requested_case_ids']
    .flatMap(key => details[key] ?? []).concat(details.case_id ? [details.case_id] : [], (details.case_choices ?? []).map(row => row.id)));
  const cases = caseIds.filter(id => captured.cases.some(row => row.case_id === id));
  const uses = unique([...(details.affected_uses ?? details.conflicts ?? []),
    ...(captured.sources ?? []).flatMap(source => (source.source?.content?.obligations ?? [])
      .filter(row => cases.includes(row.case_id) || row.obligation_id === details.obligation_id || details.obligation_ids?.includes(row.obligation_id))
      .map(row => ({ unit: source.selectedUnit == null ? captured.wkId : `${captured.wkId}#${source.selectedUnit}`, obligation_id: row.obligation_id })))]);
  const reads = unique(uses.filter(use => use.unit && use.obligation_id).map(use => ({ subject: use.unit,
    select: { contract: 'obligations', where: { kind: 'obligation', id: use.obligation_id } }, for_changes: ['obligations'] })));
  const requirements = [...(details.requirement ?? []), ...(details.requirements ?? []),
    ...(details.affected_rows ?? []).flatMap(row => row.requirement ?? []),
    ...(details.retirement_selections ?? []).flatMap(row => row.requirement ?? []),
    ...(details.dependencies ?? []).flatMap(row => [...(row.source_requirement ?? []), ...(row.target_requirement ?? [])])].filter(row => row.target);
  reads.push(...unique(requirements.map(row => ({ subject: captured.wkId,
    select: { contract: row.target.kind === 'verification' ? 'verifications' : 'requirements', where: row.target,
      ...(row.target.kind === 'verification' ? {} : { include: ['verifications'] }) }, for_changes: ['requirements'] }))));
  reads.push(...cases.map(id => ({ subject: captured.wkId, select: { contract: 'cases', where: { kind: 'case', id } } })));
  if (!reads.some(read => read.subject === unitOf(captured) && read.for_changes)) reads.push({ subject: unitOf(captured),
    for_changes: ['requirements', 'obligations'] });
  for (const owner of unique([...(details.owner_units ?? []), ...(details.owner_unit ? [details.owner_unit] : [])])) {
    reads.push({ subject: owner, for_changes: ['requirements', 'obligations'] });
  }
  const row = rowOf(error.details ?? {});
  const retained = unique([...(details.case_ids ?? []), ...(details.missing_case_ids ?? [])]);
  const uneditableDependency = details.dependencies?.some(row => row.kind === 'relation' || row.collection?.state === 'unavailable');
  let correction;
  let explicitAssociation = false;
  if (details.condition === 'unlinked_verification_selected' && authoringContext?.changes) {
    const index = authoringContext.changes.obligations?.findIndex(item => item.id === details.obligation_id);
    const item = index === undefined || index < 0 ? null : authoringContext.changes.obligations[index];
    const binding = item?.case?.verification;
    const submitted = authoringContext.rows?.find(candidate => typeof candidate.verification_key === 'string' &&
      candidate.verification_claim_id === error.details.verification_id &&
      binding === `$${candidate.verification_key}`);

    if (submitted && Array.isArray(item.claims) && !item.claims.includes(binding)) {
      const changes = structuredClone(authoringContext.changes);
      changes.obligations[index].claims.push(binding);
      details.field = `changes.obligations[${index}].claims`;
      correction = { tool: 'save_record', arguments: { unit: unitOf(captured), revision: captured.authoringIdentity, changes } };
      explicitAssociation = true;
    }
  }
  if (row && ['stranded_case', undefined].includes(details.condition) && retained.length &&
      ['obligation_coverage_case_selector_invalid', 'obligation_coverage_case_rebinding_incomplete'].includes(error.code) && authoringContext.changes) {
    const changes = structuredClone(authoringContext.changes);
    const requirement = changes.requirements.requirements[row.index];
    const caseIds = unique([...(requirement.rebind_case_ids ?? []), ...retained]);
    if (caseIds.length > 1) {
      details.binding_conflict = { condition: 'distinct_cases_share_replacement_verification', case_ids: caseIds };
      details.correction = 'These distinct cases cannot all own this one replacement verification. Supply distinct compatible verification/case associations for the intended retained cases; no case or check was chosen and no automatic retention save is offered.';
    } else {
      requirement.rebind_case_ids = caseIds;
      correction = { tool: 'save_record', arguments: { unit: unitOf(captured), revision: captured.authoringIdentity, changes } };
    }
  }
  const immediate = correction ? Object.fromEntries((explicitAssociation
    ? ['condition', 'field', 'obligation_id', 'case_id', 'verification']
    : ['condition', 'field', 'case_ids', 'missing_case_ids'])
    .filter(key => details[key] !== undefined).map(key => [key, details[key]])) : details;
  return { ...immediate, changed: false, effects: { canonical_written: false, proofs_executed: false },
    ...(population.status === 'resolved' && correction ? { detail_call: { tool: 'workspace_read_wiki', arguments: { reads } } } : {}),
    ...(population.status === 'resolved' ? { next_calls: correction ? [correction] : [{ tool: 'workspace_read_wiki', arguments: { reads } }] }
      : { next_calls: [], association_diagnosis: { state: 'unavailable', cause: population.issue },
        stopping_condition: 'Dependent authored associations are unavailable; no correction was selected.' }),
    ...(uneditableDependency ? { stopping_condition: 'The retained native dependency cannot be amended through save_record. The retirement did not execute; do not repeat it unchanged.' } : {}),
    correction: uneditableDependency ? 'This retirement did not execute. Its retained native dependency has no supported save correction; stop this action.'
      : explicitAssociation ? 'The returned correction explicitly associates the request-local verification already selected for this case. It preserves all other submitted meaning and associations; remaining validation still applies. Calling it makes that association decision.'
      : correction ? 'List the retained cases using the returned correction. It preserves the submitted authored change and performs no work until called.'
      : details.correction ?? 'Use the affected public declarations and case/obligation identities to author explicit compatible changes under the current revision. Preserve other meaning and associations. Reading does not perform the correction.' };
}

export async function projectRequirementMutationFailure(error, captured, authoringContext) {
  if (!/^controlled_contract_requirement_(?:correction_|retirement_dependency_conflict$)/u.test(error?.code ?? '')) return;
  error.details = await caseAuthoringFailureMeaning(error, captured, { authoringContext });
  if (error.details.field) error.message = error.message.replace(/requirements\[\d+\](?:\.replace_claim_id)?|retire_claim_ids\[\d+\]/gu, error.details.field);
}
