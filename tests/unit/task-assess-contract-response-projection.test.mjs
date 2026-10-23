import { selectedAssessmentDiagnosis } from '../helpers/task-assess-contract-parity-witness.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { projectContractAssessmentResponse } from '../../packages/wiki-mcp/src/lib/task-assess-contract-response.mjs';
import { serveContractAssessmentResponse } from '../../packages/wiki-mcp/src/lib/task-assess-contract-response-calls.mjs';

function captured(diagnoses = [], extra = {}) {
  return { carrier: { unit: 'WK-9000', focus: null,
    source_authority: { role: 'orchestrator' }, selection: { scope: 'whole_unit', obligation_id: null },
    assessment: { authored: { status: 'valid' }, specification: { status: 'complete' }, owner_failures: [],
      acceptance_coverage: { status: 'complete', correction: null },
      parent_source_accounting: { accounting_status: 'complete' } },
    diagnosis_inventory: { diagnoses, public_subjects: Object.fromEntries(diagnoses.filter(row => row.family === 'authoring').map(row => [row.diagnostic_group_id, row.subjects])), corrections: {}, unselectable_findings: [],
      families: { authoring: { status: 'complete' }, semantic: { status: 'complete' } }, complete: true }, ...extra },
    original: { locator: { ref_id: 'assessmentA' } } };
}
const project = (read, original) => projectContractAssessmentResponse({ ...read, carrier: { ...read.carrier,
  diagnosis_inventory: { ...read.carrier.diagnosis_inventory,
    public_subjects: Object.fromEntries(read.carrier.diagnosis_inventory.diagnoses.filter(row => row.family === 'authoring')
      .map(row => [row.diagnostic_group_id, row.subjects])) } } },
  original ? { original } : { unit: read.carrier.unit }, { tier: 'paid_cce', responseEnv: {}, normalize: () => {} });
const diagnosis = (id, subject, extra = {}) => ({ diagnostic_group_id: `diagnostic-group-${id.toString(16).padStart(64, '0')}`,
  family: 'authoring', code: 'obligation_coverage_statement_missing', category: 'author_input', effect: 'blocking',
  meaning: 'Author an obligation statement.', subjects: [{ obligation_id: subject, field: 'statement' }], ...extra });

test('a complete assessment finishes without successful-check or retention inventories', () => {
  for (const status of ['complete', 'not_applicable']) {
    const read = captured();
    read.carrier.assessment.acceptance_coverage.status = status;
    assert.deepEqual(project(read), { unit: 'WK-9000', assessment: { authored: 'valid', specification: 'complete' }, next_calls: [] });
  }
});

test('criterion gaps repair associations only when they are actually missing or stale', () => {
  const criterion = { text: 'Preserve the selected property.' };
  for (const validity of ['invalid', 'unavailable']) {
    const read = captured([diagnosis(1, 'OBL-A')]);
    read.carrier.assessment.acceptance_coverage = { status: 'incomplete', correction: {},
      criterion_gaps: [{ criterion, associations: [{ obligation_id: 'OBL-A', association: 'current', validity }] }] };
    const gap = project(read).gaps[0];
    assert.deepEqual(gap.criteria, read.carrier.assessment.acceptance_coverage.criterion_gaps);
    assert.equal(gap.save_guidance, undefined);
    assert.deepEqual(gap.next_calls, []);
    assert.match(gap.recovery.instruction, /Preserve these associations/u);
    if (validity === 'invalid') assert.match(gap.recovery.instruction, /actual defect/u);
    else assert.doesNotMatch(gap.recovery.instruction, /repair.*defect/u);
    if (validity === 'unavailable') assert.match(gap.recovery.instruction, /unavailable.*uncertainty/u);
  }
  for (const associations of [[], [{ obligation_id: 'OBL-A', association: 'criterion_text_changed', validity: 'valid' }]]) {
    const read = captured();
    read.carrier.assessment.acceptance_coverage = { status: 'incomplete', correction: {}, criterion_gaps: [{ criterion, associations }] };
    const gap = project(read).gaps[0];
    assert.match(gap.save_guidance.instruction, /only for missing or stale links.*Preserve current links/u);
    assert.deepEqual(gap.save_guidance.after_save.arguments, { unit: 'WK-9000' });
  }
  const historical = captured();
  historical.carrier.assessment.acceptance_coverage = { status: 'incomplete', correction: {} };
  assert.match(project(historical).gaps[0].recovery.instruction, /No association correction is established/u);
});

test('large criterion cause populations use one complete retained inventory without truncation', () => {
  const read = captured([diagnosis(1, 'OBL-A')]);
  const rows = Array.from({ length: 40 }, (_, index) => ({ criterion: { text: `Property ${index} ${'preserve '.repeat(60)}` },
    associations: [{ obligation_id: 'OBL-A', association: 'current', validity: 'invalid' }] }));
  read.carrier.assessment.acceptance_coverage = { status: 'incomplete', correction: {}, criterion_gaps: rows };
  const summary = project(read);
  assert.equal(summary.gaps[0].criteria, undefined);
  assert.equal(summary.gaps[0].details_from, 'diagnostic_inventory');
  assert.deepEqual(summary.next_calls.map(call => call.purpose), ['diagnostic_inventory']);
  const original = project(read, summary.next_calls[0].arguments.original);
  assert.deepEqual(original.gaps[0].criteria, rows, 'every cause and subject remains in the explicit complete inventory');
});

test('unfinished-meaning choices distinguish identical text with different authored reasons', () => {
  const text = 'Preserve the intended experience.';
  const reasons = ['ambiguous_semantics', 'unresolved_context'];
  const diagnoses = reasons.map((reason, index) => diagnosis(index + 1, undefined, {
    family: 'specification_meaning', code: 'specification_meaning_unresolved',
    meaning: 'The owning unit still has unfinished specification meaning.',
    subjects: [{ subject: { kind: 'unresolved', match: { text, reason } }, text, reason }] }));
  const read = captured(diagnoses);
  read.carrier.assessment.specification.status = 'incomplete';
  const inventory = project(read, { source: read.original.locator, view: 'diagnoses' });
  assert.deepEqual(inventory.next_calls.map(call => call.subjects), diagnoses.map(row => row.subjects));
  assert.deepEqual(inventory.next_calls.map(call => call.subjects[0].reason), reasons);
  read.selected_diagnoses = diagnoses.map(row => ({ diagnosis_id: row.diagnostic_group_id, diagnosis: row, corrections: {} }));
  const selected = project(read, { source: read.original.locator });
  assert.deepEqual(selected.selected_diagnoses.map(row => row.diagnosis.subjects[0]), diagnoses.map(row => row.subjects[0]));
});

