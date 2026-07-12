

import assert from "node:assert/strict";
import test from "node:test";

import {
  setSection,
  setScalar,
  ratify,
  unratify
} from "../packages/wiki-core/src/lib/kind-record-edit.mjs";

const ACTOR = "test-actor";
const NOW = "2026-07-11";

function proposedDecision(overrides = {}) {
  return {
    id: "DEC-9001",
    record_kind: "decision",
    title: "Fixture decision",
    status: "proposed",
    date: "2026-07-10",
    owners: ["codex"],
    sections: {
      context: "why",
      decision: "what",
      consequences: "so what"
    },
    ...overrides
  };
}

function acceptedDecision(overrides = {}) {
  return proposedDecision({
    status: "accepted",
    ratified: "2026-07-01",
    ratified_by: "codex",
    ...overrides
  });
}

function validInitiative(overrides = {}) {
  return {
    id: "IN-9001",
    record_kind: "initiative",
    title: "Fixture initiative",
    status: "todo",
    priority: "high",
    owner: "codex",
    created: "2026-07-10",
    updated: "2026-07-10",
    sections: {
      summary: "s",
      goals: "g",
      milestones: "m"
    },
    ...overrides
  };
}

test("setSection sets a valid section and stamps updated/updated_by", () => {
  const record = proposedDecision();
  const result = setSection({ record, section: "context", value: "new context", actor: ACTOR, now: NOW });

  assert.equal(result.ok, true);
  assert.equal(result.updatedRecord.sections.context, "new context");
  assert.equal(result.updatedRecord.updated, NOW);
  assert.equal(result.updatedRecord.updated_by, ACTOR);
  assert.ok(result.changedFields.includes("sections.context"));
  assert.ok(result.changedFields.includes("updated"));
  assert.ok(result.changedFields.includes("updated_by"));
});

test("setSection works for an initiative body section", () => {
  const record = validInitiative();
  const result = setSection({ record, section: "goals", value: "ship it", actor: ACTOR, now: NOW });

  assert.equal(result.ok, true);
  assert.equal(result.updatedRecord.sections.goals, "ship it");
  assert.equal(result.updatedRecord.updated_by, ACTOR);
});

test("setSection does not mutate the caller's input record (purity)", () => {
  const record = proposedDecision();
  setSection({ record, section: "context", value: "mutated", actor: ACTOR, now: NOW });

  assert.equal(record.sections.context, "why");
  assert.equal(record.updated, undefined);
});

test("setSection refuses an unsupported section", () => {
  const record = proposedDecision();
  const result = setSection({ record, section: "not_a_section", value: "x", actor: ACTOR, now: NOW });

  assert.equal(result.ok, false);
  assert.equal(result.updatedRecord, null);
  assert.equal(result.diagnostics[0].code, "unsupported_section");
});

test("setSection refuses a blank actor", () => {
  const record = proposedDecision();
  const result = setSection({ record, section: "context", value: "x", actor: "  ", now: NOW });

  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, "invalid_provenance_input");
});

test("setScalar sets a controlled field and stamps provenance", () => {
  const record = proposedDecision();
  const result = setScalar({ record, field: "area", value: "security", actor: ACTOR, now: NOW });

  assert.equal(result.ok, true);
  assert.equal(result.updatedRecord.area, "security");
  assert.equal(result.updatedRecord.updated, NOW);
  assert.equal(result.updatedRecord.updated_by, ACTOR);
  assert.ok(result.changedFields.includes("area"));
});

test("setScalar sets a controlled array field", () => {
  const record = proposedDecision();
  const result = setScalar({ record, field: "related", value: ["DEC-0003"], actor: ACTOR, now: NOW });

  assert.equal(result.ok, true);
  assert.deepEqual(result.updatedRecord.related, ["DEC-0003"]);
});

test("setScalar refuses the managed status field", () => {
  const record = proposedDecision();
  const result = setScalar({ record, field: "status", value: "accepted", actor: ACTOR, now: NOW });

  assert.equal(result.ok, false);
  assert.equal(result.updatedRecord, null);
  assert.equal(result.diagnostics[0].code, "managed_field");
});

test("setScalar refuses the managed ratified field", () => {
  const record = proposedDecision();
  const result = setScalar({ record, field: "ratified", value: NOW, actor: ACTOR, now: NOW });

  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, "managed_field");
});

