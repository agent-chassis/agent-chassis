

import { BACKEND_REFUSAL_CODES } from "@agent-chassis/agent-launch-core";

import { statusRefusal } from "./workspace-agent-dispatch-refusal.mjs";

export function listVisibleRuns(
  runs,
  { caller_session_id = null, state, subject = null } = {}
) {
  if (typeof caller_session_id !== "string" || caller_session_id.trim().length === 0) {
    return statusRefusal(
      BACKEND_REFUSAL_CODES.MONITOR_HANDLE_CALLER_MISMATCH,
      "caller_session_id_required",
      null
    );
  }
  const matching = [];
  for (const record of runs.values()) {
    if (record.caller_session_id !== caller_session_id) continue;
    if (subject !== null && record.subject !== subject) continue;
    if (state === "active" && record.terminal === true) continue;
    if (state === "terminal" && record.terminal !== true) continue;
    matching.push(record);
  }

  matching.sort((left, right) => {
    if (left.started_at < right.started_at) return 1;
    if (left.started_at > right.started_at) return -1;
    if (left.run_id < right.run_id) return -1;
    if (left.run_id > right.run_id) return 1;
    return 0;
  });

  return {
    accepted: true,
    runs: matching.map((record) => ({
      run_id: record.run_id,
      monitor_handle: record.monitor_handle,
      role: record.role,
      subject: record.subject,
      status: record.status,
      terminal: record.terminal,
      started_at: record.started_at,
      updated_at: record.updated_at
    }))
  };
}

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
