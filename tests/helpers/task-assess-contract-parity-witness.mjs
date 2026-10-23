import assert from 'node:assert/strict';

export async function assertAssessmentOriginalParity({ saved, fresh, assessment, results, state, counts }) {
  const retained = await results().original({ source: saved.assessment_original.source });
  assert.deepEqual([retained.original.revision, retained.source_revision_currentness,
    retained.assessment_context_currentness, retained.carrier.diagnosis_inventory.population.obligation_ids],
  [saved.revision, { state: 'current' }, 'not_observed', state.source.content.obligations.map(row => row.obligation_id)]);
  const standaloneRetained = await results().original({ source: fresh.original.source });
  assert.deepEqual(retained.carrier, standaloneRetained.carrier, 'the complete captured facts and diagnoses agree');
  const original = (await assessment.prepare({ original: { source: saved.assessment_original.source } })).body;
  const standaloneOriginal = (await assessment.prepare({ original: { source: fresh.original.source } })).body;
  assert.deepEqual(original.assessment, standaloneOriginal.assessment, 'complete public originals agree');
  assert.deepEqual([original.assessment.content_digest, standaloneOriginal.assessment.content_digest],
    [saved.revision, saved.revision]);
  const authored = original.assessment.authored;
  assert.deepEqual([authored.status, authored.obligations, authored.valid, authored.invalid], counts);
  assert.deepEqual(original.assessment.execution, { status: 'not_started', proofs_executed: 0, credit_granted: 0 });
  const full = retained.carrier.assessment.diagnostics;
  assert.deepEqual([full.issues_returned, full.issues_omitted], [full.issues.length, 0]);
  assert.equal(original.assessment.diagnostics.issues_omitted, full.issues.length);
  for (const summary of [saved.assessment, fresh.assessment]) {
    const diagnostics = summary.diagnostics;
    assert.equal(diagnostics.issues_returned, diagnostics.issues.length);
    assert.equal(diagnostics.issues_returned + diagnostics.issues_omitted, full.issues_returned);
    assert.deepEqual([diagnostics.authoring_groups, diagnostics.semantic_groups], [full.authoring_groups, full.semantic_groups]);

    for (const { meaning, ...issue } of diagnostics.issues) {
      const complete = full.issues.find(row => row.diagnosis_id === issue.diagnosis_id);
      assert.ok(complete, 'every summary issue is captured in the complete original');
      const { meaning: fullMeaning, ...completeIssue } = complete;
      assert.deepEqual(issue, completeIssue);
      assert.deepEqual(diagnostics.meanings[meaning], full.meanings[fullMeaning]);
    }
  }
  return { retained, original };
}

export function assertAssessmentIssueSubset(summary, complete) {
  assert.equal(summary.issues_returned + summary.issues_omitted, complete.issues_returned + complete.issues_omitted);
  for (const { meaning, ...issue } of summary.issues) {
    const row = complete.issues.find(candidate => candidate.diagnosis_id === issue.diagnosis_id &&
      JSON.stringify(complete.meanings[candidate.meaning]) === JSON.stringify(summary.meanings[meaning]));
    assert.ok(row, 'each admitted issue retains its identity and native meaning');
    const { meaning: _meaning, ...facts } = row;
    assert.deepEqual(facts, issue);
  }
}

export const diagnosisNavigation = body => body.next_calls.filter(call => call.arguments.original?.diagnoses?.[0]?.diagnosis_id)
  .map(call => {
    const subjects = call.subject_definitions === undefined ? call.subjects
      : call.subjects.map(({ definition_id, ...association }) => {
        assert.ok(call.subject_definitions[definition_id], 'shared subject meaning is necessary for this choice');
        return { ...association, ...call.subject_definitions[definition_id] };
      });
    return { ...call, subjects: subjects.map(subject => ({ ...subject,
      ...(subject.requirements === undefined ? {} : { requirements: subject.requirements.map(row => {
      if (row.definition_id === undefined) return row;
      assert.ok(body.requirement_definitions?.[row.definition_id], 'shared requirement meaning is necessary for this choice');
      return body.requirement_definitions[row.definition_id];
      }) }) })), diagnosis_id: call.arguments.original.diagnoses[0].diagnosis_id };
  });

export function assessmentSource(body) {
  const source = body.next_calls.find(call => call.arguments.original?.source)?.arguments.original.source;
  assert.ok(source?.ref_id, 'the response must issue a source before historical selection');
  return source;
}

export function selectAssessmentDiagnoses(calls) {
  assert.ok(calls.length > 0, 'choose at least one issued diagnosis');
  const { tool, arguments: { original: { source } } } = calls[0];
  for (const call of calls) {
    assert.equal(call.tool, tool);
    assert.deepEqual(call.arguments.original.source, source, 'selected diagnoses must share an exact retained source');
    assert.ok(call.arguments.original.diagnoses?.length);
  }
  return { tool, arguments: { original: { source, diagnoses: calls.flatMap(call => call.arguments.original.diagnoses) } } };
}

