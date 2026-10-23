

import { isDeepStrictEqual } from 'node:util';
import { recordAuthoringAvailability } from '@agent-chassis/wiki-core/src/lib/record-authoring-availability.mjs';
import { proofRefreshRecovery } from '@agent-chassis/wiki-core/src/lib/proof-refresh-guidance.mjs';
import { projectAssessmentDiagnosis } from './task-assess-contract-corrections.mjs';
import { requirementGuidanceRecoveryCall } from './requirement-authoring-guidance.mjs';

export const assessmentAddress = carrier => ({ unit: carrier.unit,
  ...(carrier.focus == null ? {} : { focus: carrier.focus }),
  ...(carrier.selection.obligation_id == null ? {} : { obligation_id: carrier.selection.obligation_id }) });
const canWrite = carrier => ['operator', 'orchestrator'].includes(carrier.source_authority.role);
const root = carrier => carrier.unit.split('#')[0];
const read = (unit, members) => ({ tool: 'workspace_read_wiki',
  arguments: { reads: [{ subject: unit, select: { context: true }, for_changes: members }] }, purpose: 'current_correction_context' });

export function authoringRecipe(carrier, tier, { unit, members, instruction }) {
  const status = !canWrite(carrier) ? 'authoring_not_authorized'
    : carrier.focus != null ? 'focused_save_unsupported'
    : members.includes('requirements') && !recordAuthoringAvailability(tier).compile_requirements
      ? 'authoring_operation_unavailable' : 'awaiting_authored_values';
  if (status !== 'awaiting_authored_values') return { limitation: { code: status,
    subject: unit, cause: status === 'authoring_not_authorized'
      ? 'This findings session can inspect and report; it cannot author a correction.'
      : status === 'focused_save_unsupported'
        ? 'save_record cannot write this named focused contract. Do not redirect the correction to the root.'
        : 'Requirement compilation is unavailable in this session; required meaning remains unfinished.' }, next_calls: [] };
  return { save_guidance: { unit, instruction,
    revision_from: `current_correction_context response.contexts[${JSON.stringify(unit)}].revision`,
    changes_schema_from: { calls_from: `current_correction_context response.contexts[${JSON.stringify(unit)}].next_calls`,
      select: { input_contract: { tool: 'save_record', members } } },
    after_save: { when: 'Only when reassessment is requested; correction-only work may finish after save.',
      tool: 'workspace_assess_contract', arguments: assessmentAddress(carrier) } }, next_calls: [read(unit, members)] };
}

function correctionSubjects(authoring) {
  return authoring.subjects?.flatMap(subject => {
    if (subject.definition_id !== undefined) return [{ definition_id: subject.definition_id,
      ...(subject.corrections === undefined ? {} : { corrections: subject.corrections }) }];
    const missing = subject.missing_authored_input?.filter(input => input.field !== subject.component_requirement?.field);
    if (!missing?.length) return [];
    return [{ ...(subject.obligation_id === undefined ? {} : { obligation_id: subject.obligation_id }),
      ...(subject.case_id === undefined ? {} : { case_id: subject.case_id }),
      missing_authored_input: missing }];
  });
}

