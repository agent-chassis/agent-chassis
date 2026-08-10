import assert from "node:assert/strict";
import test from "node:test";

import {
  NATIVE_CONTRACT_SCHEMA,
  PROFILE_ID,
  SCHEMA_VERSION,
  VOCABULARY_VERSION,
  validateAndResolveNativeContract
} from "../../lib/native-contract-carrier.mjs";

function baseContract() {
  return {
    schema_version: SCHEMA_VERSION,
    vocabulary_version: VOCABULARY_VERSION,
    profile_id: PROFILE_ID,
    references: [
      {
        reference_id: "ref-channel-owner",
        type_term: "cc:runtime_component",
        identity: {
          kind: "code_symbol",
          repository: "agent-chassis",
          path: "packages/example/channel.mjs",
          symbol: "createChannel"
        }
      },
      {
        reference_id: "ref-focused-suite",
        type_term: "cc:test",
        identity: {
          kind: "repository_path",
          repository: "agent-chassis",
          path: "tests/example/channel.test.mjs"
        }
      }
    ],
    propositions: [
      {
        proposition_id: "prop-channel-exists",
        subject_reference_id: "ref-channel-owner",
        operator: "boolean:exists",
        applicability_context: { mode: "unconditional", operand_reference_ids: [] },
        operands: [{ kind: "boolean", value: true }]
      },
      {
        proposition_id: "prop-suite-covers-channel",
        subject_reference_id: "ref-focused-suite",
        operator: "reference:covers",
        applicability_context: { mode: "unconditional", operand_reference_ids: [] },
        operands: [{ kind: "reference", reference_id: "ref-channel-owner" }]
      },
      {
        proposition_id: "prop-channel-missing",
        subject_reference_id: "ref-channel-owner",
        operator: "boolean:exists",
        applicability_context: { mode: "unconditional", operand_reference_ids: [] },
        operands: [{ kind: "boolean", value: false }]
      }
    ],
    claims: [
      {
        claim_id: "claim-channel-exists",
        kind: "behavior",
        modality: "MUST",
        proposition_id: "prop-channel-exists"
      },
      {
        claim_id: "claim-suite-covers-channel",
        kind: "verification",
        modality: "MUST",
        proposition_id: "prop-suite-covers-channel",
        verification_method: "test_execution",
        falsifying_proposition_id: "prop-channel-missing"
      }
    ],
    relations: [
      {
        relation_id: "rel-suite-verifies-channel",
        role: "verifies",
        source_claim_id: "claim-suite-covers-channel",
        target_claim_id: "claim-channel-exists"
      }
    ],
    collections: [
      {
        collection_id: "set-proof-obligations",
        collection_kind: "closed_set",
        member_claim_ids: ["claim-channel-exists"]
      }
    ],
    residue: [],
    annotations: []
  };
}

test("native carrier is nonempty and contains no migration source fields", () => {
  assert.equal(NATIVE_CONTRACT_SCHEMA.properties.claims.minItems, 1);
  assert.equal("source_text" in NATIVE_CONTRACT_SCHEMA.properties, false);
  assert.equal("source_elements" in NATIVE_CONTRACT_SCHEMA.properties, false);
  assert.equal("source_spans" in NATIVE_CONTRACT_SCHEMA.$defs.proposition.properties, false);
});

test("a schema-native contract validates and resolves complete verification coverage", () => {
  const result = validateAndResolveNativeContract(baseContract());
  assert.equal(result.schema_valid, true, JSON.stringify(result.schema_errors));
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.facts.uncovered_mandatory_behavior_claim_ids, []);
  assert.equal(
    result.facts.closed_collection_coverage[0].declared_member_coverage_complete,
    true
  );
  assert.equal("allowed" in result, false);
  assert.equal("authorized" in result, false);
});

test("a missing verifies edge remains a graph fact after schema validation", () => {
  const contract = baseContract();
  contract.relations = [];
  const result = validateAndResolveNativeContract(contract);
  assert.equal(result.schema_valid, true);
  assert.deepEqual(result.facts.uncovered_mandatory_behavior_claim_ids, [
    "claim-channel-exists"
  ]);
  assert.deepEqual(result.diagnostics, [
    { code: "mandatory_behavior_unverified", claim_id: "claim-channel-exists" },
    {
      code: "mandatory_verification_unattached",
      claim_id: "claim-suite-covers-channel"
    }
  ]);
});

