import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  CONTROLLED_CONTRACT_MCP_TOOL_NAMES,
  registerControlledContractTools
} from "../../packages/wiki-mcp/src/lib/controlled-contract-tools.mjs";
import { errorContent, jsonContent } from
  "../../packages/wiki-mcp/src/lib/mcp-response.mjs";
import { registerWorkRecordReadTools } from
  "../../packages/wiki-mcp/src/lib/work-record-read-tools.mjs";
import { createCompactValidateDispatchResponse } from
  "../../packages/wiki-mcp/src/lib/work-record-write-route-helpers.mjs";
import { migrateControlledAcceptanceContractV02ToV1 } from
  "../../packages/controlled-contract/lib/stable-v1-migration.mjs";
import {
  projectControlledContractAuthoringState,
  TASK_AUTHORING_LIMIT
} from "../../packages/wiki-core/src/lib/controlled-contract-authoring-projections.mjs";
import { buildProofAuthoringSkeletonOperation } from
  "../../packages/wiki-core/src/operations/controlled-contract/proof-authoring-skeleton-operations.mjs";
import {
  INTEGRATION_PREFIX_PROFILE,
  VERIFICATION_BUNDLE_VOCABULARY
} from "../../packages/controlled-contract/current.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const INTEGRATION_PREFIX_ROUTE = "workspace_controlled_integration_prefix_capture_author";
const PROOF_GRAPH_ROUTE = "workspace_controlled_contract_proof_graph_continue";
const NEW_TOOLS = [
  "workspace_controlled_contract_authoring_state",
  "workspace_controlled_proof_authoring_skeleton",
  "workspace_controlled_contract_authoring_continue",
  "workspace_controlled_test_proof_authoring_describe",
  "workspace_controlled_test_proof_query",
  "workspace_controlled_test_proof_patch",
  "workspace_controlled_verification_bundle_patch",
  PROOF_GRAPH_ROUTE,
  INTEGRATION_PREFIX_ROUTE
];

function refusalError(reasonCode, details = {}) {
  const error = new Error(reasonCode);
  error.code = reasonCode;
  error.envelope = {
    schema_version: "controlled-contract-mcp-refusal.v1",
    ok: false,
    warning: {
      code: "controlled_contract_request_refused",
      severity: "blocking",
      message: `controlled-contract MCP request refused: ${reasonCode}`,
      payload: {
        schema_version: "controlled-contract-refusal-payload.v1",
        reason_code: reasonCode,
        details
      }
    }
  };
  return error;
}

function proofGraphRegistrations({ continueProofGraph, readAuthoringState } = {}) {
  const found = new Map();
  const resolvedRepos = [];
  registerControlledContractTools({
    registerTool: (name, config, handler) => found.set(name, { config, handler }),
    workspaceRepos: { currentAlias: "current" },
    z,
    jsonContent: (value) => ({ structuredContent: value }),
    errorContent: (error) => ({ isError: true, structuredContent: error.envelope }),
    resolveWorkspaceRepo: (_repos, repo) => {
      resolvedRepos.push(repo);
      return { repo: repo ?? "current", dir: ROOT };
    },
    continueProofGraph,
    readAuthoringState
  });
  return { found, resolvedRepos };
}

function proofGraphAuthoringState(pointer = "/claims/0/proposition_id") {
  const continuation = "a".repeat(64);
  return {
    schema_version: "controlled-contract-authoring-state.v1",
    stage: "proof_graph_required",
    selected_resources: {
      contract: { carrier_kind: "contract", content_digest: `sha256:${"b".repeat(64)}` }
    },
    unresolved_decisions: {
      identities: ["contract"],
      count: 1,
      semantic_pointers: [pointer],
      semantic_pointer_count: 1
    },
    continuation,
    next_calls: [{
      tool: PROOF_GRAPH_ROUTE,
      arguments: { wk_id: "WK-2100", continuation }
    }]
  };
}

function projectedProofGraphStateAtBytes(targetBytes) {
  const initial = proofGraphAuthoringState("/");
  const initialBytes = Buffer.byteLength(JSON.stringify(
    projectControlledContractAuthoringState(initial), null, 2
  ), "utf8");
  const projected = projectControlledContractAuthoringState(proofGraphAuthoringState(
    `/${"x".repeat(targetBytes - initialBytes)}`
  ));
  assert.equal(Buffer.byteLength(JSON.stringify(projected, null, 2), "utf8"), targetBytes);
  return projected;
}

function integrationPrefixReceipt(overrides = {}) {
  return {
    schema_version: "integration-prefix-capture-authoring-receipt-v1",
    status: "published",
    identity: {
      repository: "agent-chassis/agent-chassis",
      wk_id: "WK-2063",
      focus: null,
      profile_id: INTEGRATION_PREFIX_PROFILE.profile_id,
      profile_version: INTEGRATION_PREFIX_PROFILE.profile_version
    },
    generation: "1".repeat(64),
    manifest_digest: `sha256:${"2".repeat(64)}`,
    manifest_content_digest: `sha256:${"3".repeat(64)}`,
    counts: { claims: 61, integration_units: 5, paths: 5, branches: 14,
      prefixes: 6, cases: 84 },
    digests: { contract: `sha256:${"4".repeat(64)}`,
      graph: `sha256:${"5".repeat(64)}` },
    content_references: {
      manifest: "controlled-contract-carrier-set://WK-2063/generation/manifest"
    },
    ...overrides
  };
}

function integrationPrefixRegistrations({ author, json = (value) => ({
  structuredContent: value
}) } = {}) {
  const found = new Map();
  registerControlledContractTools({
    registerTool: (name, config, handler) => found.set(name, { config, handler }),
    workspaceRepos: { currentAlias: "current" },
    z,
    jsonContent: json,
    errorContent: (error) => ({ isError: true, structuredContent: error.envelope }),
    resolveWorkspaceRepo: () => ({ repo: "current", dir: ROOT }),
    authorIntegrationPrefixCapture: author
  });
  return found;
}

async function fixture() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "wk-2024-mcp-"));
  const contracts = path.join(repoRoot, "wiki", "contracts");
  await mkdir(contracts, { recursive: true });
  const historical = JSON.parse(await readFile(path.join(
    ROOT, "wiki/contracts/WK-2020.controlled-acceptance.json")));
  const contract = migrateControlledAcceptanceContractV02ToV1({
    contract: historical,
    testProofs: historical.claims.filter(({kind, verification_method: method}) =>
      kind === "verification" && method === "test_execution"
    ).map(({claim_id: claimId}, index) => genericTestProof({contract: historical, claimId, index}))
  });
  await writeFile(path.join(contracts, "WK-2024.controlled-acceptance.json"),
    `${JSON.stringify(contract, null, 2)}\n`);
  const evaluationInput = JSON.parse(await readFile(
    path.join(ROOT, "wiki/contracts/WK-2020.evaluation-input.json"), "utf8"));
  evaluationInput.input_version = "controlled-contract-verification-profile-input.v1";
  evaluationInput.stable_evaluation = {};
  return { repoRoot, evaluationInput, contract };
}

function genericTestProof({contract, claimId, index}) {
  const referenceId = contract.references[0].reference_id;
  const propositionId = contract.propositions[0].proposition_id;
  return {
    test_proof_id: `test-proof-${claimId}`,
    verification_claim_id: claimId,
    system_under_test_boundary: {boundary_id: `sut-boundary-${index}`, kind: "module",
      runtime_module_path: "packages/controlled-contract/current.mjs",
      subject_reference_ids: [referenceId]},
    observable_result: {observable_id: `observable-${index}`, kind: "return_value",
      proposition_id: propositionId},
    candidate_execution_provider: {provider_id: "launcher.node-test",
      provider_version: "1.0.0", capability: "candidate_execution"},
    falsifiers: [{falsifier_id: `falsifier-${index}`, strategy: "dependency_failure",
      proposition_id: propositionId, expected_outcome: "verification_fails",
      mutation: {mutation_id: `mutation-${index}`, mechanism: "module_substitution",
        target_kind: "module", module_path: "packages/controlled-contract/current.mjs"},
      execution_provider: {provider_id: "launcher.node-test-module-fault",
        provider_version: "1.0.0", capability: "falsifier_execution"}}],
    traversal_provider: {mode: "provider", provider_id: "launcher.node-test-v8-coverage",
      provider_version: "1.0.0", capability: "boundary_traversal", boundary_kind: "module",
      observation_mechanism: "node_test_v8_coverage",
      observation_seam: "node_test_structured_assertion",
      evidence_artifact_type: "boundary_trace"},
    coverage_disposition: {baseline_id: `coverage-baseline-${index}`,
      baseline_state: "complete_executed_inventory",
      items: [{test_id: `test-${index}`, disposition: "preserved"}]},
    prohibited_shortcuts: ["source_text_inspection"]
  };
}

