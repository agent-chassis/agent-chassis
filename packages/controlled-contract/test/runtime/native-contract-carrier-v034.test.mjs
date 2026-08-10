import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { CONTROLLED_VOCABULARY } from "../../vocabulary/cv.experimental.0.34.mjs";
import {
  NATIVE_CONTRACT_SCHEMA_V034,
  PROFILE_ID_V034,
  SCHEMA_VERSION_V034,
  VOCABULARY_VERSION_V034,
  buildNativeContractSchemaV034,
  controlledComplementV034,
  validateAndResolveNativeContractV034
} from "../../lib/native-contract-carrier-v034.mjs";
import { resolveNativeContractDecomposition } from
  "../../lib/native-contract-decomposition.mjs";
import {
  TOOL_VERSION_V034,
  checkContract
} from "../../bin/check-contract.mjs";

function baseContract() {
  return {
    schema_version: SCHEMA_VERSION_V034,
    vocabulary_version: VOCABULARY_VERSION_V034,
    profile_id: PROFILE_ID_V034,
    references: [
      {
        reference_id: "ref-component",
        type_term: "cc:runtime_component",
        identity: { kind: "profile_term", term: "component" }
      },
      {
        reference_id: "ref-suite",
        type_term: "cc:test",
        identity: { kind: "profile_term", term: "suite" }
      }
    ],
    propositions: [
      {
        proposition_id: "prop-component-exists",
        subject_reference_id: "ref-component",
        operator: "boolean:exists",
        applicability_context: { mode: "unconditional", operand_reference_ids: [] },
        operands: [{ kind: "boolean", value: true }]
      },
      {
        proposition_id: "prop-suite-covers",
        subject_reference_id: "ref-suite",
        operator: "reference:covers",
        applicability_context: { mode: "unconditional", operand_reference_ids: [] },
        operands: [{ kind: "reference", reference_id: "ref-component" }]
      },
      {
        proposition_id: "prop-component-absent",
        subject_reference_id: "ref-component",
        operator: "boolean:exists",
        applicability_context: { mode: "unconditional", operand_reference_ids: [] },
        operands: [{ kind: "boolean", value: false }]
      }
    ],
    claims: [
      {
        claim_id: "claim-component-exists",
        kind: "behavior",
        modality: "MUST",
        proposition_id: "prop-component-exists"
      },
      {
        claim_id: "claim-suite-covers",
        kind: "verification",
        modality: "MUST",
        proposition_id: "prop-suite-covers",
        verification_method: "test_execution",
        falsifying_proposition_id: "prop-component-absent"
      }
    ],
    relations: [
      {
        relation_id: "rel-suite-verifies",
        role: "verifies",
        source_claim_id: "claim-suite-covers",
        target_claim_id: "claim-component-exists"
      }
    ],
    collections: [],
    residue: [],
    annotations: []
  };
}

function addReference(contract, referenceId, typeTerm = "cc:state") {
  contract.references.push({
    reference_id: referenceId,
    type_term: typeTerm,
    identity: { kind: "profile_term", term: referenceId }
  });
}

test("v0.34 carrier schema is composed from the intrinsic vocabulary", () => {
  const operatorTerms = CONTROLLED_VOCABULARY.operators.map(({ term }) => term).sort();
  const typeTerms = CONTROLLED_VOCABULARY.type_terms.map(({ term }) => term).sort();
  assert.deepEqual(NATIVE_CONTRACT_SCHEMA_V034.$defs.proposition.properties.operator.enum,
    operatorTerms);
  assert.deepEqual(NATIVE_CONTRACT_SCHEMA_V034.$defs.reference.properties.type_term.enum,
    typeTerms);
  assert.equal(JSON.stringify(buildNativeContractSchemaV034()),
    JSON.stringify(NATIVE_CONTRACT_SCHEMA_V034));
});

test("tracked v0.34 carrier schema is the executable derived schema", async () => {
  const tracked = JSON.parse(await readFile(new URL(
    "../../schema/controlled-acceptance-contract.experimental.v0.2.schema.json",
    import.meta.url
  ), "utf8"));
  assert.deepEqual(tracked, NATIVE_CONTRACT_SCHEMA_V034);
});

