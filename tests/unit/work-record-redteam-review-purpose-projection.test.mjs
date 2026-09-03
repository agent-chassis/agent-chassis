import assert from "node:assert/strict";
import test from "node:test";

import { projectSelectedWorkRecordUnit } from
  "../../packages/wiki-core/src/lib/work-record-selected-unit-projection.mjs";
import { summarizeWorkRecord } from
  "../../packages/wiki-core/src/lib/work-record-summary.mjs";
import { formatSliceEntry } from
  "../../packages/wiki-core/src/lib/work-record-render-primitives.mjs";
import { renderWorkRecordAgentBrief } from
  "../../packages/wiki-core/src/lib/work-record-renderer.mjs";

function unit({ workKind, reviewPurpose } = {}) {
  const value = {
    id: "SLICE-001",
    title: "Findings unit",
    work_kind: workKind,
    status: "todo",
    priority: "medium",
    owner: "unassigned",
  };
  if (reviewPurpose !== undefined) value.review_purpose = reviewPurpose;
  return value;
}

function summaryFor(slice) {
  return summarizeWorkRecord({
    id: "WK-9298",
    repo: "agent-chassis/agent-chassis",
    title: "Projection fixture",
    status: "todo",
    priority: "medium",
    owner: "unassigned",
    work_kind: "implementation",
    slices: [slice],
  }, {
    unit: { kind: "slice", record_id: "WK-9298", slice_id: "SLICE-001" },
  }).selected_unit_summary;
}

test("selected-unit and summary projections preserve explicit redteam standalone", () => {
  const redteam = unit({ workKind: "redteam", reviewPurpose: "standalone" });
  assert.equal(projectSelectedWorkRecordUnit(redteam).review_purpose, "standalone");
  assert.equal(summaryFor(redteam).review_purpose, "standalone");
});

test("legacy redteam omission stays absent across projections", () => {
  const redteam = unit({ workKind: "redteam" });
  assert.equal(Object.hasOwn(projectSelectedWorkRecordUnit(redteam), "review_purpose"), false);
  assert.equal(Object.hasOwn(summaryFor(redteam), "review_purpose"), false);
});

test("invalid purposes remain unprojectable and review defaults remain unchanged", () => {
  assert.equal(projectSelectedWorkRecordUnit(unit({
    workKind: "redteam", reviewPurpose: "terminal_whole_wk",
  })), null);
  assert.equal(projectSelectedWorkRecordUnit(unit({
    workKind: "implementation", reviewPurpose: "standalone",
  })), null);
  assert.equal(projectSelectedWorkRecordUnit(unit({
    workKind: "review", reviewPurpose: "terminal_whole_wk",
  })).review_purpose, "terminal_whole_wk");
  assert.equal(projectSelectedWorkRecordUnit(unit({ workKind: "review" })).review_purpose, "standalone");
});

test("rendered slice rows show effective purpose and never manufacture one", () => {
  assert.match(
    formatSliceEntry(unit({ workKind: "redteam", reviewPurpose: "standalone" })),
    /review purpose: `standalone`/u,
  );
  assert.match(
    formatSliceEntry(unit({ workKind: "review", reviewPurpose: "terminal_whole_wk" })),
    /review purpose: `terminal_whole_wk`/u,
  );

  assert.match(formatSliceEntry(unit({ workKind: "review" })), /review purpose: `standalone`/u);

  assert.doesNotMatch(formatSliceEntry(unit({ workKind: "redteam" })), /review purpose/u);
  assert.doesNotMatch(formatSliceEntry(unit({ workKind: "implementation" })), /review purpose/u);
});

test("the selected-slice brief renders the same effective purpose contract", () => {
  const brief = (slice) => renderWorkRecordAgentBrief({
    schema_version: "work-record.v1",
    id: "WK-9298",
    repo: "agent-chassis/agent-chassis",
    title: "Brief fixture",
    record_kind: "work_item",
    work_kind: "implementation",
    status: "todo",
    priority: "medium",
    owner: "unassigned",
    slices: [slice],
  }, { sliceId: "SLICE-001" }).brief;

  assert.match(brief(unit({ workKind: "redteam", reviewPurpose: "standalone" })), /review purpose/u);
  assert.match(brief(unit({ workKind: "review" })), /review purpose/u);
  assert.doesNotMatch(brief(unit({ workKind: "redteam" })), /review purpose/u);
  assert.doesNotMatch(brief(unit({ workKind: "implementation" })), /review purpose/u);
});
