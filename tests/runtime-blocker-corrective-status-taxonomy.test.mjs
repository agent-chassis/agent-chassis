import test from "node:test";
import assert from "node:assert/strict";

import {
  RUNTIME_BLOCKER_CODES,
  RUNTIME_BLOCKER_DISPATCH_FACING_CATEGORIES,
  getRuntimeBlockerEntry,
  isRuntimeBlockerCode
} from "../packages/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";

test("managed corrective status reconciliation has bounded coordinator recovery vocabulary", () => {
  const code = "managed_corrective_status_reconciliation_required";
  const entry = getRuntimeBlockerEntry(code);

  assert.equal(RUNTIME_BLOCKER_CODES.MANAGED_CORRECTIVE_STATUS_RECONCILIATION_REQUIRED, code);
  assert.equal(isRuntimeBlockerCode(code), true);
  assert.ok(entry);
  assert.ok(RUNTIME_BLOCKER_DISPATCH_FACING_CATEGORIES.includes(entry.category));
  assert.equal(entry.category, "work_record_readiness");
  assert.equal(entry.actor_recovery, "coordinator");
  assert.equal(entry.blocking, true);

  assert.match(entry.detail, /observed parent=todo and slice=todo/);
  assert.match(entry.detail, /expected parent=active and slice=todo/);
  assert.match(entry.detail, /no automatic status mutation/);
  assert.equal(entry.recovery.kind, "structured_route");
  assert.equal(entry.recovery.route, "workspace_work_record_set_status");
  assert.deepEqual(entry.recovery.arguments, {
    unit: "<exact-parent-unit>",
    status: "active"
  });
  assert.deepEqual(entry.recovery.next_call, {
    route: "workspace_agent_dispatch",
    arguments: {
      role: "worker",
      subject: "<exact-slice-subject>"
    }
  });
  assert.equal("observed_parent_status" in entry.recovery.arguments, false);
  assert.equal("observed_slice_status" in entry.recovery.arguments, false);
  assert.match(entry.recovery.success_condition, /exact parent unit.*active/);
  assert.match(entry.recovery.success_condition, /exact slice subject.*redispatched/);
});
