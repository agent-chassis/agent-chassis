import assert from "node:assert/strict";
import test from "node:test";
import * as root from "@agent-chassis/agent-launch-core";
import * as owner from "../../packages/agent-launch-core/src/lib/managed-corrective-diagnostic-contract.mjs";
import * as compat from "../../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend-managed-identity-diagnostics.mjs";
import { projectManagedIdentityCheckFailure } from "../../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-lifecycle-launch.mjs";
import { projectManagedCorrectiveStatusRecovery } from "../../packages/wiki-mcp/src/lib/dispatch-tools/dispatch-admission-policy.mjs";

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
    next_action: "retry_workspace_agent_run_status_same_monitor_and_subject",
    monitor_handle: "wkmh_wk2328", launcher_retirement_required: true,
    filesystem_cleanup_forbidden: true, preserve_substantive_review: true,
    preserve_review_status: true, replacement_review_required: false,
    notification: "retry the exact managed run status", ...overrides };
}
function carrier(overrides = {}) {
  return { code: owner.MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES
    .INTEGRATED_STATE_UNRESOLVED, detail: {
    cause_code: "agent_launch.canonical_integrated_lifecycle_state.impossible.v1",
    observed_canonical_status: OBSERVED, recovery: recovery(), ...overrides } };
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
    "monitor_handle", "next_action", "notification", "observed", "preserve_review_status",
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

test("MCP admission consumes the owner vocabulary without changing values", () => {
  const projected = projectManagedIdentityCheckFailure(carrier());
  const admission = projectManagedCorrectiveStatusRecovery({
    reason: "managed_run_identity_check_threw", detail: projected }, "WK-2328#SLICE-003");
  assert.equal(admission.detail.recovery_kind, owner.MANAGED_CORRECTIVE_STATUS_RECOVERY_KIND);
  assert.equal(projectManagedCorrectiveStatusRecovery({ reason: "managed_run_identity_check_threw",
    detail: { ...projected, code: "agent_launch.managed_run.reconstructed.v1" } },
  "WK-2328#SLICE-003"), null);
});