test("setScalar refuses a field outside the kind spec", () => {
  const record = proposedDecision();
  const result = setScalar({ record, field: "bogus", value: "x", actor: ACTOR, now: NOW });

  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, "unsupported_field");
});

test("ratify flips a proposed decision to accepted and stamps ratification provenance", () => {
  const record = proposedDecision();
  const result = ratify({ record, actor: ACTOR, now: NOW });

  assert.equal(result.ok, true);
  assert.equal(result.updatedRecord.status, "accepted");
  assert.equal(result.updatedRecord.ratified, NOW);
  assert.equal(result.updatedRecord.ratified_by, ACTOR);
  assert.equal(result.updatedRecord.updated, NOW);
  assert.equal(result.updatedRecord.updated_by, ACTOR);
  assert.ok(result.changedFields.includes("status"));
  assert.ok(result.changedFields.includes("ratified"));
  assert.ok(result.changedFields.includes("ratified_by"));
});

test("ratify refuses a non-proposed decision", () => {
  const record = acceptedDecision();
  const result = ratify({ record, actor: ACTOR, now: NOW });

  assert.equal(result.ok, false);
  assert.equal(result.updatedRecord, null);
  assert.equal(result.diagnostics[0].code, "invalid_lifecycle_transition");
});

test("ratify refuses a non-decision record", () => {
  const record = validInitiative();
  const result = ratify({ record, actor: ACTOR, now: NOW });

  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, "unsupported_lifecycle");
});

test("unratify flips accepted -> proposed and clears ratification provenance", () => {
  const record = acceptedDecision();
  const result = unratify({ record, actor: ACTOR, now: NOW });

  assert.equal(result.ok, true);
  assert.equal(result.updatedRecord.status, "proposed");
  assert.equal(result.updatedRecord.ratified, null);
  assert.equal(result.updatedRecord.ratified_by, null);
  assert.equal(result.updatedRecord.updated, NOW);
  assert.equal(result.updatedRecord.updated_by, ACTOR);
  assert.ok(result.changedFields.includes("status"));
});

test("unratify refuses a non-accepted decision", () => {
  const record = proposedDecision();
  const result = unratify({ record, actor: ACTOR, now: NOW });

  assert.equal(result.ok, false);
  assert.equal(result.updatedRecord, null);
  assert.equal(result.diagnostics[0].code, "invalid_lifecycle_transition");
});

test("setSection is refused on an accepted decision (must unratify first)", () => {
  const record = acceptedDecision();
  const result = setSection({ record, section: "context", value: "sneaky edit", actor: ACTOR, now: NOW });

  assert.equal(result.ok, false);
  assert.equal(result.updatedRecord, null);
  assert.equal(result.diagnostics[0].code, "amend_of_accepted_decision");
});

test("setScalar is refused on an accepted decision (must unratify first)", () => {
  const record = acceptedDecision();
  const result = setScalar({ record, field: "area", value: "security", actor: ACTOR, now: NOW });

  assert.equal(result.ok, false);
  assert.equal(result.updatedRecord, null);
  assert.equal(result.diagnostics[0].code, "amend_of_accepted_decision");
});

test("the same content edits succeed on a proposed decision", () => {
  const sectionResult = setSection({
    record: proposedDecision(),
    section: "context",
    value: "ok edit",
    actor: ACTOR,
    now: NOW
  });
  assert.equal(sectionResult.ok, true);
  assert.equal(sectionResult.updatedRecord.sections.context, "ok edit");

  const scalarResult = setScalar({
    record: proposedDecision(),
    field: "area",
    value: "security",
    actor: ACTOR,
    now: NOW
  });
  assert.equal(scalarResult.ok, true);
  assert.equal(scalarResult.updatedRecord.area, "security");
});

test("amend-of-accepted content is frozen until unratify then editable again", () => {
  const accepted = acceptedDecision();
  const reopened = unratify({ record: accepted, actor: ACTOR, now: NOW });
  assert.equal(reopened.ok, true);
  assert.equal(reopened.updatedRecord.status, "proposed");

  const edit = setSection({
    record: reopened.updatedRecord,
    section: "decision",
    value: "revised",
    actor: ACTOR,
    now: NOW
  });
  assert.equal(edit.ok, true);
  assert.equal(edit.updatedRecord.sections.decision, "revised");
});
