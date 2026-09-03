import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

import {
  bundleBytes,
  normalizeContractForIdentity,
  normalizeEvaluationInputForIdentity
} from "../lib/contract-assessment.mjs";
import {
  assessmentSupplementContextFor as supplementContextFor
} from "../lib/lossless-supplement-context.mjs";
import {
  DOMAINS,
  LIMITS,
  buildPlanningPackCycle,
  buildProjectedSelectionSupplement,
  buildProofAwareInputCycle,
  buildSupplementCensus,
  commitment,
  createAssessmentPackCycle,
  firstResourceBreach,
  projectedSelectionResourceFailure,
  projectedSelectionUnsupportedFailure,
  projectedSelectionCommitments,
  validateProjectedSelectionSupplement
} from "../lib/projected-selection-supplement.mjs";
import {
  canonicalJsonBytes,
  domainSeparatedDigest
} from "../lib/proof-aware-digest.mjs";
import {
  createSubject as createBasicSubject
} from "./support/projected-evaluation-binding-fixture.mjs";
import {
  createSubject as createAssociationSubject
} from "./support/projected-evaluation-association-fixture.mjs";

function cycleFor(subject, projected, mutate = () => {}) {
  const context = supplementContextFor(projected);
  const selection = projectedSelectionCommitments(context.projected_evaluation);
  const bind = {
    assessment_pack_cycle_digest: "0".repeat(64),
    contract: commitment("controlled-contract:contract-identity:v1",
      normalizeContractForIdentity(subject.contract)),
    compiled_proof_plan: commitment("controlled-contract:compiled-proof-plan:v1", {
      packs: [{ profile_id: subject.profile.profile_id }]
    }),
    assessment_identity: projected.assessment.assessment_identity,
    assessment_manifest: commitment(
      "controlled-contract:assessment-manifest:v1",
      JSON.parse(bundleBytes(projected).get("manifest.json"))
    ),
    per_pack_assessment: commitment(
      "controlled-contract:per-pack-assessment:v1", projected.assessment
    ),
    pack_identity: commitment("controlled-contract:pack-identity:v1", subject.pack),
    profile_identity: commitment(
      "controlled-contract:profile-identity:v1", subject.profile
    ),
    guarantee_identity: commitment(
      "controlled-contract:guarantee-identity:v1", subject.pack.admission.guarantee
    ),
    admission_identity: commitment(
      "controlled-contract:admission-identity:v1", subject.pack.admission
    ),
    evaluation_input: commitment(
      "controlled-contract:evaluation-input:v1",
      normalizeEvaluationInputForIdentity(subject.evaluationInput)
    ),
    exact_binding_declaration: commitment(
      "controlled-contract:exact-binding-declaration:v1", subject.declaration
    ),
    exact_binding_result: commitment(
      "controlled-contract:exact-binding-result:v1", subject.exactBindingResult
    ),
    exact_capture_source_set: commitment(
      "controlled-contract:exact-capture-source-set:v1", context.exact_binding_sources
    ),
    projected_graph: selection.projected_graph,
    binding_set_digest: subject.exactBindingResult.binding_set_sha256
  };
  const payload = {
    ordinal: 0,
    pack_instance_id: `${subject.profile.profile_id}@${subject.profile.profile_version}`,
    ...bind,
    adequacy_declaration_digest:
      subject.pack.admission.certification.adequacy_declaration_digest,
    adequacy_result_digest:
      subject.pack.admission.certification.adequacy_result_digest,
    profile_result: projected.assessment.digests.results.admitted_profile,
    exact_binding_certification:
      subject.pack.exact_binding_certification_digest,
    selected_node_result: selection.selected_node_result,
    exact_context_digest: subject.exactBindingResult.context.context_sha256
  };
  mutate(payload, bind);
  return createAssessmentPackCycle(payload, bind);
}

function directVerifiedInputBytes(subject, projected, context) {
  return canonicalJsonBytes({
    contract: normalizeContractForIdentity(subject.contract),
    assessment: projected.assessment,
    proof_pack: subject.pack,
    profile: subject.profile,
    evaluation_input: normalizeEvaluationInputForIdentity(subject.evaluationInput),
    exact_binding_declaration: subject.declaration,
    exact_binding_result: subject.exactBindingResult,
    exact_capture_source_set: context.exact_binding_sources,
    projected_selection: context.projected_evaluation.selection
  }).byteLength;
}

