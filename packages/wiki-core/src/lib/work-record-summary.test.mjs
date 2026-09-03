import test from "node:test";
import assert from "node:assert/strict";

import { summarizeWorkRecord } from "./work-record-summary.mjs";
import { projectSelectedWorkRecordUnit } from "./work-record-selected-unit-projection.mjs";

function terminalRecord(status) {
  return {
    id: "WK-1836",
    record_kind: "work_item",
    work_kind: "implementation",
    status,
    depends_on: ["WK-0537"],
    acceptance: { validation: ["npm test"] },
    slices: [{ id: "SLICE-001", work_kind: "review", status: "todo" }]
  };
}

test("record-scope terminal status precedes blockers, review, and validation", () => {
  for (const status of ["done", "cancelled"]) {
    const summary = summarizeWorkRecord(terminalRecord(status));

    assert.equal(summary.next_action, "close out");
    assert.deepEqual(summary.blockers, [
      {
        kind: "depends_on",
        source: "depends_on",
        resolution: "unresolved",
        entry: { id: "WK-0537", marker: "unresolved", selected_status: null }
      }
    ]);
    assert.equal(summary.review_state.status, "open");
    assert.deepEqual(summary.validation, ["npm test"]);
  }
});

function dependencyRecord(status, id = "WK-0537") {
  return { id, record_kind: "work_item", status };
}

test("done dependency is satisfied and excluded from blockers", () => {
  const summary = summarizeWorkRecord(
    { id: "WK-1836", status: "active", depends_on: ["WK-0537"] },
    { dependencyResolver: () => dependencyRecord("done") }
  );

  assert.deepEqual(summary.blockers, []);
});

test("open dependency remains an unsatisfied blocker", () => {
  const summary = summarizeWorkRecord(
    { id: "WK-1836", status: "active", depends_on: ["WK-0537"] },
    { dependencyResolver: () => dependencyRecord("active") }
  );

  assert.equal(summary.blockers[0].resolution, "unsatisfied_open");
  assert.equal(summary.blockers[0].entry.marker, "unsatisfied");
  assert.equal(summary.blockers[0].entry.selected_status, "active");
});

test("cancelled dependency remains a distinct blocker", () => {
  const summary = summarizeWorkRecord(
    { id: "WK-1836", status: "active", depends_on: ["WK-0537"] },
    { dependencyResolver: () => dependencyRecord("cancelled") }
  );

  assert.equal(summary.blockers[0].resolution, "cancelled");
  assert.equal(summary.blockers[0].entry.marker, "cancelled");
});

test("same-record dependencies resolve without a resolver", () => {
  const summary = summarizeWorkRecord({
    id: "WK-1836",
    status: "active",
    depends_on: ["WK-1836#SLICE-001"],
    slices: [{ id: "SLICE-001", status: "done" }]
  });

  assert.deepEqual(summary.blockers, []);
});

test("slice-scope done dependency is excluded for bare and qualified addresses", () => {
  const baseRecord = {
    id: "WK-1836",
    status: "active",
    slices: [
      { id: "SLICE-001", status: "active", depends_on: ["SLICE-009"] },
      { id: "SLICE-009", status: "done" }
    ]
  };
  const bare = summarizeWorkRecord(baseRecord, {
    unit: { kind: "slice", slice_id: "SLICE-001" }
  });
  const qualified = summarizeWorkRecord({
    ...baseRecord,
    slices: [
      { id: "SLICE-001", status: "active", depends_on: ["WK-1836#SLICE-009"] },
      { id: "SLICE-009", status: "done" }
    ]
  }, {
    unit: { kind: "slice", slice_id: "SLICE-001" }
  });

  assert.deepEqual(bare.selected_unit_summary.blockers, []);
  assert.deepEqual(qualified.selected_unit_summary.blockers, []);
});

test("slice-scope cancelled dependency remains a distinct blocker", () => {
  const summary = summarizeWorkRecord({
    id: "WK-1836",
    status: "active",
    slices: [
      { id: "SLICE-001", status: "active", depends_on: ["SLICE-009"] },
      { id: "SLICE-009", status: "cancelled" }
    ]
  }, { unit: { kind: "slice", slice_id: "SLICE-001" } });

  assert.deepEqual(summary.selected_unit_summary.blockers, [{
    kind: "depends_on",
    source: "depends_on",
    resolution: "cancelled",
    entry: { id: "SLICE-009", marker: "cancelled", selected_status: "cancelled" }
  }]);
});