test('accounting distinguishes unmet residue and unknown obligation membership from satisfaction', () => {
  const read = captured();
  read.carrier.assessment.specification = { status: 'incomplete', requirement_accounting: {
    unit: read.carrier.unit, status: 'complete', obligation_coverage: 'partial', unmet_residue: true } };
  assert.deepEqual(project(read).assessment.requirement_accounting,
    { unit: read.carrier.unit, status: 'complete', obligation_coverage: 'partial', unmet_residue: true });
  const issue = { unit: read.carrier.unit, subject: { unit: read.carrier.unit, kind: 'obligation', id: 'OBL-A' },
    code: 'selection_unavailable', cause: 'The saved association does not resolve.', uncertainty: 'Complete membership is unestablished.' };
  Object.assign(read.carrier.assessment.specification.requirement_accounting,
    { status: 'unavailable', obligation_coverage: 'unavailable', unavailable_associations: [issue] });
  const unknown = project(read);
  assert.equal(unknown.assessment.requirement_accounting.obligation_coverage, 'unavailable');
  const { unit: _unit, ...affected } = issue;
  assert.deepEqual(unknown.unassessed[0].affected, [affected]);
  assert.deepEqual(unknown.unassessed[0].next_calls[0].arguments, { reads: [{ subject: read.carrier.unit,
    select: { contract: 'obligations', where: { kind: 'obligation', id: 'OBL-A' } } }] });
  read.carrier.assessment.specification = { status: 'complete', requirement_accounting: {
    unit: read.carrier.unit, status: 'unknown', obligation_coverage: 'unknown', unmet_residue: false } };
  assert.match(project(read).scope_limit, /No user requirements are recorded; coverage is unestablished/u);
});

test('unit exemption bindings are not offered as a requirement-accounting correction', () => {
  const read = captured();
  read.carrier.assessment.specification.status = 'incomplete';
  read.carrier.assessment.exceptions = { controlled_acceptance: { exempted: true, rationale: 'Documentation only.' } };
  read.carrier.assessment.parent_source_accounting = { accounting_status: 'incomplete', parent_unit: read.carrier.unit,
    recovery: { missing: 'Source requirements remain unaccounted.', instruction: 'Author explicit associations or unmet residue.',
      saved_exception_binding_gaps: { grammar: { without_passages: 1 }, controlled_acceptance: { without_passages: 1 } } } };
  const answer = project(read);
  assert.equal(answer.assessment.controlled_acceptance, 'exempted');
  assert.equal(answer.assessment.rationale, 'Documentation only.');
  const gap = answer.gaps.find(gap => gap.code === 'requirement_source_accounting_incomplete');
  assert.deepEqual(gap.saved_exception_binding_gaps, { grammar: { without_passages: 1 } });
  assert.deepEqual(gap.exception_schemas.map(call => call.select.input_contract.kind), ['grammar']);
});

test('unlinked requirement recovery preserves the caller choice of obligation owner and reader refusal', async () => {
  const target = { kind: 'requirement', match: { subject: { identity: { kind: 'profile_term', term: 'op' } } } };
  const d = diagnosis(99, undefined, { family: 'specification_meaning', code: 'requirement_obligation_association_missing',
    meaning: 'Not all assertions have explicit obligation associations.', subjects: [{ target,
      declaration: { user_requirement: 'The operation returns five.' }, assertions_available: true }],
    correction_units: [{ unit: 'WK-9000', title: 'Parent' }, { unit: 'WK-9000#SLICE-001', title: 'Caller slice' }] });
  const read = captured([d]);
  const choice = project(read).next_calls[0];
  assert.equal(choice.correction_scope, 'caller_selected_obligation_owner');
  assert.equal(choice.correction_unit, undefined);
  assert.deepEqual(choice.subjects[0].target, target);
  read.selected_diagnoses = [{ diagnosis_id: d.diagnostic_group_id, diagnosis: d, corrections: {} }];
  const detail = project(read, { source: read.original.locator });
  assert.equal(detail.selected_diagnoses[0].save_guidance, undefined);
  assert.deepEqual(detail.next_calls.map(call => [call.unit, call.arguments.reads[0].for_changes]),
    [['WK-9000', ['obligations']], ['WK-9000#SLICE-001', ['obligations']]]);
  assert.deepEqual(detail.selected_diagnoses[0].recovery.after_save.arguments, { unit: 'WK-9000' });
  d.correction_units.push({ unit: 'WK-9000#SLICE-002', title: 'Caller slice' });
  const repeated = project(read, { source: read.original.locator });
  assert.deepEqual(repeated.next_calls.find(call => call.purpose === 'distinguish_obligation_owners').arguments,
    { reads: [{ subject: 'WK-9000', select: { inventory: 'slices' } }] });
  const unavailable = await serveContractAssessmentResponse(detail, null);
  assert.equal(unavailable.selected_diagnoses[0].recovery.code, 'assessment_consumer_unavailable');
  assert.match(unavailable.selected_diagnoses[0].recovery.stop, /no association save/u);
  assert.deepEqual(unavailable.next_calls, []);
  read.carrier.source_authority.role = 'reviewer';
  const findings = project(read, { source: read.original.locator });
  assert.equal(findings.selected_diagnoses[0].recovery.code, 'authoring_not_authorized');
  assert.deepEqual(findings.next_calls, []);
  read.carrier.source_authority.role = 'orchestrator';
  const ambiguous = { ...d, subjects: [{ ...d.subjects[0], target: undefined,
    targeting: { status: 'ambiguous', issue: { code: 'selection_ambiguous', cause: 'Two declarations share this meaning.' } } }] };
  read.selected_diagnoses = [{ diagnosis_id: d.diagnostic_group_id, diagnosis: ambiguous, corrections: {} }];
  const unresolved = project(read, { source: read.original.locator });
  assert.equal(unresolved.selected_diagnoses[0].recovery.code, 'requirement_target_unresolved');
  assert.deepEqual(unresolved.selected_diagnoses[0].diagnosis.subjects[0].targeting, ambiguous.subjects[0].targeting);
  assert.deepEqual(unresolved.next_calls, []);
  const completeWithoutAssertions = { ...d, category: 'system_capability', subjects: [{ ...d.subjects[0],
    assertions_available: false, authored_state: 'complete' }] };
  read.selected_diagnoses = [{ diagnosis_id: d.diagnostic_group_id, diagnosis: completeWithoutAssertions, corrections: {} }];
  const unsupported = project(read, { source: read.original.locator });
  assert.equal(unsupported.selected_diagnoses[0].recovery.code, 'obligation_association_unavailable');
  assert.equal(unsupported.selected_diagnoses[0].save_guidance, undefined);
  assert.deepEqual(unsupported.next_calls, []);
});

