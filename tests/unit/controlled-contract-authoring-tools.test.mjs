import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ControlledContractToolError,
  classifyControlledContractCarrierBasename,
  classifyControlledContractRepositoryPath,
  clearControlledContractAuthoringContinuationsForTest,
  controlledContractCarrierFilename,
  controlledContractContentDigest,
  controlledContractPackCarrierFilename,
  deriveCanonicalControlledContractAuthoringState,
  getControlledContractAuthoringContinuation,
  readCanonicalProofPlanInputs,
  readControlledContractAuthoringCarriers,
  rememberControlledContractAuthoringContinuation,
  resolveControlledContractAttachmentGeneration,
  resolveControlledContractEvaluationInputBinding,
  resolveControlledContractGeneration,
  resolveControlledContractAuthoringContinuationMutation,
  validateControlledContractAttachmentGenerationDescriptors,
  validateControlledContractGenerationDescriptors,
  describeControlledContractTestProofAuthoring,
  patchControlledContractTestProofBindings,
  patchControlledContractVerificationBundles,
  queryControlledContractTestProofBindings,
  resolveControlledContractTestProofRuntimeBindings
} from "../../packages/wiki-core/src/lib/controlled-contract-tools.mjs";
import {
  classifyControlledContractCarrierBasename as classifyControlledContractCarrierBasenameOwned
} from "../../packages/wiki-core/src/lib/controlled-contract-tool-shared.mjs";
import {
  createControlledContractRefusal,
  patchControlledContractCarrierOperation
} from "../../packages/wiki-core/src/operations/controlled-contract.mjs";
import {
  buildProofAuthoringSkeleton,
  buildProofPlan,
  describeStableTestProofAuthoring
} from "../../packages/controlled-contract/current.mjs";
import { migrateControlledAcceptanceContractV02ToV1 } from
  "../../packages/controlled-contract/lib/stable-v1-migration.mjs";
import {
  assertLauncherTestProofAttemptContext,
  mintLauncherTestProofAttemptContext,
  mintOrchestratorProofAuthority
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-test-proof-runtime-identity.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const CONTINUATION = `sha256:${"a".repeat(64)}`;

async function fixture() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "wk-2024-tools-"));
  const contracts = path.join(repoRoot, "wiki", "contracts");
  await mkdir(contracts, { recursive: true });
  await mkdir(path.join(repoRoot, "wiki", "work-records"), { recursive: true });
  const content = JSON.parse(await readFile(
    path.join(ROOT, "wiki/contracts/WK-2024.controlled-acceptance.json"), "utf8"));
  await writeFile(path.join(contracts, "WK-2024.controlled-acceptance.json"),
    `${JSON.stringify(content, null, 2)}\n`);
  await writeValidWorkRecord(repoRoot);
  return { repoRoot, content };
}

async function writeValidWorkRecord(repoRoot) {
  const record = JSON.parse(await readFile(
    path.join(ROOT, "wiki/work-records/WK-2024.json"), "utf8"));
  record.acceptance.validation = [];
  record.slices = [];
  await writeFile(path.join(repoRoot, "wiki/work-records/WK-2024.json"),
    `${JSON.stringify(record, null, 2)}\n`);
}

async function testProofFixture() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "wk-2024-test-proof-"));
  const contracts = path.join(repoRoot, "wiki", "contracts");
  await mkdir(contracts, { recursive: true });
  await mkdir(path.join(repoRoot, "wiki", "work-records"), { recursive: true });
  const content = JSON.parse(await readFile(path.join(ROOT,
    "packages/controlled-contract/examples/minimal-controlled-acceptance-contract-v034.json"),
  "utf8"));
  await writeFile(path.join(contracts, "WK-2024.controlled-acceptance.json"),
    `${JSON.stringify(content, null, 2)}\n`);
  await writeValidWorkRecord(repoRoot);
  return {repoRoot, content};
}

async function refusalPayload(promise) {
  try {
    await promise;
  } catch (error) {
    return error?.envelope?.warning?.payload ?? null;
  }
  assert.fail("operation should have refused");
}

test("adapter resolves canonical same-WK state and never accepts path authority", async (t) => {
  const { repoRoot } = await fixture();
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const carriers = await readControlledContractAuthoringCarriers({ repoRoot, wkId: "WK-2024" });
  assert.ok(carriers.contract);
  assert.equal(carriers.evaluation_input, null);
  assert.equal(controlledContractCarrierFilename({
    wkId: "WK-2024", focus: null, carrierKind: "evaluation_input"
  }), "WK-2024.evaluation-input.json");
  const state = await deriveCanonicalControlledContractAuthoringState({
    repoRoot, wkId: "WK-2024"
  });
  assert.equal(state.stage, "proof_authoring_required");
  assert.equal(JSON.stringify(state).includes(repoRoot), false);
});

test("adapter stores the validated proposal in its first content-addressed continuation",
  async (t) => {
  const { repoRoot } = await fixture();
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const validContract = await readFile(path.join(
    ROOT, "wiki/contracts/WK-2092.controlled-acceptance.json"));
  await writeFile(path.join(repoRoot,
    "wiki/contracts/WK-2024.controlled-acceptance.json"), validContract);
  const { contract } = await readControlledContractAuthoringCarriers({ repoRoot, wkId: "WK-2024" });
  const evaluationInput = JSON.parse(await readFile(
    path.join(ROOT, "wiki/contracts/WK-2092.evaluation-input.json"), "utf8"));
  const selectedPack = {
    profile_id: "proof.atomicity.failure-boundary",
    profile_version: "2.0.0",
    evaluation_input_path: "WK-2024.evaluation-input.json"
  };
  const requestedIntents = ["controlled-proof-intent.atomic-failure-boundary"];
  const skeleton = await buildProofAuthoringSkeleton({
    contract: contract.content,
    selectedPack,
    requestedIntents,
    evaluationInput
  });
  const proposal = {
    schema_version: "controlled-proof-graph-proposal.v1",
    wk_id: "WK-2024",
    focus: null,
    contract_content_digest: contract.content_digest,
    selected_pack: {
      profile_id: selectedPack.profile_id,
      profile_version: selectedPack.profile_version
    },
    requested_intents: requestedIntents,
    skeleton_continuation: {
      continuation: skeleton.continuation,
      unresolved_required_roles: skeleton.unresolved_required_roles
    },
    carrier_operations: []
  };
  const expectedSources = [
    { carrier_kind: "contract", presence: "present",
      expected_content_digest: contract.content_digest },
    { carrier_kind: "evaluation_input", presence: "absent",
      expected_content_digest: null },
    { carrier_kind: "proof_plan_request", presence: "absent",
      expected_content_digest: null }
  ];
  const record = await rememberControlledContractAuthoringContinuation({
    repoRoot, wkId: "WK-2024", contract, skeleton, proposal, expectedSources
  });
  assert.notEqual(record.identity, CONTINUATION);
  assert.equal(Object.isFrozen(record), true);
  assert.equal(Object.isFrozen(record.skeleton), true);
  assert.equal(Object.isFrozen(record.proof_graph.expected_sources), true);
  assert.equal(record.proof_graph.status, "bound");
  assert.deepEqual(record.proof_graph.proposal, proposal);
  assert.equal(Object.hasOwn(record.proof_graph.proposal, "expected_sources"), false);
  assert.deepEqual(record.proof_graph.expected_sources, expectedSources);
  assert.deepEqual(record.package_continuation, skeleton.continuation);
  assert.equal(record.proof_graph.proposal_digest,
    controlledContractContentDigest(proposal));
  assert.deepEqual((await getControlledContractAuthoringContinuation({
    repoRoot, identity: record.identity
  })).skeleton,
    skeleton);
  const authenticated = structuredClone(record);
  delete authenticated.identity;
  assert.equal(controlledContractContentDigest(authenticated), record.identity);
  const mutation = await resolveControlledContractAuthoringContinuationMutation({
    repoRoot, wkId: "WK-2024", continuation: record.identity
  });
  assert.equal(mutation.mode, "proof_graph");
  assert.deepEqual(mutation.proposal, proposal);
  await assert.rejects(rememberControlledContractAuthoringContinuation({
    repoRoot, wkId: "WK-2024", contract, skeleton, expectedSources,
    proposal: { ...proposal, wk_id: "WK-9999" }
  }), { code: "controlled_contract_authoring_continuation_tampered" });

  for (const [label, conflicting] of [
    ["focus", { focus: "other" }],
    ["contract digest", { contract_content_digest: `sha256:${"c".repeat(64)}` }],
    ["selected pack", { selected_pack: { profile_id: selectedPack.profile_id,
      profile_version: "9.9.9" } }],
    ["requested intents", { requested_intents: [
      "controlled-proof-intent.forbidden-operation-noninvocation"] }],
    ["skeleton continuation", { skeleton_continuation: {
      continuation: { ...skeleton.continuation,
        identity_digest: `sha256:${"d".repeat(64)}` },
      unresolved_required_roles: skeleton.unresolved_required_roles } }],
    ["unresolved roles", { skeleton_continuation: {
      continuation: skeleton.continuation,
      unresolved_required_roles: [{ role: "compound_operation" }] } }]
  ]) {
    await assert.rejects(rememberControlledContractAuthoringContinuation({
      repoRoot, wkId: "WK-2024", contract, skeleton, expectedSources,
      proposal: { ...proposal, ...conflicting }
    }), { code: "controlled_contract_authoring_continuation_tampered" }, label);
  }

  for (const malformed of [expectedSources.slice(0, 1), [], null]) {
    await assert.rejects(rememberControlledContractAuthoringContinuation({
      repoRoot, wkId: "WK-2024", contract, skeleton, proposal,
      ...(malformed === null ? {} : { expectedSources: malformed })
    }), (error) => {
      assert.equal(error.code, "controlled_contract_authoring_continuation_invalid");
      assert.notEqual(error.code,
        "controlled_contract_proof_graph_proposal_incomplete");
      return true;
    });
  }
  const durablePath = path.join(repoRoot, ".agent-runs",
    "controlled-contract-authoring-continuations", "v1",
    `${record.identity.slice("sha256:".length)}.json`);
  const durableBytes = await readFile(durablePath);
  await writeFile(durablePath, "{malformed");
  await assert.rejects(getControlledContractAuthoringContinuation({
    repoRoot, identity: record.identity
  }), { code: "controlled_contract_authoring_continuation_tampered" });
  await writeFile(durablePath, durableBytes);
  assert.equal((await getControlledContractAuthoringContinuation({
    repoRoot, identity: record.identity
  })).identity, record.identity);
  await unlink(durablePath);
  await symlink(path.join(repoRoot, "wiki/contracts/WK-2024.controlled-acceptance.json"),
    durablePath);
  await assert.rejects(getControlledContractAuthoringContinuation({
    repoRoot, identity: record.identity
  }), { code: "controlled_contract_authoring_continuation_tampered" });
  assert.equal(await getControlledContractAuthoringContinuation({
    repoRoot, identity: "../escape"
  }), null);
});

