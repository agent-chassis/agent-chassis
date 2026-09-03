import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import {
  buildProofPlan,
  NATIVE_CONTRACT_SCHEMA_V1
} from "../../packages/controlled-contract/current.mjs";
import { migrateControlledAcceptanceContractV02ToV1 } from
  "../../packages/controlled-contract/lib/stable-v1-migration.mjs";
import { VERIFICATION_PROFILE_EVALUATION_INPUT_SCHEMA_V1 } from
  "../../packages/controlled-contract/lib/verification-profile-schema-v1.mjs";

import {
  assessControlledContractOperation,
  buildProofPlanOperation,
  describeControlledContractAuthoringOperation,
  patchControlledContractCarrierOperation,
  queryControlledContractCarrierOperation,
  readControlledContractCarrierOperation
} from "../../packages/wiki-core/src/operations/controlled-contract.mjs";
import { CONTROLLED_CONTRACT_AUTHORABLE_CARRIER_KINDS } from
  "../../packages/wiki-core/src/lib/controlled-contract-tools.mjs";

const REPO = path.resolve(import.meta.dirname, "../..");
const CONTRACTS = path.join(REPO, "wiki", "contracts");

function canonicalWorkRecordFixture(wkId) {
  return {
    schema_version: "work-record.v1",
    id: wkId,
    repo: "agent-chassis/agent-chassis",
    title: `Controlled-contract carrier fixture ${wkId}`,
    record_kind: "work_item",
    work_kind: "implementation",
    status: "todo",
    priority: "medium",
    owner: "unassigned",
    created: "2026-08-17",
    updated: "2026-08-17",
    resolution: "unresolved",
    read_scope: [],
    repo_paths: [],
    write_scope: [],
    depends_on: [],
    blocks: [],
    related: [],
    dispatch_intent: {
      intended_agent_role: null,
      target_unit: "none",
      requires_graph_impact: false,
      requires_escalation: false
    },
    acceptance: { criteria: [], validation: [] },
    sections: {
      summary: "Canonical work record fixture for controlled-contract carriers.",
      why_it_matters: "The carrier lease requires one valid canonical record.",
      scope: { items: [], out_of_scope: [] },
      tasks: [],
      references: [],
      agent_notes: "",
      closure: null
    },
    children: [],
    slices: [],
    escalations: [],
    projections: [],
    migration: null,
    initiative: null
  };
}

async function fixtureRepo(files = [], { workRecordIds = ["WK-2012"] } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "wk2012-tools-"));
  await mkdir(path.join(root, "wiki", "contracts"), { recursive: true });
  await mkdir(path.join(root, "wiki", "work-records"), { recursive: true });
  for (const wkId of workRecordIds) {
    await writeFile(path.join(root, "wiki", "work-records", `${wkId}.json`),
      `${JSON.stringify(canonicalWorkRecordFixture(wkId), null, 2)}\n`);
  }
  for (const file of files) {
    await cp(path.join(CONTRACTS, file), path.join(root, "wiki", "contracts", file));
  }
  return root;
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