test("operator and operand families are constrained by the native schema", () => {
  const contract = baseContract();
  contract.propositions[0].operands = [
    { kind: "reference", reference_id: "ref-channel-owner" }
  ];
  const result = validateAndResolveNativeContract(contract);
  assert.equal(result.schema_valid, false);
  assert.equal(result.graph, null);
});

test("verification falsifiers reuse controlled propositions", () => {
  const contract = baseContract();
  const verification = contract.claims.find(({ kind }) => kind === "verification");
  assert.equal(verification.falsifying_proposition_id, "prop-channel-missing");
  assert.equal("falsifying_condition" in verification, false);
  assert.equal("text" in contract.propositions[2], false);

  verification.falsifying_proposition_id = "prop-not-declared";
  const result = validateAndResolveNativeContract(contract);
  assert.equal(result.schema_valid, true);
  assert.equal(
    result.diagnostics.some(({ code }) => code === "dangling_falsifying_proposition"),
    true
  );
});

test("unresolved reference identities are explicit mechanical diagnostics", () => {
  const contract = baseContract();
  contract.propositions[1].operands[0].reference_id = "ref-not-declared";
  const result = validateAndResolveNativeContract(contract);
  assert.equal(result.schema_valid, true);
  assert.deepEqual(
    result.diagnostics.filter(({ code }) => code === "dangling_proposition_operand"),
    [{
      code: "dangling_proposition_operand",
      proposition_id: "prop-suite-covers-channel",
      reference_id: "ref-not-declared"
    }]
  );
});

test("operative residue is preserved without being converted into a policy result", () => {
  const contract = baseContract();
  contract.residue.push({
    residue_id: "res-unknown-boundary",
    reason: "unsupported_concept",
    text: "The delivery must preserve the unknown boundary."
  });
  const result = validateAndResolveNativeContract(contract);
  assert.equal(result.schema_valid, true);
  assert.equal(result.facts.operative_residue_count, 1);
  assert.equal("admitted" in result, false);
});

test("duplicate stable IDs and inverted ranges fail loudly after shape validation", () => {
  const contract = baseContract();
  contract.references.push(structuredClone(contract.references[0]));
  contract.propositions.push({
    proposition_id: "prop-range",
    subject_reference_id: "ref-channel-owner",
    operator: "range:has_range",
    applicability_context: { mode: "unconditional", operand_reference_ids: [] },
    operands: [{ kind: "range", minimum: 10, maximum: 5 }]
  });
  const result = validateAndResolveNativeContract(contract);
  assert.equal(result.schema_valid, true);
  assert.equal(result.diagnostics.some(({ code }) => code === "duplicate_reference_id"), true);
  assert.equal(result.diagnostics.some(({ code }) => code === "invalid_range_order"), true);
});

test("one grounded identity cannot be aliased through several reference IDs", () => {
  const contract = baseContract();
  contract.references.push({
    ...structuredClone(contract.references[0]),
    reference_id: "ref-channel-owner-alias"
  });
  const result = validateAndResolveNativeContract(contract);
  assert.equal(result.schema_valid, true);
  assert.deepEqual(
    result.diagnostics.find(({ code }) => code === "duplicate_reference_identity"),
    {
      code: "duplicate_reference_identity",
      identity: {
        kind: "code_symbol",
        path: "packages/example/channel.mjs",
        repository: "agent-chassis",
        symbol: "createChannel"
      },
      reference_ids: ["ref-channel-owner", "ref-channel-owner-alias"]
    }
  );
});

test("duplicate identity diagnostics use locale-independent code-unit order", () => {
  const contract = baseContract();
  for (const [suffix, term] of [
    ["z-first", "zeta"],
    ["z-second", "zeta"],
    ["unicode-first", "äther"],
    ["unicode-second", "äther"]
  ]) contract.references.push({
    reference_id: `ref-${suffix}`,
    type_term: "cc:entity",
    identity: { kind: "profile_term", term }
  });
  const diagnostics = validateAndResolveNativeContract(contract).diagnostics.filter(
    ({ code }) => code === "duplicate_reference_identity"
  );
  assert.deepEqual(diagnostics.map(({ identity }) => identity), [
    { kind: "profile_term", term: "zeta" },
    { kind: "profile_term", term: "äther" }
  ]);
});