test("unresolvable slice-scope dependency remains a blocker", () => {
  const summary = summarizeWorkRecord({
    id: "WK-1836",
    status: "active",
    slices: [
      { id: "SLICE-001", status: "active", depends_on: ["SLICE-999"] }
    ]
  }, { unit: { kind: "slice", slice_id: "SLICE-001" } });

  assert.deepEqual(summary.selected_unit_summary.blockers, [{
    kind: "depends_on",
    source: "depends_on",
    resolution: "unresolved",
    entry: { id: "SLICE-999", marker: "unresolved", selected_status: null }
  }]);
});

test("slice-scope open dependency retains its selected status and unsatisfied marker", () => {
  const summary = summarizeWorkRecord({
    id: "WK-1836",
    status: "active",
    slices: [
      { id: "SLICE-001", work_kind: "implementation", status: "active", depends_on: ["SLICE-009"] },
      { id: "SLICE-009", status: "active" }
    ]
  }, { unit: { kind: "slice", slice_id: "SLICE-001" } });

  assert.deepEqual(summary.selected_unit_summary.blockers, [{
    kind: "depends_on",
    source: "depends_on",
    resolution: "unsatisfied_open",
    entry: { id: "SLICE-009", marker: "unsatisfied", selected_status: "active" }
  }]);
});

test("slice-scope all-done dependencies clear blockers and continue work", () => {
  const summary = summarizeWorkRecord({
    id: "WK-1836",
    status: "active",
    slices: [
      {
        id: "SLICE-005",
        work_kind: "implementation",
        status: "active",
        depends_on: ["SLICE-002", "SLICE-003", "SLICE-004"]
      },
      { id: "SLICE-002", status: "done" },
      { id: "SLICE-003", status: "done" },
      { id: "SLICE-004", status: "done" }
    ]
  }, { unit: { kind: "slice", slice_id: "SLICE-005" } });

  assert.deepEqual(summary.selected_unit_summary.blockers, []);
  assert.notEqual(summary.selected_unit_summary.next_action, "resolve blockers");
});

test("slice-scope dependencies continue after a satisfied edge", () => {
  const summary = summarizeWorkRecord({
    id: "WK-1836",
    status: "active",
    slices: [
      {
        id: "SLICE-005",
        work_kind: "implementation",
        status: "active",
        depends_on: ["SLICE-002", "SLICE-003", "SLICE-004"]
      },
      { id: "SLICE-002", status: "done" },
      { id: "SLICE-003", status: "active" },
      { id: "SLICE-004", status: "done" }
    ]
  }, { unit: { kind: "slice", slice_id: "SLICE-005" } });

  assert.deepEqual(summary.selected_unit_summary.blockers, [{
    kind: "depends_on",
    source: "depends_on",
    resolution: "unsatisfied_open",
    entry: { id: "SLICE-003", marker: "unsatisfied", selected_status: "active" }
  }]);
});

test("record-level escalation blockers preserve shape, ordering, and precedence", () => {
  const summary = summarizeWorkRecord(
    {
      id: "WK-1836",
      status: "active",
      depends_on: ["WK-0537"],
      escalations: [
        { id: "ESC-OPEN", kind: "risk", status: "open", reason: "open risk" },
        { id: "ESC-ACCEPTED", kind: "scope", status: "accepted", reason: "accepted scope" }
      ],
      slices: [
        { id: "SLICE-001", work_kind: "implementation", status: "active", depends_on: ["SLICE-009"] },
        { id: "SLICE-009", status: "done" }
      ]
    },
    {
      unit: { kind: "slice", slice_id: "SLICE-001" },
      dependencyResolver: () => ({ id: "WK-0537", status: "active" })
    }
  );

  assert.deepEqual(summary.blockers, [
    {
      kind: "open_escalation",
      source: "escalations",
      entry: {
        id: "ESC-OPEN",
        kind: "risk",
        status: "open",
        reason: "open risk",
        requested_by: null,
        accepted_by: null
      }
    },
    {
      kind: "accepted_escalation",
      source: "escalations",
      entry: {
        id: "ESC-ACCEPTED",
        kind: "scope",
        status: "accepted",
        reason: "accepted scope",
        requested_by: null,
        accepted_by: null
      }
    },
    {
      kind: "depends_on",
      source: "depends_on",
      resolution: "unsatisfied_open",
      entry: { id: "WK-0537", marker: "unsatisfied", selected_status: "active" }
    }
  ]);
  assert.deepEqual(summary.selected_unit_summary.blockers, []);
});