export function selectedAssessmentRecovery(carrier, diagnosis, clauses, tier) {
  if (['definition_source_classification_missing', 'definition_context_source_stale'].includes(diagnosis.code)) {
    if (diagnosis.subjects.some(subject => subject.target === undefined)) return { recovery: {
      code: 'requirement_target_unresolved', cause: 'The affected definition has no unique available public target.',
      stop: 'Preserve its meaning and selection cause; no definition restatement can be offered without a usable target.' }, next_calls: [] };
    const incomplete = diagnosis.subjects.some(subject => subject.authored_state === 'incomplete');
    const recipe = authoringRecipe(carrier, tier, { unit: root(carrier), members: ['requirements'],
      instruction: (incomplete ? 'Complete the unfinished definition before classifying its source; choose missing meaning explicitly and preserve everything already stated. ' : '') +
        'Choose the source classification explicitly. For context, target and restate the complete delivered definition unchanged with source_role:"context", its exact current user_requirement and occurrence where repeated. For requested behavior, preserve the definition and author the intended behavioral declaration and obligation associations instead. Context grants no behavioral coverage, implementation assurance or proof credit; preserve other declarations, associations and unmet residue.' });
    if (recipe.save_guidance !== undefined && diagnosis.code === 'definition_context_source_stale') {
      recipe.next_calls[0].arguments.reads.push({ subject: root(carrier), select: { field: 'sections.user_requirements' } });
    }
    return { recovery: recipe.limitation === undefined ? { status: incomplete ? 'awaiting_authored_meaning' : 'awaiting_source_classification' }
      : { ...recipe.limitation, stop: 'No supported contextual authoring is offered in this session or focused scope. Preserve the declaration and its source binding.' },
      ...(recipe.save_guidance === undefined ? {} : { save_guidance: recipe.save_guidance }), next_calls: recipe.next_calls };
  }
  if (diagnosis.code === 'definition_source_accounting_unavailable') return { recovery: {
    code: 'definition_source_accounting_unavailable',
    cause: 'A non-normative definition has no behavioral assertions to link. Its literal source association cannot establish whether the passage is contextual or contains an unaccounted requirement.',
    stop: 'Preserve the captured request, definition and existing associations. No supported source-accounting correction can classify this passage; do not fabricate obligations or unmet residue for preserved context.' }, next_calls: [] };
  if (diagnosis.code === 'requirement_obligation_association_missing') {
    if (diagnosis.subjects.some(subject => subject.target === undefined)) return { recovery: {
      code: 'requirement_target_unresolved',
      cause: 'The affected declaration has no unique available public target in the captured source.',
      stop: 'No association correction is offered. Preserve the declaration and its selection cause; do not choose by storage identity or position.' }, next_calls: [] };
    if (diagnosis.subjects.some(subject => !subject.assertions_available && subject.authored_state === 'complete')) {
      return { recovery: { code: 'obligation_association_unavailable',
        cause: 'The supported obligation authoring contract cannot select this complete declaration.',
        stop: 'No supported obligation association can account for this declaration. Preserve its authored meaning; do not invent an assertion or automatically turn it into residue.' }, next_calls: [] };
    }
    if (!diagnosis.subjects.every(subject => subject.assertions_available)) {
      const recipe = authoringRecipe(carrier, tier, { unit: root(carrier), members: ['requirements'],
        instruction: 'Complete the diagnosed declaration before associating it with an obligation. Preserve source passages, other requirements and intended associations.' });
      return { recovery: recipe.limitation ?? { status: 'awaiting_authored_meaning' },
        ...(recipe.save_guidance === undefined ? {} : { save_guidance: recipe.save_guidance }), next_calls: recipe.next_calls };
    }
    if (!canWrite(carrier) || carrier.focus != null) return { recovery: {
      code: !canWrite(carrier) ? 'authoring_not_authorized' : 'focused_save_unsupported',
      cause: !canWrite(carrier) ? 'This findings session can inspect the associations but cannot author them.'
        : 'save_record cannot amend this named focused contract; do not redirect it to the root.',
      stop: 'No supported association save is offered in this session.' }, next_calls: [] };
    const titles = diagnosis.correction_units.map(({ title }) => title);
    const distinguishOwners = titles.some((title, index) => titles.indexOf(title) !== index);
    return { recovery: { status: 'awaiting_obligation_choice',
      instruction: 'Choose the intended owning unit and saved or new obligation. Associate the delivered requirement target; a whole requirement selects all its assertions. Preserve existing claims, grouped subsets, explicit verification links, cases and unrelated obligations. Source association and obligation linkage establish no satisfaction or proof credit.',
      missing_choices: ['owning unit', 'saved obligation or new statement'],
      after_save: { when: 'Only when reassessment is requested; correction-only work may finish after save.',
        tool: 'workspace_assess_contract', arguments: assessmentAddress(carrier) } },
      next_calls: [...(distinguishOwners ? [{ tool: 'workspace_read_wiki', purpose: 'distinguish_obligation_owners',
        arguments: { reads: [{ subject: root(carrier), select: { inventory: 'slices' } }] } }] : []),
      ...diagnosis.correction_units.map(({ unit, title }) => ({ tool: 'workspace_read_wiki',
        purpose: 'choose_obligation_owner', unit, title, arguments: { reads: [{ subject: unit,
          select: { contract: 'obligations' }, for_changes: ['obligations'] }] } }))] };
  }
  const projected = projectAssessmentDiagnosis(carrier, diagnosis, clauses, tier);
  const authored = projected.recovery.authoring;
  const codes = [diagnosis.code, ...(diagnosis.reason_codes ?? [])];
  const pin = codes.includes('obligation_coverage_definition_integrity_mismatch');
  if (pin && canWrite(carrier) && carrier.focus == null) {
    const recovery = proofRefreshRecovery(carrier.unit);
    return { recovery: { instruction: 'Refresh only the saved pin when the exact selected definitions remain available and unchanged authored inputs remain compatible. Refresh selects and executes no proof.',
      then: recovery.then, after_save: { when: 'Only when reassessment is requested.',
        tool: 'workspace_assess_contract', arguments: assessmentAddress(carrier) } },
      next_calls: [{ ...recovery.read, purpose: 'current_correction_context' }] };
  }
  if (authored === undefined) return { recovery: { status: diagnosis.recovery_status ?? 'inspection_only',
    cause: projected.recovery.explanation ?? diagnosis.meaning,
    stop: 'This assessment establishes no supported authored correction for this cause.' }, next_calls: [] };
  const definitions = Object.values(authored.correction_definitions ?? {});
  if (definitions.length && definitions.every(correction => correction.limitation !== undefined)) return {
    recovery: { ...definitions[0].limitation,
      ...(definitions.length > 1 ? { affected_corrections: definitions.map(correction => correction.limitation) } : {}) }, next_calls: [] };
  const meaning = ['definition', 'specification_meaning'].includes(authored.purpose);
  const competition = diagnosis.subjects.some(subject => subject.association?.competitions?.length > 0);
  const missingCaseChain = diagnosis.code === 'obligation_coverage_authored_case_missing'
    && carrier.assessment.specification?.status === 'not_assessed';
  const compilation = recordAuthoringAvailability(tier).compile_requirements;
  if (missingCaseChain && !compilation) return { recovery: { code: 'authoring_operation_unavailable',
    subject: root(carrier), cause: 'The missing case depends on absent requirement and verification meaning. Requirement compilation is unavailable in this session.',
    stop: 'Authoring only a case cannot supply the missing requirement meaning.' }, next_calls: [] };
  const members = meaning ? ['requirements'] : authored.purpose === 'applicability' ? ['controlled_acceptance'] : ['obligations'];
  const restatesAssociations = competition || codes.includes('obligation_coverage_node_unknown') ||
    diagnosis.subjects.some(subject => subject.association?.condition === 'no_eligible_verification');
  const instruction = authored.purpose === 'applicability'
    ? 'Choose controlled_acceptance.disposition from the selected schema. This declaration supplies no missing requirements or evidence.'
    : meaning ? diagnosis.subjects.some(subject => subject.authored_identity_correction === true)
      ? 'Preserve authored behavior, source links and intended verification/case associations. Choose the existing-source identity correction or planned-functionality alternative; planned functionality needs no implementation symbol.'
      : 'Author the diagnosed typed meaning, preserving source links and intended verification/case associations.'
      : 'Correct only the diagnosed authored fields. Use the saved obligation id; derived native bindings are never authored.' +
        (restatesAssociations ? ' When restating associations, reuse the obligation read’s exact claims selections, preserving grouped subsets and explicit verifications. Unavailable membership requires the caller’s intended replacement, never an inferred empty set.' : '');
  const recipe = authoringRecipe(carrier, tier, { unit: authored.unit, members, instruction });
  if (recipe.limitation !== undefined) return { recovery: recipe.limitation,
    next_calls: ['definition', 'specification_meaning'].includes(diagnosis.family)
      ? [{ tool: 'workspace_read_wiki', arguments: { reads: [{ subject: root(carrier) }] }, purpose: 'inspect_required_meaning' }] : [] };
  const { status: _status, executable: _executable, unit: _unit, purpose: _purpose, scope: _scope,
    focus: _focus, obligation_id: _obligation, current_read: _read, save: _save,
    subjects: _subjects, grammar_guidance: grammar, discovery, ...meaningInputs } = authored;
  const calls = [...recipe.next_calls];
  if (diagnosis.code === 'obligation_coverage_node_unknown' || diagnosis.subjects.some(subject => subject.association?.condition === 'no_eligible_verification')) {
    calls.push({ tool: 'workspace_read_wiki', purpose: 'association_correction_choices', arguments: {
      reads: [{ subject: root(carrier), select: { contract: 'requirements', view: 'choices' } }] } });
  }
  if (diagnosis.code === 'obligation_coverage_authored_case_missing') {
    calls.push({ tool: 'workspace_read_wiki', purpose: 'case_verification_choices', arguments: {
      reads: [...new Set(diagnosis.subjects.map(subject => subject.obligation_id).filter(Boolean))].map(id => ({
        subject: carrier.unit, select: { contract: 'verifications', where: { kind: 'verification', requirement: { kind: 'requirement', obligation: id } } }
      })) } });
  }

  for (const call of [...(grammar ?? []), ...(discovery ?? [])]) {
    if (call != null) calls.push(call);
  }
  const targets = correctionSubjects(authored);
  return { recovery: { ...meaningInputs,
    ...(competition && !compilation ? { unavailable_alternatives: [{ when: 'different_tests',
      code: 'authoring_operation_unavailable', cause: 'Distinct verification meaning requires unavailable requirement compilation. Existing genuinely shared evidence remains a separate caller choice.' }] } : {}),
    ...(targets?.length ? { subjects: targets } : {}),
    ...(missingCaseChain ? { sequence: [
      'Author faithful requirements and independently authored verification meaning in the parent.',
      'Link this unit’s obligations to the returned requirement/verification identities and author the selected case.',
      'Read each write unit’s current revision before saving. A save supplies no execution or proof credit.' ] } : {}),
    ...((missingCaseChain || competition) && recordAuthoringAvailability(tier).compile_requirements
      ? { requirements_read: { tool: 'workspace_read_wiki', arguments: { reads: [{ subject: root(carrier), select: { context: true }, for_changes: ['requirements'] }] } } } : {}) },
    save_guidance: recipe.save_guidance, next_calls: calls };
}

