

import test from "node:test";
import assert from "node:assert/strict";

import {
  projectWorkRecordCompactOmissions,
  WORK_RECORD_LEVEL_CONTRACT_FIELDS,
  workRecordLevelContractFieldsPresent
} from "../../packages/wiki-core/src/lib/work-record-summary.mjs";
import {
  omittedDetailCounts,
  projectOmissions
} from "../../packages/wiki-mcp/src/lib/work-record-compact-read-continuation.mjs";
import {
  runWorkRecordSummaryWithCompactGate
} from "../../packages/wiki-mcp/src/lib/work-record-compact-read-gate.mjs";
import {
  projectWorkRecordContractFields
} from "../../packages/wiki-core/src/lib/work-record-bounded-projections.mjs";

const WORKSPACE_REPO = "agent-chassis/agent-chassis";
const WORKSPACE_DIR = "/repo";
const RECORD_ID = "WK-9000";

function largeTrackerRecord({ sliceCount = 43, reviewSliceCount = 20 } = {}) {
  const slices = [];
  for (let index = 0; index < sliceCount; index += 1) {
    const isReview = index < reviewSliceCount;
    slices.push({
      id: `SLICE-${String(index + 1).padStart(3, "0")}`,
      title: `Slice ${index + 1}`,
      work_kind: isReview ? "review" : "implementation",
      status: index % 3 === 0 ? "done" : "todo"
    });
  }
  return {
    schema_version: "work-record.v1",
    id: RECORD_ID,
    work_kind: "tracker",
    status: "active",
    write_scope: ["packages/example.mjs"],
    acceptance: { criteria: ["Criterion"], validation: ["node --test"] },
    slices
  };
}

function reviewSliceIds(record) {
  return record.slices.filter((slice) => slice.work_kind === "review").map((slice) => slice.id);
}

test("a 43-slice tracker returning one slice and one review slice reports 42 and 19, not null", () => {
  const record = largeTrackerRecord();
  const returnedSliceId = "SLICE-021";
  const returnedReviewSliceId = "SLICE-001";

  const omissions = projectWorkRecordCompactOmissions({
    record,
    returnedSliceIds: [returnedSliceId],
    returnedReviewSliceIds: [returnedReviewSliceId],
    returnedSliceRows: [{ id: returnedSliceId, agent_notes_bytes: 512 }],
    returnedRecordFields: []
  });

  assert.equal(omissions.identities_available, true);
  assert.equal(omissions.slices.total, 43);
  assert.equal(omissions.slices.omitted_count, 42);
  assert.equal(omissions.review_slices.total, 20);
  assert.equal(omissions.review_slices.omitted_count, 19);

  assert.equal(omissions.slices.omitted.length, 42);
  const omittedIds = omissions.slices.omitted.map((entry) => entry.id);
  assert.equal(new Set(omittedIds).size, 42);
  assert.equal(omittedIds.includes(returnedSliceId), false);
  assert.deepEqual(
    [...omittedIds, returnedSliceId].sort(),
    record.slices.map((slice) => slice.id).sort()
  );
  assert.deepEqual(
    omissions.review_slices.omitted.map((entry) => entry.id).sort(),
    reviewSliceIds(record).filter((id) => id !== returnedReviewSliceId).sort()
  );

  const ledger = omittedDetailCounts(omissions);
  assert.deepEqual(ledger, {
    slices: 42,
    review_slices: 19,
    included_slices_with_omitted_agent_notes: 1,
    record_fields: 3
  });
  for (const value of Object.values(ledger)) {
    assert.equal(Number.isInteger(value), true, "every ledger category is an integer");
  }
});