test('definition source accounting states its representation boundary without behavioral authoring guidance', () => {
  const subject = { target: { kind: 'requirement', match: { subject: { identity: { kind: 'profile_term', term: 'retained-fact' } } } },
    declaration_role: 'definition', declaration: { definition: true, user_requirement: 'The prior batch was planning.' },
    assertions_available: false, authored_state: 'complete' };
  const d = diagnosis(100, undefined, { family: 'specification_meaning', category: 'system_capability',
    code: 'definition_source_accounting_unavailable', meaning: 'A definition supplies no classification of its source passage.', subjects: [subject] });
  const read = captured([d]);
  read.carrier.assessment.specification = { status: 'incomplete', requirement_accounting: {
    unit: read.carrier.unit, status: 'incomplete', obligation_coverage: 'none', unmet_residue: false } };
  const inventory = project(read);
  assert.deepEqual(inventory.next_calls[0].subjects[0], { target: subject.target, declaration_role: 'definition',
    user_requirement: subject.declaration.user_requirement, assertions_available: false, authored_state: 'complete' });
  assert.equal(inventory.gaps?.some(gap => gap.code === 'user_requirement_accounting_incomplete') ?? false, false,
    'a contextual classification limitation must not also prescribe invented obligations or residue');
  read.selected_diagnoses = [{ diagnosis_id: d.diagnostic_group_id, diagnosis: d, corrections: {} }];
  const detail = project(read, { source: read.original.locator });
  assert.deepEqual(detail.selected_diagnoses[0].diagnosis.subjects[0], subject);
  assert.equal(detail.selected_diagnoses[0].recovery.code, d.code);
  assert.match(detail.selected_diagnoses[0].recovery.stop, /do not fabricate obligations or unmet residue/u);
  assert.equal(detail.selected_diagnoses[0].save_guidance, undefined);
  assert.deepEqual(detail.next_calls, []);
  assert.equal(detail.assessment?.specification, undefined, 'a detail read does not invent a new verdict');
});

test('contextual accounting exposes its classification limit separately from unmet residue and obligation coverage', () => {
  const read = captured();
  read.carrier.assessment.specification.requirement_accounting = { unit: read.carrier.unit,
    status: 'complete', obligation_coverage: 'none', context_accounted: true, unmet_residue: false };
  const answer = project(read);
  assert.deepEqual(answer.assessment.requirement_accounting,
    { unit: read.carrier.unit, status: 'complete', obligation_coverage: 'none', context_accounted: true });
  assert.match(answer.scope_limit, /caller-classified.*no implementation assurance or proof credit/u);
  assert.deepEqual(answer.next_calls, [], 'contextual completion adds no compulsory read');
  Object.assign(read.carrier.assessment.specification, { status: 'incomplete' });
  read.carrier.assessment.specification.requirement_accounting.unmet_residue = true;
  assert.equal(project(read).assessment.requirement_accounting.unmet_residue, true);
  assert.equal(project(read).assessment.specification, 'incomplete');
});

test('context classification and stale binding recovery retain exact targets, current source and authoring boundaries', async () => {
  const subject = { target: { kind: 'requirement', match: { definition: true, subject: { identity: { kind: 'profile_term', term: 'retained' } } } },
    declaration_role: 'definition', declaration: { definition: true, user_requirement: 'Earlier activity was planning.' },
    assertions_available: false, authored_state: 'complete' };
  const d = diagnosis(101, undefined, { family: 'specification_meaning', category: 'author_input',
    code: 'definition_source_classification_missing', meaning: 'The source passage has no explicit classification.', subjects: [subject] });
  const read = captured([d]);
  read.selected_diagnoses = [{ diagnosis_id: d.diagnostic_group_id, diagnosis: d, corrections: {} }];
  let selected = project(read, { source: read.original.locator });
  assert.equal(selected.selected_diagnoses[0].recovery.status, 'awaiting_source_classification');
  assert.match(selected.selected_diagnoses[0].save_guidance.instruction, /Choose.*explicitly.*definition unchanged.*source_role:"context"/u);
  assert.deepEqual(selected.selected_diagnoses[0].diagnosis.subjects[0].target, subject.target);
  assert.deepEqual(selectedAssessmentDiagnosis(selected).save_guidance.after_save.arguments, { unit: read.carrier.unit });
  subject.authored_state = 'incomplete';
  const unfinished = project(read, { source: read.original.locator });
  assert.equal(unfinished.selected_diagnoses[0].recovery.status, 'awaiting_authored_meaning');
  assert.match(unfinished.selected_diagnoses[0].save_guidance.instruction, /Complete the unfinished definition.*choose missing meaning explicitly/u);
  subject.authored_state = 'complete';
  d.code = 'definition_context_source_stale'; subject.source_role = 'context';
  subject.source = { state: 'stale', user_requirement: subject.declaration.user_requirement };
  selected = project(read, { source: read.original.locator });
  assert.deepEqual(selected.next_calls[0].arguments.reads, [
    { subject: read.carrier.unit, select: { context: true }, for_changes: ['requirements'] },
    { subject: read.carrier.unit, select: { field: 'sections.user_requirements' } }]);
  const unavailable = await serveContractAssessmentResponse(selected, null);
  assert.equal(unavailable.selected_diagnoses[0].save_guidance, undefined);
  assert.equal(unavailable.selected_diagnoses[0].recovery.code, 'assessment_consumer_unavailable');
  read.carrier.source_authority.role = 'reviewer';
  const denied = project(read, { source: read.original.locator });
  assert.equal(denied.selected_diagnoses[0].recovery.code, 'authoring_not_authorized');
  assert.match(denied.selected_diagnoses[0].recovery.stop, /No supported contextual authoring/u);
  assert.deepEqual(denied.next_calls, []);
  read.carrier.source_authority.role = 'orchestrator'; read.carrier.focus = 'named';
  assert.equal(project(read, { source: read.original.locator }).selected_diagnoses[0].recovery.code, 'focused_save_unsupported');
  delete subject.target;
  const ambiguous = project(read, { source: read.original.locator });
  assert.equal(ambiguous.selected_diagnoses[0].recovery.code, 'requirement_target_unresolved');
  assert.deepEqual(ambiguous.next_calls, []);
});

test('the captured request-fidelity limit survives every public view without a workflow', () => {
  const read = captured([diagnosis(1, 'OBL-A')]);
  read.carrier.assessment.user_requirements_comparison = { requirements: 'recorded',
    advisory: 'private workflow text', read_call: { tool: 'obsolete-tool' } };
  const fresh = project(read);
  const inventory = project(read, { source: read.original.locator, view: 'diagnoses' });
  read.selected_diagnoses = [{ diagnosis_id: read.carrier.diagnosis_inventory.diagnoses[0].diagnostic_group_id,
    diagnosis: read.carrier.diagnosis_inventory.diagnoses[0], corrections: {} }];
  const selected = project(read, fresh.next_calls[0].arguments.original);
  const large = captured(Array.from({ length: 80 }, (_, index) => diagnosis(index, `OBL-${index}`)));
  large.carrier.assessment.user_requirements_comparison = read.carrier.assessment.user_requirements_comparison;
  const compact = project(large);
  assert.equal(compact.next_calls[0].purpose, 'diagnostic_inventory');
  const completeInventory = project(large, compact.next_calls[0].arguments.original);
  assert.equal(completeInventory.next_calls.length, 80);
  for (const body of [fresh, inventory, selected, compact, completeInventory]) {
    assert.equal(body.scope_limit, "Authored validity and specification completeness do not establish faithful coverage of the user's request.");
    assert.doesNotMatch(JSON.stringify(body), /private workflow|obsolete-tool|redteam|Before dispatch/u);
  }
  read.carrier.assessment.user_requirements_comparison.requirements = 'empty';
  assert.match(project(read).scope_limit, /coverage is unestablished/u);
});