test("missing, mismatched, and throwing resolvers remain unresolved", () => {
  const missing = summarizeWorkRecord({
    id: "WK-1836", status: "active", depends_on: ["WK-0537"]
  });
  const mismatch = summarizeWorkRecord(
    { id: "WK-1836", status: "active", depends_on: ["WK-0537"] },
    { dependencyResolver: () => dependencyRecord("done", "WK-9999") }
  );
  const throwing = summarizeWorkRecord(
    { id: "WK-1836", status: "active", depends_on: ["WK-0537"] },
    { dependencyResolver: () => { throw new Error("resolver failed"); } }
  );

  for (const summary of [missing, mismatch, throwing]) {
    assert.equal(summary.blockers[0].resolution, "unresolved");
    assert.equal(summary.blockers[0].entry.marker, "unresolved");
    assert.equal(summary.blockers[0].entry.selected_status, null);
  }
});

test("slice evidence requires the addressed slice to exist", () => {
  const summary = summarizeWorkRecord(
    { id: "WK-1836", status: "active", depends_on: ["WK-0537#SLICE-999"] },
    { dependencyResolver: () => dependencyRecord("done") }
  );

  assert.equal(summary.blockers[0].resolution, "unresolved");
});

test("slice-scope blocker precedence remains unchanged", () => {
  const summary = summarizeWorkRecord(
    {
      id: "WK-1836",
      record_kind: "work_item",
      status: "active",
      slices: [
        {
          id: "SLICE-002",
          work_kind: "review",
          status: "active",
          depends_on: ["WK-0537"]
        }
      ]
    },
    { unit: { kind: "slice", slice_id: "SLICE-002" } }
  );

  assert.equal(summary.selected_unit_summary.next_action, "resolve blockers");
  assert.equal(summary.selected_unit_summary.next_action, "resolve blockers");
});

const TERMINAL_REVIEW = {
  work_kind: "review",
  review_purpose: "terminal_whole_wk",
  write_scope: [],
  dispatch_intent: { intended_agent_role: "reviewer", target_unit: "slice" }
};
const IMPLEMENTATION = { id: "SLICE-001", work_kind: "implementation", status: "active" };

function terminalReview(id, status = "todo") {
  return { ...TERMINAL_REVIEW, id, status };
}

function wk1952Record(slices, overrides = {}) {
  return {
    id: "WK-1952",
    record_kind: "work_item",
    work_kind: "tracker",
    status: "active",
    initiative: "IN-0042",
    acceptance: { criteria: ["criterion"], validation: ["npm test"] },
    slices,
    ...overrides
  };
}

function bothSummaries(record, options = {}) {
  return [
    summarizeWorkRecord(record, options),
    summarizeWorkRecord(record, { ...options, include_full_summary: true })
  ];
}

function assertReviewPurpose(row, expected, name) {
  assert.ok(row, `${name}: expected a projected row`);
  if (expected === undefined) {
    assert.equal(Object.hasOwn(row, "review_purpose"), false, name);
  } else {
    assert.equal(row.review_purpose, expected, name);
  }
}

const REVIEW_PURPOSE_ROWS = [
  ["authored terminal purpose", terminalReview("SLICE-002"), "terminal_whole_wk"],
  ["review row with no authored purpose", { id: "SLICE-002", work_kind: "review", status: "todo" }, "standalone"],
  ["implementation row", { id: "SLICE-002", work_kind: "implementation", status: "todo" }, undefined],
  ["redteam row", { id: "SLICE-002", work_kind: "redteam", status: "todo" }, undefined],
  ["review row with an out-of-enum purpose",
    { id: "SLICE-002", work_kind: "review", status: "todo", review_purpose: "terminal" }, undefined],
  ["non-review row carrying a misplaced purpose",
    { id: "SLICE-002", work_kind: "implementation", status: "todo", review_purpose: "standalone" }, undefined]
];

