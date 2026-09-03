import { scalarCompare } from "./deterministic-lexicographic-ordering.mjs";
import { resolveNativeContractDag } from "./native-contract-dag.mjs";
import {
  StableSemanticError,
  canonicalizeStableValue,
  compareCodeUnits,
  stableSemanticKey
} from "./equality-normalization-v1.mjs";
import {
  assertStableSemanticWork,
  requireCompleteAuthority
} from "./population-semantics-v1.mjs";

function refuse(code, message, details = {}) {
  throw new StableSemanticError(code, message, details);
}

function safeWorkSum(...values) {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0 || total > Number.MAX_SAFE_INTEGER - value) {
      refuse("stable_relation_work_measure_invalid",
        "stable relation work must remain a nonnegative safe integer");
    }
    total += value;
  }
  return total;
}

function safeWorkProduct(left, right) {
  if (!Number.isSafeInteger(left) || left < 0 || !Number.isSafeInteger(right) || right < 0 ||
      left !== 0 && right > Math.floor(Number.MAX_SAFE_INTEGER / left)) refuse(
    "stable_relation_work_measure_invalid",
    "stable relation work multiplication must remain a nonnegative safe integer"
  );
  return left * right;
}

function edgeKey(edge) {
  return stableSemanticKey({ source: edge.source, target: edge.target });
}

function relationEdgeCount(population) {
  if (!population || !Array.isArray(population.edges) ||
      population.edge_count !== population.edges.length) refuse(
    "stable_relation_population_invalid",
    "complete relation populations must carry an exact edge count"
  );
  return population.edges.length;
}

function normalizeEdges(edges, memberKeys, { allowReflexive = true } = {}) {
  if (!Array.isArray(edges)) refuse(
    "stable_relation_edges_invalid", "relation edges must be a complete array"
  );
  const keys = new Set();
  const normalized = [];
  for (const [index, edge] of edges.entries()) {
    if (!edge || typeof edge !== "object" || Array.isArray(edge) ||
        !Object.hasOwn(edge, "source") || !Object.hasOwn(edge, "target")) refuse(
      "stable_relation_edge_invalid", "each relation edge requires source and target", { index }
    );
    const sourceKey = stableSemanticKey(edge.source);
    const targetKey = stableSemanticKey(edge.target);
    if (!memberKeys.has(sourceKey) || !memberKeys.has(targetKey)) refuse(
      "stable_relation_operand_unknown",
      "relation operands must come from the dominating complete member population", { index }
    );
    if (!allowReflexive && sourceKey === targetKey) refuse(
      "stable_relation_irreflexive_violation",
      "an irreflexive relation cannot contain a self edge", { index }
    );
    const normalizedEdge = canonicalizeStableValue({ source: edge.source, target: edge.target });
    const key = edgeKey(normalizedEdge);
    if (keys.has(key)) refuse(
      "stable_relation_edge_duplicate", "complete relation edges must be unique", { index }
    );
    keys.add(key);
    normalized.push(normalizedEdge);
  }
  normalized.sort((left, right) =>
    scalarCompare(String(left.source), String(right.source)) ||
    scalarCompare(String(left.target), String(right.target)) ||
    compareCodeUnits(edgeKey(left), edgeKey(right))
  );
  return { edges: normalized, keys };
}

function buildCompleteRelationPopulation({
  population_id: populationId,
  member_population: memberPopulation,
  completeness = "exact",
  authenticated = true,
  edges,
  irreflexive = false
}) {
  requireCompleteAuthority(memberPopulation);
  requireCompleteAuthority({ completeness, authenticated });
  if (!Array.isArray(edges)) refuse(
    "stable_relation_edges_invalid", "relation edges must be a complete array"
  );
  assertStableSemanticWork(safeWorkSum(memberPopulation.cardinality, edges.length),
    "stable_relation_work_limit_exceeded");
  const memberKeys = new Set(memberPopulation.members.map(stableSemanticKey));
  const normalized = normalizeEdges(edges, memberKeys, { allowReflexive: !irreflexive });
  return Object.freeze({
    relation_population_version: "controlled-contract.complete-relation-population.v1",
    population_id: populationId,
    member_population_id: memberPopulation.population_id,
    member_population: memberPopulation,
    completeness: "exact",
    authenticated: true,
    edge_count: normalized.edges.length,
    edges: Object.freeze(normalized.edges.map(Object.freeze))
  });
}

