import assert from "node:assert/strict";
import test from "node:test";

import { computeReviewedUnitSourceDigest } from "../packages/wiki-core/src/lib/work-record-review-attestation.mjs";

const RECORD_ID = "WK-9914";
const SLICE_ID = "SLICE-020";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function scenarios() {
  return [
    {
      id: "scenario-selected-success",
      scenario_kind: "success_case",
      process_boundary: true,
      asserts_contract: "reviewed-unit digest contract",
      asserts_provenance_field: "source_digest",
      uses_stub: "structured reviewer backend",
      runtime_mode: "managed worker",
      artifact_kind: "regression_test"
    },
    {
      id: "scenario-selected-refusal",
      scenario_kind: "refusal_case",
      process_boundary: false,
      asserts_contract: "stale reviewed-unit digest is refused",
      asserts_provenance_field: "review_run_ref.run_id",
      uses_stub: "stored attestation",
      runtime_mode: "coordinator",
      artifact_kind: "unit_test"
    }
  ];
}

function idlessScenarios() {
  const entries = clone(scenarios());
  for (const entry of entries) delete entry.id;
  return entries;
}

function recordWithSlice(sliceOverrides = {}, recordOverrides = {}) {
  return {
    id: RECORD_ID,
    repo: "agent-chassis/agent-chassis",
    record_kind: "work_item",
    work_kind: "implementation",
    docs: ["docs/parent-legacy.md"],
    read_scope: ["docs/parent-canonical.md"],
    write_scope: ["packages/wiki-core/src/lib/parent.mjs"],
    repo_paths: ["packages/wiki-core/src/lib/parent.mjs"],
    slices: [
      {
        id: SLICE_ID,
        work_kind: "implementation",
        write_scope: ["tests/work-record-reviewed-unit-digest-normalization.test.mjs"],
        repo_paths: ["tests/work-record-reviewed-unit-digest-normalization.test.mjs"],
        scenarios: scenarios(),
        ...sliceOverrides
      }
    ],
    ...recordOverrides
  };
}

function reviewedDigest(record) {
  return computeReviewedUnitSourceDigest({
    record,
    selected_slice_id: SLICE_ID
  });
}

function recordDigest(record) {
  return computeReviewedUnitSourceDigest(record);
}

function escalation(overrides = {}) {
  return {
    id: "ESC-001",
    kind: "large_file_exception",
    status: "proposed",
    provenance: "authored_record",
    ...overrides
  };
}

const ESCALATION_DIGEST_SCOPES = [
  ["record-level", recordDigest],
  ["selected-slice", reviewedDigest]
];

function expectedEditTarget(overrides = {}) {
  return {
    id: "target-selected",
    path: "packages/wiki-core/src/lib/selected.mjs",
    name: "selected target",
    kind: "function",
    activity_kind: "implementation_modify",
    artifact_kind: "production_code_module",
    operation: "modify",
    granularity: "function",
    optional: false,
    ...overrides
  };
}

test("omitted slice targets inherit the parent target plan", () => {
  const inherited = recordWithSlice({}, {
    expected_edit_targets: [expectedEditTarget()]
  });
  const sliceOwnedEquivalent = recordWithSlice({
    expected_edit_targets: [expectedEditTarget()]
  }, {
    expected_edit_targets: [expectedEditTarget({ name: "unused parent target" })]
  });

  assert.equal(
    reviewedDigest(inherited),
    reviewedDigest(sliceOwnedEquivalent),
    "an omitted slice plan must resolve to the same effective plan as an equivalent slice-owned plan"
  );
});

test("changing omitted slice targets to explicit empty changes the effective plan digest", () => {
  const inherited = recordWithSlice({}, {
    expected_edit_targets: [expectedEditTarget()]
  });
  const sliceOwnedEmpty = clone(inherited);
  sliceOwnedEmpty.slices[0].expected_edit_targets = [];

  assert.notEqual(
    reviewedDigest(sliceOwnedEmpty),
    reviewedDigest(inherited),
    "an explicit empty slice plan must not fall through to a non-empty parent plan"
  );
});

test("parent target churn behind a slice-owned empty plan leaves the digest unchanged", () => {
  const record = recordWithSlice({ expected_edit_targets: [] }, {
    expected_edit_targets: [expectedEditTarget()]
  });
  const originalDigest = reviewedDigest(record);
  const parentChurn = clone(record);
  parentChurn.expected_edit_targets = [
    expectedEditTarget({
      path: "packages/wiki-core/src/lib/changed-parent.mjs",
      name: "changed parent target",
      operation: "delete"
    })
  ];

  assert.equal(
    reviewedDigest(parentChurn),
    originalDigest,
    "an explicit empty slice plan must remain authoritative during parent target churn"
  );
});

