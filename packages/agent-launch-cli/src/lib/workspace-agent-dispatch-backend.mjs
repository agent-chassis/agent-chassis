

import {
  WORKSPACE_AGENT_DISPATCH_BACKEND_SCHEMA_VERSION,
  WORKSPACE_AGENT_DISPATCH_RUN_STATUS_SCHEMA_VERSION,
  WORKSPACE_AGENT_DISPATCH_RUN_WAIT_SCHEMA_VERSION,
  WORKSPACE_AGENT_DISPATCH_PLAN_SCHEMA_VERSION,
  WORKSPACE_AGENT_DISPATCH_FINAL_RESULT_SCHEMA_VERSION,
  BACKEND_ACCEPTED_ROLES,
  validateLauncherFamilyRole,
  normalizeDispatchModelHint,
  BACKEND_SUPPORTED_APPS,
  BACKEND_FAMILY_UNAVAILABLE_REASONS,
  BACKEND_RUN_STATUSES,
  BACKEND_REFUSAL_CODES,
  BACKEND_MISSING_RESULT_CODES,
  BACKEND_FINAL_RESULT_KINDS,
  BACKEND_WRITEBACK_KINDS,
  normalizeFinalResult
} from "@agent-chassis/agent-launch-core";

export {
  WORKSPACE_AGENT_DISPATCH_BACKEND_SCHEMA_VERSION,
  WORKSPACE_AGENT_DISPATCH_RUN_STATUS_SCHEMA_VERSION,
  WORKSPACE_AGENT_DISPATCH_RUN_WAIT_SCHEMA_VERSION,
  WORKSPACE_AGENT_DISPATCH_PLAN_SCHEMA_VERSION,
  WORKSPACE_AGENT_DISPATCH_FINAL_RESULT_SCHEMA_VERSION,
  BACKEND_ACCEPTED_ROLES,
  validateLauncherFamilyRole,
  normalizeDispatchModelHint,
  BACKEND_SUPPORTED_APPS,
  BACKEND_FAMILY_UNAVAILABLE_REASONS,
  BACKEND_RUN_STATUSES,
  BACKEND_REFUSAL_CODES,
  BACKEND_MISSING_RESULT_CODES,
  BACKEND_FINAL_RESULT_KINDS,
  BACKEND_WRITEBACK_KINDS,
  normalizeFinalResult
};

import { DISPATCH_FORBIDDEN_ENVELOPE_TOKENS } from "./dispatch-envelope-policy.mjs";

import {
  defaultRunIdFactory,
  defaultMonitorHandleFactory
} from "./workspace-agent-dispatch-refusal.mjs";
import { createDispatchRunLifecycle } from "./workspace-agent-dispatch-run-lifecycle.mjs";
import { createExactSliceReviewReceiptStore } from "./workspace-agent-dispatch-run-receipt.mjs";
import { defaultRunGit } from "./worktree-substrate.mjs";
import {
  hasExactClosedInputCommitComposition,
  hasManagedConfinementActivation
} from "./backend-review-identity.mjs";
import { resolveCanonicalFindingsOnlyReviewUnit } from "./backend-scope-authority.mjs";
import {
  normalizeProvisioningConfig,
  createLauncherOwnedManagedAttemptStateAuthority
} from "./backend-provisioning-state.mjs";
import {
  maybeWrapExecutorWithWorktreeProvisioning,
  maybeWrapRegistryEntryWithWorktreeProvisioning,
  managedLifecycleCapabilityFact
} from "./backend-worktree-binding.mjs";

import { createBackendScope } from "./workspace-agent-dispatch-backend-scope.mjs";
import { createBackendManagedIdentity } from "./workspace-agent-dispatch-backend-managed-identity.mjs";
import { createBackendReceipts } from "./workspace-agent-dispatch-backend-receipts.mjs";
import {
  createBackendIntegration,
  createCanonicalCommittedSliceIntegrationAdapter
} from "./workspace-agent-dispatch-backend-integration.mjs";
import { createBackendTerminalReview } from "./workspace-agent-dispatch-backend-terminal-review.mjs";
import { createBackendSliceReview } from "./workspace-agent-dispatch-backend-slice-review.mjs";
import { createBackendRecovery } from "./workspace-agent-dispatch-backend-recovery.mjs";
import { createBackendRouting } from "./workspace-agent-dispatch-backend-routing.mjs";