test('chosen details isolate restrictions and failures, share correction context and retain original scope', async () => {
  const statement = diagnosis(1, 'OBL-A');
  const meaning = diagnosis(2, 'OBL-B', { family: 'specification_meaning', code: 'description_specification_unresolved',
    subjects: [{ obligation_id: 'OBL-B', text: 'Preserve the intended behavior.' }], recovery_status: 'authored_correction_available' });
  const read = captured([statement, meaning]);
  read.selected_diagnoses = [{ diagnosis_id: meaning.diagnostic_group_id, diagnosis: meaning, corrections: {} },
    { diagnosis_id: 'unknown', failure: { code: 'obligation_coverage_diagnostic_group_not_found',
      cause: 'This diagnosis is not retained.', failed_condition: 'diagnosis_unknown_in_complete_inventory',
      subject: { unit: read.carrier.unit }, next_calls: [] } },
    { diagnosis_id: statement.diagnostic_group_id, obligation_id: 'OBL-A', diagnosis: statement, corrections: {} }];
  const body = project(read, { source: read.original.locator });
  assert.deepEqual(body.selected_diagnoses.map(row => row.diagnosis_id), [meaning.diagnostic_group_id, 'unknown', statement.diagnostic_group_id]);
  assert.equal(body.selected_diagnoses[1].save_guidance, undefined);
  assert.deepEqual(body.next_calls.filter(call => call.purpose === 'current_correction_context').map(call => call.arguments), [
    { reads: [{ subject: read.carrier.unit, select: { context: true }, for_changes: ['requirements', 'obligations'] }] }]);
  for (const item of body.selected_diagnoses.map((_, index) => selectedAssessmentDiagnosis(body, index)).filter(row => !row.failure)) {
    assert.deepEqual(item.save_guidance.changes_schema_from.select.input_contract.members, ['requirements', 'obligations']);
    assert.deepEqual(item.save_guidance.after_save.arguments, { unit: read.carrier.unit });
  }
  assert.deepEqual(Object.keys(body.correction_contexts), [read.carrier.unit]);
  assert.equal(JSON.stringify(body).split('"revision_from"').length - 1, 1, 'shared authoring prerequisites appear once');
  const missingContext = structuredClone(body); delete missingContext.correction_contexts;
  assert.throws(() => selectedAssessmentDiagnosis(missingContext));
  const alteredContext = structuredClone(body); alteredContext.selected_diagnoses[0].save_guidance.unit = 'WK-OTHER';
  assert.throws(() => selectedAssessmentDiagnosis(alteredContext));
  const calls = [];
  const served = await serveContractAssessmentResponse(body, { contractFor: () => ({ acceptsArguments: async args => { calls.push(args); return true; } }) });
  assert.deepEqual(served, body);
  assert.equal(calls.filter(args => args.reads?.[0]?.for_changes).length, 1, 'one receiving context validation for the shared call');
});

test('a missing or rejecting receiving contract is an explicit stopping condition', async () => {
  const d = diagnosis(1, 'OBL-A');
  const read = captured([d]);
  read.selected_diagnoses = [{ diagnosis_id: d.diagnostic_group_id, diagnosis: d, corrections: {} }];
  const selected = project(read, { source: read.original.locator });
  for (const contracts of [null, { contractFor: () => ({ acceptsArguments: async () => false }) }]) {
    const served = await serveContractAssessmentResponse(selected, contracts);
    assert.equal(selectedAssessmentDiagnosis(served).save_guidance, undefined);
    assert.match(selectedAssessmentDiagnosis(served).recovery.code, /assessment_consumer_(unavailable|request_rejected)/);
    assert.deepEqual(served.next_calls, []);
    assert.equal(selectedAssessmentDiagnosis(served).diagnosis.meaning, d.meaning);
  }
  const calls = [];
  const served = await serveContractAssessmentResponse(selected, { contractFor: () => ({
    acceptsArguments: async args => { calls.push(args); return true; }
  }) });
  assert.deepEqual(served, selected);
  assert.deepEqual(calls, selected.next_calls.map(call => call.arguments));
});

test('a refused parent context leaves an independent slice correction available', async () => {
  const statement = diagnosis(1, 'OBL-A');
  const meaning = diagnosis(2, 'OBL-A', { family: 'specification_meaning', code: 'description_specification_unresolved',
    subjects: [{ obligation_id: 'OBL-A', text: 'Preserve the requested behavior.' }], recovery_status: 'authored_correction_available' });
  const read = captured([meaning, statement], { unit: 'WK-9000#SLICE-001',
    selection: { scope: 'selected_obligation', obligation_id: 'OBL-A' } });
  read.selected_diagnoses = [meaning, statement].map(diagnosis => ({ diagnosis_id: diagnosis.diagnostic_group_id, diagnosis, corrections: {} }));
  const projected = project(read, { source: read.original.locator });
  assert.deepEqual(Object.keys(projected.correction_contexts), ['WK-9000', read.carrier.unit]);
  const served = await serveContractAssessmentResponse(projected, { contractFor: () => ({ acceptsArguments: async args =>
    args.reads?.every(read => read.subject !== 'WK-9000') ?? true }) });
  assert.equal(served.selected_diagnoses[0].save_guidance, undefined);
  assert.equal(served.selected_diagnoses[0].recovery.code, 'assessment_consumer_request_rejected');
  assert.deepEqual(Object.keys(served.correction_contexts), [read.carrier.unit]);
  assert.deepEqual(selectedAssessmentDiagnosis(served, 1).save_guidance.after_save.arguments,
    { unit: read.carrier.unit, obligation_id: 'OBL-A' });
  assert.deepEqual(served.next_calls.filter(call => call.purpose === 'current_correction_context')
    .map(call => call.arguments.reads[0].subject), [read.carrier.unit]);
});