test("parent related add remove and reorder churn leaves the selected-slice digest unchanged", () => {
  const record = recordWithSlice({}, {
    related: ["WK-1001", "WK-1002"]
  });
  const originalDigest = reviewedDigest(record);

  const added = clone(record);
  added.related.push("WK-1003");
  assert.equal(reviewedDigest(added), originalDigest);

  const removed = clone(record);
  removed.related.shift();
  assert.equal(reviewedDigest(removed), originalDigest);

  const reordered = clone(record);
  reordered.related.reverse();
  assert.equal(reviewedDigest(reordered), originalDigest);
});

test("behavior-bearing effective target mutations change the reviewed-unit digest", () => {
  const record = recordWithSlice({}, {
    expected_edit_targets: [expectedEditTarget()]
  });
  const originalDigest = reviewedDigest(record);
  const mutations = {
    id: "target-renamed",
    path: "packages/wiki-core/src/lib/selected-two.mjs",
    name: "renamed target",
    kind: "method",
    activity_kind: "implementation_remove",
    artifact_kind: "production_code_export",
    operation: "delete",
    granularity: "method",
    optional: true
  };

  for (const [field, value] of Object.entries(mutations)) {
    const mutated = clone(record);
    mutated.expected_edit_targets[0][field] = value;
    assert.notEqual(reviewedDigest(mutated), originalDigest, `${field} must be digest-bound`);
  }
});

test("reviewed-unit digest binds scenario behavior but ignores ordering and annotations", () => {
  const record = recordWithSlice();
  const originalDigest = reviewedDigest(record);

  const behaviorMutations = {
    id: "scenario-renamed",
    scenario_kind: "failure_recovery_case",
    process_boundary: false,
    asserts_contract: "changed reviewed-unit digest contract",
    asserts_provenance_field: "attestation_digest",
    uses_stub: "different structured backend",
    runtime_mode: "different runtime mode",
    artifact_kind: "integration_test"
  };
  for (const [field, value] of Object.entries(behaviorMutations)) {
    const mutated = clone(record);
    mutated.slices[0].scenarios[0][field] = value;
    assert.notEqual(reviewedDigest(mutated), originalDigest, `${field} must be digest-bound`);
  }

  const reordered = clone(record);
  reordered.slices[0].scenarios.reverse();
  assert.equal(reviewedDigest(reordered), originalDigest);

  const insertionOrderAndAnnotations = clone(record);
  insertionOrderAndAnnotations.slices[0].scenarios[0] = {
    arbitrary_annotation: { ignored: true },
    artifact_kind: "regression_test",
    runtime_mode: "managed worker",
    uses_stub: "structured reviewer backend",
    asserts_provenance_field: "source_digest",
    asserts_contract: "reviewed-unit digest contract",
    process_boundary: true,
    scenario_kind: "success_case",
    id: "scenario-selected-success",
    facet_provenance: {
      id: "derived_normalizer",
      scenario_kind: "unavailable"
    }
  };
  assert.equal(reviewedDigest(insertionOrderAndAnnotations), originalDigest);
});

test("id-less scenario ordering does not bind position-derived feature-vector IDs", () => {
  const record = recordWithSlice({ scenarios: idlessScenarios() });
  const originalDigest = reviewedDigest(record);

  const reordered = clone(record);
  reordered.slices[0].scenarios.reverse();

  assert.equal(
    reviewedDigest(reordered),
    originalDigest,
    "reordering id-less scenarios must not bind their scenario-N normalization IDs"
  );
});

test("reviewed-unit digest binds id-less scenario behavior", () => {
  const record = recordWithSlice({ scenarios: idlessScenarios() });
  const originalDigest = reviewedDigest(record);
  const behaviorMutations = {
    scenario_kind: "failure_recovery_case",
    process_boundary: false,
    asserts_contract: "changed reviewed-unit digest contract",
    asserts_provenance_field: "attestation_digest",
    uses_stub: "different structured backend",
    runtime_mode: "different runtime mode",
    artifact_kind: "integration_test"
  };

  for (const [field, value] of Object.entries(behaviorMutations)) {
    const mutated = clone(record);
    mutated.slices[0].scenarios[0][field] = value;
    assert.notEqual(reviewedDigest(mutated), originalDigest, `${field} must be digest-bound`);
  }
});

test("reviewed-unit digest distinguishes authored scenario IDs from id-less scenarios", () => {
  const idless = recordWithSlice({ scenarios: idlessScenarios() });
  const withAuthoredId = clone(idless);
  withAuthoredId.slices[0].scenarios[0].id = "scenario-authored";

  assert.notEqual(
    reviewedDigest(withAuthoredId),
    reviewedDigest(idless),
    "adding an authored scenario ID must change the digest"
  );

  const changedAuthoredId = clone(withAuthoredId);
  changedAuthoredId.slices[0].scenarios[0].id = "scenario-authored-renamed";
  assert.notEqual(
    reviewedDigest(changedAuthoredId),
    reviewedDigest(withAuthoredId),
    "changing an authored scenario ID must change the digest"
  );

  const removedAuthoredId = clone(withAuthoredId);
  delete removedAuthoredId.slices[0].scenarios[0].id;
  assert.notEqual(
    reviewedDigest(removedAuthoredId),
    reviewedDigest(withAuthoredId),
    "removing an authored scenario ID must change the digest"
  );
});

