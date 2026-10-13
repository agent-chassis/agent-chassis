import test from "node:test";
import assert from "node:assert/strict";

import { authenticateWkCloseoutProjection } from
  "../../packages/agent-launch-cli/src/lib/wk-forge-handoff-recovery.mjs";

const INSTALLED = "a".repeat(40);
const ORIGINAL = "b".repeat(40);

function candidateRecord() {
  return {
    id: "WK-2672",
    status: "active",
    updated: "2026-09-20",
    title: "t",
    sections: { summary: "s" },
    slices: [{
      id: "SLICE-001",
      work_kind: "implementation",
      status: "review",
      title: "slice",
      updated: "2026-09-20",
      sections: { summary: "x" }
    }]
  };
}

function closeoutRecord(sliceOverrides = {}) {
  const record = structuredClone(candidateRecord());
  record.status = "review";
  record.updated = "2026-09-24";
  Object.assign(record.slices[0], {
    status: "done",
    integrated_delivery_sha: INSTALLED,
    sections: { summary: "x", closure: { summary: "done", validation: [], follow_ups: [] } }
  }, sliceOverrides);
  return record;
}

const expectation = Object.freeze({ slice_id: "SLICE-001", integrated_delivery_sha: INSTALLED });

const row = (change) => (path, candidate_value, observed_value) =>
  ({ path, change, candidate_value, observed_value });
const unsupportedRow = row("unsupported");
const closeoutRow = row("slice_closeout");
const sliceDrift = (slice_id, cause, fields, differences) =>
  ({ ok: false, reason: "unrelated_slice_drift", slice_id, cause, fields, differences });

