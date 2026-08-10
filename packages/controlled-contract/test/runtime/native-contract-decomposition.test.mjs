import assert from "node:assert/strict";
import test from "node:test";

import {
  PROFILE_ID,
  SCHEMA_VERSION,
  VOCABULARY_VERSION
} from "../../lib/native-contract-carrier.mjs";
import { resolveNativeContractDecomposition } from "../../lib/native-contract-decomposition.mjs";

function reference(referenceId, typeTerm = "cc:state") {
  return {
    reference_id: referenceId,
    type_term: typeTerm,
    identity: { kind: "profile_term", term: `example:${referenceId}` }
  };
}

function proposition(propositionId, subjectReferenceId, operandReferenceId, options = {}) {
  return {
    proposition_id: propositionId,
    subject_reference_id: subjectReferenceId,
    operator: options.operator ?? "reference:has_property",
    applicability_context: options.context ?? {
      mode: "unconditional",
      operand_reference_ids: []
    },
    operands: [{ kind: "reference", reference_id: operandReferenceId }]
  };
}

function relation(relationId, role, sourceClaimId, targetClaimId) {
  return {
    relation_id: relationId,
    role,
    source_claim_id: sourceClaimId,
    target_claim_id: targetClaimId
  };
}

function contractWithBehaviors(ids, options = {}) {
  const references = [
    reference("ref-shared-owner", "cc:runtime_component"),
    reference("ref-suite", "cc:test"),
    ...ids.map((id) => reference(`ref-state-${id}`)),
    ...(options.references ?? [])
  ];
  const propositions = [];
  const claims = [];
  const relations = [];
  for (const [index, id] of ids.entries()) {
    propositions.push(
      proposition(`prop-behavior-${id}`, "ref-shared-owner", `ref-state-${id}`),
      proposition(`prop-verification-${id}`, "ref-suite", `ref-state-${id}`, {
        operator: "reference:covers"
      }),
      proposition(`prop-falsifier-${id}`, "ref-shared-owner", `ref-state-${id}`, {
        operator: "reference:not_member_of",
        context: {
          mode: "counterfactual",
          operand_reference_ids: [`ref-state-${id}`]
        }
      })
    );
    claims.push(
      {
        claim_id: `claim-behavior-${id}`,
        kind: "behavior",
        modality: "MUST",
        proposition_id: `prop-behavior-${id}`
      },
      {
        claim_id: `claim-verification-${id}`,
        kind: "verification",
        modality: "MUST",
        proposition_id: `prop-verification-${id}`,
        verification_method: "test_execution",
        falsifying_proposition_id: `prop-falsifier-${id}`
      }
    );
    relations.push(relation(
      `rel-verifies-${index + 1}`,
      "verifies",
      `claim-verification-${id}`,
      `claim-behavior-${id}`
    ));
  }
  propositions.push(...(options.propositions ?? []));
  claims.push(...(options.claims ?? []));
  relations.push(...(options.relations ?? []));
  return {
    schema_version: SCHEMA_VERSION,
    vocabulary_version: VOCABULARY_VERSION,
    profile_id: PROFILE_ID,
    references,
    propositions,
    claims,
    relations,
    collections: options.collections ?? [],
    residue: options.residue ?? [],
    annotations: []
  };
}

function componentFor(result, claimId) {
  return result.facts.components.find(({ behavior_claim_ids }) =>
    behavior_claim_ids.includes(claimId)
  );
}

test("disconnected behavior graphs become deterministic concern components", () => {
  const result = resolveNativeContractDecomposition(contractWithBehaviors(["alpha", "beta"]));
  assert.equal(result.schema_valid, true);
  assert.equal(result.facts.behavior_component_count, 2);
  assert.equal(result.facts.mandatory_behavior_component_count, 2);
  assert.equal(result.facts.mechanically_decomposable, true);
  assert.deepEqual(result.facts.topological_layers, [["component-001", "component-002"]]);
  assert.equal(result.facts.maximum_topological_frontier, 2);
  assert.deepEqual(result.facts.complexity, {
    claim_count: 4,
    mandatory_behavior_count: 2,
    verification_count: 2,
    evidence_count: 0,
    proposition_count: 6,
    declared_reference_count: 4,
    operative_reference_count: 4,
    unused_reference_count: 0,
    relation_count: 2,
    distinct_relation_role_count: 1,
    distinct_operator_count: 3,
    conditional_claim_proposition_count: 0,
    falsifier_proposition_count: 2,
    counterfactual_falsifier_count: 2,
    closed_collection_count: 0,
    operative_residue_count: 0,
    behavior_component_count: 2,
    mandatory_behavior_component_count: 2,
    singleton_behavior_component_count: 2,
    maximum_component_behavior_claim_count: 1,
    shared_verification_count: 0,
    behavior_dependency_arc_count: 0,
    dependency_depth: 0,
    maximum_topological_frontier: 2,
    maximum_dependency_in_degree: 0,
    maximum_dependency_out_degree: 0
  });
  assert.deepEqual(componentFor(result, "claim-behavior-alpha").verification_claim_ids, [
    "claim-verification-alpha"
  ]);
});