function testProofBinding() {
  const modulePath = "packages/controlled-contract/lib/test-proof-contract.mjs";
  return {
    test_proof_id: "test-proof-suite-covers-component",
    verification_claim_id: "claim-suite-covers-component",
    system_under_test_boundary: { boundary_id: "sut-boundary-component", kind: "module",
      runtime_module_path: modulePath, subject_reference_ids: ["ref-component"] },
    observable_result: { observable_id: "observable-component", kind: "return_value",
      proposition_id: "prop-suite-covers-component" },
    candidate_execution_provider: { provider_id: "launcher.node-test",
      provider_version: "1.0.0", capability: "candidate_execution" },
    falsifiers: [{ falsifier_id: "falsifier-component", strategy: "dependency_failure",
      proposition_id: "prop-component-absent", expected_outcome: "verification_fails",
      mutation: { mutation_id: "mutation-component", mechanism: "module_substitution",
        target_kind: "module", module_path: modulePath },
      execution_provider: { provider_id: "launcher.node-test-module-fault",
        provider_version: "1.0.0", capability: "falsifier_execution" } }],
    traversal_provider: { mode: "provider", provider_id: "launcher.node-test-v8-coverage",
      provider_version: "1.0.0", capability: "boundary_traversal", boundary_kind: "module",
      observation_mechanism: "node_test_v8_coverage",
      observation_seam: "node_test_structured_assertion",
      evidence_artifact_type: "boundary_trace" },
    coverage_disposition: { baseline_id: "coverage-baseline-component",
      baseline_state: "complete_executed_inventory",
      items: [{ test_id: "test-component", disposition: "preserved" }] },
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
      subject_reference_id: "ref-materializer", operator: "boolean:exists",
      applicability_context: { mode: "unconditional", operand_reference_ids: [] },
      operands: [{ kind: "boolean", value: true }] }],
    claims: [{ claim_id: "claim-suite-exec", kind: "verification", modality: "MUST",
      proposition_id: "prop-suite-exec", verification_method: "test_execution",
      falsifying_proposition_id: "prop-materializer-omits-v2-full-binding" }],
    relations: [{ relation_id: "rel-suite-exec-verifies-component", role: "verifies",
      source_claim_id: "claim-suite-exec",
      target_claim_id: "claim-materializer-depends-on-v2-full-binding" }],
    collections: [{ collection_id: "set-suite-exec-verification",
      collection_kind: "closed_set", purpose: "required_verification",
      member_claim_ids: ["claim-suite-exec"] }], residue: [], annotations: [],
    test_proof: { ...proof, test_proof_id: "test-proof-suite-exec",
      verification_claim_id: "claim-suite-exec",
      system_under_test_boundary: { ...proof.system_under_test_boundary,
        subject_reference_ids: ["ref-materializer"] },
      observable_result: { ...proof.observable_result, proposition_id: "prop-suite-exec" },
      falsifiers: proof.falsifiers.map((falsifier) => ({ ...falsifier,
        proposition_id: "prop-materializer-omits-v2-full-binding" })) }
  };
}

function inspectionReplacementBundle(contract, verificationId) {
  const claim = contract.claims.find(({ claim_id: identity }) => identity === verificationId);
  const propositionIds = new Set([
    claim.proposition_id, claim.falsifying_proposition_id
  ]);
  const externallyReferencedPropositionIds = new Set(contract.claims.filter(
    ({ claim_id: identity }) => identity !== verificationId
  ).flatMap(({ proposition_id: propositionId,
    falsifying_proposition_id: falsifyingPropositionId }) =>
    [propositionId, falsifyingPropositionId].filter(Boolean)));
  return {
    schema_version: "controlled-contract-verification-bundle.v1",
    verification_id: verificationId,
    references: [],
    propositions: contract.propositions.filter(({ proposition_id: identity }) =>
      propositionIds.has(identity) && !externallyReferencedPropositionIds.has(identity)),
    claims: [{ ...claim, verification_method: "test_execution" }],
    relations: contract.relations.filter(({ source_claim_id: source,
      target_claim_id: target }) => source === verificationId || target === verificationId),
    collections: contract.collections.filter(({ member_claim_ids: members }) =>
      members.length > 0 && members.every((identity) => identity === verificationId)),
    residue: [],
    annotations: [],
    test_proof: structuredClone(contract.test_proofs.find(
      ({ verification_claim_id: identity }) => identity === verificationId
    ))
  };
}

async function writeUnboundRecord(repoRoot) {
  const record = {
    schema_version: "work-record.v1", id: "WK-2024",
    repo: "agent-chassis/agent-chassis", title: "MCP authoring trajectory fixture",
    record_kind: "work_item", work_kind: "implementation", status: "active",
    priority: "high", owner: "unassigned", created: "2026-08-17",
    updated: "2026-08-17", read_scope: ["docs/mcp-integration.md"],
    repo_paths: ["packages/controlled-contract/current.mjs"],
    write_scope: ["packages/controlled-contract/current.mjs"],
    depends_on: [], blocks: [], related: [],
    dispatch_intent: { intended_agent_role: "worker", target_unit: "record",
      requires_graph_impact: false, requires_escalation: false },
    acceptance: { criteria: ["The authoring trajectory reaches its stop condition."],
      validation: [] },
    sections: { summary: "Exercise the reachable controlled-contract authoring flow.",
      why_it_matters: "A fresh session must reach the stop condition from the emitted actions.",
      scope: { items: ["Drive the emitted actions."], out_of_scope: [] },
      tasks: [], references: [], agent_notes: "", closure: null },
    children: [], slices: [], escalations: [], projections: [], migration: null,
    derived_evidence: [], initiative: "IN-0001"
  };
  const directory = path.join(repoRoot, "wiki/work-records");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "WK-2024.json"),
    `${JSON.stringify(record, null, 2)}\n`);
}

async function writeStructuredRecord(repoRoot, verificationId) {
  const verificationIds = [
    "claim-regression-verifies-large-population",
    "claim-regression-verifies-scan-removal",
    "claim-tests-verify-authority-proofs",
    verificationId
  ];
  const record = {
    schema_version: "work-record.v1", id: "WK-2024",
    repo: "agent-chassis/agent-chassis", title: "MCP admission parity fixture",
    record_kind: "work_item", work_kind: "implementation", status: "active",
    priority: "high", owner: "unassigned", created: "2026-08-17",
    updated: "2026-08-17", read_scope: ["docs/mcp-integration.md"],
    repo_paths: ["packages/controlled-contract/current.mjs"],
    write_scope: ["packages/controlled-contract/current.mjs"],
    depends_on: [], blocks: [], related: [],
    dispatch_intent: { intended_agent_role: "worker", target_unit: "record",
      requires_graph_impact: false, requires_escalation: false },
    acceptance: { criteria: ["Structured validation is admission compatible."],
      validation: [{ operation: "node_test", target: "fixture.mjs",
        verification_ids: [...new Set(verificationIds)] }] },
    sections: { summary: "Exercise stable controlled-contract dispatch admission.",
      why_it_matters: "The public dispatch route must consume authoritative carriers.",
      scope: { items: ["Validate the minimal fixture."], out_of_scope: [] },
      tasks: [], references: [],
      agent_notes: "", closure: null },
    children: [], slices: [], escalations: [], projections: [], migration: null,
    derived_evidence: [], initiative: "IN-0001"
  };
  const directory = path.join(repoRoot, "wiki/work-records");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "WK-2024.json"),
    `${JSON.stringify(record, null, 2)}\n`);
}

