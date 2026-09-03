import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTROLLED_CONTRACT_AUTHORING_REASONS,
  CONTROLLED_CONTRACT_AUTHORING_STAGES,
  CONTROLLED_CONTRACT_PROOF_AUTHORING_CONTINUATION,
  deriveControlledContractCarrierValidationRemediation,
  deriveControlledContractAuthoringState
} from "../../packages/wiki-core/src/lib/controlled-contract-authoring-state.mjs";
import { VERIFICATION_BUNDLE_VOCABULARY } from
  "../../packages/controlled-contract/current.mjs";

const CONTINUATION = `sha256:${"a".repeat(64)}`;
const CONTRACT_DIGEST = `sha256:${"b".repeat(64)}`;
const PLAN_DIGEST = `sha256:${"f".repeat(64)}`;
const carrier = (kind, digest, content = {}) => ({
  carrier_kind: kind,
  content_digest: digest,
  content
});
const contract = carrier("contract", CONTRACT_DIGEST, { schema_version: "contract" });
const evaluationInput = { input_version: "input", reference_bindings: [] };
const request = { schema_version: "request", requested_intents: ["intent"], selected_packs: [] };
const evaluation = carrier("evaluation_input", `sha256:${"d".repeat(64)}`, evaluationInput);
const proofRequest = carrier("proof_plan_request", `sha256:${"e".repeat(64)}`, request);
const plan = carrier("proof_plan", PLAN_DIGEST);

const abstractContract = carrier("contract", CONTRACT_DIGEST, {
  schema_version: "contract",
  references: [{ reference_id: "ref-one" }],
  propositions: [{ proposition_id: "prop-two" }, { proposition_id: "prop-one" }],
  claims: [{ claim_id: "claim-behavior", kind: "behavior" },
    { claim_id: "claim-required", kind: "verification" }],
  residue: []
});
const rejectedCandidate = () => ({
  ...structuredClone(abstractContract.content),
  claims: [
    ...structuredClone(abstractContract.content.claims),
    { claim_id: "claim-candidate", kind: "verification", modality: "MUST",
      proposition_id: "prop-one", verification_method: "test_execution",
      falsifying_proposition_id: "prop-two" }
  ],
  test_proofs: []
});
const missingProofDiagnostics = (verificationId = "claim-candidate") => ({
  diagnostic_projection_version: "controlled-contract.bounded-diagnostic-projection.v1",
  diagnostics: [{ code: "stable_test_proof_missing", pointer: "/test_proofs",
    expected_identity: verificationId, actual_identity: "0" }]
});
const record = Object.freeze({
  identity: CONTINUATION,
  wk_id: "WK-2024",
  focus: null,
  contract_content_digest: CONTRACT_DIGEST,
  package_continuation: {
    identity_digest: CONTINUATION,
    contract_digest: `sha256:${"c".repeat(64)}`
  },
  skeleton: {
    contract_digest: `sha256:${"c".repeat(64)}`,
    selected_pack: { profile_id: "proof.test", profile_version: "1.0.0" },
    evaluation_input: evaluationInput,
    proof_plan_request: request
  }
});

test("empty and partial authoring states yield one stage-directed outcome", () => {
  const empty = deriveControlledContractAuthoringState({ wkId: "WK-2024" });
  assert.equal(empty.stage, "contract_required");
  assert.equal(empty.unresolved_decisions.count, 1);
  assert.ok(empty.next_calls);
  assert.deepEqual(empty.next_calls, [{
    tool: "workspace_controlled_contract_authoring_describe",
    arguments: { carrier_kind: "contract" }
  }]);
  assert.equal(Object.hasOwn(empty, "stop_condition"), false);

  const partial = deriveControlledContractAuthoringState({
    wkId: "WK-2024", carriers: { contract }
  });
  assert.equal(partial.stage, "proof_authoring_required");
  assert.deepEqual(partial.unresolved_decisions.identities,
    ["requested_intents", "required_role_bindings", "selected_proof_pack"]);
  assert.equal(partial.selected_resources.contract.content_digest, CONTRACT_DIGEST);

  assert.deepEqual(partial.next_calls,
    [{ tool: "workspace_controlled_proof_intents_discover", arguments: {} }]);
  assert.equal(JSON.stringify(partial).includes("$"), false);
});

