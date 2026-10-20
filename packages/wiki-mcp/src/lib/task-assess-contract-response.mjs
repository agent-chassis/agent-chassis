

import { distillCapturedCauses } from './dispatch-tool-helpers.mjs';
import { isDeepStrictEqual } from 'node:util';
import { ControlledContractToolError } from '@agent-chassis/wiki-core/src/lib/controlled-contract-tools.mjs';
import { capturedDiagnosisNavigation } from '@agent-chassis/wiki-core/src/operations/controlled-contract/proof-authoring-diagnostic-projection.mjs';
import { measureMcpInlineResultBytes } from './mcp-response.mjs';
import { selectedResponseDeliveryBound } from './selected-response-snapshot.mjs';
import { assessmentAddress, assessmentIndependentGaps, selectedAssessmentRecovery } from './task-assess-contract-response-recovery.mjs';
import { projectAssessmentDiagnosis } from './task-assess-contract-corrections.mjs';

const call = arguments_ => ({ tool: 'workspace_assess_contract', arguments: arguments_ });
const parentMeaning = diagnosis => ['definition', 'specification_meaning'].includes(diagnosis.family);
const unitFor = (carrier, diagnosis) => parentMeaning(diagnosis)
  || diagnosis.code === 'obligation_coverage_definition_integrity_mismatch' ? carrier.unit.split('#')[0] : carrier.unit;
const pick = (value, names) => Object.fromEntries(names.filter(name => value[name] !== undefined).map(name => [name, value[name]]));

function subjects(diagnosis, detail) {
  return diagnosis.subjects.map(subject => {
    const pin = diagnosis.code === 'obligation_coverage_definition_integrity_mismatch';
    if (!detail) return { ...pick(subject, ['obligation_id', 'case_id', 'id', 'location',
      ...(pin ? [] : ['field', 'parameter'])]),
      ...(subject.object?.entity ? { entity: subject.object.entity } : {}),
      ...(subject.requirements === undefined ? {} : { requirements: subject.requirements.map(({ declaration: _declaration, ...target }) => target) }),
      ...(subject.verification === undefined ? {} : { verification: subject.verification.map(({ meaning: _meaning, ...target }) => target) }),
      ...(diagnosis.family === 'specification_meaning' && subject.text !== undefined ? { text: subject.text } : {}),
      ...(subject.required_uses?.length ? { required_uses: subject.required_uses } : {}),
      ...(subject.evidence?.proof_name ? { proof_name: subject.evidence.proof_name } : {}) };
    const { owner_diagnostics: _checks, failed_fields: _fields, authored_identity_correction: _identity,
      corrections: _clauses, row_id: _rowId, finding, object, ...facts } = subject;
    const { expected: _expected, actual: _actual, field: _field, ...pinSubject } = facts;
    return { ...(pin ? pinSubject : facts),
      ...(finding === undefined ? {} : { finding: pick(finding, ['code', 'reason', 'recovery', 'path', 'expected', 'actual']),
        ...(finding.source === undefined ? {} : { source_problem: pick(finding.source, ['code', 'repository', 'bound_repository', 'path', 'symbol', 'candidates', 'message']) }) }),
      ...(object === undefined ? {} : { entity: object.entity }) };
  });
}

function sourceCause(diagnosis) {
  if (diagnosis.family !== 'definition') return diagnosis.meaning;
  if (diagnosis.code === 'description_symbol_missing') return 'The authored code symbol is absent from its captured source.';
  if (diagnosis.code === 'description_source_missing') return 'The authored source path is absent from the captured committed source.';
  if (diagnosis.code === 'description_symbol_ambiguous') return 'The authored code symbol matches several captured declarations.';
  return diagnosis.meaning;
}

function scope(carrier) { return assessmentAddress(carrier); }

function retentionProblem(failure) {
  return { code: failure.cause_code, failed_operation: 'retain_assessment_detail',
    cause_chain: distillCapturedCauses({ value: failure.cause.envelope?.cause_diagnostic ?? failure.cause }),
    effects: { assessment: 'completed', detail: 'unavailable', canonical_written: false, proofs_executed: false },
    stop: 'The assessment completed, but its selected detail could not be retained. No detail call is available; do not repeat assessment to recreate it.' };
}

function repositoryLimit(carrier, diagnosis) {
  const mismatches = [...new Map(diagnosis.subjects.filter(subject =>
    subject.finding?.source?.code === 'description_repository_unavailable')
    .map(subject => [JSON.stringify([subject.finding.source.repository, subject.finding.source.bound_repository]), subject.finding.source])).values()];
  return mismatches.length
    ? `${mismatches.map(source => `The authored reference names ${source.repository}; source resolution is bound to ${source.bound_repository}.`).join(' ')} Whether the identity is mistaken or intentional remains a caller choice.`
    : null;

}

