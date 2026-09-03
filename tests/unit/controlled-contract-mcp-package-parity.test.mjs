import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import {
  CONTROLLED_CONTRACT_ASSESSMENT_COLLECTION_DESCRIPTORS,
  CONTROLLED_CONTRACT_ASSESSMENT_PROJECTION_VOCABULARY,
  assessProofPlanFiles,
  buildControlledContractAssessmentRecovery,
  buildProofPlan,
  compactMultiPackAssessment,
  describeProofPackAuthoring,
  discoverProofIntents,
  inspectProofPackBindings,
  inspectProofPackBindingsPage,
  searchVocabulary
} from "../../packages/controlled-contract/current.mjs";
import { selectProofPacksV2 } from
  "../../packages/controlled-contract/lib/proof-intent-selection.mjs";
import { buildRefusalBeforeEffectsFixture } from
  "../../packages/controlled-contract/test/proof-packs/refusal-before-effects-fixture.mjs";
import { buildStableTestProofPopulation } from
  "../../packages/controlled-contract/test/support/stable-v1-proof-pack-runtime.mjs";
import {
  assessControlledContractOperation,
  buildProofPlanOperation,
  createControlledContractCarrierOperation,
  describeControlledContractAuthoringOperation,
  describeProofPackOperation,
  discoverControlledProofIntentsOperation,
  inspectProofPackBindingsOperation,
  persistControlledContractGenerationOperation,
  queryControlledVocabularyOperation,
  readControlledContractCarrierOperation,
  selectProofPacksOperation,
  writeControlledContractCarrierOperation
} from "../../packages/wiki-core/src/operations/controlled-contract.mjs";
import { controlledContractPackCarrierFilename } from
  "../../packages/wiki-core/src/lib/controlled-contract-tools.mjs";
import * as controlledContractCoreTools from
  "../../packages/wiki-core/src/lib/controlled-contract-tools.mjs";
import * as controlledContractDirectProofAuthoringTools from
  "@agent-chassis/wiki-core/src/lib/controlled-contract-proof-authoring-tools.mjs";
import {
  CONTROLLED_CONTRACT_MCP_TOOL_NAMES,
  materializeControlledContractAssessmentResponse,
  registerControlledContractTools
} from
  "../../packages/wiki-mcp/src/lib/controlled-contract-tools.mjs";
import { assertNoControlledContractRawResponse, errorContent, jsonContent } from
  "../../packages/wiki-mcp/src/lib/mcp-response.mjs";
import { CONTROLLED_CONTRACT_ASSESSMENT_NON_AUTHORITY } from
  "../../packages/wiki-core/src/operations/controlled-contract/assessment-semantic-projection.mjs";

const REPO = path.resolve(import.meta.dirname, "../..");
const CONTRACTS = path.join(REPO, "wiki", "contracts");

async function json(name) {
  return JSON.parse(await readFile(path.join(CONTRACTS, name), "utf8"));
}

async function refusalCode(promise) {
  try {
    await promise;
  } catch (error) {
    return error?.envelope?.warning?.payload?.reason_code ?? null;
  }
  assert.fail("operation should refuse");
}

function assertRecoveryProjection(actual, expected) {
  assert.deepEqual(actual, {
    status: "recoverable-incomplete",
    reason_code: expected.reason_code,
    contract_identity: expected.contract_identity,
    next_calls: expected.next_calls,
    next_action: expected.next_action,
    ...(expected.missing_carrier === undefined
      ? {}
      : { missing_carrier: expected.missing_carrier }),
    ...(expected.stale_carrier === undefined
      ? {}
      : { stale_carrier: expected.stale_carrier }),
    ...(expected.expected_content_digest === undefined
      ? {}
      : { expected_content_digest: expected.expected_content_digest })
  });
}

test("controlled-contract package is the sole public recovery projection owner", () => {
  assert.equal(
    Object.hasOwn(controlledContractCoreTools, "buildControlledContractRecoveryDecision"),
    false
  );
  assert.equal(
    Object.hasOwn(
      controlledContractDirectProofAuthoringTools,
      "buildControlledContractRecoveryDecision"
    ),
    false
  );
  assert.equal(typeof buildControlledContractAssessmentRecovery, "function");
});

test("assessment descriptors, query schemas, discovery, and public guard stay exact", async () => {
  const registered = new Map();
  registerControlledContractTools({
    registerTool: (name, config, handler) => registered.set(name, { config, handler }),
    workspaceRepos: { currentAlias: "current", repos: new Map([["current", REPO]]) },
    z,
    jsonContent: (value) => ({ structuredContent: value }),
    errorContent: (error) => ({ isError: true, structuredContent: error.envelope }),
    resolveWorkspaceRepo: () => ({ repo: "current", dir: REPO })
  });
  for (const route of [
    "workspace_controlled_contract_assessment_query",
    "workspace_controlled_contract_integration_test_design_query"
  ]) {
    const schema = zodToJsonSchema(registered.get(route).config.inputSchema);
    for (const field of ["assessment_identity", "collection", "selector", "cursor",
      "field_path", "offset", "length"]) assert(Object.hasOwn(schema.properties, field), field);
  }
  const discovery = JSON.parse(await readFile(path.join(
    REPO, "packages/wiki-core/data/tool-discovery/controlled-contract-tools.json"
  ), "utf8"));
  const assessmentRows = discovery.tools.filter(({ tool_name: name }) => [
    "workspace_controlled_contract_assess",
    "workspace_controlled_contract_assessment_query",
    "workspace_controlled_contract_integration_test_design_assess",
    "workspace_controlled_contract_integration_test_design_query"
  ].includes(name));
  assert.equal(assessmentRows.length, 4);
  assert.equal(JSON.stringify(assessmentRows).includes("completeness_exemption"), false);
  assert.equal(JSON.stringify(assessmentRows).includes("typed field"), true);
  assert.equal(JSON.stringify(assessmentRows).includes("offset/length"), true);

  for (const family of ["proof", "integration_test_design"]) {
    const counts = Object.fromEntries(
      CONTROLLED_CONTRACT_ASSESSMENT_COLLECTION_DESCRIPTORS[family]
        .map(({ collection }) => [collection, 0])
    );
    const result = {
      schema_version: family === "proof"
        ? "controlled-contract-proof-assessment-summary.v1"
        : "controlled-contract-integration-assessment-summary.v1",
      family,
      state: "review_only",
      authority: CONTROLLED_CONTRACT_ASSESSMENT_NON_AUTHORITY,
      source: {}, source_current: true, counts, total_count: 0, omitted_count: 0,
      compact_omission: CONTROLLED_CONTRACT_ASSESSMENT_PROJECTION_VOCABULARY.compact_omission,
      continuation: CONTROLLED_CONTRACT_ASSESSMENT_PROJECTION_VOCABULARY.continuation,
      supported_next_call: family === "proof"
        ? "workspace_controlled_contract_assessment_query"
        : "workspace_controlled_contract_integration_test_design_query",
      first_actionable_gaps: [], first_actionable_gap_count: 0,
      omitted_actionable_gap_count: 0
    };
    const materialized = materializeControlledContractAssessmentResponse({
      result, snapshot: { assessment: {}, source_identity: {} }, family,
      workspaceRepo: family === "proof" ? "current" : null,
      snapshots: { put: () => "I".repeat(43) }
    });
    assert.equal(assertNoControlledContractRawResponse(materialized), materialized);
    for (const mutant of [
      { ...materialized, assessment_identity: null },
      { ...materialized, total_count: 1 },
      { ...materialized, completeness_exemption: "legacy" },
      { ...materialized, detail_digest: `sha256:${"0".repeat(64)}` }
    ]) assert.throws(() => assertNoControlledContractRawResponse(mutant));
  }
});