async function testValidityInput(binding) {
  const input = JSON.parse(await readFile(path.join(ROOT,
    "packages/controlled-contract/profiles/proof.verification.test-validity/2.0.0/evaluation-input.template.json"),
  "utf8"));
  input.reference_bindings = [
    {role: "component", reference_ids: ["ref-component"]},
    {role: "suite", reference_ids: ["ref-suite"]}
  ];
  const validity = input.stable_evaluation.test_validity[0];
  validity.verification_id = binding.verification_claim_id;
  validity.test_proof_id = binding.test_proof_id;
  validity.candidate_execution.observed_boundary_id = binding.system_under_test_boundary.boundary_id;
  validity.candidate_execution.observed_observable_id = binding.observable_result.observable_id;
  validity.boundary_traversal.boundary_id = binding.system_under_test_boundary.boundary_id;
  validity.boundary_traversal.observable_id = binding.observable_result.observable_id;
  validity.falsifier_executions[0].falsifier_id = binding.falsifiers[0].falsifier_id;
  validity.falsifier_executions[0].failure_proposition_id = binding.falsifiers[0].proposition_id;
  validity.falsifier_executions[0].mutation.mutation_id = binding.falsifiers[0].mutation.mutation_id;
  validity.falsifier_executions[0].mutation.target_verification_id = binding.verification_claim_id;
  validity.test_inventory.declared_test_ids = ["test-component"];
  validity.test_inventory.baseline_executed_test_ids = ["test-component"];
  validity.test_inventory.observed_tests = [{ test_id: "test-component", status: "passed" }];
  return input;
}

async function issueBoundContinuation(call, {
  wkId = "WK-2024", selectedPack, requestedIntents, evaluationInput
}) {
  const inspection = await call("workspace_controlled_proof_authoring_skeleton", {
    wk_id: wkId, selected_pack: selectedPack, requested_intents: requestedIntents,
    evaluation_input: evaluationInput
  });
  assert.notEqual(inspection.isError, true,
    JSON.stringify(inspection.structuredContent));
  assert.equal(inspection.structuredContent.continuation_issued, false);
  assert.equal(Object.hasOwn(inspection.structuredContent, "continuation"), false);
  const reissue = inspection.structuredContent.next_action;
  assert.equal(reissue.tool, "workspace_controlled_proof_authoring_skeleton");
  assert.ok(Array.isArray(reissue.verification_bundles));
  for (const bundle of reissue.verification_bundles) {
    assert.ok(bundle.author_semantics.length > 0);
  }
  assert.equal(typeof reissue.evaluation_input_skeleton, "object");
  assert.equal(typeof reissue.proof_plan_request, "object");
  assert.deepEqual(reissue.author_semantics.map(({ pointer }) => pointer),
    ["/proposal_draft"]);
  const contract = await call("workspace_controlled_contract_carrier_read", {
    wk_id: wkId, carrier_kind: "contract"
  });

  const createdEvaluation = await call("workspace_controlled_contract_carrier_create", {
    wk_id: wkId, carrier_kind: "evaluation_input", expected_content_digest: null,
    content: reissue.arguments.evaluation_input
  });
  assert.notEqual(createdEvaluation.isError, true,
    JSON.stringify(createdEvaluation.structuredContent));
  const createdRequest = await call("workspace_controlled_contract_carrier_create", {
    wk_id: wkId, carrier_kind: "proof_plan_request", expected_content_digest: null,
    content: reissue.proof_plan_request
  });
  assert.notEqual(createdRequest.isError, true,
    JSON.stringify(createdRequest.structuredContent));

  const issued = await call("workspace_controlled_proof_authoring_skeleton", {
    ...reissue.arguments,
    proposal_draft: { carrier_operations: [] }
  });
  assert.notEqual(issued.isError, true, JSON.stringify(issued.structuredContent));
  assert.equal(issued.structuredContent.continuation_issued, true);
  return issued.structuredContent;
}

async function driveAuthoringToStop(call, { wkId = "WK-2024", continuation }) {
  const trace = {
    tool_calls: 0, refusals: 0, stages: [], operation_classes: [],
    structured_response_utf8_bytes: 0
  };
  const recordResponse = (tool, response) => {
    trace.tool_calls += 1;
    trace.operation_classes.push(tool.replace(/^workspace_controlled_/, ""));
    trace.structured_response_utf8_bytes += Buffer.byteLength(
      JSON.stringify(response?.structuredContent ?? {}), "utf8");
    return response;
  };
  let state = recordResponse("workspace_controlled_contract_authoring_state", await call(
    "workspace_controlled_contract_authoring_state", { wk_id: wkId, continuation }));
  for (let step = 0; step < 8; step += 1) {
    assert.notEqual(state.isError, true, JSON.stringify(state.structuredContent));
    const projected = state.structuredContent;
    trace.stages.push(projected.stage);
    if (Object.hasOwn(projected, "stop_condition")) return { trace, state: projected };
    assert.equal(projected.next_calls.length, 1);
    const [next] = projected.next_calls;
    const executed = recordResponse(next.tool, await call(next.tool, next.arguments));
    if (executed.isError === true) trace.refusals += 1;
    assert.notEqual(executed.isError, true, JSON.stringify(executed.structuredContent));
    state = recordResponse("workspace_controlled_contract_authoring_state", await call(
      "workspace_controlled_contract_authoring_state", { wk_id: wkId }));
  }
  assert.fail(`authoring did not stop: ${trace.stages.join(" -> ")}`);
}

test("a partial proposal draft reaches the core issuance owner through MCP", async (t) => {
  const { repoRoot, evaluationInput } = await fixture();
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const registered = new Map();
  const server = new McpServer({ name: "wk-2134-draft", version: "1.0.0" });
  registerControlledContractTools({
    registerTool: (name, config, handler) => {
      registered.set(name, config);
      return server.registerTool(name, config, handler);
    },
    workspaceRepos: { currentAlias: "current" },
    z, jsonContent, errorContent,
    resolveWorkspaceRepo: () => ({ repo: "current", dir: repoRoot })
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "wk-2134-draft-client", version: "1.0.0" },
    { capabilities: {} });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  await writeUnboundRecord(repoRoot);

  const route = "workspace_controlled_proof_authoring_skeleton";
  const base = {
    wk_id: "WK-2024",
    selected_pack: { profile_id: "proof.operation.forbidden-noninvocation",
      profile_version: "2.0.0" },
    requested_intents: ["controlled-proof-intent.forbidden-operation-noninvocation"],
    evaluation_input: evaluationInput
  };

  for (const [label, draft, missingPointer] of [
    ["carrier_operations absent", {}, "/proposal_draft/carrier_operations"]
  ]) {

    registered.get(route).inputSchema.parse({ ...base, proposal_draft: draft });
    const refused = await client.callTool({
      name: route, arguments: { ...base, proposal_draft: draft }
    });
    assert.equal(refused.isError, true, label);
    const payload = refused.structuredContent.warning.payload;
    assert.equal(payload.reason_code, "controlled_contract_proposal_draft_partial", label);
    assert.equal(payload.details.pointer, "/proposal_draft", label);
    assert.ok(payload.details.missing_pointers.includes(missingPointer), label);

    const replacement = payload.details.replacement_call;
    assert.equal(replacement.tool, route, label);
    registered.get(route).inputSchema.parse(replacement.arguments);
    const corrected = await client.callTool({
      name: route, arguments: replacement.arguments
    });
    assert.notEqual(corrected.isError, true,
      `${label}: ${JSON.stringify(corrected.structuredContent)}`);
    assert.deepEqual(
      corrected.structuredContent.next_action.author_semantics.map(
        ({ pointer }) => pointer), ["/proposal_draft"], label);
  }

  assert.throws(() => registered.get(route).inputSchema.parse({
    ...base, proposal_draft: { carrier_operations: [], extra: 1 }
  }));

  for (const retiredField of ["expected_sources", "expectedSources"]) {
    assert.throws(() => registered.get(route).inputSchema.parse({
      ...base,
      proposal_draft: {
        carrier_operations: [],
        [retiredField]: [{ carrier_kind: "contract", presence: "absent",
          expected_content_digest: null }]
      }
    }), ({ issues }) => issues.some(({ code, keys, path }) =>
      code === "unrecognized_keys"
      && path.join("/") === "proposal_draft"
      && keys.includes(retiredField)), retiredField);
  }

  assert.throws(() => {
    const { requested_intents: unused, ...withoutIntents } = base;
    return registered.get(route).inputSchema.parse(withoutIntents);
  });
});

