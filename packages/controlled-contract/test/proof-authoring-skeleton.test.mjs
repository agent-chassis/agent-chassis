import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  ProofAuthoringSkeletonError,
  buildProofAuthoringSkeleton
} from "../lib/proof-authoring-skeleton.mjs";
import {
  PROOF_GRAPH_PROPOSAL_FIELDS,
  PROOF_GRAPH_PROPOSAL_SCHEMA_VERSION,
  ProofGraphProposalError,
  validateProofGraphProposal
} from "../lib/proof-graph-proposal-v1.mjs";
import { inspectProofPackBindingsPage } from
  "../lib/proof-pack-binding-assistance.mjs";
import { migrateControlledAcceptanceContractV02ToV1 } from
  "../lib/stable-v1-migration.mjs";
import { buildRefusalBeforeEffectsFixture } from
  "./proof-packs/refusal-before-effects-fixture.mjs";
import { buildResultShapeConformanceFixture } from
  "./proof-packs/result-shape-conformance-v1-fixture.mjs";
import { buildDormancyNonactivationFixture } from
  "./proof-packs/dormancy-nonactivation-v1-fixture.mjs";
import { buildAuthenticationProvenanceFixture } from
  "./proof-packs/authentication-provenance-v1-fixture.mjs";
import { buildStableTestProofPopulation } from
  "./support/stable-v1-proof-pack-runtime.mjs";

function stabilizeFixture(value) {
  const fixture = structuredClone(value);
  fixture.contract.test_proofs = buildStableTestProofPopulation(fixture.contract);
  fixture.input.input_version = "controlled-contract-verification-profile-input.v1";
  fixture.input.stable_evaluation = {};
  return fixture;
}

const selectedPack = {
  profile_id: "proof.authorization.refusal-before-effects",
  profile_version: "2.0.0"
};
const requestedIntents = ["controlled-proof-intent.refusal-before-effects"];
const resultShapePack = {
  profile_id: "proof.result-shape.conformance",
  profile_version: "2.0.0"
};
const resultShapeIntents = ["controlled-proof-intent.result-shape-conformance"];
const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../../..");

async function canonicalWk2063Input() {
  const json = async (relativePath) => JSON.parse(await readFile(
    path.join(REPOSITORY_ROOT, relativePath), "utf8"
  ));
  const canonicalRecord = await json("wiki/work-records/WK-2063.json");
  const proofPlanRequest = await json("wiki/contracts/WK-2063.proof-plan-request.json");
  const evaluationInputs = {};
  for (const selected of proofPlanRequest.selected_packs) {
    evaluationInputs[selected.evaluation_input_path] = await json(
      `wiki/contracts/${selected.evaluation_input_path}`
    );
  }
  evaluationInputs["WK-2063.evaluation-input.json"] = await json(
    "wiki/contracts/WK-2063.evaluation-input.json"
  );
  return {
    canonicalRecord,
    contract: await json("wiki/contracts/WK-2063.controlled-acceptance.json"),
    mappingContract: await json("wiki/contracts/WK-2071.controlled-acceptance.json"),
    slices: canonicalRecord.slices,
    proofPlanRequest,
    evaluationInputs,
    focus: null
  };
}

async function canonicalStableWk2063Input() {
  const input = await canonicalWk2063Input();
  const proofPlanRequest = structuredClone(input.proofPlanRequest);
  const [selected] = proofPlanRequest.selected_packs;
  selected.profile_version = "2.0.0";
  const evaluationInputs = structuredClone(input.evaluationInputs);
  const evaluationInput = evaluationInputs[selected.evaluation_input_path];
  evaluationInput.input_version = "controlled-contract-verification-profile-input.v1";
  evaluationInput.stable_evaluation = {};
  const migrate = (contract) => migrateControlledAcceptanceContractV02ToV1({
    contract,
    testProofs: buildStableTestProofPopulation(contract)
  });
  return {
    ...input,
    contract: migrate(input.contract),
    mappingContract: migrate(input.mappingContract),
    proofPlanRequest,
    evaluationInputs
  };
}

function request(overrides = {}) {
  const fixture = stabilizeFixture(buildRefusalBeforeEffectsFixture());
  return {
    contract: fixture.contract,
    selectedPack,
    requestedIntents,
    evaluationInput: fixture.input,
    ...overrides
  };
}

