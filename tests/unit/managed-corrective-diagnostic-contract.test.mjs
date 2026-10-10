import assert from "node:assert/strict";
import test from "node:test";
import * as root from "@agent-chassis/agent-launch-core";
import * as owner from "../../packages/agent-launch-core/src/lib/managed-corrective-diagnostic-contract.mjs";
import * as compat from "../../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend-managed-identity-diagnostics.mjs";
import { projectManagedIdentityCheckFailure } from "../../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-lifecycle-launch.mjs";

const EXPORTS = [
  "MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES",
  "MANAGED_CORRECTIVE_OBSERVED_STATUS_FIELDS",
  "MANAGED_CORRECTIVE_RECOVERY_FIELDS",
  "MANAGED_CORRECTIVE_RECOVERY_OBSERVED_FIELDS",
  "MANAGED_CORRECTIVE_STATUSES",
  "MANAGED_CORRECTIVE_STATUS_RECOVERY_KIND",
  "MANAGED_CORRECTIVE_STATUS_VALUES"
];
const OBSERVED = { record_id: "WK-2328", slice_id: "SLICE-003",
  parent_status: "todo", slice_status: "todo" };
function recovery(overrides = {}) {
  return { recovery_kind: owner.MANAGED_CORRECTIVE_STATUS_RECOVERY_KIND,
    observed: { parent_status: "todo", slice_status: "todo" }, unit: "WK-2328",
    slice_unit: "WK-2328#SLICE-003", exact_subject: "WK-2328#SLICE-003",
    responsible_actor: "launcher",
    next_action: "get_run_result",
    launcher_retirement_required: true,
    filesystem_cleanup_forbidden: true, preserve_substantive_review: true,
    preserve_review_status: true, replacement_review_required: false,
    notification: "retry the exact managed run status", ...overrides };
}
function carrier(overrides = {}) {
  const detail = {
    cause_code: "agent_launch.canonical_integrated_lifecycle_state.impossible.v1",
    observed_canonical_status: OBSERVED, recovery: recovery(), ...overrides };
  for (const [field, value] of Object.entries(overrides)) {
    if (value === undefined) delete detail[field];
  }
  return { code: owner.MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES
    .INTEGRATED_STATE_UNRESOLVED, detail };
}

test("the shared module owns and exports the exact closed vocabulary", () => {
  assert.deepEqual(Object.keys(owner).sort(), [...EXPORTS].sort());
  assert.deepEqual(owner.MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES, {
    RECEIPTS_CONTRADICTORY: "agent_launch.managed_run.corrective_receipts_contradictory.v1",
    INTEGRATED_STATE_UNRESOLVED: "agent_launch.managed_run.corrective_integrated_state_unresolved.v1",
    REVIEWED_TARGET_MISMATCH: "agent_launch.managed_run.corrective_reviewed_target_mismatch.v1" });
  assert.equal(owner.MANAGED_CORRECTIVE_STATUS_RECOVERY_KIND,
    "agent_launch.managed_run.corrective_status_reconciliation.v1");
  assert.deepEqual(owner.MANAGED_CORRECTIVE_STATUSES,
    { TODO: "todo", ACTIVE: "active", BLOCKED: "blocked", REVIEW: "review", DONE: "done" });
  assert.deepEqual(owner.MANAGED_CORRECTIVE_STATUS_VALUES,
    ["todo", "active", "blocked", "review", "done"]);
  assert.deepEqual(owner.MANAGED_CORRECTIVE_OBSERVED_STATUS_FIELDS,
    ["parent_status", "record_id", "slice_id", "slice_status"]);
  assert.deepEqual(owner.MANAGED_CORRECTIVE_RECOVERY_OBSERVED_FIELDS,
    ["parent_status", "slice_status"]);
  assert.deepEqual(owner.MANAGED_CORRECTIVE_RECOVERY_FIELDS, [
    "exact_subject", "filesystem_cleanup_forbidden", "launcher_retirement_required",
    "next_action", "notification", "observed", "preserve_review_status",
    "preserve_substantive_review", "recovery_kind", "replacement_review_required",
    "responsible_actor", "slice_unit", "unit"]);
  for (const symbol of EXPORTS) {
    assert.equal(root[symbol], owner[symbol]);
    assert.equal(compat[symbol], owner[symbol]);
  }
});

