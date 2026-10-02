import test from "node:test";
import assert from "node:assert/strict";

import { authenticateWkCloseoutProjection } from
  "../../packages/agent-launch-cli/src/lib/wk-forge-handoff-recovery.mjs";

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

const CLOSURE = Object.freeze({ summary: "closed", validation: ["witness"], follow_ups: [] });

function candidateRecord() {
  return {
    id: "WK-2672",
    status: "review",
    updated: "2026-09-20",
    title: "t",
    acceptance: { criteria: ["c"], validation: ["v"] },
    sections: { summary: "s", tasks: ["t"], agent_notes: "", entries: [entry(1, "design")] },
    slices: [
      {
        id: "SLICE-001", work_kind: "implementation", status: "done", title: "earlier",
        updated: "2026-09-20", write_scope: ["src/a.mjs"],
        sections: { summary: "x", agent_notes: "", closure: CLOSURE }
      },
      {
        id: "SLICE-002", work_kind: "implementation", status: "review", title: "closing",
        updated: "2026-09-20", write_scope: ["src/b.mjs"],
        acceptance: { criteria: ["b"], validation: ["v"] }
      },
      {
        id: "SLICE-003", title: "review", work_kind: "review", review_purpose: "terminal_whole_wk",
        status: "todo", updated: "2026-09-20", write_scope: [],
        dispatch_intent: { intended_agent_role: "reviewer", target_unit: "slice" }
      }
    ]
  };
}

function publishedRecord() {
  const record = structuredClone(candidateRecord());
  record.updated = "2026-09-22";
  record.sections.closure = CLOSURE;
  record.sections.entries.push(entry(2, "outcome"));
  record.slices[1] = { ...record.slices[1], status: "done", updated: "2026-09-22", sections: { closure: CLOSURE } };
  return record;
}

function edited(mutate, base = publishedRecord()) {
  const record = structuredClone(base);
  record.updated = "2026-09-24";
  mutate(record);
  return record;
}

const authenticate = (liveRecord, { published = null } = {}) =>
  authenticateWkCloseoutProjection({
    candidateRecord: candidateRecord(), liveRecord, publishedRecord: published
  });

test("parent notes replacement is admitted and counts as the closeout change beside a moved updated", () => {
  const live = edited((record) => { record.sections.agent_notes = "handoff follow-up"; });
  const result = authenticate(live, { published: publishedRecord() });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.replaced_notes, ["WK-2672"]);
  assert.equal(result.closed_slice_id, "SLICE-002");
  assert.equal(result.closeoutRecord, live, "the observed live record is carried, never rebuilt");

  const notesOnly = structuredClone(candidateRecord());
  notesOnly.updated = "2026-09-24";
  notesOnly.sections.agent_notes = ["line one", "line two"];
  const alone = authenticate(notesOnly);
  assert.equal(alone.ok, true, JSON.stringify(alone));
  assert.equal(alone.closed_slice_id, null);
});

test("notes on an earlier slice, the closing slice and the review slice are admitted without extra closures", () => {
  const live = edited((record) => {
    record.slices[0].sections.agent_notes = "earlier slice note";
    record.slices[0].updated = "2026-09-24";
    record.slices[1].sections.agent_notes = "closing slice note";
    record.slices[1].updated = "2026-09-24";
    record.slices[2].sections = { agent_notes: "review slice note" };
    record.slices[2].updated = "2026-09-24";
  });
  const result = authenticate(live, { published: publishedRecord() });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.closed_slice_id, "SLICE-002", "only the closing slice closes");
  assert.deepEqual(result.replaced_notes,
    ["WK-2672#SLICE-001", "WK-2672#SLICE-002", "WK-2672#SLICE-003"]);
});

test("notes never carry a protected-field change past its specific cause", () => {
  const cases = [
    [(record) => { record.sections.summary = "rewritten"; }, { reason: "unrelated_sections_drift" }],
    [(record) => { record.sections.tasks = ["t", "new task"]; }, { reason: "unrelated_sections_drift" }],
    [(record) => { record.acceptance.criteria = ["changed"]; },
      { reason: "unrelated_record_drift", fields: ["acceptance.criteria"] }],
    [(record) => { record.slices[0].write_scope = ["src/other.mjs"]; },
      { reason: "unrelated_slice_drift", slice_id: "SLICE-001" }],
    [(record) => { record.slices[0].sections.summary = "rewritten"; },
      { reason: "unrelated_slice_drift", slice_id: "SLICE-001" }],
    [(record) => { record.slices[2].title = "renamed review"; }, {
      reason: "review_consumer_slice_drift", slice_id: "SLICE-003", cause: "candidate_review_changed", fields: ["title"]
    }]
  ];
  for (const [mutate, expected] of cases) {
    const live = edited((record) => {
      record.sections.agent_notes = "notes beside a contract change";
      record.slices[0].sections.agent_notes = "slice notes";
      mutate(record);
    });
    assert.deepEqual(authenticate(live, { published: publishedRecord() }), { ok: false, ...expected });
  }
});

