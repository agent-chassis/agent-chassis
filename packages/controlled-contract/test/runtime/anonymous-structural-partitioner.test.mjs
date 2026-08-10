import assert from "node:assert/strict";
import test from "node:test";

import {
  INPUT_VERSION,
  POLICY_VERSION,
  anonymousPlanningInputFromDecomposition,
  planAnonymousStructuralCoarsening
} from "../../lib/anonymous-structural-partitioner.mjs";

function planningInput({
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

function policy(priority, targetUnitWeight = 10, maxUnitWeight = targetUnitWeight) {
  return {
    policy_version: POLICY_VERSION,
    target_unit_weight: targetUnitWeight,
    max_unit_weight: maxUnitWeight,
    merge_signal_priority: priority
  };
}

function partitions(result) {
  return result.facts.final_units
    .map(({ member_component_ids }) => [...member_component_ids].sort())
    .sort((left, right) => left.join("\u0000").localeCompare(right.join("\u0000")));
}

test("disconnected anonymous nodes remain independent without a merge signal", () => {
  const result = planAnonymousStructuralCoarsening(
    planningInput(),
    policy(["dependency_adjacency"])
  );
  assert.equal(result.input_valid, true);
  assert.equal(result.policy_valid, true);
  assert.equal(result.authority.authoritative, false);
  assert.equal(result.facts.final_unit_count, 2);
  assert.deepEqual(partitions(result), [["a"], ["b"]]);
  assert.deepEqual(result.diagnostics, []);
});

test("write-write incidence can be selected as an anonymous coarsening signal", () => {
  const result = planAnonymousStructuralCoarsening(
    planningInput({
      resources: ["r"],
      accesses: [["a", "r", "write"], ["b", "r", "write"]]
    }),
    policy(["write_write_overlap"])
  );
  assert.deepEqual(partitions(result), [["a", "b"]]);
  assert.equal(result.facts.hierarchy_rounds.length, 1);
  assert.equal(
    result.facts.hierarchy_rounds[0].merges[0]
      .signal_counts.write_write_overlap,
    1
  );
});

test("read-read overlap is measured but never creates a supported merge signal", () => {
  const result = planAnonymousStructuralCoarsening(
    planningInput({
      resources: ["r"],
      accesses: [["a", "r", "read"], ["b", "r", "read"]]
    }),
    policy(["write_write_overlap", "dependency_aligned_write_read"])
  );
  assert.deepEqual(partitions(result), [["a"], ["b"]]);
  assert.deepEqual(
    result.facts.component_pair_facts[0].shared_read_resource_ids,
    ["r"]
  );
  assert.equal(result.facts.unresolved_merge_candidates.length, 0);
});

test("proof collections are measured but never treated as co-delivery", () => {
  const input = planningInput({
    components: ["a", "b"],
    collections: [["proof-set", ["a", "b"]]]
  });
  const result = planAnonymousStructuralCoarsening(
    input,
    policy(["dependency_adjacency"])
  );
  assert.deepEqual(partitions(result), [["a"], ["b"]]);
  assert.deepEqual(
    result.facts.component_pair_facts[0].shared_collection_ids,
    ["proof-set"]
  );
  assert.equal(result.facts.hierarchy_merge_count, 0);
});

test("ordered sequences veto a noncontiguous contraction without creating cohesion", () => {
  const result = planAnonymousStructuralCoarsening(
    planningInput({
      components: ["a", "b", "c"],
      resources: ["r"],
      accesses: [["a", "r", "write"], ["c", "r", "write"]],
      collections: [["sequence", ["a", "b", "c"], "ordered_sequence"]]
    }),
    policy(["write_write_overlap"], 3, 3)
  );
  assert.deepEqual(partitions(result), [["a"], ["b"], ["c"]]);
  assert.equal(result.facts.blocked_by_ordered_sequence_count, 1);
  assert.equal(
    result.diagnostics.at(-1).code,
    "ordered_sequence_noncontiguous_contraction"
  );
});

test("write-read incidence coarsens only when dependency direction corroborates it", () => {
  const base = {
    resources: ["r"],
    accesses: [["a", "r", "write"], ["b", "r", "read"]]
  };
  const unexplained = planAnonymousStructuralCoarsening(
    planningInput(base),
    policy(["dependency_aligned_write_read"])
  );
  assert.deepEqual(partitions(unexplained), [["a"], ["b"]]);
  assert.equal(unexplained.facts.unexplained_write_read_pair_count, 1);
  assert.equal(
    unexplained.diagnostics[0].code,
    "write_read_overlap_without_dependency"
  );

  const aligned = planAnonymousStructuralCoarsening(
    planningInput({ ...base, dependencies: [["a", "b"]] }),
    policy(["dependency_aligned_write_read"])
  );
  assert.deepEqual(partitions(aligned), [["a", "b"]]);
  assert.deepEqual(
    aligned.facts.component_pair_facts[0].aligned_write_read_resource_ids,
    ["r"]
  );
});

test("scope flow opposite the declared dependency is a fact, not an inferred rewrite", () => {
  const result = planAnonymousStructuralCoarsening(
    planningInput({
      dependencies: [["b", "a"]],
      resources: ["r"],
      accesses: [["a", "r", "write"], ["b", "r", "read"]]
    }),
    policy(["dependency_aligned_write_read"])
  );
  assert.deepEqual(partitions(result), [["a"], ["b"]]);
  assert.equal(result.facts.direction_conflict_pair_count, 1);
  assert.equal(result.diagnostics[0].code, "dependency_scope_direction_conflict");
});

test("unit weight prevents an otherwise supported merge", () => {
  const result = planAnonymousStructuralCoarsening(
    planningInput({
      resources: ["r"],
      accesses: [["a", "r", "write"], ["b", "r", "write"]]
    }),
    policy(["write_write_overlap"], 1)
  );
  assert.deepEqual(partitions(result), [["a"], ["b"]]);
  assert.equal(result.facts.blocked_by_weight_count, 1);
});

test("coarsening preserves the dependency quotient between surviving units", () => {
  const result = planAnonymousStructuralCoarsening(
    planningInput({
      components: ["a", "b", "c"],
      dependencies: [["b", "c"]],
      resources: ["shared", "flow"],
      accesses: [
        ["a", "shared", "write"],
        ["b", "shared", "write"],
        ["b", "flow", "write"],
        ["c", "flow", "read"]
      ]
    }),
    policy(["write_write_overlap", "dependency_aligned_write_read"], 2)
  );
  assert.deepEqual(partitions(result), [["a", "b"], ["c"]]);
  assert.deepEqual(result.facts.quotient_dependency_arcs, [{
    prerequisite_unit_id: "unit-001",
    dependent_unit_id: "unit-002",
    source_dependency_count: 1
  }]);
  assert.deepEqual(result.facts.quotient_topological_layers, [
    ["unit-001"], ["unit-002"]
  ]);
});

test("a non-convex merge that would create a quotient cycle is refused", () => {
  const result = planAnonymousStructuralCoarsening(
    planningInput({
      components: ["a", "b", "c"],
      dependencies: [["a", "b"], ["b", "c"]],
      resources: ["r"],
      accesses: [["a", "r", "write"], ["c", "r", "write"]]
    }),
    policy(["write_write_overlap"])
  );
  assert.deepEqual(partitions(result), [["a"], ["b"], ["c"]]);
  assert.equal(result.facts.blocked_by_cycle_count, 1);
  assert.equal(result.facts.unresolved_merge_candidates.length, 0);
  assert.deepEqual(result.facts.quotient_topological_layers, [
    ["unit-001"], ["unit-002"], ["unit-003"]
  ]);
});

test("structurally symmetric best candidates coarsen as one orbit", () => {
  const result = planAnonymousStructuralCoarsening(
    planningInput({
      components: ["root", "left", "right"],
      dependencies: [["root", "left"], ["root", "right"]]
    }),
    policy(["dependency_adjacency"], 3)
  );
  assert.deepEqual(partitions(result), [["left", "right", "root"]]);
  assert.equal(result.facts.hierarchy_rounds[0].merges.length, 1);
  assert.deepEqual(result.facts.unresolved_merge_candidates, []);
});

test("critical-path hierarchy recovers a balanced ordered fork-join plan", () => {
  const input = planningInput({
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
  const result = planAnonymousStructuralCoarsening(
    input,
    policy(["dependency_adjacency"], 16, 32)
  );
  assert.deepEqual(partitions(result), [
    ["authority", "fifo"],
    ["exclusions", "lifecycle", "local", "settlement"]
  ]);
  assert.equal(result.facts.desired_unit_count, 2);
  assert.deepEqual(result.facts.quotient_topological_layers, [
    ["unit-001"], ["unit-002"]
  ]);
  assert.equal(result.facts.critical_path_serialization_cost, 4);
});

test("preferred weight is applied independently inside every hierarchy root", () => {
  const isolated = ["g", "h", "i", "j", "k", "l", "m"];
  const input = planningInput({
    components: ["a", "b", "c", "d", "e", "f", ...isolated],
    weights: {
      a: 5, b: 5, c: 5, d: 5, e: 5, f: 5,
      g: 2, h: 2, i: 2, j: 2, k: 2, l: 1, m: 1
    },
    dependencies: [
      ["a", "b"], ["b", "c"],
      ["c", "d"], ["c", "e"],
      ["d", "f"], ["e", "f"]
    ]
  });
  const result = planAnonymousStructuralCoarsening(
    input,
    policy(["dependency_adjacency"], 16, 32)
  );
  assert.equal(result.facts.hierarchy_root_count, 8);
  assert.equal(result.facts.desired_unit_count, 9);
  assert.equal(result.facts.final_unit_count, 9);
  assert.equal(Math.max(...result.facts.final_units.map(({ weight }) => weight)), 20);
  assert.equal(result.facts.quotient_dependency_arcs.length, 1);
  assert.equal(result.facts.critical_path_serialization_cost, 5);
});

test("larger target capacity never increases the planned unit count", () => {
  const input = planningInput({
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
  const counts = [];
  for (let target = 7; target <= 32; target += 1) {
    const result = planAnonymousStructuralCoarsening(
      input,
      policy(["dependency_adjacency"], target, 32)
    );
    counts.push(result.facts.final_unit_count);
  }
  assert.equal(counts.every((count, index) =>
    index === 0 || count <= counts[index - 1]
  ), true);
  assert.equal(counts[4], counts[5]);
  assert.deepEqual([counts[0], counts.at(-1)], [5, 1]);
});

test("the target weight cannot exceed the hard model-capacity ceiling", () => {
  const result = planAnonymousStructuralCoarsening(
    planningInput(),
    policy(["dependency_adjacency"], 3, 2)
  );
  assert.equal(result.input_valid, true);
  assert.equal(result.policy_valid, false);
  assert.deepEqual(result.diagnostics, [{
    code: "target_unit_weight_exceeds_max_unit_weight"
  }]);
});

test("renaming and reordering opaque IDs preserves the partition up to renaming", () => {
  const original = planningInput({
    components: ["a", "b", "c", "d"],
    resources: ["x", "y"],
    accesses: [
      ["a", "x", "write"], ["b", "x", "write"],
      ["c", "y", "write"], ["d", "y", "write"]
    ]
  });
  const mapping = new Map([
    ["a", "q"], ["b", "n"], ["c", "z"], ["d", "m"],
    ["x", "resource-two"], ["y", "resource-one"]
  ]);
  const renamed = {
    ...structuredClone(original),
    components: [...original.components].reverse().map(({ component_id, weight }) => ({
      component_id: mapping.get(component_id),
      weight
    })),
    resources: [...original.resources].reverse().map(({ resource_id }) => ({
      resource_id: mapping.get(resource_id)
    })),
    accesses: [...original.accesses].reverse().map((access) => ({
      ...access,
      component_id: mapping.get(access.component_id),
      resource_id: mapping.get(access.resource_id)
    }))
  };
  const selectedPolicy = policy(["write_write_overlap"]);
  const originalResult = planAnonymousStructuralCoarsening(original, selectedPolicy);
  const renamedResult = planAnonymousStructuralCoarsening(renamed, selectedPolicy);
  const inverse = new Map([...mapping].map(([left, right]) => [right, left]));
  const restoredPartitions = renamedResult.facts.final_units
    .map(({ member_component_ids }) => member_component_ids.map((id) => inverse.get(id)).sort())
    .sort((left, right) => left.join("\u0000").localeCompare(right.join("\u0000")));
  assert.deepEqual(restoredPartitions, partitions(originalResult));
});

test("dependency cycles and dangling incidence fail before partitioning", () => {
  const cyclic = planAnonymousStructuralCoarsening(
    planningInput({ dependencies: [["a", "b"], ["b", "a"]] }),
    policy(["dependency_adjacency"])
  );
  assert.equal(cyclic.input_valid, false);
  assert.equal(cyclic.facts, null);
  assert.equal(cyclic.diagnostics[0].code, "anonymous_dependency_cycle");

  const dangling = planningInput();
  dangling.accesses.push({ component_id: "a", resource_id: "missing", mode: "read" });
  const invalid = planAnonymousStructuralCoarsening(
    dangling,
    policy(["dependency_adjacency"])
  );
  assert.equal(invalid.input_valid, false);
  assert.equal(invalid.facts, null);
  assert.equal(invalid.diagnostics[0].code, "dangling_access_resource");
});

test("duplicate dependency and access declarations fail structural validation", () => {
  const duplicated = planningInput({
    dependencies: [["a", "b"], ["a", "b"]],
    resources: ["r"],
    accesses: [["a", "r", "write"], ["a", "r", "write"]]
  });
  const result = planAnonymousStructuralCoarsening(
    duplicated,
    policy(["dependency_adjacency"])
  );
  assert.equal(result.input_valid, false);
  assert.deepEqual(result.diagnostics.map(({ code }) => code), [
    "duplicate_dependency",
    "duplicate_access"
  ]);
});

test("the decomposition adapter carries only anonymous graph and supplied scope facts", () => {
  const decomposition = {
    schema_valid: true,
    facts: {
      components: [
        { component_id: "component-001", complexity: { behavior_claim_count: 2 } },
        { component_id: "component-002", complexity: { behavior_claim_count: 1 } }
      ],
      behavior_dependency_arcs: [{
        prerequisite_component_id: "component-001",
        dependent_component_id: "component-002"
      }],
      collection_overlay: {
        attachments: [{
          collection_id: "set-one",
          target_component_ids: ["component-001", "component-002"]
        }]
      }
    }
  };
  const input = anonymousPlanningInputFromDecomposition(decomposition, {
    accesses: [
      { component_id: "component-001", resource_id: "resource-1", mode: "write" },
      { component_id: "component-002", resource_id: "resource-1", mode: "read" }
    ]
  });
  assert.deepEqual(input.components, [
    { component_id: "component-001", weight: 2 },
    { component_id: "component-002", weight: 1 }
  ]);
  assert.deepEqual(input.resources, [{ resource_id: "resource-1" }]);
  assert.deepEqual(input.collections, [{
    collection_id: "set-one",
    member_component_ids: ["component-001", "component-002"]
  }]);
});

test("the decomposition adapter preserves typed ordered collection incidence", () => {
  const decomposition = {
    schema_valid: true,
    facts: {
      components: [
        { component_id: "component-001", complexity: { behavior_claim_count: 1 } },
        { component_id: "component-002", complexity: { behavior_claim_count: 1 } }
      ],
      behavior_dependency_arcs: [],
      collection_overlay: {
        attachments: [{
          collection_id: "sequence-one",
          collection_kind: "ordered_sequence",
          target_component_ids: ["component-002", "component-001"]
        }]
      }
    }
  };
  const input = anonymousPlanningInputFromDecomposition(decomposition);
  assert.deepEqual(input.collections, [{
    collection_id: "sequence-one",
    collection_kind: "ordered_sequence",
    member_component_ids: ["component-002", "component-001"]
  }]);
});
