

import { createHash } from "node:crypto";
import path from "node:path";
import { canonicalizeWorkRecordJson } from "@agent-chassis/wiki-core";
import {
  isPlainObject,
  createTrustedFrozenReviewContract
} from "./backend-review-identity.mjs";
import {
  assertAdmissibleLiveTerminalReviewCoordination,
  assertFrozenReviewTarget,
  deepFreezeCanonicalSnapshot,
  isTerminalReviewLifecycleRefusal,
  resolveCanonicalTerminalReviewCoordinationState,
  terminalReviewLifecycleRefusal,
  verifyFrozenWkReviewTargetAgainstObjectStore
} from "./backend-scope-authority.mjs";
import {
  decideAuthenticatedTerminalReviewLifecycleDelta,
  resolveCanonicalTerminalReviewCoordinationStateForInvariantDecision
} from "./backend-terminal-review-lifecycle-authority.mjs";
import { authenticateCanonicalIntegratedDeliveryTransition } from
  "./backend-integrated-scope-authority.mjs";
import { createTerminalCandidateReviewTarget } from
  "./backend-terminal-review-target-authority.mjs";
import {
  managedRefusal,
  MANAGED_LIFECYCLE_REQUIRED
} from "./backend-provisioning-state.mjs";
import {
  assertTerminalCandidateMaterialization,
  verifyTerminalCandidateCheckout
} from "./terminal-review-materialization.mjs";
import {
  assertTerminalWkCandidateVersionDecision,
  inspectTerminalWkCandidateVersion,
  TERMINAL_WK_CANDIDATE_CODES,
  TERMINAL_WK_CANDIDATE_SCHEMA_VERSION_V3,
  observeExactDirectCommitRef,
  verifyTerminalWkCandidateObjectBinding
} from "./terminal-wk-candidate.mjs";
import {
  assertSelectedDependencyMountIntegrity,
  findingsDependencyProjectionEvidenceFromProof
} from "./terminal-wk-candidate-validation.mjs";
import {
  CANONICAL_CURRENT_TERMINAL_REVIEW_CONTRACT_CODES,
  projectAuthenticatedTerminalCandidateFailure,
  projectTerminalCandidateRecoveryDiagnostic,
  projectTerminalCandidateRecoveryReason,
  TERMINAL_CANDIDATE_RECOVERY_DIAGNOSTIC_SCHEMA_VERSION,
  TERMINAL_CANDIDATE_RECOVERY_REASONS,
  TERMINAL_REVIEW_UNIT_PROJECTION_CODES
} from "@agent-chassis/wiki-mcp/src/lib/dispatch-terminal-candidate-runtime.mjs";
import {
  PARENT_LIFECYCLE_CONTRACT_FACTS
} from "@agent-chassis/wiki-core/src/lib/work-record-parent-lifecycle-contract.mjs";
import {
  withControlledContractAuthorityExclusion
} from "@agent-chassis/wiki-core/src/lib/controlled-contract-carrier-set-publication.mjs";

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

const TERMINAL_CANDIDATE_RECOVERY_REASON_VALUES = Object.freeze(
  new Set(Object.values(TERMINAL_CANDIDATE_RECOVERY_REASONS))
);
const TERMINAL_CANDIDATE_RECOVERY_DIAGNOSTIC_KEYS = Object.freeze([
  "schema_version",
  "contract_code",
  "projection_code",
  "missing_facts",
  "ambiguous_facts"
]);
const TERMINAL_CANDIDATE_RECOVERY_CONTRACT_CODES = Object.freeze(
  new Set(Object.values(CANONICAL_CURRENT_TERMINAL_REVIEW_CONTRACT_CODES))
);
const TERMINAL_CANDIDATE_RECOVERY_PROJECTION_CODES = Object.freeze(
  new Set(Object.values(TERMINAL_REVIEW_UNIT_PROJECTION_CODES))
);
const PARENT_LIFECYCLE_CONTRACT_FACT_VALUES = Object.freeze(
  new Set(Object.values(PARENT_LIFECYCLE_CONTRACT_FACTS))
);

