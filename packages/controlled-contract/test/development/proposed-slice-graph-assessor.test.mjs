import assert from "node:assert/strict";
import test from "node:test";

import {
  parseArgs,
  usage
} from "./tools/assess-proposed-slice-graph.mjs";
import {
  INPUT_VERSION
} from "../../lib/anonymous-structural-partitioner.mjs";
import {
  ASSESSMENT_POLICY_VERSION,
  PROPOSAL_VERSION,
  assessProposedSliceGraph
} from "./proposed-slice-graph-assessor.mjs";

function input({
  components = ["a", "b"],
  weights = {},
  dependencies = [],
  resources = [],
  accesses = [],
  collections = []
} = {}) {
  return {
    graph_version: INPUT_VERSION,
    components: components.map((componentId) => ({
      component_id: componentId,
      weight: weights[componentId] ?? 1
    })),
    dependencies: dependencies.map(([prerequisite, dependent]) => ({
      prerequisite_component_id: prerequisite,
      dependent_component_id: dependent
    })),
    resources: resources.map((resourceId) => ({ resource_id: resourceId })),
    accesses: accesses.map(([componentId, resourceId, mode]) => ({
      component_id: componentId,
      resource_id: resourceId,
      mode
    })),
    collections: collections.map(([collectionId, memberComponentIds, collectionKind]) => ({
      collection_id: collectionId,
      ...(collectionKind ? { collection_kind: collectionKind } : {}),
      member_component_ids: memberComponentIds
    }))
  };
}

function proposal(units, dependencies = []) {
  return {
    plan_version: PROPOSAL_VERSION,
    units: units.map(([unitId, memberComponentIds]) => ({
      unit_id: unitId,
      member_component_ids: memberComponentIds
    })),
    dependencies: dependencies.map(([prerequisite, dependent]) => ({
      prerequisite_unit_id: prerequisite,
      dependent_unit_id: dependent
    }))
  };
}

function policy({
  target = 16,
  maximum = 32,
  resourceStatus = "complete",
  comparisonSignals = ["dependency_adjacency"]
} = {}) {
  return {
    policy_version: ASSESSMENT_POLICY_VERSION,
    target_unit_weight: target,
    max_unit_weight: maximum,
    resource_incidence_status: resourceStatus,
    anonymous_comparison: comparisonSignals === null
      ? null
      : { merge_signal_priority: comparisonSignals }
  };
}

function slice018Input() {
  return input({
    components: [
      "authority", "fifo", "local", "settlement", "exclusions", "lifecycle"
    ],
    weights: {
      authority: 5,
      fifo: 6,
      local: 7,
      settlement: 5,
      exclusions: 4,
      lifecycle: 5
    },
    dependencies: [
      ["authority", "fifo"],
      ["fifo", "local"],
      ["local", "settlement"],
      ["local", "exclusions"],
      ["settlement", "lifecycle"],
      ["exclusions", "lifecycle"]
    ]
  });
}

function slice018Proposal() {
  return proposal([
    ["authority-fifo", ["authority", "fifo"]],
    ["local-tail", ["local", "settlement", "exclusions", "lifecycle"]]
  ], [["authority-fifo", "local-tail"]]);
}

test("the real SLICE-018 shape is consistent and independently reproduced", () => {
  const result = assessProposedSliceGraph(
    slice018Input(),
    slice018Proposal(),
    policy()
  );

  assert.equal(result.authority.authoritative, false);
  assert.equal(result.contract_consistency, "consistent");
  assert.equal(result.execution_profile_fit, "fits");
  assert.equal(result.assessment_completeness, "complete");
  assert.equal(result.anonymous_comparison, "identical");
  assert.deepEqual(
    result.facts.units.map(({ unit_id, weight }) => [unit_id, weight]),
    [["authority-fifo", 11], ["local-tail", 21]]
  );
  assert.equal(result.facts.internal_serialization_loss_sum, 4);
  assert.equal(result.facts.proposed_critical_path_serialization_cost, 4);
  assert.deepEqual(result.facts.required_unit_dependency_arcs, [{
    prerequisite_unit_id: "authority-fifo",
    dependent_unit_id: "local-tail",
    source_dependency_count: 1
  }]);
  assert.deepEqual(result.diagnostics, []);
});