test("directly opposed mandatory propositions are diagnosed locally", () => {
  const contract = baseContract();
  contract.propositions.push(
    {
      proposition_id: "prop-channel-exists-false",
      subject_reference_id: "ref-channel-owner",
      operator: "boolean:exists",
      applicability_context: { mode: "unconditional", operand_reference_ids: [] },
      operands: [{ kind: "boolean", value: false }]
    },
    {
      proposition_id: "prop-channel-equals-suite",
      subject_reference_id: "ref-channel-owner",
      operator: "reference:equals",
      applicability_context: { mode: "unconditional", operand_reference_ids: [] },
      operands: [{ kind: "reference", reference_id: "ref-focused-suite" }]
    },
    {
      proposition_id: "prop-channel-not-equals-suite",
      subject_reference_id: "ref-channel-owner",
      operator: "reference:not_equals",
      applicability_context: { mode: "unconditional", operand_reference_ids: [] },
      operands: [{ kind: "reference", reference_id: "ref-focused-suite" }]
    }
  );
  contract.claims.push(
    {
      claim_id: "claim-channel-exists-false",
      kind: "behavior",
      modality: "MUST",
      proposition_id: "prop-channel-exists-false"
    },
    {
      claim_id: "claim-channel-equals-suite",
      kind: "behavior",
      modality: "MUST",
      proposition_id: "prop-channel-equals-suite"
    },
    {
      claim_id: "claim-channel-not-equals-suite",
      kind: "behavior",
      modality: "MUST",
      proposition_id: "prop-channel-not-equals-suite"
    },
    {
      claim_id: "claim-channel-exists-prohibited",
      kind: "behavior",
      modality: "MUST_NOT",
      proposition_id: "prop-channel-exists"
    }
  );
  const contradictions = validateAndResolveNativeContract(contract).diagnostics.filter(
    ({ code }) => code === "direct_proposition_contradiction"
  );
  assert.deepEqual(contradictions.map(({ reason }) => reason).sort(), [
    "opposed_boolean_value",
    "opposed_modality",
    "opposed_operator"
  ]);
});

test("direct contradiction analysis includes mandatory evidence claims", () => {
  const contract = baseContract();
  contract.claims.find(
    ({ claim_id: claimId }) => claimId === "claim-channel-exists"
  ).kind = "evidence";
  contract.claims.push({
    claim_id: "claim-channel-exists-prohibited-evidence",
    kind: "evidence",
    modality: "MUST_NOT",
    proposition_id: "prop-channel-exists"
  });
  assert.ok(validateAndResolveNativeContract(contract).diagnostics.some(
    ({ code, reason, claim_ids: claimIds }) =>
      code === "direct_proposition_contradiction" &&
      reason === "opposed_modality" &&
      claimIds.includes("claim-channel-exists-prohibited-evidence")
  ));
});

test("frozen v0.33 does not reinterpret paired MUST_NOT complements", () => {
  const contract = baseContract();
  contract.propositions.push(
    {
      proposition_id: "prop-v033-equals",
      subject_reference_id: "ref-channel-owner",
      operator: "reference:equals",
      applicability_context: { mode: "unconditional", operand_reference_ids: [] },
      operands: [{ kind: "reference", reference_id: "ref-focused-suite" }]
    },
    {
      proposition_id: "prop-v033-not-equals",
      subject_reference_id: "ref-channel-owner",
      operator: "reference:not_equals",
      applicability_context: { mode: "unconditional", operand_reference_ids: [] },
      operands: [{ kind: "reference", reference_id: "ref-focused-suite" }]
    }
  );
  for (const suffix of ["equals", "not-equals"]) contract.claims.push({
    claim_id: `claim-v033-${suffix}`,
    kind: "behavior",
    modality: "MUST_NOT",
    proposition_id: `prop-v033-${suffix}`
  });
  assert.equal(validateAndResolveNativeContract(contract).diagnostics.some(
    ({ claim_ids: claimIds = [] }) => claimIds.includes("claim-v033-equals") &&
      claimIds.includes("claim-v033-not-equals")
  ), false);
});

