

import { BACKEND_REFUSAL_CODES } from "@agent-chassis/agent-launch-core";

import { statusRefusal } from "./workspace-agent-dispatch-refusal.mjs";

export function findRunRecord(runs, { run_id = null, monitor_handle = null } = {}) {
  let record = null;
  if (run_id && typeof run_id === "string") {
    record = runs.get(run_id) ?? null;
  }
  if (!record && monitor_handle && typeof monitor_handle === "string") {
    for (const candidate of runs.values()) {
      if (candidate.monitor_handle === monitor_handle) {
        record = candidate;
        break;
      }
    }
  }
  return record;
}

export function selectVisibleRunRecord(
  runs,
  { caller_session_id = null, subject, attempt_id = null } = {}
) {
  const subjectRecords = [...runs.values()].filter((record) => record.subject === subject);
  const visible = subjectRecords.filter((record) =>
    (caller_session_id === null || record.caller_session_id === caller_session_id));
  if (attempt_id !== null) {
    const selected = visible.find((record) => record.run_id === attempt_id) ?? null;
    const hiddenExact = subjectRecords.some((record) => record.run_id === attempt_id);
    return selected === null
      ? {
          selected: null,
          code: hiddenExact
            ? BACKEND_REFUSAL_CODES.MONITOR_HANDLE_CALLER_MISMATCH
            : "attempt_selector_mismatch",
          candidates: []
        }
      : { selected, code: null, candidates: [selected] };
  }
  if (visible.length === 1) return { selected: visible[0], code: null, candidates: visible };
  if (visible.length > 1) {
    return {
      selected: null,
      code: "attempt_selection_ambiguous",
      candidates: visible.map((record) => ({
        attempt_id: record.run_id,
        role: record.role,
        status: record.status,
        terminal: record.terminal
      }))
    };
  }
  return {
    selected: null,
    code: subjectRecords.length > 0
      ? BACKEND_REFUSAL_CODES.MONITOR_HANDLE_CALLER_MISMATCH
      : "attempt_observation_unavailable",
    candidates: []
  };
}

export function snapshotRuns(runs) {
  return [...runs.values()].map((r) => ({
    run_id: r.run_id,
    monitor_handle: r.monitor_handle,
    app: r.app,
    role: r.role,
    subject: r.subject,
    status: r.status,
    terminal: r.terminal,
    caller_session_id: r.caller_session_id,
    ...(r.reviewer_launch_identity
      ? { reviewer_launch_identity: r.reviewer_launch_identity }
      : {})
  }));
}

export function replaceReviewerLaunchIdentityForTest(runs, runId, identity) {
  const record = runs.get(runId);
  if (!record) return false;
  const { reviewer_launch_identity: _discardedIdentity, ...replacement } = record;
  if (identity !== null) {
    const frozenContract = identity?.trusted_frozen_review_contract &&
        typeof identity.trusted_frozen_review_contract === "object"
      ? Object.freeze({ ...identity.trusted_frozen_review_contract })
      : identity?.trusted_frozen_review_contract;
    Object.defineProperty(replacement, "reviewer_launch_identity", {
      value: Object.freeze({
        ...identity,
        trusted_frozen_review_contract: frozenContract
      }),
      enumerable: true,
      configurable: false,
      writable: false
    });
  }
  runs.set(runId, replacement);
  return true;
}