test("invalid continuation is refused before persistence with a replacement call", async (t) => {
  clearControlledContractAuthoringContinuationsForTest();
  const { repoRoot } = await fixture();
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const before = await readControlledContractAuthoringCarriers({ repoRoot, wkId: "WK-2024" });
  const result = await resolveControlledContractAuthoringContinuationMutation({
    repoRoot, wkId: "WK-2024", continuation: CONTINUATION
  });
  assert.equal(result.refused.reason_code,
    "controlled_contract_authoring_continuation_unknown");
  assert.equal(result.refused.replacement_call.tool,
    "workspace_controlled_contract_authoring_state");
  const after = await readControlledContractAuthoringCarriers({ repoRoot, wkId: "WK-2024" });
  assert.deepEqual(after, before);
});

function testProofBinding() {
  return {
    test_proof_id: "test-proof-suite-covers-component",
    verification_claim_id: "claim-suite-covers-component",
    system_under_test_boundary: {boundary_id: "sut-boundary-component", kind: "module",
      runtime_module_path: "packages/controlled-contract/lib/test-proof-contract.mjs",
      subject_reference_ids: ["ref-component"]},
    observable_result: {observable_id: "observable-component", kind: "return_value",
      proposition_id: "prop-suite-covers-component"},
    candidate_execution_provider: {provider_id: "launcher.node-test",
      provider_version: "1.0.0", capability: "candidate_execution"},
    falsifiers: [{falsifier_id: "falsifier-component", strategy: "dependency_failure",
      proposition_id: "prop-component-absent", expected_outcome: "verification_fails",
      mutation: {mutation_id: "mutation-component", mechanism: "module_substitution",
        target_kind: "module", module_path: "packages/controlled-contract/lib/test-proof-contract.mjs"},
      execution_provider: {provider_id: "launcher.node-test-module-fault", provider_version: "1.0.0",
        capability: "falsifier_execution"}}],
    traversal_provider: {mode: "provider", provider_id: "launcher.node-test-v8-coverage",
      provider_version: "1.0.0", capability: "boundary_traversal", boundary_kind: "module",
      observation_mechanism: "node_test_v8_coverage",
      observation_seam: "node_test_structured_assertion", evidence_artifact_type: "boundary_trace"},
    coverage_disposition: {baseline_id: "coverage-baseline-component",
      baseline_state: "complete_executed_inventory",
      items: [{test_id: "test-component", disposition: "preserved"}]},
    prohibited_shortcuts: ["source_text_inspection"]
  };
}

function verificationBundle() {
  const proof = testProofBinding();
  return {
    schema_version: "controlled-contract-verification-bundle.v1",
    verification_id: "claim-suite-exec",
    references: [],
    propositions: [{ proposition_id: "prop-suite-exec",
      subject_reference_id: "ref-suite", operator: "boolean:exists",
      applicability_context: { mode: "unconditional", operand_reference_ids: [] },
      operands: [{ kind: "boolean", value: true }] }],
    claims: [{ claim_id: "claim-suite-exec", kind: "verification", modality: "MUST",
      proposition_id: "prop-suite-exec", verification_method: "test_execution",
      falsifying_proposition_id: "prop-component-absent" }],
    relations: [{ relation_id: "rel-suite-exec-verifies-component", role: "verifies",
      source_claim_id: "claim-suite-exec", target_claim_id: "claim-component-exists" }],
    collections: [], residue: [], annotations: [],
    test_proof: { ...proof, test_proof_id: "test-proof-suite-exec",
      verification_claim_id: "claim-suite-exec",
      observable_result: { ...proof.observable_result, proposition_id: "prop-suite-exec" } }
  };
}

async function writeStructuredValidationRecord(repoRoot, verificationId) {
  const record = {
    schema_version: "work-record.v1", id: "WK-2044",
    repo: "agent-chassis/agent-chassis", title: "Structured validation fixture",
    record_kind: "work_item", work_kind: "implementation", status: "active",
    priority: "high", owner: "unassigned", created: "2026-08-17",
    updated: "2026-08-17", read_scope: [], repo_paths: [], write_scope: [],
    depends_on: [], blocks: [], related: [],
    dispatch_intent: { intended_agent_role: "worker", target_unit: "record",
      requires_graph_impact: false, requires_escalation: false },
    acceptance: { criteria: ["Structured validation is admission compatible."],
      validation: [{ operation: "node_test", target: "fixture.mjs",
        verification_ids: [verificationId] }] },
    sections: { summary: "", why_it_matters: "",
      scope: { items: [], out_of_scope: [] }, tasks: [], references: [],
      agent_notes: "", closure: null },
    children: [], slices: [], escalations: [], projections: [], migration: null,
    derived_evidence: [], initiative: "IN-0001"
  };
  const directory = path.join(repoRoot, "wiki/work-records");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "WK-2044.json"),
    `${JSON.stringify(record, null, 2)}\n`);
}