test('pin refresh context cannot replace a chosen meaning correction grammar', async () => {
  const pin = diagnosis(1, 'OBL-A', { code: 'obligation_coverage_definition_integrity_mismatch', category: 'canonical_source' });
  const meaning = diagnosis(2, 'OBL-A', { family: 'specification_meaning', code: 'description_specification_unresolved',
    subjects: [{ obligation_id: 'OBL-A', text: 'Preserve intended behavior.' }], recovery_status: 'authored_correction_available' });
  const read = captured([pin, meaning]);
  read.selected_diagnoses = [pin, meaning].map(diagnosis => ({ diagnosis_id: diagnosis.diagnostic_group_id, diagnosis, corrections: {} }));
  const projected = project(read, { source: read.original.locator });
  assert.deepEqual(projected.correction_contexts[read.carrier.unit].changes_schema_from.select.input_contract.members, ['requirements']);
  const served = await serveContractAssessmentResponse(projected, { contractFor: () => ({ acceptsArguments: async args =>
    !args.reads?.some(read => read.for_changes?.includes('refresh_proofs')) }) });
  assert.equal(served.selected_diagnoses[0].recovery.code, 'assessment_consumer_request_rejected');
  assert.ok(selectedAssessmentDiagnosis(served, 1).save_guidance);
  assert.deepEqual(served.next_calls.filter(call => call.purpose === 'current_correction_context')
    .map(call => call.arguments.reads[0].for_changes), [['requirements']]);
});

test('all choices retain their subject and deciding cause; large directories use one complete selection', () => {
  const read = captured([diagnosis(1, 'OBL-A'), diagnosis(2, 'OBL-B')]);
  const body = project(read);
  const choices = body.next_calls.filter(row => row.arguments.original?.diagnoses?.[0]?.diagnosis_id);
  assert.deepEqual(choices.map(row => row.subjects), [[{ obligation_id: 'OBL-A', field: 'statement' }], [{ obligation_id: 'OBL-B', field: 'statement' }]]);
  assert.ok(choices.every(row => row.cause === 'Author an obligation statement.' && row.correction_unit === read.carrier.unit));
  const selectSubject = (answer, subject) => {
    const matches = answer.next_calls.filter(row => row.subjects?.some(item => item.obligation_id === subject));
    assert.equal(matches.length, 1, 'subject selection requires one meaningful choice');
    return matches[0];
  };
  assert.equal(selectSubject(body, 'OBL-B'), choices[1]);
  assert.throws(() => selectSubject({ ...body, next_calls: choices.map(({ subjects, ...call }) => call) }, 'OBL-B'));
  const many = captured(Array.from({ length: 80 }, (_, index) => diagnosis(index, `OBL-${index}`)));
  const summary = project(many);
  assert.equal(summary.next_calls.length, 1);
  assert.equal(summary.next_calls[0].purpose, 'diagnostic_inventory');
  const inventory = project(many, summary.next_calls[0].arguments.original);
  assert.equal(inventory.next_calls.length, 80);
  assert.ok(inventory.next_calls.every(row => row.subjects.length === 1 && row.cause));
});

test('unavailable validity and independently established invalidity remain distinct in summaries and details', () => {
  const read = captured();
  read.carrier.assessment.authored.status = 'invalid';
  read.carrier.assessment.owner_failures.push({ responsible_owner: 'proof-authoring-executable-map',
    cause: { code: 'EIO' }, message: 'The selected validator could not read its provider.' });
  read.carrier.diagnosis_inventory.complete = false;
  assert.equal(project(read).assessment.authored, 'unavailable');
  read.carrier.diagnosis_inventory.diagnoses.push(diagnosis(1, 'OBL-A'));
  const summary = project(read);
  assert.equal(summary.assessment.authored, 'invalid');
  assert.match(summary.unassessed[0].cause, /could not read/);
  read.selected_diagnoses = [{ diagnosis_id: read.carrier.diagnosis_inventory.diagnoses[0].diagnostic_group_id,
    diagnosis: read.carrier.diagnosis_inventory.diagnoses[0], corrections: {} }];
  const detail = project(read, { source: read.original.locator });
  assert.equal(selectedAssessmentDiagnosis(detail).diagnosis.code, 'obligation_coverage_statement_missing');
  assert.deepEqual(detail.unassessed, summary.unassessed);
  assert.equal(JSON.stringify(detail).includes('"authored":"valid"'), false);
});

test('findings authority and focused limitations contain no save imperative or unserved preview', () => {
  for (const extra of [{ source_authority: { role: 'reviewer' } }, { focus: 'delivery' }]) {
    const d = diagnosis(1, 'OBL-A');
    const read = captured([d], extra);
    read.selected_diagnoses = [{ diagnosis_id: d.diagnostic_group_id, diagnosis: d, corrections: {} }];
    const detail = project(read, { source: read.original.locator });
    assert.equal(selectedAssessmentDiagnosis(detail).save_guidance, undefined);
    assert.match(selectedAssessmentDiagnosis(detail).recovery.code, /authoring_not_authorized|focused_save_unsupported/);
    assert.deepEqual(detail.next_calls, []);
    assert.equal(JSON.stringify(detail).includes('start_agent'), false);
  }
});

test('unknown membership cannot turn complete known declarations into a complete scoped specification', () => {
  const d = diagnosis(1, 'OBL-A', { code: 'obligation_coverage_node_unknown', meaning: 'A saved association does not resolve.' });
  for (const known of ['complete', 'incomplete']) {
    const read = captured([d]);
    read.carrier.assessment.authored.status = 'invalid';
    read.carrier.assessment.specification.status = known;
    const summary = project(read);
    assert.equal(summary.assessment.authored, 'invalid');
    assert.equal(summary.assessment.specification, known === 'complete' ? 'unavailable' : 'incomplete');
    assert.deepEqual(summary.unassessed[0].obligation_ids, ['OBL-A']);
    assert.match(summary.unassessed[0].cause, /saved association does not resolve/u);
    assert.deepEqual(project(read, { source: read.original.locator, view: 'diagnoses' }).unassessed, summary.unassessed);
    read.selected_diagnoses = [{ diagnosis_id: d.diagnostic_group_id, diagnosis: d, corrections: {} }];
    assert.deepEqual(project(read, { source: read.original.locator }).unassessed, summary.unassessed);
    assert.equal(read.carrier.assessment.specification.status, known, 'native classification is preserved');
  }
  assert.equal(project(captured([diagnosis(2, 'OBL-B')])).assessment.specification, 'complete',
    'an independent statement defect does not imply unavailable requirement membership');
});

test('selected recovery does not inherit unrelated criterion work and retains original reassessment scope', () => {
  const d = diagnosis(1, 'OBL-A');
  const read = captured([d], { unit: 'WK-9000#SLICE-001' });
  read.carrier.assessment.acceptance_coverage = { status: 'incomplete', correction: {} };
  read.selected_diagnoses = [{ diagnosis_id: d.diagnostic_group_id, diagnosis: d, corrections: {} }];
  const detail = project(read, { source: read.original.locator, diagnoses: [{ diagnosis_id: d.diagnostic_group_id, obligation_id: 'OBL-A' }] });
  assert.equal(selectedAssessmentDiagnosis(detail).save_guidance.criterion_coverage, undefined);
  assert.deepEqual(selectedAssessmentDiagnosis(detail).save_guidance.after_save.arguments,
    { unit: read.carrier.unit });
  read.carrier.selection = { scope: 'selected_obligation', obligation_id: 'OBL-A' };
  assert.deepEqual(selectedAssessmentDiagnosis(project(read, { source: read.original.locator })).save_guidance.after_save.arguments,
    { unit: read.carrier.unit, obligation_id: 'OBL-A' });
  assert.equal(detail.next_calls[0].arguments.reads[0].subject, read.carrier.unit);
  assert.equal(detail.next_calls[0].purpose, 'current_correction_context');
});