test("proof authoring owns exactly the executable discovery continuation", () => {
  const state = deriveControlledContractAuthoringState({
    wkId: "WK-2024", focus: "slice-one", carriers: { contract }
  });

  assert.equal(state.stage, "proof_authoring_required");
  assert.equal(state.next_calls.length, 1);
  assert.deepEqual(state.next_calls[0], {
    tool: "workspace_controlled_proof_intents_discover",
    arguments: {}
  });
  assert.deepEqual(state.next_actions, [
    CONTROLLED_CONTRACT_PROOF_AUTHORING_CONTINUATION
  ]);
  assert.deepEqual(state.next_actions[0], {
    step: "intent_discovery",
    tool: "workspace_controlled_proof_intents_discover",
    purpose: "discover the exact proof intents this contract could bind"
  });
  assert.equal(state.next_actions.length, 1);
  assert.equal(state.next_actions[0].tool, state.next_calls[0].tool);
  assert.deepEqual(Object.keys(state.next_calls[0].arguments), []);
  assert.equal(Object.hasOwn(state.next_calls[0].arguments, "focus"), false);
  assert.equal(Object.hasOwn(state, "stop_condition"), false);
  assert.equal(Object.hasOwn(state, "next_call"), false);
});

test("only proof authoring exposes the reusable presentation continuation", () => {
  const later = deriveControlledContractAuthoringState({
    wkId: "WK-2024", carriers: {
      contract, evaluation_input: evaluation, proof_plan_request: proofRequest
    }
  });
  assert.equal(later.stage, "proof_plan_ready");
  assert.equal(Object.hasOwn(later, "next_actions"), false);
  assert.notEqual(later.next_calls[0].tool,
    CONTROLLED_CONTRACT_PROOF_AUTHORING_CONTINUATION.tool);
});

test("later authoring stages select their own continuation after discovery inputs exist", () => {
  const state = deriveControlledContractAuthoringState({
    wkId: "WK-2024", carriers: {
      contract, evaluation_input: evaluation, proof_plan_request: proofRequest
    }
  });

  assert.equal(state.stage, "proof_plan_ready");
  assert.deepEqual(state.next_calls, [{
    tool: "workspace_controlled_proof_plan_build",
    arguments: { wk_id: "WK-2024", expected_content_digest: null }
  }]);
  assert.notEqual(state.next_calls[0].tool,
    "workspace_controlled_proof_intents_discover");
});

test("accepted continuation advances without retransmitting semantic choices", () => {
  const state = deriveControlledContractAuthoringState({
    wkId: "WK-2024",
    carriers: { contract },
    continuation: CONTINUATION,
    continuationRecord: record
  });
  assert.equal(state.stage, "evaluation_input_ready");
  assert.equal(state.continuation, CONTINUATION);
  assert.deepEqual(state.next_calls[0].arguments, {
    wk_id: "WK-2024", continuation: CONTINUATION,
    expected_stage: "evaluation_input_ready"
  });
  const serialized = JSON.stringify(state.next_calls[0]);
  assert.equal(serialized.includes("reference_bindings"), false);
  assert.equal(serialized.includes("proof.test"), false);
});

test("recoverable direct binding inspection absence emits one bound skeleton call", () => {
  const evaluationPath = "WK-2024.pack-sha256-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc.evaluation-input.json";
  const state = deriveControlledContractAuthoringState({
    wkId: "WK-2024",
    carriers: { contract },
    proofPackAuthoring: {
      status: "recoverable",
      selected_pack: {
        profile_id: "profile.alpha",
        profile_version: "2.0.0",
        evaluation_input_path: evaluationPath
      },
      requested_intents: ["intent"],
      evaluation_input: { input_version: "input", reference_bindings: [] },
      author_semantics: [{ pointer: "/evaluation_input/reference_bindings/0",
        requirement: "choose the reference binding" }]
    }
  });
  assert.equal(state.stage, "evaluation_input_ready");
  assert.equal(state.next_calls.length, 1);
  assert.deepEqual(state.next_calls[0], {
    tool: "workspace_controlled_proof_authoring_skeleton",
    arguments: {
      wk_id: "WK-2024",
      selected_pack: { profile_id: "profile.alpha", profile_version: "2.0.0" },
      requested_intents: ["intent"],
      evaluation_input: { input_version: "input", reference_bindings: [] }
    },
    author_semantics: [{ pointer: "/evaluation_input/reference_bindings/0",
      requirement: "choose the reference binding" }]
  });
  assert.equal(JSON.stringify(state).includes("workspace_controlled_contract_carrier_patch"), false);
  assert.equal(JSON.stringify(state).includes(evaluationPath), false);
});

