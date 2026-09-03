import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { assessProofPlan } from "@agent-chassis/controlled-contract";
import { loadAdmittedProofPack } from
  "../../packages/controlled-contract/lib/admitted-proof-packs.mjs";
import { canonicalJson } from
  "../../packages/controlled-contract/lib/contract-assessment.mjs";
import { expectedPackSourceDigests } from
  "../../packages/controlled-contract/lib/multi-pack-assessment.mjs";
import { buildProofPlanFixture } from
  "../../packages/controlled-contract/test/proof-plan-fixture.mjs";
import { buildRetryConvergenceFixture } from
  "../../packages/controlled-contract/test/proof-packs/retry-convergence-v1-fixture.mjs";
import { buildStableTestProofPopulation } from
  "../../packages/controlled-contract/test/support/stable-v1-proof-pack-runtime.mjs";
import {
  projectControlledContractIntegrationAssessmentSummary,
  projectControlledContractProofAssessmentPage,
  projectControlledContractProofAssessmentSummary
} from "../../packages/wiki-core/src/operations/controlled-contract.mjs";
import {
  createControlledContractAssessmentSnapshotRegistry
} from "../../packages/wiki-mcp/src/lib/controlled-contract-assessment-snapshots.mjs";

function oversizedProofAssessment() {
  return {
    schema_version: "controlled-contract-multi-pack-assessment.v1",
    structure: "proven",
    overall_code: "not_proven",
    per_pack: [{
      profile_id: "proof.test.oversized",
      profile_version: "1.0.0",
      profile_discrimination: "not_proven",
      exact_binding: "not_applicable"
    }],
    diagnostics: [{
      pack: { profile_id: "proof.test.oversized", profile_version: "1.0.0" },
      detail: { source: "test", detail: { code: "x".repeat(24_000) } }
    }],
    proof_exclusions: [],
    missing_inputs: []
  };
}

function completeIntegrationAssessment() {
  const counts = Object.fromEntries(Array.from({ length: 180 }, (_, index) => [
    `task_relevant_count_${String(index).padStart(3, "0")}`,
    `value-${index}-${"x".repeat(96)}`
  ]));
  return {
    state: "fail",
    axis_results: [
      { axis: "axis.complete", denominator_state: "pass", applicability: "required",
        counts },
      { axis: "axis.unsupported", denominator_state: "unsupported",
        applicability: "required", counts: {} }
    ],
    diagnostics: [{ code: "gap", state: "fail", axis: "axis.complete",
      subject: { id: "SCENARIO-1" } }],
    lossless_denominators: {
      requirements: [{ requirement_id: "REQ-1" }],
      integration_scenario_ids: ["SCENARIO-1"],
      review_question_ids: ["QUESTION-1"]
    },
    lossless_joins: {
      requirement_to_obligations: [{ requirement_id: "REQ-1", obligation_ids: ["OBL-1"] }],
      obligation_to_scenarios: [{ obligation_id: "OBL-1", scenario_ids: ["SCENARIO-1"] }],
      interaction_to_scenarios: [{ interaction_id: "INTERACTION-1",
        scenario_ids: ["SCENARIO-1"] }]
    },
    denominators: {}, coverage: {}, diagnostic_summary: { fail: 1 }
  };
}

function stableFixture() {
  const fixture = structuredClone(buildRetryConvergenceFixture());
  fixture.contract.schema_version = "controlled-acceptance-contract.v1";
  fixture.contract.profile_id = "acceptance-contract.standard.v1";
  fixture.contract.vocabulary_version = "controlled-contract-vocabulary.v1";
  fixture.contract.test_proof_version = "controlled-contract-test-proof.v1";
  fixture.contract.test_proofs = buildStableTestProofPopulation(fixture.contract);
  fixture.input.input_version = "controlled-contract-verification-profile-input.v1";
  fixture.input.stable_evaluation = {};
  return fixture;
}

