import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  assertCanonicalCertificationFile
} from "../../lib/exact-binding-admission.mjs";
import {
  assertCanonicalDeclarationFile
} from "../../lib/exact-binding.mjs";
import {
  canonicalJsonBytes
} from "../../lib/exact-binding-common.mjs";
import {
  buildSoundNegativeObservationSources
} from "./sound-negative-observation-v1-fixture.mjs";
import {
  buildSoundNegativeObservationDeclaration,
  buildSoundNegativeObservationEvaluationInput,
  buildSoundNegativeObservationProfile
} from "./sound-negative-observation-v1-profile.mjs";
import {
  CONTROL_IDS,
  runExactBindingCertificationControls
} from "./sound-negative-observation-v1-exact-corpus.mjs";

const certificationDirectory = path.resolve(
  import.meta.dirname,
  "../certification/profiles/proof.observation.sound-negative/2.0.0"
);

test("frozen profile, declaration, and template equal the projection-authored builders", async () => {
  const [profileBytes, declarationBytes, templateBytes] = await Promise.all([
    readFile(path.join(certificationDirectory, "profile.json")),
    readFile(path.join(certificationDirectory, "exact-binding.json")),
    readFile(path.join(certificationDirectory, "evaluation-input.template.json"))
  ]);
  const profile = buildSoundNegativeObservationProfile();
  const declaration = buildSoundNegativeObservationDeclaration(profile);
  const empty = buildSoundNegativeObservationSources({
    conclusion: "absent", sourceCount: 0, observationCount: 0,
    domain: "sound-negative-template"
  });
  const template = buildSoundNegativeObservationEvaluationInput(
    JSON.parse(empty.projectionBytes.toString("utf8"))
  );
  assert.deepEqual(JSON.parse(profileBytes), profile);
  assert.deepEqual(declarationBytes, canonicalJsonBytes(declaration, { file: true }));
  assert.deepEqual(JSON.parse(templateBytes), template);
  assertCanonicalDeclarationFile(declarationBytes);
});

test("frozen exact-binding certification reruns all semantic controls", async () => {
  const certification = assertCanonicalCertificationFile(await readFile(
    path.join(certificationDirectory, "exact-binding-certification.json")
  ));
  const result = await runExactBindingCertificationControls({ certificationDirectory });
  assert.deepEqual(result.failed_control_ids, []);
  assert.deepEqual(result.passed_control_ids, CONTROL_IDS);
  assert.equal(certification.corpus.executable_control_count, CONTROL_IDS.length);
  assert.deepEqual(certification.result.passed_control_ids, CONTROL_IDS);
});
