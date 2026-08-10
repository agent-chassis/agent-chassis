import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runProofPackAdequacy } from "../support/proof-pack-adequacy.mjs";

const packDirectory = fileURLToPath(new URL(
  "../certification/profiles/proof.idempotency.effect-nonduplication/2.0.0/",
  import.meta.url
));

test("idempotency v2 proof pack has complete discriminating coverage", async () => {
  const result = await runProofPackAdequacy(packDirectory);
  assert.equal(result.passed, true, JSON.stringify(result.diagnostics));
  assert.equal(result.negative_fixture_count, 46);
  assert.equal(result.coverage_witness_count, 131);
  assert.deepEqual(result.diagnostics, []);
});
