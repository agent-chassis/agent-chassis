import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";
import path from "node:path";

import {
  canonicalJson,
  projectContractAssessment
} from "../lib/contract-assessment.mjs";
import { loadAdmittedProofPack, readProofPackCatalog }
  from "../lib/admitted-proof-packs.mjs";
import { semanticDeclarationDiagnostics } from "../lib/exact-binding.mjs";
import {
  VERIFICATION_PROFILE_RESULT_SCHEMA_V034
} from "../lib/verification-profile-v034.mjs";
import {
  SUPPORTED_TRACE_SHAPES,
  evaluateProjectedEvaluationBinding,
  profileTraceCapabilityDiagnostics,
  selectedContractNodes
} from "../lib/projected-evaluation-binding.mjs";
import {
  assertProjectedContractGraph,
  projectedGraphContractDiagnostics,
  projectedGraphEqualityDiagnostics
} from "../lib/projected-contract-graph.mjs";
import {
  buildEqualityNormalizationV034
} from "../lib/equality-normalization-v034.mjs";
import {
  ALTERNATE_SOURCE_FILES,
  SOURCE_FILES,
  buildPack,
  buildProfile,
  censusBytes,
  createSubject,
  orderedCases,
  projectedBindingDiagnostics,
  projectedGraph
} from "./support/projected-evaluation-binding-fixture.mjs";

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(import.meta.dirname, "..");

async function withSubject(options, body) {
  const subject = await createSubject(options);
  try {
    return await body(subject);
  } finally {
    await subject.cleanup();
  }
}

function claimById(contract, claimId) {
  return contract.claims.find(({ claim_id: id }) => id === claimId);
}

function propositionById(contract, propositionId) {
  return contract.propositions.find(({ proposition_id: id }) => id === propositionId);
}

function caseIds(graph) {
  return orderedCases(graph).map(({ case_reference_id: id }) =>
    id.slice("ref-".length));
}

function unrelatedReference(referenceId, term) {
  return {
    reference_id: referenceId,
    type_term: "cc:artifact",
    identity: { kind: "profile_term", term }
  };
}

test("the exact projected graph proves the projected-evaluation binding", async () => {
  await withSubject({}, (subject) => {
    const projected = subject.project();
    assert.equal(projected.assessment.structure, "proven");
    assert.equal(projected.assessment.profile_discrimination, "proven");
    assert.equal(projected.assessment.exact_binding, "proven");
    assert.equal(
      projected.assessment.verification_scope.projected_evaluation_binding,
      "bound_to_deterministic_projection"
    );
    assert.deepEqual(projectedBindingDiagnostics(projected), []);
  });
});

test("unrelated claims, relations, collections, evidence, and residue stay allowed",
  async () => {
    await withSubject({
      mutateContract: (contract, graph) => {
        const [first] = caseIds(graph);
        contract.references.push(
          unrelatedReference("ref-unrelated-subject", "unrelated-subject"),
          unrelatedReference("ref-unrelated-object", "unrelated-object")
        );
        contract.propositions.push({
          proposition_id: "prop-unrelated-behavior",
          subject_reference_id: "ref-unrelated-subject",
          operator: "reference:contains",
          applicability_context: { mode: "unconditional", operand_reference_ids: [] },
          operands: [{ kind: "reference", reference_id: "ref-unrelated-object" }]
        }, {
          proposition_id: "prop-unrelated-absent",
          subject_reference_id: "ref-unrelated-subject",
          operator: "boolean:exists",
          applicability_context: { mode: "unconditional", operand_reference_ids: [] },
          operands: [{ kind: "boolean", value: false }]
        }, {
          proposition_id: "prop-unrelated-verification",
          subject_reference_id: "ref-unrelated-object",
          operator: "boolean:exists",
          applicability_context: { mode: "unconditional", operand_reference_ids: [] },
          operands: [{ kind: "boolean", value: true }]
        });
        contract.claims.push({
          claim_id: "claim-unrelated-behavior",
          kind: "behavior",
          modality: "MUST",
          proposition_id: "prop-unrelated-behavior"
        }, {
          claim_id: "claim-unrelated-verification",
          kind: "verification",
          modality: "MUST",
          proposition_id: "prop-unrelated-verification",
          verification_method: "inspection",
          falsifying_proposition_id: "prop-unrelated-absent"
        });
        contract.relations.push({
          relation_id: "rel-unrelated-derivation",
          role: "derives_from",
          source_claim_id: "claim-unrelated-behavior",
          target_claim_id: `claim-exists-${first}`
        }, {
          relation_id: "rel-unrelated-verifies",
          role: "verifies",
          source_claim_id: "claim-unrelated-verification",
          target_claim_id: "claim-unrelated-behavior"
        });
        contract.collections.push({
          collection_id: "set-unrelated-population",
          collection_kind: "closed_set",
          purpose: "unrelated_population",
          member_claim_ids: ["claim-unrelated-behavior"]
        });
        contract.residue.push({
          residue_id: "res-unrelated",
          reason: "review_only",
          text: "An unrelated retained review boundary."
        });
        return contract;
      }
    }, (subject) => {
      const projected = subject.project();
      assert.deepEqual(projectedBindingDiagnostics(projected), []);
      assert.equal(projected.assessment.exact_binding, "proven");
    });
  });