test("conflicting mandatory functional values are diagnosed", () => {
  const contract = baseContract();
  contract.propositions.push(
    {
      proposition_id: "prop-cardinality-one",
      subject_reference_id: "ref-channel-owner",
      operator: "number:has_cardinality",
      applicability_context: { mode: "unconditional", operand_reference_ids: [] },
      operands: [{ kind: "number", value: 1 }]
    },
    {
      proposition_id: "prop-cardinality-two",
      subject_reference_id: "ref-channel-owner",
      operator: "number:has_cardinality",
      applicability_context: { mode: "unconditional", operand_reference_ids: [] },
      operands: [{ kind: "number", value: 2 }]
    }
  );
  contract.claims.push(
    {
      claim_id: "claim-cardinality-one",
      kind: "evidence",
      modality: "MUST",
      proposition_id: "prop-cardinality-one"
    },
    {
      claim_id: "claim-cardinality-two",
      kind: "evidence",
      modality: "MUST",
      proposition_id: "prop-cardinality-two"
    }
  );
  assert.ok(validateAndResolveNativeContract(contract).diagnostics.some(
    ({ code, reason, claim_ids: claimIds }) =>
      code === "direct_proposition_contradiction" &&
      reason === "conflicting_functional_value" &&
      claimIds.includes("claim-cardinality-one") &&
      claimIds.includes("claim-cardinality-two")
  ));
});

test("constraint and multi-valued operators are not treated as functional", () => {
  const contract = baseContract();
  contract.propositions.push(
    {
      proposition_id: "prop-range-lower",
      subject_reference_id: "ref-channel-owner",
      operator: "range:has_range",
      applicability_context: { mode: "unconditional", operand_reference_ids: [] },
      operands: [{ kind: "range", minimum: 5 }]
    },
    {
      proposition_id: "prop-range-upper",
      subject_reference_id: "ref-channel-owner",
      operator: "range:has_range",
      applicability_context: { mode: "unconditional", operand_reference_ids: [] },
      operands: [{ kind: "range", maximum: 10 }]
    },
    {
      proposition_id: "prop-value-channel",
      subject_reference_id: "ref-channel-owner",
      operator: "reference:has_value",
      applicability_context: { mode: "unconditional", operand_reference_ids: [] },
      operands: [{ kind: "reference", reference_id: "ref-channel-owner" }]
    },
    {
      proposition_id: "prop-value-suite",
      subject_reference_id: "ref-channel-owner",
      operator: "reference:has_value",
      applicability_context: { mode: "unconditional", operand_reference_ids: [] },
      operands: [{ kind: "reference", reference_id: "ref-focused-suite" }]
    }
  );
  for (const id of ["range-lower", "range-upper", "value-channel", "value-suite"]) {
    contract.claims.push({
      claim_id: `claim-${id}`,
      kind: "evidence",
      modality: "MUST",
      proposition_id: `prop-${id}`
    });
  }
  assert.equal(validateAndResolveNativeContract(contract).diagnostics.some(
    ({ code, reason }) =>
      code === "direct_proposition_contradiction" &&
      reason === "conflicting_functional_value"
  ), false);
});

test("set-like operands and contexts are normalized before contradiction checks", () => {
  const contract = baseContract();
  contract.propositions.push(
    {
      proposition_id: "prop-normalized-equals",
      subject_reference_id: "ref-channel-owner",
      operator: "reference:equals",
      applicability_context: {
        mode: "counterfactual",
        operand_reference_ids: ["ref-focused-suite", "ref-channel-owner"]
      },
      operands: [
        { kind: "reference", reference_id: "ref-channel-owner" },
        { kind: "reference", reference_id: "ref-focused-suite" }
      ]
    },
    {
      proposition_id: "prop-normalized-not-equals",
      subject_reference_id: "ref-channel-owner",
      operator: "reference:not_equals",
      applicability_context: {
        mode: "counterfactual",
        operand_reference_ids: [
          "ref-channel-owner",
          "ref-focused-suite",
          "ref-focused-suite"
        ]
      },
      operands: [
        { kind: "reference", reference_id: "ref-focused-suite" },
        { kind: "reference", reference_id: "ref-channel-owner" },
        { kind: "reference", reference_id: "ref-channel-owner" }
      ]
    }
  );
  contract.claims.push(
    {
      claim_id: "claim-normalized-equals",
      kind: "evidence",
      modality: "MUST",
      proposition_id: "prop-normalized-equals"
    },
    {
      claim_id: "claim-normalized-not-equals",
      kind: "evidence",
      modality: "MUST",
      proposition_id: "prop-normalized-not-equals"
    }
  );
  assert.ok(validateAndResolveNativeContract(contract).diagnostics.some(
    ({ code, reason, claim_ids: claimIds }) =>
      code === "direct_proposition_contradiction" &&
      reason === "opposed_operator" &&
      claimIds.includes("claim-normalized-equals") &&
      claimIds.includes("claim-normalized-not-equals")
  ));
});

