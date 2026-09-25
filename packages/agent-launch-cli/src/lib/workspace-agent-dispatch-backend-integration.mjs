

import path from "node:path";
import {
  computeWorkRecordSourceDigest
} from "@agent-chassis/wiki-core/src/lib/work-record-schema.mjs";
import {
  setWorkRecordStatusByUnit
} from "@agent-chassis/wiki-core/src/operations/work-records-edits.mjs";
import {
  writeValidatedWorkRecord
} from "@agent-chassis/wiki-core/src/operations/work-records-store-io.mjs";
import {
  INTEGRATED_RECORD_RECONCILIATION_STATES,
  integrateCommittedSlice,
  reconcileIntegratedSliceRecordOnly,
  recoverZeroDeltaIntegratedSlice,
  SLICE_INTEGRATION_BOUNDARY_AUTHORIZATION_SCHEMA_VERSION,
  SLICE_INTEGRATION_DIAGNOSTIC_CODES,
  SLICE_INTEGRATION_POLICY_POSTURES
} from "./slice-integration.mjs";
import { isPlainObject } from "./backend-review-identity.mjs";
import { captureDiagnosticEvidence } from "./diagnostic-evidence.mjs";
import { EXACT_IMPLEMENTATION_SLICE_RE } from "./backend-constants.mjs";
import {
  committedSliceScopeRefusalCorrection,
  COMMITTED_SLICE_REVIEW_ADMISSION_CODES,
  resolveCommittedSliceReviewAdmission,
  resolveCommittedSliceScopeDecisionInputs,
  resolveCommittedSliceScopeOffenders
} from "./committed-slice-review-admission.mjs";
import {
  resolveUniqueManagedLifecycleBindingPairForRecovery
} from "./worktree-substrate-identity.mjs";
import {
  assessExplicitBaseMergeTreeCapability,
  EXPLICIT_BASE_MERGE_TREE_CORRECTION_CONDITION,
  explicitBaseMergeTreeCapabilityCorrection
} from "./explicit-base-merge-tree.mjs";
import { defaultRunGitAsync } from "./worktree-substrate-primitives.mjs";
import {
  resolveCanonicalSliceIntegrationUnit
} from "./backend-scope-authority.mjs";
import {
  assertWkLifecycleObservationCurrent,
  boundedWkLifecycleObservation,
  readCanonicalContractGenerationIdentity,
  revParse
} from "./slice-integration-authorization.mjs";
import {
  AUTHENTICATED_INTEGRATION_CONTINUATION,
  brandedContinuation,
  committedSliceIntegrationDeliveryKey,
  continuationRefusal,
  createBackendIntegrationContinuation,
  INTEGRATION_CONTINUATION_DIAGNOSTIC_CODE
} from "./workspace-agent-dispatch-backend-integration-continuation.mjs";

export {
  AUTHENTICATED_INTEGRATION_CONTINUATION,
  INTEGRATION_CONTINUATION_DIAGNOSTIC_CODE
};