test("a contradicted proposal draft keeps its structured refusal through MCP", async (t) => {
  const { repoRoot, evaluationInput } = await fixture();
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const registered = new Map();
  const server = new McpServer({ name: "wk-2156-incomplete", version: "1.0.0" });
  registerControlledContractTools({
    registerTool: (name, config, handler) => {
      registered.set(name, config);
      return server.registerTool(name, config, handler);
    },
    workspaceRepos: { currentAlias: "current" },
    z, jsonContent, errorContent,
    resolveWorkspaceRepo: () => ({ repo: "current", dir: repoRoot })
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "wk-2156-client", version: "1.0.0" },
    { capabilities: {} });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  await writeUnboundRecord(repoRoot);

  const route = "workspace_controlled_proof_authoring_skeleton";
  const base = {
    wk_id: "WK-2024",
    selected_pack: { profile_id: "proof.operation.forbidden-noninvocation",
      profile_version: "2.0.0" },
    requested_intents: ["controlled-proof-intent.forbidden-operation-noninvocation"],
    evaluation_input: evaluationInput
  };
  const args = {
    ...base,
    proposal_draft: {

      carrier_operations: [{ kind: "carrier_patch",
        carrier_kind: "evaluation_input", op: "remove",
        target: "evaluation_stage" }]
    }
  };

  registered.get(route).inputSchema.parse(args);
  let coreError;
  try {
    await buildProofAuthoringSkeletonOperation({
      repoRoot,
      wkId: args.wk_id,
      selectedPack: args.selected_pack,
      requestedIntents: args.requested_intents,
      evaluationInput: args.evaluation_input,
      proposalDraft: args.proposal_draft
    });
    assert.fail("the contradicted production proposal draft must refuse in wiki-core");
  } catch (error) {
    coreError = error;
  }
  const corePayload = coreError.envelope.warning.payload;
  assert.equal(corePayload.reason_code,
    "controlled_contract_authoring_continuation_carrier_conflict");
  assert.deepEqual(Object.keys(corePayload.details).sort(), [
    "carrier_kind", "declared_operation", "declared_value", "pointer",
    "replacement_call", "resolved_value", "target", "target_identity"
  ]);
  const refused = await client.callTool({ name: route, arguments: args });
  assert.equal(refused.isError, true, JSON.stringify(refused.structuredContent));
  const payload = refused.structuredContent.warning.payload;
  assert.deepEqual(payload, corePayload,
    "the MCP boundary must transport the owning refusal without field deletion");
  assert.equal(payload.reason_code,
    "controlled_contract_authoring_continuation_carrier_conflict");
  assert.notEqual(payload.reason_code,
    "controlled_contract_authoring_continuation_tampered");
  assert.equal(payload.details.carrier_kind, "evaluation_input");
  assert.equal(payload.details.pointer, "/proposal_draft/carrier_operations/0");
  assert.equal(payload.details.target, "evaluation_stage");
  assert.equal(payload.details.replacement_call.tool,
    "workspace_controlled_contract_authoring_state");

  const serialized = JSON.stringify(refused);
  assert.equal(serialized.includes("[server-resolved-path]"), false);
  assert.equal(serialized.includes(repoRoot), false);
  assert.equal(serialized.includes(os.tmpdir()), false);
  assert.equal(serialized.includes("identity_digest"), false);
  assert.equal(serialized.includes("content_reference"), false);

  assert.equal(serialized.includes("corrected_call"), false,
    "corrected_call is not a public field of any response");
  assert.equal(Object.hasOwn(payload.details, "corrected_call"), false);

  const replacement = payload.details.replacement_call;
  assert.equal(replacement.tool, "workspace_controlled_contract_authoring_state");
  assert.deepEqual(Object.keys(replacement.arguments).filter((key) =>
    ["bindings", "evaluation_input", "selected_pack", "requested_intents",
      "proposal_draft"].includes(key)), [],
  "the sole correction restates no semantic input the author already supplied");
  registered.get(replacement.tool).inputSchema.parse(replacement.arguments);
  const recovered = await client.callTool({
    name: replacement.tool, arguments: replacement.arguments
  });
  assert.notEqual(recovered.isError, true,
    JSON.stringify(recovered.structuredContent));
  assert.equal(typeof recovered.structuredContent.stage, "string");
});

test("task-directed routes are registered with real schemas and round-trip through MCP", async (t) => {
  const { repoRoot, evaluationInput } = await fixture();
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const registered = new Map();
  const server = new McpServer({ name: "wk-2024-authoring", version: "1.0.0" });
  const registerTool = (name, config, handler) => {
    registered.set(name, config);
    return server.registerTool(name, config, handler);
  };
  registerControlledContractTools({
    registerTool,
    workspaceRepos: { currentAlias: "current" },
    z,
    jsonContent,
    errorContent,
    resolveWorkspaceRepo: () => ({ repo: "current", dir: repoRoot })
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "wk-2024-client", version: "1.0.0" }, { capabilities: {} });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });

  await writeUnboundRecord(repoRoot);
  const listed = await client.listTools();
  const listedNames = new Set(listed.tools.map(({ name }) => name));
  for (const name of NEW_TOOLS) {
    assert.ok(listedNames.has(name));
    assert.ok(CONTROLLED_CONTRACT_MCP_TOOL_NAMES.includes(name));
  }

  const state = await client.callTool({
    name: NEW_TOOLS[0], arguments: { wk_id: "WK-2024" }
  });
  assert.notEqual(state.isError, true);
  assert.equal(state.structuredContent.stage, "proof_authoring_required");
  assert.equal(Object.hasOwn(state.structuredContent, "content"), false);
  assert.equal(JSON.stringify(state.structuredContent).includes("compatible_candidates"), false);

  assert.ok(state.structuredContent.next_calls.length > 0);
  assert.equal(JSON.stringify(state.structuredContent.next_calls).includes("$"), false,
    "emitted next call carries a placeholder or caller-completed template");
  for (const next of state.structuredContent.next_calls) {
    assert.ok(registered.has(next.tool), `unregistered next call ${next.tool}`);
    registered.get(next.tool).inputSchema.parse(next.arguments);
    const executed = await client.callTool({ name: next.tool, arguments: next.arguments });
    assert.notEqual(executed.isError, true,
      `emitted next call ${next.tool} failed with its own arguments: ` +
      JSON.stringify(executed.structuredContent));
  }

  const missingInput = await client.callTool({
    name: "workspace_controlled_proof_pack_bindings_inspect",
    arguments: {
      wk_id: "WK-2024",
      profile_id: "proof.operation.forbidden-noninvocation",
      profile_version: "2.0.0",
      requested_intents: ["controlled-proof-intent.forbidden-operation-noninvocation"]
    }
  });
  if (missingInput.isError === true) {
    assert.fail(JSON.stringify(missingInput));
  }

  const inspection = missingInput.structuredContent;
  assert.equal(Object.hasOwn(inspection, "next_action"), false,
    "standalone inspection must not emit a proof-authoring recovery");
  assert.equal(Object.hasOwn(inspection, "next_calls"), false);
  assert.equal(JSON.stringify(inspection)
    .includes("workspace_controlled_proof_authoring_skeleton"), false,
    "inspection must not name the skeleton route");

  assert.equal(inspection.schema_version, "controlled-contract-binding-inspection.v3");
  assert.equal(inspection.profile_id, "proof.operation.forbidden-noninvocation");
  assert.equal(inspection.profile_version, "2.0.0");
  assert.ok(inspection.population_total > 0,
    "inspection still reports the pack's binding population");
  assert.ok(inspection.role_index_total > 0);

  assert.equal(JSON.stringify(inspection).includes("evaluation_input_path"), false);

  const call = (name, args) => client.callTool({ name, arguments: args });
  const skeleton = await issueBoundContinuation(call, {
    selectedPack: {
      profile_id: "proof.operation.forbidden-noninvocation",
      profile_version: "2.0.0"
    },
    requestedIntents: ["controlled-proof-intent.forbidden-operation-noninvocation"],
    evaluationInput
  });
  assert.equal(skeleton.selected_pack.evaluation_input_path,
    "WK-2024.evaluation-input.json");
  assert.equal(typeof skeleton.continuation, "string");
  assert.equal(skeleton.next_action.tool,
    "workspace_controlled_contract_authoring_state");
  assert.equal(skeleton.next_action.arguments.continuation, skeleton.continuation);

  const bound = await call(NEW_TOOLS[0],
    { wk_id: "WK-2024", continuation: skeleton.continuation });
  assert.notEqual(bound.isError, true);
  assert.equal(bound.structuredContent.stage, "proof_graph_required");

  const crossWk = await client.callTool({
    name: NEW_TOOLS[2], arguments: {
      wk_id: "WK-2014", continuation: skeleton.continuation
    }
  });
  assert.equal(crossWk.isError, true);
  assert.equal(crossWk.structuredContent.warning.payload.reason_code,
    "controlled_contract_authoring_continuation_cross_wk");
  assert.equal(crossWk.structuredContent.warning.payload.details.replacement_call.tool,
    "workspace_controlled_contract_authoring_state");
});