test("both registered assessment handlers preserve the common unexpected-exception diagnostic", async () => {
  for (const routeName of [
    "workspace_controlled_contract_assess",
    "workspace_controlled_contract_integration_test_design_assess"
  ]) {
    const registered = new Map();
    const marker = `${routeName}-unexpected-marker`;
    registerControlledContractTools({
      registerTool: (name, config, handler) => registered.set(name, { config, handler }),
      workspaceRepos: { currentAlias: "current", repos: new Map([["current", REPO]]) },
      z, jsonContent, errorContent,
      resolveWorkspaceRepo: () => {
        if (routeName === "workspace_controlled_contract_assess") throw new Error(marker);
        return { repo: "current", dir: REPO };
      },
      assessIntegrationTestDesign: async () => { throw new Error(marker); }
    });
    const args = routeName === "workspace_controlled_contract_assess"
      ? { repo: "current", wk_id: "WK-2461" }
      : {
          repo: "current", unit: "WK-2461", axis_applicability: [],
          declared_integration_tests: [], integration_scenarios: [],
          interaction_requirements: [], review_questions: []
        };
    const response = await registered.get(routeName).handler(args);
    assert.equal(response.isError, true);
    assert.deepEqual(JSON.parse(response.content[0].text), response.structuredContent);
    assert.equal(response.structuredContent.schema_version, "mcp-response-refusal.v1");
    assert.match(response.structuredContent.diagnostic, new RegExp(marker, "u"));
    assert.deepEqual(response.structuredContent.diagnostic_redactions, []);
  }
});

const RECOVERY_WK = "WK-2225";
const RECOVERY_FOCUS = "test-verification-validity";

function recoveryStem(wkId, focus) {
  return focus === null ? wkId : `${wkId}-${focus}`;
}

async function makeRecoveryRoot({
  wkId = RECOVERY_WK, focus = null, includeProofPlanRequest = true
} = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "stable-v1-recovery-parity-"));
  const directory = path.join(root, "wiki", "contracts");
  await mkdir(directory, { recursive: true });
  await mkdir(path.join(root, "wiki", "work-records"), { recursive: true });
  await writeFile(path.join(root, "wiki", "work-records", `${wkId}.json`),
    await readFile(path.join(REPO, "wiki", "work-records", `${wkId}.json`)));
  const stem = recoveryStem(wkId, focus);
  for (const suffix of ["controlled-acceptance.json", "evaluation-input.json"]) {
    await writeFile(path.join(directory, `${stem}.${suffix}`),
      await readFile(path.join(CONTRACTS, `${wkId}.${suffix}`)));
  }
  if (includeProofPlanRequest) {
    const request = await json(`${wkId}.proof-plan-request.json`);
    await writeFile(path.join(directory, `${stem}.proof-plan-request.json`),
      `${JSON.stringify({
        ...request,
        selected_packs: request.selected_packs.map((pack) => ({
          ...pack,
          evaluation_input_path: `${stem}.evaluation-input.json`
        }))
      }, null, 2)}\n`);
  }
  return root;
}

async function expectedMissingRecovery(repoRoot, focus, wkId = RECOVERY_WK) {
  const contract = await readControlledContractCarrierOperation({
    repoRoot, wkId, focus, carrierKind: "contract"
  });
  const nextCalls = [{
    tool: "workspace_controlled_proof_plan_build",
    arguments: {
      wk_id: wkId,
      ...(focus === null ? {} : { focus }),
      expected_content_digest: null
    },
    recommended: true
  }];
  return {
    status: "recoverable-incomplete",
    reason_code: "controlled_contract_proof_plan_missing",
    contract_identity: {
      carrier_kind: "contract", wk_id: wkId, focus,
      content_digest: contract.content_digest
    },
    next_calls: nextCalls,
    next_action: focus === null
      ? `workspace_controlled_proof_plan_build({wk_id:"${wkId}", expected_content_digest:null})`
      : `workspace_controlled_proof_plan_build({wk_id:"${wkId}", focus:"${focus}", expected_content_digest:null})`,
    missing_carrier: "proof_plan",
    expected_content_digest: null
  };
}

function makeSchemaStub() {
  const schema = new Proxy(() => schema, {
    apply: () => schema,
    get: () => schema
  });
  return schema;
}

async function invokeMcpTool(name, args, repoRoot, persistence = {}) {
  const tools = new Map();
  const schema = makeSchemaStub();
  registerControlledContractTools({
    registerTool: (toolName, _descriptor, handler) => tools.set(toolName, handler),
    workspaceRepos: new Map([[
      "test",
      { repo: "test", dir: repoRoot }
    ]]),
    z: new Proxy({}, { get: () => schema }),
    jsonContent: (value) => ({ structuredContent: value }),
    errorContent: (error) => { throw error; },
    resolveWorkspaceRepo: (repos, repo) => repos.get(repo),
    resolveControlledContractGenerationBinding:
      persistence.resolveControlledContractGenerationBinding,
    persistControlledContractGeneration:
      persistence.persistControlledContractGeneration
  });
  return (await tools.get(name)(args)).structuredContent;
}

