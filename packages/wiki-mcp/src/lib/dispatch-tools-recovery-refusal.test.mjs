import assert from "node:assert/strict";
import test from "node:test";

import {
  RUNTIME_BLOCKER_CODES
} from "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";

import {
  TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES
} from "../../../agent-launch-cli/src/lib/host-write-authority-substrate/terminal-review-materialization.mjs";
import {
  createDispatchToolRegistry,
  parseStructuredTextResponse
} from "./dispatch-tools-test-helpers.mjs";

function createRecoveryRefusalTools({ recoverIntegratedWorkerRun }) {
  const unknownHandle = {
    accepted: false,
    refusal: { code: "monitor_handle_unknown", reason: "unknown_run_or_handle", detail: null }
  };
  return createDispatchToolRegistry({
    backend: {
      getRunStatus: async () => unknownHandle,
      waitForRunStatus: async () => unknownHandle,
      recoverIntegratedWorkerRun
    }
  });
}

test("WK-1623#SLICE-007 a recovery that fails the materialize verify reports the cause, not monitor_handle_unknown", async () => {

  const tools = createRecoveryRefusalTools({
    recoverIntegratedWorkerRun: async () => Object.freeze({
      recovery_failure: Object.freeze({
        code: TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.VERIFY_FAILED,
        message: "terminal review materialization: materialized review checkout failed part write_tree_is_frozen_tree",
        detail: { part: "write_tree_is_frozen_tree" }
      })
    })
  });

  for (const tool of ["workspace_agent_run_status", "workspace_agent_run_wait"]) {
    const refused = parseStructuredTextResponse(await tools.get(tool).handler({
      monitor_handle: "wkmh_worker_latched",
      subject: "WK-1537#SLICE-001"
    }));
    assert.equal(refused.accepted, false, tool);
    assert.equal(refused.blocker.code, RUNTIME_BLOCKER_CODES.OPERATOR_RECOVERY_NEEDED, tool);
    assert.equal(refused.blocker.reason, "post_worker_lifecycle_recovery_failed", tool);
    assert.equal(
      refused.blocker.detail.recovery_failure.code,
      TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.VERIFY_FAILED,
      tool
    );
    assert.match(refused.blocker.detail.recovery_failure.message, /write_tree_is_frozen_tree/u);

    assert.equal(refused.blocker.detail.backend_refusal.code, "monitor_handle_unknown", tool);
  }
});

test("WK-1623#SLICE-007 a recovery with nothing to recover still reports the original backend refusal", async () => {

  const tools = createRecoveryRefusalTools({ recoverIntegratedWorkerRun: async () => null });
  const refused = parseStructuredTextResponse(await tools.get("workspace_agent_run_status").handler({
    monitor_handle: "wkmh_worker_absent",
    subject: "WK-1537#SLICE-001"
  }));
  assert.equal(refused.accepted, false);
  assert.equal(refused.blocker.code, RUNTIME_BLOCKER_CODES.MONITOR_HANDLE_UNKNOWN);
  assert.equal(refused.blocker.reason, "unknown_run_or_handle");
});
