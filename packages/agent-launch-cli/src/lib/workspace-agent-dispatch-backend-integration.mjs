

import path from "node:path";
import { setWorkRecordStatusByUnit } from "@agent-chassis/wiki-core";
import {
  integrateCommittedSlice,
  SLICE_INTEGRATION_BOUNDARY_AUTHORIZATION_SCHEMA_VERSION,
  SLICE_INTEGRATION_POLICY_POSTURES
} from "./slice-integration.mjs";
import { isPlainObject } from "./backend-review-identity.mjs";
import { EXACT_IMPLEMENTATION_SLICE_RE } from "./backend-constants.mjs";
import {
  COMMITTED_SLICE_REVIEW_ADMISSION_CODES,
  resolveCommittedSliceReviewAdmission
} from "./committed-slice-review-admission.mjs";
import {
  deepFreezeCanonicalSnapshot,
  resolveCanonicalSliceReviewUnit,
  verifyFrozenSliceReviewTargetAgainstObjectStore,
  resolveCanonicalSliceIntegrationUnit
} from "./backend-scope-authority.mjs";
import {
  digestTrustedExactReviewEvidence,
  receiptCarriesUsableReviewVerdict
} from "./workspace-agent-dispatch-run-receipt.mjs";

export function createCanonicalCommittedSliceIntegrationAdapter(mainRepo) {
  const canonicalMainRepo = path.resolve(mainRepo ?? "");
  if (!path.isAbsolute(mainRepo ?? "") || canonicalMainRepo !== mainRepo) {
    throw new TypeError("canonical committed-slice integration requires a normalized absolute mainRepo");
  }
  return async ({ context, boundaryAuthorization } = {}) => {
    const target = boundaryAuthorization?.target;
    if (context?.review_admission_kind !== "canonical_committed_slice" ||
        target?.subject !== context.review_subject ||
        target?.committed_target_digest !== context.committed_target_digest ||
        target?.reviewed_sha !== context.reviewed_sha ||
        target?.diff_base_sha !== context.diff_base_sha ||
        target?.slice_ref !== context.slice_ref) {
      throw new Error("canonical committed-slice integration binding is unavailable or mismatched");
    }
    const writeStatus = ({ unitAddress, status, expectedSourceDigest }) =>
      setWorkRecordStatusByUnit({
        dir: canonicalMainRepo,
        unitAddress,
        status,
        expectedSourceDigest
      });
    return integrateCommittedSlice({
      mainRepo: canonicalMainRepo,
      worktreePath: context.worktree_path,
      unitAddress: `${context.initiative}/${context.record_id}/${context.review_slice_id}`,
      sliceRef: context.slice_ref,
      wkRef: `refs/heads/wk/${context.initiative}/${context.record_id}`,
      baseSha: context.diff_base_sha,
      commit: context.reviewed_sha,
      workerTerminated: false,
      transitionToReview: writeStatus,
      markSliceComplete: writeStatus,
      boundaryAuthorization
    });
  };
}

const CCE_BOUNDARY_POLICY_DECISION_SCHEMA_VERSION =
  "cce-boundary-policy-decision.v1";
const CCE_BOUNDARY_POLICY_REQUEST_SCHEMA_VERSION =
  "cce-boundary-policy-request.v1";
const CCE_POLICY_REFUSAL_SCHEMA_VERSION = "cce-policy-refusal.v1";
const CCE_POLICY_REFUSAL_CODES = Object.freeze({
  MISSING: "agent_launch.slice_integration.cce_policy_decision_missing.v1",
  UNAVAILABLE: "agent_launch.slice_integration.cce_policy_unavailable.v1",
  MALFORMED: "agent_launch.slice_integration.cce_policy_malformed.v1",
  UNRATIFIED: "agent_launch.slice_integration.cce_policy_unratified.v1",
  DENIED: "agent_launch.slice_integration.cce_policy_denied.v1",
  TARGET_MISMATCH: "agent_launch.slice_integration.cce_policy_target_mismatch.v1",
  DISPOSITION_INVALID: "agent_launch.slice_integration.advisory_disposition_invalid.v1"
});
const ORCHESTRATOR_ADVISORY_DISPOSITIONS = new Set(["accept", "reject", "defer"]);
const SHA256_DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const CCE_BOUNDARY_POLICY_DECISION_FIELDS = Object.freeze([
  "attestation_digest", "attestation_valid", "decision", "decision_id", "operation",
  "policy_id", "ratified", "schema_version", "target"
]);
const CCE_BOUNDARY_TARGET_FIELDS = Object.freeze([
  "committed_target_digest", "diff_base_sha", "initiative", "reviewed_sha",
  "slice_ref", "subject"
]);