test("acceptance-coverage package definitions and MCP registration have exact route/schema parity", () => {
  const registered = new Map();
  registerControlledContractTools({
    registerTool: (name, config, handler) => registered.set(name, { config, handler }),
    workspaceRepos: { currentAlias: "current", repos: new Map([["current", REPO]]) },
    z,
    jsonContent: (value) => ({ structuredContent: value }),
    errorContent: (error) => ({ isError: true, structuredContent: error.envelope }),
    resolveWorkspaceRepo: () => ({ repo: "current", dir: REPO })
  });
  const definitions =
    controlledContractCoreTools.CONTROLLED_CONTRACT_ACCEPTANCE_COVERAGE_TOOL_DEFINITIONS;
  assert.deepEqual(definitions.map(({ name }) => name), [
    "workspace_controlled_contract_acceptance_coverage_describe",
    "workspace_controlled_contract_acceptance_coverage_create",
    "workspace_controlled_contract_acceptance_coverage_upsert",
    "workspace_controlled_contract_acceptance_coverage_remove",
    "workspace_controlled_contract_acceptance_coverage_query"
  ]);
  for (const definition of definitions) {
    const published = zodToJsonSchema(registered.get(definition.name).config.inputSchema);
    assert.equal(published.type, "object", definition.name);
    assert.equal(published.additionalProperties, false, definition.name);
    assert.deepEqual(Object.keys(published.properties).sort(),
      Object.keys(definition.inputSchema.properties).sort(), definition.name);
    assert.deepEqual((published.required ?? []).sort(),
      (definition.inputSchema.required ?? []).sort(), definition.name);
  }
  for (const definition of definitions.slice(1, 4)) {
    const output = definition.outputSchema;
    assert.equal(output.additionalProperties, false, definition.name);
    assert.ok(output.required.includes("next_calls"), definition.name);
    assert.deepEqual(output.properties.next_calls, {
      type: "array", minItems: 1, maxItems: 1,
      items: {
        type: "object", additionalProperties: false,
        required: ["tool", "arguments"],
        properties: {
          tool: { const: "workspace_controlled_contract_acceptance_coverage_query" },
          arguments: {
            type: "object", additionalProperties: false,
            required: ["unit"],
            properties: {
              unit: { type: "string",
                pattern: "^WK-[0-9]{4}(?:#SLICE-[0-9]{3,})?$" },
              focus: { type: "string",
                pattern: "^(?!wk-[0-9])(?!slice-[0-9]+$)[a-z0-9]+(?:-[a-z0-9]+)*$" }
            }
          }
        }
      }
    });
  }
  const acceptancePatchDefinition = controlledContractCoreTools
    .CONTROLLED_CONTRACT_ACCEPTANCE_COVERAGE_PATCH_TOOL;
  const acceptancePatchPublished = zodToJsonSchema(
    registered.get(acceptancePatchDefinition.name).config.inputSchema);
  assert.equal(acceptancePatchPublished.additionalProperties, false);
  assert.deepEqual(Object.keys(acceptancePatchPublished.properties).sort(),
    Object.keys(acceptancePatchDefinition.inputSchema.properties).sort());
  assert.deepEqual((acceptancePatchPublished.required ?? []).sort(),
    (acceptancePatchDefinition.inputSchema.required ?? []).sort());
  assert.equal(acceptancePatchPublished.properties.operations.minItems, 1);
  assert.equal(Object.hasOwn(acceptancePatchPublished.properties.operations, "maxItems"), false);
  assert.equal(
    controlledContractCoreTools
      .CONTROLLED_CONTRACT_ACCEPTANCE_COVERAGE_RESULT_SCHEMA_POPULATIONS.length,
    13
  );

  const obligationDefinitions =
    controlledContractCoreTools.CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_TOOL_DEFINITIONS;
  assert.deepEqual(obligationDefinitions.map(({ name }) => name), [
    "workspace_controlled_contract_obligation_coverage_describe",
    "workspace_controlled_contract_obligation_coverage_create",
    "workspace_controlled_contract_obligation_coverage_upsert",
    "workspace_controlled_contract_obligation_coverage_remove",
    "workspace_controlled_contract_obligation_coverage_query"
  ]);
  for (const definition of obligationDefinitions) {
    const published = zodToJsonSchema(registered.get(definition.name).config.inputSchema);
    assert.equal(published.type, "object", definition.name);
    assert.equal(published.additionalProperties, false, definition.name);
    assert.deepEqual(Object.keys(published.properties).sort(),
      Object.keys(definition.inputSchema.properties).sort(), definition.name);
    assert.deepEqual((published.required ?? []).sort(),
      (definition.inputSchema.required ?? []).sort(), definition.name);
  }
  for (const definition of obligationDefinitions.slice(1, 4)) {
    const output = definition.outputSchema;
    assert.equal(output.additionalProperties, false, definition.name);
    assert.ok(output.required.includes("next_calls"), definition.name);
    assert.equal(output.properties.next_calls.minItems, 1, definition.name);
    assert.equal(output.properties.next_calls.maxItems, 1, definition.name);
    assert.equal(output.properties.next_calls.items.additionalProperties, false,
      definition.name);
    assert.equal(output.properties.next_calls.items.properties.tool.const,
      "workspace_controlled_contract_obligation_coverage_query", definition.name);
    assert.equal(output.properties.next_calls.items.properties.arguments
      .additionalProperties, false, definition.name);
    assert.deepEqual(output.properties.next_calls.items.properties.arguments.required,
      ["unit"], definition.name);
    assert.deepEqual(Object.keys(output.properties.next_calls.items.properties.arguments
      .properties).sort(), ["focus", "unit"], definition.name);
  }
  const obligationPatchDefinition = controlledContractCoreTools
    .CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_PATCH_TOOL;
  const obligationPatchPublished = zodToJsonSchema(
    registered.get(obligationPatchDefinition.name).config.inputSchema);
  assert.equal(obligationPatchPublished.additionalProperties, false);
  assert.deepEqual(Object.keys(obligationPatchPublished.properties).sort(),
    Object.keys(obligationPatchDefinition.inputSchema.properties).sort());
  assert.deepEqual((obligationPatchPublished.required ?? []).sort(),
    (obligationPatchDefinition.inputSchema.required ?? []).sort());
  assert.equal(obligationPatchPublished.properties.operations.minItems, 1);
  assert.equal(Object.hasOwn(obligationPatchPublished.properties.operations, "maxItems"), false);
  assert.equal(
    controlledContractCoreTools
      .CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_RESULT_SCHEMA_POPULATIONS.length,
    25
  );

  const designDefinition = controlledContractCoreTools
    .CONTROLLED_CONTRACT_INTEGRATION_TEST_DESIGN_ASSESS_TOOL;
  assert.equal(designDefinition.name,
    "workspace_controlled_contract_integration_test_design_assess");
  const designPublished = zodToJsonSchema(
    registered.get(designDefinition.name).config.inputSchema
  );
  assert.equal(designPublished.type, "object");
  assert.equal(designPublished.additionalProperties, false);
  assert.deepEqual(Object.keys(designPublished.properties).sort(),
    Object.keys(designDefinition.inputSchema.properties).sort());
  assert.deepEqual((designPublished.required ?? []).sort(),
    (designDefinition.inputSchema.required ?? []).sort());
  assert.deepEqual(
    controlledContractCoreTools
      .CONTROLLED_CONTRACT_INTEGRATION_TEST_DESIGN_RESULT_SCHEMA_POPULATIONS,
    ["pass", "fail", "incomplete", "unevaluable", "review_only"]
  );
});

