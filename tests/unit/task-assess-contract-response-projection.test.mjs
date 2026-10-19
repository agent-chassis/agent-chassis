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
    diagnosis_inventory: { diagnoses, corrections: {}, unselectable_findings: [],
      families: { authoring: { status: 'complete' }, semantic: { status: 'complete' } }, complete: true }, ...extra },
    original: { locator: { ref_id: 'assessmentA' } } };
}
const project = (read, original) => projectContractAssessmentResponse(read,
  original ? { original } : { unit: read.carrier.unit }, { tier: 'paid_cce', responseEnv: {}, normalize: () => {} });
const diagnosis = (id, subject, extra = {}) => ({ diagnostic_group_id: `diagnostic-group-${id.toString(16).padStart(64, '0')}`,
  family: 'authoring', code: 'obligation_coverage_statement_missing', category: 'author_input', effect: 'blocking',
  meaning: 'Author an obligation statement.', subjects: [{ obligation_id: subject, field: 'statement' }], ...extra });

test('a complete assessment finishes without successful-check or retention inventories', () => {
  assert.deepEqual(project(captured()), { unit: 'WK-9000', assessment: { authored: 'valid', specification: 'complete' }, next_calls: [] });
});

test('a missing or rejecting receiving contract is an explicit stopping condition', async () => {
  const d = diagnosis(1, 'OBL-A');
  const read = captured([d]);
  read.selected_diagnosis = { diagnosis_id: d.diagnostic_group_id, diagnosis: d, corrections: {} };
  const selected = project(read, { source: read.original.locator });
  for (const contracts of [null, { contractFor: () => ({ acceptsArguments: async () => false }) }]) {
    const served = await serveContractAssessmentResponse(selected, contracts);
    assert.equal(served.selected_diagnosis.save_guidance, undefined);
    assert.match(served.selected_diagnosis.recovery.code, /assessment_consumer_(unavailable|request_rejected)/);
    assert.deepEqual(served.next_calls, []);
    assert.equal(served.selected_diagnosis.diagnosis.meaning, d.meaning);
  }
  const calls = [];
  const served = await serveContractAssessmentResponse(selected, { contractFor: () => ({
    acceptsArguments: async args => { calls.push(args); return true; }
  }) });
  assert.deepEqual(served, selected);
  assert.deepEqual(calls, selected.next_calls.map(call => call.arguments));
});

test('all choices retain their subject and deciding cause; large directories use one complete selection', () => {
  const read = captured([diagnosis(1, 'OBL-A'), diagnosis(2, 'OBL-B')]);
  const body = project(read);
  const choices = body.next_calls.filter(row => row.arguments.original?.diagnosis_id);
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
  read.selected_diagnosis = { diagnosis_id: read.carrier.diagnosis_inventory.diagnoses[0].diagnostic_group_id,
    diagnosis: read.carrier.diagnosis_inventory.diagnoses[0], corrections: {} };
  const detail = project(read, { source: read.original.locator });
  assert.equal(detail.selected_diagnosis.diagnosis.code, 'obligation_coverage_statement_missing');
  assert.deepEqual(detail.unassessed, summary.unassessed);
  assert.equal(JSON.stringify(detail).includes('"authored":"valid"'), false);
});

test('findings authority and focused limitations contain no save imperative or unserved preview', () => {
  for (const extra of [{ source_authority: { role: 'reviewer' } }, { focus: 'delivery' }]) {
    const d = diagnosis(1, 'OBL-A');
    const read = captured([d], extra);
    read.selected_diagnosis = { diagnosis_id: d.diagnostic_group_id, diagnosis: d, corrections: {} };
    const detail = project(read, { source: read.original.locator });
    assert.equal(detail.selected_diagnosis.save_guidance, undefined);
    assert.match(detail.selected_diagnosis.recovery.code, /authoring_not_authorized|focused_save_unsupported/);
    assert.deepEqual(detail.next_calls, []);
    assert.equal(JSON.stringify(detail).includes('start_agent'), false);
  }
});

test('selected recovery does not inherit unrelated criterion work and retains original reassessment scope', () => {
  const d = diagnosis(1, 'OBL-A');
  const read = captured([d], { unit: 'WK-9000#SLICE-001' });
  read.carrier.assessment.acceptance_coverage = { status: 'incomplete', correction: {} };
  read.selected_diagnosis = { diagnosis_id: d.diagnostic_group_id, diagnosis: d, corrections: {} };
  const detail = project(read, { source: read.original.locator, obligation_id: 'OBL-A' });
  assert.equal(detail.selected_diagnosis.save_guidance.criterion_coverage, undefined);
  assert.deepEqual(detail.selected_diagnosis.save_guidance.after_save.arguments,
    { unit: read.carrier.unit, obligation_id: 'OBL-A' });
  assert.equal(detail.next_calls[0].arguments.subject, read.carrier.unit);
  assert.equal(detail.next_calls[0].purpose, 'current_correction_context');
});

