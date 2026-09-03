import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  canonicalDigest as exactCanonicalDigest
} from "../lib/exact-binding-common.mjs";
import {
  PinnedCaptureRoot,
  captureAndEvaluateExactBindingsV1
} from "../lib/exact-binding-capture.mjs";
import {
  snapshotExactBindingAssessmentRequest
} from "../lib/exact-binding-plain-data.mjs";
import {
  loadAdmittedProofPack
} from "../lib/admitted-proof-packs.mjs";
import {
  canonicalJson,
  projectContractAssessment
} from "../lib/contract-assessment.mjs";
import { parseArgs } from "../bin/assess-contract.mjs";
import { checkContract } from "../bin/check-contract.mjs";
import {
  VOCABULARY_DIGESTS,
  VOCABULARY_VERSION
} from "../lib/vocabulary-v034.mjs";
import {
  buildIdempotencyV2Fixture
} from "./proof-packs/idempotency-v2-test-fixture.mjs";

const PROFILE_ID = "proof.idempotency.effect-nonduplication";
const SOURCES = Object.freeze({
  "first-state": { kind: "artifact_file", relative_path: "first.bin" },
  "second-state": { kind: "artifact_file", relative_path: "second.bin" }
});

async function syntheticExactProjection({ first = "same", second = "same",
  sources = SOURCES } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "cc-exact-aggregate-"));
  const fixture = buildIdempotencyV2Fixture();
  const source = canonicalJson(fixture.contract);
  await Promise.all([
    writeFile(path.join(root, "contract.json"), source),
    writeFile(path.join(root, "evaluation.json"), canonicalJson(fixture.input)),
    writeFile(path.join(root, "first.bin"), first),
    writeFile(path.join(root, "second.bin"), second)
  ]);
  const loaded = await loadAdmittedProofPack(PROFILE_ID);
  const declaration = {
    schema_version: "controlled-contract-exact-binding-declaration.v1",
    profile_id: loaded.profile.profile_id,
    profile_version: loaded.profile.profile_version,
    profile_digest: loaded.profile_digest,
    requirements: [
      {
        requirement_id: "first-state",
        binding_kind: "artifact_bytes",
        role_coverage: [{
          role: "state_after_first", coverage: "exact", projection: "artifact_subject"
        }]
      },
      {
        requirement_id: "second-state",
        binding_kind: "artifact_bytes",
        role_coverage: [{
          role: "state_after_second", coverage: "exact", projection: "artifact_subject"
        }]
      }
    ],
    relations: [{
      relation_id: "states-have-same-content",
      operator: "same_content_sha256",
      requirement_ids: ["first-state", "second-state"]
    }]
  };
  const pack = Object.freeze({
    ...loaded,
    admission_version: 2,
    declaration,
    exact_binding_declaration_digest: exactCanonicalDigest(declaration),
    exact_binding_certification_digest: "c".repeat(64)
  });
  const context = {
    contract_digest: exactCanonicalDigest(fixture.contract),
    profile_digest: pack.profile_digest,
    evaluation_input_digest: exactCanonicalDigest(fixture.input),
    vocabulary_version: VOCABULARY_VERSION,
    vocabulary_complete_digest: VOCABULARY_DIGESTS.complete,
    admission_digest: pack.admission_digest,
    exact_binding_declaration_digest: pack.exact_binding_declaration_digest,
    exact_binding_certification_digest: pack.exact_binding_certification_digest
  };
  const request = snapshotExactBindingAssessmentRequest({
    contractPath: "contract.json",
    evaluationInputPath: "evaluation.json",
    profileId: PROFILE_ID,
    exactBindingSources: structuredClone(sources)
  });
  const pinnedRoot = await PinnedCaptureRoot.open(root);
  let exactBindingResult;
  try {
    exactBindingResult = await captureAndEvaluateExactBindingsV1({
      request,
      declaration,
      evaluationInput: fixture.input,
      context,
      expectedContext: context,
      pinnedRoot
    });
  } finally {
    await pinnedRoot.close();
  }
  const structuralResult = await checkContract(path.join(root, "contract.json"));
  const project = (overrides = {}) => projectContractAssessment({
    mode: "exact_bound_profile",
    contract: fixture.contract,
    structuralResult,
    structuralInputSource: source,
    evaluationInput: fixture.input,
    proofPack: pack,
    exactBindingResult,
    exactBindingSources: sources,
    ...overrides
  });
  return { root, fixture, source, pack, structuralResult, exactBindingResult, project };
}