test("harmless property and set-order permutations do not disturb the binding",
  async () => {
    const baseline = await withSubject({}, (subject) =>
      subject.project().assessment.exact_binding);
    assert.equal(baseline, "proven");
    await withSubject({
      mutateContract: (contract) => {
        const permuted = {
          annotations: contract.annotations,
          residue: contract.residue,
          collections: contract.collections.map((collection) => ({
            member_claim_ids: [...collection.member_claim_ids].reverse(),
            purpose: collection.purpose,
            collection_kind: collection.collection_kind,
            collection_id: collection.collection_id
          })),
          relations: [...contract.relations].reverse(),
          claims: [...contract.claims].reverse().map((claim) => ({
            proposition_id: claim.proposition_id,
            modality: claim.modality,
            kind: claim.kind,
            claim_id: claim.claim_id
          })),
          propositions: [...contract.propositions].reverse(),
          references: [...contract.references].reverse(),
          profile_id: contract.profile_id,
          vocabulary_version: contract.vocabulary_version,
          schema_version: contract.schema_version
        };
        return permuted;
      }
    }, (subject) => {
      const projected = subject.project();
      assert.deepEqual(projectedBindingDiagnostics(projected), []);
      assert.equal(projected.assessment.exact_binding, "proven");
    });
  });

test("unicode identities on unrelated references remain allowed", async () => {
  await withSubject({
    mutateContract: (contract) => {
      contract.references.push(
        unrelatedReference("ref-unicode-one", "смысл-é"),
        unrelatedReference("ref-unicode-two", "漢字-🔒")
      );
      return contract;
    }
  }, (subject) => {
    const projected = subject.project();
    assert.deepEqual(projectedBindingDiagnostics(projected), []);
    assert.equal(projected.assessment.exact_binding, "proven");
  });
});

test("a nonempty universal iteration binds every iterated instance", async () => {
  await withSubject({}, (subject) => {
    const projected = subject.project();
    const iterated = projected.reports.admittedProof.result.pattern_results
      .find(({ pattern_id: id }) => id === "case-member-of-population");
    assert.equal(iterated.status, "satisfied");
    assert.equal(iterated.matched_ids.length, 2);
    const relation = projected.reports.admittedProof.result.pattern_results
      .find(({ pattern_id: id }) => id === "case-derivation");
    assert.equal(relation.status, "satisfied");
    assert.equal(relation.matched_ids.length, 2);
    assert.equal(projected.assessment.exact_binding, "proven");
  });
});

test("an empty vacuous iteration selects no contract node", () => {
  const { selected, diagnostics } = selectedContractNodes({
    pattern_results: [
      { pattern_id: "vacuous-claims", pattern_kind: "claim", status: "satisfied",
        matched_ids: [] }
    ]
  }, {
    claim_patterns: [{ pattern_id: "vacuous-claims" }],
    reference_binding_patterns: []
  }, { records: [] });
  assert.deepEqual(diagnostics, []);
  assert.equal(selected.claims.size, 0);
  assert.equal(selected.relations.size, 0);
  assert.equal(selected.collections.size, 0);
});

async function refuses(options, expectedCodes) {
  return withSubject(options, (subject) => {
    const projected = subject.project();
    const codes = projectedBindingDiagnostics(projected);
    assert.equal(projected.assessment.exact_binding, "not_proven",
      `expected refusal, diagnostics: ${JSON.stringify(codes)}`);
    for (const expected of expectedCodes) assert.ok(codes.includes(expected),
      `expected ${expected} in ${JSON.stringify(codes)}`);
    assert.equal(
      projected.assessment.verification_scope.projected_evaluation_binding, "not_bound"
    );
    return projected;
  });
}

test("a fabricated claim with an otherwise matching proposition is refused", async () => {
  await refuses({
    mutateContract: (contract, graph) => {
      const [first] = caseIds(graph);
      const original = claimById(contract, `claim-membership-${first}`);
      contract.propositions.push({
        ...structuredClone(propositionById(contract, original.proposition_id)),
        proposition_id: "prop-fabricated-membership"
      });
      contract.claims = contract.claims.filter(
        ({ claim_id: id }) => id !== original.claim_id
      );
      contract.claims.push({
        claim_id: "claim-fabricated-membership",
        kind: "evidence",
        modality: "MUST",
        proposition_id: "prop-fabricated-membership"
      });
      contract.collections = contract.collections.map((collection) => ({
        ...collection,
        member_claim_ids: collection.member_claim_ids.map((claimId) =>
          claimId === original.claim_id ? "claim-fabricated-membership" : claimId)
      }));
      return contract;
    }
  }, [
    "projected_evaluation_selected_node_unprojected",
    "projected_graph_node_missing"
  ]);
});

test("a projected claim identifier reused with changed content is refused", async () => {
  await refuses({
    mutateContract: (contract, graph) => {
      const [first] = caseIds(graph);
      const claim = claimById(contract, `claim-membership-${first}`);
      contract.propositions.push({
        ...structuredClone(propositionById(contract, claim.proposition_id)),
        proposition_id: "prop-substituted-membership"
      });
      claim.proposition_id = "prop-substituted-membership";
      return contract;
    }
  }, ["projected_graph_node_content_mismatch"]);
});

test("a substituted proposition under a projected claim is refused", async () => {
  await refuses({
    mutateContract: (contract, graph) => {
      const [first, second] = caseIds(graph);
      const proposition = propositionById(contract, `prop-membership-${first}`);
      proposition.operands = [{ kind: "reference", reference_id: `ref-${second}` }];
      return contract;
    }
  }, ["projected_graph_node_content_mismatch"]);
});

test("a changed subject reference is refused", async () => {
  await refuses({
    mutateContract: (contract, graph) => {
      const [first, second] = caseIds(graph);
      propositionById(contract, `prop-exists-${first}`)
        .subject_reference_id = `ref-${second}`;
      return contract;
    }
  }, ["projected_graph_node_content_mismatch"]);
});

test("a changed operand reference is refused", async () => {
  await refuses({
    mutateContract: (contract, graph) => {
      const [first] = caseIds(graph);
      contract.references.push({
        reference_id: "ref-fabricated-population",
        type_term: "cc:population",
        identity: { kind: "profile_term", term: "fabricated-population" }
      });
      propositionById(contract, `prop-member-of-${first}`).operands = [
        { kind: "reference", reference_id: "ref-fabricated-population" }
      ];
      return contract;
    }
  }, ["projected_graph_node_content_mismatch"]);
});

