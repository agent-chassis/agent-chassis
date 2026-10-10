

import {
  WORKSPACE_AGENT_DISPATCH_RUN_WAIT_SCHEMA_VERSION,
  BACKEND_REFUSAL_CODES
} from "@agent-chassis/agent-launch-core";

import { statusRefusal } from "./workspace-agent-dispatch-refusal.mjs";
import {
  findRunRecord,
  selectVisibleRunRecord
} from "./workspace-agent-dispatch-run-lifecycle-state.mjs";
import { attachAdvisoryReviewTarget } from "./workspace-agent-dispatch-run-lifecycle-settlement.mjs";
import {
  decodeManagedFindingsSourceReference,
  resolveManagedFindingsSourceFromRecord
} from "./workspace-agent-advisory-result-settlement.mjs";
import { settleAndProjectRunRecord } from "./workspace-agent-dispatch-run-settlement.mjs";

export function createMonitor(deps = {}) {
  const {
    runs,
    clock,
    sleep,
    monotonicNow,
    captureSliceReviewTerminalResult = null,
    settleFormalReviewAttestation = null,
    publishManagedRunResult = null,
    projectRunRecord = null
  } = deps;

  async function getRunStatus(input = {}) {
    const {
      caller_session_id = null,
      monitor_handle = null,
      run_id = null,
      attempt_id = null,
      subject = null
    } = input;

    const subjectSelection = monitor_handle === null && run_id === null && typeof subject === "string"
      ? selectVisibleRunRecord(runs, { caller_session_id, subject, attempt_id })
      : null;
    const record = subjectSelection?.selected ?? findRunRecord(runs, { run_id, monitor_handle });
    if (!record) {
      const code = subjectSelection?.code === BACKEND_REFUSAL_CODES.MONITOR_HANDLE_CALLER_MISMATCH
        ? BACKEND_REFUSAL_CODES.MONITOR_HANDLE_CALLER_MISMATCH
        : subjectSelection?.code === "attempt_selection_ambiguous"
          ? BACKEND_REFUSAL_CODES.LAUNCH_REFUSED
          : BACKEND_REFUSAL_CODES.MONITOR_HANDLE_UNKNOWN;
      return statusRefusal(
        code,
        subjectSelection?.code ?? "unknown_run_or_handle",
        subjectSelection?.candidates?.length > 0
          ? { attempts: subjectSelection.candidates }
          : null
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

    if (projectRunRecord !== null) return projectRunRecord(record);

    return settleAndProjectRunRecord(record, {
      clock,
      captureSliceReviewTerminalResult,
      settleFormalReviewAttestation,
      publishManagedRunResult
    });
  }

  async function waitForRunStatus(input = {}) {
    const {
      caller_session_id = null,
      monitor_handle = null,
      subject = null,
      attempt_id = null,
      timeout_ms = 60000,
      poll_interval_ms = 5000
    } = input;

    const deadline = monotonicNow() + timeout_ms;

    for (;;) {
      const status = await getRunStatus({
        caller_session_id,
        monitor_handle,
        run_id: null,
        subject,
        attempt_id
      });

      if (!status || status.accepted !== true) {
        return status;
      }

      if (status.terminal && status.producer_pending !== true) {
        return attachAdvisoryReviewTarget(status, {
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

          ...(status.final_result_durability === undefined
            ? {}
            : {
                final_result_durability: status.final_result_durability,
                ...(status.final_result_publication_failure
                  ? { final_result_publication_failure: status.final_result_publication_failure }
                  : {})
              }),
          ...(status.result_publication === undefined ? {} : { result_publication: status.result_publication }),
          ...(status.producer_pending === undefined ? {} : { producer_pending: status.producer_pending }),
          ...(status.original_result === undefined ? {} : { original_result: status.original_result }),
          ...(status.original_publication === undefined ? {} : { original_publication: status.original_publication }),
          ...(status.completion_failure === undefined ? {} : { completion_failure: status.completion_failure }),
          ...(status.completion_settlement_failure === undefined ? {} : {
            completion_settlement_failure: status.completion_settlement_failure
          }),
          ...(status.session_contract_required === true
            ? {
                session_contract_required: true,
                session_contract: status.session_contract
              }
            : {}),

          ...(status.review_result ? { review_result: status.review_result } : {})
        });
      }

      const remaining = deadline - monotonicNow();
      if (remaining <= 0) {
        if (projectRunRecord !== null) return attachAdvisoryReviewTarget(status, {
          ...status, schema_version: WORKSPACE_AGENT_DISPATCH_RUN_WAIT_SCHEMA_VERSION, timed_out: true
        });
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
          exit: null,
          ...(status.session_contract_required === true
            ? {
                session_contract_required: true,
                session_contract: status.session_contract
              }
            : {})
        };
      }

      await sleep(Math.min(poll_interval_ms, remaining));
    }
  }

  async function resolveRetainedFindingsSource({ reference, caller_session_id, repository } = {}) {
    const decoded = decodeManagedFindingsSourceReference(reference);
    if (decoded === null || decoded.invalid) return Object.freeze({ ok: false, state: "corrupt" });
    const record = findRunRecord(runs, { run_id: decoded.run, monitor_handle: decoded.monitor });
    if (!record) return Object.freeze({ ok: false, state: "unavailable" });
    return resolveManagedFindingsSourceFromRecord(record, reference, {
      callerSessionId: caller_session_id,
      repository
    });
  }

  return { getRunStatus, waitForRunStatus, resolveRetainedFindingsSource };
}