async function stableGenerationFixture(t) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "wk-2044-v03-generation-"));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const contracts = path.join(repoRoot, "wiki", "contracts");
  await mkdir(contracts, { recursive: true });
  const [base, evaluationInput] = await Promise.all([
    readFile(path.join(ROOT,
      "packages/controlled-contract/examples/minimal-controlled-acceptance-contract-v034.json"),
    "utf8").then(JSON.parse),
    readFile(path.join(ROOT,
      "packages/controlled-contract/profiles/proof.verification.test-validity/2.0.0/evaluation-input.template.json"),
    "utf8").then(JSON.parse)
  ]);
  const binding = testProofBinding();
  const testValidity = evaluationInput.stable_evaluation.test_validity[0];
  evaluationInput.reference_bindings = [
    {role: "component", reference_ids: ["ref-component"]},
    {role: "suite", reference_ids: ["ref-suite"]}
  ];
  testValidity.verification_id = binding.verification_claim_id;
  testValidity.test_proof_id = binding.test_proof_id;
  testValidity.candidate_execution.observed_boundary_id =
    binding.system_under_test_boundary.boundary_id;
  testValidity.candidate_execution.observed_observable_id = binding.observable_result.observable_id;
  testValidity.boundary_traversal.boundary_id = binding.system_under_test_boundary.boundary_id;
  testValidity.boundary_traversal.observable_id = binding.observable_result.observable_id;
  testValidity.falsifier_executions[0].falsifier_id = binding.falsifiers[0].falsifier_id;
  testValidity.falsifier_executions[0].failure_proposition_id =
    binding.falsifiers[0].proposition_id;
  testValidity.falsifier_executions[0].mutation.mutation_id =
    binding.falsifiers[0].mutation.mutation_id;
  testValidity.falsifier_executions[0].mutation.target_verification_id =
    binding.verification_claim_id;
  for (const field of ["declared_test_ids", "baseline_executed_test_ids"]) {
    testValidity.test_inventory[field] = ["test-component"];
  }
  testValidity.test_inventory.observed_tests = [{ test_id: "test-component", status: "passed" }];
  const contract = migrateControlledAcceptanceContractV02ToV1({
    contract: base, testProofs: [binding]
  });
  const evaluationPath = "WK-2044.evaluation-input.json";
  const request = {
    schema_version: "controlled-contract-proof-plan-request.v1",
    requested_intents: ["controlled-proof-intent.test-verification-validity"],
    selected_packs: [{ profile_id: "proof.verification.test-validity",
      profile_version: "2.0.0", evaluation_input_path: evaluationPath }]
  };
  const plan = await buildProofPlan({
    contract, request, evaluationInputs: { [evaluationPath]: evaluationInput }
  });
  for (const [carrierKind, content] of Object.entries({
    contract, evaluation_input: evaluationInput, proof_plan_request: request, proof_plan: plan
  })) await writeFile(path.join(contracts, controlledContractCarrierFilename({
    wkId: "WK-2044", carrierKind
  })), `${JSON.stringify(content, null, 2)}\n`);
  await writeStructuredValidationRecord(repoRoot, "claim-suite-covers-component");
  return { repoRoot, contract, evaluationInput, request, plan };
}

function descriptorWithContent(descriptor, content) {
  const bytes = Buffer.from(`${JSON.stringify(content, null, 2)}\n`, "utf8");
  return { ...structuredClone(descriptor),
    content_digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    byte_length: bytes.byteLength,
    bytes_base64: bytes.toString("base64") };
}

test("test-proof authoring is package-derived, selective, and stable-only", async (t) => {
  const { repoRoot, content } = await testProofFixture();
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  assert.deepEqual(await describeControlledContractTestProofAuthoring(),
    describeStableTestProofAuthoring());
  const description = await describeControlledContractTestProofAuthoring();
  assert.deepEqual(description.operations,
    ["query", "replace", "verification_bundle_patch"]);
  assert.equal(description.provider_registry.providers.length, 3);
  await assert.rejects(() => queryControlledContractTestProofBindings({
    repoRoot, wkId: "WK-2024", verificationIds: ["claim-suite-covers-component"]
  }), ({code}) => code === "stable_family_partial_state");

  const migrated = migrateControlledAcceptanceContractV02ToV1({
    contract: content, testProofs: [testProofBinding()]
  });
  await writeFile(path.join(repoRoot, "wiki/contracts/WK-2024.controlled-acceptance.json"),
    `${JSON.stringify(migrated, null, 2)}\n`);
  const selected = await queryControlledContractTestProofBindings({
    repoRoot, wkId: "WK-2024", verificationIds: ["claim-suite-covers-component"]
  });
  assert.equal(selected.status, "complete");
  assert.equal(selected.matched_count, 1);
  assert.equal(selected.bindings[0].candidate_execution_provider.provider_id,
    "launcher.node-test");
  assert.equal(Object.hasOwn(selected, "content"), false);
  assert.equal(selected.bindings[0].test_proof_id,
    "test-proof-suite-covers-component");
  assert.match(selected.controlled_contract_generation, /^sha256:[a-f0-9]{64}$/u);
  assert.notEqual(selected.controlled_contract_generation, selected.content_digest);
  assert.equal(selected.controlled_contract_generation_schema_version,
    "controlled-contract-generation.v1");
  assert.equal(Object.hasOwn(selected, "controlled_contract_generation_carriers"), false);
  const runtimeSelection = await resolveControlledContractTestProofRuntimeBindings({
    repoRoot, wkId: "WK-2024", verificationIds: ["claim-suite-covers-component"]
  });
  assert.deepEqual(runtimeSelection.controlled_contract_generation_carriers, [{
    filename: "WK-2024.controlled-acceptance.json",
    content_digest: selected.content_digest,
    source_member: {
      schema_version: "controlled-contract-authenticated-runtime-member.v1",
      storage_mode: "legacy_root",
      logical_filename: "WK-2024.controlled-acceptance.json",
      repository_relative_path: "wiki/contracts/WK-2024.controlled-acceptance.json",
      content_digest: selected.content_digest,
      manifest_generation: null,
      manifest_content_digest: null
    }
  }]);
});

test("test-proof patch refuses stale, unknown, and invalid state before CAS", async (t) => {
  const { repoRoot, content } = await testProofFixture();
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const migrated = migrateControlledAcceptanceContractV02ToV1({
    contract: content, testProofs: [testProofBinding()]
  });
  const file = path.join(repoRoot, "wiki/contracts/WK-2024.controlled-acceptance.json");
  await writeFile(file, `${JSON.stringify(migrated, null, 2)}\n`);
  const selected = await queryControlledContractTestProofBindings({
    repoRoot, wkId: "WK-2024", verificationIds: ["claim-suite-covers-component"]
  });
  await assert.rejects(() => patchControlledContractTestProofBindings({
    repoRoot, wkId: "WK-2024", expectedContentDigest: `sha256:${"0".repeat(64)}`,
    operations: [{op: "replace", verification_id: "claim-suite-covers-component",
      binding: testProofBinding()}]
  }), ({ code }) => code === "controlled_contract_stale_content_digest");
  await assert.rejects(() => patchControlledContractTestProofBindings({
    repoRoot, wkId: "WK-2024", expectedContentDigest: selected.content_digest,
    operations: [{op: "replace", verification_id: "claim-unknown",
      binding: {...testProofBinding(), verification_claim_id: "claim-unknown"}}]
  }), ({ code }) => code === "stable_test_proof_replacement_target_missing");
  const tampered = structuredClone(migrated);
  tampered.test_proofs[0].falsifiers = [];
  await writeFile(file, `${JSON.stringify(tampered, null, 2)}\n`);
  await assert.rejects(() => queryControlledContractTestProofBindings({
    repoRoot, wkId: "WK-2024", verificationIds: ["claim-suite-covers-component"]
  }), ({ code }) => code === "stable_test_proof_contract_invalid");
});

