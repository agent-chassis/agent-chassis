import assert from "node:assert/strict";
import test from "node:test";

import { computeWorkRecordSourceDigest } from "../../packages/wiki-core/src/lib/work-record-schema.mjs";
import { loadControlledContractProofAuthoring } from
  "../../packages/wiki-core/src/operations/controlled-contract/package-runtime.mjs";
import { acceptanceCriterionInventory } from
  "../../packages/wiki-core/src/operations/controlled-contract/acceptance-criterion-coverage.mjs";
import { planKindRecordAuthoringChange, prepareRecordAuthoringChange } from
  "../../packages/wiki-core/src/operations/record-authoring-plan.mjs";

import { ADVISORY_DISPOSITION_JUDGMENTS, validateWorkRecordDispositions } from
  "../../packages/wiki-core/src/lib/review-disposition.mjs";
import { planWorkRecordDispositions, readSavedReviewDispositions } from
  "../../packages/wiki-core/src/operations/work-record-dispositions.mjs";

const now = () => "2026-10-03";

function workItem(extra = {}) {
  return {
    schema_version: "work-record.v1", record_kind: "work_item", id: "WK-9996",
    title: "Planner fixture", repo: "agent-chassis/agent-chassis", work_kind: "implementation",
    status: "inbox", priority: "medium", owner: "unassigned", initiative: null, depends_on: [],
    blocks: [], related: [], read_scope: [], repo_paths: [], write_scope: [],
    dispatch_intent: { intended_agent_role: null, target_unit: "none",
      requires_graph_impact: false, requires_escalation: false },
    acceptance: { criteria: ["First criterion.", "Second criterion."], validation: [] },
    sections: { summary: "", why_it_matters: "", user_requirements: "", scope: { items: [], out_of_scope: [] },
      tasks: [], references: [], agent_notes: "", closure: null },
    children: [], slices: [], escalations: [], projections: [], migration: null,
    created: "2026-09-04", updated: "2026-09-04", ...extra
  };
}

const captured = (record, selectedUnit = null) => ({ repoRoot: "/unused", wkId: record.id, focus: null, selectedUnit,
  record, unit: selectedUnit === null ? record : record.slices.find((slice) => slice.id === selectedUnit),
  source: null, caseSource: null, cases: [], rows: [], contract: null,
  sources: [null, ...record.slices.map((slice) => slice.id)].map((id) => ({ selectedUnit: id, source: null })),
  recordSourceDigest: computeWorkRecordSourceDigest(record) });