test("cardinality operands are vocabulary-derived nonnegative integers", () => {
  const contract = baseContract();
  const proposition = contract.propositions.find(
    ({ proposition_id: propositionId }) => propositionId === "prop-component-exists"
  );
  proposition.operator = "number:has_cardinality";
  proposition.operands = [{ kind: "number", value: 0.5 }];
  assert.equal(validateAndResolveNativeContractV034(contract).schema_valid, false);

  proposition.operands = [{ kind: "number", value: -1 }];
  assert.equal(validateAndResolveNativeContractV034(contract).schema_valid, false);

  proposition.operands = [{ kind: "number", value: 0 }];
  assert.equal(validateAndResolveNativeContractV034(contract).schema_valid, true);
});

test("v0.34 carrier validates and resolves a complete contract", () => {
  const result = validateAndResolveNativeContractV034(baseContract());
  assert.equal(result.schema_valid, true, JSON.stringify(result.schema_errors));
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.facts.uncovered_mandatory_behavior_claim_ids, []);
});

test("v0.34 explicitly diagnoses paired MUST_NOT complements", () => {
  const contract = baseContract();
  contract.propositions.push(
    {
      proposition_id: "prop-v034-equals",
      subject_reference_id: "ref-component",
      operator: "reference:equals",
      applicability_context: { mode: "unconditional", operand_reference_ids: [] },
      operands: [{ kind: "reference", reference_id: "ref-suite" }]
    },
    {
      proposition_id: "prop-v034-not-equals",
      subject_reference_id: "ref-component",
      operator: "reference:not_equals",
      applicability_context: { mode: "unconditional", operand_reference_ids: [] },
      operands: [{ kind: "reference", reference_id: "ref-suite" }]
    }
  );
  for (const suffix of ["equals", "not-equals"]) contract.claims.push({
    claim_id: `claim-v034-${suffix}`,
    kind: "behavior",
    modality: "MUST_NOT",
    proposition_id: `prop-v034-${suffix}`
  });
  assert.ok(validateAndResolveNativeContractV034(contract).diagnostics.some(
    ({ reason, claim_ids: claimIds = [] }) => reason === "opposed_operator" &&
      claimIds.includes("claim-v034-equals") &&
      claimIds.includes("claim-v034-not-equals")
  ));
});

test("v0.34 relation-set prohibitions reject a positive relation to any member", () => {
  const contract = baseContract();
  for (const id of ["attempt", "refusal", "effect-a", "effect-b"]) {
    addReference(contract, `ref-${id}`, id.startsWith("effect") ? "cc:resource" : "cc:event");
  }
  contract.propositions.push(
    {
      proposition_id: "prop-no-protected-writes",
      subject_reference_id: "ref-attempt",
      operator: "reference:writes",
      applicability_context: {
        mode: "before", operand_reference_ids: ["ref-refusal"]
      },
      operands: [
        { kind: "reference", reference_id: "ref-effect-a" },
        { kind: "reference", reference_id: "ref-effect-b" }
      ]
    },
    {
      proposition_id: "prop-one-protected-write",
      subject_reference_id: "ref-attempt",
      operator: "reference:writes",
      applicability_context: {
        mode: "before", operand_reference_ids: ["ref-refusal"]
      },
      operands: [{ kind: "reference", reference_id: "ref-effect-a" }]
    }
  );
  contract.claims.push(
    {
      claim_id: "claim-no-protected-writes",
      kind: "behavior",
      modality: "MUST_NOT",
      proposition_id: "prop-no-protected-writes"
    },
    {
      claim_id: "claim-one-protected-write",
      kind: "evidence",
      modality: "MUST",
      proposition_id: "prop-one-protected-write"
    }
  );
  const result = validateAndResolveNativeContractV034(contract);
  assert.ok(result.diagnostics.some(({ code, reason, claim_ids: claimIds }) =>
    code === "direct_proposition_contradiction" &&
    reason === "opposed_modality" &&
    claimIds.includes("claim-no-protected-writes") &&
    claimIds.includes("claim-one-protected-write")
  ));
});