test("verification-bundle adapter resolves the canonical carrier and writes once by digest CAS", async (t) => {
  const { repoRoot } = await stableGenerationFixture(t);
  const selected = await queryControlledContractTestProofBindings({
    repoRoot, wkId: "WK-2044", verificationIds: ["claim-suite-covers-component"]
  });
  const bundle = verificationBundle();
  const added = await patchControlledContractVerificationBundles({
    repoRoot, wkId: "WK-2044", expectedContentDigest: selected.content_digest,
    operations: [{ op: "upsert", verification_id: bundle.verification_id, bundle }]
  });
  assert.equal(added.written, true);
  assert.deepEqual(added.changed_verification_ids, [bundle.verification_id]);
  const exact = await patchControlledContractVerificationBundles({
    repoRoot, wkId: "WK-2044", expectedContentDigest: added.content_digest,
    operations: [{ op: "upsert", verification_id: bundle.verification_id, bundle }]
  });
  assert.equal(exact.no_op, true);
  const removed = await patchControlledContractVerificationBundles({
    repoRoot, wkId: "WK-2044", expectedContentDigest: exact.content_digest,
    operations: [{ op: "remove", verification_id: bundle.verification_id, bundle }]
  });
  assert.equal(removed.written, true);
  assert.equal(removed.content_digest, selected.content_digest);
});