test("WK-1952 review_purpose is forwarded from the normalization owner on every summary surface", () => {
  for (const [name, slice, expected] of REVIEW_PURPOSE_ROWS) {
    const record = wk1952Record([IMPLEMENTATION, slice]);
    const unit = { kind: "slice", slice_id: "SLICE-002" };

    for (const summary of bothSummaries(record)) {
      assertReviewPurpose(
        summary.slices.find((entry) => entry.id === "SLICE-002"),
        expected,
        `${name}: slices[] row`
      );
    }
    for (const summary of bothSummaries(record, { unit })) {
      assertReviewPurpose(summary.selected_unit_summary, expected, `${name}: selected unit`);
    }

    if (slice.work_kind === "review") {
      for (const summary of bothSummaries(record)) {
        assertReviewPurpose(
          summary.review_state.review_slices.find((entry) => entry.id === "SLICE-002"),
          expected,
          `${name}: review_state row`
        );
      }
    }
  }
});

const DESIGNATION_CASES = [
  ["no terminal unit was ever authored",
    wk1952Record([IMPLEMENTATION, { id: "SLICE-002", work_kind: "review", status: "todo" }]),
    { state: "missing", eligible_count: 0 }],
  ["the terminal unit was cancelled",
    wk1952Record([IMPLEMENTATION, terminalReview("SLICE-002", "cancelled")]),
    { state: "missing", eligible_count: 0 }],
  ["the terminal unit is done",
    wk1952Record([IMPLEMENTATION, terminalReview("SLICE-002", "done")]),
    { state: "missing", eligible_count: 0 }],
  ["a record-level implementation WK with no slices",
    wk1952Record([], { work_kind: "implementation" }),
    { state: "missing", eligible_count: 0 }],
  ["exactly one eligible terminal unit",
    wk1952Record([
      IMPLEMENTATION,
      { id: "SLICE-002", work_kind: "review", status: "todo" },
      terminalReview("SLICE-003")
    ]),
    { state: "designated", eligible_count: 1, unit_id: "SLICE-003" }],
  ["one eligible unit while unrelated parent facts are missing",
    wk1952Record([IMPLEMENTATION, terminalReview("SLICE-003")], {
      initiative: null,
      acceptance: { criteria: [], validation: [] }
    }),
    { state: "designated", eligible_count: 1, unit_id: "SLICE-003" }],
  ["two eligible terminal units",
    wk1952Record([IMPLEMENTATION, terminalReview("SLICE-002"), terminalReview("SLICE-003", "active")]),
    { state: "ambiguous", eligible_count: 2 }],
  ["three eligible terminal units",
    wk1952Record([
      IMPLEMENTATION,
      terminalReview("SLICE-002"),
      terminalReview("SLICE-003"),
      terminalReview("SLICE-004")
    ]),
    { state: "ambiguous", eligible_count: 3 }],
  ["a done parent", wk1952Record([IMPLEMENTATION], { status: "done" }),
    { state: "not_applicable", eligible_count: 0 }],
  ["a cancelled parent", wk1952Record([IMPLEMENTATION], { status: "cancelled" }),
    { state: "not_applicable", eligible_count: 0 }],
  ["a completed parent", wk1952Record([IMPLEMENTATION], { status: "completed" }),
    { state: "not_applicable", eligible_count: 0 }],
  ["a closed parent that still designates a unit",
    wk1952Record([IMPLEMENTATION, terminalReview("SLICE-002")], { status: "done" }),
    { state: "not_applicable", eligible_count: 1 }],
  ["no implementation work",
    wk1952Record([
      { id: "SLICE-001", work_kind: "design", status: "active" },
      { id: "SLICE-002", work_kind: "review", status: "todo" }
    ]),
    { state: "not_applicable", eligible_count: 0 }],
  ["a record with no slices at all", { id: "WK-1952", status: "active" },
    { state: "not_applicable", eligible_count: 0 }]
];

const AUTHORITY_BEARING_MEMBERS = ["blocking", "next_action", "dispatchable", "authoritative"];