async function supplementFor(createSubject) {
  const subject = await createSubject();
  try {
    const projected = subject.project();
    const context = supplementContextFor(projected);
    const cycle = cycleFor(subject, projected);
    const verifiedInputBytes = directVerifiedInputBytes(subject, projected, context);
    return {
      supplement: buildProjectedSelectionSupplement({
        cycle,
        projectedEvaluation: context.projected_evaluation,
        verifiedInputBytes
      }),
      projected,
      cycle,
      projectedEvaluation: context.projected_evaluation,
      verifiedInputBytes
    };
  } finally {
    await subject.cleanup();
  }
}

function resignSupplement(value) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const payload = structuredClone(value);
    delete payload.supplement_identity.digest;
    value.supplement_identity.digest = domainSeparatedDigest(
      DOMAINS.supplement, payload
    );
    const bytes = canonicalJsonBytes(value).byteLength;
    if (bytes === value.counts.successful_output_bytes) break;
    value.counts.successful_output_bytes = bytes;
  }
  return value;
}

function associationVariant(supplement, { status, cardinality, memberCount }) {
  const value = structuredClone(supplement);
  const association = value.association_selections.find(
    ({ associated_nodes: nodes }) => nodes.length > 0
  );
  assert.ok(association, "fixture must contain a selected association member");
  const [member] = association.associated_nodes;
  association.association_status = status;
  association.cardinality = cardinality;
  association.associated_nodes = Array.from({ length: memberCount }, (_, position) => ({
    ...structuredClone(member), associated_node_position: position
  }));
  value.counts.association_members = value.association_selections.reduce(
    (sum, entry) => sum + entry.associated_nodes.length, 0
  );
  return resignSupplement(value);
}

test("lossless supplement retains all five graph kinds and five typed incidences", async () => {
  const { supplement } = await supplementFor(createBasicSubject);
  assert.equal(supplement.status, "success", JSON.stringify(supplement));
  assert.equal(validateProjectedSelectionSupplement(supplement).valid, true);
  assert.deepEqual([...new Set(supplement.projected_graph.nodes.map(
    ({ node_kind: kind }) => kind
  ))].sort(), ["claim", "collection", "proposition", "reference", "relation"]);
  assert.deepEqual([...new Set(supplement.projected_graph.incidences.map(
    ({ incidence_kind: kind }) => kind
  ))].sort(), [
    "applicability_structure", "claim_proposition_ownership",
    "collection_membership", "proposition_structure", "relation_endpoints"
  ]);
  assert.ok(supplement.projected_graph.nodes.every(
    ({ source_contract_node_digest: digest }) => /^[a-f0-9]{64}$/u.test(digest)
  ));
});

test("standalone universal occurrences remain independent from associations", async () => {
  const { supplement } = await supplementFor(createBasicSubject);
  assert.equal(supplement.status, "success");
  assert.ok(supplement.universal_iterations.length > 0);
  assert.ok(supplement.universal_iterations.some(
    ({ occurrences }) => occurrences.length > 0
  ));
  assert.equal(supplement.association_selections.length, 0);
});

test("explicit and unique-by-population-role closure identities are retained",
  async () => {
    const explicit = await supplementFor(createBasicSubject);
    assert.ok(explicit.supplement.universal_iterations.every((iteration) =>
      iteration.complete_population_binding.status === "declared"
    ));
    const resolved = await supplementFor(() => createBasicSubject({
      mutateProfile: (profile) => {
        for (const pattern of profile.claim_patterns) {
          if (pattern.for_each) {
            delete pattern.for_each.complete_population_pattern_id;
          }
        }
        return profile;
      }
    }));
    assert.equal(resolved.supplement.status, "success",
      JSON.stringify(resolved.supplement));
    assert.ok(resolved.supplement.universal_iterations.every((iteration) =>
      iteration.complete_population_binding.status ===
        "resolved_unique_by_population_role"
    ));
  });