async function testValidityFixture() {
  const json = (url) => readFile(url, "utf8").then(JSON.parse);
  const [base, input] = await Promise.all([
    json(new URL("../examples/minimal-controlled-acceptance-contract-v034.json",
      import.meta.url)),
    json(new URL(
      "../profiles/proof.verification.test-validity/1.0.0/evaluation-input.template.json",
      import.meta.url))
  ]);
  input.verification_id = "claim-suite-covers-component";
  input.test_proof_id = "test-proof-suite-covers-component";
  input.evaluation_stage = "pre_dispatch";
  input.falsifier_executions[0].failure_proposition_id = "prop-component-absent";
  input.falsifier_executions[0].mutation.target_verification_id = input.verification_id;
  const modulePath = "packages/controlled-contract/lib/test-proof-contract.mjs";
  const provider = (provider_id, capability) => ({
    provider_id, provider_version: "1.0.0", capability
  });
  const proof = {
    test_proof_id: input.test_proof_id,
    verification_claim_id: input.verification_id,
    system_under_test_boundary: {
      boundary_id: input.candidate_execution.observed_boundary_id, kind: "module",
      runtime_module_path: modulePath, subject_reference_ids: ["ref-component"]
    },
    observable_result: {
      observable_id: input.candidate_execution.observed_observable_id,
      kind: "return_value", proposition_id: "prop-suite-covers-component"
    },
    candidate_execution_provider: provider("launcher.node-test", "candidate_execution"),
    falsifiers: [{
      falsifier_id: input.falsifier_executions[0].falsifier_id,
      strategy: "dependency_failure", proposition_id: "prop-component-absent",
      expected_outcome: "verification_fails",
      mutation: {
        mutation_id: input.falsifier_executions[0].mutation.mutation_id,
        mechanism: "module_substitution", target_kind: "module", module_path: modulePath
      },
      execution_provider: provider("launcher.node-test-module-fault", "falsifier_execution")
    }],
    traversal_provider: {
      mode: "provider", ...provider("launcher.node-test-v8-coverage", "boundary_traversal"),
      boundary_kind: "module", observation_mechanism: "node_test_v8_coverage",
      observation_seam: "node_test_structured_assertion",
      evidence_artifact_type: "boundary_trace"
    },
    coverage_disposition: {
      baseline_id: "coverage-baseline-package-suite",
      baseline_state: "complete_executed_inventory",
      items: input.test_inventory.declared_test_ids.map((test_id) => ({
        test_id, disposition: "preserved"
      }))
    },
    prohibited_shortcuts: ["source_text_inspection"]
  };
  const { input_version: _inputVersion, evaluation_stage, ...testValidity } = input;
  return {
    contract: migrateControlledAcceptanceContractV02ToV1({
      contract: base, testProofs: [proof]
    }),
    input: {
      input_version: "controlled-contract-verification-profile-input.v1",
      evaluation_stage,
      reference_bindings: [
        { role: "component", reference_ids: ["ref-component"] },
        { role: "suite", reference_ids: ["ref-suite"] }
      ],
      number_bindings: [], claim_pattern_bindings: [], resolver_facts: [],
      delivered_evidence: [], stable_evaluation: { test_validity: [testValidity] }
    }
  };
}

test("builds a complete skeleton from one exact pack and caller bindings", async () => {
  const result = await buildProofAuthoringSkeleton(request());
  assert.equal(result.schema_version, "controlled-contract-proof-authoring-skeleton.v1");
  assert.equal(result.unresolved_required_roles.length, 0);
  assert.equal(result.proof_plan_request.selected_packs.length, 1);
  assert.equal(result.continuation.identity_digest, result.digests.continuation);
  assert.equal("skeleton" in result.continuation.identity, false);
  assert.deepEqual(result.continuation.identity.chosen_bindings, result.evaluation_input);
  const continued = await buildProofAuthoringSkeleton({
    ...request(), continuation: result.continuation
  });
  assert.deepEqual(continued, result);
  const resultBytes = Buffer.byteLength(JSON.stringify(result));
  const continuationBytes = Buffer.byteLength(JSON.stringify(result.continuation));
  assert(continuationBytes < resultBytes);
});