test("record authoring plan composes ordinary owners without effects or timestamp churn", async () => {
  const pkg = await loadControlledContractProofAuthoring();
  const record = workItem();
  const frozen = structuredClone(record);
  const plan = (changes, source = captured(record)) =>
    prepareRecordAuthoringChange({ capturedSource: source, changes, owners: { pkg, now } });

  const edited = await plan({ title: "Planned title", notes: "Planned notes.", read_scope: ["docs/a.md"],
    criteria: [{ key: "third", text: "Third criterion." }], slices: [{ key: "first", title: "First slice" }] });
  assert.equal(edited.ok, true, JSON.stringify(edited.diagnostics));
  assert.deepEqual([edited.record.title, edited.record.sections.agent_notes, edited.record.read_scope,
    edited.record.acceptance.criteria.at(-1), edited.record.slices.map((slice) => slice.id), edited.record.updated],
  ["Planned title", "Planned notes.", ["docs/a.md"], "Third criterion.", ["SLICE-001"], "2026-09-04"]);
  assert.deepEqual(edited.bindings, { slice: { first: "SLICE-001" },
    criterion: { third: acceptanceCriterionInventory(pkg, edited.record)[2].identity } });
  assert.deepEqual(record, frozen, "the captured record is never mutated");

  const forged = [{ id: 1, review_run_id: "x", entry: { entry_id: 1, version_id: 1 },
    selection: { finding_id: "f" }, disposition: "accept" }];
  assert.deepEqual(validateWorkRecordDispositions(forged), []);
  for (const selector of [{ id: "SLICE-001" }, { key: "forged" }]) {
    const changes = { title: "Never saved", slices: [{ ...selector, sections: { dispositions: forged } }] };
    const input = structuredClone(changes), source = structuredClone(edited.record);
    const refused = await plan(changes, captured(edited.record));
    assert.equal(refused.ok, false, "schema-valid dispositions must not bypass authenticated planning");
    assert.deepEqual([refused.diagnostics[0].code, refused.diagnostics[0].path],
      ["record_authoring_disposition_source_required", "changes.slices[0].sections.dispositions"]);
    assert.match(refused.diagnostics[0].message, /select the slice.*changes\.dispositions.*authenticated captured material/u);
    assert.deepEqual(changes, input);
    assert.deepEqual(edited.record, source);
  }
  const prose = await plan({ slices: [{ id: "SLICE-001", sections: { summary: "Legitimate prose." } }] }, captured(edited.record));
  assert.equal(prose.ok, true, JSON.stringify(prose.diagnostics));
  assert.equal(prose.record.slices[0].sections.summary, "Legitimate prose.");

  const parity = await plan({ owner: "new-owner", tags: ["alpha", "beta"], scope_items: ["In scope."],
    scope_out_of_scope: ["Out of scope."], references: ["docs/a.md"], related: ["WK-0002"] });
  assert.equal(parity.ok, true, JSON.stringify(parity.diagnostics));
  assert.deepEqual([parity.record.owner, parity.record.tags, parity.record.sections.scope,
    parity.record.sections.references, parity.record.related],
  ["new-owner", ["alpha", "beta"], { items: ["In scope."], out_of_scope: ["Out of scope."] }, ["docs/a.md"], ["WK-0002"]]);
  const sliceOnlyRefused = await plan({ tags: ["never"] }, captured(edited.record, "SLICE-001"));
  assert.deepEqual([sliceOnlyRefused.ok, sliceOnlyRefused.diagnostics[0].code, sliceOnlyRefused.diagnostics[0].path],
    [false, "invalid_edit_applicability", "changes.tags"]);

  const equal = await plan({ title: record.title, priority: "medium", read_scope: [] });
  assert.deepEqual([equal.ok, equal.changed_fields, equal.record], [true, [], record]);

  const [first, second] = acceptanceCriterionInventory(pkg, record);
  const removed = await plan({ remove: { criteria: [first.identity] } });
  const [survivor] = acceptanceCriterionInventory(pkg, removed.record);
  assert.deepEqual([removed.record.acceptance.criteria, removed.criterion_identity_changes],
    [["Second criterion."], [{ prior: second.identity, current: survivor.identity }]]);

  const reworded = await plan({ criteria: [{ id: second.identity, text: "Second, reworded." }] });
  assert.deepEqual(reworded.record.acceptance.criteria, ["First criterion.", "Second, reworded."]);
  const unknown = await plan({ criteria: [{ id: "derived:absent", text: "Never." }] });
  assert.deepEqual([unknown.ok, unknown.diagnostics[0].code, unknown.diagnostics[0].path],
    [false, "record_authoring_row_unknown", "changes.criteria[0].id"]);

  const closed = await plan({ status: "done", closure: { summary: "Closed.", validation: [], follow_ups: [] } });
  assert.equal(closed.ok, true, JSON.stringify(closed.diagnostics));
  assert.deepEqual([closed.record.status, closed.record.sections.closure.summary, closed.record.updated,
    closed.changed_fields], ["done", "Closed.", "2026-10-03",
    ["sections.closure.summary", "sections.closure.validation", "sections.closure.follow_ups", "status", "updated"]]);

  const partial = await plan({ closure: { summary: "Incomplete." } });
  assert.deepEqual([partial.ok, partial.diagnostics[0].code, partial.diagnostics[0].path],
    [false, "invalid_record", "changes.closure"]);
  const closureOnly = await plan({ closure: { summary: "Recorded.", validation: ["Checked."], follow_ups: [] } });
  assert.deepEqual([closureOnly.record.status, closureOnly.record.sections.closure.summary], ["inbox", "Recorded."]);
  const sameStatus = await plan({ status: "inbox" });
  assert.deepEqual([sameStatus.changed_fields, sameStatus.record.updated], [[], "2026-09-04"]);

  const sliced = edited.record;
  const sliceDone = await plan({ status: "done", work_kind: "review", agent_role: "reviewer", write_scope: [] },
    captured(sliced, "SLICE-001"));
  assert.equal(sliceDone.ok, true, JSON.stringify(sliceDone.diagnostics));
  assert.deepEqual([sliceDone.record.status, sliceDone.record.slices[0].status, sliceDone.record.slices[0].work_kind,
    sliceDone.record.slices[0].dispatch_intent.intended_agent_role], ["inbox", "done", "review", "reviewer"]);
  for (const [changes, source, code, path] of [
    [{ work_kind: "review" }, captured(record), "record_authoring_member_not_applicable", "changes.work_kind"],
    [{ initiative: "IN-0001" }, captured(sliced, "SLICE-001"), "record_authoring_member_not_applicable", "changes.initiative"],
    [{ slices: [{ key: "nested" }] }, captured(sliced, "SLICE-001"), "record_authoring_member_not_applicable", "changes.slices"],
    [{ slices: [{ id: "SLICE-009", title: "Typo" }] }, captured(record), "record_authoring_row_unknown", "changes.slices[0].id"],
    [{ slices: [{ key: "same" }], criteria: [{ key: "same", text: "Duplicate label." }] }, captured(record),
      "record_authoring_label_duplicate", "changes.criteria[0].key"],
    [{ base_branch: "refs/heads/main" }, captured(record), "invalid_edit_value", "changes.base_branch"],
    [{ status: "not-a-status" }, captured(record), "record_authoring_change_invalid", "changes.status"]
  ]) {
    const refused = await plan(changes, source);
    assert.deepEqual([refused.ok, refused.diagnostics[0].code, refused.diagnostics[0].path], [false, code, path],
      JSON.stringify(refused.diagnostics));
  }
});

