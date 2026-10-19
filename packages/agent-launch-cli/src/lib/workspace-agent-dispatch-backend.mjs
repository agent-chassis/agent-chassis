

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
  createManagedLifecycleCapabilityAuthorityFacts,
  createSelectedBackendCapabilityFacts
} from "./backend-managed-lifecycle-capability-facts.mjs";

import {
  defaultRunIdFactory,
  defaultMonitorHandleFactory
} from "./workspace-agent-dispatch-refusal.mjs";
import { createDispatchRunLifecycle, createPreparedDispatchRunLifecycle } from "./workspace-agent-dispatch-run-lifecycle.mjs";
import { selectVisibleRunRecord } from "./workspace-agent-dispatch-run-lifecycle-state.mjs";
import { defaultRunGit } from "./worktree-substrate.mjs";
import {
  hasExactClosedInputCommitComposition
} from "./backend-review-identity.mjs";
import { resolveCanonicalFindingsOnlyReviewUnit } from "./backend-scope-authority.mjs";
import { readCanonicalWorkRecord } from "./backend-worker-scope-authority.mjs";
import { computeWorkRecordSourceDigest } from "@agent-chassis/wiki-core/src/lib/work-record-schema.mjs";
import {
  normalizeProvisioningConfig,
  createLauncherOwnedManagedAttemptStateAuthority
} from "./backend-provisioning-state.mjs";
import {
  createManagedWorktreeProvisioningAuthority,
  maybeWrapExecutorWithWorktreeProvisioning,
  maybeWrapRegistryEntryWithWorktreeProvisioning
} from "./backend-worktree-binding.mjs";
import {
  readManagedRunObservation,
  recordManagedLifecycleFailure,
  recordManagedRunResult,
  readManagedCompletion,
  recordManagedRunOriginal,
  recordManagedReviewOriginal,
  readManagedReviewOriginal,
  assessManagedRunResultPublication
} from "./managed-run-process-identity-store.mjs";
import { deriveManagedRunIdentityTupleFromBindingPair } from
  "./managed-run-process-identity-contract.mjs";
import { captureDiagnosticEvidence } from "./diagnostic-evidence.mjs";

import { createBackendScope } from "./workspace-agent-dispatch-backend-scope.mjs";
import { createBackendManagedIdentity } from "./workspace-agent-dispatch-backend-managed-identity.mjs";
import {
  createBackendIntegration,
  createCanonicalCommittedSliceIntegrationAdapter
} from "./workspace-agent-dispatch-backend-integration.mjs";
import { createBackendTerminalCandidateCoordination } from
  "./workspace-agent-dispatch-backend-terminal-candidate-coordination.mjs";
import { createBackendPostWorkerLifecycle } from
  "./workspace-agent-dispatch-backend-post-worker-lifecycle.mjs";
import { createCompletedIntegrationCandidateObservation } from
  "./backend-completed-integration-candidate-observation.mjs";
import { createBackendRecovery } from "./workspace-agent-dispatch-backend-recovery.mjs";
import { createBackendWorkerRouting } from
  "./workspace-agent-dispatch-backend-worker-routing.mjs";
import { resolveDispatchSelection, resolveDispatchModelSelection } from "./workspace-agent-dispatch-run-lifecycle-selection.mjs";
import { createWorkspaceAgentAdvisoryReviewPipeline } from
  "./workspace-agent-advisory-review-pipeline.mjs";

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
  return assembleDispatchBackend(options, createDispatchRunLifecycle);
}

export function createPreparedWorkspaceAgentDispatchBackend(options = {}) {
  return assembleDispatchBackend(options, createPreparedDispatchRunLifecycle);
}