test("MCP authoring reports incompatible proof state while registered dispatch continues", async (t) => {
  const { repoRoot, contract } = await fixture();
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const carrierPath = path.join(repoRoot,
    "wiki/contracts/WK-2024.controlled-acceptance.json");
  const server = new McpServer({ name: "wk-2096-authoring", version: "1.0.0" });
  const registered = new Map();
  registerControlledContractTools({
    registerTool: (name, config, handler) => {
      registered.set(name, config);
      return server.registerTool(name, config, handler);
    },
    workspaceRepos: { currentAlias: "current" }, z, jsonContent, errorContent,
    resolveWorkspaceRepo: () => ({ repo: "current", dir: repoRoot })
  });
  registerWorkRecordReadTools({
    registerTool: (name, config, handler) => server.registerTool(name, config, handler),
    workspaceRepos: { currentAlias: "current" }, z, jsonContent, errorContent,
    resolveWorkspaceRepo: () => ({ repo: "current", dir: repoRoot }),
    createCompactValidateDispatchResponse
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "wk-2096-client", version: "1.0.0" },
    { capabilities: {} });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  const call = async (name, args) => client.callTool({ name, arguments: args });

  const inspection = structuredClone(contract);
  const existingId = inspection.claims.find(({ kind }) => kind === "verification").claim_id;
  inspection.claims.find(({ claim_id: id }) => id === existingId)
    .verification_method = "inspection";
  inspection.test_proofs = inspection.test_proofs.filter(
    ({ verification_claim_id: id }) => id !== existingId);
  await writeFile(carrierPath, `${JSON.stringify(inspection, null, 2)}\n`);
  await writeStructuredRecord(repoRoot, existingId);
  const inspectionState = await call("workspace_controlled_contract_authoring_state",
    { wk_id: "WK-2024" });
  assert.equal(inspectionState.structuredContent.stage, "verification_graph_required");
  const decisions = inspectionState.structuredContent.unresolved_decisions;
  assert.equal(decisions.addressed_verification_id, existingId);
  assert.equal(decisions.observed_method, "inspection");
  assert.equal(decisions.required_method, "test_execution");
  assert.equal(inspectionState.structuredContent.next_calls.length, 1);
  const [incompatible] = inspectionState.structuredContent.next_calls;
  assert.equal(incompatible.tool, "workspace_controlled_verification_bundle_patch");
  assert.equal(Object.hasOwn(incompatible, "executable"), false);
  assert.deepEqual(Object.keys(incompatible.arguments.operations[0].bundle),
    [...VERIFICATION_BUNDLE_VOCABULARY.required_fields]);

  registered.get(incompatible.tool).inputSchema.parse(incompatible.arguments);
  assert.equal(JSON.stringify(inspectionState.structuredContent)
    .includes("workspace_controlled_contract_carrier_patch"), false);
  const advisoryDispatch = await call("workspace_validate_dispatch",
    { unit: "WK-2024", verbose: true });
  assert.notEqual(advisoryDispatch.isError, true);
  assert.equal(advisoryDispatch.structuredContent.readiness.dispatchable, true,
    JSON.stringify(advisoryDispatch.structuredContent.readiness));
  assert.equal(advisoryDispatch.structuredContent.readiness.decision_code, "dispatchable");

  const bundle = inspectionReplacementBundle(contract, existingId);
  const advertisedArguments = structuredClone(incompatible.arguments);
  advertisedArguments.operations[0].bundle = bundle;
  const authored = await call(incompatible.tool, advertisedArguments);
  assert.notEqual(authored.isError, true, JSON.stringify(authored.structuredContent));
  assert.equal(authored.structuredContent.written, true);
  assert.match(authored.structuredContent.content_digest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(authored.structuredContent).includes('"content"'), false);
  const admitted = await call("workspace_validate_dispatch",
    { unit: "WK-2024", verbose: true });
  assert.notEqual(admitted.isError, true, JSON.stringify(admitted.structuredContent));
  assert.equal(admitted.structuredContent.readiness.dispatchable, true,
    JSON.stringify(admitted.structuredContent.readiness));
  const progressed = await call("workspace_controlled_contract_authoring_state",
    { wk_id: "WK-2024" });
  assert.notEqual(progressed.structuredContent.stage, "verification_graph_required");
  assert.notEqual(progressed.structuredContent.stage, "stable_test_proof_required");
});

test("a proof-less stable claim emits one directly callable test-proof action", async (t) => {
  const { repoRoot, contract } = await fixture();
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const carrierPath = path.join(repoRoot,
    "wiki/contracts/WK-2024.controlled-acceptance.json");
  const verificationId = contract.claims.find(({ kind, verification_method: method }) =>
    kind === "verification" && method === "test_execution").claim_id;
  await writeFile(carrierPath, `${JSON.stringify({
    ...contract,
    test_proofs: contract.test_proofs.filter(
      ({ verification_claim_id: id }) => id !== verificationId)
  }, null, 2)}\n`);
  await writeStructuredRecord(repoRoot, verificationId);
  const server = new McpServer({ name: "wk-2134-proofless", version: "1.0.0" });
  const registered = new Map();
  const register = (name, config, handler) => {
    registered.set(name, config);
    return server.registerTool(name, config, handler);
  };
  const wiring = {
    registerTool: register, workspaceRepos: { currentAlias: "current" },
    z, jsonContent, errorContent,
    resolveWorkspaceRepo: () => ({ repo: "current", dir: repoRoot })
  };
  registerControlledContractTools(wiring);
  registerWorkRecordReadTools({ ...wiring, createCompactValidateDispatchResponse });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "wk-2134-proofless-client", version: "1.0.0" },
    { capabilities: {} });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  const call = (name, args) => client.callTool({ name, arguments: args });

  const state = await call("workspace_controlled_contract_authoring_state",
    { wk_id: "WK-2024" });
  assert.equal(state.structuredContent.stage, "stable_test_proof_required");
  assert.deepEqual(state.structuredContent.next_calls.map(({ tool }) => tool),
    ["workspace_controlled_test_proof_patch"]);
  const [action] = state.structuredContent.next_calls;
  registered.get(action.tool).inputSchema.parse(action.arguments);
  const decisions = state.structuredContent.unresolved_decisions;
  assert.ok(decisions.identities.includes(verificationId));
  assert.equal(action.arguments.operations[0].verification_id,
    decisions.addressed_verification_id);
  assert.equal(JSON.stringify(action.arguments).includes("null"), false);
  assert.ok(action.author_semantics.every(({ pointer, target_type }) =>
    pointer.startsWith("/operations/0/binding/") && typeof target_type === "string"));

  const dispatch = await call("workspace_validate_dispatch",
    { unit: "WK-2024", verbose: true });
  assert.notEqual(dispatch.isError, true);
  assert.equal(dispatch.structuredContent.readiness.dispatchable, true,
    JSON.stringify(dispatch.structuredContent.readiness));
  assert.equal(dispatch.structuredContent.readiness.decision_code, "dispatchable");
});

