import {
  ExactBindingError,
  canonicalJsonBytes,
  compareCodeUnits,
  deepFreeze,
  sha256,
  sortedUnique
} from "./deterministic-projection-primitives.mjs";

const TRANSFORMER_ID = "integration-prefix-census.v1";
const DAG_VERSION = "controlled-contract.integration-prefix-dag.v1";
const UNITS_VERSION = "controlled-contract.integration-units.v1";
const PATHS_VERSION = "controlled-contract.execution-path-requirements.v1";
const CENSUS_VERSION = "controlled-contract.integration-prefix-census.v1";
const MAX_UNITS = 20;
const MAX_CASES = 100000;

function fail(code, message, details = {}) {
  throw new ExactBindingError(code, message, details);
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every((key) =>
      Object.hasOwn(value, key));
}

function assertIdentifier(value, field) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0") ||
      value !== value.normalize("NFC")) fail(
    "projection_input_identifier_invalid",
    "projection identifiers must be nonempty canonical NFC strings", { field }
  );
}

function parseCanonicalDocument(bytes, label) {
  let value;
  try {
    value = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch (error) {
    fail("projection_input_json_invalid", `${label} is not valid JSON`, {
      label, cause: error.message
    });
  }
  if (!Buffer.from(bytes).equals(canonicalJsonBytes(value, { file: true }))) fail(
    "projection_input_noncanonical",
    `${label} must be canonical JSON plus exactly one LF`, { label }
  );
  return value;
}

function assertCanonicalDag(value) {
  if (!exactKeys(value, ["schema_version", "slices", "depends_on"]) ||
      value.schema_version !== DAG_VERSION || !Array.isArray(value.slices) ||
      value.slices.length === 0 || !Array.isArray(value.depends_on)) fail(
    "projection_dag_invalid", "the integration DAG source is invalid"
  );
  const sliceIds = value.slices.map((slice, index) => {
    if (!exactKeys(slice, ["slice_id"])) fail(
      "projection_dag_invalid", "each DAG slice must contain only slice_id"
    );
    assertIdentifier(slice.slice_id, `slices[${index}].slice_id`);
    return slice.slice_id;
  });
  if (!sortedUnique(sliceIds)) fail(
    "projection_dag_noncanonical", "DAG slices must be sorted and unique"
  );
  const sliceSet = new Set(sliceIds);
  const edgeKeys = value.depends_on.map((edge, index) => {
    if (!exactKeys(edge, ["predecessor_slice_id", "successor_slice_id"])) fail(
      "projection_dag_invalid", "each dependency must contain exactly two endpoints"
    );
    assertIdentifier(edge.predecessor_slice_id,
      `depends_on[${index}].predecessor_slice_id`);
    assertIdentifier(edge.successor_slice_id,
      `depends_on[${index}].successor_slice_id`);
    if (edge.predecessor_slice_id === edge.successor_slice_id ||
        !sliceSet.has(edge.predecessor_slice_id) ||
        !sliceSet.has(edge.successor_slice_id)) fail(
      "projection_dependency_invalid", "dependency endpoints must be distinct DAG slices"
    );
    return `${edge.predecessor_slice_id}\0${edge.successor_slice_id}`;
  });
  if (!sortedUnique(edgeKeys)) fail(
    "projection_dag_noncanonical", "DAG dependencies must be sorted and unique"
  );
  assertAcyclic(sliceIds, value.depends_on.map((edge) => ({
    predecessor: edge.predecessor_slice_id,
    successor: edge.successor_slice_id
  })), "projection_dag_cycle", "integration prefix derivation requires an acyclic DAG");
  return { sliceIds, edges: value.depends_on };
}

function assertAcyclic(ids, edges, code, message) {
  const successors = new Map(ids.map((id) => [id, []]));
  const indegree = new Map(ids.map((id) => [id, 0]));
  for (const { predecessor, successor } of edges) {
    successors.get(predecessor).push(successor);
    indegree.set(successor, indegree.get(successor) + 1);
  }
  const ready = ids.filter((id) => indegree.get(id) === 0).sort(compareCodeUnits);
  let visited = 0;
  while (ready.length > 0) {
    const current = ready.shift();
    visited += 1;
    for (const successor of successors.get(current).sort(compareCodeUnits)) {
      indegree.set(successor, indegree.get(successor) - 1);
      if (indegree.get(successor) === 0) {
        ready.push(successor);
        ready.sort(compareCodeUnits);
      }
    }
  }
  if (visited !== ids.length) fail(code, message);
}

function assertCanonicalUnits(value, sliceIds) {
  if (!exactKeys(value, ["schema_version", "integration_units"]) ||
      value.schema_version !== UNITS_VERSION ||
      !Array.isArray(value.integration_units) || value.integration_units.length === 0) fail(
    "projection_integration_units_invalid", "the integration-unit source is invalid"
  );
  if (value.integration_units.length > MAX_UNITS) fail(
    "projection_population_limit_exceeded",
    `at most ${MAX_UNITS} integration units may be enumerated locally`
  );
  const sliceSet = new Set(sliceIds);
  const assigned = new Set();
  const unitIds = [];
  for (const [index, unit] of value.integration_units.entries()) {
    if (!exactKeys(unit, ["unit_id", "slice_ids"]) ||
        !Array.isArray(unit.slice_ids) || unit.slice_ids.length === 0) fail(
      "projection_integration_units_invalid",
      "each integration unit must contain unit_id and a nonempty slice_ids array"
    );
    assertIdentifier(unit.unit_id, `integration_units[${index}].unit_id`);
    unitIds.push(unit.unit_id);
    if (!sortedUnique(unit.slice_ids)) fail(
      "projection_integration_units_noncanonical",
      "integration-unit slice members must be sorted and unique"
    );
    for (const [memberIndex, sliceId] of unit.slice_ids.entries()) {
      assertIdentifier(sliceId, `integration_units[${index}].slice_ids[${memberIndex}]`);
      if (!sliceSet.has(sliceId) || assigned.has(sliceId)) fail(
        "projection_integration_unit_partition_invalid",
        "integration units must form a disjoint partition of all DAG slices"
      );
      assigned.add(sliceId);
    }
  }
  if (!sortedUnique(unitIds)) fail(
    "projection_integration_units_noncanonical", "integration units must be sorted and unique"
  );
  if (assigned.size !== sliceIds.length) fail(
    "projection_source_set_incomplete", "integration units must cover every supplied DAG slice",
    { missing_slice_ids: sliceIds.filter((id) => !assigned.has(id)) }
  );
  return value.integration_units;
}

function assertCanonicalPaths(value) {
  if (!exactKeys(value, ["schema_version", "execution_paths"]) ||
      value.schema_version !== PATHS_VERSION || !Array.isArray(value.execution_paths) ||
      value.execution_paths.length === 0) fail(
    "projection_execution_paths_invalid", "the execution-path source is invalid"
  );
  const pathIds = [];
  for (const [index, path] of value.execution_paths.entries()) {
    if (!exactKeys(path, ["path_id", "required_branches"]) ||
        !Array.isArray(path.required_branches) || path.required_branches.length === 0) fail(
      "projection_execution_paths_invalid",
      "each execution path must declare at least one required branch"
    );
    assertIdentifier(path.path_id, `execution_paths[${index}].path_id`);
    pathIds.push(path.path_id);
    for (const [branchIndex, branch] of path.required_branches.entries()) {
      assertIdentifier(branch, `execution_paths[${index}].required_branches[${branchIndex}]`);
    }
    if (!sortedUnique(path.required_branches)) fail(
      "projection_execution_paths_noncanonical", "required branches must be sorted and unique"
    );
  }
  if (!sortedUnique(pathIds)) fail(
    "projection_execution_paths_noncanonical", "execution paths must be sorted and unique"
  );
  return value.execution_paths;
}

function assertAcyclicUnitQuotient(units, edges) {
  const unitBySlice = new Map(units.flatMap(({ unit_id: unitId, slice_ids: ids }) =>
    ids.map((sliceId) => [sliceId, unitId])));
  const unitIds = units.map(({ unit_id: id }) => id);
  const unique = new Set();
  for (const edge of edges) {
    const predecessor = unitBySlice.get(edge.predecessor_slice_id);
    const successor = unitBySlice.get(edge.successor_slice_id);
    if (predecessor !== successor) unique.add(`${predecessor}\0${successor}`);
  }
  assertAcyclic(unitIds, [...unique].map((key) => {
    const [predecessor, successor] = key.split("\0");
    return { predecessor, successor };
  }), "projection_integration_unit_quotient_cycle",
  "integration units must preserve an acyclic dependency quotient");
}

function enumerateSelections(units, visit, index = 0, selected = []) {
  if (index === units.length) return visit(selected);
  enumerateSelections(units, visit, index + 1, selected);
  selected.push(units[index]);
  enumerateSelections(units, visit, index + 1, selected);
  selected.pop();
}

function integrationPrefixCensus(sourceValues, sourceDigests) {
  const dag = assertCanonicalDag(sourceValues[0]);
  const units = assertCanonicalUnits(sourceValues[1], dag.sliceIds);
  const paths = assertCanonicalPaths(sourceValues[2]);
  assertAcyclicUnitQuotient(units, dag.edges);
  const multiplier = paths.reduce((sum, path) => sum + path.required_branches.length, 0);
  const maximumPrefixes = Math.floor(MAX_CASES / multiplier);
  const prefixes = [];
  enumerateSelections(units, (selectedUnits) => {
    const slices = selectedUnits.flatMap(({ slice_ids: ids }) => ids).sort(compareCodeUnits);
    const selected = new Set(slices);
    if (dag.edges.some((edge) => selected.has(edge.successor_slice_id) &&
        !selected.has(edge.predecessor_slice_id))) return;
    if (prefixes.length >= maximumPrefixes) fail(
      "projection_population_limit_exceeded",
      `derived case population exceeds the local ${MAX_CASES}-case limit`
    );
    prefixes.push({
      prefix_id: `prefix-${sha256(canonicalJsonBytes({ slice_ids: slices }))}`,
      integration_unit_ids: selectedUnits.map(({ unit_id: id }) => id).sort(compareCodeUnits),
      slice_ids: slices
    });
  });
  prefixes.sort((left, right) => compareCodeUnits(left.prefix_id, right.prefix_id));
  const cases = prefixes.flatMap(({ prefix_id: prefixId }) => paths.flatMap(
    ({ path_id: pathId, required_branches: branches }) => branches.map((branch) => ({
      case_id: `case-${sha256(canonicalJsonBytes({
        prefix_id: prefixId, path_id: pathId, branch
      }))}`,
      prefix_id: prefixId, path_id: pathId, branch
    }))
  )).sort((left, right) => compareCodeUnits(left.case_id, right.case_id));
  if (new Set(prefixes.map(({ prefix_id: id }) => id)).size !== prefixes.length ||
      new Set(cases.map(({ case_id: id }) => id)).size !== cases.length) fail(
    "projection_identifier_collision", "derived projection identifiers must be unique"
  );
  return {
    schema_version: CENSUS_VERSION,
    transformer_id: TRANSFORMER_ID,
    source_set_sha256: sha256(canonicalJsonBytes({
      transformer_id: TRANSFORMER_ID, source_content_sha256: sourceDigests
    })),
    prefixes,
    cases
  };
}

const registry = Object.freeze({
  [TRANSFORMER_ID]: Object.freeze({
    source_count: 3,
    transform: integrationPrefixCensus,
    populations: Object.freeze({
      cases: (value) => value.cases.map(({ case_id: id }) => `ref-${id}`),
      prefixes: (value) => value.prefixes.map(({ prefix_id: id }) => `ref-${id}`)
    })
  })
});

function runTransformerTwice(transform, sourceValues, sourceDigests) {
  const first = canonicalJsonBytes(transform(
    structuredClone(sourceValues), [...sourceDigests]
  ), { file: true });
  const second = canonicalJsonBytes(transform(
    structuredClone(sourceValues), [...sourceDigests]
  ), { file: true });
  if (!first.equals(second)) fail(
    "projection_transformer_nondeterministic",
    "the package-owned deterministic transformer produced unequal repeated outputs"
  );
  return first;
}

function validateDeterministicProjectionRelation(relation) {
  const transformer = registry[relation.transformer_id];
  if (!transformer) return [{
    code: "projection_transformer_unknown",
    message: "the deterministic projection transformer is not package-owned",
    relation_id: relation.relation_id
  }];
  if (relation.source_requirement_ids.length !== transformer.source_count) return [{
    code: "projection_source_set_incomplete",
    message: "the deterministic projection relation does not declare its complete source set",
    relation_id: relation.relation_id
  }];
  return [];
}

function validateDeterministicProjectionPopulation(transformerId, populationId) {
  const transformer = registry[transformerId];
  if (!transformer) return [{
    code: "projection_transformer_unknown",
    message: "the deterministic projection transformer is not package-owned"
  }];
  if (!Object.hasOwn(transformer.populations, populationId)) return [{
    code: "projection_population_unknown",
    message: "the deterministic projection population is not package-owned",
    population_id: populationId
  }];
  return [];
}

function executeDeterministicProjection(transformerId, sourceBytes) {
  const transformer = registry[transformerId];
  if (!transformer) fail(
    "projection_transformer_unknown", "the deterministic projection transformer is not package-owned"
  );
  if (!Array.isArray(sourceBytes) || sourceBytes.length !== transformer.source_count ||
      sourceBytes.some((bytes) => !Buffer.isBuffer(bytes))) fail(
    "projection_source_set_incomplete",
    "the deterministic projection runner requires every captured source byte sequence"
  );
  const values = sourceBytes.map((bytes, index) =>
    parseCanonicalDocument(bytes, `source[${index}]`));
  return runTransformerTwice(transformer.transform, values, sourceBytes.map(sha256));
}

function assertCanonicalProjectionResult(bytes) {
  const value = parseCanonicalDocument(bytes, "projection result");
  if (value?.schema_version !== CENSUS_VERSION || value?.transformer_id !== TRANSFORMER_ID) fail(
    "projection_result_shape_invalid",
    "captured projection result does not identify the registered canonical output"
  );
  return deepFreeze(value);
}

function projectDeterministicPopulation(transformerId, resultBytes, populationId) {
  const transformer = registry[transformerId];
  if (!transformer || !Object.hasOwn(transformer.populations, populationId)) fail(
    "projection_population_unknown",
    "the deterministic projection population is not package-owned",
    { transformer_id: transformerId, population_id: populationId }
  );
  const value = assertCanonicalProjectionResult(resultBytes);
  const referenceIds = transformer.populations[populationId](value);
  if (!sortedUnique(referenceIds)) fail(
    "projection_population_noncanonical",
    "the deterministic projection population must be sorted and unique",
    { transformer_id: transformerId, population_id: populationId }
  );
  return referenceIds;
}

export {
  assertCanonicalProjectionResult,
  executeDeterministicProjection,
  projectDeterministicPopulation,
  runTransformerTwice,
  validateDeterministicProjectionPopulation,
  validateDeterministicProjectionRelation
};