test("kind record plan keeps decision and initiative authority", () => {
  const decision = { id: "DEC-9001", record_kind: "decision", title: "Proposed decision", status: "proposed",
    date: "2026-10-01", owners: ["owner"], area: null, docs: [], related: [], supersedes: null, superseded_by: null,
    sections: { context: "Context.", decision: "Decision.", consequences: "Consequences." } };
  const plan = (record, changes) => planKindRecordAuthoringChange({ record, changes, actor: "tester", now: "2026-10-03" });

  const amended = plan(decision, { title: "Amended decision", owners: ["owner", "second"], date: "2026-10-02",
    related: ["DEC-0001"], sections: { context: "New context.", decision: "Decision." } });
  assert.equal(amended.ok, true, JSON.stringify(amended.diagnostics));
  assert.deepEqual([amended.updatedRecord.title, amended.updatedRecord.owners, amended.updatedRecord.date,
    amended.updatedRecord.related, amended.updatedRecord.sections, amended.updatedRecord.status,
    amended.updatedRecord.updated_by],
  ["Amended decision", ["owner", "second"], "2026-10-02", ["DEC-0001"],
    { context: "New context.", decision: "Decision.", consequences: "Consequences." }, "proposed", "tester"]);
  assert.deepEqual(amended.changedFields.sort(),
    ["date", "owners", "related", "sections.context", "title", "updated", "updated_by"]);

  const equal = plan(decision, { title: decision.title, sections: { context: "Context." } });
  assert.deepEqual([equal.ok, equal.changedFields, equal.updatedRecord], [true, [], decision]);

  const rejected = plan(decision, { status: "rejected" });
  assert.deepEqual([rejected.updatedRecord.status, Object.hasOwn(rejected.updatedRecord, "ratified")],
    ["rejected", false]);

  const accepted = { ...decision, status: "accepted", ratified: "2026-10-02", ratified_by: "operator" };
  assert.deepEqual(plan(accepted, { title: "Edited" }).diagnostics.map((entry) => [entry.code, entry.path]),
    [["amend_of_accepted_decision", "changes.title"]]);
  assert.deepEqual(plan(accepted, { status: "rejected" }).diagnostics.map((entry) => [entry.code, entry.path]),
    [["invalid_lifecycle_transition", "changes.status"]]);
  for (const changes of [{ status: "accepted" }, { ratified: "2026-10-03" }, { ratified_by: "agent" },
    { updated_by: "agent" }, { id: "DEC-9002" }]) {
    const refused = plan(decision, changes);
    assert.deepEqual([refused.ok, refused.diagnostics[0].code], [false, "record_authoring_change_invalid"]);
  }

  const initiative = { id: "IN-9001", record_kind: "initiative", title: "Initiative", status: "todo",
    priority: "medium", owner: "owner", created: "2026-10-01", updated: "2026-10-01", summary: "Scalar summary.",
    sections: { summary: "Body summary.", goals: "", milestones: "" } };
  const edited = plan(initiative, { summary: "New scalar.", sections: { goals: "New goals." } });
  assert.equal(edited.ok, true, JSON.stringify(edited.diagnostics));
  assert.deepEqual([edited.updatedRecord.summary, edited.updatedRecord.sections],
    ["New scalar.", { summary: "Body summary.", goals: "New goals.", milestones: "" }]);
  assert.equal(plan(initiative, { status: "done" }).ok, false);
});