export function createCanonicalCommittedSliceIntegrationAdapter(mainRepo) {
  const canonicalMainRepo = path.resolve(mainRepo ?? "");
  if (!path.isAbsolute(mainRepo ?? "") || canonicalMainRepo !== mainRepo) {
    throw new TypeError("canonical committed-slice integration requires a normalized absolute mainRepo");
  }
  return async ({ context, boundaryAuthorization } = {}) => {
    const target = boundaryAuthorization?.target;
    const integrationBinding = context?.integration_binding;
    const expectedWkRef = context === null || context === undefined
      ? null
      : `refs/heads/wk/${context.initiative}/${context.record_id}`;
    if (context?.review_admission_kind !== "canonical_committed_slice" ||
        !isPlainObject(integrationBinding) ||
        integrationBinding.wk_ref !== expectedWkRef ||
        typeof integrationBinding.wk_tip_sha !== "string" ||
        !isPlainObject(integrationBinding.contract_generation) ||
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
      wkRef: integrationBinding.wk_ref,
      baseSha: context.diff_base_sha,
      commit: context.reviewed_sha,
      workerTerminated: false,
      transitionToReview: writeStatus,
      markSliceComplete: writeStatus,
      writeRecordCas: ({ record, expectedSourceDigest }) => writeValidatedWorkRecord({
        dir: canonicalMainRepo,
        record,
        expectedSourceDigest
      }),
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
  OVERSIZED: "agent_launch.slice_integration.cce_policy_oversized.v1",
  UNRATIFIED: "agent_launch.slice_integration.cce_policy_unratified.v1",
  DENIED: "agent_launch.slice_integration.cce_policy_denied.v1",
  TARGET_MISMATCH: "agent_launch.slice_integration.cce_policy_target_mismatch.v1"
});
const ORCHESTRATOR_ADVISORY_DISPOSITIONS = new Set(["accept", "reject", "defer"]);
const SHA256_DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const CCE_POLICY_DECISION_MAX_BYTES = 64 * 1024;
const CCE_POLICY_ID_MAX_CHARS = 256;

const PUBLIC_BLOCKER_CODES = Object.freeze({
  BACKEND_UNAVAILABLE: "backend_unavailable",
  CCE_POLICY_REFUSED: "agent_launch.slice_integration.cce_policy_refused.v1",
  CLASSIFICATION_UNAVAILABLE:
    "agent_launch.slice_integration.classification_unavailable.v1",
  VALIDATION_FAILURE: "validation_failure"
});
const CCE_POLICY_DECISION_REFUSAL_CODES = new Set([
  CCE_POLICY_REFUSAL_CODES.UNRATIFIED,
  CCE_POLICY_REFUSAL_CODES.DENIED,
  CCE_POLICY_REFUSAL_CODES.TARGET_MISMATCH
]);
const CCE_EVIDENCE_FAILURE_REFUSAL_CODES = new Set([
  CCE_POLICY_REFUSAL_CODES.MISSING,
  CCE_POLICY_REFUSAL_CODES.UNAVAILABLE,
  CCE_POLICY_REFUSAL_CODES.MALFORMED,
  CCE_POLICY_REFUSAL_CODES.OVERSIZED
]);
const CALLER_VALIDATION_CODES = new Set([
  "agent_launch.slice_integration.invalid_arg.v1",
  "agent_launch.slice_integration.binding_mismatch.v1"
]);
const ADMISSION_VALIDATION_CODES = new Set([
  COMMITTED_SLICE_REVIEW_ADMISSION_CODES.REFUSED,
  ...CALLER_VALIDATION_CODES
]);
const BACKEND_UNAVAILABLE_CODES = new Set([
  "agent_launch.slice_integration.backend_unavailable.v1",
  "agent_launch.slice_integration.integration_backend_unavailable.v1",
  COMMITTED_SLICE_REVIEW_ADMISSION_CODES.GIT_CAPABILITY_UNAVAILABLE,
  SLICE_INTEGRATION_DIAGNOSTIC_CODES.GIT_CAPABILITY_UNAVAILABLE
]);
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
  const diagnosticKind = new Set([
    CCE_POLICY_REFUSAL_CODES.UNRATIFIED,
    CCE_POLICY_REFUSAL_CODES.DENIED,
    CCE_POLICY_REFUSAL_CODES.TARGET_MISMATCH
  ]).has(code)
    ? "returned_cce_policy_decision"
    : "configured_cce_evidence_failure";
  return Object.freeze({
    integrated: false,
    refused: true,
    refusal: Object.freeze({
      schema_version: CCE_POLICY_REFUSAL_SCHEMA_VERSION,
      code,
      reason,
      detail,
      diagnostic_kind: diagnosticKind
    })
  });
}

export const COMMITTED_SLICE_INTEGRATION_REFUSAL_DIAGNOSTIC_CODES = Object.freeze([...new Set([
  ...Object.values(SLICE_INTEGRATION_DIAGNOSTIC_CODES),
  ...Object.values(CCE_POLICY_REFUSAL_CODES),
  ...Object.values(COMMITTED_SLICE_REVIEW_ADMISSION_CODES),
  ...BACKEND_UNAVAILABLE_CODES,
  "agent_launch.slice_integration.current_binding_stale.v1",
  "agent_launch.slice_integration.current_binding_unavailable.v1"
])]);
export const COMMITTED_SLICE_INTEGRATION_REFUSAL_DIAGNOSTIC_KINDS = Object.freeze([
  "returned_cce_policy_decision",
  "configured_cce_evidence_failure"
]);
export const COMMITTED_SLICE_INTEGRATION_PUBLIC_BLOCKER_CODES = Object.freeze(
  Object.values(PUBLIC_BLOCKER_CODES)
);
const APPROVED_REFUSAL_DIAGNOSTIC_CODES = new Set(COMMITTED_SLICE_INTEGRATION_REFUSAL_DIAGNOSTIC_CODES);
const APPROVED_REFUSAL_DIAGNOSTIC_KINDS = new Set(COMMITTED_SLICE_INTEGRATION_REFUSAL_DIAGNOSTIC_KINDS);
const COMMITTED_SLICE_INTEGRATION_REFUSALS = new WeakMap();

export function projectCommittedSliceIntegrationRefusal(value) {
  return COMMITTED_SLICE_INTEGRATION_REFUSALS.get(value) ?? null;
}

