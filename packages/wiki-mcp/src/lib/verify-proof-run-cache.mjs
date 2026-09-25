

import { randomUUID } from "node:crypto";

import { ensureLauncherOwnedWorkspaceDurableStateRoot } from
  "../../../agent-launch-core/src/lib/durable-runtime-state.mjs";
import { digestOf } from "../../../agent-launch-core/src/lib/managed-worker-attempt-journal.mjs";
import { recordManagedProofVerification } from
  "../../../agent-launch-cli/src/lib/managed-run-process-identity-store.mjs";
import { assertLauncherTestProofRuntimeAuthority } from
  "../../../agent-launch-cli/src/lib/workspace-agent-test-proof-runtime-identity.mjs";
import { isTrustedManagedWorkerTestRunAuthority } from
  "../../../agent-launch-cli/src/lib/managed-worker-test-run-authority.mjs";
import { captureDiagnosticEvidence } from
  "../../../agent-launch-cli/src/lib/diagnostic-evidence.mjs";
import { persistVerifyProofCachedRecord } from "./mcp-response.mjs";
import { projectRetainedVerifyProofOutcomeSummary } from "./verify-proof-result-summary.mjs";
import { verifiedManagedWorkerSliceBinding } from "./verify-proof-candidate-context.mjs";
import { VERIFY_PROOF_RUN_CACHE_NAMESPACE, verifyProofRunCacheDirectory } from
  "./verify-proof-run-record-reader.mjs";

export const VERIFY_PROOF_RUN_RECORD_SCHEMA_VERSION = "managed-attempt-proof-verification.v1";
export const VERIFY_PROOF_RUN_CACHE_UNAVAILABLE_CODE = "verify_proof.run_cache_unavailable.v1";

const INTERRUPTION_OUTCOMES = Object.freeze({
  "verify_proof.execution_timed_out.v1": "timed_out",
  "verify_proof.execution_budget_exhausted_before_start.v1": "timed_out",
  "verify_proof.execution_cancelled.v1": "cancelled",
  "verify_proof.execution_cancelled_before_start.v1": "cancelled"
});

export function mintVerifyProofInvocationId() {
  return `verify-proof-invocation-${randomUUID()}`;
}

export function resolveVerifyProofRunAttempt(runtime) {
  if (runtime?.role !== "worker") return null;
  let authority;
  try {
    authority = assertLauncherTestProofRuntimeAuthority(runtime.authority);
  } catch {
    return null;
  }
  const managed = authority.managed_authority;
  const sliceBinding = verifiedManagedWorkerSliceBinding(authority);
  if (authority.kind !== "managed_worker" || !isTrustedManagedWorkerTestRunAuthority(managed) ||
      sliceBinding === null || sliceBinding.subject !== managed.unit_address ||
      sliceBinding.launch_ref !== managed.launch_ref || sliceBinding.run_id !== managed.run_id) {
    return null;
  }
  return Object.freeze({
    repository: managed.main_repo,
    subject: managed.unit_address,

    credential: Object.freeze({ launch_ref: sliceBinding.launch_ref, run_id: sliceBinding.run_id,
      retry_id: sliceBinding.retry_id }),
    slice_binding: sliceBinding
  });
}

export const VERIFY_PROOF_RUN_CACHE_REFUSAL_SCHEMA_VERSION = "workspace-verify-proof-run-cache-refusal.v1";

function unavailable(stage, cause, facts) {
  const details = {
    authority_limb: "mechanical_failure",
    operation: "workspace_verify_proof_retention",
    stage,
    cause_code: typeof cause?.code === "string" ? cause.code
      : typeof cause?.refusal?.code === "string" ? cause.refusal.code : null,
    cause_diagnostic: captureDiagnosticEvidence(cause),
    ...facts
  };
  return Object.assign(new Error(
    "workspace_verify_proof settled its execution but could not durably record it for the run",
    { cause }
  ), { code: VERIFY_PROOF_RUN_CACHE_UNAVAILABLE_CODE, details, envelope: {
    schema_version: VERIFY_PROOF_RUN_CACHE_REFUSAL_SCHEMA_VERSION,
    code: VERIFY_PROOF_RUN_CACHE_UNAVAILABLE_CODE,
    recorded: false,
    ...details
  } });
}