async function manifestCarrierPath(directory, wkId, carrierKind, focus = null) {
  const manifest = JSON.parse(await readFile(path.join(directory,
    `${focus === null ? wkId : `${wkId}-${focus}`}.carrier-set-manifest.json`), "utf8"));
  const member = manifest.carriers.find(
    ({ carrier_kind: kind }) => kind === carrierKind);
  assert.ok(member, `${carrierKind} is absent from the published carrier set`);
  return path.join(directory, member.path);
}

const HETEROGENEOUS_STEM = "WK-2327";
const HETEROGENEOUS_PACKS = Object.freeze([
  Object.freeze({ profile_id: "proof.verification.test-validity",
    profile_version: "2.0.0" }),
  Object.freeze({ profile_id: "proof.operation.forbidden-noninvocation",
    profile_version: "2.0.0" })
]);
const REFUSAL_BEFORE_EFFECTS_PACK = Object.freeze({
  profile_id: "proof.authorization.refusal-before-effects",
  profile_version: "2.0.0"
});
const REFUSAL_BEFORE_EFFECTS_STEM = "WK-2271";
const REFUSAL_BEFORE_EFFECTS_EVALUATION_INPUT = "WK-2271.pack-sha256-" +
  "238a0e0e5b7d4018746dcdaaee6da3e378d9e9c300e6ff19281342198d3657fe" +
  ".evaluation-input.json";
const STABLE_V1_GENERATION_STEM = "WK-2225";
const STABLE_V1_GENERATION_INITIATIVE = "IN-0016";
const STABLE_V1_GENERATION_CARRIER_COUNT = 4;

async function makeStableV1GenerationRoot(stem) {
  const root = await mkdtemp(path.join(os.tmpdir(), "stable-v1-generation-parity-"));
  const directory = path.join(root, "wiki", "contracts");
  await mkdir(directory, { recursive: true });
  for (const name of (await readdir(CONTRACTS)).filter((entry) =>
    entry.startsWith(`${stem}.`) && !entry.endsWith(".carrier-set-manifest.json"))) {
    await writeFile(path.join(directory, name),
      await readFile(path.join(CONTRACTS, name)));
  }
  return root;
}

function stableGenerationPersistenceComposition(wkId, initiative) {
  const receiptFor = (generation) => Object.freeze({
    schema_version: "controlled-contract-generation-persistence-receipt.v1",
    record_id: wkId,
    initiative,
    ref: `refs/heads/wk/${initiative}/${wkId}`,
    record_source_digest: `sha256:${"1".repeat(64)}`,
    bound_tip: "2".repeat(40),
    final_tip: "3".repeat(40),
    disposition: "created",
    invocation: Object.freeze({
      commit: "3".repeat(40),
      commit_created: true,
      ref_write_succeeded: true
    }),
    generation: Object.freeze({
      count: generation.count,
      digest: generation.generation_digest,
      descriptors: generation.descriptors.map(
        ({ path: carrierPath, content_digest: contentDigest }) => ({
          path: carrierPath, content_digest: contentDigest
        })
      )
    })
  });
  return {
    resolveControlledContractGenerationBinding: async (request) =>
      Object.freeze({ generation: request.generation }),
    persistControlledContractGeneration: async ({ binding }) =>
      receiptFor(binding.generation)
  };
}

test("generation persistence remains a host primitive and is absent from MCP", async (t) => {
  const root = await makeStableV1GenerationRoot(STABLE_V1_GENERATION_STEM);
  t.after(() => rm(root, { recursive: true, force: true }));
  const composition = stableGenerationPersistenceComposition(
    STABLE_V1_GENERATION_STEM, STABLE_V1_GENERATION_INITIATIVE
  );
  const direct = await persistControlledContractGenerationOperation({
    repoRoot: root,
    wkId: STABLE_V1_GENERATION_STEM
  }, {
    resolveGenerationBinding: composition.resolveControlledContractGenerationBinding,
    persistGeneration: composition.persistControlledContractGeneration
  });
  assert.equal(CONTROLLED_CONTRACT_MCP_TOOL_NAMES.includes(
    "workspace_controlled_contract_generation_persist"), false);
  assert.equal(direct.generation.count, STABLE_V1_GENERATION_CARRIER_COUNT);
  assert.deepEqual(direct.generation.descriptors.map(({ path: carrierPath }) => carrierPath),
    [
      `wiki/contracts/${STABLE_V1_GENERATION_STEM}.controlled-acceptance.json`,
      `wiki/contracts/${STABLE_V1_GENERATION_STEM}.evaluation-input.json`,
      `wiki/contracts/${STABLE_V1_GENERATION_STEM}.proof-plan-request.json`,
      `wiki/contracts/${STABLE_V1_GENERATION_STEM}.proof-plan.json`
    ]);
});