test("shared generic references do not manufacture behavior cohesion", () => {
  const result = resolveNativeContractDecomposition(contractWithBehaviors(["alpha", "beta"]));
  const alpha = componentFor(result, "claim-behavior-alpha");
  const beta = componentFor(result, "claim-behavior-beta");
  assert.equal(alpha.behavior_reference_ids.includes("ref-shared-owner"), true);
  assert.equal(beta.behavior_reference_ids.includes("ref-shared-owner"), true);
  assert.notEqual(alpha.component_id, beta.component_id);
});

test("behavior dependency connections yield ordered concern components", () => {
  const contract = contractWithBehaviors(["alpha", "beta"], {
    relations: [relation(
      "rel-beta-depends-alpha",
      "depends_on",
      "claim-behavior-beta",
      "claim-behavior-alpha"
    )]
  });
  const result = resolveNativeContractDecomposition(contract);
  assert.equal(result.facts.behavior_component_count, 2);
  assert.deepEqual(result.facts.topological_component_ids, [
    "component-001", "component-002"
  ]);
  assert.deepEqual(result.facts.behavior_dependency_arcs, [{
    prerequisite_component_id: "component-001",
    dependent_component_id: "component-002",
    relation_ids: ["rel-beta-depends-alpha"],
    transitively_redundant: false
  }]);
  assert.equal(componentFor(result, "claim-behavior-beta").dependency_depth, 1);
});

test("precedes and depends_on normalize to prerequisite-to-dependent direction", () => {
  const contract = contractWithBehaviors(["alpha", "beta", "gamma"], {
    relations: [
      relation(
        "rel-alpha-precedes-beta",
        "precedes",
        "claim-behavior-alpha",
        "claim-behavior-beta"
      ),
      relation(
        "rel-gamma-depends-beta",
        "depends_on",
        "claim-behavior-gamma",
        "claim-behavior-beta"
      )
    ]
  });
  const result = resolveNativeContractDecomposition(contract);
  assert.deepEqual(result.facts.topological_component_ids, [
    "component-001", "component-002", "component-003"
  ]);
  assert.equal(result.facts.dependency_depth, 2);
  assert.equal(result.facts.maximum_topological_frontier, 1);
});

test("behavior refines edges define the default concern boundary", () => {
  const contract = contractWithBehaviors(["alpha", "beta"], {
    relations: [relation(
      "rel-beta-refines-alpha",
      "refines",
      "claim-behavior-beta",
      "claim-behavior-alpha"
    )]
  });
  const result = resolveNativeContractDecomposition(contract);
  assert.equal(result.facts.behavior_component_count, 1);
  assert.equal(result.facts.mechanically_decomposable, false);
  assert.deepEqual(result.facts.components[0].behavior_claim_ids, [
    "claim-behavior-alpha",
    "claim-behavior-beta"
  ]);
  assert.deepEqual(result.facts.components[0].verification_claim_ids, [
    "claim-verification-alpha",
    "claim-verification-beta"
  ]);
});

test("a verifier spanning behaviors is shared proof, not behavior cohesion", () => {
  const contract = contractWithBehaviors(["alpha", "beta"]);
  contract.relations.push(relation(
    "rel-verifies-cross",
    "verifies",
    "claim-verification-alpha",
    "claim-behavior-beta"
  ));
  const result = resolveNativeContractDecomposition(contract);
  assert.equal(result.facts.behavior_component_count, 2);
  assert.equal(result.facts.verification_overlay.shared_verification_count, 1);
  assert.equal(result.facts.verification_overlay.max_target_behavior_count, 2);
  assert.equal(result.facts.verification_overlay.max_target_component_count, 2);
  assert.deepEqual(componentFor(
    result,
    "claim-behavior-alpha"
  ).shared_verification_claim_ids, ["claim-verification-alpha"]);
  assert.deepEqual(componentFor(
    result,
    "claim-behavior-beta"
  ).shared_verification_claim_ids, ["claim-verification-alpha"]);
});