test("disjoint mandatory range constraints are diagnosed as an empty conjunction", () => {
  const contract = baseContract();
  for (const [suffix, range] of [
    ["low", { kind: "range", minimum: 0, maximum: 2 }],
    ["high", { kind: "range", minimum: 8, maximum: 9 }]
  ]) {
    contract.propositions.push({
      proposition_id: `prop-range-${suffix}`,
      subject_reference_id: "ref-channel-owner",
      operator: "range:has_range",
      applicability_context: { mode: "unconditional", operand_reference_ids: [] },
      operands: [range]
    });
    contract.claims.push({
      claim_id: `claim-range-${suffix}`,
      kind: "evidence",
      modality: "MUST",
      proposition_id: `prop-range-${suffix}`
    });
  }
  assert.deepEqual(validateAndResolveNativeContract(contract).diagnostics.find(
    ({ reason }) => reason === "empty_range_conjunction"
  ), {
    code: "direct_proposition_contradiction",
    reason: "empty_range_conjunction",
    claim_ids: ["claim-range-high", "claim-range-low"],
    proposition_ids: ["prop-range-high", "prop-range-low"]
  });
});

test("has type and identity remain multi-valued without an explicit closed qualifier", () => {
  const contract = baseContract();
  for (const [suffix, operator, referenceId] of [
    ["type-a", "reference:has_type", "ref-channel-owner"],
    ["type-b", "reference:has_type", "ref-focused-suite"],
    ["identity-a", "reference:has_identity", "ref-channel-owner"],
    ["identity-b", "reference:has_identity", "ref-focused-suite"]
  ]) {
    contract.propositions.push({
      proposition_id: `prop-${suffix}`,
      subject_reference_id: "ref-channel-owner",
      operator,
      applicability_context: { mode: "unconditional", operand_reference_ids: [] },
      operands: [{ kind: "reference", reference_id: referenceId }]
    });
    contract.claims.push({
      claim_id: `claim-${suffix}`,
      kind: "evidence",
      modality: "MUST",
      proposition_id: `prop-${suffix}`
    });
  }
  assert.equal(validateAndResolveNativeContract(contract).diagnostics.some(
    ({ reason, claim_ids: claimIds = [] }) =>
      reason === "conflicting_functional_value" &&
      claimIds.some((claimId) => /type|identity/.test(claimId))
  ), false);
});

test("a verification falsifier may oppose the behavior it is designed to test", () => {
  const contract = baseContract();
  contract.propositions.push({
    proposition_id: "prop-channel-equals-suite-counterfactual",
    subject_reference_id: "ref-channel-owner",
    operator: "reference:equals",
    applicability_context: { mode: "counterfactual", operand_reference_ids: ["ref-focused-suite"] },
    operands: [{ kind: "reference", reference_id: "ref-focused-suite" }]
  });
  contract.propositions[2] = {
    proposition_id: "prop-channel-missing",
    subject_reference_id: "ref-channel-owner",
    operator: "reference:not_equals",
    applicability_context: { mode: "counterfactual", operand_reference_ids: ["ref-focused-suite"] },
    operands: [{ kind: "reference", reference_id: "ref-focused-suite" }]
  };
  contract.claims.push({
    claim_id: "claim-channel-equals-suite-counterfactual",
    kind: "behavior",
    modality: "MUST",
    proposition_id: "prop-channel-equals-suite-counterfactual"
  });
  contract.relations.push({
    relation_id: "rel-suite-verifies-counterfactual",
    role: "verifies",
    source_claim_id: "claim-suite-covers-channel",
    target_claim_id: "claim-channel-equals-suite-counterfactual"
  });
  assert.deepEqual(validateAndResolveNativeContract(contract).diagnostics, []);
});

test("duplicate collection members survive carrier diagnostic deduplication", () => {
  const contract = baseContract();
  contract.collections[0].member_claim_ids.push(
    contract.collections[0].member_claim_ids[0]
  );
  assert.ok(validateAndResolveNativeContract(contract).diagnostics.some(
    ({ code }) => code === "duplicate_collection_member"
  ));
});

test("collection purpose is an optional controlled discriminator", () => {
  const contract = baseContract();
  contract.collections[0].purpose = "profile_proof_population";
  assert.equal(validateAndResolveNativeContract(contract).schema_valid, true);

  contract.collections[0].purpose = "Not Controlled";
  assert.equal(validateAndResolveNativeContract(contract).schema_valid, false);
});