export const BACKEND_FORBIDDEN_ENVELOPE_TOKENS = DISPATCH_FORBIDDEN_ENVELOPE_TOKENS;

export {
  WORKSPACE_AGENT_FROZEN_SCOPE_AUTHORITY_SCHEMA_VERSION,
  MANAGED_WORKER_CONFINEMENT_ACTIVATION_SCHEMA_VERSION,
  MANAGED_WORKER_ATTEMPT_STATE_SCHEMA_VERSION,
  WORKER_READ_BOUNDARY_UNSUPPORTED_BLOCKER
} from "./backend-constants.mjs";
export { createManagedWorkerConfinementActivationBinding } from "./backend-review-identity.mjs";

export {
  createTrustedFrozenSliceReviewContract,
  createRetainedSliceReviewerLaunchIdentity
} from "./backend-review-identity.mjs";
export {
  assertFrozenSliceReviewTarget,
  verifyFrozenSliceReviewTargetAgainstObjectStore,
  resolveCanonicalSliceReviewUnit
} from "./backend-scope-authority.mjs";
export {
  FROZEN_SLICE_LEVEL_ACCEPTANCE_CONTRACT_SCHEMA_VERSION
} from "./workspace-agent-findings-role-context.mjs";

export { createCanonicalCommittedSliceIntegrationAdapter };

