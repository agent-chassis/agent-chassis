import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  assertCanonicalCertificationFile
} from "../../lib/exact-binding-admission.mjs";
import { assertCanonicalDeclarationFile } from "../../lib/exact-binding.mjs";
import { canonicalJsonBytes } from "../../lib/exact-binding-common.mjs";
import {
  validateProfileSchemaV1,
  validateProfileSemanticsV1
} from "../support/stable-v1-proof-pack-runtime.mjs";
import { runProofPackAdequacy } from "../support/proof-pack-adequacy.mjs";
import {
  buildCallerInputAuthorityConfinementSources
} from "./caller-input-authority-confinement-v1-fixture.mjs";
import {
  buildCallerInputAuthorityConfinementDeclaration,
  buildCallerInputAuthorityConfinementEvaluationInput,
  buildCallerInputAuthorityConfinementProfile
} from "./caller-input-authority-confinement-v1-profile.mjs";
import {
  CONTROL_IDS,
  runExactBindingCertificationControls
} from "./caller-input-authority-confinement-v1-exact-corpus.mjs";

const certificationDirectory = path.resolve(
  import.meta.dirname,
  "../certification/profiles/proof.input.caller-authority-confinement/2.0.0"
);

test("caller-input profile and exact declaration are one combined five-source projection", () => {
  const profile = buildCallerInputAuthorityConfinementProfile();
  const declaration = buildCallerInputAuthorityConfinementDeclaration(profile);
  assert.equal(validateProfileSchemaV1(profile), true);
  assert.deepEqual(validateProfileSemanticsV1(profile), []);
  assert.equal(declaration.requirements.length, 6);
  assert.equal(declaration.relations.length, 1);
  assert.equal(declaration.relations[0].transformer_id,
    "caller-input-surface-capture.v1");
  assert.deepEqual(declaration.relations[0].source_requirement_ids, [
    "accepted-input-policy", "accepted-request", "forbidden-request",
    "observation-evidence", "observation-capture-proof"
  ]);
  assert.equal(declaration.projected_evaluation_binding.result_requirement_id,
    "caller-input-projection");
  assert.equal(declaration.projected_evaluation_binding.graph_projection_id,
    "caller-input-authority-contract");
  assert.ok(Array.isArray(profile.satisfaction_expression.all_of));
  assert.deepEqual(Object.keys(profile.satisfaction_expression), ["all_of"]);
});

test("frozen profile, declaration, and evaluation template equal their builders", async () => {
  const [profileBytes, declarationBytes, templateBytes] = await Promise.all([
    readFile(path.join(certificationDirectory, "profile.json")),
    readFile(path.join(certificationDirectory, "exact-binding.json")),
    readFile(path.join(certificationDirectory, "evaluation-input.template.json"))
  ]);
  const profile = buildCallerInputAuthorityConfinementProfile();
  const declaration = buildCallerInputAuthorityConfinementDeclaration(profile);
  const captured = buildCallerInputAuthorityConfinementSources();
  const template = buildCallerInputAuthorityConfinementEvaluationInput(captured.projection);
  assert.deepEqual(JSON.parse(profileBytes), profile);
  assert.deepEqual(declarationBytes, canonicalJsonBytes(declaration, { file: true }));
  assert.deepEqual(JSON.parse(templateBytes), template);
  assertCanonicalDeclarationFile(declarationBytes);
});

test("frozen semantic adequacy remains release-clean", async () => {
  const result = await runProofPackAdequacy(certificationDirectory);
  assert.equal(result.passed, true);
  assert.equal(result.control_count, 85);
  assert.deepEqual(result.diagnostics, []);
});

test("frozen exact-binding certification reruns every substitution control", async () => {
  const certification = assertCanonicalCertificationFile(await readFile(
    path.join(certificationDirectory, "exact-binding-certification.json")
  ));
  const result = await runExactBindingCertificationControls({ certificationDirectory });
  assert.deepEqual(result.failed_control_ids, []);
  assert.deepEqual(result.passed_control_ids, CONTROL_IDS);
  assert.equal(certification.corpus.executable_control_count, CONTROL_IDS.length);
  assert.deepEqual(certification.result.passed_control_ids, CONTROL_IDS);
});