test("WK-1952 terminal_review_designation projects exactly one bounded advisory state", () => {
  for (const [name, record, expected] of DESIGNATION_CASES) {
    for (const summary of bothSummaries(record)) {
      const designation = summary.terminal_review_designation;

      assert.deepEqual(designation, expected, name);
      for (const member of AUTHORITY_BEARING_MEMBERS) {
        assert.equal(Object.hasOwn(designation, member), false, `${name}: ${member}`);
      }
    }
  }
});

test("WK-1952 the designation changes no blocker, next_action, or review-state outcome", () => {
  const slices = [IMPLEMENTATION, { id: "SLICE-002", work_kind: "review", status: "todo" }];
  const missing = wk1952Record(slices);
  const designated = wk1952Record([IMPLEMENTATION, terminalReview("SLICE-002")]);
  const unit = { kind: "slice", slice_id: "SLICE-001" };

  const [compactMissing, fullMissing] = bothSummaries(missing);
  const [compactDesignated, fullDesignated] = bothSummaries(designated);

  assert.equal(compactMissing.terminal_review_designation.state, "missing");
  assert.equal(compactDesignated.terminal_review_designation.state, "designated");

  for (const [a, b] of [[compactMissing, compactDesignated], [fullMissing, fullDesignated]]) {
    assert.deepEqual(a.blockers, b.blockers);
    assert.equal(a.next_action, b.next_action);
    assert.deepEqual(a.review_state.required, b.review_state.required);
    assert.equal(a.review_state.status, b.review_state.status);
    assert.equal(a.review_state.blocked, b.review_state.blocked);
  }
  assert.deepEqual(
    summarizeWorkRecord(missing, { unit }).selected_unit_summary,
    summarizeWorkRecord(designated, { unit }).selected_unit_summary
  );
});

const OBJECT_FORM_ACCEPTANCE = Object.freeze({
  criteria: [
    { text: "Findings-only review of the delivery.", verification_method: "audit", evidence_target: "review" }
  ],
  validation: ["codex-review WK-0357"]
});

function legacyReviewSlice(overrides = {}) {
  return {
    id: "review",
    title: "Review the delivery",
    work_kind: "review",
    status: "todo",
    owner: "codex",
    acceptance: OBJECT_FORM_ACCEPTANCE,
    ...overrides
  };
}

const REFUSED_UNIT_PURPOSE_ROWS = [
  ["unauthored purpose defaults through the owner", legacyReviewSlice(), "standalone"],
  ["authored valid purpose is preserved",
    legacyReviewSlice({ review_purpose: "terminal_whole_wk" }), "terminal_whole_wk"],
  ["out-of-enum purpose is omitted",
    legacyReviewSlice({ review_purpose: "terminal" }), undefined],
  ["implementation row gains nothing",
    legacyReviewSlice({ work_kind: "implementation" }), undefined],
  ["redteam row gains nothing",
    legacyReviewSlice({ work_kind: "redteam" }), undefined],
  ["non-review row carrying a misplaced purpose",
    legacyReviewSlice({ work_kind: "implementation", review_purpose: "standalone" }), undefined]
];

test("WK-1952 a unit the owner refuses whole still carries the purpose the owner decides", () => {
  const unit = { kind: "slice", slice_id: "review" };

  for (const [name, slice, expected] of REFUSED_UNIT_PURPOSE_ROWS) {

    assert.equal(projectSelectedWorkRecordUnit(slice), null, `${name}: whole-unit refusal`);

    const record = wk1952Record([IMPLEMENTATION, slice]);

    for (const summary of bothSummaries(record)) {
      assertReviewPurpose(
        summary.slices.find((entry) => entry.id === "review"),
        expected,
        `${name}: slices[] row`
      );
    }
    for (const summary of bothSummaries(record, { unit })) {
      assertReviewPurpose(summary.selected_unit_summary, expected, `${name}: selected unit`);
    }
    if (slice.work_kind === "review") {
      for (const summary of bothSummaries(record)) {
        assertReviewPurpose(
          summary.review_state.review_slices.find((entry) => entry.id === "review"),
          expected,
          `${name}: review_state row`
        );
      }
    }
  }
});