test('stale integrity pins use the existing root-only refresh form and disclose no pin digests', () => {
  const d = diagnosis(1, 'OBL-A', { code: 'obligation_coverage_definition_integrity_mismatch',
    category: 'canonical_source', meaning: 'The exact definition differs from the saved pin.',
    subjects: [{ obligation_id: 'OBL-A', field: 'definition_digest', expected: 'private-digest-a', actual: 'private-digest-b' }] });
  const read = captured([d], { unit: 'WK-9000#SLICE-001', selection: { scope: 'selected_obligation', obligation_id: 'OBL-A' } });
  assert.equal(project(read).next_calls[0].correction_unit, 'WK-9000', 'the menu and selected correction agree on the root owner');
  read.selected_diagnoses = [{ diagnosis_id: d.diagnostic_group_id, diagnosis: d, corrections: {} }];
  const selected = project(read, { source: read.original.locator });
  const recovery = selectedAssessmentDiagnosis(selected).recovery;
  assert.deepEqual(selected.next_calls[0].arguments, { reads: [{ subject: 'WK-9000', for_changes: ['refresh_proofs'] }] });
  assert.equal(recovery.then.executable, false);
  assert.deepEqual(recovery.then.known_arguments, { unit: 'WK-9000', changes: { refresh_proofs: true } });
  assert.deepEqual(recovery.then.missing_caller_input, ['revision']);
  assert.deepEqual(recovery.after_save.arguments, { unit: 'WK-9000#SLICE-001', obligation_id: 'OBL-A' });
  assert.equal(JSON.stringify(selected).includes('private-digest'), false);
  const retired = { ...d, code: 'proof_pack_exact_version_not_current' };
  read.selected_diagnoses = [{ diagnosis_id: retired.diagnostic_group_id, diagnosis: retired, corrections: {} }];
  assert.equal(selectedAssessmentDiagnosis(project(read, { source: read.original.locator })).recovery.then, undefined,
    'a retired exact version is not silently refreshed to a different selection');
});

test('missing requirements cannot become a case-only repair when compilation is unavailable', () => {
  const d = diagnosis(1, 'OBL-A', { code: 'obligation_coverage_authored_case_missing' });
  const read = captured([d]);
  read.carrier.assessment.specification.status = 'not_assessed';
  read.selected_diagnoses = [{ diagnosis_id: d.diagnostic_group_id, diagnosis: d, corrections: {} }];
  const body = projectContractAssessmentResponse(read, { original: { source: read.original.locator } },
    { tier: 'free_local', responseEnv: {}, normalize: () => {} });
  assert.equal(selectedAssessmentDiagnosis(body).recovery.code, 'authoring_operation_unavailable');
  assert.equal(selectedAssessmentDiagnosis(body).save_guidance, undefined);
  assert.deepEqual(body.next_calls, []);
});

test('large choice compaction preserves independent failures, corrections and historical qualification', () => {
  const read = captured(Array.from({ length: 80 }, (_, index) => diagnosis(index, `OBL-${index}`)));
  read.carrier.assessment.owner_failures = [{ responsible_owner: 'proof-authoring-executable-map',
    cause: { code: 'EIO' }, message: 'The validator provider could not be read.' }];
  read.carrier.diagnosis_inventory.unselectable_findings = [{ code: 'controlled_acceptance_disposition_missing',
    reason: 'The selected unit has no authored disposition.' }];
  read.source_revision_currentness = { state: 'changed' };
  const summary = project(read);
  assert.equal(summary.next_calls[0].purpose, 'diagnostic_inventory');
  assert.equal(summary.assessment.authored, 'invalid');
  assert.equal(summary.unassessed[0].code, 'EIO');
  assert.equal(summary.observation, 'historical_source_changed');
  const gap = summary.gaps[0];
  assert.equal(gap.code, 'controlled_acceptance_disposition_missing');
  assert.deepEqual(gap.next_calls[0].arguments, { reads: [{ subject: read.carrier.unit,
    select: { context: true }, for_changes: ['controlled_acceptance'] }] });
  assert.deepEqual(gap.save_guidance.after_save.arguments, { unit: read.carrier.unit });
  const inventory = project(read, summary.next_calls[0].arguments.original);
  assert.deepEqual(inventory.unassessed, summary.unassessed);
  assert.deepEqual(inventory.gaps, summary.gaps);
});

test('unfinished meaning choices expose the deciding text and selected reads ignore unrelated growth', () => {
  const unfinished = (id, text) => diagnosis(id, undefined, { family: 'specification_meaning',
    code: 'specification_meaning_unresolved', meaning: 'The parent still has unfinished meaning.',
    subjects: [{ id: `unresolved-${id}`, location: `requirements.unresolved[${id}]`, text,
      scope: 'whole_unit', unit: 'WK-9000' }] });
  const chosen = unfinished(1, 'Return five when the dependency is absent.');
  const read = captured([chosen, unfinished(2, 'Return nine when the dependency is available.')]);
  const selectByMeaning = response => {
    const matches = response.next_calls.filter(call => call.subjects?.some(subject => subject.text?.includes('is absent')));
    assert.equal(matches.length, 1, 'caller must distinguish unfinished meanings without opening dossiers');
    return matches[0];
  };
  const menu = project(read);
  const selectedCall = selectByMeaning(menu);
  assert.equal(selectedCall.arguments.original.diagnoses[0].diagnosis_id, chosen.diagnostic_group_id);
  assert.throws(() => selectByMeaning({ next_calls: menu.next_calls.map(call => ({ ...call,
    subjects: call.subjects.map(({ text, ...subject }) => subject) })) }));
  read.selected_diagnoses = [{ diagnosis_id: chosen.diagnostic_group_id, diagnosis: chosen, corrections: {} }];
  const focused = project(read, selectedCall.arguments.original);
  read.carrier.diagnosis_inventory.diagnoses.push(...Array.from({ length: 80 }, (_, index) =>
    unfinished(index + 3, `Unrelated behavior ${index}.`)));
  assert.deepEqual(project(read, selectedCall.arguments.original), focused);
});