function assembleDispatchBackend(options, createLifecycle) {
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
  const normalizedWorktreeProvisioningConfig = normalizeProvisioningConfig(options.worktreeProvisioning);

  const worktreeProvisioningConfig = normalizedWorktreeProvisioningConfig === null
    ? null
    : { ...normalizedWorktreeProvisioningConfig };

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
  const managedWorktreeProvisioningAuthority =
    createManagedWorktreeProvisioningAuthority({
      provisioningConfig: worktreeProvisioningConfig,
      requireManagedProvisioning,
      attemptStateAuthority
    });
  const registeredWorkerScopeSnapshots = new WeakSet();
  const wholeReviewRunContexts = new Map();
  const terminalCandidateRecoveryInFlight = new Map();
  const terminalCandidateAdvanceExclusions = new Map();

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

  const canonicalCommittedSliceIntegrationsByDelivery = new Map();

  const sliceIntegrationCcePolicy = options.sliceIntegrationCcePolicy ?? null;

  const retainCommittedSliceIntegrationOriginal = options.retainCommittedSliceIntegrationOriginal ?? null;
  const readIntegrationDispositions = options.readIntegrationDispositions ?? null;
  const finalizeCommittedSliceIntegration = options.finalizeCommittedSliceIntegration ?? null;
  for (const dependency of [readIntegrationDispositions, finalizeCommittedSliceIntegration]) {
    if (dependency !== null && typeof dependency !== "function") {
      throw new TypeError("integration source and finalization dependencies must be callable");
    }
  }
  const recoveredIntegratedRuns = new Map();

  const exactSliceReviewReceiptStore = options.exactSliceReviewReceiptStore ?? null;
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

  const postWorkerLifecycleRunGit = options.postWorkerLifecycleRunGit ?? reviewContextRunGit;
  const closedInputCommitCompositionInstalled = hasExactClosedInputCommitComposition(
    options.closedInputCommitComposition
  );
  const runs = new Map();

  const canonicalAdmissionReviewRecordRoot = worktreeProvisioningConfig?.mainRepo ?? null;
  const resolveCanonicalAdmissionReviewRecord = canonicalAdmissionReviewRecordRoot === null
    ? null
    : ({ record_id: recordId } = {}) => {
      const record = readCanonicalWorkRecord(canonicalAdmissionReviewRecordRoot, recordId);
      if (record === null || typeof record !== "object" || record.id !== recordId) {
        return null;
      }
      const generationId = computeWorkRecordSourceDigest(record);
      if (typeof generationId !== "string" || generationId === "") return null;
      const repository = typeof record.repo === "string" ? record.repo.trim() : "";
      if (repository === "") return null;
      return { record, generation_id: generationId, repository };
    };

  const managedWorkerIdentityRequired = requireManagedProvisioning;
  const managedRunIdentityRoot = requireManagedProvisioning
    ? (worktreeProvisioningConfig?.mainRepo ?? null)
    : null;
  const publishManagedRunResult = managedRunIdentityRoot === null
    ? null
    : ({ subject, dispatchTuple, result }) => recordManagedRunResult({
        mainRepo: managedRunIdentityRoot,
        subject,
        dispatchTuple,
        result
      });
  const assessManagedRunResult = managedRunIdentityRoot === null
    ? null
    : (request) => assessManagedRunResultPublication({ ...request, mainRepo: managedRunIdentityRoot });
  const publishManagedRunOriginal = managedRunIdentityRoot === null ? null
    : request => recordManagedRunOriginal({ ...request, mainRepo: managedRunIdentityRoot });
  const publishManagedReviewOriginal = managedRunIdentityRoot === null ? null
    : request => recordManagedReviewOriginal({ ...request, mainRepo: managedRunIdentityRoot });

  const managedRunIdentityDeps = options.managedRunProcessIdentityDeps ?? undefined;

  const backendContext = {
    worktreeProvisioningConfig,
    requireManagedProvisioning,
    attemptStateAuthority,
    registeredWorkerScopeSnapshots,
    runs,
    frozenReviewContextsByTarget,
    currentTerminalReviewTargetByWk,
    wholeReviewRunContexts,
    terminalCandidateRecoveryInFlight,
    terminalCandidateAdvanceExclusions,
    terminalReviewAttemptContracts,
    terminalReviewAttemptContractBySubject,
    recoverTerminalCandidate,
    wholeReviewTargetKey,
    frozenReviewContexts,
    sliceReviewRunContexts,
    canonicalCommittedSliceIntegrations,
    canonicalCommittedSliceIntegrationAttempts,
    canonicalCommittedSliceIntegrationsByDelivery,
    sliceIntegrationCcePolicy,
    retainCommittedSliceIntegrationOriginal,
    readIntegrationDispositions,
    finalizeCommittedSliceIntegration,
    sliceReviewTargetKey,
    committedSliceIntegrationTargetKey,
    frozenSliceReviewContexts,
    recoveredIntegratedRuns,
    exactSliceReviewReceiptStore,
    postWorkerSliceLifecycle,
    canonicalCommittedSliceIntegration,
    reviewContextRunGit,
    postWorkerLifecycleRunGit,
    managedRunIdentityRoot,
    managedRunIdentityDeps,
    managedWorkerIdentityRequired,
    managedWorktreeProvisioningAuthority
  };

  Object.assign(backendContext, createBackendScope(backendContext));
  Object.assign(backendContext, createBackendManagedIdentity(backendContext));
  Object.assign(backendContext, createBackendIntegration(backendContext));

  const advisoryLaunchObservations = new Map();
  const observeExecutor = candidate => createLifecycle !== createPreparedDispatchRunLifecycle ? candidate
    : async input => {
      const result = await candidate(input);
      const root = input.advisory_review_input?.private_checkout_root;
      if (root !== undefined) advisoryLaunchObservations.set(root, Object.freeze({
        child_started: Number.isInteger(result?.pid) && result.pid > 0 ? true : null,
        enforcement: result?.enforcement ?? null
      }));
      return result;
    };
  const executors = {};
  const executorRegistryEntries = {};

  const familyAwareWiring = !!(launchExecutors && typeof launchExecutors === "object");
  if (familyAwareWiring) {
    for (const app of BACKEND_SUPPORTED_APPS) {
      const candidate = launchExecutors[app];
      if (typeof candidate === "function") {
        executors[app] = maybeWrapExecutorWithWorktreeProvisioning(
          requireManagedProvisioning ? gateManagedExecutor(observeExecutor(candidate)) : observeExecutor(candidate),
          app,
          worktreeProvisioningConfig,
          requireManagedProvisioning,
          attemptStateAuthority,
          backendContext.validateWorkerScopeSnapshot,
          managedWorktreeProvisioningAuthority
        );
        executorRegistryEntries[app] = executors[app];
      } else if (candidate && typeof candidate === "object" && typeof candidate.executor === "function") {
        const gatedCandidate = requireManagedProvisioning
          ? { ...candidate, executor: gateManagedExecutor(observeExecutor(candidate.executor)) }
          : { ...candidate, executor: observeExecutor(candidate.executor) };
        const wrapped = maybeWrapRegistryEntryWithWorktreeProvisioning(
          gatedCandidate,
          app,
          worktreeProvisioningConfig,
          requireManagedProvisioning,
          attemptStateAuthority,
          backendContext.validateWorkerScopeSnapshot,
          managedWorktreeProvisioningAuthority
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
      backendContext.validateWorkerScopeSnapshot,
      managedWorktreeProvisioningAuthority
    );
    executorRegistryEntries.codex = executors.codex;
  }

  backendContext.resolveDispatchSelection = (input = {}) => resolveDispatchSelection({
    role: input.role,
    app: input.app ?? null,
    model: input.model ?? null,
    target: input.target ?? input.subject ?? null,
    target_role: input.target_role ?? null,
    subject: input.subject ?? null,
    workspaceDir: input.workspace_dir ?? input.workspaceDir ?? null,
    configRootDir: input.config_root_dir ?? input.configRootDir ?? null
  });
  backendContext.executors = executors;
  backendContext.executorRegistryEntries = executorRegistryEntries;
  backendContext.familyAwareWiring = familyAwareWiring;

  const lifecycle = createLifecycle({
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

    managedWorkerIdentityRequired,
    managedRunIdentityRootPresent: managedRunIdentityRoot !== null,
    checkPriorManagedAttempt: backendContext.checkPriorManagedAttempt,
    publishPendingManagedRunIdentity: backendContext.publishPendingManagedRunIdentity,
    bindManagedRunOuterIdentity: backendContext.bindManagedRunOuterIdentity,
    releaseManagedRunSubjectReservationForLaunch: backendContext.releaseManagedRunSubjectReservationForLaunch,

    resolveCanonicalAdmissionReviewRecord,
    settleFormalReviewAttestation: options.settleFormalReviewAttestation ?? null,
    publishManagedRunResult,
    readManagedRunCompletion: managedRunIdentityRoot === null ? null : request => readManagedCompletion({ ...request, mainRepo: managedRunIdentityRoot }),
    assessManagedRunResult,
    publishManagedRunOriginal,
    publishManagedReviewOriginal,
    captureRunOriginal: options.captureRunOriginal ?? null
  });
  backendContext.lifecycle = lifecycle;

  const advisoryReviewPipeline = createWorkspaceAgentAdvisoryReviewPipeline({
    lifecycle,
    worktreeProvisioningConfig,
    readLaunchObservation: createLifecycle !== createPreparedDispatchRunLifecycle ? null : root => {
      const observation = advisoryLaunchObservations.get(root) ?? null;
      advisoryLaunchObservations.delete(root);
      return observation;
    },
    runGit: reviewContextRunGit,

    resolveConfiguredWorkspaceRepo: typeof options.resolveConfiguredWorkspaceRepo === "function"
      ? options.resolveConfiguredWorkspaceRepo
      : null,

    resolveTerminalCandidate: (request) =>
      backendContext.resolveTerminalCandidateReviewMaterial(request)
  });
  backendContext.startAdvisoryReview = advisoryReviewPipeline.execute;
  backendContext.resolveAdvisoryReviewMaterial = advisoryReviewPipeline.resolveMaterial;

  Object.assign(backendContext, createBackendTerminalCandidateCoordination(backendContext));
  Object.assign(backendContext, createBackendPostWorkerLifecycle(backendContext));
  Object.assign(backendContext, createBackendRecovery(backendContext));
  Object.assign(backendContext, createBackendWorkerRouting(backendContext));

  const getManagedLifecycleCapabilityAuthorityFacts =
    createManagedLifecycleCapabilityAuthorityFacts({
      resolveManagedStdioMcpComposition,
      executors,
      worktreeProvisioningConfig,
      requireManagedProvisioning,
      closedInputCommitCompositionInstalled,
      postWorkerSliceLifecycle
    });
  const getSelectedBackendCapabilityFacts = createSelectedBackendCapabilityFacts({
    resolveDispatchSelection: (input = {}) => resolveDispatchSelection({
      role: input.role,
      app: input.app ?? null,
      model: input.model ?? null,
      target: input.target ?? input.subject ?? null,
      target_role: input.target_role ?? null,
      subject: input.subject ?? null,
      workspaceDir: input.workspace_dir ?? input.workspaceDir ?? null,
      configRootDir: input.config_root_dir ?? input.configRootDir ?? null
    }),
    executors,
    executorRegistryEntries,
    familyAwareWiring,
    resolveBackendRoutingDecision: backendContext.resolveBackendRoutingDecision
  });
  const getDispatchModelCapabilityFacts = createSelectedBackendCapabilityFacts({
    resolveDispatchSelection: (input = {}) => resolveDispatchModelSelection({
      role: input.role, app: input.app, model: input.model,
      workspaceDir: input.workspace_dir, configRootDir: input.config_root_dir
    }), executors, executorRegistryEntries, familyAwareWiring
  });
  const predictRepositoryScope = (input = {}) => {
    const routing = backendContext.resolveBackendRoutingDecision(input);
    if (routing?.ok !== true) return routing;
    if (routing.findings_route?.route === "refuse" || routing.refusal) return Object.freeze({
      ok: false,
      selection: routing,
      refusal: routing.refusal
    });
    return backendContext.predictRepositoryScope(input);
  };

  return {
    schema_version: WORKSPACE_AGENT_DISPATCH_BACKEND_SCHEMA_VERSION,
    startAdvisoryReview: backendContext.startAdvisoryReview,
    ...(createLifecycle === createPreparedDispatchRunLifecycle
      ? { resolveAdvisoryReviewMaterial: backendContext.resolveAdvisoryReviewMaterial } : {}),
    startLaunch: backendContext.startLaunch,
    getRunStatus: lifecycle.getRunStatus,
    waitForRunStatus: lifecycle.waitForRunStatus,
    readManagedRunObservation: managedRunIdentityRoot === null
      ? null
      : (input) => {
          const subjectRuns = [...runs.values()].filter((record) => record.subject === input.subject);
          const visible = selectVisibleRunRecord(runs, {
            caller_session_id: input.caller_session_id ?? null,
            subject: input.subject,
            attempt_id: input.attemptId ?? null
          });

          if (subjectRuns.length > 0 && visible.selected === null) return Object.freeze({
            ok: false,
            code: visible.code,
            candidates: visible.candidates
          });
          if (visible.selected?.role !== undefined && visible.selected.role !== "worker") {
            return Object.freeze({ ok: false, code: "findings_observation_unavailable" });
          }
          const worker = readManagedRunObservation({
            mainRepo: managedRunIdentityRoot,
            ...input,
            attemptId: input.attemptId ?? visible.selected?.run_id ?? null
          });

          if (input.includeReviewOriginal !== true || worker.ok || visible.selected != null) return worker;
          const review = readManagedReviewOriginal({ mainRepo: managedRunIdentityRoot,
            subject: input.subject, attemptId: input.attemptId ?? null });
          const nothingSelected = worker.refusal == null &&
            ["attempt_selector_mismatch", "attempt_observation_unavailable"].includes(worker.code);
          if (review.ok) return input.attemptId != null || nothingSelected ? review : worker;
          return nothingSelected && (review.refusal != null || review.code === "attempt_selection_ambiguous")
            ? review : worker;
        },

    recordManagedLifecycleFailure: managedRunIdentityRoot === null
      ? null
      : ({ subject, run, invocationId, failure }) => {
          let dispatchTuple;
          try {
            if (run?.subject !== subject) throw new TypeError("run subject mismatch");
            const provisioning = backendContext.resolveManagedRunBinding(run);
            dispatchTuple = deriveManagedRunIdentityTupleFromBindingPair({
              assignedUnit: subject,
              launchRef: run.monitor_handle,
              wkBinding: provisioning?.wk_binding,
              sliceBinding: provisioning?.slice_binding,
              expectedRunId: run.run_id
            });
          } catch (error) {

            return Object.freeze({
              ok: false,
              code: "attempt_binding_mismatch",
              cause_code: typeof error?.code === "string" ? error.code : null,
              evidence: captureDiagnosticEvidence(error)
            });
          }
          return recordManagedLifecycleFailure({
            mainRepo: managedRunIdentityRoot,
            subject,
            dispatchTuple,
            invocationId,
            failure
          });
        },
    resolveRetainedFindingsSource: lifecycle.resolveRetainedFindingsSource,
    planLaunch: lifecycle.planLaunch,
    resolveWorkerTargetRefusal: backendContext.resolveWorkerTargetRefusal,
    preflightWorkerInputs: input => backendContext.freezeWorkerScopeSnapshot.preflight({
      input, role: input.role, subject: input.subject, app: input.app
    }),
    getManagedLifecycleCapabilityAuthorityFacts,
    getSelectedBackendCapabilityFacts,
    getDispatchModelCapabilityFacts,
    resolveBackendRoutingDecision: backendContext.resolveBackendRoutingDecision,

    predictRepositoryScope,
    getManagedStdioMcpCompositionCompatibility: () =>
      resolveManagedStdioMcpComposition(),
    requestCommittedSliceIntegration: backendContext.requestCommittedSliceIntegration,

    assessManagedLifecycleRetry: ({ run, facts } = {}) =>
      backendContext.assessCommittedSliceIntegrationRetry({
        subject: run?.subject,
        status: run,
        facts
      }),

    rederiveManagedLifecycleRefusal: ({ run } = {}) =>
      backendContext.rederiveCommittedSliceIntegrationRefusal({
        subject: run?.subject,
        status: run
      }),
    resolveCommittedSliceIntegrationContinuation: backendContext.resolveCommittedSliceIntegrationContinuation,

    observeCompletedIntegrationCandidate: createCompletedIntegrationCandidateObservation({
      resolveCommittedSliceIntegrationContinuation: (args) =>
        backendContext.resolveCommittedSliceIntegrationContinuation(args),
      observeTerminalCandidate: options.observeTerminalCandidate
    }),
    resolveTerminalReviewPublicationState: backendContext.resolveTerminalReviewPublicationState,
    observeTerminalCandidateBoundState: backendContext.observeTerminalCandidateBoundState,

    decideTerminalReviewLifecycle: backendContext.decideTerminalReviewLifecycle,
    withTerminalCandidateAdvanceExclusion: backendContext.withTerminalCandidateAdvanceExclusion,
    ...(backendContext.runPostWorkerSliceLifecycle !== null
      ? {
          runPostWorkerSliceLifecycle: backendContext.runPostWorkerSliceLifecycle,
          recoverIntegratedWorkerRun: backendContext.recoverIntegratedWorkerRun,
          recoverManagedWorkerRun: backendContext.recoverManagedWorkerRun
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
      resolveCanonicalFindingsOnlyReviewUnit(mainRepo, wkId),

    __resolveCanonicalAdmissionReviewRecord: resolveCanonicalAdmissionReviewRecord
  };
}