test("stable task-directed authoring persists exact pack input and builds a current plan",
  async (t) => {
    const { repoRoot } = await fixture();
    t.after(() => rm(repoRoot, { recursive: true, force: true }));
    const contractPath = path.join(repoRoot, "wiki/contracts/WK-2024.controlled-acceptance.json");
    const base = JSON.parse(await readFile(path.join(ROOT,
      "packages/controlled-contract/examples/minimal-controlled-acceptance-contract-v034.json"),
    "utf8"));
    const binding = testProofBinding();
    const contract = migrateControlledAcceptanceContractV02ToV1({
      contract: base, testProofs: [binding]
    });
    const evaluationInput = await testValidityInput(binding);
    await writeFile(contractPath, `${JSON.stringify(contract, null, 2)}\n`);
    const server = new McpServer({ name: "wk-2024-v03-authoring", version: "1.0.0" });
    registerControlledContractTools({
      registerTool: server.registerTool.bind(server),
      workspaceRepos: { currentAlias: "current" },
      z, jsonContent, errorContent,
      resolveWorkspaceRepo: () => ({ repo: "current", dir: repoRoot })
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "wk-2024-v03-client", version: "1.0.0" },
      { capabilities: {} });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    t.after(async () => { await client.close(); await server.close(); });
    const call = (name, args) => client.callTool({ name, arguments: args });
    await writeUnboundRecord(repoRoot);
    const skeleton = await issueBoundContinuation(call, {
      selectedPack: { profile_id: "proof.verification.test-validity",
        profile_version: "2.0.0" },
      requestedIntents: ["controlled-proof-intent.test-verification-validity"],
      evaluationInput
    });
    assert.equal(skeleton.evaluation_input.evaluation_stage, "pre_dispatch");

    const { trace, state } = await driveAuthoringToStop(call,
      { continuation: skeleton.continuation });
    assert.equal(state.stage, "complete");
    assert.equal(state.stop_condition, "controlled_contract_authoring_complete");
    assert.equal(trace.refusals, 0);
    assert.deepEqual(trace.stages, ["proof_graph_required", "proof_plan_ready", "complete"]);
    assert.ok(trace.operation_classes.includes("contract_proof_graph_continue"));
    assert.ok(trace.operation_classes.includes("proof_plan_build"));
    assert.ok(trace.structured_response_utf8_bytes > 0);
    assert.ok(trace.structured_response_utf8_bytes <= 32768,
      "fresh authoring trace exceeds its aggregate UTF-8 response bound");
    assert.match(state.selected_resources.contract.content_digest,
      /^sha256:[a-f0-9]{64}$/u);
    assert.equal(JSON.stringify(state).includes('"content"'), false);
  });

test("a supported contract mutation makes the next authoring state stale, not complete",
  async (t) => {
    const { repoRoot, evaluationInput, contract } = await fixture();
    t.after(() => rm(repoRoot, { recursive: true, force: true }));
    const server = new McpServer({ name: "wk-2024-currency", version: "1.0.0" });
    registerControlledContractTools({
      registerTool: server.registerTool.bind(server),
      workspaceRepos: { currentAlias: "current" },
      z, jsonContent, errorContent,
      resolveWorkspaceRepo: () => ({ repo: "current", dir: repoRoot })
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "wk-2024-currency-client", version: "1.0.0" },
      { capabilities: {} });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    t.after(async () => { await client.close(); await server.close(); });
    const call = (name, args) => client.callTool({ name, arguments: args });

    const absent = await call(NEW_TOOLS[0], { wk_id: "WK-2024" });
    assert.equal(absent.structuredContent.stage, "proof_authoring_required");

    await writeUnboundRecord(repoRoot);
    const skeleton = await issueBoundContinuation(call, {
      selectedPack: { profile_id: "proof.operation.forbidden-noninvocation",
        profile_version: "2.0.0" },
      requestedIntents: ["controlled-proof-intent.forbidden-operation-noninvocation"],
      evaluationInput
    });
    const published = await call(PROOF_GRAPH_ROUTE,
      { wk_id: "WK-2024", continuation: skeleton.continuation });
    assert.notEqual(published.isError, true,
      JSON.stringify(published.structuredContent));

    const beforeBuild = await call(NEW_TOOLS[0], { wk_id: "WK-2024" });
    assert.equal(beforeBuild.structuredContent.stage, "proof_plan_ready");
    assert.equal(beforeBuild.structuredContent.next_calls[0].arguments.expected_content_digest,
      null);

    const built = await call("workspace_controlled_proof_plan_build",
      { wk_id: "WK-2024", expected_content_digest: null });
    assert.notEqual(built.isError, true);

    const current = await call(NEW_TOOLS[0], { wk_id: "WK-2024" });
    assert.equal(current.structuredContent.stage, "complete");
    assert.equal(current.structuredContent.stop_condition,
      "controlled_contract_authoring_complete");
    const planDigest = current.structuredContent.selected_resources.proof_plan.content_digest;

    const patched = await call("workspace_controlled_contract_carrier_patch", {
      wk_id: "WK-2024", carrier_kind: "contract",
      expected_content_digest: current.structuredContent.selected_resources.contract.content_digest,
      operations: [{ op: "upsert", target: "residue", value: {
        ...structuredClone(contract.residue[0]),
        residue_id: "res-authoring-currency-regression",
        text: "A supported post-plan authoring revision recorded by the contract author."
      } }]
    });
    assert.notEqual(patched.isError, true);
    assert.equal(patched.structuredContent.invalidation.proof_plan, "stale");

    const stale = await call(NEW_TOOLS[0], { wk_id: "WK-2024" });

    assert.equal(Object.hasOwn(stale.structuredContent, "stop_condition"), false);
    assert.deepEqual(stale.structuredContent.unresolved_decisions.identities,
      ["proof_plan_compilation"]);
    assert.notEqual(planDigest, undefined);

    assert.equal(stale.structuredContent.authoring_evidence.residue_count,
      contract.residue.length + 1);
    assert.deepEqual(stale.structuredContent.authoring_evidence.non_authorizing_evidence,
      ["residue", "proof_execution_readiness"]);
    assert.equal(stale.structuredContent.next_calls.length, 1);
    assert.equal(stale.structuredContent.next_calls[0].tool,
      "workspace_controlled_proof_plan_build");

    const rebuilt = await call(stale.structuredContent.next_calls[0].tool,
      stale.structuredContent.next_calls[0].arguments);
    assert.notEqual(rebuilt.isError, true);
    const restored = await call(NEW_TOOLS[0], { wk_id: "WK-2024" });
    assert.equal(restored.structuredContent.stage, "complete");
  });

