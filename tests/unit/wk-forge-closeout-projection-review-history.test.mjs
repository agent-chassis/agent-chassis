import test from "node:test";
import assert from "node:assert/strict";

import { authenticateWkCloseoutProjection } from
  "../../packages/agent-launch-cli/src/lib/wk-forge-handoff-recovery.mjs";
import { WORK_RECORD_STATUS_VALUES } from
  "../../packages/wiki-core/src/lib/work-record-schema-constants.mjs";

const W = "a".repeat(40);
const DELIVERY = Object.freeze({ slice_id: "SLICE-002", integrated_delivery_sha: W });

function entry(id, text) {
  return {
    id,
    current_version: 1,
    versions: [{
      id: 1, title: `entry ${id}`, kind: "outcome", content: { text },
      scalar_length: text.length, utf8_bytes: Buffer.byteLength(text),
      provenance: { sources: [{ kind: "supplied_text", scalar_length: text.length, utf8_bytes: Buffer.byteLength(text) }] }
    }]
  };
}

function review(id, status, extra = {}) {
  return {
    id, title: `review ${id}`, work_kind: "review", review_purpose: "terminal_whole_wk",
    owner: "reviewer", priority: "medium", status, updated: "2026-09-20",
    depends_on: ["SLICE-002"], read_scope: ["src/b.mjs"], repo_paths: ["src/b.mjs"], write_scope: [],
    dispatch_intent: { intended_agent_role: "reviewer", target_unit: "slice" },
    acceptance: { criteria: [`findings-only review ${id}`], validation: ["review the candidate"] },
    ...extra
  };
}

function implementation(id, status, writeScope) {
  return {
    id, work_kind: "implementation", status, title: `implementation ${id}`, updated: "2026-09-20",
    write_scope: writeScope, dispatch_intent: { intended_agent_role: "worker", target_unit: "slice" },
    acceptance: { criteria: [id], validation: ["v"] }
  };
}

function candidate(reviews = []) {
  const [first = [], second = []] = [reviews.slice(0, 1), reviews.slice(1)];
  return {
    id: "WK-2672", status: "review", updated: "2026-09-20", title: "t",
    acceptance: { criteria: ["c"], validation: ["v"] },
    sections: { summary: "s", agent_notes: "", entries: [entry(1, "design")] },
    slices: [
      implementation("SLICE-001", "done", ["src/a.mjs"]),
      ...first,
      implementation("SLICE-002", "review", ["src/b.mjs"]),
      ...second,
      implementation("SLICE-004", "todo", ["src/c.mjs"])
    ]
  };
}

function live(base, mutate = () => {}) {
  const record = structuredClone(base);
  record.updated = "2026-09-24";
  const closing = record.slices.find((slice) => slice.id === "SLICE-002");
  closing.status = "done";
  closing.integrated_delivery_sha = W;
  mutate(record);
  return record;
}

const sliceOf = (record, id) => record.slices.find((slice) => slice.id === id);
const authenticate = (candidateRecord, liveRecord, publishedRecord = null) =>
  authenticateWkCloseoutProjection({ candidateRecord, liveRecord, integratedDelivery: DELIVERY, publishedRecord });

function assertAdmitted(candidateRecord, liveRecord, label, publishedRecord = null) {
  const before = structuredClone(liveRecord);
  const result = authenticate(candidateRecord, liveRecord, publishedRecord);
  assert.equal(result.ok, true, `${label}: ${JSON.stringify(result)}`);
  assert.equal(result.closed_slice_id, "SLICE-002", label);
  assert.equal(result.closeoutRecord, liveRecord, `${label}: the live record is carried, never rebuilt`);
  assert.deepEqual(liveRecord, before, `${label}: nothing is stripped from the carried record`);
  return result;
}

function assertRefused(candidateRecord, liveRecord, expected, label, publishedRecord = null) {
  const before = structuredClone(liveRecord);
  assert.deepEqual(authenticate(candidateRecord, liveRecord, publishedRecord), { ok: false, ...expected }, label);
  assert.deepEqual(liveRecord, before, `${label}: the record is untouched`);
}

const reviewDrift = (slice_id, cause, fields = []) =>
  ({ reason: "review_consumer_slice_drift", slice_id, cause, fields });

const reviewIds = (count, from = 100) => Array.from({ length: count }, (_, i) => `SLICE-${from + i}`);
const statusAt = (index) => WORK_RECORD_STATUS_VALUES[index % WORK_RECORD_STATUS_VALUES.length];

test("zero, one, three and a larger population of reviews already in C publish unchanged", () => {
  for (const count of [0, 1, 3, 24]) {
    const C = candidate(reviewIds(count).map((id, i) => review(id, statusAt(i))));
    assertAdmitted(C, live(C), `${count} unchanged reviews in C`);
  }
});