test("builds a stable test-validity skeleton without altering its test-proof population",
  async () => {
    const fixture = await testValidityFixture();
    const before = structuredClone(fixture.contract.test_proofs);
    const result = await buildProofAuthoringSkeleton({
      contract: fixture.contract,
      selectedPack: {
        profile_id: "proof.verification.test-validity",
        profile_version: "2.0.0"
      },
      requestedIntents: ["controlled-proof-intent.test-verification-validity"],
      evaluationInput: fixture.input
    });
    assert.deepEqual(result.evaluation_input_diagnostics, []);
    assert.deepEqual(result.unresolved_required_roles, []);
    assert.equal(result.evaluation_input.evaluation_stage, "pre_dispatch");
    assert.deepEqual(fixture.contract.test_proofs, before);
    assert.equal(Object.hasOwn(before[0], "runtime_test_selection"), false);
    const invalid = structuredClone(fixture.contract);
    invalid.test_proofs[0].candidate_execution_provider.provider_id = "launcher.unknown";
    await assert.rejects(buildProofAuthoringSkeleton({
      contract: invalid,
      selectedPack: {
        profile_id: "proof.verification.test-validity",
        profile_version: "2.0.0"
      },
      requestedIntents: ["controlled-proof-intent.test-verification-validity"],
      evaluationInput: fixture.input
    }), (error) => error.code === "proof_authoring_contract_invalid" &&
      error.details.diagnostics.diagnostics.length > 0);
  });

test("derives a uniquely allowed post-delivery stage on typed bindings", async () => {
  const fixture = stabilizeFixture(buildAuthenticationProvenanceFixture());
  const result = await buildProofAuthoringSkeleton({
    contract: fixture.contract,
    selectedPack: {
      profile_id: "proof.authentication.direct-source-provenance",
      profile_version: "2.0.0"
    },
    requestedIntents: ["controlled-proof-intent.direct-source-authentication-provenance"],
    bindings: Object.fromEntries(Object.entries(fixture.input).filter(([key]) =>
      key !== "evaluation_stage"))
  });
  assert.equal(result.evaluation_input.evaluation_stage, "post_delivery");
});

test("rejects an unsupported typed evaluation stage before resolution", async () => {
  await assert.rejects(
    buildProofAuthoringSkeleton({
      ...request({ bindings: { evaluationStage: "post_delivery" } }),
      evaluationInput: undefined
    }),
    (error) => error instanceof ProofAuthoringSkeletonError &&
      error.code === "proof_authoring_evaluation_stage_invalid"
  );
});

test("rejects an unsupported evaluationInput stage before resolution", async () => {
  await assert.rejects(
    buildProofAuthoringSkeleton({
      ...request({
        evaluationInput: { ...request().evaluationInput, evaluation_stage: "post_delivery" }
      })
    }),
    (error) => error instanceof ProofAuthoringSkeletonError &&
      error.code === "proof_authoring_evaluation_stage_invalid"
  );
});

test("preserves camelCase semantic typed bindings", async () => {
  const fixture = stabilizeFixture(buildRefusalBeforeEffectsFixture());
  const semantic = {
    claimPatternBindings: [{
      pattern_id: "attempt-performs-operation", claim_id: "claim-attempt-performs-operation"
    }],
    resolverFacts: [{
      resolver_kind: "reference-identity", fact_key: "operation", argument_reference_ids: ["ref-operation"], satisfied: true
    }],
    deliveredEvidence: [{
      evidence_kind: "verification-result", verification_claim_id: "claim-attempt-performs-operation", satisfied: true
    }]
  };
  const result = await buildProofAuthoringSkeleton({
    contract: fixture.contract, selectedPack, requestedIntents,
    bindings: {
      evaluationStage: "pre_dispatch",
      referenceBindings: fixture.input.reference_bindings,
      numberBindings: fixture.input.number_bindings,
      ...semantic
    }
  });
  assert.deepEqual(result.evaluation_input.claim_pattern_bindings, semantic.claimPatternBindings);
  assert.deepEqual(result.evaluation_input.resolver_facts, semantic.resolverFacts);
  assert.deepEqual(result.evaluation_input.delivered_evidence, semantic.deliveredEvidence);
});

test("surfaces unknown and duplicate supplied binding diagnostics", async () => {
  const input = structuredClone(request().evaluationInput);
  input.reference_bindings.push({
    role: "unknown_role", reference_ids: ["ref-population"]
  });
  input.reference_bindings.push({
    role: "protected_effect_population", reference_ids: ["ref-protected-effect-population"]
  });
  const result = await buildProofAuthoringSkeleton({ ...request(), evaluationInput: input });
  assert.deepEqual(result.evaluation_input_diagnostics, [
    { code: "duplicate_reference_role_binding", role: "protected_effect_population" },
    { code: "unknown_reference_role_binding", role: "unknown_role" }
  ]);
});