function matchRelationPopulation({
  captured,
  expected_edges: expectedEdges,
  mode = "exact",
  minimum = null
}) {
  requireCompleteAuthority(captured);
  if (!Array.isArray(expectedEdges) || !["exact", "subset", "at_least"].includes(mode)) {
    refuse("stable_relation_match_invalid", "relation matching uses a closed stable mode");
  }
  const capturedCount = relationEdgeCount(captured);
  assertStableSemanticWork(safeWorkSum(capturedCount, expectedEdges.length),
    "stable_relation_work_limit_exceeded");
  const capturedKeys = new Set(captured.edges.map(edgeKey));
  const expectedKeys = new Set(expectedEdges.map((edge) => edgeKey(canonicalizeStableValue(edge))));
  if (expectedKeys.size !== expectedEdges.length) refuse(
    "stable_relation_expected_duplicate", "expected relation edges must be unique"
  );
  const missing = [...expectedKeys].filter((key) => !capturedKeys.has(key))
    .sort(compareCodeUnits);
  const extra = [...capturedKeys].filter((key) => !expectedKeys.has(key))
    .sort(compareCodeUnits);
  const satisfied = missing.length === 0 &&
    (mode !== "exact" || extra.length === 0) &&
    (mode !== "at_least" || Number.isSafeInteger(minimum) && minimum >= 0 &&
      capturedCount >= minimum);
  return Object.freeze({ mode, satisfied, missing, extra,
    captured_count: capturedCount, expected_count: expectedKeys.size,
    minimum: mode === "at_least" ? minimum : null });
}

function assertInverseRelation(forward, inverse) {
  requireCompleteAuthority(forward);
  requireCompleteAuthority(inverse);
  const forwardCount = relationEdgeCount(forward);
  const inverseCount = relationEdgeCount(inverse);
  assertStableSemanticWork(safeWorkSum(forwardCount, inverseCount),
    "stable_relation_work_limit_exceeded");
  const expected = new Set(forward.edges.map(({ source, target }) => edgeKey({
    source: target, target: source
  })));
  const actual = new Set(inverse.edges.map(edgeKey));
  if (expected.size !== actual.size || [...expected].some((key) => !actual.has(key))) refuse(
    "stable_relation_inverse_mismatch",
    "inverse relations must contain exactly every reversed complete edge"
  );
  return true;
}

function assertTransitiveRelation(population) {
  requireCompleteAuthority(population);
  const edgeCount = relationEdgeCount(population);
  assertStableSemanticWork(edgeCount, "stable_relation_work_limit_exceeded");
  const incomingCount = new Map();
  const outgoingCount = new Map();
  for (const edge of population.edges) {
    const sourceKey = stableSemanticKey(edge.source);
    const targetKey = stableSemanticKey(edge.target);
    outgoingCount.set(sourceKey, (outgoingCount.get(sourceKey) ?? 0) + 1);
    incomingCount.set(targetKey, (incomingCount.get(targetKey) ?? 0) + 1);
  }
  let traversalWork = 0;
  for (const [key, incoming] of incomingCount) traversalWork = safeWorkSum(
    traversalWork, safeWorkProduct(incoming, outgoingCount.get(key) ?? 0)
  );
  assertStableSemanticWork(safeWorkSum(edgeCount, traversalWork),
    "stable_relation_work_limit_exceeded");
  const keys = new Set(population.edges.map(edgeKey));
  const outgoing = new Map();
  for (const edge of population.edges) {
    const values = outgoing.get(stableSemanticKey(edge.source)) ?? [];
    values.push(edge.target);
    outgoing.set(stableSemanticKey(edge.source), values);
  }
  for (const left of population.edges) for (const target of
    outgoing.get(stableSemanticKey(left.target)) ?? []) {
    const consequence = edgeKey({ source: left.source, target });
    if (!keys.has(consequence)) refuse(
      "stable_relation_transitive_consequence_missing",
      "complete transitive relations must include every mechanical consequence",
      { source: left.source, via: left.target, target }
    );
  }
  return true;
}

