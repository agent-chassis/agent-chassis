

import test from "node:test";
import assert from "node:assert/strict";

import { accountRequirementSourceResidual, compactRequirementSourceAccounting } from
  "../../packages/wiki-core/src/operations/controlled-contract/contract-requirement-source-links.mjs";
import { describeRequirementSourceLink, requirementSourceDigest, resolveRequirementSourceLink } from
  "../../packages/wiki-core/src/operations/controlled-contract/contract-requirement-source-links.mjs";

const WK = "WK-0001";

const row = (id, currentText, linkedIn, passage, occurrence) => ({ row_id: id,
  source: describeRequirementSourceLink(passage === undefined ? null : resolveRequirementSourceLink({ wkId: WK,
    text: linkedIn, passage, occurrence, field: "changes.requirements.requirements[0]" }), currentText) });
const account = (text, ...rows) => accountRequirementSourceResidual({ rows }, text);
const segments = facts => facts.unmapped.segments.map(({ start, end, text, whitespace_only: blank }) => [start, end, text, blank]);

test('incomplete compact accounting names missing associations and public guidance without supplying meaning', () => {
  const compact = text => compactRequirementSourceAccounting({ scope: 'parent_work_record', parent_unit: WK, ...account(text) });
  const facts = compact('Caller source prose.');
  assert.deepEqual([facts.measurement_performed, facts.accounting_status, facts.accounted_length, facts.remaining_length],
    [true, 'incomplete', 0, 'Caller source prose.'.length]);
  assert.deepEqual(facts.correction, { tool: 'workspace_read_wiki', arguments: { reads: [{ subject: WK,
    select: { field: 'sections.user_requirements' }, for_changes: ['requirements'] }] } });
  assert.match(facts.recovery.missing, /Current exact associations.*original source passages.*caller-authored requirements/u);
  assert.deepEqual(facts.recovery.guidance.map(row => row.tool), Array(3).fill('workspace_read_wiki'));
  assert.deepEqual(facts.recovery.guidance[0].arguments.reads[0].subject.topic, ['save_record_inputs', 'requirement_batch', 'source_link']);
  assert.match(facts.link_meaning, /criterion coverage, execution capability.*proof credit/u);
  assert.doesNotMatch(JSON.stringify(facts.recovery), /opt.out|"exception"|"changes"|user_requirement_occurrence/u);
  assert.equal(compact(null).recovery, undefined);
  assert.equal(compact('  ').recovery, undefined);
});

test("text no current link covers is returned exactly as saved, and linked text is covered once", () => {
  const text = "  Alpha beta gamma.\n\tDelta  epsilon ";
  const facts = account(text, row("r1", text, text, "Alpha beta"), row("r2", text, text, "beta gamma"),
    row("r3", text, text, "beta"), row("r4", text, text, "Delta"), row("r5", text, text));
  assert.deepEqual([facts.measurement_performed, facts.accounting_status, facts.source_field, facts.source],
    [true, "incomplete", "sections.user_requirements",
      { digest: requirementSourceDigest(text), length: text.length, unit: "utf16_code_units" }]);
  for (const old of ['state', 'accounted']) assert.equal(Object.hasOwn(facts, old), false);

  assert.deepEqual(facts.links, { current: 4, stale_excluded: 0, absent: 1, inconsistent_row_ids: [] });
  assert.deepEqual(facts.linked, { interval_count: 2, length: 21, intervals: [{ start: 2, end: 18 }, { start: 21, end: 26 }] });

  assert.deepEqual(segments(facts), [[0, 2, "  ", true], [18, 21, ".\n\t", false], [26, 36, "  epsilon ", false]]);
  assert.equal(facts.linked.length + facts.unmapped.length, text.length);
  assert.equal(facts.unmapped.segment_count, 3);
});

test("a repeated passage covers only the occurrence its link chose, and two links to it cover it once", () => {
  const text = "ababa aba";
  const facts = account(text, row("r1", text, text, "aba", 2), row("r2", text, text, "aba", 2));
  assert.deepEqual([facts.links.current, facts.linked.intervals, segments(facts)],
    [2, [{ start: 2, end: 5 }], [[0, 2, "ab", false], [5, 9, " aba", false]]]);

  assert.deepEqual(account(text, row("r1", text, text, "aba", 1), row("r2", text, text, "aba", 2)).linked,
    { interval_count: 1, length: 5, intervals: [{ start: 0, end: 5 }] });
});

test("a stale link covers nothing of the current text, although its passage still occurs", () => {
  const saved = "The exporter must not write the ledger.", current = `Preface. ${saved}`;
  const facts = account(current, row("r1", current, saved, "must not write the ledger"));
  assert.deepEqual([facts.links, facts.linked.length, segments(facts)],
    [{ current: 0, stale_excluded: 1, absent: 0, inconsistent_row_ids: [] }, 0, [[0, current.length, current, false]]]);
});