function closedTerminalCandidateRecoveryReason(value) {
  return TERMINAL_CANDIDATE_RECOVERY_REASON_VALUES.has(value)
    ? value
    : TERMINAL_CANDIDATE_RECOVERY_REASONS.FAILED;
}

function closedLifecycleFactList(value) {
  if (!Array.isArray(value)) return undefined;
  if (value.some((fact) => !PARENT_LIFECYCLE_CONTRACT_FACT_VALUES.has(fact))) return undefined;
  return Object.freeze([...value]);
}

function closedTerminalCandidateRecoveryDiagnostic(value) {
  if (value === null || value === undefined) return null;
  const diagnostic = exactEnumerableDataProperties(
    value,
    TERMINAL_CANDIDATE_RECOVERY_DIAGNOSTIC_KEYS
  );
  if (diagnostic === null ||
      diagnostic.schema_version !== TERMINAL_CANDIDATE_RECOVERY_DIAGNOSTIC_SCHEMA_VERSION ||
      !(diagnostic.contract_code === null ||
        TERMINAL_CANDIDATE_RECOVERY_CONTRACT_CODES.has(diagnostic.contract_code)) ||
      !(diagnostic.projection_code === null ||
        TERMINAL_CANDIDATE_RECOVERY_PROJECTION_CODES.has(diagnostic.projection_code))) {
    return null;
  }
  const missingFacts = closedLifecycleFactList(diagnostic.missing_facts);
  const ambiguousFacts = closedLifecycleFactList(diagnostic.ambiguous_facts);
  if (missingFacts === undefined || ambiguousFacts === undefined) return null;
  return Object.freeze({
    schema_version: TERMINAL_CANDIDATE_RECOVERY_DIAGNOSTIC_SCHEMA_VERSION,
    contract_code: diagnostic.contract_code,
    projection_code: diagnostic.projection_code,
    missing_facts: missingFacts,
    ambiguous_facts: ambiguousFacts
  });
}

