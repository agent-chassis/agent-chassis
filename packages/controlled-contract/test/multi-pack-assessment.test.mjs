import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { loadAdmittedProofPack } from "../lib/admitted-proof-packs.mjs";
import {
  PROOF_INTENT_DIGESTS
} from "../lib/proof-intent-selection.mjs";
import {
  ProofPlanError,
  assessProofPlan,
  compactMultiPackAssessment,
  expectedPackSourceDigests,
  multiPackBundleBytes,
  normalizedProofPlanForIdentity,
  validateMultiPackAssessment,
  validateProofPlan
} from "../lib/multi-pack-assessment.mjs";
import {
  canonicalDigest,
  canonicalJson,
  normalizeContractForIdentity
} from "../lib/contract-assessment.mjs";
import { buildRefusalBeforeEffectsFixture } from
  "./proof-packs/refusal-before-effects-fixture.mjs";
import { buildRetryConvergenceFixture } from
  "./proof-packs/retry-convergence-v1-fixture.mjs";
import { buildResultShapeConformanceFixture } from
  "./proof-packs/result-shape-conformance-v1-fixture.mjs";
import { buildDormancyNonactivationFixture } from
  "./proof-packs/dormancy-nonactivation-v1-fixture.mjs";
import { buildProofPlanFixture } from "./proof-plan-fixture.mjs";

const execFileAsync = promisify(execFile);

function namespaceFixture(fixture, prefix) {
  const contract = structuredClone(fixture.contract);
  const input = structuredClone(fixture.input);
  const maps = new Map();
  for (const [field, key] of [
    ["references", "reference_id"], ["propositions", "proposition_id"],
    ["claims", "claim_id"], ["relations", "relation_id"],
    ["collections", "collection_id"], ["residue", "residue_id"]
  ]) for (const item of contract[field] ?? []) {
    const separator = item[key].indexOf("-");
    maps.set(item[key], separator === -1
      ? `${item[key]}-${prefix}`
      : `${item[key].slice(0, separator)}-${prefix}-${item[key].slice(separator + 1)}`);
  }
  const replace = (value) => {
    if (typeof value === "string") return maps.get(value) ?? value;
    if (Array.isArray(value)) return value.map(replace);
    if (value !== null && typeof value === "object") return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, replace(child)])
    );
    return value;
  };
  return { contract: replace(contract), input: replace(input) };
}

function mergeContracts(fixtures) {
  const [first, ...rest] = fixtures;
  const result = structuredClone(first.contract);
  for (const fixture of rest) for (const field of [
    "references", "propositions", "claims", "relations", "collections",
    "residue", "annotations"
  ]) result[field].push(...structuredClone(fixture.contract[field]));
  return result;
}

async function setupPassingPlan(count = 2) {
  const root = await mkdtemp(path.join(os.tmpdir(), "cc-multi-pack-"));
  const fixtures = [
    namespaceFixture(buildRefusalBeforeEffectsFixture(), "refusal"),
    namespaceFixture(buildRetryConvergenceFixture(), "retry"),
    namespaceFixture(buildResultShapeConformanceFixture(), "shape")
  ].slice(0, count);
  const contract = mergeContracts(fixtures);
  const contractPath = path.join(root, "contract.json");
  const profiles = [
    "proof.authorization.refusal-before-effects",
    "proof.failure.retry-convergence",
    "proof.result-shape.conformance"
  ].slice(0, count);
  const intents = [
    "controlled-proof-intent.refusal-before-effects",
    "controlled-proof-intent.retry-convergence",
    "controlled-proof-intent.result-shape-conformance"
  ].slice(0, count);
  await writeFile(contractPath, canonicalJson(contract));
  const requests = [];
  for (let index = 0; index < count; index += 1) {
    const evaluationPath = path.join(root, `evaluation-${index}.json`);
    await writeFile(evaluationPath, canonicalJson(fixtures[index].input));
    requests.push({
      profileId: profiles[index],
      requestedIntents: [intents[index]],
      evaluationInputPath: evaluationPath
    });
  }
  const proofPlan = await buildProofPlanFixture({ contractPath, packs: requests });
  return { root, contract, contractPath, fixtures, proofPlan };
}