test("supplementary verification remains traceable without becoming coverage", () => {
  const contract = contractWithBehaviors(["alpha", "beta"], {
    collections: [{
      collection_id: "set-alpha",
      collection_kind: "closed_set",
      member_claim_ids: ["claim-behavior-alpha"]
    }]
  });
  contract.claims.find(
    ({ claim_id: claimId }) => claimId === "claim-verification-alpha"
  ).modality = "SHOULD";
  const result = resolveNativeContractDecomposition(contract);
  const alpha = componentFor(result, "claim-behavior-alpha");

  assert.deepEqual(alpha.verification_claim_ids, []);
  assert.deepEqual(alpha.supplementary_verification_claim_ids, [
    "claim-verification-alpha"
  ]);
  assert.deepEqual(result.facts.verification_overlay.qualifying_verifies_relation_ids, [
    "rel-verifies-2"
  ]);
  assert.deepEqual(result.facts.verification_overlay.supplementary_verifies_relation_ids, [
    "rel-verifies-1"
  ]);
  assert.equal(result.facts.verification_overlay.supplementary_verification_claim_count, 1);
  assert.deepEqual(
    result.facts.verification_overlay.attached_supplementary_verification_claim_ids,
    ["claim-verification-alpha"]
  );
  assert.equal(
    result.facts.collection_overlay.attachments[0]
      .verification_population.verified_behavior_member_count,
    0
  );
});

test("broad traceability and hierarchy hubs do not manufacture behavior cohesion", () => {
  const evidenceProposition = proposition(
    "prop-authority",
    "ref-suite",
    "ref-state-alpha",
    { operator: "reference:traces_to" }
  );
  const evidenceClaim = {
    claim_id: "claim-authority",
    kind: "evidence",
    modality: "MUST",
    proposition_id: "prop-authority"
  };
  const contract = contractWithBehaviors(["alpha", "beta"], {
    propositions: [evidenceProposition],
    claims: [evidenceClaim],
    relations: [
      relation(
        "rel-alpha-authority",
        "derives_from",
        "claim-behavior-alpha",
        "claim-authority"
      ),
      relation(
        "rel-beta-authority",
        "derives_from",
        "claim-behavior-beta",
        "claim-authority"
      ),
      relation(
        "rel-beta-satisfies-alpha",
        "satisfies",
        "claim-behavior-beta",
        "claim-behavior-alpha"
      )
    ]
  });
  const result = resolveNativeContractDecomposition(contract);
  assert.equal(result.facts.behavior_component_count, 2);
  assert.deepEqual(
    result.facts.relation_overlays.traceability.map(({ relation_id }) => relation_id),
    ["rel-alpha-authority", "rel-beta-authority"]
  );
  assert.deepEqual(
    result.facts.relation_overlays.hierarchy.map(({ relation_id }) => relation_id),
    ["rel-beta-satisfies-alpha"]
  );
});

test("a verifier spanning the head and tail of a chain does not create a quotient cycle", () => {
  const contract = contractWithBehaviors(["alpha", "beta", "gamma"], {
    relations: [
      relation(
        "rel-beta-depends-alpha",
        "depends_on",
        "claim-behavior-beta",
        "claim-behavior-alpha"
      ),
      relation(
        "rel-gamma-depends-beta",
        "depends_on",
        "claim-behavior-gamma",
        "claim-behavior-beta"
      ),
      relation(
        "rel-verifies-alpha-to-gamma",
        "verifies",
        "claim-verification-alpha",
        "claim-behavior-gamma"
      )
    ]
  });
  const result = resolveNativeContractDecomposition(contract);
  assert.equal(result.facts.behavior_component_count, 3);
  assert.equal(result.facts.dependency_depth, 2);
  assert.deepEqual(result.facts.topological_layers, [
    ["component-001"],
    ["component-002"],
    ["component-003"]
  ]);
  assert.equal(result.diagnostics.length, 0);
});