function assertExactAdjacency(population, orderedOccurrenceIds) {
  requireCompleteAuthority(population);
  if (!Array.isArray(orderedOccurrenceIds)) {
    refuse("stable_relation_ordered_projection_invalid",
      "adjacency requires one complete duplicate-free ordered occurrence projection");
  }
  assertStableSemanticWork(orderedOccurrenceIds.length,
    "stable_relation_adjacency_work_limit_exceeded");
  const derivedEdgeCount = Math.max(0, orderedOccurrenceIds.length - 1);
  const edgeCount = relationEdgeCount(population);
  const memberPopulation = population.member_population;
  requireCompleteAuthority(memberPopulation);
  if (!Array.isArray(memberPopulation.members) ||
      memberPopulation.cardinality !== memberPopulation.members.length) refuse(
    "stable_relation_population_invalid",
    "adjacency requires an exact dominating member count"
  );
  assertStableSemanticWork(safeWorkSum(
    edgeCount, memberPopulation.members.length,
    orderedOccurrenceIds.length, derivedEdgeCount
  ),
    "stable_relation_adjacency_work_limit_exceeded");
  const orderedKeys = orderedOccurrenceIds.map(stableSemanticKey);
  const memberKeys = memberPopulation.members.map(stableSemanticKey);
  const orderedKeySet = new Set(orderedKeys);
  const memberKeySet = new Set(memberKeys);
  if (orderedKeySet.size !== orderedOccurrenceIds.length ||
      orderedKeys.length !== memberKeys.length ||
      memberKeySet.size !== memberKeys.length ||
      memberKeys.some((key) => !orderedKeySet.has(key)) ||
      memberPopulation.ordered && memberKeys.some((key, index) => key !== orderedKeys[index])) {
    refuse("stable_relation_ordered_projection_invalid",
      "adjacency requires exactly the complete dominating member population in declared order");
  }
  const expected = orderedOccurrenceIds.slice(0, -1).map((source, index) => ({
    source, target: orderedOccurrenceIds[index + 1]
  }));
  const result = matchRelationPopulation({ captured: population,
    expected_edges: expected, mode: "exact" });
  if (!result.satisfied) refuse(
    "stable_relation_adjacency_mismatch",
    "adjacency contains exactly the consecutive edges of one ordered projection",
    { missing: result.missing, extra: result.extra }
  );
  return true;
}

function assertAcyclicRelation(population) {
  requireCompleteAuthority(population);
  const edgeCount = relationEdgeCount(population);
  assertStableSemanticWork(safeWorkSum(
    edgeCount, safeWorkProduct(edgeCount, 2)
  ), "stable_relation_work_limit_exceeded");
  const operandByKey = new Map();
  for (const { source, target } of population.edges) {
    operandByKey.set(stableSemanticKey(source), source);
    operandByKey.set(stableSemanticKey(target), target);
  }
  const internalId = (key) => `claim-${Buffer.from(key, "utf8").toString("hex")}`;
  const keyByInternalId = new Map([...operandByKey.keys()].map((key) => [internalId(key), key]));
  const ids = [...keyByInternalId.keys()].sort(compareCodeUnits);
  const contract = {
    claims: ids.map((id) => ({ claim_id: id, kind: "behavior", modality: "MAY" })),
    relations: population.edges.map(({ source, target }, index) => ({
      relation_id: `rel-${index}`, role: "precedes",
      source_claim_id: internalId(stableSemanticKey(source)),
      target_claim_id: internalId(stableSemanticKey(target))
    })),
    collections: []
  };
  const result = resolveNativeContractDag(contract, { acyclic_roles: ["precedes"] });
  const cycle = result.diagnostics.find(({ code }) => code === "relation_cycle");
  if (cycle) refuse(
    "stable_relation_cycle", "acyclic relation operators refuse directed cycles",
    { claim_path: cycle.claim_path.map((id) =>
      canonicalizeStableValue(operandByKey.get(keyByInternalId.get(id)))) }
  );
  return true;
}

export {
  assertAcyclicRelation,
  assertExactAdjacency,
  assertInverseRelation,
  assertTransitiveRelation,
  buildCompleteRelationPopulation,
  matchRelationPopulation
};
