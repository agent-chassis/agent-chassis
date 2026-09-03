import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  canonicalDigest,
  canonicalJsonBytes,
  sha256
} from "../../lib/exact-binding-common.mjs";
import {
  PinnedCaptureRoot,
  captureAndEvaluateExactBindingsV1
} from "../../lib/exact-binding-capture.mjs";
import { snapshotExactBindingAssessmentRequest } from
  "../../lib/exact-binding-plain-data.mjs";
import { evaluateStableProofPackFixtureV1, profileDigest } from
  "../support/stable-v1-proof-pack-runtime.mjs";
import { VOCABULARY_DIGESTS } from "../../vocabulary/controlled-contract-vocabulary.v1.mjs";
import { runProofPackAdequacy } from "../support/proof-pack-adequacy.mjs";
import {
  buildAuthenticationProvenanceFixture,
  buildAuthenticationProvenanceSources
} from "./authentication-provenance-v1-fixture.mjs";
import {
  buildProfileWeakeningControls,
  rejectionFixtures
} from "./authentication-provenance-v1-adequacy.mjs";
import { runExactBindingCertificationControls } from
  "./authentication-provenance-v1-exact-corpus.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const certificationDirectory = path.join(packageRoot,
  "test/certification/profiles/proof.authentication.direct-source-provenance/2.0.0");
const frozenCaptureRoot = path.join(certificationDirectory, "exact-capture/positive");

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function exactSubject(root = frozenCaptureRoot) {
  const [declaration, contract, evaluationInput, sources] = await Promise.all([
    readJson(path.join(certificationDirectory, "exact-binding.json")),
    readJson(path.join(root, "contract.json")),
    readJson(path.join(root, "evaluation-input.json")),
    readJson(path.join(root, "sources.json"))
  ]);
  return { declaration, contract, evaluationInput, sources };
}

function exactContext({ declaration, contract, evaluationInput }) {
  return {
    contract_digest: canonicalDigest(contract),
    profile_digest: declaration.profile_digest,
    evaluation_input_digest: canonicalDigest(evaluationInput),
    vocabulary_version: "controlled-contract-vocabulary.v1",
    vocabulary_complete_digest: VOCABULARY_DIGESTS.complete,
    admission_digest: "1".repeat(64),
    exact_binding_declaration_digest: "2".repeat(64),
    exact_binding_certification_digest: "3".repeat(64)
  };
}

async function evaluateExact(root, subject, {
  context = exactContext(subject), expectedContext = context
} = {}) {
  const request = snapshotExactBindingAssessmentRequest({
    contractPath: "contract.json",
    evaluationInputPath: "evaluation-input.json",
    profileId: subject.declaration.profile_id,
    exactBindingSources: subject.sources
  });
  const pinnedRoot = await PinnedCaptureRoot.open(root);
  try {
    return await captureAndEvaluateExactBindingsV1({
      request,
      declaration: subject.declaration,
      contract: subject.contract,
      evaluationInput: subject.evaluationInput,
      context,
      expectedContext,
      pinnedRoot
    });
  } finally {
    await pinnedRoot.close();
  }
}

async function mutableSubject() {
  const root = await mkdtemp(path.join(os.tmpdir(), "auth-provenance-exact-"));
  await cp(frozenCaptureRoot, root, { recursive: true });
  return { root, subject: await exactSubject(root) };
}

test("direct-source authentication/provenance pack passes indexed and full-census gates", async () => {
  for (const variationMode of ["indexed", "full_census"]) {
    const result = await runProofPackAdequacy(certificationDirectory, { variationMode });
    assert.equal(result.passed, true, JSON.stringify(result.diagnostics));
    assert.deepEqual(result.diagnostics, []);
    assert.equal(result.control_count, 75);
    assert.equal(result.negative_fixture_count, 1);
    assert.equal(result.coverage_witness_count, 74);
  }
});