test("a monolithic plan can be consistent while internalizing all parallelism", () => {
  const result = assessProposedSliceGraph(
    slice018Input(),
    proposal([["whole", [
      "authority", "fifo", "local", "settlement", "exclusions", "lifecycle"
    ]]]),
    policy({ target: 32, maximum: 32 })
  );

  assert.equal(result.contract_consistency, "consistent");
  assert.equal(result.execution_profile_fit, "fits");
  assert.equal(result.anonymous_comparison, "identical");
  assert.equal(result.facts.required_unit_dependency_arcs.length, 0);
  assert.equal(result.facts.internalized_dependency_count, 6);
  assert.equal(result.facts.internal_serialization_loss_sum, 4);
});

test("missing and reversed required order make a proposal inconsistent", () => {
  const result = assessProposedSliceGraph(
    input({
      components: ["a", "b", "c"],
      dependencies: [["a", "b"], ["b", "c"]]
    }),
    proposal(
      [["ua", ["a"]], ["ub", ["b"]], ["uc", ["c"]]],
      [["ub", "ua"]]
    ),
    policy({ target: 1, maximum: 2, comparisonSignals: null })
  );

  assert.equal(result.contract_consistency, "inconsistent");
  assert.equal(result.diagnostics.some(({ code }) =>
    code === "required_dependency_order_reversed"
  ), true);
  assert.equal(result.diagnostics.some(({ code }) =>
    code === "required_dependency_order_missing"
  ), true);
});

test("extra ordering is measured as unexplained serialization, not inconsistency", () => {
  const result = assessProposedSliceGraph(
    input({ components: ["a", "b"] }),
    proposal([["ua", ["a"]], ["ub", ["b"]]], [["ua", "ub"]]),
    policy({ target: 1, maximum: 1, comparisonSignals: null })
  );

  assert.equal(result.contract_consistency, "consistent");
  assert.deepEqual(result.facts.unexplained_serialization_pairs, [{
    prerequisite_unit_id: "ua",
    dependent_unit_id: "ub"
  }]);
  assert.equal(result.diagnostics.some(({ code }) =>
    code === "unexplained_serialization"
  ), true);
});

test("coverage errors invalidate the proposal before graph arithmetic", () => {
  const result = assessProposedSliceGraph(
    input({ components: ["a", "b"] }),
    proposal([["u1", ["a"]], ["u2", ["a", "unknown"]]]),
    policy()
  );

  assert.equal(result.proposal_valid, false);
  assert.equal(result.contract_consistency, "invalid");
  assert.deepEqual(result.diagnostics.map(({ code }) => code).sort(), [
    "component_assigned_multiple_times",
    "component_unassigned",
    "unknown_proposed_component"
  ]);
});

test("hard capacity is separate from contract consistency", () => {
  const result = assessProposedSliceGraph(
    slice018Input(),
    slice018Proposal(),
    policy({ target: 16, maximum: 20 })
  );

  assert.equal(result.contract_consistency, "consistent");
  assert.equal(result.execution_profile_fit, "exceeds");
  assert.deepEqual(
    result.diagnostics.filter(({ code }) => code === "unit_exceeds_maximum_weight"),
    [{
      code: "unit_exceeds_maximum_weight",
      unit_id: "local-tail",
      weight: 21,
      max_unit_weight: 20
    }]
  );
});

test("incomplete resource incidence downgrades completeness explicitly", () => {
  const result = assessProposedSliceGraph(
    input({
      resources: ["r"],
      accesses: [["a", "r", "write"], ["b", "r", "write"]]
    }),
    proposal([["u", ["a", "b"]]]),
    policy({
      resourceStatus: "partial",
      comparisonSignals: ["write_write_overlap"]
    })
  );

  assert.equal(result.contract_consistency, "consistent");
  assert.equal(result.assessment_completeness, "partial");
  assert.deepEqual(
    result.diagnostics.find(({ code }) => code === "resource_incidence_incomplete"),
    {
      code: "resource_incidence_incomplete",
      status: "partial",
      affects_anonymous_comparison: true
    }
  );
});

test("anonymous comparison differences are observations rather than failures", () => {
  const result = assessProposedSliceGraph(
    slice018Input(),
    proposal([
      ["authority", ["authority"]],
      ["fifo", ["fifo"]],
      ["local", ["local"]],
      ["settlement", ["settlement"]],
      ["exclusions", ["exclusions"]],
      ["lifecycle", ["lifecycle"]]
    ], [
      ["authority", "fifo"],
      ["fifo", "local"],
      ["local", "settlement"],
      ["local", "exclusions"],
      ["settlement", "lifecycle"],
      ["exclusions", "lifecycle"]
    ]),
    policy()
  );

  assert.equal(result.contract_consistency, "consistent");
  assert.equal(result.anonymous_comparison, "different");
  assert.equal(
    result.facts.anonymous_comparison.comparison_only_same_unit_pairs.length,
    7
  );
  assert.deepEqual(
    result.diagnostics.find(({ code }) => code === "anonymous_partition_differs"),
    {
      code: "anonymous_partition_differs",
      proposal_only_same_unit_pair_count: 0,
      comparison_only_same_unit_pair_count: 7
    }
  );
});

