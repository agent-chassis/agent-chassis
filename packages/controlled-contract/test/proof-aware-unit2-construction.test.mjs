import assert from "node:assert/strict";
import { after, test } from "node:test";

import {
  canonicalJsonBytes
} from "../lib/proof-aware-digest.mjs";
import {
  anonymizeResolvedCarrier
} from "../lib/proof-aware-anonymization.mjs";
import {
  EDGE_KINDS,
  INCIDENCE_KINDS,
  NODE_KINDS,
  ROLE_MATRIX,
  validateResolvedCarrier
} from "../lib/proof-aware-planning-carrier.mjs";
import {
  IMPLEMENTATION_IDENTITY,
  PLANNING_POLICY_IDENTITY,
  RULES,
  validateStateEffectTuple
} from "../lib/proof-aware-planning-policy.mjs";
import {
  constructProofAwarePlanningCarrier
} from "../lib/proof-aware-unit2-construction.mjs";
import {
  createProofAwareUnit2Fixture
} from "./support/proof-aware-unit2-fixture.mjs";
import {
  createSubject as createAssociationSubject
} from "./support/projected-evaluation-association-fixture.mjs";

const expectedNodeKinds = ["authored_behavior_component", "obligation", "falsifier",
  "profile_pattern", "logic_gate", "relation_instance", "collection_instance",
  "population", "iterated_occurrence", "proof_pack", "assessment_state",
  "exact_binding_requirement", "capture_source_set", "deterministic_transform",
  "projected_selection", "planning_boundary", "resource"];
const expectedEdgeKinds = ["depends_on", "precedes", "verified_by", "falsified_by",
  "satisfies_pattern", "bound_to_projected_node", "captured_with", "derived_by",
  "shares_resource", "must_preserve_identity", "must_co_locate", "may_separate",
  "must_not_infer_join", "alternative_to", "outside_guarantee"];
const expectedIncidenceKinds = ["proposition_structure", "applicability_scope",
  "relation_endpoints", "collection_membership", "logic_gate_branches",
  "iteration_association", "falsifier_occurrence", "exact_binding_source_result",
  "projected_selection_ownership", "resource_participation",
  "occurrence_participation", "non_join_boundary"];

const fixture = await createProofAwareUnit2Fixture();
after(async () => fixture.cleanup());
const associationFixture = await createProofAwareUnit2Fixture({
  subjectFactory: createAssociationSubject
});
after(async () => associationFixture.cleanup());

function cloneInput() {
  return structuredClone(fixture.input);
}

function assertClosedFailure(result, status = null) {
  if (status !== null) assert.equal(result.status, status);
  assert.notEqual(result.status, "success");
  assert.equal(result.failure.partial_result_released, false);
  for (const forbidden of ["resolved_carrier", "anonymous_carrier", "orbit_input",
    "carrier_digest", "partition", "weights", "comparison"]) {
    assert.equal(forbidden in result, false, `${result.status}:${forbidden}`);
  }
  assert.deepEqual(Object.values(result.authority.mandatory_exclusions),
    Array(10).fill(false));
}

function assertTopologyChangedOrRejected(carrier, baselineDigest, mutate, label) {
  const attacked = structuredClone(carrier);
  mutate(attacked);
  const validation = validateResolvedCarrier(attacked);
  if (!validation.valid) {
    assert.ok(validation.diagnostics.length > 0, `${label}:diagnostic`);
    return;
  }
  assert.notEqual(anonymizeResolvedCarrier(attacked).anonymous_carrier
    .candidate_digest, baselineDigest, label);
}

