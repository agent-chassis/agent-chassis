

import { createHash } from "node:crypto";
import path from "node:path";
import { canonicalizeWorkRecordJson } from "@agent-chassis/wiki-core";
import {
  isPlainObject,
  createTrustedFrozenReviewContract,
  assertRetainedReviewerLaunchIdentityMatchesContext
} from "./backend-review-identity.mjs";
import {
  assertAdmissibleLiveTerminalReviewCoordination,
  assertFrozenReviewTarget,
  deepFreezeCanonicalSnapshot,
  isTerminalReviewLifecycleRefusal,
  normalizeAuthenticatedTerminalReviewLifecycleDelta,
  resolveCanonicalTerminalReviewCoordinationState,
  terminalReviewLifecycleRefusal,
  verifyFrozenWkReviewTargetAgainstObjectStore
} from "./backend-scope-authority.mjs";
import {
  managedRefusal,
  MANAGED_LIFECYCLE_REQUIRED
} from "./backend-provisioning-state.mjs";
import {
  assertTerminalCandidateMaterialization,
  verifyTerminalCandidateCheckout
} from "./terminal-review-materialization.mjs";
import {
  TERMINAL_WK_CANDIDATE_CODES,
  TERMINAL_WK_CANDIDATE_SCHEMA_VERSION_V3,
  verifyTerminalWkCandidateObjectBinding
} from "./terminal-wk-candidate.mjs";
import { assertSelectedDependencyMountIntegrity } from "./terminal-wk-candidate-validation.mjs";
import { deriveBackendReviewResult } from "./workspace-agent-dispatch-review-result.mjs";
import {
  projectAuthenticatedTerminalCandidateFailure
} from "@agent-chassis/wiki-mcp/src/lib/dispatch-terminal-candidate-runtime.mjs";

const TERMINAL_REVIEW_ATTEMPT_CONTRACT_SCHEMA_VERSION =
  "agent_launch.terminal_review_attempt_contract.v1";

const TERMINAL_CANDIDATE_FAILURE_PROJECTION_SCHEMA_VERSION =
  "agent_launch.terminal_candidate_failure_projection.v1";
const TERMINAL_CANDIDATE_TYPED_FAILURE_MESSAGE =
  "terminal WK candidate: typed construction or recovery failure";
const TERMINAL_CANDIDATE_UNKNOWN_FAILURE_MESSAGE =
  "terminal WK candidate: unknown construction or recovery failure";
const TERMINAL_CANDIDATE_FAILURE_PROJECTION_KEYS = Object.freeze([
  "schema_version",
  "kind",
  "code",
  "message",
  "detail"
]);
const TERMINAL_CANDIDATE_GIT_DETAIL_KEYS = Object.freeze([
  "git_operation",
  "git_status"
]);
const TERMINAL_CANDIDATE_GIT_OPERATIONS = Object.freeze(new Set([
  "rev-parse",
  "rev-list",
  "cat-file",
  "commit-tree",
  "for-each-ref",
  "update-ref",
  "merge-base"
]));
const TERMINAL_CANDIDATE_FAILURE_CODES = Object.freeze(
  new Set(Object.values(TERMINAL_WK_CANDIDATE_CODES))
);
const UNKNOWN_TERMINAL_CANDIDATE_FAILURE_PROJECTION = Object.freeze({
  schema_version: TERMINAL_CANDIDATE_FAILURE_PROJECTION_SCHEMA_VERSION,
  kind: "unknown_cause",
  code: null,
  message: TERMINAL_CANDIDATE_UNKNOWN_FAILURE_MESSAGE,
  detail: null
});

function exactEnumerableDataProperties(value, expectedKeys) {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value) ||
        Object.getPrototypeOf(value) !== Object.prototype) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== expectedKeys.length ||
        keys.some((key) => typeof key !== "string" || !expectedKeys.includes(key))) return null;
    const properties = Object.create(null);
    for (const key of expectedKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || descriptor.enumerable !== true ||
          !Object.prototype.hasOwnProperty.call(descriptor, "value")) return null;
      properties[key] = descriptor.value;
    }
    return properties;
  } catch {
    return null;
  }
}

