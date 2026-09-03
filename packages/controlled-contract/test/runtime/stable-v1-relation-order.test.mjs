import assert from "node:assert/strict";
import test from "node:test";

import { buildCompletePopulation } from
  "../../lib/population-semantics-v1.mjs";
import {
  assertAcyclicRelation,
  assertExactAdjacency,
  assertInverseRelation,
  assertTransitiveRelation,
  buildCompleteRelationPopulation,
  matchRelationPopulation
} from "../../lib/stable-relation-semantics.mjs";

const members = (values = ["a", "b", "c"], ordered = false) => buildCompletePopulation({
  population_id: "members", completeness: "exact", authenticated: true,
  members: values, ordered });
const relation = (edges, options = {}) => buildCompleteRelationPopulation({
  population_id: options.id ?? "relation",
  member_population: members(options.members, options.ordered), edges,
  irreflexive: options.irreflexive ?? false
});

test("adjacency requires the exact complete dominating member projection", () => {
  const omitted = relation([{ source: "a", target: "b" },
    { source: "b", target: "c" }], { members: ["a", "b", "c", "d"] });
  const cases = [
    [omitted, ["a", "b", "c"]],
    [relation([{ source: "a", target: "b" }, { source: "b", target: "c" }]),
      ["a", "b", "c", "d"]],
    [relation([{ source: "a", target: "b" }, { source: "b", target: "c" }]),
      ["a", "b", "b"]],
    [relation([{ source: "a", target: "b" }, { source: "b", target: "c" }]),
      ["a", "b", "x"]],
    [relation([{ source: "a", target: "b" }, { source: "b", target: "c" }],
      { ordered: true }), ["a", "c", "b"]]
  ];
  for (const [captured, projection] of cases) assert.throws(
    () => assertExactAdjacency(captured, projection),
    (error) => error.code === "stable_relation_ordered_projection_invalid"
  );
});

test("cycle identities preserve stable operand types and structures", () => {
  const operandCases = [
    ["alpha", "beta"], [1, 2], [false, true], [null, "nonnull"],
    [["a"], ["b"]], [{ id: "a" }, { id: "b" }], ["1", 1]
  ];
  for (const [left, right] of operandCases) {
    const acyclic = relation([{ source: left, target: right }], {
      id: "typed-acyclic", members: [left, right]
    });
    assert.equal(assertAcyclicRelation(acyclic), true);
    const cyclic = relation([{ source: left, target: right },
      { source: right, target: left }], { id: "typed-cycle", members: [left, right] });
    assert.throws(() => assertAcyclicRelation(cyclic),
      (error) => error.code === "stable_relation_cycle");
  }
});

test("relation exact/subset/at-least never weakens complete capture", () => {
  const captured = relation([{ source: "a", target: "b" },
    { source: "b", target: "c" }]);
  assert.equal(matchRelationPopulation({ captured,
    expected_edges: [{ source: "a", target: "b" }], mode: "subset" }).satisfied, true);
  assert.equal(matchRelationPopulation({ captured,
    expected_edges: [{ source: "a", target: "b" }], mode: "exact" }).satisfied, false);
  assert.equal(matchRelationPopulation({ captured,
    expected_edges: [{ source: "a", target: "b" }], mode: "at_least", minimum: 2
  }).satisfied, true);
  assert.throws(() => relation([{ source: "a", target: "missing" }]),
    (error) => error.code === "stable_relation_operand_unknown");
});

test("inverse, irreflexive, transitive, adjacency, and cycles are mechanical", () => {
  const forward = relation([{ source: "a", target: "b" },
    { source: "b", target: "c" }, { source: "a", target: "c" }]);
  const inverse = relation([{ source: "b", target: "a" },
    { source: "c", target: "b" }, { source: "c", target: "a" }], { id: "inverse" });
  assert.equal(assertInverseRelation(forward, inverse), true);
  assert.throws(() => assertInverseRelation(forward, relation([
    { source: "b", target: "a" }, { source: "c", target: "b" }
  ], { id: "incomplete-inverse" })),
  (error) => error.code === "stable_relation_inverse_mismatch");
  assert.equal(assertTransitiveRelation(forward), true);
  const adjacency = relation([{ source: "a", target: "b" },
    { source: "b", target: "c" }], { id: "adjacency" });
  assert.equal(assertExactAdjacency(adjacency, ["a", "b", "c"]), true);
  assert.equal(assertAcyclicRelation(adjacency), true);
  assert.throws(() => relation([{ source: "a", target: "a" }], { irreflexive: true }),
    (error) => error.code === "stable_relation_irreflexive_violation");
  assert.throws(() => assertTransitiveRelation(relation([
    { source: "a", target: "b" }, { source: "b", target: "c" }
  ])), (error) => error.code === "stable_relation_transitive_consequence_missing");
  assert.throws(() => assertExactAdjacency(relation([
    { source: "a", target: "b" }, { source: "a", target: "c" }
  ]), ["a", "b", "c"]), (error) => error.code === "stable_relation_adjacency_mismatch");
  assert.throws(() => assertExactAdjacency(adjacency, ["a", "c", "b"]),
    (error) => error.code === "stable_relation_adjacency_mismatch");
  assert.throws(() => assertAcyclicRelation(relation([
    { source: "a", target: "b" }, { source: "b", target: "a" }
  ])), (error) => error.code === "stable_relation_cycle");
});
