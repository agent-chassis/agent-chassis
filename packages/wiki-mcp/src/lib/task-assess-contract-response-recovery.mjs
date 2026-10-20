

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
    if (subject.missing_authored_input === undefined) return [];
    return [{ ...(subject.obligation_id === undefined ? {} : { obligation_id: subject.obligation_id }),
      ...(subject.case_id === undefined ? {} : { case_id: subject.case_id }),
      missing_authored_input: subject.missing_authored_input }];
  });
}

export function selectedAssessmentRecovery(carrier, diagnosis, clauses, tier) {
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
    : meaning ? 'Author the diagnosed typed meaning, preserving source links and intended verification/case associations.'
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
    add('requirement_source_accounting_incomplete', accounting.recovery.missing, accounting.parent_unit,
      ['requirements'], accounting.recovery.instruction,
      { ...(accounting.recovery.saved_exception_binding_gaps === undefined ? {} : {
        saved_exception_binding_gaps: accounting.recovery.saved_exception_binding_gaps,
        exception_correction: 'Read the exception schema for the saved decision before reapplying its intended exact source passages; preserve rationale and scope.',
        exception_schemas: !canWrite(carrier) || carrier.focus != null ? []
          : Object.keys(accounting.recovery.saved_exception_binding_gaps)
            .filter(kind => kind !== 'grammar' || recordAuthoringAvailability(tier).grammar_exception)
            .map(kind => ({ calls_from: `current_correction_context response.contexts[${JSON.stringify(accounting.parent_unit)}].next_calls`,
              select: { input_contract: { tool: 'save_record', operation: 'exception', kind } } })) }) });
    if (guidance && gaps.at(-1).save_guidance) gaps.at(-1).next_calls.push(guidance);
  }
  const coverage = carrier.assessment.acceptance_coverage;
  if (coverage?.correction != null) add('acceptance_criterion_coverage_incomplete',
    'Some declared criteria lack a valid obligation association, or an association is stale.', carrier.unit,
    ['obligations'], 'Choose the intended criterion associations; repairing them supplies no missing obligation meaning.',
    { meaning_selection: { tool: 'workspace_read_wiki', arguments: { reads: [{ subject: carrier.unit, select: { contract: 'coverage' } }] } } });
  return gaps;
}