export async function ensureVerifyProofRunCacheDir(workspaceDir) {
  const ensured = await ensureLauncherOwnedWorkspaceDurableStateRoot({ workspaceDir });
  if (ensured.ok !== true) {
    throw Object.assign(new Error(ensured.reason, { cause: ensured }), {
      code: ensured.code,
      details: {
        authority_limb: "mechanical_failure",
        operation: "ensure_verify_proof_run_cache_directory",
        stage: "durable_state_directory_creation",
        cause_code: typeof ensured.code === "string" ? ensured.code : null,
        cause_diagnostic: captureDiagnosticEvidence(ensured)
      }
    });
  }
  return verifyProofRunCacheDirectory(ensured.dir);
}

function outcomeOf(kind, record) {
  if (kind === "refusal") return INTERRUPTION_OUTCOMES[record.reason_code] ?? "refused";
  const codes = [record.reason_code, ...(record.proof_results ?? []).map((proof) => proof.reason_code)];
  for (const code of codes) if (INTERRUPTION_OUTCOMES[code]) return INTERRUPTION_OUTCOMES[code];
  return "completed";
}

function testedSource(record) {
  const binding = record.execution_source_binding ?? null;
  if (binding === null) return null;
  return Object.freeze({
    wk_id: binding.wk_id ?? null,
    selected_unit: binding.selected_unit ?? null,
    focus: binding.focus ?? null,
    candidate: binding.candidate ?? null,
    source_snapshot_digest: binding.source_snapshot_digest ?? null,
    contract_generation: binding.contract_generation ?? null,
    canonical_contract_digest: binding.canonical_contract_digest ?? null,
    contract_digest: binding.contract_digest ?? null,
    binding_digest: binding.binding_digest ?? null,
    cases: structuredClone(binding.cases ?? [])
  });
}

function verificationRecord({ attempt, request, kind, record, recordIdentity, cached }) {
  return {
    schema_version: VERIFY_PROOF_RUN_RECORD_SCHEMA_VERSION,
    recorded_by: "workspace_verify_proof",
    caller: { role: "worker", assigned_unit: attempt.subject, credential: attempt.credential },
    request: structuredClone(request),
    outcome: outcomeOf(kind, record),
    status: record.status ?? null,
    reason_code: record.reason_code ?? null,
    result_digest: kind === "aggregate" ? record.result_digest : null,
    record_identity: recordIdentity,
    counts: structuredClone(record.counts ?? null),
    subject: structuredClone(record.subject ?? null),
    subject_binding: structuredClone(record.subject_binding ?? null),
    tested_source: testedSource(record),

    ...(kind === "aggregate" ? { outcome_summary: projectRetainedVerifyProofOutcomeSummary(record) } : {}),

    coverage_scope: "requested_selection_only",
    grants_authority: false,
    evidence: { store: "launcher_durable_state", namespace: VERIFY_PROOF_RUN_CACHE_NAMESPACE, ...cached }
  };
}

export async function recordVerifyProofRunResult({ attempt, invocationId, request, kind, record, env = process.env,
  recordObservation = recordManagedProofVerification }) {
  const recordIdentity = kind === "aggregate" ? record.result_digest : digestOf(record);
  const facts = { invocation_id: invocationId, record_kind: kind,
    execution_status: typeof record?.status === "string" ? record.status : null,
    reason_code: typeof record?.reason_code === "string" ? record.reason_code : null,
    record_identity: recordIdentity };
  let cached;
  try {
    const stateDir = await ensureVerifyProofRunCacheDir(attempt.repository);
    cached = persistVerifyProofCachedRecord({ kind, record, recordIdentity }, { stateDir, env });
  } catch (error) {
    throw unavailable("evidence_persistence", error, facts);
  }
  const verification = verificationRecord({ attempt, request, kind, record, recordIdentity, cached });
  let published;
  try {
    published = recordObservation({ mainRepo: attempt.repository, subject: attempt.subject,
      sliceBinding: attempt.slice_binding, invocationId, verification });
  } catch (error) {
    throw unavailable("journal_publication", error, facts);
  }
  if (published?.ok !== true) throw unavailable("journal_publication", published, {
    ...facts, publication_code: published?.code ?? published?.refusal?.code ?? null });
  return Object.freeze({ invocation_id: invocationId, record_identity: recordIdentity,
    outcome: verification.outcome });
}
