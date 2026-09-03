import {
  ExactBindingError,
  canonicalJsonBytes,
  compareCodeUnits,
  deepFreeze,
  parseCanonicalDocument,
  sha256,
  sortedUnique
} from "./deterministic-projection-primitives.mjs";
import {
  GRAPH_VERSION,
  assertProjectedContractGraph
} from "./projected-contract-graph.mjs";
import {
  MUTATION_PAGINATION_TRACE_TRANSFORMER
} from "./mutation-pagination-trace-projection.mjs";
import {
  AUTHENTICATION_PROVENANCE_OCCURRENCE_TRANSFORMER
} from "./authentication-provenance-occurrence-projection.mjs";
import {
  SOUND_NEGATIVE_OBSERVATION_TRANSFORMER
} from "./sound-negative-observation-projection.mjs";
import {
  CALLER_INPUT_AUTHORITY_CONFINEMENT_TRANSFORMER
} from "./caller-input-authority-confinement-projection.mjs";
import {
  SUPPLEMENTARY_ISOLATION_ATTEMPT_TRANSFORMER
} from "./supplementary-isolation-attempt-projection.mjs";
import {
  DECLARED_BOUNDARY_RECORD_CONSISTENCY_TRANSFORMER
} from "./declared-boundary-record-consistency.mjs";
import {
  DECLARED_LIMIT_GUIDANCE_PROPAGATION_TRANSFORMER
} from "./declared-limit-guidance-propagation.mjs";
import {
  TRANSFORMER_ID as LEXICOGRAPHIC_TRANSFORMER_ID,
  assertLexicographicConformanceResult,
  deterministicLexicographicConformance,
  projectLexicographicPopulation
} from "./deterministic-lexicographic-ordering.mjs";

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