test("canonical authoring state classifies inspection graphs and missing stable proofs early", async (t) => {
  const { repoRoot, contract } = await stableGenerationFixture(t);
  const verificationId = "claim-suite-covers-component";
  await writeStructuredValidationRecord(repoRoot, verificationId);
  const file = path.join(repoRoot, "wiki/contracts/WK-2044.controlled-acceptance.json");

  const inspection = structuredClone(contract);
  inspection.claims.find(({ claim_id: id }) => id === verificationId)
    .verification_method = "inspection";
  inspection.test_proofs = [];
  await writeFile(file, `${JSON.stringify(inspection, null, 2)}\n`);
  const graphState = await deriveCanonicalControlledContractAuthoringState({
    repoRoot, wkId: "WK-2044"
  });
  assert.equal(graphState.stage, "verification_graph_required");
  assert.equal(graphState.unresolved_decisions.observed_method, "inspection");
  assert.equal(graphState.next_calls.length, 1);
  const [graphAction] = graphState.next_calls;
  assert.equal(graphAction.tool, "workspace_controlled_verification_bundle_patch");

  assert.equal(graphAction.arguments.wk_id, "WK-2044");
  assert.equal(typeof graphAction.arguments.expected_content_digest, "string");
  assert.equal(JSON.stringify(graphAction.arguments).includes("null"), false);
  assert.equal(Object.hasOwn(graphAction, "executable"), false);
  assert.ok(graphAction.author_semantics.length > 0);
  for (const hole of graphAction.author_semantics) {
    assert.match(hole.pointer, /^\/operations\/0\/bundle\//u);
    assert.equal(typeof hole.target_type, "string");
  }

  const missing = structuredClone(contract);
  missing.test_proofs = [];
  await writeFile(file, `${JSON.stringify(missing, null, 2)}\n`);
  const proofState = await deriveCanonicalControlledContractAuthoringState({
    repoRoot, wkId: "WK-2044"
  });
  assert.equal(proofState.stage, "stable_test_proof_required");
  assert.deepEqual(proofState.next_calls.map(({ tool }) => tool),
    ["workspace_controlled_test_proof_patch"]);
  const [proofAction] = proofState.next_calls;
  assert.equal(proofAction.arguments.operations[0].op, "replace");
  assert.equal(JSON.stringify(proofAction.arguments).includes("null"), false);
  assert.equal(Object.hasOwn(proofAction, "executable"), false);
  assert.ok(proofAction.author_semantics.every(({ pointer }) =>
    pointer.startsWith("/operations/0/binding/")));
});

test("rejected contract candidate carries its canonical bundle repair through refusal", async (t) => {
  const { repoRoot } = await stableGenerationFixture(t);
  const carrier = await readControlledContractAuthoringCarriers({
    repoRoot, wkId: "WK-2044"
  }).then(({ contract: value }) => value);
  const bundle = verificationBundle();
  const payload = await refusalPayload(patchControlledContractCarrierOperation({
    repoRoot,
    wkId: "WK-2044",
    carrierKind: "contract",
    expectedContentDigest: carrier.content_digest,
    operations: [
      ...bundle.propositions.map((value) => ({
        op: "upsert", target: "propositions", id: value.proposition_id, value
      })),
      ...bundle.claims.map((value) => ({
        op: "upsert", target: "claims", id: value.claim_id, value
      })),
      ...bundle.relations.map((value) => ({
        op: "upsert", target: "relations", id: value.relation_id, value
      }))
    ]
  }));
  assert.equal(payload.reason_code, "controlled_contract_carrier_validation_failed");
  assert.deepEqual(payload.details.diagnostics.diagnostics.map(({ code }) => code),
    ["stable_test_proof_missing"]);
  const action = payload.details.replacement_call;
  assert.equal(action.tool, "workspace_controlled_verification_bundle_patch");
  assert.equal(action.arguments.expected_content_digest, carrier.content_digest);
  assert.equal(action.arguments.operations[0].verification_id, bundle.verification_id);
  assert.equal(action.arguments.operations[0].bundle.test_proof.verification_claim_id,
    bundle.verification_id);
  assert.ok(action.author_semantics.every(({ pointer }) =>
    pointer.startsWith("/operations/0/bundle/")));
});

test("refusal projection preserves a canonical replacement call unchanged", () => {
  const replacementCall = {
    tool: "workspace_controlled_verification_bundle_patch",
    arguments: {
      wk_id: "WK-2176",
      expected_content_digest: `sha256:${"b".repeat(64)}`,
      operations: [{ op: "upsert", verification_id: "claim-candidate",
        bundle: { caller_owned_path: "/caller-owned/module.mjs" } }]
    },
    author_semantics: [{
      pointer: "/operations/0/bundle/caller_owned_path",
      target_type: "repo_module_path",
      compatible_values: ["/caller-owned/module.mjs"]
    }]
  };
  const projected = createControlledContractRefusal(new ControlledContractToolError(
    "controlled_contract_carrier_validation_failed",
    "contract failed package validation",
    { replacement_call: replacementCall }
  ));
  assert.deepEqual(projected.envelope.warning.payload.details.replacement_call,
    replacementCall);
});

test("stable generation validates and preserves distinct association and family refusals",
  async (t) => {
    const fixture = await stableGenerationFixture(t);
    const generation = await resolveControlledContractGeneration({
      repoRoot: fixture.repoRoot, wkId: "WK-2044"
    });
    assert.equal(generation.count, 4);
    const validate = (descriptors) => validateControlledContractGenerationDescriptors({
      wkId: "WK-2044", descriptors: descriptors.sort((left, right) =>
        left.path.localeCompare(right.path))
    });

    const stalePlan = structuredClone(fixture.plan);
    stalePlan.requested_intents = [];
    await assert.rejects(() => validate(generation.descriptors.map((descriptor) =>
      descriptor.carrier_kind === "proof_plan"
        ? descriptorWithContent(descriptor, stalePlan) : structuredClone(descriptor)
    )), (error) => error.code === "controlled_contract_generation_invalid" &&
      /persisted proof plan is stale/u.test(error.message));

    await assert.rejects(() => validate(generation.descriptors.filter(
      ({ carrier_kind: carrierKind }) => carrierKind !== "evaluation_input"
    ).map((descriptor) => structuredClone(descriptor))),
    (error) => error.code === "controlled_contract_generation_invalid" &&
      error.details.cause_code === "proof_plan_request_missing_inputs");

    const crossPackRequest = structuredClone(fixture.request);
    crossPackRequest.selected_packs[0].evaluation_input_path =
      controlledContractPackCarrierFilename({ wkId: "WK-2044",
        profileId: "proof.operation.forbidden-noninvocation", profileVersion: "1.0.0" });
    await assert.rejects(() => validate(generation.descriptors.map((descriptor) =>
      descriptor.carrier_kind === "proof_plan_request"
        ? descriptorWithContent(descriptor, crossPackRequest) : structuredClone(descriptor)
    )), (error) => error.code === "controlled_contract_generation_invalid" &&
      /pack evaluation input identity is mismatched/u.test(error.message));

    const partial = structuredClone(fixture.contract);
    delete partial.test_proof_version;
    await assert.rejects(() => validate(generation.descriptors.map((descriptor) =>
      descriptor.carrier_kind === "contract"
        ? descriptorWithContent(descriptor, partial) : structuredClone(descriptor)
    )), (error) => error.code === "controlled_contract_generation_invalid" &&
      error.details.contract_family === "partial" &&
      error.details.diagnostics.diagnostics.some(({ code }) =>
        code === "stable_family_partial_state"));

    const invalid = structuredClone(fixture.contract);
    delete invalid.test_proofs[0].candidate_execution_provider;
    await assert.rejects(() => validate(generation.descriptors.map((descriptor) =>
      descriptor.carrier_kind === "contract"
        ? descriptorWithContent(descriptor, invalid) : structuredClone(descriptor)
    )), (error) => error.code === "controlled_contract_generation_invalid" &&
      error.details.contract_family === "stable_v1" &&
      error.details.diagnostics.diagnostics.length > 0 &&
      error.details.diagnostics.diagnostics.every((diagnostic) =>
        typeof diagnostic.code === "string" || typeof diagnostic.keyword === "string"));

    const unknown = structuredClone(fixture.contract);
    unknown.schema_version = "controlled-acceptance-contract.unknown";
    unknown.profile_id = "acceptance-contract.standard.unknown";
    await assert.rejects(() => validate(generation.descriptors.map((descriptor) =>
      descriptor.carrier_kind === "contract"
        ? descriptorWithContent(descriptor, unknown) : structuredClone(descriptor)
    )), (error) => error.code === "controlled_contract_generation_invalid" &&
      error.details.contract_family === "unknown" &&
      error.details.diagnostics.diagnostics.length > 0);
  });

test("attachment validation preserves proof-semantic degradation as advisory evidence", async (t) => {
  const fixture = await stableGenerationFixture(t);
  const generation = await resolveControlledContractGeneration({
    repoRoot: fixture.repoRoot, wkId: "WK-2044"
  });
  const stalePlan = structuredClone(fixture.plan);
  stalePlan.requested_intents = [];
  const unsupportedContract = structuredClone(fixture.contract);
  unsupportedContract.schema_version = "controlled-acceptance-contract.unknown";
  unsupportedContract.profile_id = "acceptance-contract.standard.unknown";
  const populations = [
    generation.descriptors.filter(({ carrier_kind: carrierKind }) =>
      carrierKind !== "evaluation_input"),
    generation.descriptors.map((descriptor) => descriptor.carrier_kind === "proof_plan"
      ? descriptorWithContent(descriptor, stalePlan) : structuredClone(descriptor)),
    generation.descriptors.map((descriptor) => descriptor.carrier_kind === "contract"
      ? descriptorWithContent(descriptor, unsupportedContract) : structuredClone(descriptor))
  ];
  for (const descriptors of populations) {
    const attached = await validateControlledContractAttachmentGenerationDescriptors({
      wkId: "WK-2044",
      descriptors: descriptors.sort((left, right) => left.path.localeCompare(right.path))
    });
    assert.equal(attached.count, descriptors.length);
    assert.match(attached.generation_digest, /^sha256:[a-f0-9]{64}$/u);
  }

  await writeFile(path.join(fixture.repoRoot, "wiki/contracts",
    controlledContractCarrierFilename({ wkId: "WK-2044", carrierKind: "proof_plan" })),
  `${JSON.stringify(stalePlan, null, 2)}\n`);
  await assert.rejects(() => resolveControlledContractGeneration({
    repoRoot: fixture.repoRoot,
    wkId: "WK-2044"
  }), (error) => error.code === "controlled_contract_generation_invalid" &&
    /persisted proof plan is stale/u.test(error.message));
  const staleAttachment = await resolveControlledContractAttachmentGeneration({
    repoRoot: fixture.repoRoot,
    wkId: "WK-2044"
  });
  assert.equal(staleAttachment.count, generation.count);

  const identityMismatch = structuredClone(generation.descriptors);
  identityMismatch[0].path = "wiki/contracts/WK-9999.controlled-acceptance.json";
  await assert.rejects(() => validateControlledContractAttachmentGenerationDescriptors({
    wkId: "WK-2044",
    descriptors: identityMismatch
  }), (error) => error.code === "controlled_contract_attachment_invalid");
});

test("shared carrier-basename classifier has exhaustive generator parity", () => {
  const wkId = "WK-2044";
  for (const focus of [null, "focused-proof"]) {
    for (const carrierKind of ["contract", "evaluation_input", "proof_plan_request", "proof_plan"]) {
      const basename = controlledContractCarrierFilename({ wkId, focus, carrierKind });
      assert.deepEqual(classifyControlledContractCarrierBasename({ wkId, basename }), {
        schema_version: "controlled-contract-carrier-basename-classification.v1",
        classification: "active_member",
        member: true,
        wk_id: wkId,
        basename,
        carrier_kind: carrierKind,
        focus,
        pack_namespace: null,
        pack_digest: null
      });
    }
    const basename = controlledContractPackCarrierFilename({
      wkId,
      focus,
      profileId: "proof.operation.forbidden-noninvocation",
      profileVersion: "1.0.0"
    });
    const classified = classifyControlledContractCarrierBasename({ wkId, basename });
    assert.equal(classified.member, true);
    assert.equal(classified.carrier_kind, "evaluation_input");
    assert.equal(classified.focus, focus);
    assert.match(classified.pack_namespace, /^pack-sha256-[0-9a-f]{64}$/);
    assert.match(classified.pack_digest, /^[0-9a-f]{64}$/);
  }

  const negativeBasenames = [
    ["WK-2044-.evaluation-input.json", "malformed_active_candidate"],
    ["WK-2044.FOCUS.evaluation-input.json", "malformed_active_candidate"],
    ["wk-2044.evaluation-input.json", "unsupported_nonmember"],
    ["WK-2044-Focus.evaluation-input.json", "malformed_active_candidate"],
    ["WK-20440.evaluation-input.json", "unsupported_nonmember"],
    [`WK-2044.pack-sha256-${"A".repeat(64)}.evaluation-input.json`,
      "malformed_active_candidate"],
    [`WK-2044.pack-sha256-${"a".repeat(63)}.evaluation-input.json`,
      "malformed_active_candidate"],
    [`WK-2044.pack-sha256-${"a".repeat(64)}.proof-plan.json`,
      "malformed_active_candidate"],
    ["WK-2044.unknown.json", "unsupported_nonmember"],
    ["WK-2044.evaluation-input.json.extra", "unsupported_nonmember"],
    ["subdir/WK-2044.controlled-acceptance.json", "malformed_active_candidate"]
  ];
  for (const [basename, classification] of negativeBasenames) {
    const classified = classifyControlledContractCarrierBasename({ wkId, basename });
    assert.equal(classified.member, false, `${basename} must not enter the canonical union`);
    assert.equal(classified.classification, classification, basename);
  }
});

test("shared carrier classifier closes repository paths without suffix or applicability inference", () => {
  const wkId = "WK-2054";
  const active = "wiki/contracts/WK-2054.controlled-acceptance.json";
  const cases = [
    [active, "active_member", false, true],
    ["wiki/contracts/WK-2054.evaluation-input.json", "active_member", false, true],
    ["wiki/contracts/WK-2054.obligation-coverage.json", "unsupported_nonmember", true, true],
    ["wiki/contracts/WK-2054.bad.controlled-acceptance.json",
      "malformed_active_candidate", false, true],
    ["wiki/contracts/WK-2054.bad.evaluation-input.json",
      "malformed_active_candidate", false, true],
    ["wiki/contracts/nested/WK-2054.controlled-acceptance.json",
      "unsupported_nonmember", true, false],
    ["wiki/contracts/.carrier-generations/" + "a".repeat(64) +
      "/WK-2054.controlled-acceptance.json", "unsupported_nonmember", true, false],
    ["wiki/sources/WK-2054.controlled-acceptance.json", "unsupported_nonmember", true, false],
    ["wiki/contracts/WK-2054\\controlled-acceptance.json",
      "unsupported_nonmember", true, true]
  ];

  for (const [repositoryPath, classification, accumulated, active] of cases) {
    const result = classifyControlledContractRepositoryPath({ wkId, repositoryPath });
    assert.equal(result.classification, classification, repositoryPath);
    assert.equal(result.accumulated, accumulated, repositoryPath);
    assert.equal(result.active, active, repositoryPath);
  }
  assert.strictEqual(
    classifyControlledContractCarrierBasename,
    classifyControlledContractCarrierBasenameOwned,
    "public classifier must be the package-owned binding"
  );

  const malformed = classifyControlledContractRepositoryPath({
    wkId, repositoryPath: "wiki/contracts/WK-2054.bad.controlled-acceptance.json"
  });
  assert.equal(malformed.reason, "unexpected_namespace");
  assert.equal(malformed.accumulated, false,
    "diagnostic reason must not make a malformed active candidate accumulated");
});

async function generationFixture(t, count) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "wk-2044-generation-"));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const contracts = path.join(repoRoot, "wiki", "contracts");
  await mkdir(contracts, { recursive: true });
  const base = JSON.parse(await readFile(path.join(ROOT,
    "packages/controlled-contract/examples/minimal-controlled-acceptance-contract-v034.json")));
  const stable = migrateControlledAcceptanceContractV02ToV1({
    contract: base, testProofs: [testProofBinding()]
  });
  const bytes = Buffer.from(`${JSON.stringify(stable, null, 2)}\n`);
  const focuses = [null, ...Array.from({ length: count - 1 }, (_, index) => `focus-${index + 1}`)];
  for (const focus of focuses) {
    await writeFile(path.join(contracts, controlledContractCarrierFilename({
      wkId: "WK-2044", focus, carrierKind: "contract"
    })), bytes);
  }
  return { repoRoot, contracts };
}