test("vocabulary, discovery, exact selection, description, and binding inspection preserve package semantics", async () => {
  const vocabularyInput = { text: "population", kinds: ["type_term", "operator"] };
  assert.deepEqual(await queryControlledVocabularyOperation(vocabularyInput),
    searchVocabulary(vocabularyInput));

  const discoveryInput = { query: "lossless projection", limit: 4 };
  assert.deepEqual(await discoverControlledProofIntentsOperation(discoveryInput),
    discoverProofIntents(discoveryInput));

  const contract = await json(`${REFUSAL_BEFORE_EFFECTS_STEM}.controlled-acceptance.json`);
  const intents = ["controlled-proof-intent.refusal-before-effects"];
  const packageSelection = selectProofPacksV2({
    contract,
    requestedIntents: intents
  });
  const semanticSelection = await selectProofPacksOperation({
    repoRoot: REPO,
    wkId: REFUSAL_BEFORE_EFFECTS_STEM,
    requestedIntents: intents
  });
  assert.deepEqual(semanticSelection.task.requested_intent_ids,
    packageSelection.requested_intents);
  assert.deepEqual(semanticSelection.candidates.map(({ profile_id, profile_version }) => ({
    profile_id, profile_version
  })), packageSelection.candidates.map(({ profile_id, profile_version }) => ({
    profile_id, profile_version
  })));
  assert.deepEqual(semanticSelection.selection.decision,
    packageSelection.decision);
  assert.deepEqual(semanticSelection.selection.per_intent_outcomes,
    packageSelection.per_intent_outcomes);
  assert.deepEqual(semanticSelection.selection.compatible_candidates.map(
    (candidate) => Object.fromEntries(Object.entries(candidate)
      .filter(([key]) => key !== "inspection_calls"))
  ), packageSelection.compatible_candidates);
  assert.deepEqual(semanticSelection.selection.hard_incompatibilities,
    packageSelection.hard_incompatibilities);
  assert.equal(Object.hasOwn(semanticSelection, "selection_facts"), false);

  const [compatibleCandidate] = semanticSelection.selection.compatible_candidates;
  const descriptionCall = compatibleCandidate.inspection_calls.find(({ tool }) =>
    tool === "workspace_controlled_proof_pack_describe");
  const bindingInspectionCall = compatibleCandidate.inspection_calls.find(({ tool }) =>
    tool === "workspace_controlled_proof_pack_bindings_inspect");
  assert.ok(descriptionCall);
  assert.ok(bindingInspectionCall);

  const descriptionInput = {
    profileId: descriptionCall.arguments.profile_id,
    profileVersion: descriptionCall.arguments.profile_version,
    requestedIntents: descriptionCall.arguments.requested_intents
  };
  const packageDescription = await describeProofPackAuthoring(descriptionInput);
  const description = await describeProofPackOperation(descriptionInput);
  for (const key of ["profile_id", "profile_version", "guarantee", "counts",
    "source_digests", "projection_digest", "authority"]) {
    assert.deepEqual(description[key], packageDescription[key], key);
  }

  for (const key of ["requested_intents", "intent_definitions", "intent_distinctions",
    "explicit_exclusions"]) {
    const returned = description[`${key}_returned`];
    assert.equal(description[key].length, returned, `${key}_returned`);
    assert.equal(description[`${key}_total`], packageDescription[key].length,
      `${key}_total`);
    assert.equal(description[`${key}_omitted`],
      packageDescription[key].length - returned, `${key}_omitted`);
    assert.deepEqual(description[key], packageDescription[key].slice(0, returned), key);
  }
  assert.equal(Object.hasOwn(description, "proof_obligations"), false);

  const evaluationInput = await json(REFUSAL_BEFORE_EFFECTS_EVALUATION_INPUT);
  const inspectionIntents = intents;
  const packageInspection = await inspectProofPackBindings({
    contract,
    profileId: REFUSAL_BEFORE_EFFECTS_PACK.profile_id,
    profileVersion: REFUSAL_BEFORE_EFFECTS_PACK.profile_version,
    requestedIntents: inspectionIntents,
    evaluationInput
  });
  const packagePage = await inspectProofPackBindingsPage({
    contract, profileId: REFUSAL_BEFORE_EFFECTS_PACK.profile_id,
    profileVersion: REFUSAL_BEFORE_EFFECTS_PACK.profile_version,
    requestedIntents: inspectionIntents,
    evaluationInput, maximumItems: 0
  });
  const inspection = await inspectProofPackBindingsOperation({
    repoRoot: REPO,
    wkId: bindingInspectionCall.arguments.wk_id,
    focus: bindingInspectionCall.arguments.focus ?? null,
    evaluationFocus: bindingInspectionCall.arguments.focus ?? null,
    profileId: bindingInspectionCall.arguments.profile_id,
    profileVersion: bindingInspectionCall.arguments.profile_version,
    requestedIntents: bindingInspectionCall.arguments.requested_intents
  });
  assert.equal(inspection.status, packageInspection.summary.status);
  assert.equal(inspection.status, "valid");
  assert.equal(inspection.digests.contract, packagePage.digests.contract);
  assert.equal(inspection.digests.evaluation_input, packagePage.digests.evaluation_input);
  assert.equal(inspection.digests.result, packagePage.digests.result);
  assert.equal(JSON.stringify(inspection).includes("compatible_candidates"), false);
});

test("selection publishes ordered package-owned task-complete candidate context", async () => {
  const result = await selectProofPacksOperation({
    repoRoot: REPO,
    wkId: "WK-2012",
    focus: "proof-pack-selection-result-shape",
    requestedIntents: ["controlled-proof-intent.result-shape-conformance"]
  });
  assert.deepEqual(Object.keys(result.candidates[0]).sort(), [
    "bindings", "compatibility", "exact_binding_required", "explicit_exclusions",
    "guarantee", "intent_distinctions", "missing_compatible_reference_types",
    "profile_id", "profile_version", "proof_obligations", "requested_intents",
    "source_digests"
  ].sort());
  assert.deepEqual(Object.keys(result).sort(), [
    "candidates", "schema_version", "selection", "source_digests", "task"
  ].sort());
  assert.deepEqual(result.task.requested_intent_ids,
    ["controlled-proof-intent.result-shape-conformance"]);
  assert.equal(result.task.requested_intent_definitions.length, 1);
  assert.equal(Object.hasOwn(result.candidates[0], "inspection_calls"), false);
  for (const prohibited of ["applicability_claim", "authorization_claim",
    "authoring_projection", "package_root", "path"]) {
    assert.equal(JSON.stringify(result).includes(`\"${prohibited}\"`), false, prohibited);
  }
  assert.equal(JSON.stringify(result).includes("/home/"), false);
});