test("proof prerequisites win over recoverable selected-pack input", () => {
  const recovery = {
    status: "recoverable",
    selected_pack: {
      profile_id: "profile.alpha", profile_version: "2.0.0",
      evaluation_input_path: "server-owned/path.json"
    },
    requested_intents: ["intent"],
    evaluation_input: evaluationInput
  };
  const graph = deriveControlledContractAuthoringState({
    wkId: "WK-2024", carriers: { contract: abstractContract },
    proofPackAuthoring: recovery,
    verificationRequirements: [{ verification_id: "claim-required",
      observed_method: "inspection", state: "verification_graph_required" }]
  });
  assert.equal(graph.stage, "verification_graph_required");
  assert.equal(graph.next_calls[0].tool,
    "workspace_controlled_verification_bundle_patch");
  const proof = deriveControlledContractAuthoringState({
    wkId: "WK-2024", carriers: { contract: abstractContract },
    proofPackAuthoring: recovery,
    verificationRequirements: [{ verification_id: "claim-required",
      observed_method: "test_execution", state: "stable_test_proof_required",
      missing_fields: ["/test_proof/candidate_execution_provider"] }]
  });
  assert.equal(proof.stage, "stable_test_proof_required");
  assert.equal(proof.next_calls[0].tool, "workspace_controlled_test_proof_patch");
});

test("unqualified binding absence keeps the ordinary proof-authoring transition", () => {
  const state = deriveControlledContractAuthoringState({
    wkId: "WK-2024", carriers: { contract },
    proofPackAuthoring: { status: "invalid" }
  });
  assert.equal(state.stage, "proof_authoring_required");
  assert.deepEqual(state.next_calls, [{
    tool: "workspace_controlled_proof_intents_discover", arguments: {}
  }]);
});

test("corrected and complete trajectories preserve selected identities", () => {
  const ready = deriveControlledContractAuthoringState({
    wkId: "WK-2024",
    carriers: { contract, evaluation_input: evaluation, proof_plan_request: proofRequest },
    continuation: CONTINUATION,
    continuationRecord: record
  });
  assert.equal(ready.stage, "proof_plan_ready");
  assert.equal(ready.next_calls[0].tool, "workspace_controlled_proof_plan_build");

  const complete = deriveControlledContractAuthoringState({
    wkId: "WK-2024",
    carriers: { contract, evaluation_input: evaluation,
      proof_plan_request: proofRequest, proof_plan: plan },
    proofPlanBinding: { status: "current", content_digest: PLAN_DIGEST }
  });
  assert.equal(complete.stage, "complete");
  assert.equal(complete.stop_condition, "controlled_contract_authoring_complete");
  assert.equal(Object.hasOwn(complete, "next_calls"), false);
});

test("authoring evidence reports bounded non-authoritative proof readiness", () => {
  const testProofContract = carrier("contract", CONTRACT_DIGEST, {
    schema_version: "controlled-acceptance-contract.v1",
    residue: [],
    test_proofs: [{
      verification_claim_id: "claim-required",
      coverage_disposition: {
        baseline_state: "complete_executed_inventory",
        items: Array.from({ length: 20 }, (_, index) => ({
          test_id: `test-${String(index).padStart(2, "0")}`,
          disposition: "preserved"
        }))
      }
    }]
  });
  const state = deriveControlledContractAuthoringState({
    wkId: "WK-2024", focus: "SLICE-003",
    carriers: { contract: testProofContract }
  });
  const readiness = state.authoring_evidence.proof_execution_readiness;
  assert.equal(state.stage, "proof_authoring_required");
  assert.equal(readiness.status, "not_ready");
  assert.equal(readiness.authority, "non_authorizing_evidence");
  assert.equal(readiness.admissibility_effect, "none");
  assert.deepEqual(state.authoring_evidence.non_authorizing_evidence,
    ["proof_execution_readiness"]);
  const [binding] = readiness.bindings;
  assert.equal(binding.reason, "missing_selection");
  assert.equal(binding.candidate_test_ids.length, 16);
  assert.equal(binding.candidate_total, 20);
  assert.equal(binding.candidate_test_ids_omitted, 4);
  assert.deepEqual(binding.complete_retrieval, {
    tool: "workspace_controlled_test_proof_query",
    arguments: {
      wk_id: "WK-2024", focus: "SLICE-003",
      verification_ids: ["claim-required"]
    }
  });
});