export const COMMITTED_SLICE_INTEGRATION_RETRY_DECISIONS = Object.freeze({
  UNCHANGED: "relevant_inputs_unchanged",
  CHANGED: "relevant_inputs_changed",
  COMPLETED: "authenticated_completion_available",
  UNKNOWN: "correction_unknown",
  OUTSIDE_ALLOCATION: "delivery_outside_allocated_scope",
  CURRENT_REFUSAL: "current_refusal_rederived",
  CORRECTION_UNESTABLISHED: "historical_correction_unestablished"
});
const COMMITTED_SLICE_INTEGRATION_RETRY_FACTS = new WeakMap();
const RETRY_FACTS_BRAND = new WeakSet();

export function resolveCommittedSliceIntegrationRetryFacts(value) {
  return COMMITTED_SLICE_INTEGRATION_RETRY_FACTS.get(value) ?? null;
}

function registerRetryFacts(result, { subject, correction }) {
  const facts = Object.freeze({
    schema_version: "committed-slice-integration-retry-facts.v1",
    subject,
    reason: correction.reason,
    correction_condition: correction.condition,
    decision_inputs: correction.decision_inputs,

    grants_authority: false
  });
  RETRY_FACTS_BRAND.add(facts);
  COMMITTED_SLICE_INTEGRATION_RETRY_FACTS.set(result, facts);
  return result;
}

function sameDecisionInputs(left, right) {
  const changed = [];
  for (const field of ["subject", "diff_base_sha", "base_tree_sha", "reviewed_sha"]) {
    if (left[field] !== right[field]) changed.push(field);
  }
  if (left.write_scope.length !== right.write_scope.length ||
      left.write_scope.some((entry, index) => entry !== right.write_scope[index])) {
    changed.push("write_scope");
  }
  return Object.freeze(changed);
}

function nonIntegratedFromError(error, fallbackReason) {
  const result = {
    integrated: false,
    reason: error?.detail?.reason ?? fallbackReason
  };
  if (typeof error?.code === "string") result.code = error.code;
  if (error?.detail !== undefined) result.detail = error.detail;
  result.evidence = captureDiagnosticEvidence(error, {
    publishedFields: result.detail === undefined ? {} : { detail: result.detail }
  });
  return classifiedNonIntegratedResult(Object.freeze(result));
}