test("proof-graph continuation accepts only bounded identity and forwards it exactly", async () => {
  const calls = [];
  const { found, resolvedRepos } = proofGraphRegistrations({
    continueProofGraph: async (input) => {
      calls.push(input);
      return {
        schema_version: "controlled-contract-proof-graph-publication.v1",
        publication: { written: true, no_op: false },
        next_call: {
          tool: "workspace_controlled_contract_authoring_state",
          arguments: {
            wk_id: input.wkId,
            focus: input.focus,
            continuation: input.continuation
          }
        }
      };
    }
  });
  const route = found.get(PROOF_GRAPH_ROUTE);
  assert.ok(route);
  const continuation = "c".repeat(64);
  const accepted = {
    repo: "secondary",
    wk_id: "WK-2100",
    focus: "implementation-readiness",
    continuation
  };
  assert.equal(route.config.inputSchema.safeParse(accepted).success, true);
  assert.equal(route.config.inputSchema.safeParse({
    wk_id: "WK-2100", continuation
  }).success, true);
  for (const [field, value] of Object.entries({
    proposal: {}, proposal_draft: {}, paths: [], path: "wiki/contracts/forged.json",
    roots: [], root: "/tmp/forged", basenames: [], basename: "forged.json",
    refs: [], ref: "refs/heads/forged", shas: [], sha: "f".repeat(40),
    policy: {}, authority: {}, writer: {}, env: {}, environment: {},
    persistence: {}, persist: true, expected_manifest_digest: `sha256:${"d".repeat(64)}`
  })) {
    assert.equal(route.config.inputSchema.safeParse({
      wk_id: "WK-2100", continuation, [field]: value
    }).success, false, field);
  }
  const response = await route.handler(route.config.inputSchema.parse(accepted));
  assert.notEqual(response.isError, true);
  assert.deepEqual(resolvedRepos, ["secondary"]);
  assert.deepEqual(calls, [{
    repoRoot: ROOT,
    wkId: "WK-2100",
    focus: "implementation-readiness",
    continuation
  }]);
  assert.equal(JSON.stringify(response).includes("proposal"), false);
});

test("proof_graph_required state is projector-owned and bounded to 4096 UTF-8 bytes",
  async () => {
    const exact = projectedProofGraphStateAtBytes(TASK_AUTHORING_LIMIT);
    const inputs = [];
    const { found } = proofGraphRegistrations({
      readAuthoringState: async (input) => {
        inputs.push(input);
        return exact;
      }
    });
    const route = found.get("workspace_controlled_contract_authoring_state");
    const response = await route.handler({
      wk_id: "WK-2100", continuation: "a".repeat(64)
    });
    assert.deepEqual(inputs, [{
      repoRoot: ROOT,
      wkId: "WK-2100",
      focus: null,
      continuation: "a".repeat(64)
    }]);
    assert.equal(Buffer.byteLength(JSON.stringify(response.structuredContent, null, 2), "utf8"),
      TASK_AUTHORING_LIMIT);
    assert.deepEqual(response.structuredContent.next_calls, [{
      tool: PROOF_GRAPH_ROUTE,
      arguments: { wk_id: "WK-2100", continuation: "a".repeat(64) }
    }]);
    assert.deepEqual(response.structuredContent.unresolved_decisions, exact.unresolved_decisions);
    for (const forbidden of ["proposal", "carrier_operations", "expected_sources",
      "carriers", "candidate_populations", "compatible_candidates"]) {
      assert.equal(JSON.stringify(response.structuredContent).includes(forbidden), false,
        forbidden);
    }
    assert.throws(() => projectedProofGraphStateAtBytes(TASK_AUTHORING_LIMIT + 1),
      ({ code }) => code === "controlled_contract_authoring_projection_too_large");
  });

test("proof-graph continuation preserves the 8192-byte receipt ceiling and typed refusals",
  async () => {
    let carrierCount = 4;
    const receipt = (input) => ({
      schema_version: "controlled-contract-proof-graph-publication.v1",
      publication: {
        schema_version: "controlled-contract-carrier-set-publication.v1",
        profile: "canonical_authoring",
        wk_id: input.wkId,
        focus: input.focus,
        generation: "1".repeat(64),
        manifest_digest: `sha256:${"2".repeat(64)}`,
        manifest_content_digest: `sha256:${"3".repeat(64)}`,
        carrier_count: carrierCount,
        proposal_digest: `sha256:${"4".repeat(64)}`,
        written: true,
        no_op: false
      },
      next_call: {
        tool: "workspace_controlled_contract_authoring_state",
        arguments: {
          wk_id: input.wkId,
          focus: input.focus,
          continuation: input.continuation
        }
      }
    });
    const continuation = "e".repeat(64);
    const baseInput = { repoRoot: ROOT, wkId: "WK-2100", focus: "x", continuation };
    let exactFocus = null;
    for (const candidateCount of [4, 40]) {
      carrierCount = candidateCount;
      const baseBytes = Buffer.byteLength(JSON.stringify(receipt(baseInput)), "utf8");
      const remaining = 8192 - baseBytes;
      if (remaining >= 0 && remaining % 2 === 0) {
        exactFocus = "x".repeat(1 + remaining / 2);
        break;
      }
    }
    assert.notEqual(exactFocus, null);
    const { found } = proofGraphRegistrations({
      continueProofGraph: async (input) => {
        const result = receipt(input);
        if (Buffer.byteLength(JSON.stringify(result), "utf8") > 8192) {
          throw refusalError("controlled_contract_receipt_too_large", {
            byte_length: Buffer.byteLength(JSON.stringify(result), "utf8")
          });
        }
        return result;
      }
    });
    const route = found.get(PROOF_GRAPH_ROUTE);
    const exact = await route.handler({
      wk_id: "WK-2100", focus: exactFocus, continuation
    });
    assert.equal(Buffer.byteLength(JSON.stringify(exact.structuredContent), "utf8"), 8192);
    assert.equal(exact.structuredContent.response_spilled, undefined);
    const overflow = await route.handler({
      wk_id: "WK-2100", focus: `${exactFocus}x`, continuation
    });
    assert.equal(overflow.isError, true);
    assert.equal(overflow.structuredContent.warning.payload.reason_code,
      "controlled_contract_receipt_too_large");
    assert.equal(JSON.stringify(overflow).includes("content_reference"), false);

    const refusalCodes = [
      "controlled_contract_authoring_continuation_invalid",
      "controlled_contract_authoring_continuation_unknown",
      "controlled_contract_authoring_continuation_tampered",
      "controlled_contract_authoring_continuation_stale",
      "controlled_contract_authoring_continuation_cross_wk",
      "controlled_contract_authoring_continuation_cross_focus",
      "controlled_contract_authoring_continuation_carrier_conflict",
      "controlled_contract_proof_graph_proposal_incomplete",
      "controlled_contract_proof_graph_cross_carrier_identity_conflict",
      "controlled_contract_proof_graph_bound_exceeded"
    ];
    for (const reasonCode of refusalCodes) {
      const refusalRoute = proofGraphRegistrations({
        continueProofGraph: async () => {
          throw refusalError(reasonCode, { replacement_call: {
            tool: "workspace_controlled_contract_authoring_state",
            arguments: { wk_id: "WK-2100" }
          } });
        }
      }).found.get(PROOF_GRAPH_ROUTE);
      const refused = await refusalRoute.handler({ wk_id: "WK-2100", continuation });
      assert.equal(refused.isError, true, reasonCode);
      assert.equal(refused.structuredContent.warning.payload.reason_code, reasonCode);
      assert.equal(refused.structuredContent.warning.payload.details.replacement_call.tool,
        "workspace_controlled_contract_authoring_state");
    }
  });

test("registration, discovery, and role policy agree with zero worker exposure", async () => {
  const discovery = JSON.parse(await readFile(path.join(ROOT,
    "packages/wiki-core/data/tool-discovery/controlled-contract-tools.json"), "utf8"));
  const policy = JSON.parse(await readFile(path.join(ROOT,
    "packages/wiki-core/data/tool-discovery/session-role-tool-access.json"), "utf8"));
  assert.deepEqual(discovery.tools.map(({ tool_name }) => tool_name),
    [...CONTROLLED_CONTRACT_MCP_TOOL_NAMES]);

  const skeletonNotes = discovery.tools.find(({ tool_name: name }) =>
    name === "workspace_controlled_proof_authoring_skeleton").notes;
  for (const retiredField of ["expected_sources", "expectedSources"]) {
    assert.equal(skeletonNotes.includes(retiredField), false, retiredField);
  }
  for (const phrase of [
    "public schema accepts no caller source declaration",
    "Continuation-integrity failures remain typed and distinct",
    "docs/mcp-operation-reference.md"
  ]) assert.ok(skeletonNotes.includes(phrase), phrase);
  for (const name of NEW_TOOLS) {
    assert.ok(policy.access[name]);
    assert.equal(policy.access[name].includes("worker"), false);
  }
  assert.deepEqual(policy.access.workspace_controlled_contract_authoring_state,
    ["orchestrator", "reviewer", "redteam", "operator"]);
  assert.deepEqual(policy.access[PROOF_GRAPH_ROUTE], ["orchestrator", "operator"]);
  assert.deepEqual(policy.access.workspace_controlled_proof_authoring_skeleton,
    ["orchestrator", "operator"]);
  assert.deepEqual(policy.access.workspace_controlled_contract_authoring_continue,
    ["orchestrator", "operator"]);
  assert.deepEqual(policy.access.workspace_controlled_verification_bundle_patch,
    ["orchestrator", "operator"]);
  assert.deepEqual(policy.access[INTEGRATION_PREFIX_ROUTE], ["orchestrator", "operator"]);
});