async function writeStablePlanGeneration(root, {includePlan = true} = {}) {
  const contracts = path.join(root, "wiki", "contracts");
  const [base, input] = await Promise.all([
    readFile(path.join(REPO,
      "packages/controlled-contract/examples/minimal-controlled-acceptance-contract-v034.json"),
    "utf8").then(JSON.parse),
    readFile(path.join(REPO,
      "packages/controlled-contract/profiles/proof.verification.test-validity/2.0.0/evaluation-input.template.json"),
    "utf8").then(JSON.parse)
  ]);
  const binding = testProofBinding();
  const testValidity = input.stable_evaluation.test_validity[0];
  input.reference_bindings = [
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
  testValidity.falsifier_executions[0].failure_proposition_id = binding.falsifiers[0].proposition_id;
  testValidity.falsifier_executions[0].mutation.mutation_id = binding.falsifiers[0].mutation.mutation_id;
  testValidity.falsifier_executions[0].mutation.target_verification_id =
    binding.verification_claim_id;
  for (const field of ["declared_test_ids", "baseline_executed_test_ids"]) {
    testValidity.test_inventory[field] = ["test-component"];
  }
  testValidity.test_inventory.observed_tests = [{test_id: "test-component", status: "passed"}];
  const contract = migrateControlledAcceptanceContractV02ToV1({
    contract: base, testProofs: [binding]
  });
  const request = {
    schema_version: "controlled-contract-proof-plan-request.v1",
    requested_intents: ["controlled-proof-intent.test-verification-validity"],
    selected_packs: [{profile_id: "proof.verification.test-validity",
      profile_version: "2.0.0", evaluation_input_path: "WK-2012.evaluation-input.json"}]
  };
  const plan = await buildProofPlan({
    contract, request, evaluationInputs: {"WK-2012.evaluation-input.json": input}
  });
  for (const [filename, content] of [
    ["WK-2012.controlled-acceptance.json", contract],
    ["WK-2012.evaluation-input.json", input],
    ["WK-2012.proof-plan-request.json", request],
    ...(includePlan ? [["WK-2012.proof-plan.json", plan]] : [])
  ]) await writeFile(path.join(contracts, filename), `${JSON.stringify(content, null, 2)}\n`);
}

async function assertNoAssessmentEffects(root) {
  await assert.rejects(
    () => readdir(path.join(root, ".cache")),
    ({ code }) => code === "ENOENT"
  );
}

test("package-backed authoring descriptions cover every mutable family with valid bounded templates", async () => {
  const requestSchema = JSON.parse(await readFile(path.join(
    REPO, "packages/controlled-contract/schema/controlled-contract-proof-plan-request.v1.schema.json"
  ), "utf8"));
  const schemas = { contract: NATIVE_CONTRACT_SCHEMA_V1,
    evaluation_input: VERIFICATION_PROFILE_EVALUATION_INPUT_SCHEMA_V1,
    proof_plan_request: requestSchema };
  const targets = {
    contract: ["references", "propositions", "claims", "relations", "collections", "residue", "annotations"],
    evaluation_input: ["reference_bindings", "number_bindings", "claim_pattern_bindings",
      "resolver_facts", "delivered_evidence", "evaluation_stage"],
    proof_plan_request: ["requested_intents", "selected_packs"]
  };
  const rootSchemas = { contract: NATIVE_CONTRACT_SCHEMA_V1,
    evaluation_input: VERIFICATION_PROFILE_EVALUATION_INPUT_SCHEMA_V1,
    proof_plan_request: requestSchema };
  for (const carrierKind of CONTROLLED_CONTRACT_AUTHORABLE_CARRIER_KINDS) {
    const carrierTargets = targets[carrierKind];
    const compact = await describeControlledContractAuthoringOperation({ carrierKind });
    assert.deepEqual(compact.targets.map(({ target }) => target), carrierTargets);
    const root = rootSchemas[carrierKind];
    const immutable = Object.fromEntries((root.required ?? []).flatMap((field) => {
      const schema = root.properties?.[field];
      if (schema?.const !== undefined) return [[field, schema.const]];
      if (Array.isArray(schema?.enum) && schema.enum.length === 1) return [[field, schema.enum[0]]];
      return [];
    }));
    assert.deepEqual(compact.immutable_fields, Object.keys(immutable));
    assert.deepEqual(compact.immutable_values, immutable);
    const validateRoot = new Ajv2020({ strict: false }).compile(root);
    assert.equal(validateRoot(compact.minimal_valid_template), true,
      `${carrierKind} ${JSON.stringify(validateRoot.errors)}`);
    if (carrierKind === "proof_plan_request") {
      assert.ok(compact.minimal_valid_template.requested_intents.length > 0);
      assert.ok(compact.minimal_valid_template.selected_packs.length > 0);
      assert.deepEqual(Object.keys(compact.minimal_valid_template.selected_packs[0]).sort(),
        root.$defs.selected_pack.required.slice().sort());
      assert.match(compact.minimal_valid_template.selected_packs[0].profile_id,
        new RegExp(root.$defs.identifier.pattern));
      assert.match(compact.minimal_valid_template.selected_packs[0].profile_version,
        new RegExp(root.$defs.semver.pattern));
    }
    assert.ok(Buffer.byteLength(JSON.stringify(compact, null, 2)) <= 4096);
    for (const target of carrierTargets) {
      const detail = await describeControlledContractAuthoringOperation({ carrierKind, target });
      assert.ok(Buffer.byteLength(JSON.stringify(detail, null, 2)) <= 16384, `${carrierKind}:${target}`);
      const source = schemas[carrierKind].properties[target];
      const resolved = source.$ref ? schemas[carrierKind].$defs[source.$ref.split("/").at(-1)] : source;
      const validate = new Ajv2020({ strict: false }).compile({
        ...(resolved.items ?? resolved), $defs: schemas[carrierKind].$defs
      });
      assert.equal(validate(detail.minimal_valid_template), true,
        `${carrierKind}:${target} ${JSON.stringify(validate.errors)}`);
      if (carrierKind === "proof_plan_request" && target === "selected_packs") {
        assert.deepEqual(detail.server_derived_fields, [{ field: "evaluation_input_path",
          derivation: "canonical evaluation-input carrier basename from wk_id, optional focus, profile_id, and profile_version",
          caller_authored: false }]);
        assert.equal(Object.hasOwn(detail.minimal_valid_template, "evaluation_input_path"), false);
      }
    }
  }
});

test("proof-plan metadata recovers absent, current, and stale digests without plan content", async (t) => {
  const root = await fixtureRepo();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeStablePlanGeneration(root);
  const absentRoot = await fixtureRepo();
  t.after(() => rm(absentRoot, { recursive: true, force: true }));
  await writeStablePlanGeneration(absentRoot, {includePlan: false});
  const absent = await queryControlledContractCarrierOperation({
    repoRoot: absentRoot, wkId: "WK-2012", carrierKind: "proof_plan"
  });
  assert.deepEqual([absent.exists, absent.content_digest, absent.source_binding_status],
    [false, null, "absent"]);
  const current = await queryControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2012", carrierKind: "proof_plan"
  });
  await buildProofPlanOperation({
    repoRoot: root,
    wkId: "WK-2012",
    expectedContentDigest: current.content_digest
  });
  const rebuiltCurrent = await queryControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2012", carrierKind: "proof_plan"
  });
  assert.equal(rebuiltCurrent.exists, true);
  assert.equal(rebuiltCurrent.source_binding_status, "current");
  assert.match(rebuiltCurrent.content_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(Object.hasOwn(rebuiltCurrent, "content"), false);

  const contract = await readControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2012", carrierKind: "contract"
  });
  await patchControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2012", carrierKind: "contract",
    expectedContentDigest: contract.content_digest,
    operations: [{ op: "upsert", target: "annotations", id: "ann-plan-stale",
      value: { annotation_id: "ann-plan-stale", kind: "provenance", text: "stale" } }]
  });
  const invalidated = await queryControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2012", carrierKind: "proof_plan"
  });
  assert.deepEqual([invalidated.exists, invalidated.content_digest,
    invalidated.source_binding_status], [false, null, "absent"]);

  const staleRoot = await fixtureRepo();
  t.after(() => rm(staleRoot, { recursive: true, force: true }));
  await writeStablePlanGeneration(staleRoot);
  const seededPlan = await queryControlledContractCarrierOperation({
    repoRoot: staleRoot, wkId: "WK-2012", carrierKind: "proof_plan"
  });
  assert.equal(seededPlan.content_digest, rebuiltCurrent.content_digest);
  const contractPath = path.join(staleRoot, "wiki", "contracts",
    "WK-2012.controlled-acceptance.json");
  const staleSource = JSON.parse(await readFile(contractPath, "utf8"));
  staleSource.annotations = [...staleSource.annotations,
    { annotation_id: "ann-plan-stale", kind: "provenance", text: "stale" }];
  await writeFile(contractPath, `${JSON.stringify(staleSource, null, 2)}\n`);
  const stale = await queryControlledContractCarrierOperation({
    repoRoot: staleRoot, wkId: "WK-2012", carrierKind: "proof_plan"
  });
  assert.equal(stale.source_binding_status, "stale");
  assert.equal(stale.rebuild_expected_content_digest, rebuiltCurrent.content_digest);
  assert.equal(Object.hasOwn(stale, "content"), false);
});

