import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  NATIVE_CONTRACT_SCHEMA,
  operatorsByValueKind
} from "../lib/native-contract-carrier.mjs";
import { NODE_KINDS } from "../lib/projected-contract-graph.mjs";
import { DOMAINS, LIMITS } from "../lib/projected-selection-supplement.mjs";
import {
  APPLICABILITY_MODES,
  OPERATORS,
  TYPE_TERMS
} from "../lib/vocabulary-v034.mjs";

const root = new URL("../../../", import.meta.url);
const census = JSON.parse(await readFile(new URL(
  "internal/controlled-contract/design/proof-aware-decomposition/" +
    "projected-selection-authoritative-census.v1.json",
  root
), "utf8"));
const schema = JSON.parse(await readFile(new URL(
  "../lib/projected-selection-supplement.experimental.v1.schema.json",
  import.meta.url
), "utf8"));

const sorted = (values) => [...values].sort();

test("authoritative census parity gate covers every projected vocabulary population", () => {
  assert.deepEqual(NODE_KINDS, census.projected_node_populations.map(
    ({ source_population: population }) => population
  ));
  assert.deepEqual(schema.$defs.node_kind.enum,
    census.projected_node_populations.map(
      ({ supplement_node_kind: kind }) => kind
    ));
  assert.ok(Object.values(operatorsByValueKind).flat().every((operator) =>
    census.proposition_operators.includes(operator)));
  assert.deepEqual(sorted(OPERATORS.map(({ term }) => term)),
    sorted(census.proposition_operators));
  assert.deepEqual(sorted(TYPE_TERMS.map(({ term }) => term)),
    sorted(census.reference_type_terms));
  assert.ok(APPLICABILITY_MODES.map(({ term }) => term).every((mode) =>
    census.applicability_modes.includes(mode)));
  assert.deepEqual(sorted(schema.$defs.applicability_incidence.properties
    .applicability_mode.enum), sorted(census.applicability_modes));
});

test("authoritative semantic payload enums equal package and supplement definitions", () => {
  const defs = schema.$defs;
  assert.deepEqual(defs.claim_kind.enum, [...census.claim_kinds, null]);
  assert.deepEqual(defs.reference_identity.oneOf.map(
    (entry) => entry.properties.kind.const
  ), census.reference_identity_kinds);
  assert.deepEqual(defs.claim_payload.properties.modality.enum,
    census.claim_modalities);
  assert.deepEqual(defs.claim_payload.properties.verification_method.enum,
    [...census.verification_methods, null]);
  assert.deepEqual(defs.relation_payload.properties.relation_role.enum,
    census.relation_roles);
  assert.deepEqual(defs.collection_payload.properties.collection_kind.enum,
    census.collection_kinds);
  assert.deepEqual(defs.proposition_operand.properties.operand_kind.enum,
    census.proposition_operand_kinds);
  assert.deepEqual(defs.applicability_incidence.properties.applicability_mode.enum,
    census.applicability_modes);
  assert.deepEqual(NATIVE_CONTRACT_SCHEMA.$defs.declarative_claim.properties.modality.enum,
    census.claim_modalities);
  assert.deepEqual(NATIVE_CONTRACT_SCHEMA.$defs.verification_claim.properties
    .verification_method.enum, census.verification_methods);
  assert.equal(defs.applicability_incidence.properties.applicability_mode.enum
    .includes("counterfactual"), true);
  assert.equal(defs.collection_payload.properties.purpose.$ref,
    "#/$defs/nullable_id");
});

test("authoritative incidence roles, positions, and multiplicities are explicit", () => {
  const expectedKinds = census.projected_incidence_kinds.map(({ kind }) => kind);
  const schemaKinds = [
    schema.$defs.proposition_incidence.properties.incidence_kind.const,
    schema.$defs.applicability_incidence.properties.incidence_kind.const,
    schema.$defs.claim_ownership_incidence.properties.incidence_kind.const,
    schema.$defs.relation_incidence.properties.incidence_kind.const,
    schema.$defs.collection_incidence.properties.incidence_kind.const
  ];
  assert.deepEqual(schemaKinds, expectedKinds);
  for (const field of [
    "subject_position", "operand_position", "applicability_position",
    "endpoint_position", "member_position"
  ]) assert.ok(JSON.stringify(schema).includes(`\"${field}\"`), field);
  for (const item of census.projected_incidence_kinds) {
    assert.ok(item.owner_kind);
    assert.ok(item.participants.length > 0);
    assert.ok(item.multiplicity.length > 0);
  }
});

test("universal trace, branch, status, and association census is closed", () => {
  const defs = schema.$defs;
  assert.deepEqual(defs.branch_position.properties.gate_operator.enum,
    census.branch_operators);
  assert.deepEqual(defs.pattern_selection.properties.pattern_kind.enum,
    census.projected_evaluation_pattern_kinds);
  assert.deepEqual(defs.pattern_selection.properties.evaluation_status.enum,
    census.pattern_evaluation_statuses);
  assert.deepEqual(defs.universal_iteration.properties.iteration_quantifier.enum,
    census.universal_iteration.quantifiers);
  assert.deepEqual(defs.universal_iteration.properties.empty_behavior.enum,
    census.universal_iteration.empty_behaviors);
  assert.deepEqual(defs.member_position.properties.position_kind.enum,
    census.universal_iteration.member_position_kinds);
  assert.deepEqual(defs.association_selection.properties.cardinality.enum,
    census.universal_iteration.association_cardinalities);
  assert.deepEqual(defs.association_selection.properties.association_status.enum,
    census.association_statuses);
});

test("every corrected canonical ceiling equals the independently frozen census", () => {
  for (const expected of census.canonical_count_points) assert.deepEqual(
    LIMITS[expected.unit],
    {
      limit: expected.limit,
      count_point: expected.count_point,
      blocked_stage: expected.blocked_stage
    }
  );
  assert.equal(Object.keys(LIMITS).length, census.canonical_count_points.length);
});

test("all independently frozen derived domains and closure modes have an implementation",
  () => {
    const implementedDomains = new Set(Object.values(DOMAINS));
    for (const { domain } of census.derived_digest_domains) {
      assert.equal(implementedDomains.has(domain), true, domain);
    }
    assert.deepEqual(schema.$defs.complete_population_binding.oneOf.map(
      (entry) => entry.properties.status.const
    ), census.complete_population_binding_sources);
  });
