import assert from "node:assert/strict";
import test from "node:test";

import {
  PROFILE_ID_V1,
  SCHEMA_VERSION_V1,
  TEST_PROOF_VERSION_V1,
  VOCABULARY_VERSION_V1,
  validateAndResolveNativeContractV1
} from "../../lib/native-contract-carrier-v1.mjs";

const unconditional = () => ({ mode: "unconditional", operand_reference_ids: [] });

function baseContract() {
  return {
    schema_version: SCHEMA_VERSION_V1,
    vocabulary_version: VOCABULARY_VERSION_V1,
    profile_id: PROFILE_ID_V1,
    test_proof_version: TEST_PROOF_VERSION_V1,
    references: [
      { reference_id: "ref-component", type_term: "cc:runtime_component",
        identity: { kind: "profile_term", term: "component" } },
      { reference_id: "ref-suite", type_term: "cc:test",
        identity: { kind: "profile_term", term: "suite" } }
    ],
    propositions: [{ proposition_id: "prop-component-exists",
      subject_reference_id: "ref-component", operator: "boolean:exists",
      applicability_context: unconditional(),
      operands: [{ kind: "boolean", value: true }] }],
    claims: [{ claim_id: "claim-component-exists", kind: "evidence", modality: "MUST",
      proposition_id: "prop-component-exists" }],
    relations: [],
    collections: [],
    residue: [],
    annotations: [],
    test_proofs: []
  };
}

function addReference(contract, id, type = "cc:state") {
  contract.references.push({ reference_id: id, type_term: type,
    identity: { kind: "profile_term", term: id } });
}

function addClaim(contract, {
  id, subject = "ref-component", operator, operands,
  modality = "MUST", kind = "evidence", applicability = unconditional()
}) {
  const propositionId = `prop-${id}`;
  contract.propositions.push({ proposition_id: propositionId,
    subject_reference_id: subject, operator, applicability_context: applicability, operands });
  contract.claims.push({ claim_id: `claim-${id}`, kind, modality,
    proposition_id: propositionId });
}

function contradictionReasons(contract) {
  return validateAndResolveNativeContractV1(contract).diagnostics
    .filter(({ code }) => code === "direct_proposition_contradiction")
    .map(({ reason }) => reason);
}

test("stable native semantics preserve complement, modality, boolean, and functional rules", () => {
  const cases = [
    ["controlled complement", "opposed_operator", (contract) => {
      addClaim(contract, { id: "equals", operator: "reference:equals",
        operands: [{ kind: "reference", reference_id: "ref-suite" }] });
      addClaim(contract, { id: "not-equals", operator: "reference:not_equals",
        operands: [{ kind: "reference", reference_id: "ref-suite" }] });
    }],
    ["opposed modalities", "opposed_modality", (contract) => {
      addClaim(contract, { id: "uses", operator: "reference:uses",
        operands: [{ kind: "reference", reference_id: "ref-suite" }] });
      addClaim(contract, { id: "does-not-use", operator: "reference:uses",
        operands: [{ kind: "reference", reference_id: "ref-suite" }],
        modality: "MUST_NOT" });
    }],
    ["boolean complement", "opposed_boolean_value", (contract) => {
      addClaim(contract, { id: "component-absent", operator: "boolean:exists",
        operands: [{ kind: "boolean", value: false }] });
    }],
    ["functional value", "conflicting_functional_value", (contract) => {
      addReference(contract, "ref-state-a");
      addReference(contract, "ref-state-b");
      addClaim(contract, { id: "state-a", operator: "reference:has_state",
        operands: [{ kind: "reference", reference_id: "ref-state-a" }] });
      addClaim(contract, { id: "state-b", operator: "reference:has_state",
        operands: [{ kind: "reference", reference_id: "ref-state-b" }] });
    }]
  ];
  for (const [label, reason, mutate] of cases) {
    const contract = baseContract();
    mutate(contract);
    assert.ok(contradictionReasons(contract).includes(reason), label);
  }
});

test("stable equality normalization exposes substitutions in forbidden relations", () => {
  const contract = baseContract();
  addReference(contract, "ref-effect", "cc:resource");
  addReference(contract, "ref-effect-alias", "cc:resource");
  addClaim(contract, { id: "effect-alias", subject: "ref-effect",
    operator: "reference:equals",
    operands: [{ kind: "reference", reference_id: "ref-effect-alias" }] });
  addClaim(contract, { id: "forbidden-write", operator: "reference:writes",
    operands: [{ kind: "reference", reference_id: "ref-effect" }],
    modality: "MUST_NOT" });
  addClaim(contract, { id: "alias-write", operator: "reference:writes",
    operands: [{ kind: "reference", reference_id: "ref-effect-alias" }] });
  assert.ok(contradictionReasons(contract).includes("opposed_modality"));
});