test("a changed applicability scope is refused", async () => {
  await refuses({
    mutateContract: (contract, graph) => {
      const [first] = caseIds(graph);
      propositionById(contract, `prop-membership-${first}`).applicability_context = {
        mode: "when",
        operand_reference_ids: ["ref-source-dag"]
      };
      return contract;
    }
  }, ["projected_graph_node_content_mismatch"]);
});

test("a projected claim replaced by a verification claim of the same identity is refused",
  async () => {
    await refuses({
      mutateContract: (contract, graph) => {
        const [first] = caseIds(graph);
        contract.propositions.push({
          proposition_id: "prop-fabricated-falsifier",
          subject_reference_id: `ref-${first}`,
          operator: "boolean:exists",
          applicability_context: { mode: "unconditional", operand_reference_ids: [] },
          operands: [{ kind: "boolean", value: false }]
        });
        const claim = claimById(contract, `claim-exists-${first}`);
        claim.kind = "verification";
        claim.verification_method = "inspection";
        claim.falsifying_proposition_id = "prop-fabricated-falsifier";
        return contract;
      }
    }, ["projected_graph_node_content_mismatch"]);
  });

test("a retargeted derivation relation is refused", async () => {
  await refuses({
    mutateContract: (contract, graph) => {
      const [first, second] = caseIds(graph);
      contract.relations.find(({ relation_id: id }) => id === `rel-derives-${first}`)
        .target_claim_id = `claim-exists-${second}`;
      return contract;
    }
  }, ["projected_graph_node_content_mismatch"]);
});

test("a projected relation whose role is changed to verifies is refused", async () => {
  await refuses({
    mutateContract: (contract, graph) => {
      const [first] = caseIds(graph);
      contract.relations.find(({ relation_id: id }) => id === `rel-derives-${first}`)
        .role = "verifies";
      return contract;
    }
  }, ["projected_graph_node_content_mismatch"]);
});

test("an iterated relation substituted for one member is refused", async () => {
  await refuses({
    mutateContract: (contract, graph) => {
      const [first] = caseIds(graph);
      contract.relations.find(({ relation_id: id }) => id === `rel-derives-${first}`)
        .relation_id = "rel-fabricated-derivation";
      return contract;
    }
  }, [
    "projected_evaluation_selected_node_unprojected",
    "projected_graph_node_missing"
  ]);
});

test("an iterated claim substituted for one member is refused", async () => {
  await refuses({
    mutateContract: (contract, graph) => {
      const [first] = caseIds(graph);
      const claim = claimById(contract, `claim-member-of-${first}`);
      claim.claim_id = "claim-fabricated-member-of";
      contract.relations.find(({ relation_id: id }) => id === `rel-derives-${first}`)
        .source_claim_id = "claim-fabricated-member-of";
      return contract;
    }
  }, [
    "projected_evaluation_selected_node_unprojected",
    "projected_graph_node_missing"
  ]);
});

test("a relation with one projected and one fabricated endpoint does not prove",
  async () => {
    await withSubject({
      mutateContract: (contract, graph) => {
        const [first] = caseIds(graph);
        contract.propositions.push({
          proposition_id: "prop-fabricated-endpoint",
          subject_reference_id: `ref-${first}`,
          operator: "boolean:exists",
          applicability_context: { mode: "unconditional", operand_reference_ids: [] },
          operands: [{ kind: "boolean", value: true }]
        });
        contract.claims.push({
          claim_id: "claim-fabricated-endpoint",
          kind: "evidence",
          modality: "MAY",
          proposition_id: "prop-fabricated-endpoint"
        });
        contract.relations.push({
          relation_id: "rel-fabricated-endpoint",
          role: "derives_from",
          source_claim_id: `claim-member-of-${first}`,
          target_claim_id: "claim-fabricated-endpoint"
        });
        return contract;
      }
    }, (subject) => {
      const projected = subject.project();
      assert.equal(projected.assessment.profile_discrimination, "not_proven");
      const relation = projected.reports.admittedProof.result.pattern_results
        .find(({ pattern_id: id }) => id === "case-derivation");
      assert.equal(relation.status, "unsatisfied");
    });
  });

test("a substituted collection member population is refused", async () => {
  await refuses({
    mutateContract: (contract, graph) => {
      const [first] = caseIds(graph);
      contract.collections[0].member_claim_ids = contract.collections[0]
        .member_claim_ids.map((claimId) =>
          claimId === `claim-membership-${first}` ? `claim-exists-${first}` : claimId);
      return contract;
    }
  }, ["projected_graph_node_content_mismatch"]);
});

test("an equality alias concealing a substituted reference is refused", async () => {
  await refuses({
    mutateContract: (contract, graph) => {
      const [first] = caseIds(graph);
      contract.references.push(unrelatedReference("ref-alias-case", "alias-case"));
      contract.propositions.push({
        proposition_id: "prop-alias-case",
        subject_reference_id: `ref-${first}`,
        operator: "reference:equals",
        applicability_context: { mode: "unconditional", operand_reference_ids: [] },
        operands: [{ kind: "reference", reference_id: "ref-alias-case" }]
      });
      contract.claims.push({
        claim_id: "claim-alias-case",
        kind: "evidence",
        modality: "MUST",
        proposition_id: "prop-alias-case"
      });
      return contract;
    }
  }, ["projected_graph_reference_equality_alias"]);
});

function withAliasPattern(profile) {
  profile.reference_roles.push({
    role: "alias_left",
    allowed_type_terms: ["cc:artifact"],
    allowed_identity_kinds: ["profile_term"],
    cardinality: "exactly_one"
  }, {
    role: "alias_right",
    allowed_type_terms: ["cc:artifact"],
    allowed_identity_kinds: ["profile_term"],
    cardinality: "exactly_one"
  });
  profile.reference_roles.sort((left, right) =>
    left.role < right.role ? -1 : left.role > right.role ? 1 : 0);
  profile.reference_binding_patterns.push({
    pattern_id: "alias-pair",
    required_by_stage: "pre_dispatch",
    comparison: "same_reference",
    roles: ["alias_left", "alias_right"]
  });
  profile.satisfaction_expression.all_of.unshift({ pattern: "alias-pair" });
  return profile;
}

