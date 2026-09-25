import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { assessContractFiles, canonicalJson, writeAssessmentBundle }
  from "../../lib/contract-assessment.mjs";
import { main as assessContractMain } from "../../bin/assess-contract.mjs";
import { canonicalDigest, runProofPackAdequacy }
  from "../support/proof-pack-adequacy.mjs";
import { buildDormancyNonactivationFixture }
  from "./dormancy-nonactivation-v1-fixture.mjs";
import { buildProofPlanFixture } from "../proof-plan-fixture.mjs";
import { buildStableTestProofPopulation } from "../support/stable-v1-proof-pack-runtime.mjs";
import { certificationDirectory as certificationDirectoryOf, readDefinitionDocument } from "../support/certification-artifact.mjs";

const profileId = "proof.dormancy.nonactivation";
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repositoryRoot = path.resolve(packageRoot, "../..");
const identity = { profile_id: "proof.dormancy.nonactivation", profile_version: "4.0.0" };
const certificationDirectory = certificationDirectoryOf(identity);

async function subject() {
  const captureRoot = await mkdtemp(path.join(os.tmpdir(), "dormancy-exact-bound-"));
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "dormancy-assessment-output-"));
  const fixture = buildDormancyNonactivationFixture({ domain: "plugin-registry" });
  fixture.contract.test_proofs = buildStableTestProofPopulation(fixture.contract);
  const graphNodes = fixture.input.reference_bindings.find(
    ({ role }) => role === "graph_nodes").reference_ids;
  const sources = {
    "activation-observation-artifact": {
      kind: "artifact_file", relative_path: "activation-observation.json"
    },
    "default-configuration-artifact": {
      kind: "artifact_file", relative_path: "default-configuration.json"
    },
    "production-reachability-snapshot": {
      kind: "complete_reachability_snapshot",
      snapshot: {
        complete: true,
        subject_reference_id: "ref-production-graph",
        nodes: graphNodes.map((reference_id) => ({ reference_id })),
        edges: [
          { from_reference_id: "ref-production-entry-a",
            to_reference_id: "ref-active-component" },
          { from_reference_id: "ref-production-entry-b",
            to_reference_id: "ref-active-component" }
        ]
      }
    }
  };
  await Promise.all([
    writeFile(path.join(captureRoot, "contract.json"), canonicalJson(fixture.contract)),
    writeFile(path.join(captureRoot, "evaluation-input.json"), canonicalJson(fixture.input)),
    writeFile(path.join(captureRoot, "activation-observation.json"),
      canonicalJson({ complete: true, activation_events: [] })),
    writeFile(path.join(captureRoot, "default-configuration.json"),
      canonicalJson({ component: "ref-dormant-component", active: false })),
    writeFile(path.join(captureRoot, "sources.json"), canonicalJson(sources))
  ]);
  return { captureRoot, outputRoot, fixture, sources };
}

test("dormancy assessment joins the admitted profile with its evaluation input", async () => {
  const value = await subject();
  try {
    const projected = await assessContractFiles({
      inputPath: path.join(value.captureRoot, "contract.json"),
      profileId,
      evaluationInputPath: path.join(value.captureRoot, "evaluation-input.json")
    });
    assert.equal(projected.assessment.structure, "proven");
    assert.equal(projected.assessment.profile_discrimination, "proven");
    assert.equal(projected.assessment.assessment_scope, "planning");
    const bundle = await writeAssessmentBundle(projected, {
      repositoryRoot: value.outputRoot
    });
    assert.equal(typeof bundle.directory, "string");

    const contractPath = path.join(value.captureRoot, "contract.json");
    const proofPlanPath = path.join(value.captureRoot, "proof-plan.json");
    const proofPlan = await buildProofPlanFixture({
      contractPath,
      packs: [{
        profileId,
        requestedIntents: ["controlled-proof-intent.dormancy-nonactivation"],
        evaluationInputPath: path.join(value.captureRoot, "evaluation-input.json")
      }]
    });
    await writeFile(proofPlanPath, canonicalJson(proofPlan));
    const compact = await assessContractMain([
      "--input", contractPath,
      "--proof-plan", proofPlanPath
    ], { repositoryRoot: value.outputRoot });
    assert.equal(compact.structure, "proven");
    assert.equal(compact.profile_discrimination, "proven");
    assert.equal(compact.assessment_scope, "planning");
  } finally {
    await Promise.all([rm(value.captureRoot, { recursive: true, force: true }),
      rm(value.outputRoot, { recursive: true, force: true })]);
  }
});



test("dormancy full-census admission binds every fixed negative and rebound witness", async () => {
  const fullCensus = await runProofPackAdequacy(certificationDirectory, {
    repositoryRoot, variationMode: "full_census"
  });
  assert.equal(fullCensus.passed, true, JSON.stringify(fullCensus.diagnostics));
  assert.deepEqual(fullCensus.diagnostics, []);
  assert.equal(fullCensus.control_count, 42);
  assert.equal(fullCensus.negative_fixture_count, 52);
  assert.equal(fullCensus.coverage_witness_count, 52);
  assert.equal(fullCensus.negative_fixture_results.every(
    ({ outcome }) => outcome === "rejected"), true);
  assert.equal(fullCensus.coverage_witness_results.every(
    ({ outcome }) => outcome === "survived"), true);

  const [stored, admission] = await Promise.all([
    readDefinitionDocument(identity, "certification-result.full-census.json"),
    readDefinitionDocument(identity, "admission.json")
  ]);
  assert.deepEqual(fullCensus, stored);
  assert.equal(canonicalDigest(fullCensus), admission.certification.adequacy_result_digest);
});