test("zero, one, three and a larger population of reviews added after C publish in every canonical status", () => {
  for (const count of [1, 3, 24]) {
    const C = candidate();
    const L = live(C, (record) => {
      record.slices.push(...reviewIds(count).map((id, i) => review(id, statusAt(i))));
    });
    assertAdmitted(C, L, `${count} reviews added after C`);
  }

  for (const status of WORK_RECORD_STATUS_VALUES) {
    const C = candidate();
    assertAdmitted(C, live(C, (record) => { record.slices.push(review("SLICE-100", status)); }), status);
  }
});

test("a review C holds may move to any canonical status with the writer's moved date; completion grants nothing", () => {
  for (const from of WORK_RECORD_STATUS_VALUES) {
    for (const to of WORK_RECORD_STATUS_VALUES) {
      const C = candidate([review("SLICE-100", from), review("SLICE-101", "done")]);
      const L = live(C, (record) => {
        sliceOf(record, "SLICE-100").status = to;
        sliceOf(record, "SLICE-100").updated = "2026-09-24";
      });
      assertAdmitted(C, L, `${from} -> ${to}`);
    }
  }
});

test("mixed retained and added reviews interleaved with implementation slices match by id", () => {
  const C = candidate([review("SLICE-100", "done"), review("SLICE-101", "cancelled"), review("SLICE-102", "todo")]);
  const L = live(C, (record) => {
    sliceOf(record, "SLICE-102").status = "active";

    record.slices.splice(1, 0, review("SLICE-103", "active"));
    record.slices.splice(4, 0, review("SLICE-104", "blocked"));
    record.slices.push(review("SLICE-105", "done"));
  });
  assertAdmitted(C, L, "mixed");

  const swapped = live(C, (record) => {
    const a = sliceOf(record, "SLICE-100");
    const b = sliceOf(record, "SLICE-101");
    Object.assign(a, { ...b, id: "SLICE-100" });
    Object.assign(b, { ...review("SLICE-100", "done"), id: "SLICE-101" });
  });
  assertRefused(C, swapped, reviewDrift("SLICE-100", "candidate_review_changed", ["acceptance", "title"]), "swapped");

  const skipped = live(C, (record) => {
    const index = record.slices.findIndex((slice) => slice.id === "SLICE-004");
    record.slices[index] = review("SLICE-004", "todo");
  });
  assertRefused(C, skipped, reviewDrift("SLICE-004", "review_purpose_changed", ["review_purpose"]), "skipped");
});

test("entries and notes compose with review history on the parent, on retained reviews and after a publication", () => {
  const C = candidate([review("SLICE-100", "done", { sections: { entries: [entry(3, "review finding")] } }),
    review("SLICE-101", "todo")]);
  const L = live(C, (record) => {
    record.sections.entries.push(entry(2, "outcome"));
    record.sections.agent_notes = "handoff notes";
    sliceOf(record, "SLICE-100").sections.entries.push(entry(4, "disposition"));
    sliceOf(record, "SLICE-101").sections = { agent_notes: "review notes" };
    sliceOf(record, "SLICE-101").status = "active";
    sliceOf(record, "SLICE-101").updated = "2026-09-24";
    record.slices.push(review("SLICE-102", "active", { sections: { entries: [entry(5, "added review note")] } }));
    record.slices.push(review("SLICE-103", "done"));
  });
  const result = assertAdmitted(C, L, "composed");
  assert.deepEqual(result.appended_entries, [
    { unit: "WK-2672", entry_ids: [2] }, { unit: "WK-2672#SLICE-100", entry_ids: [4] }
  ]);
  assert.deepEqual(result.replaced_notes, ["WK-2672", "WK-2672#SLICE-101"]);

  const K = structuredClone(L);
  const refreshed = live(K, (record) => {
    sliceOf(record, "SLICE-102").status = "done";
    record.slices = record.slices.filter((slice) => slice.id !== "SLICE-103");
    record.slices.push(review("SLICE-104", "todo"));
  });
  assertAdmitted(C, refreshed, "refresh", K);

  const erasedC = live(K, (record) => { sliceOf(record, "SLICE-100").sections.entries.shift(); });
  assertRefused(C, erasedC, { reason: "entry_history_drift", unit: "WK-2672#SLICE-100" }, "C entry erased", K);
  const erasedK = live(K, (record) => { sliceOf(record, "SLICE-100").sections.entries.pop(); });
  assert.equal(authenticate(C, erasedK).ok, true, "C alone does not know K's entry");
  assertRefused(C, erasedK, { reason: "entry_history_drift", unit: "WK-2672#SLICE-100" }, "K entry erased", K);
  const droppedK = live(K, (record) => { record.slices = record.slices.filter((slice) => slice.id !== "SLICE-102"); });
  assert.equal(authenticate(C, droppedK).ok, true, "C alone does not know the added review");
  assertRefused(C, droppedK, { reason: "entry_history_drift", unit: "WK-2672#SLICE-102" },
    "K review with history removed", K);
});

