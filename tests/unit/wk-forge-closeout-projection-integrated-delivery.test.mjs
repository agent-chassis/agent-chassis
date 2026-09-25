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

test("the authenticated installed commit on the closing slice is admitted and reported", () => {
  const result = authenticateWkCloseoutProjection({
    candidateRecord: candidateRecord(), liveRecord: closeoutRecord(), integratedDelivery: expectation
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.closed_slice_id, "SLICE-001");
  assert.deepEqual(result.integrated_delivery, expectation);
});

test("without, or against a different, authenticated expectation the field refuses with its identities", () => {
  const cases = [
    { integratedDelivery: null, expected: null, expectedSlice: null },
    { integratedDelivery: { slice_id: "SLICE-001", integrated_delivery_sha: ORIGINAL },
      expected: ORIGINAL, expectedSlice: "SLICE-001" },
    { integratedDelivery: { slice_id: "SLICE-002", integrated_delivery_sha: INSTALLED },
      expected: INSTALLED, expectedSlice: "SLICE-002" }
  ];
  for (const item of cases) {
    const result = authenticateWkCloseoutProjection({
      candidateRecord: candidateRecord(), liveRecord: closeoutRecord(), integratedDelivery: item.integratedDelivery
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
    candidateRecord: candidate, liveRecord: closeoutRecord(), integratedDelivery: expectation
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "integrated_delivery_unauthenticated");
  assert.equal(result.candidate_integrated_delivery_sha, ORIGINAL);
});

test("the authenticated delivery does not admit unrelated authored drift on the same slice", () => {
  const result = authenticateWkCloseoutProjection({
    candidateRecord: candidateRecord(),
    liveRecord: closeoutRecord({ title: "slice (edited after W)" }),
    integratedDelivery: expectation
  });
  assert.deepEqual(result, { ok: false, reason: "unrelated_slice_drift", slice_id: "SLICE-001" });
});

test("a closeout with no delivery delta is unchanged by an expectation", () => {
  const live = closeoutRecord();
  delete live.slices[0].integrated_delivery_sha;
  for (const integratedDelivery of [null, expectation]) {
    const result = authenticateWkCloseoutProjection({
      candidateRecord: candidateRecord(), liveRecord: live, integratedDelivery
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.integrated_delivery, null);
  }
});

test("the authenticated integration transition alone closes the slice without a new closure", () => {
  const live = closeoutRecord();
  delete live.slices[0].sections.closure;
  const result = authenticateWkCloseoutProjection({
    candidateRecord: candidateRecord(), liveRecord: live, integratedDelivery: expectation
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.closed_slice_id, "SLICE-001");
  assert.deepEqual(result.integrated_delivery, expectation);

  const unauthenticated = authenticateWkCloseoutProjection({
    candidateRecord: candidateRecord(), liveRecord: live, integratedDelivery: null
  });
  assert.equal(unauthenticated.reason, "integrated_delivery_unauthenticated");
  const drifted = structuredClone(live);
  drifted.slices[0].title = "slice (edited after W)";
  assert.deepEqual(authenticateWkCloseoutProjection({
    candidateRecord: candidateRecord(), liveRecord: drifted, integratedDelivery: expectation
  }), { ok: false, reason: "unrelated_slice_drift", slice_id: "SLICE-001" });
});

test("a bare done with neither closure nor an authenticated delivery is not a closeout", () => {
  const live = closeoutRecord();
  delete live.slices[0].integrated_delivery_sha;
  delete live.slices[0].sections.closure;
  for (const integratedDelivery of [null, expectation]) {
    assert.deepEqual(authenticateWkCloseoutProjection({
      candidateRecord: candidateRecord(), liveRecord: live, integratedDelivery
    }), { ok: false, reason: "unrelated_slice_drift", slice_id: "SLICE-001" });
  }
});