test("heterogeneous per-pack wiki-core composition preserves package ordering and digests", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "stable-v1-heterogeneous-parity-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, "wiki", "contracts");
  await mkdir(directory, { recursive: true });

  const wkId = HETEROGENEOUS_STEM;
  await mkdir(path.join(root, "wiki", "work-records"), { recursive: true });
  await writeFile(path.join(root, "wiki", "work-records", `${wkId}.json`),
    await readFile(path.join(REPO, "wiki", "work-records", `${wkId}.json`)));
  const contract = await json(`${HETEROGENEOUS_STEM}.controlled-acceptance.json`);
  const [validityInput, forbiddenInput] = await Promise.all(
    HETEROGENEOUS_PACKS.map((pack) => json(controlledContractPackCarrierFilename({
      wkId: HETEROGENEOUS_STEM,
      profileId: pack.profile_id,
      profileVersion: pack.profile_version
    })))
  );
  await writeFile(path.join(directory, `${wkId}.controlled-acceptance.json`),
    `${JSON.stringify(contract, null, 2)}\n`);
  const selectedPacks = HETEROGENEOUS_PACKS.map((pack) => ({ ...pack }));
  for (const [pack, content] of [[selectedPacks[0], validityInput],
    [selectedPacks[1], forbiddenInput]]) {
    await createControlledContractCarrierOperation({
      repoRoot: root,
      wkId,
      carrierKind: "evaluation_input",
      profileId: pack.profile_id,
      profileVersion: pack.profile_version,
      expectedContentDigest: null,
      content
    });
  }
  await createControlledContractCarrierOperation({
    repoRoot: root,
    wkId,
    carrierKind: "proof_plan_request",
    expectedContentDigest: null,
    content: {
      schema_version: "controlled-contract-proof-plan-request.v1",
      requested_intents: [
        "controlled-proof-intent.test-verification-validity",
        "controlled-proof-intent.forbidden-operation-noninvocation"
      ],
      selected_packs: selectedPacks
    }
  });
  const storedRequest = (await readControlledContractCarrierOperation({
    repoRoot: root,
    wkId,
    carrierKind: "proof_plan_request"
  })).content;
  const evaluationInputs = {
    [controlledContractPackCarrierFilename({ wkId, profileId: selectedPacks[0].profile_id,
      profileVersion: selectedPacks[0].profile_version })]: validityInput,
    [controlledContractPackCarrierFilename({ wkId, profileId: selectedPacks[1].profile_id,
      profileVersion: selectedPacks[1].profile_version })]: forbiddenInput
  };
  const expected = await buildProofPlan({ contract, request: storedRequest, evaluationInputs });
  const reordered = await buildProofPlan({ contract,
    request: { ...storedRequest, selected_packs: [...storedRequest.selected_packs].reverse() },
    evaluationInputs });
  assert.deepEqual(reordered, expected);
  const actual = await buildProofPlanOperation({
    repoRoot: root,
    wkId,
    expectedContentDigest: null
  });
  assert.deepEqual(actual.plan, expected);
  assert.deepEqual(actual.plan.packs.map(({ profile_id }) => profile_id), [
    "proof.operation.forbidden-noninvocation",
    "proof.verification.test-validity"
  ]);
  assert.equal(new Set(actual.plan.packs.map(({ source_digests }) =>
    source_digests.evaluation_input)).size, 2);

  const packageProjected = await assessProofPlanFiles({
    inputPath: await manifestCarrierPath(directory, wkId, "contract"),
    proofPlanPath: await manifestCarrierPath(directory, wkId, "proof_plan")
  });
  const coreAssessment = await assessControlledContractOperation({ repoRoot: root, wkId });
  assert.equal(coreAssessment.state, packageProjected.assessment.overall_code);
  assert.equal(coreAssessment.counts.per_pack_outcomes,
    packageProjected.assessment.per_pack.length);

  assert.match(coreAssessment.state, /profile_not_proven/u);

  const missingMap = { ...evaluationInputs };
  delete missingMap[storedRequest.selected_packs[1].evaluation_input_path];
  let packageCode = null;
  try {
    await buildProofPlan({ contract, request: storedRequest, evaluationInputs: missingMap });
  } catch (error) {
    packageCode = error.code;
  }
  assert.equal(packageCode, "proof_plan_request_missing_inputs");
});

test("proof-plan construction is byte-structurally equal to the package function", async () => {
  const focus = RECOVERY_FOCUS;
  const root = await makeRecoveryRoot({ focus });
  const stem = recoveryStem(RECOVERY_WK, focus);
  const contract = await readFile(path.join(root, "wiki", "contracts",
    `${stem}.controlled-acceptance.json`), "utf8").then(JSON.parse);
  const request = await readFile(path.join(root, "wiki", "contracts",
    `${stem}.proof-plan-request.json`), "utf8").then(JSON.parse);
  const evaluation = await readFile(path.join(root, "wiki", "contracts",
    `${stem}.evaluation-input.json`), "utf8").then(JSON.parse);
  const expected = await buildProofPlan({
    contract,
    request,
    evaluationInputs: {
      [request.selected_packs[0].evaluation_input_path]: evaluation
    }
  });
  const actual = await buildProofPlanOperation({ repoRoot: root, wkId: RECOVERY_WK,
    focus, expectedContentDigest: null });
  assert.deepEqual(actual.plan, expected);
  const second = await buildProofPlanOperation({ repoRoot: root, wkId: RECOVERY_WK,
    focus, expectedContentDigest: actual.carrier.content_digest });
  assert.equal(actual.carrier.no_op, false);
  assert.equal(second.carrier.no_op, true);
  await rm(root, { recursive: true, force: true });
});

test("root and focused recovery projections remain exact across rebuild and package assessment", async (t) => {
  const cases = [{ focus: null }, { focus: RECOVERY_FOCUS }];
  const roots = await Promise.all(cases.map(({ focus }) => makeRecoveryRoot({ focus })));
  const coreRoots = await Promise.all(cases.map(({ focus }) => makeRecoveryRoot({ focus })));
  t.after(() => Promise.all([...roots, ...coreRoots].map((root) => rm(root, { recursive: true, force: true }))));

  for (const [index, { focus }] of cases.entries()) {
    const repoRoot = roots[index];
    const missing = await assessControlledContractOperation({
      repoRoot, wkId: RECOVERY_WK, focus
    });
    assertRecoveryProjection(missing, await expectedMissingRecovery(repoRoot, focus));

    await buildProofPlanOperation({
      repoRoot, wkId: RECOVERY_WK, focus,
      expectedContentDigest: missing.next_calls[0].arguments.expected_content_digest
    });
    const coreBuild = await buildProofPlanOperation({
      repoRoot: coreRoots[index], wkId: RECOVERY_WK, focus,
      expectedContentDigest: null
    });
    assert.equal(coreBuild.carrier.no_op, false);
    const planCarrier = await readControlledContractCarrierOperation({
      repoRoot, wkId: RECOVERY_WK, focus, carrierKind: "proof_plan"
    });
    const contractsDirectory = path.join(repoRoot, "wiki", "contracts");
    const packageProjected = await assessProofPlanFiles({
      inputPath: await manifestCarrierPath(contractsDirectory, RECOVERY_WK, "contract",
        focus),
      proofPlanPath: await manifestCarrierPath(contractsDirectory, RECOVERY_WK,
        "proof_plan", focus)
    });
    const rebuilt = await assessControlledContractOperation({ repoRoot, wkId: RECOVERY_WK, focus });
    assert.equal(rebuilt.state, packageProjected.assessment.overall_code);
    assert.equal(rebuilt.counts.per_pack_outcomes,
      packageProjected.assessment.per_pack.length);
    assert.equal(planCarrier.content_digest.startsWith("sha256:"), true);
  }
});