test("a current link whose location no longer holds its passage is named and covers nothing", () => {
  const text = "Alpha beta gamma.";
  const broken = row("r1", text, text, "beta");
  const moved = { ...broken, source: { ...broken.source, location: { ...broken.source.location, start: 0, end: 4 } } };
  const facts = account(text, moved);
  assert.deepEqual([facts.links, segments(facts)],
    [{ current: 0, stale_excluded: 0, absent: 0, inconsistent_row_ids: ["r1"] }, [[0, text.length, text, false]]]);
});

test("wholly linked text has no unmapped segment; no rows leaves the whole text; no text is unknown, never empty", () => {
  const text = "Alpha beta";
  const whole = account(text, row("r1", text, text, text));
  assert.deepEqual([whole.measurement_performed, whole.accounting_status, whole.unmapped, whole.linked.length],
    [true, "complete", { segment_count: 0, length: 0, segments: [] }, text.length]);
  assert.deepEqual(segments(accountRequirementSourceResidual({ status: "absent", rows: [] }, text)), [[0, text.length, text, false]]);
  assert.deepEqual(segments(accountRequirementSourceResidual(null, text)), [[0, text.length, text, false]]);
  for (const missing of [null, undefined, ""]) {
    const unknown = accountRequirementSourceResidual({ rows: [] }, missing);
    assert.deepEqual([unknown.accounting_status, unknown.measurement_performed, unknown.source_field, Object.hasOwn(unknown, "unmapped")],
      ["unknown", false, "sections.user_requirements", false]);
    assert.match(unknown.reason, /no sections\.user_requirements text is saved/u);
  }
});

test("accounting completeness is separate from measurement, formal meaning and whitespace detail", () => {
  const text = "🪶 Alpha.\nBeta.";
  const partial = account(text, row("draft", text, text, "🪶 Alpha."));
  assert.equal(partial.measurement_performed, true);
  assert.equal(partial.accounting_status, "incomplete");
  assert.deepEqual(segments(partial), [[9, 15, "\nBeta.", false]]);
  const blank = account(" \nAlpha.\t", row("r", " \nAlpha.\t", " \nAlpha.\t", "Alpha."));
  assert.equal(blank.accounting_status, "complete");
  assert.equal(blank.unmapped.segment_count, 2, "whitespace detail is retained");
});

test("formal and explicit exception intervals are distinct and their union never double counts", () => {
  const text = "Alpha. Beta. Gamma.";
  const formal = row("r1", text, text, "Alpha. Beta.");
  const excepted = row("u1", text, text, "Beta. Gamma.");
  const facts = accountRequirementSourceResidual({ rows: [formal] }, text, [excepted]);
  assert.deepEqual([facts.accounting_status, facts.formal.length, facts.excepted.length, facts.linked.length],
    ["complete", 12, 12, text.length]);
  assert.equal(facts.exception_links.current, 1);
  assert.equal(accountRequirementSourceResidual({ rows: [formal] }, text).accounting_status, "incomplete",
    "withdrawing an exception reopens its sole contribution");
  assert.equal(accountRequirementSourceResidual({ rows: [] }, text, [excepted]).accounting_status, "incomplete",
    "retiring the formal row reopens its sole contribution");
  assert.equal(accountRequirementSourceResidual({ rows: [formal, row("r2", text, text, text)] }, text).accounting_status,
    "complete", "redundant current linkage survives withdrawal");
});

test("parent accounting includes only source-bound deliberate exceptions, with digest and parent integrity", async () => {
  const { accountParentRequirementSource } = await import(
    "../../packages/wiki-core/src/operations/controlled-contract/contract-requirement-source-links.mjs");
  const text = "Documentation. Documentation.";
  const link = resolveRequirementSourceLink({ wkId: WK, text, passage: "Documentation.", occurrence: 2, field: "exception.source_passages[0]" });
  const contract = { authored_requirements: { rows: [], unresolved: [{ text: "tone", grammar_exception: {
    rationale: "Unrepresentable.", source_passages: [link] } }] } };
  const record = { id: WK, sections: { user_requirements: text }, proof_posture: { controlled_contract: {
    required: false, source_passages: [resolveRequirementSourceLink({ wkId: WK, text,
      passage: "Documentation.", occurrence: 1, field: "exception.source_passages[0]" })] } } };
  assert.equal(accountParentRequirementSource(contract, record).accounting_status, "complete");
  assert.equal(accountParentRequirementSource(contract, { ...record, sections: { user_requirements: text + " " } }).accounting_status, "incomplete");
  assert.equal(accountParentRequirementSource(contract, { ...record, id: "WK-0002" }).excepted.length, 0);
  assert.equal(accountParentRequirementSource(null, { ...record, proof_posture: { controlled_contract: { required: false } } }).excepted.length, 0);
});