test("required validation identities emit one operation-ready bundle action", () => {
  const graph = deriveControlledContractAuthoringState({
    wkId: "WK-2024",
    carriers: { contract: abstractContract, evaluation_input: evaluation,
      proof_plan_request: proofRequest, proof_plan: plan },
    proofPlanBinding: { status: "current", content_digest: PLAN_DIGEST },
    verificationRequirements: [{ verification_id: "claim-required",
      observed_method: "inspection", required_method: "test_execution",
      state: "verification_graph_required" }]
  });
  assert.equal(graph.stage, "verification_graph_required");
  assert.equal(graph.next_calls.length, 1);
  const [action] = graph.next_calls;
  assert.equal(action.tool, "workspace_controlled_verification_bundle_patch");
  assert.equal(action.arguments.expected_content_digest, CONTRACT_DIGEST);
  assert.equal(action.arguments.operations.length, 1);
  const [operation] = action.arguments.operations;
  assert.equal(operation.op, "upsert");
  assert.equal(operation.verification_id, "claim-required");

  assert.deepEqual(Object.keys(operation.bundle).sort(),
    [...VERIFICATION_BUNDLE_VOCABULARY.required_fields].sort());
  assert.equal(JSON.stringify(operation.bundle).includes("null"), false);
  assert.equal(Object.hasOwn(action, "executable"), false);
  assert.equal(operation.bundle.schema_version,
    VERIFICATION_BUNDLE_VOCABULARY.schema_version);
  assert.deepEqual(operation.bundle.claims, [{
    claim_id: "claim-required", kind: "verification", modality: "MUST",
    verification_method: "test_execution"
  }]);
  assert.equal(operation.bundle.relations[0].role, "verifies");
  assert.equal(operation.bundle.relations[0].source_claim_id, "claim-required");
  assert.equal(operation.bundle.test_proof.candidate_execution_provider.provider_id,
    VERIFICATION_BUNDLE_VOCABULARY.providers.candidate_execution.provider_id);
  assert.equal(operation.bundle.test_proof.traversal_provider.provider_version,
    VERIFICATION_BUNDLE_VOCABULARY.providers.boundary_traversal.provider_version);
  assert.deepEqual(operation.bundle.test_proof.prohibited_shortcuts,
    VERIFICATION_BUNDLE_VOCABULARY.target_types.required_prohibited_shortcuts);

  const holes = new Map(action.author_semantics.map((hole) => [hole.pointer, hole]));
  assert.deepEqual(
    holes.get("/operations/0/bundle/claims/0/proposition_id").compatible_values,
    ["prop-one", "prop-two"]);
  assert.equal(
    holes.get("/operations/0/bundle/claims/0/proposition_id").target_type,
    "proposition_id");
  assert.deepEqual(
    holes.get("/operations/0/bundle/relations/0/target_claim_id").compatible_values,
    ["claim-behavior"]);
  assert.deepEqual(holes.get(
    "/operations/0/bundle/test_proof/system_under_test_boundary/subject_reference_ids"
  ).compatible_values, ["ref-one"]);
  for (const hole of action.author_semantics) {
    assert.equal(typeof hole.requirement, "string");
    assert.equal(JSON.stringify(operation.bundle).includes(`"${hole.pointer}"`), false);
  }
  assert.equal(graph.unresolved_decisions.addressed_verification_id, "claim-required");
  assert.equal(graph.unresolved_decisions.observed_method, "inspection");
  assert.equal(JSON.stringify(graph).includes("workspace_controlled_contract_carrier_patch"),
    false);

  const proof = deriveControlledContractAuthoringState({
    wkId: "WK-2024", carriers: { contract: abstractContract },
    verificationRequirements: [{ verification_id: "claim-required",
      observed_method: "test_execution", required_method: "test_execution",
      state: "stable_test_proof_required",
      missing_fields: ["/test_proof/candidate_execution_provider"] }]
  });
  assert.equal(proof.stage, "stable_test_proof_required");
  assert.equal(proof.next_calls.length, 1);
  assert.equal(proof.next_calls[0].tool, "workspace_controlled_test_proof_patch");
  const binding = proof.next_calls[0].arguments.operations[0].binding;
  assert.equal(binding.verification_claim_id, "claim-required");
  assert.equal(binding.test_proof_id, "test-proof-required");
  assert.equal(binding.system_under_test_boundary.kind, "module");
  assert.equal(JSON.stringify(binding).includes("null"), false);
  assert.deepEqual(proof.unresolved_decisions.missing_fields,
    ["/test_proof/candidate_execution_provider"]);
  assert.equal(JSON.stringify(proof).includes("workspace_controlled_contract_carrier_patch"),
    false);
});

