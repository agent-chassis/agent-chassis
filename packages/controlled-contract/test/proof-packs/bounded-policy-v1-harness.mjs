import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  canonicalDigest,
  canonicalJson,
  projectContractAssessment
} from "../../lib/contract-assessment.mjs";
import {
  canonicalDigest as exactCanonicalDigest,
  canonicalJsonBytes,
  sha256
} from "../../lib/exact-binding-common.mjs";
import {
  PinnedCaptureRoot,
  captureAndEvaluateExactBindingsV1
} from "../../lib/exact-binding-capture.mjs";
import { snapshotExactBindingAssessmentRequest } from "../../lib/exact-binding-plain-data.mjs";
import { profileDigest as stableProfileDigest } from "../support/stable-v1-proof-pack-runtime.mjs";
import { VOCABULARY_DIGESTS, VOCABULARY_VERSION } from "../../lib/vocabulary-v1.mjs";
import { checkContract } from "../../bin/check-contract.mjs";
import { buildBoundaryFixture, buildGuidanceFixture } from "./bounded-policy-v1-fixture.mjs";
import {
  BOUNDARY_PROFILE_ID,
  GUIDANCE_PROFILE_ID,
  buildDeclaration,
  buildProfile
} from "./bounded-policy-v1-profile.mjs";
import { EXCLUSIONS, GUARANTEES } from "./bounded-policy-v1-constants.mjs";

const SOURCE_MAPS = Object.freeze({
  boundary: Object.freeze({
    "boundary-observations": { kind: "artifact_file", relative_path: "boundary-observations.json" },
    "boundary-report": { kind: "artifact_file", relative_path: "boundary-report.json" },
    "declared-policy": { kind: "artifact_file", relative_path: "declared-policy.json" },
    "measured-subjects": { kind: "artifact_file", relative_path: "measured-subjects.json" }
  }),
  guidance: Object.freeze({
    "declared-policy": { kind: "artifact_file", relative_path: "declared-policy.json" },
    "guidance-artifact": { kind: "artifact_file", relative_path: "guidance.txt" },
    "propagation-report": { kind: "artifact_file", relative_path: "propagation-report.json" }
  })
});

function buildTestPack(kind, profile, declaration) {
  const profileDigest = stableProfileDigest(profile);
  const profileId = kind === "boundary" ? BOUNDARY_PROFILE_ID : GUIDANCE_PROFILE_ID;
  const admission = {
    schema_version: "controlled-contract-admitted-proof-pack.v2",
    profile_id: profileId,
    profile_version: "2.0.0",
    profile_digest: profileDigest,
    guarantee: GUARANTEES[kind],
    guarantee_digest: sha256(Buffer.from(GUARANTEES[kind], "utf8")),
    explicit_exclusions: EXCLUSIONS[kind],
    certification: { adequacy_declaration_digest: "a".repeat(64), adequacy_result_digest: "b".repeat(64) }
  };
  return Object.freeze({
    profile, declaration, admission, profile_digest: profileDigest,
    admission_digest: canonicalDigest(admission),
    exact_binding_declaration_digest: exactCanonicalDigest(declaration),
    exact_binding_certification_digest: "c".repeat(64), admission_version: 2
  });
}

function filesFor(fixture, overrides) {
  if (overrides) return overrides;
  return fixture.kind === "boundary" ? {
    "declared-policy.json": fixture.policyBytes,
    "boundary-observations.json": fixture.observationBytes,
    "measured-subjects.json": fixture.subjectsBytes,
    "boundary-report.json": fixture.reportBytes
  } : {
    "declared-policy.json": fixture.policyBytes,
    "guidance.txt": fixture.guidanceBytes,
    "propagation-report.json": fixture.reportBytes
  };
}

async function createBoundedPolicySubject(kind, {
  fixture = null,
  mutateContract = (value) => value,
  mutateEvaluationInput = (value) => value,
  mutateDeclaration = (value) => value,
  mutateProfile = (value) => value,
  sourceFiles = null
} = {}) {
  const captured = fixture ?? (kind === "boundary" ? buildBoundaryFixture() : buildGuidanceFixture());
  const contract = mutateContract(structuredClone(captured.contract));
  const evaluationInput = mutateEvaluationInput(structuredClone(captured.evaluationInput));
  const profile = mutateProfile(buildProfile(kind));
  const declaration = mutateDeclaration(buildDeclaration(kind, profile), profile);
  const pack = buildTestPack(kind, profile, declaration);
  const profileId = kind === "boundary" ? BOUNDARY_PROFILE_ID : GUIDANCE_PROFILE_ID;
  const root = await mkdtemp(path.join(os.tmpdir(), `cc-policy-${kind}-`));
  await Promise.all([
    ...Object.entries(filesFor(captured, sourceFiles)).map(([name, bytes]) =>
      writeFile(path.join(root, name), bytes)),
    writeFile(path.join(root, "contract.json"), canonicalJson(contract)),
    writeFile(path.join(root, "evaluation-input.json"),
      canonicalJsonBytes(evaluationInput, { file: true }))
  ]);
  const context = {
    contract_digest: exactCanonicalDigest(contract),
    profile_digest: pack.profile_digest,
    evaluation_input_digest: exactCanonicalDigest(evaluationInput),
    vocabulary_version: VOCABULARY_VERSION,
    vocabulary_complete_digest: VOCABULARY_DIGESTS.complete,
    admission_digest: pack.admission_digest,
    exact_binding_declaration_digest: pack.exact_binding_declaration_digest,
    exact_binding_certification_digest: pack.exact_binding_certification_digest
  };
  const request = snapshotExactBindingAssessmentRequest({
    contractPath: "contract.json", evaluationInputPath: "evaluation-input.json",
    profileId, exactBindingSources: structuredClone(SOURCE_MAPS[kind])
  });
  const pinnedRoot = await PinnedCaptureRoot.open(root);
  let exactBindingResult;
  try {
    exactBindingResult = await captureAndEvaluateExactBindingsV1({
      request, declaration, contract, evaluationInput, context,
      expectedContext: context, pinnedRoot
    });
  } finally {
    await pinnedRoot.close();
  }
  const structuralResult = await checkContract(path.join(root, "contract.json"));
  const structuralInputSource = canonicalJson(contract);
  const project = (overrides = {}) => projectContractAssessment({
    mode: "exact_bound_profile", contract, structuralResult, structuralInputSource,
    evaluationInput, proofPack: pack, exactBindingResult,
    exactBindingSources: SOURCE_MAPS[kind], ...overrides
  });
  return {
    captured, context, contract, declaration, evaluationInput, exactBindingResult,
    pack, profile, project, root, structuralResult,
    cleanup: () => rm(root, { recursive: true, force: true })
  };
}

export { SOURCE_MAPS, createBoundedPolicySubject };
