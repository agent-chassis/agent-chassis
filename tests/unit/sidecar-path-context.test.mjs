import assert from "node:assert/strict";
import test from "node:test";

import { runPathContextContract } from
  "../fixtures/sidecar-path-context-proof-driver.mjs";
import { dropObservedTwentyFirstRelatedPath } from
  "../fixtures/sidecar-path-context-proof-faults.mjs";
import { assertPathContextContract } from
  "../fixtures/sidecar-path-context-proof-state.mjs";

test("WK-2535 pure context preserves complete attributed populations", () => {
  const contract = runPathContextContract();
  assertPathContextContract(contract);
  assert.throws(
    () => assertPathContextContract(dropObservedTwentyFirstRelatedPath(contract)),
    assert.AssertionError
  );
});