test("omits unsupplied optional zero-cardinality roles despite candidate counts", async () => {
  const dormancyFixture = stabilizeFixture(buildDormancyNonactivationFixture({
    role_id_overrides: { activation_events: ["ref-activation-a"] },
    mutate_input(input) {
      input.reference_bindings = input.reference_bindings.filter(({ role }) =>
        role !== "activation_events");
    }
  }));
  const dormancyInspection = await inspectProofPackBindingsPage({
    contract: dormancyFixture.contract,
    profileId: "proof.dormancy.nonactivation",
    profileVersion: "2.0.0",
    requestedIntents: ["controlled-proof-intent.dormancy-nonactivation"],
    evaluationInput: dormancyFixture.input,
    roles: ["activation_events"], maximumItems: 0
  });
  const activationRole = dormancyInspection.role_index.find(({ role }) =>
    role === "activation_events");
  assert.equal(activationRole.compatible_candidate_count, 1);
  assert.equal(activationRole.status, "one_compatible_candidate");
  const dormancyResult = await buildProofAuthoringSkeleton({
    contract: dormancyFixture.contract,
    selectedPack: {
      profile_id: "proof.dormancy.nonactivation", profile_version: "2.0.0"
    },
    requestedIntents: ["controlled-proof-intent.dormancy-nonactivation"],
    evaluationInput: dormancyFixture.input
  });
  assert.equal(dormancyResult.unresolved_required_roles.some(({ role }) =>
    role === "activation_events"), false);

  const ambiguousDormancyFixture = stabilizeFixture(buildDormancyNonactivationFixture({
    role_id_overrides: {
      activation_events: ["ref-activation-a", "ref-activation-b"]
    },
    mutate_input(input) {
      input.reference_bindings = input.reference_bindings.filter(({ role }) =>
        role !== "activation_events");
    }
  }));
  const ambiguousDormancyInspection = await inspectProofPackBindingsPage({
    contract: ambiguousDormancyFixture.contract,
    profileId: "proof.dormancy.nonactivation",
    profileVersion: "2.0.0",
    requestedIntents: ["controlled-proof-intent.dormancy-nonactivation"],
    evaluationInput: ambiguousDormancyFixture.input,
    roles: ["activation_events"], maximumItems: 0
  });
  const ambiguousActivationRole = ambiguousDormancyInspection.role_index.find(
    ({ role }) => role === "activation_events");
  assert(ambiguousActivationRole.compatible_candidate_count > 1);
  assert.equal(ambiguousActivationRole.status, "ambiguous");
  const ambiguousDormancyResult = await buildProofAuthoringSkeleton({
    contract: ambiguousDormancyFixture.contract,
    selectedPack: {
      profile_id: "proof.dormancy.nonactivation", profile_version: "2.0.0"
    },
    requestedIntents: ["controlled-proof-intent.dormancy-nonactivation"],
    evaluationInput: ambiguousDormancyFixture.input
  });
  assert.equal(ambiguousDormancyResult.unresolved_required_roles.some(({ role }) =>
    role === "activation_events"), false);

  for (const optionalMembers of [
    ["ref-member-note-string", "ref-member-total-number"]
  ]) {
    const fixture = stabilizeFixture(buildResultShapeConformanceFixture({
      role_id_overrides: { optional_members: optionalMembers },
      mutate_input(input) {
        input.reference_bindings = input.reference_bindings.filter(({ role }) =>
          role !== "optional_members");
      }
    }));
    const result = await buildProofAuthoringSkeleton({
      contract: fixture.contract, selectedPack: resultShapePack,
      requestedIntents: resultShapeIntents, evaluationInput: fixture.input
    });
    const inspection = await inspectProofPackBindingsPage({
      contract: fixture.contract, profileId: resultShapePack.profile_id,
      profileVersion: resultShapePack.profile_version,
      requestedIntents: resultShapeIntents, evaluationInput: fixture.input,
      roles: ["optional_members"], maximumItems: 0
    });
    assert.equal(inspection.role_index.find(({ role }) => role === "optional_members").status,
      optionalMembers.length === 1 ? "one_compatible_candidate" : "ambiguous");
    assert.equal(result.unresolved_required_roles.some(({ role }) =>
      role === "optional_members"), false);

    const incompatibleInput = structuredClone(fixture.input);
    incompatibleInput.reference_bindings.push({
      role: "optional_members", reference_ids: ["ref-missing-optional-member"]
    });
    const incompatible = await buildProofAuthoringSkeleton({
      contract: fixture.contract, selectedPack: resultShapePack,
      requestedIntents: resultShapeIntents, evaluationInput: incompatibleInput
    });
    assert.equal(incompatible.unresolved_required_roles.find(({ role }) =>
      role === "optional_members").status, "incompatible");

    const validInput = structuredClone(fixture.input);
    validInput.reference_bindings.push({
      role: "optional_members", reference_ids: [optionalMembers[0]]
    });
    const valid = await buildProofAuthoringSkeleton({
      contract: fixture.contract, selectedPack: resultShapePack,
      requestedIntents: resultShapeIntents, evaluationInput: validInput
    });
    assert.equal(valid.unresolved_required_roles.some(({ role }) =>
      role === "optional_members"), false);
  }
});