function assertCanonicalUnits(value, sliceIds, maximumUnits = MAX_UNITS) {
  if (!exactKeys(value, ["schema_version", "integration_units"]) ||
      value.schema_version !== UNITS_VERSION ||
      !Array.isArray(value.integration_units) || value.integration_units.length === 0) fail(
    "projection_integration_units_invalid", "the integration-unit source is invalid"
  );
  if (maximumUnits !== null && value.integration_units.length > maximumUnits) fail(
    "projection_population_limit_exceeded",
    `at most ${maximumUnits} integration units may be enumerated locally`
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

function integrationPrefixCensus(sourceValues, sourceDigests, { uncapped = false } = {}) {
  const dag = assertCanonicalDag(sourceValues[0]);
  const units = assertCanonicalUnits(sourceValues[1], dag.sliceIds, uncapped ? null : MAX_UNITS);
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
    if (!uncapped && prefixes.length >= maximumPrefixes) fail(
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

function parseIntegrationPrefixSources(sourceBytes) {
  return sourceBytes.map((bytes, index) =>
    parseCanonicalDocument(bytes, `source[${index}]`));
}

function validateIntegrationPrefixResult(value) {
  if (value?.schema_version !== CENSUS_VERSION || value?.transformer_id !== TRANSFORMER_ID) {
    fail("projection_result_shape_invalid",
      "captured projection result does not identify the registered canonical output");
  }
  return value;
}

const CASE_POPULATION_REFERENCE = "ref-derived-case-population";
const UNCONDITIONAL = Object.freeze({
  mode: "unconditional", operand_reference_ids: []
});

function orderById(field) {
  return (left, right) => compareCodeUnits(left[field], right[field]);
}

function integrationPrefixCaseMembershipSubgraph(value) {
  const caseIds = value.cases.map(({ case_id: caseId }) => caseId).sort(compareCodeUnits);
  const prefixByCase = new Map(value.cases.map(
    ({ case_id: caseId, prefix_id: prefixId }) => [caseId, prefixId]
  ));
  const references = [
    {
      reference_id: CASE_POPULATION_REFERENCE,
      type_term: "cc:population",
      identity: { kind: "profile_term", term: "derived-case-population" }
    },
    ...value.prefixes.map(({ prefix_id: prefixId }) => ({
      reference_id: `ref-${prefixId}`,
      type_term: "cc:scope",
      identity: { kind: "profile_term", term: prefixId }
    })),
    ...caseIds.map((caseId) => ({
      reference_id: `ref-${caseId}`,
      type_term: "cc:test",
      identity: { kind: "profile_term", term: caseId }
    }))
  ].sort(orderById("reference_id"));
  const propositions = [
    ...caseIds.map((caseId) => ({
      proposition_id: `prop-membership-${caseId}`,
      subject_reference_id: `ref-${prefixByCase.get(caseId)}`,
      operator: "reference:contains",
      applicability_context: { ...UNCONDITIONAL },
      operands: [{ kind: "reference", reference_id: `ref-${caseId}` }]
    })),
    ...caseIds.map((caseId) => ({
      proposition_id: `prop-member-of-${caseId}`,
      subject_reference_id: `ref-${caseId}`,
      operator: "reference:member_of",
      applicability_context: { ...UNCONDITIONAL },
      operands: [{ kind: "reference", reference_id: CASE_POPULATION_REFERENCE }]
    })),
    ...caseIds.map((caseId) => ({
      proposition_id: `prop-exists-${caseId}`,
      subject_reference_id: `ref-${caseId}`,
      operator: "boolean:exists",
      applicability_context: { ...UNCONDITIONAL },
      operands: [{ kind: "boolean", value: true }]
    })),
    {
      proposition_id: "prop-derived-case-population-cardinality",
      subject_reference_id: CASE_POPULATION_REFERENCE,
      operator: "number:has_cardinality",
      applicability_context: { ...UNCONDITIONAL },
      operands: [{ kind: "number", value: caseIds.length }]
    }
  ].sort(orderById("proposition_id"));
  const claims = propositions.map(({ proposition_id: propositionId }) => ({
    claim_id: `claim-${propositionId.slice("prop-".length)}`,
    kind: "evidence",
    modality: "MUST",
    proposition_id: propositionId
  })).sort(orderById("claim_id"));
  const membershipClaimIds = caseIds.map((caseId) => `claim-membership-${caseId}`)
    .sort(compareCodeUnits);
  return {
    schema_version: GRAPH_VERSION,
    claims,
    collections: membershipClaimIds.length === 0 ? [] : [{
      collection_id: "set-derived-case-membership",
      collection_kind: "closed_set",
      purpose: "derived_case_membership",
      member_claim_ids: membershipClaimIds
    }],
    propositions,
    references,
    relations: caseIds.map((caseId) => ({
      relation_id: `rel-derives-${caseId}`,
      role: "derives_from",
      source_claim_id: `claim-member-of-${caseId}`,
      target_claim_id: `claim-exists-${caseId}`
    })).sort(orderById("relation_id"))
  };
}

const OCCURRENCE_POPULATION_REFERENCE = "ref-derived-occurrence-population";
const ATTEMPT_POPULATION_REFERENCE = "ref-derived-attempt-population";
const SOURCE_POPULATION_REFERENCE = "ref-derived-source-population";
const CRITERION_POPULATION_REFERENCE = "ref-derived-criterion-population";
const EXCLUDED_POPULATION_REFERENCE = "ref-derived-excluded-case-population";
const CENSUS_RUN_REFERENCE = "ref-derived-census-run";
const CENSUS_INTERVAL = Object.freeze({
  mode: "during", operand_reference_ids: [CENSUS_RUN_REFERENCE]
});

function evidenceClaim(propositionId) {
  return {
    claim_id: `claim-${propositionId.slice("prop-".length)}`,
    kind: "evidence",
    modality: "MUST",
    proposition_id: propositionId
  };
}

function closedPopulation(populationReferenceId, term, memberReferenceIds) {
  return {
    reference: {
      reference_id: populationReferenceId,
      type_term: "cc:population",
      identity: { kind: "profile_term", term }
    },
    propositions: [
      ...memberReferenceIds.map((memberReferenceId) => ({
        proposition_id: `prop-member-of-${term}-${memberReferenceId.slice("ref-".length)}`,
        subject_reference_id: memberReferenceId,
        operator: "reference:member_of",
        applicability_context: { ...UNCONDITIONAL },
        operands: [{ kind: "reference", reference_id: populationReferenceId }]
      })),
      {
        proposition_id: `prop-cardinality-${term}`,
        subject_reference_id: populationReferenceId,
        operator: "number:has_cardinality",
        applicability_context: { ...UNCONDITIONAL },
        operands: [{ kind: "number", value: memberReferenceIds.length }]
      }
    ]
  };
}

function integrationPrefixCaseAssociationSubgraph(value) {
  const cases = [...value.cases].sort(
    (left, right) => compareCodeUnits(left.case_id, right.case_id)
  );

  const occurrenceIds = cases.map(({ case_id: caseId }) => `ref-${caseId}`);
  const attemptIds = value.prefixes.map(({ prefix_id: prefixId }) =>
    `ref-attempt-${prefixId}`).sort(compareCodeUnits);
  const sourceIds = [...new Set(cases.map(({ path_id: pathId }) => `ref-source-${pathId}`))]
    .sort(compareCodeUnits);
  const criterionIds = [...new Set(cases.flatMap(({ path_id: pathId, branch }) => [
    `ref-criterion-path-${pathId}`, `ref-criterion-branch-${branch}`
  ]))].sort(compareCodeUnits);
  const populations = [
    closedPopulation(OCCURRENCE_POPULATION_REFERENCE, "occurrence", occurrenceIds),
    closedPopulation(ATTEMPT_POPULATION_REFERENCE, "attempt", attemptIds),
    closedPopulation(SOURCE_POPULATION_REFERENCE, "source", sourceIds),
    closedPopulation(CRITERION_POPULATION_REFERENCE, "criterion", criterionIds),

    closedPopulation(EXCLUDED_POPULATION_REFERENCE, "excluded-case", [])
  ];
  const references = [
    ...populations.map(({ reference }) => reference),
    {
      reference_id: CENSUS_RUN_REFERENCE,
      type_term: "cc:process",
      identity: { kind: "profile_term", term: "derived-census-run" }
    },
    ...occurrenceIds.map((referenceId) => ({
      reference_id: referenceId,
      type_term: "cc:evidence_occurrence",
      identity: { kind: "profile_term", term: referenceId.slice("ref-".length) }
    })),
    ...attemptIds.map((referenceId) => ({
      reference_id: referenceId,
      type_term: "cc:process",
      identity: { kind: "profile_term", term: referenceId.slice("ref-".length) }
    })),
    ...sourceIds.map((referenceId) => ({
      reference_id: referenceId,
      type_term: "cc:resource",
      identity: { kind: "profile_term", term: referenceId.slice("ref-".length) }
    })),
    ...criterionIds.map((referenceId) => ({
      reference_id: referenceId,
      type_term: "cc:criterion",
      identity: { kind: "profile_term", term: referenceId.slice("ref-".length) }
    }))
  ].sort(orderById("reference_id"));
  const propositions = [
    ...populations.flatMap(({ propositions: entries }) => entries),
    ...cases.map(({ case_id: caseId }) => ({
      proposition_id: `prop-exists-${caseId}`,
      subject_reference_id: `ref-${caseId}`,
      operator: "boolean:exists",
      applicability_context: { ...UNCONDITIONAL },
      operands: [{ kind: "boolean", value: true }]
    })),
    ...cases.map(({ case_id: caseId, prefix_id: prefixId }) => ({
      proposition_id: `prop-observed-in-${caseId}`,
      subject_reference_id: `ref-${caseId}`,
      operator: "reference:observed_in",
      applicability_context: { ...UNCONDITIONAL },
      operands: [{ kind: "reference", reference_id: `ref-attempt-${prefixId}` }]
    })),
    ...cases.map(({ case_id: caseId, path_id: pathId }) => ({
      proposition_id: `prop-originates-from-${caseId}`,
      subject_reference_id: `ref-${caseId}`,
      operator: "reference:originates_from",
      applicability_context: { ...CENSUS_INTERVAL },
      operands: [{ kind: "reference", reference_id: `ref-source-${pathId}` }]
    })),
    ...cases.map(({ case_id: caseId, prefix_id: prefixId, path_id: pathId }) => ({
      proposition_id: `prop-depends-on-${caseId}`,
      subject_reference_id: `ref-${caseId}`,
      operator: "reference:depends_on",
      applicability_context: { ...UNCONDITIONAL },
      operands: [`ref-attempt-${prefixId}`, `ref-source-${pathId}`]
        .sort(compareCodeUnits)
        .map((referenceId) => ({ kind: "reference", reference_id: referenceId }))
    })),
    ...cases.flatMap(({ case_id: caseId, path_id: pathId, branch }) => [
      { criterion: `ref-criterion-path-${pathId}`, discriminator: "path" },
      { criterion: `ref-criterion-branch-${branch}`, discriminator: "branch" }
    ].map(({ criterion, discriminator }) => ({
      proposition_id: `prop-covers-${discriminator}-${caseId}`,
      subject_reference_id: `ref-${caseId}`,
      operator: "reference:covers",
      applicability_context: { ...UNCONDITIONAL },
      operands: [{ kind: "reference", reference_id: criterion }]
    })))
  ].sort(orderById("proposition_id"));
  const existenceClaimIds = cases.map(({ case_id: caseId }) => `claim-exists-${caseId}`)
    .sort(compareCodeUnits);
  return {
    schema_version: GRAPH_VERSION,
    claims: propositions.map(({ proposition_id: propositionId }) =>
      evidenceClaim(propositionId)).sort(orderById("claim_id")),
    collections: existenceClaimIds.length === 0 ? [] : [{
      collection_id: "set-derived-occurrence-existence",
      collection_kind: "closed_set",
      purpose: "derived_occurrence_existence",
      member_claim_ids: existenceClaimIds
    }],
    propositions,
    references,
    relations: cases.map(({ case_id: caseId }) => ({
      relation_id: `rel-observes-${caseId}`,
      role: "derives_from",
      source_claim_id: `claim-observed-in-${caseId}`,
      target_claim_id: `claim-exists-${caseId}`
    })).sort(orderById("relation_id"))
  };
}

const INTEGRATION_PREFIX_TRANSFORMER = Object.freeze({
  transformer_id: TRANSFORMER_ID,
  source_count: 3,
  parse_sources: parseIntegrationPrefixSources,
  transform: integrationPrefixCensus,
  validate_result: validateIntegrationPrefixResult,
  projections: Object.freeze({
    cases: Object.freeze({
      cardinality: "set",
      project: (value) => value.cases.map(({ case_id: id }) => `ref-${id}`)
    }),
    prefixes: Object.freeze({
      cardinality: "set",
      project: (value) => value.prefixes.map(({ prefix_id: id }) => `ref-${id}`)
    })
  }),
  graph_projections: Object.freeze({
    "case-association": Object.freeze({
      project: integrationPrefixCaseAssociationSubgraph
    }),
    "case-membership": Object.freeze({
      project: integrationPrefixCaseMembershipSubgraph
    })
  })
});

const LEXICOGRAPHIC_TRANSFORMER = Object.freeze({
  transformer_id: LEXICOGRAPHIC_TRANSFORMER_ID,
  source_count: 4,
  parse_sources: (sourceBytes) => sourceBytes.map((bytes, index) =>
    parseCanonicalDocument(bytes, `source[${index}]`)),
  transform: deterministicLexicographicConformance,
  validate_result: assertLexicographicConformanceResult,
  projections: Object.freeze({
    "declared-items": Object.freeze({
      cardinality: "set",
      project: (value) => projectLexicographicPopulation(value, "declared-items")
    }),
    "policy-keys": Object.freeze({
      cardinality: "set",
      project: (value) => projectLexicographicPopulation(value, "policy-keys")
    }),
    "result-items": Object.freeze({
      cardinality: "set",
      project: (value) => projectLexicographicPopulation(value, "result-items")
    })
  })
});

const registry = Object.freeze(Object.fromEntries([
  AUTHENTICATION_PROVENANCE_OCCURRENCE_TRANSFORMER,
  CALLER_INPUT_AUTHORITY_CONFINEMENT_TRANSFORMER,
  DECLARED_BOUNDARY_RECORD_CONSISTENCY_TRANSFORMER,
  DECLARED_LIMIT_GUIDANCE_PROPAGATION_TRANSFORMER,
  INTEGRATION_PREFIX_TRANSFORMER,
  LEXICOGRAPHIC_TRANSFORMER,
  MUTATION_PAGINATION_TRACE_TRANSFORMER,
  SOUND_NEGATIVE_OBSERVATION_TRANSFORMER,
  SUPPLEMENTARY_ISOLATION_ATTEMPT_TRANSFORMER
].map((transformer) => [transformer.transformer_id, transformer])));

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
  if (!Object.hasOwn(transformer.projections, populationId)) return [{
    code: "projection_population_unknown",
    message: "the deterministic projection population is not package-owned",
    population_id: populationId
  }];
  return [];
}

function validateDeterministicProjectionGraph(transformerId, graphProjectionId) {
  const transformer = registry[transformerId];
  if (!transformer) return [{
    code: "projection_transformer_unknown",
    message: "the deterministic projection transformer is not package-owned"
  }];
  if (!Object.hasOwn(transformer.graph_projections ?? {}, graphProjectionId)) return [{
    code: "projection_graph_unknown",
    message: "the deterministic projected contract graph is not package-owned",
    graph_projection_id: graphProjectionId
  }];
  return [];
}

function validateDeterministicProjectionReference(transformerId, projectionId) {
  const transformer = registry[transformerId];
  if (!transformer) return [{
    code: "projection_transformer_unknown",
    message: "the deterministic projection transformer is not package-owned"
  }];
  const projection = transformer.projections[projectionId];
  if (!projection || projection.cardinality !== "singleton_reference") return [{
    code: "projection_reference_unknown",
    message: "the deterministic projection singleton reference is not package-owned",
    projection_id: projectionId
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
  const values = transformer.parse_sources(sourceBytes);
  if (!Array.isArray(values) || values.length !== transformer.source_count) fail(
    "projection_source_parser_invalid",
    "the package-owned deterministic transformer returned an invalid source tuple"
  );
  return runTransformerTwice(transformer.transform, values, sourceBytes.map(sha256));
}

function executeUncappedIntegrationPrefixProjection(sourceBytes) {
  const transformer = INTEGRATION_PREFIX_TRANSFORMER;
  if (!Array.isArray(sourceBytes) || sourceBytes.length !== transformer.source_count ||
      sourceBytes.some((bytes) => !Buffer.isBuffer(bytes))) fail(
    "projection_source_set_incomplete",
    "the uncapped integration-prefix runner requires every captured source byte sequence"
  );
  const values = transformer.parse_sources(sourceBytes);
  return runTransformerTwice(
    (captured, digests) => integrationPrefixCensus(captured, digests, { uncapped: true }),
    values,
    sourceBytes.map(sha256)
  );
}

function assertCanonicalProjectionResult(transformerId, bytes) {
  const transformer = registry[transformerId];
  if (!transformer) fail(
    "projection_transformer_unknown", "the deterministic projection transformer is not package-owned"
  );
  const value = parseCanonicalDocument(bytes, "projection result");
  return deepFreeze(transformer.validate_result(value));
}

function prepareDeterministicProjection(transformerId, resultBytes) {
  const transformer = registry[transformerId];
  const value = assertCanonicalProjectionResult(transformerId, resultBytes);
  return Object.freeze({
    population(populationId) {
      if (!Object.hasOwn(transformer.projections, populationId)) fail(
        "projection_population_unknown",
        "the deterministic projection population is not package-owned",
        { transformer_id: transformerId, population_id: populationId }
      );
      const projection = transformer.projections[populationId];
      const referenceIds = projection.project(value);
      if (!Array.isArray(referenceIds) || referenceIds.some((referenceId) =>
        typeof referenceId !== "string" || referenceId.length === 0 ||
          referenceId !== referenceId.normalize("NFC")) || !sortedUnique(referenceIds)) fail(
        "projection_population_noncanonical",
        "the deterministic projection population must be sorted and unique",
        { transformer_id: transformerId, population_id: populationId }
      );
      if (projection.cardinality === "singleton" && referenceIds.length !== 1) fail(
        "projection_singleton_cardinality_invalid",
        "the registered singleton projection must resolve to exactly one reference",
        { transformer_id: transformerId, population_id: populationId }
      );
      return [...referenceIds];
    },
    reference(projectionId) {
      const projection = transformer.projections[projectionId];
      if (!projection || projection.cardinality !== "singleton_reference") fail(
        "projection_reference_unknown",
        "the deterministic projection singleton reference is not package-owned",
        { transformer_id: transformerId, projection_id: projectionId }
      );
      const projected = projection.project(value);
      if (!projected || typeof projected !== "object" || Array.isArray(projected) ||
          Object.keys(projected).sort(compareCodeUnits).join("\0") !==
            "grounded_identity_sha256\0reference_id\0type_term" ||
          typeof projected.reference_id !== "string" || projected.reference_id.length === 0 ||
          projected.reference_id !== projected.reference_id.normalize("NFC") ||
          !/^[0-9a-f]{64}$/u.test(projected.grounded_identity_sha256 ?? "") ||
          typeof projected.type_term !== "string" || projected.type_term.length === 0) fail(
        "projection_reference_noncanonical",
        "the deterministic singleton reference projection is invalid",
        { transformer_id: transformerId, projection_id: projectionId }
      );
      return deepFreeze(structuredClone(projected));
    },
    graph(graphProjectionId) {
      const projection = transformer.graph_projections?.[graphProjectionId];
      if (!projection) fail(
        "projection_graph_unknown",
        "the deterministic projected contract graph is not package-owned",
        { transformer_id: transformerId, graph_projection_id: graphProjectionId }
      );
      const first = canonicalJsonBytes(projection.project(value), { file: true });
      const second = canonicalJsonBytes(projection.project(value), { file: true });
      if (!first.equals(second)) fail(
        "projection_graph_nondeterministic",
        "the package-owned projected contract graph was not byte deterministic",
        { transformer_id: transformerId, graph_projection_id: graphProjectionId }
      );
      return assertProjectedContractGraph(
        JSON.parse(first.toString("utf8"))
      );
    }
  });
}

function projectDeterministicPopulation(transformerId, resultBytes, populationId) {
  return prepareDeterministicProjection(transformerId, resultBytes).population(populationId);
}

function projectDeterministicReference(transformerId, resultBytes, projectionId) {
  return prepareDeterministicProjection(transformerId, resultBytes).reference(projectionId);
}

export {
  assertCanonicalProjectionResult,
  executeDeterministicProjection,
  executeUncappedIntegrationPrefixProjection,
  prepareDeterministicProjection,
  projectDeterministicPopulation,
  projectDeterministicReference,
  runTransformerTwice,
  validateDeterministicProjectionGraph,
  validateDeterministicProjectionPopulation,
  validateDeterministicProjectionReference,
  validateDeterministicProjectionRelation
};