export function createBackendTerminalCandidateCoordination(ctx) {
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
    terminalReviewAttemptContractBySubject,
    exactSliceReviewReceiptStore
  } = ctx;

  function terminalCandidateExclusionRefusal(reason) {
    const error = new Error(`terminal candidate exclusion refused: ${reason}`);
    error.code = "agent_launch.terminal_candidate.exclusion_refused.v1";
    error.reason = reason;
    return error;
  }

  function retainedTerminalCandidateContext(wkId) {
    const targetKey = currentTerminalReviewTargetByWk.get(wkId);
    if (targetKey !== undefined) {
      return frozenReviewContextsByTarget.get(targetKey) ?? null;
    }
    return frozenReviewContexts.get(wkId) ?? null;
  }

  async function observeTerminalCandidateBoundState(wkId) {
    const context = retainedTerminalCandidateContext(wkId);
    if (context === null) return Object.freeze({ state: "unbound" });
    if (!isPlainObject(context)) {
      return Object.freeze({ state: "invalid", reason: "retained_context_malformed" });
    }
    const binding = context.terminal_candidate_binding;
    const retainedVersionDecision = context.terminal_candidate_version_decision;
    const wkRef = binding?.wk_ref;
    const wkSha = binding?.wk_tip;
    const mainRepo = context.main_repo ?? worktreeProvisioningConfig?.mainRepo;
    if (!isPlainObject(binding) || typeof wkRef !== "string" ||
        typeof wkSha !== "string" || typeof mainRepo !== "string") {
      return Object.freeze({ state: "invalid", reason: "retained_context_malformed" });
    }

    let verification;
    let versionDecision;
    try {
      verification = verifyFrozenWkReviewTargetAgainstObjectStore({
        mainRepo,
        context,
        runGit: reviewContextRunGit
      });
      if (retainedVersionDecision !== undefined) {
        assertTerminalWkCandidateVersionDecision(retainedVersionDecision, { binding });
        versionDecision = await inspectTerminalWkCandidateVersion({
          binding,
          runGit: reviewContextRunGit
        });
      }
    } catch (error) {
      return Object.freeze({
        state: error?.code === TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED
          ? "transport_failure"
          : "invalid",
        reason: error?.code ?? "candidate_version_binding_disagrees",
        error
      });
    }
    const movedW = verification?.ok === false &&
      verification.kind === "disagreement" &&
      verification.detail?.probe === "wk_ref_remains_accumulated_tip";
    if (verification?.ok !== true && !movedW) {
      return Object.freeze({
        state: verification?.kind === "transport" ? "transport_failure" : "invalid",
        reason: verification?.kind === "transport"
          ? "object_store_transport_failure"
          : verification?.detail?.probe ?? "object_store_binding_disagrees"
      });
    }

    let directW;
    try {
      directW = await observeExactDirectCommitRef({
        mainRepo,
        ref: wkRef,
        runGit: reviewContextRunGit,
        subject: "retained terminal-candidate WK ref"
      });
    } catch (error) {
      return Object.freeze({
        state: error?.code === TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED
          ? "transport_failure"
          : "invalid",
        reason: error?.code ?? "wk_ref_binding_mismatch",
        error
      });
    }
    if (directW === null) {
      return Object.freeze({ state: "invalid", reason: "wk_ref_absent" });
    }
    if (verification.ok === true && directW === wkSha) {
      if (versionDecision === undefined) {
        return Object.freeze({ state: "bound", wk_sha: wkSha });
      }
      return Object.freeze({
        state: versionDecision.state === "selected" ? "bound" : versionDecision.state,
        wk_sha: wkSha,
        version_decision: versionDecision
      });
    }
    if (movedW && verification.detail?.actual === directW && directW !== wkSha) {
      return Object.freeze({
        state: "superseded_by_w_movement",
        wk_sha: wkSha,
        current_wk: directW,
        ...(versionDecision === undefined ? {} : { version_decision: versionDecision })
      });
    }
    return Object.freeze({ state: "invalid", reason: "bound_state_disagrees" });
  }

  async function withTerminalCandidateAdvanceExclusion({
    wkId,
    evaluateTerminalReviewCandidateStatus,
    run
  } = {}) {
    if (typeof wkId !== "string" ||
        typeof evaluateTerminalReviewCandidateStatus !== "function" ||
        typeof run !== "function") {
      throw terminalCandidateExclusionRefusal("invalid_arguments");
    }
    const before = await evaluateTerminalReviewCandidateStatus();
    if (before?.state !== "candidate_stale_w") {
      throw terminalCandidateExclusionRefusal("candidate_not_stale_w");
    }
    const repoRoot = worktreeProvisioningConfig?.mainRepo;
    if (typeof repoRoot !== "string") {
      throw terminalCandidateExclusionRefusal("repository_root_unavailable");
    }
    return withControlledContractAuthorityExclusion({
      repoRoot,
      wkId,
      run: async () => {
        const inside = await evaluateTerminalReviewCandidateStatus();
        if (inside?.state !== "candidate_stale_w") {
          throw terminalCandidateExclusionRefusal("candidate_not_stale_w_inside_exclusion");
        }
        return run(inside);
      }
    });
  }

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

  function integratedDeliveryTransitionSubjects({
    historicalParentContract,
    liveParentContract,
    recordId
  }) {
    let historical;
    let live;
    try {
      historical = JSON.parse(historicalParentContract);
      live = JSON.parse(liveParentContract);
    } catch {
      return Object.freeze([]);
    }
    if (historical?.id !== recordId || live?.id !== recordId ||
        !Array.isArray(historical.slices) || !Array.isArray(live.slices)) {
      return Object.freeze([]);
    }
    const subjects = [];
    for (let index = 0; index < live.slices.length; index += 1) {
      const historicalSlice = historical.slices[index];
      const liveSlice = live.slices[index];
      if (!isPlainObject(historicalSlice) || !isPlainObject(liveSlice) ||
          historicalSlice.id !== liveSlice.id ||
          historicalSlice.work_kind !== "implementation" ||
          liveSlice.work_kind !== "implementation") {
        continue;
      }
      const historicalHas = Object.hasOwn(historicalSlice, "integrated_delivery_sha");
      const historicalValue = historicalHas ? historicalSlice.integrated_delivery_sha : "absent";
      if ((historicalValue === "absent" || historicalValue === null) &&
          typeof liveSlice.integrated_delivery_sha === "string") {
        subjects.push(`${recordId}#${liveSlice.id}`);
      }
    }
    return Object.freeze(subjects);
  }

  function lifecycleDecisionWithReceipt(inputs, receipt) {
    const proof = authenticateCanonicalIntegratedDeliveryTransition(
      worktreeProvisioningConfig.mainRepo,
      receipt.unit_address,
      receipt
    );
    return decideAuthenticatedTerminalReviewLifecycleDelta({
      ...inputs,
      integratedDeliveryProof: proof
    });
  }

  function producerReceiptLifecycleRefusal(error) {
    return terminalReviewLifecycleRefusal(
      "integrated_delivery_receipt_unauthenticated",
      {
        invariant: "integration_written_delivery_is_bound_to_its_producer_receipt",
        consequence: error?.integrated_delivery_authentication?.consequence ??
          "candidate or delivery authority is unverifiable and terminal recovery must not proceed",
        authentication_reason:
          error?.integrated_delivery_authentication?.reason ?? error?.code ?? null
      }
    );
  }

  async function resolveAuthenticatedTerminalReviewLifecycleDecision(inputs, retainedReceipt = null) {
    try {
      return Object.freeze({
        decision: decideAuthenticatedTerminalReviewLifecycleDelta(inputs),
        integrated_delivery_receipt: null
      });
    } catch (error) {
      if (error?.terminal_review_lifecycle?.reason !== "integrated_delivery_receipt_required") {
        throw error;
      }
      if (retainedReceipt !== null) {
        try {
          return Object.freeze({
            decision: lifecycleDecisionWithReceipt(inputs, retainedReceipt),
            integrated_delivery_receipt: retainedReceipt
          });
        } catch (receiptError) {
          if (isTerminalReviewLifecycleRefusal(receiptError)) throw receiptError;
          throw producerReceiptLifecycleRefusal(receiptError);
        }
      }
      if (typeof exactSliceReviewReceiptStore?.loadAll !== "function") throw error;
      const subjects = integratedDeliveryTransitionSubjects(inputs);
      const candidates = [];
      let lastAuthenticationError = null;
      for (const subject of subjects) {
        const receipts = await exactSliceReviewReceiptStore.loadAll({ unit_address: subject });
        for (const receipt of receipts) {
          try {
            candidates.push(Object.freeze({
              decision: lifecycleDecisionWithReceipt(inputs, receipt),
              integrated_delivery_receipt: receipt
            }));
          } catch (receiptError) {
            if (isTerminalReviewLifecycleRefusal(receiptError)) {
              lastAuthenticationError = receiptError;
              continue;
            }
            lastAuthenticationError = receiptError;
          }
        }
      }
      if (candidates.length === 0) {
        if (lastAuthenticationError !== null &&
            !isTerminalReviewLifecycleRefusal(lastAuthenticationError)) {
          throw producerReceiptLifecycleRefusal(lastAuthenticationError);
        }
        if (isTerminalReviewLifecycleRefusal(lastAuthenticationError)) {
          throw lastAuthenticationError;
        }
        throw error;
      }
      const identities = new Set(candidates.map(({ decision }) => canonicalizeWorkRecordJson({
        integrated_delivery: decision.integrated_delivery,
        integrated_delivery_dependency_path: decision.integrated_delivery_dependency_path
      })));
      if (identities.size !== 1) {
        throw terminalReviewLifecycleRefusal(
          "integrated_delivery_producer_receipt_ambiguous",
          {
            invariant: "one_producer_authenticated_delivery_identity_is_selected_mechanically",
            consequence: "the delivery transition cannot be attributed to one exact producer result"
          }
        );
      }
      return candidates[0];
    }
  }

  async function decideTerminalReviewLifecycle(inputs) {
    return (await resolveAuthenticatedTerminalReviewLifecycleDecision(inputs)).decision;
  }

  function decideTerminalReviewLifecycleWithRetainedReceipt(inputs, retainedReceipt) {
    try {
      return decideAuthenticatedTerminalReviewLifecycleDelta(inputs);
    } catch (error) {
      if (error?.terminal_review_lifecycle?.reason !== "integrated_delivery_receipt_required" ||
          retainedReceipt === null) {
        throw error;
      }
      try {
        return lifecycleDecisionWithReceipt(inputs, retainedReceipt);
      } catch (receiptError) {
        if (isTerminalReviewLifecycleRefusal(receiptError)) throw receiptError;
        throw producerReceiptLifecycleRefusal(receiptError);
      }
    }
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
    address,
    integratedDeliveryReceipt = null
  }) {
    if (worktreeProvisioningConfig?.mainRepo == null) {
      throw terminalReviewLifecycleRefusal("launcher_owned_canonical_repository_unavailable");
    }
    const live = historicalEvidence === null
      ? resolveCanonicalTerminalReviewCoordinationState(
          worktreeProvisioningConfig.mainRepo,
          address.record_id
        )
      : resolveCanonicalTerminalReviewCoordinationStateForInvariantDecision(
          worktreeProvisioningConfig.mainRepo,
          address.record_id,
          address.slice_id
        );
    const liveUnit = live.unit;
    if (liveUnit.subject !== address.subject || liveUnit.record_id !== address.record_id ||
        liveUnit.slice_id !== address.slice_id || liveUnit.initiative !== address.initiative) {
      throw terminalReviewLifecycleRefusal("live_terminal_review_unit_identity_mismatch", {
        addressed_subject: address.subject ?? null,
        live_subject: liveUnit.subject ?? null
      });
    }
    const transitions = historicalEvidence === null
      ? null
      : decideTerminalReviewLifecycleWithRetainedReceipt({
          historicalParentContract: historicalEvidence.canonical_parent_wk_contract,
          liveParentContract: liveUnit.canonical_parent_wk_contract,
          recordId: address.record_id,
          reviewSliceId: address.slice_id
        }, integratedDeliveryReceipt);
    const liveStatuses = transitions === null
      ? assertAdmissibleLiveTerminalReviewCoordination({
          liveParentContract: liveUnit.canonical_parent_wk_contract,
          recordId: address.record_id,
          reviewSliceId: address.slice_id
        })
      : Object.freeze({
          parent_status: transitions.parent.to,
          review_unit_status: transitions.review_unit.to
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
      version_identity: binding?.version_decision?.version_identity ?? null,
      immutable_version_ref: binding?.version_decision?.immutable_version_ref ?? null,
      current_selection_ref: binding?.version_decision?.current_selection_ref ?? null,
      current_selection_observation:
        binding?.version_decision?.current_selection_observation ?? null,
      authenticated_generation: binding?.version_decision?.controlled_generation ?? null,
      candidate_format: binding?.version_decision?.candidate_format ?? null,
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

  function registerTerminalReviewAttemptContract({
    contract,
    rederive,
    integratedDeliveryReceipt
  }) {
    const existing = terminalReviewAttemptContracts.get(contract.contract_identity) ?? null;
    if (existing !== null) return existing;
    const previous = terminalReviewAttemptContractBySubject.get(contract.review_subject);
    if (previous !== undefined && previous !== contract.contract_identity) {
      terminalReviewAttemptContracts.delete(previous);
    }
    terminalReviewAttemptContracts.set(
      contract.contract_identity,
      Object.freeze({ contract, rederive, integratedDeliveryReceipt })
    );
    terminalReviewAttemptContractBySubject.set(contract.review_subject, contract.contract_identity);
    return terminalReviewAttemptContracts.get(contract.contract_identity);
  }

  function deriveRetainedTerminalReviewAttemptContract({
    binding,
    checkoutPath,
    historicalEvidence,
    address,
    integratedDeliveryReceipt = null
  }) {
    const derivation = () => authenticateTerminalReviewCoordination({
      binding,
      checkoutPath,
      historicalEvidence,
      address,
      integratedDeliveryReceipt
    });
    const authenticated = derivation();
    const retained = registerTerminalReviewAttemptContract({
      contract: authenticated.contract,
      rederive: () => derivation().contract,
      integratedDeliveryReceipt
    });
    return {
      liveUnit: authenticated.liveUnit,
      contract: retained.contract
    };
  }

  async function deriveInitialTerminalReviewAttemptContract({
    binding,
    checkoutPath,
    historicalEvidence,
    address
  }) {
    let integratedDeliveryReceipt = null;
    if (historicalEvidence !== null) {
      const live = resolveCanonicalTerminalReviewCoordinationStateForInvariantDecision(
        worktreeProvisioningConfig.mainRepo,
        address.record_id,
        address.slice_id
      );
      const resolved = await resolveAuthenticatedTerminalReviewLifecycleDecision({
        historicalParentContract: historicalEvidence.canonical_parent_wk_contract,
        liveParentContract: live.unit.canonical_parent_wk_contract,
        recordId: address.record_id,
        reviewSliceId: address.slice_id
      });
      integratedDeliveryReceipt = resolved.integrated_delivery_receipt;
    }
    return deriveRetainedTerminalReviewAttemptContract({
      binding,
      checkoutPath,
      historicalEvidence,
      address,
      integratedDeliveryReceipt
    });
  }

  function verifyRetainedTerminalReviewAttemptContract(contract) {
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
      const retained = terminalReviewAttemptContracts.get(
        context.terminal_review_attempt_contract?.contract_identity
      ) ?? null;
      refreshed = deriveRetainedTerminalReviewAttemptContract({
        binding: context.terminal_candidate_binding,
        checkoutPath: context.terminal_candidate_materialization?.checkout_path ?? null,
        historicalEvidence: context.historical_terminal_review_evidence ?? null,
        address,
        integratedDeliveryReceipt: retained?.integratedDeliveryReceipt ?? null
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

  async function bindFrozenReviewContext({
    status,
    provisioning,
    integration,
    reviewUnit,
    terminalCandidate = null,
    terminalCandidateValidations = null,
    recoveredTerminalCandidate = false,
    runGit = reviewContextRunGit
  }) {
    const bindingWkId = provisioning?.record_id ?? reviewUnit?.record_id ?? null;
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
    let versionDecision = null;
    if (terminalCandidateReview) {

      assertSelectedDependencyMountIntegrity(terminalCandidate.dependency_proof ?? null);
      versionDecision = assertTerminalWkCandidateVersionDecision(
        terminalCandidate.version_decision ?? terminalCandidate.binding?.version_decision,
        { binding: terminalCandidate.binding, requireSelected: true }
      );
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
      await verifyTerminalCandidateCheckout({
        binding: terminalCandidate.binding,
        candidateRoot: terminalCandidate.materialization.candidate_root,
        runGit
      });

      historicalEvidence = historicalTerminalReviewEvidence(terminalCandidate);
      terminalAuthentication = await deriveInitialTerminalReviewAttemptContract({
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
          existing.terminal_candidate_version_decision?.version_identity ===
            terminalCandidate.binding.version_decision?.version_identity &&
          existing.terminal_candidate_version_decision?.immutable_version_ref ===
            terminalCandidate.binding.version_decision?.immutable_version_ref &&
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
        terminal_candidate_review_target: target,
        terminal_candidate_binding: terminalCandidate.binding,
        terminal_candidate_version_decision: versionDecision,
        terminal_candidate_materialization: terminalCandidate.materialization,
        terminal_candidate_dependency_proof: terminalCandidate.dependency_proof ?? null,
        dependency_projection_evidence:
          findingsDependencyProjectionEvidenceFromProof(
            terminalCandidate.dependency_proof ?? null,
            worktreePath
          ),
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
      review_evidence_semantics: "immutable_advisory_history"
    });
    frozenReviewContexts.set(reviewUnit.subject, context);
    return context;
  }

  async function verifyTerminalReviewContext(context) {
    await verifyTerminalWkCandidateObjectBinding({
      binding: context.terminal_candidate_binding,
      runGit: reviewContextRunGit
    });
    await verifyTerminalCandidateCheckout({
      binding: context.terminal_candidate_binding,
      candidateRoot: context.terminal_candidate_materialization.candidate_root,
      runGit: reviewContextRunGit
    });
    const retainedDecision = assertTerminalWkCandidateVersionDecision(
      context.terminal_candidate_version_decision,
      { binding: context.terminal_candidate_binding, requireSelected: true }
    );
    const observedDecision = await inspectTerminalWkCandidateVersion({
      binding: context.terminal_candidate_binding,
      runGit: reviewContextRunGit
    });
    assertTerminalWkCandidateVersionDecision(observedDecision, {
      binding: context.terminal_candidate_binding,
      requireSelected: true
    });
    if (observedDecision.version_identity !== retainedDecision.version_identity ||
        observedDecision.immutable_version_ref !== retainedDecision.immutable_version_ref ||
        observedDecision.current_selection_observation !==
          retainedDecision.current_selection_observation) {
      throw new Error("terminal review version selection moved after context freeze");
    }

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
        return await bindFrozenReviewContext({
          status: null,
          provisioning: null,
          integration: { review_target: await createTerminalCandidateReviewTarget({
            binding: terminalCandidate.binding,
            materialization: terminalCandidate.materialization,
            runGit: reviewContextRunGit
          }) },
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
      await verifyTerminalReviewContext(context);
      return { ok: true, context };
    } catch (error) {

      if (isTerminalReviewLifecycleRefusal(error)) {
        return { ok: false, refusal: terminalReviewLifecycleManagedRefusal(error, reviewAddress.subject) };
      }
      const recoveryFailure = terminalCandidateFailureFromThrown(error);

      const recoveryReason =
        closedTerminalCandidateRecoveryReason(projectTerminalCandidateRecoveryReason(error));
      const recoveryDiagnostic = closedTerminalCandidateRecoveryDiagnostic(
        projectTerminalCandidateRecoveryDiagnostic(error)
      );
      return {
        ok: false,
        refusal: managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
          capability: "wk_context_review",
          reason: recoveryReason,
          recovery_code: recoveryFailure.code,
          subject: reviewAddress.subject,
          message: recoveryFailure.message,
          recovery_detail: recoveryFailure,
          recovery_diagnostic: recoveryDiagnostic
        })
      };
    } finally {
      if (terminalCandidateRecoveryInFlight.get(reviewAddress.subject) === recovery) {
        terminalCandidateRecoveryInFlight.delete(reviewAddress.subject);
      }
    }
  }

  async function resolveTerminalCandidatePublicationState(wkId) {
    if (typeof wkId !== "string" || !/^WK-\d{4}$/u.test(wkId)) return null;
    const targetKey = currentTerminalReviewTargetByWk.get(wkId);
    if (targetKey === undefined) return null;
    const context = frozenReviewContextsByTarget.get(targetKey);
    if (context === undefined) return null;
    if (verifyFrozenWkReviewTargetAgainstObjectStore({
      mainRepo: context.main_repo,
      context,
      runGit: reviewContextRunGit
    }).ok !== true) return null;
    await verifyTerminalCandidateCheckout({
      binding: context.terminal_candidate_binding,
      candidateRoot: context.terminal_candidate_materialization.candidate_root,
      runGit: reviewContextRunGit
    });
    const versionDecision = await inspectTerminalWkCandidateVersion({
      binding: context.terminal_candidate_binding,
      runGit: reviewContextRunGit
    });

    return Object.freeze({
      binding: context.terminal_candidate_binding,
      materialization: context.terminal_candidate_materialization,
      version_decision: versionDecision
    });
  }

  return {
    observeTerminalCandidateBoundState,
    decideTerminalReviewLifecycle,
    withTerminalCandidateAdvanceExclusion,
    sameTerminalReviewAddress,
    bindFrozenReviewContext,
    verifyTerminalReviewContext,
    recoverTerminalReviewContext,
    refreshTerminalReviewAttemptContract,
    resolveTerminalCandidatePublicationState
  };
}