test("zero packs preserve structural-only proof axes as not assessed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cc-zero-pack-"));
  try {
    const contract = buildRefusalBeforeEffectsFixture().contract;
    const contractPath = path.join(root, "contract.json");
    await writeFile(contractPath, canonicalJson(contract));
    const proofPlan = {
      schema_version: "controlled-contract-proof-plan.v1",
      requested_intents: [],
      digests: {
        contract: canonicalDigest(normalizeContractForIdentity(contract)),
        catalog: PROOF_INTENT_DIGESTS.catalog,
        vocabulary: PROOF_INTENT_DIGESTS.vocabulary,
        profiles: PROOF_INTENT_DIGESTS.profiles,
        intent_artifact: PROOF_INTENT_DIGESTS.intent_artifact
      },
      packs: []
    };
    assert.equal(validateProofPlan(proofPlan), true);
    const projected = await assessProofPlan({ inputPath: contractPath, proofPlan });
    assert.equal(projected.assessment.profile_discrimination, "not_assessed");
    assert.equal(projected.assessment.exact_binding, "not_assessed");
    assert.equal(projected.assessment.assessment_scope, "planning");
    assert.equal(projected.assessment.authority, "non_authoritative");
    assert.equal(projected.assessment.per_pack.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("zero packs retain every structural diagnostic with structural provenance", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cc-zero-invalid-"));
  try {
    const contract = buildRefusalBeforeEffectsFixture().contract;
    delete contract.profile_id;
    const contractPath = path.join(root, "contract.json");
    await writeFile(contractPath, canonicalJson(contract));
    const proofPlan = {
      schema_version: "controlled-contract-proof-plan.v1",
      requested_intents: [],
      digests: {
        contract: canonicalDigest(normalizeContractForIdentity(contract)),
        catalog: PROOF_INTENT_DIGESTS.catalog,
        vocabulary: PROOF_INTENT_DIGESTS.vocabulary,
        profiles: PROOF_INTENT_DIGESTS.profiles,
        intent_artifact: PROOF_INTENT_DIGESTS.intent_artifact
      },
      packs: []
    };
    const projected = await assessProofPlan({ inputPath: contractPath, proofPlan });
    assert.equal(projected.assessment.structure, "invalid");
    assert(projected.assessment.diagnostics.length > 0);
    assert(projected.assessment.diagnostics.every(({ pack }) => pack === null));
    assert.equal(
      compactMultiPackAssessment(projected.assessment).diagnostic_count,
      projected.assessment.diagnostics.length
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("one, two, and several passing packs are independently proven", async () => {
  for (const count of [1, 2, 3]) {
    const setup = await setupPassingPlan(count);
    try {
      const projected = await assessProofPlan({
        inputPath: setup.contractPath,
        proofPlan: setup.proofPlan,
        planDirectory: setup.root
      });
      assert.equal(validateMultiPackAssessment(projected.assessment), true);
      assert.equal(projected.assessment.selected_pack_count, count);
      assert.equal(projected.assessment.evaluated_pack_count, count);
      assert.equal(projected.assessment.profile_discrimination, "proven");
      assert(projected.assessment.per_pack.every(
        ({ profile_discrimination: axis }) => axis === "proven"
      ));
      assert.equal(projected.assessment.assessment_scope, "planning");
    } finally {
      await rm(setup.root, { recursive: true, force: true });
    }
  }
});

test("one failing pack cannot be concealed by another passing pack", async () => {
  const setup = await setupPassingPlan(2);
  try {
    const failingInputPath = setup.proofPlan.packs[1].evaluation_input.path;
    const failingInput = JSON.parse(await readFile(failingInputPath, "utf8"));
    failingInput.number_bindings[0].value += 1;
    await writeFile(failingInputPath, canonicalJson(failingInput));
    const failingPack = await loadAdmittedProofPack(setup.proofPlan.packs[1].profile_id);
    setup.proofPlan.packs[1].source_digests = expectedPackSourceDigests(
      failingPack, failingInput
    );
    const projected = await assessProofPlan({
      inputPath: setup.contractPath,
      proofPlan: setup.proofPlan,
      planDirectory: setup.root
    });
    assert.deepEqual(projected.assessment.per_pack.map(
      ({ profile_discrimination: axis }) => axis
    ), ["proven", "not_proven"]);
    assert.equal(projected.assessment.profile_discrimination, "not_proven");
  } finally {
    await rm(setup.root, { recursive: true, force: true });
  }
});

test("mixed v1/v2 requests preserve independent missing exact inputs", async () => {
  const setup = await setupPassingPlan(1);
  try {
    const v2 = await loadAdmittedProofPack(
      "proof.compatibility.behavioral-preservation"
    );
    setup.proofPlan.requested_intents.push(
      "controlled-proof-intent.behavioral-preservation"
    );
    setup.proofPlan.requested_intents.sort();
    setup.proofPlan.packs.push({
      profile_id: v2.profile.profile_id,
      profile_version: v2.profile.profile_version,
      requested_intents: ["controlled-proof-intent.behavioral-preservation"],
      evaluation_input: null,
      exact_binding: null,
      source_digests: expectedPackSourceDigests(v2, null, null)
    });
    const projected = await assessProofPlan({
      inputPath: setup.contractPath,
      proofPlan: setup.proofPlan,
      planDirectory: setup.root
    });
    assert.equal(projected.assessment.evaluated_pack_count, 1);
    assert.equal(projected.assessment.profile_discrimination, "not_proven");
    assert.equal(projected.assessment.exact_binding, "not_proven");
    assert.equal(projected.assessment.missing_inputs.length, 3);
    assert(projected.assessment.missing_inputs.every(
      ({ pack }) => pack.profile_id === v2.profile.profile_id
    ));
  } finally {
    await rm(setup.root, { recursive: true, force: true });
  }
});

test("mixed v1/v2 packs each run their own admitted and exact-binding evaluation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cc-mixed-exact-"));
  try {
    const refusal = namespaceFixture(buildRefusalBeforeEffectsFixture(), "refusal");
    const dormancy = namespaceFixture(
      buildDormancyNonactivationFixture({ domain: "multi-pack" }), "dormancy"
    );
    const contract = mergeContracts([refusal, dormancy]);
    const contractPath = path.join(root, "contract.json");
    const refusalInputPath = path.join(root, "refusal-input.json");
    const dormancyInputPath = path.join(root, "dormancy-input.json");
    const role = (name) => dormancy.input.reference_bindings.find(
      ({ role: candidate }) => candidate === name
    ).reference_ids;
    const activeComponent = role("graph_nodes").find((id) =>
      id.endsWith("active-component")
    );
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
          subject_reference_id: role("production_graph")[0],
          nodes: role("graph_nodes").map((reference_id) => ({ reference_id })),
          edges: [
            { from_reference_id: role("production_entrypoints")[0],
              to_reference_id: activeComponent },
            { from_reference_id: role("production_entrypoints")[1],
              to_reference_id: activeComponent }
          ]
        }
      }
    };
    await Promise.all([
      writeFile(contractPath, canonicalJson(contract)),
      writeFile(refusalInputPath, canonicalJson(refusal.input)),
      writeFile(dormancyInputPath, canonicalJson(dormancy.input)),
      writeFile(path.join(root, "activation-observation.json"),
        canonicalJson({ complete: true, activation_events: [] })),
      writeFile(path.join(root, "default-configuration.json"),
        canonicalJson({ component: role("dormant_component")[0], active: false }))
    ]);
    const proofPlan = await buildProofPlanFixture({
      contractPath,
      packs: [{
        profileId: "proof.authorization.refusal-before-effects",
        requestedIntents: ["controlled-proof-intent.refusal-before-effects"],
        evaluationInputPath: refusalInputPath
      }, {
        profileId: "proof.dormancy.nonactivation",
        requestedIntents: ["controlled-proof-intent.dormancy-nonactivation"],
        evaluationInputPath: dormancyInputPath,
        captureRoot: root,
        exactBindingSources: sources
      }]
    });
    const projected = await assessProofPlan({
      inputPath: contractPath, proofPlan, planDirectory: root
    });
    assert.equal(projected.assessment.profile_discrimination, "proven");
    assert.equal(projected.assessment.exact_binding, "proven");
    assert.deepEqual(projected.assessment.per_pack.map((pack) => [
      pack.profile_id, pack.profile_discrimination, pack.exact_binding
    ]), [
      ["proof.authorization.refusal-before-effects", "proven", "not_applicable"],
      ["proof.dormancy.nonactivation", "proven", "proven"]
    ]);

    const missingCapturePlan = structuredClone(proofPlan);
    const missingCaptureEntry = missingCapturePlan.packs.find(
      ({ profile_id: id }) => id === "proof.dormancy.nonactivation"
    );
    missingCaptureEntry.exact_binding = null;
    const admittedDormancy = await loadAdmittedProofPack(
      missingCaptureEntry.profile_id
    );
    missingCaptureEntry.source_digests = expectedPackSourceDigests(
      admittedDormancy, dormancy.input, null
    );
    const missingCapture = await assessProofPlan({
      inputPath: contractPath,
      proofPlan: missingCapturePlan,
      planDirectory: root
    });
    assert.equal(missingCapture.assessment.evaluated_pack_count, 2);
    assert.equal(missingCapture.assessment.profile_discrimination, "not_proven");
    assert.equal(missingCapture.assessment.exact_binding, "not_proven");
    assert.equal(missingCapture.assessment.missing_inputs.length, 2);

    const missingSourcePlan = structuredClone(proofPlan);
    const exactEntry = missingSourcePlan.packs.find(
      ({ profile_id: id }) => id === "proof.dormancy.nonactivation"
    );
    delete exactEntry.exact_binding.sources["activation-observation-artifact"];
    const exactPack = await loadAdmittedProofPack(exactEntry.profile_id);
    exactEntry.source_digests = expectedPackSourceDigests(
      exactPack, dormancy.input, exactEntry.exact_binding.sources
    );
    const missingSource = await assessProofPlan({
      inputPath: contractPath, proofPlan: missingSourcePlan, planDirectory: root
    });
    assert.equal(missingSource.assessment.exact_binding, "not_proven");
    assert.equal(missingSource.assessment.profile_discrimination, "not_proven");

    const splicedRawResult = structuredClone(proofPlan);
    splicedRawResult.packs[1].exact_binding_result = {
      satisfaction: "satisfied", provenance: { capture_verified: true }
    };
    await assert.rejects(() => assessProofPlan({
      inputPath: contractPath,
      proofPlan: splicedRawResult,
      planDirectory: root
    }), (error) => error.code === "proof_plan_schema_invalid");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("duplicate packs and conflicting or swapped inputs fail closed", async () => {
  const setup = await setupPassingPlan(2);
  try {
    const duplicate = structuredClone(setup.proofPlan);
    duplicate.packs.push(structuredClone(duplicate.packs[0]));
    await assert.rejects(() => assessProofPlan({
      inputPath: setup.contractPath, proofPlan: duplicate, planDirectory: setup.root
    }), (error) => error instanceof ProofPlanError &&
      error.code === "proof_plan_duplicate_pack");

    const swappedPath = structuredClone(setup.proofPlan);
    [swappedPath.packs[0].evaluation_input.path,
      swappedPath.packs[1].evaluation_input.path] = [
      swappedPath.packs[1].evaluation_input.path,
      swappedPath.packs[0].evaluation_input.path
    ];
    await assert.rejects(() => assessProofPlan({
      inputPath: setup.contractPath,
      proofPlan: swappedPath,
      planDirectory: setup.root
    }), (error) => error.code === "proof_plan_source_digest_stale");

    const swappedWhole = structuredClone(setup.proofPlan);
    [swappedWhole.packs[0].evaluation_input, swappedWhole.packs[1].evaluation_input] = [
      swappedWhole.packs[1].evaluation_input,
      swappedWhole.packs[0].evaluation_input
    ];
    [swappedWhole.packs[0].source_digests.evaluation_input,
      swappedWhole.packs[1].source_digests.evaluation_input] = [
      swappedWhole.packs[1].source_digests.evaluation_input,
      swappedWhole.packs[0].source_digests.evaluation_input
    ];
    const result = await assessProofPlan({
      inputPath: setup.contractPath,
      proofPlan: swappedWhole,
      planDirectory: setup.root
    });
    assert.equal(result.assessment.profile_discrimination, "not_proven");
    assert(result.assessment.per_pack.every(
      ({ profile_discrimination: axis }) => axis !== "proven"
    ));
  } finally {
    await rm(setup.root, { recursive: true, force: true });
  }
});

test("pack and request order cannot change result or artifact identity", async () => {
  const setup = await setupPassingPlan(3);
  try {
    const baseline = await assessProofPlan({
      inputPath: setup.contractPath,
      proofPlan: setup.proofPlan,
      planDirectory: setup.root
    });
    const reordered = structuredClone(setup.proofPlan);
    reordered.requested_intents.reverse();
    reordered.packs.reverse();
    for (const pack of reordered.packs) pack.requested_intents.reverse();
    const second = await assessProofPlan({
      inputPath: setup.contractPath,
      proofPlan: reordered,
      planDirectory: setup.root
    });
    assert.equal(second.assessment.assessment_identity,
      baseline.assessment.assessment_identity);
    assert.deepEqual(second, baseline);
    assert.deepEqual(normalizedProofPlanForIdentity(reordered),
      normalizedProofPlanForIdentity(setup.proofPlan));
    assert.deepEqual(multiPackBundleBytes(second), multiPackBundleBytes(baseline));
  } finally {
    await rm(setup.root, { recursive: true, force: true });
  }
});

test("aggregation preserves every diagnostic and exclusion with pack provenance", async () => {
  const setup = await setupPassingPlan(2);
  try {
    const projected = await assessProofPlan({
      inputPath: setup.contractPath,
      proofPlan: setup.proofPlan,
      planDirectory: setup.root
    });
    const expectedExclusions = projected.reports.proofPacks.packs.reduce(
      (count, pack) => count + pack.admission.explicit_exclusions.length, 0
    );
    assert.equal(projected.assessment.proof_exclusions.length, expectedExclusions);
    assert(projected.assessment.proof_exclusions.every(
      ({ pack, detail }) => pack.profile_id && detail.exclusion_id
    ));
    const full = JSON.parse(multiPackBundleBytes(projected).get(
      "proof-packs.full.json"
    ));
    assert.equal(full.packs.length, 2);
    assert.equal(full.packs.reduce((count, pack) =>
      count + pack.admission.explicit_exclusions.length, 0), expectedExclusions);
  } finally {
    await rm(setup.root, { recursive: true, force: true });
  }
});

test("results are detached, immutable, contain no unqualified pass, and stay compact", async () => {
  const setup = await setupPassingPlan(2);
  try {
    const inputPlan = structuredClone(setup.proofPlan);
    const projected = await assessProofPlan({
      inputPath: setup.contractPath,
      proofPlan: inputPlan,
      planDirectory: setup.root
    });
    inputPlan.packs.length = 0;
    assert.equal(projected.assessment.per_pack.length, 2);
    assert.equal(Object.isFrozen(projected.assessment.per_pack), true);
    assert.throws(() => projected.assessment.per_pack.push({}), TypeError);
    const serialized = JSON.stringify(projected);
    assert.equal(/"passed"\s*:/u.test(serialized), false);
    const compact = compactMultiPackAssessment(projected.assessment);
    assert.equal(JSON.stringify(compact).length < 2500, true);
    assert.equal(JSON.stringify(compact).includes("claim_patterns"), false);
  } finally {
    await rm(setup.root, { recursive: true, force: true });
  }
});

test("independent processes, locales, and timezones preserve compact identity", async () => {
  const setup = await setupPassingPlan(2);
  try {
    const planPath = path.join(setup.root, "proof-plan.json");
    await writeFile(planPath, canonicalJson(setup.proofPlan));
    const cli = path.resolve(
      import.meta.dirname, "../bin/assess-contract.mjs"
    );
    const args = [cli, "--input", setup.contractPath, "--proof-plan", planPath];
    const outputs = [];
    for (const env of [
      { TZ: "UTC", LANG: "C" },
      { TZ: "Pacific/Auckland", LANG: "en_US.UTF-8" }
    ]) outputs.push((await execFileAsync(process.execPath, args, {
      cwd: path.resolve(import.meta.dirname, "../../.."),
      env: { ...process.env, ...env }
    })).stdout);
    assert.equal(outputs[0], outputs[1]);
    const compact = JSON.parse(outputs[0]);
    assert.equal(compact.selected_pack_count, 2);
    assert.equal(compact.profile_discrimination, "proven");
    assert.equal(compact.assessment_scope, "planning");
  } finally {
    await rm(setup.root, { recursive: true, force: true });
  }
});