const FINDINGS = "Alpha finding. Beta finding.";
const capturedEntry = (id, extra = {}) => ({ id, current_version: 1, versions: [{ id: 1, title: "Findings", kind: "",
  content: { text: FINDINGS }, provenance: { sources: [{ source_kind: "original_managed_findings",
    run_id: `run-${id}`, monitor_handle: "monitor", subject: "WK-9995", repository: "test/repo", ref: `ref-${id}`,
    ...extra }] } }] });
const reviewedRecord = (dispositions) => ({ id: "WK-9995", sections: { entries: [capturedEntry(1),
  capturedEntry(2, { findings: [{ id: "F1" }, { id: "F2" }] }),
  { id: 3, current_version: 1, versions: [{ id: 1, content: { text: FINDINGS }, provenance: { sources: [] } }] }],
  ...(dispositions === undefined ? {} : { dispositions }) }, slices: [{ id: "SLICE-001", sections: {} }] });
const planDispositions = (source, rows, sliceId = null) => planWorkRecordDispositions({ record: source, sliceId, rows });
const refusal = (result) => [result.ok, result.diagnostics[0].code, result.diagnostics[0].path];

test("saved dispositions bind exact captured occurrences and nothing else", () => {
  assert.deepEqual(ADVISORY_DISPOSITION_JUDGMENTS, ["accept", "reject", "defer"]);
  const source = reviewedRecord();
  const frozen = structuredClone(source);
  const planned = planDispositions(source, [
    { key: "a", entry: { id: 1 }, selected_text: { text: "Beta finding." }, disposition: "accept" },
    { key: "b", entry: { id: 2, version: 1 }, finding_id: "F2", disposition: "defer", rationale: "Later." }]);
  assert.equal(planned.ok, true, JSON.stringify(planned.diagnostics));
  assert.deepEqual(planned.record.sections.dispositions, [
    { id: 1, review_run_id: "run-1", entry: { entry_id: 1, version_id: 1 }, selection: { offset: 15, length: 13 },
      disposition: "accept" },
    { id: 2, review_run_id: "run-2", entry: { entry_id: 2, version_id: 1 }, selection: { finding_id: "F2" },
      disposition: "defer", rationale: "Later." }]);
  assert.deepEqual([planned.changedFields, source], [["sections.dispositions"], frozen]);
  assert.deepEqual(validateWorkRecordDispositions(planned.record.sections.dispositions), []);

  assert.deepEqual(refusal(planDispositions(source, [{ key: "x", entry: { id: 1 }, finding_id: "F1", disposition: "accept" }])),
    [false, "work_record_disposition_finding_unknown", "changes.dispositions[0].finding_id"]);
  assert.deepEqual(refusal(planDispositions(source, [{ key: "x", entry: { id: 2 }, finding_id: "F9", disposition: "accept" }])),
    [false, "work_record_disposition_finding_unknown", "changes.dispositions[0].finding_id"]);

  for (const [rows, sliceId] of [[[{ key: "x", entry: { id: 3 }, selected_text: { text: "Alpha finding." }, disposition: "accept" }], null],
    [[{ key: "x", entry: { id: 1, version: 2 }, selected_text: { text: "Alpha finding." }, disposition: "accept" }], null],
    [[{ key: "x", entry: { id: 1 }, selected_text: { text: "Alpha finding." }, disposition: "accept" }], "SLICE-001"]]) {
    assert.deepEqual(refusal(planDispositions(source, rows, sliceId)),
      [false, "work_record_disposition_source_not_review_material", "changes.dispositions[0].entry"]);
  }

  const saved = planned.record;
  const edited = planDispositions(saved, [{ id: 1, disposition: "reject" }]);
  assert.deepEqual([edited.record.sections.dispositions[0].disposition, edited.record.sections.dispositions[0].selection,
    edited.record.sections.dispositions[1]], ["reject", { offset: 15, length: 13 }, saved.sections.dispositions[1]]);
  assert.deepEqual([planDispositions(saved, [{ id: 1, disposition: "accept" }]).changedFields,
    planDispositions(saved, [{ id: 1, disposition: "accept" }]).record], [[], saved]);
  assert.deepEqual(refusal(planDispositions(saved, [{ key: "again", entry: { id: 2 }, finding_id: "F2", disposition: "accept" }])),
    [false, "work_record_disposition_occurrence_duplicate", "changes.dispositions[0]"]);

  const [row] = saved.sections.dispositions;
  for (const invalid of [{ ...row, id: 0 }, { ...row, disposition: "approve" }, { ...row, selection: {} },
    { ...row, selection: { finding_id: "F1", offset: 0, length: 1 } }, { ...row, entry: { entry_id: 1 } },
    { ...row, review_run_id: "" }, { ...row, authority: "operator" }, { ...row, rationale: 4 }, "row"]) {
    assert.equal(validateWorkRecordDispositions([invalid]).length, 1, JSON.stringify(invalid));
  }
  assert.equal(validateWorkRecordDispositions([row, row]).length, 1, "ids are unique");
  assert.equal(validateWorkRecordDispositions({}).length, 1);
});