test("existing proof plan refuses invalid canonical sources before assessment effects",
  async (t) => {
    const crossWkRoot = await fixtureRepo();
    const missingInputRoot = await fixtureRepo();
    const validRoot = await fixtureRepo();
    t.after(() => Promise.all([crossWkRoot, missingInputRoot, validRoot].map((root) =>
      rm(root, { recursive: true, force: true }))));
    await Promise.all([
      writeStablePlanGeneration(crossWkRoot),
      writeStablePlanGeneration(missingInputRoot),
      writeStablePlanGeneration(validRoot)
    ]);

    const requestPath = path.join(
      crossWkRoot, "wiki", "contracts", "WK-2012.proof-plan-request.json"
    );
    const crossWkRequest = JSON.parse(await readFile(requestPath, "utf8"));
    crossWkRequest.selected_packs[0].evaluation_input_path =
      "WK-9999.evaluation-input.json";
    await writeFile(requestPath, `${JSON.stringify(crossWkRequest, null, 2)}\n`);
    await assert.rejects(
      () => assessControlledContractOperation({ repoRoot: crossWkRoot, wkId: "WK-2012" }),
      (error) => error.code === "controlled_contract_proof_input_path_forbidden" &&
        error.envelope.warning.payload.reason_code ===
          "controlled_contract_proof_input_path_forbidden"
    );
    await assertNoAssessmentEffects(crossWkRoot);

    await rm(path.join(
      missingInputRoot, "wiki", "contracts", "WK-2012.evaluation-input.json"
    ));
    await assert.rejects(
      () => assessControlledContractOperation({ repoRoot: missingInputRoot, wkId: "WK-2012" }),
      (error) => error.code === "proof_plan_request_missing_inputs" &&
        error.envelope.warning.payload.reason_code === "proof_plan_request_missing_inputs"
    );
    await assertNoAssessmentEffects(missingInputRoot);

    const assessment = await assessControlledContractOperation({
      repoRoot: validRoot, wkId: "WK-2012"
    });
    assert.equal(assessment.structure, "proven");
    assert.equal(assessment.selected_pack_count, 1);
    const assessmentRoot = path.join(
      validRoot, ".cache", "controlled-contract", "assessments", "sha256"
    );
    const assessmentDirectories = await readdir(assessmentRoot);
    assert.equal(assessmentDirectories.length, 1);
    assert.deepEqual((await readdir(path.join(
      assessmentRoot, assessmentDirectories[0]
    ))).sort(), [
      "assessment.json",
      "assessment.md",
      "manifest.json",
      "proof-packs.full.json",
      "structural.full.json"
    ]);
  });