test('foreign repository facts describe a scope limit without inventing an identity correction', () => {
  const d = diagnosis(1, 'OBL-A', { family: 'definition', category: 'canonical_source',
    code: 'description_repository_unavailable', meaning: 'Resolve the exact object in its owning repository.',
    subjects: [{ obligation_id: 'OBL-A', finding: { code: 'description_repository_unavailable',
      source: { code: 'description_repository_unavailable', repository: 'foreign/repository', bound_repository: 'bound/repository' } },
      object: { entity: { type_term: 'cc:runtime_component', identity: { kind: 'repository_path',
        repository: 'foreign/repository', path: 'dependency.mjs' } } } }] });
  const read = captured([d], { repository: 'bound/repository' });
  const choice = project(read).next_calls[0];
  assert.match(choice.cause, /foreign\/repository.*bound\/repository/);
  assert.equal(choice.correction_unit, undefined);
  read.selected_diagnoses = [{ diagnosis_id: d.diagnostic_group_id, diagnosis: d, corrections: {} }];
  const detail = project(read, choice.arguments.original);
  assert.equal(selectedAssessmentDiagnosis(detail).diagnosis.meaning, choice.cause);
  const facts = selectedAssessmentDiagnosis(detail).diagnosis;
  assert.equal(facts.subject_definitions[facts.subjects[0].definition_id].source_problem.repository, 'foreign/repository');
  assert.equal(selectedAssessmentDiagnosis(detail).recovery.status, 'repository_outside_assessment_scope');
  assert.equal(selectedAssessmentDiagnosis(detail).save_guidance, undefined);
  assert.deepEqual(detail.next_calls, []);
});

test('unavailable and ambiguous authored targets preserve meaning without an executable identity correction', () => {
  for (const status of ['ambiguous', 'unavailable']) {
    const d = diagnosis(1, 'OBL-A', { family: 'definition', category: 'canonical_source',
      code: 'description_symbol_missing', meaning: 'The selected declaration is absent.', subjects: [{
        obligation_id: 'OBL-A', authored_identity_correction: true,
        finding: { code: 'description_symbol_missing', source: { code: 'description_symbol_missing', path: 'source.mjs' } },
        object: { entity: { type_term: 'cc:operation', identity: { kind: 'code_symbol', repository: 'bound',
          path: 'source.mjs', symbol: 'missing' } } },
        requirements: [{ targeting: { status, issue: { code: `selection_${status}`,
          cause: `${status} authored target` } } }], uses: [], required_uses: []
      }] });
    const read = captured([d]);
    assert.equal(project(read).next_calls[0].recovery?.purpose, undefined,
      'an unavailable or ambiguous target does not advertise an executable identity repair');
    read.selected_diagnoses = [{ diagnosis_id: d.diagnostic_group_id, diagnosis: d, corrections: {} }];
    const selected = project(read, { source: read.original.locator });
    assert.equal(selectedAssessmentDiagnosis(selected).save_guidance, undefined);
    assert.equal(selectedAssessmentDiagnosis(selected).recovery.code, 'definition_target_unresolved');
    assert.equal(selectedAssessmentDiagnosis(selected).recovery.targeting[0].status, status);
    assert.deepEqual(selected.next_calls, []);
    assert.equal(selectedAssessmentDiagnosis(selected).diagnosis.meaning, 'The authored code symbol is absent from its captured source.');
    assert.equal(selectedAssessmentDiagnosis(selected).diagnosis.subject_definitions['definition-1'].entity.identity.path, 'source.mjs');
    assert.equal(selectedAssessmentDiagnosis(selected).diagnosis.code, d.code);
    assert.equal(JSON.stringify(selected).includes('row_id'), false);
  }
});

test('identity choices distinguish planned functionality from existing-source correction before detail', () => {
  for (const code of ['description_symbol_missing', 'description_source_missing', 'description_symbol_ambiguous']) {
    const entity = { type_term: 'cc:operation', identity: { kind: 'code_symbol', repository: 'bound',
      path: 'source.mjs', symbol: 'future' } };
    const d = diagnosis(1, 'OBL-A', { family: 'definition', category: 'canonical_source', code,
      subjects: [{ obligation_id: 'OBL-A', authored_identity_correction: true,
        finding: { code, source: { code, candidates: [] } }, object: { entity },
        requirements: [{ target: { kind: 'requirement', match: { subject: entity } },
          declaration: { subject: entity, modality: 'MAY', behavior: { relation: 'number:returns', objects: [{ number: 5 }] } } }],
        uses: [], required_uses: [{ required_meaning: 'subject', entity_type: entity.type_term }] }] });
    const read = captured([d]);
    const choice = project(read).next_calls[0];
    assert.equal(choice.recovery?.purpose, 'definition_identity_intent');
    assert.deepEqual(choice.recovery.alternatives.map(row => row.intent),
      ['correct_existing_source_reference', 'specify_new_functionality']);
    assert.match(choice.recovery.alternatives[1].instruction, /no implementation symbol is required/u);
    assert.equal(choice.subjects[0].requirements[0].declaration, undefined, 'the full declaration remains selected detail');
    read.selected_diagnoses = [{ diagnosis_id: d.diagnostic_group_id, diagnosis: d, corrections: {} }];
    const detail = project(read, choice.arguments.original);
    assert.match(selectedAssessmentDiagnosis(detail).recovery.required_authored_input[0], /caller.*existing.*planned/u);
    assert.match(selectedAssessmentDiagnosis(detail).save_guidance.instruction, /Preserve.*behavior/u);
    for (const extra of [{ focus: 'delivery' }, { source_authority: { role: 'reviewer' } }]) {
      const restricted = captured([d], extra);
      assert.equal(project(restricted).next_calls[0].recovery?.purpose, undefined);
    }
  }
});

test('retained diagnoses without public associations stop rather than exposing native identities', () => {
  const read = captured([diagnosis(1, 'OBL-A', { subjects: [{ obligation_id: 'OBL-A', node_id: 'private-compiler-node' }] })]);
  delete read.carrier.diagnosis_inventory.public_subjects;
  assert.throws(() => projectContractAssessmentResponse(read, { original: { source: read.original.locator } },
    { tier: 'paid_cce', responseEnv: {}, normalize: () => {} }), error => {
    assert.equal(error.code, 'assessment_authored_selection_unavailable');
    assert.deepEqual(error.details.subject, { unit: 'WK-9000', obligation_ids: ['OBL-A'] });
    assert.deepEqual(error.details.next_calls, []);
    assert.equal(error.details.effects.assessment, 'completed');
    assert.doesNotMatch(JSON.stringify(error.details), /private-compiler-node|node_id/u);
    return true;
  });
});

