import assert from "node:assert/strict";
import test from "node:test";

import { buildExactAssociationGraph } from
  "../../lib/stable-association-semantics.mjs";
import { evaluateExactPartition } from
  "../../lib/stable-partition-semantics.mjs";
import { buildCompletePopulation } from
  "../../lib/population-semantics-v1.mjs";

const population = (id, members) => buildCompletePopulation({ population_id: id,
  completeness: "exact", authenticated: true, members,
  identity: ({ occurrence_id: occurrenceId }) => occurrenceId });
const left = () => population("left", [{ occurrence_id: "occ-a" },
  { occurrence_id: "occ-b" }]);
const right = () => population("right", [{ occurrence_id: "occ-x" },
  { occurrence_id: "occ-y" }]);
const rows = () => [{ association_id: "association-a", roles: {
  left: "occ-a", right: "occ-x" } }, { association_id: "association-b", roles: {
  left: "occ-b", right: "occ-y" } }];

test("exact association graph accepts one complete unambiguous correlation", () => {
  const graph = buildExactAssociationGraph({ graph_id: "graph", role_populations: {
    left: left(), right: right() }, associations: rows() });
  assert.equal(graph.association_count, 2);
  const duplicate = rows();
  duplicate.push({ ...duplicate[0], association_id: "association-c" });
  assert.throws(() => buildExactAssociationGraph({ graph_id: "graph", role_populations: {
    left: left(), right: right() }, associations: duplicate }),
  (error) => ["stable_association_duplicate", "stable_association_ambiguous"].includes(error.code));
  assert.throws(() => buildExactAssociationGraph({ graph_id: "graph", role_populations: {
    left: left(), right: right() }, associations: rows().slice(0, 1) }),
  (error) => error.code === "stable_association_missing");
  const ambiguous = [
    { association_id: "association-a-x", roles: { left: "occ-a", right: "occ-x" } },
    { association_id: "association-a-y", roles: { left: "occ-a", right: "occ-y" } },
    { association_id: "association-b-x", roles: { left: "occ-b", right: "occ-x" } },
    { association_id: "association-b-y", roles: { left: "occ-b", right: "occ-y" } }
  ];
  assert.throws(() => buildExactAssociationGraph({ graph_id: "graph",
    role_populations: { left: left(), right: right() }, associations: ambiguous }),
  (error) => error.code === "stable_association_ambiguous");
});

test("partition enforces closed exact union, disjointness, and normalized uniqueness", () => {
  const source = buildCompletePopulation({ population_id: "source", completeness: "exact",
    authenticated: true, members: ["a", "b", "c"] });
  const valid = evaluateExactPartition({ source_population: source,
    parts: [{ part_id: "first", members: ["a", "b"] },
      { part_id: "second", members: ["c"] }] });
  assert.equal(valid.source_cardinality, 3);
  for (const [parts, code] of [
    [[{ part_id: "first", members: ["a", "b"] },
      { part_id: "second", members: ["b", "c"] }], "stable_partition_overlap"],
    [[{ part_id: "first", members: ["a", "b"] }], "stable_partition_member_missing"],
    [[{ part_id: "first", members: ["a", "b", "c", "d"] }],
      "stable_partition_member_extra"],
    [[{ part_id: "first", members: ["a", "a", "b", "c"] }],
      "stable_partition_member_duplicate"]
  ]) assert.throws(() => evaluateExactPartition({ source_population: source, parts }),
    (error) => error.code === code, code);
});
