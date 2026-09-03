import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assessProofPlan,
  multiPackBundleBytes,
  multiPackManifestFor
} from "../lib/multi-pack-assessment.mjs";
import {
  proofAwarePlanningArtifactsFor as proofAwareSupplementsFor
} from "../lib/lossless-supplement-context.mjs";
import {
  canonicalJson,
  normalizeContractForIdentity
} from "../lib/contract-assessment.mjs";
import {
  EXACT_BINDING_SOURCES,
  createCallerInputAuthorityConfinementSubject
} from "./proof-packs/caller-input-authority-confinement-v1-harness.mjs";
import { buildProofPlanFixture } from "./proof-plan-fixture.mjs";
import { buildRefusalBeforeEffectsFixture } from
  "./proof-packs/refusal-before-effects-fixture.mjs";

const PROFILE = "proof.input.caller-authority-confinement";
const INTENT = "controlled-proof-intent.caller-input-authority-confinement";
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function planFor(subject, { exact = true } = {}) {
  return buildProofPlanFixture({
    contractPath: path.join(subject.root, "contract.json"),
    packs: [{
      profileId: PROFILE,
      requestedIntents: [INTENT],
      evaluationInputPath: path.join(subject.root, "evaluation-input.json"),
      ...(exact ? {
        captureRoot: subject.root,
        exactBindingSources: EXACT_BINDING_SOURCES
      } : {})
    }]
  });
}

async function assessedInputCount(subject) {
  const proofPlan = await planFor(subject);
  const projected = await assessProofPlan({
    inputPath: path.join(subject.root, "contract.json"),
    proofPlan,
    planDirectory: subject.root
  });
  const [entry] = proofAwareSupplementsFor(projected).supplement_census.entries;
  assert.equal(entry.result.status, "success", JSON.stringify(entry.result));
  return {
    contractBytes: Buffer.byteLength(canonicalJson(
      normalizeContractForIdentity(subject.contract)
    )),
    verifiedInputBytes: entry.result.counts.verified_input_bytes
  };
}

test("multi-pack assessment persists one same-cycle supplement beside its manifest",
  async () => {
    const subject = await createCallerInputAuthorityConfinementSubject();
    try {
      const proofPlan = await planFor(subject);
      const projected = await assessProofPlan({
        inputPath: path.join(subject.root, "contract.json"),
        proofPlan,
        planDirectory: subject.root
      });
      const planning = proofAwareSupplementsFor(projected);
      assert.equal(planning.supplement_census.entry_count, 1);
      const [entry] = planning.supplement_census.entries;
      assert.equal(entry.requirement, "required");
      assert.equal(entry.result.status, "success", JSON.stringify(entry.result));
      assert.equal(entry.result.validation_status, "validated_complete");
      assert.equal(entry.result.cycle_binding.assessment_pack_cycle_digest,
        entry.assessment_pack_cycle_digest);
      assert.equal(planning.planning_pack_cycles[0]
        .assessment_pack_cycle_digest, entry.assessment_pack_cycle_digest);
      assert.equal(planning.root_cycle.planning_pack_census.entry_count, 1);

      const bundle = multiPackBundleBytes(projected);
      const manifest = multiPackManifestFor(projected);
      assert.equal(bundle.get("manifest.json"), canonicalJson(manifest));
      assert.equal(manifest.files.some(({ name }) =>
        name.includes("supplement") || name.includes("planning")), false);
      assert.equal(bundle.has("projected-selection-supplement-0.json"), true);
      assert.equal(bundle.has("assessment-pack-cycles.json"), true);
      assert.equal(bundle.has("projected-selection-supplement-census.json"), true);
      assert.equal(bundle.has("planning-pack-cycles.json"), true);
      assert.equal(bundle.has("proof-aware-input-cycle.json"), true);
      assert.equal(JSON.stringify(projected).includes("supplement_identity"), false,
        "assessment truth and per-pack carriers remain unchanged");
    } finally {
      await subject.cleanup();
    }
  });

test("a supplement failure is typed and does not rewrite the proof result", async () => {
  const subject = await createCallerInputAuthorityConfinementSubject();
  try {
    const proofPlan = await planFor(subject, { exact: false });
    const projected = await assessProofPlan({
      inputPath: path.join(subject.root, "contract.json"),
      proofPlan,
      planDirectory: subject.root
    });
    const assessmentBefore = canonicalJson(projected.assessment);
    const [entry] = proofAwareSupplementsFor(projected).supplement_census.entries;
    assert.equal(entry.requirement, "required");
    assert.equal(entry.result.status, "missing_lossless_fact");
    assert.equal("projected_graph" in entry.result, false);
    assert.equal("supplement_identity" in entry.result, false);
    assert.equal(canonicalJson(projected.assessment), assessmentBefore);
    assert.equal(projected.assessment.exact_binding, "not_proven");
  } finally {
    await subject.cleanup();
  }
});

