

import assert from "node:assert/strict";
import test from "node:test";

import {
  renderRecordByKindMarkdown
} from "../packages/wiki-core/src/lib/work-record-kind-renderer.mjs";

function validDecision(overrides = {}) {
  return {
    id: "DEC-9001",
    record_kind: "decision",
    title: "Fixture decision",
    status: "proposed",
    date: "2026-07-10",
    owners: ["codex"],
    ...overrides
  };
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
    ...overrides
  };
}

function frontmatterBlock(markdown) {
  assert.ok(markdown.startsWith("---\n"), "projection must open with a YAML frontmatter fence");
  const closingFence = markdown.indexOf("\n---\n", 4);
  assert.ok(closingFence !== -1, "projection must close the YAML frontmatter fence");
  return markdown.slice(4, closingFence);
}

function sectionHeadings(markdown) {
  return markdown
    .split("\n")
    .filter((line) => line.startsWith("## "))
    .map((line) => line.slice(3));
}

test("a decision.v1 record projects to frontmatter + Context/Decision/Consequences headings", () => {
  const result = renderRecordByKindMarkdown(
    validDecision({
      sections: {
        context: "The prose surface was too easy to edit.",
        decision: "Move DEC records to JSON.",
        consequences: "Agents mutate through MCP routes."
      }
    })
  );

  assert.equal(result.valid, true);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(typeof result.markdown, "string");

  const fm = frontmatterBlock(result.markdown);
  assert.match(fm, /^id: DEC-9001$/m);
  assert.match(fm, /^title: /m);
  assert.match(fm, /^status: proposed$/m);
  assert.match(fm, /^date: 2026-07-10$/m);

  assert.match(fm, /^owners:\n {2}- codex$/m);

  assert.doesNotMatch(fm, /^record_kind:/m);

  assert.deepEqual(sectionHeadings(result.markdown), ["Context", "Decision", "Consequences"]);
});

test("a decision.v1 record emits only present non-empty sections", () => {

  const result = renderRecordByKindMarkdown(
    validDecision({ sections: { context: "  ", decision: "Just the decision." } })
  );

  assert.equal(result.valid, true);
  assert.deepEqual(sectionHeadings(result.markdown), ["Decision"]);
  assert.doesNotMatch(result.markdown, /## Context/);
  assert.doesNotMatch(result.markdown, /## Consequences/);
});

test("a decision.v1 record with no sections projects frontmatter and no body headings", () => {
  const result = renderRecordByKindMarkdown(validDecision());
  assert.equal(result.valid, true);
  assert.deepEqual(sectionHeadings(result.markdown), []);

  assert.match(result.markdown, /^# Fixture decision$/m);
});

test("an initiative.v1 record projects to frontmatter + Summary/Goals/Milestones headings", () => {
  const result = renderRecordByKindMarkdown(
    validInitiative({
      sections: {
        summary: "Move IN/DEC to JSON.",
        goals: "Structured authority records.",
        milestones: "Registry, migration, mutation routes."
      }
    })
  );

  assert.equal(result.valid, true);
  assert.deepEqual(result.diagnostics, []);

  const fm = frontmatterBlock(result.markdown);
  assert.match(fm, /^id: IN-9001$/m);
  assert.match(fm, /^status: todo$/m);
  assert.match(fm, /^priority: high$/m);
  assert.match(fm, /^owner: codex$/m);
  assert.doesNotMatch(fm, /^record_kind:/m);

  assert.deepEqual(sectionHeadings(result.markdown), ["Summary", "Goals", "Milestones"]);
});

test("an initiative.v1 record emits only present non-empty sections", () => {
  const result = renderRecordByKindMarkdown(
    validInitiative({ sections: { summary: "Only a summary.", goals: "" } })
  );

  assert.equal(result.valid, true);
  assert.deepEqual(sectionHeadings(result.markdown), ["Summary"]);
  assert.doesNotMatch(result.markdown, /## Goals/);
  assert.doesNotMatch(result.markdown, /## Milestones/);
});

test("an unsupported record kind returns an unsupported_record_kind diagnostic (no throw)", () => {
  const result = renderRecordByKindMarkdown({ record_kind: "source", id: "SRC-1" });
  assert.equal(result.valid, false);
  assert.equal(result.markdown, null);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "unsupported_record_kind");
  assert.equal(result.diagnostics[0].path, "record_kind");
  assert.ok(result.diagnostics[0].message.includes("source"));
});

test("a work_item record is not projected here (owned by work-record-renderer)", () => {
  const result = renderRecordByKindMarkdown({ record_kind: "work_item", id: "WK-1" });
  assert.equal(result.valid, false);
  assert.equal(result.markdown, null);
  assert.equal(result.diagnostics[0].code, "unsupported_record_kind");
});

test("a malformed record (non-object or missing record_kind) diagnoses without throwing", () => {
  const nonObject = renderRecordByKindMarkdown("not-a-record");
  assert.equal(nonObject.valid, false);
  assert.equal(nonObject.diagnostics[0].code, "invalid_record");

  const missingKind = renderRecordByKindMarkdown({ id: "X" });
  assert.equal(missingKind.valid, false);
  assert.equal(missingKind.diagnostics[0].code, "invalid_record");
  assert.equal(missingKind.diagnostics[0].path, "record_kind");
});