for (const count of [1, 4, 9]) {
  test(`complete generation resolver has no cardinality branch at N=${count}`, async (t) => {
    const { repoRoot } = await generationFixture(t, count);
    const generation = await resolveControlledContractGeneration({ repoRoot, wkId: "WK-2044" });
    assert.equal(generation.count, count);
    assert.equal(generation.descriptors.length, count);
    assert.ok(Object.isFrozen(generation));
    assert.ok(Object.isFrozen(generation.descriptors));
    assert.deepEqual(generation.descriptors.map((descriptor) => descriptor.path),
      [...generation.descriptors.map((descriptor) => descriptor.path)].sort());
  });
}

test("historical WK-2044 carriers refuse before stable generation projection", async () => {
  await assert.rejects(() => resolveControlledContractGeneration({
    repoRoot: ROOT, wkId: "WK-2044"
  }), (error) => error.code === "controlled_contract_generation_invalid" &&
    error.details.contract_family === "partial");
});

test("generation descriptor validation refuses partial, additional, duplicate, unsorted, cross-WK, omitted, and digest-mismatched populations", async (t) => {
  const fixture = await stableGenerationFixture(t);
  const generation = await resolveControlledContractGeneration({
    repoRoot: fixture.repoRoot, wkId: "WK-2044"
  });
  const variants = [];
  variants.push(generation.descriptors.filter(({ carrier_kind }) => carrier_kind !== "evaluation_input"));
  variants.push([...structuredClone(generation.descriptors), {
    ...structuredClone(generation.descriptors[0]),
    path: "wiki/contracts/WK-9999.controlled-acceptance.json",
    basename: "WK-9999.controlled-acceptance.json"
  }].sort((left, right) => left.path.localeCompare(right.path)));
  variants.push([structuredClone(generation.descriptors[0]),
    structuredClone(generation.descriptors[0])]);
  variants.push([...structuredClone(generation.descriptors)].reverse());
  const omitted = structuredClone(generation.descriptors);
  delete omitted[0].bytes_base64;
  variants.push(omitted);
  const mismatched = structuredClone(generation.descriptors);
  mismatched[0].content_digest = `sha256:${"0".repeat(64)}`;
  variants.push(mismatched);
  for (const descriptors of variants) {
    await assert.rejects(() => validateControlledContractGenerationDescriptors({
      wkId: "WK-2044", descriptors
    }));
  }
});

test("resolver refuses zero, closed-input widening, symlink, and non-regular generation members", async (t) => {
  const emptyRoot = await mkdtemp(path.join(os.tmpdir(), "wk-2044-empty-generation-"));
  t.after(() => rm(emptyRoot, { recursive: true, force: true }));
  await mkdir(path.join(emptyRoot, "wiki", "contracts"), { recursive: true });
  await assert.rejects(() => resolveControlledContractGeneration({
    repoRoot: emptyRoot, wkId: "WK-2044"
  }), (error) => error.code === "controlled_contract_generation_empty");
  await assert.rejects(() => resolveControlledContractGeneration({
    repoRoot: ROOT, wkId: "WK-2044", focus: "forbidden"
  }), (error) => error.code === "controlled_contract_request_field_forbidden");

  const nonRegularRoot = await mkdtemp(path.join(os.tmpdir(), "wk-2044-nonregular-"));
  t.after(() => rm(nonRegularRoot, { recursive: true, force: true }));
  const directory = path.join(nonRegularRoot, "wiki", "contracts");
  await mkdir(path.join(directory, "WK-2044.controlled-acceptance.json"), { recursive: true });
  await assert.rejects(() => resolveControlledContractGeneration({
    repoRoot: nonRegularRoot, wkId: "WK-2044"
  }), (error) => error.code === "controlled_contract_generation_invalid");

  const symlinkRoot = await mkdtemp(path.join(os.tmpdir(), "wk-2044-symlink-generation-"));
  t.after(() => rm(symlinkRoot, { recursive: true, force: true }));
  const symlinkDirectory = path.join(symlinkRoot, "wiki", "contracts");
  await mkdir(symlinkDirectory, { recursive: true });
  await symlink(path.join(ROOT, "wiki", "contracts", "WK-2044.controlled-acceptance.json"),
    path.join(symlinkDirectory, "WK-2044.controlled-acceptance.json"));
  await assert.rejects(() => resolveControlledContractGeneration({
    repoRoot: symlinkRoot, wkId: "WK-2044"
  }), (error) => error.code === "controlled_contract_generation_invalid");
});

test("the private grammar is absent and the persistence primitive imports the shared classifier", async () => {
  const toolsSource = await readFile(path.join(
    ROOT, "packages/wiki-core/src/lib/controlled-contract-tools.mjs"), "utf8");
  const primitiveSource = await readFile(path.join(
    ROOT, "packages/agent-launch-cli/src/lib/controlled-carrier-attachment-primitive.mjs"), "utf8");
  assert.doesNotMatch(toolsSource, /classifyEvaluationInputBasename/);
  assert.match(primitiveSource, /import \{[\s\S]*classifyControlledContractRepositoryPath[\s\S]*\} from "@agent-chassis\/wiki-core\/src\/lib\/controlled-contract-tools\.mjs"/);
  assert.doesNotMatch(primitiveSource, /controlled-acceptance\.json|proof-plan-request\.json|evaluation-input\.json/);
});

test("generation resolution refuses a malformed additional same-WK basename", async (t) => {
  const { repoRoot, contracts } = await generationFixture(t, 1);
  await writeFile(path.join(contracts, "WK-2044.bad.controlled-acceptance.json"), "{}\n");
  await assert.rejects(
    () => resolveControlledContractGeneration({ repoRoot, wkId: "WK-2044" }),
    (error) => error.code === "controlled_contract_generation_invalid"
  );
});