test("association selections retain occurrence identities and cardinalities", async () => {
  const { supplement } = await supplementFor(createAssociationSubject);
  assert.equal(supplement.status, "success", JSON.stringify(supplement));
  const iterationByPosition = new Map(supplement.universal_iterations.map(
    (iteration) => [iteration.iteration_position, iteration]
  ));
  assert.ok(supplement.association_selections.some(
    ({ cardinality }) => cardinality === "exactly_one"
  ));
  assert.ok(supplement.association_selections.some(
    ({ cardinality }) => cardinality === "one_or_more"
  ));
  for (const association of supplement.association_selections) {
    const iteration = iterationByPosition.get(association.universal_iteration_position);
    assert.ok(iteration);
    assert.ok(iteration.occurrences.some(({ member_occurrence_position: position }) =>
      position === association.member_occurrence_position));
  }
});

test("association status, cardinality, and member count use the closed four-case table",
  async () => {
    const { supplement } = await supplementFor(createAssociationSubject);
    for (const permitted of [
      { status: "satisfied", cardinality: "exactly_one", memberCount: 1 },
      { status: "satisfied", cardinality: "one_or_more", memberCount: 1 },
      { status: "unsatisfied", cardinality: "exactly_one", memberCount: 0 },
      { status: "unsatisfied", cardinality: "one_or_more", memberCount: 0 },
      { status: "indeterminate", cardinality: "exactly_one", memberCount: 0 },
      { status: "indeterminate", cardinality: "one_or_more", memberCount: 0 }
    ]) assert.equal(validateProjectedSelectionSupplement(
      associationVariant(supplement, permitted)
    ).valid, true, JSON.stringify(permitted));
    for (const rejected of [
      { status: "satisfied", cardinality: "exactly_one", memberCount: 0 },
      { status: "satisfied", cardinality: "exactly_one", memberCount: 2 },
      { status: "satisfied", cardinality: "one_or_more", memberCount: 0 },
      { status: "unsatisfied", cardinality: "exactly_one", memberCount: 1 },
      { status: "unsatisfied", cardinality: "one_or_more", memberCount: 1 },
      { status: "indeterminate", cardinality: "exactly_one", memberCount: 1 },
      { status: "indeterminate", cardinality: "one_or_more", memberCount: 1 }
    ]) {
      const result = validateProjectedSelectionSupplement(
        associationVariant(supplement, rejected)
      );
      assert.equal(result.valid, false, JSON.stringify(rejected));
      assert.ok(result.semantic_diagnostics.some(({ code }) =>
        code === "association_status_cardinality_member_count_mismatch"
      ));
    }
  });

test("lossless supplement success does not rewrite an unsatisfied proof result",
  async () => {
    const { supplement, projected } = await supplementFor(() =>
      createAssociationSubject({
        mutateEvaluationInput: (input) => {
          input.reference_bindings.find(
            ({ role }) => role === "occurrence_criteria"
          ).reference_ids.pop();
          return input;
        }
      }));
    assert.equal(supplement.status, "success", JSON.stringify(supplement));
    assert.equal(projected.assessment.profile_discrimination, "not_proven");
    assert.ok(supplement.association_selections.some(
      ({ association_status: status }) => status === "unsatisfied"
    ));
  });

test("complete empty vacuity is explicit and trace silence is a typed failure", async () => {
  const { supplement, cycle } = await supplementFor(createAssociationSubject);
  const vacuous = supplement.universal_iterations.find(
    ({ vacuous }) => vacuous
  );
  assert.ok(vacuous);
  assert.equal(vacuous.member_count, 0);
  assert.deepEqual(vacuous.occurrences, []);
  const refused = buildProjectedSelectionSupplement({ cycle, projectedEvaluation: {} });
  assert.equal(refused.status, "missing_lossless_fact");
  assert.equal(refused.refusal.code, "PS_MISSING_SELECTED_NODE_TRACE");
  assert.equal("projected_graph" in refused, false);
  assert.equal("supplement_identity" in refused, false);
});