export function assessmentIndependentGaps(carrier, tier) {
  const gaps = [];
  const add = (code, cause, unit, members, instruction, extra = {}) => {
    const recipe = authoringRecipe(carrier, tier, { unit, members, instruction });
    gaps.push({ code, cause, unit, ...extra,
      ...(recipe.limitation ? { recovery: recipe.limitation } : { save_guidance: recipe.save_guidance }),
      next_calls: recipe.next_calls });
  };
  for (const finding of carrier.diagnosis_inventory.unselectable_findings) {
    const code = finding.code;
    if (code === 'controlled_acceptance_disposition_missing') add(code, finding.reason, carrier.unit,
      ['controlled_acceptance'], 'Choose the disposition from the selected schema; assessment chooses and saves nothing.');
    else if (code === 'controlled_contract_requirements_missing') add(code, finding.reason, root(carrier),
      ['requirements'], 'Author the intended typed requirements, exact source passages and independent verification meaning.');
    else if (code === 'obligation_coverage_source_not_found') add(code, finding.reason, carrier.unit,
      ['obligations'], 'Author obligations linked to the intended requirements and verifications; choose the proof and its case explicitly.');
    else gaps.push({ code, cause: finding.reason, unit: carrier.unit,
      recovery: { stop: 'This source finding establishes no supported authored correction.' }, next_calls: [] });
  }
  const accounting = carrier.assessment.parent_source_accounting;
  if (accounting?.accounting_status === 'incomplete') {
    const guidance = requirementGuidanceRecoveryCall(['save_record_inputs', 'requirement_batch', 'source_link', 'repair'], tier);

    const bindingGaps = Object.fromEntries(Object.entries(accounting.recovery.saved_exception_binding_gaps ?? {})
      .filter(([kind]) => kind === 'grammar'));
    add('requirement_source_accounting_incomplete', accounting.recovery.missing, accounting.parent_unit,
      ['requirements'], accounting.recovery.instruction,
      { ...(Object.keys(bindingGaps).length === 0 ? {} : {
        saved_exception_binding_gaps: bindingGaps,
        exception_correction: 'Read the exception schema for the saved decision before reapplying its intended exact source passages; preserve rationale and scope.',
        exception_schemas: !canWrite(carrier) || carrier.focus != null ? []
          : Object.keys(bindingGaps)
            .filter(kind => kind !== 'grammar' || recordAuthoringAvailability(tier).grammar_exception)
            .map(kind => ({ calls_from: `current_correction_context response.contexts[${JSON.stringify(accounting.parent_unit)}].next_calls`,
              select: { input_contract: { tool: 'save_record', operation: 'exception', kind } } })) }) });
    if (guidance && gaps.at(-1).save_guidance) gaps.at(-1).next_calls.push(guidance);
  }
  const requirements = carrier.assessment.specification.requirement_accounting;
  if (requirements?.status === 'incomplete' && accounting?.accounting_status !== 'incomplete' &&
      !carrier.diagnosis_inventory.diagnoses.some(diagnosis =>
        ['requirement_obligation_association_missing', 'definition_source_accounting_unavailable',
          'definition_source_classification_missing', 'definition_context_source_stale'].includes(diagnosis.code))) {
    add('user_requirement_accounting_incomplete',
      'Some captured user requirements have neither an explicit obligation association nor source-bound residue. A whole-unit acceptance exemption does not state their unmet meaning.',
      requirements.unit, ['requirements'],
      'Preserve the captured request. Author its intended requirements and obligation associations, or explicitly record unmet residue with its reason and exact source_passages. No passage, obligation or residue is inferred.');
  }
  const coverage = carrier.assessment.acceptance_coverage;
  if (coverage?.correction != null) {
    const criteria = coverage.criterion_gaps;
    const removed = coverage.removed_criterion_associations ?? [];
    const associationChoice = criteria?.some(row => row.associations.length === 0 ||
      row.associations.some(link => link.association !== 'current')) || removed.length > 0;
    const facts = { ...(criteria === undefined ? {} : { criteria }),
      ...(removed.length ? { removed_criterion_associations: removed } : {}) };
    if (associationChoice) {
      add('acceptance_criterion_coverage_incomplete',
      'Listed criteria have missing or stale associations. Current links to invalid obligations need content correction, not reassociation.', carrier.unit,
      ['obligations'], 'Choose associations only for missing or stale links using the current criteria and intended obligation. ' +
        'Preserve current links; repair invalid obligation content through its returned diagnosis. Unavailable validity establishes no content correction.',
      facts);
      if (gaps.at(-1).save_guidance) gaps.at(-1).next_calls.push({ tool: 'workspace_read_wiki', purpose: 'criterion_association_choices', arguments: { reads: [
        { subject: carrier.unit, select: { contract: 'criteria' } },
        { subject: carrier.unit, select: { contract: 'obligations' } }
      ] } });
    } else {
      const unavailable = criteria?.some(row => row.associations.some(link => link.validity === 'unavailable'));
      const invalid = criteria?.some(row => row.associations.some(link => link.validity === 'invalid'));
      gaps.push({ code: 'acceptance_criterion_coverage_incomplete', unit: carrier.unit, ...facts,
      cause: criteria === undefined ? 'This retained assessment did not capture the cause of incomplete criterion coverage.'
        : `The listed criterion associations are current; ${invalid ? 'linked obligations have invalid authored content' : ''}` +
          `${invalid && unavailable ? ' and ' : ''}${unavailable ? 'linked obligation validity is unavailable' : ''}.`,
      recovery: { instruction: criteria === undefined
        ? 'No association correction is established by these retained facts. Inspect the original obligation diagnoses; do not infer a missing link.'
        : 'Preserve these associations. ' +
          (invalid ? 'Select the returned content diagnosis for the listed obligation to repair its actual defect. ' : '') +
          (unavailable ? 'Where validity is unavailable, retain that uncertainty and follow its specific cause; reassociation is not an established fix.' : '') }, next_calls: [] });
    }
  }
  return gaps;
}