test("MCP assessment and recovery calls preserve the core projection for root and focus", async (t) => {
  const cases = [{ focus: null }, { focus: RECOVERY_FOCUS }];
  const roots = await Promise.all(cases.map(({ focus }) => makeRecoveryRoot({ focus })));
  const coreRoots = await Promise.all(cases.map(({ focus }) => makeRecoveryRoot({ focus })));
  t.after(() => Promise.all([...roots, ...coreRoots].map((root) => rm(root, { recursive: true, force: true }))));

  for (const [index, { focus }] of cases.entries()) {
    const repoRoot = roots[index];
    const expectedMissing = await expectedMissingRecovery(repoRoot, focus);
    const actualMissing = await invokeMcpTool("workspace_controlled_contract_assess", {
      repo: "test", wk_id: RECOVERY_WK, ...(focus === null ? {} : { focus })
    }, repoRoot);
    assert.deepEqual(actualMissing, { workspaceRepo: "test", ...expectedMissing });

    const expectedDescription = await describeControlledContractAuthoringOperation({
      carrierKind: "proof_plan_request"
    });
    const actualDescription = await invokeMcpTool(
      "workspace_controlled_contract_authoring_describe",
      { carrier_kind: "proof_plan_request" }, repoRoot);
    assert.deepEqual(actualDescription, expectedDescription);

    const actualBuild = await invokeMcpTool("workspace_controlled_proof_plan_build", {
      repo: "test", wk_id: RECOVERY_WK, ...(focus === null ? {} : { focus }),
      expected_content_digest: expectedMissing.next_calls[0].arguments.expected_content_digest
    }, repoRoot);
    const coreBuild = await buildProofPlanOperation({
      repoRoot: coreRoots[index], wkId: RECOVERY_WK, focus,
      expectedContentDigest: null
    });
    assert.equal(coreBuild.carrier.no_op, false);
    assert.deepEqual(actualBuild, { workspaceRepo: "test", ...coreBuild });
    const planCarrier = await readControlledContractCarrierOperation({
      repoRoot, wkId: RECOVERY_WK, focus, carrierKind: "proof_plan"
    });
    const expectedStale = await assessControlledContractOperation({ repoRoot, wkId: RECOVERY_WK, focus });
    const actualStale = await invokeMcpTool("workspace_controlled_contract_assess", {
      repo: "test", wk_id: RECOVERY_WK, ...(focus === null ? {} : { focus })
    }, repoRoot);
    const { assessment_identity: assessmentIdentity, ...actualProjection } = actualStale;
    assert.match(assessmentIdentity, /^[A-Za-z0-9_-]{43}$/u);
    assert.deepEqual(actualProjection, { workspaceRepo: "test", ...expectedStale });
    assert.equal(planCarrier.content_digest.startsWith("sha256:"), true);
  }
});

test("assessment semantic summaries preserve current package states and exact collection counts", async (t) => {

  for (const wkId of ["WK-2225", "WK-2264"]) {
    const root = await makeRecoveryRoot({ wkId, includeProofPlanRequest: false });
    t.after(() => rm(root, { recursive: true, force: true }));
    const storedPlan = await json(`${wkId}.proof-plan.json`);
    await writeFile(path.join(root, "wiki", "contracts",
      `${wkId}.proof-plan-request.json`), `${JSON.stringify({
        schema_version: "controlled-contract-proof-plan-request.v1",
        requested_intents: storedPlan.requested_intents,
        selected_packs: storedPlan.packs.map(({ profile_id, profile_version,
          evaluation_input: { path: evaluation_input_path } }) => ({
          profile_id, profile_version, evaluation_input_path
        }))
      }, null, 2)}\n`);
    await buildProofPlanOperation({ repoRoot: root, wkId, focus: null,
      expectedContentDigest: null });
    const contractsDirectory = path.join(root, "wiki", "contracts");
    const packageProjected = await assessProofPlanFiles({
      inputPath: await manifestCarrierPath(contractsDirectory, wkId, "contract"),
      proofPlanPath: await manifestCarrierPath(contractsDirectory, wkId, "proof_plan")
    });
    const actual = await assessControlledContractOperation({ repoRoot: root, wkId,
      focus: null });
    assert.equal(actual.state, packageProjected.assessment.overall_code, wkId);
    assert.equal(actual.counts.per_pack_outcomes,
      packageProjected.assessment.per_pack.length, wkId);
    assert.equal(actual.counts.diagnostics,
      packageProjected.assessment.diagnostics.length, wkId);
    assert.equal(actual.counts.proof_exclusions,
      packageProjected.assessment.proof_exclusions.length, wkId);
    assert.equal(actual.counts.missing_inputs,
      packageProjected.assessment.missing_inputs.length, wkId);
    assert.equal(actual.authority.authoritative, false);
    assert.equal(Object.hasOwn(actual, "completeness_exemption"), false);
    assert.equal(actual.total_count,
      Object.values(actual.counts).reduce((sum, count) => sum + count, 0));
    assert.equal(actual.omitted_count, actual.total_count);
    assert.deepEqual(actual.continuation,
      CONTROLLED_CONTRACT_ASSESSMENT_PROJECTION_VOCABULARY.continuation);
    assert.equal(Object.hasOwn(actual, "artifact"), false);
  }
});

const SCALE_WK = "WK-2012";
const SCALE_FOCUS = "scale";
const SCALE_PACK = Object.freeze({
  profileId: "proof.authorization.refusal-before-effects",
  profileVersion: "2.0.0"
});
const SCALE_INTENTS = Object.freeze(["controlled-proof-intent.refusal-before-effects"]);

function scaleFixture() {
  const fixture = buildRefusalBeforeEffectsFixture();
  fixture.contract.test_proofs = buildStableTestProofPopulation(fixture.contract);
  fixture.contract.references.push(...Array.from({ length: 900 }, (_, index) => {
    const suffix = String(index).padStart(4, "0");
    return {
      reference_id: `ref-scale-${suffix}`,
      type_term: "cc:operation",
      identity: {
        kind: "durable_id",
        domain: "proof-plan-scaling-regression",
        value: `resource-${suffix}`
      }
    };
  }));
  return fixture;
}