function closedTerminalCandidateGitDetail(value, code) {
  if (value === null) return null;
  const detail = exactEnumerableDataProperties(value, TERMINAL_CANDIDATE_GIT_DETAIL_KEYS);
  if (detail === null ||
      !TERMINAL_CANDIDATE_GIT_OPERATIONS.has(detail.git_operation) ||
      !(detail.git_status === null ||
        (Number.isInteger(detail.git_status) && detail.git_status >= 0 && detail.git_status <= 255)) ||
      (code === TERMINAL_WK_CANDIDATE_CODES.BASE_INVALID &&
        detail.git_operation !== "merge-base")) return undefined;
  return Object.freeze({
    git_operation: detail.git_operation,
    git_status: detail.git_status
  });
}

function closedTerminalCandidateFailureProjection(value) {
  const projection = exactEnumerableDataProperties(
    value,
    TERMINAL_CANDIDATE_FAILURE_PROJECTION_KEYS
  );
  if (projection === null ||
      projection.schema_version !== TERMINAL_CANDIDATE_FAILURE_PROJECTION_SCHEMA_VERSION) {
    return UNKNOWN_TERMINAL_CANDIDATE_FAILURE_PROJECTION;
  }
  if (projection.kind === "unknown_cause" && projection.code === null &&
      projection.message === TERMINAL_CANDIDATE_UNKNOWN_FAILURE_MESSAGE &&
      projection.detail === null) return UNKNOWN_TERMINAL_CANDIDATE_FAILURE_PROJECTION;
  if (projection.kind !== "typed_candidate_error" ||
      !TERMINAL_CANDIDATE_FAILURE_CODES.has(projection.code) ||
      projection.message !== TERMINAL_CANDIDATE_TYPED_FAILURE_MESSAGE) {
    return UNKNOWN_TERMINAL_CANDIDATE_FAILURE_PROJECTION;
  }
  const detailAllowed = projection.code === TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED ||
    projection.code === TERMINAL_WK_CANDIDATE_CODES.BASE_INVALID;
  if (!detailAllowed && projection.detail !== null) {
    return UNKNOWN_TERMINAL_CANDIDATE_FAILURE_PROJECTION;
  }
  const detail = detailAllowed
    ? closedTerminalCandidateGitDetail(projection.detail, projection.code)
    : null;
  if (detail === undefined) return UNKNOWN_TERMINAL_CANDIDATE_FAILURE_PROJECTION;
  return Object.freeze({
    schema_version: TERMINAL_CANDIDATE_FAILURE_PROJECTION_SCHEMA_VERSION,
    kind: "typed_candidate_error",
    code: projection.code,
    message: TERMINAL_CANDIDATE_TYPED_FAILURE_MESSAGE,
    detail
  });
}

function terminalCandidateFailureFromThrown(error) {

  return closedTerminalCandidateFailureProjection(
    projectAuthenticatedTerminalCandidateFailure(error)
  );
}