test("position and topology mutation invalidate the canonical supplement", async () => {
  const { supplement } = await supplementFor(createBasicSubject);
  const changed = structuredClone(supplement);
  const proposition = changed.projected_graph.incidences.find(
    ({ incidence_kind: kind }) => kind === "proposition_structure"
  );
  proposition.operands[0].operand_position += 1;
  const result = validateProjectedSelectionSupplement(changed);
  assert.equal(result.valid, false);
  assert.ok(result.semantic_diagnostics.some(({ code }) =>
    ["operand_position_invalid", "supplement_identity_mismatch"].includes(code)));
  const leaked = structuredClone(supplement);
  leaked.status = "resource_limit";
  assert.equal(validateProjectedSelectionSupplement(leaked).valid, false);
});

test("semantic validation rejects node-kind and every positional substitution",
  async () => {
    const { supplement } = await supplementFor(createAssociationSubject);
    const attacks = [
      (value) => {
        const proposition = value.projected_graph.nodes.find(
          ({ node_kind: kind }) => kind === "proposition"
        );
        proposition.node_kind = "reference";
      },
      (value) => {
        const incidence = value.projected_graph.incidences.find((candidate) =>
          candidate.incidence_kind === "proposition_structure" &&
          candidate.operands.length > 1
        );
        [incidence.operands[0], incidence.operands[1]] =
          [incidence.operands[1], incidence.operands[0]];
      },
      (value) => {
        const incidence = value.projected_graph.incidences.find((candidate) =>
          candidate.incidence_kind === "applicability_structure" &&
          candidate.operands.length > 0
        );
        incidence.operands[0].applicability_position = 1;
      },
      (value) => {
        const incidence = value.projected_graph.incidences.find((candidate) =>
          candidate.incidence_kind === "relation_endpoints"
        );
        [incidence.endpoints[0].claim_projected_node_id,
          incidence.endpoints[1].claim_projected_node_id] =
          [incidence.endpoints[1].claim_projected_node_id,
            incidence.endpoints[0].claim_projected_node_id];
      },
      (value) => {
        const incidence = value.projected_graph.incidences.find((candidate) =>
          candidate.incidence_kind === "collection_membership" &&
          candidate.members.length > 1
        );
        [incidence.members[0].claim_projected_node_id,
          incidence.members[1].claim_projected_node_id] =
          [incidence.members[1].claim_projected_node_id,
            incidence.members[0].claim_projected_node_id];
      },
      (value) => {
        const incidence = value.projected_graph.incidences.find((candidate) =>
          candidate.incidence_kind === "proposition_structure"
        );
        incidence.subject.reference_projected_node_id = value.projected_graph.nodes
          .find(({ node_kind: kind, projected_node_id: id }) =>
            kind === "reference" &&
            id !== incidence.subject.reference_projected_node_id)
          .projected_node_id;
      },
      (value) => {
        const incidence = value.projected_graph.incidences.find((candidate) =>
          candidate.incidence_kind === "proposition_structure" &&
          candidate.operands.some(({ operand_kind: kind }) => kind === "reference")
        );
        const operand = incidence.operands.find(
          ({ operand_kind: kind }) => kind === "reference"
        );
        operand.reference_projected_node_id = value.projected_graph.nodes.find(
          ({ node_kind: kind, projected_node_id: id }) =>
            kind === "reference" && id !== operand.reference_projected_node_id
        ).projected_node_id;
      },
      (value) => {
        const incidence = value.projected_graph.incidences.find((candidate) =>
          candidate.incidence_kind === "proposition_structure" &&
          candidate.operands.some(({ operand_kind: kind }) => kind === "reference")
        );
        const operand = incidence.operands.find(
          ({ operand_kind: kind }) => kind === "reference"
        );
        operand.operand_kind = "boolean";
        operand.reference_projected_node_id = null;
        operand.literal_value = false;
      },
      (value) => {
        const incidence = value.projected_graph.incidences.find((candidate) =>
          candidate.incidence_kind === "proposition_structure" &&
          candidate.operands.length > 1
        );
        incidence.operands[1].operand_position = 0;
      },
      (value) => {
        const incidence = value.projected_graph.incidences.find((candidate) =>
          candidate.incidence_kind === "proposition_structure" &&
          candidate.operands.length > 1
        );
        incidence.operands.splice(1, 1);
      },
      (value) => {
        const incidence = value.projected_graph.incidences.find((candidate) =>
          candidate.incidence_kind === "proposition_structure" &&
          candidate.operands.length > 1
        );
        incidence.operands[1].operand_position = 2;
      },
      (value) => {
        const incidence = value.projected_graph.incidences.find((candidate) =>
          candidate.incidence_kind === "applicability_structure"
        );
        incidence.applicability_mode = "counterfactual";
      },
      (value) => {
        const incidence = value.projected_graph.incidences.find((candidate) =>
          candidate.incidence_kind === "applicability_structure" &&
          candidate.operands.length > 0
        );
        incidence.operands[0].applicability_role = "subject";
      },
      (value) => {
        const node = value.projected_graph.nodes.find(({ node_kind: kind }) =>
          kind === "proposition"
        );
        node.semantic_payload.operator = node.semantic_payload.operator ===
          "reference:equals" ? "reference:not_equals" : "reference:equals";
      },
      (value) => {
        const node = value.projected_graph.nodes.find(({ node_kind: kind }) =>
          kind === "reference"
        );
        const field = Object.keys(node.semantic_payload.identity)
          .find((key) => key !== "kind");
        node.semantic_payload.identity[field] += "-substituted";
      },
      (value) => {
        const node = value.projected_graph.nodes.find(({ node_kind: kind }) =>
          kind === "claim"
        );
        node.semantic_payload.modality = node.semantic_payload.modality === "MUST"
          ? "SHOULD" : "MUST";
      },
      (value) => {
        const node = value.projected_graph.nodes.find(({ node_kind: kind }) =>
          kind === "claim"
        );
        const ownership = value.projected_graph.incidences.find((candidate) =>
          candidate.incidence_kind === "claim_proposition_ownership" &&
          candidate.claim_projected_node_id === node.projected_node_id
        );
        node.claim_kind = "verification";
        node.semantic_payload.verification_method = "analysis";
        ownership.claim_kind = "verification";
        ownership.falsifying_proposition_projected_node_id =
          ownership.proposition_projected_node_id;
      },
      (value) => {
        const node = value.projected_graph.nodes.find(({ node_kind: kind }) =>
          kind === "relation"
        );
        node.semantic_payload.relation_role =
          node.semantic_payload.relation_role === "derives_from"
            ? "verifies" : "derives_from";
      },
      (value) => {
        const node = value.projected_graph.nodes.find(({ node_kind: kind }) =>
          kind === "collection"
        );
        node.semantic_payload.collection_kind =
          node.semantic_payload.collection_kind === "closed_set"
            ? "ordered_sequence" : "closed_set";
      },
      (value) => {
        const node = value.projected_graph.nodes.find(({ node_kind: kind }) =>
          kind === "collection"
        );
        node.semantic_payload.purpose = "unicode-purpose-λ";
      },
      (value) => {
        const incidence = value.projected_graph.incidences.find((candidate) =>
          candidate.incidence_kind === "relation_endpoints"
        );
        incidence.endpoints[0].endpoint_role = "target";
        incidence.endpoints[1].endpoint_role = "source";
      },
      (value) => {
        const incidence = value.projected_graph.incidences.find((candidate) =>
          candidate.incidence_kind === "relation_endpoints"
        );
        incidence.endpoints[0].endpoint_position = 1;
        incidence.endpoints[1].endpoint_position = 0;
      }
    ];
    for (const [attackIndex, attack] of attacks.entries()) {
      const mutated = structuredClone(supplement);
      attack(mutated);
      resignSupplement(mutated);
      assert.equal(validateProjectedSelectionSupplement(mutated).valid, false,
        `attack ${attackIndex}`);
      assert.notEqual(mutated.supplement_identity.digest,
        supplement.supplement_identity.digest);
    }
  });