test('stale integrity pins use the existing root-only refresh form and disclose no pin digests', () => {
  const d = diagnosis(1, 'OBL-A', { code: 'obligation_coverage_definition_integrity_mismatch',
    category: 'canonical_source', meaning: 'The exact definition differs from the saved pin.',
    subjects: [{ obligation_id: 'OBL-A', field: 'definition_digest', expected: 'private-digest-a', actual: 'private-digest-b' }] });
  const read = captured([d], { unit: 'WK-9000#SLICE-001', selection: { scope: 'selected_obligation', obligation_id: 'OBL-A' } });
  assert.equal(project(read).next_calls[0].correction_unit, 'WK-9000', 'the menu and selected correction agree on the root owner');
  read.selected_diagnosis = { diagnosis_id: d.diagnostic_group_id, diagnosis: d, corrections: {} };
  const selected = project(read, { source: read.original.locator });
  const recovery = selected.selected_diagnosis.recovery;
  assert.deepEqual(selected.next_calls[0].arguments, { subject: 'WK-9000' });
  assert.equal(recovery.then.executable, false);
  assert.deepEqual(recovery.then.known_arguments, { unit: 'WK-9000', changes: { refresh_proofs: true } });
  assert.deepEqual(recovery.then.missing_caller_input, ['revision']);
  assert.deepEqual(recovery.after_save.arguments, { unit: 'WK-9000#SLICE-001', obligation_id: 'OBL-A' });
  assert.equal(JSON.stringify(selected).includes('private-digest'), false);
  const retired = { ...d, code: 'proof_pack_exact_version_not_current' };
  read.selected_diagnosis = { diagnosis_id: retired.diagnostic_group_id, diagnosis: retired, corrections: {} };
  assert.equal(project(read, { source: read.original.locator }).selected_diagnosis.recovery.then, undefined,
    'a retired exact version is not silently refreshed to a different selection');
});

test('missing requirements cannot become a case-only repair when compilation is unavailable', () => {
  const d = diagnosis(1, 'OBL-A', { code: 'obligation_coverage_authored_case_missing' });
  const read = captured([d]);
  read.carrier.assessment.specification.status = 'not_assessed';
  read.selected_diagnosis = { diagnosis_id: d.diagnostic_group_id, diagnosis: d, corrections: {} };
  const body = projectContractAssessmentResponse(read, { original: { source: read.original.locator } },
    { tier: 'free_local', responseEnv: {}, normalize: () => {} });
  assert.equal(body.selected_diagnosis.recovery.code, 'authoring_operation_unavailable');
  assert.equal(body.selected_diagnosis.save_guidance, undefined);
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
  assert.deepEqual(gap.next_calls[0].arguments, { subject: read.carrier.unit,
    select: { context: true, for_changes: ['controlled_acceptance'] } });
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
  assert.equal(selectedCall.arguments.original.diagnosis_id, chosen.diagnostic_group_id);
  assert.throws(() => selectByMeaning({ next_calls: menu.next_calls.map(call => ({ ...call,
    subjects: call.subjects.map(({ text, ...subject }) => subject) })) }));
  read.selected_diagnosis = { diagnosis_id: chosen.diagnostic_group_id, diagnosis: chosen, corrections: {} };
  const focused = project(read, selectedCall.arguments.original);
  read.carrier.diagnosis_inventory.diagnoses.push(...Array.from({ length: 80 }, (_, index) =>
    unfinished(index + 3, `Unrelated behavior ${index}.`)));
  assert.deepEqual(project(read, selectedCall.arguments.original), focused);
});

test('foreign repository facts describe a scope limit without inventing an identity correction', () => {
  const d = diagnosis(1, 'OBL-A', { family: 'definition', category: 'canonical_source',
    code: 'description_repository_unavailable', meaning: 'Resolve the exact object in its owning repository.',
    subjects: [{ obligation_id: 'OBL-A', finding: { code: 'description_repository_unavailable',
      source: { code: 'description_repository_unavailable', repository: 'foreign/repository' } },
      object: { entity: { type_term: 'cc:runtime_component', identity: { kind: 'repository_path',
        repository: 'foreign/repository', path: 'dependency.mjs' } } } }] });
  const read = captured([d], { repository: 'bound/repository' });
  const choice = project(read).next_calls[0];
  assert.match(choice.cause, /foreign\/repository.*bound\/repository/);
  assert.equal(choice.correction_unit, undefined);
  read.selected_diagnosis = { diagnosis_id: d.diagnostic_group_id, diagnosis: d, corrections: {} };
  const detail = project(read, choice.arguments.original);
  assert.equal(detail.selected_diagnosis.diagnosis.meaning, choice.cause);
  const facts = detail.selected_diagnosis.diagnosis;
  assert.equal(facts.subject_definitions[facts.subjects[0].definition_id].source_problem.repository, 'foreign/repository');
  assert.equal(detail.selected_diagnosis.recovery.status, 'repository_outside_assessment_scope');
  assert.equal(detail.selected_diagnosis.save_guidance, undefined);
  assert.deepEqual(detail.next_calls, []);
});