function hasExactKeys(value, expected) {
  return isPlainObject(value) &&
    Object.keys(value).sort().join("|") === [...expected].sort().join("|");
}

function ccePolicyRefusal(code, reason, detail = null) {
  return Object.freeze({
    integrated: false,
    refused: true,
    refusal: Object.freeze({
      schema_version: CCE_POLICY_REFUSAL_SCHEMA_VERSION,
      code,
      reason,
      detail
    })
  });
}

function exactBoundaryTarget(context) {
  return Object.freeze({
    subject: context.review_subject,
    initiative: context.initiative,
    slice_ref: context.slice_ref,
    reviewed_sha: context.reviewed_sha,
    diff_base_sha: context.diff_base_sha,
    committed_target_digest: context.committed_target_digest
  });
}

function sameBoundaryTarget(left, right) {
  return left?.subject === right.subject &&
    left?.initiative === right.initiative &&
    left?.slice_ref === right.slice_ref &&
    left?.reviewed_sha === right.reviewed_sha &&
    left?.diff_base_sha === right.diff_base_sha &&
    left?.committed_target_digest === right.committed_target_digest;
}

function freeSubstrateBoundaryAuthorization(target) {
  return Object.freeze({
    schema_version: SLICE_INTEGRATION_BOUNDARY_AUTHORIZATION_SCHEMA_VERSION,
    operation: "integrate_committed_slice",
    policy_posture: SLICE_INTEGRATION_POLICY_POSTURES.FREE_SUBSTRATE,
    policy_gate_configured: false,
    authority: "none",
    decision: "not_gated",
    ratified: false,
    attestation_valid: false,
    audit_grade: false,
    target
  });
}

function normalizeAdvisoryDispositions(dispositions, evidence) {
  if (dispositions === undefined) return Object.freeze([]);
  if (!Array.isArray(dispositions)) return null;
  const findingIdsByRun = new Map(evidence.reviews.map((review) => [
    review.run_id,
    new Set((review.findings ?? []).map((finding) => finding.id))
  ]));
  const normalized = [];
  const seen = new Set();
  for (const entry of dispositions) {
    const keys = isPlainObject(entry) ? Object.keys(entry).sort() : [];
    if (keys.join("|") !== "disposition|finding_id|review_run_id" ||
        typeof entry.review_run_id !== "string" ||
        typeof entry.finding_id !== "string" ||
        !ORCHESTRATOR_ADVISORY_DISPOSITIONS.has(entry.disposition) ||
        !findingIdsByRun.get(entry.review_run_id)?.has(entry.finding_id)) {
      return null;
    }
    const key = `${entry.review_run_id}\u0000${entry.finding_id}`;
    if (seen.has(key)) return null;
    seen.add(key);
    normalized.push(Object.freeze({
      review_run_id: entry.review_run_id,
      finding_id: entry.finding_id,
      disposition: entry.disposition
    }));
  }
  return Object.freeze(normalized);
}

function emptySliceReviewAdvisoryEvidence(context, observationDiagnostic = null) {
  return Object.freeze({
    schema_version: "workspace-agent-slice-review-advisory-evidence.v1",
    unit_address: context.review_subject,
    initiative: context.initiative,
    slice_ref: context.slice_ref,
    reviewed_sha: context.reviewed_sha,
    diff_base_sha: context.diff_base_sha,
    review_admission_kind: context.review_admission_kind,
    committed_target_digest: context.committed_target_digest,
    active_review_run_ids: Object.freeze([]),
    clean_review_run_ids: Object.freeze([]),
    findings_review_run_ids: Object.freeze([]),
    invalid_review_run_ids: Object.freeze([]),
    reviews: Object.freeze([]),
    observation_complete: false,
    observation_diagnostic: observationDiagnostic,
    authority: "advisory_only"
  });
}