test("WK-1952 the probe adds review_purpose and changes no other projection", () => {

  const refused = legacyReviewSlice();
  const projectable = legacyReviewSlice({
    acceptance: { criteria: ["criterion"], validation: OBJECT_FORM_ACCEPTANCE.validation }
  });
  assert.equal(projectSelectedWorkRecordUnit(refused), null);
  assert.notEqual(projectSelectedWorkRecordUnit(projectable), null);

  const unit = { kind: "slice", slice_id: "review" };
  const [compactRefused, fullRefused] = bothSummaries(wk1952Record([IMPLEMENTATION, refused]));
  const [compactOk, fullOk] = bothSummaries(wk1952Record([IMPLEMENTATION, projectable]));

  const refusedRow = { ...fullRefused.slices.find((entry) => entry.id === "review") };
  const okRow = { ...fullOk.slices.find((entry) => entry.id === "review") };

  assert.deepEqual(refusedRow.acceptance, { criteria: [], validation: ["codex-review WK-0357"] });
  assert.deepEqual(okRow.acceptance, { criteria: ["criterion"], validation: ["codex-review WK-0357"] });
  delete refusedRow.acceptance;
  delete okRow.acceptance;

  assert.deepEqual(refusedRow, okRow);
  assert.equal(refusedRow.review_purpose, "standalone");

  for (const [a, b] of [[compactRefused, compactOk], [fullRefused, fullOk]]) {
    assert.deepEqual(a.blockers, b.blockers);
    assert.equal(a.next_action, b.next_action);
    assert.deepEqual(a.review_state, b.review_state);
    assert.deepEqual(a.terminal_review_designation, b.terminal_review_designation);
    assert.deepEqual(a.slice_status_counts, b.slice_status_counts);
  }
  assert.deepEqual(
    summarizeWorkRecord(wk1952Record([IMPLEMENTATION, refused]), { unit }).selected_unit_summary,
    summarizeWorkRecord(wk1952Record([IMPLEMENTATION, projectable]), { unit }).selected_unit_summary
  );
});

test("WK-1952 the probe copies descriptors, so an accessor purpose is refused not read", () => {
  const slice = { id: "SLICE-002", work_kind: "review", status: "todo" };
  Object.defineProperty(slice, "review_purpose", {
    enumerable: true,
    configurable: true,
    get() {
      return "standalone";
    }
  });

  const record = wk1952Record([IMPLEMENTATION, slice]);
  const unit = { kind: "slice", slice_id: "SLICE-002" };

  for (const summary of bothSummaries(record)) {
    assertReviewPurpose(
      summary.slices.find((entry) => entry.id === "SLICE-002"),
      undefined,
      "accessor row: slices[]"
    );
    assertReviewPurpose(
      summary.review_state.review_slices.find((entry) => entry.id === "SLICE-002"),
      undefined,
      "accessor row: review_state"
    );
  }
  for (const summary of bothSummaries(record, { unit })) {
    assertReviewPurpose(summary.selected_unit_summary, undefined, "accessor row: selected unit");
  }
});

const ADMISSION_TARGET_FIELD = "admission_review_target_unit";
const ADMISSION_TARGET_ADDRESS = "WK-1952#SLICE-001";

function admissionReviewSlice(overrides = {}) {
  return {
    id: "SLICE-002",
    title: "Findings-only review",
    work_kind: "review",
    status: "todo",
    write_scope: [],
    ...overrides
  };
}

function assertAdmissionTarget(row, expected, name) {
  assert.ok(row, `${name}: expected a projected row`);
  if (expected === undefined) {
    assert.equal(Object.hasOwn(row, ADMISSION_TARGET_FIELD), false, name);
  } else {
    assert.equal(row[ADMISSION_TARGET_FIELD], expected, name);
  }
}