test("canonical carrier-set resolution refuses malformed active names and skips unsupported suffixes",
  async (t) => {
    const { repoRoot, contracts } = await generationFixture(t, 1);
    const { resolveCanonicalControlledContractCarrierSet } = await import(
      "../../packages/wiki-core/src/lib/controlled-contract-carrier-set-tools.mjs");
    const malformed = "WK-2044.bad.controlled-acceptance.json";
    const unsupported = "WK-2044.notes.txt";
    await writeFile(path.join(contracts, malformed), "{}\n");
    await writeFile(path.join(contracts, unsupported), "same-WK metadata\n");

    await assert.rejects(
      () => resolveCanonicalControlledContractCarrierSet({
        repoRoot, wkId: "WK-2044"
      }),
      (error) => error.code === "controlled_contract_carrier_set_member_mismatch" &&
        error.details.basename === malformed
    );

    await rm(path.join(contracts, malformed));
    const canonicalSet = await resolveCanonicalControlledContractCarrierSet({
      repoRoot, wkId: "WK-2044"
    });
    assert.deepEqual(Object.keys(canonicalSet.members_by_basename),
      ["WK-2044.controlled-acceptance.json"]);
    assert.equal(Object.hasOwn(canonicalSet.members_by_basename, unsupported), false);
    assert.equal(canonicalSet.members.some(({ filename }) => filename === unsupported), false);
  });

test("both retained association paths refuse every shared-classifier wrong carrier kind", async (t) => {
  const { repoRoot } = await generationFixture(t, 1);
  const requestPath = path.join(repoRoot, "wiki", "contracts", "WK-2044.proof-plan-request.json");
  for (const evaluation_input_path of [
    "WK-2044.controlled-acceptance.json",
    "WK-2044.proof-plan-request.json",
    "WK-2044.proof-plan.json"
  ]) {
    const request = {
      selected_packs: [{
        profile_id: "proof.operation.forbidden-noninvocation",
        profile_version: "1.0.0",
        evaluation_input_path
      }]
    };
    await writeFile(requestPath, `${JSON.stringify(request, null, 2)}\n`);
    await assert.rejects(() => resolveControlledContractEvaluationInputBinding({
      repoRoot,
      wkId: "WK-2044",
      pack: {
        profileId: "proof.operation.forbidden-noninvocation",
        profileVersion: "1.0.0"
      }
    }), (error) => error.code === "controlled_contract_proof_input_path_forbidden");
    await assert.rejects(() => readCanonicalProofPlanInputs({
      repoRoot,
      wkId: "WK-2044",
      requestContent: request
    }), (error) => error.code === "controlled_contract_proof_input_path_forbidden");
  }
});

test("an unreferenced valid pack input remains in the complete multi-namespace union", async (t) => {
  const {repoRoot} = await stableGenerationFixture(t);
  const contracts = path.join(repoRoot, "wiki", "contracts");
  const unreferenced = controlledContractPackCarrierFilename({
    wkId: "WK-2044",
    focus: "extra-focus",
    profileId: "proof.operation.forbidden-noninvocation",
    profileVersion: "1.0.0"
  });
  await writeFile(path.join(contracts, unreferenced), await readFile(path.join(
    contracts, "WK-2044.evaluation-input.json")));
  const generation = await resolveControlledContractGeneration({ repoRoot, wkId: "WK-2044" });
  assert.equal(generation.count, 5);
  assert.ok(generation.descriptors.some(({ basename }) => basename === unreferenced));
});

async function multiPackFixture(t, { includePackInput }) {
  const wkId = "WK-2092";
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "wk-2134-multipack-"));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const contracts = path.join(repoRoot, "wiki", "contracts");
  await mkdir(contracts, { recursive: true });
  await mkdir(path.join(repoRoot, "wiki", "work-records"), { recursive: true });
  const request = JSON.parse(await readFile(path.join(
    ROOT, "wiki/contracts", `${wkId}.proof-plan-request.json`), "utf8"));
  assert.ok(request.selected_packs.length > 1,
    "the fixture request must select more than one pack");
  const packAddressed = request.selected_packs
    .map(({ evaluation_input_path: basename }) => basename)
    .filter((basename) => basename.includes(".pack-sha256-"));
  assert.equal(packAddressed.length, 1);
  const basenames = [
    `${wkId}.controlled-acceptance.json`,
    `${wkId}.proof-plan-request.json`,
    `${wkId}.evaluation-input.json`,
    ...(includePackInput ? packAddressed : [])
  ];
  for (const basename of basenames) {
    await writeFile(path.join(contracts, basename),
      await readFile(path.join(ROOT, "wiki/contracts", basename)));
  }
  const record = JSON.parse(await readFile(
    path.join(ROOT, "wiki/work-records", `${wkId}.json`), "utf8"));
  record.acceptance.validation = [];
  record.slices = [];
  await writeFile(path.join(repoRoot, "wiki/work-records", `${wkId}.json`),
    `${JSON.stringify(record, null, 2)}\n`);
  const missingPack = request.selected_packs.find(
    ({ evaluation_input_path: basename }) => basename === packAddressed[0]);
  return { repoRoot, wkId, missingPack };
}

test("an absent selected-pack evaluation input is named before any plan is built",
  async (t) => {
    const { repoRoot, wkId, missingPack } = await multiPackFixture(t,
      { includePackInput: false });
    const state = await deriveCanonicalControlledContractAuthoringState({
      repoRoot, wkId
    });
    assert.equal(state.stage, "evaluation_input_population_incomplete");

    assert.equal(
      JSON.stringify(state).includes("workspace_controlled_proof_plan_build"), false);
    assert.deepEqual(state.next_calls, [{
      tool: "workspace_controlled_contract_carrier_query",
      arguments: { wk_id: wkId, carrier_kind: "proof_plan_request",
        target: "selected_packs" }
    }]);
    const decisions = state.unresolved_decisions;
    assert.equal(decisions.failed_prerequisite,
      "selected_pack_evaluation_input_absent");
    assert.equal(decisions.missing_evaluation_input_count, 1);
    assert.equal(decisions.missing_evaluation_inputs_omitted, 0);

    assert.deepEqual(decisions.missing_evaluation_inputs, [{
      profile_id: missingPack.profile_id,
      profile_version: missingPack.profile_version,
      evaluation_input_path: missingPack.evaluation_input_path
    }]);
    assert.equal(JSON.stringify(state).includes(repoRoot), false);

    const inputs = await readCanonicalProofPlanInputs({ repoRoot, wkId });
    assert.equal(inputs.request.content.selected_packs.find(
      ({ profile_id: profileId, profile_version: profileVersion }) =>
        profileId === missingPack.profile_id &&
        profileVersion === missingPack.profile_version
    ).evaluation_input_path, missingPack.evaluation_input_path);
    assert.equal(
      Object.hasOwn(inputs.evaluationInputs, missingPack.evaluation_input_path), false);
  });

test("a complete selected-pack population still reaches the plan build unchanged",
  async (t) => {
    const { repoRoot, wkId, missingPack } = await multiPackFixture(t,
      { includePackInput: true });
    const state = await deriveCanonicalControlledContractAuthoringState({
      repoRoot, wkId
    });
    assert.equal(state.stage, "proof_plan_ready");
    assert.deepEqual(state.next_calls, [{
      tool: "workspace_controlled_proof_plan_build",
      arguments: { wk_id: wkId, expected_content_digest: null }
    }]);
    assert.deepEqual(state.unresolved_decisions,
      { identities: ["proof_plan_compilation"], count: 1 });
    const inputs = await readCanonicalProofPlanInputs({ repoRoot, wkId });
    assert.ok(
      Object.hasOwn(inputs.evaluationInputs, missingPack.evaluation_input_path));
  });