export function createBackendIntegration(ctx) {
  const {
    worktreeProvisioningConfig,
    reviewContextRunGit,
    sliceIntegrationCcePolicy,
    frozenSliceReviewContexts,
    exactSliceReviewReceiptStore,
    canonicalCommittedSliceIntegration,
    canonicalCommittedSliceIntegrations,
    canonicalCommittedSliceIntegrationAttempts,
    committedSliceIntegrationTargetKey
  } = ctx;

  const resolveSliceReviewEvidenceSet = (args) => ctx.resolveSliceReviewEvidenceSet(args);

  async function resolveSliceIntegrationBoundaryAuthorization({
    context,
    evidence,
    orchestratorDispositions
  }) {
    const target = exactBoundaryTarget(context);
    if (sliceIntegrationCcePolicy === null || sliceIntegrationCcePolicy?.configured === false) {
      return { ok: true, authorization: freeSubstrateBoundaryAuthorization(target) };
    }
    if (!isPlainObject(sliceIntegrationCcePolicy) ||
        sliceIntegrationCcePolicy.configured !== true) {
      return {
        ok: false,
        refusal: ccePolicyRefusal(
          CCE_POLICY_REFUSAL_CODES.MALFORMED,
          "committed-slice CCE policy gate configuration is malformed"
        )
      };
    }
    if (typeof sliceIntegrationCcePolicy.authorize !== "function") {
      return {
        ok: false,
        refusal: ccePolicyRefusal(
          CCE_POLICY_REFUSAL_CODES.MISSING,
          "configured CCE policy gate has no authorization resolver"
        )
      };
    }
    let decision;
    try {
      decision = await sliceIntegrationCcePolicy.authorize(Object.freeze({
        schema_version: CCE_BOUNDARY_POLICY_REQUEST_SCHEMA_VERSION,
        operation: "integrate_committed_slice",
        target,
        advisory_review_evidence: evidence,
        orchestrator_dispositions: orchestratorDispositions
      }));
    } catch (error) {
      return {
        ok: false,
        refusal: ccePolicyRefusal(
          CCE_POLICY_REFUSAL_CODES.UNAVAILABLE,
          "configured CCE policy authorization is unavailable",
          { diagnostic_code: typeof error?.code === "string" ? error.code : null }
        )
      };
    }
    if (decision === null || decision === undefined) {
      return {
        ok: false,
        refusal: ccePolicyRefusal(
          CCE_POLICY_REFUSAL_CODES.MISSING,
          "configured CCE policy returned no decision"
        )
      };
    }
    if (!hasExactKeys(decision, CCE_BOUNDARY_POLICY_DECISION_FIELDS) ||
        decision.schema_version !== CCE_BOUNDARY_POLICY_DECISION_SCHEMA_VERSION ||
        decision.operation !== "integrate_committed_slice" ||
        !new Set(["allow", "deny"]).has(decision.decision) ||
        typeof decision.policy_id !== "string" || decision.policy_id.length === 0 ||
        typeof decision.decision_id !== "string" || decision.decision_id.length === 0 ||
        !SHA256_DIGEST_RE.test(decision.attestation_digest ?? "") ||
        typeof decision.ratified !== "boolean" ||
        typeof decision.attestation_valid !== "boolean" ||
        !hasExactKeys(decision.target, CCE_BOUNDARY_TARGET_FIELDS)) {
      return {
        ok: false,
        refusal: ccePolicyRefusal(
          CCE_POLICY_REFUSAL_CODES.MALFORMED,
          "configured CCE policy returned a malformed decision"
        )
      };
    }
    if (!sameBoundaryTarget(decision.target, target)) {
      return {
        ok: false,
        refusal: ccePolicyRefusal(
          CCE_POLICY_REFUSAL_CODES.TARGET_MISMATCH,
          "configured CCE policy decision is bound to a different exact target"
        )
      };
    }
    if (decision.ratified !== true || decision.attestation_valid !== true) {
      return {
        ok: false,
        refusal: ccePolicyRefusal(
          CCE_POLICY_REFUSAL_CODES.UNRATIFIED,
          "configured CCE policy decision is unratified or has invalid attestation"
        )
      };
    }
    if (decision.decision !== "allow") {
      return {
        ok: false,
        refusal: ccePolicyRefusal(
          CCE_POLICY_REFUSAL_CODES.DENIED,
          "configured CCE policy denied committed-slice integration",
          { policy_id: decision.policy_id, decision_id: decision.decision_id }
        )
      };
    }
    return {
      ok: true,
      authorization: Object.freeze({
        schema_version: SLICE_INTEGRATION_BOUNDARY_AUTHORIZATION_SCHEMA_VERSION,
        operation: "integrate_committed_slice",
        policy_posture: SLICE_INTEGRATION_POLICY_POSTURES.CCE_POLICY,
        policy_gate_configured: true,
        authority: "cce",
        decision: "allow",
        ratified: true,
        attestation_valid: true,
        audit_grade: true,
        policy_id: decision.policy_id,
        decision_id: decision.decision_id,
        attestation_digest: decision.attestation_digest,
        target
      })
    };
  }

  async function requestCommittedSliceIntegration({ subject, dispositions } = {}) {
    if (worktreeProvisioningConfig === null ||
        !EXACT_IMPLEMENTATION_SLICE_RE.test(subject ?? "")) {
      return Object.freeze({
        integrated: false,
        reason: "canonical_committed_slice_integration_unavailable",
        code: COMMITTED_SLICE_REVIEW_ADMISSION_CODES.REFUSED
      });
    }
    let context;
    try {
      const integrationUnit = resolveCanonicalSliceIntegrationUnit(
        worktreeProvisioningConfig.mainRepo,
        subject
      );
      const admission = resolveCommittedSliceReviewAdmission({
        mainRepo: worktreeProvisioningConfig.mainRepo,
        worktreeRoot: worktreeProvisioningConfig.worktreeRoot,
        subject,
        reviewUnit: integrationUnit,
        requireWorktree: false,
        runGit: reviewContextRunGit
      });
      context = Object.freeze({
        schema_version: "workspace-agent-committed-slice-integration-context.v1",
        review_admission_kind: admission.review_admission_kind,
        empty_delivery: admission.empty_delivery === true,
        committed_target_digest: admission.committed_target_digest,
        review_subject: subject,
        record_id: integrationUnit.record_id,
        review_slice_id: integrationUnit.slice_id,
        initiative: integrationUnit.initiative,
        canonical_parent_wk_contract: integrationUnit.canonical_parent_wk_contract,
        review_unit_contract: integrationUnit.review_unit_contract,
        main_repo: worktreeProvisioningConfig.mainRepo,
        worktree_path: admission.worktree_path,
        slice_ref: admission.target.ref,
        reviewed_sha: admission.target.sha,
        diff_base_sha: admission.target.diff_base_sha,
        diff_head_sha: admission.target.sha,
        diff_range: admission.target.diff_range,
        worktree_identity: admission.identity
      });
    } catch (error) {
      return Object.freeze({
        integrated: false,
        reason: error?.detail?.reason ?? "canonical_committed_slice_integration_unavailable",
        code: error?.code ?? COMMITTED_SLICE_REVIEW_ADMISSION_CODES.REFUSED
      });
    }
    const reviewContext = frozenSliceReviewContexts.get(subject) ?? null;
    let observedEvidence = null;
    let observationDiagnostic = null;
    if (reviewContext !== null &&
        reviewContext.slice_ref === context.slice_ref &&
        reviewContext.reviewed_sha === context.reviewed_sha &&
        reviewContext.diff_base_sha === context.diff_base_sha) {
      try {
        observedEvidence = await resolveSliceReviewEvidenceSet({ subject });
      } catch (error) {

        observationDiagnostic = Object.freeze({
          code: "review_evidence_observation_unavailable",
          source_code: typeof error?.code === "string" ? error.code : null
        });
      }
    }
    const evidence = observedEvidence?.schema_version ===
        "workspace-agent-slice-review-advisory-evidence.v1"
      ? observedEvidence
      : emptySliceReviewAdvisoryEvidence(context, observationDiagnostic);
    const orchestratorDispositions = normalizeAdvisoryDispositions(dispositions, evidence);
    if (orchestratorDispositions === null) {
      return ccePolicyRefusal(
        CCE_POLICY_REFUSAL_CODES.DISPOSITION_INVALID,
        "orchestrator advisory dispositions do not match retained exact-target findings"
      );
    }
    if (canonicalCommittedSliceIntegration === null) {
      throw new Error("canonical committed-slice integration adapter is unavailable");
    }
    const key = committedSliceIntegrationTargetKey(context);
    if (canonicalCommittedSliceIntegrations.has(key)) {
      return canonicalCommittedSliceIntegrations.get(key);
    }
    if (!canonicalCommittedSliceIntegrationAttempts.has(key)) {
      const attempt = (async () => {
        const policy = await resolveSliceIntegrationBoundaryAuthorization({
          context,
          evidence,
          orchestratorDispositions
        });
        if (policy.ok !== true) return policy.refusal;
        const integration = await canonicalCommittedSliceIntegration({
          context,
          boundaryAuthorization: policy.authorization
        });
        const result = Object.freeze({
          ...integration,
          advisory_review_evidence: evidence,
          orchestrator_dispositions: orchestratorDispositions
        });
        canonicalCommittedSliceIntegrations.set(key, Promise.resolve(result));
        return result;
      })();
      canonicalCommittedSliceIntegrationAttempts.set(key, attempt);
    }
    try {
      return await canonicalCommittedSliceIntegrationAttempts.get(key);
    } finally {
      canonicalCommittedSliceIntegrationAttempts.delete(key);
    }
  }

  async function resolveCommittedSliceIntegrationContinuation({ subject } = {}) {
    const context = frozenSliceReviewContexts.get(subject) ?? null;
    if (context === null) return null;
    const completed = canonicalCommittedSliceIntegrations.get(
      committedSliceIntegrationTargetKey(context)
    );
    if (completed === undefined) return null;
    const integration = await completed;
    return Object.freeze({
      requested: true,
      completed: integration?.integrated === true,
      reviewed_sha: context.reviewed_sha
    });
  }

  async function resolveCorrectiveFindingsContext({ subject, workspace_dir: workspaceDir }) {
    if (exactSliceReviewReceiptStore === null ||
        path.resolve(workspaceDir ?? "") !== worktreeProvisioningConfig?.mainRepo ||
        !EXACT_IMPLEMENTATION_SLICE_RE.test(subject ?? "")) return null;
    const targetContext = frozenSliceReviewContexts.get(subject) ?? null;
    if (targetContext === null) return null;
    const receipts = await exactSliceReviewReceiptStore.loadAll({
      unit_address: subject,
      committed_target_digest: targetContext.committed_target_digest
    });
    const findingsReceipts = receipts.filter((receipt) =>
      receiptCarriesUsableReviewVerdict(receipt) &&
      receipt.structured_outcome?.outcome === "changes_requested"
    );
    if (findingsReceipts.length === 0) return null;
    const receipt = findingsReceipts[0];
    const current = resolveCanonicalSliceReviewUnit(worktreeProvisioningConfig.mainRepo, subject);
    if (digestTrustedExactReviewEvidence(current.canonical_parent_wk_contract) !== receipt.canonical_parent_contract_digest ||
        digestTrustedExactReviewEvidence(current.review_unit_contract) !== receipt.slice_review_contract_digest) return null;
    const context = {
      slice_ref: receipt.slice_ref,
      reviewed_sha: receipt.reviewed_sha,
      diff_base_sha: receipt.diff_base_sha
    };
    if (verifyFrozenSliceReviewTargetAgainstObjectStore({
      mainRepo: worktreeProvisioningConfig.mainRepo,
      context,
      runGit: reviewContextRunGit
    }).ok !== true) return null;
    return deepFreezeCanonicalSnapshot({
      schema_version: "workspace-agent-trusted-corrective-findings-context.v1",
      authority: "launcher_exact_review_receipt",
      unit_address: subject,
      source_worker_run_id: targetContext.source_worker_run_id ?? null,
      source_worker_monitor_handle: targetContext.source_worker_monitor_handle ?? null,
      review_run_ids: findingsReceipts.map((entry) => entry.review_run_id),
      review_monitor_handles: findingsReceipts.map((entry) => entry.review_monitor_handle),
      reviewed_sha: receipt.reviewed_sha,
      diff_base_sha: receipt.diff_base_sha,
      findings: findingsReceipts.flatMap((entry) => entry.structured_outcome.findings),
      trusted_evidence_digests: findingsReceipts.map((entry) => entry.trusted_evidence_digest)
    });
  }

  return {
    resolveSliceIntegrationBoundaryAuthorization,
    requestCommittedSliceIntegration,
    resolveCommittedSliceIntegrationContinuation,
    resolveCorrectiveFindingsContext
  };
}
