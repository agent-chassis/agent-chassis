import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRequirementAuthoringGuidance, requirementGuidanceDetailNavigation } from
  '../../packages/wiki-mcp/src/lib/requirement-authoring-guidance.mjs';
import { assertDiagnosisChoiceMeaning } from '../helpers/task-assess-contract-parity-witness.mjs';

const inputsPath = ['save_record_inputs'];
const batchPath = [...inputsPath, 'requirement_batch'];

test('saved row instructions distinguish requirement rows, single claims and other saved rows', () => {
  const inputs = resolveRequirementAuthoringGuidance(inputsPath).value;
  assert.doesNotMatch(inputs.labels, /an existing row states id/u);
  assert.match(inputs.labels, /saved requirement row.*row_id/u);
  assert.match(inputs.labels, /grouped.*incomplete/u);
  assert.match(inputs.labels, /single.claim.*id/u);
  assert.match(inputs.labels, /obligation.*id/u);
  assert.match(inputs.requirement_batch.row_addressing.row_id, /complete restatement/u);
  assert.match(inputs.requirement_batch.row_addressing.id, /one of several.*row_id/u);
});

test('default authoring delivers common work and explicitly selects complete specialized jobs', () => {
  const inputs = resolveRequirementAuthoringGuidance(inputsPath).value;
  const batch = resolveRequirementAuthoringGuidance(batchPath).value;
  assert.equal(Object.hasOwn(inputs, 'slice_coverage'), false);
  for (const common of [inputs.requirement_batch, batch]) {
    assert.equal(Object.hasOwn(common, 'correction'), false);
    assert.equal(Object.hasOwn(common.source_link, 'repair'), false);
    assert.ok(common.row_addressing && common.source_link.matching && common.generated);
  }
  const paths = [[...batchPath, 'correction'], [...batchPath, 'source_link', 'repair'], [...inputsPath, 'slice_coverage']];
  const offered = requirementGuidanceDetailNavigation(inputsPath);
  for (const path of paths) {
    const descriptor = offered.find(call => JSON.stringify(call.selection.guidance) === JSON.stringify(path));
    assert.ok(descriptor, `discoverable specialized job: ${path}`);
    assert.notEqual(descriptor.recommended, true);
    assert.ok(descriptor.information, 'intent is distinguishable before selecting');
    assert.equal(resolveRequirementAuthoringGuidance(path).ok, true);
  }
  const correction = resolveRequirementAuthoringGuidance(paths[0]).value;
  assert.match(correction, /dependent use refuses the entire save/u);
  assert.match(correction, /Explicitly amend existing dependencies/u);
  const repair = resolveRequirementAuthoringGuidance(paths[1]).value;
  assert.match(repair.intent, /complete row restatement/u);
  assert.match(repair.limit, /report that exact gap/u);
  assert.equal(resolveRequirementAuthoringGuidance(paths[2]).value.steps.length, 5);
});

test('specialized selections preserve permission limits and reject unknown paths', () => {
  for (const path of [[...batchPath, 'correction'], [...batchPath, 'source_link', 'repair'], [...inputsPath, 'slice_coverage']]) {
    const unavailable = resolveRequirementAuthoringGuidance(path, 'free_local');
    assert.equal(unavailable.ok, false);
    assert.equal(unavailable.code, 'record_authoring_operation_unavailable');
    assert.equal(unavailable.changed, false);
  }
  assert.equal(resolveRequirementAuthoringGuidance([...batchPath, 'invented_repair']).ok, false);
});

test('semantic choice labels discriminate cause and recovery rather than mere callability', () => {
  const source = { ref_id: 'selected-original' };
  const selected = { original: { source }, selected_diagnosis: { diagnosis_id: 'diagnosis-a',
    subjects_in_original_diagnosis: 2, diagnosis: { family: 'semantic',
      reason_codes: ['controlled_contract_cross_owner_mandatory_claim_unmapped'],
      recovery_status: 'inspection_only', recovery: {} } } };
  const call = { tool: 'workspace_assess_contract', arguments: { original: { source, diagnosis_id: 'diagnosis-a' } },
    family: 'semantic', subjects: 2, information: 'inspection only: cross owner mandatory claim unmapped' };
  assertDiagnosisChoiceMeaning(call, selected);
  assert.throws(() => assertDiagnosisChoiceMeaning({ ...call,
    information: 'inspection only: missing proof or evidence' }, selected), /selected owner cause/u);
  assert.throws(() => assertDiagnosisChoiceMeaning({ ...call,
    information: 'authored correction available: cross owner mandatory claim unmapped' }, selected), /distinguished before opening/u);
  assert.throws(() => assertDiagnosisChoiceMeaning({ ...call, subjects: 1 }, selected));
});
