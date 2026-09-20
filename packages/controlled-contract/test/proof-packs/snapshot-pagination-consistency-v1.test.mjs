import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { evaluateStableProofPackFixtureV1 } from
  "../support/stable-v1-proof-pack-runtime.mjs";
import { runProofPackAdequacy } from "../support/proof-pack-adequacy.mjs";
import {
  buildSnapshotPaginationFixture
} from "./mutation-pagination-profiles-v1-fixture.mjs";

const packageRoot = path.resolve(new URL("../../", import.meta.url).pathname);
const certificationDirectory = path.join(packageRoot,
  "test/certification/profiles/proof.pagination.snapshot-consistency/3.0.0");
const runtimeDirectory = path.join(packageRoot,
  "profiles/proof.pagination.snapshot-consistency/3.0.0");

async function json(directory, name) {
  return JSON.parse(await readFile(path.join(directory, name), "utf8"));
}

test("snapshot pagination profile requires exact snapshot resolution", async () => {
  const profile = await json(certificationDirectory, "profile.json");
  const fixture = buildSnapshotPaginationFixture({ profile });
  assert.equal(evaluateStableProofPackFixtureV1({
    contract: fixture.contract, profile, evaluation_input: fixture.input
  }).satisfaction, "satisfied");
  for (const patternId of [
    "each-attempt-resolves-selected-snapshot",
    "each-returned-page-resolves-selected-snapshot"
  ]) assert.equal(profile.claim_patterns.find(
    ({ pattern_id: id }) => id === patternId
  ).proposition_template.operator, "reference:resolves_to");
});


test("snapshot pack passes its executable adequacy and published admission", async () => {
  const result = await runProofPackAdequacy(certificationDirectory, {
    variationMode: "full_census"
  });
  assert.equal(result.passed, true);
  assert.equal(result.control_count, 26);
  assert.equal(result.negative_fixture_count, 126);
  assert.equal(result.coverage_witness_count, 126);
  const admission = await json(runtimeDirectory, "admission.json");
  assert.ok(admission.explicit_exclusions.includes("standalone-traversal-completeness"));
});
