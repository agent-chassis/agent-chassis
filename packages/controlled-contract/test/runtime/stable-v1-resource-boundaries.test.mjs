import assert from "node:assert/strict";
import test from "node:test";

import {
  STABLE_RESOURCE_LIMITS,
  assertStableResourceUsage
} from "../../lib/verification-profile-v1.mjs";
import {
  STABLE_SEMANTIC_WORK_LIMIT,
  assertStableSemanticWork,
  buildCompletePopulation,
  validateStableOccurrenceCapture
} from "../../lib/population-semantics-v1.mjs";
import { buildExactAssociationGraph } from
  "../../lib/stable-association-semantics.mjs";
import { evaluateExactPartition } from
  "../../lib/stable-partition-semantics.mjs";
import {
  assertAcyclicRelation,
  assertExactAdjacency,
  assertInverseRelation,
  assertTransitiveRelation,
  buildCompleteRelationPopulation,
  matchRelationPopulation
} from
  "../../lib/stable-relation-semantics.mjs";

test("every stable resource accepts N and refuses N+1 without override", () => {
  for (const [field, limit] of Object.entries(STABLE_RESOURCE_LIMITS)) {
    assert.equal(assertStableResourceUsage({ [field]: limit }), true, field);
    assert.throws(() => assertStableResourceUsage({ [field]: limit + 1 }),
      (error) => error.code === `stable_${field}_limit_exceeded`, field);
  }
});

test("relation owners refuse expected and derived N+1 work before semantic traversal", () => {
  const twoMembers = buildCompletePopulation({ population_id: "two", completeness: "exact",
    authenticated: true, members: ["a", "b"] });
  const captured = buildCompleteRelationPopulation({ population_id: "one-edge",
    member_population: twoMembers, edges: [{ source: "a", target: "b" }] });
  const expected = new Array(STABLE_SEMANTIC_WORK_LIMIT + 1);
  assert.throws(() => matchRelationPopulation({ captured, expected_edges: expected,
    mode: "exact" }), (error) => error.code === "stable_relation_work_limit_exceeded");

  const values = Array.from({ length: 200 }, (_, index) => index);
  const completeOrderEdges = values.flatMap((source, index) =>
    values.slice(index + 1).map((target) => ({ source, target }))
  );
  const orderMembers = buildCompletePopulation({ population_id: "order-members",
    completeness: "exact", authenticated: true, members: values });
  const completeOrder = buildCompleteRelationPopulation({ population_id: "complete-order",
    member_population: orderMembers, edges: completeOrderEdges, irreflexive: true });
  assert.equal(completeOrderEdges.length, 19900);
  assert.throws(() => assertTransitiveRelation(completeOrder),
    (error) => error.code === "stable_relation_work_limit_exceeded" &&
      error.details.observed > STABLE_SEMANTIC_WORK_LIMIT);

  const directOversized = { completeness: "exact", authenticated: true,
    edge_count: STABLE_SEMANTIC_WORK_LIMIT + 1,
    edges: new Array(STABLE_SEMANTIC_WORK_LIMIT + 1) };
  assert.throws(() => assertAcyclicRelation(directOversized),
    (error) => error.code === "stable_relation_work_limit_exceeded");
  assert.throws(() => assertInverseRelation(directOversized, directOversized),
    (error) => error.code === "stable_relation_work_limit_exceeded");
  assert.throws(() => assertTransitiveRelation({ ...directOversized, edge_count: 0 }),
    (error) => error.code === "stable_relation_population_invalid");
});

test("descriptor type, identity, size, and read length are post-read invariants", () => {
  const descriptor = { type: "regular_file", dev: 1n, ino: 2n, size: 3 };
  assert.equal(assertStableResourceUsage({ descriptor_before: descriptor,
    descriptor_after: { ...descriptor }, read_length: 3 }), true);
  for (const after of [
    { ...descriptor, type: "directory" },
    { ...descriptor, dev: 2n },
    { ...descriptor, ino: 3n },
    { ...descriptor, size: 4 }
  ]) assert.throws(() => assertStableResourceUsage({ descriptor_before: descriptor,
    descriptor_after: after, read_length: 3 }),
  (error) => error.code === "stable_source_descriptor_changed");
  assert.throws(() => assertStableResourceUsage({ descriptor_before: descriptor,
    descriptor_after: { ...descriptor }, read_length: 2 }),
  (error) => error.code === "stable_source_descriptor_changed");
});

test("every stable primitive shares N and refuses N+1 before materialization", () => {
  assert.equal(assertStableSemanticWork(STABLE_SEMANTIC_WORK_LIMIT), true);
  assert.throws(() => assertStableSemanticWork(STABLE_SEMANTIC_WORK_LIMIT + 1),
    (error) => error.code === "stable_population_work_limit_exceeded");

  const tooMany = new Array(STABLE_SEMANTIC_WORK_LIMIT + 1);
  assert.throws(() => buildCompletePopulation({ population_id: "too-many",
    completeness: "exact", authenticated: true, members: tooMany }),
  (error) => error.code === "stable_population_work_limit_exceeded");
  assert.throws(() => validateStableOccurrenceCapture({
    schema_version: "controlled-contract.authoritative-ordered-occurrence-population.v1",
    source_grounded_identity_sha256: "a".repeat(64), occurrences: tooMany
  }), (error) => error.code === "stable_occurrence_work_limit_exceeded");

  const member = buildCompletePopulation({ population_id: "member", completeness: "exact",
    authenticated: true, members: [{ occurrence_id: "occ-a" }],
    identity: ({ occurrence_id: occurrenceId }) => occurrenceId });
  assert.throws(() => buildExactAssociationGraph({ graph_id: "too-many",
    role_populations: { left: member, right: member },
    associations: new Array(Math.floor(STABLE_SEMANTIC_WORK_LIMIT / 2) + 1) }),
  (error) => error.code === "stable_association_work_limit_exceeded");
  assert.throws(() => evaluateExactPartition({ source_population: member,
    parts: tooMany }), (error) => error.code === "stable_partition_work_limit_exceeded");
  assert.throws(() => buildCompleteRelationPopulation({ population_id: "too-many",
    member_population: member, edges: tooMany }),
  (error) => error.code === "stable_relation_work_limit_exceeded");
  assert.throws(() => assertExactAdjacency({ completeness: "exact", authenticated: true,
    edges: [] }, tooMany),
  (error) => error.code === "stable_relation_adjacency_work_limit_exceeded");
});