function bindAliasRoles(rightReferenceId) {
  return (input) => {
    input.reference_bindings.push(
      { role: "alias_left", reference_ids: ["ref-source-dag"] },
      { role: "alias_right", reference_ids: [rightReferenceId] }
    );
    input.reference_bindings.sort((left, right) =>
      left.role < right.role ? -1 : left.role > right.role ? 1 : 0);
    return input;
  };
}

test("a same-reference comparison collapsed by an unprojected equality claim fails closed",
  async () => {
    await refuses({
      mutateProfile: withAliasPattern,
      mutateEvaluationInput: bindAliasRoles("ref-alias-twin"),
      mutateContract: (contract) => {
        contract.references.push(unrelatedReference("ref-alias-twin", "alias-twin"));
        contract.propositions.push({
          proposition_id: "prop-alias-equals",
          subject_reference_id: "ref-source-dag",
          operator: "reference:equals",
          applicability_context: { mode: "unconditional", operand_reference_ids: [] },
          operands: [{ kind: "reference", reference_id: "ref-alias-twin" }]
        });
        contract.claims.push({
          claim_id: "claim-alias-equals",
          kind: "evidence",
          modality: "MUST",
          proposition_id: "prop-alias-equals"
        });
        return contract;
      }
    }, [
      "projected_evaluation_reference_comparison_unbound",
      "projected_evaluation_unsupported_profile_construct"
    ]);
  });

test("declaring same_reference makes an opted-in profile fail closed up front", async () => {
  await withSubject({
    mutateProfile: withAliasPattern,
    mutateEvaluationInput: bindAliasRoles("ref-source-dag")
  }, (subject) => {
    const projected = subject.project();
    const pattern = projected.reports.admittedProof.result.pattern_results
      .find(({ pattern_id: id }) => id === "alias-pair");
    assert.equal(pattern.status, "satisfied");
    assert.equal(pattern.matched_ids.length, 1,
      "this evaluation avoided the unsupported shape entirely");
    assert.equal(projected.assessment.exact_binding, "not_proven",
      "a profile that can require the unsupported shape must not appear exact-bound");
    const constructs = projected.assessment.diagnostics
      .filter(({ detail }) =>
        detail.code === "projected_evaluation_unsupported_profile_construct")
      .map(({ detail }) => detail.construct);
    assert.deepEqual(constructs, ["reference_binding.same_reference"]);
  });
});

test("the supported trace shapes are an explicit closed capability", () => {
  assert.deepEqual(SUPPORTED_TRACE_SHAPES.reference_binding_comparisons,
    ["complete_population", "distinct_references"]);
  assert.equal(SUPPORTED_TRACE_SHAPES.iterated_claim_association_bindings, true);
  assert.deepEqual(SUPPORTED_TRACE_SHAPES.iterated_claim_association_cardinalities,
    ["exactly_one", "one_or_more"]);
  assert.deepEqual(profileTraceCapabilityDiagnostics({
    reference_binding_patterns: [
      { pattern_id: "closed", comparison: "complete_population" },
      { pattern_id: "distinct", comparison: "distinct_references" }
    ],
    claim_patterns: [
      { pattern_id: "plain" },
      {
        pattern_id: "associated",
        for_each: {
          association_bindings: [
            { associated_role: "peer" },
            { associated_role: "peers", associated_cardinality: "one_or_more" }
          ]
        }
      }
    ]
  }), []);
  assert.deepEqual(profileTraceCapabilityDiagnostics({
    reference_binding_patterns: [
      { pattern_id: "aliased", comparison: "same_reference" },
      { pattern_id: "future", comparison: "future_comparison" }
    ],
    claim_patterns: [{
      pattern_id: "associated",
      for_each: {
        association_bindings: [
          { associated_role: "peer", associated_cardinality: "zero_or_more" }
        ]
      }
    }]
  }).map(({ construct }) => construct), [
    "reference_binding.same_reference",
    "reference_binding.future_comparison",
    "claim.for_each.association_bindings.zero_or_more"
  ]);
});

test("a profile swapped behind its declared digest cannot reach exact binding", async () => {
  await withSubject({ mutateProfile: withAliasPattern,
    mutateEvaluationInput: bindAliasRoles("ref-source-dag") }, (subject) => {
    const substituted = structuredClone(subject.profile);
    substituted.reference_binding_patterns = substituted.reference_binding_patterns
      .map((pattern) => pattern.pattern_id === "alias-pair"
        ? { ...pattern, comparison: "distinct_references" } : pattern);
    const swapped = Object.freeze({ ...subject.pack, profile: substituted });
    const projected = subject.project({ proofPack: swapped });
    assert.equal(projected.assessment.exact_binding, "not_proven",
      "the capability check must not be settled by a profile the pack digest disowns");
    assert.equal(projected.assessment.profile_discrimination, "not_proven");
    const codes = projected.assessment.diagnostics
      .filter(({ source }) => source === "assessment_binding")
      .map(({ detail }) => detail.code ?? detail.field);
    assert.ok(codes.includes("assessment_digest_binding_mismatch"), JSON.stringify(codes));
  });
});