test('obligation accounting requires all explicit assertions and separates unmet ordinary residue', async () => {
  const { accountParentRequirementSource } = await import(
    '../../packages/wiki-core/src/operations/controlled-contract/contract-requirement-source-links.mjs');
  const formal = 'The operation returns five.', unmet = 'Preserve the intended experience.';
  const text = `${formal}\n${unmet}`;
  const link = passage => resolveRequirementSourceLink({ wkId: WK, text, passage, field: 'source' });
  const record = { id: WK, sections: { user_requirements: text } };
  const contract = { authored_requirements: { rows: [{ row_id: 'group', claim_ids: ['one', 'two'], source: link(formal) }],
    unresolved: [{ text: unmet, reason: 'ambiguous_semantics', source_passages: [link(unmet)] }] } };
  const assess = ids => accountParentRequirementSource(contract, record, { obligationClaimIds: new Set(ids) });
  assert.equal(accountParentRequirementSource(contract, record).accounting_status, 'complete', 'literal source accounting retains its population');
  for (const ids of [[], ['one'], ['two'], ['unrelated']]) {
    const facts = assess(ids);
    assert.deepEqual([facts.accounting_status, facts.obligation_coverage, facts.unmet_residue], ['incomplete', 'none', true]);
    assert.equal(facts.residue.length, unmet.length);
    assert.equal(facts.excepted.length, 0, 'ordinary residue never becomes an exception');
  }
  const mixed = assess(['one', 'two']);
  assert.deepEqual([mixed.accounting_status, mixed.obligation_coverage, mixed.unmet_residue], ['complete', 'partial', true]);
  assert.equal(mixed.formal.length, formal.length);
  const unbound = structuredClone(contract); delete unbound.authored_requirements.unresolved[0].source_passages;
  assert.equal(accountParentRequirementSource(unbound, record, { obligationClaimIds: new Set(['one', 'two']) }).accounting_status, 'incomplete');
  const stale = { ...record, sections: { user_requirements: `${text}\nNew meaning.` } };
  assert.equal(accountParentRequirementSource(contract, stale, { obligationClaimIds: new Set(['one', 'two']) }).residue.length, 0);
  const optOut = { ...record, proof_posture: { controlled_contract: { required: false, source_passages: [link(text)] } } };
  assert.equal(accountParentRequirementSource(null, optOut).accounting_status, 'complete');
  assert.equal(accountParentRequirementSource(null, optOut, { obligationClaimIds: new Set() }).accounting_status, 'incomplete',
    'a whole-unit applicability decision supplies no unmet requirement meaning');
});

test('explicit current context is distinct from obligation coverage and unmet residue', async () => {
  const { accountParentRequirementSource } = await import(
    '../../packages/wiki-core/src/operations/controlled-contract/contract-requirement-source-links.mjs');
  const context = 'Earlier work was exploratory.', behavior = 'The operation returns five.', residue = 'Preserve the intended experience.';
  const text = [context, behavior, residue].join('\n');
  const link = passage => resolveRequirementSourceLink({ wkId: WK, text, passage, field: 'source' });
  const definition = { row_id: 'definition', input: { definition: true }, pending: [], constraint_ids: ['defined'], claim_ids: [], source: link(context) };
  const contract = { authored_requirements: { rows: [definition, { row_id: 'behavior', input: {}, claim_ids: ['one', 'two'], source: link(behavior) }],
    unresolved: [{ text: residue, reason: 'ambiguous_semantics', source_passages: [link(residue)] }] } };
  const record = { id: WK, sections: { user_requirements: text } };
  const assess = ids => accountParentRequirementSource(contract, record, { obligationClaimIds: new Set(ids) });
  assert.equal(assess(['one', 'two']).accounting_status, 'incomplete', 'a definition and source link alone classify nothing');
  definition.source_role = 'context';
  const mixed = assess(['one', 'two']);
  assert.deepEqual([mixed.accounting_status, mixed.obligation_coverage, mixed.unmet_residue], ['complete', 'partial', true]);
  assert.equal(mixed.context.length, context.length); assert.equal(mixed.formal.length, behavior.length);
  assert.equal(mixed.residue.length, residue.length); assert.equal(mixed.excepted.length, 0);
  assert.equal(assess(['one']).accounting_status, 'incomplete', 'context grants no assertion membership');
  contract.authored_requirements.rows.push({ ...definition, row_id: 'overlap', source: link(behavior) });
  const overlapping = assess(['one']);
  assert.equal(overlapping.accounting_status, 'complete', 'the interval union records only passage accounting');
  assert.equal(overlapping.obligation_coverage, 'none', 'overlapping context is not formal coverage');
  assert.equal(overlapping.linked.length, context.length + behavior.length + residue.length);
  definition.pending = ['behavior.objects'];
  assert.equal(assess(['one']).accounting_status, 'incomplete', 'incomplete definitions contribute no context');
  definition.pending = []; definition.input.definition = false;
  assert.equal(assess(['one']).accounting_status, 'incomplete', 'a role on normative meaning contributes no context');
  definition.input.definition = true;
  const stale = accountParentRequirementSource(contract, { ...record, sections: { user_requirements: `${text}\n` } }, { obligationClaimIds: new Set(['one', 'two']) });
  assert.equal(stale.context.length, 0); assert.equal(stale.context_links.stale_excluded, 2);
  assert.equal(stale.accounting_status, 'incomplete');
});