test("a notes value outside the schema shape, or a slice date C never held, is not admitted", () => {
  const object = edited((record) => { record.sections.agent_notes = { text: "not notes" }; });
  assert.deepEqual(authenticate(object), { ok: false, reason: "unrelated_sections_drift" });
  const candidate = candidateRecord();
  delete candidate.slices[0].updated;
  const live = structuredClone(candidate);
  live.updated = "2026-09-24";
  live.slices[0].sections.agent_notes = "note";
  live.slices[0].updated = "2026-09-24";
  assert.deepEqual(authenticateWkCloseoutProjection({ candidateRecord: candidate, liveRecord: live }),
    { ok: false, reason: "unrelated_slice_drift", slice_id: "SLICE-001" });
});

test("a refresh preserves every entry the published closeout carries under the exact-prefix rule", () => {
  const appended = edited((record) => { record.sections.entries.push(entry(3, "later")); });
  assert.equal(authenticate(appended, { published: publishedRecord() }).ok, true);

  const removed = edited((record) => { record.sections.entries.pop(); record.sections.agent_notes = "n"; });
  assert.equal(authenticate(removed).ok, true, "C alone does not know K's entry");
  assert.deepEqual(authenticate(removed, { published: publishedRecord() }),
    { ok: false, reason: "entry_history_drift", unit: "WK-2672" });

  const rewritten = edited((record) => { record.sections.entries[1] = entry(2, "rewritten outcome"); });
  assert.deepEqual(authenticate(rewritten, { published: publishedRecord() }),
    { ok: false, reason: "entry_history_drift", unit: "WK-2672" });

  const versioned = edited((record) => {
    const [version] = record.sections.entries[1].versions;
    record.sections.entries[1] = {
      ...record.sections.entries[1], current_version: 2, versions: [version, { ...version, id: 2 }]
    };
  });
  assert.deepEqual(authenticate(versioned, { published: publishedRecord() }),
    { ok: false, reason: "entry_history_drift", unit: "WK-2672" });
});

test("a refresh keeps the published parent closure and the published slice closeout exactly", () => {

  const published = publishedRecord();
  published.slices[1].integrated_delivery_sha = "a".repeat(40);
  const cases = [
    [(record) => { record.sections.closure = null; }, { unit: "WK-2672", field: "sections.closure" }],
    [(record) => { record.sections.closure = { ...CLOSURE, summary: "other" }; },
      { unit: "WK-2672", field: "sections.closure" }],
    [(record) => { record.slices[1].sections = {}; }, { unit: "WK-2672#SLICE-002", field: "sections.closure" }],
    [(record) => { delete record.slices[1].integrated_delivery_sha; },
      { unit: "WK-2672#SLICE-002", field: "integrated_delivery_sha" }]
  ];
  for (const [mutate, facts] of cases) {
    const live = edited((record) => { record.sections.agent_notes = "n"; mutate(record); }, published);
    const integratedDelivery = { slice_id: "SLICE-002", integrated_delivery_sha: "a".repeat(40) };
    assert.equal(authenticateWkCloseoutProjection({
      candidateRecord: candidateRecord(), liveRecord: live, integratedDelivery
    }).ok, true, `C alone admits ${JSON.stringify(facts)}`);
    assert.deepEqual(authenticateWkCloseoutProjection({
      candidateRecord: candidateRecord(), liveRecord: live, integratedDelivery, publishedRecord: published
    }), { ok: false, reason: "published_closeout_drift", ...facts });
  }
  const reopened = edited((record) => {
    record.slices[1] = candidateRecord().slices[1];
    record.sections.agent_notes = "n";
  });
  assert.equal(authenticate(reopened).ok, true, "C alone admits the unclosed slice");
  assert.deepEqual(authenticate(reopened, { published: publishedRecord() }),
    { ok: false, reason: "published_closeout_drift", unit: "WK-2672#SLICE-002", field: "status" });
});

const POLICY = "forge_confirmed_merge";
const POLICY_DRIFT = Object.freeze({ ok: false, reason: "unrelated_record_drift", field: "completion_policy" });