test("a substituted declaration cannot over-attest behind its echoed digest", async () => {
  await withSubject({}, (subject) => {
    const variants = {
      fabricated_requirement: (declaration) => {
        declaration.requirements.push({
          requirement_id: "fabricated-attestation",
          binding_kind: "artifact_bytes",
          role_coverage: [{
            role: "prefix_census", coverage: "exact", projection: "artifact_subject"
          }]
        });
        return declaration;
      },
      dropped_requirement: (declaration) => {
        declaration.requirements = declaration.requirements.filter(
          ({ requirement_id: id }) => id !== "execution-paths"
        );
        return declaration;
      },
      rewritten_role_coverage: (declaration) => {
        declaration.requirements.find(({ requirement_id: id }) => id === "dag-source")
          .role_coverage = [{
            role: "execution_paths", coverage: "exact", projection: "artifact_subject"
          }];
        return declaration;
      },
      forged_expected_content_digest: (declaration) => {
        declaration.requirements.find(({ requirement_id: id }) => id === "dag-source")
          .expected_content_sha256 = "d".repeat(64);
        return declaration;
      },
      weakened_coverage: (declaration) => {
        declaration.requirements[0].role_coverage[0].coverage = "sampled";
        return declaration;
      },
      retargeted_relation: (declaration) => {
        declaration.relations[0].source_requirement_ids = [
          "dag-source", "integration-units", "integration-units"
        ];
        return declaration;
      }
    };
    for (const [name, mutate] of Object.entries(variants)) {
      const substituted = mutate(structuredClone(subject.declaration));
      const pack = Object.freeze({ ...subject.pack, declaration: substituted });
      const projected = subject.project({ proofPack: pack });
      assert.equal(projected.assessment.exact_binding, "not_proven", name);
      const codes = projected.assessment.diagnostics
        .filter(({ source }) => source === "assessment_binding")
        .map(({ detail }) => detail.code);
      assert.ok(codes.includes("exact_binding_declaration_result_mismatch"),
        `${name}: ${JSON.stringify(codes)}`);
    }
    assert.equal(subject.project().assessment.exact_binding, "proven",
      "the honest declaration still binds");
  });
});

test("the bindable pattern-kind universe is still exactly the seven kinds reviewed", () => {
  const kinds = VERIFICATION_PROFILE_RESULT_SCHEMA_V034
    .properties.pattern_results.items.properties.pattern_kind.enum;
  assert.deepEqual([...kinds].sort(), [
    "binding_constraint", "claim", "collection", "evidence", "reference_binding",
    "relation", "resolver_fact"
  ], "a new pattern kind needs a projected-evaluation classification before it ships");
});

test("an unbounded equality sweep fails closed instead of running to completion", () => {
  const graph = {
    references: [{
      reference_id: "ref-projected", type_term: "cc:test",
      identity: { kind: "profile_term", term: "projected" }
    }]
  };
  const contract = { references: [...graph.references], propositions: [], claims: [] };
  for (let index = 0; index < 200; index += 1) {
    const key = String(index).padStart(4, "0");
    contract.references.push(
      unrelatedReference(`ref-star-${key}`, `star-${key}`),
      { reference_id: `ref-star-scope-${key}`, type_term: "cc:scope",
        identity: { kind: "profile_term", term: `star-scope-${key}` } }
    );
    contract.propositions.push({
      proposition_id: `prop-star-${key}`,
      subject_reference_id: "ref-projected",
      operator: "reference:equals",
      applicability_context: {
        mode: "when", operand_reference_ids: [`ref-star-scope-${key}`]
      },
      operands: [{ kind: "reference", reference_id: `ref-star-${key}` }]
    });
    contract.claims.push({
      claim_id: `claim-star-${key}`, kind: "evidence", modality: "MUST",
      proposition_id: `prop-star-${key}`
    });
  }
  const { elapsedMs, diagnostics } = aliasCheckMilliseconds(graph, contract);
  assert.deepEqual(diagnostics.map(({ code }) => code),
    ["projected_graph_equality_check_bounded"]);
  assert.ok(elapsedMs < 2_000,
    `a 200-spoke alias star refused in ${Math.round(elapsedMs)} ms`);
});

test("a context splice is reported under the projected-evaluation field", async () => {
  await withSubject({}, (subject) => {
    const otherProfile = buildProfile();
    otherProfile.profile_id = "test.projected-evaluation.other";
    const otherPack = buildPack(otherProfile, subject.declaration);
    const projected = subject.project({ proofPack: otherPack });
    assert.equal(projected.assessment.exact_binding, "not_proven");
    const codes = projectedBindingDiagnostics(projected);
    assert.ok(codes.includes("projected_evaluation_context_stale_or_spliced"), codes);
    const fields = projected.assessment.diagnostics
      .filter(({ detail }) =>
        detail.code === "projected_evaluation_context_stale_or_spliced")
      .map(({ detail }) => detail.context_field).sort();
    assert.ok(fields.includes("profile_digest"), JSON.stringify(fields));
  });
});

function equalityChainContract(classCount, { selfEqualReferenceId = null } = {}) {
  const references = [];
  const propositions = [];
  const claims = [];
  const equalityClaim = (key, subject, object, context) => {
    propositions.push({
      proposition_id: `prop-chain-equals-${key}`,
      subject_reference_id: subject,
      operator: "reference:equals",
      applicability_context: context,
      operands: [{ kind: "reference", reference_id: object }]
    });
    claims.push({
      claim_id: `claim-chain-equals-${key}`,
      kind: "evidence",
      modality: "MUST",
      proposition_id: `prop-chain-equals-${key}`
    });
  };
  for (let index = 0; index < classCount; index += 1) {
    const key = String(index).padStart(4, "0");
    references.push(
      unrelatedReference(`ref-chain-a-${key}`, `chain-a-${key}`),
      unrelatedReference(`ref-chain-b-${key}`, `chain-b-${key}`),
      { reference_id: `ref-chain-scope-${key}`, type_term: "cc:scope",
        identity: { kind: "profile_term", term: `chain-scope-${key}` } }
    );
    equalityClaim(key, `ref-chain-a-${key}`, `ref-chain-b-${key}`, {
      mode: "when", operand_reference_ids: [`ref-chain-scope-${key}`]
    });
  }
  if (selfEqualReferenceId !== null) equalityClaim(
    "self", selfEqualReferenceId, selfEqualReferenceId,
    { mode: "unconditional", operand_reference_ids: [] }
  );
  return { references, propositions, claims };
}

