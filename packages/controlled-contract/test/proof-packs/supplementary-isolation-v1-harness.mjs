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
import {
  buildStableTestProofPopulation,
  profileDigest as stableProfileDigest
} from "../support/stable-v1-proof-pack-runtime.mjs";
import { migrateControlledAcceptanceContractV02ToV1 } from
  "../../lib/stable-v1-migration.mjs";
import { VOCABULARY_DIGESTS, VOCABULARY_VERSION } from "../../lib/vocabulary-v1.mjs";
import { checkContract } from "../../bin/check-contract.mjs";
import { buildSupplementaryIsolationSources } from "./supplementary-isolation-v1-fixture.mjs";
import { EXCLUSIONS, GUARANTEE } from "./supplementary-isolation-v1-constants.mjs";
import {
  PROFILE_ID,
  buildSupplementaryIsolationDeclaration,
  buildSupplementaryIsolationEvaluationInput,
  buildSupplementaryIsolationProfile
} from "./supplementary-isolation-v1-profile.mjs";

const EXACT_BINDING_SOURCES = Object.freeze({
  "attempt-record": { kind: "artifact_file", relative_path: "attempt-record.json" },
  "core-settlement-record": {
    kind: "artifact_file", relative_path: "core-settlement-record.json"
  },
  "final-result-record": { kind: "artifact_file", relative_path: "final-result-record.json" },
  "supplementary-failure-record": {
    kind: "artifact_file", relative_path: "supplementary-failure-record.json"
  },
  "supplementary-isolation-projection": {
    kind: "artifact_file", relative_path: "supplementary-isolation-projection.json"
  }
});

function buildTestPack(profile, declaration) {
  const profileDigest = stableProfileDigest(profile);
  const admission = {
    schema_version: "controlled-contract-admitted-proof-pack.v2",
    profile_id: profile.profile_id,
    profile_version: profile.profile_version,
    profile_digest: profileDigest,
    guarantee: GUARANTEE,
    guarantee_digest: sha256(Buffer.from(GUARANTEE, "utf8")),
    explicit_exclusions: [...EXCLUSIONS],
    certification: {
      adequacy_declaration_digest: "a".repeat(64), adequacy_result_digest: "b".repeat(64)
    }
  };
  return Object.freeze({
    profile, declaration, admission, profile_digest: profileDigest,
    admission_digest: canonicalDigest(admission),
    exact_binding_declaration_digest: exactCanonicalDigest(declaration),
    exact_binding_certification_digest: "c".repeat(64), admission_version: 2
  });
}

async function createSupplementaryIsolationSubject({
  fixtureOptions = {}, source = null,
  mutateContract = (value) => value,
  mutateEvaluationInput = (value) => value,
  mutateProfile = (value) => value,
  mutateDeclaration = (value) => value,
  projectionBytes = null,
  sourceFiles = null
} = {}) {
  const captured = source ?? buildSupplementaryIsolationSources(fixtureOptions);
  const effectiveProjectionBytes = projectionBytes ?? captured.projectionBytes;
  const sourceContract = JSON.parse(effectiveProjectionBytes.toString("utf8"));
  const projectedContract = migrateControlledAcceptanceContractV02ToV1({
    contract: sourceContract,
    testProofs: buildStableTestProofPopulation(sourceContract)
  });
  const profile = mutateProfile(buildSupplementaryIsolationProfile());
  const declaration = mutateDeclaration(buildSupplementaryIsolationDeclaration(profile), profile);
  const pack = buildTestPack(profile, declaration);
  const contract = mutateContract(structuredClone(projectedContract), projectedContract);
  const evaluationInput = mutateEvaluationInput(
    buildSupplementaryIsolationEvaluationInput(projectedContract), projectedContract
  );
  const files = sourceFiles ?? {
    "attempt-record.json": captured.sourceBytes[0],
    "core-settlement-record.json": captured.sourceBytes[1],
    "supplementary-failure-record.json": captured.sourceBytes[2],
    "final-result-record.json": captured.sourceBytes[3],
    "supplementary-isolation-projection.json": effectiveProjectionBytes
  };
  const root = await mkdtemp(path.join(os.tmpdir(), "cc-supplementary-isolation-"));
  const contractSource = canonicalJson(contract);
  await Promise.all([
    ...Object.entries(files).map(([name, bytes]) => writeFile(path.join(root, name), bytes)),
    writeFile(path.join(root, "contract.json"), contractSource),
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
    profileId: PROFILE_ID, exactBindingSources: structuredClone(EXACT_BINDING_SOURCES)
  });
  const pinnedRoot = await PinnedCaptureRoot.open(root);
  let exactBindingResult;
  try {
    exactBindingResult = await captureAndEvaluateExactBindingsV1({
      request, declaration, contract, evaluationInput, context, expectedContext: context, pinnedRoot
    });
  } finally {
    await pinnedRoot.close();
  }
  const structuralResult = await checkContract(path.join(root, "contract.json"));
  const project = (overrides = {}) => projectContractAssessment({
    mode: "exact_bound_profile", contract, structuralResult,
    structuralInputSource: contractSource, evaluationInput, proofPack: pack,
    exactBindingResult, exactBindingSources: EXACT_BINDING_SOURCES, ...overrides
  });
  return {
    captured, context, contract, declaration, evaluationInput, exactBindingResult, pack,
    profile, projectedContract, project, root, structuralResult,
    cleanup: () => rm(root, { recursive: true, force: true })
  };
}

export { EXACT_BINDING_SOURCES, createSupplementaryIsolationSubject };