test("returned supplements and caller inputs are detached and deeply immutable",
  async () => {
    const subject = await createBasicSubject();
    try {
      const projected = subject.project();
      const context = supplementContextFor(projected);
      const cycle = cycleFor(subject, projected);
      const inputDigest = cycle.cycle_binding.contract.digest;
      const supplement = buildProjectedSelectionSupplement({
        cycle,
        projectedEvaluation: context.projected_evaluation,
        verifiedInputBytes: directVerifiedInputBytes(subject, projected, context)
      });
      subject.contract.claims[0].modality = "MAY";
      assert.equal(supplement.cycle_binding.contract.digest, inputDigest);
      assert.equal(Object.isFrozen(supplement), true);
      assert.equal(Object.isFrozen(supplement.projected_graph.nodes), true);
      assert.throws(() => supplement.projected_graph.nodes.push({}), TypeError);
      assert.throws(() => {
        supplement.projected_graph.nodes[0].projected_node_id = "changed";
      }, TypeError);
      assert.equal(validateProjectedSelectionSupplement(supplement).valid, true);
    } finally {
      await subject.cleanup();
    }
  });

test("property and closed-set declaration reordering preserves projected graph identity",
  async () => {
    const baseline = await supplementFor(createBasicSubject);
    const reordered = await supplementFor(() => createBasicSubject({
      mutateContract: (contract) => ({
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
      })
    }));
    assert.equal(reordered.supplement.status, "success");
    assert.equal(reordered.supplement.projected_graph.graph_digest,
      baseline.supplement.projected_graph.graph_digest);
    assert.deepEqual(reordered.supplement.projected_graph,
      baseline.supplement.projected_graph);
    assert.notEqual(reordered.cycle.digest, baseline.cycle.digest,
      "the unchanged upstream assessment carrier still binds its exact own bytes");
  });