function aliasCheckMilliseconds(graph, contract) {
  const started = process.hrtime.bigint();
  const diagnostics = projectedGraphEqualityDiagnostics(
    graph, contract, buildEqualityNormalizationV034
  );
  return {
    elapsedMs: Number(process.hrtime.bigint() - started) / 1e6,
    diagnostics
  };
}

test("the equality-alias sweep skips equality among unprojected references", async () => {
  await withSubject({
    mutateContract: (contract) => {
      const extra = equalityChainContract(120);
      contract.references.push(...extra.references);
      contract.propositions.push(...extra.propositions);
      contract.claims.push(...extra.claims);
      return contract;
    }
  }, (subject) => {
    const projected = subject.project();
    assert.deepEqual(projectedBindingDiagnostics(projected), []);
    assert.equal(projected.assessment.exact_binding, "proven");
    const { elapsedMs, diagnostics } = aliasCheckMilliseconds(subject.graph, {
      ...subject.contract,
      ...equalityChainContract(240)
    });
    assert.deepEqual(diagnostics, []);
    assert.ok(elapsedMs < 2_000,
      `240 unrelated conditional equality classes swept in ${Math.round(elapsedMs)} ms`);
  });
});

test("a self-equality claim on a projected reference does not re-enable the sweep",
  async () => {
    await withSubject({
      mutateContract: (contract, graph) => {
        const extra = equalityChainContract(240, {
          selfEqualReferenceId: graph.references[0].reference_id
        });
        contract.references.push(...extra.references);
        contract.propositions.push(...extra.propositions);
        contract.claims.push(...extra.claims);
        return contract;
      }
    }, (subject) => {
      const projected = subject.project();
      assert.deepEqual(projectedBindingDiagnostics(projected), []);
      assert.equal(projected.assessment.exact_binding, "proven");
      const { elapsedMs, diagnostics } = aliasCheckMilliseconds(
        subject.graph, subject.contract
      );
      assert.deepEqual(diagnostics, []);
      assert.ok(elapsedMs < 2_000,
        `a projected self-equality class swept in ${Math.round(elapsedMs)} ms`);
    });
  });

test("a duplicate graph identity is refused", async () => {
  await refuses({
    mutateContract: (contract, graph) => {
      const [first] = caseIds(graph);
      contract.claims.push({
        claim_id: `claim-exists-${first}`,
        kind: "evidence",
        modality: "MAY",
        proposition_id: `prop-exists-${first}`
      });
      return contract;
    }
  }, ["projected_graph_node_duplicate"]);
});

test("an omitted projected node is refused", async () => {
  await refuses({
    mutateContract: (contract) => {
      contract.collections = [];
      return contract;
    }
  }, ["projected_graph_node_missing"]);
});

test("a projection result captured from another source set is refused", async () => {
  await refuses({
    censusOverride: censusBytes(ALTERNATE_SOURCE_FILES)
  }, [
    "projected_evaluation_capture_unproven",
    "projected_evaluation_projection_relation_unproven"
  ]);
});

test("a contract built from another capture's projection is refused", async () => {
  await refuses({
    sourceFiles: ALTERNATE_SOURCE_FILES,
    mutateGraph: () => projectedGraph(censusBytes(SOURCE_FILES))
  }, ["projected_graph_node_missing"]);
});

test("an evaluation input swap is refused", async () => {
  await withSubject({}, (subject) => {
    const swapped = structuredClone(subject.evaluationInput);
    swapped.reference_bindings = swapped.reference_bindings.map((binding) =>
      binding.role === "case_of_empty_prefix"
        ? { ...binding, reference_ids: ["ref-source-dag"] } : binding);
    const projected = subject.project({ evaluationInput: swapped });
    assert.equal(projected.assessment.exact_binding, "not_proven");
    assert.equal(projected.assessment.profile_discrimination, "not_proven");
  });
});

test("a profile and admission swap is refused", async () => {
  await withSubject({}, (subject) => {
    const otherProfile = buildProfile();
    otherProfile.profile_id = "test.projected-evaluation.other";
    const otherPack = buildPack(otherProfile, subject.declaration);
    const projected = subject.project({ proofPack: otherPack });
    assert.equal(projected.assessment.exact_binding, "not_proven");
  });
});

test("an envelope without a declared opt-in is refused", async () => {
  await withSubject({}, (subject) => {
    const withoutOptIn = structuredClone(subject.declaration);
    delete withoutOptIn.projected_evaluation_binding;
    const pack = { ...subject.pack, declaration: withoutOptIn };
    const projected = subject.project({ proofPack: Object.freeze(pack) });
    assert.equal(projected.assessment.exact_binding, "not_proven");
    assert.ok(projectedBindingDiagnostics(projected)
      .includes("projected_evaluation_binding_undeclared"));
  });
});

test("a declared opt-in without a minted envelope is refused", async () => {
  await withSubject({ optIn: false }, (subject) => {
    const optedIn = structuredClone(subject.declaration);
    optedIn.projected_evaluation_binding = {
      binding_version: "controlled-contract-projected-evaluation-binding.v1",
      result_requirement_id: "prefix-census",
      graph_projection_id: "case-membership"
    };
    const pack = { ...subject.pack, declaration: optedIn };
    const projected = subject.project({ proofPack: Object.freeze(pack) });
    assert.equal(projected.assessment.exact_binding, "not_proven");
    assert.ok(projectedBindingDiagnostics(projected)
      .includes("projected_evaluation_binding_envelope_missing"));
  });
});