const ADMISSION_TARGET_ROWS = [
  ["authored target", admissionReviewSlice({
    [ADMISSION_TARGET_FIELD]: ADMISSION_TARGET_ADDRESS
  }), ADMISSION_TARGET_ADDRESS],

  ["authored target with exact surrounding whitespace", admissionReviewSlice({
    [ADMISSION_TARGET_FIELD]: `  ${ADMISSION_TARGET_ADDRESS}  `
  }), `  ${ADMISSION_TARGET_ADDRESS}  `],

  ["target on a unit the owner refuses whole", admissionReviewSlice({
    [ADMISSION_TARGET_FIELD]: ADMISSION_TARGET_ADDRESS,
    acceptance: OBJECT_FORM_ACCEPTANCE
  }), ADMISSION_TARGET_ADDRESS],
  ["no authored target", admissionReviewSlice(), undefined],
  ["legacy depends_on edge is not a target", admissionReviewSlice({
    depends_on: [ADMISSION_TARGET_ADDRESS]
  }), undefined],
  ["legacy related edge is not a target", admissionReviewSlice({
    related: [ADMISSION_TARGET_ADDRESS]
  }), undefined],
  ["legacy blocks edge is not a target", admissionReviewSlice({
    blocks: [ADMISSION_TARGET_ADDRESS]
  }), undefined],
  ["malformed target is refused, not repaired", admissionReviewSlice({
    [ADMISSION_TARGET_FIELD]: 42
  }), undefined],
  ["implementation row gains nothing", admissionReviewSlice({
    work_kind: "implementation",
    write_scope: ["packages/selected.mjs"]
  }), undefined]
];

test("WK-2389 every summary row forwards the exact authored admission review target", () => {
  const unit = { kind: "slice", slice_id: "SLICE-002" };

  for (const [name, slice, expected] of ADMISSION_TARGET_ROWS) {
    const record = wk1952Record([IMPLEMENTATION, slice]);

    for (const summary of bothSummaries(record)) {
      assertAdmissionTarget(
        summary.slices.find((entry) => entry.id === "SLICE-002"),
        expected,
        `${name}: slices[] row`
      );
    }
    for (const summary of bothSummaries(record, { unit })) {
      assertAdmissionTarget(summary.selected_unit_summary, expected, `${name}: selected unit`);
    }
    if (slice.work_kind === "review") {
      for (const summary of bothSummaries(record)) {
        assertAdmissionTarget(
          summary.review_state.review_slices.find((entry) => entry.id === "SLICE-002"),
          expected,
          `${name}: review_state row`
        );
      }
    }
  }
});

test("WK-2389 an accessor target is refused not read, and changes no other outcome", () => {
  const accessorSlice = admissionReviewSlice();
  Object.defineProperty(accessorSlice, ADMISSION_TARGET_FIELD, {
    enumerable: true,
    configurable: true,
    get() {
      return ADMISSION_TARGET_ADDRESS;
    }
  });

  const unit = { kind: "slice", slice_id: "SLICE-002" };
  const accessorRecord = wk1952Record([IMPLEMENTATION, accessorSlice]);

  for (const summary of bothSummaries(accessorRecord)) {
    assertAdmissionTarget(
      summary.slices.find((entry) => entry.id === "SLICE-002"),
      undefined,
      "accessor row: slices[]"
    );
    assertAdmissionTarget(
      summary.review_state.review_slices.find((entry) => entry.id === "SLICE-002"),
      undefined,
      "accessor row: review_state"
    );
  }
  for (const summary of bothSummaries(accessorRecord, { unit })) {
    assertAdmissionTarget(summary.selected_unit_summary, undefined, "accessor row: selected unit");
  }

  const declared = wk1952Record([IMPLEMENTATION, admissionReviewSlice({
    [ADMISSION_TARGET_FIELD]: ADMISSION_TARGET_ADDRESS
  })]);
  const legacy = wk1952Record([IMPLEMENTATION, admissionReviewSlice()]);
  const [compactDeclared, fullDeclared] = bothSummaries(declared);
  const [compactLegacy, fullLegacy] = bothSummaries(legacy);

  for (const [a, b] of [[compactDeclared, compactLegacy], [fullDeclared, fullLegacy]]) {
    assert.deepEqual(a.blockers, b.blockers);
    assert.equal(a.next_action, b.next_action);
    assert.equal(a.review_state.required, b.review_state.required);
    assert.equal(a.review_state.status, b.review_state.status);
    assert.equal(a.review_state.blocked, b.review_state.blocked);
    assert.deepEqual(a.terminal_review_designation, b.terminal_review_designation);
  }

  const declaredRow = { ...fullDeclared.slices.find((entry) => entry.id === "SLICE-002") };
  const legacyRow = { ...fullLegacy.slices.find((entry) => entry.id === "SLICE-002") };
  assert.equal(declaredRow[ADMISSION_TARGET_FIELD], ADMISSION_TARGET_ADDRESS);
  delete declaredRow[ADMISSION_TARGET_FIELD];
  assert.deepEqual(declaredRow, legacyRow);
});
