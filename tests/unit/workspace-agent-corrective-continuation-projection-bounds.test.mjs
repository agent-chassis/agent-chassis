import assert from "node:assert/strict";
import test from "node:test";

import {
  projectManagedIdentityCheckFailure
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-lifecycle-launch.mjs";

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
        unit: "WK-1712",
        slice_unit: "WK-1712#SLICE-001",
        exact_subject: "WK-1712#SLICE-001",
        responsible_actor: "launcher",
        next_action: "retry_workspace_agent_run_status_same_subject",
        launcher_retirement_required: true,
        filesystem_cleanup_forbidden: true,
        preserve_substantive_review: true,
        preserve_review_status: true,
        replacement_review_required: false,
        notification:
          "launcher retirement is required; filesystem cleanup is forbidden; preserve the substantive review and review status; retry workspace_agent_run_status with the exact subject"
      },
      ...overrides
    },
    cause: { message: "raw cause /secret/path", stack: "raw stack" }
  };
}

test("the trusted corrective chain preserves the complete diagnostic and separate recovery", () => {
  const carrier = trustedError();
  const projected = projectManagedIdentityCheckFailure(carrier);
  const source = carrier.detail;
  const sourceObserved = source.observed_canonical_status;
  const sourceRecovery = source.recovery;

  assert.deepEqual(projected.diagnostic, carrier);
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
  for (const tuple of ["observed"]) {
    for (const field of ["parent_status", "slice_status"]) {
      assert.equal(projected.recovery[tuple][field], sourceRecovery[tuple][field]);
    }
  }
  assert.equal(JSON.stringify(projected).includes("secret"), true);

  assert.notEqual(projected.observed_canonical_status, sourceObserved);
  assert.notEqual(projected.recovery, sourceRecovery);
  assert.notEqual(projected.recovery.observed, sourceRecovery.observed);
});

test("a supported mixed-cause aggregate preserves its complete diagnostic", () => {
  const error = {
    code: "agent_launch.managed_run.corrective_reviewed_target_mismatch.v1",
    detail: {
      subject: "WK-1712#SLICE-001",
      candidate_group_count: 2,
      receipt_count: 4,
      rejected_group_codes: ["foreign.cause", CAUSE_CODE],
      rejected_groups_omitted: 0
    }
  };
  const projected = projectManagedIdentityCheckFailure(error);

  assert.equal(projected.code,
    "agent_launch.managed_run.corrective_reviewed_target_mismatch.v1");
  assert.deepEqual(projected.diagnostic, error);
  assert.equal(Object.hasOwn(projected, "observed_canonical_status"), false);
  assert.equal(Object.hasOwn(projected, "recovery"), false);
});

test("an actionable carrier without a valid recovery route retains its diagnosis", () => {
  const carrier = trustedError();
  delete carrier.detail.recovery;
  const projected = projectManagedIdentityCheckFailure(carrier);
  assert.deepEqual({ ...projected, diagnostic: undefined }, {
    diagnostic: undefined,
    code: CODE,
    cause_code: CAUSE_CODE,
    observed_canonical_status: carrier.detail.observed_canonical_status,
    recovery_carrier_status: "absent"
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

test("foreign or malformed carriers remain complete diagnostics without gaining authority", () => {
  const errors = [
    { code: "foreign.code", detail: { cause_code: CAUSE_CODE } },
    trustedError({ cause_code: "foreign.cause" }),
    trustedError({ observed_canonical_status: { record_id: "WK-1712", slice_id: "SLICE-001", parent_status: "todo" } }),
    trustedError({ recovery: { recovery_kind: "foreign" } }),
    trustedError({ observed_canonical_status: { record_id: "WK-1712", slice_id: "SLICE-001", parent_status: "todo", slice_status: "todo", secret: "do not copy" } })
  ];
  const results = errors.map(projectManagedIdentityCheckFailure);
  assert.deepEqual(results.map(({ diagnostic }) => diagnostic), errors);
  assert.deepEqual(results.map(({ diagnostic: _diagnostic, ...result }) => result), [
    { originating_code_status: "invalid" }, { code: CODE }, { code: CODE },
    { code: CODE, cause_code: CAUSE_CODE,
      observed_canonical_status: errors[3].detail.observed_canonical_status,
      recovery_carrier_status: "malformed" }, { code: CODE }
  ]);
});

test("non-stable string codes remain diagnostic data but do not become cause authority", () => {
  const hostileCodes = [
    "raw producer prose containing a secret",
    "/var/private/identity-store",
    "",
    `agent_launch.${"x".repeat(128)}.v1`
  ];
  const results = hostileCodes.map((code) => projectManagedIdentityCheckFailure({ code }));
  assert.deepEqual(results.map(({ diagnostic }) => diagnostic.code), hostileCodes);
  assert.deepEqual(results.map(({ originating_code_status: status }) => status),
    hostileCodes.map(() => "invalid"));
});

test("dotted and bare snake_case codes are carried with bounded source evidence", () => {
  const codes = [
    "agent_launch.managed_run.identity_store_read_failed.v1",
    "managed_run_identity_check_threw"
  ];
  const results = codes.map((code) => projectManagedIdentityCheckFailure({
    code,
    detail: { source_code: "EACCES" }
  }));
  assert.deepEqual(results.map(({ diagnostic: _diagnostic, ...result }) => result),
    codes.map((code) => ({ code, source_code: "EACCES" })));
  assert.deepEqual(results.map(({ diagnostic }) => diagnostic.detail.source_code),
    ["EACCES", "EACCES"]);
});

test("carried, unavailable, and invalid originating-code outcomes are distinct", () => {
  const values = [
    { code: "operator_recovery_needed" }, {}, { code: 17 }, { code: "not a stable code" }
  ];
  assert.deepEqual(values.map((value) => {
    const { diagnostic: _diagnostic, ...result } = projectManagedIdentityCheckFailure(value);
    return result;
  }), [
    { code: "operator_recovery_needed" },
    { originating_code_status: "unavailable" },
    { originating_code_status: "unavailable" },
    { originating_code_status: "invalid" }
  ]);
});

test("source_code is carried only when its bounded system-code shape is valid", () => {
  const code = "managed_run_identity_check_threw";
  const results = [
    projectManagedIdentityCheckFailure({ code, detail: { source_code: "EAI_AGAIN" } }),
    projectManagedIdentityCheckFailure({ code, detail: { source_code: "/secret/errno" } }),
    projectManagedIdentityCheckFailure({ code, detail: { source_code: "E".repeat(129) } })
  ];
  assert.deepEqual(results.map(({ diagnostic: _diagnostic, ...result }) => result), [
    { code, source_code: "EAI_AGAIN" }, { code }, { code }
  ]);
  assert.equal(results[1].diagnostic.detail.source_code, "/secret/errno");
  assert.equal(results[2].diagnostic.detail.source_code, "E".repeat(129));
});