async function makeScaleRoot(fixture, evaluationInput) {
  const root = await mkdtemp(path.join(os.tmpdir(), "stable-v1-scale-"));
  const directory = path.join(root, "wiki", "contracts");
  await mkdir(directory, { recursive: true });
  await mkdir(path.join(root, "wiki", "work-records"), { recursive: true });
  await writeFile(path.join(root, "wiki", "work-records", `${SCALE_WK}.json`),
    await readFile(path.join(REPO, "wiki", "work-records", `${SCALE_WK}.json`)));
  const stem = `${SCALE_WK}-${SCALE_FOCUS}`;
  const evaluationName = `${stem}.evaluation-input.json`;
  await writeFile(path.join(directory, `${stem}.controlled-acceptance.json`),
    `${JSON.stringify(fixture.contract, null, 2)}\n`);
  await writeFile(path.join(directory, evaluationName),
    `${JSON.stringify(evaluationInput, null, 2)}\n`);
  await writeFile(path.join(directory, `${stem}.proof-plan-request.json`),
    `${JSON.stringify({
      schema_version: "controlled-contract-proof-plan-request.v1",
      requested_intents: [...SCALE_INTENTS],
      selected_packs: [{
        profile_id: SCALE_PACK.profileId,
        profile_version: SCALE_PACK.profileVersion,
        evaluation_input_path: evaluationName
      }]
    }, null, 2)}\n`);
  return root;
}

test("oversized legacy assistance pages while complete validation-only compilation succeeds", async (t) => {
  const fixture = scaleFixture();
  const root = await makeScaleRoot(fixture, fixture.input);
  t.after(() => rm(root, { recursive: true, force: true }));

  const summary = await inspectProofPackBindingsOperation({
    repoRoot: root,
    wkId: SCALE_WK,
    focus: SCALE_FOCUS,
    evaluationFocus: SCALE_FOCUS,
    ...SCALE_PACK,
    requestedIntents: [...SCALE_INTENTS]
  });
  assert.ok(Buffer.byteLength(JSON.stringify(summary, null, 2)) <= 4096);
  const page = await inspectProofPackBindingsOperation({ repoRoot: root,
    wkId: SCALE_WK, focus: SCALE_FOCUS, evaluationFocus: SCALE_FOCUS, ...SCALE_PACK,
    requestedIntents: [...SCALE_INTENTS],
    roles: ["operation"] });
  assert.ok(page.returned_count > 0);
  assert.ok(Buffer.byteLength(JSON.stringify(page, null, 2)) <= 16384);

  const built = await buildProofPlanOperation({
    repoRoot: root,
    wkId: SCALE_WK,
    focus: SCALE_FOCUS,
    expectedContentDigest: null
  });
  assert.equal(built.plan.packs[0].profile_id, SCALE_PACK.profileId);
  assert.equal(built.carrier.written, true);
});

test("an incompatible evaluation-input binding is reported and refuses plan compilation", async (t) => {
  const fixture = scaleFixture();
  const invalid = structuredClone(fixture.input);
  invalid.reference_bindings.find(({ role }) => role === "operation").reference_ids =
    ["ref-subject"];
  const root = await makeScaleRoot(fixture, invalid);
  t.after(() => rm(root, { recursive: true, force: true }));

  const invalidInspection = await inspectProofPackBindingsOperation({ repoRoot: root,
    wkId: SCALE_WK, focus: SCALE_FOCUS, evaluationFocus: SCALE_FOCUS, ...SCALE_PACK,
    roles: ["operation"] });
  assert.equal(invalidInspection.status, "invalid");
  assert.equal(invalidInspection.counts.incompatible, 1);
  assert.equal(await refusalCode(buildProofPlanOperation({
    repoRoot: root,
    wkId: SCALE_WK,
    focus: SCALE_FOCUS,
    expectedContentDigest: null
  })), "proof_plan_request_evaluation_input_invalid");
});

test("current WK-2003 and WK-2010 contracts remain canonical readable package inputs", async () => {
  for (const wkId of ["WK-2003", "WK-2010"]) {
    const carrier = await readControlledContractCarrierOperation({
      repoRoot: REPO,
      wkId,
      carrierKind: "contract"
    });
    assert.deepEqual(carrier.content, await json(`${wkId}.controlled-acceptance.json`));
    const selection = await selectProofPacksOperation({
      repoRoot: REPO,
      wkId,
      requestedIntents: ["controlled-proof-intent.implementation-readiness"]
    });
    assert.equal(selection.schema_version,
      "controlled-contract-proof-pack-task-context.v3");
    assert.ok(selection.candidates.every((candidate) =>
      !Object.hasOwn(candidate, "inspection_calls")));
  }
});

test("unknown profiles and arbitrary pack locations fail without fallback", async () => {
  assert.equal(await refusalCode(describeProofPackOperation({
    profileId: "proof.unknown",
    profileVersion: "9.9.9"
  })), "proof_pack_authoring_identity_unknown");
  for (const key of ["profilePath", "packDirectory", "catalog", "module", "executable"]) {
    assert.equal(await refusalCode(describeProofPackOperation({
      profileId: "proof.result-shape.conformance",
      profileVersion: "1.0.0",
      [key]: "/tmp/forged"
    })), "controlled_contract_request_field_forbidden");
  }
});

test("the semantic engine is public and resolved as a wiki-core runtime dependency", async () => {
  const controlledPackage = JSON.parse(await readFile(path.join(
    REPO, "packages/controlled-contract/package.json"
  ), "utf8"));
  const wikiCorePackage = JSON.parse(await readFile(path.join(
    REPO, "packages/wiki-core/package.json"
  ), "utf8"));
  assert.equal(Object.hasOwn(controlledPackage, "private"), false);
  assert.equal(controlledPackage.version, "0.1.0");
  assert.equal(controlledPackage.publishConfig?.access, "public");
  assert.equal(
    wikiCorePackage.dependencies?.["@agent-chassis/controlled-contract"],
    "^0.1.0"
  );

  const operationDirectory = path.join(
    REPO, "packages/wiki-core/src/operations/controlled-contract"
  );
  const operationFiles = [
    path.join(REPO, "packages/wiki-core/src/operations/controlled-contract.mjs"),
    ...(await readdir(operationDirectory)).sort()
      .map((name) => path.join(operationDirectory, name))
  ];
  const operationSource = (await Promise.all(
    operationFiles.map((file) => readFile(file, "utf8"))
  )).join("\n");
  assert.equal(operationSource.includes("node:child_process"), false);
  assert.equal(operationSource.includes("/bin/"), false);
  assert.match(operationSource, /import\(CONTROLLED_CONTRACT_MODULE_SPECIFIER\)/u);
  assert.match(operationSource, /import\.meta\.resolve\(PROOF_PLAN_REQUEST_SCHEMA_SPECIFIER\)/u);
  assert.match(operationSource, /@agent-chassis\/controlled-contract/u);
});
