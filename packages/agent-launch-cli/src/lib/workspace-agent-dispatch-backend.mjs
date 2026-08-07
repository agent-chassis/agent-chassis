

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
  createManagedStdioMcpCompositionGate
} from "./backend-managed-stdio-composition-gate.mjs";
import {
  createFrozenReviewContextStores
} from "./backend-frozen-review-context-stores.mjs";
import {
  createManagedLifecycleCapabilityAuthorityFacts
} from "./backend-managed-lifecycle-capability-facts.mjs";

import {
  defaultRunIdFactory,
  defaultMonitorHandleFactory
} from "./workspace-agent-dispatch-refusal.mjs";
import { createDispatchRunLifecycle } from "./workspace-agent-dispatch-run-lifecycle.mjs";
import { createExactSliceReviewReceiptStore } from "./workspace-agent-dispatch-run-receipt.mjs";
import { defaultRunGit } from "./worktree-substrate.mjs";
import {
  hasExactClosedInputCommitComposition
} from "./backend-review-identity.mjs";
import { resolveCanonicalFindingsOnlyReviewUnit } from "./backend-scope-authority.mjs";
import {
  normalizeProvisioningConfig,
  createLauncherOwnedManagedAttemptStateAuthority
} from "./backend-provisioning-state.mjs";
import {
  maybeWrapExecutorWithWorktreeProvisioning,
  maybeWrapRegistryEntryWithWorktreeProvisioning
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
  const managedStdioMcpCompositionAuthority =
    options.managedStdioMcpCompositionAuthority ?? null;
  const testCompositionFact = options.__testHooks === true &&
      Object.prototype.hasOwnProperty.call(options, "__managedStdioMcpCompositionFact")
    ? options.__managedStdioMcpCompositionFact
    : undefined;

  const {
    resolveManagedStdioMcpComposition,
    gateManagedExecutor
  } = createManagedStdioMcpCompositionGate({
    managedStdioMcpCompositionAuthority,
    testCompositionFact
  });
  const attemptStateAuthority = createLauncherOwnedManagedAttemptStateAuthority();
  const registeredWorkerScopeSnapshots = new WeakSet();
  const wholeReviewRunContexts = new Map();
  const terminalCandidateRecoveryInFlight = new Map();

  const terminalReviewAttemptContracts = new Map();
  const terminalReviewAttemptContractBySubject = new Map();
  const recoverTerminalCandidate = typeof options.recoverTerminalCandidate === "function"
    ? options.recoverTerminalCandidate
    : null;

  const {
    frozenReviewContextsByTarget,
    currentTerminalReviewTargetByWk,
    wholeReviewTargetKey,
    frozenReviewContexts,
    sliceReviewTargetKey,
    committedSliceIntegrationTargetKey,
    frozenSliceReviewContexts
  } = createFrozenReviewContextStores();
  const sliceReviewRunContexts = new Map();
  const canonicalCommittedSliceIntegrations = new Map();
  const canonicalCommittedSliceIntegrationAttempts = new Map();

  const sliceIntegrationCcePolicy = options.sliceIntegrationCcePolicy ?? null;
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
    terminalReviewAttemptContracts,
    terminalReviewAttemptContractBySubject,
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
          requireManagedProvisioning ? gateManagedExecutor(candidate) : candidate,
          app,
          worktreeProvisioningConfig,
          requireManagedProvisioning,
          attemptStateAuthority,
          backendContext.validateWorkerScopeSnapshot
        );
        executorRegistryEntries[app] = executors[app];
      } else if (candidate && typeof candidate === "object" && typeof candidate.executor === "function") {
        const gatedCandidate = requireManagedProvisioning
          ? { ...candidate, executor: gateManagedExecutor(candidate.executor) }
          : candidate;
        const wrapped = maybeWrapRegistryEntryWithWorktreeProvisioning(
          gatedCandidate,
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
      requireManagedProvisioning ? gateManagedExecutor(launchExecutor) : launchExecutor,
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
    releaseManagedRunSubjectReservationForLaunch: backendContext.releaseManagedRunSubjectReservationForLaunch,

    verifyTerminalReviewAttemptContractAtSpawn: (contract) =>
      backendContext.verifyTerminalReviewAttemptContractAtSpawn(contract)
  });
  backendContext.lifecycle = lifecycle;

  Object.assign(backendContext, createBackendTerminalReview(backendContext));
  Object.assign(backendContext, createBackendSliceReview(backendContext));
  Object.assign(backendContext, createBackendRecovery(backendContext));
  Object.assign(backendContext, createBackendRouting(backendContext));

  const getManagedLifecycleCapabilityAuthorityFacts =
    createManagedLifecycleCapabilityAuthorityFacts({
      resolveManagedStdioMcpComposition,
      executors,
      worktreeProvisioningConfig,
      requireManagedProvisioning,
      closedInputCommitCompositionInstalled,
      postWorkerSliceLifecycle
    });

  return {
    schema_version: WORKSPACE_AGENT_DISPATCH_BACKEND_SCHEMA_VERSION,
    startLaunch: backendContext.startLaunch,
    getRunStatus: lifecycle.getRunStatus,
    waitForRunStatus: lifecycle.waitForRunStatus,
    planLaunch: lifecycle.planLaunch,
    getManagedLifecycleCapabilityAuthorityFacts,
    getManagedStdioMcpCompositionCompatibility: () =>
      resolveManagedStdioMcpComposition(),
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