test("joined axes prove only when structural, profile, and exact capture all pass", async () => {
  const subject = await syntheticExactProjection();
  try {
    const projected = subject.project();
    assert.equal(projected.assessment.structure, "proven");
    assert.equal(projected.assessment.profile_discrimination, "proven");
    assert.equal(projected.assessment.exact_binding, "proven");
    assert.equal(projected.assessment.assessment_scope, "planning");
    assert.match(projected.assessment.overall_code, /__exact_binding_proven__/u);
    assert.equal(projected.assessment.digests.source.exact_binding_sources,
      exactCanonicalDigest(SOURCES));
  } finally {
    await rm(subject.root, { recursive: true, force: true });
  }
});

test("changed bytes make exact binding and aggregate profile discrimination not proven", async () => {
  const subject = await syntheticExactProjection({ second: "changed" });
  try {
    const projected = subject.project();
    assert.equal(subject.exactBindingResult.satisfaction, "unsatisfied");
    assert.equal(projected.assessment.exact_binding, "not_proven");
    assert.equal(projected.assessment.profile_discrimination, "not_proven");
  } finally {
    await rm(subject.root, { recursive: true, force: true });
  }
});

test("omitted source is a visible non-proof", async () => {
  const sources = { "first-state": SOURCES["first-state"] };
  const subject = await syntheticExactProjection({ sources });
  try {
    const projected = subject.project({ exactBindingSources: sources });
    assert.equal(subject.exactBindingResult.satisfaction, "indeterminate");
    assert.equal(projected.assessment.exact_binding, "not_proven");
    assert.equal(projected.assessment.profile_discrimination, "not_proven");
  } finally {
    await rm(subject.root, { recursive: true, force: true });
  }
});

test("v2 pack cannot use authored-profile mode without exact capture", async () => {
  const subject = await syntheticExactProjection();
  try {
    assert.throws(() => projectContractAssessment({
      mode: "admitted_profile",
      contract: subject.fixture.contract,
      structuralResult: subject.structuralResult,
      structuralInputSource: subject.source,
      evaluationInput: subject.fixture.input,
      proofPack: subject.pack
    }), /require exact capture inputs/u);
  } finally {
    await rm(subject.root, { recursive: true, force: true });
  }
});

test("captured result cannot be copied or spliced into another envelope", async () => {
  const subject = await syntheticExactProjection();
  try {
    assert.throws(() => subject.project({
      exactBindingResult: structuredClone(subject.exactBindingResult)
    }), /exact result returned by deterministic capture/u);
    const changedInput = structuredClone(subject.fixture.input);
    changedInput.evaluation_stage = "post_delivery";
    const spliced = subject.project({ evaluationInput: changedInput });
    assert.equal(spliced.assessment.exact_binding, "not_proven");
    assert.equal(spliced.assessment.profile_discrimination, "not_proven");
  } finally {
    await rm(subject.root, { recursive: true, force: true });
  }
});

test("v1 admitted profile behavior stays proven with exact binding not applicable", async () => {
  const subject = await syntheticExactProjection();
  try {
    const projected = projectContractAssessment({
      mode: "admitted_profile",
      contract: subject.fixture.contract,
      structuralResult: subject.structuralResult,
      structuralInputSource: subject.source,
      evaluationInput: subject.fixture.input,
      proofPack: await loadAdmittedProofPack(PROFILE_ID)
    });
    assert.equal(projected.assessment.profile_discrimination, "proven");
    assert.equal(projected.assessment.exact_binding, undefined);
    assert.equal(projected.assessment.overall_code,
      "structure_proven__profile_proven__residue_none");
    assert.equal(projected.assessment.lossless_report.files.length, 6);
  } finally {
    await rm(subject.root, { recursive: true, force: true });
  }
});

test("assessment CLI rejects every legacy single-pack and exact-binding flag", () => {
  assert.throws(() => parseArgs([
    "--input", "contract.json", "--profile", PROFILE_ID,
    "--evaluation-input", "evaluation.json"
  ]), /unknown argument: --profile/u);
  assert.throws(() => parseArgs([
    "--input", "contract.json", "--capture-root", "root",
    "--exact-binding-sources", "sources.json"
  ]), /unknown argument: --capture-root/u);
});

test("joined assessment and source descriptor binding are deterministic", async () => {
  const subject = await syntheticExactProjection();
  try {
    const first = canonicalJson(subject.project());
    const second = canonicalJson(subject.project({
      exactBindingSources: {
        "second-state": SOURCES["second-state"],
        "first-state": SOURCES["first-state"]
      }
    }));
    assert.equal(first, second);
  } finally {
    await rm(subject.root, { recursive: true, force: true });
  }
});
