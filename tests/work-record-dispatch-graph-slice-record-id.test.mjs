

import test from "node:test";
import assert from "node:assert/strict";

import {
  graphImpactMatchesSubject,
  normalizeGraphImpactEvidence
} from "../packages/wiki-core/src/lib/work-record-dispatch-graph.mjs";

const PARENT_WK_ID = "WK-0813";
const SELECTED_SLICE_ID = "slice-graph-impact-record-id-matcher-source";
const SIBLING_SLICE_ID = "slice-graph-impact-record-id-regression";
const OTHER_WK_ID = "WK-9999";

const GRAPH_BEARING_PATH = "packages/wiki-core/src/lib/work-record-dispatch-graph.mjs";

function availableGraphState(overrides = {}) {
  return {
    dirty_state: "clean",
    staleness: "fresh",
    graph_available: true,
    edge_source: "base_index",
    dirty_graph_mode: "base_index_only",
    graph_schema_version: "repo-code-graph.v1",
    unavailable_paths: [],
    ...overrides
  };
}

function selectedSliceSubject() {
  return {
    id: SELECTED_SLICE_ID,
    kind: "slice",
    slice_id: SELECTED_SLICE_ID,
    write_scope: [GRAPH_BEARING_PATH],
    repo_paths: [GRAPH_BEARING_PATH]
  };
}

function sliceUnit(sliceId = SELECTED_SLICE_ID, recordId = PARENT_WK_ID) {
  return {
    kind: "slice",
    address: `${recordId}#${sliceId}`,
    record_id: recordId,
    slice_id: sliceId
  };
}

function sliceBoundGraphImpact({
  recordId = PARENT_WK_ID,
  unitRecordId = PARENT_WK_ID,
  sliceId = SELECTED_SLICE_ID,
  validatedPaths = [GRAPH_BEARING_PATH],
  graphState = availableGraphState()
} = {}) {
  return normalizeGraphImpactEvidence({
    query_kind: "graph_impact_paths",
    record_id: recordId,
    input_paths: validatedPaths,
    validated_paths: validatedPaths,
    invalid_paths: [],
    unit: {
      kind: "slice",
      record_id: unitRecordId,
      slice_id: sliceId
    },
    graph_state: graphState,
    summary: { canonical_refs: [] }
  });
}

test("selected-slice graph evidence bound to the parent WK id matches via the derived-evidence (scopeUnit) path", () => {
  const subject = selectedSliceSubject();
  const unit = sliceUnit();
  const scopeUnit = sliceUnit();
  const graphImpact = sliceBoundGraphImpact();

  assert.notEqual(subject.id, PARENT_WK_ID);
  assert.equal(graphImpact.record_id, PARENT_WK_ID);
  assert.equal(graphImpact.unit.record_id, PARENT_WK_ID);
  assert.equal(graphImpact.unit.slice_id, SELECTED_SLICE_ID);

  assert.equal(
    graphImpactMatchesSubject(graphImpact, subject, unit, scopeUnit),
    true
  );
});

test("selected-slice graph evidence bound to the parent WK id matches via the inline (no scopeUnit) path", () => {
  const subject = selectedSliceSubject();
  const unit = sliceUnit();
  const graphImpact = sliceBoundGraphImpact();

  assert.equal(graphImpactMatchesSubject(graphImpact, subject, unit, null), true);
});

test("sibling-slice graph evidence fails closed for the selected slice (derived-evidence path)", () => {
  const subject = selectedSliceSubject();
  const unit = sliceUnit();

  const graphImpact = sliceBoundGraphImpact({ sliceId: SIBLING_SLICE_ID });
  const scopeUnit = sliceUnit(SIBLING_SLICE_ID);

  assert.equal(
    graphImpactMatchesSubject(graphImpact, subject, unit, scopeUnit),
    false
  );
});

test("sibling-slice graph evidence fails closed for the selected slice (inline path)", () => {
  const subject = selectedSliceSubject();
  const unit = sliceUnit();
  const graphImpact = sliceBoundGraphImpact({ sliceId: SIBLING_SLICE_ID });

  assert.equal(graphImpactMatchesSubject(graphImpact, subject, unit, null), false);
});

test("wrong-record graph evidence fails closed even when the slice id matches (top-level record_id)", () => {
  const subject = selectedSliceSubject();
  const unit = sliceUnit();
  const graphImpact = sliceBoundGraphImpact({ recordId: OTHER_WK_ID });

  assert.equal(graphImpactMatchesSubject(graphImpact, subject, unit, null), false);
});

test("wrong-record graph evidence fails closed even when the slice id matches (nested unit.record_id)", () => {
  const subject = selectedSliceSubject();
  const unit = sliceUnit();
  const graphImpact = sliceBoundGraphImpact({ unitRecordId: OTHER_WK_ID });
  const scopeUnit = { kind: "slice", record_id: OTHER_WK_ID, slice_id: SELECTED_SLICE_ID };

  assert.equal(
    graphImpactMatchesSubject(graphImpact, subject, unit, scopeUnit),
    false
  );

  assert.equal(graphImpactMatchesSubject(graphImpact, subject, unit, null), false);
});

test("work-item graph evidence keyed on the WK id still matches (work-item semantics intact)", () => {
  const subject = {
    id: PARENT_WK_ID,
    kind: "work_item",
    write_scope: [GRAPH_BEARING_PATH],
    repo_paths: [GRAPH_BEARING_PATH]
  };
  const unit = { kind: "work_item", address: PARENT_WK_ID, record_id: PARENT_WK_ID };
  const graphImpact = normalizeGraphImpactEvidence({
    query_kind: "graph_impact_paths",
    record_id: PARENT_WK_ID,
    input_paths: [GRAPH_BEARING_PATH],
    validated_paths: [GRAPH_BEARING_PATH],
    invalid_paths: [],
    unit: { kind: "work_item", record_id: PARENT_WK_ID },
    graph_state: availableGraphState(),
    summary: { canonical_refs: [] }
  });

  assert.equal(graphImpactMatchesSubject(graphImpact, subject, unit, null), true);
});

test("work-item graph evidence with a slice id fails closed for a work-item unit", () => {
  const subject = {
    id: PARENT_WK_ID,
    kind: "work_item",
    write_scope: [GRAPH_BEARING_PATH],
    repo_paths: [GRAPH_BEARING_PATH]
  };
  const unit = { kind: "work_item", address: PARENT_WK_ID, record_id: PARENT_WK_ID };

  const graphImpact = normalizeGraphImpactEvidence({
    query_kind: "graph_impact_paths",
    record_id: PARENT_WK_ID,
    input_paths: [GRAPH_BEARING_PATH],
    validated_paths: [GRAPH_BEARING_PATH],
    invalid_paths: [],
    unit: { kind: "slice", record_id: PARENT_WK_ID, slice_id: SELECTED_SLICE_ID },
    graph_state: availableGraphState(),
    summary: { canonical_refs: [] }
  });

  assert.equal(graphImpactMatchesSubject(graphImpact, subject, unit, null), false);
});

test("selected-slice evidence with uncovered graph-bearing paths fails closed (path coverage intact)", () => {
  const subject = selectedSliceSubject();
  const unit = sliceUnit();

  const graphImpact = sliceBoundGraphImpact({
    validatedPaths: ["packages/wiki-core/src/lib/some-other-module.mjs"]
  });

  assert.equal(graphImpactMatchesSubject(graphImpact, subject, unit, null), false);
});