test("keeps high-candidate skeleton output bounded and projection-only", async () => {
  const fixture = stabilizeFixture(buildRefusalBeforeEffectsFixture());
  fixture.contract.references.push(...Array.from({ length: 900 }, (_, index) => ({
    reference_id: `ref-high-candidate-${String(index).padStart(4, "0")}`,
    type_term: "cc:scope",
    identity: { kind: "profile_term", term: `capability:high-candidate-${index}` }
  })));
  const input = structuredClone(fixture.input);
  input.reference_bindings = input.reference_bindings.filter(({ role }) =>
    role !== "protected_effect_population");
  const result = await buildProofAuthoringSkeleton({
    contract: fixture.contract, selectedPack, requestedIntents, evaluationInput: input
  });
  assert(Buffer.byteLength(JSON.stringify(result)) < 100_000);
  assert.equal(JSON.stringify(result).includes("compatible_candidates"), false);
  assert.equal(JSON.stringify(result).includes("ref-high-candidate-"), false);
});

test("keeps missing and ambiguous roles unresolved", async () => {
  const input = structuredClone(request().evaluationInput);
  input.reference_bindings = input.reference_bindings.filter(({ role }) =>
    role !== "protected_effect_population");
  const result = await buildProofAuthoringSkeleton({ ...request(), evaluationInput: input });
  assert(result.unresolved_required_roles.some(({ role }) =>
    role === "protected_effect_population"));
});

test("does not choose among multiple compatible candidates", async () => {
  const fixture = stabilizeFixture(buildRefusalBeforeEffectsFixture());
  fixture.contract.references.push({
    reference_id: "ref-another-population",
    type_term: "cc:scope",
    identity: { kind: "profile_term", term: "capability:another-population" }
  });
  const input = structuredClone(fixture.input);
  input.reference_bindings = input.reference_bindings.filter(({ role }) =>
    role !== "protected_effect_population");
  const result = await buildProofAuthoringSkeleton({
    contract: fixture.contract, selectedPack, requestedIntents,
    evaluationInput: input
  });
  const unresolved = result.unresolved_required_roles.find(({ role }) =>
    role === "protected_effect_population");
  assert.equal(unresolved.status, "ambiguous");
});

test("keeps incompatible caller bindings unresolved", async () => {
  const input = structuredClone(request().evaluationInput);
  input.number_bindings[0].value = -1;
  const result = await buildProofAuthoringSkeleton({ ...request(), evaluationInput: input });
  assert.equal(result.unresolved_required_roles.find(({ role }) =>
    role === "protected_effect_count").status, "incompatible");
});

test("a supplied evaluation input must state its own pack-allowed stage", async () => {
  const { evaluation_stage: stage, ...stageless } = request().evaluationInput;
  assert.equal(stage, "pre_dispatch");
  await assert.rejects(
    buildProofAuthoringSkeleton(request({ evaluationInput: stageless })),
    (error) => error instanceof ProofAuthoringSkeletonError &&
      error.code === "proof_authoring_evaluation_stage_unresolved" &&
      error.details.allowed_evaluation_stages.includes("pre_dispatch")
  );
});