function multipleReviewState() {
  const C = candidate([review("SLICE-100", "done"), review("SLICE-101", "cancelled")]);
  const valid = (mutate) => live(C, (record) => {
    sliceOf(record, "SLICE-101").status = "active";
    record.slices.push(review("SLICE-102", "active"), review("SLICE-103", "review"));
    mutate(record);
  });
  return { C, valid };
}

test("paired refusals: implementation, scope and delivery stay protected beside multiple reviews", () => {
  const { C, valid } = multipleReviewState();
  assertAdmitted(C, valid(() => {}), "the unmutated pair");
  assertRefused(C, valid((record) => { record.acceptance.criteria = ["relaxed"]; }),
    { reason: "unrelated_record_drift", fields: ["acceptance.criteria"] }, "parent acceptance");
  assertRefused(C, valid((record) => { record.sections.summary = "rewritten"; }),
    { reason: "unrelated_sections_drift" }, "parent summary");
  assertRefused(C, valid((record) => { sliceOf(record, "SLICE-004").write_scope = ["src/other.mjs"]; }),
    { reason: "unrelated_slice_drift", slice_id: "SLICE-004" }, "implementation write scope");
  const replayed = "b".repeat(40);
  assertRefused(C, valid((record) => { sliceOf(record, "SLICE-002").integrated_delivery_sha = replayed; }), {
    reason: "integrated_delivery_unauthenticated", slice_id: "SLICE-002", expected_slice_id: "SLICE-002",
    expected_integrated_delivery_sha: W, candidate_integrated_delivery_sha: null,
    observed_integrated_delivery_sha: replayed
  }, "the original delivery in place of the installed commit");
});

test("paired refusals: a writable or worker slice cannot pass as a review, and review history cannot be lost", () => {
  const { C, valid } = multipleReviewState();

  assertRefused(C, valid((record) => {
    Object.assign(sliceOf(record, "SLICE-004"), { review_purpose: "terminal_whole_wk", work_kind: "review",
      write_scope: [], dispatch_intent: { intended_agent_role: "reviewer", target_unit: "slice" } });
  }), reviewDrift("SLICE-004", "review_purpose_changed", ["review_purpose"]), "relabeled implementation");

  assertRefused(C, valid((record) => { delete sliceOf(record, "SLICE-100").review_purpose; }),
    reviewDrift("SLICE-100", "review_purpose_changed", ["review_purpose"]), "untagged review");

  assertRefused(C, valid((record) => { sliceOf(record, "SLICE-103").write_scope = ["src/b.mjs"]; }),
    reviewDrift("SLICE-103", "non_canonical_review_addition", ["write_scope"]), "writable review");
  assertRefused(C, valid((record) => { sliceOf(record, "SLICE-103").dispatch_intent.intended_agent_role = "worker"; }),
    reviewDrift("SLICE-103", "non_canonical_review_addition", ["dispatch_intent.intended_agent_role"]),
    "worker review");
  assertRefused(C, valid((record) => { sliceOf(record, "SLICE-103").status = "in_progress"; }),
    reviewDrift("SLICE-103", "non_canonical_review_addition", ["status"]), "non-canonical added status");
  assertRefused(C, valid((record) => { sliceOf(record, "SLICE-100").status = "in_progress"; }),
    reviewDrift("SLICE-100", "candidate_review_changed", ["status"]), "non-canonical retained status");

  assertRefused(C, valid((record) => { record.slices = record.slices.filter((slice) => slice.id !== "SLICE-100"); }),
    reviewDrift("SLICE-100", "candidate_review_removed"), "removed retained review");
  assertRefused(C, valid((record) => {
    sliceOf(record, "SLICE-101").acceptance.criteria = ["rewritten"];
    sliceOf(record, "SLICE-101").write_scope = ["src/b.mjs"];
  }), reviewDrift("SLICE-101", "candidate_review_changed", ["acceptance", "write_scope"]), "rewritten review");

  assertRefused(C, valid((record) => { record.slices.push(review("SLICE-100", "done")); }),
    reviewDrift("SLICE-100", "duplicate_slice_id", ["id"]), "duplicate id");

  const withHistory = live(C, (record) => { record.sections.entries = []; });
  assertRefused(C, withHistory, { reason: "entry_history_drift", unit: "WK-2672" }, "parent history erased");
});