test("exact occurrence capture closes all sources and binds raw E/T/S/A roles", async () => {
  const positive = await exactSubject();
  assert.equal((await evaluateExact(frozenCaptureRoot, positive)).satisfaction,
    "satisfied");

  for (const requirementId of Object.keys(positive.sources)) {
    const omitted = structuredClone(positive);
    delete omitted.sources[requirementId];
    assert.notEqual((await evaluateExact(frozenCaptureRoot, omitted)).satisfaction,
      "satisfied", `missing ${requirementId}`);

    const substituted = structuredClone(positive);
    const replacement = Object.keys(positive.sources).find((id) => id !== requirementId);
    substituted.sources[requirementId] = structuredClone(positive.sources[replacement]);
    assert.notEqual((await evaluateExact(frozenCaptureRoot, substituted)).satisfaction,
      "satisfied", `substituted ${requirementId}`);
  }

  const extra = structuredClone(positive);
  extra.sources.undeclared = structuredClone(extra.sources["evidence-content"]);
  assert.notEqual((await evaluateExact(frozenCaptureRoot, extra)).satisfaction, "satisfied");

  const reused = structuredClone(positive);
  reused.sources["target-resolution-witness"] =
    structuredClone(reused.sources["evidence-content"]);
  assert.notEqual((await evaluateExact(frozenCaptureRoot, reused)).satisfaction, "satisfied");
});

test("equality aliases reveal contradictions but never satisfy substituted exact roles", async () => {
  const roleCases = [
    ["target", "ref-provenance-source"],
    ["source", "ref-observation-attempt-one"],
    ["observation_attempt", "ref-provenance-source"],
    ["evidence_occurrence", "ref-authenticated-target"]
  ];
  for (const [role, substitutedReferenceId] of roleCases) {
    const subject = await exactSubject();
    subject.evaluationInput.reference_bindings.find(
      ({ role: candidate }) => candidate === role
    ).reference_ids = [substitutedReferenceId];
    const result = await evaluateExact(frozenCaptureRoot, subject);
    assert.notEqual(result.satisfaction, "satisfied", role);

    const alias = structuredClone(subject);
    const originalReferenceId = (await exactSubject()).evaluationInput.reference_bindings.find(
      ({ role: candidate }) => candidate === role
    ).reference_ids[0];
    alias.contract.propositions.push({
      proposition_id: `prop-equality-alias-${role.replaceAll("_", "-")}`,
      subject_reference_id: originalReferenceId,
      operator: "reference:equals",
      applicability_context: {
        mode: "during", operand_reference_ids: ["ref-observation-attempt-one"]
      },
      operands: [{ kind: "reference", reference_id: substitutedReferenceId }]
    });
    alias.contract.claims.push({
      claim_id: `claim-equality-alias-${role.replaceAll("_", "-")}`,
      kind: "evidence",
      modality: "MUST",
      proposition_id: `prop-equality-alias-${role.replaceAll("_", "-")}`
    });
    assert.notEqual((await evaluateExact(frozenCaptureRoot, alias)).satisfaction,
      "satisfied", `equality alias ${role}`);
  }
});

test("result splicing and fully recomputed alternate occurrences do not bind the old graph", async () => {
  const mutable = await mutableSubject();
  try {
    const resultPath = path.join(mutable.root, "occurrence-capture.json");
    const spliced = await readJson(resultPath);
    [spliced.roles.target, spliced.roles.source] =
      [spliced.roles.source, spliced.roles.target];
    await writeFile(resultPath, canonicalJsonBytes(spliced, { file: true }));
    assert.notEqual((await evaluateExact(mutable.root, mutable.subject)).satisfaction,
      "satisfied");
  } finally {
    await rm(mutable.root, { recursive: true, force: true });
  }

  const alternate = await mutableSubject();
  try {
    const capture = buildAuthenticationProvenanceSources({ occurrenceSuffix: "alternate" });
    const files = [
      ["evidence-content.bin", capture.input.evidenceContentBytes],
      ["target-resolution-witness.json", capture.input.targetResolutionWitnessBytes],
      ["source-authentication-witness.json", capture.input.sourceAuthenticationWitnessBytes],
      ["source-of-record-witness.json", capture.input.sourceOfRecordAssignmentWitnessBytes],
      ["attempt-binding-witness.json", capture.input.attemptBindingWitnessBytes],
      ["authentication-witness.json", capture.input.authenticationWitnessBytes],
      ["occurrence-capture.json", capture.resultBytes]
    ];
    await Promise.all(files.map(([file, bytes]) =>
      writeFile(path.join(alternate.root, file), bytes)));
    assert.notEqual((await evaluateExact(alternate.root, alternate.subject)).satisfaction,
      "satisfied");
  } finally {
    await rm(alternate.root, { recursive: true, force: true });
  }
});

