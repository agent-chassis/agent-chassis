import test from "node:test";
import assert from "node:assert/strict";

import {
  RUNTIME_BLOCKER_CODES,
  RUNTIME_BLOCKER_DISPATCH_FACING_CATEGORIES,
  getRuntimeBlockerEntry,
  isRuntimeBlockerCode
} from "../../packages/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";

test("taxonomy does not grant local status or parent-review authority", () => {
  const removedCodes = [
    "managed_corrective_status_reconciliation_required",
    "managed_parent_wk_review_blocks_worker_dispatch"
  ];

  for (const code of removedCodes) {
    assert.equal(RUNTIME_BLOCKER_CODES[code.toUpperCase()], undefined);
    assert.equal(isRuntimeBlockerCode(code), false);
    assert.equal(getRuntimeBlockerEntry(code), null);
  }

  const unrelatedEntry = getRuntimeBlockerEntry("read_only_mount");
  assert.ok(unrelatedEntry);
  assert.equal(unrelatedEntry.category, "filesystem");
  assert.equal(unrelatedEntry.actor_recovery, "operator");
  assert.equal(RUNTIME_BLOCKER_DISPATCH_FACING_CATEGORIES.includes(unrelatedEntry.category), true);
  assert.match(unrelatedEntry.detail, /filesystem fact/);
  assert.match(unrelatedEntry.consumer_notes, /MUST NOT be reinterpreted as role_policy_violation/);
});