test("root, focused, and existing-request authoring compose one request population",
  async () => {
    const otherPack = {
      profile_id: "proof.result-shape.conformance",
      profile_version: "2.0.0",
      evaluation_input_path: "WK-9001-shape.evaluation-input.json"
    };
    const otherIntent = "controlled-proof-intent.result-shape-conformance";
    const root = await buildProofAuthoringSkeleton(request());
    assert.equal(root.focus, null);
    assert.deepEqual(root.proof_plan_request.requested_intents, requestedIntents);
    assert.equal(root.proof_plan_request.selected_packs.length, 1);

    const focused = await buildProofAuthoringSkeleton(request({ focus: "authoring-slice" }));
    assert.equal(focused.focus, "authoring-slice");

    assert.deepEqual(focused.proof_plan_request, root.proof_plan_request);
    assert.deepEqual(focused.evaluation_input, root.evaluation_input);
    assert.notEqual(focused.continuation.identity_digest,
      root.continuation.identity_digest);

    const extended = await buildProofAuthoringSkeleton(request({
      currentProofPlanRequest: {
        schema_version: "controlled-contract-proof-plan-request.v1",
        requested_intents: [otherIntent],
        selected_packs: [otherPack]
      }
    }));

    assert.deepEqual(extended.proof_plan_request.requested_intents,
      [...requestedIntents, otherIntent].sort());
    assert.deepEqual(extended.proof_plan_request.selected_packs.map(
      ({ profile_id: id, evaluation_input_path: path }) => [id, path]), [
      [selectedPack.profile_id, "evaluation-input.json"],
      [otherPack.profile_id, otherPack.evaluation_input_path]
    ]);

    const reauthored = await buildProofAuthoringSkeleton(request({
      currentProofPlanRequest: extended.proof_plan_request
    }));
    assert.deepEqual(reauthored.proof_plan_request, extended.proof_plan_request);

    assert.equal(JSON.stringify(extended.proof_plan_request)
      .includes("protected_interval"), false);
    for (const field of [
      "proposal", "expected_sources", "carrier_operations", "recovery",
      "proof_pack_authoring", "binding_map"
    ]) assert.equal(Object.hasOwn(extended, field), false, field);

    assert.deepEqual([...PROOF_GRAPH_PROPOSAL_FIELDS], [
      "schema_version", "wk_id", "focus", "contract_content_digest",
      "selected_pack", "requested_intents", "skeleton_continuation",
      "carrier_operations"
    ]);
    const proposalFor = (skeleton, overrides = {}) => ({
      schema_version: PROOF_GRAPH_PROPOSAL_SCHEMA_VERSION,
      wk_id: "WK-9001",
      focus: skeleton.focus,
      contract_content_digest: `sha256:${skeleton.digests.contract}`,
      selected_pack: {
        profile_id: skeleton.selected_pack.profile_id,
        profile_version: skeleton.selected_pack.profile_version
      },
      requested_intents: [...skeleton.proof_plan_request.requested_intents],
      skeleton_continuation: {
        continuation: structuredClone(skeleton.continuation),
        unresolved_required_roles:
          structuredClone(skeleton.unresolved_required_roles)
      },
      carrier_operations: [],
      ...overrides
    });
    const admittedFields = [
      ...PROOF_GRAPH_PROPOSAL_FIELDS, "routes", "addressed_carrier_kinds",
      "server_projection", "projection_bytes", "operation_count",
      "carrier_patch_operation_count", "verification_bundle_operation_count"
    ].sort();
    for (const skeleton of [root, focused, extended]) {
      const admitted = validateProofGraphProposal(proposalFor(skeleton));
      assert.equal(admitted.focus, skeleton.focus);
      assert.deepEqual(Object.keys(admitted.server_projection),
        [...PROOF_GRAPH_PROPOSAL_FIELDS]);

      assert.deepEqual(Object.keys(admitted).sort(), admittedFields);
    }

    const routed = validateProofGraphProposal(proposalFor(extended, {
      carrier_operations: [{
        kind: "carrier_patch", carrier_kind: "contract", op: "upsert",
        target: "annotations",
        value: {
          annotation_id: "ann-server-owned-sources", kind: "rationale",
          text: "the source declaration is server-owned"
        }
      }]
    }));
    assert.deepEqual(routed.addressed_carrier_kinds, ["contract"]);
    assert.equal(routed.carrier_patch_operation_count, 1);

    for (const field of ["expected_sources", "expectedSources"]) {
      const declared = proposalFor(root, {
        [field]: [{
          carrier_kind: "contract", presence: "present",
          expected_content_digest: `sha256:${root.digests.contract}`
        }]
      });
      assert.throws(() => validateProofGraphProposal(declared),
        (error) => error instanceof ProofGraphProposalError &&
          error.code === "controlled_contract_proof_graph_proposal_invalid" &&
          error.details.pointer === "" &&
          error.details.unknown.length === 1 &&
          error.details.unknown[0] === field &&
          error.details.missing.length === 0, field);
    }

    for (const [pointer, overrides] of [
      ["/requested_intents/1", {
        requested_intents: [requestedIntents[0], requestedIntents[0]]
      }],
      ["/carrier_operations/0/carrier_kind", {
        carrier_operations: [{ kind: "carrier_patch", carrier_kind: "proof_plan" }]
      }],
      ["/contract_content_digest", { contract_content_digest: "not-a-digest" }]
    ]) {
      assert.throws(() => validateProofGraphProposal(proposalFor(root, overrides)),
        (error) => error instanceof ProofGraphProposalError &&
          error.code === "controlled_contract_proof_graph_proposal_invalid" &&
          error.details.pointer === pointer, pointer);
    }

    const minimalOperations = (count) => Array.from({ length: count }, () => ({
      kind: "carrier_patch", carrier_kind: "contract"
    }));
    assert.throws(() => validateProofGraphProposal(proposalFor(root, {
      carrier_operations: minimalOperations(65)
    })), (error) => error instanceof ProofGraphProposalError &&
      error.code === "controlled_contract_proof_graph_bound_exceeded" &&
      error.details.pointer === "/carrier_operations" &&
      error.details.actual === 65 &&
      error.details.maximum === 64);
    assert.equal(validateProofGraphProposal(proposalFor(root, {
      carrier_operations: minimalOperations(64)
    })).operation_count, 64);
  });