async function realAssessments() {
  const root = await mkdtemp(path.join(os.tmpdir(), "cc-semantic-projection-"));
  try {
    const fixture = stableFixture();
    const contractPath = path.join(root, "contract.json");
    const evaluationPath = path.join(root, "evaluation.json");
    await Promise.all([
      writeFile(contractPath, canonicalJson(fixture.contract)),
      writeFile(evaluationPath, canonicalJson(fixture.input))
    ]);
    const proofPlan = await buildProofPlanFixture({
      contractPath,
      packs: [{
        profileId: "proof.failure.retry-convergence",
        requestedIntents: ["controlled-proof-intent.retry-convergence"],
        evaluationInputPath: evaluationPath
      }]
    });
    const proven = await assessProofPlan({
      inputPath: contractPath, proofPlan, planDirectory: root
    });

    const failingInput = JSON.parse(await readFile(evaluationPath, "utf8"));
    failingInput.number_bindings[0].value += 1;
    await writeFile(evaluationPath, canonicalJson(failingInput));
    const admitted = await loadAdmittedProofPack(proofPlan.packs[0].profile_id);
    const failingPlan = structuredClone(proofPlan);
    failingPlan.packs[0].source_digests = expectedPackSourceDigests(admitted, failingInput);
    const unproven = await assessProofPlan({
      inputPath: contractPath, proofPlan: failingPlan, planDirectory: root
    });

    const missingPlan = structuredClone(proofPlan);
    missingPlan.packs[0].evaluation_input = null;
    missingPlan.packs[0].source_digests = expectedPackSourceDigests(admitted, null);
    const missing = await assessProofPlan({
      inputPath: contractPath, proofPlan: missingPlan, planDirectory: root
    });
    return { proven: proven.assessment, unproven: unproven.assessment,
      missing: missing.assessment };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("real proof assessments preserve package codes, identities, and outcome truth", async () => {
  const assessments = await realAssessments();
  const summary = projectControlledContractProofAssessmentSummary(
    assessments.unproven,
    {
      work_record_id: "WK-2426",
      controlled_contract_digest: `sha256:${"1".repeat(64)}`,
      proof_plan_digest: `sha256:${"2".repeat(64)}`
    }
  );
  assert.equal(summary.counts.per_pack_outcomes, 1);
  assert.equal(summary.counts.diagnostics, assessments.unproven.diagnostics.length);
  assert.equal(summary.authority.authoritative, false);
  assert.ok(Buffer.byteLength(JSON.stringify(summary, null, 2), "utf8") <= 8192);
  assert.equal(Object.hasOwn(summary, "artifact"), false);
  assert.equal(Object.hasOwn(summary, "content"), false);

  const diagnostic = projectControlledContractProofAssessmentPage({
    assessment: assessments.unproven, collection: "diagnostics"
  });
  assert.deepEqual(diagnostic.items.map(({ code }) => code),
    assessments.unproven.diagnostics.map(({ detail }) => detail.detail.code));
  assert(diagnostic.items.every(({ state }) => state === "not_proven"));

  const missing = projectControlledContractProofAssessmentPage({
    assessment: assessments.missing, collection: "missing_inputs"
  });
  assert.deepEqual(missing.items.map(({ code }) => code),
    assessments.missing.missing_inputs.map(({ detail }) => detail.reason_code));
  assert.deepEqual(
    projectControlledContractProofAssessmentPage({
      assessment: assessments.missing, collection: "missing_inputs"
    }).items.map(({ missing_input_id: id }) => id),
    missing.items.map(({ missing_input_id: id }) => id)
  );

  const exclusions = projectControlledContractProofAssessmentPage({
    assessment: assessments.proven, collection: "proof_exclusions"
  });
  assert.deepEqual(exclusions.items.map(({ exclusion_id: id }) => id),
    assessments.proven.proof_exclusions.map(({ detail }) => detail.exclusion_id).sort());

  const provenPack = projectControlledContractProofAssessmentPage({
    assessment: assessments.proven, collection: "per_pack_outcomes"
  });
  const unprovenPack = projectControlledContractProofAssessmentPage({
    assessment: assessments.unproven, collection: "per_pack_outcomes"
  });
  assert.equal(provenPack.items[0].state, "proven");
  assert.equal(unprovenPack.items[0].state, "not_proven");
});

test("real producer code and state selectors form exact partitions", async () => {
  const { unproven, missing } = await realAssessments();
  const diagnosticPage = projectControlledContractProofAssessmentPage({
    assessment: unproven, collection: "diagnostics"
  });
  for (const code of new Set(diagnosticPage.items.map((item) => item.code))) {
    const selected = projectControlledContractProofAssessmentPage({
      assessment: unproven, collection: "diagnostics", selector: { code }
    });
    assert.deepEqual(selected.items,
      diagnosticPage.items.filter((item) => item.code === code));
  }
  for (const state of new Set(diagnosticPage.items.map((item) => item.state))) {
    const selected = projectControlledContractProofAssessmentPage({
      assessment: unproven, collection: "diagnostics", selector: { state }
    });
    assert.deepEqual(selected.items,
      diagnosticPage.items.filter((item) => item.state === state));
  }
  const missingPage = projectControlledContractProofAssessmentPage({
    assessment: missing, collection: "missing_inputs"
  });
  const selectedMissing = projectControlledContractProofAssessmentPage({
    assessment: missing, collection: "missing_inputs",
    selector: { code: missingPage.items[0].code }
  });
  assert.deepEqual(selectedMissing.items, missingPage.items);
  const selectedPack = projectControlledContractProofAssessmentPage({
    assessment: unproven, collection: "per_pack_outcomes", selector: { state: "not_proven" }
  });
  assert.equal(selectedPack.matched_count, 1);
});

test("malformed or flattened proof producer records fail loudly", async () => {
  const { proven, unproven, missing } = await realAssessments();
  const mutants = [
    [structuredClone(unproven), "diagnostics", (assessment) => {
      assessment.diagnostics[0].detail.detail.code = "";
    }],
    [structuredClone(missing), "missing_inputs", (assessment) => {
      delete assessment.missing_inputs[0].detail.reason_code;
    }],
    [structuredClone(proven), "proof_exclusions", (assessment) => {
      delete assessment.proof_exclusions[0].detail.exclusion_id;
    }],
    [structuredClone(proven), "per_pack_outcomes", (assessment) => {
      delete assessment.per_pack[0].profile_discrimination;
    }],
    [{ ...structuredClone(unproven), diagnostics: [{ code: "flat", state: "pass" }] },
      "diagnostics", () => {}]
  ];
  for (const [assessment, collection, mutate] of mutants) {
    mutate(assessment);
    assert.throws(() => projectControlledContractProofAssessmentPage({
      assessment, collection
    }), (error) => error.code === "controlled_contract_semantic_projection_invalid" &&
      error.details.family === "proof");
  }
});

test("both semantic families traverse exact collections and reconstruct oversized values", async () => {
  const integration = completeIntegrationAssessment();
  const integrationSummary = projectControlledContractIntegrationAssessmentSummary(
    integration, { work_record_id: "WK-2461" }
  );
  assert.equal(integrationSummary.counts.axes, 2);
  for (const collection of [
    "gaps", "requirement_coverage", "scenario_coverage", "interaction_coverage",
    "review_question_results", "unsupported_axes", "diagnostic_code_summaries"
  ]) assert.equal(integrationSummary.counts[collection], 1);
  assert.equal(integrationSummary.total_count,
    Object.values(integrationSummary.counts).reduce((sum, count) => sum + count, 0));

  const integrationRegistry = createControlledContractAssessmentSnapshotRegistry({
    now: () => 1000, random: (size) => Buffer.alloc(size, 7)
  });
  const integrationIdentity = integrationRegistry.put({
    family: "integration_test_design", assessment: integration,
    sourceIdentity: { digest: "integration-current" },
    assessOperation: "workspace_controlled_contract_integration_test_design_assess"
  });
  for (const [collection, count] of Object.entries(integrationSummary.counts)) {
    const page = await integrationRegistry.query({
      family: "integration_test_design", identity: integrationIdentity, collection
    });
    assert.equal(page.matched_count, count);
    assert.equal(page.returned_count + page.omitted_count, count);
    assert.equal(JSON.stringify(page).includes("_digest"), false);
    assert.equal(JSON.stringify(page).includes("completeness_exemption"), false);
  }

  const axisPage = await integrationRegistry.query({
    family: "integration_test_design", identity: integrationIdentity,
    collection: "axes", selector: { id: "axis.complete" }
  });
  assert.equal(axisPage.items[0].schema_version,
    "controlled-contract-assessment-row-projection.v1");
  const rebuiltCounts = {};
  let fields = await integrationRegistry.query({
    family: "integration_test_design", identity: integrationIdentity,
    collection: "axes", selector: { id: "axis.complete" }, fieldPath: ["counts"]
  });
  while (true) {
    assert.equal(fields.total, Object.keys(integration.axis_results[0].counts).length);
    for (const field of fields.fields) {
      const part = await integrationRegistry.query({
        family: "integration_test_design", identity: integrationIdentity,
        collection: "axes", selector: { id: "axis.complete" }, fieldPath: field.path
      });
      rebuiltCounts[field.path.at(-1)] = part.value;
    }
    if (fields.cursor === null) break;
    fields = await integrationRegistry.query({
      family: "integration_test_design", cursor: fields.cursor
    });
  }
  assert.deepEqual(rebuiltCounts, integration.axis_results[0].counts);

  const proof = oversizedProofAssessment();
  const proofRegistry = createControlledContractAssessmentSnapshotRegistry({
    now: () => 1000, random: (size) => Buffer.alloc(size, 9)
  });
  const proofIdentity = proofRegistry.put({
    family: "proof", assessment: proof, sourceIdentity: { digest: "proof-current" },
    assessOperation: "workspace_controlled_contract_assess"
  });
  const diagnosticPage = await proofRegistry.query({
    family: "proof", identity: proofIdentity, collection: "diagnostics"
  });
  const diagnosticId = diagnosticPage.items[0].stable_id;
  const metadata = await proofRegistry.query({
    family: "proof", identity: proofIdentity, collection: "diagnostics",
    selector: { id: diagnosticId }, fieldPath: ["code"]
  });
  assert.equal(metadata.range_required, true);
  const chunks = [];
  for (let offset = 0; offset < metadata.total;) {
    const range = await proofRegistry.query({
      family: "proof", identity: proofIdentity, collection: "diagnostics",
      selector: { id: diagnosticId }, fieldPath: ["code"],
      offset, length: Math.min(8192, metadata.total - offset)
    });
    chunks.push(Buffer.from(range.value_base64, "base64"));
    offset = range.next_offset ?? metadata.total;
  }
  assert.equal(Buffer.concat(chunks).toString("utf8"), proof.diagnostics[0].detail.detail.code);
  await assert.rejects(proofRegistry.query({
    family: "proof", identity: proofIdentity, collection: "diagnostics",
    selector: { id: diagnosticId }, fieldPath: ["detail_digest"]
  }), (error) => error.code === "controlled_contract_assessment_continuation_invalid");
});