export function assessmentAuthoredValidity(carrier) {
  const assessment = carrier.assessment;
  const ownerFailed = (assessment.owner_failures ?? []).some(failure => failure.responsible_owner === 'proof-authoring-executable-map')
    || carrier.diagnosis_inventory.diagnoses.some(diagnosis => diagnosis.family === 'authoring'
      && (['canonical_source', 'system_capability'].includes(diagnosis.category) || diagnosis.stage === 'system_capability')
      && ['blocking', 'unresolved'].includes(diagnosis.effect));
  const authored = assessment.selected?.authored ?? assessment.authored.status;
  if (!ownerFailed) return authored;
  const established = carrier.diagnosis_inventory.diagnoses.some(diagnosis => diagnosis.family === 'authoring'
    && diagnosis.category === 'author_input');
  return established ? 'invalid' : 'unavailable';
}
const validity = assessmentAuthoredValidity;

function unavailableMembership(carrier) {
  return [...new Set(carrier.diagnosis_inventory.diagnoses.filter(diagnosis => diagnosis.family === 'authoring' &&
    [diagnosis.code, ...(diagnosis.reason_codes ?? [])].includes('obligation_coverage_node_unknown'))
    .flatMap(diagnosis => diagnosis.subjects.map(subject => subject.obligation_id).filter(Boolean)))];
}

function assessmentSummary(carrier) {
  const a = carrier.assessment;
  return { authored: validity(carrier), specification: a.specification.status === 'complete' && unavailableMembership(carrier).length
    ? 'unavailable' : a.specification.status,
    ...(a.acceptance_coverage?.status && !['complete', 'not_applicable'].includes(a.acceptance_coverage.status)
      ? { criterion_coverage: a.acceptance_coverage.status } : {}),
    ...(carrier.selection.scope === 'selected_obligation' ? { whole_unit_assessed: false } : {}),
    ...(a.exceptions?.controlled_acceptance?.exempted ? { controlled_acceptance: 'exempted',
      rationale: a.exceptions.controlled_acceptance.rationale, rationale_assessment: 'not_performed' } : {}) };
}

function selectionFacts(carrier, diagnosis) {
  const repository = repositoryLimit(carrier, diagnosis);
  const authored = diagnosis.category === 'author_input' || diagnosis.recovery_status === 'authored_correction_available'
    || diagnosis.code === 'obligation_coverage_definition_integrity_mismatch'
    || diagnosis.subjects.some(subject => subject.authored_identity_correction || subject.discovery_input)
    || diagnosis.reason_codes?.includes('controlled_acceptance_disposition_missing');
  return { ...pick(diagnosis, ['code', 'family', 'category', 'gap_class', 'reason_codes']),
    cause: repository ?? sourceCause(diagnosis),
    ...(authored ? { correction_unit: unitFor(carrier, diagnosis) }
      : { recovery: { status: diagnosis.recovery_status ?? 'unavailable',
        stop: 'This assessment establishes no supported authored correction.' } }),
    subjects: subjects(diagnosis, false) };
}

function unavailableFacts(carrier) {
  const membership = unavailableMembership(carrier);
  return [...(carrier.assessment.owner_failures ?? []).map(failure => ({
    assessment: failure.responsible_owner === 'contract-requirement-descriptions' ? 'requirement meaning'
      : failure.responsible_owner === 'proof-authoring-executable-map' ? 'proof input validity' : 'semantic validity',
    code: failure.cause.code, cause: failure.message,
    stop: 'This part of validity remains unestablished. Changing authored proof inputs is not an established recovery.' })),
    ...(membership.length ? [{ assessment: 'requirement membership', code: 'obligation_coverage_node_unknown',
      obligation_ids: membership,
      cause: 'A saved association does not resolve; the complete requirement membership of these obligations remains unassessed.',
      correction: 'Choose the intended replacement through the association diagnosis; unknown membership is neither empty nor complete.' }] : [])];
}