test("a completion policy absent from C may be introduced with its canonical value, alone or beside the closeout", () => {
  const introduced = edited((record) => { record.completion_policy = POLICY; });
  const result = authenticate(introduced);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.closeoutRecord, introduced, "the observed policy is carried, never stripped");

  const alone = structuredClone(candidateRecord());
  alone.updated = "2026-09-24";
  alone.slices = alone.slices.filter((slice) => slice.review_purpose !== "terminal_whole_wk");
  const reviewFree = { ...structuredClone(alone), updated: "2026-09-20" };
  alone.completion_policy = POLICY;
  assert.equal(authenticateWkCloseoutProjection({ candidateRecord: reviewFree, liveRecord: alone }).ok, true);
  assert.equal(authenticateWkCloseoutProjection({
    candidateRecord: reviewFree, liveRecord: { ...structuredClone(alone), updated: "2026-09-20" }
  }).ok, true, "equally when the date is unchanged");
  const unshaped = { ...structuredClone(reviewFree), status: "review" };
  assert.equal(authenticateWkCloseoutProjection({ candidateRecord: reviewFree, liveRecord: unshaped }).ok, true,
    "no policy is required");
});

test("an established policy stays exactly; removal, replacement and invalid values refuse by field", () => {
  const candidate = { ...candidateRecord(), completion_policy: POLICY };
  const retained = edited((record) => { record.sections.agent_notes = "n"; }, candidate);
  assert.equal(authenticateWkCloseoutProjection({ candidateRecord: candidate, liveRecord: retained }).ok, true);
  for (const [label, mutate] of [
    ["removal", (record) => { delete record.completion_policy; }],
    ["replacement", (record) => { record.completion_policy = "direct_done"; }],
    ["null", (record) => { record.completion_policy = null; }]
  ]) {
    const live = edited((record) => { record.sections.agent_notes = "n"; mutate(record); }, candidate);
    assert.deepEqual(authenticateWkCloseoutProjection({ candidateRecord: candidate, liveRecord: live }),
      POLICY_DRIFT, label);
  }
  for (const value of ["direct_done", "", null, ["forge_confirmed_merge"]]) {
    const live = edited((record) => { record.completion_policy = value; });
    assert.deepEqual(authenticate(live), POLICY_DRIFT, `introduced ${JSON.stringify(value)}`);
  }
});

test("an introduced policy never carries unrelated protected drift", () => {
  const live = edited((record) => {
    record.completion_policy = POLICY;
    record.acceptance.criteria = ["relaxed"];
  });
  assert.deepEqual(authenticate(live), { ok: false, reason: "unrelated_record_drift", fields: ["acceptance.criteria"] });
  const scoped = edited((record) => {
    record.completion_policy = POLICY;
    record.slices[0].write_scope = ["src/other.mjs"];
  });
  assert.deepEqual(authenticate(scoped), { ok: false, reason: "unrelated_slice_drift", slice_id: "SLICE-001" });
});

test("a refresh keeps the policy the published closeout introduced", () => {
  const published = { ...publishedRecord(), completion_policy: POLICY };
  const kept = edited((record) => { record.sections.agent_notes = "n"; }, published);
  assert.equal(authenticate(kept, { published }).ok, true);
  const removed = edited((record) => { delete record.completion_policy; record.sections.agent_notes = "n"; },
    published);
  assert.equal(authenticate(removed).ok, true, "C alone does not know K's policy");
  assert.deepEqual(authenticate(removed, { published }),
    { ok: false, reason: "published_closeout_drift", unit: "WK-2672", field: "completion_policy" });
});

test("unrelated record drift names exactly the protected fields that differ", () => {
  const cases = [
    [(record) => { record.acceptance.validation = [...record.acceptance.validation, "limitation"]; },
      ["acceptance.validation"]],
    [(record) => { record.acceptance.validation = []; }, ["acceptance.validation"]],
    [(record) => {
      record.acceptance.validation.push("limitation");
      record.acceptance.criteria = ["relaxed"];
    }, ["acceptance.criteria", "acceptance.validation"]],
    [(record) => { delete record.acceptance; }, ["acceptance"]],
    [(record) => { record.title = "renamed"; record.owner = "someone"; }, ["owner", "title"]]
  ];
  for (const [mutate, fields] of cases) {
    assert.deepEqual(authenticate(edited(mutate)), { ok: false, reason: "unrelated_record_drift", fields });
  }

  const beside = edited((record) => {
    record.sections.agent_notes = "notes";
    record.acceptance.validation.push("limitation");
  });
  assert.deepEqual(authenticate(beside), { ok: false, reason: "unrelated_record_drift",
    fields: ["acceptance.validation"] });
});