export function createWorkspaceAgentDispatchBackend(options = {}) {
  const {
    launchExecutor = null,
    launchExecutors = null,
    clock = () => Date.now(),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),

    monotonicNow = () => performance.now(),
    runIdFactory = defaultRunIdFactory,
    monitorHandleFactory = defaultMonitorHandleFactory,

    evaluateWorkerAdmission = null,

    proveAssignedSourceReadable = null
  } = options;
  const correctiveContinuationProofs = new Map();
  const normalizedWorktreeProvisioningConfig = normalizeProvisioningConfig(options.worktreeProvisioning);

  const worktreeProvisioningConfig = normalizedWorktreeProvisioningConfig === null
    ? null
    : {
        ...normalizedWorktreeProvisioningConfig,
        deps: {
          ...(normalizedWorktreeProvisioningConfig.deps ?? {}),
          resolveCorrectiveContinuationProof({
            subject,
            unit_address: unitAddress,
            slice_ref: sliceRef,
            slice_tip: sliceTip,
            worktree_path: worktreePath
          } = {}) {
            const retained = correctiveContinuationProofs.get(subject) ?? null;
            const proof = retained?.proof ?? null;
            if (proof === null || proof.unit_address !== unitAddress ||
                proof.slice_ref !== sliceRef || proof.delivered_tip_sha !== sliceTip ||
                proof.worktree_path !== worktreePath) return null;
            correctiveContinuationProofs.delete(subject);
            return proof;
          }
        }
      };

  const requireManagedProvisioning = options.requireManagedProvisioning === true;
  const attemptStateAuthority = createLauncherOwnedManagedAttemptStateAuthority();
  const registeredWorkerScopeSnapshots = new WeakSet();
  const frozenReviewContextsByTarget = new Map();
  const currentReviewTargetBySubject = new Map();
  const currentTerminalReviewTargetByWk = new Map();
  const wholeReviewRunContexts = new Map();
  const terminalCandidateRecoveryInFlight = new Map();
  const recoverTerminalCandidate = typeof options.recoverTerminalCandidate === "function"
    ? options.recoverTerminalCandidate
    : null;
  const wholeReviewTargetKey = (context) => JSON.stringify([
    context.review_subject,
    context.candidate_sha ?? context.wk_sha,
    context.base_sha ?? context.diff_base_sha,
    context.canonical_wk_digest ?? null
  ]);
  const frozenReviewContexts = Object.freeze({
    get(subject) {
      const key = currentReviewTargetBySubject.get(subject);
      return key === undefined ? undefined : frozenReviewContextsByTarget.get(key);
    },
    set(subject, context) {
      const key = wholeReviewTargetKey(context);
      frozenReviewContextsByTarget.set(key, context);
      currentReviewTargetBySubject.set(subject, key);
      if (context.review_identity_kind === "terminal_candidate" &&
          typeof context.record_id === "string") {
        currentTerminalReviewTargetByWk.set(context.record_id, key);
      }
      return this;
    },
    has(subject) { return this.get(subject) !== undefined; },
    values() { return frozenReviewContextsByTarget.values(); }
  });

  const frozenSliceReviewContextsByTarget = new Map();
  const currentSliceReviewTargetBySubject = new Map();
  const sliceReviewRunContexts = new Map();
  const canonicalCommittedSliceIntegrations = new Map();
  const canonicalCommittedSliceIntegrationAttempts = new Map();

  const sliceIntegrationCcePolicy = options.sliceIntegrationCcePolicy ?? null;
  const sliceReviewTargetKey = (context) => JSON.stringify([
    context.review_subject,
    context.reviewed_sha,
    context.diff_base_sha,
    context.committed_target_digest ?? context.worktree_identity_digest
  ]);
  const committedSliceIntegrationTargetKey = (context) => JSON.stringify([
    context.review_subject,
    context.slice_ref,
    context.reviewed_sha,
    context.diff_base_sha,
    context.committed_target_digest
  ]);
  const frozenSliceReviewContexts = Object.freeze({
    get(subject) {
      const key = currentSliceReviewTargetBySubject.get(subject);
      return key === undefined ? undefined : frozenSliceReviewContextsByTarget.get(key);
    },
    set(subject, context) {
      const key = sliceReviewTargetKey(context);
      frozenSliceReviewContextsByTarget.set(key, context);
      currentSliceReviewTargetBySubject.set(subject, key);
      return this;
    },
    has(subject) {
      return this.get(subject) !== undefined;
    },
    values() {
      return frozenSliceReviewContextsByTarget.values();
    }
  });
  const recoveredIntegratedRuns = new Map();
  const exactSliceReviewReceiptStore = options.exactSliceReviewReceiptStore ??
    (requireManagedProvisioning && worktreeProvisioningConfig?.mainRepo
      ? createExactSliceReviewReceiptStore({
          workspaceDir: worktreeProvisioningConfig.mainRepo,
          env: options.env
        })
      : null);
  const postWorkerSliceLifecycle = typeof options.postWorkerSliceLifecycle === "function"
    ? options.postWorkerSliceLifecycle
    : null;
  const canonicalCommittedSliceIntegration =
    typeof options.canonicalCommittedSliceIntegration === "function"
      ? options.canonicalCommittedSliceIntegration
      : worktreeProvisioningConfig?.mainRepo
        ? createCanonicalCommittedSliceIntegrationAdapter(worktreeProvisioningConfig.mainRepo)
        : null;
  const reviewContextRunGit = options.reviewContextRunGit ?? defaultRunGit;
  const closedInputCommitCompositionInstalled = hasExactClosedInputCommitComposition(
    options.closedInputCommitComposition
  );
  const runs = new Map();

  const managedWorkerIdentityRequired = requireManagedProvisioning;
  const managedRunIdentityRoot = requireManagedProvisioning
    ? (worktreeProvisioningConfig?.mainRepo ?? null)
    : null;

  const managedRunIdentityDeps = options.managedRunProcessIdentityDeps ?? undefined;

  const backendContext = {
    worktreeProvisioningConfig,
    requireManagedProvisioning,
    attemptStateAuthority,
    registeredWorkerScopeSnapshots,
    correctiveContinuationProofs,
    runs,
    frozenReviewContextsByTarget,
    currentTerminalReviewTargetByWk,
    wholeReviewRunContexts,
    terminalCandidateRecoveryInFlight,
    recoverTerminalCandidate,
    wholeReviewTargetKey,
    frozenReviewContexts,
    sliceReviewRunContexts,
    canonicalCommittedSliceIntegrations,
    canonicalCommittedSliceIntegrationAttempts,
    sliceIntegrationCcePolicy,
    sliceReviewTargetKey,
    committedSliceIntegrationTargetKey,
    frozenSliceReviewContexts,
    recoveredIntegratedRuns,
    exactSliceReviewReceiptStore,
    postWorkerSliceLifecycle,
    canonicalCommittedSliceIntegration,
    reviewContextRunGit,
    managedRunIdentityRoot,
    managedRunIdentityDeps,
    managedWorkerIdentityRequired
  };

  Object.assign(backendContext, createBackendScope(backendContext));
  Object.assign(backendContext, createBackendManagedIdentity(backendContext));
  Object.assign(backendContext, createBackendReceipts(backendContext));
  Object.assign(backendContext, createBackendIntegration(backendContext));

  const executors = {};
  const executorRegistryEntries = {};

  const familyAwareWiring = !!(launchExecutors && typeof launchExecutors === "object");
  if (familyAwareWiring) {
    for (const app of BACKEND_SUPPORTED_APPS) {
      const candidate = launchExecutors[app];
      if (typeof candidate === "function") {
        executors[app] = maybeWrapExecutorWithWorktreeProvisioning(
          candidate,
          app,
          worktreeProvisioningConfig,
          requireManagedProvisioning,
          attemptStateAuthority,
          backendContext.validateWorkerScopeSnapshot
        );
        executorRegistryEntries[app] = executors[app];
      } else if (candidate && typeof candidate === "object" && typeof candidate.executor === "function") {
        const wrapped = maybeWrapRegistryEntryWithWorktreeProvisioning(
          candidate,
          app,
          worktreeProvisioningConfig,
          requireManagedProvisioning,
          attemptStateAuthority,
          backendContext.validateWorkerScopeSnapshot
        );
        executors[app] = wrapped.executor;
        executorRegistryEntries[app] = wrapped;
      }
    }
  } else if (typeof launchExecutor === "function") {
    executors.codex = maybeWrapExecutorWithWorktreeProvisioning(
      launchExecutor,
      "codex",
      worktreeProvisioningConfig,
      requireManagedProvisioning,
      attemptStateAuthority,
      backendContext.validateWorkerScopeSnapshot
    );
    executorRegistryEntries.codex = executors.codex;
  }

  const lifecycle = createDispatchRunLifecycle({
    executors,
    executorRegistryEntries,
    familyAwareWiring,
    runs,
    clock,
    sleep,
    monotonicNow,
    runIdFactory,
    monitorHandleFactory,
    evaluateWorkerAdmission,
    freezeWorkerScopeSnapshot: backendContext.freezeWorkerScopeSnapshot,
    validateWorkerScopeSnapshot: backendContext.validateWorkerScopeSnapshot,
    deriveReviewerLaunchIdentity: backendContext.deriveReviewerLaunchIdentity,
    proveAssignedSourceReadable,
    captureSliceReviewTerminalResult: backendContext.captureSliceReviewTerminalResult,
    resolveCorrectiveFindingsContext: backendContext.resolveCorrectiveFindingsContext,

    managedWorkerIdentityRequired,
    managedRunIdentityRootPresent: managedRunIdentityRoot !== null,
    checkPriorManagedAttempt: backendContext.checkPriorManagedAttempt,
    publishPendingManagedRunIdentity: backendContext.publishPendingManagedRunIdentity,
    bindManagedRunOuterIdentity: backendContext.bindManagedRunOuterIdentity,
    releaseManagedRunSubjectReservationForLaunch: backendContext.releaseManagedRunSubjectReservationForLaunch
  });
  backendContext.lifecycle = lifecycle;

  Object.assign(backendContext, createBackendTerminalReview(backendContext));
  Object.assign(backendContext, createBackendSliceReview(backendContext));
  Object.assign(backendContext, createBackendRecovery(backendContext));
  Object.assign(backendContext, createBackendRouting(backendContext));

  const getManagedLifecycleCapabilityAuthorityFacts = async () => Object.freeze({
    native_edit: managedLifecycleCapabilityFact(
      Object.keys(executors).length > 0,
      "agent_launch.dispatch_backend.executor_registry"
    ),
    repository_read_boundary: managedLifecycleCapabilityFact(
      hasManagedConfinementActivation(worktreeProvisioningConfig),
      "agent_launch.dispatch_backend.repository_read_boundary"
    ),
    commit: managedLifecycleCapabilityFact(
      closedInputCommitCompositionInstalled,
      "agent_launch.dispatch_backend.closed_input_commit_composition"
    ),
    managed_worktree_provisioning: managedLifecycleCapabilityFact(
      worktreeProvisioningConfig !== null && requireManagedProvisioning,
      "agent_launch.dispatch_backend.worktree_provisioning"
    ),
    slice_to_wk_integration: managedLifecycleCapabilityFact(
      postWorkerSliceLifecycle !== null && worktreeProvisioningConfig !== null && requireManagedProvisioning,
      "agent_launch.dispatch_backend.terminal_slice_integration"
    ),
    wk_context_review: managedLifecycleCapabilityFact(
      postWorkerSliceLifecycle !== null && worktreeProvisioningConfig !== null && requireManagedProvisioning,
      "agent_launch.dispatch_backend.frozen_wk_review_context"
    ),

    slice_context_review: managedLifecycleCapabilityFact(
      postWorkerSliceLifecycle !== null && worktreeProvisioningConfig !== null && requireManagedProvisioning,
      "agent_launch.dispatch_backend.frozen_slice_review_context"
    ),
    automatic_main_promotion: managedLifecycleCapabilityFact(
      false,
      "agent_launch.dispatch_backend.main_promotion_unwired"
    )
  });

  return {
    schema_version: WORKSPACE_AGENT_DISPATCH_BACKEND_SCHEMA_VERSION,
    startLaunch: backendContext.startLaunch,
    getRunStatus: lifecycle.getRunStatus,
    waitForRunStatus: lifecycle.waitForRunStatus,
    planLaunch: lifecycle.planLaunch,
    getManagedLifecycleCapabilityAuthorityFacts,
    isLauncherOwnedExactSliceReviewAdmission: backendContext.isLauncherOwnedExactSliceReviewAdmission,

    resolveSliceReviewEvidenceSet: backendContext.resolveSliceReviewEvidenceSet,
    requestCommittedSliceIntegration: backendContext.requestCommittedSliceIntegration,
    resolveCommittedSliceIntegrationContinuation: backendContext.resolveCommittedSliceIntegrationContinuation,
    resolveTerminalCandidatePublicationState: backendContext.resolveTerminalCandidatePublicationState,
    prepareCanonicalCommittedSliceReviewAdmission: backendContext.prepareCanonicalCommittedSliceReviewAdmission,
    ...(backendContext.runPostWorkerSliceLifecycle !== null
      ? {
          runPostWorkerSliceLifecycle: backendContext.runPostWorkerSliceLifecycle,
          recoverIntegratedWorkerRun: backendContext.recoverIntegratedWorkerRun,
          recoverExactSliceReviewRun: backendContext.recoverExactSliceReviewRun
        }
      : {}),

    __snapshotRuns: lifecycle.snapshotRuns,
    __snapshotFrozenReviewContexts: () => [...frozenReviewContexts.values()],
    __snapshotFrozenSliceReviewContexts: () => [...frozenSliceReviewContexts.values()],

    ...(options.__testHooks === true
      ? {
          __deleteRunForTest: (runId) => runs.delete(runId),
          __replaceReviewerLaunchIdentityForTest:
            lifecycle.replaceReviewerLaunchIdentityForTest
        }
      : {}),
    __resolveCanonicalFindingsOnlyReviewUnit: (mainRepo, wkId) =>
      resolveCanonicalFindingsOnlyReviewUnit(mainRepo, wkId)
  };
}