test("Unit 2 validates the exact Unit 1 cycle and constructs one closed success", () => {
  const before = canonicalJsonBytes(fixture.input);
  const result = constructProofAwarePlanningCarrier(fixture.input);
  assert.equal(result.status, "success", JSON.stringify(result.failure));
  assert.equal(validateResolvedCarrier(result.resolved_carrier).valid, true);
  assert.equal(result.input_binding.validated_unit1_cycle_digest,
    fixture.input.unit1.root_cycle.proof_aware_input_cycle_digest);
  assert.equal(result.input_binding.planning_policy_digest,
    PLANNING_POLICY_IDENTITY.digest);
  assert.equal(result.input_binding.planning_implementation_digest,
    IMPLEMENTATION_IDENTITY.digest);
  assert.deepEqual(canonicalJsonBytes(fixture.input), before,
    "construction must not mutate Unit 1 values");
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.resolved_carrier.nodes), true);
  for (const artifact of [result, result.resolved_carrier,
    result.anonymous_carrier, result.orbit_input]) {
    assert.deepEqual(Object.values(artifact.authority.mandatory_exclusions),
      Array(10).fill(false));
  }
  const unknownTypedField = structuredClone(result.resolved_carrier);
  unknownTypedField.typed_incidences[0].typed_attributes.chunk = 0;
  assert.equal(validateResolvedCarrier(unknownTypedField).valid, false);
  const impossibleNullableAttribute = structuredClone(result.resolved_carrier);
  impossibleNullableAttribute.typed_incidences[0].participants[0]
    .attributes.access_mode = "read";
  assert.equal(validateResolvedCarrier(impossibleNullableAttribute).valid, false);
  const wrongIncidenceMeaning = structuredClone(result.resolved_carrier);
  const resourceIncidence = wrongIncidenceMeaning.typed_incidences.find(
    ({ incidence_kind: kind }) => kind === "resource_participation"
  );
  resourceIncidence.derivation.rule_id = "proof_pattern_overlay";
  resourceIncidence.derivation.source_class = "profile_pattern";
  resourceIncidence.effect = "overlay_only";
  resourceIncidence.facet = "proof_atomicity";
  assert.equal(validateResolvedCarrier(wrongIncidenceMeaning).valid, false);
  const wrongEdgeMeaning = structuredClone(result.resolved_carrier);
  const captureEdge = wrongEdgeMeaning.binary_edges.find(
    ({ edge_kind: kind }) => kind === "captured_with"
  );
  captureEdge.edge_kind = "depends_on";
  assert.equal(validateResolvedCarrier(wrongEdgeMeaning).valid, false);
});

test("closed node, edge, incidence, and participant-role censuses match the design", () => {
  assert.deepEqual(NODE_KINDS, expectedNodeKinds);
  assert.deepEqual(EDGE_KINDS, expectedEdgeKinds);
  assert.deepEqual(INCIDENCE_KINDS, expectedIncidenceKinds);
  assert.deepEqual(Object.keys(ROLE_MATRIX), expectedIncidenceKinds);
  const expectedRoles = {
    proposition_structure: ["operand", "proposition", "subject"],
    applicability_scope: ["applicability_operand", "applicability_owner"],
    relation_endpoints: ["endpoint", "relation"],
    collection_membership: ["collection", "member"],
    logic_gate_branches: ["branch_member", "branch_scope", "logic_gate"],
    iteration_association: ["association", "association_associated_role",
      "association_member_role", "iteration_member", "iteration_member_role",
      "pattern", "population"],
    falsifier_occurrence: ["falsifier", "occurrence_participant", "target", "verification"],
    exact_binding_source_result: ["captured_source", "result_projection",
      "result_requirement", "source_requirement", "source_set", "transform"],
    projected_selection_ownership: ["pack_scope", "pattern", "projected_graph",
      "selected_node", "selection"],
    resource_participation: ["resource", "resource_participant"],
    occurrence_participation: ["occurrence", "occurrence_participant"],
    non_join_boundary: ["boundary", "left_side", "right_side"]
  };
  for (const [kind, roles] of Object.entries(expectedRoles)) {
    assert.deepEqual(Object.keys(ROLE_MATRIX[kind]).sort(), roles);
  }
});