test("closed members are immutable and unsupported statuses fail closed", () => {
  for (const value of [owner.MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES,
    owner.MANAGED_CORRECTIVE_STATUSES, owner.MANAGED_CORRECTIVE_STATUS_VALUES,
    owner.MANAGED_CORRECTIVE_OBSERVED_STATUS_FIELDS,
    owner.MANAGED_CORRECTIVE_RECOVERY_OBSERVED_FIELDS,
    owner.MANAGED_CORRECTIVE_RECOVERY_FIELDS]) assert.equal(Object.isFrozen(value), true);
  assert.throws(() => owner.MANAGED_CORRECTIVE_STATUS_VALUES.push("unknown"), TypeError);
  for (const status of owner.MANAGED_CORRECTIVE_STATUS_VALUES) {
    const result = projectManagedIdentityCheckFailure(carrier({
      observed_canonical_status: { ...OBSERVED, parent_status: status }, recovery: undefined }));
    assert.equal(result.observed_canonical_status.parent_status, status);
  }
  const unsupported = projectManagedIdentityCheckFailure(carrier({
    observed_canonical_status: { ...OBSERVED, parent_status: "unknown" } }));
  assert.equal(Object.hasOwn(unsupported, "observed_canonical_status"), false);
});

test("reconstructed or malformed bounded wire shapes are rejected", () => {
  const results = [
    carrier({ observed_canonical_status: { ...OBSERVED, extra: true } }),
    carrier({ recovery: recovery({ extra: true }) }),
    carrier({ recovery: recovery({ observed: { parent_status: "todo",
      slice_status: "todo", extra: true } }) }),
    carrier({ recovery: recovery({ recovery_kind: "agent_launch.managed_run.reconstructed.v1" }) })
  ].map(projectManagedIdentityCheckFailure);
  assert.equal(Object.hasOwn(results[0], "observed_canonical_status"), false);
  for (const result of results.slice(1)) {
    assert.equal(Object.hasOwn(result, "recovery"), false);
    assert.equal(result.recovery_carrier_status, "malformed");
  }
});

test("the lifecycle owner carries the retirement recovery unchanged and observation-only", () => {

  const projected = projectManagedIdentityCheckFailure(carrier());
  assert.deepEqual(projected.recovery, recovery());
  assert.equal(projected.recovery.recovery_kind, owner.MANAGED_CORRECTIVE_STATUS_RECOVERY_KIND);
  assert.deepEqual(projected.observed_canonical_status, OBSERVED);
  assert.deepEqual([projected.recovery.responsible_actor, projected.recovery.launcher_retirement_required,
    projected.recovery.filesystem_cleanup_forbidden, projected.recovery.preserve_substantive_review,
    projected.recovery.preserve_review_status, projected.recovery.replacement_review_required],
  ["launcher", true, true, true, true, false]);

  for (const override of [{ next_action: "retry_workspace_agent_run_status_same_subject" },
    { next_action: "start_agent" }, { exact_subject: "WK-2328#SLICE-004" }, { responsible_actor: "operator" }]) {
    const refused = projectManagedIdentityCheckFailure(carrier({ recovery: recovery(override) }));
    assert.equal(Object.hasOwn(refused, "recovery"), false, JSON.stringify(override));
    assert.equal(refused.recovery_carrier_status, "malformed");
  }

  const produced = compat.correctiveStatusReconciliationRecovery("WK-2328#SLICE-003", OBSERVED);
  assert.equal(produced.next_action, "get_run_result");
  assert.match(produced.notification, /only observes launcher state and retires nothing/u);
  assert.doesNotMatch(JSON.stringify(produced), /workspace_agent_run_status/u);
  assert.deepEqual(projectManagedIdentityCheckFailure(carrier({ recovery: produced })).recovery, produced);
});
