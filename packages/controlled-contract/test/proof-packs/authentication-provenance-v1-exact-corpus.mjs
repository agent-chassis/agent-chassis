import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { canonicalDigest, canonicalJsonBytes } from "../../lib/exact-binding-common.mjs";
import { PinnedCaptureRoot, captureAndEvaluateExactBindingsV1 } from
  "../../lib/exact-binding-capture.mjs";
import { snapshotExactBindingAssessmentRequest } from
  "../../lib/exact-binding-plain-data.mjs";
import { VOCABULARY_DIGESTS } from "../../vocabulary/controlled-contract-vocabulary.v1.mjs";
import { buildAuthenticationProvenanceSources } from
  "./authentication-provenance-v1-fixture.mjs";

const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));

async function subjectAt(certificationDirectory, root) {
  const [declaration, contract, evaluationInput, sources] = await Promise.all([
    readJson(path.join(certificationDirectory, "exact-binding.json")),
    readJson(path.join(root, "contract.json")),
    readJson(path.join(root, "evaluation-input.json")),
    readJson(path.join(root, "sources.json"))
  ]);
  return { declaration, contract, evaluationInput, sources };
}

function contextFor(subject) {
  return {
    contract_digest: canonicalDigest(subject.contract),
    profile_digest: subject.declaration.profile_digest,
    evaluation_input_digest: canonicalDigest(subject.evaluationInput),
    vocabulary_version: "controlled-contract-vocabulary.v1",
    vocabulary_complete_digest: VOCABULARY_DIGESTS.complete,
    admission_digest: "1".repeat(64),
    exact_binding_declaration_digest: "2".repeat(64),
    exact_binding_certification_digest: "3".repeat(64)
  };
}

async function evaluate(root, subject, context = contextFor(subject),
  expectedContext = context) {
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

async function runExactBindingCertificationControls({ certificationDirectory }) {
  const root = path.join(certificationDirectory, "exact-capture/positive");
  const canonical = await subjectAt(certificationDirectory, root);
  const passed = [];
  const failed = [];
  const record = (id, condition) => (condition ? passed : failed).push(id);
  record("positive-direct-source-occurrence",
    (await evaluate(root, canonical)).satisfaction === "satisfied");

  for (const requirementId of Object.keys(canonical.sources)) {
    const missing = structuredClone(canonical);
    delete missing.sources[requirementId];
    record(`missing-${requirementId}`,
      (await evaluate(root, missing)).satisfaction !== "satisfied");
    const substituted = structuredClone(canonical);
    const replacement = Object.keys(canonical.sources).find((id) => id !== requirementId);
    substituted.sources[requirementId] = structuredClone(canonical.sources[replacement]);
    record(`substituted-${requirementId}`,
      (await evaluate(root, substituted)).satisfaction !== "satisfied");
  }

  const extra = structuredClone(canonical);
  extra.sources.undeclared = structuredClone(extra.sources["evidence-content"]);
  record("source-set-extra", (await evaluate(root, extra)).satisfaction !== "satisfied");
  const pathReuse = structuredClone(canonical);
  pathReuse.sources["target-resolution-witness"] =
    structuredClone(pathReuse.sources["evidence-content"]);
  record("source-path-reuse",
    (await evaluate(root, pathReuse)).satisfaction !== "satisfied");

  const expectedContext = contextFor(canonical);
  for (const field of Object.keys(expectedContext)) {
    const changed = structuredClone(expectedContext);
    changed[field] = field === "vocabulary_version"
      ? "cv.experimental.substituted" : "f".repeat(64);
    record(`context-${field.replaceAll("_", "-")}-mismatch`,
      (await evaluate(root, canonical, changed, expectedContext)).satisfaction !== "satisfied");
  }

  const roleCases = [
    ["evidence_occurrence", "ref-authenticated-target"],
    ["target", "ref-provenance-source"],
    ["source", "ref-observation-attempt-one"],
    ["observation_attempt", "ref-provenance-source"]
  ];
  for (const [role, replacement] of roleCases) {
    const raw = structuredClone(canonical);
    raw.evaluationInput.reference_bindings.find(({ role: candidate }) => candidate === role)
      .reference_ids = [replacement];
    record(`raw-${role.replaceAll("_", "-")}-substitution`,
      (await evaluate(root, raw)).satisfaction !== "satisfied");

    const alias = structuredClone(raw);
    const original = canonical.evaluationInput.reference_bindings.find(
      ({ role: candidate }) => candidate === role).reference_ids[0];
    alias.contract.propositions.push({
      proposition_id: `prop-certification-alias-${role.replaceAll("_", "-")}`,
      subject_reference_id: original,
      operator: "reference:equals",
      applicability_context: {
        mode: "during", operand_reference_ids: ["ref-observation-attempt-one"]
      },
      operands: [{ kind: "reference", reference_id: replacement }]
    });
    alias.contract.claims.push({
      claim_id: `claim-certification-alias-${role.replaceAll("_", "-")}`,
      kind: "evidence",
      modality: "MUST",
      proposition_id: `prop-certification-alias-${role.replaceAll("_", "-")}`
    });
    record(`equality-${role.replaceAll("_", "-")}-alias-does-not-bind`,
      (await evaluate(root, alias)).satisfaction !== "satisfied");
  }

  const mutableRoot = await mkdtemp(path.join(os.tmpdir(), "auth-exact-corpus-"));
  try {
    await cp(root, mutableRoot, { recursive: true });
    const spliced = await readJson(path.join(mutableRoot, "occurrence-capture.json"));
    [spliced.roles.target, spliced.roles.source] = [spliced.roles.source, spliced.roles.target];
    await writeFile(path.join(mutableRoot, "occurrence-capture.json"),
      canonicalJsonBytes(spliced, { file: true }));
    record("occurrence-result-splice",
      (await evaluate(mutableRoot, await subjectAt(certificationDirectory, mutableRoot)))
        .satisfaction !== "satisfied");
  } finally {
    await rm(mutableRoot, { recursive: true, force: true });
  }

  const alternateRoot = await mkdtemp(path.join(os.tmpdir(), "auth-exact-corpus-"));
  try {
    await cp(root, alternateRoot, { recursive: true });
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
    await Promise.all(files.map(([name, bytes]) =>
      writeFile(path.join(alternateRoot, name), bytes)));
    record("coordinated-recomputed-source-set",
      (await evaluate(alternateRoot,
        await subjectAt(certificationDirectory, alternateRoot))).satisfaction !== "satisfied");
  } finally {
    await rm(alternateRoot, { recursive: true, force: true });
  }

  return {
    failed_control_ids: failed.sort(),
    passed_control_ids: passed.sort()
  };
}

export { runExactBindingCertificationControls };