test("Unit 2 retains exact-source multiplicity and every evidence ownership incidence", () => {
  const result = constructProofAwarePlanningCarrier(fixture.input);
  assert.equal(result.status, "success", JSON.stringify(result.failure));
  const carrier = result.resolved_carrier;
  const nodes = new Map(carrier.nodes.map((node) => [node.node_id, node]));
  const exact = carrier.typed_incidences.find(({ incidence_kind: kind }) =>
    kind === "exact_binding_source_result");
  const bindings = fixture.input.authoritative_values.packs[0]
    .exact_binding_result.bindings;
  const requirements = exact.participants.filter(({ role }) =>
    role === "source_requirement");
  const sources = exact.participants.filter(({ role }) => role === "captured_source");
  assert.equal(requirements.length, bindings.length);
  assert.equal(sources.length, bindings.length);
  assert.deepEqual(requirements.map(({ position_path: path }) => path[0]),
    bindings.map((_, position) => position));
  assert.deepEqual(sources.map(({ position_path: path }) => path[0]),
    bindings.map((_, position) => position));
  assert.deepEqual(requirements.map(({ node_id: id }) =>
    nodes.get(id).provenance.source_digest), bindings.map(
    ({ source_descriptor_sha256: digest }) => digest));
  assert.deepEqual(sources.map(({ node_id: id }) =>
    nodes.get(id).provenance.source_digest), bindings.map(
    ({ content_sha256: digest }) => digest));
  assert.equal(new Set(sources.map(({ node_id: id }) => id)).size, bindings.length);

  const collapsedIdentity = structuredClone(carrier);
  const collapsedSources = collapsedIdentity.typed_incidences.find(
    ({ incidence_kind: kind }) => kind === "exact_binding_source_result"
  ).participants.filter(({ role }) => role === "captured_source");
  collapsedSources[1].node_id = collapsedSources[0].node_id;
  assert.equal(validateResolvedCarrier(collapsedIdentity).valid, false);
  const changedMultiplicity = structuredClone(carrier);
  changedMultiplicity.typed_incidences.find(({ incidence_kind: kind }) =>
    kind === "exact_binding_source_result").participants.find(({ role }) =>
    role === "captured_source").multiplicity = 2;
  assert.equal(validateResolvedCarrier(changedMultiplicity).valid, false);
  const changedRole = structuredClone(carrier);
  changedRole.typed_incidences.find(({ incidence_kind: kind }) =>
    kind === "exact_binding_source_result").participants.find(({ role }) =>
    role === "captured_source").role = "source_requirement";
  assert.equal(validateResolvedCarrier(changedRole).valid, false);

  const ownership = fixture.supplement.projected_graph.incidences.filter(
    ({ incidence_kind: kind, claim_kind: claimKind }) =>
      kind === "claim_proposition_ownership" && claimKind === "evidence"
  );
  for (const incidence of ownership) assert.ok(carrier.binary_edges.some((edge) =>
    edge.edge_kind === "verified_by" &&
    edge.source_node_id === `pack:0:projected:${
      incidence.proposition_projected_node_id}` &&
    edge.target_node_id === `pack:0:projected:${incidence.claim_projected_node_id}`
  ), incidence.claim_projected_node_id);
  assertTopologyChangedOrRejected(carrier, result.anonymous_carrier.candidate_digest,
    (attacked) => {
      const ownershipIndex = attacked.binary_edges.findIndex(({ edge_kind: kind }) =>
        kind === "verified_by");
      attacked.binary_edges.splice(ownershipIndex, 1);
    }, "claim-to-proposition ownership");
});

