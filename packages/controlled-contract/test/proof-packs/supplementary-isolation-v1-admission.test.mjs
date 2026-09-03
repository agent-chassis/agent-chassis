import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { assertCanonicalCertificationFile } from "../../lib/exact-binding-admission.mjs";
import { assertCanonicalDeclarationFile } from "../../lib/exact-binding.mjs";
import { canonicalJsonBytes } from "../../lib/exact-binding-common.mjs";
import { buildSupplementaryIsolationSources } from "./supplementary-isolation-v1-fixture.mjs";
import {
  buildSupplementaryIsolationDeclaration,
  buildSupplementaryIsolationEvaluationInput,
  buildSupplementaryIsolationProfile
} from "./supplementary-isolation-v1-profile.mjs";
import { CONTROL_IDS, runExactBindingCertificationControls } from
  "./supplementary-isolation-v1-exact-corpus.mjs";

const directory = path.resolve(import.meta.dirname,
  "../certification/profiles/proof.failure.supplementary-isolation/2.0.0");

test("frozen supplementary-isolation carriers equal their builders", async () => {
  const [profileBytes, declarationBytes, templateBytes] = await Promise.all([
    readFile(path.join(directory, "profile.json")),
    readFile(path.join(directory, "exact-binding.json")),
    readFile(path.join(directory, "evaluation-input.template.json"))
  ]);
  const profile = buildSupplementaryIsolationProfile();
  const declaration = buildSupplementaryIsolationDeclaration(profile);
  const capture = buildSupplementaryIsolationSources({ branch: "omitted" });
  const template = buildSupplementaryIsolationEvaluationInput(JSON.parse(capture.projectionBytes));
  assert.deepEqual(JSON.parse(profileBytes), profile);
  assert.deepEqual(declarationBytes, canonicalJsonBytes(declaration, { file: true }));
  assert.deepEqual(JSON.parse(templateBytes), template);
  assertCanonicalDeclarationFile(declarationBytes);
});

test("frozen exact certification reruns all splice controls", async () => {
  const certification = assertCanonicalCertificationFile(await readFile(
    path.join(directory, "exact-binding-certification.json")
  ));
  const result = await runExactBindingCertificationControls();
  assert.deepEqual(result.failed_control_ids, []);
  assert.deepEqual(result.passed_control_ids, CONTROL_IDS);
  assert.deepEqual(certification.result.passed_control_ids, CONTROL_IDS);
});