test("the authenticated installed commit on the closing slice is admitted and reported", () => {
  const result = authenticateWkCloseoutProjection({
    candidateRecord: candidateRecord(), liveRecord: closeoutRecord(), integratedDeliveries: [expectation]
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.closed_slice_ids, ["SLICE-001"]);
  assert.deepEqual(result.integrated_deliveries, [expectation]);
});

test("without, or against a different, authenticated expectation the field refuses with its identities", () => {
  const cases = [
    { integratedDeliveries: [], expected: null, expectedSlice: null },
    { integratedDeliveries: [{ slice_id: "SLICE-001", integrated_delivery_sha: ORIGINAL }],
      expected: ORIGINAL, expectedSlice: "SLICE-001" },

    { integratedDeliveries: [{ slice_id: "SLICE-002", integrated_delivery_sha: INSTALLED }],
      expected: null, expectedSlice: null }
  ];
  for (const item of cases) {
    const result = authenticateWkCloseoutProjection({
      candidateRecord: candidateRecord(), liveRecord: closeoutRecord(), integratedDeliveries: item.integratedDeliveries
    });
    assert.deepEqual(result, {
      ok: false,
      reason: "integrated_delivery_unauthenticated",
      slice_id: "SLICE-001",
      expected_slice_id: item.expectedSlice,
      expected_integrated_delivery_sha: item.expected,
      candidate_integrated_delivery_sha: null,
      observed_integrated_delivery_sha: INSTALLED
    });
  }
});

test("a value C already carries is never replaced, even by the authenticated commit", () => {
  const candidate = candidateRecord();
  candidate.slices[0].integrated_delivery_sha = ORIGINAL;
  const result = authenticateWkCloseoutProjection({
    candidateRecord: candidate, liveRecord: closeoutRecord(), integratedDeliveries: [expectation]
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "integrated_delivery_unauthenticated");
  assert.equal(result.candidate_integrated_delivery_sha, ORIGINAL);
});

test("the authenticated delivery does not admit unrelated authored drift on the same slice", () => {
  const result = authenticateWkCloseoutProjection({
    candidateRecord: candidateRecord(),
    liveRecord: closeoutRecord({ title: "slice (edited after W)" }),
    integratedDeliveries: [expectation]
  });

  assert.deepEqual(result, sliceDrift("SLICE-001", "unsupported_change", ["title"], [
    closeoutRow("integrated_delivery_sha", null, INSTALLED), closeoutRow("status", "review", "done"),
    unsupportedRow("title", "slice", "slice (edited after W)"),
    closeoutRow("sections.closure", null, { summary: "done", validation: [], follow_ups: [] })]));
});

test("a closeout with no delivery delta is unchanged by an expectation", () => {
  const live = closeoutRecord();
  delete live.slices[0].integrated_delivery_sha;
  for (const integratedDeliveries of [[], [expectation]]) {
    const result = authenticateWkCloseoutProjection({
      candidateRecord: candidateRecord(), liveRecord: live, integratedDeliveries
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(result.integrated_deliveries, []);
  }
});

test("the authenticated integration transition alone closes the slice without a new closure", () => {
  const live = closeoutRecord();
  delete live.slices[0].sections.closure;
  const result = authenticateWkCloseoutProjection({
    candidateRecord: candidateRecord(), liveRecord: live, integratedDeliveries: [expectation]
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.closed_slice_ids, ["SLICE-001"]);
  assert.deepEqual(result.integrated_deliveries, [expectation]);

  const unauthenticated = authenticateWkCloseoutProjection({
    candidateRecord: candidateRecord(), liveRecord: live, integratedDeliveries: []
  });
  assert.equal(unauthenticated.reason, "integrated_delivery_unauthenticated");
  const drifted = structuredClone(live);
  drifted.slices[0].title = "slice (edited after W)";
  assert.deepEqual(authenticateWkCloseoutProjection({
    candidateRecord: candidateRecord(), liveRecord: drifted, integratedDeliveries: [expectation]
  }), sliceDrift("SLICE-001", "unsupported_change", ["title"], [
    closeoutRow("integrated_delivery_sha", null, INSTALLED), closeoutRow("status", "review", "done"),
    unsupportedRow("title", "slice", "slice (edited after W)")]));
});

const SECOND = "c".repeat(40);
const second = Object.freeze({ slice_id: "SLICE-002", integrated_delivery_sha: SECOND });

function twoSliceCandidate() {
  const record = candidateRecord();
  record.slices.push({ ...structuredClone(record.slices[0]), id: "SLICE-002", title: "second" });
  return record;
}

function twoSliceLive(mutate = () => {}) {
  const record = twoSliceCandidate();
  record.updated = "2026-09-24";
  Object.assign(record.slices[0], { status: "done", integrated_delivery_sha: INSTALLED });
  Object.assign(record.slices[1], { status: "done", integrated_delivery_sha: SECOND });
  mutate(record);
  return record;
}

test("every integrated slice C holds closes by its own authenticated delivery", () => {
  const live = twoSliceLive();
  const result = authenticateWkCloseoutProjection({
    candidateRecord: twoSliceCandidate(), liveRecord: live, integratedDeliveries: [expectation, second]
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.closed_slice_ids, ["SLICE-001", "SLICE-002"]);
  assert.deepEqual(result.integrated_deliveries, [expectation, second]);
  assert.deepEqual(result.added_slice_ids, []);
  assert.equal(result.closeoutRecord, live, "the observed live record is carried");

  const refusal = (slice_id, observed, expected = null) => ({
    ok: false, reason: "integrated_delivery_unauthenticated", slice_id,
    expected_slice_id: expected === null ? null : slice_id, expected_integrated_delivery_sha: expected,
    candidate_integrated_delivery_sha: null, observed_integrated_delivery_sha: observed
  });
  const authenticate = (liveRecord, integratedDeliveries) => authenticateWkCloseoutProjection({
    candidateRecord: twoSliceCandidate(), liveRecord, integratedDeliveries });
  assert.deepEqual(authenticate(live, [expectation]), refusal("SLICE-002", SECOND));
  assert.deepEqual(authenticate(live, [second]), refusal("SLICE-001", INSTALLED));
  assert.deepEqual(authenticate(live, []), refusal("SLICE-001", INSTALLED));

  const swapped = twoSliceLive((record) => {
    record.slices[0].integrated_delivery_sha = SECOND;
    record.slices[1].integrated_delivery_sha = INSTALLED;
  });
  assert.deepEqual(authenticate(swapped, [expectation, second]), refusal("SLICE-001", SECOND, INSTALLED));

  const drifted = twoSliceLive((record) => { record.slices[1].title = "second (edited after W)"; });
  assert.deepEqual(authenticate(drifted, [expectation, second]), sliceDrift("SLICE-002", "unsupported_change",
    ["title"], [closeoutRow("integrated_delivery_sha", null, SECOND), closeoutRow("status", "review", "done"),
      unsupportedRow("title", "second", "second (edited after W)")]));

  const closure = { summary: "done", validation: [], follow_ups: [] };
  const mixed = twoSliceLive((record) => {
    delete record.slices[1].integrated_delivery_sha;
    record.slices[1].sections = { ...record.slices[1].sections, closure };
  });
  assert.deepEqual(authenticate(mixed, [expectation]).closed_slice_ids, ["SLICE-001", "SLICE-002"]);
  const closures = twoSliceLive((record) => {
    for (const slice of record.slices) {
      delete slice.integrated_delivery_sha;
      slice.sections = { ...slice.sections, closure };
    }
  });
  assert.equal(authenticate(closures, []).cause, "another_slice_closes");
});

test("a slice shaped after C is carried only as its own authenticated integrated delivery", () => {
  const added = (overrides = {}) => ({ id: "SLICE-002", work_kind: "implementation", status: "done",
    title: "correction", write_scope: ["src/correction.mjs"], integrated_delivery_sha: SECOND, ...overrides });
  const live = (slice, mutate = () => {}) => {
    const record = closeoutRecord();
    record.slices.push(slice);
    mutate(record);
    return record;
  };
  const authenticate = (liveRecord, integratedDeliveries = [expectation, second]) =>
    authenticateWkCloseoutProjection({ candidateRecord: candidateRecord(), liveRecord, integratedDeliveries });
  const carried = live(added());
  const result = authenticate(carried);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.closed_slice_ids, ["SLICE-001"]);
  assert.deepEqual(result.added_slice_ids, ["SLICE-002"]);
  assert.deepEqual(result.integrated_deliveries, [expectation, second]);
  assert.equal(result.closeoutRecord, carried);

  for (const [label, deliveries, expected] of [
    ["no expectation", [expectation], null],
    ["a different commit", [expectation, { slice_id: "SLICE-002", integrated_delivery_sha: ORIGINAL }], ORIGINAL]
  ]) {
    assert.deepEqual(authenticate(carried, deliveries), {
      ok: false, reason: "integrated_delivery_unauthenticated", slice_id: "SLICE-002",
      expected_slice_id: expected === null ? null : "SLICE-002", expected_integrated_delivery_sha: expected,
      candidate_integrated_delivery_sha: null, observed_integrated_delivery_sha: SECOND
    }, label);
  }

  for (const [label, slice] of [
    ["unintegrated", added({ status: "todo", integrated_delivery_sha: undefined })],
    ["done with no delivery", added({ integrated_delivery_sha: null })],
    ["delivered but not done", added({ status: "review" })],
    ["not an implementation slice", added({ work_kind: "design" })]
  ]) {
    assert.deepEqual(authenticate(live(slice)), { ok: false, reason: "slice_cardinality", slice_id: "SLICE-002" }, label);
  }

  assert.deepEqual(authenticate(live(added(), (record) => { record.slices.reverse(); })).ok, true,
    "an addition may sit anywhere");
  assert.deepEqual(authenticate(live(added(), (record) => { record.slices.shift(); })),
    { ok: false, reason: "slice_removed" });
  assert.equal(authenticate(live(added(), (record) => { record.slices[0].title = "retitled"; })).reason,
    "unrelated_slice_drift");
  assert.deepEqual(authenticate(live(added(), (record) => { record.acceptance = { criteria: ["relaxed"] }; })).reason,
    "unrelated_record_drift");

  const published = structuredClone(carried);
  const refreshed = (liveRecord, integratedDeliveries) => authenticateWkCloseoutProjection({
    candidateRecord: candidateRecord(), liveRecord, integratedDeliveries, publishedRecord: published });
  assert.equal(refreshed(structuredClone(carried), [expectation, second]).ok, true);
  assert.equal(authenticate(closeoutRecord(), [expectation]).ok, true, "C alone does not know K's slice");
  assert.deepEqual(refreshed(closeoutRecord(), [expectation]),
    { ok: false, reason: "published_closeout_drift", unit: "WK-2672#SLICE-002", field: "status" });
});

test("a bare done with neither closure nor an authenticated delivery is not a closeout", () => {
  const live = closeoutRecord();
  delete live.slices[0].integrated_delivery_sha;
  delete live.slices[0].sections.closure;
  for (const integratedDeliveries of [[], [expectation]]) {
    assert.deepEqual(authenticateWkCloseoutProjection({
      candidateRecord: candidateRecord(), liveRecord: live, integratedDeliveries
    }), sliceDrift("SLICE-001", "not_a_slice_closeout", ["status"], [closeoutRow("status", "review", "done")]));
  }
});