async function manifestFencedFixture(t) {

  const wkId = "WK-2225";
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "wk-2131-fence-"));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const contracts = path.join(repoRoot, "wiki", "contracts");
  await mkdir(contracts, { recursive: true });
  await mkdir(path.join(repoRoot, "wiki", "work-records"), { recursive: true });
  const basenames = [
    `${wkId}.controlled-acceptance.json`,
    `${wkId}.evaluation-input.json`,
    `${wkId}.proof-plan-request.json`,
    `${wkId}.proof-plan.json`
  ];
  for (const basename of basenames) {
    await writeFile(path.join(contracts, basename), await readFile(
      path.join(ROOT, "wiki/contracts", basename)));
  }
  const recordPath = path.join(repoRoot, "wiki/work-records", `${wkId}.json`);
  const record = JSON.parse(await readFile(
    path.join(ROOT, "wiki/work-records", `${wkId}.json`), "utf8"));
  record.acceptance.validation = [];
  record.slices = [];
  await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`);

  const { resolveCanonicalControlledContractCarrierSet } = await import(
    "../../packages/wiki-core/src/lib/controlled-contract-tools.mjs");
  const { writeControlledContractCarrierOperation } = await import(
    "../../packages/wiki-core/src/operations/controlled-contract.mjs");
  const legacy = await resolveCanonicalControlledContractCarrierSet({ repoRoot, wkId });
  assert.equal(legacy.source, "legacy_root");

  await writeControlledContractCarrierOperation({
    repoRoot,
    wkId,
    carrierKind: "contract",
    expectedContentDigest: legacy.members_by_basename[basenames[0]].content_digest,
    content: legacy.members_by_basename[basenames[0]].content
  });
  const published = await resolveCanonicalControlledContractCarrierSet({ repoRoot, wkId });
  assert.equal(published.source, "manifest");

  const stale = structuredClone(published.members_by_basename[basenames[0]].content);
  stale.annotations = [...(stale.annotations ?? []),
    { annotation_id: "wk-2131-stale-root", text: "STALE LEGACY ROOT COPY" }];
  const staleBytes = `${JSON.stringify(stale, null, 2)}\n`;
  await writeFile(path.join(contracts, basenames[0]), staleBytes);
  return {
    repoRoot, wkId, contracts, basenames, published,
    staleContractDigest: `sha256:${createHash("sha256").update(staleBytes).digest("hex")}`
  };
}

test("test-proof query binds the manifest-selected generation, never a stale root copy",
  async (t) => {
    const fx = await manifestFencedFixture(t);
    const contract = fx.published.members_by_basename[fx.basenames[0]];
    const verificationIds = contract.content.test_proofs
      .map(({ verification_claim_id: identity }) => identity);
    assert.ok(verificationIds.length > 0);
    assert.notEqual(fx.staleContractDigest, contract.content_digest);

    const query = await queryControlledContractTestProofBindings({
      repoRoot: fx.repoRoot, wkId: fx.wkId, verificationIds
    });
    assert.equal(query.filename, fx.basenames[0]);
    assert.equal(query.content_digest, contract.content_digest);
    assert.notEqual(query.content_digest, fx.staleContractDigest);
    assert.equal(query.controlled_contract_generation_carrier_count, fx.basenames.length);
    assert.equal(query.matched_count, verificationIds.length);
    assert.equal(Object.hasOwn(query, "controlled_contract_generation_carriers"), false);
    assert.equal(JSON.stringify(query).includes(".carrier-generations"), false);

    const runtime = await resolveControlledContractTestProofRuntimeBindings({
      repoRoot: fx.repoRoot, wkId: fx.wkId, verificationIds
    });
    assert.deepEqual(
      runtime.controlled_contract_generation_carriers.map(({ filename }) => filename).sort(),
      [...fx.basenames].sort());
    for (const member of runtime.controlled_contract_generation_carriers) {
      assert.equal(member.source_member.storage_mode, "manifest_generation");
      assert.equal(member.source_member.logical_filename, member.filename);
      assert.equal(member.source_member.content_digest, member.content_digest);
      assert.match(member.source_member.repository_relative_path,
        /^wiki\/contracts\/\.carrier-generations\/[a-f0-9]{64}\//u);
    }
    assert.equal(runtime.controlled_contract_generation, query.controlled_contract_generation);
  });

test("manifest-selected runtime members mint attempts without authoritative root copies",
  async (t) => {
    const fx = await manifestFencedFixture(t);
    const contract = fx.published.members_by_basename[fx.basenames[0]];
    const verificationId = contract.content.test_proofs[0].verification_claim_id;
    const runtime = await resolveControlledContractTestProofRuntimeBindings({
      repoRoot: fx.repoRoot, wkId: fx.wkId, verificationIds: [verificationId]
    });
    const readyRuntime = structuredClone(runtime);
    readyRuntime.bindings[0].runtime_test_identity = {
      test_id: readyRuntime.bindings[0].coverage_disposition.items[0].test_id
    };
    const authorities = [
      mintOrchestratorProofAuthority({
        mainRepo: fx.repoRoot,
        repository: "agent-chassis/fixture",
        selectedUnit: fx.wkId,
        worktreePath: fx.repoRoot,
        selector: { kind: "current_main" },
        commit: "1".repeat(40),
        tree: "2".repeat(40),
        clean: false,
        candidateKind: "existing_worktree",
        authenticatedCandidateIdentity: `sha256:${"3".repeat(64)}`
      }),
      mintOrchestratorProofAuthority({
        mainRepo: fx.repoRoot,
        repository: "agent-chassis/fixture",
        selectedUnit: fx.wkId,
        worktreePath: fx.repoRoot,
        selector: { kind: "exact_sha", value: "1".repeat(40) },
        commit: "1".repeat(40),
        tree: "2".repeat(40),
        clean: true,
        candidateKind: "immutable_exact_commit",
        authenticatedCandidateIdentity: `sha256:${"4".repeat(64)}`
      })
    ];
    for (const basename of fx.basenames) {
      await unlink(path.join(fx.contracts, basename)).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
    for (const authority of authorities) {
      const context = mintLauncherTestProofAttemptContext({
        authority,
        target: "tests/manifest-selected.test.mjs",
        authorizedTargets: ["tests/manifest-selected.test.mjs"],
        controlledContractSelection: readyRuntime,
        verificationId
      });
      assert.equal(assertLauncherTestProofAttemptContext(context), context);
    }

    const selected = readyRuntime.controlled_contract_generation_carriers[0];
    await writeFile(path.join(fx.repoRoot,
      selected.source_member.repository_relative_path), "{}\n");
    assert.throws(() => mintLauncherTestProofAttemptContext({
      authority: authorities[0],
      target: "tests/manifest-selected.test.mjs",
      authorizedTargets: ["tests/manifest-selected.test.mjs"],
      controlledContractSelection: readyRuntime,
      verificationId
    }), (error) => error.code ===
      "test_proof_controlled_contract_generation_snapshot_mismatch" &&
      error.detail.filename === selected.filename &&
      error.detail.storage_mode === "manifest_generation");
  });

test("a published manifest fences the generation resolver even when the root diverges",
  async (t) => {
    const fx = await manifestFencedFixture(t);
    const generation = await resolveControlledContractGeneration({
      repoRoot: fx.repoRoot, wkId: fx.wkId
    });
    assert.equal(generation.count, fx.basenames.length);
    for (const descriptor of generation.descriptors) {
      assert.equal(descriptor.content_digest,
        fx.published.members_by_basename[descriptor.basename].content_digest,
        descriptor.basename);
      assert.equal(descriptor.path, `wiki/contracts/${descriptor.basename}`);
    }
    assert.notEqual(generation.descriptors[0].content_digest, fx.staleContractDigest);

    await writeFile(path.join(fx.contracts, `${fx.wkId}-Bad.evaluation-input.json`), "{}\n");
    const fenced = await resolveControlledContractGeneration({
      repoRoot: fx.repoRoot, wkId: fx.wkId
    });
    assert.equal(fenced.generation_digest, generation.generation_digest);

    const manifestPath = path.join(fx.contracts, `${fx.wkId}.carrier-set-manifest.json`);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.carrier_census[0].byte_length += 1;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await assert.rejects(() => resolveControlledContractGeneration({
      repoRoot: fx.repoRoot, wkId: fx.wkId
    }), (error) => {
      assert.match(error.code, /^controlled_contract_carrier_set_/u);
      return true;
    });
    await assert.rejects(() => resolveControlledContractAttachmentGeneration({
      repoRoot: fx.repoRoot, wkId: fx.wkId
    }), (error) => {
      assert.match(error.code, /^controlled_contract_carrier_set_/u);
      return true;
    });
  });