test("rejected candidate diagnostics derive one bounded verification bundle action", () => {
  const action = deriveControlledContractCarrierValidationRemediation({
    wkId: "WK-2176",
    focus: "slice-001",
    expectedContentDigest: CONTRACT_DIGEST,
    candidate: rejectedCandidate(),
    diagnostics: missingProofDiagnostics()
  });
  assert.equal(action.tool, "workspace_controlled_verification_bundle_patch");
  assert.deepEqual(action.arguments, {
    wk_id: "WK-2176",
    focus: "slice-001",
    expected_content_digest: CONTRACT_DIGEST,
    operations: [{
      op: "upsert",
      verification_id: "claim-candidate",
      bundle: action.arguments.operations[0].bundle
    }]
  });
  assert.equal(action.arguments.operations[0].bundle.test_proof.verification_claim_id,
    "claim-candidate");
  assert.equal(action.bundle_schema_version,
    VERIFICATION_BUNDLE_VOCABULARY.schema_version);
  assert.ok(action.author_semantics.length > 0);
  assert.ok(Buffer.byteLength(JSON.stringify(action, null, 2), "utf8") <= 12288);
});

test("candidate remediation omits insufficient, irrelevant, and post-trimming oversize calls", () => {
  const base = {
    wkId: "WK-2176",
    expectedContentDigest: CONTRACT_DIGEST,
    candidate: rejectedCandidate(),
    diagnostics: missingProofDiagnostics()
  };
  assert.equal(deriveControlledContractCarrierValidationRemediation({
    ...base, candidate: null
  }), null);
  assert.equal(deriveControlledContractCarrierValidationRemediation({
    ...base, diagnostics: { diagnostics: [{ code: "stable_family_schema_invalid" }] }
  }), null);
  assert.equal(deriveControlledContractCarrierValidationRemediation({
    ...base, candidate: { ...base.candidate, test_proofs: undefined }
  }), null);

  const oversizedId = `claim-${"x".repeat(7000)}`;
  const oversizedCandidate = rejectedCandidate();
  oversizedCandidate.claims.push({
    claim_id: oversizedId,
    kind: "verification",
    modality: "MUST",
    proposition_id: "prop-one",
    verification_method: "test_execution",
    falsifying_proposition_id: "prop-two"
  });
  assert.equal(deriveControlledContractCarrierValidationRemediation({
    ...base,
    candidate: oversizedCandidate,
    diagnostics: missingProofDiagnostics(oversizedId)
  }), null);
});