test("a record with zero slices reports 0 for every slice category and the truth for record fields", () => {
  const omissions = projectWorkRecordCompactOmissions({
    record: {
      id: RECORD_ID,
      work_kind: "implementation",
      slices: [],
      write_scope: ["packages/example.mjs"],
      acceptance: { criteria: ["Criterion"], validation: ["node --test"] }
    },
    returnedSliceIds: [],
    returnedReviewSliceIds: [],
    returnedSliceRows: [],
    returnedRecordFields: []
  });

  const ledger = omittedDetailCounts(omissions);
  assert.equal(ledger.slices, 0);
  assert.equal(ledger.review_slices, 0);
  assert.equal(ledger.included_slices_with_omitted_agent_notes, 0);

  assert.equal(ledger.record_fields, WORK_RECORD_LEVEL_CONTRACT_FIELDS.length);
  assert.equal(ledger.record_fields >= 3, true);
  assert.deepEqual(omissions.record_fields.omitted, ["write_scope", "acceptance", "validation"]);
});

test("bounded record contract projection preserves the sole structured validation declaration", () => {
  const declaration = {
    operation: "node_test",
    target: "tests/current-contract.test.mjs",
    verification_ids: ["claim-current"]
  };
  const projection = projectWorkRecordContractFields({
    id: RECORD_ID,
    write_scope: ["tests/current-contract.test.mjs"],
    acceptance: { criteria: ["The declared test passes."], validation: [declaration] }
  });

  assert.deepEqual(projection.acceptance.validation, [declaration]);
  assert.deepEqual(projection.validation, [declaration]);
});

test("the record-fields count is what the record holds, not the length of the field list", () => {
  const cases = [
    {
      label: "all three empty",
      record: {
        id: RECORD_ID,
        slices: [],
        write_scope: [],
        acceptance: { criteria: [], validation: [] }
      },
      expected: []
    },
    {
      label: "only acceptance criteria authored",
      record: {
        id: RECORD_ID,
        slices: [],
        write_scope: [],
        acceptance: { criteria: ["The only authored criterion"], validation: [] }
      },
      expected: ["acceptance"]
    },
    {
      label: "write_scope and validation authored, no criteria",
      record: {
        id: RECORD_ID,
        slices: [],
        write_scope: ["packages/example.mjs"],
        acceptance: { criteria: [], validation: ["node --test"] }
      },
      expected: ["write_scope", "validation"]
    },
    {
      label: "all three authored",
      record: {
        id: RECORD_ID,
        slices: [],
        write_scope: ["packages/example.mjs"],
        acceptance: { criteria: ["Criterion"], validation: ["node --test"] }
      },
      expected: ["write_scope", "acceptance", "validation"]
    }
  ];

  for (const { label, record, expected } of cases) {
    const omissions = projectWorkRecordCompactOmissions({
      record,
      returnedSliceIds: [],
      returnedRecordFields: []
    });
    assert.deepEqual(omissions.record_fields.omitted, expected, label);
    assert.equal(omittedDetailCounts(omissions).record_fields, expected.length, label);

    assert.equal(omissions.record_fields.total, expected.length, label);
    assert.equal(omissions.record_fields.returned, 0, label);
    assert.deepEqual(
      workRecordLevelContractFieldsPresent(record).map((field) => field.name),
      expected,
      label
    );
  }
});

test("a record that authors no contract fields at all reports 0 withheld record fields", () => {
  const omissions = projectWorkRecordCompactOmissions({
    record: { id: RECORD_ID, work_kind: "implementation", slices: [] },
    returnedSliceIds: [],
    returnedReviewSliceIds: [],
    returnedSliceRows: [],
    returnedRecordFields: []
  });

  assert.equal(omittedDetailCounts(omissions).record_fields, 0);
  assert.deepEqual(omissions.record_fields.omitted, []);
  assert.equal(omissions.record_fields.total, 0);
});