test("coordinated re-digestion of every caller-controlled artifact still refuses",
  async () => {
    const projected = await refuses({
      mutateContract: (contract, graph) => {
        const [first] = caseIds(graph);
        const claim = claimById(contract, `claim-membership-${first}`);
        contract.propositions.push({
          ...structuredClone(propositionById(contract, claim.proposition_id)),
          proposition_id: "prop-redigested-membership"
        });
        claim.proposition_id = "prop-redigested-membership";
        return contract;
      }
    }, ["projected_graph_node_content_mismatch"]);
    const contextDiagnostics = projected.assessment.diagnostics.filter(
      ({ source, detail }) => source === "assessment_binding" &&
        typeof detail.field === "string" &&
        detail.field.startsWith("exact_binding.context.")
    );
    assert.deepEqual(contextDiagnostics, [],
      "every digest was recomputed consistently, so only the graph binding refuses");
    assert.equal(projected.assessment.structure, "proven");
  });

test("a caller-supplied profile result or trace is ignored", async () => {
  await withSubject({}, (subject) => {
    const poisoned = subject.project({
      evaluation: { satisfaction: "satisfied", pattern_results: [] },
      profileResult: { satisfaction: "satisfied", pattern_results: [] },
      selectionTrace: { began: true, records: [] },
      projectedEvaluation: { applicable: false, diagnostics: [] }
    });
    assert.equal(canonicalJson(poisoned.assessment), canonicalJson(
      subject.project().assessment
    ));
    assert.equal(poisoned.assessment.exact_binding, "proven");
  });
});

test("a fabricated envelope is not accepted as a trusted envelope", () => {
  const result = evaluateProjectedEvaluationBinding({
    declaredOptIn: {
      binding_version: "controlled-contract-projected-evaluation-binding.v1",
      result_requirement_id: "prefix-census",
      graph_projection_id: "case-membership"
    },
    envelope: Object.freeze({
      binding_version: "controlled-contract-projected-evaluation-binding.v1",
      graph: { claims: [], collections: [], propositions: [], references: [],
        relations: [], schema_version: "controlled-contract-projected-contract-graph.v1" }
    }),
    exactBindingResult: { satisfaction: "satisfied" },
    expectedContext: {},
    contract: { references: [] },
    profile: {},
    evaluation: { pattern_results: [] },
    trace: { trace_version: "controlled-contract-profile-graph-selection-trace.v1",
      began: true, records: [] }
  });
  assert.deepEqual(result.diagnostics.map(({ code }) => code),
    ["projected_evaluation_envelope_unrecognized"]);
});

test("an unbindable satisfied pattern kind fails closed", () => {
  const { diagnostics } = selectedContractNodes({
    pattern_results: [
      { pattern_id: "future", pattern_kind: "future_kind", status: "satisfied",
        matched_ids: ["claim-x"] }
    ]
  }, { claim_patterns: [], reference_binding_patterns: [] }, { records: [] });
  assert.deepEqual(diagnostics.map(({ code }) => code),
    ["projected_evaluation_pattern_kind_unbindable"]);
});

test("a recorded for_each association claim is bound as a selected node", () => {
  const { selected, diagnostics } = selectedContractNodes({
    pattern_results: [
      { pattern_id: "iterated", pattern_kind: "claim", status: "satisfied",
        matched_ids: ["claim-selected"] }
    ]
  }, {
    claim_patterns: [{
      pattern_id: "iterated",
      for_each: { association_bindings: [{ associated_role: "peer" }] }
    }],
    reference_binding_patterns: []
  }, {
    records: [
      {
        trace_point: "for_each_association_iteration",
        pattern_id: "iterated",
        member_reference_ids: ["ref-member"],
        association_count: 1,
        iteration_vacuous: false
      },
      {
        trace_point: "for_each_association_binding",
        pattern_id: "iterated",
        member_reference_id: "ref-member",
        association_index: 0,
        associated_role: "peer",
        associated_cardinality: "exactly_one",
        association_status: "satisfied",
        node_kind: "claim",
        node_ids: ["claim-association"]
      }
    ]
  });
  assert.deepEqual(diagnostics, []);
  assert.deepEqual([...selected.claims].sort(),
    ["claim-association", "claim-selected"]);
});

test("a satisfied for_each association without a trace record fails closed", () => {
  const { diagnostics } = selectedContractNodes({
    pattern_results: [
      { pattern_id: "iterated", pattern_kind: "claim", status: "satisfied",
        matched_ids: ["claim-selected"] }
    ]
  }, {
    claim_patterns: [{
      pattern_id: "iterated",
      for_each: { association_bindings: [{ associated_role: "peer" }] }
    }],
    reference_binding_patterns: []
  }, { records: [] });
  assert.deepEqual(diagnostics.map(({ code, reason }) => [code, reason]),
    [["projected_evaluation_trace_incomplete", "iteration_record_missing"]]);
});

test("an unknown reference-binding comparison fails closed", () => {
  const { diagnostics } = selectedContractNodes({
    pattern_results: [
      { pattern_id: "future-comparison", pattern_kind: "reference_binding",
        status: "satisfied", matched_ids: ["ref-a", "ref-b"] }
    ]
  }, {
    claim_patterns: [],
    reference_binding_patterns: [
      { pattern_id: "future-comparison", comparison: "future_comparison" }
    ]
  }, { records: [] });
  assert.deepEqual(diagnostics.map(({ code }) => code),
    ["projected_evaluation_reference_comparison_unbindable"]);
});

test("a satisfied complete population without a trace record fails closed", () => {
  const { diagnostics } = selectedContractNodes({
    pattern_results: [
      { pattern_id: "closed-population", pattern_kind: "reference_binding",
        status: "satisfied", matched_ids: ["ref-population"] }
    ]
  }, {
    claim_patterns: [],
    reference_binding_patterns: [
      { pattern_id: "closed-population", comparison: "complete_population" }
    ]
  }, { records: [] });
  assert.deepEqual(diagnostics.map(({ code }) => code),
    ["projected_evaluation_trace_incomplete"]);
});