test("proof-plan currency, not carrier existence, decides the terminal stage", () => {
  const carriers = { contract, evaluation_input: evaluation,
    proof_plan_request: proofRequest };

  const absent = deriveControlledContractAuthoringState({
    wkId: "WK-2024", carriers,
    proofPlanBinding: { status: "absent", content_digest: null }
  });
  assert.equal(absent.stage, "proof_plan_ready");
  assert.equal(Object.hasOwn(absent, "stop_condition"), false);
  assert.deepEqual(absent.next_calls, [{
    tool: "workspace_controlled_proof_plan_build",
    arguments: { wk_id: "WK-2024", expected_content_digest: null }
  }]);

  for (const status of ["stale", "incomplete"]) {
    const state = deriveControlledContractAuthoringState({
      wkId: "WK-2024", carriers: { ...carriers, proof_plan: plan },
      proofPlanBinding: { status, content_digest: PLAN_DIGEST }
    });
    assert.equal(state.stage, "proof_plan_rebuild_required", status);
    assert.equal(Object.hasOwn(state, "stop_condition"), false, status);
    assert.deepEqual(state.unresolved_decisions, {
      identities: ["proof_plan_compilation"], count: 1,
      changed_input: "canonical_proof_plan_sources",
      proof_plan_source_binding_status: status });
    assert.deepEqual(state.next_calls, [{
      tool: "workspace_controlled_proof_plan_build",
      arguments: { wk_id: "WK-2024", expected_content_digest: PLAN_DIGEST }
    }], status);
    assert.equal(state.selected_resources.proof_plan.content_digest, PLAN_DIGEST, status);
  }

  const unclassified = deriveControlledContractAuthoringState({
    wkId: "WK-2024", carriers: { ...carriers, proof_plan: plan }
  });
  assert.equal(unclassified.stage, "proof_plan_rebuild_required");
});

test("an incomplete selected-pack population is decided without a plan carrier", () => {
  const packs = [
    { profile_id: "profile.alpha", profile_version: "2.0.0",
      evaluation_input_path: "WK-2024.evaluation-input.json" },
    { profile_id: "profile.beta", profile_version: "2.0.0",
      evaluation_input_path: `WK-2024.pack-sha256-${"c".repeat(64)}.evaluation-input.json` }
  ];
  const multiPack = carrier("proof_plan_request", `sha256:${"e".repeat(64)}`,
    { schema_version: "request", requested_intents: ["intent"], selected_packs: packs });
  const carriers = { contract, proof_plan_request: multiPack };
  const planAbsent = { status: "absent", content_digest: null };

  const incomplete = deriveControlledContractAuthoringState({
    wkId: "WK-2024", carriers, proofPlanBinding: planAbsent,
    selectedPackEvaluationInputs: { selected_pack_count: 2, status: "incomplete",
      missing_evaluation_inputs: [packs[1]] }
  });
  assert.equal(incomplete.stage, "evaluation_input_population_incomplete");
  assert.equal(
    JSON.stringify(incomplete).includes("workspace_controlled_proof_plan_build"), false);
  assert.deepEqual(incomplete.next_calls, [{
    tool: "workspace_controlled_contract_carrier_query",
    arguments: { wk_id: "WK-2024", carrier_kind: "proof_plan_request",
      target: "selected_packs" }
  }]);
  assert.deepEqual(incomplete.unresolved_decisions.missing_evaluation_inputs, [packs[1]]);
  assert.equal(incomplete.unresolved_decisions.missing_evaluation_input_count, 1);
  assert.equal(incomplete.unresolved_decisions.missing_evaluation_inputs_omitted, 0);
  assert.equal(incomplete.unresolved_decisions.failed_prerequisite,
    "selected_pack_evaluation_input_absent");

  const complete = deriveControlledContractAuthoringState({
    wkId: "WK-2024", carriers, proofPlanBinding: planAbsent,
    selectedPackEvaluationInputs: { selected_pack_count: 2, status: "complete",
      missing_evaluation_inputs: [] }
  });
  assert.equal(complete.stage, "proof_plan_ready");
  assert.deepEqual(complete.next_calls, [{
    tool: "workspace_controlled_proof_plan_build",
    arguments: { wk_id: "WK-2024", expected_content_digest: null }
  }]);

  const boundIncomplete = deriveControlledContractAuthoringState({
    wkId: "WK-2024", carriers: { ...carriers, proof_plan: plan },
    proofPlanBinding: { status: "incomplete", content_digest: PLAN_DIGEST },
    selectedPackEvaluationInputs: { selected_pack_count: 2, status: "complete",
      missing_evaluation_inputs: [] }
  });
  assert.equal(boundIncomplete.stage, "evaluation_input_population_incomplete");
  assert.equal(boundIncomplete.unresolved_decisions.missing_evaluation_input_count, 0);
});

