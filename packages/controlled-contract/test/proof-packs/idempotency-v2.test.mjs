import assert from "node:assert/strict";
import test from "node:test";

import { runProofPackAdequacy } from "../support/proof-pack-adequacy.mjs";
import { certificationDirectory, readDefinitionDocument } from "../support/certification-artifact.mjs";

const packDirectory = certificationDirectory({
  profile_id: "proof.idempotency.effect-nonduplication", profile_version: "5.0.0"
});

test("idempotency v2 proof pack has complete discriminating coverage", async () => {
  const result = await runProofPackAdequacy(packDirectory, {
    variationMode: "full_census"
  });
  assert.equal(result.passed, true, JSON.stringify(result.diagnostics));
  assert.equal(result.negative_fixture_count, 46);
  assert.equal(result.coverage_witness_count, 129);
  assert.deepEqual(result.diagnostics, []);
});