test("a quotient cycle caused by cohesive contraction is diagnosed distinctly", () => {
  const contract = contractWithBehaviors(["alpha", "beta", "gamma"], {
    relations: [
      relation(
        "rel-alpha-refines-gamma",
        "refines",
        "claim-behavior-alpha",
        "claim-behavior-gamma"
      ),
      relation(
        "rel-beta-depends-alpha",
        "depends_on",
        "claim-behavior-beta",
        "claim-behavior-alpha"
      ),
      relation(
        "rel-gamma-depends-beta",
        "depends_on",
        "claim-behavior-gamma",
        "claim-behavior-beta"
      )
    ]
  });
  const result = resolveNativeContractDecomposition(contract);
  assert.equal(
    result.source_contract_diagnostics.some(({ code }) => code === "relation_cycle"),
    false
  );
  assert.equal(result.facts.topological_component_ids, null);
  assert.equal(result.facts.dependency_depth, null);
  assert.equal(result.facts.mechanically_decomposable, false);
  assert.deepEqual(result.diagnostics, [{
    code: "behavior_dependency_quotient_cycle",
    component_ids: ["component-001", "component-002"]
  }]);
});

test("transitive behavior dependency arcs are identified", () => {
  const contract = contractWithBehaviors(["alpha", "beta", "gamma"], {
    relations: [
      relation(
        "rel-beta-depends-alpha",
        "depends_on",
        "claim-behavior-beta",
        "claim-behavior-alpha"
      ),
      relation(
        "rel-gamma-depends-beta",
        "depends_on",
        "claim-behavior-gamma",
        "claim-behavior-beta"
      ),
      relation(
        "rel-gamma-depends-alpha",
        "depends_on",
        "claim-behavior-gamma",
        "claim-behavior-alpha"
      )
    ]
  });
  const result = resolveNativeContractDecomposition(contract);
  const redundant = result.facts.behavior_dependency_arcs.filter(
    ({ transitively_redundant }) => transitively_redundant
  );
  assert.deepEqual(redundant.map(({ relation_ids }) => relation_ids), [[
    "rel-gamma-depends-alpha"
  ]]);
  assert.equal(result.facts.behavior_dependency_relation_count, 3);
});

test("a source dependency cycle and its quotient cycle are reported separately", () => {
  const contract = contractWithBehaviors(["alpha", "beta"], {
    relations: [
      relation(
        "rel-alpha-precedes-beta",
        "precedes",
        "claim-behavior-alpha",
        "claim-behavior-beta"
      ),
      relation(
        "rel-alpha-depends-beta",
        "depends_on",
        "claim-behavior-alpha",
        "claim-behavior-beta"
      )
    ]
  });
  const result = resolveNativeContractDecomposition(contract);
  assert.equal(result.facts.topological_component_ids, null);
  assert.equal(result.facts.dependency_depth, null);
  assert.equal(result.facts.mechanically_decomposable, false);
  assert.equal(
    result.diagnostics.some(
      ({ code }) => code === "behavior_dependency_quotient_cycle"
    ),
    true
  );
  assert.equal(
    result.source_contract_diagnostics.some(({ code }) => code === "relation_cycle"),
    true
  );
});

test("evidence dependencies remain overlays and do not enter behavior topology", () => {
  const evidenceProposition = proposition(
    "prop-evidence",
    "ref-suite",
    "ref-state-alpha",
    { operator: "reference:traces_to" }
  );
  const contract = contractWithBehaviors(["alpha", "beta"], {
    propositions: [evidenceProposition],
    claims: [{
      claim_id: "claim-evidence",
      kind: "evidence",
      modality: "MUST",
      proposition_id: "prop-evidence"
    }],
    relations: [relation(
      "rel-evidence-depends-alpha",
      "depends_on",
      "claim-evidence",
      "claim-behavior-alpha"
    )]
  });
  const result = resolveNativeContractDecomposition(contract);
  assert.equal(result.facts.behavior_dependency_relation_count, 0);
  assert.equal(result.facts.evidence_overlay.dependency_relations.length, 1);
  assert.equal(result.facts.evidence_overlay.dependency_relations[0].relation_id,
    "rel-evidence-depends-alpha");
});

test("orphan verification claims are measured without creating components", () => {
  const contract = contractWithBehaviors(["alpha"]);
  contract.relations = [];
  const result = resolveNativeContractDecomposition(contract);
  assert.equal(result.facts.behavior_component_count, 1);
  assert.equal(result.facts.verification_overlay.orphan_verification_count, 1);
  assert.deepEqual(result.facts.components[0].verification_claim_ids, []);
});

test("declared, operative, and unused references are distinguished", () => {
  const contract = contractWithBehaviors(["alpha"], {
    references: [reference("ref-unused")]
  });
  const result = resolveNativeContractDecomposition(contract);
  assert.deepEqual(result.facts.reference_usage, {
    declared_reference_count: 4,
    operative_reference_count: 3,
    unused_reference_count: 1,
    unused_reference_ids: ["ref-unused"]
  });
});