export function shareAssessmentCorrectionCalls(selections) {
  const next_calls = [];
  for (const entry of selections) for (const call of entry.next_calls) {
    const read = call.purpose === 'current_correction_context' && call.arguments.reads?.length === 1
      ? call.arguments.reads[0] : null;
    const shared = read?.for_changes && next_calls.find(candidate => candidate.purpose === call.purpose &&
      candidate.arguments.reads?.length === 1 && candidate.arguments.reads[0].subject === read.subject &&
      isDeepStrictEqual(candidate.arguments.reads[0].select, read.select) && candidate.arguments.reads[0].for_changes);
    if (shared) {
      shared.arguments.reads[0].for_changes = [...new Set([...shared.arguments.reads[0].for_changes, ...read.for_changes])];
    } else if (!next_calls.some(candidate => isDeepStrictEqual(candidate, call))) next_calls.push(structuredClone(call));
  }
  const correction_contexts = {};
  const selected_diagnoses = selections.map(({ next_calls: calls, ...entry }) => {
    if (entry.save_guidance === undefined) return entry;
    const { unit, instruction, ...context } = entry.save_guidance;
    const requested = calls.find(call => call.purpose === 'current_correction_context' &&
      call.arguments.reads?.[0].subject === unit && call.arguments.reads[0].for_changes)?.arguments.reads[0];
    const shared = requested === undefined ? undefined : next_calls.find(call => call.purpose === 'current_correction_context' &&
      call.arguments.reads?.[0].subject === unit && isDeepStrictEqual(call.arguments.reads[0].select, requested.select));
    if (shared !== undefined) context.changes_schema_from = { ...context.changes_schema_from,
      select: { input_contract: { tool: 'save_record', members: shared.arguments.reads[0].for_changes } } };
    if (correction_contexts[unit] !== undefined && !isDeepStrictEqual(correction_contexts[unit], context)) {
      throw new TypeError('Selected assessment corrections disagree about their shared authoring context');
    }
    correction_contexts[unit] = context;
    return { ...entry, save_guidance: { unit, instruction } };
  });
  return { selected_diagnoses, ...(Object.keys(correction_contexts).length ? { correction_contexts } : {}), next_calls };
}