test("v0.34 unconditional equivalence normalizes scoped relation-set members", () => {
  const contract = baseContract();
  for (const id of ["attempt", "refusal", "effect", "effect-alias"]) {
    addReference(contract, `ref-${id}`, id.startsWith("effect") ? "cc:resource" : "cc:event");
  }
  contract.propositions.push(
    {
      proposition_id: "prop-effect-alias",
      subject_reference_id: "ref-effect",
      operator: "reference:equals",
      applicability_context: { mode: "unconditional", operand_reference_ids: [] },
      operands: [{ kind: "reference", reference_id: "ref-effect-alias" }]
    },
    {
      proposition_id: "prop-no-protected-write",
      subject_reference_id: "ref-attempt",
      operator: "reference:writes",
      applicability_context: { mode: "before", operand_reference_ids: ["ref-refusal"] },
      operands: [{ kind: "reference", reference_id: "ref-effect" }]
    },
    {
      proposition_id: "prop-write-through-alias",
      subject_reference_id: "ref-attempt",
      operator: "reference:writes",
      applicability_context: { mode: "before", operand_reference_ids: ["ref-refusal"] },
      operands: [{ kind: "reference", reference_id: "ref-effect-alias" }]
    }
  );
  contract.claims.push(
    {
      claim_id: "claim-effect-alias",
      kind: "evidence",
      modality: "MUST",
      proposition_id: "prop-effect-alias"
    },
    {
      claim_id: "claim-no-protected-write",
      kind: "behavior",
      modality: "MUST_NOT",
      proposition_id: "prop-no-protected-write"
    },
    {
      claim_id: "claim-write-through-alias",
      kind: "evidence",
      modality: "MUST",
      proposition_id: "prop-write-through-alias"
    }
  );
  const result = validateAndResolveNativeContractV034(contract);
  assert.ok(result.diagnostics.some(({ code, reason, claim_ids: claimIds }) =>
    code === "direct_proposition_contradiction" &&
    reason === "opposed_modality" &&
    claimIds.includes("claim-no-protected-write") &&
    claimIds.includes("claim-write-through-alias")
  ));
});

test("shared decomposition accepts the selected v0.34 carrier explicitly", () => {
  const result = resolveNativeContractDecomposition(baseContract(), {
    validate_contract: validateAndResolveNativeContractV034,
    counterfactual_falsifier_semantics: "falsifier_role"
  });
  assert.equal(result.schema_valid, true, JSON.stringify(result.schema_errors));
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.facts.mandatory_behavior_component_count, 1);
  assert.equal(result.facts.complexity.counterfactual_falsifier_count, 1);
});

test("the direct contract checker selects v0.34 from the contract schema", async () => {
  const result = await checkContract(fileURLToPath(new URL(
    "../../examples/minimal-controlled-acceptance-contract-v034.json",
    import.meta.url
  )));
  assert.equal(result.tool_version, TOOL_VERSION_V034);
  assert.equal(result.schema.schema_version, SCHEMA_VERSION_V034);
  assert.equal(result.outcome, "structurally_complete");
  assert.equal(result.decomposition.schema_valid, true);
  assert.equal(result.decomposition.facts.complexity.counterfactual_falsifier_count, 1);
});

test("v0.34 carrier excludes both unresolved applicability terms", () => {
  for (const mode of ["counterfactual", "role_route"]) {
    const contract = baseContract();
    contract.propositions[0].applicability_context = {
      mode,
      operand_reference_ids: ["ref-suite"]
    };
    assert.equal(validateAndResolveNativeContractV034(contract).schema_valid, false);
  }
});