export async function readAssessmentChoices(body, follow) {
  const inventory = body.next_calls.find(call => call.purpose === 'diagnostic_inventory');
  return inventory ? follow(inventory) : body;
}

export function assertDiagnosisMenuMeaning(body) {
  const calls = diagnosisNavigation(body);
  const meanings = calls.map(({ cause, family, code, category, subjects, correction_unit, recovery }) =>
    JSON.stringify({ cause, family, code, category, subjects, correction_unit, recovery }));
  assert.equal(new Set(meanings).size, calls.length, 'diagnosis_menu_indistinguishable');
  assert.equal(new Set(calls.map(call => call.diagnosis_id)).size, calls.length);
  for (const call of calls) assert.ok(call.cause && call.subjects, 'each choice states its cause and selected subjects');
  return calls;
}

export function selectedAssessmentDiagnosis(body, index = 0) {
  if (body.selected_diagnoses === undefined) return undefined;
  const item = body.selected_diagnoses[index];
  if (item.save_guidance === undefined) return item;
  const context = body.correction_contexts?.[item.save_guidance.unit];
  assert.ok(context, 'selected save guidance requires its shared correction context');
  return { ...item, save_guidance: { ...item.save_guidance, ...context } };
}

export function assertDiagnosisChoiceMeaning(call, selected, index = 0) {
  const item = selectedAssessmentDiagnosis(selected, index), diagnosis = item.diagnosis;
  assert.equal(call.arguments.original.diagnoses[0].diagnosis_id, item.diagnosis_id);
  assert.equal(call.family, diagnosis.family);
  assert.equal(call.code, diagnosis.code);
  assert.equal(call.cause, diagnosis.meaning);
  assert.equal(selected.original, undefined, 'retention bookkeeping stays internal');
  if (item.save_guidance) {
    assert.equal(item.save_guidance.unit, call.correction_unit);
    assert.ok(selected.next_calls.some(next => next.purpose === 'current_correction_context'));
  } else {
    assert.ok(item.recovery?.stop || item.recovery?.instruction || item.recovery?.cause,
      'uncorrectable causes retain their precise limitation');
    if (selected.selected_diagnoses.length === 1) assert.equal(selected.next_calls.some(call => call.purpose === 'current_correction_context'), false);
  }
}

export const REMOVED_DIAGNOSTIC_BOOKKEEPING = Object.freeze(["authoring_occurrence_effects", "semantic_logical_cause_recovery",
  "issue_selection_basis"]);
export function assertProjectedDiagnostics(diagnostics, label) {
  for (const removed of REMOVED_DIAGNOSTIC_BOOKKEEPING) assert.equal(Object.hasOwn(diagnostics, removed), false, `${label}: ${removed}`);
  assert.ok(Number.isInteger(diagnostics.authoring_groups) && Number.isInteger(diagnostics.semantic_groups), label);
  assert.deepEqual([diagnostics.issues_returned, diagnostics.subjects_included], [diagnostics.issues.length, false], label);

  for (const issue of diagnostics.issues) {
    const meaning = diagnostics.meanings[issue.meaning];
    if (typeof meaning.code === "string") {
      for (const fact of ["effect", "stage", "route", "category"]) assert.equal(typeof meaning[fact], "string", `${label}: ${fact}`);
    } else {
      assert.ok(Array.isArray(meaning.reason_codes) && typeof meaning.recovery === "string", `${label}: ${JSON.stringify(meaning)}`);
    }
    assert.equal(typeof meaning.reason, "string", label);
  }
}

const definitionReads = new WeakMap();
export async function readDefinitionDiagnoses(body, follow) {
  if (!definitionReads.has(body)) definitionReads.set(body, (async () => {
    const calls = diagnosisNavigation(await readAssessmentChoices(body, follow)).filter(row => row.family === 'definition');
    if (calls.length === 0) return [];
    const selected = await follow(selectAssessmentDiagnoses(calls));
    for (const [index, call] of calls.entries()) assertDiagnosisChoiceMeaning(call, selected, index);
    return selected.selected_diagnoses.map((_, index) => selectedAssessmentDiagnosis(selected, index));
  })());
  return definitionReads.get(body);
}
export async function readDefinitionIssues(body, follow) {
  return (await readDefinitionDiagnoses(body, follow)).flatMap(({ diagnosis_id, diagnosis }) =>
    Object.entries(diagnosis.subject_definitions).map(([id, facts]) => ({ ...facts, diagnosis_id, category: diagnosis.category,
      obligation_ids: diagnosis.subjects.filter(row => row.definition_id === id && row.obligation_id !== undefined).map(row => row.obligation_id) })));
}
