import assert from "node:assert/strict";
import test from "node:test";

import {
  projectManagedIdentityCheckFailure
} from "../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-lifecycle-launch.mjs";

const CODE = "agent_launch.managed_run.corrective_integrated_state_unresolved.v1";
const CAUSE_CODE = "agent_launch.canonical_integrated_lifecycle_state.impossible.v1";

function trustedError(overrides = {}) {
  return {
    code: CODE,
    message: "raw producer message /secret/path / credential",
    detail: {
      cause_code: CAUSE_CODE,
      observed_canonical_status: {
        record_id: "WK-1712",
        slice_id: "SLICE-001",
        parent_status: "todo",
        slice_status: "todo"
      },
      recovery: {
        recovery_kind: "agent_launch.managed_run.corrective_status_reconciliation.v1",
        observed: { parent_status: "todo", slice_status: "todo" },
        expected: { parent_status: "active", slice_status: "todo" },
        unit: "WK-1712",
        slice_unit: "WK-1712#SLICE-001",
        responsible_actor: "coordinator",
        next_action: "reissue_subject_dispatch_after_canonical_status_reconciliation"
      },
      ...overrides
    },
    cause: { message: "raw cause /secret/path", stack: "raw stack" }
  };
}

test("the trusted corrective chain is projected from bounded scalar copies", () => {
  const carrier = trustedError();
  const projected = projectManagedIdentityCheckFailure(carrier);
  const source = carrier.detail;
  const sourceObserved = source.observed_canonical_status;
  const sourceRecovery = source.recovery;

  assert.equal(projected.message, "managed identity check failed");
  assert.equal(projected.code, carrier.code);
  assert.equal(projected.cause_code, source.cause_code);
  for (const field of ["record_id", "slice_id", "parent_status", "slice_status"]) {
    assert.equal(projected.observed_canonical_status[field], sourceObserved[field]);
  }
  for (const field of [
    "recovery_kind", "unit", "slice_unit", "responsible_actor", "next_action"
  ]) {
    assert.equal(projected.recovery[field], sourceRecovery[field]);
  }
  for (const tuple of ["observed", "expected"]) {
    for (const field of ["parent_status", "slice_status"]) {
      assert.equal(projected.recovery[tuple][field], sourceRecovery[tuple][field]);
    }
  }
  assert.equal(JSON.stringify(projected).includes("secret"), false);

  assert.notEqual(projected.observed_canonical_status, sourceObserved);
  assert.notEqual(projected.recovery, sourceRecovery);
  assert.notEqual(projected.recovery.observed, sourceRecovery.observed);
  assert.notEqual(projected.recovery.expected, sourceRecovery.expected);
});

test("a supported mixed-cause aggregate preserves only its stable mismatch code", () => {
  const projected = projectManagedIdentityCheckFailure({
    code: "agent_launch.managed_run.corrective_reviewed_target_mismatch.v1",
    detail: {
      subject: "WK-1712#SLICE-001",
      candidate_group_count: 2,
      receipt_count: 4,
      rejected_group_codes: ["foreign.cause", CAUSE_CODE],
      rejected_groups_omitted: 0
    }
  });

  assert.deepEqual(projected, {
    message: "managed identity check failed",
    code: "agent_launch.managed_run.corrective_reviewed_target_mismatch.v1"
  });
  assert.equal(Object.hasOwn(projected, "observed_canonical_status"), false);
  assert.equal(Object.hasOwn(projected, "recovery"), false);
});

test("an actionable carrier without a valid recovery route is generic", () => {
  const carrier = trustedError();
  delete carrier.detail.recovery;
  assert.deepEqual(projectManagedIdentityCheckFailure(carrier), {
    message: "managed identity check failed"
  });
});

test("a nonactionable carrier may retain bounded status facts without recovery", () => {
  const carrier = trustedError({
    observed_canonical_status: {
      record_id: "WK-1712",
      slice_id: "SLICE-001",
      parent_status: "active",
      slice_status: "blocked"
    }
  });
  delete carrier.detail.recovery;
  const projected = projectManagedIdentityCheckFailure(carrier);
  assert.equal(projected.code, carrier.code);
  assert.equal(projected.cause_code, carrier.detail.cause_code);
  assert.deepEqual(projected.observed_canonical_status, carrier.detail.observed_canonical_status);
  assert.equal(Object.hasOwn(projected, "recovery"), false);
});

test("foreign or malformed carriers retain the generic refusal", () => {
  for (const error of [
    { code: "foreign.code", detail: { cause_code: CAUSE_CODE } },
    trustedError({ cause_code: "foreign.cause" }),
    trustedError({ observed_canonical_status: { record_id: "WK-1712", slice_id: "SLICE-001", parent_status: "todo" } }),
    trustedError({ recovery: { recovery_kind: "foreign" } }),
    trustedError({ observed_canonical_status: { record_id: "WK-1712", slice_id: "SLICE-001", parent_status: "todo", slice_status: "todo", secret: "do not copy" } })
  ]) {
    const projected = projectManagedIdentityCheckFailure(error);
    assert.deepEqual(projected, { message: "managed identity check failed" });
  }
});