test("integration-prefix capture route delegates exact server-resolved identity once", async () => {
  const calls = [];
  const found = integrationPrefixRegistrations({ author: async (input) => {
    calls.push(input);
    return integrationPrefixReceipt();
  } });
  const route = found.get(INTEGRATION_PREFIX_ROUTE);
  assert.ok(route);

  const parsed = route.config.inputSchema.parse({
    wk_id: "WK-2063",
    profile_id: INTEGRATION_PREFIX_PROFILE.profile_id,
    profile_version: INTEGRATION_PREFIX_PROFILE.profile_version
  });
  const response = await route.handler(parsed);
  assert.deepEqual(calls, [{ repoRoot: ROOT, wkId: "WK-2063", focus: null }]);
  assert.deepEqual(response.structuredContent, integrationPrefixReceipt());
  assert.equal(Buffer.byteLength(JSON.stringify(response.structuredContent, null, 2)) <= 8192,
    true);
  for (const population of ["claims", "slices", "paths", "branches", "carriers"]) {
    assert.equal(Object.hasOwn(response.structuredContent, population), false, population);
  }
});

test("integration-prefix capture route rejects caller authority before authoring", async () => {
  let calls = 0;
  const route = integrationPrefixRegistrations({ author: async () => {
    calls += 1;
    return integrationPrefixReceipt();
  } }).get(INTEGRATION_PREFIX_ROUTE);
  const accepted = [
    { wk_id: "WK-2063" },
    { wk_id: "WK-2063", focus: "implementation-readiness" },
    { wk_id: "WK-2063", profile_id: INTEGRATION_PREFIX_PROFILE.profile_id },
    { wk_id: "WK-2063",
      profile_version: INTEGRATION_PREFIX_PROFILE.profile_version }
  ];
  for (const input of accepted) assert.equal(route.config.inputSchema.safeParse(input).success,
    true, JSON.stringify(input));
  for (const [field, value] of Object.entries({
    repo: "other", repoRoot: "/tmp/forged", path: "/tmp/forged", carrier_paths: [],
    carriers: [], population: [], completeness: true, env: {}, authority: "operator",
    writer: {}, payload: {}, root: "/tmp/forged"
  })) assert.equal(route.config.inputSchema.safeParse({
    wk_id: "WK-2063", [field]: value
  }).success, false, field);
  for (const input of [
    { wk_id: "WK-2063", profile_id: "proof.other" },
    { wk_id: "WK-2063", profile_version: "0.0.1" },
    { wk_id: "WK-2063", focus: "../forged" }
  ]) assert.equal(route.config.inputSchema.safeParse(input).success, false,
    JSON.stringify(input));
  assert.equal(calls, 0);
});

test("integration-prefix capture route preserves typed core refusal without a receipt", async () => {
  const coreError = new Error("repository identity differs");
  coreError.code = "controlled_contract_carrier_set_wrong_repository";
  coreError.envelope = {
    schema_version: "controlled-contract-mcp-refusal.v1",
    ok: false,
    warning: { code: "controlled_contract_request_refused", severity: "blocking",
      message: "controlled-contract MCP request refused",
      payload: { schema_version: "controlled-contract-refusal-payload.v1",
        reason_code: coreError.code, details: { expected: "canonical", actual: "foreign" } } }
  };
  let calls = 0;
  const route = integrationPrefixRegistrations({ author: async () => {
    calls += 1;
    throw coreError;
  } }).get(INTEGRATION_PREFIX_ROUTE);
  const response = await route.handler({ wk_id: "WK-2063" });
  assert.equal(calls, 1);
  assert.equal(response.isError, true);
  assert.deepEqual(response.structuredContent, coreError.envelope);
  assert.equal(JSON.stringify(response).includes("generation"), false);
  assert.equal(JSON.stringify(response).includes("published"), false);
});

test("integration-prefix capture overflow fails loudly without a content reference",
  async (t) => {
    const stateDir = await mkdtemp(path.join(os.tmpdir(), "wk-2071-mcp-receipt-"));
    t.after(() => rm(stateDir, { recursive: true, force: true }));
    const members = Array.from({ length: 500 }, (_, index) =>
      `synthetic-population-member-${index}-${"x".repeat(64)}`);
    const env = { WIKI_MCP_RESPONSE_STATE_DIR: stateDir };
    const route = integrationPrefixRegistrations({
      author: async () => integrationPrefixReceipt({ population: members }),
      json: (value, options = {}) => jsonContent(value, { env, ...options })
    }).get(INTEGRATION_PREFIX_ROUTE);
    const response = await route.handler({ wk_id: "WK-2063" });
    assert.equal(response.isError, true);
    const serialized = JSON.stringify(response);
    assert.equal(serialized.includes("content_reference"), false);
    assert.equal(serialized.includes("response_spilled"), false);
    for (const member of members) assert.equal(serialized.includes(member), false, member);
  });

test("test-proof MCP routes expose package semantics and refuse non-replacement edits",
  async (t) => {
    const { repoRoot } = await fixture();
    t.after(() => rm(repoRoot, { recursive: true, force: true }));
    const server = new McpServer({ name: "wk-2024-test-proof", version: "1.0.0" });
    registerControlledContractTools({
      registerTool: server.registerTool.bind(server),
      workspaceRepos: { currentAlias: "current" },
      z, jsonContent, errorContent,
      resolveWorkspaceRepo: () => ({ repo: "current", dir: repoRoot })
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "wk-2024-test-proof-client", version: "1.0.0" },
      { capabilities: {} });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    t.after(async () => { await client.close(); await server.close(); });

    const description = await client.callTool({
      name: "workspace_controlled_test_proof_authoring_describe", arguments: {}
    });
    assert.notEqual(description.isError, true);
    assert.equal(description.structuredContent.contract_schema_version,
      "controlled-acceptance-contract.v1");
    assert.deepEqual(description.structuredContent.operations,
      ["query", "replace", "verification_bundle_patch"]);

    const base = JSON.parse(await readFile(path.join(ROOT,
      "packages/controlled-contract/examples/minimal-controlled-acceptance-contract-v034.json")));
    const stable = migrateControlledAcceptanceContractV02ToV1({
      contract: base, testProofs: [testProofBinding()]
    });
    await writeFile(path.join(repoRoot, "wiki/contracts/WK-2024.controlled-acceptance.json"),
      `${JSON.stringify(stable, null, 2)}\n`);

    const selected = await client.callTool({
      name: "workspace_controlled_test_proof_query",
      arguments: {wk_id: "WK-2024", verification_ids: ["claim-suite-covers-component"]}
    });
    assert.notEqual(selected.isError, true);
    assert.equal(selected.structuredContent.status, "complete");
    assert.equal(selected.structuredContent.matched_count, 1);
    assert.equal(Object.hasOwn(selected.structuredContent, "content"), false);

    const refused = await client.callTool({
      name: "workspace_controlled_test_proof_patch",
      arguments: {wk_id: "WK-2024", expected_content_digest: selected.structuredContent.content_digest,
        operations: [{op: "remove", verification_id: "claim-suite-covers-component"}]}
    });
    assert.equal(refused.isError, true);
    assert.match(refused.content[0].text, /Invalid literal value, expected \\"replace\\"/u);
  });