test("population disclosure stays inside the compact index bound", () => {
  const packs = Array.from({ length: 40 }, (unused, index) => ({
    profile_id: "profile.long.identity.for.a.selected.proof.pack",
    profile_version: "10.20.30",
    evaluation_input_path:
      `WK-2024.pack-sha256-${String(index).padStart(64, "d")}.evaluation-input.json`
  }));
  const state = deriveControlledContractAuthoringState({
    wkId: "WK-2024",
    carriers: {
      contract,
      proof_plan_request: carrier("proof_plan_request", `sha256:${"e".repeat(64)}`,
        { schema_version: "request", requested_intents: ["intent"],
          selected_packs: packs })
    },
    proofPlanBinding: { status: "absent", content_digest: null },
    selectedPackEvaluationInputs: { selected_pack_count: packs.length,
      status: "incomplete", missing_evaluation_inputs: packs }
  });
  const decisions = state.unresolved_decisions;
  assert.equal(decisions.missing_evaluation_input_count, packs.length);

  assert.ok(decisions.missing_evaluation_inputs.length > 0);
  assert.equal(
    decisions.missing_evaluation_inputs.length + decisions.missing_evaluation_inputs_omitted,
    packs.length);
  assert.ok(Buffer.byteLength(JSON.stringify(state, null, 2), "utf8") <= 4096);
});

test("focused and root authoring states do not cross-bind", () => {
  const carriers = { contract, evaluation_input: evaluation,
    proof_plan_request: proofRequest, proof_plan: plan };
  const root = deriveControlledContractAuthoringState({
    wkId: "WK-2024", carriers,
    proofPlanBinding: { status: "stale", content_digest: PLAN_DIGEST }
  });
  const focused = deriveControlledContractAuthoringState({
    wkId: "WK-2024", focus: "slice-one", carriers,
    proofPlanBinding: { status: "current", content_digest: PLAN_DIGEST }
  });
  assert.deepEqual(root.next_calls[0].arguments,
    { wk_id: "WK-2024", expected_content_digest: PLAN_DIGEST });
  assert.equal(Object.hasOwn(root.next_calls[0].arguments, "focus"), false);
  assert.equal(focused.stage, "complete");

  const focusedRebuild = deriveControlledContractAuthoringState({
    wkId: "WK-2024", focus: "slice-one", carriers,
    proofPlanBinding: { status: "stale", content_digest: PLAN_DIGEST }
  });
  assert.deepEqual(focusedRebuild.next_calls[0].arguments,
    { wk_id: "WK-2024", focus: "slice-one", expected_content_digest: PLAN_DIGEST });
});

test("ambiguous decisions remain explicit and unselected", () => {
  const state = deriveControlledContractAuthoringState({
    wkId: "WK-2024", carriers: { contract }
  });
  assert.equal(state.selected_resources.proof_pack, undefined);
  assert.equal(JSON.stringify(state).includes("compatible"), false);
  assert.equal(state.unresolved_decisions.count, 3);
});

test("stale, cross-WK, cross-focus, tampered, and conflicting continuations refuse recoverably", () => {
  const cases = [
    [{ ...record, identity: `sha256:${"1".repeat(64)}` },
      CONTROLLED_CONTRACT_AUTHORING_REASONS.continuationTampered, {}],
    [{ ...record, wk_id: "WK-2014" },
      CONTROLLED_CONTRACT_AUTHORING_REASONS.continuationCrossWk, {}],
    [{ ...record, focus: "other" },
      CONTROLLED_CONTRACT_AUTHORING_REASONS.continuationCrossFocus, {}],
    [{ ...record, contract_content_digest: `sha256:${"2".repeat(64)}` },
      CONTROLLED_CONTRACT_AUTHORING_REASONS.continuationStale, {}],
    [record, CONTROLLED_CONTRACT_AUTHORING_REASONS.continuationCarrierConflict,
      { evaluation_input: carrier("evaluation_input", `sha256:${"3".repeat(64)}`, { other: true }) }]
  ];
  for (const [continuationRecord, reason, extra] of cases) {
    const result = deriveControlledContractAuthoringState({
      wkId: "WK-2024",
      carriers: { contract, ...extra },
      continuation: CONTINUATION,
      continuationRecord
    });
    assert.equal(result.reason_code, reason);
    assert.equal(result.replacement_call.tool,
      "workspace_controlled_contract_authoring_state");
    assert.notDeepEqual(result.replacement_call.arguments,
      { wk_id: "WK-2024", continuation: CONTINUATION });
  }
});