test("repeated projection is byte identical and does not mutate caller inputs",
  async () => {
    await withSubject({}, (subject) => {
      const before = canonicalJson({
        contract: subject.contract,
        evaluationInput: subject.evaluationInput,
        declaration: subject.declaration
      });
      const first = canonicalJson(subject.project().assessment);
      const second = canonicalJson(subject.project().assessment);
      assert.equal(first, second);
      assert.equal(canonicalJson({
        contract: subject.contract,
        evaluationInput: subject.evaluationInput,
        declaration: subject.declaration
      }), before);
      const projected = subject.project();
      assert.ok(Object.isFrozen(projected));
      assert.notEqual(projected.assessment.residue, subject.contract.residue);
    });
  });

test("the assessment identity is stable across process, locale, and timezone",
  async () => {
    const script = `
      const fixture = await import(${JSON.stringify(
    path.join(packageRoot, "test/support/projected-evaluation-binding-fixture.mjs")
  )});
      const subject = await fixture.createSubject();
      try {
        process.stdout.write(subject.project().assessment.assessment_identity);
      } finally {
        await subject.cleanup();
      }
    `;
    const runs = await Promise.all([
      { TZ: "UTC", LANG: "C" },
      { TZ: "Asia/Kolkata", LANG: "tr_TR.UTF-8", LC_ALL: "tr_TR.UTF-8" }
    ].map(async (overrides) => {
      const { stdout } = await execFileAsync(process.execPath, ["--input-type=module",
        "-e", script], { cwd: packageRoot, env: { ...process.env, ...overrides } });
      return stdout.trim();
    }));
    assert.equal(runs[0], runs[1]);
    assert.match(runs[0], /^[a-f0-9]{64}$/u);
  });

test("an exact-bound pack that does not opt in keeps its unchanged v1 meaning",
  async () => {
    await withSubject({
      optIn: false,
      mutateContract: (contract, graph) => {
        const [first] = caseIds(graph);
        const claim = claimById(contract, `claim-membership-${first}`);
        contract.propositions.push({
          ...structuredClone(propositionById(contract, claim.proposition_id)),
          proposition_id: "prop-unbound-substitution"
        });
        claim.proposition_id = "prop-unbound-substitution";
        return contract;
      }
    }, (subject) => {
      const projected = subject.project();
      assert.equal(projected.assessment.exact_binding, "proven");
      assert.equal(
        projected.assessment.verification_scope.projected_evaluation_binding,
        "not_declared"
      );
      assert.deepEqual(projectedBindingDiagnostics(projected), []);
    });
  });

test("admitted projection opt-ins are explicit and every declaration stays valid",
  async () => {
    const catalog = await readProofPackCatalog();
    let exactBound = 0;
    const optedIn = [];
    for (const entry of catalog.packs) {
      const pack = await loadAdmittedProofPack(entry.profile_id);
      if (pack.admission_version !== 2) continue;
      exactBound += 1;
      if (pack.declaration.projected_evaluation_binding) optedIn.push(entry.profile_id);
      assert.deepEqual(semanticDeclarationDiagnostics(pack.declaration), [],
        entry.profile_id);
    }
    assert.ok(exactBound >= 7, `expected the admitted exact-bound packs, saw ${exactBound}`);
    assert.ok(optedIn.includes("proof.input.caller-authority-confinement"));
    assert.deepEqual(optedIn, [...optedIn].sort());
  });

test("the graph comparator reports missing, duplicate, and mismatched nodes", () => {
  const graph = assertProjectedContractGraph({
    schema_version: "controlled-contract-projected-contract-graph.v1",
    claims: [{ claim_id: "claim-a", kind: "evidence", modality: "MUST",
      proposition_id: "prop-a" }],
    collections: [],
    propositions: [{ proposition_id: "prop-a", subject_reference_id: "ref-a",
      operator: "boolean:exists",
      applicability_context: { mode: "unconditional", operand_reference_ids: [] },
      operands: [{ kind: "boolean", value: true }] }],
    references: [{ reference_id: "ref-a", type_term: "cc:test",
      identity: { kind: "profile_term", term: "a" } }],
    relations: []
  });
  assert.deepEqual(projectedGraphContractDiagnostics(graph, {
    claims: [], collections: [], propositions: [], references: [], relations: []
  }).map(({ code }) => code).sort(), [
    "projected_graph_node_missing",
    "projected_graph_node_missing",
    "projected_graph_node_missing"
  ]);
  const duplicated = {
    claims: [
      { claim_id: "claim-a", kind: "evidence", modality: "MUST", proposition_id: "prop-a" },
      { claim_id: "claim-a", kind: "evidence", modality: "MAY", proposition_id: "prop-a" }
    ],
    collections: [],
    propositions: [{ proposition_id: "prop-a", subject_reference_id: "ref-a",
      operator: "boolean:exists",
      applicability_context: { mode: "unconditional", operand_reference_ids: [] },
      operands: [{ kind: "boolean", value: true }] }],
    references: [{ reference_id: "ref-a", type_term: "cc:artifact",
      identity: { kind: "profile_term", term: "a" } }],
    relations: []
  };
  assert.deepEqual(
    projectedGraphContractDiagnostics(graph, duplicated)
      .map(({ code }) => code).sort(),
    ["projected_graph_node_content_mismatch", "projected_graph_node_duplicate"]
  );
});

test("a projected graph with a dangling dependency is refused at derivation", () => {
  assert.throws(() => assertProjectedContractGraph({
    schema_version: "controlled-contract-projected-contract-graph.v1",
    claims: [{ claim_id: "claim-a", kind: "evidence", modality: "MUST",
      proposition_id: "prop-missing" }],
    collections: [],
    propositions: [],
    references: [],
    relations: []
  }), /projection|dangling/iu);
});