test("v0.34 exact complement operators admit exactly one operand", () => {
  const contract = baseContract();
  addReference(contract, "ref-left");
  addReference(contract, "ref-right");
  contract.propositions.push({
    proposition_id: "prop-invalid-equality",
    subject_reference_id: "ref-component",
    operator: "reference:equals",
    applicability_context: { mode: "unconditional", operand_reference_ids: [] },
    operands: [
      { kind: "reference", reference_id: "ref-left" },
      { kind: "reference", reference_id: "ref-right" }
    ]
  });
  assert.equal(validateAndResolveNativeContractV034(contract).schema_valid, false);
});

test("v0.34 derives boolean operand negation as a controlled contradiction", () => {
  const contract = baseContract();
  contract.claims.push({
    claim_id: "claim-component-absent",
    kind: "behavior",
    modality: "MUST",
    proposition_id: "prop-component-absent"
  });
  const result = validateAndResolveNativeContractV034(contract);
  assert.equal(result.schema_valid, true);
  assert.equal(result.diagnostics.some(({ code, reason }) =>
    code === "direct_proposition_contradiction" && reason === "opposed_boolean_value"
  ), true);
  assert.deepEqual(controlledComplementV034("boolean:immutable"), {
    kind: "operand_transform",
    transform: "boolean_negation"
  });
});

test("v0.34 distinguishes equivalence relations from functional values", () => {
  const equality = baseContract();
  addReference(equality, "ref-state-one");
  addReference(equality, "ref-state-two");
  for (const [suffix, referenceId] of [["one", "ref-state-one"], ["two", "ref-state-two"]]) {
    equality.propositions.push({
      proposition_id: `prop-equals-${suffix}`,
      subject_reference_id: "ref-component",
      operator: "reference:equals",
      applicability_context: { mode: "unconditional", operand_reference_ids: [] },
      operands: [{ kind: "reference", reference_id: referenceId }]
    });
    equality.claims.push({
      claim_id: `claim-equals-${suffix}`,
      kind: "behavior",
      modality: "MUST",
      proposition_id: `prop-equals-${suffix}`
    });
  }
  const equalityResult = validateAndResolveNativeContractV034(equality);
  assert.equal(equalityResult.schema_valid, true);
  assert.equal(equalityResult.diagnostics.some(({ reason }) =>
    reason === "conflicting_functional_value"
  ), false);

  const state = structuredClone(equality);
  state.propositions.at(-2).operator = "reference:has_state";
  state.propositions.at(-1).operator = "reference:has_state";
  const stateResult = validateAndResolveNativeContractV034(state);
  assert.equal(stateResult.diagnostics.some(({ reason }) =>
    reason === "conflicting_functional_value"
  ), true);
});

test("v0.34 enforces declared irreflexivity", () => {
  const contract = baseContract();
  contract.propositions.push({
    proposition_id: "prop-self-dependency",
    subject_reference_id: "ref-component",
    operator: "reference:depends_on",
    applicability_context: { mode: "unconditional", operand_reference_ids: [] },
    operands: [{ kind: "reference", reference_id: "ref-component" }]
  });
  const result = validateAndResolveNativeContractV034(contract);
  assert.deepEqual(result.diagnostics.filter(({ code }) => code === "irreflexive_proposition"), [{
    code: "irreflexive_proposition",
    proposition_id: "prop-self-dependency",
    operator: "reference:depends_on",
    reference_id: "ref-component"
  }]);
});

test("v0.34 restricts frozen-base comparison to its declared applicability", () => {
  const invalid = baseContract();
  addReference(invalid, "ref-base", "cc:artifact");
  invalid.propositions.push({
    proposition_id: "prop-unchanged",
    subject_reference_id: "ref-component",
    operator: "reference:unchanged_from_frozen_base",
    applicability_context: { mode: "unconditional", operand_reference_ids: [] },
    operands: [{ kind: "reference", reference_id: "ref-base" }]
  });
  assert.equal(validateAndResolveNativeContractV034(invalid).schema_valid, false);

  invalid.propositions.at(-1).applicability_context = {
    mode: "frozen_base",
    operand_reference_ids: ["ref-base"]
  };
  assert.equal(validateAndResolveNativeContractV034(invalid).schema_valid, true);
});
