import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { after, test } from "node:test";

import {
  anonymizeResolvedCarrier
} from "../lib/proof-aware-anonymization.mjs";
import {
  constructProofAwarePlanningCarrier
} from "../lib/proof-aware-unit2-construction.mjs";
import {
  createProofAwareUnit2Fixture
} from "./support/proof-aware-unit2-fixture.mjs";

const fixture = await createProofAwareUnit2Fixture();
after(async () => fixture.cleanup());
const success = constructProofAwarePlanningCarrier(fixture.input);
assert.equal(success.status, "success", JSON.stringify(success.failure));

function renamedCarrier(carrier) {
  const value = structuredClone(carrier);
  const ids = new Map(value.nodes.map((node, index) =>
    [node.node_id, `renamed-λ-${value.nodes.length - index}-${"x".repeat(40)}`]));
  const incidenceIds = new Map(value.typed_incidences.map((incidence, index) =>
    [incidence.incidence_id, `inc-renamed-${index}`]));
  for (const node of value.nodes) {
    node.node_id = ids.get(node.node_id);
    node.pack_instance_id = node.pack_instance_id === null ? null : "renamed-pack-漢字";
    node.branch_scope_id = node.branch_scope_id === null ? null :
      ids.get(node.branch_scope_id);
    node.provenance.source_digest = "a".repeat(64);
  }
  for (const edge of value.binary_edges) {
    edge.edge_id = `renamed-${edge.edge_id}`;
    edge.source_node_id = ids.get(edge.source_node_id);
    edge.target_node_id = ids.get(edge.target_node_id);
    edge.derivation.source_digest = "b".repeat(64);
  }
  for (const incidence of value.typed_incidences) {
    incidence.incidence_id = incidenceIds.get(incidence.incidence_id);
    incidence.pack_instance_id = incidence.pack_instance_id === null ? null :
      "renamed-pack-漢字";
    incidence.branch_scope_id = incidence.branch_scope_id === null ? null :
      ids.get(incidence.branch_scope_id);
    incidence.derivation.source_digest = "c".repeat(64);
    for (const participant of incidence.participants) {
      participant.node_id = ids.get(participant.node_id);
    }
  }
  for (const constraint of value.constraints) {
    constraint.constraint_id = `renamed-${constraint.constraint_id}`;
    constraint.incidence_ids = constraint.incidence_ids.map((id) =>
      incidenceIds.get(id));
    constraint.derivation.source_digest = "d".repeat(64);
  }
  for (const fact of value.unresolved_facts) {
    fact.fact_id = `renamed-${fact.fact_id}`;
    fact.source_digest = "e".repeat(64);
    fact.subject_node_ids = fact.subject_node_ids.map((id) => ids.get(id));
  }
  value.nodes.reverse();
  value.binary_edges.reverse();
  value.typed_incidences.reverse();
  value.constraints.reverse();
  return value;
}

test("identifier, pack name, provenance, declaration, and property variation is erased", () => {
  const original = anonymizeResolvedCarrier(success.resolved_carrier);
  const renamed = anonymizeResolvedCarrier(renamedCarrier(success.resolved_carrier));
  assert.deepEqual(renamed, original);
  assert.equal(original.orbit_input.lexical_source_ids_used, false);
  assert.equal(original.orbit_input.partition_selected, false);
  assert.ok(original.orbit_input.color_classes.some(
    ({ unresolved_symmetry: unresolved }) => unresolved
  ));
});

test("topology-bearing weight, role, position, state, effect, and multiplicity change output", () => {
  const baseline = anonymizeResolvedCarrier(success.resolved_carrier)
    .anonymous_carrier.candidate_digest;
  const mutations = [
    ["weight", (value) => { value.nodes[0].weight.serialization += 1; }],
    ["multiplicity", (value) => {
      value.typed_incidences[0].participants.at(-1).multiplicity += 1;
    }],
    ["resource participation role", (value) => {
      const incidence = value.typed_incidences.find(({ incidence_kind: kind }) =>
        kind === "resource_participation");
      const participant = incidence.participants.find(({ role }) =>
        role === "resource_participant");
      participant.attributes.participation_role = "capture_result";
    }],
    ["numeric position", (value) => {
      const incidence = value.typed_incidences.find(({ incidence_kind: kind,
        participants }) => kind === "proposition_structure" &&
        participants.some(({ role, node_id: nodeId }) => role === "operand" &&
          value.nodes.find(({ node_id: candidate }) => candidate === nodeId)
            .subtype === "evidence"));
      const subject = incidence.participants.find(({ role }) => role === "subject");
      const operand = incidence.participants.find(({ role }) => role === "operand");
      [subject.node_id, operand.node_id] = [operand.node_id, subject.node_id];
    }],
    ["effect", (value) => {
      const edge = value.binary_edges.find(({ derivation }) =>
        derivation.rule_id === "proven_proof_atomicity");
      edge.effect = "hard_contraction";
    }],
    ["state", (value) => {
      const edge = value.binary_edges.find(({ edge_kind: kind }) =>
        kind === "satisfies_pattern");
      edge.state = "satisfied";
      edge.derivation.state_precondition = "satisfied";
    }]
  ];
  for (const [label, mutate] of mutations) {
    const value = structuredClone(success.resolved_carrier);
    mutate(value);
    assert.notEqual(anonymizeResolvedCarrier(value).anonymous_carrier.candidate_digest,
      baseline, label);
  }
});

test("caller mutation and returned-result aliasing cannot alter anonymous handoff", () => {
  const input = structuredClone(success.resolved_carrier);
  const result = anonymizeResolvedCarrier(input);
  input.nodes[0].subtype = input.nodes[0].subtype;
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.anonymous_carrier.nodes), true);
  assert.throws(() => result.anonymous_carrier.nodes.push({}), TypeError);
});

test("process locale and timezone do not change the Unit 2 anonymous digest", () => {
  const runner = new URL("./support/proof-aware-unit2-determinism-runner.mjs",
    import.meta.url);
  const outputs = [{ TZ: "UTC", LANG: "C" },
    { TZ: "Pacific/Auckland", LANG: "tr_TR.UTF-8" }].map((environment) =>
    execFileSync(process.execPath, [runner.pathname], {
      cwd: new URL("../../..", import.meta.url).pathname,
      env: { ...process.env, ...environment }, encoding: "utf8"
    }));
  assert.equal(outputs[0], outputs[1]);
});