test("stable carrier patch preserves test proofs and delegates stale and prospective validation",
  async (t) => {
    const root = await fixtureRepo();
    t.after(() => rm(root, { recursive: true, force: true }));
    const contracts = path.join(root, "wiki", "contracts");
    const base = JSON.parse(await readFile(path.join(REPO,
      "packages/controlled-contract/examples/minimal-controlled-acceptance-contract-v034.json"),
    "utf8"));
    const contract = migrateControlledAcceptanceContractV02ToV1({
      contract: base, testProofs: [testProofBinding()]
    });
    await writeFile(
      path.join(contracts, "WK-2012.controlled-acceptance.json"),
      `${JSON.stringify(contract, null, 2)}\n`
    );
    const before = await readControlledContractCarrierOperation({
      repoRoot: root, wkId: "WK-2012", carrierKind: "contract"
    });
    const proofBytes = JSON.stringify(before.content.test_proofs);
    const receipt = await patchControlledContractCarrierOperation({
      repoRoot: root, wkId: "WK-2012", carrierKind: "contract",
      expectedContentDigest: before.content_digest,
      operations: [
        { op: "upsert", target: "annotations", id: "ann-v1-patch",
          value: { annotation_id: "ann-v1-patch", kind: "note", text: "stable patch" } },
        { op: "upsert", target: "residue", id: "res-v1-patch",
          value: { residue_id: "res-v1-patch", reason: "review_only", text: "stable residue" } }
      ]
    });
    const after = await readControlledContractCarrierOperation({
      repoRoot: root, wkId: "WK-2012", carrierKind: "contract"
    });
    assert.equal(receipt.written, true);
    assert.equal(after.content.annotations.some(({ annotation_id: id }) => id === "ann-v1-patch"),
      true);
    assert.equal(after.content.residue.some(({ residue_id: id }) => id === "res-v1-patch"), true);
    assert.equal(JSON.stringify(after.content.test_proofs), proofBytes);
    await assert.rejects(() => patchControlledContractCarrierOperation({
      repoRoot: root, wkId: "WK-2012", carrierKind: "contract",
      expectedContentDigest: before.content_digest,
      operations: [{ op: "remove", target: "annotations", id: "ann-v1-patch" }]
    }), ({ code }) => code === "controlled_contract_stale_content_digest");
    let invalidError;
    await assert.rejects(() => patchControlledContractCarrierOperation({
      repoRoot: root, wkId: "WK-2012", carrierKind: "contract",
      expectedContentDigest: after.content_digest,
      operations: [{ op: "upsert", target: "annotations", id: "ann-invalid-v1",
        value: { annotation_id: "ann-invalid-v1", kind: "forged", text: "invalid" } }]
    }), (error) => {
      invalidError = error;
      return error.code === "controlled_contract_carrier_validation_failed" &&
        error.details.contract_family === "stable_v1" &&
        error.details.diagnostics.diagnostics.length > 0 &&
        error.details.diagnostics.diagnostics.every((diagnostic) =>
          typeof diagnostic.code === "string" || typeof diagnostic.keyword === "string") &&
        !error.details.diagnostics.diagnostics.some((diagnostic) =>
          diagnostic.params?.additionalProperty === "test_proofs");
    });
    assert.ok(Buffer.byteLength(JSON.stringify(invalidError.envelope), "utf8") <= 8192);
  });