test("every exact-binding context field is immutable", async () => {
  const subject = await exactSubject();
  const expected = exactContext(subject);
  for (const field of Object.keys(expected)) {
    const context = structuredClone(expected);
    context[field] = field === "vocabulary_version"
      ? "cv.experimental.substituted"
      : "f".repeat(64);
    assert.notEqual((await evaluateExact(frozenCaptureRoot, subject, {
      context, expectedContext: expected
    })).satisfaction, "satisfied", field);
  }
});

test("profile weakenings are re-digested yet the canonical controls still reject them", () => {
  const canonical = buildAuthenticationProvenanceFixture();
  const exhaustive = buildProfileWeakeningControls(canonical.profile);
  assert.equal(exhaustive.length, 13);
  assert.ok(exhaustive.every(({ result }) => result.passed));
  assert.ok(exhaustive.every(({ result }) =>
    result.weakened_digest !== profileDigest(canonical.profile)));
  const canonicalDigestValue = profileDigest(canonical.profile);
  const cases = [
    ["authenticates", "missing-authenticates-relation",
      "evidence-authenticates-target"],
    ["origin", "missing-originates-from-relation",
      "evidence-originates-from-source"],
    ["source-record", "missing-source-of-record-relation",
      "target-has-source-of-record"],
    ["observed", "missing-observed-in-relation",
      "evidence-observed-in-attempt"]
  ];
  for (const [label, fixtureId, behaviorPatternId] of cases) {
    const fixture = rejectionFixtures[fixtureId]();
    const verificationClaimId = `claim-verify-${behaviorPatternId}`;
    const verificationClaim = fixture.contract.claims.find(
      ({ claim_id: id }) => id === verificationClaimId
    );
    const verificationPropositionIds = new Set([
      verificationClaim?.proposition_id,
      verificationClaim?.falsifying_proposition_id
    ].filter(Boolean));
    fixture.contract.claims = fixture.contract.claims.filter(
      ({ claim_id: id }) => id !== verificationClaimId
    );
    fixture.contract.propositions = fixture.contract.propositions.filter(
      ({ proposition_id: id }) => !verificationPropositionIds.has(id)
    );
    const weakened = structuredClone(fixture.profile);
    const verificationPatternId = `verify-${behaviorPatternId}`;
    const relationPatternId = `verification-targets-${behaviorPatternId}`;
    weakened.claim_patterns = weakened.claim_patterns.filter(({ pattern_id: id }) =>
      ![behaviorPatternId, verificationPatternId].includes(id));
    weakened.relation_patterns = weakened.relation_patterns.filter(
      ({ pattern_id: id }) => id !== relationPatternId);
    weakened.falsifier_condition_bindings = weakened.falsifier_condition_bindings.filter(
      ({ relation_pattern_id: id }) => id !== relationPatternId);
    const removed = new Set([behaviorPatternId, verificationPatternId, relationPatternId]);
    weakened.satisfaction_expression.all_of =
      weakened.satisfaction_expression.all_of.filter(({ pattern }) =>
        !removed.has(pattern));
    const weakenedDigest = profileDigest(weakened);
    assert.notEqual(weakenedDigest, canonicalDigestValue, label);
    assert.equal(evaluateStableProofPackFixtureV1({
      profile: weakened, contract: fixture.contract, evaluation_input: fixture.input
    }).satisfaction, "satisfied", label);
    assert.notEqual(evaluateStableProofPackFixtureV1({
      profile: canonical.profile, contract: fixture.contract, evaluation_input: fixture.input
    }).satisfaction, "satisfied", label);
  }
});

test("published exact-binding certification names exactly the executed corpus", async () => {
  const [corpusBytes, certification] = await Promise.all([
    readFile(path.join(certificationDirectory, "exact-binding-corpus.json")),
    readJson(path.join(certificationDirectory, "exact-binding-certification.json"))
  ]);
  const corpus = JSON.parse(corpusBytes);
  assert.equal(certification.corpus.corpus_digest, sha256(corpusBytes));
  assert.equal(certification.corpus.executable_control_count, corpus.controls.length);
  const modulePath = path.resolve(packageRoot, "../..",
    certification.corpus.executable_module);
  assert.equal(certification.corpus.executable_module_digest,
    sha256(await readFile(modulePath)));
  const executed = await runExactBindingCertificationControls({
    certificationDirectory
  });
  assert.deepEqual(executed.failed_control_ids, []);
  assert.deepEqual(executed.passed_control_ids, corpus.controls);
  assert.deepEqual(certification.result.passed_control_ids, executed.passed_control_ids);
});
