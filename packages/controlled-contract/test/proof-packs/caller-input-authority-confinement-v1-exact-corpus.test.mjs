import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTROL_IDS,
  runExactBindingCertificationControls
} from "./caller-input-authority-confinement-v1-exact-corpus.mjs";

test("caller-input exact-binding corpus rejects every substitution and weakening", async () => {
  const result = await runExactBindingCertificationControls();
  assert.deepEqual(result.failed_control_ids, []);
  assert.deepEqual(result.passed_control_ids, CONTROL_IDS);
});