export function createBackendTerminalReview(ctx) {
  const {
    frozenSliceReviewContexts,
    frozenReviewContexts,
    worktreeProvisioningConfig,
    reviewContextRunGit,
    recoverTerminalCandidate,
    terminalCandidateRecoveryInFlight,
    currentTerminalReviewTargetByWk,
    frozenReviewContextsByTarget,
    wholeReviewRunContexts,
    runs,
    wholeReviewTargetKey,
    terminalReviewAttemptContracts,
    terminalReviewAttemptContractBySubject
  } = ctx;

  const structuredReceiptOutcome = (record) => ctx.structuredReceiptOutcome(record);

  function terminalReviewLifecycleManagedRefusal(error, subject) {
    const lifecycle = error?.terminal_review_lifecycle ?? null;
    return managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
      capability: "wk_context_review",
      reason: "terminal_review_lifecycle_state_inadmissible",
      lifecycle_reason: lifecycle?.reason ?? "terminal_review_lifecycle_unknown",
      subject: subject ?? null,
      exact_candidate_unchanged: true,
      message: error?.message ?? String(error),
      ...(lifecycle?.detail ? { lifecycle_detail: lifecycle.detail } : {})
    });
  }

  function isReconstructedCurrentRecordProjection(binding, unit) {
    return isPlainObject(binding) && Object.isFrozen(binding) &&
      binding.schema_version === TERMINAL_WK_CANDIDATE_SCHEMA_VERSION_V3 &&
      unit.contract_source === "canonical_current_record" &&
      typeof binding.terminal_review_subject === "string" &&
      typeof binding.terminal_review_contract_digest === "string" &&
      unit.subject === binding.terminal_review_subject &&
      unit.record_id === binding.canonical_wk_id &&
      typeof unit.slice_id === "string" &&
      unit.subject === `${unit.record_id}#${unit.slice_id}`;
  }

  function historicalTerminalReviewEvidence(terminalCandidate) {
    const unit = terminalCandidate?.review_unit ?? null;
    if (unit === null || unit === undefined) return null;
    if (!isPlainObject(unit) ||
        typeof unit.canonical_parent_wk_contract !== "string" ||
        typeof unit.review_unit_contract !== "string") {
      throw terminalReviewLifecycleRefusal("historical_review_evidence_is_not_launcher_owned");
    }
    if (isReconstructedCurrentRecordProjection(terminalCandidate.binding, unit)) return null;
    if (unit.contract_source !== "exact_candidate_tree") {
      throw terminalReviewLifecycleRefusal("historical_review_evidence_is_not_launcher_owned");
    }
    return Object.freeze({
      source: "exact_candidate_tree",
      contract_digest: terminalCandidate.binding?.canonical_wk_digest ?? null,
      canonical_parent_wk_contract: unit.canonical_parent_wk_contract,
      review_unit_contract: unit.review_unit_contract
    });
  }

  function authenticateTerminalReviewCoordination({
    binding,
    checkoutPath,
    historicalEvidence,
    address
  }) {
    if (worktreeProvisioningConfig?.mainRepo == null) {
      throw terminalReviewLifecycleRefusal("launcher_owned_canonical_repository_unavailable");
    }
    const live = resolveCanonicalTerminalReviewCoordinationState(
      worktreeProvisioningConfig.mainRepo,
      address.record_id
    );
    const liveUnit = live.unit;
    if (liveUnit.subject !== address.subject || liveUnit.record_id !== address.record_id ||
        liveUnit.slice_id !== address.slice_id || liveUnit.initiative !== address.initiative) {
      throw terminalReviewLifecycleRefusal("live_terminal_review_unit_identity_mismatch", {
        addressed_subject: address.subject ?? null,
        live_subject: liveUnit.subject ?? null
      });
    }
    const liveStatuses = assertAdmissibleLiveTerminalReviewCoordination({
      liveParentContract: liveUnit.canonical_parent_wk_contract,
      recordId: address.record_id,
      reviewSliceId: address.slice_id
    });
    const transitions = historicalEvidence === null
      ? null
      : normalizeAuthenticatedTerminalReviewLifecycleDelta({
          historicalParentContract: historicalEvidence.canonical_parent_wk_contract,
          liveParentContract: liveUnit.canonical_parent_wk_contract,
          recordId: address.record_id,
          reviewSliceId: address.slice_id
        });
    const keyed = {
      schema_version: TERMINAL_REVIEW_ATTEMPT_CONTRACT_SCHEMA_VERSION,
      review_subject: address.subject,
      record_id: address.record_id,
      review_slice_id: address.slice_id,
      initiative: address.initiative,
      repository_digest: binding?.repository?.digest ?? null,
      candidate_ref: binding?.candidate_ref ?? null,
      candidate_sha: binding?.candidate ?? null,
      candidate_tree: binding?.candidate_tree ?? null,
      candidate_parent: binding?.candidate_parent ?? null,
      base_ref: binding?.base_ref ?? null,
      base_sha: binding?.base ?? null,
      wk_ref: binding?.wk_ref ?? null,
      wk_sha: binding?.wk_tip ?? null,
      private_candidate_checkout: checkoutPath ?? null,
      historical_contract_digest: historicalEvidence?.contract_digest ?? binding?.canonical_wk_digest ?? null,
      historical_contract_source: historicalEvidence?.source ?? null,
      live_contract_digest: live.source_digest,
      live_parent_status: liveStatuses.parent_status,
      live_review_unit_status: liveStatuses.review_unit_status,
      authenticated_transitions: transitions
    };
    const contract = deepFreezeCanonicalSnapshot({
      ...keyed,
      contract_identity: `sha256:${createHash("sha256")
        .update(canonicalizeWorkRecordJson(keyed))
        .digest("hex")}`
    });
    return { liveUnit, contract };
  }

  function registerTerminalReviewAttemptContract({ contract, rederive }) {
    const existing = terminalReviewAttemptContracts.get(contract.contract_identity) ?? null;
    if (existing !== null) return existing.contract;
    const previous = terminalReviewAttemptContractBySubject.get(contract.review_subject);
    if (previous !== undefined && previous !== contract.contract_identity) {
      terminalReviewAttemptContracts.delete(previous);
    }
    terminalReviewAttemptContracts.set(
      contract.contract_identity,
      Object.freeze({ contract, rederive })
    );
    terminalReviewAttemptContractBySubject.set(contract.review_subject, contract.contract_identity);
    return contract;
  }

  function deriveRetainedTerminalReviewAttemptContract({ binding, checkoutPath, historicalEvidence, address }) {
    const derivation = () => authenticateTerminalReviewCoordination({
      binding,
      checkoutPath,
      historicalEvidence,
      address
    });
    const authenticated = derivation();
    return {
      liveUnit: authenticated.liveUnit,
      contract: registerTerminalReviewAttemptContract({
        contract: authenticated.contract,
        rederive: () => derivation().contract
      })
    };
  }

  function verifyTerminalReviewAttemptContractAtSpawn(contract) {
    if (!isPlainObject(contract) || typeof contract.contract_identity !== "string") {
      return { ok: false, reason: "terminal_review_attempt_contract_malformed" };
    }
    const retained = terminalReviewAttemptContracts.get(contract.contract_identity) ?? null;

    if (retained === null || retained.contract !== contract) {
      return {
        ok: false,
        reason: "terminal_review_attempt_contract_unretained",
        detail: { review_subject: contract.review_subject ?? null }
      };
    }
    let rederived;
    try {
      rederived = retained.rederive();
    } catch (error) {
      return {
        ok: false,
        reason: isTerminalReviewLifecycleRefusal(error)
          ? "terminal_review_lifecycle_state_inadmissible"
          : "terminal_review_attempt_contract_recheck_failed",
        detail: {
          review_subject: contract.review_subject ?? null,
          lifecycle_reason: error?.terminal_review_lifecycle?.reason ?? null,
          exact_candidate_unchanged: true
        }
      };
    }
    if (rederived.contract_identity !== contract.contract_identity) {
      return {
        ok: false,
        reason: "terminal_review_canonical_state_changed_before_spawn",
        detail: {
          review_subject: contract.review_subject ?? null,
          expected_contract_identity: contract.contract_identity,
          live_contract_identity: rederived.contract_identity,
          exact_candidate_unchanged: true
        }
      };
    }
    return { ok: true };
  }

  function refreshTerminalReviewAttemptContract(context) {
    const address = {
      subject: context.review_subject,
      record_id: context.record_id,
      slice_id: context.review_slice_id,
      initiative: context.initiative
    };
    let refreshed;
    try {
      refreshed = deriveRetainedTerminalReviewAttemptContract({
        binding: context.terminal_candidate_binding,
        checkoutPath: context.terminal_candidate_materialization?.checkout_path ?? null,
        historicalEvidence: context.historical_terminal_review_evidence ?? null,
        address
      });
    } catch (error) {
      if (!isTerminalReviewLifecycleRefusal(error)) throw error;
      return { ok: false, refusal: terminalReviewLifecycleManagedRefusal(error, address.subject) };
    }
    if (refreshed.contract.contract_identity ===
        context.terminal_review_attempt_contract?.contract_identity) {
      return { ok: true, context };
    }
    const rebound = Object.freeze({
      ...context,
      canonical_parent_wk_contract: refreshed.liveUnit.canonical_parent_wk_contract,
      review_unit_contract: refreshed.liveUnit.review_unit_contract,
      trusted_frozen_review_contract: createTrustedFrozenReviewContract(refreshed.liveUnit),
      terminal_review_attempt_contract: refreshed.contract
    });
    frozenReviewContexts.set(rebound.review_subject, rebound);
    return { ok: true, context: rebound };
  }

  function sameTerminalReviewAddress(left, right) {
    return left?.subject === (right?.subject ?? right?.review_subject) &&
      left?.record_id === right?.record_id &&
      left?.slice_id === (right?.slice_id ?? right?.review_slice_id);
  }

  function terminalCandidateReviewTarget(terminalCandidate) {
    const binding = terminalCandidate?.binding;
    const materialization = terminalCandidate?.materialization;
    return Object.freeze({
      schema_version: "agent_launch.terminal_candidate_review_target.v1",
      review_identity_kind: "terminal_candidate",
      ref: binding?.candidate_ref,
      sha: binding?.candidate,
      candidate_ref: binding?.candidate_ref,
      candidate_sha: binding?.candidate,
      base_ref: binding?.base_ref,
      base_sha: binding?.base,
      wk_ref: binding?.wk_ref,
      wk_sha: binding?.wk_tip,
      worktree_path: materialization?.checkout_path,
      canonical_wk_digest: binding?.canonical_wk_digest,
      diff_base_sha: binding?.base,
      diff_head_sha: binding?.candidate,
      diff_range: `${binding?.base}..${binding?.candidate}`,
      complete_parent_wk_contract: true,
      accumulated_wk_diff: true
    });
  }

  function bindFrozenReviewContext({
    status,
    provisioning,
    integration,
    reviewUnit,
    terminalCandidate = null,
    terminalCandidateValidations = null,
    recoveredTerminalCandidate = false
  }) {
    const target = assertFrozenReviewTarget(integration?.review_target);
    const wkBinding = provisioning?.wk_binding;
    const terminalCandidateReview = target.review_identity_kind === "terminal_candidate";
    const boundReviewUnit = terminalCandidateReview && terminalCandidate?.review_unit
      ? terminalCandidate.review_unit
      : reviewUnit;
    const worktreePath = terminalCandidateReview ? target.worktree_path : provisioning?.validation_worktree_path;
    const expectedWkRef = wkBinding?.output_branch?.startsWith("refs/heads/")
      ? wkBinding.output_branch
      : `refs/heads/${wkBinding?.output_branch ?? ""}`;
    const managedLifecycleMismatch = recoveredTerminalCandidate !== true && (
      (terminalCandidateReview ? expectedWkRef !== target.wk_ref : expectedWkRef !== target.ref) ||
      (!terminalCandidateReview && worktreePath !== wkBinding?.worktree_path) ||
      provisioning?.record_id !== reviewUnit?.record_id ||
      status?.subject !== `${reviewUnit?.record_id}#${provisioning?.slice_id}`
    );
    if (!isPlainObject(boundReviewUnit) || typeof boundReviewUnit.subject !== "string" ||
        typeof boundReviewUnit.canonical_parent_wk_contract !== "string" ||
        typeof boundReviewUnit.review_unit_contract !== "string" ||
        (!terminalCandidateReview && reviewUnit.parent_status !== "review") ||
        typeof boundReviewUnit?.initiative !== "string" || !/^IN-\d{4}$/u.test(boundReviewUnit.initiative) ||
        (terminalCandidateReview
          ? target.wk_ref !== `refs/heads/wk/${boundReviewUnit.initiative}/${boundReviewUnit.record_id}` ||
            terminalCandidate === null
          : target.ref !== `refs/heads/wk/${reviewUnit.initiative}/${reviewUnit.record_id}` ||
            terminalCandidate !== null) ||
        !path.isAbsolute(worktreePath ?? "") ||
        managedLifecycleMismatch ||
        (recoveredTerminalCandidate === true && !terminalCandidateReview)) {
      throw new Error("backend-owned frozen review context does not match managed provisioning and canonical review identity");
    }
    if (terminalCandidateReview && !sameTerminalReviewAddress(reviewUnit, boundReviewUnit)) {
      throw new Error("terminal-candidate review address disagrees with the selected terminal review unit");
    }
    let terminalAuthentication = null;
    let historicalEvidence = null;
    if (terminalCandidateReview) {

      assertSelectedDependencyMountIntegrity(terminalCandidate.dependency_proof ?? null);
      assertTerminalCandidateMaterialization(terminalCandidate.materialization, terminalCandidate.binding);
      const targetFields = [
        ["candidate_ref", terminalCandidate.binding.candidate_ref],
        ["candidate_sha", terminalCandidate.binding.candidate],
        ["base_ref", terminalCandidate.binding.base_ref],
        ["base_sha", terminalCandidate.binding.base],
        ["wk_ref", terminalCandidate.binding.wk_ref],
        ["wk_sha", terminalCandidate.binding.wk_tip],
        ["canonical_wk_digest", terminalCandidate.binding.canonical_wk_digest],
        ["worktree_path", terminalCandidate.materialization.checkout_path]
      ];
      const mismatch = targetFields.find(([field, expected]) => target[field] !== expected);
      if (mismatch) throw new Error(`terminal-candidate backend binding disagrees at ${mismatch[0]}`);
      verifyTerminalCandidateCheckout({
        binding: terminalCandidate.binding,
        candidateRoot: terminalCandidate.materialization.candidate_root,
        runGit: reviewContextRunGit
      });

      historicalEvidence = historicalTerminalReviewEvidence(terminalCandidate);
      terminalAuthentication = deriveRetainedTerminalReviewAttemptContract({
        binding: terminalCandidate.binding,
        checkoutPath: terminalCandidate.materialization.checkout_path,
        historicalEvidence,
        address: {
          subject: boundReviewUnit.subject,
          record_id: boundReviewUnit.record_id,
          slice_id: boundReviewUnit.slice_id,
          initiative: boundReviewUnit.initiative
        }
      });
    }

    if (frozenSliceReviewContexts.has(reviewUnit.subject)) {
      throw new Error("subject already bound to a slice-level review context; a whole-WK review context cannot coexist");
    }
    const existing = frozenReviewContexts.get(reviewUnit.subject) ?? null;
    if (existing !== null) {

      const sameTarget = terminalCandidateReview
        ? existing.candidate_sha === target.candidate_sha &&
          existing.base_sha === target.base_sha &&
          sameTerminalReviewAddress(boundReviewUnit, existing) &&

          existing.terminal_review_attempt_contract?.contract_identity ===
            terminalAuthentication.contract.contract_identity
        : existing.wk_sha === target.sha && existing.diff_base_sha === target.diff_base_sha;
      if (sameTarget) return existing;
    }

    const contractReviewUnit = terminalCandidateReview
      ? terminalAuthentication.liveUnit
      : boundReviewUnit;
    const trustedFrozenReviewContract = createTrustedFrozenReviewContract(contractReviewUnit);
    const context = Object.freeze({
      schema_version: "workspace-agent-frozen-wk-review-context.v1",
      review_subject: boundReviewUnit.subject,
      record_id: boundReviewUnit.record_id,
      review_slice_id: boundReviewUnit.slice_id,
      initiative: boundReviewUnit.initiative,
      canonical_parent_wk_contract: contractReviewUnit.canonical_parent_wk_contract,
      review_unit_contract: contractReviewUnit.review_unit_contract,
      trusted_frozen_review_contract: trustedFrozenReviewContract,
      main_repo: worktreeProvisioningConfig.mainRepo,
      worktree_path: worktreePath,
      wk_ref: terminalCandidateReview ? target.wk_ref : target.ref,
      wk_sha: terminalCandidateReview ? target.wk_sha : target.sha,
      ...(terminalCandidateReview ? {
        review_identity_kind: "terminal_candidate",

        historical_terminal_review_evidence: historicalEvidence,
        terminal_review_attempt_contract: terminalAuthentication.contract,
        candidate_ref: target.candidate_ref,
        candidate_sha: target.candidate_sha,
        base_ref: target.base_ref,
        base_sha: target.base_sha,
        canonical_wk_digest: target.canonical_wk_digest,
        terminal_candidate_binding: terminalCandidate.binding,
        terminal_candidate_materialization: terminalCandidate.materialization,
        terminal_candidate_dependency_proof: terminalCandidate.dependency_proof ?? null,
        reviewer_dependency_binds: Object.freeze([
          ...(terminalCandidate.dependency_proof?.reviewer_read_only_binds ?? [])
        ]),
        reviewer_validation_evidence: Object.freeze([
          ...(Array.isArray(terminalCandidateValidations)
            ? terminalCandidateValidations
            : Array.isArray(terminalCandidate.validation_evidence)
              ? terminalCandidate.validation_evidence
              : [])
        ])
      } : {}),
      diff_base_sha: target.diff_base_sha,
      diff_head_sha: target.diff_head_sha,
      diff_range: target.diff_range,
      complete_parent_wk_contract: true,
      accumulated_wk_diff: true,
      source_worker_run_id: status?.run_id ?? null,
      source_worker_subject: status?.subject ?? null,
      review_evidence_semantics: "append_only_advisory"
    });
    frozenReviewContexts.set(reviewUnit.subject, context);
    return context;
  }

  function verifyTerminalReviewContext(context) {
    verifyTerminalWkCandidateObjectBinding({
      binding: context.terminal_candidate_binding,
      runGit: reviewContextRunGit
    });
    verifyTerminalCandidateCheckout({
      binding: context.terminal_candidate_binding,
      candidateRoot: context.terminal_candidate_materialization.candidate_root,
      runGit: reviewContextRunGit
    });

    assertSelectedDependencyMountIntegrity(context.terminal_candidate_dependency_proof ?? null);
    return context;
  }

  async function recoverTerminalReviewContext(reviewAddress) {
    if (recoverTerminalCandidate === null || worktreeProvisioningConfig === null) {
      return {
        ok: false,
        refusal: managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
          capability: "wk_context_review",
          reason: "terminal_candidate_recovery_unavailable",
          subject: reviewAddress.subject
        })
      };
    }
    let recovery = terminalCandidateRecoveryInFlight.get(reviewAddress.subject) ?? null;
    if (recovery === null) {
      recovery = (async () => {
        const terminalCandidate = await recoverTerminalCandidate(reviewAddress.record_id);
        if (!isPlainObject(terminalCandidate) || !isPlainObject(terminalCandidate.review_unit) ||
            terminalCandidate.review_unit.subject !== reviewAddress.subject ||
            terminalCandidate.review_unit.record_id !== reviewAddress.record_id) {
          const error = new Error("recovered terminal candidate does not bind the canonical selected review unit");
          error.code = "terminal_candidate_recovery_review_subject_mismatch";
          throw error;
        }
        return bindFrozenReviewContext({
          status: null,
          provisioning: null,
          integration: { review_target: terminalCandidateReviewTarget(terminalCandidate) },
          reviewUnit: terminalCandidate.review_unit,
          terminalCandidate,
          terminalCandidateValidations: terminalCandidate.validation_evidence,
          recoveredTerminalCandidate: true
        });
      })();
      terminalCandidateRecoveryInFlight.set(reviewAddress.subject, recovery);
    }
    try {
      const context = await recovery;
      verifyTerminalReviewContext(context);
      return { ok: true, context };
    } catch (error) {

      if (isTerminalReviewLifecycleRefusal(error)) {
        return { ok: false, refusal: terminalReviewLifecycleManagedRefusal(error, reviewAddress.subject) };
      }
      const recoveryFailure = terminalCandidateFailureFromThrown(error);
      return {
        ok: false,
        refusal: managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
          capability: "wk_context_review",
          reason: "terminal_candidate_recovery_failed",
          recovery_code: recoveryFailure.code,
          subject: reviewAddress.subject,
          message: recoveryFailure.message,
          recovery_detail: recoveryFailure
        })
      };
    } finally {
      if (terminalCandidateRecoveryInFlight.get(reviewAddress.subject) === recovery) {
        terminalCandidateRecoveryInFlight.delete(reviewAddress.subject);
      }
    }
  }

  function resolveTerminalCandidatePublicationState(wkId) {
    if (typeof wkId !== "string" || !/^WK-\d{4}$/u.test(wkId)) return null;
    const targetKey = currentTerminalReviewTargetByWk.get(wkId);
    if (targetKey === undefined) return null;
    const context = frozenReviewContextsByTarget.get(targetKey);
    if (context === undefined) return null;
    const records = [...wholeReviewRunContexts.entries()]
      .filter(([, runContext]) => wholeReviewTargetKey(runContext) === targetKey)
      .map(([runId]) => runs.get(runId))
      .filter(Boolean);
    if (verifyFrozenWkReviewTargetAgainstObjectStore({
      mainRepo: context.main_repo,
      context,
      runGit: reviewContextRunGit
    }).ok !== true) return null;
    verifyTerminalCandidateCheckout({
      binding: context.terminal_candidate_binding,
      candidateRoot: context.terminal_candidate_materialization.candidate_root,
      runGit: reviewContextRunGit
    });
    const advisoryReviews = records.map((record) => {
      const outcome = structuredReceiptOutcome(record);
      let provenanceValid = false;
      try {
        assertRetainedReviewerLaunchIdentityMatchesContext(record.reviewer_launch_identity, context);
        provenanceValid = true;
      } catch {

      }
      return Object.freeze({
        run_id: record.run_id,
        monitor_handle: record.monitor_handle ?? null,
        role: record.role ?? "reviewer",
        terminal: record.terminal === true,
        status: record.status ?? null,
        provenance_valid: provenanceValid,
        outcome: outcome?.outcome ?? null,
        review_result: outcome === null ? null : deriveBackendReviewResult(record)
      });
    });
    return Object.freeze({
      binding: context.terminal_candidate_binding,
      materialization: context.terminal_candidate_materialization,
      advisory_review_evidence: Object.freeze({
        schema_version: "workspace-agent-terminal-review-advisory-evidence.v1",
        authority: "advisory_only",
        candidate_sha: context.candidate_sha,
        base_sha: context.base_sha,
        wk_sha: context.wk_sha,
        reviews: Object.freeze(advisoryReviews)
      })
    });
  }

  return {
    sameTerminalReviewAddress,
    terminalCandidateReviewTarget,
    bindFrozenReviewContext,
    verifyTerminalReviewContext,
    recoverTerminalReviewContext,
    refreshTerminalReviewAttemptContract,
    verifyTerminalReviewAttemptContractAtSpawn,
    resolveTerminalCandidatePublicationState
  };
}