test("a pack without projected-evaluation binding gets only the not-required marker",
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "cc-unit1-not-required-"));
    try {
      const fixture = buildRefusalBeforeEffectsFixture();
      const contractPath = path.join(root, "contract.json");
      const evaluationPath = path.join(root, "evaluation.json");
      await writeFile(contractPath, canonicalJson(fixture.contract));
      await writeFile(evaluationPath, canonicalJson(fixture.input));
      const proofPlan = await buildProofPlanFixture({
        contractPath,
        packs: [{
          profileId: "proof.authorization.refusal-before-effects",
          requestedIntents: ["controlled-proof-intent.refusal-before-effects"],
          evaluationInputPath: evaluationPath
        }]
      });
      const projected = await assessProofPlan({
        inputPath: contractPath, proofPlan, planDirectory: root
      });
      const [entry] = proofAwareSupplementsFor(projected).supplement_census.entries;
      assert.equal(entry.requirement, "not_required");
      assert.deepEqual(entry.result, {
        status: "not_required", marker: "projected_selection_not_required"
      });
      assert.equal(JSON.stringify(entry).includes("projected_graph"), false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

test("persisted supplement bytes are detached from mutable caller files", async () => {
  const subject = await createCallerInputAuthorityConfinementSubject();
  try {
    const proofPlan = await planFor(subject);
    const projected = await assessProofPlan({
      inputPath: path.join(subject.root, "contract.json"),
      proofPlan,
      planDirectory: subject.root
    });
    const before = multiPackBundleBytes(projected).get(
      "projected-selection-supplement-0.json"
    );
    await writeFile(path.join(subject.root, "contract.json"), "{}\n");
    assert.equal(multiPackBundleBytes(projected).get(
      "projected-selection-supplement-0.json"
    ), before);
  } finally {
    await subject.cleanup();
  }
});

test("multi-pack input accounting includes the complete canonical contract bytes",
  async () => {
    const baseline = await createCallerInputAuthorityConfinementSubject();
    const padded = await createCallerInputAuthorityConfinementSubject({
      mutateContract: (contract) => {
        contract.annotations.push({
          annotation_id: "ann-unit1-input-census",
          kind: "note",
          text: "x".repeat(4096)
        });
        return contract;
      }
    });
    try {
      const before = await assessedInputCount(baseline);
      const after = await assessedInputCount(padded);
      const verifiedDelta = after.verifiedInputBytes - before.verifiedInputBytes;
      assert.ok(verifiedDelta >= 4096,
        `the complete contract payload must be counted: ${verifiedDelta}`);
      assert.ok(after.verifiedInputBytes >= after.contractBytes);
    } finally {
      await baseline.cleanup();
      await padded.cleanup();
    }
  });

test("packed public assessment entrypoints load with the private Unit 1 closure",
  async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "cc-unit1-pack-"));
    try {
      const packed = JSON.parse(execFileSync("npm", [
        "pack", "--json", "--pack-destination", temporary,
        "--cache", path.join(temporary, "npm-cache")
      ], { cwd: packageRoot, encoding: "utf8" }));
      assert.equal(packed.length, 1);
      const expectedPrivatePayload = [
        "lib/lossless-supplement-context.mjs",
        "lib/projected-selection-constants.mjs",
        "lib/projected-selection-cycle.mjs",
        "lib/projected-selection-supplement.experimental.v1.schema.json",
        "lib/projected-selection-supplement.mjs",
        "lib/projected-selection-trust.mjs",
        "lib/proof-aware-digest.mjs"
      ];
      const packedPaths = new Set(packed[0].files.map(({ path: file }) => file));
      assert.deepEqual(expectedPrivatePayload.filter(
        (file) => !packedPaths.has(file)
      ), []);
      const extractRoot = path.join(temporary, "extract");
      await mkdir(extractRoot);
      execFileSync("tar", [
        "-xzf", path.join(temporary, packed[0].filename), "-C", extractRoot
      ]);
      await symlink(path.resolve(packageRoot, "../../node_modules"),
        path.join(extractRoot, "node_modules"), "dir");
      for (const entrypoint of [
        "@agent-chassis/controlled-contract/assessment",
        "@agent-chassis/controlled-contract/multi-pack-assessment"
      ]) execFileSync(process.execPath, [
        "--input-type=module", "-e", `await import(${JSON.stringify(entrypoint)})`
      ], { cwd: path.join(extractRoot, "package"), encoding: "utf8" });
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