test("the saved disposition reader distinguishes present, absent, moved and unavailable sources", async () => {
  const rows = [{ id: 1, review_run_id: "run-1", entry: { entry_id: 1, version_id: 1 },
    selection: { offset: 0, length: 14 }, disposition: "accept" }];
  const saved = reviewedRecord(rows);
  const loadRecord = async ({ id }) => id === "WK-9995" ? { valid: true, record: saved }
    : { valid: false, record: null, diagnostics: [{ code: "missing_json_record", severity: "error", message: "absent" }] };
  const read = (input, options = { loadRecord }) => readSavedReviewDispositions({
    capturedUnit: { repoRoot: "/unused", unit: "WK-9995" }, ...input }, options);

  const present = await read({});
  assert.deepEqual([present.state, present.rows, present.source.unit], ["present", rows, "WK-9995"]);
  assert.notEqual(present.rows, rows, "rows are the reader's own copy");
  assert.deepEqual(await read({ expectedRevision: present.source.revision, deliveryIdentity: { commit: "abc" } }),
    { ...present, delivery_identity: { commit: "abc" } });
  assert.deepEqual(await read({ expectedRevision: "0".repeat(16) }), { state: "source_mismatch", unit: "WK-9995",
    expected_revision: "0".repeat(16), current_revision: present.source.revision });
  assert.deepEqual(await read({ capturedUnit: { repoRoot: "/unused", unit: "WK-9995#SLICE-001" } }),
    { state: "absent", source: { unit: "WK-9995#SLICE-001", revision: present.source.revision } });
  for (const unit of ["WK-9995#SLICE-009", "WK-0000"]) {
    const unavailable = await read({ capturedUnit: { repoRoot: "/unused", unit } });
    assert.equal(unavailable.state, "unavailable", unit);
  }
  assert.deepEqual((await read({ capturedUnit: { repoRoot: "/unused", unit: "WK-0000" } })).cause,
    { code: "missing_json_record", message: "absent" });

  const failed = await read({}, { loadRecord: async () => { throw Object.assign(new Error("disk failed"), { code: "EIO" }); } });
  assert.deepEqual(failed, { state: "unavailable", unit: "WK-9995", cause: { code: "EIO", message: "disk failed" } });
});

