

import {
  WORKSPACE_AGENT_DISPATCH_RUN_WAIT_SCHEMA_VERSION,
  BACKEND_REFUSAL_CODES
} from "@agent-chassis/agent-launch-core";

import { statusRefusal } from "./workspace-agent-dispatch-refusal.mjs";
import { findRunRecord } from "./workspace-agent-dispatch-run-lifecycle-state.mjs";
import { settleAndProjectRunStatus } from "./workspace-agent-dispatch-run-lifecycle-settlement.mjs";

export function createMonitor(deps = {}) {
  const {
    runs,
    clock,
    sleep,
    monotonicNow,
    captureSliceReviewTerminalResult = null
  } = deps;

  async function getRunStatus(input = {}) {
    const {
      caller_session_id = null,
      monitor_handle = null,
      run_id = null,
      subject = null
    } = input;

    const record = findRunRecord(runs, { run_id, monitor_handle });
    if (!record) {
      return statusRefusal(
        BACKEND_REFUSAL_CODES.MONITOR_HANDLE_UNKNOWN,
        "unknown_run_or_handle",
        null
      );
    }
    if (caller_session_id && record.caller_session_id !== caller_session_id) {
      return statusRefusal(
        BACKEND_REFUSAL_CODES.MONITOR_HANDLE_CALLER_MISMATCH,
        "caller_session_id_mismatch",
        null
      );
    }
    if (subject !== null && subject !== undefined && record.subject !== subject) {
      return statusRefusal(
        BACKEND_REFUSAL_CODES.MONITOR_HANDLE_SUBJECT_MISMATCH,
        "subject_mismatch",
        null
      );
    }

    return settleAndProjectRunStatus(record, { clock, captureSliceReviewTerminalResult });
  }

  async function waitForRunStatus(input = {}) {
    const {
      caller_session_id = null,
      monitor_handle = null,
      subject = null,
      timeout_ms = 60000,
      poll_interval_ms = 5000
    } = input;

    const deadline = monotonicNow() + timeout_ms;

    for (;;) {
      const status = await getRunStatus({
        caller_session_id,
        monitor_handle,
        run_id: null,
        subject
      });

      if (!status || status.accepted !== true) {
        return status;
      }

      if (status.terminal) {
        return {
          schema_version: WORKSPACE_AGENT_DISPATCH_RUN_WAIT_SCHEMA_VERSION,
          accepted: true,
          timed_out: false,
          run_id: status.run_id,
          monitor_handle: status.monitor_handle,
          app: status.app,
          role: status.role,
          subject: status.subject,
          workspace_alias: status.workspace_alias,
          caller_session_id: status.caller_session_id,
          status: status.status,
          terminal: true,
          started_at: status.started_at,
          updated_at: status.updated_at,
          exit: status.exit ?? null,
          final_result: status.final_result ?? null,

          ...(status.review_result ? { review_result: status.review_result } : {})
        };
      }

      const remaining = deadline - monotonicNow();
      if (remaining <= 0) {
        return {
          schema_version: WORKSPACE_AGENT_DISPATCH_RUN_WAIT_SCHEMA_VERSION,
          accepted: true,
          timed_out: true,
          run_id: status.run_id,
          monitor_handle: status.monitor_handle,
          app: status.app,
          role: status.role,
          subject: status.subject,
          workspace_alias: status.workspace_alias,
          caller_session_id: status.caller_session_id,
          status: status.status,
          terminal: false,
          started_at: status.started_at,
          updated_at: status.updated_at,
          exit: null
        };
      }

      await sleep(Math.min(poll_interval_ms, remaining));
    }
  }

  return { getRunStatus, waitForRunStatus };
}