test("claim conditions and counterfactual test falsifiers are counted separately", () => {
  const contract = contractWithBehaviors(["alpha"]);
  contract.propositions.find(
    ({ proposition_id }) => proposition_id === "prop-behavior-alpha"
  ).applicability_context = {
    mode: "when",
    operand_reference_ids: ["ref-state-alpha"]
  };
  const result = resolveNativeContractDecomposition(contract);
  assert.equal(result.facts.complexity.conditional_claim_proposition_count, 1);
  assert.equal(result.facts.complexity.falsifier_proposition_count, 1);
  assert.equal(result.facts.complexity.counterfactual_falsifier_count, 1);
});

test("component operator mix is exposed without assigning planning semantics", () => {
  const contract = contractWithBehaviors(["alpha", "beta"], {
    relations: [relation(
      "rel-beta-refines-alpha",
      "refines",
      "claim-behavior-beta",
      "claim-behavior-alpha"
    )]
  });
  contract.propositions.find(
    ({ proposition_id }) => proposition_id === "prop-behavior-beta"
  ).operator = "reference:preserves";
  const result = resolveNativeContractDecomposition(contract);
  assert.deepEqual(result.facts.components[0].complexity.behavior_operator_counts, {
    "reference:has_property": 1,
    "reference:preserves": 1
  });
  assert.equal("constructive" in result.facts.components[0], false);
});

test("closed collections attach to behavior components without merging them", () => {
  const contract = contractWithBehaviors(["alpha", "beta"], {
    collections: [{
      collection_id: "set-required",
      collection_kind: "closed_set",
      member_claim_ids: [
        "claim-behavior-alpha",
        "claim-behavior-beta",
        "claim-verification-alpha"
      ]
    }]
  });
  const result = resolveNativeContractDecomposition(contract);
  assert.equal(result.facts.behavior_component_count, 2);
  assert.deepEqual(result.facts.collection_overlay, {
    collection_count: 1,
    single_component_collection_count: 0,
    shared_collection_count: 1,
    no_behavior_members_collection_count: 0,
    attachments: [{
      collection_id: "set-required",
      collection_kind: "closed_set",
      behavior_claim_ids: ["claim-behavior-alpha", "claim-behavior-beta"],
      nonbehavior_claim_ids: ["claim-verification-alpha"],
      target_component_ids: ["component-001", "component-002"],
      attachment: "shared_components",
      verification_population: {
        verified_behavior_member_count: 2,
        distinct_verification_claim_count: 2,
        distinct_falsifying_proposition_count: 2,
        shared_verification_claim_ids: [],
        shared_falsifying_proposition_ids: [],
        members_without_exclusive_falsifier_ids: [],
        members: [
          {
            behavior_claim_id: "claim-behavior-alpha",
            component_id: "component-001",
            verification_claim_ids: ["claim-verification-alpha"],
            falsifying_proposition_ids: ["prop-falsifier-alpha"]
          },
          {
            behavior_claim_id: "claim-behavior-beta",
            component_id: "component-002",
            verification_claim_ids: ["claim-verification-beta"],
            falsifying_proposition_ids: ["prop-falsifier-beta"]
          }
        ]
      }
    }]
  });
});

test("ordered collections preserve authored behavior-component order", () => {
  const contract = contractWithBehaviors(["alpha", "beta"], {
    collections: [{
      collection_id: "set-sequence-required",
      collection_kind: "ordered_sequence",
      member_claim_ids: ["claim-behavior-beta", "claim-behavior-alpha"]
    }]
  });
  const result = resolveNativeContractDecomposition(contract);
  assert.equal(result.schema_valid, true, JSON.stringify(result));
  const attachment = result.facts.collection_overlay.attachments[0];
  assert.equal(attachment.collection_kind, "ordered_sequence");
  assert.deepEqual(attachment.behavior_claim_ids, [
    "claim-behavior-beta",
    "claim-behavior-alpha"
  ]);
  assert.deepEqual(attachment.target_component_ids, [
    "component-002",
    "component-001"
  ]);
});