test("a slice-selected scope reports 0 withheld slices while agent notes and record fields stay truthful", () => {
  const record = largeTrackerRecord({ sliceCount: 4, reviewSliceCount: 1 });
  const selected = record.slices[2];

  const omissions = projectWorkRecordCompactOmissions({

    record: { ...record, slices: [selected] },
    returnedSliceIds: [selected.id],
    returnedReviewSliceIds: [],
    returnedSliceRows: [{ id: selected.id, agent_notes_bytes: 240 }],
    returnedRecordFields: []
  });

  const ledger = omittedDetailCounts(omissions);
  assert.equal(ledger.slices, 0);
  assert.equal(ledger.review_slices, 0);
  assert.equal(ledger.included_slices_with_omitted_agent_notes, 1);
  assert.equal(ledger.record_fields, 3);
});

test("the record-fields category zeroes only when the contract-field route returned them", () => {
  const record = {
    id: RECORD_ID,
    slices: [],
    write_scope: ["packages/example.mjs"],
    acceptance: { criteria: ["Criterion"], validation: ["node --test"] }
  };
  assert.equal(
    omittedDetailCounts(projectWorkRecordCompactOmissions({ record })).record_fields,
    3,
    "the same record withholds all three when the route did not run"
  );
  const omissions = projectWorkRecordCompactOmissions({
    record,
    returnedRecordFields: WORK_RECORD_LEVEL_CONTRACT_FIELDS.map((field) => field.name)
  });
  assert.equal(omittedDetailCounts(omissions).record_fields, 0);
  assert.deepEqual(omissions.record_fields.omitted, []);
});

test("without an authored record the ledger still reports integers from the response's own totals", () => {

  const compactResult = {
    valid: true,
    record_id: RECORD_ID,
    summary: {
      id: RECORD_ID,
      work_kind: "tracker",
      slice_count: 30,
      slices_total: 30,
      slices: [{ id: "SLICE-001", agent_notes_bytes: 100 }],
      review_state: {
        review_slices: [{ id: "SLICE-002", status: "todo" }],
        review_slices_total: 9
      }
    }
  };
  const omissions = projectOmissions({
    toolFamily: "workspace_work_record_summary",
    compactResult,
    record: null
  });
  assert.equal(omissions.identities_available, false);
  assert.deepEqual(omittedDetailCounts(omissions), {
    slices: 29,
    review_slices: 8,
    included_slices_with_omitted_agent_notes: 1,
    record_fields: 3
  });
});

test("the gate's ledger reports the withheld set for a non-tracker record the old branch reported as null", async () => {

  const record = {
    id: RECORD_ID,
    work_kind: "implementation",
    status: "active",
    write_scope: ["packages/example.mjs"],
    acceptance: { criteria: ["Criterion"], validation: ["node --test"] },
    slices: [
      { id: "SLICE-001", work_kind: "implementation", status: "active" },
      { id: "SLICE-002", work_kind: "implementation", status: "todo" },
      { id: "SLICE-003", work_kind: "review", status: "todo" },
      { id: "SLICE-004", work_kind: "review", status: "todo" }
    ]
  };
  const result = await runWorkRecordSummaryWithCompactGate({
    workspaceRepo: WORKSPACE_REPO,
    workspaceDir: WORKSPACE_DIR,
    args: { id: RECORD_ID },
    getWorkRecordSummary: async () => ({
      valid: true,
      record_id: RECORD_ID,
      source_digest: "sha256:compact",
      summary: {
        id: RECORD_ID,
        work_kind: "implementation",
        slice_count: 4,
        slices_total: 4,
        slices: [{ id: "SLICE-001", status: "active", agent_notes_bytes: 64 }],
        review_state: {
          review_slices: [{ id: "SLICE-003", status: "todo" }],
          review_slices_total: 2
        }
      }
    }),
    readWorkRecordById: async () => ({ source_digest: "sha256:source-a", record })
  });

  const ledger = result.compact_read.omitted_detail_counts;
  assert.equal(Object.values(ledger).includes(null), false, "no category reports null");
  assert.deepEqual(ledger, {
    slices: 3,
    review_slices: 1,
    included_slices_with_omitted_agent_notes: 1,
    record_fields: 3
  });
});