test("Unit 2 retains association roles, positions, cardinality, status, and role equality", () => {
  const result = constructProofAwarePlanningCarrier(associationFixture.input);
  assert.equal(result.status, "success", JSON.stringify(result.failure));
  const carrier = result.resolved_carrier;
  for (const iteration of associationFixture.supplement.universal_iterations) {
    const incidence = carrier.typed_incidences.find(({ incidence_kind: kind,
      participants }) => kind === "iteration_association" && participants.some(
      ({ role, node_id: id }) => role === "pattern" &&
        id === `pack:0:pattern:${iteration.pattern_instance_id}`));
    assert.ok(incidence, iteration.pattern_instance_id);
    const sourceAssociations = associationFixture.supplement.association_selections
      .filter(({ universal_iteration_position: position }) =>
        position === iteration.iteration_position);
    const expectedAssociations = sourceAssociations.flatMap((association) =>
      association.associated_nodes.map((node) => ({
        coordinates: [association.member_occurrence_position,
          association.association_position, node.associated_node_position],
        member_role: association.member_position,
        associated_role: association.associated_position,
        cardinality: association.cardinality,
        association_status: association.association_status
      })));
    const observedAssociations = incidence.participants.filter(({ role }) =>
      role === "association").map(({ position_path: path, attributes }) => ({
      coordinates: path.slice(1), member_role: attributes.member_role,
      associated_role: attributes.associated_role,
      cardinality: attributes.cardinality,
      association_status: attributes.association_status
    }));
    assert.deepEqual(observedAssociations, expectedAssociations);

    const memberRoles = incidence.participants.filter(({ role }) =>
      role === "association_member_role");
    const associatedRoles = incidence.participants.filter(({ role }) =>
      role === "association_associated_role");
    assert.equal(memberRoles.length, sourceAssociations.length);
    assert.equal(associatedRoles.length, sourceAssociations.length);
    for (let left = 0; left < sourceAssociations.length; left += 1) for (
      let right = 0; right < sourceAssociations.length; right += 1
    ) {
      assert.equal(memberRoles[left].node_id === memberRoles[right].node_id,
        sourceAssociations[left].member_role === sourceAssociations[right].member_role);
      assert.equal(associatedRoles[left].node_id === associatedRoles[right].node_id,
        sourceAssociations[left].associated_role ===
          sourceAssociations[right].associated_role);
    }
  }

  const baseline = result.anonymous_carrier.candidate_digest;
  const mutations = [
    ["association status", (incidence) => {
      const participant = incidence.participants.find(({ role }) =>
        role === "association");
      participant.attributes.association_status =
        participant.attributes.association_status === "satisfied" ?
          "indeterminate" : "satisfied";
    }],
    ["association cardinality", (incidence) => {
      const participant = incidence.participants.find(({ role }) =>
        role === "association");
      participant.attributes.cardinality =
        participant.attributes.cardinality === "one" ? "optional" : "one";
    }],
    ["associated position", (incidence) => {
      const participants = incidence.participants.filter(({ role }) =>
        role === "association");
      participants[0].position_path[3] += 1;
    }],
    ["association role identity", (incidence) => {
      const memberRole = incidence.participants.find(({ role }) =>
        role === "association_member_role");
      const associatedRole = incidence.participants.find(({ role }) =>
        role === "association_associated_role");
      memberRole.node_id = associatedRole.node_id;
    }]
  ];
  for (const [label, mutate] of mutations) {
    assertTopologyChangedOrRejected(carrier, baseline, (attacked) => mutate(
      attacked.typed_incidences.find(({ incidence_kind: kind, participants }) =>
        kind === "iteration_association" && participants.some(({ role }) =>
          role === "association"))), label);
  }
});

test("assessment artifact roles come from digest-checked bytes rather than caller labels", () => {
  const attacks = [
    ["aggregate substitution", "PA_ASSESSMENT_AGGREGATE_MISMATCH", (value) => {
      value.authoritative_values.proof_packs_assessment = { fabricated: true };
    }],
    ["structural relabel", "PA_ASSESSMENT_ARTIFACT_ROLE_MISMATCH", (value) => {
      value.authoritative_values.assessment_files.find(({ artifact_kind: kind }) =>
        kind === "structural_assessment").artifact_kind =
          "admitted_profile_assessment";
    }],
    ["proof-pack omission", "PA_ASSESSMENT_AGGREGATE_MISMATCH", (value) => {
      delete value.authoritative_values.proof_packs_assessment.proof_pack_admission;
    }],
    ["conflicting label", "PA_ASSESSMENT_ARTIFACT_ROLE_MISMATCH", (value) => {
      value.authoritative_values.assessment_files.find(({ artifact_kind: kind }) =>
        kind === "informational_rendering").artifact_kind = "assessment_index";
    }],
    ["value/bytes disagreement", "PA_ASSESSMENT_AGGREGATE_MISMATCH", (value) => {
      value.authoritative_values.admitted_profile_assessment =
        structuredClone(value.authoritative_values.proof_pack_admission);
    }]
  ];
  for (const [label, code, attack] of attacks) {
    const input = cloneInput();
    attack(input);
    const result = constructProofAwarePlanningCarrier(input);
    assertClosedFailure(result, "refused");
    assert.equal(result.failure.code, code, label);
  }
});