const CONFLICT_DETAILS = Object.freeze({
  canonical_field: "evaluation_stage",
  supplied_aliases: ["evaluation_stage", "evaluationStage"]
});

function typedStageRequest(stage) {
  const fixture = stabilizeFixture(buildRefusalBeforeEffectsFixture());
  return {
    contract: fixture.contract,
    selectedPack,
    requestedIntents,
    bindings: {
      referenceBindings: fixture.input.reference_bindings,
      numberBindings: fixture.input.number_bindings,
      ...stage
    }
  };
}

test("both evaluation-stage aliases refuse as one fact supplied twice", async () => {

  for (const [snake, camel] of [
    ["pre_dispatch", "post_delivery"],
    ["post_delivery", "pre_dispatch"],

    ["pre_dispatch", "pre_dispatch"]
  ]) {
    const request = typedStageRequest({
      evaluation_stage: snake, evaluationStage: camel
    });
    const before = JSON.stringify(request);
    await assert.rejects(buildProofAuthoringSkeleton(request), (error) => {
      assert.ok(error instanceof ProofAuthoringSkeletonError);
      assert.equal(error.code, "proof_authoring_evaluation_stage_conflict");

      assert.deepEqual(error.details, {
        evaluation_stage: snake,
        evaluationStage: camel,
        ...CONFLICT_DETAILS
      });
      assert.deepEqual(Object.keys(error.details), [
        "evaluation_stage", "evaluationStage", "canonical_field",
        "supplied_aliases"
      ]);
      return true;
    });

    assert.equal(JSON.stringify(request), before);
  }
});

test("the stage conflict refuses before any continuation or skeleton exists", async () => {

  const request = typedStageRequest({
    evaluation_stage: "pre_dispatch", evaluationStage: "post_delivery"
  });
  const settled = await buildProofAuthoringSkeleton(request).then(
    (result) => ({ result }), (error) => ({ error }));
  assert.equal(settled.result, undefined,
    "a contradictory stage pair must not produce a skeleton");
  assert.equal(settled.error.code, "proof_authoring_evaluation_stage_conflict");

  const carried = JSON.stringify(settled.error.details);
  for (const field of [
    "continuation", "identity_digest", "contract_digest", "package_version",
    "proof_plan_request", "evaluation_input", "unresolved_required_roles"
  ]) assert.equal(carried.includes(field), false, field);

  const { bindings } = request;
  delete bindings.evaluationStage;
  const issued = await buildProofAuthoringSkeleton(request);
  assert.equal(issued.evaluation_input.evaluation_stage, "pre_dispatch");
  assert.equal(typeof issued.continuation.identity_digest, "string");
});

test("either alias alone canonicalizes to the same evaluation_stage", async () => {
  const [snakeOnly, camelOnly, neither] = await Promise.all([
    buildProofAuthoringSkeleton(typedStageRequest({ evaluation_stage: "pre_dispatch" })),
    buildProofAuthoringSkeleton(typedStageRequest({ evaluationStage: "pre_dispatch" })),

    buildProofAuthoringSkeleton(typedStageRequest({}))
  ]);
  for (const result of [snakeOnly, camelOnly, neither]) {
    assert.equal(result.evaluation_input.evaluation_stage, "pre_dispatch");
    assert.equal(Object.hasOwn(result.evaluation_input, "evaluationStage"), false);
  }

  assert.deepEqual(camelOnly, snakeOnly);
  assert.deepEqual(neither, snakeOnly);

  for (const result of [snakeOnly, camelOnly, neither]) {
    assert.equal(JSON.stringify(result).includes("proof-authoring-stage"), false);
    assert.equal(Object.getOwnPropertySymbols(result.evaluation_input).length, 0);
  }
});