test("stable native semantics enforce symmetric, inverse, transitive, and irreflexive rules", () => {
  const symmetric = baseContract();
  addClaim(symmetric, { id: "equals-forward", operator: "reference:equals",
    operands: [{ kind: "reference", reference_id: "ref-suite" }] });
  addClaim(symmetric, { id: "not-equals-reverse", subject: "ref-suite",
    operator: "reference:not_equals",
    operands: [{ kind: "reference", reference_id: "ref-component" }] });
  assert.ok(contradictionReasons(symmetric).includes("opposed_operator"));

  const ordering = baseContract();
  addClaim(ordering, { id: "component-precedes-suite", operator: "reference:precedes",
    operands: [{ kind: "reference", reference_id: "ref-suite" }] });
  addClaim(ordering, { id: "component-follows-suite", operator: "reference:follows",
    operands: [{ kind: "reference", reference_id: "ref-suite" }] });
  assert.ok(contradictionReasons(ordering).includes("ordering_cycle"));

  const irreflexive = baseContract();
  addClaim(irreflexive, { id: "self-dependency", operator: "reference:depends_on",
    operands: [{ kind: "reference", reference_id: "ref-component" }] });
  assert.ok(validateAndResolveNativeContractV1(irreflexive).diagnostics.some(
    ({ code }) => code === "irreflexive_proposition"
  ));
});

test("stable native semantics enforce cross-operator and exact population relations", () => {
  const cardinality = baseContract();
  addReference(cardinality, "ref-population", "cc:population");
  addReference(cardinality, "ref-member-a", "cc:resource");
  addReference(cardinality, "ref-member-b", "cc:resource");
  addClaim(cardinality, { id: "population-cardinality", subject: "ref-population",
    operator: "number:has_cardinality", operands: [{ kind: "number", value: 1 }] });
  addClaim(cardinality, { id: "population-members", subject: "ref-population",
    operator: "reference:contains", operands: [
      { kind: "reference", reference_id: "ref-member-a" },
      { kind: "reference", reference_id: "ref-member-b" }
    ] });
  assert.ok(contradictionReasons(cardinality).includes("cross_operator_constraint"));

  const populations = baseContract();
  addReference(populations, "ref-population-a", "cc:population");
  addReference(populations, "ref-population-b", "cc:population");
  addReference(populations, "ref-population-member", "cc:resource");
  addClaim(populations, { id: "population-a-count", subject: "ref-population-a",
    operator: "number:has_cardinality", operands: [{ kind: "number", value: 1 }] });
  addClaim(populations, { id: "population-a-members", subject: "ref-population-a",
    operator: "reference:contains",
    operands: [{ kind: "reference", reference_id: "ref-population-member" }] });
  addClaim(populations, { id: "population-b-count", subject: "ref-population-b",
    operator: "number:has_cardinality", operands: [{ kind: "number", value: 0 }] });
  addClaim(populations, { id: "population-a-subset-b", subject: "ref-population-a",
    operator: "reference:subset_of",
    operands: [{ kind: "reference", reference_id: "ref-population-b" }] });
  assert.ok(validateAndResolveNativeContractV1(populations).diagnostics.some(
    ({ code }) => code === "population_relation_false"
  ));
});

test("stable native semantics retain identity, reference, collection, and DAG diagnostics", () => {
  const contract = baseContract();
  contract.references.push({ reference_id: "ref-component-alias",
    type_term: "cc:runtime_component",
    identity: structuredClone(contract.references[0].identity) });
  addClaim(contract, { id: "dangling-operand", operator: "reference:uses",
    operands: [{ kind: "reference", reference_id: "ref-missing" }] });
  addClaim(contract, { id: "second-evidence", operator: "boolean:exists",
    operands: [{ kind: "boolean", value: true }] });
  contract.relations.push(
    { relation_id: "rel-cycle-a", role: "refines",
      source_claim_id: "claim-component-exists", target_claim_id: "claim-second-evidence" },
    { relation_id: "rel-cycle-b", role: "refines",
      source_claim_id: "claim-second-evidence", target_claim_id: "claim-component-exists" },
    { relation_id: "rel-dangling", role: "traces",
      source_claim_id: "claim-missing", target_claim_id: "claim-component-exists" }
  );
  contract.collections.push({ collection_id: "set-dangling",
    collection_kind: "ordered_sequence",
    member_claim_ids: ["claim-component-exists", "claim-missing"] });
  const result = validateAndResolveNativeContractV1(contract);
  assert.equal(result.schema_valid, true, JSON.stringify(result.schema_errors));
  const codes = new Set(result.diagnostics.map(
    ({ code }) => code
  ));
  for (const code of [
    "duplicate_reference_identity",
    "dangling_proposition_operand",
    "dangling_relation_source",
    "dangling_collection_member",
    "relation_cycle"
  ]) assert.ok(codes.has(code), code);
});