test("the live nested policy table is recursively immutable", () => {
  const identityBefore = PLANNING_POLICY_IDENTITY.digest;
  const rule = RULES.proven_capture_atomicity;
  for (const nested of [rule, rule.source_classes, rule.states, rule.effects,
    rule.facets]) assert.equal(Object.isFrozen(nested), true);
  assert.throws(() => rule.states.push("not_proven"), TypeError);
  assert.throws(() => { rule.states = ["not_proven"]; }, TypeError);
  assert.throws(() => { rule.states[0] = "not_proven"; }, TypeError);
  assert.throws(() => { rule.effects[0] = "merge_signal"; }, TypeError);
  assert.equal(validateStateEffectTuple({ rule_id: "proven_capture_atomicity",
    source_class: "same_cycle_exact_binding", state: "not_proven",
    effect: "capture_atomicity", facet: "exact_capture_atomicity" }), false);
  assert.equal(PLANNING_POLICY_IDENTITY.digest, identityBefore);
});

test("every package policy tuple is accepted and cross-combinations fail", () => {
  for (const [ruleId, rule] of Object.entries(RULES)) {
    for (const state of rule.states) for (const effect of rule.effects) {
      for (const facet of rule.facets) assert.equal(validateStateEffectTuple({
        rule_id: ruleId, source_class: rule.source_classes[0], state, effect, facet
      }), true, `${ruleId}:${state}:${effect}:${facet}`);
    }
  }
  for (const state of ["not_proven", "not_assessed", "not_applicable", "ambiguous",
    "residue", "missing", "invalid"]) {
    for (const effect of ["separation_signal", "hard_contraction",
      "behavior_cohesion", "merge_signal"]) assert.equal(validateStateEffectTuple({
      rule_id: "unresolved_diagnostic", source_class: "unresolved_assessment",
      state, effect, facet: "authority_boundary"
    }), false, `${state}:${effect}`);
  }
  assert.equal(validateStateEffectTuple({ rule_id: "exclusion_diagnostic",
    source_class: "pack_exclusion", state: "excluded",
    effect: "proof_atomicity", facet: "proof_atomicity" }), false,
  "an exclusion cannot become a guarantee");
  assert.equal(validateStateEffectTuple({ rule_id: "verification_overlay",
    source_class: "verification_relation", state: "satisfied",
    effect: "behavior_cohesion", facet: "behavior_cohesion" }), false);
  assert.equal(validateStateEffectTuple({ rule_id: "proven_capture_atomicity",
    source_class: "same_cycle_exact_binding", state: "proven",
    effect: "hard_contraction", facet: "exact_capture_atomicity",
    source_pack_instance_id: "pack-a", target_pack_instance_id: "pack-b" }), false);
  assert.equal(validateStateEffectTuple({ rule_id: "inclusive_alternative_overlay",
    source_class: "inclusive_logic_gate_branch", state: "satisfied",
    effect: "separation_signal", facet: "proof_atomicity" }), false,
  "any_of is never exclusive");
  assert.equal(validateStateEffectTuple({ rule_id: "declared_alternative",
    source_class: "exclusive_logic_gate_branch", state: "satisfied",
    effect: "overlay_only", facet: "proof_atomicity" }), false,
  "exactly_one is never inclusive");
  assert.equal(validateStateEffectTuple({ rule_id: "proof_pattern_overlay",
    source_class: "profile_pattern", state: "satisfied",
    effect: "overlay_only", facet: "proof_atomicity" }), true,
  "all_of remains a simultaneous overlay");
});

test("commitment, policy, implementation, supplement, and planning-cycle splices fail closed", () => {
  const attacks = [
    (value) => { value.authoritative_values.contract.claims[0].modality = "MAY"; },
    (value) => { value.planning_policy_identity.digest = "f".repeat(64); },
    (value) => { value.planning_implementation_identity.digest = "e".repeat(64); },
    (value) => { value.unit1.planning_pack_cycles[0].planning_pack_cycle_digest =
      "d".repeat(64); },
    (value) => { value.unit1.supplement_census.entries[0]
      .assessment_pack_cycle_digest = "c".repeat(64); },
    (value) => { value.authoritative_values.packs[0]
      .projected_selection_supplement.cycle_binding.assessment_pack_cycle_digest =
      "b".repeat(64); }
  ];
  for (const [index, attack] of attacks.entries()) {
    const input = cloneInput();
    attack(input);
    const result = constructProofAwarePlanningCarrier(input);
    assertClosedFailure(result);
    assert.match(result.failure.code, /^PA_/u, `attack ${index}`);
  }
});