test("raw slice entries preserve persisted identities but cannot claim captured sources", async () => {
  const pkg = await loadControlledContractProofAuthoring();
  const seeded = await prepareRecordAuthoringChange({ capturedSource: captured(workItem()),
    changes: { slices: [{ key: "slice", title: "Slice" }] }, owners: { pkg, now } });
  const record = seeded.record;
  const version = { ...capturedEntry(1).versions[0], scalar_length: FINDINGS.length, utf8_bytes: FINDINGS.length };
  const entry = { id: 1, current_version: 1, versions: [version] };
  const plan = (entries, source = record, selector = { id: "SLICE-001" }) => prepareRecordAuthoringChange({
    capturedSource: captured(source), changes: { title: "Never saved", slices: [{ ...selector, sections: { entries } }] },
    owners: { pkg, now } });
  const forged = await plan([entry]);
  assert.equal(forged.ok, false, "a new managed-findings claim must require owner capture");
  assert.deepEqual([forged.diagnostics[0].code, forged.diagnostics[0].path],
    ["record_authoring_entry_source_required", "changes.slices[0].sections.entries[0].versions[0].provenance"]);
  const persisted = structuredClone(record);
  persisted.slices[0].sections = { entries: [entry] };
  const frozen = structuredClone(persisted);
  assert.equal((await plan([entry], persisted)).ok, true, "unchanged captured version at the same identity");
  for (const [entries, selector] of [
    [[{ ...entry, current_version: 2, versions: [version, { ...version, id: 2 }] }], { id: "SLICE-001" }],
    [[{ ...entry, id: 2 }], { id: "SLICE-001" }], [[entry], { key: "other-slice" }],
    [[{ ...entry, versions: [{ ...version, title: "Altered" }] }], { id: "SLICE-001" }]
  ]) {
    const refused = await plan(entries, persisted, selector);
    assert.equal(refused.ok, false);
    assert.equal(refused.diagnostics[0].code, "record_authoring_entry_source_required");
    assert.match(refused.diagnostics[0].message, /select the slice.*changes\.entries.*capture/u);
  }
  assert.deepEqual(persisted, frozen);
  const ordinary = { ...entry, versions: [{ ...version, provenance: { sources: [{ kind: "supplied_text" }] } }] };
  assert.equal((await plan([ordinary])).ok, true, "ordinary inline entries remain permitted");
  for (const [malformed, code] of [["entries", "work_record_entries_invalid"],
    [[null], "work_record_entry_invalid"], [[{ ...entry, versions: [null] }], "work_record_entry_version_invalid"]]) {
    const rejected = await plan(malformed);
    assert.equal(rejected.ok, false, "malformed entries keep the slice owner's refusal");
    assert.equal(rejected.diagnostics[0].code, code);
  }
  const historical = structuredClone(entry);
  delete historical.versions[0].scalar_length; delete historical.versions[0].utf8_bytes;
  historical.receipt = { request_key: "retained", fingerprint: "historical", version_id: 1 };
  persisted.slices[0].sections.entries = [historical];
  assert.equal((await plan([historical], persisted)).ok, true, "unchanged retained historical format");
});
