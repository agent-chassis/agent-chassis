

import { persistVerifyProofEvidenceReference } from "./mcp-response.mjs";
import { buildDispatchContinuation } from "./dispatch-tool-helpers.mjs";
import { captureDiagnosticEvidence } from
  "../../../agent-launch-cli/src/lib/diagnostic-evidence.mjs";
import { readVerifyProofRunRecord } from "./verify-proof-run-record-reader.mjs";

export const RUN_PROOF_VERIFICATION_OBSERVATION_SCHEMA_VERSION = "run-proof-verification-observation.v1";
export const RUN_PROOF_VERIFICATION_DETAIL_KIND = "proof_verification";
const ROUTE = "workspace_agent_run_status";

function detailCall(subject, attemptId, detail) {
  return buildDispatchContinuation({
    tool: ROUTE,
    arguments: { subject, ...(attemptId === null ? {} : { attempt_id: attemptId }), detail },
    successPredicate: { fact: "monitor.proof_verification_detail_read", operator: "is_true" }
  });
}

function projectLastRecordedInvocation({ subject, attemptId, item }) {
  if (item === null || typeof item !== "object") return null;
  return Object.freeze({
    ...item,
    observation: "last_recorded_invocation",
    detail_call: detailCall(subject, attemptId,
      { kind: RUN_PROOF_VERIFICATION_DETAIL_KIND, invocation_id: item.invocation_id })
  });
}

export async function observeRunProofVerification({ dispatchBackend, callerSessionId, status }) {
  const base = { schema_version: RUN_PROOF_VERIFICATION_OBSERVATION_SCHEMA_VERSION, grants_authority: false };
  if (typeof dispatchBackend?.readManagedRunObservation !== "function") {
    return Object.freeze({ ...base, state: "unavailable", code: "run_detail_backend_unavailable" });
  }
  let page;
  try {
    page = await dispatchBackend.readManagedRunObservation({
      caller_session_id: callerSessionId,
      subject: status.subject,
      attemptId: status.run_id,
      detail: { kind: RUN_PROOF_VERIFICATION_DETAIL_KIND, limit: 1 }
    });
  } catch (error) {
    page = { ok: false, code: typeof error?.code === "string" ? error.code : "run_detail_unavailable",
      observation_failure: error };
  }
  if (page?.ok !== true) {
    const failure = Object.hasOwn(page ?? {}, "observation_failure")
      ? page.observation_failure : page;
    return Object.freeze({ ...base, state: "unavailable",
      code: page?.code ?? page?.refusal?.code ?? "run_detail_unavailable",
      diagnostic: Object.freeze({
        operation: "read_managed_run_proof_verification_observation",
        stage: "attempt_journal_observation",
        subject: status.subject,
        attempt_id: status.run_id,
        evidence: captureDiagnosticEvidence(failure)
      }) });
  }
  const recorded = page.summary.recorded_count;
  const attemptId = page.attempt_id ?? status.run_id;
  return Object.freeze({
    ...base,
    state: recorded === 0 ? "none_recorded" : "recorded",
    ...(recorded === 0 ? { meaning: "no explicit verification is recorded for this attempt; this is not a pass" } : {}),
    recorded_count: recorded,
    outcome_counts: page.summary.outcome_counts,
    status_counts: page.summary.status_counts,
    last_recorded_invocation: projectLastRecordedInvocation({
      subject: status.subject,
      attemptId,
      item: page.summary.last_recorded_invocation
    }),
    snapshot: page.snapshot,
    detail_call: detailCall(status.subject, attemptId,
      { kind: RUN_PROOF_VERIFICATION_DETAIL_KIND })
  });
}

function projectListedItem({ subject, attemptId, item }) {
  const { verification } = item;
  return Object.freeze({
    invocation_id: item.invocation_id,
    sequence: item.sequence,
    event_digest: item.digest,
    outcome: verification.outcome,
    status: verification.status,
    reason_code: verification.reason_code,
    result_digest: verification.result_digest,
    record_identity: verification.record_identity,
    counts: verification.counts,
    request: verification.request,
    caller: verification.caller,
    tested_source: verification.tested_source,
    coverage_scope: verification.coverage_scope,
    grants_authority: false,
    evidence_call: detailCall(subject, attemptId,
      { kind: RUN_PROOF_VERIFICATION_DETAIL_KIND, invocation_id: item.invocation_id })
  });
}

export function projectRunProofVerificationDetail({ subject, detail, workspaceDir, responseEnv = process.env }) {
  const attemptId = detail.attempt_id ?? null;
  const items = detail.items.map((item) => projectListedItem({ subject, attemptId, item }));
  const projected = { ...detail, items, grants_authority: false };
  if (detail.invocation_id === undefined) return Object.freeze(projected);
  const [item] = detail.items;
  const { kind, record } = readVerifyProofRunRecord({ workspaceDir, verification: item.verification });
  if (kind === "refusal") return Object.freeze({ ...projected, refusal: record });
  const persisted = persistVerifyProofEvidenceReference({ evidence: record, evidenceIdentity: record.result_digest },
    { env: responseEnv });
  if (persisted.status !== "persisted") {
    const failure = persisted.result;
    throw Object.assign(new Error("recorded verification evidence could not be delivered", {
      cause: failure
    }), { code: "verify_proof_cache.evidence_delivery_failed.v1", details: {
      authority_limb: "mechanical_failure",
      operation: "project_run_proof_verification_detail",
      stage: "evidence_reference_delivery",
      subject,
      attempt_id: attemptId,
      invocation_id: detail.invocation_id,
      delivery_failure: captureDiagnosticEvidence(failure)
    } });
  }
  return Object.freeze({ ...projected, evidence: persisted.reference });
}