test("closed sets expose aggregate verification without judging its sufficiency", () => {
  const contract = contractWithBehaviors(["alpha", "beta"], {
    collections: [{
      collection_id: "set-required",
      collection_kind: "closed_set",
      member_claim_ids: ["claim-behavior-alpha", "claim-behavior-beta"]
    }]
  });
  contract.relations = contract.relations.filter(
    ({ relation_id }) => relation_id !== "rel-verifies-2"
  );
  contract.relations.push(relation(
    "rel-verifies-alpha-beta",
    "verifies",
    "claim-verification-alpha",
    "claim-behavior-beta"
  ));

  const result = resolveNativeContractDecomposition(contract);
  const population = result.facts.collection_overlay.attachments[0]
    .verification_population;
  assert.equal(population.verified_behavior_member_count, 2);
  assert.equal(population.distinct_verification_claim_count, 1);
  assert.equal(population.distinct_falsifying_proposition_count, 1);
  assert.deepEqual(population.shared_verification_claim_ids, [
    "claim-verification-alpha"
  ]);
  assert.deepEqual(population.shared_falsifying_proposition_ids, [
    "prop-falsifier-alpha"
  ]);
  assert.deepEqual(population.members_without_exclusive_falsifier_ids, [
    "claim-behavior-alpha",
    "claim-behavior-beta"
  ]);
  assert.equal(result.diagnostics.length, 0);
});

test("singleton and authored cohesion density remain exact non-policy facts", () => {
  const contract = contractWithBehaviors(["alpha", "beta", "gamma"], {
    relations: [relation(
      "rel-beta-refines-alpha",
      "refines",
      "claim-behavior-beta",
      "claim-behavior-alpha"
    )]
  });
  const result = resolveNativeContractDecomposition(contract);
  assert.equal(result.facts.singleton_behavior_component_count, 1);
  assert.deepEqual(result.facts.behavior_cohesion, {
    behavior_claim_count: 3,
    cohesive_relation_count: 1,
    component_count: 2,
    singleton_component_count: 1,
    cohesive_relations_per_behavior_claim: 1 / 3,
    components_per_behavior_claim: 2 / 3,
    singleton_component_share: 1 / 2
  });
  assert.equal(
    result.diagnostics.some(({ code }) => code.includes("cohesion")),
    false
  );
});

test("shared repository identities are exposed as overlap without implicit cohesion", () => {
  const contract = contractWithBehaviors(["alpha", "beta"]);
  contract.references.find(
    ({ reference_id }) => reference_id === "ref-shared-owner"
  ).identity = {
    kind: "repository_path",
    repository: "example/repository",
    path: "src/owner.mjs"
  };
  const result = resolveNativeContractDecomposition(contract);
  assert.equal(result.facts.behavior_component_count, 2);
  assert.deepEqual(result.facts.repository_reference_overlap, [{
    left_component_id: "component-001",
    right_component_id: "component-002",
    shared_repository_reference_ids: ["ref-shared-owner"]
  }]);
});

test("dangling claim relations remain explicit decomposition diagnostics", () => {
  const contract = contractWithBehaviors(["alpha"]);
  contract.relations.push(relation(
    "rel-alpha-depends-missing",
    "depends_on",
    "claim-behavior-alpha",
    "claim-behavior-missing"
  ));
  const result = resolveNativeContractDecomposition(contract);
  assert.equal(result.schema_valid, true);
  assert.equal(result.facts.mechanically_decomposable, false);
  assert.deepEqual(result.diagnostics, [{
    code: "decomposition_relation_dangling",
    relation_id: "rel-alpha-depends-missing"
  }]);
});

test("component identities and topology do not depend on authored array order", () => {
  const contract = contractWithBehaviors(["alpha", "beta", "gamma"], {
    relations: [
      relation(
        "rel-beta-depends-alpha",
        "depends_on",
        "claim-behavior-beta",
        "claim-behavior-alpha"
      ),
      relation(
        "rel-gamma-depends-beta",
        "depends_on",
        "claim-behavior-gamma",
        "claim-behavior-beta"
      )
    ]
  });
  const reordered = structuredClone(contract);
  reordered.claims.reverse();
  reordered.propositions.reverse();
  reordered.references.reverse();
  reordered.relations.reverse();

  assert.deepEqual(
    resolveNativeContractDecomposition(reordered).facts,
    resolveNativeContractDecomposition(contract).facts
  );
});

test("schema-invalid contracts yield no decomposition facts", () => {
  const contract = contractWithBehaviors(["alpha"]);
  contract.relations.push(relation(
    "rel-unknown-role",
    "requires",
    "claim-behavior-alpha",
    "claim-verification-alpha"
  ));
  const result = resolveNativeContractDecomposition(contract);
  assert.equal(result.schema_valid, false);
  assert.equal(result.facts, null);
  assert.deepEqual(result.diagnostics, [{ code: "contract_schema_invalid" }]);
});