test("supplement identity is stable across process, locale, and timezone", () => {
  const runner = new URL(
    "./support/projected-selection-determinism-runner.mjs", import.meta.url
  );
  const outputs = [
    { TZ: "UTC", LANG: "C" },
    { TZ: "Pacific/Auckland", LANG: "en_US.UTF-8" }
  ].map((environment) => execFileSync(process.execPath, [runner.pathname], {
    cwd: new URL("../../..", import.meta.url).pathname,
    env: { ...process.env, ...environment },
    encoding: "utf8"
  }));
  assert.equal(outputs[0], outputs[1]);
  assert.deepEqual(JSON.parse(outputs[0]), JSON.parse(outputs[1]));
});

test("unrelated Unicode contract material remains valid and outside projected topology",
  async () => {
    const { supplement } = await supplementFor(() => createBasicSubject({
      mutateContract: (contract) => {
        contract.references.push({
          reference_id: "ref-unicode-unrelated",
          type_term: "cc:entity",
          identity: { kind: "profile_term", term: "смысл-é-漢字-🔒" }
        });
        return contract;
      }
    }));
    assert.equal(supplement.status, "success");
    assert.equal(supplement.projected_graph.nodes.some(
      ({ projected_node_id: id }) => id === "ref-unicode-unrelated"
    ), false);
    assert.equal(validateProjectedSelectionSupplement(supplement).valid, true);
  });

test("assessment manifest bytes remain outside and unchanged by supplement construction", async () => {
  const subject = await createBasicSubject();
  try {
    const projected = subject.project();
    const before = bundleBytes(projected).get("manifest.json");
    const context = supplementContextFor(projected);
    const cycle = cycleFor(subject, projected);
    const supplement = buildProjectedSelectionSupplement({
      cycle,
      projectedEvaluation: context.projected_evaluation,
      verifiedInputBytes: directVerifiedInputBytes(subject, projected, context)
    });
    assert.equal(supplement.status, "success");
    const after = bundleBytes(projected).get("manifest.json");
    assert.equal(after, before);
    assert.equal(after.includes("projected-selection-supplement"), false);
  } finally {
    await subject.cleanup();
  }
});

