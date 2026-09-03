import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { loadExactBindingAdmissionV1 } from "../../lib/exact-binding-admission.mjs";
import {
  profileDigest,
  validateProfileSchemaV1,
  validateProfileSemanticsV1
} from "../support/stable-v1-proof-pack-runtime.mjs";
import {
  executeCompleteTraversalMutant
} from "./complete-pagination-traversal-v1-harness.mjs";

const packageRoot = path.resolve(new URL("../../", import.meta.url).pathname);
const runtimeDirectory = path.join(packageRoot,
  "profiles/proof.pagination.complete-traversal/2.0.0");
const certificationDirectory = path.join(packageRoot,
  "test/certification/profiles/proof.pagination.complete-traversal/2.0.0");

test("complete traversal profile is independently valid before catalog selection", async () => {
  const profile = JSON.parse(await readFile(path.join(runtimeDirectory, "profile.json")));
  assert.equal(validateProfileSchemaV1(profile), true);
  assert.deepEqual(validateProfileSemanticsV1(profile), []);
  const tuple = await loadExactBindingAdmissionV1(
    runtimeDirectory, "proof.pagination.complete-traversal"
  );
  assert.equal(tuple.profile_digest, profileDigest(profile));
  assert.deepEqual(tuple.declaration.relations.map(({ transformer_id: id }) => id), [
    "authentication-provenance-occurrence-capture.v1",
    "mutation-pagination-trace.v1"
  ]);
});

test("authoritative population cannot be truncated, substituted, or self-declared", () => {
  for (const mutantId of [
    "authenticated-population-omission",
    "authenticated-population-substitution",
    "authentication-capture-substitution"
  ]) assert.equal(executeCompleteTraversalMutant(mutantId).killed, true, mutantId);
});

test("certification authoring tuple is byte-identical to the admitted runtime tuple", async () => {
  for (const name of [
    "profile.json", "evaluation-input.template.json", "exact-binding.json",
    "admission.json", "exact-binding-certification.json"
  ]) assert.ok((await readFile(path.join(runtimeDirectory, name))).equals(
    await readFile(path.join(certificationDirectory, name)
    ), name));
});