export function projectContractAssessmentResponse(read, request, { tier, responseEnv, normalize }) {
  const native = read.carrier;
  const projectedDiagnosis = diagnosis => {
    const publicSubjects = native.diagnosis_inventory.public_subjects?.[diagnosis.diagnostic_group_id];
    if (diagnosis.family === 'authoring' && publicSubjects === undefined) throw new ControlledContractToolError(
      'assessment_authored_selection_unavailable', 'This retained diagnosis has no captured public authored-subject projection.', {
        subject: { unit: native.unit, obligation_ids: [...new Set(diagnosis.subjects.map(subject => subject.obligation_id).filter(Boolean))] },
        effects: { assessment: 'completed', canonical_written: false, proofs_executed: false },
        stop: 'The retained authored associations cannot be established through the current public contract. No native identities or guessed current replacements are offered.',
        next_calls: [] });
    return publicSubjects === undefined ? diagnosis : { ...diagnosis, subjects: request.original?.obligation_id === undefined
      ? publicSubjects : publicSubjects.filter(subject => subject.obligation_id === request.original.obligation_id) };
  };
  const carrier = { ...native, diagnosis_inventory: { ...native.diagnosis_inventory,
    diagnoses: native.diagnosis_inventory.diagnoses.map(projectedDiagnosis) } };
  if (request.original !== undefined) normalize(request, carrier);
  const source = read.original.locator;
  const inventoryCall = source === null ? null : { ...call({ original: { source, view: 'diagnoses' } }), purpose: 'diagnostic_inventory' };
  const body = { ...scope(carrier) };
  const failures = unavailableFacts(carrier);
  if (failures.length) body.unassessed = failures;
  if (read.source_revision_currentness?.state === 'changed') body.observation = 'historical_source_changed';
  else if (read.source_revision_currentness?.state === 'unavailable') body.observation = {
    status: 'currentness_unavailable', cause: read.source_revision_currentness.cause };
  if (read.selected_diagnosis !== undefined) {
    const selected = { ...read.selected_diagnosis, diagnosis: projectedDiagnosis(read.selected_diagnosis.diagnosis) };
    const selectedCarrier = request.original.obligation_id === undefined ? carrier : { ...carrier,
      selection: { ...carrier.selection, obligation_id: request.original.obligation_id } };
    const recovery = selectedAssessmentRecovery(selectedCarrier, selected.diagnosis, selected.corrections, tier);
    const { next_calls: next, ...guidance } = recovery;
    const repository = repositoryLimit(selectedCarrier, selected.diagnosis);
    const projected = projectAssessmentDiagnosis(selectedCarrier, selected.diagnosis, selected.corrections, tier);
    const facts = projected.subject_definitions === undefined ? { subjects: subjects(selected.diagnosis, true) }
      : { subjects: projected.subjects, subject_definitions: Object.fromEntries(Object.entries(projected.subject_definitions)
        .map(([id, definition]) => [id, subjects({ subjects: [definition] }, true)[0]])) };
    return { ...body, ...(validity(carrier) === 'unavailable' ? { assessment: assessmentSummary(carrier) } : {}),
      selected_diagnosis: { diagnosis_id: selected.diagnosis_id,
      diagnosis: { ...pick(selected.diagnosis, ['code', 'family', 'category', 'gap_class', 'reason_codes']),
        meaning: repository ?? sourceCause(selected.diagnosis), ...facts }, ...guidance,
        ...(repository && guidance.save_guidance === undefined ? { recovery: {
          status: 'repository_outside_assessment_scope',
          stop: 'This source owner establishes no supported authored identity correction or cross-repository resolution call. Preserve intentional foreign references; do not infer a typo from this limit.' } } : {}) }, next_calls: next };
  }
  body.assessment = assessmentSummary(carrier);
  const gaps = assessmentIndependentGaps(carrier, tier);
  if (gaps.length) body.gaps = gaps;
  const navigation = capturedDiagnosisNavigation(carrier.diagnosis_inventory, { detailed: true, issuesOnly: true });
  const choices = [];
  for (const row of navigation) {
    const diagnosis = carrier.diagnosis_inventory.diagnoses.find(entry => entry.diagnostic_group_id === row.diagnosis_id);
    const facts = selectionFacts(carrier, diagnosis);

    if (choices.some(choice => isDeepStrictEqual(choice.facts, facts)
      && isDeepStrictEqual(choice.diagnosis.subjects, diagnosis.subjects))) continue;
    choices.push({ facts, diagnosis, next: source === null ? null : {
      ...call({ original: { source, diagnosis_id: row.diagnosis_id } }), ...facts } });
  }
  if (source === null) {
    if (choices.length) body.problems = choices.map(({ facts }) => facts);
    body.detail_unavailable = retentionProblem(read.original.retention_failure);
  }
  const next = choices.flatMap(choice => choice.next === null ? [] : [choice.next]);

  const answer = { ...body, next_calls: next };
  if (request.original?.view === 'diagnoses') return answer;
  const limit = selectedResponseDeliveryBound(responseEnv);
  if (measureMcpInlineResultBytes(answer) <= limit) return answer;
  if (inventoryCall !== null) {
    const compact = { ...body,
      detail: 'Read the complete causes and correction choices.', next_calls: [inventoryCall] };
    if (measureMcpInlineResultBytes(compact) <= limit) return compact;
  }
  throw new ControlledContractToolError('proof_validation_answer_exceeds_compact_class',
    'The scoped assessment cannot be delivered within the compact class.', { changed: false,
      subject: scope(carrier), ...(read.original.retention_failure === undefined ? {} : {
        failure: retentionProblem(read.original.retention_failure) }),
      next_calls: inventoryCall === null ? [] : [inventoryCall] });
}