test("every repeated assessment-pack cycle commitment rejects substitution", async () => {
  const subject = await createBasicSubject();
  try {
    const projected = subject.project();
    for (const field of [
      "contract", "compiled_proof_plan", "assessment_identity",
      "assessment_manifest", "per_pack_assessment", "pack_identity",
      "profile_identity", "guarantee_identity", "admission_identity",
      "evaluation_input", "exact_binding_declaration", "exact_binding_result",
      "exact_capture_source_set", "projected_graph", "binding_set_digest"
    ]) assert.throws(() => cycleFor(subject, projected, (payload) => {
      payload[field] = field === "assessment_identity" ||
        field === "binding_set_digest" ? "f".repeat(64) : null;
    }), /does not equal/u, field);
  } finally {
    await subject.cleanup();
  }
});

test("every assessment-pack cycle input and cross-cycle supplement substitution fails",
  async () => {
    const subject = await createBasicSubject();
    try {
      const projected = subject.project();
      const context = supplementContextFor(projected);
      const cycle = cycleFor(subject, projected);
      const supplement = buildProjectedSelectionSupplement({
        cycle,
        projectedEvaluation: context.projected_evaluation,
        verifiedInputBytes: directVerifiedInputBytes(subject, projected, context)
      });
      assert.equal(validateProjectedSelectionSupplement(supplement, {
        assessmentPackCycle: cycle
      }).valid, true);
      for (const field of Object.keys(cycle.payload)) {
        const substituted = structuredClone(cycle);
        substituted.payload[field] = field === "ordinal" ? 1 : null;
        assert.equal(validateProjectedSelectionSupplement(supplement, {
          assessmentPackCycle: substituted
        }).valid, false, field);
      }
      const foreignCycle = cycleFor(subject, projected, (payload) => {
        payload.ordinal = 1;
      });
      assert.notEqual(foreignCycle.digest, cycle.digest);
      assert.equal(validateProjectedSelectionSupplement(supplement, {
        assessmentPackCycle: foreignCycle
      }).valid, false);
      assert.throws(() => buildPlanningPackCycle({
        assessmentPackCycleDigest: foreignCycle.digest,
        requirement: "required",
        result: supplement
      }), /another assessment-pack cycle/u);
    } finally {
      await subject.cleanup();
    }
  });

test("census construction refuses incomplete, duplicate, and reordered entries",
  async () => {
    const { supplement, cycle } = await supplementFor(createBasicSubject);
    const entry = {
      ordinal: 0,
      pack_instance_id: "pack@1",
      assessment_pack_cycle_digest: cycle.digest,
      requirement: "required",
      result: supplement
    };
    assert.throws(() => buildSupplementCensus([{ ...entry, ordinal: 1 }]),
      /gap-free/u);
    assert.throws(() => buildSupplementCensus([entry, { ...entry, ordinal: 1 }]),
      /unique/u);
    assert.throws(() => buildSupplementCensus([
      { ...entry, ordinal: 1 },
      { ...entry, ordinal: 0, pack_instance_id: "pack@2",
        assessment_pack_cycle_digest: "e".repeat(64) }
    ]), /gap-free/u);
  });

test("all corrected resource ceilings fail with complete typed diagnostics", async () => {
  const { cycle } = await supplementFor(createBasicSubject);
  for (const [unit, policy] of Object.entries(LIMITS)) {
    const metrics = Object.fromEntries(Object.keys(LIMITS).map((key) => [key, 0]));
    metrics[unit] = policy.limit - 1;
    assert.equal(firstResourceBreach(metrics), null, `${unit}:N-1`);
    metrics[unit] = policy.limit;
    assert.equal(firstResourceBreach(metrics), null, `${unit}:N`);
    metrics[unit] = policy.limit + 1;
    assert.deepEqual(firstResourceBreach(metrics), {
      unit, measured: policy.limit + 1
    });
    const result = projectedSelectionResourceFailure(
      cycle, unit, policy.limit + 1
    );
    assert.equal(validateProjectedSelectionSupplement(result).valid, true);
    assert.equal(result.status, "resource_limit");
    assert.deepEqual(result.refusal, {
      code: "PS_RESOURCE_LIMIT",
      blocked_stage: policy.blocked_stage,
      unit,
      measured: policy.limit + 1,
      limit: policy.limit,
      count_point: policy.count_point,
      partial_result_released: false
    });
    for (const forbidden of [
      "projected_graph", "pattern_selections", "universal_iterations",
      "association_selections", "supplement_identity", "cycle_binding"
    ]) assert.equal(forbidden in result, false, `${unit}:${forbidden}`);
  }
});