test("exception selectors are bounded and forbidden for proof decisions and withdrawals", async () => {
  const { validateRecordAuthoringException } = await import(
    "../../packages/wiki-core/src/lib/record-authoring-exception.mjs");
  const apply = { kind: 'grammar', action: 'apply', subject: { kind: 'unresolved', match: { text: 'Meaning.' } }, rationale: 'Unrepresentable.' };
  assert.deepEqual(validateRecordAuthoringException(apply), []);
  const passage = { user_requirement: 'Alpha', user_requirement_occurrence: 2 };
  assert.deepEqual(validateRecordAuthoringException({ ...apply, source_passages: [passage] }), []);
  for (const source_passages of [[], Array(65).fill(passage), [{ user_requirement: '' }],
    [{ ...passage, digest: 'caller digest' }]]) {
    assert.ok(validateRecordAuthoringException({ ...apply, source_passages }).some(row => row.path.startsWith('exception.source_passages')));
  }
  for (const exception of [{ ...apply, kind: 'proof', subject: 'OBL-001' },
    { kind: 'grammar', action: 'withdraw', subject: apply.subject }]) {
    assert.ok(validateRecordAuthoringException({ ...exception, source_passages: [passage] }).length);
  }
});

test("quotation recovery preserves the exception-only transaction and names a savable draft gap", () => {
  assert.throws(() => resolveRequirementSourceLink({ wkId: WK, text: null, passage: 'Alpha',
    field: 'exception.source_passages[0]' }), error => {
    assert.equal(error.details.field, 'exception.source_passages[0].user_requirement');
    assert.match(error.details.correction, /ordinary save first/u);
    assert.match(error.details.correction, /omit exception.source_passages.*accounting gap/u);
    assert.equal(error.details.read_call.arguments.reads[0].subject, WK);
    return true;
  });
});

test('saved exception binding gaps are bounded facts without inferred coverage or rationale', async () => {
  const { accountParentRequirementSource } = await import(
    '../../packages/wiki-core/src/operations/controlled-contract/contract-requirement-source-links.mjs');
  const text = 'Alpha. Beta.';
  const record = { id: WK, sections: { user_requirements: text },
    proof_posture: { controlled_contract: { required: false } } };
  const contract = { authored_requirements: { unresolved: Array.from({ length: 100 }, () =>
    ({ text: 'Meaning.', grammar_exception: { rationale: 'Caller reason.' } })) } };
  const facts = accountParentRequirementSource(contract, record);
  const compact = compactRequirementSourceAccounting(facts);
  assert.deepEqual(compact.recovery.saved_exception_binding_gaps, {
    grammar: { without_passages: 100, stale_passages: 0 },
    controlled_acceptance: { without_passages: 1, stale_passages: 0 } });
  assert.deepEqual([compact.excepted_length, compact.accounted_length, compact.remaining_length], [0, 0, text.length]);
  assert.doesNotMatch(JSON.stringify(compact), /Caller reason|Meaning/u);
  const stored = resolveRequirementSourceLink({ wkId: WK, text, passage: 'Alpha.', field: 'exception.source_passages[0]' });
  record.proof_posture.controlled_contract.source_passages = [stored];
  assert.equal(accountParentRequirementSource(null, record).exception_binding_gaps, undefined);
  record.sections.user_requirements += ' More.';
  const stale = accountParentRequirementSource(null, record);
  assert.deepEqual(stale.exception_binding_gaps, { controlled_acceptance: { without_passages: 0, stale_passages: 1 } });
  assert.deepEqual([stale.exception_links.stale_excluded, stale.excepted.length], [1, 0]);
});
