

import {
  AGENT_ROLE_RESULT_COUNT_FIELDS,
  parseAgentRoleResult
} from "@agent-chassis/agent-launch-core/src/lib/agent-role-result.mjs";
import {
  classifyReviewVerdictEligibility,
  deriveBackendReviewResult,
  isCleanupOnlyReviewerVerdict
} from "./workspace-agent-dispatch-review-result.mjs";
import {
  classifyExactSliceReviewVerdictEvidence,
  createExactSliceReviewReceipt,
  digestTrustedExactReviewEvidence
} from "./workspace-agent-dispatch-run-receipt.mjs";
import {
  STDIO_MCP_CLEANUP_BLOCKER_REASON,
  STDIO_MCP_CLIENT_READINESS_BLOCKER_REASON
} from "./stdio-mcp-conduit-contract.mjs";
import {
  isPlainObject,
  assertRetainedReviewerLaunchIdentityMatchesContext
} from "./backend-review-identity.mjs";
import { deepFreezeCanonicalSnapshot } from "./backend-scope-authority.mjs";

export function createBackendReceipts(ctx) {
  const {
    exactSliceReviewReceiptStore,
    sliceReviewRunContexts,
    wholeReviewRunContexts
  } = ctx;

  const verifyTerminalReviewContext = (context) => ctx.verifyTerminalReviewContext(context);

  function structuredReceiptOutcome(record) {
    const evidence = record?.final_result?.structured_role_result;
    if (evidence?.valid !== true || evidence?.claims?.reported_role !== record.role ||
        !new Set(["reviewer", "redteam"]).has(record.role) ||
        evidence?.claims?.reported_subject !== record.subject) return null;

    if (classifyReviewVerdictEligibility(record) === null) return null;

    const clean = deriveBackendReviewResult(record);
    if (clean) {
      return Object.freeze({
        outcome: "clean",
        clean_review: true,
        review_result: deepFreezeCanonicalSnapshot(clean)
      });
    }
    if (evidence.claims.reported_outcome !== "changes_requested") return null;
    const parsed = parseAgentRoleResult(record?.final_result?.full_response?.text);
    if (parsed?.valid !== true || !isPlainObject(parsed.result)) return null;
    const result = parsed.result;
    if (result.reported_role !== record.role || result.reported_subject !== record.subject ||
        result.reported_outcome !== "changes_requested") return null;
    if (!Array.isArray(result.findings) || result.findings.length === 0) return null;

    const counts = result.recomputed_finding_counts;
    const projected = evidence.finding_counts;
    if (!isPlainObject(counts) || !isPlainObject(projected)) return null;
    if (counts.total !== result.findings.length) return null;
    for (const field of AGENT_ROLE_RESULT_COUNT_FIELDS) {
      if (!Number.isInteger(counts[field]) || counts[field] !== projected[field]) return null;
    }
    return Object.freeze({
      outcome: "changes_requested",
      clean_review: false,
      findings: deepFreezeCanonicalSnapshot(result.findings),
      finding_counts: deepFreezeCanonicalSnapshot(counts)
    });
  }

  function validatedReviewerVerdictPresent(record) {
    const evidence = record?.final_result?.structured_role_result;
    return evidence?.valid === true &&
      evidence?.claims?.reported_role === record?.role &&
      new Set(["reviewer", "redteam"]).has(record?.role) &&
      evidence?.claims?.reported_subject === record?.subject;
  }

  const LAUNCH_TRANSPORT_FAILURE_REASONS = new Set([
    STDIO_MCP_CLIENT_READINESS_BLOCKER_REASON,
    STDIO_MCP_CLEANUP_BLOCKER_REASON
  ]);
  function launchTransportFailedRun(record) {
    if (record?.terminal !== true) return false;
    const reason = record?.final_result?.missing_result?.reason ?? null;
    return typeof reason === "string" && LAUNCH_TRANSPORT_FAILURE_REASONS.has(reason);
  }

  async function persistExactSliceReviewReceipt(context, record) {
    if (exactSliceReviewReceiptStore === null) return null;
    const structuredOutcome = structuredReceiptOutcome(record);
    const receipt = createExactSliceReviewReceipt({
      unit_address: context.review_subject,
      record_id: context.record_id,
      slice_id: context.review_slice_id,
      initiative: context.initiative,
      canonical_parent_wk_contract: context.canonical_parent_wk_contract,
      canonical_parent_contract_digest:
        digestTrustedExactReviewEvidence(context.canonical_parent_wk_contract),
      slice_review_contract: context.review_unit_contract,
      slice_review_contract_digest:
        digestTrustedExactReviewEvidence(context.review_unit_contract),
      ...(context.review_admission_kind === "canonical_committed_slice"
        ? {
            review_admission_kind: context.review_admission_kind,
            committed_target_digest: context.committed_target_digest
          }
        : {
            source_worker_run_id: context.source_worker_run_id,
            source_worker_monitor_handle: context.source_worker_monitor_handle
          }),
      review_run_id: record.run_id,
      review_monitor_handle: record.monitor_handle,
      reviewer_role: record.role,
      slice_ref: context.slice_ref,
      worktree_path: context.worktree_path,
      worktree_identity: context.worktree_identity,
      worktree_identity_digest: context.worktree_identity_digest,
      reviewed_sha: context.reviewed_sha,
      diff_base_sha: context.diff_base_sha,
      terminal_run_status: record.status,
      structured_outcome: structuredOutcome,

      ...(isCleanupOnlyReviewerVerdict(record) ? { cleanup_only_terminal_failure: true } : {}),

      verdict_evidence: classifyExactSliceReviewVerdictEvidence({
        terminal_run_status: record.status,
        structured_outcome: structuredOutcome,

        validated_verdict_present: validatedReviewerVerdictPresent(record),
        launch_transport_failed: launchTransportFailedRun(record)
      })
    });
    return exactSliceReviewReceiptStore.persist(receipt);
  }

  async function captureSliceReviewTerminalResult({ record }) {
    const context = sliceReviewRunContexts.get(record?.run_id) ?? null;
    if (context !== null && context.slice_level_review === true &&
        (record.role === "reviewer" || record.role === "redteam")) {
      return persistExactSliceReviewReceipt(context, record);
    }
    const terminalContext = wholeReviewRunContexts.get(record?.run_id) ?? null;
    if (terminalContext?.review_identity_kind !== "terminal_candidate" ||
        (record?.role !== "reviewer" && record?.role !== "redteam")) return null;
    assertRetainedReviewerLaunchIdentityMatchesContext(record.reviewer_launch_identity, terminalContext);
    verifyTerminalReviewContext(terminalContext);
    return null;
  }

  return {
    structuredReceiptOutcome,
    validatedReviewerVerdictPresent,
    launchTransportFailedRun,
    persistExactSliceReviewReceipt,
    captureSliceReviewTerminalResult
  };
}
