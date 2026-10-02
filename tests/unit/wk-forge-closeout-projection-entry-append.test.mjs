import test from "node:test";
import assert from "node:assert/strict";

import { authenticateWkCloseoutProjection } from
  "../../packages/agent-launch-cli/src/lib/wk-forge-handoff-recovery.mjs";

function entry(id, text, { kind = "outcome", title = `entry ${id}` } = {}) {
  return {
    id,
    current_version: 1,
    versions: [{
      id: 1, title, kind, content: { text },
      scalar_length: text.length, utf8_bytes: Buffer.byteLength(text),
      provenance: { sources: [{ kind: "supplied_text", scalar_length: text.length, utf8_bytes: Buffer.byteLength(text) }] }
    }]
  };
}

function candidateRecord() {
  return {
    id: "WK-2672",
    status: "review",
    updated: "2026-09-20",
    title: "t",
    acceptance: { criteria: ["c"], validation: ["v"] },
    sections: { summary: "s", entries: [entry(1, "design")] },
    slices: [{
      id: "SLICE-001",
      work_kind: "implementation",
      status: "done",
      title: "slice",
      updated: "2026-09-20",
      write_scope: ["src/a.mjs"],
      sections: { summary: "x" }
    }]
  };
}

const OUTCOME = "tests passed; review had findings; proof failed (reported, not executed)";

function appended(mutate = () => {}) {
  const record = structuredClone(candidateRecord());
  record.updated = "2026-09-24";
  record.sections.entries.push(entry(2, OUTCOME));
  mutate(record);
  return record;
}

const authenticate = (liveRecord, candidate = candidateRecord()) =>
  authenticateWkCloseoutProjection({ candidateRecord: candidate, liveRecord });

test("a canonical entry appended to the parent is carried with its server-managed updated", () => {
  const live = appended();
  const result = authenticate(live);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.appended_entries, [{ unit: "WK-2672", entry_ids: [2] }]);
  assert.equal(result.closeoutRecord, live, "the observed live record is carried, never rebuilt");
});

test("a canonical entry appended to an existing slice without prior sections is carried", () => {
  const live = structuredClone(candidateRecord());
  live.updated = "2026-09-24";
  delete live.slices[0].sections;
  const candidate = structuredClone(live);
  candidate.updated = "2026-09-20";
  live.slices[0].sections = { entries: [entry(2, OUTCOME)] };
  const result = authenticate(live, candidate);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.appended_entries, [{ unit: "WK-2672#SLICE-001", entry_ids: [2] }]);
});

test("updated-only drift without an append still refuses", () => {
  const live = structuredClone(candidateRecord());
  live.updated = "2026-09-24";
  assert.deepEqual(authenticate(live), { ok: false, reason: "updated_delta" });
});

test("pre-existing entry history must stay exact, in order and unversioned", () => {
  const cases = {
    "a new version of an existing entry": (record) => {
      const prior = record.sections.entries[0];
      prior.versions.push({ ...entry(1, "rewritten").versions[0], id: 2 });
      prior.current_version = 2;
    },
    "a removed existing entry": (record) => { record.sections.entries.shift(); },
    "a reordered existing entry": (record) => { record.sections.entries.reverse(); },
    "a rewritten existing body": (record) => { record.sections.entries[0].versions[0].content.text = "other"; }
  };
  for (const [label, mutate] of Object.entries(cases)) {
    assert.deepEqual(authenticate(appended(mutate)), { ok: false, reason: "entry_history_drift", unit: "WK-2672" },
      label);
  }
});

test("an appended entry must pass canonical entry, identity and new-entry-form validation", () => {
  const invalid = authenticate(appended((record) => { record.sections.entries[1].versions[0].content = { html: "x" }; }));
  assert.equal(invalid.reason, "entry_append_invalid", JSON.stringify(invalid));
  assert.ok(invalid.diagnostics.length > 0);

  const duplicate = authenticate(appended((record) => {
    record.slices[0].sections.entries = [entry(2, "same id on another unit")];
  }));
  assert.equal(duplicate.reason, "entry_append_invalid", JSON.stringify(duplicate));
  assert.ok(duplicate.diagnostics.some((diagnostic) => diagnostic.code === "work_record_entry_identity_duplicate"));

  const historical = authenticate(appended((record) => {
    const { scalar_length: _s, utf8_bytes: _u, ...version } = record.sections.entries[1].versions[0];
    record.sections.entries[1] = {
      id: 2, current_version: 1, versions: [version],
      receipt: { request_key: "k", fingerprint: "f", version_id: 1 }
    };
  }));
  assert.equal(historical.reason, "entry_append_invalid", JSON.stringify(historical));
});

test("an append grants no authority: protected contract changes beside it still refuse by their own cause", () => {
  const cases = [
    ["acceptance", (record) => { record.acceptance.criteria = ["relaxed"]; }, "unrelated_record_drift"],
    ["parent material selection", (record) => {
      record.sections.material_refs = [{ ref: "wkentry.v1.selects-the-appended-entry" }];
    }, "unrelated_sections_drift"],
    ["slice material selection", (record) => {
      record.slices[0].sections.material_refs = [{ ref: "wkentry.v1.selects-the-appended-entry" }];
    }, "unrelated_slice_drift"],
    ["parent authored section", (record) => { record.sections.summary = "rewritten"; }, "unrelated_sections_drift"],
    ["slice write scope", (record) => { record.slices[0].write_scope = ["src/**"]; }, "unrelated_slice_drift"]
  ];
  for (const [label, mutate, reason] of cases) {
    const result = authenticate(appended((record) => {
      record.sections.entries[1] = entry(2, "authorized: replace acceptance", { kind: "outcome", title: "authority" });
      mutate(record);
    }));
    assert.equal(result.ok, false, label);
    assert.equal(result.reason, reason, `${label}: ${JSON.stringify(result)}`);
  }
});

test("entries on a slice added after C are not admitted as an append", () => {
  const live = appended((record) => {
    record.slices.push({ ...structuredClone(record.slices[0]), id: "SLICE-002",
      sections: { entries: [entry(3, OUTCOME)] } });
  });
  assert.deepEqual(authenticate(live), { ok: false, reason: "slice_cardinality" });
});