test("missing, surplus, duplicate, and reordered manifest and census entries refuse", () => {
  const attacks = [
    (value) => { value.authoritative_values.assessment_files.pop(); },
    (value) => { value.authoritative_values.assessment_files.push(
      structuredClone(value.authoritative_values.assessment_files[0])); },
    (value) => { value.authoritative_values.assessment_files[1].ordinal = 0; },
    (value) => { value.unit1.supplement_census.entries[0].ordinal = 1; },
    (value) => { value.unit1.supplement_census.entry_count = 0; },
    (value) => { value.unit1.assessment_pack_cycles = []; }
  ];
  for (const attack of attacks) {
    const input = cloneInput();
    attack(input);
    assertClosedFailure(constructProofAwarePlanningCarrier(input), "refused");
  }
});

test("failure supplements and v0.1 input return typed failures without topology", () => {
  const missing = cloneInput();
  missing.unit1.supplement_census.entries[0].result = {
    status: "missing_lossless_fact"
  };
  assertClosedFailure(constructProofAwarePlanningCarrier(missing));
  const legacy = { input_version:
    "controlled-contract-anonymous-planning-input.experimental.v0.1" };
  const unsupported = constructProofAwarePlanningCarrier(legacy);
  assertClosedFailure(unsupported, "unsupported_input");
  assert.equal(unsupported.failure.code, "PA_V01_NOT_PROOF_AWARE");
});

test("bounded injected limits enforce each Unit 2 construction count point", () => {
  const baseline = constructProofAwarePlanningCarrier(fixture.input);
  assert.equal(baseline.status, "success");
  const measured = {
    resolved_nodes: baseline.resource_accounting.node_count,
    binary_edges: baseline.resource_accounting.binary_edge_count,
    incidence_participants:
      baseline.resource_accounting.typed_incidence_participant_count,
    universal_occurrences: baseline.resource_accounting.universal_occurrence_count
  };
  for (const [unit, count] of Object.entries(measured)) {
    if (count > 1) {
      const refused = constructProofAwarePlanningCarrier(fixture.input, {
        limits: { [unit]: count - 1 }
      });
      assertClosedFailure(refused, "resource_limit");
      assert.equal(refused.failure.measured, count);
      assert.equal(refused.failure.limit, count - 1);
    }
    assert.equal(constructProofAwarePlanningCarrier(fixture.input, {
      limits: { [unit]: Math.max(1, count) }
    }).status, "success", unit);
    assert.equal(constructProofAwarePlanningCarrier(fixture.input, {
      limits: { [unit]: Math.max(1, count + 1) }
    }).status, "success", `${unit}:N+1 limit`);
  }
  const inputBytes = baseline.resource_accounting.verified_input_bytes;
  assertClosedFailure(constructProofAwarePlanningCarrier(fixture.input, {
    limits: { verified_input_bytes: inputBytes - 1 }
  }), "resource_limit");
  assert.equal(constructProofAwarePlanningCarrier(fixture.input, {
    limits: { verified_input_bytes: inputBytes }
  }).status, "success");
  assert.equal(constructProofAwarePlanningCarrier(fixture.input, {
    limits: { verified_input_bytes: inputBytes + 1 }
  }).status, "success");

  const outputBytes = baseline.resource_accounting.successful_output_bytes;
  assertClosedFailure(constructProofAwarePlanningCarrier(fixture.input, {
    limits: { successful_output_bytes: outputBytes - 1 }
  }), "resource_limit");
  assert.equal(constructProofAwarePlanningCarrier(fixture.input, {
    limits: { successful_output_bytes: outputBytes }
  }).status, "success");
  assert.equal(constructProofAwarePlanningCarrier(fixture.input, {
    limits: { successful_output_bytes: outputBytes + 1 }
  }).status, "success");
  assert.equal(constructProofAwarePlanningCarrier(fixture.input, {
    limits: { selected_packs: 1 }
  }).status, "success");
});