test("reviewed-unit digest preserves duplicate id-less scenarios", () => {
  const entries = idlessScenarios();
  const duplicate = clone(entries[0]);
  const record = recordWithSlice({ scenarios: [entries[0], duplicate, entries[1]] });
  const withOneDuplicateRemoved = clone(record);
  withOneDuplicateRemoved.slices[0].scenarios.splice(1, 1);

  assert.notEqual(
    reviewedDigest(withOneDuplicateRemoved),
    reviewedDigest(record),
    "duplicate id-less scenarios must retain multiset cardinality in the digest"
  );
});

test("slice-owned docs and read_scope are semantically equivalent", () => {
  const legacy = recordWithSlice({
    docs: ["docs/selected-contract.md", "AGENTS.md"]
  });
  const canonical = recordWithSlice({
    read_scope: ["AGENTS.md", "docs/selected-contract.md"]
  });

  assert.equal(reviewedDigest(canonical), reviewedDigest(legacy));
});

test("a slice-owned read-scope alias prevents both parent aliases from leaking", () => {
  for (const alias of ["docs", "read_scope"]) {
    const record = recordWithSlice({
      [alias]: ["docs/selected-contract.md"]
    });
    const originalDigest = reviewedDigest(record);
    const parentChurn = clone(record);
    parentChurn.docs = ["docs/changed-parent-legacy.md"];
    parentChurn.read_scope = ["docs/changed-parent-canonical.md"];

    assert.equal(
      reviewedDigest(parentChurn),
      originalDigest,
      `slice-owned ${alias} must exclude both parent aliases`
    );
  }
});

test("parent read-scope fallback preserves legacy migration semantics", () => {
  const legacy = recordWithSlice({}, {
    docs: ["docs/parent-contract.md", "AGENTS.md"],
    read_scope: undefined
  });
  const canonical = clone(legacy);
  delete canonical.docs;
  canonical.read_scope = ["AGENTS.md", "docs/parent-contract.md"];

  const originalDigest = reviewedDigest(legacy);
  assert.equal(
    reviewedDigest(canonical),
    originalDigest,
    "moving nonempty parent docs to canonical read_scope must be digest-stable"
  );

  canonical.read_scope.push("docs/additional-parent-contract.md");
  assert.notEqual(
    reviewedDigest(canonical),
    originalDigest,
    "a slice with neither alias must inherit behavior-bearing parent read_scope"
  );
});

for (const [scopeName, digest] of ESCALATION_DIGEST_SCOPES) {
  test(`${scopeName} reviewed-unit digest binds escalation addition`, () => {
    const record = recordWithSlice({}, {
      escalations: [escalation()]
    });
    const added = clone(record);
    added.escalations.push(escalation({ id: "ESC-002" }));

    assert.notEqual(digest(added), digest(record));
  });

  test(`${scopeName} reviewed-unit digest binds escalation removal`, () => {
    const record = recordWithSlice({}, {
      escalations: [escalation(), escalation({ id: "ESC-002" })]
    });
    const removed = clone(record);
    removed.escalations.pop();

    assert.notEqual(digest(removed), digest(record));
  });

  for (const [field, value] of [
    ["id", "ESC-RENAMED"],
    ["kind", "cross_repo_exception"],
    ["status", "accepted"],
    ["provenance", "derived_policy_pack"]
  ]) {
    test(`${scopeName} reviewed-unit digest binds escalation ${field} mutation`, () => {
      const record = recordWithSlice({}, {
        escalations: [escalation()]
      });
      const mutated = clone(record);
      mutated.escalations[0][field] = value;

      assert.notEqual(digest(mutated), digest(record));
    });
  }

  test(`${scopeName} reviewed-unit digest ignores unknown escalation annotations`, () => {
    const record = recordWithSlice({}, {
      escalations: [escalation()]
    });
    const annotated = clone(record);
    annotated.escalations[0].unknown_annotation = {
      authority_claim: "must not enter the normalized projection"
    };

    assert.equal(digest(annotated), digest(record));
  });

  test(`${scopeName} reviewed-unit digest ignores escalation object insertion order`, () => {
    const record = recordWithSlice({}, {
      escalations: [escalation()]
    });
    const reordered = clone(record);
    reordered.escalations[0] = {
      provenance: "authored_record",
      status: "proposed",
      kind: "large_file_exception",
      id: "ESC-001"
    };

    assert.equal(digest(reordered), digest(record));
  });

  test(`${scopeName} reviewed-unit digest treats empty and absent escalations as equivalent`, () => {
    const absent = recordWithSlice();
    const empty = clone(absent);
    empty.escalations = [];

    assert.equal(digest(empty), digest(absent));
  });
}