test('inventory shares equal complete subject meaning while retaining all associations and differences', () => {
  const entity = { type_term: 'cc:resource', identity: { kind: 'profile_term', term: 'requested-result' } };
  const requirement = { target: { kind: 'requirement', match: { subject: entity,
    behavior: { relation: 'reference:reads', objects: Array.from({ length: 7 }, (_, i) => ({ referent: {
      type_term: 'cc:resource', identity: { kind: 'profile_term', term: `resource-${i}` } } })) } } } };
  const shared = { object: { entity }, requirements: [requirement], uses: [{ target: requirement.target, path: ['subject'] }],
    finding: { code: 'description_definition_missing' }, required_uses: [{ required_meaning: 'object',
      applicability: { mode: 'unconditional', context: [] }, entity_type: entity.type_term }] };
  const population = count => Array.from({ length: count }, (_, i) => ({ obligation_id: `OBL-${i}`, ...structuredClone(shared) }));
  const capturedWith = subjects => captured([diagnosis(1, null, { family: 'definition',
    code: 'description_definition_missing', subjects })]);
  const read = capturedWith(population(7));
  const menu = project(read, { source: read.original.locator, view: 'diagnoses' });
  const choice = menu.next_calls[0];
  assert.equal(Object.keys(choice.subject_definitions).length, 1);
  assert.deepEqual(choice.subjects.map(subject => subject.obligation_id), population(7).map(subject => subject.obligation_id));
  assert.ok(choice.subjects.every(subject => Object.keys(subject).length === 2));
  const meaning = choice.subject_definitions[choice.subjects[0].definition_id];
  assert.deepEqual(meaning.entity, entity);
  assert.deepEqual(meaning.requirements, [requirement]);
  const larger = project(capturedWith(population(35)), { source: read.original.locator, view: 'diagnoses' });
  assert.equal(Object.keys(larger.next_calls[0].subject_definitions).length, 1);
  const bytes = value => Buffer.byteLength(JSON.stringify(value));
  assert.ok(bytes(larger) - bytes(menu) < 28 * 100, 'growth adds affected identities, not copies of the requirement meaning');
  for (const alter of [subject => { subject.required_uses[0].applicability.mode = 'unless'; },
    subject => { subject.finding.reason = 'independently unavailable meaning'; },
    subject => { subject.uses[0].path = ['behavior', 'objects', 0]; },
    subject => { subject.requirements[0].target.match.behavior.relation = 'reference:writes'; }]) {
    const subjects = population(7); alter(subjects[6]);
    const distinct = project(capturedWith(subjects), { source: read.original.locator, view: 'diagnoses' }).next_calls[0];
    assert.equal(Object.keys(distinct.subject_definitions).length, 2, 'unequal complete meaning is never collapsed');
    assert.notEqual(distinct.subjects[0].definition_id, distinct.subjects[6].definition_id);
  }
  read.selected_diagnoses = [{ diagnosis_id: read.carrier.diagnosis_inventory.diagnoses[0].diagnostic_group_id,
    diagnosis: read.carrier.diagnosis_inventory.diagnoses[0], corrections: {} }];
  const detail = project(read, choice.arguments.original);
  read.carrier.diagnosis_inventory.diagnoses.push(...Array.from({ length: 40 }, (_, i) => diagnosis(i + 2, `UNRELATED-${i}`)));
  assert.deepEqual(project(read, choice.arguments.original), detail, 'unrelated population growth leaves chosen detail unchanged');
  assert.equal(read.carrier.diagnosis_inventory.diagnoses[0].subjects.length, 7, 'projection never changes retained facts');
});

test('requirement sharing crosses choices without merging causes, uses or public selections', () => {
  const entity = term => ({ type_term: 'cc:resource', identity: { kind: 'profile_term', term } });
  const requirement = { target: { kind: 'requirement', match: { subject: entity('reader'),
    behavior: { relation: 'reference:reads', objects: [{ referent: entity('resource') }] } } } };
  const diagnoses = ['first', 'second'].map((term, index) => diagnosis(index + 1, null, { family: 'definition',
    code: index ? 'description_symbol_missing' : 'description_definition_missing',
    subjects: Array.from({ length: 7 }, (_, n) => ({ obligation_id: `OBL-${n}`, object: { entity: entity(term) },
      requirements: [structuredClone(requirement)], finding: { code: 'description_definition_missing' },
      required_uses: [{ required_meaning: 'object', applicability: { mode: index ? 'unless' : 'unconditional', context: [] } }] })) }));
  const read = captured(diagnoses);
  const body = project(read, { source: read.original.locator, view: 'diagnoses' });
  assert.equal(Object.keys(body.requirement_definitions).length, 1);
  assert.deepEqual(Object.values(body.requirement_definitions), [requirement]);
  assert.notEqual(body.next_calls[0].code, body.next_calls[1].code);
  for (const choice of body.next_calls) {
    assert.equal(choice.subjects.length, 7);
    assert.deepEqual(choice.subject_definitions['definition-1'].requirements, [{ definition_id: 'requirement-1' }]);
    assert.equal(choice.arguments.original.diagnoses[0].diagnosis_id, diagnoses[body.next_calls.indexOf(choice)].diagnostic_group_id);
  }
  const altered = structuredClone(diagnoses);
  altered[1].subjects.forEach(subject => { subject.requirements[0].target.match.behavior.relation = 'reference:writes'; });
  const distinct = project(captured(altered), { source: read.original.locator, view: 'diagnoses' });
  assert.equal(distinct.requirement_definitions, undefined, 'unique facts need no indirection');
  assert.deepEqual(distinct.next_calls.map(choice => choice.subject_definitions['definition-1'].requirements[0].target.match.behavior.relation),
    ['reference:reads', 'reference:writes'], 'different authored selections remain different facts');
  assert.deepEqual(diagnoses[0].subjects[0].requirements, [requirement], 'sharing never rewrites the retained source');
});

test('component constraints preserve supplied, absent and unavailable input without inventing a location', () => {
  for (const current of [{ state: 'absent' }, { state: 'supplied', value: { type_term: 'cc:runtime_component',
    identity: { kind: 'profile_term', term: 'describes a module' } } },
  { state: 'unavailable', cause: 'The saved component association cannot be resolved.' }]) {
    const component_requirement = { field: 'obligations[].case.component',
      identity: { kind: 'repository_path', required: ['repository', 'path'] },
      reason: 'A profile_term names no module source.', current };
    const d = diagnosis(1, 'OBL-A', { code: 'obligation_coverage_native_binding_case_incomplete',
      subjects: [{ obligation_id: 'OBL-A', case_id: 'case-a', corrections: ['component'], component_requirement }] });
    const read = captured([d]);
    const choice = project(read).next_calls[0];
    assert.deepEqual(choice.subjects[0].component_requirement, component_requirement);
    read.selected_diagnoses = [{ diagnosis_id: d.diagnostic_group_id, diagnosis: d,
      corrections: { component: { field: component_requirement.field } } }];
    const selected = project(read, choice.arguments.original);
    assert.deepEqual(selectedAssessmentDiagnosis(selected).diagnosis.subjects[0].component_requirement, component_requirement);
    assert.equal(selectedAssessmentDiagnosis(selected).recovery.subjects, undefined, 'no repeated missing-field representation contradicts the actual input');
    assert.equal(JSON.stringify(selected).includes('"repository":"'), false, 'the caller still chooses the actual repository and path');
  }
});