test("a single unsupported stage keeps its own refusal identity", async () => {

  for (const stage of [
    { evaluation_stage: "post_delivery" }, { evaluationStage: "post_delivery" }
  ]) {
    await assert.rejects(buildProofAuthoringSkeleton(typedStageRequest(stage)),
      (error) => error.code === "proof_authoring_evaluation_stage_invalid" &&
        error.details.evaluation_stage === "post_delivery" &&
        error.details.allowed_evaluation_stages.includes("pre_dispatch"));
  }
});

test("rejects stale and tampered continuations", async () => {
  const first = await buildProofAuthoringSkeleton(request());
  const changedContract = structuredClone(request().contract);
  changedContract.references[0].identity.term = "changed:operation";
  await assert.rejects(
    buildProofAuthoringSkeleton(request({
      contract: changedContract,
      continuation: first.continuation
    })),
    (error) => error instanceof ProofAuthoringSkeletonError &&
      error.code === "proof_authoring_continuation_stale"
  );
  const tampered = structuredClone(first.continuation);
  tampered.identity.package_version = "forged";
  await assert.rejects(
    buildProofAuthoringSkeleton(request({ continuation: tampered })),
    (error) => error instanceof ProofAuthoringSkeletonError &&
      error.code === "proof_authoring_continuation_tampered"
  );
});

test("rejects conflicting aliases and malformed continuation identity", async () => {
  await assert.rejects(
    buildProofAuthoringSkeleton({ ...request(), selected_pack: selectedPack }),
    (error) => error instanceof ProofAuthoringSkeletonError &&
      error.code === "proof_authoring_pack_invalid"
  );
  await assert.rejects(
    buildProofAuthoringSkeleton({ ...request(), requested_intents: requestedIntents }),
    (error) => error instanceof ProofAuthoringSkeletonError &&
      error.code === "proof_authoring_input_invalid"
  );
  await assert.rejects(
    buildProofAuthoringSkeleton({ ...request(), continuation: {
      identity_digest: "forged"
    } }),
    (error) => error instanceof ProofAuthoringSkeletonError &&
      error.code === "proof_authoring_continuation_tampered"
  );
});

test("canonical pre-stable integration authoring refuses before constructing artifacts", async () => {
  const input = await canonicalWk2063Input();
  await assert.rejects(buildProofAuthoringSkeleton(input), {
    code: "integration_prefix_contract_invalid"
  });
});

test("authors stable-v1 integration prefixes with the package-owned evaluation input", async () => {
  const input = await canonicalStableWk2063Input();
  const result = await buildProofAuthoringSkeleton(input);
  const evaluationPath = result.proof_plan_request.selected_packs.find(({ profile_id }) =>
    profile_id === "proof.integration.prefix-safety")?.evaluation_input_path;
  assert.ok(evaluationPath);
  assert.deepEqual(result.evaluation_inputs[evaluationPath].stable_evaluation, {});
  assert.equal(result.identity.profile_id, "proof.integration.prefix-safety");
  assert.equal(result.identity.profile_version, "2.0.0");
  assert.equal(result.proof_plan_request.selected_packs.some(({ profile_id, profile_version }) =>
    profile_id === "proof.integration.prefix-safety" && profile_version === "2.0.0"), true);
});

test("canonical integration authoring rejects caller authority and exact focus mismatches", async () => {
  const input = await canonicalWk2063Input();
  await assert.rejects(buildProofAuthoringSkeleton({ ...input, graph: {} }), {
    code: "integration_prefix_authority_forbidden"
  });
  await assert.rejects(buildProofAuthoringSkeleton({ ...input, focus: "other-focus" }), {
    code: "integration_prefix_cross_focus"
  });
  const annotationOnly = structuredClone(input.mappingContract);
  annotationOnly.propositions = annotationOnly.propositions.filter(({ proposition_id: id }) =>
    !id.startsWith("prop-wk2063-map-"));
  await assert.rejects(buildProofAuthoringSkeleton({ ...input, mappingContract: annotationOnly }), {
    code: "integration_prefix_contract_invalid"
  });
});