function classifiedNonIntegratedResult(result) {
  if (result?.integrated === true) return result;
  const refusalCode = result?.refusal?.code;
  const publicBlockerCode = result?.refusal?.diagnostic_kind ===
      "returned_cce_policy_decision" || CCE_POLICY_DECISION_REFUSAL_CODES.has(refusalCode)
    ? PUBLIC_BLOCKER_CODES.CCE_POLICY_REFUSED
    : result?.refusal?.diagnostic_kind === "configured_cce_evidence_failure" ||
        CCE_EVIDENCE_FAILURE_REFUSAL_CODES.has(refusalCode)
      ? PUBLIC_BLOCKER_CODES.BACKEND_UNAVAILABLE
      : ADMISSION_VALIDATION_CODES.has(result?.code)
        ? PUBLIC_BLOCKER_CODES.VALIDATION_FAILURE
        : BACKEND_UNAVAILABLE_CODES.has(result?.code)
          ? PUBLIC_BLOCKER_CODES.BACKEND_UNAVAILABLE
          : PUBLIC_BLOCKER_CODES.CLASSIFICATION_UNAVAILABLE;
  const classified = Object.freeze({ ...result, public_blocker_code: publicBlockerCode });
  const diagnosticCode = typeof refusalCode === "string" ? refusalCode : result?.code;
  const reason = result?.refusal?.reason ?? result?.reason;
  const projection = Object.freeze({
    reason: typeof reason === "string" ? reason : null,
    diagnostic_code: APPROVED_REFUSAL_DIAGNOSTIC_CODES.has(diagnosticCode) ? diagnosticCode : null,
    diagnostic_kind: APPROVED_REFUSAL_DIAGNOSTIC_KINDS.has(result?.refusal?.diagnostic_kind)
      ? result.refusal.diagnostic_kind
      : null,
    public_blocker_code: publicBlockerCode
  });
  COMMITTED_SLICE_INTEGRATION_REFUSALS.set(classified, projection);

  if (typeof classified.refusal === "object" && classified.refusal !== null) {
    COMMITTED_SLICE_INTEGRATION_REFUSALS.set(classified.refusal, projection);
  }
  return classified;
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

const INTEGRATION_CLOSEOUT_CONTINUATION = Object.freeze({
  schema_version: "workspace-agent-closeout-workflow-continuation.v1",
  advisory: true,
  authority: "none",
  grants_authority: false,
  stage: "resume_original_worker_monitor",
  decision_required: false,
  ordered_steps: Object.freeze([
    Object.freeze({ order: 1, action: "resume_original_worker_monitor", state: "current" })
  ]),
  monitor_resumption: Object.freeze({
    tools: Object.freeze(["workspace_agent_run_status"]),
    subject_source: "canonical_integrated_slice",
    subject_included: false,
    instruction: "Observe the canonical slice subject; include attempt_id only when status reports ambiguity."
  })
});

export function createBackendIntegration(ctx) {
  const {
    worktreeProvisioningConfig,
    reviewContextRunGit,
    postWorkerLifecycleRunGit,
    sliceIntegrationCcePolicy,
    frozenSliceReviewContexts,
    canonicalCommittedSliceIntegration,
    canonicalCommittedSliceIntegrations,
    canonicalCommittedSliceIntegrationAttempts,
    committedSliceIntegrationTargetKey
  } = ctx;
  const capabilityProbeRunGit = typeof postWorkerLifecycleRunGit === "function" &&
    postWorkerLifecycleRunGit !== reviewContextRunGit
    ? postWorkerLifecycleRunGit
    : defaultRunGitAsync;
  const canonicalCommittedSliceIntegrationsByDelivery =
    ctx.canonicalCommittedSliceIntegrationsByDelivery ?? new Map();
  const { resolveDurableIntegrationContinuation, resolveLiveCompletedIntegration } =
    createBackendIntegrationContinuation({
      ...ctx,
      canonicalCommittedSliceIntegrationsByDelivery
    });

  async function resolveCurrentIntegrationBinding({ context }) {
    const record = JSON.parse(context.canonical_parent_wk_contract);
    const recordSourceDigest = computeWorkRecordSourceDigest(record);
    const wkRef = `refs/heads/wk/${context.initiative}/${context.record_id}`;
    const wkTipSha = await revParse(reviewContextRunGit, context.main_repo, wkRef);
    const observation = await boundedWkLifecycleObservation({
      runGit: reviewContextRunGit,
      mainRepo: context.main_repo,
      initiative: context.initiative,
      wkId: context.record_id,
      wkTipSha,
      recordSourceDigest
    });
    const current = await assertWkLifecycleObservationCurrent({
      observation,
      runGit: reviewContextRunGit,
      mainRepo: context.main_repo,
      wkTipSha,
      recordSourceDigest
    });
    if (current.current !== true) {
      const error = new Error("committed-slice integration binding is stale");
      error.code = "agent_launch.slice_integration.current_binding_stale.v1";
      error.detail = Object.freeze({
        reason: current.reason,
        wk_tip_sha: wkTipSha,
        contract_generation: observation.contract_generation
      });
      throw error;
    }
    return Object.freeze({
      schema_version: "workspace-agent-committed-slice-integration-binding.v1",
      wk_ref: wkRef,
      wk_tip_sha: wkTipSha,
      record_source_digest: recordSourceDigest,
      contract_generation: readCanonicalContractGenerationIdentity(
        context.main_repo,
        context.record_id
      ),
      observation
    });
  }

  const bindingRefusal = (error) => classifiedNonIntegratedResult(Object.freeze({
    integrated: false,
    refused: true,
    refusal: Object.freeze({
      schema_version: "slice-integration-binding-refusal.v1",
      code: error?.code ?? "agent_launch.slice_integration.current_binding_unavailable.v1",
      reason: error?.detail?.reason ?? error?.message ?? "current integration binding unavailable",
      detail: error?.detail ?? null,
      evidence: captureDiagnosticEvidence(error)
    })
  }));

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
          {
            diagnostic_code: typeof error?.code === "string" ? error.code : null,
            evidence: captureDiagnosticEvidence(error)
          }
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
    let decisionBytes;
    let serializationEvidence = null;
    try {
      decisionBytes = Buffer.byteLength(JSON.stringify(decision), "utf8");
    } catch (error) {

      decisionBytes = CCE_POLICY_DECISION_MAX_BYTES + 1;
      serializationEvidence = captureDiagnosticEvidence(error);
    }
    if (decisionBytes > CCE_POLICY_DECISION_MAX_BYTES) {
      return {
        ok: false,
        refusal: ccePolicyRefusal(
          CCE_POLICY_REFUSAL_CODES.OVERSIZED,
          "configured CCE policy returned an oversized decision",
          {
            observed_bytes: decisionBytes,
            max_bytes: CCE_POLICY_DECISION_MAX_BYTES,
            ...(serializationEvidence === null ? {} : { serialization_evidence: serializationEvidence })
          }
        )
      };
    }
    if (!hasExactKeys(decision, CCE_BOUNDARY_POLICY_DECISION_FIELDS) ||
        decision.schema_version !== CCE_BOUNDARY_POLICY_DECISION_SCHEMA_VERSION ||
        decision.operation !== "integrate_committed_slice" ||
        !new Set(["allow", "deny"]).has(decision.decision) ||
        typeof decision.policy_id !== "string" || decision.policy_id.length === 0 ||
        decision.policy_id.length > CCE_POLICY_ID_MAX_CHARS ||
        typeof decision.decision_id !== "string" || decision.decision_id.length === 0 ||
        decision.decision_id.length > CCE_POLICY_ID_MAX_CHARS ||
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

  function recordReconciliationWriter({ retainedContext, cceConfigured, dispositions }) {
    return async ({ record, expectedSourceDigest }) => {
      if (retainedContext !== null) {
        const recoveryEvidence = emptySliceReviewAdvisoryEvidence(retainedContext);
        const policy = await resolveSliceIntegrationBoundaryAuthorization({
          context: retainedContext,
          evidence: recoveryEvidence,
          orchestratorDispositions: cceConfigured
            ? normalizeAdvisoryDispositions(dispositions, recoveryEvidence)
            : null
        });
        if (policy.ok !== true) {
          throw Object.assign(new Error("committed-slice policy refused integration"), {
            refusal: classifiedNonIntegratedResult(policy.refusal)
          });
        }
        try {
          await resolveCurrentIntegrationBinding({ context: retainedContext });
        } catch (error) {
          throw Object.assign(new Error("current integration binding unavailable"), {
            refusal: bindingRefusal(error)
          });
        }
      } else if (cceConfigured) {
        throw Object.assign(new Error("configured CCE policy has no retained exact target"), {
          refusal: classifiedNonIntegratedResult(ccePolicyRefusal(
            CCE_POLICY_REFUSAL_CODES.MISSING,
            "configured CCE policy has no retained exact admitted target to authorize " +
              "canonical record reconciliation"
          ))
        });
      }
      return writeValidatedWorkRecord({
        dir: worktreeProvisioningConfig.mainRepo,
        record,
        expectedSourceDigest
      });
    };
  }

  async function reconcileAlreadyIntegratedDelivery({
    subject,
    retainedContext,
    cceConfigured,
    dispositions
  }) {
    let unit;
    try {
      unit = resolveCanonicalSliceIntegrationUnit(worktreeProvisioningConfig.mainRepo, subject);
    } catch {

      return { result: null, evidence: null };
    }
    let reconciled;
    try {
      const unitAddress = `${unit.initiative}/${unit.record_id}/${unit.slice_id}`;
      reconciled = await reconcileIntegratedSliceRecordOnly({
        mainRepo: worktreeProvisioningConfig.mainRepo,
        unitAddress,
        sliceRef: `refs/heads/slice/${unitAddress}`,
        wkRef: `refs/heads/wk/${unit.initiative}/${unit.record_id}`,
        writeRecordCas: recordReconciliationWriter({
          retainedContext: retainedContext?.review_admission_kind === "canonical_committed_slice"
            ? retainedContext
            : null,
          cceConfigured,
          dispositions
        }),
        deps: { runGit: reviewContextRunGit }
      });
    } catch (error) {
      return { result: null, evidence: captureDiagnosticEvidence(error) };
    }

    if (reconciled === null ||
        reconciled.record_reconciliation?.state === INTEGRATED_RECORD_RECONCILIATION_STATES.RECONCILED &&
        reconciled.record_reconciliation?.repaired !== true) {
      return { result: null, evidence: null };
    }
    return {
      result: classifiedNonIntegratedResult(Object.freeze({
        ...reconciled,
        closeout_continuation: INTEGRATION_CLOSEOUT_CONTINUATION
      })),
      evidence: null
    };
  }

  async function requestCommittedSliceIntegration({ subject, dispositions } = {}) {
    if (worktreeProvisioningConfig === null || worktreeProvisioningConfig === undefined) {
      return classifiedNonIntegratedResult(Object.freeze({
        integrated: false,
        reason: "canonical_committed_slice_integration_unavailable",
        code: "agent_launch.slice_integration.backend_unavailable.v1"
      }));
    }
    if (!EXACT_IMPLEMENTATION_SLICE_RE.test(subject ?? "")) {
      return classifiedNonIntegratedResult(Object.freeze({
        integrated: false,
        reason: "canonical committed-slice integration subject is invalid",
        code: "agent_launch.slice_integration.invalid_arg.v1"
      }));
    }
    const cceConfigured = isPlainObject(sliceIntegrationCcePolicy) &&
      sliceIntegrationCcePolicy.configured === true;
    let retainedRecoveryEvidence = null;

    const withRetainedRecoveryEvidence = (result) =>
      retainedRecoveryEvidence === null || result?.integrated === true
        ? result
        : classifiedNonIntegratedResult(Object.freeze({
          ...result,
          retained_recovery_evidence: retainedRecoveryEvidence
        }));
    let context;
    const retainedContext = frozenSliceReviewContexts.get(subject) ?? null;

    const alreadyIntegrated = await reconcileAlreadyIntegratedDelivery({
      subject,
      retainedContext,
      cceConfigured,
      dispositions
    });
    if (alreadyIntegrated.result !== null) return alreadyIntegrated.result;
    retainedRecoveryEvidence = alreadyIntegrated.evidence;
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
      const result = withRetainedRecoveryEvidence(nonIntegratedFromError(
        error,
        "canonical_committed_slice_integration_unavailable"
      ));

      const correction = committedSliceScopeRefusalCorrection(error);
      return correction === null ? result : registerRetryFacts(result, { subject, correction });
    }

    const evidence = emptySliceReviewAdvisoryEvidence(context);

    const orchestratorDispositions = cceConfigured
      ? normalizeAdvisoryDispositions(dispositions, evidence)
      : null;
    if (canonicalCommittedSliceIntegration === null) {
      return withRetainedRecoveryEvidence(classifiedNonIntegratedResult({
        integrated: false,
        reason: "canonical committed-slice integration adapter is unavailable",
        code: "agent_launch.slice_integration.integration_backend_unavailable.v1"
      }));
    }
    const key = committedSliceIntegrationTargetKey(context);
    if (canonicalCommittedSliceIntegrations.has(key)) {
      return withRetainedRecoveryEvidence(await canonicalCommittedSliceIntegrations.get(key));
    }
    if (!canonicalCommittedSliceIntegrationAttempts.has(key)) {
      const attempt = (async () => {
        const policy = await resolveSliceIntegrationBoundaryAuthorization({
          context,
          evidence,
          orchestratorDispositions
        });
        if (policy.ok !== true) return classifiedNonIntegratedResult(policy.refusal);
        const writeCurrentRecordCas = async ({ record, expectedSourceDigest }) => {
          try {
            await resolveCurrentIntegrationBinding({ context });
          } catch (error) {
            throw Object.assign(new Error("current integration binding unavailable"), {
              refusal: bindingRefusal(error)
            });
          }
          return writeValidatedWorkRecord({
            dir: worktreeProvisioningConfig.mainRepo,
            record,
            expectedSourceDigest
          });
        };
        let recovered;
        try {
          recovered = await recoverZeroDeltaIntegratedSlice({
            mainRepo: worktreeProvisioningConfig.mainRepo,
            unitAddress: `${context.initiative}/${context.record_id}/${context.review_slice_id}`,
            sliceRef: context.slice_ref,
            wkRef: `refs/heads/wk/${context.initiative}/${context.record_id}`,
            writeRecordCas: writeCurrentRecordCas,
            deps: { runGit: reviewContextRunGit }
          });
        } catch (error) {
          if (error?.refusal !== undefined) return error.refusal;
          throw error;
        }
        if (recovered !== null) {
          return classifiedNonIntegratedResult(Object.freeze({
            ...recovered,
            closeout_continuation: INTEGRATION_CLOSEOUT_CONTINUATION
          }));
        }
        let integrationBinding;
        try {
          integrationBinding = await resolveCurrentIntegrationBinding({ context });
        } catch (error) {
          return bindingRefusal(error);
        }
        const integration = await canonicalCommittedSliceIntegration({
          context: Object.freeze({ ...context, integration_binding: integrationBinding }),
          boundaryAuthorization: policy.authorization
        });
        const result = classifiedNonIntegratedResult(Object.freeze({
          ...integration,
          advisory_review_evidence: evidence,
          orchestrator_dispositions: orchestratorDispositions,
          ...(integration?.integrated === true
            ? { closeout_continuation: INTEGRATION_CLOSEOUT_CONTINUATION }
            : {})
        }));

        if (result?.integrated === true && result.record_reconciliation !== undefined &&
            result.record_reconciliation?.state !== INTEGRATED_RECORD_RECONCILIATION_STATES.RECONCILED) {
          return result;
        }
        const settled = Promise.resolve(result);
        canonicalCommittedSliceIntegrations.set(key, settled);
        if (result?.integrated === true) {
          canonicalCommittedSliceIntegrationsByDelivery.set(
            committedSliceIntegrationDeliveryKey(context),
            settled
          );
        }
        return result;
      })();
      canonicalCommittedSliceIntegrationAttempts.set(key, attempt);
    }
    try {
      return withRetainedRecoveryEvidence(await canonicalCommittedSliceIntegrationAttempts.get(key));
    } catch (error) {
      const result = withRetainedRecoveryEvidence(nonIntegratedFromError(
        error,
        "canonical committed-slice integration failed"
      ));
      const correction = explicitBaseMergeTreeCapabilityCorrection(error);
      return correction === null ? result : registerRetryFacts(result, { subject, correction });
    } finally {
      canonicalCommittedSliceIntegrationAttempts.delete(key);
    }
  }

  async function resolveCommittedSliceIntegrationContinuation({
    subject,
    status,
    live_completion_only: liveCompletionOnly = false
  } = {}) {
    const context = frozenSliceReviewContexts.get(subject) ?? null;
    if (context !== null) {
      const completed = canonicalCommittedSliceIntegrations.get(
        committedSliceIntegrationTargetKey(context)
      );
      if (completed !== undefined) {
        if (status?.subject !== context.source_worker_subject ||
            status?.run_id !== context.source_worker_run_id ||
            status?.monitor_handle !== context.source_worker_monitor_handle) {
          continuationRefusal("warm_worker_tuple_mismatch", {
            expected_subject: context.source_worker_subject ?? null,
            actual_subject: status?.subject ?? null,
            expected_run_id: context.source_worker_run_id ?? null,
            actual_run_id: status?.run_id ?? null,
            expected_monitor_handle: context.source_worker_monitor_handle ?? null,
            actual_monitor_handle: status?.monitor_handle ?? null
          });
        }
        const integration = await completed;
        return brandedContinuation({
          requested: true,
          completed: integration?.integrated === true,
          reviewed_sha: context.reviewed_sha,
          ...(integration?.integrated === true ? { integration } : {})
        });
      }
    }
    const liveCompletion = await resolveLiveCompletedIntegration({ subject, status });
    if (liveCompletion !== null) return liveCompletion;
    if (liveCompletionOnly === true) return null;
    return resolveDurableIntegrationContinuation({ subject, status });
  }

  async function assessCommittedSliceIntegrationRetry({ subject, status, facts } = {}) {
    const unknown = (reason, evidence = null) => Object.freeze({
      decision: COMMITTED_SLICE_INTEGRATION_RETRY_DECISIONS.UNKNOWN,
      reason,
      grants_authority: false,
      ...(evidence === null ? {} : { evidence })
    });
    if (!RETRY_FACTS_BRAND.has(facts) || facts.subject !== subject ||
        !EXACT_IMPLEMENTATION_SLICE_RE.test(subject ?? "")) {
      return unknown("retry_facts_unauthenticated");
    }
    if (worktreeProvisioningConfig === null || worktreeProvisioningConfig === undefined) {
      return unknown("integration_backend_unavailable");
    }

    try {
      const continuation = await resolveCommittedSliceIntegrationContinuation({
        subject, status, live_completion_only: true
      });
      if (continuation?.completed === true) {
        return Object.freeze({
          decision: COMMITTED_SLICE_INTEGRATION_RETRY_DECISIONS.COMPLETED,
          grants_authority: false
        });
      }
    } catch (error) {
      return unknown("completion_observation_failed", captureDiagnosticEvidence(error));
    }
    if (facts.correction_condition === EXPLICIT_BASE_MERGE_TREE_CORRECTION_CONDITION) {
      if (facts.decision_inputs?.repository !== worktreeProvisioningConfig.mainRepo) {
        return unknown("correction_assessment_repository_mismatch");
      }
      const capability = await assessExplicitBaseMergeTreeCapability({
        runGit: capabilityProbeRunGit,
        repo: worktreeProvisioningConfig.mainRepo
      });
      if (capability.state === "indeterminate") {
        return unknown("correction_assessment_failed", capability.diagnostic);
      }
      if (capability.state === "unsupported") {
        return Object.freeze({
          decision: COMMITTED_SLICE_INTEGRATION_RETRY_DECISIONS.UNCHANGED,
          correction_condition: facts.correction_condition,
          reason: facts.reason,
          evidence: capability.diagnostic,
          grants_authority: false
        });
      }
      return Object.freeze({
        decision: COMMITTED_SLICE_INTEGRATION_RETRY_DECISIONS.CHANGED,
        correction_condition: facts.correction_condition,
        changed_inputs: Object.freeze(["git_capability"]),
        evidence: capability.diagnostic,
        grants_authority: false
      });
    }
    let current;
    try {
      const unit = resolveCanonicalSliceIntegrationUnit(worktreeProvisioningConfig.mainRepo, subject);
      current = resolveCommittedSliceScopeDecisionInputs({
        mainRepo: worktreeProvisioningConfig.mainRepo,
        subject,
        reviewUnit: unit,
        runGit: reviewContextRunGit
      }).decision_inputs;
    } catch (error) {
      return unknown("correction_assessment_failed", captureDiagnosticEvidence(error));
    }
    const changed = sameDecisionInputs(facts.decision_inputs, current);
    if (changed.length === 0) {
      return Object.freeze({
        decision: COMMITTED_SLICE_INTEGRATION_RETRY_DECISIONS.UNCHANGED,
        correction_condition: facts.correction_condition,
        reason: facts.reason,
        grants_authority: false
      });
    }

    if (changed.includes("write_scope")) {
      let offending;
      let allocated;
      try {
        const pair = resolveUniqueManagedLifecycleBindingPairForRecovery({
          mainRepo: worktreeProvisioningConfig.mainRepo,
          launchRef: status?.monitor_handle,
          expectedSubject: subject,
          allowMissingSliceWorktree: true
        });
        allocated = pair?.slice_binding?.write_scope;
        if (!pair || pair.run_id !== status?.run_id ||
            pair.slice_binding.launch_ref !== status?.monitor_handle || !Array.isArray(allocated)) {
          return unknown("allocated_scope_unavailable");
        }
        offending = resolveCommittedSliceScopeOffenders({
          mainRepo: worktreeProvisioningConfig.mainRepo,
          writeScope: allocated,
          diffBaseSha: current.diff_base_sha,
          reviewedSha: current.reviewed_sha,
          runGit: reviewContextRunGit
        });
      } catch (error) {
        return unknown("allocated_scope_unavailable", captureDiagnosticEvidence(error));
      }
      if (offending.length > 0) {
        return Object.freeze({
          decision: COMMITTED_SLICE_INTEGRATION_RETRY_DECISIONS.OUTSIDE_ALLOCATION,
          correction_condition: facts.correction_condition,
          reason: facts.reason,
          changed_inputs: changed,
          allocated_write_scope: Object.freeze([...allocated]),
          offending_paths: offending,
          grants_authority: false
        });
      }
    }
    return Object.freeze({
      decision: COMMITTED_SLICE_INTEGRATION_RETRY_DECISIONS.CHANGED,
      correction_condition: facts.correction_condition,
      changed_inputs: changed,
      grants_authority: false
    });
  }

  async function rederiveCommittedSliceIntegrationRefusal({ subject, status } = {}) {
    const withheld = (decision, fields) => Object.freeze({
      decision,
      grants_authority: false,
      ...fields
    });
    if (!EXACT_IMPLEMENTATION_SLICE_RE.test(subject ?? "") || status?.subject !== subject) {
      return withheld(COMMITTED_SLICE_INTEGRATION_RETRY_DECISIONS.UNKNOWN, {
        reason: "retry_subject_invalid"
      });
    }
    if (worktreeProvisioningConfig === null || worktreeProvisioningConfig === undefined) {
      return withheld(COMMITTED_SLICE_INTEGRATION_RETRY_DECISIONS.UNKNOWN, {
        reason: "integration_backend_unavailable"
      });
    }
    try {
      const unit = resolveCanonicalSliceIntegrationUnit(worktreeProvisioningConfig.mainRepo, subject);
      resolveCommittedSliceReviewAdmission({
        mainRepo: worktreeProvisioningConfig.mainRepo,
        worktreeRoot: worktreeProvisioningConfig.worktreeRoot,
        subject,
        reviewUnit: unit,
        requireWorktree: false,
        runGit: reviewContextRunGit
      });
    } catch (error) {
      return withheld(COMMITTED_SLICE_INTEGRATION_RETRY_DECISIONS.CURRENT_REFUSAL, {
        reason: error?.detail?.reason ?? null,
        code: typeof error?.code === "string" ? error.code : null,
        evidence: captureDiagnosticEvidence(error)
      });
    }
    return withheld(COMMITTED_SLICE_INTEGRATION_RETRY_DECISIONS.CORRECTION_UNESTABLISHED, {
      reason: "retained_failure_correction_facts_not_durable",
      missing_evidence: "the producer-owned correction facts of the retained failure",
      owner: "committed-slice integration retry facts " +
        "(workspace-agent-dispatch-backend-integration), retained in process memory only",
      current_admission: "passed"
    });
  }

  return {
    resolveSliceIntegrationBoundaryAuthorization,
    requestCommittedSliceIntegration,
    resolveCommittedSliceIntegrationContinuation,
    assessCommittedSliceIntegrationRetry,
    rederiveCommittedSliceIntegrationRefusal
  };
}