test("published continuation settlement is owned by complete-generation exactness", () => {
  const publishedRecord = Object.freeze({
    ...record,
    proof_graph: Object.freeze({
      status: "published",
      package_generation: undefined,
      result_contract_content_digest: CONTRACT_DIGEST
    })
  });
  const composedRequest = carrier("proof_plan_request", `sha256:${"4".repeat(64)}`, {
    ...request,
    selected_packs: [
      { profile_id: "proof.existing", profile_version: "1.0.0",
        evaluation_input_path: "WK-2024.evaluation-input.json" },
      { profile_id: "proof.test", profile_version: "1.0.0",
        evaluation_input_path: "WK-2024.pack-sha256-new.evaluation-input.json" }
    ]
  });
  const carriers = {
    contract,
    evaluation_input: carrier("evaluation_input", `sha256:${"5".repeat(64)}`,
      { input_version: "existing-pack-input" }),
    proof_plan_request: composedRequest
  };

  const ready = deriveControlledContractAuthoringState({
    wkId: "WK-2024", carriers, continuation: CONTINUATION,
    continuationRecord: publishedRecord, publishedGenerationExact: true,
    selectedPackEvaluationInputs: {
      selected_pack_count: 2, status: "complete", missing_evaluation_inputs: []
    }
  });
  assert.equal(ready.stage, "proof_plan_ready");
  assert.equal(Object.hasOwn(ready, "replacement_call"), false);
  assert.deepEqual(ready.next_calls, [{
    tool: "workspace_controlled_proof_plan_build",
    arguments: { wk_id: "WK-2024", expected_content_digest: null }
  }]);

  for (const publishedGenerationExact of [false, null]) {
    const refused = deriveControlledContractAuthoringState({
      wkId: "WK-2024", carriers, continuation: CONTINUATION,
      continuationRecord: publishedRecord, publishedGenerationExact
    });
    assert.equal(refused.reason_code,
      CONTROLLED_CONTRACT_AUTHORING_REASONS.continuationCarrierConflict);
    assert.deepEqual(refused.details, { carrier_kind: "canonical_generation" });
    assert.deepEqual(refused.replacement_call, {
      tool: "workspace_controlled_contract_authoring_state",
      arguments: { wk_id: "WK-2024" }
    });
  }
});

test("proof_graph_required exposes only bounded identities, pointers, and one executable continuation", () => {
  const proofGraphRecord = Object.freeze({
    ...record,
    proof_graph: Object.freeze({
      status: "incomplete",
      proposal_digest: `sha256:${"9".repeat(64)}`,
      package_generation: undefined,
      expected_sources: [],
      missing_graph_identities: ["contract", "evaluation_input"],
      unresolved_pointers: ["/references/0/identity", "/relations/0/endpoints/1"]
    })
  });
  const state = deriveControlledContractAuthoringState({
    wkId: "WK-2024",
    carriers: { contract },
    continuation: CONTINUATION,
    continuationRecord: proofGraphRecord
  });
  assert.equal(state.stage, "proof_graph_required");
  assert.deepEqual(state.unresolved_decisions, {
    identities: ["contract", "evaluation_input"],
    count: 2,
    semantic_pointers: ["/references/0/identity", "/relations/0/endpoints/1"],
    semantic_pointer_count: 2
  });
  assert.deepEqual(state.next_calls, [{
    tool: "workspace_controlled_contract_proof_graph_continue",
    arguments: { wk_id: "WK-2024", continuation: CONTINUATION }
  }]);
  assert.equal(JSON.stringify(state).includes("proposal"), false);
  assert.equal(CONTROLLED_CONTRACT_AUTHORING_REASONS.proofGraphProposalIncomplete,
    "controlled_contract_proof_graph_proposal_incomplete");
  assert.equal(CONTROLLED_CONTRACT_AUTHORING_REASONS.proofGraphCrossCarrierIdentityConflict,
    "controlled_contract_proof_graph_cross_carrier_identity_conflict");
  assert.equal(CONTROLLED_CONTRACT_AUTHORING_REASONS.proofGraphBoundExceeded,
    "controlled_contract_proof_graph_bound_exceeded");
});