test("noncontiguous ordered-sequence contraction is inconsistent", () => {
  const result = assessProposedSliceGraph(
    input({
      components: ["a", "b", "c"],
      collections: [["sequence", ["a", "b", "c"], "ordered_sequence"]]
    }),
    proposal([["outer", ["a", "c"]], ["middle", ["b"]]]),
    policy({ comparisonSignals: null })
  );

  assert.equal(result.contract_consistency, "inconsistent");
  assert.deepEqual(result.facts.ordered_sequence_violations, [{
    collection_id: "sequence",
    unit_id: "outer",
    included_member_indexes: [0, 2]
  }]);
});

test("a contraction-created quotient cycle is distinguished from a source cycle", () => {
  const result = assessProposedSliceGraph(
    input({
      components: ["a", "b", "c"],
      dependencies: [["a", "b"], ["b", "c"]]
    }),
    proposal([["outside", ["a", "c"]], ["inside", ["b"]]]),
    policy({ comparisonSignals: null })
  );

  assert.equal(result.input_valid, true);
  assert.equal(result.contract_consistency, "inconsistent");
  assert.deepEqual(
    result.diagnostics.find(({ code }) =>
      code === "proposed_partition_induces_dependency_cycle"
    ),
    {
      code: "proposed_partition_induces_dependency_cycle",
      unit_ids: ["inside", "outside"]
    }
  );
});

test("redundant proposed dependencies remain advisory facts", () => {
  const result = assessProposedSliceGraph(
    input({
      components: ["a", "b", "c"],
      dependencies: [["a", "b"], ["b", "c"]]
    }),
    proposal(
      [["ua", ["a"]], ["ub", ["b"]], ["uc", ["c"]]],
      [["ua", "ub"], ["ub", "uc"], ["ua", "uc"]]
    ),
    policy({ comparisonSignals: null })
  );

  assert.equal(result.contract_consistency, "consistent");
  assert.deepEqual(result.facts.redundant_proposed_dependencies, [{
    prerequisite_unit_id: "ua",
    dependent_unit_id: "uc"
  }]);
});

test("input and proposal array order do not affect assessment facts", () => {
  const originalInput = slice018Input();
  const originalProposal = slice018Proposal();
  const original = assessProposedSliceGraph(
    originalInput,
    originalProposal,
    policy()
  );
  const reordered = assessProposedSliceGraph(
    {
      ...originalInput,
      components: [...originalInput.components].reverse(),
      dependencies: [...originalInput.dependencies].reverse()
    },
    {
      ...originalProposal,
      units: [...originalProposal.units].reverse(),
      dependencies: [...originalProposal.dependencies].reverse()
    },
    policy()
  );

  assert.deepEqual(reordered, original);
});

test("schema-invalid proposals fail closed", () => {
  const result = assessProposedSliceGraph(
    input(),
    { plan_version: PROPOSAL_VERSION, units: [], dependencies: [] },
    policy()
  );

  assert.equal(result.input_valid, true);
  assert.equal(result.proposal_valid, false);
  assert.equal(result.policy_valid, null);
  assert.equal(result.diagnostics[0].code, "proposed_slice_graph_schema_invalid");
});

test("schema-valid anonymous inputs with dangling facts fail closed", () => {
  const malformedInput = input();
  malformedInput.accesses.push({
    component_id: "a",
    resource_id: "missing",
    mode: "read"
  });
  const result = assessProposedSliceGraph(
    malformedInput,
    proposal([["u", ["a", "b"]]]),
    policy()
  );

  assert.equal(result.input_valid, false);
  assert.deepEqual(result.diagnostics, [{
    code: "dangling_access_resource",
    component_id: "a",
    resource_id: "missing"
  }]);
});

test("the CLI requires all three explicit artifact paths", () => {
  assert.deepEqual(parseArgs([
    "--input", "input.json",
    "--proposal", "proposal.json",
    "--policy", "policy.json"
  ]), {
    input: "input.json",
    proposal: "proposal.json",
    policy: "policy.json",
    help: false
  });
  assert.throws(
    () => parseArgs(["--input", "input.json"]),
    /--proposal is required/
  );
  assert.match(usage(), /does not create slices/);
});
