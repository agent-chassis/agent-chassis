

import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTROLLED_ACCEPTANCE_REPAIR_QUALIFICATIONS,
  deriveControlledAcceptanceEvaluatedSnapshot
} from
  "../../packages/wiki-core/src/operations/controlled-contract/controlled-acceptance-evaluated-snapshot.mjs";
import {
  deriveControlledContractRepairCandidate
} from
  "../../packages/wiki-core/src/operations/controlled-contract/design-workbench-repair.mjs";

const RECORD_SOURCE_DIGEST = `sha256:${"a".repeat(64)}`;

function row(rowId, responseForms = ["advance_authoring"]) {
  return Object.freeze({
    row_id: rowId,
    semantic_identity: { row: rowId },
    state: "missing",
    reason_codes: [],
    evidence: {},
    dependencies: [],
    eligible_response_forms: responseForms
  });
}

function classified(rows, descriptorsByRowId, {
  recordSourceDigest = RECORD_SOURCE_DIGEST, mechanicallyComplete = false
} = {}) {
  const workbench = Object.freeze({
    subject: Object.freeze({ wk_id: "WK-9999", focus: null,
      generation_id: "generation-one",
      manifest_digest: `sha256:${"b".repeat(64)}`,
      record_source_digest: recordSourceDigest }),
    mechanically_complete: mechanicallyComplete,
    dimension_count: 1, dimensions: [],
    incomplete_row_count: rows.length,
    actionable_row_count: rows.length, actionable_rows: rows,
    non_actionable_row_count: 0, non_actionable_rows: []
  });
  const descriptors = new Map(Object.entries(descriptorsByRowId).map(
    ([rowId, semanticOwner]) => [rowId, { semantic_owner: semanticOwner,
      response_kinds: ["advance_authoring"], owner_context: {} }]));
  return { workbench, classification: { descriptors } };
}

function qualify(subject) {
  const candidate = deriveControlledContractRepairCandidate(subject.workbench,
    { descriptors: subject.classification.descriptors });
  const snapshot = deriveControlledAcceptanceEvaluatedSnapshot({
    ownerInput: null, workbench: subject.workbench,
    classification: subject.classification, repairCandidate: candidate });

  assert.ok(CONTROLLED_ACCEPTANCE_REPAIR_QUALIFICATIONS.includes(
    snapshot.repair.qualification), snapshot.repair.qualification);
  assert.equal(snapshot.repair.reason_code, candidate.reason_code ?? null);
  assert.equal(snapshot.repair.gap_class, candidate.gap_class ?? null);
  return { candidate, published: snapshot.repair };
}

test("several disjoint mechanical rows form ONE qualified candidate", () => {

  const { candidate, published } = qualify(classified(
    [row("authoring_stage:one"), row("authoring_stage:two")],
    { "authoring_stage:one": "authoring_continuation",
      "authoring_stage:two": "proof_plan" }));

  assert.equal(candidate.unique, true);
  assert.equal(published.qualification, "uniquely_determined");
  assert.equal(published.candidate_row_count, 2, "one repair, two rows");
  assert.equal(published.affected_role_count, 3);

  assert.equal(published.candidate_row_id, null);
  assert.equal(published.responsible_owner, "authoring_continuation+proof_plan");
  assert.equal(typeof published.candidate_digest, "string");
});

test("one mechanical row with one available owner is uniquely determined", () => {
  const { published } = qualify(classified([row("authoring_stage:only")],
    { "authoring_stage:only": "proof_plan" }));
  assert.equal(published.qualification, "uniquely_determined");
  assert.equal(published.candidate_row_count, 1);
  assert.equal(published.candidate_row_id, "authoring_stage:only");
});

test("a single mechanical row whose owner is unavailable is not repairable", () => {

  const missingPreparer = qualify(classified([row("assessment:extend")],
    { "assessment:extend": "contract_carrier" }));
  assert.equal(missingPreparer.candidate.unique, undefined);
  assert.equal(missingPreparer.published.qualification, "capability_unavailable");
  assert.equal(missingPreparer.published.reason_code,
    "controlled_contract_repair_participant_missing");
  assert.equal(missingPreparer.published.responsible_owner, "contract_carrier");

  const unregistered = qualify(classified([row("authoring_stage:only")],
    { "authoring_stage:only": "an_owner_no_registry_declares" }));
  assert.equal(unregistered.published.qualification, "capability_unavailable");
  assert.equal(unregistered.published.reason_code,
    "controlled_contract_repair_owner_unregistered");

  const undescribed = qualify(classified([row("authoring_stage:only")], {}));
  assert.equal(undescribed.published.qualification, "capability_unavailable");
  assert.equal(undescribed.published.reason_code,
    "controlled_contract_repair_owner_unregistered");
});

test("competing candidates for one mutable role stay non-automatic", () => {

  const { candidate, published } = qualify(classified(
    [row("authoring_stage:continue"), row("authoring_stage:reference")],
    { "authoring_stage:continue": "authoring_continuation",
      "authoring_stage:reference": "contract_reference" }));

  assert.equal(candidate.unique, undefined);
  assert.equal(published.qualification, "competing_candidates");
  assert.equal(published.reason_code,
    "controlled_contract_repair_role_contended");
  assert.equal(published.gap_class, "unresolved_semantic_choice");
});

test("a semantic question is never classified as a mechanical repair", () => {

  const { published } = qualify(classified(
    [row("assessment:extend", ["contract_requirements"])],
    { "assessment:extend": "contract_carrier" }));
  assert.equal(published.qualification, "substantive_input_required");
  assert.equal(published.reason_code,
    "controlled_contract_repair_no_mechanical_candidate");
  assert.equal(published.gap_class, "unresolved_semantic_choice");
  assert.equal(published.candidate_row_count, 0);

  const mixed = qualify(classified(
    [row("authoring_stage:choose", ["advance_authoring", "proof_authoring_selection"])],
    { "authoring_stage:choose": "proof_plan" }));
  assert.equal(mixed.published.qualification, "substantive_input_required");
});

test("a mechanically complete population needs no repair", () => {
  const { published } = qualify(classified([], {},
    { mechanicallyComplete: true }));
  assert.equal(published.qualification, "not_required");
  assert.equal(published.reason_code, "controlled_contract_repair_not_required");
  assert.equal(published.gap_class, null);
});

test("an unauthenticated work-record source qualifies no repair at all", () => {

  const { published } = qualify(classified([row("authoring_stage:only")],
    { "authoring_stage:only": "proof_plan" }, { recordSourceDigest: null }));
  assert.equal(published.qualification, "source_unauthenticated");
  assert.equal(published.reason_code,
    "controlled_contract_repair_source_unauthenticated");
  assert.equal(published.gap_class, "stale_source");
});

test("an incomplete population with no actionable row has no repair available",
  () => {
    const workbench = Object.freeze({
      subject: Object.freeze({ wk_id: "WK-9999", focus: null,
        generation_id: "generation-one", manifest_digest: null,
        record_source_digest: RECORD_SOURCE_DIGEST }),
      mechanically_complete: false,
      dimension_count: 1, dimensions: [],
      incomplete_row_count: 3,
      actionable_row_count: 0, actionable_rows: [],
      non_actionable_row_count: 3, non_actionable_rows: []
    });
    const { published } = qualify({ workbench,
      classification: { descriptors: new Map() } });
    assert.equal(published.qualification, "not_available");
    assert.equal(published.reason_code,
      "controlled_contract_repair_no_mechanical_candidate");
    assert.equal(published.gap_class, null);
  });