test("complete canonical input census enforces N-1, N, and N+1 at construction",
  async () => {
    const { cycle, projectedEvaluation } = await supplementFor(createBasicSubject);
    const limit = LIMITS.canonical_input_bytes.limit;
    for (const measured of [limit - 1, limit]) {
      const result = buildProjectedSelectionSupplement({
        cycle, projectedEvaluation, verifiedInputBytes: measured
      });
      assert.equal(result.status, "success", `${measured}`);
      assert.equal(result.counts.verified_input_bytes, measured);
    }
    const refused = buildProjectedSelectionSupplement({
      cycle, projectedEvaluation, verifiedInputBytes: limit + 1
    });
    assert.equal(refused.status, "resource_limit");
    assert.deepEqual(refused.refusal, {
      code: "PS_RESOURCE_LIMIT",
      blocked_stage: "input_validation",
      unit: "canonical_input_bytes",
      measured: limit + 1,
      limit,
      count_point: "verified_canonical_supplement_inputs_before_normalization",
      partial_result_released: false
    });
  });

test("all four typed failure statuses are closed and leak no partial topology",
  async () => {
    const { cycle } = await supplementFor(createBasicSubject);
    const failures = [
      buildProjectedSelectionSupplement({
        cycle: Object.freeze({}), projectedEvaluation: Object.freeze({})
      }),
      buildProjectedSelectionSupplement({
        cycle,
        projectedEvaluation: Object.freeze({ applicable: true, diagnostics: [] })
      }),
      projectedSelectionResourceFailure(cycle, "projected_nodes", 200001),
      projectedSelectionUnsupportedFailure(cycle)
    ];
    assert.deepEqual(failures.map(({ status }) => status), [
      "refused", "missing_lossless_fact", "resource_limit", "unsupported_input"
    ]);
    for (const result of failures) {
      assert.equal(validateProjectedSelectionSupplement(result).valid, true,
        JSON.stringify(result));
      assert.equal(result.authority.authoritative, false);
      assert.equal(Object.keys(result.authority.mandatory_exclusions).length, 10);
      assert.ok(Object.values(result.authority.mandatory_exclusions).every(
        (value) => value === false
      ));
      for (const forbidden of [
        "projected_graph", "pattern_selections", "universal_iterations",
        "association_selections", "supplement_identity", "cycle_binding",
        "validation_status"
      ]) assert.equal(forbidden in result, false, `${result.status}:${forbidden}`);
    }
  });

test("supplement census, planning-pack cycle, and root input cycle are ordered and bound", async () => {
  const { supplement, cycle } = await supplementFor(createBasicSubject);
  const census = buildSupplementCensus([{
    ordinal: 0,
    pack_instance_id: "pack@1",
    assessment_pack_cycle_digest: cycle.digest,
    requirement: "required",
    result: supplement
  }]);
  const planning = buildPlanningPackCycle({
    assessmentPackCycleDigest: cycle.digest,
    requirement: "required",
    result: supplement
  });
  const root = buildProofAwareInputCycle({
    contract: cycle.cycle_binding.contract,
    compiledProofPlan: cycle.cycle_binding.compiled_proof_plan,
    assessmentIdentity: cycle.cycle_binding.assessment_identity,
    assessmentManifest: cycle.cycle_binding.assessment_manifest,
    supplementCensus: census,
    planningPackCycles: [planning]
  });
  assert.match(census.census_digest, /^[a-f0-9]{64}$/u);
  assert.match(planning.planning_pack_cycle_digest, /^[a-f0-9]{64}$/u);
  assert.match(root.proof_aware_input_cycle_digest, /^[a-f0-9]{64}$/u);
  assert.throws(() => buildSupplementCensus([{
    ordinal: 1,
    pack_instance_id: "pack@1",
    assessment_pack_cycle_digest: cycle.digest,
    requirement: "required",
    result: supplement
  }]), /gap-free/u);
  assert.equal(DOMAINS.supplementCensus,
    "controlled-contract:projected-selection-supplement-census:v1");
});
