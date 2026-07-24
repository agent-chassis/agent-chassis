

import { readSystemMonotonic, defaultLivenessDeps } from "./worktree-lease.mjs";

import {
  MANAGED_RUN_PROCESS_IDENTITY_CODES,
  MANAGED_RUN_PROCESS_IDENTITY_RETIREMENT_REASONS,
  MANAGED_RUN_PROCESS_IDENTITY_STATES,
  MANAGED_RUN_PROCESS_IDENTITY_VERDICTS,
  RETIREMENT_REASON_VALUES,
  fail,
  hasExactKeys,
  normalizeManagedRunIdentityTuple
} from "./managed-run-process-identity-contract.mjs";

import {
  managedRunProcessIdentityFilePath,
  readManagedRunProcessIdentity,
  replaceAtomically,
  serializeRecord
} from "./managed-run-process-identity-store.mjs";

import { assessManagedRunProcessIdentityRecord } from "./managed-run-process-identity-assessment.mjs";

function retirementRefusal(state, reason, extra = null) {
  return Object.freeze({ retired: false, verdict: state, reason, ...(extra ?? {}) });
}

function validateRetirementEvidence({ reason, evidence, record }) {
  if (reason === MANAGED_RUN_PROCESS_IDENTITY_RETIREMENT_REASONS.FINALIZED_INTEGRATION) {

    if (typeof evidence?.slice_ref !== "string" || typeof evidence?.integrated_sha !== "string") {
      return "finalized_integration retirement requires the integrated slice ref and sha";
    }
    return null;
  }
  if (reason === MANAGED_RUN_PROCESS_IDENTITY_RETIREMENT_REASONS.NO_COMMIT_BASE_EQUAL) {

    if (typeof evidence?.slice_ref !== "string" ||
        typeof evidence?.base_sha !== "string" || evidence.base_sha.length === 0 ||
        typeof evidence?.slice_tip_sha !== "string") {
      return "no_commit_base_equal retirement requires the slice ref, authenticated base sha, and observed tip";
    }
    if (evidence.slice_tip_sha !== evidence.base_sha) {
      return "no_commit_base_equal retirement requires the slice tip to equal its authenticated base";
    }
    return null;
  }
  if (reason === MANAGED_RUN_PROCESS_IDENTITY_RETIREMENT_REASONS.CORRECTIVE_SUPERSESSION) {

    const requiredEvidenceFields = [
      "source_worker_run_id", "source_worker_monitor_handle", "subject", "slice_ref",
      "frozen_base_sha", "delivered_tip_sha", "commit_chain", "committed_target_digest"
    ];
    if (!hasExactKeys(evidence, requiredEvidenceFields) ||
        evidence.source_worker_run_id !== record.tuple.run_id ||
        evidence?.source_worker_monitor_handle !== record.tuple.launch_ref) {
      return "corrective_supersession retirement requires the exact prior attempt identity";
    }
    const subject = record.tuple.assigned_unit;
    const subjectMatch = subject.match(/^(WK-\d{4})#(SLICE-\d{3})$/u);
    const expectedRefSuffix = subjectMatch === null
      ? null
      : `/${subjectMatch[1]}/${subjectMatch[2]}`;
    const oid = (value) => typeof value === "string" &&
      /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(value) && !/^0+$/u.test(value);
    if (evidence?.subject !== subject || expectedRefSuffix === null ||
        typeof evidence?.slice_ref !== "string" ||
        !evidence.slice_ref.startsWith("refs/heads/slice/IN-") ||
        !evidence.slice_ref.endsWith(expectedRefSuffix) ||
        !oid(evidence?.frozen_base_sha) || !oid(evidence?.delivered_tip_sha) ||
        !Array.isArray(evidence?.commit_chain) || evidence.commit_chain.length === 0 ||
        evidence.commit_chain.some((commit) => !oid(commit)) ||
        evidence.commit_chain.at(-1) !== evidence.delivered_tip_sha ||
        typeof evidence?.committed_target_digest !== "string" ||
        !/^sha256:[0-9a-f]{64}$/u.test(evidence.committed_target_digest)) {
      return "corrective_supersession retirement requires exact authenticated delivery identity";
    }
    return null;
  }
  return "unsupported retirement reason";
}

export function retireManagedRunProcessIdentity({
  mainRepo,
  tuple,
  reason,
  evidence = null,
  deps = defaultLivenessDeps
} = {}) {
  const normalized = normalizeManagedRunIdentityTuple(tuple);
  if (!RETIREMENT_REASON_VALUES.has(reason)) {
    fail(
      MANAGED_RUN_PROCESS_IDENTITY_CODES.INVALID_ARG,
      `retirement reason must be one of ${[...RETIREMENT_REASON_VALUES].join("|")}, got: ${JSON.stringify(reason)}`
    );
  }
  const record = readManagedRunProcessIdentity({ mainRepo, tuple: normalized });
  const assessed = assessManagedRunProcessIdentityRecord(record, { expectedTuple: normalized, deps });
  if (assessed.verdict === MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.RETIRED ||
      assessed.verdict === MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.ABSENT) {

    return Object.freeze({
      retired: true,
      already_retired: true,
      verdict: assessed.verdict,
      reason: "the managed-run identity record is already settled",
      tuple: normalized
    });
  }
  if (assessed.verdict !== MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.PROVEN_DEAD) {
    return retirementRefusal(
      assessed.verdict,
      "only a provably dead bound attempt may be retired",
      { detail: assessed.reason, liveness: assessed.liveness ?? null, tuple: normalized }
    );
  }
  const evidenceRefusal = validateRetirementEvidence({ reason, evidence, record });
  if (evidenceRefusal !== null) {
    fail(MANAGED_RUN_PROCESS_IDENTITY_CODES.RETIREMENT_REFUSED, evidenceRefusal, {
      retirement_reason: reason
    });
  }
  let retiredAt;
  try {
    retiredAt = readSystemMonotonic(deps);
  } catch (error) {
    fail(
      MANAGED_RUN_PROCESS_IDENTITY_CODES.RETIREMENT_REFUSED,
      "cannot read the system monotonic clock; refusing to retire (fail closed)",
      { source_code: error?.code ?? null },
      error
    );
  }
  const retired = {
    schema_version: record.schema_version,
    state: MANAGED_RUN_PROCESS_IDENTITY_STATES.RETIRED,
    role: record.role,
    tuple: { ...record.tuple },
    launcher_identity: { ...record.launcher_identity },
    published_at: { ...record.published_at },
    sandbox_identity: { ...record.sandbox_identity },
    kill_shape: { ...record.kill_shape },
    retirement: {
      reason,
      verdict: MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.PROVEN_DEAD,
      retired_at: { uptime: retiredAt.uptime, boot_id: retiredAt.boot_id },
      evidence: { ...(evidence ?? {}) }
    }
  };
  const filePath = managedRunProcessIdentityFilePath(mainRepo, normalized);
  replaceAtomically(filePath, serializeRecord(retired));
  const readBack = readManagedRunProcessIdentity({ mainRepo, tuple: normalized });
  if (readBack === null || readBack.unreadable === true ||
      readBack.state !== MANAGED_RUN_PROCESS_IDENTITY_STATES.RETIRED) {
    fail(
      MANAGED_RUN_PROCESS_IDENTITY_CODES.RETIREMENT_REFUSED,
      "the retired managed-run identity record did not round-trip as a valid retired record"
    );
  }
  return Object.freeze({
    retired: true,
    already_retired: false,
    verdict: MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.PROVEN_DEAD,
    retirement_reason: reason,
    tuple: normalized,
    file_path: filePath
  });
}
